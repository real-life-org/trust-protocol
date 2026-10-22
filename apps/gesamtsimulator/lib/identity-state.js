// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
import { canonicalLabel, communityLabel, deviceLabel, deviceName } from './identity.js';
import { fromB64u, jcs } from './core.js';
import { bindingOf, rawProofValue } from './anchor.js';
import { classOnToward, entryOf, entryRelationships, lags, liveRel } from './trust/state.js';
/** The identity module's command names. */
export const IDENTITY_COMMANDS = Object.freeze({
    addDevice: 'identity.addDevice', revokeDevice: 'identity.revokeDevice', rotate: 'identity.rotate',
});
/** The last generation a rotation moves to (Identity §5.4): 2^53 − 2. */
export const GENERATION_LAST = Number.MAX_SAFE_INTEGER - 1;
/** The register with `label` among its labels (a set: added once). */
export const withLabel = (r, label) => r.labels.includes(label) ? r : { ...r, labels: [...r.labels, label] };
/** The register with a pair label and its relationship nonce (Identity
 *  §6.1): the nonce is recorded alongside the label and never changes. */
export function withPairNonce(r, label, nonce) {
    if (Object.hasOwn(r.pairNonces, label)) {
        if (r.pairNonces[label] !== nonce)
            throw new Error(`identity: ${label} already holds another relationship nonce (§6.1)`);
        return withLabel(r, label);
    }
    return { ...withLabel(r, label), pairNonces: { ...r.pairNonces, [label]: nonce } };
}
/** Does the register hold `nonce` (canonical base64url) as a carrier
 *  nonce of any relationship, or as a pair nonce (Identity §7a.3: N is
 *  fresh and never a pair nonce)? */
export const carrierNonceHeld = (r, nonce) => Object.values(r.carriers).some((list) => list.some((e) => e.nonce === nonce)) || Object.values(r.pairNonces).includes(nonce);
/** The register with the first carrier-nonce entry of relationship
 *  `relId`, generation 1 (Identity §7a.3). A relationship that already
 *  holds an entry is not given a second one here: rotation is not this. */
export function withCarrierNonce(r, relId, nonce) {
    if (Object.hasOwn(r.carriers, relId))
        throw new Error(`identity: ${relId} already holds a carrier nonce (§7a.3)`);
    return { ...r, carriers: { ...r.carriers, [relId]: [{ nonce, generation: '1' }] } };
}
/** The canonical carrier-nonce entry of a relationship (Identity §7a.3):
 *  the highest generation, among equal ones the nonce whose bytes are
 *  smallest in unsigned bytewise order; undefined where none is held. */
export function canonicalCarrierNonce(r, relId) {
    const list = Object.hasOwn(r.carriers, relId) ? r.carriers[relId] : [];
    let best;
    for (const e of list) {
        if (!best) {
            best = e;
            continue;
        }
        const g = BigInt(e.generation) - BigInt(best.generation);
        if (g > 0n || (g === 0n && bytewiseLess(fromB64u(e.nonce), fromB64u(best.nonce))))
            best = e;
    }
    return best;
}
const bytewiseLess = (a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++)
        if (a[i] !== b[i])
            return a[i] < b[i];
    return a.length < b.length;
};
const needName = (x, cmd) => {
    if (x === null || typeof x !== 'object' || Array.isArray(x))
        throw new TypeError(`${cmd} needs an input object`);
    const n = x.name;
    if (typeof n !== 'string')
        throw new TypeError(`${cmd}: name must be a string`);
    return n;
};
const refuse = (code, ref) => ({ ok: false, code, ...(ref ? { ref } : {}) });
const commands = {
    // §5.5: the name is persisted before any key derived from it is presented
    [IDENTITY_COMMANDS.addDevice]: {
        human: true,
        apply(state, _p, input) {
            const n = deviceName(needName(input, IDENTITY_COMMANDS.addDevice));
            if (n === null)
                return refuse('device-name-invalid', 'Identity §6.2');
            const d = state.register.devices;
            if (d.revoked.includes(n))
                return refuse('device-name-revoked', 'Identity §5.5');
            if (d.names.includes(n))
                return refuse('device-name-held', 'Identity §5.5');
            return {
                state: { ...state, register: { ...state.register, devices: { ...d, names: [...d.names, n] } } },
                events: [{ type: 'device.added', name: n }],
            };
        },
    },
    // §5.5: revocation consumes the name; the mark is never removed
    [IDENTITY_COMMANDS.revokeDevice]: {
        human: true,
        apply(state, _p, input) {
            const n = deviceName(needName(input, IDENTITY_COMMANDS.revokeDevice));
            const d = state.register.devices;
            if (n === null || !d.names.includes(n))
                return refuse('unknown-device', 'Identity §5.5');
            if (d.revoked.includes(n))
                return { state: state };
            return {
                state: { ...state, register: { ...state.register, devices: { ...d, revoked: [...d.revoked, n] } } },
                events: [{ type: 'device.revoked', name: n }],
            };
        },
    },
};
// ── the rotation (Identity §5.4, Trust 6360–6420, 6596, Access §5.6) ──
/** The rotation duty's id for a rotation. */
export const rotationDutyId = (rotationId) => `rotation:${rotationId}`;
/** A re-issue duty's id after the rotation to generation `to` (6370). */
export const reissueId = (to, relId) => `reissue:${to}:${relId}`;
/**
 * Where the log stands for the rotation g → g+1 (Identity §5.4, RLTP-ACC-
 * 5980): `present`, its generation g+1 holds this rotation (at(g+1) names
 * this next and commit — appended by this device with its answer lost, or
 * by another device of the same seed, the log since moved on or not);
 * `{over}`, the device may append over that head (empty for g = 1, else
 * the entry that introduced g: gen g, next = prev, commit = the binding of
 * next); `behind`, the log has not reached g; `diverged`, another genesis,
 * another entry at g+1 (a fork), or a head the rotation does not continue.
 */
