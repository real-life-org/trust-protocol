// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// access/exchange — how the group log travels in stage 1 (rltp design,
// 2026-11): three experimental task types on the pair channel between two
// members, and the pure rules of sending, answering and taking them in.
// The holder's task handlers (membership/holder.ts) bind them to state.
//
//   x-access-entry/0.1  { group, genesisDigest, entry }
//       one envelope (Access 3.3), sent by a replica that accepted it
//   x-access-sync/0.1   { group, genesisDigest, have[], want[]?, cursor? }
//       a request: what the sender holds, what it asks for by name
//   x-access-page/0.1   { group, genesisDigest, entries[], next?, last }
//       the answer, on the request's thread
//
// DEVIATION D1: the three types are replication in task form. Receiving
// one is the admission of Replication 7.1 through the ingress "Delivery
// document" of its table 7.3 (effect only through that admission, I14),
// never a signal under Access 3370, although 3370 names trust tasks.
//
// What this is against the Replication Contract: an exchange under the
// unattested exchange profile (4.4) between two replicas; no registered
// adapter, no target control, no outcome of 4.3 and none of the
// guarantees I1–I16. In place of the mutual possession proof of member
// identities (its section 6) stands the authenticated pair channel and
// the binding of that channel to a member anchor by prelude, invitation
// or welcome. The entry bound (ENTRY_BOUND, the Delivery plaintext limit
// less the document frame) lies below the floor of its section 9. The
// documents carry no proof of their own: the envelope carries the
// signatures. A member's signature in an envelope that travels on a pair
// channel is one more transferable link between that pair and the member
// anchor (the residue to Access 5880).
//
// The rules (each a function below):
//   - `have` names accepted operations; the answering replica reads each
//     with its ancestors, since an accepted operation's closure is
//     accepted (5720). A requester sends its heads. `want` names
//     operations to send whatever `have` says, with their ancestors
//   - the answer is the difference in ancestor-first order, accepted
//     entries only, never a held one; one page per request, `next` the
//     cursor of the following request, `last` the end. The answering
//     replica keeps no state between requests
//   - intake: form before any buffering (7.1 step 1), a known id merges its
//     proof without a second effect, an entry with a missing parent is
//     held in its sender's partition and asks that sender once for its
//     closure (the repair), protected from eviction while the repair runs
//     (REPAIR_WINDOW, at most REPAIR_MAX per group)
//   - forwarding: what a replica accepts, healed descendants included,
//     goes to every invitation-edge contact its materialization holds as
//     a member, except the source it came from, and an admission never to
//     its own subject (Membership §1: exactly one operation crosses the
//     boundary as a task, and that one is not this). Held entries never
//     travel (5700, 5710)
import { makeValidator } from '../core.js';
import { platformSubtle } from '../crypto.js';
import { SCHEMAS } from '../schemas.js';
import { TASK_NAMESPACE as TT } from '../task-uri.js';
import { GENESIS_OP } from './genesis.js';
import { ADD_OP, ENTRY_BOUND, admit, envelopeBytes, expireHeld } from './log.js';
export const ENTRY_TYPE = TT + 'x-access-entry/0.1';
export const SYNC_TYPE = TT + 'x-access-sync/0.1';
export const PAGE_TYPE = TT + 'x-access-page/0.1';
/** ids a request names at most (`have`), and asks for by name (`want`) */
export const HAVE_MAX = 1024;
export const WANT_MAX = 64;
/** the repair reserve: one protected run per held entry in this window, at most REPAIR_MAX protected entries per group */
export const REPAIR_WINDOW = 600_000;
export const REPAIR_MAX = 16;
const OID = { type: 'string', pattern: '^oid:[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$' };
const HEAD = {
    group: { type: 'string', pattern: '^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$', description: 'the group DID: its address, as the envelopes name it' },
    genesisDigest: { type: 'string', pattern: '^(u[A-Za-z0-9_-]{45}[AQgw]|z[1-9A-HJ-NP-Za-km-z]{44,48})$', description: 'the group identity (Access 3030): state and partitions are keyed by it (3065)' },
};
const ENVELOPE = { $ref: 'https://real-life.org/rltp/v1/schemas/access-operation-envelope.schema.json' };
const DECLARED = 'Trust Task declarations (Delivery 4.5): proof absent (the envelope carries the signatures); acknowledged on a defined effect (buffered, held, applied, or a request noted); rate-limited is a declared bound.';
/** The payload schemas of the three types ($id = type URI, payload only). NON-NORMATIVE: this library's experimental forms. */
export const EXCHANGE_SCHEMAS = Object.freeze({
    [ENTRY_TYPE]: {
        $schema: 'https://json-schema.org/draft/2020-12/schema', $id: ENTRY_TYPE, title: 'Payload: x-access-entry/0.1',
        description: 'One authority-log entry between two members of the group, on their pair channel. ' + DECLARED,
        type: 'object', required: ['group', 'genesisDigest', 'entry'], additionalProperties: false,
        properties: { ...HEAD, entry: ENVELOPE },
    },
    [SYNC_TYPE]: {
        $schema: 'https://json-schema.org/draft/2020-12/schema', $id: SYNC_TYPE, title: 'Payload: x-access-sync/0.1',
        description: 'A request for the entries the sender lacks. have: accepted operations, each read with its ancestors; want: operations to send regardless, with their ancestors; cursor: the next of the page before. ' + DECLARED,
        type: 'object', required: ['group', 'genesisDigest', 'have'], additionalProperties: false,
        properties: {
            ...HEAD,
            have: { type: 'array', items: OID, maxItems: HAVE_MAX, uniqueItems: true },
            want: { type: 'array', items: OID, minItems: 1, maxItems: WANT_MAX, uniqueItems: true },
            cursor: OID,
        },
    },
    [PAGE_TYPE]: {
        $schema: 'https://json-schema.org/draft/2020-12/schema', $id: PAGE_TYPE, title: 'Payload: x-access-page/0.1',
        description: 'The answer to one x-access-sync, on its thread: accepted entries in ancestor-first order; next is the cursor of the following request, last ends the exchange. ' + DECLARED,
        type: 'object', required: ['group', 'genesisDigest', 'entries', 'last'], additionalProperties: false,
        properties: { ...HEAD, entries: { type: 'array', items: ENVELOPE, maxItems: HAVE_MAX }, next: OID, last: { type: 'boolean' } },
    },
});
const V = makeValidator({ ...SCHEMAS, ...EXCHANGE_SCHEMAS });
/** the payload of one of the three types against its schema */
export const exchangePayloadOk = (type, payload) => {
    const s = EXCHANGE_SCHEMAS[type];
    return s !== undefined && V.validate(payload, s, s).length === 0;
};
// ── order and difference ───────────────────────────────────────────────
/** The accepted operations in ancestor-first order: by depth (the longest
 *  path from the genesis), then by id. Every operation follows all of its
 *  ancestors. */
