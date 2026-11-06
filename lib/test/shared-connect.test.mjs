// shared-connect 0.1: one full enactment on registry tasks, the link,
// the back-code, and the refusals the receiving sides must produce.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sharedConnect as sc } from '../dist/index.js'
import { hkdf, diVerify } from '../dist/crypto.js'

const te = new TextEncoder()
const seed = (label) => hkdf(te.encode('shared-connect test seed'), label)
const T0 = Date.parse('2026-11-07T10:00:00Z')
const MED = { kind: 'tsp-mediator', address: 'wss://mediator.web-of-trust.de' }
const NOSTR = { kind: 'nostr-relay', address: 'wss://nostr.myceli.al' }

async function parties () {
  const inviter = await sc.partyFromSeeds(await seed('inviter/msg'), await seed('inviter/pair'), [MED, NOSTR], 'Anton')
  const responder = await sc.partyFromSeeds(await seed('responder/msg'), await seed('responder/pair'), [MED], 'Day')
  return { inviter, responder }
}
const challenge = async (label) => sc.challengeOf16((await hkdf(te.encode('challenge'), label, 16)))
const fid = (label) => challenge('id/' + label)

test('did:peer:2 round trip: keys, relays, both service spellings', async () => {
  const { inviter } = await parties()
  const p = sc.parsePeer2(inviter.messaging.did)
  assert.ok(p)
  assert.equal(p.doc.verificationMethod.length, 2)
  assert.deepEqual(p.doc.assertionMethod, ['#key-1'])
  assert.deepEqual(p.doc.keyAgreement, ['#key-2'])
  assert.deepEqual(p.relays, [MED, NOSTR])
  // the TSP reference spelling: type 'tsp', endpoint {uri}
  const alt = inviter.messaging.did.split('.').slice(0, 3).join('.') + '.S' + Buffer.from(JSON.stringify({ t: 'tsp', s: { uri: 'wss://x.example' } })).toString('base64url')
  assert.deepEqual(sc.parsePeer2(alt).relays, [{ kind: 'tsp-mediator', address: 'wss://x.example' }])
  // not ours: a did:peer:2 without an X25519 key, or with two Ed25519 keys
  assert.equal(sc.parsePeer2(inviter.messaging.did.split('.').slice(0, 2).join('.')), null)
  assert.equal(sc.parsePeer2('did:key:z6Mk'), null)
})

test('link: render, read, refusals', async () => {
  const { inviter } = await parties()
  const id = await challenge('inviter')
  const exp = Math.floor(T0 / 1000) + 600
  const link = sc.sharedConnectLink({ from: inviter.messaging.did, id, exp, label: 'Anton' })
  assert.ok(link.length < 450, 'a code shown in person stays under about 450 characters: ' + link.length)
  const r = sc.readSharedConnectLink(link, Math.floor(T0 / 1000))
  assert.ok(r.ok)
  assert.equal(r.link.id, id)
  assert.equal(r.link.from.did, inviter.messaging.did)
  assert.equal(r.link.label, 'Anton')
  assert.equal(r.link.type, sc.FLOW_URI)
  assert.equal(sc.readSharedConnectLink(link, exp).reason, 'expired')
  assert.equal(sc.readSharedConnectLink(link.replace('_id=', '_id=' + 'A'), Math.floor(T0 / 1000)).reason, 'bad-id')
  assert.equal(sc.readSharedConnectLink(link + '&_id=' + id, Math.floor(T0 / 1000)).reason, 'repeated-param')
  assert.equal(sc.readSharedConnectLink(link.replace('/vti/flow/shared-connect/0.1', '/vti/flow/sign-in/0.1'), Math.floor(T0 / 1000)).reason, 'unknown-flow')
  assert.equal(sc.readSharedConnectLink(link.replace(/_from=did:peer:2[^&]*/, '_from=did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'), Math.floor(T0 / 1000)).reason, 'unsupported-vid')
  // a label with a bidi control is dropped, the link still reads
  const r2 = sc.readSharedConnectLink(link.replace('_label=Anton', '_label=' + encodeURIComponent('An‮ton')), Math.floor(T0 / 1000))
  assert.ok(r2.ok); assert.equal(r2.link.label, undefined)
  // unknown names are ignored
  assert.ok(sc.readSharedConnectLink(link + '&utm_source=mail', Math.floor(T0 / 1000)).ok)
})

