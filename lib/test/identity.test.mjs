#!/usr/bin/env node
// identity (lib Stage 2, PR 6; Identity 0.54 §2, §5.4, §5.5, §6.1, §6.2,
// §15.5): the device row of the closed registry and the device-key vector.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedKeys, labeledContext, canonicalLabel, deviceLabel, deviceName, createHolder, digestBytes, b64uOf } from '../dist/index.js'
import { InMemoryStore, stateBuilder, NEW_TUPLE, continuityTestModule, memoryLog } from '../dist/testing.js'
import { bindingOf, verifyAnchorRotation, makeAnchorRotation } from '../dist/anchor.js'
import { communityContext } from '../dist/index.js'
import { trustPair, read as readStore, deliver, MAPPING, side, withCommunity } from './pair-fixture.mjs'

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
  const before = stateBuilder({ at: T0 }).with((x) => { x.register.devices = { names: ['A'], revoked: ['A'] } }).build()
  const reuse = structuredClone(before); reuse.commitSeq = '1'
  const added = (name) => ({ kind: 'act', command: 'identity.addDevice', events: [{ type: 'device.added', name, eventId: '1.0', commitSeq: '1' }] })
  assert.ok(transitionViolations(before, reuse, added('A')).some((v) => /device name A given again after its revocation/.test(v.detail)), 'a device.added naming a revoked name breaks it')
  assert.deepEqual(transitionViolations(before, reuse, added('B')).filter((v) => v.invariant === 'register'), [])
  const twice = structuredClone(before); twice.register.devices.names = ['A', 'A']
  assert.ok(stateViolations(twice).some((v) => /are sets/.test(v.detail)), 'names are a set')
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


// ── the rotation (Identity §5.4, Trust 6360–6420, 6596, Access §5.6) ───

const ofType = (out, type) => out.filter((o) => o.type === type)

/** A and B trusting each other, mappings exchanged; A's holder over a log. */
async function rotationPair ({ logA, wrapStore, build } = {}) {
  const p = await trustPair({ invariants: true, ...(build ? { a: build } : {}) })
  const L = memoryLog(p.A.genesis)
  const log = logA ? logA(L) : L
  const store = wrapStore ? wrapStore(p.storeA) : p.storeA
  const holderA = await createHolder({ store, keys: p.A.keys, log }, { invariants: true })
  let n = 0
  const opts = (when) => ({ when, actId: `act-${++n}` })
  await holderA.trust('c1', opts(T0)); await p.holderB.trust('c1', opts(T0))
  const ra = await holderA.resume(T0 + 1); const rb = await p.holderB.resume(T0 + 1)
  await deliver(p.holderB, ofType(ra.outbound, MAPPING), T0 + 2)
  await deliver(holderA, ofType(rb.outbound, MAPPING), T0 + 2)
  return { ...p, holderA, L, log, opts, remake: () => createHolder({ store: p.storeA, keys: p.A.keys, log }, { invariants: true }) }
}

test('rotation: step 1 persists the label, the signed rotation and the closure; the head stays until the log holds it (§5.4, 6360)', async () => {
  const { A, holderA, storeA, L, opts } = await rotationPair()
  const r = await holderA.rotateAnchor(opts(T0 + 10))
  assert.equal(r.ok, true)
  assert.deepEqual(r.outbound, [])
  assert.deepEqual(r.events, [], 'nothing is announced before the rotation completes')
  assert.equal(r.nextDueAt, T0 + 10, 'the rotation duty: the cue to resume')
  const s = await readStore(storeA)
  const label2 = `group/${A.genesis}/2`
  assert.ok(s.register.labels.includes(label2), 'the label of generation 2 is persisted (5.4, 6360)')
  assert.equal(s.register.community.head, '1', 'the head stays at 1 until the log holds the entry')
  const rot = s.rotations['2']
  assert.deepEqual([rot.from, rot.to, rot.step], ['1', '2', 'log'])
  assert.deepEqual(rot.overHead, { genesis: A.genesis, empty: true })
  assert.deepEqual(rot.awaitHead, { r1: null }, 'the anchor mapping class is on for r1, which does not lag (6596)')
  const art = rot.entry.rotation
  assert.deepEqual(Object.keys(rot.entry), ['rotation'], 'the anchor.rotate body is exactly rotation (RLTP-ACC-5955)')
  assert.equal(art.body.prev, (await A.gen(1)).anchor)
  assert.equal(art.body.next, (await A.gen(2)).anchor)
  assert.equal(art.body.commit, await bindingOf((await A.gen(3)).anchor), 'commit binds generation 3 (6335)')
  assert.equal(await verifyAnchorRotation(art, await bindingOf((await A.gen(2)).anchor)), true, 'signed by prev and next, next meets the binding of prev')
  assert.deepEqual(Object.keys(s.duties), ['rotation:2'])
  assert.deepEqual(L.entries(), [], 'nothing in the log yet')
  // nothing is issued under generation 2 before the log holds it: no re-issue duty yet
  assert.equal(Object.values(s.duties).some((d) => d.kind === 'reissue-mapping'), false)
})

