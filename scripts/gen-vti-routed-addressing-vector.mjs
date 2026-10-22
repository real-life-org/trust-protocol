#!/usr/bin/env node
// Generates vectors/vti-routed-addressing.json — the addressing of the two
// sending modes of the VTI mediator adapter profile 0.24 (§1a, §3a, §7):
// for one relationship between two sides A and B at one carrier C, which
// identity is the inner and the outer sender, which the receiver, what the
// route list holds, and on whose session the deposit goes; plus the
// addressings the profile refuses, each with the rule it breaks. The byte
// form of a TSP frame is the TSP library's and is not part of the vector.
// Deterministic: side A is the adapterScopedIdentities case of
// vectors/identity-derivation.json; side B uses a root and a nonce derived
// from fixed labels.
//
//   usage: node scripts/gen-vti-routed-addressing-vector.mjs [--check]   (from repo root;
//          requires lib/dist — build the library first)
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')
const OUT = join(ROOT, 'vectors/vti-routed-addressing.json')
const { carrierScopedIdentity, carrierPrincipal } = await import(join(ROOT, 'lib/dist/carrier-identity.js'))

const ID = JSON.parse(readFileSync(join(ROOT, 'vectors/identity-derivation.json'), 'utf8'))
const hexToBytes = (h) => Uint8Array.from(h.match(/../g).map((b) => parseInt(b, 16)))
const label = (s) => createHash('sha256').update(s, 'ascii').digest()
const C = ID.adapterScopedIdentities.carrier

async function side (rootIkm, nonce) {
  const connection = (await carrierScopedIdentity(rootIkm, C, nonce, 'connection')).did
  const egress = (await carrierScopedIdentity(rootIkm, C, nonce, 'egress')).did
  return { connection, egress }
}

const rootA = hexToBytes(ID.rootIkm)
const nonceA = hexToBytes(ID.carrierRelationship.relationshipNonce)
const rootB = new Uint8Array(label('rltp/vector/vti-routed/root-B'))
const nonceB = new Uint8Array(label('rltp/vector/vti-routed/nonce-B'))
const A = await side(rootA, nonceA)
const B = await side(rootB, nonceB)
const M = await side(new Uint8Array(label('rltp/vector/vti-routed/root-M')), new Uint8Array(label('rltp/vector/vti-routed/nonce-M')))
const principalA = (await carrierPrincipal(rootA, C, nonceA)).principal
if (A.connection !== ID.adapterScopedIdentities.connection.did || A.egress !== ID.adapterScopedIdentities.egress.did) {
  throw new Error('side A does not reproduce adapterScopedIdentities of vectors/identity-derivation.json')
}

const routed = (from, to) => ({
  inner: { messageType: 'direct', sender: from.egress, receiver: to.connection, sealedTo: 'keyAgreement[0] of receiver', signedBy: 'sender' },
  outer: { messageType: 'routed', sender: from.connection, receiver: C, route: [to.connection], sealedTo: 'keyAgreement[0] of receiver', signedBy: 'sender' },
  session: from.connection,
})
const egressSession = (from, to) => ({
  message: { messageType: 'direct', sender: from.egress, receiver: to.connection, sealedTo: 'keyAgreement[0] of receiver', signedBy: 'sender' },
  session: from.egress,
  sessionUse: 'send-only',
})
const accepts = (self, peer) => ({ messageType: 'direct', sender: peer.egress, receiver: self.connection, payload: 'non-empty' })

