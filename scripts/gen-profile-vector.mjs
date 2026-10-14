#!/usr/bin/env node
// Generates vectors/profile.json — the executable vector for profile@1
// (Trust Layer 0.31 §6b): the directional key k_pr (6440), the MAC
// preimage (JCS of the body, 2.1), the expected MAC, and negatives for
// the closed body and its bounds (6430, 6435), the direction and the
// relationship of the key (6440), the absence of a signature (6470) and
// the absence of any anchor (6490), and pictures whose header declares
// more than 1024 × 1024 pixels (6435, 6475) — in a VP8X container in
// either of its two declarations, the canvas or the frame.
//
// Also regenerates the star@2 of vectors/visibility.json (§5.2: the key
// k of 5160 under salt 1, the entry HMAC(k, anchor bytes) of 5010, the
// mac of 5080) and the byte-identical replay negative, and keeps the
// file free of the former grade-declaration@1. The star A → B blinds the
// community anchor of a contact C whose anchor-mapping@3 toward A, A has
// verified (2040, 5010), never A's own `self`: C's anchor is group/<D_C>
// under the second-party IKM, HKDF-SHA-256(oracle IKM, salt empty,
// "rltp/vector/second-party-root-ikm", 64 bytes), D_C the multihash of
// the ASCII preimage named in visibility.json's starContact.
//
// Keys: the oracle IKM of vectors/identity-derivation.json; parties A
// (sender) and B (recipient) of vectors/visibility.json, their pair
// contexts from the listed relationship nonces (Identity: label
// pair/<multihash(nonce)>, seeds HKDF(IKM, "rltp/anchor/{ed,x}/" || label)).
// node:crypto only, deterministic: fixed inputs, no clock, no randomness.
//
//   usage: node scripts/gen-profile-vector.mjs [--check]   (from repo root)
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')
const J = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))
const assert = (c, m) => { if (!c) { console.error(`gen-profile-vector: ${m}`); process.exit(1) } }

// ── primitives (2.1) ─────────────────────────────────────────────────────
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
  assert(!shared.every((x) => x === 0), 'all-zero shared secret (2500)')
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
const A = party('A'), B = party('B'), A2 = party('A2'), B2 = party('B2'), R_T = party('R_T')

// ── profile@1 (6b) ───────────────────────────────────────────────────────
const profileInfo = (s, r) => `rltp/visibility/mac/profile/${s.anchor}/${r.anchor}`
const kpr = (s, r) => hkdf(ecdh(s.x, r.x), profileInfo(s, r))
// an 8×8 lossless WebP, a single VP8L chunk: no VP8X, EXIF, XMP or ICC chunk
const IMAGE = 'data:image/webp;base64,UklGRioAAABXRUJQVlA4TB4AAAAvB8ABAA/wU+u//I/M/McSBAJEtjgtFvRE9D/GxgA='
const body = { type: 'profile@1', revision: '1', name: 'Anna', image: IMAGE, text: 'Brot, Gärten, Fahrräder.' }
// genuine lossless WebPs (one VP8L chunk each, cwebp -lossless -z 9
// -metadata none of a single-colour picture), held as fixed bytes: their
// headers declare 1025 × 1025 (88 bytes) and 4096 × 4096 (704 bytes)
// pixels, both far inside the 60 000-character bound
const IMAGE_1025 = 'data:image/webp;base64,UklGRlAAAABXRUJQVlA4TEQAAAAvAAQAAQdQ0OJVq/8BAUnS//2BEf3P+M9//vOf//znP//5z3/+85///Oc///nPf/7zn//85z//+c9//vOf//znP///BA=='
const IMAGE_4096 = 'data:image/webp;base64,UklGRrgCAABXRUJQVlA4TKsCAAAv/8//AwdQ0OJVq//BEhIk+H+7PSISvYUECf/fm4zo/wQABeLvP4qIkP/+899///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333///ffff//9999///3333//AQA='
// an extended WebP (VP8X container) around the VP8L chunk of a picture
// above, the canvas declared in the VP8X chunk independently of the
// frame: flags 0 (no alpha, no animation, no metadata), canvas width-1
// and height-1 as 24-bit little-endian. Canvas and frame disagree on
// purpose: a reader that reads only one of the two declarations accepts
// one of the two negatives (6475)
const vp8x = (uri, w, h) => {
  const inner = Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64').subarray(12)
  const chunk = Buffer.alloc(18)
  chunk.write('VP8X', 0, 'ascii'); chunk.writeUInt32LE(10, 4); chunk.writeUIntLE(w - 1, 12, 3); chunk.writeUIntLE(h - 1, 15, 3)
  const riff = Buffer.alloc(12)
  riff.write('RIFF', 0, 'ascii'); riff.writeUInt32LE(4 + chunk.length + inner.length, 4); riff.write('WEBP', 8, 'ascii')
  return 'data:image/webp;base64,' + Buffer.concat([riff, chunk, inner]).toString('base64')
}
const IMAGE_CANVAS_8_FRAME_1025 = vp8x(IMAGE_1025, 8, 8)
const IMAGE_CANVAS_1025_FRAME_8 = vp8x(IMAGE, 1025, 1025)
const shared = ecdh(A.x, B.x)
assert(shared.equals(ecdh(B.x, A.x)), 'X25519 is symmetric')
const kAB = kpr(A, B)
const preimage = jcs(body)
const mac = hmacU(kAB, preimage)
const profile = { body, proof: { mac } }
const withMac = (b) => ({ body: b, proof: { mac: hmacU(kAB, jcs(b)) } })
const sigZ = (seed, b) => 'z' + b58(crypto.sign(null, Buffer.from(jcs(b), 'utf8'), privEd(seed)))

