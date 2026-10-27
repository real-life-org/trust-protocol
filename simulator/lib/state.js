// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
/** The structural state as the opaque one, for the store and the facade. */
export const toOpaque = (s) => s;
/** An outbox item's trias position (Delivery §6.1): its last step that is
 *  not pre-transport, `submitted` before any. */
export function triasOf(item) {
    for (let i = item.history.length - 1; i >= 0; i--) {
        const s = item.history[i].status;
        if (s !== 'awaiting-transport')
            return s;
    }
    return 'submitted';
}
/** Whether the item is `accepted` with the feature `held` (Delivery
 *  RLTP-DEL-6140): no horizon ends it, only a valid acknowledgement or a
 *  validated terminal refusal. */
export function heldOf(item) {
    return triasOf(item) === 'accepted' && item.history.some((s) => s.status === 'accepted' && s.held === true);
}
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
        encounter: { challenges: {}, records: {}, introductions: {}, offers: {}, designators: {}, declarations: {} },
        joining: { preludes: {}, invites: {}, surfaced: [], declined: [] },
        messages: { blocked: [], rates: {}, ready: [], records: {}, inbox: {} },
    };
}
