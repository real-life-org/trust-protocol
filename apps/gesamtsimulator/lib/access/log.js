// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// access/log — the authority log of one group (Access 3.1) and its
// materialization (3.5), stage 1 of the group log (rltp design, 2026-11):
// the operations group.genesis, member.add and member.leave as a set of
// signed envelopes, keyed by genesis digest (3065), admitted ancestor-first
// (5720) with held pre-accepted evidence for a missing parent or an
// incomplete proof (Replication 3.4.1, 7.1), and the membership as a pure
// function of the accepted set.
//
// What stage 1 reads against the text, each a row of DEVIATIONS.md:
//   DEVIATION D2: a member.leave takes effect at once (no pending exit, no
//   discharging transition), defeats every member.add of its subject that
//   is not causally after it, and no member.add of a subject with a
//   canonical leave in its ancestry is canonical (rule 0 with pending exits
//   read as members, 3315/5400). A leave at sole membership is the
//   last-member dissolve (4410): the group is terminal.
//   DEVIATION D4: a back-dated member.add by a member who has left is valid
//   at its position (3325) and is applied; the risk is named, not disposed.
// Not built, by the stage: policy change, transitions and epochs, device
// cards, member.remove, the conflict matrix beyond the above. A registered
// operation stage 1 does not build is held without effect and keeps its
// descendants from taking effect; an unregistered one is invalid (4060).
import { jcs, sameDigest } from '../core.js';
import { digestDoc, platformSubtle } from '../crypto.js';
import { MEMBERSHIP_SKEW, acceptProblem, inviteProblem, membershipSchemaOk } from '../membership.js';
import { ENVELOPE_V, formProblem, genesisDigestOf, mergeProof } from './envelope.js';
import { GENESIS_OP, genesisProblem } from './genesis.js';
export const ADD_OP = 'member.add';
/** the group bound of rule 0 (RLTP-ACC-5410): an admission into a group of this many members is not canonical */
export const GROUP_BOUND = 4096;
/** how long a held entry waits for its parent or its proof before it leaves (the longest give-up horizon, P90D) */
export const HELD_LIFETIME = 90 * 86_400_000;
export const LEAVE_OP = 'member.leave';
/** the operations stage 1 materializes */
export const BUILT_OPS = new Set([GENESIS_OP, ADD_OP, LEAVE_OP]);
/** the registered operation catalog (4.5): held when not built, never invalid for the name alone */
export const REGISTERED_OPS = new Set([
    'group.genesis', 'member.add', 'member.remove', 'member.leave', 'epoch.rotate', 'policy.change', 'visibility.change', 'history.expose',
    'lineage.repair', 'document.attach', 'document.detach', 'device.add', 'dag.join', 'device.revoke', 'group.dissolve', 'service-identity.announce', 'anchor.rotate',
]);
export const emptyLog = (genesisDigest, genesis) => ({ genesisDigest, accepted: { [genesis.id]: genesis }, held: {} });
const te = new TextEncoder();
export const envelopeBytes = (env) => te.encode(jcs(env)).length;
const prevOf = (env) => env.prev;
/** the ancestor closure (prev transitively), accepted entries only; memoized */
function closureOf(f, id) {
    const known = f.closure.get(id);
    if (known)
        return known;
    const out = new Set();
    const stack = [...prevOf(f.log.accepted[id])];
    while (stack.length) {
        const p = stack.pop();
        if (out.has(p))
            continue;
        out.add(p);
        const sub = f.closure.get(p);
        if (sub)
            for (const q of sub)
                out.add(q);
        else
            stack.push(...prevOf(f.log.accepted[p]));
    }
    f.closure.set(id, out);
    return out;
}
/** The members a set of operations yields (the membership rule of stage 1):
 *  S is a member exactly when a canonical admission of S is in the set and
 *  no canonical leave of S is (DEVIATION D2); the genesis admits the
 *  founder. A dissolve in the set yields nobody. */
