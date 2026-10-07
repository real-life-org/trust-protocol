#!/usr/bin/env node
// The community anchor's generations and the group star (Identity 0.52
// §5.4/§6.1, Network Visibility 0.30 §5.2b/§6.1/§6.5, Access 0.56 §5.6):
// the label grammar of `group/<digest>/<generation>`, the derivation on
// the one HKDF path, anchor-rotation@1 and its lineage, anchor-mapping@3
// with the rotation-vs-new-community classification, and group-star@1
// with its sealed group pairs — every check independent of the vectors
// (those are generated FROM this library by scripts/gen-anchor-vectors.mjs
// and re-derived by conformance/runner.mjs with node:crypto alone).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import * as C from '../dist/index.js'
import { visibility } from '../dist/index.js'
import { introduce as I, membership as G, SCHEMAS } from '../dist/probe.js'

const V = visibility
const { trust: T } = visibility
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

// ── Identity 0.52 §6.1: the generation row of the closed registry ───────
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

// ── Visibility 0.30 §6.5: anchor-rotation@1 and the lineage ────────────
const gens = async () => Promise.all([1, 2, 3, 4].map((g) => C.communityContext(IKM, D, g)))
// generations 1 … 66 and the 65 rotations between them
let LONG
const longChain = async () => {
  if (LONG) return LONG
  const ctxs = await Promise.all(Array.from({ length: 66 }, (_, i) => C.communityContext(IKM, D, i + 1)))
  const chain = []
  for (let i = 0; i < 65; i++) chain.push(await V.makeAnchorRotation(ctxs[i], ctxs[i + 1]))
  return (LONG = { ctxs, chain })
}

test('anchor-rotation@1 — a key-chain link: { type, prev, next }, signed by both keys, schema-closed', async () => {
  const [g1, g2] = await gens()
  const r = await V.makeAnchorRotation(g1, g2)
  assert.deepEqual(Object.keys(r.body).sort(), ['next', 'prev', 'type'], 'no generation field: the chain order is prev/next alone')
  assert.equal(r.body.type, 'anchor-rotation@1')
  assert.equal(r.body.prev, g1.anchor); assert.equal(r.body.next, g2.anchor)
  assert.equal(schemaErrs(r, 'visibility-anchor-rotation.schema.json').length, 0)
  assert.equal(await V.verifyAnchorRotation(r), true)
  // the two signatures are raw Ed25519 over JCS(body), one under each key
  const bytes = new TextEncoder().encode(C.jcs(r.body))
  const pub = (did) => globalThis.crypto.subtle.importKey('raw', C.edRawOfAnchor(did), { name: 'Ed25519' }, false, ['verify'])
  assert.ok(await globalThis.crypto.subtle.verify({ name: 'Ed25519' }, await pub(g1.anchor), C.fromBase58(r.proof.proofValue.slice(1)), bytes), 'proofValue under prev')
  assert.ok(await globalThis.crypto.subtle.verify({ name: 'Ed25519' }, await pub(g2.anchor), C.fromBase58(r.proof.successorProofValue.slice(1)), bytes), 'successorProofValue under next')
  // negatives
  const swapped = { body: r.body, proof: { proofValue: r.proof.proofValue, successorProofValue: r.proof.proofValue } }
  assert.equal(await V.verifyAnchorRotation(swapped), false, 'a wrong successor signature fails')
  // the former shape with a generation field, genuinely signed by both keys: the closed schema rejects it
  const b0 = { ...r.body, generation: '2' }
  const withGen = { body: b0, proof: { proofValue: await V.signRaw(g1, b0), successorProofValue: await V.signRaw(g2, b0) } }
  assert.ok(schemaErrs(withGen, 'visibility-anchor-rotation.schema.json').length > 0, 'a generation field fails the schema')
  assert.equal(await V.verifyAnchorRotation(withGen), false, 'a generation field is rejected')
  const extra = structuredClone(r); extra.body.note = 'x'
  assert.equal(await V.verifyAnchorRotation(extra), false, 'closed body')
  // a rotation moves: next differs from prev
  await assert.rejects(() => V.makeAnchorRotation(g1, g1), undefined, 'a rotation onto its own key is never produced')
  const bs = { type: 'anchor-rotation@1', prev: g1.anchor, next: g1.anchor }
  const still = { body: bs, proof: { proofValue: await V.signRaw(g1, bs), successorProofValue: await V.signRaw(g1, bs) } }
  assert.equal(await V.verifyAnchorRotation(still), false, 'prev = next is rejected')
  // after a lost register: generation 1 of a NEW personal community, signed by the old generation (Identity 9.3)
  const fresh = await C.communityContext(IKM, 'uEiCCsq5ciVSsrhXjp4-OoQbQ4JStCJEvM82lS_CIh4SFPA')
  assert.equal(await V.verifyAnchorRotation(await V.makeAnchorRotation(g2, fresh)), true, 'next may be generation 1 of a new personal community')
})

test('lineage — a key chain as given: each prev the preceding next, the last next = self, at most 64', async () => {
  const [g1, g2, g3, g4] = await gens()
  const r2 = await V.makeAnchorRotation(g1, g2), r3 = await V.makeAnchorRotation(g2, g3)
  assert.equal(V.LINEAGE_MAX, 64)
  assert.deepEqual(await V.verifyLineage([], g1.anchor), { ok: true }, 'empty: the sender presents no history')
  assert.deepEqual(await V.verifyLineage([r2], g2.anchor), { ok: true })
  assert.deepEqual(await V.verifyLineage([r2, r3], g3.anchor), { ok: true })
  assert.deepEqual(await V.verifyLineage([r3], g3.anchor), { ok: true }, 'a segment: the carried part need not start at generation 1')
  assert.equal((await V.verifyLineage([r2], g3.anchor)).ok, false, 'last next ≠ self')
  const r3x = await V.makeAnchorRotation(g1, g3)
  assert.equal((await V.verifyLineage([r2, r3x], g3.anchor)).ok, false, 'prev break')
  const r4 = await V.makeAnchorRotation(g2, g4)
  assert.deepEqual(await V.verifyLineage([r2, r4], g4.anchor), { ok: true }, 'no numbers: the chain is the keys, a derivation skip is invisible and harmless')
  const fresh = await C.communityContext(IKM, 'uEiCCsq5ciVSsrhXjp4-OoQbQ4JStCJEvM82lS_CIh4SFPA')
  const rf = await V.makeAnchorRotation(g2, fresh)
  assert.deepEqual(await V.verifyLineage([r2, rf], fresh.anchor), { ok: true }, 'onto a new personal community after a loss')
  const bad = structuredClone(r2); bad.proof.successorProofValue = r2.proof.proofValue
  assert.equal((await V.verifyLineage([bad], g2.anchor)).ok, false, 'every element verifies under both signatures')
  assert.deepEqual(V.lineageAnchors([r2, r3]), [g1.anchor, g2.anchor, g3.anchor])
  // the bound: 64 elements pass, 65 fail
  const { ctxs, chain } = await longChain()
  assert.deepEqual(await V.verifyLineage(chain.slice(1), ctxs[65].anchor), { ok: true }, '64 elements')
  assert.equal((await V.verifyLineage(chain, ctxs[65].anchor)).ok, false, '65 elements')
  // the anchor set a mapping verifies: self and every anchor of its carried lineage (Visibility 6a.1 no. 2)
  assert.deepEqual(V.mappingAnchors({ self: g1.anchor, lineage: [] }), [g1.anchor])
  assert.deepEqual(V.mappingAnchors({ self: g3.anchor, lineage: [r2, r3] }), [g1.anchor, g2.anchor, g3.anchor])
})

