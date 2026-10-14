// @real-life/trust-protocol/testing — tools for tests, vectors and
// adapter authors (lib Stage 2, note §4.6). Not for production holders.
export { InMemoryStore } from './store-memory.js'
export { scriptedEntropy } from './entropy.js'
export type { EntropyScript } from './entropy.js'
export { storeContract } from './store-contract.js'
export type { ContractHarness } from './store-contract.js'
export { emptyState } from './state.js'
export { freezeDeep } from './engine.js'
