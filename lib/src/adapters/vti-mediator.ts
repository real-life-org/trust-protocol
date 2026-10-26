// RLTP transport adapter: VTI mediator — published as
// @real-life/trust-protocol/adapters/vti-mediator (lib Stage 2, note §4.6).
//
// It takes the holder's documents from the holder's custody (Delivery 0.84
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
// Profile: spec/adapter-vti-mediator.md v0.26 (twenty-sixth casting;
// §1c, the displayed card's instance, is the host's and the wire's, not this module's;
// round journals under design/adapter-review*). A
// transport adapter contract — NOT a carrier at the port. The
// counterpart's connection DID and egress identity the wire needs come
// from the counterpart's delivery hint in the card that opened the
// relationship (profile §1b); the holder hands the hints on uninterpreted
// (RelationshipView.counterpartDeliveryHints) and this adapter derives its
// own trio from the relationship's carrier nonce (RelationshipView.carrierNonce).
//
// Sending form (profile §3a, lib 0.7.0): every deposit names its mode to
// the wire. Mode `routed` (the mode of every instance from construction):
// an inner TSP `direct` message egress identity → counterpart's
// connection DID inside an outer routed message connection DID → C with
// the route [counterpart's connection DID], on the connection DID's
// session. Mode `egress-session` (fallback): the inner message alone, on
// a send-only session of the egress identity. The wire packs the layers
// (depositAddressing says who addresses whom); the adapter keeps the
// relationship's send state (the mode and the open routed deposits) in
// its ack state (RLTP-VTI-3130). Open are: every document with a digest
// (an entry of kind `document` filed by reconcile) accepted in routed and
// not yet answered — a valid acknowledgement, a validated refusal or a
// validated idConflict for its digest answers it. Acknowledgements are
// no open deposits: a side that only acknowledges never switches by the
// deadline (Open Issue 9). The adapter switches one way to
// `egress-session` when an open deposit is routed-ack-deadline (72 h)
// old, checked in an advance after a conclusion that left nothing
// pending and while nothing is pending again — "nothing pending" is the
// binding's statement through queueEmpty() (RLTP-VTI-7150); without it
// the adapter never switches — and at once on a
// validated refusal of the routed form (WireError 'routed-refused').
// At the switch the open deposits leave; nothing returns to routed. A
// submit() without a digest opens nothing. An attempt
// ends in the mode it began in; an accepted submission is never
// deposited again (RLTP-VTI-3135, 7130).
//
// The app's transport contract (web-of-trust TRANSPORT.md, rules 5 and
// 6), as far as it holds here: (5) a withdrawal — reconcile without the
// entry — means the adapter starts no deposit for that submission
// afterwards, and an outcome that resolves late changes nothing here
// (has() false, report() null, no send state) — except a validated refusal
// of the routed form, which switches the relationship (a finding about the
// mediator, RLTP-VTI-3130). A wire call already
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

import { jcs } from '../core.js'
import type { Json } from '../core.js'
import { anchorOfEd, edRawOfAnchor, sha } from '../crypto.js'
import { carrierPrincipal, carrierScopedIdentity } from '../carrier-identity.js'
import type { CarrierPrincipal, CarrierScopedIdentity } from '../carrier-identity.js'
import type { DeliveryReport, ReceiverRefusalCode, SubmissionRef } from '../ports.js'
import type { TransportEntry, TransportView } from '../engine.js'
import type { ReceiveResult } from '../results.js'
export type { ReceiverRefusalCode } from '../ports.js'

// ── Declared constants (profile §2) — promises of THIS casting ──────
// frozen: the declared promises cannot be changed at run time either
export const DECLARED = Object.freeze({
  giveUpHorizonMs: 72 * 3_600_000,
  statusHorizonMs: 60_000,
  queueFloorCount: 64,
  queueFloorBytes: 1_048_576,
  maxQueueBytes: 16_777_216,
  duplicateWindowMs: 30 * 86_400_000,
  routedAckDeadlineMs: 72 * 3_600_000,
} as const)

// ── The delivery hint (profile §1b) ──────────────────────────────────
// Below the port line: the holder carries hints uninterpreted; this
// adapter builds its own and reads the counterpart's.

/** The counterpart's wire identities at one carrier, as its hint names them. */
export interface DeliveryHintIdentities { connectionDid: string, egressDid: string, carrier: string }

const HINT_MEMBERS = jcs(['id', 'rltpEgress', 'serviceEndpoint', 'type'])
/** An Ed25519 did:key in the form RLTP-VTI-1210 fixes: `did:key:z` and the
 *  base58btc of multicodec 0xed01 followed by the 32-byte key, rendered
 *  canonically (decoding and re-encoding gives the same string). */
const edDidKey = (x: unknown): x is string => {
  // the canonical form has exactly 56 characters; checked first, so no long input reaches the base58 decoder
  if (typeof x !== 'string' || x.length !== 56) return false
  const raw = edRawOfAnchor(x)
  return raw !== null && anchorOfEd(raw) === x
}

/** This side's hint for carrier `C` in the relationship of carrier nonce
 *  `N` (RLTP-VTI-1210, 1215): the connection DID and the egress identity
 *  derived here from (root, `C`, `N`), exactly as the factory derives the
 *  instance's trio — derived, not supplied, so the two cannot come from
 *  different relationships — as the JCS form of the TSPTransport service
 *  entry naming the connection DID (`id`, with `#tsp`), `C`
 *  (`serviceEndpoint`) and the egress identity (`rltpEgress`). */
export async function deliveryHint (rootIkm: Uint8Array, carrier: string, nonce: Uint8Array): Promise<string> {
  // snapshot at entry, as create does (R8-B2): a caller's buffer changed
  // between the two derivations must not couple two relationships
  const ikm = new Uint8Array(rootIkm)
  const n = new Uint8Array(nonce)
  const connection = await carrierScopedIdentity(ikm, carrier, n, 'connection')
  const egress = await carrierScopedIdentity(ikm, carrier, n, 'egress')
  return jcs({ id: connection.did + '#tsp', type: 'TSPTransport', serviceEndpoint: carrier, rltpEgress: egress.did })
}

/** One hint read strictly (RLTP-VTI-1210, 1220) for carrier `C`: JSON,
 *  byte-equal to its JCS form, exactly the four members, type
 *  TSPTransport, an `id` ending in `#tsp`, both identities distinct
 *  canonical Ed25519 did:key, `serviceEndpoint` byte-equal to `C`.
 *  Total (RLTP-VTI-1220): any other input — not a string, not JSON, no JCS
 *  form (a lone surrogate), any other shape — is null, ignored; it never
 *  throws. */
export function readDeliveryHint (hint: unknown, carrier: unknown): DeliveryHintIdentities | null {
  try {
    return readStrict(hint, carrier)
  } catch {
    return null
  }
}

function readStrict (hint: unknown, carrier: unknown): DeliveryHintIdentities | null {
  if (typeof hint !== 'string' || typeof carrier !== 'string' || carrier.length === 0) return null
  const o: unknown = JSON.parse(hint)
  if (o === null || typeof o !== 'object' || Array.isArray(o) || jcs(o as Json) !== hint) return null
  const e = o as Record<string, unknown>
  if (jcs(Object.keys(e).sort()) !== HINT_MEMBERS || e.type !== 'TSPTransport' || e.serviceEndpoint !== carrier) return null
  if (typeof e.id !== 'string' || !e.id.endsWith('#tsp')) return null
  const connectionDid = e.id.slice(0, -'#tsp'.length)
  if (!edDidKey(connectionDid) || !edDidKey(e.rltpEgress) || connectionDid === e.rltpEgress) return null
  return { connectionDid, egressDid: e.rltpEgress, carrier }
}

