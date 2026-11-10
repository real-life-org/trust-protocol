// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
import { metInEnactment, theirChannelOf } from './state.js';
import { jcs, b64uOf, fromB64u } from './core.js';
import { digestBytes } from './crypto.js';
import { withPairNonce, withCarrierNonce, canonicalCarrierNonce } from './identity-state.js';
import { idsOf, offerRefusal, nonceStale } from './encounter/ceremony.js';
import { openTuple } from './trust/continuity.js';
import * as sc from './shared-connect.js';
import { Inviter, Responder, Machine } from './shared-connect-flow.js';
export const SC_COMMANDS = Object.freeze({ show: 'sharedconnect.show', propose: 'sharedconnect.propose', receive: 'sharedconnect.receive' });
export const SC_PROMPT = 'shared-connect-confirm';
export const promptIdOf = (id) => 'sharedconnect:' + id;
/** a declined, failed or never answered enactment is kept this long after it closed (or its link expired);
 *  a complete enactment stays: its flow snapshot holds both signed credentials and the propose they cite,
 *  the only place the holder keeps them (the relationship stores identifiers and keys, no credentials) */
export const RETENTION = 30 * 24 * 3_600_000;
const no = (code, ref) => ({ ok: false, code, ...(ref ? { ref } : {}) });
/** the register with the offer's carrier nonce under the relationship `label` opens, or unchanged without an offer */
const carrierOf = (r, label, carrier) => carrier === undefined ? r : withCarrierNonce(r, idsOf(label).relId, carrier.nonce);
const isRefusal = (x) => !!x && typeof x === 'object' && x.ok === false;
/** the nonce the messaging identity derives from: the inviter's handle, the responder's own challenge */
const nonceOf = (e) => fromB64u(e.role === 'inviter' ? e.id : e.flow.challenge);
async function partyOf(ctx, e) {
    if (!ctx.keys.sharedConnectMessaging)
        return null;
    const m = await ctx.keys.sharedConnectMessaging(nonceOf(e));
    const own = await ctx.keys.anchorOf(e.label);
    const p = { messaging: { did: e.did, sign: m.sign }, pair: { anchor: own.anchor, keyAgreement: own.keyAgreement, sign: (h) => ctx.keys.sign(e.label, h) } };
    if (e.name)
        p.name = e.name;
    return p;
}
/** the options of one preparation: document ids from this holder's entropy; never shared between holders */
const flowOpts = (ctx, carrier) => ({ newId: () => ctx.entropy.id('doc.id'), card: true, ...(carrier ? { deliveryHints: [...carrier.deliveryHints] } : {}) });
const machineOf = (ctx, party, e) => e.role === 'inviter'
    ? new Inviter(party, { id: e.id, exp: e.link.exp }, flowOpts(ctx), e.flow)
    : new Responder(party, e.link, e.flow.challenge, e.channel, flowOpts(ctx), e.flow);
