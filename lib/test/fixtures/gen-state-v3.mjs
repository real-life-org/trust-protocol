#!/usr/bin/env node
// gen-state-v3 — the golden fixtures of codec 3 (lib/src/codec.ts, lib
// 0.6.0), each encodeState's canonical text of one holder's state after a
// deterministic run (fixed seeds, entropy and `when`s):
//
//   state-v3.json           holder A after three holders A, B, C ran
//                           two encounters, trust both ways between A and
//                           B with their stars, a group A founds and B
//                           joins, an introduction of B to C by A, three
//                           messages between A and B (one taken over, one
//                           in A's inbox), A's anchor rotation over its
//                           log, the profiles
//   state-v3-open.json      holder D with work open: an encounter-confirm
//                           prompt, a group-invite prompt with its
//                           joining invite and prelude binding, the class-on
//                           duty of a trust act not yet resumed, a rotation
//                           at step 2 (its log append due); and the block
//                           (Message Tasks 6): D blocked F, and F's second
//                           invitation was declined into the register
//   state-v3-transport.json holder B with transport in custody (Delivery
//                           0.83 RLTP-DEL-6120, 6330): A's messages to B,
//                           B's acks held (awaiting-transport), accepted,
//                           failed and unsent; B's own message held
//   state-v3-register.json  holder G's register and addresses: a
//                           tombstone (a displayed code's key past the
//                           retention), a revoked device name beside a
//                           held one, and carrier entries — the holder
//                           writes none yet, so the generator places them
//                           as a carrier adapter's register would
//                           (Identity §7a.3)
//
//   usage: node test/fixtures/gen-state-v3.mjs           (write)
//          node test/fixtures/gen-state-v3.mjs --check   (compare)
// from lib/, after `npm run build`; test/codec-fixture.test.mjs runs the
// comparison in npm test. The fixtures of a released codec stay as they
// are; a later codec gets its own fixtures and a migration test.
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
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

async function main () {
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
  // messages (Message Tasks 0.1): A writes B, B answers; A takes the answer
  // over, then B writes again — one record entry taken over, one in the inbox
  await settle(all, must(await A.h.sendMessage(ab.atScanner, 'See you at the stall.', at(T0 + 350_000)), 'message A→B').outbound, T0 + 351_000)
  await settle(all, must(await B.h.sendMessage(ab.atDisplayer, 'Bis gleich am Stand.', at(T0 + 352_000)), 'message B→A').outbound, T0 + 353_000)
  must(await A.h.takeMessages((await A.h.inbox()).map((m) => m.id), { when: T0 + 354_000 }), 'take')
  await settle(all, must(await B.h.sendMessage(ab.atDisplayer, 'Und danach?', at(T0 + 355_000)), 'message B→A 2').outbound, T0 + 356_000)
  must(await A.h.rotateAnchor(at(T0 + 400_000)), 'rotate')
  await settle(all, [], T0 + 401_000)
  return encodeState(await A.read())
}

async function open () {
  const D = await holder('D', 0xd4), E = await holder('E', 0xe5), F = await holder('F', 0xf6)
  const all = [D, E, F]
  const fd = await meet(all, D, F, T0 + 60_000)                      // F shows, D scans
  const g = must(await F.h.foundGroup({ name: 'Choir' }, at(T0 + 120_000)), 'found')
  // F invites D: prelude and invite delivered, D has not decided
  await settle(all, must(await F.h.invite(event(g, 'group.founded').groupId, fd.atDisplayer, at(T0 + 121_000)), 'invite').outbound, T0 + 122_000)
  // D blocks F; F invites D into a second group: the prelude answered, the
  // invitation declined silently into the register (Message Tasks 6.4)
  must(await D.h.block(fd.atScanner, at(T0 + 123_000)), 'block')
  const g2 = must(await F.h.foundGroup({ name: 'Band' }, at(T0 + 124_000)), 'found 2')
  await settle(all, must(await F.h.invite(event(g2, 'group.founded').groupId, fd.atDisplayer, at(T0 + 125_000)), 'invite 2').outbound, T0 + 126_000)
  // D shows, E scans: the bundle lands, D has not confirmed
  const shown = must(await D.h.show(at(T0 + 180_000, { name: 'D' })), 'show')
  const sc = must(await E.h.scan(event(shown, 'encounter.shown').card, at(T0 + 181_000, { name: 'E' })), 'scan')
  for (const o of sc.outbound) await D.h.receive(o.envelope, T0 + 182_000)
  // D trusts F; the class-on duty waits for the next resume
  must(await D.h.trust(fd.atScanner, at(T0 + 183_000)), 'trust')
  // D's rotation: step 1 committed, the log append (step 2) due
  must(await D.h.rotateAnchor(at(T0 + 184_000)), 'rotate')
  return encodeState(await D.read())
}

