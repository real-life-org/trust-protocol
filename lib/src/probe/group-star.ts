// group-star — the sender's groups, blinded to every contact, sealed to
// the chosen ones (Network Visibility 0.30 §5.2b, task group-star/0.1).
//
// Pure constructions over identity Contexts; entropy (AEAD nonces,
// filler) comes from the CALLER's `rand`, so the vectors replay.
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
// most 64 (5.2a).
import { jcs, makeValidator } from '../core.js'
import { SCHEMAS } from '../schemas.js'
import { b64uOf, fromB64u, xRawOfMk, ecdh, hkdf, rand as cryptoRand } from '../crypto.js'
import type { Context } from '../identity.js'
import { macU } from './anchor.js'

const te = new TextEncoder()
const td = new TextDecoder('utf-8', { fatal: true })
const S = globalThis.crypto.subtle
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

const shared = async (own: Context, peerKeyAgreement: string): Promise<Uint8Array> => {
  const x = xRawOfMk(peerKeyAgreement)
  if (!x) throw new Error('peer key agreement is not a multikey')
  const sh = await ecdh(own.x.priv, x)
  if (sh.every((b) => b === 0)) throw new Error('all-zero shared secret (Visibility §2.1)')   // rejected before key derivation
  return sh
}
/** k_g of one direction: `sender` and `recipient` are the two pair anchors, salt in its wire string form. */
export async function groupStarKey (own: Context, peerKeyAgreement: string, sender: string, recipient: string, salt: string): Promise<Uint8Array> {
  return hkdf(await shared(own, peerKeyAgreement), `rltp/visibility/blind/group-star/${sender}/${recipient}/${salt}`)
}
/** k_e(G): the sealing key of one group's entry; G is the canonical u form of the genesis digest. */
export async function groupSealKey (own: Context, peerKeyAgreement: string, sender: string, recipient: string, salt: string, group: string): Promise<Uint8Array> {
  return hkdf(await shared(own, peerKeyAgreement), `rltp/visibility/seal/group-star/${sender}/${recipient}/${salt}/${group}`)
}

// ── AEAD (§2.1): AES-256-GCM, 128-bit tag, 96-bit nonce; u + base64url(nonce || ct || tag) ──
async function seal (key: Uint8Array, aad: string, plaintext: string, nonce: Uint8Array): Promise<string> {
  const k = await S.importKey('raw', key, 'AES-GCM', false, ['encrypt'])
  const ct = new Uint8Array(await S.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: te.encode(aad), tagLength: 128 }, k, te.encode(plaintext)))
  const out = new Uint8Array(NONCE + ct.length); out.set(nonce); out.set(ct, NONCE)
  return 'u' + b64uOf(out)
}
async function open (key: Uint8Array, aad: string, c: string): Promise<string | null> {
  try {
    const raw = fromB64u(c.slice(1))
    if (raw.length <= NONCE + TAG) return null
    const k = await S.importKey('raw', key, 'AES-GCM', false, ['decrypt'])
    const pt = await S.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, NONCE), additionalData: te.encode(aad), tagLength: 128 }, k, raw.subarray(NONCE))
    return td.decode(pt)
  } catch { return null }
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
  const unproved = { type: 'group-pair@1', group: i.group, member: i.member.anchor, memberOp: i.memberOp, to: i.to, salt: i.salt }
  const k = await hkdf(await shared(i.member, i.toKeyAgreement), 'rltp/visibility/mac/group-pair')
  return { ...unproved, proof: await macU(k, jcs(unproved)) }
}
// every field of a group pair but salt has a fixed length on the wire
// (did:key 56, digest 47, oid 47, mac 44), so a real c's length is a
// function of the salt alone — the filler length of this star
const sealedLength = (to: string, salt: string): number => NONCE + TAG + te.encode(jcs({
  type: 'group-pair@1', group: 'u' + 'A'.repeat(46), member: to, memberOp: 'oid:' + 'A'.repeat(43), to, salt, proof: 'u' + 'A'.repeat(43),
})).length

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
  /** the entropy source (nonces, filler); defaults to the platform CSPRNG */
  rand?: (n: number) => Uint8Array
}
/** The chunks of one group-star delivery toward one recipient. */
export async function buildGroupStar (i: GroupStarInput) {
  const rnd = i.rand ?? cryptoRand
  const kg = await groupStarKey(i.own, i.toKeyAgreement, i.own.anchor, i.to, i.salt)
  const cLen = sealedLength(i.to, i.salt)
  const ds = new Set<string>(), cs = new Set<string>()
  const entries: { d: string, c: string }[] = []
  const fillerC = (): string => { for (;;) { const c = 'u' + b64uOf(rnd(cLen)); if (!cs.has(c)) return c } }
  for (const g of i.groups) {
    const d = await macU(kg, g.group)
    if (ds.has(d)) continue                     // one entry per group
    let c: string
    if (g.sealed) {
      if (!g.member || !g.memberOp) throw new Error('a sealed group pair needs member and memberOp')
      const pair = await buildGroupPair({ group: g.group, member: g.member, memberOp: g.memberOp, to: i.to, toKeyAgreement: i.toKeyAgreement, salt: i.salt })
      c = await seal(await groupSealKey(i.own, i.toKeyAgreement, i.own.anchor, i.to, i.salt, g.group), d, jcs(pair), rnd(NONCE))
      if (c.length !== 'u'.length + Math.ceil(cLen * 4 / 3)) throw new Error('group pair of unexpected length — filler would be distinguishable')
    } else c = fillerC()
    ds.add(d); cs.add(c); entries.push({ d, c })
  }
  const target = Math.max(GROUP_STAR_PAD, Math.ceil(entries.length / GROUP_STAR_PAD) * GROUP_STAR_PAD)
  while (entries.length < target) {
    let d: string
    do d = 'u' + b64uOf(rnd(32)); while (ds.has(d))   // collisions with any value are resampled
    const c = fillerC()
    ds.add(d); cs.add(c); entries.push({ d, c })
  }
  entries.sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : 0))
  const n = Math.ceil(entries.length / GROUP_STAR_CHUNK)
  const chunks = []
  for (let k = 0; k < n; k++) {
    const body = { type: 'group-star@1', salt: i.salt, seq: String(k + 1), last: k === n - 1, groups: entries.slice(k * GROUP_STAR_CHUNK, (k + 1) * GROUP_STAR_CHUNK) }
    chunks.push({ body, proof: { mac: await macU(kg, jcs(body)) } })
  }
  return { chunks }
}

