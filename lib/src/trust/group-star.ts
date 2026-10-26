// trust/group-star — the group star on the holder (lib Stage 2, PR 4b):
// group-star@1 as the registered task group-star/0.1 (5.2b), reconciled
// per recipient over its own domain, baseline and salt sequence (5730,
// 5740), on the machinery of trust/star.ts; the pure forms are the root
// module's (group-star.ts).
//
// Rule numbers: bare four-digit numbers are RLTP-TRU (trust-layer.md).
//
// What it registers (through trustModule, trust/mapping.ts):
//   sweep  trust.groupStar   the reconciliation of 5730 toward every
//                            contact the blinded group star class is on
//                            toward (5760)
//   task   group-star/0.1    (proof absent) reception (5500–5580)
//   ack    group-star/0.1    completion by the acks of every chunk (5740)
//
// The view toward contact c on relationship r (5730): one item per group
// of state.groups that is listed (5420, the per-group switch of 5.2b),
// sorted by group; `sealed` with the own member anchor and memberOp
// exactly when the sealed group star is on for (group, c) — the per-group
// setting first (2830), else the class toward c (2760, 2840) — and r does
// not lag (5430, 6595); otherwise `digest` (the entry's c is filler).
// Zero groups is the empty view: one all-filler group star (5480). A
// change of any of these is divergence toward exactly the contacts whose
// view it alters (5750, 5770, 5800).
//
// Choices this file makes where note and spec leave them open:
//   - 5430's two filler conditions (sealed off for (group, contact), the
//     relationship lags) are the only ones: a listed group carries
//     memberAnchor and memberOp (codec.ts), and a listed group without them
//     where a pair is due is a broken invariant and throws, never filler.
//     memberAnchor must be the anchor of memberLabel; a mismatch throws too
//   - the sealed pair's proof agrees through the KeyProvider with the
//     member label's key-agreement key under a release derived from the
//     group (not from `addresses`: the member key is no delivery address),
//     as the anchor mapping does for the community key
//   - filler and AEAD nonces come from the Entropy port: `pad` for filler
//     d and c, `groupstar.nonce` for sealed pairs
//   - reception tests the union against every group in state.groups (the
//     holder's current groups); steps 4 and 5 of 5560/5570 resolve through
//     the Access port. Without an Access port, or where it does not know
//     the group, a hit is recorded but no pair is accepted
//   - `accepted` keeps the whole assembled union of {d, c} entries and the
//     groups among the holder's that hit (sharedGroups of the contact
//     view). The union stays so a group the holder joins later is matched
//     against the stars it already accepted (groupStarRematch, called by
//     the welcome): the hit, and a sealed pair opened and checked by
//     5530–5570 against the joined group as at completion; a late joiner
//     sees the groups it shares with existing contacts, and their members,
//     without a new star, which the sender has no reason to send
//   - an accepted pair is class V (5580): merged into the relationship's
//     holder-local memory under `groupMembers` as { [G]: { member,
//     memberOp } }, a later accepted pair for G replacing it (5770); it is
//     never republished, carried into a group space or sent anywhere
import type { Json } from '../core.js'
import { xRawOfMk } from '../crypto.js'
import { buildGroupStarWith, groupStarChunkOk, groupStarKeyOf, groupStarUnionOk, openGroupStarWith } from '../group-star.js'
import type { GroupMembership } from '../group-star.js'
import { macU } from '../anchor.js'
import { jcs } from '../core.js'
import type { KeyRelease } from '../ports.js'
import type { PrepareCtx } from '../engine.js'
import type { Contact, Dec, Group, GroupStarItem, HolderState, Relationship, SeqIn } from '../state.js'
import { classOnToward, entryRelationships, lags } from './state.js'
import type { Artifact } from './star.js'
import { TASK_NAMESPACE } from '../task-uri.js'

/** The registered task type that carries group-star@1 (Delivery §4.4, 5740). */
export const GROUP_STAR_TYPE = TASK_NAMESPACE + 'group-star/0.1'

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Whether the sealed group star is on for (group, contact) (2830, 2760). */
export function sealedOn (c: Readonly<Contact>, group: string): boolean {
  const s = Object.hasOwn(c.groupSettings, group) ? c.groupSettings[group] : 'default'
  return s === 'default' ? classOnToward(c, 'sealedGroupStar') : s === 'on'
}

