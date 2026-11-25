// shared-connect 0.1 without a carrier (shared-connect-holder.ts, "the offline path"): the link shown in
// person carries the inviter's card, the back-code the responder's. After the two codes both holders hold
// a contact they can trust and invite into a group; the acceptance, the credentials and the receipts follow by a
// carrier and complete the same enactment.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sharedConnect as sc, SC_PROMPT } from '../dist/index.js'
import { Inviter, Responder } from '../dist/shared-connect-flow.js'
import { T0, person, ev, opts } from './holder-fixture.mjs'

const MED = { kind: 'tsp-mediator', address: 'did:webvh:QmUTUkdHgppiciLpqcxkTi6Pbc9VuZzWXvH4L2Dk2dY2WL:mediator.web-of-trust.de' }
const HINT = (who) => JSON.stringify({ id: `did:key:z6Mkconn${who}#tsp`, serviceEndpoint: MED.address, type: 'TSPTransport' })
const offer = (fill, who) => ({ nonce: new Uint8Array(32).fill(fill), deliveryHints: [HINT(who)] })
const sends = (r) => ev(r, 'sharedconnect.send').flatMap((e) => e.docs.map((d) => ({ to: e.to, doc: d })))
/** carry every document of `r` and of what it causes, until nothing moves */
async function carryAll (r, from, holders, t) {
  let wave = [{ from, r }]
  for (let i = 0; i < 12 && wave.length; i++) {
    const next = []
    for (const w of wave) {
      for (const { to, doc } of sends(w.r)) {
        const h = holders.find((x) => sc.sameVid(x.did, to))
        const rr = await h.p.h.sharedConnectReceive(doc, w.from.did, t += 1000)
        assert.equal(rr.ok, true, JSON.stringify(rr))
        next.push({ from: h, r: rr })
      }
    }
    wave = next
  }
  return t
}
const params = (code) => new Map(code.slice(code.indexOf('#') + 1).split('&').map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]))

