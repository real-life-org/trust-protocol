#!/usr/bin/env node
// dtg-vrc.mjs — INFORMATIVE test tool: checks a foreign, plain DTG
// RelationshipCredential (DTG Credentials WD 0.6.0) the way a verifier
// that knows nothing of RLTP would.
//
// What it checks, in this order (the first failing check is the verdict):
//   context          @context[0] = W3C VC v2, @context[1] = the DTG v1
//                    context IRI, exact bytes (Base Structure)
//   type             VerifiableCredential + DTGCredential + exactly one
//                    concrete DTG subtype, and that subtype is
//                    RelationshipCredential (Base Structure, VRC);
//                    further, non-DTG hint types are allowed
//   issuer           a DID string
//   issuerScope      present, exactly one of pairwise|directed|public,
//                    case-sensitive (Base Structure: a verifier MUST
//                    reject absence or another value)
//   validFrom        an RFC 3339 date-time; validUntil, if present, too
//   subject          credentialSubject.id is a DID string
//   proof-form       DataIntegrityProof, cryptosuite eddsa-jcs-2022 (the
//                    only suite this tool verifies), proofValue present
//   proof-binding    the verificationMethod's DID is the issuer
//   proof-key        the verificationMethod resolves, without network, to
//                    an Ed25519 key of the issuer: did:key (fragment = the
//                    method-specific id), or did:peer:2 (fragment #key-N
//                    over the key entries in order, or the key's own
//                    multibase value; the entry is purpose V or A and an
//                    Ed25519 Multikey z6Mk…)
//   proof-signature  W3C eddsa-jcs-2022 verification from the embedded
//                    proof alone; a proof @context must be a prefix of the
//                    document @context
//
// What it does NOT do: it makes no claim about which DID methods RLTP
// accepts (Encounter 2.3 binds RLTP anchors to did:key; this tool is for
// reading other implementations' vectors), it does not check validity
// windows against a clock, status, edge verifiability, or any RLTP rule.
// Deviations that a strict verifier might reject but this tool tolerates
// are reported as notes, never silently.
//
//   usage: node conformance/dtg-vrc.mjs <file.json> [...]
//          (a file holds one credential, an array of them, or an object
//          whose `credentials` member is such an array)
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import crypto from 'node:crypto'
import { b58, fromB58, jcs, sha, calOK, EDS, pubFromRaw } from './lib.mjs'

export const W3C_V2 = 'https://www.w3.org/ns/credentials/v2'
export const DTG_V1 = 'https://registry.trustoverip.org/dtg/context/v1'
export const DTG_CONCRETE = ['MembershipCredential', 'RelationshipCredential', 'DelegationCredential', 'InvitationCredential', 'PersonaCredential', 'StatementCredential', 'AuthorityCredential']
export const SCOPES = ['pairwise', 'directed', 'public']
const DID = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/

// multibase base58btc Multikey → { codec, raw }; Ed25519 = 0xed 0x01, X25519 = 0xec 0x01
const multikey = (mb) => {
  if (typeof mb !== 'string' || mb[0] !== 'z') return null
  const b = fromB58(mb.slice(1))
  if (!b || b.length !== 34 || 'z' + b58(b) !== mb) return null
  if (b[0] === 0xed && b[1] === 0x01) return { codec: 'ed25519-pub', raw: b.subarray(2) }
  if (b[0] === 0xec && b[1] === 0x01) return { codec: 'x25519-pub', raw: b.subarray(2) }
  return { codec: 'other', raw: null }
}

// did:peer:2 (numalgo 2): 'did:peer:2' ('.' purpose multibase-value)+;
// purpose S carries a base64url service and is not a key. Key entries are
// numbered #key-1, #key-2, … in order of appearance.
export function parseDidPeer2 (did) {
  if (typeof did !== 'string' || !did.startsWith('did:peer:2.')) return null
  const parts = did.slice('did:peer:2.'.length).split('.')
  const keys = []
  for (const p of parts) {
    if (p.length < 2) return null
    const purpose = p[0], value = p.slice(1)
    if (purpose === 'S') continue
    if (!'AEVID'.includes(purpose)) return null
    const k = multikey(value)
    if (!k) return null
    keys.push({ purpose, mb: value, ...k, id: '#key-' + (keys.length + 1) })
  }
  return keys.length ? { keys } : null
}

