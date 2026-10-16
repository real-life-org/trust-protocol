#!/usr/bin/env node
// trust-classes (lib Stage 2, PR 4a; Trust 2a, 5.4, 6370, 6410, 6595,
// 6596): the class settings and what follows from them — 2840 and 5450,
// the pause, no issuance while the class is off or on a lagging
// relationship, the owed re-issue after a rotation and its wait.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { T0, MAPPING, trustPair, side, withCommunity, mappingEnvelope, craftMapping, edit, read } from './pair-fixture.mjs'

const vec = (f) => JSON.parse(readFileSync(new URL('../../vectors/' + f, import.meta.url), 'utf8'))
const human = (h) => { let n = 0; return (cmd, input, when = T0) => h.act(cmd, input, when, { actId: `act-${++n}` }) }
/** The anchor mappings among a result's outbound (the star and the group
 *  star travel beside them, 5.4). */
const mappings = (r) => r.outbound.filter((o) => o.type === MAPPING)
const classes = async (h) => Object.fromEntries(Object.entries((await h.contact('c1')).classes).map(([k, v]) => [k, [v.setting, v.on]]))

test('classes: Trust turns the anchor mapping on and what follows the default with it; withdrawing turns those off and leaves an explicit on (2770, 2840)', async () => {
  const { holderA, storeA } = await trustPair()
  const act = human(holderA)
  assert.deepEqual(await classes(holderA), {
    star: ['default', true], groupStar: ['default', true], anchorMapping: ['default', false], sealedGroupStar: ['default', false], profile: ['default', false],
  }, 'the defaults of 2760')
  assert.equal((await act('trust.setClass', { contactId: 'c1', cls: 'profile', setting: 'on' })).ok, true)
  const on = await act('trust.set', { contactId: 'c1', on: true })
  assert.deepEqual(on.events.map((e) => e.type), ['trust.given'])
  assert.deepEqual(await classes(holderA), {
    star: ['default', true], groupStar: ['default', true], anchorMapping: ['on', true], sealedGroupStar: ['default', true], profile: ['on', true],
  })
  const off = await act('trust.set', { contactId: 'c1', on: false })
  assert.equal(off.ok, true)
  assert.deepEqual(off.events, [])
  assert.deepEqual(await classes(holderA), {
    star: ['default', true], groupStar: ['default', true], anchorMapping: ['off', false], sealedGroupStar: ['default', false], profile: ['on', true],
  })
  assert.equal((await holderA.contact('c1')).trust.given, false)
  assert.deepEqual((await read(storeA)).duties, {}, 'turning off drops the open class-on duty (6410)')
  assert.deepEqual(mappings(await holderA.resume(T0 + 1)), [], 'nothing issued')
  // the class can be given again: a fresh duty
  assert.equal((await act('trust.set', { contactId: 'c1', on: true })).ok, true)
  assert.equal((await holderA.resume(T0 + 2)).outbound.filter((o) => o.type === MAPPING).length, 1)
  // inputs: an unknown class or setting is a programming error
  await assert.rejects(act('trust.setClass', { contactId: 'c1', cls: 'trust', setting: 'on' }), TypeError)
  await assert.rejects(act('trust.setClass', { contactId: 'c1', cls: 'star', setting: 'maybe' }), TypeError)
  assert.deepEqual(await act('trust.setClass', { contactId: 'nobody', cls: 'star', setting: 'off' }), { ok: false, code: 'unknown-contact' })
})

