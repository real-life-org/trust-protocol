#!/usr/bin/env node
// Generates the vectors of the anchor casting — Identity 0.54 §5.4/§6.1,
// Trust Layer 0.31 §5.2b/§6.1/§6.2/§6.5, Access 0.57 §5.6 — from the
// library (lib/dist) where the library builds the artifact, so library
// and vectors cannot drift apart; the conformance runner re-derives every
// claim with node:crypto alone. The pre-rotation artifacts (self-card@2,
// anchor-rotation@2, anchor-mapping@4) are built HERE from the library's
// primitives (signRaw, macU, ecdh, hkdf) until the library builds them
// itself; schemas are read from schemas/, the source of truth.
//
// The binding (Identity 5.4): commit(g) = "u" || base64url(0x12 0x20 ||
// SHA-256(0xed 0x01 || Ed25519 public key of generation g)) — the
// sha2-256 multihash over the multikey bytes of the generation's key,
// in the 47-character digest encoding.
//
//   vectors/identity-derivation.json  + group/<D>/2, /3 and four rejects
//   vectors/visibility.json           self-card@2, anchor-mapping@4 (empty
//                                     lineage), the rotation case (one
//                                     lineage element, mapping under
//                                     generation 2), the chain over three
//                                     generations (mapping under generation
//                                     3, lineage 1→2→3), a lineage of 64
//                                     elements; negatives @2- and
//                                     @3-legacy, a card @1, foreign self,
//                                     lineage not ending at self, a broken
//                                     binding in the lineage, 65 elements
//   vectors/anchor-rotation.json      the bindings of generations 2–4,
//                                     the generation-1 card, valid 1→2,
//                                     2→3 with the binding each is checked
//                                     against; wrong successor signature;
//                                     a generation field; prev = next; a
//                                     next that misses the held binding;
//                                     a missing commit
//   vectors/group-star.json           a sender in two groups, recipients
//                                     current members of one: hit + open
//                                     (trusted), hit with filler
//                                     (untrusted), miss, all-filler star;
//                                     a group joined through an ordinary
//                                     admission (the member.add of
//                                     membership-tasks.json)
//   vectors/access-anchor-rotate.json real envelopes of a personal
//                                     community's log, each rotation an
//                                     anchor-rotation@2: a chain with its
//                                     bindings, a first entry with any
//                                     prev and a bound chain after it; a
//                                     derivation skip, a rotation onto a
//                                     new personal community and onto a
//                                     key of another seed, each beside
//                                     the binding (rejected); a first
//                                     entry the binding keeps off the
//                                     walk; prev break, not sole member,
//                                     repeat,
//                                     same prev with differing bodies, a
//                                     delayed merge with a successor on
//                                     the losing branch, a successor after
//                                     the merge, a rotation that does not
//                                     verify, a nested fork, two first
//                                     entries with different prev; a
//                                     rotation beside a dissolve and
//                                     beside a last-member leave (both
//                                     displace it before the walk), that
//                                     leave reverted by a concurrent
//                                     admission, a repeat beside a
//                                     dissolve
//
// Deterministic: keys derive from the oracle IKM of
// vectors/identity-derivation.json (and its second-party IKM, as in
// scripts/gen-membership-tasks-vector.mjs); the entropy the group star
// takes from its caller (AEAD nonces, filler) is an HKDF counter stream
// under a vector-only info string, stated in the file.
//
//   usage: (cd lib && npm run build) && node scripts/gen-anchor-vectors.mjs [--check]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import * as L from '../lib/dist/index.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCHEMAS = {}
for (const f of readdirSync(join(ROOT, 'schemas')).filter((f) => f.endsWith('.json'))) SCHEMAS[f] = JSON.parse(readFileSync(join(ROOT, 'schemas', f), 'utf8'))
const J = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))
const CHECK = process.argv.includes('--check')
const drift = []
const W = (p, o) => {
  const text = JSON.stringify(o, null, 1) + '\n'
  if (!CHECK) return writeFileSync(join(ROOT, p), text)
  if (readFileSync(join(ROOT, p), 'utf8') !== text) drift.push(p)
}
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

// ── the pre-rotation artifacts (Identity 0.54 §5.4, Trust 0.31 §6.1, 6.2, 6.5) ──
// the multikey bytes of an Ed25519 anchor: 0xed 0x01 || 32 key bytes —
// exactly the bytes the did:key identifier encodes (Identity §8.1)
const multikeyBytes = (anchor) => { const raw = L.edRawOfAnchor(anchor); assert(raw && raw.length === 32, 'an Ed25519 did:key'); return Buffer.concat([Buffer.from([0xed, 0x01]), raw]) }
const commitOf = (anchor) => 'u' + b64u(Buffer.concat([Buffer.from([0x12, 0x20]), sha(multikeyBytes(anchor))]))
const bindingRow = (ctx) => ({ label: ctx.label, anchor: ctx.anchor, multikeyBytes: hexOf(multikeyBytes(ctx.anchor)), sha256: hexOf(sha(multikeyBytes(ctx.anchor))), commit: commitOf(ctx.anchor) })
const signed = async (body, ...ctxs) => ctxs.length === 1 ? { body, proof: { proofValue: await V.signRaw(ctxs[0], body) } } : { body, proof: { proofValue: await V.signRaw(ctxs[0], body), successorProofValue: await V.signRaw(ctxs[1], body) } }
// self-card@2 of generation g: its anchor, key agreement, and the binding to generation g + 1
const selfCard2 = (self, nextGen) => signed({ type: 'self-card@2', anchor: self.anchor, keyAgreement: self.keyAgreement, commit: commitOf(nextGen.anchor) }, self)
// anchor-rotation@2 prev → next, committing to the generation after next
const rotation2 = (prev, next, after) => signed({ type: 'anchor-rotation@2', prev: prev.anchor, next: next.anchor, commit: commitOf(after.anchor) }, prev, next)
const schemaOk = (file, data) => VAL.validate(data, SCHEMAS[file], SCHEMAS[file]).length === 0
const rotation2OK = async (a) => schemaOk('visibility-anchor-rotation.schema.json', a) && a.body.prev !== a.body.next
  && await V.verifyRaw(a.body.prev, a.body, a.proof.proofValue) && await V.verifyRaw(a.body.next, a.body, a.proof.successorProofValue)