// ── the recipient ───────────────────────────────────────────────────────
/**
 * One delivery's chunks → its entry union (5.2a under the group star's
 * own salt): every chunk schema-valid and MAC-valid under k_g of the
 * arrival tuple, one salt, seq 1..n each once, exactly the n-th last,
 * the union strictly ascending by d.
 */
export async function assembleGroupStar (i: { own: Context, from: string, fromKeyAgreement: string, chunks: any[] }): Promise<{ ok: true, salt: string, entries: { d: string, c: string }[] } | { ok: false, reason: string }> {
  if (!Array.isArray(i.chunks) || !i.chunks.length) return { ok: false, reason: 'no chunk' }
  for (const ch of i.chunks) if (!schemaOk('visibility-group-star.schema.json', ch)) return { ok: false, reason: 'schema' }
  const salt = i.chunks[0].body.salt
  if (i.chunks.some((ch) => ch.body.salt !== salt)) return { ok: false, reason: 'salt' }
  let kg: Uint8Array
  try { kg = await groupStarKey(i.own, i.fromKeyAgreement, i.from, i.own.anchor, salt) } catch { return { ok: false, reason: 'ecdh' } }
  for (const ch of i.chunks) if ((await macU(kg, jcs(ch.body))) !== ch.proof.mac) return { ok: false, reason: 'mac' }
  const bySeq = new Map<string, any>()
  for (const ch of i.chunks) { if (bySeq.has(ch.body.seq)) return { ok: false, reason: 'seq repeated' }; bySeq.set(ch.body.seq, ch.body) }
  const lasts = i.chunks.filter((ch) => ch.body.last)
  if (lasts.length !== 1) return { ok: false, reason: 'last' }
  const n = Number(lasts[0].body.seq)
  if (bySeq.size !== n) return { ok: false, reason: 'incomplete' }
  const entries: { d: string, c: string }[] = []
  for (let k = 1; k <= n; k++) { const b = bySeq.get(String(k)); if (!b) return { ok: false, reason: 'incomplete' }; entries.push(...b.groups) }
  if (!entries.every((e, k) => k === 0 || entries[k - 1]!.d < e.d)) return { ok: false, reason: 'order' }
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
export interface GroupStarResult { group: string, hit: boolean, opened: boolean, accepted: boolean, member?: string, reason?: string }

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
  const kg = await groupStarKey(i.own, i.fromKeyAgreement, i.from, i.own.anchor, i.salt)
  const byD = new Map(i.entries.map((e) => [e.d, e.c]))
  const out: GroupStarResult[] = []
  for (const m of i.memberships) {
    const d = await macU(kg, m.group)
    const c = byD.get(d)
    if (c === undefined) { out.push({ group: m.group, hit: false, opened: false, accepted: false }); continue }
    const pt = await open(await groupSealKey(i.own, i.fromKeyAgreement, i.from, i.own.anchor, i.salt, m.group), d, c)
    if (pt === null) { out.push({ group: m.group, hit: true, opened: false, accepted: false }); continue }
    const reject = (reason: string) => out.push({ group: m.group, hit: true, opened: true, accepted: false, reason })
    let pair: any
    try { pair = JSON.parse(pt) } catch { reject('schema'); continue }
    if (!schemaOk('visibility-group-pair.schema.json', pair)) { reject('schema'); continue }
    if (pair.group !== m.group) { reject('group'); continue }
    if (pair.to !== i.own.anchor || pair.salt !== i.salt) { reject('to'); continue }
    const op = m.resolve(pair.memberOp)
    if (!op || op.subject !== pair.member || !m.isMember(pair.member)) { reject('member'); continue }
    const memberX = xRawOfMk(op.keyAgreement)
    if (!memberX) { reject('mac'); continue }
    const sh = await ecdh(i.own.x.priv, memberX)
    if (sh.every((b) => b === 0)) { reject('mac'); continue }
    const { proof, ...unproved } = pair
    if ((await macU(await hkdf(sh, 'rltp/visibility/mac/group-pair'), jcs(unproved))) !== proof) { reject('mac'); continue }
    out.push({ group: m.group, hit: true, opened: true, accepted: true, member: pair.member })
  }
  return out
}