/** The counterpart's wire identities at `C` from the hints of the card
 *  that opened the relationship, read by the side `self` (its own
 *  connection DID and egress identity of this relationship and carrier):
 *  every hint read as readDeliveryHint does; a hint naming one of `self`'s
 *  identities is ignored (RLTP-VTI-1227); of what remains, the one hint
 *  for `C` (RLTP-VTI-1225, 1240) — none, or more than one, is null: the
 *  relationship is not carried at `C` (RLTP-VTI-1235). Total: any input
 *  answers null or the identities, never a throw; without a well-formed
 *  `self` nothing is read. */
export function readDeliveryHints (hints: unknown, carrier: unknown, self: unknown): DeliveryHintIdentities | null {
  try {
    if (!Array.isArray(hints)) return null
    const me = self as { connection?: unknown, egress?: unknown } | null
    if (me === null || typeof me !== 'object' || !edDidKey(me.connection) || !edDidKey(me.egress)) return null
    const own = new Set<string>([me.connection, me.egress])
    const read = hints.map((h) => readDeliveryHint(h, carrier))
      .filter((x): x is DeliveryHintIdentities => x !== null && !own.has(x.connectionDid) && !own.has(x.egressDid))
    return read.length === 1 ? read[0] : null
  } catch {
    return null
  }
}

// ── Counterpart refusals (profile §5, RLTP-VTI-5010 to 5030) ──────────
// A counterpart that refuses a document answers with the registry's
// trust-task-error/0.5. Read here, by form; validating the document (its
// proof, its parties, that it answers a document of this side) is the
// delivery layer's, which hands the reading to receiverRefused,
// receiverRetry or answered.

/** The Type URI of the error documents this profile reads. */
export const TRUST_TASK_ERROR_TYPE = 'https://trusttasks.org/spec/trust-task-error/0.5'

/** What an error document says to this side (RLTP-VTI-5010 to 5030):
 *  a terminal verdict with its code; a retry, not before `retryAfter`
 *  (milliseconds, or null); an answer (`idConflict`); or nothing the port
 *  carries (`expired`). */
export type TrustTaskErrorReading =
  | { verdict: 'refused', code: ReceiverRefusalCode }
  | { verdict: 'retry', retryAfter: number | null }
  | { verdict: 'answered' }
  | { verdict: 'none' }

const ERROR_MEMBERS = new Set(['code', 'retryable', 'inResponseTo', 'message', 'retryAfter', 'details'])
const STANDARD_ERROR_CODES = new Set(['malformedRequest', 'unsupportedType', 'unsupportedVersion', 'expired', 'proofRequired', 'proofInvalid',
  'permissionDenied', 'wrongRecipient', 'identityMismatch', 'idConflict', 'cancelled', 'taskFailed', 'unavailable', 'internalError'])
const EXTENDED_ERROR_CODE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*(\/[a-z][a-z0-9]*(-[a-z0-9]+)*)*:[a-z][a-zA-Z0-9_]*$/
const RFC3339 = /^([0-9]{4})-([0-9]{2})-([0-9]{2})[Tt]([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]+)?([Zz]|([+-])([0-9]{2}):([0-9]{2}))$/

/** An RFC 3339 date-time as milliseconds, or null: as RFC 3339 allows it
 *  (§5.6: `t` and `z` in either case, a leap second `:60`, any offset),
 *  calendar-valid, never normalized into another day. A leap second
 *  reads as the next second. */
function rfc3339 (t: unknown): number | null {
  if (typeof t !== 'string') return null
  const m = RFC3339.exec(t)
  if (m === null) return null
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number)
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 60) return null
  const day = new Date(Date.UTC(y, mo - 1, d))
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) return null
  let offsetMin = 0
  if (m[9] !== undefined) {
    const oh = Number(m[10]), om = Number(m[11])
    if (oh > 23 || om > 59) return null
    offsetMin = (m[9] === '-' ? -1 : 1) * (oh * 60 + om)
  }
  const frac = m[7] === undefined ? 0 : Math.floor(Number('0' + m[7]) * 1000)
  const ms = Date.UTC(y, mo - 1, d, h, mi, s, frac) - offsetMin * 60_000
  return Number.isFinite(ms) ? ms : null
}

/** One counterpart error document read by its form (registry
 *  trust-task-error/0.5): `type` exactly TRUST_TASK_ERROR_TYPE, a payload
 *  with exactly the registry's members, `code` a standard or an extended
 *  code, `retryable` a boolean, `retryAfter` an RFC 3339 date-time,
 *  `message` at most 1024 characters, `inResponseTo` with a `typeUri`,
 *  `details` an object. `idConflict` is an answer (RLTP-VTI-5030);
 *  otherwise `retryable: true` is a retry, whatever the code (5010);
 *  `retryable: false` is a terminal verdict, an extended code and the
 *  retryable codes read as `taskFailed` (5020); `expired` carries nothing.
 *  Total, like the hint reader: any other input is null, never a throw. */
export function readTrustTaskError (doc: unknown): TrustTaskErrorReading | null {
  try {
    return readErrorStrict(doc)
  } catch {
    return null
  }
}

function readErrorStrict (doc: unknown): TrustTaskErrorReading | null {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return null
  const d = doc as Record<string, unknown>
  if (d.type !== TRUST_TASK_ERROR_TYPE) return null
  const p = d.payload
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return null
  const e = p as Record<string, unknown>
  if (Object.keys(e).some((k) => !ERROR_MEMBERS.has(k))) return null
  const { code, retryable } = e
  if (typeof code !== 'string' || typeof retryable !== 'boolean') return null
  const extended = !STANDARD_ERROR_CODES.has(code)
  if (extended && !EXTENDED_ERROR_CODE.test(code)) return null
  if ('message' in e && (typeof e.message !== 'string' || e.message.length > 1024)) return null
  if ('details' in e && (e.details === null || typeof e.details !== 'object' || Array.isArray(e.details))) return null
  if ('inResponseTo' in e) {
    const r = e.inResponseTo
    if (r === null || typeof r !== 'object' || Array.isArray(r)) return null
    const ri = r as Record<string, unknown>
    if (Object.keys(ri).some((k) => k !== 'typeUri' && k !== 'id') || typeof ri.typeUri !== 'string' || ri.typeUri.length === 0) return null
    if ('id' in ri && (typeof ri.id !== 'string' || ri.id.length === 0)) return null
  }
  let retryAfter: number | null = null
  if ('retryAfter' in e) {
    retryAfter = rfc3339(e.retryAfter)
    if (retryAfter === null) return null
  }
  if (code === 'idConflict') return { verdict: 'answered' }
  if (retryable) return { verdict: 'retry', retryAfter }
  if (code === 'expired') return { verdict: 'none' }
  if (extended || code === 'unavailable' || code === 'internalError') return { verdict: 'refused', code: 'taskFailed' }
  return { verdict: 'refused', code: code as ReceiverRefusalCode }
}

// ── The sending form (profile §3a) ───────────────────────────────────
/** How a deposit reaches the mediator (RLTP-VTI-3110, 3120). */
export type SendMode = 'routed' | 'egress-session'
const SEND_MODES: ReadonlySet<string> = new Set<SendMode>(['routed', 'egress-session'])

/** One TSP layer's addressing (no keys, no bytes: those are the wire's). */
export interface LayerAddressing {
  messageType: 'direct' | 'routed'
  sender: string
  receiver: string
  route?: string[]
}

