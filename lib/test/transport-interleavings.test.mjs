#!/usr/bin/env node
// transport-interleavings (lib 0.6.0): locks, the end of a process,
// hand-overs and acknowledgements, interleaved — Delivery 0.83
// RLTP-DEL-6120 to 6135, 6330, 6335 over the holder's custody and the VTI
// mediator adapter reconciled from it.
//
// Two holders A and B share a relationship (pair-fixture). Each side runs
// an opening (a holder over its store) and an adapter instance bound to it;
// a lock or the end of a process closes both and drops the adapter with
// its volatile copies; the next opening is a new holder and a new adapter
// over the same store. A seeded generator interleaves: A sends, a side
// resumes and reconciles, adapters attempt (their attempts run in the
// background and race the steps), reports reach the holder (some, all,
// none), the carrier delivers (in order, out of order, duplicates), a side
// locks or reopens (its first resume may fail on the store), a wire goes
// offline or refuses, and time moves by seconds, hours or past the
// horizon. Checked on every deposit and at the end:
//   I1 a deposit rests on a yes of the gate from the depositing side's
//      current, open opening, for this envelope (6125, 6130)
//   I2 that yes was given before the entry's deadline (6115, 6135)
//   I3 nothing is deposited for a side while it is locked (6125)
//   I4 at the end, every document of A is delivered to B or given up by
//      A, never left open or lost (6120); every ack of B is accepted, at its
//      horizon, or failed, never left unsent past it (6330)
//   I5 B holds one effect per document, whatever the duplicates (6.3)
//   I7 at the end every answer a duplicate made due was handed over (6330)
//   I6 after every successful resume of an opening, its view is exactly the
//      custody set the stored state names (6120): held items included
// Cells: every cell of CELLS must be reached by some seed; a cell no run
// reached fails the suite. `SEED=<n>` runs one seed alone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHolder } from '../dist/index.js'
import { InMemoryStore } from '../dist/testing.js'
import { jcs } from '../dist/core.js'
import { MediatorCarrierAdapter, WireError } from '../dist/adapters/vti-mediator.js'
import { ENGINE_DEFAULTS } from '../dist/engine.js'
import { pair, noteModule, T0 } from './pair-fixture.mjs'

const DAY = 86_400_000
const SEEDS = Number(process.env.SEEDS ?? 160)
const BATCH = 32
const ONLY = process.env.SEED === undefined ? null : Number(process.env.SEED)

function rng (seed) {
  let a = seed >>> 0 || 1
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (n) => Math.floor(next() * n),
    weighted (w) {
      const e = Object.entries(w)
      let r = next() * e.reduce((s, [, x]) => s + x, 0)
      for (const [k, x] of e) if ((r -= x) < 0) return k
      return e[e.length - 1][0]
    },
  }
}

/** A store whose next `failures` commits throw; it counts, per effect
 *  digest, the commits that add the effect anew (I5). */
class FlakyStore extends InMemoryStore {
  constructor () { super(); this.failures = 0; this.added = new Map(); this.twice = []; this.prev = new Set(); this.ended = new Set(); this.answersDue = new Map() }
  async commit (version, next) {
    if (this.failures > 0) { this.failures--; throw new Error('storage failure') }
    const r = await super.commit(version, next)
    if (r.ok) {
      // every answer ever made due: digest#number → the effect's retention (I7)
      for (const e of Object.values(next.effects ?? {})) if (e.ack?.answerDue) this.answersDue.set(`${e.ack.digest}#${e.ack.answers}`, e.expiresAt)
      // every outbox item seen terminal in a committed state (I4)
      for (const [d, it] of Object.entries(next.outbox ?? {})) if (it.history.some((x) => x.status === 'failed' || x.status === 'delivered')) this.ended.add(d)
      const now = new Set(Object.keys(next.effects ?? {}))
      for (const d of now) {
        // an effect re-committed in place: its retention starts over
        if (this.prev.has(d)) { if (next.effects[d].expiresAt !== this.added.get(d)) this.twice.push(d); continue }
        // added anew before the earlier entry's retention ran out: a second effect
        if (this.added.has(d) && next.lastWhen < this.added.get(d)) this.twice.push(d)
        this.added.set(d, next.effects[d].expiresAt)
      }
      this.prev = now
    }
    return r
  }
}