test('rotation: happy path end to end — the log append completes it, the re-issue carries the lineage, B verifies and advances the head (5.4, 6370, 6420, 6160)', async () => {
  const { A, holderA, holderB, storeA, storeB, L, opts } = await rotationPair()
  const headBefore = (await readStore(storeB)).relationships.r1.heldCounterpartHead
  assert.equal(headBefore, A.self)
  await holderA.rotateAnchor(opts(T0 + 10))
  const done = await holderA.resume(T0 + 11)
  assert.deepEqual(done.events.map((e) => [e.type, e.generation]), [['anchor.rotated', '2']])
  assert.equal(done.nextDueAt, T0 + 11, 'the re-issue duties are due at once')
  let s = await readStore(storeA)
  assert.equal(s.register.community.head, '2')
  assert.equal(s.register.lineage.length, 1)
  assert.deepEqual(s.rotations, {})
  assert.deepEqual(Object.keys(s.duties), ['reissue:2:r1'])
  assert.deepEqual(s.duties['reissue:2:r1'], { kind: 'reissue-mapping', v: 1, id: 'reissue:2:r1', contactId: 'c1', relId: 'r1', awaitHead: null })
  assert.equal(L.entries().length, 1)
  assert.deepEqual(L.entries()[0], { rotation: s.register.lineage[0] })
  const h = await L.head()
  assert.equal(h.gen, 2)
  assert.equal(h.next, (await A.gen(2)).anchor)
  // the re-issue: anchor-mapping@4 under generation 2, lineage from the earliest anchor (6420)
  const re = await holderA.resume(T0 + 12)
  const m = ofType(re.outbound, MAPPING)
  assert.equal(m.length, 1)
  s = await readStore(storeA)
  const body = s.relationships.r1.tuples[0].mappingOut.body
  assert.equal(body.self, (await A.gen(2)).anchor)
  assert.equal(body.revision, '2')
  assert.deepEqual(body.lineage, s.register.lineage, 'the lineage from generation 1, held on r1 (2285, 6420)')
  assert.deepEqual(s.duties, {})
  // B verifies the lineage and follows the rotation (6160)
  const [rb] = await deliver(holderB, m, T0 + 13)
  assert.equal(rb.disposition, 'unique')
  const sB = await readStore(storeB)
  assert.equal(sB.relationships.r1.heldCounterpartHead, (await A.gen(2)).anchor)
  assert.deepEqual(sB.relationships.r1.links, [{ prev: A.self, next: (await A.gen(2)).anchor }])
  assert.equal(sB.contacts.c1.anchorHead, (await A.gen(2)).anchor)
  // a second rotation chains: 2 → 3 over the head the log now shows
  await holderA.rotateAnchor(opts(T0 + 20))
  const d2 = await holderA.resume(T0 + 21)
  assert.deepEqual(d2.events.map((e) => e.generation), ['3'])
  assert.equal(L.entries().length, 2)
  assert.equal((await L.head()).gen, 3)
})

test('rotation: a relationship that lags at the rotation — its re-issue waits for H, the entry\'s head, and goes once it presents H (6596)', async () => {
  // B's own sides: two pair contexts of one person toward A, one entry c1
  const B1 = await side(0x09, 0x05), B2 = await side(0x09, 0x06)
  const A0 = await withCommunity(await side(0x07, 0x03), await digestBytes(new Uint8Array(32).fill(0x31)))
  const A2side = await side(0x07, 0x04)
  const store = new InMemoryStore()
  const H = 'did:key:z6MkNewHeadOfB', OLD = 'did:key:z6MkOldHeadOfB'
  await store.commit(null, stateBuilder({ at: T0 }).community(A0.genesis, '1')
    .relationship('r1', { contactId: 'c1', tuples: [{ ownPairLabel: A0.label, counterpartAnchor: B1.anchor, counterpartKeyAgreement: B1.keyAgreement, rkid: A0.keyAgreement }], heldCounterpartHead: H, links: [{ prev: OLD, next: H }] })
    .relationship('r2', { contactId: 'c1', tuples: [{ ownPairLabel: A2side.label, counterpartAnchor: B2.anchor, counterpartKeyAgreement: B2.keyAgreement, rkid: A2side.keyAgreement }], heldCounterpartHead: OLD })
    .entry('c1').contact('c1', { anchorHead: H }).settings('c1', { anchorMapping: 'on', star: 'off', groupStar: 'off' })
    .duty({ kind: 'class-on', v: 1, id: 'class-on:anchorMapping:r1', contactId: 'c1', relId: 'r1', cls: 'anchorMapping' })
    .duty({ kind: 'class-on', v: 1, id: 'class-on:anchorMapping:r2', contactId: 'c1', relId: 'r2', cls: 'anchorMapping' })
    .build())
  const L = memoryLog(A0.genesis)
  const holder = await createHolder({ store, keys: A0.keys, log: L }, { invariants: true })
  await holder.resume(T0)   // the class-on duties of the setup: r1 issues under generation 1, r2 lags (6595)
  const s0 = await readStore(store)
  assert.equal(Object.keys(s0.duties).length, 0, JSON.stringify(s0.duties))
  assert.equal(s0.relationships.r1.tuples[0].mappingOut.rev, '1')
  await holder.rotateAnchor({ when: T0 + 10, actId: 'rot' })
  assert.deepEqual((await readStore(store)).rotations['2'].awaitHead, { r1: null, r2: H }, 'r2 lags at the rotation: it waits for H (6596)')
  await holder.resume(T0 + 11)
  const s1 = await readStore(store)
  assert.equal(s1.duties['reissue:2:r2'].awaitHead, H)
  assert.equal(s1.duties['reissue:2:r1'].awaitHead, null)
  const r = await holder.resume(T0 + 12)
  assert.deepEqual(ofType(r.outbound, MAPPING).map((o) => o.recipient.keyAgreement), [B1.keyAgreement], 'only r1, which did not lag, re-issues now')
  assert.deepEqual(Object.keys((await readStore(store)).duties), ['reissue:2:r2'])
  // r2 comes to present H (its counterpart's mapping there follows the rotation): released
  const { state, version } = await store.read()
  state.relationships.r2.heldCounterpartHead = H
  state.relationships.r2.links = [{ prev: OLD, next: H }]
  await store.commit(version, state)
  const r2 = await holder.resume(T0 + 13)
  assert.deepEqual(ofType(r2.outbound, MAPPING).map((o) => o.recipient.keyAgreement), [B2.keyAgreement])
  const s2 = await readStore(store)
  assert.deepEqual(s2.duties, {})
  assert.equal(s2.relationships.r2.tuples[0].mappingOut.body.self, (await A0.gen(2)).anchor)
})