/** The group-star view toward contact c on relationship r (5730). */
export function groupStarView (state: Readonly<HolderState>, c: Readonly<Contact>, rel: Readonly<Relationship>): GroupStarItem[] {
  const lagging = lags(rel, entryRelationships(state, c))
  return Object.values(state.groups).filter((g) => g.listed).sort((a, b) => cmp(a.id, b.id)).map((g): GroupStarItem => {
    if (lagging || !sealedOn(c, g.id)) return { group: g.id, mode: 'digest' }
    if (g.memberAnchor === undefined || g.memberOp === undefined) throw new Error(`trust: listed group ${g.id} lacks memberAnchor or memberOp (5400)`)
    return { group: g.id, mode: 'sealed', member: g.memberAnchor, memberOp: g.memberOp }
  })
}

type GroupAccepted = NonNullable<SeqIn<{ salt: Dec, entries: Array<{ d: string, c: string }>, groups: string[] }>['accepted']>
type Entry = { d: string, c: string }

class Skip extends Error {}

/** The group star as an artifact (5.2b, 5730–5770). */
export const GROUP_STAR: Artifact<GroupStarItem, GroupAccepted> = {
  kind: 'groupStar',
  type: GROUP_STAR_TYPE,
  cls: 'groupStar',
  malformedRef: 'RLTP-TRU-5370',
  out: (t) => t.groupStarOut,
  withOut: (t, o) => ({ ...t, groupStarOut: o }),
  inn: (t) => t.groupStarIn,
  withIn: (t, i) => ({ ...t, groupStarIn: i }),
  view: groupStarView,
  uniform: false,
  async build (ctx, p) {
    const groups: Record<string, Group> = ctx.snapshot.groups
    const theirX = xRawOfMk(p.tuple.counterpartKeyAgreement)
    if (!theirX) return null
    try {
      const { chunks } = await buildGroupStarWith({
        shared: p.shared, sender: p.own, to: p.tuple.counterpartAnchor, salt: p.salt, subtle: ctx.crypto.subtle,
        groups: p.view.map((item) => item.mode === 'digest'
          ? { group: item.group, sealed: false }
          : {
              group: item.group, sealed: true, member: item.member, memberOp: item.memberOp,
              // 5400: the proof under memberX_sender × pairX_recipient
              memberShared: async () => {
                const label = groups[item.group].memberLabel
                const m = await ctx.keys.anchorOf(label)
                if (m.anchor !== item.member) throw new Error(`trust: group ${item.group}: memberAnchor is not the anchor of memberLabel`)
                const release: KeyRelease = (rkid) => (rkid === m.keyAgreement ? { status: 'live', label } : { status: 'unknown' })
                const a = await ctx.keys.agree(m.keyAgreement, theirX, release)
                if (a.status !== 'available') throw new Skip()
                return a.shared
              },
            }),
        draw: (n, kind) => ctx.entropy.bytes(kind === 'nonce' ? 'groupstar.nonce' : 'pad', n),
      })
      return chunks as unknown as Json[]
    } catch (e) {
      if (e instanceof Skip) return null
      throw e
    }
  },
  chunkOk: groupStarChunkOk,
  async macOk (ctx, p) {
    const S = ctx.crypto.subtle
    const kg = await groupStarKeyOf(p.shared, p.from, p.own, p.salt, S)
    const ch = p.chunk as { body: Json, proof: { mac: string } }
    return (await macU(kg, jcs(ch.body), S)) === ch.proof.mac
  },
  entries: (body) => (body as { groups: Json[] }).groups,
  async complete (ctx, p) {
    const union = p.union as Entry[]
    const bad = groupStarUnionOk(union)
    if (bad !== null) return { ok: false, ref: bad === 'order' ? 'RLTP-TRU-5300' : bad === 'size' ? 'RLTP-TRU-5500' : 'RLTP-TRU-5510' }
    // 5520: every group the holder is a current member of, resolved through Access
    const memberships: GroupMembership[] = []
    for (const g of Object.keys(ctx.snapshot.groups).sort()) {
      const ga = ctx.access ? await ctx.access.membership(g) : null
      memberships.push({ group: g, isMember: (a) => ga?.isMember(a) ?? false, resolve: (oid) => ga?.resolve(oid) ?? null })
    }
    const t = p.tuple
    const results = await openGroupStarWith({
      shared: p.shared, from: p.from, own: p.own, salt: p.salt, entries: union, memberships, subtle: ctx.crypto.subtle,
      agreeMember: async (keyAgreement) => {
        const x = xRawOfMk(keyAgreement)
        if (!x) return null
        const a = await ctx.keys.agree(t.rkid, x, ctx.release)
        return a.status === 'available' ? a.shared : null
      },
    })
    const hits = results.filter((r) => r.hit).map((r) => r.group).sort()
    const entries = union
    const pairs = results.filter((r) => r.accepted)
    let memory: Record<string, Json> | undefined
    if (pairs.length) {
      // class V (5580): holder-local, keyed by group
      const held = (p.rel.memory.groupMembers ?? {}) as Record<string, Json>
      const merged: Record<string, Json> = { ...held }
      for (const r of pairs) merged[r.group] = { member: r.member!, memberOp: r.memberOp! }
      memory = { groupMembers: merged }
    }
    return { ok: true, accepted: { salt: p.salt, entries, groups: hits }, ...(memory ? { memory } : {}) }
  },
}

