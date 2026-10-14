// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// codec — the HolderState storage format (lib Stage 2, note §2.2).
//
// decodeState is the one way in: JSON purity, then the codec version, then
// the pure migration chain vN → vN+1, then hand-written structural
// validation of the result (no schema engine in the published library).
// An unknown or higher codec is refused, never read best-effort. Store
// adapters keep bytes or JSON and never migrate themselves. Wire
// versions and the codec are independent; a migration never re-issues
// stored documents, outbound or acks.
//
// Codec 0 is unstable until 0.4.0: persistence across library versions
// is not supported before then. From 0.4.0 every codec gets a golden
// fixture and a migration test.
import { jcs } from './core.js';
/** The codec this library writes. */
export const CODEC = 0;
/**
 * Migrations keyed by the codec they read: MIGRATIONS[n] maps a valid
 * codec-n state to a codec-(n+1) state. Pure, never async, never keys.
 */
export const MIGRATIONS = Object.freeze({});
/** A stored state the library will not load (or a state it will not write). */
export class StateCodecError extends Error {
    code;
    /** JSON path of the offending value, for 'shape' */
    path;
    constructor(code, message, path) {
        super(path === undefined ? `${code}: ${message}` : `${code} at ${path}: ${message}`);
        this.name = 'StateCodecError';
        this.code = code;
        if (path !== undefined)
            this.path = path;
    }
}
const fail = (path, msg) => { throw new StateCodecError('shape', msg, path); };
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const str = (x, p) => { if (typeof x !== 'string')
    fail(p, 'string expected'); };
const bool = (x, p) => { if (typeof x !== 'boolean')
    fail(p, 'boolean expected'); };
const json = () => { }; // JSON purity is checked once, up front
const dec = (x, p) => { if (typeof x !== 'string' || !/^(0|[1-9][0-9]{0,17})$/.test(x))
    fail(p, 'canonical decimal string expected'); };
const millis = (x, p) => { if (!Number.isSafeInteger(x) || x < 0)
    fail(p, 'non-negative integer milliseconds expected'); };
const natural = (x, p) => { if (!Number.isSafeInteger(x) || x < 0)
    fail(p, 'non-negative integer expected'); };
const positive = (x, p) => { if (!Number.isSafeInteger(x) || x < 1)
    fail(p, 'positive integer expected'); };
const lit = (...vals) => (x, p) => { if (!vals.includes(x))
    fail(p, 'one of ' + vals.map((v) => JSON.stringify(v)).join(', ') + ' expected'); };
const nullable = (v) => (x, p) => { if (x !== null)
    v(x, p); };
