// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// trust/star — the star on the holder (lib Stage 2, PR 4b): star@2 as the
// registered task star/0.2 (5.1–5.2a), reconciled per recipient (5.4),
// and the machinery the group star (trust/group-star.ts) shares with it:
// the sender's salt scope, baseline automaton and in-flight deliveries,
// and the receiver's assembly per (tuple, salt). Graduated from
// probe/trust.ts (viewOf, buildStar, reconcile, starRefreshAll,
// refreshStarInfo, the star branch of receiveTrustDoc, the star branch of
// receiveAckInner) onto HolderState; probe/trust.ts stays as it is for the
// simulators until PR 7.
//
// Rule numbers: bare four-digit numbers are RLTP-TRU (trust-layer.md).
//
// What it registers (through trustModule, trust/mapping.ts):
//   sweep  trust.star    resume's reconciliation: per contact and live
//                        relationship, the view against the baseline;
//                        where they differ, the class is on and the scope
//                        can issue, one production under the next salt
//   task   star/0.2      (proof absent) reception: assembly, completion,
//                        the accepted snapshot
//   ack    star/0.2      completion of a salt by the verified acks of
//                        every chunk (5660)
//
// The sender (5.4). The view (5610/5620) is the set of (member, anchor
// head) over the admitted entries, member = the entry id, sorted by
// member; every recipient gets the same view. A production takes the
// snapshot, assigns lastSalt + 1, builds the chunks blinded under the
// tuple's pair secret (KeyProvider.agree on the tuple's rkid), stamps one
// fresh threadId on every chunk of the salt (entropy thread.id), and
// commits `lastSalt`, `inflight[salt] = {view, digests, acked: []}` and
// the outbox items in one transition (5090, 5110); the outbound leaves
// only after that commit. Chunk retries are the outbox's, byte-identical
// down to the envelope and the threadId (Delivery 4.2). Completion: the
// verified ack of a chunk marks it acked in its inflight entry; the last
// one runs the baseline automaton (5670): s > H sets H = s and S = the
// view sent under s, s ≤ H changes nothing; the salt and every in-flight
// salt at or below the new H leave `inflight`. No rollback (5680).
//
// Choices this file makes where note and spec leave them open:
//   - an available delivery contact (5690) is a resume. A divergence is
//     delivered once per view: no new salt while an in-flight salt above
//     H carries exactly the current view and none of its chunks has
//     failed (the outbox retries it byte-identical). A view that changes
//     again, or a delivery the outbox gives up (failed, its horizon or the
//     adapter's verdict) leaves the divergence standing, and the next
//     resume ships the current view under a fresh, higher salt (5680)
//   - completion counts verified delivery-acks only, never an adapter's
//     `delivered` report (ports.ts DeliveryReport, 5660)
//   - superseded salts are not withdrawn from the outbox: their retries
//     run to the horizon like any item (no trias state says "superseded"),
//     and the receiver refuses them (5150) or answers a cached duplicate
//   - the star goes on every live relationship of the contact (2820), the
//     active-head tuple of each, lagging ones included (6595); a contact
//     with no entry yet is a recipient like any other (2760: every contact)
//   - the scope cannot issue once `exhausted` (set by the commit that
//     issues 10¹⁸−1, 2600) and nothing is produced; state loss (5100) is
//     not modelled: a restored state carries its lastSalt
//   - a production whose key agreement is unavailable (the counterpart key
//     invalid or the own key not released) is skipped silently and stays
//     pending
//
// The receiver (5.2a). One open assembly per tuple and artifact
// (Tuple.starIn.assembly); its chunks are kept as {digest, threadId,
// body}. The checks, in order: the arrival tuple is a live active head
// (5360); salt above the completed high-water mark (5150) and above the
// lower bound (5366); not below the open assembly (5340); the MAC under
// the salt's key (5080); then against the assembly: a higher salt
// displaces it (5330); seq above the resource limit discards (5365);
// another threadId (5280), a repeated seq of other bytes (5260), a second
// last (5270), a seq beyond last (5290) reject the delivery; the same
// digest again is a repeat, acked, no change (5250). On completion the
// union must be strictly ascending (5300, 5310). A rejected or discarded
// delivery commits as a TaskDiscard (receive.ts): the assembly is
// dropped and its salt becomes the lower bound, so no later chunk of it
// is acked (5366). Every other chunk before completion is acked on its
// own (Delivery: every chunk is acked); only the completing chunk
// changes the accepted snapshot, advances hwm (5140, 5350) and announces
// star.accepted, all in its ack's transaction.
//
// Choices on the receiver side:
//   - the resource limit is a bound on seq: an open assembly holds at most
//     ASSEMBLY_LIMIT.star = 1024 chunks (≤ 1 048 576 entries); a chunk
//     with a higher seq discards the assembly (5365, 5366)
//   - a rejected delivery (5260–5310) is handled like a discarded one: its
//     salt becomes the lower bound, so the delivery cannot complete from
//     retries of its other chunks
//   - `accepted` keeps only what matched (6160): the blinded values equal
//     to HMAC(k, a) for an anchor `a` held for one of the holder's other
//     contacts (the entry's anchor head, every relationship's held head
//     and both ends of every held lineage link, 6390), and those contacts'
//     entry ids. Unmatched entries are not retained; a contact gained later
//     is matched at the next completed star
import { iso, jcs } from '../core.js';
import { digestDoc, xRawOfMk } from '../crypto.js';
import { seal } from '../delivery.js';
import { PLAINTEXT_MAX, blindAnchor, buildStarChunks, starChunkMacOk, starChunkOk, starKeyOf, strictlyAscending } from '../star.js';
import { tupleByRkid } from '../receive.js';
import { triasOf } from '../state.js';
import { ADMISSION_BOUND, activeTuple, classOnToward, entryRelationships, findContact } from './state.js';
/** The registered task type that carries star@2 (Delivery §4.4, 5640). */
export const STAR_TYPE = 'https://real-life.org/trust-tasks/star/0.2';
/** The receiver's resource limit (5365): the highest seq an open assembly
 *  takes, per artifact. */
