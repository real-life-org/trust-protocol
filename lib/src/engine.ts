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
//     journal replays commit nothing, lastWhen included
//   - outbound of an act starts at attempt 1 with nextAttemptAt =
//     when + ceil(backoff(1)); resume() re-emits only items that are due
//     and pauses re-emission while the last step is awaiting-transport
//     (the adapter holds the item) and never re-emits an accepted one. It
//     gives up every non-terminal item (submitted, held or accepted) at
//     first submission + horizonMs, never by attempt
//     count; nextDueAt is the earliest due re-emission or horizon expiry
//   - the holder's give-up is failed(expired-by-adapter-policy); a later
//     delivered report is late by that history, whatever the adapter says
//   - replay of a human act returns the journaled events and the outbound
//     of its documents that are not terminal (delivered, failed), at their
//     current attempt. Idempotency is bounded by the journal's retention:
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
//     It stays `sent: false` until any report on its digest. Unsent, it has
//     the outbox's retry schedule: attempt 1 at the receive, re-offered by
//     resume when due (attempt + 1, backoff), counted into nextDueAt, and at
//     its horizon (effect commit + horizonMs) marked sent by the horizon
//     (`sentBy: 'horizon'`, no event: acks have no trias). A duplicate's
//     re-send carries attempt + 1 and does not move the schedule (it
//     commits nothing beyond lastWhen)
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
//     duties count in too
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
//   - a task handler's refusal commits nothing; its TaskDiscarded (an
//     assembly discarded at a resource limit or rejected, Trust 5365/5366)
//     commits its state and nothing else: disposition `discarded` with the
//     reason, no cache entry, no ack, no event
//   - after its own retention, tick runs every module's `retain` hook on
//     the result (the trust module drops in-flight star deliveries whose
//     outbox items have all been retained away)
//   - tick retains with the key-retention max(P90D, horizonMs): effects
//     with their acks at expiresAt; terminal outbox items once the
//     retention has passed since their last step, unless a kept journal
//     entry names them; an address key not shown for the retention and
//     the own rkid of no tuple that is not deactivated becomes a tombstone
import { jcs, b64uOf } from './core.js'
import { CODEC, decodeState, encodeState } from './codec.js'
import { emptyState, toOpaque, triasOf } from './state.js'
import type { Dec, Duty, Effect, HolderState, Millis, OutboxItem, OutboxStep, Prompt, PromptChoice, PromptKind } from './state.js'
import type { Access, CarrierKey, DeliveryReport, KeyProvider, KeyRelease, Log, Outbound, RetryPolicy, Store, StoreSnapshot } from './ports.js'
import type { HolderEvent } from './events.js'
import { CryptoUnavailableError, InfraError } from './results.js'
import type { ActError, ActResult, InfraErrorCode, ReceiveResult, ResumeResult } from './results.js'
import { randomEntropy } from './entropy.js'
import type { Entropy, PlatformRandom } from './entropy.js'
import { ED_PKCS8, X_PKCS8 } from './keys-seed.js'
import { freezeDeep } from './util-freeze.js'
import { ACK_TYPE } from './ack.js'
import { SIGNATURE_CLASS, ackOutbound, handlerPrepared, isTaskRefusal, markDelivered, prepareReceive } from './receive.js'
import { isTaskDiscarded } from './receive.js'
import type { Arrival, ReceivePlan, ReceivedDocument, TaskDiscarded, TaskRefusal } from './receive.js'
export type { Arrival, ReceivedDocument, TaskDiscarded, TaskFailure, TaskRefusal } from './receive.js'

// ── types ──────────────────────────────────────────────────────────────

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** An event as a module emits it; the engine adds eventId, commitSeq, actId. */
export type EventDraft = DistributiveOmit<HolderEvent, 'eventId' | 'commitSeq' | 'actId'>
/** A document as a module issues it; the engine sets attempt 1 and files it in the outbox. */
export type OutboundDraft = Omit<Outbound, 'attempt'>

/** What a WebCrypto handle must offer; resolved at construction. The
 *  default entropy also needs getRandomValues and randomUUID from it. */
export type CryptoHandle = { subtle: SubtleCrypto } & Partial<PlatformRandom>

/** What a preparation sees. The snapshot is deep-frozen; `release` is the
 *  key release read from its `addresses` (note §3 KeyProvider). */
export interface PrepareCtx {
  readonly snapshot: Readonly<HolderState>
  readonly keys: KeyProvider
  readonly entropy: Entropy
  readonly access?: Access
  readonly log?: Log
  readonly crypto: CryptoHandle
  readonly when: Millis
  readonly release: KeyRelease
}

/** A preparation's value, bound to the store version and commitSeq of the
 *  snapshot it ran against. The commit is CAS on exactly that version, so
 *  a prepared value never lands on any other state. */
export interface Prepared<P = unknown> {
  readonly value: P
  readonly version: string | null
  readonly commitSeq: Dec
}

/** A transition's outcome: the next state (a new object; the input is
 *  frozen) and what it issues. */
export interface Applied {
  state: HolderState
  outbound?: OutboundDraft[]
  events?: EventDraft[]
  duties?: Duty[]
}

/** A refused act: nothing commits. */
export interface Refusal { ok: false, code: ActError, ref?: string }

/** One command of a module. `human` acts need an actId and are journaled. */
export interface CommandDef<I = any, P = any> {
  human: boolean
  prepare?: (ctx: PrepareCtx, input: I) => Promise<P>
  /** synchronous and pure: must not mutate `state`, returns a new object */
  apply: (state: Readonly<HolderState>, prepared: Prepared<P>, input: I, when: Millis) => Applied | Refusal
}

/**
 * A received task type's handler, keyed by its full task URI with
 * version (note §4.3; receive.ts runs it). `decode` is the payload's
 * decoder and validator (stage 7: refuse 'malformed'; stage 8: any other
 * reason); `prepare` the async stage-8 work (MAC checks, key agreement),
 * which may also refuse; `apply` the synchronous stage-9 transition. The
 * core, never the handler, writes the effect-cache entry with its ack in
 * the same commit and releases the events after it; a handler whose
 * state touches `effects` is a programming error and throws.
 */
export interface TaskHandler<T = any, P = any> {
  /** the registry entry's proof declaration (Delivery 4.4): whether the
   *  document itself carries a `proof` (its artifacts' own MACs and
   *  signatures are the payload's business); checked at stage 6 */
  proof: 'absent' | 'required'
  decode: (payload: unknown) => T | TaskRefusal
  prepare?: (ctx: PrepareCtx, doc: ReceivedDocument<T>, arrival: Arrival) => Promise<P | TaskRefusal>
  /** a TaskDiscarded commits its `state` as the disposition `discarded`
   *  (no effect-cache entry, no ack): a resource-limit discard (Trust 5365) */
  apply: (state: Readonly<HolderState>, prepared: Prepared<P>, doc: ReceivedDocument<T>, arrival: Arrival) => Applied | TaskRefusal | TaskDiscarded
}

/** What a duty's apply sees beside the state: its preparation. */
export interface DutyCtx<P = unknown> { readonly prepared: Prepared<P> }

/**
 * A duty kind's handler at one version (note §2.1 duties), run by
 * resume(when). A duty of the kind at another `v` stays untouched and is
 * announced as duty.unsupported. `awaitHolds` is the module's pure
 * condition for a duty that carries an `awaitHead` (6596); without it
 * such a duty never runs. `apply` returning Applied fulfils the duty
 * (the engine removes it in the same commit); 'not-due' and a refusal
 * leave it as it is.
 */
export interface DutyHandler<P = any> {
  v: number
  prepare?: (ctx: PrepareCtx, duty: Duty) => Promise<P>
  awaitHolds?: (state: Readonly<HolderState>, duty: Duty) => boolean
  apply: (state: Readonly<HolderState>, duty: Duty, ctx: DutyCtx<P>, when: Millis) => Applied | Refusal | 'not-due'
}

