// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// crypto — the primitives, and nothing above them.
//
// Byte helpers, hashes, HKDF, key pairs (Ed25519 signing, X25519
// agreement), the did:key / multikey renderings, ECDH — plus the
// eddsa-jcs-2022 Data Integrity proof, which every layer signs with.
//
// This module answers "how", never "what": what a proof MEANS is decided
// by the layer that issues it. Runs on globalThis.crypto.subtle in
// browsers, Node >= 20, Deno and Bun alike.
//
// Every primitive below runs on the platform's SubtleCrypto unless the
// caller hands its own (the holder passes the handle it resolved at
// construction, note §3 Crypto).
//
// Determinism: every construction takes its entropy from the CALLER
// (nonces, ephemeral seeds). Random helpers exist, but nothing here
// calls them implicitly — that is what makes the whole stack replayable
// and vector-testable.
import { jcs, base58, fromBase58, b64uOf, fromB64u, calOK } from './core.js';
import { CryptoUnavailableError } from './results.js';
export { b64uOf, fromB64u, base58, fromBase58 };
const te = new TextEncoder();
/** The platform's SubtleCrypto, read at call time — never at import, so
 *  the library loads in a runtime without WebCrypto and fails only where
 *  it is used (note §3 Crypto). */
export const platformSubtle = () => {
    const s = globalThis.crypto?.subtle;
    if (!s)
        throw new CryptoUnavailableError(['subtle']);
    return s;
};
const S = platformSubtle;
// ── bytes ───────────────────────────────────────────────────────────────
export const cat = (...bs) => {
    const o = new Uint8Array(bs.reduce((n, b) => n + b.length, 0));
    let i = 0;
    for (const b of bs) {
        o.set(b, i);
        i += b.length;
    }
    return o;
};
export const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
// ── hashes, KDF, digests ────────────────────────────────────────────────
export const sha = async (bytes, subtle = S()) => new Uint8Array(await subtle.digest('SHA-256', bytes));
export const hkdf = async (ikm, info, len = 32, subtle = S()) => {
    const k = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode(info) }, k, len * 8));
};
// multibase multihash (u, sha2-256) over raw BYTES — pair labels digest the nonce bytes
export const digestBytes = async (bytes, subtle) => 'u' + b64uOf(cat(Uint8Array.from([0x12, 0x20]), await sha(bytes, subtle)));
// …and over the JCS of a document — the document digest of the stack
export const digestDoc = async (obj, subtle) => digestBytes(te.encode(jcs(obj)), subtle);
// ── keys (Ed25519 signing, X25519 agreement; did:key / multikey) ────────
const ED_PKCS8 = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
const X_PKCS8 = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]);
const jwkX = async (priv, subtle = S()) => fromB64u((await subtle.exportKey('jwk', priv)).x);
export async function edFromSeed(seed) {
    const priv = await S().importKey('pkcs8', cat(ED_PKCS8, seed), { name: 'Ed25519' }, true, ['sign']);
    return { priv, pubRaw: await jwkX(priv) };
}
export async function xFromSeed(seed, subtle = S()) {
    const priv = await subtle.importKey('pkcs8', cat(X_PKCS8, seed), { name: 'X25519' }, true, ['deriveBits']);
    return { priv, pubRaw: await jwkX(priv, subtle) };
}
export const anchorOfEd = (pubRaw) => 'did:key:z' + base58(cat(Uint8Array.from([0xed, 0x01]), pubRaw));
export const mkOfX = (pubRaw) => 'z' + base58(cat(Uint8Array.from([0xec, 0x01]), pubRaw));
export const edRawOfAnchor = (did) => {
    if (typeof did !== 'string' || !did.startsWith('did:key:z'))
        return null;
    const b = fromBase58(did.slice('did:key:z'.length));
    return (b && b.length === 34 && b[0] === 0xed && b[1] === 0x01) ? b.subarray(2) : null;
};
export const xRawOfMk = (mk) => {
    if (typeof mk !== 'string' || mk[0] !== 'z')
        return null;
    const b = fromBase58(mk.slice(1));
    return (b && b.length === 34 && b[0] === 0xec && b[1] === 0x01) ? b.subarray(2) : null;
};
export const ecdh = async (xPriv, theirPubRaw, subtle = S()) => {
    const pub = await subtle.importKey('raw', theirPubRaw, { name: 'X25519' }, false, []);
    return new Uint8Array(await subtle.deriveBits({ name: 'X25519', public: pub }, xPriv, 256));
};
export async function diSign(ctx, doc, created) {
    const cfg = { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', created, verificationMethod: ctx.anchor + '#' + ctx.anchor.slice(8), proofPurpose: 'assertionMethod' };
    if ('@context' in doc)
        cfg['@context'] = doc['@context'];
    const hashData = cat(await sha(te.encode(jcs(cfg))), await sha(te.encode(jcs(doc))));
    const sig = new Uint8Array(await S().sign({ name: 'Ed25519' }, ctx.ed.priv, hashData));
    return { ...doc, proof: { ...cfg, proofValue: 'z' + base58(sig) } };
}
/**
 * The same eddsa-jcs-2022 proof as diSign, with the signature from a
 * signing function instead of a private key: the holder signs through
 * its KeyProvider (`keys.sign(label, bytes)`, raw Ed25519 over the
 * hashData), so modules never hold a key. Ed25519 is deterministic: for
 * the same key, document and `created` the result is byte-identical to
 * diSign's.
 */
export async function diSignWith(anchor, sign, doc, created, subtle) {
    const cfg = { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', created, verificationMethod: anchor + '#' + anchor.slice(8), proofPurpose: 'assertionMethod' };
    if ('@context' in doc)
        cfg['@context'] = doc['@context'];
    const hashData = cat(await sha(te.encode(jcs(cfg)), subtle), await sha(te.encode(jcs(doc)), subtle));
    const sig = await sign(hashData);
    if (!(sig instanceof Uint8Array) || sig.length !== 64)
        throw new Error('diSignWith: the signer must answer a 64-byte Ed25519 signature');
    return { ...doc, proof: { ...cfg, proofValue: 'z' + base58(sig) } };
}
/** The proof purposes diVerify reads (Delivery DO-10); diSign writes `assertionMethod`. */
export const PROOF_PURPOSES_READ = new Set(['assertionMethod', 'authentication']);
/** `subtle`: the holder's resolved handle; without one the platform's, at call time. */
export async function diVerify(doc, expectedAnchor, subtle) {
    const { proof, ...rest } = doc ?? {};
    if (typeof proof?.proofValue !== 'string' || typeof proof?.verificationMethod !== 'string')
        return false;
    // M-3 (review 1): this predicate verifies THE RLTP proof, not any
    // signature that happens to be valid under the key — a config with a
    // foreign type, suite, purpose or timestamp form is false here, whether
    // or not a schema runs first.
    if (proof.type !== 'DataIntegrityProof' || proof.cryptosuite !== 'eddsa-jcs-2022')
        return false;
    // The purposes read: assertionMethod, which RLTP producers sign with,
    // and authentication, which the Trust Tasks framework asks a producer to
    // sign a Trust Task document with (TT §4.7.3); a did:key's one signing
    // key holds both relationships. Every other purpose, and an absent one,
    // is false (Delivery DO-10: readers take both before writers switch).
    if (!PROOF_PURPOSES_READ.has(proof.proofPurpose))
        return false;
    if (typeof proof.created !== 'string' || !calOK(proof.created))
        return false;
    const vmDid = proof.verificationMethod.split('#')[0];
    if (proof.verificationMethod !== vmDid + '#' + vmDid.slice(8))
        return false;
    if (expectedAnchor && vmDid !== expectedAnchor)
        return false;
    if ('@context' in rest && jcs(proof['@context'] ?? null) !== jcs(rest['@context']))
        return false;
    const raw = edRawOfAnchor(vmDid);
    if (!raw)
        return false;
    const zsig = proof.proofValue;
    if (typeof zsig !== 'string' || zsig[0] !== 'z')
        return false;
    const sig = fromBase58(zsig.slice(1));
    // exactly 64 bytes, canonical base58btc — no left-pad repair (Encounter 2.3)
    if (!sig || sig.length !== 64 || 'z' + base58(sig) !== zsig)
        return false;
    const { proofValue, ...cfg } = proof;
    const SS = subtle ?? S();
    const hashData = cat(await sha(te.encode(jcs(cfg)), SS), await sha(te.encode(jcs(rest)), SS));
    const pub = await SS.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']);
    return SS.verify({ name: 'Ed25519' }, pub, sig, hashData);
}
