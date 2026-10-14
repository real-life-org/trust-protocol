// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// views — what an app reads: pure projections of the holder's state
// (lib Stage 2, note §4.5).
//
// `state → View`, synchronous, without the engine: every function here
// reads one state and returns fresh, deep-frozen objects that share no
// reference with it, so a UI can keep them and the state stays untouched.
// Each view carries the commitSeq of the state it was read from; views of
// one snapshot belong together. The holder hands them out over its
// snapshot (holder-api.ts); after a `subscribe` announcement the app
// re-reads them. Views never write: whatever ages state (expiry, the
// encounter's aging latch) is an act, never a read.
//
// Rule numbers: bare four-digit numbers are RLTP-TRU (trust-layer.md).
//
// Choices this file makes where the note leaves them open:
//   - contacts are listed in entry-commit order (2120); entries without a
//     position (2060) follow, by id. A contact is found by its entry id or
//     by any of its aliases (2140)
//   - provenance and via come from the contact's oldest relationship (by
//     its provenance time, then id): how the person came, not how often
//   - verification is over every tuple of every relationship of the
//     contact: `outgoing` an anchor mapping was issued (mappingOut), and
//     `incoming` one was verified (mappingIn), `mutual` both, `met` neither
//   - trust.given is the anchor mapping class on (the Trust act, 2770);
//     trust.received a verified anchor mapping from the contact, whose
//     class has no default recipient (2760); trust.paused the pause of 5.4,
//     star and blinded group star both `off` (2780); trust.pending: given,
//     but not yet out on every live relationship (no mapping issued on its
//     active head, the relationship lags (6595), or a re-issue or class-on
//     duty for the anchor mapping is open). Delivery of the documents is
//     not part of it; deliveryStatus answers that
//   - classes give the setting and whether the class is on toward the
//     contact (2760, 2840); per-group settings of the sealed group star
//     (2830) are not projected yet
//   - a contact's profile is the verified profile@1 body (6b.2) of its
//     tuple with the highest revision; displayName is that profile's name
//   - deliveryStatus(x) lists the outbox items whose digest or threadId is
//     x, by first submission, then digest; an unknown x lists none
//   - a contact without a relationship breaks an invariant and throws
import { freezeDeep } from './engine.js';
import { triasOf } from './state.js';
// ── helpers ────────────────────────────────────────────────────────────
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const cmpDec = (a, b) => { const x = BigInt(a), y = BigInt(b); return x < y ? -1 : x > y ? 1 : 0; };
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
/** The string fields of a profile body that a view shows. */
const profileFields = (body) => {
    const out = {};
    if (!isObj(body))
        return out;
    for (const k of ['name', 'image', 'text'])
        if (typeof body[k] === 'string')
            out[k] = body[k];
    return out;
};
const CLASSES = ['star', 'groupStar', 'anchorMapping', 'sealedGroupStar', 'profile'];
/** 2760: star and blinded group star go to every contact, the anchor
 *  mapping to none, sealed group star and profile to the trusted contacts. */
const classOn = (cls, setting, trusted) => {
    if (setting !== 'default')
        return setting === 'on';
    if (cls === 'star' || cls === 'groupStar')
        return true;
    if (cls === 'anchorMapping')
        return false;
    return trusted;
};
const relationshipsOf = (state, c) => {
    const rels = c.relIds.filter((id) => Object.hasOwn(state.relationships, id)).map((id) => state.relationships[id]);
    if (!rels.length)
        throw new Error(`views: contact ${c.id} has no relationship`);
    return rels;
};
const activeTuple = (r) => r.tuples.find((t) => t.ownPairLabel === r.activeHead);
/** A relationship lags where its anchor head is held in its entry as
 *  superseded: the prev of a link one of the entry's relationships holds. */
