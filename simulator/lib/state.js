// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
import { channelOf } from './shared-connect.js';
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
const CHANNELS = ['scan', 'displayed', 'link', 'sent'];
/** a code read in one place, this side */
export const metByChannel = (channel) => channel === 'scan' || channel === 'displayed';
/** the counterpart's channel from the credential it issued (the one of the four values; null for none, or a value outside them) */
export function theirChannelOf(e) {
    const issue = e.flow.issueTheirs;
    const ch = channelOf(issue?.payload?.vrc);
    return CHANNELS.includes(ch) ? ch : null;
}
/** both sides state a code read in one place */
export const metInEnactment = (e) => {
    const theirs = theirChannelOf(e);
    return metByChannel(e.channel) && theirs !== null && metByChannel(theirs);
};
export function sharedConnectIndex(state) {
    const ix = new Map();
    for (const e of Object.values(state.sharedConnect.enactments))
        if (e.contactId !== null)
            ix.set(e.label, e);
    return ix;
}
/** the shared-connect origin of an entry, by the tuples of its relationships (a husk without tuples
 *  says nothing); null when none came from an enactment. A tuple under no enactment (an encounter,
 *  an introduction; a deactivated one too, historical evidence) means the entry met. One derivation
 *  for the contact view and for the trust check (`not-met`). */
export function sharedConnectOriginOf(state, contact, ix = sharedConnectIndex(state)) {
    const own = [];
    let other = false;
    for (const relId of contact.relIds) {
        for (const t of state.relationships[relId]?.tuples ?? []) {
            const e = ix.get(t.ownPairLabel);
            if (e)
                own.push(e);
            else
                other = true;
        }
    }
    if (!own.length)
        return null;
    const oldest = [...own].sort((a, b) => (a.openedAt - b.openedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
    const met = other || own.some(metInEnactment);
    return { enactmentId: oldest.id, channel: oldest.channel, theirChannel: theirChannelOf(oldest), met };
}
