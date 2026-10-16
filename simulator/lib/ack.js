// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// ack — the delivery acknowledgement's pure parts (Delivery §4.2, the
// acknowledgement class rule of §4.4): the type, the deniable MAC form's
// channel-keyed derivation, the MAC, and the context-free form checks of
// a received ack. Shared by the holder's receive core (engine.ts) and the
// probe world (probe/acks.ts); byte-compatible with
// vectors/delivery-ack.json (lib/test/vectors4.test.mjs).
//
//   k     = HKDF-SHA-256(ikm = X25519(pairX_issuer, pairX_recipient),
//                        salt = empty, info = "rltp/v1/delivery/mac/ack/"
//                        || issuerPairAnchor || "/" || recipientPairAnchor,
//                        32 bytes; an all-zero shared secret is rejected)
//   proof = { mac: "u" + base64url(HMAC-SHA-256(k, JCS(document without proof))) }
//
// Deniable by construction: either party of the tuple derives k, so for a
// designated-verifier payload the ack is evidence to its sender alone,
// never an attestation (4.2). The key agreement itself is the caller's:
// the holder asks its KeyProvider, the probe its context's private key.
import { jcs, b64uOf, calOK, makeValidator } from './core.js';
import { hkdf, platformSubtle } from './crypto.js';
import { SCHEMAS } from './schemas.js';
const te = new TextEncoder();
/** The registered type of the acknowledgement (Delivery §4.2). */
export const ACK_TYPE = 'https://real-life.org/trust-tasks/delivery-ack/0.1';
/** The HKDF info of the channel ack key, issuer first (4.2). */
export const ackInfo = (issuerPairAnchor, recipientPairAnchor) => 'rltp/v1/delivery/mac/ack/' + issuerPairAnchor + '/' + recipientPairAnchor;
/** The channel ack key from the tuple's X25519 shared secret (4.2). */
export async function ackKeyOf(shared, issuerPairAnchor, recipientPairAnchor, subtle) {
    if (shared.every((b) => b === 0))
        throw new Error('all-zero X25519 output');
    return hkdf(shared, ackInfo(issuerPairAnchor, recipientPairAnchor), 32, subtle);
}
/** "u" + base64url HMAC-SHA-256 over the JCS of `doc` under `key`. */
export async function ackMac(key, doc, subtle) {
    const S = subtle ?? platformSubtle();
    const k = await S.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return 'u' + b64uOf(new Uint8Array(await S.sign('HMAC', k, te.encode(jcs(doc)))));
}
/** The proof-less ack of `ref` on the acked document's thread (4.2):
 *  issuer = the acked document's recipient, recipient = its issuer. */
export const ackDocument = (f) => ({
    id: f.id, type: ACK_TYPE, issuer: f.issuer, recipient: f.recipient, threadId: f.threadId, issuedAt: f.issuedAt,
    payload: { ref: f.ref, meaning: 'received' },
});
/** The deniable ack: `doc` with its MAC-form proof under the channel ack key. */
export async function macAck(doc, key, subtle) {
    return { ...doc, proof: { mac: await ackMac(key, doc, subtle) } };
}
const V = makeValidator(SCHEMAS);
const schemaOk = (file, data) => V.validate(data, SCHEMAS[file], SCHEMAS[file]).length === 0;
const ACK_FIELDS = new Set(['id', 'type', 'issuer', 'recipient', 'threadId', 'issuedAt', 'payload', 'proof', 'ceremony']);
/**
 * The context-free checks of a received MAC-form ack, in stage order
 * (Delivery §6.2): 5 document profile (schema, closed form, calendar), 7
 * payload schema, 8 the class rule's proof form (exactly `{mac}`), no
 * enactment, `meaning`. What needs the arrival context stays the
 * caller's: recipient = own anchor (5), issuer = the tuple's counterpart,
 * `ref` = a document sent on that thread, and the MAC itself (8).
 */
export function macAckForm(doc) {
    const d = doc;
    if (!schemaOk('rltp-delivery-document.schema.json', d) || d?.type !== ACK_TYPE)
        return { ok: false, stage: 5, reason: 'malformed' };
    if (Object.keys(d).some((k) => !ACK_FIELDS.has(k)) || !calOK(d.issuedAt))
        return { ok: false, stage: 5, reason: 'malformed' };
    if (!schemaOk('payload-delivery-ack.schema.json', d.payload))
        return { ok: false, stage: 7, reason: 'malformed' };
    const p = d.proof;
    if (p === null || typeof p !== 'object' || Object.keys(p).length !== 1 || typeof p.mac !== 'string')
        return { ok: false, stage: 8, reason: 'validation-failed' };
    if (d.ceremony?.enactment !== undefined)
        return { ok: false, stage: 8, reason: 'validation-failed' };
    if (d.payload.meaning !== 'received')
        return { ok: false, stage: 8, reason: 'validation-failed' };
    return { ok: true, ref: d.payload.ref, threadId: d.threadId };
}
/** Does the ack's MAC verify under `key`? (4.2; over JCS of the document without proof) */
export async function macAckValid(doc, key, subtle) {
    const { proof, ...rest } = doc;
    return typeof proof?.mac === 'string' && (await ackMac(key, rest, subtle)) === proof.mac;
}