async function standing(ctx, head, genesis, from, rot) {
    if (head.genesis !== genesis)
        return 'diverged';
    if ('empty' in head)
        return from === 1 ? { over: null } : 'behind';
    if (head.gen >= from + 1) {
        const e = await ctx.log.at(from + 1);
        return e && e.next === rot.next && e.commit === rot.commit ? 'present' : 'diverged';
    }
    if (head.gen === from && head.next === rot.prev && head.commit === await bindingOf(rot.next, ctx.crypto.subtle))
        return { over: head.entryId };
    return head.gen < from ? 'behind' : 'diverged';
}
const headId = (h) => ('empty' in h ? null : h.entryId);
/**
 * Step 2 through the Log port (see the header): where the log stands, then
 * append(entry, the persisted overHead) — only ever over the head the
 * rotation record names, so the port's idempotence over exactly (entry,
 * overHead) holds across a lost answer; a head that moved is persisted
 * first ('moved'). head-conflict re-reads. A port that throws is a
 * failure: the rotation stays pending.
 */
async function logStep(ctx, r, genesis) {
    const log = ctx.log;
    if (!log)
        return { status: 'log-missing' };
    const rot = r.entry.rotation;
    try {
        for (let i = 0; i < 4; i++) {
            const head = await log.head();
            const at = await standing(ctx, head, genesis, Number(r.from), rot.body);
            if (at === 'present')
                return { status: 'done', head };
            if (at === 'behind' || at === 'diverged')
                return { status: at, head };
            if (at.over !== headId(r.overHead) || head.genesis !== r.overHead.genesis)
                return { status: 'moved', head };
            const a = await log.append({ rotation: rot }, at.over);
            if (a.status === 'appended' || a.status === 'exists')
                return { status: 'done', head: a.head };
            if (a.status === 'failure')
                return { status: 'failure', reason: a.reason };
            // head-conflict: re-read
        }
        return { status: 'failure', reason: 'head-conflict persisted' };
    }
    catch (e) {
        return { status: 'failure', reason: e?.message ?? String(e) };
    }
}
/** 6596, per relationship: the anchor mapping class on for it (live, under
 *  its entry), and whether it lags there — then H, else null. */
