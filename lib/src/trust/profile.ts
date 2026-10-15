// trust/profile — profile@1 on the holder (lib Stage 2, PR 6; Trust Layer
// 0.31 §6b): the human act that sets the own profile, its delivery on the
// class and follow-up gates of Section 2a (trust/duties.ts), and its
// reception. The wire (k_pr, MAC, bounds, the picture's header) is
// profile.ts. Wired into the trust module (trust/mapping.ts), like the
// continuity parts.
//
// Rule numbers: bare four-digit numbers are RLTP-TRU (trust-layer.md).
//
//   command  profile.set {name, image?, text?}   the own profile; human
//              (holder.setProfile): validated against 6430/6435 and the
//              picture's header (6475) before anything commits, the one
//              counter takes its next value (6450), state.profile holds the
//              content and the revision in one step (6300), and a profile/1
//              duty opens on every relationship the class is on for (6455)
//   duties   profile/1 (6455) and class-on/1 of the profile class (2850,
//              6465): issue the current profile@1 on one relationship
//   task     profile/0.1 (proof absent, 6495): conditions in the
//              preparation (stage 8), the revision rule in apply (stage 9)
//
// Choices this file makes where note and spec leave them open:
//   - state.profile.body is the content {name, image?, text?}; the wire body
//     adds type and the revision. Setting the content the profile already
//     has is ok and changes nothing: no revision, no delivery
//   - a profile duty carries the revision that opened it; whichever profile
//     duty runs issues the current profile (the newest content), so an older
//     duty never sends an older revision. One issuance on a relationship
//     meets every profile and profile class-on duty owed there
//   - the tuple keeps the revision last issued in its scope (profileOut,
//     6300); a class turning on again sends the current revision once more,
//     which the receiver takes as a repeat (6270)
//   - a duty whose relationship lags, is gone, or whose class is off is
//     fulfilled without sending (6455: not on a lagging relationship; the
//     follow rule opens a class-on duty once it ceases to lag, 2850)
//   - 6480: the document is checked against the 65 536-byte plaintext
//     limit before sealing; one over it is refused (profile-invalid), which
//     the bounds of 6435 make unreachable for a valid body
//   - reception: the schema at stage 7 (6430), then at stage 8 the arrival
//     tuple as an active head (6190, 6461), the issuer as its counterpart,
//     the picture's header (6475, before any decoding and before the MAC is
//     computed), the MAC under k_pr (6440); at stage 9 the revision rule
//     within the tuple's scope (6270, 6460): a higher revision replaces the
//     held one (verifiedSeq: this commit), an equal identical body is a
//     repeat (acked, nothing changes), an equal different body and a lower
//     revision are failed(validation-failed). profile.updated names the
//     entry the relationship's verifications go to
//   - re-encoding the picture without metadata (6445) and showing only its
//     pixels (6485) are the app's: the library reads headers only
import { iso, jcs } from '../core.js'
import type { Json } from '../core.js'
import { digestDoc, xRawOfMk } from '../crypto.js'
import { seal } from '../delivery.js'
import { PLAINTEXT_MAX } from '../star.js'
import { PROFILE_TYPE, assembleProfile, profileMacOk, profileProblem, profileSchemaOk } from '../profile.js'
import type { ProfileArtifact, ProfileBody, ProfileContent } from '../profile.js'
import { tupleByRkid } from '../receive.js'
import type { Arrival, ReceivedDocument, TaskRefusal } from '../receive.js'
import type { Applied, CommandDef, DutyHandler, OutboundDraft, PrepareCtx, Refusal, TaskHandler } from '../engine.js'
import type { ClassOnDuty, Dec, Duty, HolderState, ProfileDuty, Relationship, Tuple } from '../state.js'
import { ADMISSION_BOUND, activeTuple, entryOf, findContact } from './state.js'
import { onFor, owedOn, profileDutyId } from './duties.js'

/** The profile module's command name. */
export const PROFILE_SET = 'profile.set'

const te = new TextEncoder()
const inc = (d: Dec): Dec => (BigInt(d) + 1n).toString()
/** A placeholder mac of the schema's form, to validate a body before it has one. */
const NO_MAC = 'u' + 'A'.repeat(43)

/** The content as the act takes it: exactly name, image?, text? (6430). */
function contentOf (x: unknown): ProfileContent {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) throw new TypeError(`${PROFILE_SET} needs an input object`)
  const i = x as Record<string, unknown>
  const out: ProfileContent = { name: i.name as string }
  if (i.image !== undefined) out.image = i.image as string
  if (i.text !== undefined) out.text = i.text as string
  return out
}

const bodyOf = (content: Json, revision: Dec): ProfileBody => ({ ...(content as unknown as ProfileContent), type: 'profile@1', revision })

// ── the act ────────────────────────────────────────────────────────────

