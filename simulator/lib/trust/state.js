// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
/** The deliverable set's bound, 10¹⁸−1 (2050): the wire-integer domain. */
export const ADMISSION_BOUND = 10n ** 18n - 1n;
/** The five classes, in the table's order (2720). */
export const CLASSES = Object.freeze(['star', 'groupStar', 'anchorMapping', 'sealedGroupStar', 'profile']);
/** 2760: star and blinded group star go to every contact, the anchor
 *  mapping to none, sealed group star and profile to the trusted contacts. */
export const classOn = (cls, setting, isTrusted) => {
    if (setting !== 'default')
        return setting === 'on';
    if (cls === 'star' || cls === 'groupStar')
        return true;
    if (cls === 'anchorMapping')
        return false;
    return isTrusted;
};
/** 2020: a trusted contact is one toward which the anchor mapping class is
 *  on; its default is no contact (2760), so only `on` makes one. */
export const trusted = (c) => c.settings.anchorMapping === 'on';
/** Whether `cls` is on toward the contact (2760, 2840). */
export const classOnToward = (c, cls) => classOn(cls, c.settings[cls], trusted(c));
/** The relationship's active-head tuple (6.4). */
export const activeTuple = (r) => r.tuples.find((t) => t.ownPairLabel === r.activeHead);
/** A contact by entry id or alias (2140). */
export const findContact = (state, id) => {
    if (Object.hasOwn(state.contacts, id))
        return state.contacts[id];
    return Object.values(state.contacts).find((c) => c.aliases.includes(id));
};
/** The entry's own relationships (Contact.relIds), as present in the state. */
export const entryRelationships = (state, c) => c.relIds.filter((id) => Object.hasOwn(state.relationships, id)).map((id) => state.relationships[id]);
/**
 * Whether a relationship lags in its entry (Section 2, 6595): its anchor
 * head is held in the entry as superseded, the `prev` of a link one of
 * the entry's relationships holds. `entry` is the entry's relationships,
 * `r` among them or not. A relationship with no anchor head never lags.
 */
export const lags = (r, entry) => r.heldCounterpartHead !== null && entry.some((o) => o.links.some((l) => l.prev === r.heldCounterpartHead));
/**
 * The newest anchor heads of a set of relationships (6560): the heads from
 * which no other head is reachable along the links they hold. One entry's
 * relationships yield exactly one where the head rule and the binding rule
 * admitted every merge (6605); a manual merge (6640) may yield more until
 * its split (2080, PR 4c).
 */
export function newestHeads(rels) {
    const next = new Map();
    for (const r of rels)
        for (const l of r.links)
            next.set(l.prev, [...(next.get(l.prev) ?? []), l.next]);
    const reaches = (from, to) => {
        const seen = new Set();
        const todo = [...(next.get(from) ?? [])];
        while (todo.length) {
            const n = todo.pop();
            if (n === to)
                return true;
            if (!seen.has(n)) {
                seen.add(n);
                todo.push(...(next.get(n) ?? []));
            }
        }
        return false;
    };
    const heads = [...new Set(rels.map((r) => r.heldCounterpartHead).filter((h) => h !== null))];
    return heads.filter((h) => !heads.some((o) => o !== h && reaches(h, o)));
}
