// star-fixture — small trust networks for the star and group-star tests
// (lib Stage 2, PR 4b): persons with a seed, a community and one pair
// side per relationship, holders over InMemoryStores, a router that
// delivers outbound to the holder owning the envelope's key, and crafted
// star@2 / group-star@1 documents for the receiver tests.
import { randomUUID } from 'node:crypto'
import { seedKeys, digestBytes, communityLabel, labeledContext, iso, seal, digestDoc, jcs, ecdh, xRawOfMk } from '../dist/index.js'
import { createHolder } from '../dist/index.js'
import { InMemoryStore, stateBuilder } from '../dist/testing.js'
import { starKeyOf } from '../dist/star.js'
import { groupStarKeyOf } from '../dist/group-star.js'
import { macU } from '../dist/anchor.js'
import { T0 } from './pair-fixture.mjs'

/** A deterministic UUIDv4-shaped thread id for a name (the profile wants a uuid). */
export const tid = (name) => '00000000-0000-4000-8000-' + Buffer.from(String(name)).toString('hex').padStart(12, '0').slice(-12)

export const STAR = 'https://real-life.org/trust-tasks/star/0.2'
export const GSTAR = 'https://real-life.org/trust-tasks/group-star/0.1'
export const MAPPING = 'https://real-life.org/trust-tasks/anchor-mapping/0.3'
export const ACK = 'https://real-life.org/trust-tasks/delivery-ack/0.1'

/** A person: one seed, a community (generation 1), pair sides by contact name. */
export async function person (name, fill) {
  const seed = new Uint8Array(64).fill(fill)
  const keys = seedKeys(seed)
  const genesis = await digestBytes(new Uint8Array(32).fill(fill ^ 0x40))
  const self = (await keys.anchorOf(communityLabel(genesis, 1))).anchor
  return { name, seed, keys, genesis, self, pairs: {} }
}

let nonce = 0x6000
/** A fresh pair side of `p` (its own label, anchor and key agreement). */
export async function pairSide (p) {
  const n = new Uint8Array(32)
  new DataView(n.buffer).setUint32(0, nonce++)
  const label = 'pair/' + await digestBytes(n)
  const { anchor, keyAgreement } = await p.keys.anchorOf(label)
  return { label, anchor, keyAgreement, seed: p.seed }
}

/** The tuple spec of `p`'s side toward `q`. */
export const tupleSpec = (mine, theirs) => ({ ownPairLabel: mine.label, counterpartAnchor: theirs.anchor, counterpartKeyAgreement: theirs.keyAgreement, rkid: mine.keyAgreement })

/**
 * Connect persons: every edge [a, b] is one relationship on each side
 * (relationship id 'r-<other>', contact id '<other>'). `build[name]`
 * adjusts that person's builder; `holder[name]` builds the holder
 * (default createHolder over the store and its keys).
 */
export async function network (persons, edges, { build = {}, holder = {} } = {}) {
  for (const [a, b] of edges) { a.pairs[b.name] = await pairSide(a); b.pairs[a.name] = await pairSide(b) }
  for (const p of persons) {
    const bld = stateBuilder({ at: T0 }).community(p.genesis, '1')
    for (const [other, mine] of Object.entries(p.pairs)) {
      const q = persons.find((x) => x.name === other)
      bld.relationship('r-' + other, { contactId: other, tuples: [tupleSpec(mine, q.pairs[p.name])] })
    }
    if (build[p.name]) build[p.name](bld)
    p.store = new InMemoryStore()
    await p.store.commit(null, bld.build())
    p.holder = holder[p.name] ? await holder[p.name](p) : await createHolder({ store: p.store, keys: p.keys })
  }
  return router(persons)
}

