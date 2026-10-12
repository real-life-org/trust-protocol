#!/usr/bin/env node
// Generates vectors/dtg-vrc-foreign.json — self-made plain DTG
// RelationshipCredentials (DTG Credentials WD 0.6.0) under did:peer:2
// issuers, for the INFORMATIVE foreign-VRC check of
// conformance/dtg-vrc.mjs. They stand in for another implementation's
// vectors: no RLTP vocabulary, no RLTP context, issuers outside the RLTP
// anchor form. Nothing here is an RLTP wire artifact.
//
// Deterministic vector material only: every key is HKDF-SHA256 over the
// shared oracle IKM (vectors/identity-derivation.json) with an info string
// `rltp/vector/dtg-vrc/<role>`; Ed25519 signatures are deterministic, so
// a re-run reproduces the file byte for byte.
//
// Each negative is signed after its defect is introduced (except where
// the defect IS the signature or its proof configuration), so it fails at
// exactly one check.
//
//   usage: node scripts/gen-dtg-vrc-vectors.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { b58, jcs, sha, hkdf, privEd, privX, pubRaw, didOf } from '../conformance/lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')
const ID = JSON.parse(readFileSync(join(ROOT, 'vectors/identity-derivation.json'), 'utf8'))
const IKM = Buffer.from(ID.rootIkm, 'hex')
const W3C = 'https://www.w3.org/ns/credentials/v2'
const DTG = 'https://registry.trustoverip.org/dtg/context/v1'

const edMk = (seed) => 'z' + b58(Buffer.concat([Buffer.from([0xed, 0x01]), pubRaw(privEd(seed))]))
const xMk = (seed) => 'z' + b58(Buffer.concat([Buffer.from([0xec, 0x01]), pubRaw(privX(seed))]))
// did:peer:2 with an A (assertionMethod) and a V (authentication) entry
// for the same Ed25519 key, then an E (keyAgreement, X25519) entry: #key-1
// is the A entry, #key-2 the V entry, #key-3 the X25519 key
const party = (role) => {
  const ed = hkdf(IKM, `rltp/vector/dtg-vrc/${role}-ed`), x = hkdf(IKM, `rltp/vector/dtg-vrc/${role}-x`)
  return { ed, did: `did:peer:2.A${edMk(ed)}.V${edMk(ed)}.E${xMk(x)}` }
}
const issuer = party('issuer'), subject = party('subject'), other = party('other')
// an issuer whose only signing key is a V (authentication) entry: #key-1
const vOnlyEd = hkdf(IKM, 'rltp/vector/dtg-vrc/v-only-issuer-ed')
const vOnlyDid = `did:peer:2.V${edMk(vOnlyEd)}`
const keyIssuer = hkdf(IKM, 'rltp/vector/dtg-vrc/key-issuer-ed')
const didKeyIssuer = didOf(keyIssuer)

