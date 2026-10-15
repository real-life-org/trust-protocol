#!/usr/bin/env node
// The community anchor's generations and the group star (Identity 0.54
// §5.4/§6.1, Trust Layer 0.31 §5.2b/§6.1–§6.5/§6a.1): the label grammar
// of `group/<digest>/<generation>`, the derivation on the one HKDF path,
// the pre-rotation binding, self-card@2, anchor-rotation@2 and its
// lineage, anchor-mapping@4 with conditions 4a/4b and the
// condition 8 (a rotation, or an unlinked change rejected), and
// group-star@1 with its sealed group pairs: the pure builders and
// verifiers, every check independent of the vectors (re-derived by
// conformance/runner.mjs with node:crypto alone). The head rule and the
// binding rule of the convergence net, merge, split and departure are the
// holder's (trust-entries.test.mjs, trust-mapping.test.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import * as C from '../dist/index.js'
import { visibility } from '../dist/index.js'
import { SCHEMAS } from '../dist/testing.js'

const V = visibility
const hex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)))
const IKM = hex('5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4')
const D = 'uEiDYLnFbXqm2cwuJWuk9yNzRmlzWDpCTH6yA_4aP_1z_RA'
const fill = (n, x) => new Uint8Array(n).fill(x)
const VAL = C.makeValidator(SCHEMAS)
const schemaErrs = (data, file) => { const s = SCHEMAS[file]; if (!s) throw new Error('unknown schema ' + file); return VAL.validate(data, s, s) }
// node:crypto oracle for the derivation (independent of the library)
const edPub = (seed) => {
  const k = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' })
  const s = crypto.createPublicKey(k).export({ format: 'der', type: 'spki' }); return new Uint8Array(s.subarray(s.length - 32))
}
const oracleAnchor = (label) => C.anchorOfEd(edPub(Buffer.from(crypto.hkdfSync('sha256', IKM, Buffer.alloc(0), Buffer.from('rltp/anchor/ed/' + label, 'utf8'), 32))))
// deterministic entropy for the constructions that take it from the caller
const counterRand = (tag) => { let i = 0; return (n) => new Uint8Array(crypto.hkdfSync('sha256', Buffer.from(tag), Buffer.alloc(0), Buffer.from(String(i++)), n)) }

// ── Identity 0.54 §6.1: the generation row of the closed registry ───────
test('identity — group/<digest>/<generation>: grammar of the one new registry row', async () => {
  for (const g of ['2', '3', '10', '9007199254740991']) {
    assert.equal(C.canonicalLabel(`group/${D}/${g}`), `group/${D}/${g}`, `generation ${g} is a label`)
  }
  for (const g of ['1', '0', '01', '02', '9007199254740992', '18446744073709551617', '-2', '+2', '2.0', '1e3', ' 2', '2 ', '', '２', '2/3']) {
    assert.equal(C.canonicalLabel(`group/${D}/${g}`), null, `generation ${JSON.stringify(g)} is rejected`)
    await assert.rejects(() => C.labeledContext(IKM, `group/${D}/${g}`), undefined, `derivation refuses /${g}`)
  }
  assert.equal(C.canonicalLabel(`group/${D}x/2`), null, 'the digest component keeps its own rule')
  assert.equal(C.canonicalLabel(`pair/${D}/2`), null, 'only the group form carries a generation')
})

test('identity — a generation derives on the ordinary HKDF path, the label string is the context', async () => {
  for (const g of [2, 3]) {
    const label = `group/${D}/${g}`
    const ctx = await C.labeledContext(IKM, label)
    assert.equal(ctx.anchor, oracleAnchor(label), `generation ${g}: rltp/anchor/ed/ || label`)
    assert.equal((await C.communityContext(IKM, D, g)).anchor, ctx.anchor, 'communityContext(…, g) is that label')
  }
  assert.equal((await C.communityContext(IKM, D)).label, `group/${D}`, 'generation 1 is the plain group label')
  assert.equal((await C.communityContext(IKM, D, 1)).label, `group/${D}`)
  assert.equal(C.communityLabel(D, 7), `group/${D}/7`)
  assert.throws(() => C.communityLabel(D, 0))
  assert.throws(() => C.communityLabel(D, 2 ** 53))
  const g1 = await C.communityContext(IKM, D), g2 = await C.communityContext(IKM, D, 2), g3 = await C.communityContext(IKM, D, 3)
  assert.equal(new Set([g1.anchor, g2.anchor, g3.anchor]).size, 3, 'every generation is a distinct anchor')
})

// ── Trust 0.31 §6.5, Identity 0.54 §5.4: anchor-rotation@2 and the lineage ──
const gens = async () => Promise.all([1, 2, 3, 4].map((g) => C.communityContext(IKM, D, g)))
// the generation of a community context of <D> (group/<D> is 1)
const genOf = (ctx) => { const m = /\/([0-9]+)$/.exec(ctx.label); return m ? Number(m[1]) : 1 }
// an honest rotation of <D>: prev → next, committing to the generation after next
const rot = async (prev, next) => V.makeAnchorRotation(prev, next, await C.communityContext(IKM, D, genOf(next) + 1))
// a rotation the library never builds: whoever holds prev's key co-signs a
// link to a key of its own, committing to `after` (a copier, a skip, an unrelated anchor)
const forge = async (prev, next, after) => {
  const body = { type: 'anchor-rotation@2', prev: prev.anchor, next: next.anchor, commit: await V.bindingOf(after.anchor) }
  return { body, proof: { proofValue: await V.signRaw(prev, body), successorProofValue: await V.signRaw(next, body) } }
}
// a stand-in card: only its commit matters to mappingBindings
const cardOf = async (after) => ({ body: { commit: await V.bindingOf(after.anchor) } })
const OTHER = 'uEiCCsq5ciVSsrhXjp4-OoQbQ4JStCJEvM82lS_CIh4SFPA'
// generations 1 … 67 and the 65 rotations 1→2 … 65→66
let LONG
const longChain = async () => {
  if (LONG) return LONG
  const ctxs = await Promise.all(Array.from({ length: 67 }, (_, i) => C.communityContext(IKM, D, i + 1)))
  const chain = []
  for (let i = 0; i < 65; i++) chain.push(await V.makeAnchorRotation(ctxs[i], ctxs[i + 1], ctxs[i + 2]))
  return (LONG = { ctxs, chain })
}

