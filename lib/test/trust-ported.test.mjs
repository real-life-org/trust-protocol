#!/usr/bin/env node
// trust-ported — the regressions of the deleted probe-world suites
// (probe.test.mjs and the probe-world part of anchor.test.mjs, lib Stage
// 2 before PR 7b), ported onto the holder API: the merge/split/attack
// matrix of the convergence net (Trust 6a.1, Section 2) on a world of one
// holder B with several relationships toward the same person, the
// rotations over the log (Identity 5.4, Trust 6.3), and the probe's
// review regressions (seal failure, concurrency, stage order, malformed
// forms, continuity resends, introduction consent).
//
// Rule numbers: bare four-digit numbers are RLTP-TRU (trust-layer.md).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { digestBytes, communityContext, labeledContext, iso, ecdh, xRawOfMk, jcs } from '../dist/index.js'
import { bindingOf, signRaw, assembleAnchorMapping, makeAnchorRotation } from '../dist/anchor.js'
import { InMemoryStore, stateBuilder, commitViolations } from '../dist/testing.js'
import { createEngine, trustModule, contactView } from '../dist/internal.js'
import { T0, side, withCommunity, mappingEnvelope, craftMapping, read } from './pair-fixture.mjs'

const genesis = (n) => digestBytes(new Uint8Array(32).fill(n))
const MAX_BOUND = 10n ** 18n - 1n

// ── the world: B with four relationships toward C, one toward D ────────

/**
 * B holds r1…r4 toward four pair sides C[0]…C[3] of one person C (contacts
 * c1…c4) and rd toward D (contact cd). Stars are paused toward every
 * contact. `mapOn(i, opts, when)` delivers a mapping crafted by C[i] (or
 * by D for 'd') on its relationship; `gen(n)` is C's community Context
 * of generation n; `rot(a, b)` the honest rotation a → b.
 */
async function world ({ bound = MAX_BOUND, build = (b) => b } = {}) {
  const gC = await genesis(0x41), gD = await genesis(0x42), gB = await genesis(0x43)
  const C = []
  for (let i = 0; i < 4; i++) C.push(await withCommunity(await side(0x0b, 0x0c + i), gC))
  const D = await withCommunity(await side(0x0e, 0x1f), gD)
  const Bs = []
  for (let i = 0; i < 5; i++) Bs.push(await side(0x09, 0x21 + i))
  const B = await withCommunity(Bs[0], gB)
  const spec = (mine, theirs) => ({ ownPairLabel: mine.label, counterpartAnchor: theirs.anchor, counterpartKeyAgreement: theirs.keyAgreement, rkid: mine.keyAgreement })
  const b = stateBuilder({ at: T0 }).community(gB, '1')
  for (let i = 0; i < 4; i++) b.relationship(`r${i + 1}`, { contactId: `c${i + 1}`, tuples: [spec(Bs[i], C[i])] })
  b.relationship('rd', { contactId: 'cd', tuples: [spec(Bs[4], D)] })
  for (const c of ['c1', 'c2', 'c3', 'c4', 'cd']) b.settings(c, { star: 'off', groupStar: 'off' })
  const store = new InMemoryStore()
  await store.commit(null, build(b).build())
  const check = (before, after, op) => {
    const v = commitViolations(before, after, op)
    if (v.length) throw new Error('invariants: ' + v.map((x) => `[${x.invariant}] ${x.detail}`).join('; '))
  }
  const holder = await createEngine({ store, keys: B.keys }, [trustModule({ admissionBound: bound })], { check })
  const sideOf = (i) => (i === 'd' ? [D, Bs[4]] : [C[i], Bs[i]])
  const envOf = async (i, opts = {}) => { const [from, to] = sideOf(i); return (await mappingEnvelope(from, to, await craftMapping(from, to, opts))).envelope }
  const mapOn = async (i, opts = {}, when = T0) => holder.receive(await envOf(i, opts), when)
  /** deliver an already assembled artifact on C[i]'s relationship */
  const deliverOn = async (i, artifact, when = T0) => { const [from, to] = sideOf(i); return holder.receive((await mappingEnvelope(from, to, artifact)).envelope, when) }
  const gen = (n) => communityContext(C[0].seed, gC, n)
  const rot = async (a, b) => makeAnchorRotation(await gen(a), await gen(b), await gen(b + 1))
  const human = (cmd, input, id, when = T0) => holder.act(cmd, input, when, { actId: id })
  const s = () => read(store)
  return { B, Bs, C, D, store, holder, mapOn, envOf, deliverOn, gen, rot, human, s }
}

/** A rotation prev → next, signed by both, committing to `after`: with a
 *  copied key of prev it states another successor than the honest one. */
async function forge (prev, next, after) {
  const body = { type: 'anchor-rotation@2', prev: prev.anchor, next: next.anchor, commit: await bindingOf(after.anchor) }
  return { body, proof: { proofValue: await signRaw(prev, body), successorProofValue: await signRaw(next, body) } }
}

/** A community of another seed: the attacker's own generations. */
const otherGen = (n) => genesis(0x44).then((g) => communityContext(new Uint8Array(64).fill(0x5a), g, n))

/** An anchor-mapping@4 by C[i] for generation-1 self `g1` whose card binds
 *  it to `boundTo` (a copy under a binding of its own, 6605). */
async function copiedCard (w, i, g1, boundTo, { revision = '1', when = T0 } = {}) {
  const from = w.C[i], to = w.Bs[i]
  const cardBody = { type: 'self-card@2', anchor: g1.anchor, keyAgreement: g1.keyAgreement, commit: await bindingOf(boundTo.anchor) }
  const card = { body: cardBody, proof: { proofValue: await signRaw(g1, cardBody) } }
  const pair = await labeledContext(from.seed, from.label)
  const body = { type: 'anchor-mapping@4', pair: pair.anchor, self: g1.anchor, to: to.anchor, card, lineage: [], revision, issuedAt: iso(when) }
  return assembleAnchorMapping(body, await ecdh(pair.x.priv, xRawOfMk(to.keyAgreement)), await ecdh(g1.x.priv, xRawOfMk(to.keyAgreement)))
}

const merges = (s) => Object.values(s.duties).filter((d) => d.kind === 'merge').map((d) => d.entryIds)
const mergedEvents = (r) => r.events.filter((e) => e.type === 'contact.merged').map((e) => [e.contactId, e.merged])
const at = (r) => [r.disposition, r.reason, r.stage, r.ref]
const entryCount = (s) => Object.keys(s.contacts).filter((c) => s.contacts[c].pos !== null).length

// ── anchor.test: the convergence net, both arrival orders (§6a.1 rung 2) ──

test('trust (ported from anchor.test: the convergence net merges when the verified anchor sets meet, in both arrival orders)', async () => {
  // order 1: the old relationship holds generation 1 without lineage, a new one brings 2 with lineage 1 → 2
  const w = await world()
  const r12 = await w.rot(1, 2)
  const g2 = (await w.gen(2)).anchor
  assert.equal((await w.mapOn(0)).disposition, 'unique')
  assert.equal((await w.mapOn(1, { gen: 2, lineage: [r12] }, T0 + 1)).disposition, 'unique')
  assert.deepEqual(merges(await w.s()), [['c1', 'c2']], 'generation 1 is in the new mapping\'s verified set')
  assert.deepEqual(mergedEvents(await w.holder.resume(T0 + 2)), [['c1', ['c2']]])
  let s = await w.s()
  assert.deepEqual([entryCount(s), s.contacts.c1.anchorHead, s.contacts.c1.pos], [1, g2, '0'], 'the newest generation is the current anchor, the earlier position survives')
  // order 2: the relationship with the lineage first; a stale mapping under the superseded 1 does not merge
  const v = await world()
  await v.mapOn(0, { gen: 2, lineage: [r12] })
  await v.mapOn(1, { gen: 1 }, T0 + 1)
  s = await v.s()
  assert.deepEqual(merges(s), [], 'generation 1 is superseded on r1: no merge')
  assert.deepEqual([s.contacts.c1.anchorHead, s.contacts.c2.anchorHead], [g2, (await v.gen(1)).anchor], 'an older generation does not displace the current one')
  // r2 follows the rotation onto the head r1 holds: merged
  await v.mapOn(1, { gen: 2, lineage: [r12], revision: '2' }, T0 + 2)
  assert.deepEqual(merges(await v.s()), [['c1', 'c2']])
  assert.deepEqual(mergedEvents(await v.holder.resume(T0 + 3)), [['c1', ['c2']]])
  s = await v.s()
  assert.deepEqual([entryCount(s), s.contacts.c1.anchorHead], [1, g2])
})

test('trust (ported from anchor.test: the merge reaches the held head — self = the head merges, a lineage extending the head merges, another successor of a held anchor does not)', async () => {
  const holding = async () => {
    const w = await world()
    await w.mapOn(0, { gen: 2, lineage: [await w.rot(1, 2)] })   // c1 holds B = generation 2, reached through A → B
    return w
  }
  // self = B, the head c1 holds, with an empty lineage
  const a = await holding()
  await a.mapOn(1, { gen: 2 }, T0 + 1)
  assert.deepEqual(merges(await a.s()), [['c1', 'c2']], 'self equals the held head: merged')
  // self = C, lineage A → B → C against the held {A, B}: it extends the head B
  const b = await holding()
  await b.mapOn(1, { gen: 3, lineage: [await b.rot(1, 2), await b.rot(2, 3)] }, T0 + 1)
  assert.deepEqual(merges(await b.s()), [['c1', 'c2']], 'the lineage carries the head as a prev: merged')
  await b.holder.resume(T0 + 2)
  assert.equal((await b.s()).contacts.c1.anchorHead, (await b.gen(3)).anchor, 'the newest generation is the current anchor')
  // a successor of A other than B, co-signed with a copied key of A: the binding rule refuses the merge (6610, 6605)
  const c = await holding()
  const x1 = await otherGen(1), x2 = await otherGen(2)
  const fork = await forge(await c.gen(1), x1, x2)
  const r = await c.mapOn(1, { self: x1, nextGen: x2, lineage: [fork] }, T0 + 1)
  assert.equal(r.disposition, 'unique', 'on its own relationship the chain proves joint authorization only')
  const s = await c.s()
  assert.deepEqual(merges(s), [], 'A → B\' against A → B: no merge')
  assert.deepEqual([s.contacts.c1.anchorHead, s.contacts.c2.anchorHead], [(await c.gen(2)).anchor, x1.anchor], 'two members')
})