// verificationMethod → { raw } of an Ed25519 key, or { error }; notes collect tolerances
export function resolveVm (vm, notes = []) {
  if (typeof vm !== 'string' || !vm.includes('#')) return { error: 'verificationMethod is not a DID URL with a fragment' }
  const i = vm.indexOf('#'), did = vm.slice(0, i), frag = vm.slice(i)
  if (did.startsWith('did:key:')) {
    const id = did.slice('did:key:'.length)
    if (frag !== '#' + id) return { error: 'did:key fragment is not the method-specific identifier' }
    const k = multikey(id)
    if (!k || k.codec !== 'ed25519-pub') return { error: 'did:key does not encode an Ed25519 key' }
    return { raw: k.raw }
  }
  if (did.startsWith('did:peer:2.')) {
    const doc = parseDidPeer2(did)
    if (!doc) return { error: 'did:peer:2 does not parse' }
    const k = doc.keys.find((x) => x.id === frag || '#' + x.mb === frag)
    if (!k) return { error: `did:peer:2 has no key ${frag}` }
    if (k.codec !== 'ed25519-pub') return { error: `${frag} is a ${k.codec} key, not Ed25519` }
    if (k.purpose !== 'V' && k.purpose !== 'A') return { error: `${frag} has purpose ${k.purpose}, neither V nor A` }
    if (k.purpose === 'V') notes.push(`${frag} is a V (authentication) entry used for an assertionMethod proof; a verifier that enforces the proof purpose against the resolved document would require an A entry`)
    if ('#' + k.mb === frag) notes.push(`${frag} names the key by its multibase value rather than #key-N`)
    return { raw: k.raw }
  }
  return { error: `DID method of ${did} is not resolvable offline by this tool` }
}

const verifySig = (raw, bytes, zsig) => {
  if (typeof zsig !== 'string' || zsig[0] !== 'z') return false
  const sig = fromB58(zsig.slice(1))
  if (!sig || sig.length !== 64) return false
  return crypto.verify(null, bytes, pubFromRaw(Buffer.from(raw), EDS), sig)
}

