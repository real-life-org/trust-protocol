// encounter — the Encounter Layer: how two people record that they met.
//
// The one registered ceremony (encounter-scan), the contact card each
// side displays, the challenge that makes an enactment fresh, the
// enactment binding both sides compute independently, and the encounter
// credential each issues about the other.
//
// The binding is what makes the pair an enactment rather than two
// unrelated claims: both sides derive it from the same two challenges,
// sorted, so neither can steer it.
import { digestDoc, diSign } from './crypto.js'
import type { Signer } from './crypto.js'
import { b64uOf, iso } from './core.js'
export { iso }

// ── wire builders (Encounter 0.31: card 0.25, credential 0.26) ─────────
export const CEREMONY = 'encounter-scan@0.25'
export const CARD_VERSION = 'rltp-card/0.25'
/** The credential form this library issues (Encounter 7.2). */
export const CRED_FORMAT = 'rltp-encounter-credential/0.26'
/** The DTG credential context, DTG Credentials WD 0.6.0 (exact bytes; the
 *  document is pinned by SHA-256 in contexts/dtg-v1.jsonld). */
export const DTG_CONTEXT = 'https://registry.trustoverip.org/dtg/context/v1'
/** The pinned context set of the 0.26 credential (Encounter 2.3, RLTP-ENC-2250). */
export const CRED_CONTEXT: readonly string[] = Object.freeze(['https://www.w3.org/ns/credentials/v2', DTG_CONTEXT, 'https://real-life.org/rltp/v1'])
/** Every credential format a verifier of this version knows, with its schema
 *  file. A held 0.25 credential stays valid under its own format (7.3, 12). */
export const CRED_FORMATS: Readonly<Record<string, string>> = Object.freeze({
  'rltp-encounter-credential/0.26': 'encounter-credential-0.26.schema.json',
  'rltp-encounter-credential/0.25': 'encounter-credential-0.25.schema.json',
})
/** The schema file a credential is validated against, by the format it
 *  names — null for an unknown format (ERR_VERSION at 5.6 step 1). */
export const credentialSchemaOf = (cred: unknown): string | null => {
  const f = (cred as { credentialSubject?: { format?: unknown } } | null)?.credentialSubject?.format
  return typeof f === 'string' && Object.prototype.hasOwnProperty.call(CRED_FORMATS, f) ? CRED_FORMATS[f] : null
}
export const binding = (ceremony: string, c1: string, c2: string): Promise<string> => digestDoc({ ceremony, challenges: [c1, c2].sort() })
export const challengeOf = (bytes17: Uint8Array): string => {
  // a producer never emits what every conformant receiver must reject:
  // the challenge is EXACTLY 17 random bytes (>= 128 bits, Encounter §5)
  if (!(bytes17 instanceof Uint8Array) || bytes17.length !== 17) throw new Error('challenge entropy must be exactly 17 bytes')
  return challengeOfUnchecked(bytes17)
}
const challengeOfUnchecked = (bytes17: Uint8Array): string => b64uOf(bytes17).slice(0, 22)

// cards carry no @context (the proof carries none either — W3C-true)
export const signCard = (ctx: Signer, body: CardBody, created: string) => diSign(ctx, body, created)

/** The challenge a displayed card carries: fresh value, whole-second issue time. */
export interface Challenge { value: string, issuedAt: string }

/**
 * The spec knows exactly two disjoint card profiles (Encounter §5):
 * a DISPLAYED card offers a challenge; a SENT card names its recipient
 * AND the challenge it answers — always both, never one (M-2, review 1:
 * the fields travel together or the card is neither profile).
 */
export type CardFields =
  | { name?: string, challenge?: Challenge, sentTo?: undefined, boundTo?: undefined }
  | { name?: string, challenge?: Challenge, sentTo: string, boundTo: string }

/** A card body as it goes under the signature. */
export interface CardBody {
  version: string
  anchor: string
  keyAgreement: string
  name?: string
  challenge?: Challenge
  sentTo?: string
  boundTo?: string
}

export function cardBody (ctx: { anchor: string, keyAgreement: string }, fields: CardFields = {}): CardBody {
  const { name, challenge, sentTo, boundTo } = fields as { name?: string, challenge?: Challenge, sentTo?: string, boundTo?: string }
  // runtime guard for JS callers the union cannot reach: the sent-card
  // profile is atomic — half of it is not a card of either profile
  if ((sentTo === undefined) !== (boundTo === undefined)) throw new Error('a sent card carries sentTo AND boundTo together (Encounter §5)')
  const b: CardBody = { version: CARD_VERSION, anchor: ctx.anchor, keyAgreement: ctx.keyAgreement }
  if (name !== undefined) b.name = name
  if (challenge !== undefined) b.challenge = challenge
  if (sentTo !== undefined) { b.sentTo = sentTo; b.boundTo = boundTo }
  return b
}
export async function issueCredential (
  ctx: Signer, subjectAnchor: string, ceremony: string,
  subjectChallenge: string, enactmentBinding: string, whenIso: string,
) {
  const body = {
    '@context': [...CRED_CONTEXT],
    type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential', 'EncounterCredential'],
    issuer: ctx.anchor,
    // the issuer is a fresh pair anchor, known to exactly one counterparty (4.4)
    issuerScope: 'pairwise',
    validFrom: whenIso,
    credentialSubject: { id: subjectAnchor, format: CRED_FORMAT, ceremony, challenge: subjectChallenge, enactmentBinding },
  }
  return diSign(ctx, body, whenIso)
}

