// group-star — the sender's groups, blinded to every contact, sealed to
// the chosen ones (Trust Layer 0.31 §5.2b, task group-star/0.1).
//
// Moved to the root module group-star.ts in lib Stage 2 (PR 4b), where
// the holder's trust module builds on it over raw shared secrets. This
// file keeps the probe's Context-based names, unchanged in behaviour and
// bytes, as thin wrappers for the visibility barrel and the vector
// generator; nothing new is exported here.
//
// Entropy (AEAD nonces, filler) comes from the CALLER's `rand`, so the
// vectors replay.
import { xRawOfMk, ecdh, rand as cryptoRand } from '../crypto.js'
import type { Context } from '../identity.js'
import {
  GROUP_STAR_PAD, GROUP_STAR_CHUNK, groupStarKeyOf, groupSealKeyOf, buildGroupPairWith, buildGroupStarWith,
  assembleGroupStarWith, openGroupStarWith,
} from '../group-star.js'
import type { GroupMembership, GroupStarResult } from '../group-star.js'

export { GROUP_STAR_PAD, GROUP_STAR_CHUNK }
export type { GroupMembership, GroupStarResult }

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
  /** the entropy source (nonces, filler); defaults to the platform CSPRNG */
  rand?: (n: number) => Uint8Array
}
/** The chunks of one group-star delivery toward one recipient. */
export async function buildGroupStar (i: GroupStarInput) {
  const rnd = i.rand ?? cryptoRand
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
