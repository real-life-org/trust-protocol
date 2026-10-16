// group-star — group-star@1, the sender's groups blinded to every
// contact and sealed to the chosen ones (Trust Layer 0.31 §5.2b, task
// group-star/0.1): the pure wire constructions over raw X25519 shared
// secrets (lib Stage 2, PR 4b).
//
// Byte-identical with vectors/group-star.json (check:generators:lib). The
// holder's trust module (trust/group-star.ts) builds on these functions
// with secrets from its KeyProvider.
//
//   k_g    = HKDF(X25519(pairX_sender, pairX_recipient),
//                 "rltp/visibility/blind/group-star/" || senderPair || "/" || recipientPair || "/" || salt)
//   k_e(G) = HKDF(same ikm,
//                 "rltp/visibility/seal/group-star/" || senderPair || "/" || recipientPair || "/" || salt || "/" || G)
//   entry  = { d: HMAC(k_g, UTF-8 of G), c: AES-256-GCM(k_e(G), nonce, AAD = bytes of d, JCS(group-pair@1)) }
//   proof  = { mac: HMAC(k_g, JCS(body)) }
//   group-pair@1 = { type, group, member, memberOp, to, salt, proof },
//     proof = HMAC(HKDF(ECDH(memberX_sender, pairX_recipient), "rltp/visibility/mac/group-pair"), JCS(pair without proof))
//
// A `c` that is not a real pair is FILLER: random bytes of exactly the
// length a real c has in this star. The list is padded with filler
// entries to the next multiple of 16 (an empty list to 16: the all-
// filler star), sorted by d once, and sliced in order into chunks of at
// most 64 (5.2a). Entropy comes from the caller's `draw`, by kind, so
// vectors replay; this module draws none itself.
import { jcs, makeValidator } from './core.js'
import { SCHEMAS } from './schemas.js'
import { b64uOf, ecdh, fromB64u, hkdf, platformSubtle, xRawOfMk } from './crypto.js'
import type { Context } from './identity.js'
import { macU } from './anchor.js'

const te = new TextEncoder()
const td = new TextDecoder('utf-8', { fatal: true })
const VAL = makeValidator(SCHEMAS)
const schemaOk = (file: string, data: unknown): boolean => VAL.validate(data, SCHEMAS[file]!, SCHEMAS[file]!).length === 0

/** Entries are padded to the next positive multiple of this (§5.2b). */
export const GROUP_STAR_PAD = 16
/**
 * Chunks hold at most 64 entries (§5.2b): a real entry is about 570
 * bytes JCS, so a full chunk stays well inside the Delivery Contract's
 * 65 536-byte plaintext bound at the longest salt.
 */
export const GROUP_STAR_CHUNK = 64
const NONCE = 12
const TAG = 16

/** The kinds of randomness a group star draws: AEAD nonces of sealed
 *  pairs, and filler (d and c of filler entries, c of unsealed ones). */
export type GroupStarRandKind = 'nonce' | 'filler'
/** The caller's entropy: n fresh bytes of one kind. */
export type GroupStarDraw = (n: number, kind: GroupStarRandKind) => Uint8Array

const isZero = (b: Uint8Array): boolean => b.every((x) => x === 0)

/** k_g of one direction from the pair secret: `sender` and `recipient` are the two pair anchors, salt in its wire string form. */
export async function groupStarKeyOf (shared: Uint8Array, sender: string, recipient: string, salt: string, subtle: SubtleCrypto = platformSubtle()): Promise<Uint8Array> {
  if (isZero(shared)) throw new Error('all-zero shared secret (Trust §2.1)')
  return hkdf(shared, `rltp/visibility/blind/group-star/${sender}/${recipient}/${salt}`, 32, subtle)
}
/** k_e(G) from the pair secret: the sealing key of one group's entry; G is the canonical u form of the genesis digest. */
export async function groupSealKeyOf (shared: Uint8Array, sender: string, recipient: string, salt: string, group: string, subtle: SubtleCrypto = platformSubtle()): Promise<Uint8Array> {
  if (isZero(shared)) throw new Error('all-zero shared secret (Trust §2.1)')
  return hkdf(shared, `rltp/visibility/seal/group-star/${sender}/${recipient}/${salt}/${group}`, 32, subtle)
}