// ── Visibility 0.30 §6.1/§6.3: anchor-mapping@3 ──────────────────────────
const pairs = async () => ({
  A: await C.pairContext(IKM, fill(32, 0xa0)),
  B: await C.pairContext(IKM, fill(32, 0xb0)),
})

test('anchor-mapping@3 — lineage in the body, proof unchanged, 6.3 in order with 4a', async () => {
  const { A, B } = await pairs()
  const [g1, g2] = await gens()
  const r2 = await V.makeAnchorRotation(g1, g2)
  const m = await V.buildAnchorMapping({ pair: A, to: B.anchor, toKeyAgreement: B.keyAgreement, self: g2, lineage: [r2], revision: '2', issuedAt: '2026-10-07T12:00:00Z' })
  assert.equal(m.body.type, 'anchor-mapping@3')
  assert.deepEqual(m.body.lineage, [r2])
  assert.equal(m.body.card.body.anchor, g2.anchor, 'card under the current generation')
  assert.equal(schemaErrs(m, 'visibility-anchor-mapping.schema.json').length, 0)
  const ctx = { own: B, pair: A.anchor, pairKeyAgreement: A.keyAgreement }
  assert.deepEqual(await V.verifyAnchorMapping(m, ctx), { ok: true })
  // mac2 under selfX of the CURRENT generation
  const k2 = await C.hkdf(await C.ecdh(B.x.priv, g2.x.pubRaw), 'rltp/visibility/mac/map2')
  assert.equal(await T.hmacU(k2, C.jcs(m.body)), m.proof.mac2)
  const empty = await V.buildAnchorMapping({ pair: A, to: B.anchor, toKeyAgreement: B.keyAgreement, self: g1, lineage: [], revision: '1', issuedAt: '2026-10-07T12:00:00Z' })
  assert.deepEqual(await V.verifyAnchorMapping(empty, ctx), { ok: true }, 'empty lineage')
  // 4a fails: a lineage that does not end at self (MACs recomputed over the mutated body)
  const wrongEnd = await V.buildAnchorMapping({ pair: A, to: B.anchor, toKeyAgreement: B.keyAgreement, self: g1, lineage: [r2], revision: '1', issuedAt: '2026-10-07T12:00:00Z' })
  assert.deepEqual(await V.verifyAnchorMapping(wrongEnd, ctx), { ok: false, step: '4a' })
  const legacy = structuredClone(empty); legacy.body.type = 'anchor-mapping@2'; delete legacy.body.lineage
  assert.deepEqual(await V.verifyAnchorMapping(legacy, ctx), { ok: false, step: '1' }, 'anchor-mapping@2 is rejected like @1')
  assert.deepEqual(await V.verifyAnchorMapping(empty, { ...ctx, pair: B.anchor }), { ok: false, step: '3' })
})

test('anchor-mapping@3 — a changed self is a rotation when the lineage carries the held self, else a new community', async () => {
  const [g1, g2, g3] = await gens()
  const r2 = await V.makeAnchorRotation(g1, g2), r3 = await V.makeAnchorRotation(g2, g3)
  const other = await C.communityContext(IKM, 'uEiCCsq5ciVSsrhXjp4-OoQbQ4JStCJEvM82lS_CIh4SFPA')
  assert.equal(V.classifyMapping(undefined, { self: g1.anchor, lineage: [] }), 'first')
  assert.equal(V.classifyMapping(g1.anchor, { self: g1.anchor, lineage: [] }), 'same')
  assert.equal(V.classifyMapping(g1.anchor, { self: g2.anchor, lineage: [r2] }), 'rotation')
  assert.equal(V.classifyMapping(g1.anchor, { self: g3.anchor, lineage: [r2, r3] }), 'rotation', 'a contact that lagged two generations follows')
  assert.equal(V.classifyMapping(g2.anchor, { self: g3.anchor, lineage: [r2, r3] }), 'rotation')
  assert.equal(V.classifyMapping(g1.anchor, { self: other.anchor, lineage: [] }), 'new-community')
  assert.equal(V.classifyMapping(g1.anchor, { self: g2.anchor, lineage: [] }), 'new-community', 'without a reachable lineage nothing links the two')
})

// ── Visibility 0.30 §5.2b: group-star@1 ─────────────────────────────────
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
  assert.equal(await T.hmacU(kg, C.jcs(c0.body)), c0.proof.mac, 'proof: mac under k_g')
  const d1 = await T.hmacU(kg, w.G1)
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
  assert.equal(await T.hmacU(kp, C.jcs(unproved)), proof, 'group-pair proof: HMAC under memberX × pairX')
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

// ── Access 3.4.1 / RLTP-ACC-3235, 3275: the founder's roster entry ──────
test('membership — the founder stands in the roster under its fresh founding pair anchor, never group/<digest>', async () => {
  const p = I.createPerson('Berta')
  const g = await G.foundGroup(p, 'Werk', Date.parse('2026-10-07T12:00:00Z'))
  const derived = await C.labeledContext(p.rootIkm, 'group/' + g.genesisDigest)
  assert.ok(g.myMemberCtx.label.startsWith('pair/'), 'the founder acts under the founding pair context')
  assert.equal(g.genesis.founder, g.myMemberCtx.anchor, 'the genesis names the founding anchor')
  assert.ok(g.roster.has(g.myMemberCtx.anchor) && g.roster.get(g.myMemberCtx.anchor).founder === true)
  assert.ok(!g.roster.has(derived.anchor), 'the derived group/<digest> anchor is not in the roster')
  assert.equal(g.roster.size, 1)
  assert.equal(p.contexts.get(g.myMemberCtx.anchor), g.myMemberCtx, 'the founding context is held')
})

