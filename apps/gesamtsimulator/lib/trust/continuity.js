// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// trust/continuity — continuity on the holder (lib Stage 2, PR 4c; Trust
// §6a, 6.4): the probe (6a.2), the continuity mapping (6a.4) and the
// chaining it triggers, with the standing duties of 6a.3. Graduated from
// probe/continuity.ts (buildProbe, receiveContinuity, handleProbe,
// handleMapping, flushContinuity, chainTuple) and probe/trust.ts
// (chainAdmission) onto HolderState and the engine; probe/continuity.ts
// stays as it is for the simulators until PR 7. The pure wire forms are
// the root module's (continuity.ts).
//
// Rule numbers: bare four-digit numbers are RLTP-TRU (trust-layer.md).
//
// Spec follow-up 14 (Trust 0.32): 6900 has the record side chain
// "atomically with issuing its choice", and 6910 lets it choose on the
// first match. A probe hit is no evidence of the prior relationship: it
// proves knowledge of the prior's counterpart anchor (a photographed card,
// a mediator who saw it in the clear) and of the fresh tuple's k_p, never
// possession of the prior relationship key, which only mac1 proves (6970).
// Chaining on a hit lets anyone who knows a pair anchor take over that
// relationship. This library therefore chains only on a verified mapping
// of the counterpart, mac1 under the prior key: the record side issues its
// choice on a hit and holds it as a candidate (the standing mapping duty,
// 6840); it chains when the counterpart's report or alignment naming the
// chosen prior verifies (6970). The non-record side already chains only on
// the record side's verified mapping (6900). 6900/6910 need the evidence
// wording against 6970.
//
// Spec follow-up 17 (Trust 0.32, where 2300 freezes the prior-candidate
// set): candidate substitution. Two fresh tuples toward one counterpart
// opened before either chained (a double scan under a transport outage)
// both name the prior P; the later one, F2, also names F1. Where F2's
// traffic arrives first, F2 chains onto P, and F1's only candidate is
// consumed: the record side makes no choice, the non-record side resends
// its report forever, two entries stay. So: when a chaining deactivates P
// as the prior of a chain whose new head is X, every other fresh tuple
// not yet chained whose prior-candidate set names P gets X in P's place
// (same position; substitutePrior, run by chainTuple on its result), and
// what its flow held about P is re-targeted to X as a fresh issuance under
// the next revision, through the mapping duty: the record side's choice
// (`chosen`, an owed `due`) is owed again naming X, X now the chain's head
// and chainable; the non-record side's report or alignment likewise; the
// frozen record prior (6290) follows to X's counterpart anchor. mac1 then
// runs under X's relationship key (6970), which both holders hold, X being
// a verified chained tuple; both sides apply the rule when they themselves
// chain X, so the substituted candidate verifies on both. Transitive: a
// chaining onto X later substitutes again. Only a tuple verified chained
// onto P takes its place (chainTuple runs only on a verified mapping,
// follow-up 14); a third party's fresh tuple never enters another flow's
// candidates, and a probe hit proves nothing as before. A probe built
// before the counterpart substituted still blinds P's anchor: X keeps, in
// this tuple's set, the anchors it replaced in this flow (`replaces`,
// transitively: Y in X's place stands for X and P), and answers a probe
// for its own counterpart anchor and for those (standsFor). This is a
// deviation from 6800, which matches the frozen set only (A19), limited to
// anchors substituted in the tuple's own flow: a tuple opened after a
// chaining completed has no history and matches its frozen candidates
// only, so an attacker who knows an old pair anchor learns no current one
// (stack review round 6: Codex I). A mapping
// naming P that arrives after the substitution is refused (6960); its
// sender re-targets on its own chaining. P's key is not kept for the
// substituted flow: nothing verifies or issues under it there any more.
// What it registers (through trustModule, trust/mapping.ts):
//   tasks   continuity-probe/0.1 (proof absent): the assembly per tuple
//           (6790, the 5.2a rules with `probe` as the salt), the highest
//           completed probe (6690, 6700), the matches against the own
//           prior-candidate set (6800) and what they trigger: the record
//           side's choice, issued but not chained (spec follow-up 14), or
//           the non-record side's match report
//           continuity-mapping/0.1 (proof absent): steps 1–6 of 6940 (to,
//           next, prior in the frozen prior-candidate set, both MACs, the
//           revision rule with the record freeze, 6270, 6290); a record
//           side's mapping chains (6900) and raises the alignment (6850,
//           6930); the non-record side's report or alignment informs the
//           record side's choice (6910) and, verified under the prior key,
//           chains it where it names the chosen relationship (follow-up 14)
//   duty    continuity/1: step `probe` sends the pending probe (6830),
//           step `mapping` produces an owed choice, report or alignment, or
//           resends the last issuance under its revision (6840)
//   acks    a completed probe ends the probe duty; the alignment's
//           delivery ends the alignment duty (6850)
//   failures  a failed probe chunk re-opens the probe duty (a fresh probe,
//           6710, 6830); a failed mapping not yet answered re-opens the
//           mapping duty (6840)
//
// What it exports for tests and the encounter (PR 7): openTuple, the
// fresh tuple with its prior-candidate set frozen (2300) and its pending
// probe (6820, 6830), behind the testing module's non-human command
// continuity.newTuple.
//
// Choices this file makes where note and spec leave them open:
//   - the prior-candidate set is the active-head tuples of every live
//     relationship at tuple creation, in the order their heads were
//     created (entryOrder.heads), the fresh tuple excluded (2300, 6740)
//   - a probe is pending from the tuple's creation (6820) and goes out on
//     the next resume (the next available delivery contact). The probe
//     duty stands until a probe completes: after each send it is due again
//     after the holder's retry backoff (DutyCtx.backoff, growing with its
//     attempt) and then sends a fresh probe, next sequence, fresh padding
//     (6710, 6830). The outbox never reproduces a probe (ownRetries); a
//     failed chunk of the current probe (report, give-up) makes the duty
//     due as soon as its backoff allows, max(when, lastAt +
//     backoff(attempt)), never earlier; a superseded probe's failure
//     touches nothing
//   - the substitution (follow-up 17) applies to every fresh tuple not yet
//     chained, its flow open or not: a flow that has matched nothing yet
//     can still be reached by a late probe or mapping naming the head.
//     `chosen` is final once set except here, where the chosen prior was
//     consumed by another chaining and the choice is owed again on its head
//   - the record side chooses the first match, in prior-candidate order,
//     whose tuple is still the active head of a live relationship, and
//     chains on nothing yet; the non-record side reports the first such
//     match. A match report that reaches a record side without a choice is
//     chosen from where its prior is still chainable (6910), and chained
//     with that issuance: the report is the evidence
//   - a choice, a report or an alignment whose preparation fails (a key
//     not available) leaves `continuityOut.due` and a mapping duty; the
//     receive still commits (its ack, the assembly, the revision)
//   - every issuance opens the standing mapping duty; while the issuance
//     stands it resends after the backoff (6840): the stored artifact (body
//     and proof) re-sealed in a new document, same revision, a repeat at
//     the receiver (6270), but only when no document of it is still with
//     the outbox (whose retries are byte-identical, Delivery 4.2); a
//     failure of this issuance makes it due as soon as its backoff allows. The record side's choice stands until
//     the counterpart's mapping on the chosen relationship arrives
//     under a higher revision than it held (`aligned`; a repeat answers
//     nothing, 6270, and the report a choice was made from is no answer),
//     the match report until the record side's mapping is verified (6850,
//     6860: it is never produced after), the alignment until its delivery
//     completes (6850), counted by this issuance's documents only (`sent`
//     is per issuance, `align` marks the alignment). The non-record side
//     always aligns with a new issuance under the next revision, even where
//     its report already named the chosen relationship (6930). Residue: a
//     report the record side never saw, arriving first after the choice
//     and naming it, is wire-identical to an alignment without a report
//     before it and counts as the answer
//     The outbox's retries of an issued report run to their horizon like
//     superseded star salts; the record side rejects a lower revision
//   - tick keeps the address key of a deactivated prior tuple while a live
//     fresh tuple whose flow is open names it among its prior candidates
//     (continuityKeys, the engine's keepKeys): mac1 needs it (6970)
//   - a prior that a competing chaining took (deactivated, its chain's
//     head another tuple) is refused at the record side's mapping as
//     validation-failed with ref 6900 where the flow still names it (an
//     unchained one had it substituted, follow-up 17, and refuses with
//     6960); a chaining replayed is one append (6230): a record-side
//     mapping on an already chained tuple chains nothing again
//   - chaining keeps the chain's relationship id (the chain continues);
//     the fresh relationship stays as a husk without tuples, chainedInto
//     the chain, its contactId a chain alias (2090). The chain takes the
//     fresh relationship's place in entryOrder.heads (2180). Chain state
//     carries (2280): links and bindings as the union (6610), a binding
//     conflict kept as two bindings for one anchor, which the binding rule
//     sees: the two entries behind the chain never merge, no merge duty
//     opens, and no mapping touching that anchor verifies on the chain
//     (6118); the chaining itself happens (6900), the earliest anchor as the earlier of the two
//     by generation of the own register lineage (2285), contact memory
//     (the chain's wins key by key, the group-star pairs merged per group
//     with the appended head's winning: chainMemory), the relationship's anchor head (the appended
//     tuple's verified self, else the chain's), firstVerified the earlier;
//     provenance the chain's, except that an enactment chained onto an
//     introduced chain sets it to ceremony, at the chain's time and without
//     the introducer, never downward (8790, 8800: chainProvenance). Tuple
//     state does not migrate (6250): the prior tuple is deactivated with
//     its open assemblies discarded
//     (5360), the fresh tuple keeps its own scopes, so its star baseline
//     is fresh unless it completed a delivery before (5810, 5820)
//   - the entries at chaining: where both relationships hold an entry,
//     the appended tuple keeps its entry and the chain stands behind both
//     (2145) until a merge duty merges them; every entry behind the chain
//     settles its anchor head on what the chain holds (6560), so the
//     appended tuple's entry, which may hold none yet, takes the chain's; where only one holds one,
//     that one takes the other contact as an alias, the settings merged
//     by 2160; where neither does, the chain's contact takes the fresh one
//     as an alias (the chain continues; 2180 decides merges, and this is
//     an append)
//   - after a chaining whose entry has the anchor mapping class on, a
//     class-on duty owes the mapping on the new head (6980) where nothing
//     was issued on it, or where the chain and the tuple were issued under
//     different community anchors (6985); its lineage starts at the
//     chain's earliest anchor (2285). The duty respects lagging (6595):
//     a lagging relationship gets it when it ceases to lag (2850)
//   - at a chaining, the class duties owed on the chain and on the
//     appended relationship (class-on, re-issue, profile) move to the
//     chain under the entry that takes its verifications (2146); several
//     re-issues become one, the most urgent awaited head kept; a class off
//     toward that entry drops its duties (trust/duties.ts moveDuties, the
//     follow rule)
//   - 6465 (the profile on the new head after a chaining): the chaining
//     opens the profile's class-on duty on the chain (trust/duties.ts
//     afterChain), which trust/profile.ts delivers
//   - the class duties of both relationships move to the chain and the
//     follow rule runs over the chaining (trust/duties.ts)
//
// Open point for Trust 0.32 (found by the invariants generator, seed 5 and
// 50; reproduced in test/trust-continuity.test.mjs "one-sided chaining"):
// concurrent re-encounters of one pair race for one prior and leave the
// two holders with different chains. Exact sequence, two fresh pairs x
// and y of A and C, created before either chained, C the record side of
// x, A of y (isRecordSide per fresh pair):
//   1. the probes cross; C, record side of x, matches A's probe on x and
//      chooses its prior (the original tuple, the first match still an
//      active head, 6910), issuing its choice without chaining (follow-up
//      14); A, record side of y, does the same for y. The two choices
//      cross: A chains x on verifying C's (6900, 6220), C chains y on A's
//   2. the reports and alignments follow: A's alignment on y reaches C,
//      the record side of y, naming the prior it chose; its prior is in
//      C's frozen prior-candidate set of y (6960 passes on the snapshot),
//      but C's original tuple is no longer an active head: x took it.
//      Nothing in 6.4 or 6a.4 says onto what C appends; this library
//      refuses it (validation-failed, ref 6900), symmetrically at A for x.
//      Since follow-up 17 the refusal comes earlier, ref 6960: C's chaining
//      of y put y in the original's place in x's candidates (and A's of x
//      in y's), and each record side's re-choice on its own head meets a
//      counterpart already chained onto the original. The race stays
//   3. end state: A's chain is original→x, C's is original→y; C keeps x,
//      A keeps y, as relationships of their own. x's standing mapping duty
//      never ends (6840): 6990's "chained to the record-chosen relationship,
//      or honestly unchained pending transport" is false, nothing is
//      pending. The net still puts C's r-A-x into its entry A (2145)
//   4. C rotates before anything went out on x; its anchor mapping on x
//      carries the lineage from x's own earliest anchor (2285, 6420: per
//      relationship), the new generation, so none. A holds C's earlier
//      generation on its chain, whose head is x: 6170 (an unlinked change
//      of self) refuses it on every re-issue. 6985 does not apply at C: C
//      never chained. (Had C issued on x before rotating, x's earliest
//      anchor would be the earlier generation and the segment would reach
//      A; the divergent chains and the endless duty of step 3 remain.)
// Each local decision follows a rule as written (6900, 6910, 6960); the
// refusal of step 2 is this library's conservative reading, which 6900
// does not state; the end state violates the progress rules 6870 and
// 6990. What 0.32 needs to decide, either:
//   (a) order competing chainings: one deterministic winner among fresh
//       pairs that choose the same prior (say the lower record anchor),
//       the loser chained after the winner on both sides, so 6960's
//       snapshot verification has a defined append target; then 6990
//       holds, and 6985 covers the loser's head; or
//   (b) widen the lineage: 6420/2285 take the earliest generation issued
//       on any relationship of the entry (2145), not of the relationship
//       — C's r-A-x and r-A are one entry, so the segment from generation
//       1 would reach A — and 6260/6990 name the unchained end state.
// C's earliestAnchor on r-A-x is right by 2285 as written (nothing
// earlier was issued on that relationship); it is the per-relationship
// scope, not the value, that leaves A without the link.
import { blockedRel, withBlocked } from '../message/holder.js';
import { iso, jcs, fromB64u } from '../core.js';
import { digestBytes, digestDoc } from '../crypto.js';
import { withLabel, withPairNonce } from '../identity-state.js';
import { seal } from '../delivery.js';
import { assembleContinuityMapping, blindPrior, buildProbeChunks, continuityMacsOk, continuityMappingOk, isRecordSide, probeChunkMacOk, probeChunkOk, probeKeyOf, PROBE_CHUNK, } from '../continuity.js';
import { strictlyAscending } from '../star.js';
import { tupleByRkid } from '../receive.js';
import { triasOf } from '../state.js';
import { emptyTuple } from '../state-builder.js';
import { ADMISSION_BOUND, activeTuple, classOnToward, entryOf, findContact, liveRel, tupleByLabel, unionBindings } from './state.js';
import { assembledBodies, assemblyStep, canComplete, chunkDocument, discardAssemblies, pairShared } from './star.js';
import { mergeDutiesAfter, mergeInto, settleHead } from './entries.js';
import { afterChain, classOnDuty, followClasses, moveDuties } from './duties.js';
import { isKnownDuty } from '../codec.js';
import { TASK_NAMESPACE } from '../task-uri.js';
/** The registered task types of 6a (Delivery §4.4, 6810). */
export const CONTINUITY_PROBE_TYPE = TASK_NAMESPACE + 'continuity-probe/0.1';
export const CONTINUITY_MAPPING_TYPE = TASK_NAMESPACE + 'continuity-mapping/0.1';
/** The testing module's command (./testing). */
export const NEW_TUPLE = 'continuity.newTuple';
const inc = (d) => (BigInt(d) + 1n).toString();
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const refuse = (reason, ref) => ({ ok: false, reason, ...(ref ? { ref } : {}) });
const probeDutyId = (label) => `continuity:probe:${label}`;
const mappingDutyId = (label) => `continuity:mapping:${label}`;
// ── reads ──────────────────────────────────────────────────────────────
/** The tuple `label` if it is the active head of a live relationship. */
function liveHead(state, label) {
    const at = tupleByLabel(state, label);
    if (!at || !liveRel(at.rel) || at.rel.activeHead !== label)
        return null;
    return at;
}
/** The arrival tuple, if it is the active head of a live relationship (6190, 6240). */
function arrivalTuple(state, rkid) {
    const at = tupleByRkid(state, rkid);
    if (!at || !liveRel(at.rel) || at.rel.activeHead !== at.tuple.ownPairLabel)
        return null;
    return at;
}
/** A prior the fresh tuple `label` can still be chained onto: a tuple of
 *  another relationship, its live active head. */
