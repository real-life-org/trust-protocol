#!/usr/bin/env node
// multi-device-baseline: what a person with two devices gets from the
// library today. The library is built for one writer per holder
// (README, "devices"); this file measures the distance from there to the
// everyday scenarios of a person with a phone (T) and a laptop (L).
//
// Each scenario ends in one of three standings:
//   green          the expectation holds
//   red            the scenario can be stated, the expectation fails
//   inexpressible  the library has no way to state the scenario
// EXPECTED pins the standing of every scenario. The test fails when a
// standing moves, in either direction: a build step that turns a row
// green changes its pin in the same change.
//
// How the two devices come about. The library has no enrolment and no
// exchange between the devices of a person, so the baseline uses two
// stand-ins and names them in each row:
//   fromSeed(T)  a holder over the same seed and an empty store: what a
//                device has that knows only the recovery words
//   copyOf(T)    a holder over the same seed and a copy of T's store at
//                that moment: what a device would start from that was
//                enrolled with the person's whole state
// The carrier stand-in hands an envelope to every device that holds its
// address.
//
// Introductions (Trust §8) are out of scope here; they are measured apart.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { InMemoryStore } from '../dist/testing.js'
import { T0, ev, opts, met, communityPerson, person } from './holder-fixture.mjs'

const DAY = 86_400_000
let clock = T0 + 1_000_000
const tick = (n = 10_000) => (clock += n)

/** Delivers outbound and all it causes, to every device holding the address. */
async function route (people, outbound, when = tick(), { rounds = 12 } = {}) {
  let out = [...outbound]
  const seen = []
  for (let r = 0; r < rounds; r++) {
    for (const p of people) out.push(...(await p.h.resume(when)).outbound)
    if (!out.length) break
    while (out.length) {
      const o = out.shift()
      for (const to of people) {
        if (!Object.hasOwn((await to.read()).addresses.keys, o.envelope.rkid)) continue
        const got = await to.h.receive(o.envelope, when)
        seen.push({ o, to, got })
        if (got.disposition === 'unique' || got.disposition === 'duplicate-known') out.push(...got.outbound)
      }
    }
  }
  return seen
}

const mk = async (fill) => ({ ...(await communityPerson(fill)), fill })
const fromSeed = async (P) => ({ ...(await person(P.fill)), fill: P.fill })
async function copyOf (P) {
  const store = new InMemoryStore()
  await store.commit(null, (await P.store.read()).state)
  return { ...(await person(P.fill, { store })), fill: P.fill }
}

const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'commitSeq' ? undefined : x)))
const shows = async (P) => strip({
  contacts: await P.h.contacts(), groups: await P.h.groups(), profile: await P.h.profile(),
  inbox: await P.h.inbox(), prompts: await P.h.prompts(),
})
/** The sections two devices show differently; empty when they show the same. */
async function differ (X, Y) {
  const [x, y] = [await shows(X), await shows(Y)]
  return Object.keys(x).filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k]))
}

const green = { status: 'green' }
const red = (note) => ({ status: 'red', note })
const inexpressible = (note) => ({ status: 'inexpressible', note })
/** green when both devices show the same, and `also` holds */
async function same (T, L, also = true, what = '') {
  const d = await differ(T, L)
  if (d.length) return red('the devices differ in: ' + d.join(', '))
  return also ? green : red(what)
}
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r }
const refused = (seen) => seen.filter((s) => s.got.disposition !== 'unique' && s.got.disposition !== 'duplicate-known').map((s) => s.got.disposition + (s.got.reason ? ' ' + s.got.reason : ''))

async function invited (people, inviter, groupId, contactId) {
  await route(people, ok(await inviter.h.invite(groupId, contactId, opts(tick()))).outbound)
}
const invitePrompt = async (P, groupId) => (await P.h.prompts()).find((p) => p.kind === 'group-invite' && p.groupId === groupId)
async function founded (P, name = 'Garden') {
  return ev(ok(await P.h.foundGroup({ name }, opts(tick()))), 'group.founded')[0].groupId
}
const phaseOf = async (P, groupId) => (await P.h.groups()).find((g) => g.id === groupId)?.phase

/** A with phone T, friend B, met; then the laptop as a copy of T.
 *  `profile`: A's profile class toward B is on before the copy. */
async function pairWithCopy (f, { profile = false } = {}) {
  const T = await mk(f), B = await mk(f + 1)
  const { a, b } = await met(T, B, tick())
  if (profile) await route([T, B], ok(await T.h.setClass(a.id, 'profile', 'on', opts(tick()))).outbound)
  const L = await copyOf(T)
  return { T, L, B, a, b }
}

