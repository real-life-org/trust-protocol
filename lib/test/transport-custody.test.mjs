#!/usr/bin/env node
// transport-custody (lib 0.6.0): the holder keeps what waits for transport
// across a lock and the end of a process, and only an open, resumed
// opening hands anything over — Delivery 0.83 RLTP-DEL-6120 to 6135, 6330,
// 6335. One scenario per rule, among them the open counter-probes of the
// store-launch reviews (wot-v3 #420 R10, #421 R7), restated on the library:
//   · a document missing from the view is never "keep sending"
//   · a failed expiry check on opening hands nothing over
//   · an expired copy does not go out, recorded or not
//   · held acks survive a reconciliation and a lock
//   · a snapshot taken before a lock sends nothing
// A lock and the end of a process are the same thing to the library:
// holder.close(), then a new createHolder over the same store.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHolder } from '../dist/index.js'
import { InMemoryStore } from '../dist/testing.js'
import { jcs } from '../dist/core.js'
import { ENGINE_DEFAULTS } from '../dist/engine.js'
import { pair, read, noteModule, T0, DAY } from './pair-fixture.mjs'

const H = ENGINE_DEFAULTS.horizonMs

/** A store whose next `n` commits throw (a storage failure). */
class FlakyStore extends InMemoryStore {
  constructor () { super(); this.failures = 0 }
  async commit (version, next) {
    if (this.failures > 0) { this.failures--; throw new Error('storage failure') }
    return super.commit(version, next)
  }
}

/** The next opening over the same store: a new holder, its first resume not yet run. */
const reopen = (store, keys) => createHolder({ store, keys }, { modules: [noteModule()] })

async function sent () {
  const p = await pair()
  const out = (await p.holderA.act('note.send', {}, T0)).outbound[0]
  return { ...p, out }
}

const kinds = (v) => v.entries.map((e) => [e.kind, e.digest, e.held ?? null])

test('custody (RLTP-DEL-6120): a document reported awaiting-transport survives a lock and the end of the process, byte-identical, and resume alone does not re-emit it', async () => {
  const { holderA, storeA, A, out } = await sent()
  await holderA.report({ digest: out.digest, status: 'awaiting-transport', reason: 'offline' }, T0 + 1)
  assert.deepEqual((await holderA.resume(T0 + DAY)).outbound, [], 'held: the adapter has it')
  holderA.close()
  const next = await reopen(storeA, A.keys)
  assert.deepEqual(await next.pendingTransport(T0 + DAY), { ok: false, code: 'not-resumed' }, 'the due transitions come first (6130)')
  await next.resume(T0 + DAY)
  const v = await next.pendingTransport(T0 + DAY)
  assert.deepEqual(kinds(v), [['document', out.digest, 'offline']])
  assert.equal(jcs(v.entries[0].envelope), jcs(out.envelope))
  assert.deepEqual([v.entries[0].since, v.entries[0].notAfter], [T0, T0 + H])
  assert.equal(await next.mayHandOver(v.entries[0], T0 + DAY), true)
})

test('custody (RLTP-DEL-6130): a snapshot taken before a lock sends nothing — not from the closed opening, not through the next one', async () => {
  const { holderA, storeA, A, out } = await sent()
  await holderA.resume(T0)
  const [old] = (await holderA.pendingTransport(T0)).entries
  assert.equal(await holderA.mayHandOver(old, T0 + 1), true)
  const copy = structuredClone(old)
  assert.equal(await holderA.mayHandOver(copy, T0 + 1), false, 'only an entry the opening issued')
  holderA.close()
  assert.equal(holderA.closed, true)
  assert.equal(await holderA.mayHandOver(old, T0 + 1), false)
  await assert.rejects(holderA.resume(T0 + 1), (e) => e.code === 'closed')
  await assert.rejects(holderA.contacts(), (e) => e.code === 'closed', 'a closed holder runs nothing')
  const next = await reopen(storeA, A.keys)
  await next.resume(T0 + 2)
  const [mine] = (await next.pendingTransport(T0 + 2)).entries
  assert.equal(mine.digest, out.digest)
  assert.equal(await next.mayHandOver(old, T0 + 2), false, 'the old opening\'s entry')
  assert.equal(await next.mayHandOver(mine, T0 + 2), true)
})

