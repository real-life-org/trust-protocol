#!/usr/bin/env node
// message-interleavings (lib 0.5.0): reception, block, unblock, take-over
// and the completion record's retention, interleaved — Message Tasks 0.1
// 4060, 4230, 4240, 4320–4340, 6210, 6510 and Delivery 6.2's lock protocol,
// held by the engine's one queue and whole-state CAS.
//
// Two engines over one store (B1 and B2, the same holder, the same keys):
// an evaluation on B1 can be paused inside its preparation (stages 1–8,
// at its last key agreement) while B2 commits; B1's commit then meets a
// changed store, re-reads and runs the stages again — the waiter's
// re-entry at stage 4 (Delivery 6.2).
//
//   #103            the replay that passed stage 8 at sentAt + H − 1 s while
//                   the deletion at sentAt + H + 1 s commits: stale-issuance
//                   in stage 9, one inbox entry in total
//   the generator   seeded random sequences of send, deliver (fresh, a
//                   duplicate, a re-wrap, an equivocation), block, unblock,
//                   take-over, time and tick, with a share of deliveries
//                   raced against a block, an unblock, a tick or another
//                   delivery; after every commit, over the store's log:
//                     I1 at most one inbox entry per (tuple, mid), ever
//                     I2 an inbox entry arises only in a commit that is not
//                        under a block of its relationship
//                     I3 an inbox entry arises only with its record entry
//                     I4 a record entry never changes its body digest
//                     I5 a record entry deleted never comes back
//                     I6 an accepted message lies within the age and the
//                        future bound of its commit's mark
//                   and every cell of the table below is hit across the seeds
//                   (forced where the random walk did not reach it)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { labeledContext, seal, unseal, iso, ecdh, createHolder, seedKeys, digestDoc } from '../dist/index.js'
import { messageKeyOf, messageMac, MESSAGE_TYPE } from '../dist/message.js'
import { xRawOfMk } from '../dist/crypto.js'
import { InMemoryStore, stateBuilder } from '../dist/testing.js'
import { T0, opts, met, person } from './holder-fixture.mjs'
import { digestBytes } from '../dist/index.js'

const DAY = 86_400_000
const H = 180 * DAY

/** A store that logs every committed state, in commit order. */
class LogStore extends InMemoryStore {
  constructor () { super(); this.log = [] }
  async commit (version, next) {
    const r = await super.commit(version, next)
    if (r.ok) this.log.push(structuredClone(next))
    return r
  }
}

/** Keys whose agree can be paused once, at its n-th call after arming. */
function gatedKeys (keys) {
  let armed = null
  const g = {
    keys: {
      anchorOf: (...a) => keys.anchorOf(...a),
      sign: (...a) => keys.sign(...a),
      carrierPrincipal: (...a) => keys.carrierPrincipal(...a),
      agree: async (...a) => {
        if (armed && --armed.n === 0) { const w = armed; armed = null; w.hit(); await w.go }
        return keys.agree(...a)
      },
    },
    /** pause the n-th agree from now; resolves `reached` there, continues on release() */
    arm (n) {
      let hit, release
      const reached = new Promise((r) => { hit = r })
      const go = new Promise((r) => { release = r })
      armed = { n, hit, go }
      return { reached, release }
    },
  }
  return g
}

/** A met B; B's store is shared by two engines B1 (gated) and B2. */
async function scene (fa, fb) {
  const A = await person(fa)
  const store = new LogStore()
  const genesis = await digestBytes(new Uint8Array(32).fill(fb ^ 0x5a))
  await store.commit(null, stateBuilder({ at: T0 }).community(genesis, '1').build())
  const seed = new Uint8Array(64).fill(fb)
  const keys = seedKeys(seed)
  const gate = gatedKeys(keys)
  const B1h = await createHolder({ store, keys: gate.keys }, { invariants: true })
  const B2h = await createHolder({ store, keys }, { invariants: true })
  const read = async () => (await store.read()).state
  const B = { h: B2h, store, keys, seed, read }
  const { a, b } = await met(A, B)
  return { A, B, B1: { h: B1h, gate }, B2: B, a, b, store }
}

