// introduction — the pure forms and checks of the Introduction Act (Trust
// Layer 0.31 §8) and of the registry declaration that publishes the
// mediator's ack-delay (Delivery 0.81 §4.4), shared by the holder's
// introduction module (introduction/holder.ts). State-free: which acts a
// holder holds, its pins and lifecycles, are the module's.
//
// Artifacts (2.1): `{ body, proof }`, canonical bytes JCS(body);
// introduction-request@1 and -reply@1 carry a raw Ed25519 `proofValue`
// under the fresh card's anchor (2450), -ack@1 and -voucher@1 a `mac`,
// HMAC-SHA-256 under HKDF(ECDH(pair keys of the pinned tuple), info)
// (2460, 8630, 8730).
import { b64uOf, calOK, fromB64u, fromBase58, jcs, makeValidator, tsec } from './core.js'
import { digestDoc, edRawOfAnchor, hkdf, platformSubtle } from './crypto.js'
import { macU, rawProofValue } from './anchor.js'
import { SCHEMAS } from './schemas.js'
import { TASK_NAMESPACE as TT } from './task-uri.js'

export const INTRODUCTION_TYPES = Object.freeze({
  request: TT + 'introduction-request/0.1',
  forward: TT + 'introduction-forward/0.1',
  reply: TT + 'introduction-reply/0.1',
  ack: TT + 'introduction-ack/0.1',
  voucher: TT + 'introduction-voucher/0.1',
})
/** Delivery §4.4's carrier of a role's published constants. */
export const DECLARATION_TYPE = TT + 'registry-declaration/0.1'
/** The mediator's role URI: the type it serves as receiver (Delivery §4.4). */
export const MEDIATOR_ROLE = INTRODUCTION_TYPES.request

/** act-expiry PT72H and act-skew PT5M (8110), in ms. */
export const ACT_EXPIRY = 72 * 3_600_000
export const ACT_SKEW = 5 * 60_000
/** ack-delay's domain, PT1S to PT1H (Delivery §4.4, Trust 8.4). */
export const ACK_DELAY_MIN = 1000
export const ACK_DELAY_MAX = 3_600_000

export const MAC_ACK_INFO = 'rltp/visibility/mac/ack'
export const MAC_VOUCHER_INFO = 'rltp/visibility/mac/voucher'

const V = makeValidator(SCHEMAS)
export const introSchemaOk = (file: string, data: unknown): boolean => V.validate(data, SCHEMAS[file], SCHEMAS[file]).length === 0
const te = new TextEncoder()

export interface Artifact<B> { body: B, proof: Record<string, string> }
export interface RequestBody { type: 'introduction-request@1', act: string, issuedAt: string, target: string, cardDigest: string, profile: { displayName?: string, note?: string } }
export interface ReplyBody { type: 'introduction-reply@1', act: string, requestDigest: string, requesterPair: string, cardDigest: string }
export interface AckBody { type: 'introduction-ack@1', act: string }
export interface VoucherBody { type: 'introduction-voucher@1', act: string, requesterPair: string, targetPair: string }

/** An act id: 32 fresh random bytes, u-base64url, 44 characters (8070, 8450). */
export const actIdOf = (bytes32: Uint8Array): string => {
  if (!(bytes32 instanceof Uint8Array) || bytes32.length !== 32) throw new Error('an act id is exactly 32 fresh bytes (8070)')
  return 'u' + b64uOf(bytes32)
}

/** A raw Ed25519 proofValue over JCS(body) (2450), from a signing function. */
export async function signIntroArtifact<B> (body: B, sign: (bytes: Uint8Array) => Promise<Uint8Array>): Promise<Artifact<B>> {
  return { body, proof: { proofValue: rawProofValue(await sign(te.encode(jcs(body)))) } }
}

/** Does a raw Ed25519 proofValue verify under the anchor over JCS(body)? */
export async function introSignedBy (a: Artifact<unknown>, anchor: string, subtle?: SubtleCrypto): Promise<boolean> {
  const S = subtle ?? platformSubtle()
  const raw = edRawOfAnchor(anchor)
  const pv = a?.proof?.proofValue
  if (!raw || typeof pv !== 'string' || pv[0] !== 'z') return false
  const sig = fromBase58(pv.slice(1))
  if (!sig || sig.length !== 64) return false
  const pub = await S.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify'])
  return S.verify({ name: 'Ed25519' }, pub, sig, te.encode(jcs(a.body)))
}

/** The MAC key of an ack or a voucher from the pinned tuple's X25519 secret (8630, 8730). */
export const introMacKey = (shared: Uint8Array, info: string, subtle?: SubtleCrypto): Promise<Uint8Array> => {
  if (shared.every((b) => b === 0)) throw new Error('all-zero X25519 output')
  return hkdf(shared, info, 32, subtle)
}

