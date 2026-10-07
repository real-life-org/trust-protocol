#!/usr/bin/env node
// Generates the vectors of the anchor casting — Identity 0.52 §5.4/§6.1,
// Network Visibility 0.30 §5.2b/§6.1/§6.5, Access 0.56 §5.6 — FROM THE
// LIBRARY (lib/dist), so library and vectors cannot drift apart; the
// conformance runner re-derives every claim with node:crypto alone.
//
//   vectors/identity-derivation.json  + group/<D>/2, /3 and four rejects
//   vectors/visibility.json           anchor-mapping@3 (empty lineage),
//                                     the rotation case (one lineage
//                                     element, mapping under generation 2),
//                                     a lineage of 64 elements; negatives
//                                     @2-legacy, foreign self, lineage not
//                                     ending at self, 65 elements
//   vectors/anchor-rotation.json      valid (1→2, 2→3, 2→ a new personal
//                                     community); wrong successor
//                                     signature; a generation field;
//                                     prev = next
//   vectors/group-star.json           a sender in two groups, recipients
//                                     current members of one: hit + open
//                                     (trusted), hit with filler
//                                     (untrusted), miss, all-filler star
//   vectors/access-anchor-rotate.json real envelopes of a personal
//                                     community's log: a chain, a first
//                                     entry with any prev, a derivation
//                                     skip, a new personal community,
//                                     prev break, not sole member, repeat,
//                                     same prev with differing bodies, a
//                                     delayed merge with a successor on
//                                     the losing branch, a successor after
//                                     the merge, a rotation that does not
//                                     verify
//
// Deterministic: keys derive from the oracle IKM of
// vectors/identity-derivation.json (and its second-party IKM, as in
// scripts/gen-membership-tasks-vector.mjs); the entropy the group star
// takes from its caller (AEAD nonces, filler) is an HKDF counter stream
// under a vector-only info string, stated in the file.
//
//   usage: (cd lib && npm run build) && node scripts/gen-anchor-vectors.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import * as L from '../lib/dist/index.js'
import { SCHEMAS } from '../lib/dist/schemas.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const J = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))
const W = (p, o) => writeFileSync(join(ROOT, p), JSON.stringify(o, null, 1) + '\n')
const V = L.visibility
const te = new TextEncoder()
const hexOf = (u8) => Buffer.from(u8).toString('hex')
const b64u = (u8) => Buffer.from(u8).toString('base64url')
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest()
const VAL = L.makeValidator(SCHEMAS)
const mustValidate = (data, file, what) => { const errs = VAL.validate(data, SCHEMAS[file], SCHEMAS[file]); if (errs.length) throw new Error(`${what}: ${file}: ${errs[0]}`) }
const mustFail = (data, file, what) => { if (!VAL.validate(data, SCHEMAS[file], SCHEMAS[file]).length) throw new Error(`${what}: ${file} accepts it`) }
const assert = (c, m) => { if (!c) throw new Error('generator self-check: ' + m) }

const ID = J('vectors/identity-derivation.json')
const IKM = Uint8Array.from(Buffer.from(ID.rootIkm, 'hex'))
const IKM2 = new Uint8Array(crypto.hkdfSync('sha256', IKM, Buffer.alloc(0), Buffer.from('rltp/vector/second-party-root-ikm', 'utf8'), 64))
const IKM3 = new Uint8Array(crypto.hkdfSync('sha256', IKM, Buffer.alloc(0), Buffer.from('rltp/vector/third-party-root-ikm', 'utf8'), 64))
const D = ID.genesisDigestSample
const nonce = (byte) => new Uint8Array(32).fill(byte)
const pub = (ctx) => ({ label: ctx.label, anchor: ctx.anchor, keyAgreement: ctx.keyAgreement })
const ENTROPY = 'rltp/vector/group-star/entropy'
const entropy = (tag) => { let i = 0; return (n) => new Uint8Array(crypto.hkdfSync('sha256', IKM, Buffer.alloc(0), Buffer.from(`${ENTROPY}/${tag}/${i++}`, 'utf8'), n)) }
const digestOfAscii = (s) => L.digestBytes(te.encode(s))
const oidOfAscii = (s) => 'oid:' + b64u(sha(Buffer.from(s, 'utf8')))

// an Access envelope (rltp-access/0.25): id over JCS with id empty and
// proof omitted (RLTP-ACC-3100), every signature over the same bytes,
// sorted by signer
const envelope = async (unsigned, signers) => {
  const input = { ...unsigned, id: '' }
  const signatures = []
  for (const s of signers) signatures.push({ signer: s.anchor, sig: await V.signRaw(s, input) })
  signatures.sort((a, b) => (a.signer < b.signer ? -1 : a.signer > b.signer ? 1 : 0))
  const bytes = te.encode(L.jcs(input))
  return { bytes, op: { ...unsigned, id: 'oid:' + b64u(sha(bytes)), proof: { mechanism: 'signature-set', signatures } } }
}
// a group genesis under a fresh founding pair context (Access 3.4.1,
// RLTP-ACC-3235, 3275) — its digest is the multihash over the signature
// input (RLTP-ACC-3030); serviceIdentity and keyOpDigest are stand-ins
// the Access vectors own, as in vectors/membership-tasks.json
const genesisOf = async (tag, founder, created) => {
  const groupKp = await L.edFromSeed(new Uint8Array(crypto.hkdfSync('sha256', IKM2, Buffer.alloc(0), Buffer.from(`rltp/vector/${tag}/group-did`, 'utf8'), 32)))
  const group = { anchor: L.anchorOfEd(groupKp.pubRaw), ed: groupKp }
  const card = await L.diSign(founder, { version: 'rltp-card/0.25', anchor: founder.anchor, keyAgreement: founder.keyAgreement }, created)
  const { bytes, op } = await envelope({
    v: 'rltp-access/0.25', op: 'group.genesis', group: group.anchor, epoch: 0, policyVersion: 1, prev: [],
    body: {
      members: [founder.anchor], card, policy: { policyVersion: 1, rules: {} }, visibility: 'private', adapter: 'linear/0.1',
      contentKeyCommitment: await digestOfAscii(`rltp/vector/${tag}/content-key-stand-in`),
      keyOpDigest: await digestOfAscii(`rltp/vector/${tag}/key-op-stand-in`),
      serviceIdentity: L.anchorOfEd((await L.edFromSeed(new Uint8Array(crypto.hkdfSync('sha256', IKM2, Buffer.alloc(0), Buffer.from(`rltp/vector/${tag}/service-identity-stand-in`, 'utf8'), 32)))).pubRaw),
    },
    id: '', author: founder.anchor,
  }, [group, founder])
  mustValidate(op, 'access-operation-envelope.schema.json', `${tag} genesis`)
  return { genesis: op, digest: await L.digestBytes(bytes), group }
}

