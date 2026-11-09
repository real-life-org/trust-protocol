// shared-connect 0.1 on the holder (shared-connect-holder.ts): two holders run the ceremony through
// the holder acts, documents carried between them as the events say; the inviter's confirmation is
// a prompt; both sides end with a relationship from the cards in the issue steps (design (d)); a
// restart from the store continues; refusals and retention.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHolder, seedKeys, sharedConnect as sc, SC_PROMPT } from '../dist/index.js'
import { InMemoryStore } from '../dist/testing.js'
import { T0, person, ev, opts } from './holder-fixture.mjs'

const MED = { kind: 'tsp-mediator', address: 'did:webvh:QmUTUkdHgppiciLpqcxkTi6Pbc9VuZzWXvH4L2Dk2dY2WL:mediator.web-of-trust.de' }
const sends = (r) => ev(r, 'sharedconnect.send').flatMap((e) => e.docs.map((d) => ({ to: e.to, doc: d })))
/** carry every document of a result to the holder it names, as the TSP wire would, with the sender verified */
async function carry (r, fromDid, holders, t) {
  const out = []
  for (const { to, doc } of sends(r)) {
    const h = holders.find((x) => sc.sameVid(x.did, to))
    assert.ok(h, 'a holder for ' + to.slice(0, 40))
    const rr = await h.p.h.sharedConnectReceive(doc, fromDid, t)
    assert.equal(rr.ok, true, JSON.stringify(rr))
    out.push({ from: h, r: rr })
  }
  return out
}

