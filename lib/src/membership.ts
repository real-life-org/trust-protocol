// membership — the pure forms and checks of Membership Tasks 0.20 (the
// prelude, the invite, the accept, the evidence relay) and of the vouch@2 credential
// (Access 0.57 5.3), used by the holder's membership module
// (membership/holder.ts). State-free: which invitation a holder sent,
// which group it is in, are the module's.
import { b64uOf, calOK, fromB64u, jcs, makeValidator, sameDigest, toU, tsec } from './core.js'
import { diVerify } from './crypto.js'
import { SCHEMAS } from './schemas.js'

const TT = 'https://real-life.org/trust-tasks/'
export const INVITE_TYPE = TT + 'membership-invite/0.2'
export const ACCEPT_TYPE = TT + 'membership-accept/0.2'
export const EVIDENCE_TYPE = TT + 'membership-evidence/0.2'
/** accepted under the same rules, never issued (RLTP-MT-3815) */
export const EVIDENCE_TYPE_01 = TT + 'membership-evidence/0.1'
/** The prelude (Membership 3.5): the inviter's request and the invitee's reply. */
export const PRELUDE_REQUEST_TYPE = TT + 'membership-prelude-request/0.1'
export const PRELUDE_REPLY_TYPE = TT + 'membership-prelude-reply/0.1'
/** The inviter binding's artifact type (RLTP-MT-3905). */
export const INVITER_BINDING_TYPE = 'membership-inviter@1'

/** membership-skew, PT5M (Membership §5, RLTP-MT-5050), in ms. */
export const MEMBERSHIP_SKEW = 300_000
/** The membership size budget: JCS bytes of an invite or accept document (2.5). */
export const MEMBERSHIP_BUDGET = 16_384
/** The pinned credential contexts of the invite and the vouch (RLTP-MT-3015). */
export const MEMBERSHIP_CONTEXT: readonly string[] = Object.freeze([
  'https://www.w3.org/ns/credentials/v2', 'https://firstperson.network/credentials/dtg/v1', 'https://real-life.org/rltp/v1',
])

const V = makeValidator(SCHEMAS)
export const membershipSchemaOk = (file: string, data: unknown): boolean => V.validate(data, SCHEMAS[file], SCHEMAS[file]).length === 0
const te = new TextEncoder()
/** Within the membership size budget (2.5, RLTP-MT-2200)? */
export const withinBudget = (doc: unknown): boolean => te.encode(jcs(doc)).length <= MEMBERSHIP_BUDGET

/** The `oid:` form of a sha2-256 multihash digest (Access 3.3, RLTP-ACC-
 *  3100): the same SHA-256, unpadded base64url — the genesis digest and
 *  its operation id name one operation. null for anything else. */
export const oidOf = (digest: unknown): string | null => {
  const u = toU(digest)
  if (u === null) return null
  const mh = fromB64u(u.slice(1))
  return mh.length === 34 && mh[0] === 0x12 && mh[1] === 0x20 ? 'oid:' + b64uOf(mh.subarray(2)) : null
}

/** The member context label for a group, from its genesis digest:
 *  canonical-u re-encoding before the label (Access 5.1, RLTP-MT-3030);
 *  null for a digest that does not decode. */
export const memberLabelOf = (genesisDigest: unknown): string | null => {
  const u = toU(genesisDigest)
  return u === null ? null : 'group/' + u
}

/** An enclosed card's profile (Membership 2.6): the displayed form, its
 *  proof under its anchor, no sentTo, boundTo or deliveryHints. */
export async function enclosedCardOk (card: any, anchor: string, subtle?: SubtleCrypto): Promise<boolean> {
  if (!membershipSchemaOk('contact-card.schema.json', card)) return false
  if (card.anchor !== anchor) return false
  if ('sentTo' in card || 'boundTo' in card || 'deliveryHints' in card) return false
  return diVerify(card, anchor, subtle)
}