// the lineage as given (6.3 condition 4a): bound, each element verifies,
// each prev the preceding next, the last next = self
const lineage4a = async (lineage, self) => {
  if (lineage.length > V.LINEAGE_MAX) return 'bound'
  for (const [i, r] of lineage.entries()) {
    if (!(await rotation2OK(r))) return `element ${i}: does not verify`
    if (i > 0 && r.body.prev !== lineage[i - 1].body.next) return `element ${i}: prev`
  }
  if (lineage.length && lineage.at(-1).body.next !== self) return 'last next'
  return null
}
// the pre-rotation bindings (6.3 condition 4b): each next after the first
// meets the binding the preceding element commits to, the card commits
// what the last element commits; `held` (optional) is the binding the
// receiver holds for the first element's prev
const lineage4b = (lineage, cardCommit, held) => {
  for (const [i, r] of lineage.entries()) if (i > 0 && commitOf(r.body.next) !== lineage[i - 1].body.commit) return `element ${i}: binding`
  if (held !== undefined && lineage.length && commitOf(lineage[0].body.next) !== held) return 'element 0: held binding'
  if (cardCommit !== undefined && lineage.length && cardCommit !== lineage.at(-1).body.commit) return 'card commit'
  return null
}
const lineage2 = async (lineage, self, held) => (await lineage4a(lineage, self)) ?? lineage4b(lineage, undefined, held)
const mapKeys = async (pair, self, toKeyAgreement) => {
  const theirX = L.xRawOfMk(toKeyAgreement)
  return [await L.hkdf(await L.ecdh(pair.x.priv, theirX), 'rltp/visibility/mac/map1'), await L.hkdf(await L.ecdh(self.x.priv, theirX), 'rltp/visibility/mac/map2')]
}
const macBody = async (body, [k1, k2]) => ({ body, proof: { mac1: await V.macU(k1, L.jcs(body)), mac2: await V.macU(k2, L.jcs(body)) } })
// anchor-mapping@4: the card is self-card@2 under self, committing to the generation after self
const mapping4 = async ({ pair, to, toKeyAgreement, self, nextGen, lineage, revision, issuedAt, card }) => {
  const body = { type: 'anchor-mapping@4', pair: pair.anchor, self: self.anchor, to, card: card ?? await selfCard2(self, nextGen), lineage, revision, issuedAt }
  return macBody(body, await mapKeys(pair, self, toKeyAgreement))
}
// 6.3 in its order: the lineage (4a), its bindings (4b); `held` as for lineage4b
const verifyMapping4 = async (m, at, held) => {
  if (!schemaOk('visibility-anchor-mapping.schema.json', m)) return '1'
  const b = m.body
  if (b.to !== at.own.anchor) return '2'
  if (b.pair !== at.pair) return '3'
  if (!(await V.verifyRaw(b.card.body.anchor, b.card.body, b.card.proof.proofValue))) return '4'
  if (await lineage4a(b.lineage, b.self)) return '4a'
  if (lineage4b(b.lineage, b.card.body.commit, held)) return '4b'
  if (b.card.body.anchor !== b.self) return '5'
  const cardX = L.xRawOfMk(b.card.body.keyAgreement), pairX = L.xRawOfMk(at.pairKeyAgreement)
  const msg = L.jcs(b)
  if ((await V.macU(await L.hkdf(await L.ecdh(at.own.x.priv, pairX), 'rltp/visibility/mac/map1'), msg)) !== m.proof.mac1) return '7'
  if ((await V.macU(await L.hkdf(await L.ecdh(at.own.x.priv, cardX), 'rltp/visibility/mac/map2'), msg)) !== m.proof.mac2) return '7'
  return null
}
// anchor-rotation@2 as the personal community's log carries it (Access
// §5.6): the envelope schema's $defs/anchorRotation (a $ref onto the
// Trust schema), both signatures
const ENV = SCHEMAS['access-operation-envelope.schema.json']
const rotationLogOK = async (a) => VAL.validate(a, ENV.$defs.anchorRotation, ENV).length === 0 && a.body.prev !== a.body.next
  && await V.verifyRaw(a.body.prev, a.body, a.proof.proofValue) && await V.verifyRaw(a.body.next, a.body, a.proof.successorProofValue)

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

// ── 2. anchor-rotation.json (Trust §6.5, Identity §5.4) ─────────────────
const gens = []
for (const g of [1, 2, 3, 4]) gens.push(await L.communityContext(IKM, D, g))
const [g1, g2, g3, g4] = gens
// a key of another seed: what a holder of a copied generation-2 key can
// co-sign a rotation onto (Identity §5.4); the binding refuses it
const f3 = await L.communityContext(IKM2, D, 3)
const f4 = await L.communityContext(IKM2, D, 4)
const card1 = await selfCard2(g1, g2)
const rot12 = await rotation2(g1, g2, g3)
const rot23 = await rotation2(g2, g3, g4)
const rot2f = await rotation2(g2, f3, f4)
{
  assert(card1.body.commit === commitOf(g2.anchor) && rot12.body.commit === commitOf(g3.anchor) && rot23.body.commit === commitOf(g4.anchor), 'each carrier commits to the generation after the one it introduces')
  assert(await rotation2OK(rot12) && await rotation2OK(rot23), 'valid rotations verify')
  assert(commitOf(rot12.body.next) === card1.body.commit && commitOf(rot23.body.next) === rot12.body.commit, 'each next meets the binding held for its prev')
  mustValidate(card1, 'visibility-self-card.schema.json', 'self-card@2')
  const wrongSucc = { body: rot12.body, proof: { proofValue: rot12.proof.proofValue, successorProofValue: await V.signRaw(g3, rot12.body) } }
  assert(!(await rotation2OK(wrongSucc)), 'wrong successor signature fails')
  const bG = { ...rot12.body, generation: '2' }
  const withGen = await signed(bG, g1, g2)
  mustFail(withGen, 'visibility-anchor-rotation.schema.json', 'a generation field')
  assert(!(await rotation2OK(withGen)), 'a generation field fails')
  const still = await signed({ type: 'anchor-rotation@2', prev: g1.anchor, next: g1.anchor, commit: commitOf(g2.anchor) }, g1, g1)
  mustValidate(still, 'visibility-anchor-rotation.schema.json', 'prev = next (schema shape)')
  assert(!(await rotation2OK(still)), 'prev = next fails')
  mustValidate(rot2f, 'visibility-anchor-rotation.schema.json', 'binding mismatch (schema shape)')
  assert(await rotation2OK(rot2f) && commitOf(rot2f.body.next) !== rot12.body.commit, 'binding mismatch: both signatures genuine, the binding held for generation 2 refuses next')
  const { commit: _c, ...bNo } = rot12.body
  const noCommit = await signed(bNo, g1, g2)
  mustFail(noCommit, 'visibility-anchor-rotation.schema.json', 'a missing commit')
  const NOTE_COMMIT = 'commit = "u" || base64url(0x12 0x20 || SHA-256(multikeyBytes)), multikeyBytes = 0xed 0x01 || the 32-byte Ed25519 public key of the generation — the bytes the did:key identifier encodes after its "z" (Identity §8.1); sha256 is the bare digest'
  W('vectors/anchor-rotation.json', {
    source: 'anchor-rotation@2 per Trust Layer 0.31 §6.5 over the community anchor of Identity 0.54 §5.4, with the pre-rotation binding: the generations are group/<D>, group/<D>/2, /3, /4 under the oracle IKM of vectors/identity-derivation.json, <D> its genesisDigestSample — the community of vectors/visibility.json; the foreign generations are group/<D>/3, /4 under its second-party IKM (HKDF(oracle IKM, "rltp/vector/second-party-root-ikm"), 64 bytes). Generated by scripts/gen-anchor-vectors.mjs; re-derived by conformance/runner.mjs, the bindings byte for byte by scripts/validate.mjs.',
    format: {
      artifact: '{ body: { type, prev, next, commit }, proof: { proofValue, successorProofValue } }: proofValue is raw Ed25519 under prev, successorProofValue raw Ed25519 under next, both over the JCS bytes of body, z-base58btc (Trust 2.1); next differs from prev; commit is the binding to the generation after next; no generation number — the chain order is prev/next alone',
      binding: NOTE_COMMIT,
      card: 'self-card@2 { body: { type, anchor, keyAgreement, commit }, proof: { proofValue } } — the carrier that introduces generation 1 and commits to generation 2',
      valid: 'prevLabel and nextLabel name the two contexts (Identity 6.1) whose anchors the artifact links; heldBinding is the binding the receiver holds for prev (the commit of the card or rotation that introduced prev), and the binding computed over next equals it',
      negatives: 'each MUST be rejected at the named check (expect); the schema check comes first',
    },
    community: { genesisDigest: D, generations: { 1: pub(g1), 2: pub(g2), 3: pub(g3), 4: pub(g4) }, bindings: { 2: bindingRow(g2), 3: bindingRow(g3), 4: bindingRow(g4) } },
    foreignGenerations: { 3: { ...pub(f3), commit: commitOf(f3.anchor) }, 4: { ...pub(f4), commit: commitOf(f4.anchor) }, note: 'group/<D>/3 and /4 under the second-party IKM: keys of another seed, the successor a holder of a copied generation-2 key can co-sign (Identity 5.4)' },
    card: card1,
    valid: [
      { name: 'generation-1-to-2', prevLabel: g1.label, nextLabel: g2.label, heldBinding: { from: 'card', commit: card1.body.commit }, artifact: rot12 },
      { name: 'generation-2-to-3', prevLabel: g2.label, nextLabel: g3.label, heldBinding: { from: 'generation-1-to-2', commit: rot12.body.commit }, artifact: rot23 },
    ],
    negative: [
      { name: 'successor-signature-wrong', checkOrder: 'schema PASS, proofValue under prev PASS, successorProofValue under next FAILS (it is a signature under generation 3)', expect: 'reject: successorProofValue does not verify under next', artifact: wrongSucc },
      { name: 'generation-field', checkOrder: 'schema FAILS (the body is closed: type, prev, next, commit); both signatures are genuine', expect: 'reject: a generation field is not part of anchor-rotation@2', artifact: withGen },
      { name: 'prev-equals-next', checkOrder: 'schema PASS, next ≠ prev FAILS; both signatures are genuine', expect: 'reject: a rotation moves to a different key', artifact: still },
      { name: 'binding-mismatch', heldBinding: { from: 'generation-1-to-2', commit: rot12.body.commit }, checkOrder: 'schema PASS, next ≠ prev PASS, both signatures genuine (generation 2 and the foreign generation 3), the binding computed over next FAILS against the binding held for prev', expect: 'reject: the binding over next is not the binding held for prev', artifact: rot2f },
      { name: 'commit-missing', checkOrder: 'schema FAILS (commit is required); both signatures are genuine', expect: 'reject: an anchor-rotation@2 without commit', artifact: noCommit },
    ],
  })
}