test('rotation: the log behind — step 1 refuses log-behind before anything commits; after the log catches up the device rotates (§5.4, RLTP-ACC-5980; review PR 6 K1)', async () => {
  const { A, holderA, storeA, L, opts } = await rotationPair()
  await holderA.rotateAnchor(opts(T0 + 10)); await holderA.resume(T0 + 11)
  // another device's replica: the register holds generation 2, its log nothing yet
  const L2 = memoryLog(A.genesis)
  const dev2 = await createHolder({ store: storeA, keys: A.keys, log: L2 }, { invariants: true })
  const before = await readStore(storeA)
  assert.deepEqual(await dev2.rotateAnchor(opts(T0 + 20)), { ok: false, code: 'log-behind', ref: 'RLTP-ACC-5980' })
  const s0 = await readStore(storeA)
  assert.equal(s0.commitSeq, before.commitSeq, 'nothing committed')
  assert.equal(s0.register.labels.includes(`group/${A.genesis}/3`), false, 'no label of generation 3 (5.4: the device synchronizes first)')
  assert.deepEqual(s0.rotations, {})
  assert.deepEqual(L2.entries(), [])
  await L2.syncFrom(L)
  assert.equal((await dev2.rotateAnchor(opts(T0 + 30))).ok, true)
  const done = await dev2.resume(T0 + 31)
  assert.deepEqual(done.events.map((e) => [e.type, e.generation]), [['anchor.rotated', '3']])
  const s = await readStore(storeA)
  assert.equal(s.register.community.head, '3')
  assert.equal(L2.entries().length, 2)
  assert.deepEqual(s.register.lineage.map((x) => x.body.next), [(await A.gen(2)).anchor, (await A.gen(3)).anchor])
})

/** A rotation 1 → 2 of `A`'s community toward a key of another seed, signed
 *  by A's generation 1 and that key: a fork of the lineage (a copied key). */
async function forkedEntry (A) {
  const foreign = new Uint8Array(64).fill(0xee)
  const { signRaw } = await import('../dist/anchor.js')
  const prev = await communityContext(A.seed, A.genesis, 1)
  const next = await communityContext(foreign, A.genesis, 2)
  const after = await communityContext(foreign, A.genesis, 3)
  const body = { type: 'anchor-rotation@2', prev: prev.anchor, next: next.anchor, commit: await bindingOf(after.anchor) }
  return { rotation: { body, proof: { proofValue: await signRaw(prev, body), successorProofValue: await signRaw(next, body) } } }
}

test('rotation: a fork at g+1 is log-diverged — refused at step 1, and a pending rotation stays pending at step 2; a log of another genesis likewise (RLTP-ACC-5980; review PR 6 C1)', async () => {
  const { A, holderA, storeA, L, opts } = await rotationPair()
  const before = (await readStore(storeA)).commitSeq
  const Lf = memoryLog(A.genesis)
  assert.equal((await Lf.append(await forkedEntry(A), null)).status, 'appended')
  const onFork = await createHolder({ store: storeA, keys: A.keys, log: Lf }, { invariants: true })
  assert.deepEqual(await onFork.rotateAnchor(opts(T0 + 5)), { ok: false, code: 'log-diverged', ref: 'RLTP-ACC-5980' })
  const other = await createHolder({ store: storeA, keys: A.keys, log: memoryLog('uOtherGenesis') }, { invariants: true })
  assert.deepEqual(await other.rotateAnchor(opts(T0 + 6)), { ok: false, code: 'log-diverged', ref: 'RLTP-ACC-5980' })
  assert.equal((await readStore(storeA)).commitSeq, before, 'nothing committed')
  // step 1 over the empty log, then the fork lands before the append
  assert.equal((await holderA.rotateAnchor(opts(T0 + 10))).ok, true)
  assert.equal((await L.append(await forkedEntry(A), null)).status, 'appended')
  const r = await holderA.resume(T0 + 11)
  assert.deepEqual(r.events, [])
  const s = await readStore(storeA)
  assert.equal(s.register.community.head, '1')
  assert.ok(s.rotations['2'], 'pending')
  assert.equal(L.entries().length, 1, 'nothing appended beside the fork')
  assert.deepEqual(await holderA.rotateAnchor(opts(T0 + 12)), { ok: false, code: 'log-diverged', ref: 'RLTP-ACC-5980' })
})

