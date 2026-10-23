// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// encounter/ceremony — the Encounter ceremony on the holder (lib Stage 2,
// PR 7a; Encounter 0.31 §5–§7 on Delivery 0.81 §4.1–4.3). Graduated from
// probe/encounter.ts (show, scan, counter, captureSentCard,
// receiveEncounter, resolve) onto HolderState and the engine; the probe
// stays as it is for the simulators until PR 7b. The pure checks are the
// root module's (encounter.ts).
//
// What it registers (encounterModule):
//   human acts  encounter.show     a displayed card under a fresh pair
//                                  label with a fresh own challenge (5.3):
//                                  the label and its relationship nonce
//                                  into the register before display (4110,
//                                  Identity 6.1), the key's lastShown in
//                                  `addresses` (Delivery §5), the challenge
//                                  held open; with a carrier offer the
//                                  card carries its delivery hints (6080)
//                                  and its carrier nonce enters the
//                                  register under the relationship the
//                                  card opens (Identity §7a.3); event
//                                  encounter.shown carries the card, the
//                                  optical payload
//               encounter.scan     the scanner's step (5.8 trunk 2–3):
//                                  the displayed card checked, a fresh
//                                  label and own challenge c_A, the record
//                                  (5.5), the step credential and the sent
//                                  card, the fresh tuple (Trust openTuple:
//                                  its prior candidates frozen, its
//                                  continuity probe pending, 6820) and the
//                                  bundle into the outbox, in one commit;
//                                  a carrier offer as with show, its hints
//                                  in the sent card; event
//                                  encounter.scanned carries the sent card
//                                  for the optical leg
//               encounter.capture  the optical leg (5.8, 5710): a sent
//                                  card presented to the displayer
//               encounter.counter  the counter-step (5.8 step 4)
//   tasks       encounter-bundle/0.1 (proof absent, Delivery 4.1; channel
//               binding: the bundle establishes the tuple) and
//               encounter-credential-delivery/0.1 (proof absent, 4.3;
//               the tuple binding); both signature-class: their acks are
//               signed (receive.ts)
//   decision    encounter-confirm: accept issues the counter-step, decline
//               closes the prompt (the edge stays one-sided, 5750)
//   retain      tick drops the challenges past their age bound (5200,
//               5210, 5230)
//
// The commit discipline of the probe (prepare, verify, commit under a
// lock set) is the engine's: preparation is async against a snapshot,
// apply is synchronous on that same snapshot, and the commit is a CAS on
// its version (engine.ts). A state that moved is a CAS conflict and the
// receive re-enters at stage 1, which re-checks the effect cache at stage
// 4 (Delivery 6.2's waiter rule). So the provisional resolution of 4.1
// and the authoritative one coincide: apply resolves once, on the
// snapshot the commit lands on, and selects the branch.
//
// Choices this file makes where spec and note leave them open:
//   - ids: the contact and the relationship of a ceremony-born tuple are
//     named after the own fresh pair label, `c-<digest>` and `r-<digest>`
//     (the label's digest component): unique by freshness (4.4)
//   - the aging latch (5260, 5270): an aged value is removed (5210, 5230:
//     no challenge history beyond open values and records), so it never
//     resolves open again. tick removes every aged value; a bundle or an
//     optical card refused because its authoritative resolution found its
//     bound value aged commits that removal and the raised lastWhen even
//     though it refuses — the Encounter latch exception of the engine
//     (receive.ts TaskRefusal.latch): no cache entry, no ack, no journal
//   - the scanner's own challenge c_A goes straight to its record: the
//     record and the issuance commit together (5630: record, then issue);
//     nothing is released before the commit, so "record before issuing"
//     holds and no resumable half-state exists (the probe's bundlePending)
//   - the bundle's effect on `open` creates the record, accepts the
//     credential, opens the fresh tuple and the confirm prompt in one
//     commit; the prompt is "arrival is not acceptance: this device
//     decides" — accept issues the counter-step. It expires when the
//     counter credential could no longer be accepted: the end of the
//     issuance window of the challenge it binds, c_A (5.6 step 6)
//   - the credential delivery's defined effect (4.3, buffering) and the
//     5.6 acceptance commit together; the ack does not depend on the
//     acceptance's outcome and the outcome is never signaled (7.4): the
//     document is acknowledged and its thread reserved either way
//   - encounter.counter picks the newest record of the contact on the
//     displayer side whose own credential is not issued; a new issuance
//     needs an active tuple (tuple-deactivated), its document waits for
//     the bundle's thread where the record arose on the optical leg (5780)
//     and goes out with the bundle's record-aware effect
//   - the carrier offer {nonce, deliveryHints}: the app draws the carrier
//     nonce N and builds the hints from it (an adapter derives the wire
//     identities from root, carrier and N), so the offer is plain act
//     input, bound and journaled with the act; the library checks 6090 on
//     the hints (card-invalid), N's form and freshness (carrier-nonce-
//     invalid: 32 bytes, held nowhere in the register), and interprets no
//     hint. N enters the register at show already, under the relationship
//     id the card's label opens, as the label and its pair nonce do (4110);
//     a card that ages unscanned leaves it there, like its label (the
//     register only grows)
//   - encounter.capture of a card already recorded with the same material
//     is an idempotent success (5430): the act commits its journal entry only
//   - no automatic optical switch (5690 RECOMMENDS ack-wait as its
//     trigger): the app shows the sent card (encounter.scanned) when it
//     sees the bundle undelivered (deliveryStatus)
import { b64uOf, fromB64u, iso, jcs, makeValidator, sameDigest } from '../core.js';
import { diSignWith, diVerify, digestBytes, digestDoc } from '../crypto.js';
import { seal } from '../delivery.js';
import { BUNDLE_TYPE, CEREMONY, CHALLENGE_MAX_AGE, SKEW_TOLERANCE, DELIVERY_TYPE, acceptTail, bundleForm, cardBody, cardOk, challengeAged, challengeOf, credHead, credentialBody, deliveryForm, dispositionOf, futureOk, issuanceEnd, issuanceOpen, windowOk, } from '../encounter.js';
import { SCHEMAS } from '../schemas.js';
import { carrierNonceHeld, withCarrierNonce, withPairNonce } from '../identity-state.js';
import { tupleByRkid } from '../receive.js';
import { openTuple } from '../trust/continuity.js';
import { entryOf, findContact, tupleByLabel } from '../trust/state.js';
export { BUNDLE_TYPE, DELIVERY_TYPE };
/** The command names of the human acts. */
export const ENCOUNTER_COMMANDS = Object.freeze({
    show: 'encounter.show',
    scan: 'encounter.scan',
    capture: 'encounter.capture',
    counter: 'encounter.counter',
});
const V = makeValidator(SCHEMAS);
const schemaOk = (file, data) => V.validate(data, SCHEMAS[file], SCHEMAS[file]).length === 0;
const refuse = (reason, ref) => ({ ok: false, reason, ...(ref ? { ref } : {}) });
const no = (code, ref) => ({ ok: false, code, ...(ref ? { ref } : {}) });
const isRefusal = (x) => x?.ok === false;
/** The contact and relationship ids of the tuple under an own pair label. */
export const idsOf = (label) => {
    const d = label.slice('pair/'.length);
    return { contactId: 'c-' + d, relId: 'r-' + d };
};
/** The prompt that asks to confirm the enactment of record `own`. */
export const confirmPromptId = (own) => 'encounter:' + own;
/** The own-challenge resolution (5240): recorded, open, else unknown. */
export function resolve(state, value, when) {
    if (Object.hasOwn(state.encounter.records, value))
        return 'recorded';
    const c = Object.hasOwn(state.encounter.challenges, value) ? state.encounter.challenges[value] : undefined;
    return !c || challengeAged(c.tCh, when) ? 'unknown' : 'open';
}
/** The aging latch (5260, 5270): where a resolution finds a held value
 *  past its age bound, the state with that value removed — committed even
 *  by a refusal (receive.ts, the Encounter latch exception), so a clock
 *  that moves back never resolves it open again; else undefined. */
