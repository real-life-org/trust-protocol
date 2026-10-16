// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
export class InMemoryStore {
    #state = null;
    #version = null;
    #n = 0;
    async read() {
        return { state: structuredClone(this.#state), version: this.#version };
    }
    async commit(version, next) {
        if (version !== this.#version)
            return { ok: false, reason: 'conflict' };
        const copy = structuredClone(next);
        this.#state = copy;
        this.#version = `m${++this.#n}`;
        return { ok: true, version: this.#version };
    }
}
