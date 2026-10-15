// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
import { classOnToward, entryOf, entryRelationships, lags, liveRel } from './state.js';
import { isKnownDuty } from '../codec.js';
/** The classes a class-on duty delivers (2850), in the table's order. */
export const DUTY_CLASSES = Object.freeze(['anchorMapping', 'profile']);
/** The classes the reconciliation of 5.4 delivers. */
export const RECONCILED = Object.freeze(['star', 'groupStar', 'sealedGroupStar']);
/** The class-on duty's deterministic id. */
export const classOnId = (cls, relId) => `class-on:${cls}:${relId}`;
/** The profile revision duty's deterministic id (6455). */
export const profileDutyId = (relId) => `profile:${relId}`;
/** The class a duty delivers on one relationship, or null for every other
 *  kind — and for a known kind at a version this library does not handle,
 *  which stays opaque: never moved, dropped or checked (note §2.1). */
export function classOfDuty(d) {
    if (!isKnownDuty(d))
        return null;
    if (d.kind === 'class-on')
        return d.cls;
    if (d.kind === 'reissue-mapping')
        return 'anchorMapping';
    if (d.kind === 'profile')
        return 'profile';
    return null;
}
/** Is `d` a duty of a duty class owed on `relId` (of class `cls`, where given)? */
export const owedOn = (d, relId, cls) => {
    const c = classOfDuty(d);
    return c !== null && (cls === undefined || c === cls) && d.relId === relId;
};
/** Whether the class has an artifact to send now: the profile once one exists. */
export const hasArtifact = (state, cls) => cls !== 'profile' || state.profile.body !== null;
/**
 * Whether `cls` is on for relationship `r` (2850, 6595): on toward the
 * entry its verifications go to, the relationship live, and, except for
 * the star and the blinded group star, not lagging in that entry.
 */
export function onFor(state, r, cls) {
    if (!liveRel(r))
        return false;
    const c = entryOf(state, r);
    if (!c || !c.relIds.includes(r.id) || !classOnToward(c, cls))
        return false;
    if (cls === 'star' || cls === 'groupStar')
        return true;
    return !lags(r, entryRelationships(state, c));
}
/** A class-on duty of `cls` on `relId`, unless one is open in `state` or among `extra`. */
export function classOnDuty(state, contactId, relId, cls, extra = []) {
    const id = classOnId(cls, relId);
    if (Object.hasOwn(state.duties, id) || extra.some((d) => d.id === id))
        return [];
    return [{ kind: 'class-on', v: 1, id, contactId, relId, cls }];
}
/** The drop rule (6410, 2790): every duty of a duty class owed on a
 *  relationship whose entry has that class off goes; `extra` (duties a
 *  transition is about to open) is filtered the same way. */
export function dropOff(state, extra = []) {
    const off = (d) => {
        const cls = classOfDuty(d);
        if (cls === null)
            return false;
        const relId = d.relId;
        if (!Object.hasOwn(state.relationships, relId))
            return false;
        const r = state.relationships[relId];
        if (r.chainedInto !== null)
            return false; // moved at the chaining
        const c = entryOf(state, r);
        return c !== undefined && !classOnToward(c, cls);
    };
    const gone = Object.values(state.duties).filter(off);
    const next = gone.length
        ? { ...state, duties: Object.fromEntries(Object.entries(state.duties).filter(([, d]) => !off(d))) }
        : state;
    return { state: next, extra: extra.filter((d) => !off(d)) };
}
/**
 * The follow rule (see the header) over a transition from `before` to
 * `after`: the drop rule on `after`, then a class-on duty for every live
 * relationship and duty class on for it now and not before. `extra` are
 * the duties the transition opens besides (kept, deduplicated against);
 * the result's `duties` are those and the new ones.
 */
