// events — what a holder announces after a commit (lib Stage 2, note §4.4).
//
// A closed union, released only after the commit that caused it, never
// before. Events carry ids, not text: the app renders words from the
// type, and re-reads its views on any event. Events do not survive a
// restart; the act journal keeps them only to answer a repeated actId.
// Pure JSON, like the state that journals them.
import type { Dec, OutboxStatus, PromptChoice, PromptKind } from './state.js'

/** Fields every event carries. */
export interface EventBase {
  /** unique per event */
  eventId: string
  /** the human act that caused it, if any (note §4.2) */
  actId?: string
  /** commitSeq of the commit that caused it (state.ts), never the store token */
  commitSeq: Dec
}

export type HolderEvent = EventBase & (
  | { type: 'contact.added', contactId: string }
  /** a mapping verified on a relationship (6.3) */
  | { type: 'contact.verified', contactId: string, relationshipId: string }
  /** a fresh tuple appended to a chain (6a.4) */
  | { type: 'contact.chained', contactId: string, relationshipId: string }
  /** the Trust act: anchor-mapping class on (2770) */
  | { type: 'trust.given', contactId: string }
  | { type: 'trust.received', contactId: string }
  /** the pause of 5.4: star and blinded group star off, or back */
  | { type: 'trust.paused', contactId: string, paused: boolean }
  | { type: 'group.joined', groupId: string }
  | { type: 'prompt.opened', promptId: string, kind: PromptKind }
  /** the human decided a prompt; it is closed (prompts.ts) */
  | { type: 'prompt.decided', promptId: string, kind: PromptKind, choice: PromptChoice }
  /** sender status trias (Delivery §6.1) */
  | { type: 'delivery.status', digest: string, threadId: string, status: OutboxStatus, late?: boolean }
  /** contactId null: the holder's own profile */
  | { type: 'profile.updated', contactId: string | null }
  | { type: 'anchor.rotated', generation: Dec }
  /** resume found a duty of a registered kind at a version no handler
   *  knows: kept untouched, announced once per resume (engine.ts) */
  | { type: 'duty.unsupported', dutyId: string, kind: string, v: number }
)

export type HolderEventType = HolderEvent['type']
