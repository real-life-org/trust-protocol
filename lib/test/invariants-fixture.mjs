// invariants-fixture — the property-based generator of the invariants
// tests (lib Stage 2, PR 5; note §4.7): three holders over InMemoryStores
// with invariants on (every commit checked before its CAS), driven by a
// seeded PRNG through random human acts (trust, untrust, pause, setClass,
// setGroupClass, merge, depart, recover, and their replay under the same
// actId), re-encounters (fresh tuples, probes, chaining), rotations (a
// test stand-in for PR 6 that owes the re-issue of 6596: due at once, or
// waiting for the entry's head where the relationship lags, and a push
// that has the counterpart give its mapping there), receive of what the
// others produced (in any order, duplicated, lost, in bursts), crafted
// conflicting star chunks (5260: discarded), adapter reports
// (awaiting-transport, accepted, delivered, late, failed), resume, tick
// and the clock (backwards too, 4.7; once past the horizon, once past the
// retention). A lists 70 groups, so its group star goes in two chunks;
// `big` gives it 1030 admitted stand-ins, so its star does too. Some runs
// restart holders over their stores and lose the answer of some commits
// (unknown commit outcome). After every step: the state invariants, the
// views, and the wake contract (an operation that opened runnable work
// names nextDueAt). What a run reached is counted (w.counters, w.events);
// a failure names the seed and the step; a run replays from its seed.
import assert from 'node:assert/strict'
import { seedKeys, digestBytes, createHolder, InfraError, b64uOf, jcs, communityContext, labeledContext, ecdh, xRawOfMk, seal, iso } from '../dist/index.js'
import { starKeyOf } from '../dist/star.js'
import { macU } from '../dist/anchor.js'
import { makeAnchorRotation } from '../dist/anchor.js'
import { InMemoryStore, stateBuilder, continuityTestModule, stateViolations } from '../dist/testing.js'
import { trustModule, entryOf, liveRel, lags, entryRelationships, classOnToward } from '../dist/internal.js'

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
 * A stand-in for the rotation PR 6 builds (Identity §5.4, Trust 6370,
 * 6596): the community anchor's next generation with its signed
 * anchor-rotation@2 in the register's lineage, and a re-issue owed on every
 * live relationship toward whose entry the anchor mapping class is on —
 * due at once where it does not lag, waiting for H, the entry's anchor head
 * at the rotation, where it lags (decided at this commit). Non-human,
 * through the engine, so the invariants check its commit.
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
          const e = liveRel(r) ? entryOf(state, r) : undefined
          if (!e || !e.relIds.includes(r.id) || !classOnToward(e, 'anchorMapping')) continue
          const lagging = lags(r, entryRelationships(state, e)) && e.anchorHead !== null
          duties.push({ kind: 'reissue-mapping', v: 1, id: `reissue:${head}:${r.id}`, contactId: e.id, relId: r.id, awaitHead: lagging ? e.anchorHead : null })
        }
        const register = { ...state.register, community: { ...state.register.community, head }, lineage: [...state.register.lineage, rotation] }
        return { state: { ...state, register }, duties }
      },
    },
  },
})

/** n admitted stand-in contacts with anchor heads and paused classes: a
 *  star view above STAR_CHUNK (5200), so the star goes in several chunks.
 *  Their tuples are deactivated: no traffic, no prior candidates (2300). */
function standIns (b, n) {
  for (let i = 0; i < n; i++) {
    const id = `x${String(i).padStart(5, '0')}`
    b.relationship('r-' + id, { contactId: id, tuples: [{ ownPairLabel: 'pair/' + id, counterpartAnchor: 'did:key:z' + id, counterpartKeyAgreement: 'z6LS' + id, rkid: 'z6LSown' + id, deactivated: true }], heldCounterpartHead: 'did:key:zHead' + id })
      .entry(id).settings(id, { star: 'off', groupStar: 'off' }).contact(id, { anchorHead: 'did:key:zHead' + id })
  }
}
const isStandIn = (id) => /^x\d{5}$/.test(id)

// ── the world ──────────────────────────────────────────────────────────

const CLASSES = ['star', 'groupStar', 'anchorMapping', 'sealedGroupStar', 'profile']
const SETTINGS = ['default', 'on', 'off']
const REASONS = ['unroutable', 'oversize', 'expired-by-adapter-policy']
const PRE = ['offline', 'transport-unreachable', 'carrier-refused-retriable']

