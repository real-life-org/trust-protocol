#!/usr/bin/env node
// Generates vectors/shared-connect.json: one complete enactment of the
// shared connection ceremony on registry Trust Tasks (shared-connect 0.1,
// trustoverip/dtgwg-trust-tasks-tf#1034 as revised on 5 November 2026;
// the link per trustoverip/dtgwg-vti-spec#86): the inviter's did:peer:2 and
// link, the responder's did:peer:2, the propose, the acceptance, both
// credentials with their issue documents and receipts, the enactment
// citation of the propose, and the offline back-code of the propose. Everything is derived
// from two fixed seeds and fixed timestamps, so a second implementation
// reproduces every byte except where it uses its own keys.
//
//   usage: node scripts/gen-shared-connect-vector.mjs [--check]
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sharedConnect as sc } from '../lib/dist/index.js'
import { hkdf } from '../lib/dist/crypto.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')
const FILE = join(ROOT, 'vectors/shared-connect.json')
const te = new TextEncoder()

const SEED = te.encode('rltp shared-connect vector seed 2026-11')
const seed = (label) => hkdf(SEED, label)
const fixedId = async (label) => sc.challengeOf16(await hkdf(SEED, 'id/' + label, 16))
const T = (s) => Date.parse('2026-11-07T10:00:' + s + 'Z')

const MED = { kind: 'tsp-mediator', address: 'wss://mediator.web-of-trust.de' }
const NOSTR = { kind: 'nostr-relay', address: 'wss://nostr.myceli.al' }

const inviter = await sc.partyFromSeeds(await seed('inviter/messaging'), await seed('inviter/pair'), [MED, NOSTR], 'Anton')
const responder = await sc.partyFromSeeds(await seed('responder/messaging'), await seed('responder/pair'), [MED], 'Day')

const inviterChallenge = sc.challengeOf16(Array.from({ length: 16 }, (_, i) => i))
const responderChallenge = sc.challengeOf16(Array.from({ length: 16 }, (_, i) => 0xf0 + i))
const exp = Math.floor(T('00') / 1000) + 600

const nowS = Math.floor(T('00') / 1000)
const link = (await sc.sharedConnectLink({ from: inviter.messaging.did, id: inviterChallenge, exp, label: 'Anton' }, undefined, nowS))
const read = (await sc.readSharedConnectLink(link, nowS))
if (!read.ok) throw new Error('link does not read: ' + read.reason)

const propose = await sc.propose(responder, read.link.from.did, read.link.id, responderChallenge, T('05'))
const accept = await sc.accept(inviter, propose, T('07'), await fixedId('accept'))
const taskDigest = await sc.taskDigest(propose)
const vrcInviter = await sc.credential(inviter, propose.payload.relationshipDid, propose, 'displayed', T('07'))
const issueInviter = await sc.issue(inviter, propose.issuer, propose.id, inviterChallenge, 'issue-inviter', vrcInviter, T('07'), await fixedId('issue-inviter'))
const receiptInviter = await sc.receipt(responder, issueInviter, T('08'), await fixedId('receipt-inviter'))
const vrcResponder = await sc.credential(responder, accept.payload.relationshipDid, propose, 'scan', T('09'))
const issueResponder = await sc.issue(responder, inviter.messaging.did, propose.id, inviterChallenge, 'issue-responder', vrcResponder, T('09'), await fixedId('issue-responder'))
const receiptResponder = await sc.receipt(inviter, issueResponder, T('10'), await fixedId('receipt-responder'))
const backCode = sc.backCodeOf(propose)