const chainable = (state, label, prior) => {
    const p = liveHead(state, prior);
    const t = tupleByLabel(state, label);
    return p !== null && t !== null && p.rel.id !== t.rel.id;
};
/** The tuple `label` with `fn` applied, wherever it lives. */
function withTuple(state, label, fn) {
    const at = tupleByLabel(state, label);
    if (!at)
        throw new Error(`continuity: no tuple ${label}`);
    const tuples = at.rel.tuples.map((t) => (t.ownPairLabel === label ? fn(t) : t));
    return { ...state, relationships: { ...state.relationships, [at.rel.id]: { ...at.rel, tuples } } };
}
/** A probe is owed until one completed (6830). */
const probeOwed = (_state, t) => !t.probeOut.done;
/** The fresh tuple's continuity flow is still open: no answered
 *  issuance, and something chosen, reported, owed or not yet probed. */
const flowOpen = (t) => !t.continuityOut.aligned && (t.continuityOut.chosen !== null || t.continuityIn.recordPrior !== null || t.continuityOut.reported !== null ||
    t.continuityOut.due !== null || !t.probeOut.done || t.probeIn.hwm === '0');
/** The own rkids of deactivated prior tuples that a live fresh tuple with
 *  an open flow still names (2300, 6200): their keys verify mac1 (6970)
 *  and issue it, so tick keeps them (engine keepKeys). */
