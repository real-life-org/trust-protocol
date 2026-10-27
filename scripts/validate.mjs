#!/usr/bin/env node
// Publication checks for the RLTP specification repository.
//
// JSON Schema settles the SHAPE of every wire artifact. This script settles
// what a schema cannot: that every schema compiles and cross-references
// resolve offline, that the shipped seal vector reproduces byte-for-byte
// from its deterministic inputs, and that the conformance fixtures which
// MUST fail actually fail.
//
// The fixture philosophy follows the ToIP DTGWG registry's
// validate-ceremonies.mjs: "a checker that has never been shown to fail is
// not evidence of anything."

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPrivateKey, createPublicKey, diffieHellman, hkdfSync, createCipheriv, createHash } from 'node:crypto'
import Ajv2020 from 'ajv/dist/2020.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let errors = 0
const err = (m) => { console.error(`  ERROR ${m}`); errors++ }
const ok = (m) => console.log(`  ok    ${m}`)

// ── 1. Every JSON artifact parses ────────────────────────────────────────
const jsonFiles = []
for (const dir of ['schemas', 'contexts', 'vectors', 'fixtures', 'interop/ceremonies']) {
  for (const f of readdirSync(join(ROOT, dir))) {
    if (f.endsWith('.json') || f.endsWith('.jsonld')) jsonFiles.push(join(dir, f))
  }
}
const parsed = {}
for (const f of jsonFiles) {
  try { parsed[f] = JSON.parse(readFileSync(join(ROOT, f), 'utf8')); ok(`parses: ${f}`) }
  catch (e) { err(`${f}: ${e.message}`) }
}

// ── 2. Every schema compiles; cross-references resolve OFFLINE ───────────
const ajv = new Ajv2020({ strict: false, allErrors: true, loadSchema: async (uri) => {
  throw new Error(`network resolution forbidden (offline rule): ${uri}`)
}})
const schemaFiles = Object.keys(parsed).filter((f) => f.startsWith('schemas/'))
for (const f of schemaFiles) ajv.addSchema(parsed[f], parsed[f].$id || 'https://real-life.org/rltp/v1/' + f)
const validators = {}
for (const f of schemaFiles) {
  try { validators[parsed[f].$id || f] = ajv.compile(parsed[f]); ok(`compiles: ${f}`) }
  catch (e) { err(`${f}: ${e.message}`) }
}

// ── 3. The seal vector reproduces byte-for-byte ──────────────────────────
const v = parsed['vectors/seal.json']
const b64u = (b) => Buffer.from(b).toString('base64url')
const pkcs8 = (raw) => Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), raw])
const jcs = (o) => Array.isArray(o) ? '[' + o.map(jcs).join(',') + ']'
  : (o && typeof o === 'object') ? '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + jcs(o[k])).join(',') + '}'
  : JSON.stringify(o)
try {
  const recipientPriv = createPrivateKey({ key: pkcs8(Buffer.from(v.inputs.recipientPrivateKeyRaw, 'base64url')), format: 'der', type: 'pkcs8' })
  const ephemeralPriv = createPrivateKey({ key: pkcs8(Buffer.from(v.inputs.ephemeralPrivateKeyRaw, 'base64url')), format: 'der', type: 'pkcs8' })
  const plaintext = Buffer.from(jcs(v.inputs.document), 'utf8')
  if (plaintext.toString('utf8') !== v.intermediate.plaintextJcs) throw new Error('JCS plaintext mismatch')
  const shared = diffieHellman({ privateKey: ephemeralPriv, publicKey: createPublicKey(recipientPriv) })
  if (shared.every((x) => x === 0)) throw new Error('all-zero shared secret')
  if (b64u(shared) !== v.intermediate.sharedSecret) throw new Error('shared secret mismatch')
  const key = Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), 'rltp/v1/seal', 32))
  if (b64u(key) !== v.intermediate.aesKey) throw new Error('HKDF key mismatch')
  const c = createCipheriv('aes-256-gcm', key, Buffer.from(v.inputs.nonce, 'base64url'))
  const ct = Buffer.concat([c.update(plaintext), c.final(), c.getAuthTag()])
  if (b64u(ct) !== v.output.sealedEnvelope.ciphertext) throw new Error('ciphertext mismatch')
  const digest = 'u' + b64u(Buffer.concat([Buffer.from([0x12, 0x20]), createHash('sha256').update(plaintext).digest()]))
  if (digest !== v.output.documentDigest) throw new Error('document digest mismatch (multihash)')
  const mh = Buffer.from(v.output.documentDigest.slice(1), 'base64url')
  if (mh[0] !== 0x12 || mh[1] !== 0x20 || mh.length !== 34) throw new Error('digest is not sha2-256 multihash')
  ok('seal vector reproduces byte-for-byte (JCS, X25519, HKDF, AES-GCM, multihash digest)')
} catch (e) { err(`seal vector: ${e.message}`) }