test('custody (RLTP-DEL-6135): a document missing from the view is never "keep sending" — accepted, given up or failed, its entry no longer passes', async () => {
  const p = await pair()
  const one = (await p.holderA.act('note.send', {}, T0)).outbound[0]
  const two = (await p.holderA.act('note.send', {}, T0 + 1)).outbound[0]
  const three = (await p.holderA.act('note.send', {}, T0 + 2)).outbound[0]
  await p.holderA.resume(T0 + 3)
  const v = await p.holderA.pendingTransport(T0 + 3)
  const e = Object.fromEntries(v.entries.map((x) => [x.digest, x]))
  await p.holderA.report({ digest: one.digest, status: 'accepted' }, T0 + 4)
  await p.holderA.report({ digest: two.digest, status: 'failed', reason: 'oversize' }, T0 + 4)
  assert.deepEqual((await p.holderA.pendingTransport(T0 + 5)).entries.map((x) => x.digest), [three.digest])
  assert.equal(await p.holderA.mayHandOver(e[one.digest], T0 + 5), false, 'accepted: custody ended')
  assert.equal(await p.holderA.mayHandOver(e[two.digest], T0 + 5), false, 'failed')
  assert.equal(await p.holderA.mayHandOver(e[three.digest], T0 + 5), true)
})

test('custody (RLTP-DEL-6115, 6135): an expired copy does not go out — past its deadline it leaves the view and the gate before any resume records the give-up', async () => {
  const { holderA, storeA, out } = await sent()
  await holderA.resume(T0)
  const [e] = (await holderA.pendingTransport(T0)).entries
  const late = T0 + H
  assert.equal((await read(storeA)).outbox[out.digest].history.at(-1).status, 'submitted', 'nothing recorded yet')
  assert.equal(await holderA.mayHandOver(e, late - 1), true)
  assert.equal(await holderA.mayHandOver(e, late), false)
  assert.deepEqual((await holderA.pendingTransport(late)).entries, [])
  await holderA.resume(late)
  assert.equal((await read(storeA)).outbox[out.digest].history.at(-1).status, 'failed')
})

test('custody (RLTP-DEL-6130, 6135; #421 R7): a failed expiry check on opening hands nothing over — the copy that expired while locked never goes out', async () => {
  const p = await pair()
  const store = new FlakyStore()
  await store.commit(null, (await p.storeA.read()).state)
  const holder = await createHolder({ store, keys: p.A.keys }, { modules: [noteModule()] })
  const out = (await holder.act('note.send', {}, T0)).outbound[0]
  await holder.report({ digest: out.digest, status: 'awaiting-transport', reason: 'offline' }, T0 + 1)
  await holder.resume(T0 + 1)
  const [before] = (await holder.pendingTransport(T0 + 1)).entries
  holder.close()
  const at = T0 + 8 * DAY
  const next = await reopen(store, p.A.keys)
  store.failures = 1
  await assert.rejects(next.resume(at), (e) => e.code === 'store-commit' || e.code === 'unknown-commit-outcome')
  assert.deepEqual(await next.pendingTransport(at), { ok: false, code: 'not-resumed' })
  assert.equal(await next.mayHandOver(before, at), false)
  await next.resume(at)
  assert.deepEqual((await next.pendingTransport(at)).entries, [])
  assert.equal((await read(store)).outbox[out.digest].history.at(-1).reason, 'expired-by-adapter-policy', 'given up first, never offered')
})

