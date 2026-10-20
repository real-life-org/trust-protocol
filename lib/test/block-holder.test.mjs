#!/usr/bin/env node
// block-holder (lib 0.5.0): the block of Message Tasks 0.1 Section 6 and
// the invitation's attribution, rate, register and one surfacing of
// Membership Tasks 0.20 3.1 on the holder (message/holder.ts,
// membership/holder.ts): the block act and its views, the silent decline
// with the register of declined invitations, unblock surfacing nothing,
// one surfacing per credential digest across relationships and bindings
// (#104), the rate with its transient failed(rate-limited), the prelude
// reply under a block, the outbound refusals, the block through merge,
// split, chaining and departure.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { labeledContext, seal, unseal, digestDoc, digestBytes, seedKeys, createHolder } from '../dist/index.js'
import { InMemoryStore, stateBuilder } from '../dist/testing.js'
import { T0, ev, opts, settle, met, communityPerson } from './holder-fixture.mjs'

const TT = 'https://real-life.org/trust-tasks/'
const INVITE = TT + 'membership-invite/0.2'
const PRELUDE = TT + 'membership-prelude-request/0.1'
const REPLY = TT + 'membership-prelude-reply/0.1'
const DAY = 86_400_000

const inviteDocs = (rs) => rs.filter((x) => x.o.type === INVITE)
const groupPrompts = async (P) => (await P.h.prompts()).filter((p) => p.kind === 'group-invite')

/** A founds a group and asks B (its contact a.id): prelude, reply, invite,
 *  everything delivered; returns the group and the results. */
async function invited (A, B, aId, t, groupId) {
  const gid = groupId ?? ev(await A.h.foundGroup({ name: 'Garden' }, opts(t)), 'group.founded')[0].groupId
  const inv = await A.h.invite(gid, aId, opts(t + 1000))
  assert.equal(inv.ok, true, JSON.stringify(inv))
  const seen = await settle([A, B], inv.outbound, t + 2000)
  return { gid, seen }
}

/** The invitation document B received (from A's outbox: the sealed one),
 *  re-wrapped in a fresh document: same credential, new id and digest. */
async function rewrapped (A, B, gid, invDoc) {
  const sB = await B.read()
  const rkid = Object.entries(sB.addresses.keys).find(([, k]) => k.label === 'group/' + gid)[0]
  const doc = { ...invDoc, id: crypto.randomUUID() }
  return { envelope: await seal(doc, rkid), digest: await digestDoc(doc) }
}

/** The plain invite document of an outbox item, opened with the receiver's member key. */
async function openInvite (B, gid, envelope) {
  const ctx = await labeledContext(B.seed, 'group/' + gid)
  return (await unseal(envelope, ctx.x.priv)).document
}

test('block: block and unblock a contact — every relationship of its entry, the event, the views, an unknown contact refused (RLTP-MSG-6010, 6020)', async () => {
  const A = await communityPerson(0x21), B = await communityPerson(0x22)
  const { a } = await met(A, B)
  const r = await A.h.block(a.id, opts(T0 + 10_000))
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.deepEqual(ev(r, 'contact.blocked').map((e) => [e.contactId, e.blocked]), [[a.id, true]])
  assert.equal((await A.h.contact(a.id)).blocked, true)
  const s = await A.read()
  assert.deepEqual(s.messages.blocked, [...(await A.read()).contacts[a.id].relIds].sort())
  const u = await A.h.unblock(a.id, opts(T0 + 11_000))
  assert.deepEqual(ev(u, 'contact.blocked').map((e) => e.blocked), [false])
  assert.equal((await A.h.contact(a.id)).blocked, false)
  assert.deepEqual(await A.h.block('nobody', opts(T0 + 12_000)), { ok: false, code: 'unknown-contact' })
})