const r = routed(A, B)
// each case names the mode it claims and every rule it breaks, the rule it is about first
const refused = [
  { case: 'routed: inner sender is the connection DID', mode: 'routed', rules: ['RLTP-VTI-1110'], inner: { ...r.inner, sender: A.connection }, outer: r.outer, session: r.session },
  { case: 'routed: inner sender is the control principal', mode: 'routed', rules: ['RLTP-VTI-1110'], inner: { ...r.inner, sender: principalA }, outer: r.outer, session: r.session },
  { case: 'routed: outer sender is the egress identity', mode: 'routed', rules: ['RLTP-VTI-1120'], inner: r.inner, outer: { ...r.outer, sender: A.egress }, session: r.session },
  { case: 'routed: outer sender is the egress identity, on its own session', mode: 'routed', rules: ['RLTP-VTI-1120', 'RLTP-VTI-3110'], inner: r.inner, outer: { ...r.outer, sender: A.egress }, session: A.egress },
  { case: 'single layer: sender is the connection DID', mode: 'egress-session', rules: ['RLTP-VTI-1130', 'RLTP-VTI-3120'], message: { ...r.inner, sender: A.connection }, session: A.connection },
  { case: 'routed: outer receiver is not C', mode: 'routed', rules: ['RLTP-VTI-3110'], inner: r.inner, outer: { ...r.outer, receiver: B.connection }, session: r.session },
  { case: 'routed: inner receiver is the counterpart\'s egress identity', mode: 'routed', rules: ['RLTP-VTI-3110'], inner: { ...r.inner, receiver: B.egress }, outer: r.outer, session: r.session },
  { case: 'routed: deposited on the egress identity\'s session', mode: 'routed', rules: ['RLTP-VTI-3110'], inner: r.inner, outer: r.outer, session: A.egress },
  { case: 'routed: empty route', mode: 'routed', rules: ['RLTP-VTI-3115'], inner: r.inner, outer: { ...r.outer, route: [] }, session: r.session },
  { case: 'routed: route names the counterpart\'s egress identity', mode: 'routed', rules: ['RLTP-VTI-3115'], inner: r.inner, outer: { ...r.outer, route: [B.egress] }, session: r.session },
  { case: 'routed: route has a second hop', mode: 'routed', rules: ['RLTP-VTI-3115'], inner: r.inner, outer: { ...r.outer, route: [B.connection, B.egress] }, session: r.session },
  { case: 'routed: route names an account other than the inner receiver', mode: 'routed', rules: ['RLTP-VTI-3115'], inner: r.inner, outer: { ...r.outer, route: [A.connection] }, session: r.session },
  { case: 'egress-session: the inner message on the connection DID\'s session', mode: 'egress-session', rules: ['RLTP-VTI-3120'], message: egressSession(A, B).message, session: A.connection },
  { case: 'egress-session before the switch', mode: 'egress-session', switched: false, rules: ['RLTP-VTI-3120'], message: egressSession(A, B).message, session: A.egress },
]

// what a receiving binding refuses (RLTP-VTI-7140), seen from A
const receiveRefused = [
  { case: 'routed message at the client', message: { messageType: 'routed', sender: B.connection, receiver: A.connection } },
  { case: 'nested message', message: { messageType: 'nested', sender: B.egress, receiver: A.connection } },
  { case: 'control message', message: { messageType: 'control', sender: B.egress, receiver: A.connection } },
  { case: 'empty direct payload', message: { ...accepts(A, B), payload: 'empty' } },
  { case: 'sender is the counterpart\'s connection DID', message: { ...accepts(A, B), sender: B.connection } },
  { case: 'receiver is this side\'s egress identity', message: { ...accepts(A, B), receiver: A.egress } },
  { case: 'sender is a third party\'s egress identity', message: { ...accepts(A, B), sender: M.egress } },
].map((c) => ({ ...c, rules: ['RLTP-VTI-7140'] }))

const vector = {
  description: 'VTI mediator adapter profile 0.24 (§1a, §3a, §7): the addressing of a deposit in mode routed and in the fallback mode egress-session, the inner message a receiving binding accepts, and the addressings the profile refuses. Identities are did:key from the lib derivation (carrierScopedIdentity); sealedTo and signedBy name the key, not bytes: the frame bytes are the TSP library\'s.',
  source: 'side M (third party, receive refusals only): the labels root-M and nonce-M; side A = adapterScopedIdentities of vectors/identity-derivation.json (rootIkm, carrierRelationship.relationshipNonce); side B: rootIkm = sha2-256("rltp/vector/vti-routed/root-B"), nonce = sha2-256("rltp/vector/vti-routed/nonce-B"), ASCII labels. Generated by scripts/gen-vti-routed-addressing-vector.mjs.',
  carrier: C,
  sides: { A, B },
  routed: { 'A→B': routed(A, B), 'B→A': routed(B, A) },
  egressSession: { 'A→B': egressSession(A, B), 'B→A': egressSession(B, A) },
  accepts: { A: accepts(A, B), B: accepts(B, A) },
  refused,
  receiveRefused,
}

// every rule a case names is a rule of the profile
const manifest = new Set(readFileSync(join(ROOT, 'conformance/adapter-vti-rule-ids-0.24.txt'), 'utf8').split('\n').filter((l) => /^RLTP-VTI-/.test(l)))
for (const c of [...refused, ...receiveRefused]) for (const id of c.rules) if (!manifest.has(id)) throw new Error(`${c.case}: ${id} is not in the rule manifest`)

const text = JSON.stringify(vector, null, 1) + '\n'
if (CHECK) {
  const have = readFileSync(OUT, 'utf8')
  if (have !== text) { console.error('vectors/vti-routed-addressing.json differs from its generator'); process.exit(1) }
  console.log('vti-routed-addressing: reproduced byte for byte')
} else {
  writeFileSync(OUT, text)
  console.log(`wrote ${OUT}`)
}
