// holder.mjs — the simulators' one way onto the library: persons as
// createHolder over an InMemoryStore, seedKeys, a memoryLog for the
// personal community, and the platform's or a scripted entropy; a network
// that carries every Outbound over the observable channel (delivery.mjs)
// to the device holding its rkid, feeds the answers back, reports the
// relay's acceptance and resumes the holders. Everything a person shows is
// read from its views (contacts, groups, prompts, profile) or, for the
// god's-eye inspection of the simulators, from its committed state.
//
// The library is the frozen copy under ./lib (lib/dist, refreshed by
// scripts/build-simulator-lib.mjs, checked in CI); never edit it here.
import * as L from './lib/index.js'
import { InMemoryStore, memoryLog, scriptedEntropy, stateBuilder, forgeMapping } from './lib/testing.js'
import { createChannel, deliver as channelDeliver, drainHeld, drainTransit } from './delivery.mjs'

export * from './lib/index.js'
export { InMemoryStore, memoryLog, scriptedEntropy, stateBuilder, forgeMapping }

const TT = 'https://real-life.org/trust-tasks/spec/'
/** The task types by short name. */
export const TYPES = Object.freeze({
  bundle: TT + 'encounter-bundle/0.1',
  credentialDelivery: TT + 'encounter-credential-delivery/0.1',
  ack: TT + 'delivery-ack/0.1',
  mapping: TT + 'anchor-mapping/0.3',
  star: TT + 'star/0.2',
  groupStar: TT + 'group-star/0.1',
  profile: TT + 'profile/0.1',
  probe: TT + 'continuity-probe/0.1',
  continuityMapping: TT + 'continuity-mapping/0.1',
  preludeRequest: TT + 'membership-prelude-request/0.1',
  preludeReply: TT + 'membership-prelude-reply/0.1',
  invite: TT + 'membership-invite/0.2',
  accept: TT + 'membership-accept/0.2',
  evidence: TT + 'membership-evidence/0.2',
  welcome: TT + 'x-membership-welcome/0.1',
  offer: TT + 'x-introduction-offer/0.1',
  declaration: TT + 'registry-declaration/0.1',
  request: TT + 'introduction-request/0.1',
  forward: TT + 'introduction-forward/0.1',
  reply: TT + 'introduction-reply/0.1',
  introAck: TT + 'introduction-ack/0.1',
  voucher: TT + 'introduction-voucher/0.1',
})
/** The short name of a task type (its last two path segments). */
export const shortType = (type) => String(type ?? '').split('/').slice(-2).join('/')

let acts = 0
/** The options of a human act: its time and an app-minted actId (note §4.2). */
export const at = (when, extra = {}) => ({ when, actId: 'act-' + (++acts), ...extra })

let persons = 0
const te = new TextEncoder()

/**
 * A person: a holder over its own InMemoryStore and a seed of its own.
 * opts: seed (64 bytes; default derived from the name and a counter),
 * community (default true: a personal community anchor, so the person can
 * give trust, with a memoryLog for its rotations), when, entropy (default
 * the platform's), invariants (default true: every commit is checked),
 * retry.
 */
export async function createPerson (name, opts = {}) {
  const n = ++persons
  const seed = opts.seed ?? new Uint8Array([
    ...new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(`sim/seed/${name}/${n}`))),
    ...new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(`sim/seed2/${name}/${n}`))),
  ])
  const when = opts.when ?? Date.now()
  const store = new InMemoryStore()
  let log
  if (opts.community !== false) {
    const genesis = await L.digestBytes(te.encode(`sim/community/${name}/${n}`))
    await store.commit(null, stateBuilder({ at: when }).community(genesis, '1').build())
    log = memoryLog(genesis)
  }
  const keys = L.seedKeys(seed)
  const h = await L.createHolder(
    { store, keys, ...(log ? { log } : {}), ...(opts.entropy ? { entropy: opts.entropy } : {}), ...(opts.retry ? { retry: opts.retry } : {}) },
    { invariants: opts.invariants !== false },
  )
  const p = {
    name, h, store, keys, seed, log, online: true,
    /** every event of every commit, in order (events are notifications, note §4.4) */
    events: [],
    /** own anchor → label, filled by refresh() */
    anchors: new Map(),
    /** the views of the last refresh() */
    view: { contacts: [], groups: [], prompts: [], profile: null, state: null },
  }
  h.subscribe(({ events }) => { p.events.push(...events) })
  // the own profile carries the name (6425): what an introduced contact
  // and a contact the profile class is on for read as displayName
  if (opts.profile !== false) {
    const r = await h.setProfile({ name }, at(when))
    if (!r.ok) throw new Error('setProfile: ' + r.code)
  }
  p.read = async () => (await store.read()).state
  /** Re-read the views and the own anchors (after the acts and deliveries of a step). */
  p.refresh = async () => {
    const state = (await h.snapshot()).state
    for (const label of state.register.labels) {
      if (!p.anchors.has(label)) p.anchors.set((await keys.anchorOf(label)).anchor, label)
    }
    p.view = { contacts: await h.contacts(), groups: await h.groups(), prompts: await h.prompts(), profile: await h.profile(), state }
    return p.view
  }
  /** Does this person hold `anchor` as one of its own? (after refresh) */
  p.owns = (anchor) => p.anchors.has(anchor)
  return p
}