test('block: an invitation attributed to a blocked relationship is declined silently — acknowledged, no prompt, its credential digest in the register; unblocking surfaces nothing, and a re-wrapped copy has no new effect (RLTP-MT-3115, 3120; RLTP-MSG-6310, 6320, 6510)', async () => {
  const A = await communityPerson(0x23), B = await communityPerson(0x24)
  const { a, b } = await met(A, B)
  assert.equal((await B.h.block(b.id, opts(T0 + 5000))).ok, true)
  const { gid, seen } = await invited(A, B, a.id, T0 + 10_000)
  // the prelude request was answered under the block (unaffected), the invitation followed
  assert.ok(seen.some((x) => x.o.type === PRELUDE && x.got.disposition === 'unique'))
  const [got] = inviteDocs(seen)
  assert.equal(got.got.disposition, 'unique', 'the decline is the defined effect: unique, acknowledged (RLTP-DEL-6260)')
  assert.ok(got.got.outbound.some((o) => o.type === TT + 'delivery-ack/0.1'), 'the acknowledgement says arrival only (3095)')
  assert.deepEqual(got.got.events, [], 'silent')
  assert.deepEqual(await groupPrompts(B), [])
  const sB = await B.read()
  const doc = await openInvite(B, gid, got.o.envelope)
  const cred = await digestDoc(doc.payload.invite)
  assert.deepEqual(sB.joining.declined, [cred], 'the register holds the credential digest')
  assert.deepEqual(sB.joining.surfaced, [])
  // unblock: nothing reappears (6510)
  assert.equal((await B.h.unblock(b.id, opts(T0 + 20_000))).ok, true)
  assert.deepEqual(await groupPrompts(B), [])
  // the same credential in a fresh document, now unblocked: no new effect (3120)
  const again = await rewrapped(A, B, gid, doc)
  const r = await B.h.receive(again.envelope, T0 + 21_000)
  assert.equal(r.disposition, 'unique')
  assert.deepEqual(r.events, [])
  assert.deepEqual(await groupPrompts(B), [], 'the register answers whatever relationship or binding it arrives under')
  assert.deepEqual((await B.read()).joining.declined, [cred], 'the register only grows; unblock deletes nothing')
})

test('block: a block set after an invitation surfaced — a copy arriving under the block closes the open prompt as declined (RLTP-MT-3110, RLTP-MSG-6330)', async () => {
  const A = await communityPerson(0x25), B = await communityPerson(0x26)
  const { a, b } = await met(A, B)
  const { gid, seen } = await invited(A, B, a.id, T0 + 10_000)
  assert.equal((await groupPrompts(B)).length, 1, 'surfaced')
  const doc = await openInvite(B, gid, inviteDocs(seen)[0].o.envelope)
  const cred = await digestDoc(doc.payload.invite)
  assert.deepEqual((await B.read()).joining.surfaced, [cred])
  assert.equal((await B.h.block(b.id, opts(T0 + 20_000))).ok, true)
  const copy = await rewrapped(A, B, gid, doc)
  const r = await B.h.receive(copy.envelope, T0 + 21_000)
  assert.equal(r.disposition, 'unique')
  assert.deepEqual(await groupPrompts(B), [], 'the open prompt closed')
  const sB = await B.read()
  assert.deepEqual(sB.joining.declined, [cred])
  assert.equal(sB.joining.invites[cred].status, 'declined')
  assert.deepEqual(sB.joining.surfaced, [cred], 'the surfaced record stays for the holder\'s life (3130)')
})

/** Two holders A and B holding two relationships toward each other (r1, r2:
 *  two tuples under two pair labels, never chained), entries c1 and c2. */
async function twoRelationships (fa = 0xa1, fb = 0xb1) {
  const seedA = new Uint8Array(64).fill(fa), seedB = new Uint8Array(64).fill(fb)
  const kA = seedKeys(seedA), kB = seedKeys(seedB)
  const lab = async (n) => 'pair/' + await digestBytes(new Uint8Array(32).fill(n))
  const [la1, la2, lb1, lb2] = await Promise.all([lab(fa ^ 1), lab(fa ^ 2), lab(fb ^ 3), lab(fb ^ 4)])
  const [a1, a2, b1, b2] = await Promise.all([kA.anchorOf(la1), kA.anchorOf(la2), kB.anchorOf(lb1), kB.anchorOf(lb2)])
  const build = (ownL, own, them) => stateBuilder({ at: T0 })
    .relationship('r1', { contactId: 'c1', tuples: [{ ownPairLabel: ownL[0], counterpartAnchor: them[0].anchor, counterpartKeyAgreement: them[0].keyAgreement, rkid: own[0].keyAgreement }] })
    .relationship('r2', { contactId: 'c2', tuples: [{ ownPairLabel: ownL[1], counterpartAnchor: them[1].anchor, counterpartKeyAgreement: them[1].keyAgreement, rkid: own[1].keyAgreement }] })
    .entry('c1').entry('c2').settings('c1', { star: 'off', groupStar: 'off' }).settings('c2', { star: 'off', groupStar: 'off' }).build()
  const sA = new InMemoryStore(), sB = new InMemoryStore()
  await sA.commit(null, build([la1, la2], [a1, a2], [b1, b2]))
  await sB.commit(null, build([lb1, lb2], [b1, b2], [a1, a2]))
  const mk = async (store, keys, seed) => ({ h: await createHolder({ store, keys }, { invariants: true }), store, keys, seed, read: async () => (await store.read()).state })
  return { A: await mk(sA, kA, seedA), B: await mk(sB, kB, seedB) }
}