test('rotation: a lost answer while the log moved on — another device of the seed completes from at(2) and appends 2 → 3; the first completes via at(2) without appending (review PR 6 C1, K2, K5)', async () => {
  let lose = 1
  const { A, holderA, storeA, L, opts } = await rotationPair({
    logA: (log) => ({ head: () => log.head(), at: (g) => log.at(g), async append (e, o) { const r = await log.append(e, o); if (lose-- > 0) throw new Error('lost'); return r } }),
  })
  // device B: the same seed, a copy of the state, the same log
  const storeB = new InMemoryStore()
  await storeB.commit(null, (await storeA.read()).state)
  const devB = await createHolder({ store: storeB, keys: A.keys, log: L }, { invariants: true })
  await holderA.rotateAnchor(opts(T0 + 10))
  assert.deepEqual((await holderA.resume(T0 + 11)).events, [], 'A appended, its answer lost: pending')
  assert.equal(L.entries().length, 1)
  // B rotates 1 → 2: the log already holds it (at(2)): completed without an append
  assert.equal((await devB.rotateAnchor(opts(T0 + 20))).ok, true)
  assert.deepEqual((await devB.resume(T0 + 21)).events.map((e) => e.generation), ['2'])
  assert.equal(L.entries().length, 1)
  // B rotates 2 → 3 over A's entry
  await devB.rotateAnchor(opts(T0 + 30)); await devB.resume(T0 + 31)
  assert.equal(L.entries().length, 2)
  assert.equal((await L.head()).gen, 3)
  // A's next step 2: the head is past g+1, at(2) is A's entry — completed, nothing appended
  const sA0 = await readStore(storeA)
  const r = await holderA.resume(sA0.duties['rotation:2'].dueAt)
  assert.deepEqual(r.events.map((e) => [e.type, e.generation]), [['anchor.rotated', '2']])
  assert.equal(L.entries().length, 2)
  const sA = await readStore(storeA), sB = await readStore(storeB)
  assert.equal(sA.register.community.head, '2')
  assert.deepEqual(sA.register.lineage, sB.register.lineage.slice(0, 1), 'one lineage element, the same')
})

test('rotation: append only ever over the persisted overHead — a head that moved is persisted first (moved), then appended over (review PR 6 K2, K5)', async () => {
  // a register at generation 2 and a stub log whose head is re-identified between the steps
  const A = await withCommunity(await side(0x07, 0x03), await digestBytes(new Uint8Array(32).fill(0x31)))
  const ctx = (g) => communityContext(A.seed, A.genesis, g)
  const r12 = await makeAnchorRotation(await ctx(1), await ctx(2), await ctx(3))
  const store = new InMemoryStore()
  await store.commit(null, stateBuilder({ at: T0 }).community(A.genesis, '2').lineage([r12]).with((s) => { s.register.labels.push(`group/${A.genesis}/2`) }).build())
  let id = 'e-x'
  const appended = []
  const stub = {
    head: async () => (appended.length ? { genesis: A.genesis, entryId: 'e-3', gen: 3, next: (await ctx(3)).anchor, commit: await bindingOf((await ctx(4)).anchor) } : { genesis: A.genesis, entryId: id, gen: 2, next: r12.body.next, commit: r12.body.commit }),
    at: async (g) => (g === 2 ? { entryId: id, next: r12.body.next, commit: r12.body.commit } : g === 3 && appended.length ? { entryId: 'e-3', next: (await ctx(3)).anchor, commit: await bindingOf((await ctx(4)).anchor) } : null),
    append: async (entry, over) => { appended.push(over); return { status: 'appended', head: await stub.head() } },
  }
  const h = await createHolder({ store, keys: A.keys, log: stub }, { invariants: true })
  assert.equal((await h.rotateAnchor({ when: T0, actId: 'r' })).ok, true)
  assert.equal((await store.read()).state.rotations['3'].overHead.entryId, 'e-x')
  id = 'e-y'
  const m = await h.resume(T0 + 1)
  assert.deepEqual([m.events, appended], [[], []], 'no append over a head the record does not name')
  assert.equal(m.nextDueAt, T0 + 1, 'due again at once')
  assert.equal((await store.read()).state.rotations['3'].overHead.entryId, 'e-y', 'the head it will append over, persisted first')
  const d = await h.resume(T0 + 2)
  assert.deepEqual(appended, ['e-y'])
  assert.deepEqual(d.events.map((e) => e.generation), ['3'])
})

