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
// Profile: spec/adapter-vti-mediator.md v0.29 (twenty-ninth casting;
// §1c, the displayed card's instance, is the host's and the wire's, not this module's;
// round journals under design/adapter-review*). A
// transport adapter contract — NOT a carrier at the port. The
// counterpart's connection DID the wire needs comes from the
// counterpart's delivery hint in the card that opened the relationship
// (profile §1b); the holder hands the hints on uninterpreted
// (RelationshipView.counterpartDeliveryHints) and this adapter derives its
// own pair (principal, connection DID) from the relationship's carrier
// nonce (RelationshipView.carrierNonce). One wire identity per relationship
// and carrier: the connection DID sends and collects (§1a, RLTP-VTI-1120).
//
// The carried document (profile §3b, Delivery 0.85 §4.6): every deposit's
// payload is the JCS of the registry's TSP binding envelope around a
// sealed-envelope/0.1 document whose payload is the holder's sealed
// envelope, built at every attempt from the seal, the two connection DIDs
// and the entry's `since` (wrapSealed) — byte-identical across attempts,
// its `id` a UUID v8 of seal and parties (RLTP-VTI-3150, RLTP-DEL-5040).
// On receipt (RLTP-VTI-7160) the wire hands the payload with its
// authenticated sender; a carried document whose parties are the sender
// and this side becomes an item for the holder (its seal), a counterpart's
// trust-task-error/0.5 or trust-task-next-step/0.1 is bound by the carried
// document's id to the submission it answers and applied here
// (RLTP-VTI-5040, 5050: a next step makes it accepted and held, which the
// give-up horizon does not end), and everything else is logged and
// acknowledged. What the adapter consumes itself it concludes at its next
// step.
//
// Sending form (profile §3a): every deposit names its mode to the wire.
// Mode `routed` (the mode of every instance from construction): an inner
// TSP `direct` message connection DID → counterpart's connection DID
// inside an outer routed message connection DID → C with the route
// [counterpart's connection DID]. Mode `direct` (fallback): the inner
// message alone. Both on the connection DID's session. The wire packs the
// layers (depositAddressing says who addresses whom); the adapter keeps the
// relationship's send state (the mode and the open routed deposits) in
// its ack state (RLTP-VTI-3130). Open are: every document with a digest
// (an entry of kind `document` filed by reconcile) accepted in routed and
// not yet answered — a valid acknowledgement, a validated refusal, a
// validated idConflict or a validated next step for it answers it.
// Acknowledgements are no open deposits: a side that only acknowledges
// never switches by the deadline (Open Issue 6). The adapter switches one
// way to `direct` when an open deposit is routed-ack-deadline (72 h)
// old, checked in an advance after a conclusion that left nothing
// pending and while nothing is pending again — "nothing pending" is the
// binding's statement through queueEmpty() (RLTP-VTI-7150); without it
// the adapter never switches — and at once on a
// validated refusal of the routed form (WireError 'routed-refused').
// At the switch the open deposits leave; nothing returns to routed. An
// attempt ends in the mode it began in; an accepted submission is never
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
//     except reading its ack state — with one exception: ackState()
//     still records a refusal of direct delivery the wire received
//     (directRefused, RLTP-VTI-3120); monotone, it only blocks, and its
//     instant is the adapter clock, never later.

import { jcs, iso, makeValidator } from '../core.js'
import type { Json } from '../core.js'
import { anchorOfEd, edRawOfAnchor, sha, cat, base58, fromBase58, b64uOf, fromB64u, platformSubtle } from '../crypto.js'
import { carrierPrincipal, carrierScopedIdentity } from '../carrier-identity.js'
import type { CarrierPrincipal, CarrierScopedIdentity } from '../carrier-identity.js'
import type { DeliveryReport, ReceiverRefusalCode, SubmissionRef } from '../ports.js'
import type { AnswerableEntry, TransportEntry, TransportView } from '../engine.js'
import type { ReceiveResult } from '../results.js'
import type { Envelope } from '../delivery.js'
import { SCHEMAS } from '../schemas.js'
import { SEALED_ENVELOPE_TYPE } from '../task-uri.js'
export type { ReceiverRefusalCode } from '../ports.js'
export { SEALED_ENVELOPE_TYPE } from '../task-uri.js'

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
  /** the largest TSP payload the adapter reads (RLTP-VTI-7160): the binding
   *  envelope, 70 bytes, around a carried document at its size bound */
  payloadBound: 90_182,
} as const)

/** The size bound of a sealed-envelope/0.1 document (Delivery
 *  RLTP-DEL-3030, 4.6): its UTF-8 JCS serialization, in bytes. */
export const SEALED_ENVELOPE_DOCUMENT_BOUND = 90_112

// ── The delivery hint (profile §1b) ──────────────────────────────────
// Below the port line: the holder carries hints uninterpreted; this
// adapter builds its own and reads the counterpart's.

/** The counterpart's wire identity at one carrier, as its hint names it. */
export interface DeliveryHintIdentities { connectionDid: string, carrier: string }

const HINT_MEMBERS = jcs(['id', 'serviceEndpoint', 'type'])
const HINT_MEMBERS_WITH_EGRESS = jcs(['id', 'rltpEgress', 'serviceEndpoint', 'type'])
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
 *  `N` (RLTP-VTI-1210, 1215): the connection DID derived here from (root,
 *  `C`, `N`), exactly as the factory derives the instance's — derived, not
 *  supplied, so the two cannot come from different relationships — as the
 *  JCS form of the TSPTransport service entry naming the connection DID
 *  (`id`, with `#tsp`) and `C` (`serviceEndpoint`). */
export async function deliveryHint (rootIkm: Uint8Array, carrier: string, nonce: Uint8Array): Promise<string> {
  // snapshot at entry, as create does (R8-B2)
  const ikm = new Uint8Array(rootIkm)
  const n = new Uint8Array(nonce)
  const connection = await carrierScopedIdentity(ikm, carrier, n, 'connection')
  return jcs({ id: connection.did + '#tsp', type: 'TSPTransport', serviceEndpoint: carrier })
}

/** One hint read strictly (RLTP-VTI-1210, 1220) for carrier `C`: JSON,
 *  byte-equal to its JCS form, exactly the three members — or those and a
 *  fourth `rltpEgress`, ignored whatever its value — type TSPTransport, an
 *  `id` ending in `#tsp` whose rest is a canonical Ed25519 did:key,
 *  `serviceEndpoint` byte-equal to `C`. Total (RLTP-VTI-1220): any other
 *  input — not a string, not JSON, no JCS form (a lone surrogate), any
 *  other shape — is null, ignored; it never throws. */
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
  const members = jcs(Object.keys(e).sort())
  if ((members !== HINT_MEMBERS && members !== HINT_MEMBERS_WITH_EGRESS) || e.type !== 'TSPTransport' || e.serviceEndpoint !== carrier) return null
  if (typeof e.id !== 'string' || !e.id.endsWith('#tsp')) return null
  const connectionDid = e.id.slice(0, -'#tsp'.length)
  if (!edDidKey(connectionDid)) return null
  return { connectionDid, carrier }
}

