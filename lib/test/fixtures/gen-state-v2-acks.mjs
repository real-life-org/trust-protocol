#!/usr/bin/env node
// gen-state-v2-acks — one golden fixture of codec 2 written by lib 0.5.0
// for the migration 2 → 3 (lib 0.6.0, Delivery 0.83 RLTP-DEL-6330): holder
// B's stored acknowledgements in every form codec 2 knows —
//   · one reported awaiting-transport   → sent, sentBy 'report'
//   · one reported accepted              → sent, sentBy 'report'
//   · one past the horizon, unreported   → sent, sentBy 'horizon'
//   · one unreported within the horizon  → unsent
// Codec 2 cannot tell the first two apart; that is what the migration
// has to answer. Run once against lib 0.5.0's dist and frozen since: the
// library after 0.5.0 writes codec 3, so this generator no longer
// reproduces it (test/codec-fixture.test.mjs reads the file only).
//
//   usage (lib 0.5.0, from lib/): node test/fixtures/gen-state-v2-acks.mjs
import { writeFileSync } from 'node:fs'
import { createHolder, seedKeys, digestBytes } from '../../dist/index.js'
import { InMemoryStore, memoryLog, stateBuilder } from '../../dist/testing.js'
import { encodeState } from '../../dist/internal.js'
import { sha256Hex } from '../../dist/sha256.js'

const T0 = Date.parse('2026-10-15T09:00:00Z')

/** Entropy from a counter under SHA-256: deterministic, for this fixture only. */
function fixedEntropy (tag) {
  let n = 0
  const bytes = (purpose, k) => {
    const out = []
    while (out.length < k) for (const h of sha256Hex(`${tag}/${purpose}/${n++}`).match(/../g)) out.push(parseInt(h, 16))
    return Uint8Array.from(out.slice(0, k))
  }
  const id = (purpose) => {
    const b = bytes(purpose, 16)
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  }
  return { bytes, id }
}

let acts = 0
const at = (when, extra = {}) => ({ when, actId: 'fixture-acks-' + (++acts), ...extra })
const must = (r, what) => { if (!r.ok) throw new Error(`${what}: ${r.code}`); return r }
const event = (r, type) => r.events.find((e) => e.type === type)

async function holder (name, fill) {
  const genesis = await digestBytes(new TextEncoder().encode('fixture/community/' + name))
  const store = new InMemoryStore()
  await store.commit(null, stateBuilder({ at: T0 }).community(genesis, '1').build())
  const h = await createHolder({ store, keys: seedKeys(new Uint8Array(64).fill(fill)), log: memoryLog(genesis), entropy: fixedEntropy(name) }, { invariants: true })
  must(await h.setProfile({ name }, at(T0)), 'setProfile')
  return { name, h, store, read: async () => (await store.read()).state }
}

const DAY = 86_400_000

async function acks () {
  const A = await holder('A', 0xa1), B = await holder('B', 0xb2)
  // B shows, A scans: the bundle reaches B, B's ack reaches A
  const shown = must(await B.h.show(at(T0 + 60_000, { name: 'B' })), 'show')
  const sc = must(await A.h.scan(event(shown, 'encounter.shown').card, at(T0 + 61_000, { name: 'A' })), 'scan')
  const toA = []
  for (const o of sc.outbound) toA.push(...(await B.h.receive(o.envelope, T0 + 62_000)).outbound)
  for (const o of toA) await A.h.receive(o.envelope, T0 + 63_000)
  const [prompt] = (await B.h.prompts()).filter((x) => x.kind === 'encounter-confirm')
  const d = must(await B.h.decide(prompt.id, 'accept', at(T0 + 64_000)), 'confirm')
  for (const o of d.outbound) for (const back of (await A.h.receive(o.envelope, T0 + 65_000)).outbound) await B.h.receive(back.envelope, T0 + 66_000)
  const bId = event(sc, 'contact.added').contactId
  // A writes B three messages; B's acks: one held, one accepted, one left
  const ackOf = async (text, when) => {
    const m = must(await A.h.sendMessage(bId, text, at(when)), 'message')
    const got = await B.h.receive(m.outbound[0].envelope, when + 1000)
    if (got.disposition !== 'unique') throw new Error('message ' + got.disposition)
    return got.outbound[0].digest
  }
  const held = await ackOf('one', T0 + 100_000)
  const accepted = await ackOf('two', T0 + 110_000)
  await ackOf('three', T0 + 120_000)
  must(await B.h.report({ digest: held, status: 'awaiting-transport', reason: 'offline' }, T0 + 130_000), 'report held')
  must(await B.h.report({ digest: accepted, status: 'accepted' }, T0 + 131_000), 'report accepted')
  // eight days on: B's resume ends the unreported acks' retries at the horizon
  await B.h.resume(T0 + 8 * DAY)
  // a fourth message after that: its ack stays unsent
  await ackOf('four', T0 + 8 * DAY + 1000)
  return encodeState(await B.read())
}

const text = await acks()
if (process.argv.includes('--print')) process.stdout.write(text)
else writeFileSync(new URL('./state-v2-acks.json', import.meta.url), text)