function latchOf(state, value, when) {
    const c = Object.hasOwn(state.encounter.challenges, value) ? state.encounter.challenges[value] : undefined;
    if (!c || !challengeAged(c.tCh, when) || Object.hasOwn(state.encounter.records, value))
        return undefined;
    const challenges = { ...state.encounter.challenges };
    delete challenges[value];
    return { ...state, encounter: { ...state.encounter, challenges } };
}
/** 5170: a challenge value consumed or held — on either side of any
 *  record, or among the own open challenges — enters no new enactment. */
const challengeUsed = (state, value) => Object.hasOwn(state.encounter.challenges, value) || Object.values(state.encounter.records).some((r) => r.own === value || r.peer === value);
const facts = (r) => ({ counterpart: r.counterpart, ceremony: r.ceremony, tCh: r.tCh, bind: r.bind });
/** Is the thread used: by a record (its bundle's or a later one) or the outbox? (Delivery 3, 4.1) */
function threadInUse(state, id) {
    for (const r of Object.values(state.encounter.records))
        if (r.thread === id || Object.hasOwn(r.threads, id))
            return true;
    return Object.values(state.outbox).some((o) => o.threadId === id);
}
/** The original bundle of a thread, re-evaluated (4.2: after the cache's
 *  retention) or re-issued on its own fresh thread: not a new document on
 *  a used thread. */
function sameOpeningBundle(state, anchor, threadId, digest) {
    for (const r of Object.values(state.encounter.records)) {
        if (r.counterpart !== anchor)
            continue;
        if (r.thread === threadId && r.bundleDigest !== null && sameDigest(r.bundleDigest, digest))
            return true;
        if (Object.hasOwn(r.threads, threadId) && sameDigest(r.threads[threadId], digest))
            return true;
    }
    return false;
}
/** The record of the tuple under an own pair label. */
const recordOfLabel = (state, label) => Object.values(state.encounter.records).find((r) => r.label === label);
const withRecord = (state, r) => ({ ...state, encounter: { ...state.encounter, records: { ...state.encounter.records, [r.own]: r } } });
/** The entry a record's tuple feeds, and its relationship (by the tuple: a
 *  chaining may have moved it, 6220). */