test('trust (ported from anchor.test: review 2 attack — a copied community key presents A → X on its own relationship; a recipient holding A → B does not merge, and with the bindings not even before the honest rotation arrives; the copier of the binding lags)', async () => {
  const x1 = await otherGen(1), x2 = await otherGen(2)
  // the victim's rotation reached the recipient first: it holds A → B on r1
  const w = await world()
  const forged = await forge(await w.gen(1), x1, x2)
  await w.mapOn(0, { gen: 2, lineage: [await w.rot(1, 2)] })
  assert.equal((await w.mapOn(1, { self: x1, nextGen: x2, lineage: [forged] }, T0 + 1)).disposition, 'unique')
  let s = await w.s()
  assert.deepEqual(merges(s), [], 'A → X against the held A → B: no merge (6605)')
  assert.equal(entryCount(s), 2)
  // before the honest rotation reaches the recipient, it holds A alone under the card's binding of A to B
  const v = await world()
  await v.mapOn(0, { gen: 1 })
  assert.deepEqual((await v.s()).relationships.r1.bindings[(await v.gen(1)).anchor], [await bindingOf((await v.gen(2)).anchor)])
  await v.mapOn(1, { self: x1, nextGen: x2, lineage: [forged] }, T0 + 1)
  s = await v.s()
  assert.deepEqual(merges(s), [], 'the binding rule refuses the merge before the honest rotation arrives')
  assert.equal(entryCount(s), 2)
  // the residue (6.5, §11): a copier that copied the holder's binding from a self card merges while the entry
  // stands at A, and lags once the rotation arrives
  await v.mapOn(2, { gen: 1 }, T0 + 2)
  assert.deepEqual(merges(await v.s()), [['c1', 'c3']], 'the copied binding passes the binding rule')
  await v.holder.resume(T0 + 3)
  await v.mapOn(0, { gen: 2, lineage: [await v.rot(1, 2)], revision: '2' }, T0 + 4)
  s = await v.s()
  assert.equal(s.contacts.c1.anchorHead, (await v.gen(2)).anchor, 'the entry follows the holder')
  assert.deepEqual(s.contacts.c1.relIds, ['r1', 'r3'])
  assert.equal(s.relationships.r3.heldCounterpartHead, (await v.gen(1)).anchor, 'the copier lags at the copied generation')
})

test('trust (ported from anchor.test: a changed self without a reachable lineage is refused at stage 9 (6170) on a merged relationship; the merged entry stays exactly as it was)', async () => {
  const w = await world()
  const r12 = await w.rot(1, 2)
  await w.mapOn(0)
  await w.mapOn(1, {}, T0 + 1)
  await w.holder.resume(T0 + 2)                                   // merged: c1 with alias c2
  await w.mapOn(1, { gen: 2, lineage: [r12], revision: '2' }, T0 + 3)
  await w.mapOn(0, { gen: 2, lineage: [r12], revision: '2' }, T0 + 4)   // r1 learns the rotation too
  const before = await w.s()
  assert.deepEqual([Object.keys(before.contacts).sort(), before.contacts.c1.relIds, before.contacts.c1.anchorHead], [['c1', 'c3', 'c4', 'cd'], ['r1', 'r2'], (await w.gen(2)).anchor])
  // r1 presents an unrelated anchor with no lineage (as after more than 64 missed rotations, 6400)
  const x1 = await otherGen(1)
  const r = await w.mapOn(0, { self: x1, nextGen: await otherGen(2), revision: '3' }, T0 + 5)
  assert.deepEqual(at(r), ['failed', 'validation-failed', 9, 'RLTP-TRU-6170'])
  assert.deepEqual(r.outbound ?? [], [], 'no ack')
  const after = await w.s()
  assert.equal(after.commitSeq, before.commitSeq, 'nothing commits')
  assert.equal(jcs(after.contacts), jcs(before.contacts), 'the merged entry stays as it was')
  assert.equal(jcs(after.relationships), jcs(before.relationships))
})

// ── review 4 and 5: the head rule is entry-wide (6540, 6550, 6590) ──

test('trust (ported from anchor.test: review 4 attack — a relationship refused under a superseded anchor does not join through a later update of the honest relationship that carries A as a prev)', async () => {
  const w = await world()
  const r12 = await w.rot(1, 2), r23 = await w.rot(2, 3)
  // step 1: the honest relationship, self = B (generation 2), lineage A → B
  assert.equal((await w.mapOn(0, { gen: 2, lineage: [r12] })).disposition, 'unique')
  // step 2: the attacker's relationship presents A (a copied key), no lineage: no merge duty
  const a = await w.mapOn(1, { gen: 1 }, T0 + 1)
  assert.equal(a.disposition, 'unique')
  assert.deepEqual(merges(await w.s()), [], 'A is superseded in c1')
  // step 3: the honest relationship rotates on, self = C, lineage A → B → C: it carries A as a prev
  const h = await w.mapOn(0, { gen: 3, lineage: [r12, r23], revision: '2' }, T0 + 2)
  assert.equal(h.disposition, 'unique')
  const s = await w.s()
  assert.deepEqual(merges(s), [], 'A is superseded in the entry\'s knowledge: still no merge duty')
  assert.deepEqual([s.contacts.c1.anchorHead, s.contacts.c1.relIds, s.contacts.c1.pos], [(await w.gen(3)).anchor, ['r1'], '0'], 'the honest relationship stays in place')
  assert.deepEqual([s.contacts.c2.relIds, s.contacts.c2.anchorHead], [['r2'], (await w.gen(1)).anchor], 'c2 stays separate')
  assert.deepEqual(mergedEvents(await w.holder.resume(T0 + 3)), [])
  assert.equal(contactView(await w.s(), 'c2').id, 'c2')
})

test('trust (ported from anchor.test: review 4 — two merged relationships hold different heads; a newly presented superseded head does not merge, the current head does)', async () => {
  const w = await world()
  const r12 = await w.rot(1, 2)
  await w.mapOn(0)
  await w.mapOn(1, {}, T0 + 1)
  assert.deepEqual(mergedEvents(await w.holder.resume(T0 + 2)), [['c1', ['c2']]], 'merged at generation 1')
  // r2 rotates A → B; r1 still holds A as its own head
  await w.mapOn(1, { gen: 2, lineage: [r12], revision: '2' }, T0 + 3)
  let s = await w.s()
  assert.deepEqual([s.contacts.c1.anchorHead, s.relationships.r1.heldCounterpartHead], [(await w.gen(2)).anchor, (await w.gen(1)).anchor], 'the entry\'s head is B, r1 holds A')
  // a third side presents A with an empty lineage: it equals r1's head, but A is superseded in the entry
  assert.equal((await w.mapOn(2, { gen: 1 }, T0 + 4)).disposition, 'unique')
  s = await w.s()
  assert.deepEqual(merges(s), [], 'no merge through the lagging relationship')
  assert.deepEqual(mergedEvents(await w.holder.resume(T0 + 5)), [])
  assert.deepEqual([(await w.s()).contacts.c3.relIds, (await w.s()).contacts.c1.relIds], [['r3'], ['r1', 'r2']])
  // the same relationship presents the current head B itself: it joins
  await w.mapOn(2, { gen: 2, lineage: [r12], revision: '2' }, T0 + 6)
  assert.deepEqual(merges(await w.s()), [['c1', 'c3']])
  assert.deepEqual(mergedEvents(await w.holder.resume(T0 + 7)), [['c1', ['c3']]], 'a current head merges')
  s = await w.s()
  assert.deepEqual([s.contacts.c1.relIds.sort(), s.contacts.c1.anchorHead], [['r1', 'r2', 'r3'], (await w.gen(2)).anchor])
})

test('trust (ported from anchor.test: review 5 M2 — a lagging relationship of a merged entry is no evidence for a merge: its head is superseded in its own entry)', async () => {
  const w = await world()
  const r12 = await w.rot(1, 2)
  await w.mapOn(0)
  await w.mapOn(1, {}, T0 + 1)
  await w.holder.resume(T0 + 2)
  await w.mapOn(1, { gen: 2, lineage: [r12], revision: '2' }, T0 + 3)
  // the copy presents A: refused as a merge (A is superseded in c1)
  await w.mapOn(2, { gen: 1 }, T0 + 4)
  assert.deepEqual(merges(await w.s()), [])
  // r1, still holding A, receives a re-issue under A (a higher revision, unchanged self): it must not pull c3 in
  const r = await w.mapOn(0, { gen: 1, revision: '2' }, T0 + 5)
  assert.equal(r.disposition, 'unique')
  const s = await w.s()
  assert.deepEqual(merges(s), [], 'no merge duty through the lagging r1')
  assert.deepEqual(mergedEvents(await w.holder.resume(T0 + 6)), [])
  assert.deepEqual([s.contacts.c1.relIds, s.contacts.c3.relIds, s.contacts.c1.anchorHead], [['r1', 'r2'], ['r3'], (await w.gen(2)).anchor])
})

