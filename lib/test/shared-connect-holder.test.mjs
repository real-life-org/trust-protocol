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
  assert.equal(relA.tuples[0].counterpartAnchor, Object.values(stB2.sharedConnect.enactments)[0].flow.propose.payload.relationshipDid)
  assert.equal(relA.tuples[0].counterpartAnchor, stA2.sharedConnect.enactments[s.id].theirPair)
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
  // the enactment and its pair key are kept across a tick while open; both leave long after the link expired without completion
  const label = (await A.read()).sharedConnect.enactments[s.id].label
  const hasKey = async () => Object.values((await A.read()).addresses.keys).some((k) => k.label === label)
  await A.h.tick(t + 3600_000)
  assert.equal(Object.keys((await A.read()).sharedConnect.enactments).length, 1); assert.equal(await hasKey(), true)
  await A.h.tick(t + 40 * 24 * 3600_000)
  assert.equal(Object.keys((await A.read()).sharedConnect.enactments).length, 0, 'retention dropped the enactment that never completed')
  await A.h.tick(t + 400 * 24 * 3600_000)
  assert.equal(await hasKey(), false, 'the pair key of a dropped enactment leaves with the address retention')
})

// ── the second review round (#186): security negatives, the path without a card, restart, failure, retention, concurrency ──
import { sharedConnectFlow as fl, randomEntropy } from '../dist/index.js'
import { hkdf, digestBytes } from '../dist/crypto.js'

const te = new TextEncoder()
const seedOf = (label) => hkdf(te.encode('shared-connect holder test seed'), label)
/** a flow-machine responder standing in for a foreign app (Keyring), with or without the RLTP card */
async function foreignResponder (link, label, card, nowMs = T0) {
  const msg = await sc.partyFromSeeds(await seedOf(label + '/msg'), await seedOf(label + '/pair'), [MED], 'Kay')
  // the pair with an X25519 key (for the card), signing through a KeyProvider as the holder does
  const k = seedKeys(await hkdf(te.encode('foreign'), label, 64)), pl = 'pair/' + await digestBytes(te.encode(label)), own = await k.anchorOf(pl)
  const party = { messaging: msg.messaging, name: 'Kay', pair: { anchor: own.anchor, keyAgreement: own.keyAgreement, sign: (h) => k.sign(pl, h) } }
  const read = await sc.readSharedConnectLink(link, Math.floor(nowMs / 1000)); assert.ok(read.ok, JSON.stringify(read))
  const ch = sc.challengeOf16(await hkdf(te.encode('challenge'), label, 16))
  let n = 0
  return { party, R: new fl.Responder(party, read.link, ch, 'scan', { newId: () => label + '-' + (++n), card }) }
}
/** the inviter holder A against a flow responder: through the propose and the person's acceptance */
async function throughAccept (A, t, label, card) {
  const shown = await A.h.sharedConnectShow({ relays: [MED], name: 'Anton' }, opts(t)); const [s] = ev(shown, 'sharedconnect.shown')
  const f = await foreignResponder(s.link, label, card)
  const p = await f.R.start(t += 1000)
  const got = await A.h.sharedConnectReceive(p.send[0], f.party.messaging.did, t += 1000); const [pend] = ev(got, 'sharedconnect.pending')
  const dec = await A.h.decide(pend.promptId, 'accept', opts(t += 1000)); assert.equal(dec.ok, true, JSON.stringify(dec))
  const out = sends(dec)
  return { s, f, p, pend, dec, out, t }
}

