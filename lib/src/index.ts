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
//   carrier-holder    the holder side of the carrier port: proofs, verdicts,
//                     recovery (§5a, §9.3)
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
// The Stage-2 holder (contract, engine core and facade):
//
//   holder-api        createHolder — the facade: the typed human acts
//                     (trust, untrust, pauseTrust, setClass, setGroupClass,
//                     merge, depart, decide; {when, actId}), recover, act,
//                     receive, tick, resume, report, subscribe, snapshot and
//                     the views: contacts, contact, groups, profile,
//                     prompts, deliveryStatus; `invariants: true` checks
//                     invariants.ts on every commit (testing mode). Built
//                     in: the trust module (Trust
//                     Layer 2a, 6.1–6.5, Section 2) — the human acts
//                     trust.set, trust.setClass, trust.setGroupClass,
//                     trust.pause, trust.merge, trust.depart, the anchor
//                     mapping's issuance and reception, the entry commit,
//                     merge and split (Section 2, 6a.1), the star and the
//                     group star (5.2–5.4) reconciled on resume and
//                     received, continuity (§6a: probe, continuity
//                     mapping, chaining)
//   views             the view types (ContactView, …)
//   keys-seed         seedKeys — the default KeyProvider over a root seed
//   state             HolderState — opaque here (note §4.5): store adapters
//                     persist it, apps read the views
//   codec             decodeState (to the opaque state), CODEC, StateCodecError
//   ports             Store, KeyProvider, Log, Access, DeliveryReport, Outbound
//   results, events   ActResult, ReceiveResult, InfraError, HolderEvent
//   entropy           the Entropy port by closed purpose
//   ./internal        the structural state, encodeState and the codec chain,
//                     the engine's module types (HolderModule, DecisionHandler,
//                     …), the pure view functions, the trust module's factory
//                     and its pure reads — for the library's modules and
//                     tests, not an app contract
//   ./testing         InMemoryStore, scriptedEntropy, storeContract, emptyState,
//                     stateBuilder, freezeDeep, sampleState, openPromptModule
//
// Specification, schemas and vectors: https://trust-protocol.real-life.org

export * from './core.js'
export * from './crypto.js'
export * from './identity.js'
export * from './encounter.js'
export * from './delivery.js'
export * from './carrier-identity.js'
export * from './carrier.js'
export * from './carrier-holder.js'
/** @deprecated The probe-world Trust Layer API; apps use createHolder.
 *  Kept until its consumers (the gesamtsimulator) move in PR 7; nothing
 *  new is added to it. */
export {
  PROFILE_TYPE, PROFILE_LIMITS, profileSchemaOk, imageDimensions, imageWithinBounds, profileProblem, profileInfo, profileKey,
  assembleProfile, profileMacOk,
} from './profile.js'
export type { ProfileContent, ProfileBody, ProfileArtifact, Dimensions, ImageDimensions } from './profile.js'
export * as visibility from './visibility.js'
/** @deprecated The probe-world ceremony API; apps use createHolder.
 *  Kept until its consumers move in PR 7; nothing new is added to it. */
export * as ceremony from './ceremony.js'
import { decodeState as decodeStructural } from './codec.js'
import type { OpaqueHolderState } from './state.js'
export type { OpaqueHolderState as HolderState, Dec, Millis, B64u, TrustClass, Setting, PromptKind, PromptChoice, OutboxStatus } from './state.js'
export { CODEC, StateCodecError } from './codec.js'
export type { StateCodecErrorCode } from './codec.js'
/** Load a stored state (a JSON string or a parsed value): an independent,
 *  opaque copy at the current codec, or StateCodecError. */
export function decodeState (raw: unknown): OpaqueHolderState {
  return decodeStructural(raw) as unknown as OpaqueHolderState
}
export type * from './ports.js'
export type * from './events.js'
export { InfraError, CryptoUnavailableError } from './results.js'
export type { ActError, ActResult, ReceiveFailure, ReceiveStageNo, ReceiveResult, ResumeResult, InfraErrorCode } from './results.js'
export { ENTROPY_PURPOSES, EntropyError, randomEntropy } from './entropy.js'
export type { Entropy, EntropyPurpose, EntropyErrorCode, PlatformRandom } from './entropy.js'
export { storeContract } from './store-contract.js'
export { seedKeys } from './keys-seed.js'
export { createHolder } from './holder-api.js'
export type { Holder, HolderOptions, HolderSnapshot, HumanActOptions } from './holder-api.js'
export type { DeviceKeyResult } from './identity-state.js'
export type { ContactView, RelationshipView, ClassView, SealedClassView, ClassesView, ContactProfileView, GroupView, ProfileView, PromptView, DeliveryItemView, DeliveryStatusView } from './views.js'
export type { EnginePorts, CommitListener, CryptoHandle } from './engine.js'
export type { ContractHarness } from './store-contract.js'