/** The counterpart anchors a contact's tuples carry, the active head's first. */
export function counterpartAnchors (state, contact) {
  const out = []
  for (const { id } of contact.relationships) {
    const r = state.relationships[id]
    if (!r) continue
    const head = r.tuples.find((t) => t.ownPairLabel === r.activeHead)
    if (head) out.push(head.counterpartAnchor)
    for (const t of r.tuples) if (t !== head) out.push(t.counterpartAnchor)
  }
  return out
}

/** A contact view by display name (the first that matches). */
export const contactNamed = (contacts, name) => contacts.find((c) => c.displayName === name)

/**
 * The network: persons, the channel, and the wire (every delivery with its
 * disposition and stages). `send` carries a person's outbound: a sender
 * offline keeps it (reported awaiting-transport, re-offered when back
 * online by resume); a recipient offline gets it in transit (the relay
 * accepted it); otherwise the recipient's holder receives it now, and what
 * that returns is sent on.
 */
export function createNetwork (people = []) {
  const net = { people: [...people], channel: createChannel(), wire: [], outq: new Map() }
  // what the relay knows of an envelope it holds in transit: sender, type, digest
  const meta = new WeakMap()
  /** the sender hears what the channel saw; a report the holder refuses changes nothing */
  const tell = async (p, report, when) => { try { await p.h.report(report, when) } catch { /* not the sender's item */ } }
  net.add = (p) => { net.people.push(p); return p }
  net.ownerOfRkid = async (rkid) => {
    for (const p of net.people) if (Object.hasOwn((await p.read()).addresses.keys, rkid)) return p
    return null
  }
  /** carry one Outbound from `from` (a person) */
  net.deliver = async (from, o, when, opts = {}) => {
    const to = await net.ownerOfRkid(o.envelope.rkid)
    const entry = { n: net.wire.length + 1, from: from.name, to: to?.name ?? '?', type: o.type, kind: shortType(o.type), digest: o.digest, attempt: o.attempt, env: o.envelope }
    net.wire.push(entry)
    if (!from.online && !opts.replay) {
      const q = net.outq.get(from.name) ?? []
      q.push(o)
      net.outq.set(from.name, q)
      await tell(from, { digest: o.digest, status: 'awaiting-transport', reason: 'offline' }, when)
      entry.disp = 'kept on the sending device (offline)'
      entry.kept = true
      return entry
    }
    if (!to) {
      entry.disp = 'unroutable'
      await tell(from, { digest: o.digest, status: 'failed', reason: 'unroutable' }, when)
      return entry
    }
    meta.set(o.envelope, { from, type: o.type, digest: o.digest })
    const r = await channelDeliver(net.channel, to, o.envelope, when, { ...opts, kind: entry.kind, meta: { from, type: o.type, digest: o.digest } })
    Object.assign(entry, { disp: r.disp, stages: r.stages, result: r.result })
    entry.taken = r.arrived || /^(transit|held)/.test(r.disp)
    // the relay took it (delivered now, held, or in transit): accepted (Delivery §6.1)
    if (entry.taken) await tell(from, { digest: o.digest, status: 'accepted' }, when)
    if (r.result && (r.result.disposition === 'unique' || r.result.disposition === 'duplicate-known')) {
      await net.send(to, r.result.outbound, when)
    }
    if (net.channel.faults.dup && r.arrived && !opts.replay) {
      const d = await channelDeliver(net.channel, to, o.envelope, when, { replay: true })
      net.wire.push({ ...entry, n: net.wire.length + 1, kind: entry.kind + ' — DUPLICATE (fault)', disp: d.disp, stages: d.stages, result: d.result })
      if (d.result?.disposition === 'duplicate-known') await net.send(to, d.result.outbound, when)
    }
    return entry
  }
  net.send = async (from, outbound = [], when, opts = {}) => {
    const out = []
    for (const o of outbound) out.push(await net.deliver(from, o, when, opts))
    return out
  }
  /** one tick and resume round over every online person; how many documents went out */
  net.resume = async (when) => {
    let sent = 0
    for (const p of net.people) {
      if (!p.online) continue
      await p.h.tick(when)
      const r = await p.h.resume(when)
      sent += r.outbound.length
      await net.send(p, r.outbound, when)
    }
    return sent
  }
  /** resume until nothing moves (bounded) */
  net.settle = async (when, rounds = 12) => {
    for (let i = 0; i < rounds; i++) if (!(await net.resume(when))) break
    for (const p of net.people) await p.refresh()
  }
  /** a device goes offline or comes back; back online, its transit and its kept outbound flow */
  net.setOnline = async (p, online, when) => {
    p.online = online
    if (!online) return
    for (const env of drainTransit(net.channel, p.name)) {
      const r = await channelDeliver(net.channel, p, env, when, { replay: true })
      const m = meta.get(env)
      net.wire.push({ n: net.wire.length + 1, from: 'relay', to: p.name, kind: 'from transit', type: m?.type, digest: m?.digest, env, disp: r.disp, stages: r.stages, result: r.result })
      if (r.result && (r.result.disposition === 'unique' || r.result.disposition === 'duplicate-known')) await net.send(p, r.result.outbound, when)
    }
    // the kept outbound: each leaves the device only once the channel took it;
    // lost on the way, it stays kept and the sender hears the transport failed
    const still = []
    for (const o of net.outq.get(p.name) ?? []) {
      const e = await net.deliver(p, o, when)
      if (e.taken || e.disp === 'unroutable') continue
      still.push(o)
      await tell(p, { digest: o.digest, status: 'awaiting-transport', reason: 'transport-unreachable' }, when)
    }
    net.outq.set(p.name, still)
  }
  /** the hold fault released: the parked envelopes flow */
  net.releaseHeld = async (when) => {
    for (const h of drainHeld(net.channel)) {
      const to = net.people.find((p) => p.name === h.toName)
      if (!to) continue
      const r = await channelDeliver(net.channel, to, h.env, when, { replay: true })
      net.wire.push({ n: net.wire.length + 1, from: 'relay', to: to.name, kind: (h.kind ?? 'delivery') + ' — released from hold', type: h.meta?.type, digest: h.meta?.digest, env: h.env, disp: r.disp, stages: r.stages, result: r.result })
      if (r.result && (r.result.disposition === 'unique' || r.result.disposition === 'duplicate-known')) await net.send(to, r.result.outbound, when)
    }
  }
  return net
}