/** The document inside a message envelope, opened with B's pair key. */
async function openMsg (B, env) {
  const label = (await B.read()).addresses.keys[env.rkid].label
  return (await unseal(env, (await labeledContext(B.seed, label)).x.priv)).document
}

/** A fresh document carrying `body` from A to B (a re-wrap, or an equivocation with another body). */
async function rewrap (A, aContact, body, when) {
  const s = await A.read()
  const c = Object.values(s.contacts).find((x) => x.id === aContact || x.aliases.includes(aContact))
  const r = s.relationships[c.relIds[0]]
  const t = r.tuples.find((x) => x.ownPairLabel === r.activeHead)
  const own = await labeledContext(A.seed, t.ownPairLabel)
  const key = await messageKeyOf(await ecdh(own.x.priv, xRawOfMk(t.counterpartKeyAgreement)), own.anchor, t.counterpartAnchor)
  const doc = { id: crypto.randomUUID(), type: MESSAGE_TYPE, issuer: own.anchor, recipient: t.counterpartAnchor, threadId: crypto.randomUUID(), issuedAt: iso(when), payload: { body, proof: { mac: await messageMac(key, body) } } }
  return { envelope: await seal(doc, t.counterpartKeyAgreement), digest: await digestDoc(doc) }
}

/** Every inbox entry and record entry over the store's log: the invariants I1–I6. */
function checkLog (log, from = 0) {
  const seen = new Set()           // (tuple mid) of every inbox entry ever
  const gone = new Set()           // (tuple mid) of record entries deleted
  for (let i = 1; i < log.length; i++) {
    const b = log[i - 1], a = log[i]
    for (const e of Object.values(a.messages.inbox)) {
      const k = e.tuple + ' ' + e.mid
      if (Object.hasOwn(b.messages.inbox, e.id)) continue
      if (i < from) { seen.add(k); continue }
      assert.ok(!seen.has(k), `I1: a second inbox entry for ${k} at commit ${i}`)
      seen.add(k)
      const rel = Object.values(a.relationships).find((r) => r.tuples.some((t) => t.ownPairLabel === e.tuple))
      assert.ok(!rel || !a.messages.blocked.includes(rel.id), `I2: an inbox entry under a block at commit ${i}`)
      assert.ok(a.messages.records[e.tuple]?.[e.mid] !== undefined, `I3: an inbox entry without its record at commit ${i}`)
    }
    for (const [label, rec] of Object.entries(b.messages.records)) {
      for (const [mid, x] of Object.entries(rec)) {
        const y = a.messages.records[label]?.[mid]
        if (y === undefined) { gone.add(label + ' ' + mid); continue }
        assert.equal(y.bodyDigest, x.bodyDigest, `I4: the body digest of ${mid} changed at commit ${i}`)
      }
    }
    for (const [label, rec] of Object.entries(a.messages.records)) {
      for (const [mid, x] of Object.entries(rec)) {
        if (b.messages.records[label]?.[mid] !== undefined) continue
        assert.ok(!gone.has(label + ' ' + mid), `I5: the record of ${mid} came back at commit ${i}`)
        assert.ok(x.sentAt + H >= a.lastWhen && x.sentAt <= a.lastWhen + DAY, `I6: ${mid} accepted outside its bounds at commit ${i}`)
      }
    }
  }
}

