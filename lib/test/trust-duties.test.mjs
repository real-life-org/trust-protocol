#!/usr/bin/env node
// trust-duties (lib Stage 2, PR 5; Trust 2a, 2160, 2115, 2850, 5.4, 6410,
// 6455, 6465, 6595, 6a.4): the class duties in one place (trust/duties.ts)
// — every class on, off, merged, split, departed and chained opens, drops
// or moves exactly the expected duties; the profile's duties wait for PR 6;
// the reconciled classes wake and suppress their sweep.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { digestBytes, b64uOf } from '../dist/index.js'
import { stateBuilder } from '../dist/testing.js'
import { chainTuple, splitOff, followClasses, onFor, contactView } from '../dist/internal.js'
import { T0, MAPPING, trustPair, read, edit } from './pair-fixture.mjs'
import { STAR, GSTAR, person, network, state, tupleOf, edit as editP, standIns } from './star-fixture.mjs'

const BOUND = 10n ** 18n - 1n
const human = (h) => { let n = 0; return (cmd, input, when = T0) => h.act(cmd, input, when, { actId: `act-${++n}` }) }
const keys = (s) => Object.keys(s.duties).sort()
const ofType = (out, type) => out.filter((o) => o.type === type)
const withProfile = (s) => { s.profile = { body: { name: 'A' }, revision: '1' } }
/** A tuple spec over plain strings: no crypto runs on it in these tests. */
const tup = (n) => ({ ownPairLabel: 'pair/' + n, counterpartAnchor: 'did:key:z' + n, counterpartKeyAgreement: 'z6LS' + n, rkid: 'z6LSown' + n })
const classOn = (contactId, relId, cls) => ({ kind: 'class-on', v: 1, id: `class-on:${cls}:${relId}`, contactId, relId, cls })

test('duties: the Trust act opens the anchor mapping and, where an own profile exists, the profile class-on duty; the profile waits (PR 6); withdrawing drops both (2770, 2850, 6455, 6410, 2790)', async () => {
  const { holderA, storeA } = await trustPair({ a: (b) => b.with(withProfile) })
  const act = human(holderA)
  const on = await act('trust.set', { contactId: 'c1', on: true })
  assert.equal(on.nextDueAt, T0, 'new duties: the cue to resume')
  assert.deepEqual(keys(await read(storeA)), ['class-on:anchorMapping:r1', 'class-on:profile:r1'])
  const r = await holderA.resume(T0 + 1)
  assert.equal(ofType(r.outbound, MAPPING).length, 1)
  assert.deepEqual(r.outbound.filter((o) => ![MAPPING, STAR, GSTAR].includes(o.type)), [], 'no profile goes out before profile@1')
  assert.deepEqual(keys(await read(storeA)), ['class-on:profile:r1'], 'the mapping fulfilled its duty; the profile waits')
  const again = await holderA.resume(T0 + 2)
  assert.deepEqual(keys(await read(storeA)), ['class-on:profile:r1'])
  assert.equal(again.nextDueAt === undefined || again.nextDueAt > T0 + 2, true, 'a waiting duty that ran and stayed sets no timer of its own')
  assert.equal((await act('trust.set', { contactId: 'c1', on: false })).ok, true)
  assert.deepEqual(keys(await read(storeA)), [], 'the class off drops every duty of it (6410, 2790)')
  // without an own profile there is no current artifact: only the mapping's duty
  const p = await trustPair()
  await human(p.holderA)('trust.set', { contactId: 'c1', on: true })
  assert.deepEqual(keys(await read(p.storeA)), ['class-on:anchorMapping:r1'])
})