function applyStep(state, step, when, extra = []) {
    const e = state.sharedConnect.enactments[step.id];
    if (!e)
        return no('enactment-unknown');
    if (jcs(e.flow) !== step.before)
        return no('concurrent');
    const after = step.after;
    const events = [...extra];
    let s = state;
    let duties = [];
    let prompts = state.prompts;
    let status = e.status;
    let contactId = e.contactId;
    let theirPair = e.theirPair;
    for (const ev of step.r.events) {
        switch (ev.kind) {
            case 'proposed': {
                const prompt = { id: promptIdOf(e.id), kind: SC_PROMPT, openedAt: when, expiresAt: (e.link.exp + sc.CLOCK_TOLERANCE_S) * 1000 + RETENTION };
                prompts = { ...prompts, [prompt.id]: prompt };
                theirPair = ev.relationshipDid;
                events.push({ type: 'prompt.opened', promptId: prompt.id, kind: SC_PROMPT }, { type: 'sharedconnect.pending', id: e.id, promptId: prompt.id, name: ev.name });
                break;
            }
            case 'accepted':
                theirPair = ev.relationshipDid;
                events.push({ type: 'sharedconnect.accepted', id: e.id });
                break;
            case 'declined':
                status = 'declined';
                events.push({ type: 'sharedconnect.declined', id: e.id });
                break;
            case 'credential':
                events.push({ type: 'sharedconnect.credential', id: e.id, step: ev.step });
                break;
            case 'failed': {
                status = 'failed';
                // the counterpart ended the enactment while the person had not decided: the prompt closes with it,
                // silently (as membership does); `sharedconnect.failed` is the event the app reads, no `prompt.*`
                if (Object.hasOwn(prompts, promptIdOf(e.id))) {
                    prompts = { ...prompts };
                    delete prompts[promptIdOf(e.id)];
                }
                events.push({ type: 'sharedconnect.failed', id: e.id, code: ev.code });
                break;
            }
            case 'refused':
                events.push({ type: 'sharedconnect.refused', id: e.id, docType: ev.type, reason: ev.reason });
                break;
            case 'complete': {
                status = 'complete';
                // design (d): the counterpart's card in its issue opens the relationship; without one the credentials stay here
                const card = sc.cardOfIssue(after.issueTheirs);
                if (card && theirPair && contactId === null) {
                    const ids = idsOf(e.label);
                    const rkid = Object.entries(s.addresses.keys).find(([, k]) => k.label === e.label)?.[0];
                    if (rkid && !Object.hasOwn(s.relationships, ids.relId) && !Object.hasOwn(s.contacts, ids.contactId)) {
                        const opened = openTuple(s, { relId: ids.relId, contactId: ids.contactId, ownPairLabel: e.label, counterpartAnchor: theirPair, counterpartKeyAgreement: card.keyAgreement, provenance: { kind: 'ceremony' } }, rkid, when);
                        s = opened.state;
                        contactId = ids.contactId;
                        events.push(...(opened.events ?? []));
                        duties = opened.duties ?? [];
                    }
                }
                events.push({ type: 'sharedconnect.complete', id: e.id, contactId });
                break;
            }
            default: break; // held, ignored: nothing to show
        }
    }
    if (step.r.send.length)
        events.push({ type: 'sharedconnect.send', id: e.id, to: e.role === 'inviter' ? after.propose?.issuer ?? '' : e.link.from, docs: step.r.send });
    const next = { ...e, flow: after, status, contactId, theirPair, closedAt: e.closedAt ?? (status !== 'open' ? when : null) };
    return { state: { ...s, prompts, sharedConnect: { enactments: { ...s.sharedConnect.enactments, [e.id]: next } } }, events, duties };
}
const showDef = {
    human: true,
    async prepare(ctx, input) {
        if (!ctx.keys.sharedConnectMessaging)
            return no('keys-missing');
        const offer = offerRefusal(input?.carrier);
        if (offer)
            return offer;
        const relays = Array.isArray(input?.relays) ? input.relays : [];
        const channel = input?.channel === 'sent' ? 'sent' : 'displayed';
        const n32 = ctx.entropy.bytes('founding.nonce', 32);
        const label = 'pair/' + await digestBytes(n32, ctx.crypto.subtle);
        const own = await ctx.keys.anchorOf(label);
        const id16 = ctx.entropy.bytes('challenge', 16);
        const id = sc.challengeOf16(id16);
        const m = await ctx.keys.sharedConnectMessaging(id16);
        const did = sc.peer2Of(m.ed, m.x, relays);
        const nowS = Math.floor(ctx.when / 1000);
        const cap = channel === 'sent' ? sc.MAX_EXP_LINK_S : sc.MAX_EXP_CODE_S;
        const exp = nowS + Math.min(Math.max(60, Math.round((input?.minutes ?? 10) * 60)), cap);
        const name = typeof input?.name === 'string' && input.name.length ? input.name : null;
        let link;
        const origin = typeof input?.origin === 'string' && /^https:\/\/[^/?#]+$/.test(input.origin) ? input.origin : undefined;
        try {
            link = await sc.sharedConnectLink({ from: did, id, exp, kind: channel === 'sent' ? 'link' : 'code', ...(name && channel === 'displayed' ? { label: name } : {}) }, origin, nowS);
        }
        catch {
            return no('link-invalid');
        }
        const party = { messaging: { did, sign: m.sign }, pair: { anchor: own.anchor, keyAgreement: own.keyAgreement, sign: (h) => ctx.keys.sign(label, h) }, ...(name ? { name } : {}) };
        const flow = new Inviter(party, { id, exp }, flowOpts(ctx, input?.carrier)).snapshot();
        return { label, nonce: b64uOf(n32), rkid: own.keyAgreement, id, did, link, exp, flow, relays, name, channel };
    },
    apply(state, prepared, input, when) {
        const p = prepared.value;
        if (isRefusal(p))
            return p;
        if (nonceStale(state, input?.carrier, p.nonce))
            return no('carrier-nonce-invalid');
        if (state.register.labels.includes(p.label) || Object.hasOwn(state.sharedConnect.enactments, p.id))
            throw new Error('sharedconnect.show: the label or the handle is not fresh');
        const e = {
            id: p.id, role: 'inviter', label: p.label, did: p.did, relays: p.relays.map((r) => ({ kind: r.kind, address: r.address, ...(r.multiaddrs ? { multiaddrs: [...r.multiaddrs] } : {}) })),
            link: { from: p.did, id: p.id, exp: p.exp, label: p.channel === 'displayed' ? p.name : null }, channel: p.channel, openedAt: when, closedAt: null, status: 'open',
            flow: p.flow, contactId: null, theirPair: null, name: p.name,
        };
        return {
            state: {
                ...state,
                // the carrier nonce beside the label, under the relationship the label opens (as encounter.show does)
                register: carrierOf(withPairNonce(state.register, p.label, p.nonce), p.label, input?.carrier),
                addresses: { ...state.addresses, keys: { ...state.addresses.keys, [p.rkid]: { label: p.label, lastShown: when } } },
                sharedConnect: { enactments: { ...state.sharedConnect.enactments, [p.id]: e } },
            },
            events: [{ type: 'sharedconnect.shown', id: p.id, link: p.link, did: p.did }],
        };
    },
};
const proposeDef = {
    human: true,
    async prepare(ctx, input) {
        if (!ctx.keys.sharedConnectMessaging)
            return no('keys-missing');
        if (typeof input?.link !== 'string')
            return no('link-invalid');
        const offer = offerRefusal(input.carrier);
        if (offer)
            return offer;
        const nowS = Math.floor(ctx.when / 1000);
        const read = await sc.readSharedConnectLink(input.link, nowS);
        if (!read.ok)
            return no('link-invalid', read.reason);
        const relays = Array.isArray(input.relays) ? input.relays : [];
        const channel = input.channel === 'link' ? 'link' : 'scan';
        const n32 = ctx.entropy.bytes('founding.nonce', 32);
        const label = 'pair/' + await digestBytes(n32, ctx.crypto.subtle);
        const own = await ctx.keys.anchorOf(label);
        const ch16 = ctx.entropy.bytes('challenge', 16);
        const challenge = sc.challengeOf16(ch16);
        const m = await ctx.keys.sharedConnectMessaging(ch16);
        const did = sc.peer2Of(m.ed, m.x, relays);
        const name = typeof input.name === 'string' && input.name.length ? input.name : null;
        const party = { messaging: { did, sign: m.sign }, pair: { anchor: own.anchor, keyAgreement: own.keyAgreement, sign: (h) => ctx.keys.sign(label, h) }, ...(name ? { name } : {}) };
        const R = new Responder(party, read.link, challenge, channel, flowOpts(ctx, input.carrier));
        const r = await R.start(ctx.when);
        const link = { from: read.link.from.did, id: read.link.id, exp: read.link.exp, label: read.link.label ?? null };
        return { label, nonce: b64uOf(n32), rkid: own.keyAgreement, id: read.link.id, did, link, flow: R.snapshot(), send: r.send, relays, name, channel };
    },
    apply(state, prepared, input, when) {
        const p = prepared.value;
        if (isRefusal(p))
            return p;
        if (nonceStale(state, input?.carrier, p.nonce))
            return no('carrier-nonce-invalid');
        if (state.register.labels.includes(p.label))
            throw new Error('sharedconnect.propose: the label is not fresh');
        if (Object.hasOwn(state.sharedConnect.enactments, p.id))
            return no('enactment-closed', state.sharedConnect.enactments[p.id].role === 'responder' ? 'this link was already answered' : 'this is the handle of an own link');
        const e = {
            id: p.id, role: 'responder', label: p.label, did: p.did, relays: p.relays.map((r) => ({ kind: r.kind, address: r.address, ...(r.multiaddrs ? { multiaddrs: [...r.multiaddrs] } : {}) })),
            link: p.link, channel: p.channel, openedAt: when, closedAt: null, status: 'open', flow: p.flow, contactId: null, theirPair: null, name: p.name,
        };
        return {
            state: {
                ...state,
                register: carrierOf(withPairNonce(state.register, p.label, p.nonce), p.label, input?.carrier),
                addresses: { ...state.addresses, keys: { ...state.addresses.keys, [p.rkid]: { label: p.label, lastShown: when } } },
                sharedConnect: { enactments: { ...state.sharedConnect.enactments, [p.id]: e } },
            },
            events: [{ type: 'sharedconnect.proposed', id: p.id, did: p.did }, { type: 'sharedconnect.send', id: p.id, to: p.link.from, docs: p.send }],
        };
    },
};
// ── receive ────────────────────────────────────────────────────────────
const receiveDef = {
    human: false,
    async prepare(ctx, input) {
        const doc = input?.doc;
        const id = doc?.ceremony?.enactment;
        if (typeof id !== 'string')
            return no('enactment-unknown');
        const e = ctx.snapshot.sharedConnect.enactments[id];
        if (!e)
            return no('enactment-unknown');
        if (typeof input?.sender !== 'string')
            return no('enactment-unknown', 'sender');
        const party = await partyOf(ctx, e);
        if (!party)
            return no('keys-missing');
        const machine = machineOf(ctx, party, e);
        const r = await machine.receive(input.doc, input.sender, ctx.when);
        return { id, before: jcs(e.flow), after: machine.snapshot(), r };
    },
    apply(state, prepared, _input, when) {
        const p = prepared.value;
        if (isRefusal(p))
            return p;
        return applyStep(state, p, when);
    },
};
// ── the inviter's decision ─────────────────────────────────────────────
const confirmDecision = {
    async prepare(ctx, prompt, choice) {
        const id = prompt.id.slice('sharedconnect:'.length);
        const e = ctx.snapshot.sharedConnect.enactments[id];
        if (!e || e.role !== 'inviter')
            return no('enactment-unknown');
        const flow = e.flow;
        if (!flow.propose || flow.accept || flow.decline || flow.failed)
            return no('not-pending');
        const party = await partyOf(ctx, e);
        if (!party)
            return no('keys-missing');
        const machine = machineOf(ctx, party, e);
        const r = choice === 'accept' ? await machine.accept(ctx.when, e.channel) : await machine.decline(ctx.when);
        return { id, before: jcs(e.flow), after: machine.snapshot(), r };
    },
    apply(state, _prompt, _choice, when, prepared) {
        const p = prepared.value;
        if (isRefusal(p))
            return p;
        return applyStep(state, p, when);
    },
};
// ── retention and keys ─────────────────────────────────────────────────
/** when a not complete enactment leaves the state; `null` for a complete one (it stays) and for an open one before any decision */
const leavesAt = (e) => e.status === 'open' ? (e.link.exp + sc.CLOCK_TOLERANCE_S) * 1000 + RETENTION
    : e.status === 'complete' ? null
        : e.closedAt === null ? null : e.closedAt + RETENTION;
function retain(state, when) {
    // complete enactments stay (see RETENTION); declined and failed ones leave RETENTION after they closed,
    // never answered ones RETENTION after the link expired (their prompt, if any, expires with them)
    const gone = Object.values(state.sharedConnect.enactments).filter((e) => { const d = leavesAt(e); return d !== null && when >= d; });
    if (!gone.length)
        return state;
    const enactments = { ...state.sharedConnect.enactments };
    for (const e of gone)
        delete enactments[e.id];
    return { ...state, sharedConnect: { enactments } };
}
export function sharedConnectModule() {
    return Object.freeze({
        name: 'shared-connect',
        commands: Object.freeze({ [SC_COMMANDS.show]: showDef, [SC_COMMANDS.propose]: proposeDef, [SC_COMMANDS.receive]: receiveDef }),
        decisions: Object.freeze({ [SC_PROMPT]: confirmDecision }),
        keepKeys: (state) => Object.entries(state.addresses.keys).filter(([, k]) => Object.values(state.sharedConnect.enactments).some((e) => e.label === k.label)).map(([rkid]) => rkid),
        retain,
        deadlines: (state) => Object.values(state.sharedConnect.enactments).map(leavesAt).filter((d) => d !== null),
    });
}
export function sharedConnectView(state) {
    return Object.values(state.sharedConnect.enactments).sort((a, b) => a.openedAt - b.openedAt).map((e) => {
        const f = e.flow;
        const pending = e.role === 'inviter' && f.propose && !f.accept && !f.decline && e.status === 'open';
        return {
            id: e.id, role: e.role, status: e.status, link: e.link, did: e.did,
            theirDid: e.role === 'inviter' ? f.propose?.issuer ?? null : e.link.from,
            theirPair: e.theirPair, name: e.role === 'inviter' ? (f.propose?.payload?.reason ?? null) : e.link.label,
            channel: e.channel, theirChannel: theirChannelOf(e), met: metInEnactment(e), promptId: pending ? promptIdOf(e.id) : null, contactId: e.contactId,
            carrierNonce: canonicalCarrierNonce(state.register, idsOf(e.label).relId)?.nonce ?? null,
            failure: f.failed ? { code: f.failed.code, step: f.failed.step, message: f.failed.message } : null,
            theirCredential: f.issueTheirs?.payload?.vrc ?? null, myCredential: f.issueMine?.payload?.vrc ?? null, outbox: Machine.outboxOf(f), openedAt: e.openedAt, closedAt: e.closedAt,
        };
    });
}
