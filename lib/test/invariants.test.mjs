#!/usr/bin/env node
// invariants (lib Stage 2, PR 5; note §4.7): the predicates of
// invariants.ts on their own, the runtime check of createHolder({invariants:
// true}), and the property-based generator (invariants-fixture.mjs) on
// seeds 1–3 and one run with restarts and lost commit answers; the other
// seeds run in invariants-generator.test.mjs, in parallel.
//
// INV_SWEEP=<from>-<to>[:steps] runs a long sweep over many seeds instead
// of the fixed ones (not part of npm test): plain, and with restarts and
// lost answers, alternating, every third seed with the 6596 prelude; it
// asserts what the sweep reached.
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
  // the profile, once one exists, is owed until issued at the counter's revision on the active tuple
  const prof = structuredClone(out)
  prof.profile = { body: { name: 'P' }, revision: '1' }
  assert.deepEqual(stateViolations(prof).map((x) => x.invariant), ['owed'])
  prof.relationships.r1.tuples[0].profileOut = { rev: '1' }
  assert.deepEqual(stateViolations(prof), [])
  prof.profile.revision = '2'
  assert.deepEqual(stateViolations(prof).map((x) => x.invariant), ['owed'], 'a newer revision is owed again (6455)')
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
      x.relationships.r1.tuples[0].probeOut = { seq: '1', inflight: { 1: { digests: ['uProbe'], acked: [] } }, done: false }
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
  const probeDone = without('cp'); probeDone.relationships.r1.tuples[0].probeOut = { seq: '1', inflight: {}, done: true }
  assert.deepEqual(dropped(probeDone, { kind: 'receive', disposition: 'unique', type: 'https://real-life.org/trust-tasks/delivery-ack/0.1', ref: 'uProbe' }), [])
  assert.deepEqual(dropped(without('cp'), { kind: 'report', status: 'failed' }), ['cp'])
})

