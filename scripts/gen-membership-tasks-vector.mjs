#!/usr/bin/env node
// Generates vectors/membership-tasks.json — the conformance vectors of
// Membership Tasks 0.17 (rltp-membership@0.17): one complete admission
// chain from a real genesis, every artifact signed, sealed and digested
// by the construction its rule names.
//
//   genesis (group DID + founder, rltp-access/0.25) → genesis digest →
//   invitee member anchor derived from it → invite (founder) → accept
//   (invitee) → vouch (founder) → welcome (material of the genesis key
//   state, sealed to the accept card) → admitting member.add → the
//   access-operation/0.1 task, the self-contained re-welcome, and the
//   evidence relay as membership-evidence/0.1 and /0.2.
//
// Every case carries `rules`: the RLTP-MT identifiers it proves
// (RLTP-MT-10090). Negatives are either declared mutations that MUST
// fail a schema at a named point, or coherently re-signed artifacts that
// stay schema-valid and MUST fail a named receiver check — so a negative
// is broken at its declared point and nowhere else.
//
// Deterministic: every key, nonce and content key derives from the
// oracle IKM of vectors/identity-derivation.json (the invitee) or the
// second-party IKM of vectors/dtg-credentials.json (founder, group DID,
// third member) under vector-only info strings. Two genesis fields are
// stand-ins the Access vectors own: `serviceIdentity` (derived service
// identity, Access 5.2) and `keyOpDigest` (the adapter's key-operation
// digest, Access 9.2) — the runner marks them [not-proven].
//
//   usage: node scripts/gen-membership-tasks-vector.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { jcs, sha, hkdf, digestU, privEd, privX, pubRaw, xRawOfMk, pubFromRaw, XS, didOf, mkOf, b58 } from '../conformance/lib.mjs'
import { splitRules } from '../conformance/membership-partial.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const J = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))
const ID = J('vectors/identity-derivation.json')
const DTG = J('vectors/dtg-credentials.json')
const FIX = J('fixtures/invalid-examples.json')
const IKM = Buffer.from(ID.rootIkm, 'hex')
const IKM2 = Buffer.from(crypto.hkdfSync('sha256', IKM, Buffer.alloc(0), Buffer.from('rltp/vector/second-party-root-ikm', 'utf8'), 64))
const P = 'https://real-life.org/trust-tasks/'
const clone = (o) => JSON.parse(JSON.stringify(o))
const b64u = (b) => Buffer.from(b).toString('base64url')
const mh = (bytes) => 'u' + b64u(Buffer.concat([Buffer.from([0x12, 0x20]), sha(bytes)]))

const INFO = {
  founder: 'rltp/vector/membership-founder-context',
  founderX: 'rltp/vector/membership-founder-context-x',
  groupDid: 'rltp/vector/membership-group-did',
  third: 'rltp/vector/membership-third-member',
  serviceIdentity: 'rltp/vector/membership-service-identity-stand-in',
  keyOpDigest: 'rltp/vector/membership-key-op-stand-in',
  contentKey: 'rltp/vector/membership-content-key',
  ephemeral: 'rltp/vector/membership-welcome-ephemeral',
  nonce: 'rltp/vector/membership-welcome-nonce',
  inviteeOtherX: 'rltp/vector/membership-invitee-other-x',
}
const T = {
  founderCard: '2026-09-01T09:00:00Z', inviteeCard: '2026-09-01T10:05:00Z',
  validFrom: '2026-09-01T10:00:00Z', validUntil: '2026-11-30T10:00:00Z',
  accept: '2026-09-01T10:06:00Z', vouch: '2026-09-01T10:10:00Z',
  evidence: '2026-09-01T10:15:00Z', carrier: '2026-09-01T10:20:00Z',
}
const UUID = {
  thread: '6b1f3c2a-8d4e-4a7b-9c1d-2e3f4a5b6c7d', invite: '7c2a4d3b-9e5f-4b8c-8d2e-3f4a5b6c7d8e',
  accept: '8d3b5e4c-af60-4c9d-9e3f-4a5b6c7d8e9f', carrier: '9e4c6f5d-b071-4dae-af40-5b6c7d8e9fa0',
  evidence02: 'af5d7a6e-c182-4ebf-8051-6c7d8e9fa0b1', evidence01: 'b06e8b7f-d293-4fc0-9162-7d8e9fa0b1c2',
  other: '00000000-0000-4000-8000-000000000000',
}

