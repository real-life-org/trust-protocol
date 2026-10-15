// pair-fixture — two holders that share one relationship tuple, for the
// receive, duty, retention and trust tests (lib Stage 2, PR 3, PR 4a).
// Real keys from seedKeys, states from stateBuilder; a fake
// designated-verifier task type `test-note/0.1` with a module that sends
// and receives it.
import { randomUUID } from 'node:crypto'
import { seedKeys, digestBytes, digestDoc, seal, unseal, iso, communityLabel, communityContext, labeledContext } from '../dist/index.js'
import { buildAnchorMapping } from '../dist/anchor.js'
import { createHolder } from '../dist/index.js'
import { InMemoryStore, stateBuilder, emptyTuple } from '../dist/testing.js'

export const NOTE = 'https://real-life.org/trust-tasks/test-note/0.1'
export const T0 = Date.parse('2026-10-15T09:00:00Z')
export const DAY = 86_400_000

export const tupleOf = ({ label, counterpartAnchor, counterpartKeyAgreement, rkid, entryId }) =>
  emptyTuple({ ownPairLabel: label, counterpartAnchor, counterpartKeyAgreement, rkid, entryId })

/** One side: its keys, pair label, pair anchor and key agreement; `seed`
 *  (the root IKM) and `ctx` (its pair Context with private keys) let tests
 *  craft documents the holder would not build. */
export async function side (fill, nonceFill, seed = new Uint8Array(64).fill(fill)) {
  const keys = seedKeys(seed)
  const label = 'pair/' + await digestBytes(new Uint8Array(32).fill(nonceFill))
  const { anchor, keyAgreement } = await keys.anchorOf(label)
  return { keys, label, anchor, keyAgreement, seed }
}

/** The builder of `me` holding one relationship `rel` toward `them`, its
 *  entry committed at position 0; `address`: 'live', 'tombstone' or 'none'.
 *  `stars: false` (the default here) pauses the contact (star and blinded
 *  group star off, 5.4), so tests of other documents see no star traffic;
 *  the trust tests pass `stars: true`. */
export function builderOf (me, them, { rel = 'r1', contact = 'c1', lastShown = T0, address = 'live', entry = true, stars = false } = {}) {
  const b = stateBuilder({ at: T0 })
    .relationship(rel, { contactId: contact, tuples: [{ ownPairLabel: me.label, counterpartAnchor: them.anchor, counterpartKeyAgreement: them.keyAgreement, rkid: me.keyAgreement }] })
  if (entry) b.entry(contact)
  if (!stars) b.settings(contact, { star: 'off', groupStar: 'off' })
  return b
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
 * handler records the note in encounter.records under the document id
 * (text 'refuse' refuses, 'discard' is a resource-limit discard).
 * `seen` collects what the handler got; `onAck` is the module's ack
 * handler for its notes, `onFailed` its failure handler.
 */
export const noteModule = (seen = {}, { onAck = null, onFailed = null } = {}) => ({
  name: 'note',
  ...(onAck ? { acks: { [NOTE]: onAck } } : {}),
  ...(onFailed ? { failures: { [NOTE]: onFailed } } : {}),
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
        if (doc.payload.text === 'discard') return { discarded: true, reason: 'resource-limit', ref: 'RLTP-TRU-5365', state: { ...state, encounter: { ...state.encounter, records: { ...state.encounter.records, [doc.id]: { discarded: true } } } } }
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

// ── trust (PR 4a) ──────────────────────────────────────────────────────

export const MAPPING = 'https://real-life.org/trust-tasks/anchor-mapping/0.3'
export const ACK = 'https://real-life.org/trust-tasks/delivery-ack/0.1'

/** A side with a personal community (Identity §5.4): its genesis digest,
 *  head generation and the anchors of its generations. */
export async function withCommunity (s, genesis, head = 1) {
  const gen = async (g) => s.keys.anchorOf(communityLabel(genesis, g))
  return { ...s, genesis, head, gen, self: (await gen(head)).anchor }
}

/**
 * Two holders with one shared tuple and a community each, no entry yet on
 * either side (the entry commits with the first verified mapping, 2060).
 * `a`/`b` adjust the builders; `A`/`B` replace the sides; `invariants`
 * turns on the holders' commit check (invariants.ts).
 */
export async function trustPair ({ a = (x) => x, b = (x) => x, A: A0, B: B0, retry, modules = () => [], invariants = false } = {}) {
  const A = A0 ?? await withCommunity(await side(0x07, 0x03), await digestBytes(new Uint8Array(32).fill(0x31)))
  const B = B0 ?? await withCommunity(await side(0x09, 0x05), await digestBytes(new Uint8Array(32).fill(0x32)))
  const storeA = new InMemoryStore()
  const storeB = new InMemoryStore()
  await storeA.commit(null, a(builderOf(A, B, { entry: false, stars: true }).community(A.genesis, String(A.head))).build())
  await storeB.commit(null, b(builderOf(B, A, { entry: false, stars: true }).community(B.genesis, String(B.head))).build())
  const holderA = await createHolder({ store: storeA, keys: A.keys, retry }, { modules: modules('A'), invariants })
  const holderB = await createHolder({ store: storeB, keys: B.keys, retry }, { modules: modules('B'), invariants })
  return { A, B, storeA, storeB, holderA, holderB }
}

/** Deliver outbound documents to a holder, in order; the results. */
export const deliver = async (to, outbound, when) => {
  const out = []
  for (const o of outbound) out.push(await to.receive(o.envelope, when))
  return out
}

/** Open an envelope sealed to a side's pair key (the document inside). */
export async function openFor (s, env) {
  const ctx = await labeledContext(s.seed, s.label)
  const r = await unseal(env, ctx.x.priv)
  if (r.error) throw new Error('openFor: ' + r.error)
  return r.document
}

/** Wrap an anchor-mapping artifact into a fresh anchor-mapping/0.3
 *  document from `from` to `to`, sealed to `to`'s pair key. */
export async function mappingEnvelope (from, to, mapping, { when = T0, id = randomUUID(), threadId = randomUUID(), extra = {} } = {}) {
  const doc = { id, type: MAPPING, issuer: from.anchor, recipient: to.anchor, threadId, issuedAt: iso(when), payload: mapping, ...extra }
  return { envelope: await seal(doc, to.keyAgreement), digest: await digestDoc(doc), doc }
}

/**
 * Craft an anchor-mapping@4 from `from` to `to` with the probe-world
 * builder (Contexts with private keys): `self` and `nextGen` are community
 * Contexts (default: generation `gen` of from's community and the one
 * after), `lineage` the carried rotations.
 */
export async function craftMapping (from, to, { revision = '1', when = T0, gen = from.head, self, nextGen, lineage = [] } = {}) {
  const pair = await labeledContext(from.seed, from.label)
  const s = self ?? await communityContext(from.seed, from.genesis, gen)
  const n = nextGen ?? await communityContext(from.seed, from.genesis, gen + 1)
  return buildAnchorMapping({ pair, to: to.anchor, toKeyAgreement: to.keyAgreement, self: s, nextGen: n, lineage, revision, issuedAt: iso(when) })
}

/** Read, change and write back a holder's stored state (CAS on its version). */
export async function edit (store, fn) {
  const { state, version } = await store.read()
  const s = structuredClone(state)
  fn(s)
  const r = await store.commit(version, s)
  if (!r.ok) throw new Error('edit: conflict')
}
