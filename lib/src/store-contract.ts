// store-contract — the Store port's contract as an exported test suite
// (lib Stage 2, note §3). Apps and simulators run it against their own
// adapters:
//
//   import { test } from 'node:test'
//   import assert from 'node:assert/strict'
//   import { storeContract } from '@real-life/trust-protocol/testing'
//   storeContract(() => new MyStore(), { test, assert })
//
// `makeStore` must return a fresh, EMPTY store each call. Version tokens
// are for CAS only and are never reused within a store's lifetime (no
// ABA). Persistent adapters additionally test durability and token
// freshness across process loss and reopening themselves.
import { jcs } from './core.js'
import { CODEC, decodeState, StateCodecError } from './codec.js'
import { emptyState, toOpaque } from './state.js'
import type { HolderState, OpaqueHolderState } from './state.js'
import type { Store } from './ports.js'

/** The slice of node:test and node:assert the suite uses. */
export interface ContractHarness {
  test: (name: string, fn: () => Promise<void>) => unknown
  assert: {
    equal: (actual: unknown, expected: unknown, message?: string) => void
    ok: (value: unknown, message?: string) => void
  }
}

const structural = (when: number, label?: string): HolderState => {
  const s = emptyState(CODEC)
  s.lastWhen = when
  if (label) s.register.labels.push(label)
  return s
}
/** A state as the Store port receives it: opaque. */
const stateWith = (when: number, label?: string): OpaqueHolderState => toOpaque(structural(when, label))
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
    const a = structural(1, 'pair/x')
    const c = await s.commit(null, toOpaque(a))
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

  test('store contract: CAS on an empty store — two creating commits, one wins, the loser writes nothing', async () => {
    const s = await fresh()
    const [x, y] = await Promise.all([s.commit(null, stateWith(2)), s.commit(null, stateWith(3))])
    assert.equal([x, y].filter((r) => r.ok).length, 1)
    const loser = x.ok ? y : x
    assert.equal(j(loser), j({ ok: false, reason: 'conflict' }))
    const r = await s.read()
    assert.equal(r.version, x.ok ? x.version : y.ok ? y.version : undefined)
    assert.equal(j(r.state), j(stateWith(x.ok ? 2 : 3)))
  })

  test('store contract: every historical token is rejected after further commits', async () => {
    const s = await fresh()
    const tokens: string[] = []
    let v: string | null = null
    for (let i = 1; i <= 5; i++) {
      const c = await s.commit(v, stateWith(i))
      assert.ok(c.ok)
      v = c.ok ? c.version : v
      tokens.push(v as string)
    }
    assert.equal(new Set(tokens).size, tokens.length, 'no token repeats')
    const before = await s.read()
    for (const old of [null, ...tokens.slice(0, -1)]) {
      const r = await s.commit(old, stateWith(99))
      assert.equal(r.ok, false, `stale token ${old} rejected`)
    }
    const after = await s.read()
    assert.equal(after.version, before.version)
    assert.equal(j(after.state), j(stateWith(5)))
  })

  test('store contract: no ABA — a token stays spent when the content returns to an earlier value', async () => {
    const s = await fresh()
    const a = await s.commit(null, stateWith(1))
    const b = await s.commit(a.ok ? a.version : null, stateWith(2))
    const c = await s.commit(b.ok ? b.version : null, stateWith(1))
    assert.ok(a.ok && b.ok && c.ok)
    const now = await s.read()
    assert.equal(j(now.state), j(stateWith(1)), 'content is back at its first value')
    assert.ok(a.ok && c.ok && a.version !== c.version, 'but the token is new')
    const stale = await s.commit(a.ok ? a.version : null, stateWith(7))
    assert.equal(stale.ok, false, 'the first token is still spent')
    assert.equal((await s.read()).version, now.version)
  })

  test('store contract: an older snapshot stays as it was and its token is rejected after later commits', async () => {
    const s = await fresh()
    const c0 = await s.commit(null, stateWith(1, 'pair/a'))
    assert.ok(c0.ok)
    const old = await s.read()
    const oldText = j(old.state)
    const c1 = await s.commit(old.version, stateWith(2, 'pair/b'))
    const c2 = await s.commit(c1.ok ? c1.version : null, stateWith(3, 'pair/c'))
    assert.ok(c1.ok && c2.ok)
    assert.equal(j(old.state), oldText, 'later commits do not reach into an earlier snapshot')
    const stale = await s.commit(old.version, stateWith(9))
    assert.equal(stale.ok, false)
    assert.equal(j((await s.read()).state), j(stateWith(3, 'pair/c')))
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
    const newer = { ...structural(1), codec: CODEC + 1 }
    const c1 = await s.commit(null, newer as unknown as OpaqueHolderState)
    assert.ok(c1.ok, 'the store does not validate or migrate')
    const r1 = await s.read()
    assert.equal(j(r1.state), j(newer))
    let code: string | undefined
    try { decodeState(r1.state) } catch (e) { code = e instanceof StateCodecError ? e.code : 'untyped' }
    assert.equal(code, 'codec-newer')

    const corrupted: Record<string, unknown> = { ...structural(1) }
    delete corrupted.register
    const c2 = await s.commit(c1.ok ? c1.version : null, corrupted as unknown as OpaqueHolderState)
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
