// message/holder — Message Tasks 0.1 on the holder (lib 0.5.0): the block
// of a relationship (Section 6) and the rates per relationship (4.2).
//
// What it registers (messageModule):
//   human acts  message.block {contactId, blocked}   sets or clears the
//               block on every relationship of the contact's entry
//               (RLTP-MSG-6020); event contact.blocked
//
// What the other modules read through here (pure):
//   blockedRel(state, relId)        the block of one relationship (6010)
//   relOfRkid(state, rkid)          the relationship an own tuple key belongs
//                                   to now, through its tuple (attribution,
//                                   6110; Membership RLTP-MT-3940)
//   rateCount / withRate            the acceptance times a rate counts in the
//                                   24 hours before `when` (4110, 4115)
//   blockedContact(state, id)       whether any relationship of an entry is
//                                   blocked (the outbound refusal of 6410)
//
// Choices this file makes where the specification leaves them open:
//   - the block is kept beside the relationships, by relationship id
//     (`messages.blocked`): the chain's id survives a chaining (6030: the
//     chain keeps its block, and takes the block of the fresh relationship
//     it absorbs, trust/continuity.ts) and stays with the relationship through a
//     merge and a split; trust/entries.ts sets it on every relationship of
//     a merged entry where one held it (6030) and drops it with a departed
//     relationship
//   - the lock keys (Delivery RLTP-DEL-6210–6230, Message Tasks 4230,
//     4240, 6330): the engine serializes every operation of a holder in
//     one queue and commits by CAS over the whole state, re-entering at
//     stage 1 on a conflict (receive.ts), which holds every key a rule
//     names and decides on the state read after the wait
//   - a rate keeps only the times inside the window, pruned when it is
//     written; at most the bound's number of entries per relationship
//   - which types a block treats (Delivery RLTP-DEL-6245): message/0.1
//     (Message Tasks), membership-invite/0.2 and the prelude reply
//     (Membership 0.20, RLTP-MT-3115, 3975). The Trust Layer types of the
//     table of 6.3 (the introduction's, the profile, the stars, the
//     anchor mapping) are evaluated as without a block until the Trust
//     Layer's casting takes the change up (RLTP-MSG-6240); the views mark
//     a blocked contact so an application shows nothing of it (6230)
import type { CommandDef, HolderModule, Refusal } from '../engine.js'
import type { HolderState, Millis, Rates } from '../state.js'
import { findContact } from '../trust/state.js'
import { tupleByRkid } from '../receive.js'

export const MESSAGE_COMMANDS = Object.freeze({ block: 'message.block' } as const)

/** The rate window of Message Tasks 4.2: any 24 hours. */
export const RATE_WINDOW = 86_400_000
/** At most 20 invitations with a new credential digest per relationship
 *  and window (RLTP-MSG-4115, Membership RLTP-MT-3105). */
export const INVITE_RATE = 20

export interface BlockInput { contactId: string, blocked: boolean }

const no = (code: Refusal['code'], ref?: string): Refusal => ({ ok: false, code, ...(ref ? { ref } : {}) })
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Whether the relationship is blocked (RLTP-MSG-6010). */
export const blockedRel = (state: Readonly<HolderState>, relId: string): boolean => state.messages.blocked.includes(relId)

/** The relationship id the own tuple key `rkid` belongs to now, or null. */
export const relOfRkid = (state: Readonly<HolderState>, rkid: string): string | null => tupleByRkid(state, rkid)?.rel.id ?? null

/** Whether any relationship of the entry `id` names (by id or alias) is blocked. */
export const blockedContact = (state: Readonly<HolderState>, id: string): boolean => {
  const c = findContact(state, id)
  return c !== undefined && c.relIds.some((r) => blockedRel(state, r))
}

/** The blocked set with `relIds` set or cleared, sorted. */
export const withBlocked = (blocked: readonly string[], relIds: readonly string[], on: boolean): string[] =>
  (on ? [...new Set([...blocked, ...relIds])] : blocked.filter((r) => !relIds.includes(r))).sort(cmp)

/** The acceptance times of `kind` on the relationship inside the window before `when`. */
export const rateCount = (state: Readonly<HolderState>, relId: string, kind: keyof Rates, when: Millis): number =>
  (Object.hasOwn(state.messages.rates, relId) ? state.messages.rates[relId][kind] : []).filter((t) => t > when - RATE_WINDOW).length

/** The state with one more acceptance of `kind` on the relationship at `when`, the window pruned. */
export function withRate (state: Readonly<HolderState>, relId: string, kind: keyof Rates, when: Millis): HolderState {
  const held: Rates = Object.hasOwn(state.messages.rates, relId) ? state.messages.rates[relId] : { invites: [] }
  const next: Rates = { ...held, [kind]: [...held[kind].filter((t) => t > when - RATE_WINDOW), when] }
  return { ...state, messages: { ...state.messages, rates: { ...state.messages.rates, [relId]: next } } } as HolderState
}

/** The message state without the relationships `relIds` (a departure). */
export function withoutRelationships (state: Readonly<HolderState>, relIds: readonly string[]): HolderState {
  if (!relIds.some((r) => blockedRel(state, r) || Object.hasOwn(state.messages.rates, r))) return state as HolderState
  const rates = { ...state.messages.rates }
  for (const r of relIds) delete rates[r]
  return { ...state, messages: { ...state.messages, blocked: state.messages.blocked.filter((r) => !relIds.includes(r)), rates } } as HolderState
}

// ── the block act (Section 6.1) ────────────────────────────────────────

const blockDef: CommandDef<BlockInput, null> = {
  human: true,
  apply (state, _p, input) {
    if (typeof input?.contactId !== 'string' || typeof input.blocked !== 'boolean') throw new TypeError('message.block needs {contactId, blocked}')
    const c = findContact(state, input.contactId)
    if (!c) return no('unknown-contact')
    // every relationship of the entry (6020); unblocking deletes nothing
    // else and surfaces nothing (6510)
    const blocked = withBlocked(state.messages.blocked, c.relIds, input.blocked)
    return {
      state: { ...state, messages: { ...state.messages, blocked } },
      events: [{ type: 'contact.blocked', contactId: c.id, blocked: input.blocked }],
    }
  },
}

/** The message module createHolder registers. */
export function messageModule (): HolderModule {
  return Object.freeze({
    name: 'message',
    commands: Object.freeze({ [MESSAGE_COMMANDS.block]: blockDef }),
  })
}