test('classes: per-group settings of the sealed group star (2830); the class off resets every per-group on (5450)', async () => {
  const { holderA, storeA } = await trustPair()
  const act = human(holderA)
  await act('trust.setGroupClass', { contactId: 'c1', groupId: 'uG1', setting: 'on' })
  await act('trust.setGroupClass', { contactId: 'c1', groupId: 'uG2', setting: 'off' })
  await act('trust.setGroupClass', { contactId: 'c1', groupId: 'uG3', setting: 'on' })
  await act('trust.setGroupClass', { contactId: 'c1', groupId: 'uG3', setting: 'default' })
  assert.deepEqual((await read(storeA)).contacts.c1.groupSettings, { uG1: 'on', uG2: 'off' }, 'default removes the entry')
  await act('trust.setClass', { contactId: 'c1', cls: 'sealedGroupStar', setting: 'off' })
  assert.deepEqual((await read(storeA)).contacts.c1.groupSettings, { uG2: 'off' })
  // the reset belongs to the act that turns the class off: a group set on
  // afterwards stays on through later setting changes (2830, 5450)
  await act('trust.setGroupClass', { contactId: 'c1', groupId: 'uG1', setting: 'on' })
  assert.deepEqual((await read(storeA)).contacts.c1.groupSettings, { uG1: 'on', uG2: 'off' })
  await act('trust.setClass', { contactId: 'c1', cls: 'profile', setting: 'on' })
  await act('trust.pause', { contactId: 'c1', paused: true })
  await act('trust.setClass', { contactId: 'c1', cls: 'sealedGroupStar', setting: 'off' })
  assert.deepEqual((await read(storeA)).contacts.c1.groupSettings, { uG1: 'on', uG2: 'off' }, 'off again is no transition')
})

test('classes: the pause is star and blinded group star off (5.4, 2780); back to default unpauses', async () => {
  const { holderA } = await trustPair()
  const act = human(holderA)
  const p = await act('trust.pause', { contactId: 'c1', paused: true })
  assert.deepEqual(p.events.map((e) => [e.type, e.paused]), [['trust.paused', true]])
  let v = await holderA.contact('c1')
  assert.equal(v.trust.paused, true)
  assert.deepEqual([v.classes.star, v.classes.groupStar], [{ setting: 'off', on: false }, { setting: 'off', on: false }])
  assert.deepEqual((await act('trust.pause', { contactId: 'c1', paused: true })).events, [], 'no change, no event')
  const u = await act('trust.pause', { contactId: 'c1', paused: false })
  assert.deepEqual(u.events.map((e) => [e.type, e.paused]), [['trust.paused', false]])
  v = await holderA.contact('c1')
  assert.equal(v.trust.paused, false)
  assert.equal(v.classes.star.setting, 'default')
  // one of the two off alone is no pause
  await act('trust.setClass', { contactId: 'c1', cls: 'star', setting: 'off' })
  assert.equal((await holderA.contact('c1')).trust.paused, false)
})

test('classes: while the class is off nothing is issued — an owed re-issue is dropped (6410); a duty that cannot issue stays open', async () => {
  const { holderA, storeA } = await trustPair({
    a: (b) => b.duty({ kind: 'reissue-mapping', v: 1, id: 'reissue:r1', contactId: 'c1', relId: 'r1', awaitHead: null }),
  })
  const r = await holderA.resume(T0)
  assert.deepEqual(mappings(r), [])
  assert.deepEqual((await read(storeA)).duties, {})
  // the class on, but no community anchor to issue under: the duty stays, the contact shows pending
  const act = human(holderA)
  assert.equal((await act('trust.set', { contactId: 'c1', on: true })).ok, true)
  await edit(storeA, (s) => { s.register.community = null })
  const r2 = await holderA.resume(T0 + 1)
  assert.deepEqual(mappings(r2), [])
  assert.deepEqual(Object.keys((await read(storeA)).duties), ['class-on:anchorMapping:r1'])
  assert.equal((await holderA.contact('c1')).trust.pending, true)
})

