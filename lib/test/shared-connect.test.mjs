// shared-connect 0.1: one full enactment on registry tasks, the link, the
// back-code, and the refusals the receiving sides must produce.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sharedConnect as sc } from '../dist/index.js'
import { hkdf, diVerify, anchorOfEd, mkOfX, b64uOf } from '../dist/crypto.js'

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
  const link = sc.sharedConnectLink({ from: inviter.messaging.did, id: invId, exp, label: 'Anton' }, undefined, T0S)
  const read = sc.readSharedConnectLink(link, T0S); assert.ok(read.ok)
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
  const r = (l, now = T0S) => sc.readSharedConnectLink(l, now)
  assert.equal(r(link, exp).reason, 'expired')
  assert.equal(r(link, exp - 1).ok, true)
  assert.equal(r('A'.repeat(1537)).reason, 'too-long')
  assert.equal(r(link.replace('https://', 'http://')).reason, 'not-https')
  assert.equal(r(link.replace('link.trustoverip.org', 'user@link.trustoverip.org')).reason, 'bad-host')
  assert.equal(r(link.replace('#', '?')).reason, 'no-fragment')
  assert.equal(r(link + '&_id=' + invId).reason, 'repeated-param')
  assert.equal(r(link.replace('_from=', 'x_from=')).reason, 'missing-from')
  assert.equal(r(link.replace('_from=did:peer:2', '_from=nota:did')).reason, 'bad-from')
  assert.equal(r(link.replace('_id=', 'x_id=')).reason, 'missing-id')
  assert.equal(r(link.replace('_id=' + invId, '_id=' + invId.slice(1))).reason, 'bad-id')
  assert.equal(r(link.replace('_type=', 'x_type=')).reason, 'missing-type')
  assert.equal(r(link.replace('/vti/flow/shared-connect/0.1', '/vti/flow/sign-in/0.1')).reason, 'unknown-flow')
  // VTI-LNK-043: the same path on another host is another flow; the absolute registered URI on another host is ours
  assert.equal(r(link.replace('https://link.trustoverip.org/t', 'https://evil.example/t')).reason, 'unknown-flow')
  assert.ok(r(link.replace('https://link.trustoverip.org/t', 'https://other.example/t').replace('_type=/vti', '_type=https://link.trustoverip.org/vti')).ok)
  assert.equal(r(link.replace(/_from=did:peer:2[^&]*/, '_from=did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK')).reason, 'unsupported-vid')
  assert.equal(r(link.replace('_exp=', 'x_exp=')).reason, 'missing-exp')
  assert.equal(r(link.replace('_exp=' + exp, '_exp=0' + exp)).reason, 'bad-exp')
  assert.equal(r(link.replace('_exp=' + exp, '_exp=' + (T0S + sc.MAX_EXP_LINK_S + 3600))).reason, 'bad-exp')
  assert.ok(r(link.replace('_exp=' + exp, '_exp=' + (T0S + sc.MAX_EXP_LINK_S))).ok)
  // the label: a bidi control drops it, a line separator drops it, too long drops it; the link still reads
  for (const bad of ['An‮ton', 'An ton', 'x'.repeat(65)]) {
    const r2 = r(link.replace('_label=Anton', '_label=' + encodeURIComponent(bad)))
    assert.ok(r2.ok); assert.equal(r2.link.label, undefined)
  }
  assert.equal(r(link.replace('_label=Anton', '_label=' + encodeURIComponent('é'.normalize('NFD').repeat(64)))).link.label, 'é'.repeat(64))
  // unknown names and their repeats are ignored; a prototype name is not a repeat
  assert.ok(r(link + '&utm_source=mail&utm_source=again&__proto__=1').ok)
  // writer: the same label rule, the expiry caps per kind
  assert.throws(() => sc.sharedConnectLink({ from: inviter.messaging.did, id: invId, exp, label: 'x'.repeat(65) }, undefined, T0S))
  assert.throws(() => sc.sharedConnectLink({ from: inviter.messaging.did, id: invId, exp: T0S + 601 }, undefined, T0S))
  assert.ok(sc.sharedConnectLink({ from: inviter.messaging.did, id: invId, exp: T0S + 3600, kind: 'link' }, undefined, T0S))
  assert.throws(() => sc.sharedConnectLink({ from: inviter.messaging.did, id: invId, exp: T0S + sc.MAX_EXP_LINK_S + 1, kind: 'link' }, undefined, T0S))
  // on another origin the writer renders the absolute flow URI (VTI-LNK-042), and the reader takes it
  const foreign = sc.sharedConnectLink({ from: inviter.messaging.did, id: invId, exp }, 'https://wot.example', T0S)
  assert.ok(foreign.includes('_type=https://link.trustoverip.org/vti/flow/shared-connect/0.1')); assert.ok(r(foreign).ok)
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
  assert.equal(await c({ ...E.prop, issuer: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK' }), 'issuer-not-peer2')
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
  assert.equal(await ca({ ...E.acc, ceremony: { ...E.acc.ceremony, step: 'propose' } }), 'enactment')
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
  const rebuilt = sc.proposeFromBackCode(code, E.me)
  assert.deepEqual(rebuilt, E.prop)
  assert.equal(await sc.checkPropose(rebuilt, E.me, T0 + 6_000), null)
  // scanned by the wrong inviter, or under another _id: the rebuilt document differs, the proof fails
  assert.equal(await sc.checkPropose(sc.proposeFromBackCode(code, { ...E.me, did: E.responder.messaging.did }), { ...E.me, did: E.responder.messaging.did }, T0 + 6_000), 'proof')
  assert.equal(await sc.checkPropose(sc.proposeFromBackCode(code, { ...E.me, id: E.respId }), { ...E.me, id: E.respId }, T0 + 6_000), 'proof')
  // tampered name, time, relationshipDid
  for (const [a, b] of [['n=Day', 'n=Dan'], ['&t=' + Math.floor((T0 + 5000) / 1000), '&t=' + Math.floor((T0 + 6000) / 1000)], [E.prop.payload.relationshipDid, E.inviter.pair.anchor]]) {
    assert.equal(await sc.checkPropose(sc.proposeFromBackCode(code.replace(a, b), E.me), E.me, T0 + 6_000), 'proof', a)
  }
  // grammar: a repeated name, another host with the path form, http, a non-peer _from
  assert.equal(sc.proposeFromBackCode(code + '&rel=did:key:zX', E.me), null)
  assert.equal(sc.proposeFromBackCode(code.replace('https://link.trustoverip.org/t', 'https://evil.example/t'), E.me), null)
  assert.ok(sc.proposeFromBackCode(code.replace('https://link.trustoverip.org/t', 'https://other.example/t').replace('_type=/vti', '_type=https://link.trustoverip.org/vti'), E.me))
  assert.equal(sc.proposeFromBackCode(code.replace('https://', 'http://'), E.me), null)
  assert.equal(sc.proposeFromBackCode(code.replace(/_from=did:peer:2[^&]*/, '_from=did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'), E.me), null)
  // the link's _exp bounds the code
  assert.equal(await sc.checkPropose(rebuilt, E.me, (E.exp + 61) * 1000), 'expired-link')
  const lateProp = await sc.propose(E.responder, E.inviter.messaging.did, E.invId, E.respId, (E.exp + 100) * 1000)
  assert.equal(await sc.checkPropose(sc.proposeFromBackCode(sc.backCodeOf(lateProp), E.me), E.me, (E.exp + 101) * 1000), 'expired-link')
  // a propose with expiresAt is not a back-code candidate
  const withExp = await sc.propose(E.responder, E.inviter.messaging.did, E.invId, E.respId, T0, T0 + 60_000)
  assert.throws(() => sc.backCodeOf(withExp))
})
