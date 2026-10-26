#!/usr/bin/env node
// introduction-holder (lib Stage 2, PR 7a): the Introduction Act of Trust
// §8 on the holder (introduction/holder.ts) — the mediator's start (offer
// and ack-delay declaration), the requester's request, the forward, the
// target's consent prompt, the reply relayed, the uniform ack at the
// declared delay, the vouchers in either order, the requester's timeout,
// refusal privacy, equivocation; and the new introduced relationship.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { labeledContext, seal, unseal, ecdh, xRawOfMk, introMacKey, introMacArtifact, iso, actFiresAt } from '../dist/index.js'
import { T0, opts, settle, met, scanned, person, communityPerson } from './holder-fixture.mjs'

const TT = 'https://real-life.org/trust-tasks/spec/'
const T = {
  request: TT + 'introduction-request/0.1', forward: TT + 'introduction-forward/0.1', reply: TT + 'introduction-reply/0.1',
  ack: TT + 'introduction-ack/0.1', voucher: TT + 'introduction-voucher/0.1', declaration: TT + 'registry-declaration/0.1',
  offer: TT + 'x-introduction-offer/0.1',
}
const ACK_DELAY = 30_000

/** M meets R and T; M offers R an introduction to T. */
async function offered () {
  const M = await person(0x71), R = await person(0x72), T_ = await person(0x73)
  const mr = await met(R, M, T0)                 // R scans M
  const mt = await met(T_, M, T0 + 10_000)       // T scans M
  const intro = await M.h.introduce(mr.b.id, mt.b.id, opts(T0 + 20_000, { label: 'Tia' }))
  assert.equal(intro.ok, true, JSON.stringify(intro))
  assert.deepEqual(intro.outbound.map((o) => o.type), [T.declaration, T.offer])
  return { M, R, T: T_, mr, mt, intro }
}

const kinds = (r) => r.map((x) => x.o.type)

test('introduction: offer → request → forward → consent → reply relayed → vouchers → the introduced relationship on both sides; the ack at t_received + ack-delay', async () => {
  const { M, R, T: Tt, mr, mt, intro } = await offered()
  await settle([M, R, Tt], intro.outbound, T0 + 21_000)
  const [po] = await R.h.prompts()
  assert.deepEqual([po.kind, po.contactId], ['introduction', mr.a.id])
  const req = await R.h.decide(po.id, 'accept', opts(T0 + 22_000))
  assert.equal(req.ok, true, JSON.stringify(req))
  assert.deepEqual(req.outbound.map((o) => o.type), [T.request])
  const s1 = await settle([M, R, Tt], req.outbound, T0 + 23_000)
  assert.ok(kinds(s1).includes(T.forward), 'the byte-identical payload to the target')
  const [pt] = await Tt.h.prompts()
  assert.deepEqual([pt.kind, pt.contactId], ['introduction', mt.a.id])
  const actId = Object.values((await Tt.read()).encounter.introductions)[0].act
  assert.equal((await M.read()).encounter.introductions['mediator:' + actId].status, 'forwarded')
  const rep = await Tt.h.decide(pt.id, 'accept', opts(T0 + 24_000))
  assert.equal(rep.ok, true, JSON.stringify(rep))
  assert.deepEqual(rep.outbound.map((o) => o.type), [T.reply])
  const s2 = await settle([M, R, Tt], rep.outbound, T0 + 25_000)
  assert.deepEqual(kinds(s2).filter((k) => k.includes('/introduction-')).sort(), [T.reply, T.reply, T.voucher, T.voucher].sort())
  // both sides hold the new relationship, introduced via their mediator contact (8790)
  const rc = (await R.h.contacts()).find((c) => c.provenance === 'introduced')
  const tc = (await Tt.h.contacts()).find((c) => c.provenance === 'introduced')
  assert.ok(rc && tc)
  assert.equal(rc.via, mr.a.id)
  assert.equal(tc.via, mt.a.id)
  assert.equal(rc.displayName, 'Tia', 'the label the mediator\'s human typed')
  const sR = await R.read(), sT = await Tt.read()
  const rAct = sR.encounter.introductions['requester:' + actId], tAct = sT.encounter.introductions['target:' + actId]
  assert.deepEqual([rAct.status, rAct.vouched, tAct.status, tAct.vouched], ['completed', true, 'consented', true])
  // the new tuples meet: R's counterpart is T's fresh anchor and back
  const rTuple = Object.values(sR.relationships).flatMap((x) => x.tuples).find((t) => t.ownPairLabel === rAct.ownLabel)
  const tTuple = Object.values(sT.relationships).flatMap((x) => x.tuples).find((t) => t.ownPairLabel === tAct.ownLabel)
  assert.equal(rTuple.counterpartAnchor, (await Tt.keys.anchorOf(tAct.ownLabel)).anchor)
  assert.equal(tTuple.counterpartAnchor, (await R.keys.anchorOf(rAct.ownLabel)).anchor)
  // the mediator: not completed before its ack, which comes at t_received + ack-delay (8640, 8360)
  assert.equal((await M.read()).encounter.introductions['mediator:' + actId].status, 'forwarded')
  const early = await M.h.resume(T0 + 23_000 + ACK_DELAY - 1000)
  assert.ok(!early.outbound.some((o) => o.type === T.ack))
  const s3 = await settle([M, R, Tt], [], T0 + 23_000 + ACK_DELAY)
  assert.ok(kinds(s3).includes(T.ack))
  assert.equal((await M.read()).encounter.introductions['mediator:' + actId].status, 'completed')
  assert.equal((await R.read()).encounter.introductions['requester:' + actId].status, 'completed', 'an ack after completion is absorbed (8330)')
  // every document was acknowledged: signed acks for request, forward, reply; MAC acks for ack and voucher
  for (const [P, type] of [[R, T.request], [M, T.forward], [Tt, T.reply], [M, T.reply], [M, T.voucher], [M, T.ack], [M, T.offer]]) {
    const s = await P.read()
    for (const [d, o] of Object.entries(s.outbox).filter(([, o]) => o.type === type)) assert.equal(triasOf(o), 'delivered', `${type} ${d}`)
  }
})

const triasOf = (it) => [...it.history].reverse().find((h) => h.status !== 'awaiting-transport')?.status

