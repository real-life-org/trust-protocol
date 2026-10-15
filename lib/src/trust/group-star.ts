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
//   - `accepted` keeps the {d, c} entries that hit one of the holder's
//     groups and those groups (sharedGroups of the contact view); the
//     filler and the groups the holder is not in are not retained
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
import type { Contact, Dec, Group, GroupStarItem, HolderState, Relationship, SeqIn } from '../state.js'
import { classOnToward, entryRelationships, lags } from './state.js'
import type { Artifact } from './star.js'

/** The registered task type that carries group-star@1 (Delivery §4.4, 5740). */
export const GROUP_STAR_TYPE = 'https://real-life.org/trust-tasks/group-star/0.1'

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
    const S = ctx.crypto.subtle
    const kg = await groupStarKeyOf(p.shared, p.from, p.own, p.salt, S)
    const hits = results.filter((r) => r.hit).map((r) => r.group).sort()
    const hitD = new Set<string>()
    for (const g of hits) hitD.add(await macU(kg, g, S))
    const entries = union.filter((e) => hitD.has(e.d))
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
