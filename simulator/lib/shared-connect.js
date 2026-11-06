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
//
// Known gaps of this first casting: `_from` and `issuer` must be a
// did:peer:2 (the long form of did:peer:4, which the registry entry admits,
// is refused as `unsupported-vid`); `relationshipDid` must be an Ed25519
// did:key (another method is refused as `unsupported-pair-did`). The
// library keeps no replay state: a propose seen twice is the caller's to
// absorb (the CLIs do, by the propose id).
import { jcs, base58, fromBase58, b64uOf, fromB64u, calOK, iso } from './core.js';
import { sha, cat, digestDoc, anchorOfEd, mkOfX, edRawOfAnchor, xRawOfMk, diSign, diVerify, edFromSeed, xFromSeed, hkdf } from './crypto.js';
import { CRED_CONTEXT } from './encounter.js';
const te = new TextEncoder();
const td = new TextDecoder();
const S = () => globalThis.crypto.subtle;
// ── constants ───────────────────────────────────────────────────────────
export const CEREMONY_URI = 'https://trusttasks.org/ceremony/shared-connect/0.1';
export const FLOW_PATH = '/vti/flow/shared-connect/0.1';
export const LINK_ORIGIN = 'https://link.trustoverip.org';
export const FLOW_URI = LINK_ORIGIN + FLOW_PATH;
export const LINK_PATH = '/t';
export const TASK_PROPOSE = 'https://trusttasks.org/spec/vrc/relationships/propose/0.1';
export const TASK_ISSUE = 'https://trusttasks.org/spec/vrc/relationships/issue/0.1';
/** Codes shown in person: at most 10 minutes (5 min challenge + clock tolerance). Links: at most 7 days. */
export const MAX_EXP_CODE_S = 10 * 60;
export const MAX_EXP_LINK_S = 7 * 24 * 3600;
/** Clock tolerance on `_exp`, `expiresAt` and `issuedAt` (seconds). */
export const CLOCK_TOLERANCE_S = 60;
/** Producer budget for a link that travels (characters); about 450 for a code shown in person. */
export const LINK_BUDGET = 990;
/** `_label`: at most 64 code points after NFC normalisation, display only. */
export const LABEL_MAX_CODEPOINTS = 64;
/** Reader limit of VTI-LNK-020 step 1 (code points). */
export const READER_LIMIT = 1536;
// ── challenges ──────────────────────────────────────────────────────────
/** Exactly 16 random bytes, canonical unpadded base64url: 22 characters, last one in A/Q/g/w (VTI-LNK-033). */
export const challengeOf16 = (bytes16) => {
    if (bytes16.length !== 16)
        throw new Error('a shared-connect challenge is exactly 16 bytes');
    return b64uOf(bytes16);
};
export const canonicalChallenge = (c) => typeof c === 'string' && /^[A-Za-z0-9_-]{21}[AQgw]$/.test(c);
const PURPOSE = { V: 'authentication', A: 'assertionMethod', E: 'keyAgreement', I: 'capabilityInvocation', D: 'capabilityDelegation' };
const SERVICE_TYPE_OF = { TSPTransport: 'tsp-mediator', tsp: 'tsp-mediator', NostrRelay: 'nostr-relay', DIDCommMessaging: 'didcomm-service' };
const RELAY_TYPE_OF = { 'tsp-mediator': 'TSPTransport', 'nostr-relay': 'NostrRelay', 'didcomm-service': 'DIDCommMessaging' };
const expandEndpoint = (e) => {
    if (Array.isArray(e))
        return e.map(expandEndpoint);
    if (e && typeof e === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(e))
            out[k === 'a' ? 'accept' : k === 'r' ? 'routingKeys' : k] = v;
        return out;
    }
    return e;
};
function expandService(raw, n) {
    const t = raw.t ?? raw.type;
    const type = t === 'dm' ? 'DIDCommMessaging' : String(t);
    const s = { id: n === 0 ? '#service' : '#service-' + n, type, serviceEndpoint: expandEndpoint(raw.s ?? raw.serviceEndpoint) };
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
const multikeyOf = (value) => {
    if (value[0] !== 'z')
        return null;
    const raw = fromBase58(value.slice(1));
    if (!raw || raw.length !== 34 || raw[1] !== 0x01)
        return null;
    if (raw[0] === 0xed)
        return { kind: 'ed', raw: raw.subarray(2) };
    if (raw[0] === 0xec)
        return { kind: 'x', raw: raw.subarray(2) };
    return null;
};
/** Render this ceremony's did:peer:2: `.V<ed>.A<ed>.E<x>` plus one `.S` per relay. */
export function peer2Of(edPub, xPub, relays = []) {
    const ed = anchorOfEd(edPub).slice('did:key:'.length);
    let did = 'did:peer:2.V' + ed + '.A' + ed + '.E' + mkOfX(xPub);
    for (const r of relays) {
        const t = RELAY_TYPE_OF[r.kind] ?? r.kind;
        did += '.S' + b64uOf(te.encode(JSON.stringify({ t, s: r.address })));
    }
    return did;
}
/** Parse and resolve a did:peer:2 locally, by DIF numalgo 2. Null when it is not
 *  one this ceremony can use: exactly one Ed25519 key under `authentication` and
 *  exactly one X25519 key under `keyAgreement` (further segments are read, not refused). */
export function parsePeer2(did) {
    if (typeof did !== 'string' || !did.startsWith('did:peer:2.') || /[^A-Za-z0-9._:-]/.test(did))
        return null;
    const doc = { id: did, verificationMethod: [], authentication: [], assertionMethod: [], keyAgreement: [], capabilityInvocation: [], capabilityDelegation: [], service: [] };
    const keys = new Map();
    let serviceN = 0;
    for (const p of did.slice('did:peer:2.'.length).split('.')) {
        const purpose = p[0], value = p.slice(1);
        if (purpose in PURPOSE) {
            const k = multikeyOf(value);
            if (!k)
                return null;
            if ((purpose === 'E') !== (k.kind === 'x'))
                return null;
            const id = '#key-' + (doc.verificationMethod.length + 1);
            doc.verificationMethod.push({ id, type: 'Multikey', controller: did, publicKeyMultibase: value });
            doc[PURPOSE[purpose]].push(id);
            keys.set(id, k);
        }
        else if (purpose === 'S') {
            let obj;
            try {
                obj = JSON.parse(td.decode(fromB64u(value)));
            }
            catch {
                return null;
            }
            for (const o of Array.isArray(obj) ? obj : [obj]) {
                if (!o || typeof o !== 'object')
                    return null;
                doc.service.push(expandService(o, serviceN++));
            }
        }
        else
            return null;
    }
    if (doc.authentication.length !== 1 || doc.keyAgreement.length !== 1)
        return null;
    const ed = keys.get(doc.authentication[0]), x = keys.get(doc.keyAgreement[0]);
    const relays = [];
    for (const s of doc.service) {
        const kind = SERVICE_TYPE_OF[s.type];
        const address = endpointUri(s.serviceEndpoint);
        if (kind && address)
            relays.push({ kind, address });
    }
    return { did, ed: ed.raw, x: x.raw, doc, relays };
}
/** The Ed25519 method of a did:peer:2 listed under `purpose`, or null. */
export function peer2MethodFor(peer, purpose) {
    for (const id of peer.doc[purpose]) {
        const vm = peer.doc.verificationMethod.find((m) => m.id === id);
        if (!vm)
            continue;
        const k = multikeyOf(vm.publicKeyMultibase);
        if (k?.kind === 'ed')
            return { id: peer.did + id, raw: k.raw };
    }
    return null;
}
const LABEL_FORBIDDEN = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u061c\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2069\\ufeff]');
/** The one label rule, applied by writer and reader alike: NFC, 1 to 64 code points, no control, bidi, zero-width or line characters. */
export const normalLabel = (label) => {
    if (typeof label !== 'string')
        return null;
    const n = label.normalize('NFC');
    const len = [...n].length;
    if (len === 0 || len > LABEL_MAX_CODEPOINTS || LABEL_FORBIDDEN.test(n))
        return null;
    return n;
};
/** Render the link. `exp` in epoch seconds; `nowS` is what the expiry caps are measured against. */
export function sharedConnectLink(f, origin = LINK_ORIGIN, nowS = Math.floor(Date.now() / 1000)) {
    if (!canonicalChallenge(f.id))
        throw new Error('_id must be a canonical 16-byte challenge');
    if (!parsePeer2(f.from))
        throw new Error('_from must be a did:peer:2 this ceremony can use');
    const cap = (f.kind ?? 'code') === 'code' ? MAX_EXP_CODE_S : MAX_EXP_LINK_S;
    if (!Number.isInteger(f.exp) || f.exp <= nowS || f.exp - nowS > cap)
        throw new Error(`_exp must lie within the next ${cap} seconds`);
    const type = f.type ?? (origin === LINK_ORIGIN ? FLOW_PATH : FLOW_URI);
    let frag = '_from=' + f.from + '&_id=' + f.id + '&_exp=' + f.exp + '&_type=' + type;
    if (f.label !== undefined) {
        const l = normalLabel(f.label);
        if (l === null)
            throw new Error('_label: 1 to 64 code points, no control characters');
        frag += '&_label=' + encodeURIComponent(l);
    }
    const link = origin + LINK_PATH + '#' + frag;
    if (link.length > LINK_BUDGET)
        throw new Error('link exceeds the shared-connect budget of ' + LINK_BUDGET + ' characters');
    return link;
}
/** Parse a fragment into one value per name. Null on a repeated reserved name; a repeat of an
 *  unknown name keeps the first value (VTI-LNK-011: unknown names are ignored). */