/** The counterpart's connection DID at `C` from the hints of the card
 *  that opened the relationship, read by the side `self` (its own
 *  connection DID of this relationship and carrier): every hint read as
 *  readDeliveryHint does; a hint naming `self`'s connection DID is ignored
 *  (RLTP-VTI-1227); of what remains, the one hint for `C` (RLTP-VTI-1225,
 *  1240) — none, or more than one, is null: the relationship is not
 *  carried at `C` (RLTP-VTI-1235). Total: any input answers null or the
 *  identity, never a throw; without a well-formed `self` nothing is read. */
export function readDeliveryHints (hints: unknown, carrier: unknown, self: unknown): DeliveryHintIdentities | null {
  try {
    if (!Array.isArray(hints)) return null
    const me = self as { connection?: unknown } | null
    if (me === null || typeof me !== 'object' || !edDidKey(me.connection)) return null
    const read = hints.map((h) => readDeliveryHint(h, carrier))
      .filter((x): x is DeliveryHintIdentities => x !== null && x.connectionDid !== me.connection)
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

/** Whether `s` has at most `max` code points. The registry schema bounds
 *  `message` with JSON Schema `maxLength: 1024`, which counts characters
 *  as RFC 8259 defines them, Unicode code points (JSON Schema Validation
 *  2020-12 §6.3.1; TT 0.6 §7.3 item 19.1 asks free text to declare such a
 *  `maxLength`), never UTF-16 units. Counts no further than max + 1. */
function atMostCodePoints (s: string, max: number): boolean {
  let n = 0
  for (const _ of s) if (++n > max) return false
  return true
}

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
  // setUTCFullYear, not Date.UTC: Date.UTC reads the years 0 to 99 as 1900 to 1999
  const at = new Date(0)
  at.setUTCFullYear(y, mo - 1, d)
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== mo - 1 || at.getUTCDate() !== d) return null
  let offsetMin = 0
  if (m[9] !== undefined) {
    const oh = Number(m[10]), om = Number(m[11])
    if (oh > 23 || om > 59) return null
    offsetMin = (m[9] === '-' ? -1 : 1) * (oh * 60 + om)
  }
  const frac = m[7] === undefined ? 0 : Math.floor(Number('0' + m[7]) * 1000)
  at.setUTCHours(h, mi, s, frac)
  const ms = at.getTime() - offsetMin * 60_000
  return Number.isFinite(ms) ? ms : null
}

/** One counterpart error document read by its form (registry
 *  trust-task-error/0.5): `type` exactly TRUST_TASK_ERROR_TYPE, a payload
 *  with exactly the registry's members, `code` a standard or an extended
 *  code, `retryable` a boolean, `retryAfter` an RFC 3339 date-time,
 *  `message` at most 1024 code points, `inResponseTo` with a `typeUri`,
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
  if ('message' in e && (typeof e.message !== 'string' || !atMostCodePoints(e.message, 1024))) return null
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

// ── Next steps (profile §5, RLTP-VTI-5050) ────────────────────────────

/** The Type URI of the recipient-suggested continuations this profile reads. */
export const TRUST_TASK_NEXT_STEP_TYPE = 'https://trusttasks.org/spec/trust-task-next-step/0.1'

const NEXT_STEP_MEMBERS = new Set(['expects', 'continuation', 'inResponseTo', 'message', 'ext'])
const EXPECTS_MEMBERS = new Set(['typeUri', 'reason', 'hint'])
const isObject = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)
const nonEmpty = (x: unknown): x is string => typeof x === 'string' && x.length > 0

/** An `inResponseTo` of the registry's form: exactly a non-empty `typeUri`
 *  and an optional non-empty `id`; false for any other value. */
function inResponseToOk (r: unknown): boolean {
  if (!isObject(r)) return false
  if (Object.keys(r).some((k) => k !== 'typeUri' && k !== 'id') || !nonEmpty(r.typeUri)) return false
  return !('id' in r) || nonEmpty(r.id)
}

/** An eddsa-jcs-2022 Data Integrity proof over `doc` under the did:key
 *  `issuer` (RLTP-VTI-5050): the verification method is the issuer's own
 *  key, the signature 64 canonical base58btc bytes over the hash of the
 *  proof configuration and of the document without its proof. The purpose
 *  and the `created` form are the producer's. Never throws. */
async function foreignProofOk (doc: Record<string, unknown>, issuer: unknown): Promise<boolean> {
  try {
    const { proof, ...rest } = doc
    if (!isObject(proof) || typeof issuer !== 'string') return false
    if (proof.type !== 'DataIntegrityProof' || proof.cryptosuite !== 'eddsa-jcs-2022') return false
    if (typeof proof.created !== 'string' || typeof proof.proofPurpose !== 'string') return false
    if (proof.verificationMethod !== issuer + '#' + issuer.slice('did:key:'.length)) return false
    if ('@context' in rest && jcs(proof['@context'] ?? null) !== jcs(rest['@context'] as Json)) return false
    const raw = edRawOfAnchor(issuer)
    const zsig = proof.proofValue
    if (raw === null || typeof zsig !== 'string' || zsig[0] !== 'z') return false
    const sig = fromBase58(zsig.slice(1))
    if (!sig || sig.length !== 64 || 'z' + base58(sig) !== zsig) return false
    const { proofValue: _, ...cfg } = proof
    const te = new TextEncoder()
    const S = platformSubtle()
    const hashData = cat(await sha(te.encode(jcs(cfg as Json)), S), await sha(te.encode(jcs(rest as Json)), S))
    const pub = await S.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify'])
    return await S.verify({ name: 'Ed25519' }, pub, sig, hashData)
  } catch {
    return false
  }
}

/** A next step read by its form (registry trust-task-next-step/0.1,
 *  RLTP-VTI-5050): `type` exactly TRUST_TASK_NEXT_STEP_TYPE; a payload
 *  with no members but the registry's — `expects` a list of at least one
 *  object of `typeUri` (non-empty), `reason` (at most 1024 code points)
 *  and `hint` (an object); `continuation` `resubmit` or `proceed`;
 *  `inResponseTo`; `message` (at most 1024 code points); `ext` (an
 *  object); a `proof`, where present, verifying as eddsa-jcs-2022 under
 *  the did:key of `issuer`. `expects` is read, never followed. Answers
 *  what it answers by (`inResponseTo`, `threadId`), or null. Total. */