test('duties: the profile class set on its own — on opens, off drops, default follows the trusted contacts (2760, 2780, 2730)', async () => {
  const { holderA, storeA } = await trustPair({ a: (b) => b.with(withProfile) })
  const act = human(holderA)
  await act('trust.setClass', { contactId: 'c1', cls: 'profile', setting: 'on' })
  assert.deepEqual(keys(await read(storeA)), ['class-on:profile:r1'], 'on toward a contact that is not trusted (2780)')
  await act('trust.setClass', { contactId: 'c1', cls: 'profile', setting: 'off' })
  assert.deepEqual(keys(await read(storeA)), [])
  await act('trust.set', { contactId: 'c1', on: true })
  assert.deepEqual(keys(await read(storeA)), ['class-on:anchorMapping:r1'], 'an explicit off stays off through the Trust act (2730)')
  const d = await act('trust.setClass', { contactId: 'c1', cls: 'profile', setting: 'default' })
  assert.equal(d.nextDueAt, T0)
  assert.deepEqual(keys(await read(storeA)), ['class-on:anchorMapping:r1', 'class-on:profile:r1'], 'default resolves on toward a trusted contact')
  // a setting of a reconciled class opens no duty: its sweep sees it (5.4)
  await act('trust.setClass', { contactId: 'c1', cls: 'sealedGroupStar', setting: 'on' })
  await act('trust.setClass', { contactId: 'c1', cls: 'star', setting: 'off' })
  assert.deepEqual(keys(await read(storeA)), ['class-on:anchorMapping:r1', 'class-on:profile:r1'])
})

test('duties: profile/1 is a stub until PR 6 — a revision duty waits, sets no timer, and the class off drops it (6455, 6410)', async () => {
  const { holderA, storeA } = await trustPair({
    a: (b) => b.with(withProfile).settings('c1', { anchorMapping: 'on', star: 'off', groupStar: 'off' })
      .duty({ kind: 'profile', v: 1, id: 'profile:r1', contactId: 'c1', relId: 'r1', rev: '1' }),
  })
  const r = await holderA.resume(T0)
  assert.deepEqual(r.outbound, [])
  assert.equal(r.nextDueAt, undefined)
  assert.deepEqual(keys(await read(storeA)), ['profile:r1'])
  await human(holderA)('trust.setClass', { contactId: 'c1', cls: 'profile', setting: 'off' })
  assert.deepEqual(keys(await read(storeA)), [])
})

test('duties: a lagging relationship gets no class-on duty but keeps the star (6595, 2850); the follow rule is pure', () => {
  const s0 = stateBuilder({ at: T0 })
    .relationship('r1', { contactId: 'c1', tuples: [tup('a1')], heldCounterpartHead: 'did:key:zX2', links: [{ prev: 'did:key:zX1', next: 'did:key:zX2' }] })
    .relationship('r2', { contactId: 'c1', tuples: [tup('a2')], heldCounterpartHead: 'did:key:zX1' })
    .entry('c1').contact('c1', { anchorHead: 'did:key:zX2' }).with(withProfile).build()
  assert.deepEqual([onFor(s0, s0.relationships.r2, 'star'), onFor(s0, s0.relationships.r2, 'anchorMapping')], [true, false])
  const s1 = structuredClone(s0)
  s1.contacts.c1.settings.anchorMapping = 'on'
  const f = followClasses(s0, s1)
  assert.deepEqual(f.duties.map((d) => d.id), ['class-on:anchorMapping:r1', 'class-on:profile:r1'], 'r2 lags: nothing on it')
  // r2 ceases to lag (it presents X2): the classes turn on for it (2850)
  const s2 = structuredClone({ ...s1, duties: Object.fromEntries(f.duties.map((d) => [d.id, d])) })
  s2.relationships.r2.heldCounterpartHead = 'did:key:zX2'
  assert.deepEqual(followClasses(s1, s2).duties.map((d) => d.id), ['class-on:anchorMapping:r2', 'class-on:profile:r2'])
  // starting to lag keeps the open duties: only the class off drops them (6596, 6410)
  const s3 = structuredClone(s2)
  s3.relationships.r1.heldCounterpartHead = 'did:key:zX1'
  s3.relationships.r1.links = []
  s3.relationships.r2.links = [{ prev: 'did:key:zX1', next: 'did:key:zX2' }]
  const g = followClasses(s2, s3)
  assert.deepEqual([g.duties, keys(g.state)], [[], ['class-on:anchorMapping:r1', 'class-on:profile:r1']])
})