// Open point for Trust 0.32: 6540/6580/6590 in the rotation direction;
// today's behaviour is pinned, not justified normatively. The probe merged
// here; the holder does not: in the 6580 direction head rule (b) runs on
// the other entry's current links (r2's own 2 → 3 marks E's new head 2 as
// superseded), while the incoming direction reads the links held before
// the verification (the 6590 rationale), so whether such relationships
// merge depends on the direction the head moved.
test('trust (ported from anchor.test: review 4 — the other direction): r1 rotating up to a head r2\'s lineage extends opens no merge in the 6580 direction under today\'s reading — open point for Trust 0.32, pinned, not justified normatively', async () => {
  const w = await world()
  const r12 = await w.rot(1, 2), r23 = await w.rot(2, 3)
  // r2 stands at generation 3 with only 2 → 3 carried; r1 holds 1: nothing links them yet
  await w.mapOn(0)
  await w.mapOn(1, { gen: 3, lineage: [r23] }, T0 + 1)
  assert.deepEqual(merges(await w.s()), [])
  // r1 rotates 1 → 2: r2's entry holds 2 as superseded (its own link 2 → 3), so no merge duty
  assert.equal((await w.mapOn(0, { gen: 2, lineage: [r12], revision: '2' }, T0 + 2)).disposition, 'unique')
  assert.deepEqual(merges(await w.s()), [])
  assert.deepEqual(mergedEvents(await w.holder.resume(T0 + 3)), [])
  const s = await w.s()
  assert.deepEqual([entryCount(s), s.contacts.c1.anchorHead, s.contacts.c2.anchorHead], [2, (await w.gen(2)).anchor, (await w.gen(3)).anchor], 'two entries, each at its head')
})

test('trust (ported from anchor.test: review 4 — a higher revision with an unchanged self on a merged relationship stays in place: no split, position and admission unchanged)', async () => {
  const w = await world({ bound: 1n })                // a wrong split would show as pending
  const r12 = await w.rot(1, 2)
  await w.mapOn(0)
  await w.mapOn(1, {}, T0 + 1)
  await w.holder.resume(T0 + 2)
  await w.mapOn(1, { gen: 2, lineage: [r12], revision: '2' }, T0 + 3)
  const before = await w.s()
  // r1 receives a higher revision with unchanged self = A
  const r = await w.mapOn(0, { gen: 1, revision: '2' }, T0 + 4)
  assert.equal(r.disposition, 'unique')
  assert.deepEqual(r.events.map((e) => e.type), ['contact.verified'], 'no split, no entry commit')
  const s = await w.s()
  assert.deepEqual(merges(s), [])
  assert.equal(jcs(s.contacts), jcs(before.contacts), 'position, status, relationships and head unchanged')
  assert.deepEqual([s.contacts.c1.pos, s.contacts.c1.status, s.contacts.c1.relIds, s.contacts.c1.anchorHead], ['0', 'admitted', ['r1', 'r2'], (await w.gen(2)).anchor])
  assert.equal(Object.values(s.contacts).filter((c) => c.status === 'admitted').length, 1)
  assert.deepEqual([s.relationships.r1.heldCounterpartHead, s.relationships.r1.tuples[0].mappingIn.rev], [(await w.gen(1)).anchor, '2'], 'r1 still holds A, now under revision 2')
})

for (const order of [['r1', 'r2'], ['r2', 'r1']]) {
  test(`trust (ported from anchor.test: two successors of one anchor never share an entry (${order.join(' then ')}) — the copied successor is refused on its relationship at 4b (6118), the entry keeps one anchor head; a later B joins it)`, async () => {
    const w = await world()
    const x1 = await otherGen(1), x2 = await otherGen(2)
    const ab = await w.rot(1, 2)
    const ax = await forge(await w.gen(1), x1, x2)
    await w.mapOn(0)
    await w.mapOn(1, {}, T0 + 1)
    await w.holder.resume(T0 + 2)                     // merged under A
    const steps = {
      r1: () => w.mapOn(0, { gen: 2, lineage: [ab], revision: '2' }, T0 + 3),
      r2: () => w.mapOn(1, { self: x1, nextGen: x2, lineage: [ax], revision: '2' }, T0 + 3),
    }
    const out = {}
    for (const k of order) {
      const before = await w.s()
      out[k] = await steps[k]()
      if (k === 'r2') {
        assert.deepEqual(at(out.r2), ['failed', 'validation-failed', 8, 'RLTP-TRU-6118'], 'A → X beside the binding of A that r2 holds (6610, 6118)')
        assert.equal((await w.s()).commitSeq, before.commitSeq, 'nothing commits')
      }
    }
    assert.equal(out.r1.disposition, 'unique', 'the honest rotation stays in place')
    let s = await w.s()
    assert.deepEqual([s.contacts.c1.relIds, s.contacts.c1.anchorHead, entryCount(s)], [['r1', 'r2'], (await w.gen(2)).anchor, 1], 'one entry, one anchor head')
    assert.equal(s.relationships.r2.heldCounterpartHead, (await w.gen(1)).anchor, 'r2 keeps A')
    // a new relationship presenting B with an empty lineage joins the entry whose head is B
    await w.mapOn(2, { gen: 2 }, T0 + 4)
    assert.deepEqual(merges(await w.s()), [['c1', 'c3']])
    await w.holder.resume(T0 + 5)
    s = await w.s()
    assert.deepEqual(s.contacts.c1.relIds.sort(), ['r1', 'r2', 'r3'])
  })
}

test('trust (ported from anchor.test: review 5 M2 — a rotation on a relationship with its own entry merges where its new head extends another entry; the earliest position survives)', async () => {
  const w = await world()
  await w.mapOn(0, { gen: 1 })
  await w.mapOn(1, { gen: 2 }, T0 + 1)
  assert.deepEqual(merges(await w.s()), [], 'nothing links A and B yet')
  // r2 rotates B → C, its segment carrying A → B → C (2285: from the earliest generation of the chain)
  assert.equal((await w.mapOn(1, { gen: 3, lineage: [await w.rot(1, 2), await w.rot(2, 3)], revision: '2' }, T0 + 2)).disposition, 'unique')
  assert.deepEqual(merges(await w.s()), [['c1', 'c2']], 'the incoming r2 extends c1\'s head A')
  assert.deepEqual(mergedEvents(await w.holder.resume(T0 + 3)), [['c1', ['c2']]])
  const s = await w.s()
  assert.deepEqual([s.contacts.c1.pos, s.contacts.c1.anchorHead, s.contacts.c1.aliases], ['0', (await w.gen(3)).anchor, ['c2']])
})

test('trust (ported from anchor.test: review 5 M2 — an unchanged head with newly carried connecting lineage merges too)', async () => {
  const w = await world()
  await w.mapOn(0, { gen: 1 })
  await w.mapOn(1, { gen: 2 }, T0 + 1)
  assert.deepEqual(merges(await w.s()), [])
  const r = await w.mapOn(1, { gen: 2, lineage: [await w.rot(1, 2)], revision: '2' }, T0 + 2)
  assert.equal(r.disposition, 'unique')
  assert.deepEqual(merges(await w.s()), [['c1', 'c2']], 'the carried A → B extends c1\'s head')
  assert.deepEqual(mergedEvents(await w.holder.resume(T0 + 3)), [['c1', ['c2']]])
  const s = await w.s()
  assert.deepEqual([s.contacts.c1.pos, s.contacts.c1.anchorHead], ['0', (await w.gen(2)).anchor])
})

test('trust (ported from anchor.test: review 5 M3 — after the departure of r2, the remaining entry\'s head is recomputed from what r1 holds; B with an empty lineage stands alone, A joins)', async () => {
  const w = await world()
  await w.mapOn(0)
  await w.mapOn(1, {}, T0 + 1)
  await w.holder.resume(T0 + 2)
  await w.mapOn(1, { gen: 2, lineage: [await w.rot(1, 2)], revision: '2' }, T0 + 3)
  assert.equal((await w.s()).contacts.c1.anchorHead, (await w.gen(2)).anchor)
  const d = await w.human('trust.depart', { contactId: 'c1', relationshipId: 'r2' }, 'd1', T0 + 4)
  assert.deepEqual(d.events.map((e) => [e.type, e.contactId, e.relationshipIds, e.removed]), [['contact.departed', 'c1', ['r2'], false]])
  let s = await w.s()
  assert.deepEqual([s.contacts.c1.relIds, s.contacts.c1.aliases, s.contacts.c1.pos, s.contacts.c1.status], [['r1'], [], '0', 'admitted'])
  assert.equal(s.contacts.c1.anchorHead, (await w.gen(1)).anchor, 'the head is recomputed from the remaining relationship')
  assert.equal(Object.hasOwn(s.relationships, 'r2'), false, 'B left with r2: no orphaned link')
  // B with an empty lineage does not join; A does
  await w.mapOn(2, { gen: 2 }, T0 + 5)
  assert.deepEqual(merges(await w.s()), [], 'B with an empty lineage stands alone')
  await w.mapOn(3, { gen: 1 }, T0 + 6)
  assert.deepEqual(merges(await w.s()), [['c1', 'c4']], 'A joins')
  await w.holder.resume(T0 + 7)
  s = await w.s()
  assert.deepEqual([s.contacts.c1.relIds, s.contacts.c3.relIds, s.contacts.c1.anchorHead], [['r1', 'r4'], ['r3'], (await w.gen(1)).anchor])
})