function fragmentParams(hash, strict = false) {
    const params = new Map();
    for (const kv of hash.split('&')) {
        if (!kv)
            continue;
        const eq = kv.indexOf('=');
        const k = eq < 0 ? kv : kv.slice(0, eq);
        const v = eq < 0 ? '' : kv.slice(eq + 1);
        if (params.has(k)) {
            if (strict || k.startsWith('_'))
                return null;
            continue;
        }
        params.set(k, v);
    }
    return params;
}
/** Read a shared-connect link. Checks in the order of VTI-LNK-020: length, scheme, host,
 *  fragment, duplicates, `_from`, `_id`, `_type` (the flow as a whole URI, VTI-LNK-040 to 043),
 *  the contact, expiry. The reader stops at the first failure. */
export function readSharedConnectLink(link, nowS = Math.floor(Date.now() / 1000)) {
    if ([...link].length > READER_LIMIT)
        return { ok: false, reason: 'too-long' };
    let url;
    try {
        url = new URL(link);
    }
    catch {
        return { ok: false, reason: 'not-https' };
    }
    if (url.protocol !== 'https:')
        return { ok: false, reason: 'not-https' };
    // VTI-LNK-060 host rules: no userinfo, no explicit port (a dev link on a port is refused too)
    if (!url.hostname || url.username || url.password || url.port)
        return { ok: false, reason: 'bad-host' };
    if (url.hash.length < 2)
        return { ok: false, reason: 'no-fragment' };
    const params = fragmentParams(url.hash.slice(1));
    if (!params)
        return { ok: false, reason: 'repeated-param' };
    const from = params.get('_from');
    if (from === undefined)
        return { ok: false, reason: 'missing-from' };
    if (!/^did:[a-z0-9]+:/.test(from))
        return { ok: false, reason: 'bad-from' };
    const id = params.get('_id');
    if (id === undefined)
        return { ok: false, reason: 'missing-id' };
    if (!canonicalChallenge(id))
        return { ok: false, reason: 'bad-id' };
    const type = params.get('_type');
    if (type === undefined)
        return { ok: false, reason: 'missing-type' };
    // VTI-LNK-041/043: the flow is the whole URI; the path form resolves against the link's own origin
    const flow = type.startsWith('/') ? url.origin + type : type;
    if (flow !== FLOW_URI)
        return { ok: false, reason: 'unknown-flow' };
    const peer = parsePeer2(from);
    if (!peer)
        return { ok: false, reason: 'unsupported-vid' };
    const expS = params.get('_exp');
    if (expS === undefined)
        return { ok: false, reason: 'missing-exp' };
    if (!/^[1-9][0-9]{0,11}$/.test(expS))
        return { ok: false, reason: 'bad-exp' };
    const exp = Number(expS);
    if (exp - nowS > MAX_EXP_LINK_S + CLOCK_TOLERANCE_S)
        return { ok: false, reason: 'bad-exp' };
    if (nowS >= exp)
        return { ok: false, reason: 'expired' };
    const out = { from: peer, id, exp, type: flow, params };
    const rawLabel = params.get('_label');
    if (rawLabel !== undefined) {
        let decoded = null;
        try {
            decoded = decodeURIComponent(rawLabel);
        }
        catch { /* dropped */ }
        const l = normalLabel(decoded);
        if (l !== null)
            out.label = l;
    }
    return { ok: true, link: out };
}
/** Sign a step document under `authentication` with the did:peer:2's authentication key (eddsa-jcs-2022). */
export async function signStep(ctx, doc, created) {
    const peer = parsePeer2(ctx.did);
    if (!peer)
        throw new Error('signStep: the signer is not a did:peer:2 this ceremony can use');
    const vm = peer2MethodFor(peer, 'authentication');
    const cfg = { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', created, verificationMethod: vm.id, proofPurpose: 'authentication' };
    if ('@context' in doc)
        cfg['@context'] = doc['@context'];
    const hashData = cat(await sha(te.encode(jcs(cfg))), await sha(te.encode(jcs(doc))));
    const sig = new Uint8Array(await S().sign({ name: 'Ed25519' }, ctx.ed.priv, hashData));
    return { ...doc, proof: { ...cfg, proofValue: 'z' + base58(sig) } };
}
/** Verify a step document's proof: the verification method belongs to the document's
 *  issuer (a did:peer:2), is listed under the proof's purpose (`authentication` or
 *  `assertionMethod`, TT §4.7.3) and is an Ed25519 key; canonical proofValue; the
 *  proof repeats the document's @context when there is one. */
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
    const fragment = proof.verificationMethod.slice(vmDid.length);
    if (!peer.doc[proof.proofPurpose].includes(fragment))
        return false;
    const vm = peer.doc.verificationMethod.find((m) => m.id === fragment);
    if (!vm)
        return false;
    const key = multikeyOf(vm.publicKeyMultibase);
    if (key?.kind !== 'ed')
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
    const pub = await S().importKey('raw', key.raw, { name: 'Ed25519' }, false, ['verify']);
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
    if (responder.name !== undefined) {
        const reason = responder.name.normalize('NFC');
        if ([...reason].length < 1 || [...reason].length > 500)
            throw new Error('propose reason: 1 to 500 code points');
        doc.payload.reason = reason;
    }
    return signStep(responder.messaging, doc, when);
}
/** The inviter's acceptance (propose#response). `id`: a fresh document id the caller draws (Entropy port).
 *  The response payload is closed (`accept`, `relationshipDid`, `witnessed`, `ext`): the inviter's name
 *  travels in the link's `_label`, not here. */