async function world (seed, { restarts = false, lossy = false, big = false } = {}) {
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
      extraGroups: [],
    })
  }
  // A lists 69 more groups: its group star goes in two chunks (5.2b, 64 entries a chunk)
  for (let k = 0; k < 69; k++) {
    const A = persons[0]
    const id = await digestBytes(Uint8Array.from([0x70, k, ...new Array(30).fill(0x33)]))
    const memberLabel = 'group/' + id
    A.extraGroups.push({ id, memberLabel, rules: { vouchThreshold: '1' }, listed: true, membership: null, memberAnchor: (await A.keys.anchorOf(memberLabel)).anchor, memberOp: 'oid:' + b64uOf(Uint8Array.from([0x71, k, ...new Array(30).fill(0x44)])) })
  }
  const owners = new Map()   // own key agreement → person
  const sides = new Map()    // own key agreement → its pair side
  const sideOf = async (p) => {
    const n = new Uint8Array(32)
    new DataView(n.buffer).setUint32(0, p.nextNonce++)
    n[31] = p.name.charCodeAt(0)
    const label = 'pair/' + await digestBytes(n)
    const { anchor, keyAgreement } = await p.keys.anchorOf(label)
    owners.set(keyAgreement, p)
    sides.set(keyAgreement, { label, anchor, keyAgreement })
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
    b.with((s) => { s.groups[p.group.id] = p.group; for (const g of p.extraGroups) s.groups[g.id] = g; s.profile = { body: { name: p.name }, revision: '1' } })
    if (big && p === persons[0]) standIns(b, 1030)
    await p.store.commit(null, b.build())
    p.holder = await make(p)
    if (lossy) p.store.armed = true
  }
  return { rand, persons, owners, sides, sideOf, make, pool: [], now: T0, meets: 0, counters: {}, events: {}, multi: new Set(), awaiting: new Map() }
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
const STAR_T = 'https://real-life.org/trust-tasks/star/0.2'
const GSTAR_T = 'https://real-life.org/trust-tasks/group-star/0.1'
const count = (w, k, n = 1) => { w.counters[k] = (w.counters[k] ?? 0) + n }

/** Outbound into the pool; a star or group star production of several
 *  chunks (one thread) is remembered, to count its completion. */
function pooled (w, outbound) {
  w.pool.push(...outbound)
  const threads = new Map()
  for (const o of outbound) if (o.type === STAR_T || o.type === GSTAR_T) threads.set(o.threadId, [...(threads.get(o.threadId) ?? []), o])
  for (const [t, os] of threads) {
    if (os.length > 1 && os.every((o) => o.attempt === 1) && !w.multi.has(t)) { w.multi.add(t); count(w, os[0].type === STAR_T ? 'multiChunkStar' : 'multiChunkGroupStar') }
  }
}

/** Deliver one document to its owner; the replies into the pool. */
async function deliverOne (w, o) {
  const to = w.owners.get(o.envelope.rkid)
  if (!to) return null
  const r = await op(w, () => to.holder.receive(o.envelope, w.now), to)
  if (r) count(w, 'disposition.' + r.disposition)
  if (r && (r.disposition === 'unique' || r.disposition === 'duplicate-known')) pooled(w, r.outbound)
  if (r?.disposition === 'unique' && w.multi.has(o.threadId) && r.events.some((e) => e.type === 'star.accepted' || e.type === 'groupStar.accepted')) {
    count(w, o.type === STAR_T ? 'multiChunkStarAccepted' : 'multiChunkGroupStarAccepted')
  }
  return { to, r }
}

/** A resume whose give-ups at the horizon are counted. */
async function resumeOf (w, p) {
  const r = await op(w, () => p.holder.resume(w.now))
  if (r) {
    pooled(w, r.outbound)
    count(w, 'gaveUp', r.events.filter((e) => e.type === 'delivery.status' && e.status === 'failed').length)
  }
  return r
}

/** A tick, counting what its retention removed (effects, journal, outbox, address keys). */
async function tickOf (w, p) {
  const before = await read(p)
  const r = await op(w, () => p.holder.tick(w.now), p)
  const after = await read(p)
  const size = (x) => Object.keys(x.effects).length + Object.keys(x.acts).length + Object.keys(x.outbox).length + Object.keys(x.addresses.keys).length
  if (size(after) < size(before)) count(w, 'retained')
  return r
}

