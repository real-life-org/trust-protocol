// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
import { xRawOfMk } from '../crypto.js';
import { buildGroupStarWith, groupStarChunkOk, groupStarKeyOf, groupStarUnionOk, openGroupStarWith } from '../group-star.js';
import { macU } from '../anchor.js';
import { jcs } from '../core.js';
import { classOnToward, entryRelationships, lags } from './state.js';
/** The registered task type that carries group-star@1 (Delivery §4.4, 5740). */
export const GROUP_STAR_TYPE = 'https://real-life.org/trust-tasks/group-star/0.1';
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** Whether the sealed group star is on for (group, contact) (2830, 2760). */
export function sealedOn(c, group) {
    const s = Object.hasOwn(c.groupSettings, group) ? c.groupSettings[group] : 'default';
    return s === 'default' ? classOnToward(c, 'sealedGroupStar') : s === 'on';
}
/** The group-star view toward contact c on relationship r (5730). */
export function groupStarView(state, c, rel) {
    const lagging = lags(rel, entryRelationships(state, c));
    return Object.values(state.groups).filter((g) => g.listed).sort((a, b) => cmp(a.id, b.id)).map((g) => {
        if (lagging || !sealedOn(c, g.id))
            return { group: g.id, mode: 'digest' };
        if (g.memberAnchor === undefined || g.memberOp === undefined)
            throw new Error(`trust: listed group ${g.id} lacks memberAnchor or memberOp (5400)`);
        return { group: g.id, mode: 'sealed', member: g.memberAnchor, memberOp: g.memberOp };
    });
}
class Skip extends Error {
}
/** The group star as an artifact (5.2b, 5730–5770). */
export const GROUP_STAR = {
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
    async build(ctx, p) {
        const groups = ctx.snapshot.groups;
        const theirX = xRawOfMk(p.tuple.counterpartKeyAgreement);
        if (!theirX)
            return null;
        try {
            const { chunks } = await buildGroupStarWith({
                shared: p.shared, sender: p.own, to: p.tuple.counterpartAnchor, salt: p.salt, subtle: ctx.crypto.subtle,
                groups: p.view.map((item) => item.mode === 'digest'
                    ? { group: item.group, sealed: false }
                    : {
                        group: item.group, sealed: true, member: item.member, memberOp: item.memberOp,
                        // 5400: the proof under memberX_sender × pairX_recipient
                        memberShared: async () => {
                            const label = groups[item.group].memberLabel;
                            const m = await ctx.keys.anchorOf(label);
                            if (m.anchor !== item.member)
                                throw new Error(`trust: group ${item.group}: memberAnchor is not the anchor of memberLabel`);
                            const release = (rkid) => (rkid === m.keyAgreement ? { status: 'live', label } : { status: 'unknown' });
                            const a = await ctx.keys.agree(m.keyAgreement, theirX, release);
                            if (a.status !== 'available')
                                throw new Skip();
                            return a.shared;
                        },
                    }),
                draw: (n, kind) => ctx.entropy.bytes(kind === 'nonce' ? 'groupstar.nonce' : 'pad', n),
            });
            return chunks;
        }
        catch (e) {
            if (e instanceof Skip)
                return null;
            throw e;
        }
    },
    chunkOk: groupStarChunkOk,
    async macOk(ctx, p) {
        const S = ctx.crypto.subtle;
        const kg = await groupStarKeyOf(p.shared, p.from, p.own, p.salt, S);
        const ch = p.chunk;
        return (await macU(kg, jcs(ch.body), S)) === ch.proof.mac;
    },
    entries: (body) => body.groups,
    async complete(ctx, p) {
        const union = p.union;
        const bad = groupStarUnionOk(union);
        if (bad !== null)
            return { ok: false, ref: bad === 'order' ? 'RLTP-TRU-5300' : bad === 'size' ? 'RLTP-TRU-5500' : 'RLTP-TRU-5510' };
        // 5520: every group the holder is a current member of, resolved through Access
        const memberships = [];
        for (const g of Object.keys(ctx.snapshot.groups).sort()) {
            const ga = ctx.access ? await ctx.access.membership(g) : null;
            memberships.push({ group: g, isMember: (a) => ga?.isMember(a) ?? false, resolve: (oid) => ga?.resolve(oid) ?? null });
        }
        const t = p.tuple;
        const results = await openGroupStarWith({
            shared: p.shared, from: p.from, own: p.own, salt: p.salt, entries: union, memberships, subtle: ctx.crypto.subtle,
            agreeMember: async (keyAgreement) => {
                const x = xRawOfMk(keyAgreement);
                if (!x)
                    return null;
                const a = await ctx.keys.agree(t.rkid, x, ctx.release);
                return a.status === 'available' ? a.shared : null;
            },
        });
        const hits = results.filter((r) => r.hit).map((r) => r.group).sort();
        const entries = union;
        const pairs = results.filter((r) => r.accepted);
        let memory;
        if (pairs.length) {
            // class V (5580): holder-local, keyed by group
            const held = (p.rel.memory.groupMembers ?? {});
            const merged = { ...held };
            for (const r of pairs)
                merged[r.group] = { member: r.member, memberOp: r.memberOp };
            memory = { groupMembers: merged };
        }
        return { ok: true, accepted: { salt: p.salt, entries, groups: hits }, ...(memory ? { memory } : {}) };
    },
};
/**
 * 5520 for a group the holder joins: the tuple labels whose accepted group
 * star's union holds d = HMAC(k_g, G). k_g is the accepted star's key
 * (its sender, this holder's pair anchor and the star's salt), through
 * the KeyProvider under the engine's release. Async: the caller prepares
 * it and applies withGroupHits in its commit.
 */
export async function groupStarRematch(ctx, group) {
    const S = ctx.crypto.subtle;
    const out = [];
    for (const r of Object.values(ctx.snapshot.relationships)) {
        for (const t of r.tuples) {
            const acc = t.groupStarIn.accepted;
            if (!acc || acc.groups.includes(group))
                continue;
            const x = xRawOfMk(t.counterpartKeyAgreement);
            if (!x)
                continue;
            const a = await ctx.keys.agree(t.rkid, x, ctx.release);
            if (a.status !== 'available')
                continue;
            const own = (await ctx.keys.anchorOf(t.ownPairLabel)).anchor;
            const d = await macU(await groupStarKeyOf(a.shared, t.counterpartAnchor, own, acc.salt, S), group, S);
            if (acc.entries.some((e) => e.d === d))
                out.push(t.ownPairLabel);
        }
    }
    return out.sort();
}
/** The hits of groupStarRematch committed: `group` joins the accepted groups of those tuples. */
export function withGroupHits(state, labels, group) {
    if (!labels.length)
        return state;
    const hit = new Set(labels);
    const relationships = {};
    for (const [id, r] of Object.entries(state.relationships)) {
        relationships[id] = r.tuples.some((t) => hit.has(t.ownPairLabel)) ? {
            ...r,
            tuples: r.tuples.map((t) => (hit.has(t.ownPairLabel) && t.groupStarIn.accepted && !t.groupStarIn.accepted.groups.includes(group))
                ? { ...t, groupStarIn: { ...t.groupStarIn, accepted: { ...t.groupStarIn.accepted, groups: [...t.groupStarIn.accepted.groups, group].sort() } } }
                : t),
        } : r;
    }
    return { ...state, relationships };
}