// ── the probe: rotation re-issues anchor-mapping@3, the contact follows ──
test('probe — the trust act carries anchor-mapping@3; a rotation is followed, star tests run against every generation', async () => {
  const T0 = Date.parse('2026-10-07T12:00:00Z')
  const anton = I.createPerson('Anton'), berta = I.createPerson('Berta')
  await I.ceremony(anton, berta, T0)
  const bKey = [...anton.contacts.keys()][0], aKey = [...berta.contacts.keys()][0]
  const pkt = await T.setTrust(anton, bKey, T0 + 1000)
  const mappingEnv = pkt.outbound[0].env
  const r1 = await T.receiveTrustDoc(berta, mappingEnv, T0 + 2000)
  assert.ok(r1.handled && !r1.error, r1.error)
  const held = berta.contacts.get(aKey)
  assert.equal(held.mapping.body.type, 'anchor-mapping@3')
  assert.deepEqual(held.mapping.body.lineage, [])
  const g1 = (await T.communityContext(anton)).anchor
  assert.equal(held.selfAnchor, g1)
  // the rotation: label first, then the lineage, then the re-issue to every trusted contact
  const rot = await T.rotateCommunityAnchor(anton, T0 + 10_000)
  assert.equal(anton.communityGeneration, 2)
  const g2 = (await T.communityContext(anton)).anchor
  assert.notEqual(g2, g1)
  assert.equal(anton.lineage.length, 1); assert.equal(anton.lineage[0].body.prev, g1); assert.equal(anton.lineage[0].body.next, g2)
  assert.equal(rot.outbound.length, 1, 'one re-issued mapping per trusted contact')
  const r2 = await T.receiveTrustDoc(berta, rot.outbound[0].env, T0 + 11_000)
  assert.ok(r2.handled && !r2.error, r2.error)
  assert.equal(r2.classification, 'rotation')
  assert.equal(held.selfAnchor, g2, 'the held anchor advances')
  assert.deepEqual([...held.selfAnchors].sort(), [g1, g2].sort(), 'every generation is held for the star test')
  assert.equal(held.mapRevIn, '2')
  assert.equal(T.viewOf(berta, T0 + 12_000 + 86_400_000).filter((v) => v.member === g2).length, 1, 'one admission entry, now under the current generation')
})

