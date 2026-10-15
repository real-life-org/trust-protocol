// invariants-fixture — the property-based generator of the invariants
// tests (lib Stage 2, PR 5; note §4.7): three holders over InMemoryStores
// with invariants on (every commit checked before its CAS), driven by a
// seeded PRNG through random human acts (trust, untrust, pause, setClass,
// setGroupClass, merge, depart, and their replay under the same actId),
// re-encounters (fresh tuples, probes, chaining), receive of what the
// others produced (in any order, duplicated, lost, in bursts), adapter
// reports (awaiting-transport, accepted, delivered, late, failed), resume,
// tick and the clock (backwards too, 4.7). Some runs restart holders over
// their stores and lose the answer of some commits (unknown commit
// outcome). After every step: the state invariants, the views, and the
// wake contract (an operation that opened runnable work names nextDueAt).
// A failure names the seed and the step; a run replays from its seed.
import assert from 'node:assert/strict'
import { seedKeys, digestBytes, createHolder, InfraError, b64uOf, jcs, communityContext } from '../dist/index.js'
import { makeAnchorRotation } from '../dist/anchor.js'
import { InMemoryStore, stateBuilder, continuityTestModule, stateViolations } from '../dist/testing.js'
import { trustModule, onFor, entryOf, liveRel, lags, entryRelationships } from '../dist/internal.js'

const SWEEPS = Object.entries(trustModule().sweeps)

export const T0 = Date.parse('2026-10-15T09:00:00Z')
const DAY = 86_400_000

// ── a seeded PRNG (xorshift32) and seeded entropy ──────────────────────

function prng (seed) {
  let x = (seed * 2654435761) >>> 0 || 1
  const next = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296 }
  const int = (n) => Math.floor(next() * n)
  return { next, int, pick: (xs) => xs[int(xs.length)], chance: (p) => next() < p }
}

/** Entropy from a PRNG: deterministic per seed, UUIDv4-shaped ids. */
function seededEntropy (rand) {
  const bytes = (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = rand.int(256); return b }
  const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return {
    bytes: (_purpose, n) => bytes(n),
    id: () => {
      const b = bytes(16)
      b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80
      const h = hex(b)
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
    },
  }
}

/** A store that, armed, loses the answer of some successful commits
 *  (written, then throws): the unknown commit outcome of note §3. */
class LossyStore extends InMemoryStore {
  constructor (rand, p) { super(); this.rand = rand; this.p = p; this.armed = false; this.lost = 0 }
  async commit (version, next) {
    const r = await super.commit(version, next)
    if (r.ok && this.armed && this.rand.chance(this.p)) { this.lost++; throw new Error('the answer was lost') }
    return r
  }
}

/**
 * A stand-in for the rotation PR 6 builds (Identity §5.4, Trust 6370): the
 * community anchor's next generation with its signed anchor-rotation@2 in
 * the register's lineage, and a re-issue owed, due at once, on every live
 * relationship the anchor mapping is on for. Non-human, through the engine,
 * so the invariants check its commit.
 */
const rotateModule = (seedBytes) => ({
  name: 'rotate',
  commands: {
    'test.rotate': {
      human: false,
      async prepare (ctx) {
        const c = ctx.snapshot.register.community
        const g = Number(c.head)
        const [a, b, n] = await Promise.all([g, g + 1, g + 2].map((k) => communityContext(seedBytes, c.genesis, k)))
        return { head: String(g + 1), rotation: await makeAnchorRotation(a, b, n) }
      },
      apply (state, prepared) {
        const { head, rotation } = prepared.value
        const duties = []
        for (const r of Object.values(state.relationships)) {
          if (liveRel(r) && onFor(state, r, 'anchorMapping')) duties.push({ kind: 'reissue-mapping', v: 1, id: `reissue:${head}:${r.id}`, contactId: entryOf(state, r).id, relId: r.id, awaitHead: null })
        }
        const register = { ...state.register, community: { ...state.register.community, head }, lineage: [...state.register.lineage, rotation] }
        return { state: { ...state, register }, duties }
      },
    },
  },
})

