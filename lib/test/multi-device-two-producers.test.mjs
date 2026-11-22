#!/usr/bin/env node
// multi-device-two-producers: what a counterpart does when two devices of
// one person each produce a document for the same cause. The library is
// built for one writer per holder; this table records, per document type,
// how the counterpart judges the phone's document and the laptop's.
//
// Each scenario brings the phone (T) and the laptop (L, a copy of T's
// store over the same seed) to a point where both will produce, lets
// everything settle, and reports for every document type that reached the
// counterpart B what B answered to the phone's and to the laptop's. The
// laptop's clock runs 13 seconds late, and the phone's documents are
// handed over first.
//
// EXPECTED pins the table. It is a measurement of today's library, not a
// requirement: a row moves when a rule for that kind of answer is built,
// and the pin moves with it. A scenario that throws fails the test.
//
// Introductions (Trust §8) are out of scope.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { InMemoryStore } from '../dist/testing.js'
import { T0, ev, opts, met, person } from './holder-fixture.mjs'

let clock = T0 + 5_000_000
const tick = (n = 10_000) => (clock += n)
const LATE = 13_000
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r }
const short = (type) => type.slice(type.lastIndexOf('/spec/') + 6)

async function mk (fill) {
  const P = { ...(await person(fill)), fill }
  ok(await P.h.foundPersonalCommunity({ name: 'P' + fill }, opts(tick())))
  return P
}
async function copyOf (P) {
  const store = new InMemoryStore()
  await store.commit(null, (await P.store.read()).state)
  return { ...(await person(P.fill, { store })), fill: P.fill, late: LATE }
}
const verdict = (got) => got.disposition + (got.reason ? ' ' + got.reason : '') + (got.ref ? ' ' + got.ref : '')

/** Delivers `first` (each `{o, from}`) and all it causes to every device
 *  holding the address, and records what `B` answered to the documents of
 *  `T` and of `L`, by type. */
async function settle ({ T, L, B, others = [] }, first, table = {}, { rounds = 14 } = {}) {
  const people = [T, L, B, ...others]
  let out = [...first]
  for (let r = 0; r < rounds; r++) {
    const when = tick()
    for (const p of people) for (const o of (await p.h.resume(when + (p.late ?? 0))).outbound) out.push({ o, from: p })
    if (!out.length) break
    while (out.length) {
      const { o, from } = out.shift()
      for (const to of people) {
        if (to === from || !Object.hasOwn((await to.read()).addresses.keys, o.envelope.rkid)) continue
        const got = await to.h.receive(o.envelope, when + (to.late ?? 0))
        if (to === B && (from === T || from === L)) {
          const row = (table[short(o.type)] ??= { phone: new Set(), laptop: new Set() })
          row[from === T ? 'phone' : 'laptop'].add(verdict(got))
        }
        if (got.disposition === 'unique' || got.disposition === 'duplicate-known') for (const x of got.outbound) out.push({ o: x, from: to })
      }
    }
  }
  return table
}
/** The table of a scenario, one line per document type. */
function rows (table) {
  const side = (set) => set.size ? [...set].sort().join(' / ') : 'none sent'
  return Object.fromEntries(Object.entries(table).sort().map(([t, r]) => [t, `phone: ${side(r.phone)} | laptop: ${side(r.laptop)}`]))
}
const from = (P, r) => r.outbound.map((o) => ({ o, from: P }))
const founded = async (P) => ev(ok(await P.h.foundGroup({ name: 'Garden' }, opts(tick()))), 'group.founded')[0].groupId
const invitePrompt = async (P, g) => (await P.h.prompts()).find((p) => p.kind === 'group-invite' && p.groupId === g)
async function pair (f) {
  const T = await mk(f), B = await mk(f + 1)
  const { a, b } = await met(T, B, tick())
  return { T, B, a, b }
}

