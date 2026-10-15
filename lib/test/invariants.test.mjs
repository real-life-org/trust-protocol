#!/usr/bin/env node
// invariants (lib Stage 2, PR 5; note §4.7): the predicates of
// invariants.ts on their own, the runtime check of createHolder({invariants:
// true}), and the property-based generator (invariants-fixture.mjs) on
// seeds 1–3 and one run with restarts and lost commit answers; the other
// seeds run in invariants-generator.test.mjs, in parallel.
//
// INV_SWEEP=<from>-<to>[:steps] runs a long sweep over many seeds instead
// of the fixed ones (a diagnosis aid, not part of npm test): plain, and
// with restarts and lost answers, alternating.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { seedKeys, createHolder, InfraError } from '../dist/index.js'
import { InMemoryStore, stateBuilder, stateViolations, transitionViolations, commitViolations } from '../dist/testing.js'
import { T0, run, stats } from './invariants-fixture.mjs'

// ── the predicates on their own ────────────────────────────────────────

test('invariants: a valid state holds them all; each predicate names what broke', () => {
  const s = stateBuilder({ at: T0 })
    .relationship('r1', { contactId: 'c1', tuples: [{ ownPairLabel: 'pair/i1', counterpartAnchor: 'did:key:zI1', counterpartKeyAgreement: 'z6LSi1', rkid: 'z6LSowni1' }] })
    .entry('c1').build()
  assert.deepEqual(stateViolations(s), [])
  const names = (v) => [...new Set(v.map((x) => x.invariant))].sort()
  const broken = structuredClone(s)
  broken.relationships.r1.tuples[0].entryId = 'ghost'
  broken.relationships.r1.tuples[0].starOut.inflight['3'] = { view: [], viewDigest: 'x', digests: [], acked: [] }
  broken.relationships.r1.tuples[0].starIn = { hwm: '4', lowerBound: '2', assembly: { salt: '3', chunks: {} }, accepted: null }
  broken.relationships.r1.bindings = { 'did:key:zA': ['b', 'a'] }
  broken.duties['class-on:anchorMapping:r1'] = { kind: 'class-on', v: 1, id: 'class-on:anchorMapping:r1', contactId: 'c1', relId: 'r1', cls: 'anchorMapping' }
  assert.deepEqual(names(stateViolations(broken)), ['assembly', 'bindings', 'duties', 'entries', 'salts'])
  // over a commit
  const next = structuredClone(s)
  next.commitSeq = '1'
  assert.deepEqual(transitionViolations(s, next, { kind: 'resume' }), [])
  const bad = structuredClone(next)
  bad.register.labels = []
  bad.lastWhen = -1
  bad.effects.uX = { ack: null, expiresAt: T0 }
  assert.deepEqual(names(transitionViolations(s, bad, { kind: 'act', command: 'x' })), ['commitSeq', 'effects', 'register'])
  assert.deepEqual(names(commitViolations(s, { ...bad, commitSeq: '0' }, { kind: 'tick' })), ['commitSeq', 'effects', 'register'])
  // accepted only through a report; a duty leaves only by a rule
  const withItem = structuredClone(next)
  withItem.outbox.uD = { type: 't', threadId: 'th', recipient: { contactId: 'c1', rkid: 'z6LSowni1', keyAgreement: 'z6LSi1' }, envelope: { rkid: 'z6LSi1', epk: 'e', nonce: 'n', ciphertext: 'c' }, attempt: 1, history: [{ status: 'submitted', at: T0, attempt: 1 }] }
  withItem.duties.m = { kind: 'merge', v: 1, id: 'm', entryIds: ['c1', 'c2'], relId: 'r1', witness: { heads: {}, superseded: {} } }
  const acc = structuredClone(withItem)
  acc.commitSeq = '2'
  acc.outbox.uD.history.push({ status: 'accepted', at: T0 })
  delete acc.duties.m
  assert.deepEqual(transitionViolations(withItem, acc, { kind: 'report', status: 'accepted' }).map((x) => x.invariant), ['duties'])
  assert.deepEqual(names(transitionViolations(withItem, acc, { kind: 'act', command: 'x' })), ['duties', 'outbox'])
  assert.deepEqual(transitionViolations(withItem, acc, { kind: 'resume', fulfilled: ['m'] }).map((x) => x.invariant), ['outbox'])
})