function withholding(state, relId) {
    const r = state.relationships[relId];
    if (!r || !liveRel(r))
        return null;
    const e = entryOf(state, r);
    if (!e || !e.relIds.includes(r.id) || !classOnToward(e, 'anchorMapping'))
        return null;
    return { contactId: e.id, awaitHead: lags(r, entryRelationships(state, e)) && e.anchorHead !== null ? e.anchorHead : null };
}
/** Step 1's commit (see the header). */
function startRotation(state, p, when) {
    const com = state.register.community;
    if (com === null || com.head !== p.from || Object.keys(state.rotations).length)
        return refuse('in-flight');
    const awaitHead = {};
    for (const id of Object.keys(state.relationships).sort()) {
        const w = withholding(state, id);
        if (w)
            awaitHead[id] = w.awaitHead;
    }
    const rotation = { id: p.id, from: p.from, to: p.to, step: 'log', startedAt: when, entry: p.entry, overHead: p.overHead, awaitHead };
    const duty = { kind: 'rotation', v: 1, id: rotationDutyId(p.id), rotationId: p.id };
    return {
        state: { ...state, register: withLabel(state.register, p.label), rotations: { ...state.rotations, [p.id]: rotation } },
        duties: [duty],
    };
}
/** The completion's commit: head, lineage, the re-issues of 6370 (6596). */
function completeRotation(state, r) {
    const com = state.register.community;
    if (com === null || com.head !== r.from)
        return refuse('in-flight');
    const rot = r.entry.rotation;
    const duties = [];
    const reissue = (relId, contactId, awaitHead) => {
        duties.push({ kind: 'reissue-mapping', v: 1, id: reissueId(r.to, relId), contactId, relId, awaitHead });
    };
    // decided at step 1 (6596), where the class is still on for it now
    for (const [relId, awaitHead] of Object.entries(r.awaitHead).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        const w = withholding(state, relId);
        if (w)
            reissue(relId, w.contactId, awaitHead);
    }
    // on for it now, unknown to step 1: decided now
    for (const relId of Object.keys(state.relationships).sort()) {
        if (Object.hasOwn(r.awaitHead, relId))
            continue;
        const w = withholding(state, relId);
        if (w)
            reissue(relId, w.contactId, w.awaitHead);
    }
    const rotations = { ...state.rotations };
    delete rotations[r.id];
    const left = { ...state.duties };
    delete left[rotationDutyId(r.id)];
    return {
        state: {
            ...state,
            register: { ...withLabel(state.register, communityLabel(com.genesis, Number(r.to))), community: { ...com, head: r.to }, lineage: [...state.register.lineage, rot] },
            rotations,
            duties: left,
        },
        events: [{ type: 'anchor.rotated', generation: r.to }],
        duties,
    };
}
/** What step 2's outcome means for the rotation: completion, or why not. */
function afterLog(state, rotationId, o, when) {
    const r = Object.hasOwn(state.rotations, rotationId) ? state.rotations[rotationId] : undefined;
    if (!r)
        return refuse('in-flight');
    switch (o.status) {
        case 'done': return completeRotation(state, r);
        case 'moved': {
            // the closure's head, persisted before any append over it; the duty
            // runs again at once (lastAt marks the change, no dueAt)
            const id = rotationDutyId(r.id);
            const held = Object.hasOwn(state.duties, id) ? state.duties[id] : { kind: 'rotation', v: 1, id, rotationId: r.id };
            const { dueAt: _, ...rest } = held;
            const duty = { ...rest, lastAt: when };
            // single path: the duty leaves the state and comes back as Applied.duties,
            // on the act path and in resume alike
            const left = { ...state.duties };
            delete left[id];
            return {
                state: { ...state, rotations: { ...state.rotations, [r.id]: { ...r, overHead: o.head } }, duties: left },
                duties: [duty],
            };
        }
        case 'behind': return refuse('log-behind', 'RLTP-ACC-5980');
        case 'diverged': return refuse('log-diverged', 'RLTP-ACC-5980');
        case 'log-missing': return refuse('log-missing');
        case 'failure': return refuse('log-failure');
    }
}
const rotateCommand = {
    human: true,
    async prepare(ctx) {
        const st = ctx.snapshot;
        const com = st.register.community;
        if (com === null)
            return { kind: 'refuse', code: 'no-community' };
        if (!ctx.log)
            return { kind: 'refuse', code: 'log-missing' };
        const running = Object.values(st.rotations)[0];
        if (running)
            return { kind: 'resume', rotationId: running.id, outcome: await logStep(ctx, running, com.genesis) };
        const g = Number(com.head);
        if (!Number.isSafeInteger(g) || g < 1 || g + 1 > GENERATION_LAST)
            return { kind: 'refuse', code: 'scope-exhausted', ref: 'Identity §5.4' };
        const [prevL, nextL, afterL] = [g, g + 1, g + 2].map((k) => communityLabel(com.genesis, k));
        const [prev, next, after] = await Promise.all([prevL, nextL, afterL].map((l) => ctx.keys.anchorOf(l)));
        const body = { type: 'anchor-rotation@2', prev: prev.anchor, next: next.anchor, commit: await bindingOf(after.anchor, ctx.crypto.subtle) };
        const bytes = new TextEncoder().encode(jcs(body));
        const rotation = {
            body,
            proof: { proofValue: rawProofValue(await ctx.keys.sign(prevL, bytes)), successorProofValue: rawProofValue(await ctx.keys.sign(nextL, bytes)) },
        };
        // §5.4: the device rotates only over the log it holds — checked before
        // anything commits, so label and 6596 decision persist only when it may
        const overHead = await ctx.log.head();
        const at = await standing(ctx, overHead, com.genesis, g, body);
        if (at === 'behind')
            return { kind: 'refuse', code: 'log-behind', ref: 'RLTP-ACC-5980' };
        if (at === 'diverged')
            return { kind: 'refuse', code: 'log-diverged', ref: 'RLTP-ACC-5980' };
        const to = String(g + 1);
        return { kind: 'start', id: to, from: com.head, to, entry: { rotation }, overHead, label: nextL };
    },
    apply(state, prepared, _input, when) {
        const p = prepared.value;
        if (p.kind === 'refuse')
            return refuse(p.code, p.ref);
        if (p.kind === 'start')
            return startRotation(state, p, when);
        return afterLog(state, p.rotationId, p.outcome, when);
    },
};
/** The rotation duty (rotation/1): step 2 on resume. */
const rotationDuty = {
    v: 1,
    async prepare(ctx, duty) {
        const r = ctx.snapshot.rotations[duty.rotationId];
        const com = ctx.snapshot.register.community;
        return r && com ? logStep(ctx, r, com.genesis) : null;
    },
    apply(state, duty, ctx, when) {
        const d = duty;
        // a rotation completed (by the act) or gone: nothing left to do
        if (!Object.hasOwn(state.rotations, d.rotationId))
            return { state: state };
        const o = ctx.prepared.value;
        if (o === null)
            return 'not-due';
        if (o.status === 'failure') {
            // pending, due again after the retry backoff (the duty's own attempt)
            const attempt = (d.attempt ?? 0) + 1;
            const again = { ...d, attempt, lastAt: when, dueAt: Math.min(when + Math.max(0, Math.ceil(ctx.backoff(attempt))), Number.MAX_SAFE_INTEGER) };
            return { state: state, duties: [again] };
        }
        return afterLog(state, d.rotationId, o, when);
    },
};
/** Whether `label` names an own anchor context: a label of the register,
 *  or a generation of the community anchor up to its head (§5.4). */