/** The unsigned InvitationCredential (Membership 3.1, RLTP-MT-3010–3070). */
export const inviteCredentialBody = (f: {
  issuer: string, invitee: string, group: string, genesisDigest: string, card: unknown, name?: string,
  validFrom: string, validUntil: string, taskContext: string,
}) => ({
  '@context': [...MEMBERSHIP_CONTEXT],
  type: ['VerifiableCredential', 'DTGCredential', 'InvitationCredential', 'MembershipInvite'],
  issuer: f.issuer,
  credentialSubject: { id: f.invitee, group: f.group, genesisDigest: f.genesisDigest, card: f.card, ...(f.name !== undefined ? { name: f.name } : {}) },
  validFrom: f.validFrom, validUntil: f.validUntil, taskContext: f.taskContext,
})

/** The invite document's checks at its recipient (Membership 3.1, 2.4,
 *  2.5), past its payload schema: the credential's proof under its
 *  issuer, the document bindings, the card's ownership and profile, the
 *  validity dates, no enactment, the budget. The prelude check (3030)
 *  needs the recipient's own derivation and stays the caller's. null when
 *  they pass, else the rule. */
export async function inviteProblem (doc: any, subtle?: SubtleCrypto): Promise<string | null> {
  const inv = doc.payload.invite
  if (!withinBudget(doc)) return 'RLTP-MT-2210'
  if (doc.ceremony?.enactment !== undefined) return 'RLTP-MT-2170'
  if (inv.issuer !== doc.issuer) return 'RLTP-MT-3020'
  if (inv.credentialSubject.id !== doc.recipient) return 'RLTP-MT-3025'
  if (inv.taskContext !== doc.threadId) return 'RLTP-MT-3075'
  if (![inv.validFrom, inv.validUntil, inv.proof?.created].every(calOK) || tsec(inv.validUntil) < tsec(inv.validFrom)) return 'RLTP-MT-3055'
  if (!(await diVerify(inv, inv.issuer, subtle))) return 'RLTP-MT-3070'
  if (!(await enclosedCardOk(inv.credentialSubject.card, inv.issuer, subtle))) return 'RLTP-MT-3050'
  return null
}

/** The accept's checks against the invite it answers (RLTP-MT-3270),
 *  past its schema and the document proof's presence: the proof under the
 *  issuer, issuer = subject = the invite's subject, ref = the invite's
 *  credential digest, the group, the card, the times, the budget. */
export async function acceptProblem (doc: any, invite: any, credDigest: string, subtle?: SubtleCrypto): Promise<string | null> {
  const acc = doc.payload.accept
  const inv = invite.payload.invite
  if (!withinBudget(doc)) return 'RLTP-MT-2210'
  if (doc.proof?.verificationMethod?.split('#')[0] !== doc.issuer) return 'RLTP-MT-2140'
  if (acc.subject !== doc.issuer) return 'RLTP-MT-3220'
  if (acc.subject !== inv.credentialSubject.id) return 'RLTP-MT-3225'
  if (!sameDigest(acc.ref, credDigest)) return 'RLTP-MT-3230'
  if (acc.group !== inv.credentialSubject.group) return 'RLTP-MT-3215'
  if (doc.threadId !== invite.threadId || doc.recipient !== inv.issuer) return 'RLTP-MT-3255'
  if (![doc.issuedAt, doc.proof?.created].every(calOK)) return 'RLTP-MT-3270'
  const last = tsec(inv.validUntil) + MEMBERSHIP_SKEW
  if (tsec(doc.issuedAt) > last || tsec(doc.proof.created) > last) return 'RLTP-MT-3270'
  if (!(await diVerify(doc, doc.issuer, subtle))) return 'RLTP-MT-2130'
  if (!(await enclosedCardOk(acc.card, acc.subject, subtle))) return 'RLTP-MT-3240'
  return null
}