// ── the split (2080–2115) on hand-merged relationships ─────────────────

test('trust (ported from anchor.test: split, the leaver is an alias — the staying entry keeps its identity, position and head; the leaver takes its own and re-enters at the next position)', async () => {
  const w = await world()
  // c1 and cd merged by hand before any mapping: the identity is cd, rd's active head being the newer (2180)
  assert.equal((await w.human('trust.merge', { contactIds: ['c1', 'cd'] }, 'm1')).ok, true)
  await w.mapOn('d')                                          // the entry commits under cd (pos 0)
  let s = await w.s()
  assert.deepEqual([s.contacts.cd.pos, s.contacts.cd.aliases, s.contacts.cd.anchorHead], ['0', ['c1'], w.D.self])
  // C's first mapping on r1 names no anchor the entry holds: r1, the alias c1, leaves
  const r = await w.mapOn(0, {}, T0 + 1)
  assert.deepEqual(r.events.filter((e) => e.type === 'contact.split').map((e) => [e.contactId, e.leaver, e.relationshipId]), [['cd', 'c1', 'r1']])
  s = await w.s()
  assert.deepEqual([s.contacts.cd.pos, s.contacts.cd.status, s.contacts.cd.relIds, s.contacts.cd.aliases, s.contacts.cd.anchorHead], ['0', 'admitted', ['rd'], [], w.D.self])
  assert.deepEqual([s.contacts.c1.pos, s.contacts.c1.status, s.contacts.c1.relIds, s.contacts.c1.anchorHead], ['1', 'admitted', ['r1'], w.C[0].self])
  assert.deepEqual([s.relationships.r1.tuples[0].entryId, s.relationships.rd.tuples[0].entryId], ['c1', 'cd'], 'the lookups resolve to each entry')
  assert.deepEqual([contactView(s, 'cd').id, contactView(s, 'c1').id], ['cd', 'c1'])
})

test('trust (ported from anchor.test: split, the leaver bears the identity — the oldest remaining relationship by first verification (not by merge order) names the staying entry, its keys are rewritten)', async () => {
  const w = await world()
  // r1, r2, r3 merged by hand, unmapped: the identity is c3 (r3's head the newest, 2180); the list order puts r2 before r1
  assert.equal((await w.human('trust.merge', { contactIds: ['c2', 'c1', 'c3'] }, 'm1')).ok, true)
  let s = await w.s()
  assert.deepEqual([Object.keys(s.contacts).sort(), s.contacts.c3.relIds, s.contacts.c3.aliases], [['c3', 'c4', 'cd'], ['r3', 'r2', 'r1'], ['c1', 'c2']])
  // r1 verifies first, then r2 (the same anchor and binding: they stay)
  await w.mapOn(0, {}, T0 + 1)
  await w.mapOn(1, {}, T0 + 2)
  s = await w.s()
  assert.deepEqual([s.contacts.c3.pos, s.contacts.c3.anchorHead], ['0', w.C[0].self])
  assert.ok(BigInt(s.relationships.r1.firstVerified) < BigInt(s.relationships.r2.firstVerified))
  // r3, the identity bearer, states another binding for A in its first mapping: it leaves (2080)
  const copy = await copiedCard(w, 2, await w.gen(1), await otherGen(1), { when: T0 + 3 })
  const r = await w.deliverOn(2, copy, T0 + 3)
  assert.equal(r.disposition, 'unique')
  assert.deepEqual(r.events.filter((e) => e.type === 'contact.split').map((e) => [e.contactId, e.leaver, e.relationshipId]), [['c1', 'c3', 'r3']], 'c1: r1 was verified first')
  s = await w.s()
  assert.deepEqual([s.contacts.c1.pos, s.contacts.c1.status, s.contacts.c1.relIds, s.contacts.c1.aliases], ['0', 'admitted', ['r2', 'r1'], ['c2']], 'position and status unchanged')
  assert.deepEqual([s.contacts.c3.relIds, s.contacts.c3.pos, s.contacts.c3.anchorHead], [['r3'], '1', w.C[0].self], 'the leaver keeps its own identity')
  assert.deepEqual(['r1', 'r2', 'r3'].map((x) => s.relationships[x].tuples[0].entryId), ['c1', 'c1', 'c3'], 'the keys follow the new identity')
  assert.deepEqual([contactView(s, 'c2').id, contactView(s, 'c1').id, contactView(s, 'c3').id], ['c1', 'c1', 'c3'])
})

test('trust (ported from anchor.test: split by binding — a hand-merged relationship whose first mapping states another binding for the shared anchor leaves the entry (2080); two entries at anchor head A each (6630); a third under the matching binding joins the first)', async () => {
  const w = await world()
  assert.equal((await w.human('trust.merge', { contactIds: ['c1', 'c2'] }, 'm1')).ok, true)
  await w.mapOn(0)                                            // the entry commits under c2, r1 holds A bound to B
  let s = await w.s()
  assert.deepEqual([s.contacts.c2.relIds.sort(), s.contacts.c2.anchorHead], [['r1', 'r2'], w.C[0].self])
  // r2's first mapping keeps self = A but its card binds A to another key
  const r = await w.deliverOn(1, await copiedCard(w, 1, await w.gen(1), await otherGen(1), { when: T0 + 1 }), T0 + 1)
  assert.equal(r.disposition, 'unique')
  const split = r.events.filter((e) => e.type === 'contact.split').map((e) => [e.contactId, e.leaver, e.relationshipId])
  assert.deepEqual(split, [['c1', 'c2', 'r2']], 'another binding for A: r2 leaves and takes its identity c2; the entry is named by r1')
  s = await w.s()
  assert.deepEqual([s.contacts.c1.relIds, s.contacts.c2.relIds], [['r1'], ['r2']])
  assert.deepEqual([s.contacts.c1.anchorHead, s.contacts.c2.anchorHead], [w.C[0].self, w.C[0].self], 'two entries at anchor head A')
  // a third relationship under the binding r1 holds joins c1, not the copy
  await w.mapOn(2, {}, T0 + 2)
  assert.deepEqual(merges(await w.s()), [['c1', 'c3']])
})


// ── the bounded lineage over real rotations (Trust 6.1, 6.3 condition 8, 6400) ──

import { createHolder } from '../dist/index.js'
import { memoryLog } from '../dist/testing.js'
import { trustPair, deliver, MAPPING, ACK } from './pair-fixture.mjs'

/** A and B trusting each other, mappings exchanged; A's holder over a log (identity.test.mjs rotationPair). */
async function rotationPair () {
  const p = await trustPair({ invariants: true })
  const L = memoryLog(p.A.genesis)
  const holderA = await createHolder({ store: p.storeA, keys: p.A.keys, log: L }, { invariants: true })
  let n = 0
  const opts = (when) => ({ when, actId: `act-${++n}` })
  await holderA.trust('c1', opts(T0)); await p.holderB.trust('c1', opts(T0))
  const ra = await holderA.resume(T0 + 1); const rb = await p.holderB.resume(T0 + 1)
  await deliver(p.holderB, ra.outbound.filter((o) => o.type === MAPPING), T0 + 2)
  await deliver(holderA, rb.outbound.filter((o) => o.type === MAPPING), T0 + 2)
  /** one whole rotation: step 1, the log append, the re-issue; its mapping outbound */
  const rotate = async (when) => {
    assert.equal((await holderA.rotateAnchor(opts(when))).ok, true)
    const done = await holderA.resume(when + 1)
    assert.ok(done.events.some((e) => e.type === 'anchor.rotated'), 'the rotation completes')
    return [...done.outbound, ...(await holderA.resume(when + 2)).outbound].filter((o) => o.type === MAPPING)
  }
  return { ...p, holderA, L, opts, rotate }
}

test('trust (ported from anchor.test: the mapping carries at most the 64 most recent rotations from the generation the contact held; a contact that followed all 65 rotations keeps following)', async () => {
  const { A, holderA, holderB, storeA, storeB, rotate } = await rotationPair()
  for (let i = 0; i < 65; i++) {
    const when = T0 + 1000 + i * 10
    const out = await rotate(when)
    assert.equal(out.length, 1, `rotation ${i + 1}: one re-issue`)
    const [r] = await deliver(holderB, out, when + 3)
    assert.equal(r.disposition, 'unique', `rotation ${i + 1}: ${r.reason} ${r.ref}`)
  }
  const sA = await read(storeA)
  assert.equal(sA.register.community.head, '66')
  assert.equal(sA.register.lineage.length, 65, 'the holder keeps its whole lineage')
  const body = sA.relationships.r1.tuples[0].mappingOut.body
  assert.equal(body.lineage.length, 64, 'at most 64 elements travel (6020, 6400)')
  assert.equal(jcs(body.lineage), jcs(sA.register.lineage.slice(-64)), 'the most recent ones, in chain order')
  assert.equal(body.self, (await A.gen(66)).anchor)
  const sB = await read(storeB)
  assert.equal(sB.relationships.r1.heldCounterpartHead, (await A.gen(66)).anchor, 'B followed every rotation (6160)')
  assert.equal(sB.contacts.c1.anchorHead, (await A.gen(66)).anchor)
  assert.equal(sB.relationships.r1.links.length, 65, 'every link B verified, 1 → 2 … 65 → 66')
  assert.deepEqual([sB.contacts.c1.pos, sB.relationships.r1.tuples[0].mappingIn.rev], ['0', '66'], 'in place (2070), one revision per re-issue')
})

