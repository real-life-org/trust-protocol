#!/usr/bin/env node
// RLTP conformance runner — executes the shipped vectors as a live test
// suite. Zero dependencies (node:crypto only), like scripts/validate.mjs.
//
// Division of labour:
//   scripts/validate.mjs   casting-time coherence (prose ↔ schemas ↔ archive)
//   conformance/runner.mjs vector conformance: every cryptographic claim of
//                          the vector files is recomputed from the documented
//                          inputs; every schema claim is validated against the
//                          shipped schemas; every negative must fail at its
//                          declared stage. An implementation under test can
//                          later reuse exactly these checks against its own
//                          output (the simulator is the first candidate).
//
//   usage: node conformance/runner.mjs
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0, fail = 0
// `--coverage membership` prints the RLTP-MT identifiers the passing
// checks prove, one per line, and nothing else (scripts/check-encounter-trace.mjs
// --layer membership --coverage)
const ARGS = process.argv.slice(2)
if (!(ARGS.length === 0 || (ARGS.length === 2 && ARGS[0] === '--coverage'))) {
  console.error('usage: node conformance/runner.mjs [--coverage membership]')
  process.exit(2)
}
const COVERAGE = ARGS[0] === '--coverage' ? ARGS[1] : null
const out = COVERAGE ? () => {} : (m) => console.log(m)
const PROVEN = new Set()
const PARTLY = new Map() // rule → the obligation left unchecked
const ok = (m) => { pass++; out(`  ok    ${m}`) }
const err = (m) => { fail++; console.error(`  FAIL  ${m}`) }
const check = (cond, m) => (cond ? ok(m) : err(m))
// a check that proves the rules it names; a failing one proves nothing
// rules the vectors check only in part (conformance/membership-partial.mjs)
// are recorded as partial, never as proven
const checkR = (rules, cond, m) => {
  const r = [].concat(rules)
  if (cond) for (const id of r) { if (PARTIAL[id]) PARTLY.set(id, PARTIAL[id]); else PROVEN.add(id) }
  const full = r.filter((id) => !PARTIAL[id]); const part = r.filter((id) => PARTIAL[id])
  return check(cond, `${m} [${full.join(', ')}${part.length ? (full.length ? '; ' : '') + 'partially ' + part.join(', ') : ''}]`)
}
const section = (t) => out(`\n── ${t}`)
const J = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))

import {
  b58, fromB58, jcs, sha, hkdf, hmacU, digestU, privX, pubFromRaw, xRawOfMk,
  pubRaw, didOf, mkOf, ecdhRaw, ecdh, verifyRaw, diVerify, SCHEMAS, validate, XS, privEd,
} from './lib.mjs'
import { PARTIAL } from './membership-partial.mjs'

const schemaOK = (data, file, label) => {
  const s = SCHEMAS[file]; const errs = validate(data, s, s)
  check(errs.length === 0, `${label} valid against ${file}${errs.length ? ' — ' + errs[0] : ''}`)
  return errs.length === 0
}
const schemaFails = (data, file, label) => {
  const s = SCHEMAS[file]; const errs = validate(data, s, s)
  check(errs.length > 0, `${label} rejected by ${file}`)
}

// anchor-rotation@1 (Network Visibility 0.30 §6.5), independently: schema,
// generation domain [2, 2^53 − 1] (Identity 0.52 §5.4), raw Ed25519 under
// prev (proofValue) and under next (successorProofValue) over JCS(body)
const GENERATION_MAX = 9007199254740991n
const rotationOK = (a) => {
  const s = SCHEMAS['visibility-anchor-rotation.schema.json']
  if (validate(a, s, s).length) return false
  const g = BigInt(a.body.generation)
  if (g < 2n || g > GENERATION_MAX) return false
  const bytes = Buffer.from(jcs(a.body), 'utf8')
  return verifyRaw(a.body.prev, bytes, a.proof.proofValue) && verifyRaw(a.body.next, bytes, a.proof.successorProofValue)
}
// the generation row of the closed registry (Identity 0.52 §6.1)
const generationLabel = (l) => {
  const m = /^group\/(u[A-Za-z0-9_-]{45}[AQgw])\/([1-9][0-9]{0,15})$/.exec(l)
  return !!m && BigInt(m[2]) >= 2n && BigInt(m[2]) <= GENERATION_MAX
}
// an Access envelope's id input: JCS with id empty and proof omitted (RLTP-ACC-3100)
const opInput = (op) => Buffer.from(jcs({ ...Object.fromEntries(Object.entries(op).filter(([k]) => k !== 'proof')), id: '' }), 'utf8')
const mhU = (bytes) => 'u' + Buffer.concat([Buffer.from([0x12, 0x20]), sha(bytes)]).toString('base64url')

// ── suite 1: identity derivation oracle ──────────────────────────────────
section('identity-derivation.json — every derivation recomputes')
const ID = J('vectors/identity-derivation.json')
const IKM = Buffer.from(ID.rootIkm, 'hex')
for (const v of ID.vectors) {
  const edInfo = v.edInfo || 'rltp/anchor/ed/' + v.label
  const xInfo = v.xInfo || 'rltp/anchor/x/' + v.label
  const ed = hkdf(IKM, edInfo), x = hkdf(IKM, xInfo)
  check(ed.toString('hex') === v.edSeed && x.toString('hex') === v.xSeed, `${v.label}: seeds`)
  check(didOf(ed) === v.anchor && mkOf(x) === v.keyAgreement, `${v.label}: anchor + keyAgreement`)
  if (v.relationshipNonce) {
    const l = 'pair/u' + Buffer.concat([Buffer.from([0x12, 0x20]), sha(Buffer.from(v.relationshipNonce, 'hex'))]).toString('base64url')
    check(l === v.label, `${v.label}: label = multihash(nonce)`)
  }
}

// the community anchor's generations (Identity 0.52 §5.4, §6.1): the label
// string is the whole derivation context; /1, /01, /0 and 2^53 are no labels
{
  const gen = ID.vectors.filter((v) => /^group\/[^/]+\//.test(v.label))
  check(gen.length >= 2 && gen.every((v) => generationLabel(v.label) && !v.edInfo && !v.xInfo), `community anchor generations: ${gen.length} labels of the form group/<digest>/<generation>, derived on the ordinary rltp/anchor path`)
  const base = ID.vectors.find((v) => v.label === 'group/' + ID.genesisDigestSample)
  check(gen.every((v) => v.label.startsWith(base.label + '/') && v.anchor !== base.anchor), 'every generation of group/<D> is a distinct anchor of the same digest')
  const rej = ID.rejects.filter((r) => /^group\/[^/]+\//.test(r.label))
  for (const r of rej) check(!generationLabel(r.label), `generation grammar rejects ${r.label.slice(r.label.lastIndexOf('/'))}: ${r.reason}`)
  check(['/1', '/01', '/0', '/9007199254740992'].every((g) => rej.some((r) => r.label.endsWith(g))), 'the four generation rejects of Identity §16 are shipped')
}

// carrier-relationship identities (Identity 7a): Ed25519-only, two
// length-fixed digest inputs, one principal per (relationship × carrier).
if (ID.carrierRelationship) {
  const CR = ID.carrierRelationship
  const mh = (b) => 'u' + Buffer.concat([Buffer.from([0x12, 0x20]), sha(b)]).toString('base64url')
  const N = Buffer.from(CR.relationshipNonce, 'hex')
  check(N.length === 32, 'carrier-relationship: the relationship nonce is 32 bytes')
  check(mh(N) === CR.relationshipDigest, 'carrier-relationship: Dn = multihash of the 32 nonce bytes')
  const seen = new Set()
  for (const c of CR.cases) {
    const Dc = mh(Buffer.from(c.carrier, 'utf8'))
    const info = CR.prefix + Dc + CR.relationshipDigest
    check(Dc === c.carrierDigest, `carrier-relationship [${c.carrier}]: Dc = multihash of the UTF-8 carrier identifier`)
    check(Dc.length === 47 && CR.relationshipDigest.length === 47, `carrier-relationship [${c.carrier}]: both info parts are 47 characters (length-fixed, 7a.4)`)
    check(info === c.info, `carrier-relationship [${c.carrier}]: info = prefix || Dc || Dn`)
    const seed = hkdf(IKM, info)
    check(seed.toString('hex') === c.edSeed, `carrier-relationship [${c.carrier}]: seed`)
    check(didOf(seed) === c.principal, `carrier-relationship [${c.carrier}]: principal`)
    // 7a.1 — Ed25519-only: the vector asserts the ABSENCE of a key-agreement key
    check('keyAgreement' in c && c.keyAgreement === null,
      `carrier-relationship [${c.carrier}]: no key-agreement key is derived for this class (declared null, not merely omitted)`)
    seen.add(c.principal)
  }
  check('keyAgreement' in CR && CR.keyAgreement === null,
    'carrier-relationship: the class itself declares keyAgreement null — Ed25519-only, sealing stays at the rkid (7a.1)')
  check(seen.size === CR.cases.length, 'carrier-relationship: every case yields a distinct principal (byte-exactness, per-carrier separation)')

  // Identity 7a.2 — the ordered validation pipeline for C (no normalization step)
  const G = CR.identifierGrammar
  if (G) {
    const wellFormed = (s) => {
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i)
        if (c >= 0xd800 && c <= 0xdbff) { const n = s.charCodeAt(i + 1); if (!(n >= 0xdc00 && n <= 0xdfff)) return false; i++ }
        else if (c >= 0xdc00 && c <= 0xdfff) return false
      }
      return true
    }
    // 7a.2 step 4 runs against the SHIPPED Unicode 15.0 ranges, never the runtime's tables
    const parseRanges = (list) => list.map((r) => {
      const [a, b] = r.split('-')
      return [parseInt(a, 16), parseInt(b === undefined ? a : b, 16)]
    })
    const PIN = G.unicodePin
    const pinned = PIN ? [].concat(parseRanges(PIN.cc), parseRanges(PIN.cf), parseRanges(PIN.whiteSpace)) : null
    const inPinned = (cp) => pinned.some(([a, b]) => cp >= a && cp <= b)
    const validId = (s) => {
      if (typeof s !== 'string' || !wellFormed(s)) return false
      const b = Buffer.from(s, 'utf8')
      if (b.length < 1 || b.length > G.maxBytes) return false
      if (!pinned) return !/[\p{Cc}\p{Cf}\p{White_Space}]/u.test(s)
      for (const ch of s) if (inPinned(ch.codePointAt(0))) return false
      return true
    }
    // strict UTF-8 decode for byte inputs (7a.2 step 1): overlong, truncated, surrogate-encoded, out of range
    const decodeStrict = (buf) => {
      try { return new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch { return null }
    }
    const principalOf = (s) => didOf(hkdf(IKM, CR.prefix + mh(Buffer.from(s, 'utf8')) + CR.relationshipDigest))
    for (const s of G.accepts) check(validId(s), `carrier identifier grammar accepts ${JSON.stringify(s)}`)
    for (const r of G.rejects) {
      const s = r.repeat ? r.repeat.char.repeat(r.repeat.count)
        : r.valueEscaped !== undefined ? JSON.parse('"' + r.valueEscaped + '"') : r.value
      check(!validId(s), `carrier identifier grammar rejects: ${r.reason}`)
    }
    const [nfcForm, nfdForm] = G.nfcPair
    check(nfcForm !== nfdForm && validId(nfcForm) && validId(nfdForm) && principalOf(nfcForm) !== principalOf(nfdForm),
      'carrier identifier: no normalization — NFC and NFD spellings are two carriers with two principals (7a.2)')

    if (PIN) {
      check(PIN.version === '15.0', 'carrier identifier: the shipped property pin declares Unicode 15.0')
      // the pin must be self-consistent and must be what the checks above used
      check(pinned.every(([a, b]) => a <= b && b <= 0x10ffff), 'carrier identifier: pinned ranges are well formed')
      check(inPinned(0x00ad) && inPinned(0x200d) && inPinned(0x0007) && inPinned(0x3000) && !inPinned(0x0041),
        'carrier identifier: the pinned set covers Cf (00AD, 200D), Cc (0007) and White_Space (3000) and not ordinary letters')
    }
    for (const r of G.rawByteRejects || []) {
      const buf = Buffer.from(r.bytesHex, 'hex')
      const s = decodeStrict(buf)
      check(s === null || !validId(s), `carrier identifier raw bytes rejected: ${r.reason}`)
    }
    for (const a of G.rawByteAccepts || []) {
      const s = decodeStrict(Buffer.from(a.bytesHex, 'hex'))
      check(s !== null && validId(s), `carrier identifier raw bytes accepted: ${a.reason}`)
    }
  }

  // m-1 (round 2): the relationship axis — same carrier, a second nonce
  const AX = CR.relationshipAxisCase
  if (AX) {
    const N2 = Buffer.from(AX.nonce, 'hex')
    check(N2.length === 32, 'carrier-relationship axis: the second relationship nonce is 32 bytes')
    check(mh(N2) === CR.secondRelationshipDigest, 'carrier-relationship axis: Dn of the second nonce')
    const info = CR.prefix + mh(Buffer.from(AX.carrier, 'utf8')) + CR.secondRelationshipDigest
    check(info === AX.info, 'carrier-relationship axis: info = prefix || Dc || Dn(second)')
    const seed = hkdf(IKM, info)
    check(seed.toString('hex') === AX.edSeed, 'carrier-relationship axis: seed')
    check(didOf(seed) === AX.principal, 'carrier-relationship axis: principal')
    check('keyAgreement' in AX && AX.keyAgreement === null,
      'carrier-relationship axis: no key-agreement key for this class either')
    const sameCarrierFirst = CR.cases.find((c) => c.carrier === AX.carrier)
    check(sameCarrierFirst && sameCarrierFirst.principal !== AX.principal,
      'carrier-relationship axis: ONE carrier, two relationship nonces yield two different principals (7a.3)')
  }

  // Identity 7a.3 — the {nonce, generation} convergence rule (rounds 2 and 4)
  const NC = CR.nonceConvergence
  if (NC) {
    // canonical = highest generation; ties by unsigned bytewise-smallest nonce
    const canonicalOf = (entries) => entries.slice().sort((a, b) =>
      (b.generation - a.generation) ||
      Buffer.compare(Buffer.from(a.nonce, 'hex'), Buffer.from(b.nonce, 'hex')))[0]
    const pAt = (hex) => didOf(hkdf(IKM, CR.prefix +
      mh(Buffer.from(NC.carrier, 'utf8')) + mh(Buffer.from(hex, 'hex'))))
    for (const c of NC.cases) {
      check(c.entries.every((e) => Buffer.from(e.nonce, 'hex').length === 32 && Number.isInteger(e.generation) && e.generation >= 1),
        `nonce convergence [${c.case}]: every entry is a 32-byte nonce with a generation >= 1`)
      const w = canonicalOf(c.entries)
      check(w.nonce === c.canonical.nonce && w.generation === c.canonical.generation,
        `nonce convergence [${c.case}]: the declared entry is canonical`)
      // order independence: every permutation of the entry set must agree
      const perms = (xs) => xs.length <= 1 ? [xs]
        : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r]))
      check(perms(c.entries).every((order) => {
        const k = canonicalOf(order)
        return k.nonce === c.canonical.nonce && k.generation === c.canonical.generation
      }), `nonce convergence [${c.case}]: order-independent — every device reaches the same answer`)
      check(pAt(c.canonical.nonce) === c.canonicalPrincipal,
        `nonce convergence [${c.case}]: the canonical entry derives the declared principal`)
      const superseded = c.entries.filter((e) => e.nonce !== c.canonical.nonce || e.generation !== c.canonical.generation)
      check(superseded.length === c.entries.length - 1,
        `nonce convergence [${c.case}]: exactly one canonical entry, every other superseded`)
      check(superseded.every((e) => pAt(e.nonce) !== c.canonicalPrincipal) &&
        c.supersededPrincipals.every((sp) => sp !== c.canonicalPrincipal),
        `nonce convergence [${c.case}]: a superseded entry derives a DIFFERENT principal — an orphan at the carrier, never a collision`)
    }
    // round-6 M-1: generation has a closed, interoperable integer domain
    const GD = NC.generationDomain
    if (GD) {
      const MAXG = Number.MAX_SAFE_INTEGER
      check(GD.min === 1 && GD.max === MAXG,
        'generation domain: [1, 2^53-1] — the largest integer every JSON implementation represents exactly')
      const inDomain = (v) => Number.isSafeInteger(v) && v >= GD.min && v <= GD.max
      for (const v of GD.accepts) check(inDomain(v), `generation domain accepts ${v}`)
      for (const r of GD.rejects) {
        if (r.valueString !== undefined) {
          // canonical integer form: the round-trip must be byte-identical, which
          // rejects 01 / 1.0 / 1e3 — and 2^53(+1), which are simply out of range
          const parsed = Number(r.valueString)
          const canonical = Number.isSafeInteger(parsed) && String(parsed) === r.valueString
          check(!(canonical && inDomain(parsed)), `generation domain rejects ${r.valueString}: ${r.reason}`)
        } else {
          check(!inDomain(r.value), `generation domain rejects ${r.value}: ${r.reason}`)
        }
      }
      // the divergence the bound exists to forbid, made visible
      check(Number('9007199254740992') === Number('9007199254740993'),
        'generation domain: 2^53 and 2^53+1 ARE indistinguishable in IEEE-754 — which is why the domain stops below them')
      const BC = GD.boundaryCase
      const wB = canonicalOf(BC.entries)
      check(wB.nonce === BC.canonical.nonce && wB.generation === BC.canonical.generation,
        'generation domain [boundary]: a rotation at the top of the domain resolves by generation')
      check(Buffer.compare(Buffer.from(BC.canonical.nonce, 'hex'),
        Buffer.from(BC.entries.find((e) => e.nonce !== BC.canonical.nonce).nonce, 'hex')) > 0,
        'generation domain [boundary]: the winning nonce sorts HIGHER — a bytewise-only rule would have picked the other')
      check(pAt(BC.canonical.nonce) === BC.canonicalPrincipal,
        'generation domain [boundary]: the canonical entry derives the declared principal')
    }

    // The two properties bytewise-smallest alone could not deliver (round-4 B-3)
    const rot = NC.cases.find((c) => /rotation/i.test(c.case))
    check(rot && Buffer.compare(Buffer.from(rot.canonical.nonce, 'hex'),
      Buffer.from(rot.entries.find((e) => e.nonce !== rot.canonical.nonce).nonce, 'hex')) > 0,
      'nonce convergence: the rotation vector is a real counter-vector — the winning nonce sorts HIGHER, so bytewise-smallest alone would have undone the rotation')
    const back = NC.cases.find((c) => /re-appears/i.test(c.case))
    check(back && back.canonical.generation > Math.min(...back.entries.map((e) => e.generation)),
      'nonce convergence: a re-appearing older entry carries the lower generation and stays superseded — the REGISTER needs no tombstone (the carrier keeps its own, for released bindings)')
  }
}

