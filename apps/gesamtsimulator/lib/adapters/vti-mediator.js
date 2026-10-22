// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// RLTP transport adapter: VTI mediator — published as
// @real-life/trust-protocol/adapters/vti-mediator (lib Stage 2, note §4.6).
//
// It takes the holder's documents from the holder's custody (Delivery 0.83
// RLTP-DEL-6120 to 6135, lib 0.6.0): reconcile(view, gate, now) files every
// entry of holder.pendingTransport(when) not yet filed, and withdraws every
// filed submission still before the trias whose digest the view no longer
// names — a missing entry means stop, never keep sending. Before every
// deposit it asks gate.mayHandOver(entry, now) (the holder): false
// withdraws the submission, an error skips the attempt. It keeps no
// custody of its own: its copies are volatile and bound to the holder's
// opening: bound to the holder of its first reconcile, it refuses another,
// so after holder.close() nothing it holds goes out, and the next opening
// gets a new adapter (restored from ackState like any other). Its give-up horizon counts
// from the entry's first submission (`since`), never from when it took the
// entry over (RLTP-DEL-6130). Its reports reach the holder as the ports'
// DeliveryReport: report(id) maps the adapter's SubmissionState onto
// DeliveryReport (deliveryReportOf), keyed by the document digest, which
// the app hands to holder.report(). An adapter's `delivered` is its claim
// about transport; the holder's receive core verifies the delivery-ack
// itself.
//
// Profile: spec/adapter-vti-mediator.md v0.24 (twenty-fourth casting;
// round journals under design/adapter-review*). A
// transport adapter contract — NOT a carrier at the port.
//
// Sending form (profile §3a, lib 0.7.0): every deposit names its mode to
// the wire. Mode `routed` (the mode of every instance from construction):
// an inner TSP `direct` message egress identity → counterpart's
// connection DID inside an outer routed message connection DID → C with
// the route [counterpart's connection DID], on the connection DID's
// session. Mode `egress-session` (fallback): the inner message alone, on
// a send-only session of the egress identity. The wire packs the layers
// (depositAddressing says who addresses whom); the adapter keeps the
// relationship's send state (mode, first routed acceptance of a
// document, the routed digests not yet answered, proof) in its ack
// state and switches one way to `egress-session` when `routed` stays
// unproven for routed-ack-deadline, checked in an advance after a
// conclusion that left nothing pending and while nothing is pending
// again (RLTP-VTI-3130); "nothing pending" needs the wire's queueEmpty()
// to say true — a wire without it never lets the adapter switch. A
// document is an entry of kind `document`, or a submit() without an
// entry (the holder's acknowledgements go through reconcile). An attempt
// ends in the mode it began in; an accepted submission is never
// deposited again (RLTP-VTI-3135, 7130).
//
// The app's transport contract (web-of-trust TRANSPORT.md, rules 5 and
// 6), as far as it holds here: (5) a withdrawal — reconcile without the
// entry — means the adapter starts no deposit for that submission
// afterwards, and an outcome that resolves late changes nothing here
// (has() false, report() null, no send state). A wire call already
// running cannot be recalled and may still land at the mediator (the §6
// boundary); the copy that then arrives is a duplicate the receiver
// absorbs (Delivery §6.2). (6) Every deposit is a submission with an id
// of its own, a duplicate's answer (`resend`) included; the
// DeliveryReport handed to the holder carries the digest, and the app
// pairs it with its deposit through the submission id it polls.
//
// Beyond the profile (lib 0.5.0): conclude(collection, now, {keep}) leaves
// the items whose disposition is transient unconcluded and offers them
// again (Delivery 0.82 RLTP-DEL-5810, 5820: failed(rate-limited) is never
// concluded); `concludable(result)` says which receive outcomes are
// terminal. The profile's §4 concludes a collection whole; its next
// casting is to take this up.
//
// Structural rules (reviews 3+4):
//   · No port operation ever awaits the mediator — including
//     register: keylist synchronization is a recorded intent with a
//     tracked background task, retried by advance.
//   · No report is invented, and absence is ABSENT: before the first
//     honest report exists, status() returns null (§6.1 grants the
//     window; representing it as a queryable fourth value was
//     review-4 B2). has() distinguishes an unknown id.
//   · A retired instance mutates nothing and refuses everything
//     except reading its ack state.
import { jcs } from '../core.js';
import { sha } from '../crypto.js';
import { carrierPrincipal, carrierScopedIdentity } from '../carrier-identity.js';
// ── Declared constants (profile §2) — promises of THIS casting ──────
// frozen: the declared promises cannot be changed at run time either
export const DECLARED = Object.freeze({
    giveUpHorizonMs: 72 * 3_600_000,
    statusHorizonMs: 60_000,
    queueFloorCount: 64,
    queueFloorBytes: 1_048_576,
    maxQueueBytes: 16_777_216,
    duplicateWindowMs: 30 * 86_400_000,
    routedAckDeadlineMs: 24 * 3_600_000,
});
const SEND_MODES = new Set(['routed', 'egress-session']);
/** The addressing of a deposit in `mode` (RLTP-VTI-1110, 1120, 3110,
 *  3115, 3120): the inner `direct` message from this side's egress
 *  identity to the counterpart's connection DID; in mode `routed` an
 *  outer routed message from this side's connection DID to the carrier
 *  `C` with the route [counterpart's connection DID], deposited on the
 *  connection DID's session; in mode `egress-session` no outer layer,
 *  deposited on the egress identity's send-only session. */