test('trust (ported from anchor.test: a contact that missed more than 64 rotations refuses the re-issue at stage 9 (6170, 6400): no ack, no mutation, the held anchor kept — and every later re-issue the same way)', async () => {
  const { A, holderB, storeA, storeB, rotate } = await rotationPair()
  const g1 = A.self
  let out
  for (let i = 0; i < 65; i++) out = await rotate(T0 + 1000 + i * 10)      // B receives none of them
  const body = (await read(storeA)).relationships.r1.tuples[0].mappingOut.body
  assert.equal(body.lineage[0].body.prev, (await A.gen(2)).anchor, 'the last carries 2 → 3 … 65 → 66 only')
  const before = await read(storeB)
  assert.equal(before.relationships.r1.heldCounterpartHead, g1)
  const r = await holderB.receive(out[0].envelope, T0 + 5000)
  assert.deepEqual(at(r), ['failed', 'validation-failed', 9, 'RLTP-TRU-6170'])
  assert.deepEqual(r.outbound ?? [], [], 'no ack')
  const after = await read(storeB)
  assert.equal(after.commitSeq, before.commitSeq, 'no mutation')
  assert.equal(jcs(after), jcs(before))
  // every later mapping fails the same way: the relationship no longer follows the holder (6400)
  const again = await rotate(T0 + 6000)
  assert.equal(again.length, 1)
  const r2 = await holderB.receive(again[0].envelope, T0 + 6100)
  assert.deepEqual(at(r2), ['failed', 'validation-failed', 9, 'RLTP-TRU-6170'])
  assert.equal(jcs(await read(storeB)), jcs(before), 'still nothing changed; the held anchor is kept')
  // the replay of the first refused envelope: refused again, never a duplicate (nothing was cached)
  assert.deepEqual(at(await holderB.receive(out[0].envelope, T0 + 6200)), ['failed', 'validation-failed', 9, 'RLTP-TRU-6170'])
})

// ── probe.test: the continuity world (trust-continuity.test.mjs net/meet) ──

import { randomUUID } from 'node:crypto'
import { seal, digestDoc, randomEntropy } from '../dist/index.js'
import { probeKeyOf, isRecordSide } from '../dist/continuity.js'
import { macU } from '../dist/anchor.js'
import { continuityTestModule } from '../dist/testing.js'
import { openFor } from './pair-fixture.mjs'
import { person, pairSide, tupleSpec, network, standIns, starDoc, groupStarDoc, openAt, tid, state as stateOf, edit as editP } from './star-fixture.mjs'

const PROBE = 'https://real-life.org/trust-tasks/continuity-probe/0.1'
const CMAP = 'https://real-life.org/trust-tasks/continuity-mapping/0.1'
const STAR = 'https://real-life.org/trust-tasks/star/0.2'
const GSTAR = 'https://real-life.org/trust-tasks/group-star/0.1'
const T1 = T0 + 3_600_000
const ofType = (out, type) => out.filter((o) => o.type === type)

/** Entropy whose next `fail` seals throw: a transient seal failure. */
function flakyEntropy () {
  const base = randomEntropy()
  const e = {
    fail: 0,
    bytes (purpose, n) { if (purpose === 'seal.eph' && e.fail > 0) { e.fail--; throw new Error('transient seal failure') } return base.bytes(purpose, n) },
    id: (purpose) => base.id(purpose),
  }
  return e
}

/** A KeyProvider whose agreement on the rkids in `failAgree` is not available. */
function flakyKeys (keys) {
  const failAgree = new Set()
  const k = new Proxy(keys, {
    get (t, prop) {
      if (prop === 'failAgree') return failAgree
      if (prop === 'agree') return (rkid, epk, rel) => (failAgree.has(rkid) ? Promise.resolve({ status: 'unknown' }) : t.agree(rkid, epk, rel))
      const v = t[prop]
      return typeof v === 'function' ? v.bind(t) : v
    },
  })
  return k
}

/**
 * Persons with one relationship per edge ('r-<other>', contact '<other>'),
 * holders with the continuity test module over flaky keys and entropy
 * (p.k, p.ent), a router to the owner of an envelope's key (`drop` holds
 * documents back into `held`), and a pump that resumes everyone until
 * nothing goes out.
 */
async function cnet (persons, edges) {
  for (const [a, b] of edges) { a.pairs[b.name] = await pairSide(a); b.pairs[a.name] = await pairSide(b) }
  for (const p of persons) {
    const bld = stateBuilder({ at: T0 }).community(p.genesis, '1')
    for (const [other, mine] of Object.entries(p.pairs)) {
      const q = persons.find((x) => x.name === other)
      bld.relationship('r-' + other, { contactId: other, tuples: [tupleSpec(mine, q.pairs[p.name])] })
    }
    p.store = new InMemoryStore()
    await p.store.commit(null, bld.build())
    p.k = flakyKeys(p.keys)
    p.ent = flakyEntropy()
    p.holder = await createHolder({ store: p.store, keys: p.k, entropy: p.ent }, { modules: [continuityTestModule], invariants: true })
  }
  const owner = (ka) => persons.find((p) => Object.values(p.pairs).some((s) => s.keyAgreement === ka))
  const held = []
  const route = async (outbound, when, { log = [], drop = () => false } = {}) => {
    for (const o of outbound) {
      if (drop(o)) { held.push(o); log.push({ dropped: o.type, digest: o.digest }); continue }
      const to = owner(o.envelope.rkid)
      const r = await to.holder.receive(o.envelope, when)
      log.push({ to: to.name, type: o.type, digest: o.digest, r })
      if (r.disposition !== 'failed' && r.disposition !== 'discarded') await route(r.outbound, when, { log, drop })
    }
    return log
  }
  const pump = async (when, opts = {}) => {
    const log = opts.log ?? []
    for (let i = 0; i < 12; i++) {
      const out = []
      for (const p of persons) out.push(...(await p.holder.resume(when)).outbound)
      if (!out.length) return log
      await route(out, when, { ...opts, log })
    }
    throw new Error('pump: no quiescence')
  }
  return { route, pump, owner, held }
}

const trustAct = (p, contactId, when = T0) => p.holder.act('trust.set', { contactId, on: true }, when, { actId: `${p.name}-trusts-${contactId}-${when}` })

/** A fresh tuple of p toward q (one each side), as the encounter makes it. */
async function meet (p, q, name, when = T1) {
  const mine = await pairSide(p), theirs = await pairSide(q)
  p.pairs[`${q.name}#${name}`] = mine; q.pairs[`${p.name}#${name}`] = theirs
  const open = (x, own, other, otherSide) => x.holder.act('continuity.newTuple', {
    relId: `r-${other.name}-${name}`, contactId: `${other.name}-${name}`, ownPairLabel: own.label, counterpartAnchor: otherSide.anchor, counterpartKeyAgreement: otherSide.keyAgreement,
  }, when)
  assert.equal((await open(p, mine, q, theirs)).ok, true)
  assert.equal((await open(q, theirs, p, mine)).ok, true)
  return { mine, theirs }
}

/** A and B who trust each other, then meet again on fresh tuples; R the record side, N the other. */
async function reencountered (fillA, fillB) {
  const A = await person('A', fillA), B = await person('B', fillB)
  const n = await cnet([A, B], [[A, B]])
  await trustAct(A, 'B'); await trustAct(B, 'A')
  await n.pump(T0)
  const { mine: A2, theirs: B2 } = await meet(A, B, '2')
  const [R, N] = isRecordSide(A2.anchor, B2.anchor) ? [A, B] : [B, A]
  return { A, B, n, R, N }
}

const ctxSide = (p, side) => labeledContext(p.seed, side.label)
const sharedSides = async (p, mine, theirs) => ecdh((await ctxSide(p, mine)).x.priv, xRawOfMk(theirs.keyAgreement))
let padN = 0
const pads = (n) => Array.from({ length: n }, () => { const b = new Uint8Array(32); new DataView(b.buffer).setUint32(0, ++padN); return 'u' + Buffer.from(b).toString('base64url') }).sort()

/** A document from side `mine` to side `theirs`, sealed. */
async function docTo (mine, theirs, type, payload, extra = {}) {
  const doc = { id: randomUUID(), type, issuer: mine.anchor, recipient: theirs.anchor, threadId: randomUUID(), issuedAt: iso(T1), payload, ...extra }
  return { envelope: await seal(doc, theirs.keyAgreement), digest: await digestDoc(doc), doc }
}

/** A continuity-probe/0.1 chunk from p's side `mine` to `theirs`, MAC'd under k_p over whatever body. */
async function probeDoc (p, mine, theirs, { body: over = {}, extra = {} } = {}) {
  const k = await probeKeyOf(await sharedSides(p, mine, theirs), mine.anchor, theirs.anchor)
  const body = { type: 'continuity-probe@1', probe: '1', seq: '1', last: true, blinded: pads(256), ...over }
  return docTo(mine, theirs, PROBE, { body, proof: { mac: await macU(k, jcs(body)) } }, { threadId: tid('probe-1'), ...extra })
}

// ── probe.test ports ───────────────────────────────────────────────────