test('custody: a resume that throws after one that completed withdraws the authority until the next completes', async () => {
  const p = await pair()
  const store = new FlakyStore()
  await store.commit(null, (await p.storeA.read()).state)
  const holder = await createHolder({ store, keys: p.A.keys }, { modules: [noteModule()] })
  await holder.act('note.send', {}, T0)
  await holder.resume(T0)
  const [e] = (await holder.pendingTransport(T0)).entries
  store.failures = 1
  await assert.rejects(holder.resume(T0 + 2 * ENGINE_DEFAULTS.backoff(1)))
  assert.equal(await holder.mayHandOver(e, T0 + 1), false)
  await holder.resume(T0 + 2 * ENGINE_DEFAULTS.backoff(1))
  assert.equal(await holder.mayHandOver(e, T0 + 1), true)
})

test('acks (RLTP-DEL-6330; #420 R9): a held ack survives the reconciliation and the lock — awaiting-transport ends neither its retries nor its custody', async () => {
  const { holderA, holderB, storeB, B } = await pair()
  const out = (await holderA.act('note.send', {}, T0)).outbound[0]
  const r = await holderB.receive(out.envelope, T0 + 1)
  const ack = r.outbound[0]
  await holderB.report({ digest: ack.digest, status: 'awaiting-transport', reason: 'transport-unreachable' }, T0 + 2)
  const stored = (await read(storeB)).effects[out.digest].ack
  assert.deepEqual([stored.sent, stored.held, stored.sentBy], [false, 'transport-unreachable', undefined])
  assert.deepEqual((await holderB.resume(T0 + DAY)).outbound, [], 'held: not re-offered by resume')
  assert.deepEqual(kinds(await holderB.pendingTransport(T0 + DAY)), [['ack', ack.digest, 'transport-unreachable']])
  holderB.close()
  const next = await createHolder({ store: storeB, keys: B.keys }, { modules: [noteModule()] })
  await next.resume(T0 + 2 * DAY)
  const v = await next.pendingTransport(T0 + 2 * DAY)
  assert.deepEqual(kinds(v), [['ack', ack.digest, 'transport-unreachable']])
  assert.equal(jcs(v.entries[0].envelope), jcs(ack.envelope))
  assert.deepEqual([v.entries[0].since, v.entries[0].notAfter], [T0 + 1, T0 + 1 + H])
  await next.report({ digest: ack.digest, status: 'accepted' }, T0 + 2 * DAY)
  assert.deepEqual((await read(storeB)).effects[out.digest].ack.sentBy, 'accepted')
  assert.deepEqual((await next.pendingTransport(T0 + 2 * DAY)).entries, [])
  assert.equal(await next.mayHandOver(v.entries[0], T0 + 2 * DAY), false)
})

test('acks (RLTP-DEL-6330): an ack the adapter reports failed is given up, recorded as failed', async () => {
  const { holderA, holderB, storeB } = await pair()
  const out = (await holderA.act('note.send', {}, T0)).outbound[0]
  const ack = (await holderB.receive(out.envelope, T0 + 1)).outbound[0]
  await holderB.report({ digest: ack.digest, status: 'failed', reason: 'oversize' }, T0 + 2)
  assert.equal((await read(storeB)).effects[out.digest].ack.sentBy, 'failed')
  await holderB.resume(T0 + 2)
  assert.deepEqual((await holderB.pendingTransport(T0 + 2)).entries, [])
})