test('shared-connect on the holder: a card that is forged, from another anchor, for another challenge, or bound is refused as card; the issue itself is not taken', async () => {
  const A = await person(8)
  const { s, f, out, t: t0 } = await throughAccept(A, T0, 'card-neg', true)
  let t = t0
  // the responder takes the acceptance and A's issue and builds its own issue, with its card
  const gotAcc = await f.R.receive(out[0].doc, s.did, t += 1000); assert.deepEqual(gotAcc.events.map((e) => e.kind), ['accepted'])
  const issue = gotAcc.send[0]; assert.equal(issue.type, sc.TASK_ISSUE)
  const good = sc.cardOfIssue(issue); assert.ok(good)
  const vrc = issue.payload.vrc, propose = f.R.snapshot().propose, challenge = f.R.snapshot().challenge
  const other = (await foreignResponder(s.link, 'x', true)).party
  const reissue = (card, id) => sc.issue(f.party, s.did, propose.id, s.id, 'issue-responder', vrc, t, id, { card })
  const bad = {
    'another anchor': await sc.issueCard(other, challenge, t),
    'another challenge': await sc.issueCard(f.party, s.id, t),
    'bound to a recipient': { ...good, sentTo: s.did },
    'a broken proof': { ...good, proof: { ...good.proof, proofValue: good.proof.proofValue.slice(0, -2) + (good.proof.proofValue.endsWith('aa') ? 'bb' : 'aa') } },
  }
  let i = 0
  for (const [why, card] of Object.entries(bad)) {
    const r = await A.h.sharedConnectReceive(await reissue(card, 'bad-' + (++i)), f.party.messaging.did, t += 1000)
    assert.equal(r.ok, true, why)
    assert.deepEqual(ev(r, 'sharedconnect.refused').map((e) => e.reason), ['card'], why)
    assert.equal(ev(r, 'sharedconnect.credential').length, 0, why + ': the issue was not taken')
    assert.equal(sends(r).length, 0, why + ': no receipt')
  }
  assert.equal((await A.h.sharedConnect())[0].theirCredential, null)
  // the untouched issue completes A's side
  const ok = await A.h.sharedConnectReceive(issue, f.party.messaging.did, t += 1000)
  assert.deepEqual(ev(ok, 'sharedconnect.refused').length, 0); assert.equal(ev(ok, 'sharedconnect.credential').length, 1)
  assert.deepEqual(sends(ok).map((x) => x.doc.type), [sc.TASK_ISSUE + '#response'])
})

test('shared-connect on the holder: a counterpart without a card (Keyring) completes with the credential held and no contact; the enactment and its key stay past the retention', async () => {
  const A = await person(9)
  const { s, f, out, t: t0 } = await throughAccept(A, T0, 'no-card', false)
  let t = t0
  const gotAcc = await f.R.receive(out[0].doc, s.did, t += 1000)
  const gotIss = await f.R.receive(out[1].doc, s.did, t += 1000)
  assert.equal(sc.cardOfIssue(gotAcc.send[0]), null, 'no card from the foreign app')
  const atA1 = await A.h.sharedConnectReceive(gotAcc.send[0], f.party.messaging.did, t += 1000)
  const atA2 = await A.h.sharedConnectReceive(gotIss.send[0], f.party.messaging.did, t += 1000)
  const complete = [...ev(atA1, 'sharedconnect.complete'), ...ev(atA2, 'sharedconnect.complete')]
  assert.equal(complete.length, 1); assert.equal(complete[0].contactId, null, 'no RLTP channel, no contact')
  assert.equal((await A.h.contacts()).length, 0)
  const v = (await A.h.sharedConnect())[0]
  assert.equal(v.status, 'complete'); assert.equal(v.contactId, null)
  assert.ok(v.theirCredential && v.myCredential, 'both credentials are held in the enactment')
  assert.equal(v.theirCredential.proof.proofValue, gotAcc.send[0].payload.vrc.proof.proofValue)
  assert.ok(v.closedAt !== null && v.closedAt >= v.openedAt)
  // 400 days later, after a restart: the enactment, both credentials and the pair key are still there
  await A.h.tick(t + 400 * 24 * 3600_000)
  await A.h.close(); const A2 = await person(9, { store: A.store })
  const st = await A2.read()
  const e = st.sharedConnect.enactments[s.id]; assert.ok(e, 'a complete enactment is never dropped')
  assert.equal(JSON.stringify(st).includes(gotAcc.send[0].payload.vrc.proof.proofValue), true, 'the counterpart\'s signed credential survives')
  assert.equal(JSON.stringify(st).includes(out[1].doc.payload.vrc.proof.proofValue), true, 'the own signed credential survives')
  assert.ok(Object.values(st.addresses.keys).some((k) => k.label === e.label), 'the pair key is kept')
  assert.equal(await A2.h.nextDueAt?.() ?? null, null, 'nothing left to wake for')
})