// eddsa-jcs-2022 (W3C DI-EDDSA): hashData = SHA-256(JCS(proofConfig)) ||
// SHA-256(JCS(document without proof)); credentials carry the @context copy
const diSign = (doc, seed, created, withCtx) => {
  const { proof: _drop, ...rest } = doc
  const did = didOf(seed)
  const cfg = { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', created, verificationMethod: `${did}#${did.slice(8)}`, proofPurpose: 'assertionMethod', ...(withCtx ? { '@context': rest['@context'] } : {}) }
  const hash = Buffer.concat([sha(Buffer.from(jcs(cfg), 'utf8')), sha(Buffer.from(jcs(rest), 'utf8'))])
  return { ...rest, proof: { ...cfg, proofValue: 'z' + b58(crypto.sign(null, hash, privEd(seed))) } }
}
// an Access envelope: id over JCS with id empty and proof omitted
// (RLTP-ACC-3100), every signature over the same bytes, sorted by signer
const envelope = (unsigned, seeds) => {
  const input = Buffer.from(jcs({ ...unsigned, id: '' }), 'utf8')
  const signatures = seeds.map((s) => ({ signer: didOf(s), sig: 'z' + b58(crypto.sign(null, input, privEd(s))) }))
    .sort((a, b) => (a.signer < b.signer ? -1 : a.signer > b.signer ? 1 : 0))
  return { input, op: { ...unsigned, id: 'oid:' + b64u(sha(input)), proof: { mechanism: 'signature-set', signatures } } }
}

// ── parties ──────────────────────────────────────────────────────────────
const founderSeed = hkdf(IKM2, INFO.founder)        // fresh founding context (RLTP-ACC-3275)
const founderX = hkdf(IKM2, INFO.founderX)
const groupSeed = hkdf(IKM2, INFO.groupDid)
const thirdSeed = hkdf(IKM2, INFO.third)
const founder = didOf(founderSeed)
const groupDid = didOf(groupSeed)
const third = didOf(thirdSeed)
const contentKeyRaw = hkdf(IKM, INFO.contentKey)

const makeCard = (seed, xSeed, created, extra = {}) =>
  diSign({ version: 'rltp-card/0.25', anchor: didOf(seed), keyAgreement: mkOf(xSeed), ...extra }, seed, created, false)
const founderCard = makeCard(founderSeed, founderX, T.founderCard)

// ── the genesis (Access 3.4.1) ───────────────────────────────────────────
const { input: genesisInput, op: genesis } = envelope({
  v: 'rltp-access/0.25', op: 'group.genesis', group: groupDid, epoch: 0, policyVersion: 1, prev: [],
  body: {
    members: [founder], card: founderCard, policy: { policyVersion: 1, rules: {} }, visibility: 'private',
    adapter: 'linear/0.1', contentKeyCommitment: mh(contentKeyRaw),
    keyOpDigest: mh(Buffer.from(INFO.keyOpDigest, 'utf8')),
    serviceIdentity: didOf(hkdf(IKM2, INFO.serviceIdentity)),
  },
  id: '', author: founder,
}, [groupSeed, founderSeed])
const genesisDigest = mh(genesisInput)               // RLTP-ACC-3030

// ── invitee: member anchor derived from the genesis digest (Access 5.1) ──
const edInfo = 'rltp/anchor/ed/group/' + genesisDigest
const xInfo = 'rltp/anchor/x/group/' + genesisDigest
const inviteeSeed = hkdf(IKM, edInfo)
const inviteeX = hkdf(IKM, xInfo)
const invitee = didOf(inviteeSeed)
const inviteeOtherX = hkdf(IKM, INFO.inviteeOtherX)  // another key-agreement key of the same person

// ── the consent pair, built coherently for every variant ─────────────────
const makePair = (o = {}) => {
  const fCard = o.founderCard ?? (o.founderCardCreated ? makeCard(founderSeed, founderX, o.founderCardCreated) : founderCard)
  const iCard = o.inviteeCard ?? makeCard(inviteeSeed, inviteeX, T.inviteeCard)
  const subject = o.subject ?? invitee
  let cred = {
    '@context': clone(DTG.invite.payload.invite['@context']),
    type: clone(DTG.invite.payload.invite.type),
    issuer: founder,
    credentialSubject: { id: subject, group: groupDid, genesisDigest: o.genesis ?? genesisDigest, card: fCard, name: 'F.', note: 'membership vector invite', ...(o.subjectExtra ?? {}) },
    validFrom: T.validFrom,
    validUntil: o.validUntil ?? T.validUntil,
    taskContext: UUID.thread,
  }
  cred = diSign(cred, founderSeed, T.validFrom, o.inviteCtxCopy !== false)
  const invDoc = {
    id: UUID.invite, type: P + 'membership-invite/0.2', issuer: o.invDocIssuer ?? founder, recipient: o.invDocRecipient ?? subject,
    threadId: o.invThread ?? UUID.thread, issuedAt: T.validFrom, payload: { invite: cred },
  }
  const accIssued = o.acceptIssued ?? T.accept
  const signAccept = (extra) => diSign({
    id: o.acceptId ?? UUID.accept, type: P + 'membership-accept/0.2', issuer: invitee, recipient: o.acceptRecipient ?? founder,
    threadId: o.acceptThread ?? UUID.thread, issuedAt: accIssued,
    payload: { accept: { group: o.acceptGroup ?? groupDid, subject: invitee, ref: o.ref ?? digestU(cred), card: iCard, ...(o.noCandidacy ? {} : { candidacy: o.candidacy ?? true }) } },
    ...extra,
  }, o.acceptSigner ?? inviteeSeed, o.acceptCreated ?? accIssued, false)
  let accDoc = signAccept({})
  // a signed accept padded through its ceremony to exactly `acceptBytes` JCS bytes
  if (o.acceptBytes) {
    let n = o.acceptBytes - Buffer.byteLength(jcs(signAccept({ ceremony: { pad: '' } })), 'utf8')
    for (let i = 0; i < 8; i++) { accDoc = signAccept({ ceremony: { pad: 'x'.repeat(n) } }); const d = o.acceptBytes - Buffer.byteLength(jcs(accDoc), 'utf8'); if (d === 0) break; n += d }
  }
  return { invDoc, accDoc }
}
const { invDoc, accDoc } = makePair()
const inv = invDoc.payload.invite

const makeVouch = (o = {}) => diSign({
  '@context': clone(DTG.vouch.u['@context']), type: clone(DTG.vouch.u.type), issuer: founder, validFrom: T.vouch,
  credentialSubject: { id: o.subject ?? invitee, endorsement: { type: 'AdmissionVouch', genesisDigest: o.genesis ?? genesisDigest, accept: o.accept ?? digestU(accDoc), provenance: 'met' } },
}, founderSeed, T.vouch, true)
const vouch = makeVouch()

// ── the welcome (Membership 4) and its seal ──────────────────────────────
const welcome = {
  v: 'rltp-welcome/0.1', group: groupDid, subject: invitee, accept: digestU(accDoc),
  material: { v: 'rltp-access-material/0.25', adapter: 'linear/0.1', epoch: 0, keyState: genesis.id, keys: { contentKey: b64u(contentKeyRaw) } },
}
const seal = (plaintext, rkid, ephInfo, nonceInfo, hkdfInfo = 'rltp/v1/welcome') => {
  const ephSeed = hkdf(IKM, ephInfo)
  const nonce = hkdf(IKM, nonceInfo).subarray(0, 12)
  const shared = crypto.diffieHellman({ privateKey: privX(ephSeed), publicKey: pubFromRaw(xRawOfMk(rkid), XS) })
  const key = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.from(hkdfInfo, 'utf8'), 32))
  const c = crypto.createCipheriv('aes-256-gcm', key, nonce)
  const ct = Buffer.concat([c.update(Buffer.from(jcs(plaintext), 'utf8')), c.final(), c.getAuthTag()])
  return { rkid, epk: b64u(pubRaw(privX(ephSeed))), nonce: b64u(nonce), ciphertext: b64u(ct) }
}
const sealed = seal(welcome, accDoc.payload.accept.card.keyAgreement, INFO.ephemeral, INFO.nonce)
const sealedOtherKey = seal(welcome, mkOf(inviteeOtherX), INFO.ephemeral + '/other-key', INFO.nonce + '/other-key')

