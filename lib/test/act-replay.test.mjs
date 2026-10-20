#!/usr/bin/env node
// act-replay (lib 0.6.1): replay(actId, when), the pure read of the act
// journal (note §4.2), and the rule "one actId, one result" for every human
// act: a repeat under a journaled actId answers the journaled result, at
// any clock, across a lock and a new opening, and never mints a second mid.
//
//   replay before and after the commit, with an unknown actId
//   the clock moved ahead and set back, inside the journal's retention
//   a lock (close) and a new opening, keys that answer nothing
//   the cells interleaved with the act itself: a replay while the act waits
//   in its preparation on another opening, a replay racing close() (the
//   lock), a replay after the process ended with the commit's outcome
//   unknown (landed or not)
//   review 421 R10-1 as a lib test: the journal past its retention under a
//   clock set wrongly ahead, then set back — replay answers unknown-act and
//   mints nothing
//   the other human acts: show, scan, block, unblock, trust
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHolder, seedKeys, digestBytes, InfraError } from '../dist/index.js'
import { MESSAGE_TYPE } from '../dist/message.js'
import { InMemoryStore, stateBuilder } from '../dist/testing.js'
import { T0, ev, opts, met, person, communityPerson } from './holder-fixture.mjs'

const DAY = 86_400_000
const RETENTION = 90 * DAY

/** A store that logs every committed state; `fault` makes the next commit
 *  throw after it landed ('landed') or before ('lost'). */
class LogStore extends InMemoryStore {
  constructor () { super(); this.log = []; this.fault = null }
  async commit (version, next) {
    const f = this.fault
    if (f === 'lost') { this.fault = null; this.attempted = structuredClone(next); throw new Error('storage gone before the write') }
    const r = await super.commit(version, next)
    if (r.ok) this.log.push(structuredClone(next))
    if (f === 'landed' && r.ok) { this.fault = null; throw new Error('storage gone after the write') }
    return r
  }
}

/** Keys whose agree can be paused once, at its next call after arming. */
function gatedKeys (keys) {
  let armed = null
  return {
    keys: {
      anchorOf: (...a) => keys.anchorOf(...a),
      sign: (...a) => keys.sign(...a),
      carrierPrincipal: (...a) => keys.carrierPrincipal(...a),
      agree: async (...a) => {
        if (armed) { const w = armed; armed = null; w.hit(); await w.go }
        return keys.agree(...a)
      },
    },
    arm () {
      let hit, release
      const reached = new Promise((r) => { hit = r })
      const go = new Promise((r) => { release = r })
      armed = { hit, go }
      return { reached, release }
    },
  }
}

/** Keys that answer nothing: every call rejects (a locked key store). */
const deadKeys = new Proxy({}, { get: () => async () => { throw new Error('keys locked') } })

/** A (a community person over a LogStore, two openings A1 gated and A2) met B. */
async function scene (fa, fb) {
  const store = new LogStore()
  const genesis = await digestBytes(new Uint8Array(32).fill(fa ^ 0x5a))
  await store.commit(null, stateBuilder({ at: T0 }).community(genesis, '1').build())
  const seed = new Uint8Array(64).fill(fa)
  const keys = seedKeys(seed)
  const gate = gatedKeys(keys)
  const A = await person(fa, { store })
  const B = await communityPerson(fb)
  const { a, b } = await met(A, B)
  const open = (k = keys) => createHolder({ store, keys: k }, { invariants: true })
  return { A, B, a, b, store, keys, gate, open, read: async () => (await store.read()).state }
}

/** Every message.sent mid any committed state ever journaled, and every message outbox digest. */
function mintedOf (log) {
  const mids = new Set(), docs = new Set()
  for (const s of log) {
    for (const r of Object.values(s.acts)) for (const e of r.events) if (e.type === 'message.sent') mids.add(e.mid)
    for (const [d, it] of Object.entries(s.outbox)) if (it.type === MESSAGE_TYPE) docs.add(d)
  }
  return { mids: [...mids], docs: [...docs] }
}

const sentOf = (r) => ev(r, 'message.sent')[0]