// ── the world ──────────────────────────────────────────────────────────

const CLASSES = ['star', 'groupStar', 'anchorMapping', 'sealedGroupStar', 'profile']
const SETTINGS = ['default', 'on', 'off']
const REASONS = ['unroutable', 'oversize', 'expired-by-adapter-policy']
const PRE = ['offline', 'transport-unreachable', 'carrier-refused-retriable']

async function world (seed, { restarts = false, lossy = false } = {}) {
  const rand = prng(seed)
  const names = ['A', 'B', 'C']
  const persons = []
  for (let i = 0; i < names.length; i++) {
    const fill = 0x20 + i
    const seedBytes = new Uint8Array(64).fill(fill)
    const keys = seedKeys(seedBytes)
    const genesis = await digestBytes(new Uint8Array(32).fill(fill ^ 0x40))
    const gid = await digestBytes(new Uint8Array(32).fill(fill ^ 0x11))
    const memberLabel = 'group/' + gid
    const member = await keys.anchorOf(memberLabel)
    persons.push({
      name: names[i], keys, genesis, seedBytes, rotations: 0, entropy: seededEntropy(prng(seed * 31 + i + 1)), sides: {}, nextNonce: 1,
      group: { id: gid, memberLabel, rules: { vouchThreshold: '1' }, listed: true, membership: null, memberAnchor: member.anchor, memberOp: 'oid:' + b64uOf(new Uint8Array(32).fill(fill ^ 0x22)) },
      store: lossy ? new LossyStore(prng(seed * 17 + i + 1), 0.05) : new InMemoryStore(),
    })
  }
  const owners = new Map()   // own key agreement → person
  const sideOf = async (p) => {
    const n = new Uint8Array(32)
    new DataView(n.buffer).setUint32(0, p.nextNonce++)
    n[31] = p.name.charCodeAt(0)
    const label = 'pair/' + await digestBytes(n)
    const { anchor, keyAgreement } = await p.keys.anchorOf(label)
    owners.set(keyAgreement, p)
    return { label, anchor, keyAgreement }
  }
  // every pair connected once: relationship r-<other>, contact <other>
  for (let i = 0; i < persons.length; i++) {
    for (let j = i + 1; j < persons.length; j++) {
      const p = persons[i], q = persons[j]
      p.sides[q.name] = await sideOf(p); q.sides[p.name] = await sideOf(q)
    }
  }
  const make = (p) => createHolder({ store: p.store, keys: p.keys, entropy: p.entropy }, { modules: [continuityTestModule, rotateModule(p.seedBytes)], invariants: true })
  for (const p of persons) {
    const b = stateBuilder({ at: T0 }).community(p.genesis, '1')
    for (const [other, mine] of Object.entries(p.sides)) {
      const q = persons.find((x) => x.name === other)
      const theirs = q.sides[p.name]
      b.relationship('r-' + other, { contactId: other, tuples: [{ ownPairLabel: mine.label, counterpartAnchor: theirs.anchor, counterpartKeyAgreement: theirs.keyAgreement, rkid: mine.keyAgreement }] })
    }
    b.with((s) => { s.groups[p.group.id] = p.group; s.profile = { body: { name: p.name }, revision: '1' } })
    await p.store.commit(null, b.build())
    p.holder = await make(p)
    if (lossy) p.store.armed = true
  }
  return { rand, persons, owners, sideOf, make, pool: [], now: T0, meets: 0, counters: {}, events: {} }
}

const read = async (p) => (await p.store.read()).state

/** Run one holder operation; an unknown commit outcome is an expected
 *  infrastructure answer in lossy runs, everything else that throws fails. */
async function op (w, fn, p = null) {
  try {
    const before = p && await read(p)
    const r = await fn()
    for (const e of r?.events ?? []) w.events[e.type] = (w.events[e.type] ?? 0) + 1
    if (p && r && r.nextDueAt === undefined) missedWake(before, await read(p))
    return r
  } catch (e) {
    if (e instanceof InfraError && e.code === 'unknown-commit-outcome') { w.counters.lost = (w.counters.lost ?? 0) + 1; return null }
    throw e
  }
}