/** A MAC-proved artifact (ack, voucher). */
export async function introMacArtifact<B> (body: B, key: Uint8Array, subtle?: SubtleCrypto): Promise<Artifact<B>> {
  return { body, proof: { mac: await macU(key, jcs(body), subtle) } }
}
export const introMacOk = async (a: Artifact<unknown>, key: Uint8Array, subtle?: SubtleCrypto): Promise<boolean> =>
  typeof a?.proof?.mac === 'string' && (await macU(key, jcs(a.body), subtle)) === a.proof.mac

/** 2.1 digests: of a body (requestDigest) and of a complete card (cardDigest). */
export const introDigest = (x: unknown, subtle?: SubtleCrypto): Promise<string> => digestDoc(x, subtle)

/** The acceptance window of 8110–8130 at `now`, from the artifact's own
 *  issuedAt: whole seconds (2.1), both bounds inclusive. */
export function actWindowHolds (issuedAt: string, now: number): boolean {
  if (!calOK(issuedAt)) return false
  const t = tsec(issuedAt), n = tsec(now)
  return t <= n + ACT_SKEW && n <= t + ACT_EXPIRY + ACT_SKEW
}

/** The mediator's request cutoff (8160): now + ack-delay ≤ issuedAt + act-expiry. */
export const requestCutoffHolds = (issuedAt: string, now: number, ackDelayMs: number): boolean =>
  tsec(now) + ackDelayMs <= tsec(issuedAt) + ACT_EXPIRY

/** The mediator's reply cutoff (8170): now ≤ issuedAt + act-expiry. */
export const replyCutoffHolds = (issuedAt: string, now: number): boolean => tsec(now) <= tsec(issuedAt) + ACT_EXPIRY

/** The first whole second strictly after a bound (8140): when a
 *  time-driven transition fires. */
export const actFiresAt = (boundMs: number): number => tsec(boundMs) + 1000

/** A duration of the day-and-time subset of ISO 8601 (Access 7.3: both
 *  parts optional, no fraction), in ms; null where the grammar refuses it. */
export function durationMs (s: unknown): number | null {
  if (typeof s !== 'string') return null
  const m = /^P(?:([0-9]+)D)?(?:T(?:([0-9]+)H)?(?:([0-9]+)M)?(?:([0-9]+)S)?)?$/.exec(s)
  if (!m || s === 'P' || s.endsWith('T')) return null
  const [d, h, mi, se] = [m[1], m[2], m[3], m[4]].map((x) => (x === undefined ? 0 : Number(x)))
  const ms = (((d * 24 + h) * 60 + mi) * 60 + se) * 1000
  return Number.isSafeInteger(ms) ? ms : null
}

/** A declaration's constants for the mediator role (Delivery §4.4: the
 *  registering specification closes the names and domains): exactly
 *  ack-delay within its domain; else null. */
export function mediatorConstants (constants: Record<string, string>): { ackDelayMs: number } | null {
  const names = Object.keys(constants)
  if (names.length !== 1 || names[0] !== 'ack-delay') return null
  const ms = durationMs(constants['ack-delay'])
  return ms !== null && ms >= ACK_DELAY_MIN && ms <= ACK_DELAY_MAX ? { ackDelayMs: ms } : null
}

/** The mediator's step 2 (8420) on a request payload past its schema:
 *  cardDigest, the signature under the card's anchor. */
export async function requestFormOk (payload: { introduction: Artifact<RequestBody>, card: any }, subtle?: SubtleCrypto): Promise<boolean> {
  const { introduction, card } = payload
  if ((await introDigest(card, subtle)) !== introduction.body.cardDigest) return false
  return introSignedBy(introduction, card.anchor, subtle)
}

/** A reply's card binding (8500/8560): cardDigest and the signature under the card's anchor. */
export async function replyBound (payload: { introduction: Artifact<ReplyBody>, card: any }, subtle?: SubtleCrypto): Promise<boolean> {
  const { introduction, card } = payload
  if ((await introDigest(card, subtle)) !== introduction.body.cardDigest) return false
  return introSignedBy(introduction, card.anchor, subtle)
}

/** An introduction card: rltp-card/0.25 under Encounter's DI rules (8050, 8530), no sentTo/boundTo. */
export const introCardShapeOk = (card: any): boolean =>
  introSchemaOk('contact-card-0.25.schema.json', card) && card.sentTo === undefined && card.boundTo === undefined

/** The bytes of 32 random bytes encoded as a designator (8610): u + base64url, never from an anchor. */
export const designatorOf = (bytes: Uint8Array): string => 'u' + b64uOf(bytes)
export const designatorOk = (d: unknown): boolean => typeof d === 'string' && /^u[A-Za-z0-9_-]+$/.test(d) && d.length <= 343 && fromB64u(d.slice(1)).length <= 256
