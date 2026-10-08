// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
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
import { digestDoc, diSign } from './crypto.js';
import { b64uOf, iso } from './core.js';
export { iso };
// ── wire builders (Encounter 0.31: card 0.25, credential 0.26) ─────────
export const CEREMONY = 'encounter-scan@0.25';
export const CARD_VERSION = 'rltp-card/0.25';
/** The credential form this library issues (Encounter 7.2). */
export const CRED_FORMAT = 'rltp-encounter-credential/0.26';
/** The DTG credential context, DTG Credentials WD 0.6.0 (exact bytes; the
 *  document is pinned by SHA-256 in contexts/dtg-v1.jsonld). */
export const DTG_CONTEXT = 'https://registry.trustoverip.org/dtg/context/v1';
/** The pinned context set of the 0.26 credential (Encounter 2.3, RLTP-ENC-2250). */
export const CRED_CONTEXT = Object.freeze(['https://www.w3.org/ns/credentials/v2', DTG_CONTEXT, 'https://real-life.org/rltp/v1']);
/** Every credential format a verifier of this version knows, with its schema
 *  file. A held 0.25 credential stays valid under its own format (7.3, 12). */
export const CRED_FORMATS = Object.freeze({
    'rltp-encounter-credential/0.26': 'encounter-credential-0.26.schema.json',
    'rltp-encounter-credential/0.25': 'encounter-credential-0.25.schema.json',
});
/** The schema file a credential is validated against, by the format it
 *  names — null for an unknown format (ERR_VERSION at 5.6 step 1). */
export const credentialSchemaOf = (cred) => {
    const f = cred?.credentialSubject?.format;
    return typeof f === 'string' && Object.prototype.hasOwnProperty.call(CRED_FORMATS, f) ? CRED_FORMATS[f] : null;
};
export const binding = (ceremony, c1, c2) => digestDoc({ ceremony, challenges: [c1, c2].sort() });
export const challengeOf = (bytes17) => {
    // a producer never emits what every conformant receiver must reject:
    // the challenge is EXACTLY 17 random bytes (>= 128 bits, Encounter §5)
    if (!(bytes17 instanceof Uint8Array) || bytes17.length !== 17)
        throw new Error('challenge entropy must be exactly 17 bytes');
    return challengeOfUnchecked(bytes17);
};
const challengeOfUnchecked = (bytes17) => b64uOf(bytes17).slice(0, 22);
// cards carry no @context (the proof carries none either — W3C-true)
export const signCard = (ctx, body, created) => diSign(ctx, body, created);
export function cardBody(ctx, fields = {}) {
    const { name, challenge, sentTo, boundTo } = fields;
    // runtime guard for JS callers the union cannot reach: the sent-card
    // profile is atomic — half of it is not a card of either profile
    if ((sentTo === undefined) !== (boundTo === undefined))
        throw new Error('a sent card carries sentTo AND boundTo together (Encounter §5)');
    const b = { version: CARD_VERSION, anchor: ctx.anchor, keyAgreement: ctx.keyAgreement };
    if (name !== undefined)
        b.name = name;
    if (challenge !== undefined)
        b.challenge = challenge;
    if (sentTo !== undefined) {
        b.sentTo = sentTo;
        b.boundTo = boundTo;
    }
    return b;
}
export async function issueCredential(ctx, subjectAnchor, ceremony, subjectChallenge, enactmentBinding, whenIso) {
    const body = {
        '@context': [...CRED_CONTEXT],
        type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential', 'EncounterCredential'],
        issuer: ctx.anchor,
        // the issuer is a fresh pair anchor, known to exactly one counterparty (4.4)
        issuerScope: 'pairwise',
        validFrom: whenIso,
        credentialSubject: { id: subjectAnchor, format: CRED_FORMAT, ceremony, challenge: subjectChallenge, enactmentBinding },
    };
    return diSign(ctx, body, whenIso);
}