/**
 * A module's reconciliation sweep (Trust 5.4), run by resume(when) after
 * the duties, on the state they left. `prepare` runs against resume's
 * snapshot (before the duties); `apply` re-checks every prepared piece
 * against the state it gets and skips one whose inputs moved, reporting
 * `deferred` (resume then names `when` as nextDueAt). `pending` is the
 * pure answer to "would the sweep issue now?", as keys: an operation
 * other than resume whose commit adds a key names `when` as its
 * nextDueAt, the app's cue to call resume (engine.ts header).
 */
export interface SweepHandler<P = any> {
  pending: (state: Readonly<HolderState>, when: Millis) => string[]
  /** the top-level state parts `pending` reads; where given, an operation
   *  that replaced none of them skips `pending` (its keys cannot change) */
  reads?: ReadonlyArray<keyof HolderState>
  prepare: (ctx: PrepareCtx) => Promise<P>
  apply: (state: Readonly<HolderState>, prepared: Prepared<P>, when: Millis) => Applied & { deferred?: boolean }
}

/**
 * What a verified delivery-ack does for the module whose task type the
 * acknowledged outbox item carries (receive.ts, the common ack path):
 * synchronous and pure, inside the ack's transaction, after the item is
 * marked delivered. Adapter reports never reach it: only a verified ack
 * completes (ports.ts DeliveryReport, 5660).
 */
export type AckHandler = (state: Readonly<HolderState>, ref: string, when: Millis) => Applied

/**
 * What the module whose task type an outbox item carries does when that
 * item turns failed (a failed report, or the holder's give-up at the
 * horizon): synchronous and pure, inside that transaction, after the item
 * is marked failed. Its duties are folded into the state (an id already
 * open is kept as it is); it must not write the effect cache.
 */
export type FailureHandler = (state: Readonly<HolderState>, ref: string, when: Millis) => Applied

/**
 * What a human's choice on a prompt of one kind does in its domain
 * (prompts.ts): synchronous and pure like apply, run inside the decision's
 * own transition, so the domain effect and the closing commit together.
 * It sees the prompt still open; the prompts module removes it after. A
 * refusal refuses the decision.
 */
export type DecisionHandler = (state: Readonly<HolderState>, prompt: Readonly<Prompt>, choice: PromptChoice, when: Millis) => Applied | Refusal

/** A domain module: what it registers with the engine. */
export interface HolderModule {
  name: string
  commands: Record<string, CommandDef>
  tasks?: Record<string, TaskHandler>
  duties?: Record<string, DutyHandler>
  /** reconciliation sweeps, run by resume after the duties, by name */
  sweeps?: Record<string, SweepHandler>
  /** ack handlers by the full task type URI of the acknowledged document;
   *  at most one per type across all modules */
  acks?: Record<string, AckHandler>
  /** failure handlers by the full task type URI of the failed document;
   *  at most one per type across all modules */
  failures?: Record<string, FailureHandler>
  /** the module's own retention, run by tick after the engine's: pure and
   *  synchronous, returning the same state object where nothing goes */
  retain?: (state: Readonly<HolderState>, when: Millis) => HolderState
  /** at most one handler per prompt kind across all modules; collected by
   *  createHolder for the prompts module (prompts.ts) */
  decisions?: Partial<Record<PromptKind, DecisionHandler>>
}

/** The ports of a holder (note §3); retry fields fall back to ENGINE_DEFAULTS. */
export interface EnginePorts {
  store: Store
  keys: KeyProvider
  entropy?: Entropy
  log?: Log
  access?: Access
  retry?: Partial<RetryPolicy>
  crypto?: CryptoHandle
}

/** Announced after every commit of this engine, with its commitSeq. */
export type CommitListener = (commit: { commitSeq: Dec, events: HolderEvent[] }) => void

/** A deep-frozen decoded state and its commitSeq. */
export interface EngineSnapshot { state: Readonly<HolderState>, commitSeq: Dec }

export interface Engine {
  /** the names registered at construction, frozen */
  readonly registry: Readonly<{ commands: readonly string[], tasks: readonly string[], duties: readonly string[], sweeps: readonly string[] }>
  act (command: string, input: unknown, when: Millis, opts?: { actId?: string }): Promise<ActResult>
  /** expiry and retention: effects, prompts, the act journal, terminal
   *  outbox items, address keys to tombstones; raises lastWhen */
  tick (when: Millis): Promise<ActResult>
  /** re-emits due outbox items (attempt + 1) or gives them up, runs due
   *  duties, re-emits unsent acks */
  resume (when: Millis): Promise<ResumeResult>
  /** an adapter's delivery report (Delivery §6.1); on an ack's digest it
   *  marks the stored ack sent */
  report (report: DeliveryReport, when: Millis): Promise<ActResult>
  /** an arriving envelope: Delivery §6.2 stages 1–9 (receive.ts) */
  receive (env: unknown, when: Millis): Promise<ReceiveResult>
  subscribe (listener: CommitListener): () => void
  snapshot (): Promise<EngineSnapshot>
}

// ── defaults ───────────────────────────────────────────────────────────

const DAY = 86_400_000

/** Defaults of the retry policy and the retention it implies. */
export const ENGINE_DEFAULTS = Object.freeze({
  /** 30 s, doubling, at most 6 h */
  backoff: (attempt: number): number => Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 6 * 3_600_000),
  /** P7D, inside Delivery's give-up range [P1D, P90D]; the only give-up */
  horizonMs: 7 * DAY,
  commitAttempts: 8,
  /** max(P90D, horizonMs) with the default horizon */
  retentionMs: 90 * DAY,
})

/** Delivery's give-up range for horizonMs: [P1D, P90D]. */
const HORIZON_MIN = DAY
const HORIZON_MAX = 90 * DAY

const BUILTIN = ['tick', 'resume', 'report', 'receive'] as const
const TASK_URI = /^[a-z][a-z0-9+.-]*:\S+\/[0-9]+\.[0-9]+$/

// ── helpers ────────────────────────────────────────────────────────────

const ALGORITHMS = ['Ed25519', 'X25519', 'HKDF', 'HMAC', 'AES-GCM', 'SHA-256'] as const

const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o }

/** Resolves the WebCrypto handle and probes every algorithm the library uses. */
async function resolveCrypto (c?: CryptoHandle): Promise<CryptoHandle> {
  const h = c ?? (globalThis.crypto as CryptoHandle | undefined)
  const S = h?.subtle
  if (!S || typeof S.importKey !== 'function' || typeof S.digest !== 'function') throw new CryptoUnavailableError(['subtle', ...ALGORITHMS])
  const k = new Uint8Array(32).fill(1)
  const probes: Record<typeof ALGORITHMS[number], () => Promise<unknown>> = {
    Ed25519: () => S.importKey('pkcs8', concat(ED_PKCS8, k), { name: 'Ed25519' }, false, ['sign']),
    X25519: () => S.importKey('pkcs8', concat(X_PKCS8, k), { name: 'X25519' }, false, ['deriveBits']),
    HKDF: () => S.importKey('raw', k, 'HKDF', false, ['deriveBits']),
    HMAC: () => S.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    'AES-GCM': () => S.importKey('raw', k, { name: 'AES-GCM' }, false, ['encrypt']),
    'SHA-256': () => S.digest('SHA-256', k),
  }
  const ok = await Promise.all(ALGORITHMS.map(async (a) => { try { await probes[a](); return true } catch { return false } }))
  const missing = ALGORITHMS.filter((_, i) => !ok[i])
  if (missing.length) throw new CryptoUnavailableError(missing)
  return h as CryptoHandle
}

