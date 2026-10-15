// identity-state — the Identity Layer on the holder (lib Stage 2, PR 6):
// the label register (Identity §2, §6.3) with its device names and
// revocation marks (§5.5), and the community anchor's rotation as a
// resumable procedure over the Log port (§5.4; Trust 6360–6420, 6596;
// Access §5.6). Module `identity`, built into createHolder.
//
// What the module registers:
//   commands  identity.addDevice {name}      a device name into the
//               register (§5.5), before any key derived from it is
//               presented; human
//             identity.revokeDevice {name}   the name's revocation mark
//               (§5.5): never removed, the name never given again; human
//             identity.rotate {}             the community anchor's rotation
//               (§5.4): step 1 when none runs, else step 2 of the running
//               one; human (holder.rotateAnchor)
//   duty      rotation/1 {rotationId}        step 2 on resume, until the log
//               holds the entry
//
// The rotation, a procedure in state.rotations (note §2.1, §3 Log):
//   step 1 (identity.rotate, one commit)  generation g+1 derived and its
//     label recorded in the register (§5.4: persisted before any
//     presentation; 6360: before the log entry); anchor-rotation@2 built
//     (prev g, next g+1, commit = the binding of g+2) and signed by prev and
//     next through the KeyProvider; the head of the log read; per
//     relationship the withholding of 6596 decided against the entry state
//     now (awaitHead: H, the entry's anchor head, where the relationship
//     lags; null where it does not; only where the anchor mapping class is
//     on); the closure {entry: {rotation}, overHead} persisted; the
//     rotation duty opened. The register's head stays g: nothing is issued
//     under g+1 before the log holds it
//   step 2 (the rotation duty on resume, or identity.rotate again)  through
//     the Log port: head() must show the lineage through g (§5.4, RLTP-ACC-
//     5980: empty for g = 1, else the entry that introduced g: gen g, next
//     = prev, commit = the binding of next), otherwise log-behind (the head
//     is earlier) or log-diverged (another genesis, or a head the rotation
//     does not continue), and the rotation stays pending. A head that
//     already shows this rotation (a lost answer) is appended again and
//     answers exists. append(entry, head) on appended/exists completes the
//     rotation in one commit: the register's head g+1, the rotation in
//     register.lineage, the rotation and its duty gone, anchor.rotated, and
//     the re-issue duties of 6370 opened from the awaitHead decided at step
//     1 (reissue-mapping/1, id reissue:<g+1>:<relId>) — and for a live
//     relationship the class is on for now that was not in it (new since
//     step 1), decided at completion. head-conflict re-reads and retries
//     (four reads); failure, or a port that throws, keeps the rotation
//     pending: the duty is due again after the retry backoff (attempt,
//     lastAt), the act answers log-failure
//   6380 (the self card under the new anchor wherever it is carried): the
//     card travels only inside anchor-mapping@4 here (6.1 card), so the
//     re-issue of 6370 carries it; no duty of its own until the encounter
//     (PR 7) carries a card elsewhere
//   Without a Log port the rotation is refused (log-missing); at the last
//   generation 2^53 − 2 it is refused (scope-exhausted, Identity §5.4)
//
// Pure register helpers for the modules that open contexts (the encounter
// in PR 7, continuity.newTuple until then): withLabel, withPairNonce.
//
// Choices this file makes where note and spec leave them open:
//   - a device name is stored in its 6.2 canonical form (NFC applied), so
//     the register compares what the derivation uses
//   - a name the register already holds is refused (device-name-held: the
//     SHOULD of §5.5 is followed); a revoked name is refused as
//     device-name-revoked (the MUST)
//   - revoking a name already revoked is ok and changes nothing; revoking
//     a name the register does not hold is unknown-device
//   - deviceKey (holder) derives only for a held, unrevoked name and an
//     own anchor context: a label of the register or a generation of the
//     community anchor up to its head (§5.5: names recorded before any
//     derived key is presented; a revoked name offers no key for a new
//     binding). Reading it changes nothing
import type { Applied, CommandDef, DutyHandler, HolderModule, PrepareCtx, Refusal } from './engine.js'
import type { Dec, Duty, HolderState, Millis, Register, ReissueMappingDuty, Rotation, RotationDuty } from './state.js'
import { canonicalLabel, communityLabel, deviceLabel, deviceName } from './identity.js'
import type { KeyProvider, LogHead } from './ports.js'
import { jcs } from './core.js'
import type { Json } from './core.js'
import { bindingOf, rawProofValue } from './anchor.js'
import { classOnToward, entryOf, entryRelationships, lags, liveRel } from './trust/state.js'