test('trust (ported from probe.test: a transient seal failure never consumes the act — the Trust act\'s duty survives a failed issuance; a choice whose prior key is unavailable stays owed on the tuple and the next resume issues it)', async () => {
  // the Trust act: the issuance fails in its preparation; nothing commits, the class-on duty stands
  const p = await trustPair()
  const ent = flakyEntropy()
  const hA = await createHolder({ store: p.storeA, keys: p.A.keys, entropy: ent }, { invariants: true })
  assert.equal((await hA.trust('c1', { when: T0, actId: 't1' })).ok, true)
  const before = await read(p.storeA)
  ent.fail = 1
  await assert.rejects(() => hA.resume(T0 + 1), /transient seal failure/)
  const mid = await read(p.storeA)
  assert.equal(mid.commitSeq, before.commitSeq, 'nothing commits')
  assert.deepEqual(Object.keys(mid.duties), ['class-on:anchorMapping:r1'], 'the act\'s duty stands')
  assert.equal(jcs(mid.relationships), jcs(before.relationships), 'no issuance recorded')
  assert.deepEqual((await hA.contact('c1')).trust, { given: true, received: false, paused: false, pending: true })
  const out = ofType((await hA.resume(T0 + 2)).outbound, MAPPING)
  assert.equal(out.length, 1, 'the retry issues the mapping')
  assert.deepEqual((await read(p.storeA)).duties, {})
  assert.equal((await p.holderB.receive(out[0].envelope, T0 + 3)).disposition, 'unique')

  // continuity: the record side receives the other side's probe
  const { R, N, n } = await reencountered(0x5d, 0x5e)
  const [probe] = ofType((await N.holder.resume(T1)).outbound, PROBE)
  const fresh = R.pairs[`${N.name}#2`]
  const tR = async () => (await stateOf(R)).relationships[`r-${N.name}-2`]?.tuples[0]
  // (a) a seal failure inside the receive: nothing commits, the same envelope is taken afresh later
  const seq0 = (await stateOf(R)).commitSeq
  R.ent.fail = 1
  await assert.rejects(() => R.holder.receive(probe.envelope, T1), /transient seal failure/)
  assert.equal((await stateOf(R)).commitSeq, seq0, 'the receive committed nothing')
  // (b) the prior's key unavailable: the receive commits (ack, assembly), the choice stays owed with its duty
  R.k.failAgree.add(R.pairs[N.name].keyAgreement)
  const r = await R.holder.receive(probe.envelope, T1 + 1)
  assert.equal(r.disposition, 'unique', 'taken afresh: nothing was cached')
  assert.deepEqual(r.outbound.map((o) => o.type), [ACK], 'no mapping goes out')
  const t = await tR()
  assert.equal(t.continuityOut.due?.kind, 'choice', 'the obligation is persisted on the tuple')
  assert.equal(t.continuityOut.chosen, null)
  assert.equal((await stateOf(R)).relationships['r-' + N.name].tuples.length, 1, 'nothing chained yet')
  assert.ok(Object.hasOwn((await stateOf(R)).duties, `continuity:mapping:${fresh.label}`), 'the mapping duty stands')
  // the redelivery is a duplicate: the stored ack, byte-identical, and nothing else
  const again = await R.holder.receive(probe.envelope, T1 + 2)
  assert.equal(again.disposition, 'duplicate-known')
  assert.deepEqual(again.outbound.map((o) => o.envelope), r.outbound.map((o) => o.envelope))
  // the key is back: the producing call delivers what is owed; a probe hit
  // chains nothing, the choice waits for the counterpart's mapping under the prior key
  R.k.failAgree.clear()
  const res = await R.holder.resume(T1 + 3)
  assert.equal(ofType(res.outbound, CMAP).length, 1, 'the owed choice is issued')
  assert.equal((await stateOf(R)).relationships['r-' + N.name].tuples.length, 1, 'not chained on the hit')
  const owed = await tR()
  assert.deepEqual([owed.ownPairLabel, owed.continuityOut.due, owed.continuityOut.rev, owed.continuityOut.chosen], [fresh.label, null, '1', R.pairs[N.name].label], 'the obligation is cleared')
  await n.route(res.outbound, T1 + 3)
  await n.pump(T1 + 4)
  assert.equal((await stateOf(N)).relationships['r-' + R.name].tuples.length, 2, 'the other side chained on it')
  assert.equal((await stateOf(R)).relationships['r-' + N.name].tuples.length, 2, 'and its alignment chained the record side')
})

test('trust (ported from probe.test: concurrent trust acts — exactly one disclosure under concurrency, the loser refused by name; concurrent resumes never share a star salt)', async () => {
  const { B, holderA, holderB, storeA } = await trustPair()
  const [r1, r2] = await Promise.all([holderA.trust('c1', { when: T0, actId: 'x1' }), holderA.trust('c1', { when: T0, actId: 'x2' })])
  assert.deepEqual([r1.ok, r2], [true, { ok: false, code: 'already-given' }], 'the engine serializes: the second finds trust given')
  assert.deepEqual(Object.keys((await read(storeA)).duties), ['class-on:anchorMapping:r1'], 'one duty')
  const [a, b] = await Promise.all([holderA.resume(T0 + 1), holderA.resume(T0 + 1)])
  const all = [...a.outbound, ...b.outbound]
  assert.equal(ofType(all, MAPPING).length, 1, 'one disclosure')
  const salts = await Promise.all(ofType(all, STAR).map(async (o) => (await openFor(B, o.envelope)).payload.body.salt))
  assert.deepEqual(salts, ['1'], 'one production; the second resume finds the view in flight — no double salt')
  const t = (await read(storeA)).relationships.r1.tuples[0]
  assert.deepEqual([t.starOut.lastSalt, Object.keys(t.starOut.inflight)], ['1', ['1']])
  for (const o of all) assert.equal((await holderB.receive(o.envelope, T0 + 2)).disposition, 'unique')
})

test('trust (ported from probe.test: review-7 edges — a throwing argument never wedges the act; productions are serialized; no baseline without the verified ack)', async () => {
  const { holderA, holderB, storeA } = await trustPair()
  const seq = (await read(storeA)).commitSeq
  await assert.rejects(() => holderA.trust('c1', { when: NaN, actId: 'n1' }), TypeError, 'NaN time throws')
  assert.equal((await read(storeA)).commitSeq, seq, 'nothing commits')
  assert.equal((await holderA.contact('c1')).trust.given, false)
  assert.equal((await holderA.trust('c1', { when: T0, actId: 'n1' })).ok, true, 'the retry under the same actId succeeds')
  const [a, b] = await Promise.all([holderA.resume(T0 + 1), holderA.resume(T0 + 2)])
  assert.deepEqual([ofType(a.outbound, STAR).length, ofType(b.outbound, STAR).length], [1, 0], 'the queue serializes production')
  let t = (await read(storeA)).relationships.r1.tuples[0]
  assert.deepEqual([t.starOut.hwm, t.starOut.snapshot], ['0', null], 'no completion without an ack: the baseline stays absent')
  const [star] = ofType(a.outbound, STAR)
  await holderA.report({ digest: star.digest, status: 'delivered', late: false }, T0 + 3)
  t = (await read(storeA)).relationships.r1.tuples[0]
  assert.deepEqual([t.starOut.hwm, t.starOut.snapshot], ['0', null], 'an adapter report completes nothing (5660)')
  const got = await holderB.receive(star.envelope, T0 + 4)
  await holderA.receive(ofType(got.outbound, ACK)[0].envelope, T0 + 5)
  t = (await read(storeA)).relationships.r1.tuples[0]
  assert.equal(t.starOut.hwm, '1')
  assert.notEqual(t.starOut.snapshot, null, 'the verified ack completes it')
})

test('trust (ported from probe.test: stage 7 (malformed) before stage 8 (validation-failed) over the trust types — a ceremony.enactment, a calendar-invalid date inside a broken payload, a wrong issuer; nothing commits)', async () => {
  const A = await person('A', 0x5f), B = await person('B', 0x60)
  await cnet([A, B], [[A, B]])
  const { mine: A2, theirs: B2 } = await meet(A, B, '2')
  const aSide = { ...A.pairs.B, seed: A.seed, genesis: A.genesis, head: 1 }, bSide = B.pairs.A
  const enact = { ceremony: { enactment: 'uEiAFrei' } }
  const mapping = await craftMapping(aSide, bSide, { when: T1 })
  const gEntries = (k) => Array.from({ length: k }, (_, i) => ({ d: 'u' + Buffer.from(new Uint8Array(32).fill(i + 1)).toString('base64url'), c: 'u' + Buffer.from(new Uint8Array(380).fill(7)).toString('base64url') })).sort((x, y) => (x.d < y.d ? -1 : 1))
  const reseal = async (d, to, extra) => seal({ ...d.doc, id: randomUUID(), ...extra }, to.keyAgreement)
  const rows = [
    ['anchor-mapping: broken payload + enactment', (await docTo(aSide, bSide, MAPPING, {}, enact)).envelope, ['failed', 'malformed', 7, 'RLTP-TRU-6070']],
    ['anchor-mapping: valid + enactment', (await mappingEnvelope(aSide, bSide, mapping, { extra: enact })).envelope, ['failed', 'validation-failed', 8, undefined]],
    ['anchor-mapping: broken payload with a calendar-invalid issuedAt', (await docTo(aSide, bSide, MAPPING, { body: { type: 'anchor-mapping@4', issuedAt: '2025-02-29T12:00:00Z' } })).envelope, ['failed', 'malformed', 7, 'RLTP-TRU-6070']],
    ['anchor-mapping: wrong issuer + broken payload', (await docTo(aSide, bSide, MAPPING, {}, { issuer: bSide.anchor })).envelope, ['failed', 'malformed', 7, 'RLTP-TRU-6070']],
    ['anchor-mapping: wrong issuer + valid', (await mappingEnvelope(aSide, bSide, mapping, { extra: { issuer: bSide.anchor } })).envelope, ['failed', 'validation-failed', 8, undefined]],
    ['star: broken payload + enactment', (await docTo(aSide, bSide, STAR, {}, enact)).envelope, ['failed', 'malformed', 7, 'RLTP-TRU-5070']],
    ['star: valid + enactment', await reseal(await starDoc(A, B, { salt: '1' }), bSide, enact), ['failed', 'validation-failed', 8, undefined]],
    ['group-star: broken payload + enactment', (await docTo(aSide, bSide, GSTAR, {}, enact)).envelope, ['failed', 'malformed', 7, 'RLTP-TRU-5370']],
    ['group-star: valid + enactment', await reseal(await groupStarDoc(A, B, { salt: '1', groups: gEntries(16) }), bSide, enact), ['failed', 'validation-failed', 8, undefined]],
    ['continuity-probe: broken payload + enactment', (await docTo(A2, B2, PROBE, {}, enact)).envelope, ['failed', 'malformed', 7, 'RLTP-TRU-6670']],
    ['continuity-probe: valid + enactment', (await probeDoc(A, A2, B2, { extra: enact })).envelope, ['failed', 'validation-failed', 8, undefined]],
    ['continuity-mapping: broken payload with a calendar-invalid issuedAt', (await docTo(A2, B2, CMAP, { body: { type: 'continuity-mapping@1', issuedAt: '2025-02-29T12:00:00Z' } })).envelope, ['failed', 'malformed', 7, 'RLTP-TRU-6940']],
  ]
  // the core's stage-8 refusals (the enactment binding, the closed acceptance binding of Delivery 4.4) name no Trust rule
  const before = await stateOf(B)
  for (const [name, env, want] of rows) {
    const r = await B.holder.receive(env, T1 + 1)
    assert.deepEqual(at(r), want, name)
    assert.deepEqual(r.outbound ?? [], [], `${name}: no ack`)
  }
  const after = await stateOf(B)
  assert.equal(after.commitSeq, before.commitSeq, 'nothing commits')
  assert.equal(after.relationships['r-A'].tuples[0].mappingIn.rev, '0', 'the disclosure was not taken')
})

