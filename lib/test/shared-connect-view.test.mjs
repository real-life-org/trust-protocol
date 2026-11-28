// The shared-connect view states what a wire and an app need without reading the holder's state
// (trust-protocol#216): `nonce` (the argument of KeyProvider.sharedConnectMessaging for this side's
// messaging identity), `accepted` and `backShown`. Both roles, before and after a restart from the store.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHolder, sharedConnect as sc } from '../dist/index.js'
import { T0, person, ev, opts } from './holder-fixture.mjs'

const MED = { kind: 'tsp-mediator', address: 'did:webvh:QmUTUkdHgppiciLpqcxkTi6Pbc9VuZzWXvH4L2Dk2dY2WL:mediator.web-of-trust.de' }
const HINT = (who) => JSON.stringify({ id: `did:key:z6Mkconn${who}#tsp`, serviceEndpoint: MED.address, type: 'TSPTransport' })
const offer = (fill, who) => ({ nonce: new Uint8Array(32).fill(fill), deliveryHints: [HINT(who)] })
const fromB64u = (s) => Uint8Array.from(Buffer.from(s, 'base64url'))
const sends = (r) => ev(r, 'sharedconnect.send').flatMap((e) => e.docs.map((d) => ({ to: e.to, doc: d })))
const viewOf = async (P, id) => (await P.h.sharedConnect()).find((v) => v.id === id)
/** the messaging identity the view's nonce names is the one the holder wrote as `did` */
async function nonceNamesDid (P, v) {
  const m = await P.keys.sharedConnectMessaging(fromB64u(v.nonce))
  assert.equal(sc.peer2Of(m.ed, m.x, [MED]), v.did)
}
const reopen = async (P) => ({ ...P, h: await createHolder({ store: P.store, keys: P.keys }, { invariants: true }) })

test('shared-connect view: nonce, accepted and backShown on both sides, and after a restart', async () => {
  const A = await person(81), B = await person(82)
  let t = T0
  const [s] = ev(await A.h.sharedConnectShow({ relays: [MED], name: 'Anton', carrier: offer(0xa1, 'A') }, opts(t += 1000)), 'sharedconnect.shown')
  const prop = await B.h.sharedConnectPropose({ link: s.link, relays: [MED], channel: 'scan', name: 'Bea', carrier: offer(0xb2, 'B') }, opts(t += 1000))
  assert.equal(prop.ok, true, JSON.stringify(prop))

  // before any acceptance
  let a = await viewOf(A, s.id), b = await viewOf(B, s.id)
  assert.equal(a.nonce, s.id, 'the inviter\'s nonce is its handle')
  assert.notEqual(b.nonce, b.id, 'the responder\'s nonce is its own challenge, not the inviter\'s handle')
  assert.ok(sc.canonicalChallenge(b.nonce))
  // each side has a carrier nonce of its own, and neither is the messaging nonce
  for (const v of [a, b]) { assert.ok(v.carrierNonce, 'a carrier offer was made'); assert.notEqual(v.nonce, v.carrierNonce) }
  assert.notEqual(a.carrierNonce, b.carrierNonce)
  await nonceNamesDid(A, a); await nonceNamesDid(B, b)
  assert.deepEqual([a.accepted, a.backShown, b.accepted, b.backShown], [false, false, false, false])

  // the responder shows its proposal back as a code
  const back = await B.h.sharedConnectBack({ id: s.id }, opts(t += 1000))
  assert.equal(back.ok, true, JSON.stringify(back))
  b = await viewOf(B, s.id)
  assert.equal(b.backShown, true); assert.equal(b.accepted, false)

  // the inviter receives the propose and the person accepts
  const [{ doc: propose }] = sends(prop)
  const got = await A.h.sharedConnectReceive(propose, b.did, t += 1000)
  const [pend] = ev(got, 'sharedconnect.pending')
  assert.equal((await viewOf(A, s.id)).accepted, false, 'a pending confirmation is no acceptance')
  const dec = await A.h.decide(pend.promptId, 'accept', opts(t += 1000))
  assert.equal(dec.ok, true, JSON.stringify(dec))
  assert.equal((await viewOf(A, s.id)).accepted, true)

  // the acceptance reaches the responder
  const [acceptDoc] = sends(dec).filter((x) => x.doc.type === sc.TASK_PROPOSE + '#response')
  const r = await B.h.sharedConnectReceive(acceptDoc.doc, a.did, t += 1000)
  assert.equal(r.ok, true, JSON.stringify(r))
  b = await viewOf(B, s.id)
  assert.equal(b.accepted, true); assert.equal(b.backShown, true)

  // a restart from the store states the same
  const A2 = await reopen(A), B2 = await reopen(B)
  const a2 = await viewOf(A2, s.id), b2 = await viewOf(B2, s.id)
  assert.deepEqual([a2.nonce, a2.accepted, a2.backShown], [a.nonce, true, false])
  assert.deepEqual([b2.nonce, b2.accepted, b2.backShown], [b.nonce, true, true])
  await nonceNamesDid(B2, b2)
})

