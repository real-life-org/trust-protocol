// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
import { activeTuple, entryOf, findContact, liveRel, tupleByLabel } from '../trust/state.js';
import { tupleByRkid } from '../receive.js';
import { calOK, iso } from '../core.js';
import { digestDoc, xRawOfMk } from '../crypto.js';
import { seal } from '../delivery.js';
import { INBOX_BOUND, MESSAGE_FUTURE_MS, MESSAGE_LIFETIME_MS, MESSAGE_RATE, MESSAGE_SENDER_LIFETIME_MS, MESSAGE_TYPE, messageKeyOf, messageMac, messageShapeOk, } from '../message.js';
export const MESSAGE_COMMANDS = Object.freeze({ send: 'message.send', block: 'message.block', take: 'message.take' });
/** The rate window of Message Tasks 4.2: any 24 hours. */
export const RATE_WINDOW = 86_400_000;
/** At most 20 invitations with a new credential digest per relationship
 *  and window (RLTP-MSG-4115, Membership RLTP-MT-3105). */
export const INVITE_RATE = 20;
const no = (code, ref) => ({ ok: false, code, ...(ref ? { ref } : {}) });
const refuse = (reason, ref) => ({ ok: false, reason, ...(ref ? { ref } : {}) });
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
    const held = Object.hasOwn(state.messages.rates, relId) ? state.messages.rates[relId] : { invites: [], messages: [] };
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
// ── the message: sending (Section 5) ───────────────────────────────────
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Whether the tuple is ready (5.1): a document of its counterpart was accepted on it. */
export const tupleReady = (state, label) => state.messages.ready.includes(label);
/** The relationships a message to the entry may go on: live, their active
 *  head feeding the entry (5010), in the entry's order. */
function channelsOf(state, contactId) {
    const c = findContact(state, contactId);
    if (!c)
        return null;
    const ids = new Set([c.id, ...c.aliases]);
    const out = [];
    for (const id of c.relIds) {
        const rel = state.relationships[id];
        const t = rel && liveRel(rel) ? activeTuple(rel) : undefined;
        if (t && !t.deactivated && ids.has(t.entryId))
            out.push({ rel, tuple: t });
    }
    return out;
}
/** Where a message to the contact goes now, or why it cannot (5010–5030):
 *  the first unblocked, ready channel. */
