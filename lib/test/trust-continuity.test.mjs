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
