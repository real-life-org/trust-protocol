// shared-connect 0.1 without a carrier (shared-connect-holder.ts, "the offline path"): the link shown in
// person carries the inviter's card, the back-code the responder's. After the two codes both holders hold
// a contact they can trust and invite into a group; the acceptance, the credentials and the receipts follow by a
// carrier and complete the same enactment.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sharedConnect as sc, SC_PROMPT, seedKeys, createHolder } from '../dist/index.js'
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
  // first code: A's link carries A's card (pair anchor, key agreement key, proof) and no delivery hints
  const shown = await A.h.sharedConnectShow({ relays: [MED], name: 'Anton', carrier: offer(0xa1, 'A') }, opts(t += 1000))
  const [s] = ev(shown, 'sharedconnect.shown')
  const lp = params(s.link)
  for (const k of ['rel', 't', 'ka', 'csig']) assert.ok(lp.has(k), 'the link carries ' + k)
  assert.ok(!lp.has('h'))
  assert.ok(s.link.length <= 990, 'the link with the card stays under the budget: ' + s.link.length)
  const read = await sc.readSharedConnectLink(s.link, Math.floor(t / 1000))
  assert.equal(read.ok, true); assert.equal(read.link.card.anchor, lp.get('rel')); assert.equal(read.link.card.deliveryHints, undefined)
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
  assert.equal(cB.relationships[0].counterpartDeliveryHints, undefined, 'the hints come with the issue step')
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
  assert.equal(cA.relationships[0].counterpartDeliveryHints, undefined)
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
  // the issue steps brought the delivery hints: the relationship is carried now
  assert.deepEqual((await A.h.contact(cA.id)).relationships[0].counterpartDeliveryHints, [HINT('B')])
  assert.deepEqual((await B.h.contact(cB.id)).relationships[0].counterpartDeliveryHints, [HINT('A')])
})

test('offline: a name too long for the code shown in person costs the name, never the card; the scan still opens a contact', async () => {
  const A = await person(90), B = await person(91)
  let t = T0
  const read = async (link) => (await sc.readSharedConnectLink(link, Math.floor(t / 1000))).link
  // a short name travels with the card
  const [short] = ev(await A.h.sharedConnectShow({ relays: [MED], name: 'Ada' }, opts(t += 1000)), 'sharedconnect.shown')
  const rs = await read(short.link)
  assert.ok(rs.card); assert.equal(rs.label, 'Ada')
  // 64 CJK characters are a valid name, but with the card they exceed the link budget: the label goes, the card stays
  const [long] = ev(await A.h.sharedConnectShow({ relays: [MED], name: '字'.repeat(64) }, opts(t += 1000)), 'sharedconnect.shown')
  assert.ok(long.link.length <= sc.LINK_BUDGET)
  const rl = await read(long.link)
  assert.ok(rl.card, 'the card stays'); assert.equal(rl.label, undefined, 'the name goes')
  // the inviter's view names the link as written: without the label
  const views = await A.h.sharedConnect()
  assert.equal(views.find((v) => v.id === short.id).link.label, 'Ada')
  assert.equal(views.find((v) => v.id === long.id).link.label, null, 'the view states the link as written')
  // a name typed with a combining accent is stored as the link carries it (NFC), so both sides compare equal
  const [cafe] = ev(await A.h.sharedConnectShow({ relays: [MED], name: 'Cafe\u0301' }, opts(t += 1000)), 'sharedconnect.shown')
  assert.equal((await read(cafe.link)).label, 'Caf\u00e9')
  assert.equal((await A.h.sharedConnect()).find((v) => v.id === cafe.id).link.label, 'Caf\u00e9')
  // an invalid name (65 code points) is refused as before, never dropped
  assert.deepEqual(await A.h.sharedConnectShow({ relays: [MED], name: 'x'.repeat(65) }, opts(t += 1000)), { ok: false, code: 'link-invalid' })
  assert.equal((await B.h.sharedConnectPropose({ link: long.link, relays: [MED], channel: 'scan' }, opts(t += 1000))).ok, true)
  assert.equal(ev(await B.h.sharedConnectBack({ id: long.id }, opts(t += 1000)), 'sharedconnect.shown').length, 1, 'the back-code is shown: the card was there')
  assert.equal((await B.h.contacts()).length, 1)
  const [bv] = await B.h.sharedConnect()
  assert.equal(bv.link.label, null, 'the counterpart sees no name')
})