test('classes: a lagging relationship gets no anchor mapping (6595); once it presents the entry\'s anchor head it gets the current one (2850)', async () => {
  const ID = vec('identity-derivation.json')
  const AR = vec('anchor-rotation.json')
  const D = AR.community.genesisDigest
  const IKM = Uint8Array.from(Buffer.from(ID.rootIkm, 'hex'))
  const g = AR.community.generations
  const r12 = AR.valid[0].artifact
  // P: one person (the oracle IKM at generation 2) behind two strands r1 and r2 of A's contact c1
  const P1 = await withCommunity(await side(0, 0x21, IKM), D, 2)
  const P2 = await withCommunity(await side(0, 0x22, IKM), D, 2)
  const A2 = await side(0x07, 0x23)
  const { holderA, storeA, A } = await trustPair({
    B: P1,
    a: (b) => b
      .relationship('r2', { contactId: 'c1', tuples: [{ ownPairLabel: A2.label, counterpartAnchor: P2.anchor, counterpartKeyAgreement: P2.keyAgreement, rkid: A2.keyAgreement }] })
      .with((s) => {
        Object.assign(s.relationships.r1, { heldCounterpartHead: g['2'].anchor, links: [{ prev: g['1'].anchor, next: g['2'].anchor }] })
        Object.assign(s.relationships.r2, { heldCounterpartHead: g['1'].anchor })   // r2 still presents generation 1: it lags
      }),
  })
  const act = human(holderA)
  assert.equal((await act('trust.set', { contactId: 'c1', on: true })).ok, true)
  assert.deepEqual(Object.keys((await read(storeA)).duties), ['class-on:anchorMapping:r1'], 'no duty on the lagging r2')
  const r = await holderA.resume(T0 + 1)
  assert.deepEqual(mappings(r).map((o) => [o.type, o.recipient.rkid]), [[MAPPING, A.keyAgreement]])
  assert.equal((await holderA.contact('c1')).trust.pending, true, 'r2 lags: not yet out on every head')
  // a class-on duty on r2 while it lags is fulfilled without sending
  await edit(storeA, (s) => { s.duties.x = { kind: 'class-on', v: 1, id: 'x', contactId: 'c1', relId: 'r2', cls: 'anchorMapping' } })
  assert.deepEqual(mappings(await holderA.resume(T0 + 2)), [])
  assert.deepEqual((await read(storeA)).duties, {})
  // P follows on r2: generation 2 with the link 1 → 2 — r2 presents the entry's head
  const m = await craftMapping(P2, A2, { revision: '1', gen: 2, lineage: [r12] })
  const rv = await holderA.receive((await mappingEnvelope(P2, A2, m)).envelope, T0 + 3)
  assert.equal(rv.disposition, 'unique')
  assert.equal(rv.nextDueAt, T0 + 3, 'the receive opened a due duty: the cue to resume')
  const s = await read(storeA)
  assert.equal(s.relationships.r2.heldCounterpartHead, g['2'].anchor)
  assert.deepEqual(Object.keys(s.duties), ['class-on:anchorMapping:r2'], 'ceasing to lag turns the class on for r2 (2850)')
  const r2 = await holderA.resume(T0 + 4)
  assert.deepEqual(mappings(r2).map((o) => [o.type, o.recipient.rkid]), [[MAPPING, A2.keyAgreement]])
  assert.equal((await holderA.contact('c1')).trust.pending, false)
})

