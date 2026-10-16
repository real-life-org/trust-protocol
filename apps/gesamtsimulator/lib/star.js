// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// star — star@2, the blinded star with its 5.2a chunks (Trust Layer 0.31
// §5.1–5.2a, task star/0.2): the pure wire constructions over a raw
// X25519 shared secret (lib Stage 2, PR 4b). The holder's trust module
// (trust/star.ts) builds and receives through these. Byte-compatible with
// the star of vectors/visibility.json (vectors3.test.mjs).
//
//   k     = HKDF(X25519(pairX_sender, pairX_recipient),
//                "rltp/visibility/blind/star/" || senderPair || "/" || recipientPair || "/" || salt)   (5160)
//   entry = HMAC(k, anchor bytes)                                                                       (5010)
//   chunk = { body: { type: "star@2", salt, seq, last, blinded }, proof: { mac: HMAC(k, JCS(body)) } } (5070, 5080)
//
// The union of entries is deduplicated (5050), sorted once and sliced
// into chunks of at most 1024 entries (5200, 5220); an empty star is one
// chunk with no entry.
import { jcs, makeValidator } from './core.js';
import { SCHEMAS } from './schemas.js';
import { hkdf, platformSubtle } from './crypto.js';
import { macU } from './anchor.js';
const VAL = makeValidator(SCHEMAS);
/** At most this many entries per chunk (5200). */
export const STAR_CHUNK = 1024;
/** The Delivery Contract's plaintext limit a chunk's document stays within (5190). */
export const PLAINTEXT_MAX = 65_536;
/** k of one direction from the pair secret (5160); salt in its wire string form. */
export async function starKeyOf(shared, sender, recipient, salt, subtle = platformSubtle()) {
    if (shared.every((b) => b === 0))
        throw new Error('all-zero shared secret (Trust §2.1)');
    return hkdf(shared, `rltp/visibility/blind/star/${sender}/${recipient}/${salt}`, 32, subtle);
}
/** One blinded entry: HMAC(k, anchor) in its u form (5010). */
export const blindAnchor = (k, anchor, subtle) => macU(k, anchor, subtle);
/** The chunks of one delivery: every anchor once, blinded, sorted once,
 *  sliced by STAR_CHUNK (5010, 5050, 5200, 5220). */
export async function buildStarChunks(k, salt, anchors, subtle = platformSubtle()) {
    const blinded = [];
    for (const anchor of new Set(anchors))
        blinded.push(await blindAnchor(k, anchor, subtle));
    blinded.sort();
    const n = Math.max(1, Math.ceil(blinded.length / STAR_CHUNK));
    const chunks = [];
    for (let i = 0; i < n; i++) {
        const body = { type: 'star@2', salt, seq: String(i + 1), last: i === n - 1, blinded: blinded.slice(i * STAR_CHUNK, (i + 1) * STAR_CHUNK) };
        chunks.push({ body, proof: { mac: await macU(k, jcs(body), subtle) } });
    }
    return chunks;
}
/** Is this a schema-valid star@2 chunk (visibility-star.schema.json)? */
export const starChunkOk = (chunk) => VAL.validate(chunk, SCHEMAS['visibility-star.schema.json'], SCHEMAS['visibility-star.schema.json']).length === 0;
/** Does the chunk's MAC verify under k (5080)? */
export async function starChunkMacOk(k, chunk, subtle) {
    return (await macU(k, jcs(chunk.body), subtle)) === chunk.proof.mac;
}
/** The assembled union is strictly ascending: sorted and free of
 *  duplicates in one check (5300, 5310). */
export const strictlyAscending = (xs) => xs.every((x, i) => i === 0 || xs[i - 1] < x);
