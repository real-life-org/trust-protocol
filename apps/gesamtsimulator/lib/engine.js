// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// engine — the holder's small engine (lib Stage 2, note §4.1–4.4, 4.7).
//
// Modules own their rules as pure transitions and register commands,
// task handlers and duty handlers here, once, at construction; after
// that the registries are frozen. No module has a commit path of its
// own: the engine coordinates snapshot, preparation, check, commit and
// release, and nothing else.
//
// An act runs in four steps (note §4.2), serialized by one in-engine
// queue:
//   1. read the snapshot {state, version} from the store and decode it;
//      raise `when` to state.lastWhen (4.7)
//   2. prepare (async, outside the transaction): crypto, entropy, ports;
//      `prepared` is bound to the version and commitSeq it ran against
//   3. apply (synchronous, pure, on a deep-frozen snapshot), then one CAS
//      commit of state, outbox, duties, the act journal and commitSeq;
//      on `conflict` back to 1 — the queue serializes this engine, CAS
//      catches every other writer — bounded by retry.commitAttempts
//   4. only after the commit: events to subscribers, the result returned
//
// A commit that throws has an unknown outcome: InfraError
// 'unknown-commit-outcome'. The engine then settles before its next
// operation: it re-reads and, if the commit landed (the stored state is
// the one it wrote, or the journal holds the act at its commitSeq),
// releases that commit's events late; otherwise drops them. A repeated
// human act finds its result in the journal (note §4.2).
//
// Choices this file makes where the note leaves them open:
//   - snapshots handed to prepare/apply are always deep-frozen (also in
//     production): a mutating module throws a TypeError, nothing commits
//   - every act reads the store afresh; the engine caches no state
//   - eventId is `<commitSeq>.<index>`: unique per holder, no entropy
//   - a non-human act whose apply returns the identical state object and
//     nothing else commits nothing (and so does not raise lastWhen);
//     a human act always commits, because its journal entry is the result
//   - outbound of an act starts at attempt 1 with nextAttemptAt =
//     when + backoff(1); resume() re-emits only items that are due
//   - retention of the act journal: max(P90D, retry.horizonMs), the
//     key-retention of Delivery §7 that bounds effects and their acks
//   - the next state is validated by the codec before every commit; an
//     invalid state is a programming error and throws
import { jcs, b64uOf } from './core.js';
import { CODEC, decodeState, encodeState } from './codec.js';
import { emptyState } from './state.js';
import { CryptoUnavailableError, InfraError } from './results.js';
import { randomEntropy } from './entropy.js';
import { ED_PKCS8, X_PKCS8 } from './keys-seed.js';
// ── defaults ───────────────────────────────────────────────────────────
const DAY = 86_400_000;
/** Defaults of the retry policy and the retention it implies. */
export const ENGINE_DEFAULTS = Object.freeze({
    /** 30 s, doubling, at most 6 h */
    backoff: (attempt) => Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 6 * 3_600_000),
    maxAttempts: 8,
    /** P7D, inside Delivery's give-up range [P1D, P90D] */
    horizonMs: 7 * DAY,
    commitAttempts: 8,
    /** max(P90D, horizonMs) with the default horizon */
    retentionMs: 90 * DAY,
});
const BUILTIN = ['tick', 'resume', 'report'];
const TASK_URI = /^[a-z][a-z0-9+.-]*:\S+\/[0-9]+\.[0-9]+$/;
// ── helpers ────────────────────────────────────────────────────────────
/** Freezes an object graph in place and returns it. */
export function freezeDeep(x) {
    if (x !== null && typeof x === 'object' && !Object.isFrozen(x)) {
        Object.freeze(x);
        for (const v of Object.values(x))
            freezeDeep(v);
    }
    return x;
}
const ALGORITHMS = ['Ed25519', 'X25519', 'HKDF', 'HMAC', 'AES-GCM', 'SHA-256'];
const concat = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
/** Resolves the WebCrypto handle and probes every algorithm the library uses. */
async function resolveCrypto(c) {
    const h = c ?? globalThis.crypto;
    const S = h?.subtle;
    if (!S || typeof S.importKey !== 'function' || typeof S.digest !== 'function')
        throw new CryptoUnavailableError(['subtle', ...ALGORITHMS]);
    const k = new Uint8Array(32).fill(1);
    const probes = {
        Ed25519: () => S.importKey('pkcs8', concat(ED_PKCS8, k), { name: 'Ed25519' }, false, ['sign']),
        X25519: () => S.importKey('pkcs8', concat(X_PKCS8, k), { name: 'X25519' }, false, ['deriveBits']),
        HKDF: () => S.importKey('raw', k, 'HKDF', false, ['deriveBits']),
        HMAC: () => S.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
        'AES-GCM': () => S.importKey('raw', k, { name: 'AES-GCM' }, false, ['encrypt']),
        'SHA-256': () => S.digest('SHA-256', k),
    };
    const ok = await Promise.all(ALGORITHMS.map(async (a) => { try {
        await probes[a]();
        return true;
    }
    catch {
        return false;
    } }));
    const missing = ALGORITHMS.filter((_, i) => !ok[i]);
    if (missing.length)
        throw new CryptoUnavailableError(missing);
    return h;
}
const te = new TextEncoder();
/** The stack's document digest (u + multihash sha2-256 over JCS), on the resolved handle. */
const digestOf = async (S, x) => 'u' + b64uOf(concat(Uint8Array.from([0x12, 0x20]), new Uint8Array(await S.digest('SHA-256', te.encode(jcs(x))))));
const inc = (d) => (BigInt(d) + 1n).toString();
const releaseOf = (state) => (rkid) => {
    if (state.addresses.tombstones.includes(rkid))
        return { status: 'retired' };
    if (!Object.hasOwn(state.addresses.keys, rkid))
        return { status: 'unknown' };
    const k = state.addresses.keys[rkid];
    return k.retiredAt !== undefined ? { status: 'retired' } : { status: 'live', label: k.label };
};
const isRefusal = (r) => r?.ok === false;
/** The item's trias position: the last step that is not pre-transport. */
const triasOf = (item) => {
    for (let i = item.history.length - 1; i >= 0; i--) {
        const s = item.history[i].status;
        if (s !== 'awaiting-transport')
            return s;
    }
    return 'submitted';
};
const checkWhen = (when) => {
    if (!Number.isSafeInteger(when) || when < 0)
        throw new TypeError(`when must be non-negative integer milliseconds, got ${String(when)}`);
};
// ── the engine ─────────────────────────────────────────────────────────
class HolderEngine {
    registry;
    #store;
    #ports;
    #crypto;
    #entropy;
    #policy;
    #commands;
    #tasks;
    #duties;
    #builtins;
    #listeners = new Set();
    #chain = Promise.resolve();
    /** a commit whose outcome is unknown, settled before the next operation */
    #unsettled = null;
    constructor(ports, crypto, modules) {
        this.#store = ports.store;
        this.#ports = ports;
        this.#crypto = crypto;
        this.#entropy = ports.entropy ?? randomEntropy();
        const r = ports.retry ?? {};
        const horizonMs = r.horizonMs ?? ENGINE_DEFAULTS.horizonMs;
        this.#policy = Object.freeze({
            backoff: r.backoff ?? ENGINE_DEFAULTS.backoff,
            maxAttempts: r.maxAttempts ?? ENGINE_DEFAULTS.maxAttempts,
            horizonMs,
            commitAttempts: r.commitAttempts ?? ENGINE_DEFAULTS.commitAttempts,
            retentionMs: Math.max(ENGINE_DEFAULTS.retentionMs, horizonMs),
        });
        if (!Number.isSafeInteger(this.#policy.commitAttempts) || this.#policy.commitAttempts < 1)
            throw new RangeError('retry.commitAttempts must be a positive integer');
        if (!Number.isSafeInteger(this.#policy.maxAttempts) || this.#policy.maxAttempts < 1)
            throw new RangeError('retry.maxAttempts must be a positive integer');
        const commands = new Map();
        const tasks = new Map();
        const duties = new Map();
        const names = new Set();
        for (const m of modules) {
            if (!m || typeof m.name !== 'string' || !m.name)
                throw new TypeError('a module needs a name');
            if (names.has(m.name))
                throw new Error(`duplicate module ${m.name}`);
            names.add(m.name);
            for (const [name, def] of Object.entries(m.commands ?? {})) {
                if (commands.has(name) || BUILTIN.includes(name))
                    throw new Error(`duplicate command ${name} (module ${m.name})`);
                if (typeof def?.apply !== 'function' || typeof def.human !== 'boolean')
                    throw new TypeError(`command ${name} (module ${m.name}) needs human and apply`);
                commands.set(name, Object.freeze({ ...def }));
            }
            for (const [uri, h] of Object.entries(m.tasks ?? {})) {
                if (!TASK_URI.test(uri))
                    throw new Error(`not a full task URI with version: ${uri} (module ${m.name})`);
                if (tasks.has(uri))
                    throw new Error(`duplicate task ${uri} (module ${m.name})`);
                if (typeof h?.apply !== 'function')
                    throw new TypeError(`task ${uri} (module ${m.name}) needs apply`);
                tasks.set(uri, Object.freeze({ ...h }));
            }
            for (const [kind, h] of Object.entries(m.duties ?? {})) {
                if (duties.has(kind))
                    throw new Error(`duplicate duty ${kind} (module ${m.name})`);
                if (typeof h?.apply !== 'function')
                    throw new TypeError(`duty ${kind} (module ${m.name}) needs apply`);
                duties.set(kind, Object.freeze({ ...h }));
            }
        }
        this.#commands = commands;
        this.#tasks = tasks;
        this.#duties = duties;
        this.#builtins = Object.freeze({ tick: this.#tickDef(), resume: this.#resumeDef(), report: this.#reportDef() });
        this.registry = Object.freeze({
            commands: Object.freeze([...commands.keys()]),
            tasks: Object.freeze([...tasks.keys()]),
            duties: Object.freeze([...duties.keys()]),
        });
    }
    // ── loading ──────────────────────────────────────────────────────────
    async #readRaw() {
        try {
            return await this.#store.read();
        }
        catch (e) {
            throw new InfraError('store-read', undefined, { cause: e });
        }
    }
    async #read() {
        const snap = await this.#readRaw();
        if (snap.state === null)
            throw new Error('engine: the store holds no state');
        return { state: freezeDeep(decodeState(snap.state)), version: snap.version };
    }
    /** Initialise an empty store with the empty state, or check the stored one decodes. */
    async load() {
        const snap = await this.#readRaw();
        if (snap.state !== null) {
            decodeState(snap.state);
            return;
        }
        let cause;
        try {
            if ((await this.#store.commit(null, emptyState(CODEC))).ok)
                return;
        }
        catch (e) {
            cause = e;
        }
        const again = await this.#readRaw(); // conflict or unknown outcome: someone (maybe we) wrote
        if (again.state === null)
            throw new InfraError('store-commit', 'could not initialise the store', { cause });
        decodeState(again.state);
    }
    // ── the queue ────────────────────────────────────────────────────────
    #enqueue(fn) {
        const p = this.#chain.then(async () => { await this.#settle(); return fn(); });
        this.#chain = p.then(() => undefined, () => undefined);
        return p;
    }
    async #settle() {
        const u = this.#unsettled;
        if (!u)
            return;
        const { state } = await this.#read();
        const landed = jcs(state) === u.text ||
            (u.actId !== undefined && Object.hasOwn(state.acts, u.actId) && state.acts[u.actId].commitSeq === u.commitSeq);
        this.#unsettled = null;
        if (landed)
            this.#announce(u.commitSeq, u.events);
    }
    #announce(commitSeq, events) {
        for (const l of [...this.#listeners]) {
            // a listener's failure neither undoes nor blocks the commit
            try {
                l({ commitSeq, events });
            }
            catch { /* dropped */ }
        }
    }
    // ── the four steps ───────────────────────────────────────────────────
    async #run(def, name, input, when, actId) {
        const inputHash = def.human ? await digestOf(this.#crypto.subtle, { command: name, input }) : undefined;
        for (let attempt = 1; attempt <= this.#policy.commitAttempts; attempt++) {
            // 1 — snapshot, when
            const { state, version } = await this.#read();
            const at = Math.max(when, state.lastWhen);
            if (def.human && Object.hasOwn(state.acts, actId)) {
                const rec = state.acts[actId];
                if (rec.inputHash !== inputHash)
                    return { ok: false, code: 'actid-conflict' };
                return { ok: true, outbound: rec.outboundDigests.map((d) => this.#outboundOf(state, d)), events: structuredClone(rec.events) };
            }
            // 2 — prepare, bound to this snapshot
            const ctx = Object.freeze({
                snapshot: state, keys: this.#ports.keys, entropy: this.#entropy, access: this.#ports.access, log: this.#ports.log,
                crypto: this.#crypto, when: at, release: releaseOf(state),
            });
            const value = def.prepare ? await def.prepare(ctx, input) : undefined;
            const prepared = Object.freeze({ value, version, commitSeq: state.commitSeq });
            // 3 — apply, assemble, CAS
            const r = def.apply(state, prepared, input, at);
            if (isRefusal(r))
                return { ok: false, code: r.code, ...(r.ref !== undefined ? { ref: r.ref } : {}) };
            const drafts = r.outbound ?? [];
            const eventDrafts = r.events ?? [];
            const newDuties = r.duties ?? [];
            const emit = r.emit ?? [];
            if (!def.human && r.state === state && !drafts.length && !eventDrafts.length && !newDuties.length && !emit.length) {
                return { ok: true, outbound: [], events: [], ...(r.nextDueAt !== undefined ? { nextDueAt: r.nextDueAt } : {}) };
            }
            const seq = inc(state.commitSeq);
            const events = eventDrafts.map((e, i) => ({ ...e, eventId: `${seq}.${i}`, commitSeq: seq, ...(def.human ? { actId } : {}) }));
            const outbound = drafts.map((o) => ({ digest: o.digest, envelope: o.envelope, type: o.type, threadId: o.threadId, recipient: o.recipient, attempt: 1 }));
            const outbox = { ...r.state.outbox };
            for (const o of outbound) {
                if (Object.hasOwn(outbox, o.digest))
                    throw new Error(`engine: outbound ${o.digest} is already in the outbox`);
                outbox[o.digest] = {
                    type: o.type, threadId: o.threadId, recipient: o.recipient, envelope: o.envelope, attempt: 1,
                    history: [{ status: 'submitted', at, attempt: 1 }], nextAttemptAt: at + this.#policy.backoff(1),
                };
            }
            const duties = { ...r.state.duties };
            for (const d of newDuties) {
                if (Object.hasOwn(duties, d.id))
                    throw new Error(`engine: duty ${d.id} already exists`);
                duties[d.id] = d;
            }
            const acts = def.human
                ? { ...r.state.acts, [actId]: { actId: actId, inputHash: inputHash, commitSeq: seq, outboundDigests: outbound.map((o) => o.digest), events, at } }
                : r.state.acts;
            const next = { ...r.state, commitSeq: seq, lastWhen: at, outbox, duties, acts };
            const text = encodeState(next); // validates; an invalid next state is a programming error
            let res;
            try {
                res = await this.#store.commit(version, next);
            }
            catch (e) {
                this.#unsettled = { text, commitSeq: seq, events, ...(def.human ? { actId } : {}) };
                throw new InfraError('unknown-commit-outcome', undefined, { cause: e });
            }
            if (!res.ok)
                continue;
            // 4 — release
            this.#announce(seq, events);
            return { ok: true, outbound: [...outbound, ...emit], events, ...(r.nextDueAt !== undefined ? { nextDueAt: r.nextDueAt } : {}) };
        }
        throw new InfraError('commit-conflict', `no commit after ${this.#policy.commitAttempts} attempts`);
    }
    #outboundOf(state, digest) {
        if (!Object.hasOwn(state.outbox, digest))
            throw new Error(`engine: journaled outbound ${digest} is missing from the outbox`);
        const it = state.outbox[digest];
        return structuredClone({ digest, envelope: it.envelope, type: it.type, threadId: it.threadId, recipient: it.recipient, attempt: it.attempt });
    }
    // ── built-ins ────────────────────────────────────────────────────────
    #tickDef() {
        const policy = () => this.#policy;
        return {
            human: false,
            apply(state, _p, _input, when) {
                const keep = (rec, live) => {
                    const out = {};
                    let dropped = false;
                    for (const [k, v] of Object.entries(rec)) {
                        if (live(v))
                            out[k] = v;
                        else
                            dropped = true;
                    }
                    return [out, dropped];
                };
                const [effects, e1] = keep(state.effects, (x) => x.expiresAt > when);
                const [prompts, e2] = keep(state.prompts, (x) => x.expiresAt === undefined || x.expiresAt > when);
                const [acts, e3] = keep(state.acts, (x) => x.at + policy().retentionMs > when);
                if (!e1 && !e2 && !e3 && when <= state.lastWhen)
                    return { state: state };
                return { state: { ...state, effects, prompts, acts } };
            },
        };
    }
    #resumeDef() {
        const policy = () => this.#policy;
        return {
            human: false,
            apply(state, _p, _input, when) {
                const p = policy();
                const outbox = { ...state.outbox };
                const emit = [];
                const events = [];
                let nextDueAt;
                const due = (t) => { nextDueAt = nextDueAt === undefined ? t : Math.min(nextDueAt, t); };
                // fixed order: by due time, then digest
                const order = Object.keys(state.outbox).sort((a, b) => ((state.outbox[a].nextAttemptAt ?? 0) - (state.outbox[b].nextAttemptAt ?? 0)) || (a < b ? -1 : a > b ? 1 : 0));
                for (const digest of order) {
                    const it = state.outbox[digest];
                    if (triasOf(it) !== 'submitted')
                        continue;
                    if (it.nextAttemptAt !== undefined && it.nextAttemptAt > when) {
                        due(it.nextAttemptAt);
                        continue;
                    }
                    const first = it.history.length ? it.history[0].at : when;
                    if (it.attempt >= p.maxAttempts || when - first >= p.horizonMs) {
                        const { nextAttemptAt: _, ...rest } = it;
                        outbox[digest] = { ...rest, history: [...it.history, { status: 'failed', at: when, reason: 'expired-by-adapter-policy' }] };
                        events.push({ type: 'delivery.status', digest, threadId: it.threadId, status: 'failed' });
                        continue;
                    }
                    const attempt = it.attempt + 1;
                    const nextAttemptAt = when + p.backoff(attempt);
                    outbox[digest] = { ...it, attempt, nextAttemptAt, history: [...it.history, { status: 'submitted', at: when, attempt }] };
                    emit.push(structuredClone({ digest, envelope: it.envelope, type: it.type, threadId: it.threadId, recipient: it.recipient, attempt }));
                    due(nextAttemptAt);
                }
                if (!emit.length && !events.length)
                    return { state: state, ...(nextDueAt !== undefined ? { nextDueAt } : {}) };
                return { state: { ...state, outbox }, emit, events, ...(nextDueAt !== undefined ? { nextDueAt } : {}) };
            },
        };
    }
    #reportDef() {
        return {
            human: false,
            apply(state, _p, report, when) {
                if (!Object.hasOwn(state.outbox, report.digest))
                    return { ok: false, code: 'unknown-digest' };
                const it = state.outbox[report.digest];
                const trias = triasOf(it);
                const had = (s) => it.history.some((x) => x.status === s);
                const same = { state: state };
                let step;
                switch (report.status) {
                    case 'awaiting-transport': {
                        const last = it.history[it.history.length - 1];
                        if (trias !== 'submitted')
                            return same; // no step back before the trias
                        if (last?.status === 'awaiting-transport' && last.reason === report.reason)
                            return same;
                        step = { status: 'awaiting-transport', at: when, reason: report.reason };
                        break;
                    }
                    case 'accepted':
                        if (had('accepted') || trias !== 'submitted')
                            return same;
                        step = { status: 'accepted', at: when };
                        break;
                    case 'delivered':
                        if (had('delivered'))
                            return same;
                        if (trias === 'failed' && report.late !== true)
                            return same; // failed → delivered only as a late ack
                        step = { status: 'delivered', at: when, late: report.late };
                        break;
                    case 'failed':
                        if (had('failed') || trias === 'delivered')
                            return same;
                        step = report.reason === 'rejected-by-receiver'
                            ? { status: 'failed', at: when, reason: report.reason, code: report.code }
                            : { status: 'failed', at: when, reason: report.reason };
                        break;
                    default:
                        throw new TypeError(`unknown report status ${String(report.status)}`);
                }
                const base = step.status === 'awaiting-transport' ? it : (({ nextAttemptAt: _, ...rest }) => rest)(it);
                const outbox = { ...state.outbox, [report.digest]: { ...base, history: [...it.history, step] } };
                const events = step.status === 'awaiting-transport' ? [] : [{
                        type: 'delivery.status', digest: report.digest, threadId: it.threadId, status: step.status,
                        ...(step.status === 'delivered' ? { late: step.late } : {}),
                    }];
                return { state: { ...state, outbox }, events };
            },
        };
    }
    // ── public surface ───────────────────────────────────────────────────
    act(command, input, when, opts = {}) {
        const def = this.#commands.get(command);
        if (!def)
            throw new Error(BUILTIN.includes(command) ? `${command} is built in: call engine.${command}()` : `unknown command ${command}`);
        checkWhen(when);
        const actId = def.human ? opts.actId : undefined;
        if (def.human && (typeof actId !== 'string' || actId === ''))
            return Promise.resolve({ ok: false, code: 'actid-missing' });
        return this.#enqueue(async () => {
            const r = await this.#run(def, command, input, when, actId);
            return r.ok ? { ok: true, outbound: r.outbound, events: r.events } : r;
        });
    }
    tick(when) {
        checkWhen(when);
        return this.#enqueue(async () => {
            const r = await this.#run(this.#builtins.tick, 'tick', null, when);
            return r.ok ? { ok: true, outbound: r.outbound, events: r.events } : r;
        });
    }
    resume(when) {
        checkWhen(when);
        return this.#enqueue(async () => {
            const r = await this.#run(this.#builtins.resume, 'resume', null, when);
            if (!r.ok)
                throw new Error(`engine: resume refused (${r.code})`);
            return { outbound: r.outbound, events: r.events, ...(r.nextDueAt !== undefined ? { nextDueAt: r.nextDueAt } : {}) };
        });
    }
    report(report, when) {
        checkWhen(when);
        return this.#enqueue(async () => {
            const r = await this.#run(this.#builtins.report, 'report', report, when);
            return r.ok ? { ok: true, outbound: r.outbound, events: r.events } : r;
        });
    }
    subscribe(listener) {
        if (typeof listener !== 'function')
            throw new TypeError('listener must be a function');
        this.#listeners.add(listener);
        return () => { this.#listeners.delete(listener); };
    }
    snapshot() {
        return this.#enqueue(async () => {
            const { state } = await this.#read();
            return Object.freeze({ state, commitSeq: state.commitSeq });
        });
    }
}
/**
 * Build an engine over the ports and modules: resolves and probes
 * WebCrypto, freezes the registries (duplicate command names, task URIs
 * or duty kinds throw), and initialises an empty store with the empty
 * state at the current codec.
 */
export async function createEngine(ports, modules) {
    if (!ports?.store || !ports.keys)
        throw new TypeError('createEngine needs a store and keys');
    const crypto = await resolveCrypto(ports.crypto);
    const engine = new HolderEngine(ports, crypto, modules);
    await engine.load();
    return engine;
}
