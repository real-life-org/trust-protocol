// trust/duties — the class duties of Section 2a in one place (lib Stage 2,
// PR 5): when a trust class is on for a relationship (2850, 6595), which
// duties deliver it, and the one open / drop / move logic every
// transition that changes settings, entries or relationships runs: the
// Trust act and the class settings (2770–2840), a merge (2160), a split
// (2115), a departure (2260), the entry commit of a verification and a
// chaining (6a.4). The anchor mapping (6370, 6410, 6596), the star
// classes (5.4) and the profile (6455, 6465) share it.
//
// Rule numbers: bare four-digit numbers are RLTP-TRU (trust-layer.md).
//
// The model. A class is on for a relationship when it is on toward the
// entry the relationship's verifications go to (2145, 2146), the
// relationship is live, and, except for the star and the blinded group
// star, it does not lag (6595). How a class reaches a relationship:
//   - star, blinded and sealed group star: the reconciliation of 5.4
//     (trust/star.ts, trust/group-star.ts). Its sweep reads the settings
//     through its view: a class turning on adds a pending key (the
//     engine's wake names `when`), a class turning off stops production
//     and leaves the baseline as it is (5830, 5760), so turning on again
//     re-evaluates against that baseline (5850). No duty
//   - anchor mapping: class-on/1 `class-on:anchorMapping:<relId>` (2850)
//     and reissue-mapping/1 (6370, 6596)
//   - profile: class-on/1 `class-on:profile:<relId>` (2850, 6455) and
//     profile/1 `profile:<relId>` for a new revision (6455). Both kinds
//     wait ('not-due') until profile@1 graduates in PR 6
//
// The follow rule (followClasses), run on (before, after) of a transition:
//   open  per live relationship and duty class: on for it now and not
//         before (it turned on toward the entry, or the relationship
//         ceased to lag, or it is new to an entry the class is on toward)
//         opens the class-on duty, unless one is open
//   drop  per relationship: a duty class off toward the entry its
//         verifications go to drops every duty of that class owed on it
//         (6410, 2790: nothing more while off). A relationship that only
//         started to lag keeps its duties: the anchor mapping's class-on
//         is fulfilled without sending, its re-issue still goes (6596)
//   move  at a chaining, every class duty owed on the chain and on the
//         appended relationship moves to the chain under the entry that
//         takes its verifications (moveDuties)
//
// Choices this file makes where note and spec leave them open:
//   - the profile class-on duty opens only where an own profile exists
//     (state.profile.body): 2850 and 6455 owe "the class's current
//     artifact", and before the first profile there is none. A profile set
//     later goes out by its own revision duty (6455, PR 6)
//   - 6465 (the profile on the new head after a chaining, a SHOULD) is
//     followed: the chaining opens the profile's class-on duty on the
//     chain where the class is on for it (afterChain)
//   - which transitions may drop a duty is listed in invariants.ts
//     (dutyDrops): fulfilment by resume, the drop rule above, departure of
//     its relationship, the move at a chaining, a merge duty that no longer
//     holds, and the continuity flow's own ends
import type { DutyHandler } from '../engine.js'
import type { ClassOnDuty, Contact, Duty, HolderState, ProfileDuty, ReissueMappingDuty, Relationship, TrustClass } from '../state.js'
import { classOnToward, entryOf, entryRelationships, lags, liveRel } from './state.js'

/** The classes a class-on duty delivers (2850), in the table's order. */
export const DUTY_CLASSES: readonly TrustClass[] = Object.freeze(['anchorMapping', 'profile'])
/** The classes the reconciliation of 5.4 delivers. */
export const RECONCILED: readonly TrustClass[] = Object.freeze(['star', 'groupStar', 'sealedGroupStar'])

/** The class-on duty's deterministic id. */
export const classOnId = (cls: TrustClass, relId: string): string => `class-on:${cls}:${relId}`
/** The profile revision duty's deterministic id (6455). */
export const profileDutyId = (relId: string): string => `profile:${relId}`