test('offline: two codes and no carrier leave both sides with a contact they can trust and invite; the documents follow and complete the enactment', async () => {
  const A = await person(70), B = await person(71)
  let t = T0
  for (const P of [A, B]) assert.equal((await P.h.foundPersonalCommunity({ name: 'me' }, opts(t += 1000))).ok, true)
  // first code: A's link carries A's card (pair anchor, key agreement key, delivery hints, proof)
  const shown = await A.h.sharedConnectShow({ relays: [MED], name: 'Anton', carrier: offer(0xa1, 'A') }, opts(t += 1000))
  const [s] = ev(shown, 'sharedconnect.shown')
  const lp = params(s.link)
  for (const k of ['rel', 't', 'ka', 'h', 'csig']) assert.ok(lp.has(k), 'the link carries ' + k)
  assert.ok(s.link.length <= 990, 'the link with the card stays under the budget: ' + s.link.length)
  const read = await sc.readSharedConnectLink(s.link, Math.floor(t / 1000))
  assert.equal(read.ok, true); assert.equal(read.link.card.anchor, lp.get('rel')); assert.deepEqual(read.link.card.deliveryHints, [HINT('A')])
  const a = { p: A, did: s.did }
  // B scans and proposes; nothing is carried
  const prop = await B.h.sharedConnectPropose({ link: s.link, relays: [MED], channel: 'scan', name: 'Bea', carrier: offer(0xb1, 'B') }, opts(t += 1000))
  assert.equal(prop.ok, true, JSON.stringify(prop))
  const b = { p: B, did: ev(prop, 'sharedconnect.proposed')[0].did }
  assert.equal((await B.h.contacts()).length, 0, 'the proposal alone opens nothing')
  // second code: B shows its proposal back, with its card; B's contact opens from A's card in the link
  const back = await B.h.sharedConnectBack({ id: s.id }, opts(t += 1000))
  assert.equal(back.ok, true, JSON.stringify(back))
  const code = ev(back, 'sharedconnect.shown')[0].link
  assert.equal(ev(back, 'contact.added').length, 1)
  const [cB] = await B.h.contacts()
  const relB = Object.values((await B.read()).relationships)[0]
  assert.equal(relB.tuples[0].counterpartAnchor, lp.get('rel')); assert.equal(relB.tuples[0].counterpartKeyAgreement, lp.get('ka'))
  assert.deepEqual(cB.relationships[0].counterpartDeliveryHints, [HINT('A')])
  assert.equal(cB.sharedConnect.met, true); assert.equal(cB.sharedConnect.channel, 'scan')
  // A's camera reads the back-code: the confirmation opens, with the name; no contact before the person accepts
  const got = await A.h.sharedConnectReadBack(s.id, code, t += 1000)
  assert.equal(got.ok, true, JSON.stringify(got))
  assert.deepEqual(ev(got, 'prompt.opened').map((e) => e.kind), [SC_PROMPT])
  const [pend] = ev(got, 'sharedconnect.pending'); assert.equal(pend.name, 'Bea')
  assert.equal((await A.h.contacts()).length, 0)
  const dec = await A.h.decide(pend.promptId, 'accept', opts(t += 1000))
  assert.equal(dec.ok, true, JSON.stringify(dec)); assert.equal(ev(dec, 'contact.added').length, 1)
  const [cA] = await A.h.contacts()
  const bp = params(code)
  const relA = Object.values((await A.read()).relationships)[0]
  assert.equal(relA.tuples[0].counterpartAnchor, bp.get('rel')); assert.equal(relA.tuples[0].counterpartKeyAgreement, bp.get('ka'))
  assert.deepEqual(cA.relationships[0].counterpartDeliveryHints, [HINT('B')])
  assert.equal(cA.sharedConnect.met, true)
  // each side's tuple is toward the other's own pair
  assert.equal(relA.tuples[0].counterpartAnchor, (await B.read()).sharedConnect.enactments[s.id].flow.propose.payload.relationshipDid)
  assert.equal(relB.tuples[0].counterpartAnchor, (await A.read()).sharedConnect.enactments[s.id].flow.accept.payload.relationshipDid)
  // both can trust at once and invite into a group; both enactments are still open. A message waits, as on
  // every fresh tuple, for the first document of the counterpart (Message Tasks 5.1)
  for (const [P, c] of [[A, cA], [B, cB]]) {
    const given = await P.h.trust(c.id, opts(t += 1000)); assert.equal(given.ok, true, JSON.stringify(given))
    const founded = await P.h.foundGroup({ name: 'g' }, opts(t += 1000)); assert.equal(founded.ok, true, JSON.stringify(founded))
    const inv = await P.h.invite(ev(founded, 'group.founded')[0].groupId, c.id, opts(t += 1000)); assert.equal(inv.ok, true, JSON.stringify(inv))
    assert.deepEqual(await P.h.sendMessage(c.id, 'hello', opts(t += 1000)), { ok: false, code: 'not-ready', ref: 'RLTP-MSG-5020' })
  }
  assert.deepEqual((await A.h.sharedConnect()).map((v) => v.status), ['open']); assert.deepEqual((await B.h.sharedConnect()).map((v) => v.status), ['open'])
  // a carrier comes: A's acceptance and issue go out (the outbox names them), everything completes, nothing opens twice
  assert.deepEqual((await A.h.sharedConnect())[0].outbox.map((d) => d.type), [sc.TASK_PROPOSE + '#response', sc.TASK_ISSUE])
  await carryAll(dec, a, [a, b], t)
  for (const P of [A, B]) {
    const [v] = await P.h.sharedConnect()
    assert.equal(v.status, 'complete'); assert.equal((await P.h.contacts()).length, 1)
    assert.equal(Object.keys((await P.read()).relationships).length, 1)
    assert.equal(v.contactId, (await P.h.contacts())[0].id)
  }
  assert.equal((await A.h.contact(cA.id)).sharedConnect.theirChannel, 'scan')
})