test('message (#103): a replay that passed stage 8 at sentAt + H − 1 s while the deletion at sentAt + H + 1 s commits is failed(stale-issuance) in stage 9 — one inbox entry in total (RLTP-MSG-4040, 4060, 4340)', async () => {
  const { A, B, B1, a, store } = await scene(0x51, 0x52)
  const t = T0 + 10_000_000
  const sent = await A.h.sendMessage(a.id, 'once', opts(t))
  const env = sent.outbound[0].envelope
  assert.equal((await B.h.receive(env, t + 1000)).disposition, 'unique')
  await B.h.tick(t + 100 * DAY)                                  // the cache entry gone (P90D), the record held (H)
  // B1 evaluates the replay; it pauses at its last key agreement (stage 8, the ack's key)
  const { reached, release } = B1.gate.arm(3)
  const replay = B1.h.receive(env, t + H - 1000)
  await reached
  await B.h.tick(t + H + 1000)                                   // the deletion commits, the mark raised
  assert.deepEqual((await B.read()).messages.records[(await B.read()).messages.inbox[Object.keys((await B.read()).messages.inbox)[0]].tuple] ?? {}, {})
  release()
  const r = await replay
  assert.deepEqual([r.disposition, r.reason, r.stage, r.ref], ['failed', 'stale-issuance', 9, 'RLTP-MSG-4040'])
  assert.equal(Object.keys((await B.read()).messages.inbox).length, 1, 'one inbox entry in total')
  checkLog(store.log)
})

test('message: the same replay without the race is no new effect with a fresh ack (RLTP-MSG-4320)', async () => {
  const { A, B, B1, a } = await scene(0x53, 0x54)
  const t = T0 + 10_000_000
  const sent = await A.h.sendMessage(a.id, 'once', opts(t))
  assert.equal((await B.h.receive(sent.outbound[0].envelope, t + 1000)).disposition, 'unique')
  await B.h.tick(t + 100 * DAY)
  const r = await B1.h.receive(sent.outbound[0].envelope, t + H - 1000)
  assert.deepEqual([r.disposition, r.events], ['unique', []])
  assert.equal(Object.keys((await B.read()).messages.inbox).length, 1)
})

test('message: concurrent acceptances against one mark — two envelopes of one mid on B1 and B2 at once give one inbox entry; a block set while an evaluation waits applies to it whole (RLTP-MSG-4230, 4240; RLTP-DEL-6240)', async () => {
  const { A, B, B1, a, b, store } = await scene(0x55, 0x56)
  const t = T0 + 10_000_000
  const sent = await A.h.sendMessage(a.id, 'twice', opts(t))
  const doc = await openMsg(B, sent.outbound[0].envelope)
  const copy = await rewrap(A, a.id, doc.payload.body, t)
  let g = B1.gate.arm(3)
  const p1 = B1.h.receive(sent.outbound[0].envelope, t + 1000)
  await g.reached
  assert.equal((await B.h.receive(copy.envelope, t + 1000)).disposition, 'unique')
  g.release()
  const r1 = await p1
  assert.equal(r1.disposition, 'unique')
  assert.equal(Object.keys((await B.read()).messages.inbox).length, 1, 'one of them surfaced, the other found the record')
  // a block committed while an evaluation waits: it decides on the block
  const m2 = await A.h.sendMessage(a.id, 'after the block', opts(t + 2000))
  g = B1.gate.arm(3)
  const p2 = B1.h.receive(m2.outbound[0].envelope, t + 3000)
  await g.reached
  assert.equal((await B.h.block(b.id, opts(t + 3000))).ok, true)
  g.release()
  assert.equal((await p2).disposition, 'unique')
  assert.equal(Object.keys((await B.read()).messages.inbox).length, 1, 'discarded under the block it now reads')
  checkLog(store.log)
})

// ── the generator ──────────────────────────────────────────────────────

/** A seeded PRNG (mulberry32). */
const rng = (seed) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }

/** The cells: what a delivery met. */
const CELLS = [
  'fresh/inbox', 'fresh/discard-blocked', 'duplicate/cached', 'rewrap/no-new-effect', 'rewrap/stale-after-gc',
  'equivocation/refused', 'equivocation/stale', 'raced/tick', 'raced/block', 'raced/unblock', 'raced/delivery',
]