// ── 3a. The profile@1 vector reproduces byte-for-byte (Trust Layer §6b) ──
// k_pr and mac recomputed with node:crypto from the oracle IKM and the pair
// contexts of vectors/visibility.json (scripts/gen-profile-vector.mjs); the
// positive passes its schema, every negative fails as it declares. The
// pixel bound (6435, 6475) is checked from the encoded header alone, before
// any decoding: WebP (VP8, VP8L, VP8X — canvas and frame, both bounded)
// and JPEG (SOFn); unreadable = reject.
try {
  const { createHmac } = await import('node:crypto')
  const pv = parsed['vectors/profile.json'], vis = parsed['vectors/visibility.json']
  const ikm = Buffer.from(parsed['vectors/identity-derivation.json'].rootIkm, 'hex')
  const xKey = (name) => {
    const p = vis.parties[name]
    const label = 'pair/u' + b64u(Buffer.concat([Buffer.from([0x12, 0x20]), createHash('sha256').update(Buffer.from(p.relationshipNonce, 'hex')).digest()]))
    if (label !== p.label) throw new Error(`party ${name}: label is not pair/<multihash(nonce)>`)
    return createPrivateKey({ key: pkcs8(Buffer.from(hkdfSync('sha256', ikm, Buffer.alloc(0), 'rltp/anchor/x/' + label, 32))), format: 'der', type: 'pkcs8' })
  }
  const ikmOf = (s, r) => diffieHellman({ privateKey: xKey(s), publicKey: createPublicKey(xKey(r)) })
  const macU = (s, r, info, preimage) => 'u' + b64u(createHmac('sha256', Buffer.from(hkdfSync('sha256', ikmOf(s, r), Buffer.alloc(0), info, 32))).update(Buffer.from(preimage, 'utf8')).digest())
  const { sender: S, recipient: R, body } = pv.inputs
  for (const p of [S, R]) if (jcs({ ...vis.parties[p.party], party: p.party }) !== jcs(p)) throw new Error(`party ${p.party} differs from vectors/visibility.json`)
  const info = `rltp/visibility/mac/profile/${S.anchor}/${R.anchor}`
  const shared = ikmOf(S.party, R.party)
  if (shared.every((x) => x === 0)) throw new Error('all-zero shared secret')
  if ('u' + b64u(shared) !== pv.intermediate.sharedSecret) throw new Error('shared secret mismatch')
  if (info !== pv.intermediate.info) throw new Error('info string mismatch')
  if ('u' + b64u(Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), info, 32))) !== pv.intermediate.kpr) throw new Error('HKDF k_pr mismatch')
  if (jcs(body) !== pv.intermediate.preimage || jcs(pv.output.profile.body) !== jcs(body)) throw new Error('JCS preimage mismatch')
  const mac = macU(S.party, R.party, info, jcs(body))
  if (mac !== pv.output.profile.proof.mac) throw new Error('mac mismatch')
  const validate = validators[parsed['schemas/trust-profile.schema.json'].$id]
  if (!validate(pv.output.profile)) throw new Error(`positive fails trust-profile.schema.json: ${ajv.errorsText(validate.errors)}`)
  const img = Buffer.from(body.image.split(',')[1], 'base64')
  if (img.subarray(0, 4).toString() !== 'RIFF' || img.subarray(8, 12).toString() !== 'WEBP' || img.readUInt32LE(4) + 8 !== img.length) throw new Error('image is not a well-formed RIFF/WEBP')
  // picture dimensions from the encoded header, no decoding (6475); null = unreadable
  const headerDims = (uri) => {
    const [, mt] = /^data:(image\/(?:jpeg|webp));base64,/.exec(uri) ?? []
    const b = Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64')
    if (mt === 'image/webp') {
      if (b.length < 30 || b.subarray(0, 4).toString() !== 'RIFF' || b.subarray(8, 12).toString() !== 'WEBP' || b.readUInt32LE(4) + 8 !== b.length) return null
      // the frame of a VP8L or VP8 chunk at offset o (its payload at o + 8)
      const frame = (o) => {
        const fourcc = b.subarray(o, o + 4).toString(), p = o + 8
        if (fourcc === 'VP8L' && p + 5 <= b.length && b[p] === 0x2f) { const v = b.readUInt32LE(p + 1); return { width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1 } }
        if (fourcc === 'VP8 ' && p + 10 <= b.length && b[p + 3] === 0x9d && b[p + 4] === 0x01 && b[p + 5] === 0x2a) return { width: b.readUInt16LE(p + 6) & 0x3fff, height: b.readUInt16LE(p + 8) & 0x3fff }
        return null
      }
      if (b.subarray(12, 16).toString() !== 'VP8X') return frame(12)
      // VP8X carries two declarations: the canvas in its own chunk and the
      // frame in the VP8/VP8L chunk that follows; both are read (6475). An
      // animation (flag bit 1, ANIM/ANMF) is not a single still picture.
      if (b.readUInt32LE(16) !== 10 || (b[20] & 0x02)) return null
      const canvas = { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 }
      for (let o = 30; o + 8 <= b.length; o += 8 + b.readUInt32LE(o + 4) + (b.readUInt32LE(o + 4) & 1)) {
        const fourcc = b.subarray(o, o + 4).toString()
        if (fourcc === 'ANIM' || fourcc === 'ANMF') return null
        if (fourcc === 'VP8L' || fourcc === 'VP8 ') { const f = frame(o); return f === null ? null : { canvas, frame: f } }
      }
      return null
    }
    if (mt === 'image/jpeg') {
      if (b[0] !== 0xff || b[1] !== 0xd8) return null
      for (let i = 2; i + 9 <= b.length;) {
        if (b[i] !== 0xff) return null
        const m = b[i + 1], len = b.readUInt16BE(i + 2)
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) }
        i += 2 + len
      }
    }
    return null
  }
  const within = (d) => d.width >= 1 && d.height >= 1 && d.width <= 1024 && d.height <= 1024
  const dimsOk = (d) => d !== null && (d.canvas ? within(d.canvas) && within(d.frame) : within(d))
  const posDims = headerDims(body.image)
  if (!dimsOk(posDims) || jcs(posDims) !== jcs(pv.inputs.dimensions)) throw new Error(`positive image header declares ${jcs(posDims)}, not ${jcs(pv.inputs.dimensions)} within 1024 × 1024`)
  for (const n of pv.negatives) {
    if (n.wrongMac) {
      const [s, r] = n.sender ? [n.sender, n.recipient] : [S.party, R.party]
      if (n.info === info || macU(s, r, n.info, jcs(body)) !== n.wrongMac || n.wrongMac === mac) throw new Error(`negative ${n.name}: the wrong key does not reproduce or coincides with k_pr`)
      continue
    }
    const a = n.artifact ?? (() => { const d = structuredClone(pv.output.profile); d.body[n.mutate.pointer.split('/').at(-1)] = n.mutate.prefix + n.mutate.repeat.char.repeat(n.mutate.repeat.count); return d })()
    if (n.expect === 'reject: mac' && (!validate(a) || macU(S.party, R.party, info, jcs(a.body)) === a.proof.mac)) throw new Error(`negative ${n.name}: not a schema-valid artifact whose mac fails`)
    if (n.expect === 'reject: schema' && validate(a)) throw new Error(`negative ${n.name}: passes the schema`)
    if (n.expect === 'reject: dimensions') {
      if (!validate(a) || macU(S.party, R.party, info, jcs(a.body)) !== a.proof.mac) throw new Error(`negative ${n.name}: not a schema-valid, mac-valid artifact`)
      const d = headerDims(a.body.image)
      if (d === null || jcs(d) !== jcs(n.dimensions) || dimsOk(d)) throw new Error(`negative ${n.name}: header declares ${jcs(d)}, not ${jcs(n.dimensions)} beyond 1024 × 1024`)
    }
    if (!['reject: mac', 'reject: schema', 'reject: dimensions'].includes(n.expect)) throw new Error(`negative ${n.name}: unknown expectation ${n.expect}`)
  }
  ok(`profile vector reproduces byte-for-byte (X25519, HKDF k_pr, JCS, HMAC mac); schema-valid; header dimensions within 1024 × 1024; ${pv.negatives.length} negatives fail as declared`)
} catch (e) { err(`profile vector: ${e.message}`) }

