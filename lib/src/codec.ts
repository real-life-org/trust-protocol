// codec — the HolderState storage format (lib Stage 2, note §2.2).
//
// decodeState is the one way in: JSON purity, then the codec version, then
// the pure migration chain vN → vN+1, each step running between two states
// validated by their codec's own validator (hand-written; no schema engine
// in the published library). The validators check shape and a few local
// consistency rules; referential and domain invariants (active heads,
// register monotony, matching revisions) are the engine's (invariants.ts).
// An unknown or higher codec is refused, never read best-effort. Store
// adapters keep bytes or JSON and never migrate themselves. Wire
// versions and the codec are independent; a migration never re-issues
// stored documents, outbound or acks.
//
// Codec 0 is unstable until 0.4.0: persistence across library versions
// is not supported before then. From 0.4.0 every codec gets a golden
// fixture and a migration test.
import { jcs } from './core.js'
import type { Duty, HolderState, KnownDuty } from './state.js'
import type { HolderEventType } from './events.js'

/** The codec this library writes. */
export const CODEC = 0

/**
 * Migrations keyed by the codec they read: MIGRATIONS[n] maps a valid
 * codec-n state to a codec-(n+1) state. Pure, never async, never keys.
 */
export const MIGRATIONS: Readonly<Record<number, (state: any) => any>> = Object.freeze({})

/** A codec's structural validator: throws StateCodecError('shape') or returns. */
export type StateValidator = (raw: unknown) => void

/** One codec chain: the target codec, its migrations and a validator for
 *  every codec from the oldest readable one up to the target. */
export interface CodecChain {
  codec: number
  migrations: Readonly<Record<number, (state: any) => any>>
  validators: Readonly<Record<number, StateValidator>>
}

export type StateCodecErrorCode = 'not-json' | 'codec-unknown' | 'codec-newer' | 'shape'

/** A stored state the library will not load (or a state it will not write). */
export class StateCodecError extends Error {
  readonly code: StateCodecErrorCode
  /** JSON path of the offending value, for 'shape' */
  readonly path?: string
  constructor (code: StateCodecErrorCode, message: string, path?: string) {
    super(path === undefined ? `${code}: ${message}` : `${code} at ${path}: ${message}`)
    this.name = 'StateCodecError'
    this.code = code
    if (path !== undefined) this.path = path
  }
}

// ── the validator kit ──────────────────────────────────────────────────
type V = (x: unknown, path: string) => void

const fail = (path: string, msg: string): never => { throw new StateCodecError('shape', msg, path) }
const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)

const str: V = (x, p) => { if (typeof x !== 'string') fail(p, 'string expected') }
const bool: V = (x, p) => { if (typeof x !== 'boolean') fail(p, 'boolean expected') }
const json: V = () => {}                                     // JSON purity is checked once, up front
const dec: V = (x, p) => { if (typeof x !== 'string' || !/^(0|[1-9][0-9]{0,17})$/.test(x)) fail(p, 'canonical decimal string expected') }
const millis: V = (x, p) => { if (!Number.isSafeInteger(x) || (x as number) < 0) fail(p, 'non-negative integer milliseconds expected') }
const natural: V = (x, p) => { if (!Number.isSafeInteger(x) || (x as number) < 0) fail(p, 'non-negative integer expected') }
const positive: V = (x, p) => { if (!Number.isSafeInteger(x) || (x as number) < 1) fail(p, 'positive integer expected') }
const lit = (...vals: unknown[]): V => (x, p) => { if (!vals.includes(x)) fail(p, 'one of ' + vals.map((v) => JSON.stringify(v)).join(', ') + ' expected') }
const nullable = (v: V): V => (x, p) => { if (x !== null) v(x, p) }
const arr = (v: V): V => (x, p) => {
  if (!Array.isArray(x)) fail(p, 'array expected')
  ;(x as unknown[]).forEach((e, i) => v(e, `${p}[${i}]`))
}
/** an array used as a set: no duplicates */
const set = (v: V): V => (x, p) => {
  arr(v)(x, p)
  if (new Set((x as unknown[]).map((e) => jcs(e))).size !== (x as unknown[]).length) fail(p, 'duplicate set element')
}
const rec = (v: V): V => (x, p) => {
  if (!isObj(x)) fail(p, 'object expected')
  for (const [k, e] of Object.entries(x as Record<string, unknown>)) v(e, `${p}.${k}`)
}
/** a closed object: required fields, optional fields, nothing else */
const obj = (req: Record<string, V>, opt: Record<string, V> = {}): V => (x, p) => {
  if (!isObj(x)) fail(p, 'object expected')
  const o = x as Record<string, unknown>
  for (const k of Object.keys(req)) {
    if (!Object.hasOwn(o, k)) fail(`${p}.${k}`, 'missing')
    req[k](o[k], `${p}.${k}`)
  }
  for (const k of Object.keys(o)) {
    if (Object.hasOwn(req, k)) continue
    if (!Object.hasOwn(opt, k)) fail(`${p}.${k}`, 'unknown field')
    opt[k](o[k], `${p}.${k}`)
  }
}
/** a record whose values carry their own key in `idField` */
/** a JSON object, contents open */
const anyObj: V = (x, p) => { if (!isObj(x)) fail(p, 'object expected') }
const keyed = (v: V, idField: string): V => (x, p) => {
  rec(v)(x, p)
  for (const [k, e] of Object.entries(x as Record<string, Record<string, unknown>>)) if (e[idField] !== k) fail(`${p}.${k}.${idField}`, 'must equal its key')
}

