// vectors/shared-connect.json: every proof verifies, every receiving-side
// check passes, the link and the back-code read back to the documents, and
// every must-fail case fails for the stated reason.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sharedConnect as sc } from '../dist/index.js'
import { diVerify } from '../dist/crypto.js'

const V = JSON.parse(readFileSync(new URL('../../vectors/shared-connect.json', import.meta.url), 'utf8'))
const S = V.steps
const t = (s) => Date.parse(s)
const me = { did: V.inviter.messaging, id: V.challenges.inviter, exp: V.link.read.exp }

test('shared-connect vector: identifiers and link', async () => {
  assert.equal(V.ceremony, sc.CEREMONY_URI)
  assert.deepEqual(sc.parsePeer2(V.inviter.messaging).doc, V.inviter.document)
  assert.deepEqual(sc.parsePeer2(V.responder.messaging).relays, V.responder.relays)
  const r = (await sc.readSharedConnectLink(V.link.value, V.link.read.exp - 1))
  assert.ok(r.ok)
  assert.equal(r.link.from.did, V.inviter.messaging); assert.equal(r.link.id, V.challenges.inviter); assert.equal(r.link.label, 'Anton')
  assert.ok(V.link.value.length <= 450)
})

test('shared-connect vector: every step verifies and passes its check', async () => {
  for (const k of Object.keys(S)) assert.ok(await sc.verifyStep(S[k]), k)
  assert.equal(await sc.checkPropose(S.propose, me, t(S.propose.issuedAt) + 1000), null)
  assert.equal(await sc.checkAccept(S.accept, S.propose, V.inviter.messaging, t(S.accept.issuedAt) + 1000), null)
  assert.deepEqual(V.citation, { taskContext: S.propose.id, taskDigestMultibase: await sc.taskDigest(S.propose) })
  assert.equal(await sc.checkIssue(S['issue-inviter'], { issuerDid: V.inviter.messaging, myDid: V.responder.messaging, threadId: S.propose.id, enactment: V.challenges.inviter, step: 'issue-inviter', issuerPair: V.inviter.relationshipDid, myPair: V.responder.relationshipDid, propose: S.propose }, t(S['issue-inviter'].issuedAt) + 1000), null)
  assert.equal(await sc.checkIssue(S['issue-responder'], { issuerDid: V.responder.messaging, myDid: V.inviter.messaging, threadId: S.propose.id, enactment: V.challenges.inviter, step: 'issue-responder', issuerPair: V.responder.relationshipDid, myPair: V.inviter.relationshipDid, propose: S.propose }, t(S['issue-responder'].issuedAt) + 1000), null)
  assert.equal(await sc.checkReceipt(S['receipt-inviter'], S['issue-inviter'], { issuerDid: V.responder.messaging, myDid: V.inviter.messaging }, t(S['receipt-inviter'].issuedAt) + 1000), null)
  assert.equal(await sc.checkReceipt(S['receipt-responder'], S['issue-responder'], { issuerDid: V.inviter.messaging, myDid: V.responder.messaging }, t(S['receipt-responder'].issuedAt) + 1000), null)
  for (const k of ['issue-inviter', 'issue-responder']) {
    assert.ok(await diVerify(S[k].payload.vrc))
    assert.equal(S['receipt-' + k.slice(6)].payload.vrcDigestMultibase, S[k].payload.vrcDigestMultibase)
    assert.equal(S[k].threadId, S.propose.id); assert.equal(S[k].ceremony.enactment, V.challenges.inviter)
  }
  assert.deepEqual(Object.keys(S.accept.payload).sort(), ['accept', 'relationshipDid'])
  assert.equal(sc.channelOf(S['issue-inviter'].payload.vrc), 'displayed')
  assert.equal(sc.channelOf(S['issue-responder'].payload.vrc), 'scan')
  assert.deepEqual(S['issue-inviter'].payload.vrc['@context'], ['https://www.w3.org/ns/credentials/v2', 'https://registry.trustoverip.org/dtg/context/v1'], 'two registry contexts only')
  assert.ok(!S['issue-inviter'].payload.vrc.type.includes('EncounterCredential'))
})

