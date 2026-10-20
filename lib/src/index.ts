// @real-life/trust-protocol — the reference library of RLTP.
//
// The holder: createHolder({store, keys, entropy?, log?, access?, retry?,
// crypto?}) — one person's device state behind the human acts, receive,
// report, resume and tick, and the views an app reads. The ports (Store,
// KeyProvider, Entropy, Log, Access, DeliveryReport, Outbound) are the
// app's; seedKeys is the default KeyProvider. Beside it, the pure wire
// builders and verifiers of every layer, byte-compatible with the shipped
// vectors.
//
//   core              the form every artifact obeys (JCS, digests, schemas)
//   crypto            the primitives, and the Data Integrity proof
//   identity          context derivation under the closed registry (§6.1/§6.2),
//                     device labels device/<n>/<c> (§5.5)
//   profile           profile@1 (Trust §6b): k_pr, the MAC, the bounds and
//                     the picture's header read before any decoding
//   encounter         the ceremony's wire forms: challenges, cards, credentials,
//                     and its pure checks (5.6 acceptance, the bundle's forms)
//   membership        Membership 0.20's forms and checks: the prelude,
//                     invite, accept, evidence, vouch@2, the member label, oids
//   message           Message Tasks 0.1's forms: message@1, k_msg, the MAC
//   introduction      Trust §8's artifacts and checks, the act window, the
//                     registry declaration's ack-delay
//   delivery          the sealed envelope and the generic receive stages 1–4
//   carrier-identity  the carrier-relationship principal (Identity §7a)
//   carrier           the carrier side of the port (Delivery §4.4 + §5a)
//   carrier-holder    the holder side of the carrier port: proofs, verdicts,
//                     recovery (§5a, §9.3)
//   visibility        the Trust Layer's wire forms, pure: anchor (self-card@2,
//                     anchor-rotation@2, anchor-mapping@4), star@2,
//                     group-star@1, continuity-probe@1 and
//                     continuity-mapping@1, delivery-ack/0.1
//   ceremony          the encounter's, the group's and the introduction's
//                     wire forms, pure (the same as the root's encounter,
//                     membership and introduction modules, under one name)
//
// The holder (holder-api.ts): the typed human acts (trust, untrust,
// pauseTrust, setClass, setGroupClass, merge, depart, decide, rotateAnchor,
// setProfile, addDevice, revokeDevice, show, scan, captureSentCard,
// counter, foundGroup, invite, vouchFor, introduce, sendMessage, block,
// unblock; {when, actId}), recover, takeMessages, act, receive, tick,
// resume, report, subscribe, snapshot, deviceKey and the views contacts,
// contact, groups, profile, prompts, inbox, deliveryStatus;
// `invariants: true` checks invariants.ts on every commit (testing mode).
// Its modules: identity (Identity §2, §5.4, §5.5), trust (Trust 2, 2a,
// 5.2–5.4, 6.1–6.5, 6a, 6b), encounter (Encounter 0.31 §5–§7), membership
// (Membership 0.20 with an in-library Access), introduction (Trust §8) and
// message (Message Tasks 0.1: messages, the inbox, the block).
//
//   views             the view types (ContactView, …)
//   keys-seed         seedKeys — the default KeyProvider over a root seed
//   state             HolderState — opaque here (note §4.5): store adapters
//                     persist it, apps read the views
//   codec             decodeState (to the opaque state), CODEC, StateCodecError
//   ports             Store, KeyProvider, Log, Access, DeliveryReport, Outbound
//   results, events   ActResult, ReceiveResult, InfraError, HolderEvent
//   entropy           the Entropy port by closed purpose
//   store-contract    storeContract — the test suite a Store adapter passes
//
// Other entry points:
//   ./testing         InMemoryStore, memoryLog, scriptedEntropy, storeContract,
//                     emptyState, stateBuilder, freezeDeep, sampleState,
//                     openPromptModule, the invariants, forgeMapping, SCHEMAS
//                     and the generated wire types
//   ./internal        the structural state, encodeState and the codec chain,
//                     the engine's module types, the pure view functions, the
//                     modules' factories and pure reads — for the library's
//                     modules and tests, not an app contract
//   ./adapters/vti-mediator   the VTI mediator's reports as DeliveryReport
//
// Specification, schemas and vectors: https://trust-protocol.real-life.org

export * from './core.js'
export * from './crypto.js'
export * from './identity.js'
export * from './encounter.js'
export * from './membership.js'
export * from './message.js'
export * from './introduction.js'
export * from './delivery.js'
export * from './carrier-identity.js'
export * from './carrier.js'
export * from './carrier-holder.js'
export {
  PROFILE_TYPE, PROFILE_LIMITS, profileSchemaOk, imageDimensions, imageWithinBounds, profileProblem, profileInfo, profileKey,
  assembleProfile, profileMacOk,
} from './profile.js'
export type { ProfileContent, ProfileBody, ProfileArtifact, Dimensions, ImageDimensions } from './profile.js'
export * as visibility from './visibility.js'
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
export type { ActError, ActResult, ActReplay, ReceiveFailure, ReceiveStageNo, ReceiveResult, ReplayOutbound, ReplayResult, ResumeResult, InfraErrorCode } from './results.js'
export { ENTROPY_PURPOSES, EntropyError, randomEntropy } from './entropy.js'
export type { Entropy, EntropyPurpose, EntropyErrorCode, PlatformRandom } from './entropy.js'
export { storeContract } from './store-contract.js'
export { seedKeys } from './keys-seed.js'
export { createHolder } from './holder-api.js'
export type { Holder, HolderOptions, HolderSnapshot, HumanActOptions } from './holder-api.js'
export type { DeviceKeyResult } from './identity-state.js'
export type { ContactView, RelationshipView, ClassView, SealedClassView, ClassesView, ContactProfileView, GroupView, ProfileView, PromptView, InboxMessageView, DeliveryItemView, DeliveryStatusView } from './views.js'
export type { EnginePorts, CommitListener, CryptoHandle, TransportEntry, TransportView, TransportRefusal } from './engine.js'
export type { ContractHarness } from './store-contract.js'