test('invariants: on for a relationship means out there or owed there (2850); duties merged at a chaining may leave (6596); a held head moves along links only', () => {
  const s = stateBuilder({ at: T0 })
    .relationship('r1', { contactId: 'c1', tuples: [{ ownPairLabel: 'pair/o1', counterpartAnchor: 'did:key:zO1', counterpartKeyAgreement: 'z6LSo1', rkid: 'z6LSowno1' }] })
    .entry('c1').settings('c1', { anchorMapping: 'on' }).build()
  assert.deepEqual(stateViolations(s).map((x) => [x.invariant, x.detail]), [['owed', 'r1: the anchorMapping class is on for it, nothing is out there and no duty owes it (2850)']])
  const owed = structuredClone(s)
  owed.duties['class-on:anchorMapping:r1'] = { kind: 'class-on', v: 1, id: 'class-on:anchorMapping:r1', contactId: 'c1', relId: 'r1', cls: 'anchorMapping' }
  assert.deepEqual(stateViolations(owed), [])
  const out = structuredClone(s)
  out.relationships.r1.tuples[0].mappingOut = { rev: '1', body: { revision: '1' }, underAnchor: 'did:key:zU' }
  assert.deepEqual(stateViolations(out), [])
  // the profile, once one exists, stays owed until PR 6 delivers it
  const prof = structuredClone(out)
  prof.profile = { body: { name: 'P' }, revision: '1' }
  assert.deepEqual(stateViolations(prof).map((x) => x.invariant), ['owed'])
  // two re-issues on one relationship become one (6596): the other may leave
  const two = structuredClone(owed)
  two.duties.ra = { kind: 'reissue-mapping', v: 1, id: 'ra', contactId: 'c1', relId: 'r1', awaitHead: null }
  two.duties.rb = { kind: 'reissue-mapping', v: 1, id: 'rb', contactId: 'c1', relId: 'r1', awaitHead: null }
  const one = structuredClone(two)
  one.commitSeq = '1'
  delete one.duties.rb
  assert.deepEqual(transitionViolations(two, one, { kind: 'receive', disposition: 'unique' }), [])
  delete one.duties.ra
  assert.deepEqual(transitionViolations(two, one, { kind: 'receive', disposition: 'unique' }).map((x) => x.detail), ['ra (reissue-mapping) disappeared by receive without a rule', 'rb (reissue-mapping) disappeared by receive without a rule'])
  // a held head moves only along the links the relationship holds (6150, 6170)
  const h0 = structuredClone(owed)
  h0.relationships.r1.heldCounterpartHead = 'did:key:zH1'
  const h1 = structuredClone(h0)
  h1.commitSeq = '1'
  h1.relationships.r1.heldCounterpartHead = 'did:key:zH2'
  assert.deepEqual(transitionViolations(h0, h1, { kind: 'receive', disposition: 'unique' }).map((x) => x.invariant), ['bindings'])
  h1.relationships.r1.links = [{ prev: 'did:key:zH1', next: 'did:key:zH2' }]
  assert.deepEqual(transitionViolations(h0, h1, { kind: 'receive', disposition: 'unique' }), [])
})

