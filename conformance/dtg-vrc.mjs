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
//   validFrom        an RFC 3339 date-time on a real calendar date, in-range
//                    time and offset; validUntil, if present, too
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
//          (every object typed RelationshipCredential anywhere in a file is
//          checked; a file without one is checked as a single credential)
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

const sameJson = (a, b) => { try { return jcs(a) === jcs(b) } catch { return false } }

// RFC 3339 date-time (upper-case T and Z, any fraction, offset or Z), held
// to a real calendar date and in-range time and offset — Date.parse
// silently normalizes 2026-02-30 to 2026-03-02, so components are checked
// here, not round-tripped through it. Second 60 (leap second) is allowed by
// RFC 3339. Returns { ms } (the instant, fraction included) or null.
const DT = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]+)?(Z|([+-])([0-9]{2}):([0-9]{2}))$/
export function dateTime (v) {
  const m = typeof v === 'string' && DT.exec(v)
  if (!m) return null
  const [Y, M, D, h, mi, s] = m.slice(1, 7).map(Number)
  const leap = (Y % 4 === 0 && Y % 100 !== 0) || Y % 400 === 0
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][M - 1]
  if (!days || D < 1 || D > days || h > 23 || mi > 59 || s > 60) return null
  let off = 0
  if (m[8] !== 'Z') {
    const oh = Number(m[10]), om = Number(m[11])
    if (oh > 23 || om > 59) return null
    off = (m[9] === '-' ? -1 : 1) * (oh * 60 + om)
  }
  const d = new Date(0)
  d.setUTCFullYear(Y, M - 1, D) // not Date.UTC: it maps years 0–99 to 1900–1999
  d.setUTCHours(h, mi - off, s)
  return { ms: d.getTime() + (m[7] ? Number('0' + m[7]) * 1000 : 0) }
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

  const from = dateTime(cred.validFrom), until = cred.validUntil === undefined ? undefined : dateTime(cred.validUntil)
  step('validFrom', !!from && until !== null && (until === undefined || until.ms >= from.ms),
    `validFrom (and validUntil, if present) must be RFC 3339 date-times with a valid calendar date and time, validUntil not before validFrom`)
  if (from && /Z$/.test(cred.validFrom) && !calOK(cred.validFrom)) notes.push('validFrom carries more than three fractional digits, outside the RLTP timestamp profile; not a DTG requirement')

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
  const pctx = cfg['@context']
  const ctxPrefix = pctx === undefined || (Array.isArray(pctx) && Array.isArray(ctx) && pctx.length <= ctx.length && pctx.every((c, i) => sameJson(c, ctx[i])))
  let sigOk = false, detail = 'proof @context is not a prefix of the document @context'
  if (ctxPrefix) {
    // canonicalization errors are this credential's failure, never the batch's
    try {
      const hashData = Buffer.concat([sha(Buffer.from(jcs(cfg), 'utf8')), sha(Buffer.from(jcs(unsecured), 'utf8'))])
      sigOk = verifySig(key.raw, hashData, proofValue)
      detail = 'Ed25519 signature over the eddsa-jcs-2022 hash data does not verify'
    } catch (e) { detail = `cannot canonicalize the credential for eddsa-jcs-2022: ${e.message}` }
  }
  step('proof-signature', ctxPrefix && sigOk, detail)
  return { ok: failures.length === 0, failures, passed, notes }
}

// every object in a vector file that types itself a RelationshipCredential
// (a file may hold one credential, an array, or a vector suite of its own
// shape); a found credential is not searched further
export const collect = (node, out = []) => {
  if (Array.isArray(node)) { for (const n of node) collect(n, out) }
  else if (node && typeof node === 'object') {
    if (Array.isArray(node.type) && node.type.includes('RelationshipCredential')) out.push(node)
    else for (const v of Object.values(node)) collect(v, out)
  }
  return out
}

// ── CLI ───────────────────────────────────────────────────────────────────
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const files = process.argv.slice(2)
  if (!files.length) { console.error('usage: node conformance/dtg-vrc.mjs <file.json> [...]'); process.exit(2) }
  let bad = 0
  for (const f of files) {
    const data = JSON.parse(readFileSync(f, 'utf8'))
    const found = collect(data)
    const creds = found.length ? found : [data]
    creds.forEach((c, i) => {
      let r
      try { r = checkVrc(c) } catch (e) { r = { ok: false, failures: [{ check: 'form', detail: `the check could not complete: ${e.message}` }], notes: [] } }
      const label = `${f}${creds.length > 1 ? `[${i}]` : ''} (${c?.issuer ?? '?'})`
      if (r.ok) console.log(`  ok    ${label}: plain DTG RelationshipCredential, issuerScope ${c.issuerScope}, eddsa-jcs-2022 proof verifies`)
      else { bad++; for (const x of r.failures) console.error(`  FAIL  ${label}: ${x.check} — ${x.detail}`) }
      for (const n of r.notes) console.log(`  note  ${label}: ${n}`)
    })
  }
  console.log(bad ? `\n${bad} credential(s) failed (informative check).` : '\nAll credentials pass the plain DTG RelationshipCredential check (informative).')
  process.exit(bad ? 1 : 0)
}