export function continuityKeys(state) {
    const out = new Set();
    let byLabel = null; // every tuple by its own label, once per call
    for (const rel of Object.values(state.relationships)) {
        if (!liveRel(rel))
            continue;
        const t = activeTuple(rel);
        if (!t.priorCandidates.length || !flowOpen(t))
            continue;
        if (!byLabel) {
            byLabel = new Map();
            for (const r of Object.values(state.relationships))
                for (const x of r.tuples)
                    byLabel.set(x.ownPairLabel, x);
        }
        for (const pc of t.priorCandidates) {
            const p = byLabel.get(pc.ownPairLabel);
            if (p && p.deactivated)
                out.add(p.rkid);
        }
    }
    return [...out];
}
/** The own pair label of the prior-candidate entry whose counterpart anchor is `anchor` (6960). */
const priorOf = (t, anchor) => t.priorCandidates.find((pc) => pc.counterpartAnchor === anchor && pc.counterpartAnchor !== t.counterpartAnchor && pc.ownPairLabel !== t.ownPairLabel);
/** The counterpart anchors a prior candidate answers a probe for (6800):
 *  its own and those it replaced in this tuple's own flow (follow-up 17,
 *  `replaces`): a probe built before the counterpart's substitution still
 *  blinds the replaced prior's anchor. Never the chain's other deactivated
 *  tuples: a tuple opened after a chaining matches its frozen candidates
 *  only, so an old pair anchor discloses no current one (Codex I). */
const standsFor = (pc) => [pc.counterpartAnchor, ...(pc.replaces ?? [])];
/** Whether the last issuance still stands (6840, 6850, 6860), and the
 *  record side's view of it. */
function issuanceStands(t, record) {
    const o = t.continuityOut;
    if (o.body === null)
        return false;
    if (record)
        return !o.aligned;
    if (t.continuityIn.recordPrior === null)
        return true; // the match report, until the choice is verified
    const chosen = priorOf(t, t.continuityIn.recordPrior)?.ownPairLabel;
    return o.align && o.reported === chosen && !o.aligned; // the alignment, until its delivery completes
}
/** The record side of a tuple, read from its last issuance or its prior state. */
const recordOf = (t) => {
    if (t.continuityOut.chosen !== null)
        return true;
    if (t.continuityOut.reported !== null || t.continuityIn.recordPrior !== null)
        return false;
    return null;
};
/**
 * A fresh tuple toward a counterpart as its own relationship and contact
 * (Encounter §4.4: fresh-always), its prior-candidate set frozen now
 * (2300), its own rkid live, its probe pending (6820, 6830).
 */
export function openTuple(state, i, rkid, when) {
    if (Object.hasOwn(state.relationships, i.relId))
        throw new Error(`${NEW_TUPLE}: relationship ${i.relId} exists`);
    if (Object.hasOwn(state.contacts, i.contactId) || Object.values(state.contacts).some((c) => c.aliases.includes(i.contactId)))
        throw new Error(`${NEW_TUPLE}: contact ${i.contactId} exists`);
    if (tupleByLabel(state, i.ownPairLabel))
        throw new Error(`${NEW_TUPLE}: label ${i.ownPairLabel} is in use`);
    const heads = state.entryOrder.heads;
    const priorCandidates = Object.values(state.relationships)
        .filter((r) => liveRel(r))
        .sort((a, b) => (heads.indexOf(a.id) - heads.indexOf(b.id)) || cmp(a.id, b.id))
        .map((r) => activeTuple(r))
        .map((t) => ({ ownPairLabel: t.ownPairLabel, counterpartAnchor: t.counterpartAnchor }));
    const tuple = emptyTuple({
        ownPairLabel: i.ownPairLabel, counterpartAnchor: i.counterpartAnchor, counterpartKeyAgreement: i.counterpartKeyAgreement, rkid,
        entryId: i.contactId, priorCandidates,
    });
    const rel = {
        id: i.relId, contactId: i.contactId, tuples: [tuple], activeHead: i.ownPairLabel, earliestAnchor: null, links: [], bindings: {},
        heldCounterpartHead: null, memory: {}, chainedInto: null, firstVerified: null,
        provenance: { kind: i.provenance?.kind ?? 'ceremony', ...(i.provenance?.via !== undefined ? { via: i.provenance.via } : {}), ...(i.provenance?.viaPin !== undefined ? { viaPin: i.provenance.viaPin } : {}), at: when },
    };
    const contact = {
        id: i.contactId, pos: null, status: 'none', aliases: [], relIds: [i.relId], anchorHead: null,
        settings: { star: 'default', groupStar: 'default', anchorMapping: 'default', sealedGroupStar: 'default', profile: 'default' }, groupSettings: {},
    };
    const duty = { kind: 'continuity', v: 1, id: probeDutyId(i.ownPairLabel), relId: i.relId, tuple: i.ownPairLabel, step: 'probe' };
    return {
        state: {
            ...state,
            register: i.nonce === undefined ? withLabel(state.register, i.ownPairLabel) : withPairNonce(state.register, i.ownPairLabel, i.nonce),
            addresses: { ...state.addresses, keys: { ...state.addresses.keys, [rkid]: { label: i.ownPairLabel, lastShown: when } } },
            contacts: { ...state.contacts, [i.contactId]: contact },
            relationships: { ...state.relationships, [i.relId]: rel },
            entryOrder: { ...state.entryOrder, heads: [...state.entryOrder.heads, i.relId] },
        },
        events: [{ type: 'contact.added', contactId: i.contactId }],
        duties: [duty],
    };
}
// ── the chaining (6220–6250, 2145, 2280, 2285, 6610) ───────────────────
/** The generation order of own community anchors along the register's
 *  lineage (2285): the index of the element leaving the anchor, or the
 *  lineage's length for its end; with no lineage, every anchor is one. */
function generationOf(state, anchor) {
    const lin = state.register.lineage;
    if (!lin.length)
        return 0;
    const at = lin.findIndex((r) => r.body?.prev === anchor);
    if (at >= 0)
        return at;
    return lin[lin.length - 1].body?.next === anchor ? lin.length : Number.MAX_SAFE_INTEGER;
}
const earlierAnchor = (state, a, b) => a === null ? b : b === null ? a : generationOf(state, b) < generationOf(state, a) ? b : a;
/** The anchors the holder issued its anchor mapping under on these tuples and relationship. */
const issuedUnder = (r) => [r.earliestAnchor, ...r.tuples.map((t) => t.mappingOut.underAnchor)].filter((a) => a !== null);
const mapOf = (x) => (x !== null && typeof x === 'object' && !Array.isArray(x) ? x : {});
/** Contact memory at a chaining (2280): the chain's wins key by key
 *  (introducedName, vouchedBy with its vouchedPin: what the earlier
 *  relationship established),
 *  except the class-V group-star pairs (5580), merged per group with the
 *  appended relationship's winning, since it is the active head whose
 *  stars are the newer (5770). */
function chainMemory(r0, rn) {
    const m = { ...rn, ...r0 };
    if (Object.hasOwn(r0, 'groupMembers') || Object.hasOwn(rn, 'groupMembers'))
        m.groupMembers = { ...mapOf(r0.groupMembers), ...mapOf(rn.groupMembers) };
    return m;
}
/** The chain's provenance (8790, 8800): an introduced chain becomes
 *  `ceremony` when the appended relationship came by an enactment, at the
 *  chain's time and without the introducer (via and viaPin name the
 *  introduction; the voucher mark and the introduced name are memory and
 *  stay); never downward: a ceremony chain stays ceremony, an introduced
 *  one appended by an introduction keeps its own introducer. */
