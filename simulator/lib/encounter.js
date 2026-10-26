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
import { digestDoc, diSign, diVerify, edRawOfAnchor, xRawOfMk } from './crypto.js';
import { b64uOf, calOK, iso, makeValidator, sameDigest } from './core.js';
import { SCHEMAS } from './schemas.js';
import { TASK_NAMESPACE as TT } from './task-uri.js';
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
    const { name, deliveryHints, challenge, sentTo, boundTo } = fields;
    // runtime guard for JS callers the union cannot reach: the sent-card
    // profile is atomic — half of it is not a card of either profile
    if ((sentTo === undefined) !== (boundTo === undefined))
        throw new Error('a sent card carries sentTo AND boundTo together (Encounter §5)');
    const b = { version: CARD_VERSION, anchor: ctx.anchor, keyAgreement: ctx.keyAgreement };
    if (name !== undefined)
        b.name = name;
    if (deliveryHints !== undefined)
        b.deliveryHints = [...deliveryHints];
    if (challenge !== undefined)
        b.challenge = challenge;
    if (sentTo !== undefined) {
        b.sentTo = sentTo;
        b.boundTo = boundTo;
    }
    return b;
}
/** The unsigned body of a step credential (Encounter 7.2): issuer, the
 *  subject, the subject's challenge and the enactment binding. */
export const credentialBody = (issuerAnchor, subjectAnchor, ceremony, subjectChallenge, enactmentBinding, whenIso) => ({
    '@context': [...CRED_CONTEXT],
    type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential', 'EncounterCredential'],
    issuer: issuerAnchor,
    // the issuer is a fresh pair anchor, known to exactly one counterparty (4.4)
    issuerScope: 'pairwise',
    validFrom: whenIso,
    credentialSubject: { id: subjectAnchor, format: CRED_FORMAT, ceremony, challenge: subjectChallenge, enactmentBinding },
});
export async function issueCredential(ctx, subjectAnchor, ceremony, subjectChallenge, enactmentBinding, whenIso) {
    return diSign(ctx, credentialBody(ctx.anchor, subjectAnchor, ceremony, subjectChallenge, enactmentBinding, whenIso), whenIso);
}
// ── the ceremony's pure checks (Encounter 0.31 §5–§7, Delivery 4.1/4.3) ──
// The task types, the §9 constants, the whole-second time rules, the card
// check, the 5.6 credential checks in their normative order, and the
// outer/inner forms of the two carriers. State-free: what needs the
// own-challenge state or the records is the holder's (encounter/ceremony.ts).
/** The scanner's sent card and step credential (Delivery 4.1). */
export const BUNDLE_TYPE = TT + 'encounter-bundle/0.1';
/** The counter-step or a standalone credential delivery (Delivery 4.3). */
export const DELIVERY_TYPE = TT + 'encounter-credential-delivery/0.1';
// Encounter §9 operational constants (ms)
export const CHALLENGE_MAX_AGE = 5 * 60_000; // PT5M
export const ISSUANCE_WINDOW = 24 * 3_600_000; // PT24H
export const SKEW_TOLERANCE = 5 * 60_000; // PT5M
const VAL = makeValidator(SCHEMAS);
const schemaOk = (file, data) => VAL.validate(data, SCHEMAS[file], SCHEMAS[file]).length === 0;
/** Whole seconds (2.3). */
const sec = (ms) => Math.floor(ms / 1000);
const secIso = (t) => Math.floor(Date.parse(t) / 1000);
/** 5.5's explicit future check: t_ch ≤ now + skew, whole seconds. */
export const futureOk = (tCh, now) => sec(tCh) <= sec(now) + SKEW_TOLERANCE / 1000;
/** Is a challenge issued at tCh past its age bound at `now` (5190)? */
export const challengeAged = (tCh, now) => sec(now) > sec(tCh) + (CHALLENGE_MAX_AGE + SKEW_TOLERANCE) / 1000;
/** The producer's mirror of 5.6 step 6: may a credential binding a
 *  challenge issued at tChMs still be issued now? */