// ── 1. identity-derivation.json: the generation row (Identity §6.1, §16) ──
{
  const isGen = (l) => typeof l === 'string' && /^group\/[^/]*\/.*$/.test(l)
  const rows = []
  for (const g of [2, 3]) {
    const label = `group/${D}/${g}`
    const ctx = await L.labeledContext(IKM, label)
    assert(ctx.anchor === (await L.communityContext(IKM, D, g)).anchor, 'communityContext = the label')
    rows.push({ label, note: `the community anchor at generation ${g} (Identity 5.4): the label string is the whole derivation context — rltp/anchor/ed/ || label, rltp/anchor/x/ || label`,
      edSeed: hexOf(await L.hkdf(IKM, 'rltp/anchor/ed/' + label)), xSeed: hexOf(await L.hkdf(IKM, 'rltp/anchor/x/' + label)), anchor: ctx.anchor, keyAgreement: ctx.keyAgreement })
  }
  const vectors = ID.vectors.filter((v) => !isGen(v.label))
  const at = vectors.findIndex((v) => v.label === `group/${D}`)
  assert(at >= 0, 'the group/<D> row exists')
  vectors.splice(at + 1, 0, ...rows)
  const rejects = ID.rejects.filter((r) => !isGen(r.label))
  for (const [g, reason] of [['1', 'generation 1 is group/<digest> itself, never a /1 label (Identity 6.1)'], ['01', 'leading zero in the generation'], ['0', 'generation below the domain [2, 2^53 − 1]'], ['9007199254740992', 'generation 2^53, above the domain [2, 2^53 − 1]']]) {
    const label = `group/${D}/${g}`
    assert(L.canonicalLabel(label) === null, `the library rejects ${label}`)
    rejects.push({ label, reason })
  }
  W('vectors/identity-derivation.json', { ...ID, vectors, rejects })
}

// ── 2. anchor-rotation.json (Visibility §6.5) ───────────────────────────
const gens = []
for (const g of [1, 2, 3]) gens.push(await L.communityContext(IKM, D, g))
const [g1, g2, g3] = gens
const rot12 = await V.makeAnchorRotation(g1, g2)
const rot23 = await V.makeAnchorRotation(g2, g3)
{
  // after a lost register: generation 1 of a NEW personal community (Identity 9.3)
  const Dnew = await digestOfAscii('rltp/vectors/anchor-rotation/new-personal-community')
  const n1 = await L.communityContext(IKM, Dnew, 1)
  const rot2n = await V.makeAnchorRotation(g2, n1)
  assert(await V.verifyAnchorRotation(rot12) && await V.verifyAnchorRotation(rot23) && await V.verifyAnchorRotation(rot2n), 'valid rotations verify')
  const wrongSucc = { body: rot12.body, proof: { proofValue: rot12.proof.proofValue, successorProofValue: await V.signRaw(g3, rot12.body) } }
  assert(!(await V.verifyAnchorRotation(wrongSucc)), 'wrong successor signature fails')
  const bG = { ...rot12.body, generation: '2' }
  const withGen = { body: bG, proof: { proofValue: await V.signRaw(g1, bG), successorProofValue: await V.signRaw(g2, bG) } }
  mustFail(withGen, 'visibility-anchor-rotation.schema.json', 'a generation field')
  assert(!(await V.verifyAnchorRotation(withGen)), 'a generation field fails')
  const bS = { type: 'anchor-rotation@1', prev: g1.anchor, next: g1.anchor }
  const still = { body: bS, proof: { proofValue: await V.signRaw(g1, bS), successorProofValue: await V.signRaw(g1, bS) } }
  mustValidate(still, 'visibility-anchor-rotation.schema.json', 'prev = next (schema shape)')
  assert(!(await V.verifyAnchorRotation(still)), 'prev = next fails')
  W('vectors/anchor-rotation.json', {
    source: 'anchor-rotation@1 per Network Visibility 0.30 §6.5 over the community anchor of Identity 0.52 §5.4: the generations are group/<D>, group/<D>/2, group/<D>/3 under the oracle IKM of vectors/identity-derivation.json, <D> its genesisDigestSample — the community of vectors/visibility.json; the new personal community is group/<D\'> of the same IKM, <D\'> the multihash of the ASCII preimage named in newCommunity. Generated by scripts/gen-anchor-vectors.mjs from the library; re-derived by conformance/runner.mjs.',
    format: {
      artifact: '{ body: { type, prev, next }, proof: { proofValue, successorProofValue } }: proofValue is raw Ed25519 under prev, successorProofValue raw Ed25519 under next, both over the JCS bytes of body, z-base58btc (Visibility 2.1); next differs from prev; no generation number — the chain order is prev/next alone',
      valid: 'prevLabel and nextLabel name the two contexts (Identity 6.1) whose anchors the artifact links',
      negatives: 'each MUST be rejected at the named check (expect); the schema check comes first',
    },
    community: { genesisDigest: D, generations: { 1: pub(g1), 2: pub(g2), 3: pub(g3) } },
    newCommunity: { genesisDigest: Dnew, preimage: 'rltp/vectors/anchor-rotation/new-personal-community', generation1: pub(n1), note: 'the holder lost its register, re-derived generation 2 of <D> from the digest its contacts re-supplied, founded a new personal community, and rotates onto its anchor with a proof signed by the old generation (Identity 9.3)' },
    valid: [
      { name: 'generation-1-to-2', prevLabel: g1.label, nextLabel: g2.label, artifact: rot12 },
      { name: 'generation-2-to-3', prevLabel: g2.label, nextLabel: g3.label, artifact: rot23 },
      { name: 'onto-a-new-personal-community', prevLabel: g2.label, nextLabel: n1.label, artifact: rot2n },
    ],
    negative: [
      { name: 'successor-signature-wrong', checkOrder: 'schema PASS, proofValue under prev PASS, successorProofValue under next FAILS (it is a signature under generation 3)', expect: 'reject: successorProofValue does not verify under next', artifact: wrongSucc },
      { name: 'generation-field', checkOrder: 'schema FAILS (the body is closed: type, prev, next); both signatures are genuine', expect: 'reject: a generation field is not part of anchor-rotation@1', artifact: withGen },
      { name: 'prev-equals-next', checkOrder: 'schema PASS, next ≠ prev FAILS; both signatures are genuine', expect: 'reject: a rotation moves to a different key', artifact: still },
    ],
  })
}