test('rotation: two devices of one seed rotate concurrently over one log — one appends, the other finds exists; both complete, one entry', async () => {
  const { A, holderA, storeA, L, opts } = await rotationPair()
  const storeB = new InMemoryStore()
  await storeB.commit(null, (await storeA.read()).state)
  const devB = await createHolder({ store: storeB, keys: A.keys, log: L }, { invariants: true })
  await Promise.all([holderA.rotateAnchor(opts(T0 + 10)), devB.rotateAnchor(opts(T0 + 10))])
  const [ra, rb] = await Promise.all([holderA.resume(T0 + 11), devB.resume(T0 + 11)])
  assert.deepEqual([ra.events.map((e) => e.generation), rb.events.map((e) => e.generation)], [['2'], ['2']])
  assert.equal(L.entries().length, 1)
  assert.deepEqual((await readStore(storeA)).register.lineage, (await readStore(storeB)).register.lineage, 'the same key and binding: nothing to reconcile (5.4)')
})

test('rotation: deviceKey presents no key under a pending g+1 (review PR 6 K3)', async () => {
  const { A, holderA, opts } = await rotationPair()
  await holderA.addDevice('Laptop', opts(T0 + 1))
  await holderA.rotateAnchor(opts(T0 + 10))
  assert.deepEqual(await holderA.deviceKey('Laptop', `group/${A.genesis}/2`), { ok: false, code: 'unknown-context' }, 'the label is recorded, the head is still 1')
  assert.equal((await holderA.deviceKey('Laptop', `group/${A.genesis}`)).ok, true)
  await holderA.resume(T0 + 11)
  assert.equal((await holderA.deviceKey('Laptop', `group/${A.genesis}/2`)).ok, true, 'after the completion')
})

test('rotation: a lost answer of the append — pending, due after the backoff; the next step 2 finds `exists` and completes, one entry in the log', async () => {
  let lose = 1
  const { holderA, storeA, L, opts } = await rotationPair({
    logA: (log) => ({ head: () => log.head(), at: (g) => log.at(g), async append (e, o) { const r = await log.append(e, o); if (lose-- > 0) throw new Error('lost'); return r } }),
  })
  await holderA.rotateAnchor(opts(T0 + 10))
  const r1 = await holderA.resume(T0 + 11)
  assert.deepEqual(r1.events, [])
  let s = await readStore(storeA)
  assert.equal(s.register.community.head, '1')
  const d = s.duties['rotation:2']
  assert.equal(d.attempt, 1)
  assert.equal(d.lastAt, T0 + 11)
  assert.ok(d.dueAt > T0 + 11 && r1.nextDueAt <= d.dueAt, 'due again after the backoff, and resume counts it into nextDueAt')
  assert.equal(L.entries().length, 1, 'the append happened')
  const early = await holderA.resume(T0 + 12)
  assert.deepEqual(early.events, [], 'not before its time')
  const r2 = await holderA.resume(d.dueAt)
  assert.deepEqual(r2.events.map((e) => e.type), ['anchor.rotated'])
  s = await readStore(storeA)
  assert.equal(s.register.community.head, '2')
  assert.equal(L.entries().length, 1, 'exists: no second entry')
})

test('rotation: head-conflict re-reads and retries; failure answers log-failure on the act', async () => {
  let conflicts = 1, failures = 0
  const { holderA, storeA, L, opts } = await rotationPair({
    logA: (log) => ({
      head: () => log.head(),
      at: (g) => log.at(g),
      async append (e, o) {
        if (failures > 0) { failures--; return { status: 'failure', reason: 'unavailable' } }
        if (conflicts-- > 0) return { status: 'head-conflict', head: await log.head() }
        return log.append(e, o)
      },
    }),
  })
  await holderA.rotateAnchor(opts(T0 + 10))
  const r = await holderA.resume(T0 + 11)
  assert.deepEqual(r.events.map((e) => e.type), ['anchor.rotated'], 'one resume: the conflict re-read the head and appended')
  assert.equal(L.entries().length, 1)
  failures = 1
  await holderA.rotateAnchor(opts(T0 + 20))
  assert.deepEqual(await holderA.rotateAnchor(opts(T0 + 21)), { ok: false, code: 'log-failure' })
  assert.equal((await readStore(storeA)).register.community.head, '2')
  const again = await holderA.rotateAnchor(opts(T0 + 22))
  assert.deepEqual(again.events.map((e) => [e.type, e.generation]), [['anchor.rotated', '3']], 'the act completes the pending rotation')
  const s = await readStore(storeA)
  assert.deepEqual(Object.keys(s.duties).filter((k) => k.startsWith('rotation:')), [], 'its duty left with it')
})