// ── suite 1b: the carrier proof and the rate state machine ───────────────
section('carrier-proof.json — Delivery §5a.3 signature input, §4.4 rate machine')
{
  const CP = J('vectors/carrier-proof.json')
  const strip = (o) => { const { sig, ...rest } = o; return rest }

  // §5a.3 — canonical, domain-separated signature input
  // round-37 M-2: all four purposes are executed, not merely claimed — the
  // conclude proof was missing entirely while the fixture said otherwise.
  for (const [name, blk] of [['registration', CP.registration], ['collection', CP.collection],
                             ['conclusion', CP.conclusion]]) {
    schemaOK({ ...blk.object, sig: blk.sig }, 'carrier-proof.schema.json', `${name} proof`)
    check(blk.object.v === CP.v, `${name}: the domain tag is the v constant inside the signed object`)
    check(jcs(strip(blk.object)) === blk.jcs, `${name}: signature input is the JCS serialization with sig omitted`)
    check(verifyRaw(blk.object.principal, Buffer.from(blk.jcs, 'utf8'), blk.sig),
      `${name}: the signature verifies under the control principal`)
  }
  for (const [name, blk] of [['collection', CP.collection], ['conclusion', CP.conclusion]]) {
    check(blk.object.rkid === CP.keys.rkid,
      `${name}: the session-scoped purpose names the queue it acts on (wire 0.3, round-36 B-1)`)
    check(blk.object.generation === undefined && blk.object.addressChallenge === undefined,
      `${name}: it carries neither generation nor addressChallenge — it touches no succession`)
  }
  check(CP.conclusion.object.purpose === 'conclude',
    'conclusion: the fourth purpose is shipped signed, not merely named (round-37 M-2)')

  const R = CP.registration
  const chalLen = (s) => typeof s === 'string' && s.length === 43 && Buffer.from(s, 'base64url').length === 32 &&
    Buffer.from(s, 'base64url').toString('base64url') === s
  check(chalLen(R.object.principalChallenge) && chalLen(R.object.addressChallenge),
    'registration: both challenges are exactly 32 bytes in canonical unpadded base64url (43 characters)')
  check(R.object.purpose === 'register' && R.object.rkid && R.object.addressChallenge,
    'registration: purpose=register carries rkid and the address challenge')
  check(Number.isSafeInteger(R.object.generation) && R.object.generation >= 1,
    'registration: the proof carries the register generation, in Identity 7a.3\'s domain (round-11 B-4)')

  // round-18 B-1: the schema constrains the alphabet and the length envelope and
  // NOTHING beyond it — base58btc is not positional, so the decoded multicodec and
  // the decoded length are a VERIFIER obligation. These are the checks it names.
  const decodeZ = (s) => {
    if (typeof s !== 'string' || s[0] !== 'z') return null
    try { return fromB58(s.slice(1)) } catch { return null }
  }
  const decodedOK = {
    principal: (v) => {
      if (typeof v !== 'string' || !v.startsWith('did:key:')) return false
      const b = decodeZ(v.slice('did:key:'.length))
      return !!b && b.length === 34 && b[0] === 0xed && b[1] === 0x01
    },
    rkid: (v) => { const b = decodeZ(v); return !!b && b.length === 34 && b[0] === 0xec && b[1] === 0x01 },
    sig: (v) => { const b = decodeZ(v); return !!b && b.length === 64 },
  }
  const EAS = CP.encodingAcceptanceSurface
  if (EAS) {
    // the positive control first, so the negative check cannot pass by refusing everything
    check(decodedOK.principal(R.object.principal) && decodedOK.rkid(R.object.rkid) && decodedOK.sig(R.sig),
      'encoding acceptance surface [positive control]: the shipped proof decodes to ed01||32, ec01||32 and 64 signature bytes')
    for (const c of EAS.cases) {
      const probe = { ...R.object, sig: R.sig, [c.field]: c.value }
      const cps = SCHEMAS['carrier-proof.schema.json']
      const errs = validate(probe, cps, cps)
      check(errs.length === 0,
        `encoding acceptance surface [${c.field} ${c.decodedPrefixHex}/${c.decodedByteLength}B]: the value IS schema-valid — the shipped claim is not overstated`)
      const raw = c.field === 'principal' ? decodeZ(c.value.slice('did:key:'.length)) : decodeZ(c.value)
      check(!!raw && raw.length === c.decodedByteLength &&
        raw.subarray(0, 2).toString('hex') === c.decodedPrefixHex,
        `encoding acceptance surface [${c.field} ${c.decodedPrefixHex}/${c.decodedByteLength}B]: it decodes exactly as the vector declares`)
      check(decodedOK[c.field](c.value) === false,
        `encoding acceptance surface [${c.field} ${c.decodedPrefixHex}/${c.decodedByteLength}B]: the DECODED check refuses it — ${c.verdict}`)
    }
    // the length envelopes really do overlap, which is why length cannot decide
    check(/64 \(all zero\) to 88/.test(EAS.whyLengthCannotDecide) && /OVERLAPS/.test(EAS.whyLengthCannotDecide),
      'encoding acceptance surface: the vector states the overlap positively, not only by omission')
    const sigPat = SCHEMAS['carrier-proof.schema.json'].properties.sig.pattern
    check(sigPat === '^z[1-9A-HJ-NP-Za-km-z]{64,88}$',
      'encoding acceptance surface: the sig pattern is the true achievable envelope — the old {86,88} rejected a legitimate signature with three leading zero bytes')
  }

  // round-29 M-1: the spelling negatives are EXECUTED as raw proof bytes —
  // JSON.parse, schema, JCS, signature — instead of read as claims. Round 28
  // asserted that all four reached the signature; two of them are not valid
  // JSON numbers at all, and only running them showed it.
  {
    const GS = CP.generationSpelling
    const canonical = (lex) => /^(0|[1-9][0-9]*)$/.test(lex) &&
      Number.isSafeInteger(Number(lex)) && String(Number(lex)) === lex
    for (const a of GS.accepts)
      check(canonical(a), `generation spelling: "${a}" is canonical and accepted`)
    const RG = CP.registration
    // the shipped proof, re-serialized with the lexeme substituted verbatim
    const rawWith = (lex) => JSON.stringify({ ...RG.object, sig: RG.sig })
      .replace(/"generation":\s*1/, `"generation":${lex}`)
    check(JSON.parse(rawWith('1')).generation === 1,
      'generation spelling: the raw-byte harness reproduces the shipped proof when the lexeme is canonical')
    for (const r of GS.rejects) {
      check(!canonical(r.lexeme), `generation spelling: "${r.lexeme}" is not canonical — ${r.reason}`)
      const raw = rawWith(r.lexeme)
      let parsed = null, threw = false
      try { parsed = JSON.parse(raw) } catch { threw = true }
      check(threw === !r.validJson,
        `generation spelling: "${r.lexeme}" ${r.validJson ? 'parses as JSON' : 'is not a valid JSON number and dies in the parser'} — executed, not declared`)
      if (!r.validJson) {
        check(/JSON parser/.test(r.rejectedBy),
          `generation spelling: "${r.lexeme}" is recorded as rejected by the parser, which is where it actually fails`)
        continue
      }
      const cps = SCHEMAS['carrier-proof.schema.json']
      check((validate(parsed, cps, cps).length === 0) === r.schemaValid,
        `generation spelling: "${r.lexeme}" is schema-valid — "type": "integer" cannot see the spelling`)
      const { sig, ...obj } = parsed
      check((jcs(obj) === RG.jcs) === r.jcsIdentical,
        `generation spelling: "${r.lexeme}" canonicalizes to the SAME JCS bytes as the shipped proof`)
      check(verifyRaw(obj.principal, Buffer.from(jcs(obj), 'utf8'), sig) === r.signatureVerifies,
        `generation spelling: "${r.lexeme}" — the shipped signature VERIFIES over it, so nothing downstream can catch it`)
      check(parsed.generation === r.parsesTo,
        `generation spelling: "${r.lexeme}" parses to ${r.parsesTo}`)
    }
    check(GS.rejects.some((r) => r.validJson) && GS.rejects.some((r) => !r.validJson),
      'generation spelling: both classes ship — the ones a parser stops, and the ones only a lexical check can')
    const schema = SCHEMAS['carrier-proof.schema.json'].properties.generation
    check(schema.type === 'integer' && schema.pattern === undefined,
      'generation spelling: the shipped schema cannot express this, and says so rather than leaving it to be discovered')
    check(/§5a.3/.test(GS.whereChecked) && /corrected here/.test(GS.whyBothClassesShip),
      'generation spelling: the vector names where the check lives and records round 28\'s overclaim')
  }

  // round-29 B-1/B-2: the general atomicity rule, with its three counter-orders
  {
    const SA = CP.stateAtomicity
    check(SA.cases.length === 3,
      'state atomicity: all three seams ship — the one-rkid CAS, the declared queue bound, the declared tombstone bound (round-46 M-1: private bounds are no longer a conformance subject)')
    for (const c of SA.cases) {
      check(c.tornResult > c.boundValue && c.linearizedResult <= c.boundValue,
        `state atomicity [${c.case}]: the torn order reaches ${c.tornResult} against a declared ${c.bound} of ${c.boundValue}; linearized it is ${c.linearizedResult}`)
      check(c.tornOrder.length >= 3 && /reads/.test(c.tornOrder[0]) && /reads/.test(c.tornOrder[1]),
        `state atomicity [${c.case}]: the torn order is the same shape every time — both read before either commits`)
    }
    const sweeps = SA.cases.find((c) => /deadline transitions/.test(c.case))
    check(!!sweeps && sweeps.tornResult > sweeps.boundValue,
      'state atomicity [deadlines]: two racing deadline transitions overfill the tombstone store — the transition is a check-and-commit like every other bound decision')
    check(/joined into one sweep/.test(SA.rule) && /serialized/.test(SA.rule),
      'state atomicity: the rule names both admissible shapes — one sweep with the combined k, or separate serialized sweeps — and forbids the interleaving')
  }

  // §5a.3 — the queue-binding lifecycle as ONE total machine (round-22).
  // Totality is the test: every point of the enumerated domain must be answered
  // by exactly one cell, and the shipped vectors must be paths through it.
  const BL = CP.bindingLifecycle
  if (BL) {
    // round-23 M-1: the domain is pinned HERE, not read from the vector it
    // checks. A totality count over a self-declared domain stays green when a
    // whole state or input is dropped — `closing` and every one of its cells
    // could vanish and the old check reported 27/27.
    const STATES = ['unbound', 'live', 'closing', 'released']
    // 0.67: the deadline is ONE transition (round-43 B-1) — the two-step
    // give-up-sweep/release pair left the table with round-44 M-1.
    const INPUTS = ['register-rebind', 'collect-conclude', 'orphan-expiry',
      'deadline', 'eviction']
    check(BL.states.length === STATES.length && STATES.every((x) => BL.states.includes(x)),
      `lifecycle [domain]: the shipped states are exactly the ${STATES.length} this suite requires — a dropped state cannot pass by shrinking the domain`)
    check(BL.inputs.length === INPUTS.length && INPUTS.every((x) => BL.inputs.includes(x)),
      `lifecycle [domain]: the shipped inputs are exactly the ${INPUTS.length} this suite requires`)
    const GUARDED = 'register-rebind'
    const guardsFor = (input) => input === GUARDED ? ['gt', 'eq-same', 'eq-diff', 'lt'] : ['any']
    const key = (st, inp, g) => `${st} × ${inp} × ${g}`
    const index = new Map()
    for (const c of BL.cells) {
      const k = key(c.state, c.input, c.guard)
      check(!index.has(k), `lifecycle: ${k} is declared once — a second cell would make the machine ambiguous`)
      index.set(k, c)
    }
    let points = 0
    for (const st of STATES) for (const inp of INPUTS) for (const g of guardsFor(inp)) {
      points++
      const c = index.get(key(st, inp, g))
      check(!!c && typeof c.outcome === 'string' && c.outcome.length > 0 && typeof c.next === 'string',
        `lifecycle [total]: ${key(st, inp, g)} has exactly one outcome and one next state`)
      if (c) {
        check(STATES.includes(c.next), `lifecycle: ${key(st, inp, g)} lands in a declared state (${c.next})`)
        // round-23 B-2: every cell draws from ONE closed algebra
        const ALG = [...BL.verdicts, ...BL.internalTransitions]
        check(ALG.includes(c.outcome),
          `lifecycle [algebra]: ${key(st, inp, g)} → "${c.outcome}" is in the closed outcome set`)
      }
    }
    check(index.size === points,
      `lifecycle: the table is TOTAL and no wider than its domain — ${points} points, ${index.size} cells`)
    // the three cells three rounds found by composition
    for (const f of BL.findingCases) {
      if (f.state === 'any') {
        check(/does not select a cell/.test(BL.purposeRule) && /MUST NOT refuse/.test(BL.purposeRule),
          `lifecycle [${f.case}]: purpose is transplantation resistance, never a cell selector`)
        const byState = STATES.filter((st) => index.has(key(st, GUARDED, 'gt')))
        check(byState.length === STATES.length,
          `lifecycle [${f.case}]: every state answers register/rebind, so no purpose/state mismatch can fall out of the table`)
        continue
      }
      const c = index.get(key(f.state, f.input, f.guard))
      check(c && c.outcome === f.expectedOutcome && c.next === f.expectedNext,
        `lifecycle [${f.case}]: ${f.state} × ${f.guard} → ${f.expectedOutcome}, ${f.expectedNext}`)
      if (f.tombstoneAfter === 'consumed') {
        check(/CONSUMED/.test(c.note ?? ''),
          'lifecycle [B-1]: the tombstone is consumed, not kept beside the new binding and not evicted — the exclusion the invariant needs')
        check(/exactly one state/.test(BL.invariant) && /exactly the rkids in `released`/.test(BL.invariant),
          'lifecycle: the state exclusion invariant is stated, which is what makes the release step\'s k-counting right')
      }
    }
    // round-23 B-2: the algebra is closed and complete — every declared outcome
    // is actually used, and no cell reaches outside it
    {
      const ALG = [...BL.verdicts, ...BL.internalTransitions]
      check(new Set(ALG).size === ALG.length, 'lifecycle [algebra]: the closed set names each outcome once')
      const used = new Set(BL.cells.map((c) => c.outcome))
      for (const o of BL.internalTransitions)
        check(used.has(o), `lifecycle [algebra]: the internal transition "${o}" is used by a cell — the set is not padded`)
      check(BL.verdicts.includes('served') && BL.verdicts.includes('refused(no-such-queue)'),
        'lifecycle [algebra]: the collect/conclude verdicts are IN the closed set — round-22 shipped a table whose own §11 forbade them')
    }
    // 0.65 scope re-cast: capacity is a carrier resource answer, bounded by
    // two observable rules instead of a formula — guarantee 4 (traffic for
    // unknown addresses cannot starve a held binding) and 5a.9's priority
    // (a return outranks an arrival). The counter-example survives: a rebind
    // of a held binding is the honest return path and is served.
    {
      const CR = BL.capacityRule
      const cell = index.get(key(CR.counterExample.state, GUARDED, 'gt'))
      check(cell && cell.outcome === CR.counterExample.outcome &&
        CR.counterExample.outcome !== CR.counterExample.wrongOutcome,
        `capacity rule [counter-example]: a rebind for a held binding is ${CR.counterExample.outcome}, not ${CR.counterExample.wrongOutcome} — refusing it for a limit new bindings exhausted would breach guarantee 4`)
      check(/outranks an arrival/.test(CR.note) && /guarantee 4/.test(CR.note),
        'capacity rule: the shipped note names both observable bounds — the starvation guarantee and the return priority')
    }
  }

  // §5a.3 — generation monotonicity across the port
  const GM = CP.generationMonotonicity
  if (GM) {
    const verdict = (g, p) =>
      g < GM.acceptedGeneration ? 'refused(stale-generation)'
        : g > GM.acceptedGeneration ? 'rebound'
          : p === GM.acceptedPrincipal ? 'registered(idempotent)' : 'refused(stale-generation)'
    for (const c of GM.cases) {
      check(verdict(c.generation, c.principal) === c.outcome,
        `generation monotonicity [${c.case}]: ${c.outcome}`)
      check(c.bindingMoves === (c.outcome === 'rebound'),
        `generation monotonicity [${c.case}]: the binding moves only on a strictly higher generation`)
    }
    // round-12 B-1: the composite the two state machines did not cover separately
    const TIE = GM.equalGenerationTie
    if (TIE) {
      check(TIE.carrierSeesNonces === false,
        'equal-generation tie: the carrier never sees the nonces, so it cannot apply the register\'s tie-break itself — this stack carries no value that would reconstruct their order, and whether one could be carried safely is DO-7 (Identity §7a.4)')
      let boundP = null, boundG = 0
      for (const st of TIE.steps) {
        if (st.registerOnly) {                       // the register converges; the carrier learns nothing
          check(st.boundPrincipal === boundP && st.boundGeneration === boundG,
            `equal-generation tie [${st.step}]: register convergence does not move the carrier's binding`)
          continue
        }
        const got = boundP === null ? 'registered'
          : st.generation > boundG ? 'rebound'
            : st.generation === boundG && st.principal === boundP ? 'registered(idempotent)'
              : 'refused(stale-generation)'
        check(got === st.outcome, `equal-generation tie [${st.step}]: ${st.outcome}`)
        if (got === 'registered' || got === 'rebound') { boundP = st.principal; boundG = st.generation }
        check(st.boundPrincipal === boundP && st.boundGeneration === boundG,
          `equal-generation tie [${st.step}]: binding is ${st.boundPrincipal === boundP ? 'as declared' : 'WRONG'}`)
      }
      const refusal = TIE.steps.find((st) => st.outcome === 'refused(stale-generation)')
      const heal = TIE.steps[TIE.steps.length - 1]
      check(refusal && heal.outcome === 'rebound' && heal.generation === refusal.generation + 1,
        'equal-generation tie: the refusal is a WAIT state — one rotation later the binding moves (round-12 B-1)')
      // round-13 B-2: the rotation must actually rotate — fresh nonce, newly DERIVED principal
      const N3 = Buffer.from(TIE.rotationNonce, 'hex')
      check(N3.length === 32 && TIE.rotationNonce !== TIE.registerCanonicalNonce &&
        TIE.rotationNonce !== TIE.registerSupersededNonce,
        'equal-generation tie: the rotation draws a FRESH nonce, not one of the two tie candidates (Identity §7a.3)')
      // local multihash helper: suite 1's is block-scoped
      const mh13 = (b) => 'u' + Buffer.concat([Buffer.from([0x12, 0x20]), sha(b)]).toString('base64url')
      const CRX = ID.carrierRelationship
      const dn3 = mh13(N3)
      check(dn3 === TIE.rotationDigest, 'equal-generation tie: Dn of the rotation nonce')
      const info3 = CRX.prefix + mh13(Buffer.from(TIE.carrier ?? 'did:web:carrier.example', 'utf8')) + dn3
      check(info3 === TIE.rotationInfo, 'equal-generation tie: info = prefix || Dc || Dn(rotation)')
      const seed3 = hkdf(IKM, info3)
      check(seed3.toString('hex') === TIE.rotationEdSeed, 'equal-generation tie: rotation seed')
      check(didOf(seed3) === TIE.rotationPrincipal && didOf(seed3) === heal.principal,
        'equal-generation tie: the healing step binds a principal DERIVED from the fresh nonce (round-13 B-2)')
      check(heal.principal !== TIE.steps[0].principal &&
        heal.principal !== TIE.steps.find((st) => st.registerOnly).principal,
        'equal-generation tie: a real rotation yields a principal different from BOTH tie candidates — the previous vector reused one, which was an impossible state sequence')
      check(Buffer.compare(Buffer.from(TIE.registerSupersededNonce, 'hex'),
        Buffer.from(TIE.registerCanonicalNonce, 'hex')) > 0,
        'equal-generation tie: the vector is the hard direction — the device that bound first holds the LARGER nonce, so the register overturns it')
      // round-13 B-1: the corner where rotation is unavailable
      const MAXTIE = TIE.tieAtTheMaximum
      if (MAXTIE) {
        check(MAXTIE.generation === Number.MAX_SAFE_INTEGER && MAXTIE.rotationAvailable === false,
          'tie at the maximum: no rotation is available there (Identity §7a.3 forbids generation + 1)')
        check(MAXTIE.bindingStands === true && MAXTIE.collectableByEveryDevice === true &&
          MAXTIE.boundPrincipalIsRegisterCanonical === false,
          'tie at the maximum: the binding stands and stays collectable although the bound principal is NOT the register-canonical one — because entries are superseded, never deleted (round-13 B-1)')
        check(MAXTIE.remainingLevers.length >= 2,
          'tie at the maximum: the remaining levers are named (a move to a different C; a new chain as a social event) rather than a re-addressing instruction the holder cannot follow')
      }
    }
    // round-12 B-2: the tombstone outlives the binding
    const REL = GM.releasedAndReRegistered
    if (REL) {
      let tomb = REL.highestEverAccepted
      for (const st of REL.steps) {
        if (st.generation === undefined) continue
        const got = st.generation > tomb ? 'registered' : 'refused(stale-generation)'
        check(got === st.outcome, `released-then-re-registered [${st.step}]: ${st.outcome}`)
        if (got === 'registered') tomb = st.generation
      }
      check(REL.steps.some((st) => st.bindingLive === false && st.outcome === 'refused(stale-generation)'),
        'binding tombstone: a superseded generation is refused even though the binding itself is gone — resurrection by patience is closed (round-12 B-2)')
      // 0.65/0.66: the store is bounded by a DECLARED constant and the
      // eviction ORDER is normative — longest-released first, ties by
      // ascending bytewise rkid key bytes (round-43 B-2 restored what the
      // first re-cast draft had loosened to a SHOULD). The ordinal
      // bookkeeping that used to implement the order is carrier policy now;
      // what this block derives is the order itself, from the release
      // sweeps and the key bytes — the two facts every carrier holds.
      const EV = REL.evictionRule
      check(EV && /max-binding-tombstones/.test(EV.bound) && /declared constant/.test(EV.bound),
        'binding tombstone: the store bound is a DECLARED constant — a private bound made identical histories answer differently (round-43 B-2)')
      check(/longest-released/.test(EV.evicts) && /bytewise/.test(EV.evicts),
        'binding tombstone: the eviction order is total and normative — longest-released first, ties by rkid key bytes — while its bookkeeping is implementation')
      check(EV && /anti-resurrection guarantee ends/.test(EV.consequenceForEvictedRkid) &&
        /both/.test(EV.reachableBy) && /PARALLEL/.test(EV.attackerCostPerTombstone),
        'binding tombstone: the eviction consequence is named with its preconditions — owner-only, metered per registration, and the horizons run in PARALLEL')
      const ST = EV && EV.store
      if (ST) {
        const keyBytes = (rkid) => {
          check(rkid[0] === 'z', `tombstone eviction: ${rkid.slice(0, 8)}… is z-multibase`)
          const raw = fromB58(rkid.slice(1))
          check(raw && raw.length === 34 && raw[0] === 0xec && raw[1] === 0x01,
            `tombstone eviction: ${rkid.slice(0, 8)}… decodes to an X25519 multikey (0xec01 + 32 bytes)`)
          return raw.subarray(2)
        }
        for (const e of ST.entries) {
          check(keyBytes(e.rkid).toString('hex').startsWith(e.keyBytesPrefix),
            `tombstone eviction [${e.label}]: declared key-byte prefix ${e.keyBytesPrefix} reproduces from the rkid`)
        }
        // the order is DERIVED from the sweeps and the key bytes, never read
        const order = (a, b) => (a.releaseSweep - b.releaseSweep) ||
          Buffer.compare(keyBytes(a.rkid), keyBytes(b.rkid))
        const sorted = ST.entries.slice().sort(order)
        check(sorted[0].label === ST.evictedFirstLabel,
          `tombstone eviction: the victim is ${ST.evictedFirstLabel} — the longest-released tombstone, tie decided by key bytes`)
        check(sorted.map((e) => e.label).join(',') === ST.orderedFullLabels.join(','),
          `tombstone eviction: the declared full order reproduces (${ST.orderedFullLabels.join(' < ')})`)
        const multi = new Map()
        for (const e of ST.entries) multi.set(e.releaseSweep, (multi.get(e.releaseSweep) ?? 0) + 1)
        check([...multi.values()].some((n) => n >= 2),
          'tombstone eviction: two tombstones share a release sweep — a rule ordered by the release moment alone would leave exactly this case undecided, which is what the bytewise tie-break is for')
        const perms = (xs) => xs.length <= 1 ? [xs]
          : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r]))
        check(perms(ST.entries).every((p) => p.slice().sort(order)[0].label === ST.evictedFirstLabel),
          'tombstone eviction: the order is TOTAL — every permutation of the store evicts the same tombstone, so two carriers cannot keep different addresses')
        // round-45 B-3: lowering the bound trims the store atomically, by the
        // same order — derived here, not read from the vector.
        const BR = REL.boundRevision
        if (BR) {
          const byL = new Map(ST.entries.map((e) => [e.label, e]))
          const kept = BR.before.store.map((l) => byL.get(l)).sort(order)
            .slice(BR.before.store.length - BR.revision.declared).map((e) => e.label)
          const gone = BR.before.store.filter((l) => !kept.includes(l))
          check(kept.join(',') === BR.after.store.join(',') && gone.join(',') === BR.after.evicted.join(','),
            `tombstone bound revision: lowering ${BR.before.declared}→${BR.revision.declared} evicts ${gone.join(', ')} in the total order, at the instant the revision takes effect — standing state is not a running act (round-45 B-3)`)
        }
      }
      // The list of withdrawn wordings used to live here and scanned two vector
      // fields. Round 18 found the same retracted argument alive in a check
      // MESSAGE of this very file — a place that guard could never see. It has
      // therefore MOVED to scripts/validate.mjs section 3c, which scans every
      // shipped vector, this runner and the spec at once. What stays here are
      // the POSITIVE claims, which a text scan cannot make:
      check(/PARALLEL/.test(EV.attackerCostPerTombstone),
        'binding tombstone: the shipped prose states the parallel horizons positively, not only by omission')
      const TIEN = GM.equalGenerationTie?.note ?? ''
      check(/DO-7/.test(TIEN),
        'equal-generation tie: the shipped note points at DO-7, where the open question lives')
    }
    // round-21 B-3: the recovery cost is the generation distance, derived here
    const RD = REL.recoveryDistance
    if (RD) {
      check(RD.rotationsNeeded === RD.tombstoneGeneration - RD.recoveredCopyGeneration + 1,
        `binding tombstone: a copy at generation ${RD.recoveredCopyGeneration} against a tombstone at ${RD.tombstoneGeneration} needs ${RD.rotationsNeeded} rotations — t - g + 1, not "one"`)
      const firstOK = REL.steps.find((st) => st.outcome === 'registered')
      check(firstOK && firstOK.generation === RD.recoveredCopyGeneration + RD.rotationsNeeded,
        'binding tombstone: the shipped steps reach exactly that generation before the registration succeeds — the formula is the sequence, not a claim beside it')
      check(/2\^53-1/.test(RD.atTheMaximum) && /not re-registrable/.test(RD.atTheMaximum),
        'binding tombstone: the vector states the maximum case, where no number of rotations suffices')
    }
    // round-39 B-1/M-1: the promised selective-loss recovery, executed. It
    // was a set claim in two documents and had no runnable path at all.
    const CL = GM.carrierEntryLossRecovery
    if (CL) {
      const held = { g: CL.held.generation, P: CL.held.principal }
      const apply = (req) => {                       // §5a.3's table, the live rows
        const g = Number(req.match(/generation=(\d+)/)[1])
        const P = req.match(/principal=(\w+)/)[1]
        if (g > held.g) { held.g = g; held.P = P; return { outcome: 'rebound', bindingMoves: true } }
        if (g === held.g && P === held.P) return { outcome: 'registered(idempotent)', bindingMoves: false }
        return { outcome: 'refused(stale-generation)', disclosedGeneration: held.g, bindingMoves: false }
      }
      const got = CL.steps.map((st) => apply(st.request))
      check(got.every((g, i) => g.outcome === CL.steps[i].outcome && g.bindingMoves === CL.steps[i].bindingMoves),
        `carrier-entry loss: the promised recovery RUNS — ${CL.steps.length} exchanges from a fresh N at generation 1 against a live binding at ${CL.held.generation}, ending in rebound (round-39 B-1)`)
      check(got[0].outcome === 'refused(stale-generation)' && got[0].disclosedGeneration === CL.held.generation
        && CL.steps[0].disclosedGeneration === CL.held.generation,
        'carrier-entry loss: the first attempt fails and the refusal CARRIES the held generation — without it the holder has nothing to exceed, and Identity §9.3\'s promise is unkeepable')
      check(CL.steps[1].request.includes(`generation=${CL.held.generation + 1}`),
        'carrier-entry loss: the second exchange rebinds at disclosed + 1 — one extra exchange is the entire cost of the repair')
      // round-41 B-3/M-2: the count is a FUNCTION of the held state, and the
      // categorical promise was wrong in BOTH directions — one exchange from
      // unbound, more than two from closing without room. Executed per state.
      const PS = CL.perHeldState
      if (PS) {
        const table = {                     // §5a.3's rows, by held state
          live: (g, rec) => g > rec ? 'rebound' : 'refused(stale-generation)',
          closing: (g, rec, room) => !room ? 'registration-refused(capacity)'
            : (g > rec ? 'rebound' : 'refused(stale-generation)'),
          released: (g, rec) => g > rec ? 'registered' : 'refused(stale-generation)',
          unbound: () => 'registered',
        }
        for (const c of PS.cases) {
          const h = c.held
          const got = c.steps.map((st) =>
            table[h.state](st.generation, h.record ?? 0, st.carrierHasRoom ?? !h.atCapacity))
          check(got.every((x, i) => x === c.steps[i].outcome),
            `recovery by state [${h.state}${h.record ? `(${h.record})` : ''}${h.atCapacity ? ', carrier at capacity' : ''}]: the shipped steps are what §5a.3's rows produce (${got.join(' → ')})`)
          const disclosed = c.steps.filter((st) => st.discloses !== undefined)
          check(disclosed.every((st) => st.discloses === h.record),
            `recovery by state [${h.state}]: every disclosure carries the record actually held`)
          check(typeof c.exchanges !== 'number' || c.steps.length === c.exchanges,
            `recovery by state [${h.state}]: ${c.exchanges} exchange(s), and the sequence has exactly that many`)
        }
        const atCap = PS.cases.find((c) => c.held.atCapacity)
        check(atCap && atCap.steps.slice(0, 2).every((st) => st.outcome === 'registration-refused(capacity)')
          && atCap.steps[1].generation > atCap.steps[0].generation,
          'recovery by state: at capacity a HIGHER generation does not help either — the refusal is retriable, about the carrier and not the generation, and no rotation is needed; 5a.9\'s priority rule ORDERS the wait, the plural carrier world bounds it (round-46 B-2)')
        check(PS.cases.some((c) => c.exchanges === 1) && PS.cases.some((c) => c.exchanges === 2)
          && PS.cases.some((c) => typeof c.exchanges === 'string'),
          'recovery by state: the family contains a ONE-exchange state, a two-exchange state and a more-than-two state — which is why the promise could not stay a constant (round-41 B-3)')
      }
      // and the disclosure is not a way in: the same table refuses a party
      // that cannot open the address challenge long before it is reached
      check(/already required/.test(CL.disclosureIsNotAnAccessGrant),
        'carrier-entry loss: the vector states WHY the disclosure grants nothing — both possession proofs precede the verdict that carries it')
    }
    const restored = GM.cases.find((c) => /restored device/.test(c.case))
    check(restored && restored.outcome === 'refused(stale-generation)' && restored.bindingMoves === false,
      'generation monotonicity: a device restored from an older backup proves everything and still cannot roll the binding back — the register\'s succession holds across the port')
  }
  check(CP.collection.object.purpose === 'collect' &&
    typeof CP.collection.object.rkid === 'string' &&
    CP.collection.object.addressChallenge === undefined && CP.collection.object.generation === undefined,
    'collection: purpose=collect NAMES its queue (rkid) and omits the two succession fields — presence and absence are both part of the signed bytes (round-36 B-1)')
  check(CP.collection.jcs !== R.jcs && CP.collection.sig !== R.sig,
    'collection: a collection proof is byte-distinct from a registration proof (no cross-purpose replay)')
  // the shape holds across every transplant too: they change values, never the form
  for (const n of CP.negatives.cases) {
    if (n.object.v === CP.v) schemaOK({ ...n.object, sig: CP.registration.sig }, 'carrier-proof.schema.json', `transplant ${n.case}`)
    check(jcs(n.object) === n.jcs, `transplant vector shape: ${n.case}`)
    check(n.jcs !== R.jcs, `transplant changes the signed bytes: ${n.case}`)
    check(!verifyRaw(n.object.principal, Buffer.from(n.jcs, 'utf8'), R.sig),
      `the registration signature does NOT verify after: ${n.case}`)
  }

  // §5a.3 — one challenge buys at most one verification (round-16 B-1);
  // since the 0.65 re-cast this is the port-observable remainder of the
  // charge machine: single-use, consumed before verification.
  const CBV = CP.challengeConsumption
  if (CBV) {
    let live = false, issued = 0, verifications = 0
    let ok16 = true
    for (const st of CBV.sequence) {
      if (st.newChallenge || st.challengeLive === true && !live && !st.consumesChallenge) { live = true; issued++ }
      if (st.consumesChallenge) {
        if (!live) ok16 = false                       // cannot consume what is not live
        live = false                                   // consumed BEFORE verifying
        if (st.verified) verifications++
      } else if (st.verified) {
        ok16 = false                                   // a verification without consuming is the attack
      }
      if (st.challengeLive !== live || st.verificationsSoFar !== verifications) ok16 = false
    }
    check(ok16, `challenge consumption: the declared sequence reproduces (${CBV.sequence.length} steps) — consume first, then verify`)
    check(verifications <= issued,
      `challenge consumption: ${verifications} verification(s) for ${issued} issued challenge(s) — one challenge buys at most one asymmetric attempt (round-16 B-1)`)
    const replays = CBV.sequence.filter((st) => st.outcome === 'discarded')
    check(replays.length >= 2 && replays.every((st) => st.verified === false),
      'challenge consumption: responses after the first are discarded WITHOUT verification — the unbounded-verification attack is closed')
  }

  // §4.4 guarantee 5 — the floor, executed as the PROMISE (0.65/0.66):
  // below its declared queue-floor a queue's admission depends on nothing
  // global; above it, a global refusal is legitimate. The committed-formula
  // these cases were first written against is carrier policy now — the
  // runner no longer recomputes a bookkeeping model, it checks the two
  // observable halves of the guarantee on each case.
  const QF = CP.queueFloorAccounting
  if (QF) {
    const FLOOR = QF.declaration['queue-floor']
    const QUOTA = QF.declaration['max-queue-bytes']
    check(FLOOR <= QUOTA, 'queue floor: queue-floor <= max-queue-bytes for the declared set')
    for (const c of QF.cases) {
      const after = c.live[c.queue] + c.size
      const withinFloor = after <= FLOOR
      if (withinFloor)
        check(c.outcome === 'admitted',
          `queue floor [${c.case}]: within the floor → admitted, whatever the global occupancy (guarantee 5)`)
      else
        check(c.outcome === 'admitted' || c.outcome === 'refused(capacity)',
          `queue floor [${c.case}]: above the floor the room is elastic — ${c.outcome} is a legitimate answer there, and only there`)
      check(after <= QUOTA || c.outcome !== 'admitted',
        `queue floor [${c.case}]: nothing admits past max-queue-bytes`)
    }
    const belowFloor = QF.cases.find((c) => c.live[c.queue] + c.size <= FLOOR)
    check(!!belowFloor, 'queue floor: the deciding case ships — a queue one byte below its floor, admitted regardless of global occupancy')
    const aboveFloor = QF.cases.find((c) => c.live[c.queue] + c.size > FLOOR && c.outcome === 'refused(capacity)')
    check(!!aboveFloor, 'queue floor: the elastic half ships too — above the floor a global refusal is conformant, and the boundary between the two is the declared constant')
  }

  // §4.4 — the five guarantees and the recast wind-up, executed (round-43 M-2)
  const CG = CP.carrierGuarantees
  if (CG) {
    // g1 — the declaration is complete or it rejects
    const G1 = CG.g1_declaration
    check(G1.required.every((k) => k in G1.declaration),
      `guarantee 1: the shipped declaration carries all ${G1.required.length} required constants`)
    for (const r of G1.rejects.filter((r) => r.missing))
      check(G1.required.includes(r.missing),
        `guarantee 1: a declaration missing ${r.missing} rejects — a carrier does not act on values it has not published`)
    check(G1.roleURI === 'https://real-life.org/trust-tasks/delivery-carrier/0.1',
      'guarantee 1: the carrier declares under ONE fixed role URI — delivery-carrier/0.1, a role key and never a document type (round-44 B-1)')
    check(G1.rejects.some((r) => r.wrongRole && r.wrongRole !== G1.roleURI),
      'guarantee 1: constants under any other role URI are not a carrier declaration — the negative ships (round-45 M-1)')
    // round-48 M-2: the declaration BINDS — executable, not asserted
    const BH = G1.behaviour
    if (BH) {
      const SH = BH.statusHorizon
      for (const st of SH.sequence.filter((x) => x.conformant !== undefined))
        check(st.conformant === (st.t <= SH.declaredMs),
          `guarantee 1 [status-horizon, t=${st.t}]: ${st.conformant ? 'an honest report inside the horizon conforms' : 'silence past the declared horizon does not'} (declared ${SH.declaredMs}ms)`)
      for (const d of BH.enforcementDrift)
        check(d.conformant === (d.declared === d.enforced),
          `guarantee 1 [${d.constant}]: enforcing ${d.enforced} against a published ${d.declared} is ${d.conformant ? 'conformant' : 'nonconformant'} — the declaration binds in both directions`)
      check(BH.enforcementDrift.some((d) => !d.conformant && d.why.includes('stricter')) &&
        BH.enforcementDrift.some((d) => !d.conformant && d.why.includes('looser')),
        'guarantee 1: both drift directions ship — stricter and looser than published are equally nonconformant')
    }
    // g2 — overlapping conditions name ONE verdict, by the normative order
    const SUB = ['no-such-queue', 'bounds', 'duplicate', 'admission-resource', 'queue-saturated', 'capacity']
    for (const c of CG.g2_precedence_submission.cases) {
      const first = SUB.find((k) => c.holds.includes(k))
      const expect = first === 'duplicate' ? 'duplicate' : `refused(${first})`
      check(expect === c.verdict,
        `guarantee 2/precedence [s: ${c.holds.join('+')}]: the order names ${c.verdict} — an implementation free to choose would be observably divergent (round-43 B-3)`)
    }
    const REG = ['malformed', 'admission-resource', 'possession-failed', 'capacity', 'stale-generation']
    for (const c of CG.g2_precedence_registration.cases) {
      // guarantee 4 strikes r2 and r4 for a held binding ONLY when the
      // exhaustion came from unknown-address traffic (round-47 M-2) — a
      // budget the binding's own traffic drained is DO-6, not starvation
      const shielded = c.heldBinding && c.exhaustedBy === 'unknown-address traffic'
      const holds = shielded
        ? c.holds.filter((k) => k !== 'admission-resource' && k !== 'capacity')
        : c.holds
      const first = REG.find((k) => holds.includes(k))
      const expect = first === 'capacity' ? 'registration-refused(capacity)' : `refused(${first})`
      check(expect === c.verdict,
        `guarantee 2/precedence [r: ${c.holds.join('+')}${c.heldBinding ? ', held binding' : ''}]: ${c.verdict}`)
    }
    // g2 family — closed, split across the two sets, member named by order
    const GF = CG.g2_family
    check(GF.registration.length === 2 && GF.submission.length === 3 &&
      [...GF.registration, ...GF.submission].every((x) => /capacity|admission-resource|queue-saturated/.test(x)),
      'guarantee 2: the retriable family is closed — two registration members, three submission members, and which answers is the evaluation order\'s choice, never the carrier\'s (round-45 B-2)')
    // floor × meter — guarantee 5 binds s4 cross-queue
    const XT = CP.queueFloorAccounting.crossTrafficMeter
    if (XT) {
      for (const c of XT.cases) {
        const expect = c.withinFloor && c.meterDrainedBy === 'other' ? 'admitted'
          : 'refused(admission-resource)'
        check(c.outcome === expect,
          `guarantee 5 × s4 [${c.case}]: ${c.outcome} — cross-queue traffic ends at the floor, the queue's own budget does not (round-45 B-1)`)
      }
      check(XT.cases.some((c) => c.meterDrainedBy === 'own' && c.outcome !== 'admitted'),
        'guarantee 5 × s4: the queue\'s OWN meter still refuses below the floor — guarantee 5 is not an exemption from DO-6')
    }
    // g3 — the ordering rule is observable as zero asymmetric work on refusal
    const g3r = CG.g3_order.sequence.find((st) => st.verdict.startsWith('refused'))
    const g3a = CG.g3_order.sequence.find((st) => !st.verdict.startsWith('refused'))
    check(g3r.asymmetricOpsPerformed === 0 && g3a.asymmetricOpsPerformed > 0,
      'guarantee 3: a refused request costs no key operation — the decision precedes randomness, sealing and verification')
    // g4 — the starvation guarantee and the return priority
    const G4 = CG.g4_starvation.sequence
    check(G4[0].verdict.startsWith('refused') && G4[0].retriable === true,
      'guarantee 4 [flood]: unknown-address traffic exhausts something, retriably')
    check(G4[1].verdict === 'served' && G4[2].verdict === 'rebound',
      'guarantee 4: during the flood, the held binding is served and its return path rebinds — beyond the reach of unknown-address traffic')
    check(G4[3].newcomer === 'registration-refused(capacity)' && G4[3].returner === 'rebound',
      'guarantee 4/5a.9: at the limits, the return outranks the arrival — the same instant, two requests, and the one that resumes a held binding wins')
    check(G4[4] && G4[4].verdict === 'rebound' && /r2/.test(G4[4].why),
      'guarantee 4 × r2 (round-44 B-2): a meter drained by unknown-address traffic cannot refuse a held binding\'s rebind at r2 — the composition is executed, not implied')
    // wind-up: the deadline is the release, in time
    const WD = CG.windUpDeadline
    const dl = WD.sequence[0].deadline
    for (const st of WD.sequence) {
      if (st.event === 'submission admitted')
        check(st.depositLifeEndsAt === dl && st.t < dl,
          `wind-up [t=${st.t}]: the deposit inherits the remaining time to ${dl} — never a fresh horizon`)
      if (st.event === 'deadline')
        check(st.t === dl && st.state === 'released' && st.undisposedAtRelease === 0 && st.tombstone === true,
          'wind-up [deadline]: give-up and release are ONE transition at the fixed instant — nothing undisposed, tombstone created (round-43 B-1)')
    }
    const RET = WD.returnEndsIt.sequence
    const back = RET.find((st) => /returns/.test(st.event))
    check(back.state === 'live' && back.deadlineVoided === true && /1300/.test(String(back.depositLifeEndsAt)),
      'wind-up [return]: the return ends the wind-up — the deadline is void and held deposits revert to admission-dated horizons')
    check(/FRESH/.test(RET[RET.length - 1].why),
      'wind-up [composition]: closing→live→closing runs only through a full new orphan-horizon and a FRESH deadline — the old instant is void, not paused')
    check(WD.postDeadlineReturn.state === 'released',
      'wind-up [after]: a return linearized after the deadline meets released(t) and takes the tombstone path — the boundary is exact, not raced')
  }

  // §5a.5 — `duplicate` is byte-exact over the sealed envelope (round-9 B-2)
  const DR = CP.duplicateRule
  if (DR) {
    const bytesOf = (env) => JSON.stringify([env.rkid, env.epk, env.nonce, env.ciphertext])
    for (const c of DR.cases) {
      const identical = bytesOf(c.first) === bytesOf(c.second)
      const expected = identical && !c.depositConcluded ? 'duplicate' : 'admitted'
      check(expected === c.outcome, `duplicate rule [${c.case}]: outcome is ${c.outcome}`)
      check(c.resourceCharged === 2,
        `duplicate rule [${c.case}]: the admission resource is charged for BOTH submissions — a replay is never free`)
      const expectedCopies = c.outcome === 'duplicate' ? 1 : (c.depositConcluded ? 1 : 2)
      check(c.storedCopies === expectedCopies,
        `duplicate rule [${c.case}]: ${c.storedCopies} stored cop${c.storedCopies === 1 ? 'y' : 'ies'} — a duplicate consumes no storage`)
    }
    const resealed = DR.cases.find((c) => /re-sealed/.test(c.case))
    check(resealed && resealed.outcome === 'admitted' &&
      resealed.first.epk !== resealed.second.epk && resealed.first.nonce !== resealed.second.nonce,
      'duplicate rule: re-sealing one document yields a fresh epk and nonce, so a key-blind carrier admits it — §6.2 absorbs the repetition at the receiver, on the document digest')
  }

}

