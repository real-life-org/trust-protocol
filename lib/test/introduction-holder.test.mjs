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
import { T0, opts, settle, met, person } from './holder-fixture.mjs'

const TT = 'https://real-life.org/trust-tasks/'
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

test('introduction: without an ack in time the requester fails at t_sent + ack-delay + act-skew (8690); a request to a mediator whose declaration is not held is refused (Delivery 4.4)', async () => {
  const { M, R, T: Tt, intro } = await offered()
  // the declaration lost: the offer alone arrives
  await settle([M, R, Tt], intro.outbound.filter((o) => o.type === T.offer), T0 + 21_000)
  const [po] = await R.h.prompts()
  assert.deepEqual(await R.h.decide(po.id, 'accept', opts(T0 + 22_000)), { ok: false, code: 'no-declaration' })
  await settle([M, R, Tt], intro.outbound.filter((o) => o.type === T.declaration), T0 + 22_500)
  const req = await R.h.decide(po.id, 'accept', opts(T0 + 23_000))
  assert.equal(req.ok, true)
  // the request never arrives; at the bound it is still sent, a second after it failed (8140)
  const bound = T0 + 23_000 + ACK_DELAY + 5 * 60_000
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

test('introduction: a reply that reaches a requester after its ack timeout is ignored; the mediator completes regardless — the role divergence of 8400 (8350, 8690)', async () => {
  const { M, R, T: Tt, intro } = await offered()
  await settle([M, R, Tt], intro.outbound, T0 + 21_000)
  const [po] = await R.h.prompts()
  // the request arrives, but no resume at the mediator: its ack stays unproduced
  const req = await R.h.decide(po.id, 'accept', opts(T0 + 22_000))
  const fwd = await M.h.receive(req.outbound[0].envelope, T0 + 22_500)
  await R.h.receive(fwd.outbound[0].envelope, T0 + 22_600)       // the delivery ack back to R
  await Tt.h.receive(fwd.outbound[1].envelope, T0 + 22_700)      // the forward
  const late = T0 + 22_000 + ACK_DELAY + 5 * 60_000 + 2000
  const [pt] = await Tt.h.prompts()
  const rep = await Tt.h.decide(pt.id, 'accept', opts(late))
  const relayed = await M.h.receive(rep.outbound[0].envelope, late + 100)
  const toR = relayed.outbound.find((o) => o.type === T.reply)
  const got = await R.h.receive(toR.envelope, late + 200)
  assert.equal(got.disposition, 'unique', 'acknowledged, and ignored')
  const act = Object.values((await R.read()).encounter.introductions)[0]
  assert.equal(act.reply, null)
  assert.equal((await R.h.contacts()).filter((c) => c.provenance === 'introduced').length, 0)
  assert.equal(Object.values((await Tt.read()).encounter.introductions)[0].status, 'consented', 'the target consented: the divergence the retry converges (8400)')
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

test('timer: the requester\'s ack timeout and its act\'s lifetime are named by nextDueAt; tick at it fails the act (8690) with no other input', async () => {
  const { M, R, T: Tt, intro } = await offered()
  await settle([M, R, Tt], intro.outbound, T0 + 21_000)
  const [po] = await R.h.prompts()
  const req = await R.h.decide(po.id, 'accept', opts(T0 + 22_000))
  assert.equal(req.ok, true)
  // the request is never delivered: the ack never comes
  const a0 = Object.values((await R.read()).encounter.introductions)[0]
  const timeout = actFiresAt(a0.at + a0.ackDelayMs + 5 * 60_000)
  let at = T0 + 22_000, n = 0
  while (Object.values((await R.read()).encounter.introductions)[0].status === 'sent' && n++ < 50) {
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