const arr = (v) => (x, p) => {
    if (!Array.isArray(x))
        fail(p, 'array expected');
    x.forEach((e, i) => v(e, `${p}[${i}]`));
};
/** an array used as a set: no duplicates */
const set = (v) => (x, p) => {
    arr(v)(x, p);
    if (new Set(x.map((e) => jcs(e))).size !== x.length)
        fail(p, 'duplicate set element');
};
const rec = (v) => (x, p) => {
    if (!isObj(x))
        fail(p, 'object expected');
    for (const [k, e] of Object.entries(x))
        v(e, `${p}.${k}`);
};
/** a closed object: required fields, optional fields, nothing else */
const obj = (req, opt = {}) => (x, p) => {
    if (!isObj(x))
        fail(p, 'object expected');
    const o = x;
    for (const k of Object.keys(req)) {
        if (!(k in o))
            fail(`${p}.${k}`, 'missing');
        req[k](o[k], `${p}.${k}`);
    }
    for (const k of Object.keys(o)) {
        if (k in req)
            continue;
        if (!(k in opt))
            fail(`${p}.${k}`, 'unknown field');
        opt[k](o[k], `${p}.${k}`);
    }
};
/** a record whose values carry their own key in `idField` */
const keyed = (v, idField) => (x, p) => {
    rec(v)(x, p);
    for (const [k, e] of Object.entries(x))
        if (e[idField] !== k)
            fail(`${p}.${k}.${idField}`, 'must equal its key');
};
// ── the HolderState shape (state.ts) ───────────────────────────────────
const setting = lit('default', 'on', 'off');
const trustClass = lit('star', 'groupStar', 'anchorMapping', 'sealedGroupStar', 'profile');
const recipient = obj({ contactId: str, rkid: str, keyAgreement: str });
const envelope = obj({ rkid: str, epk: str, nonce: str, ciphertext: str });
const starPair = obj({ member: str, head: str });
const assembly = obj({ salt: dec, chunks: rec(json) });
const starOut = obj({
    nextSalt: dec, hwm: dec, snapshot: nullable(arr(starPair)),
    inflight: rec(obj({ view: arr(starPair), digests: arr(str), acked: arr(str) })),
});
const starIn = obj({ hwm: dec, lowerBound: dec, assembly: nullable(assembly), accepted: nullable(obj({ salt: dec, blinded: arr(str) })) });
const tuple = obj({
    ownPairLabel: str, counterpartAnchor: str, counterpartKeyAgreement: str, rkid: str, entryId: str,
    priorCandidates: arr(str),
    starOut, starIn, groupStarOut: starOut, groupStarIn: starIn,
    probeOut: obj({ seq: dec }),
    probeIn: obj({ hwm: dec, lowerBound: dec, assembly: nullable(assembly) }),
    continuity: obj({ rev: dec, body: json, recordPrior: nullable(str), pending: bool }),
    mappingOut: obj({ rev: dec, body: json, underAnchor: nullable(str) }),
    mappingIn: obj({ rev: dec, body: json, self: nullable(str), card: json }),
    profileIn: obj({ rev: dec, body: json, verifiedSeq: dec }),
    deactivated: bool,
});
const relationship = obj({
    id: str, contactId: str, tuples: arr(tuple), activeHead: str, earliestAnchor: nullable(str),
    links: arr(obj({ prev: str, next: str })), bindings: rec(str), heldCounterpartHead: nullable(str),
    memory: rec(json), provenance: obj({ kind: lit('ceremony', 'introduced'), at: millis }, { via: str }),
    chainedInto: nullable(str),
});
const contact = obj({
    id: str, pos: nullable(dec), status: lit('none', 'admitted', 'pending'), aliases: set(str), relIds: set(str),
    anchorHead: nullable(str),
    settings: obj({ star: setting, groupStar: setting, anchorMapping: setting, sealedGroupStar: setting, profile: setting }),
    groupSettings: rec(setting),
});
const outboxStep = (x, p) => {
    if (!isObj(x))
        fail(p, 'object expected');
    const s = x;
    switch (s.status) {
        case 'submitted': return obj({ status: str, at: millis, attempt: positive })(x, p);
        case 'accepted': return obj({ status: str, at: millis })(x, p);
        case 'delivered': return obj({ status: str, at: millis, late: bool })(x, p);
        case 'failed': return s.reason === 'rejected-by-receiver'
            ? obj({ status: str, at: millis, reason: str, code: lit('malformedRequest', 'unsupportedType', 'proofRequired', 'proofInvalid', 'wrongRecipient', 'identityMismatch') })(x, p)
            : obj({ status: str, at: millis, reason: lit('unroutable', 'oversize', 'expired-by-adapter-policy', 'give-up') })(x, p);
        default: fail(`${p}.status`, 'unknown outbox status');
    }
};
const outboxItem = obj({
    type: str, threadId: str, recipient, envelope, attempt: positive, history: arr(outboxStep),
}, { nextAttemptAt: millis });
const KNOWN_DUTIES = {
    'reissue-mapping': { v: 1, shape: obj({ kind: str, v: positive, id: str, contactId: str, relId: str, awaitHead: nullable(str) }) },
    'class-on': { v: 1, shape: obj({ kind: str, v: positive, id: str, contactId: str, relId: str, cls: trustClass }) },
    profile: { v: 1, shape: obj({ kind: str, v: positive, id: str, contactId: str, relId: str, rev: dec }) },
    continuity: { v: 1, shape: obj({ kind: str, v: positive, id: str, relId: str, tuple: str, step: lit('probe', 'mapping') }) },
};
/** Is this a duty kind and version this library handles? Unknown ones are kept as they are. */
export const isKnownDuty = (d) => Object.hasOwn(KNOWN_DUTIES, d.kind) && KNOWN_DUTIES[d.kind].v === d.v;
const duty = (x, p) => {
    if (!isObj(x))
        fail(p, 'object expected');
    const d = x;
    str(d.kind, `${p}.kind`);
    natural(d.v, `${p}.v`);
    str(d.id, `${p}.id`);
    if (isKnownDuty(d))
        KNOWN_DUTIES[d.kind].shape(x, p);
};
const EVENT_FIELDS = {
    'contact.added': [{ contactId: str }],
    'contact.verified': [{ contactId: str, relationshipId: str }],
    'contact.chained': [{ contactId: str, relationshipId: str }],
    'trust.given': [{ contactId: str }],
    'trust.received': [{ contactId: str }],
    'trust.paused': [{ contactId: str, paused: bool }],
    'group.joined': [{ groupId: str }],
    'prompt.opened': [{ promptId: str, kind: lit('encounter-confirm', 'group-invite', 'introduction') }],
    'delivery.status': [{ digest: str, threadId: str, status: lit('submitted', 'accepted', 'delivered', 'failed') }, { late: bool }],
    'profile.updated': [{ contactId: nullable(str) }],
    'anchor.rotated': [{ generation: dec }],
};
const event = (x, p) => {
    if (!isObj(x))
        fail(p, 'object expected');
    const t = x.type;
    if (typeof t !== 'string' || !Object.hasOwn(EVENT_FIELDS, t))
        fail(`${p}.type`, 'unknown event type');
    const [req, opt = {}] = EVENT_FIELDS[t];
    obj({ type: str, eventId: str, version: str, ...req }, { actId: str, ...opt })(x, p);
};
const holderState = obj({
    codec: lit(CODEC),
    lastWhen: millis,
    register: obj({
        labels: set(str), pairNonces: rec(str),
        carriers: rec(arr(obj({ nonce: str, generation: dec }))),
        devices: obj({ names: set(str), revoked: set(str) }),
        community: nullable(obj({ genesis: str, head: dec })),
    }),
    addresses: obj({ keys: rec(obj({ label: str, lastShown: millis }, { retiredAt: millis })), tombstones: set(str) }),
    contacts: keyed(contact, 'id'),
    relationships: keyed(relationship, 'id'),
    entryOrder: obj({ nextPos: dec, heads: set(str) }),
    groups: keyed(obj({ id: str, memberLabel: str, rules: obj({ vouchThreshold: dec }), listed: bool, membership: json }), 'id'),
    profile: obj({ body: json, revision: dec }),
    effects: rec(obj({ ack: json, expiresAt: millis })),
    outbox: rec(outboxItem),
    duties: keyed(duty, 'id'),
    rotations: keyed(obj({ id: str, from: dec, to: dec, step: lit('register', 'log', 'duties'), startedAt: millis }), 'id'),
    prompts: keyed(obj({ id: str, kind: lit('encounter-confirm', 'group-invite', 'introduction'), openedAt: millis }, { contactId: str, groupId: str, expiresAt: millis }), 'id'),
    acts: keyed(obj({ actId: str, inputHash: str, version: str, outboundDigests: arr(str), events: arr(event), at: millis }), 'actId'),
    encounter: obj({ challenges: rec(json), records: rec(json), introductions: rec(json) }),
});
// ── the codec ──────────────────────────────────────────────────────────
/** Canonical JSON text of a JSON-pure value, or not-json. */
const canonical = (x) => {
    try {
        return jcs(x);
    }
    catch (e) {
        throw new StateCodecError('not-json', e.message);
    }
};
/**
 * Load a stored state: a JSON string or an already parsed value. Returns
 * an independent copy at the current codec, or throws StateCodecError.
 */