test('acks (RLTP-DEL-6335; #420 R10): past its retries an ack leaves the view, unreported or held, yet a duplicate within the retention re-sends it byte-identical — once, no new retries', async () => {
  const { holderA, holderB, storeB } = await pair()
  const out = (await holderA.act('note.send', {}, T0)).outbound[0]
  const ack = (await holderB.receive(out.envelope, T0 + 1)).outbound[0]
  await holderB.report({ digest: ack.digest, status: 'awaiting-transport', reason: 'offline' }, T0 + 2)
  await holderB.resume(T0 + 1)
  const [e] = (await holderB.pendingTransport(T0 + 1)).entries
  assert.deepEqual((await holderB.pendingTransport(T0 + 1 + H)).entries, [], 'past the horizon, before any resume')
  assert.equal(await holderB.mayHandOver(e, T0 + 1 + H), false)
  await holderB.resume(T0 + 1 + H)
  const after = (await read(storeB)).effects[out.digest].ack
  assert.deepEqual([after.sent, after.sentBy, after.held], [true, 'horizon', undefined])
  const seq = (await read(storeB)).commitSeq
  const dup = await holderB.receive(out.envelope, T0 + 30 * DAY)
  assert.equal(dup.disposition, 'duplicate-known')
  assert.equal(jcs(dup.outbound[0].envelope), jcs(ack.envelope))
  // the duplicate grants one hand-over: a resend entry, deadline the retention
  const [re] = (await holderB.pendingTransport(T0 + 30 * DAY)).entries
  assert.deepEqual([re.kind, re.digest, re.resend, re.notAfter], ['ack', ack.digest, true, (await read(storeB)).effects[out.digest].expiresAt])
  let deposits = 0
  assert.equal(await holderB.handOver(re, T0 + 30 * DAY, () => { deposits++; return true }), true)
  assert.equal(deposits, 1)
  assert.deepEqual((await holderB.pendingTransport(T0 + 30 * DAY)).entries, [], 'used up: one hand-over, no new retries')
  assert.equal(await holderB.handOver(re, T0 + 30 * DAY, () => { deposits++; return true }), false)
  assert.equal(deposits, 1)
  assert.equal((await read(storeB)).effects[out.digest].ack.sentBy, 'horizon')
  assert.ok(BigInt((await read(storeB)).commitSeq) - BigInt(seq) <= 1n, 'the duplicate commits nothing but lastWhen')
  // after the retention the effect and its ack leave together (tick)
  await holderB.tick(T0 + 1 + ENGINE_DEFAULTS.retentionMs)
  assert.equal(Object.hasOwn((await read(storeB)).effects, out.digest), false)
})

test('custody: pendingTransport names documents first (by due time, then digest), then the unsent acks; deep-frozen entries', async () => {
  const { holderA, holderB } = await pair()
  const fromB = (await holderB.act('note.send', {}, T0)).outbound[0]
  const ack = (await holderA.receive(fromB.envelope, T0 + 1)).outbound[0]
  const own = (await holderA.act('note.send', {}, T0 + 2)).outbound[0]
  await holderA.resume(T0 + 2)
  const v = await holderA.pendingTransport(T0 + 2)
  assert.deepEqual(v.entries.map((e) => [e.kind, e.digest]), [['document', own.digest], ['ack', ack.digest]])
  assert.ok(Object.isFrozen(v) && Object.isFrozen(v.entries) && Object.isFrozen(v.entries[0].envelope))
  assert.equal(v.entries[1].type, 'https://real-life.org/trust-tasks/delivery-ack/0.1')
})

// ── Astra review 1 on #115: the counter-probes ─────────────────────────

test('hand-over (#115 R1-1): the check and the start of the deposit are one step of the holder — a report committed while the check reads the store is not overtaken', async () => {
  const p = await pair()
  class SlowStore extends InMemoryStore {
    constructor () { super(); this.hold = null }
    async read () { const r = await super.read(); if (this.hold) await this.hold; return r }
  }
  const store = new SlowStore()
  await store.commit(null, (await p.storeA.read()).state)
  const holder = await createHolder({ store, keys: p.A.keys }, { modules: [noteModule()] })
  const out = (await holder.act('note.send', {}, T0)).outbound[0]
  await holder.resume(T0)
  const [e] = (await holder.pendingTransport(T0)).entries
  let release; store.hold = new Promise((r) => { release = r })
  let started = 0
  const go = holder.handOver(e, T0 + 1, () => { started++; return true })
  const rep = holder.report({ digest: out.digest, status: 'failed', reason: 'oversize' }, T0 + 1)
  store.hold = null; release()
  assert.equal(await go, true, 'the check ran first, the deposit started inside it')
  await rep
  assert.equal(started, 1)
  assert.equal(await holder.handOver(e, T0 + 2, () => { started++; return true }), false, 'after the failure no further start')
  assert.equal(started, 1)
  // start declining (the adapter's own re-check) means no hand-over
  const p2 = await sent()
  await p2.holderA.resume(T0)
  const [e2] = (await p2.holderA.pendingTransport(T0)).entries
  assert.equal(await p2.holderA.handOver(e2, T0, () => false), false)
})

