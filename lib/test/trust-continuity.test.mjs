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
  assert.equal(r.nextDueAt, undefined, 'nothing is due before the backoff')
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
  const t = (await state(R)).relationships['r-' + N.name].tuples.at(-1)
  assert.notEqual(t.continuityOut.chosen, null, 'the record side chose and chained')
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
  let t = (await state(R)).relationships['r-' + N.name].tuples.at(-1)
  assert.notEqual(t.continuityOut.chosen, null)
  assert.equal(t.continuityOut.aligned, false)
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
  await n.pump(TL, { drop: (o) => o.type === CMAP })
  const priorRkid = R.pairs[N.name].keyAgreement
  let sR = await state(R)
  assert.equal(sR.relationships['r-' + N.name].tuples[0].deactivated, true, 'the record side chained')
  await R.holder.tick(TL + 1); await N.holder.tick(TL + 1)
  sR = await state(R)
  assert.equal(sR.addresses.tombstones.includes(priorRkid), false, 'the prior\'s key is kept')
  const log = await n.pump(TL + 60_000)
  assert.deepEqual(log.filter((l) => l.r?.disposition === 'failed').map((l) => l.r.ref), [])
  sR = await state(R)
  const sN = await state(N)
  assert.equal(sN.relationships['r-' + R.name].activeHead, N.pairs[`${R.name}#2`].label, 'the non-record side chained')
  assert.equal(sR.relationships['r-' + N.name].tuples.at(-1).continuityOut.aligned, true, 'the alignment completed')
  // the flow is done: the next tick lets the key go
  await R.holder.tick(TL + 2)
  assert.equal((await state(R)).addresses.tombstones.includes(priorRkid), true)
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
 * The test below reproduces it with two re-encounters, A recording one and
 * C the other, the record sides' mappings held back until both chose.
 */
test('one-sided chaining: two re-encounters with different record sides race for one prior — each side chains its own, refuses the other\'s (6900), and after a rotation the unchained side\'s mapping is refused for good (6170): a Trust 0.32 gap', async () => {
  const A = await person('A', 0x5a), C = await person('C', 0x5c)
  const n = await net([A, C], [[A, C]])
  await trust(A, 'C'); await trust(C, 'A')
  await n.pump(T0)
  // two fresh pairs: A records x, C records y
  const pairWith = async (record) => {
    for (;;) {
      const a = await pairSide(A), c = await pairSide(C)
      if (isRecordSide(a.anchor, c.anchor) === (record === A)) return { a, c }
    }
  }
  const x = await pairWith(A), y = await pairWith(C)
  for (const [name, s] of [['x', x], ['y', y]]) {
    A.pairs[`C#${name}`] = s.a; C.pairs[`A#${name}`] = s.c
    assert.equal((await A.holder.act('continuity.newTuple', { relId: `r-C-${name}`, contactId: `C-${name}`, ownPairLabel: s.a.label, counterpartAnchor: s.c.anchor, counterpartKeyAgreement: s.c.keyAgreement }, T1)).ok, true)
    assert.equal((await C.holder.act('continuity.newTuple', { relId: `r-A-${name}`, contactId: `A-${name}`, ownPairLabel: s.c.label, counterpartAnchor: s.a.anchor, counterpartKeyAgreement: s.a.keyAgreement }, T1)).ok, true)
  }
  // the probes cross; every continuity mapping is held back until both record sides chose
  const held = []
  const out = [...(await A.holder.resume(T1)).outbound, ...(await C.holder.resume(T1)).outbound]
  await n.route(out, T1, { drop: (o) => { if (o.type === CMAP) { held.push(o); return true } return false } })
  const chainOf = async (p, relId) => (await state(p)).relationships[relId].tuples.map((t) => t.ownPairLabel)
  assert.deepEqual(await chainOf(A, 'r-C'), [A.pairs.C.label, x.a.label], 'A, the record side of x, chained x')
  assert.deepEqual(await chainOf(C, 'r-A'), [C.pairs.A.label, y.c.label], 'C, the record side of y, chained y')
  // the held mappings arrive: each record mapping names a prior the other side's own choice took
  const log = await n.route(held, T1 + 1)
  const refused = log.filter((l) => l.r?.disposition === 'failed').map((l) => [l.to, l.r.ref])
  assert.deepEqual(refused.filter(([, ref]) => ref === 'RLTP-TRU-6900').map(([to]) => to).sort(), ['A', 'C'])
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