/** One tuple's outcome of the re-match: the hit, and the accepted pair if one opened. */
export interface GroupStarRehit { label: string, member?: string, memberOp?: string }

/**
 * 5520–5580 for a group the holder joins, over the group stars it already
 * accepted: d = HMAC(k_g, G) tested against each stored union, and on a
 * hit the sealed pair opened and checked in the order of 5530–5570
 * against `membership` (the joined group's roster as the welcome carries
 * it), exactly as at a star's completion. k_g and k_e are the accepted
 * star's (its sender, this holder's pair anchor, its salt), through the
 * KeyProvider under the engine's release. Async: the caller prepares it
 * and applies withGroupHits in its commit.
 */
export async function groupStarRematch (ctx: PrepareCtx, membership: GroupMembership): Promise<GroupStarRehit[]> {
  const out: GroupStarRehit[] = []
  for (const r of Object.values(ctx.snapshot.relationships)) {
    for (const t of r.tuples) {
      const acc = t.groupStarIn.accepted
      if (!acc || acc.groups.includes(membership.group)) continue
      const x = xRawOfMk(t.counterpartKeyAgreement)
      if (!x) continue
      const a = await ctx.keys.agree(t.rkid, x, ctx.release)
      if (a.status !== 'available') continue
      const own = (await ctx.keys.anchorOf(t.ownPairLabel)).anchor
      const [res] = await openGroupStarWith({
        shared: a.shared, from: t.counterpartAnchor, own, salt: acc.salt, entries: acc.entries, memberships: [membership], subtle: ctx.crypto.subtle,
        agreeMember: async (keyAgreement) => {
          const mx = xRawOfMk(keyAgreement)
          if (!mx) return null
          const m = await ctx.keys.agree(t.rkid, mx, ctx.release)
          return m.status === 'available' ? m.shared : null
        },
      })
      if (!res?.hit) continue
      out.push(res.accepted ? { label: t.ownPairLabel, member: res.member!, memberOp: res.memberOp! } : { label: t.ownPairLabel })
    }
  }
  return out.sort((p, q) => cmp(p.label, q.label))
}

/** The re-match committed: `group` joins the accepted groups of the hit
 *  tuples, and an accepted pair is merged into its relationship's memory
 *  under `groupMembers` (class V, 5580), as at a star's completion. */
export function withGroupHits (state: HolderState, hits: readonly GroupStarRehit[], group: string): HolderState {
  if (!hits.length) return state
  const byLabel = new Map(hits.map((h) => [h.label, h]))
  const relationships: Record<string, Relationship> = {}
  for (const [id, r] of Object.entries(state.relationships)) {
    if (!r.tuples.some((t) => byLabel.has(t.ownPairLabel))) { relationships[id] = r; continue }
    let memory = r.memory
    const tuples = r.tuples.map((t) => {
      const h = byLabel.get(t.ownPairLabel)
      if (!h || !t.groupStarIn.accepted || t.groupStarIn.accepted.groups.includes(group)) return t
      if (h.member !== undefined) {
        const held = (memory.groupMembers ?? {}) as Record<string, Json>
        memory = { ...memory, groupMembers: { ...held, [group]: { member: h.member, memberOp: h.memberOp! } } }
      }
      return { ...t, groupStarIn: { ...t.groupStarIn, accepted: { ...t.groupStarIn.accepted, groups: [...t.groupStarIn.accepted.groups, group].sort() } } }
    })
    relationships[id] = { ...r, tuples, memory }
  }
  return { ...state, relationships }
}