// ── 3c. The message@1 vector reproduces byte-for-byte (Message Tasks §3) ──
// X25519 of the parties' pair keys, HKDF k_msg (3110), JCS preimage, HMAC
// mac; the positive passes its schema, every negative fails as it declares.
try {
  const { createHmac } = await import('node:crypto')
  const mv = parsed['vectors/message.json'], vis = parsed['vectors/visibility.json']
  const ikm = Buffer.from(parsed['vectors/identity-derivation.json'].rootIkm, 'hex')
  const xKey = (name) => {
    const p = vis.parties[name]
    const label = 'pair/u' + b64u(Buffer.concat([Buffer.from([0x12, 0x20]), createHash('sha256').update(Buffer.from(p.relationshipNonce, 'hex')).digest()]))
    if (label !== p.label) throw new Error(`party ${name}: label is not pair/<multihash(nonce)>`)
    return createPrivateKey({ key: pkcs8(Buffer.from(hkdfSync('sha256', ikm, Buffer.alloc(0), 'rltp/anchor/x/' + label, 32))), format: 'der', type: 'pkcs8' })
  }
  const ikmOf = (s, r) => diffieHellman({ privateKey: xKey(s), publicKey: createPublicKey(xKey(r)) })
  const macU = (s, r, info, preimage) => 'u' + b64u(createHmac('sha256', Buffer.from(hkdfSync('sha256', ikmOf(s, r), Buffer.alloc(0), info, 32))).update(Buffer.from(preimage, 'utf8')).digest())
  const { sender: S, recipient: R, body } = mv.inputs
  for (const p of [S, R]) if (jcs({ ...vis.parties[p.party], party: p.party }) !== jcs(p)) throw new Error(`party ${p.party} differs from vectors/visibility.json`)
  const info = `rltp/v1/message/mac/${S.anchor}/${R.anchor}`
  const shared = ikmOf(S.party, R.party)
  if (shared.every((x) => x === 0)) throw new Error('all-zero shared secret')
  if ('u' + b64u(shared) !== mv.intermediate.sharedSecret) throw new Error('shared secret mismatch')
  if (info !== mv.intermediate.info) throw new Error('info string mismatch')
  if ('u' + b64u(Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), info, 32))) !== mv.intermediate.kmsg) throw new Error('HKDF k_msg mismatch')
  if (jcs(body) !== mv.intermediate.preimage || jcs(mv.output.message.body) !== jcs(body)) throw new Error('JCS preimage mismatch')
  const mac = macU(S.party, R.party, info, jcs(body))
  if (mac !== mv.output.message.proof.mac) throw new Error('mac mismatch')
  const validate = validators[parsed['schemas/message.schema.json'].$id]
  if (!validate(mv.output.message)) throw new Error(`positive fails message.schema.json: ${ajv.errorsText(validate.errors)}`)
  if (new Date(body.sentAt).toISOString().replace('.000Z', 'Z') !== body.sentAt) throw new Error('positive sentAt is no calendar date')
  for (const n of mv.negatives) {
    if (n.wrongMac) {
      const [s, r] = n.sender ? [n.sender, n.recipient] : [S.party, R.party]
      if (n.info === info || macU(s, r, n.info, jcs(body)) !== n.wrongMac || n.wrongMac === mac) throw new Error(`negative ${n.name}: the wrong key does not reproduce or coincides with k_msg`)
      continue
    }
    if (n.expect === 'reject: all-zero') {
      const raw = Buffer.from(n.recipientKeyAgreementRaw.slice(1), 'base64url')
      const low = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), raw]), format: 'der', type: 'spki' })
      let out = null
      try { out = diffieHellman({ privateKey: xKey(S.party), publicKey: low }) } catch { out = Buffer.alloc(32) }
      if (!out.every((x) => x === 0)) throw new Error(`negative ${n.name}: the low-order key does not yield the all-zero output`)
      continue
    }
    const a = n.artifact
    if (n.expect === 'reject: calendar') {
      const t = a.body.sentAt, d = new Date(t)
      if (!validate(a) || macU(S.party, R.party, info, jcs(a.body)) !== a.proof.mac) throw new Error(`negative ${n.name}: not a schema-valid, mac-valid artifact`)
      if (!Number.isNaN(d.getTime()) && d.toISOString().replace('.000Z', 'Z') === t) throw new Error(`negative ${n.name}: ${t} is a calendar date`)
      continue
    }
    if (n.expect === 'reject: mac' && (!validate(a) || macU(S.party, R.party, info, jcs(a.body)) === a.proof.mac)) throw new Error(`negative ${n.name}: not a schema-valid artifact whose mac fails`)
    if (n.expect === 'reject: schema' && validate(a)) throw new Error(`negative ${n.name}: passes the schema`)
    if (!['reject: mac', 'reject: schema'].includes(n.expect)) throw new Error(`negative ${n.name}: unknown expectation ${n.expect}`)
  }
  ok(`message vector reproduces byte-for-byte (X25519, HKDF k_msg, JCS, HMAC mac); schema-valid; ${mv.negatives.length} negatives fail as declared`)
} catch (e) { err(`message vector: ${e.message}`) }

