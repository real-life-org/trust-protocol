// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// anchor — the community anchor toward a contact (Network Visibility
// 0.30 §6.1–§6.5, Identity 0.52 §5.4): self-card@1, anchor-rotation@1,
// the lineage, anchor-mapping@3 and what a changed `self` means.
//
// Pure constructions over identity Contexts: no Person, no state, no
// transport. The probe's trust act (trust.ts) builds and verifies its
// mappings HERE, and scripts/gen-anchor-vectors.mjs generates the
// shipped vectors from the same functions.
//
//   · anchor-rotation@1 — { body: { type, prev, next, generation },
//     proof: { proofValue (raw Ed25519 under prev), successorProofValue
//     (raw Ed25519 under next) } }, both over JCS(body). It proves
//     control of both generations' keys at the time of rotation —
//     nothing about the person (Identity §8.6).
//   · lineage — the ordered rotations from generation 2 to the current
//     one; an empty lineage means the sender presents no history.
//   · anchor-mapping@3 — anchor-mapping@2 plus `lineage`; `self` is the
//     current generation, the card is under it, mac2 is under its X key.
//   · classification (§6.3 condition 8) — a changed `self` is a
//     ROTATION when the previously held `self` appears as prev or next
//     of a lineage element, otherwise a NEW COMMUNITY.
import { jcs, makeValidator, calOK } from '../core.js';
import { SCHEMAS } from '../schemas.js';
import { base58, fromBase58, edRawOfAnchor, xRawOfMk, ecdh, hkdf, b64uOf } from '../crypto.js';
const te = new TextEncoder();
const S = globalThis.crypto.subtle;
const VAL = makeValidator(SCHEMAS);
const schemaOk = (file, data) => VAL.validate(data, SCHEMAS[file], SCHEMAS[file]).length === 0;
/** HMAC-SHA-256 over the UTF-8 bytes of msg, in the mac encoding (`u` + base64url). */
export async function macU(keyBytes, msg) {
    const k = await S.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return 'u' + b64uOf(new Uint8Array(await S.sign('HMAC', k, te.encode(msg))));
}
/** Raw Ed25519 over JCS(body), `z` + base58btc — the abbreviated proof form of Visibility §2.1 (no DI suite). */
export async function signRaw(ctx, body) {
    return 'z' + base58(new Uint8Array(await S.sign({ name: 'Ed25519' }, ctx.ed.priv, te.encode(jcs(body)))));
}
/** Verifies a raw Ed25519 proofValue over JCS(body) under a did:key anchor: exactly 64 bytes, canonical base58btc. */
export async function verifyRaw(did, body, proofValue) {
    try {
        if (typeof proofValue !== 'string' || proofValue[0] !== 'z')
            return false;
        const raw = edRawOfAnchor(did);
        const sig = fromBase58(proofValue.slice(1));
        if (!raw || !sig || sig.length !== 64 || 'z' + base58(sig) !== proofValue)
            return false;
        const key = await S.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']);
        return await S.verify({ name: 'Ed25519' }, key, sig, te.encode(jcs(body)));
    }
    catch {
        return false;
    }
}
// ── self-card@1 (§6.2) ──────────────────────────────────────────────────
/** self-card@1 of a community-anchor context: its anchor and key-agreement key, signed raw under the anchor. */
export async function makeSelfCard(self) {
    const body = { type: 'self-card@1', anchor: self.anchor, keyAgreement: self.keyAgreement };
    return { body, proof: { proofValue: await signRaw(self, body) } };
}
// ── anchor-rotation@1 (§6.5) ────────────────────────────────────────────
const inDomain = (g) => /^[1-9][0-9]{0,17}$/.test(g) && BigInt(g) >= 2n && BigInt(g) <= BigInt(Number.MAX_SAFE_INTEGER); // Identity §5.4: [2, 2^53 − 1]
/**
 * The rotation from generation g (prev) to g + 1 (next): both contexts
 * sign the same canonical body. `generation` is that of next, ≥ 2.
 */
export async function makeAnchorRotation(prev, next, generation) {
    const g = String(generation);
    if (!inDomain(g))
        throw new Error(`anchor-rotation@1: generation outside [2, 2^53 − 1] (Identity §5.4): ${g}`);
    const body = { type: 'anchor-rotation@1', prev: prev.anchor, next: next.anchor, generation: g };
    return { body, proof: { proofValue: await signRaw(prev, body), successorProofValue: await signRaw(next, body) } };
}
/** Schema, generation domain, and both signatures — prev's and next's — over the canonical body. */
export async function verifyAnchorRotation(a) {
    if (!schemaOk('visibility-anchor-rotation.schema.json', a))
        return false;
    if (!inDomain(a.body.generation))
        return false;
    return (await verifyRaw(a.body.prev, a.body, a.proof.proofValue))
        && (await verifyRaw(a.body.next, a.body, a.proof.successorProofValue));
}
// ── the lineage (§6.3 condition 4a) ─────────────────────────────────────
/**
 * Every element verifies under both its signatures; generations run
 * consecutively from 2; each prev equals the preceding element's next;
 * the last next equals self. An empty lineage passes: the sender
 * presents no history (the recipient holds no generation numbers).
 */
