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
