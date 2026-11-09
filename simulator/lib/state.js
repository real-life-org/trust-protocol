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
        sharedConnect: { enactments: {} },
        joining: { preludes: {}, invites: {}, surfaced: [], declined: [] },
        messages: { blocked: [], rates: {}, ready: [], records: {}, inbox: {} },
    };
}
/** `met` for the channels of a code read in one place, the encounter proper (shared-connect 0.1 §3) */
export const metByChannel = (channel) => channel === 'scan' || channel === 'displayed';
export function sharedConnectIndex(state) {
    const ix = new Map();
    for (const e of Object.values(state.sharedConnect.enactments))
        if (e.contactId !== null)
            ix.set('r-' + e.label.slice('pair/'.length), e);
    return ix;
}
/** the shared-connect origin of an entry, by its relationships; null when none came from an enactment */
export function sharedConnectOriginOf(state, contact, ix = sharedConnectIndex(state)) {
    const own = contact.relIds.map((r) => ix.get(r)).filter((e) => e !== undefined);
    if (!own.length)
        return null;
    const oldest = [...own].sort((a, b) => (a.openedAt - b.openedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
    const met = contact.relIds.some((r) => !ix.has(r)) || own.some((e) => metByChannel(e.channel));
    return { enactmentId: oldest.id, channel: oldest.channel, met };
}