export function ancestorFirst(log) {
    const depth = new Map();
    const depthOf = (id) => {
        const known = depth.get(id);
        if (known !== undefined)
            return known;
        // iterative: a long chain must not exhaust the stack
        const stack = [id];
        while (stack.length) {
            const top = stack[stack.length - 1];
            const open = log.accepted[top].prev.filter((p) => !depth.has(p));
            if (open.length) {
                stack.push(...open);
                continue;
            }
            depth.set(top, log.accepted[top].prev.reduce((d, p) => Math.max(d, depth.get(p) + 1), 0));
            stack.pop();
        }
        return depth.get(id);
    };
    return Object.keys(log.accepted).sort((a, b) => depthOf(a) - depthOf(b) || (a < b ? -1 : a > b ? 1 : 0));
}
/** the ids with all their accepted ancestors */
function closed(log, ids) {
    const out = new Set();
    const stack = [...ids].filter((id) => log.accepted[id]);
    while (stack.length) {
        const id = stack.pop();
        if (out.has(id))
            continue;
        out.add(id);
        stack.push(...log.accepted[id].prev);
    }
    return out;
}
/** What a request names as held: the heads of the accepted set (each read with its ancestors), at most HAVE_MAX. */
export const haveOf = (m) => m.heads.slice(0, HAVE_MAX);
/** One page for one request, from the accepted set alone (never a held
 *  entry, never the genesis: the requester addresses the group by it).
 *  Without `want`: every operation outside the closure of `have`. With
 *  `want`: the wanted operations and their ancestors, the wanted ones
 *  themselves whatever `have` says (a proof to merge). The page takes
 *  entries in ancestor-first order after `cursor` while they fit `bound`,
 *  at least one. */