test('binding — the sha2-256 multihash over the 34 multikey bytes 0xed 0x01 ‖ pk (Identity 5.4)', async () => {
  const [g1, g2] = await gens()
  const mk = Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(C.edRawOfAnchor(g2.anchor))])
  assert.equal(mk.length, 34)
  const oracle = 'u' + Buffer.concat([Buffer.from([0x12, 0x20]), crypto.createHash('sha256').update(mk).digest()]).toString('base64url')
  assert.equal(await V.bindingOf(g2.anchor), oracle)
  assert.equal(await V.meetsBinding(g2.anchor, oracle), true)
  assert.equal(await V.meetsBinding(g1.anchor, oracle), false, 'another key does not meet it')
  assert.equal(await V.meetsBinding(g2.anchor, undefined), false)
  const card = await V.makeSelfCard(g1, g2)
  assert.deepEqual(Object.keys(card.body).sort(), ['anchor', 'commit', 'keyAgreement', 'type'])
  assert.equal(card.body.type, 'self-card@2'); assert.equal(card.body.commit, oracle, 'the card of generation 1 binds generation 2')
  assert.equal(schemaErrs(card, 'visibility-self-card.schema.json').length, 0)
  assert.ok(await V.verifyRaw(g1.anchor, card.body, card.proof.proofValue))
  await assert.rejects(() => V.makeSelfCard(g1, g1), undefined, 'a card binds the generation after its anchor, nothing else')
  const [, , g3] = await gens()
  await assert.rejects(() => V.makeSelfCard(g1, g3), undefined, 'no skip')
})

test('anchor-rotation@2 — a key-chain link: { type, prev, next, commit }, signed by both keys, schema-closed, bound', async () => {
  const [g1, g2, g3] = await gens()
  const r = await rot(g1, g2)
  assert.deepEqual(Object.keys(r.body).sort(), ['commit', 'next', 'prev', 'type'], 'no generation field: the chain order is prev/next alone')
  assert.equal(r.body.type, 'anchor-rotation@2')
  assert.equal(r.body.prev, g1.anchor); assert.equal(r.body.next, g2.anchor)
  assert.equal(r.body.commit, await V.bindingOf(g3.anchor), 'commit = the binding of next to the generation after it')
  assert.equal(schemaErrs(r, 'visibility-anchor-rotation.schema.json').length, 0)
  assert.equal(await V.verifyAnchorRotation(r), true)
  // the two signatures are raw Ed25519 over JCS(body), one under each key
  const bytes = new TextEncoder().encode(C.jcs(r.body))
  const pub = (did) => globalThis.crypto.subtle.importKey('raw', C.edRawOfAnchor(did), { name: 'Ed25519' }, false, ['verify'])
  assert.ok(await globalThis.crypto.subtle.verify({ name: 'Ed25519' }, await pub(g1.anchor), C.fromBase58(r.proof.proofValue.slice(1)), bytes), 'proofValue under prev')
  assert.ok(await globalThis.crypto.subtle.verify({ name: 'Ed25519' }, await pub(g2.anchor), C.fromBase58(r.proof.successorProofValue.slice(1)), bytes), 'successorProofValue under next')
  // against the binding held for prev (6.3 condition 4b)
  assert.equal(await V.verifyAnchorRotation(r, await V.bindingOf(g2.anchor)), true, 'next meets the binding held for prev')
  assert.equal(await V.verifyAnchorRotation(r, await V.bindingOf(g3.anchor)), false, 'next does not meet another binding')
  // negatives
  const swapped = { body: r.body, proof: { proofValue: r.proof.proofValue, successorProofValue: r.proof.proofValue } }
  assert.equal(await V.verifyAnchorRotation(swapped), false, 'a wrong successor signature fails')
  // a generation field, genuinely signed by both keys: the closed schema rejects it
  const b0 = { ...r.body, generation: '2' }
  const withGen = { body: b0, proof: { proofValue: await V.signRaw(g1, b0), successorProofValue: await V.signRaw(g2, b0) } }
  assert.ok(schemaErrs(withGen, 'visibility-anchor-rotation.schema.json').length > 0, 'a generation field fails the schema')
  assert.equal(await V.verifyAnchorRotation(withGen), false, 'a generation field is rejected')
  const extra = structuredClone(r); extra.body.note = 'x'
  assert.equal(await V.verifyAnchorRotation(extra), false, 'closed body')
  const { commit, ...b1 } = r.body
  const noCommit = { body: b1, proof: { proofValue: await V.signRaw(g1, b1), successorProofValue: await V.signRaw(g2, b1) } }
  assert.equal(await V.verifyAnchorRotation(noCommit), false, 'commit is required')
  // a rotation moves: next differs from prev
  await assert.rejects(() => V.makeAnchorRotation(g1, g1, g2), undefined, 'a rotation onto its own key is never produced')
  const bs = { type: 'anchor-rotation@2', prev: g1.anchor, next: g1.anchor, commit }
  const still = { body: bs, proof: { proofValue: await V.signRaw(g1, bs), successorProofValue: await V.signRaw(g1, bs) } }
  assert.equal(await V.verifyAnchorRotation(still), false, 'prev = next is rejected')
  // a rotation goes to generation g + 1 of the same digest only (Trust 6330,
  // Identity 5.4): no skip, and no rotation onto a new personal community
  const [, , , g4] = await gens()
  await assert.rejects(() => V.makeAnchorRotation(g1, g3, g4), undefined, 'no derivation skip')
  await assert.rejects(() => V.makeAnchorRotation(g1, g2, g4), undefined, 'commit binds the generation after next')
  const fresh = await C.communityContext(IKM, OTHER)
  const fresh2 = await C.communityContext(IKM, OTHER, 2)
  await assert.rejects(() => V.makeAnchorRotation(g2, fresh, fresh2), undefined, 'no rotation onto generation 1 of a new personal community')
  // co-signed anyway, such a link verifies as joint authorization only; against
  // the binding held for its prev it fails
  const onto = await forge(g2, fresh, fresh2)
  assert.equal(await V.verifyAnchorRotation(onto), true, 'joint authorization only')
  assert.equal(await V.verifyAnchorRotation(onto, await V.bindingOf(g3.anchor)), false, 'it does not meet the binding of generation 2')
})

