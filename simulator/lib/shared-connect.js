// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// shared-connect 0.1: connect two people across apps, on two registry
// Trust Tasks (vrc/relationships/propose 0.1, vrc/relationships/issue 0.1)
// and one ceremony definition, started by a VTI trigger link whose
// `_from` is a per-encounter did:peer:2 carrying the inviter's relays.
//
// Shape agreed with Consensual (Geb, NAOMS) and Keyring, November 2026:
// trustoverip/dtgwg-trust-tasks-tf#1034 (revision of 5 November) and
// trustoverip/dtgwg-vti-spec#86 (Brendan Miller, 4 and 6 November).
//
//   inviter   shows the link as a code (or sends it): _from, _id, _exp, _type
//   responder scans, PROPOSES (it is the only one who can speak first):
//             propose → inviter's relay; id = responder's challenge
//   inviter   accepts (propose#response) and issues (issue)
//   responder issues (issue); each issue is receipted (issue#response)
//
// Identifiers, two layers on each side (RLTP Identity §7a; Keyring's VRC
// path; Consensual's did:key + messaging identity):
//   A. the pairwise identifier that signs the credential: a did:key
//      (`relationshipDid`), stable for the life of the relationship;
//   B. the per-encounter messaging identity with the relays: a did:peer:2
//      (`issuer`/`recipient` of every step document, `_from` of the link).
//
// Enactment = the link's `_id` (the inviter's challenge) on every step;
// threadId = the propose id (the responder's challenge), as issue 0.1
// requires. The binding each side writes into its credential covers both.
//
// Offline: the responder shows its propose back as a code in a
// RECONSTRUCTION form (what the inviter does not already hold); the
// inviter rebuilds the document from its own state and verifies the proof.
import { jcs, base58, fromBase58, b64uOf, fromB64u, calOK, iso } from './core.js';
import { sha, cat, digestDoc, anchorOfEd, mkOfX, edRawOfAnchor, xRawOfMk, diSign, diVerify, edFromSeed, xFromSeed, hkdf } from './crypto.js';
import { CRED_CONTEXT } from './encounter.js';
const te = new TextEncoder();
const td = new TextDecoder();
const S = () => globalThis.crypto.subtle;
// ── constants ───────────────────────────────────────────────────────────
export const CEREMONY_URI = 'https://trusttasks.org/ceremony/shared-connect/0.1';
export const FLOW_PATH = '/vti/flow/shared-connect/0.1';
export const FLOW_URI = 'https://link.trustoverip.org' + FLOW_PATH;
export const LINK_HOST = 'https://link.trustoverip.org';
export const LINK_PATH = '/t';
export const TASK_PROPOSE = 'https://trusttasks.org/spec/vrc/relationships/propose/0.1';
export const TASK_ISSUE = 'https://trusttasks.org/spec/vrc/relationships/issue/0.1';
/** Codes shown in person: at most 10 minutes (5 min challenge + clock tolerance). Links: at most 7 days. */
export const MAX_EXP_CODE_S = 10 * 60;
export const MAX_EXP_LINK_S = 7 * 24 * 3600;
/** Producer budget for a link that travels (characters); about 450 for a code shown in person. */
export const LINK_BUDGET = 990;
export const LABEL_MAX_BYTES = 64;
// ── challenges ──────────────────────────────────────────────────────────
/** Exactly 16 random bytes, canonical unpadded base64url: 22 characters, last one in A/Q/g/w (VTI-LNK-033). */
export const challengeOf16 = (bytes16) => {
    if (bytes16.length !== 16)
        throw new Error('a shared-connect challenge is exactly 16 bytes');
    return b64uOf(bytes16);
};
export const canonicalChallenge = (c) => typeof c === 'string' && /^[A-Za-z0-9_-]{21}[AQgw]$/.test(c);
const SERVICE_TYPE_OF = { TSPTransport: 'tsp-mediator', tsp: 'tsp-mediator', NostrRelay: 'nostr-relay', DIDCommMessaging: 'didcomm-service' };
const RELAY_TYPE_OF = { 'tsp-mediator': 'TSPTransport', 'nostr-relay': 'NostrRelay', 'didcomm-service': 'DIDCommMessaging' };
function expandService(raw, n) {
    const t = raw.t ?? raw.type;
    const type = t === 'dm' ? 'DIDCommMessaging' : String(t);
    const s = { id: n === 0 ? '#service' : '#service-' + n, type, serviceEndpoint: raw.s ?? raw.serviceEndpoint };
    const r = raw.r ?? raw.routingKeys;
    if (Array.isArray(r))
        s.routingKeys = r.map(String);
    const a = raw.a ?? raw.accept;
    if (Array.isArray(a))
        s.accept = a.map(String);
    return s;
}
const endpointUri = (e) => {
    if (typeof e === 'string')
        return e;
    if (Array.isArray(e))
        return endpointUri(e[0]);
    if (e && typeof e === 'object' && typeof e.uri === 'string')
        return e.uri;
    return null;
};
/** Render a did:peer:2 for an Ed25519 and an X25519 public key and the relays. */
export function peer2Of(edPub, xPub, relays = []) {
    let did = 'did:peer:2.V' + anchorOfEd(edPub).slice('did:key:'.length) + '.E' + mkOfX(xPub);
    for (const r of relays) {
        const t = RELAY_TYPE_OF[r.kind] ?? r.kind;
        did += '.S' + b64uOf(te.encode(JSON.stringify({ t, s: r.address })));
    }
    return did;
}
/** Parse and resolve a did:peer:2 locally. Null when it is not one we can use:
 *  it must carry exactly one Ed25519 key (listed under assertionMethod and
 *  authentication) and one X25519 key. */
