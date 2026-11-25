#!/usr/bin/env node
// seedKeys — the library's default KeyProvider (lib Stage 2, PR 1; design
// note §3 KeyProvider): every key derives from the root seed under the
// same HKDF labels as identity.ts and carrier-identity.ts, so the shipped
// vectors stay valid; agree() asks the engine's release on every call.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scriptedEntropy } from '../dist/testing.js'
import { seedKeys, labeledContext, pairContext, communityLabel, carrierPrincipal, xFromSeed, ecdh, xRawOfMk, edRawOfAnchor, b64uOf } from '../dist/index.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const vec = (f) => JSON.parse(readFileSync(join(ROOT, 'vectors', f), 'utf8'))
const hex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)))
const ID = vec('identity-derivation.json')
const IKM = hex(ID.rootIkm)
const S = globalThis.crypto.subtle
const NONCE = Uint8Array.from({ length: 32 }, (_, i) => i + 1)

const live = (rkid, label) => (r) => (r === rkid ? { status: 'live', label } : { status: 'unknown' })

test('seedKeys: anchorOf reproduces the identity-derivation vector for every registry label it carries', async () => {
  const keys = seedKeys(IKM)
  let checked = 0
  for (const v of ID.vectors) {
    if (!/^(group|pair|persona)\//.test(v.label)) continue
    const got = await keys.anchorOf(v.label)
    assert.equal(got.anchor, v.anchor, v.label)
    assert.equal(got.keyAgreement, v.keyAgreement, v.label)
    checked++
  }
  assert.ok(checked >= 1, 'the vector carries at least one registry label')
})

test('seedKeys: anchorOf equals labeledContext for pair, community and persona labels', async () => {
  const keys = seedKeys(IKM)
  const pair = await pairContext(IKM, NONCE)
  for (const label of [pair.label, communityLabel(ID.genesisDigestSample, 1), communityLabel(ID.genesisDigestSample, 3), 'persona/Anton']) {
    const ctx = await labeledContext(IKM, label)
    assert.deepEqual(await keys.anchorOf(label), { anchor: ctx.anchor, keyAgreement: ctx.keyAgreement }, label)
  }
  await assert.rejects(keys.anchorOf('self'), /closed registry/, 'non-labels are refused before any derivation')
})

test('seedKeys: sign is Ed25519 under the label anchor', async () => {
  const keys = seedKeys(IKM)
  const label = (await pairContext(IKM, NONCE)).label
  const msg = new TextEncoder().encode('rltp')
  const sig = await keys.sign(label, msg)
  assert.equal(sig.length, 64)
  const { anchor } = await keys.anchorOf(label)
  const pub = await S.importKey('raw', edRawOfAnchor(anchor), { name: 'Ed25519' }, false, ['verify'])
  assert.ok(await S.verify({ name: 'Ed25519' }, pub, sig, msg))
})

test('seedKeys: a Node Buffer seed wiped after construction does not change the keys', async () => {
  const seed = Buffer.from(IKM)
  const keys = seedKeys(seed)
  seed.fill(0)
  assert.equal((await keys.anchorOf('persona/Anton')).anchor, (await labeledContext(IKM, 'persona/Anton')).anchor)
  const nonce = Buffer.from(NONCE)
  const p = keys.carrierPrincipal(nonce, 'did:web:carrier.example')
  nonce.fill(0)
  assert.equal((await p).principal, (await carrierPrincipal(IKM, 'did:web:carrier.example', NONCE)).principal)
})

test('seedKeys: the seed is copied at entry', async () => {
  const seed = IKM.slice()
  const keys = seedKeys(seed)
  seed.fill(0)
  assert.equal((await keys.anchorOf('persona/Anton')).anchor, (await labeledContext(IKM, 'persona/Anton')).anchor)
})

test('seedKeys: agree yields the X25519 secret for a live rkid', async () => {
  const keys = seedKeys(IKM)
  const ctx = await pairContext(IKM, NONCE)
  const eph = await xFromSeed(new Uint8Array(32).fill(7))
  const want = await ecdh(eph.priv, xRawOfMk(ctx.keyAgreement))
  const r = await keys.agree(ctx.keyAgreement, eph.pubRaw, live(ctx.keyAgreement, ctx.label))
  assert.equal(r.status, 'available')
  assert.equal(b64uOf(r.shared), b64uOf(want))
})

test('seedKeys: agree honours the release on every call — a cached key is never revived', async () => {
  const keys = seedKeys(IKM)
  const ctx = await pairContext(IKM, NONCE)
  const eph = await xFromSeed(new Uint8Array(32).fill(9))
  assert.equal((await keys.agree(ctx.keyAgreement, eph.pubRaw, live(ctx.keyAgreement, ctx.label))).status, 'available')
  let asked = 0
  const retired = (r) => { asked++; return { status: 'retired' } }
  assert.deepEqual(await keys.agree(ctx.keyAgreement, eph.pubRaw, retired), { status: 'retired' })
  assert.equal(asked, 1, 'the release is consulted although the key is cached')
  assert.deepEqual(await keys.agree(ctx.keyAgreement, eph.pubRaw, () => ({ status: 'unknown' })), { status: 'unknown' })
})

test('seedKeys: a release naming a label that does not derive the rkid is unknown', async () => {
  const keys = seedKeys(IKM)
  const ctx = await pairContext(IKM, NONCE)
  const eph = await xFromSeed(new Uint8Array(32).fill(5))
  const r = await keys.agree(ctx.keyAgreement, eph.pubRaw, () => ({ status: 'live', label: 'persona/Anton' }))
  assert.deepEqual(r, { status: 'unknown' })
})

test('seedKeys: agree refuses a low-order epk (all-zero secret) and a malformed one', async () => {
  const keys = seedKeys(IKM)
  const ctx = await pairContext(IKM, NONCE)
  const rel = live(ctx.keyAgreement, ctx.label)
  assert.deepEqual(await keys.agree(ctx.keyAgreement, new Uint8Array(32), rel), { status: 'invalid' })
  assert.deepEqual(await keys.agree(ctx.keyAgreement, new Uint8Array(31).fill(1), rel), { status: 'invalid' })
})

test('seedKeys: carrierPrincipal equals carrier-identity and signs under it', async () => {
  const keys = seedKeys(IKM)
  const C = 'did:web:carrier.example'
  const ref = await carrierPrincipal(IKM, C, NONCE)
  const k = await keys.carrierPrincipal(NONCE, C)
  assert.equal(k.principal, ref.principal)
  const msg = new TextEncoder().encode('proof')
  const sig = await k.sign(msg)
  const pub = await S.importKey('raw', edRawOfAnchor(k.principal), { name: 'Ed25519' }, false, ['verify'])
  assert.ok(await S.verify({ name: 'Ed25519' }, pub, sig, msg))
  await assert.rejects(keys.carrierPrincipal(NONCE, 'bad id'), /carrier identifier/)
})

test('seedKeys: an injected crypto handle is used, not the global one', async () => {
  let calls = 0
  const subtle = new Proxy(S, { get: (t, p) => { const v = t[p]; return typeof v === 'function' ? (...a) => { calls++; return v.apply(t, a) } : v } })
  const keys = seedKeys(IKM, { subtle })
  await keys.anchorOf('persona/Anton')
  assert.ok(calls > 0)
})

test('seedKeys: carrierPrincipal reproduces the carrierRelationship vector', async () => {
  const keys = seedKeys(IKM)
  const cr = ID.carrierRelationship
  const n = hex(cr.relationshipNonce)
  for (const c of cr.cases) {
    if (typeof c.principal !== 'string' || typeof c.carrier !== 'string') continue
    assert.equal((await keys.carrierPrincipal(n, c.carrier)).principal, c.principal, c.case)
  }
})

test('seedKeys: a WebCrypto failure behind a live rkid throws — it is never reported as unknown or invalid', async () => {
  const ctx = await pairContext(IKM, NONCE)
  const eph = await xFromSeed(new Uint8Array(32).fill(7))
  const broken = (what) => ({
    subtle: new Proxy(S, {
      get: (t, p) => p === what ? () => Promise.reject(new Error('hardware fault')) : (typeof t[p] === 'function' ? t[p].bind(t) : t[p]),
    }),
  })
  await assert.rejects(seedKeys(IKM, broken('importKey')).agree(ctx.keyAgreement, eph.pubRaw, live(ctx.keyAgreement, ctx.label)), /hardware fault/)
  const keys = seedKeys(IKM, broken('deriveBits'))
  await assert.rejects(keys.agree(ctx.keyAgreement, eph.pubRaw, live(ctx.keyAgreement, ctx.label)), /hardware fault/)
})

test('entropy: scriptedEntropy copies Buffer values on the way in', () => {
  const b = Buffer.from([1, 2, 3, 4])
  const e = scriptedEntropy({ pad: b })
  b.fill(0)
  assert.deepEqual([...e.bytes('pad', 4)], [1, 2, 3, 4])
})

// EXPERIMENTAL, DEVIATION D6 (#211): the identity toward a web app the person logs into.
test('loginIdentity: one did:key per origin, stable, unlinkable across origins and persons, signing raw bytes', async () => {
  const k = seedKeys(IKM)
  const a = await k.loginIdentity('https://beispiel.org')
  const again = await seedKeys(IKM).loginIdentity('https://beispiel.org')     // a second device with the same root
  const other = await k.loginIdentity('https://andere.example')
  const person2 = await seedKeys(new Uint8Array(64).fill(9)).loginIdentity('https://beispiel.org')
  assert.match(a.did, /^did:key:z6Mk/)
  assert.equal(a.did, again.did)
  assert.notEqual(a.did, other.did)
  assert.notEqual(a.did, person2.did)
  // never one of the register anchors of the same root
  assert.notEqual(a.did, (await k.anchorOf('persona/Anton')).anchor)
  const msg = new TextEncoder().encode('header.payload')
  const sig = await a.sign(msg)
  assert.equal(sig.length, 64)
  const pub = await S.importKey('raw', edRawOfAnchor(a.did), { name: 'Ed25519' }, false, ['verify'])
  assert.equal(await S.verify('Ed25519', pub, sig, msg), true)
  assert.equal(await S.verify('Ed25519', pub, sig, new TextEncoder().encode('header.payloaD')), false)
})

test('loginIdentity: only an exact origin over https or http; anything else is refused', async () => {
  const k = seedKeys(IKM)
  for (const bad of ['https://beispiel.org/', 'https://beispiel.org/pfad', 'HTTPS://beispiel.org', 'beispiel.org', 'ftp://beispiel.org', 'javascript:alert(1)', '', 42, null]) {
    await assert.rejects(k.loginIdentity(bad), TypeError, String(bad))
  }
  assert.match((await k.loginIdentity('http://127.0.0.1:8790')).did, /^did:key:/)
})

test('loginIdentity: the derivation is the documented one (prefix, multihash of the origin)', async () => {
  const { LOGIN_EXPERIMENTAL_PREFIX } = await import('../dist/index.js')
  assert.equal(LOGIN_EXPERIMENTAL_PREFIX, 'rltp/v1/x-login-experimental/')
  const origin = 'https://beispiel.org'
  const digest = new Uint8Array(await S.digest('SHA-256', new TextEncoder().encode(origin)))
  const mh = 'u' + b64uOf(Uint8Array.from([0x12, 0x20, ...digest]))
  const base = await S.importKey('raw', IKM, 'HKDF', false, ['deriveBits'])
  const seed = new Uint8Array(await S.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode(LOGIN_EXPERIMENTAL_PREFIX + mh) }, base, 256))
  const pkcs8 = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20, ...seed])
  const priv = await S.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, true, ['sign'])
  const x = (await S.exportKey('jwk', priv)).x
  const { did } = await seedKeys(IKM).loginIdentity(origin)
  assert.deepEqual([...edRawOfAnchor(did)], [...Buffer.from(x, 'base64url')])
})