test('lineage — a key chain as given (4a), the bindings along it (4b), at most 64', async () => {
  const [g1, g2, g3, g4] = await gens()
  const g5 = await C.communityContext(IKM, D, 5)
  const r2 = await rot(g1, g2), r3 = await rot(g2, g3)
  assert.equal(V.LINEAGE_MAX, 64)
  assert.deepEqual(await V.verifyLineage([], g1.anchor), { ok: true }, 'empty: the sender presents no history')
  assert.deepEqual(await V.verifyLineage([r2], g2.anchor), { ok: true })
  assert.deepEqual(await V.verifyLineage([r2, r3], g3.anchor), { ok: true })
  assert.deepEqual(await V.verifyLineage([r3], g3.anchor), { ok: true }, 'a segment: the carried part need not start at generation 1')
  assert.equal((await V.verifyLineage([r2], g3.anchor)).ok, false, 'last next ≠ self')
  const r3x = await forge(g1, g3, g4)
  assert.equal((await V.verifyLineage([r2, r3x], g3.anchor)).ok, false, 'prev break')
  const bad = structuredClone(r2); bad.proof.successorProofValue = r2.proof.proofValue
  assert.equal((await V.verifyLineage([bad], g2.anchor)).ok, false, 'every element verifies under both signatures')
  // 4b: each next meets the commit of the element before it, the card carries the last commit
  const card = (ctx, after) => V.makeSelfCard(ctx, after)
  assert.deepEqual(await V.verifyBindings({ lineage: [r2, r3], card: await card(g3, g4) }), { ok: true })
  assert.deepEqual(await V.verifyBindings({ lineage: [], card: await card(g1, g2) }), { ok: true })
  assert.equal((await V.verifyBindings({ lineage: [r2, r3], card: { body: { anchor: g3.anchor, commit: await V.bindingOf(g5.anchor) } } })).ok, false, 'card.commit ≠ the commit of the last element')
  // a derivation skip chains as keys (4a) but meets no binding (4b)
  const r4 = await forge(g2, g4, g5)
  assert.deepEqual(await V.verifyLineage([r2, r4], g4.anchor), { ok: true }, '4a sees keys only')
  assert.equal((await V.verifyBindings({ lineage: [r2, r4], card: await card(g4, g5) })).ok, false, 'g4 does not meet the binding r2 commits to')
  // onto a new personal community: the same
  const fresh = await C.communityContext(IKM, OTHER), fresh2 = await C.communityContext(IKM, OTHER, 2)
  const rf = await forge(g2, fresh, fresh2)
  assert.deepEqual(await V.verifyLineage([r2, rf], fresh.anchor), { ok: true })
  assert.equal((await V.verifyBindings({ lineage: [r2, rf], card: { body: { anchor: fresh.anchor, commit: rf.body.commit } } })).ok, false, 'no rotation onto a new personal community')
  // the bindings a relationship holds (6610) check the first element and the card
  const held = new Map([[g1.anchor, await V.bindingOf(g2.anchor)]])
  assert.deepEqual(await V.verifyBindings({ lineage: [r2], card: await card(g2, g3) }, held), { ok: true }, 'r2 meets the held binding of g1')
  const copier = await forge(g1, fresh, fresh2)
  assert.equal((await V.verifyBindings({ lineage: [copier], card: { body: { anchor: fresh.anchor, commit: copier.body.commit } } }, held)).ok, false, 'a successor of g1 other than g2 is refused')
  assert.equal((await V.verifyBindings({ lineage: [], card: { body: { anchor: g1.anchor, commit: await V.bindingOf(fresh.anchor) } } }, held)).ok, false, 'a card that states another binding for a held anchor is refused')
  assert.deepEqual(V.lineageAnchors([r2, r3]), [g1.anchor, g2.anchor, g3.anchor])
  // the bound: 64 elements pass, 65 fail
  const { ctxs, chain } = await longChain()
  assert.deepEqual(await V.verifyLineage(chain.slice(1), ctxs[65].anchor), { ok: true }, '64 elements')
  assert.equal((await V.verifyLineage(chain, ctxs[65].anchor)).ok, false, '65 elements')
  // the anchor set a mapping verifies: self and every anchor of its carried lineage (Trust 6a.1 rung 2)
  assert.deepEqual(V.mappingAnchors({ self: g1.anchor, lineage: [] }), [g1.anchor])
  assert.deepEqual(V.mappingAnchors({ self: g3.anchor, lineage: [r2, r3] }), [g1.anchor, g2.anchor, g3.anchor])
  // the bindings a mapping states (6610)
  const mb = await V.mappingBindings({ self: g3.anchor, lineage: [r2, r3], card: await card(g3, g4) })
  assert.deepEqual([...mb].sort(), [[g1.anchor, await V.bindingOf(g2.anchor)], [g2.anchor, await V.bindingOf(g3.anchor)], [g3.anchor, await V.bindingOf(g4.anchor)]].sort())
})

