// vectors/shared-connect.json: every proof verifies, every receiving-side
// check passes, the link and the back-code read back to the documents, and
// every must-fail case fails for the stated reason.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sharedConnect as sc } from '../dist/index.js'
import { diVerify } from '../dist/crypto.js'
import { base58, fromB64u } from '../dist/core.js'

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

test('shared-connect vector: a receipt digest in base58btc (Keyring) names the same credential; a different digest does not', async () => {
  // TT §4.9.3: DigestMultibase admits base58btc and base64url; comparison is over the decoded multihash bytes
  const r = S['receipt-inviter']
  const z = 'z' + base58(fromB64u(r.payload.vrcDigestMultibase.slice(1)))
  assert.ok(z.startsWith('z') && z !== r.payload.vrcDigestMultibase)
  const asKeyring = { ...r, payload: { vrcDigestMultibase: z } }
  const exp = { issuerDid: V.responder.messaging, myDid: V.inviter.messaging }
  // the proof no longer verifies over the re-encoded payload, so the check stops at proof, not at the digest
  assert.equal(await sc.checkReceipt(asKeyring, S['issue-inviter'], exp, t(r.issuedAt) + 1000), 'proof')
  assert.ok(sc.sameDigest(z, r.payload.vrcDigestMultibase))
  assert.ok(!sc.sameDigest('z' + base58(new Uint8Array(34).fill(1)), r.payload.vrcDigestMultibase))
  assert.ok(!sc.sameDigest('fabc', r.payload.vrcDigestMultibase))
  const other = { ...r, payload: { vrcDigestMultibase: 'u' + r.payload.vrcDigestMultibase.slice(1, -2) + 'AA' } }
  assert.equal(await sc.checkReceipt(other, S['issue-inviter'], exp, t(r.issuedAt) + 1000), 'vrc-digest')
  // an issue whose stated digest is base58btc over the same credential passes the digest check
  const i = S['issue-responder']
  const zi = 'z' + base58(fromB64u(i.payload.vrcDigestMultibase.slice(1)))
  assert.ok(sc.sameDigest(zi, i.payload.vrcDigestMultibase))
})