test('classes: an owed re-issue waits for the awaited head (6596); one delivery meets every re-issue owed on the relationship', async () => {
  const H = 'did:key:z6MkhPjg5MgkyGp2WTuWe8cA1nWczN1strK8AcUSVCZpPEnN'
  const { holderA, storeA } = await trustPair({
    // paused (5.4): no star traffic, so the timer below is the duty's alone
    a: (b) => b.settings('c1', { anchorMapping: 'on', star: 'off', groupStar: 'off' })
      .duty({ kind: 'reissue-mapping', v: 1, id: 'wait', contactId: 'c1', relId: 'r1', awaitHead: H }),
  })
  let r = await holderA.resume(T0)
  assert.deepEqual(r.outbound, [])
  assert.deepEqual(Object.keys((await read(storeA)).duties), ['wait'])
  assert.equal(r.nextDueAt, undefined, 'a wait sets no timer')
  assert.equal((await holderA.contact('c1')).trust.pending, true)
  // the relationship presents H: the awaited re-issue goes out, and a second
  // one owed on the same relationship is met by the same delivery
  await edit(storeA, (s) => {
    s.relationships.r1.heldCounterpartHead = H
    s.duties.now = { kind: 'reissue-mapping', v: 1, id: 'now', contactId: 'c1', relId: 'r1', awaitHead: null }
  })
  r = await holderA.resume(T0 + 1)
  assert.equal(r.outbound.filter((o) => o.type === MAPPING).length, 1)
  const s = await read(storeA)
  assert.deepEqual(s.duties, {})
  assert.equal(s.relationships.r1.tuples[0].mappingOut.rev, '1')
  // a later anchor whose links carry H as a prev also releases the wait
  await edit(storeA, (x) => {
    x.relationships.r1.heldCounterpartHead = 'did:key:zLater'
    x.relationships.r1.links = [{ prev: H, next: 'did:key:zLater' }]
    x.duties.w2 = { kind: 'reissue-mapping', v: 1, id: 'w2', contactId: 'c1', relId: 'r1', awaitHead: H }
  })
  r = await holderA.resume(T0 + 2)
  assert.equal(r.outbound.filter((o) => o.type === MAPPING).length, 1)
  assert.equal((await read(storeA)).relationships.r1.tuples[0].mappingOut.rev, '2', 'a higher revision in the scope (6310)')
})

test('classes: an act that opens a due duty says so — nextDueAt = when, the cue to call resume; one that opens none carries none', async () => {
  const { holderA } = await trustPair()
  const act = human(holderA)
  const on = await act('trust.set', { contactId: 'c1', on: true }, T0 + 5)
  assert.equal(on.nextDueAt, T0 + 5)
  const pause = await act('trust.pause', { contactId: 'c1', paused: true }, T0 + 6)
  assert.equal(pause.nextDueAt, undefined, 'the open duty did not change')
  const r = await holderA.resume(T0 + 7)
  assert.equal(mappings(r).length, 1)
  assert.equal((await act('trust.set', { contactId: 'c1', on: false }, T0 + 8)).nextDueAt, undefined)
})

test('classes: two strands of one contact, neither lagging — both get the anchor mapping (2820, 2850)', async () => {
  const B2 = await side(0x09, 0x25)
  const A2 = await side(0x07, 0x26)
  const { holderA, storeA, A } = await trustPair({
    a: (b) => b.relationship('r2', { contactId: 'c1', tuples: [{ ownPairLabel: A2.label, counterpartAnchor: B2.anchor, counterpartKeyAgreement: B2.keyAgreement, rkid: A2.keyAgreement }] }),
  })
  await human(holderA)('trust.set', { contactId: 'c1', on: true })
  assert.deepEqual(Object.keys((await read(storeA)).duties).sort(), ['class-on:anchorMapping:r1', 'class-on:anchorMapping:r2'])
  const r = await holderA.resume(T0 + 1)
  assert.deepEqual(mappings(r).map((o) => o.recipient.rkid).sort(), [A.keyAgreement, A2.keyAgreement].sort())
  assert.equal((await holderA.contact('c1')).trust.pending, false)
})

