// @real-life/trust-protocol/testing — tools for tests, vectors and
// adapter authors (lib Stage 2, note §4.6). Not for production holders.
// continuityTestModule opens a fresh tuple directly (continuity.newTuple),
// for tests that need one without a ceremony; holders meet through the
// encounter's acts (show, scan) since PR 7a.
export { InMemoryStore } from './store-memory.js'
export { memoryLog } from './log-memory.js'
export type { MemoryLog } from './log-memory.js'
export { scriptedEntropy } from './entropy.js'
export type { EntropyScript } from './entropy.js'
export { storeContract } from './store-contract.js'
export type { ContractHarness } from './store-contract.js'
export { emptyState } from './state.js'
export { stateBuilder, emptyTuple } from './state-builder.js'
export type { StateBuilder, TupleSpec, RelationshipSpec } from './state-builder.js'
export { freezeDeep } from './util-freeze.js'
export { sampleState, openPromptModule, OPEN_PROMPT } from './fixtures.js'
export { continuityTestModule, NEW_TUPLE } from './trust/continuity.js'
export type { NewTupleInput } from './trust/continuity.js'
export type { OpenPromptInput } from './fixtures.js'
export { stateViolations, transitionViolations, commitViolations } from './invariants.js'
export type { CommitOp, Violation } from './invariants.js'
export { forgeMapping } from './forge.js'
export type { ForgeMappingInput } from './forge.js'
// the live schema bundle (deep-frozen) and the wire-artifact types generated
// from the same schemas (wire.ts): they track the repository's castings, so
// they are test and tooling material, not the pinned root surface
export { SCHEMAS } from './schemas.js'
export type * as wire from './wire.js'
