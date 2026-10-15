// pair-fixture — two holders that share one relationship tuple, for the
// receive, duty, retention and trust tests (lib Stage 2, PR 3, PR 4a).
// Real keys from seedKeys, states from stateBuilder; a fake
// designated-verifier task type `test-note/0.1` with a module that sends
// and receives it.
import { seedKeys, digestBytes, digestDoc, seal, iso } from '../dist/index.js'
import { createHolder } from '../dist/index.js'
import { InMemoryStore, stateBuilder, emptyTuple } from '../dist/testing.js'

export const NOTE = 'https://real-life.org/trust-tasks/test-note/0.1'
export const T0 = Date.parse('2026-10-15T09:00:00Z')
export const DAY = 86_400_000

export const tupleOf = ({ label, counterpartAnchor, counterpartKeyAgreement, rkid, entryId }) =>
  emptyTuple({ ownPairLabel: label, counterpartAnchor, counterpartKeyAgreement, rkid, entryId })

/** One side: its keys, pair label, pair anchor and key agreement. */
export async function side (fill, nonceFill) {
  const keys = seedKeys(new Uint8Array(64).fill(fill))
  const label = 'pair/' + await digestBytes(new Uint8Array(32).fill(nonceFill))
  const { anchor, keyAgreement } = await keys.anchorOf(label)
  return { keys, label, anchor, keyAgreement }
}

/** The builder of `me` holding one relationship `rel` toward `them`, its
 *  entry committed at position 0; `address`: 'live', 'tombstone' or 'none'. */
export function builderOf (me, them, { rel = 'r1', contact = 'c1', lastShown = T0, address = 'live' } = {}) {
  return stateBuilder({ at: T0 })
    .relationship(rel, { contactId: contact, tuples: [{ ownPairLabel: me.label, counterpartAnchor: them.anchor, counterpartKeyAgreement: them.keyAgreement, rkid: me.keyAgreement }] })
    .entry(contact)
    .with((s) => {
      delete s.addresses.keys[me.keyAgreement]
      if (address === 'live') s.addresses.keys[me.keyAgreement] = { label: me.label, lastShown }
      if (address === 'tombstone') s.addresses.tombstones = [me.keyAgreement]
    })
}

/** The state of `me` holding one relationship `rel` toward `them`. */
export const stateOf = (me, them, opts = {}) => builderOf(me, them, opts).build()

/**
 * The note module: `note.send` seals a test-note on relationship r1
 * (`override` replaces document fields, `payload` the payload); the task
 * handler records the note in encounter.records under the document id.
 * `seen` collects what the handler got.
 */
export const noteModule = (seen = {}) => ({
  name: 'note',
  commands: {
    'note.send': {
      human: false,
      async prepare (ctx, input) {
        const rel = ctx.snapshot.relationships[input.rel ?? 'r1']
        const t = rel.tuples[rel.tuples.length - 1]
        const own = await ctx.keys.anchorOf(t.ownPairLabel)
        const threadId = ctx.entropy.id('thread.id')
        const doc = {
          id: ctx.entropy.id('doc.id'), type: NOTE, issuer: own.anchor, recipient: t.counterpartAnchor,
          threadId, issuedAt: iso(ctx.when), payload: input.payload ?? { text: input.text ?? 'hello' },
          ...(input.override ?? {}),
        }
        for (const k of input.drop ?? []) delete doc[k]
        const S = ctx.crypto.subtle
        const envelope = await seal(doc, t.counterpartKeyAgreement, { ephSeed: ctx.entropy.bytes('seal.eph', 32), nonce: ctx.entropy.bytes('seal.nonce', 12) }, S)
        return { digest: await digestDoc(doc, S), envelope, type: NOTE, threadId, contactId: rel.contactId, rkid: t.rkid, keyAgreement: t.counterpartKeyAgreement }
      },
      apply (state, p) {
        const v = p.value
        return { state, outbound: [{ digest: v.digest, envelope: v.envelope, type: v.type, threadId: v.threadId, recipient: { contactId: v.contactId, rkid: v.rkid, keyAgreement: v.keyAgreement } }] }
      },
    },
  },
  tasks: {
    [NOTE]: {
      proof: 'absent',
      decode (payload) {
        if (payload && typeof payload.text === 'string' && Object.keys(payload).length === 1) return { text: payload.text }
        return { ok: false, reason: payload?.text === undefined ? 'malformed' : 'validation-failed' }
      },
      apply (state, prepared, doc, arrival) {
        seen.doc = doc; seen.arrival = arrival
        if (doc.payload.text === 'refuse') return { ok: false, reason: 'validation-failed' }
        if (doc.payload.text === 'cache') return { state: { ...state, effects: { ...state.effects, x: { ack: null, expiresAt: 1 } } } }
        return {
          state: { ...state, encounter: { ...state.encounter, records: { ...state.encounter.records, [doc.id]: { text: doc.payload.text, at: arrival.when } } } },
          events: [{ type: 'profile.updated', contactId: state.relationships.r1?.contactId ?? null }],
        }
      },
    },
  },
})

/** Two holders A and B, each over its own InMemoryStore, sharing one tuple. */
export async function pair ({ a: aOpts = {}, b: bOpts = {}, modules = () => [noteModule()], retry } = {}) {
  const A = await side(0x07, 0x03)
  const B = await side(0x09, 0x05)
  const storeA = new InMemoryStore()
  const storeB = new InMemoryStore()
  await storeA.commit(null, stateOf(A, B, aOpts))
  await storeB.commit(null, stateOf(B, A, bOpts))
  const holderA = await createHolder({ store: storeA, keys: A.keys, retry }, { modules: modules('A') })
  const holderB = await createHolder({ store: storeB, keys: B.keys, retry }, { modules: modules('B') })
  return { A, B, storeA, storeB, holderA, holderB }
}

export const read = async (store) => (await store.read()).state