test('one enactment: propose, accept, two issues, two receipts; every check passes', async () => {
  const { inviter, responder } = await parties()
  const invId = await challenge('inviter'), respId = await challenge('responder')
  const link = sc.sharedConnectLink({ from: inviter.messaging.did, id: invId, exp: Math.floor(T0 / 1000) + 600 })
  const read = sc.readSharedConnectLink(link, Math.floor(T0 / 1000)); assert.ok(read.ok)

  const prop = await sc.propose(responder, read.link.from.did, read.link.id, respId, T0 + 5_000)
  assert.equal(prop.id, respId); assert.equal(prop.ceremony.enactment, invId); assert.equal(prop.threadId, undefined)
  assert.equal(await sc.checkPropose(prop, { did: inviter.messaging.did, id: invId }, T0 + 6_000), null)

  const acc = await sc.accept(inviter, prop, T0 + 7_000, await fid('acc'))
  assert.equal(acc.threadId, respId)
  assert.equal(await sc.checkAccept(acc, prop, inviter.messaging.did), null)

  const b = await sc.binding(invId, respId)
  const vrcInv = await sc.credential(inviter, prop.payload.relationshipDid, respId, b, 'displayed', T0 + 7_000)
  const issInv = await sc.issue(inviter, prop.issuer, respId, invId, 'issue-inviter', vrcInv, T0 + 7_000, await fid('ii'))
  assert.equal(await sc.checkIssue(issInv, { issuerDid: inviter.messaging.did, myDid: responder.messaging.did, threadId: respId, enactment: invId, step: 'issue-inviter', issuerPair: inviter.pair.anchor, myPair: responder.pair.anchor, myChallenge: respId, binding: b }), null)
  const rcpInv = await sc.receipt(responder, issInv, T0 + 8_000, await fid('ri'))
  assert.equal(rcpInv.payload.vrcDigestMultibase, issInv.payload.vrcDigestMultibase)
  assert.ok(await sc.verifyStep(rcpInv))

  const vrcResp = await sc.credential(responder, acc.payload.relationshipDid, invId, b, 'scan', T0 + 9_000)
  const issResp = await sc.issue(responder, inviter.messaging.did, respId, invId, 'issue-responder', vrcResp, T0 + 9_000, await fid('ir'))
  assert.equal(issResp.ceremony.terminal, true)
  assert.equal(await sc.checkIssue(issResp, { issuerDid: responder.messaging.did, myDid: inviter.messaging.did, threadId: respId, enactment: invId, step: 'issue-responder', issuerPair: responder.pair.anchor, myPair: inviter.pair.anchor, myChallenge: invId, binding: b }), null)

  // the credentials verify on their own proofs, pairwise issuers, @context in the proof
  assert.ok(await diVerify(vrcInv, inviter.pair.anchor)); assert.ok(await diVerify(vrcResp, responder.pair.anchor))
  assert.deepEqual(vrcInv.proof['@context'], vrcInv['@context'])
  // every step: issuer = proof signer, authentication purpose
  for (const d of [prop, acc, issInv, issResp, rcpInv]) {
    assert.equal(d.proof.verificationMethod, d.issuer + '#key-1'); assert.equal(d.proof.proofPurpose, 'authentication')
  }
})

test('refusals: foreign recipient, wrong enactment, stale, tampered', async () => {
  const { inviter, responder } = await parties()
  const invId = await challenge('inviter'), respId = await challenge('responder')
  const prop = await sc.propose(responder, inviter.messaging.did, invId, respId, T0)
  const me = { did: inviter.messaging.did, id: invId }
  assert.equal(await sc.checkPropose({ ...prop, recipient: responder.messaging.did }, me, T0), 'proof') // changed under the signature
  assert.equal(await sc.checkPropose(prop, { did: responder.messaging.did, id: invId }, T0), 'recipient')
  assert.equal(await sc.checkPropose(prop, { did: inviter.messaging.did, id: respId }, T0), 'enactment')
  assert.equal(await sc.checkPropose(prop, me, T0 + 16 * 60_000), 'not-fresh')
  const other = await sc.partyFromSeeds(await seed('x/msg'), await seed('x/pair'), [])
  const acc = await sc.accept(other, prop, T0, await fid('x'))
  assert.equal(await sc.checkAccept(acc, prop, inviter.messaging.did), 'issuer-not-peer2')
})

test('offline: the back-code rebuilds the propose and verifies', async () => {
  const { inviter, responder } = await parties()
  const invId = await challenge('inviter'), respId = await challenge('responder')
  const prop = await sc.propose(responder, inviter.messaging.did, invId, respId, T0)
  const code = sc.backCodeOf(prop)
  assert.ok(code.length < 560, 'back-code size ' + code.length)
  const rebuilt = sc.proposeFromBackCode(code, { did: inviter.messaging.did, id: invId })
  assert.deepEqual(rebuilt, prop)
  assert.equal(await sc.checkPropose(rebuilt, { did: inviter.messaging.did, id: invId }, T0 + 1000), null)
  // scanned by the wrong inviter: the rebuilt recipient differs, the proof fails
  const wrong = sc.proposeFromBackCode(code, { did: responder.messaging.did, id: invId })
  assert.equal(await sc.checkPropose(wrong, { did: responder.messaging.did, id: invId }, T0), 'proof')
  // a propose with expiresAt is not a back-code candidate
  const withExp = await sc.propose(responder, inviter.messaging.did, invId, respId, T0, T0 + 60_000)
  assert.throws(() => sc.backCodeOf(withExp))
})