export function depositAddressing(mode, self, peerConnection, carrier) {
    if (!SEND_MODES.has(mode))
        throw new Error(`unknown send mode ${String(mode)}`);
    const inner = { messageType: 'direct', sender: self.egress, receiver: peerConnection };
    if (mode === 'routed') {
        return {
            inner,
            outer: { messageType: 'routed', sender: self.connection, receiver: carrier, route: [peerConnection] },
            session: self.connection,
        };
    }
    return { inner, outer: null, session: self.egress };
}
export class WireError extends Error {
    kind;
    constructor(kind, message) {
        super(message ?? kind);
        this.kind = kind;
    }
}
// ── Sender states (§6.1 — the closed sets, nothing else) ────────────
// ReceiverRefusalCode is the ports' (one closed set, one place)
const RECEIVER_REFUSAL_CODES = new Set([
    'malformedRequest', 'unsupportedType', 'proofRequired',
    'proofInvalid', 'wrongRecipient', 'identityMismatch',
]);
/** The ports' DeliveryReport for a document `digest` in adapter state `st`
 *  (Delivery §6.1): one-to-one, `late` and the refusal code carried over. */
export function deliveryReportOf(digest, st) {
    switch (st.state) {
        case 'awaiting-transport': return { digest, status: 'awaiting-transport', reason: st.reason };
        case 'accepted': return { digest, status: 'accepted' };
        case 'delivered': return { digest, status: 'delivered', late: st.late };
        case 'failed': return st.reason === 'rejected-by-receiver'
            ? { digest, status: 'failed', reason: 'rejected-by-receiver', code: st.code }
            : { digest, status: 'failed', reason: st.reason };
    }
}
/** Whether a receive outcome is terminal and its item may be concluded
 *  (Delivery 5a.8): every disposition but `failed(rate-limited)`, the one
 *  failure that is transient (RLTP-DEL-5820). An InfraError of the
 *  holder's store is transient as well (RLTP-DEL-5810): an item whose
 *  receive threw is kept, too. */
export function concludable(r) {
    return !(r.disposition === 'failed' && r.reason === 'rate-limited');
}
/** The adapter's own copy of a wire's token set: the wire keeps no handle on it. */
const tokenCopy = (t) => ({ accessToken: t.accessToken, accessExpiresAt: t.accessExpiresAt, refreshToken: t.refreshToken, refreshExpiresAt: t.refreshExpiresAt });
const finite = (x) => typeof x === 'number' && Number.isFinite(x);
/** A restored send state, checked fail-closed (§4): a known mode,
 *  well-formed entries, every instant finite and none after restoredAt. */