test('offline: the back-code is the same every time and opens once; it is refused for a link not scanned and for a link without a card', async () => {
  const A = await person(72), B = await person(73), C = await person(74), D = await person(75)
  let t = T0
  const [s] = ev(await A.h.sharedConnectShow({ relays: [MED] }, opts(t)), 'sharedconnect.shown')
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
  const codeOther = sc.backCodeOf(p4, undefined, await sc.issueCard(otherKey, await sc.backCardChallenge(p4.issuer, p4.id, id), Date.parse(p4.issuedAt)))
  assert.deepEqual((await I4.receiveBack(codeOther, now)).events, [{ kind: 'refused', type: sc.TASK_PROPOSE, reason: 'card' }])
  assert.equal(I4.snapshot().codeCard, undefined)
  // a back-code's card is made for one link: the same proposal and card shown for another handle of the inviter
  const I6 = new Inviter(inviter, { id: ch(9), exp: nowS + 600 }, o)
  assert.deepEqual((await I6.receiveBack(code, now)).events, [{ kind: 'refused', type: sc.TASK_PROPOSE, reason: 'back-code' }])
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
  // the code's card never carries this side's delivery hints
  const hinted = new Responder(responder, await linkWith(await sc.issueCard(inviter, bound, now)), ch(7), 'scan', { ...o, deliveryHints: ['hint'] })
  await hinted.start(now)
  assert.equal((await sc.readBackCode(await hinted.back(), { did: inviter.messaging.did, id })).card.deliveryHints, undefined)
  await assert.rejects(sc.sharedConnectLink({ from: inviter.messaging.did, id, exp: nowS + 600, card: await sc.issueCard({ ...inviter, deliveryHints: ['hint'] }, bound, now) }, undefined, nowS))
})

test('offline: a back-code too long for one QR code is not shown and opens nothing; the longest one that fits is shown', async () => {
  const A = await person(82)
  let t = T0
  const start = async (n, name) => {
    const B = await person(n)
    const [s] = ev(await A.h.sharedConnectShow({ relays: [MED] }, opts(t += 1000)), 'sharedconnect.shown')
    assert.equal((await B.h.sharedConnectPropose({ link: s.link, relays: [MED], channel: 'scan', name }, opts(t += 1000))).ok, true)
    return { B, id: s.id }
  }
  const nothingOpened = async ({ B, id }) => {
    assert.equal((await B.h.contacts()).length, 0)
    assert.equal(Object.keys((await B.read()).relationships).length, 0)
    const [v] = await B.h.sharedConnect()
    assert.equal(v.status, 'open'); assert.equal(v.contactId, null); assert.equal(v.outbox.length, 1, 'the proposal still goes out by a carrier')
    assert.equal((await B.read()).sharedConnect.enactments[id].flow.backShown, undefined)
  }
  // one enactment, the code's host walked down a character at a time on that same enactment: the
  // first code shown measures exactly the budget, and the one a character longer was refused. The
  // code's length varies by a character or two between enactments (base58 of random identifiers),
  // so nothing is calibrated on another one: the name puts the boundary near a host label of 30
  // characters, far from both ends of the walk (a DNS label holds 63)
  const host = (k) => 'https://' + 'a'.repeat(k) + '.org'
  const edge = await start(84, 'x'.repeat(430))
  const over = await edge.B.h.sharedConnectBack({ id: edge.id, origin: host(62) }, opts(t += 1000))
  assert.deepEqual(over, { ok: false, code: 'code-too-long' })
  await nothingOpened(edge)
  let shown = null
  let refused = 62
  for (let n = 61; n >= 1 && !shown; n--) {
    const r = await edge.B.h.sharedConnectBack({ id: edge.id, origin: host(n) }, opts(t += 1000))
    if (r.ok) shown = { n, link: ev(r, 'sharedconnect.shown')[0].link }
    else { assert.deepEqual(r, { ok: false, code: 'code-too-long' }); await nothingOpened(edge); refused = n }
  }
  assert.ok(shown, 'a host label short enough is shown')
  assert.equal(shown.link.length, sc.BACK_BUDGET, 'the first code shown measures exactly the budget')
  assert.equal(refused, shown.n + 1, 'the code one character longer was refused')
  shown = shown.link
  // the code is ASCII: its length is its bytes, inside the largest QR code (version 40, level L: 2953 bytes)
  assert.ok(/^[\x21-\x7e]+$/.test(shown) && sc.BACK_BUDGET <= 2953)
  assert.equal((await edge.B.h.contacts()).length, 1)
  // a name of 500 CJK characters: refused, nothing opened
  const cjk = await start(85, '字'.repeat(500))
  assert.deepEqual(await cjk.B.h.sharedConnectBack({ id: cjk.id }, opts(t += 1000)), { ok: false, code: 'code-too-long' })
  await nothingOpened(cjk)
})