test('replay: an unknown actId is unknown-act, an empty one actid-missing; a replay commits nothing, lastWhen included', async () => {
  const { A, read } = await scene(0x61, 0x62)
  const before = await read()
  assert.deepEqual(await A.h.replay('never-acted', before.lastWhen + DAY), { ok: false, code: 'unknown-act' })
  assert.deepEqual(await A.h.replay('', T0), { ok: false, code: 'actid-missing' })
  await assert.rejects(A.h.replay('x', -1), TypeError)
  const after = await read()
  assert.equal(after.commitSeq, before.commitSeq)
  assert.equal(after.lastWhen, before.lastWhen, 'a replay never raises the mark')
})

test('replay after the commit: the journaled result — mid, digest, the commit time; a repeat of sendMessage under the actId answers the same and adds nothing', async () => {
  const { A, a, store } = await scene(0x63, 0x64)
  const t = T0 + 10_000_500
  const sent = await A.h.sendMessage(a.id, 'once', { when: t, actId: 'm-1' })
  const e = sentOf(sent)
  const r = await A.h.replay('m-1', t + 1000)
  assert.equal(r.ok, true)
  assert.equal(r.result.actId, 'm-1')
  assert.equal(r.result.at, t)
  assert.deepEqual(r.result.events, sent.events)
  assert.deepEqual(r.result.outbound, [{ digest: sent.outbound[0].digest, live: true }])
  assert.equal(sentOf(r.result).mid, e.mid)
  assert.ok(Object.isFrozen(r.result.events[0]), 'deep-frozen')
  const again = await A.h.sendMessage(a.id, 'once', { when: t + 2000, actId: 'm-1' })
  assert.equal(sentOf(again).mid, e.mid)
  assert.deepEqual(again.outbound.map((o) => o.digest), [e.digest])
  assert.deepEqual(mintedOf(store.log), { mids: [e.mid], docs: [e.digest] })
})

test('replay across the clock: ahead and set back inside the retention, the same mid; a repeat never mints a second one; the journal ends at its retention in holder time', async () => {
  const { A, a, store } = await scene(0x65, 0x66)
  const t = T0 + 10_000_000
  const sent = await A.h.sendMessage(a.id, 'clock', { when: t, actId: 'm-2' })
  const mid = sentOf(sent).mid
  // set back before the act: the holder's time never runs back
  assert.equal(sentOf((await A.h.replay('m-2', t - 5 * DAY)).result).mid, mid)
  assert.equal(sentOf(await A.h.sendMessage(a.id, 'clock', { when: t - 5 * DAY, actId: 'm-2' })).mid, mid)
  // ahead past the horizon: tick and resume give the document up
  await A.h.tick(t + 10 * DAY); await A.h.resume(t + 10 * DAY)
  const ahead = await A.h.replay('m-2', t + 10 * DAY)
  assert.equal(sentOf(ahead.result).mid, mid)
  assert.deepEqual(ahead.result.outbound, [{ digest: sent.outbound[0].digest, live: false }])
  // and back again
  const back = await A.h.sendMessage(a.id, 'clock', { when: t + DAY, actId: 'm-2' })
  assert.equal(sentOf(back).mid, mid)
  assert.deepEqual(back.outbound, [], 'given up: never handed out again')
  // the retention runs from the document's last step (its give-up at
  // t + 10 days here): its last instant, ticked, still the act
  const end = t + 10 * DAY + RETENTION
  await A.h.tick(end - 1)
  assert.equal(sentOf((await A.h.replay('m-2', end - 1)).result).mid, mid)
  // its end, ticked: unknown — the bound, documented; replay mints nothing
  await A.h.tick(end)
  assert.deepEqual(await A.h.replay('m-2', t), { ok: false, code: 'unknown-act' })
  assert.deepEqual(mintedOf(store.log).mids, [mid])
})