test('introduction: the voucher before the reply is held pending and re-evaluated when the reply is accepted (8770, 8780)', async () => {
  const { M, R, T: Tt, intro } = await offered()
  await settle([M, R, Tt], intro.outbound, T0 + 21_000)
  const [po] = await R.h.prompts()
  await settle([M, R, Tt], (await R.h.decide(po.id, 'accept', opts(T0 + 22_000))).outbound, T0 + 23_000)
  const [pt] = await Tt.h.prompts()
  const held = []
  // hold the reply relayed to R back; everything else flows
  const rState = await R.read()
  const rMediatorKey = Object.values(rState.encounter.introductions)[0].pins.mediator
  const rRkid = Object.entries(rState.addresses.keys).find(([, k]) => k.label === rMediatorKey)[0]
  await settle([M, R, Tt], (await Tt.h.decide(pt.id, 'accept', opts(T0 + 24_000))).outbound, T0 + 25_000, {
    keep: (o) => { if (o.type === T.reply && o.envelope.rkid === rRkid) { held.push(o); return false } return true },
  })
  const pending = Object.values((await R.read()).encounter.introductions)[0]
  assert.equal(pending.status, 'sent')
  assert.ok(pending.pendingVoucher, 'the voucher waits for the reply')
  await settle([M, R, Tt], held, T0 + 26_000)
  const done = Object.values((await R.read()).encounter.introductions)[0]
  assert.deepEqual([done.status, done.vouched, done.pendingVoucher], ['completed', true, null])
})

test('introduction: refusal is local and silent — the requester still gets the one ack at the declared delay, then fails on the reply timeout (8380, 8650, 8340)', async () => {
  const { M, R, T: Tt, intro } = await offered()
  await settle([M, R, Tt], intro.outbound, T0 + 21_000)
  const [po] = await R.h.prompts()
  await settle([M, R, Tt], (await R.h.decide(po.id, 'accept', opts(T0 + 22_000))).outbound, T0 + 23_000)
  const [pt] = await Tt.h.prompts()
  const d = await Tt.h.decide(pt.id, 'decline', opts(T0 + 24_000))
  assert.deepEqual([d.ok, d.outbound], [true, []])
  assert.equal(Object.values((await Tt.read()).encounter.introductions)[0].status, 'refused')
  await settle([M, R, Tt], [], T0 + 23_000 + ACK_DELAY)
  const act = Object.values((await R.read()).encounter.introductions)[0]
  assert.equal(act.status, 'acked')
  await R.h.tick(T0 + 22_000 + 72 * 3_600_000 + 1000)
  assert.equal(Object.values((await R.read()).encounter.introductions)[0].status, 'failed')
  assert.equal((await R.h.contacts()).filter((c) => c.provenance === 'introduced').length, 0)
})

test('introduction: without an ack or a reply the requester fails at the act\'s expiry, t_sent + act-expiry (8340; A20, spec follow-up 18, not 8690\'s ack timeout); a request to a mediator whose declaration is not held is refused (Delivery 4.4)', async () => {
  const { M, R, T: Tt, intro } = await offered()
  // the declaration lost: the offer alone arrives
  await settle([M, R, Tt], intro.outbound.filter((o) => o.type === T.offer), T0 + 21_000)
  const [po] = await R.h.prompts()
  assert.deepEqual(await R.h.decide(po.id, 'accept', opts(T0 + 22_000)), { ok: false, code: 'no-declaration' })
  await settle([M, R, Tt], intro.outbound.filter((o) => o.type === T.declaration), T0 + 22_500)
  const req = await R.h.decide(po.id, 'accept', opts(T0 + 23_000))
  assert.equal(req.ok, true)
  // the request never arrives; at the bound it is still sent, a second after it failed (8140)
  const bound = T0 + 23_000 + 72 * 3_600_000
  await R.h.tick(bound)
  assert.equal(Object.values((await R.read()).encounter.introductions)[0].status, 'sent')
  await R.h.tick(bound + 1000)
  assert.equal(Object.values((await R.read()).encounter.introductions)[0].status, 'failed')
})

test('introduction: a different request under a held act id is an equivocation and refused (8100, 8240); a byte-identical repeat in a new document is absorbed', async () => {
  const { M, R, T: Tt, intro } = await offered()
  await settle([M, R, Tt], intro.outbound, T0 + 21_000)
  const [po] = await R.h.prompts()
  const req = await R.h.decide(po.id, 'accept', opts(T0 + 22_000))
  await settle([M, R, Tt], req.outbound, T0 + 23_000)
  const sR = await R.read()
  const act = Object.values(sR.encounter.introductions)[0]
  const mctx = await labeledContext(R.seed, act.pins.mediator)
  const mTuple = Object.values(sR.relationships).flatMap((x) => x.tuples).find((t) => t.ownPairLabel === act.pins.mediator)
  // R's own request document, opened at M's side is not possible here; rebuild a document around the held artifact
  const doc = (body) => ({ id: '3b9a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2' + body.n, type: T.request, issuer: mctx.anchor, recipient: mTuple.counterpartAnchor, threadId: '4b9a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2' + body.n, issuedAt: act.request.body.issuedAt, payload: body.payload })
  const fctx = await labeledContext(R.seed, act.ownLabel)
  const { signIntroArtifact } = await import('../dist/index.js')
  const other = await signIntroArtifact({ ...act.request.body, profile: { displayName: 'someone else' } }, async (b) => new Uint8Array(await globalThis.crypto.subtle.sign('Ed25519', fctx.ed.priv, b)))
  const r1 = await M.h.receive(await seal(doc({ n: 'd', payload: { introduction: other, card: act.requestCard } }), mTuple.counterpartKeyAgreement), T0 + 24_000)
  assert.deepEqual([r1.disposition, r1.reason, r1.ref], ['failed', 'validation-failed', 'RLTP-TRU-8240'])
  const r2 = await M.h.receive(await seal(doc({ n: 'e', payload: { introduction: act.request, card: act.requestCard } }), mTuple.counterpartKeyAgreement), T0 + 24_000)
  assert.equal(r2.disposition, 'unique')
  assert.deepEqual(r2.outbound.map((o) => o.type), [TT + 'delivery-ack/0.1'], 'before the ack production event: nothing but the delivery ack (8220)')
})