export function parsePeer2(did) {
    if (typeof did !== 'string' || !did.startsWith('did:peer:2.'))
        return null;
    const parts = did.slice('did:peer:2.'.length).split('.');
    let ed = null, x = null;
    const vms = [];
    const authentication = [], keyAgreement = [];
    const service = [];
    let n = 0, keyN = 0;
    for (const p of parts) {
        const purpose = p[0], value = p.slice(1);
        if (purpose === 'V' || purpose === 'E') {
            const raw = fromBase58(value.slice(1));
            if (value[0] !== 'z' || !raw || raw.length !== 34 || raw[1] !== 0x01)
                return null;
            const id = '#key-' + (++keyN);
            vms.push({ id, type: 'Multikey', controller: did, publicKeyMultibase: value });
            if (purpose === 'V') {
                if (raw[0] !== 0xed || ed)
                    return null;
                ed = raw.subarray(2);
                authentication.push(id);
            }
            else {
                if (raw[0] !== 0xec || x)
                    return null;
                x = raw.subarray(2);
                keyAgreement.push(id);
            }
        }
        else if (purpose === 'S') {
            let obj;
            try {
                obj = JSON.parse(td.decode(fromB64u(value)));
            }
            catch {
                return null;
            }
            const list = Array.isArray(obj) ? obj : [obj];
            for (const o of list) {
                if (!o || typeof o !== 'object')
                    return null;
                service.push(expandService(o, n++));
            }
        }
        else if (purpose === 'A' || purpose === 'D') {
            return null; // other purpose codes: not a shape this ceremony uses
        }
        else
            return null;
    }
    if (!ed || !x)
        return null;
    const doc = { id: did, verificationMethod: vms, authentication, assertionMethod: [...authentication], keyAgreement, service };
    const relays = [];
    for (const s of service) {
        const kind = SERVICE_TYPE_OF[s.type];
        const address = endpointUri(s.serviceEndpoint);
        if (kind && address)
            relays.push({ kind, address });
    }
    return { did, ed, x, doc, relays };
}
/** The signing key id of a did:peer:2 as this ceremony writes it. */
export const peer2SigningKid = (did) => did + '#key-1';
/** Render the link. `exp` in epoch seconds. */
export function sharedConnectLink(f, host = LINK_HOST) {
    if (!canonicalChallenge(f.id))
        throw new Error('_id must be a canonical 16-byte challenge');
    if (!parsePeer2(f.from))
        throw new Error('_from must be a did:peer:2 this ceremony can use');
    let frag = '_from=' + f.from + '&_id=' + f.id + '&_exp=' + Math.floor(f.exp) + '&_type=' + (f.type ?? FLOW_PATH);
    if (f.label !== undefined) {
        const enc = encodeURIComponent(f.label);
        if (te.encode(enc).length > LABEL_MAX_BYTES * 12)
            throw new Error('_label too long');
        frag += '&_label=' + enc;
    }
    const link = host + LINK_PATH + '#' + frag;
    if (link.length > LINK_BUDGET)
        throw new Error('link exceeds the shared-connect budget of ' + LINK_BUDGET + ' characters');
    return link;
}
/** Read a shared-connect link. Order of checks follows VTI-LNK-020 as far as it applies;
 *  the reader stops at the first failure and the caller shows one of its outcomes. */
