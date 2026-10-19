// @real-life/trust-protocol/internal — what the library's own modules and
// its tests build on, not an app contract (lib Stage 2, note §4.5, §4.6).
//
// The structural HolderState and its parts change with every codec until
// 0.4.0 and beyond; apps read the views through createHolder, and store
// adapters see the state only as the opaque root type. Here:
//
//   state     the structural HolderState and its parts, emptyState, triasOf
//   codec     decodeState (structural), encodeState, sameState, the chain
//             (CODEC, MIGRATIONS, VALIDATORS), isKnownDuty
//   engine    the module surface: HolderModule, CommandDef, PrepareCtx,
//             Prepared, Applied, Refusal, TaskHandler, DutyHandler, DutyCtx,
//             SweepHandler, AckHandler, FailureHandler, IdentityRename, DecisionHandler, EventDraft,
//             OutboundDraft, EngineSnapshot; receive's Arrival,
//             ReceivedDocument, TaskRefusal, TaskDiscarded, TaskFailure
//   views     the pure projections state → view
//   prompts   DECIDE, DecideInput
//   trust     the trust module's factory (trustModule, for tests with another
//             admission bound or assembly limit), its task types and command
//             names, the pure reads of trust/state.ts (trusted, lags,
//             classOn, …), the 2240 re-commit (recommitEntries), the views
//             of 5.4 (starView, groupStarView, sealedOn), heldAnchors,
//             ASSEMBLY_LIMIT and discardAssemblies (5360); the entries
//             (trust/entries.ts: merge, split, departure, the identity
//             rewrite) and continuity (trust/continuity.ts: openTuple,
//             chainTuple, substitutePrior, the task types); the class
//             duties (trust/duties.ts: onFor, the follow rule, the move at
//             a chaining, the handlers)
//   freeze    freezeDeep
//   invariants  the predicates of invariants.ts over a state and a commit
export type * from './state.js'
// the projections of the non-normative lib/schemas/holder-state-v<n>.schema.json
export type { HolderStateV1 } from './holder-state-v1.js'
export type { HolderStateV2 } from './holder-state-v2.js'
export { emptyState, triasOf, toOpaque } from './state.js'
export { CODEC, MIGRATIONS, VALIDATORS, decodeState, encodeState, sameState, isKnownDuty, StateCodecError } from './codec.js'
export type { StateCodecErrorCode, StateValidator } from './codec.js'
export type { HolderModule, CommandDef, PrepareCtx, Prepared, Applied, Refusal, TaskHandler, DutyHandler, DutyCtx, SweepHandler, AckHandler, DecisionHandler, DecisionDef, DecisionFn, EventDraft, OutboundDraft, EngineSnapshot } from './engine.js'
export type { Arrival, Channel, ReceivedDocument, TaskDiscarded, DiscardReason, TaskFailure, TaskRefusal } from './receive.js'
export { SIGNATURE_CLASS } from './receive.js'
export { contactsView, contactView, groupsView, profileView, promptsView, deliveryStatusView } from './views.js'
export { DECIDE } from './prompts.js'
export type { DecideInput } from './prompts.js'
export { freezeDeep } from './util-freeze.js'
export { trustModule, ANCHOR_MAPPING_TYPE, TRUST_COMMANDS, lineageSegment, recommitEntries } from './trust/mapping.js'
export type { TrustModuleOptions, TrustSetInput, TrustSetClassInput, TrustSetGroupClassInput, TrustPauseInput } from './trust/mapping.js'
export {
  ADMISSION_BOUND, CLASSES, classOn, classOnToward, trusted, lags, newestHeads, newestOf, entryRelationships, activeTuple, findContact,
  entryOf, feeding, conflicts, joins, supersededIn, anchorSet, tupleByLabel, liveRel,
} from './trust/state.js'
export { STAR_TYPE, ASSEMBLY_LIMIT, starView, viewDigest, heldAnchors, discardAssemblies, rematchStars, retainInflight } from './trust/star.js'
export { GROUP_STAR_TYPE, groupStarView, sealedOn } from './trust/group-star.js'
export { CONTINUITY_PROBE_TYPE, CONTINUITY_MAPPING_TYPE, NEW_TUPLE, openTuple, chainTuple, substitutePrior } from './trust/continuity.js'
export type { NewTupleInput } from './trust/continuity.js'
export {
  ENTRY_COMMANDS, mergeEntries, mergeDutiesAfter, mergeable, mergeSettings, rewriteIdentity, splitOff, depart, chainAliases, settleHead, admitPending,
} from './trust/entries.js'
export type { TrustMergeInput, TrustDepartInput } from './trust/entries.js'
export {
  DUTY_CLASSES, RECONCILED, classOnId, profileDutyId, classOfDuty, owedOn, onFor, onRelationships, classOnDuty, dropOff, followClasses, moveDuties, afterChain,
  classOnHandler,
} from './trust/duties.js'
export { promptsModule, collectDecisions } from './prompts.js'
export { PROFILE_SET, profileIssueDuty, profileTask, profileParts } from './trust/profile.js'
export { identityModule, IDENTITY_COMMANDS, GENERATION_LAST, withLabel, withPairNonce, deviceKeyOf, rotationDutyId, reissueId } from './identity-state.js'
export type { DeviceInput, DeviceKeyResult } from './identity-state.js'
export { stateViolations, transitionViolations, commitViolations, dutyDrops } from './invariants.js'
export type { CommitOp, Violation } from './invariants.js'
export { createEngine } from './engine.js'
export { encounterModule, ENCOUNTER_COMMANDS, resolve as resolveChallenge, idsOf as encounterIdsOf, confirmPromptId } from './encounter/ceremony.js'
export type { ShowInput, ScanInput, CaptureInput, CounterInput } from './encounter/ceremony.js'
export { membershipModule, localAccess, MEMBERSHIP_COMMANDS, PRELUDE_REQUEST_TYPE, PRELUDE_REPLY_TYPE, WELCOME_TYPE } from './membership/holder.js'
export type { FoundInput, InviteInput, VouchInput } from './membership/holder.js'
export { introductionModule, INTRODUCTION_COMMANDS, OFFER_TYPE, ACK_DELAY } from './introduction/holder.js'
export type { IntroduceInput } from './introduction/holder.js'