test('replay across a lock: close, a new opening over the same store, keys that answer nothing — the same result; the repeat runs nothing', async () => {
  const { A, a, store, open } = await scene(0x67, 0x68)
  const t = T0 + 10_000_000
  const sent = await A.h.sendMessage(a.id, 'locked', { when: t, actId: 'm-3' })
  await A.h.close()
  await assert.rejects(A.h.replay('m-3', t), (e) => e instanceof InfraError && e.code === 'closed')
  const L = await open(deadKeys)
  const r = await L.replay('m-3', t + 1000)
  assert.deepEqual(r.result.events, sent.events)
  const again = await L.sendMessage(a.id, 'locked', { when: t + 2000, actId: 'm-3' })
  assert.equal(again.ok, true, 'a journaled act needs no keys')
  assert.deepEqual(again.events, sent.events)
  await L.close()
  const N = await open()
  assert.deepEqual((await N.replay('m-3', t + 3000)).result.events, sent.events)
  assert.deepEqual(mintedOf(store.log).mids, [sentOf(sent).mid])
})

test('replay interleaved: before the commit (the act waits in its preparation on another opening) unknown-act; after it the result; queued behind the act on its own opening the result', async () => {
  const { a, store, gate, open } = await scene(0x69, 0x6a)
  const A1 = await open(gate.keys)
  const A2 = await open()
  const t = T0 + 10_000_000
  const g = gate.arm()
  const p = A1.sendMessage(a.id, 'raced', { when: t, actId: 'm-4' })
  await g.reached
  assert.deepEqual(await A2.replay('m-4', t), { ok: false, code: 'unknown-act' }, 'before the commit')
  const queued = A1.replay('m-4', t)
  g.release()
  const sent = await p
  assert.equal(sentOf((await queued).result).mid, sentOf(sent).mid, 'the same opening: queued behind the act')
  assert.equal(sentOf((await A2.replay('m-4', t)).result).mid, sentOf(sent).mid, 'after the commit')
  assert.deepEqual(mintedOf(store.log).mids, [sentOf(sent).mid])
})

test('interleaving cell "replay during the lock": an act running when close() is called completes; a replay after the call rejects closed; the next opening answers the act once', async () => {
  const { a, store, gate, open } = await scene(0x6b, 0x6c)
  const A1 = await open(gate.keys)
  const t = T0 + 10_000_000
  const g = gate.arm()
  const p = A1.sendMessage(a.id, 'lock', { when: t, actId: 'm-5' })
  await g.reached
  const late = A1.replay('m-5', t)     // queued before the lock
  const closing = A1.close()
  await assert.rejects(A1.replay('m-5', t), (e) => e instanceof InfraError && e.code === 'closed')
  g.release()
  const sent = await p
  await assert.rejects(late, (e) => e instanceof InfraError && e.code === 'closed', 'queued, then locked: not run')
  await closing
  const N = await open()
  const r = await N.replay('m-5', t + 1000)
  assert.equal(sentOf(r.result).mid, sentOf(sent).mid)
  assert.equal(sentOf(await N.sendMessage(a.id, 'lock', { when: t + 2000, actId: 'm-5' })).mid, sentOf(sent).mid)
  assert.deepEqual(mintedOf(store.log).mids, [sentOf(sent).mid])
})

test('interleaving cell "replay after the process ended": the commit landed but its answer was lost — the next opening replays the act; lost before the write — unknown-act, and the act runs once', async () => {
  const { a, store, open } = await scene(0x6d, 0x6e)
  const t = T0 + 10_000_000
  const P1 = await open()
  store.fault = 'landed'
  await assert.rejects(P1.sendMessage(a.id, 'landed', { when: t, actId: 'm-6' }), (e) => e instanceof InfraError && e.code === 'unknown-commit-outcome')
  // the process ends here: no close, no settling
  const P2 = await open()
  const r = await P2.replay('m-6', t + 1000)
  assert.equal(r.ok, true)
  const mid = sentOf(r.result).mid
  assert.equal(sentOf(await P2.sendMessage(a.id, 'landed', { when: t + 2000, actId: 'm-6' })).mid, mid)
  store.fault = 'lost'
  await assert.rejects(P2.sendMessage(a.id, 'lost', { when: t + 3000, actId: 'm-7' }), (e) => e instanceof InfraError && e.code === 'unknown-commit-outcome')
  const P3 = await open()
  assert.deepEqual(await P3.replay('m-7', t + 4000), { ok: false, code: 'unknown-act' }, 'never committed')
  const first = await P3.sendMessage(a.id, 'lost', { when: t + 5000, actId: 'm-7' })
  assert.equal(sentOf((await P3.replay('m-7', t + 6000)).result).mid, sentOf(first).mid)
  assert.deepEqual(mintedOf(store.log).mids, [mid, sentOf(first).mid])
})