test('trust (ported from probe.test: authenticated but malformed values never corrupt state or cache — a MAC-clean probe with probe "NaN", a probe with an empty blinded list (the chunk form is fixed at 256), a star with a non-integer salt and an unknown member die at stage 7)', async () => {
  const A = await person('A', 0x63), B = await person('B', 0x64)
  await cnet([A, B], [[A, B]])
  const { mine: A2, theirs: B2 } = await meet(A, B, '2')
  const before = await stateOf(B)
  const nan = await probeDoc(A, A2, B2, { body: { probe: 'NaN' } })
  assert.deepEqual(at(await B.holder.receive(nan.envelope, T1)), ['failed', 'malformed', 7, 'RLTP-TRU-6670'], 'NaN sequence dies at the form gate')
  const empty = await probeDoc(A, A2, B2, { body: { blinded: [] } })
  assert.deepEqual(at(await B.holder.receive(empty.envelope, T1)), ['failed', 'malformed', 7, 'RLTP-TRU-6670'], 'empty blinded dies at the form gate')
  // a star/0.2 chunk with a non-integer salt and a count star@2 does not know, MAC'd under the pair's star key
  const k = (await starDoc(A, B, { salt: '1' })).k
  const body = { type: 'star@2', salt: 'not-an-int', seq: '1', last: true, count: '-7', blinded: [] }
  const bad = await docTo(A.pairs.B, B.pairs.A, STAR, { body, proof: { mac: await macU(k, jcs(body)) } })
  assert.deepEqual(at(await B.holder.receive(bad.envelope, T1)), ['failed', 'malformed', 7, 'RLTP-TRU-5070'], 'value forms are bound before storage')
  const after = await stateOf(B)
  assert.equal(after.commitSeq, before.commitSeq, 'nothing commits')
  assert.equal(jcs(after.relationships), jcs(before.relationships), 'probeIn and starIn untouched')
  assert.equal(jcs(after.effects), jcs(before.effects), 'no cache entry')
  for (const d of [nan, empty, bad]) assert.equal(Object.hasOwn(after.effects, d.digest), false)
  // the well-formed probe still completes
  assert.equal((await B.holder.receive((await probeDoc(A, A2, B2)).envelope, T1 + 1)).disposition, 'unique')
  assert.equal((await stateOf(B)).relationships['r-A-2'].tuples[0].probeIn.hwm, '1')
})

test('trust (ported from probe.test: a continuity mapping travels again byte-identical — the outbox re-offers the same envelope, across a restart; the resend after a failure carries the same artifact, body and proof)', async () => {
  const { R, N } = await reencountered(0x65, 0x66)
  // R's probe reaches N: N, the non-record side, reports; the report is never acknowledged
  const [probe] = ofType((await R.holder.resume(T1)).outbound, PROBE)
  const got = await N.holder.receive(probe.envelope, T1 + 1)
  const [report] = ofType(got.outbound, CMAP)
  assert.ok(report, 'the match report')
  const item = (await stateOf(N)).outbox[report.digest]
  assert.equal(item.attempt, 1)
  const again = ofType((await N.holder.resume(item.nextAttemptAt)).outbound, CMAP)
  assert.deepEqual(again.map((o) => [o.digest, o.attempt, jcs(o.envelope)]), [[report.digest, 2, jcs(report.envelope)]], 'the same envelope travels again, byte for byte')
  const restarted = await createHolder({ store: N.store, keys: N.keys }, { modules: [continuityTestModule], invariants: true })
  const due = (await stateOf(N)).outbox[report.digest].nextAttemptAt
  const third = ofType((await restarted.resume(due)).outbound, CMAP)
  assert.deepEqual(third.map((o) => [o.digest, o.attempt, jcs(o.envelope)]), [[report.digest, 3, jcs(report.envelope)]], 'after a restart too')
  // the item fails: the standing duty resends the stored artifact in a new document under its revision (6840)
  await restarted.report({ digest: report.digest, status: 'failed', reason: 'unroutable' }, due + 1)
  const later = due + 3_600_000
  const resent = ofType((await restarted.resume(later)).outbound, CMAP)
  assert.equal(resent.length, 1)
  assert.notEqual(resent[0].digest, report.digest, 'a new document')
  const nSide = R.pairs[`${N.name}#2`]
  const open = async (o) => (await (await import('../dist/index.js')).unseal(o.envelope, (await labeledContext(R.seed, nSide.label)).x.priv)).document
  const [d1, d2] = [await open(report), await open(resent[0])]
  assert.equal(jcs(d2.payload), jcs(d1.payload), 'the same artifact: body and proof byte-identical')
})

test('trust (ported from probe.test: a higher in-flight salt with another view — the lower salt carrying the current view is never re-produced, the receiver refuses it below its high-water mark, and the next production goes out under a fresh, higher salt)', async () => {
  const A = await person('A', 0x67), B = await person('B', 0x68)
  const net = await network([A, B], [[A, B]], { build: { A: (b) => standIns(b, 1) } })
  const head = (h) => editP(A, (s) => { s.contacts.x00000.anchorHead = h })
  const salt = async (o) => (await openAt(B, A, o.envelope)).payload.body.salt
  const s1 = ofType((await A.holder.resume(T0)).outbound, STAR)            // view V1 under salt 1
  await head('did:key:zHeadV2')
  const s2 = ofType((await A.holder.resume(T0 + 1)).outbound, STAR)        // V2 under salt 2
  assert.deepEqual([await salt(s1[0]), await salt(s2[0])], ['1', '2'])
  await head('did:key:zHeadx00000')                                        // back to V1: salt 1 carries it, in flight
  assert.deepEqual(ofType((await A.holder.resume(T0 + 2)).outbound, STAR), [], 'no new salt while an in-flight salt carries the view (the outbox retries it)')
  // B takes salt 2; the ack completes it at A
  const got2 = await B.holder.receive(s2[0].envelope, T0 + 3)
  assert.equal(got2.disposition, 'unique')
  await net.deliver(ofType(got2.outbound, ACK), T0 + 4)
  const t = (await stateOf(A)).relationships['r-B'].tuples[0].starOut
  assert.deepEqual([t.hwm, t.snapshot], ['2', [{ member: 'x00000', head: 'did:key:zHeadV2' }]])
  // salt 1 arrives late: below B's completed high-water mark, refused (5150), never acked
  const late = await B.holder.receive(s1[0].envelope, T0 + 5)
  assert.deepEqual([late.disposition, late.stage, late.ref], ['failed', 8, 'RLTP-TRU-5150'])
  // the divergence stands at A: it ships V1 under a fresh salt above 2
  const s3 = ofType((await A.holder.resume(T0 + 6)).outbound, STAR)
  assert.equal(s3.length, 1)
  assert.equal(await salt(s3[0]), '3', 'fresh and higher')
  const got3 = await B.holder.receive(s3[0].envelope, T0 + 7)
  assert.deepEqual(got3.events.map((e) => [e.type, e.salt]), [['star.accepted', '3']])
})