function membersIn(f, set) {
    const added = new Set();
    const left = new Set();
    for (const id of set) {
        if (f.dissolves.has(id))
            return new Set();
        if (f.verdict.get(id) !== 'canonical')
            continue;
        const env = f.log.accepted[id];
        if (env.op === GENESIS_OP)
            added.add(env.author);
        else if (env.op === ADD_OP)
            added.add(f.subjectOf.get(id));
        else if (env.op === LEAVE_OP)
            left.add(env.author);
    }
    for (const s of left)
        added.delete(s);
    return added;
}
/** judges one accepted operation at its position (3.4.2, 5.3); its ancestors are judged first */
function judge(f, id) {
    const known = f.verdict.get(id);
    if (known)
        return known;
    const env = f.log.accepted[id];
    const anc = closureOf(f, id);
    for (const a of anc)
        judge(f, a);
    let v;
    if (env.op === GENESIS_OP)
        v = 'canonical';
    else if (!BUILT_OPS.has(env.op) || [...anc].some((a) => f.verdict.get(a) === 'unsupported'))
        v = 'unsupported';
    else if ([...anc].some((a) => f.dissolves.has(a)))
        v = 'not-canonical';
    else if (env.epoch !== 0 || env.policyVersion !== 1)
        v = 'not-canonical';
    else {
        const M = membersIn(f, anc);
        if (env.op === LEAVE_OP) {
            // 4430: an empty body; the author a member at the position (3315)
            if (Object.keys(env.body).length !== 0 || !M.has(env.author))
                v = 'not-canonical';
            else {
                v = 'canonical';
                if (M.size === 1)
                    f.dissolves.add(id);
            }
        }
        else if (f.staticBad.has(id)) {
            v = 'not-canonical';
        }
        else {
            const b = env.body;
            const subject = b.subject;
            const inviter = b.admission.invite?.issuer;
            const acceptDigest = f.acceptDigestOf.get(id);
            const leftBefore = [...anc].some((a) => f.verdict.get(a) === 'canonical' && f.log.accepted[a].op === LEAVE_OP && f.log.accepted[a].author === subject);
            const consumed = [...anc].some((a) => f.verdict.get(a) === 'canonical' && f.log.accepted[a].op === ADD_OP && sameDigest(f.acceptDigestOf.get(a), acceptDigest));
            // rule 0 (5400; with a leave in the ancestry read as a pending exit, DEVIATION D2), rule 4 (5460, any-member), rule 5 (5470)
            // rule 0 with the group bound (5410), rules 4 and 5
            if (M.has(subject) || leftBefore || M.size >= GROUP_BOUND || !M.has(inviter) || !M.has(env.author) || consumed)
                v = 'not-canonical';
            else {
                v = 'canonical';
                f.subjectOf.set(id, subject);
            }
        }
    }
    f.verdict.set(id, v);
    return v;
}
/** judges every accepted operation; the fold the materialization and the position checks read */
async function foldOf(log, subtle) {
    const f = { log, closure: new Map(), verdict: new Map(), subjectOf: new Map(), acceptDigestOf: new Map(), dissolves: new Set(), staticBad: new Set() };
    const ids = Object.keys(log.accepted).sort();
    for (const id of ids) {
        const env = log.accepted[id];
        if (env.op !== ADD_OP)
            continue;
        const st = await staticOf(env, log.genesisDigest, subtle);
        if (st.problem !== null)
            f.staticBad.add(id);
        else
            f.acceptDigestOf.set(id, st.acceptDigest);
    }
    // ancestor-first (depth, then id): every ancestor is judged before its
    // descendant, so judge never descends recursively through a long chain
    const depth = new Map();
    for (const id of ids) {
        const stack = [id];
        while (stack.length) {
            const top = stack[stack.length - 1];
            if (depth.has(top)) {
                stack.pop();
                continue;
            }
            const open = log.accepted[top].prev.filter((p) => !depth.has(p));
            if (open.length) {
                stack.push(...open);
                continue;
            }
            depth.set(top, log.accepted[top].prev.reduce((d, p) => Math.max(d, depth.get(p) + 1), 0));
            stack.pop();
        }
    }
    for (const id of [...ids].sort((a, b) => depth.get(a) - depth.get(b) || (a < b ? -1 : 1)))
        judge(f, id);
    return f;
}
/** The materialization of the accepted set: a pure function of it (3335). */
export async function materialize(log, subtle = platformSubtle()) {
    const f = await foldOf(log, subtle);
    const ids = Object.keys(log.accepted).sort();
    const members = [...membersIn(f, ids)].sort();
    const memberOp = {};
    const keyAgreement = {};
    for (const id of ids) {
        if (f.verdict.get(id) !== 'canonical')
            continue;
        const env = log.accepted[id];
        const who = env.op === GENESIS_OP ? env.author : env.op === ADD_OP ? f.subjectOf.get(id) : null;
        if (who === null || !members.includes(who) || memberOp[who] !== undefined)
            continue;
        memberOp[who] = id;
        keyAgreement[who] = env.op === GENESIS_OP ? env.body.card.keyAgreement : env.body.admission.accept.payload.accept.card.keyAgreement;
    }
    const named = new Set(ids.flatMap((id) => log.accepted[id].prev));
    const verdict = {};
    for (const id of ids)
        verdict[id] = f.verdict.get(id);
    return { members, memberOp, keyAgreement, verdict, heads: ids.filter((id) => !named.has(id)), epoch: 0, policyVersion: 1, dissolved: f.dissolves.size > 0 };
}
/** the stage-1 constants (rltp design S1-19): 64 entries and 16 × the entry bound per source; 256 and 4 × that per group */
export const ENTRY_BOUND = 65_536 - 4_096;
export const STAGE1_BOUNDS = { perSource: 64, perSourceBytes: 16 * ENTRY_BOUND, perGroup: 256, perGroupBytes: 4 * 16 * ENTRY_BOUND };
/** the static checks of a member.add (rules 1–3, 5420–5450, and the bindings to this group) */
async function addStaticProblem(env, genesisDigest, subtle) {
    const b = env.body;
    const inv = b.admission.invite;
    const acc = b.admission.accept;
    if (!membershipSchemaOk('payload-membership-invite.schema.json', inv?.payload))
        return 'rule-1-invite-schema';
    if (!membershipSchemaOk('payload-membership-accept.schema.json', acc?.payload))
        return 'rule-1-accept-schema';
    const credDigest = await digestDoc(inv.payload.invite, subtle);
    const ip = await inviteProblem(inv, subtle);
    if (ip)
        return 'rule-1-' + ip;
    const ap = await acceptProblem(acc, inv, credDigest, subtle);
    if (ap)
        return 'rule-2-' + ap;
    const cs = inv.payload.invite.credentialSubject;
    if (cs.id !== b.subject || acc.payload.accept.subject !== b.subject)
        return 'rule-2-subject';
    if (cs.group !== env.group || acc.payload.accept.group !== env.group)
        return 'rule-2-group';
    if (!sameDigest(cs.genesisDigest, genesisDigest))
        return 'rule-2-genesis';
    if (typeof b.admission.welcome !== 'string')
        return 'rule-2-welcome';
    void MEMBERSHIP_SKEW;
    return null;
}
/** The static result of a member.add: its rule problem, or its accept's
 *  digest. A pure function of the operation (its id covers body and group)
 *  and the genesis digest, so it is kept per (genesis, id), bounded. */