const CELLS = [
  'lock:held-document', 'lock:held-ack', 'lock:answer-due', 'deliver:duplicate-while-answer-due', 'lock:filed-unreported', 'lock:adapter-left-running',
  'reopen:resume-failed', 'reopen:gave-up-expired', 'reopen:held-offered',
  'gate:no-closed', 'gate:no-expired', 'gate:no-gone',
  'reconcile:withdrawn',
  'ack:accepted', 'ack:horizon', 'ack:failed', 'ack:held',
  'deliver:duplicate', 'deliver:duplicate-after-ack-horizon', 'resend:deposited', 'resend:repeated',
]
const visited = new Set()

async function run (seed) {
  const r = rng(seed)
  const log = []
  const fail = (msg) => { throw new Error(`seed ${seed}: ${msg}\n  ${log.slice(-25).join('\n  ')}`) }
  // a violation found inside the wire is recorded there (the adapter
  // catches what its wire throws) and raised after the step
  const violations = []
  const breach = (msg) => { violations.push(msg); throw new Error(msg) }
  const checkpoint = () => { if (violations.length) fail(violations[0]) }
  // the holder's horizon: below the adapter's 72 h (the holder's deadline
  // comes first) or above it (the adapter gives up first)
  const H = r.next() < 0.5 ? DAY : ENGINE_DEFAULTS.horizonMs
  const retry = { horizonMs: H, backoff: ENGINE_DEFAULTS.backoff }
  const p = await pair({ retry })
  let now = T0
  const queue = []                 // the carrier: { to, text }
  const delivered = []             // every text ever deposited, for duplicates
  const sides = {}
  for (const [name, base, keys] of [['A', p.storeA, p.A.keys], ['B', p.storeB, p.B.keys]]) {
    const store = new FlakyStore()
    await store.commit(null, (await base.read()).state)
    sides[name] = { name, store, keys, holder: null, adapter: null, opening: 0, offline: false, refuse: false, oversize: false, approvals: new Map(), refs: [], resumed: false }
  }
  const other = (s) => (s.name === 'A' ? sides.B : sides.A)
  /** adapters of closed openings an app forgot to close: they keep running */
  const zombies = []
  /** the answers whose deposit started: digest#number (I7) */
  const answered = new Set()
  /** resends deposited per opening and ack */
  const resent = new Map()

  const wireFor = (s, opening) => ({
    async authChallenge () { return { challenge: 'c', sessionId: 's' } },
    async authenticate () { return { accessToken: 'a', accessExpiresAt: Number.MAX_SAFE_INTEGER, refreshToken: 'r', refreshExpiresAt: Number.MAX_SAFE_INTEGER } },
    async refresh () { return { accessToken: 'a', accessExpiresAt: Number.MAX_SAFE_INTEGER, refreshToken: 'r', refreshExpiresAt: Number.MAX_SAFE_INTEGER } },
    async keylistUpdate () {},
    async ackReceived () {},
    onDeliver () {},
    offline: () => s.offline,
    deposit (token, bytes) {
      // synchronous part: the invariants at the moment of the hand-over
      const text = new TextDecoder().decode(bytes)
      if (s.holder === null || s.opening !== opening) breach(`I3: ${s.name} deposited while locked or from an old opening`)
      if (s.holder.closed) breach(`I1: ${s.name} deposited through a closed opening`)
      const ok = s.approvals.get(text)
      s.approvals.delete(text)
      if (!ok || ok.opening !== opening) breach(`I1: ${s.name} deposited without a yes of its current opening, given for this deposit`)
      if (!(ok.when < ok.notAfter) || !(now < ok.notAfter)) breach(`I2: ${s.name} deposited at or after the deadline`)
      if (ok.answer) answered.add(ok.answer)
      if (ok.resend) {
        visited.add('resend:deposited')
        const k = `${opening}:${text}`
        resent.set(k, (resent.get(k) ?? 0) + 1)
        if (resent.get(k) > 1) visited.add('resend:repeated')
      }
      if (s.refuse) return Promise.reject(new WireError('refused-retriable'))
      if (s.oversize) return Promise.reject(new WireError('oversize'))
      if (s.offline) return Promise.reject(new WireError('unreachable'))
      log.push(`deposit ${s.name} ${text.slice(-12)}`)
      queue.push({ to: other(s).name, text })
      delivered.push({ to: other(s).name, text })
      return Promise.resolve()
    },
  })

  const gateOf = (s, opening) => {
    const h = s.holder
    return {
      async handOver (entry, when, start) {
        const text = jcs(entry.envelope)
        const yes = await h.handOver(entry, when, () => {
          // recorded right before the adapter's deposit starts, inside the holder's step
          s.approvals.set(text, { opening, when, notAfter: entry.notAfter, resend: entry.resend !== undefined, answer: entry.resend === undefined ? null : `${entry.digest}#${entry.resend}` })
          const r = start()
          if (!r) s.approvals.delete(text)
          return r
        })
        if (yes) {}
        else if (h.closed) visited.add('gate:no-closed')
        else if (when >= entry.notAfter) visited.add('gate:no-expired')
        else visited.add('gate:no-gone')
        return yes
      },
      get closed () { return h.closed },
    }
  }

  async function open (s) {
    s.opening++
    s.holder = await createHolder({ store: s.store, keys: s.keys, retry }, { modules: [noteModule()] })
    s.adapter = await MediatorCarrierAdapter.create(new Uint8Array(64).fill(s.name === 'A' ? 1 : 2), 'carrier', new Uint8Array(32).fill(s.opening), wireFor(s, s.opening))
    s.gate = gateOf(s, s.opening)
    s.refs = []
    s.resumed = false
  }

  async function lock (s) {
    const st = (await s.store.read()).state
    if (Object.values(st.outbox).some((it) => it.history.at(-1).status === 'awaiting-transport')) visited.add('lock:held-document')
    if (Object.values(st.effects).some((e) => e.ack && !e.ack.sent && e.ack.held)) visited.add('lock:held-ack')
    if (Object.values(st.effects).some((e) => e.ack?.answerDue)) visited.add('lock:answer-due')
    if (s.refs.some((x) => s.adapter.has(x.submissionId) && s.adapter.status(x.submissionId)?.state !== 'accepted')) visited.add('lock:filed-unreported')
    // an app that closes its adapter too, or one that forgets to: then the
    // holder's close alone must stop it (the gate)
    s.holder.close()
    if (r.next() < 0.5) s.adapter.close()
    else {
      zombies.push(s.adapter)
      if (s.refs.some((x) => s.adapter.has(x.submissionId) && s.adapter.status(x.submissionId)?.state !== 'accepted')) visited.add('lock:adapter-left-running')
    }
    log.push(`lock ${s.name}`)
    s.holder = null; s.adapter = null
  }

  /** the custody set the stored state names at `now` (I6) */
  const expected = (st) => {
    const out = []
    for (const [d, it] of Object.entries(st.outbox)) {
      const last = it.history.at(-1).status
      if (it.history.some((x) => x.status === 'accepted' || x.status === 'delivered' || x.status === 'failed')) continue
      const exp = Math.min(it.history[0].at + H, it.expiresAt ?? Infinity)
      if (now < exp) out.push(d + (last === 'awaiting-transport' ? '!' : ''))
    }
    for (const e of Object.values(st.effects)) if (e.ack && !e.ack.sent && now < e.ack.at + H) out.push(e.ack.digest + (e.ack.held ? '!' : ''))
    return out.sort()
  }

  async function sync (s) {
    if (s.holder === null) return
    const before = (await s.store.read()).state
    const heldExpired = Object.values(before.outbox).some((it) => !it.history.some((x) => x.status !== 'submitted' && x.status !== 'awaiting-transport') && now >= Math.min(it.history[0].at + H, it.expiresAt ?? Infinity))
    if (r.next() < 0.15) s.store.failures = 1
    try {
      await s.holder.resume(now)
    } catch (e) {
      s.store.failures = 0
      if (!s.resumed) visited.add('reopen:resume-failed')
      s.resumed = false
      log.push(`resume ${s.name} failed`)
      const v = await s.holder.pendingTransport(now)
      if (v.ok !== false) fail('a failed resume left a view')
      return
    }
    if (!s.resumed && heldExpired) visited.add('reopen:gave-up-expired')
    const v = await s.holder.pendingTransport(now)
    const st = (await s.store.read()).state
    // the answers: exactly one entry per answer due, whatever the retries' state
    const answers = v.entries.filter((x) => x.resend !== undefined).map((e) => `${e.digest}#${e.resend}`).sort()
    const owed = Object.values(st.effects).filter((e) => e.ack?.answerDue && now < e.expiresAt).map((e) => `${e.ack.digest}#${e.ack.answers}`).sort()
    if (jcs(answers) !== jcs(owed)) fail(`I6: answers offered ${jcs(answers)} ≠ answers due ${jcs(owed)}`)
    const got = v.entries.filter((e) => e.resend === undefined).map((e) => e.digest + (e.held ? '!' : '')).sort()
    if (jcs(got) !== jcs(expected(st))) fail(`I6: view ${jcs(got)} ≠ custody ${jcs(expected(st))}`)
    if (!s.resumed && v.entries.some((e) => e.held)) visited.add('reopen:held-offered')
    s.resumed = true
    const had = s.refs.filter((x) => s.adapter.has(x.submissionId))
    s.refs.push(...s.adapter.reconcile(v, s.gate, now))
    if (had.some((x) => !s.adapter.has(x.submissionId))) visited.add('reconcile:withdrawn')
    log.push(`sync ${s.name}: ${v.entries.length}`)
  }

  async function reports (s, all) {
    if (s.holder === null) return
    for (const x of s.refs) {
      if (!s.adapter.has(x.submissionId) || (!all && r.next() < 0.25)) continue
      const rep = s.adapter.report(x.submissionId)
      if (rep === null) continue
      const st = (await s.store.read()).state
      const isAck = !Object.hasOwn(st.outbox, rep.digest)
      try { await s.holder.report(rep, now) } catch { continue }
      if (isAck) {
        if (rep.status === 'awaiting-transport') visited.add('ack:held')
        if (rep.status === 'accepted') visited.add('ack:accepted')
        if (rep.status === 'failed') visited.add('ack:failed')
      }
    }
  }

  async function deliver (all) {
    const n = all ? queue.length : Math.min(queue.length, 1 + r.int(3))
    for (let i = 0; i < n && queue.length; i++) {
      const k = all ? 0 : r.int(queue.length)
      const item = queue[k]
      const to = sides[item.to]
      if (to.holder === null) continue
      queue.splice(k, 1)
      const env = JSON.parse(item.text)
      const beforeSt = (await to.store.read()).state
      const dueBefore = Object.values(beforeSt.effects).some((e) => e.ack?.answerDue)
      let res
      try { res = await to.holder.receive(env, now) } catch { queue.push(item); continue }
      log.push(`receive ${to.name} ${res.disposition}`)
      if (res.disposition === 'duplicate-known') {
        visited.add('deliver:duplicate')
        if (dueBefore) visited.add('deliver:duplicate-while-answer-due')
        const st = (await to.store.read()).state
        if (Object.values(st.effects).some((e) => e.ack && e.ack.sentBy === 'horizon' && res.outbound.some((o) => o.digest === e.ack.digest))) visited.add('deliver:duplicate-after-ack-horizon')
      }
      // a re-delivery the carrier keeps: the same text again later
      if (!all && r.next() < 0.35) queue.push(item)
      // the receiver's answer goes out through its own adapter, from its view
    }
  }

  async function tick (s) { if (s.holder) { try { await s.holder.tick(now) } catch { /* the store */ } } }

  const settleAdapters = async () => {
    for (const s of Object.values(sides)) if (s.adapter) { s.adapter.advance(now); await s.adapter.settle() }
  }

  await open(sides.A); await open(sides.B)
  sides.A.store.failures = 0; await sync(sides.A); sides.B.store.failures = 0; await sync(sides.B)
  const sent = []
  const steps = 40 + r.int(40)
  for (let i = 0; i < steps; i++) {
    const s = r.next() < 0.5 ? sides.A : sides.B
    const op = r.weighted({ send: 5, sync: 6, attempt: 5, report: 6, deliver: 6, lock: 2, open: 3, time: 4, offline: 4, refuse: 1, oversize: 1, tick: 1, redeliver: 2 })
    log.push(`${op} ${s.name} @${now - T0}`)
    switch (op) {
      case 'send':
        if (sides.A.holder && sides.A.resumed) {
          try {
            const res = await sides.A.holder.act('note.send', {}, now)
            if (res.ok) sent.push(res.outbound[0].digest)
          } catch { /* the store */ }
        }
        break
      case 'sync': await sync(s); if (r.next() < 0.5) await reports(s, false); break
      case 'attempt':
        if (s.adapter) { s.adapter.advance(now); if (r.next() < 0.5) await s.adapter.settle() }
        for (const z of zombies) { z.advance(now); await z.settle() }
        break
      case 'report': await reports(s, false); break
      case 'deliver': await deliver(false); break
      case 'lock': if (s.holder) await lock(s); break
      case 'open': if (!s.holder) { await open(s); await sync(s) } break
      case 'time': {
        const w = r.weighted({ s: 6, h: 3, d: 1, past: 1 })
        now += w === 's' ? 1000 * (1 + r.int(60)) : w === 'h' ? 3_600_000 * (1 + r.int(12)) : w === 'd' ? 86_400_000 * (1 + r.int(3)) : H + 86_400_000
        for (const x of Object.values(sides)) if (x.adapter) x.adapter.advance(now)
        for (const z of zombies) z.advance(now)
        break
      }
      case 'offline': s.offline = !s.offline; break
      case 'refuse': s.refuse = !s.refuse; break
      case 'oversize': s.oversize = r.next() < 0.5; break
      case 'tick': await tick(s); break
      case 'redeliver':
        // the carrier brings an old copy again, much later
        if (delivered.length) queue.push(delivered[r.int(delivered.length)])
        break
    }
    checkpoint()
  }
  // the end: both open, online, the stores healthy; settle until nothing moves
  for (const s of Object.values(sides)) { s.offline = false; s.refuse = false; s.oversize = false; s.store.failures = 0; if (!s.holder) await open(s) }
  for (let round = 0; round < 12; round++) {
    for (const s of Object.values(sides)) { await sync(s); await settleAdapters(); await reports(s, true) }
    await deliver(true)
    if (round === 6) {
      // past every horizon: what is still open is given up
      now += H + 86_400_000
      for (const s of Object.values(sides)) s.adapter.advance(now)
    }
  }
  for (const z of zombies) { z.advance(now); await z.settle() }
  for (const s of Object.values(sides)) { await sync(s); await reports(s, true) }
  checkpoint()
  // I4, I5
  const a = (await sides.A.store.read()).state
  const b = (await sides.B.store.read()).state
  for (const d of sent) {
    const it = a.outbox[d]
    if (it === undefined) {
      // gone only by the retention after a terminal step it was seen in
      if (!sides.A.store.ended.has(d)) fail(`I4: A's document ${d} left the outbox without a terminal step`)
      continue
    }
    const terminal = it.history.some((x) => x.status === 'failed' || x.status === 'delivered')
    const accepted = it.history.some((x) => x.status === 'accepted')
    if (!terminal && !accepted) fail(`I4: A's document ${d} is neither delivered, accepted nor given up`)
    if (accepted && !terminal && !Object.hasOwn(b.effects, d)) fail(`I4: A's accepted document ${d} never reached B`)
  }
  // I7: every answer a duplicate made due reached the wire (within the retention)
  for (const [n, st] of [['A', a], ['B', b]]) for (const e of Object.values(st.effects)) if (e.ack?.answerDue && now < e.expiresAt) fail(`I7: ${n}'s answer for ${e.ack.digest} still due at the end`)
  for (const s of Object.values(sides)) for (const [k, until] of s.store.answersDue) if (!answered.has(k) && now < until) fail(`I7: ${s.name}'s answer ${k} was made due and never deposited`)
  for (const e of Object.values(b.effects)) {
    if (e.ack && !e.ack.sent) fail(`I4: B's ack ${e.ack.digest} still unsent at the end`)
    if (e.ack?.sentBy === 'horizon') visited.add('ack:horizon')
  }
  for (const e of Object.values(a.effects)) if (e.ack?.sentBy === 'horizon') visited.add('ack:horizon')
  // I5: an effect committed once per document, whatever the duplicates —
  // unless the retention let it go (a later delivery is then fresh, 4.2)
  for (const s of Object.values(sides)) if (s.store.twice.length) fail(`I5: ${s.name} committed the effect of ${s.store.twice[0]} twice within its retention`)
  for (const s of Object.values(sides)) { s.holder.close(); s.adapter.close() }
}

async function runSeeds (from, to) {
  for (let seed = from; seed <= to; seed++) await run(seed)
}

const batches = ONLY !== null ? [[ONLY, ONLY]] : Array.from({ length: Math.ceil(SEEDS / BATCH) }, (_, i) => [i * BATCH + 1, Math.min(SEEDS, (i + 1) * BATCH)])
for (const [from, to] of batches) {
  test(`transport interleavings: seeds ${from} to ${to} keep custody, the gate and the deadlines`, { timeout: 60_000 }, () => runSeeds(from, to))
}
test('transport interleavings: every cell was reached', { skip: ONLY !== null }, () => {
  assert.deepEqual(CELLS.filter((c) => !visited.has(c)), [], 'cells no run visited')
})