// ── Trust 0.31 §6.1/§6.3: anchor-mapping@4 ───────────────────────────────
const pairs = async () => ({
  A: await C.pairContext(IKM, fill(32, 0xa0)),
  B: await C.pairContext(IKM, fill(32, 0xb0)),
})

test('anchor-mapping@4 — card self-card@2, lineage in the body, proof unchanged, 6.3 in order with 4a and 4b', async () => {
  const { A, B } = await pairs()
  const [g1, g2, g3] = await gens()
  const r2 = await rot(g1, g2)
  const to = { pair: A, to: B.anchor, toKeyAgreement: B.keyAgreement }
  const m = await V.buildAnchorMapping({ ...to, self: g2, nextGen: g3, lineage: [r2], revision: '2', issuedAt: '2026-10-07T12:00:00Z' })
  assert.equal(m.body.type, 'anchor-mapping@4')
  assert.deepEqual(m.body.lineage, [r2])
  assert.equal(m.body.card.body.type, 'self-card@2')
  assert.equal(m.body.card.body.anchor, g2.anchor, 'card under the current generation')
  assert.equal(m.body.card.body.commit, r2.body.commit, 'the card carries the binding the last element commits to')
  assert.equal(schemaErrs(m, 'visibility-anchor-mapping.schema.json').length, 0)
  const ctx = { own: B, pair: A.anchor, pairKeyAgreement: A.keyAgreement }
  assert.deepEqual(await V.verifyAnchorMapping(m, ctx), { ok: true })
  // mac2 under selfX of the CURRENT generation
  const k2 = await C.hkdf(await C.ecdh(B.x.priv, g2.x.pubRaw), 'rltp/visibility/mac/map2')
  assert.equal(await V.macU(k2, C.jcs(m.body)), m.proof.mac2)
  const empty = await V.buildAnchorMapping({ ...to, self: g1, nextGen: g2, lineage: [], revision: '1', issuedAt: '2026-10-07T12:00:00Z' })
  assert.deepEqual(await V.verifyAnchorMapping(empty, ctx), { ok: true }, 'empty lineage')
  // 4b against the bindings this relationship holds (6610): the held card of generation 1 binds generation 2
  const held = await V.mappingBindings(empty.body)
  assert.equal(held.get(g1.anchor), await V.bindingOf(g2.anchor))
  assert.deepEqual(await V.verifyAnchorMapping(m, { ...ctx, held }), { ok: true }, 'the rotation meets the held binding')
  const wrongHeld = new Map([[g1.anchor, await V.bindingOf(g3.anchor)]])
  assert.deepEqual(await V.verifyAnchorMapping(m, { ...ctx, held: wrongHeld }), { ok: false, step: '4b' }, 'a successor the held binding does not admit fails at 4b')
  const cardHeld = new Map([[g2.anchor, await V.bindingOf(g1.anchor)]])
  assert.deepEqual(await V.verifyAnchorMapping(m, { ...ctx, held: cardHeld }), { ok: false, step: '4b' }, 'a card that states another binding for a held anchor fails at 4b')
  // 4a fails: a lineage that does not end at self (MACs recomputed over the mutated body)
  const wrongEnd = await V.buildAnchorMapping({ ...to, self: g1, nextGen: g2, lineage: [r2], revision: '1', issuedAt: '2026-10-07T12:00:00Z' })
  assert.deepEqual(await V.verifyAnchorMapping(wrongEnd, ctx), { ok: false, step: '4a' })
  for (const legacyType of ['anchor-mapping@2', 'anchor-mapping@3']) {
    const legacy = structuredClone(empty); legacy.body.type = legacyType
    assert.deepEqual(await V.verifyAnchorMapping(legacy, ctx), { ok: false, step: '1' }, `${legacyType} is rejected like @1`)
  }
  const card1 = structuredClone(empty); card1.body.card.body.type = 'self-card@1'; delete card1.body.card.body.commit
  assert.deepEqual(await V.verifyAnchorMapping(card1, ctx), { ok: false, step: '1' }, 'a self-card@1 inside is rejected at the schema')
  assert.deepEqual(await V.verifyAnchorMapping(empty, { ...ctx, pair: B.anchor }), { ok: false, step: '3' })
})