const STATIC_CACHE = new Map();
const STATIC_CACHE_MAX = 4096;
async function staticOf(env, genesisDigest, subtle) {
    const key = genesisDigest + ' ' + env.id;
    const known = STATIC_CACHE.get(key);
    if (known)
        return known;
    let out;
    try {
        const problem = await addStaticProblem(env, genesisDigest, subtle);
        out = problem !== null ? { problem } : { problem: null, acceptDigest: await digestDoc(env.body.admission.accept, subtle) };
    }
    catch {
        out = { problem: 'rule-1-shape' };
    }
    if (STATIC_CACHE.size >= STATIC_CACHE_MAX)
        STATIC_CACHE.delete(STATIC_CACHE.keys().next().value);
    STATIC_CACHE.set(key, out);
    return out;
}
/** The signers at a position (3315): the members there, and the eligible
 *  ones — the members plus the subject of a member.add that passes rules
 *  1–3 (its accept carries the subject's signature; a broken admission
 *  makes nobody eligible). */
async function signersAt(log, env, subtle) {
    const f = await foldOf({ ...log, accepted: { ...log.accepted, [env.id]: env } }, subtle);
    const members = membersIn(f, closureOf(f, env.id));
    const eligible = new Set(members);
    const subject = env.body?.subject;
    if (env.op === ADD_OP && typeof subject === 'string' && !f.staticBad.has(env.id))
        eligible.add(subject);
    return { members, eligible };
}
const eligibleSet = async (log, env, subtle) => (await signersAt(log, env, subtle)).eligible;
/** The proof cut to eligible signers (3130: a signature of anyone else is
 *  no part of the proof and never blocks the operation). */
const trimmed = (env, eligible) => {
    const sigs = env.proof.signatures ?? [];
    const kept = sigs.filter((s) => eligible.has(s.signer));
    return kept.length === sigs.length ? env : { ...env, proof: { ...env.proof, signatures: kept } };
};
/** Whether an operation can be accepted at its position: its author is a
 *  member there (stage 1 authors only as a member: the policy's
 *  `any-member`, 4.1) and has signed it; the returned envelope carries only
 *  the eligible signatures. Anything else is held, never accepted, so it
 *  never travels (S1-5). */