export const ASSEMBLY_LIMIT = Object.freeze({ star: 1024, groupStar: 64 });
const te = new TextEncoder();
const inc = (d) => (BigInt(d) + 1n).toString();
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const refuse = (reason, ref) => ({ ok: false, reason, ...(ref ? { ref } : {}) });
const bodyOf = (chunk) => chunk.body;
/** Every contact's live relationships, by contact id, then relationship order. */
export function recipients(state) {
    const out = [];
    for (const contact of Object.values(state.contacts).sort((a, b) => cmp(a.id, b.id))) {
        for (const rel of entryRelationships(state, contact)) {
            if (rel.chainedInto !== null)
                continue;
            const tuple = activeTuple(rel);
            if (tuple && !tuple.deactivated)
                out.push({ contact, rel, tuple });
        }
    }
    return out;
}
/** 2600: the scope has issued its maximum, or would exceed the wire domain. */
const canIssue = (o) => !o.exhausted && BigInt(o.lastSalt) < ADMISSION_BOUND;
/** An in-flight salt above H carrying exactly this view, none of whose
 *  chunks has failed: the divergence is being delivered. */
const inFlight = (state, o, viewText) => Object.entries(o.inflight).some(([salt, f]) => BigInt(salt) > BigInt(o.hwm) && jcs(f.view) === viewText &&
    f.digests.every((d) => f.acked.includes(d) || (Object.hasOwn(state.outbox, d) && triasOf(state.outbox[d]) !== 'failed')));
/** A uniform view, once per contacts record (the record is replaced on
 *  every change of a contact, so the cache cannot go stale). */
const uniformViews = new WeakMap();
/** The view toward a recipient and its canonical text. */
function viewAt(art, state, r) {
    if (!art.uniform) {
        const view = art.view(state, r.contact, r.rel);
        return { view, text: jcs(view) };
    }
    let byKind = uniformViews.get(state.contacts);
    if (!byKind)
        uniformViews.set(state.contacts, (byKind = new Map()));
    let v = byKind.get(art.kind);
    if (!v) {
        const view = art.view(state, r.contact, r.rel);
        byKind.set(art.kind, (v = { view, text: jcs(view) }));
    }
    return v;
}
/** Whether the artifact is owed now on this recipient (5690–5720, 5830):
 *  the class on, the scope able to issue, the view diverging from the
 *  baseline (absent: by definition) and not already in flight. */
