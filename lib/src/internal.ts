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
//             SweepHandler, AckHandler, DecisionHandler, EventDraft,
//             OutboundDraft, EngineSnapshot; receive's Arrival,
//             ReceivedDocument, TaskRefusal, TaskDiscarded, TaskFailure
//   views     the pure projections state → view
//   prompts   DECIDE, DecideInput
//   trust     the trust module's factory (trustModule, for tests with another
//             admission bound or assembly limit), its task types and command
//             names, the pure reads of trust/state.ts (trusted, lags,
//             classOn, …), the 2240 re-commit (recommitEntries), the views
//             of 5.4 (starView, groupStarView, sealedOn), heldAnchors,
//             ASSEMBLY_LIMIT and discardAssemblies (5360, for PR 4c)
//   freeze    freezeDeep
export type * from './state.js'
export { emptyState, triasOf, toOpaque } from './state.js'
export { CODEC, MIGRATIONS, VALIDATORS, decodeState, encodeState, sameState, isKnownDuty, StateCodecError } from './codec.js'
export type { StateCodecErrorCode, StateValidator } from './codec.js'
export type { HolderModule, CommandDef, PrepareCtx, Prepared, Applied, Refusal, TaskHandler, DutyHandler, DutyCtx, SweepHandler, AckHandler, DecisionHandler, EventDraft, OutboundDraft, EngineSnapshot } from './engine.js'
export type { Arrival, ReceivedDocument, TaskDiscarded, DiscardReason, TaskFailure, TaskRefusal } from './receive.js'
export { contactsView, contactView, groupsView, profileView, promptsView, deliveryStatusView } from './views.js'
export { DECIDE } from './prompts.js'
export type { DecideInput } from './prompts.js'
export { freezeDeep } from './util-freeze.js'
export { trustModule, ANCHOR_MAPPING_TYPE, TRUST_COMMANDS, lineageSegment, recommitEntries } from './trust/mapping.js'
export type { TrustModuleOptions, TrustSetInput, TrustSetClassInput, TrustSetGroupClassInput, TrustPauseInput } from './trust/mapping.js'
export { ADMISSION_BOUND, CLASSES, classOn, classOnToward, trusted, lags, newestHeads, entryRelationships, activeTuple, findContact } from './trust/state.js'
export { STAR_TYPE, ASSEMBLY_LIMIT, starView, viewDigest, heldAnchors, discardAssemblies, rematchStars, retainInflight } from './trust/star.js'
export { GROUP_STAR_TYPE, groupStarView, sealedOn } from './trust/group-star.js'
export { promptsModule, collectDecisions } from './prompts.js'
export { createEngine } from './engine.js'