function placeOf(state, r) {
    const at = tupleByLabel(state, r.label);
    if (!at)
        return { contactId: idsOf(r.label).contactId, relationshipId: r.relId };
    return { contactId: entryOf(state, at.rel)?.id ?? at.tuple.entryId, relationshipId: at.rel.id };
}
/** The register with the offer's carrier nonce under `relId`, or unchanged without an offer. */
const carrierOf = (r, relId, carrier) => carrier === undefined ? r : withCarrierNonce(r, relId, carrier.nonce);
const sealWith = (ctx, doc, keyAgreement) => seal(doc, keyAgreement, { ephSeed: ctx.entropy.bytes('seal.eph', 32), nonce: ctx.entropy.bytes('seal.nonce', 12) }, ctx.crypto.subtle);
const signer = (ctx, label) => (b) => ctx.keys.sign(label, b);
/** The display name a card carries: the input's, else the own profile's, at most 200 characters (6090). */
const nameFor = (state, name) => {
    const n = typeof name === 'string' ? name : state.profile.body?.name;
    return typeof n === 'string' && n.length ? [...n].slice(0, 200).join('') : undefined;
};
/** The carrier offer's own checks, before anything is signed: at least
 *  one hint, each a string (else card-invalid without a ref: an empty offer
 *  announces nothing, a card without hints needs no offer); the bounds of
 *  6090 (at most eight, each at most 512 characters); then N's form (32
 *  bytes, canonical base64url). null where there is no offer or it passes. */