/** The addressing of a deposit in `mode` (RLTP-VTI-1110, 1120, 3110,
 *  3115, 3120): the inner `direct` message from this side's egress
 *  identity to the counterpart's connection DID; in mode `routed` an
 *  outer routed message from this side's connection DID to the carrier
 *  `C` with the route [counterpart's connection DID], deposited on the
 *  connection DID's session; in mode `egress-session` no outer layer,
 *  deposited on the egress identity's send-only session. */
export function depositAddressing (
  mode: SendMode, self: { connection: string, egress: string }, peerConnection: string, carrier: string,
): { inner: LayerAddressing, outer: LayerAddressing | null, session: string } {
  if (!SEND_MODES.has(mode)) throw new Error(`unknown send mode ${String(mode)}`)
  const inner: LayerAddressing = { messageType: 'direct', sender: self.egress, receiver: peerConnection }
  if (mode === 'routed') {
    return {
      inner,
      outer: { messageType: 'routed', sender: self.connection, receiver: carrier, route: [peerConnection] },
      session: self.connection,
    }
  }
  return { inner, outer: null, session: self.egress }
}

// ── The injected wire ────────────────────────────────────────────────
export type WireErrorKind =
  | 'unreachable' | 'refused-retriable' | 'refused-admission' | 'oversize'
  /** the mediator refused a routed deposit for its routed form, and the
   *  binding authenticated that refusal as the mediator's (RLTP-VTI-3130):
   *  the relationship switches to egress-session at once */
  | 'routed-refused'

export class WireError extends Error {
  kind: WireErrorKind
  constructor (kind: WireErrorKind, message?: string) {
    super(message ?? kind)
    this.kind = kind
  }
}

export interface MediatorWire {
  authChallenge (did: string): Promise<{ challenge: string, sessionId: string }>
  authenticate (answer: { did: string, challenge: string, sessionId: string }): Promise<TokenSet>
  // A transient failure MUST be a WireError 'unreachable' or
  // 'refused-retriable' (the tokens are kept); any other error means the
  // mediator refused the refresh token (the adapter re-runs the handshake).
  refresh (refreshToken: string): Promise<TokenSet>
  keylistUpdate (accessToken: string, rkids: string[]): Promise<void>
  /** `mode` is the sending form of this deposit (profile §3a): the wire
   *  packs and sends it as depositAddressing(mode, …) describes. */
  deposit (accessToken: string, bytes: Uint8Array, egressDid: string, mode: SendMode): Promise<void>
  ackReceived (accessToken: string, queueIds: string[]): Promise<void>
  /** The adapter's consumer answers whether it took the frame (buffered,
   *  already held, or absorbed as a duplicate): false means the frame is
   *  left with the mediator (above max-queue-bytes, or a retired
   *  instance), and a wire must not take its queue for drained until the
   *  frame is offered again (RLTP-VTI-3130, queueEmpty). */
  onDeliver (cb: (bytes: Uint8Array) => Promise<boolean>): void
  /** Optional truthful connectivity signal; absent means unknown. */
  offline? (): boolean
  /** Optional: true when the mediator holds nothing more for this
   *  connection (RLTP-VTI-3130: a conclusion that left no frame
   *  pending). Closed: absent, no collection counts as complete, so an
   *  adapter over a wire without it never switches to egress-session. */
  queueEmpty? (): boolean
}

export interface TokenSet {
  accessToken: string
  accessExpiresAt: number
  refreshToken: string
  refreshExpiresAt: number
}

// ── Sender states (§6.1 — the closed sets, nothing else) ────────────
// ReceiverRefusalCode is the ports' (one closed set, one place)
const RECEIVER_REFUSAL_CODES: ReadonlySet<ReceiverRefusalCode> = new Set<ReceiverRefusalCode>([
  'malformedRequest', 'unsupportedType', 'unsupportedVersion',
  'proofRequired', 'proofInvalid', 'permissionDenied',
  'wrongRecipient', 'identityMismatch', 'cancelled', 'taskFailed',
])

export type SubmissionState =
  | { state: 'awaiting-transport', reason: 'offline' | 'transport-unreachable' | 'carrier-refused-retriable' }
  | { state: 'accepted' }
  | { state: 'delivered', late: boolean }
  | { state: 'failed', reason: 'unroutable' | 'oversize' | 'expired-by-adapter-policy' }
  | { state: 'failed', reason: 'rejected-by-receiver', code: ReceiverRefusalCode }

/** The ports' DeliveryReport for a document `digest` in adapter state `st`
 *  (Delivery §6.1): one-to-one, `late` and the refusal code carried over. */
export function deliveryReportOf (digest: string, st: SubmissionState): DeliveryReport {
  switch (st.state) {
    case 'awaiting-transport': return { digest, status: 'awaiting-transport', reason: st.reason }
    case 'accepted': return { digest, status: 'accepted' }
    case 'delivered': return { digest, status: 'delivered', late: st.late }
    case 'failed': return st.reason === 'rejected-by-receiver'
      ? { digest, status: 'failed', reason: 'rejected-by-receiver', code: st.code }
      : { digest, status: 'failed', reason: st.reason }
  }
}

/** Whether a receive outcome is terminal and its item may be concluded
 *  (Delivery 5a.8): every disposition but `failed(rate-limited)`, the one
 *  failure that is transient (RLTP-DEL-5820). An InfraError of the
 *  holder's store is transient as well (RLTP-DEL-5810): an item whose
 *  receive threw is kept, too. */
export function concludable (r: ReceiveResult): boolean {
  return !(r.disposition === 'failed' && r.reason === 'rate-limited')
}

/** The adapter's own copy of a wire's token set: the wire keeps no handle on it. */
const tokenCopy = (t: TokenSet): TokenSet => ({ accessToken: t.accessToken, accessExpiresAt: t.accessExpiresAt, refreshToken: t.refreshToken, refreshExpiresAt: t.refreshExpiresAt })

export interface CollectedItem { bytes: Uint8Array, queueId: string }
export interface Collection { id: string, items: CollectedItem[] }

/** Ack state for the host to persist (profile §4). Invariant: every
 *  pending id names a concluded entry; violations are refused at
 *  construction (fail-closed). */
export interface AckState {
  concluded: Array<{ queueId: string, concludedAt: number }>
  pending: string[]
  /** the relationship's send state (RLTP-VTI-3130); absent → `routed` */
  send?: SendState
}

/** The send state of a relationship (profile §3a, RLTP-VTI-3130),
 *  persisted with the ack state: the mode and the open routed deposits —
 *  this side's documents accepted in routed and not yet answered, each
 *  with its digest and acceptance instant. Acknowledgements are no open
 *  deposits. In egress-session `open` is empty. */
export interface SendState {
  mode: SendMode
  open: Array<{ digest: string, acceptedAt: number }>
}

/** how long an open routed deposit stays in the send state at most
 *  (RLTP-VTI-3130): the state is bounded even where no switch check runs */
const OPEN_KEEP_MS = DECLARED.routedAckDeadlineMs + DECLARED.duplicateWindowMs

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

/** A restored send state, checked fail-closed (§4): exactly `mode` and
 *  `open`, a known mode, each entry exactly a digest and a finite
 *  acceptance instant not after restoredAt, each digest once, nothing open
 *  in egress-session. Any other field — the acknowledgement fields of an
 *  earlier form included — is refused, not ignored. */