export async function readTrustTaskNextStep (doc: unknown): Promise<{ inResponseTo?: { id?: string, typeUri: string }, threadId?: string } | null> {
  try {
    if (!isObject(doc) || doc.type !== TRUST_TASK_NEXT_STEP_TYPE) return null
    const p = doc.payload
    if (!isObject(p) || Object.keys(p).some((k) => !NEXT_STEP_MEMBERS.has(k))) return null
    if (!Array.isArray(p.expects) || p.expects.length === 0) return null
    for (const e of p.expects as unknown[]) {
      if (!isObject(e) || Object.keys(e).some((k) => !EXPECTS_MEMBERS.has(k)) || !nonEmpty(e.typeUri)) return null
      if ('reason' in e && (typeof e.reason !== 'string' || !atMostCodePoints(e.reason, 1024))) return null
      if ('hint' in e && !isObject(e.hint)) return null
    }
    if ('continuation' in p && p.continuation !== 'resubmit' && p.continuation !== 'proceed') return null
    if ('inResponseTo' in p && !inResponseToOk(p.inResponseTo)) return null
    if ('message' in p && (typeof p.message !== 'string' || !atMostCodePoints(p.message, 1024))) return null
    if ('ext' in p && !isObject(p.ext)) return null
    if ('proof' in doc && !(await foreignProofOk(doc, doc.issuer))) return null
    const r = p.inResponseTo as { id?: string, typeUri: string } | undefined
    return {
      ...(r === undefined ? {} : { inResponseTo: { typeUri: r.typeUri, ...(r.id === undefined ? {} : { id: r.id }) } }),
      ...(typeof doc.threadId === 'string' ? { threadId: doc.threadId } : {}),
    }
  } catch {
    return null
  }
}

// ── The carried document (profile §3b, Delivery 4.6) ─────────────────

/** The Type URI of the registry's TSP binding envelope (bindings/tsp/0.1 §2). */
export const TSP_BINDING_ENVELOPE_TYPE = 'https://trusttasks.org/binding/tsp/0.1/envelope'

const ID_DOMAIN = 'rltp/v1/sealed-envelope-id'
const hexOf = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

/** The `id` of a carried document (Delivery RLTP-DEL-4620): a UUID v8 from
 *  the first 16 bytes of SHA-256 over `rltp/v1/sealed-envelope-id` and the
 *  JCS of { issuer, recipient, seal }, version and variant bits set. */