/** profile/1 on every live relationship the class is on for (6455): the
 *  duty of each, at `rev`, replacing an older one. */
function profileDuties (state: HolderState, rev: Dec): HolderState {
  const duties = { ...state.duties }
  for (const id of Object.keys(state.relationships).sort()) {
    const r = state.relationships[id]
    if (!onFor(state, r, 'profile')) continue
    const d: ProfileDuty = { kind: 'profile', v: 1, id: profileDutyId(id), contactId: entryOf(state, r)!.id, relId: id, rev }
    duties[d.id] = d
  }
  return { ...state, duties }
}

const setCommand: CommandDef<ProfileContent> = {
  human: true,
  apply (state, _p, input) {
    const content = contentOf(input)
    const revision = inc(state.profile.revision)
    // 6430, 6435, 6475 before anything commits
    const problem = profileProblem({ body: bodyOf(content as unknown as Json, revision), proof: { mac: NO_MAC } })
    if (problem !== null) return { ok: false, code: 'profile-invalid', ref: problem } satisfies Refusal
    if (state.profile.body !== null && jcs(state.profile.body) === jcs(content)) return { state: state as HolderState }
    if (BigInt(revision) > ADMISSION_BOUND) return { ok: false, code: 'scope-exhausted', ref: 'RLTP-TRU-6310' }
    const next: HolderState = { ...state, profile: { body: content as unknown as Json, revision } }
    return { state: profileDuties(next, revision), events: [{ type: 'profile.updated', contactId: null }] }
  },
}

// ── issuance (6455) ────────────────────────────────────────────────────

/** Whether the profile can go out on `relId` toward `contactId` now: the
 *  relationship there, the class on for it (live, not lagging), a profile. */
function issuable (state: Readonly<HolderState>, contactId: string, relId: string): { rel: Relationship, tuple: Tuple, contactId: string } | null {
  const c = findContact(state, contactId)
  const rel = Object.hasOwn(state.relationships, relId) ? state.relationships[relId] : undefined
  if (!c || !rel || rel.chainedInto !== null || !c.relIds.includes(rel.id) || entryOf(state, rel)?.id !== c.id) return null
  if (state.profile.body === null || !onFor(state, rel, 'profile')) return null
  const tuple = activeTuple(rel)
  return tuple && !tuple.deactivated ? { rel, tuple, contactId: c.id } : null
}

interface Issue { relId: string, tuple: string, rev: Dec, outbound: OutboundDraft }

async function prepareIssue (ctx: PrepareCtx, duty: Duty): Promise<Issue | null> {
  const d = duty as ProfileDuty | ClassOnDuty
  const st = ctx.snapshot
  const at = issuable(st, d.contactId, d.relId)
  if (!at) return null
  const t = at.tuple
  const theirX = xRawOfMk(t.counterpartKeyAgreement)
  if (!theirX) return null
  const sh = await ctx.keys.agree(t.rkid, theirX, ctx.release)
  if (sh.status !== 'available') return null
  const S = ctx.crypto.subtle
  const own = await ctx.keys.anchorOf(t.ownPairLabel)
  const artifact = await assembleProfile(bodyOf(st.profile.body!, st.profile.revision), sh.shared, own.anchor, t.counterpartAnchor, S)
  const threadId = ctx.entropy.id('thread.id')
  const doc = {
    id: ctx.entropy.id('doc.id'), type: PROFILE_TYPE, issuer: own.anchor, recipient: t.counterpartAnchor,
    threadId, issuedAt: iso(ctx.when), payload: artifact as unknown as Json,
  }
  // 6480: one unchunked document within the plaintext limit
  if (te.encode(jcs(doc)).length > PLAINTEXT_MAX) return null
  const envelope = await seal(doc, t.counterpartKeyAgreement, { ephSeed: ctx.entropy.bytes('seal.eph', 32), nonce: ctx.entropy.bytes('seal.nonce', 12) }, S)
  return {
    relId: at.rel.id, tuple: t.ownPairLabel, rev: st.profile.revision,
    outbound: { digest: await digestDoc(doc, S), envelope, type: PROFILE_TYPE, threadId, recipient: { contactId: at.contactId, rkid: t.rkid, keyAgreement: t.counterpartKeyAgreement } },
  }
}

/** The issuance's commit: the scope's revision (6300) and every profile
 *  duty owed on the relationship met by this one delivery. */
function commitIssue (state: Readonly<HolderState>, p: Issue): Applied {
  const rel = state.relationships[p.relId]
  const tuples = rel.tuples.map((t) => (t.ownPairLabel === p.tuple && BigInt(p.rev) > BigInt(t.profileOut.rev) ? { ...t, profileOut: { rev: p.rev } } : t))
  const duties: Record<string, Duty> = {}
  for (const [id, d] of Object.entries(state.duties)) if (!owedOn(d, p.relId, 'profile')) duties[id] = d
  return { state: { ...state, relationships: { ...state.relationships, [rel.id]: { ...rel, tuples } }, duties }, outbound: [p.outbound] }
}

