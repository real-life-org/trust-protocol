// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// @real-life/trust-protocol/testing — tools for tests, vectors and
// adapter authors (lib Stage 2, note §4.6). Not for production holders.
// continuityTestModule opens fresh tuples (continuity.newTuple) until
// the encounter graduates (PR 7).
export { InMemoryStore } from './store-memory.js';
export { scriptedEntropy } from './entropy.js';
export { storeContract } from './store-contract.js';
export { emptyState } from './state.js';
export { stateBuilder, emptyTuple } from './state-builder.js';
export { freezeDeep } from './util-freeze.js';
export { sampleState, openPromptModule, OPEN_PROMPT } from './fixtures.js';
export { continuityTestModule, NEW_TUPLE } from './trust/continuity.js';