// ── suite 2: seal vector reproduces byte-for-byte ────────────────────────
section('seal.json — Delivery §5 construction reproduces')
{
  const S = J('vectors/seal.json'); const inp = S.inputs; const out = S.output
  const ptx = jcs(inp.document)
  check(ptx === S.intermediate.plaintextJcs, 'plaintext JCS matches')
  const ephSeed = Buffer.from(inp.ephemeralPrivateKeyRaw, 'base64url')
  const ss = ecdhRaw(ephSeed, Buffer.from(inp.recipientPublicKeyRaw, 'base64url'))
  if (S.intermediate.sharedSecret) check(ss.toString('base64url') === S.intermediate.sharedSecret, 'shared secret matches')
  const key = hkdf(ss, 'rltp/v1/seal')
  const iv = Buffer.from(inp.nonce, 'base64url')
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(Buffer.from(ptx, 'utf8')), c.final(), c.getAuthTag()])
  check(ct.toString('base64url') === out.sealedEnvelope.ciphertext, 'ciphertext || tag reproduces byte-for-byte')
  check('z' + b58(Buffer.concat([Buffer.from([0xec, 1]), Buffer.from(inp.recipientPublicKeyRaw, 'base64url')])) === inp.rkid, 'rkid encodes the recipient key')
  const epkRaw = pubRaw(privX(ephSeed))
  check(epkRaw.toString('base64url') === out.sealedEnvelope.epk, 'epk matches the ephemeral public key')
  if (out.documentDigest) check(digestU(inp.document) === out.documentDigest, 'document digest matches')
}

// ── suite 3: encounter cards (eddsa-jcs-2022, W3C-true) ──────────────────
section('encounter-cards.json — cards, credential, binding, negatives')
const EC = J('vectors/encounter-cards.json')
for (const [name, card] of Object.entries(EC.cards)) {
  schemaOK(card, 'contact-card-0.25.schema.json', `card ${name}`)
  schemaOK(card, 'contact-card.schema.json', `card ${name} (mobile)`)
  const r = diVerify(card, card.anchor)
  check(r.ok, `card ${name}: DI proof verifies (W3C, embedded proof only)`)
  check(!('@context' in card.proof), `card ${name}: proof carries no @context (document has none)`)
}
{
  const cred = EC.credential
  schemaOK(cred, 'encounter-credential-0.25.schema.json', 'credential')
  schemaOK(cred, 'encounter-credential.schema.json', 'credential (mobile)')
  check(jcs(cred.proof['@context']) === jcs(cred['@context']), 'credential proof carries the @context copy')
  check(diVerify(cred, cred.issuer).ok, 'credential: DI proof verifies (W3C)')
  const binding = digestU({ ceremony: 'encounter-scan@0.25', challenges: [EC.fixtures.challengeA, EC.fixtures.challengeB].sort() })
  check(binding === cred.credentialSubject.enactmentBinding, 'enactmentBinding recomputes per Encounter 5.4')
}
for (const n of EC.negative) {
  const a = n.artifact
  if (n.name === 'card-mutated-after-signing') {
    const sOK = validate(a, SCHEMAS['contact-card-0.25.schema.json'], SCHEMAS['contact-card-0.25.schema.json']).length === 0
    const r = diVerify(a, a.anchor)
    check(sOK && r.stage === 'crypto' && !r.ok, `${n.name}: schema PASS, binding PASS, DI FAILS exclusively`)
  } else if (n.name === 'verification-method-foreign-anchor') {
    const sOK = validate(a, SCHEMAS['contact-card-0.25.schema.json'], SCHEMAS['contact-card-0.25.schema.json']).length === 0
    const r = diVerify(a, a.anchor)
    check(sOK && r.stage === 'binding', `${n.name}: schema PASS, Layer-1 binding FAILS before crypto`)
  } else if (n.name === 'sent-card-missing-boundTo') {
    schemaFails(a, 'contact-card-0.25.schema.json', n.name)
  } else err(`unknown negative ${n.name}`)
}

