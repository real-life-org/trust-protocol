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
//   - the input is bound at the public call: a canonical, deep-frozen JSON
//     copy (undefined object members dropped, anything else non-JSON
//     refused); its hash, every preparation and every apply use that copy
//   - a `when` above lastWhen is a state change and commits; a non-human
//     act whose apply returns the identical state object and nothing else
//     commits nothing only when lastWhen stays too. A human act always
//     commits, because its journal entry is the result. Refusals and
//     journal replays commit nothing, lastWhen included — but for a replay
//     that finds one of its documents past its lifetime or the horizon:
//     that give-up runs first as an operation of its own on the one commit
//     path (resume's CommitOp, its timer carried to the replay's answer)
//   - outbound of an act starts at attempt 1 with nextAttemptAt =
//     when + ceil(backoff(1)); resume() re-emits only items that are due
//     and pauses re-emission while the last step is awaiting-transport
//     (the adapter holds the item) and never re-emits an accepted one. It
//     gives up every non-terminal item (submitted, held or accepted) at
//     first submission + horizonMs, never by attempt
//     count, or earlier at the sender lifetime its type declared
//     (expiresAt, Delivery 7020); nextDueAt is the earliest due
//     re-emission, horizon or lifetime
//   - the holder's give-up is failed(expired-by-adapter-policy), at a
//     lifetime failed(task-expired) (Delivery 6110); a later
//     delivered report is late by that history, whatever the adapter says
//   - replay of a human act returns the journaled events and the outbound
//     of its documents that are not terminal (delivered, failed) and not
//     due for the give-up, at their current attempt; one due for it is
//     given up in a commit of its own first (6115: never handed out again). Idempotency is bounded by the journal's retention:
//     max(P90D, retry.horizonMs), the key-retention of Delivery §7 that
//     bounds effects and their acks; after it the same actId is a new act
//   - KeyProvider, Log and Access rejections inside a preparation become
//     InfraError('key-provider' | 'log' | 'access') with the cause. Known
//     limitation: a provider's argument errors (a module passing a label
//     outside the registry, say) are wrapped the same way, so a module
//     programming error surfaces as an infrastructure error; the original
//     error stays in `cause`
//   - events are deep-frozen before listeners or callers see them; a
//     listener's throw or rejection is dropped
//   - the next state is validated by the codec before every commit; an
//     invalid state is a programming error and throws
//   - receive (receive.ts) is a built-in like tick: a failed disposition
//     commits nothing, lastWhen included (like a refusal); duplicate-known
//     commits only a raised lastWhen; a CAS conflict re-reads and runs the
//     stages again, which re-checks the effect cache at stage 4
//   - an ack is stored sealed (StoredAck: envelope, digest, recipient) in
//     its effect, so every re-send is byte-identical down to the envelope.
//     It stays `sent: false` until a service takes it (report accepted or
//     delivered: `sentBy: 'accepted'`), the adapter reports it failed
//     (`'failed'`), or its horizon passes (effect commit + horizonMs:
//     `'horizon'`, no event: acks have no trias) — Delivery RLTP-DEL-6330.
//     An awaiting-transport report keeps it unsent and records `held`; a
//     held ack is not re-offered by resume (the adapter has it) and stays
//     in pendingTransport. Unsent and not held, it has the outbox's retry
//     schedule: attempt 1 at the receive, re-offered by resume when due
//     (attempt + 1, backoff), counted into nextDueAt. Sent or not, it stays
//     with its effect until the effect expires (RLTP-DEL-6335). A
//     duplicate's re-send carries attempt + 1 and does not move the
//     schedule; it commits the answer it makes due (6330), else nothing
//     beyond lastWhen
//   - custody (Delivery RLTP-DEL-6120 to 6135): pendingTransport(when) is
//     the set the holder keeps for transport — every outbox item neither
//     terminal nor accepted, held ones included, and every unsent ack —
//     each with its deadline (notAfter: the horizon from the first
//     submission, or the type's sender lifetime if earlier) and without
//     those whose deadline has passed at `when`, whether or not a resume
//     has recorded the give-up yet. It answers only after a resume of this
//     engine has completed (a resume that throws withdraws that again), and
//     its entries are issued to this engine: mayHandOver(entry, when)
//     accepts only an entry this engine issued, re-reads the store and says
//     yes only while the engine is open and the entry is still pending
//     there with the same envelope before its deadline. handOver(entry,
//     when, start) is the same check with the deposit's start inside the
//     queue: nothing of this engine runs between the check and the start.
//     A duplicate makes an answer due, stored with the ack (answers,
//     answerDue: kept across a lock): a `resend` entry numbered by it,
//     beside the ack's retries and independent of their state, deadline the
//     effect's retention; the begun hand-over ends it (a commit), and a
//     duplicate while one is due is answered by it (the same bytes); a resume that throws, its settling
//     included, withdraws the authority until one completes. The check is
//     this engine's: a second engine over the same store commits through
//     CAS but is not serialized with this one's hand-overs, so one opening
//     per store at a time is the app's to keep (its writer lock). close() ends the
//     engine: every later operation rejects with InfraError('closed'),
//     mayHandOver answers false, and no entry issued before authorizes
//     anything. An operation already running when close() is called
//     completes
//   - outbound of one commit, in order: outbox re-emissions, released
//     acks, new documents
//   - resume runs duties after the outbox, ordered by dueAt (absent: due
//     always, counted as 0), then id. An Applied fulfils the duty and the
//     engine removes it in the same commit; 'not-due' and a refusal keep it
//     without a trace. A duty of a registered kind at another version is
//     announced as duty.unsupported on every resume (a commit of its own);
//     a kind no module registers is kept silently. A duty with awaitHead
//     runs only when its handler's awaitHolds says so (none: never). Each
//     planned duty is checked again against the state the duties before it
//     left: still present at the handler's version, due, its awaited head
//     holding; a prepared duty whose data changed since its preparation is
//     deferred to the next resume and prepared afresh there. Its handler's
//     apply re-checks every other state-dependent precondition itself
//     (note §4.2 step 3). nextDueAt comes from the final duty set, the
//     duties created in this resume included: a future dueAt, or `when` for
//     duty work runnable now that did not run; a duty that ran and stayed
//     (not-due, refused) sets no timer while its record is unchanged since
//     that run. A duty whose kind changed since the plan is not run by the
//     planned handler; the next resume dispatches it. New documents of
//     duties count in too. The duties a handler opens are folded into the
//     state before the next handler runs (an id already open is kept), so
//     later handlers' drop rules and dedupe see them; they run on the next
//     resume (the plan is fixed at the snapshot)
//   - every committed operation but resume names the duty work it opened or
//     unblocked as nextDueAt on its result (ActResult, ReceiveResult
//     unique): `when` where a duty that is new, changed, or newly runnable
//     (its awaited head now holding) can run now, else the earliest future
//     dueAt among those; absent where it opened none. It is the app's cue to
//     call resume (or set a timer), as resume's own nextDueAt is. A journal
//     replay of a human act carries none: its duties were announced then
//   - sweeps (Trust 5.4 reconciliation, PR 4b) run in resume after the
//     duties, in registration order, on the state the duties left; their
//     preparations run against resume's snapshot beside the duties'. A
//     piece whose inputs moved since is skipped and makes `when` the
//     nextDueAt, as does sweep work that became pending during the resume
//     itself (a give-up at the horizon, a duty's change) without having
//     been prepared. Their new documents count into nextDueAt like the
//     duties'. Every other committed operation whose state adds a key to
//     a sweep's `pending` names `when` as its nextDueAt; a sweep that
//     declares the state parts it reads (`reads`) is skipped there when the
//     operation left all of them untouched (by reference)
//   - a verified delivery-ack runs the ack handler registered for the
//     acknowledged item's type in its own transaction; a report never does
//   - an outbox item that turns failed (a failed report, or the holder's
//     own give-up at the horizon inside resume) runs the failure handler
//     registered for its type in that same transaction, once, at the
//     transition; duties it opens are folded into the state there (so two
//     failures of one resume cannot open one duty twice) and count into
//     nextDueAt like any new duty. A late delivered after failed runs the
//     ack handler as usual, never the failure handler again
//   - the Encounter latch exception (receive.ts TaskRefusal, Refusal):
//     a refusal carrying `latch` commits exactly that state (checked to
//     shrink encounter.challenges and touch nothing else) and the raised
//     lastWhen, with no journal entry, cache entry, ack, outbound or event;
//     the result stays the refusal (receive: failed at stage 9)
//   - a task handler's refusal commits nothing; its TaskDiscarded (an
//     assembly discarded at a resource limit or rejected, Trust 5365/5366)
//     commits its state and nothing else: disposition `discarded` with the
//     reason, no cache entry, no ack, no event
//   - a transition's `renames` (Applied) are followed in the effect cache by
//     the engine after the transition: each stored ack's recipient.contactId
//     that a rename names moves to its new id; the envelope, sealed to the
//     key agreement, is untouched (an ack re-sent is byte-identical)
//   - a module's ownRetries are task types it re-issues itself: resume
//     never re-emits their outbox items (the horizon still gives them up);
//     its keepKeys name own rkids tick must not tombstone though no live
//     tuple carries them. Both trust the registered modules: no ownership
//     of a type or a key is checked (modules are the library's own, not
//     app plug-ins)
//   - a failure handler gets the retry backoff, so a failure can make work
//     due no earlier than its schedule allows
//   - the timer contract: tick does the time-driven work (expiry,
//     retention, the modules' `retain`), resume the delivery work (retries,
//     due duties, sweeps, acks). nextDueAt names the earliest of both: on
//     resume, the earliest future deadline of the expiry work (prompt
//     expiresAt, effect expiry, the act journal's, a terminal outbox item's
//     and an address key's retention, every module's `deadlines`); on an
//     act or receive, also a deadline the commit newly introduced. The app
//     sets one timer on it and, when it fires, calls tick and then resume
//     (README "The holder")
//   - after its own retention, tick runs every module's `retain` hook on
//     the result (the trust module drops in-flight star deliveries whose
//     outbox items have all been retained away); the address keys' retention
//     comes last, its live set and keepKeys read on what the hooks left, so
//     a key whose last claim (an act's pin, 8290) left in this tick leaves in
//     the same tick and no passed key deadline outlives it
//   - without an Access port, EngineOptions.accessFrom (createHolder: the
//     membership module's localAccess) builds one over each preparation's
//     own snapshot, so it describes exactly the state the commit lands on
//   - EngineOptions.check (createHolder's `invariants: true`) runs on every
//     commit after the codec's validation and before the CAS; its throw
//     aborts the operation, nothing commits
//   - tick retains with the key-retention max(P90D, horizonMs): effects
//     with their acks at expiresAt; terminal outbox items once the
//     retention has passed since their last step, unless a kept journal
//     entry names them; an address key not shown for the retention and
//     the own rkid of no tuple that is not deactivated becomes a tombstone —
//     except a member key (a group/… label): an identity context of
//     Identity §6.1 rather than a delivery address of Delivery §5 (one
//     derivation per group, reused whenever the holder is invited to it
//     again), it leaves `addresses` without a tombstone (a point for
//     Delivery 0.82: addresses and identity contexts)
import { jcs, b64uOf } from './core.js';
import { CODEC, decodeState, encodeState } from './codec.js';
import { emptyState, toOpaque, triasOf } from './state.js';
import { CryptoUnavailableError, InfraError } from './results.js';
import { randomEntropy } from './entropy.js';
import { ED_PKCS8, X_PKCS8 } from './keys-seed.js';
import { freezeDeep } from './util-freeze.js';
import { ACK_TYPE } from './ack.js';
import { challengeAged } from './encounter.js';
import { ackOutbound, handlerPrepared, isTaskRefusal, markDelivered, prepareReceive } from './receive.js';
import { isTaskDiscarded } from './receive.js';
/** The Encounter latch exception (receive.ts TaskRefusal): a latch state
 *  differs from its base in encounter.challenges alone; every challenge it
 *  keeps is byte-identical, and every one it removes is aged at `when`, the
 *  commit's authoritative time (Encounter 5190, 5260). Anything else is a
 *  programming error and throws. */