test('anchor-mapping@4 — condition 8: a changed self is a rotation when the lineage carries the held self as a prev, else rejected (6170)', async () => {
  const [g1, g2, g3] = await gens()
  const r2 = await rot(g1, g2), r3 = await rot(g2, g3)
  const other = await C.communityContext(IKM, OTHER)
  assert.equal(V.classifyMapping(undefined, { self: g1.anchor, lineage: [] }), 'first')
  assert.equal(V.classifyMapping(g1.anchor, { self: g1.anchor, lineage: [] }), 'same')
  assert.equal(V.classifyMapping(g1.anchor, { self: g2.anchor, lineage: [r2] }), 'rotation')
  assert.equal(V.classifyMapping(g1.anchor, { self: g3.anchor, lineage: [r2, r3] }), 'rotation', 'a contact that lagged two generations follows')
  assert.equal(V.classifyMapping(g2.anchor, { self: g3.anchor, lineage: [r2, r3] }), 'rotation')
  assert.equal(V.classifyMapping(g1.anchor, { self: other.anchor, lineage: [] }), 'rejected')
  assert.equal(V.classifyMapping(g1.anchor, { self: g2.anchor, lineage: [] }), 'rejected', 'without a segment that reaches the held self nothing links the two')
  assert.equal(V.classifyMapping(g1.anchor, { self: g3.anchor, lineage: [r3] }), 'rejected', 'a segment that starts after the held self')
})

// ── Trust 0.31 §5.2b: group-star@1 ─────────────────────────────────
const groupWorld = async () => {
  const { A, B } = await pairs()
  const S1 = await C.pairContext(IKM, fill(32, 0x51))       // the sender's founding pair anchor in G1 (it founded G1)
  const G1 = await C.digestBytes(new TextEncoder().encode('rltp/test/group-star/G1'))
  const G2 = await C.digestBytes(new TextEncoder().encode('rltp/test/group-star/G2'))
  const G3 = await C.digestBytes(new TextEncoder().encode('rltp/test/group-star/G3'))
  const S2 = await C.labeledContext(IKM, 'group/' + G2)     // a joiner's member anchor in G2
  const op1 = 'oid:' + C.b64uOf(new Uint8Array(crypto.createHash('sha256').update('genesis G1').digest()))
  const op2 = 'oid:' + C.b64uOf(new Uint8Array(crypto.createHash('sha256').update('admission G2').digest()))
  const membershipG1 = { group: G1, isMember: (a) => a === S1.anchor || a === B.anchor, resolve: (oid) => oid === op1 ? { subject: S1.anchor, keyAgreement: S1.keyAgreement } : null }
  return { A, B, S1, S2, G1, G2, G3, op1, op2, membershipG1 }
}

test('group-star@1 — keys, entry form, padding to 16, one order, every c the same length', async () => {
  const w = await groupWorld()
  const groups = [{ group: w.G1, sealed: true, member: w.S1, memberOp: w.op1 }, { group: w.G2, sealed: true, member: w.S2, memberOp: w.op2 }]
  const { chunks } = await V.buildGroupStar({ own: w.A, to: w.B.anchor, toKeyAgreement: w.B.keyAgreement, salt: '1', groups, rand: counterRand('star') })
  assert.equal(chunks.length, 1)
  const c0 = chunks[0]
  assert.equal(schemaErrs(c0, 'visibility-group-star.schema.json').length, 0)
  assert.deepEqual(Object.keys(c0.body).sort(), ['groups', 'last', 'salt', 'seq', 'type'])
  assert.equal(c0.body.type, 'group-star@1'); assert.equal(c0.body.last, true); assert.equal(c0.body.seq, '1')
  assert.equal(c0.body.groups.length, 16, 'two real entries padded to the next multiple of 16')
  const ds = c0.body.groups.map((e) => e.d)
  assert.deepEqual(ds, [...ds].sort(), 'sorted by d'); assert.equal(new Set(ds).size, 16)
  assert.equal(new Set(c0.body.groups.map((e) => e.c.length)).size, 1, 'filler is indistinguishable by length')
  // the keys, recomputed from the Kern's info strings
  const sh = await C.ecdh(w.A.x.priv, w.B.x.pubRaw)
  const kg = await C.hkdf(sh, `rltp/visibility/blind/group-star/${w.A.anchor}/${w.B.anchor}/1`)
  assert.equal(await V.macU(kg, C.jcs(c0.body)), c0.proof.mac, 'proof: mac under k_g')
  const d1 = await V.macU(kg, w.G1)
  assert.ok(ds.includes(d1), 'd = HMAC(k_g, UTF-8 of G)')
  const ke = await C.hkdf(sh, `rltp/visibility/seal/group-star/${w.A.anchor}/${w.B.anchor}/1/${w.G1}`)
  const e1 = c0.body.groups.find((e) => e.d === d1)
  const raw = C.fromB64u(e1.c.slice(1))
  const key = await globalThis.crypto.subtle.importKey('raw', ke, 'AES-GCM', false, ['decrypt'])
  const pt = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: new TextEncoder().encode(d1), tagLength: 128 }, key, raw.subarray(12))
  const pair = JSON.parse(new TextDecoder().decode(pt))
  assert.equal(new TextDecoder().decode(pt), C.jcs(pair), 'the sealed bytes are the canonical bytes')
  assert.equal(schemaErrs(pair, 'visibility-group-pair.schema.json').length, 0)
  assert.deepEqual({ ...pair, proof: undefined }, { type: 'group-pair@1', group: w.G1, member: w.S1.anchor, memberOp: w.op1, to: w.B.anchor, salt: '1', proof: undefined })
  const { proof, ...unproved } = pair
  const kp = await C.hkdf(await C.ecdh(w.S1.x.priv, w.B.x.pubRaw), 'rltp/visibility/mac/group-pair')
  assert.equal(await V.macU(kp, C.jcs(unproved)), proof, 'group-pair proof: HMAC under memberX × pairX')
})