// ── 3. visibility.json: self-card@2, anchor-mapping@4, the rotation cases ──
{
  const VIS = J('vectors/visibility.json')
  const P = {}
  for (const [k, v] of Object.entries(VIS.parties)) P[k] = await L.pairContext(IKM, Uint8Array.from(Buffer.from(v.relationshipNonce, 'hex')))
  assert(VIS.self.label === g1.label && VIS.self.anchor === g1.anchor, 'self is generation 1 of <D>')
  const issuedAt = '2026-08-23T12:00:00Z'
  const toB = { pair: P.A, to: P.B.anchor, toKeyAgreement: P.B.keyAgreement }
  const at = { own: P.B, pair: P.A.anchor, pairKeyAgreement: P.A.keyAgreement }
  const mapping = await mapping4({ ...toB, self: g1, nextGen: g2, lineage: [], revision: '1', issuedAt })
  assert(L.jcs(mapping.body.card) === L.jcs(card1), 'the enclosed card is the generation-1 card of anchor-rotation.json')
  assert((await verifyMapping4(mapping, at)) === null, 'mapping@4 verifies')
  const rotated = await mapping4({ ...toB, self: g2, nextGen: g3, lineage: [rot12], revision: '2', issuedAt: '2026-10-07T12:00:00Z' })
  assert((await verifyMapping4(rotated, at, mapping.body.card.body.commit)) === null, 'rotated mapping verifies against the binding of the held card')
  assert(V.classifyMapping(g1.anchor, rotated.body) === 'rotation', 'classified as rotation')
  const third = await mapping4({ ...toB, self: g3, nextGen: g4, lineage: [rot12, rot23], revision: '3', issuedAt: '2026-10-14T12:00:00Z' })
  assert((await verifyMapping4(third, at, mapping.body.card.body.commit)) === null && (await verifyMapping4(third, at)) === null, 'the three-generation mapping verifies')
  assert(V.classifyMapping(g1.anchor, third.body) === 'rotation' && V.classifyMapping(g2.anchor, third.body) === 'rotation', 'held generation 1 or 2: a rotation')
  assert(third.body.card.body.commit === rot23.body.commit, 'the card and the last lineage element carry the same binding')
  const keysG1 = await mapKeys(P.A, g1, P.B.keyAgreement)
  // the former anchor-mapping@3 — rebuilt byte-exactly from the same inputs (its card a self-card@1); now a legacy negative (2.1)
  const card1v1 = await signed({ type: 'self-card@1', anchor: g1.anchor, keyAgreement: g1.keyAgreement }, g1)
  const legacy3 = await macBody({ type: 'anchor-mapping@3', pair: P.A.anchor, self: g1.anchor, to: P.B.anchor, card: card1v1, lineage: [], revision: '1', issuedAt }, keysG1)
  if (VIS.artifacts.anchorMapping.body.type === 'anchor-mapping@3') assert(L.jcs(legacy3) === L.jcs(VIS.artifacts.anchorMapping), 'the rebuilt @3 is the formerly shipped artifact')
  mustFail(legacy3, 'visibility-anchor-mapping.schema.json', 'anchor-mapping@3')
  // the former anchor-mapping@2 — rebuilt byte-exactly from the same inputs; a legacy negative (2.1)
  const body2 = { type: 'anchor-mapping@2', pair: P.A.anchor, self: g1.anchor, to: P.B.anchor, card: card1v1, revision: '1', issuedAt }
  const legacy2 = await macBody(body2, keysG1)
  mustFail(legacy2, 'visibility-anchor-mapping.schema.json', 'anchor-mapping@2')
  // a card @1 inside an otherwise well-formed @4 — MACs over that body
  const card1Body = { ...mapping.body, card: card1v1 }
  const withCard1 = await macBody(card1Body, keysG1)
  mustFail(withCard1, 'visibility-anchor-mapping.schema.json', 'a self-card@1 in anchor-mapping@4')
  assert((await verifyMapping4(withCard1, at)) === '1', 'card @1 fails at step 1')
  // foreign self: self = B's anchor, the card stays the sender's own — MACs over the mutated body
  const foreign = await macBody({ ...mapping.body, self: P.B.anchor }, keysG1)
  assert((await verifyMapping4(foreign, at)) === '5', 'foreign self fails at step 5')
  // lineage not ending at self: the generation-1 card and self, a lineage ending at generation 2
  const lineageEnd = await macBody({ ...mapping.body, lineage: [rot12] }, keysG1)
  assert((await verifyMapping4(lineageEnd, at)) === '4a', 'lineage not ending at self fails at 4a')
  // a broken binding: generation 1 → 2 → the foreign generation 3; self and
  // card under the foreign key, MACs under the pair key and the foreign X key
  const broken = await mapping4({ ...toB, self: f3, nextGen: f4, lineage: [rot12, rot2f], revision: '3', issuedAt: '2026-10-14T12:00:00Z' })
  assert((await lineage2(broken.body.lineage, broken.body.self)) === 'element 1: binding' && (await verifyMapping4(broken, at)) === '4b', 'a broken binding passes 4a and fails at 4b, at the binding alone')
  // the bound (6.1): 64 elements are accepted, 65 fail the schema
  const long = []
  for (let g = 1; g <= 67; g++) long.push(await L.communityContext(IKM, D, g))
  const chain = []
  for (let i = 0; i < 65; i++) chain.push(await rotation2(long[i], long[i + 1], long[i + 2]))
  const m64 = await mapping4({ ...toB, self: long[65], nextGen: long[66], lineage: chain.slice(1), revision: '3', issuedAt: '2026-10-07T12:00:00Z' })
  assert((await verifyMapping4(m64, at, chain[0].body.commit)) === null, 'a 64-element lineage verifies')
  const m65 = await mapping4({ ...toB, self: long[65], nextGen: long[66], lineage: chain, revision: '3', issuedAt: '2026-10-07T12:00:00Z' })
  mustFail(m65, 'visibility-anchor-mapping.schema.json', 'a 65-element lineage')
  assert((await verifyMapping4(m65, at)) === '1' && (await lineage2(chain, long[65].anchor)) === 'bound', 'a 65-element lineage fails at step 1')
  assert(V.classifyMapping(g2.anchor, m64.body) === 'rotation' && V.classifyMapping(g1.anchor, m64.body) === 'rejected', 'condition 8 over the carried segment')
  const dropped = ['mapping-foreign-self', 'legacy-version-2', 'legacy-version-3', 'mapping-card-1', 'mapping-lineage-not-ending-at-self', 'mapping-lineage-binding-broken', 'mapping-lineage-65']
  const negative = VIS.negative.filter((n) => !dropped.includes(n.name))
  negative.unshift(
    { name: 'mapping-foreign-self', fixture: 'addressee B holds tuple (A,B) active; arrival on that tuple', checkOrder: '6.3 steps 1-8 in order; steps 1-4b PASS (MACs are over the mutated body), step 5 FAILS', expect: 'reject: card.anchor != body.self', artifact: foreign },
    { name: 'mapping-card-1', fixture: 'none needed', checkOrder: '6.3 step 1 FAILS: the card is a self-card@1 (no commit), the mapping otherwise anchor-mapping@4; MACs are over this body', expect: 'reject: the card of anchor-mapping@4 is a self-card@2', artifact: withCard1 },
    { name: 'mapping-lineage-not-ending-at-self', fixture: 'addressee B holds tuple (A,B) active; arrival on that tuple', checkOrder: '6.3 steps 1-4 PASS, step 4a FAILS: the lineage element verifies under both signatures and meets the binding of the generation-1 card, but its next is generation 2 while self is generation 1 (MACs are over the mutated body)', expect: 'reject: the last next of lineage != self', artifact: lineageEnd },
    { name: 'mapping-lineage-binding-broken', fixture: 'addressee B holds tuple (A,B) active; arrival on that tuple', checkOrder: '6.3 steps 1-4a PASS, step 4b FAILS at the binding alone: both elements verify under both signatures, each prev is the preceding next and the last next is self (the foreign generation 3 of anchor-rotation.json), but the binding computed over the second element\'s next is not the commit of the first element (MACs under the pair key and the foreign key verify)', expect: 'reject: a lineage element whose next does not meet the binding the preceding element commits to', artifact: broken },
    { name: 'mapping-lineage-65', fixture: 'addressee B holds tuple (A,B) active; arrival on that tuple', checkOrder: '6.3 step 1 FAILS: the lineage carries 65 elements, the schema admits at most 64; every element verifies, the bindings chain and the chain ends at self (generation 66)', expect: 'reject: more than 64 lineage elements', artifact: m65 },
  )
  const li = negative.findIndex((n) => n.name === 'legacy-version')
  negative.splice(li + 1, 0,
    { name: 'legacy-version-2', fixture: 'none needed', checkOrder: '2.1 type check, before any crypto', expect: 'reject: anchor-mapping@2 not implemented (Trust 0.31 2.1)', artifact: legacy2 },
    { name: 'legacy-version-3', fixture: 'none needed', checkOrder: '2.1 type check, before any crypto', expect: 'reject: anchor-mapping@3 not implemented (Trust 0.31 2.1); its card is a self-card@1, its lineage carries anchor-rotation@1', artifact: legacy3 },
  )
  W('vectors/visibility.json', {
    ...VIS,
    self: { label: g1.label, anchor: g1.anchor, keyAgreement: g1.keyAgreement, note: 'the community anchor at generation 1: the group-context derivation over the personal community’s genesis digest (Identity 0.54 §2, §5.4; the S-DID cut of 0.13); the vector key name „self“ mirrors the frozen wire field spelling' },
    selfGenerations: {
      2: { ...pub(g2), note: 'generation 2 of the same community anchor: group/<digest>/2 (Identity 0.54 §5.4)' },
      3: { ...pub(g3), note: 'generation 3: group/<digest>/3' },
      4: { ...pub(g4), note: 'generation 4: group/<digest>/4 — only its binding appears (the commit of the generation-3 card and of the rotation 2 → 3)' },
    },
    artifacts: { ...VIS.artifacts, selfCard: card1, anchorMapping: mapping, anchorRotation: rot12, anchorRotation23: rot23, anchorMappingRotated: rotated, anchorMappingGeneration3: third, anchorMappingLineage64: m64 },
    rotation: { note: 'anchorMappingRotated: the sender A rotated its community anchor from generation 1 to 2 (anchorRotation) and re-issued the mapping on tuple (A,B) under a higher revision with lineage [anchorRotation]; B, holding anchorMapping (self = generation 1, its card committing to generation 2), checks that the binding computed over the first element\'s next equals that held binding (heldBinding) and classifies the mapping as a ROTATION (6.3 condition 8): the previously held self is the prev of a lineage element. The binding is computed as anchor-rotation.json states', heldSelf: g1.anchor, heldBinding: mapping.body.card.body.commit, classification: 'rotation' },
    chain3: { note: 'anchorMappingGeneration3: A at generation 3 carries the chain 1 → 2 → 3 (anchorRotation, anchorRotation23) under revision 3; the second element\'s next meets the binding the first commits to, and the first element\'s next meets the binding of the generation-1 card B holds. The card under generation 3 commits to generation 4, as the last element does. B holding generation 1 or 2 classifies it as a ROTATION', heldSelf: g1.anchor, heldBinding: mapping.body.card.body.commit, classifications: { [g1.anchor]: 'rotation', [g2.anchor]: 'rotation' } },
    lineageBound: { note: 'anchorMappingLineage64: A at generation 66 of <D> (group/<D>/66) carries the 64 most recent rotations, 2→3 … 65→66, in chain order, each committing to the generation after its next (6.1, 6.3 conditions 4a and 4b); the card under generation 66 commits to generation 67; it verifies. A contact holding generation 2 finds it in the carried segment — a ROTATION; one holding generation 1 missed more than 64 rotations: the segment does not carry its held self as the prev of an element, so it REJECTS the mapping and keeps the anchor it holds (6.3 condition 8, 6170, 6400). The 65-element mapping is the negative mapping-lineage-65', self: long[65].label, classifications: { [g2.anchor]: 'rotation', [g1.anchor]: 'rejected' } },
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
  // G4: a group the sender JOINED through an ordinary canonical admission —
  // the real member.add of vectors/membership-tasks.json, whose subject is
  // the oracle IKM under group/<G4> (Access 5.1) and whose accept card
  // carries the key-agreement key the pair proof is checked under
  const MT = J('vectors/membership-tasks.json')
  const G4 = MT.genesisDigest
  const admissionG4 = MT.payload.operation
  const SG4 = await L.labeledContext(IKM, 'group/' + G4)
  const acceptCardG4 = admissionG4.body.admission.accept.payload.accept.card
  assert(admissionG4.op === 'member.add' && SG4.anchor === admissionG4.body.subject && acceptCardG4.anchor === SG4.anchor && acceptCardG4.keyAgreement === SG4.keyAgreement, 'G4: the admission admits the sender\'s member anchor under its accept card')
  const TG4 = await L.labeledContext(IKM2, 'group/' + G4)          // the recipient's member anchor in G4 (fixture)
  const trusted = await V.buildGroupStar({ own: P.S_T, to: P.T_S.anchor, toKeyAgreement: P.T_S.keyAgreement, salt: '1', groups: listed(true), rand: entropy('trusted') })
  const admitted = await V.buildGroupStar({ own: P.S_T, to: P.T_S.anchor, toKeyAgreement: P.T_S.keyAgreement, salt: '4', groups: [{ group: G4, sealed: true, member: SG4, memberOp: admissionG4.id }], rand: entropy('admission') })
  const untrusted = await V.buildGroupStar({ own: P.S_U, to: P.U_S.anchor, toKeyAgreement: P.U_S.keyAgreement, salt: '1', groups: listed(false), rand: entropy('untrusted') })
  const allFiller = await V.buildGroupStar({ own: P.S_T, to: P.T_S.anchor, toKeyAgreement: P.T_S.keyAgreement, salt: '2', groups: [], rand: entropy('all-filler') })
  for (const s of [trusted, untrusted, allFiller, admitted]) for (const c of s.chunks) mustValidate(c, 'visibility-group-star.schema.json', 'group star')
  const member = (members) => ({ group: G1, isMember: (a) => members.includes(a), resolve: (oid) => oid === genesis.id ? { subject: genesis.body.members[0], keyAgreement: genesis.body.card.keyAgreement } : null })
  const stateG1 = { members: [P.SG1.anchor, TG1.anchor, UG1.anchor] }
  const run = async (star, own, from, memberships) => {
    const asm = await V.assembleGroupStar({ own, from: from.anchor, fromKeyAgreement: from.keyAgreement, chunks: star.chunks })
    assert(asm.ok, 'assembles')
    return V.openGroupStar({ own, from: from.anchor, fromKeyAgreement: from.keyAgreement, salt: asm.salt, entries: asm.entries, memberships })
  }
  const missG3 = { group: G3, isMember: () => true, resolve: () => null }
  const memberG4 = (members) => ({ group: G4, isMember: (a) => members.includes(a), resolve: (oid) => oid === admissionG4.id ? { subject: admissionG4.body.subject, keyAgreement: acceptCardG4.keyAgreement } : null })
  const stateG4 = { members: [MT.genesis.body.members[0], SG4.anchor, TG4.anchor].sort() }
  const cases = [
    { name: 'hit-open-trusted', star: 'trusted', recipient: 'T_S', from: 'S_T', memberships: ['G1'], state: 'stateG1', result: await run(trusted, P.T_S, P.S_T, [member(stateG1.members)]) },
    { name: 'hit-filler-untrusted', star: 'untrusted', recipient: 'U_S', from: 'S_U', memberships: ['G1'], state: 'stateG1', result: await run(untrusted, P.U_S, P.S_U, [member(stateG1.members)]) },
    { name: 'miss', star: 'trusted', recipient: 'T_S', from: 'S_T', memberships: ['G3'], state: null, result: await run(trusted, P.T_S, P.S_T, [missG3]) },
    { name: 'all-filler', star: 'allFiller', recipient: 'T_S', from: 'S_T', memberships: ['G1'], state: 'stateG1', result: await run(allFiller, P.T_S, P.S_T, [member(stateG1.members)]) },
    { name: 'pair-member-not-current', star: 'trusted', recipient: 'T_S', from: 'S_T', memberships: ['G1'], state: 'stateG1WithoutSender', result: await run(trusted, P.T_S, P.S_T, [member([TG1.anchor, UG1.anchor])]) },
    { name: 'hit-open-ordinary-admission', star: 'admission', recipient: 'T_S', from: 'S_T', memberships: ['G4'], state: 'stateG4', result: await run(admitted, P.T_S, P.S_T, [memberG4(stateG4.members)]) },
    { name: 'ordinary-admission-member-not-current', star: 'admission', recipient: 'T_S', from: 'S_T', memberships: ['G4'], state: 'stateG4WithoutSender', result: await run(admitted, P.T_S, P.S_T, [memberG4(stateG4.members.filter((m) => m !== SG4.anchor))]) },
  ]
  assert(cases[0].result[0].accepted && cases[0].result[0].member === P.SG1.anchor, 'trusted: accepted')
  assert(cases[1].result[0].hit && !cases[1].result[0].opened, 'untrusted: hit, filler')
  assert(!cases[2].result[0].hit && !cases[3].result[0].hit, 'miss, all-filler')
  assert(cases[4].result[0].opened && !cases[4].result[0].accepted && cases[4].result[0].reason === 'member', 'not current: rejected at the member check')
  assert(cases[5].result[0].accepted && cases[5].result[0].member === SG4.anchor, 'ordinary admission: accepted under the accept card')
  assert(cases[6].result[0].opened && !cases[6].result[0].accepted && cases[6].result[0].reason === 'member', 'ordinary admission, sender removed: rejected at the member check')
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
    source: 'group-star@1 per Network Visibility 0.30 §5.2b, carried by the task group-star/0.1 (Delivery 0.80): a sender S in two groups (G1, which S founded under its founding pair context SG1 — memberOp is the genesis; G2, which S joined — its member anchor is group/<G2>, memberOp a placeholder admission oid) toward a trusted recipient T and an untrusted recipient U, both current members of G1 only; and, toward T under salt 4, G4, which S joined through an ordinary canonical admission — the real member.add of vectors/membership-tasks.json — and T is a member of. Keys derive from the oracle IKM of vectors/identity-derivation.json (pair contexts from the listed relationship nonces), T’s member anchor and the G1 group DID from its second-party IKM, U’s member anchor from a third-party IKM (HKDF(oracle IKM, \"rltp/vector/third-party-root-ikm\"), 64 bytes). Generated by scripts/gen-anchor-vectors.mjs from the library; re-derived by conformance/runner.mjs.',
    format: {
      keys: 'k_g = HKDF(X25519(pairX_sender, pairX_recipient), "rltp/visibility/blind/group-star/" || senderPair || "/" || recipientPair || "/" || salt); k_e(G) = HKDF(same ikm, "rltp/visibility/seal/group-star/" || senderPair || "/" || recipientPair || "/" || salt || "/" || G); salt in its wire string form, G the 47-character u form of the genesis digest',
      entry: 'd = HMAC(k_g, UTF-8 of G) in the mac encoding; c = u + base64url(nonce(12) || AES-256-GCM ciphertext || tag(16)) under k_e(G), AAD = the bytes of the d string, plaintext the JCS bytes of a group-pair@1 — or filler: random bytes of exactly the length of a real c of this star (every field of a group pair but salt has a fixed length); padding entries carry a random 32-byte d',
      pair: 'group-pair@1 = { type, group, member, memberOp, to, salt, proof }, proof = HMAC(HKDF(ECDH(memberX_sender, pairX_recipient), "rltp/visibility/mac/group-pair"), JCS(pair without proof)); memberX_sender is the key-agreement key of the card in the operation memberOp names (here the genesis card)',
      star: 'entries padded to the next positive multiple of 16 (none listed: 16 filler), sorted by d once, sliced into chunks of at most 64; proof.mac = HMAC(k_g, JCS(body))',
      cases: 'the recipient assembles the star of `star` from `from`, tests each group of `memberships` (groups it is a current member of, with the materialized state `state`) and expects `result` per group: hit (d in the union), opened (c opens under k_e(G)), accepted (the reception checks of 5.2b in order: schema, group, to/salt, memberOp names a canonical admission of member — the genesis whose members[0] is member (G1), or an ordinary member.add whose subject is member, under its accept card (G4) — and member is current, MAC), reason (the failing check)',
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
      G4: { genesisDigest: G4, member: pub(SG4), memberOp: admissionG4.id, admission: admissionG4, note: 'the group of vectors/membership-tasks.json, which the sender JOINED: memberOp names its ordinary canonical admission (the real member.add of that vector, copied here; its genesis digest and id recompute from that vector), whose subject is the sender\'s member anchor group/<G4> under the oracle IKM and whose accept card carries the key-agreement key the pair proof is checked under' },
    },
    states: {
      stateG1: { group: 'G1', members: stateG1.members, note: 'the recipients’ materialized membership of G1 (fixture: the recipients’ admissions lie outside this vector); the genesis resolves memberOp' },
      stateG1WithoutSender: { group: 'G1', members: [TG1.anchor, UG1.anchor], note: 'the same state after a removal of SG1: member is no current member' },
      stateG4: { group: 'G4', members: stateG4.members, note: 'the recipient\'s materialized membership of G4: the founder, the sender admitted by the member.add memberOp names (canonical, per vectors/membership-tasks.json) and the recipient (fixture: its admission lies outside this vector, its member anchor derives under the second-party IKM)' },
      stateG4WithoutSender: { group: 'G4', members: stateG4.members.filter((m) => m !== SG4.anchor), note: 'the same state after a removal of the sender' },
    },
    stars: { trusted: trusted.chunks, untrusted: untrusted.chunks, allFiller: allFiller.chunks, admission: admitted.chunks },
    cases,
    assemblyNegatives: { note: 'reception (5.2b): a completed assembly MUST have a positive multiple of 16 entries and every c of one assembly the same length, else the delivery is rejected. Each negative is one chunk from S_T to T_S under salt 3 with a genuine MAC under k_g; its entries are those of a genuine 16-entry star (base) — cut to 1 or 15, extended by one entry of the common c length to 17, or with one c three bytes longer', base: base.chunks, cases: assemblyNegatives },
  })
}

