#!/usr/bin/env node
// trust-continuity (lib Stage 2, PR 4c; Trust §6a, 6.4): continuity on the
// holder — the root builders against the vectors, the probe (sequenced,
// chunked, padded, blinded; one assembly per tuple), the continuity
// mapping (one chooser, one trigger, revisions, the record freeze), the
// chaining (append atomic with the deactivation, idempotent, chain state
// carried, tuple state not migrated), the re-issue on the new head and the
// standing duties of 6a.3.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as C from '../dist/index.js'
import { probeKeyOf, buildProbeChunks, assembleContinuityMapping, continuityMacsOk, probeChunkOk, probeChunkMacOk, isRecordSide, blindPrior } from '../dist/continuity.js'
import { visibility } from '../dist/index.js'

const vec = (f) => JSON.parse(readFileSync(new URL('../../vectors/' + f, import.meta.url), 'utf8'))
const hex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)))

test('continuity: the root builders reproduce the probe and both continuity mappings of vectors/visibility.json byte for byte', async () => {
  const V = vec('visibility.json')
  const IKM = hex(vec('identity-derivation.json').rootIkm)
  const P = {}
  for (const k of ['A', 'B', 'A2', 'B2']) P[k] = await C.pairContext(IKM, hex(V.parties[k].relationshipNonce))
  const shared = async (from, to) => C.ecdh(P[from].x.priv, C.xRawOfMk(P[to].keyAgreement))
  // the probe A2 → B2 blinding A's prior pair anchor; the padding replayed from the vector
  const kp = await probeKeyOf(await shared('A2', 'B2'), P.A2.anchor, P.B2.anchor)
  const real = await visibility.blindPrior(kp, P.A.anchor)
  const pads = V.artifacts.continuityProbe.body.blinded.filter((x) => x !== real).map((x) => C.fromB64u(x.slice(1)))
  const chunks = await buildProbeChunks(kp, '1', [P.A.anchor], () => pads.shift())
  assert.equal(chunks.length, 1)
  assert.equal(C.jcs(chunks[0]), C.jcs(V.artifacts.continuityProbe))
  assert.ok(probeChunkOk(chunks[0]))
  assert.ok(await probeChunkMacOk(await probeKeyOf(await shared('B2', 'A2'), P.A2.anchor, P.B2.anchor), chunks[0]), 'the recipient recomputes k_p from its side')
  // the mapping A → B (prior A, next A2, to B2) and its reverse
  const m = await assembleContinuityMapping(V.artifacts.continuityMapping.body, await shared('A', 'B'), await shared('A2', 'B2'))
  assert.equal(C.jcs(m), C.jcs(V.artifacts.continuityMapping))
  const r = await assembleContinuityMapping(V.artifacts.continuityMappingReverse.body, await shared('B', 'A'), await shared('B2', 'A2'))
  assert.equal(C.jcs(r), C.jcs(V.artifacts.continuityMappingReverse))
  assert.ok(await continuityMacsOk(m, await shared('B', 'A'), await shared('B2', 'A2')), 'the addressee verifies under its own secrets')
  assert.equal(await continuityMacsOk(m, await shared('B2', 'A2'), await shared('B', 'A')), false, 'mac1 and mac2 are not interchangeable')
  assert.equal(isRecordSide(P.A2.anchor, P.B2.anchor), P.A2.anchor < P.B2.anchor)
})

test('continuity: an empty prior set still sends one all-padding chunk; more than 256 entries are padded to the next multiple and every padding collision resampled (6760–6780)', async () => {
  const k = new Uint8Array(32).fill(7)
  let n = 0
  const pad = () => { const b = new Uint8Array(32); b[0] = n++ % 3; return b }   // collides on purpose
  let fresh = 0
  const uniq = () => { const b = new Uint8Array(32); new DataView(b.buffer).setUint32(0, ++fresh); return b }
  const empty = await buildProbeChunks(k, '1', [], uniq)
  assert.deepEqual([empty.length, empty[0].body.blinded.length, empty[0].body.last], [1, 256, true])
  const priors = Array.from({ length: 300 }, (_, i) => `did:key:z${i}`)
  const big = await buildProbeChunks(k, '2', priors, (() => { let first = true; return () => (first ? (first = false, pad()) : uniq()) })())
  assert.deepEqual(big.map((c) => [c.body.seq, c.body.last, c.body.blinded.length]), [['1', false, 256], ['2', true, 256]])
  const all = big.flatMap((c) => c.body.blinded)
  assert.equal(new Set(all).size, 512, 'no duplicate')
  assert.deepEqual(all, [...all].sort(), 'sorted once across the chunks')
  // a pad source that keeps colliding is called again until it does not
  let calls = 0
  const sticky = () => { calls++; const b = new Uint8Array(32); if (calls > 3) new DataView(b.buffer).setUint32(0, calls); return b }
  const c = await buildProbeChunks(k, '1', [], sticky)
  assert.equal(new Set(c[0].body.blinded).size, 256)
  assert.ok(calls > 256, 'colliding values were resampled')
})

// ── the holder (PR 4c) ─────────────────────────────────────────────────

import { createHolder, communityContext, ecdh, xRawOfMk, labeledContext, iso, seal, unseal, digestDoc, jcs as J } from '../dist/index.js'
import { InMemoryStore, stateBuilder, continuityTestModule } from '../dist/testing.js'
import { chainTuple, contactView, substitutePrior } from '../dist/internal.js'
import { makeAnchorRotation, macU } from '../dist/anchor.js'
import { T0 } from './pair-fixture.mjs'
import { person, pairSide, tupleSpec, state, edit, tid } from './star-fixture.mjs'

/** nextDueAt names no delivery or duty work: none, or only the expiry work
 *  tick does, which lies at least a day out here (the timer contract) */
const noDutyWake = (t, when) => t === undefined || t - when >= 86_400_000


const PROBE = 'https://real-life.org/trust-tasks/continuity-probe/0.1'
const CMAP = 'https://real-life.org/trust-tasks/continuity-mapping/0.1'
const MAPPING = 'https://real-life.org/trust-tasks/anchor-mapping/0.3'
const STAR = 'https://real-life.org/trust-tasks/star/0.2'
const T1 = T0 + 3_600_000

/**
 * Persons with one relationship per edge ('r-<other>', contact '<other>'),
 * holders with the continuity test module, a router that delivers to the
 * owner of an envelope's key (`drop` filters what it delivers), and a
 * pump that resumes everyone until nothing goes out.
 */