test('group-star@1 — reception: hit and open (trusted), hit with filler (untrusted), miss, all-filler', async () => {
  const w = await groupWorld()
  const build = (groups, salt = '1') => V.buildGroupStar({ own: w.A, to: w.B.anchor, toKeyAgreement: w.B.keyAgreement, salt, groups, rand: counterRand('r' + salt) })
  const recv = async (chunks, memberships) => {
    const asm = await V.assembleGroupStar({ own: w.B, from: w.A.anchor, fromKeyAgreement: w.A.keyAgreement, chunks })
    assert.equal(asm.ok, true, asm.reason)
    return V.openGroupStar({ own: w.B, from: w.A.anchor, fromKeyAgreement: w.A.keyAgreement, salt: asm.salt, entries: asm.entries, memberships })
  }
  const trusted = await build([{ group: w.G1, sealed: true, member: w.S1, memberOp: w.op1 }, { group: w.G2, sealed: true, member: w.S2, memberOp: w.op2 }])
  const [r1] = await recv(trusted.chunks, [w.membershipG1])
  assert.deepEqual(r1, { group: w.G1, hit: true, opened: true, accepted: true, member: w.S1.anchor })
  const untrusted = await build([{ group: w.G1, sealed: false }, { group: w.G2, sealed: false }], '2')
  const [r2] = await recv(untrusted.chunks, [w.membershipG1])
  assert.deepEqual(r2, { group: w.G1, hit: true, opened: false, accepted: false }, 'filler is a miss of the opening, not an error')
  const miss = { group: w.G3, isMember: () => true, resolve: () => null }
  const [r3] = await recv(trusted.chunks, [miss])
  assert.deepEqual(r3, { group: w.G3, hit: false, opened: false, accepted: false })
  const empty = await build([], '3')
  assert.equal(empty.chunks.length, 1); assert.equal(empty.chunks[0].body.groups.length, 16, 'no group to list: one all-filler star')
  const [r4] = await recv(empty.chunks, [w.membershipG1])
  assert.equal(r4.hit, false)
  // acceptance checks of an opened pair, in order
  const notMember = { ...w.membershipG1, isMember: (a) => a === w.B.anchor }
  assert.deepEqual((await recv(trusted.chunks, [notMember]))[0], { group: w.G1, hit: true, opened: true, accepted: false, reason: 'member' })
  const unresolved = { ...w.membershipG1, resolve: () => null }
  assert.deepEqual((await recv(trusted.chunks, [unresolved]))[0], { group: w.G1, hit: true, opened: true, accepted: false, reason: 'member' })
  const wrongCard = { ...w.membershipG1, resolve: () => ({ subject: w.S1.anchor, keyAgreement: w.S2.keyAgreement }) }
  assert.deepEqual((await recv(trusted.chunks, [wrongCard]))[0], { group: w.G1, hit: true, opened: true, accepted: false, reason: 'mac' })
  // a star for another recipient opens nothing here: the keys are the tuple's
  const C2 = await C.pairContext(IKM, fill(32, 0xc0))
  const foreign = await V.buildGroupStar({ own: w.A, to: C2.anchor, toKeyAgreement: C2.keyAgreement, salt: '4', groups: [{ group: w.G1, sealed: true, member: w.S1, memberOp: w.op1 }], rand: counterRand('f') })
  const asm = await V.assembleGroupStar({ own: w.B, from: w.A.anchor, fromKeyAgreement: w.A.keyAgreement, chunks: foreign.chunks })
  assert.equal(asm.ok, false, 'the chunk MAC binds the tuple')
})

test('group-star@1 — chunking: at most 64 entries, every chunk fits the Delivery plaintext bound, one global order', async () => {
  const w = await groupWorld()
  const many = []
  for (let i = 0; i < 300; i++) many.push({ group: await C.digestBytes(new TextEncoder().encode('g' + i)), sealed: true, member: w.S1, memberOp: w.op1 })
  const salt = '999999999999999999'
  const { chunks } = await V.buildGroupStar({ own: w.A, to: w.B.anchor, toKeyAgreement: w.B.keyAgreement, salt, groups: many, rand: counterRand('many') })
  assert.ok(chunks.length > 1)
  let union = []
  chunks.forEach((c, i) => {
    assert.equal(schemaErrs(c, 'visibility-group-star.schema.json').length, 0)
    assert.ok(c.body.groups.length <= 64 && c.body.groups.length >= 1)
    assert.equal(c.body.seq, String(i + 1)); assert.equal(c.body.last, i === chunks.length - 1)
    const doc = { id: '00000000-0000-4000-8000-000000000000', type: 'https://real-life.org/trust-tasks/group-star/0.1', issuer: w.A.anchor, recipient: w.B.anchor, threadId: '00000000-0000-4000-8000-000000000000', issuedAt: '2026-10-07T12:00:00Z', payload: c }
    assert.ok(new TextEncoder().encode(C.jcs(doc)).length <= 65536, `chunk ${i + 1} within 65 536 bytes`)
    union = union.concat(c.body.groups.map((e) => e.d))
  })
  assert.equal(union.length % 16, 0); assert.ok(union.length >= 300)
  assert.deepEqual(union, [...union].sort(), 'one global order across chunks')
  const asm = await V.assembleGroupStar({ own: w.B, from: w.A.anchor, fromKeyAgreement: w.A.keyAgreement, chunks: [...chunks].reverse() })
  assert.equal(asm.ok, true, 'assembly is order-independent'); assert.equal(asm.entries.length, union.length)
  const gap = await V.assembleGroupStar({ own: w.B, from: w.A.anchor, fromKeyAgreement: w.A.keyAgreement, chunks: chunks.slice(1) })
  assert.equal(gap.ok, false, 'an incomplete delivery does not assemble')
})