async function eligibleAt(log, env, subtle) {
    const { members, eligible } = await signersAt(log, env, subtle);
    if (!members.has(env.author) || !(env.proof.signatures ?? []).some((s) => s.signer === env.author))
        return null;
    return trimmed(env, eligible);
}
/** Admits one envelope into the log (Replication 7.1): form first (step 1),
 *  the proof merged on a known id (3.4.1), then ancestor-first; a missing
 *  parent or ineligible signers hold the entry in its source partition
 *  under the bounds. Returns the new log and the verdict; healing of held
 *  entries follows an acceptance (ancestor-first, by id). */
export async function admit(log, env, at, subtle = platformSubtle()) {
    const bounds = at.bounds ?? STAGE1_BOUNDS;
    const fp = await formProblem(env, subtle);
    if (fp)
        return { log, verdict: { kind: 'invalid', problem: fp } };
    const e = env;
    if (!REGISTERED_OPS.has(e.op))
        return { log, verdict: { kind: 'invalid', problem: 'unregistered-op' } };
    // the genesis itself is known (no second effect); any other genesis, a
    // root beside it, or another group's DID is not of this log (3280)
    if (e.op === GENESIS_OP)
        return { log, verdict: log.accepted[e.id] ? { kind: 'duplicate' } : { kind: 'invalid', problem: 'second-genesis' } };
    if (e.prev.length === 0 || e.group !== genesisOf(log).group)
        return { log, verdict: { kind: 'invalid', problem: 'other-group' } };
    if (envelopeBytes(e) > ENTRY_BOUND)
        return { log, verdict: { kind: 'invalid', problem: 'oversize' } };
    if (log.accepted[e.id]) {
        // only eligible signers join the held proof (3130); without a new signer nothing is computed
        const known = new Set((log.accepted[e.id].proof.signatures ?? []).map((x) => x.signer));
        if ((e.proof.signatures ?? []).every((x) => known.has(x.signer)))
            return { log, verdict: { kind: 'duplicate' } };
        const { [e.id]: _self, ...before } = log.accepted;
        const merged = mergeProof(log.accepted[e.id], trimmed(e, await eligibleSet({ ...log, accepted: before }, log.accepted[e.id], subtle)));
        return { log: merged === log.accepted[e.id] ? log : { ...log, accepted: { ...log.accepted, [e.id]: merged } }, verdict: { kind: 'duplicate' } };
    }
    if (log.held[e.id]) {
        const h = log.held[e.id];
        const merged = mergeProof(h.env, e);
        if (merged === h.env)
            return { log, verdict: { kind: 'duplicate' } };
        // the merged entry is counted again; over the entry bound it keeps its proof
        const bytes = envelopeBytes(merged);
        if (bytes > ENTRY_BOUND)
            return { log, verdict: { kind: 'duplicate' } };
        const next = { ...log, held: { ...log.held, [e.id]: { ...h, env: merged, bytes } } };
        return h.reason === 'joining' || h.reason === 'unsupported' ? { log: next, verdict: { kind: 'duplicate' } } : tryAccept(next, e.id, subtle);
    }
    const missing = e.prev.some((p) => !log.accepted[p]);
    const hold = (reason) => {
        const bytes = envelopeBytes(e);
        let held = log.held;
        // the own partition: evict largest-first, ties by id (Replication 7.1)
        const over = () => {
            const m = Object.values(held).filter((h) => h.source === at.source);
            return m.length >= bounds.perSource || m.reduce((n, h) => n + h.bytes, 0) + bytes > bounds.perSourceBytes;
        };
        const evictable = () => Object.entries(held).filter(([id, h]) => h.source === at.source && !at.protected?.has(id));
        while (over() && evictable().length) {
            const victim = evictable().sort(([ia, a], [ib, b]) => b.bytes - a.bytes || (ia < ib ? -1 : 1))[0];
            const { [victim[0]]: _gone, ...rest } = held;
            held = rest;
        }
        // a partition full of protected entries, or an entry no eviction makes room for (retriable)
        if (over())
            return { log, verdict: { kind: 'rate-limited' } };
        // the group sum, after the own partition made room; another partition is never evicted for this one
        const all = Object.values(held);
        if (all.length >= bounds.perGroup || all.reduce((n, h) => n + h.bytes, 0) + bytes > bounds.perGroupBytes)
            return { log, verdict: { kind: 'rate-limited' } };
        return { log: { ...log, held: { ...held, [e.id]: { env: e, reason, source: at.source, since: at.now, bytes } } }, verdict: { kind: 'held', reason } };
    };
    if (at.buffer)
        return hold('joining');
    if (!BUILT_OPS.has(e.op))
        return hold('unsupported');
    if (missing)
        return hold('missing-parent');
    const ok = await eligibleAt(log, e, subtle);
    if (!ok)
        return hold('ineligible');
    return accept(log, ok, subtle);
}
/** the genesis of a log: its one accepted operation without a parent */
export const genesisOf = (log) => Object.values(log.accepted).find((e) => e.op === GENESIS_OP);
/** Ends the joining buffer once the replica is a member: every buffered
 *  entry is judged as an arrival would be, ancestor-first. */