/** Check a foreign DTG RelationshipCredential. Returns { ok, failures: [{ check, detail }], passed: [check], notes: [string] }. */
export function checkVrc (cred) {
  const failures = [], passed = [], notes = []
  const step = (check, cond, detail) => { if (cond) passed.push(check); else failures.push({ check, detail }) }
  const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o)
  if (!isObj(cred)) return { ok: false, failures: [{ check: 'form', detail: 'not a JSON object' }], passed, notes }

  const ctx = cred['@context']
  step('context', Array.isArray(ctx) && ctx[0] === W3C_V2 && ctx[1] === DTG_V1,
    `@context must start with ${W3C_V2}, ${DTG_V1}; got ${JSON.stringify(ctx)}`)

  const t = cred.type
  const concrete = Array.isArray(t) ? t.filter((x) => DTG_CONCRETE.includes(x)) : []
  step('type', Array.isArray(t) && t.includes('VerifiableCredential') && t.includes('DTGCredential') && concrete.length === 1 && concrete[0] === 'RelationshipCredential',
    `type must carry VerifiableCredential, DTGCredential and exactly one concrete subtype, RelationshipCredential; got ${JSON.stringify(t)}`)
  if (Array.isArray(t)) {
    const hints = t.filter((x) => !['VerifiableCredential', 'DTGCredential', ...DTG_CONCRETE].includes(x))
    if (hints.length) notes.push(`non-DTG type(s) ${hints.join(', ')} read as non-authoritative hints`)
  }

  step('issuer', typeof cred.issuer === 'string' && DID.test(cred.issuer), `issuer must be a DID string; got ${JSON.stringify(cred.issuer)}`)
  step('issuerScope', typeof cred.issuerScope === 'string' && SCOPES.includes(cred.issuerScope),
    `issuerScope must be exactly one of ${SCOPES.join('|')}; got ${JSON.stringify(cred.issuerScope)}`)
  if (cred.issuerScope && cred.issuerScope !== 'pairwise' && SCOPES.includes(cred.issuerScope)) notes.push(`issuerScope ${cred.issuerScope}: permitted for a VRC, pairwise is RECOMMENDED`)

  const timeOk = (v) => typeof v === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$/.test(v) && !Number.isNaN(Date.parse(v))
  step('validFrom', timeOk(cred.validFrom) && (cred.validUntil === undefined || (timeOk(cred.validUntil) && Date.parse(cred.validUntil) >= Date.parse(cred.validFrom))),
    `validFrom (and validUntil, if present) must be RFC 3339 date-times, validUntil not before validFrom`)
  if (typeof cred.validFrom === 'string' && /Z$/.test(cred.validFrom) && !calOK(cred.validFrom)) notes.push('validFrom is outside the RLTP timestamp profile (more than three fractional digits or calendar-invalid); not a DTG requirement')

  step('subject', isObj(cred.credentialSubject) && typeof cred.credentialSubject.id === 'string' && DID.test(cred.credentialSubject.id),
    'credentialSubject.id must be a DID string')

  const proof = cred.proof
  const formOk = isObj(proof) && proof.type === 'DataIntegrityProof' && proof.cryptosuite === 'eddsa-jcs-2022' && typeof proof.proofValue === 'string' && typeof proof.verificationMethod === 'string'
  step('proof-form', formOk, `proof must be a DataIntegrityProof with cryptosuite eddsa-jcs-2022 (the suite this tool verifies); got ${JSON.stringify(isObj(proof) ? { type: proof.type, cryptosuite: proof.cryptosuite } : proof)}`)
  if (!formOk) return { ok: false, failures, passed, notes }
  if (proof.proofPurpose !== 'assertionMethod') notes.push(`proofPurpose ${JSON.stringify(proof.proofPurpose)}; DTG examples use assertionMethod`)

  const vmDid = proof.verificationMethod.split('#')[0]
  step('proof-binding', vmDid === cred.issuer, `verificationMethod DID ${vmDid} is not the issuer ${cred.issuer}`)
  const key = resolveVm(proof.verificationMethod, notes)
  step('proof-key', !!key.raw, key.error)
  if (!key.raw) return { ok: false, failures, passed, notes }

  // W3C eddsa-jcs-2022 verification: proofConfig = embedded proof minus
  // proofValue; a proof @context must be a prefix of the document's
  const { proof: _p, ...unsecured } = cred
  const { proofValue, ...cfg } = proof
  const ctxPrefix = cfg['@context'] === undefined || (Array.isArray(cfg['@context']) && Array.isArray(ctx) && cfg['@context'].every((c, i) => jcs(c) === jcs(ctx[i])))
  const hashData = Buffer.concat([sha(Buffer.from(jcs(cfg), 'utf8')), sha(Buffer.from(jcs(unsecured), 'utf8'))])
  step('proof-signature', ctxPrefix && verifySig(key.raw, hashData, proofValue),
    ctxPrefix ? 'Ed25519 signature over the eddsa-jcs-2022 hash data does not verify' : 'proof @context is not a prefix of the document @context')
  return { ok: failures.length === 0, failures, passed, notes }
}

// ── CLI ───────────────────────────────────────────────────────────────────
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const files = process.argv.slice(2)
  if (!files.length) { console.error('usage: node conformance/dtg-vrc.mjs <file.json> [...]'); process.exit(2) }
  let bad = 0
  for (const f of files) {
    const data = JSON.parse(readFileSync(f, 'utf8'))
    const creds = Array.isArray(data) ? data : Array.isArray(data?.credentials) ? data.credentials : [data]
    creds.forEach((c, i) => {
      const r = checkVrc(c)
      const label = `${f}${creds.length > 1 ? `[${i}]` : ''} (${c?.issuer ?? '?'})`
      if (r.ok) console.log(`  ok    ${label}: plain DTG RelationshipCredential, issuerScope ${c.issuerScope}, eddsa-jcs-2022 proof verifies`)
      else { bad++; for (const x of r.failures) console.error(`  FAIL  ${label}: ${x.check} — ${x.detail}`) }
      for (const n of r.notes) console.log(`  note  ${label}: ${n}`)
    })
  }
  console.log(bad ? `\n${bad} credential(s) failed (informative check).` : '\nAll credentials pass the plain DTG RelationshipCredential check (informative).')
  process.exit(bad ? 1 : 0)
}
