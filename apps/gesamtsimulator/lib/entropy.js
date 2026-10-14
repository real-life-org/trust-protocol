// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// entropy — the Entropy port (lib Stage 2, note §3).
//
// Randomness by closed purpose: every value the library draws names
// what it is for, so a scripted run replays per purpose rather than by
// position in one byte stream. No domain decisions travel here: group
// rules are group state, human choices are act input. Entropy is drawn
// fresh per preparation; after a version conflict an act is prepared
// again, never a nonce reused under another plaintext.
//
// This is the ONLY file in src/ that touches the platform's generators
// (test/entropy-lint.test.mjs enforces it).
// Where the probe's old `ent` fields go (23 inputs: 22 `ent.*` fields and
// group-star's `rand`). Four are not entropy and leave the port: domain
// decisions are act input or group state (note §3).
//
//   ent.ephSeed         seal.eph           ent.id, ent.docId   doc.id
//   ent.sealNonce       seal.nonce         ent.threadId        thread.id
//   ent.envNonce        seal.nonce         ent.ackId           ack.id
//   ent.ch, .chA, .chB  challenge          ent.groupSeed       group.seed
//   ent.nonce, .nonceA, .nonceB            founding.nonce (pair-context nonce)
//   ent.foundingNonce   founding.nonce     ent.dropNonce       drop.nonce
//   ent.secret          rendezvous.secret  ent.pad             pad
//   group-star rand     groupstar.nonce (AEAD nonces), pad (filler d and c)
//   ent.vouchThreshold  not entropy: group rule, group state
//   ent.candidacy       not entropy: the human's choice, act input
//   ent.cls             not entropy: act input
//   ent.recipient       not entropy: act input
export const ENTROPY_PURPOSES = Object.freeze([
    'seal.eph', 'seal.nonce', 'doc.id', 'thread.id', 'ack.id', 'challenge',
    'group.seed', 'founding.nonce', 'drop.nonce', 'rendezvous.secret', 'groupstar.nonce', 'pad',
]);
export class EntropyError extends Error {
    code;
    purpose;
    constructor(code, purpose, message) {
        super(`entropy ${code} (${purpose}): ${message}`);
        this.name = 'EntropyError';
        this.code = code;
        this.purpose = purpose;
    }
}
const PURPOSES = new Set(ENTROPY_PURPOSES);
const checkPurpose = (purpose) => {
    if (!PURPOSES.has(purpose))
        throw new EntropyError('purpose', purpose, 'not an entropy purpose');
};
const checkLength = (purpose, n) => {
    if (!Number.isSafeInteger(n) || n < 0)
        throw new EntropyError('length', purpose, `invalid length ${n}`);
};
// getRandomValues fills at most 65536 bytes per call
const QUOTA = 65536;
/** Platform randomness; the crypto handle is resolved here, not at import. */
export function randomEntropy(c = globalThis.crypto) {
    if (typeof c?.getRandomValues !== 'function' || typeof c?.randomUUID !== 'function')
        throw new Error('randomEntropy: no WebCrypto getRandomValues/randomUUID in this runtime');
    return {
        bytes(purpose, n) {
            checkPurpose(purpose);
            checkLength(purpose, n);
            const out = new Uint8Array(n);
            for (let i = 0; i < n; i += QUOTA)
                c.getRandomValues(out.subarray(i, Math.min(n, i + QUOTA)));
            return out;
        },
        id(purpose) {
            checkPurpose(purpose);
            return c.randomUUID();
        },
    };
}
/**
 * Scripted entropy for vectors and tests: each purpose yields its values
 * in order (a single value is a list of one) and throws 'exhausted' when
 * it runs dry. bytes() needs a Uint8Array of exactly n bytes, id() a
 * string — anything else is 'mismatch'. Values are copied in and out.
 */
export function scriptedEntropy(script) {
    const queues = new Map();
    for (const [purpose, v] of Object.entries(script)) {
        checkPurpose(purpose);
        if (v === undefined)
            continue;
        queues.set(purpose, (Array.isArray(v) ? v : [v]).map((x) => (x instanceof Uint8Array ? x.slice() : x)));
    }
    const next = (purpose) => {
        checkPurpose(purpose);
        const q = queues.get(purpose);
        if (!q || q.length === 0)
            throw new EntropyError('exhausted', purpose, 'script ran dry');
        return q.shift();
    };
    return {
        bytes(purpose, n) {
            checkLength(purpose, n);
            const v = next(purpose);
            if (!(v instanceof Uint8Array) || v.length !== n)
                throw new EntropyError('mismatch', purpose, `expected ${n} bytes`);
            return v.slice();
        },
        id(purpose) {
            const v = next(purpose);
            if (typeof v !== 'string')
                throw new EntropyError('mismatch', purpose, 'expected a string id');
            return v;
        },
    };
}
