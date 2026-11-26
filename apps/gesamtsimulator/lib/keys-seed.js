// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// keys-seed — the library's default KeyProvider (lib Stage 2, note §3).
//
// Every key derives from one root seed exactly as identity.ts and
// carrier-identity.ts derive it — the same HKDF (SHA-256, empty salt)
// and the same info strings — so the shipped vectors stay valid:
//
//   anchor of a label   'rltp/anchor/ed/' + label, 'rltp/anchor/x/' + label
//                       under the closed registry (Identity §6.1); a
//                       device key is the anchor of its device label
//                       device/<n>/<c> (§5.5, identity.ts deviceLabel)
//   carrier principal   CARRIER_INFO_PREFIX + Dc + Dn (Identity §7a.4)
//   connection DID      CONNECTION_INFO_PREFIX + Dc + Dn (Identity §13,
//                       profile spec/adapter-vti-mediator.md §1)
//
// The provider reads no state. agree() asks the engine's release
// (`allowed(rkid)`, from `addresses`) on EVERY call, cached key or not,
// so a retired key is never revived from the cache. Derived keys are
// cached in a Map outside the holder state (keys are not state, Identity
// 9.3). The WebCrypto handle is the caller's or the global one, resolved
// here, at construction — never at import. Invalid input answers with
// a status (`unknown`, `invalid`) or a TypeError; a derivation or WebCrypto
// failure throws, so the engine reports it as InfraError('key-provider').
import { base58, b64uOf, fromB64u } from './core.js';
import { cat, edFromSeed, xFromSeed, hkdf as hkdfOf } from './crypto.js';
import { canonicalLabel } from './identity.js';
import { CARRIER_INFO_PREFIX, CONNECTION_INFO_PREFIX, validCarrierIdentifier } from './carrier-identity.js';
import { bindConnectionSeed } from './connection-seed.js';
import { CryptoUnavailableError } from './results.js';
/** DEVIATION D3: the HKDF info prefix of the stage-1 service identity (never the frozen prefix of Identity §7, Access 11080); the group DID follows. */
export const SERVICE_IDENTITY_STAGE1_PREFIX = 'rltp/v1/x-service-identity-stage1/';
/** the HKDF info prefix of the stage-1 content key of a founded group (Access 9710); the group DID follows */
export const CONTENT_KEY_STAGE1_PREFIX = 'rltp/v1/x-content-key-stage1/';
/** DEVIATION D5: the HKDF info prefix of the shared-connect encounter seeds (stage 1, outside the label registry of Identity §6.1); the purpose and the multihash of the nonce follow. */
export const SHARED_CONNECT_STAGE1_PREFIX = 'rltp/v1/x-shared-connect-stage1/';
/** DEVIATION D6, EXPERIMENTAL: the HKDF info prefix of the identity toward a web app the person logs into (outside the label registry of Identity §6.1); the multihash of the web app's origin follows. Replaced at identity stage 3; no migration of accounts made with it is promised. */
export const LOGIN_EXPERIMENTAL_PREFIX = 'rltp/v1/x-login-experimental/';
/** The origin of a web app as the login identity takes it: `scheme://host[:port]`, https or http, nothing else. */
export function loginOrigin(origin) {
    if (typeof origin !== 'string')
        return null;
    let u;
    try {
        u = new URL(origin);
    }
    catch {
        return null;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:')
        return null;
    return u.origin === origin ? origin : null;
}
const te = new TextEncoder();
/** PKCS#8 prefixes of a raw 32-byte Ed25519 / X25519 private key */
export const ED_PKCS8 = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
export const X_PKCS8 = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]);
/** The default KeyProvider over a root seed (the identity's root IKM). The second argument is
 *  the WebCrypto handle or the options. */
