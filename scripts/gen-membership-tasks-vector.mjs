#!/usr/bin/env node
// Generates vectors/membership-tasks.json — the admission carrier of
// Membership Tasks 0.17 (rltp-membership@0.17): one access-operation/0.1
// payload (the admitting member.add, envelope rltp-access/0.25) with its
// welcome seal (plaintext rltp-welcome/0.1, material
// rltp-access-material/0.25 with keyState), the task document around it,
// and the evidence relay in both type versions (membership-evidence/0.1
// without vouches, /0.2 with vouches).
//
// Built on vectors/dtg-credentials.json: the enclosed invite and accept
// documents, the parties, the vouch and the genesis digest are taken from
// there unchanged, so every signature of the consent pair is the one that
// file already proves. Deterministic: ephemeral key, nonce, content key
// and the genesis stand-in derive from the oracle IKM of
// vectors/identity-derivation.json under vector-only info strings.
// Re-running this script reproduces the vector file byte-for-byte;
// conformance/runner.mjs re-derives the operation id and signature, opens
// the seal under the invitee's key, recomputes the welcome digest and the
// binding fields, and applies every declared negative.
//
//   usage: node scripts/gen-membership-tasks-vector.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { jcs, sha, hkdf, digestU, privEd, privX, pubRaw, xRawOfMk, pubFromRaw, XS, didOf, b58 } from '../conformance/lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const J = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))
const ID = J('vectors/identity-derivation.json')
const D = J('vectors/dtg-credentials.json')
const IKM = Buffer.from(ID.rootIkm, 'hex')
const IKM2 = Buffer.from(crypto.hkdfSync('sha256', IKM, Buffer.alloc(0), Buffer.from('rltp/vector/second-party-root-ikm', 'utf8'), 64))
const md = D.memberAnchorDerivation
const inviterSeed = hkdf(IKM2, md.edInfo)
if (didOf(inviterSeed) !== D.parties.inviterVoucher.anchor) throw new Error('inviter seed does not reproduce the inviter anchor')

const INFO = {
  genesis: 'rltp/vector/membership-genesis-stand-in',
  contentKey: 'rltp/vector/membership-content-key',
  ephemeral: 'rltp/vector/membership-welcome-ephemeral',
  nonce: 'rltp/vector/membership-welcome-nonce',
}
const invDoc = D.invite.document
const accDoc = D.accept.document
const inv = invDoc.payload.invite
const subject = accDoc.payload.accept.subject
const group = accDoc.payload.accept.group

// the genesis stand-in: an operation id the vector does not ship; under
// linear/0.1 the genesis opens the first key state, so keyState names it
const genesisOid = 'oid:' + sha(Buffer.from(INFO.genesis, 'utf8')).toString('base64url')

// welcome plaintext (Membership 4): binding fields + the current material
const welcome = {
  v: 'rltp-welcome/0.1',
  group,
  subject,
  accept: digestU(accDoc),
  material: {
    v: 'rltp-access-material/0.25',
    adapter: 'linear/0.1',
    epoch: 0,
    keyState: genesisOid,
    keys: { contentKey: hkdf(IKM, INFO.contentKey).toString('base64url') },
  },
}
const plaintextJcs = jcs(welcome)
const welcomeDigest = digestU(welcome)

// the welcome seal: Contract §5 with HKDF info rltp/v1/welcome, sealed to
// the key-agreement key of the accept's card (Membership 4)
const rkid = accDoc.payload.accept.card.keyAgreement
const ephSeed = hkdf(IKM, INFO.ephemeral)
const nonce = hkdf(IKM, INFO.nonce).subarray(0, 12)
const shared = crypto.diffieHellman({ privateKey: privX(ephSeed), publicKey: pubFromRaw(xRawOfMk(rkid), XS) })
const aesKey = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.from('rltp/v1/welcome', 'utf8'), 32))
const c = crypto.createCipheriv('aes-256-gcm', aesKey, nonce)
const ct = Buffer.concat([c.update(Buffer.from(plaintextJcs, 'utf8')), c.final(), c.getAuthTag()])
const sealed = {
  rkid,
  epk: pubRaw(privX(ephSeed)).toString('base64url'),
  nonce: nonce.toString('base64url'),
  ciphertext: ct.toString('base64url'),
}

