// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
/** A failure of a port the host provides, never of the protocol. */
export class InfraError extends Error {
    code;
    constructor(code, message, options) {
        super(message ?? code, options);
        this.name = 'InfraError';
        this.code = code;
    }
}
/** The WebCrypto handle lacks what the library needs; raised when a
 *  holder is built, never at import (note §3 Crypto). */
export class CryptoUnavailableError extends Error {
    /** the algorithms (or 'subtle' itself) that are missing, in a fixed order */
    missing;
    constructor(missing) {
        super(`WebCrypto lacks: ${missing.join(', ')} (needs Ed25519, X25519, HKDF, HMAC, AES-GCM, SHA-256)`);
        this.name = 'CryptoUnavailableError';
        this.missing = Object.freeze([...missing]);
    }
}