export function followClasses(before, after, extra = []) {
    const d = dropOff(after, extra);
    const state = d.state;
    const duties = [...d.extra];
    for (const id of Object.keys(state.relationships).sort()) {
        const r = state.relationships[id];
        if (!liveRel(r))
            continue;
        const was = Object.hasOwn(before.relationships, id) ? before.relationships[id] : undefined;
        for (const cls of DUTY_CLASSES) {
            if (!hasArtifact(state, cls) || !onFor(state, r, cls))
                continue;
            if (was && onFor(before, was, cls))
                continue;
            duties.push(...classOnDuty(state, entryOf(state, r).id, id, cls, duties));
        }
    }
    return { state, duties };
}
/**
 * The move at a chaining (6a.4, 2146): the class duties owed on `from`
 * (the chain, then the appended relationship) go to `relId` under
 * `contactId`, none dropped. Several re-issues are one (6596: one delivery
 * meets every re-issue owed), its urgency kept: the earliest dueAt (absent:
 * at once) and the most urgent awaited head (null, due at once, wins; else
 * the first's); several class-on duties of one class are one; several
 * profile duties are one, at the highest revision.
 */
export function moveDuties(state, from, relId, contactId) {
    const owed = Object.values(state.duties)
        .filter((d) => classOfDuty(d) !== null && from.includes(d.relId))
        .sort((a, b) => from.indexOf(a.relId) - from.indexOf(b.relId));
    if (!owed.length)
        return state;
    const duties = { ...state.duties };
    for (const d of owed)
        delete duties[d.id];
    const reissues = owed.filter((d) => d.kind === 'reissue-mapping');
    if (reissues.length) {
        // urgency kept: due at the earliest of them (absent: at once), not
        // waiting where any was due without a wait
        const { dueAt: _, ...base } = reissues[0];
        const awaitHead = reissues.some((d) => d.awaitHead === null) ? null : base.awaitHead;
        const dues = reissues.map((d) => d.dueAt);
        const dueAt = dues.some((x) => x === undefined) ? undefined : Math.min(...dues);
        duties[base.id] = { ...base, contactId, relId, awaitHead, ...(dueAt !== undefined ? { dueAt } : {}) };
    }
    for (const d of owed.filter((x) => x.kind === 'class-on')) {
        const id = classOnId(d.cls, relId);
        if (!Object.hasOwn(duties, id))
            duties[id] = { ...d, id, contactId, relId };
    }
    const profiles = owed.filter((d) => d.kind === 'profile');
    if (profiles.length) {
        const top = profiles.reduce((a, b) => (BigInt(b.rev) > BigInt(a.rev) ? b : a));
        const id = profileDutyId(relId);
        const held = Object.hasOwn(duties, id) ? duties[id] : undefined;
        if (!held || BigInt(top.rev) > BigInt(held.rev))
            duties[id] = { ...top, id, contactId, relId };
    }
    return { ...state, duties };
}
/** 6465: after a chaining, the profile's class-on duty on the chain where
 *  the class is on for it and a profile exists. */
export function afterChain(state, relId, extra) {
    const r = state.relationships[relId];
    if (!r || !hasArtifact(state, 'profile') || !onFor(state, r, 'profile'))
        return [];
    return classOnDuty(state, entryOf(state, r).id, relId, 'profile', extra);
}
/**
 * The class-on/1 handler: a reconciled class is fulfilled without sending
 * (its sweep runs in the same resume after the duties, 5850); a class with
 * a handler in `byClass` runs it; any other (the profile until PR 6) waits.
 */
export function classOnHandler(byClass) {
    const of = (d) => d.cls;
    return {
        v: 1,
        prepare: (ctx, duty) => {
            const h = byClass[of(duty)];
            return h?.prepare ? h.prepare(ctx, duty) : Promise.resolve(null);
        },
        apply(state, duty, ctx, when) {
            const cls = of(duty);
            if (RECONCILED.includes(cls))
                return { state: state };
            const h = byClass[cls];
            return h ? h.apply(state, duty, ctx, when) : 'not-due';
        },
    };
}
/** profile/1 (6455): a stub until profile@1 graduates in PR 6. The duty
 *  is opened, moved and dropped by the rules above; delivering it waits. */
export const profileDuty = Object.freeze({ v: 1, apply: () => 'not-due' });
/** Every relationship of `c` the class is on for (2820, 2850): for tests and views. */
export const onRelationships = (state, c, cls) => entryRelationships(state, c).filter((r) => onFor(state, r, cls)).map((r) => r.id);
