// events — what a holder announces after a commit (lib Stage 2, note §4.4).
//
// A closed union, released only after the commit that caused it, never
// before. Events carry ids, not text: the app renders words from the
// type, and re-reads its views on any event. Events do not survive a
// restart; the act journal keeps them only to answer a repeated actId.
// Pure JSON, like the state that journals them.
import type { Json } from './core.js'
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
  /** a fresh tuple appended to a chain (6a.4, 6220): the fresh
   *  relationship `from` went into the chain `into`; contactId is the entry
   *  the chain's verifications go to after it */
  | { type: 'contact.chained', contactId: string, from: string, into: string }
  /** entries merged into one (2140): the survivor and the merged ids, now its aliases */
  | { type: 'contact.merged', contactId: string, merged: string[] }
  /** a relationship left a merged entry (2080): the remaining entry's id
   *  (renamed where 2100 says), the leaver's new entry id, the relationship */
  | { type: 'contact.split', contactId: string, leaver: string, relationshipId: string }
  /** relationships departed (2260): removed says the entry went with them */
  | { type: 'contact.departed', contactId: string, relationshipIds: string[], removed: boolean }
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
  /** the community anchor's rotation completed: the head is this generation (Identity §5.4) */
  | { type: 'anchor.rotated', generation: Dec }
  /** a device name entered the register (Identity §5.5) */
  | { type: 'device.added', name: string }
  /** a device name was marked revoked (Identity §5.5) */
  | { type: 'device.revoked', name: string }
  /** resume found a duty of a registered kind at a version no handler
   *  knows: kept untouched, announced once per resume (engine.ts) */
  | { type: 'duty.unsupported', dutyId: string, kind: string, v: number }
  /** a star (5.2a) completed on a relationship: its accepted snapshot changed */
  | { type: 'star.accepted', contactId: string, relationshipId: string, salt: Dec }
  /** a group star (5.2b) completed on a relationship; sharedGroups may have changed */
  | { type: 'groupStar.accepted', contactId: string, relationshipId: string, salt: Dec }
  /** a card displayed with a fresh own challenge (Encounter 5.3): `card`
   *  is the optical payload to show (Encounter 6) */
  | { type: 'encounter.shown', challenge: string, card: Json }
  /** the scanner's step (5.8 trunk 2–3): `card` is its sent card, the
   *  optical leg's payload where no network carries the bundle */
  | { type: 'encounter.scanned', contactId: string, card: Json }
  /** an enactment record created (5.5), on either side */
  | { type: 'encounter.recorded', contactId: string, relationshipId: string, role: 'scanner' | 'displayer' }
  /** the counterparty's step credential accepted (5.6): the edge now
   *  holds it; mutual when the own one is issued too (4.2) */
  | { type: 'encounter.accepted', contactId: string, relationshipId: string, mutual: boolean }
  /** a group founded by this holder (Access 3.4.1) */
  | { type: 'group.founded', groupId: string }
  /** a member admitted by this holder, by its member anchor */
  | { type: 'group.admitted', groupId: string, member: string }
  /** a vouch@2 issued by this holder for a member anchor (Access 5.3) */
  | { type: 'group.vouched', groupId: string, member: string }
)

export type HolderEventType = HolderEvent['type']