export const issuanceOpen = (tChMs, now) => {
    const skew = SKEW_TOLERANCE / 1000;
    return sec(now) >= sec(tChMs) - skew && sec(now) <= sec(tChMs) + (CHALLENGE_MAX_AGE + ISSUANCE_WINDOW) / 1000 + skew;
};
/** The last millisecond a credential binding a challenge issued at tChMs may carry (5.6 step 6). */
export const issuanceEnd = (tChMs) => (sec(tChMs) + (CHALLENGE_MAX_AGE + ISSUANCE_WINDOW + SKEW_TOLERANCE) / 1000) * 1000 + 999;
/** Producer-side profile discipline (Delivery 3): UUID v4 ids and threads. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const uuidOk = (v) => typeof v === 'string' && UUID_V4.test(v);
export const CARD_SCHEMA = 'contact-card-0.25.schema.json';
/** A card for an enactment (Encounter 6): schema-valid, its version known,
 *  a challenge, calendar-valid times, keys that decode, the proof under the
 *  anchor. null when it passes, else the reason. */
export async function cardOk(card, subtle) {
    if (!schemaOk(CARD_SCHEMA, card))
        return 'card fails contact-card-0.25 schema';
    if (card.version !== CARD_VERSION)
        return 'card version unknown';
    if (!card.challenge)
        return 'card without challenge (enactment use requires one)';
    if (!calOK(card.challenge.issuedAt) || !calOK(card.proof?.created))
        return 'card: calendar-invalid timestamp';
    if (!xRawOfMk(card.keyAgreement) || !edRawOfAnchor(card.anchor))
        return 'card keyAgreement does not decode (x25519-pub + 32 bytes, 2.3)';
    if (!(await diVerify(card, card.anchor, subtle)))
        return 'card proof';
    return null;
}
/** 5.6 step 1, format: a KNOWN format validated against ITS schema (0.26,
 *  or a held 0.25 — 7.3, 12), ceremony and version known, calendar-valid
 *  times, the digest a multihash, keys that decode (2.3). `ceremonyHere`:
 *  5.6 checks the ceremony at step 1; a bundle checks it at Delivery 4.1's
 *  check 5. */
export function credFormat(cred, ceremonyHere = true) {
    const schema = credentialSchemaOf(cred);
    if (schema === null || !schemaOk(schema, cred))
        return 'ERR_VERSION';
    if (ceremonyHere && cred.credentialSubject.ceremony !== CEREMONY)
        return 'ERR_VERSION';
    if (!calOK(cred.validFrom) || !calOK(cred.proof?.created))
        return 'ERR_VERSION';
    if (!sameDigest(cred.credentialSubject.enactmentBinding, cred.credentialSubject.enactmentBinding))
        return 'ERR_VERSION';
    if (!edRawOfAnchor(cred.issuer) || !edRawOfAnchor(cred.credentialSubject.id))
        return 'ERR_VERSION';
    const vm = String(cred.proof?.verificationMethod ?? ''), hash = vm.indexOf('#');
    if (hash < 0 || !edRawOfAnchor(vm.slice(0, hash)) || !edRawOfAnchor('did:key:' + vm.slice(hash + 1)))
        return 'ERR_VERSION';
    return null;
}
/** 5.6 steps 1–3: format, signature, addressee (`localAnchor`). */
export async function credHead(cred, localAnchor, ceremonyHere = true, subtle) {
    const f = credFormat(cred, ceremonyHere);
    if (f)
        return f;
    if (!(await diVerify(cred, cred.issuer, subtle)))
        return 'ERR_SIG';
    if (cred.credentialSubject.id !== localAnchor)
        return 'ERR_ADDRESSEE';
    return null;
}
/** 5.6 step 6: the issuance window, whole seconds, inclusive, skew widens. */
export function windowOk(cred, tChMs) {
    const tCh = sec(tChMs), vf = secIso(cred.validFrom), cr = secIso(cred.proof.created), skew = SKEW_TOLERANCE / 1000;
    const lo = tCh - skew, hi = tCh + (CHALLENGE_MAX_AGE + ISSUANCE_WINDOW) / 1000 + skew;
    return !(vf < lo || vf > hi || cr < lo || cr > hi || cr < vf - skew);
}
/** 5.6 steps 4–7 against a record, synchronous. `order`: 'credential' —
 *  5.6: record, ceremony, window, binding; 'bundle' — Delivery 4.1:
 *  record, ceremony, binding, window. */