test('duties: a merge combines the settings (2160) — a class turning on for a merged relationship opens its duties, an off of either drops them', async () => {
  const build = (c2) => (b) => b.entry('c1').with(withProfile).settings('c1', { anchorMapping: 'on', star: 'off', groupStar: 'off' })
    .relationship('r2', { contactId: 'c2', tuples: [tup('m2')] }).settings('c2', c2)
    .duty(classOn('c1', 'r1', 'anchorMapping')).duty(classOn('c1', 'r1', 'profile'))
  const on = await trustPair({ a: build({ star: 'off', groupStar: 'off' }) })
  const m = await human(on.holderA)('trust.merge', { contactIds: ['c1', 'c2'] })
  assert.equal(m.ok, true)
  const s = await read(on.storeA)
  assert.deepEqual(Object.keys(s.contacts), ['c1'])
  assert.deepEqual(keys(s), ['class-on:anchorMapping:r1', 'class-on:anchorMapping:r2', 'class-on:profile:r1', 'class-on:profile:r2'], 'on where any held on: r2 gets the classes')
  assert.equal(s.duties['class-on:profile:r2'].contactId, 'c1')
  // the other strand held the anchor mapping off: off wins, every duty of it and of the trusted contacts' classes goes
  const off = await trustPair({ a: build({ anchorMapping: 'off', star: 'off', groupStar: 'off' }) })
  assert.equal((await human(off.holderA)('trust.merge', { contactIds: ['c1', 'c2'] })).ok, true)
  const t = await read(off.storeA)
  assert.equal(t.contacts.c1.settings.anchorMapping, 'off')
  assert.deepEqual(keys(t), [])
  // an explicit profile on survives the merged off (2160 per class)
  const keep = await trustPair({ a: (b) => build({ anchorMapping: 'off', star: 'off', groupStar: 'off' })(b).settings('c1', { profile: 'on' }) })
  await human(keep.holderA)('trust.merge', { contactIds: ['c2', 'c1'] })
  assert.deepEqual(keys(await read(keep.storeA)), ['class-on:profile:r1', 'class-on:profile:r2'])
})

test('duties: a split (2115) — the leaving relationship starts at default and drops the duties of the classes that are off for it; the remaining entry keeps its own', () => {
  const s0 = stateBuilder({ at: T0 })
    .relationship('r1', { contactId: 'c1', tuples: [tup('s1')], heldCounterpartHead: 'did:key:zS1' })
    .relationship('r2', { contactId: 'c2', tuples: [tup('s2')] })
    .with((s) => {
      // c2 joined c1 by hand (6640): one entry, its alias
      s.contacts.c1.relIds = ['r1', 'r2']; s.contacts.c1.aliases = ['c2']; delete s.contacts.c2
      s.relationships.r2.tuples[0].entryId = 'c1'
      s.contacts.c1.groupSettings = { g1: 'off', g2: 'on' }
    })
    .entry('c1').contact('c1', { anchorHead: 'did:key:zS1' }).settings('c1', { anchorMapping: 'on', star: 'off' }).with(withProfile)
    .duty(classOn('c1', 'r1', 'anchorMapping')).duty(classOn('c1', 'r2', 'anchorMapping')).duty(classOn('c1', 'r2', 'profile'))
    .duty({ kind: 'profile', v: 1, id: 'profile:r2', contactId: 'c1', relId: 'r2', rev: '1' })
    .build()
  const r = splitOff(s0, 'r2')
  const s = r.state
  assert.deepEqual(s.contacts.c2.settings, { star: 'off', groupStar: 'default', anchorMapping: 'default', sealedGroupStar: 'default', profile: 'default' }, 'every class at default, an off goes along')
  assert.deepEqual(s.contacts.c2.groupSettings, { g1: 'off' })
  assert.deepEqual(keys(s), ['class-on:anchorMapping:r1'], 'the leaver is no trusted contact: its anchor mapping and profile duties go')
  assert.equal(contactView(s, 'c1').classes.anchorMapping.on, true)
})