export async function accept(inviter, proposeDoc, nowMs, id) {
    const when = iso(nowMs);
    const doc = {
        id, type: TASK_PROPOSE + '#response', threadId: proposeDoc.id,
        issuer: inviter.messaging.did, recipient: proposeDoc.issuer, issuedAt: when,
        ceremony: { enactment: proposeDoc.ceremony.enactment, step: 'accept' },
        payload: { accept: true, relationshipDid: inviter.pair.anchor },
    };
    return signStep(inviter.messaging, doc, when);
}
/** The enactment binding both credentials carry: over the ceremony URI and both challenges (Encounter 5.4). */
export const binding = (inviterChallenge, responderChallenge) => digestDoc({ ceremony: CEREMONY_URI, challenges: [inviterChallenge, responderChallenge].sort() });
/** This side's credential about the other (RLTP encounter profile with `channel`). The hint type
 *  `EncounterCredential` is set only for this side's own observation of an encounter: `scan` (the
 *  responder captured the code with its camera) or `displayed` (the inviter showed it as a code).
 *  Over a link (`link`, `sent`) the credential is a plain `RelationshipCredential`. */
export async function credential(me, subjectPair, subjectChallenge, enactmentBinding, channel, nowMs) {
    const when = iso(nowMs);
    const body = {
        '@context': [...CRED_CONTEXT],
        type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential', ...(channel === 'scan' || channel === 'displayed' ? ['EncounterCredential'] : [])],
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
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const closed = (o, allowed) => Object.keys(o).every((k) => allowed.includes(k));
const optBool = (v) => v === undefined || typeof v === 'boolean';
const optExt = (v) => v === undefined || isObj(v);
/** The envelope (TT §4.2) and the payload shape of the task (§7.2 item 2), before any signature work.
 *  `window`: the freshness window on `issuedAt` in ms, where the step has one. */
function envelopeRefusal(doc, expectType, nowMs, window) {
    if (!isObj(doc) || doc.type !== expectType)
        return 'type';
    if (typeof doc.id !== 'string' || doc.id.length === 0 || doc.id.length > 256)
        return 'envelope';
    if (typeof doc.issuer !== 'string' || typeof doc.recipient !== 'string')
        return 'envelope';
    if (typeof doc.issuedAt !== 'string' || !calOK(doc.issuedAt))
        return 'envelope';
    if (doc.expiresAt !== undefined && (typeof doc.expiresAt !== 'string' || !calOK(doc.expiresAt)))
        return 'envelope';
    if (!isObj(doc.ceremony) || !canonicalChallenge(doc.ceremony.enactment) || typeof doc.ceremony.step !== 'string')
        return 'envelope';
    if (doc.threadId !== undefined && typeof doc.threadId !== 'string')
        return 'envelope';
    if (!isObj(doc.payload))
        return 'payload';
    const p = doc.payload;
    switch (expectType) {
        case TASK_PROPOSE:
            if (!closed(p, ['relationshipDid', 'witnessed', 'reason', 'ext']) || typeof p.relationshipDid !== 'string' || !optBool(p.witnessed) || !optExt(p.ext))
                return 'payload';
            if (p.reason !== undefined && (typeof p.reason !== 'string' || [...p.reason].length < 1 || [...p.reason].length > 500))
                return 'payload';
            break;
        case TASK_PROPOSE + '#response':
            if (!closed(p, ['accept', 'relationshipDid', 'witnessed', 'ext']) || typeof p.relationshipDid !== 'string' || !optBool(p.witnessed) || !optExt(p.ext))
                return 'payload';
            if (p.accept !== true)
                return 'accept-flag';
            break;
        case TASK_ISSUE:
            if (!closed(p, ['vrc', 'vrcDigestMultibase', 'ext']) || !isObj(p.vrc) || !optExt(p.ext))
                return 'payload';
            if (p.vrcDigestMultibase !== undefined && typeof p.vrcDigestMultibase !== 'string')
                return 'payload';
            break;
        case TASK_ISSUE + '#response':
            if (!closed(p, ['vrcDigestMultibase', 'ext']) || typeof p.vrcDigestMultibase !== 'string' || !optExt(p.ext))
                return 'payload';
            break;
    }
    // TT §4.2: a document is not acted on when now ≥ expiresAt; the clock tolerance works in the document's favour
    if (doc.expiresAt !== undefined && nowMs >= Date.parse(doc.expiresAt) + CLOCK_TOLERANCE_S * 1000)
        return 'expired';
    // no step is dated in the future beyond the tolerance
    if (Date.parse(doc.issuedAt) > nowMs + CLOCK_TOLERANCE_S * 1000)
        return 'not-fresh';
    if (window !== undefined) {
        const age = nowMs - Date.parse(doc.issuedAt);
        if (!(age < window && age > -CLOCK_TOLERANCE_S * 1000))
            return 'not-fresh';
    }
    return null;
}
const FRESH_MS = (MAX_EXP_CODE_S + CLOCK_TOLERANCE_S) * 1000;
/** Check a propose the inviter received for its own link (`_id`, `exp`, own did:peer:2).
 *  The link's `_exp` bounds the handle: a propose for an expired `_id` is refused, whatever
 *  its own freshness. Age gate on the document: 10 minutes + clock tolerance. */
export async function checkPropose(doc, me, nowMs) {
    const e = envelopeRefusal(doc, TASK_PROPOSE, nowMs, FRESH_MS);
    if (e)
        return e;
    if (nowMs >= (me.exp + CLOCK_TOLERANCE_S) * 1000)
        return 'expired-link';
    if (!parsePeer2(doc.issuer))
        return 'issuer-not-peer2';
    if (doc.recipient !== me.did)
        return 'recipient';
    if (doc.ceremony.enactment !== me.id || doc.ceremony.step !== 'propose')
        return 'enactment';
    if (!canonicalChallenge(doc.id))
        return 'challenge-form';
    if (!edRawOfAnchor(doc.payload.relationshipDid))
        return 'unsupported-pair-did';
    if (!(await verifyStep(doc)))
        return 'proof';
    return null;
}
/** Check an acceptance the responder received for its own propose. */
export async function checkAccept(doc, proposeDoc, inviterDid, nowMs = Date.now()) {
    const e = envelopeRefusal(doc, TASK_PROPOSE + '#response', nowMs, FRESH_MS);
    if (e)
        return e;
    if (doc.issuer !== inviterDid)
        return 'issuer';
    if (doc.recipient !== proposeDoc.issuer)
        return 'recipient';
    if (doc.threadId !== proposeDoc.id)
        return 'thread';
    if (doc.ceremony.enactment !== proposeDoc.ceremony.enactment || doc.ceremony.step !== 'accept')
        return 'enactment';
    if (!edRawOfAnchor(doc.payload.relationshipDid))
        return 'unsupported-pair-did';
    if (!(await verifyStep(doc)))
        return 'proof';
    return null;
}
/** Check an issue document: envelope, then the credential against the accepted proposal.
 *  No freshness window: the inviter's credential may follow long after the acceptance. */
export async function checkIssue(doc, expect, nowMs = Date.now()) {
    const e = envelopeRefusal(doc, TASK_ISSUE, nowMs);
    if (e)
        return e;
    if (doc.issuer !== expect.issuerDid)
        return 'issuer';
    if (doc.recipient !== expect.myDid)
        return 'recipient';
    if (doc.threadId !== expect.threadId)
        return 'thread';
    if (doc.ceremony.enactment !== expect.enactment || doc.ceremony.step !== expect.step)
        return 'enactment';
    if (!(await verifyStep(doc)))
        return 'proof';
    const vrc = doc.payload.vrc;
    if (vrc.issuer !== expect.issuerPair)
        return 'vrc-issuer';
    if (!(await diVerify(vrc, expect.issuerPair)))
        return 'vrc-proof';
    if (vrc.credentialSubject?.id !== expect.myPair)
        return 'vrc-subject';
    if (doc.payload.vrcDigestMultibase !== undefined && doc.payload.vrcDigestMultibase !== await digestDoc(vrc))
        return 'vrc-digest';
    // profile checks for a credential of this ceremony's RLTP profile; other
    // profiles (Consensual's, Keyring's) carry their own members and pass here
    const cs = vrc.credentialSubject;
    if (cs.enactmentBinding !== undefined && cs.enactmentBinding !== expect.binding)
        return 'vrc-binding';
    if (cs.binding !== undefined && cs.binding !== expect.binding)
        return 'vrc-binding';
    if (cs.challenge !== undefined && cs.challenge !== expect.myChallenge)
        return 'vrc-challenge';
    return null;
}
/** Check a receipt (issue#response) for an issue this side sent. */
export async function checkReceipt(doc, sentIssue, expect, nowMs = Date.now()) {
    const e = envelopeRefusal(doc, TASK_ISSUE + '#response', nowMs);
    if (e)
        return e;
    if (doc.issuer !== expect.issuerDid)
        return 'issuer';
    if (doc.recipient !== expect.myDid)
        return 'recipient';
    if (doc.threadId !== sentIssue.threadId)
        return 'thread';
    if (doc.ceremony.enactment !== sentIssue.ceremony.enactment || doc.ceremony.step !== sentIssue.ceremony.step)
        return 'enactment';
    if (doc.payload.vrcDigestMultibase !== await digestDoc(sentIssue.payload.vrc))
        return 'vrc-digest';
    if (!(await verifyStep(doc)))
        return 'proof';
    return null;
}
// ── the offline back-code ───────────────────────────────────────────────
// The responder shows its propose as a code. Only what the inviter does
// not hold travels: the responder's did:peer:2 (_from), the propose id
// (_id), relationshipDid (rel), issuedAt as epoch seconds (t), the name
// (n) and the signature (sig). recipient, type, step, enactment and the
// proof configuration are rebuilt from the inviter's own state, so a code
// replayed under another `_id` or to another inviter fails its proof. The
// same code shown twice to the same inviter rebuilds the same document;
// absorbing that is the caller's (by the propose id). The link's `_exp`
// bounds the code too: checkPropose refuses it once `_id` has expired.
export const BACK_PATH = FLOW_PATH + '/back';
export function backCodeOf(proposeDoc, origin = LINK_ORIGIN) {
    if (proposeDoc.expiresAt !== undefined)
        throw new Error('a propose shown as a code carries no expiresAt; the link\'s _exp bounds the handle');
    if (proposeDoc.proof.created !== proposeDoc.issuedAt)
        throw new Error('back-code form: proof.created must equal issuedAt');
    const t = Math.floor(Date.parse(proposeDoc.issuedAt) / 1000);
    let frag = '_from=' + proposeDoc.issuer + '&_id=' + proposeDoc.id + '&_type=' + (origin === LINK_ORIGIN ? BACK_PATH : LINK_ORIGIN + BACK_PATH) + '&rel=' + proposeDoc.payload.relationshipDid + '&t=' + t;
    if (proposeDoc.payload.reason !== undefined)
        frag += '&n=' + encodeURIComponent(proposeDoc.payload.reason);
    frag += '&sig=' + proposeDoc.proof.proofValue;
    return origin + LINK_PATH + '#' + frag;
}
/** Rebuild the propose from a back-code; the caller then runs checkPropose. Null when the code
 *  is not a well-formed back-code (same grammar as the link: https, one value per name). */
export function proposeFromBackCode(code, me) {
    let url;
    try {
        url = new URL(code);
    }
    catch {
        return null;
    }
    if (url.protocol !== 'https:' || url.hash.length < 2)
        return null;
    const p = fragmentParams(url.hash.slice(1), true);
    if (!p)
        return null; // every name of the back-code is ours: one value each
    const type = p.get('_type');
    if (type === undefined)
        return null;
    if ((type.startsWith('/') ? url.origin + type : type) !== LINK_ORIGIN + BACK_PATH)
        return null;
    const from = p.get('_from'), id = p.get('_id'), rel = p.get('rel'), t = p.get('t'), sig = p.get('sig');
    const peer = from ? parsePeer2(from) : null;
    if (!peer || !canonicalChallenge(id) || !rel || !/^did:/.test(rel) || !/^[1-9][0-9]{0,11}$/.test(t ?? '') || !sig || sig[0] !== 'z')
        return null;
    const vm = peer2MethodFor(peer, 'authentication');
    if (!vm)
        return null;
    const when = iso(Number(t) * 1000);
    const doc = {
        id, type: TASK_PROPOSE, issuer: peer.did, recipient: me.did, issuedAt: when,
        ceremony: { enactment: me.id, step: 'propose' },
        payload: { relationshipDid: rel },
    };
    const n = p.get('n');
    if (n !== undefined) {
        try {
            doc.payload.reason = decodeURIComponent(n);
        }
        catch {
            return null;
        }
    }
    doc.proof = { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', created: when, verificationMethod: vm.id, proofPurpose: 'authentication', proofValue: sig };
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