/** The identity module's command names. */
export const IDENTITY_COMMANDS = Object.freeze({
  addDevice: 'identity.addDevice', revokeDevice: 'identity.revokeDevice', rotate: 'identity.rotate',
} as const)

/** The last generation a rotation moves to (Identity §5.4): 2^53 − 2. */
export const GENERATION_LAST = Number.MAX_SAFE_INTEGER - 1

export interface DeviceInput { name: string }

/** The register with `label` among its labels (a set: added once). */
export const withLabel = (r: Readonly<Register>, label: string): Register =>
  r.labels.includes(label) ? r as Register : { ...r, labels: [...r.labels, label] }

/** The register with a pair label and its relationship nonce (Identity
 *  §6.1): the nonce is recorded alongside the label and never changes. */
export function withPairNonce (r: Readonly<Register>, label: string, nonce: string): Register {
  if (Object.hasOwn(r.pairNonces, label)) {
    if (r.pairNonces[label] !== nonce) throw new Error(`identity: ${label} already holds another relationship nonce (§6.1)`)
    return withLabel(r, label)
  }
  return { ...withLabel(r, label), pairNonces: { ...r.pairNonces, [label]: nonce } }
}

const needName = (x: unknown, cmd: string): string => {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) throw new TypeError(`${cmd} needs an input object`)
  const n = (x as { name?: unknown }).name
  if (typeof n !== 'string') throw new TypeError(`${cmd}: name must be a string`)
  return n
}

const refuse = (code: Refusal['code'], ref?: string): Refusal => ({ ok: false, code, ...(ref ? { ref } : {}) })

const commands: Record<string, CommandDef> = {
  // §5.5: the name is persisted before any key derived from it is presented
  [IDENTITY_COMMANDS.addDevice]: {
    human: true,
    apply (state, _p, input: DeviceInput) {
      const n = deviceName(needName(input, IDENTITY_COMMANDS.addDevice))
      if (n === null) return refuse('device-name-invalid', 'Identity §6.2')
      const d = state.register.devices
      if (d.revoked.includes(n)) return refuse('device-name-revoked', 'Identity §5.5')
      if (d.names.includes(n)) return refuse('device-name-held', 'Identity §5.5')
      return {
        state: { ...state, register: { ...state.register, devices: { ...d, names: [...d.names, n] } } },
        events: [{ type: 'device.added', name: n }],
      }
    },
  } satisfies CommandDef<DeviceInput>,
  // §5.5: revocation consumes the name; the mark is never removed
  [IDENTITY_COMMANDS.revokeDevice]: {
    human: true,
    apply (state, _p, input: DeviceInput) {
      const n = deviceName(needName(input, IDENTITY_COMMANDS.revokeDevice))
      const d = state.register.devices
      if (n === null || !d.names.includes(n)) return refuse('unknown-device', 'Identity §5.5')
      if (d.revoked.includes(n)) return { state: state as HolderState }
      return {
        state: { ...state, register: { ...state.register, devices: { ...d, revoked: [...d.revoked, n] } } },
        events: [{ type: 'device.revoked', name: n }],
      }
    },
  } satisfies CommandDef<DeviceInput>,
}


// ── the rotation (Identity §5.4, Trust 6360–6420, 6596, Access §5.6) ──