export function readSharedConnectLink(link, nowS = Math.floor(Date.now() / 1000)) {
    if ([...link].length > 1536)
        return { ok: false, reason: 'too-long' };
    if (!/^https:\/\//.test(link))
        return { ok: false, reason: 'not-https' };
    const h = link.indexOf('#');
    if (h < 0)
        return { ok: false, reason: 'no-fragment' };
    const params = {};
    for (const kv of link.slice(h + 1).split('&')) {
        if (!kv)
            continue;
        const eq = kv.indexOf('=');
        const k = eq < 0 ? kv : kv.slice(0, eq);
        const v = eq < 0 ? '' : kv.slice(eq + 1);
        if (k in params && k.startsWith('_'))
            return { ok: false, reason: 'repeated-param' };
        params[k] = v;
    }
    if (!('_from' in params))
        return { ok: false, reason: 'missing-from' };
    if (!('_id' in params))
        return { ok: false, reason: 'missing-id' };
    if (!('_exp' in params))
        return { ok: false, reason: 'missing-exp' };
    if (!('_type' in params))
        return { ok: false, reason: 'missing-type' };
    const type = params._type;
    const flow = type.startsWith('/') ? link.slice(0, link.indexOf('/', 'https://'.length)) + type : type;
    if (flow !== FLOW_URI && type !== FLOW_PATH)
        return { ok: false, reason: 'unknown-flow' };
    if (!canonicalChallenge(params._id))
        return { ok: false, reason: 'bad-id' };
    if (!/^[0-9]{1,12}$/.test(params._exp))
        return { ok: false, reason: 'bad-exp' };
    const exp = Number(params._exp);
    if (nowS >= exp)
        return { ok: false, reason: 'expired' };
    if (!params._from.startsWith('did:'))
        return { ok: false, reason: 'bad-from' };
    const from = parsePeer2(params._from);
    if (!from)
        return { ok: false, reason: 'unsupported-vid' };
    const out = { from, id: params._id, exp, type: FLOW_URI, params };
    if ('_label' in params) {
        let label;
        try {
            label = decodeURIComponent(params._label);
        }
        catch {
            return { ok: true, link: out };
        }
        // display only: dropped (not truncated) when too long or carrying control,
        // bidirectional or zero-width characters (Brendan, #86)
        if (te.encode(label).length <= LABEL_MAX_BYTES && !/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/.test(label))
            out.label = label.normalize('NFC');
    }
    return { ok: true, link: out };
}
/** Sign a step document under `authentication` with the did:peer:2's #key-1 (eddsa-jcs-2022). */
export async function signStep(ctx, doc, created) {
    const cfg = { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', created, verificationMethod: peer2SigningKid(ctx.did), proofPurpose: 'authentication' };
    if ('@context' in doc)
        cfg['@context'] = doc['@context'];
    const hashData = cat(await sha(te.encode(jcs(cfg))), await sha(te.encode(jcs(doc))));
    const sig = new Uint8Array(await S().sign({ name: 'Ed25519' }, ctx.ed.priv, hashData));
    return { ...doc, proof: { ...cfg, proofValue: 'z' + base58(sig) } };
}
/** Verify a step document's proof: the signer is the document's issuer (a did:peer:2),
 *  key #key-1, purpose `authentication` or `assertionMethod`, canonical proofValue. */
export async function verifyStep(doc) {
    const { proof, ...rest } = doc ?? {};
    if (!proof || typeof proof.proofValue !== 'string' || typeof proof.verificationMethod !== 'string')
        return false;
    if (proof.type !== 'DataIntegrityProof' || proof.cryptosuite !== 'eddsa-jcs-2022')
        return false;
    if (proof.proofPurpose !== 'authentication' && proof.proofPurpose !== 'assertionMethod')
        return false;
    if (typeof proof.created !== 'string' || !calOK(proof.created))
        return false;
    if (typeof rest.issuer !== 'string')
        return false;
    const vmDid = proof.verificationMethod.split('#')[0];
    if (vmDid !== rest.issuer)
        return false;
    const peer = parsePeer2(vmDid);
    if (!peer)
        return false;
    if (proof.verificationMethod !== peer2SigningKid(vmDid))
        return false;
    if ('@context' in rest && jcs(proof['@context'] ?? null) !== jcs(rest['@context']))
        return false;
    if (proof.proofValue[0] !== 'z')
        return false;
    const sig = fromBase58(proof.proofValue.slice(1));
    if (!sig || sig.length !== 64 || 'z' + base58(sig) !== proof.proofValue)
        return false;
    const { proofValue, ...cfg } = proof;
    const hashData = cat(await sha(te.encode(jcs(cfg))), await sha(te.encode(jcs(rest))));
    const pub = await S().importKey('raw', peer.ed, { name: 'Ed25519' }, false, ['verify']);
    return S().verify({ name: 'Ed25519' }, pub, sig, hashData);
}
/** The responder's proposal. `responderChallenge` becomes the document id. */
export async function propose(responder, inviterDid, enactment, responderChallenge, nowMs, expiresMs) {
    if (!canonicalChallenge(responderChallenge) || !canonicalChallenge(enactment))
        throw new Error('challenges must be canonical 16-byte values');
    const when = iso(nowMs);
    const doc = {
        id: responderChallenge, type: TASK_PROPOSE,
        issuer: responder.messaging.did, recipient: inviterDid, issuedAt: when,
        ceremony: { enactment, step: 'propose' },
        payload: { relationshipDid: responder.pair.anchor },
    };
    if (expiresMs !== undefined)
        doc.expiresAt = iso(expiresMs);
    if (responder.name !== undefined)
        doc.payload.reason = responder.name;
    return signStep(responder.messaging, doc, when);
}
/** The inviter's acceptance (propose#response). `id`: a fresh document id the caller draws (Entropy port, `id` purpose). */
export async function accept(inviter, proposeDoc, nowMs, id) {
    const when = iso(nowMs);
    const doc = {
        id, type: TASK_PROPOSE + '#response', threadId: proposeDoc.id,
        issuer: inviter.messaging.did, recipient: proposeDoc.issuer, issuedAt: when,
        ceremony: { enactment: proposeDoc.ceremony.enactment, step: 'accept' },
        payload: { accept: true, relationshipDid: inviter.pair.anchor },
    };
    if (inviter.name !== undefined)
        doc.payload.reason = inviter.name;
    return signStep(inviter.messaging, doc, when);
}
/** The enactment binding both credentials carry: over the ceremony URI and both challenges (Encounter 5.4). */
export const binding = (inviterChallenge, responderChallenge) => digestDoc({ ceremony: CEREMONY_URI, challenges: [inviterChallenge, responderChallenge].sort() });
/** This side's credential about the other (RLTP encounter profile with `channel`). */
export async function credential(me, subjectPair, subjectChallenge, enactmentBinding, channel, nowMs) {
    const when = iso(nowMs);
    const body = {
        '@context': [...CRED_CONTEXT],
        type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential', 'EncounterCredential'],
        issuer: me.pair.anchor,
        issuerScope: 'pairwise',
        validFrom: when,
        credentialSubject: { id: subjectPair, ceremony: CEREMONY_URI, challenge: subjectChallenge, enactmentBinding, channel },
    };
    return diSign(me.pair, body, when);
}
/** The delivery of a credential (vrc/relationships/issue 0.1). */
export async function issue(me, recipientDid, threadId, enactment, step, vrc, nowMs, id) {
    const when = iso(nowMs);
    const doc = {
        id, type: TASK_ISSUE, threadId,
        issuer: me.messaging.did, recipient: recipientDid, issuedAt: when,
        ceremony: { enactment, step, ...(step === 'issue-responder' ? { terminal: true } : {}) },
        payload: { vrc, vrcDigestMultibase: await digestDoc(vrc) },
    };
    return signStep(me.messaging, doc, when);
}
/** The receipt (issue#response): the digest computed over the credential AS STORED. */
export async function receipt(me, issueDoc, nowMs, id) {
    const when = iso(nowMs);
    const doc = {
        id, type: TASK_ISSUE + '#response', threadId: issueDoc.threadId,
        issuer: me.messaging.did, recipient: issueDoc.issuer, issuedAt: when,
        ceremony: { enactment: issueDoc.ceremony.enactment, step: issueDoc.ceremony.step },
        payload: { vrcDigestMultibase: await digestDoc(issueDoc.payload.vrc) },
    };
    return signStep(me.messaging, doc, when);
}
/** Check a propose the inviter received for its own link (`_id`, own did:peer:2). Age gate: 10 minutes + 5 minutes tolerance. */
export async function checkPropose(doc, me, nowMs) {
    if (doc?.type !== TASK_PROPOSE)
        return 'type';
    if (!parsePeer2(doc.issuer))
        return 'issuer-not-peer2';
    if (!(await verifyStep(doc)))
        return 'proof';
    if (doc.recipient !== me.did)
        return 'recipient';
    if (doc.ceremony?.enactment !== me.id || doc.ceremony?.step !== 'propose')
        return 'enactment';
    if (!canonicalChallenge(doc.id))
        return 'challenge-form';
    if (!edRawOfAnchor(doc.payload?.relationshipDid))
        return 'relationship-did';
    if (typeof doc.expiresAt === 'string' && nowMs >= Date.parse(doc.expiresAt))
        return 'expired';
    const age = nowMs - Date.parse(doc.issuedAt);
    if (!(age < (MAX_EXP_CODE_S + 300) * 1000 && age > -300_000))
        return 'not-fresh';
    return null;
}
/** Check an acceptance the responder received for its own propose. */
export async function checkAccept(doc, proposeDoc, inviterDid) {
    if (doc?.type !== TASK_PROPOSE + '#response')
        return 'type';
    if (doc.issuer !== inviterDid)
        return 'issuer-not-peer2';
    if (!(await verifyStep(doc)))
        return 'proof';
    if (doc.recipient !== proposeDoc.issuer)
        return 'recipient';
    if (doc.threadId !== proposeDoc.id)
        return 'thread';
    if (doc.ceremony?.enactment !== proposeDoc.ceremony.enactment || doc.ceremony?.step !== 'accept')
        return 'enactment';
    if (doc.payload?.accept !== true)
        return 'accept-flag';
    if (!edRawOfAnchor(doc.payload?.relationshipDid))
        return 'relationship-did';
    return null;
}
/** Check an issue document: envelope, then the credential against the accepted proposal. */
export async function checkIssue(doc, expect) {
    if (doc?.type !== TASK_ISSUE)
        return 'type';
    if (doc.issuer !== expect.issuerDid)
        return 'issuer-not-peer2';
    if (!(await verifyStep(doc)))
        return 'proof';
    if (doc.recipient !== expect.myDid)
        return 'recipient';
    if (doc.threadId !== expect.threadId)
        return 'thread';
    if (doc.ceremony?.enactment !== expect.enactment || doc.ceremony?.step !== expect.step)
        return 'enactment';
    const vrc = doc.payload?.vrc;
    if (!vrc || !(await diVerify(vrc, expect.issuerPair)))
        return 'vrc-proof';
    if (vrc.issuer !== expect.issuerPair)
        return 'vrc-issuer';
    if (vrc.credentialSubject?.id !== expect.myPair)
        return 'vrc-subject';
    if (doc.payload.vrcDigestMultibase !== undefined && doc.payload.vrcDigestMultibase !== await digestDoc(vrc))
        return 'vrc-digest';
    // profile checks for a credential of this ceremony's RLTP profile; other
    // profiles (Consensual's, Keyring's) carry their own members
    const cs = vrc.credentialSubject;
    if (cs.enactmentBinding !== undefined && cs.enactmentBinding !== expect.binding)
        return 'vrc-binding';
    if (cs.binding !== undefined && cs.binding !== expect.binding)
        return 'vrc-binding';
    if (cs.challenge !== undefined && cs.challenge !== expect.myChallenge)
        return 'vrc-challenge';
    return null;
}
// ── the offline back-code ───────────────────────────────────────────────
// The responder shows its propose as a code. Only what the inviter does
// not hold travels: the responder's did:peer:2 (_from), the propose id
// (_id), relationshipDid (rel), issuedAt as epoch seconds (t), the name
// (n) and the signature (sig). recipient, type, step, enactment and the
// proof configuration are rebuilt from the inviter's own state.
export const BACK_PATH = FLOW_PATH + '/back';
export function backCodeOf(proposeDoc, host = LINK_HOST) {
    if (proposeDoc.expiresAt !== undefined)
        throw new Error('a propose shown as a code carries no expiresAt; the link\'s _exp bounds it');
    const t = Math.floor(Date.parse(proposeDoc.issuedAt) / 1000);
    if (proposeDoc.proof.created !== proposeDoc.issuedAt)
        throw new Error('back-code form: proof.created must equal issuedAt');
    let frag = '_from=' + proposeDoc.issuer + '&_id=' + proposeDoc.id + '&_type=' + BACK_PATH + '&rel=' + proposeDoc.payload.relationshipDid + '&t=' + t;
    if (proposeDoc.payload.reason !== undefined)
        frag += '&n=' + encodeURIComponent(proposeDoc.payload.reason);
    frag += '&sig=' + proposeDoc.proof.proofValue;
    return host + LINK_PATH + '#' + frag;
}
/** Rebuild the propose from a back-code; the caller then runs checkPropose. Null when the code is not a back-code. */
export function proposeFromBackCode(code, me) {
    const h = code.indexOf('#');
    if (h < 0)
        return null;
    const p = {};
    for (const kv of code.slice(h + 1).split('&')) {
        const eq = kv.indexOf('=');
        if (eq > 0)
            p[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
    if (p._type !== BACK_PATH || !p._from || !p._id || !p.rel || !/^[0-9]{1,12}$/.test(p.t ?? '') || !p.sig)
        return null;
    const when = iso(Number(p.t) * 1000);
    const doc = {
        id: p._id, type: TASK_PROPOSE, issuer: p._from, recipient: me.did, issuedAt: when,
        ceremony: { enactment: me.id, step: 'propose' },
        payload: { relationshipDid: p.rel },
    };
    if (p.n !== undefined) {
        try {
            doc.payload.reason = decodeURIComponent(p.n);
        }
        catch {
            return null;
        }
    }
    doc.proof = { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', created: when, verificationMethod: peer2SigningKid(p._from), proofPurpose: 'authentication', proofValue: p.sig };
    return doc;
}
/** Build a party from two 32-byte seeds: the messaging identity (Ed + X derived from `msgSeed`) and the pair anchor. */
export async function partyFromSeeds(msgSeed, pairSeed, relays, name) {
    const ed = await edFromSeed(await hkdf(msgSeed, 'shared-connect/messaging/ed25519'));
    const x = await xFromSeed(await hkdf(msgSeed, 'shared-connect/messaging/x25519'));
    const pairEd = await edFromSeed(pairSeed);
    const did = peer2Of(ed.pubRaw, x.pubRaw, relays);
    const peer = parsePeer2(did);
    const p = { messaging: { did, ed: { priv: ed.priv } }, pair: { anchor: anchorOfEd(pairEd.pubRaw), ed: { priv: pairEd.priv } }, x, peer };
    if (name !== undefined)
        p.name = name;
    return p;
}
export { xRawOfMk };