async function register () {
  const G = await holder('G', 0x97), H = await holder('H', 0x98)
  must(await G.h.show(at(T0, { name: 'G' })), 'show')               // never scanned
  const gh = await meet([G, H], G, H, T0 + 60_000)
  must(await G.h.addDevice('laptop', at(T0 + 61_000)), 'addDevice laptop')
  must(await G.h.addDevice('phone', at(T0 + 62_000)), 'addDevice phone')
  must(await G.h.revokeDevice('laptop', at(T0 + 63_000)), 'revokeDevice')
  await G.h.tick(T0 + 100 * 86_400_000)                             // the displayed code's key: a tombstone
  const { version, state } = await G.store.read()
  const s = structuredClone(state)
  const relId = (await G.h.contact(gh.atScanner)).relationships[0].id
  const nonce = (n) => Buffer.from(createHash('sha256').update('fixture/carrier/' + n).digest()).toString('base64url')
  s.register.carriers[relId] = [{ nonce: nonce(1), generation: '1' }, { nonce: nonce(2), generation: '2' }]
  if (!(await G.store.commit(version, s)).ok) throw new Error('carriers commit')
  return encodeState(await G.read())
}

async function transport () {
  const A = await holder('A', 0xa1), B = await holder('B', 0xb2)
  const ab = await meet([A, B], A, B, T0 + 60_000)
  const ackOf = async (text, when) => {
    const m = must(await A.h.sendMessage(ab.atScanner, text, at(when)), 'message')
    const got = await B.h.receive(m.outbound[0].envelope, when + 1000)
    if (got.disposition !== 'unique') throw new Error('message ' + got.disposition)
    return got.outbound[0].digest
  }
  const held = await ackOf('one', T0 + 100_000)
  const accepted = await ackOf('two', T0 + 110_000)
  const failed = await ackOf('three', T0 + 120_000)
  await ackOf('four', T0 + 130_000)
  must(await B.h.report({ digest: held, status: 'awaiting-transport', reason: 'offline' }, T0 + 140_000), 'report held')
  must(await B.h.report({ digest: accepted, status: 'accepted' }, T0 + 141_000), 'report accepted')
  must(await B.h.report({ digest: failed, status: 'failed', reason: 'oversize' }, T0 + 142_000), 'report failed')
  const own = must(await B.h.sendMessage(ab.atDisplayer, 'offline', at(T0 + 150_000)), 'message B→A')
  must(await B.h.report({ digest: own.outbound[0].digest, status: 'awaiting-transport', reason: 'transport-unreachable' }, T0 + 151_000), 'report own')
  return encodeState(await B.read())
}

/** Every fixture file and its text. */
export async function generate () {
  acts = 0
  return { 'state-v3.json': await main(), 'state-v3-open.json': await open(), 'state-v3-register.json': await register(), 'state-v3-transport.json': await transport() }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = await generate()
  const check = process.argv.includes('--check')
  let bad = 0
  for (const [f, text] of Object.entries(out)) {
    const at = fileURLToPath(new URL('./' + f, import.meta.url))
    if (check) {
      let held = null
      try { held = readFileSync(at, 'utf8') } catch { /* missing */ }
      if (held !== text) { console.error(`${f} differs from the generator's output`); bad++ } else console.log(`${f} reproduces (${text.length} bytes)`)
    } else { writeFileSync(at, text); console.log(`${f} written (${text.length} bytes)`) }
  }
  if (bad) process.exit(1)
}