const te = new TextEncoder()
/** The stack's document digest (u + multihash sha2-256 over JCS), on the resolved handle. */
const digestOf = async (S: SubtleCrypto, x: unknown): Promise<string> =>
  'u' + b64uOf(concat(Uint8Array.from([0x12, 0x20]), new Uint8Array(await S.digest('SHA-256', te.encode(jcs(x))))))

/** Drops undefined object members (as JSON does) without hiding what jcs refuses. */
const dropUndefined = (x: unknown): unknown => {
  if (x === null || typeof x !== 'object') return x
  if (Object.getOwnPropertySymbols(x).length > 0) return x
  if (Array.isArray(x)) {
    if (Object.getOwnPropertyNames(x).length !== x.length + 1) return x
    for (let i = 0; i < x.length; i++) if (!(i in x)) return x
    return x.map(dropUndefined)
  }
  const proto = Object.getPrototypeOf(x)
  if (proto !== null && proto !== Object.prototype) return x
  if (Object.getOwnPropertyNames(x).length !== Object.keys(x).length) return x
  // own data properties, never assignment: a "__proto__" key stays a key
  // (assignment would hit the inherited setter and change the prototype)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(x)) {
    if (v !== undefined) Object.defineProperty(out, k, { value: dropUndefined(v), enumerable: true, writable: true, configurable: true })
  }
  return out
}

/** The act input as bound at the call: canonical JSON, deep-frozen. A
 *  "__proto__" member is an ordinary key throughout: jcs serializes own
 *  keys (Object.keys) and JSON.parse defines own data properties, so it is
 *  hashed, journaled and handed to prepare/apply like any other key. */
const bindInput = <T>(x: T): T => freezeDeep(JSON.parse(jcs(x === undefined ? null : dropUndefined(x))) as T)

/** when + ceil(delay), clamped to safe integer milliseconds. */
const dueAt = (when: Millis, delay: number): Millis => {
  const d = Number.isNaN(delay) ? 0 : Math.max(0, Math.ceil(delay))
  return Math.min(when + d, Number.MAX_SAFE_INTEGER)
}

/** A port whose rejections become InfraError(code); InfraError passes as is. */
function guard<T extends object> (port: T, names: ReadonlyArray<keyof T & string>, code: InfraErrorCode, wrapResult?: (r: any) => unknown): T {
  const out: Record<string, unknown> = {}
  for (const n of names) {
    out[n] = async (...args: unknown[]) => {
      let r: unknown
      try { r = await (port[n] as (...a: unknown[]) => Promise<unknown>).apply(port, args) } catch (e) {
        throw e instanceof InfraError ? e : new InfraError(code, `${code}: ${n} failed`, { cause: e })
      }
      return wrapResult ? wrapResult(r) : r
    }
  }
  return Object.freeze(out) as T
}

const inc = (d: Dec): Dec => (BigInt(d) + 1n).toString()

const releaseOf = (state: Readonly<HolderState>): KeyRelease => (rkid) => {
  if (state.addresses.tombstones.includes(rkid)) return { status: 'retired' }
  if (!Object.hasOwn(state.addresses.keys, rkid)) return { status: 'unknown' }
  const k = state.addresses.keys[rkid]
  return k.retiredAt !== undefined ? { status: 'retired' } : { status: 'live', label: k.label }
}

const isRefusal = (r: unknown): r is Refusal => (r as Refusal)?.ok === false

const checkWhen = (when: unknown): void => {
  if (!Number.isSafeInteger(when) || (when as number) < 0) throw new TypeError(`when must be non-negative integer milliseconds, got ${String(when)}`)
}

// ── internal command form: built-ins may also re-emit and schedule ─────

interface InternalApplied extends Applied {
  /** outbox items re-emitted (already in state, attempt set) */
  emit?: Outbound[]
  /** outbound handed out without an outbox item: acks (receive.ts). It
   *  forces no commit; with nothing else to commit it is released as is */
  release?: Outbound[]
  nextDueAt?: Millis
  /** passed through to the caller of #run */
  detail?: unknown
}
/** A built-in's end without a commit, lastWhen included, carrying its answer. */
interface Halt { halt: true, detail: unknown }
interface InternalDef {
  human: boolean
  prepare?: (ctx: PrepareCtx, input: any) => Promise<unknown>
  apply: (state: Readonly<HolderState>, prepared: Prepared<any>, input: any, when: Millis) => InternalApplied | Refusal | Halt
}

/** Outbound order of one commit: re-emissions, then released acks, then new documents. */
type RunResult = { ok: true, outbound: Outbound[], events: HolderEvent[], nextDueAt?: Millis, detail?: unknown } | Refusal | Halt

/** A duty's dueAt; absent counts as 0 (due always). */
const dutyDue = (d: Duty): number => (Number.isSafeInteger(d.dueAt) ? d.dueAt as number : 0)

/** Due, and not waiting on a head its handler's awaitHolds denies (none: waits forever). */
const dutyRunnable = (d: Duty, h: DutyHandler, state: Readonly<HolderState>, when: Millis): boolean => {
  if (dutyDue(d) > when) return false
  const awaits = (d as { awaitHead?: unknown }).awaitHead
  return typeof awaits !== 'string' || (h.awaitHolds?.(state, d) ?? false)
}

const isHalt = (r: unknown): r is Halt => (r as Halt)?.halt === true

const actResult = (r: RunResult): ActResult => {
  if (isHalt(r)) throw new Error('engine: an act does not halt')
  return r.ok ? { ok: true, outbound: r.outbound, events: r.events, ...(r.nextDueAt !== undefined ? { nextDueAt: r.nextDueAt } : {}) } : r
}

interface Policy { backoff: (attempt: number) => number, horizonMs: number, commitAttempts: number, retentionMs: number }

// ── the engine ─────────────────────────────────────────────────────────

class HolderEngine implements Engine {
  readonly registry: Engine['registry']
  readonly #store: Store
  readonly #ports: EnginePorts
  /** the ports a preparation sees, rejections typed (InfraError) */
  readonly #keys: KeyProvider
  readonly #log?: Log
  readonly #access?: Access
  readonly #crypto: CryptoHandle
  readonly #entropy: Entropy
  readonly #policy: Policy
  readonly #commands: ReadonlyMap<string, InternalDef>
  readonly #tasks: ReadonlyMap<string, TaskHandler>
  readonly #duties: ReadonlyMap<string, DutyHandler>
  readonly #sweeps: ReadonlyMap<string, SweepHandler>
  readonly #acks: ReadonlyMap<string, AckHandler>
  readonly #failures: ReadonlyMap<string, FailureHandler>
  readonly #retain: ReadonlyArray<(state: Readonly<HolderState>, when: Millis) => HolderState>
  readonly #builtins: Readonly<Record<typeof BUILTIN[number], InternalDef>>
  readonly #listeners = new Set<CommitListener>()
  #chain: Promise<unknown> = Promise.resolve()
  /** a commit whose outcome is unknown, settled before the next operation */
  #unsettled: { text: string, actId?: string, commitSeq: Dec, events: HolderEvent[] } | null = null