// ── AEAD (§2.1): AES-256-GCM, 128-bit tag, 96-bit nonce; u + base64url(nonce || ct || tag) ──
async function seal (key: Uint8Array, aad: string, plaintext: string, nonce: Uint8Array, S: SubtleCrypto): Promise<string> {
  const k = await S.importKey('raw', key, 'AES-GCM', false, ['encrypt'])
  const ct = new Uint8Array(await S.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: te.encode(aad), tagLength: 128 }, k, te.encode(plaintext)))
  const out = new Uint8Array(NONCE + ct.length); out.set(nonce); out.set(ct, NONCE)
  return 'u' + b64uOf(out)
}
async function open (key: Uint8Array, aad: string, c: string, S: SubtleCrypto): Promise<string | null> {
  try {
    const raw = fromB64u(c.slice(1))
    if (raw.length <= NONCE + TAG) return null
    const k = await S.importKey('raw', key, 'AES-GCM', false, ['decrypt'])
    const pt = await S.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, NONCE), additionalData: te.encode(aad), tagLength: 128 }, k, raw.subarray(NONCE))
    return td.decode(pt)
  } catch { return null }
}

// ── group-pair@1 ────────────────────────────────────────────────────────
export interface GroupPairFields {
  /** the genesis digest G, canonical u form */
  group: string
  /** the sender's member anchor in G (for a founder: its founding pair anchor) */
  member: string
  /** oid: of the canonical admission of member, or of the genesis where the sender founded G */
  memberOp: string
  to: string
  salt: string
}
/** The opened body of a sealed entry; `memberShared` = X25519(memberX_sender, pairX_recipient). */
export async function buildGroupPairWith (i: GroupPairFields, memberShared: Uint8Array, subtle: SubtleCrypto = platformSubtle()) {
  if (isZero(memberShared)) throw new Error('all-zero shared secret (Trust §2.1)')
  const unproved = { type: 'group-pair@1', group: i.group, member: i.member, memberOp: i.memberOp, to: i.to, salt: i.salt }
  const k = await hkdf(memberShared, 'rltp/visibility/mac/group-pair', 32, subtle)
  return { ...unproved, proof: await macU(k, jcs(unproved), subtle) }
}
// every field of a group pair but salt has a fixed length on the wire
// (did:key 56, digest 47, oid 47, mac 44), so a real c's length is a
// function of the salt alone — the filler length of this star
const sealedLength = (to: string, salt: string): number => NONCE + TAG + te.encode(jcs({
  type: 'group-pair@1', group: 'u' + 'A'.repeat(46), member: to, memberOp: 'oid:' + 'A'.repeat(43), to, salt, proof: 'u' + 'A'.repeat(43),
})).length

// ── the sender ──────────────────────────────────────────────────────────
export interface GroupStarEntryInput {
  group: string
  /** a real sealed pair; otherwise c is filler */
  sealed: boolean
  /** the sender's member anchor in G (sealed only) */
  member?: string
  memberOp?: string
  /** X25519(memberX_sender, pairX_recipient), asked for only when sealed */
  memberShared?: () => Promise<Uint8Array>
}
export interface GroupStarWithInput {
  /** X25519(pairX_sender, pairX_recipient) */
  shared: Uint8Array
  /** the sender's pair anchor */
  sender: string
  /** the recipient's pair anchor */
  to: string
  salt: string
  /** every group the sender lists toward this recipient */
  groups: GroupStarEntryInput[]
  draw: GroupStarDraw
  subtle?: SubtleCrypto
}
export type GroupStarChunk = { body: { type: 'group-star@1', salt: string, seq: string, last: boolean, groups: { d: string, c: string }[] }, proof: { mac: string } }