test('introduction: a reply that reaches a requester after its act\'s expiry is ignored; the mediator completes regardless — the role divergence of 8400 (8350; A20, spec follow-up 18)', async () => {
  const { M, R, T: Tt, intro } = await offered()
  await settle([M, R, Tt], intro.outbound, T0 + 21_000)
  const [po] = await R.h.prompts()
  // the request arrives and is forwarded; from here nothing reaches R until its act has expired
  const req = await R.h.decide(po.id, 'accept', opts(T0 + 22_000))
  const fwd = await M.h.receive(req.outbound[0].envelope, T0 + 22_500)
  await R.h.receive(fwd.outbound[0].envelope, T0 + 22_600)       // the delivery ack back to R
  await Tt.h.receive(fwd.outbound[1].envelope, T0 + 22_700)      // the forward
  // the target consents in time; the mediator relays the reply and vouches (held toward R)
  const [pt] = await Tt.h.prompts()
  const rep = await Tt.h.decide(pt.id, 'accept', opts(T0 + 23_000))
  const relayed = await M.h.receive(rep.outbound[0].envelope, T0 + 23_100)
  const toR = relayed.outbound.find((o) => o.type === T.reply)
  assert.ok(toR, 'the reply relayed toward R')
  // the mediator's one ack at t_received + ack-delay (8640): produced, held toward R
  const acked = await M.h.resume(T0 + 22_500 + ACK_DELAY)
  assert.ok(acked.outbound.some((o) => o.type === T.ack), 'the ack produced')
  const actId = Object.values((await Tt.read()).encounter.introductions)[0].act
  assert.equal((await M.read()).encounter.introductions['mediator:' + actId].status, 'completed', 'the mediator completed: ack produced, reply forwarded, vouchers sent (8360)')
  // the requester hears nothing until its act's expiry: failed (8340)
  const late = T0 + 22_000 + 72 * 3_600_000 + 2000
  await R.h.tick(late)
  assert.equal(Object.values((await R.read()).encounter.introductions)[0].status, 'failed')
  // the relayed reply arrives after the expiry, inside the absolute lifetime: acknowledged, ignored (8350)
  const got = await R.h.receive(toR.envelope, late + 100)
  assert.equal(got.disposition, 'unique', 'acknowledged, and ignored')
  const act = Object.values((await R.read()).encounter.introductions)[0]
  assert.deepEqual([act.status, act.reply], ['failed', null])
  assert.equal((await R.h.contacts()).filter((c) => c.provenance === 'introduced').length, 0)
  // the divergence of 8400: mediator completed, target consented, requester failed
  assert.deepEqual([
    (await M.read()).encounter.introductions['mediator:' + actId].status,
    Object.values((await Tt.read()).encounter.introductions)[0].status,
    act.status,
  ], ['completed', 'consented', 'failed'])
})

/** Run an offered act to the end: request, forward, consent, reply relayed, vouchers. */
async function completed () {
  const o = await offered()
  const { M, R, T: Tt, intro } = o
  await settle([M, R, Tt], intro.outbound, T0 + 21_000)
  const [po] = await R.h.prompts()
  await settle([M, R, Tt], (await R.h.decide(po.id, 'accept', opts(T0 + 22_000))).outbound, T0 + 23_000)
  const [pt] = await Tt.h.prompts()
  await settle([M, R, Tt], (await Tt.h.decide(pt.id, 'accept', opts(T0 + 24_000))).outbound, T0 + 25_000)
  return o
}

/** A voucher with a valid MAC on M's pinned tuple toward R, for other anchors. */
async function forgedVoucher (M, R, act, body) {
  const m = (await M.read()).encounter.introductions['mediator:' + act]
  const mctx = await labeledContext(M.seed, m.pins.requester)
  const r = (await R.read()).encounter.introductions['requester:' + act]
  const rTuple = Object.values((await R.read()).relationships).flatMap((x) => x.tuples).find((t) => t.ownPairLabel === r.pins.mediator)
  const rAnchor = (await R.keys.anchorOf(r.pins.mediator))
  const key = await introMacKey(await ecdh(mctx.x.priv, xRawOfMk(rAnchor.keyAgreement)), 'rltp/visibility/mac/voucher')
  const voucher = await introMacArtifact({ type: 'introduction-voucher@1', act, ...body }, key)
  const doc = { id: crypto.randomUUID(), type: T.voucher, issuer: mctx.anchor, recipient: rAnchor.anchor, threadId: m.threads.request, issuedAt: iso(T0 + 26_000), payload: { voucher } }
  assert.equal(rTuple.counterpartAnchor, mctx.anchor)
  return seal(doc, rAnchor.keyAgreement)
}

test('introduction: an accepted voucher is retained; a later voucher with other anchors and a valid MAC is rejected (8200, 8260), the byte-identical repeat absorbed', async () => {
  const { M, R } = await completed()
  const r = Object.values((await R.read()).encounter.introductions)[0]
  assert.ok(r.vouched && r.voucher)
  const same = await forgedVoucher(M, R, r.act, { requesterPair: r.voucher.body.requesterPair, targetPair: r.voucher.body.targetPair })
  assert.equal((await R.h.receive(same, T0 + 26_000)).disposition, 'unique')
  const other = await forgedVoucher(M, R, r.act, { requesterPair: r.voucher.body.targetPair, targetPair: r.voucher.body.requesterPair })
  const got = await R.h.receive(other, T0 + 26_000)
  assert.deepEqual([got.disposition, got.reason, got.ref], ['failed', 'validation-failed', 'RLTP-TRU-8260'])
})

test('introduction: a pending voucher that does not match the accepted reply vouches for nothing and goes; a differing voucher against a pending one is rejected (8770, 8260)', async () => {
  const { M, R, T: Tt, intro } = await offered()
  await settle([M, R, Tt], intro.outbound, T0 + 21_000)
  const [po] = await R.h.prompts()
  await settle([M, R, Tt], (await R.h.decide(po.id, 'accept', opts(T0 + 22_000))).outbound, T0 + 23_000)
  const act = Object.values((await R.read()).encounter.introductions)[0].act
  const card = Object.values((await R.read()).encounter.introductions)[0].requestCard
  const wrong = await forgedVoucher(M, R, act, { requesterPair: card.anchor, targetPair: card.anchor })
  assert.equal((await R.h.receive(wrong, T0 + 23_500)).disposition, 'unique')
  assert.ok(Object.values((await R.read()).encounter.introductions)[0].pendingVoucher)
  const differing = await forgedVoucher(M, R, act, { requesterPair: card.anchor, targetPair: card.anchor.slice(0, -1) + (card.anchor.endsWith('A') ? 'B' : 'A') })
  const d = await R.h.receive(differing, T0 + 23_600)
  assert.deepEqual([d.disposition, d.ref], ['failed', 'RLTP-TRU-8260'], 'a differing voucher against the pending one')
  const [pt] = await Tt.h.prompts()
  // the reply re-evaluates the pending voucher: it matches nothing and goes; the genuine voucher is then taken
  await settle([M, R, Tt], (await Tt.h.decide(pt.id, 'accept', opts(T0 + 24_000))).outbound, T0 + 25_000)
  const a = Object.values((await R.read()).encounter.introductions)[0]
  assert.deepEqual([a.status, a.vouched, a.pendingVoucher], ['completed', true, null])
  assert.notEqual(a.voucher.body.targetPair, card.anchor, 'the retained voucher is the genuine one, not the unmatched pending one')
})