export function messageChannel(state, contactId) {
    const all = channelsOf(state, contactId);
    if (all === null)
        return no('unknown-contact');
    if (!all.length)
        return no('no-own-channel', 'RLTP-MSG-5010');
    const open = all.filter((x) => !blockedRel(state, x.rel.id));
    if (!open.length)
        return no('blocked', 'RLTP-MSG-5030');
    return open.find((x) => tupleReady(state, x.tuple.ownPairLabel)) ?? no('not-ready', 'RLTP-MSG-5020');
}
const isRefusal = (x) => x?.ok === false;
const sendDef = {
    human: true,
    async prepare(ctx, input) {
        if (typeof input?.contactId !== 'string' || typeof input.text !== 'string')
            throw new TypeError('message.send needs {contactId, text}');
        const n = [...input.text].length;
        if (n < 1 || n > 4096 || (input.replyTo !== undefined && (typeof input.replyTo !== 'string' || !UUID4.test(input.replyTo))))
            return no('message-invalid', 'RLTP-MSG-3020');
        const s = ctx.snapshot;
        const ch = messageChannel(s, input.contactId);
        if (isRefusal(ch))
            return ch;
        const S = ctx.crypto.subtle;
        const own = await ctx.keys.anchorOf(ch.tuple.ownPairLabel);
        const raw = xRawOfMk(ch.tuple.counterpartKeyAgreement);
        const a = raw ? await ctx.keys.agree(ch.tuple.rkid, raw, ctx.release) : null;
        if (!a || a.status !== 'available')
            return no('no-own-channel', 'RLTP-MSG-3110');
        const key = await messageKeyOf(a.shared, own.anchor, ch.tuple.counterpartAnchor, S);
        // sentAt in whole seconds (3030), the sender's clock
        const sec = Math.floor(ctx.when / 1000) * 1000;
        const body = {
            type: 'message@1', mid: ctx.entropy.id('message.mid'), sentAt: iso(sec), text: input.text,
            ...(input.replyTo !== undefined ? { replyTo: input.replyTo } : {}),
        };
        const payload = { body, proof: { mac: await messageMac(key, body, S) } };
        const doc = {
            id: ctx.entropy.id('doc.id'), type: MESSAGE_TYPE, issuer: own.anchor, recipient: ch.tuple.counterpartAnchor,
            threadId: ctx.entropy.id('thread.id'), issuedAt: iso(ctx.when), payload,
        };
        const envelope = await seal(doc, ch.tuple.counterpartKeyAgreement, { ephSeed: ctx.entropy.bytes('seal.eph', 32), nonce: ctx.entropy.bytes('seal.nonce', 12) }, S);
        const contactId = entryOf(s, ch.rel)?.id ?? ch.rel.contactId;
        return {
            mid: body.mid, contactId,
            draft: {
                digest: await digestDoc(doc, S), envelope, type: MESSAGE_TYPE, threadId: doc.threadId,
                recipient: { contactId, rkid: ch.tuple.rkid, keyAgreement: ch.tuple.counterpartKeyAgreement },
                // the sender's give-up a day before the age bound (5110, Delivery 7020)
                expiresAt: sec + MESSAGE_SENDER_LIFETIME_MS,
            },
        };
    },
    apply(state, prepared) {
        const p = prepared.value;
        if (isRefusal(p))
            return p;
        return { state: state, outbound: [p.draft], events: [{ type: 'message.sent', contactId: p.contactId, mid: p.mid, digest: p.draft.digest }] };
    },
};
// ── the message: reception (Section 4) ─────────────────────────────────
/** The inbox entries of the relationship `relId` (through their tuples now). */
const inboxCount = (state, relId) => Object.values(state.messages.inbox).filter((e) => tupleByLabel(state, e.tuple)?.rel.id === relId).length;
const messageTask = {
    proof: 'absent',
    // stage 7: the closed form (4010); the calendar is a verifier's check (3030)
    decode(p) {
        if (!messageShapeOk(p))
            return refuse('malformed', 'RLTP-MSG-4010');
        return calOK(p.body.sentAt) ? p : refuse('validation-failed', 'RLTP-MSG-3030');
    },
    async prepare(ctx, doc, arr) {
        const s = ctx.snapshot;
        const S = ctx.crypto.subtle;
        const at = tupleByRkid(s, arr.rkid);
        // the MAC under k_msg of the arrival tuple, issuer to recipient (4020, 3110, 3120)
        const raw = xRawOfMk(at.tuple.counterpartKeyAgreement);
        const a = raw ? await ctx.keys.agree(arr.rkid, raw, ctx.release) : null;
        if (!a || a.status !== 'available')
            return refuse('validation-failed', 'RLTP-MSG-4020');
        let key;
        try {
            key = await messageKeyOf(a.shared, doc.issuer, doc.recipient, S);
        }
        catch {
            return refuse('validation-failed', 'RLTP-MSG-3120');
        }
        if ((await messageMac(key, doc.payload.body, S)) !== doc.payload.proof.mac)
            return refuse('validation-failed', 'RLTP-MSG-4020');
        // the bounds (4110), counted before the block (4130): transient (4120)
        const relId = at.rel.id;
        if (rateCount(s, relId, 'messages', ctx.when) >= MESSAGE_RATE)
            return refuse('rate-limited', 'RLTP-MSG-4110');
        // the inbox bound is counted before the block too (4130): a new mid
        // meets the entries held, blocked or not; once it passes, a block
        // discards it, an entry taken over at once
        const known = s.messages.records[at.tuple.ownPairLabel]?.[doc.payload.body.mid] !== undefined;
        if (!known && inboxCount(s, relId) >= INBOX_BOUND)
            return refuse('rate-limited', 'RLTP-MSG-4110');
        return { bodyDigest: await digestDoc(doc.payload.body, S) };
    },
    // stage 9, on t_ref = arr.when (raised to lastWhen, the mark of 4060)
    apply(state, prepared, doc, arr) {
        const at = tupleByRkid(state, arr.rkid);
        const label = at.tuple.ownPairLabel;
        const relId = at.rel.id;
        const body = doc.payload.body;
        const tRef = arr.when;
        const sentAt = Date.parse(body.sentAt);
        if (sentAt + MESSAGE_LIFETIME_MS < tRef)
            return refuse('stale-issuance', 'RLTP-MSG-4040');
        if (sentAt > tRef + MESSAGE_FUTURE_MS)
            return refuse('validation-failed', 'RLTP-MSG-4050');
        const { bodyDigest } = prepared.value;
        const held = Object.hasOwn(state.messages.records, label) && Object.hasOwn(state.messages.records[label], body.mid) ? state.messages.records[label][body.mid] : undefined;
        if (held && held.bodyDigest !== bodyDigest)
            return refuse('validation-failed', 'RLTP-MSG-4330');
        // the rate counts every new document digest accepted, before the block (4110, 4130)
        let next = withRate(state, relId, 'messages', tRef);
        // a known mid with its body: no new effect, a fresh ack (4320)
        if (held)
            return { state: next };
        const records = { ...next.messages.records, [label]: { ...(next.messages.records[label] ?? {}), [body.mid]: { bodyDigest, sentAt } } };
        next = { ...next, messages: { ...next.messages, records } };
        // under a block: discard — the record, the cache entry and the ack, nothing else (6210, 6220)
        if (blockedRel(state, relId))
            return { state: next };
        const entry = { id: arr.digest, tuple: label, mid: body.mid, body: body, receivedAt: tRef, displayAt: Math.min(sentAt, tRef) };
        const contactId = entryOf(state, at.rel)?.id ?? at.rel.contactId;
        return {
            state: { ...next, messages: { ...next.messages, inbox: { ...next.messages.inbox, [entry.id]: entry } } },
            events: [{ type: 'message.received', contactId, inboxId: entry.id }],
        };
    },
};
/** The application took inbox entries over durably (4420). */
const takeDef = {
    human: false,
    apply(state, _p, input) {
        if (!Array.isArray(input?.ids) || !input.ids.every((x) => typeof x === 'string'))
            throw new TypeError('message.take needs {ids: string[]}');
        const gone = input.ids.filter((id) => Object.hasOwn(state.messages.inbox, id));
        if (!gone.length)
            return { state: state };
        const inbox = { ...state.messages.inbox };
        for (const id of gone)
            delete inbox[id];
        // the completion record stays (4350)
        return { state: { ...state, messages: { ...state.messages, inbox } } };
    },
};
/** The tuple a counterpart's document was accepted on is ready (5.1). */
function markReady(state, doc, arr) {
    const at = tupleByRkid(state, arr.rkid);
    if (!at || doc.issuer !== at.tuple.counterpartAnchor || tupleReady(state, at.tuple.ownPairLabel))
        return state;
    const ready = [...state.messages.ready, at.tuple.ownPairLabel].sort(cmp);
    return { ...state, messages: { ...state.messages, ready } };
}
/** The completion record's retention (4340): an entry leaves once
 *  t_ref (tick's time, written as the mark) lies after sentAt + H, or once
 *  its tuple is deactivated or gone; ready marks of tuples gone leave. */