/** The rotation duty's id for a rotation. */
export const rotationDutyId = (rotationId: string): string => `rotation:${rotationId}`
/** A re-issue duty's id after the rotation to generation `to` (6370). */
export const reissueId = (to: Dec, relId: string): string => `reissue:${to}:${relId}`

type RotationArtifact = { body: { type: 'anchor-rotation@2', prev: string, next: string, commit: string }, proof: { proofValue: string, successorProofValue: string } }

/** What step 2 found at the log. */
type LogOutcome =
  | { status: 'done', head: LogHead }
  | { status: 'behind' | 'diverged', head: LogHead }
  | { status: 'failure', reason: string }
  | { status: 'log-missing' }

/**
 * Step 2 through the Log port (see the header): the precondition of §5.4
 * against head(), then append(entry, head) idempotently; head-conflict
 * re-reads. A port that throws is a failure: the rotation stays pending.
 */
async function logStep (ctx: PrepareCtx, r: Readonly<Rotation>, genesis: string): Promise<LogOutcome> {
  const log = ctx.log
  if (!log) return { status: 'log-missing' }
  const rot = (r.entry as { rotation: RotationArtifact }).rotation
  const from = Number(r.from)
  try {
    for (let i = 0; i < 4; i++) {
      const head = await log.head()
      if (head.genesis !== genesis) return { status: 'diverged', head }
      let over: string | null
      if ('empty' in head) {
        if (from !== 1) return { status: 'behind', head }
        over = null
      } else if (head.next === rot.body.next) {
        // the log holds this rotation already (an append whose answer was
        // lost): the closure's append again, which the log answers exists
        over = 'empty' in r.overHead ? null : r.overHead.entryId
      } else if (head.gen === from && head.next === rot.body.prev) {
        // 5960: the head's binding admits next, or the log is no lineage of this register
        if (head.commit !== await bindingOf(rot.body.next, ctx.crypto.subtle)) return { status: 'diverged', head }
        over = head.entryId
      } else {
        return { status: head.gen < from ? 'behind' : 'diverged', head }
      }
      const a = await log.append({ rotation: rot } as unknown as Json, over)
      if (a.status === 'appended' || a.status === 'exists') return { status: 'done', head: a.head }
      if (a.status === 'failure') return { status: 'failure', reason: a.reason }
      // head-conflict: re-read and retry
    }
    return { status: 'failure', reason: 'head-conflict persisted' }
  } catch (e) {
    return { status: 'failure', reason: (e as Error)?.message ?? String(e) }
  }
}

/** 6596, per relationship: the anchor mapping class on for it (live, under
 *  its entry), and whether it lags there — then H, else null. */
function withholding (state: Readonly<HolderState>, relId: string): { contactId: string, awaitHead: string | null } | null {
  const r = state.relationships[relId]
  if (!r || !liveRel(r)) return null
  const e = entryOf(state, r)
  if (!e || !e.relIds.includes(r.id) || !classOnToward(e, 'anchorMapping')) return null
  return { contactId: e.id, awaitHead: lags(r, entryRelationships(state, e)) && e.anchorHead !== null ? e.anchorHead : null }
}

/** Step 1's commit (see the header). */
function startRotation (state: Readonly<HolderState>, p: { id: string, from: Dec, to: Dec, entry: Json, overHead: LogHead, label: string }, when: Millis): Applied | Refusal {
  const com = state.register.community
  if (com === null || com.head !== p.from || Object.keys(state.rotations).length) return refuse('in-flight')
  const awaitHead: Record<string, string | null> = {}
  for (const id of Object.keys(state.relationships).sort()) {
    const w = withholding(state, id)
    if (w) awaitHead[id] = w.awaitHead
  }
  const rotation: Rotation = { id: p.id, from: p.from, to: p.to, step: 'log', startedAt: when, entry: p.entry, overHead: p.overHead, awaitHead }
  const duty: RotationDuty = { kind: 'rotation', v: 1, id: rotationDutyId(p.id), rotationId: p.id }
  return {
    state: { ...state, register: withLabel(state.register, p.label), rotations: { ...state.rotations, [p.id]: rotation } },
    duties: [duty],
  }
}