const profileVector = {
  description: 'profile@1 (Trust Layer 0.31 §6b): body { type, revision, name, image?, text? }, proof { mac }. k_pr = HKDF-SHA-256(X25519(pairX_sender, pairX_recipient), salt empty, info "rltp/visibility/mac/profile/" || senderPairAnchor || "/" || recipientPairAnchor, 32 bytes), anchors as the UTF-8 bytes of their did:key strings (2.1, 6440); mac = "u" || base64url(HMAC-SHA-256(k_pr, JCS(body))) (2.1). Regenerate: node scripts/gen-profile-vector.mjs (deterministic).',
  inputs: {
    source: 'oracle IKM = rootIkm of vectors/identity-derivation.json; sender A and recipient B are the parties A and B of vectors/visibility.json (the established relationship A_B), their pair contexts derived from the listed relationship nonces',
    sender: A.pub,
    recipient: B.pub,
    body,
    image: 'an 8×8 lossless WebP (one VP8L chunk, no metadata chunks)',
    dimensions: { width: 8, height: 8 },
  },
  intermediate: {
    sharedSecret: 'u' + shared.toString('base64url'),
    info: profileInfo(A, B),
    kpr: 'u' + kAB.toString('base64url'),
    preimage,
  },
  output: { profile },
  negatives: [
    { name: 'wrong-direction', note: 'the key of the reverse direction (B → A): the anchors swapped in the info string; a profile under it MUST NOT verify as A → B, so a profile cannot be replayed from one direction into the other (6440)', info: profileInfo(B, A), wrongMac: hmacU(kpr(B, A), preimage), expect: 'reject: mac' },
    { name: 'wrong-relationship', note: 'the same sender and body under the key of another relationship (A2 → B2): its MAC MUST NOT verify on (A, B), so a profile cannot be replayed into another relationship (6440)', sender: 'A2', recipient: 'B2', info: profileInfo(A2, B2), wrongMac: hmacU(kpr(A2, B2), preimage), expect: 'reject: mac' },
    { name: 'tampered-body', note: 'name changed, the mac of the positive kept: MUST NOT verify', artifact: { body: { ...body, name: 'Anne' }, proof: { mac } }, expect: 'reject: mac' },
    { name: 'signed', note: 'a genuine raw Ed25519 signature of the sender pair key over JCS(body) as proofValue in place of mac: rejected by the closed proof (6430, 6470)', artifact: { body, proof: { proofValue: sigZ(A.ed, body) } }, expect: 'reject: schema' },
    { name: 'signed-and-mac', note: 'the genuine mac plus a proofValue: a proof with more than mac is rejected (6430, 6470)', artifact: { body, proof: { mac, proofValue: sigZ(A.ed, body) } }, expect: 'reject: schema' },
    { name: 'third-party-anchor', note: 'an anchor member naming a third party (R_T), mac over the mutated body: the closed body rejects it (6430, 6490)', artifact: withMac({ ...body, anchor: R_T.anchor }), expect: 'reject: schema' },
    { name: 'name-65', note: 'name of 65 characters, mac over the mutated body (6435)', artifact: withMac({ ...body, name: 'A'.repeat(65) }), expect: 'reject: schema' },
    { name: 'text-257', note: 'text of 257 characters, mac over the mutated body (6435)', artifact: withMac({ ...body, text: 't'.repeat(257) }), expect: 'reject: schema' },
    { name: 'image-png', note: 'image of media type image/png, mac over the mutated body (6435)', artifact: withMac({ ...body, image: 'data:image/png;base64,iVBORw0KGgo=' }), expect: 'reject: schema' },
    { name: 'image-60003', note: 'image of 60 003 characters (6435): built as prefix || repeat.char × repeat.count and set at pointer; mac irrelevant', mutate: { pointer: '/body/image', prefix: 'data:image/webp;base64,', repeat: { char: 'A', count: 59980 } }, expect: 'reject: schema' },
    { name: 'image-1025x1025', note: 'a well-formed WebP whose VP8L header declares 1025 × 1025 pixels, one past the bound in each dimension; schema-valid, mac over the mutated body valid: only the pixel bound read from the encoded header before decoding rejects it (6435, 6475)', dimensions: { width: 1025, height: 1025 }, artifact: withMac({ ...body, image: IMAGE_1025 }), expect: 'reject: dimensions' },
    { name: 'image-4096x4096', note: 'a well-formed WebP of 704 bytes whose VP8L header declares 4096 × 4096 pixels, 64 MiB once decoded to RGBA; schema-valid, mac over the mutated body valid: only the pixel bound read from the encoded header before decoding rejects it (6435, 6475)', dimensions: { width: 4096, height: 4096 }, artifact: withMac({ ...body, image: IMAGE_4096 }), expect: 'reject: dimensions' },
    { name: 'image-vp8x-canvas-8-frame-1025', note: 'a VP8X container whose canvas (VP8X chunk) declares 8 × 8 and whose frame (the VP8L chunk of image-1025x1025) declares 1025 × 1025; schema-valid, mac over the mutated body valid: a reader that reads only the canvas accepts it, the bound applies to both declarations (6435, 6475)', dimensions: { canvas: { width: 8, height: 8 }, frame: { width: 1025, height: 1025 } }, artifact: withMac({ ...body, image: IMAGE_CANVAS_8_FRAME_1025 }), expect: 'reject: dimensions' },
    { name: 'image-vp8x-canvas-1025-frame-8', note: 'a VP8X container whose canvas (VP8X chunk) declares 1025 × 1025 and whose frame (the VP8L chunk of the positive) declares 8 × 8; schema-valid, mac over the mutated body valid: a reader that reads only the frame accepts it, the bound applies to both declarations (6435, 6475)', dimensions: { canvas: { width: 1025, height: 1025 }, frame: { width: 8, height: 8 } }, artifact: withMac({ ...body, image: IMAGE_CANVAS_1025_FRAME_8 }), expect: 'reject: dimensions' },
    { name: 'revision-0', note: 'revision "0" is outside the wire-integer domain (2580, 6450), mac over the mutated body', artifact: withMac({ ...body, revision: '0' }), expect: 'reject: schema' },
  ],
}