test('offline: a signer that fails is not a code too long: the act fails with the signer\'s error and opens nothing; with the signer back the code is shown', async () => {
  const A = await person(87)
  const k = seedKeys(new Uint8Array(64).fill(88))
  let down = false
  const keys = { ...k, sign: (...a) => down ? Promise.reject(new Error('signer unavailable')) : k.sign(...a) }
  const B = await person(88, { keys })
  let t = T0
  const [s] = ev(await A.h.sharedConnectShow({ relays: [MED] }, opts(t)), 'sharedconnect.shown')
  assert.equal((await B.h.sharedConnectPropose({ link: s.link, relays: [MED], channel: 'scan', name: 'Bea' }, opts(t += 1000))).ok, true)
  down = true
  await assert.rejects(B.h.sharedConnectBack({ id: s.id }, opts(t += 1000)), (e) => e.name === 'InfraError' && /key-provider: sign failed/.test(e.message) && /signer unavailable/.test(e.cause?.message))
  assert.equal((await B.h.contacts()).length, 0)
  assert.equal((await B.read()).sharedConnect.enactments[s.id].flow.backShown, undefined)
  down = false
  const back = await B.h.sharedConnectBack({ id: s.id }, opts(t += 1000))
  assert.equal(back.ok, true, JSON.stringify(back)); assert.equal(ev(back, 'sharedconnect.shown').length, 1); assert.equal((await B.h.contacts()).length, 1)
})

/** Keys whose sharedConnectMessaging can be paused once, at its next call after arming. */
function gatedKeys (keys) {
  let armed = null
  return {
    keys: new Proxy(keys, {
      get: (o, k) => k !== 'sharedConnectMessaging' ? (typeof o[k] === 'function' ? o[k].bind(o) : o[k]) : async (...a) => {
        if (armed) { const w = armed; armed = null; w.hit(); await w.go }
        return o.sharedConnectMessaging(...a)
      },
    }),
    arm () {
      let hit, release
      const reached = new Promise((r) => { hit = r })
      const go = new Promise((r) => { release = r })
      armed = { hit, go }
      return { reached, release }
    },
  }
}