/** The completion's commit: head, lineage, the re-issues of 6370 (6596). */
function completeRotation (state: Readonly<HolderState>, r: Readonly<Rotation>): Applied | Refusal {
  const com = state.register.community
  if (com === null || com.head !== r.from) return refuse('in-flight')
  const rot = (r.entry as { rotation: RotationArtifact }).rotation
  const duties: ReissueMappingDuty[] = []
  const reissue = (relId: string, contactId: string, awaitHead: string | null): void => {
    duties.push({ kind: 'reissue-mapping', v: 1, id: reissueId(r.to, relId), contactId, relId, awaitHead })
  }
  // decided at step 1 (6596), where the class is still on for it now
  for (const [relId, awaitHead] of Object.entries(r.awaitHead).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const w = withholding(state, relId)
    if (w) reissue(relId, w.contactId, awaitHead)
  }
  // on for it now, unknown to step 1: decided now
  for (const relId of Object.keys(state.relationships).sort()) {
    if (Object.hasOwn(r.awaitHead, relId)) continue
    const w = withholding(state, relId)
    if (w) reissue(relId, w.contactId, w.awaitHead)
  }
  const rotations = { ...state.rotations }
  delete rotations[r.id]
  const left = { ...state.duties }
  delete left[rotationDutyId(r.id)]
  return {
    state: {
      ...state,
      register: { ...withLabel(state.register, communityLabel(com.genesis, Number(r.to))), community: { ...com, head: r.to }, lineage: [...state.register.lineage, rot as unknown as Json as Register['lineage'][number]] },
      rotations,
      duties: left,
    },
    events: [{ type: 'anchor.rotated', generation: r.to }],
    duties,
  }
}

/** What step 2's outcome means for the rotation: completion, or why not. */
function afterLog (state: Readonly<HolderState>, rotationId: string, o: LogOutcome): Applied | Refusal {
  const r = Object.hasOwn(state.rotations, rotationId) ? state.rotations[rotationId] : undefined
  if (!r) return refuse('in-flight')
  switch (o.status) {
    case 'done': return completeRotation(state, r)
    case 'behind': return refuse('log-behind', 'RLTP-ACC-5980')
    case 'diverged': return refuse('log-diverged', 'RLTP-ACC-5980')
    case 'log-missing': return refuse('log-missing')
    case 'failure': return refuse('log-failure')
  }
}

type RotatePrepared =
  | { kind: 'refuse', code: Refusal['code'], ref?: string }
  | { kind: 'start', id: string, from: Dec, to: Dec, entry: Json, overHead: LogHead, label: string }
  | { kind: 'resume', rotationId: string, outcome: LogOutcome }

const rotateCommand: CommandDef<Record<string, never>, RotatePrepared> = {
  human: true,
  async prepare (ctx) {
    const st = ctx.snapshot
    const com = st.register.community
    if (com === null) return { kind: 'refuse', code: 'no-community' }
    if (!ctx.log) return { kind: 'refuse', code: 'log-missing' }
    const running = Object.values(st.rotations)[0]
    if (running) return { kind: 'resume', rotationId: running.id, outcome: await logStep(ctx, running, com.genesis) }
    const g = Number(com.head)
    if (!Number.isSafeInteger(g) || g < 1 || g + 1 > GENERATION_LAST) return { kind: 'refuse', code: 'scope-exhausted', ref: 'Identity §5.4' }
    const [prevL, nextL, afterL] = [g, g + 1, g + 2].map((k) => communityLabel(com.genesis, k))
    const [prev, next, after] = await Promise.all([prevL, nextL, afterL].map((l) => ctx.keys.anchorOf(l)))
    const body = { type: 'anchor-rotation@2' as const, prev: prev.anchor, next: next.anchor, commit: await bindingOf(after.anchor, ctx.crypto.subtle) }
    const bytes = new TextEncoder().encode(jcs(body))
    const rotation: RotationArtifact = {
      body,
      proof: { proofValue: rawProofValue(await ctx.keys.sign(prevL, bytes)), successorProofValue: rawProofValue(await ctx.keys.sign(nextL, bytes)) },
    }
    const overHead = await ctx.log.head()
    const to = String(g + 1)
    return { kind: 'start', id: to, from: com.head, to, entry: { rotation } as unknown as Json, overHead, label: nextL }
  },
  apply (state, prepared, _input, when) {
    const p = prepared.value
    if (p.kind === 'refuse') return refuse(p.code, p.ref)
    if (p.kind === 'start') return startRotation(state, p, when)
    return afterLog(state, p.rotationId, p.outcome)
  },
}