test('block (#104): one invitation credential in two envelopes under two relationships, one blocked — whichever commits first, no open prompt and the digest in the register; with neither blocked, exactly one prompt (RLTP-MSG-6330, RLTP-MT-3110–3125)', async () => {
  for (const order of ['blocked-first', 'unblocked-first']) {
    const { A, B } = await twoRelationships(order === 'blocked-first' ? 0xa1 : 0xa3, order === 'blocked-first' ? 0xb1 : 0xb3)
    assert.equal((await B.h.block('c1', opts(T0 + 500))).ok, true)
    const gid = ev(await A.h.foundGroup({ name: 'Two ways' }, opts(T0 + 1000)), 'group.founded')[0].groupId
    // the invitation of the prelude on r1 (blocked at B): held back, not yet delivered
    const p1 = await A.h.invite(gid, 'c1', opts(T0 + 2000))
    const r1 = await B.h.receive(p1.outbound[0].envelope, T0 + 2100)          // binding (G, A) on r1
    const rep = await A.h.receive(r1.outbound.find((o) => o.type === REPLY).envelope, T0 + 2200)
    const inv1 = rep.outbound.find((o) => o.type === INVITE)
    const doc = await openInvite(B, gid, inv1.envelope)
    const cred = await digestDoc(doc.payload.invite)
    if (order === 'blocked-first') {
      assert.equal((await B.h.receive(inv1.envelope, T0 + 2300)).disposition, 'unique')
      assert.deepEqual(await groupPrompts(B), [])
    }
    // r1 ends at B; the binding moves to r2 (unblocked) with a renewed prelude
    assert.equal((await B.h.depart('c1', opts(T0 + 3000))).ok, true)
    const p2 = await A.h.invite(gid, 'c2', opts(T0 + 4000))
    assert.equal((await B.h.receive(p2.outbound[0].envelope, T0 + 4100)).disposition, 'unique')
    const copy = await rewrapped(A, B, gid, doc)
    const got = await B.h.receive(copy.envelope, T0 + 4200)
    assert.equal(got.disposition, 'unique')
    if (order === 'blocked-first') {
      assert.deepEqual(await groupPrompts(B), [], 'the register answers the copy under the renewed binding')
      assert.deepEqual((await B.read()).joining.declined, [cred])
    } else {
      assert.equal((await groupPrompts(B)).length, 1, 'surfaced under r2')
      assert.deepEqual((await B.read()).joining.surfaced, [cred])
      // the blocked relationship's copy can no longer arrive under r1 (departed): with neither relationship blocked now, the original copy is no new effect
      const late = await B.h.receive(inv1.envelope, T0 + 4300)
      assert.equal(late.disposition, 'unique')
      assert.equal((await groupPrompts(B)).length, 1, 'exactly one prompt')
    }
  }
})

/** Edit a holder's stored state by hand (CAS on its version). */
async function edit (P, fn) {
  const { state, version } = await P.store.read()
  const s = structuredClone(state); fn(s)
  assert.equal((await P.store.commit(version, s)).ok, true)
}