export function owed(art, state, r, viewText) {
    const o = art.out(r.tuple);
    if (!classOnToward(r.contact, art.cls) || !canIssue(o))
        return false;
    if (o.snapshot !== null && jcs(o.snapshot) === viewText)
        return false;
    return !inFlight(state, o, viewText);
}
/** The sweep's pending keys: one per owed recipient and view. */
export function pendingOf(art, state) {
    const keys = [];
    for (const r of recipients(state)) {
        if (!classOnToward(r.contact, art.cls))
            continue;
        const { text } = viewAt(art, state, r);
        if (owed(art, state, r, text))
            keys.push(`${art.kind}|${r.rel.id}|${r.tuple.ownPairLabel}|${text}`);
    }
    return keys;
}
/** A key agreement on the tuple's own rkid with the counterpart key, or null. */
async function pairShared(ctx, t, peerKeyAgreement = t.counterpartKeyAgreement) {
    const x = xRawOfMk(peerKeyAgreement);
    if (!x)
        return null;
    const a = await ctx.keys.agree(t.rkid, x, ctx.release);
    return a.status === 'available' ? a.shared : null;
}
/** Seal one chunk as its own document of the salt's thread (Delivery §4.4). */
async function chunkDocument(ctx, type, issuer, t, contactId, threadId, chunk) {
    const S = ctx.crypto.subtle;
    const doc = { id: ctx.entropy.id('doc.id'), type, issuer, recipient: t.counterpartAnchor, threadId, issuedAt: iso(ctx.when), payload: chunk };
    // 5190: within the Delivery Contract's plaintext limit, by construction
    if (te.encode(jcs(doc)).length > PLAINTEXT_MAX)
        throw new Error(`trust: a ${type} chunk exceeds ${PLAINTEXT_MAX} bytes`);
    const envelope = await seal(doc, t.counterpartKeyAgreement, { ephSeed: ctx.entropy.bytes('seal.eph', 32), nonce: ctx.entropy.bytes('seal.nonce', 12) }, S);
    return { digest: await digestDoc(doc, S), envelope, type, threadId, recipient: { contactId, rkid: t.rkid, keyAgreement: t.counterpartKeyAgreement } };
}
/** The reconciliation sweep of one artifact (5.4, 5730). */
export function sweepOf(art) {
    return {
        pending: (state) => pendingOf(art, state),
        async prepare(ctx) {
            const st = ctx.snapshot;
            const out = [];
            for (const r of recipients(st)) {
                if (!classOnToward(r.contact, art.cls))
                    continue;
                const { view, text: viewText } = viewAt(art, st, r);
                if (!owed(art, st, r, viewText))
                    continue;
                const shared = await pairShared(ctx, r.tuple);
                if (!shared)
                    continue;
                const own = (await ctx.keys.anchorOf(r.tuple.ownPairLabel)).anchor;
                const o = art.out(r.tuple);
                const salt = inc(o.lastSalt);
                const chunks = await art.build(ctx, { shared, own, tuple: r.tuple, salt, view });
                if (!chunks)
                    continue;
                // one salt = one thread: a fresh threadId on every chunk of it (Delivery §4.4)
                const threadId = ctx.entropy.id('thread.id');
                const outbound = [];
                for (const chunk of chunks)
                    outbound.push(await chunkDocument(ctx, art.type, own, r.tuple, r.contact.id, threadId, chunk));
                out.push({ relId: r.rel.id, tuple: r.tuple.ownPairLabel, contactId: r.contact.id, baseSalt: o.lastSalt, salt, view, viewText, outbound });
            }
            return out;
        },
        apply(state, prepared) {
            let cur = state;
            const outbound = [];
            let deferred = false;
            for (const p of prepared.value) {
                const rel = Object.hasOwn(cur.relationships, p.relId) ? cur.relationships[p.relId] : undefined;
                const contact = findContact(cur, p.contactId);
                const tuple = rel && activeTuple(rel);
                if (!rel || !contact || !tuple || tuple.ownPairLabel !== p.tuple || rel.chainedInto !== null || tuple.deactivated || !contact.relIds.includes(rel.id))
                    continue;
                const r = { contact, rel, tuple };
                const { text } = viewAt(art, cur, r);
                // 5110: the snapshot, the salt and the commit are one step — a
                // production prepared on another view or salt is not committed
                if (art.out(tuple).lastSalt !== p.baseSalt || text !== p.viewText || !owed(art, cur, r, text)) {
                    if (owed(art, cur, r, text))
                        deferred = true;
                    continue;
                }
                const o = art.out(tuple);
                const next = {
                    ...o, lastSalt: p.salt, exhausted: BigInt(p.salt) >= ADMISSION_BOUND,
                    inflight: { ...o.inflight, [p.salt]: { view: p.view, digests: p.outbound.map((d) => d.digest), acked: [] } },
                };
                const tuples = rel.tuples.map((t) => (t.ownPairLabel === p.tuple ? art.withOut(t, next) : t));
                cur = { ...cur, relationships: { ...cur.relationships, [rel.id]: { ...rel, tuples } } };
                outbound.push(...p.outbound);
            }
            return { state: cur, outbound, deferred };
        },
    };
}
/** Completion of a salt by the verified acks of all its chunks (5660),
 *  then the baseline automaton (5670). */