// ── suite 4: visibility vectors — every MAC, signature, digest ───────────
section('visibility.json — full recomputation from the oracle')
const V = J('vectors/visibility.json')
const P = {}
for (const [k, v] of Object.entries(V.parties)) {
  const label = 'pair/u' + Buffer.concat([Buffer.from([0x12, 0x20]), sha(Buffer.from(v.relationshipNonce, 'hex'))]).toString('base64url')
  const ed = hkdf(IKM, 'rltp/anchor/ed/' + label), x = hkdf(IKM, 'rltp/anchor/x/' + label)
  P[k] = { ed, x, did: didOf(ed), mk: mkOf(x) }
  check(label === v.label && P[k].did === v.anchor && P[k].mk === v.keyAgreement, `party ${k}: derivation`)
}
// the community anchor is an ORDINARY group-context derivation (Identity
// 0.13, the S-DID cut) — never the recovery context's fixed strings
const selfEd = hkdf(IKM, 'rltp/anchor/ed/' + V.self.label), selfX = hkdf(IKM, 'rltp/anchor/x/' + V.self.label)
check(V.self.label.startsWith('group/') && didOf(selfEd) === V.self.anchor && mkOf(selfX) === V.self.keyAgreement, 'community anchor: ordinary group-context derivation')
const A = V.artifacts
const macCheck = (label, body, mac, privSeed, peerMk, info) =>
  check(hmacU(hkdf(ecdh(privSeed, peerMk), info), jcs(body)) === mac, label)
{
  const kStar = hkdf(ecdh(P.A.x, P.B.mk), `rltp/visibility/blind/star/${P.A.did}/${P.B.did}/1`)
  check(hmacU(kStar, jcs(A.star.body)) === A.star.proof.mac, 'star: mac')
  check(A.star.body.blinded.includes(hmacU(kStar, V.self.anchor)), 'star: blinded entry = HMAC(k, self anchor)')
  macCheck('grade: mac', A.gradeDeclaration.body, A.gradeDeclaration.proof.mac, P.B.x, P.A.mk, `rltp/visibility/mac/grade/${P.B.did}/${P.A.did}`)
  check(verifyRaw(V.self.anchor, Buffer.from(jcs(A.selfCard.body), 'utf8'), A.selfCard.proof.proofValue), 'self-card: raw Ed25519 signature')
  macCheck('anchor-mapping: mac1', A.anchorMapping.body, A.anchorMapping.proof.mac1, P.A.x, P.B.mk, 'rltp/visibility/mac/map1')
  check(hmacU(hkdf(ecdhRaw(selfX, xRawOfMk(P.B.mk)), 'rltp/visibility/mac/map2'), jcs(A.anchorMapping.body)) === A.anchorMapping.proof.mac2, 'anchor-mapping: mac2 (self key)')
  check(A.anchorMapping.body.type === 'anchor-mapping@3' && Array.isArray(A.anchorMapping.body.lineage) && A.anchorMapping.body.lineage.length === 0, 'anchor-mapping@3: an empty lineage — the sender presents no history')
  check(jcs(A.anchorMapping.body.card) === jcs(A.selfCard), 'anchor-mapping@3: the enclosed card is the self-card')
  // the rotation case (6.5): generation 2 of the same community, the mapping re-issued under it
  const g2 = V.selfGenerations['2']
  const g2Ed = hkdf(IKM, 'rltp/anchor/ed/' + g2.label), g2X = hkdf(IKM, 'rltp/anchor/x/' + g2.label)
  check(g2.label === V.self.label + '/2' && didOf(g2Ed) === g2.anchor && mkOf(g2X) === g2.keyAgreement, 'community anchor generation 2: group/<digest>/2 on the ordinary path')
  const rot = A.anchorRotation, mr = A.anchorMappingRotated
  check(rotationOK(rot) && rot.body.prev === V.self.anchor && rot.body.next === g2.anchor && rot.body.generation === '2', 'anchor-rotation@1: generation 1 → 2, signed by both (6.5)')
  schemaOK(mr, 'visibility-anchor-mapping.schema.json', 'anchor-mapping@3 (rotated)')
  check(mr.body.self === g2.anchor && mr.body.card.body.anchor === g2.anchor && verifyRaw(g2.anchor, Buffer.from(jcs(mr.body.card.body), 'utf8'), mr.body.card.proof.proofValue), 'rotated mapping: self and card under generation 2')
  check(mr.body.lineage.length === 1 && jcs(mr.body.lineage[0]) === jcs(rot) && mr.body.lineage.every((r, i) => rotationOK(r) && r.body.generation === String(i + 2)) && mr.body.lineage.at(-1).body.next === mr.body.self, 'rotated mapping: 6.3 condition 4a — the lineage verifies, runs from 2, ends at self')
  macCheck('rotated mapping: mac1', mr.body, mr.proof.mac1, P.A.x, P.B.mk, 'rltp/visibility/mac/map1')
  check(hmacU(hkdf(ecdhRaw(g2X, xRawOfMk(P.B.mk)), 'rltp/visibility/mac/map2'), jcs(mr.body)) === mr.proof.mac2, 'rotated mapping: mac2 under selfX of the CURRENT generation')
  check(BigInt(mr.body.revision) > BigInt(A.anchorMapping.body.revision), 'rotated mapping: a higher revision in the same scope (6.4)')
  const held = V.rotation.heldSelf
  check(held === A.anchorMapping.body.self && held !== mr.body.self && mr.body.lineage.some((r) => r.body.prev === held || r.body.next === held) && V.rotation.classification === 'rotation', '6.3 condition 8: the held self appears in the lineage — a ROTATION, not a new community')
  const kp = hkdf(ecdh(P.A2.x, P.B2.mk), `rltp/visibility/blind/probe/${P.A2.did}/${P.B2.did}`)
  const pb = A.continuityProbe.body
  check(hmacU(kp, jcs(pb)) === A.continuityProbe.proof.mac, 'probe: mac')
  check(pb.blinded.length === 256 && new Set(pb.blinded).size === 256, 'probe: 256 unique entries')
  check(jcs(pb.blinded) === jcs([...pb.blinded].sort()), 'probe: globally sorted')
  check(pb.blinded.includes(hmacU(kp, P.A.did)), 'probe: contains the real prior entry')
  macCheck('continuity-mapping: mac1 (prior key)', A.continuityMapping.body, A.continuityMapping.proof.mac1, P.A.x, P.B.mk, 'rltp/visibility/mac/cont1')
  macCheck('continuity-mapping: mac2 (new key)', A.continuityMapping.body, A.continuityMapping.proof.mac2, P.A2.x, P.B2.mk, 'rltp/visibility/mac/cont2')
  macCheck('continuity-mapping reverse: mac1', A.continuityMappingReverse.body, A.continuityMappingReverse.proof.mac1, P.B.x, P.A.mk, 'rltp/visibility/mac/cont1')
  macCheck('continuity-mapping reverse: mac2', A.continuityMappingReverse.body, A.continuityMappingReverse.proof.mac2, P.B2.x, P.A2.mk, 'rltp/visibility/mac/cont2')
  check(verifyRaw(P.R_T.did, Buffer.from(jcs(A.introductionRequest.body), 'utf8'), A.introductionRequest.proof.proofValue), 'introduction-request: signature')
  check(verifyRaw(P.T_I.did, Buffer.from(jcs(A.introductionReply.body), 'utf8'), A.introductionReply.proof.proofValue), 'introduction-reply: signature')
  macCheck('introduction-ack: mac (pinned channel)', A.introductionAck.body, A.introductionAck.proof.mac, P.M_R.x, P.R_M.mk, 'rltp/visibility/mac/ack')
  macCheck('voucher→requester: mac', A.introductionVoucherToRequester.body, A.introductionVoucherToRequester.proof.mac, P.M_R.x, P.R_M.mk, 'rltp/visibility/mac/voucher')
  macCheck('voucher→target: mac', A.introductionVoucherToTarget.body, A.introductionVoucherToTarget.proof.mac, P.M_T.x, P.T_M.mk, 'rltp/visibility/mac/voucher')
  check(A.introductionRequest.body.cardDigest === digestU(V.introductionCards.requester), 'cardDigest = digest of the COMPLETE requester card (incl. proof)')
  check(A.introductionReply.body.cardDigest === digestU(V.introductionCards.target), 'reply cardDigest = digest of the complete target card')
  check(A.introductionReply.body.requestDigest === digestU(A.introductionRequest.body), 'requestDigest = digest of the request body')
  check(diVerify(V.introductionCards.requester, V.introductionCards.requester.anchor).ok, 'requester card: DI proof (real card)')
  check(diVerify(V.introductionCards.target, V.introductionCards.target.anchor).ok, 'target card: DI proof (real card)')
}
schemaOK(V.artifacts.star, 'visibility-star.schema.json', 'star')
schemaOK(V.artifacts.anchorMapping, 'visibility-anchor-mapping.schema.json', 'anchor-mapping@3')
schemaOK(V.artifacts.anchorRotation, 'visibility-anchor-rotation.schema.json', 'anchor-rotation@1')
schemaOK(V.artifacts.continuityProbe, 'visibility-continuity-probe.schema.json', 'probe')
schemaOK(V.artifacts.introductionRequest, 'visibility-introduction-request.schema.json', 'request')
schemaOK(V.payloads.introductionRequest, 'visibility-payload-introduction-request.schema.json', 'payload request')
schemaOK(V.payloads.introductionForward, 'visibility-payload-introduction-forward.schema.json', 'payload forward')
schemaOK(V.payloads.introductionReply, 'visibility-payload-introduction-reply.schema.json', 'payload reply')
for (const n of V.negative) {
  const a = n.artifact
  if (n.name === 'mapping-foreign-self') {
    schemaOK(a, 'visibility-anchor-mapping.schema.json', `${n.name} (step 1 passes)`)
    check(a.body.card.body.anchor !== a.body.self, `${n.name}: step 5 (card.anchor != self) is the failing check`)
    macCheck(`${n.name}: MACs over the MUTATED body verify (steps 1–4a pass)`, a.body, a.proof.mac1, P.A.x, P.B.mk, 'rltp/visibility/mac/map1')
  } else if (n.name === 'mapping-lineage-not-ending-at-self') {
    schemaOK(a, 'visibility-anchor-mapping.schema.json', `${n.name} (step 1 passes)`)
    check(verifyRaw(a.body.card.body.anchor, Buffer.from(jcs(a.body.card.body), 'utf8'), a.body.card.proof.proofValue) && a.body.card.body.anchor === a.body.self, `${n.name}: steps 4 and 5 hold on their own`)
    check(a.body.lineage.every((r, i) => rotationOK(r) && r.body.generation === String(i + 2)) && a.body.lineage.at(-1).body.next !== a.body.self, `${n.name}: step 4a fails only at "the last next equals self"`)
    check(hmacU(hkdf(ecdhRaw(selfX, xRawOfMk(P.B.mk)), 'rltp/visibility/mac/map2'), jcs(a.body)) === a.proof.mac2, `${n.name}: the MACs over the mutated body verify — only the lineage rejects it`)
  } else if (n.name === 'legacy-version-2') {
    check(a.body.type === 'anchor-mapping@2', `${n.name}: anchor-mapping@2 is rejected like @1 (2.1 rejection before crypto)`)
    schemaFails(a, 'visibility-anchor-mapping.schema.json', n.name)
  } else if (n.name === 'probe-shape-255') schemaFails(a, 'visibility-continuity-probe.schema.json', n.name)
  else if (n.name === 'reply-wrong-request-digest') {
    check(verifyRaw(P.T_I.did, Buffer.from(jcs(a.body), 'utf8'), a.proof.proofValue), `${n.name}: signature over mutated body PASSES`)
    check(a.body.requestDigest !== digestU(A.introductionRequest.body), `${n.name}: requestDigest comparison FAILS`)
  } else if (n.name === 'legacy-version') check(a.body.type === 'anchor-mapping@1', `${n.name}: unimplemented type (2.1 rejection before crypto)`)
  else if (n.name === 'star-salt-replay') check(jcs(a) === jcs(A.star), `${n.name}: byte-identical to the accepted star (state fixture)`)
  else err(`unknown negative ${n.name}`)
}

// ── suite 4a: anchor-rotation.json — the community anchor's rotation (Visibility 0.30 §6.5) ──
section('anchor-rotation.json — anchor-rotation@1 under both generations, the generation domain')
{
  const RT = J('vectors/anchor-rotation.json')
  check(RT.community.genesisDigest === ID.genesisDigestSample, 'anchor-rotation: the community of visibility.json (the genesis digest sample)')
  for (const [g, p] of Object.entries(RT.community.generations)) {
    const label = g === '1' ? 'group/' + RT.community.genesisDigest : `group/${RT.community.genesisDigest}/${g}`
    check(p.label === label && didOf(hkdf(IKM, 'rltp/anchor/ed/' + label)) === p.anchor && mkOf(hkdf(IKM, 'rltp/anchor/x/' + label)) === p.keyAgreement, `anchor-rotation: generation ${g} derives from ${g === '1' ? 'group/<D>' : 'group/<D>/' + g}`)
  }
  const G = RT.community.generations
  for (const v of RT.valid) {
    schemaOK(v.artifact, 'visibility-anchor-rotation.schema.json', `anchor-rotation ${v.name}`)
    const g = Number(v.artifact.body.generation)
    check(rotationOK(v.artifact) && v.artifact.body.prev === G[g - 1].anchor && v.artifact.body.next === G[g].anchor, `anchor-rotation ${v.name}: proofValue under prev, successorProofValue under next, generation ${g} names next`)
  }
  for (const n of RT.negative) {
    const a = n.artifact
    const bytes = Buffer.from(jcs(a.body), 'utf8')
    if (n.name === 'successor-signature-wrong') {
      schemaOK(a, 'visibility-anchor-rotation.schema.json', `${n.name} (schema passes)`)
      check(verifyRaw(a.body.prev, bytes, a.proof.proofValue) && !verifyRaw(a.body.next, bytes, a.proof.successorProofValue) && !rotationOK(a), `${n.name}: proofValue verifies, successorProofValue does not — rejected`)
      check(verifyRaw(G['3'].anchor, bytes, a.proof.successorProofValue), `${n.name}: the second signature is genuine, under generation 3`)
    } else if (n.name === 'generation-1') {
      schemaFails(a, 'visibility-anchor-rotation.schema.json', n.name)
      check(verifyRaw(a.body.prev, bytes, a.proof.proofValue) && verifyRaw(a.body.next, bytes, a.proof.successorProofValue) && !rotationOK(a), `${n.name}: both signatures genuine, generation 1 alone rejects it`)
    } else if (n.name === 'generation-above-domain') {
      schemaOK(a, 'visibility-anchor-rotation.schema.json', `${n.name} (an int-string of the schema)`)
      check(BigInt(a.body.generation) > GENERATION_MAX && verifyRaw(a.body.prev, bytes, a.proof.proofValue) && verifyRaw(a.body.next, bytes, a.proof.successorProofValue) && !rotationOK(a), `${n.name}: both signatures genuine, the domain [2, 2^53 − 1] rejects it`)
    } else err(`unknown anchor-rotation negative ${n.name}`)
  }
}

// ── suite 4b: group-star.json — the sender's groups (Visibility 0.30 §5.2b) ──
section('group-star.json — k_g, k_e(G), blinded digests, sealed group pairs, filler, padding, reception')
{
  const GS = J('vectors/group-star.json')
  const P2 = {}
  for (const [k, v] of Object.entries(GS.parties)) {
    const label = 'pair/' + mhU(Buffer.from(v.relationshipNonce, 'hex'))
    const ed = hkdf(IKM, 'rltp/anchor/ed/' + label), x = hkdf(IKM, 'rltp/anchor/x/' + label)
    P2[k] = { ed, x, did: didOf(ed), mk: mkOf(x) }
    check(label === v.label && P2[k].did === v.anchor && P2[k].mk === v.keyAgreement, `group-star party ${k}: derivation`)
  }
  // G1: a real genesis founded under SG1 — its digest, id and signatures recompute
  const gen = GS.groups.G1.genesis
  const gIn = opInput(gen)
  schemaOK(gen, 'access-operation-envelope.schema.json', 'group-star G1 genesis')
  check('oid:' + sha(gIn).toString('base64url') === gen.id && gen.proof.signatures.every((s) => verifyRaw(s.signer, gIn, s.sig)) && new Set(gen.proof.signatures.map((s) => s.signer)).has(gen.author), 'G1 genesis: id and both signatures recompute (group DID + founder)')
  check(mhU(gIn) === GS.groups.G1.genesisDigest, 'G1: genesis digest = multihash over the signature input (RLTP-ACC-3030)')
  check(gen.author === P2.SG1.did && gen.body.members[0] === P2.SG1.did && gen.body.card.anchor === P2.SG1.did && gen.body.card.keyAgreement === P2.SG1.mk && diVerify(gen.body.card, P2.SG1.did).ok, 'G1: founded under the founding pair context SG1, which is its sole member (RLTP-ACC-3235, 3275)')
  for (const k of ['G2', 'G3']) check(mhU(Buffer.from(GS.groups[k].preimage, 'utf8')) === GS.groups[k].genesisDigest, `${k}: sample digest reproduces from its preimage`)
  const sg2Label = 'group/' + GS.groups.G2.genesisDigest
  const sg2 = { x: hkdf(IKM, 'rltp/anchor/x/' + sg2Label), did: didOf(hkdf(IKM, 'rltp/anchor/ed/' + sg2Label)) }
  check(sg2.did === GS.groups.G2.member.anchor && GS.groups.G2.member.label === sg2Label, 'G2: the sender joined — its member anchor is group/<G2> (Access 5.1)')
  check('oid:' + sha(Buffer.from(GS.groups.G2.memberOpPreimage, 'utf8')).toString('base64url') === GS.groups.G2.memberOp, 'G2: placeholder admission oid reproduces from its preimage')
  const Gd = { G1: GS.groups.G1.genesisDigest, G2: GS.groups.G2.genesisDigest, G3: GS.groups.G3.genesisDigest }

  const open = (key, aad, c) => {
    try {
      const raw = Buffer.from(c.slice(1), 'base64url')
      if (raw.length <= 28) return null
      const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
      d.setAAD(Buffer.from(aad, 'utf8')); d.setAuthTag(raw.subarray(raw.length - 16))
      return Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString('utf8')
    } catch { return null }
  }
  const tuple = { trusted: ['S_T', 'T_S'], untrusted: ['S_U', 'U_S'], allFiller: ['S_T', 'T_S'] }
  const keys = (S, R, salt, G) => ({
    kg: hkdf(ecdh(S.x, R.mk), `rltp/visibility/blind/group-star/${S.did}/${R.did}/${salt}`),
    ke: G && hkdf(ecdh(S.x, R.mk), `rltp/visibility/seal/group-star/${S.did}/${R.did}/${salt}/${G}`),
  })
  const union = {}
  for (const [name, chunks] of Object.entries(GS.stars)) {
    const [sk, rk] = tuple[name]
    const S = P2[sk], R = P2[rk]
    const salt = chunks[0].body.salt
    const { kg } = keys(S, R, salt)
    const kgR = hkdf(ecdh(R.x, S.mk), `rltp/visibility/blind/group-star/${S.did}/${R.did}/${salt}`)
    check(kgR.equals(kg), `${name}: k_g is the same from both sides of the tuple`)
    chunks.forEach((c, i) => {
      schemaOK(c, 'visibility-group-star.schema.json', `${name} chunk ${i + 1}`)
      check(hmacU(kg, jcs(c.body)) === c.proof.mac && c.body.salt === salt && c.body.seq === String(i + 1) && c.body.last === (i === chunks.length - 1) && c.body.groups.length >= 1 && c.body.groups.length <= 64, `${name} chunk ${i + 1}: mac under k_g, one salt, seq/last in order, 1…64 entries`)
    })
    const u = chunks.flatMap((c) => c.body.groups)
    union[name] = u
    check(u.length >= 16 && u.length % 16 === 0, `${name}: ${u.length} entries — padded to the next positive multiple of 16`)
    check(u.every((e, i) => i === 0 || u[i - 1].d < e.d), `${name}: the union is strictly ascending by d — one global order`)
    // every c has the length of a real one: every group-pair field but salt is fixed-length
    const tmpl = { type: 'group-pair@1', group: 'u' + 'A'.repeat(46), member: R.did, memberOp: 'oid:' + 'A'.repeat(43), to: R.did, salt, proof: 'u' + 'A'.repeat(43) }
    const cLen = 1 + Math.ceil((12 + Buffer.byteLength(jcs(tmpl)) + 16) * 4 / 3)
    check(u.every((e) => e.c.length === cLen), `${name}: every c is ${cLen} characters — filler indistinguishable by length`)
  }
  // trusted: both groups listed and sealed; the pairs open and prove
  {
    const S = P2.S_T, R = P2.T_S, u = union.trusted
    for (const [g, member, memberX, memberOp] of [['G1', P2.SG1.did, P2.SG1.mk, gen.id], ['G2', sg2.did, mkOf(sg2.x), GS.groups.G2.memberOp]]) {
      const { kg, ke } = keys(S, R, '1', Gd[g])
      const d = hmacU(kg, Gd[g])
      const e = u.find((x) => x.d === d)
      check(!!e, `trusted ${g}: d = HMAC(k_g, UTF-8 of G) is in the union`)
      const pt = e && open(ke, d, e.c)
      check(pt !== null, `trusted ${g}: c opens under k_e(G) with AAD = the bytes of d`)
      const pair = pt && JSON.parse(pt)
      if (!pair) continue
      check(pt === jcs(pair), `trusted ${g}: the sealed bytes are the canonical bytes of the pair`)
      schemaOK(pair, 'visibility-group-pair.schema.json', `trusted ${g} group-pair@1`)
      check(pair.group === Gd[g] && pair.member === member && pair.memberOp === memberOp && pair.to === R.did && pair.salt === '1', `trusted ${g}: group, member, memberOp, to, salt`)
      const { proof, ...unproved } = pair
      check(hmacU(hkdf(ecdh(R.x, memberX), 'rltp/visibility/mac/group-pair'), jcs(unproved)) === proof, `trusted ${g}: proof = HMAC under ECDH(memberX_sender, pairX_recipient), checked from the recipient's side`)
      const kOther = hkdf(ecdh(R.x, memberX === P2.SG1.mk ? mkOf(sg2.x) : P2.SG1.mk), 'rltp/visibility/mac/group-pair')
      check(hmacU(kOther, jcs(unproved)) !== proof, `trusted ${g}: under another member's card the proof fails`)
    }
  }
  // untrusted: the digests are there, the c are filler
  {
    const S = P2.S_U, R = P2.U_S, u = union.untrusted
    for (const g of ['G1', 'G2']) {
      const { kg, ke } = keys(S, R, '1', Gd[g])
      const d = hmacU(kg, Gd[g])
      const e = u.find((x) => x.d === d)
      check(!!e && open(ke, d, e.c) === null, `untrusted ${g}: d is in the union, c is filler and opens nothing`)
    }
  }
  // all-filler: nothing listed
  {
    const S = P2.S_T, R = P2.T_S, u = union.allFiller
    const salt = GS.stars.allFiller[0].body.salt
    check(u.length === 16 && ['G1', 'G2', 'G3'].every((g) => !u.some((e) => e.d === hmacU(keys(S, R, salt).kg, Gd[g]))), 'allFiller: 16 entries, no group of the sender is in it')
  }
  // the cases: the reception of 5.2b, recomputed here
  const states = GS.states
  for (const c of GS.cases) {
    const S = P2[c.from], R = P2[c.recipient], chunks = GS.stars[c.star]
    const salt = chunks[0].body.salt
    const u = chunks.flatMap((x) => x.body.groups)
    const got = c.memberships.map((g) => {
      const { kg, ke } = keys(S, R, salt, Gd[g])
      const d = hmacU(kg, Gd[g])
      const e = u.find((x) => x.d === d)
      if (!e) return { group: Gd[g], hit: false, opened: false, accepted: false }
      const pt = open(ke, d, e.c)
      if (pt === null) return { group: Gd[g], hit: true, opened: false, accepted: false }
      const rej = (reason) => ({ group: Gd[g], hit: true, opened: true, accepted: false, reason })
      const pair = JSON.parse(pt)
      const s = SCHEMAS['visibility-group-pair.schema.json']
      if (validate(pair, s, s).length) return rej('schema')
      if (pair.group !== Gd[g]) return rej('group')
      if (pair.to !== R.did || pair.salt !== salt) return rej('to')
      const st = states[c.state]
      const op = g === 'G1' && pair.memberOp === gen.id ? { subject: gen.body.members[0], keyAgreement: gen.body.card.keyAgreement } : null
      if (!op || op.subject !== pair.member || !st?.members.includes(pair.member)) return rej('member')
      const sh = ecdh(R.x, op.keyAgreement)
      const { proof, ...unproved } = pair
      if (sh.every((b) => b === 0) || hmacU(hkdf(sh, 'rltp/visibility/mac/group-pair'), jcs(unproved)) !== proof) return rej('mac')
      return { group: Gd[g], hit: true, opened: true, accepted: true, member: pair.member }
    })
    check(jcs(got) === jcs(c.result), `case ${c.name}: ${c.result.map((r) => `${r.hit ? 'hit' : 'miss'}${r.hit ? (r.opened ? ', opened' : ', filler') : ''}${r.opened ? (r.accepted ? ', accepted' : `, rejected at ${r.reason}`) : ''}`).join('; ')}`)
  }
}