test('block (#104): without a binding an invitation is attributed to no relationship — a new one surfaces without a contact, a re-wrapped declined one finds the register (RLTP-MT-3100, 3120, 3125; RLTP-MSG-6110, 6320)', async () => {
  const { A, B } = await twoRelationships(0xa5, 0xb5)
  const gid = ev(await A.h.foundGroup({ name: 'None' }, opts(T0 + 1000)), 'group.founded')[0].groupId
  // invitation 1 under r1, blocked: declined into the register
  assert.equal((await B.h.block('c1', opts(T0 + 1500))).ok, true)
  const p1 = await A.h.invite(gid, 'c1', opts(T0 + 2000))
  const r1 = await B.h.receive(p1.outbound[0].envelope, T0 + 2100)
  const inv1 = (await A.h.receive(r1.outbound.find((o) => o.type === REPLY).envelope, T0 + 2200)).outbound.find((o) => o.type === INVITE)
  const doc1 = await openInvite(B, gid, inv1.envelope)
  assert.equal((await B.h.receive(inv1.envelope, T0 + 2300)).disposition, 'unique')
  assert.equal((await B.read()).joining.declined.length, 1)
  // a holder that keeps no binding: B's are gone before the next prelude and before its invitation arrives
  await edit(B, (s) => { s.joining.preludes = {} })
  const p3 = await A.h.invite(gid, 'c2', opts(T0 + 3500))
  const r3 = await B.h.receive(p3.outbound[0].envelope, T0 + 3600)
  assert.equal(r3.disposition, 'unique', JSON.stringify(r3))
  const inv3 = (await A.h.receive(r3.outbound.find((o) => o.type === REPLY).envelope, T0 + 3700)).outbound.find((o) => o.type === INVITE)
  await edit(B, (s) => { s.joining.preludes = {} })
  // a re-wrapped copy of the declined invitation, unattributed: the register answers it
  const copy = await rewrapped(A, B, gid, doc1)
  const got1 = await B.h.receive(copy.envelope, T0 + 4000)
  assert.equal(got1.disposition, 'unique', JSON.stringify(got1))
  assert.deepEqual(await groupPrompts(B), [])
  // the new invitation, unattributed: it surfaces, without a contact, and no block can reach it
  const got3 = await B.h.receive(inv3.envelope, T0 + 4100)
  assert.equal(got3.disposition, 'unique', JSON.stringify(got3))
  const prompts = await groupPrompts(B)
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].contactId, undefined, 'attributed to no relationship')
  const [rec] = Object.values((await B.read()).joining.invites).filter((i) => i.status === 'open')
  assert.deepEqual([rec.contactId, rec.rkid], [undefined, undefined])
  // its accept still finds its way to the inviter's card
  const d = await B.h.decide(prompts[0].id, 'accept', opts(T0 + 5000))
  assert.equal(d.ok, true, JSON.stringify(d))
  assert.equal(d.outbound[0].recipient.contactId.startsWith('member:'), true)
})

test('block: the rate — 20 invitations with a new credential digest per relationship and day, the 21st failed(rate-limited) at stage 8 with nothing committed, counted before the block; a known digest is never refused; delivered again after the window, it is evaluated afresh (RLTP-MT-3105; RLTP-MSG-4115, 4120, 4130, 4140; RLTP-DEL-6270, 6280)', async () => {
  const A = await communityPerson(0x27), B = await communityPerson(0x28)
  const { a, b } = await met(A, B)
  const gid = ev(await A.h.foundGroup({ name: 'Many' }, opts(T0 + 9000)), 'group.founded')[0].groupId
  const t = T0 + 10_000
  let first = null
  for (let i = 0; i < 20; i++) {
    const { seen } = await invited(A, B, a.id, t + i * 10_000, gid)
    const [x] = inviteDocs(seen)
    assert.equal(x.got.disposition, 'unique', `invitation ${i + 1}`)
    first ??= x
    if (i === 9) assert.equal((await B.h.block(b.id, opts(t + i * 10_000 + 5000))).ok, true, 'blocked half way: the count goes on before the block')
  }
  const sB = await B.read()
  assert.equal(sB.joining.surfaced.length + sB.joining.declined.length, 20)
  // the 21st new digest: held back, nothing commits
  const inv = await A.h.invite(gid, a.id, opts(t + 300_000))
  const r = await B.h.receive(inv.outbound[0].envelope, t + 300_100)
  const late = (await A.h.receive(r.outbound.find((o) => o.type === REPLY).envelope, t + 300_200)).outbound.find((o) => o.type === INVITE)
  const before = await B.store.read()
  const got = await B.h.receive(late.envelope, t + 300_300)
  assert.deepEqual([got.disposition, got.reason, got.stage, got.ref], ['failed', 'rate-limited', 8, 'RLTP-MT-3105'])
  const after = await B.store.read()
  assert.equal(after.version, before.version, 'nothing committed, lastWhen included')
  assert.ok(!Object.hasOwn(after.state.effects, got.digest), 'no cache entry: a redelivery is evaluated in full')
  // a known digest is never refused by the rate (a copy of the first)
  const doc = await openInvite(B, gid, first.o.envelope)
  const copy = await rewrapped(A, B, gid, doc)
  assert.equal((await B.h.receive(copy.envelope, t + 300_400)).disposition, 'unique', 'a known credential digest does not count and is not refused')
  // after the window: the same envelope again, evaluated afresh, accepted (declined: the relationship is blocked)
  const again = await B.h.receive(late.envelope, t + 300_300 + DAY)
  assert.equal(again.disposition, 'unique', JSON.stringify(again))
  // declined under the block: invitations 11 to 20, the copy of the first (its open prompt closed), and now the 21st
  assert.equal((await B.read()).joining.declined.length, 12)
})

