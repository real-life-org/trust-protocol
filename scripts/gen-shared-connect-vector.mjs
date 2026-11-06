#!/usr/bin/env node
// Generates vectors/shared-connect.json: one complete enactment of the
// shared connection ceremony on registry Trust Tasks (shared-connect 0.1,
// trustoverip/dtgwg-trust-tasks-tf#1034 as revised on 5 November 2026;
// the link per trustoverip/dtgwg-vti-spec#86): the inviter's did:peer:2 and
// link, the responder's did:peer:2, the propose, the acceptance, both
// credentials with their issue documents and receipts, the enactment
// binding, and the offline back-code of the propose. Everything is derived
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

const link = sc.sharedConnectLink({ from: inviter.messaging.did, id: inviterChallenge, exp, label: 'Anton' })
const read = sc.readSharedConnectLink(link, Math.floor(T('00') / 1000))
if (!read.ok) throw new Error('link does not read: ' + read.reason)

const propose = await sc.propose(responder, read.link.from.did, read.link.id, responderChallenge, T('05'))
const accept = await sc.accept(inviter, propose, T('07'), await fixedId('accept'))
const binding = await sc.binding(inviterChallenge, responderChallenge)
const vrcInviter = await sc.credential(inviter, propose.payload.relationshipDid, responderChallenge, binding, 'displayed', T('07'))
const issueInviter = await sc.issue(inviter, propose.issuer, propose.id, inviterChallenge, 'issue-inviter', vrcInviter, T('07'), await fixedId('issue-inviter'))
const receiptInviter = await sc.receipt(responder, issueInviter, T('08'), await fixedId('receipt-inviter'))
const vrcResponder = await sc.credential(responder, accept.payload.relationshipDid, inviterChallenge, binding, 'scan', T('09'))
const issueResponder = await sc.issue(responder, inviter.messaging.did, propose.id, inviterChallenge, 'issue-responder', vrcResponder, T('09'), await fixedId('issue-responder'))
const receiptResponder = await sc.receipt(inviter, issueResponder, T('10'), await fixedId('receipt-responder'))
const backCode = sc.backCodeOf(propose)

// every check the receiving sides run must pass on the vector itself
const fail = (what) => { throw new Error('vector does not pass its own checks: ' + what) }
if (await sc.checkPropose(propose, { did: inviter.messaging.did, id: inviterChallenge }, T('06')) !== null) fail('propose')
if (await sc.checkAccept(accept, propose, inviter.messaging.did) !== null) fail('accept')
if (await sc.checkIssue(issueInviter, { issuerDid: inviter.messaging.did, myDid: responder.messaging.did, threadId: propose.id, enactment: inviterChallenge, step: 'issue-inviter', issuerPair: inviter.pair.anchor, myPair: responder.pair.anchor, myChallenge: responderChallenge, binding }) !== null) fail('issue-inviter')
if (await sc.checkIssue(issueResponder, { issuerDid: responder.messaging.did, myDid: inviter.messaging.did, threadId: propose.id, enactment: inviterChallenge, step: 'issue-responder', issuerPair: responder.pair.anchor, myPair: inviter.pair.anchor, myChallenge: inviterChallenge, binding }) !== null) fail('issue-responder')
const rebuilt = sc.proposeFromBackCode(backCode, { did: inviter.messaging.did, id: inviterChallenge })
if (JSON.stringify(rebuilt) !== JSON.stringify(propose)) fail('back-code')

const out = {
  description: 'One enactment of the shared connection ceremony (shared-connect 0.1) on the registry tasks vrc/relationships/propose 0.1 and vrc/relationships/issue 0.1, started by a VTI trigger link whose _from is the inviter\'s per-encounter did:peer:2 carrying its relays as services. The responder proposes (its challenge is the propose id and the threadId of every later document); ceremony.enactment is the link\'s _id (the inviter\'s challenge) on every step. Step documents are signed under authentication by #key-1 of the issuer\'s did:peer:2 (eddsa-jcs-2022); credentials are signed by the pairwise did:key (relationshipDid) under assertionMethod, with the document @context repeated in the proof. The enactment binding is the construction of Encounter RLTP-ENC-5330 under the ceremony URI. The back-code is the responder\'s propose in reconstruction form for the offline path: recipient, type, step, enactment and the proof configuration are rebuilt from the inviter\'s own state. Keys and challenges derive from fixed seeds; a second implementation reproduces the link, the back-code and every document except the proofValues, which it verifies instead. Generated by scripts/gen-shared-connect-vector.mjs; lib/test/shared-connect-vector.test.mjs verifies every proof and check.',
  ceremony: sc.CEREMONY_URI,
  flow: sc.FLOW_URI,
  seeds: { note: 'hkdf(sha-256, ikm = utf8 of `seed`, no salt, info = label); messaging keys: Ed25519 from hkdf(msgSeed, "shared-connect/messaging/ed25519"), X25519 from hkdf(msgSeed, "shared-connect/messaging/x25519"); pair anchor: Ed25519 from the pair seed directly', seed: 'rltp shared-connect vector seed 2026-11', labels: { inviter: ['inviter/messaging', 'inviter/pair'], responder: ['responder/messaging', 'responder/pair'] } },
  challenges: { inviter: inviterChallenge, responder: responderChallenge },
  binding,
  inviter: { messaging: inviter.messaging.did, document: inviter.peer.doc, relays: inviter.peer.relays, relationshipDid: inviter.pair.anchor },
  responder: { messaging: responder.messaging.did, document: responder.peer.doc, relays: responder.peer.relays, relationshipDid: responder.pair.anchor },
  link: { value: link, length: link.length, read: { from: read.link.from.did, id: read.link.id, exp: read.link.exp, type: read.link.type, label: read.link.label } },
  steps: { propose, accept, 'issue-inviter': issueInviter, 'receipt-inviter': receiptInviter, 'issue-responder': issueResponder, 'receipt-responder': receiptResponder },
  backCode: { value: backCode, length: backCode.length, rebuilds: 'steps.propose' },
}
const rendered = JSON.stringify(out, null, 2) + '\n'
if (CHECK) {
  if (!existsSync(FILE) || rendered !== readFileSync(FILE, 'utf8')) { console.error('vectors/shared-connect.json: DIFFERS from its generation'); process.exit(1) }
  console.log('vectors/shared-connect.json reproduces byte for byte')
} else {
  writeFileSync(FILE, rendered)
  console.log('vectors/shared-connect.json written (link ' + link.length + ' chars, back-code ' + backCode.length + ' chars)')
}