function checkLatch(base, latch, when) {
    for (const k of Object.keys(base)) {
        if (k === 'encounter')
            continue;
        if (base[k] !== latch[k])
            throw new Error(`engine: an aging latch changed ${k}`);
    }
    const e = base.encounter, l = latch.encounter;
    for (const k of Object.keys(e)) {
        if (k !== 'challenges' && e[k] !== l[k])
            throw new Error(`engine: an aging latch changed encounter.${k}`);
    }
    for (const [v, c] of Object.entries(l.challenges)) {
        if (!Object.hasOwn(e.challenges, v))
            throw new Error('engine: an aging latch added a challenge');
        if (jcs(c) !== jcs(e.challenges[v]))
            throw new Error(`engine: an aging latch changed the challenge ${v}`);
    }
    for (const [v, c] of Object.entries(e.challenges)) {
        if (!Object.hasOwn(l.challenges, v) && !challengeAged(c.tCh, when))
            throw new Error(`engine: an aging latch removed the unaged challenge ${v}`);
    }
}
// ── defaults ───────────────────────────────────────────────────────────
const DAY = 86_400_000;
/** Defaults of the retry policy and the retention it implies. */
export const ENGINE_DEFAULTS = Object.freeze({
    /** 30 s, doubling, at most 6 h */
    backoff: (attempt) => Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 6 * 3_600_000),
    /** P7D, inside Delivery's give-up range [P1D, P90D]; the only give-up */
    horizonMs: 7 * DAY,
    commitAttempts: 8,
    /** max(P90D, horizonMs) with the default horizon */
    retentionMs: 90 * DAY,
});
/** Delivery's give-up range for horizonMs: [P1D, P90D]. */
const HORIZON_MIN = DAY;
const HORIZON_MAX = 90 * DAY;
const BUILTIN = ['tick', 'resume', 'report', 'receive'];
const TASK_URI = /^[a-z][a-z0-9+.-]*:\S+\/[0-9]+\.[0-9]+$/;
// ── helpers ────────────────────────────────────────────────────────────
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
/** Drops undefined object members (as JSON does) without hiding what jcs refuses. */
const dropUndefined = (x) => {
    if (x === null || typeof x !== 'object')
        return x;
    if (Object.getOwnPropertySymbols(x).length > 0)
        return x;
    if (Array.isArray(x)) {
        if (Object.getOwnPropertyNames(x).length !== x.length + 1)
            return x;
        for (let i = 0; i < x.length; i++)
            if (!(i in x))
                return x;
        return x.map(dropUndefined);
    }
    const proto = Object.getPrototypeOf(x);
    if (proto !== null && proto !== Object.prototype)
        return x;
    if (Object.getOwnPropertyNames(x).length !== Object.keys(x).length)
        return x;
    // own data properties, never assignment: a "__proto__" key stays a key
    // (assignment would hit the inherited setter and change the prototype)
    const out = {};
    for (const [k, v] of Object.entries(x)) {
        if (v !== undefined)
            Object.defineProperty(out, k, { value: dropUndefined(v), enumerable: true, writable: true, configurable: true });
    }
    return out;
};
/** The act input as bound at the call: canonical JSON, deep-frozen. A
 *  "__proto__" member is an ordinary key throughout: jcs serializes own
 *  keys (Object.keys) and JSON.parse defines own data properties, so it is
 *  hashed, journaled and handed to prepare/apply like any other key. */
