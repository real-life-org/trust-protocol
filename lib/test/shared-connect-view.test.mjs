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