test('review 421 R10-1: the journal past its retention under a clock set wrongly ahead, then the clock set back and a new opening — replay answers unknown-act and mints nothing; the app must not repeat the act blind', async () => {
  const { A, a, store, open } = await scene(0x6f, 0x70)
  const t = T0 + 10_000_000
  const sent = await A.h.sendMessage(a.id, 'exactly one human gesture', { when: t, actId: 'm-8' })
  await A.h.resume(t + 8 * DAY)    // given up at the horizon
  await A.h.tick(t + 8 * DAY + 91 * DAY)
  await A.h.close()
  const N = await open()
  await N.resume(t + DAY)          // the clock set back
  const seq = (await store.read()).state.commitSeq
  assert.deepEqual(await N.replay('m-8', t + DAY), { ok: false, code: 'unknown-act' })
  assert.equal((await store.read()).state.commitSeq, seq, 'nothing committed')
  assert.deepEqual(mintedOf(store.log).mids, [sentOf(sent).mid], 'no second mid')
})

test('one actId, one result, for the other human acts: show, scan, setProfile, foundGroup, block, unblock, trust — replay and a repeat answer the journaled events and commit nothing', async () => {
  const A = await communityPerson(0x71), B = await communityPerson(0x72)
  const shown = await B.h.show({ when: T0, actId: 's-1', name: 'Bea' })
  const card = ev(shown, 'encounter.shown')[0].card
  const scan = await A.h.scan(card, { when: T0 + 1000, actId: 'c-1', name: 'Al' })
  const prof = await A.h.setProfile({ name: 'Al' }, { when: T0 + 4000, actId: 'p-1' })
  const grp = await A.h.foundGroup({ name: 'Stall' }, { when: T0 + 5000, actId: 'g-1' })
  assert.equal(prof.ok && grp.ok, true)
  assert.deepEqual((await A.h.setProfile({ name: 'Al' }, { when: T0 + 6000, actId: 'p-1' })).events, prof.events)
  assert.deepEqual((await A.h.foundGroup({ name: 'Stall' }, { when: T0 + 7000, actId: 'g-1' })).events, grp.events)
  for (const [P, id, r] of [[B, 's-1', shown], [A, 'c-1', scan], [A, 'p-1', prof], [A, 'g-1', grp]]) {
    const seq = (await P.read()).commitSeq
    assert.deepEqual((await P.h.replay(id, T0 + 5 * DAY)).result.events, r.events)
    assert.equal((await P.read()).commitSeq, seq)
  }
  assert.deepEqual((await B.h.show({ when: T0 + 2000, actId: 's-1', name: 'Bea' })).events, shown.events)
  assert.deepEqual((await A.h.scan(card, { when: T0 + 3000, actId: 'c-1', name: 'Al' })).events, scan.events)
  const C = await communityPerson(0x73), D = await communityPerson(0x74)
  const { a } = await met(C, D)
  const t = T0 + 10_000_000
  const acts = [
    ['k-1', () => C.h.block(a.id, { when: t, actId: 'k-1' })],
    ['k-2', () => C.h.unblock(a.id, { when: t + 1000, actId: 'k-2' })],
    ['k-3', () => C.h.trust(a.id, { when: t + 2000, actId: 'k-3' })],
  ]
  for (const [id, run] of acts) {
    const first = await run()
    assert.equal(first.ok, true, JSON.stringify(first))
    const seq = (await C.read()).commitSeq
    assert.deepEqual((await C.h.replay(id, t)).result.events, first.events)
    assert.deepEqual((await run()).events, first.events, 'the repeat answers the journal')
    assert.equal((await C.read()).commitSeq, seq, 'and commits nothing')
  }
  // the same actId under another input is a conflict, not a second act
  assert.deepEqual(await C.h.block(a.id, { when: t + 3000, actId: 'k-2' }), { ok: false, code: 'actid-conflict' })
})