test('offline: the back-code is the same every time and opens once; it is refused for a link not scanned and for a link without a card', async () => {
  const A = await person(72), B = await person(73), C = await person(74), D = await person(75)
  let t = T0
  const [s] = ev(await A.h.sharedConnectShow({ relays: [MED] }, opts(t)), 'sharedconnect.shown')
  assert.ok(!params(s.link).has('h'), 'no hints without a carrier offer')
  assert.equal((await B.h.sharedConnectPropose({ link: s.link, relays: [MED], channel: 'scan' }, opts(t += 1000))).ok, true)
  const one = await B.h.sharedConnectBack({ id: s.id }, opts(t += 1000)), two = await B.h.sharedConnectBack({ id: s.id }, opts(t += 60_000))
  assert.equal(ev(one, 'sharedconnect.shown')[0].link, ev(two, 'sharedconnect.shown')[0].link)
  assert.equal(ev(two, 'contact.added').length, 0); assert.equal((await B.h.contacts()).length, 1)
  // the link opened elsewhere (`link`): not met, nothing opens without a carrier
  assert.equal((await C.h.sharedConnectPropose({ link: s.link, relays: [MED], channel: 'link' }, opts(t += 1000))).ok, true)
  assert.deepEqual(await C.h.sharedConnectBack({ id: s.id }, opts(t += 1000)), { ok: false, code: 'not-met' })
  // a sent link carries no card
  const [s2] = ev(await A.h.sharedConnectShow({ relays: [MED], channel: 'sent', minutes: 60 }, opts(t += 1000)), 'sharedconnect.shown')
  assert.ok(!params(s2.link).has('csig'))
  assert.equal((await D.h.sharedConnectPropose({ link: s2.link, relays: [MED], channel: 'scan' }, opts(t += 1000))).ok, true)
  assert.deepEqual(await D.h.sharedConnectBack({ id: s2.id }, opts(t += 1000)), { ok: false, code: 'no-card' })
  assert.deepEqual(await D.h.sharedConnectBack({ id: 'nope' }, opts(t += 1000)), { ok: false, code: 'enactment-unknown' })
  // after the link expired the inviter would refuse the proposal: no back-code, no contact
  const E = await person(81)
  const [s3] = ev(await A.h.sharedConnectShow({ relays: [MED], minutes: 1 }, opts(t += 1000)), 'sharedconnect.shown')
  assert.equal((await E.h.sharedConnectPropose({ link: s3.link, relays: [MED], channel: 'scan' }, opts(t += 1000))).ok, true)
  assert.deepEqual(await E.h.sharedConnectBack({ id: s3.id }, opts(t += 60_000)), { ok: false, code: 'enactment-closed', ref: 'expired' })
  assert.equal((await E.h.contacts()).length, 0)
  assert.equal((await D.h.contacts()).length, 0)
})

test('offline: a card that does not verify refuses its code; a back-code without a card is a proposal and opens nothing early', async () => {
  const A = await person(76), B = await person(77), C = await person(78)
  let t = T0
  const [s] = ev(await A.h.sharedConnectShow({ relays: [MED], name: 'Anton' }, opts(t)), 'sharedconnect.shown')
  const other = params(ev(await C.h.sharedConnectShow({ relays: [MED] }, opts(t)), 'sharedconnect.shown')[0].link)
  // another pair's key agreement key under A's anchor: the proof fails, the link is refused
  const forged = s.link.replace('&ka=' + params(s.link).get('ka'), '&ka=' + other.get('ka'))
  assert.deepEqual(await sc.readSharedConnectLink(forged, Math.floor(t / 1000)), { ok: false, reason: 'bad-card' })
  assert.deepEqual(await B.h.sharedConnectPropose({ link: forged, relays: [MED], channel: 'scan' }, opts(t += 1000)), { ok: false, code: 'link-invalid', ref: 'bad-card' })
  // a card with a part missing is no card
  assert.deepEqual(await sc.readSharedConnectLink(s.link.replace(/&ka=[^&]*/, ''), Math.floor(t / 1000)), { ok: false, reason: 'bad-card' })
  // a reader passes over the names when there is no `csig`: the link without the card reads as before
  const bare = s.link.replace(/&csig=[^&]*/, '')
  const r = await sc.readSharedConnectLink(bare, Math.floor(t / 1000)); assert.equal(r.ok, true); assert.equal(r.link.card, undefined)
  // B answers the true link and shows back; a changed key in the back-code is refused, the proposal is not taken
  assert.equal((await B.h.sharedConnectPropose({ link: s.link, relays: [MED], channel: 'scan', name: 'Bea' }, opts(t += 1000))).ok, true)
  const code = ev(await B.h.sharedConnectBack({ id: s.id }, opts(t += 1000)), 'sharedconnect.shown')[0].link
  const bad = await A.h.sharedConnectReadBack(s.id, code.replace('&ka=' + params(code).get('ka'), '&ka=' + other.get('ka')), t += 1000)
  assert.equal(bad.ok, true); assert.deepEqual(ev(bad, 'sharedconnect.refused').map((e) => e.reason), ['back-code']); assert.equal(ev(bad, 'sharedconnect.pending').length, 0)
  assert.deepEqual(await A.h.sharedConnectReadBack('nope', code, t += 1000), { ok: false, code: 'enactment-unknown' })
  // the back-code without the card (as 0.20.0 wrote it): the proposal is taken, the person accepts, no contact yet
  const propose = (await B.read()).sharedConnect.enactments[s.id].flow.propose
  const got = await A.h.sharedConnectReadBack(s.id, sc.backCodeOf(propose), t += 1000)
  const [pend] = ev(got, 'sharedconnect.pending'); assert.ok(pend)
  const dec = await A.h.decide(pend.promptId, 'accept', opts(t += 1000)); assert.equal(dec.ok, true)
  assert.equal((await A.h.contacts()).length, 0, 'without the card the contact waits for the issue step')
  // the code with the card, read afterwards (the same proposal): the contact opens now
  const late = await A.h.sharedConnectReadBack(s.id, code, t += 1000)
  assert.equal(late.ok, true, JSON.stringify(late)); assert.equal(ev(late, 'contact.added').length, 1); assert.equal((await A.h.contacts()).length, 1)
})