function offerRefusal(carrier) {
    if (carrier === undefined)
        return null;
    const c = carrier;
    const h = c?.deliveryHints;
    // an offer announces its carrier: no hint (a card without hints is a card
    // without an offer, 6080) or a hint that is no string is no offer
    if (!Array.isArray(h) || h.length < 1 || !h.every((x) => typeof x === 'string'))
        return no('card-invalid');
    if (h.length > 8 || !h.every((x) => [...x].length <= 512))
        return no('card-invalid', 'RLTP-ENC-6090');
    const n = c?.nonce;
    if (typeof n !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(n) || b64uOf(fromB64u(n)) !== n)
        return no('carrier-nonce-invalid');
    return null;
}
/** N is fresh (Identity §7a.3): no carrier or pair nonce of the register, and not this act's pair nonce. */
const nonceStale = (state, carrier, pairNonce) => carrier !== undefined && (carrier.nonce === pairNonce || carrierNonceHeld(state.register, carrier.nonce));
/** A fresh pair label from 32 fresh nonce bytes (Identity 6.1, Encounter 4.4). */
async function freshLabel(ctx) {
    const n = ctx.entropy.bytes('founding.nonce', 32);
    return { label: 'pair/' + await digestBytes(n, ctx.crypto.subtle), nonce: b64uOf(n) };
}
const showDef = {
    human: true,
    async prepare(ctx, input) {
        const offer = offerRefusal(input?.carrier);
        if (offer)
            return offer;
        const { label, nonce } = await freshLabel(ctx);
        const own = await ctx.keys.anchorOf(label);
        const value = challengeOf(ctx.entropy.bytes('challenge', 17));
        const at = iso(ctx.when);
        const name = nameFor(ctx.snapshot, input?.name);
        const hints = input?.carrier !== undefined ? { deliveryHints: input.carrier.deliveryHints } : {};
        const body = cardBody(own, { ...(name !== undefined ? { name } : {}), ...hints, challenge: { value, issuedAt: at } });
        const card = await diSignWith(own.anchor, signer(ctx, label), body, at, ctx.crypto.subtle);
        return { label, nonce, rkid: own.keyAgreement, value, card };
    },
    apply(state, prepared, input, when) {
        const p = prepared.value;
        if (isRefusal(p))
            return p;
        if (nonceStale(state, input?.carrier, p.nonce))
            return no('carrier-nonce-invalid');
        // fresh-always (4.4, 4150) and single use (5140): fresh entropy never
        // repeats; a repeat is a broken entropy source, not a human's refusal
        if (state.register.labels.includes(p.label) || tupleByLabel(state, p.label))
            throw new Error(`encounter.show: the pair label ${p.label} is not fresh`);
        if (resolve(state, p.value, when) !== 'unknown' || Object.hasOwn(state.encounter.challenges, p.value))
            throw new Error('encounter.show: the challenge value is not fresh');
        return {
            state: {
                ...state,
                // 4110: the label in the register before the card is displayed;
                // the carrier nonce beside it, under the relationship the card opens
                register: carrierOf(withPairNonce(state.register, p.label, p.nonce), idsOf(p.label).relId, input?.carrier),
                addresses: { ...state.addresses, keys: { ...state.addresses.keys, [p.rkid]: { label: p.label, lastShown: when } } },
                encounter: { ...state.encounter, challenges: { ...state.encounter.challenges, [p.value]: { value: p.value, tCh: when, label: p.label, card: p.card } } },
            },
            events: [{ type: 'encounter.shown', challenge: p.value, card: p.card }],
        };
    },
};
const scanDef = {
    human: true,
    async prepare(ctx, input) {
        const peer = input?.card;
        if ((await cardOk(peer, ctx.crypto.subtle)) !== null)
            return no('card-invalid', 'RLTP-ENC-6010');
        // a displayed card carries neither sentTo nor boundTo (6070)
        if (peer.sentTo !== undefined || peer.boundTo !== undefined)
            return no('card-invalid', 'RLTP-ENC-6070');
        const offer = offerRefusal(input?.carrier);
        if (offer)
            return offer;
        const S = ctx.crypto.subtle;
        const { label, nonce } = await freshLabel(ctx);
        const me = await ctx.keys.anchorOf(label);
        // c_A: fresh, created now, never the displayed value (5150, 5160)
        let own = challengeOf(ctx.entropy.bytes('challenge', 17));
        for (let i = 0; own === peer.challenge.value && i < 4; i++)
            own = challengeOf(ctx.entropy.bytes('challenge', 17));
        if (own === peer.challenge.value)
            throw new Error('encounter.scan: no fresh challenge distinct from the displayed one');
        const bind = await digestDoc({ ceremony: CEREMONY, challenges: [own, peer.challenge.value].sort() }, S);
        const at = iso(ctx.when);
        const sign = signer(ctx, label);
        const credential = await diSignWith(me.anchor, sign, credentialBody(me.anchor, peer.anchor, CEREMONY, peer.challenge.value, bind, at), at, S);
        const name = nameFor(ctx.snapshot, input?.name);
        const hints = input?.carrier !== undefined ? { deliveryHints: input.carrier.deliveryHints } : {};
        const sent = cardBody(me, { ...(name !== undefined ? { name } : {}), ...hints, challenge: { value: own, issuedAt: at }, sentTo: peer.anchor, boundTo: peer.challenge.value });
        const sentCard = await diSignWith(me.anchor, sign, sent, at, S);
        const threadId = ctx.entropy.id('thread.id');
        const doc = { id: ctx.entropy.id('doc.id'), type: BUNDLE_TYPE, issuer: me.anchor, recipient: peer.anchor, threadId, issuedAt: at, payload: { card: sentCard, credential } };
        return {
            peer, label, nonce, rkid: me.keyAgreement, own, bind, threadId, credential, credDigest: await digestDoc(credential, S), sentCard,
            doc: { digest: await digestDoc(doc, S), envelope: await sealWith(ctx, doc, peer.keyAgreement) },
        };
    },
    apply(state, prepared, input, when) {
        const p = prepared.value;
        if (isRefusal(p))
            return p;
        if (nonceStale(state, input?.carrier, p.nonce))
            return no('carrier-nonce-invalid');
        const peerValue = p.peer.challenge.value;
        // 5.3 single use from the scanner's side: a displayed value already in
        // one of the own records never enters a second enactment (5170)
        if (challengeUsed(state, peerValue))
            return no('already-scanned', 'RLTP-ENC-5170');
        if (state.register.labels.includes(p.label) || tupleByLabel(state, p.label))
            throw new Error(`encounter.scan: the pair label ${p.label} is not fresh`);
        if (resolve(state, p.own, when) !== 'unknown')
            throw new Error('encounter.scan: the own challenge is not fresh');
        if (threadInUse(state, p.threadId))
            throw new Error('encounter.scan: the thread is not fresh');
        // the credential binds c_B: issued only inside its window (5.6 step 6)
        if (!issuanceOpen(Date.parse(p.peer.challenge.issuedAt), when))
            return no('stale-issuance', 'RLTP-ENC-5530');
        const ids = idsOf(p.label);
        const opened = openTuple(state, {
            relId: ids.relId, contactId: ids.contactId, ownPairLabel: p.label, counterpartAnchor: p.peer.anchor,
            counterpartKeyAgreement: p.peer.keyAgreement, provenance: { kind: 'ceremony' }, nonce: p.nonce,
        }, p.rkid, when);
        const record = {
            ceremony: CEREMONY, own: p.own, tCh: when, peer: peerValue, counterpart: p.peer.anchor, card: p.peer, bind: p.bind,
            at: when, label: p.label, relId: ids.relId, role: 'scanner', out: { digest: p.credDigest, credential: p.credential }, in: null,
            thread: p.threadId, bundleDigest: p.doc.digest, threads: {}, sentCard: p.sentCard, counterPending: false,
        };
        return {
            state: withRecord({ ...opened.state, register: carrierOf(opened.state.register, ids.relId, input?.carrier) }, record),
            outbound: [{
                    digest: p.doc.digest, envelope: p.doc.envelope, type: BUNDLE_TYPE, threadId: p.threadId,
                    recipient: { contactId: ids.contactId, rkid: p.rkid, keyAgreement: p.peer.keyAgreement },
                }],
            events: [
                ...(opened.events ?? []),
                { type: 'encounter.recorded', contactId: ids.contactId, relationshipId: ids.relId, role: 'scanner' },
                { type: 'encounter.scanned', contactId: ids.contactId, card: p.sentCard },
            ],
            duties: opened.duties,
        };
    },
};
const captureDef = {
    human: true,
    async prepare(ctx, input) {
        const card = input?.card;
        if ((await cardOk(card, ctx.crypto.subtle)) !== null)
            return no('card-invalid', 'RLTP-ENC-6010');
        if (typeof card.sentTo !== 'string' || typeof card.boundTo !== 'string')
            return no('card-invalid', 'RLTP-ENC-6030');
        if (card.challenge.value === card.boundTo)
            return no('card-invalid', 'RLTP-ENC-5160');
        // sentTo = the own anchor that displayed boundTo (6050, 4.4)
        const s = ctx.snapshot.encounter;
        const label = Object.hasOwn(s.records, card.boundTo) ? s.records[card.boundTo].label
            : Object.hasOwn(s.challenges, card.boundTo) ? s.challenges[card.boundTo].label : null;
        if (label !== null && (await ctx.keys.anchorOf(label)).anchor !== card.sentTo)
            return no('card-invalid', 'RLTP-ENC-6050');
        return { card, label: label ?? '', bind: await digestDoc({ ceremony: CEREMONY, challenges: [card.boundTo, card.challenge.value].sort() }, ctx.crypto.subtle) };
    },
    apply(state, prepared, _input, when) {
        const p = prepared.value;
        if (isRefusal(p))
            return p;
        const { card } = p;
        const st = resolve(state, card.boundTo, when);
        if (st === 'unknown') {
            const latch = latchOf(state, card.boundTo, when);
            return { ...no('gate-expired', 'RLTP-ENC-5460'), ...(latch ? { latch } : {}) };
        }
        if (st === 'recorded') {
            // the taxonomy of 5.5 (5430–5450)
            const r = state.encounter.records[card.boundTo];
            if (r.counterpart !== card.anchor)
                return no('consumed-challenge', 'RLTP-ENC-5440');
            if (jcs(r.card) !== jcs(card))
                return no('card-mismatch', 'RLTP-ENC-5450');
            return { state: state };
        }
        const ch = state.encounter.challenges[card.boundTo];
        if (challengeUsed(state, card.challenge.value))
            return no('consumed-challenge', 'RLTP-ENC-5170');
        if (!futureOk(ch.tCh, when))
            return no('gate-future', 'RLTP-ENC-5390');
        return recordCreating(state, { label: ch.label, own: ch.value, tCh: ch.tCh, card, bind: p.bind, rkid: rkidOf(state, ch.label), when, in: null, thread: null, digest: null });
    },
};
/** The own key-agreement id a label derives under, from `addresses`. */
function rkidOf(state, label) {
    for (const [rkid, k] of Object.entries(state.addresses.keys))
        if (k.label === label)
            return rkid;
    throw new Error(`encounter: no address key for ${label}`);
}
/** The displayer's record-creating effect (5.5, 5650, 5710): the record,
 *  the fresh tuple, the challenge superseded (5220), the confirm prompt. */
