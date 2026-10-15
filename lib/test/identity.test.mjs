#!/usr/bin/env node
// identity (lib Stage 2, PR 6; Identity 0.54 §2, §5.4, §5.5, §6.1, §6.2,
// §15.5): the device row of the closed registry and the device-key vector.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedKeys, labeledContext, canonicalLabel, deviceLabel, deviceName, createHolder, digestBytes, b64uOf } from '../dist/index.js'
import { InMemoryStore, stateBuilder, NEW_TUPLE, continuityTestModule } from '../dist/testing.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const vec = (f) => JSON.parse(readFileSync(join(ROOT, 'vectors', f), 'utf8'))
const hex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)))
const ID = vec('identity-derivation.json')
const DK = vec('identity-device-keys.json')
const IKM = hex(ID.rootIkm)

test('identity: the device-key vector reproduces — labels, seeds, keys through labeledContext and seedKeys (§5.5, §15.5)', async () => {
  const keys = seedKeys(IKM)
  for (const d of DK.devices) {
    assert.equal(await deviceLabel(d.deviceName, d.context), d.label)
    const ctx = await labeledContext(IKM, d.label)
    assert.equal(ctx.anchor, d.device, d.label)
    assert.equal(ctx.keyAgreement, d.keyAgreement, d.label)
    assert.deepEqual(await keys.anchorOf(d.label), { anchor: d.device, keyAgreement: d.keyAgreement })
  }
  // after state loss: the name from the recovered register re-derives the key
  const again = await seedKeys(IKM).anchorOf(await deviceLabel(DK.afterStateLoss.deviceName, DK.afterStateLoss.context))
  assert.equal(again.anchor, DK.afterStateLoss.device)
  // the NFC pair: one label, one key
  for (const n of DK.nfc.inputs) assert.equal(await deviceLabel(n, 'group/' + ID.genesisDigestSample), DK.nfc.label)
})

test('identity: the device row rejects before derivation — the vector\'s rejects and a device label as context (§6.1, §16)', async () => {
  for (const r of DK.rejects) {
    assert.equal(canonicalLabel(r.label), null, r.label)
    await assert.rejects(labeledContext(IKM, r.label), /closed registry/)
    await assert.rejects(seedKeys(IKM).anchorOf(r.label), /closed registry/)
  }
  for (const r of DK.contextRejects) await assert.rejects(deviceLabel('Laptop', r.context), /anchor context/)
  await assert.rejects(deviceLabel('Lap/top', 'persona/Anna'), /device name/)
  await assert.rejects(deviceLabel('', 'persona/Anna'), /device name/)
  // the identity vector's own device reject stays rejected
  assert.ok(ID.rejects.some((r) => r.label === 'device/x'))
  assert.equal(canonicalLabel('device/x'), null)
})

test('identity: deviceName applies the 6.2 pipeline — NFC, 64 code points, no slash, no Cc/Cf, no edge White_Space', () => {
  assert.equal(deviceName('Café'), 'Café')
  assert.equal(deviceName('L'.repeat(64)), 'L'.repeat(64))
  assert.equal(deviceName('L'.repeat(65)), null)
  for (const bad of ['', ' Laptop', 'Laptop ', 'a/b', 'a\u0000b', 'a​b']) assert.equal(deviceName(bad), null, JSON.stringify(bad))
  assert.equal(deviceName('My Laptop'), 'My Laptop', 'interior spaces are names')
})

// ── the register on the holder: device names and revocation marks ──────


const T0 = Date.parse('2026-10-15T09:00:00Z')
const GENESIS = ID.genesisDigestSample

async function holderOf ({ build = (b) => b, modules = [] } = {}) {
  const store = new InMemoryStore()
  await store.commit(null, build(stateBuilder({ at: T0 }).community(GENESIS, '1')).build())
  const holder = await createHolder({ store, keys: seedKeys(IKM) }, { modules, invariants: true })
  return { store, holder, read: async () => (await store.read()).state }
}

