#!/usr/bin/env node
// delivery-held (lib 0.10.0): the feature `held` of `accepted` — Delivery
// 0.85 RLTP-DEL-6140, RLTP-DEL-6110. A report { status: 'accepted', held:
// true } (the adapter's reading of a validated trust-task-next-step, VTI
// RLTP-VTI-5050) makes a non-terminal document accepted and held, once;
// no horizon and no sender lifetime ends it, only a valid acknowledgement
// or a validated terminal refusal.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ENGINE_DEFAULTS } from '../dist/engine.js'
import { decodeState, encodeState } from '../dist/internal.js'
import { pair, read, noteModule, T0, DAY } from './pair-fixture.mjs'

const H = ENGINE_DEFAULTS.horizonMs

async function sent (opts) {
  const p = await pair(opts)
  const seen = []
  p.holderA.subscribe((c) => seen.push(...c.events))
  const note = await p.holderA.act('note.send', { text: 'hi' }, T0)
  const out = note.outbound[0]
  return { ...p, out, seen, item: async () => (await p.holderA.deliveryStatus(out.digest)).items[0] }
}
const statusEvents = (seen) => seen.filter((e) => e.type === 'delivery.status').map((e) => [e.status, e.held ?? null])
const steps = async (store, d) => (await read(store)).outbox[d].history.map((x) => [x.status, x.held ?? null])

test('held (RLTP-DEL-6140): from submitted, from awaiting-transport and from accepted, a held report makes the document accepted and held, announced with held', async () => {
  for (const before of [[], [{ status: 'awaiting-transport', reason: 'offline' }], [{ status: 'accepted' }]]) {
    const { holderA, storeA, out, seen, item } = await sent()
    let t = T0 + 1
    for (const r of before) await holderA.report({ digest: out.digest, ...r }, t++)
    await holderA.report({ digest: out.digest, status: 'accepted', held: true }, t++)
    const v = await item()
    assert.deepEqual([v.status, v.held], ['accepted', true], JSON.stringify(before))
    assert.deepEqual((await steps(storeA, out.digest)).at(-1), ['accepted', true])
    assert.deepEqual(statusEvents(seen).at(-1), ['accepted', true])
  }
})

test('held: a plain accepted report shows no held; a second held report, and held on a terminal document, change nothing', async () => {
  const { holderA, storeA, out, item, seen } = await sent()
  await holderA.report({ digest: out.digest, status: 'accepted' }, T0 + 1)
  assert.equal((await item()).held, undefined)
  await holderA.report({ digest: out.digest, status: 'accepted', held: true }, T0 + 2)
  const once = await steps(storeA, out.digest)
  await holderA.report({ digest: out.digest, status: 'accepted', held: true }, T0 + 3)
  assert.deepEqual(await steps(storeA, out.digest), once, 'a second next step changes nothing')
  assert.equal(statusEvents(seen).filter(([, h]) => h).length, 1)

  const f = await sent()
  await f.holderA.report({ digest: f.out.digest, status: 'failed', reason: 'oversize' }, T0 + 1)
  const fs = await steps(f.storeA, f.out.digest)
  await f.holderA.report({ digest: f.out.digest, status: 'accepted', held: true }, T0 + 2)
  assert.deepEqual(await steps(f.storeA, f.out.digest), fs, 'failed stands')

  const d = await sent()
  const got = await d.holderB.receive(d.out.envelope, T0 + 1)
  await d.holderA.receive(got.outbound[0].envelope, T0 + 2)
  assert.equal((await d.item()).status, 'delivered')
  const ds = await steps(d.storeA, d.out.digest)
  await d.holderA.report({ digest: d.out.digest, status: 'accepted', held: true }, T0 + 3)
  assert.deepEqual(await steps(d.storeA, d.out.digest), ds, 'delivered stands')
})

test('held: the horizon does not end a held document, nor its sender lifetime (RLTP-DEL-6110); an unheld accepted one fails at the horizon', async () => {
  const { holderA, out, item } = await sent()
  await holderA.report({ digest: out.digest, status: 'accepted', held: true }, T0 + 1)
  await holderA.tick(T0 + H + DAY)
  await holderA.resume(T0 + H + 2 * DAY)
  assert.deepEqual([(await item()).status, (await item()).held], ['accepted', true])

  const plain = await sent()
  await plain.holderA.report({ digest: plain.out.digest, status: 'accepted' }, T0 + 1)
  await plain.holderA.tick(T0 + H + DAY)
  await plain.holderA.resume(T0 + H + 2 * DAY)
  assert.equal((await plain.item()).status, 'failed', 'the counter-probe: without held the horizon ends it')

  const lifeModule = () => {
    const m = noteModule()
    const send = m.commands['note.send']
    return { ...m, commands: { 'note.send': { ...send, apply (state, p, input, when) { const r = send.apply(state, p, input, when); return { ...r, outbound: r.outbound.map((o) => ({ ...o, expiresAt: when + 60_000 })) } } } } }
  }
  const life = await sent({ modules: () => [lifeModule()] })
  await life.holderA.report({ digest: life.out.digest, status: 'accepted', held: true }, T0 + 1)
  await life.holderA.tick(T0 + 120_000)
  await life.holderA.resume(T0 + 180_000)
  assert.deepEqual([(await life.item()).status, (await life.item()).held], ['accepted', true], 'the lifetime does not end a held document')
})

test('held: a valid acknowledgement makes it delivered; a validated terminal refusal makes it failed with its code', async () => {
  const a = await sent()
  await a.holderA.report({ digest: a.out.digest, status: 'accepted', held: true }, T0 + 1)
  const got = await a.holderB.receive(a.out.envelope, T0 + 2)
  await a.holderA.receive(got.outbound[0].envelope, T0 + 3)
  const v = await a.item()
  assert.deepEqual([v.status, v.held], ['delivered', undefined])

  const r = await sent()
  await r.holderA.report({ digest: r.out.digest, status: 'accepted', held: true }, T0 + 1)
  await r.holderA.report({ digest: r.out.digest, status: 'failed', reason: 'rejected-by-receiver', code: 'unsupportedType' }, T0 + 2)
  const w = await r.item()
  assert.deepEqual([w.status, w.reason, w.code, w.held], ['failed', 'rejected-by-receiver', 'unsupportedType', undefined])
})

test('unsupportedExtension (trust-task-error/0.6): the holder records the refusal with its code, and the state round-trips at codec 4 (RLTP-VTI-5020)', async () => {
  const r = await sent()
  await r.holderA.report({ digest: r.out.digest, status: 'failed', reason: 'rejected-by-receiver', code: 'unsupportedExtension' }, T0 + 1)
  const w = await r.item()
  assert.deepEqual([w.status, w.reason, w.code], ['failed', 'rejected-by-receiver', 'unsupportedExtension'])
  const s = await read(r.storeA)
  assert.equal(encodeState(decodeState(encodeState(s))), encodeState(s))
})

test('held: a held state round-trips through the codec and is not offered for transport', async () => {
  const { holderA, storeA, out } = await sent()
  await holderA.report({ digest: out.digest, status: 'accepted', held: true }, T0 + 1)
  const s = await read(storeA)
  assert.equal(encodeState(decodeState(encodeState(s))), encodeState(s))
  await holderA.resume(T0 + 2)
  const v = await holderA.pendingTransport(T0 + 2)
  assert.ok(!v.entries.some((e) => e.digest === out.digest))
})