// ── 3b. The pre-rotation bindings reproduce byte-for-byte (Identity 5.4, Trust 6.5) ──
// commit(g) = "u" || base64url(0x12 0x20 || SHA-256(0xed 0x01 || Ed25519
// public key of generation g)): the multikey bytes are exactly the bytes
// the did:key identifier encodes after its "z" (Identity 8.1). Every key
// is re-derived from the oracle IKM (HKDF(IKM, "rltp/anchor/ed/" || label)),
// every binding recomputed, and every commit the anchor vectors carry
// checked against the generation it names.
try {
  const ar = parsed['vectors/anchor-rotation.json'], vis = parsed['vectors/visibility.json']
  const ikm = Buffer.from(parsed['vectors/identity-derivation.json'].rootIkm, 'hex')
  const ikm2 = Buffer.from(hkdfSync('sha256', ikm, Buffer.alloc(0), 'rltp/vector/second-party-root-ikm', 64))
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const b58 = (b) => { let n = BigInt('0x' + b.toString('hex')), s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n } for (const x of b) { if (x === 0) s = '1' + s; else break } return s }
  const edPkcs8 = (seed) => Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed])
  const multikey = (root, label) => {
    const seed = Buffer.from(hkdfSync('sha256', root, Buffer.alloc(0), 'rltp/anchor/ed/' + label, 32))
    const spki = createPublicKey(createPrivateKey({ key: edPkcs8(seed), format: 'der', type: 'pkcs8' })).export({ format: 'der', type: 'spki' })
    return Buffer.concat([Buffer.from([0xed, 0x01]), spki.subarray(spki.length - 32)])
  }
  const commitOver = (mk) => 'u' + b64u(Buffer.concat([Buffer.from([0x12, 0x20]), createHash('sha256').update(mk).digest()]))
  const D = ar.community.genesisDigest
  const labelOf = (g) => (g === 1 ? `group/${D}` : `group/${D}/${g}`)
  const did = {}, commit = {}
  for (let g = 1; g <= 67; g++) { const mk = multikey(ikm, labelOf(g)); did[g] = 'did:key:z' + b58(mk); commit[g] = commitOver(mk) }
  for (const [g, p] of Object.entries(ar.community.generations)) if (p.anchor !== did[g]) throw new Error(`generation ${g}: the anchor is not did:key:z || base58btc(multikey bytes)`)
  for (const [g, b] of Object.entries(ar.community.bindings)) {
    const mk = multikey(ikm, labelOf(+g))
    if (b.multikeyBytes !== mk.toString('hex') || mk.length !== 34) throw new Error(`binding ${g}: multikey bytes differ`)
    if (b.sha256 !== createHash('sha256').update(mk).digest('hex')) throw new Error(`binding ${g}: SHA-256 differs`)
    if (b.commit !== commit[g] || b.commit.length !== 47) throw new Error(`binding ${g}: commit differs`)
  }
  for (const g of ['3', '4']) {
    const mk = multikey(ikm2, labelOf(+g))
    if (ar.foreignGenerations[g].anchor !== 'did:key:z' + b58(mk) || ar.foreignGenerations[g].commit !== commitOver(mk)) throw new Error(`foreign generation ${g}: anchor or commit differs`)
  }
  const gOf = (a) => { const g = Object.keys(did).find((k) => did[k] === a); return g === undefined ? null : +g }
  // a carrier introducing generation g commits to g + 1; a rotation prev → next commits to the generation after next
  const cardOK = (c) => c.body.commit === commit[gOf(c.body.anchor) + 1]
  const rotOK = (r) => r.body.commit === commit[gOf(r.body.next) + 1] && gOf(r.body.next) === gOf(r.body.prev) + 1
  if (!cardOK(ar.card) || gOf(ar.card.body.anchor) !== 1) throw new Error('the generation-1 card does not commit to generation 2')
  for (const v of ar.valid) {
    if (!rotOK(v.artifact)) throw new Error(`${v.name}: commit is not the binding over the generation after next`)
    if (commit[gOf(v.artifact.body.next)] !== v.heldBinding.commit) throw new Error(`${v.name}: the binding over next is not the held binding`)
  }
  const mm = ar.negative.find((n) => n.name === 'binding-mismatch')
  if (!mm || commitOver(multikey(ikm2, labelOf(3))) === mm.heldBinding.commit || mm.artifact.body.next !== ar.foreignGenerations['3'].anchor || mm.heldBinding.commit !== commit[3]) throw new Error('binding-mismatch: the held binding is not generation 3\'s, or the foreign next meets it')
  const A = vis.artifacts
  if (!cardOK(A.selfCard) || gOf(A.selfCard.body.anchor) !== 1) throw new Error('visibility selfCard does not commit to generation 2')
  for (const [name, m] of [['anchorMappingRotated', A.anchorMappingRotated], ['anchorMappingGeneration3', A.anchorMappingGeneration3], ['anchorMappingLineage64', A.anchorMappingLineage64]]) {
    if (!cardOK(m.body.card)) throw new Error(`${name}: the card does not commit to the generation after self`)
    m.body.lineage.forEach((r, i) => {
      if (!rotOK(r)) throw new Error(`${name}: lineage element ${i}: commit is not the binding over the generation after next`)
      if (i > 0 && commit[gOf(r.body.next)] !== m.body.lineage[i - 1].body.commit) throw new Error(`${name}: lineage element ${i}: next misses the preceding binding`)
    })
  }
  const broken = vis.negative.find((n) => n.name === 'mapping-lineage-binding-broken')?.artifact
  if (!broken || broken.body.lineage[0].body.commit !== commit[3] || broken.body.lineage[1].body.next !== ar.foreignGenerations['3'].anchor || commitOver(multikey(ikm2, labelOf(3))) === broken.body.lineage[0].body.commit) throw new Error('mapping-lineage-binding-broken: the break is not at the binding')
  ok('pre-rotation bindings reproduce byte-for-byte (HKDF → Ed25519 → multikey bytes 0xed 0x01 || key → sha2-256 multihash, u-encoded); every card and rotation commits to the generation after the one it introduces; the binding negatives miss it')
} catch (e) { err(`anchor bindings: ${e.message}`) }