test('shared-connect on the holder: the responder refuses an acceptance from a sender that is not the inviter; a KeyProvider without sharedConnectMessaging refuses keys-missing', async () => {
  const A = await person(10), B = await person(11), C = await person(12)
  let t = T0
  const shown = await A.h.sharedConnectShow({ relays: [MED] }, opts(t)); const [s] = ev(shown, 'sharedconnect.shown')
  const prop = await B.h.sharedConnectPropose({ link: s.link, relays: [MED], channel: 'scan' }, opts(t += 1000)); const [pB] = ev(prop, 'sharedconnect.proposed')
  const got = await A.h.sharedConnectReceive(sends(prop)[0].doc, pB.did, t += 1000); const [pend] = ev(got, 'sharedconnect.pending')
  const dec = await A.h.decide(pend.promptId, 'accept', opts(t += 1000))
  const shownC = await C.h.sharedConnectShow({ relays: [MED] }, opts(t)); const [sC] = ev(shownC, 'sharedconnect.shown')
  // the same acceptance, said to come from C: refused as issuer, nothing sent, B still waiting
  const wrong = await B.h.sharedConnectReceive(sends(dec)[0].doc, sC.did, t += 1000)
  assert.deepEqual(ev(wrong, 'sharedconnect.refused').map((e) => e.reason), ['issuer']); assert.equal(sends(wrong).length, 0)
  assert.equal((await B.h.sharedConnect())[0].status, 'open')
  const right = await B.h.sharedConnectReceive(sends(dec)[0].doc, s.did, t += 1000)
  assert.deepEqual(ev(right, 'sharedconnect.accepted').length, 1)
  // a provider without the method: show and propose refuse, the holder itself starts
  const k = seedKeys(new Uint8Array(64).fill(13))
  const { sharedConnectMessaging, ...rest } = k
  const keys = Object.fromEntries(Object.entries(rest).map(([n, f]) => [n, typeof f === 'function' ? f.bind(k) : f]))
  const D = await person(13, { keys })
  const sh = await D.h.sharedConnectShow({ relays: [MED] }, opts(t)); assert.equal(sh.ok, false); assert.equal(sh.code, 'keys-missing')
  const pr = await D.h.sharedConnectPropose({ link: s.link, relays: [MED], channel: 'scan' }, opts(t)); assert.equal(pr.ok, false); assert.equal(pr.code, 'keys-missing')
})