/** Deliver outbound to the owner of each envelope's key; acks go back the same way. */
export function router (persons) {
  const owner = (ka) => persons.find((p) => Object.values(p.pairs).some((s) => s.keyAgreement === ka))
  const deliver = async (outbound, when, log = []) => {
    for (const o of outbound) {
      const to = owner(o.envelope.rkid)
      if (!to) throw new Error('router: no owner for ' + o.envelope.rkid)
      const r = await to.holder.receive(o.envelope, when)
      log.push({ to: to.name, type: o.type, digest: o.digest, r })
      if (r.disposition !== 'failed') await deliver(r.outbound, when, log)
    }
    return log
  }
  /** resume everyone and deliver, until nothing is issued */
  const pump = async (when, { rounds = 10, log = [] } = {}) => {
    for (let i = 0; i < rounds; i++) {
      const out = []
      for (const p of persons) out.push(...(await p.holder.resume(when)).outbound)
      if (!out.length) return log
      await deliver(out, when, log)
    }
    throw new Error('pump: no quiescence')
  }
  return { deliver, pump, owner }
}

export const state = async (p) => (await p.store.read()).state
export const tupleOf = (s, relId) => s.relationships[relId].tuples.at(-1)

/** Read, change and write back a person's stored state (CAS). */
export async function edit (p, fn) {
  const { state: s0, version } = await p.store.read()
  const s = structuredClone(s0)
  fn(s)
  const r = await p.store.commit(version, s)
  if (!r.ok) throw new Error('edit: conflict')
}

/** The pair secret of `from`'s side toward `to`. */
export async function sharedOf (from, to) {
  const ctx = await labeledContext(from.seed, from.pairs[to.name].label)
  return ecdh(ctx.x.priv, xRawOfMk(to.pairs[from.name].keyAgreement))
}

/** A crafted star/0.2 chunk document from `from` to `to`: the blinded
 *  values are `anchors` blinded under the salt's key (sorted), or `blinded`. */
export async function starDoc (from, to, { salt = '1', seq = '1', last = true, anchors, blinded, threadId = tid('t-1'), id = randomUUID(), when = T0, mac } = {}) {
  const fs = from.pairs[to.name], ts = to.pairs[from.name]
  const k = await starKeyOf(await sharedOf(from, to), fs.anchor, ts.anchor, salt)
  const bl = blinded ?? (await Promise.all((anchors ?? []).map((a) => macU(k, a)))).sort()
  const body = { type: 'star@2', salt, seq, last, blinded: bl }
  const doc = { id, type: STAR, issuer: fs.anchor, recipient: ts.anchor, threadId, issuedAt: iso(when), payload: { body, proof: { mac: mac ?? await macU(k, jcs(body)) } } }
  return { envelope: await seal(doc, ts.keyAgreement), digest: await digestDoc(doc), doc, k }
}

/** A crafted group-star/0.1 chunk document from `from` to `to` over given entries. */
export async function groupStarDoc (from, to, { salt = '1', seq = '1', last = true, groups, threadId = tid('t-g'), id = randomUUID(), when = T0 } = {}) {
  const fs = from.pairs[to.name], ts = to.pairs[from.name]
  const kg = await groupStarKeyOf(await sharedOf(from, to), fs.anchor, ts.anchor, salt)
  const body = { type: 'group-star@1', salt, seq, last, groups }
  const doc = { id, type: GSTAR, issuer: fs.anchor, recipient: ts.anchor, threadId, issuedAt: iso(when), payload: { body, proof: { mac: await macU(kg, jcs(body)) } } }
  return { envelope: await seal(doc, ts.keyAgreement), digest: await digestDoc(doc), doc, kg }
}

/** Open an envelope addressed to `to`'s side toward `from`. */
export async function openAt (to, from, env) {
  const { unseal } = await import('../dist/index.js')
  const ctx = await labeledContext(to.seed, to.pairs[from.name].label)
  const r = await unseal(env, ctx.x.priv)
  if (r.error) throw new Error('openAt: ' + r.error)
  return r.document
}

/** n admitted stand-in contacts with anchor heads and paused classes (no
 *  traffic toward them), on the builder. */
export function standIns (b, n, prefix = 'x') {
  for (let i = 0; i < n; i++) {
    const id = `${prefix}${String(i).padStart(5, '0')}`
    b.relationship('r-' + id, { contactId: id, tuples: [{ ownPairLabel: 'pair/' + id, counterpartAnchor: 'did:key:z' + id, counterpartKeyAgreement: 'z6LS' + id, rkid: 'z6LSown' + id }] })
      .entry(id)
      .settings(id, { star: 'off', groupStar: 'off' })
      .contact(id, { anchorHead: 'did:key:zHead' + id })
  }
  return b
}