test('rotation: a restart mid-procedure — after step 1, and after the append with the completion commit lost', async () => {
  let failCommit = false
  const wrapStore = (store) => ({ read: () => store.read(), async commit (v, n) { if (failCommit) { failCommit = false; throw new Error('store down') } return store.commit(v, n) } })
  const { holderA, storeA, L, opts, remake } = await rotationPair({ wrapStore })
  await holderA.rotateAnchor(opts(T0 + 10))
  // restart after step 1: a new holder over the store resumes the rotation
  const h2 = await remake()
  failCommit = true
  await assert.rejects(holderA.resume(T0 + 11), (e) => e.code === 'store-commit' || e.code === 'unknown-commit-outcome')
  assert.equal(L.entries().length, 1, 'the append happened, the completion did not commit')
  assert.equal((await readStore(storeA)).register.community.head, '1')
  const r = await h2.resume(T0 + 12)
  assert.deepEqual(r.events.map((e) => e.type), ['anchor.rotated'], 'the head shows this rotation: exists, completed')
  assert.equal(L.entries().length, 1)
  assert.equal((await readStore(storeA)).register.community.head, '2')
})

test('rotation: refused without a Log port (log-missing) or a community anchor (no-community); the same actId replays step 1', async () => {
  const { holderA: noLog } = await trustPair()
  assert.deepEqual(await noLog.rotateAnchor({ when: T0, actId: 'x' }), { ok: false, code: 'log-missing' })
  const store = new InMemoryStore()
  await store.commit(null, stateBuilder({ at: T0 }).build())
  const h = await createHolder({ store, keys: seedKeys(IKM), log: memoryLog('uX') }, { invariants: true })
  assert.deepEqual(await h.rotateAnchor({ when: T0, actId: 'y' }), { ok: false, code: 'no-community' })
  const { holderA, storeA, opts } = await rotationPair()
  const o = opts(T0 + 10)
  const first = await holderA.rotateAnchor(o)
  const seq = (await readStore(storeA)).commitSeq
  const replay = await holderA.rotateAnchor(o)
  assert.deepEqual(replay.events, first.events)
  assert.equal((await readStore(storeA)).commitSeq, seq, 'the journal answers, step 2 does not run under the same actId')
})

test('memoryLog: append is atomic and idempotent over exactly (entry, overHead); at(gen) names the entry that introduced gen (review PR 6: C2, C1)', async () => {
  const G = ID.genesisDigestSample
  const ctx = (g) => communityContext(IKM, G, g)
  const e12 = { rotation: await makeAnchorRotation(await ctx(1), await ctx(2), await ctx(3)) }
  const e23 = { rotation: await makeAnchorRotation(await ctx(2), await ctx(3), await ctx(4)) }
  const L = memoryLog(G)
  // two identical appends at once: one appended, one exists, one entry
  const [a, b] = await Promise.all([L.append(e12, null), L.append(e12, null)])
  assert.deepEqual([a.status, b.status].sort(), ['appended', 'exists'])
  assert.equal(L.entries().length, 1)
  const h = await L.head()
  assert.equal(h.gen, 2)
  // the same entry over another head is no repeat of that closure
  assert.equal((await L.append(e12, h.entryId)).status, 'head-conflict')
  // the next generation, twice at once over the head: one appended, one exists
  const [c, d] = await Promise.all([L.append(e23, h.entryId), L.append(e23, h.entryId)])
  assert.deepEqual([c.status, d.status].sort(), ['appended', 'exists'])
  assert.equal((await L.head()).gen, 3)
  assert.deepEqual(await L.at(2), { entryId: h.entryId, next: e12.rotation.body.next, commit: e12.rotation.body.commit })
  assert.equal((await L.at(3)).next, e23.rotation.body.next)
  assert.equal(await L.at(4), null)
  assert.equal(await L.at(1), null, 'generation 1 has no entry')
  // a replica catches up with the closures intact: its repeats answer exists
  const R = memoryLog(G)
  await R.syncFrom(L)
  assert.equal((await R.append(e23, h.entryId)).status, 'exists')
})

// ── review PR 6: the gaps (2145, a lag that changed before the completion) ──