test('introduction: the mediator rejects a differing reply even after the cutoff (8250 before 8180)', async () => {
  const { M, R, T: Tt } = await completed()
  const m = Object.values((await M.read()).encounter.introductions).find((x) => x.role === 'mediator')
  const tAct = Object.values((await Tt.read()).encounter.introductions)[0]
  const tctx = await labeledContext(Tt.seed, tAct.pins.mediator)
  const fctx = await labeledContext(Tt.seed, tAct.ownLabel)
  const { signIntroArtifact } = await import('../dist/index.js')
  const body = { ...m.reply.body, cardDigest: m.request.body.cardDigest }
  const other = await signIntroArtifact(body, async (b) => new Uint8Array(await crypto.subtle.sign('Ed25519', fctx.ed.priv, b)))
  const mTuple = Object.values((await Tt.read()).relationships).flatMap((x) => x.tuples).find((t) => t.ownPairLabel === tAct.pins.mediator)
  const late = T0 + 22_000 + 73 * 3_600_000
  const doc = { id: crypto.randomUUID(), type: T.reply, issuer: tctx.anchor, recipient: mTuple.counterpartAnchor, threadId: tAct.threads.forward, issuedAt: iso(late), payload: { introduction: other, card: m.replyCard } }
  const got = await M.h.receive(await seal(doc, mTuple.counterpartKeyAgreement), late)
  assert.deepEqual([got.disposition, got.ref], ['failed', 'RLTP-TRU-8250'])
  void R
})

test('introduction: an ack after the absolute lifetime is refused without a prior tick (8300); a second before it is taken', async () => {
  const { M, R, T: Tt, intro } = await offered()
  await settle([M, R, Tt], intro.outbound, T0 + 21_000)
  const [po] = await R.h.prompts()
  const req = await R.h.decide(po.id, 'accept', opts(T0 + 22_000))
  await settle([M, R, Tt], req.outbound, T0 + 23_000)
  const acks = (await M.h.resume(T0 + 23_000 + ACK_DELAY)).outbound.filter((o) => o.type === T.ack)
  assert.equal(acks.length, 1)
  const bound = T0 + 22_000 + 72 * 3_600_000 + 5 * 60_000
  const after = await R.h.receive(acks[0].envelope, bound + 1000)
  assert.deepEqual([after.disposition, after.reason, after.ref], ['failed', 'validation-failed', 'RLTP-TRU-8300'])
  assert.equal((await R.h.receive(acks[0].envelope, bound)).disposition, 'unique')
})

test('introduction: the offer carries the designator and the typed label only — no name read from the target\'s profile or card, no provenance', async () => {
  const { R, intro } = await offered()
  const offer = intro.outbound.find((o) => o.type === T.offer)
  const label = Object.entries((await R.read()).addresses.keys).find(([rkid]) => rkid === offer.envelope.rkid)[1].label
  const ctx = await labeledContext(R.seed, label)
  const doc = (await unseal(offer.envelope, ctx.x.priv)).document
  assert.deepEqual(Object.keys(doc.payload).sort(), ['label', 'target'])
  assert.equal(doc.payload.label, 'Tia')
})

test('introduction: the mediator departs the requester while the act runs — the target\'s valid reply is taken (unique, acked), the relay ends as failed at the mediator, nothing goes to a departed relationship; never a throw', async () => {
  const { M, R, T: Tt, mr, intro } = await offered()
  await settle([M, R, Tt], intro.outbound, T0 + 21_000)
  const [po] = await R.h.prompts()
  await settle([M, R, Tt], (await R.h.decide(po.id, 'accept', opts(T0 + 22_000))).outbound, T0 + 23_000)
  const [pt] = await Tt.h.prompts()
  // the mediator's human removes the requester
  const dep = await M.h.depart(mr.b.id, opts(T0 + 23_500))
  assert.equal(dep.ok, true, JSON.stringify(dep))
  const rep = await Tt.h.decide(pt.id, 'accept', opts(T0 + 24_000))
  const reply = rep.outbound.find((o) => o.type === T.reply)
  const got = await M.h.receive(reply.envelope, T0 + 25_000)
  assert.equal(got.disposition, 'unique', JSON.stringify(got))
  assert.deepEqual(got.outbound.map((o) => o.type), [TT + 'delivery-ack/0.1'], 'the reply\'s ack only: no relay, no vouchers')
  const actId = Object.values((await Tt.read()).encounter.introductions)[0].act
  assert.equal((await M.read()).encounter.introductions['mediator:' + actId].status, 'failed', 'the relay ended: the requester\'s relationship is gone')
  // and the mediator's ack duty ends without production (8280)
  const later = await M.h.resume(T0 + 25_000 + ACK_DELAY)
  assert.ok(!later.outbound.some((o) => o.type === T.ack))
})

test('introduction: the requester merges its mediator contact by hand while the offer is open — the offer, its prompt and later the voucher mark follow the merged entry; the act runs to the end (2140)', async () => {
  const { M, R, T: Tt, mr, intro } = await offered()
  await settle([M, R, Tt], intro.outbound, T0 + 21_000)
  const D = await person(0x74)
  const { b: rd } = await met(D, R, T0 + 21_500)
  assert.equal((await R.h.merge([mr.a.id, rd.id], opts(T0 + 21_800))).ok, true)
  const merged = (await R.h.contact(mr.a.id)).id
  const [offer] = Object.values((await R.read()).encounter.offers)
  assert.equal(offer.mediatorContactId, merged, 'the offer names the merged entry')
  const [po] = await R.h.prompts()
  assert.equal(po.contactId, merged)
  await settle([M, R, Tt, D], (await R.h.decide(po.id, 'accept', opts(T0 + 22_000))).outbound, T0 + 23_000)
  const [pt] = await Tt.h.prompts()
  await settle([M, R, Tt, D], (await Tt.h.decide(pt.id, 'accept', opts(T0 + 24_000))).outbound, T0 + 25_000)
  const rc = (await R.h.contacts()).find((c) => c.provenance === 'introduced')
  assert.ok(rc, 'the introduced relationship stands')
  assert.equal(rc.via, merged, 'introduced via the merged entry')
  const rel = Object.values((await R.read()).relationships).find((r) => r.provenance.kind === 'introduced')
  assert.equal(rel.memory.vouchedBy, merged, 'the voucher mark names the merged entry')
})

/** P holds an entry for M1 (M1 mapped P) and an unmapped relationship to
 *  M2, merged by hand; M2's first mapping splits it again (2080). */
async function mergedMediators (P, M1, M2, t) {
  const m1 = await met(P, M1, t)
  assert.equal((await M1.h.trust(m1.b.id, opts(t + 5000))).ok, true)
  await settle([M1, P], [], t + 6000)
  const m2 = await met(P, M2, t + 10_000)
  assert.equal((await P.h.merge([m1.a.id, m2.a.id], opts(t + 15_000))).ok, true)
  const split = async (at) => {
    assert.equal((await M2.h.trust(m2.b.id, opts(at))).ok, true)
    await settle([M2, P], [], at + 1000)
    const of = (c) => (cs) => cs.find((x) => x.relationships.some((r) => r.id === c.relationships[0].id)).id
    const cs = await P.h.contacts()
    return { atM1: of(m1.a)(cs), atM2: of(m2.a)(cs) }
  }
  return { m1, m2, merged: (await P.h.contact(m1.a.id)).id, split }
}
const relOfLabel = (s, label) => Object.values(s.relationships).find((r) => r.tuples.some((t) => t.ownPairLabel === label))