test('block: a prelude reply arriving on a blocked relationship closes the waiting prelude, acknowledged, and no invitation is issued (RLTP-MT-3975, 3980; RLTP-MSG-6410)', async () => {
  const A = await communityPerson(0x29), B = await communityPerson(0x2a)
  const { a } = await met(A, B)
  const gid = ev(await A.h.foundGroup({ name: 'Closed' }, opts(T0 + 9000)), 'group.founded')[0].groupId
  const inv = await A.h.invite(gid, a.id, opts(T0 + 10_000))
  const r = await B.h.receive(inv.outbound[0].envelope, T0 + 10_100)
  assert.equal((await A.h.block(a.id, opts(T0 + 10_200))).ok, true)
  const got = await A.h.receive(r.outbound.find((o) => o.type === REPLY).envelope, T0 + 10_300)
  assert.equal(got.disposition, 'unique')
  assert.deepEqual(got.outbound.map((o) => o.type), [TT + 'delivery-ack/0.1'], 'only the acknowledgement: no invitation')
  assert.deepEqual((await A.read()).groups[gid].preludes, {}, 'the prelude closed')
  assert.deepEqual((await A.read()).groups[gid].invitations, {})
})

test('block: the holder\'s own offers toward a blocked relationship are refused — an invitation, the introduction act as mediator for a blocked requester or target, the request toward a blocked mediator (RLTP-MSG-6410)', async () => {
  const A = await communityPerson(0x2b), B = await communityPerson(0x2c), C = await communityPerson(0x2d)
  const { a: ab, b: ba } = await met(A, B)
  const { a: ac } = await met(A, C, T0 + 50_000)
  const gid = ev(await A.h.foundGroup({ name: 'Off' }, opts(T0 + 60_000)), 'group.founded')[0].groupId
  assert.equal((await A.h.block(ab.id, opts(T0 + 61_000))).ok, true)
  assert.deepEqual(await A.h.invite(gid, ab.id, opts(T0 + 62_000)), { ok: false, code: 'blocked', ref: 'RLTP-MSG-6410' })
  assert.deepEqual(await A.h.introduce(ab.id, ac.id, opts(T0 + 63_000)), { ok: false, code: 'blocked', ref: 'RLTP-MSG-6410' })
  assert.deepEqual(await A.h.introduce(ac.id, ab.id, opts(T0 + 64_000)), { ok: false, code: 'blocked', ref: 'RLTP-MSG-6410' })
  assert.equal((await A.h.unblock(ab.id, opts(T0 + 65_000))).ok, true)
  const intro = await A.h.introduce(ab.id, ac.id, opts(T0 + 66_000))
  assert.equal(intro.ok, true, JSON.stringify(intro))
  await settle([A, B, C], intro.outbound, T0 + 67_000)
  const [offer] = (await B.h.prompts()).filter((p) => p.kind === 'introduction')
  assert.ok(offer, 'the offer reached the requester')
  assert.equal((await B.h.block(ba.id, opts(T0 + 68_000))).ok, true)
  assert.deepEqual(await B.h.decide(offer.id, 'accept', opts(T0 + 69_000)), { ok: false, code: 'blocked', ref: 'RLTP-MSG-6410' })
})