/**
 * An authenticated star delivery that breaks the assembly rules: two
 * chunks of one salt, both seq 1, other bytes (5260), crafted with the
 * sender's pair key outside its holder — the receiver discards the
 * assembly and holds the salt as its lower bound (5365, 5366).
 */
async function injectConflict (w, p, q) {
  // a live active tuple of q toward one of p's pair sides
  const st = await read(q)
  const heads = Object.values(st.relationships).filter((r) => liveRel(r)).map((r) => r.tuples.find((x) => x.ownPairLabel === r.activeHead))
    .filter((x) => w.owners.get(x.counterpartKeyAgreement) === p)
  if (!heads.length) return 'inject: no live tuple'
  const t = w.rand.pick(heads)
  const mine = w.sides.get(t.counterpartKeyAgreement)
  const theirs = { label: t.ownPairLabel, anchor: (await q.keys.anchorOf(t.ownPairLabel)).anchor, keyAgreement: t.rkid }
  const i = t.starIn
  const top = [i.hwm, i.lowerBound, i.assembly?.salt ?? '0'].reduce((a, b) => (BigInt(a) > BigInt(b) ? a : b))
  const salt = String(BigInt(top) + 1n + BigInt(w.rand.int(2)))
  const ctx = await labeledContext(p.seedBytes, mine.label)
  const k = await starKeyOf(await ecdh(ctx.x.priv, xRawOfMk(theirs.keyAgreement)), mine.anchor, theirs.anchor, salt)
  const threadId = p.entropy.id('thread.id')
  let last
  for (const n of [1, 2]) {
    const body = { type: 'star@2', salt, seq: '1', last: false, blinded: [await macU(k, 'did:key:zInjected' + n)] }
    const doc = { id: p.entropy.id('doc.id'), type: STAR_T, issuer: mine.anchor, recipient: theirs.anchor, threadId, issuedAt: iso(w.now), payload: { body, proof: { mac: await macU(k, jcs(body)) } } }
    const envelope = await seal(doc, theirs.keyAgreement, { ephSeed: p.entropy.bytes('seal.eph', 32), nonce: p.entropy.bytes('seal.nonce', 12) })
    last = await deliverOne(w, { envelope, type: STAR_T, threadId })
  }
  return `${p.name} → ${q.name}: a conflicting star at salt ${salt} → ${last?.r?.disposition ?? 'lost'}`
}

const CONT_T = /continuity-(probe|mapping)/

/** Resume the persons and deliver until nothing goes out; documents
 *  `keep` refuses are set aside (returned), never delivered. */
async function settle (w, persons, keep = () => true) {
  const held = []
  for (let round = 0; round < 10; round++) {
    let out = []
    for (const q of persons) { const r = await op(w, () => q.holder.resume(w.now)); if (r) out.push(...r.outbound) }
    if (!out.length) break
    while (out.length) {
      const o = out.shift()
      if (!keep(o)) { held.push(o); continue }
      const d = await deliverOne(w, o)
      if (d?.r && (d.r.disposition === 'unique' || d.r.disposition === 'duplicate-known')) { out.push(...d.r.outbound); w.pool.splice(w.pool.length - d.r.outbound.length) }
    }
  }
  return held
}

/**
 * A scripted prelude, one phase a step (so the per-step checks see each):
 * the wait of 6596 opened and released through the holders. A and B trust
 * each other on two relationships that the net merges into one entry (the
 * probes held back, so nothing chains); B rotates and only one strand
 * hears of it, so the other lags at A; A rotates: its re-issue on the
 * lagging strand waits for H, B's anchor head at A; B's mapping on that
 * strand then presents H and A's re-issue goes out.
 */