function restoreSendState(send, restoredAt) {
    const refuse = (why) => { throw new Error(`ack snapshot: send state ${why}`); };
    if (typeof send !== 'object' || send === null)
        return refuse('is not an object');
    const s = send;
    if (typeof s.mode !== 'string' || !SEND_MODES.has(s.mode))
        refuse('names an unknown mode');
    const first = s.firstRoutedAcceptedAt;
    if (first !== null && (!finite(first) || first > restoredAt))
        refuse('first routed acceptance is non-finite or after restoredAt');
    if (typeof s.proven !== 'boolean')
        refuse('proof is not a boolean');
    if (!Array.isArray(s.routed))
        refuse('routed digests are not a list');
    const routed = s.routed.map((r) => {
        const e = r;
        if (typeof e !== 'object' || e === null || typeof e.digest !== 'string' ||
            !finite(e.acceptedAt) || !finite(e.horizonAt) || e.acceptedAt > restoredAt) {
            return refuse('routed entry is malformed, non-finite or accepted after restoredAt');
        }
        if (e.horizonAt < e.acceptedAt || e.horizonAt > e.acceptedAt + DECLARED.giveUpHorizonMs) {
            return refuse('routed entry: horizon outside [acceptedAt, acceptedAt + give-up horizon]');
        }
        return { digest: e.digest, acceptedAt: e.acceptedAt, horizonAt: e.horizonAt };
    });
    if (new Set(routed.map((r) => r.digest)).size !== routed.length)
        refuse('names a routed digest twice');
    if (routed.length > 0 && (first === null || first > Math.min(...routed.map((r) => r.acceptedAt)))) {
        refuse('routed digests without a first routed acceptance at or before them');
    }
    return { mode: s.mode, firstRoutedAcceptedAt: first, routed, proven: s.proven };
}
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
// construction capability: only create() holds it
const KEY = Symbol('MediatorCarrierAdapter.create');
// ── The adapter ──────────────────────────────────────────────────────
export class MediatorCarrierAdapter {
    // JS-hard identity fields: TS `readonly` is a compile-time promise
    // only, and §8 claims runtime unforgeability — so the values live
    // in true privates behind getters (R8-B1)
    #principal;
    #connectionDid;
    #egressDid;
    get principal() { return this.#principal; }
    get connectionDid() { return this.#connectionDid; }
    get egressDid() { return this.#egressDid; }
    #wire;
    #tokens = null;
    #clock = Number.NEGATIVE_INFINITY;
    #closed = false;
    /** the opening this adapter serves, bound at its first reconcile */
    #gate = null;
    #subs = new Map();
    #inflight = new Set();
    #nextId = 1;
    #desiredRkids = null;
    #keylistSynced = false;
    #keylistSyncing = false;
    #inbox = [];
    #inboxBytes = 0;
    #inboxDigests = new Set();
    #outstanding = new Map();
    #outstandingBytes = 0;
    #concluded = new Map();
    #pendingAcks = new Set();
    #flightAcks = new Set(); // ids inside the in-flight flush snapshot
    #flushing = false;
    #nextColId = 1;
    #transitions = [];
    // the relationship's send state (RLTP-VTI-3130)
    #mode = 'routed';
    #firstRoutedAcceptedAt = null;
    #routed = new Map();
    #proven = false;
    /** this instance has concluded a collection that left nothing pending */
    #cleanConcluded = false;
    /** The only way to build an adapter: the trio is DERIVED here from
     *  one root, one carrier, one nonce — so principal, connection DID
     *  and egress identity cannot come from different relationships
     *  (R7-B2: the coupling is enforced by construction, not by
     *  inspecting caller-supplied identities). */
    static async create(rootIkm, carrier, nonce, wire, restored, restoredAt) {
        // ONE tuple, snapshotted at entry: a caller mutating its buffers
        // between the three awaited derivations must not be able to mix
        // identities from two tuples (R8-B2)
        const ikm = new Uint8Array(rootIkm);
        const n = new Uint8Array(nonce);
        const principal = await carrierPrincipal(ikm, carrier, n);
        const connection = await carrierScopedIdentity(ikm, carrier, n, 'connection');
        const egress = await carrierScopedIdentity(ikm, carrier, n, 'egress');
        return new MediatorCarrierAdapter(KEY, principal, connection, egress, wire, restored, restoredAt);
    }
    constructor(key, principal, connection, egress, wire, restored, restoredAt) {
        if (key !== KEY) {
            throw new Error('use MediatorCarrierAdapter.create — the identity trio must be derived, not supplied (5a.10)');
        }
        if (connection.scope !== 'connection' || egress.scope !== 'egress') {
            throw new Error('scoped identities passed in the wrong roles');
        }
        const three = new Set([principal.principal, connection.did, egress.did]);
        if (three.size !== 3) {
            throw new Error('principal, connection DID and egress identity must be pairwise distinct (5a.10)');
        }
        this.#principal = principal.principal;
        this.#connectionDid = connection.did;
        this.#egressDid = egress.did;
        this.#wire = wire;
        if (restored) {
            // The restore instant anchors the duplicate-window: an expired,
            // debt-free entry is dropped HERE, not at the first advance —
            // otherwise a redelivery arriving before any port call would be
            // absorbed beyond the declared window (review-4 B4).
            if (typeof restoredAt !== 'number' || !Number.isFinite(restoredAt)) {
                throw new Error('restoring ack state requires a finite restoredAt instant');
            }
            this.#now(restoredAt);
            const pending = new Set(restored.pending);
            const known = new Set(restored.concluded.map((c) => c.queueId));
            for (const id of pending) {
                if (!known.has(id)) {
                    throw new Error('ack snapshot violates its invariant: pending intent without a concluded entry');
                }
            }
            for (const { queueId, concludedAt } of restored.concluded) {
                if (!Number.isFinite(concludedAt) || concludedAt > restoredAt) {
                    // a conclusion "from the future" would stretch the window
                    // past its declared span (R5-B4) — fail closed
                    throw new Error('ack snapshot: conclusion instant is non-finite or after restoredAt');
                }
                // the window beats everything (round-14 B): an expired entry
                // falls at the restore instant, owed or not — a phantom debt
                // from an ack that landed just before a close can never
                // outlive the window and delete a fresh copy (R14-B2)
                if (restoredAt - concludedAt >= DECLARED.duplicateWindowMs)
                    continue;
                this.#concluded.set(queueId, concludedAt);
                if (pending.has(queueId))
                    this.#pendingAcks.add(queueId);
            }
            // absent: a host that persisted none starts again in routed
            if (restored.send !== undefined) {
                const send = restoreSendState(restored.send, restoredAt);
                this.#mode = send.mode;
                this.#firstRoutedAcceptedAt = send.firstRoutedAcceptedAt;
                for (const r of send.routed)
                    this.#routed.set(r.digest, { acceptedAt: r.acceptedAt, horizonAt: r.horizonAt });
                this.#proven = send.proven;
            }
        }
        this.#wire.onDeliver(async (raw) => {
            if (this.#closed)
                return;
            // a plain copy of its own: a Node Buffer's slice() would share memory
            const bytes = new Uint8Array(raw);
            const queueId = hex(await sha(bytes));
            if (this.#closed)
                return;
            // Absorption is WINDOW-checked at the moment it happens
            // (R11-B1), and the window beats everything (round-14 B):
            // beyond it, entry AND any leftover intent fall, and the frame
            // is a new item — so no acknowledgement, owed or phantom, can
            // ever delete the only fresh copy.
            const concludedAt = this.#concluded.get(queueId);
            if (concludedAt !== undefined) {
                if (this.#flightAcks.has(queueId) ||
                    this.#clock - concludedAt < DECLARED.duplicateWindowMs) {
                    // inside the window — or deferred: an id inside an
                    // in-flight flush keeps absorbing until that flush ends,
                    // because its irrecallable ack may still land (R15-B1)
                    this.#pendingAcks.add(queueId);
                    return;
                }
                this.#concluded.delete(queueId);
                this.#pendingAcks.delete(queueId);
            }
            if (this.#inboxDigests.has(queueId))
                return;
            for (const col of this.#outstanding.values())
                if (col.has(queueId))
                    return;
            const held = this.#inboxBytes + this.#outstandingBytes;
            const underFloor = this.#inbox.length < DECLARED.queueFloorCount &&
                held + bytes.length <= DECLARED.queueFloorBytes;
            const underCap = held + bytes.length <= DECLARED.maxQueueBytes;
            if (!underFloor && !underCap)
                return;
            this.#inbox.push({ bytes, queueId });
            this.#inboxBytes += bytes.length;
            this.#inboxDigests.add(queueId);
        });
    }
    #now(raw) {
        if (!Number.isFinite(raw))
            throw new Error('non-finite time');
        if (raw > this.#clock)
            this.#clock = raw;
        return this.#clock;
    }
    #open() { if (this.#closed)
        throw new Error('retired (5a.10 lifecycle)'); }
    #track(p) {
        const t = p.catch(() => { });
        this.#inflight.add(t);
        void t.finally(() => this.#inflight.delete(t));
    }
    // ── auth: silent carrier policy ─────────────────────────────────
    // Single-flight: concurrent callers share one handshake — the ATM
    // challenge/response is a session, and two interleaved sessions
    // under one connection DID would answer each other's challenges.
    #authing = null;
    #ensureAuth(now) {
        if (this.#tokens && now < this.#tokens.accessExpiresAt)
            return Promise.resolve(this.#tokens.accessToken);
        if (this.#authing)
            return this.#authing;
        const run = (async () => {
            if (this.#tokens && now < this.#tokens.refreshExpiresAt) {
                try {
                    const refreshed = await this.#wire.refresh(this.#tokens.refreshToken);
                    if (this.#closed)
                        throw new Error('retired'); // as on the handshake path (R6-B1)
                    this.#tokens = tokenCopy(refreshed);
                    return this.#tokens.accessToken;
                }
                catch (e) {
                    if (this.#closed)
                        throw e;
                    // a transient failure (mediator unreachable, retriable refusal)
                    // says nothing about the token: keep it for the next attempt (#9)
                    if (e instanceof WireError && (e.kind === 'unreachable' || e.kind === 'refused-retriable'))
                        throw e;
                    // a refused refresh (revoked before its expiry) is never replayed:
                    // drop the tokens and take the challenge handshake below
                    this.#tokens = null;
                }
            }
            const { challenge, sessionId } = await this.#wire.authChallenge(this.#connectionDid);
            if (this.#closed)
                throw new Error('retired'); // nothing new starts, not even the answer (R6-B1)
            this.#tokens = tokenCopy(await this.#wire.authenticate({ did: this.#connectionDid, challenge, sessionId }));
            return this.#tokens.accessToken;
        })();
        this.#authing = run.finally(() => { this.#authing = null; });
        return this.#authing;
    }
    // ── transport registration (profile §3 — NOT §5a.3) ─────────────
    /** Records the desired keylist and returns; synchronization runs
     *  as a tracked background task and advance retries it until it
     *  lands (review-4 B1). */
    register(rkids, rawNow) {
        this.#open();
        const now = this.#now(rawNow);
        this.#desiredRkids = [...rkids];
        this.#keylistSynced = false;
        this.#startKeylistSync(now);
    }
    get keylistSynced() {
        this.#open();
        return this.#keylistSynced;
    }
    #startKeylistSync(now) {
        if (this.#keylistSyncing || this.#keylistSynced || this.#desiredRkids === null)
            return;
        this.#keylistSyncing = true;
        const wanted = [...this.#desiredRkids];
        this.#track((async () => {
            try {
                const token = await this.#ensureAuth(now);
                if (this.#closed)
                    return;
                await this.#wire.keylistUpdate(token, [...wanted]); // the wire's own list: `wanted` is compared below
                // land only if the desire has not moved meanwhile
                if (!this.#closed && this.#desiredRkids !== null &&
                    wanted.join(' ') === this.#desiredRkids.join(' ')) {
                    this.#keylistSynced = true;
                }
            }
            catch {
                // intent survives; advance retries
            }
            finally {
                this.#keylistSyncing = false;
            }
        })());
    }
    // ── sender side ─────────────────────────────────────────────────
    /** Returns the submission id synchronously. Before the first
     *  honest report exists, status() returns null — §6.1's own
     *  pre-report window, represented as absence, not as a value. */
    submit(envelopeBytes, rawNow) {
        this.#open();
        const now = this.#now(rawNow);
        const id = 's' + this.#nextId++;
        const knownOffline = this.#wire.offline?.() === true;
        const sub = {
            id,
            // a plain copy of its own (a Node Buffer's slice() shares memory)
            bytes: new Uint8Array(envelopeBytes),
            submittedAt: now,
            attemptStartedAt: null,
            lastKind: null,
            st: null,
            sentMode: null,
        };
        this.#subs.set(id, sub);
        if (!knownOffline)
            this.#startAttempt(sub, now);
        return id;
    }
    /** Takes the holder's custody set (holder.pendingTransport, after a
     *  resume of this opening) and the holder as the gate: files every entry
     *  not yet filed under its digest (its envelope as JCS bytes; the give-up
     *  horizon from entry.since) and returns their SubmissionRefs; withdraws
     *  every filed submission still before the trias (no report, or
     *  awaiting-transport) whose digest the view does not name. Accepted and
     *  terminal submissions stay for their reports. */
    reconcile(view, gate, rawNow) {
        this.#open();
        if (view?.ok !== true || !Array.isArray(view.entries))
            throw new Error('reconcile needs a view of holder.pendingTransport');
        if (typeof gate?.handOver !== 'function')
            throw new Error('reconcile needs the holder as its gate');
        // one adapter per opening: its copies and the holder's grants belong to
        // that opening, and the next opening gets an adapter of its own
        if (this.#gate === null)
            this.#gate = gate;
        else if (this.#gate !== gate)
            throw new Error('one adapter per opening: this adapter reconciles with another holder (create a new adapter for the next opening)');
        const now = this.#now(rawNow);
        // a submission's key: the digest, and for a duplicate's answer its
        // grant too — the retries and each answer are hand-overs of their own
        const keyOf = (digest, resend) => resend === undefined ? digest : `${digest}#${resend}`;
        const named = new Set(view.entries.map((e) => keyOf(e.digest, e.resend)));
        const filed = new Map();
        for (const [id, sub] of this.#subs) {
            if (sub.digest === undefined)
                continue;
            const key = keyOf(sub.digest, sub.entry?.resend);
            const before = sub.st === null || sub.st.state === 'awaiting-transport';
            if (before && !named.has(key)) {
                this.#subs.delete(id);
                continue;
            }
            filed.set(key, sub);
        }
        const refs = [];
        for (const entry of view.entries) {
            const had = filed.get(keyOf(entry.digest, entry.resend));
            if (had !== undefined) {
                // the newest entry of a live submission is the one its gate checks
                if (had.st === null || had.st.state === 'awaiting-transport') {
                    had.entry = entry;
                    had.gate = gate;
                    continue;
                }
                // an answer the holder still offers is still owed — its hand-over
                // never began, or the holder could not record that it did: a
                // terminal submission of it is filed again (the holder ends it)
                if (entry.resend === undefined)
                    continue;
                this.#subs.delete(had.id);
            }
            const id = 's' + this.#nextId++;
            const sub = {
                id, digest: entry.digest, entry, gate,
                bytes: new TextEncoder().encode(jcs(entry.envelope)),
                // a duplicate's ack is a hand-over of its own, from now
                submittedAt: entry.resend !== undefined ? now : Math.min(entry.since, now),
                attemptStartedAt: null, lastKind: null, st: null, sentMode: null,
            };
            this.#subs.set(id, sub);
            refs.push({ submissionId: id, digest: entry.digest });
            // taken over past its horizon (counted from the first submission,
            // RLTP-DEL-6130): given up at once, never attempted
            if (now - sub.submittedAt >= DECLARED.giveUpHorizonMs) {
                sub.st = { state: 'failed', reason: 'expired-by-adapter-policy' };
                continue;
            }
            if (this.#wire.offline?.() !== true)
                this.#startAttempt(sub, now);
        }
        return refs;
    }
    /** The current state as the ports' DeliveryReport for holder.report(),
     *  or null while no honest report exists (and for an unknown id). A
     *  submission filed without a digest (submit) has no report form. */
    report(id) {
        const st = this.status(id);
        if (st === null)
            return null;
        const digest = this.#subs.get(id).digest;
        if (digest === undefined)
            throw new Error('submitted without a document digest: file holder documents through reconcile');
        return deliveryReportOf(digest, st);
    }
    has(id) {
        this.#open();
        return this.#subs.has(id);
    }
    #startAttempt(sub, now) {
        if (sub.attemptStartedAt !== null)
            return;
        sub.attemptStartedAt = now;
        this.#track(this.#trySend(sub, now).finally(() => { sub.attemptStartedAt = null; }));
    }
    async #trySend(sub, now) {
        if (sub.st !== null && sub.st.state !== 'awaiting-transport')
            return;
        let next;
        try {
            const token = await this.#ensureAuth(now);
            if (this.#closed)
                return; // retirement between auth and deposit: nothing new starts (R5-B2)
            // each attempt hands the wire a copy: what it does with it never reaches the next.
            // The mode is read at the hand-over itself: from a switch on, every
            // hand-over uses the new mode, and a call already made ends in its own
            // (RLTP-VTI-3135)
            const deposit = () => {
                sub.sentMode = this.#mode;
                try {
                    return this.#wire.deposit(token, new Uint8Array(sub.bytes), this.#egressDid, sub.sentMode);
                }
                catch (e) {
                    return Promise.reject(e);
                }
            };
            if (sub.gate !== undefined) {
                // the holder decides, and the deposit starts in the same step of its
                // queue (Delivery RLTP-DEL-6125 to 6135); the adapter re-checks its
                // own state there: retired, withdrawn, past the trias, past the
                // entry's deadline or its own horizon → no deposit
                // the deposit's outcome, caught at once: the holder's step may still
                // be committing when the wire answers
                let started = null;
                let declined = false;
                const entry = sub.entry;
                const start = () => {
                    if (this.#closed || this.#subs.get(sub.id) !== sub || sub.gate.closed === true ||
                        (sub.st !== null && sub.st.state !== 'awaiting-transport') || this.#clock >= entry.notAfter ||
                        this.#clock - sub.submittedAt >= DECLARED.giveUpHorizonMs) {
                        declined = true;
                        return false;
                    }
                    started = deposit().then(() => null, (e) => ({ failed: e }));
                    return true;
                };
                let ok;
                try {
                    ok = await sub.gate.handOver(entry, this.#clock, start);
                }
                catch {
                    ok = null;
                }
                if (started === null) {
                    // the holder said no: withdrawn; the adapter declined or the
                    // holder was unreachable: not this attempt
                    if (ok === false && !declined && this.#subs.get(sub.id) === sub)
                        this.#subs.delete(sub.id);
                    return;
                }
                const outcome = await started;
                if (outcome !== null)
                    throw outcome.failed;
            }
            else {
                await deposit();
            }
            sub.lastKind = null;
            next = { state: 'accepted' };
        }
        catch (e) {
            const kind = e instanceof WireError ? e.kind : 'unreachable';
            sub.lastKind = kind;
            next = kind === 'oversize'
                ? { state: 'failed', reason: 'oversize' }
                : {
                    state: 'awaiting-transport',
                    reason: kind === 'unreachable' ? 'transport-unreachable' : 'carrier-refused-retriable',
                };
        }
        if (this.#closed)
            return;
        // withdrawn meanwhile (app contract rule 5): the late outcome changes nothing
        if (this.#subs.get(sub.id) !== sub)
            return;
        // a document accepted in routed enters the send state (RLTP-VTI-3130);
        // acknowledgements never count
        if (next.state === 'accepted' && sub.sentMode === 'routed' && this.#isDocument(sub)) {
            this.#firstRoutedAcceptedAt ??= this.#clock;
            const horizonAt = sub.submittedAt + DECLARED.giveUpHorizonMs;
            // answered already (the verdict outran the deposit's resolution), or
            // past its horizon (it would fall at the next clean conclusion): not named
            if (sub.digest !== undefined && sub.answered !== true && this.#clock <= horizonAt && !this.#routed.has(sub.digest)) {
                this.#routed.set(sub.digest, { acceptedAt: this.#clock, horizonAt });
            }
        }
        // An interim report (including a horizon-corrected one) never
        // outranks the attempt's real outcome; only a TERMINAL state —
        // a give-up, a refusal, a delivery — stands (R5-B1). Without
        // this, an accepted deposit would stay reported unreachable and
        // be sent a second time.
        if (sub.st === null || sub.st.state === 'awaiting-transport')
            sub.st = next;
    }
    #isDocument(sub) {
        return sub.entry === undefined || sub.entry.kind === 'document';
    }
    /** A verdict on a submission deposited in routed proves routed for
     *  the relationship (RLTP-VTI-3130); its digest leaves the send state. */
    #proveRouted(sub) {
        if (sub.sentMode !== 'routed' || !this.#isDocument(sub))
            return;
        this.#proven = true;
        sub.answered = true;
        if (sub.digest !== undefined)
            this.#routed.delete(sub.digest);
    }
    /** The current sending mode of the relationship (profile §3a). */
    get sendMode() { return this.#mode; }
    /** An answer the holder hands this instance for a document an earlier
     *  instance deposited (RLTP-VTI-3130): a valid acknowledgement, a
     *  validated receiver refusal or a validated `idConflict` answer for
     *  `digest`. If the send state names the digest as routed, routed is
     *  proven and the digest leaves; otherwise it proves nothing. A no-op on
     *  a retired instance, like acknowledged. */
    answered(digest, rawNow) {
        if (this.#closed)
            return;
        this.#now(rawNow);
        if (!this.#routed.has(digest))
            return;
        this.#proven = true;
        this.#routed.delete(digest);
    }
    /** Host teardown aid, NOT a port operation (profile §6): awaits
     *  the in-flight background tasks so a host can drain before
     *  persisting ackState. On a hanging wire it waits as long as the
     *  wire does — a host bounds it externally (Promise.race) exactly
     *  because this library holds no clock of its own. */
    async settle() {
        while (this.#inflight.size > 0)
            await Promise.all([...this.#inflight]);
    }
    /** The §6.1 report, or null while none exists yet (has()
     *  distinguishes an unknown id). status is a PORT: after close it
     *  refuses like every other port operation (R5-B3).
     *
     *  The pre-transport report is an HONEST SNAPSHOT, derived at the
     *  moment of observation by one precedence order (Option B of the
     *  round-14 halt) — never a stored patchwork:
     *    (a) the wire knows itself offline      → offline
     *    (b) an attempt is overdue              → transport-unreachable
     *    (c) the last completed attempt's kind  → its report
     *    (d) otherwise                          → no report yet (null)
     *  Terminal states and `accepted` are stored and stand. */
    status(id) {
        this.#open();
        const sub = this.#subs.get(id);
        if (!sub)
            return null;
        if (sub.st !== null && sub.st.state !== 'awaiting-transport')
            return { ...sub.st };
        if (this.#wire.offline?.() === true) {
            return { state: 'awaiting-transport', reason: 'offline' };
        }
        if (sub.attemptStartedAt !== null &&
            this.#clock - sub.attemptStartedAt >= DECLARED.statusHorizonMs) {
            return { state: 'awaiting-transport', reason: 'transport-unreachable' };
        }
        return sub.st === null ? null : { ...sub.st };
    }
    acknowledged(id) {
        if (this.#closed)
            return;
        const sub = this.#subs.get(id);
        if (!sub)
            return;
        this.#proveRouted(sub);
        if (sub.st?.state === 'delivered')
            return; // idempotent: a duplicate ack never rewrites `late` (R9-M4)
        const late = sub.st?.state === 'failed';
        sub.st = { state: 'delivered', late };
        if (late)
            this.#transitions.push({ id, to: 'delivered' });
    }
    /** Refusals act on live submissions only (§6.1 knows exactly one
     *  late correction — the valid ack). The code set is closed and
     *  TERMINAL: retryable counterpart conditions (unavailable,
     *  internalError) are transport outcomes, never receiver verdicts
     *  — they have no entry here, and an unknown code is refused
     *  fail-closed rather than minted into a verdict (R6-B2). */
    receiverRefused(id, code) {
        if (this.#closed)
            return;
        if (!RECEIVER_REFUSAL_CODES.has(code)) {
            throw new Error('not a terminal receiver refusal code — retryable conditions are transport outcomes');
        }
        const sub = this.#subs.get(id);
        if (!sub)
            return;
        this.#proveRouted(sub);
        // A VALIDATED refusal is itself the proof of receipt — the
        // mediator can have accepted and forwarded while our deposit
        // promise is still unresolved, so the report-less phase is a
        // legitimate moment for it (R9-B2, reversing the R8-B3
        // overcorrection). Only terminal states stand against it.
        if (sub.st !== null && sub.st.state !== 'awaiting-transport' && sub.st.state !== 'accepted')
            return;
        sub.st = { state: 'failed', reason: 'rejected-by-receiver', code };
    }
    drainTransitions() {
        this.#open();
        return this.#transitions.splice(0);
    }
    // ── receiver side ───────────────────────────────────────────────
    collect(rawNow) {
        this.#open();
        this.#now(rawNow);
        if (this.#inbox.length === 0)
            return { id: 'c-empty', items: [] };
        const items = this.#inbox.splice(0);
        this.#outstandingBytes += this.#inboxBytes;
        this.#inboxBytes = 0;
        this.#inboxDigests.clear();
        const id = 'c' + this.#nextColId++;
        this.#outstanding.set(id, new Map(items.map((i) => [i.queueId, i])));
        // the caller gets its own copies: the outstanding entries stay intact,
        // whatever it does with the bytes, for a conclusion that keeps them
        return { id, items: items.map((i) => ({ ...i, bytes: new Uint8Array(i.bytes) })) };
    }
    /** Concludes a collection (profile §4, Delivery 5a.8): its items'
     *  digests become ack intent. `keep` names the items whose disposition
     *  is transient (Delivery RLTP-DEL-5810, 5820: `failed(rate-limited)`,
     *  or a transaction that could not commit, see `concludable`): they are
     *  not concluded and not acknowledged, they go back to the buffer and the
     *  next collect offers them again, and the mediator keeps its copy. */
    conclude(collection, rawNow, opts = {}) {
        this.#open();
        const now = this.#now(rawNow);
        const col = this.#outstanding.get(collection.id);
        if (!col) {
            // an empty collection is concluded too: it may be the one that leaves nothing pending
            if (collection.id === 'c-empty')
                this.#concludedClean(now);
            return;
        }
        this.#outstanding.delete(collection.id);
        const keep = new Set(opts.keep ?? []);
        for (const item of col.values()) {
            this.#outstandingBytes -= item.bytes.length;
            if (keep.has(item.queueId)) {
                // transient: back to the buffer, offered again, never acknowledged
                this.#inbox.push(item);
                this.#inboxBytes += item.bytes.length;
                this.#inboxDigests.add(item.queueId);
                continue;
            }
            this.#concluded.set(item.queueId, now);
            this.#pendingAcks.add(item.queueId);
        }
        this.#concludedClean(now);
        this.#startFlush(now);
    }
    /** Nothing pending for this connection: the wire says the mediator
     *  holds nothing more (queueEmpty; a wire without it never says so),
     *  nothing waits in the buffer, no collection is outstanding. */
    #nothingPending() {
        return this.#wire.queueEmpty?.() === true && this.#inbox.length === 0 && this.#outstanding.size === 0;
    }
    /** After a conclusion (RLTP-VTI-3130): when it left nothing pending,
     *  the switch check may run in a later advance, and the routed digests
     *  past their give-up horizon fall. */
    #concludedClean(now) {
        if (!this.#nothingPending())
            return;
        this.#cleanConcluded = true;
        for (const [digest, r] of this.#routed)
            if (now >= r.horizonAt)
                this.#routed.delete(digest);
    }
    ackState() {
        return {
            concluded: [...this.#concluded].map(([queueId, concludedAt]) => ({ queueId, concludedAt })),
            pending: [...this.#pendingAcks],
            send: {
                mode: this.#mode,
                firstRoutedAcceptedAt: this.#firstRoutedAcceptedAt,
                routed: [...this.#routed].map(([digest, r]) => ({ digest, acceptedAt: r.acceptedAt, horizonAt: r.horizonAt })),
                proven: this.#proven,
            },
        };
    }
    #startFlush(now) {
        if (this.#flushing || this.#pendingAcks.size === 0)
            return;
        this.#flushing = true;
        const snapshot = new Set(this.#pendingAcks);
        this.#track(this.#flushAcks(now, [...snapshot]).finally(() => {
            this.#flushing = false;
            // lost-wake-up guard (review-4 M6): intents that arrived while
            // this flush ran get their own flush now — but only newcomers,
            // so a failing wire waits for the next advance instead of
            // spinning
            if (!this.#closed) {
                for (const id of this.#pendingAcks) {
                    if (!snapshot.has(id)) {
                        this.#startFlush(this.#clock);
                        break;
                    }
                }
            }
        }));
    }
    async #flushAcks(now, ids) {
        try {
            const token = await this.#ensureAuth(now);
            if (this.#closed)
                return;
            // Only NOW does anything become irrecallable (R16-B1): the
            // stay of expiry begins at the wire call itself, never at the
            // snapshot — a hanging auth extends no window. And "live" is
            // WINDOW-live (R17-B1): an entry whose window already closed —
            // even if no prune has swept it yet — is never sent.
            const live = ids.filter((id) => {
                const at = this.#concluded.get(id);
                return at !== undefined && this.#clock - at < DECLARED.duplicateWindowMs;
            });
            if (live.length === 0)
                return;
            for (const id of live)
                this.#flightAcks.add(id);
            try {
                // the wire gets its own list: what it does with it never reaches the bookkeeping below
                await this.#wire.ackReceived(token, [...live]);
                if (!this.#closed)
                    for (const id of live)
                        this.#pendingAcks.delete(id);
            }
            finally {
                for (const id of live)
                    this.#flightAcks.delete(id);
                // deferred window sweep: entries whose window closed while
                // the ack flew fall now — intent, entry and absorption
                // together (R15-B1). Never on a retired instance: after
                // close, ackState() is the host's final-persist surface and
                // a late-returning wire mutates nothing (R17-B2).
                if (!this.#closed) {
                    for (const id of live) {
                        const at = this.#concluded.get(id);
                        if (at !== undefined && this.#clock - at >= DECLARED.duplicateWindowMs) {
                            this.#concluded.delete(id);
                            this.#pendingAcks.delete(id);
                        }
                    }
                }
            }
        }
        catch {
            // intent survives; the next advance starts a fresh flush
        }
    }
    // ── the adapter clock — never awaits the mediator ───────────────
    advance(rawNow) {
        this.#open();
        const now = this.#now(rawNow);
        // the switch (RLTP-VTI-3130): only after a conclusion that left nothing
        // pending, routed unproven, its first acceptance a deadline ago — one
        // way; checked before the retries below, which hand over in the new mode
        // the check holds while anything is pending again at the check itself:
        // an acknowledgement that arrived since waits to be collected and reported
        if (this.#mode === 'routed' && this.#cleanConcluded && !this.#proven && this.#nothingPending() &&
            this.#firstRoutedAcceptedAt !== null &&
            now - this.#firstRoutedAcceptedAt >= DECLARED.routedAckDeadlineMs) {
            this.#mode = 'egress-session';
        }
        for (const sub of this.#subs.values()) {
            const live = sub.st === null || sub.st.state === 'awaiting-transport' || sub.st.state === 'accepted';
            if (!live)
                continue;
            if (now - sub.submittedAt >= DECLARED.giveUpHorizonMs) {
                // unroutable only when the LAST COMPLETED attempt was an
                // admission refusal and no attempt is in flight whose outcome
                // is unknown (review-4 B3)
                // the give-up verdict applies the SAME precedence as every
                // observation (R17-B3): a wire that knows itself offline at
                // the horizon outranks any stored refusal class — unroutable
                // needs a completed admission refusal, no unknown outcome in
                // flight, AND no offline signal standing over it
                sub.st = {
                    state: 'failed',
                    reason: sub.lastKind === 'refused-admission' && sub.attemptStartedAt === null &&
                        this.#wire.offline?.() !== true
                        ? 'unroutable'
                        : 'expired-by-adapter-policy',
                };
                continue;
            }
            if (sub.st !== null && sub.st.state === 'accepted')
                continue;
            // reports are DERIVED at observation (see status()); the clock
            // only decides here whether to start an attempt — and never
            // against a wire that knows itself offline
            if (this.#wire.offline?.() === true)
                continue;
            if (sub.attemptStartedAt === null)
                this.#startAttempt(sub, now);
        }
        // THE WINDOW BEATS EVERYTHING (Option B of the round-14 halt):
        // an ack intent is retried until the window closes; then intent
        // and absorption fall together. There is no ageless debt whose
        // truth the adapter would have to know — the receiver's §6.2
        // absorption owns everything beyond the window.
        for (const [digest, at] of this.#concluded) {
            if (now - at >= DECLARED.duplicateWindowMs && !this.#flightAcks.has(digest)) {
                this.#concluded.delete(digest);
                this.#pendingAcks.delete(digest);
            }
        }
        this.#startKeylistSync(now);
        this.#startFlush(now);
    }
    /** §5a.10 lifecycle boundary: after close, every state port is
     *  inert — port operations refuse, inbound reports (acknowledged,
     *  receiverRefused) are no-ops, late wire resolutions mutate
     *  nothing. Only ackState() stays readable for the host's final
     *  persist. */
    close() { this.#closed = true; }
    get closed() { return this.#closed; }
}
export const queueIdOf = async (bytes) => hex(await sha(bytes));