// ── the shipped vectors reproduce through the library (scripts/gen-anchor-vectors.mjs) ──
test('vectors — anchor-rotation.json and group-star.json reproduce byte for byte', async () => {
  const { readFileSync } = await import('node:fs')
  const vec = (f) => JSON.parse(readFileSync(new URL('../../vectors/' + f, import.meta.url), 'utf8'))
  const RT = vec('anchor-rotation.json')
  for (const v of RT.valid) {
    const [prev, next] = await Promise.all([v.prevLabel, v.nextLabel].map((l) => C.labeledContext(IKM, l)))
    assert.equal(C.jcs(await V.makeAnchorRotation(prev, next)), C.jcs(v.artifact), v.name)
  }
  for (const n of RT.negative) assert.equal(await V.verifyAnchorRotation(n.artifact), false, n.name)
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

test('probe — a changed self without a reachable lineage is a new community: the relationship splits off the merged entry', async () => {
  const b = I.createPerson('B')
  const [g1, g2] = await gens()
  const r2 = await V.makeAnchorRotation(g1, g2)
  // two relationships of the same person, merged by the same self (way-2 merge)
  T.promotionCommit(b, 'r1', g1.anchor, 'k1', 0)
  const e = T.promotionCommit(b, 'r2', g1.anchor, 'k2', 0)
  assert.equal(e.relIds.size, 2, 'merged')
  // r2 rotates: still the same entry, now under generation 2, both generations held
  const er = T.promotionCommit(b, 'r2', g2.anchor, 'k2', 0, V.lineageAnchors([r2]), 'rotation')
  assert.equal(er, e); assert.equal(e.self, g2.anchor); assert.ok(e.anchors.has(g1.anchor) && e.anchors.has(g2.anchor))
  // r1 later learns the rotation too: still one entry (held in the lineage)
  assert.equal(T.promotionCommit(b, 'r1', g2.anchor, 'k1', 0, V.lineageAnchors([r2]), 'rotation'), e)
  // r1 now presents an unrelated anchor without lineage: a new community — it leaves the merged entry
  const other = await C.communityContext(IKM, 'uEiCCsq5ciVSsrhXjp4-OoQbQ4JStCJEvM82lS_CIh4SFPA')
  const en = T.promotionCommit(b, 'r1', other.anchor, 'k1', 0, [other.anchor], 'new-community')
  assert.notEqual(en, e, 'nothing links the two: a separate entry')
  assert.ok(!e.relIds.has('r1') && e.relIds.has('r2'))
  assert.equal(T.viewOf(b, 86_400_001).length, 2, 'two members in the view')
})

// ── Visibility 0.30 §6.1/§6.3: the bounded lineage (at most 64) ─────────
test('anchor-mapping@3 — a lineage of 64 elements is accepted, 65 fail the schema (step 1); the held self must be in the segment', async () => {
  const { A, B } = await pairs()
  const { ctxs, chain } = await longChain()
  const ctx = { own: B, pair: A.anchor, pairKeyAgreement: A.keyAgreement }
  const m64 = await V.buildAnchorMapping({ pair: A, to: B.anchor, toKeyAgreement: B.keyAgreement, self: ctxs[65], lineage: chain.slice(1), revision: '3', issuedAt: '2026-10-07T12:00:00Z' })
  assert.deepEqual(await V.verifyAnchorMapping(m64, ctx), { ok: true }, '64 elements')
  const doc = { id: '00000000-0000-4000-8000-000000000000', type: 'https://real-life.org/trust-tasks/anchor-mapping/0.2', issuer: A.anchor, recipient: B.anchor, threadId: '00000000-0000-4000-8000-000000000000', issuedAt: '2026-10-07T12:00:00Z', payload: m64 }
  assert.ok(new TextEncoder().encode(C.jcs(doc)).length <= 65536, 'a full lineage fits the Delivery plaintext bound')
  const m65 = await V.buildAnchorMapping({ pair: A, to: B.anchor, toKeyAgreement: B.keyAgreement, self: ctxs[65], lineage: chain, revision: '3', issuedAt: '2026-10-07T12:00:00Z' })
  assert.ok(schemaErrs(m65, 'visibility-anchor-mapping.schema.json').length > 0, 'maxItems 64')
  assert.deepEqual(await V.verifyAnchorMapping(m65, ctx), { ok: false, step: '1' }, '65 elements')
  // condition 8: a contact holding generation 2 is inside the carried segment (2→3 … 65→66): a rotation;
  // one holding generation 1 missed more than 64 rotations: a new community
  assert.equal(V.classifyMapping(ctxs[1].anchor, m64.body), 'rotation')
  assert.equal(V.classifyMapping(ctxs[0].anchor, m64.body), 'new-community')
})

// ── Visibility 0.30 §6a.1 no. 2: the convergence net is symmetric ──────
test('probe — the convergence net merges when the verified anchor sets meet, in both arrival orders', async () => {
  const [g1, g2] = await gens()
  const r2 = await V.makeAnchorRotation(g1, g2)
  // the review's case: the old relationship holds generation 1 without lineage,
  // a new relationship (after a lost register) brings generation 2 with lineage 1→2
  const b = I.createPerson('B')
  const old = T.promotionCommit(b, 'r1', g1.anchor, 'k1', 0, V.mappingAnchors({ self: g1.anchor, lineage: [] }))
  const neu = T.promotionCommit(b, 'r2', g2.anchor, 'k2', 0, V.mappingAnchors({ self: g2.anchor, lineage: [r2] }))
  assert.equal(neu, old, 'merged: generation 1 is in the new mapping\'s verified set')
  assert.equal(old.self, g2.anchor, 'the newest generation is the current anchor')
  assert.equal(T.viewOf(b, 86_400_001).length, 1)
  // the other order: the relationship with the lineage arrives first; a stale
  // mapping under the superseded generation 1 does not merge (review 3, M2) —
  // the merge follows when that relationship receives the rotation
  const c = I.createPerson('C')
  const first = T.promotionCommit(c, 'r1', g2.anchor, 'k1', 0, V.mappingAnchors({ self: g2.anchor, lineage: [r2] }))
  const second = T.promotionCommit(c, 'r2', g1.anchor, 'k2', 0, V.mappingAnchors({ self: g1.anchor, lineage: [] }))
  assert.notEqual(second, first, 'generation 1 is superseded on r1: no merge')
  assert.equal(first.self, g2.anchor, 'an older generation does not displace the current one')
  const followed = T.promotionCommit(c, 'r2', g2.anchor, 'k2', 0, V.mappingAnchors({ self: g2.anchor, lineage: [r2] }), 'rotation')
  assert.equal(followed, first, 'r2 follows the rotation onto the head r1 holds: merged')
  assert.equal(T.viewOf(c, 86_400_001).length, 1)
})

// ── Visibility 0.30 §6a.1 no. 2: the merge reaches the held head (review 3, M2) ──
test('probe — review 3 attack: a copied superseded key presented with an empty lineage does not merge with a relationship holding A → B', async () => {
  const [gA, gB] = await gens()
  const honest = await V.makeAnchorRotation(gA, gB)
  const b = I.createPerson('B')
  const victim = T.promotionCommit(b, 'r-victim', gB.anchor, 'k-victim', 0, V.mappingAnchors({ self: gB.anchor, lineage: [honest] }))
  // the attacker holds only the copied key of A: self = A, no lineage, on its own relationship
  const attacker = T.promotionCommit(b, 'r-attacker', gA.anchor, 'k-attacker', 0, V.mappingAnchors({ self: gA.anchor, lineage: [] }))
  assert.notEqual(attacker, victim, 'A is superseded on the victim\'s relationship: no merge')
  assert.ok(!victim.relIds.has('r-attacker'))
  assert.equal(T.viewOf(b, 86_400_001).length, 2, 'two members')
})

test('probe — the merge reaches the held head: self = the head merges, a lineage extending the head merges, a recovery fork does not', async () => {
  const [gA, gB, gC] = await gens()
  const ab = await V.makeAnchorRotation(gA, gB)
  const bc = await V.makeAnchorRotation(gB, gC)
  const holding = () => { const p = I.createPerson('P'); return [p, T.promotionCommit(p, 'r1', gB.anchor, 'k1', 0, V.mappingAnchors({ self: gB.anchor, lineage: [ab] }))] }
  // self = B, the head r1 holds
  const [b, e1] = holding()
  assert.equal(T.promotionCommit(b, 'r2', gB.anchor, 'k2', 0, V.mappingAnchors({ self: gB.anchor, lineage: [] })), e1, 'self equals the held head: merged')
  // self = C, lineage A → B → C against the held {A, B}: it extends the head B
  const [c, e2] = holding()
  const ext = T.promotionCommit(c, 'r2', gC.anchor, 'k2', 0, V.mappingAnchors({ self: gC.anchor, lineage: [ab, bc] }))
  assert.equal(ext, e2, 'the lineage carries the head as a prev: merged')
  assert.equal(e2.self, gC.anchor, 'the newest generation is the current anchor')
  // an honest recovery from a stale counterpart: A → B' onto a new community, against the held A → B
  const bPrime = await C.communityContext(IKM, 'uEiCCsq5ciVSsrhXjp4-OoQbQ4JStCJEvM82lS_CIh4SFPA')
  const fork = await V.makeAnchorRotation(gA, bPrime)
  const [d, e3] = holding()
  const rec = T.promotionCommit(d, 'r2', bPrime.anchor, 'k2', 0, V.mappingAnchors({ self: bPrime.anchor, lineage: [fork] }))
  assert.notEqual(rec, e3, 'A → B\' against A → B: a new community, no merge')
  assert.equal(T.viewOf(d, 86_400_001).length, 2)
})

// ── Visibility 0.30 §5.2b reception: the assembled total and the c length ──
test('group-star@1 — reception rejects an assembly whose size is no positive multiple of 16, or whose c lengths differ', async () => {
  const w = await groupWorld()
  const kg = await V.groupStarKey(w.A, w.B.keyAgreement, w.A.anchor, w.B.anchor, '7')
  const rnd = counterRand('m10')
  const cOf = (n) => 'u' + C.b64uOf(rnd(n))
  const entries = (n, cLen = 370) => Array.from({ length: n }, () => ({ d: 'u' + C.b64uOf(rnd(32)), c: cOf(cLen) })).sort((x, y) => (x.d < y.d ? -1 : 1))
  const chunk = async (groups, seq = '1', last = true) => { const body = { type: 'group-star@1', salt: '7', seq, last, groups }; return { body, proof: { mac: await T.hmacU(kg, C.jcs(body)) } } }
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

test('probe — the mapping carries the 64 most recent rotations; a contact holding the segment follows', async () => {
  const T0 = Date.parse('2026-10-07T12:00:00Z')
  const anton = I.createPerson('Anton'), berta = I.createPerson('Berta')
  await I.ceremony(anton, berta, T0)
  const bKey = [...anton.contacts.keys()][0], aKey = [...berta.contacts.keys()][0]
  for (let i = 0; i < 65; i++) await T.rotateCommunityAnchor(anton, T0 + 1 + i)
  assert.equal(anton.lineage.length, 65, 'the holder keeps its whole lineage')
  const pkt = await T.setTrust(anton, bKey, T0 + 1000)
  const r = await T.receiveTrustDoc(berta, pkt.outbound[0].env, T0 + 2000)
  assert.ok(r.handled && !r.error, r.error)
  const m = berta.contacts.get(aKey).mapping
  assert.equal(m.body.lineage.length, 64, 'at most 64 elements travel')
  assert.equal(C.jcs(m.body.lineage), C.jcs(anton.lineage.slice(-64)), 'the most recent ones, in chain order')
})

// ── Visibility 0.30 §6a.1 no. 2, the fork rule (review 2, M3) ───────────
test('anchor-mapping@3 — condition 8: a carried segment that forks against the links the relationship holds is a new community', async () => {
  const [g1, g2, g3] = await gens()
  const x = await C.communityContext(IKM, 'uEiCCsq5ciVSsrhXjp4-OoQbQ4JStCJEvM82lS_CIh4SFPA')
  const held = V.lineageLinks([await V.makeAnchorRotation(g1, g2)])
  assert.deepEqual(held, [[g1.anchor, g2.anchor]])
  // the segment carries the held self g2, but its first link leaves g1 for x, not for g2
  const body = { self: g3.anchor, lineage: [await V.makeAnchorRotation(g1, x), await V.makeAnchorRotation(x, g2), await V.makeAnchorRotation(g2, g3)] }
  assert.equal(V.classifyMapping(g2.anchor, body), 'rotation', 'without the held links: the held self is in the segment')
  assert.equal(V.classifyMapping(g2.anchor, body, new Map(held)), 'new-community', 'g1 → x beside the held g1 → g2: a fork')
  assert.equal(V.linksFork(new Map(held), V.lineageLinks(body.lineage)), true)
  // the honest continuation does not fork
  const honest = { self: g3.anchor, lineage: [await V.makeAnchorRotation(g1, g2), await V.makeAnchorRotation(g2, g3)] }
  assert.equal(V.classifyMapping(g2.anchor, honest, new Map(held)), 'rotation')
})

test('probe — review 2 attack: a copied old community key presents A → X on its own relationship; a recipient holding A → B does not merge', async () => {
  const [gA, gB] = await gens()
  const x = await C.communityContext(IKM, 'uEiCCsq5ciVSsrhXjp4-OoQbQ4JStCJEvM82lS_CIh4SFPA')   // the attacker's own anchor
  const honest = await V.makeAnchorRotation(gA, gB)
  const forged = await V.makeAnchorRotation(gA, x)          // signed with the copied key A and the attacker's X
  // the victim's rotation reached the recipient first: it holds A → B on the victim's relationship
  const b = I.createPerson('B')
  const victim = T.promotionCommit(b, 'r-victim', gB.anchor, 'k-victim', 0, V.mappingAnchors({ self: gB.anchor, lineage: [honest] }), 'new-community')
  const attacker = T.promotionCommit(b, 'r-attacker', x.anchor, 'k-attacker', 0, V.mappingAnchors({ self: x.anchor, lineage: [forged] }), 'new-community')
  assert.notEqual(attacker, victim, 'A → X forks against the held A → B: no merge (6a.1)')
  assert.ok(!victim.relIds.has('r-attacker'))
  assert.equal(T.viewOf(b, 86_400_001).length, 2, 'two members')
  // the residue (Visibility §11, Identity §13): before the honest rotation reaches the
  // recipient it holds A alone, nothing forks, and the anchor sets meet — the merge happens
  const c = I.createPerson('C')
  const v2 = T.promotionCommit(c, 'r-victim', gA.anchor, 'k-victim', 0, V.mappingAnchors({ self: gA.anchor, lineage: [] }))
  const a2 = T.promotionCommit(c, 'r-attacker', x.anchor, 'k-attacker', 0, V.mappingAnchors({ self: x.anchor, lineage: [forged] }), 'new-community')
  assert.equal(a2, v2, 'the named residue: a copied key merges before the honest rotation arrives')
})

// ── Visibility 0.30 §6.3 condition 8 and §2: the split (review 2, M4) ──
test('probe — a new community on one relationship splits it off: the merged entry keeps position, status and the other relationships; the leaver re-enters under the ordinary admission rule', async () => {
  const b = I.createPerson('B')
  b.admissionBound = 2n
  const [g1] = await gens()
  const other = await C.communityContext(IKM, 'uEiCCsq5ciVSsrhXjp4-OoQbQ4JStCJEvM82lS_CIh4SFPA')
  const merged = T.promotionCommit(b, 'r1', g1.anchor, 'k1', 0)
  assert.equal(T.promotionCommit(b, 'r2', g1.anchor, 'k2', 0), merged, 'way-2 merge')
  const third = T.promotionCommit(b, 'r3', 'self-3', 'k3', 0)
  const pos = merged.pos
  assert.equal(merged.status, 'admitted'); assert.equal(third.status, 'admitted'); assert.equal(b.admission.admitted, 2n)
  // r2 receives a higher revision whose self reaches nothing it held: a new community
  const left = T.promotionCommit(b, 'r2', other.anchor, 'k2', 5, [other.anchor], 'new-community')
  assert.notEqual(left, merged, 'the relationship leaves the merged entry')
  assert.equal(merged.pos, pos, 'the staying entry keeps its position')
  assert.equal(merged.status, 'admitted', 'and its admission status')
  assert.deepEqual([...merged.relIds], ['r1'], 'and its remaining relationships')
  assert.deepEqual([...merged.rels], ['k1'])
  assert.ok(!merged.anchors.has(other.anchor), 'the leaver\'s anchors leave with it')
  assert.ok(left.pos > third.pos, 'the leaver re-enters at the next promotion-commit position')
  assert.equal(left.status, 'pending', 'the set is full: pending, not admitted')
  assert.equal(b.admission.admitted, 2n, 'no slot was released or taken')
})

// ── Visibility 0.30 §2: the identity of a split entry (review 3, M3) ──
test('probe — split, the leaver is an alias: the staying entry keeps its identity, the leaver takes its own', async () => {
  const b = I.createPerson('B')
  const [g1] = await gens()
  const other = await C.communityContext(IKM, 'uEiCCsq5ciVSsrhXjp4-OoQbQ4JStCJEvM82lS_CIh4SFPA')
  const merged = T.promotionCommit(b, 'r1', g1.anchor, 'k1', 0)
  assert.equal(T.promotionCommit(b, 'r2', g1.anchor, 'k2', 0), merged)
  assert.equal(merged.id, 'r1', 'the first relationship names the merged entry')
  const left = T.promotionCommit(b, 'r2', other.anchor, 'k2', 1, [other.anchor], 'new-community')
  assert.equal(merged.id, 'r1'); assert.equal(left.id, 'r2')
  assert.equal(b.admission.byRel.get(merged.id), merged, 'the staying entry resolves through its identity')
  assert.equal(b.admission.byRel.get('r2'), left, 'the leaver\'s lookups resolve to its new entry')
})

test('probe — split, the leaver bears the identity: the oldest remaining relationship (promotion order) names the staying entry, its keys are rewritten', async () => {
  const b = I.createPerson('B')
  const [g1] = await gens()
  const other = await C.communityContext(IKM, 'uEiCCsq5ciVSsrhXjp4-OoQbQ4JStCJEvM82lS_CIh4SFPA')
  // promotion order r1, r2, r3 — but r3 joins r1's entry before r2's entry merges in
  const merged = T.promotionCommit(b, 'r1', g1.anchor, 'k1', 0)
  const second = T.promotionCommit(b, 'r2', 'self-2', 'k2', 0)
  assert.notEqual(second, merged)
  assert.equal(T.promotionCommit(b, 'r3', g1.anchor, 'k3', 0), merged)
  assert.equal(T.promotionCommit(b, 'r2', g1.anchor, 'k2', 0), merged, 'r2 corrects onto the held head: merged')
  const pos = merged.pos
  assert.equal(merged.id, 'r1')
  // r1, the identity bearer, leaves
  const left = T.promotionCommit(b, 'r1', other.anchor, 'k1', 1, [other.anchor], 'new-community')
  assert.notEqual(left, merged)
  assert.equal(merged.id, 'r2', 'the oldest remaining relationship by promotion order, not by merge order')
  assert.equal(merged.pos, pos, 'position unchanged'); assert.equal(merged.status, 'admitted')
  assert.equal(left.id, 'r1', 'the leaver keeps its own relationship id')
  assert.equal(b.admission.byRel.get(merged.id), merged, 'the staying entry resolves through its new identity')
  assert.equal(b.admission.byRel.get('r3'), merged)
  assert.equal(b.admission.byRel.get('r1'), left, 'the old identity resolves to the leaver')
  assert.ok(!merged.held.has('r1') && merged.held.has('r2') && merged.held.has('r3'))
})

test('probe — departure of the identity bearer: the oldest remaining relationship names the entry', async () => {
  const b = I.createPerson('B')
  const [g1] = await gens()
  const merged = T.promotionCommit(b, 'r1', g1.anchor, 'k1', 0)
  assert.equal(T.promotionCommit(b, 'r2', g1.anchor, 'k2', 0), merged)
  T.departMember(b, 'r1', 1)
  assert.equal(merged.id, 'r2')
  assert.equal(b.admission.byRel.get(merged.id), merged)
  assert.equal(b.admission.byRel.get('r1'), undefined)
})

test('probe — a new community on an entry that is only this relationship stays in place (no split)', async () => {
  const b = I.createPerson('B')
  const [g1] = await gens()
  const other = await C.communityContext(IKM, 'uEiCCsq5ciVSsrhXjp4-OoQbQ4JStCJEvM82lS_CIh4SFPA')
  const e = T.promotionCommit(b, 'r1', g1.anchor, 'k1', 0)
  b.contacts.set('k1b', { relId: 'r1' })                    // a chain alias of the same relationship
  T.chainAdmission(b, 'r1', 'k1b', 'k1b', 1)
  const after = T.promotionCommit(b, 'r1', other.anchor, 'k1', 2, [other.anchor], 'new-community')
  assert.equal(after, e, 'a self correction of a single relationship keeps its entry')
  assert.equal(after.self, other.anchor)
})

// ── Visibility 0.30 §6a.1 no. 2: the head rule is entry-wide and holds in both processing directions (review 4, M1) ──
const entryCount = (p) => new Set(p.admission.byRel.values()).size
test('probe — review 4 attack: a relationship refused under a superseded anchor does not join through a later update of the honest relationship', async () => {
  const [gA, gB, gC] = await gens()
  const ab = await V.makeAnchorRotation(gA, gB)
  const bc = await V.makeAnchorRotation(gB, gC)
  const b = I.createPerson('B')
  // step 1: the honest relationship, self = B, lineage A → B
  const honest = T.promotionCommit(b, 'r-honest', gB.anchor, 'k-honest', 0, V.mappingAnchors({ self: gB.anchor, lineage: [ab] }))
  assert.equal(entryCount(b), 1)
  // step 2: the attacker's relationship, self = A (copied key), empty lineage: refused
  const attacker = T.promotionCommit(b, 'r-attacker', gA.anchor, 'k-attacker', 1, V.mappingAnchors({ self: gA.anchor, lineage: [] }))
  assert.notEqual(attacker, honest)
  assert.equal(entryCount(b), 2)
  // step 3: the honest relationship rotates on, self = C, lineage A → B → C — it carries A as a prev
  const after = T.promotionCommit(b, 'r-honest', gC.anchor, 'k-honest', 2, V.mappingAnchors({ self: gC.anchor, lineage: [ab, bc] }), 'rotation')
  assert.equal(after, honest, 'the honest relationship stays in place')
  assert.equal(honest.self, gC.anchor)
  assert.equal(entryCount(b), 2, 'A is superseded in the entry\'s knowledge: the attacker\'s relationship does not join')
  assert.ok(!honest.relIds.has('r-attacker'))
  assert.equal(b.admission.byRel.get('r-attacker'), attacker)
})

test('probe — review 4: two merged relationships hold different heads; a newly presented superseded head does not merge, the current head does', async () => {
  const [gA, gB] = await gens()
  const ab = await V.makeAnchorRotation(gA, gB)
  const b = I.createPerson('B')
  const merged = T.promotionCommit(b, 'r1', gA.anchor, 'k1', 0)
  assert.equal(T.promotionCommit(b, 'r2', gA.anchor, 'k2', 0), merged)
  // r2 rotates A → B; r1 still holds A as its own head
  assert.equal(T.promotionCommit(b, 'r2', gB.anchor, 'k2', 1, V.mappingAnchors({ self: gB.anchor, lineage: [ab] }), 'rotation'), merged)
  assert.equal(merged.self, gB.anchor, 'the entry\'s current head is B')
  assert.equal(merged.held.get('r1').head, gA.anchor, 'r1 holds A')
  // a new relationship presents A with an empty lineage: it equals r1's head, but A is superseded in the entry
  const third = T.promotionCommit(b, 'r3', gA.anchor, 'k3', 2, V.mappingAnchors({ self: gA.anchor, lineage: [] }))
  assert.notEqual(third, merged, 'no merge through the lagging relationship')
  assert.equal(entryCount(b), 2)
  // the same relationship presents the current head B itself: it joins
  assert.equal(T.promotionCommit(b, 'r3', gB.anchor, 'k3', 3, V.mappingAnchors({ self: gB.anchor, lineage: [ab] }), 'rotation'), merged, 'a current head merges')
  assert.equal(entryCount(b), 1)
  assert.equal(merged.self, gB.anchor)
})

test('probe — review 4: the other direction merges when the other relationship stands at or beyond the updated head', async () => {
  const [gA, gB, gC] = await gens()
  const ab = await V.makeAnchorRotation(gA, gB)
  const bc = await V.makeAnchorRotation(gB, gC)
  // r2 stands at C with only B → C carried; r1 holds A: nothing links them yet
  const b = I.createPerson('B')
  const e1 = T.promotionCommit(b, 'r1', gA.anchor, 'k1', 0)
  const e2 = T.promotionCommit(b, 'r2', gC.anchor, 'k2', 0, V.mappingAnchors({ self: gC.anchor, lineage: [bc] }))
  assert.notEqual(e2, e1)
  // r1 rotates A → B: r2's lineage extends B, its head C is not superseded in r1's entry
  const merged = T.promotionCommit(b, 'r1', gB.anchor, 'k1', 1, V.mappingAnchors({ self: gB.anchor, lineage: [ab] }), 'rotation')
  assert.equal(entryCount(b), 1, 'merged')
  assert.equal(merged.self, gC.anchor, 'the newest head is the entry\'s current head')
})

// ── Visibility 0.30 §2 and §6.3 condition 8: an unchanged head updates in place (review 4, M2) ──
test('probe — review 4: a higher revision with an unchanged self on a merged relationship is `same`: no split, position and admission unchanged', async () => {
  const [gA, gB] = await gens()
  const ab = await V.makeAnchorRotation(gA, gB)
  const b = I.createPerson('B')
  b.admissionBound = 1n                       // a wrong split would show as pending
  const merged = T.promotionCommit(b, 'r1', gA.anchor, 'k1', 0)
  assert.equal(T.promotionCommit(b, 'r2', gA.anchor, 'k2', 0), merged)
  assert.equal(T.promotionCommit(b, 'r2', gB.anchor, 'k2', 1, V.mappingAnchors({ self: gB.anchor, lineage: [ab] }), 'rotation'), merged)
  const pos = merged.pos
  // r1 receives a higher revision with unchanged self = A
  assert.equal(V.classifyMapping(gA.anchor, { self: gA.anchor, lineage: [] }), 'same')
  const again = T.promotionCommit(b, 'r1', gA.anchor, 'k1', 2, V.mappingAnchors({ self: gA.anchor, lineage: [] }), 'same')
  assert.equal(again, merged, 'in place')
  assert.equal(entryCount(b), 1, 'no split')
  assert.deepEqual([...merged.relIds].sort(), ['r1', 'r2'])
  assert.equal(merged.pos, pos); assert.equal(merged.status, 'admitted'); assert.equal(b.admission.admitted, 1n)
  assert.equal(merged.self, gB.anchor, 'the entry\'s current head stays B')
  assert.equal(merged.held.get('r1').head, gA.anchor, 'r1 still holds A')
})

// ── Visibility 0.30 §6a.1 no. 2/3, §6.3 condition 8: incomparable heads within one entry ──
const OTHER = 'uEiCCsq5ciVSsrhXjp4-OoQbQ4JStCJEvM82lS_CIh4SFPA'
// r1 and r2 merged under A; then r1 receives A → B and r2 receives A → X, in the given order
const forkedEntry = async (order) => {
  const [gA, gB] = await gens()
  const gX = await C.communityContext(IKM, OTHER)
  const ab = await V.makeAnchorRotation(gA, gB)
  const ax = await V.makeAnchorRotation(gA, gX)
  const b = I.createPerson('B')
  const merged = T.promotionCommit(b, 'r1', gA.anchor, 'k1', 0)
  assert.equal(T.promotionCommit(b, 'r2', gA.anchor, 'k2', 0), merged)
  const steps = {
    r1: () => T.promotionCommit(b, 'r1', gB.anchor, 'k1', 1, V.mappingAnchors({ self: gB.anchor, lineage: [ab] }), 'rotation'),
    r2: () => T.promotionCommit(b, 'r2', gX.anchor, 'k2', 1, V.mappingAnchors({ self: gX.anchor, lineage: [ax] }), 'rotation'),
  }
  for (const s of order) assert.equal(steps[s](), merged, 'a rotation on each relationship: the merge persists')
  return { b, merged, gA, gB, gX }
}
for (const order of [['r1', 'r2'], ['r2', 'r1']]) {
  test(`probe — review 5 M1: two successors of one anchor in one entry (${order.join(' then ')}): head-conflicted, no automatic merge in either direction`, async () => {
    const { b, merged, gB, gX } = await forkedEntry(order)
    assert.equal(merged.headConflict, true, 'the entry is head-conflicted')
    assert.deepEqual([...merged.relIds].sort(), ['r1', 'r2'], 'existing merges persist')
    assert.ok(merged.anchors.has(gB.anchor) && merged.anchors.has(gX.anchor))
    assert.equal(merged.self, gB.anchor, 'the view anchor does not depend on the arrival order')
    // a new relationship presenting B with an empty lineage is not admitted to the conflicted entry
    const r3 = T.promotionCommit(b, 'r3', gB.anchor, 'k3', 2, V.mappingAnchors({ self: gB.anchor, lineage: [] }))
    assert.notEqual(r3, merged)
    assert.equal(entryCount(b), 2)
  })
}
test('probe — review 5 M1: resolveHead names the governing head; a waiting B relationship joins under B, stays separate under X', async () => {
  for (const [pick, joined] of [['B', true], ['X', false]]) {
    const { b, merged, gA, gB, gX } = await forkedEntry(['r1', 'r2'])
    const r3 = T.promotionCommit(b, 'r3', gB.anchor, 'k3', 2, V.mappingAnchors({ self: gB.anchor, lineage: [] }))
    assert.notEqual(r3, merged)
    assert.throws(() => T.resolveHead(b, merged.id, gA.anchor, 3), /head/, 'only a competing successor can be named')
    const head = pick === 'B' ? gB.anchor : gX.anchor
    const out = T.resolveHead(b, 'r2', head, 3)
    assert.equal(merged.headConflict, false, 'the resolution clears the mark')
    assert.equal(merged.self, head, 'the named head governs')
    assert.ok(merged.anchors.has(gB.anchor) && merged.anchors.has(gX.anchor), 'the other successor stays held as superseded knowledge')
    if (joined) {
      assert.equal(out, merged); assert.ok(merged.relIds.has('r3'), 'r3 joins under B')
      assert.equal(entryCount(b), 1)
    } else {
      assert.ok(!merged.relIds.has('r3'), 'r3 stays separate under X')
      assert.equal(entryCount(b), 2)
      // X governs, B is superseded knowledge: a new B relationship does not join, an X one does
      assert.notEqual(T.promotionCommit(b, 'r4', gB.anchor, 'k4', 4, V.mappingAnchors({ self: gB.anchor, lineage: [] })), merged)
      assert.equal(T.promotionCommit(b, 'r5', gX.anchor, 'k5', 4, V.mappingAnchors({ self: gX.anchor, lineage: [] })), merged)
    }
    assert.throws(() => T.resolveHead(b, merged.id, head, 5), /conflict/, 'nothing left to resolve')
  }
})

// ── Visibility 0.30 §6a.1 no. 2: the incoming relationship is checked on every accepted mapping (review 5, M2) ──
test('probe — review 5 M2: a correction on a relationship with its own entry merges where its new head extends another entry', async () => {
  const [gA, gB] = await gens()
  const gX = await C.communityContext(IKM, OTHER)
  const ab = await V.makeAnchorRotation(gA, gB)
  const b = I.createPerson('B')
  const e1 = T.promotionCommit(b, 'r1', gA.anchor, 'k1', 0, V.mappingAnchors({ self: gA.anchor, lineage: [] }))
  const e2 = T.promotionCommit(b, 'r2', gX.anchor, 'k2', 0, V.mappingAnchors({ self: gX.anchor, lineage: [] }))
  assert.notEqual(e2, e1)
  // r2 corrects with a higher revision to B, carrying A → B: a new community on r2, in place (its entry holds only r2)
  assert.equal(V.classifyMapping(gX.anchor, { self: gB.anchor, lineage: [ab] }), 'new-community')
  const after = T.promotionCommit(b, 'r2', gB.anchor, 'k2', 1, V.mappingAnchors({ self: gB.anchor, lineage: [ab] }), 'new-community')
  assert.equal(entryCount(b), 1, 'the incoming r2 extends E1\'s head A: merged')
  assert.equal(after, e1, 'the earliest position survives')
  assert.equal(e1.self, gB.anchor)
})
test('probe — review 5 M2: an unchanged head with newly carried connecting lineage merges too', async () => {
  const [gA, gB] = await gens()
  const ab = await V.makeAnchorRotation(gA, gB)
  const b = I.createPerson('B')
  const e1 = T.promotionCommit(b, 'r1', gA.anchor, 'k1', 0, V.mappingAnchors({ self: gA.anchor, lineage: [] }))
  const e2 = T.promotionCommit(b, 'r2', gB.anchor, 'k2', 0, V.mappingAnchors({ self: gB.anchor, lineage: [] }))
  assert.notEqual(e2, e1, 'nothing links A and B yet')
  assert.equal(V.classifyMapping(gB.anchor, { self: gB.anchor, lineage: [ab] }), 'same')
  const after = T.promotionCommit(b, 'r2', gB.anchor, 'k2', 1, V.mappingAnchors({ self: gB.anchor, lineage: [ab] }), 'same')
  assert.equal(entryCount(b), 1, 'the carried A → B extends E1\'s head: merged')
  assert.equal(after, e1); assert.equal(e1.self, gB.anchor)
})
test('probe — review 5 M2: a lagging relationship of a merged entry is no evidence for a merge (its head is superseded in its own entry)', async () => {
  const [gA, gB] = await gens()
  const ab = await V.makeAnchorRotation(gA, gB)
  const b = I.createPerson('B')
  const merged = T.promotionCommit(b, 'r1', gA.anchor, 'k1', 0)
  assert.equal(T.promotionCommit(b, 'r2', gA.anchor, 'k2', 0), merged)
  T.promotionCommit(b, 'r2', gB.anchor, 'k2', 1, V.mappingAnchors({ self: gB.anchor, lineage: [ab] }), 'rotation')
  const copy = T.promotionCommit(b, 'r-copy', gA.anchor, 'k-copy', 2, V.mappingAnchors({ self: gA.anchor, lineage: [] }))
  assert.notEqual(copy, merged, 'A is superseded in the entry: refused')
  // r1, still holding A, receives a re-issue: it must not pull the refused relationship in
  T.promotionCommit(b, 'r1', gA.anchor, 'k1', 3, V.mappingAnchors({ self: gA.anchor, lineage: [] }), 'same')
  assert.equal(entryCount(b), 2)
  assert.ok(!merged.relIds.has('r-copy'))
})

// ── Visibility 0.30 §2: split and departure recompute the remaining head (review 5, M3) ──
const rotatedThenLeaves = async (leave) => {
  const [gA, gB] = await gens()
  const ab = await V.makeAnchorRotation(gA, gB)
  const b = I.createPerson('B')
  const merged = T.promotionCommit(b, 'r1', gA.anchor, 'k1', 0)
  assert.equal(T.promotionCommit(b, 'r2', gA.anchor, 'k2', 0), merged)
  T.promotionCommit(b, 'r2', gB.anchor, 'k2', 1, V.mappingAnchors({ self: gB.anchor, lineage: [ab] }), 'rotation')
  assert.equal(merged.self, gB.anchor)
  await leave(b)
  return { b, merged, gA, gB }
}
for (const [name, leave] of [
  ['split (r2 leaves to a new community X)', async (b) => {
    const gX = await C.communityContext(IKM, OTHER)
    T.promotionCommit(b, 'r2', gX.anchor, 'k2', 2, V.mappingAnchors({ self: gX.anchor, lineage: [] }), 'new-community')
  }],
  ['departure of r2', async (b) => { T.departMember(b, 'r2', 2) }],
]) {
  test(`probe — review 5 M3: after the ${name}, the remaining entry's head is what r1 holds`, async () => {
    const { b, merged, gA, gB } = await rotatedThenLeaves(leave)
    assert.deepEqual([...merged.relIds], ['r1'])
    assert.equal(merged.self, gA.anchor, 'the head is recomputed from the remaining relationship')
    assert.ok(!merged.anchors.has(gB.anchor), 'B left with r2: no orphaned anchor')
    const before = entryCount(b)
    assert.notEqual(T.promotionCommit(b, 'r3', gB.anchor, 'k3', 3, V.mappingAnchors({ self: gB.anchor, lineage: [] })), merged, 'B with an empty lineage does not join')
    assert.equal(entryCount(b), before + 1)
    assert.equal(T.promotionCommit(b, 'r4', gA.anchor, 'k4', 3, V.mappingAnchors({ self: gA.anchor, lineage: [] })), merged, 'A joins')
  })
}
