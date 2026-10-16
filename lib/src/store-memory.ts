// store-memory — the in-memory reference Store (lib Stage 2, note §3).
//
// Volatile by design: durable only for later readers of this instance.
// Copies on the way in and out (snapshot isolation), compare-and-swap on
// an opaque version token. It stores whatever JSON it is given and never
// decodes or migrates.
import type { HolderState } from './state.js'
import type { CommitResult, Store, StoreSnapshot } from './ports.js'

export class InMemoryStore implements Store {
  #state: unknown = null
  #version: string | null = null
  #n = 0

  async read (): Promise<StoreSnapshot> {
    return { state: structuredClone(this.#state), version: this.#version }
  }

  async commit (version: string | null, next: HolderState): Promise<CommitResult> {
    if (version !== this.#version) return { ok: false, reason: 'conflict' }
    const copy = structuredClone(next)
    this.#state = copy
    this.#version = `m${++this.#n}`
    return { ok: true, version: this.#version }
  }
}
