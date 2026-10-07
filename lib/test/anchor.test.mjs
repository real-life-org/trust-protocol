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

test('anchor-rotation@1 — signed by both generations, generation ≥ 2, schema-closed', async () => {
  const [g1, g2] = await gens()
  const r = await V.makeAnchorRotation(g1, g2, 2)
  assert.deepEqual(Object.keys(r.body).sort(), ['generation', 'next', 'prev', 'type'])
  assert.equal(r.body.type, 'anchor-rotation@1')
  assert.equal(r.body.prev, g1.anchor); assert.equal(r.body.next, g2.anchor); assert.equal(r.body.generation, '2')
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
  const g1r = await V.makeAnchorRotation(g1, g2, '1').catch(() => null)
  assert.equal(g1r, null, 'generation 1 is never produced')
  const forged = structuredClone(r); forged.body.generation = '1'
  assert.ok(schemaErrs(forged, 'visibility-anchor-rotation.schema.json').length > 0, 'generation 1 fails the schema')
  assert.equal(await V.verifyAnchorRotation(forged), false, 'generation 1 is rejected')
  const extra = structuredClone(r); extra.body.note = 'x'
  assert.equal(await V.verifyAnchorRotation(extra), false, 'closed body')
  const big = structuredClone(r); big.body.generation = '9007199254740992'
  assert.equal(await V.verifyAnchorRotation(big), false, 'beyond 2^53 − 1 is outside the domain')
})

test('lineage — consecutive from 2, each prev the preceding next, the last next = self', async () => {
  const [g1, g2, g3, g4] = await gens()
  const r2 = await V.makeAnchorRotation(g1, g2, 2), r3 = await V.makeAnchorRotation(g2, g3, 3)
  assert.deepEqual(await V.verifyLineage([], g1.anchor), { ok: true }, 'empty: the sender presents no history')
  assert.deepEqual(await V.verifyLineage([r2], g2.anchor), { ok: true })
  assert.deepEqual(await V.verifyLineage([r2, r3], g3.anchor), { ok: true })
  assert.equal((await V.verifyLineage([r2], g3.anchor)).ok, false, 'last next ≠ self')
  assert.equal((await V.verifyLineage([r3], g3.anchor)).ok, false, 'does not start at 2')
  const r3x = await V.makeAnchorRotation(g1, g3, 3)
  assert.equal((await V.verifyLineage([r2, r3x], g3.anchor)).ok, false, 'prev break')
  const r4 = await V.makeAnchorRotation(g2, g4, 4)
  assert.equal((await V.verifyLineage([r2, r4], g4.anchor)).ok, false, 'generation skip')
  const bad = structuredClone(r2); bad.proof.successorProofValue = r2.proof.proofValue
  assert.equal((await V.verifyLineage([bad], g2.anchor)).ok, false, 'every element verifies under both signatures')
  assert.deepEqual(V.lineageAnchors([r2, r3]), [g1.anchor, g2.anchor, g3.anchor])
})

// ── Visibility 0.30 §6.1/§6.3: anchor-mapping@3 ──────────────────────────
const pairs = async () => ({
  A: await C.pairContext(IKM, fill(32, 0xa0)),
  B: await C.pairContext(IKM, fill(32, 0xb0)),
})

test('anchor-mapping@3 — lineage in the body, proof unchanged, 6.3 in order with 4a', async () => {
  const { A, B } = await pairs()
  const [g1, g2] = await gens()
  const r2 = await V.makeAnchorRotation(g1, g2, 2)
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
  const r2 = await V.makeAnchorRotation(g1, g2, 2), r3 = await V.makeAnchorRotation(g2, g3, 3)
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
  const gs = await Promise.all([1, 2, 3].map((g) => C.communityContext(IKM, RT.community.genesisDigest, g)))
  for (const v of RT.valid) {
    const g = Number(v.artifact.body.generation)
    assert.equal(C.jcs(await V.makeAnchorRotation(gs[g - 2], gs[g - 1], g)), C.jcs(v.artifact), v.name)
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
      resolve: (oid) => (g === 'G1' && oid === gen.id ? { subject: gen.body.members[0], keyAgreement: gen.body.card.keyAgreement } : null),
    }))
    const asm = await V.assembleGroupStar({ own: P[c.recipient], from: P[c.from].anchor, fromKeyAgreement: P[c.from].keyAgreement, chunks: GS.stars[c.star] })
    assert.equal(asm.ok, true)
    const got = await V.openGroupStar({ own: P[c.recipient], from: P[c.from].anchor, fromKeyAgreement: P[c.from].keyAgreement, salt: asm.salt, entries: asm.entries, memberships })
    assert.deepEqual(got, c.result, c.name)
  }
  assert.ok(IKM2.length === 64)
})

test('probe — a changed self without a reachable lineage is a new community: the merge keyed by the earlier anchor dissolves', async () => {
  const b = I.createPerson('B')
  const [g1, g2] = await gens()
  const r2 = await V.makeAnchorRotation(g1, g2, 2)
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