test('offline: once the inviter\'s acceptance is taken the back-code is refused not-pending, shown before or not, and also when the acceptance lands while the act prepares', async () => {
  const A = await person(76), B = await person(77)
  const gate = gatedKeys(B.keys)
  const B1 = await createHolder({ store: B.store, keys: gate.keys }, { invariants: true })
  let t = T0
  /** A shows, B scans and proposes, A accepts; returns the enactment id and the acceptance for B */
  const accepted = async () => {
    const [s] = ev(await A.h.sharedConnectShow({ relays: [MED] }, opts(t += 1000)), 'sharedconnect.shown')
    const prop = await B.h.sharedConnectPropose({ link: s.link, relays: [MED], channel: 'scan' }, opts(t += 1000))
    const bDid = ev(prop, 'sharedconnect.proposed')[0].did
    const got = await A.h.sharedConnectReceive(sends(prop)[0].doc, bDid, t += 1000)
    const dec = await A.h.decide(ev(got, 'sharedconnect.pending')[0].promptId, 'accept', opts(t += 1000))
    assert.equal(dec.ok, true, JSON.stringify(dec))
    const acc = sends(dec).find((x) => x.doc.type === sc.TASK_PROPOSE + '#response')
    return { id: s.id, take: async (h = B.h) => { const r = await h.sharedConnectReceive(acc.doc, s.did, t += 1000); assert.equal(r.ok, true, JSON.stringify(r)) } }
  }
  const flowOf = async (id) => (await B.read()).sharedConnect.enactments[id].flow

  // not shown before: the acceptance is taken, the back-code is refused and opens nothing
  const one = await accepted()
  await one.take()
  assert.deepEqual(await B.h.sharedConnectBack({ id: one.id }, opts(t += 1000)), { ok: false, code: 'not-pending' })
  assert.equal((await B.h.contacts()).length, 0)
  assert.equal((await flowOf(one.id)).backShown, undefined)

  // shown before: the same code is not given out again once the acceptance is taken
  const two = await accepted()
  const firstAct = opts(t += 1000)
  const first = await B.h.sharedConnectBack({ id: two.id }, firstAct)
  assert.equal(first.ok, true)
  const contacts = (await B.h.contacts()).length
  await two.take()
  assert.deepEqual(await B.h.sharedConnectBack({ id: two.id }, opts(t += 1000)), { ok: false, code: 'not-pending' })
  // the act that gave the code, repeated under its actId (also after a restart), is answered from the journal: the same code
  // without running the act again: nothing is committed
  const before = (await B.store.read()).version
  const Bre = await createHolder({ store: B.store, keys: B.keys }, { invariants: true })
  const replay = await Bre.sharedConnectBack({ id: two.id }, firstAct)
  assert.equal(replay.ok, true); assert.equal(ev(replay, 'sharedconnect.shown')[0].link, ev(first, 'sharedconnect.shown')[0].link)
  const again = await B.h.sharedConnectBack({ id: two.id }, firstAct)
  assert.equal(ev(again, 'sharedconnect.shown')[0].link, ev(first, 'sharedconnect.shown')[0].link)
  assert.equal((await B.store.read()).version, before, 'the replay commits nothing')
  assert.equal((await B.h.contacts()).length, contacts)

  // the acceptance commits between the preparation and the commit of the act (a second engine on the same store)
  const three = await accepted()
  const g = gate.arm()
  const pending = B1.sharedConnectBack({ id: three.id }, opts(t += 1000))
  await g.reached
  await three.take()
  g.release()
  assert.deepEqual(await pending, { ok: false, code: 'not-pending' })
  assert.equal((await B.h.contacts()).length, contacts, 'the act opened nothing')
  assert.equal((await flowOf(three.id)).backShown, undefined)
  assert.ok((await flowOf(three.id)).accept, 'the acceptance stands')
})

/** the permutations of a list with repeats, each once */
function orders (xs) {
  if (xs.length <= 1) return [xs]
  const out = []; const seen = new Set()
  for (let i = 0; i < xs.length; i++) {
    if (seen.has(xs[i])) continue
    seen.add(xs[i])
    for (const rest of orders([...xs.slice(0, i), ...xs.slice(i + 1)])) out.push([xs[i], ...rest])
  }
  return out
}

