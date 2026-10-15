// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// anchor — the community anchor toward a contact (Trust Layer 0.31
// §6.1–§6.5, Identity 0.54 §5.4): self-card@2, anchor-rotation@2, the
// pre-rotation binding, the lineage, anchor-mapping@4 and what a changed
// `self` means.
//
// Pure constructions: no Person, no state, no transport. The probe's
// trust act (probe/trust.ts) builds and verifies its mappings here over
// identity Contexts; the holder's trust module (trust/mapping.ts) over its
// KeyProvider, through the agreement-based forms (assembleAnchorMapping,
// verifyAnchorMappingWith). Moved from probe/anchor.ts in lib Stage 2
// (PR 4a); probe/anchor.ts re-exports its original names unchanged.
// Every function takes an optional SubtleCrypto (the holder's resolved
// handle); without one it uses the platform's at call time.
//
//   · the binding (Identity 5.4) — commit(g) = the sha2-256 multihash
//     over the 34 multikey bytes 0xed 0x01 ‖ pk of generation g, in the
//     `u` digest encoding (bindingOf). Generation g commits to g + 1
//     before g is in use; a successor its predecessor's binding does not
//     admit is no successor.
//   · self-card@2 — { body: { type, anchor, keyAgreement, commit },
//     proof: { proofValue } }: the card of generation g carries the
//     binding to g + 1.
//   · anchor-rotation@2 — { body: { type, prev, next, commit }, proof: {
//     proofValue (raw Ed25519 under prev), successorProofValue (raw
//     Ed25519 under next) } }, both over JCS(body). `next` is generation
//     g + 1 of the same digest, `commit` the binding of `next` (to g + 2).
//     The order is prev/next alone, no number. Toward a relationship that
//     holds the binding of prev it proves that next is the one successor
//     prev was bound to; otherwise only the joint authorization.
//   · lineage — at most the LINEAGE_MAX most recent links, in chain
//     order, ending at self; empty = the sender presents no history.
//   · anchor-mapping@4 — { type, pair, self, to, card, lineage, revision,
//     issuedAt }; `self` is the current anchor, the card is under it,
//     mac2 is under its X key. 6.3 in order: 1 schema · 2 to · 3 pair ·
//     4 card · 4a lineage chain · 4b pre-rotation · 5 card.anchor = self ·
//     6 k2 from the card · 7 both MACs.
//   · classification (§6.3 condition 8) — a changed `self` is a ROTATION
//     when the previously held `self` is the `prev` of an element of the
//     carried segment (6160), otherwise the mapping is REJECTED (6170).
//   · mappingAnchors / mappingBindings — the verified anchor set of a
//     mapping (self and every anchor of its lineage) and the pre-rotation
//     bindings it states (6610); the convergence net merges two
//     relationships whose sets meet, under the head rule and the binding
//     rule (§6a.1).
import { jcs, makeValidator, calOK } from './core.js';
import { SCHEMAS } from './schemas.js';
import { base58, fromBase58, edRawOfAnchor, xRawOfMk, ecdh, hkdf, b64uOf, digestBytes } from './crypto.js';
import { communityLabel } from './identity.js';
import { platformSubtle } from './crypto.js';
const te = new TextEncoder();
const S = platformSubtle;
const VAL = makeValidator(SCHEMAS);
const schemaOk = (file, data) => VAL.validate(data, SCHEMAS[file], SCHEMAS[file]).length === 0;
/** HMAC-SHA-256 over the UTF-8 bytes of msg, in the mac encoding (`u` + base64url). */
export async function macU(keyBytes, msg, subtle = S()) {
    const k = await subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return 'u' + b64uOf(new Uint8Array(await subtle.sign('HMAC', k, te.encode(msg))));
}
/** Raw Ed25519 over JCS(body), `z` + base58btc — the abbreviated proof form of Trust §2.1 (no DI suite). */
export async function signRaw(ctx, body, subtle = S()) {
    return 'z' + base58(new Uint8Array(await subtle.sign({ name: 'Ed25519' }, ctx.ed.priv, te.encode(jcs(body)))));
}
/** The raw proofValue form of an Ed25519 signature: `z` + base58btc (Trust §2.1). */
export const rawProofValue = (sig) => 'z' + base58(sig);
/** Verifies a raw Ed25519 proofValue over JCS(body) under a did:key anchor: exactly 64 bytes, canonical base58btc. */
export async function verifyRaw(did, body, proofValue, subtle) {
    try {
        if (typeof proofValue !== 'string' || proofValue[0] !== 'z')
            return false;
        const raw = edRawOfAnchor(did);
        const sig = fromBase58(proofValue.slice(1));
        if (!raw || !sig || sig.length !== 64 || 'z' + base58(sig) !== proofValue)
            return false;
        const Sx = subtle ?? S();
        const key = await Sx.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']);
        return await Sx.verify({ name: 'Ed25519' }, key, sig, te.encode(jcs(body)));
    }
    catch {
        return false;
    }
}
// ── the pre-rotation binding (Identity §5.4) ────────────────────────────
/**
 * The binding of an Ed25519 anchor: `u` + base64url of the sha2-256
 * multihash (0x12 0x20 ‖ SHA-256) over its 34 multikey bytes 0xed 0x01 ‖
 * pk — exactly the bytes the did:key identifier encodes.
 */
