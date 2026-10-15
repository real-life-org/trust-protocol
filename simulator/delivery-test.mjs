#!/usr/bin/env node
// delivery-test — building block 7: the receive stages of the Delivery
// Contract (one holder.receive per envelope), the completed-effect cache,
// the channel's faults (hold/dup/tamper/lose), offline transit, and the
// sender's side: retry on resume, delivered only by the ack.
import { createPerson, createNetwork, at, eventOf, seal, jcs, b64uOf, fromB64u, TYPES } from './holder.mjs'
import * as DV from './delivery.mjs'

let pass = 0, fail = 0
const check = (c, m) => { if (c) { pass++; console.log(`  ok    ${m}`) } else { fail++; console.error(`  FAIL  ${m}`) } }
const T0 = Date.parse('2026-08-26T10:00:00Z')

const a = await createPerson('Anton', { when: T0 }), b = await createPerson('Berta', { when: T0 })
const net = createNetwork([a, b])
const ch = net.channel
/** A fresh bundle from Anton to Berta: Berta shows, Anton scans. */
const bundle = async (t) => {
  const sh = await b.h.show(at(t))
  const sc = await a.h.scan(eventOf(sh, 'encounter.shown').card, at(t + 1))
  return sc.outbound.find((o) => o.type === TYPES.bundle)
}

// ── a clean pass: the stages, all green ─────────────────────────────────
{
  const o = await bundle(T0)
  const r = await DV.deliver(ch, b, o.envelope, T0 + 1000)
  check(r.arrived && r.disp === 'unique' && r.stages.length === 9 && r.stages.every((s) => s.ok), 'delivery: stages 1–9 green, disposition unique')
  check(r.result.outbound[0]?.type === TYPES.ack, 'the effect commits with its ack first among the outbound (Delivery 4.2)')
  const r2 = await DV.deliver(ch, b, o.envelope, T0 + 2000)
  check(r2.disp === 'duplicate-known' && r2.stages.length === 5, 'duplicate-known: the prior outcome applies — no second effect')
  check(r2.result.outbound.length === 1 && r2.result.outbound[0].digest === r.result.outbound[0].digest, 'the stored ack is re-sent byte-identical')
  check((await b.h.prompts()).filter((p) => p.kind === 'encounter-confirm').length === 1, 'one prompt for Berta, not two')
}

// ── stage negatives ─────────────────────────────────────────────────────
{
  const o = await bundle(T0 + 10_000)
  const raw = fromB64u(o.envelope.ciphertext); raw[4] ^= 0x01
  const r = await DV.deliver(ch, b, { ...o.envelope, ciphertext: b64uOf(raw) }, T0 + 11_000)
  check(r.disp === 'failed(decryption-failed)' && r.stages.length === 3 && !r.stages[2].ok, 'a flipped bit: the AES-GCM tag catches it (stage 3)')
  const r2 = await DV.deliver(ch, b, { ...o.envelope, epk: 'abc' }, T0 + 11_000)
  check(r2.disp === 'failed(malformed)' && r2.stages.length === 2, 'a broken epk: stage 2 (envelope form) refuses')
  const r3 = await DV.deliver(ch, b, { ...o.envelope, ciphertext: b64uOf(new Uint8Array(70000)) }, T0 + 11_000)
  check(r3.disp === 'failed(oversize)' && r3.stages.length === 1, 'the size bound BEFORE decryption (stage 1)')
  const r4 = await DV.deliver(ch, b, await seal({ id: crypto.randomUUID(), type: 'https://example.org/unregistered/0.1', payload: {} }, o.envelope.rkid), T0 + 11_000)
  check(r4.disp.startsWith('failed(') && r4.stages.at(-1).ok === false, `a document the register does not know dies at its stage (${r4.disp}, stage ${r4.stages.length})`)
  // refusals are NOT cached: the same envelope is judged again, never duplicate-known
  const r5 = await DV.deliver(ch, b, { ...o.envelope, epk: 'abc' }, T0 + 12_000)
  check(r5.disp === 'failed(malformed)', 'a refusal is not cached — the contract caches effects, not failed attempts')
  check((await DV.deliver(ch, b, o.envelope, T0 + 13_000)).disp === 'unique', 'the intact envelope still lands once')
}