/** The class a duty delivers on one relationship, or null for every other kind. */
export function classOfDuty (d: Duty): TrustClass | null {
  if (d.kind === 'class-on') return (d as ClassOnDuty).cls
  if (d.kind === 'reissue-mapping') return 'anchorMapping'
  if (d.kind === 'profile') return 'profile'
  return null
}

/** Is `d` a duty of a duty class owed on `relId` (of class `cls`, where given)? */
export const owedOn = (d: Duty, relId: string, cls?: TrustClass): boolean => {
  const c = classOfDuty(d)
  return c !== null && (cls === undefined || c === cls) && (d as { relId?: unknown }).relId === relId
}

/** Whether the class has an artifact to send now: the profile once one exists. */
export const hasArtifact = (state: Readonly<HolderState>, cls: TrustClass): boolean =>
  cls !== 'profile' || state.profile.body !== null

/**
 * Whether `cls` is on for relationship `r` (2850, 6595): on toward the
 * entry its verifications go to, the relationship live, and, except for
 * the star and the blinded group star, not lagging in that entry.
 */
export function onFor (state: Readonly<HolderState>, r: Readonly<Relationship>, cls: TrustClass): boolean {
  if (!liveRel(r)) return false
  const c = entryOf(state, r)
  if (!c || !c.relIds.includes(r.id) || !classOnToward(c, cls)) return false
  if (cls === 'star' || cls === 'groupStar') return true
  return !lags(r, entryRelationships(state, c))
}

/** A class-on duty of `cls` on `relId`, unless one is open in `state` or among `extra`. */
export function classOnDuty (state: Readonly<HolderState>, contactId: string, relId: string, cls: TrustClass, extra: readonly Duty[] = []): ClassOnDuty[] {
  const id = classOnId(cls, relId)
  if (Object.hasOwn(state.duties, id) || extra.some((d) => d.id === id)) return []
  return [{ kind: 'class-on', v: 1, id, contactId, relId, cls }]
}

/** The drop rule (6410, 2790): every duty of a duty class owed on a
 *  relationship whose entry has that class off goes; `extra` (duties a
 *  transition is about to open) is filtered the same way. */
export function dropOff (state: HolderState, extra: readonly Duty[] = []): { state: HolderState, extra: Duty[] } {
  const off = (d: Duty): boolean => {
    const cls = classOfDuty(d)
    if (cls === null) return false
    const relId = (d as { relId: string }).relId
    if (!Object.hasOwn(state.relationships, relId)) return false
    const r = state.relationships[relId]
    if (r.chainedInto !== null) return false                   // moved at the chaining
    const c = entryOf(state, r)
    return c !== undefined && !classOnToward(c, cls)
  }
  const gone = Object.values(state.duties).filter(off)
  const next = gone.length
    ? { ...state, duties: Object.fromEntries(Object.entries(state.duties).filter(([, d]) => !off(d))) }
    : state
  return { state: next, extra: extra.filter((d) => !off(d)) }
}

/**
 * The follow rule (see the header) over a transition from `before` to
 * `after`: the drop rule on `after`, then a class-on duty for every live
 * relationship and duty class on for it now and not before. `extra` are
 * the duties the transition opens besides (kept, deduplicated against);
 * the result's `duties` are those and the new ones.
 */
export function followClasses (before: Readonly<HolderState>, after: HolderState, extra: readonly Duty[] = []): { state: HolderState, duties: Duty[] } {
  const d = dropOff(after, extra)
  const state = d.state
  const duties: Duty[] = [...d.extra]
  for (const id of Object.keys(state.relationships).sort()) {
    const r = state.relationships[id]
    if (!liveRel(r)) continue
    const was = Object.hasOwn(before.relationships, id) ? before.relationships[id] : undefined
    for (const cls of DUTY_CLASSES) {
      if (!hasArtifact(state, cls) || !onFor(state, r, cls)) continue
      if (was && onFor(before, was, cls)) continue
      duties.push(...classOnDuty(state, entryOf(state, r)!.id, id, cls, duties))
    }
  }
  return { state, duties }
}

