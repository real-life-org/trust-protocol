#!/usr/bin/env node
// Generates the step credential of vectors/encounter-cards.json in the
// current wire form rltp-encounter-credential/0.26 (Encounter 0.32 §7.2)
// and keeps the same enactment step in the held 0.25 form as
// `credential025` (Encounter §7.3: a credential is never re-issued; the
// 0.25 form stays valid under its own format).
//
// `timestampSpelling` (Encounter 2.3, RLTP-ENC-2150, 2155, 2230): the same
// credential signed with its timestamps in the offset spelling `+00:00`,
// which a reader accepts; its proof and digest run over those bytes, so
// it is a document of its own beside the `Z` spelling. The negatives are
// spellings the schema rejects; the order case is two spellings of one
// whole second whose strings order otherwise.
//
// Deterministic: the issuer key is the pair context of the shared oracle
// (vectors/identity-derivation.json, the relationship-nonce vector whose
// anchor issues the credential); Ed25519 signatures are deterministic, so
// a re-run reproduces the file byte for byte. Before writing, the script
// re-signs the 0.25 form and demands the shipped proofValue — proof that
// it signs with the key the vectors always used.
//
//   usage: node scripts/gen-encounter-credential-vector.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { b58, jcs, sha, hkdf, privEd, didOf } from '../conformance/lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')
const J = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))
const W3C = 'https://www.w3.org/ns/credentials/v2'
const RLTP = 'https://real-life.org/rltp/v1'
const CTX025 = [W3C, 'https://firstperson.network/credentials/dtg/v1', RLTP]
const CTX026 = [W3C, 'https://registry.trustoverip.org/dtg/context/v1', RLTP]

const ID = J('vectors/identity-derivation.json')
const EC = J('vectors/encounter-cards.json')
const held = EC.credential025 ?? EC.credential   // the 0.25 form, wherever it sits
const pair = ID.vectors.find((v) => v.anchor === held.issuer)
const seed = hkdf(Buffer.from(ID.rootIkm, 'hex'), 'rltp/anchor/ed/' + pair.label)
if (didOf(seed) !== held.issuer) throw new Error('issuer seed does not derive the issuer anchor')
const key = privEd(seed)

// W3C eddsa-jcs-2022 with the proof-@context copy (Encounter 2.3)
const sign = (body, created) => {
  const proof = {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-jcs-2022',
    created,
    verificationMethod: `${body.issuer}#${body.issuer.slice('did:key:'.length)}`,
    proofPurpose: 'assertionMethod',
  }
  const cfg = { ...proof, '@context': body['@context'] }
  const hashData = Buffer.concat([sha(Buffer.from(jcs(cfg), 'utf8')), sha(Buffer.from(jcs(body), 'utf8'))])
  return { ...body, proof: { ...proof, proofValue: 'z' + b58(crypto.sign(null, hashData, key)), '@context': body['@context'] } }
}

const s = held.credentialSubject
const subject = (format) => ({ id: s.id, format, ceremony: s.ceremony, challenge: s.challenge, enactmentBinding: s.enactmentBinding })
const types = ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential', 'EncounterCredential']

const re025 = sign({ '@context': CTX025, type: types, issuer: held.issuer, validFrom: held.validFrom, credentialSubject: subject('rltp-encounter-credential/0.25') }, held.proof.created)
if (jcs(re025) !== jcs(held)) throw new Error('re-signing the 0.25 form does not reproduce the shipped credential')

const cred026 = sign({ '@context': CTX026, type: types, issuer: held.issuer, issuerScope: 'pairwise', validFrom: held.validFrom, credentialSubject: subject('rltp-encounter-credential/0.26') }, held.proof.created)

const digestU = (o) => 'u' + Buffer.concat([Buffer.from([0x12, 0x20]), sha(Buffer.from(jcs(o), 'utf8'))]).toString('base64url')
const spelled = (suffix) => {
  const t = cred026.validFrom.replace(/Z$/, suffix)
  const { proof, ...body } = cred026
  const c = sign({ ...body, validFrom: t }, proof.created.replace(/Z$/, suffix))
  return { credential: c, digest: digestU(c) }
}
const timestampSpelling = {
  note: 'Encounter 2.3: a producer writes Z (RLTP-ENC-2150); a reader also accepts +00:00, at most 29 characters, and no other spelling (RLTP-ENC-2155). The accepted credentials are the step credential signed with its timestamps in the offset spelling: they pass 5.6 step 1, their proofs verify and their digests are taken over the received bytes (RLTP-ENC-2140, 2230), so each differs from the digest of `credential` while naming the same whole second (RLTP-ENC-2180). Each negative replaces `credential.validFrom` and is rejected by the schema at 5.6 step 1 (ERR_VERSION). The order case names one whole second in both spellings whose strings order the other way: times are compared as instants, never as strings.',
  accepted: [
    { name: 'offset-spelling', ...spelled('+00:00') },
    { name: 'offset-spelling-with-fraction', ...spelled('.000+00:00') },
  ],
  negative: [
    { name: 'negative-zero-offset', value: '2026-08-23T12:00:00-00:00', expect: 'reject: schema' },
    { name: 'other-offset', value: '2026-08-23T13:00:00+01:00', expect: 'reject: schema' },
    { name: 'offset-without-colon', value: '2026-08-23T12:00:00+0000', expect: 'reject: schema' },
    { name: 'lowercase-z', value: '2026-08-23T12:00:00z', expect: 'reject: schema' },
    { name: 'lowercase-t', value: '2026-08-23t12:00:00Z', expect: 'reject: schema' },
    { name: 'thirty-characters', value: '2026-08-23T12:00:00.0000+00:00', expect: 'reject: schema' },
  ],
  order: { a: '2026-08-23T12:00:00Z', b: '2026-08-23T12:00:00.500+00:00', note: 'one whole second; as strings b < a, though b is the later instant' },
}

const out = {}
for (const [k, v] of Object.entries(EC)) {
  if (k === 'credential025' || k === 'timestampSpelling') continue
  if (k === 'credential') { out.credential = cred026; out.credential025 = held } else out[k] = v
}
out.timestampSpelling = timestampSpelling
out.source = EC.source.replace(/ — the step credential .*$/, '') + ' — the step credential in the current wire form rltp-encounter-credential/0.26 and the same step in the held 0.25 form (credential025), generated by scripts/gen-encounter-credential-vector.mjs'
const text = JSON.stringify(out, null, 2) + '\n'
const path = join(ROOT, 'vectors/encounter-cards.json')
if (CHECK) {
  if (readFileSync(path, 'utf8') !== text) { console.error('vectors/encounter-cards.json is not what the generator produces'); process.exit(1) }
  console.log('vectors/encounter-cards.json reproduces byte for byte')
} else {
  writeFileSync(path, text)
  console.log(`vectors/encounter-cards.json: credential 0.26 (${cred026.proof.proofValue.slice(0, 12)}…), credential025 kept, ${timestampSpelling.accepted.length} offset spellings`)
}