export async function verifyLineage(lineage, self) {
    if (!Array.isArray(lineage))
        return { ok: false, reason: 'lineage is not an array' };
    for (const [i, r] of lineage.entries()) {
        if (!(await verifyAnchorRotation(r)))
            return { ok: false, reason: `element ${i}: anchor-rotation@1 does not verify under both signatures` };
        if (r.body.generation !== String(i + 2))
            return { ok: false, reason: `element ${i}: generation ${r.body.generation}, expected ${i + 2}` };
        if (i > 0 && r.body.prev !== lineage[i - 1].body.next)
            return { ok: false, reason: `element ${i}: prev is not the preceding next` };
    }
    if (lineage.length && lineage[lineage.length - 1].body.next !== self)
        return { ok: false, reason: 'the last next is not self' };
    return { ok: true };
}
/** Every anchor a lineage names, generation ascending: generation 1 (the first prev), then each next. */
export const lineageAnchors = (lineage) => lineage.length ? [lineage[0].body.prev, ...lineage.map((r) => r.body.next)] : [];
/**
 * §6.3 condition 8 for a changed `self`: 'rotation' when the previously
 * held self appears as prev or next of some lineage element — the held
 * anchor advances and merges keyed by earlier generations persist;
 * otherwise 'new-community' — accepted as a correction, merges keyed by
 * the earlier anchor dissolve, because nothing links the two.
 */
export function classifyMapping(heldSelf, body) {
    if (heldSelf === undefined)
        return 'first';
    if (heldSelf === body.self)
        return 'same';
    return body.lineage.some((r) => r.body.prev === heldSelf || r.body.next === heldSelf) ? 'rotation' : 'new-community';
}
/** anchor-mapping@3: body { type, pair, self, to, card, lineage, revision, issuedAt }; mac1 (relationship key, map1) and mac2 (selfX × pairX of the addressee, map2) over JCS(body). */
export async function buildAnchorMapping(i) {
    const card = await makeSelfCard(i.self);
    const body = { type: 'anchor-mapping@3', pair: i.pair.anchor, self: i.self.anchor, to: i.to, card, lineage: i.lineage, revision: i.revision, issuedAt: i.issuedAt };
    const msg = jcs(body);
    const theirX = xRawOfMk(i.toKeyAgreement);
    if (!theirX)
        throw new Error('addressee key agreement is not a multikey');
    return { body, proof: {
            mac1: await macU(await hkdf(await ecdh(i.pair.x.priv, theirX), 'rltp/visibility/mac/map1'), msg),
            mac2: await macU(await hkdf(await ecdh(i.self.x.priv, theirX), 'rltp/visibility/mac/map2'), msg),
        } };
}
/**
 * §6.3, the closed list, evaluated in its order: 1 schema (anchor-mapping@1
 * and @2 are not implemented and fail here) · 2 to = own pair anchor ·
 * 3 pair = the arrival tuple's counterpart · 4 the card verifies under
 * its own anchor · 4a the lineage · 5 card.anchor = self · 6 k2 from
 * card.keyAgreement · 7 both MACs. Revision (8) is the holder's state.
 */
export async function verifyAnchorMapping(m, at) {
    try {
        if (!schemaOk('visibility-anchor-mapping.schema.json', m))
            return { ok: false, step: '1' };
        const b = m.body;
        if (!calOK(b.issuedAt))
            return { ok: false, step: '1' }; // calendar validity belongs to the parse level
        if (b.to !== at.own.anchor)
            return { ok: false, step: '2' };
        if (b.pair !== at.pair)
            return { ok: false, step: '3' };
        if (!(await verifyRaw(b.card.body.anchor, b.card.body, b.card.proof.proofValue)))
            return { ok: false, step: '4' };
        if (!(await verifyLineage(b.lineage, b.self)).ok)
            return { ok: false, step: '4a' };
        if (b.card.body.anchor !== b.self)
            return { ok: false, step: '5' };
        const cardX = xRawOfMk(b.card.body.keyAgreement);
        const pairX = xRawOfMk(at.pairKeyAgreement);
        if (!cardX || !pairX)
            return { ok: false, step: '6' };
        const sh2 = await ecdh(at.own.x.priv, cardX);
        const k2 = await hkdf(sh2, 'rltp/visibility/mac/map2');
        const sh1 = await ecdh(at.own.x.priv, pairX);
        if (sh1.every((x) => x === 0) || sh2.every((x) => x === 0))
            return { ok: false, step: '7' }; // both ECDH outputs non-zero
        const msg = jcs(b);
        if ((await macU(await hkdf(sh1, 'rltp/visibility/mac/map1'), msg)) !== m.proof.mac1)
            return { ok: false, step: '7' };
        if ((await macU(k2, msg)) !== m.proof.mac2)
            return { ok: false, step: '7' };
        return { ok: true };
    }
    catch {
        return { ok: false, step: '1' };
    }
}