// ── 4. Conformance fixtures: bases MUST pass, mutations MUST fail ────────
const fx = parsed['fixtures/invalid-examples.json']
const setPointer = (obj, ptr, val) => {
  const parts = ptr.split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
  let o = obj
  for (const p of parts.slice(0, -1)) o = o[p]
  o[parts.at(-1)] = val
}
const delPointer = (obj, ptr) => {
  const parts = ptr.split('/').slice(1)
  let o = obj
  for (const p of parts.slice(0, -1)) o = o[p]
  delete o[parts.at(-1)]
}
for (const [name, base] of Object.entries(fx.bases)) {
  const validate = validators[base.schema]
  if (!validate) { err(`fixture base ${name}: unknown schema ${base.schema}`); continue }
  if (!validate(base.document)) err(`fixture base ${name} MUST pass its schema but fails: ${ajv.errorsText(validate.errors)}`)
  else ok(`fixture base passes: ${name}`)
}
for (const c of fx.cases) {
  const base = fx.bases[c.base]
  const validate = validators[base.schema]
  const doc = structuredClone(base.document)
  if (c.set) for (const [ptr, val] of Object.entries(c.set)) setPointer(doc, ptr, val)
  if (c.delete) for (const ptr of [].concat(c.delete)) delPointer(doc, ptr)
  if (validate(doc)) err(`fixture MUST fail but passes: ${c.name}`)
  else ok(`fixture fails as required: ${c.name}`)
}