  constructor (ports: EnginePorts, crypto: CryptoHandle, modules: readonly HolderModule[]) {
    this.#store = ports.store
    this.#ports = ports
    this.#crypto = crypto
    this.#entropy = ports.entropy ?? randomEntropy(crypto)
    const r = ports.retry ?? {}
    const horizonMs = r.horizonMs ?? ENGINE_DEFAULTS.horizonMs
    const backoff = r.backoff ?? ENGINE_DEFAULTS.backoff
    const commitAttempts = r.commitAttempts ?? ENGINE_DEFAULTS.commitAttempts
    if (!Number.isSafeInteger(horizonMs) || horizonMs < HORIZON_MIN || horizonMs > HORIZON_MAX) throw new RangeError(`retry.horizonMs must be integer ms within [P1D, P90D], got ${horizonMs}`)
    if (typeof backoff !== 'function') throw new RangeError('retry.backoff must be a function')
    for (let n = 1; n <= 3; n++) {
      const d = backoff(n)
      if (typeof d !== 'number' || !Number.isFinite(d) || d < 0) throw new RangeError(`retry.backoff(${n}) must be a finite non-negative number, got ${d}`)
    }
    if (!Number.isSafeInteger(commitAttempts) || commitAttempts < 1) throw new RangeError('retry.commitAttempts must be a positive integer')
    this.#policy = Object.freeze({ backoff, horizonMs, commitAttempts, retentionMs: Math.max(ENGINE_DEFAULTS.retentionMs, horizonMs) })
    const carrierKey = (k: CarrierKey): CarrierKey => Object.freeze({ principal: k.principal, sign: guard(k, ['sign'], 'key-provider').sign })
    const base = guard(ports.keys, ['anchorOf', 'sign', 'agree'], 'key-provider')
    this.#keys = Object.freeze({
      anchorOf: base.anchorOf, sign: base.sign, agree: base.agree,
      carrierPrincipal: guard(ports.keys, ['carrierPrincipal'], 'key-provider', carrierKey).carrierPrincipal,
    })
    if (ports.log) this.#log = guard(ports.log, ['head', 'append'], 'log')
    if (ports.access) this.#access = guard(ports.access, ['memberships', 'membership'], 'access')

    const commands = new Map<string, InternalDef>()
    const tasks = new Map<string, TaskHandler>()
    const duties = new Map<string, DutyHandler>()
    const sweeps = new Map<string, SweepHandler>()
    const acks = new Map<string, AckHandler>()
    const failures = new Map<string, FailureHandler>()
    const retain: Array<(state: Readonly<HolderState>, when: Millis) => HolderState> = []
    const names = new Set<string>()
    for (const m of modules) {
      if (!m || typeof m.name !== 'string' || !m.name) throw new TypeError('a module needs a name')
      if (names.has(m.name)) throw new Error(`duplicate module ${m.name}`)
      names.add(m.name)
      for (const [name, def] of Object.entries(m.commands ?? {})) {
        if (commands.has(name) || (BUILTIN as readonly string[]).includes(name)) throw new Error(`duplicate command ${name} (module ${m.name})`)
        if (typeof def?.apply !== 'function' || typeof def.human !== 'boolean') throw new TypeError(`command ${name} (module ${m.name}) needs human and apply`)
        commands.set(name, Object.freeze({ ...def }))
      }
      for (const [uri, h] of Object.entries(m.tasks ?? {})) {
        if (!TASK_URI.test(uri)) throw new Error(`not a full task URI with version: ${uri} (module ${m.name})`)
        if (uri === ACK_TYPE) throw new Error(`${uri} is built in: acks take the common path (module ${m.name})`)
        if (SIGNATURE_CLASS.has(uri)) throw new Error(`${uri} is signature-class: its signed ack is not built yet (module ${m.name})`)
        if (tasks.has(uri)) throw new Error(`duplicate task ${uri} (module ${m.name})`)
        if (typeof h?.apply !== 'function' || typeof h.decode !== 'function') throw new TypeError(`task ${uri} (module ${m.name}) needs decode and apply`)
        if (h.proof !== 'absent' && h.proof !== 'required') throw new TypeError(`task ${uri} (module ${m.name}) needs its proof declaration: 'absent' or 'required'`)
        tasks.set(uri, Object.freeze({ ...h }))
      }
      for (const [kind, h] of Object.entries(m.duties ?? {})) {
        if (duties.has(kind)) throw new Error(`duplicate duty ${kind} (module ${m.name})`)
        if (typeof h?.apply !== 'function') throw new TypeError(`duty ${kind} (module ${m.name}) needs apply`)
        if (!Number.isSafeInteger(h.v) || h.v < 1) throw new TypeError(`duty ${kind} (module ${m.name}) needs its version v, a positive integer`)
        if (h.awaitHolds !== undefined && typeof h.awaitHolds !== 'function') throw new TypeError(`duty ${kind} (module ${m.name}): awaitHolds must be a function`)
        duties.set(kind, Object.freeze({ ...h }))
      }
      for (const [name, h] of Object.entries(m.sweeps ?? {})) {
        if (sweeps.has(name)) throw new Error(`duplicate sweep ${name} (module ${m.name})`)
        if (typeof h?.apply !== 'function' || typeof h.prepare !== 'function' || typeof h.pending !== 'function') throw new TypeError(`sweep ${name} (module ${m.name}) needs pending, prepare and apply`)
        sweeps.set(name, Object.freeze({ ...h }))
      }
      for (const [uri, h] of Object.entries(m.acks ?? {})) {
        if (!TASK_URI.test(uri)) throw new Error(`not a full task URI with version: ${uri} (module ${m.name})`)
        if (acks.has(uri)) throw new Error(`duplicate ack handler ${uri} (module ${m.name})`)
        if (typeof h !== 'function') throw new TypeError(`ack handler ${uri} (module ${m.name}) must be a function`)
        acks.set(uri, h)
      }
      for (const [uri, h] of Object.entries(m.failures ?? {})) {
        if (!TASK_URI.test(uri)) throw new Error(`not a full task URI with version: ${uri} (module ${m.name})`)
        if (failures.has(uri)) throw new Error(`duplicate failure handler ${uri} (module ${m.name})`)
        if (typeof h !== 'function') throw new TypeError(`failure handler ${uri} (module ${m.name}) must be a function`)
        failures.set(uri, h)
      }
      if (m.retain !== undefined) {
        if (typeof m.retain !== 'function') throw new TypeError(`retain (module ${m.name}) must be a function`)
        retain.push(m.retain)
      }
    }
    this.#commands = commands
    this.#tasks = tasks
    this.#duties = duties
    this.#sweeps = sweeps
    this.#acks = acks
    this.#failures = failures
    this.#retain = Object.freeze(retain)
    this.#builtins = Object.freeze({ tick: this.#tickDef(), resume: this.#resumeDef(), report: this.#reportDef(), receive: this.#receiveDef() })
    this.registry = Object.freeze({
      commands: Object.freeze([...commands.keys()]),
      tasks: Object.freeze([...tasks.keys()]),
      duties: Object.freeze([...duties.keys()]),
      sweeps: Object.freeze([...sweeps.keys()]),
    })
  }

  // ── loading ──────────────────────────────────────────────────────────

  async #readRaw (): Promise<StoreSnapshot> {
    try { return await this.#store.read() } catch (e) { throw new InfraError('store-read', undefined, { cause: e }) }
  }

  async #read (): Promise<{ state: Readonly<HolderState>, version: string | null }> {
    const snap = await this.#readRaw()
    if (snap.state === null) throw new Error('engine: the store holds no state')
    return { state: freezeDeep(decodeState(snap.state)), version: snap.version }
  }

  /** Initialise an empty store with the empty state, or check the stored one decodes. */
  async load (): Promise<void> {
    const snap = await this.#readRaw()
    if (snap.state !== null) { decodeState(snap.state); return }
    let cause: unknown
    try { if ((await this.#store.commit(null, toOpaque(emptyState(CODEC)))).ok) return } catch (e) { cause = e }
    const again = await this.#readRaw()   // conflict or unknown outcome: someone (maybe we) wrote
    if (again.state === null) throw new InfraError('store-commit', 'could not initialise the store', { cause })
    decodeState(again.state)
  }

  // ── the queue ────────────────────────────────────────────────────────

  #enqueue<T> (fn: () => Promise<T>): Promise<T> {
    const p = this.#chain.then(async () => { await this.#settle(); return fn() })
    this.#chain = p.then(() => undefined, () => undefined)
    return p
  }

  async #settle (): Promise<void> {
    const u = this.#unsettled
    if (!u) return
    const { state } = await this.#read()
    const landed = jcs(state) === u.text ||
      (u.actId !== undefined && Object.hasOwn(state.acts, u.actId) && state.acts[u.actId].commitSeq === u.commitSeq)
    this.#unsettled = null
    if (landed) this.#announce(u.commitSeq, u.events)
  }

  #announce (commitSeq: Dec, events: HolderEvent[]): void {
    for (const l of [...this.#listeners]) {
      // a listener's failure (throw or rejection) neither undoes nor blocks the commit
      try {
        const r: unknown = l({ commitSeq, events })
        if (r !== null && typeof r === 'object' && typeof (r as Promise<unknown>).then === 'function') (r as Promise<unknown>).then(undefined, () => undefined)
      } catch { /* dropped */ }
    }
  }

  // ── the four steps ───────────────────────────────────────────────────

  /** `input` is already bound (bindInput); `inputHash` its journal hash for human acts. */
  async #run (def: InternalDef, input: unknown, when: Millis, actId?: string, inputHash?: string): Promise<RunResult> {
    for (let attempt = 1; attempt <= this.#policy.commitAttempts; attempt++) {
      // 1 — snapshot, when
      const { state, version } = await this.#read()
      const at = Math.max(when, state.lastWhen)
      if (def.human && Object.hasOwn(state.acts, actId!)) {
        const rec = state.acts[actId!]
        if (rec.inputHash !== inputHash) return { ok: false, code: 'actid-conflict' }
        const live = rec.outboundDigests.filter((d) => { const t = triasOf(this.#itemOf(state, d)); return t !== 'delivered' && t !== 'failed' })
        const events: HolderEvent[] = structuredClone(rec.events) as HolderEvent[]
        return { ok: true, outbound: live.map((d) => this.#outboundOf(state, d)), events: freezeDeep(events) }
      }
      // 2 — prepare, bound to this snapshot
      const ctx: PrepareCtx = Object.freeze({
        snapshot: state, keys: this.#keys, entropy: this.#entropy, access: this.#access, log: this.#log,
        crypto: this.#crypto, when: at, release: releaseOf(state),
      })
      const value = def.prepare ? await def.prepare(ctx, input) : undefined
      const prepared: Prepared = Object.freeze({ value, version, commitSeq: state.commitSeq })
      // 3 — apply, assemble, CAS
      const r = def.apply(state, prepared, input, at)
      if (isHalt(r)) return r
      if (isRefusal(r)) return { ok: false, code: r.code, ...(r.ref !== undefined ? { ref: r.ref } : {}) }
      const drafts = r.outbound ?? []
      const eventDrafts = r.events ?? []
      const newDuties = r.duties ?? []
      const emit = r.emit ?? []
      const release = r.release ?? []
      // resume computes its own timer; every other operation names the duty
      // work it opened or unblocked, the app's cue to call resume
      const wake = r.nextDueAt ?? (def === this.#builtins.resume ? undefined : this.#wake(state, r.state, newDuties, at))
      const extra = { ...(wake !== undefined ? { nextDueAt: wake } : {}), ...(r.detail !== undefined ? { detail: r.detail } : {}) }
      if (!def.human && r.state === state && at === state.lastWhen && !drafts.length && !eventDrafts.length && !newDuties.length && !emit.length) {
        return { ok: true, outbound: [...release], events: [], ...extra }
      }
      const seq = inc(state.commitSeq)
      const events: HolderEvent[] = eventDrafts.map((e, i) => ({ ...e, eventId: `${seq}.${i}`, commitSeq: seq, ...(def.human ? { actId } : {}) }) as HolderEvent)
      freezeDeep(events)
      const outbound: Outbound[] = drafts.map((o) => ({ digest: o.digest, envelope: o.envelope, type: o.type, threadId: o.threadId, recipient: o.recipient, attempt: 1 }))
      const outbox: Record<string, OutboxItem> = { ...r.state.outbox }
      for (const o of outbound) {
        if (Object.hasOwn(outbox, o.digest)) throw new Error(`engine: outbound ${o.digest} is already in the outbox`)
        outbox[o.digest] = {
          type: o.type, threadId: o.threadId, recipient: o.recipient, envelope: o.envelope, attempt: 1,
          history: [{ status: 'submitted', at, attempt: 1 }], nextAttemptAt: dueAt(at, this.#policy.backoff(1)),
        }
      }
      const duties: Record<string, Duty> = { ...r.state.duties }
      for (const d of newDuties) {
        if (Object.hasOwn(duties, d.id)) throw new Error(`engine: duty ${d.id} already exists`)
        duties[d.id] = d
      }
      const acts = def.human
        ? { ...r.state.acts, [actId!]: { actId: actId!, inputHash: inputHash!, commitSeq: seq, outboundDigests: outbound.map((o) => o.digest), events, at } }
        : r.state.acts
      const next: HolderState = { ...r.state, commitSeq: seq, lastWhen: at, outbox, duties, acts }
      const text = encodeState(next)   // validates; an invalid next state is a programming error
      let res
      try { res = await this.#store.commit(version, toOpaque(next)) } catch (e) {
        this.#unsettled = { text, commitSeq: seq, events, ...(def.human ? { actId } : {}) }
        throw new InfraError('unknown-commit-outcome', undefined, { cause: e })
      }
      if (!res.ok) continue
      // 4 — release
      this.#announce(seq, events)
      return { ok: true, outbound: [...emit, ...release, ...outbound], events, ...extra }
    }
    throw new InfraError('commit-conflict', `no commit after ${this.#policy.commitAttempts} attempts`)
  }

  /** The work an operation opened or unblocked: its duty work (#dutyWake),
   *  or `when` where a sweep's pending keys gained one. */
  #wake (before: Readonly<HolderState>, after: Readonly<HolderState>, added: readonly Duty[], when: Millis): Millis | undefined {
    const d = this.#dutyWake(before, after, added, when)
    if (d === when || before === after) return d
    for (const sw of this.#sweeps.values()) {
      // a sweep whose declared inputs are untouched (by reference) cannot have new pending keys
      if (sw.reads && sw.reads.every((k) => before[k] === after[k])) continue
      const had = new Set(sw.pending(before, when))
      if (sw.pending(after, when).some((k) => !had.has(k))) return when
    }
    return d
  }

  /** The duty work an operation opened or unblocked: over the duties that
   *  are new, changed, or runnable now but not before, `when` where one
   *  is runnable now, else the earliest future dueAt; undefined where none. */
  #dutyWake (before: Readonly<HolderState>, after: Readonly<HolderState>, added: readonly Duty[], when: Millis): Millis | undefined {
    let wake: Millis | undefined
    for (const d of [...Object.values(after.duties), ...added]) {
      const h = this.#duties.get(d.kind)
      if (!h || d.v !== h.v) continue
      const prev = Object.hasOwn(before.duties, d.id) ? before.duties[d.id] : undefined
      const runnable = dutyRunnable(d, h, after, when)
      if (prev !== undefined && jcs(prev) === jcs(d) && (!runnable || dutyRunnable(prev, h, before, when))) continue
      const t = runnable ? when : dutyDue(d) > when ? dutyDue(d) : undefined
      if (t !== undefined) wake = wake === undefined ? t : Math.min(wake, t)
    }
    return wake
  }

  /** The failure handlers of the items `digests` (each just turned
   *  failed), in order, on `state`; their duties folded into the state. */
  #failed (state: HolderState, digests: readonly string[], when: Millis): { state: HolderState, events: EventDraft[] } {
    let cur = state
    const events: EventDraft[] = []
    for (const digest of digests) {
      const h = this.#failures.get(cur.outbox[digest].type)
      if (!h) continue
      const r = h(cur, digest, when)
      if (r.state.effects !== cur.effects) throw new Error(`engine: the failure handler of ${cur.outbox[digest].type} wrote the effect cache`)
      if (r.outbound?.length) throw new Error(`engine: the failure handler of ${cur.outbox[digest].type} issued documents; it opens duties`)
      cur = r.state
      events.push(...(r.events ?? []))
      if (r.duties?.length) {
        const duties = { ...cur.duties }
        for (const d of r.duties) if (!Object.hasOwn(duties, d.id)) duties[d.id] = d
        cur = { ...cur, duties }
      }
    }
    return { state: cur, events }
  }

  #itemOf (state: Readonly<HolderState>, digest: string): OutboxItem {
    if (!Object.hasOwn(state.outbox, digest)) throw new Error(`engine: journaled outbound ${digest} is missing from the outbox`)
    return state.outbox[digest]
  }

  #outboundOf (state: Readonly<HolderState>, digest: string): Outbound {
    const it = this.#itemOf(state, digest)
    return structuredClone({ digest, envelope: it.envelope, type: it.type, threadId: it.threadId, recipient: it.recipient, attempt: it.attempt })
  }

  // ── built-ins ────────────────────────────────────────────────────────

  #tickDef (): InternalDef {
    const policy = (): Policy => this.#policy
    const retainers = () => this.#retain
    return {
      human: false,
      apply (state, _p, _input, when) {
        const retention = policy().retentionMs
        let dropped = false
        const keep = <T>(rec: Record<string, T>, live: (x: T, key: string) => boolean): Record<string, T> => {
          const out: Record<string, T> = {}
          for (const [k, v] of Object.entries(rec)) { if (live(v, k)) out[k] = v; else dropped = true }
          return out
        }
        // effects leave with their acks (Delivery 4.2); prompts at expiry; the
        // act journal after the retention
        const effects = keep(state.effects, (x) => x.expiresAt > when)
        const prompts = keep(state.prompts, (x) => x.expiresAt === undefined || x.expiresAt > when)
        const acts = keep(state.acts, (x) => x.at + retention > when)
        // terminal outbox items, the retention after their last step, unless a
        // kept journal entry still answers with them (replay needs the item)
        const journaled = new Set(Object.values(acts).flatMap((a) => a.outboundDigests))
        const outbox = keep(state.outbox, (it, digest) => {
          const t = triasOf(it)
          if (t !== 'delivered' && t !== 'failed') return true
          const last = it.history.length ? it.history[it.history.length - 1].at : 0
          return last + retention > when || journaled.has(digest)
        })
        // addresses (Delivery §5): a key not shown for the retention, and the
        // own rkid of no live tuple, becomes a tombstone — its id alone, kept
        // forever; tombstones never shrink
        const live = new Set<string>()
        for (const r of Object.values(state.relationships)) for (const t of r.tuples) if (!t.deactivated) live.add(t.rkid)
        const tombstones = [...state.addresses.tombstones]
        const keys = keep(state.addresses.keys, (k, rkid) => {
          if (k.lastShown + retention > when || live.has(rkid)) return true
          if (!tombstones.includes(rkid)) tombstones.push(rkid)
          return false
        })
        let next: HolderState = dropped ? { ...state, effects, prompts, acts, outbox, addresses: { keys, tombstones } } : state as HolderState
        // the modules' own retention, on what the engine's left
        for (const r of retainers()) {
          const after = r(next, when)
          if (after.effects !== next.effects) throw new Error('engine: a module\'s retain wrote the effect cache')
          next = after
        }
        return { state: next }   // unchanged: the engine still commits a raised lastWhen
      },
    }
  }

  /** The duties a resume plans to run, in fixed order (dueAt, then id),
   *  and the registered kinds met at an unknown version. Each planned
   *  duty is checked again against the current state right before its
   *  handler runs (#resumeDef). */
  #dutyPlan (state: Readonly<HolderState>, when: Millis): { run: Array<{ duty: Duty, h: DutyHandler }>, unsupported: Duty[] } {
    const order = Object.values(state.duties).sort((a, b) => (dutyDue(a) - dutyDue(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const run: Array<{ duty: Duty, h: DutyHandler }> = []
    const unsupported: Duty[] = []
    for (const duty of order) {
      const h = this.#duties.get(duty.kind)
      if (!h) continue                                    // a kind no module here registers: kept, silent
      if (duty.v !== h.v) { unsupported.push(duty); continue }
      if (dutyRunnable(duty, h, state, when)) run.push({ duty, h })
    }
    return { run, unsupported }
  }

  #resumeDef (): InternalDef {
    const policy = (): Policy => this.#policy
    const plan = (state: Readonly<HolderState>, when: Millis) => this.#dutyPlan(state, when)
    const handlers = (): ReadonlyMap<string, DutyHandler> => this.#duties
    const sweeps = (): ReadonlyMap<string, SweepHandler> => this.#sweeps
    const failed = (st: HolderState, digests: readonly string[], when: Millis) => this.#failed(st, digests, when)
    return {
      human: false,
      // the due duties' and the sweeps' preparations, against the snapshot apply will see
      async prepare (ctx) {
        const values: Record<string, unknown> = {}
        for (const { duty, h } of plan(ctx.snapshot, ctx.when).run) if (h.prepare) values[duty.id] = await h.prepare(ctx, duty)
        const swept: Record<string, unknown> = {}
        for (const [name, sw] of sweeps()) swept[name] = await sw.prepare(ctx)
        return { duties: values, sweeps: swept }
      },
      apply (state, prepared, _input, when) {
        const p = policy()
        const outbox: Record<string, OutboxItem> = { ...state.outbox }
        const emit: Outbound[] = []
        const events: EventDraft[] = []
        const gaveUp: string[] = []
        let nextDueAt: Millis | undefined
        const due = (t: Millis): void => { nextDueAt = nextDueAt === undefined ? t : Math.min(nextDueAt, t) }
        // 1 — the outbox, by due time, then digest
        const order = Object.keys(state.outbox).sort((a, b) =>
          ((state.outbox[a].nextAttemptAt ?? 0) - (state.outbox[b].nextAttemptAt ?? 0)) || (a < b ? -1 : a > b ? 1 : 0))
        for (const digest of order) {
          const it = state.outbox[digest]
          const trias = triasOf(it)
          if (trias === 'delivered' || trias === 'failed') continue
          // the horizon applies to every non-terminal item: held, accepted or not
          const first = it.history.length ? it.history[0].at : when
          const expiry = Math.min(first + p.horizonMs, Number.MAX_SAFE_INTEGER)
          if (when >= expiry) {
            const { nextAttemptAt: _, ...rest } = it
            outbox[digest] = { ...rest, history: [...it.history, { status: 'failed', at: when, reason: 'expired-by-adapter-policy' }] }
            events.push({ type: 'delivery.status', digest, threadId: it.threadId, status: 'failed' })
            gaveUp.push(digest)
            continue
          }
          due(expiry)
          // never re-emitted: an accepted item (the service has it) and one the
          // adapter holds (awaiting-transport, until it reports again)
          if (trias === 'accepted' || it.history[it.history.length - 1]?.status === 'awaiting-transport') continue
          if (it.nextAttemptAt !== undefined && it.nextAttemptAt > when) { due(it.nextAttemptAt); continue }
          const attempt = it.attempt + 1
          const nextAttemptAt = dueAt(when, p.backoff(attempt))
          outbox[digest] = { ...it, attempt, nextAttemptAt, history: [...it.history, { status: 'submitted', at: when, attempt }] }
          emit.push(structuredClone({ digest, envelope: it.envelope, type: it.type, threadId: it.threadId, recipient: it.recipient, attempt }))
          due(nextAttemptAt)
        }
        // 2 — duties, in the plan's order, each on the state the one before
        // left and checked against it right before its handler: still there
        // at the handler's version, due, its awaited head still holding. A
        // prepared duty whose data changed since its preparation is deferred
        // to the next resume, which prepares it afresh (due at once)
        const { run, unsupported } = plan(state, when)
        for (const d of unsupported) events.push({ type: 'duty.unsupported', dutyId: d.id, kind: d.kind, v: d.v })
        // the outbox changed only by a re-emission or a give-up (an event so far)
        let cur: HolderState = !emit.length && !events.length ? state as HolderState : { ...state, outbox }
        // the failure handlers of the items given up, in the give-up's transaction
        if (gaveUp.length) { const f = failed(cur, gaveUp, when); cur = f.state; events.push(...f.events) }
        const drafts: OutboundDraft[] = []
        const duties: Duty[] = []
        // ran and stayed (not-due, refused): id → its record as it ran
        const kept = new Map<string, string>()
        const { duties: values, sweeps: swept } = prepared.value as { duties: Record<string, unknown>, sweeps: Record<string, unknown> }
        for (const { duty, h } of run) {
          if (!Object.hasOwn(cur.duties, duty.id)) continue                 // fulfilled or dropped meanwhile
          const now = cur.duties[duty.id]
          // another kind or version since the plan: the next resume dispatches it
          if (now.kind !== duty.kind || now.id !== duty.id || now.v !== h.v || !dutyRunnable(now, h, cur, when)) continue   // the final pass sets its timer
          if (h.prepare && jcs(now) !== jcs(duty)) continue                 // prepared on other data
          const r = h.apply(cur, now, Object.freeze({ prepared: Object.freeze({ value: values[duty.id], version: prepared.version, commitSeq: prepared.commitSeq }) }), when)
          if (r === 'not-due' || isRefusal(r)) { kept.set(duty.id, jcs(now)); continue }
          const left = { ...r.state.duties }
          delete left[duty.id]
          cur = { ...r.state, duties: left }
          drafts.push(...(r.outbound ?? []))
          events.push(...(r.events ?? []))
          duties.push(...(r.duties ?? []))
        }
        // 2b — the sweeps, on the state the duties left; a prepared piece
        // whose inputs moved is skipped and due again at once
        for (const [name, sw] of sweeps()) {
          const r = sw.apply(cur, Object.freeze({ value: swept[name], version: prepared.version, commitSeq: prepared.commitSeq }), when)
          if (r.state.effects !== cur.effects) throw new Error(`engine: the sweep ${name} wrote the effect cache`)
          cur = r.state
          drafts.push(...(r.outbound ?? []))
          events.push(...(r.events ?? []))
          duties.push(...(r.duties ?? []))
          if (r.deferred) due(when)
        }
        // work a sweep owes now but did not prepare: a divergence the outbox
        // step (a give-up at the horizon) or a duty of this resume created —
        // due at once, prepared by the next resume
        if (cur !== state) {
          for (const sw of sweeps().values()) {
            const had = new Set(sw.pending(state, when))
            if (sw.pending(cur, when).some((k) => !had.has(k))) { due(when); break }
          }
        }
        // the timer from the final duty set, new duties included: a future
        // dueAt, or `when` for work runnable now that did not run (deferred,
        // newly created, newly unblocked); a duty that ran and stayed
        // (not-due, refused) sets none while its record is unchanged since
        // its run — changed by a later duty, it counts like any other
        for (const d of [...Object.values(cur.duties), ...duties]) {
          const h = handlers().get(d.kind)
          if (!h || d.v !== h.v || kept.get(d.id) === jcs(d)) continue
          if (dutyDue(d) > when) due(dutyDue(d))
          else if (dutyRunnable(d, h, cur, when)) due(when)
        }
        // the duties' new documents enter the outbox in #run, due at backoff(1)
        if (drafts.length) due(dueAt(when, p.backoff(1)))
        // 3 — acks still unsent (a restart between the receive commit and the
        // send, or no report yet): re-offered byte-identical on the retry
        // policy, by effect digest; at the horizon marked sent by it
        const release: Outbound[] = []
        let effects: HolderState['effects'] | null = null
        for (const d of Object.keys(cur.effects).sort()) {
          const a = cur.effects[d].ack
          if (!a || a.sent) continue
          const expiry = Math.min(a.at + p.horizonMs, Number.MAX_SAFE_INTEGER)
          effects ??= { ...cur.effects }
          if (when >= expiry) {
            const { nextAttemptAt: _, ...rest } = a
            effects[d] = { ...cur.effects[d], ack: { ...rest, sent: true, sentBy: 'horizon' } }
            continue
          }
          due(expiry)
          if (a.nextAttemptAt !== undefined && a.nextAttemptAt > when) { due(a.nextAttemptAt); continue }
          const attempt = a.attempt + 1
          const nextAttemptAt = dueAt(when, p.backoff(attempt))
          effects[d] = { ...cur.effects[d], ack: { ...a, attempt, nextAttemptAt } }
          release.push(ackOutbound(a, attempt))
          due(nextAttemptAt)
        }
        if (effects && jcs(effects) !== jcs(cur.effects)) cur = { ...cur, effects }
        return {
          state: cur, emit, events, outbound: drafts, duties, release,
          ...(nextDueAt !== undefined ? { nextDueAt } : {}),
        }
      },
    }
  }

  #reportDef (): InternalDef {
    const failed = (st: HolderState, digests: readonly string[], when: Millis) => this.#failed(st, digests, when)
    return {
      human: false,
      apply (state, _p, report: DeliveryReport, when) {
        if (!Object.hasOwn(state.outbox, report.digest)) {
          // an ack (outbox-less): any report says the app handed it over
          const eff = Object.keys(state.effects).find((d) => state.effects[d].ack?.digest === report.digest)
          if (eff === undefined) return { ok: false, code: 'unknown-digest' }
          const e = state.effects[eff]
          if (e.ack!.sent) return { state: state as HolderState }
          const { nextAttemptAt: _, ...ack } = e.ack!
          return { state: { ...state, effects: { ...state.effects, [eff]: { ...e, ack: { ...ack, sent: true, sentBy: 'report' } } } } }
        }
        const it = state.outbox[report.digest]
        const trias = triasOf(it)
        const had = (s: OutboxStep['status']): boolean => it.history.some((x) => x.status === s)
        const same = { state: state as HolderState }
        let step: OutboxStep
        switch (report.status) {
          case 'awaiting-transport': {
            const last = it.history[it.history.length - 1]
            if (trias !== 'submitted') return same                                  // no step back before the trias
            if (last?.status === 'awaiting-transport' && last.reason === report.reason) return same
            step = { status: 'awaiting-transport', at: when, reason: report.reason }
            break
          }
          case 'accepted':
            if (had('accepted') || trias !== 'submitted') return same
            step = { status: 'accepted', at: when }
            break
          case 'delivered': {
            // lateness is the holder's own history: delivered after failed
            // (its own give-up or the adapter's) is late, whatever the flag says
            const m = markDelivered(state, report.digest, when)
            return m.event ? { state: { ...state, outbox: m.outbox }, events: [m.event] } : same
          }
          case 'failed':
            if (had('failed') || trias === 'delivered') return same
            step = report.reason === 'rejected-by-receiver'
              ? { status: 'failed', at: when, reason: report.reason, code: report.code }
              : { status: 'failed', at: when, reason: report.reason }
            break
          default:
            throw new TypeError(`unknown report status ${String((report as { status?: unknown }).status)}`)
        }
        const base = step.status === 'awaiting-transport' ? it : (({ nextAttemptAt: _, ...rest }) => rest)(it)
        const outbox = { ...state.outbox, [report.digest]: { ...base, history: [...it.history, step] } }
        const events: EventDraft[] = step.status === 'awaiting-transport' ? [] : [{
          type: 'delivery.status', digest: report.digest, threadId: it.threadId, status: step.status,
        }]
        if (step.status === 'failed') {
          const f = failed({ ...state, outbox }, [report.digest], when)
          return { state: f.state, events: [...events, ...f.events] }
        }
        return { state: { ...state, outbox }, events }
      },
    }
  }

  #receiveDef (): InternalDef {
    const tasks = (): ReadonlyMap<string, TaskHandler> => this.#tasks
    const acks = (): ReadonlyMap<string, AckHandler> => this.#acks
    const policy = (): Policy => this.#policy
    return {
      human: false,
      prepare: (ctx, env) => prepareReceive(ctx, env, tasks()),
      apply (state, prepared, _env, when) {
        const plan = prepared.value as ReceivePlan
        const cached = (ack: Effect['ack']): Effect => ({ ack, expiresAt: Math.min(when + policy().retentionMs, Number.MAX_SAFE_INTEGER) })
        switch (plan.kind) {
          case 'failed': return { halt: true, detail: plan.result }
          case 'duplicate': {
            // the stored ack, byte-identical; a terminal document has none
            // (its outbound attempt is one past the schedule's, which it does not move)
            const a = state.effects[plan.digest].ack
            return { state: state as HolderState, release: a ? [ackOutbound(a, a.attempt + 1)] : [], detail: { disposition: 'duplicate-known', digest: plan.digest } }
          }
          case 'ack': {
            // terminal: the sender-status update and its cache entry, no ack;
            // the issuing module's ack handler runs in the same transaction
            const m = markDelivered(state, plan.ref, when)
            let next: HolderState = { ...state, outbox: m.outbox }
            const events: EventDraft[] = m.event ? [m.event] : []
            const h = acks().get(state.outbox[plan.ref].type)
            if (h) {
              const r = h(next, plan.ref, when)
              if (r.state.effects !== next.effects) throw new Error(`engine: the ack handler of ${state.outbox[plan.ref].type} wrote the effect cache`)
              next = r.state
              events.push(...(r.events ?? []))
            }
            return {
              state: { ...next, effects: { ...next.effects, [plan.digest]: cached(null) } },
              events,
              detail: { disposition: 'unique', digest: plan.digest, type: ACK_TYPE },
            }
          }
          case 'task': {
            const h = tasks().get(plan.type)!
            const r = h.apply(state, handlerPrepared(prepared, plan.value), plan.doc, plan.arrival)
            if (isTaskRefusal(r)) return { halt: true, detail: { disposition: 'failed', reason: r.reason, stage: 9, digest: plan.digest, ...(r.ref !== undefined ? { ref: r.ref } : {}) } }
            if (isTaskDiscarded(r)) {
              // a resource-limit discard: its state commits; no cache entry, no ack
              if (r.state.effects !== state.effects) throw new Error(`engine: the handler of ${plan.type} wrote the effect cache`)
              return { state: r.state, detail: { disposition: 'discarded', digest: plan.digest, type: plan.type, reason: r.reason, ...(r.ref !== undefined ? { ref: r.ref } : {}) } }
            }
            if (r.state.effects !== state.effects) throw new Error(`engine: the handler of ${plan.type} wrote the effect cache; the core writes it`)
            return {
              state: { ...r.state, effects: { ...state.effects, [plan.digest]: cached({ ...plan.ack, at: when, attempt: 1, nextAttemptAt: dueAt(when, policy().backoff(1)), sent: false }) } },
              ...(r.outbound ? { outbound: r.outbound } : {}),
              ...(r.events ? { events: r.events } : {}),
              ...(r.duties ? { duties: r.duties } : {}),
              release: [ackOutbound(plan.ack, 1)],
              detail: { disposition: 'unique', digest: plan.digest, type: plan.type },
            }
          }
        }
      },
    }
  }

  // ── public surface ───────────────────────────────────────────────────

  act (command: string, input: unknown, when: Millis, opts: { actId?: string } = {}): Promise<ActResult> {
    let def: InternalDef | undefined
    let bound: unknown
    let hash: Promise<string> | undefined
    let actId: string | undefined
    try {
      def = this.#commands.get(command)
      if (!def) throw new Error((BUILTIN as readonly string[]).includes(command) ? `${command} is built in: call engine.${command}()` : `unknown command ${command}`)
      checkWhen(when)
      actId = def.human ? opts.actId : undefined
      if (def.human && (typeof actId !== 'string' || actId === '')) return Promise.resolve({ ok: false, code: 'actid-missing' })
      // bound here, synchronously: later changes by the caller reach nothing
      bound = bindInput(input)
      if (def.human) {
        hash = digestOf(this.#crypto.subtle, { command, input: bound })
        hash.catch(() => undefined)   // awaited in the queue; no unhandled rejection meanwhile
      }
    } catch (e) { return Promise.reject(e) }
    const d = def
    return this.#enqueue(async () => {
      return actResult(await this.#run(d, bound, when, actId, hash === undefined ? undefined : await hash))
    })
  }

  tick (when: Millis): Promise<ActResult> {
    try { checkWhen(when) } catch (e) { return Promise.reject(e) }
    return this.#enqueue(async () => {
      return actResult(await this.#run(this.#builtins.tick, null, when))
    })
  }

  resume (when: Millis): Promise<ResumeResult> {
    try { checkWhen(when) } catch (e) { return Promise.reject(e) }
    return this.#enqueue(async () => {
      const r = await this.#run(this.#builtins.resume, null, when)
      if (isHalt(r) || !r.ok) throw new Error('engine: resume does not refuse')
      return { outbound: r.outbound, events: r.events, ...(r.nextDueAt !== undefined ? { nextDueAt: r.nextDueAt } : {}) }
    })
  }

  report (report: DeliveryReport, when: Millis): Promise<ActResult> {
    let bound: DeliveryReport
    try { checkWhen(when); bound = bindInput(report) } catch (e) { return Promise.reject(e) }
    return this.#enqueue(async () => {
      return actResult(await this.#run(this.#builtins.report, bound, when))
    })
  }

  receive (env: unknown, when: Millis): Promise<ReceiveResult> {
    try { checkWhen(when) } catch (e) { return Promise.reject(e) }
    // bound at the call like any input; what is not JSON is no envelope
    let bound: unknown
    try { bound = bindInput(env) } catch { bound = null }
    return this.#enqueue(async () => {
      const r = await this.#run(this.#builtins.receive, bound, when)
      if (isHalt(r)) return r.detail as ReceiveResult
      if (!r.ok) throw new Error('engine: receive does not refuse')
      const d = r.detail as { disposition: 'unique' | 'duplicate-known' | 'discarded', digest: string, type?: string, reason?: 'resource-limit' | 'rejected', ref?: string }
      if (d.disposition === 'discarded') return { disposition: 'discarded', digest: d.digest, type: d.type!, reason: d.reason!, ...(d.ref !== undefined ? { ref: d.ref } : {}) }
      return d.disposition === 'unique'
        ? { disposition: 'unique', digest: d.digest, type: d.type!, outbound: r.outbound, events: r.events, ...(r.nextDueAt !== undefined ? { nextDueAt: r.nextDueAt } : {}) }
        : { disposition: 'duplicate-known', digest: d.digest, outbound: r.outbound }
    })
  }

  subscribe (listener: CommitListener): () => void {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function')
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  snapshot (): Promise<EngineSnapshot> {
    return this.#enqueue(async () => {
      const { state } = await this.#read()
      return Object.freeze({ state, commitSeq: state.commitSeq })
    })
  }
}

/**
 * Build an engine over the ports and modules: resolves and probes
 * WebCrypto, freezes the registries (duplicate command names, task URIs
 * or duty kinds throw), and initialises an empty store with the empty
 * state at the current codec.
 */
export async function createEngine (ports: EnginePorts, modules: readonly HolderModule[]): Promise<Engine> {
  if (!ports?.store || !ports.keys) throw new TypeError('createEngine needs a store and keys')
  const crypto = await resolveCrypto(ports.crypto)
  const engine = new HolderEngine(ports, crypto, modules)
  await engine.load()
  return engine
}