test('shared-connect on the holder: a restart after the acceptance sends the outbox again and completes; the counterpart\'s error while the prompt is open closes it', async () => {
  const store = new InMemoryStore()
  let A = await person(14, { store })
  const { s, f, out, pend, t: t0 } = await throughAccept(A, T0, 'restart', true)
  let t = t0
  // A restarts before anything reached the responder: the view's outbox is the acceptance and the issue
  await A.h.close(); A = await person(14, { store })
  const v = (await A.h.sharedConnect())[0]
  assert.deepEqual(v.outbox.map((d) => d.type), [sc.TASK_PROPOSE + '#response', sc.TASK_ISSUE]); assert.equal(v.promptId, null)
  assert.deepEqual(v.outbox.map((d) => d.id), out.map((x) => x.doc.id), 'the same documents, not new ones')
  const r1 = await f.R.receive(v.outbox[0], s.did, t += 1000), r2 = await f.R.receive(v.outbox[1], s.did, t += 1000)
  const atA = []
  for (const d of [...r1.send, ...r2.send]) atA.push(await A.h.sharedConnectReceive(d, f.party.messaging.did, t += 1000))
  assert.equal(atA.flatMap((r) => ev(r, 'sharedconnect.complete')).length, 1)
  assert.ok(atA.flatMap((r) => ev(r, 'sharedconnect.complete'))[0].contactId, 'the card opened the contact after the restart')
  for (const r of atA) for (const d of sends(r).map((x) => x.doc)) assert.equal((await f.R.receive(d, s.did, t)).events.length > 0, true)
  assert.ok(f.R.complete)
  assert.equal(pend.promptId.startsWith('sharedconnect:'), true)
  // a second enactment: the responder's error arrives while the person has not decided
  const shown2 = await A.h.sharedConnectShow({ relays: [MED] }, opts(t += 1000)); const [s2] = ev(shown2, 'sharedconnect.shown')
  const f2 = await foreignResponder(s2.link, 'restart-2', true)
  const p2 = await f2.R.start(t += 1000)
  const got2 = await A.h.sharedConnectReceive(p2.send[0], f2.party.messaging.did, t += 1000); const [pend2] = ev(got2, 'sharedconnect.pending')
  assert.equal((await A.h.prompts()).length, 1)
  const err = await sc.signStep(f2.party.messaging, { id: 'e-1', type: sc.TASK_ERROR, threadId: p2.send[0].id, issuer: f2.party.messaging.did, recipient: s2.did, issuedAt: new Date(t).toISOString(), ceremony: { enactment: s2.id, step: 'propose' }, payload: { code: 'vrc/relationships/propose:aborted', retryable: false } }, new Date(t).toISOString())
  const failed = await A.h.sharedConnectReceive(err, f2.party.messaging.did, t += 1000)
  assert.deepEqual(ev(failed, 'sharedconnect.failed').map((e) => e.code), ['vrc/relationships/propose:aborted'])
  assert.equal((await A.h.prompts()).length, 0, 'the prompt closed with the enactment')
  const late = await A.h.decide(pend2.promptId, 'accept', opts(t += 1000))
  assert.equal(late.ok, false, 'no decision on a closed enactment'); assert.equal(late.code, 'unknown-prompt', 'the prompt is gone before the module is asked')
  assert.equal((await A.h.sharedConnect()).find((x) => x.id === s2.id).status, 'failed')
})