test('invariants: what a salt committed stays, the baseline moves only by the completing ack, the probe completes only by its acks (5110, 5130, 5660–5680, 6830)', async () => {
  const { viewDigest } = await import('../dist/internal.js')
  const V1 = [{ member: 'c1', head: 'did:key:zH1' }]
  const V2 = [{ member: 'c1', head: 'did:key:zH2' }]
  const item = (d) => ({ type: 'https://real-life.org/trust-tasks/star/0.2', threadId: 'th', recipient: { contactId: 'c1', rkid: 'z6LSowns1', keyAgreement: 'z6LSs1' }, envelope: { rkid: 'z6LSs1', epk: 'e', nonce: 'n', ciphertext: d }, attempt: 1, history: [{ status: 'submitted', at: T0, attempt: 1 }] })
  const base = stateBuilder({ at: T0 })
    .relationship('r1', { contactId: 'c1', tuples: [{ ownPairLabel: 'pair/s1', counterpartAnchor: 'did:key:zS1', counterpartKeyAgreement: 'z6LSs1', rkid: 'z6LSowns1' }] })
    .with((x) => {
      const t = x.relationships.r1.tuples[0]
      t.starOut = { lastSalt: '2', exhausted: false, hwm: '1', snapshot: V1, snapshotDigest: viewDigest(V1), inflight: { 2: { view: V2, viewDigest: viewDigest(V2), digests: ['uA', 'uB'], acked: ['uA'] } } }
      t.probeOut = { seq: '1', inflight: { 1: { digests: ['uP'], acked: [] } }, done: false }
      x.outbox.uA = item('uA'); x.outbox.uB = item('uB'); x.outbox.uP = item('uP')
    })
    .build()
  const next = (fn) => { const a = structuredClone(base); a.commitSeq = '1'; fn(a.relationships.r1.tuples[0], a); return a }
  const broken = (a, op = { kind: 'receive', disposition: 'unique' }) => transitionViolations(base, a, op).filter((x) => ['salts', 'baseline'].includes(x.invariant)).map((x) => x.detail.replace(/^pair\/s1 \w+: /, ''))
  // the completing ack: hwm, snapshot and its digest move together to the salt's view
  const done = next((t) => { t.starOut = { ...t.starOut, hwm: '2', snapshot: V2, snapshotDigest: viewDigest(V2), inflight: {} } })
  assert.deepEqual(broken(done, { kind: 'receive', disposition: 'unique', ref: 'uB' }), [])
  assert.deepEqual(broken(done, { kind: 'report', status: 'delivered' }), ['hwm 1 → 2 without the ack that completes salt 2 (5660)'], 'an adapter report completes nothing')
  assert.deepEqual(broken(done, { kind: 'receive', disposition: 'unique', ref: 'uA' }), ['hwm 1 → 2 without the ack that completes salt 2 (5660)'], 'uB was never acked')
  const wrong = next((t) => { t.starOut = { ...t.starOut, hwm: '2', snapshot: V1, snapshotDigest: viewDigest(V1), inflight: {} } })
  assert.deepEqual(broken(wrong, { kind: 'receive', disposition: 'unique', ref: 'uB' }), ['the baseline at hwm 2 is not the view sent under it (5670)'])
  // the baseline does not change at the same hwm, by a failure report or anything else (5680)
  assert.deepEqual(broken(next((t) => { t.starOut.snapshot = V2; t.starOut.snapshotDigest = viewDigest(V2) }), { kind: 'report', status: 'failed' }), ['the baseline changed at hwm 1 without a completion (5670, 5680)'])
  // what salt 2 committed stays: its documents, its view; acked only grows
  assert.deepEqual(broken(next((t) => { t.starOut.inflight[2].digests = ['uA', 'uC'] })), ['the documents of salt 2 changed'])
  assert.deepEqual(broken(next((t) => { t.starOut.inflight[2].view = V1; t.starOut.inflight[2].viewDigest = viewDigest(V1) })), ['the view of salt 2 changed'])
  assert.deepEqual(broken(next((t) => { t.starOut.inflight[2].acked = [] })), ['acked of salt 2 shrank or left its digests'])
  // a rename rewrites members only, and only where the operation renames (2100)
  const renamed = next((t) => { const v = [{ member: 'c9', head: 'did:key:zH2' }]; t.starOut.inflight[2].view = v; t.starOut.inflight[2].viewDigest = viewDigest(v) })
  assert.deepEqual(broken(renamed, { kind: 'act', command: 'trust.depart' }), [])
  assert.deepEqual(broken(renamed, { kind: 'act', command: 'trust.setClass' }), ['the view of salt 2 changed'])
  // an in-flight entry above hwm leaves only once its documents left the outbox
  assert.deepEqual(broken(next((t) => { t.starOut.inflight = {} }), { kind: 'tick' }), ['salt 2 left in flight above hwm 1 with documents still in the outbox'])
  assert.deepEqual(broken(next((t, a) => { t.starOut.inflight = {}; delete a.outbox.uA; delete a.outbox.uB }), { kind: 'tick' }), [])
  // a new salt carries the digest of its view and nothing acked
  assert.deepEqual(broken(next((t) => { t.starOut.lastSalt = '3'; t.starOut.inflight[3] = { view: V1, viewDigest: viewDigest(V2), digests: ['uD'], acked: [] } }), { kind: 'resume', fulfilled: [] }), ['salt 3 issued with a viewDigest not of its view'])
  // the probe: done only by the ack completing it; its documents stay
  assert.deepEqual(broken(next((t) => { t.probeOut = { ...t.probeOut, inflight: {}, done: true } }), { kind: 'receive', disposition: 'unique', ref: 'uP' }), [])
  assert.deepEqual(broken(next((t) => { t.probeOut = { ...t.probeOut, inflight: {}, done: true } }), { kind: 'receive', disposition: 'unique', ref: 'uA' }), ['probe done without the ack completing one (6830)'])
  assert.deepEqual(broken(next((t) => { t.probeOut.inflight[1].digests = ['uQ'] })), ['the documents of probe 1 changed'])
  assert.deepEqual(broken(next((t) => { t.probeOut.inflight = {} }), { kind: 'tick' }), ['probe 1 left in flight with documents still in the outbox'])
})