export function acceptTail(cred, rec, order) {
    if (!rec || rec.counterpart !== cred.issuer)
        return 'ERR_NO_RECORD';
    if (cred.credentialSubject.ceremony !== rec.ceremony)
        return 'ERR_CEREMONY';
    const bindOk = sameDigest(cred.credentialSubject.enactmentBinding, rec.bind);
    if (order === 'bundle' && !bindOk)
        return 'ERR_BINDING';
    if (!windowOk(cred, rec.tCh))
        return 'ERR_STALE_ISSUANCE';
    if (!bindOk)
        return 'ERR_BINDING';
    return null;
}
/** Delivery 4.1/4.3: ERR_STALE_ISSUANCE is stale-issuance, every other
 *  rejection validation-failed. */
export const dispositionOf = (e) => (e === 'ERR_STALE_ISSUANCE' ? 'stale-issuance' : 'validation-failed');
/**
 * The bundle's context-free checks of Delivery 4.1 check 1 (stage 8,
 * after the payload schema): calendars, the outer/inner equalities, the
 * sent card's binding, a present ceremony.enactment, the card's version
 * and keys, the credential's format (its ceremony at check 5). null when
 * they pass, else the reason, with the 4.1 disposition.
 */
export function bundleForm(doc) {
    const { card, credential } = doc.payload;
    const v = (why) => ({ reason: 'validation-failed', why });
    if (!calOK(doc.issuedAt) || !calOK(card.challenge?.issuedAt) || !calOK(card.proof?.created))
        return v('calendar-invalid issuedAt');
    if (doc.issuer !== card.anchor || card.anchor !== credential.issuer)
        return v('outer binding (issuer = card.anchor = credential.issuer)');
    if (credential.credentialSubject?.id !== doc.recipient)
        return v('outer binding (recipient = subject)');
    if (card.sentTo !== doc.recipient || card.boundTo !== credential.credentialSubject.challenge)
        return v('sent card binding (sentTo/boundTo)');
    if (card.challenge.value === card.boundTo)
        return v('sent challenge equals the displayed challenge (5.3)');
    if (doc.ceremony?.enactment !== undefined && !sameDigest(doc.ceremony.enactment, credential.credentialSubject.enactmentBinding))
        return v('ceremony.enactment recomputes not');
    if (card.version !== CARD_VERSION || !card.challenge)
        return v('card version/challenge');
    if (!xRawOfMk(card.keyAgreement) || !edRawOfAnchor(card.anchor))
        return v('card keys do not decode');
    const f = credFormat(credential, false);
    if (f)
        return { reason: dispositionOf(f), why: f };
    return null;
}
/** The credential delivery's outer/inner consistency (Delivery 4.3). */
export function deliveryForm(doc) {
    const cred = doc.payload.credential;
    if (!calOK(doc.issuedAt))
        return 'calendar-invalid issuedAt';
    if (doc.issuer !== cred.issuer)
        return 'outer binding (issuer = credential.issuer)';
    if (cred.credentialSubject?.id !== doc.recipient)
        return 'outer binding (recipient = subject)';
    if (doc.ceremony?.enactment !== undefined && !sameDigest(doc.ceremony.enactment, cred.credentialSubject.enactmentBinding))
        return 'ceremony.enactment recomputes not';
    return null;
}