test('shared-connect on the holder: retention counts from the close, fires exactly at the deadline, and never touches a complete enactment', async () => {
  const A = await person(15), B = await person(16)
  let t = T0
  // one complete enactment (A with B), one declined (A with a foreign responder), on A
  const shown = await A.h.sharedConnectShow({ relays: [MED] }, opts(t)); const [s] = ev(shown, 'sharedconnect.shown')
  const prop = await B.h.sharedConnectPropose({ link: s.link, relays: [MED], channel: 'scan' }, opts(t += 1000)); const [pB] = ev(prop, 'sharedconnect.proposed')
  const a = { p: A, did: s.did }, b = { p: B, did: pB.did }
  const [{ r: got }] = await carry(prop, b.did, [a, b], t += 1000); const [pend] = ev(got, 'sharedconnect.pending')
  const dec = await A.h.decide(pend.promptId, 'accept', opts(t += 1000))
  for (const x of await carry(dec, a.did, [a, b], t += 1000)) for (const y of await carry(x.r, b.did, [a, b], t += 1000)) await carry(y.r, a.did, [a, b], t += 1000)
  assert.equal((await A.h.sharedConnect())[0].status, 'complete')
  const tDecline = t + 20 * 24 * 3600_000 // the second one is declined 20 days after the first opened
  const shown2 = await A.h.sharedConnectShow({ relays: [MED] }, opts(tDecline - 60_000)); const [s2] = ev(shown2, 'sharedconnect.shown')
  const f = await foreignResponder(s2.link, 'ret', true, tDecline - 60_000)
  const p2 = await f.R.start(tDecline - 30_000)
  const got2 = await A.h.sharedConnectReceive(p2.send[0], f.party.messaging.did, tDecline - 20_000); const [pend2] = ev(got2, 'sharedconnect.pending')
  const d2 = await A.h.decide(pend2.promptId, 'decline', opts(tDecline)); assert.equal(d2.ok, true)
  const e2 = (await A.read()).sharedConnect.enactments[s2.id]
  assert.equal(e2.status, 'declined'); assert.equal(e2.closedAt, tDecline)
  // 31 days after the first opened the declined one is 11 days old: both stay
  await A.h.tick(t + 31 * 24 * 3600_000)
  assert.equal(Object.keys((await A.read()).sharedConnect.enactments).length, 2)
  // one millisecond before the declined one's deadline it stays; at the deadline it leaves; the complete one never
  const deadline = tDecline + 30 * 24 * 3600_000
  await A.h.tick(deadline - 1)
  assert.equal(Object.keys((await A.read()).sharedConnect.enactments).length, 2)
  await A.h.tick(deadline)
  const left = (await A.read()).sharedConnect.enactments
  assert.deepEqual(Object.keys(left), [s.id], 'the declined enactment left exactly at its deadline')
  await A.h.tick(deadline + 1000 * 24 * 3600_000)
  const st = await A.read()
  assert.deepEqual(Object.keys(st.sharedConnect.enactments), [s.id])
  const vrc = st.sharedConnect.enactments[s.id].flow.issueTheirs.payload.vrc
  assert.ok(vrc.proof.proofValue, 'the counterpart\'s signed credential is still there')
  assert.equal((await A.h.contacts()).length, 1)
})

test('shared-connect on the holder: two holders in one process never take document ids from each other\'s entropy', async () => {
  // A's KeyProvider pauses inside sharedConnectMessaging during the acceptance; C runs its own act meanwhile
  const ids = { A: new Set(), C: new Set() }
  const tagged = (tag) => { const e = randomEntropy(); return { bytes: (p, n) => e.bytes(p, n), id: (p) => { const v = e.id(p); ids[tag].add(v); return v } } }
  let gate = null, paused = 0
  const kA = seedKeys(new Uint8Array(64).fill(17))
  const gated = new Proxy(kA, { get: (o, k) => k === 'sharedConnectMessaging' ? async (n) => { paused++; if (gate) await gate; return o.sharedConnectMessaging(n) } : o[k] })
  const A = await person(17, { keys: gated, entropy: tagged('A') }), B = await person(18), C = await person(19, { entropy: tagged('C') })
  let t = T0
  const shown = await A.h.sharedConnectShow({ relays: [MED] }, opts(t)); const [s] = ev(shown, 'sharedconnect.shown')
  const prop = await B.h.sharedConnectPropose({ link: s.link, relays: [MED], channel: 'scan' }, opts(t += 1000)); const [pB] = ev(prop, 'sharedconnect.proposed')
  const got = await A.h.sharedConnectReceive(sends(prop)[0].doc, pB.did, t += 1000); const [pend] = ev(got, 'sharedconnect.pending')
  // gate A's acceptance, let C show (its prepare takes ids from C's entropy), then release A
  let open; gate = new Promise((r) => { open = r })
  const before = paused
  const pendingDec = A.h.decide(pend.promptId, 'accept', opts(t += 1000))
  for (let i = 0; paused === before && i < 1000; i++) await new Promise((r) => setTimeout(r, 1))
  assert.ok(paused > before, 'the acceptance is paused inside the KeyProvider')
  const shownC = await C.h.sharedConnectShow({ relays: [MED] }, opts(t)); assert.equal(shownC.ok, true)
  gate = null; open()
  const dec = await pendingDec; assert.equal(dec.ok, true, JSON.stringify(dec))
  const out = sends(dec).map((x) => x.doc.id)
  assert.equal(out.length, 2)
  for (const id of out) { assert.ok(ids.A.has(id), 'an id of A\'s own entropy: ' + id); assert.ok(!ids.C.has(id)) }
})