function recordCreating(state, x) {
    const ids = idsOf(x.label);
    const nonce = Object.hasOwn(state.register.pairNonces, x.label) ? state.register.pairNonces[x.label] : undefined;
    const opened = openTuple(state, {
        relId: ids.relId, contactId: ids.contactId, ownPairLabel: x.label, counterpartAnchor: x.card.anchor,
        counterpartKeyAgreement: x.card.keyAgreement, provenance: { kind: 'ceremony' }, ...(nonce !== undefined ? { nonce } : {}),
    }, x.rkid, x.when);
    const record = {
        ceremony: CEREMONY, own: x.own, tCh: x.tCh, peer: x.card.challenge.value, counterpart: x.card.anchor, card: x.card, bind: x.bind,
        at: x.when, label: x.label, relId: ids.relId, role: 'displayer', out: null, in: x.in, thread: x.thread, bundleDigest: x.digest,
        threads: {}, sentCard: null, counterPending: false,
    };
    const challenges = { ...opened.state.encounter.challenges };
    delete challenges[x.own];
    const prompt = {
        id: confirmPromptId(x.own), kind: 'encounter-confirm', contactId: ids.contactId, openedAt: x.when,
        // the counter credential binds c_A: acceptable only inside its window (5.6 step 6)
        expiresAt: issuanceEnd(Date.parse(x.card.challenge.issuedAt)),
    };
    const next = withRecord({ ...opened.state, encounter: { ...opened.state.encounter, challenges } }, record);
    return {
        state: { ...next, prompts: { ...next.prompts, [prompt.id]: prompt } },
        events: [
            ...(opened.events ?? []),
            { type: 'encounter.recorded', contactId: ids.contactId, relationshipId: ids.relId, role: 'displayer' },
            ...(x.in ? [{ type: 'encounter.accepted', contactId: ids.contactId, relationshipId: ids.relId, mutual: false }] : []),
            { type: 'prompt.opened', promptId: prompt.id, kind: 'encounter-confirm' },
        ],
        duties: opened.duties,
    };
}
/** The counter-step's delivery document in the bundle's thread (4.3, 5760). */
async function counterDoc(ctx, r, issuer, credential, threadId) {
    const doc = {
        id: ctx.entropy.id('doc.id'), type: DELIVERY_TYPE, issuer, recipient: r.counterpart, threadId, issuedAt: iso(ctx.when),
        ceremony: { step: 'counter', enactment: r.bind }, payload: { credential },
    };
    return { digest: await digestDoc(doc, ctx.crypto.subtle), envelope: await sealWith(ctx, doc, r.card.keyAgreement), threadId };
}
/** The displayer's record of a contact the counter-step issues on: the
 *  newest whose own credential is not issued. */