// ── suite 4c: access-anchor-rotate.json — anchor.rotate (Access 0.56 §5.6) ──
section('access-anchor-rotate.json — the lineage entry of the personal community (RLTP-ACC-5950 … 5970)')
{
  const AR = J('vectors/access-anchor-rotate.json')
  const { materializeRotations } = await import('./access-anchor-rotate.mjs')
  const PC = AR.personalCommunity
  const fLabel = 'pair/' + mhU(Buffer.from(PC.founderRelationshipNonce, 'hex'))
  check(fLabel === PC.founder.label && didOf(hkdf(IKM, 'rltp/anchor/ed/' + fLabel)) === PC.founder.anchor, 'the founder is a fresh pair context of the holder (RLTP-ACC-3275)')
  const gen = AR.operations.genesis
  check(mhU(opInput(gen)) === PC.genesisDigest && gen.body.members.length === 1 && gen.body.members[0] === PC.founder.anchor && gen.author === PC.founder.anchor, 'personal community: genesis digest over the signature input; the founding pair anchor is the sole member — never the community anchor (Identity 0.52 §2)')
  for (const [g, p] of Object.entries(PC.generations)) {
    const label = g === '1' ? 'group/' + PC.genesisDigest : `group/${PC.genesisDigest}/${g}`
    check(p.label === label && didOf(hkdf(IKM, 'rltp/anchor/ed/' + label)) === p.anchor, `personal community: community anchor generation ${g}`)
  }
  check(!gen.body.members.includes(PC.generations['1'].anchor), 'the community anchor is not a member of its personal community')
  for (const [label, op] of Object.entries(AR.operations)) {
    if (op.fixture) { check('oid:' + sha(Buffer.from(op.idPreimage, 'utf8')).toString('base64url') === op.id, `${label}: state-fixture id reproduces from its preimage`); continue }
    schemaOK(op, 'access-operation-envelope.schema.json', `${label} (${op.op})`)
    const input = opInput(op)
    const signers = op.op === 'group.genesis' ? [op.group, op.author].sort() : [op.author]
    check('oid:' + sha(input).toString('base64url') === op.id && jcs(op.proof.signatures.map((s) => s.signer)) === jcs(signers) && op.proof.signatures.every((s) => verifyRaw(s.signer, input, s.sig)), `${label}: id recomputes; signed by ${op.op === 'group.genesis' ? 'the group DID and the founder' : 'the founding pair anchor'} over the id input`)
  }
  check(jcs(Object.keys(AR.operations.rot2.body)) === jcs(['rotation']), 'the body of anchor.rotate is exactly { rotation } (RLTP-ACC-5955)')
  schemaFails({ ...AR.operations.rot2, body: { lineage: AR.operations.rot2.body.rotation } }, 'access-operation-envelope.schema.json', 'anchor.rotate with a body field other than rotation')
  schemaFails({ ...AR.operations.rot2, body: { rotation: AR.operations.rot2.body.rotation, note: 'x' } }, 'access-operation-envelope.schema.json', 'anchor.rotate with an extra body field')
  for (const c of AR.cases) {
    const got = await materializeRotations(c.ops.map((l) => ({ label: l, ...AR.operations[l] })), rotationOK)
    check(jcs(got) === jcs(c.expect), `case ${c.name}: ${Object.entries(c.expect.status).map(([l, s]) => `${l} ${s}`).join(', ')}${c.expect.repeat.length ? `; repeat ${c.expect.repeat.join(', ')}` : ''}; head ${c.expect.head ? 'generation ' + c.expect.head.generation : 'none'}; state unchanged [${c.rules.join(', ')}]`)
  }
}

// ── suite 5: dtg-credentials.json — VIC/VEC forms, u/z equivalence, genesis-to-bytes ──
section('dtg-credentials.json — DTG forms, u/z equivalence, canonical-u constructions')
{
  const D = J('vectors/dtg-credentials.json')
  // strict multibase bridge: prefix, decode, multihash header/length, AND
  // canonical-form round-trip — a mutated prefix or non-canonical rendering fails
  const toU = (z) => {
    if (typeof z !== 'string' || z[0] !== 'z') return null
    const b = fromB58(z.slice(1))
    if (!b || b.length !== 34 || b[0] !== 0x12 || b[1] !== 0x20) return null
    if ('z' + b58(b) !== z) return null // canonical base58btc only
    return 'u' + b.toString('base64url')
  }
  const uBytes = (u) => (typeof u === 'string' && u[0] === 'u') ? Buffer.from(u.slice(1), 'base64url') : null

  // u/z: same decoded multihash bytes
  const uz = D.uzEquivalence
  check(toU(uz.genesisDigest.z) === uz.genesisDigest.u, 'genesisDigest: canonical z decodes to the same multihash as u')
  check(toU(uz.acceptDigest.z) === uz.acceptDigest.u, 'acceptDigest: canonical z decodes to the same multihash as u')
  check(toU('x' + uz.genesisDigest.z.slice(1)) === null && toU(uz.genesisDigest.u) === null, 'the bridge rejects wrong prefixes (self-test)')
  check(toU(uz.notEqual.z) === uz.notEqual.u && uz.notEqual.u !== uz.genesisDigest.u, 'a DIFFERENT multihash stays distinguishable across encodings')

  // every derivation claim of the file recomputes (nothing vector-vs-itself)
  const md = D.memberAnchorDerivation
  check(md.label === 'group/' + uz.genesisDigest.u && md.edInfo === 'rltp/anchor/ed/' + md.label && md.xInfo === 'rltp/anchor/x/' + md.label, 'label + info strings use the canonical u rendering')
  check(uz.genesisDigest.multihashHex === uBytes(uz.genesisDigest.u).toString('hex'), 'multihashHex matches the decoded u bytes')
  check(didOf(hkdf(IKM, md.edInfo)) === md.expectedInviteeAnchor && md.expectedInviteeAnchor === D.parties.inviteeCandidate.anchor, 'invitee member anchor recomputes from the oracle IKM (parties entry included)')
  check(mkOf(hkdf(IKM, md.xInfo)) === D.parties.inviteeCandidate.keyAgreement, 'invitee keyAgreement recomputes from the oracle IKM')
  check(md.fromZ.canonicalized === uz.genesisDigest.u && md.fromZ.sameAnchor === true, 'fromZ fixture is internally consistent')
  check(didOf(hkdf(IKM, 'rltp/anchor/ed/group/' + toU(md.fromZ.carried))) === md.expectedInviteeAnchor, 'a z-carried genesisDigest derives the SAME anchor after canonical-u re-encoding')
  // second party + group DID: the documented vector-only constructions reproduce
  const IKM2 = Buffer.from(crypto.hkdfSync('sha256', IKM, Buffer.alloc(0), Buffer.from('rltp/vector/second-party-root-ikm', 'utf8'), 64))
  check(didOf(hkdf(IKM2, md.edInfo)) === D.parties.inviterVoucher.anchor, 'inviter/voucher anchor recomputes from the documented second-party IKM')
  check(mkOf(hkdf(IKM2, md.xInfo)) === D.parties.inviterVoucher.keyAgreement, 'inviter keyAgreement recomputes')
  check(didOf(hkdf(IKM, 'rltp/vector/group-did-sample')) === D.parties.groupDid, 'group DID sample recomputes')

  // invite: schema, DI proof incl. @context copy, credential digest = invitation identity
  const inv = D.invite.payload.invite
  schemaOK(D.invite.payload, 'payload-membership-invite.schema.json', 'invite payload (VIC)')
  schemaOK(inv.credentialSubject.card, 'contact-card.schema.json', "inviter card inside the invite")
  check(diVerify(inv, inv.issuer).ok, 'invite credential DI proof verifies under its issuer')
  check(jcs(inv.proof['@context']) === jcs(inv['@context']), 'invite proof carries the @context copy')
  check(diVerify(inv.credentialSubject.card, inv.issuer).ok, 'inviter card proof verifies; card.anchor = invite issuer')
  check(inv.credentialSubject.card.anchor === inv.issuer, 'card ownership binding (Membership 3.1)')
  check(digestU(inv) === D.invite.credentialDigest, 'invitation identity = digest over the COMPLETE credential incl. proof (Membership 2)')
  const tsec = (t) => Math.floor(Date.parse(t) / 1000)
  // calendar validity is a parse-time check (schema descriptions; the
  // syntactic patterns admit day 31 in every month) — Date.parse silently
  // NORMALIZES impossible dates, so demand a round-trip
  const calOK = (t) => { const d = new Date(t); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 19) === t.slice(0, 19) && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$/.test(t) }
  check(tsec(inv.validUntil) >= tsec(inv.validFrom), 'invite validUntil ≥ validFrom (Membership 3.1, whole-second comparison)')
  // cross-field bindings: signed material is tied BACK to the party and
  // digest oracles — a coherently re-signed detachment fails here
  check(inv.credentialSubject.id === D.parties.inviteeCandidate.anchor, 'invite subject = the invitee party anchor')
  check(inv.credentialSubject.group === D.parties.groupDid, 'invite group = the group DID')
  check(inv.issuer === D.parties.inviterVoucher.anchor && inv.credentialSubject.card.anchor === D.parties.inviterVoucher.anchor, 'invite issuer and card anchor = the inviter party')
  check(inv.credentialSubject.card.keyAgreement === D.parties.inviterVoucher.keyAgreement, 'invite card keyAgreement = the inviter party')
  check(inv.credentialSubject.genesisDigest === uz.genesisDigest.u, 'invite genesisDigest = the uz oracle')
  // accept fixture: the COMPLETE consent document that binds the
  // invitation identity — and whose document digest the vouches bind
  const accDoc = D.accept.document
  const acc = accDoc.payload
  const eqDigest = (a, b) => (a[0] === 'u' ? a : toU(a)) === (b[0] === 'u' ? b : toU(b)) && (a[0] === 'u' ? a : toU(a)) !== null
  schemaOK(accDoc, 'rltp-delivery-document.schema.json', 'accept document (delivery profile)')
  schemaOK(acc, 'payload-membership-accept.schema.json', 'accept payload')
  check(accDoc.type === 'https://real-life.org/trust-tasks/membership-accept/0.2', 'accept document type is the registered 0.2 task type')
  check(diVerify(accDoc, accDoc.issuer).ok && accDoc.issuer === acc.accept.subject, 'accept task proof verifies under the subject (Membership 2)')
  check(accDoc.issuer === D.parties.inviteeCandidate.anchor && accDoc.recipient === D.parties.inviterVoucher.anchor, 'accept document issuer/recipient = the party oracle')
  check(accDoc.threadId === inv.taskContext, 'accept travels on the invite thread (taskContext binding)')
  check(eqDigest(acc.accept.ref, D.invite.credentialDigest), 'accept.ref = the invite credential digest (decoded-bytes equality, Membership 3.2)')
  check(acc.accept.subject === D.parties.inviteeCandidate.anchor && acc.accept.group === D.parties.groupDid, 'accept subject/group = the party oracle')
  check(diVerify(acc.accept.card, acc.accept.subject).ok && acc.accept.card.anchor === acc.accept.subject, 'accept card is subject-owned and verifies')
  check(acc.accept.card.keyAgreement === D.parties.inviteeCandidate.keyAgreement, 'accept card keyAgreement = the invitee party oracle')
  const MEMBERSHIP_SKEW = 300 // PT5M, Membership section 5
  check(tsec(accDoc.issuedAt) <= tsec(inv.validUntil) + MEMBERSHIP_SKEW && tsec(accDoc.proof.created) <= tsec(inv.validUntil) + MEMBERSHIP_SKEW, 'accept issuedAt and proof.created ≤ invite validUntil + membership-skew (Membership 3.2)')
  // Membership card profile (section 2): enclosed cards carry no
  // enactment or transport members — the generic card schema permits
  // them, Membership forbids them
  for (const [card, label] of [[inv.credentialSubject.card, 'invite card'], [acc.accept.card, 'accept card']])
    check(!('sentTo' in card) && !('boundTo' in card) && !('deliveryHints' in card), `${label}: no sentTo/boundTo/deliveryHints (Membership enclosure profile)`)
  // the COMPLETE invite delivery document: one carrier, document bindings.
  // sizeOK and bindOK are THE predicates — fixture checks and self-tests
  // share them, so predicate drift is structurally impossible
  const invDoc = D.invite.document
  const sizeOK = (doc) => Buffer.byteLength(jcs(doc), 'utf8') <= 16384
  const bindOK = (d) => !('proof' in d) && d.issuer === inv.issuer && d.recipient === inv.credentialSubject.id && d.threadId === inv.taskContext
  schemaOK(invDoc, 'rltp-delivery-document.schema.json', 'invite document (delivery profile)')
  check(invDoc.type === 'https://real-life.org/trust-tasks/membership-invite/0.2', 'invite document type is the registered 0.2 task type')
  check(jcs(invDoc.payload) === jcs(D.invite.payload), 'invite document wraps exactly the payload fixture')
  check(bindOK(invDoc), 'invite document: no document proof, issuer/recipient/threadId bound to the credential (Membership 2, 3.1)')
  // Membership section 2 size budget: 16 384 bytes JCS per COMPLETE document
  check(sizeOK(accDoc), 'accept document ≤ 16384 JCS bytes (Membership 2)')
  check(sizeOK(invDoc), 'invite document ≤ 16384 JCS bytes (Membership 2)')
  // every timestamp of the chain is calendar-valid (round-trip, not just pattern)
  const stamps = [
    ['invite validFrom', inv.validFrom], ['invite validUntil', inv.validUntil], ['invite proof.created', inv.proof.created],
    ['invite card proof.created', inv.credentialSubject.card.proof.created],
    ['invite document issuedAt', invDoc.issuedAt],
    ['accept issuedAt', accDoc.issuedAt], ['accept proof.created', accDoc.proof.created],
    ['accept card proof.created', acc.accept.card.proof.created],
    ['vouch(u) validFrom', D.vouch.u.validFrom], ['vouch(u) proof.created', D.vouch.u.proof.created],
    ['vouch(z) validFrom', D.vouch.z.validFrom], ['vouch(z) proof.created', D.vouch.z.proof.created],
  ]
  check(stamps.every(([, t]) => calOK(t)), 'every timestamp of the chain is calendar-valid (round-trip: ' + (stamps.find(([, t]) => !calOK(t))?.[0] ?? 'all pass') + ')')

  // ── checker self-tests: the round-7 counterexamples, preserved as
  // executable material — weakening any of these predicates fails HERE,
  // not silently against fixtures that never exercise the boundary ──
  // (1) signature canonicity: deterministic search for an Ed25519
  // signature whose canonical base58btc begins 'z1' (leading zero byte;
  // Ed25519 is deterministic, so this always finds the same one)
  {
    const seed = hkdf(IKM, 'rltp/vector/selftest-signer')
    const did = didOf(seed)
    let zsig = null, msg = null
    for (let i = 0; i < 4096 && !zsig; i++) {
      const m = Buffer.from('selftest-' + i, 'utf8')
      const sg = crypto.sign(null, m, privEd(seed))
      if (sg[0] === 0x00) { zsig = 'z' + b58(sg); msg = m }
    }
    check(zsig !== null && zsig.startsWith('z1'), 'self-test: found the deterministic leading-zero signature')
    check(verifyRaw(did, msg, zsig) === true, 'self-test: a canonical z1… signature VERIFIES (no over-rejection)')
    check(verifyRaw(did, msg, 'z' + zsig.slice(2)) === false, 'self-test: stripping the canonical leading 1 (63 bytes) is REJECTED')
  }
  // (2) size predicate at the EXACT normative boundary: pad the shipped
  // document to precisely 16384 (last valid) and 16385 (first invalid)
  // bytes — a moved threshold in the SHARED predicate fails here
  const base = Buffer.byteLength(jcs({ ...invDoc, ceremony: { pad: '' } }), 'utf8')
  const at = (n) => ({ ...invDoc, ceremony: { pad: 'x'.repeat(n - base) } })
  check(Buffer.byteLength(jcs(at(16384)), 'utf8') === 16384 && sizeOK(at(16384)), 'self-test: exactly 16384 bytes is the last VALID size')
  check(Buffer.byteLength(jcs(at(16385)), 'utf8') === 16385 && !sizeOK(at(16385)), 'self-test: exactly 16385 bytes is the first INVALID size')
  // (3) document bindings: each mutation flips the SHARED predicate
  check(!bindOK({ ...invDoc, proof: {} }) && !bindOK({ ...invDoc, issuer: invDoc.recipient }) && !bindOK({ ...invDoc, recipient: invDoc.issuer }) && !bindOK({ ...invDoc, threadId: '00000000-0000-4000-8000-000000000000' }), 'self-test: proof/issuer/recipient/threadId mutations each fail the binding predicate')
  // (4) timestamp predicate boundaries
  check(calOK('2026-08-25T12:06:00.123Z') && !calOK('2026-08-25T12:06:00.1234Z') && !calOK('2026-02-30T12:00:00Z') && calOK('2028-02-29T12:00:00Z') && !calOK('2026-02-29T12:00:00Z'), 'self-test: fraction cap and calendar boundaries (three digits pass, four fail; leap day 2028 passes, 2026 fails)')

  // vouch: u and z variants, same binding over decoded bytes
  for (const [v, label] of [[D.vouch.u, 'vouch (u digests)'], [D.vouch.z, 'vouch (z digests)']]) {
    schemaOK(v, 'access-vouch.schema.json', label)
    check(diVerify(v, v.issuer).ok, `${label}: DI proof verifies`)
    check(jcs(v.proof['@context']) === jcs(v['@context']), `${label}: proof carries the @context copy`)
  }
  const eU = D.vouch.u.credentialSubject.endorsement, eZ = D.vouch.z.credentialSubject.endorsement
  check(toU(eZ.genesisDigest) === eU.genesisDigest && toU(eZ.accept) === eU.accept, 'both vouches bind the SAME group and accept (decoded-bytes equality)')
  check(eU.genesisDigest === uz.genesisDigest.u && eZ.genesisDigest === uz.genesisDigest.z, 'vouch genesis digests = the uz oracle (both renderings)')
  check(eU.accept === uz.acceptDigest.u && eZ.accept === uz.acceptDigest.z, 'vouch accept digests = the uz oracle (both renderings)')
  for (const v of [D.vouch.u, D.vouch.z]) {
    check(v.issuer === D.parties.inviterVoucher.anchor, 'vouch issuer = the voucher party')
    check(v.credentialSubject.id === D.parties.inviteeCandidate.anchor, 'vouch subject = the candidate party')
  }
  check(digestU(accDoc) === eU.accept && digestU(accDoc) === uz.acceptDigest.u, 'vouch accept digest = the DOCUMENT digest of the complete accept document (Access 4.3)')

  // genesis-to-bytes: canonical u enters info + AADs (Access 3.2), byte-identical from z
  const E = D.epochBytes
  const ck = Buffer.from(E.contentKeyHex, 'hex')
  check(E.epochSecretInfo === 'rltp/v1/epoch-secret/' + uz.genesisDigest.u, 'epoch-secret info uses canonical u')
  check(hkdf(ck, E.epochSecretInfo).toString('hex') === E.epochSubkeyHex, 'epoch subkey recomputes')
  check(hkdf(ck, 'rltp/v1/epoch-secret/' + toU(E.fromZ.carried)).toString('hex') === E.epochSubkeyHex, 'z-carried digest yields the SAME subkey after canonicalization')
  check(hkdf(ck, 'rltp/v1/epoch-secret/' + E.fromZ.carried).toString('hex') !== E.epochSubkeyHex, 'raw z bytes would diverge (the defect the rule closes)')
  check(jcs(E.keydistAad.object) === E.keydistAad.jcs && jcs(E.lineageAad.object) === E.lineageAad.jcs, 'both AAD serializations recompute')
  check(E.keydistAad.object.recipient === D.parties.inviteeCandidate.anchor && E.keydistAad.object.genesis === uz.genesisDigest.u && E.lineageAad.object.genesis === uz.genesisDigest.u, 'AAD objects are tied to the party and digest oracles')
  check(jcs({ ...E.keydistAad.object, genesis: toU(E.fromZ.carried) }) === E.keydistAad.jcs, 'keydist AAD from a z-carried digest is byte-identical after canonicalization')
  check(jcs({ ...E.lineageAad.object, genesis: toU(E.fromZ.carried) }) === E.lineageAad.jcs, 'lineage AAD from a z-carried digest is byte-identical after canonicalization')
  check(/^oid:[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(E.lineageAad.object.opens) && Number.isInteger(E.lineageAad.object.newEpoch) && Object.keys(E.lineageAad.object).sort().join() === 'genesis,newEpoch,opens',
    'lineage AAD opens a key state by its transition id and carries newEpoch (RLTP-ACC-9760, 7042)')

  // negatives BOUND to their declared failure: (a) an error at the declared
  // path exists, (b) repairing exactly the declared defect yields ZERO
  // errors — the fixture is broken at that point and nowhere else
  const NEG = {
    'invite-two-contexts': { frag: '@context', repair: (a) => { a.invite['@context'] = inv['@context']; a.invite.proof['@context'] = inv['@context'] } },
    'invite-proof-without-context-copy': { frag: '.proof: missing required @context', repair: (a) => { a.invite.proof['@context'] = inv['@context'] } },
    'vouch-wrong-endorsement-type': { frag: 'endorsement.type', repair: (a) => { a.credentialSubject.endorsement.type = 'AdmissionVouch' } },
    'vouch-missing-accept': { frag: 'endorsement: missing required accept', repair: (a) => { a.credentialSubject.endorsement.accept = eU.accept } },
    'vouch-retyped-as-encounter': { frag: '$.type: contains unmatched', repair: (a) => { a.type = D.vouch.u.type } },
  }
  for (const n of D.negative) {
    const file = n.name.startsWith('invite') ? 'payload-membership-invite.schema.json' : 'access-vouch.schema.json'
    const sch = SCHEMAS[file]
    const spec = NEG[n.name]
    if (!spec) { err(`unknown negative ${n.name}`); continue }
    const errs = validate(n.artifact, sch, sch)
    checkR(n.rules ?? [], errs.length > 0 && errs.some((e) => e.includes(spec.frag)), `${n.name}: fails AT the declared point (${spec.frag})`)
    const repaired = JSON.parse(JSON.stringify(n.artifact))
    spec.repair(repaired)
    check(validate(repaired, sch, sch).length === 0, `${n.name}: repairing exactly the declared defect makes it valid (broken nowhere else)`)
  }

  // pinned context: structural invariants of the JSON-LD repair (round 3/6 lessons)
  const CTX = J('contexts/rltp-v1.jsonld')['@context']
  for (const t of ['EncounterCredential', 'MembershipInvite', 'AdmissionVouch'])
    check(CTX[t]['@context']['@propagate'] === true, `context ${t}: @propagate true (type-scoped terms reach credentialSubject)`)
  check(CTX.EncounterCredential['@context'].challenge['@protected'] === false, 'context: challenge deliberately unprotected (DI proof scope may take over)')
  check(!('name' in CTX.MembershipInvite['@context']), 'context: name NOT redefined (inherited protected schema.org/name)')
  const card = CTX.MembershipInvite['@context'].card['@context']
  check(!!card.version && !!card.anchor && !!card.keyAgreement && !!card.challenge && !!card.proof, 'context: card sub-vocabulary complete')
  // the context is pinned BY VALUE (Encounter 2.3) — so is this check: any
  // semantic edit (a changed IRI, a dropped term) fails here and forces a
  // deliberate pin update alongside the edit
  check(digestU({ '@context': CTX }) === 'uEiAcUXifIYaRyCmLiB5Bt5OV0EMhRj07Xn3P5aJEgTmzGg', 'context file digest matches the pinned value (semantic corruption gate)')
}