// ── A2/A3: origin and class in the views, trust only toward a contact that met ──
/** two holders through a whole enactment over `channel` on the responder's side; returns both contact ids */
async function wholeEnactment (A, B, t, channel, showChannel) {
  const shown = await A.h.sharedConnectShow({ relays: [MED], name: 'Anton', ...(showChannel ? { channel: showChannel } : {}) }, opts(t)); const [s] = ev(shown, 'sharedconnect.shown')
  const prop = await B.h.sharedConnectPropose({ link: s.link, relays: [MED], channel, name: 'Bea' }, opts(t += 1000)); const [pB] = ev(prop, 'sharedconnect.proposed')
  const a = { p: A, did: s.did }, b = { p: B, did: pB.did }
  const [{ r: got }] = await carry(prop, b.did, [a, b], t += 1000); const [pend] = ev(got, 'sharedconnect.pending')
  const dec = await A.h.decide(pend.promptId, 'accept', opts(t += 1000))
  for (const x of await carry(dec, a.did, [a, b], t += 1000)) for (const y of await carry(x.r, b.did, [a, b], t += 1000)) await carry(y.r, a.did, [a, b], t += 1000)
  const vA = (await A.h.sharedConnect()).find((v) => v.id === s.id), vB = (await B.h.sharedConnect()).find((v) => v.id === s.id)
  assert.equal(vA.status, 'complete'); assert.equal(vB.status, 'complete')
  return { id: s.id, cA: vA.contactId, cB: vB.contactId, t }
}

test('shared-connect on the holder: the contact view names the enactment, the channel and whether the two met; trust goes to a met contact and is refused not-met over a link', async () => {
  const A = await person(20), B = await person(21)
  let t = T0
  for (const P of [A, B]) assert.equal((await P.h.foundPersonalCommunity({ name: 'me' }, opts(t += 1000))).ok, true)
  // met: A displayed, B scanned
  const met = await wholeEnactment(A, B, t, 'scan', 'displayed'); t = met.t
  const cA = await A.h.contact(met.cA), cB = await B.h.contact(met.cB)
  assert.deepEqual(cA.sharedConnect, { enactmentId: met.id, channel: 'displayed', theirChannel: 'scan', met: true })
  assert.deepEqual(cB.sharedConnect, { enactmentId: met.id, channel: 'scan', theirChannel: 'displayed', met: true })
  assert.equal(cA.provenance, 'ceremony'); assert.equal(cA.verification, 'met')
  assert.equal((await A.h.sharedConnect()).find((v) => v.id === met.id).met, true)
  const given = await A.h.trust(met.cA, opts(t += 1000))
  assert.equal(given.ok, true, JSON.stringify(given)); assert.equal(ev(given, 'trust.given').length, 1)
  assert.equal((await A.h.contact(met.cA)).trust.given, true)
  // over a link: A sent the link, B opened it
  const C = await person(22), D = await person(23)
  for (const P of [C, D]) assert.equal((await P.h.foundPersonalCommunity({ name: 'me' }, opts(t += 1000))).ok, true)
  const link = await wholeEnactment(C, D, t, 'link', 'sent'); t = link.t
  const cC = await C.h.contact(link.cA), cD = await D.h.contact(link.cB)
  assert.deepEqual(cC.sharedConnect, { enactmentId: link.id, channel: 'sent', theirChannel: 'link', met: false })
  assert.deepEqual(cD.sharedConnect, { enactmentId: link.id, channel: 'link', theirChannel: 'sent', met: false })
  assert.equal((await D.h.sharedConnect()).find((v) => v.id === link.id).met, false)
  assert.deepEqual(await C.h.trust(link.cA, opts(t += 1000)), { ok: false, code: 'not-met' })
  assert.deepEqual(await D.h.trust(link.cB, opts(t += 1000)), { ok: false, code: 'not-met' })
  assert.equal((await C.h.contact(link.cA)).trust.given, false)
  // the class set directly is refused the same way; other classes and 'off' are not about meeting
  assert.deepEqual(await C.h.act('trust.setClass', { contactId: link.cA, cls: 'anchorMapping', setting: 'on' }, t += 1000, { actId: 'sc-cls-1' }), { ok: false, code: 'not-met' })
  assert.equal((await C.h.act('trust.setClass', { contactId: link.cA, cls: 'anchorMapping', setting: 'off' }, t += 1000, { actId: 'sc-cls-2' })).ok, true)
  assert.equal((await C.h.act('trust.setClass', { contactId: link.cA, cls: 'profile', setting: 'on' }, t += 1000, { actId: 'sc-cls-3' })).ok, true, 'another class is not about meeting')
  // one side's statement alone is not a meeting: K shows the code (displayed), L opens it as a link
  const K = await person(33), L = await person(34)
  for (const P of [K, L]) assert.equal((await P.h.foundPersonalCommunity({ name: 'me' }, opts(t += 1000))).ok, true)
  const mixed = await wholeEnactment(K, L, t, 'link', 'displayed'); t = mixed.t
  assert.deepEqual((await K.h.contact(mixed.cA)).sharedConnect, { enactmentId: mixed.id, channel: 'displayed', theirChannel: 'link', met: false })
  assert.deepEqual((await L.h.contact(mixed.cB)).sharedConnect, { enactmentId: mixed.id, channel: 'link', theirChannel: 'displayed', met: false })
  assert.deepEqual(await K.h.trust(mixed.cA, opts(t += 1000)), { ok: false, code: 'not-met' }, 'the showing side may not trust on its own statement')
  assert.deepEqual(await L.h.trust(mixed.cB, opts(t += 1000)), { ok: false, code: 'not-met' })
})