// the admitting operation (Access 3.3, rltp-access/0.25): id over JCS with
// id empty and proof omitted (RLTP-ACC-3100), signed over the same bytes
// (RLTP-ACC-3105) by the inviter
const unsigned = {
  v: 'rltp-access/0.25',
  op: 'member.add',
  group,
  epoch: 0,
  policyVersion: 1,
  prev: [genesisOid],
  body: { subject, admission: { invite: invDoc, accept: accDoc, welcome: welcomeDigest } },
  id: '',
  author: D.parties.inviterVoucher.anchor,
}
const signingInput = Buffer.from(jcs(unsigned), 'utf8')
const id = 'oid:' + sha(signingInput).toString('base64url')
const sig = 'z' + b58(crypto.sign(null, signingInput, privEd(inviterSeed)))
const operation = { ...unsigned, id, proof: { mechanism: 'signature-set', signatures: [{ signer: unsigned.author, sig }] } }
const payload = { operation, welcome: { sealed } }

// the task document: delivered to its own subject, issued by the author,
// no document proof (the envelope carries its own signatures)
const document = {
  id: '5a0c7e12-3b4d-4e6f-9a1b-2c3d4e5f6a7b',
  type: 'https://real-life.org/trust-tasks/access-operation/0.1',
  issuer: operation.author,
  recipient: subject,
  threadId: inv.taskContext,
  issuedAt: '2026-08-25T12:10:00Z',
  payload,
}

// the evidence relay, both type versions
const evidence01 = { evidence: { invite: invDoc, accept: accDoc } }
const evidence02 = { evidence: { invite: invDoc, accept: accDoc, vouches: [D.vouch.u] } }

const P = 'https://real-life.org/trust-tasks/'
const negatives = [
  { name: 'envelope-0.24', rule: 'D-2 (RLTP-ACC-11100 ends with the pin)', artifact: 'payload', schema: 'payload-access-operation.schema.json', set: { '/operation/v': 'rltp-access/0.24' }, at: '$.operation.v: const mismatch', note: 'the carrier pins rltp-access/0.25; the Access-owned envelope schema alone still accepts 0.24' },
  { name: 'welcome-material-0.24', rule: 'D-2 (RLTP-ACC-11100 ends with the pin)', artifact: 'welcome', schema: 'welcome.schema.json', set: { '/material/v': 'rltp-access-material/0.24' }, delete: ['/material/keyState'], at: '$.material.v: const mismatch', note: 'the legacy material form, itself valid against access-material.schema.json' },
  { name: 'welcome-material-without-keyState', rule: 'RLTP-ACC-9362', artifact: 'welcome', schema: 'welcome.schema.json', delete: ['/material/keyState'], at: '$.material: missing required keyState' },
  { name: 'welcome-keydist-form', rule: 'RLTP-ACC-9362, Membership 4', artifact: 'welcome', schema: 'welcome.schema.json', set: { '/material/v': 'rltp-access-keydist/0.25' }, delete: ['/material/keyState'], at: '$.material.v: const mismatch', note: 'the per-device keydist form never travels in a welcome' },
  { name: 'operation-with-transition', rule: 'Membership 3.3 (defence in depth, Access 5.3)', artifact: 'payload', schema: 'payload-access-operation.schema.json', set: { '/operation/body/transition': { newEpoch: 1, keyOpDigest: welcomeDigest, succeeds: [genesisOid] } }, at: '$.operation.body: not matched' },
  { name: 'operation-not-member-add', rule: 'Membership 3.3 (admission only)', artifact: 'payload', schema: 'payload-access-operation.schema.json', set: { '/operation/op': 'member.remove' }, at: '$.operation.op: const mismatch' },
  { name: 'evidence-0.2-empty-vouches', rule: 'Membership 3.4 (no vouches = no member)', artifact: 'evidence02', schema: 'payload-membership-evidence.schema.json', set: { '/evidence/vouches': [] }, at: '$.evidence.vouches: minItems' },
  { name: 'evidence-0.2-17-vouches', rule: 'Membership 3.4, RLTP-ACC-5320 (at most 16)', artifact: 'evidence02', schema: 'payload-membership-evidence.schema.json', fill: { '/evidence/vouches': 17 }, at: '$.evidence.vouches: maxItems' },
  { name: 'evidence-0.2-vouch-without-proof', rule: 'Membership 3.4, RLTP-ACC-5360 (vouch@2)', artifact: 'evidence02', schema: 'payload-membership-evidence.schema.json', delete: ['/evidence/vouches/0/proof'], at: '$.evidence.vouches[0]: missing required proof' },
  { name: 'evidence-0.1-with-vouches', rule: 'Membership 3.4 (membership-evidence/0.1 is closed)', artifact: 'evidence01', schema: 'payload-membership-evidence-0.1.schema.json', set: { '/evidence/vouches': [D.vouch.u] }, at: '$.evidence: additionalProperty vouches' },
]