function counterRecord(state, contactId) {
    const c = findContact(state, contactId);
    if (!c)
        return no('unknown-contact');
    const ids = new Set([c.id, ...c.aliases]);
    const mine = Object.values(state.encounter.records).filter((r) => r.role === 'displayer' && ids.has(placeOf(state, r).contactId));
    if (!mine.length)
        return no('no-record');
    const open = mine.filter((r) => r.out === null).sort((a, b) => b.at - a.at);
    return open.length ? open[0] : no('already-issued');
}
async function prepareCounter(ctx, r) {
    const S = ctx.crypto.subtle;
    const me = await ctx.keys.anchorOf(r.label);
    const at = iso(ctx.when);
    // the subject's challenge is c_A, the record's peer value (5320)
    const credential = await diSignWith(me.anchor, signer(ctx, r.label), credentialBody(me.anchor, r.counterpart, CEREMONY, r.peer, r.bind, at), at, S);
    return { own: r.own, credential, digest: await digestDoc(credential, S), doc: r.thread !== null ? await counterDoc(ctx, r, me.anchor, credential, r.thread) : null };
}
/** The counter-step's effect: the own credential committed (5770), its
 *  document out where the bundle's thread is known, else pending (5780);
 *  the confirm prompt of the record closes. */
function applyCounter(state, p, when, closePrompt) {
    if (isRefusal(p))
        return p;
    const r = state.encounter.records[p.own];
    if (!r || r.role !== 'displayer')
        return no('no-record');
    if (r.out !== null)
        return no('already-issued');
    const at = tupleByLabel(state, r.label);
    if (!at || at.tuple.deactivated)
        return no('tuple-deactivated');
    if (!issuanceOpen(Date.parse(r.card.challenge.issuedAt), when))
        return no('stale-issuance', 'RLTP-ENC-5530');
    if ((p.doc === null) !== (r.thread === null))
        throw new Error('encounter.counter: prepared on another thread state');
    const place = placeOf(state, r);
    let next = withRecord(state, { ...r, out: { digest: p.digest, credential: p.credential }, counterPending: p.doc === null });
    const events = [];
    const pid = confirmPromptId(r.own);
    if (closePrompt && Object.hasOwn(next.prompts, pid)) {
        const prompts = { ...next.prompts };
        delete prompts[pid];
        next = { ...next, prompts };
        events.push({ type: 'prompt.decided', promptId: pid, kind: 'encounter-confirm', choice: 'accept' });
    }
    return {
        state: next,
        outbound: p.doc ? [{ digest: p.doc.digest, envelope: p.doc.envelope, type: DELIVERY_TYPE, threadId: p.doc.threadId, recipient: { contactId: place.contactId, rkid: at.tuple.rkid, keyAgreement: at.tuple.counterpartKeyAgreement } }] : [],
        events,
    };
}
const counterDef = {
    human: true,
    async prepare(ctx, input) {
        const r = counterRecord(ctx.snapshot, input?.contactId);
        return isRefusal(r) ? r : prepareCounter(ctx, r);
    },
    apply: (state, prepared, _input, when) => applyCounter(state, prepared.value, when, true),
};
/** encounter-confirm: accept issues the counter-step; decline only closes. */
const confirmDecision = {
    async prepare(ctx, prompt, choice) {
        if (choice !== 'accept')
            return null;
        const r = ctx.snapshot.encounter.records[prompt.id.slice('encounter:'.length)];
        return r ? prepareCounter(ctx, r) : no('no-record');
    },
    apply(state, prompt, choice, when, prepared) {
        if (choice === 'decline')
            return { state: state };
        // the prompts module closes the prompt and announces the decision
        return applyCounter(state, prepared.value ?? no('no-record'), when, false);
    },
};
/** Delivery 4.1 checks 5–6 under a resolution that found the value held:
 *  the ceremony (5520), the enacting anchor (4100), the enactment binding
 *  (5560), the issuance window (5530); null when they pass. */