test('block: chain-level state — a chaining keeps it, a merge sets it on every relationship of the merged entry, a departure takes it along (RLTP-MSG-6010, 6030)', async () => {
  const A = await communityPerson(0x2e), B = await communityPerson(0x2f), D = await communityPerson(0x30)
  const { b } = await met(A, B)
  assert.equal((await B.h.block(b.id, opts(T0 + 10_000))).ok, true)
  // a re-encounter chains into the blocked relationship: the block stays
  await met(A, B, T0 + 20_000)
  const cb = await B.h.contact(b.id)
  assert.equal(cb.blocked, true, 'the chain keeps its block')
  // D's relationship merged by hand into the blocked entry: blocked as well
  const { b: bd } = await met(D, B, T0 + 40_000)
  assert.equal((await B.h.contact(bd.id)).blocked, false)
  const m = await B.h.merge([cb.id, bd.id], opts(T0 + 50_000))
  assert.equal(m.ok, true, JSON.stringify(m))
  const merged = await B.h.contact(bd.id)
  const sB = await B.read()
  assert.ok(merged.relationships.every((r) => sB.messages.blocked.includes(r.id)), 'every relationship of the merged entry')
  // departure: the block leaves with its relationships
  assert.equal((await B.h.depart(merged.id, opts(T0 + 60_000))).ok, true)
  assert.deepEqual((await B.read()).messages.blocked, [])
})

// ── review 110-1 ───────────────────────────────────────────────────────

/** B's store shared by a second engine B1 whose `sign` can be paused once (at
 *  the n-th call after arming): an evaluation waits inside its preparation
 *  while B commits. */
async function secondEngine (B) {
  let armed = null
  const keys = {
    anchorOf: (...a) => B.keys.anchorOf(...a), agree: (...a) => B.keys.agree(...a), carrierPrincipal: (...a) => B.keys.carrierPrincipal(...a),
    sign: async (...a) => { if (armed && --armed.n === 0) { const w = armed; armed = null; w.hit(); await w.go } return B.keys.sign(...a) },
  }
  const h = await createHolder({ store: B.store, keys }, { invariants: true })
  return {
    h,
    arm (n) {
      let hit, release
      const reached = new Promise((r) => { hit = r }), go = new Promise((r) => { release = r })
      armed = { n, hit, go }
      return { reached, release }
    },
  }
}

test('block (review 110-1): an invitation into a group the holder already holds surfaces like any other (3125); two envelopes of it at once on two engines count once against the rate and surface once (RLTP-MT-3105, 3110, 3125)', async () => {
  const A = await communityPerson(0x31), B = await communityPerson(0x32)
  const { a, b } = await met(A, B)
  const gid = ev(await A.h.foundGroup({ name: 'Held' }, opts(T0 + 9000)), 'group.founded')[0].groupId
  // two invitations before B joins; B joins through the first
  const one = await invited(A, B, a.id, T0 + 10_000, gid)
  const p2 = await A.h.invite(gid, a.id, opts(T0 + 20_000))
  const r2 = await B.h.receive(p2.outbound[0].envelope, T0 + 20_100)
  const inv2 = (await A.h.receive(r2.outbound.find((o) => o.type === REPLY).envelope, T0 + 20_200)).outbound.find((o) => o.type === INVITE)
  const [p] = await groupPrompts(B)
  await settle([A, B], (await B.h.decide(p.id, 'accept', opts(T0 + 21_000))).outbound, T0 + 22_000)
  assert.equal((await B.h.groups()).length, 1, 'B holds the group')
  void one
  const relId = (await B.h.contact(b.id)).relationships[0].id
  const count = async () => (await B.read()).messages.rates[relId]?.invites.length ?? 0
  const before = await count()
  // the second invitation in two envelopes, on two engines at once
  const doc = await openInvite(B, gid, inv2.envelope)
  const copy = await rewrapped(A, B, gid, doc)
  const B1 = await secondEngine(B)
  const [x, y] = await Promise.all([B1.h.receive(inv2.envelope, T0 + 30_000), B.h.receive(copy.envelope, T0 + 30_000)])
  assert.deepEqual([x.disposition, y.disposition], ['unique', 'unique'])
  assert.equal(await count(), before + 1, 'the new digest counted once; the second copy finds it known')
  assert.equal((await groupPrompts(B)).length, 1, 'surfaced once, though the group is held')
})

test('block (review 110-1): a block committed while an invitation\'s evaluation waits applies to it whole — the evaluation re-enters and declines (RLTP-MT-3110, 3115; RLTP-DEL-6230, 6240)', async () => {
  const A = await communityPerson(0x33), B = await communityPerson(0x34)
  const { a, b } = await met(A, B)
  const gid = ev(await A.h.foundGroup({ name: 'Race' }, opts(T0 + 9000)), 'group.founded')[0].groupId
  const p = await A.h.invite(gid, a.id, opts(T0 + 10_000))
  const r = await B.h.receive(p.outbound[0].envelope, T0 + 10_100)
  const inv = (await A.h.receive(r.outbound.find((o) => o.type === REPLY).envelope, T0 + 10_200)).outbound.find((o) => o.type === INVITE)
  const B1 = await secondEngine(B)
  const g = B1.arm(1)                                           // the signed ack, after stage 8
  const waiting = B1.h.receive(inv.envelope, T0 + 11_000)
  await g.reached
  assert.equal((await B.h.block(b.id, opts(T0 + 11_000))).ok, true)
  g.release()
  assert.equal((await waiting).disposition, 'unique')
  assert.deepEqual(await groupPrompts(B), [], 'declined: the evaluation decided on the block it read after the wait')
  assert.equal((await B.read()).joining.declined.length, 1)
})