test('shared-connect on the holder: the origin follows the relationships through a merge, in both orders; two link contacts merged still did not meet', async () => {
  // E meets F (scan) and, under another pair, G over a link; F and G are the same person to E, so E merges the two entries
  for (const order of ['link-first', 'met-first']) {
    const E = await person(24), F = await person(25), G = await person(26)
    let t = T0
    for (const P of [E, F, G]) assert.equal((await P.h.foundPersonalCommunity({ name: 'me' }, opts(t += 1000))).ok, true)
    const met = await wholeEnactment(E, F, t, 'scan', 'displayed'); t = met.t
    const link = await wholeEnactment(E, G, t, 'link', 'sent'); t = link.t
    assert.deepEqual(await E.h.trust(link.cA, opts(t += 1000)), { ok: false, code: 'not-met' })
    const ids = order === 'link-first' ? [link.cA, met.cA] : [met.cA, link.cA]
    const merged = await E.h.merge(ids, opts(t += 1000)); assert.equal(merged.ok, true, JSON.stringify(merged))
    const contacts = await E.h.contacts(); assert.equal(contacts.length, 1, 'one entry after the merge')
    const [c] = contacts
    assert.equal(c.relationships.length, 2)
    assert.deepEqual(c.sharedConnect, { enactmentId: met.id, channel: 'displayed', theirChannel: 'scan', met: true }, order + ': the oldest enactment, and the entry met')
    // both former ids find the entry, with the same origin
    for (const id of ids) assert.deepEqual((await E.h.contact(id)).sharedConnect, c.sharedConnect, order + ': ' + id)
    const given = await E.h.trust(c.id, opts(t += 1000)); assert.equal(given.ok, true, order + ': ' + JSON.stringify(given))
  }
  // two link contacts merged: still not met
  const H = await person(27), I = await person(28), J = await person(29)
  let t = T0
  for (const P of [H, I, J]) assert.equal((await P.h.foundPersonalCommunity({ name: 'me' }, opts(t += 1000))).ok, true)
  const l1 = await wholeEnactment(H, I, t, 'link', 'sent'); t = l1.t
  const l2 = await wholeEnactment(H, J, t, 'link', 'sent'); t = l2.t
  assert.equal((await H.h.merge([l1.cA, l2.cA], opts(t += 1000))).ok, true)
  const [c] = await H.h.contacts()
  assert.deepEqual(c.sharedConnect, { enactmentId: l1.id, channel: 'sent', theirChannel: 'link', met: false })
  assert.deepEqual(await H.h.trust(c.id, opts(t += 1000)), { ok: false, code: 'not-met' })
})

