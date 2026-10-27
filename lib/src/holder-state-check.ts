// holder-state-check — the generated HolderStateV4 (holder-state-v4.ts,
// from lib/schemas/holder-state-v4.schema.json, the current codec) and the hand-written
// HolderState (state.ts) held against each other at compile time: every
// schema-shaped state is a HolderState, and every HolderState is
// schema-shaped, but for `codec`, which state.ts keeps a number (the codec
// chain reads states of every version) and the schema pins to 4. A drift
// between the schema and state.ts fails the build. Type-only.
import type { HolderState } from './state.js'
import type { HolderStateV4 } from './holder-state-v4.js'

type Assignable<A, B> = A extends B ? true : false
type Both<A, B> = [Assignable<A, B>, Assignable<B, A>]
export type HolderStateMatchesSchema = Both<Omit<HolderState, 'codec'>, Omit<HolderStateV4, 'codec'>> extends [true, true]
  ? Assignable<HolderStateV4['codec'], HolderState['codec']> extends true ? true : never
  : never
const holds: HolderStateMatchesSchema = true
void holds