// ── the admitting member.add and the access-operation/0.1 task ───────────
const { op: operation } = envelope({
  v: 'rltp-access/0.25', op: 'member.add', group: groupDid, epoch: 0, policyVersion: 1, prev: [genesis.id],
  body: { subject: invitee, admission: { invite: invDoc, accept: accDoc, welcome: digestU(welcome) } },
  id: '', author: founder,
}, [founderSeed])
const payload = { operation, welcome: { sealed } }
const document = { id: UUID.carrier, type: P + 'access-operation/0.1', issuer: founder, recipient: invitee, threadId: UUID.thread, issuedAt: T.carrier, payload }

// a digest in its base58btc rendering: the same multihash bytes (Encounter 2.3)
const zOf = (u) => 'z' + b58(Buffer.from(u.slice(1), 'base64url'))
// a complete admission task, built coherently: welcome, seal, digest, the
// operation re-signed and the document re-addressed for every variant, so
// a variant differs from the vector's task in exactly its declared point.
// Each variant seals under its own ephemeral key and nonce (`tag`).
const makeAdmission = (o = {}) => {
  const aDoc = o.accept ?? accDoc
  const iDoc = o.invite ?? invDoc
  const subject = o.subject ?? invitee
  const group = o.group ?? groupDid
  const w = { ...clone(welcome), group, subject, accept: o.welcomeAccept ?? digestU(aDoc), ...(o.welcomeExtra ?? {}) }
  const rkid = o.sealTo === 'other' ? mkOf(inviteeOtherX) : aDoc.payload.accept.card.keyAgreement
  const s = seal(w, rkid, INFO.ephemeral + '/' + o.tag, INFO.nonce + '/' + o.tag)
  const { op } = envelope({
    v: 'rltp-access/0.25', op: 'member.add', group, epoch: 0, policyVersion: 1, prev: [genesis.id],
    body: { subject, admission: { invite: iDoc, accept: aDoc, welcome: o.admissionWelcome ?? digestU(w) }, ...(o.bodyExtra ?? {}) },
    id: '', author: founder,
  }, [founderSeed])
  const pl = { operation: op, welcome: { sealed: s } }
  return { payload: pl, document: { ...document, recipient: subject, payload: pl } }
}

// the self-contained bootstrap: key-delivery/0.1, kind re-welcome (Access 10.1)
const reWelcome = { keyDelivery: { group: groupDid, genesisDigest, subject: invitee, epoch: 0, op: operation.id, kind: 're-welcome', sealed } }

// ── the evidence relay ───────────────────────────────────────────────────
const evidence01 = { evidence: { invite: invDoc, accept: accDoc } }
const evidence02 = { evidence: { invite: invDoc, accept: accDoc, vouches: [vouch] } }
const evDoc = (id, type, pl) => ({ id, type, issuer: invitee, recipient: third, threadId: UUID.thread, issuedAt: T.evidence, payload: pl })
const evidenceDocuments = {
  v02: evDoc(UUID.evidence02, P + 'membership-evidence/0.2', evidence02),
  v01: evDoc(UUID.evidence01, P + 'membership-evidence/0.1', evidence01),
}

// ── cases ────────────────────────────────────────────────────────────────
const R = (...n) => n.map((x) => 'RLTP-MT-' + x)
const pairOf = (p) => ({ evidence: { invite: p.invDoc, accept: p.accDoc } })
const plus = (s, sec) => new Date(Date.parse(s) + sec * 1000).toISOString().replace('.000Z', 'Z')

