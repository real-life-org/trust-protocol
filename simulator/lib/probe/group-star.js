// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
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
import { xRawOfMk, ecdh, rand as cryptoRand } from '../crypto.js';
import { GROUP_STAR_PAD, GROUP_STAR_CHUNK, groupStarKeyOf, groupSealKeyOf, buildGroupPairWith, buildGroupStarWith, assembleGroupStarWith, openGroupStarWith, } from '../group-star.js';
export { GROUP_STAR_PAD, GROUP_STAR_CHUNK };
const shared = async (own, peerKeyAgreement) => {
    const x = xRawOfMk(peerKeyAgreement);
    if (!x)
        throw new Error('peer key agreement is not a multikey');
    const sh = await ecdh(own.x.priv, x);
    if (sh.every((b) => b === 0))
        throw new Error('all-zero shared secret (Trust §2.1)'); // rejected before key derivation
    return sh;
};
/** k_g of one direction: `sender` and `recipient` are the two pair anchors, salt in its wire string form. */
export async function groupStarKey(own, peerKeyAgreement, sender, recipient, salt) {
    return groupStarKeyOf(await shared(own, peerKeyAgreement), sender, recipient, salt);
}
/** k_e(G): the sealing key of one group's entry; G is the canonical u form of the genesis digest. */
export async function groupSealKey(own, peerKeyAgreement, sender, recipient, salt, group) {
    return groupSealKeyOf(await shared(own, peerKeyAgreement), sender, recipient, salt, group);
}
/** The opened body of a sealed entry; proof under memberX × pairX of the recipient. */
export async function buildGroupPair(i) {
    return buildGroupPairWith({ group: i.group, member: i.member.anchor, memberOp: i.memberOp, to: i.to, salt: i.salt }, await shared(i.member, i.toKeyAgreement));
}
/** The chunks of one group-star delivery toward one recipient. */
export async function buildGroupStar(i) {
    const rnd = i.rand ?? cryptoRand;
    return buildGroupStarWith({
        shared: await shared(i.own, i.toKeyAgreement), sender: i.own.anchor, to: i.to, salt: i.salt,
        groups: i.groups.map((g) => ({
            group: g.group, sealed: g.sealed, member: g.member?.anchor, memberOp: g.memberOp,
            memberShared: g.member ? () => shared(g.member, i.toKeyAgreement) : undefined,
        })),
        draw: (n) => rnd(n),
    });
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
export async function assembleGroupStar(i) {
    return assembleGroupStarWith({ shared: () => shared(i.own, i.fromKeyAgreement), from: i.from, own: i.own.anchor, chunks: i.chunks });
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
export async function openGroupStar(i) {
    const res = await openGroupStarWith({
        shared: await shared(i.own, i.fromKeyAgreement), from: i.from, own: i.own.anchor, salt: i.salt, entries: i.entries, memberships: i.memberships,
        agreeMember: async (keyAgreement) => {
            const memberX = xRawOfMk(keyAgreement);
            return memberX ? ecdh(i.own.x.priv, memberX) : null;
        },
    });
    return res.map(({ memberOp: _, ...r }) => r);
}
