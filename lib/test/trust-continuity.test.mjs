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
import { probeKeyOf, buildProbeChunks, assembleContinuityMapping, continuityMacsOk, probeChunkOk, probeChunkMacOk, isRecordSide } from '../dist/continuity.js'
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
  const real = await visibility.continuity.blindPrior(kp, P.A.anchor)
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

import { createHolder, communityContext, ecdh, xRawOfMk, labeledContext, iso, seal, digestDoc, jcs as J } from '../dist/index.js'
import { InMemoryStore, stateBuilder, continuityTestModule } from '../dist/testing.js'
import { chainTuple, contactView } from '../dist/internal.js'
import { makeAnchorRotation, macU } from '../dist/anchor.js'
import { T0 } from './pair-fixture.mjs'
import { person, pairSide, tupleSpec, state, edit, tid } from './star-fixture.mjs'

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