// every check the receiving sides run must pass on the vector itself
const fail = (what) => { throw new Error('vector does not pass its own checks: ' + what) }
const me = { did: inviter.messaging.did, id: inviterChallenge, exp }
if (await sc.checkPropose(propose, me, T('06')) !== null) fail('propose')
if (await sc.checkAccept(accept, propose, inviter.messaging.did, T('08')) !== null) fail('accept')
if (await sc.checkIssue(issueInviter, { issuerDid: inviter.messaging.did, myDid: responder.messaging.did, threadId: propose.id, enactment: inviterChallenge, step: 'issue-inviter', issuerPair: inviter.pair.anchor, myPair: responder.pair.anchor, propose }, T('08')) !== null) fail('issue-inviter')
if (await sc.checkIssue(issueResponder, { issuerDid: responder.messaging.did, myDid: inviter.messaging.did, threadId: propose.id, enactment: inviterChallenge, step: 'issue-responder', issuerPair: responder.pair.anchor, myPair: inviter.pair.anchor, propose }, T('10')) !== null) fail('issue-responder')
if (await sc.checkReceipt(receiptInviter, issueInviter, { issuerDid: responder.messaging.did, myDid: inviter.messaging.did }, T('09')) !== null) fail('receipt-inviter')
if (await sc.checkReceipt(receiptResponder, issueResponder, { issuerDid: inviter.messaging.did, myDid: responder.messaging.did }, T('11')) !== null) fail('receipt-responder')
const rebuilt = (await sc.proposeFromBackCode(backCode, { did: inviter.messaging.did, id: inviterChallenge }))
if (JSON.stringify(rebuilt) !== JSON.stringify(propose)) fail('back-code')

// must-fail: what a reader or a receiving side refuses, with the expected reason
const otherDidKey = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
const linkCases = [
  { name: 'repeated reserved name', link: link + '&_id=' + inviterChallenge, reason: 'repeated-param' },
  { name: 'the flow path on another host (VTI-LNK-043)', link: link.replace('https://link.trustoverip.org/t', 'https://example.org/t'), reason: 'unknown-flow' },
  { name: 'another flow', link: link.replace('/vti/flow/shared-connect/0.1', '/vti/flow/sign-in/0.1'), reason: 'unknown-flow' },
  { name: 'a did:key contact', link: link.replace(/_from=did:peer:2[^&]*/, '_from=' + otherDidKey), reason: 'unsupported-vid' },
  { name: '_id of 21 characters', link: link.replace('_id=' + inviterChallenge, '_id=' + inviterChallenge.slice(1)), reason: 'bad-id' },
  { name: '_exp beyond seven days', link: link.replace('_exp=' + exp, '_exp=' + (nowS + 8 * 86400)), reason: 'bad-exp' },
  { name: 'expired (read at _exp)', link, at: exp, reason: 'expired' },
  { name: 'http', link: link.replace('https://', 'http://'), reason: 'not-https' },
]
for (const c of linkCases) { const r = (await sc.readSharedConnectLink(c.link, c.at ?? nowS)); if (r.ok || r.reason !== c.reason) fail('link case ' + c.name + ': ' + (r.ok ? 'ok' : r.reason)) }
const lateProposeAt = (exp + 120) * 1000
const latePropose = await sc.propose(responder, inviter.messaging.did, inviterChallenge, responderChallenge, lateProposeAt)
const proposeCases = [
  { name: 'propose for another inviter (recipient)', doc: propose, me: { ...me, did: responder.messaging.did }, at: T('06'), reason: 'recipient' },
  { name: 'propose under another _id (enactment)', doc: propose, me: { ...me, id: responderChallenge }, at: T('06'), reason: 'enactment' },
  { name: 'propose after the link expired, itself fresh', doc: latePropose, me, at: lateProposeAt + 1000, reason: 'expired-link' },
  { name: 'propose older than the age gate', doc: propose, me, at: T('05') + 16 * 60_000, reason: 'not-fresh' },
  { name: 'propose with a changed name (proof)', doc: { ...propose, payload: { ...propose.payload, reason: 'Dan' } }, me, at: T('06'), reason: 'proof' },
  { name: 'propose with an unknown payload member', doc: { ...propose, payload: { ...propose.payload, extra: true } }, me, at: T('06'), reason: 'payload' },
]
for (const c of proposeCases) { const r = await sc.checkPropose(c.doc, c.me, c.at); if (r !== c.reason) fail('propose case ' + c.name + ': ' + r) }
const acceptWithReason = { ...accept, payload: { ...accept.payload, reason: 'Anton' } }
if (await sc.checkAccept(acceptWithReason, propose, inviter.messaging.did, T('08')) !== 'payload') fail('accept with reason')
const backCases = [
  { name: 'back-code with a repeated name', code: backCode + '&rel=' + otherDidKey },
  { name: 'back-code on another host with the path form', code: backCode.replace('https://link.trustoverip.org/t', 'https://example.org/t') },
]
for (const c of backCases) if ((await sc.proposeFromBackCode(c.code, me)) !== null) fail(c.name)
const backTampered = backCode.replace('n=Day', 'n=Dan')
if (await sc.checkPropose((await sc.proposeFromBackCode(backTampered, me)), me, T('06')) !== 'proof') fail('back-code tampered')