// ── the HolderState shape (state.ts) ───────────────────────────────────
const setting = lit('default', 'on', 'off')
const trustClass = lit('star', 'groupStar', 'anchorMapping', 'sealedGroupStar', 'profile')
const recipient = obj({ contactId: str, rkid: str, keyAgreement: str })
const envelope = obj({ rkid: str, epk: str, nonce: str, ciphertext: str })
const assembly = obj({ salt: dec, chunks: rec(json) })
const seqOut = (item: V): V => obj({
  lastSalt: dec, exhausted: bool, hwm: dec, snapshot: nullable(arr(item)),
  inflight: rec(obj({ view: arr(item), digests: arr(str), acked: arr(str) })),
})
const seqIn = (accepted: V): V => obj({ hwm: dec, lowerBound: dec, assembly: nullable(assembly), accepted: nullable(accepted) })
const starPair = obj({ member: str, head: str })
const groupStarItem: V = (x, p) => {
  if (isObj(x) && x.mode === 'sealed') return obj({ group: str, mode: str, member: str, memberOp: str })(x, p)
  obj({ group: str, mode: lit('digest') })(x, p)
}
const starOut = seqOut(starPair)
const starIn = seqIn(obj({ salt: dec, blinded: arr(str) }))
const groupStarOut = seqOut(groupStarItem)
const groupStarIn = seqIn(obj({ salt: dec, entries: arr(obj({ d: str, c: str })) }))
const continuityDue: V = (x, p) => {
  if (isObj(x) && x.kind === 'choice') return obj({ kind: str, prior: str, alts: arr(str) })(x, p)
  obj({ kind: lit('report', 'align'), prior: str })(x, p)
}
const logHead: V = (x, p) => {
  if (isObj(x) && Object.hasOwn(x, 'empty')) return obj({ genesis: str, empty: lit(true) })(x, p)
  obj({ genesis: str, entryId: str, gen: positive, next: str, commit: str })(x, p)
}

const tuple = obj({
  ownPairLabel: str, counterpartAnchor: str, counterpartKeyAgreement: str, rkid: str, entryId: str,
  priorCandidates: arr(obj({ ownPairLabel: str, counterpartAnchor: str })),
  starOut, starIn, groupStarOut, groupStarIn,
  probeOut: obj({ seq: dec }),
  probeIn: obj({ hwm: dec, lowerBound: dec, assembly: nullable(assembly) }),
  continuityOut: obj({ rev: dec, body: json, chosen: nullable(str), reported: nullable(str), aligned: bool, due: nullable(continuityDue) }),
  continuityIn: obj({ rev: dec, body: json, recordPrior: nullable(str) }),
  mappingOut: obj({ rev: dec, body: json, underAnchor: nullable(str) }),
  mappingIn: obj({ rev: dec, body: json, self: nullable(str), card: json }),
  profileIn: obj({ rev: dec, body: json, verifiedSeq: dec }),
  deactivated: bool,
})

const relationship = obj({
  id: str, contactId: str, tuples: arr(tuple), activeHead: str, earliestAnchor: nullable(str),
  links: arr(obj({ prev: str, next: str })), bindings: rec(str), heldCounterpartHead: nullable(str),
  memory: rec(json), provenance: obj({ kind: lit('ceremony', 'introduced'), at: millis }, { via: str }),
  chainedInto: nullable(str),
})

const contact = obj({
  id: str, pos: nullable(dec), status: lit('none', 'admitted', 'pending'), aliases: set(str), relIds: set(str),
  anchorHead: nullable(str),
  settings: obj({ star: setting, groupStar: setting, anchorMapping: setting, sealedGroupStar: setting, profile: setting }),
  groupSettings: rec(setting),
})