// schema negatives: declared mutations of one artifact, failing AT `at`
const removal = FIX.bases['removal-notice'].document
const sigs65 = Array.from({ length: 65 }, () => clone(operation.proof.signatures[0]))
const negatives = [
  { name: 'envelope-0.24', rules: R(10020, 10050, 3310), artifact: 'payload', schema: 'payload-access-operation.schema.json', set: { '/operation/v': 'rltp-access/0.24' }, at: '$.operation.v: const mismatch', note: 'the carrier pins rltp-access/0.25; the Access-owned envelope schema alone still accepts 0.24' },
  { name: 'welcome-material-0.24', rules: R(10020, 10050, 4040), artifact: 'welcome', schema: 'welcome.schema.json', set: { '/material/v': 'rltp-access-material/0.24' }, delete: ['/material/keyState'], at: '$.material.v: const mismatch', note: 'the legacy material form, itself valid against access-material.schema.json' },
  { name: 'welcome-material-without-keyState', rules: R(4040, 3445), artifact: 'welcome', schema: 'welcome.schema.json', delete: ['/material/keyState'], at: '$.material: missing required keyState' },
  { name: 'welcome-keydist-form', rules: R(4040, 3445), artifact: 'welcome', schema: 'welcome.schema.json', set: { '/material/v': 'rltp-access-keydist/0.25' }, delete: ['/material/keyState'], at: '$.material.v: const mismatch', note: 'the per-device keydist form never travels in a welcome' },
  { name: 'welcome-material-unregistered-key', rules: R(3445), artifact: 'welcome', schema: 'welcome.schema.json', set: { '/material/keys/history': b64u(contentKeyRaw) }, at: '$.material.keys: additionalProperty history', note: 'linear/0.1 registers exactly the content key' },
  { name: 'welcome-unknown-binding-field', rules: R(4030, 4020), artifact: 'welcome', schema: 'welcome.schema.json', set: { '/epoch': 0 }, at: '$: additionalProperty epoch' },
  { name: 'welcome-operation-back-pointer', rules: R(4070, 4030), artifact: 'welcome', schema: 'welcome.schema.json', set: { '/operation': operation.id }, at: '$: additionalProperty operation', note: 'the welcome binds the accept, never the operation id' },
  { name: 'welcome-implicit-capability-blind', rules: R(4060, 4030), artifact: 'welcome', schema: 'welcome.schema.json', set: { '/blind': b64u(sha('blind')) }, at: '$: additionalProperty blind' },
  { name: 'welcome-continuation', rules: R(4130, 4030), artifact: 'welcome', schema: 'welcome.schema.json', set: { '/continuation': { part: 1, of: 2 } }, at: '$: additionalProperty continuation' },
  { name: 'operation-with-transition', rules: R(3365, 3370), artifact: 'payload', schema: 'payload-access-operation.schema.json', set: { '/operation/body/transition': { newEpoch: 1, keyOpDigest: digestU(welcome), succeeds: [genesis.id] } }, at: '$.operation.body: not matched' },
  { name: 'operation-epoch-rotate', rules: R(3365, 3350, 3300), artifact: 'payload', schema: 'payload-access-operation.schema.json', set: { '/operation/op': 'epoch.rotate', '/operation/body': { transition: { newEpoch: 1, keyOpDigest: digestU(welcome), succeeds: [genesis.id] } } }, at: '$.operation.op: const mismatch' },
  { name: 'operation-not-member-add', rules: R(3350, 3300), artifact: 'payload', schema: 'payload-access-operation.schema.json', set: { '/operation/op': 'member.remove' }, at: '$.operation.op: const mismatch' },
  { name: 'operation-member-leave', rules: R(6020, 3350), artifact: 'payload', schema: 'payload-access-operation.schema.json', set: { '/operation/op': 'member.leave', '/operation/body': {} }, at: '$.operation.op: const mismatch' },
  { name: 'operation-group-dissolve', rules: R(6020, 3350), artifact: 'payload', schema: 'payload-access-operation.schema.json', set: { '/operation/op': 'group.dissolve', '/operation/body': {} }, at: '$.operation.op: const mismatch' },
  { name: 'removal-notice-as-payload', rules: R(3520), artifact: 'payload', schema: 'payload-access-operation.schema.json', set: { '/operation': removal }, at: '$.operation.op: const mismatch' },
  { name: 'payload-without-welcome', rules: R(3315, 3350), artifact: 'payload', schema: 'payload-access-operation.schema.json', delete: ['/welcome'], at: '$: missing required welcome' },
  { name: 'admission-without-accept', rules: R(3200, 3205, 3380), artifact: 'payload', schema: 'payload-access-operation.schema.json', delete: ['/operation/body/admission/accept'], at: '$.operation.body.admission: missing required accept' },
  { name: 'admission-accept-without-proof', rules: R(3200, 3205, 3380, 3260), artifact: 'payload', schema: 'payload-access-operation.schema.json', delete: ['/operation/body/admission/accept/proof'], at: '$.operation.body.admission.accept: missing required proof' },
  { name: 'admission-invite-with-document-proof', rules: R(3380, 2150, 3080), artifact: 'payload', schema: 'payload-access-operation.schema.json', set: { '/operation/body/admission/invite/proof': clone(accDoc.proof) }, at: '$.operation.body.admission.invite.proof: schema false' },
  { name: 'admission-added-by', rules: R(3405), artifact: 'payload', schema: 'payload-access-operation.schema.json', set: { '/operation/body/addedBy': founder }, at: '$.operation.body: additionalProperty addedBy' },
  { name: 'proof-65-signatures', rules: R(3355), artifact: 'payload', schema: 'payload-access-operation.schema.json', set: { '/operation/proof/signatures': sigs65 }, at: '$.operation.proof.signatures: maxItems' },
  { name: 'proof-17-credentials', rules: R(3355), artifact: 'payload', schema: 'payload-access-operation.schema.json', set: { '/operation/proof/mechanism': 'composite', '/operation/proof/credentials': [vouch] }, fill: { '/operation/proof/credentials': 17 }, at: '$.operation.proof.credentials: maxItems' },
  { name: 'invite-carries-key-material', rules: R(3005, 3010), artifact: 'invitePayload', schema: 'payload-membership-invite.schema.json', set: { '/invite/credentialSubject/material': clone(welcome.material) }, at: '$.invite.credentialSubject: additionalProperty material' },
  { name: 'invite-carries-operation', rules: R(3005, 3010), artifact: 'invitePayload', schema: 'payload-membership-invite.schema.json', set: { '/invite/credentialSubject/operation': operation.id }, at: '$.invite.credentialSubject: additionalProperty operation' },
  { name: 'invite-type-without-membership-invite', rules: R(3015, 3010), artifact: 'invitePayload', schema: 'payload-membership-invite.schema.json', set: { '/invite/type': ['VerifiableCredential', 'DTGCredential', 'InvitationCredential'] }, at: '$.invite.type' },
  { name: 'invite-context-order', rules: R(3015, 3010), artifact: 'invitePayload', schema: 'payload-membership-invite.schema.json', set: { '/invite/@context': [DTG.invite.payload.invite['@context'][1], DTG.invite.payload.invite['@context'][0], DTG.invite.payload.invite['@context'][2]] }, at: '$.invite.@context' },
  { name: 'invite-name-over-bound', rules: R(3065), artifact: 'invitePayload', schema: 'payload-membership-invite.schema.json', set: { '/invite/credentialSubject/name': 'x'.repeat(201) }, at: '$.invite.credentialSubject.name: maxLength' },
  { name: 'accept-without-candidacy', rules: R(3250), artifact: 'acceptPayload', schema: 'payload-membership-accept.schema.json', delete: ['/accept/candidacy'], at: '$.accept: missing required candidacy' },
  { name: 'accept-candidacy-not-boolean', rules: R(3250), artifact: 'acceptPayload', schema: 'payload-membership-accept.schema.json', set: { '/accept/candidacy': 'yes' }, at: '$.accept.candidacy: type' },
  { name: 'evidence-invite-with-document-proof', rules: R(3710), artifact: 'evidence02', schema: 'payload-membership-evidence.schema.json', set: { '/evidence/invite/proof': clone(accDoc.proof) }, at: '$.evidence.invite.proof: schema false' },
  { name: 'evidence-accept-without-proof', rules: R(3710), artifact: 'evidence02', schema: 'payload-membership-evidence.schema.json', delete: ['/evidence/accept/proof'], at: '$.evidence.accept: missing required proof' },
  { name: 'evidence-0.2-empty-vouches', rules: R(3805), artifact: 'evidence02', schema: 'payload-membership-evidence.schema.json', set: { '/evidence/vouches': [] }, at: '$.evidence.vouches: minItems' },
  { name: 'evidence-0.2-17-vouches', rules: R(3805), artifact: 'evidence02', schema: 'payload-membership-evidence.schema.json', fill: { '/evidence/vouches': 17 }, at: '$.evidence.vouches: maxItems' },
  { name: 'evidence-0.2-vouch-without-proof', rules: R(3805, 3810), artifact: 'evidence02', schema: 'payload-membership-evidence.schema.json', delete: ['/evidence/vouches/0/proof'], at: '$.evidence.vouches[0]: missing required proof' },
  { name: 'evidence-0.1-with-vouches', rules: R(3815), artifact: 'evidence01', schema: 'payload-membership-evidence-0.1.schema.json', set: { '/evidence/vouches': [vouch] }, at: '$.evidence: additionalProperty vouches' },
]

