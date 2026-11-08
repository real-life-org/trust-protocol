// shared-connect 0.1: one full enactment on registry tasks, the link, the
// back-code, and the refusals the receiving sides must produce.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sharedConnect as sc } from '../dist/index.js'
import { hkdf, diVerify, anchorOfEd, mkOfX, b64uOf } from '../dist/crypto.js'
import { base58, fromB64u } from '../dist/core.js'

const te = new TextEncoder()
const seed = (label) => hkdf(te.encode('shared-connect test seed'), label)
const T0 = Date.parse('2026-11-07T10:00:00Z')
const T0S = Math.floor(T0 / 1000)
const MED = { kind: 'tsp-mediator', address: 'wss://mediator.web-of-trust.de' }
const NOSTR = { kind: 'nostr-relay', address: 'wss://nostr.myceli.al' }
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')

async function parties () {
  const inviter = await sc.partyFromSeeds(await seed('inviter/msg'), await seed('inviter/pair'), [MED, NOSTR], 'Anton')
  const responder = await sc.partyFromSeeds(await seed('responder/msg'), await seed('responder/pair'), [MED], 'Day')
  return { inviter, responder }
}
const challenge = async (label) => sc.challengeOf16((await hkdf(te.encode('challenge'), label, 16)))
const fid = (label) => challenge('id/' + label)

// one complete enactment, shared by several tests
async function enactment () {
  const { inviter, responder } = await parties()
  const invId = await challenge('inviter'), respId = await challenge('responder')
  const exp = T0S + 600
  const link = (await sc.sharedConnectLink({ from: inviter.messaging.did, id: invId, exp, label: 'Anton' }, undefined, T0S))
  const read = (await sc.readSharedConnectLink(link, T0S)); assert.ok(read.ok)
  const prop = await sc.propose(responder, read.link.from.did, read.link.id, respId, T0 + 5_000)
  const acc = await sc.accept(inviter, prop, T0 + 7_000, await fid('acc'))
  const b = await sc.binding(invId, respId)
  const vrcInv = await sc.credential(inviter, prop.payload.relationshipDid, respId, b, 'displayed', T0 + 7_000)
  const issInv = await sc.issue(inviter, prop.issuer, respId, invId, 'issue-inviter', vrcInv, T0 + 7_000, await fid('ii'))
  const rcpInv = await sc.receipt(responder, issInv, T0 + 8_000, await fid('ri'))
  const vrcResp = await sc.credential(responder, acc.payload.relationshipDid, invId, b, 'scan', T0 + 9_000)
  const issResp = await sc.issue(responder, inviter.messaging.did, respId, invId, 'issue-responder', vrcResp, T0 + 9_000, await fid('ir'))
  const rcpResp = await sc.receipt(inviter, issResp, T0 + 10_000, await fid('rr'))
  const me = { did: inviter.messaging.did, id: invId, exp }
  const expInv = { issuerDid: inviter.messaging.did, myDid: responder.messaging.did, threadId: respId, enactment: invId, step: 'issue-inviter', issuerPair: inviter.pair.anchor, myPair: responder.pair.anchor, myChallenge: respId, binding: b }
  const expResp = { issuerDid: responder.messaging.did, myDid: inviter.messaging.did, threadId: respId, enactment: invId, step: 'issue-responder', issuerPair: responder.pair.anchor, myPair: inviter.pair.anchor, myChallenge: invId, binding: b }
  return { inviter, responder, invId, respId, exp, link, read, prop, acc, b, vrcInv, issInv, rcpInv, vrcResp, issResp, rcpResp, me, expInv, expResp }
}

test('did:peer:2: our form V.A.E, keys numbered in order, both service spellings, DIF relationships', async () => {
  const { inviter } = await parties()
  const p = sc.parsePeer2(inviter.messaging.did)
  assert.ok(p)
  assert.deepEqual(p.doc.verificationMethod.map((m) => m.id), ['#key-1', '#key-2', '#key-3'])
  assert.deepEqual(p.doc.authentication, ['#key-1']); assert.deepEqual(p.doc.assertionMethod, ['#key-2']); assert.deepEqual(p.doc.keyAgreement, ['#key-3'])
  assert.deepEqual(p.relays, [MED, NOSTR])
  assert.equal(sc.peer2MethodFor(p, 'authentication').id, inviter.messaging.did + '#key-1')
  assert.equal(sc.peer2MethodFor(p, 'assertionMethod').id, inviter.messaging.did + '#key-2')
  // the TSP reference spelling: type 'tsp', endpoint {uri}; a DIDComm endpoint object with abbreviations
  const base = inviter.messaging.did.split('.').slice(0, 4).join('.')
  assert.deepEqual(sc.parsePeer2(base + '.S' + b64({ t: 'tsp', s: { uri: 'wss://x.example' } })).relays, [{ kind: 'tsp-mediator', address: 'wss://x.example' }])
  const dm = sc.parsePeer2(base + '.S' + b64({ t: 'dm', s: { uri: 'https://m.example', a: ['didcomm/v2'], r: [] } }))
  assert.deepEqual(dm.doc.service[0], { id: '#service', type: 'DIDCommMessaging', serviceEndpoint: { uri: 'https://m.example', accept: ['didcomm/v2'], routingKeys: [] } })
  // E before V (common in DIDComm stacks): read, keys numbered as they appear
  const [v, a, e] = inviter.messaging.did.split('.').slice(1, 4)
  const ev = sc.parsePeer2('did:peer:2.' + e + '.' + v)
  assert.ok(ev); assert.deepEqual(ev.doc.keyAgreement, ['#key-1']); assert.deepEqual(ev.doc.authentication, ['#key-2']); assert.deepEqual(ev.doc.assertionMethod, [])
  // not ours: no X25519 key; two authentication keys; an Ed key under E; a did:key; a stray character
  assert.equal(sc.parsePeer2('did:peer:2.' + v + '.' + a), null)
  assert.equal(sc.parsePeer2('did:peer:2.' + v + '.' + v + '.' + e), null)
  assert.equal(sc.parsePeer2('did:peer:2.' + v + '.E' + v.slice(1)), null)
  assert.equal(sc.parsePeer2('did:key:z6Mk'), null)
  assert.equal(sc.parsePeer2(inviter.messaging.did + '#key-1'), null)
})