// ── 5. Spec examples agree with the schemas they illustrate ──────────────
// Both this project and the ToIP DTGWG registry independently found the same
// failure: "prose is not machine-checked, so an example can contradict its own
// schema." The specifications elide for readability (`{ …operation-specific… }`),
// so most examples are illustrations rather than documents. Two depths follow
// from that, and both are real:
//
//   · a complete example is validated against its schema, as a document;
//   · an elided example still has field NAMES, and a name the schema does not
//     define anywhere is drift — the class this check exists to catch.
//
// An example is matched to its schema by the wire version it carries. Examples
// without one are fragments (a policy object, a `keys` member) and are reported
// as unmatched rather than silently skipped.
const specFiles = readdirSync(join(ROOT, 'spec')).filter((f) => f.endsWith('.md'))

// Every property name the schema defines, following $refs through the bundle.
const byId = Object.fromEntries(schemaFiles.map((f) => [parsed[f].$id, parsed[f]]))
const propNames = (schema, seen = new Set()) => {
  const out = new Set()
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    for (const [k, v] of Object.entries(node)) {
      if (k === 'properties' && v && typeof v === 'object') Object.keys(v).forEach((p) => out.add(p))
      if (k === '$ref' && typeof v === 'string') {
        const id = v.split('#')[0]
        if (id && byId[id] && !seen.has(id)) { seen.add(id); propNames(byId[id], seen).forEach((p) => out.add(p)) }
      }
      walk(v)
    }
  }
  walk(schema)
  return out
}
const schemaForWire = (wire) => schemaFiles
  .map((f) => parsed[f])
  .find((s) => s?.properties?.v?.const === wire || s?.properties?.v?.enum?.includes(wire))