function ownContext(state, label) {
    if (label.startsWith('device/'))
        return false;
    // the community's generations first, bounded by the head: the label of
    // a pending g+1 is recorded, but no key is presented under it before the
    // rotation completes (§5.4)
    const c = state.register.community;
    if (c !== null) {
        const base = communityLabel(c.genesis, 1);
        if (label === base)
            return true;
        if (label.startsWith(base + '/')) {
            const g = BigInt(label.slice(base.length + 1));
            return g >= 2n && g <= BigInt(c.head);
        }
    }
    return state.register.labels.includes(label);
}
/**
 * The device key of a held, unrevoked device name under an own anchor
 * context (Identity §5.5): derived through the KeyProvider, never stored
 * (keys are not state, 9.3).
 */
export async function deviceKeyOf(state, keys, name, contextLabel) {
    const n = deviceName(name);
    const d = state.register.devices;
    if (n === null || !d.names.includes(n))
        return { ok: false, code: 'unknown-device' };
    if (d.revoked.includes(n))
        return { ok: false, code: 'device-revoked' };
    const a = canonicalLabel(contextLabel);
    if (a === null || !ownContext(state, a))
        return { ok: false, code: 'unknown-context' };
    const label = await deviceLabel(n, a);
    const k = await keys.anchorOf(label);
    return { ok: true, label, device: k.anchor, keyAgreement: k.keyAgreement };
}
/** The identity module createHolder builds in (see the header). */
export function identityModule() {
    return Object.freeze({
        name: 'identity',
        commands: Object.freeze({ ...commands, [IDENTITY_COMMANDS.rotate]: rotateCommand }),
        duties: Object.freeze({ rotation: rotationDuty }),
    });
}