/** The holder's first event of a type in a result. */
export const eventOf = (r, type) => (r?.events ?? []).find((e) => e.type === type)

/**
 * The ceremony between two persons, as the apps run it: `displayer` shows
 * a code, `scanner` scans it; the bundle travels the network, the
 * displayer confirms on its encounter-confirm prompt (the counter-step),
 * everything settles (unless `settle: false`: then the duties, among them
 * the continuity probes, wait for the next resume). Returns the contact
 * views of both sides.
 */
export async function meet (net, scanner, displayer, when, { settle = true } = {}) {
  const shown = await displayer.h.show(at(when, { name: displayer.name }))
  if (!shown.ok) throw new Error('show refused: ' + shown.code)
  const card = eventOf(shown, 'encounter.shown').card
  const sc = await scanner.h.scan(card, at(when + 1000, { name: scanner.name }))
  if (!sc.ok) throw new Error('scan refused: ' + sc.code)
  const scannerContact = eventOf(sc, 'contact.added').contactId
  await net.send(scanner, sc.outbound, when + 2000)
  const prompt = (await displayer.h.prompts()).find((p) => p.kind === 'encounter-confirm' && p.contactId !== undefined)
  const displayerContact = prompt?.contactId
  if (prompt) {
    const d = await displayer.h.decide(prompt.id, 'accept', at(when + 3000))
    if (!d.ok) throw new Error('confirm refused: ' + d.code)
    await net.send(displayer, d.outbound, when + 3000)
  }
  if (settle) await net.settle(when + 4000)
  else for (const p of [scanner, displayer]) await p.refresh()
  return {
    atScanner: await scanner.h.contact(scannerContact),
    atDisplayer: displayerContact ? await displayer.h.contact(displayerContact) : undefined,
    card,
  }
}

/** Decide every open prompt of `kind` with `choice`; sends what the decisions issue. */
export async function decideAll (net, p, kind, choice, when) {
  const out = []
  for (const pr of await p.h.prompts()) {
    if (pr.kind !== kind) continue
    const d = await p.h.decide(pr.id, choice, at(when))
    out.push(d)
    if (d.ok) await net.send(p, d.outbound, when)
  }
  return out
}

/** A state edit outside the library's acts (a policy change the library
 *  does not build, e.g. a group's vouch rule): read, change, commit. */
export async function editState (p, fn) {
  const { version, state } = await p.store.read()
  const s = structuredClone(state)
  fn(s)
  const r = await p.store.commit(version, s)
  if (!r.ok) throw new Error('editState: ' + r.reason)
}