/** The unsigned vouch@2 (Access 5.3): one member for one consented admission. */
export const vouchCredentialBody = (f: { issuer: string, subject: string, genesisDigest: string, accept: string, provenance: 'met' | 'introduced', validFrom: string }) => ({
  '@context': [...MEMBERSHIP_CONTEXT],
  type: ['VerifiableCredential', 'DTGCredential', 'EndorsementCredential', 'AdmissionVouch'],
  issuer: f.issuer,
  validFrom: f.validFrom,
  credentialSubject: { id: f.subject, endorsement: { type: 'AdmissionVouch', genesisDigest: toU(f.genesisDigest), accept: toU(f.accept), provenance: f.provenance } },
})

/** A vouch's checks for one enclosed pair (RLTP-MT-3810): schema, proof
 *  under its issuer, subject, accept and genesis bindings. */
export async function vouchProblem (vouch: any, acceptSubject: string, acceptDigest: string, genesisDigest: string, subtle?: SubtleCrypto): Promise<string | null> {
  if (!membershipSchemaOk('access-vouch.schema.json', vouch)) return 'RLTP-MT-3810'
  const e = vouch.credentialSubject.endorsement
  if (vouch.credentialSubject.id !== acceptSubject || !sameDigest(e.accept, acceptDigest) || !sameDigest(e.genesisDigest, genesisDigest)) return 'RLTP-MT-3810'
  if (!(await diVerify(vouch, vouch.issuer, subtle))) return 'RLTP-MT-3810'
  return null
}

/** The evidence pair's checks (RLTP-MT-3725), past the payload schema. */
export async function evidenceProblem (invite: any, accept: any, credDigest: string, subtle?: SubtleCrypto): Promise<string | null> {
  const inv = invite.payload.invite
  if (inv.issuer !== invite.issuer || invite.recipient !== inv.credentialSubject.id) return 'RLTP-MT-3725'
  if (invite.threadId !== inv.taskContext || accept.threadId !== invite.threadId) return 'RLTP-MT-3725'
  if (![inv.validFrom, inv.validUntil].every(calOK) || tsec(inv.validUntil) < tsec(inv.validFrom)) return 'RLTP-MT-3725'
  if (!(await diVerify(inv, inv.issuer, subtle))) return 'RLTP-MT-3725'
  if (!(await enclosedCardOk(inv.credentialSubject.card, inv.issuer, subtle))) return 'RLTP-MT-3725'
  return (await acceptProblem(accept, invite, credDigest, subtle)) === null ? null : 'RLTP-MT-3725'
}

/** The unsigned inviter binding `membership-inviter@1` (RLTP-MT-3905):
 *  the inviter's member anchor, the group's genesis digest, and the
 *  request document's threadId, issuer (from) and recipient (to). */
export const inviterBindingBody = (f: { inviter: string, genesisDigest: string, threadId: string, from: string, to: string }) => ({
  type: INVITER_BINDING_TYPE, inviter: f.inviter, genesisDigest: f.genesisDigest, threadId: f.threadId, from: f.from, to: f.to,
})

/** Why a prelude request fails its form (Membership 3.5), the vector
 *  cases' `fails` names: the payload schema, the document proof under its
 *  issuer (RLTP-MT-3900), the binding's fields against the payload and the
 *  document, genesis digests compared by their decoded bytes
 *  (RLTP-MT-3905), and the binding proof under its `inviter`. The tuple
 *  checks of RLTP-MT-3910 (issuer and recipient the arrival tuple's pair
 *  anchors) need holder state and stay the caller's. null when it passes. */
export type PreludeRequestProblem = 'schema' | 'documentProof' | 'bindingFields' | 'bindingProof'
export async function preludeRequestProblem (doc: any, subtle?: SubtleCrypto): Promise<PreludeRequestProblem | null> {
  if (!membershipSchemaOk('payload-membership-prelude-request.schema.json', doc?.payload)) return 'schema'
  if (!(await diVerify(doc, doc.issuer, subtle))) return 'documentProof'
  const p = doc.payload, b = p.binding
  if (b.inviter !== p.inviter || !sameDigest(b.genesisDigest, p.genesisDigest) || b.threadId !== doc.threadId || b.from !== doc.issuer || b.to !== doc.recipient) return 'bindingFields'
  if (!(await diVerify(b, b.inviter, subtle))) return 'bindingProof'
  return null
}