/** The chunks of one group-star delivery toward one recipient. */
export async function buildGroupStarWith (i: GroupStarWithInput): Promise<{ chunks: GroupStarChunk[] }> {
  const S = i.subtle ?? platformSubtle()
  const kg = await groupStarKeyOf(i.shared, i.sender, i.to, i.salt, S)
  const cLen = sealedLength(i.to, i.salt)
  const ds = new Set<string>(), cs = new Set<string>()
  const entries: { d: string, c: string }[] = []
  const fillerC = (): string => { for (;;) { const c = 'u' + b64uOf(i.draw(cLen, 'filler')); if (!cs.has(c)) return c } }
  for (const g of i.groups) {
    const d = await macU(kg, g.group, S)
    if (ds.has(d)) continue                     // one entry per group
    let c: string
    if (g.sealed) {
      if (!g.member || !g.memberOp || !g.memberShared) throw new Error('a sealed group pair needs member and memberOp')
      const pair = await buildGroupPairWith({ group: g.group, member: g.member, memberOp: g.memberOp, to: i.to, salt: i.salt }, await g.memberShared(), S)
      c = await seal(await groupSealKeyOf(i.shared, i.sender, i.to, i.salt, g.group, S), d, jcs(pair), i.draw(NONCE, 'nonce'), S)
      if (c.length !== 'u'.length + Math.ceil(cLen * 4 / 3)) throw new Error('group pair of unexpected length — filler would be distinguishable')
    } else c = fillerC()
    ds.add(d); cs.add(c); entries.push({ d, c })
  }
  const target = Math.max(GROUP_STAR_PAD, Math.ceil(entries.length / GROUP_STAR_PAD) * GROUP_STAR_PAD)
  while (entries.length < target) {
    let d: string
    do d = 'u' + b64uOf(i.draw(32, 'filler')); while (ds.has(d))   // collisions with any value are resampled
    const c = fillerC()
    ds.add(d); cs.add(c); entries.push({ d, c })
  }
  entries.sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : 0))
  const n = Math.ceil(entries.length / GROUP_STAR_CHUNK)
  const chunks: GroupStarChunk[] = []
  for (let k = 0; k < n; k++) {
    const body = { type: 'group-star@1' as const, salt: i.salt, seq: String(k + 1), last: k === n - 1, groups: entries.slice(k * GROUP_STAR_CHUNK, (k + 1) * GROUP_STAR_CHUNK) }
    chunks.push({ body, proof: { mac: await macU(kg, jcs(body), S) } })
  }
  return { chunks }
}

// ── the recipient ───────────────────────────────────────────────────────

/** Is this a schema-valid group-star@1 chunk (visibility-group-star.schema.json)? */
export const groupStarChunkOk = (chunk: unknown): boolean => schemaOk('visibility-group-star.schema.json', chunk)

/** The §5.2b checks of a completed union: a positive multiple of 16
 *  entries, strictly ascending by d, every c of the same length. */
export function groupStarUnionOk (entries: readonly { d: string, c: string }[]): 'order' | 'size' | 'c length' | null {
  if (!entries.every((e, k) => k === 0 || entries[k - 1]!.d < e.d)) return 'order'
  if (entries.length === 0 || entries.length % GROUP_STAR_PAD !== 0) return 'size'
  if (entries.some((e) => e.c.length !== entries[0]!.c.length)) return 'c length'
  return null
}

/**
 * One delivery's chunks → its entry union (5.2a under the group star's
 * own salt): every chunk schema-valid and MAC-valid under k_g of the
 * arrival tuple, one salt, seq 1..n each once, exactly the n-th last,
 * the union strictly ascending by d — and the §5.2b reception rules on
 * the completed assembly: a positive multiple of 16 entries, every c of
 * the same length. A failing assembly rejects the delivery.
 */
export async function assembleGroupStarWith (i: { shared: () => Promise<Uint8Array>, from: string, own: string, chunks: any[], subtle?: SubtleCrypto }): Promise<{ ok: true, salt: string, entries: { d: string, c: string }[] } | { ok: false, reason: string }> {
  const S = i.subtle ?? platformSubtle()
  if (!Array.isArray(i.chunks) || !i.chunks.length) return { ok: false, reason: 'no chunk' }
  for (const ch of i.chunks) if (!groupStarChunkOk(ch)) return { ok: false, reason: 'schema' }
  const salt = i.chunks[0].body.salt
  if (i.chunks.some((ch) => ch.body.salt !== salt)) return { ok: false, reason: 'salt' }
  let kg: Uint8Array
  try { kg = await groupStarKeyOf(await i.shared(), i.from, i.own, salt, S) } catch { return { ok: false, reason: 'ecdh' } }
  for (const ch of i.chunks) if ((await macU(kg, jcs(ch.body), S)) !== ch.proof.mac) return { ok: false, reason: 'mac' }
  const bySeq = new Map<string, any>()
  for (const ch of i.chunks) { if (bySeq.has(ch.body.seq)) return { ok: false, reason: 'seq repeated' }; bySeq.set(ch.body.seq, ch.body) }
  const lasts = i.chunks.filter((ch) => ch.body.last)
  if (lasts.length !== 1) return { ok: false, reason: 'last' }
  const n = Number(lasts[0].body.seq)
  if (bySeq.size !== n) return { ok: false, reason: 'incomplete' }
  const entries: { d: string, c: string }[] = []
  for (let k = 1; k <= n; k++) { const b = bySeq.get(String(k)); if (!b) return { ok: false, reason: 'incomplete' }; entries.push(...b.groups) }
  const bad = groupStarUnionOk(entries)
  if (bad !== null) return { ok: false, reason: bad }
  return { ok: true, salt, entries }
}

