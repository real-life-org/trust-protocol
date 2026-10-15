#!/usr/bin/env node
// identity (lib Stage 2, PR 6; Identity 0.54 §2, §5.4, §5.5, §6.1, §6.2,
// §15.5): the device row of the closed registry and the device-key vector.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedKeys, labeledContext, canonicalLabel, deviceLabel, deviceName } from '../dist/index.js'

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
