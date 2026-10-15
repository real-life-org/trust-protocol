// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
import { canonicalLabel, communityLabel, deviceLabel, deviceName } from './identity.js';
import { jcs } from './core.js';
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
 * Step 2 through the Log port (see the header): the precondition of §5.4
 * against head(), then append(entry, head) idempotently; head-conflict
 * re-reads. A port that throws is a failure: the rotation stays pending.
 */
async function logStep(ctx, r, genesis) {
    const log = ctx.log;
    if (!log)
        return { status: 'log-missing' };
    const rot = r.entry.rotation;
    const from = Number(r.from);
    try {
        for (let i = 0; i < 4; i++) {
            const head = await log.head();
            if (head.genesis !== genesis)
                return { status: 'diverged', head };
            let over;
            if ('empty' in head) {
                if (from !== 1)
                    return { status: 'behind', head };
                over = null;
            }
            else if (head.next === rot.body.next) {
                // the log holds this rotation already (an append whose answer was
                // lost): the closure's append again, which the log answers exists
                over = 'empty' in r.overHead ? null : r.overHead.entryId;
            }
            else if (head.gen === from && head.next === rot.body.prev) {
                // 5960: the head's binding admits next, or the log is no lineage of this register
                if (head.commit !== await bindingOf(rot.body.next, ctx.crypto.subtle))
                    return { status: 'diverged', head };
                over = head.entryId;
            }
            else {
                return { status: head.gen < from ? 'behind' : 'diverged', head };
            }
            const a = await log.append({ rotation: rot }, over);
            if (a.status === 'appended' || a.status === 'exists')
                return { status: 'done', head: a.head };
            if (a.status === 'failure')
                return { status: 'failure', reason: a.reason };
            // head-conflict: re-read and retry
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
function afterLog(state, rotationId, o) {
    const r = Object.hasOwn(state.rotations, rotationId) ? state.rotations[rotationId] : undefined;
    if (!r)
        return refuse('in-flight');
    switch (o.status) {
        case 'done': return completeRotation(state, r);
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
        const overHead = await ctx.log.head();
        const to = String(g + 1);
        return { kind: 'start', id: to, from: com.head, to, entry: { rotation }, overHead, label: nextL };
    },
    apply(state, prepared, _input, when) {
        const p = prepared.value;
        if (p.kind === 'refuse')
            return refuse(p.code, p.ref);
        if (p.kind === 'start')
            return startRotation(state, p, when);
        return afterLog(state, p.rotationId, p.outcome);
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
        return afterLog(state, d.rotationId, o);
    },
};
/** Whether `label` names an own anchor context: a label of the register,
 *  or a generation of the community anchor up to its head (§5.4). */
function ownContext(state, label) {
    if (label.startsWith('device/'))
        return false;
    if (state.register.labels.includes(label))
        return true;
    const c = state.register.community;
    if (c === null)
        return false;
    const base = communityLabel(c.genesis, 1);
    if (label === base)
        return true;
    if (!label.startsWith(base + '/'))
        return false;
    const g = BigInt(label.slice(base.length + 1));
    return g >= 2n && g <= BigInt(c.head);
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
