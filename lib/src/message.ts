// message — the pure forms and checks of Message Tasks 0.1 (§3): the
// message@1 body, the directional key k_msg and its MAC, used by the
// holder's message module (message/holder.ts). State-free.
import { b64uOf, calOK, jcs, makeValidator } from './core.js'
import { hkdf, platformSubtle } from './crypto.js'
import { SCHEMAS } from './schemas.js'

/** The registered type (Message Tasks 3, Delivery 4.4). */
export const MESSAGE_TYPE = 'https://real-life.org/trust-tasks/message/0.1'
/** H, the message lifetime of this version: P180D (Message Tasks 2.2). */
export const MESSAGE_LIFETIME_MS = 180 * 86_400_000
/** The future bound of RLTP-MSG-4050: P1D. */
export const MESSAGE_FUTURE_MS = 86_400_000
/** The sender's give-up before H: sentAt + H − P1D (RLTP-MSG-5110, RLTP-DEL-7020). */
export const MESSAGE_SENDER_LIFETIME_MS = MESSAGE_LIFETIME_MS - 86_400_000
/** At most 500 new message/0.1 document digests per relationship in 24 h (4110). */
export const MESSAGE_RATE = 500
/** At most 2000 inbox entries per relationship (4110). */
export const INBOX_BOUND = 2000

/** The message@1 body (Message Tasks 3.2). */
export interface MessageBody { type: 'message@1', mid: string, sentAt: string, text: string, replyTo?: string }
/** The payload: `{ body, proof: { mac } }` (3.1). */
export interface MessagePayload { body: MessageBody, proof: { mac: string } }

const te = new TextEncoder()
const V = makeValidator(SCHEMAS)
const SCHEMA = SCHEMAS['message.schema.json']

/** The HKDF info of k_msg: sender anchor, then recipient anchor (3110). */
export const messageInfo = (senderPairAnchor: string, recipientPairAnchor: string): string =>
  'rltp/v1/message/mac/' + senderPairAnchor + '/' + recipientPairAnchor

/** k_msg from the tuple's X25519 shared secret (3110); an all-zero
 *  secret is rejected before derivation (3120). */
export async function messageKeyOf (shared: Uint8Array, senderPairAnchor: string, recipientPairAnchor: string, subtle?: SubtleCrypto): Promise<Uint8Array> {
  if (shared.every((b) => b === 0)) throw new Error('all-zero X25519 output (RLTP-MSG-3120)')
  return hkdf(shared, messageInfo(senderPairAnchor, recipientPairAnchor), 32, subtle ?? platformSubtle())
}

/** The MAC of Trust 2.1 over JCS(body): "u" + base64url HMAC-SHA-256. */
export async function messageMac (key: Uint8Array, body: unknown, subtle?: SubtleCrypto): Promise<string> {
  const S = subtle ?? platformSubtle()
  const k = await S.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return 'u' + b64uOf(new Uint8Array(await S.sign('HMAC', k, te.encode(jcs(body)))))
}

/** Whether the payload is a message@1 of the closed form (3010, 3020):
 *  the schema, whose maxLength counts code points. */
export const messageShapeOk = (payload: unknown): payload is MessagePayload => V.validate(payload, SCHEMA, SCHEMA).length === 0

/** Why a message@1 fails its form or its MAC under `key`, the vector's
 *  names: `schema` (3010, 3020, the pattern of 3030), `calendar` (3030:
 *  a date the pattern admits that no calendar has), `mac` (3110); null
 *  when it passes. */
export async function messageProblem (payload: unknown, key: Uint8Array, subtle?: SubtleCrypto): Promise<'schema' | 'calendar' | 'mac' | null> {
  if (!messageShapeOk(payload)) return 'schema'
  if (!calOK(payload.body.sentAt)) return 'calendar'
  return (await messageMac(key, payload.body, subtle)) === payload.proof.mac ? null : 'mac'
}
