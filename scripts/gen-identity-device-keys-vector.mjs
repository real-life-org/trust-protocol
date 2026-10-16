#!/usr/bin/env node
// Generates vectors/identity-device-keys.json — the device-key vector of
// Identity 0.54 §15.5 (§5.5, §6.1, §6.2): a device label over the sample
// group of vectors/identity-derivation.json, its info strings, seeds and
// keys; the same name and context derived again after state loss (the
// register's name alone re-derives the device's keys); two contexts of one
// device giving two unrelated device keys (the context rule); a second
// device name; the NFC pair of one name; and the rejections of the
// device row of the closed registry. Derived by the library (lib/dist:
// deviceLabel, labeledContext), every value checked here once more with
// node:crypto, so library and vector cannot drift apart; conformance/
// runner.mjs re-derives the file from its documented inputs.
//
//   usage: node scripts/gen-identity-device-keys-vector.mjs [--check]
//          (from repo root; requires lib/dist — build the library first)
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')
const { deviceLabel, labeledContext, canonicalLabel } = await import(join(ROOT, 'lib/dist/identity.js'))
const J = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))
const assert = (c, m) => { if (!c) { console.error(`gen-identity-device-keys-vector: ${m}`); process.exit(1) } }

// ── node:crypto, independent of the library ─────────────────────────────
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const b58 = (b) => { let n = BigInt('0x' + Buffer.from(b).toString('hex')), s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n } for (const x of b) { if (x === 0) s = '1' + s; else break } return s }
const hkdf = (ikm, info) => Buffer.from(crypto.hkdfSync('sha256', ikm, Buffer.alloc(0), Buffer.from(info, 'utf8'), 32))
const mh = (bytes) => 'u' + Buffer.concat([Buffer.from([0x12, 0x20]), crypto.createHash('sha256').update(bytes).digest()]).toString('base64url')
const pub = (seed, prefix) => {
  const key = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from(prefix, 'hex'), seed]), format: 'der', type: 'pkcs8' })
  const spki = crypto.createPublicKey(key).export({ format: 'der', type: 'spki' })
  return spki.subarray(spki.length - 32)
}
const didOf = (ed) => 'did:key:z' + b58(Buffer.concat([Buffer.from([0xed, 0x01]), pub(ed, '302e020100300506032b657004220420')]))
const mkOf = (x) => 'z' + b58(Buffer.concat([Buffer.from([0xec, 0x01]), pub(x, '302e020100300506032b656e04220420')]))

const ID = J('vectors/identity-derivation.json')
const seed = Uint8Array.from(Buffer.from(ID.rootIkm, 'hex'))
const GROUP = 'group/' + ID.genesisDigestSample

/** One device key: the label from the library, every value checked with node:crypto. */
async function derive (name, context) {
  const label = await deviceLabel(name, context)
  const c = mh(Buffer.from(canonicalLabel(context), 'utf8'))
  const n = name.normalize('NFC')
  assert(label === `device/${n}/${c}`, `${name} under ${context}: label is not device/<n>/<c>`)
  const edInfo = 'rltp/anchor/ed/' + label, xInfo = 'rltp/anchor/x/' + label
  const ed = hkdf(seed, edInfo), x = hkdf(seed, xInfo)
  const lib = await labeledContext(seed, label)
  const device = didOf(ed), keyAgreement = mkOf(x)
  assert(lib.anchor === device && lib.keyAgreement === keyAgreement, `${label}: the library derives other keys than node:crypto`)
  return { deviceName: name, context, contextDigest: c, label, edInfo, xInfo, edSeed: ed.toString('hex'), xSeed: x.toString('hex'), device, keyAgreement }
}

const laptopGroup = await derive('Laptop', GROUP)
const laptopPersona = await derive('Laptop', 'persona/Anna')
const phoneGroup = await derive('Phone', GROUP)
const composed = await derive('Café', GROUP)
const decomposed = await derive('Café', GROUP)
// after state loss: the holder tells the device its name (§3.3), the
// register (recovered) holds it, and the keys re-derive from the seed alone
const restored = await derive('Laptop', GROUP)
assert(JSON.stringify(restored) === JSON.stringify(laptopGroup), 'the derivation after state loss differs')
assert(laptopGroup.device !== laptopPersona.device && laptopGroup.keyAgreement !== laptopPersona.keyAgreement, 'two contexts gave one device key')
assert(laptopGroup.device !== phoneGroup.device, 'two names gave one device key')
assert(composed.label === decomposed.label && composed.device === decomposed.device, 'the NFC pair derives two keys')
const anchors = new Set(ID.vectors.map((v) => v.anchor))
for (const k of [laptopGroup, laptopPersona, phoneGroup, composed]) assert(!anchors.has(k.device), `${k.label}: a device key equals an anchor of the identity vector`)