function retainMessages(state, when) {
    let changed = false;
    const records = {};
    for (const [label, rec] of Object.entries(state.messages.records)) {
        const t = tupleByLabel(state, label);
        if (!t || t.tuple.deactivated) {
            changed = true;
            continue;
        }
        const keep = Object.entries(rec).filter(([, e]) => !(e.sentAt + MESSAGE_LIFETIME_MS < when));
        if (keep.length !== Object.keys(rec).length)
            changed = true;
        if (keep.length)
            records[label] = Object.fromEntries(keep);
    }
    const ready = state.messages.ready.filter((l) => tupleByLabel(state, l) !== null);
    if (ready.length !== state.messages.ready.length)
        changed = true;
    return changed ? { ...state, messages: { ...state.messages, records, ready } } : state;
}
/** When retainMessages lets an entry go by time (the timer contract). */
function messageDeadlines(state) {
    const out = [];
    for (const rec of Object.values(state.messages.records)) {
        let first = Infinity;
        for (const e of Object.values(rec))
            first = Math.min(first, e.sentAt + MESSAGE_LIFETIME_MS + 1);
        if (first !== Infinity)
            out.push(first);
    }
    return out;
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
        commands: Object.freeze({ [MESSAGE_COMMANDS.send]: sendDef, [MESSAGE_COMMANDS.block]: blockDef, [MESSAGE_COMMANDS.take]: takeDef }),
        tasks: Object.freeze({ [MESSAGE_TYPE]: messageTask }),
        accepted: markReady,
        retain: retainMessages,
        deadlines: messageDeadlines,
    });
}