/**
 * The move at a chaining (6a.4, 2146): the class duties owed on `from`
 * (the chain, then the appended relationship) go to `relId` under
 * `contactId`, none dropped. Several re-issues are one (6596: one delivery
 * meets every re-issue owed), the most urgent awaited head kept (null, due
 * at once, wins; else the first's); several class-on duties of one class
 * are one; several profile duties are one, at the highest revision.
 */
export function moveDuties (state: HolderState, from: readonly string[], relId: string, contactId: string): HolderState {
  const owed = Object.values(state.duties)
    .filter((d) => classOfDuty(d) !== null && from.includes((d as { relId: string }).relId))
    .sort((a, b) => from.indexOf((a as { relId: string }).relId) - from.indexOf((b as { relId: string }).relId))
  if (!owed.length) return state
  const duties = { ...state.duties }
  for (const d of owed) delete duties[d.id]
  const reissues = owed.filter((d): d is ReissueMappingDuty => d.kind === 'reissue-mapping')
  if (reissues.length) {
    const base = reissues[0]
    const awaitHead = reissues.some((d) => d.awaitHead === null) ? null : base.awaitHead
    duties[base.id] = { ...base, contactId, relId, awaitHead }
  }
  for (const d of owed.filter((x): x is ClassOnDuty => x.kind === 'class-on')) {
    const id = classOnId(d.cls, relId)
    if (!Object.hasOwn(duties, id)) duties[id] = { ...d, id, contactId, relId }
  }
  const profiles = owed.filter((d): d is ProfileDuty => d.kind === 'profile')
  if (profiles.length) {
    const top = profiles.reduce((a, b) => (BigInt(b.rev) > BigInt(a.rev) ? b : a))
    const id = profileDutyId(relId)
    const held = Object.hasOwn(duties, id) ? duties[id] as ProfileDuty : undefined
    if (!held || BigInt(top.rev) > BigInt(held.rev)) duties[id] = { ...top, id, contactId, relId }
  }
  return { ...state, duties }
}

/** 6465: after a chaining, the profile's class-on duty on the chain where
 *  the class is on for it and a profile exists. */
export function afterChain (state: Readonly<HolderState>, relId: string, extra: readonly Duty[]): Duty[] {
  const r = state.relationships[relId]
  if (!r || !hasArtifact(state, 'profile') || !onFor(state, r, 'profile')) return []
  return classOnDuty(state, entryOf(state, r)!.id, relId, 'profile', extra)
}

/**
 * The class-on/1 handler: a reconciled class is fulfilled without sending
 * (its sweep runs in the same resume after the duties, 5850); a class with
 * a handler in `byClass` runs it; any other (the profile until PR 6) waits.
 */
export function classOnHandler (byClass: Partial<Record<TrustClass, DutyHandler>>): DutyHandler {
  const of = (d: Duty): TrustClass => (d as ClassOnDuty).cls
  return {
    v: 1,
    prepare: (ctx, duty) => {
      const h = byClass[of(duty)]
      return h?.prepare ? h.prepare(ctx, duty) : Promise.resolve(null)
    },
    apply (state, duty, ctx, when) {
      const cls = of(duty)
      if (RECONCILED.includes(cls)) return { state: state as HolderState }
      const h = byClass[cls]
      return h ? h.apply(state, duty, ctx, when) : 'not-due'
    },
  }
}

/** profile/1 (6455): a stub until profile@1 graduates in PR 6. The duty
 *  is opened, moved and dropped by the rules above; delivering it waits. */
export const profileDuty: DutyHandler = Object.freeze({ v: 1, apply: () => 'not-due' as const })

/** Every relationship of `c` the class is on for (2820, 2850): for tests and views. */
export const onRelationships = (state: Readonly<HolderState>, c: Readonly<Contact>, cls: TrustClass): string[] =>
  entryRelationships(state, c).filter((r) => onFor(state, r, cls)).map((r) => r.id)