test('duties: a chaining moves every class duty to the chain under its entry, the highest profile revision kept; the new head owes the mapping (6980) and the profile (6465)', () => {
  const b = () => stateBuilder({ at: T0 })
    .relationship('r-B', { contactId: 'B', tuples: [tup('b1')] })
    .relationship('r-B-2', { contactId: 'B-2', tuples: [tup('b2')] })
    .entry('B').settings('B', { anchorMapping: 'on' }).with(withProfile)
    .duty({ kind: 'profile', v: 1, id: 'profile:r-B', contactId: 'B', relId: 'r-B', rev: '1' })
    .duty({ kind: 'profile', v: 1, id: 'profile:r-B-2', contactId: 'B-2', relId: 'r-B-2', rev: '2' })
    .duty({ kind: 'reissue-mapping', v: 1, id: 'reissue:r-B-2', contactId: 'B-2', relId: 'r-B-2', awaitHead: null })
  const c = chainTuple(b().build(), 'pair/b2', 'pair/b1', BOUND)
  assert.equal(typeof c, 'object')
  assert.deepEqual(keys(c.state), ['profile:r-B', 'reissue:r-B-2'])
  assert.deepEqual(c.state.duties['profile:r-B'], { kind: 'profile', v: 1, id: 'profile:r-B', contactId: 'B', relId: 'r-B', rev: '2' })
  assert.deepEqual([c.state.duties['reissue:r-B-2'].relId, c.state.duties['reissue:r-B-2'].contactId], ['r-B', 'B'])
  assert.deepEqual(c.duties.map((d) => d.id), ['class-on:anchorMapping:r-B', 'class-on:profile:r-B'])
  // the profile class off toward the entry: its duties go at the chaining (6410), the mapping's stay
  const d = chainTuple(b().settings('B', { profile: 'off' }).build(), 'pair/b2', 'pair/b1', BOUND)
  assert.deepEqual([keys(d.state), d.duties.map((x) => x.id)], [['reissue:r-B-2'], ['class-on:anchorMapping:r-B']])
})

test('duties: a departure that ends a lag turns the classes on for the relationship left (2850, 6595); the departed relationship\'s duties go', async () => {
  const { holderA, storeA } = await trustPair({
    a: (b) => b.entry('c1').with(withProfile).settings('c1', { anchorMapping: 'on', star: 'off', groupStar: 'off' })
      .relationship('r2', { contactId: 'c2', tuples: [tup('d2')] })
      .with((s) => {
        s.contacts.c1.relIds = ['r1', 'r2']; s.contacts.c1.aliases = ['c2']; delete s.contacts.c2
        s.relationships.r2.tuples[0].entryId = 'c1'
        Object.assign(s.relationships.r1, { heldCounterpartHead: 'did:key:zD2', links: [{ prev: 'did:key:zD1', next: 'did:key:zD2' }] })
        Object.assign(s.relationships.r2, { heldCounterpartHead: 'did:key:zD1' })
        s.contacts.c1.anchorHead = 'did:key:zD2'
      })
      .duty(classOn('c1', 'r1', 'anchorMapping')).duty(classOn('c1', 'r1', 'profile')),
  })
  const r = await human(holderA)('trust.depart', { contactId: 'c1', relationshipId: 'r1' })
  assert.equal(r.ok, true)
  assert.equal(r.nextDueAt, T0)
  const s = await read(storeA)
  assert.deepEqual(Object.keys(s.contacts), ['c2'], 'the entry takes the identity of the relationship left (2100)')
  assert.deepEqual(keys(s), ['class-on:anchorMapping:r2', 'class-on:profile:r2'])
  assert.deepEqual([s.duties['class-on:profile:r2'].contactId, s.contacts.c2.anchorHead], ['c2', 'did:key:zD1'])
})