// ── 3. visibility.json: anchor-mapping@3 and the rotation case ─────────
{
  const VIS = J('vectors/visibility.json')
  const P = {}
  for (const [k, v] of Object.entries(VIS.parties)) P[k] = await L.pairContext(IKM, Uint8Array.from(Buffer.from(v.relationshipNonce, 'hex')))
  assert(VIS.self.label === g1.label && VIS.self.anchor === g1.anchor, 'self is generation 1 of <D>')
  const issuedAt = '2026-08-23T12:00:00Z'
  const mapping = await V.buildAnchorMapping({ pair: P.A, to: P.B.anchor, toKeyAgreement: P.B.keyAgreement, self: g1, lineage: [], revision: '1', issuedAt })
  assert(L.jcs(mapping.body.card) === L.jcs(VIS.artifacts.selfCard), 'the enclosed card is the shipped self-card')
  const at = { own: P.B, pair: P.A.anchor, pairKeyAgreement: P.A.keyAgreement }
  assert((await V.verifyAnchorMapping(mapping, at)).ok, 'mapping@3 verifies')
  const rotated = await V.buildAnchorMapping({ pair: P.A, to: P.B.anchor, toKeyAgreement: P.B.keyAgreement, self: g2, lineage: [rot12], revision: '2', issuedAt: '2026-10-07T12:00:00Z' })
  assert((await V.verifyAnchorMapping(rotated, at)).ok, 'rotated mapping verifies')
  assert(V.classifyMapping(g1.anchor, rotated.body) === 'rotation', 'classified as rotation')
  // the former anchor-mapping@2 — rebuilt byte-exactly from the same inputs; now a legacy negative (2.1)
  const card = mapping.body.card
  const body2 = { type: 'anchor-mapping@2', pair: P.A.anchor, self: g1.anchor, to: P.B.anchor, card, revision: '1', issuedAt }
  const k1 = await L.hkdf(await L.ecdh(P.A.x.priv, P.B.x.pubRaw), 'rltp/visibility/mac/map1')
  const k2 = await L.hkdf(await L.ecdh(g1.x.priv, P.B.x.pubRaw), 'rltp/visibility/mac/map2')
  const legacy2 = { body: body2, proof: { mac1: await V.macU(k1, L.jcs(body2)), mac2: await V.macU(k2, L.jcs(body2)) } }
  if (VIS.artifacts.anchorMapping.body.type === 'anchor-mapping@2') assert(L.jcs(legacy2) === L.jcs(VIS.artifacts.anchorMapping), 'the rebuilt @2 is the formerly shipped artifact')
  mustFail(legacy2, 'visibility-anchor-mapping.schema.json', 'anchor-mapping@2')
  // foreign self: self = B's anchor, the card stays the sender's own — MACs over the mutated body
  const fBody = { ...mapping.body, self: P.B.anchor }
  const foreign = { body: fBody, proof: { mac1: await V.macU(k1, L.jcs(fBody)), mac2: await V.macU(k2, L.jcs(fBody)) } }
  assert((await V.verifyAnchorMapping(foreign, at)).step === '5', 'foreign self fails at step 5')
  // lineage not ending at self: the generation-1 card and self, a lineage ending at generation 2
  const lBody = { ...mapping.body, lineage: [rot12] }
  const lineageEnd = { body: lBody, proof: { mac1: await V.macU(k1, L.jcs(lBody)), mac2: await V.macU(k2, L.jcs(lBody)) } }
  assert((await V.verifyAnchorMapping(lineageEnd, at)).step === '4a', 'lineage not ending at self fails at 4a')
  // the bound (6.1): 64 elements are accepted, 65 fail the schema
  const long = []
  for (let g = 1; g <= 66; g++) long.push(await L.communityContext(IKM, D, g))
  const chain = []
  for (let i = 0; i < 65; i++) chain.push(await V.makeAnchorRotation(long[i], long[i + 1]))
  const m64 = await V.buildAnchorMapping({ pair: P.A, to: P.B.anchor, toKeyAgreement: P.B.keyAgreement, self: long[65], lineage: chain.slice(1), revision: '3', issuedAt: '2026-10-07T12:00:00Z' })
  assert((await V.verifyAnchorMapping(m64, at)).ok, 'a 64-element lineage verifies')
  const m65 = await V.buildAnchorMapping({ pair: P.A, to: P.B.anchor, toKeyAgreement: P.B.keyAgreement, self: long[65], lineage: chain, revision: '3', issuedAt: '2026-10-07T12:00:00Z' })
  mustFail(m65, 'visibility-anchor-mapping.schema.json', 'a 65-element lineage')
  assert((await V.verifyAnchorMapping(m65, at)).step === '1', 'a 65-element lineage fails at step 1')
  assert(V.classifyMapping(g2.anchor, m64.body) === 'rotation' && V.classifyMapping(g1.anchor, m64.body) === 'new-community', 'condition 8 over the carried segment')
  const negative = VIS.negative.filter((n) => !['mapping-foreign-self', 'legacy-version-2', 'mapping-lineage-not-ending-at-self', 'mapping-lineage-65'].includes(n.name))
  negative.unshift(
    { name: 'mapping-foreign-self', fixture: 'addressee B holds tuple (A,B) active; arrival on that tuple', checkOrder: '6.3 steps 1-8 in order; steps 1-4a PASS (MACs are over the mutated body), step 5 FAILS', expect: 'reject: card.anchor != body.self', artifact: foreign },
    { name: 'mapping-lineage-not-ending-at-self', fixture: 'addressee B holds tuple (A,B) active; arrival on that tuple', checkOrder: '6.3 steps 1-4 PASS, step 4a FAILS: the lineage element verifies under both signatures, but its next is generation 2 while self is generation 1 (MACs are over the mutated body)', expect: 'reject: the last next of lineage != self', artifact: lineageEnd },
    { name: 'mapping-lineage-65', fixture: 'addressee B holds tuple (A,B) active; arrival on that tuple', checkOrder: '6.3 step 1 FAILS: the lineage carries 65 elements, the schema admits at most 64; every element verifies and the chain ends at self (generation 66)', expect: 'reject: more than 64 lineage elements', artifact: m65 },
  )
  const li = negative.findIndex((n) => n.name === 'legacy-version')
  negative.splice(li + 1, 0, { name: 'legacy-version-2', fixture: 'none needed', checkOrder: '2.1 type check, before any crypto', expect: 'reject: anchor-mapping@2 not implemented (Visibility 0.30 2.1)', artifact: legacy2 })
  W('vectors/visibility.json', {
    ...VIS,
    self: { label: g1.label, anchor: g1.anchor, keyAgreement: g1.keyAgreement, note: 'the community anchor at generation 1: the group-context derivation over the personal community’s genesis digest (Identity 0.52 §2, §5.4; the S-DID cut of 0.13); the vector key name „self“ mirrors the frozen wire field spelling' },
    selfGenerations: { 2: { ...pub(g2), note: 'generation 2 of the same community anchor: group/<digest>/2 (Identity 0.52 §5.4)' } },
    artifacts: { ...VIS.artifacts, anchorMapping: mapping, anchorRotation: rot12, anchorMappingRotated: rotated, anchorMappingLineage64: m64 },
    rotation: { note: 'anchorMappingRotated: the sender A rotated its community anchor from generation 1 to 2 (anchorRotation) and re-issued the mapping on tuple (A,B) under a higher revision with lineage [anchorRotation]; B, holding anchorMapping (self = generation 1), classifies it as a ROTATION (6.3 condition 8): the previously held self is the prev of a lineage element', heldSelf: g1.anchor, classification: 'rotation' },
    lineageBound: { note: 'anchorMappingLineage64: A at generation 66 of <D> (group/<D>/66) carries the 64 most recent rotations, 2→3 … 65→66, in chain order (6.1, 6.3 condition 4a); it verifies. A contact holding generation 2 finds it in the carried segment — a ROTATION; one holding generation 1 missed more than 64 rotations — a NEW COMMUNITY (6.3 condition 8, 6.5). The 65-element mapping is the negative mapping-lineage-65', self: long[65].label, classifications: { [g2.anchor]: 'rotation', [g1.anchor]: 'new-community' } },
    negative,
  })
}