// ── the shipped vectors reproduce through the library ──
test('vectors — anchor-rotation.json and group-star.json reproduce byte for byte', async () => {
  const { readFileSync } = await import('node:fs')
  const vec = (f) => JSON.parse(readFileSync(new URL('../../vectors/' + f, import.meta.url), 'utf8'))
  const RT = vec('anchor-rotation.json')
  const after = (label) => { const m = /^group\/([^/]+)(?:\/([0-9]+))?$/.exec(label); return C.labeledContext(IKM, C.communityLabel(m[1], (m[2] ? Number(m[2]) : 1) + 1)) }
  const [g1, g2] = await Promise.all([1, 2].map((g) => C.communityContext(IKM, D, g)))
  assert.equal(C.jcs(await V.makeSelfCard(g1, g2)), C.jcs(RT.card), 'the generation-1 card reproduces')
  for (const v of RT.valid) {
    const [prev, next] = await Promise.all([v.prevLabel, v.nextLabel].map((l) => C.labeledContext(IKM, l)))
    assert.equal(C.jcs(await V.makeAnchorRotation(prev, next, await after(v.nextLabel))), C.jcs(v.artifact), v.name)
    assert.equal(await V.verifyAnchorRotation(v.artifact, v.heldBinding.commit), true, `${v.name}: meets the binding it is checked against`)
  }
  for (const n of RT.negative) assert.equal(await V.verifyAnchorRotation(n.artifact, n.heldBinding?.commit), false, n.name)
  const GS = vec('group-star.json')
  const P = {}
  for (const [k, v] of Object.entries(GS.parties)) P[k] = await C.pairContext(IKM, hex(v.relationshipNonce))
  const IKM2 = new Uint8Array(crypto.hkdfSync('sha256', IKM, Buffer.alloc(0), Buffer.from('rltp/vector/second-party-root-ikm', 'utf8'), 64))
  const stream = (tag) => { let i = 0; return (n) => new Uint8Array(crypto.hkdfSync('sha256', IKM, Buffer.alloc(0), Buffer.from(`rltp/vector/group-star/entropy/${tag}/${i++}`, 'utf8'), n)) }
  const SG2 = await C.labeledContext(IKM, 'group/' + GS.groups.G2.genesisDigest)
  const listed = (sealed) => [
    { group: GS.groups.G1.genesisDigest, sealed, member: P.SG1, memberOp: GS.groups.G1.genesis.id },
    { group: GS.groups.G2.genesisDigest, sealed, member: SG2, memberOp: GS.groups.G2.memberOp },
  ]
  const trusted = await V.buildGroupStar({ own: P.S_T, to: P.T_S.anchor, toKeyAgreement: P.T_S.keyAgreement, salt: '1', groups: listed(true), rand: stream('trusted') })
  assert.equal(C.jcs(trusted.chunks), C.jcs(GS.stars.trusted), 'the trusted star reproduces')
  const allFiller = await V.buildGroupStar({ own: P.S_T, to: P.T_S.anchor, toKeyAgreement: P.T_S.keyAgreement, salt: '2', groups: [], rand: stream('all-filler') })
  assert.equal(C.jcs(allFiller.chunks), C.jcs(GS.stars.allFiller), 'the all-filler star reproduces')
  // reception of every case through the library
  const gen = GS.groups.G1.genesis
  for (const c of GS.cases) {
    const st = GS.states[c.state]
    const memberships = c.memberships.map((g) => ({
      group: GS.groups[g].genesisDigest,
      isMember: (a) => !!st && st.members.includes(a),
      resolve: (oid) => (g === 'G1' && oid === gen.id ? { subject: gen.body.members[0], keyAgreement: gen.body.card.keyAgreement }
        : g === 'G4' && oid === GS.groups.G4.admission.id ? { subject: GS.groups.G4.admission.body.subject, keyAgreement: GS.groups.G4.admission.body.admission.accept.payload.accept.card.keyAgreement } : null),
    }))
    const asm = await V.assembleGroupStar({ own: P[c.recipient], from: P[c.from].anchor, fromKeyAgreement: P[c.from].keyAgreement, chunks: GS.stars[c.star] })
    assert.equal(asm.ok, true)
    const got = await V.openGroupStar({ own: P[c.recipient], from: P[c.from].anchor, fromKeyAgreement: P[c.from].keyAgreement, salt: asm.salt, entries: asm.entries, memberships })
    assert.deepEqual(got, c.result, c.name)
  }
  for (const n of GS.assemblyNegatives.cases) {
    const asm = await V.assembleGroupStar({ own: P.T_S, from: P.S_T.anchor, fromKeyAgreement: P.S_T.keyAgreement, chunks: n.chunks })
    assert.equal(asm.ok, false, n.name)
  }
  assert.ok(IKM2.length === 64)
})