const SCENARIOS = {
  'trust given on the phone, the laptop holds the same state': async () => {
    const { T, B, a } = await pair(0x21)
    const r = ok(await T.h.trust(a.id, opts(tick())))
    const L = await copyOf(T)
    return rows(await settle({ T, L, B }, from(T, r)))
  },
  'trust given apart on both': async () => {
    const { T, B, a } = await pair(0x23)
    const L = await copyOf(T)
    return rows(await settle({ T, L, B }, [...from(T, ok(await T.h.trust(a.id, opts(tick())))), ...from(L, ok(await L.h.trust(a.id, opts(tick()))))]))
  },
  'B trusts A, both devices answer': async () => {
    const { T, B, b } = await pair(0x25)
    const L = await copyOf(T)
    return rows(await settle({ T, L, B }, from(B, ok(await B.h.trust(b.id, opts(tick()))))))
  },
  'the same profile set apart on both': async () => {
    const { T, B, a } = await pair(0x27)
    await settle({ T, L: T, B }, from(T, ok(await T.h.setClass(a.id, 'profile', 'on', opts(tick())))))
    const L = await copyOf(T)
    return rows(await settle({ T, L, B }, [...from(T, ok(await T.h.setProfile({ name: 'Ada' }, opts(tick())))), ...from(L, ok(await L.h.setProfile({ name: 'Ada' }, opts(tick()))))]))
  },
  'different profiles set apart on both': async () => {
    const { T, B, a } = await pair(0x29)
    await settle({ T, L: T, B }, from(T, ok(await T.h.setClass(a.id, 'profile', 'on', opts(tick())))))
    const L = await copyOf(T)
    return rows(await settle({ T, L, B }, [...from(T, ok(await T.h.setProfile({ name: 'Ada' }, opts(tick())))), ...from(L, ok(await L.h.setProfile({ name: 'Ada L.' }, opts(tick()))))]))
  },
  'B writes a message, both devices acknowledge': async () => {
    const { T, B, b } = await pair(0x2b)
    const L = await copyOf(T)
    return rows(await settle({ T, L, B }, from(B, ok(await B.h.sendMessage(b.id, 'hello', opts(tick()))))))
  },
  'B invites A, both devices answer the prelude, the phone accepts': async () => {
    const { T, B, b } = await pair(0x2d)
    const g = await founded(B)
    const L = await copyOf(T)
    const t = await settle({ T, L, B }, from(B, ok(await B.h.invite(g, b.id, opts(tick())))))
    const p = await invitePrompt(T, g)
    assert.ok(p, 'the phone holds the invitation')
    return rows(await settle({ T, L, B }, from(T, ok(await T.h.decide(p.id, 'accept', opts(tick())))), t))
  },
  'B invites A, both devices accept apart': async () => {
    const { T, B, b } = await pair(0x2f)
    const g = await founded(B)
    const L = await copyOf(T)
    const t = await settle({ T, L, B }, from(B, ok(await B.h.invite(g, b.id, opts(tick())))))
    const [pt, pl] = [await invitePrompt(T, g), await invitePrompt(L, g)]
    assert.ok(pt && pl, 'both devices hold the invitation')
    return rows(await settle({ T, L, B }, [...from(T, ok(await T.h.decide(pt.id, 'accept', opts(tick())))), ...from(L, ok(await L.h.decide(pl.id, 'accept', opts(tick()))))], t))
  },
  'A invited B on the phone, both devices take the answers': async () => {
    const { T, B, a } = await pair(0x31)
    const g = await founded(T)
    const inv = ok(await T.h.invite(g, a.id, opts(tick())))
    const L = await copyOf(T)
    const t = await settle({ T, L, B }, from(T, inv))
    // each device issued an invitation of its own: B answers every one it holds
    const ps = (await B.h.prompts()).filter((p) => p.kind === 'group-invite' && p.groupId === g)
    assert.ok(ps.length, 'B holds an invitation')
    for (const p of ps) {
      const d = await B.h.decide(p.id, 'accept', opts(tick()))
      if (d.ok) await settle({ T, L, B }, from(B, d), t)
    }
    // which invitation B answers first is not fixed (prompt ids are random),
    // and the device that issued it serves B's first request for the log
    const out = rows(t)
    const page = t['x-access-page/0.1']
    if (page && page.phone.size + page.laptop.size === 1) out['x-access-page/0.1'] = 'the device whose invitation was answered first: ' + [...page.phone, ...page.laptop][0] + ' | the other: none sent'
    return { ...out, 'invitations B holds': String(ps.length) }
  },
  'B asks the group log of a group A founded, both devices answer': async () => {
    const { T, B, a } = await pair(0x33)
    const g = await founded(T)
    await settle({ T, L: T, B }, from(T, ok(await T.h.invite(g, a.id, opts(tick())))))
    await settle({ T, L: T, B }, from(B, ok(await B.h.decide((await invitePrompt(B, g)).id, 'accept', opts(tick())))))
    const L = await copyOf(T)
    return rows(await settle({ T, L, B }, from(B, ok(await B.h.syncGroups({ when: tick(), groupId: g })))))
  },
  'A showed a card on the phone, B scans it, both devices confirm': async () => {
    const T = await mk(0x35), B = await mk(0x36)
    const shown = ok(await T.h.show(opts(tick(), { name: 'Al' })))
    const L = await copyOf(T)
    const sc = ok(await B.h.scan(ev(shown, 'encounter.shown')[0].card, opts(tick(), { name: 'Bea' })))
    const t = await settle({ T, L, B }, from(B, sc))
    const [pt, pl] = [T, L].map(async (P) => (await P.h.prompts()).find((p) => p.kind === 'encounter-confirm'))
    const acts = []
    for (const [P, pp] of [[T, await pt], [L, await pl]]) if (pp) acts.push(...from(P, ok(await P.h.decide(pp.id, 'accept', opts(tick())))))
    return rows(await settle({ T, L, B }, acts, t))
  },
}