test('invariants: a new tuple starts fresh (6250); positions stay with their entries and are never reused (2120, 2190); entryOrder.heads only appends (2180)', () => {
  const tup = (n) => ({ ownPairLabel: 'pair/' + n, counterpartAnchor: 'did:key:z' + n, counterpartKeyAgreement: 'z6LS' + n, rkid: 'z6LSown' + n })
  const base = stateBuilder({ at: T0 })
    .relationship('r1', { contactId: 'c1', tuples: [tup('p1')] }).entry('c1')
    .relationship('r2', { contactId: 'c2', tuples: [tup('p2')] }).entry('c2')
    .build()
  const next = (fn) => { const a = structuredClone(base); a.commitSeq = '1'; fn(a); return a }
  const named = (a, op = { kind: 'tick' }) => transitionViolations(base, a, op).filter((x) => ['tuples', 'positions'].includes(x.invariant)).map((x) => x.detail)
  const fresh = stateBuilder({ at: T0 }).relationship('r3', { contactId: 'c3', tuples: [tup('p3')] }).build()
  const add = (fn = () => {}) => next((a) => {
    a.relationships.r3 = structuredClone(fresh.relationships.r3); a.contacts.c3 = structuredClone(fresh.contacts.c3); a.entryOrder.heads.push('r3'); fn(a.relationships.r3.tuples[0], a)
  })
  assert.deepEqual(named(add(), { kind: 'act', command: 'continuity.newTuple' }), [])
  // the old tuple's star baseline and counters copied into the new one
  assert.deepEqual(named(add((t, a) => { t.starOut = { ...a.relationships.r1.tuples[0].starOut, lastSalt: '4', hwm: '4', snapshot: [], snapshotDigest: 'x' }; t.mappingOut = { rev: '2', body: {}, underAnchor: 'did:key:zU' } }), { kind: 'act', command: 'continuity.newTuple' }),
    ['pair/p3: a new tuple carries starOut, mappingOut (6250)'])
  // a position changes by tick, or is assigned again
  assert.deepEqual(named(next((a) => { a.contacts.c2.pos = '5'; a.entryOrder.nextPos = '6' })), ['c2: position 1 changed to 5'])
  assert.deepEqual(named(add((t, a) => { a.contacts.c3.pos = '1'; a.contacts.c3.status = 'admitted'; a.contacts.c2.pos = '2'; a.entryOrder.nextPos = '3' })),
    ['c2: position 1 moved to c3'])
  assert.deepEqual(named(next((a) => { a.entryOrder.nextPos = '1' })), ['nextPos fell 2 → 1'])
  const departed = next((a) => { delete a.relationships.r1; delete a.contacts.c1; a.entryOrder.heads = ['r2'] })
  const reused = structuredClone(departed)
  reused.commitSeq = '2'
  Object.assign(reused.relationships, structuredClone(fresh.relationships)); reused.contacts.c3 = { ...structuredClone(fresh.contacts.c3), pos: '0', status: 'admitted' }; reused.entryOrder.heads.push('r3')
  assert.deepEqual(transitionViolations(departed, reused, { kind: 'receive', disposition: 'unique' }).filter((x) => x.invariant === 'positions').map((x) => x.detail), ['position 0 assigned again (nextPos was 2)'])
  // a split whose leaver takes the entry's identity: the remaining relationships keep the position (2080, 2100)
  const merged = next((a) => { a.contacts.c1.aliases = ['c2']; a.contacts.c1.relIds = ['r1', 'r2']; delete a.contacts.c2; a.contacts.c1.pos = '0' })
  const split = structuredClone(merged)
  split.commitSeq = '2'
  split.contacts = { c2: { ...merged.contacts.c1, id: 'c2', aliases: [], relIds: ['r2'] }, c1: { ...merged.contacts.c1, aliases: [], relIds: ['r1'], pos: '2' } }
  split.entryOrder.nextPos = '3'
  assert.deepEqual(transitionViolations(merged, split, { kind: 'receive', disposition: 'unique' }).filter((x) => x.invariant === 'positions'), [])
  // merged into the earlier entry, its position leaves with it
  assert.deepEqual(named(next((a) => { a.contacts.c1.aliases = ['c2']; a.contacts.c1.relIds = ['r1', 'r2']; delete a.contacts.c2 }), { kind: 'act', command: 'trust.merge' }), [])
  // heads: reordered is no append; a departure leaves, a chaining takes the appended one's place
  assert.deepEqual(named(next((a) => { a.entryOrder.heads = ['r2', 'r1'] })), ['entryOrder.heads ["r1","r2"] → ["r2","r1"] is no append (2180)'])
  assert.deepEqual(named(add((t, a) => { delete a.relationships.r1; delete a.contacts.c1; a.entryOrder.heads = ['r2', 'r3'] }), { kind: 'act', command: 'trust.depart' }), [])
  const chained = add((t, a) => {
    a.relationships.r1.tuples.push({ ...t, entryId: 'c1' }); a.relationships.r1.activeHead = t.ownPairLabel
    a.relationships.r3 = { ...a.relationships.r3, tuples: [], chainedInto: 'r1' }
    a.contacts.c1.aliases = ['c3']; delete a.contacts.c3
    a.entryOrder.heads = ['r2', 'r1']
  })
  assert.deepEqual(transitionViolations(add(), chained, { kind: 'receive', disposition: 'unique' }).filter((x) => x.invariant === 'positions'), [])
})

