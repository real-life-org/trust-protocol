// holder-fixture — persons over createHolder for the PR 7a tests
// (encounter-holder, membership-holder, introduction-holder): a holder
// with invariants on, the ceremony between two of them, and a settle loop
// that delivers by the owner of each envelope's rkid.
import assert from 'node:assert/strict'
import { seedKeys, digestBytes, createHolder } from '../dist/index.js'
import { InMemoryStore, stateBuilder } from '../dist/testing.js'

export const T0 = Date.parse('2026-10-15T09:00:00Z')
export const BUNDLE = 'https://real-life.org/trust-tasks/encounter-bundle/0.1'
export const DELIVERY = 'https://real-life.org/trust-tasks/encounter-credential-delivery/0.1'
export const ACK = 'https://real-life.org/trust-tasks/delivery-ack/0.1'

/** A holder over an InMemoryStore, invariants on. */
export async function person (fill, { modules = [], store = new InMemoryStore(), ...ports } = {}) {
  const seed = new Uint8Array(64).fill(fill)
  const keys = seedKeys(seed)
  const h = await createHolder({ store, keys, ...ports }, { modules, invariants: true })
  return { h, store, keys, seed, read: async () => (await store.read()).state }
}

export const ev = (r, type) => (r.events ?? []).filter((e) => e.type === type)
let acts = 0
export const opts = (when, extra = {}) => ({ when, actId: 'act-' + (++acts), ...extra })

/** B shows, A scans: the bundle, unreceived. */
export async function scanned (A, B, t = T0, { nameA = 'Al', nameB = 'Bea' } = {}) {
  const shown = await B.h.show(opts(t, { name: nameB }))
  assert.equal(shown.ok, true)
  const card = ev(shown, 'encounter.shown')[0].card
  const sc = await A.h.scan(card, opts(t + 1000, { name: nameA }))
  assert.equal(sc.ok, true, JSON.stringify(sc))
  return { card, sc, bundle: sc.outbound.find((o) => o.type === BUNDLE) }
}

/** Deliver outbound (and everything it causes) until nothing moves; the
 *  owner of an envelope is the holder whose addresses hold its rkid. */
export async function settle (people, outbound, when, { rounds = 12, keep = () => true } = {}) {
  let out = [...outbound]
  const results = []
  for (let r = 0; r < rounds; r++) {
    for (const p of people) out.push(...(await p.h.resume(when)).outbound)
    if (!out.length) break
    while (out.length) {
      const o = out.shift()
      if (!keep(o)) continue
      let to = null
      for (const p of people) if (Object.hasOwn((await p.read()).addresses.keys, o.envelope.rkid)) { to = p; break }
      if (!to) continue
      const got = await to.h.receive(o.envelope, when)
      results.push({ o, got })
      if (got.disposition === 'unique' || got.disposition === 'duplicate-known') out.push(...got.outbound)
    }
  }
  return results
}

/** A person with a personal community (Identity §5.4), so it can trust. */
export async function communityPerson (fill) {
  const store = new InMemoryStore()
  const genesis = await digestBytes(new Uint8Array(32).fill(fill ^ 0x5a))
  await store.commit(null, stateBuilder({ at: T0 }).community(genesis, '1').build())
  return person(fill, { store })
}

/** Two persons who met: the whole ceremony, both credentials, settled. */
export async function met (A, B, t = T0) {
  const { sc, bundle } = await scanned(A, B, t)
  const got = await B.h.receive(bundle.envelope, t + 2000)
  const prompt = (await B.h.prompts()).find((p) => p.kind === 'encounter-confirm')
  const d = await B.h.decide(prompt.id, 'accept', opts(t + 3000))
  await settle([A, B], [...got.outbound, ...d.outbound], t + 4000)
  // the contacts this encounter made (a person may hold others)
  return { a: await A.h.contact(ev(sc, 'contact.added')[0].contactId), b: await B.h.contact(ev(got, 'contact.added')[0].contactId) }
}