/** profile/1 and class-on/1 of the profile class (through classOnHandler). */
export const profileIssueDuty: DutyHandler<Issue | null> = {
  v: 1,
  prepare: (ctx, duty) => prepareIssue(ctx, duty),
  apply (state, duty, ctx) {
    const d = duty as ProfileDuty | ClassOnDuty
    const at = issuable(state, d.contactId, d.relId)
    if (!at) return { state: state as HolderState }                         // off, gone, lagging, no profile: nothing owed
    const p = ctx.prepared.value
    if (p === null) return { ok: false, code: 'no-own-channel', ref: 'RLTP-TRU-6440' }
    if (p.rev !== state.profile.revision || p.tuple !== at.tuple.ownPairLabel) return 'not-due'
    return commitIssue(state, p)
  },
}

// ── reception (6b.2, 6b.3) ─────────────────────────────────────────────

const refuse = (reason: TaskRefusal['reason'], ref?: string): TaskRefusal => ({ ok: false, reason, ...(ref ? { ref } : {}) })

/** The arrival tuple, if it is the active head of a live relationship (6190, 6461). */
const arrivalTuple = (state: Readonly<HolderState>, rkid: string): { rel: Relationship, tuple: Tuple } | null => {
  const at = tupleByRkid(state, rkid)
  if (!at || at.tuple.deactivated || at.rel.chainedInto !== null || at.rel.activeHead !== at.tuple.ownPairLabel) return null
  return at
}

export const profileTask: TaskHandler<ProfileArtifact, null> = {
  proof: 'absent',
  // stage 7: the closed body and proof with their bounds (6430, 6435)
  decode: (payload) => (profileSchemaOk(payload) ? payload as ProfileArtifact : refuse('malformed', 'RLTP-TRU-6430')),
  // stage 8: the arrival tuple, the picture's header, the MAC
  async prepare (ctx, doc: ReceivedDocument<ProfileArtifact>, arrival: Arrival) {
    if ((doc.ceremony as { enactment?: unknown } | undefined)?.enactment !== undefined) return refuse('validation-failed')
    const at = arrivalTuple(ctx.snapshot, arrival.rkid)
    if (!at) return refuse('validation-failed', 'RLTP-TRU-6190')
    if (doc.issuer !== at.tuple.counterpartAnchor) return refuse('validation-failed', 'RLTP-TRU-6440')
    const problem = profileProblem(doc.payload)
    if (problem !== null) return refuse('validation-failed', problem)
    const theirX = xRawOfMk(at.tuple.counterpartKeyAgreement)
    if (!theirX) return refuse('validation-failed', 'RLTP-TRU-6440')
    const sh = await ctx.keys.agree(at.tuple.rkid, theirX, ctx.release)
    if (sh.status !== 'available') return refuse('validation-failed', 'RLTP-TRU-6440')
    const own = await ctx.keys.anchorOf(at.tuple.ownPairLabel)
    if (!(await profileMacOk(doc.payload, sh.shared, at.tuple.counterpartAnchor, own.anchor, ctx.crypto.subtle))) return refuse('validation-failed', 'RLTP-TRU-6440')
    return null
  },
  // stage 9: the revision rule within the tuple's scope (6270, 6460)
  apply (state, _p, doc: ReceivedDocument<ProfileArtifact>, arrival: Arrival) {
    const at = arrivalTuple(state, arrival.rkid)
    if (!at) return refuse('validation-failed', 'RLTP-TRU-6190')
    const { rel, tuple: t } = at
    const b = doc.payload.body
    const rev = BigInt(b.revision), cur = BigInt(t.profileIn.rev)
    if (rev === cur) {
      if (t.profileIn.body === null || jcs(b) !== jcs(t.profileIn.body)) return refuse('validation-failed', 'RLTP-TRU-6270')
      return { state: state as HolderState }                              // a repeat
    }
    if (rev < cur) return refuse('validation-failed', 'RLTP-TRU-6460')
    const tuples = rel.tuples.map((x) => (x.ownPairLabel === t.ownPairLabel
      ? { ...x, profileIn: { rev: b.revision, body: b as unknown as Json, verifiedSeq: inc(state.commitSeq) } }
      : x))
    return {
      state: { ...state, relationships: { ...state.relationships, [rel.id]: { ...rel, tuples } } },
      events: [{ type: 'profile.updated', contactId: entryOf(state, rel)?.id ?? rel.contactId }],
    }
  },
}

/** What the trust module registers for the profile. */
export const profileParts = Object.freeze({
  commands: Object.freeze({ [PROFILE_SET]: setCommand }),
  tasks: Object.freeze({ [PROFILE_TYPE]: profileTask }),
})