const SCENARIOS = {
  // ---- devices
  G1: ['A adds the laptop next to the phone: the laptop shows the same contacts, trust, profile and groups', async () => {
    const T = await mk(0x21), B = await mk(0x22)
    await met(T, B, tick())
    ok(await T.h.addDevice('laptop', opts(tick())))
    return same(T, await fromSeed(T))
  }],
  G2: ['a new phone while the old one is still there, then the old one is removed', async () => {
    const T = await mk(0x23), B = await mk(0x24)
    await met(T, B, tick())
    ok(await T.h.addDevice('phone-2', opts(tick())))
    return same(T, await fromSeed(T))
  }],
  G3: ['the phone is lost, A removes it from the laptop: the phone speaks to no friend any more', async () => {
    const T = await mk(0x25), B = await mk(0x26)
    ok(await T.h.addDevice('phone', opts(tick())))
    const { a } = await met(T, B, tick())
    const L = await copyOf(T)
    ok(await L.h.revokeDevice('phone', opts(tick())))
    const sent = await T.h.sendMessage(a.id, 'still here', opts(tick()))
    if (!sent.ok) return green
    await route([T, L, B], sent.outbound)
    return (await B.h.inbox()).length ? red('B accepts a message of the removed device') : green
  }],
  G4: ['every device is lost, A has the recovery words: contacts, trust, profile, groups and messages come back', async () => {
    const T = await mk(0x27), B = await mk(0x28)
    const { b } = await met(T, B, tick())
    await founded(T)
    await route([T, B], ok(await B.h.sendMessage(b.id, 'hello', opts(tick()))).outbound)
    return same(T, await fromSeed(T))
  }],
  G5: ['A restores an old image while the laptop goes on: the restored device catches up', async () => {
    const T = await mk(0x29), B = await mk(0x2a), C = await mk(0x2b)
    await met(T, B, tick())
    const R = await copyOf(T)
    await met(T, C, tick())
    await route([T, R, B, C], [])
    return same(T, R)
  }],
  G6: ['the laptop was off for 30 days: it catches up', async () => {
    const { T, L, B, a } = await pairWithCopy(0x2c)
    ok(await T.h.trust(a.id, opts(tick())))
    await route([T, B], [])
    await route([T, L, B], [], tick(30 * DAY))
    return same(T, L)
  }],

  // ---- contacts and trust
  K1: ['A meets B with the phone: B is on the laptop too', async () => {
    const T = await mk(0x31), B = await mk(0x32)
    const L = await copyOf(T)
    await met(T, B, tick())
    await route([T, L, B], [])
    return same(T, L)
  }],
  K2: ['apart: the phone meets B, the laptop meets C: both devices show B and C', async () => {
    const T = await mk(0x33), B = await mk(0x34), C = await mk(0x35)
    const L = await copyOf(T)
    await met(T, B, tick())
    await met(L, C, tick())
    await route([T, L, B, C], [])
    return same(T, L)
  }],
  K3: ['B meets the phone, later and apart the laptop: one line for B on both devices, one line for A at B', async () => {
    const T = await mk(0x36), B = await mk(0x37)
    const L = await copyOf(T)
    await met(T, B, tick())
    await met(L, B, tick())
    await route([T, L, B], [])
    const n = (await B.h.contacts()).length
    return same(T, L, n === 1, `B holds ${n} lines for A`)
  }],
  K4: ['A trusts B on the phone: it holds on the laptop, B sees one effect', async () => {
    const { T, L, B, a, b } = await pairWithCopy(0x38)
    await route([T, L, B], ok(await T.h.trust(a.id, opts(tick()))).outbound)
    const got = (await B.h.contact(b.id)).trust.received
    return same(T, L, got, 'B did not receive the trust')
  }],
  K5: ['apart: A trusts B on the phone and on the laptop: one effect at B, no conflict', async () => {
    const { T, L, B, a, b } = await pairWithCopy(0x3a)
    const t = ok(await T.h.trust(a.id, opts(tick())))
    const l = ok(await L.h.trust(a.id, opts(tick())))
    const bad = refused(await route([T, L, B], [...t.outbound, ...l.outbound]))
    if (bad.length) return red('refused on the way: ' + [...new Set(bad)].join(', '))
    return same(T, L, (await B.h.contact(b.id)).trust.received, 'B did not receive the trust')
  }],
  K6: ['A removes B on the phone and, apart, writes to B on the laptop: B is gone on both devices', async () => {
    const { T, L, B, a } = await pairWithCopy(0x3c)
    const d = ok(await T.h.depart(a.id, opts(tick())))
    const m = await L.h.sendMessage(a.id, 'hello', opts(tick()))
    await route([T, L, B], [...d.outbound, ...(m.outbound ?? [])])
    return same(T, L, (await L.h.contacts()).length === 0, 'the laptop still holds B')
  }],

  // ---- profile
  P1: ['A changes the profile on the phone: the laptop and the friends show it', async () => {
    const { T, L, B, b } = await pairWithCopy(0x41, { profile: true })
    await route([T, L, B], ok(await T.h.setProfile({ name: 'Ada' }, opts(tick()))).outbound)
    return same(T, L, (await B.h.contact(b.id)).displayName === 'Ada', 'B does not show the name')
  }],
  P2: ['apart: the profile changed on the phone and on the laptop: both devices and every friend end on the same', async () => {
    const { T, L, B, b } = await pairWithCopy(0x43, { profile: true })
    const t = ok(await T.h.setProfile({ name: 'Ada' }, opts(tick())))
    const l = ok(await L.h.setProfile({ name: 'Ada L.' }, opts(tick())))
    const bad = refused(await route([T, L, B], [...t.outbound, ...l.outbound]))
    const atB = (await B.h.contact(b.id)).displayName
    const own = [(await T.h.profile()).name, (await L.h.profile()).name]
    if (own[0] !== own[1]) return red(`phone shows ${own[0]}, laptop ${own[1]}, B ${atB}` + (bad.length ? '; refused: ' + [...new Set(bad)].join(', ') : ''))
    return same(T, L, atB === own[0], 'B shows another name')
  }],
  P3: ['A gives B another of its profiles on the phone: the laptop knows the assignment', async () =>
    inexpressible('one profile per sender (Trust 6b); no profile is assigned per contact')],

  // ---- messages
  N1: ['B writes to A: the message is on the phone and the laptop', async () => {
    const { T, L, B, b } = await pairWithCopy(0x51)
    await route([T, L, B], ok(await B.h.sendMessage(b.id, 'hello', opts(tick()))).outbound)
    const n = [(await T.h.inbox()).length, (await L.h.inbox()).length]
    return n[0] === 1 && n[1] === 1 ? green : red(`inbox: phone ${n[0]}, laptop ${n[1]}`)
  }],
  N2: ['A writes from the phone: the message is in the conversation on the laptop', async () =>
    inexpressible('the library holds no record of sent messages; the conversation is the application\'s')],
  N3: ['A takes a message over on the phone: the laptop no longer offers it as new', async () => {
    const { T, L, B, b } = await pairWithCopy(0x53)
    await route([T, L, B], ok(await B.h.sendMessage(b.id, 'hello', opts(tick()))).outbound)
    const ids = (await T.h.inbox()).map((m) => m.id)
    if (!ids.length) return red('the phone did not receive the message')
    await T.h.takeMessages(ids, { when: tick() })
    await route([T, L, B], [])
    const n = (await L.h.inbox()).length
    return n === 0 ? green : red(`the laptop still offers ${n}`)
  }],

  // ---- groups
  M1: ['an invitation to G arrives: the card is on the phone and the laptop', async () => {
    const { T, L, B, b } = await pairWithCopy(0x61)
    const g = await founded(B)
    await invited([T, L, B], B, g, b.id)
    const has = [!!(await invitePrompt(T, g)), !!(await invitePrompt(L, g))]
    return has[0] && has[1] ? green : red(`card: phone ${has[0]}, laptop ${has[1]}`)
  }],
  M2: ['A accepts on the phone: the laptop is in G without an act of its own, its card is decided', async () => {
    const { T, L, B, b } = await pairWithCopy(0x63)
    const g = await founded(B)
    await invited([T, L, B], B, g, b.id)
    const p = await invitePrompt(T, g)
    if (!p) return red('the phone holds no invitation')
    await route([T, L, B], ok(await T.h.decide(p.id, 'accept', opts(tick()))).outbound)
    const ph = [await phaseOf(T, g), await phaseOf(L, g)]
    return ph[0] === 'member' && ph[1] === 'member' && !(await invitePrompt(L, g)) ? green : red(`phase: phone ${ph[0]}, laptop ${ph[1]}`)
  }],
  M3: ['apart: accept on the phone, decline on the laptop: one outcome on both devices and in the log', async () => {
    const { T, L, B, b } = await pairWithCopy(0x65)
    const g = await founded(B)
    await invited([T, L, B], B, g, b.id)
    const [pt, pl] = [await invitePrompt(T, g), await invitePrompt(L, g)]
    if (!pt || !pl) return red(`card: phone ${!!pt}, laptop ${!!pl}`)
    const t = ok(await T.h.decide(pt.id, 'accept', opts(tick())))
    const l = ok(await L.h.decide(pl.id, 'decline', opts(tick())))
    await route([T, L, B], [...t.outbound, ...l.outbound])
    const ph = [await phaseOf(T, g), await phaseOf(L, g)]
    return ph[0] === ph[1] ? green : red(`phase: phone ${ph[0]}, laptop ${ph[1]}`)
  }],
  M4: ['A founds G on the phone and invites B from the laptop', async () => {
    const { T, L, B, a } = await pairWithCopy(0x67)
    const g = await founded(T)
    await route([T, L, B], [])
    const inv = await L.h.invite(g, a.id, opts(tick()))
    return inv.ok ? green : red('the laptop cannot invite: ' + inv.code)
  }],
  M5: ['apart: the phone invites C, the laptop leaves G: one outcome, A is not half a member', async () => {
    const T = await mk(0x69), B = await mk(0x6a), C = await mk(0x6b)
    await met(T, B, tick())
    const { a: c } = await met(T, C, tick())
    const g = await founded(T)
    const L = await copyOf(T)
    const inv = ok(await T.h.invite(g, c.id, opts(tick())))
    const left = ok(await L.h.leaveGroup(g, opts(tick())))
    await route([T, L, B, C], [...inv.outbound, ...left.outbound])
    const ph = [await phaseOf(T, g), await phaseOf(L, g)]
    return ph[0] === ph[1] ? green : red(`phase: phone ${ph[0]}, laptop ${ph[1]}`)
  }],
  M6: ['A leaves G on the phone: the laptop shows G as left', async () => {
    const T = await mk(0x6c)
    const g = await founded(T)
    const L = await copyOf(T)
    await route([T, L], ok(await T.h.leaveGroup(g, opts(tick()))).outbound)
    const ph = [await phaseOf(T, g), await phaseOf(L, g)]
    return ph[0] === 'left' && ph[1] === 'left' ? green : red(`phase: phone ${ph[0]}, laptop ${ph[1]}`)
  }],
  M7: ['A adds the laptop while a member of G: the laptop has G with its members and their provenance', async () => {
    const T = await mk(0x6e)
    const g = await founded(T)
    ok(await T.h.addDevice('laptop', opts(tick())))
    const L = await fromSeed(T)
    return (await phaseOf(L, g)) === 'member' ? green : red('the laptop does not hold G')
  }],
  M8: ['A removes the lost phone: A stays a member, the phone reads nothing new from G', async () => {
    const T = await mk(0x71), B = await mk(0x72), C = await mk(0x73)
    ok(await T.h.addDevice('phone', opts(tick())))
    const { a: tb } = await met(T, B, tick())
    const { a: bc } = await met(B, C, tick())
    const g = await founded(T)
    await invited([T, B], T, g, tb.id)
    await route([T, B], ok(await B.h.decide((await invitePrompt(B, g)).id, 'accept', opts(tick()))).outbound)
    const L = await copyOf(T)
    ok(await L.h.revokeDevice('phone', opts(tick())))
    await invited([T, L, B, C], B, g, bc.id)
    await route([T, L, B, C], ok(await C.h.decide((await invitePrompt(C, g)).id, 'accept', opts(tick()))).outbound)
    const n = (await T.h.groups()).find((x) => x.id === g).members.length
    if ((await phaseOf(L, g)) !== 'member') return red('the laptop is no member')
    return n === 2 ? green : red(`the removed phone reads the new member (${n} members)`)
  }],

  // ---- what others learn
  S1: ['others can tell that A has several devices, cannot link them across relationships, and see no device list', async () =>
    inexpressible('a device has no identity on the wire: every device of a seed presents the same keys')],
}

// The baseline. A build step that moves a row changes it here.
const EXPECTED = {
  G1: 'red', G2: 'red', G3: 'red', G4: 'red', G5: 'red', G6: 'red',
  K1: 'red', K2: 'red', K3: 'red', K4: 'red', K5: 'red', K6: 'red',
  P1: 'red', P2: 'red', P3: 'inexpressible',
  N1: 'green', N2: 'inexpressible', N3: 'red',
  M1: 'green', M2: 'red', M3: 'red', M4: 'red', M5: 'red', M6: 'red', M7: 'red', M8: 'red',
  S1: 'inexpressible',
}

test('multi-device baseline: the standing of every everyday scenario is the pinned one', async (t) => {
  const got = {}
  for (const [id, [title, run]] of Object.entries(SCENARIOS)) {
    let r
    try { r = await run() } catch (e) { r = red('threw: ' + String(e?.message ?? e).slice(0, 160)) }
    got[id] = r.status
    t.diagnostic(`${id} ${r.status.padEnd(13)} ${title}${r.note ? ' — ' + r.note : ''}`)
  }
  assert.deepEqual(got, EXPECTED)
})