test('duties: the star classes — on wakes the sweep, off suppresses it and keeps the baseline, on again re-evaluates against it (5830, 5760, 5850)', async () => {
  const A = await person('A', 0xc1), B = await person('B', 0xc2)
  const net = await network([A, B], [[A, B]])
  const act = human(A.holder)
  await net.pump(T0)
  const s0 = tupleOf(await state(A), 'r-B')
  assert.deepEqual([s0.starOut.hwm, s0.groupStarOut.hwm], ['1', '1'], 'both baselines completed by the acks')
  // paused and resumed with nothing changed: no wake, nothing sent (5850: no divergence)
  assert.equal((await act('trust.pause', { contactId: 'B', paused: true }, T0 + 1)).nextDueAt, undefined)
  assert.equal((await act('trust.pause', { contactId: 'B', paused: false }, T0 + 2)).nextDueAt, undefined)
  assert.deepEqual((await A.holder.resume(T0 + 3)).outbound, [])
  // paused, the view changes: nothing goes out (5830, 5760), the baseline stays
  await act('trust.pause', { contactId: 'B', paused: true }, T0 + 4)
  await editP(A, (s) => {
    const b = stateBuilder({ at: T0 })
    standIns(b, 1)
    const x = b.build()
    Object.assign(s.contacts, x.contacts); Object.assign(s.relationships, x.relationships)
    s.register.labels.push(...x.register.labels); Object.assign(s.addresses.keys, x.addresses.keys)
    s.entryOrder.heads.push(...x.entryOrder.heads)
    s.contacts.x00000.pos = '7'
  })
  assert.deepEqual((await A.holder.resume(T0 + 5)).outbound, [])
  const s1 = tupleOf(await state(A), 'r-B')
  assert.deepEqual([s1.starOut.lastSalt, s1.starOut.snapshotDigest], ['1', s0.starOut.snapshotDigest])
  // the star alone back on: the divergence wakes the sweep, the star goes, the group star stays off
  const on = await act('trust.setClass', { contactId: 'B', cls: 'star', setting: 'default' }, T0 + 6)
  assert.equal(on.nextDueAt, T0 + 6)
  const r = await A.holder.resume(T0 + 7)
  assert.deepEqual(r.outbound.map((o) => o.type), [STAR])
  assert.equal(tupleOf(await state(A), 'r-B').starOut.lastSalt, '2')
})

test('duties: the sealed group star per (group, contact) goes through the sweep — a per-group on wakes it and seals that group, back to default fills it (5430, 2830, 5770)', async () => {
  const A = await person('A', 0xc5), B = await person('B', 0xc6)
  const gid = await digestBytes(new Uint8Array(32).fill(0x0c))
  const memberLabel = 'group/' + gid
  const m = await A.keys.anchorOf(memberLabel)
  const memberOp = 'oid:' + b64uOf(new Uint8Array(32).fill(0x0c))
  const net = await network([A, B], [[A, B]], {
    build: { A: (b) => b.with((s) => { s.groups[gid] = { id: gid, memberLabel, rules: { vouchThreshold: '1' }, listed: true, membership: null, memberAnchor: m.anchor, memberOp } }) },
  })
  await net.pump(T0)
  const view = async () => tupleOf(await state(A), 'r-B').groupStarOut.snapshot
  assert.deepEqual(await view(), [{ group: gid, mode: 'digest' }], 'B is not trusted: filler by default')
  const act = human(A.holder)
  const on = await act('trust.setGroupClass', { contactId: 'B', groupId: gid, setting: 'on' }, T0 + 1)
  assert.equal(on.nextDueAt, T0 + 1, 'the view toward B changed: the sweep is woken')
  assert.deepEqual((await A.holder.contact('B')).classes.sealedGroupStar.groups, { [gid]: { setting: 'on', on: true } })
  const r = await A.holder.resume(T0 + 2)
  assert.deepEqual(r.outbound.map((o) => o.type), [GSTAR], 'the group star alone; no duty')
  await net.deliver(r.outbound, T0 + 2)
  assert.deepEqual(await view(), [{ group: gid, mode: 'sealed', member: m.anchor, memberOp }])
  const back = await act('trust.setGroupClass', { contactId: 'B', groupId: gid, setting: 'default' }, T0 + 3)
  assert.equal(back.nextDueAt, T0 + 3)
  await net.pump(T0 + 4)
  assert.deepEqual(await view(), [{ group: gid, mode: 'digest' }])
  assert.deepEqual((await state(A)).duties, {}, 'no duty at any point')
})
