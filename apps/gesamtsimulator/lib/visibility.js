// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// @real-life/trust-protocol — visibility: the GRADUATED Trust Layer.
//
// @deprecated as an app API (lib Stage 2): apps use createHolder, whose
// stateful acts and views replace the probe-world Person. This barrel
// stays until its consumers (apps/gesamtsimulator, the simulator shims)
// move in PR 7; nothing new is added to it. Its pure wire builders and
// checks stay reachable from the root afterwards (note §4.6).
//
// Graduated 04.09.2026 after a 39-round adversarial conformance loop
// (design/probe-nachzug-konvergenz-2026-09.md): these modules implement
// the NORMATIVE wire forms of Trust Layer 0.31 (with Identity 0.54 §5.4)
// carried by the Delivery Contract 0.81 —
//
//   anchor       the community anchor toward a contact: self-card@2,
//                anchor-rotation@2 with the pre-rotation binding, the
//                lineage (§6.5), anchor-mapping@4 (§6.1/§6.3, conditions
//                4a and 4b) and condition 8 for a changed self (a
//                rotation, or rejected as an unlinked change) — pure,
//                no state
//   group-star   group-star@1 (§5.2b): the sender's groups blinded to
//                every contact, sealed group-pair@1 to the chosen ones;
//                build, assemble, open — pure, entropy from the caller
//   trust        the trust act (anchor-mapping@4), the blinded star
//                (star@2 with 5.2a chunks), the admission layer (Section
//                2) with the head rule and the binding rule (§6a.1), the
//                5.4 reconciliation automaton, issuance discipline
//   continuity   §6a: continuity-probe@1 / continuity-mapping@1 — the
//                re-recognition of a relationship after a fresh
//                enactment; chains instead of duplicates
//   acks         the deniable delivery-ack/0.1 under the channel ack
//                key (Delivery 4.2 class rule)
//
// Wire forms and keys are byte-compatible with vectors/visibility.json,
// vectors/anchor-rotation.json and vectors/delivery-ack.json. The
// modules operate on the probe WORLD (a `Person` holding contexts,
// contacts, groups — DOM-free and storage-free); the host decides where
// bytes live.
//
// Not implemented yet: the trust classes of Section 2a as an API (the
// trust act stands for "anchor mapping class on"), profile@1 (§6b).
// Not in this module: transport adapters and their policies, storage,
// the Encounter layer's ceremony flows (graduated separately as
// `ceremony` on 05.09.2026).
export { COMMUNITY_GENESIS } from './probe/deps.js';
export * as trust from './probe/trust.js';
export * as continuity from './probe/continuity.js';
export * as acks from './probe/acks.js';
export * from './probe/anchor.js';
export * from './probe/group-star.js';