const vector = {
  source: 'RLTP Membership Tasks 0.17 (rltp-membership@0.17) sections 3.3, 3.4 and 4, over Access Layer 0.54 (wire rltp-access/0.25, rltp-access-material/0.25). Invite, accept, vouch, parties and genesis digest are those of vectors/dtg-credentials.json, unchanged. Generated by scripts/gen-membership-tasks-vector.mjs (deterministic); re-derived by conformance/runner.mjs.',
  format: {
    inputs: 'vector-only HKDF info strings under the oracle IKM of vectors/identity-derivation.json: genesis is the stand-in operation id oid:base64url(SHA-256(info)) the operation succeeds and the material names as its key state (linear/0.1: the genesis opens the first key state); contentKey, ephemeral (X25519 seed) and nonce (first 12 bytes) are HKDF(IKM, info, 32). The inviter signs with HKDF(second-party IKM, memberAnchorDerivation.edInfo) of dtg-credentials.json.',
    welcome: 'plaintext (rltp-welcome/0.1), its JCS, its digest (multibase multihash over the JCS, = operation.body.admission.welcome), and the seal (Contract §5 with HKDF info rltp/v1/welcome, sealed to the accept card keyAgreement)',
    payload: 'the access-operation/0.1 payload: { operation, welcome: { sealed } }; operation.id per RLTP-ACC-3100, its one signature per RLTP-ACC-3105',
    document: 'the task document carrying payload: issuer = operation.author, recipient = body.subject, no document proof',
    evidence01: 'membership-evidence/0.1 payload (no vouches) — accepted',
    evidence02: 'membership-evidence/0.2 payload with one vouch@2 (vouch.u of dtg-credentials.json)',
    validEvidence: 'further VALID membership-evidence/0.2 variants, as mutations of evidence02: delete or fill (fill n = an array of n copies of the first element)',
    negatives: 'each a mutation of one artifact (set: JSON pointer → value; delete: pointers; fill: pointer → n copies of the first element) that MUST fail its schema with an error at the declared point "at"; the unmutated artifact passes, so the fixture is broken there and nowhere else',
    bindingNegatives: 'mutations of payload that stay schema-valid and MUST fail the welcome binding (Membership 4: admission.welcome = digest of the opened plaintext; group, subject, accept bound to the operation)',
  },
  inputs: { ...INFO, genesisOid },
  welcome: { plaintext: welcome, plaintextJcs, digest: welcomeDigest, sealed },
  payload,
  document,
  evidence01,
  evidence02,
  validEvidence: [
    { name: 'evidence-0.2-without-vouches', delete: ['/evidence/vouches'] },
    { name: 'evidence-0.2-16-vouches', fill: { '/evidence/vouches': 16 } },
  ],
  negatives,
  bindingNegatives: [
    { name: 'welcome-digest-mismatch', set: { '/operation/body/admission/welcome': digestU({ ...welcome, material: { ...welcome.material, epoch: 1 } }) }, note: 'admission.welcome names a different plaintext than the seal carries' },
    { name: 'welcome-for-another-group', setPlaintext: { '/group': D.parties.inviterVoucher.anchor }, note: 'a coherently re-digested welcome whose group is not operation.group' },
    { name: 'welcome-for-another-subject', setPlaintext: { '/subject': D.parties.inviterVoucher.anchor }, note: 'a coherently re-digested welcome whose subject is not body.subject' },
    { name: 'welcome-for-another-accept', setPlaintext: { '/accept': digestU(invDoc) }, note: 'a coherently re-digested welcome whose accept is not the digest of admission.accept' },
  ],
}
writeFileSync(join(ROOT, 'vectors/membership-tasks.json'), JSON.stringify(vector, null, 1) + '\n')
console.log(`vectors/membership-tasks.json written; operation ${id}, welcome ${welcomeDigest}`)