test('link: render, read, every refusal, label rule', async () => {
  const { inviter, link, read, invId, exp } = await enactment()
  assert.ok(link.length < 450, 'a code shown in person stays under about 450 characters: ' + link.length)
  assert.equal(read.link.id, invId); assert.equal(read.link.from.did, inviter.messaging.did); assert.equal(read.link.label, 'Anton'); assert.equal(read.link.type, sc.FLOW_URI)
  const r = async (l, now = T0S) => (await sc.readSharedConnectLink(l, now))
  assert.equal((await r(link, exp)).reason, 'expired')
  assert.equal((await r(link, exp - 1)).ok, true)
  assert.equal((await r('A'.repeat(1537))).reason, 'too-long')
  assert.equal((await r(link.replace('https://', 'http://'))).reason, 'not-https')
  assert.equal((await r(link.replace('link.trustoverip.org', 'user@link.trustoverip.org'))).reason, 'bad-host')
  assert.equal((await r(link.replace('#', '?'))).reason, 'no-fragment')
  assert.equal((await r(link + '&_id=' + invId)).reason, 'repeated-param')
  assert.equal((await r(link.replace('_from=', 'x_from='))).reason, 'missing-from')
  assert.equal((await r(link.replace('_from=did:peer:2', '_from=nota:did'))).reason, 'bad-from')
  assert.equal((await r(link.replace('_id=', 'x_id='))).reason, 'missing-id')
  assert.equal((await r(link.replace('_id=' + invId, '_id=' + invId.slice(1)))).reason, 'bad-id')
  assert.equal((await r(link.replace('_type=', 'x_type='))).reason, 'missing-type')
  assert.equal((await r(link.replace('/vti/flow/shared-connect/0.1', '/vti/flow/sign-in/0.1'))).reason, 'unknown-flow')
  // VTI-LNK-043: the same path on another host is another flow; the absolute registered URI on another host is ours
  assert.equal((await r(link.replace('https://link.trustoverip.org/t', 'https://evil.example/t'))).reason, 'unknown-flow')
  assert.ok((await r(link.replace('https://link.trustoverip.org/t', 'https://other.example/t').replace('_type=/vti', '_type=https://link.trustoverip.org/vti'))).ok)
  assert.equal((await r(link.replace(/_from=did:peer:2[^&]*/, '_from=did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'))).reason, 'unsupported-vid')
  assert.equal((await r(link.replace('_exp=', 'x_exp='))).reason, 'missing-exp')
  assert.equal((await r(link.replace('_exp=' + exp, '_exp=0' + exp))).reason, 'bad-exp')
  assert.equal((await r(link.replace('_exp=' + exp, '_exp=' + (T0S + sc.MAX_EXP_LINK_S + 3600)))).reason, 'bad-exp')
  assert.ok((await r(link.replace('_exp=' + exp, '_exp=' + (T0S + sc.MAX_EXP_LINK_S)))).ok)
  // the label: a bidi control drops it, a line separator drops it, too long drops it; the link still reads
  for (const bad of ['An‮ton', 'An ton', 'x'.repeat(65)]) {
    const r2 = await r(link.replace('_label=Anton', '_label=' + encodeURIComponent(bad)))
    assert.ok(r2.ok); assert.equal(r2.link.label, undefined)
  }
  assert.equal((await r(link.replace('_label=Anton', '_label=' + encodeURIComponent('é'.normalize('NFD').repeat(64))))).link.label, 'é'.repeat(64))
  // unknown names and their repeats are ignored; a prototype name is not a repeat
  assert.ok((await r(link + '&utm_source=mail&utm_source=again&__proto__=1')).ok)
  // writer: the same label rule, the expiry caps per kind
  await assert.rejects(async () => (await sc.sharedConnectLink({ from: inviter.messaging.did, id: invId, exp, label: 'x'.repeat(65) }, undefined, T0S)))
  await assert.rejects(async () => (await sc.sharedConnectLink({ from: inviter.messaging.did, id: invId, exp: T0S + 601 }, undefined, T0S)))
  assert.ok((await sc.sharedConnectLink({ from: inviter.messaging.did, id: invId, exp: T0S + 3600, kind: 'link' }, undefined, T0S)))
  await assert.rejects(async () => (await sc.sharedConnectLink({ from: inviter.messaging.did, id: invId, exp: T0S + sc.MAX_EXP_LINK_S + 1, kind: 'link' }, undefined, T0S)))
  // on another origin the writer renders the absolute flow URI (VTI-LNK-042), and the reader takes it
  const foreign = (await sc.sharedConnectLink({ from: inviter.messaging.did, id: invId, exp }, 'https://wot.example', T0S))
  assert.ok(foreign.includes('_type=https://link.trustoverip.org/vti/flow/shared-connect/0.1')); assert.ok((await r(foreign)).ok)
})

test('one enactment: every document verifies and passes its check; payloads are closed', async () => {
  const E = await enactment()
  assert.equal(E.prop.id, E.respId); assert.equal(E.prop.ceremony.enactment, E.invId); assert.equal(E.prop.threadId, undefined)
  assert.equal(await sc.checkPropose(E.prop, E.me, T0 + 6_000), null)
  assert.equal(E.acc.threadId, E.respId)
  assert.deepEqual(Object.keys(E.acc.payload).sort(), ['accept', 'relationshipDid'])
  assert.equal(await sc.checkAccept(E.acc, E.prop, E.inviter.messaging.did, T0 + 8_000), null)
  assert.equal(await sc.checkIssue(E.issInv, E.expInv, T0 + 8_000), null)
  assert.equal(await sc.checkReceipt(E.rcpInv, E.issInv, { issuerDid: E.responder.messaging.did, myDid: E.inviter.messaging.did }, T0 + 9_000), null)
  assert.equal(E.issResp.ceremony.terminal, true)
  assert.equal(await sc.checkIssue(E.issResp, E.expResp, T0 + 10_000), null)
  assert.equal(await sc.checkReceipt(E.rcpResp, E.issResp, { issuerDid: E.inviter.messaging.did, myDid: E.responder.messaging.did }, T0 + 11_000), null)
  assert.ok(await diVerify(E.vrcInv, E.inviter.pair.anchor)); assert.ok(await diVerify(E.vrcResp, E.responder.pair.anchor))
  assert.deepEqual(E.vrcInv.proof['@context'], E.vrcInv['@context'])
  for (const d of [E.prop, E.acc, E.issInv, E.issResp, E.rcpInv, E.rcpResp]) {
    assert.equal(d.proof.verificationMethod, d.issuer + '#key-1'); assert.equal(d.proof.proofPurpose, 'authentication')
    assert.ok(await sc.verifyStep(d))
  }
})

test('verifyStep: the method must be the issuer\'s, listed under the purpose, and an Ed25519 key', async () => {
  const E = await enactment()
  const [, v, a, e] = E.responder.messaging.did.split('.')
  // E before V: the authentication key is #key-2; a proof naming #key-1 (the X25519 method) is refused, #key-2 verifies
  const evDid = 'did:peer:2.' + e + '.' + v + '.' + a
  const evParty = { messaging: { did: evDid, ed: E.responder.messaging.ed }, pair: E.responder.pair }
  const p = await sc.propose(evParty, E.inviter.messaging.did, E.invId, E.respId, T0)
  assert.equal(p.proof.verificationMethod, evDid + '#key-2')
  assert.ok(await sc.verifyStep(p))
  assert.equal(await sc.verifyStep({ ...p, proof: { ...p.proof, verificationMethod: evDid + '#key-1' } }), false)
  // the assertionMethod key (#key-3 here) is accepted under proofPurpose assertionMethod, not under authentication
  assert.equal(await sc.verifyStep({ ...p, proof: { ...p.proof, verificationMethod: evDid + '#key-3' } }), false)
  const asAssertion = await sc.signStep(evParty.messaging, (({ proof, ...rest }) => rest)(p), p.issuedAt)
  assert.ok(await sc.verifyStep({ ...asAssertion, proof: { ...asAssertion.proof, proofPurpose: 'assertionMethod', verificationMethod: evDid + '#key-3' } }) === false, 'a re-labelled purpose does not verify: the purpose is under the signature')
  // a different issuer than the signer; a foreign @context in the proof; a padded proofValue
  assert.equal(await sc.verifyStep({ ...E.prop, issuer: E.inviter.messaging.did }), false)
  assert.equal(await sc.verifyStep({ ...E.vrcInv, issuer: E.responder.messaging.did }), false)
  assert.equal(await sc.verifyStep({ ...E.prop, proof: { ...E.prop.proof, proofValue: E.prop.proof.proofValue + '1' } }), false)
})

