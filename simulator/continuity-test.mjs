#!/usr/bin/env node
// continuity-test — Trust §6a on the holder: a re-verification (a second
// ceremony of the same two people) and an introduction duplicate are
// recognised through the probe and the continuity mapping and CHAINED
// instead of duplicated; whoever cannot answer the probe is honestly a new
// relationship. The probes and mappings are the holders' own duties: they
// go out on resume, as an app's timer would call it.
import { createPerson, createNetwork, meet, at, decideAll, contactNamed, labeledContext, ecdh, xRawOfMk, seal, iso, TYPES } from './holder.mjs'
import { assembleContinuityMapping, isRecordSide } from './lib/continuity.js'

let pass = 0, fail = 0
const check = (c, m) => { if (c) { pass++; console.log(`  ok    ${m}`) } else { fail++; console.error(`  FAIL  ${m}`) } }
const T0 = Date.parse('2026-08-28T10:00:00Z')
const MIN = 60_000
const named = (p, name) => p.view.contacts.filter((c) => c.displayName === name)
// relationships by creation (the state's records are keyed by id, not ordered)
const tuples = (p) => Object.values(p.view.state.relationships).sort((x, y) => x.provenance.at - y.provenance.at).flatMap((r) => r.tuples)
const people = async (...names) => Promise.all(names.map((n) => createPerson(n, { when: T0 })))
async function introduce (net, m, r, t, label, when) {
  const a = await m.h.introduce(contactNamed(m.view.contacts, r.name).id, contactNamed(m.view.contacts, t.name).id, at(when, { label }))
  await net.send(m, a.outbound, when)
  await decideAll(net, r, 'introduction', 'accept', when + 1000)
  await decideAll(net, t, 'introduction', 'accept', when + 2000)
}

// ── 1. re-verification: a second ceremony of the same two people ────────
{
  const [a, b] = await people('Anton', 'Berta')
  const net = createNetwork([a, b])
  await meet(net, a, b, T0)
  await meet(net, a, b, T0 + MIN, { settle: false })   // they meet again: a fresh tuple, as the spec demands
  check(a.view.contacts.length === 2 && b.view.contacts.length === 2, 'before the probe: honestly two contacts (fresh-always, Encounter 4.4)')
  const w = net.wire.length
  await net.settle(T0 + 2 * MIN)
  check(net.wire.slice(w).some((x) => x.type === TYPES.probe) && net.wire.slice(w).some((x) => x.type === TYPES.continuityMapping), 'the probes cross, the record side answers with a continuity mapping')
  check(a.view.contacts.length === 1 && b.view.contacts.length === 1, 'after probe + mapping: ONE contact on each side')
  const [hA] = a.view.contacts, [hB] = b.view.contacts
  check(hA.relationships.length === 1 && hA.relationships[0].tuples === 2 && hB.relationships[0].tuples === 2, 'the relationship\'s chain holds both enactments — evidence accumulates')
  check(hA.verification === 'mutual' && hA.relationships[0].chainedFrom.length === 1, 'the fresh relationship is chained into the old one; the contact stays mutual')
  const rel = a.view.state.relationships[hA.relationships[0].id]
  check(rel.tuples.filter((t) => t.deactivated).length === 1 && rel.activeHead === rel.tuples.find((t) => !t.deactivated).ownPairLabel, 'the old tuple is deactivated; the active head is the FRESH one (one relationship, one head)')
  await net.settle(T0 + 3 * MIN)
  check(a.view.contacts.length + b.view.contacts.length === 2, 'repetition: idempotent, no double chain')
}

// ── 2. the introduction duplicate (Anton's screenshot case) ─────────────
{
  const [j, a, e] = await people('Jonathan', 'Anton', 'Emil')
  const net = createNetwork([j, a, e])
  await meet(net, a, j, T0)
  await meet(net, e, j, T0 + MIN)
  await meet(net, a, e, T0 + 2 * MIN)      // Anton and Emil know each other ALREADY
  await introduce(net, j, a, e, 'Emil', T0 + 10 * MIN)
  for (const p of [a, e]) await p.refresh()
  check(named(a, 'Emil').length === 2, 'after the introduction, before the probe: the duplicate exists (two Emils at Anton)')
  await net.settle(T0 + 11 * MIN)
  check(named(a, 'Emil').length === 1 && named(e, 'Anton').length === 1, 'the probe recognises the existing relationship: the duplicate is chained, NO second Emil')
  const em = named(a, 'Emil')[0]
  check(em.provenance === 'ceremony' && em.verification === 'mutual', 'evidence accumulates: the contact stays met and mutually verified; the introduction is a link of its chain')
  check(em.relationships[0].chainedFrom.length === 1, 'the introduced relationship is a husk chained into the met one')
}