test('introduction: a hand-merged mediator entry split at the requester with an offer of each mediator open and one introduction completed — each offer and its prompt, the introducer and the voucher mark name the entry of the relationship the mediator\'s act came on, either side of the split (2080)', async () => {
  const R = await communityPerson(0x41), M1 = await communityPerson(0x42), M2 = await communityPerson(0x43)
  const T1 = await person(0x44), T2 = await person(0x45), T3 = await person(0x46)
  const t1 = await met(T1, M1, T0), t2 = await met(T2, M2, T0 + 1000), t3 = await met(T3, M2, T0 + 2000)
  const { m1, m2, merged, split } = await mergedMediators(R, M1, M2, T0 + 10_000)
  // M2 introduces R to T2, the act runs to its end while R's entry is merged
  const all = [R, M1, M2, T1, T2, T3]
  await settle(all, (await M2.h.introduce(m2.b.id, t2.b.id, opts(T0 + 40_000))).outbound, T0 + 41_000)
  const [po] = await R.h.prompts()
  assert.equal(po.contactId, merged)
  await settle(all, (await R.h.decide(po.id, 'accept', opts(T0 + 42_000))).outbound, T0 + 43_000)
  const [pt] = await T2.h.prompts()
  await settle(all, (await T2.h.decide(pt.id, 'accept', opts(T0 + 44_000))).outbound, T0 + 45_000)
  const introduced = () => R.read().then((s) => Object.values(s.relationships).find((r) => r.provenance.kind === 'introduced'))
  assert.equal((await introduced()).memory.vouchedBy, merged)
  // an offer of each mediator open
  await settle(all, (await M1.h.introduce(m1.b.id, t1.b.id, opts(T0 + 46_000))).outbound, T0 + 47_000)
  await settle(all, (await M2.h.introduce(m2.b.id, t3.b.id, opts(T0 + 48_000))).outbound, T0 + 49_000)
  assert.deepEqual((await R.h.prompts()).map((p) => p.contactId), [merged, merged])
  const { atM1, atM2 } = await split(T0 + 50_000)
  assert.notEqual(atM1, atM2)
  const s = await R.read()
  const offerOf = (m) => Object.values(s.encounter.offers).find((o) => relOfLabel(s, o.pin).id === m.a.relationships[0].id)
  assert.equal(offerOf(m1).mediatorContactId, atM1, 'M1\'s offer stays with M1\'s entry')
  assert.equal(offerOf(m2).mediatorContactId, atM2, 'M2\'s offer goes with M2\'s relationship')
  const prompts = await R.h.prompts()
  assert.equal(prompts.find((p) => p.id === offerOf(m1).id).contactId, atM1)
  assert.equal(prompts.find((p) => p.id === offerOf(m2).id).contactId, atM2, 'the offer\'s prompt follows its offer')
  assert.equal((await introduced()).memory.vouchedBy, atM2, 'the voucher mark names the mediator that vouched')
  assert.equal((await R.h.contacts()).find((c) => c.provenance === 'introduced').via, atM2, 'the introducer is the mediator that introduced')
})

test('introduction: a hand-merged mediator entry split at the target with a consent prompt of each mediator open — each prompt names the entry of the relationship its forward came on, either side of the split (2080)', async () => {
  const Tt = await communityPerson(0x47), M1 = await communityPerson(0x48), M2 = await communityPerson(0x49)
  const R1 = await person(0x4a), R2 = await person(0x4b)
  const r1 = await met(R1, M1, T0), r2 = await met(R2, M2, T0 + 1000)
  const { m1, m2, merged, split } = await mergedMediators(Tt, M1, M2, T0 + 10_000)
  const all = [Tt, M1, M2, R1, R2]
  let t = T0 + 40_000
  for (const [M, R, r, m] of [[M1, R1, r1, m1], [M2, R2, r2, m2]]) {
    await settle(all, (await M.h.introduce(r.b.id, m.b.id, opts(t))).outbound, t + 1000)
    const [po] = await R.h.prompts()
    await settle(all, (await R.h.decide(po.id, 'accept', opts(t + 2000))).outbound, t + 3000)
    t += 4000
  }
  const consent = async () => (await Tt.h.prompts()).filter((p) => p.kind === 'introduction')
  assert.deepEqual((await consent()).map((p) => p.contactId), [merged, merged])
  const { atM1, atM2 } = await split(t)
  assert.notEqual(atM1, atM2)
  const s = await Tt.read()
  const promptOf = (m) => Object.values(s.encounter.introductions).find((a) => a.role === 'target' && relOfLabel(s, a.pins.mediator).id === m.a.relationships[0].id).promptId
  const ps = await consent()
  assert.equal(ps.find((p) => p.id === promptOf(m1)).contactId, atM1, 'M1\'s forward stays with M1\'s entry')
  assert.equal(ps.find((p) => p.id === promptOf(m2)).contactId, atM2, 'M2\'s forward goes with M2\'s relationship')
})

// ── the timer contract: nextDueAt names the expiry work tick does ──────

test('timer: a delivered offer with nothing else open — resume names the prompt\'s expiry as nextDueAt; tick then removes the prompt', async () => {
  const { M, R, T: Tt, intro } = await offered()
  await settle([M, R, Tt], intro.outbound, T0 + 21_000)
  const [po] = await R.h.prompts()
  assert.ok(po.expiresAt > T0 + 21_000)
  const r = await R.h.resume(T0 + 21_000)
  assert.ok(r.nextDueAt !== undefined && r.nextDueAt <= po.expiresAt, `nextDueAt ${r.nextDueAt} names the expiry ${po.expiresAt} at the latest`)
  // the app's timer: tick then resume at each nextDueAt until the prompt is gone
  let at = r.nextDueAt, n = 0
  while ((await R.h.prompts()).length && n++ < 50) { await R.h.tick(at); at = (await R.h.resume(at)).nextDueAt ?? at + 3_600_000 }
  assert.deepEqual(await R.h.prompts(), [], 'expired and removed by the timer alone')
})