/** The rotation duty (rotation/1): step 2 on resume. */
const rotationDuty: DutyHandler<LogOutcome | null> = {
  v: 1,
  async prepare (ctx, duty) {
    const r = ctx.snapshot.rotations[(duty as RotationDuty).rotationId]
    const com = ctx.snapshot.register.community
    return r && com ? logStep(ctx, r, com.genesis) : null
  },
  apply (state, duty, ctx, when) {
    const d = duty as RotationDuty
    // a rotation completed (by the act) or gone: nothing left to do
    if (!Object.hasOwn(state.rotations, d.rotationId)) return { state: state as HolderState }
    const o = ctx.prepared.value
    if (o === null) return 'not-due'
    if (o.status === 'failure') {
      // pending, due again after the retry backoff (the duty's own attempt)
      const attempt = (d.attempt ?? 0) + 1
      const again: RotationDuty = { ...d, attempt, lastAt: when, dueAt: Math.min(when + Math.max(0, Math.ceil(ctx.backoff(attempt))), Number.MAX_SAFE_INTEGER) }
      return { state: state as HolderState, duties: [again] }
    }
    return afterLog(state, d.rotationId, o)
  },
}

/** A device key as deviceKey derives it: the device label, the device's
 *  did:key and its key-agreement multikey (Identity §5.5). */
export type DeviceKeyResult =
  | { ok: true, label: string, device: string, keyAgreement: string }
  | { ok: false, code: 'unknown-device' | 'device-revoked' | 'unknown-context' }

/** Whether `label` names an own anchor context: a label of the register,
 *  or a generation of the community anchor up to its head (§5.4). */
function ownContext (state: Readonly<HolderState>, label: string): boolean {
  if (label.startsWith('device/')) return false
  if (state.register.labels.includes(label)) return true
  const c = state.register.community
  if (c === null) return false
  const base = communityLabel(c.genesis, 1)
  if (label === base) return true
  if (!label.startsWith(base + '/')) return false
  const g = BigInt(label.slice(base.length + 1))
  return g >= 2n && g <= BigInt(c.head)
}

/**
 * The device key of a held, unrevoked device name under an own anchor
 * context (Identity §5.5): derived through the KeyProvider, never stored
 * (keys are not state, 9.3).
 */
export async function deviceKeyOf (state: Readonly<HolderState>, keys: KeyProvider, name: string, contextLabel: string): Promise<DeviceKeyResult> {
  const n = deviceName(name)
  const d = state.register.devices
  if (n === null || !d.names.includes(n)) return { ok: false, code: 'unknown-device' }
  if (d.revoked.includes(n)) return { ok: false, code: 'device-revoked' }
  const a = canonicalLabel(contextLabel)
  if (a === null || !ownContext(state, a)) return { ok: false, code: 'unknown-context' }
  const label = await deviceLabel(n, a)
  const k = await keys.anchorOf(label)
  return { ok: true, label, device: k.anchor, keyAgreement: k.keyAgreement }
}

/** The identity module createHolder builds in (see the header). */
export function identityModule (): HolderModule {
  return Object.freeze({
    name: 'identity',
    commands: Object.freeze({ ...commands, [IDENTITY_COMMANDS.rotate]: rotateCommand }),
    duties: Object.freeze({ rotation: rotationDuty }),
  })
}