test('identity: addDevice records the name before any key derives from it; deviceKey derives only for a held name under an own context (§5.5)', async () => {
  const { holder, read } = await holderOf()
  const group = 'group/' + GENESIS
  assert.deepEqual(await holder.deviceKey('Laptop', group), { ok: false, code: 'unknown-device' }, 'no key before the name is in the register')
  const r = await holder.addDevice('Laptop', { when: T0, actId: 'd1' })
  assert.equal(r.ok, true)
  assert.deepEqual(r.events.map((e) => [e.type, e.name]), [['device.added', 'Laptop']])
  assert.deepEqual((await read()).register.devices, { names: ['Laptop'], revoked: [] })
  const k = await holder.deviceKey('Laptop', group)
  const v = DK.devices.find((d) => d.deviceName === 'Laptop' && d.context === group)
  assert.deepEqual(k, { ok: true, label: v.label, device: v.device, keyAgreement: v.keyAgreement })
  assert.deepEqual(await holder.deviceKey('Laptop', 'persona/Anna'), { ok: false, code: 'unknown-context' }, 'not an own context: the register holds no persona/Anna')
  assert.deepEqual(await holder.deviceKey('Laptop', v.label), { ok: false, code: 'unknown-context' }, 'a device label is no anchor context')
  assert.deepEqual(await holder.deviceKey('Laptop', `group/${GENESIS}/2`), { ok: false, code: 'unknown-context' }, 'a generation above the head is not held')
  // the name is stored canonical (6.2): the decomposed spelling is the same name
  assert.equal((await holder.addDevice('Café', { when: T0, actId: 'd2' })).ok, true)
  assert.deepEqual((await holder.addDevice('Café', { when: T0, actId: 'd3' })), { ok: false, code: 'device-name-held', ref: 'Identity §5.5' })
  assert.deepEqual((await read()).register.devices.names, ['Laptop', 'Café'])
  assert.deepEqual(await holder.addDevice(' bad', { when: T0, actId: 'd4' }), { ok: false, code: 'device-name-invalid', ref: 'Identity §6.2' })
  // the same actId replays the journaled result, nothing commits (note §4.2)
  const seq = (await read()).commitSeq
  const again = await holder.addDevice('Laptop', { when: T0, actId: 'd1' })
  assert.equal(again.ok, true)
  assert.equal((await read()).commitSeq, seq)
})

test('identity: revokeDevice marks the name for good — no key for it, never given again, the mark never removed (§5.5)', async () => {
  const { holder, read } = await holderOf()
  const group = 'group/' + GENESIS
  await holder.addDevice('Phone', { when: T0, actId: 'a' })
  assert.deepEqual(await holder.revokeDevice('Tablet', { when: T0, actId: 'b' }), { ok: false, code: 'unknown-device', ref: 'Identity §5.5' })
  const r = await holder.revokeDevice('Phone', { when: T0 + 1, actId: 'c' })
  assert.deepEqual(r.events.map((e) => [e.type, e.name]), [['device.revoked', 'Phone']])
  assert.deepEqual((await read()).register.devices, { names: ['Phone'], revoked: ['Phone'] })
  assert.deepEqual(await holder.deviceKey('Phone', group), { ok: false, code: 'device-revoked' })
  assert.deepEqual(await holder.addDevice('Phone', { when: T0 + 2, actId: 'd' }), { ok: false, code: 'device-name-revoked', ref: 'Identity §5.5' })
  const again = await holder.revokeDevice('Phone', { when: T0 + 3, actId: 'e' })
  assert.deepEqual(again, { ok: true, outbound: [], events: [] }, 'revoking again changes nothing')
  assert.deepEqual((await read()).register.devices, { names: ['Phone'], revoked: ['Phone'] })
})

test('identity: the register invariants — a mark needs its name, a revoked name never returns, the lineage is chained (invariants.ts)', async () => {
  const { stateViolations, transitionViolations } = await import('../dist/testing.js')
  const s = stateBuilder({ at: T0 }).community(GENESIS, '1').with((x) => { x.register.devices = { names: ['A'], revoked: ['A', 'B'] } }).build()
  assert.ok(stateViolations(s).some((v) => v.invariant === 'register' && /revocation mark B/.test(v.detail)))
  const before = stateBuilder({ at: T0 }).with((x) => { x.register.devices = { names: [], revoked: [] } }).build()
  const reuse = structuredClone(before); reuse.commitSeq = '1'
  before.register.devices = { names: ['A'], revoked: ['A'] }
  reuse.register.devices = { names: ['A'], revoked: ['A'] }
  assert.deepEqual(transitionViolations(before, reuse, { kind: 'act', command: 'x' }), [])
  const dropped = structuredClone(before); dropped.commitSeq = '1'; dropped.register.devices = { names: ['A'], revoked: [] }
  assert.ok(transitionViolations(before, dropped, { kind: 'act', command: 'x' }).some((v) => /device revocations lost/.test(v.detail)))
})

test('identity: continuity.newTuple with its relationship nonce records it beside the pair label (§6.1); a label that is not the nonce\'s digest is refused', async () => {
  const { holder, read } = await holderOf({ modules: [continuityTestModule] })
  const nonce = new Uint8Array(32).fill(0x5a)
  const label = 'pair/' + await digestBytes(nonce)
  const r = await holder.act(NEW_TUPLE, { relId: 'r1', contactId: 'c1', ownPairLabel: label, counterpartAnchor: 'did:key:z6MkfOther', counterpartKeyAgreement: 'z6LSother', nonce: b64uOf(nonce) }, T0)
  assert.equal(r.ok, true)
  const st = await read()
  assert.equal(st.register.pairNonces[label], b64uOf(nonce))
  assert.ok(st.register.labels.includes(label))
  const other = 'pair/' + await digestBytes(new Uint8Array(32).fill(0x5b))
  await assert.rejects(holder.act(NEW_TUPLE, { relId: 'r2', contactId: 'c2', ownPairLabel: other, counterpartAnchor: 'did:key:z6MkfX', counterpartKeyAgreement: 'z6LSx', nonce: b64uOf(nonce) }, T0), /multihash\(nonce\)/)
})