// W3C eddsa-jcs-2022, proof-@context copy
const sign = (body, seed, vm, created = '2026-10-08T12:00:00Z') => {
  const proof = { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', created, verificationMethod: vm, proofPurpose: 'assertionMethod' }
  if (body['@context']) proof['@context'] = body['@context']
  const hashData = Buffer.concat([sha(Buffer.from(jcs(proof), 'utf8')), sha(Buffer.from(jcs(body), 'utf8'))])
  return { ...body, proof: { ...proof, proofValue: 'z' + b58(crypto.sign(null, hashData, privEd(seed))) } }
}
const vrc = (over = {}) => ({
  '@context': [W3C, DTG],
  type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
  issuer: issuer.did,
  issuerScope: 'pairwise',
  validFrom: '2026-10-08T12:00:00Z',
  credentialSubject: { id: subject.did },
  ...over,
})
const without = (o, k) => { const c = { ...o }; delete c[k]; return c }
const vm1 = issuer.did + '#key-1'

const positive = [
  { name: 'did-peer-2-issuer-pairwise', description: 'plain VRC, did:peer:2 issuer and subject (A, V, E entries; one Ed25519 key under A and V), verificationMethod #key-1 = the A entry, proofPurpose assertionMethod', credential: sign(vrc(), issuer.ed, vm1),
    notes: [] },
  { name: 'did-key-issuer-directed', description: 'plain VRC under a did:key issuer declaring directed — permitted for a VRC, pairwise RECOMMENDED', credential: sign(vrc({ issuer: didKeyIssuer, issuerScope: 'directed' }), keyIssuer, `${didKeyIssuer}#${didKeyIssuer.slice(8)}`),
    notes: ['issuerScope directed: permitted for a VRC, pairwise is RECOMMENDED'] },
]
const tampered = sign(vrc(), issuer.ed, vm1); tampered.credentialSubject = { id: other.did }
const longProofCtx = sign(vrc(), issuer.ed, vm1); longProofCtx.proof['@context'] = [W3C, DTG, 'https://example.test/extra']
const negative = [
  { name: 'issuerScope-absent', failsAt: 'issuerScope', credential: sign(without(vrc(), 'issuerScope'), issuer.ed, vm1) },
  { name: 'issuerScope-wrong-case', failsAt: 'issuerScope', credential: sign(vrc({ issuerScope: 'Pairwise' }), issuer.ed, vm1) },
  { name: 'context-wd01-iri', failsAt: 'context', credential: sign(vrc({ '@context': [W3C, 'https://firstperson.network/credentials/dtg/v1'] }), issuer.ed, vm1) },
  { name: 'two-concrete-subtypes', failsAt: 'type', credential: sign(vrc({ type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential', 'MembershipCredential'] }), issuer.ed, vm1) },
  { name: 'validFrom-impossible-day-z', failsAt: 'validFrom', credential: sign(vrc({ validFrom: '2026-02-30T12:00:00Z' }), issuer.ed, vm1) },
  { name: 'validFrom-impossible-day-offset', failsAt: 'validFrom', credential: sign(vrc({ validFrom: '2026-02-30T12:00:00+00:00' }), issuer.ed, vm1) },
  { name: 'validFrom-leap-second-not-end-of-utc-day', failsAt: 'validFrom', credential: sign(vrc({ validFrom: '2026-10-08T12:00:60Z' }), issuer.ed, vm1) },
  { name: 'validUntil-in-leap-second-before-validFrom', failsAt: 'validFrom', credential: sign(vrc({ validFrom: '2017-01-01T00:00:00Z', validUntil: '2016-12-31T23:59:60Z' }), issuer.ed, vm1) },
  { name: 'validUntil-before-validFrom-by-a-nanosecond', failsAt: 'validFrom', credential: sign(vrc({ validFrom: '2026-10-08T12:00:00.000000002Z', validUntil: '2026-10-08T12:00:00.000000001Z' }), issuer.ed, vm1) },
  { name: 'subject-replaced-after-signing', failsAt: 'proof-signature', credential: tampered },
  { name: 'proof-context-longer-than-document', failsAt: 'proof-signature', credential: longProofCtx },
  { name: 'verification-method-is-key-agreement', failsAt: 'proof-key', credential: sign(vrc(), issuer.ed, issuer.did + '#key-3') },
  { name: 'verification-method-is-authentication-key', failsAt: 'proof-key', description: 'A, V, E issuer; the assertionMethod proof names #key-2, the V (authentication) entry, though the same key is also listed under A', credential: sign(vrc(), issuer.ed, issuer.did + '#key-2') },
  { name: 'verification-method-is-authentication-only-did', failsAt: 'proof-key', description: 'issuer did:peer:2 with only a V (authentication) key; it cannot sign an assertionMethod proof', credential: sign(vrc({ issuer: vOnlyDid }), vOnlyEd, vOnlyDid + '#key-1') },
  { name: 'verification-method-of-another-did', failsAt: 'proof-binding', credential: sign(vrc(), other.ed, other.did + '#key-1') },
]

const file = {
  source: 'Self-made plain DTG RelationshipCredentials (DTG Credentials WD 0.6.0) for the INFORMATIVE foreign-VRC check conformance/dtg-vrc.mjs — not RLTP wire artifacts. Keys: HKDF-SHA256(oracle IKM of vectors/identity-derivation.json, "rltp/vector/dtg-vrc/<role>-ed|-x"), vector material only. did:peer:2 parties carry an A entry (Ed25519, #key-1), a V entry (the same key, #key-2) and an E entry (X25519, #key-3); a proof with proofPurpose assertionMethod names the A entry. The issuer of verification-method-is-authentication-only-did has a single V entry. eddsa-jcs-2022 per W3C DI-EDDSA with the proof-@context copy. Every negative fails at exactly the check named in failsAt. Generated by scripts/gen-dtg-vrc-vectors.mjs.',
  parties: { issuer: issuer.did, subject: subject.did, other: other.did, vOnlyIssuer: vOnlyDid, didKeyIssuer },
  positive,
  negative,
}
const text = JSON.stringify(file, null, 2) + '\n'
const path = join(ROOT, 'vectors/dtg-vrc-foreign.json')
if (CHECK) {
  if (readFileSync(path, 'utf8') !== text) { console.error('vectors/dtg-vrc-foreign.json is not what the generator produces'); process.exit(1) }
  console.log('vectors/dtg-vrc-foreign.json reproduces byte for byte')
} else {
  writeFileSync(path, text)
  console.log(`vectors/dtg-vrc-foreign.json: ${positive.length} positive, ${negative.length} negative`)
}