// ── faults on the channel, and the sender's retry ───────────────────────
{
  ch.faults.lose = true
  const o = await bundle(T0 + 20_000)
  const lost = await net.deliver(a, o, T0 + 21_000)
  check(/^lost/.test(lost.disp), 'lose: the channel gives no sign — only the missing ack tells')
  ch.faults.lose = false
  check((await a.h.deliveryStatus(o.digest)).items[0].status === 'submitted', 'the sender still reads submitted: no ack, no delivered')
  const early = await a.h.resume(T0 + 22_000)
  check(!early.outbound.some((x) => x.digest === o.digest), 'not re-offered before the backoff')
  const due = (await a.read()).outbox[o.digest].nextAttemptAt
  const again = await a.h.resume(due)
  const re = again.outbound.find((x) => x.digest === o.digest)
  check(re?.attempt === 2 && jcs(re.envelope) === jcs(o.envelope), 'after the backoff resume re-offers the same envelope, byte-identical, attempt 2')
  await net.send(a, [re], due)
  check((await a.h.deliveryStatus(o.digest)).items[0].status === 'delivered', 'it lands; the ack comes back: delivered')

  ch.faults.tamper = true
  const t2 = await net.deliver(a, await bundle(T0 + 30_000), T0 + 31_000)
  check(t2.disp === 'failed(decryption-failed)', 'tamper: one bit flips on the channel — stage 3 catches it')
  ch.faults.tamper = false

  ch.faults.hold = true
  const o3 = await bundle(T0 + 40_000)
  const h = await net.deliver(a, o3, T0 + 41_000)
  check(/^held/.test(h.disp) && ch.held.length === 1, 'hold: the delivery parks on the channel')
  ch.faults.hold = false
  const w = net.wire.length
  await net.releaseHeld(T0 + 42_000)
  check(net.wire.slice(w).filter((x) => x.disp === 'unique' && x.type === TYPES.bundle).length === 1 && ch.held.length === 0, 'hold released: the parked delivery lands, its effect once')

  ch.faults.dup = true
  const w2 = net.wire.length
  await net.deliver(a, await bundle(T0 + 50_000), T0 + 51_000)
  ch.faults.dup = false
  const dups = net.wire.slice(w2).filter((x) => x.type === TYPES.bundle)
  check(dups.map((x) => x.disp).join() === 'unique,duplicate-known', 'dup: the second copy is duplicate-known — never a second effect')
}

// ── offline transit ─────────────────────────────────────────────────────
{
  await net.setOnline(b, false, T0 + 60_000)
  const o = await bundle(T0 + 60_000)
  const r = await net.deliver(a, o, T0 + 61_000)
  check(/^transit/.test(r.disp), 'offline: transit — delivery time is unbounded, no arrival')
  check((await a.h.deliveryStatus(o.digest)).items[0].status === 'accepted', 'the sender reads accepted: the relay took it (a report, never a local commit)')
  const w = net.wire.length
  await net.setOnline(b, true, T0 + 120_000)
  check(net.wire.slice(w).filter((x) => x.disp === 'unique' && x.kind === 'from transit').length === 1, 'online: the transit flows, its effect once')
  check((await a.h.deliveryStatus(o.digest)).items[0].status === 'delivered', 'and the sender reads delivered once the ack is back')
}

// ── the sender learns what the channel saw ─────────────────────────────
{
  // an rkid no device on the network holds: failed(unroutable) at the sender
  const o = await bundle(T0 + 200_000)
  const lone = createNetwork([a])
  const e = await lone.deliver(a, o, T0 + 201_000)
  check(e.disp === 'unroutable', 'an rkid no device holds: the channel cannot route it')
  const st = (await a.h.deliveryStatus(o.digest)).items[0]
  check(st.status === 'failed' && st.reason === 'unroutable', 'the sender reads failed(unroutable) — reported back, not only logged')
}
{
  // a kept outbound stays kept until the channel takes it
  await net.setOnline(a, false, T0 + 300_000)
  const o = await bundle(T0 + 300_000)
  await net.deliver(a, o, T0 + 301_000)
  check(net.outq.get('Anton')?.length === 1, 'offline sender: the bundle is kept on the device')
  ch.faults.lose = true
  await net.setOnline(a, true, T0 + 302_000)
  ch.faults.lose = false
  check(net.outq.get('Anton')?.length === 1, 'back online but the channel lost it: it stays kept')
  const st = (await a.h.deliveryStatus(o.digest)).items[0]
  check(st.status === 'submitted' && st.awaiting === 'transport-unreachable', 'and the sender reads awaiting-transport (transport-unreachable), not a silent submitted')
  ch.faults.hold = true
  await net.setOnline(a, true, T0 + 303_000)
  ch.faults.hold = false
  check(net.outq.get('Anton')?.length === 0 && ch.held.length === 1, 'the next try: the channel holds it — the relay has it now')
  check((await a.h.deliveryStatus(o.digest)).items[0].status === 'accepted', 'held by the relay: accepted')
  const w = net.wire.length
  await net.releaseHeld(T0 + 304_000)
  check(net.wire.slice(w).some((x) => x.type === TYPES.bundle && x.disp === 'unique'), 'released: it lands, its wire row carries its type')
  check((await a.h.deliveryStatus(o.digest)).items[0].status === 'delivered', 'and the ack makes it delivered')
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) { console.error('delivery: FAILED'); process.exit(1) }
console.log('delivery: building block 7 holds — stages, cache, faults, transit, retry.')