async function run (seed, steps, hits) {
  const r = rng(seed)
  const pick = (xs) => xs[Math.floor(r() * xs.length)]
  const { A, B, B1, a, b, store } = await scene(0x60 + (seed % 32), 0xa0 + (seed % 32))
  let now = T0 + 10_000_000
  let blocked = false
  const sent = []                          // { env, body, at }
  const cell = (c) => { hits.set(c, (hits.get(c) ?? 0) + 1) }
  const from = store.log.length
  const deliverOne = async (holder, x, kind, when) => {
    const got = await holder.receive(x.env, when)
    return got
  }
  for (let i = 0; i < steps; i++) {
    const op = pick(['send', 'send', 'deliver', 'deliver', 'deliver', 'rewrap', 'equivocate', 'block', 'take', 'time', 'race'])
    now += Math.floor(r() * 60_000)
    if (op === 'send' || !sent.length) {
      const s = await A.h.sendMessage(a.id, 'm' + i, opts(now))
      if (!s.ok) continue
      sent.push({ env: s.outbound[0].envelope, body: (await openMsg(B, s.outbound[0].envelope)).payload.body, at: Math.floor(now / 1000) * 1000, delivered: false })
      continue
    }
    const x = pick(sent)
    if (op === 'deliver') {
      const got = await deliverOne(r() < 0.5 ? B.h : B1.h, x, 'fresh', now)
      if (got.disposition === 'duplicate-known') cell('duplicate/cached')
      else if (got.disposition === 'unique' && !x.delivered) cell(blocked ? 'fresh/discard-blocked' : 'fresh/inbox')
      else if (got.disposition === 'unique') cell('rewrap/no-new-effect')
      else if (got.reason === 'stale-issuance') cell('rewrap/stale-after-gc')
      if (got.disposition === 'unique') x.delivered = true
    } else if (op === 'rewrap' || op === 'equivocate') {
      const body = op === 'rewrap' ? x.body : { ...x.body, text: x.body.text + '!' }
      const w = await rewrap(A, a.id, body, now)
      const got = await (r() < 0.5 ? B.h : B1.h).receive(w.envelope, now)
      if (op === 'rewrap') {
        if (got.disposition === 'unique') cell(x.delivered ? 'rewrap/no-new-effect' : (blocked ? 'fresh/discard-blocked' : 'fresh/inbox'))
        else if (got.reason === 'stale-issuance') cell('rewrap/stale-after-gc')
        if (got.disposition === 'unique') x.delivered = true
      } else {
        if (got.reason === 'validation-failed') cell('equivocation/refused')
        else if (got.reason === 'stale-issuance') cell('equivocation/stale')
        else if (got.disposition === 'unique') x.delivered = true   // its first body is this one
      }
    } else if (op === 'block') {
      blocked = !blocked
      assert.equal((await (blocked ? B.h.block(b.id, opts(now)) : B.h.unblock(b.id, opts(now)))).ok, true)
    } else if (op === 'take') {
      const ids = (await B.h.inbox()).map((m) => m.id).filter(() => r() < 0.7)
      await B.h.takeMessages(ids, { when: now })
    } else if (op === 'time') {
      now += pick([DAY, 30 * DAY, 95 * DAY, 181 * DAY])
      await B.h.tick(now)
    } else if (op === 'race') {
      const g = B1.gate.arm(3)
      const p = B1.h.receive(x.env, now)
      const other = pick(['tick', 'block', 'delivery'])
      await Promise.race([g.reached, p])
      if (other === 'tick') { now += pick([DAY, 181 * DAY]); await B.h.tick(now) } else if (other === 'block') {
        blocked = !blocked
        await (blocked ? B.h.block(b.id, opts(now)) : B.h.unblock(b.id, opts(now)))
      } else {
        const w = await rewrap(A, a.id, x.body, now)
        await B.h.receive(w.envelope, now)
      }
      g.release()
      const got = await p
      cell(other === 'tick' ? 'raced/tick' : other === 'delivery' ? 'raced/delivery' : blocked ? 'raced/block' : 'raced/unblock')
      if (got.disposition === 'unique') x.delivered = true
    }
  }
  checkLog(store.log, from)
}