/** A group the recipient is a CURRENT member of, with its materialized state. */
export interface GroupMembership {
  group: string
  /** is this anchor a current member of the recipient's materialized state of the group? */
  isMember: (anchor: string) => boolean
  /** the canonical admission (or the genesis) an oid: names: its subject (genesis: body.members[0]) and its card's key-agreement key */
  resolve: (oid: string) => { subject: string, keyAgreement: string } | null
}
export interface GroupStarResult { group: string, hit: boolean, opened: boolean, accepted: boolean, member?: string, memberOp?: string, reason?: string }

/**
 * Reception (§5.2b): for each group the recipient is a current member
 * of, compute d and test the union; on a hit derive k_e(G) and try to
 * open c — a c that does not open is a miss, not an error. An opened
 * pair is accepted only if, in order: schema · group = G · to = the
 * own pair anchor and salt = the assembly's · memberOp names a
 * canonical admission of member (or the genesis) and member is current
 * · the MAC verifies under that operation's card key, non-zero ECDH
 * (`agreeMember(cardKeyAgreement)` = X25519(own pairX, that key), null
 * where it cannot agree). An accepted pair is class V: merged
 * holder-locally, never republished.
 */
export async function openGroupStarWith (i: {
  shared: Uint8Array, from: string, own: string, salt: string, entries: { d: string, c: string }[], memberships: GroupMembership[],
  agreeMember: (keyAgreement: string) => Promise<Uint8Array | null>, subtle?: SubtleCrypto,
}): Promise<GroupStarResult[]> {
  const S = i.subtle ?? platformSubtle()
  const kg = await groupStarKeyOf(i.shared, i.from, i.own, i.salt, S)
  const byD = new Map(i.entries.map((e) => [e.d, e.c]))
  const out: GroupStarResult[] = []
  for (const m of i.memberships) {
    const d = await macU(kg, m.group, S)
    const c = byD.get(d)
    if (c === undefined) { out.push({ group: m.group, hit: false, opened: false, accepted: false }); continue }
    const pt = await open(await groupSealKeyOf(i.shared, i.from, i.own, i.salt, m.group, S), d, c, S)
    if (pt === null) { out.push({ group: m.group, hit: true, opened: false, accepted: false }); continue }
    const reject = (reason: string) => out.push({ group: m.group, hit: true, opened: true, accepted: false, reason })
    let pair: any
    try { pair = JSON.parse(pt) } catch { reject('schema'); continue }
    if (!schemaOk('visibility-group-pair.schema.json', pair)) { reject('schema'); continue }
    if (pair.group !== m.group) { reject('group'); continue }
    if (pair.to !== i.own || pair.salt !== i.salt) { reject('to'); continue }
    const op = m.resolve(pair.memberOp)
    if (!op || op.subject !== pair.member || !m.isMember(pair.member)) { reject('member'); continue }
    const sh = await i.agreeMember(op.keyAgreement)
    if (!sh || isZero(sh)) { reject('mac'); continue }
    const { proof, ...unproved } = pair
    if ((await macU(await hkdf(sh, 'rltp/visibility/mac/group-pair', 32, S), jcs(unproved), S)) !== proof) { reject('mac'); continue }
    out.push({ group: m.group, hit: true, opened: true, accepted: true, member: pair.member, memberOp: pair.memberOp })
  }
  return out
}

// ── over identity Contexts ─────────────────────────────────────────────
// The same constructions with the private keys of identity Contexts (the
// form vectors, generators and tests use); the holder goes through the
// *With forms with secrets from its KeyProvider. Entropy (AEAD nonces,
// filler) is the caller's `rand`, so the vectors replay.

const shared = async (own: Context, peerKeyAgreement: string): Promise<Uint8Array> => {
  const x = xRawOfMk(peerKeyAgreement)
  if (!x) throw new Error('peer key agreement is not a multikey')
  const sh = await ecdh(own.x.priv, x)
  if (sh.every((b) => b === 0)) throw new Error('all-zero shared secret (Trust §2.1)')   // rejected before key derivation
  return sh
}
/** k_g of one direction: `sender` and `recipient` are the two pair anchors, salt in its wire string form. */
export async function groupStarKey (own: Context, peerKeyAgreement: string, sender: string, recipient: string, salt: string): Promise<Uint8Array> {
  return groupStarKeyOf(await shared(own, peerKeyAgreement), sender, recipient, salt)
}
/** k_e(G): the sealing key of one group's entry; G is the canonical u form of the genesis digest. */
export async function groupSealKey (own: Context, peerKeyAgreement: string, sender: string, recipient: string, salt: string, group: string): Promise<Uint8Array> {
  return groupSealKeyOf(await shared(own, peerKeyAgreement), sender, recipient, salt, group)
}