// ── 5. access-anchor-rotate.json (Access §5.6) ──────────────────────────
{
  const founder = await L.pairContext(IKM, nonce(0x5c))           // the founding pair anchor of the personal community
  const { genesis, digest: Dpc } = await genesisOf('anchor-rotate/personal-community', founder, '2026-10-01T09:00:00Z')
  const cg = []
  for (const g of [1, 2, 3, 4, 5]) cg.push(await L.communityContext(IKM, Dpc, g))
  const foreign2 = await L.communityContext(IKM2, Dpc, 2)         // generation 2 under ANOTHER seed
  const foreign3 = await L.communityContext(IKM2, Dpc, 3)
  const foreign4 = await L.communityContext(IKM2, Dpc, 4)
  const Dnew = await digestOfAscii('rltp/vectors/access-anchor-rotate/new-personal-community')
  const n1 = await L.communityContext(IKM, Dnew, 1)               // generation 1 of another personal community of the same seed
  const n2 = await L.communityContext(IKM, Dnew, 2)
  // every rotation is anchor-rotation@2 prev → next, committing to the
  // generation after next of its own seed and digest (Identity 5.4)
  const r = {
    r12: await rotation2(cg[0], cg[1], cg[2]),
    r23: await rotation2(cg[1], cg[2], cg[3]),
    r34: await rotation2(cg[2], cg[3], cg[4]),
    r24: await rotation2(cg[1], cg[3], cg[4]),                     // a derivation skip: 2 → 4
    r13: await rotation2(cg[0], cg[2], cg[3]),
    r12x: await rotation2(cg[0], foreign2, foreign3),
    r2x3x: await rotation2(foreign2, foreign3, foreign4),
    r2n: await rotation2(cg[1], n1, n2),                           // onto another personal community
    r23x: await rotation2(cg[1], foreign3, foreign4),              // generation 2 co-signing onto a key of another seed
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
  await rotate('rot3foreign', r.r23x, ['rot2'])
  await rotate('rot3first', r.r23, ['genesis'])
  await rotate('rot4onFirst', r.r34, ['rot3first'])
  await rotate('rot3foreignFirst', r.r23x, ['genesis'])
  await rotate('rot4first', r.r34, ['genesis'])
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
  // the nested fork: a second choice under the head that won the first —
  // two children of the winner with the same prev; both meet the winner's
  // binding, so they name the same next and differ in their commit alone
  if (fWin === 'rot2') await rotate('rot3otherCommit', await rotation2(cg[1], cg[2], foreign4), ['rot2'])
  else await rotate('rot3onForeignOtherCommit', await rotation2(foreign2, foreign3, cg[3]), ['rot2foreignAfterJoin'])
  const nestedKids = fWin === 'rot2' ? ['rot3', 'rot3otherCommit'] : ['rot3onForeign', 'rot3onForeignOtherCommit']
  // terminal operations of the sole member (Access 5.4, the last-member
  // path) beside a rotation: the dispositions of 3.6 run before the walk
  // (RLTP-ACC-5965) — a canonical group.dissolve and a last-member leave
  // displace a concurrent rotation (3465, 3470); a concurrent canonical
  // admission reverts the leave to an ordinary one (5840)
  const terminal = async (label, op, prev) => { ops[label] = (await envelope({ ...base, op, prev: sortIds(prev.map((l) => ops[l].id)), body: {} }, [founder])).op; mustValidate(ops[label], 'access-operation-envelope.schema.json', label) }
  await terminal('dissolve', 'group.dissolve', ['join'])
  await terminal('leaveLast', 'member.leave', ['join'])
  await terminal('dissolveAfterRot2', 'group.dissolve', ['rot2'])
  mustFail({ ...ops.rot2, body: { lineage: r.r12 } }, 'access-operation-envelope.schema.json', 'body field lineage')
  { const { commit, ...v1 } = r.r12.body
    mustFail({ ...ops.rot2, body: { rotation: { ...r.r12, body: v1 } } }, 'access-operation-envelope.schema.json', 'a rotation without commit')
    mustFail({ ...ops.rot2, body: { rotation: { ...r.r12, body: { ...v1, type: 'anchor-rotation@1' } } } }, 'access-operation-envelope.schema.json', 'an anchor-rotation@1') }
  ops.rot2bad = (await envelope({ ...base, op: 'anchor.rotate', prev: [genesis.id], body: { rotation: r.r12bad } }, [founder])).op
  mustValidate(ops.rot2bad, 'access-operation-envelope.schema.json', 'rot2bad (shape)')
  const lower = (a, b) => (ops[a].id < ops[b].id ? a : b)
  const higher = (a, b) => (ops[a].id < ops[b].id ? b : a)
  const state = { members: [founder.anchor], epoch: 0, policyVersion: 1 }
  const head = (label) => ({ anchor: ops[label].body.rotation.body.next })
  const cases = [
    { name: 'chain', rules: ['RLTP-ACC-5950', 'RLTP-ACC-5955', 'RLTP-ACC-5956', 'RLTP-ACC-5958', 'RLTP-ACC-5960', 'RLTP-ACC-5965', 'RLTP-ACC-5966', 'RLTP-ACC-5967', 'RLTP-ACC-5970'], ops: ['genesis', 'rot2', 'rot3'], expect: { status: { rot2: 'canonical', rot3: 'canonical' }, repeat: [], chain: ['rot2', 'rot3'], head: head('rot3'), state } },
    { name: 'first-entry-any-prev', rules: ['RLTP-ACC-5958', 'RLTP-ACC-5960'], ops: ['genesis', 'rot3first'], expect: { status: { rot3first: 'canonical' }, repeat: [], chain: ['rot3first'], head: head('rot3first'), state } },
    { name: 'bound-chain-after-a-first-entry', rules: ['RLTP-ACC-5958', 'RLTP-ACC-5960', 'RLTP-ACC-5965', 'RLTP-ACC-5967'], ops: ['genesis', 'rot3first', 'rot4onFirst'], expect: { status: { rot3first: 'canonical', rot4onFirst: 'canonical' }, repeat: [], chain: ['rot3first', 'rot4onFirst'], head: head('rot4onFirst'), state } },
    { name: 'derivation-skip', rules: ['RLTP-ACC-5960'], ops: ['genesis', 'rot2', 'rot4skip'], expect: { status: { rot2: 'canonical', rot4skip: 'invalid' }, repeat: [], chain: ['rot2'], head: head('rot2'), state } },
    { name: 'onto-a-new-personal-community', rules: ['RLTP-ACC-5960'], ops: ['genesis', 'rot2', 'rotNewCommunity'], expect: { status: { rot2: 'canonical', rotNewCommunity: 'invalid' }, repeat: [], chain: ['rot2'], head: head('rot2'), state } },
    { name: 'onto-a-key-of-another-seed', rules: ['RLTP-ACC-5960'], ops: ['genesis', 'rot2', 'rot3foreign'], expect: { status: { rot2: 'canonical', rot3foreign: 'invalid' }, repeat: [], chain: ['rot2'], head: head('rot2'), state } },
    { name: 'first-entry-off-the-binding', rules: ['RLTP-ACC-5958', 'RLTP-ACC-5960', 'RLTP-ACC-5965', 'RLTP-ACC-5967', 'RLTP-ACC-5968'], ops: ['genesis', 'rot2', 'rot3foreignFirst'], expect: lower('rot2', 'rot3foreignFirst') === 'rot2' ? { status: { rot2: 'canonical', rot3foreignFirst: 'valid' }, repeat: [], chain: ['rot2'], head: head('rot2'), state } : { status: { rot2: 'valid', rot3foreignFirst: 'canonical' }, repeat: [], chain: ['rot3foreignFirst'], head: head('rot3foreignFirst'), state } },
    { name: 'prev-break', rules: ['RLTP-ACC-5958'], ops: ['genesis', 'rot2', 'rot3prevBreak'], expect: { status: { rot2: 'canonical', rot3prevBreak: 'invalid' }, repeat: [], chain: ['rot2'], head: head('rot2'), state } },
    { name: 'author-not-sole-member', rules: ['RLTP-ACC-5950'], ops: ['genesis', 'add', 'rot2afterAdd'], expect: { status: { rot2afterAdd: 'invalid' }, repeat: [], chain: [], head: null, state: { ...state, members: [founder.anchor, second].sort() } } },
    { name: 'rotation-does-not-verify', rules: ['RLTP-ACC-5956'], ops: ['genesis', 'rot2bad'], expect: { status: { rot2bad: 'invalid' }, repeat: [], chain: [], head: null, state } },
    { name: 'repeat', rules: ['RLTP-ACC-5965', 'RLTP-ACC-5966', 'RLTP-ACC-5970'], ops: ['genesis', 'join', 'rot2', 'rot2afterJoin'], expect: { status: { rot2: 'canonical', rot2afterJoin: 'canonical' }, repeat: [higher('rot2', 'rot2afterJoin')], chain: [lower('rot2', 'rot2afterJoin')], head: head('rot2'), state } },
    { name: 'same-prev-differing', rules: ['RLTP-ACC-5965', 'RLTP-ACC-5966', 'RLTP-ACC-5968'], ops: ['genesis', 'join', 'rot2', 'rot2foreignAfterJoin'], expect: { status: { [fWin]: 'canonical', [fLose]: 'valid' }, repeat: [], chain: [fWin], head: head(fWin), state } },
    { name: 'delayed-merge-successor-on-losing-branch', rules: ['RLTP-ACC-3325', 'RLTP-ACC-5958', 'RLTP-ACC-5960', 'RLTP-ACC-5962', 'RLTP-ACC-5965', 'RLTP-ACC-5967', 'RLTP-ACC-5968'], ops: ['genesis', 'join', 'rot2', 'rot2foreignAfterJoin', succOf[fLose]], expect: { status: { [fWin]: 'canonical', [fLose]: 'valid', [succOf[fLose]]: 'valid' }, repeat: [], chain: [fWin], head: head(fWin), state } },
    { name: 'successors-on-both-branches', rules: ['RLTP-ACC-5965', 'RLTP-ACC-5967', 'RLTP-ACC-5968'], ops: ['genesis', 'join', 'rot2', 'rot2foreignAfterJoin', 'rot3', 'rot3onForeign'], expect: { status: { [fWin]: 'canonical', [fLose]: 'valid', [succOf[fWin]]: 'canonical', [succOf[fLose]]: 'valid' }, repeat: [], chain: [fWin, succOf[fWin]], head: head(succOf[fWin]), state } },
    { name: 'nested-fork', rules: ['RLTP-ACC-5965', 'RLTP-ACC-5967', 'RLTP-ACC-5968'], ops: ['genesis', 'join', 'rot2', 'rot2foreignAfterJoin', ...nestedKids], expect: { status: { [fWin]: 'canonical', [fLose]: 'valid', [lower(...nestedKids)]: 'canonical', [higher(...nestedKids)]: 'valid' }, repeat: [], chain: [fWin, lower(...nestedKids)], head: head(lower(...nestedKids)), state } },
    { name: 'first-entries-differing-prev', rules: ['RLTP-ACC-5965', 'RLTP-ACC-5968'], ops: ['genesis', 'rot2', 'rot4first'], expect: { status: { [lower('rot2', 'rot4first')]: 'canonical', [higher('rot2', 'rot4first')]: 'valid' }, repeat: [], chain: [lower('rot2', 'rot4first')], head: head(lower('rot2', 'rot4first')), state } },
    { name: 'first-entries-the-walk-reaches-later', rules: ['RLTP-ACC-5965', 'RLTP-ACC-5967'], ops: ['genesis', 'rot2', 'rot3first'], expect: lower('rot2', 'rot3first') === 'rot2' ? { status: { rot2: 'canonical', rot3first: 'canonical' }, repeat: [], chain: ['rot2', 'rot3first'], head: head('rot3first'), state } : { status: { rot2: 'valid', rot3first: 'canonical' }, repeat: [], chain: ['rot3first'], head: head('rot3first'), state } },
    { name: 'rotation-beside-dissolve', rules: ['RLTP-ACC-3325', 'RLTP-ACC-3470', 'RLTP-ACC-5965', 'RLTP-ACC-5968'], ops: ['genesis', 'join', 'rot2', 'dissolve'], expect: { status: { rot2: 'valid' }, repeat: [], chain: [], head: null, state: { terminal: true } } },
    { name: 'rotation-beside-last-member-leave', rules: ['RLTP-ACC-3325', 'RLTP-ACC-3465', 'RLTP-ACC-5965', 'RLTP-ACC-5968'], ops: ['genesis', 'join', 'rot2', 'leaveLast'], expect: { status: { rot2: 'valid' }, repeat: [], chain: [], head: null, state: { terminal: true } } },
    { name: 'last-member-leave-reverted-by-admission', rules: ['RLTP-ACC-3465', 'RLTP-ACC-5840', 'RLTP-ACC-5965'], ops: ['genesis', 'join', 'add', 'rot2', 'leaveLast'], expect: { status: { rot2: 'canonical' }, repeat: [], chain: ['rot2'], head: head('rot2'), state: { ...state, members: [founder.anchor, second].sort() } } },
    { name: 'repeat-beside-dissolve', rules: ['RLTP-ACC-3470', 'RLTP-ACC-5965', 'RLTP-ACC-5966', 'RLTP-ACC-5968'], ops: ['genesis', 'join', 'rot2', 'rot2afterJoin', 'dissolveAfterRot2'], expect: { status: { rot2: 'canonical', rot2afterJoin: 'valid' }, repeat: [], chain: ['rot2'], head: head('rot2'), state: { terminal: true } } },
    { name: 'successor-after-the-merge', rules: ['RLTP-ACC-3325', 'RLTP-ACC-5958', 'RLTP-ACC-5960', 'RLTP-ACC-5962', 'RLTP-ACC-5965', 'RLTP-ACC-5967'], ops: ['genesis', 'join', 'rot2', 'rot2foreignAfterJoin', 'rot3afterMerge'], expect: { status: { [fWin]: 'canonical', [fLose]: 'valid', rot3afterMerge: 'canonical' }, repeat: [], chain: [fWin, 'rot3afterMerge'], head: head('rot3afterMerge'), state } },
  ]
  // self-check against the oracle the runner uses
  const { materializeRotations } = await import('../conformance/access-anchor-rotate.mjs')
  for (const c of cases) {
    const got = await materializeRotations(c.ops.map((l) => ({ label: l, ...ops[l] })), rotationLogOK, commitOf)
    assert(L.jcs(got) === L.jcs(c.expect), `${c.name}: oracle ${L.jcs(got)} ≠ expected ${L.jcs(c.expect)}`)
  }
  W('vectors/access-anchor-rotate.json', {
    source: 'anchor.rotate per RLTP Access Layer 0.57 §5.6 — validity RLTP-ACC-5950, 5955, 5956, 5958, 5960 judged per 5962; canonicity by the walk of 5965, the visited entries canonical (5966), the head admitting by 5967, every other valid one not canonical (5968); the state untouched (5970): the log of a personal community founded under a fresh pair anchor (Access 3.4.1, RLTP-ACC-3235, 3275), whose sole member writes the community anchor’s rotations, each an anchor-rotation@2 of Trust Layer 0.31 §6.5 committing to the generation after its next; the anchors are group/<genesisDigest>[/g] of the oracle IKM of vectors/identity-derivation.json (Identity 0.54 §5.4), the differing ones derive under its second-party IKM, and the other personal community is group/<D\'>[/g] of the oracle IKM. The binding is the sha2-256 multihash over the multikey bytes 0xed 0x01 || 32 key bytes of a generation, u-encoded (Identity 5.4). Generated by scripts/gen-anchor-vectors.mjs from the library; the oracle is conformance/access-anchor-rotate.mjs, the runner re-derives ids, signatures, rotations and bindings with node:crypto. RLTP-ACC-5975 (no export beyond the log) is state-dependent and has no vector; RLTP-ACC-5980 binds the writer, not validity or canonicity, and has none either.',
    format: {
      operations: 'real rltp-access/0.25 envelopes by label (id = oid: + base64url SHA-256 of JCS with id empty and proof omitted; signatures over the same bytes); `add` is a STATE FIXTURE (see its note); `dissolve`, `leaveLast` and `dissolveAfterRot2` are the founder\'s terminal operations on the last-member path (5.4, 5860)',
      cases: 'per case the operations of the log (`ops`, labels) and the expected materialization: status per anchor.rotate (canonical | valid — valid but not canonical, 3345 | invalid), the repeats (JCS-identical bodies of candidates: one entry, its smallest id the representative, the others canonical with no further effect, 5966), the canonical chain (the representatives in walk order), the head (the next anchor of the last canonical entry, null if none), and the state, which no anchor.rotate changes (5970) — { terminal: true } where a terminal operation is canonical',
      order: 'validity per operation against its own ancestor closure (3325, 5962): 5950 (author = the sole member), 5955 (body exactly rotation), 5956 (it verifies under both signatures), 5958 (prev = the next of the lineage head of that closure), 5960 (the binding over next = the commit of that lineage head); 5958 and 5960 are unconstrained where the closure holds no canonical anchor.rotate. Then the dispositions of 3.6, before the walk: a canonical group.dissolve and a last-member member.leave displace every concurrent anchor.rotate (3465, 3470), the leave reverting to an ordinary one when a concurrent canonical admission merges (5840); a displaced operation stays valid. Canonicity over the candidates — the valid operations no disposition displaces — by the walk of 5965: from a virtual root, whose candidates are the first entries (carried by a candidate operation whose ancestor closure holds no canonical anchor.rotate), and then at each chosen head, whose candidates are the entries not yet visited with prev = the head\'s next and the binding over next = the head\'s commit (5967), the candidate with the smaller representative id is visited and becomes the head, until no candidate remains; exactly the visited entries (with their repeats) are canonical (5966), every other valid anchor.rotate stays valid but not canonical (5968)',
    },
    personalCommunity: { genesisDigest: Dpc, founder: pub(founder), founderRelationshipNonce: hexOf(nonce(0x5c)), generations: Object.fromEntries(cg.map((c, i) => [i + 1, pub(c)])), foreignGenerations: { 2: { ...pub(foreign2), note: 'group/<genesisDigest>/2 under the second-party IKM: a different seed' }, 3: { ...pub(foreign3), note: 'group/<genesisDigest>/3 under the second-party IKM' }, 4: { ...pub(foreign4), note: 'group/<genesisDigest>/4 under the second-party IKM' } }, newCommunity: { genesisDigest: Dnew, preimage: 'rltp/vectors/access-anchor-rotate/new-personal-community', generations: { 1: pub(n1), 2: pub(n2) }, note: 'another personal community of the same seed: no binding of this community admits a key of it, so a rotation onto its generation 1 is rejected (Identity 5.4)' }, bindings: Object.fromEntries(cg.map((c, i) => [i + 1, commitOf(c.anchor)])), secondMember: second },
    operations: ops,
    cases,
  })
}
const FILES = 'identity-derivation.json, visibility.json, anchor-rotation.json, group-star.json, access-anchor-rotate.json'
if (CHECK) {
  if (drift.length) { for (const p of drift) console.error(`${p} is not what the generator produces`); process.exit(1) }
  console.log(`anchor vectors reproduce byte for byte: ${FILES}`)
} else console.log(`anchor vectors written: ${FILES}`)