function restoreSendState (send: unknown, restoredAt: number): SendState {
  const refuse = (why: string): never => { throw new Error(`ack snapshot: send state ${why}`) }
  if (typeof send !== 'object' || send === null) return refuse('is not an object')
  const s = send as Record<string, unknown>
  const exactly = (o: object, keys: string[]): boolean => {
    const own = Object.keys(o)
    return own.length === keys.length && keys.every((k) => own.includes(k))
  }
  if (!exactly(s, ['mode', 'open'])) refuse('has other fields than mode and open')
  if (typeof s.mode !== 'string' || !SEND_MODES.has(s.mode)) refuse('names an unknown mode')
  if (!Array.isArray(s.open)) refuse('open deposits are not a list')
  const open = (s.open as unknown[]).map((r) => {
    const e = r as Record<string, unknown> | null
    if (typeof e !== 'object' || e === null || !exactly(e, ['digest', 'acceptedAt']) ||
        typeof e.digest !== 'string' || !finite(e.acceptedAt) || e.acceptedAt > restoredAt) {
      return refuse('open deposit is malformed, non-finite or accepted after restoredAt')
    }
    return { digest: e.digest, acceptedAt: e.acceptedAt }
  })
  if (new Set(open.map((o) => o.digest)).size !== open.length) refuse('names an open deposit twice')
  // the switch empties it: an egress-session with open deposits was never produced
  if (s.mode === 'egress-session' && open.length > 0) refuse('is egress-session with open routed deposits')
  return { mode: s.mode as SendMode, open }
}

/** The holder's side of a hand-over (lib 0.6.0): the holder itself.
 *  handOver checks the entry and calls `start` inside the holder's queue;
 *  `start` re-checks the adapter's own state, starts the deposit
 *  synchronously and says whether it did. `closed` is read in `start`. */
export interface TransportGate {
  handOver (entry: TransportEntry, when: number, start: () => boolean): Promise<boolean>
  readonly closed?: boolean
}

interface Submission {
  id: string
  /** the document digest, for submissions filed by reconcile */
  digest?: string
  /** the holder's entry and its gate, for submissions filed by reconcile */
  entry?: TransportEntry
  gate?: TransportGate
  bytes: Uint8Array
  submittedAt: number
  attemptStartedAt: number | null
  lastKind: WireErrorKind | null
  st: SubmissionState | null   // null = no honest report exists yet
  /** the mode of the last deposit call started for it (RLTP-VTI-3135) */
  sentMode: SendMode | null
  /** a verdict on it arrived: its digest is never opened after it */
  answered?: boolean
  /** a counterpart's retryAfter: no attempt before it (RLTP-VTI-5010) */
  notBefore?: number
}

const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

// construction capability: only create() holds it
const KEY = Symbol('MediatorCarrierAdapter.create')