export async function bindingOf(anchor, subtle) {
    const raw = edRawOfAnchor(anchor);
    if (!raw || raw.length !== 32)
        throw new Error('not an Ed25519 did:key anchor');
    const mk = new Uint8Array(34);
    mk[0] = 0xed;
    mk[1] = 0x01;
    mk.set(raw, 2);
    return digestBytes(mk, subtle);
}
/** Whether `anchor` meets the binding `commit`. */
export const meetsBinding = async (anchor, commit, subtle) => {
    try {
        return typeof commit === 'string' && (await bindingOf(anchor, subtle)) === commit;
    }
    catch {
        return false;
    }
};
// the generation of a community-anchor label (Identity §5.4, §6.1):
// group/<D> is generation 1, group/<D>/<g> generation g
const generationOf = (label) => {
    const m = /^group\/([^/]+)(?:\/([1-9][0-9]*))?$/.exec(label);
    if (!m)
        return null;
    const generation = m[2] === undefined ? 1 : Number(m[2]);
    return Number.isSafeInteger(generation) ? { digest: m[1], generation } : null;
};
// `next` is generation g + 1 of the digest of `prev` (Trust 6330)
const isSuccessor = (prev, next) => {
    const g = generationOf(prev.label);
    if (!g || g.generation >= Number.MAX_SAFE_INTEGER)
        return false;
    return next.label === communityLabel(g.digest, g.generation + 1);
};
// ── self-card@2 (§6.2) ──────────────────────────────────────────────────
/**
 * self-card@2 of a community-anchor context: its anchor, key-agreement
 * key and the binding to `nextGen`, the generation after it; signed raw
 * under the anchor.
 */
export async function makeSelfCard(self, nextGen, subtle) {
    if (!isSuccessor(self, nextGen))
        throw new Error('self-card@2: nextGen is not the generation after the anchor (Identity §5.4)');
    const body = { type: 'self-card@2', anchor: self.anchor, keyAgreement: self.keyAgreement, commit: await bindingOf(nextGen.anchor, subtle) };
    return { body, proof: { proofValue: await signRaw(self, body, subtle) } };
}
// ── anchor-rotation@2 (§6.5) ────────────────────────────────────────────
/**
 * The link from the current community anchor (prev) to the next
 * generation of the same digest (next), carrying the binding of next to
 * the generation after it (after): both contexts sign the same canonical
 * body. A rotation moves to exactly g + 1 (Trust 6330, Identity §5.4).
 */
export async function makeAnchorRotation(prev, next, after, subtle) {
    if (prev.anchor === next.anchor)
        throw new Error('anchor-rotation@2: next equals prev (Trust §6.5)');
    if (!isSuccessor(prev, next))
        throw new Error('anchor-rotation@2: next is not the next generation of the same digest (Trust 6330)');
    if (!isSuccessor(next, after))
        throw new Error('anchor-rotation@2: commit must bind the generation after next (Trust 6330)');
    const body = { type: 'anchor-rotation@2', prev: prev.anchor, next: next.anchor, commit: await bindingOf(after.anchor, subtle) };
    return { body, proof: { proofValue: await signRaw(prev, body, subtle), successorProofValue: await signRaw(next, body, subtle) } };
}
/**
 * Schema, next ≠ prev, and both signatures — prev's and next's — over
 * the canonical body; with `heldBinding` (the binding held for prev),
 * also that next meets it (§6.3 condition 4b).
 */
export async function verifyAnchorRotation(a, heldBinding, subtle) {
    if (!schemaOk('visibility-anchor-rotation.schema.json', a))
        return false;
    if (a.body.prev === a.body.next)
        return false;
    if (!((await verifyRaw(a.body.prev, a.body, a.proof.proofValue, subtle))
        && (await verifyRaw(a.body.next, a.body, a.proof.successorProofValue, subtle))))
        return false;
    return heldBinding === undefined || meetsBinding(a.body.next, heldBinding, subtle);
}
// ── the lineage (§6.3 condition 4a) ─────────────────────────────────────
/** A mapping carries at most this many of the most recent links (§6.1; schema maxItems). */
export const LINEAGE_MAX = 64;
/**
 * Condition 4a, the chain as given: at most LINEAGE_MAX elements; every
 * element verifies under both its signatures; each prev equals the
 * preceding element's next; the last next equals self. An empty lineage
 * passes: the sender presents no history. The bindings are condition 4b
 * (verifyBindings).
 */