test('shared-connect view: relayed states whether the link of the enactment names a relay, on both sides, after a restart; a stored enactment without the reading states null for a did:peer:4', async () => {
  const A = await person(83), B = await person(84)
  let t = T0
  const nowS = () => Math.floor(t / 1000)
  // the inviter's own link: with a relay and without
  const [withRelay] = ev(await A.h.sharedConnectShow({ relays: [MED] }, opts(t += 1000)), 'sharedconnect.shown')
  const [noRelay] = ev(await A.h.sharedConnectShow({ relays: [] }, opts(t += 1000)), 'sharedconnect.shown')
  assert.equal((await viewOf(A, withRelay.id)).relayed, true)
  assert.equal((await viewOf(A, noRelay.id)).relayed, false)
  // the responder reads the link's from: did:peer:2 with and without a relay
  for (const s of [withRelay, noRelay]) assert.equal((await B.h.sharedConnectPropose({ link: s.link, relays: [MED], channel: 'scan' }, opts(t += 1000))).ok, true)
  assert.equal((await viewOf(B, withRelay.id)).relayed, true)
  assert.equal((await viewOf(B, noRelay.id)).relayed, false, 'the responder\'s own relays do not count')
  // a foreign inviter's did:peer:4 (long form), with a relay and without
  const ed = new Uint8Array(32).fill(7), x = new Uint8Array(32).fill(9)
  const p4 = {}
  for (const [k, relays, fill] of [['with', [MED], 0x31], ['without', [], 0x32]]) {
    const from = await sc.peer4Of(ed, x, relays)
    const id = sc.challengeOf16(new Uint8Array(16).fill(fill))
    const link = await sc.sharedConnectLink({ from, id, exp: nowS() + 600, kind: 'link' }, undefined, nowS())
    assert.equal((await B.h.sharedConnectPropose({ link, relays: [MED], channel: 'link' }, opts(t += 1000))).ok, true)
    p4[k] = id
  }
  assert.equal((await viewOf(B, p4.with)).relayed, true)
  assert.equal((await viewOf(B, p4.without)).relayed, false)
  // a restart from the store states the same
  const A2 = await reopen(A), B2 = await reopen(B)
  assert.deepEqual([(await viewOf(A2, withRelay.id)).relayed, (await viewOf(A2, noRelay.id)).relayed], [true, false])
  const b2 = await B2.h.sharedConnect()
  assert.deepEqual([withRelay.id, noRelay.id, p4.with, p4.without].map((id) => b2.find((v) => v.id === id).relayed), [true, false, true, false])
  // an enactment stored without the reading: a did:peer:2 is read from the link as stored, a did:peer:4 is unknown
  const snap = await B.store.read()
  const state = structuredClone(snap.state)
  for (const e of Object.values(state.sharedConnect.enactments)) delete e.flow.linkRelayed
  assert.equal((await B.store.commit(snap.version, state)).ok, true)
  const B3 = await reopen(B)
  const b3 = await B3.h.sharedConnect()
  assert.deepEqual([withRelay.id, noRelay.id, p4.with, p4.without].map((id) => b3.find((v) => v.id === id).relayed), [true, false, null, null])
})
