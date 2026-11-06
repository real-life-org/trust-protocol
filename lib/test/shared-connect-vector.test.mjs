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
  assert.equal(await sc.checkPropose(S.propose, me, t(S.propose.issuedAt) + 1000), null)
  assert.equal(await sc.checkAccept(S.accept, S.propose, V.inviter.messaging, t(S.accept.issuedAt) + 1000), null)
  assert.equal(await sc.binding(V.challenges.inviter, V.challenges.responder), V.binding)
  assert.equal(await sc.checkIssue(S['issue-inviter'], { issuerDid: V.inviter.messaging, myDid: V.responder.messaging, threadId: S.propose.id, enactment: V.challenges.inviter, step: 'issue-inviter', issuerPair: V.inviter.relationshipDid, myPair: V.responder.relationshipDid, myChallenge: V.challenges.responder, binding: V.binding }, t(S['issue-inviter'].issuedAt) + 1000), null)
  assert.equal(await sc.checkIssue(S['issue-responder'], { issuerDid: V.responder.messaging, myDid: V.inviter.messaging, threadId: S.propose.id, enactment: V.challenges.inviter, step: 'issue-responder', issuerPair: V.responder.relationshipDid, myPair: V.inviter.relationshipDid, myChallenge: V.challenges.inviter, binding: V.binding }, t(S['issue-responder'].issuedAt) + 1000), null)
  assert.equal(await sc.checkReceipt(S['receipt-inviter'], S['issue-inviter'], { issuerDid: V.responder.messaging, myDid: V.inviter.messaging }, t(S['receipt-inviter'].issuedAt) + 1000), null)
  assert.equal(await sc.checkReceipt(S['receipt-responder'], S['issue-responder'], { issuerDid: V.inviter.messaging, myDid: V.responder.messaging }, t(S['receipt-responder'].issuedAt) + 1000), null)
  for (const k of ['issue-inviter', 'issue-responder']) {
    assert.ok(await diVerify(S[k].payload.vrc))
    assert.equal(S['receipt-' + k.slice(6)].payload.vrcDigestMultibase, S[k].payload.vrcDigestMultibase)
    assert.equal(S[k].threadId, S.propose.id); assert.equal(S[k].ceremony.enactment, V.challenges.inviter)
  }
  assert.deepEqual(Object.keys(S.accept.payload).sort(), ['accept', 'relationshipDid'])
  assert.equal(S['issue-inviter'].payload.vrc.credentialSubject.channel, 'displayed')
  assert.equal(S['issue-responder'].payload.vrc.credentialSubject.channel, 'scan')
})

test('shared-connect vector: the back-code rebuilds the propose', () => {
  assert.deepEqual(sc.proposeFromBackCode(V.backCode.value, me), S.propose)
})

test('shared-connect vector: every must-fail case fails for its reason', async () => {
  for (const c of V.mustFail.links) {
    const r = sc.readSharedConnectLink(c.link, c.readAt)
    assert.ok(!r.ok && r.reason === c.reason, c.name + ': ' + (r.ok ? 'ok' : r.reason))
  }
  for (const c of V.mustFail.propose) assert.equal(await sc.checkPropose(c.document, c.me, t(c.at)), c.reason, c.name)
  for (const c of V.mustFail.accept) assert.equal(await sc.checkAccept(c.document, S.propose, V.inviter.messaging, t(S.accept.issuedAt) + 1000), c.reason, c.name)
  for (const c of V.mustFail.backCodes) {
    const rebuilt = sc.proposeFromBackCode(c.code, me)
    if (c.result === 'not a back-code') assert.equal(rebuilt, null, c.name)
    else assert.equal(await sc.checkPropose(rebuilt, me, t(S.propose.issuedAt) + 1000), c.reason, c.name)
  }
})