/** The wake contract (engine.ts): an operation that committed a duty
 *  that is new or changed and runnable now names nextDueAt — else the app
 *  would not know to call resume. */
function missedWake (before, after) {
  if (after.commitSeq === before.commitSeq) return
  for (const d of Object.values(after.duties)) {
    const was = before.duties[d.id]
    if (was && jcs(was) === jcs(d)) continue
    if (typeof d.awaitHead === 'string' || (d.dueAt !== undefined && d.dueAt > after.lastWhen)) continue
    throw new Error(`missed wake: duty ${d.id} (${d.kind}) is new and due, the result names no nextDueAt`)
  }
  for (const [name, sw] of SWEEPS) {
    const had = new Set(sw.pending(before, after.lastWhen))
    const gained = sw.pending(after, after.lastWhen).filter((k) => !had.has(k))
    if (gained.length) throw new Error(`missed wake: the sweep ${name} gained pending work ${gained[0]}, the result names no nextDueAt`)
  }
}

const humanAct = (w, p) => ({ when: w.now, actId: `${p.name}-${w.rand.int(1e9)}` })

/** A human act that may be replayed later under its actId (note §4.2). */
async function journaled (w, p, what, call) {
  const opts = humanAct(w, p)
  const r = await op(w, () => call(opts), p)
  if (r?.ok) w.last = { p, what, call, opts, events: r.events }
  return r
}