// ── suite: acceptance-anchoring.json — generations, anchor, CAS ─────────
section('acceptance-anchoring.json — registration generations, acceptance anchor, CAS commit')
{
  const A = J('vectors/acceptance-anchoring.json')
  const regs = A.registrations
  const coreOf = (reg) => { const { sig, authorization, ...core } = reg; return digestU(core) }
  const idSigOK = (reg) => { const { sig, ...toSign } = reg; return verifyRaw(reg.identity, Buffer.from(jcs(toSign), 'utf8'), sig) }
  const quorumOK = (reg) => {
    if (!reg.authorization) return true
    const { sig, authorization, ...unsigned } = reg
    const bytes = Buffer.from(jcs(unsigned), 'utf8')
    return reg.authorization.every((a) => verifyRaw(a.signer, bytes, a.sig))
  }

  // artifacts: schema + core digest + identity signature + quorum
  for (const [name, reg] of Object.entries(regs)) {
    schemaOK(reg, 'access-registration.schema.json', `registration ${name}`)
    check(coreOf(reg) === A.intermediate.coreDigests[name], `registration ${name}: registrationCoreDigest reproduces`)
    check(idSigOK(reg), `registration ${name}: identity signature verifies over JCS minus sig`)
    check(quorumOK(reg), `registration ${name}: quorum signatures verify over the complete unsigned registration`)
  }
  check(coreOf(regs.gen2) !== coreOf(regs.gen2twin), 'equivocation twin: same generation, distinct core digests')

  // the two-way acceptance anchor: standing iff the root core lies on the
  // previousRegistration chain from the session-attested generation
  const byCore = Object.fromEntries(Object.values(regs).map((r) => [coreOf(r), r]))
  const anchorVerdict = (rootCore, attestedCore) => {
    if (!attestedCore) return 'invalid-bundle'
    for (let c = attestedCore; c; c = byCore[c]?.previousRegistration ?? null) {
      if (c === rootCore) return 'standing'
      if (!byCore[c]) break
    }
    return 'invalid-bundle'
  }
  for (const c of A.anchorCases) {
    const root = A.intermediate.coreDigests[c.root]
    const attested = c.sessionAttested ? A.intermediate.coreDigests[c.sessionAttested] : null
    check(anchorVerdict(root, attested) === c.expect, `anchor: ${c.name} → ${c.expect}`)
    if (c.equivocationWith) {
      const twin = regs[c.equivocationWith], self = regs[c.root]
      check(self.registrationGeneration === twin.registrationGeneration && coreOf(self) !== coreOf(twin),
        `anchor: ${c.name} — equivocation evidence (one generation, two cores) detectable from the artifacts alone`)
    }
    if (c.extraArtifact === 'selfAcceptance') {
      const { sig, ...body } = A.selfAcceptance
      const selfSigned = verifyRaw('did:key:' + regs[c.root].attestationKey, Buffer.from(jcs(body), 'utf8'), sig)
      check(selfSigned, `anchor: ${c.name} — the self-signed artifact VERIFIES yet confers nothing (void by construction)`)
    }
  }

  // the CAS acceptance commit: expected-old re-checked inside the commit
  for (const c of A.casCases) {
    let state = { core: A.intermediate.coreDigests[c.state], generation: regs[c.state].registrationGeneration, status: 'active' }
    let durable = { ...state }
    const outcomes = []
    for (const [op, arg] of c.schedule) {
      if (op === 'precheck') {
        const cand = regs[arg]
        outcomes.push(cand.registrationGeneration === state.generation + 1 && cand.previousRegistration === state.core && state.status === 'active' ? 'ok' : 'refused-expected-old')
      } else if (op === 'commit') {
        const cand = regs[arg]
        if (cand.registrationGeneration === state.generation + 1 && cand.previousRegistration === state.core && state.status === 'active') {
          state = { core: coreOf(cand), generation: cand.registrationGeneration, status: 'active' }
          durable = { ...state } // one durable commit: tombstone + chain state together
          outcomes.push('accepted')
        } else outcomes.push('refused-expected-old')
      } else if (op === 'crash') { state = null; outcomes.push('crashed') }
      else if (op === 'recover') { state = { ...durable }; outcomes.push('recovered') }
    }
    const finalCore = A.intermediate.coreDigests[c.expect.finalState]
    check(jcs(outcomes) === jcs(c.expect.outcomes) && (state ?? durable).core === finalCore,
      `CAS: ${c.name} → [${c.expect.outcomes.join(', ')}], final ${c.expect.finalState}`)
  }

  // negatives — every mutation must fail at its declared stage
  for (const n of A.negative) {
    const doc = structuredClone(regs[n.registration])
    for (const [k, v] of Object.entries(n.set ?? {})) doc[k] = v
    for (const k of n.del ?? []) delete doc[k]
    if (n.mustFail === 'schema') schemaFails(doc, 'access-registration.schema.json', `negative: ${n.name}`)
    else if (n.mustFail === 'quorum-signature') check(!quorumOK(doc), `negative: ${n.name}`)
    else if (n.mustFail === 'identity-signature') check(!idSigOK(doc), `negative: ${n.name}`)
  }
}

// ── suite: durationGrammar — the declared durations are executable ───────
section('carrier-proof.json — the duration grammar maps to exact milliseconds')
{
  const DG = J('vectors/carrier-proof.json').durationGrammar
  // the grammar, executed: P, then an OPTIONAL <d>D, then an OPTIONAL T part
  // with <h>H <m>M <s>S descending; at least one component present overall;
  // 1–3 digits per value; no fraction; 1D = 86400 s (round-34 M-1: both parts
  // are optional — a mandatory day component would leave challenge-lifetime
  // and status-horizon with no satisfiable value)
  const RE = /^P(?:(\d{1,3})D)?(?:T(?:(\d{1,3})H)?(?:(\d{1,3})M)?(?:(\d{1,3})S)?)?$/
  const ms = (s) => {
    const m = RE.exec(s)
    if (!m) return null
    const [, d, h, mi, se] = m
    if (!d && !h && !mi && !se) return null                       // at least one component
    if (/T$/.test(s)) return null                                 // a bare T is no component
    return ((+(d || 0)) * 86400 + (+(h || 0)) * 3600 + (+(mi || 0)) * 60 + (+(se || 0))) * 1000
  }
  for (const a of DG.accept) check(ms(a.lexeme) === a.ms, `duration grammar: ${a.lexeme} = ${a.ms} ms exactly`)
  for (const r of DG.reject) check(ms(r.lexeme) === null, `duration grammar: ${r.lexeme} rejected — ${r.why}`)
  check(DG.accept.every((a) => Number.isInteger(a.ms)),
    'duration grammar: every accepted value is an integer number of milliseconds — durations are compared, never rounded')
  check(/rejected, not rounded/.test(DG.rejectionRule),
    'duration grammar: an out-of-grammar lexeme is rejected, never rounded or truncated (round-32 B-2)')
}

// ── suite: access-conflicts.json — the conflict matrix of Access 0.55 §3.6 ──
section('access-conflicts.json — authority DAGs materialize as declared (Access 3.5, 3.6)')
{
  const { opId, materialize, deliver, STATUSES, STATES } = await import('./access-conflicts.mjs')
  const AC = J('vectors/access-conflicts.json')
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  for (const c of AC.cases) {
    check(c.ops.every((o) => o.id === opId(o)), `${c.scenario}: every operation id recomputes`)
    check(c.ops.every((o) => STATUSES.includes(c.expected.status[o.id])) && Object.keys(c.expected.status).length === c.ops.length,
      `${c.scenario}: one declared status per operation`)
    const r = materialize(c.ops)
    check(STATES.includes(c.expected.state) && r.state === c.expected.state, `${c.scenario}: state ${c.expected.state}`)
    check(r.policy === c.expected.policy, `${c.scenario}: policy in effect ${c.expected.policy ?? 'genesis'}`)
    check(same(r.members, c.expected.members), `${c.scenario}: members ${JSON.stringify(Object.keys(c.expected.members))} — ${c.name}`)
    check(r.epoch === c.expected.epoch, `${c.scenario}: merged epoch ${c.expected.epoch}`)
    check(r.policyVersion === c.expected.policyVersion, `${c.scenario}: policy version ${c.expected.policyVersion}`)
    check(same(r.retained, c.expected.retained), `${c.scenario}: retained set ${JSON.stringify(c.expected.retained)}`)
    check(same(r.pendingExits, c.expected.pendingExits), `${c.scenario}: pending exits ${JSON.stringify(c.expected.pendingExits)}`)
    check(same(r.transitions, c.expected.transitions), `${c.scenario}: newEpoch and retained set at its position of every transition (RLTP-ACC-7010, 7040)`)
    check(same(r.status, c.expected.status), `${c.scenario}: status of every operation as declared`)
    for (const [i, order] of (c.deliveryOrders ?? []).entries()) {
      const d = deliver(c.ops, order)
      check(same(d, r) && same({ state: d.state, members: d.members, pendingExits: d.pendingExits, retained: d.retained, epoch: d.epoch, policy: d.policy, policyVersion: d.policyVersion, transitions: d.transitions, status: d.status }, c.expected), `${c.scenario}: delivery order ${i + 1} yields the declared result`)
    }
  }
  // the oracle can fail: the S4f DAG with the disposed admission declared canonical
  {
    const c = AC.cases.find((x) => x.scenario === 'S4f')
    const forged = structuredClone(c.expected.status)
    const disposedId = Object.keys(forged).find((id) => forged[id] === 'removed-disposed')
    forged[disposedId] = 'canonical'
    check(!same(materialize(c.ops).status, forged), 'access-conflicts: a disposed admission declared canonical is detected')
  }
  // … and a forked sibling declared canonical, or a fork declared ended without its closing policy.change
  {
    const c = AC.cases.find((x) => x.scenario === 'fork: policy ∥ removal')
    const forged = structuredClone(c.expected.status)
    forged[Object.keys(forged).find((id) => forged[id] === 'forked')] = 'canonical'
    check(!same(materialize(c.ops).status, forged), 'access-conflicts: a forked sibling declared canonical is detected')
    const ended = AC.cases.find((x) => x.scenario === 'fork ended: policy ∥ policy')
    check(materialize(ended.ops.slice(0, -1)).state === 'forked',
      'access-conflicts: without its closing policy.change the ended fork is forked')
  }
  // … a lapsed dissolution declared canonical, an issuer with a surviving admission declared orphaned
  {
    const c = AC.cases.find((x) => x.scenario === 'dissolve ∥ removal: lapses')
    const forged = structuredClone(c.expected.status)
    forged[Object.keys(forged).find((id) => forged[id] === 'lapsed')] = 'canonical'
    check(!same(materialize(c.ops).status, forged) && materialize(c.ops).state !== 'terminal',
      'access-conflicts: a lapsed dissolution declared canonical (terminal) is detected')
    const anew = AC.cases.find((x) => x.scenario === 'dissolve ∥ removal: issued anew')
    check(materialize(anew.ops.slice(0, -1)).state === 'group',
      'access-conflicts: without the dissolution issued anew the lapsed one leaves a group')
    const o = AC.cases.find((x) => x.scenario === 'admission-orphaned: one admission survives')
    const yId = o.ops.find((op) => op.label === 'x-adds-y').id
    check(materialize(o.ops).status[yId] === 'canonical' && 'x' in materialize(o.ops).members,
      'access-conflicts: one surviving legitimizing admission keeps the issuer and what it issued (RLTP-ACC-3572)')
    const lone = o.ops.filter((op) => op.label !== 'alice-adds-x').map((op) => op.label === 'x-adds-y' ? { ...op, preds: op.preds.filter((p) => o.ops.some((q) => q.id === p && q.label !== 'alice-adds-x')) } : op)
    for (const op of lone) op.id = op.label === 'x-adds-y' ? opId(op) : op.id
    check(Object.values(materialize(lone).status).filter((v) => v === 'removed-disposed').length === 2,
      'access-conflicts: without the surviving admission the issuer is orphaned and its admission disposed')
    const d = AC.cases.find((x) => x.scenario === 'epoch: unequal depth')
    check(d.expected.epoch === 2, 'access-conflicts: transitions of unequal depth merge under the deeper epoch (RLTP-ACC-7040)')
    const rt = AC.cases.find((x) => x.scenario === 'retained set: merged state')
    check(same(rt.expected.retained, ['alice', 'carol', 'x']), 'access-conflicts: the merged retained set is the merged membership, not the intersection (RLTP-ACC-7015)')
    const rtAt = Object.fromEntries(rt.ops.filter((op) => rt.expected.transitions[op.id]).map((op) => [op.label, rt.expected.transitions[op.id].retainedAtPosition]))
    check(same(rtAt, { 'alice-removes-bob': ['alice', 'carol'], 'carol-rotates': ['alice', 'bob', 'carol', 'x'] }),
      'access-conflicts: each transition reaches the retained set of its own position, neither the merged one (RLTP-ACC-7010, 9250)')
  }
  // after review 2: the resolver's author, lapsed transitions in the epoch, the leave that never lapses, emptiness
  {
    const rz = AC.cases.find((x) => x.scenario === 'fork: resolver removed on a sibling')
    const res = rz.ops.at(-1)
    check(rz.expected.state === 'forked' && rz.expected.status[res.id] === 'invalid',
      'access-conflicts: a policy.change by the subject of a sibling removal does not resolve the fork and is invalid, not forked (RLTP-ACC-3565)')
    const byBob = { ...res, author: 'bob' }; byBob.id = opId(byBob)
    const rb = materialize([...rz.ops.slice(0, -1), byBob])
    check(rb.state === 'group' && !('alice' in rb.members) && rb.status[byBob.id] === 'canonical',
      'access-conflicts: the same resolution by a member no sibling removes ends the fork, and the removal takes effect')
    const e = AC.cases.find((x) => x.scenario === 'fork ended: policy ∥ policy')
    const eRes = e.ops.at(-1).id
    check(e.expected.transitions[eRes].newEpoch === 3 && e.expected.epoch === 3,
      'access-conflicts: the resolver\'s newEpoch counts every valid transition of its ancestry, lapsed siblings included (RLTP-ACC-3565, 3569, 7040)')
    const lv = AC.cases.find((x) => x.scenario === 'leave ∥ rotation: never lapses')
    const leaveId = lv.ops.find((op) => op.kind === 'leave').id
    check(lv.expected.state === 'group' && lv.expected.status[leaveId] === 'canonical' && same(lv.expected.pendingExits, ['alice']),
      'access-conflicts: a last-member leave beside a rotation stays a leave, its author a pending exit (RLTP-ACC-3462)')
    check(materialize(lv.ops.filter((op) => op.kind !== 'rotate')).state === 'terminal',
      'access-conflicts: without the concurrent rotation the last-member leave ends the group (RLTP-ACC-5860)')
    const em = AC.cases.find((x) => x.scenario === 'removals empty the group: terminal')
    check(em.expected.state === 'terminal' && materialize(em.ops.filter((op) => op.kind !== 'dissolve')).state === 'terminal',
      'access-conflicts: empty membership is terminal with or without the lapsed dissolution (RLTP-ACC-5850 before 3460)')
    check(materialize(em.ops.filter((op) => op.label !== 'bob-removes-alice')).state === 'group',
      'access-conflicts: one removal fewer and the dissolution lapses into a group (RLTP-ACC-3460)')
  }
  // after review 3: the prefix free of every open pairing (3566), nesting and the resolver ∥ enforcement (3564), the resolver's retained set (3565, 7015, 7030)
  {
    const lab = (c, l) => c.ops.find((op) => op.label === l).id
    const ind = AC.cases.find((x) => x.scenario === 'fork: independent admission in the prefix')
    check(ind.expected.state === 'forked' && 'eve' in ind.expected.members && ind.expected.status[lab(ind, 'alice-adds-eve-beside-the-fork')] === 'canonical',
      'access-conflicts: an admission beside the fork that touches no pairing belongs to the fork-free prefix (RLTP-ACC-3566)')
    const ev = AC.cases.find((x) => x.scenario === 'fork ended: resolver admitted beside the fork')
    const evRes = lab(ev, 'eve-decides-the-fork')
    check(ev.expected.state === 'group' && ev.expected.status[evRes] === 'canonical' && same(ev.expected.transitions[evRes].retainedAtPosition, ['alice', 'bob', 'dave', 'eve']),
      'access-conflicts: a member admitted beside the fork resolves it, standing from the prefix; its retained set is the reconciled one (RLTP-ACC-3565, 3566, 7015)')
    const nn = AC.cases.find((x) => x.scenario === 'fork: nested pairing')
    const inner = nn.expected.transitions[lab(nn, 'bob-decides-the-inner-fork')]
    const outer = nn.expected.transitions[lab(nn, 'alice-decides-the-outer-fork')]
    check(inner.newEpoch === 3 && outer.newEpoch === 4 && nn.expected.epoch === 4 && nn.expected.state === 'group',
      'access-conflicts: a nested pairing is one more open pairing; the outer resolver is one above every valid transition of its ancestry (RLTP-ACC-3564, 3565)')
    check(materialize(nn.ops.slice(0, -1)).state === 'forked' && materialize(nn.ops.slice(0, -1)).status[lab(nn, 'bob-decides-the-inner-fork')] === 'forked',
      'access-conflicts: without the outer resolver the inner resolution is a sibling of the outer fork and forked (RLTP-ACC-3564)')
    const pe = AC.cases.find((x) => x.scenario === 'fork: resolver ∥ enforcement')
    const peRes = lab(pe, 'bob-would-decide-the-fork')
    check(pe.expected.state === 'forked' && pe.expected.status[peRes] === 'forked',
      'access-conflicts: a resolver concurrent with an enforcement operation forks again and ends nothing (RLTP-ACC-3564)')
    const noRot = pe.ops.filter((op) => op.label !== 'alice-rotates-on-her-change')
    check(materialize(noRot).state === 'group' && materialize(noRot).status[peRes] === 'canonical',
      'access-conflicts: without the concurrent rotation the same resolver ends the fork')
    const pd = AC.cases.find((x) => x.scenario === 'fork ended: resolver ∥ enforcement decided')
    check(pd.expected.state === 'group' && pd.expected.transitions[lab(pd, 'alice-decides-both')].newEpoch === 3,
      'access-conflicts: a policy.change over both pairings ends the renewed fork (RLTP-ACC-3565, 7040)')
    const em = AC.cases.find((x) => x.scenario === 'fork: resolver with an empty retained set')
    const emRes = em.ops.at(-1)
    check(em.expected.state === 'forked' && !(emRes.id in em.expected.transitions) && em.expected.status[emRes.id] === 'invalid',
      'access-conflicts: a resolver whose reconciled retained set is empty is invalid, not forked; the fork stays (RLTP-ACC-7030, 7015, 3565)')
    // review 4 M6: invalidity is judged before the fork disposition — a
    // checker that lets the forked status win over invalid is detected
    const forgedEm = { ...em.expected.status, [emRes.id]: 'forked' }
    check(!same(materialize(em.ops).status, forgedEm),
      'access-conflicts: an invalid resolver declared forked is detected (RLTP-ACC-3565)')
    const noLeave = em.ops.filter((op) => op.kind !== 'leave')
    const res2 = { ...emRes, preds: [lab(em, 'alice-changes-policy'), lab(em, 'bob-removes-alice')] }; res2.id = opId(res2)
    const r2 = materialize([...noLeave.slice(0, -1), res2])
    check(r2.state === 'group' && r2.status[res2.id] === 'canonical' && same(r2.transitions[res2.id].retainedAtPosition, ['bob']),
      'access-conflicts: without the leave the same resolver retains bob and ends the fork')
  }
  check(['S4b', 'S4c', 'S4d', 'S4f', 'review #11', 'removal chain', 'delivery order'].every((s) => AC.cases.some((c) => c.scenario === s)),
    'access-conflicts: the scenarios RLTP-ACC-14050 names are all present')
  check(['fork: policy ∥ policy', 'fork: policy ∥ removal', 'dissolve ∥ removal: lapses', 'fork ended: policy ∥ policy'].every((s) => AC.cases.some((c) => c.scenario === s)),
    'access-conflicts: the fork cases of the Access 14 vector plan are all present (the dissolution case as it lapses, RLTP-ACC-3460)')
  check(['dissolve ∥ removal: issued anew', 'fork ended: policy ∥ removal', 'admission-orphaned: one admission survives', 'epoch: unequal depth', 'retained set: merged state'].every((s) => AC.cases.some((c) => c.scenario === s)),
    'access-conflicts: the cases review 1 added are all present')
  check(['fork: resolver removed on a sibling', 'leave ∥ rotation: never lapses', 'removals empty the group: terminal'].every((s) => AC.cases.some((c) => c.scenario === s)),
    'access-conflicts: the cases review 2 added are all present')
  check(['fork: independent admission in the prefix', 'fork ended: resolver admitted beside the fork', 'fork: nested pairing', 'fork: resolver ∥ enforcement', 'fork ended: resolver ∥ enforcement decided', 'fork: resolver with an empty retained set'].every((s) => AC.cases.some((c) => c.scenario === s)),
    'access-conflicts: the cases review 3 added are all present')
}