// ── Trust 0.31 §6.1/§6.3: the bounded lineage (at most 64) ─────────────
test('anchor-mapping@4 — a lineage of 64 elements is accepted, 65 fail the schema (step 1); the held self must be in the segment', async () => {
  const { A, B } = await pairs()
  const { ctxs, chain } = await longChain()
  const ctx = { own: B, pair: A.anchor, pairKeyAgreement: A.keyAgreement }
  const m64 = await V.buildAnchorMapping({ pair: A, to: B.anchor, toKeyAgreement: B.keyAgreement, self: ctxs[65], nextGen: ctxs[66], lineage: chain.slice(1), revision: '3', issuedAt: '2026-10-07T12:00:00Z' })
  assert.deepEqual(await V.verifyAnchorMapping(m64, ctx), { ok: true }, '64 elements')
  assert.deepEqual(await V.verifyAnchorMapping(m64, { ...ctx, held: new Map([[ctxs[1].anchor, chain[0].body.commit]]) }), { ok: true }, 'against the binding held for generation 2')
  const doc = { id: '00000000-0000-4000-8000-000000000000', type: 'https://real-life.org/trust-tasks/anchor-mapping/0.3', issuer: A.anchor, recipient: B.anchor, threadId: '00000000-0000-4000-8000-000000000000', issuedAt: '2026-10-07T12:00:00Z', payload: m64 }
  assert.ok(new TextEncoder().encode(C.jcs(doc)).length <= 65536, 'a full lineage fits the Delivery plaintext bound')
  const m65 = await V.buildAnchorMapping({ pair: A, to: B.anchor, toKeyAgreement: B.keyAgreement, self: ctxs[65], nextGen: ctxs[66], lineage: chain, revision: '3', issuedAt: '2026-10-07T12:00:00Z' })
  assert.ok(schemaErrs(m65, 'visibility-anchor-mapping.schema.json').length > 0, 'maxItems 64')
  assert.deepEqual(await V.verifyAnchorMapping(m65, ctx), { ok: false, step: '1' }, '65 elements')
  // condition 8: a contact holding generation 2 is inside the carried segment (2→3 … 65→66): a rotation;
  // one holding generation 1 missed more than 64 rotations: rejected, it keeps the anchor it holds (6170, 6400)
  assert.equal(V.classifyMapping(ctxs[1].anchor, m64.body), 'rotation')
  assert.equal(V.classifyMapping(ctxs[0].anchor, m64.body), 'rejected')
})

// ── Trust 0.31 §5.2b reception: the assembled total and the c length ──
test('group-star@1 — reception rejects an assembly whose size is no positive multiple of 16, or whose c lengths differ', async () => {
  const w = await groupWorld()
  const kg = await V.groupStarKey(w.A, w.B.keyAgreement, w.A.anchor, w.B.anchor, '7')
  const rnd = counterRand('m10')
  const cOf = (n) => 'u' + C.b64uOf(rnd(n))
  const entries = (n, cLen = 370) => Array.from({ length: n }, () => ({ d: 'u' + C.b64uOf(rnd(32)), c: cOf(cLen) })).sort((x, y) => (x.d < y.d ? -1 : 1))
  const chunk = async (groups, seq = '1', last = true) => { const body = { type: 'group-star@1', salt: '7', seq, last, groups }; return { body, proof: { mac: await V.macU(kg, C.jcs(body)) } } }
  const asm = (chunks) => V.assembleGroupStar({ own: w.B, from: w.A.anchor, fromKeyAgreement: w.A.keyAgreement, chunks })
  for (const n of [1, 15, 17]) {
    const r = await asm([await chunk(entries(n))])
    assert.deepEqual(r, { ok: false, reason: 'size' }, `${n} entries`)
  }
  assert.equal((await asm([await chunk(entries(16))])).ok, true, '16 entries assemble')
  const e32 = entries(32)
  assert.equal((await asm([await chunk(e32.slice(0, 20), '1', false), await chunk(e32.slice(20), '2', true)])).ok, true, '32 entries over two chunks assemble')
  const mixed = entries(16); mixed[5] = { d: mixed[5].d, c: cOf(371) }
  assert.deepEqual(await asm([await chunk(mixed)]), { ok: false, reason: 'c length' }, 'one c of a different length')
})

// ── Trust 0.31 §6.3 condition 4b: another successor of a held anchor (review 2, M3) ──
test('anchor-mapping@4 — condition 4b: a carried segment that names another successor of an anchor whose binding the relationship holds is rejected', async () => {
  const { A, B } = await pairs()
  const [g1, g2, g3, g4] = await gens()
  const x = await C.communityContext(IKM, OTHER)
  const ctx = { own: B, pair: A.anchor, pairKeyAgreement: A.keyAgreement }
  // what the relationship holds: generation 2, reached through 1 → 2 (6610)
  const r12 = await rot(g1, g2)
  const heldMapping = await V.buildAnchorMapping({ pair: A, to: B.anchor, toKeyAgreement: B.keyAgreement, self: g2, nextGen: g3, lineage: [r12], revision: '2', issuedAt: '2026-10-07T12:00:00Z' })
  const held = await V.mappingBindings(heldMapping.body)
  // the segment carries the held self g2, but its first link leaves g1 for x, not for g2;
  // every element meets the commit of the one before it, the card the last commit
  const lineage = [await forge(g1, x, g2), await forge(x, g2, g3), await rot(g2, g3)]
  const m = await V.buildAnchorMapping({ pair: A, to: B.anchor, toKeyAgreement: B.keyAgreement, self: g3, nextGen: g4, lineage, revision: '3', issuedAt: '2026-10-07T12:00:00Z' })
  assert.deepEqual(await V.verifyAnchorMapping(m, ctx), { ok: true }, 'without held bindings the chain proves joint authorization only')
  assert.deepEqual(await V.verifyAnchorMapping(m, { ...ctx, held }), { ok: false, step: '4b' }, 'g1 → x beside the held binding of g1: rejected, the held state stays')
  // the honest continuation passes
  const honest = await V.buildAnchorMapping({ pair: A, to: B.anchor, toKeyAgreement: B.keyAgreement, self: g3, nextGen: g4, lineage: [r12, await rot(g2, g3)], revision: '3', issuedAt: '2026-10-07T12:00:00Z' })
  assert.deepEqual(await V.verifyAnchorMapping(honest, { ...ctx, held }), { ok: true })
  assert.equal(V.classifyMapping(g2.anchor, honest.body), 'rotation')
})