// receiver-check negatives: schema-valid, coherently re-signed where a
// signature covers the changed field; each MUST fail exactly the named
// checks of its predicate and be disposed `expected`
const VF = 'failed(validation-failed)'
const MF = 'failed(malformed)'
// a schema failure is failed(malformed) (Contract 6.2), every later failure failed(validation-failed)
const verdict = (fails) => (fails.includes('schema') ? MF : fails.length ? VF : 'accepted')
const pairCase = (name, rules, o, fails, extra = {}) => ({ name, rules, artifact: pairOf(makePair(o)), fails, expected: verdict(fails), ...extra })
const tamperedAccept = makePair(); tamperedAccept.accDoc.payload.accept.candidacy = false
const tamperedInvite = makePair(); tamperedInvite.invDoc.payload.invite.credentialSubject.note = 'changed after signing'
const withDocProof = makePair(); withDocProof.invDoc.proof = clone(accDoc.proof)
const padded = makePair(); padded.invDoc.ceremony = { pad: '' }
padded.invDoc.ceremony.pad = 'x'.repeat(16385 - Buffer.byteLength(jcs(padded.invDoc), 'utf8'))
const enacted = makePair(); enacted.invDoc.ceremony = { enactment: digestU(inv) }
const wrapper = makePair(); wrapper.invDoc.id = UUID.other; wrapper.invDoc.issuedAt = '2026-09-02T00:00:00Z'; wrapper.invDoc.ceremony = { step: 1, round: 1 }
const pairNegatives = [
  pairCase('accept-ref-is-document-digest', R(2180, 3230), { ref: digestU(invDoc) }, ['ref']),
  pairCase('invite-for-another-subject', R(3225), { subject: third }, ['subject']),
  pairCase('accept-for-another-group', R(3215), { acceptGroup: third }, ['group']),
  pairCase('accept-not-to-inviter', R(3265), { acceptRecipient: third }, ['acceptRecipient']),
  pairCase('accept-on-another-thread', R(3255), { acceptThread: UUID.other }, ['thread']),
  pairCase('invite-document-thread-not-task-context', R(3060, 3075), { invThread: UUID.other, acceptThread: UUID.other }, ['thread']),
  pairCase('invite-validity-inverted', R(3055), { validUntil: '2026-09-01T09:59:00Z', acceptIssued: '2026-09-01T10:03:00Z' }, ['validity']),
  pairCase('accept-after-skew', R(5020, 5050), { acceptIssued: plus(T.validUntil, 301) }, ['skew']),
  pairCase('accept-issued-999ms-past-skew', R(5050), { acceptIssued: '2026-11-30T10:05:00.999Z', acceptCreated: '2026-11-30T10:05:00Z' }, ['skew'], { note: 'issuedAt one millisecond short of a second past validUntil + PT5M: no rounding' }),
  pairCase('accept-proof-created-999ms-past-skew', R(5050), { acceptIssued: '2026-11-30T10:05:00Z', acceptCreated: '2026-11-30T10:05:00.999Z' }, ['skew'], { note: 'proof.created past the window while issuedAt is inside it' }),
  pairCase('invite-document-issuer-not-credential-issuer', R(3020), { invDocIssuer: third }, ['inviteIssuer']),
  pairCase('invite-document-recipient-not-subject', R(3025), { invDocRecipient: third }, ['inviteRecipient']),
  pairCase('accept-proof-under-another-key', R(2140, 2130, 3220), { acceptSigner: founderSeed }, ['acceptProof']),
  pairCase('invite-proof-without-context-copy', R(3070, 2110), { inviteCtxCopy: false }, ['schema', 'inviteProof']),
  pairCase('inviter-card-of-another-anchor', R(3045, 3050, 2250), { founderCard: makeCard(thirdSeed, founderX, T.founderCard) }, ['cards']),
  pairCase('accept-card-of-another-anchor', R(3235, 3240, 3245, 2250), { inviteeCard: makeCard(founderSeed, inviteeX, T.inviteeCard) }, ['cards']),
  pairCase('accept-card-with-delivery-hints', R(2280), { inviteeCard: makeCard(inviteeSeed, inviteeX, T.inviteeCard, { deliveryHints: ['https://relay.example/inbox'] }) }, ['cards']),
  pairCase('accept-card-sent-form', R(2260), { inviteeCard: makeCard(inviteeSeed, inviteeX, T.inviteeCard, { sentTo: founder, boundTo: 'AAAAAAAAAAAAAAAAAAAAAA' }) }, ['cards']),
  { name: 'accept-tampered', rules: R(2130, 3260), artifact: pairOf(tamperedAccept), fails: ['acceptProof'], expected: VF },
  { name: 'invite-tampered', rules: R(2150, 3070), artifact: pairOf(tamperedInvite), fails: ['inviteProof', 'ref'], expected: VF, note: 'the accept still names the credential as signed' },
  { name: 'invite-document-with-proof', rules: R(2150, 3080), artifact: pairOf(withDocProof), fails: ['inviteNoProof', 'schema'], expected: MF },
  pairCase('accept-without-candidacy-signed', R(3250), { noCandidacy: true }, ['schema'], { note: 'a signed accept without candidacy: failed(malformed)' }),
  { name: 'invite-document-with-enactment', rules: R(2170), artifact: pairOf(enacted), fails: ['enactment'], expected: VF, note: 'an invitation credential carries no enactmentBinding, so a present ceremony.enactment cannot recompute (Contract §3) and the document is rejected' },
  pairCase('accept-document-over-budget', R(2200, 2210), { acceptBytes: 16385 }, ['sizes'], { note: 'a signed accept padded through its ceremony to exactly 16385 JCS bytes' }),
  { name: 'invite-document-over-budget', rules: R(2200, 2210), artifact: pairOf(padded), fails: ['sizes'], expected: VF, note: 'padded through ceremony to exactly 16385 JCS bytes' },
]
const pairPositives = [
  pairCase('accept-at-skew-boundary', R(5020, 5050), { acceptIssued: plus(T.validUntil, 300) }, [], { note: 'issuedAt and proof.created = validUntil + 300 s: the last accepted second' }),
  pairCase('accept-at-skew-boundary-with-fraction', R(5050), { acceptIssued: '2026-11-30T10:05:00.000Z', acceptCreated: '2026-11-30T10:05:00Z' }, [], { note: 'validUntil + PT5M exactly, once with and once without a fractional part' }),
  pairCase('accept-ref-as-z', R(3230), { ref: zOf(digestU(inv)) }, [], { note: 'accept.ref in base58btc: the same credential digest by decoded multihash bytes' }),
  pairCase('inviter-card-long-before', R(2290), { founderCardCreated: '2025-01-01T00:00:00Z' }, [], { note: 'a card created 20 months earlier: no freshness requirement' }),
  { name: 'invite-document-wrapper-changed', rules: R(2160), artifact: pairOf(wrapper), fails: [], expected: 'accepted', note: 'id, issuedAt and a ceremony without enactment changed on the unsigned invite document: no verdict changes' },
  pairCase('candidacy-refused', R(3775), { candidacy: false }, [], { surfaceable: false, note: 'a valid pair whose accept refuses candidacy: valid evidence, never surfaceable' }),
]
const vouchPositives = [
  { name: 'vouch-digests-as-z', rules: R(3810), artifact: makeVouch({ accept: zOf(digestU(accDoc)), genesis: zOf(genesisDigest) }), fails: [], expected: 'accepted', note: 'endorsement digests in base58btc: equal by decoded bytes' },
]
const vouchNegatives = [
  { name: 'vouch-for-another-subject', rules: R(3810), artifact: makeVouch({ subject: third }), fails: ['subject'], expected: VF },
  { name: 'vouch-for-another-accept', rules: R(3810), artifact: makeVouch({ accept: digestU(invDoc) }), fails: ['accept'], expected: VF },
  { name: 'vouch-for-another-genesis', rules: R(3810), artifact: makeVouch({ genesis: digestU(accDoc) }), fails: ['genesis'], expected: VF },
  { name: 'vouch-tampered', rules: R(3810), artifact: (() => { const v = makeVouch(); v.credentialSubject.endorsement.provenance = 'introduced'; return v })(), fails: ['proof'], expected: VF },
]
// invitee pre-adoption negatives on the embedded welcome (RLTP-MT-3415):
// mutations of the payload; the invitee's own accept and invite are the
// vector's own
const otherAccept = makePair({ acceptId: UUID.other }).accDoc
const makeAdmissionWelcome = () => ({ ...clone(welcome) })
const otherInvite = makePair({ invThread: UUID.thread, subjectExtra: { note: 'another invite' } }).invDoc
// the document is stored without its payload (it carries `payload`)
const docOnly = (d) => { const { payload: _p, ...rest } = d; return rest }
const inviteeCase = (name, rules, o, fails, extra = {}) => { const a = makeAdmission({ tag: name, ...o }); return { name, rules, payload: a.payload, document: docOnly(a.document), fails, ...extra } }
const wrongId = clone(payload); wrongId.operation.id = 'oid:' + b64u(sha('another operation'))
const wrongSig = clone(payload); wrongSig.operation.proof.signatures[0].sig = 'z' + b58(crypto.sign(null, Buffer.from('other bytes'), privEd(founderSeed)))
const inviteeNegatives = [
  inviteeCase('admission-encloses-another-accept', R(3425), { accept: otherAccept }, ['ownAccept']),
  inviteeCase('admission-encloses-another-invite', R(3430), { invite: otherInvite }, ['ownInvite']),
  inviteeCase('admission-for-another-subject', R(3435), { subject: third }, ['subjectGroup']),
  inviteeCase('admission-in-another-group', R(3435), { group: third }, ['subjectGroup']),
  inviteeCase('welcome-sealed-to-another-own-key', R(3440, 4110), { sealTo: 'other' }, ['sealKey'], { note: 'opens under another key-agreement key the same person holds — rejected all the same' }),
  inviteeCase('welcome-digest-mismatch', R(4080), { admissionWelcome: digestU({ ...welcome, material: { ...welcome.material, epoch: 1 } }) }, ['welcomeDigest']),
  inviteeCase('welcome-for-another-group', R(4090), { welcomeExtra: { group: third } }, ['binding']),
  inviteeCase('welcome-for-another-subject', R(4090), { welcomeExtra: { subject: third } }, ['binding']),
  inviteeCase('welcome-for-another-accept', R(4090), { welcomeAccept: digestU(invDoc) }, ['binding']),
  inviteeCase('admission-added-by-signed', R(3405), { bodyExtra: { addedBy: founder } }, ['schema'], { note: 'a signed, authentic operation whose body asserts addedBy: failed(malformed)' }),
  inviteeCase('welcome-material-unregistered-key', R(3445), { welcomeExtra: { material: { ...welcome.material, keys: { ...welcome.material.keys, history: b64u(contentKeyRaw) } } } }, ['material']),
  { name: 'operation-id-does-not-recompute', rules: R(3335), payload: wrongId, document: docOnly(document), fails: ['id'], note: 'the id field replaced; the signature over the id input stays valid' },
  { name: 'operation-signature-does-not-verify', rules: R(3335), payload: wrongSig, document: docOnly(document), fails: ['sigs'], note: 'a founder signature over other bytes' },
]
// positives: the same digest in its z rendering compares by decoded bytes
const inviteePositives = [
  inviteeCase('admission-welcome-digest-as-z', R(4080), { admissionWelcome: zOf(digestU(makeAdmissionWelcome())) }, []),
  inviteeCase('welcome-accept-as-z', R(4090), { welcomeAccept: zOf(digestU(accDoc)) }, []),
]
const documentNegatives = [
  { name: 'carrier-over-plaintext-limit', rules: R(2220), set: { '/ceremony': { pad: '' } }, padTo: { '/ceremony/pad': 65537 }, fails: ['sizes'], note: 'the complete task padded with x through its ceremony to exactly 65537 JCS bytes, one past the Delivery plaintext limit' },
  { name: 'carrier-issuer-neither-author-nor-signer', rules: R(3330), set: { '/issuer': third }, fails: ['issuer'] },
  { name: 'carrier-with-document-proof', rules: R(3325), set: { '/proof': clone(accDoc.proof) }, fails: ['noProof'] },
  { name: 'carrier-on-another-thread', rules: R(3320), set: { '/threadId': UUID.other }, fails: ['thread'] },
  { name: 'carrier-to-another-recipient', rules: R(3340, 3300), set: { '/recipient': third }, fails: ['recipient'] },
]
const reWelcomeNegatives = [
  { name: 're-welcome-other-genesis', rules: R(3420), set: { '/keyDelivery/genesisDigest': digestU(accDoc) }, fails: ['pin'] },
  { name: 're-welcome-other-group', rules: R(3420), set: { '/keyDelivery/group': third }, fails: ['pin'] },
  { name: 're-welcome-sealed-to-another-own-key', rules: R(3420, 3440), set: { '/keyDelivery/sealed': sealedOtherKey }, fails: ['sealKey'], note: 'opens under another key the same person holds — rejected all the same' },
]
// the invitee's receipt of an invite (RLTP-MT-3030): its own derivation of
// the member anchor from the pinned genesis digest decides, never the channel
const inviteReceiptCases = [
  { name: 'invite-as-sent', rules: R(3030, 8090, 3025), artifact: invDoc, fails: [] },
  { name: 'invite-genesis-digest-as-z', rules: R(3030), artifact: makePair({ genesis: zOf(genesisDigest) }).invDoc, fails: [], note: 'the anchor derives from the canonical u re-encoding' },
  { name: 'invite-for-another-anchor', rules: R(3030, 8090, 3025), artifact: makePair({ subject: third, invDocRecipient: invitee }).invDoc, fails: ['derivation', 'subjectIsRecipient'], note: 'addressed to the invitee, naming an anchor its derivation does not produce' },
  { name: 'invite-under-another-genesis', rules: R(3030, 8090), artifact: makePair({ genesis: digestU(accDoc) }).invDoc, fails: ['derivation'], note: 'the invitee anchor of the real genesis, pinned to a different digest' },
]
const evidenceDocumentNegatives = [
  { name: 'evidence-on-another-thread', rules: R(3715), set: { '/threadId': UUID.other }, fails: ['thread'] },
  { name: 'evidence-with-document-proof', rules: R(3720), set: { '/proof': clone(accDoc.proof) }, fails: ['noProof'] },
]