test('hand-over (#115 R1-4): a resume that fails while settling an earlier commit withdraws the authority too', async () => {
  const p = await pair()
  class Store extends InMemoryStore {
    constructor () { super(); this.throwCommit = false; this.failReads = 0 }
    async read () { if (this.failReads > 0) { this.failReads--; throw new Error('read failure') } return super.read() }
    async commit (v, n) { const r = await super.commit(v, n); if (this.throwCommit) { this.throwCommit = false; throw new Error('lost answer') } return r }
  }
  const store = new Store()
  await store.commit(null, (await p.storeA.read()).state)
  const holder = await createHolder({ store, keys: p.A.keys }, { modules: [noteModule()] })
  const out = (await holder.act('note.send', {}, T0)).outbound[0]
  await holder.resume(T0)
  const [e] = (await holder.pendingTransport(T0)).entries
  store.throwCommit = true
  await assert.rejects(holder.report({ digest: out.digest, status: 'awaiting-transport', reason: 'offline' }, T0 + 1), (x) => x.code === 'unknown-commit-outcome')
  store.failReads = 1
  await assert.rejects(holder.resume(T0 + 2), (x) => x.code === 'store-read')
  assert.deepEqual(await holder.pendingTransport(T0 + 2), { ok: false, code: 'not-resumed' })
  assert.equal(await holder.mayHandOver(e, T0 + 2), false)
  await holder.resume(T0 + 3)
  assert.equal((await holder.pendingTransport(T0 + 3)).ok, true)
})

// ── Astra review 2 on #115 ─────────────────────────────────────────────

test('hand-over (#115 R2-1): a close() between the store read and start() stops the start', async () => {
  const p = await pair()
  let holder = null
  class Store extends InMemoryStore {
    constructor () { super(); this.closeOnRead = false }
    async read () {
      const r = await super.read()
      if (this.closeOnRead) { this.closeOnRead = false; queueMicrotask(() => holder.close()) }
      return r
    }
  }
  const store = new Store()
  await store.commit(null, (await p.storeA.read()).state)
  holder = await createHolder({ store, keys: p.A.keys }, { modules: [noteModule()] })
  await holder.act('note.send', {}, T0)
  await holder.resume(T0)
  const [e] = (await holder.pendingTransport(T0)).entries
  let started = 0
  store.closeOnRead = true
  const yes = await holder.handOver(e, T0, () => { started++; return true })
  assert.equal(holder.closed, true)
  assert.deepEqual([yes, started], [false, 0])
})

test('hand-over (#115 R2-2): the holder\'s time never runs back — a when before lastWhen reads at lastWhen, in the view and at the gate', async () => {
  const { holderA, storeA } = await sent()
  await holderA.resume(T0)
  const [e] = (await holderA.pendingTransport(T0)).entries
  await holderA.tick(e.notAfter + 1)
  assert.ok((await read(storeA)).lastWhen > e.notAfter)
  const v = await holderA.pendingTransport(T0 + 1)
  assert.deepEqual([v.at, v.entries], [e.notAfter + 1, []])
  let started = 0
  assert.equal(await holderA.handOver(e, T0 + 1, () => { started++; return true }), false)
  assert.equal(await holderA.mayHandOver(e, T0 + 1), false)
  assert.equal(started, 0)
})