/** One random step; returns its description. */
async function step (w) {
  const { rand, persons } = w
  const p = rand.pick(persons)
  const s = await read(p)
  const ids = [...Object.keys(s.contacts), ...Object.values(s.contacts).flatMap((c) => c.aliases), 'nobody']
  const x = rand.next()
  const count = (k) => { w.counters[k] = (w.counters[k] ?? 0) + 1 }
  // the clock: mostly small steps, sometimes hours, rarely past the horizon, sometimes backwards (4.7)
  if (x < 0.05) {
    const y = rand.next()
    w.now += y < 0.6 ? rand.int(60_000) : y < 0.9 ? rand.int(6 * 3_600_000) : y < 0.97 ? 3 * DAY + rand.int(6 * DAY) : -rand.int(60_000)
    count('clock')
    return `clock → ${w.now - T0}`
  }
  if (x < 0.23) {
    // a human act
    const c = rand.chance(0.85) ? rand.pick(ids.slice(0, -1).length ? ids.slice(0, -1) : ids) : rand.pick(ids)
    const y = rand.next()
    let r, what
    if (y < 0.35) { what = `trust ${c}`; r = await journaled(w, p, what, (o) => p.holder.trust(c, o)) } else if (y < 0.43) { what = `untrust ${c}`; r = await journaled(w, p, what, (o) => p.holder.untrust(c, o)) } else if (y < 0.53) { const pz = rand.chance(0.5); what = `pause ${c} ${pz}`; r = await journaled(w, p, what, (o) => p.holder.pauseTrust(c, pz, o)) } else if (y < 0.73) {
      const cls = rand.pick(CLASSES), st = rand.pick(SETTINGS)
      what = `setClass ${c} ${cls} ${st}`
      r = await journaled(w, p, what, (o) => p.holder.setClass(c, cls, st, o))
    } else if (y < 0.85) {
      const g = rand.pick([...persons.map((q) => q.group.id), 'uG-none']), st = rand.pick(SETTINGS)
      what = `setGroupClass ${c} ${g.slice(0, 8)} ${st}`
      r = await journaled(w, p, what, (o) => p.holder.setGroupClass(c, g, st, o))
    } else if (y < 0.95) {
      const d = rand.pick(ids)
      what = `merge ${c} ${d}`
      r = await journaled(w, p, what, (o) => p.holder.merge([c, d], o))
    } else {
      const rel = rand.chance(0.5) ? rand.pick(Object.keys(s.relationships)) : undefined
      what = `depart ${c}${rel ? ' ' + rel : ''}`
      r = await journaled(w, p, what, (o) => p.holder.depart(c, { ...o, ...(rel ? { relationshipId: rel } : {}) }))
    }
    count('act')
    if (r?.ok) w.pool.push(...r.outbound)
    return `${p.name} ${what} → ${r === null ? 'lost' : r.ok ? 'ok' : r.code}`
  }
  if (x < 0.30) {
    // a burst: everything pooled delivered in order, the replies after it
    let n = 0
    while (w.pool.length && n < 40) {
      const o = w.pool.shift()
      const to = w.owners.get(o.envelope.rkid)
      if (!to) continue
      const r = await op(w, () => to.holder.receive(o.envelope, w.now), to)
      n++
      if (r && (r.disposition === 'unique' || r.disposition === 'duplicate-known')) w.pool.push(...r.outbound)
    }
    count('flush')
    return `flush ${n}`
  }
  if (x < 0.44) {
    const r = await op(w, () => p.holder.resume(w.now))
    count('resume')
    if (r) w.pool.push(...r.outbound)
    return `${p.name} resume → ${r ? r.outbound.length : 'lost'}`
  }
  if (x < 0.68) {
    // deliver a document from the pool, sometimes keeping it for a duplicate
    if (!w.pool.length) return 'deliver: pool empty'
    const i = rand.int(w.pool.length)
    const o = w.pool[i]
    if (!rand.chance(0.15)) w.pool.splice(i, 1)
    const to = w.owners.get(o.envelope.rkid)
    if (!to) return 'deliver: no owner'
    const r = await op(w, () => to.holder.receive(o.envelope, w.now), to)
    count('receive')
    if (r && (r.disposition === 'unique' || r.disposition === 'duplicate-known')) w.pool.push(...r.outbound)
    return `${to.name} receive ${o.type.split('/').slice(-2).join('/')} → ${r ? r.disposition + (r.reason ? ' ' + r.reason : '') : 'lost'}`
  }
  if (x < 0.71) {
    if (!w.pool.length) return 'drop: pool empty'
    w.pool.splice(rand.int(w.pool.length), 1)
    count('drop')
    return 'drop a document'
  }
  if (x < 0.83) {
    // an adapter report on an own document or ack
    const digests = [...Object.keys(s.outbox), ...Object.values(s.effects).map((e) => e.ack?.digest).filter(Boolean)]
    if (!digests.length) return 'report: nothing sent'
    const digest = rand.pick(digests)
    const y = rand.next()
    const rep = y < 0.2 ? { digest, status: 'awaiting-transport', reason: rand.pick(PRE) }
      : y < 0.4 ? { digest, status: 'accepted' }
        : y < 0.75 ? { digest, status: 'delivered', late: rand.chance(0.2) }
          : y < 0.92 ? { digest, status: 'failed', reason: rand.pick(REASONS) }
            : { digest, status: 'failed', reason: 'rejected-by-receiver', code: 'proofInvalid' }
    const r = await op(w, () => p.holder.report(rep, w.now), p)
    count('report')
    return `${p.name} report ${rep.status} → ${r === null ? 'lost' : r.ok ? 'ok' : r.code}`
  }
  if (x < 0.9) {
    const r = await op(w, () => p.holder.tick(w.now), p)
    count('tick')
    return `${p.name} tick → ${r === null ? 'lost' : r.ok ? 'ok' : r.code}`
  }
  if (x < 0.95 && w.meets < 6) {
    // a re-encounter: a fresh tuple on both sides (the probe and chaining follow)
    const q = rand.pick(persons.filter((y) => y !== p))
    const k = ++w.meets
    const mine = await w.sideOf(p), theirs = await w.sideOf(q)
    const open = (h, own, other, otherSide) => op(w, () => h.holder.act('continuity.newTuple', {
      relId: `r-${other.name}-${k}`, contactId: `${other.name}-${k}`, ownPairLabel: own.label, counterpartAnchor: otherSide.anchor, counterpartKeyAgreement: otherSide.keyAgreement,
    }, w.now))
    const a = await open(p, mine, q, theirs)
    const b = await open(q, theirs, p, mine)
    count('meet')
    return `${p.name} meets ${q.name} again (#${k}) → ${a?.ok} ${b?.ok}`
  }
  if (p.rotations < 3 && rand.chance(0.3)) {
    // the community anchor rotates (the stand-in for PR 6's procedure)
    p.rotations++
    const r = await op(w, () => p.holder.act('test.rotate', {}, w.now), p)
    count('rotate')
    return `${p.name} rotates → ${r === null ? 'lost' : r.ok ? 'ok' : r.code}`
  }
  if (w.last && rand.chance(0.5)) {
    // the app repeats a human act under its actId: the journal answers, nothing commits (note §4.2)
    const { p: q, what, call, opts, events } = w.last
    const before = await read(q)
    const r = await op(w, () => call(opts))
    if (r !== null) {
      assert.equal(r.ok, true, `replay of ${what}`)
      assert.deepEqual(r.events, events, `replay of ${what}: the journaled events`)
      if (before.acts[opts.actId]) assert.equal((await read(q)).commitSeq, before.commitSeq, 'a replay commits nothing')
    }
    count('replay')
    return `${q.name} replays ${what}`
  }
  if (w.restarts) {
    p.holder = await w.make(p)
    count('restart')
    return `${p.name} restarts over its store`
  }
  return 'idle'
}