test('shared-connect on the holder: a full enactment between two holders, the inviter confirming, a relationship on both sides', async () => {
  const A = await person(1), B = await person(2)
  let t = T0
  const shown = await A.h.sharedConnectShow({ relays: [MED], name: 'Anton', minutes: 10 }, opts(t))
  assert.equal(shown.ok, true, JSON.stringify(shown))
  const [s] = ev(shown, 'sharedconnect.shown')
  assert.ok(s.link.startsWith('https://link.trustoverip.org/t#_from=did:peer:2.') && s.link.includes('_label=Anton'))
  const a = { p: A, did: s.did }
  // the register holds the pair label with its nonce and the key is addressed
  const stA = await A.read()
  const eA = stA.sharedConnect.enactments[s.id]
  assert.equal(eA.role, 'inviter'); assert.ok(stA.register.labels.includes(eA.label)); assert.ok(stA.register.pairNonces[eA.label])
  assert.ok(Object.values(stA.addresses.keys).some((k) => k.label === eA.label))
  // B reads the link and proposes
  const prop = await B.h.sharedConnectPropose({ link: s.link, relays: [MED], channel: 'scan', name: 'Bea' }, opts(t += 1000))
  assert.equal(prop.ok, true, JSON.stringify(prop))
  const [pB] = ev(prop, 'sharedconnect.proposed')
  const b = { p: B, did: pB.did }
  assert.equal(sends(prop).length, 1); assert.equal(sends(prop)[0].doc.type, sc.TASK_PROPOSE)
  // A receives the propose: a prompt opens, nothing is sent yet
  const [{ r: got }] = await carry(prop, b.did, [a, b], t += 1000)
  assert.deepEqual(ev(got, 'prompt.opened').map((e) => e.kind), [SC_PROMPT])
  const [pend] = ev(got, 'sharedconnect.pending'); assert.equal(pend.name, 'Bea')
  assert.equal(sends(got).length, 0)
  const viewA = (await A.h.sharedConnect())[0]
  assert.equal(viewA.promptId, pend.promptId); assert.equal(viewA.name, 'Bea'); assert.equal(viewA.status, 'open')
  assert.deepEqual((await A.h.prompts()).map((p) => p.kind), [SC_PROMPT])
  // the person accepts: acceptance and A's issue (with A's card) go to B
  const dec = await A.h.decide(pend.promptId, 'accept', opts(t += 1000))
  assert.equal(dec.ok, true, JSON.stringify(dec))
  assert.deepEqual(ev(dec, 'sharedconnect.accepted').length, 1)
  const outA = sends(dec); assert.deepEqual(outA.map((x) => x.doc.type), [sc.TASK_PROPOSE + '#response', sc.TASK_ISSUE])
  assert.ok(sc.cardOfIssue(outA[1].doc), 'the inviter\'s issue carries its card')
  assert.equal((await A.h.prompts()).length, 0, 'the prompt is closed')
  // B takes both: issues its own (with card), receipts A's; then A receipts B's; both complete
  const atB = await carry(dec, a.did, [a, b], t += 1000)
  const fromB = atB.flatMap((x) => sends(x.r))
  assert.deepEqual(fromB.map((x) => x.doc.type), [sc.TASK_ISSUE, sc.TASK_ISSUE + '#response'])
  assert.ok(sc.cardOfIssue(fromB[0].doc), 'the responder\'s issue carries its card')
  let completeA = null
  for (const x of atB) { const back = await carry(x.r, b.did, [a, b], t += 1000); for (const y of back) { if (ev(y.r, 'sharedconnect.complete').length) completeA = y.r; for (const z of await carry(y.r, a.did, [a, b], t += 1000)) if (ev(z.r, 'sharedconnect.complete').length) assert.ok(z.r.ok) } }
  assert.ok(completeA, 'A completes')
  const [cA] = ev(completeA, 'sharedconnect.complete'); assert.ok(cA.contactId, 'a contact was opened from the card')
  // both holders hold a contact with one relationship and one tuple toward the other's pair anchor
  const contactsA = await A.h.contacts(), contactsB = await B.h.contacts()
  assert.equal(contactsA.length, 1); assert.equal(contactsB.length, 1)
  const stA2 = await A.read(), stB2 = await B.read()
  const relA = Object.values(stA2.relationships)[0], relB = Object.values(stB2.relationships)[0]
  assert.equal(relA.tuples.length, 1); assert.equal(relB.tuples.length, 1)
  assert.equal(relA.tuples[0].counterpartAnchor, stB2.sharedConnect.enactments[s.id].theirPair === undefined ? null : Object.values(stB2.sharedConnect.enactments)[0].flow.propose.payload.relationshipDid)
  assert.equal(relB.tuples[0].counterpartAnchor, Object.values(stA2.sharedConnect.enactments)[0].flow.accept.payload.relationshipDid)
  // each side's tuple seals to the other's pair X25519 key, the one in the card
  assert.equal(relA.tuples[0].counterpartKeyAgreement, sc.cardOfIssue(fromB[0].doc).keyAgreement)
  assert.equal(relB.tuples[0].counterpartKeyAgreement, sc.cardOfIssue(outA[1].doc).keyAgreement)
  assert.equal(relA.tuples[0].ownPairLabel, eA.label)
  // views: complete, the counterpart's credential held, outbox only the own receipt
  const vA = (await A.h.sharedConnect())[0], vB = (await B.h.sharedConnect())[0]
  assert.equal(vA.status, 'complete'); assert.equal(vB.status, 'complete')
  assert.ok(vA.theirCredential && vA.theirCredential.issuer === relA.tuples[0].counterpartAnchor)
  assert.deepEqual(vA.outbox.map((d) => d.type), [sc.TASK_ISSUE + '#response']); assert.deepEqual(vB.outbox.map((d) => d.type), [sc.TASK_ISSUE + '#response'])
  assert.equal(vA.contactId, contactsA[0].id); assert.equal(vB.contactId, contactsB[0].id)
})