test('offline: a responder that read the inviter\'s card in the link opens its contact from that card when the inviter\'s issue carries none, in every order of acceptance, issue (twice), restart and back-code; exactly one contact', async () => {
  const seed = (n) => new Uint8Array(32).fill(n)
  const xMk = async (n) => (await import('../dist/crypto.js')).mkOfX((await (await import('../dist/crypto.js')).xFromSeed(seed(n))).pubRaw)
  // a foreign inviter: it shows a code with its card but issues without one (the card in the issue is optional)
  const inviter = await sc.partyFromSeeds(seed(0x51), seed(0x52), [MED], 'Kay'); inviter.pair.keyAgreement = await xMk(0x53)
  const sequences = orders(['accept', 'issue', 'issue', 'restart', 'back'])
  let fill = 0x20, k = 0
  for (const seq of sequences) {
    const B0 = await person(fill++ % 250 + 1)
    let B = B0
    let t = T0
    const nowS = Math.floor(t / 1000)
    const id = sc.challengeOf16(new Uint8Array(16).fill(++k))
    const exp = nowS + 600
    const link = await sc.sharedConnectLink({ from: inviter.messaging.did, id, exp, card: await sc.issueCard(inviter, await sc.linkCardChallenge(inviter.messaging.did, id, exp), t) }, undefined, nowS)
    const prop = await B.h.sharedConnectPropose({ link, relays: [MED], channel: 'scan' }, opts(t += 1000))
    assert.equal(prop.ok, true, JSON.stringify(prop))
    const bDid = ev(prop, 'sharedconnect.proposed')[0].did
    let n = 0
    const I = new Inviter(inviter, { id, exp }, { newId: () => 'kay-' + (++n), card: false })
    await I.receive(sends(prop)[0].doc, bDid, t += 1000)
    const acc = await I.accept(t += 1000, 'displayed')
    const [acceptDoc, issueDoc] = acc.send
    assert.equal(sc.cardOfIssue(issueDoc), null, 'the inviter\'s issue carries no card')
    const fromB = []
    let accepted = false
    for (const step of seq) {
      if (step === 'restart') { B = { ...B, h: await createHolder({ store: B.store, keys: B.keys }, { invariants: true }) }; continue }
      if (step === 'back') {
        const r = await B.h.sharedConnectBack({ id }, opts(t += 1000))
        if (accepted) assert.deepEqual(r, { ok: false, code: 'not-pending' }, seq.join(','))
        else {
          assert.equal(r.ok, true, seq.join(',') + ' ' + JSON.stringify(r))
          // the inviter's camera reads the back-code: it keeps B's card, nothing more happens on B's side
          await I.receiveBack(ev(r, 'sharedconnect.shown')[0].link, t += 1000)
          assert.equal((await B.h.contacts()).length, 1, 'the back-code opened B\'s contact')
        }
        continue
      }
      const r = await B.h.sharedConnectReceive(step === 'accept' ? acceptDoc : issueDoc, inviter.messaging.did, t += 1000)
      assert.equal(r.ok, true, JSON.stringify(r))
      if (step === 'accept') accepted = true
      fromB.push(...sends(r).map((x) => x.doc))
      assert.ok((await B.h.contacts()).length <= 1, seq.join(','))
    }
    // the inviter takes what B sent; its receipt completes B
    const back = []
    for (const d of fromB) back.push(...(await I.receive(d, bDid, t += 1000)).send)
    for (const d of back) assert.equal((await B.h.sharedConnectReceive(d, inviter.messaging.did, t += 1000)).ok, true)
    assert.ok(I.complete, seq.join(','))
    const [v] = await B.h.sharedConnect()
    assert.equal(v.status, 'complete', seq.join(','))
    const contacts = await B.h.contacts()
    assert.equal(contacts.length, 1, seq.join(','))
    assert.equal(v.contactId, contacts[0].id)
    const rels = Object.values((await B.read()).relationships)
    assert.equal(rels.length, 1)
    assert.equal(rels[0].tuples[0].counterpartAnchor, inviter.pair.anchor, seq.join(','))
    assert.equal(rels[0].tuples[0].counterpartKeyAgreement, inviter.pair.keyAgreement, seq.join(','))
    // a complete enactment shows no back-code: closed, not pending
    assert.deepEqual(await B.h.sharedConnectBack({ id }, opts(t += 1000)), { ok: false, code: 'enactment-closed' })
  }
})