// the same enactment with did:peer:4 messaging identities (long form in the link and on the propose)
const inviter4 = await sc.partyFromSeeds(await seed('inviter/messaging'), await seed('inviter/pair'), [MED, NOSTR], 'Anton', 'peer4')
const responder4 = await sc.partyFromSeeds(await seed('responder/messaging'), await seed('responder/pair'), [MED], 'Day', 'peer4')
const link4 = (await sc.sharedConnectLink({ from: inviter4.messaging.did, id: inviterChallenge, exp, kind: 'link' }, undefined, nowS))
const propose4 = await sc.propose(responder4, inviter4.messaging.did, inviterChallenge, responderChallenge, T('05'))
const accept4 = await sc.accept(inviter4, propose4, T('07'), await fixedId('accept'))
const vrcInviter4 = await sc.credential(inviter4, propose4.payload.relationshipDid, propose4, 'displayed', T('07'))
const issueInviter4 = await sc.issue(inviter4, propose4.issuer, propose4.id, inviterChallenge, 'issue-inviter', vrcInviter4, T('07'), await fixedId('issue-inviter'))
const me4 = { did: inviter4.messaging.did, id: inviterChallenge, exp }
if (await sc.checkPropose(propose4, me4, T('06')) !== null) fail('propose (peer4)')
if (await sc.checkAccept(accept4, propose4, inviter4.messaging.did, T('08')) !== null) fail('accept (peer4)')
if (await sc.checkIssue(issueInviter4, { issuerDid: inviter4.messaging.did, myDid: responder4.messaging.did, threadId: propose4.id, enactment: inviterChallenge, step: 'issue-inviter', issuerPair: inviter4.pair.anchor, myPair: responder4.pair.anchor, propose: propose4 }, T('08')) !== null) fail('issue-inviter (peer4)')