test('invariants: a duty leaves only by fulfilment, a drop rule, a merge that keeps its urgency, the same delivery or a received end — every illegal drop is named (dutyDrops)', () => {
  const PROBE = 'https://real-life.org/trust-tasks/continuity-probe/0.1'
  const base = stateBuilder({ at: T0 })
    .relationship('r1', { contactId: 'c1', tuples: [{ ownPairLabel: 'pair/d1', counterpartAnchor: 'did:key:zD1', counterpartKeyAgreement: 'z6LSd1', rkid: 'z6LSownd1' }] })
    .entry('c1').settings('c1', { anchorMapping: 'on' }).with((x) => { x.profile = { body: { name: 'P' }, revision: '3' } })
    .duty({ kind: 'class-on', v: 1, id: 'class-on:anchorMapping:r1', contactId: 'c1', relId: 'r1', cls: 'anchorMapping' })
    .duty({ kind: 'reissue-mapping', v: 1, id: 'ra', contactId: 'c1', relId: 'r1', awaitHead: null })
    .duty({ kind: 'reissue-mapping', v: 1, id: 'rb', contactId: 'c1', relId: 'r1', awaitHead: 'did:key:zWait', dueAt: T0 + 5 })
    .duty({ kind: 'profile', v: 1, id: 'p2', contactId: 'c1', relId: 'r1', rev: '2' })
    .duty({ kind: 'profile', v: 1, id: 'p3', contactId: 'c1', relId: 'r1', rev: '3' })
    .duty({ kind: 'continuity', v: 1, id: 'cp', relId: 'r1', tuple: 'pair/d1', step: 'probe' })
    .duty({ kind: 'merge', v: 1, id: 'm', entryIds: ['c1', 'c9'], relId: 'r1', witness: { heads: {}, superseded: {} } })
    .duty({ kind: 'from-the-future', v: 7, id: 'u', relId: 'r1' })
    .with((x) => {
      x.outbox.uProbe = { type: PROBE, threadId: 'th', recipient: { contactId: 'c1', rkid: 'z6LSownd1', keyAgreement: 'z6LSd1' }, envelope: { rkid: 'z6LSd1', epk: 'e', nonce: 'n', ciphertext: 'c' }, attempt: 1, history: [{ status: 'submitted', at: T0, attempt: 1 }] }
    })
    .build()
  const without = (...ids) => { const a = structuredClone(base); a.commitSeq = '1'; for (const id of ids) delete a.duties[id]; return a }
  const dropped = (a, op) => transitionViolations(base, a, op).filter((x) => x.invariant === 'duties').map((x) => x.detail.split(' ')[0]).sort()
  // unknown kinds never leave on any operation (only a registered handler's run could)
  assert.deepEqual(dropped(without('u'), { kind: 'resume', fulfilled: [] }), ['u'])
  assert.deepEqual(dropped(without('u'), { kind: 'act', command: 'trust.depart' }), ['u'])
  assert.deepEqual(dropped(without('u'), { kind: 'receive', disposition: 'unique', ref: 'uProbe' }), ['u'])
  // resume: only what its handler fulfilled; no blanket allowance
  assert.deepEqual(dropped(without('class-on:anchorMapping:r1', 'm'), { kind: 'resume', fulfilled: [] }), ['class-on:anchorMapping:r1', 'm'])
  assert.deepEqual(dropped(without('class-on:anchorMapping:r1', 'm'), { kind: 'resume', fulfilled: ['class-on:anchorMapping:r1', 'm'] }), [])
  // a merge duty never leaves outside its own run
  assert.deepEqual(dropped(without('m'), { kind: 'act', command: 'trust.merge' }), ['m'])
  // (c) merged with its urgency kept: the waiting, later re-issue may go into the one due at once, not the other way
  assert.deepEqual(dropped(without('rb'), { kind: 'receive', disposition: 'unique' }), [])
  assert.deepEqual(dropped(without('ra'), { kind: 'receive', disposition: 'unique' }), ['ra'])
  // a profile duty only into one of no lower revision
  assert.deepEqual(dropped(without('p2'), { kind: 'receive', disposition: 'unique' }), [])
  assert.deepEqual(dropped(without('p3'), { kind: 'receive', disposition: 'unique' }), ['p3'])
  // (b) the class off toward the entry drops its duties, and only those
  const off = without('class-on:anchorMapping:r1', 'ra', 'rb', 'p2', 'p3')
  off.contacts.c1.settings.anchorMapping = 'off'
  assert.deepEqual(dropped(off, { kind: 'act', command: 'trust.set' }), [], 'the profile follows the anchor mapping off (2840)')
  // (b) the relationship departed: its known duties go, the unknown one stays
  const gone = without('class-on:anchorMapping:r1', 'ra', 'rb', 'p2', 'p3', 'cp')
  delete gone.relationships.r1; delete gone.contacts.c1
  assert.deepEqual(dropped(gone, { kind: 'act', command: 'trust.depart' }), [])
  // (d) the anchor mapping issued on the relationship meets its class-on and re-issues
  const issued = without('class-on:anchorMapping:r1', 'ra', 'rb', 'x')
  issued.relationships.r1.tuples[0].mappingOut = { rev: '1', body: { revision: '1' }, underAnchor: 'did:key:zU' }
  delete issued.duties.x
  const fulfilled = { kind: 'resume', fulfilled: ['ra'] }
  assert.deepEqual(dropped(issued, fulfilled), [])
  assert.deepEqual(dropped(without('class-on:anchorMapping:r1', 'ra'), fulfilled), ['class-on:anchorMapping:r1'], 'without an issuance the class-on stays owed')
  // (e) a continuity duty leaves on receive only with what ends its flow
  assert.deepEqual(dropped(without('cp'), { kind: 'receive', disposition: 'unique', type: 'https://real-life.org/trust-tasks/star/0.2', rkid: 'z6LSownd1' }), ['cp'])
  assert.deepEqual(dropped(without('cp'), { kind: 'receive', disposition: 'unique', type: 'https://real-life.org/trust-tasks/delivery-ack/0.1', ref: 'uProbe' }), [])
  assert.deepEqual(dropped(without('cp'), { kind: 'report', status: 'failed' }), ['cp'])
})