// the origin follows the tuples: a chaining by continuity (6a.4) swaps relationship ids, a departure
// renames the entry; the pure functions are run on the holder's state
import { chainTuple } from '../dist/trust/continuity.js'
import { contactsView } from '../dist/views.js'

test('shared-connect on the holder: the origin follows a chaining by continuity (link first, met later; and the reverse) and a departure that renames the entry', async () => {
  const E = await person(30), F = await person(31), G = await person(32)
  let t = T0
  for (const P of [E, F, G]) assert.equal((await P.h.foundPersonalCommunity({ name: 'me' }, opts(t += 1000))).ok, true)
  const link = await wholeEnactment(E, G, t, 'link', 'sent'); t = link.t
  const met = await wholeEnactment(E, F, t, 'scan', 'displayed'); t = met.t
  const st = await E.read()
  const labelOf = (id) => st.sharedConnect.enactments[id].label
  // the met tuple appended to the link chain: the entry keeps the link relationship's id, the tuples are [link, met]
  const ch1 = chainTuple(st, labelOf(met.id), labelOf(link.id), 0n)
  assert.ok(typeof ch1 === 'object', 'chained: ' + ch1)
  const v1 = contactsView(ch1.state); assert.equal(v1.length, 1); const [c1] = v1
  assert.deepEqual(c1.relationships.map((r) => r.tuples), [2])
  assert.deepEqual(c1.sharedConnect, { enactmentId: link.id, channel: 'sent', theirChannel: 'link', met: true }, 'the chain met through its later tuple')
  // the reverse: the link tuple appended to the met chain
  const ch2 = chainTuple(st, labelOf(link.id), labelOf(met.id), 0n)
  assert.ok(typeof ch2 === 'object', 'chained: ' + ch2)
  const v2 = contactsView(ch2.state); assert.equal(v2.length, 1); const [c2] = v2
  assert.deepEqual(c2.sharedConnect, { enactmentId: link.id, channel: 'sent', theirChannel: 'link', met: true })
  // a departure on the holder: the merged entry carries the met relationship's identity (the newest wins
  // without positions); departing that relationship renames the entry and leaves the link alone: not met
  assert.equal((await E.h.merge([link.cA, met.cA], opts(t += 1000))).ok, true)
  const [m] = await E.h.contacts(); assert.equal(m.sharedConnect.met, true); assert.equal(m.id, met.cA)
  const metRelId = 'r-' + labelOf(met.id).slice('pair/'.length)
  assert.ok(m.relationships.some((r) => r.id === metRelId))
  const dep = await E.h.depart(m.id, opts(t += 1000, { relationshipId: metRelId })); assert.equal(dep.ok, true, JSON.stringify(dep))
  const [after] = await E.h.contacts()
  assert.notEqual(after.id, m.id, 'the entry was renamed'); assert.equal(after.id, link.cA)
  assert.deepEqual(after.sharedConnect, { enactmentId: link.id, channel: 'sent', theirChannel: 'link', met: false }, 'the link relationship alone remains')
  assert.deepEqual(await E.h.trust(after.id, opts(t += 1000)), { ok: false, code: 'not-met' })
})