// ── group-pair@1 ────────────────────────────────────────────────────────
export interface GroupPairInput {
  /** the genesis digest G, canonical u form */
  group: string
  /** the sender's member context in G (for a founder: its founding pair context) */
  member: Context
  /** oid: of the canonical admission of member, or of the genesis where the sender founded G */
  memberOp: string
  to: string
  toKeyAgreement: string
  salt: string
}
/** The opened body of a sealed entry; proof under memberX × pairX of the recipient. */
export async function buildGroupPair (i: GroupPairInput) {
  return buildGroupPairWith({ group: i.group, member: i.member.anchor, memberOp: i.memberOp, to: i.to, salt: i.salt }, await shared(i.member, i.toKeyAgreement))
}

// ── the sender ──────────────────────────────────────────────────────────
export interface GroupStarGroup {
  group: string
  /** a real sealed pair (the recipient is trusted, or this group is switched on for it); otherwise c is filler */
  sealed: boolean
  member?: Context
  memberOp?: string
}
export interface GroupStarInput {
  /** the sender's pair context of the relationship */
  own: Context
  to: string
  toKeyAgreement: string
  salt: string
  /** every group the sender lists toward this recipient (its current groups not switched off) */
  groups: GroupStarGroup[]
  /** the entropy source (nonces, filler): the caller's, so vectors replay */
  rand: (n: number) => Uint8Array
}
/** The chunks of one group-star delivery toward one recipient. */
export async function buildGroupStar (i: GroupStarInput) {
  const rnd = i.rand
  return buildGroupStarWith({
    shared: await shared(i.own, i.toKeyAgreement), sender: i.own.anchor, to: i.to, salt: i.salt,
    groups: i.groups.map((g) => ({
      group: g.group, sealed: g.sealed, member: g.member?.anchor, memberOp: g.memberOp,
      memberShared: g.member ? () => shared(g.member!, i.toKeyAgreement) : undefined,
    })),
    draw: (n) => rnd(n),
  })
}

// ── the recipient ───────────────────────────────────────────────────────
/**
 * One delivery's chunks → its entry union (5.2a under the group star's
 * own salt): every chunk schema-valid and MAC-valid under k_g of the
 * arrival tuple, one salt, seq 1..n each once, exactly the n-th last,
 * the union strictly ascending by d — and the §5.2b reception rules on
 * the completed assembly: a positive multiple of 16 entries, every c of
 * the same length. A failing assembly rejects the delivery.
 */
export async function assembleGroupStar (i: { own: Context, from: string, fromKeyAgreement: string, chunks: any[] }): Promise<{ ok: true, salt: string, entries: { d: string, c: string }[] } | { ok: false, reason: string }> {
  return assembleGroupStarWith({ shared: () => shared(i.own, i.fromKeyAgreement), from: i.from, own: i.own.anchor, chunks: i.chunks })
}

/**
 * Reception (§5.2b): for each group the recipient is a current member
 * of, compute d and test the union; on a hit derive k_e(G) and try to
 * open c — a c that does not open is a miss, not an error. An opened
 * pair is accepted only if, in order: schema · group = G · to = the
 * own pair anchor and salt = the assembly's · memberOp names a
 * canonical admission of member (or the genesis) and member is current
 * · the MAC verifies under that operation's card key, non-zero ECDH.
 * An accepted pair is class V: merged holder-locally, never republished.
 */
export async function openGroupStar (i: { own: Context, from: string, fromKeyAgreement: string, salt: string, entries: { d: string, c: string }[], memberships: GroupMembership[] }): Promise<GroupStarResult[]> {
  const res = await openGroupStarWith({
    shared: await shared(i.own, i.fromKeyAgreement), from: i.from, own: i.own.anchor, salt: i.salt, entries: i.entries, memberships: i.memberships,
    agreeMember: async (keyAgreement) => {
      const memberX = xRawOfMk(keyAgreement)
      return memberX ? ecdh(i.own.x.priv, memberX) : null
    },
  })
  return res.map(({ memberOp: _, ...r }) => r)
}