export function pageOf(log, req, bound = ENTRY_BOUND) {
    const order = ancestorFirst(log);
    const has = closed(log, req.have);
    const wanted = req.want ? new Set(req.want) : null;
    const scope = wanted ? closed(log, wanted) : null;
    let rest = order.filter((id) => log.accepted[id].op !== GENESIS_OP && (scope === null || scope.has(id)) && (!has.has(id) || wanted?.has(id) === true));
    if (req.cursor !== undefined) {
        const at = order.indexOf(req.cursor);
        if (at >= 0) {
            const after = new Set(order.slice(at + 1));
            rest = rest.filter((id) => after.has(id));
        }
    }
    const entries = [];
    let bytes = 0;
    for (const id of rest) {
        const e = log.accepted[id];
        const n = envelopeBytes(e) + 1;
        if (entries.length && (bytes + n > bound || entries.length >= HAVE_MAX))
            break;
        entries.push(e);
        bytes += n;
    }
    const last = entries.length === rest.length;
    return { entries, ...(last ? {} : { next: entries[entries.length - 1].id }), last };
}
/** The parents still missing of the held entries that asked `source` for
 *  their closure: what every continuation of that repair asks for by name,
 *  page after page, as long as the entry is held (the repair record lives
 *  with it; `active` is the protection alone, and ends with the first
 *  answer). */
export const stillWanted = (r, source, _now) => {
    const out = new Set();
    for (const [id, x] of Object.entries(r.repairs)) {
        if (x.source !== source)
            continue;
        const env = r.log.held[id]?.env;
        if (env)
            for (const p of env.prev)
                if (!r.log.accepted[p] && !r.log.held[p] && !x.tried?.includes(p))
                    out.add(p);
    }
    // the whole outstanding set: the caller cuts it to WANT_MAX for one request
    return [...out].sort();
};
/** After the last page of a request that asked `source` for `asked` by
 *  name: what it did not bring, that source lacks. The repairs toward it
 *  remember so, and no later request to that source names those again. */
export function noteUnavailable(r, source, asked) {
    const missing = asked.filter((p) => !r.log.accepted[p] && !r.log.held[p]);
    if (!missing.length)
        return r;
    let repairs = r.repairs;
    for (const [id, x] of Object.entries(r.repairs)) {
        if (x.source !== source)
            continue;
        const env = r.log.held[id]?.env;
        const more = env ? missing.filter((p) => env.prev.includes(p) && !x.tried?.includes(p)) : [];
        if (more.length)
            repairs = { ...repairs, [id]: { ...x, tried: [...(x.tried ?? []), ...more].sort() } };
    }
    return repairs === r.repairs ? r : { ...r, repairs };
}
/** the held ids a running repair protects from eviction at `now` */
export const protectedIds = (r, now) => new Set(Object.entries(r.repairs).filter(([id, x]) => x.active && now < x.since + REPAIR_WINDOW && r.log.held[id] !== undefined).map(([id]) => id));
/** Takes entries from one source into the replica (Replication 7.1),
 *  each judged on its own, in order. `answers`: the entries are the answer
 *  to a request sent to this source, which ends the repairs toward it.
 *  `buffer`: the replica is joining and buffers. An empty list is a defined
 *  effect (the end of an exchange). */