test('invariants: a continuity duty leaves on receive only by its own end — the probe duty by the ack completing the probe, the mapping duty by the current issuance answered (6830, 6850)', () => {
  const PROBE = 'https://real-life.org/trust-tasks/continuity-probe/0.1'
  const CMAP = 'https://real-life.org/trust-tasks/continuity-mapping/0.1'
  const item = (type) => ({ type, threadId: 'th', recipient: { contactId: 'c1', rkid: 'z6LSownk1', keyAgreement: 'z6LSk1' }, envelope: { rkid: 'z6LSk1', epk: 'e', nonce: 'n', ciphertext: 'c' }, attempt: 1, history: [{ status: 'submitted', at: T0, attempt: 1 }] })
  const base = stateBuilder({ at: T0 })
    .relationship('r1', { contactId: 'c1', tuples: [{ ownPairLabel: 'pair/k1', counterpartAnchor: 'did:key:zK1', counterpartKeyAgreement: 'z6LSk1', rkid: 'z6LSownk1' }] })
    .duty({ kind: 'continuity', v: 1, id: 'cp', relId: 'r1', tuple: 'pair/k1', step: 'probe' })
    .duty({ kind: 'continuity', v: 1, id: 'cm', relId: 'r1', tuple: 'pair/k1', step: 'mapping' })
    .with((x) => {
      const t = x.relationships.r1.tuples[0]
      t.probeOut = { seq: '1', inflight: { 1: { digests: ['uP1', 'uP2'], acked: [] } }, done: false }
      t.continuityOut = { ...t.continuityOut, rev: '2', sent: ['uM2'], align: true }
      x.outbox.uP1 = item(PROBE); x.outbox.uP2 = item(PROBE); x.outbox.uM1 = item(CMAP); x.outbox.uM2 = item(CMAP)
    })
    .build()
  const next = (fn, ...ids) => { const a = structuredClone(base); a.commitSeq = '1'; for (const id of ids) delete a.duties[id]; fn(a.relationships.r1.tuples[0], a); return a }
  const dropped = (a, op) => transitionViolations(base, a, op).filter((x) => x.invariant === 'duties').map((x) => x.detail.split(' ')[0]).sort()
  const ack = (ref) => ({ kind: 'receive', disposition: 'unique', type: 'https://real-life.org/trust-tasks/delivery-ack/0.1', ref })
  // the probe: only the ack that completes it, done set in this commit
  const half = (t) => { t.probeOut.inflight[1].acked = ['uP1'] }
  assert.deepEqual(dropped(next(half, 'cp'), ack('uP1')), ['cp'], 'a partial ack completes nothing')
  const both = structuredClone(base); both.relationships.r1.tuples[0].probeOut.inflight[1].acked = ['uP1']
  const done = structuredClone(both); done.commitSeq = '1'; delete done.duties.cp; done.relationships.r1.tuples[0].probeOut = { seq: '1', inflight: {}, done: true }
  assert.deepEqual(transitionViolations(both, done, ack('uP2')).filter((x) => x.invariant === 'duties'), [])
  // the wrong step: the probe's completion ends no mapping duty, a continuity mapping arriving no probe duty
  const doneBoth = structuredClone(done); delete doneBoth.duties.cm
  assert.deepEqual(transitionViolations(both, doneBoth, ack('uP2')).filter((x) => x.invariant === 'duties').map((x) => x.detail.split(' ')[0]), ['cm'])
  assert.deepEqual(dropped(next((t) => { t.continuityOut.aligned = true }, 'cp', 'cm'), { kind: 'receive', disposition: 'unique', type: CMAP, rkid: 'z6LSownk1' }), ['cp'])
  // the mapping: the current issuance acked, aligned in this commit — not a stale one, not without the alignment
  assert.deepEqual(dropped(next((t) => { t.continuityOut.aligned = true }, 'cm'), ack('uM2')), [])
  assert.deepEqual(dropped(next((t) => { t.continuityOut.aligned = true }, 'cm'), ack('uM1')), ['cm'], 'a stale issuance answers nothing')
  assert.deepEqual(dropped(next(() => {}, 'cm'), ack('uM2')), ['cm'], 'acked but not aligned')
  // or answered by a continuity mapping arriving on the tuple, aligned in this commit
  assert.deepEqual(dropped(next((t) => { t.continuityOut.aligned = true }, 'cm'), { kind: 'receive', disposition: 'unique', type: CMAP, rkid: 'z6LSownk1' }), [])
  assert.deepEqual(dropped(next(() => {}, 'cm'), { kind: 'receive', disposition: 'unique', type: CMAP, rkid: 'z6LSownk1' }), ['cm'])
  assert.deepEqual(dropped(next((t) => { t.continuityOut.aligned = true }, 'cm'), { kind: 'receive', disposition: 'unique', type: CMAP, rkid: 'z6LSother' }), ['cm'])
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
      const w = await run(seed, { steps: Number(n ?? 300), restarts: seed % 2 === 0, lossy: seed % 2 === 0, script: seed % 3 === 0 })
      for (const [k, x] of Object.entries(w.events)) events[k] = (events[k] ?? 0) + x
      for (const [k, x] of Object.entries(w.counters)) counters[k] = (counters[k] ?? 0) + x
    }
    console.log('sweep events', JSON.stringify(events), JSON.stringify(counters))
    // the sweep reached what the generator injects and what it provokes
    for (const k of ['recover', 'horizon', 'gaveUp', 'retained', 'disposition.discarded', 'multiChunkGroupStarAccepted', 'awaitOpened', 'awaitReleased', 'rotate', 'restart', 'lost']) {
      assert.ok((counters[k] ?? 0) > 0, `the sweep reached ${k}: ${JSON.stringify(counters)}`)
    }
    for (const k of ['contact.merged', 'contact.split', 'contact.chained', 'contact.departed']) assert.ok((events[k] ?? 0) > 0, `the sweep reached ${k}`)
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