const bindInput = (x) => freezeDeep(JSON.parse(jcs(x === undefined ? null : dropUndefined(x))));
/** when + ceil(delay), clamped to safe integer milliseconds. */
const dueAt = (when, delay) => {
    const d = Number.isNaN(delay) ? 0 : Math.max(0, Math.ceil(delay));
    return Math.min(when + d, Number.MAX_SAFE_INTEGER);
};
/** A port whose rejections become InfraError(code); InfraError passes as is. */
function guard(port, names, code, wrapResult) {
    const out = {};
    for (const n of names) {
        out[n] = async (...args) => {
            let r;
            try {
                r = await port[n].apply(port, args);
            }
            catch (e) {
                throw e instanceof InfraError ? e : new InfraError(code, `${code}: ${n} failed`, { cause: e });
            }
            return wrapResult ? wrapResult(r) : r;
        };
    }
    return Object.freeze(out);
}
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
/** The effect cache with the stored acks' recipients renamed. */
function renameAcks(effects, renames) {
    let out = null;
    for (const [d, e] of Object.entries(effects)) {
        let a = e.ack;
        if (!a)
            continue;
        for (const r of renames) {
            if (r.from.includes(a.recipient.contactId) && (r.rkids === null || r.rkids.includes(a.recipient.via ?? a.recipient.rkid)))
                a = { ...a, recipient: { ...a.recipient, contactId: r.to } };
        }
        if (a !== e.ack)
            (out ??= { ...effects })[d] = { ...e, ack: a };
    }
    return out ?? effects;
}
const closedError = () => new InfraError('closed', 'the holder was closed');
const checkWhen = (when) => {
    if (!Number.isSafeInteger(when) || when < 0)
        throw new TypeError(`when must be non-negative integer milliseconds, got ${String(when)}`);
};
/** A duty's dueAt; absent counts as 0 (due always). */
const dutyDue = (d) => (Number.isSafeInteger(d.dueAt) ? d.dueAt : 0);
/** Due, and not waiting on a head its handler's awaitHolds denies (none: waits forever). */
const dutyRunnable = (d, h, state, when) => {
    if (dutyDue(d) > when)
        return false;
    const awaits = d.awaitHead;
    return typeof awaits !== 'string' || (h.awaitHolds?.(state, d) ?? false);
};
const isHalt = (r) => r?.halt === true;
const actResult = (r) => {
    if (isHalt(r))
        throw new Error('engine: an act does not halt');
    return r.ok ? { ok: true, outbound: r.outbound, events: r.events, ...(r.nextDueAt !== undefined ? { nextDueAt: r.nextDueAt } : {}) } : r;
};
// ── the engine ─────────────────────────────────────────────────────────
class HolderEngine {
    registry;
    #store;
    #ports;
    /** the ports a preparation sees, rejections typed (InfraError) */
    #keys;
    #log;
    #access;
    #crypto;
    #entropy;
    #policy;
    #commands;
    #tasks;
    #duties;
    #sweeps;
    #acks;
    #failures;
    #ownRetries;
    #keepKeys;
    #retain;
    #accepted;
    #deadlines;
    #builtins;
    #check;
    #accessFrom;
    #listeners = new Set();
    #chain = Promise.resolve();
    /** a commit whose outcome is unknown, settled before the next operation */
    #unsettled = null;
    /** close() was called: nothing more runs, nothing issued authorizes */
    #closed = false;
    /** a resume of this engine completed (and none threw since) */
    #resumed = false;
    /** the transport entries this engine issued (RLTP-DEL-6130) */
    #issued = new WeakSet();
    constructor(ports, crypto, modules, opts = {}) {
        if (opts.check !== undefined && typeof opts.check !== 'function')
            throw new TypeError('check must be a function');
        this.#check = opts.check;
        if (opts.accessFrom !== undefined && typeof opts.accessFrom !== 'function')
            throw new TypeError('accessFrom must be a function');
        this.#accessFrom = opts.accessFrom;
        this.#store = ports.store;
        this.#ports = ports;
        this.#crypto = crypto;
        this.#entropy = ports.entropy ?? randomEntropy(crypto);
        const r = ports.retry ?? {};
        const horizonMs = r.horizonMs ?? ENGINE_DEFAULTS.horizonMs;
        const backoff = r.backoff ?? ENGINE_DEFAULTS.backoff;
        const commitAttempts = r.commitAttempts ?? ENGINE_DEFAULTS.commitAttempts;
        if (!Number.isSafeInteger(horizonMs) || horizonMs < HORIZON_MIN || horizonMs > HORIZON_MAX)
            throw new RangeError(`retry.horizonMs must be integer ms within [P1D, P90D], got ${horizonMs}`);
        if (typeof backoff !== 'function')
            throw new RangeError('retry.backoff must be a function');
        for (let n = 1; n <= 3; n++) {
            const d = backoff(n);
            if (typeof d !== 'number' || !Number.isFinite(d) || d < 0)
                throw new RangeError(`retry.backoff(${n}) must be a finite non-negative number, got ${d}`);
        }
        if (!Number.isSafeInteger(commitAttempts) || commitAttempts < 1)
            throw new RangeError('retry.commitAttempts must be a positive integer');
        this.#policy = Object.freeze({ backoff, horizonMs, commitAttempts, retentionMs: Math.max(ENGINE_DEFAULTS.retentionMs, horizonMs) });
        const carrierKey = (k) => Object.freeze({ principal: k.principal, sign: guard(k, ['sign'], 'key-provider').sign });
        const base = guard(ports.keys, ['anchorOf', 'sign', 'agree'], 'key-provider');
        this.#keys = Object.freeze({
            anchorOf: base.anchorOf, sign: base.sign, agree: base.agree,
            carrierPrincipal: guard(ports.keys, ['carrierPrincipal'], 'key-provider', carrierKey).carrierPrincipal,
        });
        if (ports.log)
            this.#log = guard(ports.log, ['head', 'at', 'append'], 'log');
        if (ports.access)
            this.#access = guard(ports.access, ['memberships', 'membership'], 'access');
        const commands = new Map();
        const tasks = new Map();
        const duties = new Map();
        const sweeps = new Map();
        const acks = new Map();
        const failures = new Map();
        const ownRetries = new Set();
        const keepKeys = [];
        const retain = [];
        const accepted = [];
        const deadlines = [];
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
                if (uri === ACK_TYPE)
                    throw new Error(`${uri} is built in: acks take the common path (module ${m.name})`);
                if (tasks.has(uri))
                    throw new Error(`duplicate task ${uri} (module ${m.name})`);
                if (typeof h?.apply !== 'function' || typeof h.decode !== 'function')
                    throw new TypeError(`task ${uri} (module ${m.name}) needs decode and apply`);
                if (h.proof !== 'absent' && h.proof !== 'required')
                    throw new TypeError(`task ${uri} (module ${m.name}) needs its proof declaration: 'absent' or 'required'`);
                if (h.channel !== undefined && typeof h.channel !== 'function')
                    throw new TypeError(`task ${uri} (module ${m.name}): channel must be a function`);
                if (h.pinned !== undefined && (h.pinned !== true || h.channel !== undefined))
                    throw new TypeError(`task ${uri} (module ${m.name}): pinned is true or absent, and only under the tuple binding`);
                tasks.set(uri, Object.freeze({ ...h }));
            }
            for (const [kind, h] of Object.entries(m.duties ?? {})) {
                if (duties.has(kind))
                    throw new Error(`duplicate duty ${kind} (module ${m.name})`);
                if (typeof h?.apply !== 'function')
                    throw new TypeError(`duty ${kind} (module ${m.name}) needs apply`);
                if (!Number.isSafeInteger(h.v) || h.v < 1)
                    throw new TypeError(`duty ${kind} (module ${m.name}) needs its version v, a positive integer`);
                if (h.awaitHolds !== undefined && typeof h.awaitHolds !== 'function')
                    throw new TypeError(`duty ${kind} (module ${m.name}): awaitHolds must be a function`);
                duties.set(kind, Object.freeze({ ...h }));
            }
            for (const [name, h] of Object.entries(m.sweeps ?? {})) {
                if (sweeps.has(name))
                    throw new Error(`duplicate sweep ${name} (module ${m.name})`);
                if (typeof h?.apply !== 'function' || typeof h.prepare !== 'function' || typeof h.pending !== 'function')
                    throw new TypeError(`sweep ${name} (module ${m.name}) needs pending, prepare and apply`);
                sweeps.set(name, Object.freeze({ ...h }));
            }
            for (const [uri, h] of Object.entries(m.acks ?? {})) {
                if (!TASK_URI.test(uri))
                    throw new Error(`not a full task URI with version: ${uri} (module ${m.name})`);
                if (acks.has(uri))
                    throw new Error(`duplicate ack handler ${uri} (module ${m.name})`);
                if (typeof h !== 'function')
                    throw new TypeError(`ack handler ${uri} (module ${m.name}) must be a function`);
                acks.set(uri, h);
            }
            for (const [uri, h] of Object.entries(m.failures ?? {})) {
                if (!TASK_URI.test(uri))
                    throw new Error(`not a full task URI with version: ${uri} (module ${m.name})`);
                if (failures.has(uri))
                    throw new Error(`duplicate failure handler ${uri} (module ${m.name})`);
                if (typeof h !== 'function')
                    throw new TypeError(`failure handler ${uri} (module ${m.name}) must be a function`);
                failures.set(uri, h);
            }
            for (const uri of m.ownRetries ?? []) {
                if (!TASK_URI.test(uri))
                    throw new Error(`not a full task URI with version: ${uri} (module ${m.name})`);
                ownRetries.add(uri);
            }
            if (m.keepKeys !== undefined) {
                if (typeof m.keepKeys !== 'function')
                    throw new TypeError(`keepKeys (module ${m.name}) must be a function`);
                keepKeys.push(m.keepKeys);
            }
            if (m.retain !== undefined) {
                if (typeof m.retain !== 'function')
                    throw new TypeError(`retain (module ${m.name}) must be a function`);
                retain.push(m.retain);
            }
            if (m.deadlines !== undefined) {
                if (typeof m.deadlines !== 'function')
                    throw new TypeError(`deadlines (module ${m.name}) must be a function`);
                deadlines.push(m.deadlines);
            }
            if (m.accepted !== undefined) {
                if (typeof m.accepted !== 'function')
                    throw new TypeError(`accepted (module ${m.name}) must be a function`);
                accepted.push(m.accepted);
            }
        }
        this.#commands = commands;
        this.#tasks = tasks;
        this.#duties = duties;
        this.#sweeps = sweeps;
        this.#acks = acks;
        this.#failures = failures;
        this.#ownRetries = ownRetries;
        this.#keepKeys = Object.freeze(keepKeys);
        this.#deadlines = Object.freeze(deadlines);
        this.#retain = Object.freeze(retain);
        this.#accepted = Object.freeze(accepted);
        this.#builtins = Object.freeze({ tick: this.#tickDef(), resume: this.#resumeDef(), report: this.#reportDef(), receive: this.#receiveDef() });
        this.registry = Object.freeze({
            commands: Object.freeze([...commands.keys()]),
            tasks: Object.freeze([...tasks.keys()]),
            duties: Object.freeze([...duties.keys()]),
            sweeps: Object.freeze([...sweeps.keys()]),
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
            if ((await this.#store.commit(null, toOpaque(emptyState(CODEC)))).ok)
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
        if (this.#closed)
            return Promise.reject(closedError());
        const p = this.#chain.then(async () => {
            if (this.#closed)
                throw closedError();
            await this.#settle();
            return fn();
        });
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
            // a listener's failure (throw or rejection) neither undoes nor blocks the commit
            try {
                const r = l({ commitSeq, events });
                if (r !== null && typeof r === 'object' && typeof r.then === 'function')
                    r.then(undefined, () => undefined);
            }
            catch { /* dropped */ }
        }
    }
    // ── the four steps ───────────────────────────────────────────────────
    /** `input` is already bound (bindInput); `inputHash` its journal hash for human acts. */
    async #run(def, op, input, when, actId, inputHash) {
        /** a replay's give-up work (below): its timer, carried to the replay's answer */
        let replayWake;
        /** give-ups a replay ran: each moves at least one of its finitely many
         *  journaled documents to failed, so they are bounded by that number */
        let gaveUp = 0;
        for (let attempt = 1; attempt <= this.#policy.commitAttempts; attempt++) {
            // 1 — snapshot, when
            const { state, version } = await this.#read();
            const at = Math.max(when, state.lastWhen);
            if (def.human && Object.hasOwn(state.acts, actId)) {
                const rec = state.acts[actId];
                if (rec.inputHash !== inputHash)
                    return { ok: false, code: 'actid-conflict' };
                const events = structuredClone(rec.events);
                // the act's documents are handed out again only while live; one past
                // its sender lifetime or the horizon is given up first, in an
                // operation of its own on the engine's one commit path (as resume's
                // give-up: Delivery 6110, 6115), and is never handed out — the
                // journal's events are not announced again
                const live = [];
                const expired = [];
                for (const d of rec.outboundDigests) {
                    const it = this.#itemOf(state, d);
                    const t = triasOf(it);
                    if (t === 'delivered' || t === 'failed')
                        continue;
                    if (this.#giveUp(it, at))
                        expired.push(d);
                    else
                        live.push(d);
                }
                if (expired.length) {
                    const g = await this.#run(this.#giveUpDef(), { kind: 'resume' }, expired, at);
                    if (!isHalt(g) && g.ok && g.nextDueAt !== undefined)
                        replayWake = replayWake === undefined ? g.nextDueAt : Math.min(replayWake, g.nextDueAt);
                    // re-read: the act's documents as the give-up left them, outside
                    // the CAS budget (no conflict happened); bounded by the act's documents
                    if (gaveUp++ <= rec.outboundDigests.length)
                        attempt--;
                    continue;
                }
                return { ok: true, outbound: live.map((d) => this.#outboundOf(state, d)), events: freezeDeep(events), ...(replayWake !== undefined ? { nextDueAt: replayWake } : {}) };
            }
            // 2 — prepare, bound to this snapshot
            const ctx = Object.freeze({
                snapshot: state, keys: this.#keys, entropy: this.#entropy, access: this.#access ?? this.#accessFrom?.(state), log: this.#log,
                crypto: this.#crypto, when: at, release: releaseOf(state),
            });
            const value = def.prepare ? await def.prepare(ctx, input) : undefined;
            const prepared = Object.freeze({ value, version, commitSeq: state.commitSeq });
            // 3 — apply, assemble, CAS
            const r = def.apply(state, prepared, input, at);
            if (isHalt(r))
                return r;
            if (isRefusal(r)) {
                const refusal = { ok: false, code: r.code, ...(r.ref !== undefined ? { ref: r.ref } : {}) };
                if (!r.latch)
                    return refusal;
                // the Encounter latch exception: the latch and lastWhen commit, nothing else
                checkLatch(state, r.latch, at);
                const seq = inc(state.commitSeq);
                const next = { ...r.latch, commitSeq: seq, lastWhen: at };
                const text = encodeState(next);
                if (this.#check)
                    this.#check(state, next, op.kind === 'act' ? { ...op, events: [] } : op);
                let res;
                try {
                    res = await this.#store.commit(version, toOpaque(next));
                }
                catch (e) {
                    this.#unsettled = { text, commitSeq: seq, events: [] };
                    throw new InfraError('unknown-commit-outcome', undefined, { cause: e });
                }
                if (!res.ok)
                    continue;
                this.#announce(seq, []);
                return refusal;
            }
            const drafts = r.outbound ?? [];
            const eventDrafts = r.events ?? [];
            const newDuties = r.duties ?? [];
            const emit = r.emit ?? [];
            const release = r.release ?? [];
            // resume computes its own timer; every other operation names the duty
            // work it opened or unblocked, the app's cue to call resume
            const wake = r.nextDueAt ?? (def === this.#builtins.resume ? undefined : this.#wake(state, r.state, newDuties, at));
            const extra = { ...(wake !== undefined ? { nextDueAt: wake } : {}), ...(r.detail !== undefined ? { detail: r.detail } : {}) };
            if (!def.human && r.state === state && !r.renames?.length && at === state.lastWhen && !drafts.length && !eventDrafts.length && !newDuties.length && !emit.length) {
                return { ok: true, outbound: [...release], events: [], ...extra };
            }
            const seq = inc(state.commitSeq);
            const events = eventDrafts.map((e, i) => ({ ...e, eventId: `${seq}.${i}`, commitSeq: seq, ...(def.human ? { actId } : {}) }));
            freezeDeep(events);
            const outbound = drafts.map((o) => ({ digest: o.digest, envelope: o.envelope, type: o.type, threadId: o.threadId, recipient: o.recipient, attempt: 1 }));
            const outbox = { ...r.state.outbox };
            for (const [i, o] of outbound.entries()) {
                if (Object.hasOwn(outbox, o.digest))
                    throw new Error(`engine: outbound ${o.digest} is already in the outbox`);
                const life = drafts[i].expiresAt;
                if (life !== undefined && (!Number.isSafeInteger(life) || life <= at))
                    throw new Error(`engine: outbound ${o.digest} expires at ${life}, not after ${at}`);
                outbox[o.digest] = {
                    type: o.type, threadId: o.threadId, recipient: o.recipient, envelope: o.envelope, attempt: 1,
                    history: [{ status: 'submitted', at, attempt: 1 }], nextAttemptAt: dueAt(at, this.#policy.backoff(1)),
                    ...(life !== undefined ? { expiresAt: life } : {}),
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
            const effects = r.renames?.length ? renameAcks(r.state.effects, r.renames) : r.state.effects;
            const next = { ...r.state, effects, commitSeq: seq, lastWhen: at, outbox, duties, acts };
            const text = encodeState(next); // validates; an invalid next state is a programming error
            if (this.#check) {
                const d = (r.detail ?? {});
                const pick = (k) => (d[k] !== undefined ? { [k]: d[k] } : {});
                this.#check(state, next, op.kind === 'receive' ? { kind: 'receive', ...pick('disposition'), ...pick('digest'), ...pick('type'), ...pick('ref'), ...pick('rkid') }
                    : op.kind === 'resume' ? { kind: 'resume', fulfilled: d.fulfilled ?? [] }
                        : op.kind === 'act' ? { ...op, events } : op);
            }
            let res;
            try {
                res = await this.#store.commit(version, toOpaque(next));
            }
            catch (e) {
                this.#unsettled = { text, commitSeq: seq, events, ...(def.human ? { actId } : {}) };
                throw new InfraError('unknown-commit-outcome', undefined, { cause: e });
            }
            if (!res.ok)
                continue;
            // 4 — release
            this.#announce(seq, events);
            return { ok: true, outbound: [...emit, ...release, ...outbound], events, ...extra };
        }
        throw new InfraError('commit-conflict', `no commit after ${this.#policy.commitAttempts} attempts`);
    }
    /** The work an operation opened or unblocked: its duty work (#dutyWake),
     *  or `when` where a sweep's pending keys gained one. */
    /** Every time at which tick's expiry and retention change `state`: the
     *  engine's own and the modules' `deadlines` (the timer contract). */
    #expiries(state) {
        const retention = this.#policy.retentionMs;
        const out = [];
        for (const p of Object.values(state.prompts))
            if (p.expiresAt !== undefined)
                out.push(p.expiresAt);
        for (const e of Object.values(state.effects))
            out.push(e.expiresAt);
        for (const a of Object.values(state.acts))
            out.push(a.at + retention);
        for (const it of Object.values(state.outbox)) {
            const t = triasOf(it);
            if ((t === 'delivered' || t === 'failed') && it.history.length)
                out.push(it.history[it.history.length - 1].at + retention);
        }
        for (const k of Object.values(state.addresses.keys))
            out.push(k.lastShown + retention);
        for (const f of this.#deadlines)
            for (const t of f(state))
                out.push(t);
        return out.filter((t) => Number.isSafeInteger(t));
    }
    /** The earliest expiry deadline after `when`, among those `only` admits. */
    #nextExpiry(state, when, only = () => true) {
        let next;
        for (const t of this.#expiries(state))
            if (t > when && only(t) && (next === undefined || t < next))
                next = t;
        return next;
    }
    #wake(before, after, added, when) {
        const d0 = this.#dutyWake(before, after, added, when);
        // a deadline the commit introduced (a prompt opened, an act started, …)
        const had = before === after ? null : new Set(this.#expiries(before));
        const x = had === null ? undefined : this.#nextExpiry(after, when, (t) => !had.has(t));
        const d = d0 === undefined ? x : x === undefined ? d0 : Math.min(d0, x);
        if (d === when || before === after)
            return d;
        for (const sw of this.#sweeps.values()) {
            // a sweep whose declared inputs are untouched (by reference) cannot have new pending keys
            if (sw.reads && sw.reads.every((k) => before[k] === after[k]))
                continue;
            const had = new Set(sw.pending(before, when));
            if (sw.pending(after, when).some((k) => !had.has(k)))
                return when;
        }
        return d;
    }
    /** The duty work an operation opened or unblocked: over the duties that
     *  are new, changed, or runnable now but not before, `when` where one
     *  is runnable now, else the earliest future dueAt; undefined where none. */
    #dutyWake(before, after, added, when) {
        let wake;
        for (const d of [...Object.values(after.duties), ...added]) {
            const h = this.#duties.get(d.kind);
            if (!h || d.v !== h.v)
                continue;
            const prev = Object.hasOwn(before.duties, d.id) ? before.duties[d.id] : undefined;
            const runnable = dutyRunnable(d, h, after, when);
            if (prev !== undefined && jcs(prev) === jcs(d) && (!runnable || dutyRunnable(prev, h, before, when)))
                continue;
            const t = runnable ? when : dutyDue(d) > when ? dutyDue(d) : undefined;
            if (t !== undefined)
                wake = wake === undefined ? t : Math.min(wake, t);
        }
        return wake;
    }
    /** The failure handlers of the items `digests` (each just turned
     *  failed), in order, on `state`; their duties folded into the state. */
    #failed(state, digests, when) {
        let cur = state;
        const events = [];
        for (const digest of digests) {
            const h = this.#failures.get(cur.outbox[digest].type);
            if (!h)
                continue;
            const r = h(cur, digest, when, { backoff: this.#policy.backoff });
            if (r.state.effects !== cur.effects)
                throw new Error(`engine: the failure handler of ${cur.outbox[digest].type} wrote the effect cache`);
            if (r.outbound?.length)
                throw new Error(`engine: the failure handler of ${cur.outbox[digest].type} issued documents; it opens duties`);
            cur = r.state;
            events.push(...(r.events ?? []));
            if (r.duties?.length) {
                const duties = { ...cur.duties };
                for (const d of r.duties)
                    if (!Object.hasOwn(duties, d.id))
                        duties[d.id] = d;
                cur = { ...cur, duties };
            }
        }
        return { state: cur, events };
    }
    /** The give-up of the outbox items named (a replay found them due, see
     *  #run): as resume's, the failed step, the status event, the failure
     *  handlers in the same transaction; items no longer due are left alone. */
    #giveUpDef() {
        const giveUp = (it, when) => this.#giveUp(it, when);
        const failed = (st, digests, when) => this.#failed(st, digests, when);
        return {
            human: false,
            apply(state, _p, digests, when) {
                const outbox = { ...state.outbox };
                const events = [];
                const gave = [];
                for (const d of digests) {
                    const it = state.outbox[d];
                    const t = triasOf(it);
                    if (t === 'delivered' || t === 'failed')
                        continue;
                    const why = giveUp(it, when);
                    if (!why)
                        continue;
                    const { nextAttemptAt: _, ...rest } = it;
                    outbox[d] = { ...rest, history: [...rest.history, { status: 'failed', at: when, reason: why }] };
                    events.push({ type: 'delivery.status', digest: d, threadId: it.threadId, status: 'failed' });
                    gave.push(d);
                }
                if (!gave.length)
                    return { state: state };
                const f = failed({ ...state, outbox }, gave, when);
                return { state: f.state, events: [...events, ...f.events] };
            },
        };
    }
    /** Why a non-terminal outbox item is given up at `when`, or null: its
     *  sender lifetime, where it ends no later than the horizon
     *  (failed(task-expired), Delivery 6110), else the horizon
     *  (failed(expired-by-adapter-policy)). */
    #giveUp(it, when) {
        const first = it.history.length ? it.history[0].at : when;
        const expiry = Math.min(first + this.#policy.horizonMs, Number.MAX_SAFE_INTEGER);
        const life = it.expiresAt;
        if (life !== undefined && when >= life && life <= expiry)
            return 'task-expired';
        return when >= expiry ? 'expired-by-adapter-policy' : null;
    }
    #itemOf(state, digest) {
        if (!Object.hasOwn(state.outbox, digest))
            throw new Error(`engine: journaled outbound ${digest} is missing from the outbox`);
        return state.outbox[digest];
    }
    #outboundOf(state, digest) {
        const it = this.#itemOf(state, digest);
        return structuredClone({ digest, envelope: it.envelope, type: it.type, threadId: it.threadId, recipient: it.recipient, attempt: it.attempt });
    }
    // ── built-ins ────────────────────────────────────────────────────────
    #tickDef() {
        const policy = () => this.#policy;
        const retainers = () => this.#retain;
        const keepers = () => this.#keepKeys;
        return {
            human: false,
            apply(state, _p, _input, when) {
                const retention = policy().retentionMs;
                let dropped = false;
                const keep = (rec, live) => {
                    const out = {};
                    for (const [k, v] of Object.entries(rec)) {
                        if (live(v, k))
                            out[k] = v;
                        else
                            dropped = true;
                    }
                    return out;
                };
                // effects leave with their acks (Delivery 4.2); prompts at expiry; the
                // act journal after the retention
                const effects = keep(state.effects, (x) => x.expiresAt > when);
                const prompts = keep(state.prompts, (x) => x.expiresAt === undefined || x.expiresAt > when);
                const acts = keep(state.acts, (x) => x.at + retention > when);
                // terminal outbox items, the retention after their last step, unless a
                // kept journal entry still answers with them (replay needs the item)
                const journaled = new Set(Object.values(acts).flatMap((a) => a.outboundDigests));
                const outbox = keep(state.outbox, (it, digest) => {
                    const t = triasOf(it);
                    if (t !== 'delivered' && t !== 'failed')
                        return true;
                    const last = it.history.length ? it.history[it.history.length - 1].at : 0;
                    return last + retention > when || journaled.has(digest);
                });
                let next = dropped ? { ...state, effects, prompts, acts, outbox } : state;
                // the modules' own retention, on what the engine's left
                for (const r of retainers()) {
                    const after = r(next, when);
                    if (after.effects !== next.effects)
                        throw new Error('engine: a module\'s retain wrote the effect cache');
                    next = after;
                }
                // addresses (Delivery §5), on what the retention left, so a key whose
                // last claim left in this tick leaves with it: a key not shown for the
                // retention, and the own rkid of no live tuple, becomes a tombstone —
                // its id alone, kept forever; tombstones never shrink
                const held = next;
                const live = new Set();
                for (const r of Object.values(held.relationships))
                    for (const t of r.tuples)
                        if (!t.deactivated)
                            live.add(t.rkid);
                // and the rkids a module still needs (a deactivated prior whose continuity flow is open)
                // (at this tick's time: a claim that ends now ends in this tick)
                for (const k of keepers())
                    for (const rkid of k(held, when))
                        live.add(rkid);
                const tombstones = [...held.addresses.tombstones];
                let gone = false;
                const keys = {};
                for (const [rkid, k] of Object.entries(held.addresses.keys)) {
                    if (k.lastShown + retention > when || live.has(rkid)) {
                        keys[rkid] = k;
                        continue;
                    }
                    gone = true;
                    // a member key (group/…) is an identity context, not a delivery
                    // address of Delivery §5: it leaves without a tombstone, so the same
                    // derivation can serve the same group again (a re-invitation)
                    if (!k.label.startsWith('group/') && !tombstones.includes(rkid))
                        tombstones.push(rkid);
                }
                if (gone)
                    next = { ...held, addresses: { keys, tombstones } };
                return { state: next }; // unchanged: the engine still commits a raised lastWhen
            },
        };
    }
    /** The duties a resume plans to run, in fixed order (dueAt, then id),
     *  and the registered kinds met at an unknown version. Each planned
     *  duty is checked again against the current state right before its
     *  handler runs (#resumeDef). */
    #dutyPlan(state, when) {
        const order = Object.values(state.duties).sort((a, b) => (dutyDue(a) - dutyDue(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const run = [];
        const unsupported = [];
        for (const duty of order) {
            const h = this.#duties.get(duty.kind);
            if (!h)
                continue; // a kind no module here registers: kept, silent
            if (duty.v !== h.v) {
                unsupported.push(duty);
                continue;
            }
            if (dutyRunnable(duty, h, state, when))
                run.push({ duty, h });
        }
        return { run, unsupported };
    }
    #resumeDef() {
        const expiryAfter = (st, w) => this.#nextExpiry(st, w);
        const policy = () => this.#policy;
        const plan = (state, when) => this.#dutyPlan(state, when);
        const handlers = () => this.#duties;
        const sweeps = () => this.#sweeps;
        const failed = (st, digests, when) => this.#failed(st, digests, when);
        const ownRetries = () => this.#ownRetries;
        const giveUp = (it, when) => this.#giveUp(it, when);
        return {
            human: false,
            // the due duties' and the sweeps' preparations, against the snapshot apply will see
            async prepare(ctx) {
                const values = {};
                for (const { duty, h } of plan(ctx.snapshot, ctx.when).run)
                    if (h.prepare)
                        values[duty.id] = await h.prepare(ctx, duty);
                const swept = {};
                for (const [name, sw] of sweeps())
                    swept[name] = await sw.prepare(ctx);
                return { duties: values, sweeps: swept };
            },
            apply(state, prepared, _input, when) {
                const p = policy();
                const outbox = { ...state.outbox };
                const emit = [];
                const events = [];
                const gaveUp = [];
                let nextDueAt;
                const due = (t) => { nextDueAt = nextDueAt === undefined ? t : Math.min(nextDueAt, t); };
                // 1 — the outbox, by due time, then digest
                const order = Object.keys(state.outbox).sort((a, b) => ((state.outbox[a].nextAttemptAt ?? 0) - (state.outbox[b].nextAttemptAt ?? 0)) || (a < b ? -1 : a > b ? 1 : 0));
                for (const digest of order) {
                    const it = state.outbox[digest];
                    const trias = triasOf(it);
                    if (trias === 'delivered' || trias === 'failed')
                        continue;
                    // the horizon applies to every non-terminal item: held, accepted or
                    // not; a sender lifetime the type declares ends it earlier, as
                    // failed(task-expired), never handed out again (Delivery 6110, 6115)
                    const why = giveUp(it, when);
                    if (why) {
                        const { nextAttemptAt: _, ...rest } = it;
                        outbox[digest] = { ...rest, history: [...it.history, { status: 'failed', at: when, reason: why }] };
                        events.push({ type: 'delivery.status', digest, threadId: it.threadId, status: 'failed' });
                        gaveUp.push(digest);
                        continue;
                    }
                    const first = it.history.length ? it.history[0].at : when;
                    const expiry = Math.min(first + p.horizonMs, Number.MAX_SAFE_INTEGER);
                    due(it.expiresAt !== undefined ? Math.min(it.expiresAt, expiry) : expiry);
                    // never re-emitted: an accepted item (the service has it) and one the
                    // adapter holds (awaiting-transport, until it reports again)
                    if (trias === 'accepted' || it.history[it.history.length - 1]?.status === 'awaiting-transport')
                        continue;
                    // a type its module re-issues itself is never reproduced (Trust 6710)
                    if (ownRetries().has(it.type))
                        continue;
                    if (it.nextAttemptAt !== undefined && it.nextAttemptAt > when) {
                        due(it.nextAttemptAt);
                        continue;
                    }
                    const attempt = it.attempt + 1;
                    const nextAttemptAt = dueAt(when, p.backoff(attempt));
                    outbox[digest] = { ...it, attempt, nextAttemptAt, history: [...it.history, { status: 'submitted', at: when, attempt }] };
                    emit.push(structuredClone({ digest, envelope: it.envelope, type: it.type, threadId: it.threadId, recipient: it.recipient, attempt }));
                    due(nextAttemptAt);
                }
                // 2 — duties, in the plan's order, each on the state the one before
                // left and checked against it right before its handler: still there
                // at the handler's version, due, its awaited head still holding. A
                // prepared duty whose data changed since its preparation is deferred
                // to the next resume, which prepares it afresh (due at once)
                const { run, unsupported } = plan(state, when);
                for (const d of unsupported)
                    events.push({ type: 'duty.unsupported', dutyId: d.id, kind: d.kind, v: d.v });
                // the outbox changed only by a re-emission or a give-up (an event so far)
                let cur = !emit.length && !events.length ? state : { ...state, outbox };
                // the failure handlers of the items given up, in the give-up's transaction
                if (gaveUp.length) {
                    const f = failed(cur, gaveUp, when);
                    cur = f.state;
                    events.push(...f.events);
                }
                const drafts = [];
                const renames = [];
                // the duties whose handler returned Applied (invariants.ts: fulfilment)
                const fulfilled = [];
                // ran and stayed (not-due, refused): id → its record as it ran
                const kept = new Map();
                const { duties: values, sweeps: swept } = prepared.value;
                for (const { duty, h } of run) {
                    if (!Object.hasOwn(cur.duties, duty.id))
                        continue; // fulfilled or dropped meanwhile
                    const now = cur.duties[duty.id];
                    // another kind or version since the plan: the next resume dispatches it
                    if (now.kind !== duty.kind || now.id !== duty.id || now.v !== h.v || !dutyRunnable(now, h, cur, when))
                        continue; // the final pass sets its timer
                    if (h.prepare && jcs(now) !== jcs(duty))
                        continue; // prepared on other data
                    const r = h.apply(cur, now, Object.freeze({ prepared: Object.freeze({ value: values[duty.id], version: prepared.version, commitSeq: prepared.commitSeq }), backoff: p.backoff }), when);
                    if (r === 'not-due' || isRefusal(r)) {
                        kept.set(duty.id, jcs(now));
                        continue;
                    }
                    // fulfilled: the duty leaves; what its handler opened is folded into
                    // the state at once (an id already open is kept), so the duties
                    // after it see it — their drop rules and their dedupe included
                    const left = { ...r.state.duties };
                    delete left[duty.id];
                    for (const d of r.duties ?? [])
                        if (!Object.hasOwn(left, d.id))
                            left[d.id] = d;
                    cur = { ...r.state, duties: left };
                    fulfilled.push(duty.id);
                    drafts.push(...(r.outbound ?? []));
                    events.push(...(r.events ?? []));
                    renames.push(...(r.renames ?? []));
                }
                // 2b — the sweeps, on the state the duties left; a prepared piece
                // whose inputs moved is skipped and due again at once
                for (const [name, sw] of sweeps()) {
                    const r = sw.apply(cur, Object.freeze({ value: swept[name], version: prepared.version, commitSeq: prepared.commitSeq }), when);
                    if (r.state.effects !== cur.effects)
                        throw new Error(`engine: the sweep ${name} wrote the effect cache`);
                    cur = r.state;
                    if (r.duties?.length) {
                        const all = { ...cur.duties };
                        for (const d of r.duties)
                            if (!Object.hasOwn(all, d.id))
                                all[d.id] = d;
                        cur = { ...cur, duties: all };
                    }
                    drafts.push(...(r.outbound ?? []));
                    events.push(...(r.events ?? []));
                    if (r.deferred)
                        due(when);
                }
                // work a sweep owes now but did not prepare: a divergence the outbox
                // step (a give-up at the horizon) or a duty of this resume created —
                // due at once, prepared by the next resume
                if (cur !== state) {
                    for (const sw of sweeps().values()) {
                        const had = new Set(sw.pending(state, when));
                        if (sw.pending(cur, when).some((k) => !had.has(k))) {
                            due(when);
                            break;
                        }
                    }
                }
                // the timer from the final duty set, new duties included: a future
                // dueAt, or `when` for work runnable now that did not run (deferred,
                // newly created, newly unblocked); a duty that ran and stayed
                // (not-due, refused) sets none while its record is unchanged since
                // its run — changed by a later duty, it counts like any other
                for (const d of Object.values(cur.duties)) {
                    const h = handlers().get(d.kind);
                    if (!h || d.v !== h.v || kept.get(d.id) === jcs(d))
                        continue;
                    if (dutyDue(d) > when)
                        due(dutyDue(d));
                    else if (dutyRunnable(d, h, cur, when))
                        due(when);
                }
                // the duties' new documents enter the outbox in #run, due at backoff(1)
                if (drafts.length)
                    due(dueAt(when, p.backoff(1)));
                // 3 — acks still unsent (a restart between the receive commit and the
                // send, or no report yet): re-offered byte-identical on the retry
                // policy, by effect digest; at the horizon marked sent by it
                const release = [];
                let effects = null;
                for (const d of Object.keys(cur.effects).sort()) {
                    const a = cur.effects[d].ack;
                    if (!a || a.sent)
                        continue;
                    const expiry = Math.min(a.at + p.horizonMs, Number.MAX_SAFE_INTEGER);
                    effects ??= { ...cur.effects };
                    if (when >= expiry) {
                        const { nextAttemptAt: _, held: _h, ...rest } = a;
                        effects[d] = { ...cur.effects[d], ack: { ...rest, sent: true, sentBy: 'horizon' } };
                        continue;
                    }
                    due(expiry);
                    // held: the adapter has it (awaiting-transport); pendingTransport offers it
                    if (a.held !== undefined)
                        continue;
                    if (a.nextAttemptAt !== undefined && a.nextAttemptAt > when) {
                        due(a.nextAttemptAt);
                        continue;
                    }
                    const attempt = a.attempt + 1;
                    const nextAttemptAt = dueAt(when, p.backoff(attempt));
                    effects[d] = { ...cur.effects[d], ack: { ...a, attempt, nextAttemptAt } };
                    release.push(ackOutbound(a, attempt));
                    due(nextAttemptAt);
                }
                if (effects && jcs(effects) !== jcs(cur.effects))
                    cur = { ...cur, effects };
                // the expiry work tick does (the timer contract, the header)
                const ex = expiryAfter(cur, when);
                if (ex !== undefined)
                    due(ex);
                return {
                    state: cur, emit, events, outbound: drafts, release, detail: { fulfilled },
                    ...(renames.length ? { renames } : {}),
                    ...(nextDueAt !== undefined ? { nextDueAt } : {}),
                };
            },
        };
    }
    /** an answer's hand-over began: it is no longer due (handOver) */
    #answeredDef() {
        return {
            human: false,
            apply(state, _p, input) {
                const eff = Object.keys(state.effects).find((d) => state.effects[d].ack?.digest === input.digest);
                if (eff === undefined)
                    return { state: state };
                const a = state.effects[eff].ack;
                if (a.answerDue !== true || a.answers !== input.n)
                    return { state: state };
                const { answerDue: _d, ...rest } = a;
                return { state: { ...state, effects: { ...state.effects, [eff]: { ...state.effects[eff], ack: rest } } } };
            },
        };
    }
    #reportDef() {
        const failed = (st, digests, when) => this.#failed(st, digests, when);
        return {
            human: false,
            apply(state, _p, report, when) {
                if (!Object.hasOwn(state.outbox, report.digest)) {
                    // an ack (outbox-less, no trias; Delivery RLTP-DEL-6330): sent once
                    // a service took it or the adapter gave it up; awaiting-transport
                    // records that the adapter holds it and ends nothing
                    const eff = Object.keys(state.effects).find((d) => state.effects[d].ack?.digest === report.digest);
                    if (eff === undefined)
                        return { ok: false, code: 'unknown-digest' };
                    const e = state.effects[eff];
                    const a = e.ack;
                    if (a.sent)
                        return { state: state };
                    const { nextAttemptAt: _, held: _h, ...rest } = a;
                    let ack;
                    switch (report.status) {
                        case 'awaiting-transport':
                            if (a.held === report.reason)
                                return { state: state };
                            ack = { ...rest, held: report.reason };
                            break;
                        case 'accepted':
                        case 'delivered':
                            ack = { ...rest, sent: true, sentBy: 'accepted' };
                            break;
                        case 'failed':
                            ack = { ...rest, sent: true, sentBy: 'failed' };
                            break;
                        default:
                            throw new TypeError(`unknown report status ${String(report.status)}`);
                    }
                    return { state: { ...state, effects: { ...state.effects, [eff]: { ...e, ack } } } };
                }
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
                    case 'delivered': {
                        // lateness is the holder's own history: delivered after failed
                        // (its own give-up or the adapter's) is late, whatever the flag says
                        const m = markDelivered(state, report.digest, when);
                        return m.event ? { state: { ...state, outbox: m.outbox }, events: [m.event] } : same;
                    }
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
                    }];
                if (step.status === 'failed') {
                    const f = failed({ ...state, outbox }, [report.digest], when);
                    return { state: f.state, events: [...events, ...f.events] };
                }
                return { state: { ...state, outbox }, events };
            },
        };
    }
    #receiveDef() {
        const tasks = () => this.#tasks;
        const acks = () => this.#acks;
        const acceptedHooks = () => this.#accepted;
        const policy = () => this.#policy;
        return {
            human: false,
            prepare: (ctx, env) => prepareReceive(ctx, env, tasks()),
            apply(state, prepared, _env, when) {
                const plan = prepared.value;
                const cached = (ack) => ({ ack, expiresAt: Math.min(when + policy().retentionMs, Number.MAX_SAFE_INTEGER) });
                switch (plan.kind) {
                    case 'failed': return { halt: true, detail: plan.result };
                    case 'duplicate': {
                        // the stored ack, byte-identical; a terminal document has none
                        // (its outbound attempt is one past the schedule's, which it does not move)
                        // and an answer due (Delivery RLTP-DEL-6330): a hand-over of its
                        // own, kept across a lock until it begins; while one is due, a
                        // further duplicate is answered by it (the same bytes)
                        const a = state.effects[plan.digest].ack;
                        const next = a && a.answerDue === undefined
                            ? { ...state, effects: { ...state.effects, [plan.digest]: { ...state.effects[plan.digest], ack: { ...a, answers: (a.answers ?? 0) + 1, answerDue: true } } } }
                            : state;
                        return { state: next, release: a ? [ackOutbound(a, a.attempt + 1)] : [], detail: { disposition: 'duplicate-known', digest: plan.digest } };
                    }
                    case 'ack': {
                        // terminal: the sender-status update and its cache entry, no ack;
                        // the issuing module's ack handler runs in the same transaction
                        const m = markDelivered(state, plan.ref, when);
                        let next = { ...state, outbox: m.outbox };
                        const events = m.event ? [m.event] : [];
                        const h = acks().get(state.outbox[plan.ref].type);
                        if (h) {
                            const r = h(next, plan.ref, when);
                            if (r.state.effects !== next.effects)
                                throw new Error(`engine: the ack handler of ${state.outbox[plan.ref].type} wrote the effect cache`);
                            next = r.state;
                            events.push(...(r.events ?? []));
                        }
                        // a verified ack is an accepted document of its issuer too: the
                        // modules' accepted hooks, in the same transaction
                        for (const hook of acceptedHooks()) {
                            next = hook(next, plan.doc, plan.arrival);
                            if (next.effects !== state.effects)
                                throw new Error('engine: an accepted hook wrote the effect cache');
                        }
                        return {
                            state: { ...next, effects: { ...next.effects, [plan.digest]: cached(null) } },
                            events,
                            detail: { disposition: 'unique', digest: plan.digest, type: ACK_TYPE, ref: plan.ref },
                        };
                    }
                    case 'task': {
                        const h = tasks().get(plan.type);
                        const r = h.apply(state, handlerPrepared(prepared, plan.value), plan.doc, plan.arrival);
                        if (isTaskRefusal(r)) {
                            const failedDetail = { disposition: 'failed', reason: r.reason, stage: 9, digest: plan.digest, ...(r.ref !== undefined ? { ref: r.ref } : {}) };
                            if (!r.latch)
                                return { halt: true, detail: failedDetail };
                            // the Encounter latch exception (receive.ts): only the latch commits
                            checkLatch(state, r.latch, when);
                            return { state: r.latch, detail: failedDetail };
                        }
                        if (isTaskDiscarded(r)) {
                            // a resource-limit discard: its state commits; no cache entry, no ack
                            if (r.state.effects !== state.effects)
                                throw new Error(`engine: the handler of ${plan.type} wrote the effect cache`);
                            return { state: r.state, detail: { disposition: 'discarded', digest: plan.digest, type: plan.type, reason: r.reason, ...(r.ref !== undefined ? { ref: r.ref } : {}) } };
                        }
                        if (r.state.effects !== state.effects)
                            throw new Error(`engine: the handler of ${plan.type} wrote the effect cache; the core writes it`);
                        // the modules' accepted hooks, in the same transaction
                        let after = r.state;
                        for (const hook of acceptedHooks()) {
                            after = hook(after, plan.doc, plan.arrival);
                            if (after.effects !== state.effects)
                                throw new Error('engine: an accepted hook wrote the effect cache');
                        }
                        return {
                            state: { ...after, effects: { ...state.effects, [plan.digest]: cached({ ...plan.ack, at: when, attempt: 1, nextAttemptAt: dueAt(when, policy().backoff(1)), sent: false }) } },
                            ...(r.outbound ? { outbound: r.outbound } : {}),
                            ...(r.events ? { events: r.events } : {}),
                            ...(r.duties ? { duties: r.duties } : {}),
                            ...(r.renames ? { renames: r.renames } : {}),
                            release: [ackOutbound(plan.ack, 1)],
                            detail: { disposition: 'unique', digest: plan.digest, type: plan.type, rkid: plan.arrival.rkid },
                        };
                    }
                }
            },
        };
    }
    // ── public surface ───────────────────────────────────────────────────
    act(command, input, when, opts = {}) {
        let def;
        let bound;
        let hash;
        let actId;
        try {
            def = this.#commands.get(command);
            if (!def)
                throw new Error(BUILTIN.includes(command) ? `${command} is built in: call engine.${command}()` : `unknown command ${command}`);
            checkWhen(when);
            actId = def.human ? opts.actId : undefined;
            if (def.human && (typeof actId !== 'string' || actId === ''))
                return Promise.resolve({ ok: false, code: 'actid-missing' });
            // bound here, synchronously: later changes by the caller reach nothing
            bound = bindInput(input);
            if (def.human) {
                hash = digestOf(this.#crypto.subtle, { command, input: bound });
                hash.catch(() => undefined); // awaited in the queue; no unhandled rejection meanwhile
            }
        }
        catch (e) {
            return Promise.reject(e);
        }
        const d = def;
        return this.#enqueue(async () => {
            return actResult(await this.#run(d, { kind: 'act', command }, bound, when, actId, hash === undefined ? undefined : await hash));
        });
    }
    tick(when) {
        try {
            checkWhen(when);
        }
        catch (e) {
            return Promise.reject(e);
        }
        return this.#enqueue(async () => {
            return actResult(await this.#run(this.#builtins.tick, { kind: 'tick' }, null, when));
        });
    }
    resume(when) {
        try {
            checkWhen(when);
        }
        catch (e) {
            return Promise.reject(e);
        }
        // fail closed: a resume that throws anywhere — the settling of an
        // earlier commit included — leaves nothing to go out until one completes
        return this.#enqueue(async () => {
            this.#resumed = false;
            const r = await this.#run(this.#builtins.resume, { kind: 'resume' }, null, when);
            if (isHalt(r) || !r.ok)
                throw new Error('engine: resume does not refuse');
            this.#resumed = true;
            return { outbound: r.outbound, events: r.events, ...(r.nextDueAt !== undefined ? { nextDueAt: r.nextDueAt } : {}) };
        }).catch((e) => { this.#resumed = false; throw e; });
    }
    report(report, when) {
        let bound;
        try {
            checkWhen(when);
            bound = bindInput(report);
        }
        catch (e) {
            return Promise.reject(e);
        }
        return this.#enqueue(async () => {
            return actResult(await this.#run(this.#builtins.report, { kind: 'report', status: bound.status }, bound, when));
        });
    }
    receive(env, when) {
        try {
            checkWhen(when);
        }
        catch (e) {
            return Promise.reject(e);
        }
        // bound at the call like any input; what is not JSON is no envelope
        let bound;
        try {
            bound = bindInput(env);
        }
        catch {
            bound = null;
        }
        return this.#enqueue(async () => {
            const r = await this.#run(this.#builtins.receive, { kind: 'receive' }, bound, when);
            if (isHalt(r))
                return r.detail;
            if (!r.ok)
                throw new Error('engine: receive does not refuse');
            if (r.detail?.disposition === 'failed')
                return r.detail; // a latch committed
            const d = r.detail;
            if (d.disposition === 'discarded')
                return { disposition: 'discarded', digest: d.digest, type: d.type, reason: d.reason, ...(d.ref !== undefined ? { ref: d.ref } : {}) };
            return d.disposition === 'unique'
                ? { disposition: 'unique', digest: d.digest, type: d.type, outbound: r.outbound, events: r.events, ...(r.nextDueAt !== undefined ? { nextDueAt: r.nextDueAt } : {}) }
                : { disposition: 'duplicate-known', digest: d.digest, outbound: r.outbound };
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
    pendingTransport(when) {
        try {
            checkWhen(when);
        }
        catch (e) {
            return Promise.reject(e);
        }
        return this.#enqueue(async () => {
            if (!this.#resumed)
                return Object.freeze({ ok: false, code: 'not-resumed' });
            const { state } = await this.#read();
            // the holder's time never runs back: an earlier `when` reads at lastWhen
            const at = Math.max(when, state.lastWhen);
            const entries = transportEntries(state, at, this.#policy.horizonMs).map((e) => {
                const f = freezeDeep(e);
                this.#issued.add(f);
                return f;
            });
            return Object.freeze({ ok: true, commitSeq: state.commitSeq, at, entries: Object.freeze(entries) });
        });
    }
    mayHandOver(entry, when) {
        try {
            checkWhen(when);
        }
        catch (e) {
            return Promise.reject(e);
        }
        if (this.#closed || entry === null || typeof entry !== 'object' || !this.#issued.has(entry))
            return Promise.resolve(false);
        return this.#enqueue(() => this.#mayGo(entry, when)).catch((e) => {
            if (e instanceof InfraError && e.code === 'closed')
                return false;
            throw e;
        });
    }
    handOver(entry, when, start) {
        try {
            checkWhen(when);
        }
        catch (e) {
            return Promise.reject(e);
        }
        if (typeof start !== 'function')
            return Promise.reject(new TypeError('handOver needs a start function'));
        if (this.#closed || entry === null || typeof entry !== 'object' || !this.#issued.has(entry))
            return Promise.resolve(false);
        return this.#enqueue(async () => {
            if (!this.#resumed)
                return false;
            const { state } = await this.#read();
            // no await from here to start(): close() and every other operation
            // of this engine come before the check or after the start
            if (!this.#passes(state, entry, when))
                return false;
            if (start() !== true)
                return false;
            // an answer's hand-over has begun: it is no longer due (a later
            // duplicate grants the next); a commit that fails leaves it due, and
            // it may go out once more — the receiver absorbs it
            if (entry.resend !== undefined) {
                try {
                    await this.#run(this.#answeredDef(), { kind: 'report', status: 'answered' }, { digest: entry.digest, n: entry.resend }, Math.max(when, state.lastWhen));
                }
                catch { /* stays due */ }
            }
            return true;
        }).catch((e) => {
            if (e instanceof InfraError && e.code === 'closed')
                return false;
            throw e;
        });
    }
    /** the gate's check, inside the queue: open, resumed, still pending in
     *  the store as issued, before its deadline */
    async #mayGo(entry, when) {
        if (!this.#resumed)
            return false;
        const { state } = await this.#read();
        return this.#passes(state, entry, when);
    }
    /** synchronous: open, resumed, the entry pending in `state` as issued,
     *  before its deadline at max(when, lastWhen) */
    #passes(state, entry, when) {
        if (this.#closed || !this.#resumed)
            return false;
        const now = transportEntryOf(state, entry.kind, entry.digest, Math.max(when, state.lastWhen), this.#policy.horizonMs, entry.resend);
        return now !== null && now.resend === entry.resend && jcs(now.envelope) === jcs(entry.envelope);
    }
    close() {
        this.#closed = true;
        return this.#chain.then(() => undefined, () => undefined);
    }
    get closed() { return this.#closed; }
}
/** The send deadline of an outbox item: the horizon from its first
 *  submission, or the sender lifetime its type declared if that is
 *  earlier (#giveUp's two bounds as one instant). */
const notAfterOf = (it, horizonMs) => {
    if (!it.history.length)
        return null;
    const expiry = Math.min(it.history[0].at + horizonMs, Number.MAX_SAFE_INTEGER);
    return it.expiresAt !== undefined ? Math.min(it.expiresAt, expiry) : expiry;
};
/** The transport entry of one pending document or ack at `when`, or null:
 *  terminal, accepted, sent, past its deadline, or absent (RLTP-DEL-6135:
 *  absent means stop). */
function transportEntryOf(state, kind, digest, when, horizonMs, resend) {
    if (kind === 'document') {
        if (!Object.hasOwn(state.outbox, digest))
            return null;
        const it = state.outbox[digest];
        const trias = triasOf(it);
        if (trias !== 'submitted')
            return null;
        const notAfter = notAfterOf(it, horizonMs);
        if (notAfter === null || when >= notAfter)
            return null;
        const last = it.history[it.history.length - 1];
        return structuredClone({
            digest, kind, envelope: it.envelope, type: it.type, threadId: it.threadId, recipient: it.recipient, attempt: it.attempt, since: it.history[0].at, notAfter,
            ...(last.status === 'awaiting-transport' ? { held: last.reason } : it.nextAttemptAt !== undefined ? { nextAttemptAt: it.nextAttemptAt } : {}),
        });
    }
    for (const d of Object.keys(state.effects)) {
        const a = state.effects[d].ack;
        if (a === null || a.digest !== digest)
            continue;
        if (resend !== undefined) {
            // a duplicate's answer: its own hand-over, apart from the retries and
            // whatever state they are in, while due and the effect keeps the ack (6335)
            if (a.answerDue !== true || a.answers !== resend || when >= state.effects[d].expiresAt)
                return null;
            return structuredClone({
                digest, kind, envelope: a.envelope, type: ACK_TYPE, threadId: a.threadId, recipient: a.recipient, attempt: a.attempt, since: a.at,
                notAfter: state.effects[d].expiresAt, resend,
            });
        }
        const notAfter = Math.min(a.at + horizonMs, Number.MAX_SAFE_INTEGER);
        if (a.sent || when >= notAfter)
            return null;
        return structuredClone({
            digest, kind, envelope: a.envelope, type: ACK_TYPE, threadId: a.threadId, recipient: a.recipient, attempt: a.attempt, since: a.at, notAfter,
            ...(a.held !== undefined ? { held: a.held } : a.nextAttemptAt !== undefined ? { nextAttemptAt: a.nextAttemptAt } : {}),
        });
    }
    return null;
}
/** Everything the holder keeps for transport at `when`: the outbox items
 *  by due time, then digest, then the unsent acks by effect digest. */
function transportEntries(state, when, horizonMs) {
    const out = [];
    const order = Object.keys(state.outbox).sort((a, b) => ((state.outbox[a].nextAttemptAt ?? 0) - (state.outbox[b].nextAttemptAt ?? 0)) || (a < b ? -1 : a > b ? 1 : 0));
    for (const d of order) {
        const e = transportEntryOf(state, 'document', d, when, horizonMs);
        if (e)
            out.push(e);
    }
    for (const d of Object.keys(state.effects).sort()) {
        const a = state.effects[d].ack;
        if (a === null)
            continue;
        const e = transportEntryOf(state, 'ack', a.digest, when, horizonMs);
        if (e)
            out.push(e);
    }
    // the duplicates' answers due, each its own entry beside the retries
    for (const d of Object.keys(state.effects).sort()) {
        const a = state.effects[d].ack;
        if (a === null || a.answerDue !== true)
            continue;
        const e = transportEntryOf(state, 'ack', a.digest, when, horizonMs, a.answers);
        if (e)
            out.push(e);
    }
    return out;
}
/**
 * Build an engine over the ports and modules: resolves and probes
 * WebCrypto, freezes the registries (duplicate command names, task URIs
 * or duty kinds throw), and initialises an empty store with the empty
 * state at the current codec.
 */
export async function createEngine(ports, modules, opts = {}) {
    if (!ports?.store || !ports.keys)
        throw new TypeError('createEngine needs a store and keys');
    const crypto = await resolveCrypto(ports.crypto);
    const engine = new HolderEngine(ports, crypto, modules, opts);
    await engine.load();
    return engine;
}