test('classes: a re-issue owed at the rotation goes out on a relationship that lags now (6596: decided at the rotation)', async () => {
  const A2 = await side(0x07, 0x27)
  const B2 = await side(0x09, 0x28)
  const X1 = 'did:key:z6MkhPjg5MgkyGp2WTuWe8cA1nWczN1strK8AcUSVCZpPEnN'
  const X2 = 'did:key:z6MknXvHPd2AimwxPVcptemsQL1eNeizHcujQR4Q3bNkVda7'
  const { holderA, storeA } = await trustPair({
    a: (b) => b.settings('c1', { anchorMapping: 'on' })
      .relationship('r2', { contactId: 'c1', tuples: [{ ownPairLabel: A2.label, counterpartAnchor: B2.anchor, counterpartKeyAgreement: B2.keyAgreement, rkid: A2.keyAgreement }] })
      .with((s) => {
        Object.assign(s.relationships.r1, { heldCounterpartHead: X2, links: [{ prev: X1, next: X2 }] })
        Object.assign(s.relationships.r2, { heldCounterpartHead: X1 })   // r2 lags now
      })
      .duty({ kind: 'reissue-mapping', v: 1, id: 'reissue:r2', contactId: 'c1', relId: 'r2', awaitHead: null }),
  })
  const r = await holderA.resume(T0)
  assert.deepEqual(mappings(r).map((o) => [o.type, o.recipient.rkid]), [[MAPPING, A2.keyAgreement]])
  assert.deepEqual((await read(storeA)).duties, {})
})

test('facade: the typed human acts wrap act with their command names under the app\'s actId (note §4.2); recover is not human', async () => {
  const { holderA, storeA } = await trustPair({ a: (b) => b.relationship('r2', { contactId: 'c2', tuples: [{ ownPairLabel: 'pair/f2', counterpartAnchor: 'did:key:zF2', counterpartKeyAgreement: 'z6LSf2', rkid: 'z6LSownf2' }] }) })
  const o = (n, when = T0) => ({ when, actId: `f-${n}` })
  const t = await holderA.trust('c1', o(1))
  assert.deepEqual([t.ok, t.events.map((e) => e.type)], [true, ['trust.given']])
  const { nextDueAt: _, ...journaled } = t
  assert.deepEqual(await holderA.trust('c1', o(1)), journaled, 'the same actId replays the journal (no nextDueAt: announced then)')
  assert.deepEqual(await holderA.trust('c1', o(2)), { ok: false, code: 'already-given' })
  assert.deepEqual(await holderA.trust('c1', { when: T0 }), { ok: false, code: 'actid-missing' })
  assert.deepEqual(await holderA.untrust('c1', o(1)), { ok: false, code: 'actid-conflict' }, 'another act under a used actId')
  assert.equal((await holderA.untrust('c1', o(3))).ok, true)
  assert.equal((await read(storeA)).contacts.c1.settings.anchorMapping, 'off')
  assert.deepEqual((await holderA.pauseTrust('c1', true, o(4))).events.map((e) => [e.type, e.paused]), [['trust.paused', true]])
  assert.equal((await holderA.setClass('c1', 'profile', 'on', o(5))).ok, true)
  assert.equal((await holderA.setGroupClass('c1', 'uG', 'on', o(6))).ok, true)
  const c = (await read(storeA)).contacts.c1
  assert.deepEqual([c.settings.star, c.settings.groupStar, c.settings.profile, c.groupSettings], ['off', 'off', 'on', { uG: 'on' }])
  assert.deepEqual(await holderA.merge(['c1', 'nobody'], o(7)), { ok: false, code: 'unknown-contact' })
  const m = await holderA.merge(['c1', 'c2'], o(8))
  assert.deepEqual(m.events.map((e) => e.type), ['contact.merged'])
  const d = await holderA.depart('c2', { ...o(9), relationshipId: 'r2' })
  assert.deepEqual(d.events.map((e) => [e.type, e.relationshipIds]), [['contact.departed', ['r2']]])
  assert.deepEqual(Object.keys((await read(storeA)).contacts), ['c1'])
  const r = await holderA.recover({ when: T0 + 1 })
  assert.equal(r.ok, true)
  // the acts are journaled under their actIds, recover is not
  assert.deepEqual(Object.keys((await read(storeA)).acts).sort(), ['f-1', 'f-3', 'f-4', 'f-5', 'f-6', 'f-8', 'f-9'])
})