const chainProvenance = (p0, pn) => p0.kind === 'introduced' && pn.kind === 'ceremony' ? { kind: 'ceremony', at: p0.at } : p0;
/**
 * The chain append (6220): the fresh tuple `label` becomes the active head
 * of the chain whose active head `prior` is, atomically with that prior's
 * deactivation; chain state carries, tuple state does not (6250). Returns
 * `already` where this very append is done (6230), `taken` where the prior
 * is no longer chainable.
 */
export function chainTuple(state, label, prior, bound) {
    const fresh = tupleByLabel(state, label);
    const pr = tupleByLabel(state, prior);
    if (!fresh || !pr)
        return 'taken';
    if (fresh.rel.id === pr.rel.id)
        return fresh.rel.activeHead === label && pr.tuple.deactivated ? 'already' : 'taken';
    // a strand absorbs no second one (2220): the fresh tuple's relationship is just this tuple
    if (fresh.rel.tuples.length !== 1 || !liveRel(fresh.rel) || fresh.rel.activeHead !== label)
        return 'taken';
    if (!liveRel(pr.rel) || pr.rel.activeHead !== prior)
        return 'taken';
    const R0 = pr.rel, Rn = fresh.rel;
    const t = fresh.tuple;
    const Eo = entryOf(state, R0), En = entryOf(state, Rn);
    const links = [...R0.links];
    for (const l of Rn.links)
        if (!links.some((x) => x.prev === l.prev && x.next === l.next))
            links.push(l);
    const firstVerified = R0.firstVerified === null ? Rn.firstVerified : Rn.firstVerified === null ? R0.firstVerified
        : BigInt(Rn.firstVerified) < BigInt(R0.firstVerified) ? Rn.firstVerified : R0.firstVerified;
    const chain = {
        ...R0,
        tuples: [...R0.tuples.map((x) => (x.ownPairLabel === prior ? discardAssemblies({ ...x, deactivated: true }) : x)), t],
        activeHead: label,
        earliestAnchor: earlierAnchor(state, R0.earliestAnchor, Rn.earliestAnchor),
        links,
        bindings: unionBindings(R0.bindings, Rn.bindings),
        heldCounterpartHead: Rn.heldCounterpartHead ?? R0.heldCounterpartHead,
        memory: chainMemory(R0.memory, Rn.memory),
        firstVerified,
        provenance: chainProvenance(R0.provenance, Rn.provenance),
    };
    const husk = {
        ...Rn, tuples: [], chainedInto: R0.id, links: [], bindings: {}, earliestAnchor: null, heldCounterpartHead: null, memory: {},
    };
    // the chain takes the fresh relationship's place in the creation order of active heads (2180)
    const heads = state.entryOrder.heads.filter((id) => id !== R0.id).map((id) => (id === Rn.id ? R0.id : id));
    // the fresh relationship's continuity duties move to the chain; the
    // class and re-issue duties of both are relocated below, once the entry
    // that takes the chain's verifications is known
    const duties = {};
    for (const [id, d] of Object.entries(state.duties)) {
        const relId = d.relId;
        if (relId !== Rn.id || d.kind === 'merge') {
            duties[id] = d;
            continue;
        }
        if (d.kind === 'continuity' && isKnownDuty(d))
            duties[id] = { ...d, relId: R0.id };
        else
            duties[id] = d; // class duties move below (moveDuties); unknown kinds stay as they are
    }
    const rotations = {};
    for (const [id, r] of Object.entries(state.rotations)) {
        if (!Object.hasOwn(r.awaitHead, Rn.id)) {
            rotations[id] = r;
            continue;
        }
        // the 6596 decision of a running rotation moves to the chain like the
        // re-issue duties (moveDuties): one re-issue owed, due at once where
        // either was (null wins), else the chain's own wait
        const { [Rn.id]: fresh, ...awaitHead } = r.awaitHead;
        const own = Object.hasOwn(awaitHead, R0.id) ? awaitHead[R0.id] : undefined;
        awaitHead[R0.id] = own === undefined ? fresh : own === null || fresh === null ? null : own;
        rotations[id] = { ...r, awaitHead };
    }
    // the block is chain-level state (Message Tasks 6010, 6030): the chain
    // keeps its own, and takes the fresh relationship's, whose id becomes a husk
    const messages = blockedRel(state, Rn.id) && !blockedRel(state, R0.id)
        ? { ...state.messages, blocked: withBlocked(state.messages.blocked, [R0.id], true) }
        : state.messages;
    let next = {
        ...state, relationships: { ...state.relationships, [R0.id]: chain, [Rn.id]: husk }, duties, rotations,
        entryOrder: { ...state.entryOrder, heads }, messages,
    };
    // the entries (2145, 2140)
    const swap = (c) => ({ ...c, relIds: [...new Set(c.relIds.map((id) => (id === Rn.id ? R0.id : id)))] });
    let entryId;
    const out = [];
    const renames = [];
    if (!Eo || !En || Eo.id === En.id) {
        const e = (Eo ?? En);
        entryId = e.id;
        next = { ...next, contacts: { ...next.contacts, [e.id]: swap(next.contacts[e.id]) } };
    }
    else if (Eo.pos !== null && En.pos !== null) {
        // 2145: the chain stands behind both entries; the appended tuple's takes its verifications
        entryId = En.id;
        next = { ...next, contacts: { ...next.contacts, [En.id]: swap(next.contacts[En.id]) } };
    }
    else {
        // one entry or none: the other contact folds into it as an alias (2160 settings)
        const survivor = Eo.pos === null && En.pos !== null ? En : Eo;
        const gone = survivor === Eo ? En : Eo;
        next = { ...next, contacts: { ...next.contacts, [En.id]: swap(next.contacts[En.id]) } };
        const m = mergeInto(next, next.contacts[survivor.id], survivor.id, [next.contacts[gone.id]], bound);
        next = m.state;
        out.push(...(m.duties ?? []));
        renames.push(...(m.renames ?? []));
        entryId = m.survivor;
    }
    next = withTuple(next, label, (x) => ({ ...x, entryId }));
    // 6560: the entries behind the chain settle their anchor heads on what
    // the chain holds now — the appended tuple's entry included, which (2145)
    // takes its verifications and may hold none of its own yet
    for (const id of new Set([entryId, Eo?.id, En?.id].filter((x) => x !== undefined))) {
        const c = findContact(next, id);
        if (!c)
            continue;
        const settled = settleHead(next, c, chain.heldCounterpartHead);
        if (settled !== c)
            next = { ...next, contacts: { ...next.contacts, [c.id]: settled } };
    }
    next = moveDuties(next, [R0.id, Rn.id], R0.id, entryId);
    // 6980, 6985: the anchor mapping on the new head, from the chain's earliest anchor (2285)
    const entry = next.contacts[entryId];
    if (classOnToward(entry, 'anchorMapping')) {
        const anchors = new Set([...issuedUnder(R0), ...issuedUnder(Rn)]);
        const differ = issuedUnder(R0).length > 0 && issuedUnder(Rn).length > 0 && anchors.size > 1;
        if (t.mappingOut.body === null || differ)
            out.push(...classOnDuty(next, entryId, R0.id, 'anchorMapping', out));
    }
    // 6465: the profile on the new head (trust/duties.ts)
    out.push(...afterChain(next, R0.id, out));
    // 2145: a merge the two entries admit runs after this commit (2230)
    const md = mergeDutiesAfter(state, next, R0.id, { net: false });
    out.push(...md.duties);
    // the follow rule over the whole chaining: the drop of a class off toward
    // the entry now, a class on for the chain that was not before (2850)
    const f = followClasses(state, md.state, out);
    // spec follow-up 17 (2300): the new head takes the prior's place in every other unchained flow
    return { state: substitutePrior(f.state, prior, label), events: [{ type: 'contact.chained', contactId: entryId, from: Rn.id, into: R0.id }], duties: f.duties, renames };
}
/**
 * Candidate substitution (spec follow-up 17, 2300): `prior` was just
 * deactivated as the prior of a chaining whose new head is `head`, a tuple
 * verified chained onto it (mac1 under the prior's key, 6970). Every other
 * fresh tuple not yet chained whose prior-candidate set names `prior` gets
 * `head` in its place (same position, a duplicate dropped), and what its
 * flow held about `prior` is re-targeted to `head`, a fresh issuance under
 * the next revision through the mapping duty: the record side's choice is
 * owed again naming `head` (chainable now), the non-record side's report or
 * alignment likewise, the frozen record prior (6290) follows to `head`'s
 * counterpart anchor. The head's entry records in `replaces` the anchors
 * it stands for in this flow (standsFor). Transitive by construction: a chaining onto `head`
 * later substitutes again. Pure: the state only, the duties written into it.
 */