function checks56(state, credential, own, st, bind, rkid) {
    const held = st === 'open' ? state.encounter.challenges[own] : state.encounter.records[own];
    if (credential.credentialSubject.ceremony !== CEREMONY)
        return refuse('validation-failed', 'RLTP-ENC-5520');
    // the enacting anchor is the one that displayed the bound challenge (4.4)
    if (held.label !== state.addresses.keys[rkid]?.label)
        return refuse('validation-failed', 'RLTP-ENC-4100');
    if (!sameDigest(credential.credentialSubject.enactmentBinding, bind))
        return refuse('validation-failed', 'RLTP-ENC-5560');
    if (!windowOk(credential, held.tCh))
        return refuse('stale-issuance', 'RLTP-ENC-5530');
    return null;
}
const bundleTask = {
    proof: 'absent',
    decode: (payload) => (schemaOk('payload-encounter-bundle.schema.json', payload) ? payload : refuse('malformed')),
    // check 1 (structure, outer/inner, credential format), then the binding:
    // the arrival tuple where the record exists and the issuer is its
    // counterpart, else the bundle itself — it establishes the tuple (4.1),
    // its issuer = card.anchor = credential.issuer
    channel(state, doc, rkid) {
        const f = bundleForm(doc);
        if (f)
            return refuse(f.reason);
        const at = tupleByRkid(state, rkid);
        if (at && doc.issuer === at.tuple.counterpartAnchor)
            return { keyAgreement: at.tuple.counterpartKeyAgreement, contactId: entryOf(state, at.rel)?.id ?? at.rel.contactId };
        // another issuer on a recorded display key: the record decides at stage
        // 9 (consumed-challenge, 4.1); its ack is never produced
        const k = state.addresses.keys[rkid];
        if (!k || !k.label.startsWith('pair/'))
            return refuse('validation-failed');
        return { keyAgreement: doc.payload.card.keyAgreement, contactId: idsOf(k.label).contactId };
    },
    // checks 2–4: card proof, credential proof, addressee (no state touched);
    // then check 5 the provisional resolution and, where it found the value
    // held, checks 5–6 at stage 8 (an unknown value goes to stage 9)
    async prepare(ctx, doc, arrival) {
        const { card, credential } = doc.payload;
        if (!(await diVerify(card, card.anchor, ctx.crypto.subtle)))
            return refuse('validation-failed', 'RLTP-ENC-6020');
        const h = await credHead(credential, doc.recipient, false, ctx.crypto.subtle);
        if (h)
            return refuse(dispositionOf(h), errRef(h));
        const S = ctx.crypto.subtle;
        const own = credential.credentialSubject.challenge;
        const r = Object.hasOwn(ctx.snapshot.encounter.records, own) ? ctx.snapshot.encounter.records[own] : undefined;
        // a counter-step issued on the optical leg waited for this thread (5780)
        const counter = r && r.counterPending && r.out && r.counterpart === card.anchor
            ? await counterDoc(ctx, r, doc.recipient, r.out.credential, r.thread ?? doc.threadId) : null;
        const bind = await digestDoc({ ceremony: CEREMONY, challenges: [own, card.challenge.value].sort() }, S);
        const st = resolve(ctx.snapshot, own, ctx.when);
        if (st !== 'unknown') {
            const bad = checks56(ctx.snapshot, credential, own, st, bind, arrival.rkid);
            if (bad)
                return bad;
        }
        return { bind, credDigest: await digestDoc(credential, S), counter, st };
    },
    // the authoritative resolution and the branch it selects (4.1); checks
    // 5–6 again only where it differs from the provisional one
    apply(state, prepared, doc, arrival) {
        const p = prepared.value;
        const { card, credential } = doc.payload;
        const when = arrival.when;
        const own = credential.credentialSubject.challenge;
        const st = resolve(state, own, when);
        if (st === 'unknown') {
            const latch = latchOf(state, own, when);
            return { ...refuse('validation-failed', 'RLTP-ENC-5240'), ...(latch ? { latch } : {}) };
        }
        const held = st === 'open' ? state.encounter.challenges[own] : state.encounter.records[own];
        if (st !== p.st) {
            const bad = checks56(state, credential, own, st, p.bind, arrival.rkid);
            if (bad)
                return bad;
        }
        if (threadInUse(state, doc.threadId) && !sameOpeningBundle(state, card.anchor, doc.threadId, arrival.digest))
            return refuse('validation-failed');
        if (st === 'open') {
            if (challengeUsed(state, card.challenge.value))
                return refuse('validation-failed', 'RLTP-ENC-5170');
            if (!futureOk(held.tCh, when))
                return refuse('gate-future', 'RLTP-ENC-5390');
            return recordCreating(state, {
                label: held.label, own, tCh: held.tCh, card, bind: p.bind, rkid: arrival.rkid, when,
                in: { digest: p.credDigest, credential: credential }, thread: doc.threadId, digest: arrival.digest,
            });
        }
        // recorded: the record decides (4.1)
        const r = held;
        if (r.counterpart !== card.anchor)
            return refuse('consumed-challenge', 'RLTP-ENC-5440');
        if (jcs(r.card) !== jcs(card))
            return refuse('validation-failed', 'RLTP-ENC-5730');
        const e = acceptTail(credential, facts(r), 'bundle');
        if (e)
            return refuse(dispositionOf(e), errRef(e));
        if (r.in && !sameDigest(r.in.digest, p.credDigest))
            return refuse('validation-failed', 'RLTP-ENC-5570');
        // the record-aware effect: no gate, no second record (5740)
        const thread = r.thread ?? doc.threadId;
        const next = {
            ...r,
            in: r.in ?? { digest: p.credDigest, credential: credential },
            thread,
            bundleDigest: r.bundleDigest ?? arrival.digest,
            threads: thread === doc.threadId ? r.threads : { ...r.threads, [doc.threadId]: arrival.digest },
            counterPending: r.counterPending && !p.counter,
        };
        const place = placeOf(state, r);
        const at = tupleByLabel(state, r.label);
        const events = r.in ? [] : [{ type: 'encounter.accepted', contactId: place.contactId, relationshipId: place.relationshipId, mutual: r.out !== null }];
        const outbound = p.counter && at
            ? [{ digest: p.counter.digest, envelope: p.counter.envelope, type: DELIVERY_TYPE, threadId: p.counter.threadId, recipient: { contactId: place.contactId, rkid: at.tuple.rkid, keyAgreement: at.tuple.counterpartKeyAgreement } }]
            : [];
        return { state: withRecord(state, next), events, outbound };
    },
};
const errRef = (e) => ({
    ERR_VERSION: 'RLTP-ENC-5480', ERR_SIG: 'RLTP-ENC-5490', ERR_ADDRESSEE: 'RLTP-ENC-5500', ERR_NO_RECORD: 'RLTP-ENC-5510',
    ERR_CEREMONY: 'RLTP-ENC-5520', ERR_STALE_ISSUANCE: 'RLTP-ENC-5530', ERR_BINDING: 'RLTP-ENC-5560', ERR_CONFLICT: 'RLTP-ENC-5570',
}[e]);
const deliveryTask = {
    proof: 'absent',
    // bound to the enactment record on its tuple (below): a late counter
    // credential is taken against the record even where a chaining has
    // deactivated that tuple since (4.2; encounter review 2/14); no new
    // issuance goes out on it
    pinned: true,
    decode: (payload) => (schemaOk('payload-encounter-credential-delivery.schema.json', payload) ? payload : refuse('malformed')),
    async prepare(ctx, doc, arrival) {
        const f = deliveryForm(doc);
        if (f)
            return refuse('validation-failed', 'RLTP-ENC-5760');
        // the relationship channel to the issuer: a record on the arrival tuple
        const at = tupleByRkid(ctx.snapshot, arrival.rkid);
        if (!at || !recordOfLabel(ctx.snapshot, at.tuple.ownPairLabel))
            return refuse('validation-failed');
        // 5.6 steps 1–3, no state touched; the rest runs in the transaction
        return { verdict: await credHead(doc.payload.credential, doc.recipient, true, ctx.crypto.subtle), credDigest: await digestDoc(doc.payload.credential, ctx.crypto.subtle) };
    },
    apply(state, prepared, doc, arrival) {
        const at = tupleByRkid(state, arrival.rkid);
        const r = recordOfLabel(state, at.tuple.ownPairLabel);
        // the thread rule of 4.3: counter in the bundle's thread, deliver outside it
        const step = doc.ceremony?.step;
        const inBundle = r.thread !== null && doc.threadId === r.thread;
        if (step === 'counter' && !inBundle)
            return refuse('validation-failed', 'RLTP-ENC-5760');
        if (step === 'deliver' && inBundle)
            return refuse('validation-failed');
        if (!inBundle && threadInUse(state, doc.threadId))
            return refuse('validation-failed');
        // the defined effect: buffering (the thread reserved); acceptance (5.6)
        // in the same transaction, its outcome never signaled (7.4)
        const cred = doc.payload.credential;
        const p = prepared.value;
        const bound = Object.hasOwn(state.encounter.records, cred.credentialSubject.challenge) ? state.encounter.records[cred.credentialSubject.challenge] : undefined;
        let e = p.verdict ?? acceptTail(cred, bound && bound.label === r.label ? facts(bound) : undefined, 'credential');
        if (!e && r.in && !sameDigest(r.in.digest, p.credDigest))
            e = 'ERR_CONFLICT';
        let next = inBundle ? r : { ...r, threads: { ...r.threads, [doc.threadId]: arrival.digest } };
        const events = [];
        if (!e && !r.in) {
            next = { ...next, in: { digest: p.credDigest, credential: cred } };
            const place = placeOf(state, r);
            events.push({ type: 'encounter.accepted', contactId: place.contactId, relationshipId: place.relationshipId, mutual: r.out !== null });
        }
        return { state: next === r ? state : withRecord(state, next), events };
    },
};
// ── retention: the aging latch's end (5200–5230) ───────────────────────
function retainChallenges(state, when) {
    const aged = Object.values(state.encounter.challenges).filter((c) => challengeAged(c.tCh, when));
    if (!aged.length)
        return state;
    const challenges = { ...state.encounter.challenges };
    for (const c of aged)
        delete challenges[c.value];
    return { ...state, encounter: { ...state.encounter, challenges } };
}
/** When retainChallenges drops an aged challenge (5.3): the first whole
 *  second past its maximum age and the skew (the timer contract, engine.ts). */
const challengeDeadlines = (state) => Object.values(state.encounter.challenges).map((c) => (Math.floor(c.tCh / 1000) + (CHALLENGE_MAX_AGE + SKEW_TOLERANCE) / 1000 + 1) * 1000);
/** The encounter module createHolder registers. */
export function encounterModule() {
    return Object.freeze({
        name: 'encounter',
        commands: Object.freeze({
            [ENCOUNTER_COMMANDS.show]: showDef,
            [ENCOUNTER_COMMANDS.scan]: scanDef,
            [ENCOUNTER_COMMANDS.capture]: captureDef,
            [ENCOUNTER_COMMANDS.counter]: counterDef,
        }),
        tasks: Object.freeze({ [BUNDLE_TYPE]: bundleTask, [DELIVERY_TYPE]: deliveryTask }),
        decisions: Object.freeze({ 'encounter-confirm': confirmDecision }),
        retain: retainChallenges,
        deadlines: challengeDeadlines,
    });
}