test('review lib-0.6.1 R1-1: an actId `__proto__` stays an own journal entry when a tick drops older ones beside it', async () => {
  const { A, a } = await scene(0x75, 0x76)
  const t = T0 + 89 * DAY
  const first = await A.h.sendMessage(a.id, 'proto', { when: t, actId: '__proto__' })
  assert.equal(first.ok, true)
  const tk = await A.h.tick(T0 + 90 * DAY + 10_000)   // the encounter's acts leave, this one stays
  assert.equal(tk.ok, true, JSON.stringify(tk))
  const r = await A.h.replay('__proto__', t)
  assert.equal(r.ok, true)
  assert.equal(sentOf(r.result).mid, sentOf(first).mid)
  assert.equal(sentOf(await A.h.sendMessage(a.id, 'proto', { when: t, actId: '__proto__' })).mid, sentOf(first).mid)
})

test('review lib-0.6.1 R1-2: the journal keeps an act as long as the completion of its documents — the retention after the last step of each, not only after the commit; a document never made terminal keeps it', async () => {
  const { A, B, a, store } = await scene(0x77, 0x78)
  const t = T0 + 10_000_000
  const sent = await A.h.sendMessage(a.id, 'kept', { when: t, actId: 'm-9' })
  const got = await B.h.receive(sent.outbound[0].envelope, t + DAY)
  await A.h.receive(got.outbound[0].envelope, t + DAY)
  assert.equal((await A.h.deliveryStatus(sent.outbound[0].digest)).items[0].status, 'delivered')
  await A.h.tick(t + RETENTION)
  assert.equal(sentOf((await A.h.replay('m-9', t)).result).mid, sentOf(sent).mid, 'delivered a day later: still journaled')
  assert.equal(sentOf(await A.h.sendMessage(a.id, 'kept', { when: t + RETENTION, actId: 'm-9' })).mid, sentOf(sent).mid)
  await A.h.tick(t + DAY + RETENTION - 1)
  assert.equal((await A.h.replay('m-9', t)).ok, true)
  await A.h.tick(t + DAY + RETENTION)
  assert.deepEqual(await A.h.replay('m-9', t), { ok: false, code: 'unknown-act' }, 'with its completion')
  // a document no resume gave up yet: the act stays past the retention
  const open = await A.h.sendMessage(a.id, 'pending', { when: t + 100 * DAY, actId: 'm-10' })
  await A.h.tick(t + 200 * DAY)
  assert.equal(sentOf((await A.h.replay('m-10', t)).result).mid, sentOf(open).mid)
  assert.deepEqual(mintedOf(store.log).mids, [sentOf(sent).mid, sentOf(open).mid])
})

test('review lib-0.6.1 R1-3: a lost commit and another opening that committed the same act at the same commitSeq — the settling announces nothing of the lost attempt', async () => {
  const { a, store, open } = await scene(0x79, 0x7a)
  const A1 = await open(), A2 = await open()
  const announced = []
  A1.subscribe((c) => announced.push(...c.events))
  const t = T0 + 10_000_000
  store.fault = 'lost'
  await assert.rejects(A1.sendMessage(a.id, 'race', { when: t, actId: 'm-11' }), (e) => e instanceof InfraError && e.code === 'unknown-commit-outcome')
  const lost = store.attempted.acts['m-11'].events.find((e) => e.type === 'message.sent').mid
  const committed = await A2.sendMessage(a.id, 'race', { when: t, actId: 'm-11' })
  assert.notEqual(sentOf(committed).mid, lost)
  assert.equal(sentOf((await A1.replay('m-11', t)).result).mid, sentOf(committed).mid)
  assert.deepEqual(announced.filter((e) => e.type === 'message.sent'), [], 'the lost attempt is not announced')
})
