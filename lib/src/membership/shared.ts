// membership/shared — what the membership module's parts share: refusals,
// sealing a document for the outbox, and the channels of a holder (the
// live tuple toward a contact, the tuple a document arrived on).
import type { Json } from '../core.js'
import { diSignWith, digestDoc } from '../crypto.js'
import { seal } from '../delivery.js'
import { tupleByRkid } from '../receive.js'
import type { TaskRefusal } from '../receive.js'
import type { OutboundDraft, PrepareCtx, Refusal } from '../engine.js'
import type { Recipient } from '../ports.js'
import type { HolderState } from '../state.js'
import { entryOf, findContact, liveRel, activeTuple } from '../trust/state.js'

export type Doc = Record<string, any>

export const refuse = (reason: TaskRefusal['reason'], ref?: string): TaskRefusal => ({ ok: false, reason, ...(ref ? { ref } : {}) })
export const no = (code: Refusal['code'], ref?: string): Refusal => ({ ok: false, code, ...(ref ? { ref } : {}) })
export const isRefusal = (x: unknown): x is Refusal | TaskRefusal => (x as Refusal)?.ok === false

const sealWith = (ctx: PrepareCtx, doc: unknown, keyAgreement: string) =>
  seal(doc as Json, keyAgreement, { ephSeed: ctx.entropy.bytes('seal.eph', 32), nonce: ctx.entropy.bytes('seal.nonce', 12) }, ctx.crypto.subtle)
export const signer = (ctx: PrepareCtx, label: string) => (b: Uint8Array) => ctx.keys.sign(label, b)
export const signDoc = async <T extends Record<string, any>> (ctx: PrepareCtx, label: string, anchor: string, doc: T, at: string) =>
  diSignWith(anchor, signer(ctx, label), doc, at, ctx.crypto.subtle)

/** A sealed document ready for the outbox. */
export interface Sealed { digest: string, envelope: OutboundDraft['envelope'], threadId: string, type: string, recipient: Recipient }
export const draft = (s: Sealed): OutboundDraft => ({ digest: s.digest, envelope: s.envelope, type: s.type, threadId: s.threadId, recipient: s.recipient })

export async function sealed (ctx: PrepareCtx, doc: Doc, recipient: Recipient): Promise<Sealed> {
  return { digest: await digestDoc(doc, ctx.crypto.subtle), envelope: await sealWith(ctx, doc, recipient.keyAgreement), threadId: doc.threadId, type: doc.type, recipient }
}

/** The own key-agreement id a label derives under, from `addresses`. */
export const rkidOf = (state: Readonly<HolderState>, label: string): string | undefined =>
  Object.entries(state.addresses.keys).find(([, k]) => k.label === label)?.[0]

/** The live active tuple toward a contact, with its relationship. */
export function channelTo (state: Readonly<HolderState>, contactId: string) {
  const c = findContact(state, contactId)
  if (!c) return null
  const ids = new Set([c.id, ...c.aliases])
  for (const id of c.relIds) {
    const r = state.relationships[id]
    const t = r && liveRel(r) ? activeTuple(r) : undefined
    if (t && !t.deactivated && ids.has(t.entryId)) return { contact: c, rel: r, tuple: t }
  }
  return null
}

/** The arrival tuple's own label and the entry it feeds. */
export function arrival (state: Readonly<HolderState>, rkid: string) {
  const at = tupleByRkid(state, rkid)
  return at ? { label: at.tuple.ownPairLabel, contactId: entryOf(state, at.rel)?.id ?? findContact(state, at.rel.contactId)?.id ?? at.rel.contactId, tuple: at.tuple, rel: at.rel } : null
}
