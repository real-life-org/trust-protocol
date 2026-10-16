// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// state-builder — valid HolderStates for tests, vectors and adapter
// authors (lib Stage 2, note §4.6 ./testing). Not for production holders:
// a real holder's state arises from its acts.
//
// A fluent builder over plain data: anchors, key-agreement keys and labels
// are strings the caller derives (seedKeys(seed).anchorOf(label)), so the
// builder stays synchronous and key-free. build() validates the result
// with the codec (encodeState) and hands out an independent copy; every
// call before it may be chained.
//
//   stateBuilder()
//     .community(genesis, '2')                 register.community
//     .lineage([rotation1to2])                 register.lineage
//     .relationship('r1', { contactId: 'c1', tuples: [{ ownPairLabel,
//        counterpartAnchor, counterpartKeyAgreement, rkid }] })
//                                              the contact (created at
//                                              status 'none' if new), the
//                                              tuple's label in the
//                                              register, its rkid live in
//                                              addresses, the active head
//                                              in entryOrder.heads (2180)
//     .entry('c1')                             an entry commit (2120): the
//                                              next position, 'admitted'
//                                              (or { status: 'pending' })
//     .settings('c1', { anchorMapping: 'on' }) class settings (2810)
//     .duty({ kind: 'class-on', … })           an open duty
//     .with((s) => { … })                      anything else, on the draft
//     .build()
import { CODEC, encodeState } from './codec.js';
import { emptyState } from './state.js';
const seqOut = () => ({ lastSalt: '0', exhausted: false, hwm: '0', snapshot: null, snapshotDigest: null, inflight: {} });
const seqIn = () => ({ hwm: '0', lowerBound: '0', assembly: null, accepted: null });
/** A tuple with every per-tuple scope empty (6250: nothing migrates into it). */
export const emptyTuple = (spec) => ({
    priorCandidates: [],
    starOut: seqOut(), starIn: seqIn(), groupStarOut: seqOut(), groupStarIn: seqIn(),
    probeOut: { seq: '0', inflight: {}, done: false }, probeIn: { hwm: '0', lowerBound: '0', assembly: null },
    continuityOut: { rev: '0', body: null, proof: null, sent: [], align: false, chosen: null, reported: null, aligned: false, due: null },
    continuityIn: { rev: '0', body: null, recordPrior: null },
    mappingOut: { rev: '0', body: null, underAnchor: null },
    mappingIn: { rev: '0', body: null, self: null, card: null },
    profileIn: { rev: '0', body: null, verifiedSeq: '0' },
    deactivated: false,
    ...spec,
});
const DEFAULTS = { star: 'default', groupStar: 'default', anchorMapping: 'default', sealedGroupStar: 'default', profile: 'default' };
/** A fluent builder of valid HolderStates; `at` is the time it stamps
 *  (provenance, address lastShown), default 0. */
export function stateBuilder(opts = {}) {
    const at = opts.at ?? 0;
    const s = emptyState(CODEC);
    const contactOf = (id) => {
        if (!Object.hasOwn(s.contacts, id)) {
            s.contacts[id] = { id, pos: null, status: 'none', aliases: [], relIds: [], anchorHead: null, settings: { ...DEFAULTS }, groupSettings: {} };
        }
        return s.contacts[id];
    };
    const b = {
        community(genesis, head = '1') { s.register.community = { genesis, head }; return b; },
        lineage(rotations) { s.register.lineage = structuredClone(rotations); return b; },
        contact(id, fields = {}) { Object.assign(contactOf(id), structuredClone(fields)); return b; },
        relationship(id, spec) {
            const { contactId, tuples, ...rest } = structuredClone(spec);
            const c = contactOf(contactId);
            if (!c.relIds.includes(id))
                c.relIds.push(id);
            const full = tuples.map((t) => emptyTuple({ entryId: contactId, ...t }));
            for (const t of full) {
                if (!s.register.labels.includes(t.ownPairLabel))
                    s.register.labels.push(t.ownPairLabel);
                if (!Object.hasOwn(s.addresses.keys, t.rkid))
                    s.addresses.keys[t.rkid] = { label: t.ownPairLabel, lastShown: at };
            }
            s.relationships[id] = {
                id, contactId, tuples: full, activeHead: full[full.length - 1].ownPairLabel,
                earliestAnchor: null, links: [], bindings: {}, heldCounterpartHead: null, memory: {},
                provenance: { kind: 'ceremony', at }, chainedInto: null, firstVerified: null,
                ...rest,
            };
            if (!s.entryOrder.heads.includes(id))
                s.entryOrder.heads.push(id);
            return b;
        },
        entry(contactId, o = {}) {
            const c = contactOf(contactId);
            c.pos = s.entryOrder.nextPos;
            c.status = o.status ?? 'admitted';
            s.entryOrder.nextPos = (BigInt(s.entryOrder.nextPos) + 1n).toString();
            return b;
        },
        settings(contactId, settings) { Object.assign(contactOf(contactId).settings, settings); return b; },
        address(rkid, label, lastShown = at) { s.addresses.keys[rkid] = { label, lastShown }; return b; },
        duty(d) { s.duties[d.id] = structuredClone(d); return b; },
        with(fn) { fn(s); return b; },
        build() { return JSON.parse(encodeState(s)); },
    };
    return b;
}
