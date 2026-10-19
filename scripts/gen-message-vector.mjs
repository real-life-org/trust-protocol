#!/usr/bin/env node
// Generates vectors/message.json — the executable vector for message@1
// (Message Tasks 0.1 §3): the directional key k_msg (3110), the MAC
// preimage (JCS of the body, Trust 2.1), the expected MAC, and negatives
// for the direction and the relationship of the key (3110), a tampered
// body, and the closed body and its bounds (3010, 3020, 3030).
//
// Keys: the oracle IKM of vectors/identity-derivation.json; parties A
// (sender) and B (recipient), and A2 → B2 for another relationship, of
// vectors/visibility.json, their pair contexts from the listed
// relationship nonces (Identity: label pair/<multihash(nonce)>, seeds
// HKDF(IKM, "rltp/anchor/{ed,x}/" || label)).
// node:crypto only, deterministic: fixed inputs, no clock, no randomness.
//
//   usage: node scripts/gen-message-vector.mjs [--check]   (from repo root)
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')
const J = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))
const assert = (c, m) => { if (!c) { console.error(`gen-message-vector: ${m}`); process.exit(1) } }

// ── primitives (Trust 2.1) ───────────────────────────────────────────────
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const b58 = (b) => { let n = BigInt('0x' + Buffer.from(b).toString('hex')), s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n } for (const x of b) { if (x === 0) s = '1' + s; else break } return s }
const jcs = (o) => Array.isArray(o) ? '[' + o.map(jcs).join(',') + ']'
  : (o && typeof o === 'object') ? '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + jcs(o[k])).join(',') + '}'
  : JSON.stringify(o)