/** One run: `steps` random steps, every invariant after each. */
export async function run (seed, { steps = 220, restarts = false, lossy = false } = {}) {
  const w = await world(seed, { lossy })
  w.restarts = restarts
  const trail = []
  for (let i = 0; i < steps; i++) {
    let desc = '?'
    try {
      desc = await step(w)
      trail.push(desc)
      for (const p of w.persons) {
        const st = await read(p)
        if (st.commitSeq === p.checked) continue
        p.checked = st.commitSeq
        // the views read every state the run reaches (a broken entry throws there)
        for (const c of await p.holder.contacts()) for (const a of c.aliases) assert.equal((await p.holder.contact(a))?.id, c.id)
        // what the run reached: a relationship lagging in its entry (6595), several links held
        for (const c of Object.values(st.contacts)) {
          const rels = entryRelationships(st, c)
          if (rels.some((r) => lags(r, rels))) w.counters.lagging = (w.counters.lagging ?? 0) + 1
          if (rels.some((r) => r.links.length > 0)) w.counters.linked = (w.counters.linked ?? 0) + 1
        }
        const v = stateViolations(st)
        if (v.length) throw new Error(`state of ${p.name}: ${v.map((x) => `[${x.invariant}] ${x.detail}`).join('; ')}`)
      }
    } catch (e) {
      const msg = `invariants: seed ${seed}, step ${i} (${desc}): ${e.message}\n  last steps: ${trail.slice(-8).join(' | ')}`
      throw Object.assign(new Error(msg), { cause: e })
    }
  }
  return w
}

/** What a run reached, for its diagnosis. */
export async function stats (w) {
  const out = {}
  for (const p of w.persons) {
    const s = await read(p)
    out[p.name] = {
      entries: Object.values(s.contacts).filter((c) => c.pos !== null).length,
      contacts: Object.keys(s.contacts).length,
      aliases: Object.values(s.contacts).reduce((n, c) => n + c.aliases.length, 0),
      husks: Object.values(s.relationships).filter((r) => r.chainedInto !== null).length,
      mappingsIn: Object.values(s.relationships).flatMap((r) => r.tuples).filter((t) => t.mappingIn.body !== null).length,
      stars: Object.values(s.relationships).flatMap((r) => r.tuples).filter((t) => t.starIn.accepted !== null).length,
      duties: Object.values(s.duties).map((d) => d.kind + (d.cls ? ':' + d.cls : '')).sort(),
      outbox: Object.keys(s.outbox).length,
      events: undefined,
    }
  }
  return out
}