for (const f of specFiles) {
  const text = readFileSync(join(ROOT, 'spec', f), 'utf8')
  const blocks = [...text.matchAll(/^```json\n([\s\S]*?)^```/gm)]
  for (const [i, m] of blocks.entries()) {
    const body = m[1]
    const line = text.slice(0, m.index).split('\n').length
    const label = `spec/${f}:${line} (example ${i + 1})`
    const wire = body.match(/"v"\s*:\s*"([^"]+)"/)?.[1]
    if (!wire) { ok(`${label}: fragment without a wire version — not schema-matched`); continue }

    const schema = schemaForWire(wire)
    if (!schema) { err(`${label}: carries "${wire}", which no shipped schema declares`); continue }
    const validate = validators[schema.$id]

    // The corpus elides with "…" — inside a value as much as in place of a
    // block. Its presence, not parseability, is what marks an illustration:
    // `"did:key:z6Mk…group"` parses fine and is still not a document.
    const elided = body.includes('…')
    let doc = null
    if (!elided) { try { doc = JSON.parse(body) } catch { /* malformed */ } }

    if (doc) {
      if (!validate(doc)) err(`${label}: complete example does not satisfy ${basename(schema.$id)}: ${ajv.errorsText(validate.errors)}`)
      else ok(`${label}: complete example satisfies ${basename(schema.$id)}`)
    } else if (!elided) {
      err(`${label}: carries a wire version but is neither valid JSON nor marked as elided`)
    } else {
      const used = new Set([...body.matchAll(/"([A-Za-z][A-Za-z0-9_-]*)"\s*:/g)].map((x) => x[1]))
      const unknown = [...used].filter((p) => !propNames(schema).has(p))
      const missing = (schema.required ?? []).filter((p) => !used.has(p))
      if (unknown.length) err(`${label}: names field(s) ${basename(schema.$id)} does not define: ${unknown.join(', ')}`)
      else if (missing.length) err(`${label}: omits field(s) ${basename(schema.$id)} requires: ${missing.join(', ')}`)
      else ok(`${label}: elided example — fields all defined, all required fields shown`)
    }
  }
}

// ── 6. Rule traces (manifest ↔ numbered rules), Encounter, Access, Membership, Trust, Message, Delivery, Adapter ──
// Always against the committed manifests conformance/encounter-rule-ids-0.32.txt,
// conformance/access-rule-ids-0.58.txt, conformance/membership-rule-ids-0.21.txt,
// conformance/trust-rule-ids-0.31.txt, conformance/message-rule-ids-0.2.txt,
// conformance/delivery-rule-ids-0.85.txt and conformance/adapter-vti-rule-ids-0.29.txt. The private rule inventory of the
// Encounter, Access and Membership layers is checked additionally when
// present, and is REQUIRED when ENCOUNTER_INVENTORY / ACCESS_INVENTORY /
// MEMBERSHIP_INVENTORY names it. The Trust, Message, Delivery and Adapter traces run against their manifests
// only (the inventory is checked by hand: check-encounter-trace.mjs --layer
// trust --inventory <file>).
{
  const { checkTrace, resolveInventory, LAYERS } = await import('./check-encounter-trace.mjs')
  for (const layer of ['encounter', 'access', 'membership', 'trust', 'message', 'delivery', 'adapter']) {
    const { path: inventory } = layer === 'trust' || layer === 'message' || layer === 'delivery' || layer === 'adapter' ? { path: null } : resolveInventory(process.env[LAYERS[layer].env], layer)
    const r = checkTrace({ layer, inventory })
    for (const e of r.errors) err(`${layer} trace: ${e}`)
    if (!r.errors.length) ok(`${layer} trace: ${r.rules} rule identifiers ↔ manifest (${r.manifest})${r.inventory === null ? '; inventory not present, not checked' : ` ↔ inventory (${r.inventory})`}, one-to-one`)
    // Membership rule coverage (RLTP-MT-10080, 10100): every rule of the
    // manifest is proven by a vector case or runner check, or by a check of
    // this script, or listed in the state-dependent set of Section 10.3
    // (MEMBERSHIP_STATE_DEPENDENT names a file in its place) — never both.
    if (layer === 'membership') {
      const { membershipCoverage } = await import('./membership-checks.mjs')
      const c = membershipCoverage({ spec: LAYERS.membership.spec, manifestPath: LAYERS.membership.manifest, stateFile: process.env.MEMBERSHIP_STATE_DEPENDENT || null })
      for (const k of c.checks) if (k.ok) ok(`membership: ${k.msg} [${k.rules.join(', ')}]`)
      for (const e of c.errors) err(`membership coverage: ${e}`)
      if (!c.errors.length) ok(`membership coverage: ${c.counts.manifest} rules = ${c.counts.full} checked completely (${c.counts.runner} runner, ${c.counts.validate} validate) ∪ ${c.counts.partial} in part ∪ ${c.counts.stateDependent} state-dependent (${c.stateSource}), disjoint [RLTP-MT-10080, RLTP-MT-10100]`)
    }
  }
}

// ── 7. SKOS hierarchy links are IRIs, not literals ───────────────────────
// The shared context coerces inScheme and the *Match properties to @id, but
// not broader/narrower/related. A bare string there is a JSON-LD literal and
// the hierarchy is invisible to graph consumers; the value must be {"@id"} and
// name a concept of this scheme.
{
  const skos = JSON.parse(readFileSync(join(ROOT, 'terms/rltp.skos.jsonld'), 'utf8'))
  const ids = new Set(skos['@graph'].map((n) => n['@id']))
  let links = 0
  for (const node of skos['@graph']) {
    for (const prop of ['skos:broader', 'skos:narrower', 'skos:related']) {
      if (!(prop in node)) continue
      for (const v of [].concat(node[prop])) {
        links++
        if (typeof v !== 'object' || v === null || typeof v['@id'] !== 'string') err(`skos: ${node['@id']} ${prop} is a literal, not {"@id"}: ${JSON.stringify(v)}`)
        else if (!ids.has(v['@id'])) err(`skos: ${node['@id']} ${prop} names an unknown concept: ${v['@id']}`)
      }
    }
  }
  if (!errors) ok(`skos: ${links} hierarchy link(s) are IRIs naming concepts of the scheme`)
}