// ── suite: membership-tasks.json — Membership Tasks 0.18 from a real genesis ──
// Every check that proves a Membership rule names it (checkR, `rules` of
// the vector cases); `--coverage membership` prints the proven set.
section('membership-tasks.json — Membership Tasks 0.18: genesis → invite → accept → welcome → member.add, evidence, re-welcome')
{
  const M = J('vectors/membership-tasks.json')
  const IKM2 = Buffer.from(crypto.hkdfSync('sha256', IKM, Buffer.alloc(0), Buffer.from('rltp/vector/second-party-root-ikm', 'utf8'), 64))
  const P = 'https://real-life.org/trust-tasks/'
  const VF = 'failed(validation-failed)'
  const MEMBERSHIP_SKEW = 300 // PT5M (RLTP-MT-5020)
  const MANIFEST = new Set(readFileSync(join(ROOT, 'conformance/membership-rule-ids-0.18.txt'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')))
  const ptr = (p) => p.split('/').slice(1).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
  const mutate = (base, m) => {
    const doc = JSON.parse(JSON.stringify(base))
    const at = (p) => { const parts = ptr(p); let o = doc; for (const k of parts.slice(0, -1)) o = o[k]; return [o, parts.at(-1)] }
    for (const [p, v] of Object.entries(m.set ?? {})) { const [o, k] = at(p); o[k] = JSON.parse(JSON.stringify(v)) }
    for (const p of m.delete ?? []) { const [o, k] = at(p); if (Array.isArray(o)) o.splice(Number(k), 1); else delete o[k] }
    for (const [p, n] of Object.entries(m.fill ?? {})) { const [o, k] = at(p); o[k] = Array.from({ length: n }, () => JSON.parse(JSON.stringify(o[k][0]))) }
    for (const [p, n] of Object.entries(m.padTo ?? {})) { const [o, k] = at(p); o[k] += 'x'.repeat(n - Buffer.byteLength(jcs(doc), 'utf8')) }
    return doc
  }
  const errsOf = (data, file) => { const s = SCHEMAS[file]; return s ? validate(data, s, s) : [`schema ${file} not shipped`] }
  const valid = (data, file) => errsOf(data, file).length === 0
  const toU = (z) => { if (typeof z !== 'string') return null; if (z[0] === 'u') return z; if (z[0] !== 'z') return null; const b = fromB58(z.slice(1)); return b && b.length === 34 && b[0] === 0x12 && b[1] === 0x20 && 'z' + b58(b) === z ? 'u' + b.toString('base64url') : null }
  const sameDigest = (a, b) => toU(a) !== null && toU(a) === toU(b)
  // exact RFC 3339 instants: millisecond precision (the schemas cap fractions at three digits), a missing fraction is .000, nothing rounded (RLTP-MT-5050)
  const inst = (t) => (typeof t === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$/.test(t) ? Date.parse(t) : NaN)
  const SKEW_MS = MEMBERSHIP_SKEW * 1000
  const mh = (bytes) => 'u' + Buffer.concat([Buffer.from([0x12, 0x20]), sha(bytes)]).toString('base64url')
  // a z6LS key-agreement Multikey decodes to x25519-pub + 32 bytes, canonically (RLTP-ENC-2040)
  const x25519OK = (mk) => { const raw = typeof mk === 'string' ? xRawOfMk(mk) : null; return raw !== null && mkOfRaw(raw) === mk }
  const mkOfRaw = (raw) => 'z' + b58(Buffer.concat([Buffer.from([0xec, 0x01]), raw]))
  const failing = (checks) => Object.entries(checks).filter(([, v]) => !v).map(([k]) => k)
  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x))
  const MF = 'failed(malformed)'
  // a receiver's verdict: a schema failure is failed(malformed) (Contract
  // 6.2), every later failure failed(validation-failed); neither is
  // acknowledged
  const dispose = (fails) => (fails.includes('schema') ? { disposition: MF, ack: false } : fails.length ? { disposition: VF, ack: false } : { disposition: 'accepted', ack: true })
  // a receiver over a spied store: it writes only what passes every check —
  // a rejected document leaves no trace (nothing adopted, no state written)
  const spyStore = () => { const writes = []; return { writes, put: (k, v) => writes.push([k, v]) } }
  const receive = (fails, store, key, value) => { const d = dispose(fails); if (d.disposition === 'accepted') store.put(key, value); return d }

  // every rule a vector case names is an identifier of this document (RLTP-MT-10090)
  const caseLists = ['negatives', 'validEvidence', 'pairNegatives', 'pairPositives', 'vouchNegatives', 'vouchPositives', 'inviteeNegatives', 'inviteePositives', 'inviteReceiptCases', 'sealCases', 'senderSealCases', 'documentNegatives', 'reWelcomeNegatives', 'evidenceDocumentNegatives']
  const allCases = caseLists.flatMap((l) => M[l])
  const named = (c) => [...(c.rules ?? []), ...Object.keys(c.rulesPartial ?? {})]
  check(allCases.every((c) => Array.isArray(c.rules) && named(c).length > 0 && named(c).every((r) => MANIFEST.has(r))), `every one of ${allCases.length} vector cases names its rules, each an identifier of conformance/membership-rule-ids-0.18.txt`)
  check(allCases.every((c) => c.rules.every((r) => !PARTIAL[r]) && Object.keys(c.rulesPartial ?? {}).every((r) => PARTIAL[r] === c.rulesPartial[r])), 'no case names a partially checked rule in `rules`; every rulesPartial entry states the obligation left unchecked')

  // ── the genesis: a real one, its digest the group identity ──────────────
  const G = M.genesis
  const { proof: gProof, ...gNoProof } = G
  const gInput = Buffer.from(jcs({ ...gNoProof, id: '' }), 'utf8')
  schemaOK(G, 'access-operation-envelope.schema.json', 'genesis (rltp-access/0.25 group.genesis)')
  check(G.id === 'oid:' + sha(gInput).toString('base64url') && gProof.signatures.length === 2 && gProof.signatures.every((s) => verifyRaw(s.signer, gInput, s.sig)) && sameSet(gProof.signatures.map((s) => s.signer), [G.group, G.author]),
    'genesis id recomputes; signed by the group DID and the founder (RLTP-ACC-3100, 3225)')
  check(didOf(hkdf(IKM2, M.inputs.groupDid)) === G.group && didOf(hkdf(IKM2, M.inputs.founder)) === G.author && G.body.members[0] === G.author, 'group DID and founder recompute from the second-party IKM; members = [founder]')
  check(G.body.contentKeyCommitment === mh(hkdf(IKM, M.inputs.contentKey)), 'genesis contentKeyCommitment = multihash over the raw content key (linear/0.1)')
  check(true, '[not-proven] genesis serviceIdentity and keyOpDigest are stand-ins; their derivations are Access vectors\' (Access 5.2, 9.2)')
  check(M.genesisDigest === mh(gInput) && M.genesisDigest.slice(1) === Buffer.concat([Buffer.from([0x12, 0x20]), Buffer.from(G.id.slice(4), 'base64url')]).toString('base64url'), 'genesisDigest = multibase multihash over the genesis signature input, the same hash bytes as its id (RLTP-ACC-3030)')

  // ── the pair: invite and accept ─────────────────────────────────────────
  const invDoc = M.invite.document, inv = invDoc.payload.invite, accDoc = M.accept.document, acc = accDoc.payload.accept
  const edInfo = 'rltp/anchor/ed/group/' + M.genesisDigest, xInfo = 'rltp/anchor/x/group/' + M.genesisDigest
  const inviteeSeed = hkdf(IKM, edInfo), inviteeX = hkdf(IKM, xInfo)
  checkR(['RLTP-MT-3040', 'RLTP-MT-3035'], inv.credentialSubject.genesisDigest === mh(gInput) && inv.credentialSubject.group === G.group, 'invite genesisDigest = digest of the real genesis, group = its group DID')
  checkR(['RLTP-MT-3030', 'RLTP-MT-8090', 'RLTP-MT-2250'], didOf(inviteeSeed) === inv.credentialSubject.id && inv.credentialSubject.id === M.parties.invitee && mkOf(inviteeX) === acc.card.keyAgreement, 'invitee derives its member anchor from the invite genesisDigest (group/<u> context) and it equals credentialSubject.id; the accept signs under that anchor')
  checkR(['RLTP-MT-2250'], inv.issuer === G.body.members[0], 'the inviter anchor is the one the materialized membership carries (the founder of the genesis)')
  checkR(['RLTP-MT-3010', 'RLTP-MT-3015'], valid(invDoc.payload, 'payload-membership-invite.schema.json'), 'invite payload is a conformant DTG InvitationCredential with the pinned @context and type')
  checkR(['RLTP-MT-3065'], typeof inv.credentialSubject.name === 'string' && typeof inv.credentialSubject.note === 'string' && valid(invDoc.payload, 'payload-membership-invite.schema.json'), 'invite carries the display fields name and note within the schema bounds')
  checkR(['RLTP-MT-2180'], M.invite.credentialDigest === digestU(inv) && M.invite.credentialDigest !== digestU(invDoc) && sameDigest(acc.ref, M.invite.credentialDigest), 'invitation identity = credential digest over payload.invite incl. proof, never the document digest; accept.ref names it')
  checkR(['RLTP-MT-3245'], valid(accDoc.payload, 'payload-membership-accept.schema.json') && valid(inv.credentialSubject.card, 'contact-card.schema.json') && valid(acc.card, 'contact-card.schema.json'), 'accept payload and both enclosed cards valid against their schemas')
  checkR(['RLTP-MT-2120'], valid(invDoc, 'rltp-delivery-document.schema.json') && valid(accDoc, 'rltp-delivery-document.schema.json') && invDoc.type === P + 'membership-invite/0.2' && accDoc.type === P + 'membership-accept/0.2', 'invite and accept documents follow the Delivery document profile under their registered type URIs')

  // THE evidence pair check set (RLTP-MT-3725), a function of the payload
  // alone — no operation exists for it to consult (RLTP-MT-3730)
  const pairChecks = (ev) => {
    const iD = ev.evidence.invite, aD = ev.evidence.accept
    const i = iD?.payload?.invite, a = aD?.payload?.accept
    const cardOK = (c, anchor) => !!c && diVerify(c, c.anchor).ok && c.anchor === anchor && x25519OK(c.keyAgreement) && !('sentTo' in c) && !('boundTo' in c) && !('deliveryHints' in c)
    return {
      schema: valid(ev, 'payload-membership-evidence.schema.json') && valid(iD, 'rltp-delivery-document.schema.json') && valid(aD, 'rltp-delivery-document.schema.json'),
      inviteProof: diVerify(i, i.issuer).ok && i.proof['@context'] !== undefined && jcs(i.proof['@context']) === jcs(i['@context']),
      inviteIssuer: iD.issuer === i.issuer,
      inviteRecipient: iD.recipient === i.credentialSubject.id,
      inviteNoProof: !('proof' in iD),
      acceptProof: diVerify(aD, a.subject).ok && aD.issuer === a.subject,
      ref: sameDigest(a.ref, digestU(i)),
      subject: a.subject === i.credentialSubject.id,
      group: a.group === i.credentialSubject.group,
      acceptRecipient: aD.recipient === i.issuer,
      thread: iD.threadId === i.taskContext && aD.threadId === iD.threadId,
      validity: inst(i.validUntil) >= inst(i.validFrom),
      skew: inst(aD.issuedAt) <= inst(i.validUntil) + SKEW_MS && inst(aD.proof.created) <= inst(i.validUntil) + SKEW_MS,
      cards: cardOK(i.credentialSubject.card, i.issuer) && cardOK(a.card, a.subject),
      sizes: Buffer.byteLength(jcs(iD), 'utf8') <= 16384 && Buffer.byteLength(jcs(aD), 'utf8') <= 16384,
      // a present ceremony.enactment MUST recompute against the enclosed
      // material (Contract §3); an invitation credential carries no
      // enactmentBinding, so none can (RLTP-MT-2170)
      enactment: !(iD.ceremony && 'enactment' in iD.ceremony) || (i.credentialSubject.enactmentBinding !== undefined && iD.ceremony.enactment === i.credentialSubject.enactmentBinding),
    }
  }
  const PAIR_RULES = ['RLTP-MT-3725', 'RLTP-MT-2110', 'RLTP-MT-2130', 'RLTP-MT-2140', 'RLTP-MT-2150', 'RLTP-MT-3020', 'RLTP-MT-3025', 'RLTP-MT-3045', 'RLTP-MT-3050', 'RLTP-MT-3055', 'RLTP-MT-3060', 'RLTP-MT-3070', 'RLTP-MT-3075', 'RLTP-MT-3080', 'RLTP-MT-3215', 'RLTP-MT-3220', 'RLTP-MT-3225', 'RLTP-MT-3230', 'RLTP-MT-3235', 'RLTP-MT-3240', 'RLTP-MT-3255', 'RLTP-MT-3260', 'RLTP-MT-3265', 'RLTP-MT-2200', 'RLTP-MT-2260', 'RLTP-MT-2280', 'RLTP-MT-5020', 'RLTP-MT-5050']
  const basePair = failing(pairChecks({ evidence: { invite: invDoc, accept: accDoc } }))
  checkR(PAIR_RULES, basePair.length === 0, `the vector pair passes every check of the pair set${basePair.length ? ' — fails ' + basePair : ''}`)
  checkR(['RLTP-MT-2270'], !('challenge' in inv.credentialSubject.card) && !('challenge' in acc.card) && basePair.length === 0, 'enclosed cards carry no challenge and the pair set passes without one')
  checkR(['RLTP-MT-3730'], pairChecks.length === 1 && !('operation' in M.evidence02) && failing(pairChecks(M.evidence02)).length === 0, 'the pair set is a function of the evidence payload alone and passes where no operation exists')
  for (const c of [...M.pairNegatives, ...M.pairPositives]) {
    const f = failing(pairChecks(c.artifact))
    const store = spyStore()
    const d = receive(f, store, digestU(c.artifact.evidence.accept), c.artifact)
    checkR(named(c), sameSet(f, c.fails) && d.disposition === c.expected, `${c.name}: pair checks fail exactly [${c.fails}] → ${c.expected}${sameSet(f, c.fails) ? '' : ' — got [' + f + ']'}`)
    if (c.expected === 'accepted') check(store.writes.length === 1 && d.ack, `${c.name}: buffered once, keyed by the accept document digest, acknowledged`)
    else checkR(['RLTP-MT-3735'], !d.ack && store.writes.length === 0 && d.disposition === (f.includes('schema') ? MF : VF), `${c.name}: ${d.disposition}, no acknowledgement, nothing buffered`)
  }
  // inviter-side accept receipt (RLTP-MT-3270): the accept answers an invite this recipient sent on this thread
  const SENT = [invDoc]
  const acceptReceipt = (aD) => {
    const a = aD.payload.accept
    const sent = SENT.find((d) => d.threadId === aD.threadId && sameDigest(a.ref, digestU(d.payload.invite)))
    return { schema: valid(aD, 'rltp-delivery-document.schema.json') && valid(aD.payload, 'payload-membership-accept.schema.json'), proof: diVerify(aD, aD.issuer).ok && aD.issuer === a.subject, sentInvite: !!sent, subject: !!sent && a.subject === sent.payload.invite.credentialSubject.id, group: !!sent && a.group === sent.payload.invite.credentialSubject.group, card: diVerify(a.card, a.card.anchor).ok && a.card.anchor === a.subject && x25519OK(a.card.keyAgreement), skew: !!sent && inst(aD.issuedAt) <= inst(sent.payload.invite.validUntil) + SKEW_MS && inst(aD.proof.created) <= inst(sent.payload.invite.validUntil) + SKEW_MS }
  }
  checkR(['RLTP-MT-3270'], failing(acceptReceipt(accDoc)).length === 0, 'inviter receipt: the accept verifies under its subject, answers an invite sent on its thread, subject/group/card/skew hold')
  const RECEIPT = { 'accept-ref-is-document-digest': ['sentInvite', 'subject', 'group', 'skew'], 'accept-on-another-thread': ['sentInvite', 'subject', 'group', 'skew'], 'accept-tampered': ['proof'], 'accept-for-another-group': ['group'], 'accept-after-skew': ['skew'], 'accept-issued-999ms-past-skew': ['skew'], 'accept-proof-created-999ms-past-skew': ['skew'], 'accept-proof-under-another-key': ['proof'], 'accept-card-of-another-anchor': ['card'], 'accept-without-candidacy-signed': ['schema'], 'accept-at-skew-boundary': [], 'accept-at-skew-boundary-with-fraction': [], 'accept-ref-as-z': [] }
  for (const [name, want] of Object.entries(RECEIPT)) {
    const c = [...M.pairNegatives, ...M.pairPositives].find((x) => x.name === name)
    if (!c) { err(`inviter receipt: case ${name} missing`); continue }
    const f = failing(acceptReceipt(c.artifact.evidence.accept))
    const store = spyStore()
    const d = receive(f, store, digestU(c.artifact.evidence.accept), 'consent')
    checkR(['RLTP-MT-3270'], sameSet(f, want), `${name}: inviter receipt fails exactly [${want}]${sameSet(f, want) ? '' : ' — got [' + f + ']'}`)
    if (want.length) checkR(['RLTP-MT-3275'], !d.ack && store.writes.length === 0 && d.disposition === (want.includes('schema') ? MF : VF), `${name}: inviter receipt ${d.disposition}, no acknowledgement, nothing recorded`)
    else check(d.ack && store.writes.length === 1, `${name}: consent recorded once`)
  }
  // the original accept forwarded to a third member: the receiver principle rejects it (RLTP-MT-3705)
  const addressedTo = (doc, me) => doc.recipient === me
  checkR(['RLTP-MT-3705'], !addressedTo(accDoc, M.parties.third) && addressedTo(M.evidenceDocuments.v02, M.parties.third) && jcs(M.evidenceDocuments.v02.payload.evidence.accept) === jcs(accDoc), 'the original accept re-sent to a third member fails its recipient (failed(wrong-recipient)); enclosed in evidence it reaches that member unchanged')
  // size budget at the exact boundary (RLTP-MT-2200, 2210)
  const big = M.pairNegatives.find((c) => c.name === 'invite-document-over-budget').artifact.evidence.invite
  checkR(['RLTP-MT-2200', 'RLTP-MT-2210'], Buffer.byteLength(jcs(big), 'utf8') === 16385 && Buffer.byteLength(jcs({ ...big, ceremony: { pad: big.ceremony.pad.slice(1) } }), 'utf8') === 16384 && failing(pairChecks({ evidence: { invite: { ...big, ceremony: { pad: big.ceremony.pad.slice(1) } }, accept: accDoc } })).length === 0, 'an invite document of exactly 16384 JCS bytes passes, 16385 fails')

  // ── the invitee's receipt of an invite (RLTP-MT-3030) ────────────────────
  // its own derivation from the pinned genesis digest (canonical u) decides
  const inviteReceipt = (iD) => {
    const i = iD.payload.invite
    const u = toU(i.credentialSubject.genesisDigest)
    return {
      schema: valid(iD, 'rltp-delivery-document.schema.json') && valid(iD.payload, 'payload-membership-invite.schema.json'),
      proof: diVerify(i, i.issuer).ok && iD.issuer === i.issuer && !('proof' in iD),
      derivation: u !== null && didOf(hkdf(IKM, 'rltp/anchor/ed/group/' + u)) === i.credentialSubject.id,
      subjectIsRecipient: i.credentialSubject.id === iD.recipient,
    }
  }
  for (const c of M.inviteReceiptCases) {
    const f = failing(inviteReceipt(c.artifact))
    const store = spyStore()
    const d = receive(f, store, digestU(c.artifact.payload.invite), 'for the decision')
    checkR(named(c), sameSet(f, c.fails) && (c.fails.length ? d.disposition === VF && !d.ack && store.writes.length === 0 : store.writes.length === 1), `${c.name}: invite receipt fails exactly [${c.fails}]${c.fails.length ? ' → failed(validation-failed), never answered, nothing buffered' : ' → buffered for the decision'}${sameSet(f, c.fails) ? '' : ' — got [' + f + ']'}`)
  }

  // ── vouches (RLTP-MT-3810) ───────────────────────────────────────────────
  const vouchChecks = (v, ev) => ({
    schema: valid(v, 'access-vouch.schema.json'),
    proof: diVerify(v, v.issuer).ok && v.proof['@context'] !== undefined && jcs(v.proof['@context']) === jcs(v['@context']),
    subject: v.credentialSubject.id === ev.evidence.accept.payload.accept.subject,
    accept: sameDigest(v.credentialSubject.endorsement.accept, digestU(ev.evidence.accept)),
    genesis: sameDigest(v.credentialSubject.endorsement.genesisDigest, ev.evidence.invite.payload.invite.credentialSubject.genesisDigest),
  })
  checkR(['RLTP-MT-3810', 'RLTP-MT-2110'], M.evidence02.evidence.vouches.every((v) => failing(vouchChecks(v, M.evidence02)).length === 0), 'every enclosed vouch: schema, proof under its issuer with @context copy, subject = accept.subject, endorsement binds the accept document digest and the genesis digest')
  for (const c of M.vouchPositives) checkR(named(c), failing(vouchChecks(c.artifact, M.evidence02)).length === 0, `${c.name}: passes every vouch check`)
  for (const c of M.vouchNegatives) {
    const f = failing(vouchChecks(c.artifact, M.evidence02))
    checkR(named(c), sameSet(f, c.fails) && dispose(f).disposition === c.expected, `${c.name}: vouch checks fail exactly [${c.fails}] → ${c.expected}${sameSet(f, c.fails) ? '' : ' — got [' + f + ']'}`)
    checkR(['RLTP-MT-3735'], !dispose(f).ack, `${c.name}: no acknowledgement`)
  }

  // ── evidence relay (RLTP-MT-3805, 3815, 3715, 3720, 3775) ──────────────
  check(SCHEMAS['payload-membership-evidence.schema.json']?.$id === P + 'membership-evidence/0.2' && SCHEMAS['payload-membership-evidence-0.1.schema.json']?.$id === P + 'membership-evidence/0.1', 'evidence schemas: $id = type URI, /0.2 current and /0.1 accepted (Trust Tasks 6.3)')
  checkR(['RLTP-MT-3805', 'RLTP-MT-3710'], valid(M.evidence02, 'payload-membership-evidence.schema.json'), 'membership-evidence/0.2 payload with one vouch, enclosing the complete pair')
  for (const v of M.validEvidence) checkR(named(v), valid(mutate(M.evidence02, v), 'payload-membership-evidence.schema.json'), `${v.name} valid`)
  checkR(['RLTP-MT-3815'], valid(M.evidence01, 'payload-membership-evidence-0.1.schema.json') && valid(M.evidence01, 'payload-membership-evidence.schema.json') && failing(pairChecks(M.evidence01)).length === 0 && M.evidenceDocuments.v01.type === P + 'membership-evidence/0.1', 'membership-evidence/0.1: valid under its own schema, a /0.2 payload without vouches, the same pair checks pass')
  const evDocChecks = (d) => ({ schema: valid(d, 'rltp-delivery-document.schema.json'), thread: d.threadId === d.payload.evidence.invite.threadId, noProof: !('proof' in d) })
  for (const d of [M.evidenceDocuments.v02, M.evidenceDocuments.v01]) checkR(['RLTP-MT-3715', 'RLTP-MT-3720'], failing(evDocChecks(d)).length === 0, `${d.type.split('/').slice(-2).join('/')} document: on the membership thread, no document proof`)
  for (const c of M.evidenceDocumentNegatives) {
    const f = failing(evDocChecks(mutate(M.evidenceDocuments.v02, c)))
    checkR(named(c), sameSet(f, c.fails), `${c.name}: evidence document checks fail exactly [${c.fails}]${sameSet(f, c.fails) ? '' : ' — got [' + f + ']'}`)
  }
  const surfaceable = (ev) => failing(pairChecks(ev)).length === 0 && ev.evidence.accept.payload.accept.candidacy === true
  const refused = M.pairPositives.find((c) => c.name === 'candidacy-refused')
  checkR(['RLTP-MT-3775'], surfaceable(M.evidence02) && !surfaceable(refused.artifact) && refused.surfaceable === false, 'a pair whose accept refuses candidacy is valid evidence and never surfaceable; with candidacy true the same pair is')

  // ── the welcome, its seal, and the admitting operation ──────────────────
  const op = M.payload.operation, adm = op.body.admission, W = M.welcome.plaintext
  checkR(['RLTP-MT-3310', 'RLTP-MT-10020', 'RLTP-MT-10050', 'RLTP-MT-3380', 'RLTP-MT-3315'], valid(M.payload, 'payload-access-operation.schema.json') && op.v === 'rltp-access/0.25' && valid(op, 'access-operation-envelope.schema.json'), 'access-operation/0.1 payload: rltp-access/0.25 member.add, enclosed invite and accept valid through the profile schema, welcome seal present')
  checkR(['RLTP-MT-4020', 'RLTP-MT-4040', 'RLTP-MT-10020'], valid(W, 'welcome.schema.json') && W.material.v === 'rltp-access-material/0.25' && valid(W.material, 'access-material.schema.json'), 'welcome plaintext rltp-welcome/0.1 with material rltp-access-material/0.25 naming its keyState')
  checkR(['RLTP-MT-4040'], W.material.keyState === G.id && op.prev[0] === G.id && W.material.keys.contentKey === hkdf(IKM, M.inputs.contentKey).toString('base64url'), 'material keyState = the genesis id, the key state the genesis opened; the content key recomputes')
  checkR(['RLTP-MT-2240'], Buffer.byteLength(M.welcome.plaintextJcs, 'utf8') <= 16384, 'welcome plaintext within 16384 JCS bytes')
  check(errsOf(mutate(op, { set: { '/v': 'rltp-access/0.24' } }), 'access-operation-envelope.schema.json').length > 0, 'the Access-owned envelope schema rejects rltp-access/0.24, as the carrier pin does (Access RLTP-ACC-11100, Membership 10)')
  check(errsOf(mutate(W.material, { set: { '/v': 'rltp-access-material/0.24' }, delete: ['/keyState'] }), 'access-material.schema.json').length > 0, 'the Access-owned material schema rejects rltp-access-material/0.24, as the welcome pin does (Access RLTP-ACC-11100, Membership 10)')
  const openSeal = (sealed, xSeed, info = 'rltp/v1/welcome') => {
    try {
      const shared = ecdhRaw(xSeed, Buffer.from(sealed.epk, 'base64url'))
      const key = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.from(info, 'utf8'), 32))
      const ct = Buffer.from(sealed.ciphertext, 'base64url')
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.nonce, 'base64url'))
      d.setAuthTag(ct.subarray(ct.length - 16))
      return Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString('utf8')
    } catch { return null }
  }
  const opened = openSeal(M.payload.welcome.sealed, inviteeX)
  checkR(['RLTP-MT-4100'], opened === M.welcome.plaintextJcs && openSeal(M.payload.welcome.sealed, inviteeX, 'rltp/v1/seal') === null && !valid(JSON.parse(opened), 'rltp-delivery-document.schema.json'), 'the welcome seal opens under HKDF info rltp/v1/welcome to exactly the plaintext JCS, and never under the delivery info rltp/v1/seal; the plaintext is no delivery document')
  const ephSeed = hkdf(IKM, M.inputs.ephemeral)
  check(M.welcome.sealed.epk === pubRaw(privX(ephSeed)).toString('base64url') && M.welcome.sealed.nonce === hkdf(IKM, M.inputs.nonce).subarray(0, 12).toString('base64url'), 'ephemeral key and nonce recompute from the oracle')
  // the invitee's own state: its accept, its invite, its anchor, its card key
  // ── the seal construction the welcome inherits from Contract §5 (RLTP-MT-4100) ──
  // receiver: length before decryption, then shape, then an all-zero
  // shared secret refused, then AES-256-GCM with empty AAD under rltp/v1/welcome
  const x25519 = (seed, raw) => { try { const z = ecdhRaw(seed, raw); return z.every((b) => b === 0) ? null : z } catch { return null } }
  const sealReceive = (sealed, xSeed) => {
    const ct = Buffer.from(sealed.ciphertext, 'base64url')
    if (ct.length > 65536 + 16) return 'oversize'
    if (!valid(sealed, 'sealed-envelope.schema.json')) return 'malformed'
    const shared = x25519(xSeed, Buffer.from(sealed.epk, 'base64url'))
    if (!shared) return 'all-zero'
    try {
      const key = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.from('rltp/v1/welcome', 'utf8'), 32))
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.nonce, 'base64url'))
      d.setAuthTag(ct.subarray(ct.length - 16))
      Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()])
      return 'opened'
    } catch { return 'decryption-failed' }
  }
  for (const c of M.sealCases) {
    const sealed = c.ciphertextBytes ? { ...c.sealed, ciphertext: Buffer.alloc(c.ciphertextBytes, 7).toString('base64url') } : c.sealed
    const got = sealReceive(sealed, inviteeX)
    const store = spyStore()
    const d = receive(got === 'opened' ? [] : [got], store, 'welcome', 'material')
    checkR(named(c), got === c.expect && (got === 'opened' ? store.writes.length === 1 : store.writes.length === 0 && !d.ack), `${c.name}: the receiver ${c.expect === 'opened' ? 'opens it' : 'rejects it: ' + c.expect}${got === c.expect ? '' : ' — got ' + got}`)
  }
  // sender: a key whose shared secret is all zero is never sealed to
  const senderSeal = (rkid) => { const raw = x25519OK(rkid) ? xRawOfMk(rkid) : null; if (!raw) return 'undecodable'; return x25519(hkdf(IKM, 'rltp/vector/membership-sender-probe'), raw) ? 'sealable' : 'all-zero' }
  for (const c of M.senderSealCases) checkR(named(c), senderSeal(c.rkid) === c.expect, `${c.name}: the sender ${c.expect === 'sealable' ? 'seals' : 'refuses: ' + c.expect}`)
  // a fresh ephemeral key and nonce per envelope: every seal of the vector is distinct, two seals of one plaintext included
  {
    const seals = []
    const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === 'object') { if (typeof n.epk === 'string' && typeof n.rkid === 'string' && typeof n.ciphertext === 'string') seals.push(n); else Object.values(n).forEach(walk) } }
    walk([M.payload, M.reWelcome, M.inviteeNegatives, M.inviteePositives])
    // one envelope may travel in several cases (the same task with another operation field); distinct envelopes are compared
    const fresh = [...new Map(seals.map((x) => [jcs(x), x])).values()]
    const uniq = (k) => new Set(fresh.map((x) => x[k])).size === fresh.length
    const sameText = openSeal(M.reWelcome.keyDelivery.sealed, inviteeX) === M.welcome.plaintextJcs && M.reWelcome.keyDelivery.sealed.epk !== M.payload.welcome.sealed.epk && M.reWelcome.keyDelivery.sealed.nonce !== M.payload.welcome.sealed.nonce
    checkR(['RLTP-MT-4100'], fresh.length >= 10 && uniq('epk') && uniq('nonce') && sameText, `${fresh.length} distinct seals of the vector carry pairwise distinct ephemeral keys and nonces; the welcome and the re-welcome seal the same plaintext under different ones`)
  }

  // the invitee's own state: its accept, its invite, its anchor, its card key, and every other key-agreement key it holds
  const otherX = hkdf(IKM, M.inputs.inviteeOtherX)
  const own = { accept: accDoc, invite: invDoc, anchor: didOf(inviteeSeed), xSeed: inviteeX, keys: [[inviteeX, acc.card.keyAgreement], [otherX, M.parties.inviteeOtherKeyAgreement]] }
  // open with whichever key the person holds; report which one opened it
  const openAny = (sealed) => { for (const [x, mk] of own.keys) { const pt = openSeal(sealed ?? {}, x); if (pt !== null) return { pt, mk } } return { pt: null, mk: null } }
  // THE embedded-welcome check set (RLTP-MT-3415): 3335, 3330–3345, 3425–3445
  const inviteeChecks = (pl, doc) => {
    const o = pl.operation, a = o?.body?.admission
    const { proof: pr, ...noProof } = o
    const input = Buffer.from(jcs({ ...noProof, id: '' }), 'utf8')
    const sigs = pr?.signatures ?? []
    const { pt, mk } = openAny(pl.welcome?.sealed)
    const ptObj = pt ? JSON.parse(pt) : null
    return {
      schema: valid(pl, 'payload-access-operation.schema.json'),
      id: o.id === 'oid:' + sha(input).toString('base64url'),
      sigs: sigs.length > 0 && sigs.every((s) => verifyRaw(s.signer, input, s.sig)),
      issuer: doc.issuer === o.author || sigs.some((s) => s.signer === doc.issuer),
      noProof: !('proof' in doc),
      thread: doc.threadId === own.invite.threadId,
      admitting: o.op === 'member.add' && !!pl.welcome,
      recipient: doc.recipient === o.body?.subject,
      welcomeDigest: !!ptObj && sameDigest(a?.welcome, digestU(ptObj)),
      binding: !!ptObj && ptObj.group === o.group && ptObj.subject === o.body.subject && sameDigest(ptObj.accept, digestU(a.accept)),
      ownAccept: sameDigest(digestU(a.accept), digestU(own.accept)),
      ownInvite: sameDigest(digestU(a.invite.payload.invite), own.accept.payload.accept.ref),
      subjectGroup: o.body.subject === own.anchor && o.body.subject === a.accept.payload.accept.subject && o.group === own.accept.payload.accept.group,
      sealKey: pl.welcome.sealed.rkid === own.accept.payload.accept.card.keyAgreement && mk === own.accept.payload.accept.card.keyAgreement,
      material: !!ptObj && valid(ptObj, 'welcome.schema.json') && valid(ptObj.material, 'access-material.schema.json') && ptObj.material.v === 'rltp-access-material/0.25',
      sizes: !!pt && Buffer.byteLength(pt, 'utf8') <= 16384 && Buffer.byteLength(jcs(doc), 'utf8') <= 65536,
    }
  }
  const INVITEE_RULES = ['RLTP-MT-3410', 'RLTP-MT-3415', 'RLTP-MT-3335', 'RLTP-MT-3330', 'RLTP-MT-3325', 'RLTP-MT-3320', 'RLTP-MT-3340', 'RLTP-MT-3300', 'RLTP-MT-3350', 'RLTP-MT-4080', 'RLTP-MT-4090', 'RLTP-MT-3425', 'RLTP-MT-3430', 'RLTP-MT-3435', 'RLTP-MT-3440', 'RLTP-MT-3445', 'RLTP-MT-4110', 'RLTP-MT-2220']
  const baseInvitee = failing(inviteeChecks(M.payload, M.document))
  checkR(INVITEE_RULES, baseInvitee.length === 0 && M.document.type === P + 'access-operation/0.1' && valid(M.document, 'rltp-delivery-document.schema.json'), `the task passes the complete embedded-welcome check set${baseInvitee.length ? ' — fails ' + baseInvitee : ''}`)
  check(op.proof.signatures.every((s) => verifyRaw(s.signer, Buffer.from(jcs({ ...Object.fromEntries(Object.entries(op).filter(([k]) => k !== 'proof')), id: '' }), 'utf8'), s.sig)) && op.author === G.author, 'the admitting operation is signed by the founder over its id input (RLTP-ACC-3105)')
  checkR(['RLTP-MT-2220'], Buffer.byteLength(jcs(M.document), 'utf8') <= 65536 && Buffer.byteLength(jcs(M.document), 'utf8') > 16384 === false, 'the complete serialized task is within the Delivery plaintext limit (65536) before sealing')
  for (const c of [...M.inviteeNegatives, ...M.inviteePositives]) {
    const doc = { ...c.document, payload: c.payload }
    const f = failing(inviteeChecks(c.payload, doc))
    const store = spyStore()
    const d = receive(f, store, c.payload.operation.id, 'provisional')
    checkR(named(c), sameSet(f, c.fails), `${c.name}: the embedded-welcome check set fails exactly [${c.fails}]${sameSet(f, c.fails) ? '' : ' — got [' + f + ']'}`)
    if (c.fails.length) checkR(['RLTP-MT-3345', 'RLTP-MT-3465'], !d.ack && store.writes.length === 0 && d.disposition === (f.includes('schema') ? MF : VF), `${c.name}: ${d.disposition}, no acknowledgement, nothing adopted, no state written`)
    else check(d.ack && store.writes.length === 1, `${c.name}: adopted provisionally, once`)
  }
  {
    const store = spyStore()
    const d = receive(failing(inviteeChecks(M.payload, M.document)), store, op.id, 'provisional')
    check(d.ack && store.writes.length === 1, 'the vector task: adopted provisionally, once (the store spy sees writes)')
  }
  for (const c of M.documentNegatives) {
    const f = failing(inviteeChecks(M.payload, mutate(M.document, c)))
    const store = spyStore()
    const d = receive(f, store, op.id, 'provisional')
    checkR(named(c), sameSet(f, c.fails), `${c.name}: carrier document checks fail exactly [${c.fails}]${sameSet(f, c.fails) ? '' : ' — got [' + f + ']'}`)
    checkR(['RLTP-MT-3345'], d.disposition === VF && !d.ack && store.writes.length === 0, `${c.name}: failed(validation-failed), no acknowledgement, nothing written`)
  }
  // the seal opens under another key of the same person, and is rejected all the same (RLTP-MT-3440)
  const other = M.inviteeNegatives.find((c) => c.name === 'welcome-sealed-to-another-own-key').payload.welcome.sealed
  checkR(['RLTP-MT-3440', 'RLTP-MT-4110'], openSeal(other, otherX) !== null && other.rkid === mkOf(otherX) && openSeal(other, inviteeX) === null, 'the other-key seal does open under the person\'s other key-agreement key — the check rejects it by key, not by failure to open')

  // ── the self-contained bootstrap (RLTP-MT-3420, RLTP-ACC-10200) ─────────
  const reWelcomeChecks = (kd) => {
    const k = kd.keyDelivery
    const { pt, mk } = openAny(k.sealed)
    return {
      schema: valid(kd, 'payload-key-delivery.schema.json'),
      sealKey: k.sealed.rkid === own.accept.payload.accept.card.keyAgreement && mk === own.accept.payload.accept.card.keyAgreement,
      pin: k.group === own.invite.payload.invite.credentialSubject.group && sameDigest(k.genesisDigest, own.invite.payload.invite.credentialSubject.genesisDigest),
      material: !!pt && valid(JSON.parse(pt).material, 'access-material.schema.json') && JSON.parse(pt).material.v === 'rltp-access-material/0.25',
    }
  }
  checkR(['RLTP-MT-3420'], M.reWelcome.keyDelivery.kind === 're-welcome' && failing(reWelcomeChecks(M.reWelcome)).length === 0, 'the re-welcome passes the carrier-independent subset: seal under the own accept card, pin of the own invite, material well-formed — no operation consulted')
  for (const c of M.reWelcomeNegatives) {
    const f = failing(reWelcomeChecks(mutate(M.reWelcome, c)))
    checkR(named(c), sameSet(f, c.fails), `${c.name}: re-welcome checks fail exactly [${c.fails}]${sameSet(f, c.fails) ? '' : ' — got [' + f + ']'}`)
    const store = spyStore()
    const d = receive(f, store, M.reWelcome.keyDelivery.op, 'provisional')
    checkR(['RLTP-MT-3465'], d.disposition === VF && !d.ack && store.writes.length === 0, `${c.name}: failed(validation-failed), nothing adopted, no state written`)
  }

  // ── schema negatives: fail AT the declared point; the unmutated artifact passes ──
  const ART = { payload: M.payload, welcome: W, evidence01: M.evidence01, evidence02: M.evidence02, invitePayload: invDoc.payload, acceptPayload: accDoc.payload }
  for (const n of M.negatives) {
    const base = ART[n.artifact]
    if (!base) { err(`${n.name}: unknown artifact ${n.artifact}`); continue }
    const errs = errsOf(mutate(base, n), n.schema)
    checkR(named(n), valid(base, n.schema) && errs.some((e) => e.includes(n.at)), `${n.name}: rejected by ${n.schema} AT ${n.at}${errs.length && !errs.some((e) => e.includes(n.at)) ? ' — got ' + errs[0] : ''}`)
  }
}

// ── result ───────────────────────────────────────────────────────────────
if (COVERAGE) {
  if (COVERAGE !== 'membership') { console.error(`--coverage: unknown layer ${COVERAGE}`); process.exit(2) }
  if (fail) { console.error(`conformance: ${fail} failed — no coverage claimed`); process.exit(1) }
  const byNum = (a, b) => Number(a.slice(8)) - Number(b.slice(8))
  for (const id of [...PROVEN].filter((x) => x.startsWith('RLTP-MT-')).sort(byNum)) console.log(id)
  for (const id of [...PARTLY.keys()].filter((x) => x.startsWith('RLTP-MT-') && !PROVEN.has(x)).sort(byNum)) console.log(`partial ${id}`)
  process.exit(0)
}
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) { console.error('conformance: FAILED'); process.exit(1) }
console.log(`conformance: all vector claims reproduce. Membership rules proven completely: ${[...PROVEN].filter((x) => x.startsWith('RLTP-MT-')).length}, in part: ${[...PARTLY.keys()].filter((x) => x.startsWith('RLTP-MT-') && !PROVEN.has(x)).length}.`)