function lagScript (w) {
  const [A, B] = w.persons
  const noProbe = (o) => !CONT_T.test(o.type)
  const k = ++w.meets
  let held = []
  return [
    async () => {
      await op(w, () => A.holder.trust('B', humanAct(w, A))); await op(w, () => B.holder.trust('A', humanAct(w, B)))
      await settle(w, [A, B], noProbe)
      return 'script: A and B trust each other'
    },
    async () => {
      const mine = await w.sideOf(A), theirs = await w.sideOf(B)
      const open = (h, own, other, otherSide) => op(w, () => h.holder.act('continuity.newTuple', {
        relId: `r-${other.name}-${k}`, contactId: `${other.name}-${k}`, ownPairLabel: own.label, counterpartAnchor: otherSide.anchor, counterpartKeyAgreement: otherSide.keyAgreement,
      }, w.now))
      await open(A, mine, B, theirs); await open(B, theirs, A, mine)
      await op(w, () => A.holder.trust(`B-${k}`, humanAct(w, A))); await op(w, () => B.holder.trust(`A-${k}`, humanAct(w, B)))
      await settle(w, [A, B], noProbe)
      return `script: a second strand, merged by the net: ${JSON.stringify((await read(A)).contacts.B?.relIds)}`
    },
    async () => {
      await op(w, () => B.holder.act('test.rotate', {}, w.now))
      // only the first strand hears of it: the mapping on the second is held back
      held = await settle(w, [A, B], (o) => noProbe(o) && !(o.type.includes('anchor-mapping') && o.envelope.rkid !== A.sides.B.keyAgreement))
      return 'script: B rotates, one strand hears of it'
    },
    async () => {
      await op(w, () => A.holder.act('test.rotate', {}, w.now), A)
      return 'script: A rotates while the other strand lags'
    },
    async () => {
      for (const o of held.filter((x) => x.type.includes('anchor-mapping'))) await deliverOne(w, o)
      await settle(w, [A, B], noProbe)
      return 'script: the lagging strand presents the head'
    },
  ]
}