// ── 8. Ceremony definitions validate against the DTGWG meta-schema ───────
// interop/ceremonies/dtgwg/ceremony.meta.schema.json is a byte copy of the
// ToIP DTGWG trust-tasks-tf ceremonies/ceremony.meta.schema.json (provenance
// in interop/ceremonies/index.md). Every *.ceremony.json MUST validate; a
// definition with an enactmentPrivacy outside the meta-schema's enum MUST
// fail, so the check is shown to fail. The completion semantics of each
// definition are checked beyond the schema below.
{
  const meta = JSON.parse(readFileSync(join(ROOT, 'interop/ceremonies/dtgwg/ceremony.meta.schema.json'), 'utf8'))
  const check = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(meta)
  const defs = readdirSync(join(ROOT, 'interop/ceremonies')).filter((f) => f.endsWith('.ceremony.json'))
  for (const f of defs) {
    const d = parsed[`interop/ceremonies/${f}`]
    if (check(d)) ok(`ceremony: ${f} validates against the DTGWG ceremony meta-schema`)
    else err(`ceremony: ${f}: ${check.errors.map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ')}`)
    if (check({ ...d, enactmentPrivacy: 'plain' })) err(`ceremony: ${f} with enactmentPrivacy "plain" is accepted — the meta-schema check is not effective`)
    else ok(`ceremony: ${f} with enactmentPrivacy "plain" is rejected (must-fail)`)
  }
  if (!defs.length) err('ceremony: no *.ceremony.json under interop/ceremonies')

  // Schema validity cannot see whether a step set the definition calls
  // complete is one a DTGWG verifier accepts (design note §7.9): the
  // completion predicate holds, every non-optional step is present, every
  // present step's prev is present, and a terminal step is among them —
  // otherwise the set is a prefix. countersigned (§7.5) promises every
  // participant's signature, so every role must issue a non-optional step.
  const holds = (p, set) =>
    typeof p === 'string' ? set.has(p)
      : p.allOf ? p.allOf.every((q) => holds(q, set))
      : p.anyOf ? p.anyOf.some((q) => holds(q, set))
      : p.threshold?.of ? p.threshold.of.filter((q) => holds(q, set)).length >= p.threshold.n
      : false
  const complete = (d, names) => {
    const set = new Set(names)
    const steps = Object.entries(d.steps)
    return holds(d.completion, set)
      && steps.every(([n, s]) => s.optional || set.has(n))
      && names.every((n) => d.steps[n] && (d.steps[n].prev ?? []).every((q) => set.has(q)))
      && names.some((n) => d.steps[n].terminal)
  }
  for (const f of defs) {
    const d = parsed[`interop/ceremonies/${f}`]
    if (d.evidence?.level !== 'countersigned') continue
    const silent = Object.keys(d.roles).filter((r) => !Object.values(d.steps).some((s) => s.issuer === r && !s.optional))
    if (silent.length) err(`ceremony: ${f}: evidence countersigned, but a complete enactment need carry no step issued by ${silent.join(', ')}`)
  }
  const enc = parsed['interop/ceremonies/encounter-scan.ceremony.json']
  if (enc) {
    // Encounter Layer 5.2 C5 and 5.8 (RLTP-ENC-5750): the one-sided outcome is
    // a complete enactment; the counter-step may follow at any later time.
    const cases = [[['bundle'], true], [['bundle', 'counter'], true], [['counter'], false], [[], false]]
    for (const [names, want] of cases) {
      const got = complete(enc, names)
      if (got === want) ok(`ceremony: encounter-scan {${names.join(', ')}} is ${want ? 'a complete enactment' : 'not complete'}`)
      else err(`ceremony: encounter-scan {${names.join(', ')}} is ${got ? 'complete' : 'incomplete (a prefix)'}, expected ${want ? 'complete' : 'incomplete'}`)
    }
    const prefix = { ...enc, steps: { ...enc.steps, bundle: { ...enc.steps.bundle, terminal: false } } }
    if (complete(prefix, ['bundle'])) err('ceremony: encounter-scan with a non-terminal bundle is still complete on {bundle} — the completion check is not effective')
    else ok('ceremony: encounter-scan with a non-terminal bundle is a prefix on {bundle} (must-fail)')
  }
}

console.log(errors ? `\n${errors} error(s).` : '\nAll publication checks passed.')
process.exit(errors ? 1 : 0)
