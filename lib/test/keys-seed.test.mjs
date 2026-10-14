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
