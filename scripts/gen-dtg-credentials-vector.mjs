#!/usr/bin/env node
// Re-derives the type-bound artifacts of vectors/dtg-credentials.json.
//
// The file's forms (invitation credential, accept, vouches, negatives)
// were written once by hand; what binds them to the task-type namespace
// is computed here, deterministically, so that a change of the Type URI
// form (Delivery RLTP-DEL-3010) moves every dependent byte by rule and
// never by hand:
//   · the `type` of the invite and the accept document (the registered
//     Membership types under the namespace);
//   · the accept document's task proof (eddsa-jcs-2022 under the
//     invitee, Membership RLTP-MT-3260), whose input is the document;
//   · the accept document digest in both renderings (uzEquivalence) and
//     everywhere the file names it (the vouches' endorsement.accept);
//   · every Data Integrity proof that verified over its artifact before
//     the change, re-signed by its own key at its own `created`; a proof
//     that did not verify (a negative) stays as it is.
// The keys are the vector's own: the invitee under the oracle IKM of
// vectors/identity-derivation.json, the inviter/voucher under the
// second-party IKM, both at memberAnchorDerivation.edInfo. Ed25519 is
// deterministic, so a second run reproduces the file byte for byte.
//
//   usage: node scripts/gen-dtg-credentials-vector.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { jcs, sha, hkdf, digestU, privEd, didOf, b58, fromB58, diVerify } from '../conformance/lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')
const FILE = join(ROOT, 'vectors/dtg-credentials.json')
const J = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))
const P = 'https://real-life.org/trust-tasks/spec/'
const committed = readFileSync(FILE, 'utf8')
const before = JSON.parse(committed)
const v = JSON.parse(committed)

const IKM = Buffer.from(J('vectors/identity-derivation.json').rootIkm, 'hex')
const IKM2 = Buffer.from(crypto.hkdfSync('sha256', IKM, Buffer.alloc(0), Buffer.from('rltp/vector/second-party-root-ikm', 'utf8'), 64))
const edInfo = v.memberAnchorDerivation.edInfo
const seeds = new Map([[didOf(hkdf(IKM, edInfo)), hkdf(IKM, edInfo)], [didOf(hkdf(IKM2, edInfo)), hkdf(IKM2, edInfo)]])
if (!seeds.has(v.parties.inviteeCandidate.anchor) || !seeds.has(v.parties.inviterVoucher.anchor)) throw new Error('the parties do not derive from the documented IKMs')

// eddsa-jcs-2022 (W3C DI-EDDSA), the proof configuration kept as it was
const resign = (doc) => {
  const { proof, ...rest } = doc
  const { proofValue: _old, ...cfg } = proof
  const seed = seeds.get(cfg.verificationMethod.split('#')[0])
  if (!seed) throw new Error(`no vector key for ${cfg.verificationMethod}`)
  const hash = Buffer.concat([sha(Buffer.from(jcs(cfg), 'utf8')), sha(Buffer.from(jcs(rest), 'utf8'))])
  return { ...rest, proof: { ...proof, proofValue: 'z' + b58(crypto.sign(null, hash, privEd(seed))) } }
}
const zOf = (u) => 'z' + b58(Buffer.from(u.slice(1), 'base64url'))

// the proofs that verify now are the ones to carry over; their paths
const valid = new Set()
const walk = (node, path, fn) => {
  if (Array.isArray(node)) node.forEach((n, i) => walk(n, `${path}/${i}`, fn))
  else if (node && typeof node === 'object') { fn(node, path); for (const [k, x] of Object.entries(node)) walk(x, `${path}/${k}`, fn) }
}
walk(before, '', (n, path) => { if (n.proof?.type === 'DataIntegrityProof' && diVerify(n).ok) valid.add(path) })

// 1. the types, 2. the accept document's proof, 3. its digest everywhere
v.invite.document.type = P + 'membership-invite/0.2'
v.accept.document.type = P + 'membership-accept/0.2'
v.accept.document = resign(v.accept.document)
const oldU = before.uzEquivalence.acceptDigest.u, oldZ = before.uzEquivalence.acceptDigest.z
const newU = digestU(v.accept.document), newZ = zOf(newU)
let text = JSON.stringify(v)
text = text.split(oldU).join(newU).split(oldZ).join(newZ)
const out = JSON.parse(text)
if (out.uzEquivalence.acceptDigest.u !== newU || out.uzEquivalence.acceptDigest.z !== newZ) throw new Error('acceptDigest not carried')
if (!fromB58(newZ.slice(1)).equals(Buffer.from(newU.slice(1), 'base64url'))) throw new Error('u and z renderings differ')

// 4. every proof that verified before is re-signed over its artifact now
const resignAt = (node, path) => {
  if (Array.isArray(node)) return node.map((n, i) => resignAt(n, `${path}/${i}`))
  if (!node || typeof node !== 'object') return node
  const kids = Object.fromEntries(Object.entries(node).map(([k, x]) => [k, resignAt(x, `${path}/${k}`)]))
  return valid.has(path) ? resign(kids) : kids
}
const result = resignAt(out, '')
walk(result, '', (n, path) => { if (valid.has(path) && !diVerify(n).ok) throw new Error(`${path}: the re-signed proof does not verify`) })

const rendered = JSON.stringify(result, null, 2) + '\n'
if (CHECK) {
  if (rendered !== committed) { console.error('vectors/dtg-credentials.json: DIFFERS from its re-derivation'); process.exit(1) }
  console.log('vectors/dtg-credentials.json reproduces byte for byte')
} else {
  writeFileSync(FILE, rendered)
  console.log(`vectors/dtg-credentials.json written (${valid.size} proofs re-signed)`)
}