// ── 4. group-star.json (Visibility §5.2b) ───────────────────────────────
{
  const parties = { S_T: 0x5a, T_S: 0x6a, S_U: 0x5b, U_S: 0x7b, SG1: 0x61 }
  const P = {}
  for (const [k, b] of Object.entries(parties)) P[k] = await L.pairContext(IKM, nonce(b))
  const { genesis, digest: G1 } = await genesisOf('group-star/G1', P.SG1, '2026-10-01T09:00:00Z')
  const G2 = await digestOfAscii('rltp/vectors/group-star/genesis/G2')
  const G3 = await digestOfAscii('rltp/vectors/group-star/genesis/G3')
  const SG2 = await L.labeledContext(IKM, 'group/' + G2)          // a joiner's member anchor in G2 (Access 5.1)
  const opG2 = oidOfAscii('rltp/vectors/group-star/admission/G2')
  // the recipients' own member anchors in G1: joiners under their own seeds (Access 5.1)
  const TG1 = await L.labeledContext(IKM2, 'group/' + G1)
  const UG1 = await L.labeledContext(IKM3, 'group/' + G1)
  const listed = (sealed) => [
    { group: G1, sealed, member: P.SG1, memberOp: genesis.id },
    { group: G2, sealed, member: SG2, memberOp: opG2 },
  ]
  const trusted = await V.buildGroupStar({ own: P.S_T, to: P.T_S.anchor, toKeyAgreement: P.T_S.keyAgreement, salt: '1', groups: listed(true), rand: entropy('trusted') })
  const untrusted = await V.buildGroupStar({ own: P.S_U, to: P.U_S.anchor, toKeyAgreement: P.U_S.keyAgreement, salt: '1', groups: listed(false), rand: entropy('untrusted') })
  const allFiller = await V.buildGroupStar({ own: P.S_T, to: P.T_S.anchor, toKeyAgreement: P.T_S.keyAgreement, salt: '2', groups: [], rand: entropy('all-filler') })
  for (const s of [trusted, untrusted, allFiller]) for (const c of s.chunks) mustValidate(c, 'visibility-group-star.schema.json', 'group star')
  const member = (members) => ({ group: G1, isMember: (a) => members.includes(a), resolve: (oid) => oid === genesis.id ? { subject: genesis.body.members[0], keyAgreement: genesis.body.card.keyAgreement } : null })
  const stateG1 = { members: [P.SG1.anchor, TG1.anchor, UG1.anchor] }
  const run = async (star, own, from, memberships) => {
    const asm = await V.assembleGroupStar({ own, from: from.anchor, fromKeyAgreement: from.keyAgreement, chunks: star.chunks })
    assert(asm.ok, 'assembles')
    return V.openGroupStar({ own, from: from.anchor, fromKeyAgreement: from.keyAgreement, salt: asm.salt, entries: asm.entries, memberships })
  }
  const missG3 = { group: G3, isMember: () => true, resolve: () => null }
  const cases = [
    { name: 'hit-open-trusted', star: 'trusted', recipient: 'T_S', from: 'S_T', memberships: ['G1'], state: 'stateG1', result: await run(trusted, P.T_S, P.S_T, [member(stateG1.members)]) },
    { name: 'hit-filler-untrusted', star: 'untrusted', recipient: 'U_S', from: 'S_U', memberships: ['G1'], state: 'stateG1', result: await run(untrusted, P.U_S, P.S_U, [member(stateG1.members)]) },
    { name: 'miss', star: 'trusted', recipient: 'T_S', from: 'S_T', memberships: ['G3'], state: null, result: await run(trusted, P.T_S, P.S_T, [missG3]) },
    { name: 'all-filler', star: 'allFiller', recipient: 'T_S', from: 'S_T', memberships: ['G1'], state: 'stateG1', result: await run(allFiller, P.T_S, P.S_T, [member(stateG1.members)]) },
    { name: 'pair-member-not-current', star: 'trusted', recipient: 'T_S', from: 'S_T', memberships: ['G1'], state: 'stateG1WithoutSender', result: await run(trusted, P.T_S, P.S_T, [member([TG1.anchor, UG1.anchor])]) },
  ]
  assert(cases[0].result[0].accepted && cases[0].result[0].member === P.SG1.anchor, 'trusted: accepted')
  assert(cases[1].result[0].hit && !cases[1].result[0].opened, 'untrusted: hit, filler')
  assert(!cases[2].result[0].hit && !cases[3].result[0].hit, 'miss, all-filler')
  assert(cases[4].result[0].opened && !cases[4].result[0].accepted && cases[4].result[0].reason === 'member', 'not current: rejected at the member check')
  // reception negatives (5.2b): a completed assembly of no positive multiple
  // of 16 entries, or with c of differing length — each a single chunk with a
  // genuine MAC under k_g of salt 3; the entries are those of a genuine star
  const base = await V.buildGroupStar({ own: P.S_T, to: P.T_S.anchor, toKeyAgreement: P.T_S.keyAgreement, salt: '3', groups: listed(true), rand: entropy('assembly-base') })
  const kg3 = await V.groupStarKey(P.S_T, P.T_S.keyAgreement, P.S_T.anchor, P.T_S.anchor, '3')
  const extra = entropy('assembly-negatives')
  const one = async (groups) => { const body = { type: 'group-star@1', salt: '3', seq: '1', last: true, groups }; return [{ body, proof: { mac: await V.macU(kg3, L.jcs(body)) } }] }
  const baseEntries = base.chunks[0].body.groups
  const cLen = baseEntries[0].c.length
  const cBytes = Buffer.from(baseEntries[0].c.slice(1), 'base64url').length
  const plus = [...baseEntries, { d: 'u' + b64u(extra(32)), c: 'u' + b64u(extra(cBytes)) }].sort((x, y) => (x.d < y.d ? -1 : 1))
  assert(plus[0].c.length === cLen && plus.every((e) => e.c.length === cLen), 'the 17th entry has the common c length')
  const mixed = baseEntries.map((e, k) => (k === 3 ? { d: e.d, c: 'u' + b64u(extra(cBytes + 3)) } : e))
  const assemblyNegatives = [
    { name: 'one-entry', entries: 1, expect: 'reject: the assembly is no positive multiple of 16', chunks: await one(baseEntries.slice(0, 1)) },
    { name: 'fifteen-entries', entries: 15, expect: 'reject: the assembly is no positive multiple of 16', chunks: await one(baseEntries.slice(0, 15)) },
    { name: 'seventeen-entries', entries: 17, expect: 'reject: the assembly is no positive multiple of 16', chunks: await one(plus) },
    { name: 'c-length-differs', entries: 16, expect: 'reject: every c of one assembly has the same length', chunks: await one(mixed) },
  ]
  for (const n of assemblyNegatives) {
    for (const c of n.chunks) mustValidate(c, 'visibility-group-star.schema.json', n.name)
    const got = await V.assembleGroupStar({ own: P.T_S, from: P.S_T.anchor, fromKeyAgreement: P.S_T.keyAgreement, chunks: n.chunks })
    assert(!got.ok && got.reason === (n.name === 'c-length-differs' ? 'c length' : 'size'), `${n.name}: rejected`)
  }
  assert((await V.assembleGroupStar({ own: P.T_S, from: P.S_T.anchor, fromKeyAgreement: P.S_T.keyAgreement, chunks: base.chunks })).ok, 'the base star assembles')
  W('vectors/group-star.json', {
    source: 'group-star@1 per Network Visibility 0.30 §5.2b, carried by the task group-star/0.1 (Delivery 0.80): a sender S in two groups (G1, which S founded under its founding pair context SG1 — memberOp is the genesis; G2, which S joined — its member anchor is group/<G2>, memberOp a placeholder admission oid) toward a trusted recipient T and an untrusted recipient U, both current members of G1 only. Keys derive from the oracle IKM of vectors/identity-derivation.json (pair contexts from the listed relationship nonces), T’s member anchor and the G1 group DID from its second-party IKM, U’s member anchor from a third-party IKM (HKDF(oracle IKM, \"rltp/vector/third-party-root-ikm\"), 64 bytes). Generated by scripts/gen-anchor-vectors.mjs from the library; re-derived by conformance/runner.mjs.',
    format: {
      keys: 'k_g = HKDF(X25519(pairX_sender, pairX_recipient), "rltp/visibility/blind/group-star/" || senderPair || "/" || recipientPair || "/" || salt); k_e(G) = HKDF(same ikm, "rltp/visibility/seal/group-star/" || senderPair || "/" || recipientPair || "/" || salt || "/" || G); salt in its wire string form, G the 47-character u form of the genesis digest',
      entry: 'd = HMAC(k_g, UTF-8 of G) in the mac encoding; c = u + base64url(nonce(12) || AES-256-GCM ciphertext || tag(16)) under k_e(G), AAD = the bytes of the d string, plaintext the JCS bytes of a group-pair@1 — or filler: random bytes of exactly the length of a real c of this star (every field of a group pair but salt has a fixed length); padding entries carry a random 32-byte d',
      pair: 'group-pair@1 = { type, group, member, memberOp, to, salt, proof }, proof = HMAC(HKDF(ECDH(memberX_sender, pairX_recipient), "rltp/visibility/mac/group-pair"), JCS(pair without proof)); memberX_sender is the key-agreement key of the card in the operation memberOp names (here the genesis card)',
      star: 'entries padded to the next positive multiple of 16 (none listed: 16 filler), sorted by d once, sliced into chunks of at most 64; proof.mac = HMAC(k_g, JCS(body))',
      cases: 'the recipient assembles the star of `star` from `from`, tests each group of `memberships` (groups it is a current member of, with the materialized state `state`) and expects `result` per group: hit (d in the union), opened (c opens under k_e(G)), accepted (the reception checks of 5.2b in order: schema, group, to/salt, memberOp names the genesis whose members[0] is member and member is current, MAC), reason (the failing check)',
      entropy: `AEAD nonces and filler bytes: HKDF-SHA-256(oracle IKM, salt empty, info "${ENTROPY}/<star>/<counter>"), in draw order — a stand-in for the CSPRNG; any entropy reproduces every check except the byte identity of the filler`,
    },
    parties: Object.fromEntries(Object.entries(parties).map(([k, b]) => [k, { relationshipNonce: hexOf(nonce(b)), ...pub(P[k]) }])),
    roles: {
      S_T: 'the sender toward T (tuple S_T ↔ T_S)', T_S: 'the trusted recipient: S issued it a current anchor mapping',
      S_U: 'the sender toward U (tuple S_U ↔ U_S)', U_S: 'the untrusted recipient: no mapping, no switch for it',
      SG1: 'the sender’s founding pair context of G1 = its member anchor there (Access 3.4.1, RLTP-ACC-3235, 3275)',
    },
    groups: {
      G1: { genesisDigest: G1, genesis, note: 'a real group.genesis founded by SG1; genesisDigest = multihash over its signature input (RLTP-ACC-3030); serviceIdentity, keyOpDigest and contentKeyCommitment are stand-ins' },
      G2: { genesisDigest: G2, preimage: 'rltp/vectors/group-star/genesis/G2', member: pub(SG2), memberOp: opG2, memberOpPreimage: 'rltp/vectors/group-star/admission/G2', note: 'documented samples: neither recipient is a member of G2, nobody resolves its admission' },
      G3: { genesisDigest: G3, preimage: 'rltp/vectors/group-star/genesis/G3', note: 'a group the recipient is in and the sender is not' },
    },
    states: {
      stateG1: { group: 'G1', members: stateG1.members, note: 'the recipients’ materialized membership of G1 (fixture: the recipients’ admissions lie outside this vector); the genesis resolves memberOp' },
      stateG1WithoutSender: { group: 'G1', members: [TG1.anchor, UG1.anchor], note: 'the same state after a removal of SG1: member is no current member' },
    },
    stars: { trusted: trusted.chunks, untrusted: untrusted.chunks, allFiller: allFiller.chunks },
    cases,
    assemblyNegatives: { note: 'reception (5.2b): a completed assembly MUST have a positive multiple of 16 entries and every c of one assembly the same length, else the delivery is rejected. Each negative is one chunk from S_T to T_S under salt 3 with a genuine MAC under k_g; its entries are those of a genuine 16-entry star (base) — cut to 1 or 15, extended by one entry of the common c length to 17, or with one c three bytes longer', base: base.chunks, cases: assemblyNegatives },
  })
}