test('invariants: createHolder({invariants: true}) checks every commit before its CAS — a violation throws InfraError invariant-violated and nothing commits', async () => {
  const store = new InMemoryStore()
  await store.commit(null, stateBuilder({ at: T0 }).build())
  const breaker = {
    name: 'breaker',
    commands: {
      'breaker.forget': { human: false, apply: (state) => ({ state: { ...state, register: { ...state.register, labels: [] } } }) },
      'breaker.learn': { human: false, apply: (state) => ({ state: { ...state, register: { ...state.register, labels: [...state.register.labels, 'pair/x'] } } }) },
    },
  }
  const h = await createHolder({ store, keys: seedKeys(new Uint8Array(64).fill(3)) }, { modules: [breaker], invariants: true })
  assert.equal((await h.act('breaker.learn', {}, T0)).ok, true)
  const before = await store.read()
  await assert.rejects(h.act('breaker.forget', {}, T0 + 1), (e) => e instanceof InfraError && e.code === 'invariant-violated' && /\[register\] labels lost/.test(e.message) && Array.isArray(e.cause))
  assert.deepEqual(await store.read(), before, 'nothing committed')
  // without the option nothing is checked
  const h2 = await createHolder({ store, keys: seedKeys(new Uint8Array(64).fill(3)) }, { modules: [breaker] })
  assert.equal((await h2.act('breaker.forget', {}, T0 + 2)).ok, true)
})

// ── the generator ──────────────────────────────────────────────────────

if (process.env.INV_SWEEP) {
  const [range, n] = process.env.INV_SWEEP.split(':')
  const [from, to] = range.split('-').map(Number)
  test(`invariants: sweep ${range}`, async () => {
    const events = {}
    const counters = {}
    for (let seed = from; seed <= to; seed++) {
      const w = await run(seed, { steps: Number(n ?? 300), restarts: seed % 2 === 0, lossy: seed % 2 === 0 })
      for (const [k, x] of Object.entries(w.events)) events[k] = (events[k] ?? 0) + x
      for (const [k, x] of Object.entries(w.counters)) counters[k] = (counters[k] ?? 0) + x
    }
    console.log('sweep events', JSON.stringify(events), JSON.stringify(counters))
  })
} else {
  for (const seed of [1, 2, 3]) {
    test(`invariants: generator, seed ${seed} — 220 random steps over three holders, every invariant after each`, async () => {
      const w = await run(seed)
      if (process.env.INV_DEBUG) console.log(seed, JSON.stringify(w.counters), JSON.stringify(await stats(w)))
      assert.ok((w.counters.receive ?? 0) + (w.counters.flush ?? 0) > 20 && w.counters.act > 20, `the run exercised the holders: ${JSON.stringify(w.counters)}`)
      assert.ok(Object.keys(w.events).length >= 6, `the run reached the trust layer: ${JSON.stringify(w.events)}`)
    })
  }
  test('invariants: generator with restarts and lost commit answers, seed 11', async () => {
    const w = await run(11, { restarts: true, lossy: true })
    assert.ok(w.counters.restart > 0, JSON.stringify(w.counters))
  })
}