const out = {
  description: 'One enactment of the shared connection ceremony (shared-connect 0.1) on the registry tasks vrc/relationships/propose 0.1 and vrc/relationships/issue 0.1, started by a VTI trigger link whose _from is the inviter\'s per-encounter did:peer:2 carrying its relays as services. The responder proposes (its challenge is the propose id and the threadId of every later document); ceremony.enactment is the link\'s _id (the inviter\'s challenge) on every step. Step documents are signed under authentication by #key-1 of the issuer\'s did:peer:2 (eddsa-jcs-2022); credentials are signed by the pairwise did:key (relationshipDid) under assertionMethod, with the document @context repeated in the proof; they carry the two registry contexts only and cite the propose with the DTG members taskContext (its id) and taskDigestMultibase (its task digest, base58btc), plus the issuer\'s channel as the IRI https://real-life.org/rltp/v1#channel. The back-code is the responder\'s propose in reconstruction form for the offline path: recipient, type, step, enactment and the proof configuration are rebuilt from the inviter\'s own state. Keys derive from fixed seeds and the challenges are fixed bytes; Ed25519 is deterministic, so a second implementation with the same seeds reproduces every byte, link, back-code and proofValues included, and one with its own keys verifies the proofs instead. `mustFail` lists what a reader or a receiving side refuses, with the expected reason. Generated by scripts/gen-shared-connect-vector.mjs; lib/test/shared-connect-vector.test.mjs verifies every proof and check.',
  ceremony: sc.CEREMONY_URI,
  flow: sc.FLOW_URI,
  seeds: { note: 'hkdf(sha-256, ikm = utf8 of `seed`, no salt, info = label); messaging keys: Ed25519 from hkdf(msgSeed, "shared-connect/messaging/ed25519"), X25519 from hkdf(msgSeed, "shared-connect/messaging/x25519"); pair anchor: Ed25519 from the pair seed directly', seed: 'rltp shared-connect vector seed 2026-11', labels: { inviter: ['inviter/messaging', 'inviter/pair'], responder: ['responder/messaging', 'responder/pair'] } },
  challenges: { inviter: inviterChallenge, responder: responderChallenge },
  citation: { taskContext: propose.id, taskDigestMultibase: taskDigest },
  inviter: { messaging: inviter.messaging.did, document: inviter.peer.doc, relays: inviter.peer.relays, relationshipDid: inviter.pair.anchor },
  responder: { messaging: responder.messaging.did, document: responder.peer.doc, relays: responder.peer.relays, relationshipDid: responder.pair.anchor },
  link: { value: link, length: link.length, read: { from: read.link.from.did, id: read.link.id, exp: read.link.exp, type: read.link.type, label: read.link.label } },
  steps: { propose, accept, 'issue-inviter': issueInviter, 'receipt-inviter': receiptInviter, 'issue-responder': issueResponder, 'receipt-responder': receiptResponder },
  backCode: { value: backCode, length: backCode.length, rebuilds: 'steps.propose' },
  peer4: {
    note: 'The same keys, challenges and times with did:peer:4 messaging identities: the long form in the link and as issuer/recipient; key ids under the short form. The pairwise did:key and the credentials are unchanged in kind. A link with a long-form did:peer:4 is over the in-person size of about 450 characters, so it is rendered as a sent link (kind link, 990 characters at most).',
    inviter: { messaging: inviter4.messaging.did, short: sc.peer4Short(inviter4.messaging.did), document: inviter4.peer.doc, relays: inviter4.peer.relays },
    responder: { messaging: responder4.messaging.did, short: sc.peer4Short(responder4.messaging.did), document: responder4.peer.doc, relays: responder4.peer.relays },
    link: { value: link4, length: link4.length },
    steps: { propose: propose4, accept: accept4, 'issue-inviter': issueInviter4 },
  },
  mustFail: {
    links: linkCases.map((c) => ({ name: c.name, link: c.link, readAt: c.at ?? nowS, reason: c.reason })),
    propose: proposeCases.map((c) => ({ name: c.name, document: c.doc, me: c.me, at: new Date(c.at).toISOString().replace(/\.\d{3}Z$/, 'Z'), reason: c.reason })),
    accept: [{ name: 'acceptance with a reason member (closed response payload)', document: acceptWithReason, reason: 'payload' }],
    backCodes: [...backCases.map((c) => ({ name: c.name, code: c.code, result: 'not a back-code' })), { name: 'back-code with a changed name', code: backTampered, reason: 'proof' }],
  },
}
const rendered = JSON.stringify(out, null, 2) + '\n'
if (CHECK) {
  if (!existsSync(FILE) || rendered !== readFileSync(FILE, 'utf8')) { console.error('vectors/shared-connect.json: DIFFERS from its generation'); process.exit(1) }
  console.log('vectors/shared-connect.json reproduces byte for byte')
} else {
  writeFileSync(FILE, rendered)
  console.log('vectors/shared-connect.json written (link ' + link.length + ' chars, back-code ' + backCode.length + ' chars)')
}