const EXPECTED = {
  'trust given on the phone, the laptop holds the same state': {
    'anchor-mapping/0.3': 'phone: unique | laptop: failed validation-failed RLTP-TRU-6270',
    'delivery-ack/0.1': 'phone: duplicate-known / unique | laptop: duplicate-known / unique',
  },
  'trust given apart on both': {
    'anchor-mapping/0.3': 'phone: unique | laptop: failed validation-failed RLTP-TRU-6270',
    'delivery-ack/0.1': 'phone: duplicate-known / unique | laptop: duplicate-known / unique',
  },
  'B trusts A, both devices answer': {
    'delivery-ack/0.1': 'phone: duplicate-known / unique | laptop: duplicate-known / unique',
    'star/0.2': 'phone: unique | laptop: failed validation-failed RLTP-TRU-5150',
  },
  'the same profile set apart on both': {
    'delivery-ack/0.1': 'phone: duplicate-known | laptop: duplicate-known',
    'profile/0.1': 'phone: unique | laptop: unique',
  },
  'different profiles set apart on both': {
    'delivery-ack/0.1': 'phone: duplicate-known | laptop: duplicate-known',
    'profile/0.1': 'phone: unique | laptop: failed validation-failed RLTP-TRU-6270',
  },
  'B writes a message, both devices acknowledge': {
    'delivery-ack/0.1': 'phone: duplicate-known / unique | laptop: duplicate-known / unique',
  },
  'B invites A, both devices answer the prelude, the phone accepts': {
    'delivery-ack/0.1': 'phone: duplicate-known / unique | laptop: duplicate-known / unique',
    'group-star/0.1': 'phone: unique | laptop: none sent',
    'membership-accept/0.2': 'phone: unique | laptop: none sent',
    'membership-prelude-reply/0.1': 'phone: unique | laptop: failed validation-failed RLTP-MT-3965',
    'x-access-sync/0.1': 'phone: unique | laptop: none sent',
  },
  'B invites A, both devices accept apart': {
    'delivery-ack/0.1': 'phone: duplicate-known / unique | laptop: duplicate-known / unique',
    'group-star/0.1': 'phone: unique | laptop: none sent',
    'membership-accept/0.2': 'phone: unique | laptop: failed validation-failed RLTP-MT-3270',
    'membership-prelude-reply/0.1': 'phone: unique | laptop: failed validation-failed RLTP-MT-3965',
    'x-access-sync/0.1': 'phone: unique | laptop: none sent',
  },
  'A invited B on the phone, both devices take the answers': {
    'delivery-ack/0.1': 'phone: duplicate-known / unique | laptop: duplicate-known / unique',
    'group-star/0.1': 'phone: unique | laptop: failed validation-failed RLTP-TRU-5150',
    'membership-invite/0.2': 'phone: unique | laptop: unique',
    'membership-prelude-request/0.1': 'phone: unique | laptop: none sent',
    'x-access-page/0.1': 'the device whose invitation was answered first: unique | the other: none sent',
    'x-membership-welcome/0.1': 'phone: unique | laptop: unique',
    'invitations B holds': '2',
  },
  'B asks the group log of a group A founded, both devices answer': {
    'delivery-ack/0.1': 'phone: duplicate-known / unique | laptop: duplicate-known / unique',
    'x-access-page/0.1': 'phone: unique | laptop: failed validation-failed',
  },
  'A showed a card on the phone, B scans it, both devices confirm': {
    'continuity-probe/0.1': 'phone: unique | laptop: failed validation-failed RLTP-TRU-6700 / unique',
    'delivery-ack/0.1': 'phone: duplicate-known / unique | laptop: duplicate-known / unique',
    'encounter-credential-delivery/0.1': 'phone: unique | laptop: unique',
    'group-star/0.1': 'phone: unique | laptop: failed validation-failed RLTP-TRU-5150',
    'star/0.2': 'phone: unique | laptop: failed validation-failed RLTP-TRU-5150',
  },
}

test('two producers: what the counterpart answers to the phone\'s and the laptop\'s document, by type', async (t) => {
  const got = {}
  for (const [name, run] of Object.entries(SCENARIOS)) {
    try { got[name] = await run() } catch (e) { e.message = `${name}: ${e.message}`; throw e }
    for (const [type, row] of Object.entries(got[name])) t.diagnostic(`${name} | ${type} | ${row}`)
  }
  assert.deepEqual(got, EXPECTED)
})
