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
//             DecisionHandler, EventDraft, OutboundDraft, EngineSnapshot;
//             receive's Arrival, ReceivedDocument, TaskRefusal, TaskFailure
//   views     the pure projections state → view
//   prompts   DECIDE, DecideInput
//   freeze    freezeDeep
export type * from './state.js'
export { emptyState, triasOf, toOpaque } from './state.js'
export { CODEC, MIGRATIONS, VALIDATORS, decodeState, encodeState, sameState, isKnownDuty, StateCodecError } from './codec.js'
export type { StateCodecErrorCode, StateValidator } from './codec.js'
export type { HolderModule, CommandDef, PrepareCtx, Prepared, Applied, Refusal, TaskHandler, DutyHandler, DutyCtx, DecisionHandler, EventDraft, OutboundDraft, EngineSnapshot } from './engine.js'
export type { Arrival, ReceivedDocument, TaskFailure, TaskRefusal } from './receive.js'
export { contactsView, contactView, groupsView, profileView, promptsView, deliveryStatusView } from './views.js'
export { DECIDE } from './prompts.js'
export type { DecideInput } from './prompts.js'
export { freezeDeep } from './util-freeze.js'
