// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
import { findContact } from '../trust/state.js';
import { tupleByRkid } from '../receive.js';
export const MESSAGE_COMMANDS = Object.freeze({ block: 'message.block' });
/** The rate window of Message Tasks 4.2: any 24 hours. */
export const RATE_WINDOW = 86_400_000;
/** At most 20 invitations with a new credential digest per relationship
 *  and window (RLTP-MSG-4115, Membership RLTP-MT-3105). */
export const INVITE_RATE = 20;
const no = (code, ref) => ({ ok: false, code, ...(ref ? { ref } : {}) });
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** Whether the relationship is blocked (RLTP-MSG-6010). */
export const blockedRel = (state, relId) => state.messages.blocked.includes(relId);
/** The relationship id the own tuple key `rkid` belongs to now, or null. */
export const relOfRkid = (state, rkid) => tupleByRkid(state, rkid)?.rel.id ?? null;
/** Whether any relationship of the entry `id` names (by id or alias) is blocked. */
export const blockedContact = (state, id) => {
    const c = findContact(state, id);
    return c !== undefined && c.relIds.some((r) => blockedRel(state, r));
};
/** The blocked set with `relIds` set or cleared, sorted. */
export const withBlocked = (blocked, relIds, on) => (on ? [...new Set([...blocked, ...relIds])] : blocked.filter((r) => !relIds.includes(r))).sort(cmp);
/** The acceptance times of `kind` on the relationship inside the window before `when`. */
export const rateCount = (state, relId, kind, when) => (Object.hasOwn(state.messages.rates, relId) ? state.messages.rates[relId][kind] : []).filter((t) => t > when - RATE_WINDOW).length;
/** The state with one more acceptance of `kind` on the relationship at `when`, the window pruned. */
export function withRate(state, relId, kind, when) {
    const held = Object.hasOwn(state.messages.rates, relId) ? state.messages.rates[relId] : { invites: [] };
    const next = { ...held, [kind]: [...held[kind].filter((t) => t > when - RATE_WINDOW), when] };
    return { ...state, messages: { ...state.messages, rates: { ...state.messages.rates, [relId]: next } } };
}
/** The message state without the relationships `relIds` (a departure). */
export function withoutRelationships(state, relIds) {
    if (!relIds.some((r) => blockedRel(state, r) || Object.hasOwn(state.messages.rates, r)))
        return state;
    const rates = { ...state.messages.rates };
    for (const r of relIds)
        delete rates[r];
    return { ...state, messages: { ...state.messages, blocked: state.messages.blocked.filter((r) => !relIds.includes(r)), rates } };
}
// ── the block act (Section 6.1) ────────────────────────────────────────
const blockDef = {
    human: true,
    apply(state, _p, input) {
        if (typeof input?.contactId !== 'string' || typeof input.blocked !== 'boolean')
            throw new TypeError('message.block needs {contactId, blocked}');
        const c = findContact(state, input.contactId);
        if (!c)
            return no('unknown-contact');
        // every relationship of the entry (6020); unblocking deletes nothing
        // else and surfaces nothing (6510)
        const blocked = withBlocked(state.messages.blocked, c.relIds, input.blocked);
        return {
            state: { ...state, messages: { ...state.messages, blocked } },
            events: [{ type: 'contact.blocked', contactId: c.id, blocked: input.blocked }],
        };
    },
};
/** The message module createHolder registers. */
export function messageModule() {
    return Object.freeze({
        name: 'message',
        commands: Object.freeze({ [MESSAGE_COMMANDS.block]: blockDef }),
    });
}