test('timer: the requester\'s act expiry and its act\'s lifetime are named by nextDueAt; tick at it fails the act (8340; A20) with no other input', async () => {
  const { M, R, T: Tt, intro } = await offered()
  await settle([M, R, Tt], intro.outbound, T0 + 21_000)
  const [po] = await R.h.prompts()
  const req = await R.h.decide(po.id, 'accept', opts(T0 + 22_000))
  assert.equal(req.ok, true)
  // the request is never delivered: the ack never comes
  const a0 = Object.values((await R.read()).encounter.introductions)[0]
  const timeout = actFiresAt(a0.at + 72 * 3_600_000)
  let at = T0 + 22_000, n = 0
  // the request's outbox retries wake it too, about 60 times over the 72 h
  while (Object.values((await R.read()).encounter.introductions)[0].status === 'sent' && n++ < 200) {
    const r = await R.h.resume(at)
    assert.ok(r.nextDueAt !== undefined, 'a wake is always named while the act waits')
    at = r.nextDueAt
    await R.h.tick(at)
  }
  assert.equal(Object.values((await R.read()).encounter.introductions)[0].status, 'failed')
  assert.ok(at <= timeout + 1000, `failed by the timer at ${at - T0}, the timeout fires at ${timeout - T0}`)
})

test('M3: a re-encounter chains away the requester↔mediator tuples the act pinned, the relationship older than key-retention; tick keeps the pinned keys — the reply, the ack and the vouchers still verify (8270, 8290)', async () => {
  const DAY = 86_400_000
  const M = await person(0x74), R = await person(0x75), Tt = await person(0x76)
  const mr = await met(R, M, T0)
  const mt = await met(Tt, M, T0 + 10_000)
  const TL = T0 + 100 * DAY
  const intro = await M.h.introduce(mr.b.id, mt.b.id, opts(TL, { label: 'Tia' }))
  assert.equal(intro.ok, true, JSON.stringify(intro))
  await settle([M, R, Tt], intro.outbound, TL + 1000)
  const [po] = await R.h.prompts()
  const req = await R.h.decide(po.id, 'accept', opts(TL + 2000))
  assert.equal(req.ok, true, JSON.stringify(req))
  await settle([M, R, Tt], req.outbound, TL + 3000)
  const actId = Object.values((await Tt.read()).encounter.introductions)[0].act
  const pinR = (await R.read()).encounter.introductions['requester:' + actId].pins.mediator
  const pinM = (await M.read()).encounter.introductions['mediator:' + actId].pins.requester
  const tupleOf = (s, label) => Object.values(s.relationships).flatMap((r) => r.tuples).find((t) => t.ownPairLabel === label)
  // R and M meet again mid-act: the fresh tuples chain, the pinned ones are deactivated (6220)
  await met(R, M, TL + 4000)
  await settle([M, R, Tt], [], TL + 5000)
  const rkR = tupleOf(await R.read(), pinR), rkM = tupleOf(await M.read(), pinM)
  assert.deepEqual([rkR.deactivated, rkM.deactivated], [true, true], 'the chaining deactivated both pinned tuples')
  // tick: the keys of the pinned tuples stay (their lastShown is older than key-retention)
  await R.h.tick(TL + 6000); await M.h.tick(TL + 6000)
  for (const [P, rkid] of [[R, rkR.rkid], [M, rkM.rkid]]) {
    const s = await P.read()
    assert.equal(s.addresses.tombstones.includes(rkid), false, 'not tombstoned')
    assert.ok(Object.hasOwn(s.addresses.keys, rkid))
  }
  // the act runs to its end on the pinned tuples
  const [pt] = await Tt.h.prompts()
  const rep = await Tt.h.decide(pt.id, 'accept', opts(TL + 7000))
  assert.equal(rep.ok, true, JSON.stringify(rep))
  const s2 = await settle([M, R, Tt], rep.outbound, TL + 8000)
  const s3 = await settle([M, R, Tt], [], TL + 3000 + ACK_DELAY)
  assert.ok(kinds(s3).includes(T.ack))
  // (the introduced tuple's own traffic may reach the requester before its reply opens the tuple: not this act's)
  assert.deepEqual([...s2, ...s3].filter((x) => x.o.type.includes('/introduction-') && x.got.disposition === 'failed').map((x) => [x.o.type, x.got.ref]), [])
  const rAct = (await R.read()).encounter.introductions['requester:' + actId]
  assert.deepEqual([rAct.status, rAct.vouched], ['completed', true], 'reply, ack and voucher verified under the pinned keys')
  assert.equal((await M.read()).encounter.introductions['mediator:' + actId].status, 'completed')
})

test('timer: at the act\'s absolute lifetime one tick discards the act and tombstones the key its pin alone kept — the chained-away tuple older than key-retention under a fresh active head; a second tick finds nothing left to do (8290, Delivery §5)', async () => {
  const DAY = 86_400_000
  const M = await person(0x7a), R = await person(0x7b), Tt = await person(0x7c)
  const mr = await met(R, M, T0)
  const mt = await met(Tt, M, T0 + 10_000)
  const TL = T0 + 100 * DAY
  await settle([M, R, Tt], (await M.h.introduce(mr.b.id, mt.b.id, opts(TL))).outbound, TL + 1000)
  const [po] = await R.h.prompts()
  await settle([M, R, Tt], (await R.h.decide(po.id, 'accept', opts(TL + 2000))).outbound, TL + 3000)
  const [key, act] = Object.entries((await R.read()).encounter.introductions)[0]
  // R and M meet again: the pinned tuple is deactivated under the fresh active head (6220)
  await met(R, M, TL + 4000)
  await settle([M, R], [], TL + 5000)
  const pinned = Object.values((await R.read()).relationships).flatMap((r) => r.tuples).find((t) => t.ownPairLabel === act.pins.mediator)
  assert.equal(pinned.deactivated, true)
  await R.h.tick(TL + 6000)
  assert.ok(Object.hasOwn((await R.read()).addresses.keys, pinned.rkid), 'held while the act is')
  // the act's absolute lifetime (8310)
  const end = actFiresAt(act.issuedAt + 72 * 3_600_000 + 5 * 60_000)
  await R.h.tick(end)
  const s1 = await R.read()
  assert.equal(Object.hasOwn(s1.encounter.introductions, key), false, 'the act is discarded')
  assert.equal(Object.hasOwn(s1.addresses.keys, pinned.rkid), false, 'its key leaves in the same tick')
  assert.ok(s1.addresses.tombstones.includes(pinned.rkid), 'as a tombstone')
  // nothing executable is left behind for the timer: resume names no past work, a second tick changes nothing
  const r = await R.h.resume(end)
  assert.ok(r.nextDueAt === undefined || r.nextDueAt > end)
  await R.h.tick(end)
  const s2 = await R.read()
  assert.deepEqual([s2.addresses, s2.encounter, s2.prompts], [s1.addresses, s1.encounter, s1.prompts])
})