const outboxStep: V = (x, p) => {
  if (!isObj(x)) fail(p, 'object expected')
  const s = x as Record<string, unknown>
  switch (s.status) {
    case 'submitted': return obj({ status: str, at: millis, attempt: positive })(x, p)
    case 'awaiting-transport': return obj({ status: str, at: millis, reason: lit('offline', 'transport-unreachable', 'carrier-refused-retriable') })(x, p)
    case 'accepted': return obj({ status: str, at: millis })(x, p)
    case 'delivered': return obj({ status: str, at: millis, late: bool })(x, p)
    case 'failed': return s.reason === 'rejected-by-receiver'
      ? obj({ status: str, at: millis, reason: str, code: lit('malformedRequest', 'unsupportedType', 'proofRequired', 'proofInvalid', 'wrongRecipient', 'identityMismatch') })(x, p)
      : obj({ status: str, at: millis, reason: lit('unroutable', 'oversize', 'expired-by-adapter-policy') })(x, p)
    default: fail(`${p}.status`, 'unknown outbox status')
  }
}

const outboxShape = obj({
  type: str, threadId: str, recipient, envelope, attempt: positive, history: arr(outboxStep),
}, { nextAttemptAt: millis })
/** the envelope is sealed to the counterpart key, never to the own rkid */
const outboxItem: V = (x, p) => {
  outboxShape(x, p)
  const o = x as { recipient: { keyAgreement: string }, envelope: { rkid: string } }
  if (o.envelope.rkid !== o.recipient.keyAgreement) fail(`${p}.envelope.rkid`, 'must equal recipient.keyAgreement')
}

const DUE = { dueAt: millis }
/** a retained ack: sealed to the counterpart key, like an outbox item */
const storedAck: V = (x, p) => {
  obj({ digest: str, envelope, threadId: str, recipient, sent: bool })(x, p)
  const a = x as { recipient: { keyAgreement: string }, envelope: { rkid: string } }
  if (a.envelope.rkid !== a.recipient.keyAgreement) fail(`${p}.envelope.rkid`, 'must equal recipient.keyAgreement')
}

const KNOWN_DUTIES: Record<KnownDuty['kind'], { v: number, shape: V }> = {
  'reissue-mapping': { v: 1, shape: obj({ kind: str, v: positive, id: str, contactId: str, relId: str, awaitHead: nullable(str) }, DUE) },
  'class-on': { v: 1, shape: obj({ kind: str, v: positive, id: str, contactId: str, relId: str, cls: trustClass }, DUE) },
  profile: { v: 1, shape: obj({ kind: str, v: positive, id: str, contactId: str, relId: str, rev: dec }, DUE) },
  continuity: { v: 1, shape: obj({ kind: str, v: positive, id: str, relId: str, tuple: str, step: lit('probe', 'mapping') }, DUE) },
  merge: { v: 1, shape: obj({ kind: str, v: positive, id: str, entryIds: set(str), relId: str }, DUE) },
}

/** Is this a duty kind and version this library handles? Unknown ones are kept as they are. */
export const isKnownDuty = (d: Duty): d is KnownDuty =>
  Object.hasOwn(KNOWN_DUTIES, d.kind) && KNOWN_DUTIES[d.kind as KnownDuty['kind']].v === d.v

const duty: V = (x, p) => {
  if (!isObj(x)) fail(p, 'object expected')
  const d = x as Record<string, unknown>
  str(d.kind, `${p}.kind`); natural(d.v, `${p}.v`); str(d.id, `${p}.id`)
  if (isKnownDuty(d as unknown as Duty)) KNOWN_DUTIES[d.kind as KnownDuty['kind']].shape(x, p)
}

const EVENT_FIELDS: Record<HolderEventType, [Record<string, V>, Record<string, V>?]> = {
  'contact.added': [{ contactId: str }],
  'contact.verified': [{ contactId: str, relationshipId: str }],
  'contact.chained': [{ contactId: str, relationshipId: str }],
  'trust.given': [{ contactId: str }],
  'trust.received': [{ contactId: str }],
  'trust.paused': [{ contactId: str, paused: bool }],
  'group.joined': [{ groupId: str }],
  'prompt.opened': [{ promptId: str, kind: lit('encounter-confirm', 'group-invite', 'introduction') }],
  'prompt.decided': [{ promptId: str, kind: lit('encounter-confirm', 'group-invite', 'introduction'), choice: lit('accept', 'decline') }],
  'delivery.status': [{ digest: str, threadId: str, status: lit('submitted', 'accepted', 'delivered', 'failed') }, { late: bool }],
  'profile.updated': [{ contactId: nullable(str) }],
  'anchor.rotated': [{ generation: dec }],
  'duty.unsupported': [{ dutyId: str, kind: str, v: natural }],
}
const event: V = (x, p) => {
  if (!isObj(x)) fail(p, 'object expected')
  const t = (x as Record<string, unknown>).type
  if (typeof t !== 'string' || !Object.hasOwn(EVENT_FIELDS, t)) fail(`${p}.type`, 'unknown event type')
  const [req, opt = {}] = EVENT_FIELDS[t as HolderEventType]
  obj({ type: str, eventId: str, commitSeq: dec, ...req }, { actId: str, ...opt })(x, p)
}