export async function releaseJoining(log, subtle = platformSubtle()) {
    const buffered = Object.keys(log.held).filter((id) => log.held[id].reason === 'joining');
    if (buffered.length === 0)
        return { log, applied: [] };
    const held = { ...log.held };
    for (const id of buffered)
        held[id] = { ...held[id], reason: BUILT_OPS.has(held[id].env.op) ? 'missing-parent' : 'unsupported' };
    let next = { ...log, held };
    const applied = [];
    for (const id of buffered.sort()) {
        if (!next.held[id])
            continue;
        const r = await tryAccept(next, id, subtle);
        next = r.log;
        if (r.verdict.kind === 'applied')
            applied.push(id, ...r.verdict.healed);
        else if (r.verdict.kind === 'held' && next.held[id])
            next = { ...next, held: { ...next.held, [id]: { ...next.held[id], reason: r.verdict.reason } } };
    }
    return { log: next, applied };
}
/** Drops the held entries past their lifetime: what no parent and no proof
 *  healed in HELD_LIFETIME leaves; the next request at a resume brings it
 *  again if it still matters. */
export function expireHeld(log, now) {
    const stale = Object.entries(log.held).filter(([, h]) => h.since + HELD_LIFETIME < now);
    if (!stale.length)
        return log;
    const held = { ...log.held };
    for (const [id] of stale)
        delete held[id];
    return { ...log, held };
}
/** Drops every held entry (the joining buffer of a join that became void). */
export const dropHeld = (log) => (Object.keys(log.held).length ? { ...log, held: {} } : log);
async function tryAccept(log, id, subtle) {
    const h = log.held[id];
    if (!BUILT_OPS.has(h.env.op))
        return { log, verdict: { kind: 'held', reason: 'unsupported' } };
    if (h.env.prev.some((p) => !log.accepted[p]))
        return { log, verdict: { kind: 'held', reason: 'missing-parent' } };
    const ok = await eligibleAt(log, h.env, subtle);
    if (!ok)
        return { log, verdict: { kind: 'held', reason: 'ineligible' } };
    const { [id]: _gone, ...rest } = log.held;
    return accept({ ...log, held: rest }, ok, subtle);
}
/** accepts an entry whose parents are accepted and whose signers are eligible, then heals what it unblocks */
async function accept(log, e, subtle) {
    let next = { ...log, accepted: { ...log.accepted, [e.id]: e } };
    const healed = [];
    let progressed = true;
    while (progressed) {
        progressed = false;
        for (const id of Object.keys(next.held).sort()) {
            const h = next.held[id];
            if (h.reason === 'joining' || h.reason === 'unsupported' || h.env.prev.some((p) => !next.accepted[p]))
                continue;
            const ok = await eligibleAt(next, h.env, subtle);
            if (!ok)
                continue;
            const { [id]: _gone, ...rest } = next.held;
            next = { ...next, held: rest, accepted: { ...next.accepted, [id]: ok } };
            healed.push(id);
            progressed = true;
        }
    }
    return { log: next, verdict: { kind: 'applied', healed } };
}
/** The log a newcomer starts from: the genesis validated on its own (3085)
 *  against the digest its invite pinned (3070). */
export async function openLog(genesis, pinnedDigest, subtle = platformSubtle()) {
    const gp = await genesisProblem(genesis, subtle);
    if (gp)
        return { problem: 'genesis-' + gp };
    const g = genesis;
    const d = await genesisDigestOf(g, subtle);
    if (!sameDigest(d, pinnedDigest))
        return { problem: 'genesis-digest' };
    return { log: emptyLog(d, g) };
}
// ── authoring ──────────────────────────────────────────────────────────
/** the bound of `prev` (3170); more heads than this need dag.join, which stage 1 does not build */
export const PREV_MAX = 32;
/** An unsigned operation at the replica's position: `prev` its heads
 *  (3170), epoch and policy version those of its ancestors (3175). The
 *  caller is a member there (the gate of stage 1) and signs it. */
export const opUnsigned = (log, m, op, author, body) => ({
    v: ENVELOPE_V, op, group: genesisOf(log).group, epoch: m.epoch, policyVersion: m.policyVersion, prev: m.heads.slice(0, PREV_MAX), body, author,
});
/** an operation over the entry bound is not authored (5330) */
export const oversize = (env) => envelopeBytes(env) > ENTRY_BOUND;