test('block (review 110-1): a split leaves each relationship with its own block (RLTP-MSG-6030)', async () => {
  const A = await communityPerson(0x35), B = await communityPerson(0x36), D = await communityPerson(0x37)
  const { a, b } = await met(A, B)
  assert.equal((await A.h.trust(a.id, opts(T0 + 20_000))).ok, true)
  await settle([A, B], [], T0 + 21_000)
  const { b: bd } = await met(D, B, T0 + 50_000)
  assert.equal((await B.h.merge([b.id, bd.id], opts(T0 + 60_000))).ok, true)
  const merged = await B.h.contact(b.id)
  assert.equal((await B.h.block(merged.id, opts(T0 + 61_000))).ok, true)
  // D's first mapping names no anchor of the entry: D's relationship leaves (2080)
  const da = (await D.h.contacts())[0]
  assert.equal((await D.h.trust(da.id, opts(T0 + 62_000))).ok, true)
  await settle([B, D], [], T0 + 63_000)
  const entries = await B.h.contacts()
  assert.equal(entries.length, 2, 'split')
  assert.ok(entries.every((c) => c.blocked), 'each relationship keeps its own block')
})

test('codec (review 110-1): the journal takes the events this library emits — contact.blocked included — and refuses an unknown type', async () => {
  const { VALIDATORS } = await import('../dist/internal.js')
  const { readFileSync } = await import('node:fs')
  const v3 = JSON.parse(readFileSync(new URL('./fixtures/state-v3.json', import.meta.url), 'utf8'))
  const add = (s, type) => { const [k] = Object.keys(s.acts); s.acts[k].events.push({ type, eventId: '9.9', commitSeq: '9', contactId: 'c', blocked: true }); return s }
  assert.doesNotThrow(() => VALIDATORS[3](add(structuredClone(v3), 'contact.blocked')))
  assert.throws(() => VALIDATORS[3](add(structuredClone(v3), 'contact.unknown')), /unknown event type/)
})

test('block (CodeRabbit on #110): a block set on the fresh relationship of a re-encounter survives its chaining — the chain is blocked, the contact view says so, an invitation through it is declined (RLTP-MSG-6010, 6030)', async () => {
  const { scanned } = await import('./holder-fixture.mjs')
  const A = await communityPerson(0x38), B = await communityPerson(0x39)
  const { a } = await met(A, B)
  // a re-encounter: the fresh relationship at B, blocked before the continuity chains it
  const { bundle } = await scanned(A, B, T0 + 100_000)
  const got = await B.h.receive(bundle.envelope, T0 + 102_000)
  const fresh = ev(got, 'contact.added')[0].contactId
  assert.equal((await B.h.block(fresh, opts(T0 + 102_500))).ok, true)
  const prompt = (await B.h.prompts()).find((p) => p.kind === 'encounter-confirm')
  const d = await B.h.decide(prompt.id, 'accept', opts(T0 + 103_000))
  await settle([A, B], [...got.outbound, ...d.outbound], T0 + 104_000)
  const sB = await B.read()
  const chained = Object.values(sB.relationships).filter((r) => r.chainedInto !== null)
  assert.equal(chained.length, 1, 'the re-encounter chained')
  const chainId = chained[0].chainedInto
  assert.ok(sB.messages.blocked.includes(chainId), 'the chain carries the block')
  assert.equal((await B.h.contact(fresh)).blocked, true)
  // an invitation over the chain is declined
  const gid = ev(await A.h.foundGroup({ name: 'Chained' }, opts(T0 + 200_000)), 'group.founded')[0].groupId
  await invited(A, B, a.id, T0 + 201_000, gid)
  assert.deepEqual(await groupPrompts(B), [])
  assert.equal((await B.read()).joining.declined.length, 1)
})