export function decodeState(raw) {
    let x = raw;
    if (typeof raw === 'string') {
        try {
            x = JSON.parse(raw);
        }
        catch (e) {
            throw new StateCodecError('not-json', e.message);
        }
    }
    let s = JSON.parse(canonical(x));
    if (!isObj(s))
        fail('$', 'object expected');
    const at = s.codec;
    if (!Number.isSafeInteger(at) || at < 0)
        throw new StateCodecError('codec-unknown', 'codec must be a non-negative integer');
    if (at > CODEC)
        throw new StateCodecError('codec-newer', `codec ${at} is newer than ${CODEC}`);
    for (let c = at; c < CODEC; c++) {
        const up = MIGRATIONS[c];
        if (!up)
            throw new StateCodecError('codec-unknown', `no migration from codec ${c}`);
        s = JSON.parse(canonical(up(s)));
        if (s.codec !== c + 1)
            throw new Error(`migration ${c} did not produce codec ${c + 1}`);
    }
    holderState(s, '$');
    return s;
}
/** Serialize a state for storage: canonical JSON, validated first. */
export function encodeState(state) {
    const text = canonical(state);
    holderState(JSON.parse(text), '$');
    return text;
}
/** Deterministic equality of two states (their JCS forms). */
export const sameState = (a, b) => jcs(a) === jcs(b);