test('offline: a contact opened from a code stays when the inviter declines, and its enactment is kept', async () => {
  const A = await person(79), B = await person(80)
  let t = T0
  const [s] = ev(await A.h.sharedConnectShow({ relays: [MED] }, opts(t)), 'sharedconnect.shown')
  const prop = await B.h.sharedConnectPropose({ link: s.link, relays: [MED], channel: 'scan' }, opts(t += 1000))
  const bDid = ev(prop, 'sharedconnect.proposed')[0].did
  const code = ev(await B.h.sharedConnectBack({ id: s.id }, opts(t += 1000)), 'sharedconnect.shown')[0].link
  const [pend] = ev(await A.h.sharedConnectReadBack(s.id, code, t += 1000), 'sharedconnect.pending')
  const dec = await A.h.decide(pend.promptId, 'decline', opts(t += 1000))
  assert.equal((await A.h.contacts()).length, 0)
  const [{ doc }] = sends(dec)
  const atB = await B.h.sharedConnectReceive(doc, s.did, t += 1000)
  assert.equal(ev(atB, 'sharedconnect.declined').length, 1); assert.ok(bDid)
  assert.equal((await B.h.contacts()).length, 1, 'the responder opened when it showed the code')
  // long after: the declined enactment that opened a contact is still there
  await B.h.tick(t += 40 * 24 * 3_600_000)
  assert.equal((await B.h.sharedConnect()).length, 1); assert.equal((await B.h.sharedConnect())[0].status, 'declined')
  await A.h.tick(t)
  assert.equal((await A.h.sharedConnect()).length, 0, 'the inviter\'s declined enactment left as before')
})