// the device row of the closed registry (§6.1): rejected before derivation
const C = laptopGroup.contextDigest
const rejects = [
  { label: 'device/x', reason: 'no context component (5.5, the Identity §16 reject)' },
  { label: 'device/Laptop', reason: 'no context component' },
  { label: `device//${C}`, reason: 'empty device name (6.2: 1 to 64 code points)' },
  { label: `device/Lap/top/${C}`, reason: 'a slash in the device name (6.2): the label has more than its two components' },
  { label: `device/ Laptop/${C}`, reason: 'leading White_Space in the device name (6.2)' },
  { label: `device/Laptop/${C.slice(0, -1)}R`, reason: 'non-canonical context digest (trailing bits not zero)' },
  { label: `device/Laptop/${C}/2`, reason: 'a third component' },
  { label: `device/Lap\u0000top/${C}`, reason: 'a Cc code point in the device name (6.2)' },
]
for (const r of rejects) assert(canonicalLabel(r.label) === null, `${JSON.stringify(r.label)} is not rejected by the library`)
const contextRejects = [
  { context: laptopGroup.label, reason: 'a device label is no anchor context (5.5, 6.1: never of a device/… label)' },
  { context: 'self', reason: 'not a label (5.3)' },
]
for (const r of contextRejects) {
  let threw = false
  try { await deviceLabel('Laptop', r.context) } catch { threw = true }
  assert(threw, `deviceLabel accepts the context ${r.context}`)
}

const vector = {
  description: 'Device keys (Identity 0.54 §5.5, §15.5): for a device name n (6.2) and an anchor context with canonical label A (a group/…, persona/… or pair/… label of 6.1), the device label is device/<n>/<c>, c = "u" || base64url(0x12 0x20 || SHA-256(UTF-8 of A)) (47 characters); edSeed = HKDF-SHA-256(root IKM, salt empty, info "rltp/anchor/ed/" || label, 32 bytes), xSeed likewise under "rltp/anchor/x/" || label; the device key is the Ed25519 did:key of edSeed, its key agreement key the X25519 multikey of xSeed (5.1, 5.2). Regenerate: node scripts/gen-identity-device-keys-vector.mjs (deterministic, from lib/dist); re-derived by conformance/runner.mjs.',
  inputs: {
    source: 'root IKM = rootIkm of vectors/identity-derivation.json (the BIP-39 test mnemonic); the sample group is group/<genesisDigestSample> of that file',
    rootIkm: ID.rootIkm,
    genesisDigestSample: ID.genesisDigestSample,
  },
  devices: [laptopGroup, laptopPersona, phoneGroup],
  afterStateLoss: {
    note: 'the device lost its local state, recovered the synchronized state (9.3) and was told its name (3.3): the same name under the same context re-derives the same label, seeds and keys — it is the same device, its device cards stay valid (5.5)',
    deviceName: 'Laptop', context: GROUP, expect: laptopGroup.label, device: restored.device, keyAgreement: restored.keyAgreement,
  },
  contextRule: {
    note: 'one device, two anchor contexts: the context is part of the label, so the two device keys are unrelated — a device key shared across contexts would link the anchors it appears under (5.5, Section 14)',
    labels: [laptopGroup.label, laptopPersona.label],
    devices: [laptopGroup.device, laptopPersona.device],
  },
  nfc: {
    note: 'the device name follows 6.2: NFC is applied, so the composed and the decomposed spelling of one name give one label and one key',
    inputs: [composed.deviceName, decomposed.deviceName],
    label: composed.label,
    device: composed.device,
    keyAgreement: composed.keyAgreement,
  },
  rejects,
  contextRejects,
}

const text = JSON.stringify(vector, null, 1) + '\n'
const path = join(ROOT, 'vectors/identity-device-keys.json')
if (CHECK) {
  let held = null
  try { held = readFileSync(path, 'utf8') } catch { /* missing */ }
  if (held !== text) { console.error('vectors/identity-device-keys.json is not what the generator produces'); process.exit(1) }
  console.log('vectors/identity-device-keys.json reproduces byte for byte')
} else {
  writeFileSync(path, text)
  console.log('vectors/identity-device-keys.json written; device =', laptopGroup.device)
}