export async function sealedEnvelopeId (seal: Envelope, issuer: string, recipient: string): Promise<string> {
  const te = new TextEncoder()
  const h = (await sha(cat(te.encode(ID_DOMAIN), te.encode(jcs({ issuer, recipient, seal } as unknown as Json))))).slice(0, 16)
  h[6] = (h[6] & 0x0f) | 0x80
  h[8] = (h[8] & 0x3f) | 0x80
  const x = hexOf(h)
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`
}

/** The binding envelope that carries `seal` from `issuer` to `recipient`
 *  (RLTP-VTI-3150, Delivery RLTP-DEL-4610, 5040): a pure function of the
 *  seal, the two connection DIDs and `since` (the first submission, in
 *  milliseconds; `issuedAt` is its whole second with `Z`). `bytes` is the
 *  UTF-8 JCS a deposit carries; `outerId` the carried document's `id`,
 *  which answers bind to. */
export async function wrapSealed (seal: Envelope, at: { issuer: string, recipient: string, since: number }): Promise<{ envelope: Json, outerId: string, bytes: Uint8Array }> {
  if (!Number.isFinite(at.since)) throw new Error('wrapSealed: since is a finite instant in milliseconds')
  const s: Envelope = { rkid: seal.rkid, epk: seal.epk, nonce: seal.nonce, ciphertext: seal.ciphertext }
  const outerId = await sealedEnvelopeId(s, at.issuer, at.recipient)
  const document = {
    id: outerId, type: SEALED_ENVELOPE_TYPE, issuer: at.issuer, recipient: at.recipient,
    threadId: outerId, issuedAt: iso(Math.floor(at.since / 1000) * 1000), payload: { ...s },
  }
  const envelope = { type: TSP_BINDING_ENVELOPE_TYPE, document } as unknown as Json
  return { envelope, outerId, bytes: new TextEncoder().encode(jcs(envelope)) }
}

/** What a delivered payload is to this side (RLTP-VTI-7160). */
export type BindingReading =
  /** a carried document from the sender to this side: its seal goes to the holder */
  | { kind: 'sealed', seal: Envelope, outerId: string }
  /** a counterpart's error document, answering the carried document `answers` */
  | { kind: 'error', reading: TrustTaskErrorReading, answers: string }
  /** a counterpart's next step, answering the carried document `answers` */
  | { kind: 'next-step', answers: string }
  /** anything else: logged with `why` and acknowledged, never delivered */
  | { kind: 'ignored', why: string }

const VALIDATOR = makeValidator(SCHEMAS)
const PROFILE = SCHEMAS['rltp-delivery-document.schema.json']!
const canonicalB64u = (x: unknown): boolean => {
  try { return typeof x === 'string' && b64uOf(fromB64u(x)) === x } catch { return false }
}

/** The answer an error document or a next step binds to (RLTP-VTI-5040):
 *  `inResponseTo.id`, else `threadId`; the parties checked against the
 *  sender and `self`; `inResponseTo.typeUri` the carried type. A string,
 *  or why not. */
function boundTo (d: Record<string, unknown>, sender: string, self: string): { answers: string } | { why: string } {
  // a framework document's timestamp: any RFC 3339 date-time, any precision
  // and offset (RLTP-VTI-5060), read for its form only
  if ('issuedAt' in d && rfc3339(d.issuedAt) === null) return { why: 'answer issuedAt is no RFC 3339 date-time' }
  if ('issuer' in d && d.issuer !== sender) return { why: 'answer issuer is not the sender' }
  if ('recipient' in d && d.recipient !== self) return { why: 'answer recipient is not this side' }
  const p = d.payload as Record<string, unknown>
  const r = p.inResponseTo as Record<string, unknown> | undefined
  if (r !== undefined && r.typeUri !== SEALED_ENVELOPE_TYPE) return { why: 'answer to another type' }
  if (r !== undefined && typeof r.id === 'string') return { answers: r.id }
  if (nonEmpty(d.threadId)) return { answers: d.threadId }
  return { why: 'answer names no document' }
}

/** One delivered payload read with its authenticated sender VID (RLTP-VTI-
 *  7160): at most DECLARED.payloadBound bytes; a JSON object of the binding
 *  envelope's `type` with an object `document`; a sealed-envelope/0.1
 *  document satisfying the document profile, `threadId` = `id`, its
 *  `issuer` the sender and its `recipient` `self` (exact strings), its
 *  ciphertext canonical → `sealed`; a trust-task-error/0.5 or a
 *  trust-task-next-step/0.1 read by form and bound (RLTP-VTI-5040) →
 *  `error` / `next-step`; anything else → `ignored`. Total: never throws. */
export async function readBindingEnvelope (bytes: Uint8Array, at: { sender: string, self: string }): Promise<BindingReading> {
  try {
    if (bytes.length > DECLARED.payloadBound) return { kind: 'ignored', why: 'payload over payload-bound' }
    let o: unknown
    try { o = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { return { kind: 'ignored', why: 'not JSON' } }
    if (!isObject(o) || o.type !== TSP_BINDING_ENVELOPE_TYPE) return { kind: 'ignored', why: 'not a binding envelope' }
    const d = o.document
    if (!isObject(d)) return { kind: 'ignored', why: 'binding envelope without a document object' }
    if (d.type === SEALED_ENVELOPE_TYPE) {
      if (VALIDATOR.validate(d, PROFILE, PROFILE).length > 0) return { kind: 'ignored', why: 'carried document fails the profile' }
      if (d.threadId !== d.id) return { kind: 'ignored', why: 'carried document: threadId is not id' }
      if (d.issuer !== at.sender) return { kind: 'ignored', why: 'carried document: issuer is not the sender' }
      if (d.recipient !== at.self) return { kind: 'ignored', why: 'carried document: recipient is not this side' }
      const seal = d.payload as unknown as Envelope
      if (!canonicalB64u(seal.ciphertext)) return { kind: 'ignored', why: 'carried document: ciphertext not canonical' }
      return { kind: 'sealed', seal: { rkid: seal.rkid, epk: seal.epk, nonce: seal.nonce, ciphertext: seal.ciphertext }, outerId: d.id as string }
    }
    if (d.type === TRUST_TASK_ERROR_TYPE) {
      const reading = readTrustTaskError(d)
      if (reading === null) return { kind: 'ignored', why: 'not an error document of the registry form' }
      // a proof, where present, verifies under the issuer, as for a next step (RLTP-VTI-5010, 5050)
      if ('proof' in d && !(await foreignProofOk(d, d.issuer))) return { kind: 'ignored', why: 'error document whose proof does not verify' }
      const b = boundTo(d, at.sender, at.self)
      return 'why' in b ? { kind: 'ignored', why: b.why } : { kind: 'error', reading, answers: b.answers }
    }
    if (d.type === TRUST_TASK_NEXT_STEP_TYPE) {
      if ((await readTrustTaskNextStep(d)) === null) return { kind: 'ignored', why: 'not a next step of the registry form' }
      const b = boundTo(d, at.sender, at.self)
      return 'why' in b ? { kind: 'ignored', why: b.why } : { kind: 'next-step', answers: b.answers }
    }
    return { kind: 'ignored', why: 'document of another type' }
  } catch {
    return { kind: 'ignored', why: 'unreadable' }
  }
}

// ── The sending form (profile §3a) ───────────────────────────────────
/** How a deposit reaches the mediator (RLTP-VTI-3110, 3120). */
export type SendMode = 'routed' | 'direct'
const SEND_MODES: ReadonlySet<string> = new Set<SendMode>(['routed', 'direct'])

/** One TSP layer's addressing (no keys, no bytes: those are the wire's). */
export interface LayerAddressing {
  messageType: 'direct' | 'routed'
  sender: string
  receiver: string
  route?: string[]
}

/** The addressing of a deposit in `mode` (RLTP-VTI-1120, 3110, 3115,
 *  3120): the inner `direct` message from this side's connection DID to
 *  the counterpart's connection DID; in mode `routed` an outer routed
 *  message from this side's connection DID to the carrier `C` with the
 *  route [counterpart's connection DID]; in mode `direct` no outer layer.
 *  Both on the connection DID's session. */
export function depositAddressing (
  mode: SendMode, self: string, peerConnection: string, carrier: string,
): { inner: LayerAddressing, outer: LayerAddressing | null, session: string } {
  if (!SEND_MODES.has(mode)) throw new Error(`unknown send mode ${String(mode)}`)
  const inner: LayerAddressing = { messageType: 'direct', sender: self, receiver: peerConnection }
  if (mode === 'routed') {
    return {
      inner,
      outer: { messageType: 'routed', sender: self, receiver: carrier, route: [peerConnection] },
      session: self,
    }
  }
  return { inner, outer: null, session: self }
}

// ── The injected wire ────────────────────────────────────────────────
export type WireErrorKind =
  | 'unreachable' | 'refused-retriable' | 'refused-admission' | 'oversize'
  /** the mediator refused a routed deposit for its routed form, and the
   *  binding authenticated that refusal as the mediator's (RLTP-VTI-3130):
   *  the relationship switches to direct at once */
  | 'routed-refused'
  /** the carrier refused direct delivery of a deposit in mode direct
   *  (RLTP-VTI-3120): recorded in the send state, from then on the
   *  relationship deposits nothing on this carrier, across openings */
  | 'direct-refused'

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
  /** `bytes` is the JCS of the binding envelope (RLTP-VTI-3150), the
   *  payload of the inner message; `mode` is the sending form of this
   *  deposit (profile §3a): the wire packs and sends it as
   *  depositAddressing(mode, …) describes, under the connection DID. */
  deposit (accessToken: string, bytes: Uint8Array, mode: SendMode): Promise<void>
  ackReceived (accessToken: string, queueIds: string[]): Promise<void>
  /** The adapter's consumer takes the payload of a delivered TSP 1.0
   *  `direct` message and its sender VID as TSP authenticated it
   *  (RLTP-VTI-7140), and answers whether it took the frame (buffered,
   *  consumed, already held, or absorbed as a duplicate): false means the
   *  frame is left with the mediator (above max-queue-bytes, or a retired
   *  instance), and a wire must not take its queue for drained until the
   *  frame is offered again (RLTP-VTI-3130, queueEmpty). */
  onDeliver (cb: (bytes: Uint8Array, sender: string) => Promise<boolean>): void
  /** The counterpart's connection DID (RLTP-VTI-1240), the `recipient` of
   *  every carried document; null while a displayed card's instance is not
   *  bound, which deposits nothing. */
  counterpart (): string | null
  /** Optional sink for what the adapter logs and acknowledges without
   *  delivering (RLTP-VTI-5040, 7160): one line each, no secrets. */
  log? (line: string): void
  /** Optional truthful connectivity signal; absent means unknown. */
  offline? (): boolean
  /** Optional: true when the mediator holds nothing more for this
   *  connection (RLTP-VTI-3130: a conclusion that left no frame
   *  pending). Closed: absent, no collection counts as complete, so an
   *  adapter over a wire without it never switches to direct. */
  queueEmpty? (): boolean
  /** Optional: true from the moment the wire received the carrier's
   *  refusal of direct delivery (RLTP-VTI-3120), a
   *  report that arrives after the refused deposit was accepted. The
   *  adapter reads it at advance(), before every hand-over and in
   *  ackState(), and records it in the send state. Absent: the refusal
   *  reaches the adapter only as a WireError('direct-refused'). */
  directRefused? (): boolean
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
  /** held: a validated next step of the counterpart (RLTP-VTI-5050) — no
   *  give-up horizon ends it */
  | { state: 'accepted', held?: true }
  | { state: 'delivered', late: boolean }
  | { state: 'failed', reason: 'unroutable' | 'oversize' | 'expired-by-adapter-policy' }
  | { state: 'failed', reason: 'rejected-by-receiver', code: ReceiverRefusalCode }

/** The ports' DeliveryReport for a document `digest` in adapter state `st`
 *  (Delivery §6.1): one-to-one, `late` and the refusal code carried over. */
export function deliveryReportOf (digest: string, st: SubmissionState): DeliveryReport {
  switch (st.state) {
    case 'awaiting-transport': return { digest, status: 'awaiting-transport', reason: st.reason }
    case 'accepted': return st.held === true ? { digest, status: 'accepted', held: true } : { digest, status: 'accepted' }
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
/** A counterpart's answer bound to a submission of this instance
 *  (RLTP-VTI-5080): the report its outcome makes, for the host to record at
 *  the holder before it concludes the collection that carries it; the
 *  answer is acknowledged at the mediator only at that conclusion. */
export interface CollectedAnswer { queueId: string, submissionId: string, report: DeliveryReport }
export interface Collection { id: string, items: CollectedItem[], answers: CollectedAnswer[] }

/** Ack state for the host to persist (profile §4). Invariant: every
 *  pending id names a concluded entry; violations are refused at
 *  construction (fail-closed). */
export interface AckState {
  concluded: Array<{ queueId: string, concludedAt: number }>
  pending: string[]
  /** the relationship's send state (RLTP-VTI-3130); absent → `routed`. A
   *  restored mode `egress-session` (lib 0.9) is read as `direct`. */
  send?: SendState
}

/** The send state of a relationship (profile §3a, RLTP-VTI-3130),
 *  persisted with the ack state: the mode and the open routed deposits —
 *  this side's documents accepted in routed and not yet answered, each
 *  with its digest and acceptance instant. Acknowledgements are no open
 *  deposits. In direct `open` is empty. `directRefusedAt`, only in
 *  direct: the adapter instant at which the carrier refused direct
 *  delivery (RLTP-VTI-3120); while it stands nothing is handed over or
 *  deposited. Absent: not refused. */
export interface SendState {
  mode: SendMode
  open: Array<{ digest: string, acceptedAt: number }>
  directRefusedAt?: number
}

/** how long an open routed deposit stays in the send state at most
 *  (RLTP-VTI-3130): the state is bounded even where no switch check runs */
const OPEN_KEEP_MS = DECLARED.routedAckDeadlineMs + DECLARED.duplicateWindowMs

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

/** A restored send state, checked fail-closed (§4): exactly `mode` and
 *  `open` (and `directRefusedAt`, only in direct, a finite instant not
 *  after restoredAt), a known mode — `egress-session`, the name lib 0.9
 *  persisted for it, read as `direct` — each entry exactly a digest and a
 *  finite acceptance instant not after restoredAt, each digest once,
 *  nothing open in direct. Any other field — the acknowledgement fields
 *  of an earlier form included — is refused, not ignored. */
function restoreSendState (send: unknown, restoredAt: number): SendState {
  const refuse = (why: string): never => { throw new Error(`ack snapshot: send state ${why}`) }
  if (typeof send !== 'object' || send === null) return refuse('is not an object')
  const s = send as Record<string, unknown>
  const exactly = (o: object, keys: string[]): boolean => {
    const own = Object.keys(o)
    return own.length === keys.length && keys.every((k) => own.includes(k))
  }
  const refusedField = Object.prototype.hasOwnProperty.call(s, 'directRefusedAt')
  if (!exactly(s, refusedField ? ['mode', 'open', 'directRefusedAt'] : ['mode', 'open'])) refuse('has other fields than mode, open and directRefusedAt')
  const mode = s.mode === 'egress-session' ? 'direct' : s.mode
  if (refusedField && (mode !== 'direct' || !finite(s.directRefusedAt) || s.directRefusedAt > restoredAt)) {
    refuse('records a refusal of direct delivery outside direct, non-finite or after restoredAt')
  }
  if (typeof mode !== 'string' || !SEND_MODES.has(mode)) refuse('names an unknown mode')
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
  // the switch empties it: a direct send state with open deposits was never produced
  if (mode === 'direct' && open.length > 0) refuse('is direct with open routed deposits')
  return { mode: mode as SendMode, open, ...(refusedField ? { directRefusedAt: s.directRefusedAt as number } : {}) }
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
  /** the sealed envelope the holder handed over (Delivery §5) */
  seal: Envelope
  /** its first submission as the holder recorded it: the carried
   *  document's issuedAt (RLTP-VTI-3150) */
  since: number
  /** the `id` of the carried document of its last attempt: answers bind
   *  to it (RLTP-VTI-5040) */
  outerId?: string
  /** the counterpart's connection DID its carried document named as
   *  `recipient`: the one sender whose answer may change it (RLTP-VTI-5070) */
  peer?: string
  /** an accepted document the holder offers for binding answers only
   *  (RLTP-VTI-5045, Delivery RLTP-DEL-6150): never attempted, never
   *  given up here; its `outerId` is recomputed from the seal */
  bindOnly?: true
  /** the document digest, for submissions filed by reconcile */
  digest?: string
  /** the holder's entry and its gate, for submissions filed by reconcile */
  entry?: TransportEntry
  gate?: TransportGate
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

/** The sealed envelope of a value (Delivery §5): exactly its four string
 *  members, copied; anything else is refused. */
function sealOf (v: unknown): Envelope {
  const o = v as Record<string, unknown> | null
  if (o === null || typeof o !== 'object' || Array.isArray(o)) throw new TypeError('not a sealed envelope (Delivery §5)')
  const keys = Object.keys(o).sort().join(',')
  if (keys !== 'ciphertext,epk,nonce,rkid' || [o.rkid, o.epk, o.nonce, o.ciphertext].some((x) => typeof x !== 'string')) {
    throw new TypeError('not a sealed envelope (Delivery §5): exactly rkid, epk, nonce and ciphertext, strings')
  }
  return { rkid: o.rkid as string, epk: o.epk as string, nonce: o.nonce as string, ciphertext: o.ciphertext as string }
}

/** The sealed envelope of the JCS bytes submit() takes. */
function sealOfBytes (bytes: Uint8Array): Envelope {
  let v: unknown
  try { v = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new TypeError('not a sealed envelope (Delivery §5): not JSON') }
  return sealOf(v)
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
  get principal (): string { return this.#principal }
  get connectionDid (): string { return this.#connectionDid }
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

  /** payloads the adapter consumed itself (answers, ignored, RLTP-VTI-7160),
   *  concluded at its next step, when it has a clock */
  #consumed = new Set<string>()
  /** answers received and not yet decided (RLTP-VTI-5045): unacknowledged */
  #answers = new Map<string, { reading: Extract<BindingReading, { kind: 'error' | 'next-step' }>, sender: string }>()
  /** answers bound and applied, waiting for a collection (RLTP-VTI-5080) */
  #bound: CollectedAnswer[] = []
  /** the bound answers of each outstanding collection */
  #outstandingAnswers = new Map<string, CollectedAnswer[]>()
  /** every answer held in one of the three registers above */
  #answerIds = new Set<string>()
  /** the instance has the holder's view (a reconcile) or a submission */
  #viewKnown = false
  /** id computations in flight (RLTP-VTI-5045) */
  #indexing = 0
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
  /** RLTP-VTI-3120: when the carrier refused direct delivery; null: never */
  #directRefusedAt: number | null = null
  /** open routed deposits (documents), keyed by digest */
  #openDeposits = new Map<string, number>()
  /** this instance has concluded a collection that left nothing pending */
  #cleanConcluded = false

  /** The only way to build an adapter: the pair is DERIVED here from
   *  one root, one carrier, one nonce — so principal and connection DID
   *  cannot come from different relationships (R7-B2: the coupling is
   *  enforced by construction, not by inspecting caller-supplied
   *  identities). */
  static async create (
    rootIkm: Uint8Array, carrier: string, nonce: Uint8Array,
    wire: MediatorWire, restored?: AckState, restoredAt?: number,
  ): Promise<MediatorCarrierAdapter> {
    // ONE tuple, snapshotted at entry: a caller mutating its buffers
    // between the awaited derivations must not be able to mix
    // identities from two tuples (R8-B2)
    const ikm = new Uint8Array(rootIkm)
    const n = new Uint8Array(nonce)
    const principal = await carrierPrincipal(ikm, carrier, n)
    const connection = await carrierScopedIdentity(ikm, carrier, n, 'connection')
    return new MediatorCarrierAdapter(KEY, principal, connection, wire, restored, restoredAt)
  }

  constructor (
    key: symbol,
    principal: CarrierPrincipal,
    connection: CarrierScopedIdentity,
    wire: MediatorWire,
    restored?: AckState,
    restoredAt?: number,
  ) {
    if (key !== KEY) {
      throw new Error('use MediatorCarrierAdapter.create — the identities must be derived, not supplied (5a.10)')
    }
    if (connection.scope !== 'connection') {
      throw new Error('the scoped identity passed in the wrong role')
    }
    if (principal.principal === connection.did) {
      throw new Error('principal and connection DID must be distinct (5a.10)')
    }
    this.#principal = principal.principal
    this.#connectionDid = connection.did
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
        if (send.directRefusedAt !== undefined) this.#directRefusedAt = send.directRefusedAt
        // an open deposit falls routed-ack-deadline plus duplicate-window
        // after its acceptance: cut here, not refused
        for (const o of send.open) if (restoredAt - o.acceptedAt < OPEN_KEEP_MS) this.#openDeposits.set(o.digest, o.acceptedAt)
      }
    }
    this.#wire.onDeliver(async (raw, sender): Promise<boolean> => {
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
      // buffered, outstanding and consumed go before concluded (§3): a
      // redelivery of a later copy the holder has not concluded yet is
      // ignored
      if (this.#inboxDigests.has(queueId) || this.#consumed.has(queueId) || this.#answerIds.has(queueId)) return true
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
      // the payload read with its authenticated sender (RLTP-VTI-7160)
      const reading = await readBindingEnvelope(bytes, { sender: String(sender), self: this.#connectionDid })
      if (this.#closed) return false
      if (this.#inboxDigests.has(queueId) || this.#consumed.has(queueId) || this.#answerIds.has(queueId)) return true
      // an answer is held, unacknowledged, until it is decided against the
      // ids of every open document (RLTP-VTI-5045); beyond the floor it
      // stays with the mediator
      if (reading.kind === 'error' || reading.kind === 'next-step') {
        if (this.#answers.size >= DECLARED.queueFloorCount) return false
        this.#answers.set(queueId, { reading, sender: String(sender) })
        this.#answerIds.add(queueId)
        this.#decideAnswers()
        return true
      }
      if (reading.kind === 'ignored') {
        this.#log(`payload from ${String(sender)} not delivered: ${reading.why} (acknowledged)`)
        this.#consumed.add(queueId)
        return true
      }
      // the seal, as the holder's receive takes it (Delivery §5, RLTP-DEL-5030)
      const item = new TextEncoder().encode(jcs(reading.seal as unknown as Json))
      const held = this.#inboxBytes + this.#outstandingBytes
      const underFloor = this.#inbox.length < DECLARED.queueFloorCount &&
        held + item.length <= DECLARED.queueFloorBytes
      const underCap = held + item.length <= DECLARED.maxQueueBytes
      // not acknowledged and not taken: the mediator keeps its copy
      if (!underFloor && !underCap) return false
      this.#inbox.push({ bytes: item, queueId })
      this.#inboxBytes += item.length
      this.#inboxDigests.add(queueId)
      return true
    })
  }

  #log (line: string): void {
    try { this.#wire.log?.(`[vti-adapter] ${line}`) } catch { /* a sink's failure is not the adapter's */ }
  }

  /** Bind-and-apply (RLTP-VTI-5040, 5045, 5070): the submission of this
   *  instance whose carried document's id the answer names, if its
   *  authenticated sender is the recipient that carried document named;
   *  the outcome applied to it: a terminal refusal fails it, a retryable
   *  one bounds its next attempt, idConflict answers it, a next step makes
   *  it accepted and held (RLTP-VTI-5050). Answers the submission it
   *  changed (a document), or null where it binds nothing. */
  #bindAndApply (reading: Extract<BindingReading, { kind: 'error' | 'next-step' }>, sender: string): Submission | null {
    let sub: Submission | undefined
    for (const x of this.#subs.values()) if (x.outerId !== undefined && x.outerId === reading.answers) { sub = x; break }
    if (sub === undefined) {
      this.#log(`answer from ${sender} binds no submission of this instance (${reading.kind}, ${reading.answers}): acknowledged`)
      return null
    }
    // the transition is the counterpart's alone, whatever the wire filtered (RLTP-VTI-5070)
    if (sub.peer === undefined || sender !== sub.peer) {
      this.#log(`answer from ${sender}, not the recipient of the document it names (${reading.kind}): acknowledged, nothing changes`)
      return null
    }
    // an acknowledgement has no trias (Delivery 6.1): an answer to one changes nothing (RLTP-VTI-5040)
    if (!this.#isDocument(sub)) {
      this.#log(`answer from ${sender} to a carried acknowledgement (${reading.kind}): acknowledged, nothing changes`)
      return null
    }
    if (reading.kind === 'next-step') {
      this.#answer(sub)
      const terminal = sub.st !== null && (sub.st.state === 'delivered' || sub.st.state === 'failed')
      const held = sub.st !== null && sub.st.state === 'accepted' && sub.st.held === true
      if (!terminal && !held) sub.st = { state: 'accepted', held: true }
      return sub
    }
    const r = reading.reading
    switch (r.verdict) {
      case 'refused': this.receiverRefused(sub.id, r.code); return sub
      case 'retry': this.receiverRetry(sub.id, r.retryAfter); return null
      case 'answered': this.#answer(sub); return null
      case 'none': return null
    }
  }

  /** Decides every held answer, once the instance knows the holder's view
   *  and every open document has its id (RLTP-VTI-5045): one bound to a
   *  document of the holder waits in a collection until the host recorded
   *  its report (RLTP-VTI-5080); every other is acknowledged at the next
   *  step. Every answer takes this one path, whatever the opening's state. */
  #decideAnswers (): void {
    if (this.#closed || !this.#viewKnown || this.#indexing > 0) return
    for (const [queueId, { reading, sender }] of this.#answers) {
      this.#answers.delete(queueId)
      const sub = this.#bindAndApply(reading, sender)
      const report = sub !== null && sub.digest !== undefined ? this.report(sub.id) : null
      if (sub !== null && report !== null) this.#bound.push({ queueId, submissionId: sub.id, report })
      else { this.#answerIds.delete(queueId); this.#consumed.add(queueId) }
    }
  }

  /** The id of the carried document of every filed submission that has
   *  none yet, from its seal and both connection DIDs (Delivery
   *  RLTP-DEL-4620; RLTP-VTI-5045) — custody and offered alike, whether
   *  or not an attempt runs — then the held answers are decided. */
  #index (): void {
    this.#viewKnown = true
    this.#indexing++
    this.#track((async () => {
      try {
        await Promise.resolve()
        let peer: unknown
        try { peer = this.#wire.counterpart() } catch { peer = null }
        if (typeof peer === 'string' && peer.length > 0) {
          for (const s of [...this.#subs.values()]) {
            if (s.outerId !== undefined) continue
            const id = await sealedEnvelopeId(s.seal, this.#connectionDid, peer)
            if (s.outerId === undefined) { s.outerId = id; s.peer = peer }
          }
        }
      } finally {
        this.#indexing--
        this.#decideAnswers()
      }
    })())
  }

  /** The payloads consumed since the last step become concluded entries
   *  with their ack intent (§3): at a step, when the adapter has a clock. */
  #concludeConsumed (now: number): void {
    for (const id of this.#consumed) {
      this.#concluded.set(id, now)
      this.#pendingAcks.add(id)
    }
    this.#consumed.clear()
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
  /** Takes the JCS bytes of a sealed envelope (Delivery §5) and returns
   *  the submission id synchronously; bytes that are no sealed envelope
   *  are refused at once. Its carried document's issuedAt is this call's
   *  instant. Before the first honest report exists, status() returns
   *  null — §6.1's own pre-report window, represented as absence, not as
   *  a value. */
  submit (envelopeBytes: Uint8Array, rawNow: number): string {
    this.#open()
    const seal = sealOfBytes(envelopeBytes)
    const now = this.#now(rawNow)
    const id = 's' + this.#nextId++
    const knownOffline = this.#wire.offline?.() === true
    const sub: Submission = {
      id,
      seal,
      since: now,
      submittedAt: now,
      attemptStartedAt: null,
      lastKind: null,
      st: null,
      sentMode: null,
    }
    this.#subs.set(id, sub)
    if (!knownOffline) this.#startAttempt(sub, now)
    this.#index()
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
        seal: sealOf(entry.envelope),
        // the carried document's issuedAt: the first submission as the
        // holder recorded it (an ack: its effect's commit), never this
        // hand-over (RLTP-VTI-3150)
        since: entry.since,
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
    // the accepted documents the holder offers for binding answers only
    // (RLTP-VTI-5045, Delivery RLTP-DEL-6150): filed in their state, never
    // attempted; one this instance already holds is not filed twice
    const answerable: readonly AnswerableEntry[] = Array.isArray((view as { answerable?: unknown }).answerable) ? view.answerable : []
    for (const a of answerable) {
      if (a === null || typeof a !== 'object' || typeof a.digest !== 'string' || !Number.isFinite(a.since)) continue
      let held = false
      for (const s of this.#subs.values()) if (s.digest === a.digest && s.entry?.resend === undefined) { held = true; break }
      if (held) continue
      let seal: Envelope
      try { seal = sealOf(a.envelope) } catch { continue }
      const id = 's' + this.#nextId++
      this.#subs.set(id, {
        id, digest: a.digest, gate, seal, since: a.since, submittedAt: a.since,
        attemptStartedAt: null, lastKind: null, sentMode: null, bindOnly: true,
        st: a.held === true ? { state: 'accepted', held: true } : { state: 'accepted' },
      })
      refs.push({ submissionId: id, digest: a.digest })
    }
    // every open document gets its id; the held answers are decided then (RLTP-VTI-5045)
    this.#index()
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
    if (sub.attemptStartedAt !== null || sub.bindOnly === true) return
    // a counterpart's retryAfter is the lower bound of the next attempt (RLTP-VTI-5010)
    if (sub.notBefore !== undefined && now < sub.notBefore) return
    sub.attemptStartedAt = now
    this.#track(this.#trySend(sub, now).finally(() => { sub.attemptStartedAt = null }))
  }

  /** RLTP-VTI-3120: the carrier refused direct delivery and the
   *  relationship is in direct — nothing is handed over. Reads the
   *  wire's signal first, so a refusal received after an accepted deposit
   *  is recorded before anything else is handed over. */
  #directRefused (): boolean {
    this.#readDirectRefusal()
    return this.#directRefusedAt !== null && this.#mode === 'direct'
  }

  /** The wire's signal of a refusal of direct delivery (MediatorWire.
   *  directRefused), recorded once, in direct only, at the
   *  adapter clock. */
  #readDirectRefusal (): void {
    if (this.#directRefusedAt !== null || this.#mode !== 'direct' || !Number.isFinite(this.#clock)) return
    if (this.#wire.directRefused?.() === true) this.#directRefusedAt = this.#clock
  }

  async #trySend (sub: Submission, now: number): Promise<void> {
    if (sub.st !== null && sub.st.state !== 'awaiting-transport') return
    if (this.#directRefused()) {
      // no hand-over, no deposit: the submission stays in the holder's
      // custody and fails at its horizon like any retriable refusal (§5)
      sub.lastKind = 'refused-retriable'
      sub.st = { state: 'awaiting-transport', reason: 'carrier-refused-retriable' }
      return
    }
    let next: SubmissionState
    let routedRefused = false
    try {
      // the carried document of this attempt (RLTP-VTI-3150): a function of
      // the seal, both connection DIDs and `since`, so every attempt carries
      // the same bytes; without a counterpart (a displayed card's instance
      // not yet bound) nothing is deposited
      const peer = this.#wire.counterpart()
      if (typeof peer !== 'string' || peer.length === 0) throw new WireError('unreachable', 'no counterpart: nothing is deposited before the instance is bound')
      const carried = await wrapSealed(sub.seal, { issuer: this.#connectionDid, recipient: peer, since: sub.since })
      sub.outerId = carried.outerId
      sub.peer = peer
      const token = await this.#ensureAuth(now)
      if (this.#closed) return   // retirement between auth and deposit: nothing new starts (R5-B2)
      // each attempt hands the wire a copy: what it does with it never reaches the next.
      // The mode is read at the hand-over itself: from a switch on, every
      // hand-over uses the new mode, and a call already made ends in its own
      // (RLTP-VTI-3135)
      const deposit = (): Promise<void> => {
        sub.sentMode = this.#mode
        try { return this.#wire.deposit(token, new Uint8Array(carried.bytes), sub.sentMode) } catch (e) { return Promise.reject(e) }
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
        let refusedNow = false
        const entry = sub.entry!
        const start = (): boolean => {
          if (this.#directRefused()) { refusedNow = declined = true; return false }
          if (this.#closed || this.#subs.get(sub.id) !== sub || sub.gate!.closed === true ||
              (sub.st !== null && sub.st.state !== 'awaiting-transport') || this.#clock >= entry.notAfter ||
              this.#clock - sub.submittedAt >= DECLARED.giveUpHorizonMs) { declined = true; return false }
          started = deposit().then(() => null, (e: unknown) => ({ failed: e }))
          return true
        }
        let ok: boolean | null
        try { ok = await sub.gate.handOver(entry, this.#clock, start) } catch { ok = null }
        if (started === null) {
          // the refusal of direct delivery was recorded while this hand-over
          // was under way: reported as every later submission is (RLTP-VTI-3120)
          if (refusedNow && this.#subs.get(sub.id) === sub && (sub.st === null || sub.st.state === 'awaiting-transport')) {
            sub.lastKind = 'refused-retriable'
            sub.st = { state: 'awaiting-transport', reason: 'carrier-refused-retriable' }
            return
          }
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
      // a refusal of direct delivery (RLTP-VTI-3120): recorded in the send
      // state, so it survives openings; the submission stays a retriable refusal
      if (kind === 'direct-refused') {
        if (sub.sentMode === 'direct' && this.#directRefusedAt === null) this.#directRefusedAt = this.#clock
        kind = 'refused-retriable'
      }
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
    if (routedRefused) this.#switchToDirect()
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
  #switchToDirect (): void {
    this.#mode = 'direct'
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
    this.#concludeConsumed(this.#now(rawNow))
    if (this.#inbox.length === 0 && this.#bound.length === 0) return { id: 'c-empty', items: [], answers: [] }
    const items = this.#inbox.splice(0)
    const answers = this.#bound.splice(0)
    this.#outstandingBytes += this.#inboxBytes
    this.#inboxBytes = 0
    this.#inboxDigests.clear()
    const id = 'c' + this.#nextColId++
    this.#outstanding.set(id, new Map(items.map((i) => [i.queueId, i])))
    this.#outstandingAnswers.set(id, answers)
    // the caller gets its own copies: the outstanding entries stay intact,
    // whatever it does with the bytes, for a conclusion that keeps them
    return { id, items: items.map((i) => ({ ...i, bytes: new Uint8Array(i.bytes) })), answers: answers.map((a) => ({ ...a, report: { ...a.report } })) }
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
    this.#concludeConsumed(now)
    const col = this.#outstanding.get(collection.id)
    // the bound answers: acknowledged now, the host having recorded their
    // reports (RLTP-VTI-5080); a kept one waits for the next collection
    const ans = this.#outstandingAnswers.get(collection.id)
    if (ans !== undefined) {
      this.#outstandingAnswers.delete(collection.id)
      const keepA = new Set(opts.keep ?? [])
      for (const a of ans) {
        if (keepA.has(a.queueId)) { this.#bound.push(a); continue }
        this.#answerIds.delete(a.queueId)
        this.#concluded.set(a.queueId, now)
        this.#pendingAcks.add(a.queueId)
      }
    }
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
    return this.#wire.queueEmpty?.() === true && this.#inbox.length === 0 && this.#outstanding.size === 0 &&
      this.#answers.size === 0 && this.#bound.length === 0 && this.#outstandingAnswers.size === 0
  }

  /** After a conclusion (RLTP-VTI-3130): when it left nothing pending,
   *  the switch check may run in a later advance. */
  #concludedClean (): void {
    if (!this.#nothingPending()) return
    this.#cleanConcluded = true
  }

  ackState (): AckState {
    this.#readDirectRefusal()
    return {
      concluded: [...this.#concluded].map(([queueId, concludedAt]) => ({ queueId, concludedAt })),
      pending: [...this.#pendingAcks],
      send: {
        mode: this.#mode,
        open: [...this.#openDeposits].map(([digest, acceptedAt]) => ({ digest, acceptedAt })),
        ...(this.#directRefusedAt === null ? {} : { directRefusedAt: this.#directRefusedAt }),
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
        // a late-returning wire mutates nothing (R17-B2) — except the
        // refusal of direct delivery ackState() reads (RLTP-VTI-3120).
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
    this.#readDirectRefusal()
    this.#concludeConsumed(now)
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
        if (now - acceptedAt >= DECLARED.routedAckDeadlineMs) { this.#switchToDirect(); break }
      }
    }
    for (const sub of this.#subs.values()) {
      const live = sub.st === null || sub.st.state === 'awaiting-transport' || sub.st.state === 'accepted'
      if (!live || sub.bindOnly === true) continue
      // held (RLTP-VTI-5050): the counterpart said it has the document; no
      // horizon ends it, only an acknowledgement or a terminal refusal
      if (sub.st !== null && sub.st.state === 'accepted' && sub.st.held === true) continue
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