test('rotation: a lag that changed between step 1 and the completion — the decision of step 1 holds: the one waiting is released at once, the one due goes though it lags now (6596)', async () => {
  const B1 = await side(0x09, 0x05), B2 = await side(0x09, 0x06)
  const A0 = await withCommunity(await side(0x07, 0x03), await digestBytes(new Uint8Array(32).fill(0x31)))
  const A2side = await side(0x07, 0x04)
  const store = new InMemoryStore()
  const H = 'did:key:z6MkNewHeadOfB', OLD = 'did:key:z6MkOldHeadOfB'
  await store.commit(null, stateBuilder({ at: T0 }).community(A0.genesis, '1')
    .relationship('r1', { contactId: 'c1', tuples: [{ ownPairLabel: A0.label, counterpartAnchor: B1.anchor, counterpartKeyAgreement: B1.keyAgreement, rkid: A0.keyAgreement }], heldCounterpartHead: H, links: [{ prev: OLD, next: H }] })
    .relationship('r2', { contactId: 'c1', tuples: [{ ownPairLabel: A2side.label, counterpartAnchor: B2.anchor, counterpartKeyAgreement: B2.keyAgreement, rkid: A2side.keyAgreement }], heldCounterpartHead: OLD })
    .entry('c1').contact('c1', { anchorHead: H }).settings('c1', { anchorMapping: 'on', star: 'off', groupStar: 'off' })
    .duty({ kind: 'class-on', v: 1, id: 'class-on:anchorMapping:r1', contactId: 'c1', relId: 'r1', cls: 'anchorMapping' })
    .build())
  const L = memoryLog(A0.genesis)
  const holder = await createHolder({ store, keys: A0.keys, log: L }, { invariants: true })
  await holder.resume(T0)
  await holder.rotateAnchor({ when: T0 + 10, actId: 'rot' })
  assert.deepEqual((await readStore(store)).rotations['2'].awaitHead, { r1: null, r2: H })
  // before the completion the lag swaps: r2 presents H, r1 falls back to OLD
  const { state, version } = await store.read()
  state.relationships.r2.heldCounterpartHead = H; state.relationships.r2.links = [{ prev: OLD, next: H }]
  state.relationships.r1.heldCounterpartHead = OLD; state.relationships.r1.links = []
  await store.commit(version, state)
  await holder.resume(T0 + 11)
  const s = await readStore(store)
  assert.deepEqual([s.duties['reissue:2:r1'].awaitHead, s.duties['reissue:2:r2'].awaitHead], [null, H], 'decided at step 1, not at the completion')
  const r = await holder.resume(T0 + 12)
  assert.deepEqual(ofType(r.outbound, MAPPING).map((o) => o.recipient.keyAgreement).sort(), [B1.keyAgreement, B2.keyAgreement].sort(),
    'r1 re-issues though it lags now (6596: the re-issue sends whether it lags or not); r2 presents H: released')
  assert.deepEqual((await readStore(store)).duties, {})
})

test('rotation: during an open 2145 — the chain stands behind two entries; the decision and the re-issue go by the entry its verifications go to (2146), the addressee verifies the lineage, and the merge after it holds the invariants', async () => {
  const { person, pairSide, network, state: stateOf, edit } = await import('./star-fixture.mjs')
  const A = await person('A', 0xa5), B = await person('B', 0xa6)
  const LA = memoryLog(A.genesis)
  const holderOf = (p) => createHolder({ store: p.store, keys: p.keys, ...(p === A ? { log: LA } : {}) }, { modules: [continuityTestModule], invariants: true })
  const n = await network([A, B], [[A, B]], { holder: { A: holderOf, B: holderOf } })
  let k = 0
  const o = (when) => ({ when, actId: `x-${++k}` })
  await A.holder.trust('B', o(T0)); await B.holder.trust('A', o(T0))
  await n.pump(T0)
  // B's community at generation 2 (set up by hand), then a re-encounter
  const g = (x) => communityContext(B.seed, B.genesis, x)
  const rotB = await makeAnchorRotation(await g(1), await g(2), await g(3))
  await edit(B, (s) => { s.register.community.head = '2'; s.register.lineage = [rotB] })
  const mine = await pairSide(A), theirs = await pairSide(B)
  A.pairs['B#2'] = mine; B.pairs['A#2'] = theirs
  const open = (x, own, other, otherSide) => x.holder.act('continuity.newTuple', {
    relId: `r-${other.name}-2`, contactId: `${other.name}-2`, ownPairLabel: own.label, counterpartAnchor: otherSide.anchor, counterpartKeyAgreement: otherSide.keyAgreement,
  }, T0 + 100)
  await open(A, mine, B, theirs); await open(B, theirs, A, mine)
  // B trusts the fresh contact before the probe runs: A commits B-2 under B's generation 2
  await B.holder.trust('A-2', o(T0 + 100))
  const out = (await B.holder.resume(T0 + 100)).outbound
  await n.deliver(out.filter((x) => x.type === MAPPING), T0 + 100)
  await n.deliver(out.filter((x) => x.type !== MAPPING), T0 + 100)
  // the probes and the chaining; B's re-issue on the new head held back
  const held = []
  for (let i = 0; i < 10; i++) {
    const all = []
    for (const p of [A, B]) all.push(...(await p.holder.resume(T0 + 100)).outbound)
    const go = all.filter((x) => { if (x.type === MAPPING && n.owner(x.envelope.rkid) === A) { held.push(x); return false } return true })
    if (!go.length) break
    await n.deliver(go, T0 + 100)
  }
  let s = await stateOf(A)
  assert.deepEqual(s.relationships['r-B'].tuples.map((t) => t.entryId), ['B', 'B-2'], 'the chain stands behind B and B-2 (2145)')
  // A trusts B-2, the entry the chain's verifications go to now, and rotates
  await A.holder.trust('B-2', o(T0 + 200))
  await n.pump(T0 + 200)
  assert.equal((await A.holder.rotateAnchor(o(T0 + 300))).ok, true)
  assert.deepEqual((await stateOf(A)).rotations['2'].awaitHead, { 'r-B': null }, 'one decision for the chain (2146)')
  await A.holder.resume(T0 + 301)
  s = await stateOf(A)
  assert.equal(s.register.community.head, '2')
  assert.deepEqual(Object.values(s.duties).filter((d) => d.kind === 'reissue-mapping').map((d) => [d.relId, d.contactId, d.awaitHead]), [['r-B', 'B-2', null]])
  const re = ofType((await A.holder.resume(T0 + 302)).outbound, MAPPING)
  assert.equal(re.length, 1)
  s = await stateOf(A)
  const body = s.relationships['r-B'].tuples[1].mappingOut.body
  assert.equal(body.self, (await communityContext(A.seed, A.genesis, 2)).anchor)
  assert.deepEqual(body.lineage, s.register.lineage, 'the lineage from the chain\'s earliest anchor (2285, 6420)')
  const [d] = await n.deliver(re, T0 + 303)
  assert.equal(d.r.disposition, 'unique', 'B verifies the lineage')
  assert.equal((await stateOf(B)).relationships['r-A'].heldCounterpartHead, body.self)
  // B's held re-issue arrives: A merges B and B-2 (2230); every commit checked
  await n.deliver(held, T0 + 400)
  await n.pump(T0 + 401)
  s = await stateOf(A)
  assert.deepEqual(Object.keys(s.contacts).sort(), ['B'])
})