// ── star@2 of visibility.json (5.2) ──────────────────────────────────────
// the deliverable set of A toward B: one contact C who gave A its mapping
// (2040); its community anchor derives under the second-party IKM over a
// genesis digest of its own — A's own `self` is never a member (5010)
const IKM2 = Buffer.from(crypto.hkdfSync('sha256', IKM, Buffer.alloc(0), Buffer.from('rltp/vector/second-party-root-ikm', 'utf8'), 64))
const C_PREIMAGE = 'rltp/vectors/visibility/star-contact/C/genesis'
const cLabel = 'group/u' + Buffer.concat([Buffer.from([0x12, 0x20]), sha(Buffer.from(C_PREIMAGE, 'utf8'))]).toString('base64url')
const cEd = hkdf(IKM2, 'rltp/anchor/ed/' + cLabel), cX = hkdf(IKM2, 'rltp/anchor/x/' + cLabel)
const C = {
  label: cLabel,
  anchor: 'did:key:z' + b58(Buffer.concat([Buffer.from([0xed, 0x01]), pubRaw(privEd(cEd))])),
  keyAgreement: 'z' + b58(Buffer.concat([Buffer.from([0xec, 0x01]), pubRaw(privX(cX))])),
}
assert(![VIS.self.anchor, ...Object.values(VIS.parties).map((p) => p.anchor)].includes(C.anchor), 'C is neither A\'s self nor a pair context of the vector')
const starContact = {
  party: 'C',
  genesisPreimage: C_PREIMAGE,
  ...C,
  note: 'a contact C of A whose anchor-mapping@3 toward A, A has verified under 6.3 (fixture: that mapping lies outside this vector), so C is the one member of A\'s deliverable set toward B (2040). The star A → B blinds C\'s community anchor (5010); it never carries A\'s own community anchor `self`. C\'s anchor is group/<D_C> under the second-party IKM, HKDF-SHA-256(oracle IKM, salt empty, info "rltp/vector/second-party-root-ikm", 64 bytes); D_C = "u" || base64url(0x12 0x20 || SHA-256(UTF-8 of genesisPreimage)), a documented sample',
}
const salt = '1'
const kStar = hkdf(ecdh(A.x, B.x), `rltp/visibility/blind/star/${A.anchor}/${B.anchor}/${salt}`)
const starBody = { type: 'star@2', salt, seq: '1', last: true, blinded: [hmacU(kStar, C.anchor)].sort() }
assert(!starBody.blinded.includes(hmacU(kStar, VIS.self.anchor)), 'the star never blinds the sender\'s own self')
const star = { body: starBody, proof: { mac: hmacU(kStar, jcs(starBody)) } }
const { gradeDeclaration: _grade, ...artifacts } = VIS.artifacts
artifacts.star = star
const negative = VIS.negative.map((n) => n.name === 'star-salt-replay' ? { ...n, artifact: star } : n)
const roles = { ...VIS.roles, A_B: 'established relationship (star, mapping, profile, prior tuple of continuity)' }
const visibility = { ...VIS, roles, starContact, artifacts, negative }

// ── write or check ───────────────────────────────────────────────────────
const outputs = [
  ['vectors/profile.json', JSON.stringify(profileVector, null, 1) + '\n'],
  ['vectors/visibility.json', JSON.stringify(visibility, null, 1) + '\n'],
]
if (CHECK) {
  let bad = 0
  for (const [p, text] of outputs) {
    let held = null
    try { held = readFileSync(join(ROOT, p), 'utf8') } catch { /* missing */ }
    if (held !== text) { console.error(`${p} is not what the generator produces`); bad++ } else console.log(`${p} reproduces byte for byte`)
  }
  process.exit(bad ? 1 : 0)
} else {
  for (const [p, text] of outputs) writeFileSync(join(ROOT, p), text)
  console.log('vectors/profile.json written; mac =', mac)
  console.log('vectors/visibility.json: star@2 mac =', star.proof.mac, '; grade-declaration@1 removed')
}