test('M4: what opens an act is refused on a tuple a chaining deactivated — the offer and its declaration at the requester, the request at the mediator, the forward at the target (6190, 6240)', async () => {
  const tupleOf = (s, label) => Object.values(s.relationships).flatMap((r) => r.tuples).find((t) => t.ownPairLabel === label)
  const chainedAway = async (P, o) => {
    const s = await P.read()
    const t = Object.values(s.relationships).flatMap((r) => r.tuples).find((x) => x.rkid === o.envelope.rkid)
    return t.deactivated && tupleOf(s, t.ownPairLabel) !== undefined
  }
  const refusedOn = async (P, outbound, when) => {
    for (const o of outbound) {
      assert.ok(await chainedAway(P, o), 'sent on the tuple the chaining deactivated')
      const r = await P.h.receive(o.envelope, when)
      assert.deepEqual([r.disposition, r.ref], ['failed', 'RLTP-TRU-6240'], o.type)
    }
  }
  // the offer and the declaration: R and M meet again before they arrive
  {
    const M = await person(0x7a), R = await person(0x7b), Tt = await person(0x7c)
    const mr = await met(R, M, T0)
    const mt = await met(Tt, M, T0 + 10_000)
    const intro = await M.h.introduce(mr.b.id, mt.b.id, opts(T0 + 20_000, { label: 'Tia' }))
    await met(R, M, T0 + 21_000)
    await refusedOn(R, intro.outbound, T0 + 26_000)
    assert.deepEqual((await R.h.prompts()).filter((p) => p.kind === 'introduction'), [], 'no prompt opens')
    assert.deepEqual((await R.read()).encounter.offers, {})
  }
  // the request: R and M meet again before it reaches M
  {
    const { M, R, T: Tt, intro } = await offered()
    await settle([M, R, Tt], intro.outbound, T0 + 21_000)
    const [po] = await R.h.prompts()
    const req = await R.h.decide(po.id, 'accept', opts(T0 + 22_000))
    await met(R, M, T0 + 23_000)
    await refusedOn(M, req.outbound, T0 + 28_000)
    assert.deepEqual(Object.values((await M.read()).encounter.introductions).filter((a) => a.role === 'mediator'), [], 'no act at the mediator')
  }
  // the forward: T and M meet again before it reaches T
  {
    const { M, R, T: Tt, intro } = await offered()
    await settle([M, R, Tt], intro.outbound, T0 + 21_000)
    const [po] = await R.h.prompts()
    const req = await R.h.decide(po.id, 'accept', opts(T0 + 22_000))
    const got = await M.h.receive(req.outbound[0].envelope, T0 + 23_000)
    const fwd = got.outbound.filter((o) => o.type === T.forward)
    assert.equal(fwd.length, 1)
    await met(Tt, M, T0 + 24_000)
    await refusedOn(Tt, fwd, T0 + 29_000)
    assert.deepEqual((await Tt.h.prompts()).filter((p) => p.kind === 'introduction'), [], 'no consent prompt')
  }
})

test('m2: an offer outside the act window is refused — a transport replay after tick dropped its effect-cache entry opens no prompt again (8110)', async () => {
  const DAY = 86_400_000
  const { R, intro } = await offered()
  const offer = intro.outbound.find((o) => o.type === T.offer)
  for (const o of intro.outbound) assert.equal((await R.h.receive(o.envelope, T0 + 21_000)).disposition, 'unique')
  assert.equal((await R.h.prompts()).filter((p) => p.kind === 'introduction').length, 1)
  // the replay within the cache: a duplicate
  assert.equal((await R.h.receive(offer.envelope, T0 + 22_000)).disposition, 'duplicate-known')
  // after key-retention tick drops the cache entry and the expired prompt
  await R.h.tick(T0 + 91 * DAY)
  assert.equal(Object.hasOwn((await R.read()).effects, offer.digest), false, 'the effect-cache entry is gone')
  assert.deepEqual(await R.h.prompts(), [])
  const r = await R.h.receive(offer.envelope, T0 + 91 * DAY + 1000)
  assert.deepEqual([r.disposition, r.ref], ['failed', 'RLTP-TRU-8110'])
  assert.deepEqual(await R.h.prompts(), [], 'no prompt opens again')
})

/** A scans B's card and B confirms, like met(), with every result's events kept. */
async function metLogged (A, B, t) {
  const { sc, bundle } = await scanned(A, B, t)
  const got = await B.h.receive(bundle.envelope, t + 2000)
  const prompt = (await B.h.prompts()).find((p) => p.kind === 'encounter-confirm')
  const d = await B.h.decide(prompt.id, 'accept', opts(t + 3000))
  const s = await settle([A, B], [...got.outbound, ...d.outbound], t + 4000)
  return [sc, got, d, ...s.map((x) => x.got)].flatMap((r) => r.events ?? [])
}
/** The holder's live relationships with their provenance (husks left out). */
const liveRels = async (P) => Object.values((await P.read()).relationships).filter((r) => r.tuples.length > 0)

/** M introduces R to T (M knows both as `rId`, `tId`), the act run to its end at `t`. */
async function introduce (M, R, Tt, rId, tId, t) {
  const intro = await M.h.introduce(rId, tId, opts(t, { label: 'Tia' }))
  assert.equal(intro.ok, true, JSON.stringify(intro))
  const log = await settle([M, R, Tt], intro.outbound, t + 1000)
  const po = (await R.h.prompts()).find((p) => p.kind === 'introduction')
  log.push(...await settle([M, R, Tt], (await R.h.decide(po.id, 'accept', opts(t + 2000))).outbound, t + 3000))
  const pt = (await Tt.h.prompts()).find((p) => p.kind === 'introduction')
  log.push(...await settle([M, R, Tt], (await Tt.h.decide(pt.id, 'accept', opts(t + 4000))).outbound, t + 5000))
  log.push(...await settle([M, R, Tt], [], t + 5000 + ACK_DELAY))
  return log.flatMap((x) => x.got.events ?? [])
}

/** The live relationship of P's contact other than `mId`, and that contact. */
async function theOther (P, mId) {
  const cs = (await P.h.contacts()).filter((c) => c.id !== mId)
  assert.equal(cs.length, 1, JSON.stringify(cs))
  assert.equal(cs[0].relationships.length, 1, 'one relationship, the chain')
  return { c: cs[0], rel: (await P.read()).relationships[cs[0].relationships[0].id] }
}

