#!/usr/bin/env node
// gen-state-v1 — the golden fixture of codec 1 (lib/src/codec.ts):
// state-v1.json is the state of holder A after a deterministic run over
// three holders A, B and C — two encounters (B shows, A scans; A shows,
// C scans), trust both ways between A and B with their stars, a group A
// founds and B joins, an introduction of B to C by A, A's anchor rotation
// over its log, and the three profiles. Seeds, entropy and every `when`
// are fixed; the file is encodeState's canonical text.
//
//   usage: node test/fixtures/gen-state-v1.mjs           (write)
//          node test/fixtures/gen-state-v1.mjs --check   (compare)
// from lib/, after `npm run build`. The fixture of a released codec stays
// as it is; a later codec gets its own fixture and a migration test.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHolder, seedKeys, digestBytes } from '../../dist/index.js'
import { InMemoryStore, memoryLog, stateBuilder } from '../../dist/testing.js'
import { encodeState } from '../../dist/internal.js'
import { sha256Hex } from '../../dist/sha256.js'

const OUT = fileURLToPath(new URL('./state-v1.json', import.meta.url))
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
const at = (when, extra = {}) => ({ when, actId: 'fixture-' + (++acts), ...extra })

async function holder (name, fill) {
  const seed = new Uint8Array(64).fill(fill)
  const genesis = await digestBytes(new TextEncoder().encode('fixture/community/' + name))
  const store = new InMemoryStore()
  await store.commit(null, stateBuilder({ at: T0 }).community(genesis, '1').build())
  const keys = seedKeys(seed)
  const h = await createHolder({ store, keys, log: memoryLog(genesis), entropy: fixedEntropy(name) }, { invariants: true })
  const p = { name, h, store, read: async () => (await store.read()).state }
  const r = await h.setProfile({ name }, at(T0))
  if (!r.ok) throw new Error('setProfile ' + r.code)
  return p
}

const must = (r, what) => { if (!r.ok) throw new Error(`${what}: ${r.code}`); return r }
const event = (r, type) => r.events.find((e) => e.type === type)

/** Deliver until nothing moves: resume every holder, route by the rkid's owner. */
async function settle (people, outbound, when) {
  const out = [...outbound]
  for (let round = 0; round < 16; round++) {
    for (const p of people) { await p.h.tick(when); out.push(...(await p.h.resume(when)).outbound) }
    if (!out.length) return
    while (out.length) {
      const o = out.shift()
      let to = null
      for (const p of people) if (Object.hasOwn((await p.read()).addresses.keys, o.envelope.rkid)) { to = p; break }
      if (!to) throw new Error('no owner for ' + o.type)
      const got = await to.h.receive(o.envelope, when)
      if (got.disposition === 'unique' || got.disposition === 'duplicate-known') out.push(...got.outbound)
    }
  }
  throw new Error('settle did not converge')
}

async function meet (people, scanner, displayer, when) {
  const shown = must(await displayer.h.show(at(when, { name: displayer.name })), 'show')
  const sc = must(await scanner.h.scan(event(shown, 'encounter.shown').card, at(when + 1000, { name: scanner.name })), 'scan')
  await settle(people, sc.outbound, when + 2000)
  const [prompt] = (await displayer.h.prompts()).filter((x) => x.kind === 'encounter-confirm')
  const d = must(await displayer.h.decide(prompt.id, 'accept', at(when + 3000)), 'confirm')
  await settle(people, d.outbound, when + 4000)
  return { atScanner: event(sc, 'contact.added').contactId, atDisplayer: prompt.contactId }
}

async function run () {
  const A = await holder('A', 0xa1), B = await holder('B', 0xb2), C = await holder('C', 0xc3)
  const all = [A, B, C]
  const ab = await meet(all, A, B, T0 + 60_000)             // B shows, A scans
  const ac = await meet(all, C, A, T0 + 120_000)            // A shows, C scans
  must(await A.h.trust(ab.atScanner, at(T0 + 180_000)), 'trust A→B')
  must(await B.h.trust(ab.atDisplayer, at(T0 + 180_000)), 'trust B→A')
  await settle(all, [], T0 + 181_000)
  const f = must(await A.h.foundGroup({ name: 'Garden' }, at(T0 + 240_000)), 'found')
  const groupId = event(f, 'group.founded').groupId
  await settle(all, must(await A.h.invite(groupId, ab.atScanner, at(T0 + 241_000)), 'invite').outbound, T0 + 242_000)
  const [inv] = await B.h.prompts()
  await settle(all, must(await B.h.decide(inv.id, 'accept', at(T0 + 243_000)), 'accept').outbound, T0 + 244_000)
  const intro = must(await A.h.introduce(ab.atScanner, ac.atDisplayer, at(T0 + 300_000, { label: 'C' })), 'introduce')
  await settle(all, intro.outbound, T0 + 301_000)
  const [rq] = await B.h.prompts()
  await settle(all, must(await B.h.decide(rq.id, 'accept', at(T0 + 302_000)), 'request').outbound, T0 + 303_000)
  const [ct] = await C.h.prompts()
  await settle(all, must(await C.h.decide(ct.id, 'accept', at(T0 + 304_000)), 'consent').outbound, T0 + 305_000)
  await settle(all, [], T0 + 340_000)                       // the mediator's ack at t_received + ack-delay
  must(await A.h.rotateAnchor(at(T0 + 400_000)), 'rotate')
  await settle(all, [], T0 + 401_000)
  return encodeState(await A.read())
}

const text = await run()
if (process.argv.includes('--check')) {
  const held = readFileSync(OUT, 'utf8')
  if (held !== text) { console.error('state-v1.json differs from the generator\'s output'); process.exit(1) }
  console.log(`state-v1.json reproduces (${text.length} bytes)`)
} else {
  writeFileSync(OUT, text)
  console.log(`state-v1.json written (${text.length} bytes)`)
}