export function ackOf(art) {
    return (state, ref) => {
        const item = state.outbox[ref];
        const at = tupleByRkid(state, item.recipient.rkid);
        if (!at)
            return { state: state };
        const o = art.out(at.tuple);
        const hit = Object.entries(o.inflight).find(([, f]) => f.digests.includes(ref));
        if (!hit)
            return { state: state };
        const [salt, f] = hit;
        const acked = f.acked.includes(ref) ? f.acked : [...f.acked, ref];
        let next;
        if (f.digests.every((d) => acked.includes(d))) {
            const advance = BigInt(salt) > BigInt(o.hwm);
            const hwm = advance ? salt : o.hwm;
            const inflight = {};
            for (const [s, x] of Object.entries(o.inflight))
                if (s !== salt && BigInt(s) > BigInt(hwm))
                    inflight[s] = x;
            next = { ...o, hwm, snapshot: advance ? f.view : o.snapshot, inflight };
        }
        else
            next = { ...o, inflight: { ...o.inflight, [salt]: { ...f, acked } } };
        const tuples = at.rel.tuples.map((t) => (t.ownPairLabel === at.tuple.ownPairLabel ? art.withOut(t, next) : t));
        return { state: { ...state, relationships: { ...state.relationships, [at.rel.id]: { ...at.rel, tuples } } } };
    };
}
/** The arrival tuple, if it is the active head of a live relationship (6.4, 5360). */
function arrivalTuple(state, rkid) {
    const at = tupleByRkid(state, rkid);
    if (!at || at.tuple.deactivated || at.rel.chainedInto !== null || at.rel.activeHead !== at.tuple.ownPairLabel)
        return null;
    return at;
}
const maxDec = (a, b) => (BigInt(a) >= BigInt(b) ? a : b);
/** The task handler of one artifact (5.2a). */
export function taskOf(art, limit) {
    return {
        proof: 'absent',
        // stage 7: the closed chunk schema (5070, 5370)
        decode(payload) {
            return art.chunkOk(payload) ? payload : refuse('malformed', art.malformedRef);
        },
        // stage 8: the salt rules, the MAC, and the assembly decision
        async prepare(ctx, doc, arrival) {
            if (doc.ceremony?.enactment !== undefined)
                return refuse('validation-failed');
            const at = arrivalTuple(ctx.snapshot, arrival.rkid);
            if (!at)
                return refuse('validation-failed', 'RLTP-TRU-5360');
            const { rel, tuple: t } = at;
            const inn = art.inn(t);
            const body = bodyOf(doc.payload);
            const salt = BigInt(body.salt);
            if (salt <= BigInt(inn.hwm))
                return refuse('validation-failed', 'RLTP-TRU-5150');
            if (salt <= BigInt(inn.lowerBound))
                return refuse('validation-failed', 'RLTP-TRU-5366');
            if (inn.assembly && salt < BigInt(inn.assembly.salt))
                return refuse('validation-failed', 'RLTP-TRU-5340');
            const shared = await pairShared(ctx, t);
            if (!shared)
                return refuse('validation-failed', 'RLTP-TRU-5080');
            const own = (await ctx.keys.anchorOf(t.ownPairLabel)).anchor;
            if (!(await art.macOk(ctx, { shared, from: t.counterpartAnchor, own, salt: body.salt, chunk: doc.payload })))
                return refuse('validation-failed', 'RLTP-TRU-5080');
            const ids = { relId: rel.id, tuple: t.ownPairLabel };
            const reject = (ref) => ({ kind: 'reject', ...ids, salt: body.salt, ref });
            // a higher salt displaces the open assembly (5330)
            const base = inn.assembly && inn.assembly.salt === body.salt ? inn.assembly : { salt: body.salt, chunks: {} };
            const seq = BigInt(body.seq);
            if (seq > BigInt(limit))
                return reject('RLTP-TRU-5365');
            const held = Object.values(base.chunks);
            const same = Object.hasOwn(base.chunks, body.seq) ? base.chunks[body.seq] : undefined;
            if (same && same.digest === arrival.digest)
                return { kind: 'repeat' }; // 5250
            if (held.some((h) => h.threadId !== doc.threadId))
                return reject('RLTP-TRU-5280');
            if (same)
                return reject('RLTP-TRU-5260');
            const heldLast = held.find((h) => h.body.last);
            if (body.last && heldLast)
                return reject('RLTP-TRU-5270');
            const last = body.last ? seq : heldLast ? BigInt(heldLast.body.seq) : null;
            if (last !== null && (seq > last || held.some((h) => BigInt(h.body.seq) > last)))
                return reject('RLTP-TRU-5290');
            const chunks = { ...base.chunks, [body.seq]: { digest: arrival.digest, threadId: doc.threadId, body } };
            let complete = last !== null;
            for (let i = 1n; complete && i <= last; i++)
                if (!Object.hasOwn(chunks, String(i)))
                    complete = false;
            if (!complete)
                return { kind: 'hold', ...ids, assembly: { salt: body.salt, chunks } };
            // the completing chunk: the union in seq order, validated, evaluated
            const union = [];
            for (let i = 1n; i <= last; i++)
                union.push(...art.entries(chunks[String(i)].body));
            const done = await art.complete(ctx, { shared, from: t.counterpartAnchor, own, salt: body.salt, union, rel, tuple: t });
            if (!done.ok)
                return reject(done.ref);
            const contactId = (findContact(ctx.snapshot, t.entryId) ?? ctx.snapshot.contacts[rel.contactId])?.id ?? rel.contactId;
            return { kind: 'complete', ...ids, salt: body.salt, accepted: done.accepted, ...(done.memory ? { memory: done.memory } : {}), contactId };
        },
        // stage 9: the decision lands on the same snapshot
        apply(state, prepared) {
            const p = prepared.value;
            if (p.kind === 'repeat')
                return { state: state };
            const rel = state.relationships[p.relId];
            const t = rel.tuples.find((x) => x.ownPairLabel === p.tuple);
            const inn = art.inn(t);
            const put = (i, memory) => ({
                ...state,
                relationships: {
                    ...state.relationships,
                    [rel.id]: { ...rel, ...(memory ? { memory } : {}), tuples: rel.tuples.map((x) => (x.ownPairLabel === p.tuple ? art.withIn(x, i) : x)) },
                },
            });
            switch (p.kind) {
                case 'hold': return { state: put({ ...inn, assembly: p.assembly }) };
                case 'reject':
                    // the delivery cannot complete: discarded, its salt the lower bound (5365, 5366)
                    return { ...refuse('validation-failed', p.ref), state: put({ ...inn, assembly: null, lowerBound: maxDec(inn.lowerBound, p.salt) }) };
                case 'complete': {
                    const events = [{ type: art.kind === 'star' ? 'star.accepted' : 'groupStar.accepted', contactId: p.contactId, relationshipId: rel.id, salt: p.salt }];
                    return { state: put({ ...inn, hwm: p.salt, assembly: null, accepted: p.accepted }, p.memory ? { ...rel.memory, ...p.memory } : undefined), events };
                }
            }
        },
    };
}
/** A tuple with its open assemblies dropped, as its deactivation leaves
 *  it (5360): for chaining and departure (PR 4c). */