// ── The adapter ──────────────────────────────────────────────────────
export class MediatorCarrierAdapter {
  // JS-hard identity fields: TS `readonly` is a compile-time promise
  // only, and §8 claims runtime unforgeability — so the values live
  // in true privates behind getters (R8-B1)
  #principal: string
  #connectionDid: string
  #egressDid: string
  get principal (): string { return this.#principal }
  get connectionDid (): string { return this.#connectionDid }
  get egressDid (): string { return this.#egressDid }
  #wire: MediatorWire
  #tokens: TokenSet | null = null
  #clock = Number.NEGATIVE_INFINITY
  #closed = false
  /** the opening this adapter serves, bound at its first reconcile */
  #gate: TransportGate | null = null

  #subs = new Map<string, Submission>()
  #inflight = new Set<Promise<void>>()
  #nextId = 1

  #desiredRkids: string[] | null = null
  #keylistSynced = false
  #keylistSyncing = false

  #inbox: CollectedItem[] = []
  #inboxBytes = 0
  #inboxDigests = new Set<string>()
  #outstanding = new Map<string, Map<string, CollectedItem>>()
  #outstandingBytes = 0
  #concluded = new Map<string, number>()
  #pendingAcks = new Set<string>()
  #flightAcks = new Set<string>()   // ids inside the in-flight flush snapshot
  #flushing = false
  #nextColId = 1

  #transitions: Array<{ id: string, to: 'delivered' }> = []

  // the relationship's send state (RLTP-VTI-3130)
  #mode: SendMode = 'routed'
  /** open routed deposits (documents), keyed by digest */
  #openDeposits = new Map<string, number>()
  /** this instance has concluded a collection that left nothing pending */
  #cleanConcluded = false

  /** The only way to build an adapter: the trio is DERIVED here from
   *  one root, one carrier, one nonce — so principal, connection DID
   *  and egress identity cannot come from different relationships
   *  (R7-B2: the coupling is enforced by construction, not by
   *  inspecting caller-supplied identities). */
  static async create (
    rootIkm: Uint8Array, carrier: string, nonce: Uint8Array,
    wire: MediatorWire, restored?: AckState, restoredAt?: number,
  ): Promise<MediatorCarrierAdapter> {
    // ONE tuple, snapshotted at entry: a caller mutating its buffers
    // between the three awaited derivations must not be able to mix
    // identities from two tuples (R8-B2)
    const ikm = new Uint8Array(rootIkm)
    const n = new Uint8Array(nonce)
    const principal = await carrierPrincipal(ikm, carrier, n)
    const connection = await carrierScopedIdentity(ikm, carrier, n, 'connection')
    const egress = await carrierScopedIdentity(ikm, carrier, n, 'egress')
    return new MediatorCarrierAdapter(KEY, principal, connection, egress, wire, restored, restoredAt)
  }

  constructor (
    key: symbol,
    principal: CarrierPrincipal,
    connection: CarrierScopedIdentity,
    egress: CarrierScopedIdentity,
    wire: MediatorWire,
    restored?: AckState,
    restoredAt?: number,
  ) {
    if (key !== KEY) {
      throw new Error('use MediatorCarrierAdapter.create — the identity trio must be derived, not supplied (5a.10)')
    }
    if (connection.scope !== 'connection' || egress.scope !== 'egress') {
      throw new Error('scoped identities passed in the wrong roles')
    }
    const three = new Set([principal.principal, connection.did, egress.did])
    if (three.size !== 3) {
      throw new Error('principal, connection DID and egress identity must be pairwise distinct (5a.10)')
    }
    this.#principal = principal.principal
    this.#connectionDid = connection.did
    this.#egressDid = egress.did
    this.#wire = wire
    if (restored) {
      // The restore instant anchors the duplicate-window: an expired,
      // debt-free entry is dropped HERE, not at the first advance —
      // otherwise a redelivery arriving before any port call would be
      // absorbed beyond the declared window (review-4 B4).
      if (typeof restoredAt !== 'number' || !Number.isFinite(restoredAt)) {
        throw new Error('restoring ack state requires a finite restoredAt instant')
      }
      this.#now(restoredAt)
      const pending = new Set(restored.pending)
      const known = new Set(restored.concluded.map((c) => c.queueId))
      for (const id of pending) {
        if (!known.has(id)) {
          throw new Error('ack snapshot violates its invariant: pending intent without a concluded entry')
        }
      }
      for (const { queueId, concludedAt } of restored.concluded) {
        if (!Number.isFinite(concludedAt) || concludedAt > restoredAt) {
          // a conclusion "from the future" would stretch the window
          // past its declared span (R5-B4) — fail closed
          throw new Error('ack snapshot: conclusion instant is non-finite or after restoredAt')
        }
        // the window beats everything (round-14 B): an expired entry
        // falls at the restore instant, owed or not — a phantom debt
        // from an ack that landed just before a close can never
        // outlive the window and delete a fresh copy (R14-B2)
        if (restoredAt - concludedAt >= DECLARED.duplicateWindowMs) continue
        this.#concluded.set(queueId, concludedAt)
        if (pending.has(queueId)) this.#pendingAcks.add(queueId)
      }
      // absent: a host that persisted none starts again in routed
      if (restored.send !== undefined) {
        const send = restoreSendState(restored.send, restoredAt)
        this.#mode = send.mode
        // an open deposit falls routed-ack-deadline plus duplicate-window
        // after its acceptance: cut here, not refused
        for (const o of send.open) if (restoredAt - o.acceptedAt < OPEN_KEEP_MS) this.#openDeposits.set(o.digest, o.acceptedAt)
      }
    }
    this.#wire.onDeliver(async (raw): Promise<boolean> => {
      if (this.#closed) return false
      // a plain copy of its own: a Node Buffer's slice() would share memory
      const bytes = new Uint8Array(raw)
      const queueId = hex(await sha(bytes))
      if (this.#closed) return false
      // Absorption is checked at the moment it happens (R11-B1): the
      // adapter absorbs a copy only for give-up-horizon after its
      // conclusion (profile §2, §4); a later copy is a new item for the
      // holder, whose absorption answers it again with the stored
      // acknowledgement (RLTP-DEL-6330, 6335) — so a counterpart that
      // resubmits after a lost acknowledgement is answered. The entry and
      // its ack intent stand for the duplicate window, and the window
      // beats everything (round-14 B): beyond it, both fall.
      // buffered and outstanding go before concluded (§3): a redelivery of
      // a later copy the holder has not concluded yet is ignored
      if (this.#inboxDigests.has(queueId)) return true
      for (const col of this.#outstanding.values()) if (col.has(queueId)) return true
      const concludedAt = this.#concluded.get(queueId)
      if (concludedAt !== undefined) {
        if (this.#flightAcks.has(queueId) ||
            this.#clock - concludedAt < DECLARED.giveUpHorizonMs) {
          // inside the horizon — or deferred: an id inside an
          // in-flight flush keeps absorbing until that flush ends,
          // because its irrecallable ack may still land (R15-B1)
          this.#pendingAcks.add(queueId)
          return true
        }
        if (this.#clock - concludedAt >= DECLARED.duplicateWindowMs) {
          this.#concluded.delete(queueId)
          this.#pendingAcks.delete(queueId)
        }
      }
      const held = this.#inboxBytes + this.#outstandingBytes
      const underFloor = this.#inbox.length < DECLARED.queueFloorCount &&
        held + bytes.length <= DECLARED.queueFloorBytes
      const underCap = held + bytes.length <= DECLARED.maxQueueBytes
      // not acknowledged and not taken: the mediator keeps its copy
      if (!underFloor && !underCap) return false
      this.#inbox.push({ bytes, queueId })
      this.#inboxBytes += bytes.length
      this.#inboxDigests.add(queueId)
      return true
    })
  }

  #now (raw: number): number {
    if (!Number.isFinite(raw)) throw new Error('non-finite time')
    if (raw > this.#clock) this.#clock = raw
    return this.#clock
  }

  #open (): void { if (this.#closed) throw new Error('retired (5a.10 lifecycle)') }

  #track (p: Promise<void>): void {
    const t = p.catch(() => {})
    this.#inflight.add(t)
    void t.finally(() => this.#inflight.delete(t))
  }

  // ── auth: silent carrier policy ─────────────────────────────────
  // Single-flight: concurrent callers share one handshake — the ATM
  // challenge/response is a session, and two interleaved sessions
  // under one connection DID would answer each other's challenges.
  #authing: Promise<string> | null = null

  #ensureAuth (now: number): Promise<string> {
    if (this.#tokens && now < this.#tokens.accessExpiresAt) return Promise.resolve(this.#tokens.accessToken)
    if (this.#authing) return this.#authing
    const run = (async (): Promise<string> => {
      if (this.#tokens && now < this.#tokens.refreshExpiresAt) {
        try {
          const refreshed = await this.#wire.refresh(this.#tokens.refreshToken)
          if (this.#closed) throw new Error('retired')   // as on the handshake path (R6-B1)
          this.#tokens = tokenCopy(refreshed)
          return this.#tokens.accessToken
        } catch (e) {
          if (this.#closed) throw e
          // a transient failure (mediator unreachable, retriable refusal)
          // says nothing about the token: keep it for the next attempt (#9)
          if (e instanceof WireError && (e.kind === 'unreachable' || e.kind === 'refused-retriable')) throw e
          // a refused refresh (revoked before its expiry) is never replayed:
          // drop the tokens and take the challenge handshake below
          this.#tokens = null
        }
      }
      const { challenge, sessionId } = await this.#wire.authChallenge(this.#connectionDid)
      if (this.#closed) throw new Error('retired')   // nothing new starts, not even the answer (R6-B1)
      this.#tokens = tokenCopy(await this.#wire.authenticate({ did: this.#connectionDid, challenge, sessionId }))
      return this.#tokens.accessToken
    })()
    this.#authing = run.finally(() => { this.#authing = null })
    return this.#authing
  }

  // ── transport registration (profile §3 — NOT §5a.3) ─────────────
  /** Records the desired keylist and returns; synchronization runs
   *  as a tracked background task and advance retries it until it
   *  lands (review-4 B1). */
  register (rkids: string[], rawNow: number): void {
    this.#open()
    const now = this.#now(rawNow)
    this.#desiredRkids = [...rkids]
    this.#keylistSynced = false
    this.#startKeylistSync(now)
  }

  get keylistSynced (): boolean {
    this.#open()
    return this.#keylistSynced
  }

  #startKeylistSync (now: number): void {
    if (this.#keylistSyncing || this.#keylistSynced || this.#desiredRkids === null) return
    this.#keylistSyncing = true
    const wanted = [...this.#desiredRkids]
    this.#track((async () => {
      try {
        const token = await this.#ensureAuth(now)
        if (this.#closed) return
        await this.#wire.keylistUpdate(token, [...wanted])   // the wire's own list: `wanted` is compared below
        // land only if the desire has not moved meanwhile
        if (!this.#closed && this.#desiredRkids !== null &&
            wanted.join(' ') === this.#desiredRkids.join(' ')) {
          this.#keylistSynced = true
        }
      } catch {
        // intent survives; advance retries
      } finally {
        this.#keylistSyncing = false
      }
    })())
  }

  // ── sender side ─────────────────────────────────────────────────
  /** Returns the submission id synchronously. Before the first
   *  honest report exists, status() returns null — §6.1's own
   *  pre-report window, represented as absence, not as a value. */
  submit (envelopeBytes: Uint8Array, rawNow: number): string {
    this.#open()
    const now = this.#now(rawNow)
    const id = 's' + this.#nextId++
    const knownOffline = this.#wire.offline?.() === true
    const sub: Submission = {
      id,
      // a plain copy of its own (a Node Buffer's slice() shares memory)
      bytes: new Uint8Array(envelopeBytes),
      submittedAt: now,
      attemptStartedAt: null,
      lastKind: null,
      st: null,
      sentMode: null,
    }
    this.#subs.set(id, sub)
    if (!knownOffline) this.#startAttempt(sub, now)
    return id
  }

  /** Takes the holder's custody set (holder.pendingTransport, after a
   *  resume of this opening) and the holder as the gate: files every entry
   *  not yet filed under its digest (its envelope as JCS bytes; the give-up
   *  horizon from entry.since) and returns their SubmissionRefs; withdraws
   *  every filed submission still before the trias (no report, or
   *  awaiting-transport) whose digest the view does not name. Accepted and
   *  terminal submissions stay for their reports. */
  reconcile (view: TransportView, gate: TransportGate, rawNow: number): SubmissionRef[] {
    this.#open()
    if (view?.ok !== true || !Array.isArray(view.entries)) throw new Error('reconcile needs a view of holder.pendingTransport')
    if (typeof gate?.handOver !== 'function') throw new Error('reconcile needs the holder as its gate')
    // one adapter per opening: its copies and the holder's grants belong to
    // that opening, and the next opening gets an adapter of its own
    if (this.#gate === null) this.#gate = gate
    else if (this.#gate !== gate) throw new Error('one adapter per opening: this adapter reconciles with another holder (create a new adapter for the next opening)')
    const now = this.#now(rawNow)
    // a submission's key: the digest, and for a duplicate's answer its
    // grant too — the retries and each answer are hand-overs of their own
    const keyOf = (digest: string, resend: number | undefined): string => resend === undefined ? digest : `${digest}#${resend}`
    const named = new Set(view.entries.map((e) => keyOf(e.digest, e.resend)))
    const filed = new Map<string, Submission>()
    for (const [id, sub] of this.#subs) {
      if (sub.digest === undefined) continue
      const key = keyOf(sub.digest, sub.entry?.resend)
      const before = sub.st === null || sub.st.state === 'awaiting-transport'
      if (before && !named.has(key)) { this.#subs.delete(id); continue }
      filed.set(key, sub)
    }
    const refs: SubmissionRef[] = []
    for (const entry of view.entries) {
      const had = filed.get(keyOf(entry.digest, entry.resend))
      if (had !== undefined) {
        // the newest entry of a live submission is the one its gate checks
        if (had.st === null || had.st.state === 'awaiting-transport') { had.entry = entry; had.gate = gate; continue }
        // an answer the holder still offers is still owed — its hand-over
        // never began, or the holder could not record that it did: a
        // terminal submission of it is filed again (the holder ends it)
        if (entry.resend === undefined) continue
        this.#subs.delete(had.id)
      }
      const id = 's' + this.#nextId++
      const sub: Submission = {
        id, digest: entry.digest, entry, gate,
        bytes: new TextEncoder().encode(jcs(entry.envelope)),
        // a duplicate's ack is a hand-over of its own, from now
        submittedAt: entry.resend !== undefined ? now : Math.min(entry.since, now),
        attemptStartedAt: null, lastKind: null, st: null, sentMode: null,
      }
      this.#subs.set(id, sub)
      refs.push({ submissionId: id, digest: entry.digest })
      // taken over past its horizon (counted from the first submission,
      // RLTP-DEL-6130): given up at once, never attempted
      if (now - sub.submittedAt >= DECLARED.giveUpHorizonMs) { sub.st = { state: 'failed', reason: 'expired-by-adapter-policy' }; continue }
      if (this.#wire.offline?.() !== true) this.#startAttempt(sub, now)
    }
    return refs
  }

  /** The current state as the ports' DeliveryReport for holder.report(),
   *  or null while no honest report exists (and for an unknown id). A
   *  submission filed without a digest (submit) has no report form. */
  report (id: string): DeliveryReport | null {
    const st = this.status(id)
    if (st === null) return null
    const digest = this.#subs.get(id)!.digest
    if (digest === undefined) throw new Error('submitted without a document digest: file holder documents through reconcile')
    return deliveryReportOf(digest, st)
  }

  has (id: string): boolean {
    this.#open()
    return this.#subs.has(id)
  }

  #startAttempt (sub: Submission, now: number): void {
    if (sub.attemptStartedAt !== null) return
    // a counterpart's retryAfter is the lower bound of the next attempt (RLTP-VTI-5010)
    if (sub.notBefore !== undefined && now < sub.notBefore) return
    sub.attemptStartedAt = now
    this.#track(this.#trySend(sub, now).finally(() => { sub.attemptStartedAt = null }))
  }

  async #trySend (sub: Submission, now: number): Promise<void> {
    if (sub.st !== null && sub.st.state !== 'awaiting-transport') return
    let next: SubmissionState
    let routedRefused = false
    try {
      const token = await this.#ensureAuth(now)
      if (this.#closed) return   // retirement between auth and deposit: nothing new starts (R5-B2)
      // each attempt hands the wire a copy: what it does with it never reaches the next.
      // The mode is read at the hand-over itself: from a switch on, every
      // hand-over uses the new mode, and a call already made ends in its own
      // (RLTP-VTI-3135)
      const deposit = (): Promise<void> => {
        sub.sentMode = this.#mode
        try { return this.#wire.deposit(token, new Uint8Array(sub.bytes), this.#egressDid, sub.sentMode) } catch (e) { return Promise.reject(e) }
      }
      if (sub.gate !== undefined) {
        // the holder decides, and the deposit starts in the same step of its
        // queue (Delivery RLTP-DEL-6125 to 6135); the adapter re-checks its
        // own state there: retired, withdrawn, past the trias, past the
        // entry's deadline or its own horizon → no deposit
        // the deposit's outcome, caught at once: the holder's step may still
        // be committing when the wire answers
        let started: Promise<unknown> | null = null
        let declined = false
        const entry = sub.entry!
        const start = (): boolean => {
          if (this.#closed || this.#subs.get(sub.id) !== sub || sub.gate!.closed === true ||
              (sub.st !== null && sub.st.state !== 'awaiting-transport') || this.#clock >= entry.notAfter ||
              this.#clock - sub.submittedAt >= DECLARED.giveUpHorizonMs) { declined = true; return false }
          started = deposit().then(() => null, (e: unknown) => ({ failed: e }))
          return true
        }
        let ok: boolean | null
        try { ok = await sub.gate.handOver(entry, this.#clock, start) } catch { ok = null }
        if (started === null) {
          // the holder said no: withdrawn; the adapter declined or the
          // holder was unreachable: not this attempt
          if (ok === false && !declined && this.#subs.get(sub.id) === sub) this.#subs.delete(sub.id)
          return
        }
        const outcome = await (started as Promise<unknown>)
        if (outcome !== null) throw (outcome as { failed: unknown }).failed
      } else {
        await deposit()
      }
      sub.lastKind = null
      next = { state: 'accepted' }
    } catch (e) {
      let kind: WireErrorKind = e instanceof WireError ? e.kind : 'unreachable'
      // a validated refusal of the routed form: the relationship switches
      // below, the submission stays in custody as a retriable refusal
      if (kind === 'routed-refused') { routedRefused = sub.sentMode === 'routed'; kind = 'refused-retriable' }
      sub.lastKind = kind
      next = kind === 'oversize'
        ? { state: 'failed', reason: 'oversize' }
        : {
            state: 'awaiting-transport',
            reason: kind === 'unreachable' ? 'transport-unreachable' : 'carrier-refused-retriable',
          }
    }
    if (this.#closed) return
    // evidence against routed (RLTP-VTI-3130): the switch, at once
    if (routedRefused) this.#switchToEgress()
    // withdrawn meanwhile (app contract rule 5): the late outcome changes nothing
    if (this.#subs.get(sub.id) !== sub) return
    // a document with a digest accepted in routed is an open routed deposit
    // (RLTP-VTI-3130) — only while the relationship is still routed (an
    // attempt begun before a switch opens nothing after it). Acknowledgements
    // and a submit() without a digest open nothing. Answered already (the
    // verdict outran the deposit's resolution): not opened. acceptedAt is the
    // adapter clock when the deposit resolved, not when it was handed over:
    // later by the deposit's own run time
    if (next.state === 'accepted' && sub.sentMode === 'routed' && this.#mode === 'routed' &&
        sub.digest !== undefined && this.#isDocument(sub) && sub.answered !== true &&
        !this.#openDeposits.has(sub.digest)) {
      this.#openDeposits.set(sub.digest, this.#clock)
    }
    // An interim report (including a horizon-corrected one) never
    // outranks the attempt's real outcome; only a TERMINAL state —
    // a give-up, a refusal, a delivery — stands (R5-B1). Without
    // this, an accepted deposit would stay reported unreachable and
    // be sent a second time.
    if (sub.st === null || sub.st.state === 'awaiting-transport') sub.st = next
  }

  #isDocument (sub: Submission): boolean {
    return sub.entry === undefined || sub.entry.kind === 'document'
  }

  /** A verdict on a document answers its open routed deposit
   *  (RLTP-VTI-3130), if the send state names it at that moment. A verdict
   *  before the acceptance marks the submission, so it is not opened
   *  afterwards. Acknowledgements are answered by nothing. */
  #answer (sub: Submission): void {
    if (!this.#isDocument(sub)) return
    sub.answered = true
    if (sub.digest !== undefined) this.#openDeposits.delete(sub.digest)
  }

  /** The switch (RLTP-VTI-3130): one way; the open routed deposits leave
   *  the send state. */
  #switchToEgress (): void {
    this.#mode = 'egress-session'
    this.#openDeposits.clear()
  }

  /** The current sending mode of the relationship (profile §3a). */
  get sendMode (): SendMode { return this.#mode }

  /** An answer the holder hands this instance for a document an earlier
   *  instance deposited (RLTP-VTI-3130): a valid acknowledgement, a
   *  validated receiver refusal or a validated `idConflict` answer for
   *  `digest`. If the send state names the document as an open routed
   *  deposit, it is answered and leaves; otherwise it answers nothing. A
   *  no-op on a retired instance, like acknowledged. */
  answered (digest: string, rawNow: number): void {
    if (this.#closed) return
    this.#now(rawNow)
    this.#openDeposits.delete(digest)
    // a document of this instance whose attempt still runs is answered too:
    // its acceptance after this opens nothing
    for (const sub of this.#subs.values()) if (sub.digest === digest && this.#isDocument(sub)) sub.answered = true
  }

  /** Host teardown aid, NOT a port operation (profile §6): awaits
   *  the in-flight background tasks so a host can drain before
   *  persisting ackState. On a hanging wire it waits as long as the
   *  wire does — a host bounds it externally (Promise.race) exactly
   *  because this library holds no clock of its own. */
  async settle (): Promise<void> {
    while (this.#inflight.size > 0) await Promise.all([...this.#inflight])
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
  status (id: string): SubmissionState | null {
    this.#open()
    const sub = this.#subs.get(id)
    if (!sub) return null
    if (sub.st !== null && sub.st.state !== 'awaiting-transport') return { ...sub.st }
    if (this.#wire.offline?.() === true) {
      return { state: 'awaiting-transport', reason: 'offline' }
    }
    if (sub.attemptStartedAt !== null &&
        this.#clock - sub.attemptStartedAt >= DECLARED.statusHorizonMs) {
      return { state: 'awaiting-transport', reason: 'transport-unreachable' }
    }
    return sub.st === null ? null : { ...sub.st }
  }

  /** A valid acknowledgement for submission `id`. Reports that a
   *  collection carries are applied before that collection's conclude,
   *  at the latest before the next advance: the switch check of
   *  RLTP-VTI-3130 counts on them, and a report applied late can let the
   *  relationship switch although its deposits were answered. */
  acknowledged (id: string): void {
    if (this.#closed) return
    const sub = this.#subs.get(id)
    if (!sub) return
    this.#answer(sub)
    if (sub.st?.state === 'delivered') return   // idempotent: a duplicate ack never rewrites `late` (R9-M4)
    const late = sub.st?.state === 'failed'
    sub.st = { state: 'delivered', late }
    if (late) this.#transitions.push({ id, to: 'delivered' })
  }

  /** Refusals act on live submissions only (§6.1 knows exactly one
   *  late correction — the valid ack). The code set is closed and
   *  TERMINAL: a refusal marked `retryable` is a transport outcome,
   *  never a receiver verdict (receiverRetry, RLTP-VTI-5010), and a code
   *  outside the set — an extended code before readTrustTaskError made
   *  it `taskFailed`, `idConflict`, `unavailable` — is refused
   *  fail-closed rather than minted into a verdict (R6-B2). Applied, like
   *  acknowledged, before the conclude of the collection that carried
   *  it (RLTP-VTI-3130). */
  /** A counterpart's validated retryable refusal (RLTP-VTI-5010): no port
   *  transition; the next attempt of the document starts no earlier than
   *  `retryAfter` (milliseconds, or null for the next advance). The give-up
   *  horizon still ends the submission: a `retryAfter` beyond it is never
   *  waited for. An accepted submission makes no further attempt from this
   *  side (Delivery §6.1), and nothing moves back. The bound lives in this
   *  instance: it is not part of the ack state, and the next opening's
   *  adapter starts without it (RLTP-VTI-5010). */
  receiverRetry (id: string, retryAfter: number | null): void {
    if (this.#closed) return
    if (retryAfter !== null && !finite(retryAfter)) throw new Error('retryAfter is a finite instant in milliseconds, or null')
    const sub = this.#subs.get(id)
    if (!sub) return
    if (retryAfter !== null) sub.notBefore = Math.max(sub.notBefore ?? retryAfter, retryAfter)
  }

  receiverRefused (id: string, code: ReceiverRefusalCode): void {
    if (this.#closed) return
    if (!RECEIVER_REFUSAL_CODES.has(code)) {
      throw new Error('not a terminal receiver refusal code — retryable conditions are transport outcomes')
    }
    const sub = this.#subs.get(id)
    if (!sub) return
    this.#answer(sub)
    // A VALIDATED refusal is itself the proof of receipt — the
    // mediator can have accepted and forwarded while our deposit
    // promise is still unresolved, so the report-less phase is a
    // legitimate moment for it (R9-B2, reversing the R8-B3
    // overcorrection). Only terminal states stand against it.
    if (sub.st !== null && sub.st.state !== 'awaiting-transport' && sub.st.state !== 'accepted') return
    sub.st = { state: 'failed', reason: 'rejected-by-receiver', code }
  }

  drainTransitions (): Array<{ id: string, to: 'delivered' }> {
    this.#open()
    return this.#transitions.splice(0)
  }

  // ── receiver side ───────────────────────────────────────────────
  collect (rawNow: number): Collection {
    this.#open()
    this.#now(rawNow)
    if (this.#inbox.length === 0) return { id: 'c-empty', items: [] }
    const items = this.#inbox.splice(0)
    this.#outstandingBytes += this.#inboxBytes
    this.#inboxBytes = 0
    this.#inboxDigests.clear()
    const id = 'c' + this.#nextColId++
    this.#outstanding.set(id, new Map(items.map((i) => [i.queueId, i])))
    // the caller gets its own copies: the outstanding entries stay intact,
    // whatever it does with the bytes, for a conclusion that keeps them
    return { id, items: items.map((i) => ({ ...i, bytes: new Uint8Array(i.bytes) })) }
  }

  /** Concludes a collection (profile §4, Delivery 5a.8): its items'
   *  digests become ack intent. `keep` names the items whose disposition
   *  is transient (Delivery RLTP-DEL-5810, 5820: `failed(rate-limited)`,
   *  or a transaction that could not commit, see `concludable`): they are
   *  not concluded and not acknowledged, they go back to the buffer and the
   *  next collect offers them again, and the mediator keeps its copy.
   *  The reports the collection carries (acknowledged, receiverRefused,
   *  answered) are applied BEFORE this call, at the latest before the next
   *  advance: a conclusion that leaves nothing pending opens the switch
   *  check of RLTP-VTI-3130, which counts them as applied. */
  conclude (collection: { id: string }, rawNow: number, opts: { keep?: readonly string[] } = {}): void {
    this.#open()
    const now = this.#now(rawNow)
    const col = this.#outstanding.get(collection.id)
    if (!col) {
      // an empty collection is concluded too: it may be the one that leaves nothing pending
      if (collection.id === 'c-empty') this.#concludedClean()
      return
    }
    this.#outstanding.delete(collection.id)
    const keep = new Set(opts.keep ?? [])
    for (const item of col.values()) {
      this.#outstandingBytes -= item.bytes.length
      if (keep.has(item.queueId)) {
        // transient: back to the buffer, offered again, never acknowledged
        this.#inbox.push(item)
        this.#inboxBytes += item.bytes.length
        this.#inboxDigests.add(item.queueId)
        continue
      }
      this.#concluded.set(item.queueId, now)
      this.#pendingAcks.add(item.queueId)
    }
    this.#concludedClean()
    this.#startFlush(now)
  }

  /** Nothing pending for this connection: the wire says the mediator
   *  holds nothing more (queueEmpty; a wire without it never says so),
   *  nothing waits in the buffer, no collection is outstanding. */
  #nothingPending (): boolean {
    return this.#wire.queueEmpty?.() === true && this.#inbox.length === 0 && this.#outstanding.size === 0
  }

  /** After a conclusion (RLTP-VTI-3130): when it left nothing pending,
   *  the switch check may run in a later advance. */
  #concludedClean (): void {
    if (!this.#nothingPending()) return
    this.#cleanConcluded = true
  }

  ackState (): AckState {
    return {
      concluded: [...this.#concluded].map(([queueId, concludedAt]) => ({ queueId, concludedAt })),
      pending: [...this.#pendingAcks],
      send: {
        mode: this.#mode,
        open: [...this.#openDeposits].map(([digest, acceptedAt]) => ({ digest, acceptedAt })),
      },
    }
  }

  #startFlush (now: number): void {
    if (this.#flushing || this.#pendingAcks.size === 0) return
    this.#flushing = true
    const snapshot = new Set(this.#pendingAcks)
    this.#track(this.#flushAcks(now, [...snapshot]).finally(() => {
      this.#flushing = false
      // lost-wake-up guard (review-4 M6): intents that arrived while
      // this flush ran get their own flush now — but only newcomers,
      // so a failing wire waits for the next advance instead of
      // spinning
      if (!this.#closed) {
        for (const id of this.#pendingAcks) {
          if (!snapshot.has(id)) { this.#startFlush(this.#clock); break }
        }
      }
    }))
  }

  async #flushAcks (now: number, ids: string[]): Promise<void> {
    try {
      const token = await this.#ensureAuth(now)
      if (this.#closed) return
      // Only NOW does anything become irrecallable (R16-B1): the
      // stay of expiry begins at the wire call itself, never at the
      // snapshot — a hanging auth extends no window. And "live" is
      // WINDOW-live (R17-B1): an entry whose window already closed —
      // even if no prune has swept it yet — is never sent.
      const live = ids.filter((id) => {
        const at = this.#concluded.get(id)
        // a later copy of it that the holder has not concluded yet (in the
        // buffer or outstanding) is not acknowledged before it is handled:
        // hand off → await → ack; the intent stays for the next flush
        if (this.#inboxDigests.has(id) || [...this.#outstanding.values()].some((c) => c.has(id))) return false
        return at !== undefined && this.#clock - at < DECLARED.duplicateWindowMs
      })
      if (live.length === 0) return
      for (const id of live) this.#flightAcks.add(id)
      try {
        // the wire gets its own list: what it does with it never reaches the bookkeeping below
        await this.#wire.ackReceived(token, [...live])
        if (!this.#closed) for (const id of live) this.#pendingAcks.delete(id)
      } finally {
        for (const id of live) this.#flightAcks.delete(id)
        // deferred window sweep: entries whose window closed while
        // the ack flew fall now — intent, entry and absorption
        // together (R15-B1). Never on a retired instance: after
        // close, ackState() is the host's final-persist surface and
        // a late-returning wire mutates nothing (R17-B2).
        if (!this.#closed) {
          for (const id of live) {
            const at = this.#concluded.get(id)
            if (at !== undefined && this.#clock - at >= DECLARED.duplicateWindowMs) {
              this.#concluded.delete(id)
              this.#pendingAcks.delete(id)
            }
          }
        }
      }
    } catch {
      // intent survives; the next advance starts a fresh flush
    }
  }

  // ── the adapter clock — never awaits the mediator ───────────────
  advance (rawNow: number): void {
    this.#open()
    const now = this.#now(rawNow)
    // open routed deposits fall routed-ack-deadline plus duplicate-window
    // after their acceptance, also where no switch check can run (no
    // statement that nothing is pending, RLTP-VTI-7150)
    for (const [digest, at] of this.#openDeposits) if (now - at >= OPEN_KEEP_MS) this.#openDeposits.delete(digest)
    // the switch (RLTP-VTI-3130): only after a conclusion that left nothing
    // pending and while nothing is pending again at the check (an
    // acknowledgement that arrived since is collected and reported first),
    // when an open routed deposit is a deadline old — one way; checked
    // before the retries below, which hand over in the new mode
    if (this.#mode === 'routed' && this.#cleanConcluded && this.#nothingPending()) {
      for (const acceptedAt of this.#openDeposits.values()) {
        if (now - acceptedAt >= DECLARED.routedAckDeadlineMs) { this.#switchToEgress(); break }
      }
    }
    for (const sub of this.#subs.values()) {
      const live = sub.st === null || sub.st.state === 'awaiting-transport' || sub.st.state === 'accepted'
      if (!live) continue
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
        }
        continue
      }
      if (sub.st !== null && sub.st.state === 'accepted') continue
      // reports are DERIVED at observation (see status()); the clock
      // only decides here whether to start an attempt — and never
      // against a wire that knows itself offline
      if (this.#wire.offline?.() === true) continue
      if (sub.attemptStartedAt === null) this.#startAttempt(sub, now)
    }
    // THE WINDOW BEATS EVERYTHING (Option B of the round-14 halt):
    // an ack intent is retried until the window closes; then intent
    // and absorption fall together. There is no ageless debt whose
    // truth the adapter would have to know — the receiver's §6.2
    // absorption owns everything beyond the window.
    for (const [digest, at] of this.#concluded) {
      if (now - at >= DECLARED.duplicateWindowMs && !this.#flightAcks.has(digest)) {
        this.#concluded.delete(digest)
        this.#pendingAcks.delete(digest)
      }
    }
    this.#startKeylistSync(now)
    this.#startFlush(now)
  }

  /** §5a.10 lifecycle boundary: after close, every state port is
   *  inert — port operations refuse, inbound reports (acknowledged,
   *  receiverRefused) are no-ops, late wire resolutions mutate
   *  nothing. Only ackState() stays readable for the host's final
   *  persist. */
  close (): void { this.#closed = true }

  get closed (): boolean { return this.#closed }
}

export const queueIdOf = async (bytes: Uint8Array): Promise<string> => hex(await sha(bytes))