// ── 3. no match = honestly a new relationship (a name is not an identity)
{
  const [m, a, e1, e2] = await people('Mira', 'Anton', 'Emil', 'Emil')
  const net = createNetwork([m, a, e1, e2])
  await meet(net, a, m, T0)
  await meet(net, e2, m, T0 + MIN)
  await meet(net, a, e1, T0 + 2 * MIN)     // Anton knows the FIRST Emil
  const a1 = await m.h.introduce(contactNamed(m.view.contacts, 'Anton').id, m.view.contacts.find((c) => c.displayName === 'Emil').id, at(T0 + 10 * MIN, { label: 'Emil' }))   // Mira means the SECOND
  await net.send(m, a1.outbound, T0 + 10 * MIN)
  await decideAll(net, a, 'introduction', 'accept', T0 + 10 * MIN + 1000)
  await decideAll(net, e2, 'introduction', 'accept', T0 + 10 * MIN + 2000)
  await net.settle(T0 + 11 * MIN)
  check(named(a, 'Emil').length === 2, 'another person, the same name: no match — honestly TWO Emils (names are words)')
}

// ── 4. mapping negatives: every check at its point ──────────────────────
{
  const [a, b] = await people('Anton', 'Berta')
  const net = createNetwork([a, b])
  await meet(net, a, b, T0)
  await meet(net, a, b, T0 + MIN, { settle: false })
  // the fresh tuples and the old ones, on both sides
  const fresh = (p) => tuples(p).at(-1), old = (p) => tuples(p)[0]
  const aNew = fresh(a), bNew = fresh(b), aOld = old(a), bOld = old(b)
  // the record side issues the choice; it crafts the mappings here: prior
  // is its own anchor of the old relationship, next its fresh one
  const [R, N, rNew, rOld] = isRecordSide(bNew.counterpartAnchor, aNew.counterpartAnchor) ? [a, b, aNew, aOld] : [b, a, bNew, bOld]
  const own = await labeledContext(R.seed, rNew.ownPairLabel), ownOld = await labeledContext(R.seed, rOld.ownPairLabel)
  const shNew = await ecdh(own.x.priv, xRawOfMk(rNew.counterpartKeyAgreement))
  const shOld = await ecdh(ownOld.x.priv, xRawOfMk(rOld.counterpartKeyAgreement))
  const send = async (prior, k1, k2, when) => {
    const body = { type: 'continuity-mapping@1', prior, next: own.anchor, to: rNew.counterpartAnchor, revision: '1', issuedAt: iso(when) }
    const m = await assembleContinuityMapping(body, k1, k2)
    const doc = { id: crypto.randomUUID(), type: TYPES.continuityMapping, issuer: own.anchor, recipient: rNew.counterpartAnchor, threadId: crypto.randomUUID(), issuedAt: iso(when), payload: m }
    return N.h.receive(await seal(doc, rNew.counterpartKeyAgreement), when)
  }
  const self = await send(own.anchor, shNew, shNew, T0 + 2 * MIN)
  check(self.disposition === 'failed' && self.stage === 8 && self.ref === 'RLTP-TRU-6960', `the fresh tuple itself as prior: refused (${self.ref}) — never chained onto itself`)
  const wrongKey = await send(ownOld.anchor, shNew, shNew, T0 + 2 * MIN + 1000)
  check(wrongKey.disposition === 'failed' && wrongKey.stage === 8 && wrongKey.ref === 'RLTP-TRU-6970', `mac1 under the wrong key (the new relationship's instead of the old one's): refused (${wrongKey.ref}) — only the holder of BOTH relationships can make both MACs`)
  const right = await send(ownOld.anchor, shOld, shNew, T0 + 2 * MIN + 2000)
  check(right.disposition === 'unique', `the same body under both right keys is taken (${right.disposition} ${right.ref ?? ''})`)
  await N.refresh()
  check(N.view.contacts.length === 1, 'and the non-record side chains: one contact')
}

// ── 5. the continuity ascent: introduced first, then met ────────────────
{
  const [m, a, b] = await people('Mira', 'Anton', 'Berta')
  const net = createNetwork([m, a, b])
  await meet(net, a, m, T0)
  await meet(net, b, m, T0 + MIN)
  await introduce(net, m, a, b, 'Berta', T0 + 10 * MIN)
  await net.settle(T0 + 11 * MIN)
  check(named(a, 'Berta')[0]?.provenance === 'introduced' && named(a, 'Berta')[0].verification === 'met', 'the starting point: introduced (unverified)')
  await meet(net, a, b, T0 + 100 * MIN)      // the first REAL meeting
  const bs = named(a, 'Berta')
  check(bs.length === 1 && bs[0].verification === 'mutual' && bs[0].relationships[0].chainedFrom.length === 1, 'the first real meeting lifts it: one contact, now mutually verified, by the chain (chapter 2)')
  check(bs[0].provenance === 'introduced', 'the relationship\'s history begins at the introduction — how the person came stays')
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) { console.error('continuity: FAILED'); process.exit(1) }
console.log('continuity: §6a holds — a re-encounter is chained, strangers stay honestly strangers.')