async function net (persons, edges, { build = {} } = {}) {
  for (const [a, b] of edges) { a.pairs[b.name] = await pairSide(a); b.pairs[a.name] = await pairSide(b) }
  for (const p of persons) {
    const bld = stateBuilder({ at: T0 }).community(p.genesis, '1')
    for (const [other, mine] of Object.entries(p.pairs)) {
      const q = persons.find((x) => x.name === other)
      bld.relationship('r-' + other, { contactId: other, tuples: [tupleSpec(mine, q.pairs[p.name])] })
    }
    if (build[p.name]) build[p.name](bld)
    p.store = new InMemoryStore()
    await p.store.commit(null, bld.build())
    p.holder = await createHolder({ store: p.store, keys: p.keys }, { modules: [continuityTestModule] })
  }
  const owner = (ka) => persons.find((p) => Object.values(p.pairs).some((s) => s.keyAgreement === ka))
  const route = async (outbound, when, { log = [], drop = () => false } = {}) => {
    for (const o of outbound) {
      if (drop(o)) { log.push({ dropped: o.type, digest: o.digest }); continue }
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
  return { route, pump, owner }
}

/** The tuple `label` wherever it lives (a fresh relationship or a chain). */
const tupleOf = (s, label) => Object.values(s.relationships).flatMap((r) => r.tuples).find((t) => t.ownPairLabel === label)

const trust = (p, contactId, when = T0) => p.holder.act('trust.set', { contactId, on: true }, when, { actId: `${p.name}-trusts-${contactId}-${when}` })

/** A fresh tuple of p toward q (one each side), as the encounter will make it. */
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

/** A and B who trust each other, then meet again. */
async function reencounter (fill = 0x51, opts = {}) {
  const A = await person('A', fill), B = await person('B', fill + 1)
  const n = await net([A, B], [[A, B]], opts)
  await trust(A, 'B'); await trust(B, 'A')
  await n.pump(T0)
  return { A, B, n }
}

test('re-encounter: fresh tuple → probe → mapping → both sides chain; the old head deactivated, chain state carried, tuple state not migrated, the mapping issued on the new head (6a.2, 6a.4, 6220, 6250, 6980)', async () => {
  const { A, B, n } = await reencounter(0x51)
  const sA0 = await state(A)
  const old = { A: sA0.relationships['r-B'].tuples[0], B: (await state(B)).relationships['r-A'].tuples[0] }
  const { mine: A2, theirs: B2 } = await meet(A, B, '2')
  let sA = await state(A)
  // 2300: the prior-candidate set is frozen at creation; the probe is pending (6820)
  assert.deepEqual(sA.relationships['r-B-2'].tuples[0].priorCandidates, [{ ownPairLabel: A.pairs.B.label, counterpartAnchor: B.pairs.A.anchor }])
  assert.deepEqual(Object.values(sA.duties).map((d) => [d.kind, d.step]), [['continuity', 'probe']])
  assert.equal(contactView(sA, 'B-2').id, 'B-2', 'until the probe runs, an unchained relationship')
  const log = await n.pump(T1)
  assert.ok(log.some((l) => l.type === PROBE) && log.some((l) => l.type === CMAP))
  for (const [P, other, mine, theirs, prior] of [[A, 'B', A2, B2, old.A], [B, 'A', B2, A2, old.B]]) {
    const s = await state(P)
    const chain = s.relationships['r-' + other]
    assert.deepEqual(chain.tuples.map((t) => [t.ownPairLabel, t.deactivated]), [[prior.ownPairLabel, true], [mine.label, false]], `${P.name}: appended, the prior deactivated (6220)`)
    assert.equal(chain.activeHead, mine.label)
    assert.deepEqual([s.relationships[`r-${other}-2`].chainedInto, s.relationships[`r-${other}-2`].tuples], ['r-' + other, []], 'the fresh relationship is a husk')
    assert.deepEqual([s.contacts[other].aliases, s.contacts[other].relIds, s.contacts[other].pos], [[`${other}-2`], ['r-' + other], '0'])
    assert.equal(Object.hasOwn(s.contacts, `${other}-2`), false)
    assert.equal(contactView(s, `${other}-2`).id, other, 'the fresh contact finds the chained one')
    // chain state carried (2280): the anchor head, the earliest anchor (2285)
    assert.equal(chain.heldCounterpartHead, (P === A ? B : A).self)
    assert.equal(chain.earliestAnchor, P.self)
    // tuple state does not migrate (6250): the new head has its own scopes
    const head = chain.tuples[1]
    assert.equal(head.entryId, other)
    assert.ok(BigInt(prior.starOut.lastSalt) >= 1n)
    assert.equal(head.mappingIn.rev, '1', 'the counterpart\'s mapping arrived on the new head (6980)')
    assert.equal(head.mappingOut.rev, '1', 'issued on the new head under its own scope')
    assert.equal(head.mappingOut.underAnchor, P.self)
    assert.equal(head.probeOut.done, true, 'a probe completed')
    assert.deepEqual(s.entryOrder.heads, ['r-' + other], 'the chain took the fresh head\'s place (2180)')
  }
  // one chooser, one trigger: the record side chose, the other followed (6900)
  const record = isRecordSide(A2.anchor, B2.anchor) ? A : B
  const other = record === A ? B : A
  const rt = (await state(record)).relationships['r-' + other.name].tuples[1]
  const ot = (await state(other)).relationships['r-' + record.name].tuples[1]
  assert.equal(rt.continuityOut.chosen, (await state(record)).relationships['r-' + other.name].tuples[0].ownPairLabel)
  assert.equal(ot.continuityIn.recordPrior, record.pairs[other.name].anchor)
  // the old tuples take nothing any more (6240, 5360); the chained relationship's star does not restart (5820)
  const r = await n.pump(T1 + 1)
  assert.deepEqual(r, [])
  const { starDoc } = await import('./star-fixture.mjs')
  const stale = await starDoc(B, A, { salt: '9' })
  assert.deepEqual([(await A.holder.receive(stale.envelope, T1 + 2)).disposition], ['failed'])
  assert.deepEqual((await state(A)).duties, {})
})

test('probe to a stranger: no candidate matches — the fresh relationship stays a new one (6260, 6800)', async () => {
  const A = await person('A', 0x61), B = await person('B', 0x62), C = await person('C', 0x63)
  const n = await net([A, B, C], [[A, B]])
  await trust(A, 'B')
  await n.pump(T0)
  await meet(A, C, '1')
  await n.pump(T1)
  const sA = await state(A), sC = await state(C)
  assert.equal(sA.relationships['r-C-1'].chainedInto, null)
  assert.deepEqual(sA.relationships['r-C-1'].tuples.length, 1)
  assert.equal(sA.relationships['r-C-1'].tuples[0].probeIn.hwm, '1', 'C\'s all-padding probe completed (6780)')
  assert.equal(sC.relationships['r-A-1'].tuples[0].probeIn.hwm, '1')
  assert.deepEqual([sA.relationships['r-C-1'].tuples[0].continuityOut.rev, sC.relationships['r-A-1'].tuples[0].continuityOut.rev], ['0', '0'], 'no mapping either way')
  assert.equal(Object.hasOwn(sA.contacts, 'C-1'), true)
  assert.equal(sA.relationships['r-B'].tuples.length, 1, 'the existing relationship is untouched')
})

// ── crafted documents ──────────────────────────────────────────────────

const ctxOf = (p, side) => labeledContext(p.seed, side.label)
const sharedOf = async (p, mine, theirs) => ecdh((await ctxOf(p, mine)).x.priv, xRawOfMk(theirs.keyAgreement))
let padN = 0
const pads = (n) => Array.from({ length: n }, () => { const b = new Uint8Array(32); new DataView(b.buffer).setUint32(0, ++padN); return 'u' + Buffer.from(b).toString('base64url') }).sort()

/** A continuity-probe/0.1 chunk from p's side `mine` to `theirs` (q's side). */
async function probeDoc (p, mine, theirs, { probe = '1', seq = '1', last = true, blinded, threadId = tid('p-1'), mac } = {}) {
  const k = await probeKeyOf(await sharedOf(p, mine, theirs), mine.anchor, theirs.anchor)
  const body = { type: 'continuity-probe@1', probe, seq, last, blinded: blinded ?? pads(256) }
  const doc = { id: crypto.randomUUID(), type: PROBE, issuer: mine.anchor, recipient: theirs.anchor, threadId, issuedAt: iso(T1), payload: { body, proof: { mac: mac ?? await macU(k, J(body)) } } }
  return { envelope: await seal(doc, theirs.keyAgreement), digest: await digestDoc(doc), doc }
}

/** A continuity-mapping/0.1 from p (prior side `prior`, fresh side `mine`) to q's fresh side `theirs` (q's prior side `theirsPrior`). */
async function contDoc (p, { prior, mine, theirs, theirsPrior }, { revision = '1', issuedAt = iso(T1), body: over = {}, swap = false } = {}) {
  const body = { type: 'continuity-mapping@1', prior: prior.anchor, next: mine.anchor, to: theirs.anchor, revision, issuedAt, ...over }
  const a = await sharedOf(p, prior, theirsPrior), b = await sharedOf(p, mine, theirs)
  const m = swap ? await assembleContinuityMapping(body, b, a) : await assembleContinuityMapping(body, a, b)
  const doc = { id: crypto.randomUUID(), type: CMAP, issuer: mine.anchor, recipient: theirs.anchor, threadId: crypto.randomUUID(), issuedAt: iso(T1), payload: m }
  return { envelope: await seal(doc, theirs.keyAgreement), digest: await digestDoc(doc), doc }
}

const at = (r) => [r.disposition, r.stage ?? r.reason, r.ref]

test('probe reception: one assembly per tuple — repeats, conflicts, a higher probe displacing, a lower one refused, the highest completed probe, the resource limit (6690, 6700, 6790, 5340, 5365, 5366)', async () => {
  const A = await person('A', 0x71), B = await person('B', 0x72)
  await net([A, B], [[A, B]])
  const { mine: A2, theirs: B2 } = await meet(A, B, '2')
  const send = async (o) => A.holder.receive((await probeDoc(B, B2, A2, o)).envelope, T1)
  const tupleA = async () => (await state(A)).relationships['r-B-2'].tuples[0].probeIn
  const c1 = await probeDoc(B, B2, A2, { probe: '2', last: false })
  assert.equal((await A.holder.receive(c1.envelope, T1)).disposition, 'unique')
  assert.equal((await A.holder.receive(c1.envelope, T1)).disposition, 'duplicate-known')
  assert.deepEqual(at(await send({ probe: '2', last: false })), ['discarded', 'rejected', 'RLTP-TRU-5260'])
  assert.deepEqual([(await tupleA()).assembly, (await tupleA()).lowerBound], [null, '2'])
  assert.deepEqual(at(await send({ probe: '2', seq: '2' })), ['failed', 8, 'RLTP-TRU-5366'])
  assert.equal((await send({ probe: '3', last: false, threadId: tid('p-3') })).disposition, 'unique')
  const all = pads(512)
  assert.equal((await send({ probe: '4', last: false, threadId: tid('p-4'), blinded: all.slice(0, 256) })).disposition, 'unique', 'a higher probe displaces')
  assert.equal((await tupleA()).assembly.salt, '4')
  assert.deepEqual(at(await send({ probe: '3', seq: '2', threadId: tid('p-3') })), ['failed', 8, 'RLTP-TRU-5340'])
  const bad = await probeDoc(B, B2, A2, { probe: '4', seq: '2', threadId: tid('p-4'), blinded: all.slice(256), mac: 'u' + 'A'.repeat(43) })
  const before = (await state(A)).commitSeq
  assert.deepEqual(at(await A.holder.receive(bad.envelope, T1)), ['failed', 8, 'RLTP-TRU-6670'])
  assert.equal((await state(A)).commitSeq, before, 'an unauthenticated chunk touches nothing')
  const done = await send({ probe: '4', seq: '2', threadId: tid('p-4'), blinded: all.slice(256) })
  assert.equal(done.disposition, 'unique')
  assert.deepEqual([(await tupleA()).hwm, (await tupleA()).assembly], ['4', null], 'the highest completed probe (6690)')
  assert.deepEqual(at(await send({ probe: '4', threadId: tid('p-4b') })), ['failed', 8, 'RLTP-TRU-6700'])
  assert.deepEqual(at(await send({ probe: '3', threadId: tid('p-3b') })), ['failed', 8, 'RLTP-TRU-6700'])
  // a union out of order rejects the delivery; a seq beyond the limit discards it
  const x = pads(512)
  await send({ probe: '5', last: false, threadId: tid('p-5'), blinded: x.slice(256) })
  assert.deepEqual(at(await send({ probe: '5', seq: '2', threadId: tid('p-5'), blinded: x.slice(0, 256) })), ['discarded', 'rejected', 'RLTP-TRU-6760'])
  assert.deepEqual(at(await send({ probe: '6', seq: '65', threadId: tid('p-6') })), ['discarded', 'resource-limit', 'RLTP-TRU-5365'])
  assert.deepEqual([(await tupleA()).hwm, (await tupleA()).lowerBound], ['4', '6'])
  // a deactivated tuple takes nothing (6240)
  await edit(A, (s) => { s.relationships['r-B-2'].tuples[0].deactivated = true })
  assert.deepEqual(at(await send({ probe: '9', threadId: tid('p-9') })), ['failed', 8, 'RLTP-TRU-6240'])
})

test('mapping reception: steps 2–6 of 6940 — to and next, prior in the frozen set, both MACs, the revision rule and the record freeze; a replay chains nothing again (6230, 6270, 6290)', async () => {
  const A = await person('A', 0x73), B = await person('B', 0x74)
  const n = await net([A, B], [[A, B]])
  await trust(A, 'B'); await trust(B, 'A'); await n.pump(T0)
  await meet(A, B, 'x', T0 + 1)                       // a second old strand, never probed
  const { mine: A2, theirs: B2 } = await meet(A, B, '2')
  const recA = isRecordSide(A2.anchor, B2.anchor)
  const [R, N] = recA ? [A, B] : [B, A]
  const sides = (prior) => ({ prior: R.pairs[prior === 'x' ? `${N.name}#x` : N.name], mine: R.pairs[`${N.name}#2`], theirs: N.pairs[`${R.name}#2`], theirsPrior: N.pairs[prior === 'x' ? `${R.name}#x` : R.name] })
  const get = async () => (await state(N)).relationships
  const send = async (prior, o) => N.holder.receive((await contDoc(R, sides(prior), o)).envelope, T1)
  assert.deepEqual(at(await send('0', { body: { to: N.pairs[R.name].anchor } })), ['failed', 8, 'RLTP-TRU-6950'])
  assert.deepEqual(at(await send('0', { body: { prior: R.pairs[`${N.name}#2`].anchor } })), ['failed', 8, 'RLTP-TRU-6960'])
  assert.deepEqual(at(await send('0', { swap: true })), ['failed', 8, 'RLTP-TRU-6970'])
  const first = await send('0', { revision: '2' })
  assert.equal(first.disposition, 'unique')
  assert.deepEqual(first.events.filter((e) => e.type === 'contact.chained').map((e) => [e.contactId, e.from, e.into]), [[R.name, `r-${R.name}-2`, `r-${R.name}`]])
  const chained = await state(N)
  assert.equal(chained.relationships[`r-${R.name}`].activeHead, N.pairs[`${R.name}#2`].label)
  // the same body again under a new document: a repeat, nothing chains again (6230, 6270)
  const again = await send('0', { revision: '2' })
  assert.equal(again.disposition, 'unique')
  assert.deepEqual((await get())[`r-${R.name}`], chained.relationships[`r-${R.name}`])
  assert.deepEqual(chainTuple(await state(N), N.pairs[`${R.name}#2`].label, N.pairs[R.name].label, 10n ** 18n - 1n), 'already')
  assert.deepEqual(at(await send('0', { revision: '2', issuedAt: iso(T1 + 1000) })), ['failed', 9, 'RLTP-TRU-6270'])
  assert.deepEqual(at(await send('0', { revision: '1' })), ['failed', 9, 'RLTP-TRU-6270'])
  assert.deepEqual(at(await send('x', { revision: '3' })), ['failed', 9, 'RLTP-TRU-6290'], 'the record side\'s prior is frozen')
  assert.equal((await send('0', { revision: '3' })).disposition, 'unique', 'a higher revision of the same choice')
  assert.equal((await get())[`r-${R.name}-x`].chainedInto, null, 'the other strand stays apart')
})

test('2145: the appended tuple holds an entry of its own under a later generation — the chain stands behind two entries until the re-issue on the new head (6985) carries the lineage; then they merge (2230, 6560)', async () => {
  const A = await person('A', 0x75), B = await person('B', 0x76)
  const n = await net([A, B], [[A, B]])
  await trust(A, 'B'); await trust(B, 'A'); await n.pump(T0)
  // B rotates its community anchor to generation 2 (set up by hand, without the re-issue rotateAnchor would owe)
  const g = (k) => communityContext(B.seed, B.genesis, k)
  const rot = await makeAnchorRotation(await g(1), await g(2), await g(3))
  await edit(B, (s) => { s.register.community.head = '2'; s.register.lineage = [rot] })
  const { mine: A2 } = await meet(A, B, '2')
  // before the probe runs, B trusts the fresh contact: a mapping under generation 2, with no lineage (6420)
  await trust(B, 'A-2', T1)
  const out = (await B.holder.resume(T1)).outbound
  await n.route(out.filter((o) => o.type === MAPPING), T1)
  let s = await state(A)
  assert.deepEqual([s.contacts.B.anchorHead, s.contacts['B-2'].anchorHead, s.contacts['B-2'].pos], [(await g(1)).anchor, (await g(2)).anchor, '1'])
  // the probes: A chains, the chain stands behind B (its old tuple) and B-2 (the appended one)
  await n.route(out.filter((o) => o.type !== MAPPING), T1)
  const log = await n.pump(T1, { drop: (o) => o.type === MAPPING })   // hold back B's re-issue
  s = await state(A)
  const chain = s.relationships['r-B']
  assert.deepEqual(chain.tuples.map((t) => t.entryId), ['B', 'B-2'])
  assert.deepEqual([s.contacts.B.relIds, s.contacts['B-2'].relIds], [['r-B'], ['r-B']])
  assert.deepEqual(Object.values(s.duties).filter((d) => d.kind === 'merge'), [], 'incomparable heads: no merge yet')
  assert.equal(contactView(s, 'B').id, 'B')
  // B's re-issue on the new head carries the lineage from the chain's earliest generation (6985, 2285)
  const reissue = log.filter((l) => l.dropped === MAPPING)
  assert.ok(reissue.length >= 1)
  const sB = await state(B)
  const headB = sB.relationships['r-A'].tuples.at(-1)
  assert.equal(headB.mappingOut.rev, '2', 'a higher revision on the new head')
  assert.deepEqual(headB.mappingOut.body.lineage, [rot])
  assert.equal(sB.relationships['r-A'].earliestAnchor, (await g(1)).anchor)
  // delivered: the links connect the two heads, the merge runs after the verification
  const resent = (await B.holder.resume(T1 + 60_000)).outbound.filter((o) => o.type === MAPPING)
  assert.ok(resent.length >= 1, 'the outbox retries it')
  await n.route(resent, T1 + 60_000)
  s = await state(A)
  assert.deepEqual(Object.values(s.duties).filter((d) => d.kind === 'merge').map((d) => d.entryIds), [['B', 'B-2']])
  await n.pump(T1 + 60_001)
  s = await state(A)
  assert.deepEqual([Object.keys(s.contacts).sort(), s.contacts.B.aliases, s.contacts.B.pos, s.contacts.B.anchorHead], [['B'], ['B-2'], '0', (await g(2)).anchor])
  assert.deepEqual(s.relationships['r-B'].tuples.map((t) => t.entryId), ['B', 'B'])
  void A2
})

test('N2: failures never bypass the backoff — an immediate transport failure starts no resume→send→failure loop, the gap grows, a superseded probe\'s late failure leaves the duty as it is; a failed choice is resent under its revision once its backoff allows (6710, 6830, 6840)', async () => {
  const A = await person('A', 0x77), B = await person('B', 0x78)
  const n = await net([A, B], [[A, B]])
  await trust(A, 'B'); await trust(B, 'A'); await n.pump(T0)
  const { mine: A2, theirs: B2 } = await meet(A, B, '2')
  const probes = async (when) => (await A.holder.resume(when)).outbound.filter((o) => o.type === PROBE)
  const duty = async () => (await state(A)).duties[`continuity:probe:${A2.label}`]
  const [p1] = await probes(T1)
  const r = await A.holder.report({ digest: p1.digest, status: 'failed', reason: 'unroutable' }, T1 + 1)
  assert.ok(noDutyWake(r.nextDueAt, T0), 'nothing but the far expiry work is due before the backoff')
  assert.deepEqual(await probes(T1 + 2), [], 'no loop')
  assert.equal((await duty()).dueAt, T1 + 30_000)
  const [p2] = await probes(T1 + 30_000)
  assert.equal((await duty()).dueAt, T1 + 90_000, 'the gap grows')
  const [p3] = await probes(T1 + 90_000)
  assert.ok(p2 && p3)
  const before = await duty()
  await A.holder.report({ digest: p2.digest, status: 'failed', reason: 'unroutable' }, T1 + 100_000)
  assert.deepEqual(await duty(), before, 'a superseded probe\'s failure touches nothing')
  const ctx = await labeledContext(B.seed, B2.label)
  const { unseal } = await import('../dist/index.js')
  const open = async (o) => (await unseal(o.envelope, ctx.x.priv)).document.payload.body
  assert.deepEqual([(await open(p1)).probe, (await open(p2)).probe, (await open(p3)).probe], ['1', '2', '3'])
  assert.notDeepEqual((await open(p1)).blinded, (await open(p3)).blinded, 'fresh padding')
  // the probes go through; every continuity mapping is held back
  const T2 = T1 + 100_000
  await n.route([p3], T2, { drop: (o) => o.type === CMAP })
  await n.pump(T2, { drop: (o) => o.type === CMAP })
  const R = isRecordSide(A2.anchor, B2.anchor) ? A : B
  const N = R === A ? B : A
  const t = tupleOf(await state(R), R.pairs[`${N.name}#2`].label)
  assert.notEqual(t.continuityOut.chosen, null, 'the record side chose')
  assert.equal((await state(R)).relationships['r-' + N.name].activeHead, R.pairs[N.name].label, 'a probe hit chains nothing')
  const [d1] = t.continuityOut.sent
  await R.holder.report({ digest: d1, status: 'failed', reason: 'unroutable' }, T2 + 1)
  assert.deepEqual((await R.holder.resume(T2 + 2)).outbound.filter((o) => o.type === CMAP), [], 'not before the backoff')
  const resent = (await R.holder.resume(T2 + 30_000)).outbound.filter((o) => o.type === CMAP)
  assert.equal(resent.length, 1)
  assert.notEqual(resent[0].digest, d1)
  const nctx = await labeledContext(N.seed, N.pairs[`${R.name}#2`].label)
  const body = (await unseal(resent[0].envelope, nctx.x.priv)).document.payload
  assert.equal(J(body.body), J(t.continuityOut.body), 'the same revision and body')
  assert.equal(J(body.proof), J(t.continuityOut.proof))
  await n.route(resent, T2 + 30_000)
  const sN = await state(N)
  assert.equal(sN.relationships['r-' + R.name].activeHead, N.pairs[`${R.name}#2`].label, 'the non-record side chained on it')
  assert.equal((await state(R)).relationships['r-' + N.name].activeHead, R.pairs[`${N.name}#2`].label, 'and the record side on its alignment')
})

test('views: the contact after a re-encounter lists the chained relationship with its tuples and the fresh one it took in; provenance unchanged', async () => {
  const { A, B, n } = await reencounter(0x79)
  const before = await A.holder.contact('B')
  await meet(A, B, '2')
  await n.pump(T1)
  const v = await A.holder.contact('B-2')
  assert.equal(v.id, 'B')
  assert.deepEqual(v.aliases, ['B-2'])
  assert.deepEqual(v.relationships, [{ id: 'r-B', tuples: 2, chainedFrom: ['r-B-2'] }])
  assert.deepEqual([v.provenance, v.verification, v.trust.given, v.trust.received], [before.provenance, 'mutual', true, true])
  assert.deepEqual((await A.holder.contacts()).map((c) => c.id), ['B'])
})

test('5810: a new head that completed no delivery before the chaining diverges by definition — its star goes out under the next salt; one that completed keeps its baseline (5820)', async () => {
  const { A, B, n } = await reencounter(0x7b)
  await meet(A, B, '2')
  // every star before the chaining is lost: A gives its fresh tuple's up
  const log = await n.pump(T1, { drop: (o) => o.type === STAR && n.owner(o.envelope.rkid) === B })
  const lost = log.filter((l) => l.dropped === STAR).map((l) => l.digest)
  assert.ok(lost.length >= 1)
  const head = async () => (await state(A)).relationships['r-B'].tuples.at(-1).starOut
  assert.deepEqual([(await head()).hwm, (await head()).snapshot], ['0', null], 'no completed delivery on the new head')
  for (const d of lost) if ((await state(A)).outbox[d]) await A.holder.report({ digest: d, status: 'failed', reason: 'unroutable' }, T1 + 1)
  const after = await n.pump(T1 + 2)
  const stars = after.filter((l) => l.type === STAR && l.to === 'B')
  assert.ok(stars.length >= 1, 'the initial star goes out on the new head')
  const h = await head()
  assert.equal(h.hwm, h.lastSalt)
  assert.ok(BigInt(h.lastSalt) >= 2n, 'under the next unissued salt')
  assert.deepEqual(await n.pump(T1 + 3), [], 'then the baseline holds')
})

test('B1 (6610, 6605, the 6630 copy row through a chaining): the appended tuple\'s entry holds another binding for the chain\'s anchor — the chaining happens, the chain holds both bindings, the entries stay apart: no merge duty, no contact.merged', async () => {
  const { bindingOf, signRaw, assembleAnchorMapping } = await import('../dist/anchor.js')
  const { A, B, n } = await reencounter(0x7d)
  const { mine: A2, theirs: B2 } = await meet(A, B, '2')
  // before the probe runs, a mapping on the fresh tuple: B's anchor under a binding of its own (a copy)
  const g1 = await communityContext(B.seed, B.genesis, 1)
  const other = await communityContext(new Uint8Array(64).fill(0x5c), B.genesis, 1)
  const cardBody = { type: 'self-card@2', anchor: g1.anchor, keyAgreement: g1.keyAgreement, commit: await bindingOf(other.anchor) }
  const card = { body: cardBody, proof: { proofValue: await signRaw(g1, cardBody) } }
  const pair = await labeledContext(B.seed, B2.label)
  const body = { type: 'anchor-mapping@4', pair: B2.anchor, self: g1.anchor, to: A2.anchor, card, lineage: [], revision: '1', issuedAt: iso(T1) }
  const m = await assembleAnchorMapping(body, await ecdh(pair.x.priv, xRawOfMk(A2.keyAgreement)), await ecdh(g1.x.priv, xRawOfMk(A2.keyAgreement)))
  const doc = { id: crypto.randomUUID(), type: MAPPING, issuer: B2.anchor, recipient: A2.anchor, threadId: crypto.randomUUID(), issuedAt: iso(T1), payload: m }
  assert.equal((await A.holder.receive(await seal(doc, A2.keyAgreement), T1)).disposition, 'unique')
  let s = await state(A)
  assert.deepEqual([s.contacts['B-2'].pos, s.contacts['B-2'].anchorHead, s.contacts.B.anchorHead], ['1', B.self, B.self])
  const merged = []
  A.holder.subscribe((c) => merged.push(...c.events.filter((e) => e.type === 'contact.merged')))
  await n.pump(T1)
  await n.pump(T1 + 60_000)
  s = await state(A)
  const chain = s.relationships['r-B']
  assert.equal(chain.activeHead, A2.label, 'chained (6900)')
  assert.deepEqual(chain.tuples.map((t) => t.entryId), ['B', 'B-2'], 'behind both entries (2145)')
  assert.equal(chain.bindings[B.self].length, 2, 'the union holds both bindings (6610)')
  assert.deepEqual([s.contacts.B.pos, s.contacts['B-2'].pos], ['0', '1'])
  assert.deepEqual(Object.values(s.duties).filter((d) => d.kind === 'merge'), [])
  assert.deepEqual(merged, [])
})

test('C5: at a 2145 chaining the re-issues owed on the chain and on the appended relationship move to the chain under the entry that takes its verifications — one re-issue goes out there (2146, 6596)', async () => {
  const A = await person('A', 0x7f), B = await person('B', 0x80)
  const n = await net([A, B], [[A, B]])
  await trust(A, 'B'); await trust(B, 'A'); await n.pump(T0)
  // B rotates (set up by hand, without its re-issue): A will hold B and B-2 under different generations
  const g = (k) => communityContext(B.seed, B.genesis, k)
  const rot = await makeAnchorRotation(await g(1), await g(2), await g(3))
  await edit(B, (s) => { s.register.community.head = '2'; s.register.lineage = [rot] })
  const { mine: A2 } = await meet(A, B, '2')
  await trust(A, 'B-2', T1); await trust(B, 'A-2', T1)
  const outA = (await A.holder.resume(T1)).outbound, outB = (await B.holder.resume(T1)).outbound
  await n.route([...outA, ...outB].filter((o) => o.type === MAPPING), T1)
  let s = await state(A)
  assert.deepEqual([s.contacts.B.pos, s.contacts['B-2'].pos], ['0', '1'])
  // re-issues owed on both relationships, due later (as a rotation of A leaves them)
  const later = T1 + 600_000
  await edit(A, (x) => {
    x.duties.ra = { kind: 'reissue-mapping', v: 1, id: 'ra', dueAt: later, contactId: 'B', relId: 'r-B', awaitHead: 'did:key:z6MkAwaited' }
    x.duties.rb = { kind: 'reissue-mapping', v: 1, id: 'rb', dueAt: later, contactId: 'B-2', relId: 'r-B-2', awaitHead: null }
  })
  await n.route([...outA, ...outB].filter((o) => o.type !== MAPPING), T1, { drop: (o) => o.type === MAPPING })
  await n.pump(T1, { drop: (o) => o.type === MAPPING })
  s = await state(A)
  assert.equal(s.relationships['r-B'].activeHead, A2.label, 'chained')
  assert.deepEqual(s.relationships['r-B'].tuples.map((t) => t.entryId), ['B', 'B-2'], '2145')
  const owed = Object.values(s.duties).filter((d) => d.kind === 'reissue-mapping')
  assert.deepEqual(owed.map((d) => [d.contactId, d.relId, d.awaitHead]), [['B-2', 'r-B', null]], 'one re-issue, the urgent one, on the chain')
  const out = (await A.holder.resume(later)).outbound.filter((o) => o.type === MAPPING)
  assert.deepEqual(out.map((o) => [o.recipient.contactId, o.recipient.rkid]), [['B-2', A2.keyAgreement]])
})

test('M2: silence without any report — the probe duty stands and a fresh probe (next sequence, fresh padding) goes out after the backoff; the outbox never reproduces a probe (6710, 6830)', async () => {
  const A = await person('A', 0x81), B = await person('B', 0x82)
  await net([A, B], [[A, B]])
  const { theirs: B2 } = await meet(A, B, '2')
  const first = (await A.holder.resume(T1)).outbound.filter((o) => o.type === PROBE)
  assert.equal(first.length, 1)
  const d = (await state(A)).duties[`continuity:probe:${A.pairs['B#2'].label}`]
  assert.deepEqual([d.attempt, d.dueAt], [1, T1 + 30_000], 'standing, due after the backoff')
  assert.deepEqual((await A.holder.resume(T1 + 29_000)).outbound.filter((o) => o.type === PROBE), [], 'not before it; no byte-identical retry')
  const second = (await A.holder.resume(T1 + 30_000)).outbound.filter((o) => o.type === PROBE)
  assert.equal(second.length, 1)
  assert.notEqual(second[0].digest, first[0].digest)
  const { unseal } = await import('../dist/index.js')
  const ctx = await labeledContext(B.seed, B2.label)
  const body = async (o) => (await unseal(o.envelope, ctx.x.priv)).document.payload.body
  const [b1, b2] = [await body(first[0]), await body(second[0])]
  assert.deepEqual([b1.probe, b2.probe], ['1', '2'])
  assert.notDeepEqual(b1.blinded, b2.blinded)
  assert.equal((await state(A)).duties[`continuity:probe:${A.pairs['B#2'].label}`].dueAt, T1 + 30_000 + 60_000, 'the backoff grows')
})

test('M2: a delivered choice without the aligned mapping is resent under its revision after the backoff, until the answer arrives (6840)', async () => {
  const A = await person('A', 0x83), B = await person('B', 0x84)
  const n = await net([A, B], [[A, B]])
  await trust(A, 'B'); await trust(B, 'A'); await n.pump(T0)
  const { mine: A2, theirs: B2 } = await meet(A, B, '2')
  const R = isRecordSide(A2.anchor, B2.anchor) ? A : B
  const N = R === A ? B : A
  // everything N's continuity mappings say to R is lost
  const drop = (o) => o.type === CMAP && n.owner(o.envelope.rkid) === R
  await n.pump(T1, { drop })
  let t = tupleOf(await state(R), R.pairs[`${N.name}#2`].label)
  assert.notEqual(t.continuityOut.chosen, null)
  assert.equal(t.continuityOut.aligned, false)
  assert.equal((await state(R)).relationships['r-' + N.name].activeHead, R.pairs[N.name].label, 'no mapping of N under the prior key arrived: nothing chained')
  const [d1] = t.continuityOut.sent
  assert.equal((await state(R)).outbox[d1].history.at(-1).status, 'delivered', 'the choice was delivered')
  const resent = (await R.holder.resume(T1 + 30_000)).outbound.filter((o) => o.type === CMAP)
  assert.equal(resent.length, 1)
  assert.notEqual(resent[0].digest, d1)
  const { unseal } = await import('../dist/index.js')
  const nctx = await labeledContext(N.seed, N.pairs[`${R.name}#2`].label)
  assert.equal(J((await unseal(resent[0].envelope, nctx.x.priv)).document.payload.body), J(t.continuityOut.body), 'the same revision and body')
  // the answer arrives: the duty ends
  await n.route(resent, T1 + 30_000)
  await n.pump(T1 + 120_000)
  t = (await state(R)).relationships['r-' + N.name].tuples.at(-1)
  assert.equal(t.continuityOut.aligned, true)
  assert.equal(Object.hasOwn((await state(R)).duties, `continuity:mapping:${t.ownPairLabel}`), false)
})

test('C2/C7: a re-encounter after 100 days — tick does not tombstone the deactivated prior\'s key while the fresh tuple\'s flow is open; the mapping still verifies and the alignment completes (6970, 6200)', async () => {
  const DAY = 86_400_000
  const TL = T0 + 100 * DAY
  const A = await person('A', 0x85), B = await person('B', 0x86)
  const n = await net([A, B], [[A, B]])
  await trust(A, 'B'); await trust(B, 'A'); await n.pump(T0)
  const { mine: A2, theirs: B2 } = await meet(A, B, '2', TL)
  const R = isRecordSide(A2.anchor, B2.anchor) ? A : B
  const N = R === A ? B : A
  // the record side's choice reaches N, which chains on it; N's mappings back to R are lost
  await n.pump(TL, { drop: (o) => o.type === CMAP && n.owner(o.envelope.rkid) === R })
  const priorRkid = N.pairs[R.name].keyAgreement
  let sN0 = await state(N)
  assert.equal(sN0.relationships['r-' + R.name].tuples[0].deactivated, true, 'the non-record side chained')
  await R.holder.tick(TL + 1); await N.holder.tick(TL + 1)
  sN0 = await state(N)
  assert.equal(sN0.addresses.tombstones.includes(priorRkid), false, 'the deactivated prior\'s key is kept')
  const log = await n.pump(TL + 60_000)
  assert.deepEqual(log.filter((l) => l.r?.disposition === 'failed').map((l) => l.r.ref), [])
  const sR = await state(R)
  const sN = await state(N)
  assert.equal(sN.relationships['r-' + R.name].activeHead, N.pairs[`${R.name}#2`].label, 'the non-record side chained')
  assert.equal(sR.relationships['r-' + N.name].activeHead, R.pairs[`${N.name}#2`].label, 'the record side chained on the alignment')
  assert.equal(sR.relationships['r-' + N.name].tuples.at(-1).continuityOut.aligned, true, 'the alignment completed')
  // the flow is done: the next tick lets the keys go
  await R.holder.tick(TL + 2); await N.holder.tick(TL + 2)
  assert.equal((await state(N)).addresses.tombstones.includes(priorRkid), true)
  assert.equal((await state(R)).addresses.tombstones.includes(R.pairs[N.name].keyAgreement), true)
})

test('cost: contacts() and openTuple over 400 contacts stay well inside a generous bound (the quadratic reads)', async () => {
  const { standIns } = await import('./star-fixture.mjs')
  const { openTuple, contactsView } = await import('../dist/internal.js')
  const s = standIns(stateBuilder({ at: T0 }), 400).build()
  let t = performance.now()
  for (let i = 0; i < 5; i++) assert.equal(contactsView(s).length, 400)
  const views = (performance.now() - t) / 5
  t = performance.now()
  const r = openTuple(s, { relId: 'r-new', contactId: 'new', ownPairLabel: 'pair/new', counterpartAnchor: 'did:key:znew', counterpartKeyAgreement: 'z6LSnew' }, 'z6LSownnew', T1)
  const open = performance.now() - t
  assert.equal(r.state.relationships['r-new'].tuples[0].priorCandidates.length, 400)
  assert.ok(views < 1000, `contacts() took ${views.toFixed(1)} ms`)
  assert.ok(open < 1000, `openTuple took ${open.toFixed(1)} ms`)
})

test('N1: the answer to a choice is the aligned mapping under a higher revision — a repeated report is ignored and the duty stands; the alignment ends it; a late ack of the earlier report completes no alignment (6270, 6840, 6930)', async () => {
  const A = await person('A', 0x87), B = await person('B', 0x88)
  const n = await net([A, B], [[A, B]])
  await trust(A, 'B'); await trust(B, 'A'); await n.pump(T0)
  const { mine: A2, theirs: B2 } = await meet(A, B, '2')
  const R = isRecordSide(A2.anchor, B2.anchor) ? A : B
  const N = R === A ? B : A
  const toN = (o) => n.owner(o.envelope.rkid) === N
  const outR = (await R.holder.resume(T1)).outbound
  await N.holder.resume(T1)                       // N's probe never reaches R
  // R's probe reaches N: N reports; the report reaches R, who chooses from it; the choice is lost
  await n.route(outR.filter((o) => o.type === PROBE), T1, { drop: (o) => o.type === CMAP && toN(o) })
  const tR = () => state(R).then((s) => s.relationships['r-' + N.name].tuples.at(-1))
  const tN = () => state(N).then((s) => s.relationships['r-' + R.name + '-2']?.tuples[0] ?? s.relationships['r-' + R.name].tuples.at(-1))
  assert.notEqual((await tR()).continuityOut.chosen, null)
  assert.deepEqual([(await tR()).continuityIn.rev, (await tN()).continuityOut.rev], ['1', '1'], 'R chose from N\'s report (rev 1)')
  const dutyR = `continuity:mapping:${(await tR()).ownPairLabel}`
  // N resends its report under its revision: at R a repeat — ignored, the choice duty stands; its ack is held back
  const resend = (await N.holder.resume(T1 + 30_000)).outbound.filter((o) => o.type === CMAP)
  assert.equal(resend.length, 1)
  const rep = await R.holder.receive(resend[0].envelope, T1 + 30_000)
  assert.equal(rep.disposition, 'unique')
  const lateAck = rep.outbound.find((o) => o.type === 'https://real-life.org/trust-tasks/delivery-ack/0.1')
  assert.equal((await tR()).continuityOut.aligned, false)
  assert.ok(Object.hasOwn((await state(R)).duties, dutyR), 'the choice duty stands')
  // R's choice is resent; N verifies, chains and aligns under revision 2; its alignment is held back
  const choice = (await R.holder.resume(T1 + 60_000)).outbound.filter((o) => o.type === CMAP)
  assert.equal(choice.length, 1)
  const v = await N.holder.receive(choice[0].envelope, T1 + 60_000)
  assert.equal(v.disposition, 'unique')
  const align = v.outbound.filter((o) => o.type === CMAP)
  assert.equal(align.length, 1)
  let o = (await tN()).continuityOut
  assert.deepEqual([o.rev, o.align, o.aligned], ['2', true, false], 'a new issuance under the next revision (6930)')
  // the late ack of the earlier report completes nothing of the alignment
  assert.equal((await N.holder.receive(lateAck.envelope, T1 + 60_000)).disposition, 'unique')
  o = (await tN()).continuityOut
  assert.equal(o.aligned, false, 'the alignment duty stays')
  // the alignment arrives: R's duty ends; its ack ends N's
  await n.route(align, T1 + 60_000)
  assert.equal((await tR()).continuityOut.aligned, true)
  assert.equal(Object.hasOwn((await state(R)).duties, dutyR), false)
  assert.equal((await tN()).continuityOut.aligned, true)
})

test('cost: tick with continuityKeys over 200 open continuity flows, each naming 200 deactivated priors, stays inside a generous bound', async () => {
  const { createEngine, trustModule } = await import('../dist/internal.js')
  const { seedKeys } = await import('../dist/index.js')
  const N = 200
  const b = stateBuilder({ at: T0 })
  const priors = Array.from({ length: N }, (_, i) => ({ ownPairLabel: `pair/p${i}`, counterpartAnchor: `did:key:zp${i}` }))
  for (let i = 0; i < N; i++) {
    b.relationship(`r${i}`, {
      contactId: `c${i}`,
      tuples: [
        { ownPairLabel: `pair/p${i}`, counterpartAnchor: `did:key:zp${i}`, counterpartKeyAgreement: `z6LSp${i}`, rkid: `z6LSownp${i}`, deactivated: true },
        { ownPairLabel: `pair/t${i}`, counterpartAnchor: `did:key:zt${i}`, counterpartKeyAgreement: `z6LSt${i}`, rkid: `z6LSownt${i}`, priorCandidates: priors },
      ],
    })
  }
  const s0 = b.build()
  const { continuityKeys } = await import('../dist/trust/continuity.js')
  let t = performance.now()
  assert.equal(continuityKeys(s0).length, N)
  const keys = performance.now() - t
  const store = new InMemoryStore()
  await store.commit(null, s0)
  const e = await createEngine({ store, keys: seedKeys(new Uint8Array(64).fill(3)) }, [trustModule()])
  t = performance.now()
  await e.tick(T0 + 100 * 86_400_000)
  const ms = performance.now() - t
  const s = (await store.read()).state
  assert.equal(s.addresses.tombstones.filter((k) => k.startsWith('z6LSownp')).length, 0, 'every prior key kept while its flows are open')
  // measured: continuityKeys about 12 ms; tick about 700 ms, nearly all of it
  // the codec's decode and encode of the 40 000 prior-candidate entries
  assert.ok(keys < 250, `continuityKeys took ${keys.toFixed(1)} ms`)
  assert.ok(ms < 3000, `tick took ${ms.toFixed(1)} ms`)
})

/*
 * Trace of the one-sided chaining the invariants generator met (seed 5,
 * steps 23–169; reported first on seed 50), reduced to its cause:
 *
 *   A and C met four times while no chaining had completed (#3, #4 at
 *   step 23/24, #5 at 31, #6 at 56). Each fresh pair has its own record
 *   side (isRecordSide over the pair's new anchors): A for #3 and #4, C
 *   for #5 and #6. Each record side chose, per 6900/6910, the first match
 *   still an active head — and the two chose against different states:
 *     A: original ← #3 (A's choice for #3), then #3 ← #4 (A's choice for #4)
 *     C: original ← #5 (C's choice for #5), then #3 ← #6 (C's choice for #6)
 *   Each side then refused the other's record mappings: their prior had
 *   been taken by a competing chaining (6900 refusal, the library's reading
 *   where 6960's snapshot admits the prior but nothing says onto what the
 *   receiver appends). Nothing was dropped, lost or failed: every document
 *   arrived, every duty ran. The end state: A's chain toward C holds #4 as
 *   its head; C keeps #4 as a relationship of its own (r-A-4, never
 *   chained), whose earliest anchor (2285) is the generation C first
 *   issued there. C had issued nothing there before it rotated, so its
 *   mapping on #4 carries the lineage from that anchor — none — while A,
 *   on its chain, holds C's earlier generation: 6170 refuses it, on every
 *   re-issue, for good. (Had C issued on #4 before rotating, the segment
 *   from that generation would reach A; the divergent chains and the
 *   never-ending continuity duty of 6990 remain either way.)
 *
 * Since spec follow-up 17 the refusal is 6960: each side's chaining put
 * its own new head in the prior's place in the competing flow, so the
 * counterpart's report and alignment name a prior no longer among the
 * candidates; the record side's re-choice on its head meets a counterpart
 * already chained onto the original (6960 there too). The race stays.
 *
 * The test below reproduces it with two re-encounters, A recording one and
 * C the other, the record sides' mappings held back until both chose.
 */
test('one-sided chaining: two re-encounters with different record sides race for one prior — the two record choices cross, each non-record side chains on the one it got, refuses the other\'s (6960 after the substitution of follow-up 17), and after a rotation the unchained side\'s mapping is refused for good (6170): a Trust 0.32 gap', async () => {
  const A = await person('A', 0x5a), C = await person('C', 0x5c)
  const n = await net([A, C], [[A, C]])
  await trust(A, 'C'); await trust(C, 'A')
  await n.pump(T0)
  // two fresh pairs: C records x, A records y
  const pairWith = async (record) => {
    for (;;) {
      const a = await pairSide(A), c = await pairSide(C)
      if (isRecordSide(a.anchor, c.anchor) === (record === A)) return { a, c }
    }
  }
  const x = await pairWith(C), y = await pairWith(A)
  for (const [name, s] of [['x', x], ['y', y]]) {
    A.pairs[`C#${name}`] = s.a; C.pairs[`A#${name}`] = s.c
    assert.equal((await A.holder.act('continuity.newTuple', { relId: `r-C-${name}`, contactId: `C-${name}`, ownPairLabel: s.a.label, counterpartAnchor: s.c.anchor, counterpartKeyAgreement: s.c.keyAgreement }, T1)).ok, true)
    assert.equal((await C.holder.act('continuity.newTuple', { relId: `r-A-${name}`, contactId: `A-${name}`, ownPairLabel: s.c.label, counterpartAnchor: s.a.anchor, counterpartKeyAgreement: s.a.keyAgreement }, T1)).ok, true)
  }
  // the probes cross; every continuity mapping is held back: both record sides chose, neither chained on its hit
  const held = []
  const hold = (o) => { if (o.type === CMAP) { held.push(o); return true } return false }
  const out = [...(await A.holder.resume(T1)).outbound, ...(await C.holder.resume(T1)).outbound]
  await n.route(out, T1, { drop: hold })
  const chainOf = async (p, relId) => (await state(p)).relationships[relId].tuples.map((t) => t.ownPairLabel)
  assert.deepEqual([await chainOf(A, 'r-C'), await chainOf(C, 'r-A')], [[A.pairs.C.label], [C.pairs.A.label]], 'a probe hit chains nothing')
  // the two record choices cross: C's on x reaches A, A's on y reaches C; each non-record side chains on it (6900)
  const choices = held.filter((o) => o.envelope.rkid === x.a.keyAgreement || o.envelope.rkid === y.c.keyAgreement)
  assert.equal(choices.length, 2)
  await n.route(choices, T1, { drop: (o) => !choices.includes(o) && hold(o) })
  assert.deepEqual(await chainOf(A, 'r-C'), [A.pairs.C.label, x.a.label], 'A, the non-record side of x, chained x')
  assert.deepEqual(await chainOf(C, 'r-A'), [C.pairs.A.label, y.c.label], 'C, the non-record side of y, chained y')
  // the rest arrives: each report and alignment names a prior the other side's chaining took
  const log = await n.route(held.filter((o) => !choices.includes(o)), T1 + 1)
  const refused = log.filter((l) => l.r?.disposition === 'failed').map((l) => [l.to, l.r.ref])
  // each record side refuses the counterpart's report and its alignment: their prior left its
  // prior-candidate set, substituted by the head its own chaining appended (spec follow-up 17, 6960)
  assert.deepEqual(refused.filter(([, ref]) => ref === 'RLTP-TRU-6960').map(([to]) => to).sort(), ['A', 'A', 'C', 'C'])
  await n.pump(T1 + 2)
  let sA = await state(A), sC = await state(C)
  assert.equal(sA.relationships['r-C-x'].chainedInto, 'r-C')
  assert.equal(sC.relationships['r-A-x'].chainedInto, null, 'C keeps x as a relationship of its own: one-sided')
  assert.equal(sC.relationships['r-A-y'].chainedInto, 'r-A')
  assert.equal(sA.relationships['r-C-y'].chainedInto, null, 'and A keeps y: the mirror image')
  // the net still made one entry of them at C (2145): C's r-A (earliest anchor generation 1) and r-A-x
  assert.deepEqual([Object.keys(sC.contacts), sC.contacts.A.relIds], [['A'], ['r-A', 'r-A-x']])
  // x's standing mapping duty at C never ends: neither chained nor pending transport (6990)
  assert.equal(Object.values(sC.duties).filter((d) => d.kind === 'continuity' && d.tuple === x.c.label).length, 1)
  // C rotates before anything went out on x (its class-on duty there has not run yet); its mapping on x —
  // its own relationship, earliest anchor the new generation (2285) — carries no lineage
  const g = (k) => communityContext(C.seed, C.genesis, k)
  const rot = await makeAnchorRotation(await g(1), await g(2), await g(3))
  await edit(C, (s) => { s.register.community.head = '2'; s.register.lineage = [rot] })
  await C.holder.act('trust.set', { contactId: 'A-x', on: true }, T1 + 3, { actId: 'C-trusts-A-x' })
  const issued = (await C.holder.resume(T1 + 3)).outbound.filter((o) => o.type === MAPPING && o.envelope.rkid === x.a.keyAgreement)
  assert.equal(issued.length, 1)
  sC = await state(C)
  assert.equal(sC.relationships['r-A-x'].earliestAnchor, (await g(2)).anchor)
  assert.deepEqual(sC.relationships['r-A-x'].tuples[0].mappingOut.body.lineage, [], 'nothing earlier was issued on C\'s r-A-x (6420)')
  // A holds C's generation 1 on its chain r-C, whose head is x: an unlinked change of self
  const r = await A.holder.receive(issued[0].envelope, T1 + 4)
  assert.deepEqual([r.disposition, r.ref], ['failed', 'RLTP-TRU-6170'])
  sA = await state(A)
  assert.equal(sA.relationships['r-C'].heldCounterpartHead, (await g(1)).anchor)
})

// ── IB: a probe hit is no evidence of the prior relationship ───────────

/** A fresh pair of p and q with `record` its record side, opened on both. */
async function freshPair (p, q, name, record, when = T1) {
  for (;;) {
    const mine = await pairSide(p), theirs = await pairSide(q)
    if (isRecordSide(mine.anchor, theirs.anchor) !== (record === p)) continue
    p.pairs[`${q.name}#${name}`] = mine; q.pairs[`${p.name}#${name}`] = theirs
    for (const [x, own, other, otherSide] of [[p, mine, q, theirs], [q, theirs, p, mine]]) {
      assert.equal((await x.holder.act('continuity.newTuple', { relId: `r-${other.name}-${name}`, contactId: `${other.name}-${name}`, ownPairLabel: own.label, counterpartAnchor: otherSide.anchor, counterpartKeyAgreement: otherSide.keyAgreement }, when)).ok, true)
    }
    return { mine, theirs }
  }
}

test('IB: a third holder that learned R\'s pair anchor toward H probes H — H, the record side, issues its choice but chains nothing; a forged report fails mac1; the honest R still chains both ways (6900, 6970)', async () => {
  const H = await person('H', 0x91), R = await person('R', 0x92), X = await person('X', 0x93)
  const n = await net([H, R, X], [[H, R]])
  await trust(H, 'R'); await trust(R, 'H'); await n.pump(T0)
  const before = (await state(H)).relationships['r-R']
  // X meets H afresh, H the record side; X's probe blinds R's anchor toward H (a photographed card)
  const { mine: H2, theirs: X2 } = await freshPair(H, X, '2', H)
  const k = await probeKeyOf(await sharedOf(X, X2, H2), X2.anchor, H2.anchor)
  const blinded = [await blindPrior(k, R.pairs.H.anchor), ...pads(255)].sort()
  const probe = await probeDoc(X, X2, H2, { blinded })
  const r = await H.holder.receive(probe.envelope, T1)
  assert.equal(r.disposition, 'unique')
  assert.deepEqual(r.events.filter((e) => e.type === 'contact.chained'), [], 'no contact.chained')
  assert.equal(r.outbound.filter((o) => o.type === CMAP).length, 1, 'the choice goes out: a candidate')
  let sH = await state(H)
  assert.equal(tupleOf(sH, H2.label).continuityOut.chosen, H.pairs.R.label)
  assert.deepEqual(sH.relationships['r-R'], before, 'the H–R tuples unchanged')
  assert.equal(sH.relationships['r-X-2'].chainedInto, null)
  // X cannot answer under the prior key: a report naming R's anchor fails mac1
  const fake = await pairSide(X)
  const forged = await contDoc(X, { prior: { ...fake, anchor: R.pairs.H.anchor }, mine: X2, theirs: H2, theirsPrior: H.pairs.R })
  assert.deepEqual(at(await H.holder.receive(forged.envelope, T1 + 1)), ['failed', 8, 'RLTP-TRU-6970'])
  await n.pump(T1 + 2)
  sH = await state(H)
  assert.deepEqual(sH.relationships['r-R'].tuples, before.tuples, 'still unchained')
  assert.equal(sH.relationships['r-X-2'].activeHead, H2.label, 'X stays a relationship of its own')
  // the honest R meets H again: both sides chain
  const { mine: H3, theirs: R3 } = await meet(H, R, '3', T1 + 3)
  await n.pump(T1 + 3)
  sH = await state(H)
  const sR = await state(R)
  assert.deepEqual(sH.relationships['r-R'].tuples.map((t) => [t.ownPairLabel, t.deactivated]), [[H.pairs.R.label, true], [H3.label, false]])
  assert.deepEqual(sR.relationships['r-H'].tuples.map((t) => [t.ownPairLabel, t.deactivated]), [[R.pairs.H.label, true], [R3.label, false]])
  assert.deepEqual([sH.relationships['r-X-2'].chainedInto, sH.relationships['r-X-2'].activeHead], [null, H2.label], 'X is never chained')
})

test('IB: the record side\'s choice survives a restart before the counterpart\'s mapping arrives; that mapping chains it then (6900, 6970)', async () => {
  const A = await person('A', 0x94), B = await person('B', 0x95)
  const n = await net([A, B], [[A, B]])
  await trust(A, 'B'); await trust(B, 'A'); await n.pump(T0)
  await freshPair(A, B, '2', A)
  // B's mappings to A are held; A chose on its hit
  const held = []
  await n.pump(T1, { drop: (o) => { if (o.type === CMAP && n.owner(o.envelope.rkid) === A) { held.push(o); return true } return false } })
  assert.equal((await state(B)).relationships['r-A'].activeHead, B.pairs['A#2'].label, 'B chained on A\'s choice')
  assert.equal((await state(A)).relationships['r-B'].activeHead, A.pairs.B.label, 'A did not chain on its hit')
  assert.notEqual(tupleOf(await state(A), A.pairs['B#2'].label).continuityOut.chosen, null)
  assert.ok(held.length >= 1)
  // restart: a new holder over the same store
  A.holder = await createHolder({ store: A.store, keys: A.keys }, { modules: [continuityTestModule] })
  const log = await n.route(held, T1 + 1)
  assert.deepEqual(log.filter((l) => l.r?.disposition === 'failed').map((l) => l.r.ref), [])
  assert.ok(log.some((l) => l.r?.events?.some((e) => e.type === 'contact.chained')), 'contact.chained on B\'s mapping')
  const sA = await state(A)
  assert.deepEqual(sA.relationships['r-B'].tuples.map((t) => [t.ownPairLabel, t.deactivated]), [[A.pairs.B.label, true], [A.pairs['B#2'].label, false]])
  await n.pump(T1 + 120_000)
  assert.equal(tupleOf(await state(A), A.pairs['B#2'].label).continuityOut.aligned, true)
})

test('m1: chaining merges contact memory per key — the chain\'s introducedName and vouchedBy win; the group-star pairs merge per group, the appended head\'s newer pair winning (2280, 5580, 5770)', async () => {
  const { A, B, n } = await reencounter(0x97)
  await meet(A, B, '2')
  await edit(A, (s) => {
    s.relationships['r-B'].memory = { introducedName: 'Old', vouchedBy: 'M', groupMembers: { G1: { member: 'old', memberOp: '1' }, G0: { member: 'kept', memberOp: '1' } } }
    s.relationships['r-B-2'].memory = { introducedName: 'New', groupMembers: { G1: { member: 'new', memberOp: '2' }, G2: { member: 'x', memberOp: '1' } } }
  })
  await n.pump(T1)
  const chain = (await state(A)).relationships['r-B']
  assert.equal(chain.activeHead, A.pairs['B#2'].label, 'chained')
  assert.deepEqual(chain.memory, {
    introducedName: 'Old', vouchedBy: 'M',
    groupMembers: { G0: { member: 'kept', memberOp: '1' }, G1: { member: 'new', memberOp: '2' }, G2: { member: 'x', memberOp: '1' } },
  })
})

// ── candidate substitution: a double scan under a transport outage ───

/**
 * Spec follow-up 17 (2300). A and B hold P (met, both trusted, mappings
 * exchanged, settled). With the transport down they meet twice: fresh
 * tuples F1 at T1 and F2 a minute later on each side (record sides rec1,
 * rec2), both enactments complete, everything that goes out held. F1's
 * frozen candidates are {P}, F2's {P, F1}. Then the transport returns and
 * the held traffic arrives in `order` (F1's first, F2's first, or as the
 * holders put it out); tick and pump hourly for eight hours, then once
 * more.
 */
async function doubleScan (fill, order, rec1, rec2) {
  const A = await person('A', fill), B = await person('B', fill + 1)
  const n = await net([A, B], [[A, B]])
  await trust(A, 'B'); await trust(B, 'A'); await n.pump(T0)
  const f1 = await freshPair(A, B, 'F1', rec1 === 'A' ? A : B, T1)
  const f2 = await freshPair(A, B, 'F2', rec2 === 'A' ? A : B, T1 + 60_000)
  // the outage: what goes out is held, nothing is delivered
  const held = [...(await A.holder.resume(T1 + 61_000)).outbound, ...(await B.holder.resume(T1 + 61_000)).outbound]
  const on = (f, o) => f.mine.keyAgreement === o.envelope.rkid || f.theirs.keyAgreement === o.envelope.rkid
  const ofF = (o) => (on(f1, o) ? 1 : on(f2, o) ? 2 : 0)
  const sorted = order === 'F1-first' ? [...held].sort((a, b) => ofF(a) - ofF(b))
    : order === 'F2-first' ? [...held].sort((a, b) => ofF(b) - ofF(a))
    : held
  const log = await n.route(sorted, T1 + 120_000)
  let t = T1 + 120_000
  for (let i = 0; i < 8; i++) {
    t += 3_600_000
    await A.holder.tick(t); await B.holder.tick(t)
    log.push(...await n.pump(t))
  }
  const after = await n.pump(t + 1)
  return { A, B, f1, f2, held, ofF, log, after }
}

/** What each side ends with, for the assertion messages. */
async function outcome ({ A, B, held, ofF, log }) {
  const out = {}
  for (const P of [A, B]) {
    const s = await state(P)
    out[P.name] = {
      contacts: Object.values(s.contacts).map((c) => [c.id, c.relIds]),
      live: Object.values(s.relationships).filter((r) => r.tuples.length > 0).map((r) => [r.id, r.tuples.length]),
      duties: Object.values(s.duties).map((d) => [d.kind, d.step, d.relId, d.attempt ?? 0]),
    }
  }
  out.probes = held.filter((o) => o.type === PROBE).map(ofF)
  out.failed = log.filter((l) => l.r?.disposition === 'failed').map((l) => [l.to, l.type.split('/').at(-2), l.r.ref])
  out.chained = log.flatMap((l) => (l.r?.events ?? []).filter((e) => e.type === 'contact.chained').map((e) => [l.to, e.from, e.into]))
  return out
}

for (const order of ['F1-first', 'F2-first', 'interleaved']) {
  for (const [r1, r2] of [['A', 'A'], ['A', 'B']]) {
    test(`substitution: a double scan under a transport outage heals into one entry and one chain of P, F1 and F2, no continuity duty left (${order}, record sides ${r1}/${r2}; follow-up 17, 2300, 6800, 6900, 6990)`, async () => {
      const res = await doubleScan(0xa0, order, r1, r2)
      const why = JSON.stringify(await outcome(res))
      const chains = []
      for (const [P, other, fr] of [[res.A, 'B', (f) => f.mine.label], [res.B, 'A', (f) => f.theirs.label]]) {
        const s = await state(P)
        assert.equal(Object.keys(s.contacts).length, 1, `${P.name}: one contact entry — ${why}`)
        const live = Object.values(s.relationships).filter((r) => r.tuples.length > 0)
        assert.deepEqual(live.map((r) => r.id), ['r-' + other], `${P.name}: one relationship — ${why}`)
        const chain = live[0].tuples.map((t) => t.ownPairLabel)
        assert.equal(chain[0], P.pairs[other].label, `${P.name}: the chain starts at P — ${why}`)
        assert.deepEqual([...chain.slice(1)].sort(), [fr(res.f1), fr(res.f2)].sort(), `${P.name}: F1 and F2 appended — ${why}`)
        chains.push(chain.slice(1).map((l) => (l === fr(res.f1) ? 'F1' : 'F2')))
        assert.deepEqual(Object.values(s.duties).filter((d) => d.kind === 'continuity'), [], `${P.name}: no continuity duty left — ${why}`)
      }
      assert.deepEqual(chains[0], chains[1], `both sides hold the same chain — ${why}`)
      assert.deepEqual(res.after, [], 'quiet')
    })
  }
}

test('substitution, unit: substitutePrior puts the new head in the consumed prior\'s place, keeps the position, drops a duplicate, re-targets a choice, a report and the record prior, owes the re-issue, and leaves the head and the input alone; a second chaining substitutes again (follow-up 17, 2300, 6290)', async () => {
  const { A, B } = await reencounter(0xa8)
  await meet(A, B, 'F1'); await meet(A, B, 'F2', T1 + 1); await meet(A, B, 'F3', T1 + 2)
  const P = A.pairs.B.label
  const [F1, F2, F3] = ['F1', 'F2', 'F3'].map((x) => A.pairs[`B#${x}`].label)
  const ref = (x) => ({ ownPairLabel: A.pairs[`B#${x}`].label, counterpartAnchor: B.pairs[`A#${x}`].anchor })
  const s0 = structuredClone(await state(A))
  const cand = (s, l) => tupleOf(s, l).priorCandidates.map((pc) => pc.ownPairLabel)
  assert.deepEqual([cand(s0, F1), cand(s0, F2), cand(s0, F3)], [[P], [P, F1], [P, F1, F2]], 'frozen at creation (2300)')
  // F1 chose P on a hit (record side); F3 reported P (non-record side)
  tupleOf(s0, F1).continuityOut = { ...tupleOf(s0, F1).continuityOut, rev: '1', chosen: P }
  tupleOf(s0, F3).continuityOut = { ...tupleOf(s0, F3).continuityOut, rev: '1', reported: P }
  const before = structuredClone(s0)
  const s1 = substitutePrior(s0, P, F2)
  assert.deepEqual(s0, before, 'pure: the input unchanged')
  const Pc = B.pairs.A.anchor
  assert.deepEqual(tupleOf(s1, F1).priorCandidates, [{ ...ref('F2'), replaces: [Pc] }], 'F2 in P\'s place, standing for P in this flow')
  assert.deepEqual(tupleOf(s1, F3).priorCandidates, [{ ...ref('F2'), replaces: [Pc] }, ref('F1')], 'same position, the duplicate dropped')
  assert.deepEqual(tupleOf(s1, F2), tupleOf(s0, F2), 'the head itself untouched')
  const o1 = tupleOf(s1, F1).continuityOut
  assert.deepEqual([o1.rev, o1.chosen, o1.due], ['1', null, { kind: 'choice', prior: F2, alts: [] }], 'the record side\'s choice owed again on the head; the next revision when issued')
  const o3 = tupleOf(s1, F3).continuityOut
  assert.deepEqual([o3.reported, o3.due], [P, { kind: 'report', prior: F2 }], 'the non-record side\'s report owed again naming the head')
  for (const l of [F1, F3]) {
    const d = s1.duties[`continuity:mapping:${l}`]
    assert.deepEqual([d.step, d.tuple, d.dueAt], ['mapping', l, undefined], 'the mapping duty, due at once')
  }
  assert.equal(Object.hasOwn(s1.duties, `continuity:mapping:${F2}`), false)
  // transitive: F3 chained onto F2 later; F1's candidate moves on
  const s2 = substitutePrior(s1, F2, F3)
  assert.deepEqual(tupleOf(s2, F1).priorCandidates, [{ ...ref('F3'), replaces: [Pc, ref('F2').counterpartAnchor] }], 'F3 stands for P and F2')
  assert.deepEqual(tupleOf(s2, F1).continuityOut.due, { kind: 'choice', prior: F3, alts: [] })
  // the frozen record prior (6290) follows the substitution; the alignment is owed naming the head
  const s3 = structuredClone(await state(A))
  tupleOf(s3, F1).continuityOut = { ...tupleOf(s3, F1).continuityOut, rev: '1', reported: P }
  tupleOf(s3, F1).continuityIn = { ...tupleOf(s3, F1).continuityIn, recordPrior: B.pairs.A.anchor }
  const s4 = substitutePrior(s3, P, F2)
  assert.equal(tupleOf(s4, F1).continuityIn.recordPrior, B.pairs['A#F2'].anchor)
  assert.deepEqual(tupleOf(s4, F1).continuityOut.due, { kind: 'align', prior: F2 })
  // a prior named nowhere: nothing changes
  assert.equal(substitutePrior(s3, 'pair/none', F2), s3)
})

test('substitution, same side: the record side chose P for F1 on a hit when F2 consumed P — F1 re-chooses F2 under the next revision, the counterpart chains it; the stale choice on P is refused; one entry, the chain P → F2 → F1 (follow-up 17, 6900, 6970)', async () => {
  const A = await person('A', 0xa9), B = await person('B', 0xaa)
  const n = await net([A, B], [[A, B]])
  await trust(A, 'B'); await trust(B, 'A'); await n.pump(T0)
  const f1 = await freshPair(A, B, 'F1', A, T1)
  const f2 = await freshPair(A, B, 'F2', A, T1 + 60_000)
  const held = [...(await A.holder.resume(T1 + 61_000)).outbound, ...(await B.holder.resume(T1 + 61_000)).outbound]
  const onF1 = (o) => o.envelope.rkid === f1.mine.keyAgreement || o.envelope.rkid === f1.theirs.keyAgreement
  const later = []
  const keep = (o) => { if (onF1(o)) { later.push(o); return true } return false }
  // B's probe on F1 reaches A: A, its record side, chooses P on the hit and chains nothing (follow-up 14)
  const probeB = held.filter((o) => o.type === PROBE && o.envelope.rkid === f1.mine.keyAgreement)
  await n.route(probeB, T1 + 120_000, { drop: (o) => !probeB.includes(o) && keep(o) })
  assert.equal(tupleOf(await state(A), f1.mine.label).continuityOut.chosen, A.pairs.B.label)
  const stale = later.filter((o) => o.type === CMAP)
  assert.equal(stale.length, 1, 'the choice on P, held')
  // F2 completes on both sides, nothing of F1 delivered: F2 chains onto P
  await n.route(held.filter((o) => !onF1(o)), T1 + 120_000, { drop: keep })
  await n.pump(T1 + 120_000, { drop: keep })
  for (const [P, other, f] of [[A, 'B', f2.mine], [B, 'A', f2.theirs]]) assert.equal((await state(P)).relationships['r-' + other].activeHead, f.label, `${P.name}: F2 chained`)
  // at A, F1's candidate P became F2 (A's own chaining substituted it); the
  // choice was owed again and the mapping duty issued it under revision 2, held
  let x = tupleOf(await state(A), f1.mine.label)
  assert.deepEqual(x.priorCandidates, [{ ownPairLabel: f2.mine.label, counterpartAnchor: f2.theirs.anchor, replaces: [B.pairs.A.anchor] }])
  assert.deepEqual([x.continuityOut.chosen, x.continuityOut.rev, x.continuityOut.due], [f2.mine.label, '2', null])
  assert.equal(later.filter((o) => o.type === CMAP && o.envelope.rkid === f1.theirs.keyAgreement).length, 2, 'the choice on P and the re-choice on F2, held')
  // and at B, which chained F2 on A's choice
  assert.deepEqual(tupleOf(await state(B), f1.theirs.label).priorCandidates, [{ ownPairLabel: f2.theirs.label, counterpartAnchor: f2.mine.anchor, replaces: [A.pairs.B.anchor] }])
  // the transport is back: the re-choice goes out under revision 2, B chains F1 onto F2 and aligns
  await n.route([...held.filter(onF1), ...later.filter((o) => !stale.includes(o))], T1 + 180_000)
  await n.pump(T1 + 180_000)
  // the stale choice on P arrives last: refused (6960), nothing changes
  const late = await n.route(stale, T1 + 181_000)
  assert.deepEqual([late[0].r.disposition, late[0].r.ref], ['failed', 'RLTP-TRU-6960'], 'P is no candidate of F1 at B any more')
  for (let t = T1 + 3_600_000; t < T1 + 4 * 3_600_000; t += 3_600_000) { await A.holder.tick(t); await B.holder.tick(t); await n.pump(t) }
  x = tupleOf(await state(A), f1.mine.label)
  assert.deepEqual([x.continuityOut.chosen, x.continuityOut.rev, x.continuityOut.aligned], [f2.mine.label, '2', true], 'the re-choice: F2, the next revision, answered')
  for (const [P, other, f] of [[A, 'B', f1.mine], [B, 'A', f1.theirs]]) {
    const s = await state(P)
    assert.deepEqual(Object.keys(s.contacts), [other], `${P.name}: one entry`)
    assert.deepEqual(s.relationships['r-' + other].tuples.map((t) => [t.ownPairLabel, t.deactivated]),
      [[P.pairs[other].label, true], [(P === A ? f2.mine : f2.theirs).label, true], [f.label, false]], `${P.name}: P → F2 → F1`)
    assert.deepEqual(Object.values(s.duties).filter((d) => d.kind === 'continuity'), [], `${P.name}: no continuity duty left`)
  }
})

test('substitution, security: a third holder that learned R\'s pair anchor probes H and gets a hit — nothing substitutes for any flow, nothing chains, P stays; only the honest chaining substitutes, and the third holder still cannot chain (follow-up 14, 17, 6970)', async () => {
  const H = await person('H', 0xab), R = await person('R', 0xac), X = await person('X', 0xad)
  const n = await net([H, R, X], [[H, R]])
  await trust(H, 'R'); await trust(R, 'H'); await n.pump(T0)
  const before = (await state(H)).relationships['r-R']
  // H and R meet afresh (F), held: F's flow at H stays open on its candidate P
  const { mine: HF, theirs: RF } = await freshPair(H, R, 'F', H, T1)
  const heldF = [...(await H.holder.resume(T1)).outbound, ...(await R.holder.resume(T1)).outbound]
  const fBefore = tupleOf(await state(H), HF.label)
  // X meets H afresh, H the record side; X's probe blinds R's anchor toward H
  const { mine: H2, theirs: X2 } = await freshPair(H, X, '2', H, T1 + 1)
  const k = await probeKeyOf(await sharedOf(X, X2, H2), X2.anchor, H2.anchor)
  const r = await H.holder.receive((await probeDoc(X, X2, H2, { blinded: [await blindPrior(k, R.pairs.H.anchor), ...pads(255)].sort() })).envelope, T1 + 2)
  assert.equal(r.disposition, 'unique')
  assert.deepEqual(r.events.filter((e) => e.type === 'contact.chained'), [], 'a hit chains nothing')
  // X cannot answer under the prior key: its forged report fails mac1
  const fake = await pairSide(X)
  const forged = await contDoc(X, { prior: { ...fake, anchor: R.pairs.H.anchor }, mine: X2, theirs: H2, theirsPrior: H.pairs.R })
  assert.deepEqual(at(await H.holder.receive(forged.envelope, T1 + 3)), ['failed', 8, 'RLTP-TRU-6970'])
  let sH = await state(H)
  assert.deepEqual(sH.relationships['r-R'], before, 'P stays: the H–R tuples unchanged')
  assert.deepEqual(tupleOf(sH, HF.label).priorCandidates, [{ ownPairLabel: H.pairs.R.label, counterpartAnchor: R.pairs.H.anchor }], 'F\'s candidates still name P: X\'s fresh tuple took no place')
  assert.deepEqual([tupleOf(sH, HF.label).continuityOut, tupleOf(sH, HF.label).continuityIn], [fBefore.continuityOut, fBefore.continuityIn], 'F\'s flow untouched')
  assert.equal(tupleOf(sH, H2.label).continuityOut.chosen, H.pairs.R.label, 'X\'s flow holds the choice on P, a candidate only')
  // the honest F completes: F chains onto P at both, and only now does X's flow see F in P's place
  await n.route(heldF, T1 + 4)
  await n.pump(T1 + 4)
  sH = await state(H)
  assert.deepEqual(sH.relationships['r-R'].tuples.map((t) => [t.ownPairLabel, t.deactivated]), [[H.pairs.R.label, true], [HF.label, false]])
  assert.deepEqual((await state(R)).relationships['r-H'].tuples.map((t) => [t.ownPairLabel, t.deactivated]), [[R.pairs.H.label, true], [RF.label, false]])
  assert.deepEqual(tupleOf(sH, H2.label).priorCandidates, [{ ownPairLabel: HF.label, counterpartAnchor: RF.anchor, replaces: [R.pairs.H.anchor] }])
  // X still holds no key of the H–R chain: whatever it answers fails mac1; X stays a relationship of its own
  const forged2 = await contDoc(X, { prior: { ...fake, anchor: RF.anchor }, mine: X2, theirs: H2, theirsPrior: HF }, { revision: '2' })
  assert.deepEqual(at(await H.holder.receive(forged2.envelope, T1 + 5)), ['failed', 8, 'RLTP-TRU-6970'])
  await n.pump(T1 + 3_600_000)
  sH = await state(H)
  assert.deepEqual([sH.relationships['r-X-2'].chainedInto, sH.relationships['r-X-2'].activeHead], [null, H2.label], 'X is never chained')
  assert.deepEqual(sH.relationships['r-R'].tuples.map((t) => t.ownPairLabel), [H.pairs.R.label, HF.label])
})

test('substitution, rotation: the orphaned record side rotates its community anchor after its choice on P and before its re-choice on F2 reaches the counterpart — the re-choice verifies, F1 chains onto F2 on both sides, and the anchor mapping on the new head carries the lineage (follow-up 17, 2285, 6420, 6170, 6985)', async () => {
  const A = await person('A', 0xae), B = await person('B', 0xaf)
  const n = await net([A, B], [[A, B]])
  await trust(A, 'B'); await trust(B, 'A'); await n.pump(T0)
  const f1 = await freshPair(A, B, 'F1', A, T1)
  const f2 = await freshPair(A, B, 'F2', B, T1 + 60_000)
  const held = [...(await A.holder.resume(T1 + 61_000)).outbound, ...(await B.holder.resume(T1 + 61_000)).outbound]
  const onF1 = (o) => o.envelope.rkid === f1.mine.keyAgreement || o.envelope.rkid === f1.theirs.keyAgreement
  const later = []
  const keep = (o) => { if (onF1(o)) { later.push(o); return true } return false }
  // A, the record side of F1, chooses P on B's probe; the choice is held
  const probeB = held.filter((o) => o.type === PROBE && o.envelope.rkid === f1.mine.keyAgreement)
  await n.route(probeB, T1 + 120_000, { drop: (o) => !probeB.includes(o) && keep(o) })
  assert.equal(tupleOf(await state(A), f1.mine.label).continuityOut.chosen, A.pairs.B.label)
  // F2 (B its record side) consumes P on both sides; A's re-choice on F2 is issued and held
  await n.route(held.filter((o) => !onF1(o)), T1 + 120_000, { drop: keep })
  await n.pump(T1 + 120_000, { drop: keep })
  assert.deepEqual([tupleOf(await state(A), f1.mine.label).continuityOut.chosen, tupleOf(await state(A), f1.mine.label).continuityOut.rev], [f2.mine.label, '2'])
  // A rotates from generation 1 to 2 before anything of F1 is delivered
  const g = (k) => communityContext(A.seed, A.genesis, k)
  const rot = await makeAnchorRotation(await g(1), await g(2), await g(3))
  await edit(A, (s) => { s.register.community.head = '2'; s.register.lineage = [rot] })
  // the transport is back
  const log = await n.route([...held.filter(onF1), ...later], T1 + 180_000)
  for (let t = T1 + 180_000; t < T1 + 5 * 3_600_000; t += 3_600_000) { await A.holder.tick(t); await B.holder.tick(t); log.push(...await n.pump(t)) }
  // the only refusals: the superseded choice on P and the outbox's byte-identical retries of it, which
  // run to their horizon like a superseded report's (header); 6960 at B, P no candidate of F1 there any more
  const stale = later.filter((o) => o.type === CMAP && o.envelope.rkid === f1.theirs.keyAgreement)[0]
  const failed = log.filter((l) => l.r?.disposition === 'failed')
  assert.ok(failed.length >= 1)
  assert.deepEqual([...new Set(failed.map((l) => [l.to, l.digest, l.r.ref].join(' ')))], [['B', stale.digest, 'RLTP-TRU-6960'].join(' ')])
  for (const [P, other, f] of [[A, 'B', f1.mine], [B, 'A', f1.theirs]]) {
    const s = await state(P)
    assert.deepEqual(Object.keys(s.contacts), [other], `${P.name}: one entry`)
    assert.deepEqual(s.relationships['r-' + other].tuples.map((t) => t.ownPairLabel).at(-1), f.label, `${P.name}: F1 chained onto F2`)
    assert.deepEqual(Object.values(s.duties).filter((d) => d.kind === 'continuity'), [], `${P.name}: no continuity duty left`)
  }
  // the continuity mapping names pair anchors only; the community rotation reaches B by the anchor mapping
  // on the chain's head, issued from the chain's earliest anchor (2285): B holds A's generation 2
  assert.equal((await state(B)).relationships['r-A'].heldCounterpartHead, (await g(2)).anchor)
})

test('substitution, privacy: a fresh tuple opened after the chaining P → F completed matches only its frozen candidates — a third holder probing with R\'s old P anchor gets no hit, no choice, no duty: the narrowed matching answers only for anchors substituted in that tuple\'s own flow (follow-up 17, 6800) (stack review round 6: Codex I)', async () => {
  const H = await person('H', 0xb1), R = await person('R', 0xb2), X = await person('X', 0xb3)
  const n = await net([H, R, X], [[H, R]])
  await trust(H, 'R'); await trust(R, 'H'); await n.pump(T0)
  // H and R meet again and chain P → F on both sides
  const { mine: HF } = await meet(H, R, 'F', T1)
  await n.pump(T1)
  assert.deepEqual((await state(H)).relationships['r-R'].tuples.map((t) => t.ownPairLabel), [H.pairs.R.label, HF.label])
  // only now X meets H; its candidate set at H is {F}, nothing substituted in its flow
  const { mine: H2, theirs: X2 } = await freshPair(H, X, '2', H, T1 + 1)
  const t0 = tupleOf(await state(H), H2.label)
  assert.deepEqual(t0.priorCandidates.map((pc) => pc.ownPairLabel), [HF.label])
  // X probes with R's old P anchor toward H (a photographed card)
  const k = await probeKeyOf(await sharedOf(X, X2, H2), X2.anchor, H2.anchor)
  const r = await H.holder.receive((await probeDoc(X, X2, H2, { blinded: [await blindPrior(k, R.pairs.H.anchor), ...pads(255)].sort() })).envelope, T1 + 2)
  assert.equal(r.disposition, 'unique')
  assert.deepEqual(r.outbound.filter((o) => o.type === CMAP), [], 'no choice: H\'s current F anchor is not disclosed')
  const t1 = tupleOf(await state(H), H2.label)
  assert.deepEqual(t1.continuityOut, t0.continuityOut, 'nothing in continuityOut')
  assert.equal(Object.hasOwn((await state(H)).duties, `continuity:mapping:${H2.label}`), false, 'no mapping duty')
})

test('substitution, transitive: within one open flow P is replaced by F2, then F2 by F3 — a late probe still blinding P\'s anchor matches F3, and the record side chooses F3 (follow-up 17, 6800)', async () => {
  const A = await person('A', 0xb4), B = await person('B', 0xb5)
  const n = await net([A, B], [[A, B]])
  await trust(A, 'B'); await trust(B, 'A'); await n.pump(T0)
  // F2 first, then F1 (its candidates {P, F2}), so that F3 later finds the chain ahead of F1 (2180)
  const f2 = await freshPair(A, B, 'F2', A, T1)
  const f1 = await freshPair(A, B, 'F1', A, T1 + 1)
  const held = [...(await A.holder.resume(T1 + 2)).outbound, ...(await B.holder.resume(T1 + 2)).outbound]
  const onF1 = (o) => o.envelope.rkid === f1.mine.keyAgreement || o.envelope.rkid === f1.theirs.keyAgreement
  const later = []
  const keep = (o) => { if (onF1(o)) { later.push(o); return true } return false }
  // F2 chains onto P, then F3 onto F2, nothing of F1 delivered
  await n.route(held.filter((o) => !onF1(o)), T1 + 3, { drop: keep })
  await n.pump(T1 + 3, { drop: keep })
  const f3 = await freshPair(A, B, 'F3', A, T1 + 4)
  await n.pump(T1 + 4, { drop: keep })
  assert.deepEqual((await state(A)).relationships['r-B'].tuples.map((t) => t.ownPairLabel), [A.pairs.B.label, f2.mine.label, f3.mine.label])
  const x = tupleOf(await state(A), f1.mine.label)
  assert.deepEqual(x.priorCandidates.map((pc) => pc.ownPairLabel), [f3.mine.label], 'P → F2 → F3 in F1\'s set')
  assert.deepEqual(x.continuityOut.chosen, null)
  // a late probe of B on F1 blinding B's P anchor alone, as built before B substituted: a hit on F3
  const k = await probeKeyOf(await sharedOf(B, f1.theirs, f1.mine), f1.theirs.anchor, f1.mine.anchor)
  const r = await A.holder.receive((await probeDoc(B, f1.theirs, f1.mine, { blinded: [await blindPrior(k, B.pairs.A.anchor), ...pads(255)].sort() })).envelope, T1 + 5)
  assert.equal(r.disposition, 'unique')
  assert.equal(r.outbound.filter((o) => o.type === CMAP).length, 1, 'the choice goes out')
  assert.equal(tupleOf(await state(A), f1.mine.label).continuityOut.chosen, f3.mine.label, 'the record side chooses F3')
})

/*
 * A19 residual, accepted (Trust 0.32 follow-up 14), documented here: the
 * probe-hit choice of the IB rule already discloses the holder's own prior
 * pair anchor to whoever knows the counterpart's (a photographed card).
 * Where that third party's flow predates a chaining of the prior, the
 * substitution of follow-up 17 re-targets its flow too: the re-issued
 * choice names the holder's new own pair anchor toward the same
 * counterpart, and a later probe on the old anchor still hits the new head
 * in that flow (`replaces`). The third party never chains (mac1 under a key
 * it does not hold, 6970; the replaced prior is no candidate, 6960); the holder's standing mapping duty resends under its
 * backoff (6840). A flow opened after the chaining learns nothing (Codex I).
 */
test('A19 residual, accepted (Trust 0.32 follow-up 14): a third party whose flow predates the chaining learns the holder\'s later own pair anchors toward the same counterpart', async () => {
  const H = await person('H', 0xb6), R = await person('R', 0xb7), X = await person('X', 0xb8)
  const n = await net([H, R, X], [[H, R]])
  await trust(H, 'R'); await trust(R, 'H'); await n.pump(T0)
  // X opens a fresh flow toward H before H and R chain: P is among its candidates at H
  const { mine: H2, theirs: X2 } = await freshPair(H, X, '2', H, T1)
  const onX = (o) => o.envelope.rkid === H2.keyAgreement || o.envelope.rkid === X2.keyAgreement
  const k = await probeKeyOf(await sharedOf(X, X2, H2), X2.anchor, H2.anchor)
  const probeP = async (probe) => (await probeDoc(X, X2, H2, { probe, threadId: tid(`p-${probe}`), blinded: [await blindPrior(k, R.pairs.H.anchor), ...pads(255)].sort() })).envelope
  // every continuity mapping that goes out toward X: what X can open
  const toX = []
  const towardX = (o) => o.type === CMAP && o.envelope.rkid === X2.keyAgreement
  const r1 = await H.holder.receive(await probeP('1'), T1 + 1)
  toX.push(...r1.outbound.filter(towardX))
  assert.equal(toX.length, 1, 'the IB residual: a choice on the hit')
  let x = tupleOf(await state(H), H2.label)
  assert.deepEqual([x.continuityOut.chosen, x.continuityOut.body.prior, x.continuityOut.rev], [H.pairs.R.label, H.pairs.R.anchor, '1'], 'it names H\'s own P pair anchor')
  // H and R meet again and chain P → F on both sides (X's traffic kept out)
  const { mine: HF, theirs: RF } = await meet(H, R, 'F', T1 + 2)
  // R's F pair anchor, held apart from any holder's state: what X must never learn
  const rF = RF.anchor
  await n.pump(T1 + 2, { drop: (o) => { if (towardX(o)) toX.push(o); return onX(o) } })
  assert.deepEqual((await state(H)).relationships['r-R'].tuples.map((t) => t.ownPairLabel), [H.pairs.R.label, HF.label])
  // the substitution reached X's flow: F in P's place, standing for P; the choice re-issued naming H's own F anchor
  x = tupleOf(await state(H), H2.label)
  assert.deepEqual(x.priorCandidates, [{ ownPairLabel: HF.label, counterpartAnchor: RF.anchor, replaces: [R.pairs.H.anchor] }])
  assert.deepEqual([x.continuityOut.chosen, x.continuityOut.body.prior, x.continuityOut.rev], [HF.label, HF.anchor, '2'], 'the re-issued choice discloses H\'s F anchor')
  // a later probe of X on P still hits F in this flow; the choice stands as it is
  const r2 = await H.holder.receive(await probeP('2'), T1 + 3)
  assert.equal(r2.disposition, 'unique')
  x = tupleOf(await state(H), H2.label)
  assert.deepEqual([x.probeIn.hwm, x.continuityOut.chosen, x.continuityOut.rev], ['2', HF.label, '2'])
  // X never chains: a forged counter-mapping naming R's F anchor fails mac1 (6970); one naming
  // R's P anchor names no candidate any more (6960)
  const fake = await pairSide(X)
  for (const [prior, theirsPrior, ref] of [[rF, HF, 'RLTP-TRU-6970'], [R.pairs.H.anchor, H.pairs.R, 'RLTP-TRU-6960']]) {
    const forged = await contDoc(X, { prior: { ...fake, anchor: prior }, mine: X2, theirs: H2, theirsPrior }, { revision: '3' })
    assert.deepEqual(at(await H.holder.receive(forged.envelope, T1 + 4)), ['failed', 8, ref])
  }
  // H's standing mapping duty resends the re-issued choice under its backoff (6840), same revision
  const d = (await state(H)).duties[`continuity:mapping:${H2.label}`]
  assert.ok(d && d.step === 'mapping', 'the duty stands')
  // while its documents are still with the outbox, only the outbox retries them, byte-identical (the
  // choice on P and the re-choice; X answers nothing it can verify); once the outbox gave them up at
  // its horizon, the duty resends the stored re-choice in a new document, same revision (6840)
  const sent0 = tupleOf(await state(H), H2.label).continuityOut.sent
  const retried = (await H.holder.resume(T1 + 86_400_000)).outbound.filter(towardX)
  toX.push(...retried)
  assert.deepEqual(retried.map((o) => sent0.includes(o.digest)).sort(), [false, true], 'the outbox retries the choice on P and the re-choice')
  let fresh = [], day = 1
  while (!fresh.length && ++day < 30) {
    await H.holder.tick(T1 + day * 86_400_000)
    const out = (await H.holder.resume(T1 + day * 86_400_000)).outbound.filter(towardX)
    toX.push(...out)
    x = tupleOf(await state(H), H2.label)
    fresh = out.filter((o) => !sent0.includes(o.digest) && x.continuityOut.sent.includes(o.digest))
  }
  assert.equal(day, 9, 'the resend on day 9: not while the outbox still holds a document of it')
  assert.equal(fresh.length, 1, 'one new document of the re-issued choice after the backoff')
  assert.equal(x.continuityOut.rev, '2', 'same revision')
  const sH = await state(H)
  assert.equal(sH.duties[`continuity:mapping:${H2.label}`]?.attempt, 2, 'the standing duty stays, its attempt grown')
  // what X can open: H's own P and F pair anchors appear; R's F anchor never does (R's P anchor
  // X knew beforehand, the precondition)
  const xPriv = (await ctxOf(X, X2)).x.priv
  const opened = []
  for (const o of toX) opened.push(J((await unseal(o.envelope, xPriv)).document))
  assert.ok(opened.length >= 3)
  assert.ok(opened.some((d) => d.includes(H.pairs.R.anchor)), 'H\'s own P pair anchor')
  assert.ok(opened.some((d) => d.includes(HF.anchor)), 'H\'s own F pair anchor')
  assert.ok(!opened.some((d) => d.includes(rF)), 'never R\'s F pair anchor')
  assert.deepEqual([sH.relationships['r-X-2'].chainedInto, sH.relationships['r-X-2'].activeHead], [null, H2.label], 'X is never chained')
  assert.deepEqual(sH.relationships['r-R'].tuples.map((t) => t.ownPairLabel), [H.pairs.R.label, HF.label])
})