// ── review PR 6 round 2 (N1): after the `moved` commit ─────────────────

/**
 * A view of a shared memoryLog whose entry ids are re-issued per phase
 * (a replica that re-materialized its ids): the head the device may
 * append over is the same entry under another id, so step 2 commits
 * `moved` first. Appends are recorded with the id they were sent over.
 */
function viewOf (L) {
  const v = { phase: 'v1', appends: [] }
  const pre = (id) => (id === null ? null : `${v.phase}:${id}`)
  const strip = (id) => (id === null ? null : id.slice(id.indexOf(':') + 1))
  const head = (h) => ('empty' in h ? h : { ...h, entryId: pre(h.entryId) })
  v.log = {
    head: async () => head(await L.head()),
    at: async (g) => { const e = await L.at(g); return e && { ...e, entryId: pre(e.entryId) } },
    async append (entry, over) {
      v.appends.push(over)
      const r = await L.append(entry, strip(over))
      return r.status === 'failure' ? r : { ...r, head: head(r.head) }
    },
  }
  return v
}

/** A at generation 2 over L; its holder for 2 → 3 over a re-identifying view; the moved commit done. */
async function movedAtTwo () {
  const p = await rotationPair()
  await p.holderA.rotateAnchor(p.opts(T0 + 10)); await p.holderA.resume(T0 + 11)   // 1 → 2 over L
  const v = viewOf(p.L)
  const make = () => createHolder({ store: p.storeA, keys: p.A.keys, log: v.log }, { invariants: true })
  const h = await make()
  assert.equal((await h.rotateAnchor(p.opts(T0 + 20))).ok, true)
  assert.equal((await readStore(p.storeA)).rotations['3'].overHead.entryId.startsWith('v1:'), true)
  v.phase = 'v2'
  const m = await h.resume(T0 + 21)
  assert.deepEqual([m.events, v.appends], [[], []], 'moved: nothing appended')
  assert.equal((await readStore(p.storeA)).rotations['3'].overHead.entryId.startsWith('v2:'), true, 'the new head persisted')
  return { ...p, v, make }
}

test('rotation (N1a): after the moved commit a restarted holder appends over the persisted new overHead, exactly once', async () => {
  const { v, make, storeA, L } = await movedAtTwo()
  const persisted = (await readStore(storeA)).rotations['3'].overHead.entryId
  const h2 = await make()
  const r = await h2.resume(T0 + 30)
  assert.deepEqual(r.events.map((e) => [e.type, e.generation]), [['anchor.rotated', '3']])
  assert.deepEqual(v.appends, [persisted], 'one append, over the persisted head')
  assert.equal(L.entries().length, 2)
  await h2.resume(T0 + 31)
  assert.deepEqual(v.appends, [persisted], 'and no other')
})

test('rotation (N1b): after the moved commit another device completes the same rotation over the shared log — this holder completes via at(3) without appending', async () => {
  const { A, v, make, storeA, L, opts } = await movedAtTwo()
  // device B: the same seed, a copy of the state from before 2 → 3, the shared log itself
  const storeB = new InMemoryStore()
  const sA = await readStore(storeA)
  const copy = structuredClone(sA)
  copy.rotations = {}
  delete copy.duties['rotation:3']
  copy.register.labels = copy.register.labels.filter((l) => l !== `group/${A.genesis}/3`)
  await storeB.commit(null, copy)
  const devB = await createHolder({ store: storeB, keys: A.keys, log: L }, { invariants: true })
  assert.equal((await devB.rotateAnchor(opts(T0 + 25))).ok, true)
  assert.deepEqual((await devB.resume(T0 + 26)).events.map((e) => e.generation), ['3'])
  assert.equal(L.entries().length, 2)
  const r = await (await make()).resume(T0 + 30)
  assert.deepEqual(r.events.map((e) => [e.type, e.generation]), [['anchor.rotated', '3']])
  assert.deepEqual(v.appends, [], 'completed from at(3), no append')
  assert.equal(L.entries().length, 2, 'one entry for generation 3')
  assert.deepEqual((await readStore(storeA)).register.lineage, (await readStore(storeB)).register.lineage)
})