test('checkPropose: every refusal, including the expired link and the age gate', async () => {
  const E = await enactment()
  const c = (doc, me = E.me, now = T0 + 6_000) => sc.checkPropose(doc, me, now)
  assert.equal(await c({ ...E.prop, type: sc.TASK_ISSUE }), 'type')
  assert.equal(await c({ ...E.prop, issuedAt: 'yesterday' }), 'envelope')
  assert.equal(await c({ ...E.prop, expiresAt: 'soon' }), 'envelope')
  assert.equal(await c({ ...E.prop, payload: { ...E.prop.payload, extra: 1 } }), 'payload')
  assert.equal(await c({ ...E.prop, payload: { relationshipDid: E.prop.payload.relationshipDid, reason: '' } }), 'payload')
  assert.equal(await c({ ...E.prop, expiresAt: '2026-11-07T09:58:00Z' }), 'expired')
  // expiresAt: the tolerance works for the document (a re-signed propose, so the proof holds)
  const withExp = await sc.propose(E.responder, E.inviter.messaging.did, E.invId, E.respId, T0 + 5_000, T0 + 125_000)
  assert.equal(await c(withExp, E.me, T0 + 124_000), null)
  assert.equal(await c(withExp, E.me, T0 + 125_000 + 59_000), null)
  assert.equal(await c(withExp, E.me, T0 + 125_000 + 61_000), 'expired')
  // issuedAt in the future beyond the tolerance, for every step
  assert.equal(await sc.checkIssue(E.issInv, E.expInv, T0 + 7_000 - 61_000), 'not-fresh')
  assert.equal(await sc.checkIssue(E.issInv, E.expInv, T0 + 7_000 - 59_000), null)
  // reason counts code points: 300 emoji are schema-valid
  assert.equal(await c({ ...E.prop, payload: { ...E.prop.payload, reason: '😀'.repeat(300) } }), 'proof')
  assert.equal(await c(E.prop, E.me, T0 + 16 * 60_000), 'not-fresh')
  assert.equal(await c(E.prop, E.me, T0 - 120_000), 'not-fresh')
  // the link's _exp bounds the handle: a propose that is fresh itself is refused once _id expired
  const late = await sc.propose(E.responder, E.inviter.messaging.did, E.invId, E.respId, (E.exp + 240) * 1000)
  assert.equal(await c(late, E.me, (E.exp + 241) * 1000), 'expired-link')
  assert.equal(await c({ ...E.prop, issuer: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK' }), 'issuer-not-peer')
  assert.equal(await c(E.prop, { ...E.me, did: E.responder.messaging.did }), 'recipient')
  assert.equal(await c(E.prop, { ...E.me, id: E.respId }), 'enactment')
  assert.equal(await c({ ...E.prop, id: 'short' }), 'challenge-form')
  assert.equal(await c({ ...E.prop, payload: { relationshipDid: 'did:peer:4zQm:z' } }), 'unsupported-pair-did')
  assert.equal(await c({ ...E.prop, recipient: E.inviter.messaging.did, payload: { ...E.prop.payload, reason: 'Night' } }), 'proof')
})

test('checkAccept, checkIssue, checkReceipt: every refusal', async () => {
  const E = await enactment()
  const other = await sc.partyFromSeeds(await seed('x/msg'), await seed('x/pair'), [])
  const ca = (doc) => sc.checkAccept(doc, E.prop, E.inviter.messaging.did, T0 + 8_000)
  assert.equal(await ca(await sc.accept(other, E.prop, T0 + 7_000, await fid('x'))), 'issuer')
  assert.equal(await ca({ ...E.acc, payload: { ...E.acc.payload, accept: false } }), 'accept-flag')
  assert.equal(await ca({ ...E.acc, payload: { ...E.acc.payload, reason: 'Anton' } }), 'payload')
  assert.equal(await ca({ ...E.acc, recipient: other.messaging.did }), 'recipient')
  assert.equal(await ca({ ...E.acc, threadId: E.invId }), 'thread')
  assert.equal(await ca({ ...E.acc, ceremony: { ...E.acc.ceremony, step: 'issue-inviter' } }), 'enactment')
  assert.equal(await ca({ ...E.acc, payload: { accept: true, relationshipDid: 'did:web:x' } }), 'unsupported-pair-did')
  assert.equal(await ca({ ...E.acc, payload: { accept: true, relationshipDid: other.pair.anchor } }), 'proof')
  const ci = (doc, x = {}) => sc.checkIssue(doc, { ...E.expInv, ...x }, T0 + 8_000)
  assert.equal(await ci(await sc.signStep(E.inviter.messaging, (({ proof, ...r }) => ({ ...r, payload: { vrc: E.vrcInv } }))(E.issInv), E.issInv.issuedAt)), null, 'vrcDigestMultibase is optional on the request')
  assert.equal(await ci({ ...E.issInv, payload: { ...E.issInv.payload, note: 1 } }), 'payload')
  assert.equal(await ci(E.issInv, { issuerDid: other.messaging.did }), 'issuer')
  assert.equal(await ci(E.issInv, { myDid: other.messaging.did }), 'recipient')
  assert.equal(await ci(E.issInv, { threadId: E.invId }), 'thread')
  assert.equal(await ci(E.issInv, { step: 'issue-responder' }), 'enactment')
  assert.equal(await ci(E.issInv, { issuerPair: other.pair.anchor }), 'vrc-issuer')
  assert.equal(await ci({ ...E.issInv, payload: { ...E.issInv.payload, vrc: { ...E.vrcInv, validFrom: '2026-11-07T10:00:08Z' } } }), 'proof', 'the envelope proof covers the credential bytes')
  const swapped = await sc.credential(E.inviter, other.pair.anchor, E.respId, E.b, 'displayed', T0 + 7_000)
  const issSwapped = await sc.issue(E.inviter, E.prop.issuer, E.respId, E.invId, 'issue-inviter', swapped, T0 + 7_000, await fid('sw'))
  assert.equal(await ci(issSwapped), 'vrc-subject')
  const wrongDigest = { ...E.issInv, payload: { ...E.issInv.payload, vrcDigestMultibase: 'uEiA' + 'A'.repeat(43) } }
  assert.equal(await ci(await sc.signStep(E.inviter.messaging, (({ proof, ...r }) => r)(wrongDigest), E.issInv.issuedAt)), 'vrc-digest')
  const otherBinding = await sc.credential(E.inviter, E.prop.payload.relationshipDid, E.respId, await sc.binding(E.invId, await challenge('z')), 'displayed', T0 + 7_000)
  assert.equal(await ci(await sc.issue(E.inviter, E.prop.issuer, E.respId, E.invId, 'issue-inviter', otherBinding, T0 + 7_000, await fid('ob'))), 'vrc-binding')
  const otherChallenge = await sc.credential(E.inviter, E.prop.payload.relationshipDid, E.invId, E.b, 'displayed', T0 + 7_000)
  assert.equal(await ci(await sc.issue(E.inviter, E.prop.issuer, E.respId, E.invId, 'issue-inviter', otherChallenge, T0 + 7_000, await fid('oc'))), 'vrc-challenge')
  // a foreign profile (Consensual's members) passes the envelope checks
  const foreignVrc = await (async () => { const { diSign } = await import('../dist/crypto.js'); return diSign(E.inviter.pair, { '@context': ['https://www.w3.org/ns/credentials/v2', 'https://registry.trustoverip.org/dtg/context/v1'], type: ['VerifiableCredential', 'RelationshipCredential', 'GebConnectionCredential'], issuer: E.inviter.pair.anchor, validFrom: '2026-11-07T10:00:07Z', credentialSubject: { id: E.prop.payload.relationshipDid, challenge: E.respId, binding: E.b, ceremony: sc.CEREMONY_URI, channel: 'sent' } }, '2026-11-07T10:00:07Z') })()
  assert.equal(await ci(await sc.issue(E.inviter, E.prop.issuer, E.respId, E.invId, 'issue-inviter', foreignVrc, T0 + 7_000, await fid('fv'))), null)
  const cr = (doc, x = {}) => sc.checkReceipt(doc, E.issInv, { issuerDid: E.responder.messaging.did, myDid: E.inviter.messaging.did, ...x }, T0 + 9_000)
  assert.equal(await cr(E.rcpInv, { issuerDid: other.messaging.did }), 'issuer')
  assert.equal(await cr({ ...E.rcpInv, threadId: E.invId }), 'thread')
  assert.equal(await cr({ ...E.rcpInv, ceremony: { ...E.rcpInv.ceremony, step: 'accept' } }), 'enactment')
  assert.equal(await cr(E.rcpResp), 'issuer')
  assert.equal(await sc.checkReceipt(E.rcpResp, E.issInv, { issuerDid: E.inviter.messaging.did, myDid: E.responder.messaging.did }, T0 + 11_000), 'enactment', 'a receipt of the other step')
  assert.equal(await sc.checkReceipt({ ...E.rcpInv, payload: { vrcDigestMultibase: E.rcpResp.payload.vrcDigestMultibase } }, E.issInv, { issuerDid: E.responder.messaging.did, myDid: E.inviter.messaging.did }, T0 + 9_000), 'vrc-digest')
})

test('offline: the back-code rebuilds the propose; tampering and replay fail', async () => {
  const E = await enactment()
  const code = sc.backCodeOf(E.prop)
  assert.ok(code.length < 560, 'back-code size ' + code.length)
  const rebuilt = (await sc.proposeFromBackCode(code, E.me))
  assert.deepEqual(rebuilt, E.prop)
  assert.equal(await sc.checkPropose(rebuilt, E.me, T0 + 6_000), null)
  // scanned by the wrong inviter, or under another _id: the rebuilt document differs, the proof fails
  assert.equal(await sc.checkPropose((await sc.proposeFromBackCode(code, { ...E.me, did: E.responder.messaging.did })), { ...E.me, did: E.responder.messaging.did }, T0 + 6_000), 'proof')
  assert.equal(await sc.checkPropose((await sc.proposeFromBackCode(code, { ...E.me, id: E.respId })), { ...E.me, id: E.respId }, T0 + 6_000), 'proof')
  // tampered name, time, relationshipDid
  for (const [a, b] of [['n=Day', 'n=Dan'], ['&t=' + Math.floor((T0 + 5000) / 1000), '&t=' + Math.floor((T0 + 6000) / 1000)], [E.prop.payload.relationshipDid, E.inviter.pair.anchor]]) {
    assert.equal(await sc.checkPropose((await sc.proposeFromBackCode(code.replace(a, b), E.me)), E.me, T0 + 6_000), 'proof', a)
  }
  // grammar: a repeated name, another host with the path form, http, a non-peer _from
  assert.equal((await sc.proposeFromBackCode(code + '&rel=did:key:zX', E.me)), null)
  assert.equal((await sc.proposeFromBackCode(code.replace('https://link.trustoverip.org/t', 'https://evil.example/t'), E.me)), null)
  assert.ok((await sc.proposeFromBackCode(code.replace('https://link.trustoverip.org/t', 'https://other.example/t').replace('_type=/vti', '_type=https://link.trustoverip.org/vti'), E.me)))
  assert.equal((await sc.proposeFromBackCode(code.replace('https://', 'http://'), E.me)), null)
  assert.equal((await sc.proposeFromBackCode(code.replace(/_from=did:peer:2[^&]*/, '_from=did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'), E.me)), null)
  // the link's _exp bounds the code
  assert.equal(await sc.checkPropose(rebuilt, E.me, (E.exp + 61) * 1000), 'expired-link')
  const lateProp = await sc.propose(E.responder, E.inviter.messaging.did, E.invId, E.respId, (E.exp + 100) * 1000)
  assert.equal(await sc.checkPropose((await sc.proposeFromBackCode(sc.backCodeOf(lateProp), E.me)), E.me, (E.exp + 101) * 1000), 'expired-link')
  // a propose with expiresAt is not a back-code candidate
  const withExp = await sc.propose(E.responder, E.inviter.messaging.did, E.invId, E.respId, T0, T0 + 60_000)
  assert.throws(() => sc.backCodeOf(withExp))
})

test('credential: EncounterCredential only for an observed encounter (scan, displayed)', async () => {
  const { inviter, responder } = await parties()
  const b = await sc.binding(await challenge('inviter'), await challenge('responder'))
  for (const [ch, enc] of [['scan', true], ['displayed', true], ['link', false], ['sent', false]]) {
    const v = await sc.credential(inviter, responder.pair.anchor, await challenge('responder'), b, ch, T0)
    assert.equal(v.type.includes('EncounterCredential'), enc, ch)
    assert.ok(v.type.includes('RelationshipCredential')); assert.equal(v.credentialSubject.channel, ch)
    assert.ok(await diVerify(v, inviter.pair.anchor))
  }
})

// the long form from the DIF Peer DID spec, numalgo 4 (identity.foundation/peer-did-method-spec)
const DIF_PEER4_LONG = 'did:peer:4zQmd8CpeFPci817KDsbSAKWcXAE2mjvCQSasRewvbSF54Bd:z2M1k7h4psgp4CmJcnQn2Ljp7Pz7ktsd7oBhMU3dWY5s4fhFNj17qcRTQ427C7QHNT6cQ7T3XfRh35Q2GhaNFZmWHVFq4vL7F8nm36PA9Y96DvdrUiRUaiCuXnBFrn1o7mxFZAx14JL4t8vUWpuDPwQuddVo1T8myRiVH7wdxuoYbsva5x6idEpCQydJdFjiHGCpNc2UtjzPQ8awSXkctGCnBmgkhrj5gto3D4i3EREXYq4Z8r2cWGBr2UzbSmnxW2BuYddFo9Yfm6mKjtJyLpF74ytqrF5xtf84MnGFg1hMBmh1xVx1JwjZ2BeMJs7mNS8DTZhKC7KH38EgqDtUZzfjhpjmmUfkXg2KFEA3EGbbVm1DPqQXayPYKAsYPS9AyKkcQ3fzWafLPP93UfNhtUPL8JW5pMcSV3P8v6j3vPXqnnGknNyBprD6YGUVtgLiAqDBDUF3LSxFQJCVYYtghMTv8WuSw9h1a1SRFrDQLGHE4UrkgoRvwaGWr64aM87T1eVGkP5Dt4L1AbboeK2ceLArPScrdYGTpi3BpTkLwZCdjdiFSfTy9okL1YNRARqUf2wm8DvkVGUU7u5nQA3ZMaXWJAewk6k1YUxKd7LvofGUK4YEDtoxN5vb6r1Q2godrGqaPkjfL3RoYPpDYymf9XhcgG8Kx3DZaA6cyTs24t45KxYAfeCw4wqUpCH9HbpD78TbEUr9PPAsJgXBvBj2VVsxnr7FKbK4KykGcg1W8M1JPz21Z4Y72LWgGQCmixovrkHktcTX1uNHjAvKBqVD5C7XmVfHgXCHj7djCh3vzLNuVLtEED8J1hhqsB1oCBGiuh3xXr7fZ9wUjJCQ1HYHqxLJKdYKtoCiPmgKM7etVftXkmTFETZmpM19aRyih3bao76LdpQtbw636r7a3qt8v4WfxsXJetSL8c7t24SqQBcAY89FBsbEnFNrQCMK3JEseKHVaU388ctvRD45uQfe5GndFxthj4iSDomk4uRFd1uRbywoP1tRuabHTDX42UxPjz'
const DIF_PEER4_SHORT = 'did:peer:4zQmd8CpeFPci817KDsbSAKWcXAE2mjvCQSasRewvbSF54Bd'

test('did:peer:4: the DIF spec example resolves, its hash binds the document, the short form needs the long', async () => {
  const p = await sc.parsePeer4(DIF_PEER4_LONG)
  assert.ok(p, 'the spec example resolves')
  assert.equal(p.ref, DIF_PEER4_SHORT)
  assert.equal(p.doc.authentication.length, 1); assert.equal(p.doc.keyAgreement.length, 1)
  assert.equal(p.doc.service[0].type, 'DIDCommMessaging')
  assert.equal(await sc.parsePeer4(DIF_PEER4_SHORT), null)
  assert.ok(await sc.parsePeer4(DIF_PEER4_SHORT, [DIF_PEER4_LONG]))
  // one character of the document changed: the hash no longer matches
  const i = DIF_PEER4_LONG.length - 5
  const bad = DIF_PEER4_LONG.slice(0, i) + (DIF_PEER4_LONG[i] === 'a' ? 'b' : 'a') + DIF_PEER4_LONG.slice(i + 1)
  assert.equal(await sc.parsePeer4(bad), null)
  assert.ok(sc.sameVid(DIF_PEER4_LONG, DIF_PEER4_SHORT)); assert.ok(!sc.sameVid(DIF_PEER4_SHORT, 'did:peer:4zQmOther'))
})

test('did:peer:4: ours round-trips, reads in the link, and a whole enactment passes with short forms after the propose', async () => {
  const inviter = await sc.partyFromSeeds(await seed('p4/inviter/msg'), await seed('p4/inviter/pair'), [MED], 'Anton', 'peer4')
  const responder = await sc.partyFromSeeds(await seed('p4/responder/msg'), await seed('p4/responder/pair'), [MED], 'Day', 'peer4')
  assert.ok(inviter.messaging.did.startsWith('did:peer:4z') && inviter.messaging.did.includes(':z'))
  const p = await sc.parsePeer(inviter.messaging.did)
  assert.deepEqual(p.relays, [MED]); assert.deepEqual(p.doc.assertionMethod, ['#key-1']); assert.deepEqual(p.doc.keyAgreement, ['#key-2'])
  const invId = await challenge('p4-inviter'), respId = await challenge('p4-responder'), exp = T0S + 600
  const link = await sc.sharedConnectLink({ from: inviter.messaging.did, id: invId, exp }, undefined, T0S)
  const read = await sc.readSharedConnectLink(link, T0S)
  assert.ok(read.ok); assert.equal(read.link.from.ref, sc.peer4Short(inviter.messaging.did))
  // a short form is no contact: a first-time reader cannot resolve it
  assert.equal((await sc.readSharedConnectLink(link.replace(inviter.messaging.did, sc.peer4Short(inviter.messaging.did)), T0S)).reason, 'unsupported-vid')
  await assert.rejects(async () => sc.sharedConnectLink({ from: sc.peer4Short(inviter.messaging.did), id: invId, exp }, undefined, T0S))
  const prop = await sc.propose(responder, inviter.messaging.did, invId, respId, T0 + 5_000)
  assert.equal(prop.proof.verificationMethod, sc.peer4Short(responder.messaging.did) + '#key-1')
  const me = { did: inviter.messaging.did, id: invId, exp }
  assert.equal(await sc.checkPropose(prop, me, T0 + 6_000), null)
  // a propose naming the inviter by its short form is the same recipient
  const propShortRecipient = await sc.propose(responder, sc.peer4Short(inviter.messaging.did), invId, respId, T0 + 5_000)
  assert.equal(await sc.checkPropose(propShortRecipient, me, T0 + 6_000), null)
  // a propose whose issuer is a short form: the inviter has never seen the long form
  const shortSender = { ...responder, messaging: { ...responder.messaging, did: sc.peer4Short(responder.messaging.did) } }
  await assert.rejects(async () => sc.propose(shortSender, inviter.messaging.did, invId, respId, T0 + 5_000))
  // later steps may use short forms on both sides; the checks resolve them against the forms already held
  const shortInviter = { ...inviter, messaging: { ...inviter.messaging, did: sc.peer4Short(inviter.messaging.did) } }
  await assert.rejects(async () => sc.accept(shortInviter, prop, T0 + 7_000, await fid('p4acc')), 'signing needs the long form to resolve its own keys')
  const acc = await sc.accept(inviter, { ...prop, issuer: sc.peer4Short(prop.issuer) }, T0 + 7_000, await fid('p4acc'))
  assert.equal(acc.recipient, sc.peer4Short(responder.messaging.did))
  assert.equal(await sc.checkAccept(acc, prop, inviter.messaging.did, T0 + 8_000), null)
  const b = await sc.binding(invId, respId)
  const vrc = await sc.credential(inviter, prop.payload.relationshipDid, respId, b, 'displayed', T0 + 7_000)
  const iss = await sc.issue(inviter, prop.issuer, respId, invId, 'issue-inviter', vrc, T0 + 7_000, await fid('p4ii'))
  const expInv = { issuerDid: inviter.messaging.did, myDid: sc.peer4Short(responder.messaging.did), threadId: respId, enactment: invId, step: 'issue-inviter', issuerPair: inviter.pair.anchor, myPair: responder.pair.anchor, myChallenge: respId, binding: b }
  assert.equal(await sc.checkIssue(iss, expInv, T0 + 8_000), null)
  // the back-code carries the long form, so the inviter can resolve it
  const code = await sc.backCodeOf(prop)
  assert.deepEqual(await sc.proposeFromBackCode(code, me), prop)
})

test('relationshipDid: did:peer:0 (Keyring) is the same Ed25519 key as did:key', async () => {
  const { inviter } = await parties()
  const key = inviter.pair.anchor
  const p0 = 'did:peer:0' + key.slice('did:key:'.length)
  assert.deepEqual(sc.pairKeyOf(p0), sc.pairKeyOf(key))
  assert.equal(sc.pairKeyOf('did:peer:0zQmX'), null); assert.equal(sc.pairKeyOf('did:web:x'), null)
  const { diSign } = await import('../dist/crypto.js')
  const body = { '@context': ['https://www.w3.org/ns/credentials/v2'], type: ['VerifiableCredential', 'RelationshipCredential'], issuer: p0, validFrom: '2026-11-07T10:00:00Z', credentialSubject: { id: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK' } }
  const signed = await diSign(inviter.pair, body, '2026-11-07T10:00:00Z')
  const vrc = { ...signed, proof: { ...signed.proof } }
  // re-sign under the did:peer:0 verification method
  const cfg = { ...vrc.proof, verificationMethod: p0 + '#' + p0.slice('did:peer:0'.length) }; delete cfg.proofValue
  const { jcs } = await import('../dist/core.js'); const { sha, cat, base58 } = await import('../dist/crypto.js')
  const te = new TextEncoder()
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, inviter.pair.ed.priv, cat(await sha(te.encode(jcs(cfg))), await sha(te.encode(jcs(body))))))
  const vrcP0 = { ...body, proof: { ...cfg, proofValue: 'z' + base58(sig) } }
  assert.ok(await sc.verifyPairCredential(vrcP0, p0))
  assert.equal(await sc.verifyPairCredential(vrcP0, key), false)
  assert.equal(await sc.verifyPairCredential({ ...vrcP0, issuer: key }, p0), false)
})

test('relays: a libp2p TSPTransport endpoint {peerId, multiaddrs} (Trust Stackers) is read as tsp-libp2p', async () => {
  const { inviter } = await parties()
  const base = inviter.messaging.did.split('.').slice(0, 4).join('.')
  const ep = { peerId: '12D3KooWJWEKvSFbben74C7H4YtKjhPMTDxd7gP6zxWSUEeF27st', multiaddrs: ['/ip4/203.0.113.7/tcp/4001/p2p/12D3KooWJWEKvSFbben74C7H4YtKjhPMTDxd7gP6zxWSUEeF27st', '/dns/relay.example/tcp/4001/p2p/12D3KooWRelay/p2p-circuit/p2p/12D3KooWJWEKvSFbben74C7H4YtKjhPMTDxd7gP6zxWSUEeF27st'] }
  const p = sc.parsePeer2(base + '.S' + b64({ t: 'TSPTransport', s: ep }) + '.S' + b64({ t: 'TSPTransport', s: 'did:webvh:x:mediator.example' }))
  assert.deepEqual(p.relays, [{ kind: 'tsp-libp2p', address: ep.peerId, multiaddrs: ep.multiaddrs }, { kind: 'tsp-mediator', address: 'did:webvh:x:mediator.example' }])
})

test('condensed peer DIDs without the assertionMethod segment: 50 characters shorter, a full enactment still passes', async () => {
  const inv = await sc.partyFromSeeds(await seed('c/inviter/msg'), await seed('c/inviter/pair'), [MED], 'Anton', 'peer2', { assertion: false })
  const res = await sc.partyFromSeeds(await seed('c/responder/msg'), await seed('c/responder/pair'), [MED], 'Day', 'peer2', { assertion: false })
  const full = await sc.partyFromSeeds(await seed('c/inviter/msg'), await seed('c/inviter/pair'), [MED], 'Anton')
  assert.equal(full.messaging.did.length - inv.messaging.did.length, 50)
  assert.deepEqual(inv.peer.doc.assertionMethod, []); assert.deepEqual(inv.peer.doc.authentication, ['#key-1']); assert.deepEqual(inv.peer.doc.keyAgreement, ['#key-2'])
  const invId = await challenge('c-inv'), respId = await challenge('c-res'), exp = T0S + 600
  const prop = await sc.propose(res, inv.messaging.did, invId, respId, T0 + 5_000)
  assert.equal(await sc.checkPropose(prop, { did: inv.messaging.did, id: invId, exp }, T0 + 6_000), null)
  const acc = await sc.accept(inv, prop, T0 + 7_000, await fid('c-acc'))
  assert.equal(await sc.checkAccept(acc, prop, inv.messaging.did, T0 + 8_000), null)
  // a proof under assertionMethod by a key listed only under authentication is refused (the first Keyring run)
  const asAssertion = { ...prop, proof: { ...prop.proof, proofPurpose: 'assertionMethod' } }
  assert.equal(await sc.verifyStep(asAssertion), false)
  const p4 = await sc.partyFromSeeds(await seed('c/p4/msg'), await seed('c/p4/pair'), [MED], 'x', 'peer4', { assertion: false })
  assert.deepEqual(p4.peer.doc.assertionMethod, [])
})

// a correctly hashed did:peer:4 whose document has the wrong shape (issue #170)
async function peer4Of (input) {
  const { sha, cat, base58 } = await import('../dist/crypto.js')
  const te = new TextEncoder()
  const enc = 'z' + base58(cat(Uint8Array.from([0x80, 0x04]), te.encode(JSON.stringify(input))))
  const hash = 'z' + base58(cat(Uint8Array.from([0x12, 0x20]), await sha(te.encode(enc))))
  return 'did:peer:4' + hash + ':' + enc
}
test('did:peer:4 with a malformed document is refused, never thrown (#170)', async () => {
  const { inviter } = await parties()
  const vm = inviter.peer.doc.verificationMethod
  const ok = { verificationMethod: [{ id: '#key-1', type: 'Multikey', publicKeyMultibase: vm[0].publicKeyMultibase }, { id: '#key-2', type: 'Multikey', publicKeyMultibase: vm[2].publicKeyMultibase }], authentication: ['#key-1'], keyAgreement: ['#key-2'], service: [] }
  assert.ok(await sc.parsePeer4(await peer4Of(ok)))
  const bad = [
    { ...ok, verificationMethod: {} }, { ...ok, authentication: {} }, { ...ok, service: {} },
    { ...ok, keyAgreement: 'x' }, { ...ok, verificationMethod: [null] }, { ...ok, service: [[]] },
    { ...ok, authentication: [{ id: '#k' }] }, [], 'string',
  ]
  for (const b of bad) {
    const did = await peer4Of(b)
    assert.equal(await sc.parsePeer4(did), null, 'case ' + bad.indexOf(b) + ': ' + JSON.stringify(b).slice(0, 80))
    const r = await sc.readSharedConnectLink('https://link.trustoverip.org/t#_from=' + did + '&_id=' + (await challenge('m')) + '&_exp=' + (T0S + 600) + '&_type=/vti/flow/shared-connect/0.1', T0S)
    assert.equal(r.ok, false); assert.equal(r.reason, 'unsupported-vid')
    assert.equal(await sc.proposeFromBackCode('https://link.trustoverip.org/t#_from=' + did + '&_id=' + (await challenge('m')) + '&_type=/vti/flow/shared-connect/0.1/back&rel=did:key:z6Mk&t=1&sig=z1', { did: inviter.messaging.did, id: await challenge('x') }), null)
  }
  // a propose whose issuer is such a DID is refused as issuer-not-peer2, not thrown
  const prop = await sc.propose(inviter, inviter.messaging.did, await challenge('a'), await challenge('b'), T0)
  assert.equal(await sc.checkPropose({ ...prop, issuer: await peer4Of(bad[0]) }, { did: inviter.messaging.did, id: await challenge('a'), exp: T0S + 600 }, T0 + 1000), 'issuer-not-peer')
})

test('did:peer:4 as the Trust Stackers write it: post-quantum keys beside the two we use, a libp2p service', async () => {
  const { inviter } = await parties()
  const vm = inviter.peer.doc.verificationMethod
  const ts = {
    '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/multikey/v1'],
    parameters: { updateKeys: ['z6MkupdateKey'], nextKeyHashes: ['QmNext'] },
    alsoKnownAs: ['did:scid:vh:1:QmScid'],
    verificationMethod: [
      { id: '#key-1', type: 'Multikey', publicKeyMultibase: vm[0].publicKeyMultibase },
      { id: '#key-2', type: 'Multikey', publicKeyMultibase: vm[2].publicKeyMultibase },
      { id: '#key-mldsa', type: 'Multikey', publicKeyMultibase: 'z' + '3'.repeat(40) },
      { id: '#key-kem', type: 'MLKEM768X25519PublicKey', publicKeyMultibase: 'u' + 'A'.repeat(60) },
    ],
    authentication: ['#key-1'], assertionMethod: ['#key-1', '#key-mldsa'], keyAgreement: ['#key-2', '#key-kem'],
    service: [{ id: '#tsp', type: 'TSPTransport', serviceEndpoint: { peerId: '12D3KooWJWEKvSFbben74C7H4YtKjhPMTDxd7gP6zxWSUEeF27st', multiaddrs: ['/dns/relay.example/tcp/4001/p2p/12D3KooWRelay/p2p-circuit/p2p/12D3KooWJWEKvSFbben74C7H4YtKjhPMTDxd7gP6zxWSUEeF27st'] } }],
  }
  const did = await peer4Of(ts)
  const p = await sc.parsePeer4(did)
  assert.ok(p, 'the Trust Stackers form resolves')
  assert.equal(p.relays[0].kind, 'tsp-libp2p'); assert.equal(p.relays[0].address, '12D3KooWJWEKvSFbben74C7H4YtKjhPMTDxd7gP6zxWSUEeF27st'); assert.equal(p.relays[0].multiaddrs.length, 1)
  assert.equal(sc.peer2MethodFor(p, 'assertionMethod').id, p.ref + '#key-1')
  // the Slot-A form: a second key under authentication
  const slotA = { ...ts, verificationMethod: [...ts.verificationMethod, { id: '#key-scid', type: 'Multikey', publicKeyMultibase: vm[0].publicKeyMultibase }], authentication: ['#key-1', '#key-scid'] }
  assert.ok(await sc.parsePeer4(await peer4Of(slotA)))
  // a JWK method beside ours is kept, not refused
  assert.ok(await sc.parsePeer4(await peer4Of({ ...ts, verificationMethod: [...ts.verificationMethod, { id: '#jwk', type: 'JsonWebKey2020', publicKeyJwk: { kty: 'OKP' } }] })))
  // as a trigger link the full form, post-quantum keys included, is over the reader limit of 1,536
  // code points (VTI-LNK-020 step 1): refused as too-long, a finding for the Trust Stackers, not a bug here
  const link = 'https://link.trustoverip.org/t#_from=' + did + '&_id=' + (await challenge('ts')) + '&_exp=' + (T0S + 600) + '&_type=/vti/flow/shared-connect/0.1'
  assert.ok(link.length > 1536)
  assert.equal((await sc.readSharedConnectLink(link, T0S)).reason, 'too-long')
  // without the post-quantum keys it reads, and shows the libp2p relay
  const lean = await peer4Of({ ...ts, verificationMethod: ts.verificationMethod.slice(0, 2), assertionMethod: ['#key-1'], keyAgreement: ['#key-2'] })
  const r = await sc.readSharedConnectLink('https://link.trustoverip.org/t#_from=' + lean + '&_id=' + (await challenge('ts')) + '&_exp=' + (T0S + 600) + '&_type=/vti/flow/shared-connect/0.1', T0S)
  assert.ok(r.ok); assert.equal(r.link.from.relays[0].kind, 'tsp-libp2p')
})

test('did:peer:4 method ids in long or short form both verify; did:peer:0 needs its one absolute id', async () => {
  const inv = await sc.partyFromSeeds(await seed('p4l/inviter/msg'), await seed('p4l/inviter/pair'), [MED], 'Anton', 'peer4')
  const res = await sc.partyFromSeeds(await seed('p4l/responder/msg'), await seed('p4l/responder/pair'), [MED], 'Day', 'peer4')
  const invId = await challenge('p4l-i'), respId = await challenge('p4l-r')
  const prop = await sc.propose(res, inv.messaging.did, invId, respId, T0)
  assert.ok(prop.proof.verificationMethod.startsWith(sc.peer4Short(res.messaging.did) + '#'))
  // the same signature with the long form in the method id (the DIF resolution, the Trust Stackers' form)
  const longVm = { ...prop, proof: { ...prop.proof, verificationMethod: res.messaging.did + '#key-1' } }
  // the signature covers the proof configuration, so re-sign with the long form
  const { jcs } = await import('../dist/core.js'); const { sha, cat, base58 } = await import('../dist/crypto.js')
  const te = new TextEncoder(); const { proof, ...body } = longVm; const { proofValue, ...cfg } = proof
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, res.messaging.ed.priv, cat(await sha(te.encode(jcs(cfg))), await sha(te.encode(jcs(body))))))
  const signedLong = { ...body, proof: { ...cfg, proofValue: 'z' + base58(sig) } }
  assert.ok(await sc.verifyStep(signedLong), 'long-form method id, long-form issuer')
  assert.ok(await sc.verifyStep({ ...signedLong, issuer: sc.peer4Short(res.messaging.did) }) === false, 'short issuer, nothing known: the long form in the method id is not enough to change the signed issuer')
  const shortIssuerSigned = await (async () => { const b = { ...body, issuer: sc.peer4Short(res.messaging.did) }; const s = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, res.messaging.ed.priv, cat(await sha(te.encode(jcs(cfg))), await sha(te.encode(jcs(b)))))); return { ...b, proof: { ...cfg, proofValue: 'z' + base58(s) } } })()
  assert.ok(await sc.verifyStep(shortIssuerSigned), 'short issuer, long-form method id: the method id resolves the issuer')
  // did:peer:0: only the one absolute id
  const key = inv.pair.anchor; const p0 = 'did:peer:0' + key.slice('did:key:'.length)
  const cred = { '@context': ['https://www.w3.org/ns/credentials/v2'], type: ['VerifiableCredential'], issuer: p0, validFrom: '2026-11-07T10:00:00Z', credentialSubject: { id: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK' } }
  const mk = async (vmId) => { const c = { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', created: '2026-11-07T10:00:00Z', verificationMethod: vmId, proofPurpose: 'assertionMethod', '@context': cred['@context'] }; const s = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, inv.pair.ed.priv, cat(await sha(te.encode(jcs(c))), await sha(te.encode(jcs(cred)))))); return { ...cred, proof: { ...c, proofValue: 'z' + base58(s) } } }
  assert.ok(await sc.verifyPairCredential(await mk(p0 + '#' + p0.slice('did:peer:0'.length)), p0))
  assert.equal(await sc.verifyPairCredential(await mk(p0 + '#key-1'), p0), false)
  assert.equal(await sc.verifyPairCredential(await mk(p0 + '#whatever'), p0), false)
})

test('a libp2p relay round-trips through peer2Of and peer4Of; an acceptance under the old step name is refused', async () => {
  const { inviter, responder } = await parties()
  const relay = { kind: 'tsp-libp2p', address: '12D3KooWJWEKvSFbben74C7H4YtKjhPMTDxd7gP6zxWSUEeF27st', multiaddrs: ['/ip4/203.0.113.7/tcp/4001/p2p/12D3KooWJWEKvSFbben74C7H4YtKjhPMTDxd7gP6zxWSUEeF27st'] }
  const d2 = sc.peer2Of(inviter.peer.ed, inviter.peer.x, [relay]); assert.deepEqual(sc.parsePeer2(d2).relays, [relay])
  const d4 = await sc.peer4Of(inviter.peer.ed, inviter.peer.x, [relay]); assert.deepEqual((await sc.parsePeer4(d4)).relays, [relay])
  const invId = await challenge('old-i'), respId = await challenge('old-r')
  const prop = await sc.propose(responder, inviter.messaging.did, invId, respId, T0)
  const acc = await sc.accept(inviter, prop, T0 + 1000, await fid('old'))
  const oldStep = await sc.signStep(inviter.messaging, { ...(({ proof, ...r }) => r)(acc), ceremony: { ...acc.ceremony, step: 'accept' } }, acc.issuedAt)
  assert.equal(await sc.checkAccept(oldStep, prop, inviter.messaging.did, T0 + 2000), 'enactment')
})

test('digests: a counterpart that encodes vrcDigestMultibase or the binding in base58btc (Keyring) passes; a non-canonical or undecodable digest is refused, never thrown', async () => {
  const { inviter, responder, issInv, issResp, expInv, expResp, b } = await enactment()
  const toZ = (u) => 'z' + base58(fromB64u(u.slice(1)))
  const resign = async (party, doc, payload) => { const { proof, ...rest } = doc; return sc.signStep(party.messaging, { ...rest, payload }, doc.issuedAt) }
  // issue with a z digest over the same credential: the digest check passes on bytes
  const zIss = await resign(inviter, issInv, { ...issInv.payload, vrcDigestMultibase: toZ(issInv.payload.vrcDigestMultibase) })
  assert.ok(zIss.payload.vrcDigestMultibase.startsWith('z'))
  assert.equal(await sc.checkIssue(zIss, expInv, T0 + 8_000), null)
  // the receipt for our issue, digest in z
  const rcp = await sc.receipt(responder, issInv, T0 + 8_000, await fid('rz'))
  const zRcp = await resign(responder, rcp, { vrcDigestMultibase: toZ(rcp.payload.vrcDigestMultibase) })
  assert.equal(await sc.checkReceipt(zRcp, issInv, { issuerDid: responder.messaging.did, myDid: inviter.messaging.did }, T0 + 9_000), null)
  // the binding compared in z form too
  assert.equal(await sc.checkIssue(issResp, { ...expResp, binding: toZ(b) }, T0 + 10_000), null)
  // non-canonical base64url (padding), a different digest, and garbage: refused as vrc-digest, no exception
  for (const bad of [issInv.payload.vrcDigestMultibase + '==', 'u' + issInv.payload.vrcDigestMultibase.slice(1, -2) + 'AA', 'u!!!', 'fabc', 'z' + base58(new Uint8Array(34).fill(1))]) {
    const d = await resign(inviter, issInv, { ...issInv.payload, vrcDigestMultibase: bad })
    assert.equal(await sc.checkIssue(d, expInv, T0 + 8_000), 'vrc-digest', bad)
    const r = await resign(responder, rcp, { vrcDigestMultibase: bad })
    assert.equal(await sc.checkReceipt(r, issInv, { issuerDid: responder.messaging.did, myDid: inviter.messaging.did }, T0 + 9_000), 'vrc-digest', bad)
  }
  assert.ok(sc.sameDigest(toZ(b), b)); assert.ok(!sc.sameDigest(b + '=', b))
})

test('digests: an impossible encoded length is refused before decoding (#177)', async () => {
  const { inviter, responder, issInv } = await enactment()
  const resign = async (party, doc, payload) => { const { proof, ...rest } = doc; return sc.signStep(party.messaging, { ...rest, payload }, doc.issuedAt) }
  const rcp = await sc.receipt(responder, issInv, T0 + 8_000, await fid('rl'))
  // an unsigned, oversized receipt: refused as vrc-digest without decoding 20,001 characters
  const { proof, ...unsigned } = rcp
  const big = { ...unsigned, payload: { vrcDigestMultibase: 'z' + '2'.repeat(20_000) } }
  const t0 = performance.now()
  assert.equal(await sc.checkReceipt(big, issInv, { issuerDid: responder.messaging.did, myDid: inviter.messaging.did }, T0 + 9_000), 'vrc-digest')
  assert.ok(performance.now() - t0 < 50, 'refused in under 50 ms')
  // the boundary: 47 (u) and 47 or 48 (z) characters pass the length gate, one more or less does not
  const u = rcp.payload.vrcDigestMultibase; assert.equal(u.length, 47)
  assert.ok(sc.sameDigest(u, u)); assert.ok(!sc.sameDigest(u + 'A', u)); assert.ok(!sc.sameDigest(u.slice(0, -1), u))
  assert.ok(!sc.sameDigest('z' + '2'.repeat(48), u)); assert.ok(!sc.sameDigest('z' + '2'.repeat(45), u))
  const signedBig = await resign(responder, rcp, { vrcDigestMultibase: 'z' + '2'.repeat(20_000) })
  assert.equal(await sc.checkReceipt(signedBig, issInv, { issuerDid: responder.messaging.did, myDid: inviter.messaging.did }, T0 + 9_000), 'vrc-digest')
})