// rules a case checks only in part move to rulesPartial (conformance/membership-partial.mjs)
for (const list of [negatives, pairNegatives, pairPositives, vouchNegatives, vouchPositives, inviteeNegatives, inviteePositives, documentNegatives, reWelcomeNegatives, evidenceDocumentNegatives, inviteReceiptCases]) {
  for (const c of list) { const { rules, rulesPartial } = splitRules(c.rules); c.rules = rules; if (Object.keys(rulesPartial).length) c.rulesPartial = rulesPartial }
}
const vector = {
  source: 'RLTP Membership Tasks 0.17 (rltp-membership@0.17) over Access Layer 0.54 (wire rltp-access/0.25, rltp-access-material/0.25): one admission chain from a real genesis. Generated by scripts/gen-membership-tasks-vector.mjs (deterministic); re-derived by conformance/runner.mjs. Every case names the RLTP-MT rules it proves completely in `rules` (RLTP-MT-10090), and a rule it checks only in part in `rulesPartial`, with the obligation that stays unchecked; only `rules` counts as coverage. Two genesis fields, serviceIdentity and keyOpDigest, are stand-ins whose derivations the Access vectors own; the runner check that would depend on them is marked [not-proven] and proves no rule.',
  format: {
    inputs: 'vector-only HKDF info strings: founder (the founding context anchor, a stand-in for the nonce-based pair class of RLTP-ACC-3275), founderX, groupDid, third (a third member, the evidence recipient) under the second-party IKM of vectors/dtg-credentials.json; contentKey, ephemeral, nonce (first 12 bytes), inviteeOtherX under the oracle IKM of vectors/identity-derivation.json. The invitee is the oracle under the group/<genesisDigest> context (Access 5.1). serviceIdentity and keyOpDigest of the genesis are stand-ins (Access vectors own their derivations).',
    genesis: 'a group.genesis (rltp-access/0.25) signed by the group DID and the founder; genesisDigest = multibase multihash over its signature input (RLTP-ACC-3030); its id names the first key state (linear/0.1)',
    welcome: 'plaintext, JCS, digest (= operation.body.admission.welcome) and the seal (Contract §5 under HKDF info rltp/v1/welcome, to the accept card)',
    payload: 'the access-operation/0.1 payload; document: the task document carrying it',
    reWelcome: 'the self-contained bootstrap: key-delivery/0.1 kind re-welcome carrying the same welcome seal',
    evidence: 'evidence01 / evidence02 payloads and evidenceDocuments: membership-evidence/0.1 and /0.2 documents from the invitee to a third member',
    negatives: 'declared mutations of one artifact (set: pointer → value; delete: pointers; fill: pointer → n copies of the first element; padTo: pointer to a string → append x until the whole artifact is exactly n JCS bytes) that MUST fail `schema` with an error at `at`; the unmutated artifact passes',
    receiverChecks: 'pairNegatives / pairPositives (evidence pair checks of RLTP-MT-3725), vouchNegatives / vouchPositives (RLTP-MT-3810), inviteeNegatives / inviteePositives (the embedded-welcome checks of RLTP-MT-3415; each a complete task — payload, and the document without its payload — whose operation is re-signed and whose welcome is re-sealed, so it differs in its declared point only), documentNegatives (the carrier document), reWelcomeNegatives (RLTP-MT-3420), evidenceDocumentNegatives, inviteReceiptCases (the own derivation check of the invitee on a received invite, RLTP-MT-3030): each MUST fail exactly the named checks `fails`; a schema failure is disposed failed(malformed), every other failure failed(validation-failed) (Contract 6.2), never acknowledged and with nothing written; positives pass every check. Digests compare as decoded multihash bytes, u and z alike; time windows compare exact RFC 3339 instants, a missing fraction read as .000',
  },
  inputs: INFO,
  parties: { founder, groupDid, invitee, third, inviteeKeyAgreement: mkOf(inviteeX), inviteeOtherKeyAgreement: mkOf(inviteeOtherX) },
  genesis,
  genesisDigest,
  invite: { document: invDoc, credentialDigest: digestU(inv) },
  accept: { document: accDoc, documentDigest: digestU(accDoc) },
  vouch,
  welcome: { plaintext: welcome, plaintextJcs: jcs(welcome), digest: digestU(welcome), sealed },
  payload,
  document,
  reWelcome,
  evidence01,
  evidence02,
  evidenceDocuments,
  validEvidence: [
    { name: 'evidence-0.2-without-vouches', rules: R(3805), delete: ['/evidence/vouches'] },
    { name: 'evidence-0.2-16-vouches', rules: R(3805), fill: { '/evidence/vouches': 16 } },
  ],
  negatives,
  pairNegatives,
  pairPositives,
  vouchNegatives,
  vouchPositives,
  inviteReceiptCases,
  inviteeNegatives,
  inviteePositives,
  documentNegatives,
  reWelcomeNegatives,
  evidenceDocumentNegatives,
}
writeFileSync(join(ROOT, 'vectors/membership-tasks.json'), JSON.stringify(vector, null, 1) + '\n')
console.log(`vectors/membership-tasks.json written; genesis ${genesisDigest}, operation ${operation.id}`)