export function substitutePrior(state, prior, head) {
    const h = tupleByLabel(state, head);
    const p = tupleByLabel(state, prior);
    if (!h || !p)
        return state;
    const sub = (l) => (l === prior ? head : l);
    let next = state;
    for (const rel of Object.values(state.relationships)) {
        if (!liveRel(rel) || rel.tuples.length !== 1)
            continue; // a strand absorbs no second one (2220)
        const t = rel.tuples[0];
        if (t.ownPairLabel === head || !t.priorCandidates.some((pc) => pc.ownPairLabel === prior))
            continue;
        // the head in the prior's place, standing for whatever the prior stood for in this flow and for
        // the prior, oldest first (transitive); a head already in the set keeps the first position
        const pc0 = t.priorCandidates.find((pc) => pc.ownPairLabel === prior);
        const into = { ownPairLabel: head, counterpartAnchor: h.tuple.counterpartAnchor };
        const replaces = new Set();
        for (const pc of t.priorCandidates)
            if (pc.ownPairLabel === prior || pc.ownPairLabel === head)
                for (const a of [...(pc.replaces ?? []), pc.counterpartAnchor])
                    replaces.add(a);
        replaces.delete(into.counterpartAnchor);
        if (replaces.size)
            into.replaces = [...replaces];
        const priorCandidates = [];
        for (const pc of t.priorCandidates) {
            const x = pc.ownPairLabel === prior || pc.ownPairLabel === head ? into : pc;
            if (!priorCandidates.some((y) => y.ownPairLabel === x.ownPairLabel))
                priorCandidates.push(x);
        }
        const o = t.continuityOut;
        const rp = t.continuityIn.recordPrior;
        let due = o.due === null ? null
            : o.due.kind === 'choice' ? { kind: 'choice', prior: sub(o.due.prior), alts: [...new Set(o.due.alts.map(sub))].filter((x) => x !== sub(o.due.prior)) }
                : { kind: o.due.kind, prior: sub(o.due.prior) };
        // the record side re-chooses: its choice on the prior is owed again, on the head
        let chosen = o.chosen;
        if (chosen === prior) {
            chosen = null;
            due = { kind: 'choice', prior: head, alts: [] };
        }
        // the non-record side re-reports, or re-aligns, naming the head
        if (o.reported === prior && due === null)
            due = { kind: rp !== null ? 'align' : 'report', prior: head };
        const recordPrior = rp === pc0.counterpartAnchor ? into.counterpartAnchor : rp;
        next = withTuple(next, t.ownPairLabel, (x) => ({
            ...x, priorCandidates, continuityIn: { ...x.continuityIn, recordPrior }, continuityOut: { ...x.continuityOut, chosen, due },
        }));
        if (due !== null && (chosen !== o.chosen || due.kind !== o.due?.kind || due.prior !== o.due.prior))
            next = owe(next, t.ownPairLabel, rel.id);
    }
    return next;
}
/** Seal a continuity-mapping/0.1 document on tuple `t`. */
async function mappingDocument(ctx, t, contactId, own, m) {
    const S = ctx.crypto.subtle;
    const threadId = ctx.entropy.id('thread.id');
    const doc = { id: ctx.entropy.id('doc.id'), type: CONTINUITY_MAPPING_TYPE, issuer: own, recipient: t.counterpartAnchor, threadId, issuedAt: iso(ctx.when), payload: m };
    const envelope = await seal(doc, t.counterpartKeyAgreement, { ephSeed: ctx.entropy.bytes('seal.eph', 32), nonce: ctx.entropy.bytes('seal.nonce', 12) }, S);
    return { digest: await digestDoc(doc, S), envelope, type: CONTINUITY_MAPPING_TYPE, threadId, recipient: { contactId, rkid: t.rkid, keyAgreement: t.counterpartKeyAgreement } };
}
/** Prepare the next revision of the tuple's continuity mapping naming `prior` (6300). */
async function prepareIssue(ctx, label, prior) {
    const st = ctx.snapshot;
    const at = tupleByLabel(st, label);
    const pr = tupleByLabel(st, prior);
    if (!at || !pr)
        return null;
    const t = at.tuple;
    const rev = inc(t.continuityOut.rev);
    if (BigInt(rev) > ADMISSION_BOUND)
        return null; // the scope suspends (2.1, 6870)
    const shNew = await pairShared(ctx, t);
    const shPrior = await pairShared(ctx, pr.tuple);
    if (!shNew || !shPrior)
        return null;
    const own = (await ctx.keys.anchorOf(t.ownPairLabel)).anchor;
    const body = {
        type: 'continuity-mapping@1', prior: (await ctx.keys.anchorOf(pr.tuple.ownPairLabel)).anchor, next: own, to: t.counterpartAnchor,
        revision: rev, issuedAt: iso(ctx.when),
    };
    const m = await assembleContinuityMapping(body, shPrior, shNew, ctx.crypto.subtle);
    const contactId = entryOf(st, at.rel)?.id ?? at.rel.contactId;
    return { label, prior, baseRev: t.continuityOut.rev, rev, body, proof: m.proof, outbound: await mappingDocument(ctx, t, contactId, own, m) };
}
/** Commit an issuance on the state it lands on: revision and body in one
 *  step (6300), the recipient's current entry; null where the scope moved. */
function commitIssue(state, p, set) {
    const at = tupleByLabel(state, p.label);
    if (!at || at.tuple.continuityOut.rev !== p.baseRev)
        return null;
    const next = withTuple(state, p.label, (t) => ({
        ...t,
        continuityOut: {
            ...t.continuityOut, rev: p.rev, body: p.body, proof: p.proof, sent: [p.outbound.digest], due: null,
            align: t.continuityIn.recordPrior !== null, ...set(t.continuityOut),
        },
    }));
    const after = tupleByLabel(next, p.label);
    const contactId = entryOf(next, after.rel)?.id ?? p.outbound.recipient.contactId;
    return { state: next, outbound: { ...p.outbound, recipient: { ...p.outbound.recipient, contactId } } };
}
/** The standing mapping duty of the tuple (6840, 6850), in the state:
 *  opened (or restarted) at an issuance; its first run schedules the
 *  resend after the backoff. */
const openMapping = (state, label, relId, when) => ({ ...state, duties: { ...state.duties, [mappingDutyId(label)]: { kind: 'continuity', v: 1, id: mappingDutyId(label), relId, tuple: label, step: 'mapping', attempt: 1, lastAt: when } } });
/** The earliest time the standing duty may send again: the backoff after its last send. */
const nextAt = (d, backoff) => Math.min((d.lastAt ?? 0) + Math.max(0, Math.ceil(backoff(Math.max(1, d.attempt ?? 1)))), Number.MAX_SAFE_INTEGER);
/** A failure (6830/6840) makes the standing duty due as soon as its
 *  backoff allows, never earlier: max(when, lastAt + backoff(attempt)). */
const dueOnFailure = (state, d, when, backoff) => {
    const cur = Object.hasOwn(state.duties, d.id) ? state.duties[d.id] : d;
    const dueAt = cur.lastAt === undefined ? when : Math.max(when, nextAt(cur, backoff));
    return cur.dueAt === dueAt ? state : { ...state, duties: { ...state.duties, [d.id]: { ...cur, dueAt } } };
};
const dropDuty = (state, id) => {
    if (!Object.hasOwn(state.duties, id))
        return state;
    const { [id]: _, ...duties } = state.duties;
    return { ...state, duties };
};
/**
 * The record side's choice (6900, 6910): the first prepared prior still
 * chainable is issued; where none was prepared but some match is still
 * chainable, the choice is owed (due). It chains with the issuance only on
 * `evidence`: a verified mapping of the counterpart under the prior
 * relationship's key (mac1, 6970), its match report naming that prior. A
 * probe hit alone proves only that the counterpart knows the prior's
 * anchor and shares the fresh tuple's key, never that it holds the prior
 * relationship (spec follow-up 14, header): on a hit the choice is issued
 * and stands as a candidate until that mapping arrives (mappingTask).
 */
