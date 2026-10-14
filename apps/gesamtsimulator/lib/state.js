// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
/** A fresh holder's state. */
export function emptyState(codec) {
    return {
        codec,
        commitSeq: '0',
        lastWhen: 0,
        register: { labels: [], pairNonces: {}, carriers: {}, devices: { names: [], revoked: [] }, community: null, lineage: [] },
        addresses: { keys: {}, tombstones: [] },
        contacts: {},
        relationships: {},
        entryOrder: { nextPos: '0', heads: [] },
        groups: {},
        profile: { body: null, revision: '0' },
        effects: {},
        outbox: {},
        duties: {},
        rotations: {},
        prompts: {},
        acts: {},
        encounter: { challenges: {}, records: {}, introductions: {} },
    };
}
