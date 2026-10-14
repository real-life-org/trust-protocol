// store-contract — the Store port's contract as an exported test suite
// (lib Stage 2, note §3). Apps and simulators run it against their own
// adapters:
//
//   import { test } from 'node:test'
//   import assert from 'node:assert/strict'
//   import { storeContract } from '@real-life/trust-protocol/testing'
//   storeContract(() => new MyStore(), { test, assert })
//
// `makeStore` must return a fresh, EMPTY store each call. Persistent
// adapters additionally test durability across process loss themselves.
import { jcs } from './core.js'
import { CODEC, decodeState, StateCodecError } from './codec.js'
import { emptyState } from './state.js'
import type { HolderState } from './state.js'
import type { Store } from './ports.js'

/** The slice of node:test and node:assert the suite uses. */
export interface ContractHarness {
  test: (name: string, fn: () => Promise<void>) => unknown
  assert: {
    equal: (actual: unknown, expected: unknown, message?: string) => void
    ok: (value: unknown, message?: string) => void
  }
}

const stateWith = (when: number, label?: string): HolderState => {
  const s = emptyState(CODEC)
  s.lastWhen = when
  if (label) s.register.labels.push(label)
  return s
}
const j = (x: unknown): string => jcs(x)

export function storeContract (makeStore: () => Promise<Store> | Store, { test, assert }: ContractHarness): void {
  const fresh = async (): Promise<Store> => makeStore()

  test('store contract: a fresh store reads as empty', async () => {
    const s = await fresh()
    const r = await s.read()
    assert.equal(r.state, null)
    assert.equal(r.version, null)
  })

  test('store contract: snapshot isolation — reads and commits are copies', async () => {
    const s = await fresh()
    const a = stateWith(1, 'pair/x')
    const c = await s.commit(null, a)
    assert.ok(c.ok, 'first commit on an empty store')
    a.register.labels.push('mutated after commit')
    const r1 = await s.read()
    assert.equal(j(r1.state), j(stateWith(1, 'pair/x')))
    ;(r1.state as HolderState).register.labels.push('mutated after read')
    ;(r1.state as HolderState).lastWhen = 99
    const r2 = await s.read()
    assert.equal(j(r2.state), j(stateWith(1, 'pair/x')))
    assert.ok(r1.state !== r2.state, 'each read is its own object')
  })

  test('store contract: CAS — two commits on one version, exactly one wins, the loser writes nothing', async () => {
    const s = await fresh()
    const c0 = await s.commit(null, stateWith(1))
    assert.ok(c0.ok)
    const v = (await s.read()).version
    const [x, y] = await Promise.all([s.commit(v, stateWith(2)), s.commit(v, stateWith(3))])
    assert.equal([x, y].filter((r) => r.ok).length, 1, 'exactly one commit succeeds')
    const loser = x.ok ? y : x
    assert.equal(j(loser), j({ ok: false, reason: 'conflict' }))
    const winner = x.ok ? x : y
    const r = await s.read()
    assert.equal(r.version, winner.ok ? winner.version : undefined)
    assert.equal(j(r.state), j(stateWith(x.ok ? 2 : 3)))
  })

  test('store contract: CAS on an empty store — two creating commits, one wins', async () => {
    const s = await fresh()
    const [x, y] = await Promise.all([s.commit(null, stateWith(2)), s.commit(null, stateWith(3))])
    assert.equal([x, y].filter((r) => r.ok).length, 1)
  })

  test('store contract: atomicity — a rejected commit leaves state and version unchanged', async () => {
    const s = await fresh()
    const c1 = await s.commit(null, stateWith(1))
    const c2 = await s.commit(c1.ok ? c1.version : null, stateWith(2))
    assert.ok(c1.ok && c2.ok)
    const before = await s.read()
    const stale = await s.commit(c1.ok ? c1.version : null, stateWith(7))
    assert.equal(stale.ok, false)
    const after = await s.read()
    assert.equal(after.version, before.version)
    assert.equal(j(after.state), j(before.state))
    assert.ok(c1.ok && c2.ok && c1.version !== c2.version, 'every commit yields a new version')
  })

  test('store contract: reopen — a later read returns the last commit and its version', async () => {
    const s = await fresh()
    let v: string | null = null
    for (let i = 1; i <= 3; i++) {
      const c = await s.commit(v, stateWith(i))
      assert.ok(c.ok)
      v = c.ok ? c.version : v
    }
    const r = await s.read()
    assert.equal(r.version, v)
    assert.equal(j(r.state), j(stateWith(3)))
  })

  test('store contract: result loss — a commit whose answer is dropped is visible on re-read, and its old version is spent', async () => {
    const s = await fresh()
    const c0 = await s.commit(null, stateWith(1))
    const v0 = c0.ok ? c0.version : null
    await s.commit(v0, stateWith(2)).then(() => undefined)   // the answer is lost
    const r = await s.read()
    assert.ok(r.version !== v0, 'the dropped commit landed')
    assert.equal(j(r.state), j(stateWith(2)))
    const retry = await s.commit(v0, stateWith(2))
    assert.equal(retry.ok, false, 'retrying on the old version conflicts')
  })

  test('store contract: codec boundary — the store keeps any JSON, decodeState is the gate', async () => {
    const s = await fresh()
    const newer = { ...stateWith(1), codec: CODEC + 1 }
    const c1 = await s.commit(null, newer as unknown as HolderState)
    assert.ok(c1.ok, 'the store does not validate or migrate')
    const r1 = await s.read()
    assert.equal(j(r1.state), j(newer))
    let code: string | undefined
    try { decodeState(r1.state) } catch (e) { code = e instanceof StateCodecError ? e.code : 'untyped' }
    assert.equal(code, 'codec-newer')

    const corrupted: Record<string, unknown> = { ...stateWith(1) }
    delete corrupted.register
    const c2 = await s.commit(c1.ok ? c1.version : null, corrupted as unknown as HolderState)
    assert.ok(c2.ok)
    code = undefined
    try { decodeState((await s.read()).state) } catch (e) { code = e instanceof StateCodecError ? e.code : 'untyped' }
    assert.equal(code, 'shape')

    const good = stateWith(5, 'pair/y')
    const c3 = await s.commit(c2.ok ? c2.version : null, good)
    assert.ok(c3.ok)
    assert.equal(j(decodeState((await s.read()).state)), j(good))
  })
}