function choose(state, label, matches, issues, bound, when, evidence) {
    for (const p of issues) {
        if (!chainable(state, label, p.prior))
            continue;
        const c = evidence ? chainTuple(state, label, p.prior, bound) : null;
        if (typeof c === 'string')
            continue;
        const i = commitIssue(c ? c.state : state, p, () => ({ chosen: p.prior }));
        if (!i)
            continue;
        const after = tupleByLabel(i.state, label);
        const opened = openMapping(i.state, label, after.rel.id, when);
        return c ? { state: opened, outbound: [i.outbound], events: c.events, duties: c.duties, renames: c.renames } : { state: opened, outbound: [i.outbound] };
    }
    const viable = matches.filter((m) => chainable(state, label, m));
    // every candidate gone: an owed choice dies, honestly unchained (6990)
    if (!viable.length)
        return { state: withTuple(state, label, (t) => (t.continuityOut.due?.kind === 'choice' ? { ...t, continuityOut: { ...t.continuityOut, due: null } } : t)) };
    const at = tupleByLabel(state, label);
    const s = withTuple(state, label, (t) => ({ ...t, continuityOut: { ...t.continuityOut, due: { kind: 'choice', prior: viable[0], alts: viable.slice(1) } } }));
    return { state: owe(s, label, at.rel.id) };
}
/** A production owed: the mapping duty, due at once. */
const owe = (state, label, relId) => {
    const id = mappingDutyId(label);
    const fresh = { kind: 'continuity', v: 1, id, relId, tuple: label, step: 'mapping' };
    const { dueAt: _, ...cur } = (Object.hasOwn(state.duties, id) ? state.duties[id] : fresh);
    return { ...state, duties: { ...state.duties, [id]: cur } };
};
/** The non-record side's match report or alignment (6930): issued, or owed. */
function issueOrOwe(state, label, prior, issue, kind, when) {
    const at = tupleByLabel(state, label);
    const i = issue && issue.prior === prior ? commitIssue(state, issue, () => ({ reported: prior, aligned: false })) : null;
    if (i)
        return { state: openMapping(i.state, label, at.rel.id, when), outbound: [i.outbound] };
    const s = withTuple(state, label, (t) => ({ ...t, continuityOut: { ...t.continuityOut, due: { kind, prior } } }));
    return { state: owe(s, label, at.rel.id) };
}
const merge = (a, b) => ({
    state: b.state,
    outbound: [...(a.outbound ?? []), ...(b.outbound ?? [])],
    events: [...(a.events ?? []), ...(b.events ?? [])],
    duties: [...(a.duties ?? []), ...(b.duties ?? [])],
    renames: [...(a.renames ?? []), ...(b.renames ?? [])],
});
async function prepareProbe(ctx, label) {
    const st = ctx.snapshot;
    const at = liveHead(st, label);
    if (!at || !probeOwed(st, at.tuple))
        return null;
    const t = at.tuple;
    const seq = inc(t.probeOut.seq);
    if (BigInt(seq) > ADMISSION_BOUND)
        return null; // 6680, the scope suspends
    const shared = await pairShared(ctx, t);
    if (!shared)
        return null;
    const S = ctx.crypto.subtle;
    const own = (await ctx.keys.anchorOf(t.ownPairLabel)).anchor;
    // 6730, 6740: the own pair anchors of the prior-candidate set, never the fresh tuple's
    const priors = [];
    for (const pc of t.priorCandidates)
        if (pc.ownPairLabel !== t.ownPairLabel)
            priors.push((await ctx.keys.anchorOf(pc.ownPairLabel)).anchor);
    const k = await probeKeyOf(shared, own, t.counterpartAnchor, S);
    const chunks = await buildProbeChunks(k, seq, priors.filter((a) => a !== own), () => ctx.entropy.bytes('pad', 32), S);
    // one probe = one thread (Delivery §4.4)
    const threadId = ctx.entropy.id('thread.id');
    const contactId = entryOf(st, at.rel)?.id ?? at.rel.contactId;
    const outbound = [];
    for (const c of chunks)
        outbound.push(await chunkDocument(ctx, CONTINUITY_PROBE_TYPE, own, t, contactId, threadId, c));
    return { label, baseSeq: t.probeOut.seq, seq, outbound };
}
async function prepareMappingWork(ctx, label) {
    const st = ctx.snapshot;
    const at = liveHead(st, label);
    if (!at)
        return null;
    const t = at.tuple;
    const o = t.continuityOut;
    if (o.due?.kind === 'choice') {
        const issues = [];
        for (const p of [o.due.prior, ...o.due.alts]) {
            if (!chainable(st, label, p))
                continue;
            const i = await prepareIssue(ctx, label, p);
            if (i)
                issues.push(i);
        }
        return { kind: 'choice', baseRev: o.rev, issues };
    }
    if (o.due)
        return { kind: o.due.kind, baseRev: o.rev, issue: await prepareIssue(ctx, label, o.due.prior) };
    if (o.body === null || o.proof === null)
        return null;
    // 6840: the same artifact under the same revision, in a new document
    const own = (await ctx.keys.anchorOf(t.ownPairLabel)).anchor;
    const m = { body: o.body, proof: o.proof };
    return { kind: 'resend', baseRev: o.rev, outbound: await mappingDocument(ctx, t, entryOf(st, at.rel)?.id ?? at.rel.contactId, own, m) };
}
function continuityDuty(bound) {
    return {
        v: 1,
        prepare: (ctx, duty) => {
            const d = duty;
            return d.step === 'probe' ? prepareProbe(ctx, d.tuple) : prepareMappingWork(ctx, d.tuple);
        },
        apply(state, duty, ctx, when) {
            const d = duty;
            const at = liveHead(state, d.tuple);
            if (!at)
                return { state: state }; // per-tuple duties die with the tuple (6250)
            const t = at.tuple;
            const p = ctx.prepared.value;
            const attempt = d.attempt ?? 0;
            // the standing duty stays, due again after the backoff (6830, 6840)
            // sent now (`sent`), or only rescheduled from the last send
            const again = (n, sent = true) => {
                const { dueAt: _, ...rest } = d;
                const lastAt = sent ? when : (d.lastAt ?? when);
                const next = { ...rest, relId: at.rel.id, attempt: n, lastAt };
                return { ...next, dueAt: Math.max(when, nextAt(next, ctx.backoff)) };
            };
            if (d.step === 'probe') {
                if (!probeOwed(state, t))
                    return { state: state };
                const q = p;
                if (q === null)
                    return { ok: false, code: BigInt(t.probeOut.seq) >= ADMISSION_BOUND ? 'scope-exhausted' : 'no-own-channel' };
                if (t.probeOut.seq !== q.baseSeq)
                    return 'not-due';
                // 6680: the sequence and the outbox in one commit, before the send;
                // every send is a fresh probe (6710), never the outbox's reproduction
                const inflight = {};
                for (const [s, f] of Object.entries(t.probeOut.inflight))
                    if (f.digests.some((x) => Object.hasOwn(state.outbox, x)))
                        inflight[s] = f;
                inflight[q.seq] = { digests: q.outbound.map((o) => o.digest), acked: [] };
                return {
                    state: withTuple(state, d.tuple, (x) => ({ ...x, probeOut: { ...x.probeOut, seq: q.seq, inflight } })),
                    outbound: q.outbound, duties: [again(attempt + 1)],
                };
            }
            const w = p;
            const o = t.continuityOut;
            if (w === null)
                return o.due || issuanceStands(t, recordOf(t) ?? false) ? { ok: false, code: 'no-own-channel' } : { state: state };
            if (o.rev !== w.baseRev)
                return 'not-due';
            if (w.kind === 'choice') {
                if (o.chosen !== null || o.due?.kind !== 'choice')
                    return { state: withTuple(state, d.tuple, (x) => ({ ...x, continuityOut: { ...x.continuityOut, due: null } })) };
                // prepared before a substitution re-targeted it (follow-up 17): prepared again
                const owed = [o.due.prior, ...o.due.alts];
                if (w.issues.length && !w.issues.some((i) => owed.includes(i.prior)))
                    return 'not-due';
                const r = choose(state, d.tuple, [o.due.prior, ...o.due.alts], w.issues, bound, when, false);
                if (r.outbound?.length)
                    return { ...r, duties: [...(r.duties ?? []), again(1)] };
                // still owed (no key for any candidate): the duty stays; else every candidate is gone
                return tupleByLabel(r.state, d.tuple).tuple.continuityOut.due ? { ok: false, code: 'no-own-channel' } : { state: r.state };
            }
            if (w.kind === 'report' || w.kind === 'align') {
                if (o.due?.kind !== w.kind)
                    return { state: state };
                // 6860: a match report after the record side's choice is never sent
                if (w.kind === 'report' && t.continuityIn.recordPrior !== null)
                    return { state: withTuple(state, d.tuple, (x) => ({ ...x, continuityOut: { ...x.continuityOut, due: null } })) };
                if (!w.issue)
                    return { ok: false, code: 'no-own-channel' };
                // prepared before a substitution re-targeted it (follow-up 17): prepared again
                if (w.issue.prior !== o.due.prior)
                    return 'not-due';
                const i = commitIssue(state, w.issue, () => ({ reported: w.issue.prior, aligned: false }));
                return i ? { state: i.state, outbound: [i.outbound], duties: [again(1)] } : 'not-due';
            }
            // the resend (6840): while the issuance stands, after the backoff,
            // unless a document of it is still with the outbox
            const record = recordOf(t);
            if (record === null || !issuanceStands(t, record))
                return { state: state };
            if (when < nextAt(d, ctx.backoff) || o.sent.some((x) => pending(state, x)))
                return { state: state, duties: [again(Math.max(1, attempt), false)] };
            const resend = w.outbound;
            return {
                state: withTuple(state, d.tuple, (x) => ({ ...x, continuityOut: { ...x.continuityOut, sent: [...x.continuityOut.sent, resend.digest] } })),
                outbound: [resend], duties: [again(attempt + 1)],
            };
        },
    };
}
const delivered = (state, digest) => Object.hasOwn(state.outbox, digest) && triasOf(state.outbox[digest]) === 'delivered';
/** Still with the outbox: neither delivered nor failed. */
const pending = (state, digest) => Object.hasOwn(state.outbox, digest) && triasOf(state.outbox[digest]) !== 'delivered' && triasOf(state.outbox[digest]) !== 'failed';
// ── acks and failures ──────────────────────────────────────────────────
/** A probe's chunks all acked: the probe completed and the duty ends (6830). */
const probeAck = (state, ref) => {
    const at = tupleByRkid(state, state.outbox[ref].recipient.rkid);
    if (!at)
        return { state: state };
    const o = at.tuple.probeOut;
    const hit = Object.entries(o.inflight).find(([, f]) => f.digests.includes(ref));
    if (!hit)
        return { state: state };
    const [seq, f] = hit;
    const acked = f.acked.includes(ref) ? f.acked : [...f.acked, ref];
    const done = f.digests.every((x) => acked.includes(x));
    const next = withTuple(state, at.tuple.ownPairLabel, (t) => ({
        ...t, probeOut: done ? { ...t.probeOut, inflight: {}, done: true } : { ...t.probeOut, inflight: { ...t.probeOut.inflight, [seq]: { ...f, acked } } },
    }));
    return { state: done ? dropDuty(next, probeDutyId(at.tuple.ownPairLabel)) : next };
};
/** A failed probe chunk: the fresh probe is due at once (6710, 6830). */
const probeFailed = (state, ref, when, { backoff }) => {
    const at = tupleByRkid(state, state.outbox[ref].recipient.rkid);
    if (!at || !liveHead(state, at.tuple.ownPairLabel) || !probeOwed(state, at.tuple))
        return { state: state };
    // only the current probe's failure counts; a superseded one's touches nothing
    if (!(at.tuple.probeOut.inflight[at.tuple.probeOut.seq]?.digests ?? []).includes(ref))
        return { state: state };
    const label = at.tuple.ownPairLabel;
    return { state: dueOnFailure(state, { kind: 'continuity', v: 1, id: probeDutyId(label), relId: at.rel.id, tuple: label, step: 'probe' }, when, backoff) };
};
/** The alignment delivered: its duty ends (6850). */
const mappingAck = (state, ref) => {
    const at = tupleByRkid(state, state.outbox[ref].recipient.rkid);
    if (!at || !at.tuple.continuityOut.sent.includes(ref))
        return { state: state };
    const t = at.tuple;
    const rp = t.continuityIn.recordPrior;
    // only the alignment's own documents (this issuance's `sent`) complete it
    if (rp === null || !t.continuityOut.align || t.continuityOut.reported !== priorOf(t, rp)?.ownPairLabel)
        return { state: state };
    const next = withTuple(state, t.ownPairLabel, (x) => ({ ...x, continuityOut: { ...x.continuityOut, aligned: true } }));
    return { state: t.continuityOut.due ? next : dropDuty(next, mappingDutyId(t.ownPairLabel)) };
};
/** A failed mapping that still stands: the resend is due at once (6840). */
const mappingFailed = (state, ref, when, { backoff }) => {
    const at = tupleByRkid(state, state.outbox[ref].recipient.rkid);
    if (!at || !liveHead(state, at.tuple.ownPairLabel))
        return { state: state };
    const t = at.tuple;
    const record = recordOf(t);
    if (!t.continuityOut.sent.includes(ref) || record === null || !issuanceStands(t, record))
        return { state: state };
    if (t.continuityOut.sent.some((x) => pending(state, x)))
        return { state: state };
    const label = t.ownPairLabel;
    return { state: dueOnFailure(state, { kind: 'continuity', v: 1, id: mappingDutyId(label), relId: at.rel.id, tuple: label, step: 'mapping', attempt: 1 }, when, backoff) };
};
const maxDec = (a, b) => (BigInt(a) >= BigInt(b) ? a : b);
function probeTask(bound, limit) {
    return {
        proof: 'absent',
        // stage 7: the closed chunk schema, exactly 256 entries (6670)
        decode: (payload) => (probeChunkOk(payload) ? payload : refuse('malformed', 'RLTP-TRU-6670')),
        async prepare(ctx, doc, arrival) {
            if (doc.ceremony?.enactment !== undefined)
                return refuse('validation-failed');
            const st = ctx.snapshot;
            const at = arrivalTuple(st, arrival.rkid);
            if (!at)
                return refuse('validation-failed', 'RLTP-TRU-6240');
            const t = at.tuple;
            const body = doc.payload.body;
            const probe = BigInt(body.probe);
            if (probe <= BigInt(t.probeIn.hwm))
                return refuse('validation-failed', 'RLTP-TRU-6700');
            if (probe <= BigInt(t.probeIn.lowerBound))
                return refuse('validation-failed', 'RLTP-TRU-5366');
            if (t.probeIn.assembly && probe < BigInt(t.probeIn.assembly.salt))
                return refuse('validation-failed', 'RLTP-TRU-5340');
            const shared = await pairShared(ctx, t);
            if (!shared)
                return refuse('validation-failed', 'RLTP-TRU-6670');
            const S = ctx.crypto.subtle;
            const own = (await ctx.keys.anchorOf(t.ownPairLabel)).anchor;
            // k_p of the sender's direction (6720)
            const k = await probeKeyOf(shared, t.counterpartAnchor, own, S);
            if (!(await probeChunkMacOk(k, doc.payload, S)))
                return refuse('validation-failed', 'RLTP-TRU-6670');
            const label = t.ownPairLabel;
            const step = assemblyStep(t.probeIn.assembly, body.probe, body, doc.threadId, arrival.digest, limit);
            if (step.kind === 'limit')
                return { kind: 'discard', label, probe: body.probe, reason: 'resource-limit', ref: 'RLTP-TRU-5365' };
            if (step.kind === 'repeat')
                return { kind: 'repeat' };
            if (step.kind === 'reject')
                return { kind: 'discard', label, probe: body.probe, reason: 'rejected', ref: step.ref };
            if (step.kind === 'hold')
                return { kind: 'hold', label, assembly: step.assembly };
            const union = assembledBodies(step.chunks, step.last).flatMap((b) => b.blinded);
            if (union.length !== Number(step.last) * PROBE_CHUNK || !strictlyAscending(union))
                return { kind: 'discard', label, probe: body.probe, reason: 'rejected', ref: 'RLTP-TRU-6760' };
            // 6800: the counterpart anchors of the own prior-candidate set, never the fresh tuple's
            const inUnion = new Set(union);
            const matches = [];
            for (const pc of t.priorCandidates) {
                if (pc.ownPairLabel === label || pc.counterpartAnchor === t.counterpartAnchor)
                    continue;
                for (const a of standsFor(pc)) {
                    if (inUnion.has(await blindPrior(k, a, S))) {
                        matches.push(pc.ownPairLabel);
                        break;
                    }
                }
            }
            const record = isRecordSide(own, t.counterpartAnchor);
            const issues = [];
            const o = t.continuityOut;
            if (matches.length && record && o.chosen === null) {
                for (const m of matches) {
                    if (!chainable(st, label, m))
                        continue;
                    const i = await prepareIssue(ctx, label, m);
                    if (i)
                        issues.push(i);
                }
            }
            else if (matches.length && !record && o.reported === null && t.continuityIn.recordPrior === null) {
                const m = matches.find((x) => chainable(st, label, x)) ?? matches[0];
                const i = await prepareIssue(ctx, label, m);
                if (i)
                    issues.push(i);
            }
            return { kind: 'complete', label, probe: body.probe, matches, record, issues };
        },
        apply(state, prepared, _doc, arrival) {
            const p = prepared.value;
            if (p.kind === 'repeat')
                return { state: state };
            if (p.kind === 'hold')
                return { state: withTuple(state, p.label, (t) => ({ ...t, probeIn: { ...t.probeIn, assembly: p.assembly } })) };
            if (p.kind === 'discard') {
                // 5365, 5366: the assembly dropped, its probe the lower bound; the completed one stays
                return { discarded: true, reason: p.reason, ref: p.ref, state: withTuple(state, p.label, (t) => ({ ...t, probeIn: { ...t.probeIn, assembly: null, lowerBound: maxDec(t.probeIn.lowerBound, p.probe) } })) };
            }
            // 6690: the highest completed probe, in the completing chunk's commit
            let next = withTuple(state, p.label, (t) => ({ ...t, probeIn: { ...t.probeIn, hwm: p.probe, assembly: null } }));
            if (!p.matches.length)
                return { state: next }; // 6260: honestly a new relationship
            const t = tupleByLabel(next, p.label).tuple;
            if (p.record) {
                if (t.continuityOut.chosen !== null)
                    return { state: next };
                return choose(next, p.label, p.matches, p.issues, bound, arrival.when, false);
            }
            if (t.continuityOut.reported !== null || t.continuityIn.recordPrior !== null)
                return { state: next };
            const m = p.issues[0]?.prior ?? p.matches.find((x) => chainable(next, p.label, x)) ?? p.matches[0];
            return issueOrOwe(next, p.label, m, p.issues[0] ?? null, 'report', arrival.when);
        },
    };
}
function mappingTask(bound) {
    return {
        proof: 'absent',
        // step 1 (6940): the schema and a calendar-valid issuedAt
        decode: (payload) => (continuityMappingOk(payload) ? payload : refuse('malformed', 'RLTP-TRU-6940')),
        async prepare(ctx, doc, arrival) {
            if (doc.ceremony?.enactment !== undefined)
                return refuse('validation-failed');
            const st = ctx.snapshot;
            const at = arrivalTuple(st, arrival.rkid);
            if (!at)
                return refuse('validation-failed', 'RLTP-TRU-6240');
            const t = at.tuple;
            const b = doc.payload.body;
            const own = (await ctx.keys.anchorOf(t.ownPairLabel)).anchor;
            // steps 2 and 3 (6950): the tuple it arrived on
            if (b.to !== own || b.next !== t.counterpartAnchor)
                return refuse('validation-failed', 'RLTP-TRU-6950');
            // step 4 (6960): prior in the frozen prior-candidate set (6200)
            const pc = priorOf(t, b.prior);
            const pr = pc && tupleByLabel(st, pc.ownPairLabel);
            if (!pc || !pr)
                return refuse('validation-failed', 'RLTP-TRU-6960');
            // step 5 (6970): both secrets non-zero, mac1 under the prior relationship's, mac2 under the new
            const shNew = await pairShared(ctx, t);
            const shPrior = await pairShared(ctx, pr.tuple);
            if (!shNew || !shPrior || !(await continuityMacsOk(doc.payload, shPrior, shNew, ctx.crypto.subtle)))
                return refuse('validation-failed', 'RLTP-TRU-6970');
            const senderRecord = isRecordSide(b.next, own);
            const ownPrior = (await ctx.keys.anchorOf(pc.ownPairLabel)).anchor;
            const o = t.continuityOut;
            let issue = null;
            // the alignment (6930): a new issuance under the next revision, even
            // where an earlier report already named this relationship
            if (senderRecord && !(o.align && o.reported === pc.ownPairLabel))
                issue = await prepareIssue(ctx, t.ownPairLabel, pc.ownPairLabel);
            if (!senderRecord && o.chosen === null && chainable(st, t.ownPairLabel, pc.ownPairLabel))
                issue = await prepareIssue(ctx, t.ownPairLabel, pc.ownPairLabel);
            return { label: t.ownPairLabel, prior: pc.ownPairLabel, senderRecord, ownPrior, issue };
        },
        // step 6 (6970): the revision rule with the record freeze, and what follows
        apply(state, prepared, doc, arrival) {
            const at = arrivalTuple(state, arrival.rkid);
            if (!at)
                return refuse('validation-failed', 'RLTP-TRU-6240');
            const p = prepared.value;
            const t = at.tuple;
            const b = doc.payload.body;
            const rev = BigInt(b.revision);
            const cur = BigInt(t.continuityIn.rev);
            if (rev === cur) {
                // a repeat is ignored (6270); another body under it an equivocation
                // a repeat changes nothing, not even an open duty: it answers no choice
                if (t.continuityIn.body === null || jcs(b) !== jcs(t.continuityIn.body))
                    return refuse('validation-failed', 'RLTP-TRU-6270');
                return { state: state };
            }
            if (rev < cur)
                return refuse('validation-failed', 'RLTP-TRU-6270');
            if (p.senderRecord && t.continuityIn.recordPrior !== null && t.continuityIn.recordPrior !== b.prior)
                return refuse('validation-failed', 'RLTP-TRU-6290');
            let next = withTuple(state, p.label, (x) => ({
                ...x, continuityIn: { rev: b.revision, body: b, recordPrior: p.senderRecord ? b.prior : x.continuityIn.recordPrior },
            }));
            if (p.senderRecord) {
                // 6900: the non-record side chains on verifying the record side's mapping
                const c = chainTuple(next, p.label, p.prior, bound);
                if (c === 'taken')
                    return refuse('validation-failed', 'RLTP-TRU-6900');
                let out = { state: next };
                if (c !== 'already')
                    out = { state: c.state, events: c.events, duties: c.duties, renames: c.renames };
                next = out.state;
                // 6850: the report duty ends; the alignment arises in its place (6930)
                const x = tupleByLabel(next, p.label).tuple;
                if (x.continuityOut.due?.kind === 'report')
                    next = withTuple(next, p.label, (y) => ({ ...y, continuityOut: { ...y.continuityOut, due: null } }));
                // a higher revision of the same choice, already aligned to: nothing new
                if (x.continuityOut.align && x.continuityOut.reported === p.prior)
                    return { ...out, state: next };
                return merge(out, issueOrOwe(next, p.label, p.prior, p.issue, 'align', arrival.when));
            }
            // the non-record side's report or alignment, verified with mac1 under the
            // prior relationship's key (6970): the evidence the record side chains on
            const x = tupleByLabel(next, p.label).tuple;
            if (x.continuityOut.chosen === null)
                return choose(next, p.label, [p.prior], p.issue ? [p.issue] : [], bound, arrival.when, true);
            if (x.continuityOut.chosen !== p.prior)
                return { state: next };
            // the choice made on a hit: chained now (6900), once
            const c = chainTuple(next, p.label, p.prior, bound);
            if (c === 'taken')
                return refuse('validation-failed', 'RLTP-TRU-6900');
            const out = c === 'already' ? { state: next } : { state: c.state, events: c.events, duties: c.duties, renames: c.renames };
            // the counterpart's mapping on the chosen relationship, verified under a
            // higher revision than any it held, answers the choice (6840); the
            // report a choice was made from is not its answer
            return { ...out, state: answered(out.state, p.label) };
        },
    };
}
/** The record side's choice answered: its standing duty ends (6840). */
const answered = (state, label) => dropDuty(withTuple(state, label, (y) => ({ ...y, continuityOut: { ...y.continuityOut, aligned: true } })), mappingDutyId(label));
// ── the module's parts ─────────────────────────────────────────────────
/** What trustModule registers for continuity. */
export function continuityParts(bound, limit) {
    return {
        ownRetries: [CONTINUITY_PROBE_TYPE],
        keepKeys: continuityKeys,
        tasks: { [CONTINUITY_PROBE_TYPE]: probeTask(bound, limit), [CONTINUITY_MAPPING_TYPE]: mappingTask(bound) },
        duties: { continuity: continuityDuty(bound) },
        acks: { [CONTINUITY_PROBE_TYPE]: probeAck, [CONTINUITY_MAPPING_TYPE]: mappingAck },
        failures: { [CONTINUITY_PROBE_TYPE]: probeFailed, [CONTINUITY_MAPPING_TYPE]: mappingFailed },
    };
}
/**
 * The testing module (./testing): its non-human command continuity.newTuple
 * opens a fresh tuple the way the encounter will (PR 7), with the rkid
 * the KeyProvider derives for its label.
 */
export const continuityTestModule = Object.freeze({
    name: 'continuity-test',
    commands: Object.freeze({
        [NEW_TUPLE]: {
            human: false,
            async prepare(ctx, input) {
                // Identity §6.1: the label digests the 32 nonce bytes
                if (input.nonce !== undefined) {
                    const n = fromB64u(input.nonce);
                    if (n.length !== 32 || 'pair/' + await digestBytes(n, ctx.crypto.subtle) !== input.ownPairLabel)
                        throw new TypeError(`${NEW_TUPLE}: the label is not pair/<multihash(nonce)> of a 32-byte nonce`);
                }
                return (await ctx.keys.anchorOf(input.ownPairLabel)).keyAgreement;
            },
            apply: (state, prepared, input, when) => openTuple(state, input, prepared.value, when),
        },
    }),
});