export function seedKeys(seed, options) {
    if (!(seed instanceof Uint8Array) || seed.length < 32)
        throw new TypeError('seedKeys: the root seed must be at least 32 bytes');
    const opts = options && 'subtle' in options ? { crypto: options } : options ?? {};
    const crypto = opts.crypto;
    const exportConnectionSeed = opts.exportConnectionSeed === true;
    const S = (crypto ?? globalThis.crypto)?.subtle;
    if (!S)
        throw new CryptoUnavailableError(['subtle']);
    // an allocating copy: Buffer.slice would alias the caller's memory
    const ikm = new Uint8Array(seed);
    const hkdf = async (info) => {
        const k = await S.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
        return new Uint8Array(await S.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode(info) }, k, 256));
    };
    const pubOf = async (priv) => fromB64u((await S.exportKey('jwk', priv)).x);
    const edKey = (s) => S.importKey('pkcs8', cat(ED_PKCS8, s), { name: 'Ed25519' }, true, ['sign']);
    const mh = async (bytes) => 'u' + b64uOf(cat(Uint8Array.from([0x12, 0x20]), new Uint8Array(await S.digest('SHA-256', bytes))));
    const labels = new Map();
    const derive = (label) => {
        const canonical = canonicalLabel(label);
        if (canonical === null)
            return Promise.reject(new Error(`not a label of the closed registry (Identity §6.1): ${JSON.stringify(label)}`));
        let p = labels.get(canonical);
        if (!p) {
            p = (async () => {
                const ed = await edKey(await hkdf('rltp/anchor/ed/' + canonical));
                const x = await S.importKey('pkcs8', cat(X_PKCS8, await hkdf('rltp/anchor/x/' + canonical)), { name: 'X25519' }, true, ['deriveBits']);
                const anchor = 'did:key:z' + base58(cat(Uint8Array.from([0xed, 0x01]), await pubOf(ed)));
                const keyAgreement = 'z' + base58(cat(Uint8Array.from([0xec, 0x01]), await pubOf(x)));
                return { ed, x, anchor, keyAgreement };
            })();
            p.catch(() => labels.delete(canonical));
            labels.set(canonical, p);
        }
        return p;
    };
    // Identity §7a.4 and §13: the principal and the connection DID of one (N, C), derived together
    // from ONE copy of N taken at entry, so the two cannot come from different relationships
    const carriers = new Map();
    const carrierPair = (nonce, carrier) => {
        if (!validCarrierIdentifier(carrier))
            return Promise.reject(new Error('invalid carrier identifier (7a.2)'));
        if (!(nonce instanceof Uint8Array) || nonce.length !== 32)
            return Promise.reject(new Error('carrier nonce must be 32 bytes (7a.3)'));
        const n = new Uint8Array(nonce);
        const key = carrier + '\u0000' + b64uOf(n);
        let p = carriers.get(key);
        if (!p) {
            p = (async () => {
                const parts = await mh(te.encode(carrier)) + await mh(n);
                const priv = await edKey(await hkdf(CARRIER_INFO_PREFIX + parts));
                const principal = 'did:key:z' + base58(cat(Uint8Array.from([0xed, 0x01]), await pubOf(priv)));
                const connectionSeed = await hkdf(CONNECTION_INFO_PREFIX + parts);
                const connection = 'did:key:z' + base58(cat(Uint8Array.from([0xed, 0x01]), await pubOf(await edKey(connectionSeed))));
                const sign = Object.freeze(async (bytes) => new Uint8Array(await S.sign({ name: 'Ed25519' }, priv, new Uint8Array(bytes))));
                return { principal, sign, connection, connectionSeed: exportConnectionSeed ? connectionSeed : null };
            })();
            p.catch(() => carriers.delete(key));
            carriers.set(key, p);
        }
        return p;
    };
    // the derivation is cached; every caller gets its own frozen object, so changing one never changes another's
    const logins = new Map();
    return {
        async anchorOf(label) {
            const k = await derive(label);
            return { anchor: k.anchor, keyAgreement: k.keyAgreement };
        },
        async sign(label, bytes) {
            const k = await derive(label);
            return new Uint8Array(await S.sign({ name: 'Ed25519' }, k.ed, bytes));
        },
        async agree(rkid, epk, allowed) {
            // the release first, every call: the cache never answers for it
            const rel = allowed(rkid);
            if (rel.status === 'retired')
                return { status: 'retired' };
            if (rel.status !== 'live' || canonicalLabel(rel.label) === null)
                return { status: 'unknown' };
            // from here a failure is the host's (derivation, WebCrypto) and throws
            const k = await derive(rel.label);
            if (k.keyAgreement !== rkid)
                return { status: 'unknown' };
            if (!(epk instanceof Uint8Array) || epk.length !== 32)
                return { status: 'invalid' };
            let pub;
            try {
                pub = await S.importKey('raw', new Uint8Array(epk), { name: 'X25519' }, false, []);
            }
            catch (e) {
                if (e?.name === 'DataError')
                    return { status: 'invalid' };
                throw e;
            }
            let shared;
            try {
                shared = new Uint8Array(await S.deriveBits({ name: 'X25519', public: pub }, k.x, 256));
            }
            catch (e) {
                // WebCrypto refuses a low-order point with OperationError: the sender's fault
                if (e?.name === 'OperationError')
                    return { status: 'invalid' };
                throw e;
            }
            if (shared.every((b) => b === 0))
                return { status: 'invalid' };
            return { status: 'available', shared };
        },
        // DEVIATION D3: the stage-1 service identity, per person and group
        async serviceIdentity(group) {
            const priv = await edKey(await hkdf(SERVICE_IDENTITY_STAGE1_PREFIX + group));
            return 'did:key:z' + base58(cat(Uint8Array.from([0xed, 0x01]), await pubOf(priv)));
        },
        contentKey: (group) => hkdf(CONTENT_KEY_STAGE1_PREFIX + group),
        async sharedConnectMessaging(nonce) {
            if (!(nonce instanceof Uint8Array) || nonce.length !== 16)
                throw new RangeError('shared-connect nonce must be 16 bytes (the challenge this side minted)');
            const msgSeed = await hkdf(SHARED_CONNECT_STAGE1_PREFIX + 'messaging/' + await mh(new Uint8Array(nonce)));
            // the same two labels partyFromSeeds applies to the messaging seed (shared-connect.ts)
            const ed = await edFromSeed(await hkdfOf(msgSeed, 'shared-connect/messaging/ed25519', 32, S), S);
            const x = await xFromSeed(await hkdfOf(msgSeed, 'shared-connect/messaging/x25519', 32, S), S);
            return { ed: ed.pubRaw, x: x.pubRaw, sign: async (hashData) => new Uint8Array(await S.sign({ name: 'Ed25519' }, ed.priv, hashData)) };
        },
        async sharedConnectSeeds(nonce) {
            if (!(nonce instanceof Uint8Array) || nonce.length !== 16)
                throw new RangeError('shared-connect nonce must be 16 bytes (the challenge this side minted)');
            const n = await mh(new Uint8Array(nonce));
            return { messaging: await hkdf(SHARED_CONNECT_STAGE1_PREFIX + 'messaging/' + n), pair: await hkdf(SHARED_CONNECT_STAGE1_PREFIX + 'pair/' + n) };
        },
        // DEVIATION D6, EXPERIMENTAL: one identity per origin (two web apps on paths of one origin share it)
        async loginIdentity(origin) {
            const o = loginOrigin(origin);
            if (o === null)
                return Promise.reject(new TypeError('loginIdentity: the origin must be scheme://host[:port] over https or http'));
            let p = logins.get(o);
            if (!p) {
                p = (async () => {
                    const priv = await edKey(await hkdf(LOGIN_EXPERIMENTAL_PREFIX + await mh(te.encode(o))));
                    const did = 'did:key:z' + base58(cat(Uint8Array.from([0xed, 0x01]), await pubOf(priv)));
                    return { did, sign: async (bytes) => new Uint8Array(await S.sign({ name: 'Ed25519' }, priv, new Uint8Array(bytes))) };
                })();
                p.catch(() => logins.delete(o));
                logins.set(o, p);
            }
            const { did, sign } = await p;
            return Object.freeze({ did, sign });
        },
        async carrierPrincipal(nonce, carrier) {
            const p = await carrierPair(nonce, carrier);
            // its own frozen object per call: a caller changing one never changes another's
            return Object.freeze({ principal: p.principal, sign: p.sign });
        },
        // DEVIATION D7: the pair the profile has the adapter's factory derive, given by the provider
        async carrierContext(nonce, carrier) {
            const p = await carrierPair(nonce, carrier);
            const connection = Object.freeze({ did: p.connection, carrier });
            if (p.connectionSeed !== null)
                bindConnectionSeed(connection, p.connectionSeed);
            return Object.freeze({ carrier, principal: Object.freeze({ principal: p.principal, sign: p.sign }), connection });
        },
    };
}