// ── 5. access-anchor-rotate.json (Access §5.6) ──────────────────────────
{
  const founder = await L.pairContext(IKM, nonce(0x5c))           // the founding pair anchor of the personal community
  const { genesis, digest: Dpc } = await genesisOf('anchor-rotate/personal-community', founder, '2026-10-01T09:00:00Z')
  const cg = []
  for (const g of [1, 2, 3, 4]) cg.push(await L.communityContext(IKM, Dpc, g))
  const foreign2 = await L.communityContext(IKM2, Dpc, 2)         // generation 2 under ANOTHER seed
  const foreign3 = await L.communityContext(IKM2, Dpc, 3)
  const Dnew = await digestOfAscii('rltp/vectors/access-anchor-rotate/new-personal-community')
  const n1 = await L.communityContext(IKM, Dnew, 1)               // generation 1 of a new personal community (Identity 9.3)
  const r = {
    r12: await V.makeAnchorRotation(cg[0], cg[1]),
    r23: await V.makeAnchorRotation(cg[1], cg[2]),
    r24: await V.makeAnchorRotation(cg[1], cg[3]),
    r13: await V.makeAnchorRotation(cg[0], cg[2]),
    r12x: await V.makeAnchorRotation(cg[0], foreign2),
    r2x3x: await V.makeAnchorRotation(foreign2, foreign3),
    r2n: await V.makeAnchorRotation(cg[1], n1),
  }
  const badBody = r.r12.body
  r.r12bad = { body: badBody, proof: { proofValue: r.r12.proof.proofValue, successorProofValue: await V.signRaw(cg[2], badBody) } }
  const base = { v: 'rltp-access/0.25', group: genesis.group, epoch: 0, policyVersion: 1, id: '', author: founder.anchor }
  const ops = { genesis }
  const sortIds = (ids) => [...ids].sort()
  const rotate = async (label, rotation, prev) => { ops[label] = (await envelope({ ...base, op: 'anchor.rotate', prev: sortIds(prev.map((l) => ops[l].id)), body: { rotation } }, [founder])).op; mustValidate(ops[label], 'access-operation-envelope.schema.json', label) }
  ops.join = (await envelope({ ...base, op: 'dag.join', prev: [genesis.id], body: {} }, [founder])).op
  const second = (await L.pairContext(IKM2, nonce(0x5d))).anchor
  ops.add = { fixture: true, op: 'member.add', id: oidOfAscii('rltp/vectors/access-anchor-rotate/member.add'), author: founder.anchor, subject: second, prev: [genesis.id], note: 'STATE FIXTURE: an admission of a second member, canonical by assumption — its admission body (invite, accept, welcome) lies outside this vector; its id is oid: + base64url(SHA-256) of the ASCII preimage named in idPreimage', idPreimage: 'rltp/vectors/access-anchor-rotate/member.add' }
  await rotate('rot2', r.r12, ['genesis'])
  await rotate('rot3', r.r23, ['rot2'])
  await rotate('rot4skip', r.r24, ['rot2'])
  await rotate('rotNewCommunity', r.r2n, ['rot2'])
  await rotate('rot3first', r.r23, ['genesis'])
  await rotate('rot3prevBreak', r.r13, ['rot2'])
  await rotate('rot2afterAdd', r.r12, ['add'])
  await rotate('rot2afterJoin', r.r12, ['join'])
  await rotate('rot2foreignAfterJoin', r.r12x, ['join'])
  // the fork rot2 ∥ rot2foreignAfterJoin (same prev, differing bodies):
  // a successor written on each branch before the merge (rot3 on rot2,
  // rot3onForeign on the other), and one written after the merge (its
  // ancestor closure holds both)
  await rotate('rot3onForeign', r.r2x3x, ['rot2foreignAfterJoin'])
  const fWin = ops.rot2.id < ops.rot2foreignAfterJoin.id ? 'rot2' : 'rot2foreignAfterJoin'
  const fLose = fWin === 'rot2' ? 'rot2foreignAfterJoin' : 'rot2'
  const succOf = { rot2: 'rot3', rot2foreignAfterJoin: 'rot3onForeign' }
  await rotate('rot3afterMerge', fWin === 'rot2' ? r.r23 : r.r2x3x, ['rot2', 'rot2foreignAfterJoin'])
  mustFail({ ...ops.rot2, body: { lineage: r.r12 } }, 'access-operation-envelope.schema.json', 'body field lineage')
  ops.rot2bad = (await envelope({ ...base, op: 'anchor.rotate', prev: [genesis.id], body: { rotation: r.r12bad } }, [founder])).op
  mustValidate(ops.rot2bad, 'access-operation-envelope.schema.json', 'rot2bad (shape)')
  const lower = (a, b) => (ops[a].id < ops[b].id ? a : b)
  const higher = (a, b) => (ops[a].id < ops[b].id ? b : a)
  const state = { members: [founder.anchor], epoch: 0, policyVersion: 1 }
  const head = (label) => ({ anchor: ops[label].body.rotation.body.next })
  const cases = [
    { name: 'chain', rules: ['RLTP-ACC-5950', 'RLTP-ACC-5955', 'RLTP-ACC-5960', 'RLTP-ACC-5965', 'RLTP-ACC-5970'], ops: ['genesis', 'rot2', 'rot3'], expect: { status: { rot2: 'canonical', rot3: 'canonical' }, repeat: [], chain: ['rot2', 'rot3'], head: head('rot3'), state } },
    { name: 'first-entry-any-prev', rules: ['RLTP-ACC-5960'], ops: ['genesis', 'rot3first'], expect: { status: { rot3first: 'canonical' }, repeat: [], chain: ['rot3first'], head: head('rot3first'), state } },
    { name: 'derivation-skip', rules: ['RLTP-ACC-5960'], ops: ['genesis', 'rot2', 'rot4skip'], expect: { status: { rot2: 'canonical', rot4skip: 'canonical' }, repeat: [], chain: ['rot2', 'rot4skip'], head: head('rot4skip'), state } },
    { name: 'onto-a-new-personal-community', rules: ['RLTP-ACC-5960'], ops: ['genesis', 'rot2', 'rotNewCommunity'], expect: { status: { rot2: 'canonical', rotNewCommunity: 'canonical' }, repeat: [], chain: ['rot2', 'rotNewCommunity'], head: head('rotNewCommunity'), state } },
    { name: 'prev-break', rules: ['RLTP-ACC-5960'], ops: ['genesis', 'rot2', 'rot3prevBreak'], expect: { status: { rot2: 'canonical', rot3prevBreak: 'invalid' }, repeat: [], chain: ['rot2'], head: head('rot2'), state } },
    { name: 'author-not-sole-member', rules: ['RLTP-ACC-5950'], ops: ['genesis', 'add', 'rot2afterAdd'], expect: { status: { rot2afterAdd: 'invalid' }, repeat: [], chain: [], head: null, state: { ...state, members: [founder.anchor, second].sort() } } },
    { name: 'rotation-does-not-verify', rules: ['RLTP-ACC-5955'], ops: ['genesis', 'rot2bad'], expect: { status: { rot2bad: 'invalid' }, repeat: [], chain: [], head: null, state } },
    { name: 'repeat', rules: ['RLTP-ACC-5965', 'RLTP-ACC-5970'], ops: ['genesis', 'join', 'rot2', 'rot2afterJoin'], expect: { status: { rot2: 'canonical', rot2afterJoin: 'canonical' }, repeat: [higher('rot2', 'rot2afterJoin')], chain: [lower('rot2', 'rot2afterJoin')], head: head('rot2'), state } },
    { name: 'same-prev-differing', rules: ['RLTP-ACC-5965'], ops: ['genesis', 'join', 'rot2', 'rot2foreignAfterJoin'], expect: { status: { [fWin]: 'canonical', [fLose]: 'valid' }, repeat: [], chain: [fWin], head: head(fWin), state } },
    { name: 'delayed-merge-successor-on-losing-branch', rules: ['RLTP-ACC-3325', 'RLTP-ACC-5960', 'RLTP-ACC-5965'], ops: ['genesis', 'join', 'rot2', 'rot2foreignAfterJoin', succOf[fLose]], expect: { status: { [fWin]: 'canonical', [fLose]: 'valid', [succOf[fLose]]: 'valid' }, repeat: [], chain: [fWin], head: head(fWin), state } },
    { name: 'successors-on-both-branches', rules: ['RLTP-ACC-5965'], ops: ['genesis', 'join', 'rot2', 'rot2foreignAfterJoin', 'rot3', 'rot3onForeign'], expect: { status: { [fWin]: 'canonical', [fLose]: 'valid', [succOf[fWin]]: 'canonical', [succOf[fLose]]: 'valid' }, repeat: [], chain: [fWin, succOf[fWin]], head: head(succOf[fWin]), state } },
    { name: 'successor-after-the-merge', rules: ['RLTP-ACC-3325', 'RLTP-ACC-5960', 'RLTP-ACC-5965'], ops: ['genesis', 'join', 'rot2', 'rot2foreignAfterJoin', 'rot3afterMerge'], expect: { status: { [fWin]: 'canonical', [fLose]: 'valid', rot3afterMerge: 'canonical' }, repeat: [], chain: [fWin, 'rot3afterMerge'], head: head('rot3afterMerge'), state } },
  ]
  // self-check against the oracle the runner uses
  const { materializeRotations } = await import('../conformance/access-anchor-rotate.mjs')
  for (const c of cases) {
    const got = await materializeRotations(c.ops.map((l) => ({ label: l, ...ops[l] })), V.verifyAnchorRotation)
    assert(L.jcs(got) === L.jcs(c.expect), `${c.name}: oracle ${L.jcs(got)} ≠ expected ${L.jcs(c.expect)}`)
  }
  W('vectors/access-anchor-rotate.json', {
    source: 'anchor.rotate per RLTP Access Layer 0.56 §5.6 (RLTP-ACC-5950 … 5970): the log of a personal community founded under a fresh pair anchor (Access 3.4.1, RLTP-ACC-3235, 3275), whose sole member writes the community anchor’s rotations; the anchors are group/<genesisDigest>[/g] of the oracle IKM of vectors/identity-derivation.json (Identity 0.52 §5.4), the differing ones derive under its second-party IKM, and the new personal community is group/<D\'> of the oracle IKM. Generated by scripts/gen-anchor-vectors.mjs from the library; the oracle is conformance/access-anchor-rotate.mjs, the runner re-derives ids, signatures and rotations with node:crypto. RLTP-ACC-5975 (no export beyond the log) is state-dependent and has no vector.',
    format: {
      operations: 'real rltp-access/0.25 envelopes by label (id = oid: + base64url SHA-256 of JCS with id empty and proof omitted; signatures over the same bytes); `add` is a STATE FIXTURE (see its note)',
      cases: 'per case the operations of the log (`ops`, labels) and the expected materialization: status per anchor.rotate (canonical | valid — valid but not canonical, 3345 | invalid), the repeats (JCS-identical bodies: one entry, its smallest id the representative, the others canonical with no further effect), the canonical chain (the representatives in walk order), the head (the next anchor of the last canonical entry, null if none), and the state, which no anchor.rotate changes (5970)',
      order: 'validity per operation against its own ancestor closure (3325): 5950 (author = the sole member), 5955 (body exactly rotation; it verifies under both signatures), 5960 (prev = the next of the lineage head of that closure, unconstrained where the closure holds no canonical anchor.rotate). Canonicity over the log at hand (5965): walked from the first canonical entry; among competing entries (same prev, or both first entries) the one with the smaller representative id is canonical with every entry reachable from it, the others and every entry reachable only from them stay valid but not canonical',
    },
    personalCommunity: { genesisDigest: Dpc, founder: pub(founder), founderRelationshipNonce: hexOf(nonce(0x5c)), generations: Object.fromEntries(cg.map((c, i) => [i + 1, pub(c)])), foreignGenerations: { 2: { ...pub(foreign2), note: 'group/<genesisDigest>/2 under the second-party IKM: a different seed' }, 3: { ...pub(foreign3), note: 'group/<genesisDigest>/3 under the second-party IKM' } }, newCommunity: { genesisDigest: Dnew, preimage: 'rltp/vectors/access-anchor-rotate/new-personal-community', generation1: pub(n1), note: 'generation 1 of a new personal community of the same holder: after a lost register the holder rotates onto it (Identity 9.3)' }, secondMember: second },
    operations: ops,
    cases,
  })
}
console.log('anchor vectors written: identity-derivation.json, visibility.json, anchor-rotation.json, group-star.json, access-anchor-rotate.json')
