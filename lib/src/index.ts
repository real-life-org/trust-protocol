// @real-life/trust-protocol — the cryptographic core of RLTP.
//
// What this entry point IS: the wire-level primitives of the converged
// layers, reproducing the shipped test vectors byte for byte — the
// canonical form, the derivation of identity contexts under the closed
// label registry, the encounter wire builders, the sealed envelope and
// the generic receive chain.
//
// What it is NOT (yet): the layers' full state machines. Identity's
// recovery derivation, Encounter's ceremony record and acceptance
// machinery, Delivery's type-specific stages and residual bookkeeping
// live in the specification and its conformance fixtures, not here. A
// conformant implementation builds ON this module; importing it is not
// yet conformance. The README states per module which casting's wire
// forms it implements.
//
//   core              the form every artifact obeys
//   crypto            the primitives, and the Data Integrity proof
//   identity          context derivation under the closed registry (§6.1/§6.2)
//   encounter         the ceremony's wire forms: challenges, cards, credentials
//   delivery          the sealed envelope and the generic receive stages 1–4
//   carrier-identity  the carrier-relationship principal (Identity §7a)
//   carrier           the carrier side of the port (Delivery §4.4 + §5a)
//   holder            the holder side: proofs, verdicts, recovery (§5a, §9.3)
//   visibility        Trust Layer 0.31 on Delivery 0.81 — the trust
//                     act, the blinded star, the group star, the community
//                     anchor's rotation with pre-rotation (Identity 0.54
//                     §5.4), §6a continuity, the deniable ack
//                     (namespaced: `visibility.trust`, `.continuity`,
//                     `.acks`; graduated from /probe on 04.09.2026)
//   ceremony          Encounter 0.31's registered ceremony on Delivery
//                     0.79 — encounter-bundle, encounter-credential-
//                     delivery, the signed ack; own-challenge state
//                     model, enactment record, 5.6 acceptance, both
//                     paths of 5.8 (graduated from /probe on 05.09.2026)
//
// The Stage-2 holder contract (types and codec; the engine follows):
//
//   state             HolderState — the holder's whole state as JSON
//   codec             decodeState / encodeState under the codec version
//   ports             Store, KeyProvider, Log, Access, DeliveryReport, Outbound
//   results, events   ActResult, ReceiveResult, InfraError, HolderEvent
//   entropy           the Entropy port by closed purpose
//   ./testing         InMemoryStore, scriptedEntropy, storeContract, emptyState
//
// Specification, schemas and vectors: https://trust-protocol.real-life.org

export * from './core.js'
export * from './crypto.js'
export * from './identity.js'
export * from './encounter.js'
export * from './delivery.js'
export * from './carrier-identity.js'
export * from './carrier.js'
export * from './holder.js'
export * as visibility from './visibility.js'
export * as ceremony from './ceremony.js'
export type * from './state.js'
export { CODEC, MIGRATIONS, decodeState, encodeState, sameState, isKnownDuty, StateCodecError } from './codec.js'
export type { StateCodecErrorCode } from './codec.js'
export type * from './ports.js'
export type * from './events.js'
export { InfraError } from './results.js'
export type { ActError, ActResult, ReceiveFailure, ReceiveStageNo, ReceiveResult, InfraErrorCode } from './results.js'
export { ENTROPY_PURPOSES, EntropyError, randomEntropy } from './entropy.js'
export type { Entropy, EntropyPurpose, EntropyErrorCode } from './entropy.js'
export { storeContract } from './store-contract.js'
export type { ContractHarness } from './store-contract.js'