for (const [batch, seeds] of [[1, [1, 2, 3, 4]], [2, [5, 6, 7, 8]]]) {
  test(`message interleavings: seeded random sequences of send, deliver, re-wrap, equivocate, block, unblock, take-over, tick and races keep I1–I6 (batch ${batch}: seeds ${seeds.join(', ')})`, async () => {
    const hits = new Map()
    for (const s of seeds) await run(s, 40, hits)
    const all = globalThis.__messageCells ??= new Map()
    for (const [k, n] of hits) all.set(k, (all.get(k) ?? 0) + n)
  })
}

test('message interleavings: every cell is hit across the seeds; a cell the random walk missed is forced by a scripted run (Zelle in jedem Zweig)', async () => {
  const hits = globalThis.__messageCells ?? new Map()
  const missing = CELLS.filter((c) => !hits.get(c))
  console.log('cells hit by the random walk:', JSON.stringify(Object.fromEntries(CELLS.map((c) => [c, hits.get(c) ?? 0]))), 'forced:', JSON.stringify(missing))
  // forced: one scripted run per missing cell, through the same checks
  for (const c of missing) {
    const forced = new Map()
    await forceCell(c, forced)
    assert.ok(forced.get(c), `cell ${c} forced`)
  }
})

/** A scripted run that reaches one cell. */
async function forceCell (c, hits) {
  const { A, B, B1, a, b, store } = await scene(0x70, 0xb0)
  const t = T0 + 10_000_000
  const s = await A.h.sendMessage(a.id, 'forced', opts(t))
  const env = s.outbound[0].envelope
  const body = (await openMsg(B, env)).payload.body
  const hit = () => hits.set(c, 1)
  switch (c) {
    case 'fresh/inbox': if ((await B.h.receive(env, t)).events?.length) hit(); break
    case 'fresh/discard-blocked': await B.h.block(b.id, opts(t)); if ((await B.h.receive(env, t)).disposition === 'unique' && !(await B.h.inbox()).length) hit(); break
    case 'duplicate/cached': await B.h.receive(env, t); if ((await B.h.receive(env, t)).disposition === 'duplicate-known') hit(); break
    case 'rewrap/no-new-effect': await B.h.receive(env, t); if ((await B.h.receive((await rewrap(A, a.id, body, t)).envelope, t)).events?.length === 0) hit(); break
    case 'rewrap/stale-after-gc': await B.h.receive(env, t); await B.h.tick(t + 181 * DAY); if ((await B.h.receive((await rewrap(A, a.id, body, t)).envelope, t + 181 * DAY)).reason === 'stale-issuance') hit(); break
    case 'equivocation/refused': await B.h.receive(env, t); if ((await B.h.receive((await rewrap(A, a.id, { ...body, text: 'x' }, t)).envelope, t)).reason === 'validation-failed') hit(); break
    case 'equivocation/stale': await B.h.receive(env, t); await B.h.tick(t + 181 * DAY); if ((await B.h.receive((await rewrap(A, a.id, { ...body, text: 'x' }, t)).envelope, t + 181 * DAY)).reason === 'stale-issuance') hit(); break
    default: {
      const g = B1.gate.arm(3)
      const p = B1.h.receive(env, t)
      await g.reached
      if (c === 'raced/tick') await B.h.tick(t + DAY)
      else if (c === 'raced/block') await B.h.block(b.id, opts(t))
      else if (c === 'raced/unblock') { await B.h.block(b.id, opts(t)); await B.h.unblock(b.id, opts(t)) } else await B.h.receive((await rewrap(A, a.id, body, t)).envelope, t)
      g.release()
      if ((await p).disposition) hit()
    }
  }
  checkLog(store.log)
}