test('shared-connect on the holder: a restart continues the enactment; a redelivered propose is answered again; decline', async () => {
  const store = new InMemoryStore()
  let A = await person(3, { store }), B = await person(4)
  let t = T0
  const shown = await A.h.sharedConnectShow({ relays: [MED], name: 'Anton' }, opts(t)); const [s] = ev(shown, 'sharedconnect.shown')
  const prop = await B.h.sharedConnectPropose({ link: s.link, relays: [MED], channel: 'scan', name: 'Bea' }, opts(t += 1000)); const [pB] = ev(prop, 'sharedconnect.proposed')
  const propose = sends(prop)[0].doc
  const got = await A.h.sharedConnectReceive(propose, pB.did, t += 1000); const [pend] = ev(got, 'sharedconnect.pending')
  // A restarts from the store: the prompt and the enactment are there, the same propose again sends nothing (undecided)
  await A.h.close()
  A = await person(3, { store })
  assert.deepEqual((await A.h.prompts()).map((p) => p.id), [pend.promptId])
  const again = await A.h.sharedConnectReceive(propose, pB.did, t += 1000)
  assert.equal(sends(again).length, 0)
  // decline: the error document goes to B, B reads it as declined, the enactment ends on both sides
  const dec = await A.h.decide(pend.promptId, 'decline', opts(t += 1000))
  assert.equal(dec.ok, true, JSON.stringify(dec)); assert.equal(ev(dec, 'sharedconnect.declined').length, 1)
  const [d] = sends(dec); assert.equal(d.doc.type, sc.TASK_ERROR)
  const atB = await B.h.sharedConnectReceive(d.doc, s.did, t += 1000)
  assert.equal(ev(atB, 'sharedconnect.declined').length, 1)
  assert.equal((await A.h.sharedConnect())[0].status, 'declined'); assert.equal((await B.h.sharedConnect())[0].status, 'declined')
  assert.equal((await A.h.contacts()).length, 0); assert.equal((await B.h.contacts()).length, 0)
  // the propose redelivered after the decline: the decline goes out again
  const re = await A.h.sharedConnectReceive(propose, pB.did, t += 1000)
  assert.deepEqual(sends(re).map((x) => x.doc.type), [sc.TASK_ERROR])
  // a second responder on the same link is refused: the enactment belongs to the first issuer
  const C = await person(5)
  const prop2 = await C.h.sharedConnectPropose({ link: s.link, relays: [MED], channel: 'scan' }, opts(t += 1000)); const [pC] = ev(prop2, 'sharedconnect.proposed')
  const r2 = await A.h.sharedConnectReceive(sends(prop2)[0].doc, pC.did, t += 1000)
  assert.deepEqual(ev(r2, 'sharedconnect.refused').map((e) => e.reason), ['issuer'])
})

test('shared-connect on the holder: refusals (bad link, unknown enactment, link already answered, deciding twice) and retention', async () => {
  const A = await person(6), B = await person(7)
  let t = T0
  const bad = await B.h.sharedConnectPropose({ link: 'https://example.org/x', relays: [MED], channel: 'scan' }, opts(t))
  assert.equal(bad.ok, false); assert.equal(bad.code, 'link-invalid')
  const stray = await A.h.sharedConnectReceive({ type: sc.TASK_PROPOSE, ceremony: { enactment: 'nope' } }, 'did:peer:2.x', t)
  assert.equal(stray.ok, false); assert.equal(stray.code, 'enactment-unknown')
  const shown = await A.h.sharedConnectShow({ relays: [MED] }, opts(t)); const [s] = ev(shown, 'sharedconnect.shown')
  assert.ok(!s.link.includes('_label'), 'no name, no label')
  const p1 = await B.h.sharedConnectPropose({ link: s.link, relays: [MED], channel: 'link' }, opts(t += 1000))
  assert.equal(p1.ok, true)
  const p2 = await B.h.sharedConnectPropose({ link: s.link, relays: [MED], channel: 'link' }, opts(t += 1000))
  assert.equal(p2.ok, false); assert.equal(p2.code, 'enactment-closed')
  const [pB] = ev(p1, 'sharedconnect.proposed')
  const got = await A.h.sharedConnectReceive(sends(p1)[0].doc, pB.did, t += 1000); const [pend] = ev(got, 'sharedconnect.pending')
  assert.equal(pend.name, null)
  assert.equal((await A.h.decide(pend.promptId, 'accept', opts(t += 1000))).ok, true)
  const twice = await A.h.decide(pend.promptId, 'accept', opts(t += 1000))
  assert.equal(twice.ok, false, 'the prompt is closed')
  // the enactment's key is kept across a tick while open; the enactment is dropped long after it closed without a contact
  await A.h.tick(t + 3600_000)
  assert.equal(Object.keys((await A.read()).sharedConnect.enactments).length, 1)
  await A.h.tick(t + 40 * 24 * 3600_000)
  assert.equal(Object.keys((await A.read()).sharedConnect.enactments).length, 0, 'retention dropped the enactment that never completed')
})