export async function verifyLineage(lineage, self, subtle) {
    if (!Array.isArray(lineage))
        return { ok: false, reason: 'lineage is not an array' };
    if (lineage.length > LINEAGE_MAX)
        return { ok: false, reason: `more than ${LINEAGE_MAX} elements` };
    for (const [i, r] of lineage.entries()) {
        if (!(await verifyAnchorRotation(r, undefined, subtle)))
            return { ok: false, reason: `element ${i}: anchor-rotation@2 does not verify under both signatures` };
        if (i > 0 && r.body.prev !== lineage[i - 1].body.next)
            return { ok: false, reason: `element ${i}: prev is not the preceding next` };
    }
    if (lineage.length && lineage[lineage.length - 1].body.next !== self)
        return { ok: false, reason: 'the last next is not self' };
    return { ok: true };
}
/**
 * Condition 4b, pre-rotation (Trust 6115): each element after the first
 * names a next that meets the commit of the element before it; where the
 * lineage is not empty, card.commit equals the commit of its last
 * element; and for every anchor for which the relationship holds a
 * binding (`held`, 6610), an element whose prev is that anchor names a
 * next that meets it, and a card whose anchor is that anchor carries it
 * as commit.
 */
export async function verifyBindings(body, held, subtle) {
    const L = body.lineage;
    for (const [i, r] of L.entries()) {
        if (i > 0 && !(await meetsBinding(r.body.next, L[i - 1].body.commit, subtle)))
            return { ok: false, reason: `element ${i}: next does not meet the commit of the element before it` };
        const h = held?.get(r.body.prev);
        if (h !== undefined && !(await meetsBinding(r.body.next, h, subtle)))
            return { ok: false, reason: `element ${i}: next does not meet the binding held for its prev` };
    }
    if (L.length && body.card.body.commit !== L[L.length - 1].body.commit)
        return { ok: false, reason: 'card.commit is not the commit of the last element' };
    const hc = held?.get(body.card.body.anchor);
    if (hc !== undefined && body.card.body.commit !== hc)
        return { ok: false, reason: 'the card states another binding than the one held for its anchor' };
    return { ok: true };
}
/** Every anchor a lineage names, in chain order: the first prev, then each next. */
export const lineageAnchors = (lineage) => lineage.length ? [lineage[0].body.prev, ...lineage.map((r) => r.body.next)] : [];
/**
 * The verified anchor set of a mapping (§6a.1 rung 2): its self and every
 * anchor of its carried lineage, in chain order, self last. Two
 * relationships converge when these sets meet.
 */
export const mappingAnchors = (body) => body.lineage.length ? lineageAnchors(body.lineage) : [body.self];
/** The links prev → next a lineage carries, in chain order. */
export const lineageLinks = (lineage) => lineage.map((r) => [r.body.prev, r.body.next]);
/**
 * The pre-rotation bindings a verified mapping states (Trust 6610): the
 * commit of each lineage element as the binding of its next, card.commit
 * as the binding of self, and, for the prev of each link, the binding
 * computed over that link's next.
 */
export async function mappingBindings(body, subtle) {
    const out = new Map();
    for (const r of body.lineage) {
        out.set(r.body.prev, await bindingOf(r.body.next, subtle));
        out.set(r.body.next, r.body.commit);
    }
    out.set(body.self, body.card.body.commit);
    return out;
}
/**
 * §6.3 condition 8 against the `self` this relationship holds (6150):
 * 'first' where it holds none, 'same' where `self` is unchanged,
 * 'rotation' where a changed `self` comes with a carried segment that
 * has the held self as the `prev` of one of its elements (6160), and
 * 'rejected' otherwise (6170): a change of `self` that no carried segment
 * links to the held one is rejected like every mapping that fails a
 * condition, with the current state kept — also after more than 64
 * missed rotations (6400). Condition 4b has already refused a segment
 * that names another successor of an anchor whose binding the
 * relationship holds.
 */
export function classifyMapping(heldSelf, body) {
    if (heldSelf === undefined)
        return 'first';
    if (heldSelf === body.self)
        return 'same';
    return body.lineage.some((r) => r.body.prev === heldSelf) ? 'rotation' : 'rejected';
}
/** The two MACs of an anchor-mapping@4 over JCS(body) (Trust 6030), from
 *  the two shared secrets: sh1 = ECDH(pairX of the sender, pairX of the
 *  addressee), sh2 = ECDH(selfX of the sender, pairX of the addressee). */