const codec0 = obj({
  codec: lit(0),
  commitSeq: dec,
  lastWhen: millis,
  register: obj({
    labels: set(str), pairNonces: rec(str),
    carriers: rec(arr(obj({ nonce: str, generation: dec }))),
    devices: obj({ names: set(str), revoked: set(str) }),
    community: nullable(obj({ genesis: str, head: dec })),
    lineage: arr(anyObj),
  }),
  addresses: obj({ keys: rec(obj({ label: str, lastShown: millis }, { retiredAt: millis })), tombstones: set(str) }),
  contacts: keyed(contact, 'id'),
  relationships: keyed(relationship, 'id'),
  entryOrder: obj({ nextPos: dec, heads: set(str) }),
  groups: keyed(obj({ id: str, memberLabel: str, rules: obj({ vouchThreshold: dec }), listed: bool, membership: json }), 'id'),
  profile: obj({ body: json, revision: dec }),
  effects: rec(obj({ ack: nullable(storedAck), expiresAt: millis })),
  outbox: rec(outboxItem),
  duties: keyed(duty, 'id'),
  rotations: keyed(obj({
    id: str, from: dec, to: dec, step: lit('register', 'log', 'duties'), startedAt: millis,
    entry: json, overHead: logHead, awaitHead: rec(nullable(str)),
  }), 'id'),
  prompts: keyed(obj({ id: str, kind: lit('encounter-confirm', 'group-invite', 'introduction'), openedAt: millis }, { contactId: str, groupId: str, expiresAt: millis }), 'id'),
  acts: keyed(obj({ actId: str, inputHash: str, commitSeq: dec, outboundDigests: arr(str), events: arr(event), at: millis }), 'actId'),
  encounter: obj({ challenges: rec(json), records: rec(json), introductions: rec(json) }),
})

/** Structural validators per codec version; every readable codec has one. */
export const VALIDATORS: Readonly<Record<number, StateValidator>> = Object.freeze({
  0: (raw: unknown) => codec0(raw, '$'),
})

// ── the codec ──────────────────────────────────────────────────────────

/** Canonical JSON text of a JSON-pure value, or not-json. */
const canonical = (x: unknown): string => {
  try { return jcs(x) } catch (e) { throw new StateCodecError('not-json', (e as Error).message) }
}

const validatorOf = (chain: CodecChain, c: number): StateValidator => {
  const v = chain.validators[c]
  if (!v) throw new StateCodecError('codec-unknown', `no validator for codec ${c}`)
  return v
}

/**
 * Decode under an explicit chain: JSON purity, codec gate, then
 * validate(c) → migrate(c) → validate(c+1) … up to chain.codec. Returns
 * an independent copy. decodeState is this function over the library's
 * own chain; tests drive it with fake chains.
 */
export function decodeChain (raw: unknown, chain: CodecChain): unknown {
  let x = raw
  if (typeof raw === 'string') {
    try { x = JSON.parse(raw) } catch (e) { throw new StateCodecError('not-json', (e as Error).message) }
  }
  let s = JSON.parse(canonical(x)) as unknown
  if (!isObj(s)) fail('$', 'object expected')
  const at = (s as { codec?: unknown }).codec
  if (!Number.isSafeInteger(at) || (at as number) < 0) throw new StateCodecError('codec-unknown', 'codec must be a non-negative integer')
  if ((at as number) > chain.codec) throw new StateCodecError('codec-newer', `codec ${at} is newer than ${chain.codec}`)
  validatorOf(chain, at as number)(s)
  for (let c = at as number; c < chain.codec; c++) {
    const up = chain.migrations[c]
    if (!up) throw new StateCodecError('codec-unknown', `no migration from codec ${c}`)
    s = JSON.parse(canonical(up(JSON.parse(canonical(s)))))
    if (!isObj(s) || s.codec !== c + 1) fail('$.codec', `migration ${c} must produce codec ${c + 1}`)
    validatorOf(chain, c + 1)(s)
  }
  return s
}

const LIBRARY_CHAIN: CodecChain = { codec: CODEC, migrations: MIGRATIONS, validators: VALIDATORS }

/**
 * Load a stored state: a JSON string or an already parsed value. Returns
 * an independent copy at the current codec, or throws StateCodecError.
 */
export function decodeState (raw: unknown): HolderState {
  return decodeChain(raw, LIBRARY_CHAIN) as HolderState
}

/** Serialize a state for storage: canonical JSON, validated first. */
export function encodeState (state: HolderState): string {
  const text = canonical(state)
  validatorOf(LIBRARY_CHAIN, CODEC)(JSON.parse(text))
  return text
}

/** Deterministic equality of two states (their JCS forms). */
export const sameState = (a: HolderState, b: HolderState): boolean => jcs(a) === jcs(b)