const lags = (r, rels) => r.heldCounterpartHead !== null && rels.some((o) => o.links.some((l) => l.prev === r.heldCounterpartHead));
const findContact = (state, id) => {
    if (Object.hasOwn(state.contacts, id))
        return state.contacts[id];
    return Object.values(state.contacts).find((c) => c.aliases.includes(id));
};
const project = (state, c) => {
    const rels = relationshipsOf(state, c);
    const tuples = rels.flatMap((r) => r.tuples);
    const origin = [...rels].sort((a, b) => (a.provenance.at - b.provenance.at) || cmp(a.id, b.id))[0];
    const out = tuples.some((t) => t.mappingOut.body !== null);
    const inn = tuples.some((t) => t.mappingIn.body !== null);
    const trusted = c.settings.anchorMapping === 'on';
    const classes = {};
    for (const cls of CLASSES)
        classes[cls] = { setting: c.settings[cls], on: classOn(cls, c.settings[cls], trusted) };
    const live = rels.filter((r) => r.chainedInto === null);
    const owed = Object.values(state.duties).some((d) => (d.kind === 'reissue-mapping' && d.contactId === c.id) ||
        (d.kind === 'class-on' && d.contactId === c.id && d.cls === 'anchorMapping'));
    const pending = trusted && (owed || live.some((r) => {
        const t = activeTuple(r);
        if (!t || t.deactivated)
            return false;
        return t.mappingOut.body === null || lags(r, rels);
    }));
    let best;
    for (const t of tuples) {
        if (t.profileIn.body === null)
            continue;
        if (!best || cmpDec(t.profileIn.rev, best.profileIn.rev) > 0 ||
            (cmpDec(t.profileIn.rev, best.profileIn.rev) === 0 && cmpDec(t.profileIn.verifiedSeq, best.profileIn.verifiedSeq) > 0))
            best = t;
    }
    const profile = best ? { revision: best.profileIn.rev, ...profileFields(best.profileIn.body) } : undefined;
    return {
        commitSeq: state.commitSeq,
        id: c.id,
        aliases: [...c.aliases],
        ...(profile?.name !== undefined ? { displayName: profile.name } : {}),
        provenance: origin.provenance.kind,
        ...(origin.provenance.kind === 'introduced' && origin.provenance.via !== undefined ? { via: origin.provenance.via } : {}),
        verification: out && inn ? 'mutual' : out ? 'outgoing' : inn ? 'incoming' : 'met',
        trust: {
            given: trusted,
            received: inn,
            paused: c.settings.star === 'off' && c.settings.groupStar === 'off',
            pending,
        },
        classes,
        ...(profile ? { profile } : {}),
    };
};
const itemView = (digest, it) => {
    const status = triasOf(it);
    const last = it.history[it.history.length - 1];
    let decisive;
    for (let i = it.history.length - 1; i >= 0 && !decisive; i--)
        if (it.history[i].status !== 'awaiting-transport')
            decisive = it.history[i];
    const v = {
        digest, type: it.type, threadId: it.threadId, contactId: it.recipient.contactId, status,
        attempt: it.attempt, submittedAt: it.history[0]?.at ?? 0, updatedAt: last?.at ?? 0,
    };
    if (last?.status === 'awaiting-transport')
        v.awaiting = last.reason;
    if (decisive?.status === 'delivered')
        v.late = decisive.late;
    if (decisive?.status === 'failed') {
        v.reason = decisive.reason;
        if (decisive.reason === 'rejected-by-receiver')
            v.code = decisive.code;
    }
    if (it.nextAttemptAt !== undefined)
        v.nextAttemptAt = it.nextAttemptAt;
    return v;
};
// ── the views ──────────────────────────────────────────────────────────
/** Every contact, in entry-commit order (2120), then by id. */
export function contactsView(state) {
    const order = Object.values(state.contacts).sort((a, b) => {
        if (a.pos !== null && b.pos !== null)
            return cmpDec(a.pos, b.pos) || cmp(a.id, b.id);
        if (a.pos !== null)
            return -1;
        if (b.pos !== null)
            return 1;
        return cmp(a.id, b.id);
    });
    return freezeDeep(order.map((c) => project(state, c)));
}
/** One contact by entry id or alias; undefined if there is none. */
export function contactView(state, id) {
    const c = findContact(state, id);
    return c ? freezeDeep(project(state, c)) : undefined;
}
/** The holder's groups, by genesis digest. */
export function groupsView(state) {
    return freezeDeep(Object.values(state.groups).sort((a, b) => cmp(a.id, b.id)).map((g) => ({
        commitSeq: state.commitSeq, id: g.id, listed: g.listed, vouchThreshold: g.rules.vouchThreshold,
    })));
}
/** The holder's own profile. */
export function profileView(state) {
    return freezeDeep({ commitSeq: state.commitSeq, revision: state.profile.revision, ...profileFields(state.profile.body) });
}
/** The open prompts, by opening time, then id. Expired prompts stay
 *  listed until tick removes them; deciding one is refused. */
export function promptsView(state) {
    return freezeDeep(Object.values(state.prompts).sort((a, b) => (a.openedAt - b.openedAt) || cmp(a.id, b.id)).map((p) => ({
        commitSeq: state.commitSeq, id: p.id, kind: p.kind,
        ...(p.contactId !== undefined ? { contactId: p.contactId } : {}),
        ...(p.groupId !== undefined ? { groupId: p.groupId } : {}),
        openedAt: p.openedAt,
        ...(p.expiresAt !== undefined ? { expiresAt: p.expiresAt } : {}),
    })));
}
/** The sender status of the documents whose digest or threadId is `x`. */
export function deliveryStatusView(state, x) {
    const items = Object.entries(state.outbox)
        .filter(([digest, it]) => digest === x || it.threadId === x)
        .map(([digest, it]) => itemView(digest, it))
        .sort((a, b) => (a.submittedAt - b.submittedAt) || cmp(a.digest, b.digest));
    return freezeDeep({ commitSeq: state.commitSeq, items });
}