export async function assembleAnchorMapping(body, sh1, sh2, subtle) {
    const msg = jcs(body);
    return { body, proof: {
            mac1: await macU(await hkdf(sh1, 'rltp/visibility/mac/map1', 32, subtle), msg, subtle),
            mac2: await macU(await hkdf(sh2, 'rltp/visibility/mac/map2', 32, subtle), msg, subtle),
        } };
}
/** anchor-mapping@4: body { type, pair, self, to, card, lineage, revision, issuedAt }; mac1 (relationship key, map1) and mac2 (selfX × pairX of the addressee, map2) over JCS(body). */
export async function buildAnchorMapping(i, subtle) {
    const card = await makeSelfCard(i.self, i.nextGen, subtle);
    const body = { type: 'anchor-mapping@4', pair: i.pair.anchor, self: i.self.anchor, to: i.to, card, lineage: i.lineage, revision: i.revision, issuedAt: i.issuedAt };
    const theirX = xRawOfMk(i.toKeyAgreement);
    if (!theirX)
        throw new Error('addressee key agreement is not a multikey');
    return assembleAnchorMapping(body, await ecdh(i.pair.x.priv, theirX, subtle), await ecdh(i.self.x.priv, theirX, subtle), subtle);
}
/** §6.3 conditions 1–7 as numbered by verifyAnchorMapping, with the rule each one is. */
export const MAPPING_CONDITION_RULE = Object.freeze({
    1: 'RLTP-TRU-6070', 2: 'RLTP-TRU-6080', 3: 'RLTP-TRU-6090', 4: 'RLTP-TRU-6100', '4a': 'RLTP-TRU-6110',
    '4b': 'RLTP-TRU-6118', 5: 'RLTP-TRU-6120', 6: 'RLTP-TRU-6130', 7: 'RLTP-TRU-6140',
});
/**
 * §6.3, the closed list, evaluated in its order: 1 schema (anchor-mapping
 * @1 to @3 are not implemented and fail here) · 2 to = own pair anchor ·
 * 3 pair = the arrival tuple's counterpart · 4 the card verifies under
 * its own anchor · 4a the lineage chain · 4b pre-rotation, against the
 * bindings this relationship holds (`held`, 6610) · 5 card.anchor = self ·
 * 6 k2 from card.keyAgreement · 7 both MACs. Revision (8) is the
 * holder's state. The addressee's own pair key acts through `agree`: the
 * raw X25519 shared secret with a raw public key, or null where none is
 * usable (condition 7); a throw is a failure of condition 1, as in
 * verifyAnchorMapping.
 */
export async function verifyAnchorMappingWith(m, at, subtle) {
    try {
        if (!schemaOk('visibility-anchor-mapping.schema.json', m))
            return { ok: false, step: '1' };
        const b = m.body;
        if (!calOK(b.issuedAt))
            return { ok: false, step: '1' }; // calendar validity belongs to the parse level
        if (b.to !== at.ownAnchor)
            return { ok: false, step: '2' };
        if (b.pair !== at.pair)
            return { ok: false, step: '3' };
        if (!(await verifyRaw(b.card.body.anchor, b.card.body, b.card.proof.proofValue, subtle)))
            return { ok: false, step: '4' };
        if (!(await verifyLineage(b.lineage, b.self, subtle)).ok)
            return { ok: false, step: '4a' };
        if (!(await verifyBindings(b, at.held, subtle)).ok)
            return { ok: false, step: '4b' };
        if (b.card.body.anchor !== b.self)
            return { ok: false, step: '5' };
        const cardX = xRawOfMk(b.card.body.keyAgreement);
        const pairX = xRawOfMk(at.pairKeyAgreement);
        if (!cardX || !pairX)
            return { ok: false, step: '6' };
        const sh2 = await at.agree(cardX);
        const k2 = sh2 && await hkdf(sh2, 'rltp/visibility/mac/map2', 32, subtle);
        const sh1 = await at.agree(pairX);
        if (!sh1 || !sh2 || !k2 || sh1.every((x) => x === 0) || sh2.every((x) => x === 0))
            return { ok: false, step: '7' }; // both ECDH outputs non-zero
        const msg = jcs(b);
        if ((await macU(await hkdf(sh1, 'rltp/visibility/mac/map1', 32, subtle), msg, subtle)) !== m.proof.mac1)
            return { ok: false, step: '7' };
        if ((await macU(k2, msg, subtle)) !== m.proof.mac2)
            return { ok: false, step: '7' };
        return { ok: true };
    }
    catch {
        return { ok: false, step: '1' };
    }
}
/** verifyAnchorMappingWith over the addressee's own pair Context. */
export async function verifyAnchorMapping(m, at, subtle) {
    return verifyAnchorMappingWith(m, {
        ownAnchor: at.own?.anchor, pair: at.pair, pairKeyAgreement: at.pairKeyAgreement, held: at.held,
        agree: (theirX) => ecdh(at.own.x.priv, theirX, subtle),
    }, subtle);
}