const sha = (b) => crypto.createHash('sha256').update(b).digest()
const hkdf = (ikm, info) => Buffer.from(crypto.hkdfSync('sha256', ikm, Buffer.alloc(0), Buffer.from(info, 'utf8'), 32))
const hmacU = (k, s) => 'u' + crypto.createHmac('sha256', k).update(Buffer.from(s, 'utf8')).digest('base64url')
const privEd = (seed) => crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' })
const privX = (seed) => crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), seed]), format: 'der', type: 'pkcs8' })
const pubRaw = (priv) => { const s = crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' }); return s.subarray(s.length - 32) }
const ecdh = (privSeed, peerPrivSeed) => {
  const shared = crypto.diffieHellman({ privateKey: privX(privSeed), publicKey: crypto.createPublicKey(privX(peerPrivSeed)) })
  assert(!shared.every((x) => x === 0), 'all-zero shared secret (3120)')
  return shared
}

// ── parties ──────────────────────────────────────────────────────────────
const ID = J('vectors/identity-derivation.json')
const IKM = Buffer.from(ID.rootIkm, 'hex')
const VIS = J('vectors/visibility.json')
const party = (name) => {
  const v = VIS.parties[name]
  const label = 'pair/u' + Buffer.concat([Buffer.from([0x12, 0x20]), sha(Buffer.from(v.relationshipNonce, 'hex'))]).toString('base64url')
  const ed = hkdf(IKM, 'rltp/anchor/ed/' + label), x = hkdf(IKM, 'rltp/anchor/x/' + label)
  const anchor = 'did:key:z' + b58(Buffer.concat([Buffer.from([0xed, 0x01]), pubRaw(privEd(ed))]))
  const keyAgreement = 'z' + b58(Buffer.concat([Buffer.from([0xec, 0x01]), pubRaw(privX(x))]))
  assert(label === v.label && anchor === v.anchor && keyAgreement === v.keyAgreement, `party ${name} does not derive as vectors/visibility.json states`)
  return { name, ed, x, anchor, keyAgreement, pub: { party: name, relationshipNonce: v.relationshipNonce, label, anchor, keyAgreement } }
}
const A = party('A'), B = party('B'), A2 = party('A2'), B2 = party('B2')

// ── message@1 (3) ────────────────────────────────────────────────────────
const msgInfo = (s, r) => `rltp/v1/message/mac/${s.anchor}/${r.anchor}`
const kmsg = (s, r) => hkdf(ecdh(s.x, r.x), msgInfo(s, r))
const body = {
  type: 'message@1',
  mid: '6f1c2a9e-3b4d-4e5f-8a6b-7c8d9e0f1a2b',
  sentAt: '2026-10-20T09:14:03Z',
  text: 'See you at the stall. Bis gleich am Stand.',
  replyTo: '0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d',
}
const shared = ecdh(A.x, B.x)
assert(shared.equals(ecdh(B.x, A.x)), 'X25519 is symmetric')
const kAB = kmsg(A, B)
const preimage = jcs(body)
const mac = hmacU(kAB, preimage)
const message = { body, proof: { mac } }
const withMac = (b) => ({ body: b, proof: { mac: hmacU(kAB, jcs(b)) } })
const sigZ = (seed, b) => 'z' + b58(crypto.sign(null, Buffer.from(jcs(b), 'utf8'), privEd(seed)))

const vector = {
  description: 'message@1 (Message Tasks 0.1 §3): body { type, mid, sentAt, text, replyTo? }, proof { mac }. k_msg = HKDF-SHA-256(X25519(pairX_sender, pairX_recipient), salt empty, info "rltp/v1/message/mac/" || senderPairAnchor || "/" || recipientPairAnchor, 32 bytes), anchors as the UTF-8 bytes of their did:key strings (3110); mac = "u" || base64url(HMAC-SHA-256(k_msg, JCS(body))) (Trust 2.1). Regenerate: node scripts/gen-message-vector.mjs (deterministic).',
  inputs: {
    source: 'oracle IKM = rootIkm of vectors/identity-derivation.json; sender A and recipient B are the parties A and B of vectors/visibility.json, their pair contexts derived from the listed relationship nonces',
    sender: A.pub,
    recipient: B.pub,
    body,
  },
  intermediate: {
    sharedSecret: 'u' + shared.toString('base64url'),
    info: msgInfo(A, B),
    kmsg: 'u' + kAB.toString('base64url'),
    preimage,
  },
  output: { message },
  negatives: [
    { name: 'wrong-direction', note: 'the key of the reverse direction (B → A): a message under it MUST NOT verify as A → B (3110)', info: msgInfo(B, A), wrongMac: hmacU(kmsg(B, A), preimage), expect: 'reject: mac' },
    { name: 'wrong-relationship', note: 'the same body under the key of another relationship (A2 → B2): MUST NOT verify on (A, B) (3110)', sender: 'A2', recipient: 'B2', info: msgInfo(A2, B2), wrongMac: hmacU(kmsg(A2, B2), preimage), expect: 'reject: mac' },
    { name: 'tampered-body', note: 'text changed, the mac of the positive kept: MUST NOT verify (3110)', artifact: { body: { ...body, text: 'See you tomorrow.' }, proof: { mac } }, expect: 'reject: mac' },
    { name: 'signed', note: 'a genuine raw Ed25519 signature of the sender pair key over JCS(body) as proofValue in place of mac (3010)', artifact: { body, proof: { proofValue: sigZ(A.ed, body) } }, expect: 'reject: schema' },
    { name: 'signed-and-mac', note: 'the genuine mac plus a proofValue (3010)', artifact: { body, proof: { mac, proofValue: sigZ(A.ed, body) } }, expect: 'reject: schema' },
    { name: 'extra-member', note: 'a conversationId member, mac over the mutated body: the closed body rejects it (3010)', artifact: withMac({ ...body, conversationId: '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e' }), expect: 'reject: schema' },
    { name: 'text-empty', note: 'text of 0 code points, mac over the mutated body (3020)', artifact: withMac({ ...body, text: '' }), expect: 'reject: schema' },
    { name: 'text-4097', note: 'text of 4097 code points, mac over the mutated body (3020)', artifact: withMac({ ...body, text: 'm'.repeat(4097) }), expect: 'reject: schema' },
    { name: 'sentAt-fraction', note: 'sentAt with fractional seconds, mac over the mutated body (3030)', artifact: withMac({ ...body, sentAt: '2026-10-20T09:14:03.250Z' }), expect: 'reject: schema' },
    { name: 'sentAt-april-31', note: 'sentAt on 31 April, mac over the mutated body (3030)', artifact: withMac({ ...body, sentAt: '2026-04-31T09:14:03Z' }), expect: 'reject: schema' },
    { name: 'mid-uppercase', note: 'mid in uppercase hexadecimal, mac over the mutated body (3010)', artifact: withMac({ ...body, mid: body.mid.toUpperCase() }), expect: 'reject: schema' },
  ],
}
assert([...'m'.repeat(4096)].length === 4096, 'code-point count')

// ── write or check ───────────────────────────────────────────────────────
const out = ['vectors/message.json', JSON.stringify(vector, null, 1) + '\n']
if (CHECK) {
  let held = null
  try { held = readFileSync(join(ROOT, out[0]), 'utf8') } catch { /* missing */ }
  if (held !== out[1]) { console.error(`${out[0]} is not what the generator produces`); process.exit(1) }
  console.log(`${out[0]} reproduces byte for byte`)
} else {
  writeFileSync(join(ROOT, out[0]), out[1])
  console.log('vectors/message.json written; mac =', mac)
}