test('shared-connect vector: the back-code rebuilds the propose', async () => {
  assert.deepEqual((await sc.proposeFromBackCode(V.backCode.value, me)), S.propose)
})

test('shared-connect vector: every must-fail case fails for its reason', async () => {
  for (const c of V.mustFail.links) {
    const r = (await sc.readSharedConnectLink(c.link, c.readAt))
    assert.ok(!r.ok && r.reason === c.reason, c.name + ': ' + (r.ok ? 'ok' : r.reason))
  }
  for (const c of V.mustFail.propose) assert.equal(await sc.checkPropose(c.document, c.me, t(c.at)), c.reason, c.name)
  for (const c of V.mustFail.accept) assert.equal(await sc.checkAccept(c.document, S.propose, V.inviter.messaging, t(S.accept.issuedAt) + 1000), c.reason, c.name)
  for (const c of V.mustFail.backCodes) {
    const rebuilt = (await sc.proposeFromBackCode(c.code, me))
    if (c.result === 'not a back-code') assert.equal(rebuilt, null, c.name)
    else assert.equal(await sc.checkPropose(rebuilt, me, t(S.propose.issuedAt) + 1000), c.reason, c.name)
  }
})

test('shared-connect vector: the codes of the offline path carry cards that rebuild and verify', async () => {
  const O = V.offline, S = V.steps
  const me = { did: V.inviter.messaging, id: V.challenges.inviter }
  const nowS = V.link.read.exp - 600
  const read = await sc.readSharedConnectLink(O.link.value, nowS)
  assert.equal(read.ok, true); assert.deepEqual(read.link.card, O.inviter.card)
  assert.equal(read.link.card.challenge.value, V.challenges.inviter); assert.equal(read.link.card.anchor, V.inviter.relationshipDid)
  assert.equal(O.link.value.length, O.link.length); assert.ok(O.link.length <= sc.LINK_BUDGET)
  // without the card's names it is the plain link
  assert.equal(O.link.value.replace(/&rel=[^&]*&t=[^&]*&ka=[^&]*&h=[^&]*&csig=[^&]*/, ''), V.link.value)
  const back = await sc.readBackCode(O.backCode.value, me)
  assert.deepEqual(back.propose, S.propose); assert.deepEqual(back.card, O.responder.card)
  assert.equal(back.card.challenge.value, V.challenges.responder); assert.equal(back.card.anchor, V.responder.relationshipDid)
  assert.equal(sc.backCodeOf(S.propose, undefined, O.responder.card), O.backCode.value)
  for (const c of O.mustFail.links) assert.deepEqual(await sc.readSharedConnectLink(c.link, c.readAt), { ok: false, reason: c.reason }, c.name)
  for (const c of O.mustFail.backCodes) assert.equal(await sc.readBackCode(c.code, me), null, c.name)
})

test('shared-connect vector: the did:peer:4 variant resolves and passes its checks', async () => {
  const P = V.peer4
  for (const side of [P.inviter, P.responder]) {
    const p = await sc.parsePeer(side.messaging)
    assert.deepEqual(p.doc, side.document); assert.equal(p.ref, side.short); assert.deepEqual(p.relays, side.relays)
  }
  const r = await sc.readSharedConnectLink(P.link.value, V.link.read.exp - 1)
  assert.ok(r.ok); assert.equal(r.link.from.did, P.inviter.messaging)
  const me4 = { did: P.inviter.messaging, id: V.challenges.inviter, exp: V.link.read.exp }
  assert.equal(await sc.checkPropose(P.steps.propose, me4, t(P.steps.propose.issuedAt) + 1000), null)
  assert.equal(await sc.checkAccept(P.steps.accept, P.steps.propose, P.inviter.messaging, t(P.steps.accept.issuedAt) + 1000), null)
})