export async function intake(replica, entries, at, subtle = platformSubtle()) {
    let log = expireHeld(replica.log, at.now);
    let repairs = replica.repairs;
    if (at.answers) {
        const ended = Object.entries(repairs).filter(([, x]) => x.active && x.source === at.source);
        if (ended.length) {
            repairs = { ...repairs };
            for (const [id, x] of ended)
                repairs[id] = { ...x, active: false };
        }
    }
    const verdicts = [];
    const applied = [];
    const want = new Set();
    for (const entry of entries) {
        const r = await admit(log, entry, { source: at.source, now: at.now, ...(at.bounds ? { bounds: at.bounds } : {}), protected: protectedIds({ log, repairs }, at.now), ...(at.buffer ? { buffer: true } : {}) }, subtle);
        const before = log;
        log = r.log;
        verdicts.push(r.verdict);
        if (r.verdict.kind === 'applied') {
            const id = entry.id;
            if (!before.accepted[id])
                applied.push(id);
            applied.push(...r.verdict.healed);
        }
        // the repair: once per held instance, for a missing parent only (an
        // ineligible proof heals by a merge, not by a closure), inside the reserve
        if (r.verdict.kind === 'held' && r.verdict.reason === 'missing-parent') {
            const e = entry;
            // a parent this replica holds itself (unsupported, ineligible) is asked for by nobody: no repair, no reserve taken
            const missing = e.prev.filter((p) => !log.accepted[p] && !log.held[p]);
            if (missing.length && !before.held[e.id] && repairs[e.id] === undefined && protectedIds({ log, repairs }, at.now).size < REPAIR_MAX) {
                repairs = { ...repairs, [e.id]: { source: at.source, since: at.now, active: true } };
                for (const p of missing)
                    want.add(p);
            }
        }
    }
    // a parent that arrived later in the same intake is no longer missing
    for (const p of [...want])
        if (log.accepted[p] || log.held[p])
            want.delete(p);
    // a repair lives as long as its entry is held
    const gone = Object.keys(repairs).filter((id) => log.held[id] === undefined);
    if (gone.length) {
        repairs = { ...repairs };
        for (const id of gone)
            delete repairs[id];
    }
    const effect = entries.length === 0 || verdicts.some((v) => v.kind === 'applied' || v.kind === 'held' || v.kind === 'duplicate');
    const disposition = effect ? 'effect' : verdicts.some((v) => v.kind === 'rate-limited') ? 'rate-limited' : 'validation-failed';
    const order = new Map(ancestorFirst(log).map((id, i) => [id, i]));
    applied.sort((a, b) => order.get(a) - order.get(b));
    return { replica: { log, repairs }, verdicts, applied, want: want.size ? [...want].sort().slice(0, WANT_MAX) : null, disposition };
}
/** What a replica forwards after accepting `applied` (the rule of the
 *  header): per edge contact that is a current member, the accepted
 *  entries in ancestor-first order, without the source's own and without
 *  an admission toward its subject. */
export function forwards(log, m, applied, edges, source) {
    const out = [];
    for (const edge of edges) {
        if (edge.contact === source || !m.members.includes(edge.member))
            continue;
        const entries = applied.map((id) => log.accepted[id]).filter((e) => !(e.op === ADD_OP && e.body.subject === edge.member));
        if (entries.length)
            out.push({ edge, entries });
    }
    return out;
}
/** Whether `member` may be answered and heard as a member (S1-8, S1-13): a current member of this replica's materialization. */
export const isCurrentMember = (m, member) => typeof member === 'string' && m.members.includes(member);