test('offline, the step machines: the acceptance must name the pair of the card in the link, the issue the same key agreement key', async () => {
  const seed = (n) => new Uint8Array(32).fill(n)
  const ch = (n) => sc.challengeOf16(new Uint8Array(16).fill(n))
  const now = Date.parse('2026-11-25T10:00:00Z'), nowS = now / 1000
  const xMk = async (n) => (await import('../dist/crypto.js')).mkOfX((await (await import('../dist/crypto.js')).xFromSeed(seed(n))).pubRaw)
  const inviter = await sc.partyFromSeeds(seed(1), seed(2), [MED], 'Anton'); inviter.pair.keyAgreement = await xMk(3)
  const stranger = await sc.partyFromSeeds(seed(4), seed(5), [MED]); stranger.pair.keyAgreement = await xMk(6)
  const responder = await sc.partyFromSeeds(seed(7), seed(8), [MED], 'Bea'); responder.pair.keyAgreement = await xMk(9)
  let n = 0; const o = { newId: () => 'doc-' + (++n), card: true }
  const id = ch(1)
  const bound = await sc.linkCardChallenge(inviter.messaging.did, id, nowS + 600)
  const linkWith = async (card) => (await sc.readSharedConnectLink(await sc.sharedConnectLink({ from: inviter.messaging.did, id, exp: nowS + 600, card }, undefined, nowS), nowS)).link
  // a card over the handle alone, or made for another messaging identity, is no card of this link
  await assert.rejects(sc.sharedConnectLink({ from: inviter.messaging.did, id, exp: nowS + 600, card: await sc.issueCard(inviter, id, now) }, undefined, nowS))
  const foreign = await sc.sharedConnectLink({ from: stranger.messaging.did, id, exp: nowS + 600, card: await sc.issueCard(stranger, await sc.linkCardChallenge(stranger.messaging.did, id, nowS + 600), now) }, undefined, nowS)
  assert.deepEqual(await sc.readSharedConnectLink(foreign.replace(stranger.messaging.did, inviter.messaging.did), nowS), { ok: false, reason: 'bad-card' })
  // a stranger that signs its card for the inviter's link (the two act together); the inviter accepts under its own pair: refused
  const R1 = new Responder(responder, await linkWith(await sc.issueCard(stranger, bound, now)), ch(2), 'scan', o)
  const I1 = new Inviter(inviter, { id, exp: nowS + 600 }, o)
  const [p1] = (await R1.start(now)).send
  await I1.receive(p1, responder.messaging.did, now)
  const [acc] = (await I1.accept(now, 'displayed')).send
  assert.deepEqual((await R1.receive(acc, inviter.messaging.did, now)).events, [{ kind: 'refused', type: sc.TASK_PROPOSE + '#response', reason: 'card' }])
  // the link carries the inviter's card with one key, its issue a card with another: refused
  const R2 = new Responder(responder, await linkWith(await sc.issueCard(inviter, bound, now)), ch(3), 'scan', o)
  const other = { ...inviter, pair: { ...inviter.pair, keyAgreement: await xMk(10) } }
  const I2 = new Inviter(other, { id, exp: nowS + 600 }, o)
  const [p2] = (await R2.start(now)).send
  await I2.receive(p2, responder.messaging.did, now)
  const [acc2, iss2] = (await I2.accept(now, 'displayed')).send
  assert.equal((await R2.receive(acc2, inviter.messaging.did, now)).events[0].kind, 'accepted')
  assert.deepEqual((await R2.receive(iss2, inviter.messaging.did, now)).events, [{ kind: 'refused', type: sc.TASK_ISSUE, reason: 'card' }])
  // the back-code: only for a scanned code with a card; the inviter keeps the card it carries
  assert.equal(await new Responder(responder, await linkWith(undefined), ch(4), 'scan', o).back(), null)
  const code = await R2.back()
  assert.ok(code.includes('/vti/flow/shared-connect/0.1/back') && code.includes('&csig='))
  assert.equal(R2.theirPair, inviter.pair.anchor, 'the pair is known from the card once the code was shown')
  const I3 = new Inviter(inviter, { id, exp: nowS + 600 }, o)
  assert.equal((await I3.receiveBack(code, now)).events[0].kind, 'proposed')
  assert.equal(I3.snapshot().codeCard.anchor, responder.pair.anchor)
  // the same key whichever came first: the issue by a carrier with one key, then a code with another
  const R4 = new Responder(responder, await linkWith(await sc.issueCard(inviter, bound, now)), ch(5), 'scan', o)
  const I4 = new Inviter(inviter, { id, exp: nowS + 600 }, o)
  const [p4] = (await R4.start(now)).send
  await I4.receive(p4, responder.messaging.did, now)
  const [acc4] = (await I4.accept(now, 'displayed')).send
  const [iss4] = (await R4.receive(acc4, inviter.messaging.did, now)).send
  assert.equal((await I4.receive(iss4, responder.messaging.did, now)).events[0].kind, 'credential')
  const otherKey = { ...responder, pair: { ...responder.pair, keyAgreement: await xMk(11) } }
  const codeOther = sc.backCodeOf(p4, undefined, await sc.issueCard(otherKey, p4.id, Date.parse(p4.issuedAt)))
  assert.deepEqual((await I4.receiveBack(codeOther, now)).events, [{ kind: 'refused', type: sc.TASK_PROPOSE, reason: 'card' }])
  assert.equal(I4.snapshot().codeCard, undefined)
  // an enactment that ended takes nothing from a code and shows none
  const R5 = new Responder(responder, await linkWith(await sc.issueCard(inviter, bound, now)), ch(6), 'scan', o)
  const I5 = new Inviter(inviter, { id, exp: nowS + 600 }, o)
  const [p5] = (await R5.start(now)).send
  await I5.receive(p5, responder.messaging.did, now)
  const [dec5] = (await I5.decline(now)).send
  const code5 = await R5.back()
  assert.deepEqual(await I5.receiveBack(code5, now), { send: [], events: [{ kind: 'ignored', type: sc.TASK_PROPOSE, why: 'after-decision' }], finished: true })
  await R5.receive(dec5, inviter.messaging.did, now)
  assert.equal(await R5.back(), null)
  // hints too long for one code: the back-code goes without them
  const big = new Responder(responder, await linkWith(await sc.issueCard(inviter, bound, now)), ch(7), 'scan', { ...o, deliveryHints: Array.from({ length: 8 }, (_, i) => String(i).repeat(512)) })
  await big.start(now)
  const codeBig = await big.back()
  assert.ok(codeBig.length <= sc.BACK_BUDGET && !codeBig.includes('&h='), 'length ' + codeBig.length)
})
