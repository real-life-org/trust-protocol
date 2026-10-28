#!/usr/bin/env node
// The Trust Tasks TF shared proof vectors (vectors/tf-proof/, copied from
// trustoverip/dtgwg-trust-tasks-tf fixtures/proof/) as a standing profile
// comparison: for every file it checks
//
//   · the copy is byte-identical to the upstream blob named in
//     vectors/tf-proof/rltp-profile.json (git blob SHA-1);
//   · the TF's expectation in manifest.json is the one rltp-profile.json
//     records, and every manifest entry has a case;
//   · the signature under its own cryptosuite, with no profile gate:
//     eddsa-jcs-2022 (Ed25519) and ecdsa-jcs-2019 over P-256 and P-384,
//     on WebCrypto — so a canonicalization fault shows even where the
//     RLTP profile refuses the suite;
//   · the RLTP verdict of the library's diVerify (the committed freeze
//     simulator/lib, byte-identical to lib/dist by CI) under the issuer
//     is the recorded one, and so is the verdict of an oracle written
//     here from the profile's rules.
//
//   usage: node conformance/tf-proof-vectors.mjs
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, ECDH, webcrypto } from 'node:crypto'
import { jcs, fromB58, b58, calOK } from './lib.mjs'
import { diVerify } from '../simulator/lib/crypto.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'vectors/tf-proof')
const S = webcrypto.subtle
const te = new TextEncoder()
let pass = 0, fail = 0
const check = (cond, m) => { if (cond) { pass++; console.log(`  ok    ${m}`) } else { fail++; console.error(`  FAIL  ${m}`) } }

const profile = JSON.parse(readFileSync(join(DIR, 'rltp-profile.json'), 'utf8'))
const raw = (f) => readFileSync(join(DIR, f))
const blob = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
const manifest = JSON.parse(raw('manifest.json').toString('utf8'))

const hash = async (alg, s) => new Uint8Array(await S.digest(alg, te.encode(s)))
const cat = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o }

// the signature under its own suite, no RLTP gate: the configuration is
// the embedded proof without proofValue, the document the received object
// without proof (W3C eddsa-jcs-2022, ecdsa-jcs-2019)
const CURVES = { '8024': ['P-256', 'prime256v1', 'SHA-256'], '8124': ['P-384', 'secp384r1', 'SHA-384'] }
async function signatureHolds (doc) {
  try {
    const { proof, ...rest } = doc
    const { proofValue, ...cfg } = proof
    if (typeof proofValue !== 'string' || proofValue[0] !== 'z') return false
    const sig = fromB58(proofValue.slice(1))
    if (!sig || 'z' + b58(sig) !== proofValue) return false
    const vm = proof.verificationMethod.split('#')[0]
    const mb = fromB58(vm.slice('did:key:z'.length))
    if (!mb) return false
    if (proof.cryptosuite === 'eddsa-jcs-2022') {
      if (mb[0] !== 0xed || mb[1] !== 0x01 || mb.length !== 34 || sig.length !== 64) return false
      const k = await S.importKey('raw', mb.subarray(2), { name: 'Ed25519' }, false, ['verify'])
      return S.verify({ name: 'Ed25519' }, k, sig, cat(await hash('SHA-256', jcs(cfg)), await hash('SHA-256', jcs(rest))))
    }
    if (proof.cryptosuite === 'ecdsa-jcs-2019') {
      const curve = CURVES[mb.subarray(0, 2).toString('hex')]
      if (!curve) return false
      const point = ECDH.convertKey(mb.subarray(2), curve[1], undefined, undefined, 'uncompressed')
      const k = await S.importKey('raw', point, { name: 'ECDSA', namedCurve: curve[0] }, false, ['verify'])
      return S.verify({ name: 'ECDSA', hash: curve[2] }, k, sig, cat(await hash(curve[2], jcs(cfg)), await hash(curve[2], jcs(rest))))
    }
    return false
  } catch { return false }
}

// the RLTP verdict from the profile's rules, written here: suite
// eddsa-jcs-2022 (RLTP-ENC-2050), the purposes read (Delivery DO-10),
// proof.created in the timestamp form read (RLTP-ENC-2155, 2160), the
// verification method the issuer's own did:key key, the proof @context a
// copy of a present document @context (RLTP-ENC-2060), the signature
const READ = new Set(['assertionMethod', 'authentication'])
async function rltpOracle (doc) {
  const p = doc.proof
  if (p?.type !== 'DataIntegrityProof' || p.cryptosuite !== 'eddsa-jcs-2022') return 'invalid'
  if (!READ.has(p.proofPurpose)) return 'invalid'
  if (typeof p.created !== 'string' || !calOK(p.created)) return 'invalid'
  if (p.verificationMethod !== doc.issuer + '#' + String(doc.issuer).slice('did:key:'.length)) return 'invalid'
  if ('@context' in doc && jcs(p['@context'] ?? null) !== jcs(doc['@context'])) return 'invalid'
  return (await signatureHolds(doc)) ? 'valid' : 'invalid'
}

console.log(`── vectors/tf-proof — ${profile.source.repository} ${profile.source.path} at ${profile.source.commit.slice(0, 8)}`)
check(blob(raw('manifest.json')) === profile.upstreamBlobs['manifest.json'], 'manifest.json: byte-identical to the upstream blob')
check(manifest.entries.length === profile.cases.length && manifest.entries.every((e) => profile.cases.some((c) => c.file === e.file)), `every manifest entry has a case (${manifest.entries.length})`)
const rows = []
for (const c of profile.cases) {
  const bytes = raw(c.file)
  check(blob(bytes) === profile.upstreamBlobs[c.file], `${c.file}: byte-identical to the upstream blob`)
  const tf = manifest.entries.find((e) => e.file === c.file)?.expect
  check(tf === c.tf, `${c.file}: the TF expects ${tf}, as recorded`)
  const doc = JSON.parse(bytes.toString('utf8'))
  const holds = await signatureHolds(doc)
  check(holds === c.signatureHolds, `${c.file}: the signature ${holds ? 'holds' : 'fails'} under ${doc.proof.cryptosuite} without profile gates`)
  const lib = (await diVerify(doc, doc.issuer)) ? 'valid' : 'invalid'
  const oracle = await rltpOracle(doc)
  check(lib === c.rltp && oracle === c.rltp, `${c.file}: RLTP ${c.rltp} — library ${lib}, oracle ${oracle} (${c.rule})`)
  rows.push({ file: c.file, tf: c.tf, signature: holds, rltp: lib })
}
console.table(rows)
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) { console.error('tf-proof-vectors: FAILED'); process.exit(1) }
console.log('tf-proof-vectors: the TF proof vectors read as recorded')