test('provenance: an encounter chained onto an introduced relationship sets it to ceremony on both sides, the introducer gone from the contact (8790, 8800)', async () => {
  const { M, R, T: Tt, mr, mt } = await completed()
  const [rM, tM] = [mr.a.id, mt.a.id]   // R's and T's contact for M
  const at = new Map()
  for (const P of [R, Tt]) {
    const intro = (await liveRels(P)).filter((r) => r.provenance.kind === 'introduced')
    assert.equal(intro.length, 1, 'one introduced relationship before the encounter')
    at.set(P, intro[0].provenance.at)
  }
  const events = await metLogged(R, Tt, T0 + 60_000)
  const chained = events.filter((e) => e.type === 'contact.chained')
  assert.equal(chained.length, 2, JSON.stringify(events.map((e) => e.type)))
  for (const [P, mId] of [[R, rM], [Tt, tM]]) {
    const { c, rel } = await theOther(P, mId)
    assert.equal(c.relationships[0].tuples, 2)
    assert.deepEqual([c.provenance, c.via], ['ceremony', undefined])
    assert.deepEqual([rel.provenance.kind, rel.provenance.via, rel.provenance.viaPin], ['ceremony', undefined, undefined])
    assert.equal(rel.provenance.at, at.get(P), 'at the chain\'s time')
  }
})

test('provenance: an introduction chained onto a ceremony relationship leaves it ceremony (8800, never downward)', async () => {
  const M = await person(0x81), R = await person(0x82), Tt = await person(0x83)
  const mr = await met(R, M, T0)
  const mt = await met(Tt, M, T0 + 10_000)
  await met(R, Tt, T0 + 20_000)
  const events = await introduce(M, R, Tt, mr.b.id, mt.b.id, T0 + 30_000)
  assert.equal(events.filter((e) => e.type === 'contact.chained').length, 2, 'the introduced tuple chains on both sides')
  for (const [P, mId] of [[R, mr.a.id], [Tt, mt.a.id]]) {
    const { c, rel } = await theOther(P, mId)
    assert.equal(c.relationships[0].tuples, 2)
    assert.deepEqual([c.provenance, c.via], ['ceremony', undefined])
    assert.deepEqual([rel.provenance.kind, rel.provenance.via, rel.provenance.viaPin], ['ceremony', undefined, undefined])
  }
})

test('provenance: a second introduction chained onto an introduced relationship stays introduced with the first introducer (8800)', async () => {
  const M1 = await person(0x84), M2 = await person(0x85), R = await person(0x86), Tt = await person(0x87)
  const m1r = await met(R, M1, T0), m1t = await met(Tt, M1, T0 + 10_000)
  const m2r = await met(R, M2, T0 + 20_000), m2t = await met(Tt, M2, T0 + 30_000)
  await introduce(M1, R, Tt, m1r.b.id, m1t.b.id, T0 + 40_000)
  const first = {}
  for (const [P, m1] of [[R, m1r.a.id], [Tt, m1t.a.id]]) first[m1] = (await P.h.contacts()).find((c) => c.provenance === 'introduced').via
  assert.deepEqual(Object.entries(first).map(([m1, via]) => via === m1), [true, true], 'introduced via M1')
  const events = await introduce(M2, R, Tt, m2r.b.id, m2t.b.id, T0 + 100_000)
  assert.equal(events.filter((e) => e.type === 'contact.chained').length, 2, 'the second introduced tuple chains on both sides')
  for (const [P, m1, m2] of [[R, m1r.a.id, m2r.a.id], [Tt, m1t.a.id, m2t.a.id]]) {
    const cs = (await P.h.contacts()).filter((c) => c.id !== m1 && c.id !== m2)
    assert.equal(cs.length, 1, JSON.stringify(cs))
    assert.deepEqual([cs[0].relationships.length, cs[0].relationships[0].tuples], [1, 2])
    assert.deepEqual([cs[0].provenance, cs[0].via], ['introduced', m1])
    assert.equal((await P.read()).relationships[cs[0].relationships[0].id].provenance.via, m1)
  }
})

// ── A20: the requester waits until the act's expiry (spec follow-up 18) ──

test('A20: the mediator offline for 48 hours — the request held, then delivered; the mediator acks and forwards, the target consents, the act completes at the requester with one introduced relationship (8340, 8640; A20, spec follow-up 18)', async () => {
  const { M, R, T: Tt, mr, intro } = await offered()
  await settle([M, R, Tt], intro.outbound, T0 + 21_000)
  const [po] = await R.h.prompts()
  const req = await R.h.decide(po.id, 'accept', opts(T0 + 22_000))
  assert.equal(req.ok, true)
  // the mediator is offline: nothing reaches it; the requester ticks hourly and keeps waiting
  for (let t = T0 + 22_000 + 3_600_000; t <= T0 + 22_000 + 47 * 3_600_000; t += 3_600_000) {
    await R.h.tick(t)
    assert.equal(Object.values((await R.read()).encounter.introductions)[0].status, 'sent', `still sent at +${(t - T0 - 22_000) / 3_600_000} h`)
  }
  // at +48 h the mediator is back: the request arrives, is forwarded; the target consents
  const t48 = T0 + 22_000 + 48 * 3_600_000
  await settle([M, R, Tt], req.outbound, t48)
  const [pt] = await Tt.h.prompts()
  assert.equal(pt.kind, 'introduction')
  await settle([M, R, Tt], (await Tt.h.decide(pt.id, 'accept', opts(t48 + 1000))).outbound, t48 + 2000)
  // the ack at t_received + ack-delay (8640)
  const s = await settle([M, R, Tt], [], t48 + ACK_DELAY)
  assert.ok(kinds(s).includes(T.ack))
  const act = Object.values((await R.read()).encounter.introductions)[0]
  assert.deepEqual([act.status, act.vouched], ['completed', true])
  const intro2 = (await R.h.contacts()).filter((c) => c.provenance === 'introduced')
  assert.equal(intro2.length, 1, 'one introduced relationship')
  assert.equal(intro2[0].via, mr.a.id)
  assert.equal((await Tt.h.contacts()).filter((c) => c.provenance === 'introduced').length, 1)
})

test('A20: no ack and no reply at all — the requester fails exactly at the act\'s expiry, not before (8340, 8140; A20, spec follow-up 18)', async () => {
  const { M, R, T: Tt, intro } = await offered()
  await settle([M, R, Tt], intro.outbound, T0 + 21_000)
  const [po] = await R.h.prompts()
  assert.equal((await R.h.decide(po.id, 'accept', opts(T0 + 22_000))).ok, true)
  const a0 = Object.values((await R.read()).encounter.introductions)[0]
  const expiry = actFiresAt(a0.issuedAt + 72 * 3_600_000)
  await R.h.tick(T0 + 22_000 + ACK_DELAY + 5 * 60_000 + 1000)
  assert.equal(Object.values((await R.read()).encounter.introductions)[0].status, 'sent', 'no failure at the former ack timeout')
  await R.h.tick(expiry - 1000)
  assert.equal(Object.values((await R.read()).encounter.introductions)[0].status, 'sent', 'a second before the expiry')
  await R.h.tick(expiry)
  assert.equal(Object.values((await R.read()).encounter.introductions)[0].status, 'failed', 'at the expiry')
})
