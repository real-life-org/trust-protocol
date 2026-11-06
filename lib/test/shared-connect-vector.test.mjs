// vectors/shared-connect.json: every proof verifies, every receiving-side
// check passes, the link and the back-code read back to the documents.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sharedConnect as sc } from '../dist/index.js'
import { diVerify } from '../dist/crypto.js'

const V = JSON.parse(readFileSync(new URL('../../vectors/shared-connect.json', import.meta.url), 'utf8'))
const S = V.steps
const t = (s) => Date.parse(s)

test('shared-connect vector: identifiers and link', () => {
  assert.equal(V.ceremony, sc.CEREMONY_URI)
  assert.deepEqual(sc.parsePeer2(V.inviter.messaging).doc, V.inviter.document)
  assert.deepEqual(sc.parsePeer2(V.responder.messaging).relays, V.responder.relays)
  const r = sc.readSharedConnectLink(V.link.value, V.link.read.exp - 1)
  assert.ok(r.ok)
  assert.equal(r.link.from.did, V.inviter.messaging); assert.equal(r.link.id, V.challenges.inviter); assert.equal(r.link.label, 'Anton')
  assert.ok(V.link.value.length <= 450)
})

test('shared-connect vector: every step verifies and passes its check', async () => {
  for (const k of Object.keys(S)) assert.ok(await sc.verifyStep(S[k]), k)
  const me = { did: V.inviter.messaging, id: V.challenges.inviter }
  assert.equal(await sc.checkPropose(S.propose, me, t(S.propose.issuedAt) + 1000), null)
  assert.equal(await sc.checkAccept(S.accept, S.propose, V.inviter.messaging), null)
  assert.equal(await sc.binding(V.challenges.inviter, V.challenges.responder), V.binding)
  assert.equal(await sc.checkIssue(S['issue-inviter'], { issuerDid: V.inviter.messaging, myDid: V.responder.messaging, threadId: S.propose.id, enactment: V.challenges.inviter, step: 'issue-inviter', issuerPair: V.inviter.relationshipDid, myPair: V.responder.relationshipDid, myChallenge: V.challenges.responder, binding: V.binding }), null)
  assert.equal(await sc.checkIssue(S['issue-responder'], { issuerDid: V.responder.messaging, myDid: V.inviter.messaging, threadId: S.propose.id, enactment: V.challenges.inviter, step: 'issue-responder', issuerPair: V.responder.relationshipDid, myPair: V.inviter.relationshipDid, myChallenge: V.challenges.inviter, binding: V.binding }), null)
  for (const k of ['issue-inviter', 'issue-responder']) {
    assert.ok(await diVerify(S[k].payload.vrc))
    assert.equal(S['receipt-' + k.slice(6)].payload.vrcDigestMultibase, S[k].payload.vrcDigestMultibase)
    assert.equal(S[k].threadId, S.propose.id); assert.equal(S[k].ceremony.enactment, V.challenges.inviter)
  }
  assert.deepEqual(S['issue-inviter'].payload.vrc.credentialSubject.channel, 'displayed')
  assert.deepEqual(S['issue-responder'].payload.vrc.credentialSubject.channel, 'scan')
})

test('shared-connect vector: the back-code rebuilds the propose', () => {
  assert.deepEqual(sc.proposeFromBackCode(V.backCode.value, { did: V.inviter.messaging, id: V.challenges.inviter }), S.propose)
})