async function step (w, i, steps) {
  if (w.script?.length) return w.script.shift()()
  const { rand, persons } = w
  const p = rand.pick(persons)
  const s = await read(p)
  const ids = [...Object.keys(s.contacts), ...Object.values(s.contacts).flatMap((c) => c.aliases), 'nobody'].filter((id) => !isStandIn(id))
  const count = (k) => { w.counters[k] = (w.counters[k] ?? 0) + 1 }
  // past the horizon once (7 days: give-ups, Delivery's horizon), and past
  // the retention once near the end (P90D: effects, journal, outbox, tombstones)
  if (i === Math.floor(steps / 2)) {
    w.now += 8 * DAY
    for (const q of persons) await resumeOf(w, q)
    count('horizon')
    return 'clock → past the horizon, everyone resumes'
  }
  if (i === steps - 25) {
    w.now += 91 * DAY
    for (const q of persons) await tickOf(w, q)
    count('retentionJump')
    return 'clock → past the retention, everyone ticks'
  }
  const x = rand.next()
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
    } else if (y < 0.91) {
      const d = rand.pick(ids)
      what = `merge ${c} ${d}`
      r = await journaled(w, p, what, (o) => p.holder.merge([c, d], o))
    } else if (y < 0.95) {
      what = 'recover'
      r = await op(w, () => p.holder.recover({ when: w.now }), p)
      count('recover')
    } else {
      const rel = rand.chance(0.5) ? rand.pick(Object.keys(s.relationships)) : undefined
      what = `depart ${c}${rel ? ' ' + rel : ''}`
      r = await journaled(w, p, what, (o) => p.holder.depart(c, { ...o, ...(rel ? { relationshipId: rel } : {}) }))
    }
    count('act')
    if (r?.ok) pooled(w, r.outbound)
    return `${p.name} ${what} → ${r === null ? 'lost' : r.ok ? 'ok' : r.code}`
  }
  if (x < 0.30) {
    // a burst: everything pooled delivered in order, the replies after it
    let n = 0
    while (w.pool.length && n < 40) {
      if (await deliverOne(w, w.pool.shift())) n++
    }
    count('flush')
    return `flush ${n}`
  }
  if (x < 0.44) {
    const r = await resumeOf(w, p)
    count('resume')
    return `${p.name} resume → ${r ? r.outbound.length : 'lost'}`
  }
  if (x < 0.68) {
    // deliver a document from the pool, sometimes keeping it for a duplicate
    if (!w.pool.length) return 'deliver: pool empty'
    const i = rand.int(w.pool.length)
    const o = w.pool[i]
    if (!rand.chance(0.15)) w.pool.splice(i, 1)
    const d = await deliverOne(w, o)
    if (!d) return 'deliver: no owner'
    const { to, r } = d
    count('receive')
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
    const r = await tickOf(w, p)
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
  if (w.awaiting.size && rand.chance(0.5)) {
    // a re-issue waits for H (6596): the counterpart of that relationship
    // gives (or re-gives) its anchor mapping there, which presents H or later
    const [key, d] = [...w.awaiting][rand.int(w.awaiting.size)]
    const q = persons.find((y) => key.startsWith(y.name + '|'))
    const st = await read(q)
    const t = st.relationships[d.relId]?.tuples.find((x) => x.ownPairLabel === st.relationships[d.relId].activeHead)
    const P = t && w.owners.get(t.counterpartKeyAgreement)
    if (!P) return 'push: no counterpart'
    const sp = await read(P)
    const rel = Object.values(sp.relationships).find((r) => r.tuples.some((x) => x.rkid === t.counterpartKeyAgreement && !x.deactivated))
    const e = rel && entryOf(sp, rel)
    if (!e) return 'push: no entry'
    // given already: withdrawn and given again, which owes the current mapping there (2850)
    if (classOnToward(e, 'anchorMapping')) await journaled(w, P, `untrust ${e.id}`, (o) => P.holder.untrust(e.id, o))
    const r = await journaled(w, P, `trust ${e.id}`, (o) => P.holder.trust(e.id, o))
    if (r?.ok) pooled(w, r.outbound)
    await resumeOf(w, P)
    let n = 0
    while (w.pool.length && n < 60) if (await deliverOne(w, w.pool.shift())) n++
    await resumeOf(w, q)
    count('push')
    return `${P.name} gives its mapping toward ${e.id} for ${key} → ${r?.ok ?? 'lost'} (${n} delivered)`
  }
  if (rand.chance(0.2)) {
    count('inject')
    return injectConflict(w, p, rand.pick(persons.filter((y) => y !== p)))
  }
  if (rand.chance(0.3)) {
    // the community anchor rotates (the stand-in for PR 6's procedure),
    // preferably at a holder where a trusted contact's relationship lags,
    // so the wait of 6596 opens
    const lagsAt = async (q) => {
      const st = await read(q)
      return Object.values(st.contacts).some((c) => classOnToward(c, 'anchorMapping') && entryRelationships(st, c).some((r, _, rels) => liveRel(r) && lags(r, rels)))
    }
    let q = p
    for (const y of persons) if (y.rotations < 6 && await lagsAt(y)) { q = y; break }
    if (q.rotations >= 6) return 'idle'
    q.rotations++
    const r = await op(w, () => q.holder.act('test.rotate', {}, w.now), q)
    count('rotate')
    return `${q.name} rotates → ${r === null ? 'lost' : r.ok ? 'ok' : r.code}`
  }
  if (w.last && rand.chance(0.5)) {
    // the app repeats a human act under its actId: the journal answers, nothing commits (note §4.2)
    const { p: q, what, call, opts, events } = w.last
    const before = await read(q)
    const r = await op(w, () => call(opts))
    // within the journal's retention; after it the same actId is a new act (engine.ts)
    if (r !== null && before.acts[opts.actId]) {
      assert.equal(r.ok, true, `replay of ${what}`)
      assert.deepEqual(r.events, events, `replay of ${what}: the journaled events`)
      assert.equal((await read(q)).commitSeq, before.commitSeq, 'a replay commits nothing')
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
export async function run (seed, { steps = 220, restarts = false, lossy = false, big = false, script = false } = {}) {
  const w = await world(seed, { lossy, big })
  w.seed = seed
  if (script) w.script = lagScript(w)
  w.restarts = restarts
  const trail = []
  for (let i = 0; i < steps; i++) {
    let desc = '?'
    try {
      desc = await step(w, i, steps)
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
        // 6596: a re-issue waiting for H opens at a rotation and is released
        // once its relationship presents H or a later anchor carrying H
        for (const d of Object.values(st.duties)) {
          const key = `${p.name}|${d.id}`
          if (d.kind === 'reissue-mapping' && typeof d.awaitHead === 'string' && !w.awaiting.has(key)) { w.awaiting.set(key, d); count(w, 'awaitOpened') }
        }
        for (const [key, d] of w.awaiting) {
          if (!key.startsWith(p.name + '|') || Object.hasOwn(st.duties, d.id)) continue
          w.awaiting.delete(key)
          const r = st.relationships[d.relId]
          const released = r && (r.heldCounterpartHead === d.awaitHead || r.links.some((l) => l.prev === d.awaitHead))
          count(w, released ? 'awaitReleased' : 'awaitDropped')
        }
        const v = stateViolations(st)
        if (v.length) throw new Error(`state of ${p.name}: ${v.map((x) => `[${x.invariant}] ${x.detail}`).join('; ')}`)
      }
    } catch (e) {
      const msg = `invariants: seed ${seed}, step ${i} (${desc}): ${e.message}\n  last steps: ${trail.slice(process.env.INV_TRAIL ? -Number(process.env.INV_TRAIL) : -8).join(' | ')}`
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