test('trust (ported from probe.test: deactivation during the star production — the tuple deactivated between preparation and commit issues nothing, no salt consumed)', async () => {
  const A = await person('A', 0x69), B = await person('B', 0x6a)
  const cas = { hook: null }
  await network([A, B], [[A, B]], {
    holder: {
      A: (p) => createHolder({
        store: { read: () => p.store.read(), async commit (v, x) { if (cas.hook) { const h = cas.hook; cas.hook = null; await h() } return p.store.commit(v, x) } },
        keys: p.keys,
      }),
    },
  })
  const before = (await stateOf(A)).relationships['r-B'].tuples[0]
  cas.hook = () => editP(A, (s) => { s.relationships['r-B'].tuples[0].deactivated = true })
  const r = await A.holder.resume(T0)
  assert.deepEqual([...ofType(r.outbound, STAR), ...ofType(r.outbound, GSTAR)], [], 'nothing leaves the dead tuple')
  const s = await stateOf(A)
  const t = s.relationships['r-B'].tuples[0]
  assert.equal(t.deactivated, true)
  assert.deepEqual([t.starOut, t.groupStarOut], [before.starOut, before.groupStarOut], 'no salt consumed, no in-flight entry')
  assert.deepEqual(Object.values(s.outbox).filter((o) => o.type === STAR || o.type === GSTAR), [])
})

test('trust (ported from probe.test: a late record-side probe after the verified choice produces no match report; no resume retries a mapping on the tuple afterwards (6a.3, 6860))', async () => {
  const { R, N, n } = await reencountered(0x6b, 0x6c)
  // every probe of R toward N is held back; the rest flows: N probes, R chooses, N chains and aligns
  const toN = (o) => n.owner(o.envelope.rkid) === N
  await n.pump(T1, { drop: (o) => o.type === PROBE && toN(o) })
  const sR = await stateOf(R), sN = await stateOf(N)
  assert.equal(sN.relationships['r-' + R.name].tuples.length, 2, 'N chained on the record choice')
  assert.equal(sR.relationships['r-' + N.name].tuples.at(-1).continuityOut.aligned, true, 'the alignment arrived')
  const lateProbes = n.held.filter((o) => o.type === PROBE)
  assert.ok(lateProbes.length >= 1)
  // R's own probe arrives late at N
  const log = await n.route(lateProbes.splice(0), T1 + 1)
  assert.deepEqual(log.filter((l) => l.type === CMAP), [], 'no match report after the verified record choice (stale counter-claim)')
  assert.ok(log.some((l) => l.type === PROBE && l.r.disposition === 'unique'))
  // no resume sends a mapping on this tuple again: no endless retry
  for (const when of [T1 + 60_000, T1 + 600_000, T1 + 3_600_000, T1 + 86_400_000]) {
    const out = [...(await N.holder.resume(when)).outbound, ...(await R.holder.resume(when)).outbound]
    assert.deepEqual(ofType(out, CMAP), [], `resume at +${when - T1} ms: no mapping retry`)
    await n.route(out, when)
  }
  assert.deepEqual(Object.values((await stateOf(N)).duties).filter((d) => d.kind === 'continuity'), [], 'N\'s continuity duties ended')
})

// ── probe.test: the welcome digest; introduction consent (holder-fixture) ──

import { diSign, unseal } from '../dist/index.js'
import * as HF from './holder-fixture.mjs'

const TT = 'https://real-life.org/trust-tasks/'
const INVITE = TT + 'membership-invite/0.2'
const WELCOME = TT + 'x-membership-welcome/0.1'
const REPLY = TT + 'introduction-reply/0.1'

test('trust (ported from probe.test: a signed welcome with a garbage genesis digest is malformed at stage 7 and derives nothing; the real welcome still joins)', async () => {
  const A = await HF.communityPerson(0x71), B = await HF.communityPerson(0x72)
  const { a } = await HF.met(A, B, T0)
  const f = await A.h.foundGroup({ name: 'Werk' }, HF.opts(T0 + 10_000))
  const groupId = HF.ev(f, 'group.founded')[0].groupId
  const seen = await HF.settle([A, B], (await A.h.invite(groupId, a.id, HF.opts(T0 + 11_000))).outbound, T0 + 12_000)
  const [prompt] = await B.h.prompts()
  const d = await B.h.decide(prompt.id, 'accept', HF.opts(T0 + 13_000))
  const heldWelcome = []
  await HF.settle([A, B], d.outbound, T0 + 14_000, { keep: (o) => { if (o.type === WELCOME) { heldWelcome.push(o); return false } return true } })
  assert.equal(heldWelcome.length, 1)
  // a welcome signed by the inviter in the invitation's thread whose genesis digest is garbage
  const memberB = await labeledContext(B.seed, 'group/' + groupId)
  const invite = (await unseal(seen.find((x) => x.o.type === INVITE).o.envelope, memberB.x.priv)).document
  const actx = await labeledContext(A.seed, (await A.read()).groups[groupId].memberLabel)
  const real = (await unseal(heldWelcome[0].envelope, memberB.x.priv)).document
  const { proof: _p, ...realBody } = real
  const forged = await diSign(actx, { ...realBody, id: randomUUID(), threadId: invite.threadId, payload: { ...realBody.payload, genesisDigest: 'not-a-digest' } }, real.issuedAt)
  const before = await B.read()
  const r = await B.h.receive(await seal(forged, memberB.keyAgreement), T0 + 15_000)
  assert.deepEqual(at(r), ['failed', 'malformed', 7, undefined], 'a named error at the form gate')
  const after = await B.read()
  assert.equal(after.commitSeq, before.commitSeq, 'nothing derived, nothing committed')
  assert.deepEqual(await B.h.groups(), [])
  assert.equal(jcs(after.register), jcs(before.register), 'no context derived for the garbage digest')
  // the real welcome joins
  const ok = await B.h.receive(heldWelcome[0].envelope, T0 + 16_000)
  assert.deepEqual(ok.events.map((e) => e.type), ['group.joined'])
  assert.deepEqual((await B.h.groups()).map((g) => g.id), [groupId])
})

/** M meets R and T; M introduces R to T; R requests; T holds the consent prompt. */
async function consentPrompt (base) {
  const M = await HF.person(base), R = await HF.person(base + 1), T = await HF.person(base + 2)
  const mr = await HF.met(R, M, T0)
  const mt = await HF.met(T, M, T0 + 10_000)
  const intro = await M.h.introduce(mr.b.id, mt.b.id, HF.opts(T0 + 20_000, { label: 'Tia' }))
  assert.equal(intro.ok, true, JSON.stringify(intro))
  await HF.settle([M, R, T], intro.outbound, T0 + 21_000)
  const [po] = await R.h.prompts()
  await HF.settle([M, R, T], (await R.h.decide(po.id, 'accept', HF.opts(T0 + 22_000))).outbound, T0 + 23_000)
  const [pt] = await T.h.prompts()
  assert.equal(pt.kind, 'introduction')
  return { M, R, T, pt }
}

const targetAct = async (T) => Object.values((await T.read()).encounter.introductions)[0]
const replies = (s) => Object.values(s.outbox).filter((o) => o.type === REPLY)

test('trust (ported from probe.test: a repeated consent keeps the released channel — the second decision finds no prompt, mints no context and no card; the introduced relationship runs on the released context)', async () => {
  const { M, R, T, pt } = await consentPrompt(0x74)
  const labels0 = (await T.read()).register.labels.length
  const first = await T.h.decide(pt.id, 'accept', HF.opts(T0 + 24_000))
  assert.equal(first.ok, true)
  assert.deepEqual(first.outbound.map((o) => o.type), [REPLY])
  const released = await T.read()
  const act = await targetAct(T)
  assert.ok(released.register.labels.includes(act.ownLabel), 'the released context')
  assert.equal(released.register.labels.length - labels0, 1, 'one release: one context')
  const again = await T.h.decide(pt.id, 'accept', HF.opts(T0 + 25_000))
  assert.deepEqual(again, { ok: false, code: 'unknown-prompt' })
  const after = await T.read()
  assert.equal(after.commitSeq, released.commitSeq, 'nothing commits')
  assert.equal(jcs(after), jcs(released), 'same context, same released card, nothing minted')
  // the channel runs on the released context
  await HF.settle([M, R, T], first.outbound, T0 + 26_000)
  const tTuple = Object.values((await T.read()).relationships).flatMap((x) => x.tuples).find((t) => t.ownPairLabel === act.ownLabel)
  assert.ok(tTuple, 'the introduced relationship on the released context')
  const rAct = Object.values((await R.read()).encounter.introductions)[0]
  const rTuple = Object.values((await R.read()).relationships).flatMap((x) => x.tuples).find((t) => t.ownPairLabel === rAct.ownLabel)
  assert.equal(rTuple.counterpartAnchor, (await T.keys.anchorOf(act.ownLabel)).anchor)
})

test('trust (ported from probe.test: concurrent consent calls share one release — exactly one decision releases, one context, one reply)', async () => {
  const one = await consentPrompt(0x77)
  const n1 = (await one.T.read()).register.labels.length
  await one.T.h.decide(one.pt.id, 'accept', HF.opts(T0 + 24_000))
  const perRelease = (await one.T.read()).register.labels.length - n1
  const w = await consentPrompt(0x7a)
  const n2 = (await w.T.read()).register.labels.length
  const [a, b] = await Promise.all([w.T.h.decide(w.pt.id, 'accept', HF.opts(T0 + 24_000)), w.T.h.decide(w.pt.id, 'accept', HF.opts(T0 + 24_000))])
  assert.deepEqual([a.ok, b], [true, { ok: false, code: 'unknown-prompt' }], 'the engine serializes: the second finds the prompt decided')
  const s = await w.T.read()
  assert.equal(s.register.labels.length - n2, perRelease, 'contexts of exactly one release')
  assert.equal(replies(s).length, 1, 'one card released')
  assert.deepEqual(a.outbound.map((o) => o.type), [REPLY])
  assert.ok(s.register.labels.includes((await targetAct(w.T)).ownLabel))
})