export const discardAssemblies = (t) => ({
    ...t,
    starIn: { ...t.starIn, assembly: null },
    groupStarIn: { ...t.groupStarIn, assembly: null },
    probeIn: { ...t.probeIn, assembly: null },
});
// ── the star ───────────────────────────────────────────────────────────
/** The reconciliation view of 5610/5620: (member, anchor head) of every
 *  admitted entry, member = the entry id, sorted by member. */
export function starView(state) {
    return Object.values(state.contacts)
        .filter((c) => c.status === 'admitted' && c.anchorHead !== null)
        .map((c) => ({ member: c.id, head: c.anchorHead }))
        .sort((a, b) => cmp(a.member, b.member));
}
/** Every anchor the holder holds for a contact (6160, 6390): the entry's
 *  head, each relationship's held head, both ends of every held link. */
export function heldAnchors(state, c) {
    const out = new Set();
    if (c.anchorHead !== null)
        out.add(c.anchorHead);
    for (const r of entryRelationships(state, c)) {
        if (r.heldCounterpartHead !== null)
            out.add(r.heldCounterpartHead);
        for (const l of r.links) {
            out.add(l.prev);
            out.add(l.next);
        }
    }
    return [...out].sort();
}
/** The star as an artifact (5.1–5.4). */
export const STAR = {
    kind: 'star',
    type: STAR_TYPE,
    cls: 'star',
    malformedRef: 'RLTP-TRU-5070',
    out: (t) => t.starOut,
    withOut: (t, o) => ({ ...t, starOut: o }),
    inn: (t) => t.starIn,
    withIn: (t, i) => ({ ...t, starIn: i }),
    view: (state) => starView(state),
    uniform: true,
    async build(ctx, p) {
        const S = ctx.crypto.subtle;
        const k = await starKeyOf(p.shared, p.own, p.tuple.counterpartAnchor, p.salt, S);
        return (await buildStarChunks(k, p.salt, p.view.map((v) => v.head), S));
    },
    chunkOk: starChunkOk,
    async macOk(ctx, p) {
        const S = ctx.crypto.subtle;
        return starChunkMacOk(await starKeyOf(p.shared, p.from, p.own, p.salt, S), p.chunk, S);
    },
    entries: (body) => body.blinded,
    async complete(ctx, p) {
        const union = p.union;
        if (!strictlyAscending(union))
            return { ok: false, ref: 'RLTP-TRU-5300' }; // 5300 order, 5310 duplicates
        const S = ctx.crypto.subtle;
        const k = await starKeyOf(p.shared, p.from, p.own, p.salt, S);
        const inStar = new Set(union);
        const sender = findContact(ctx.snapshot, p.tuple.entryId)?.id ?? p.rel.contactId;
        const blinded = new Set();
        const matches = [];
        for (const c of Object.values(ctx.snapshot.contacts).sort((a, b) => cmp(a.id, b.id))) {
            if (c.id === sender)
                continue;
            let hit = false;
            for (const a of heldAnchors(ctx.snapshot, c)) {
                const b = await blindAnchor(k, a, S);
                if (inStar.has(b)) {
                    hit = true;
                    blinded.add(b);
                }
            }
            if (hit)
                matches.push(c.id);
        }
        return { ok: true, accepted: { salt: p.salt, blinded: [...blinded].sort(), matches } };
    },
};
