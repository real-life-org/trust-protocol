#!/usr/bin/env node
// The VTI-mediator transport adapter, twenty-fourth casting (round
// journals under design/adapter-review*). The wire double enforces
// the MEDIATOR's contract; the
// identity derivations are checked against the SHIPPED vector corpus
// (oracle bytes, not self-comparison).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MediatorCarrierAdapter, DECLARED, WireError, queueIdOf, deliveryReportOf, depositAddressing }
  from '@real-life/trust-protocol/adapters/vti-mediator'
import { pair, T0 } from './pair-fixture.mjs'
import { carrierPrincipal, carrierScopedIdentity }
  from '../dist/carrier-identity.js'

const te = new TextEncoder()
const MEDIATOR_DID = 'did:webvh:example:mediator'
const VEC = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'vectors', 'identity-derivation.json'), 'utf8'))

async function identities (ikm, nonce) {
  ikm ??= crypto.getRandomValues(new Uint8Array(32))
  nonce ??= crypto.getRandomValues(new Uint8Array(32))
  const p = await carrierPrincipal(ikm, MEDIATOR_DID, nonce)
  const conn = await carrierScopedIdentity(ikm, MEDIATOR_DID, nonce, 'connection')
  const egress = await carrierScopedIdentity(ikm, MEDIATOR_DID, nonce, 'egress')
  return { p, conn, egress }
}

async function adapter (wire, restored, restoredAt) {
  const ikm = crypto.getRandomValues(new Uint8Array(32))
  const nonce = crypto.getRandomValues(new Uint8Array(32))
  const a = await MediatorCarrierAdapter.create(ikm, MEDIATOR_DID, nonce, wire, restored, restoredAt)
  const { p, conn, egress } = await identities(ikm, nonce)
  return { a, p, conn, egress }
}

class WireDouble {
  constructor (now = () => 0) {
    this.now = now
    this.authCount = 0
    this.refreshCount = 0
    this.authDids = []
    this.deposited = []
    this.keylists = []
    this.queue = new Map()
    this.consumer = null
    this.depositFailure = null
    this.ackFailure = false
    this.accessTtlMs = 3600_000
    this.tokenSeq = 0
    this.isOffline = null
    this.refreshFailure = false
    this.challengeFailure = null
    this.queueDrained = true
  }

  offline () { return this.isOffline === null ? undefined : this.isOffline }

  // RLTP-VTI-3130: whether the mediator holds nothing more for this connection
  queueEmpty () { return !this.queue.size || this.queueDrained }

  #tokens () {
    this.tokenSeq++
    return {
      accessToken: 'acc' + this.tokenSeq,
      accessExpiresAt: this.now() + this.accessTtlMs,
      refreshToken: 'ref' + this.tokenSeq,
      refreshExpiresAt: this.now() + 30 * 86_400_000,
    }
  }

  async authChallenge (did) {
    if (this.challengeFailure) throw new WireError(this.challengeFailure)
    this.authCount++
    this.authDids.push(did)
    return { challenge: 'ch' + this.authCount, sessionId: 'sess' + this.authCount }
  }

  async authenticate ({ did, challenge }) {
    this.authDids.push(did)
    assert.equal(challenge, 'ch' + this.authCount)
    return this.#tokens()
  }

  async refresh (refreshToken) {
    this.refreshCount++
    if (this.refreshFailure === 'unreachable') throw new WireError('unreachable')
    if (this.refreshFailure) throw new Error('refresh token revoked')
    assert.match(refreshToken, /^ref/)
    return this.#tokens()
  }

  async keylistUpdate (accessToken, rkids) { this.keylists.push([...rkids]) }

  async deposit (accessToken, bytes, egressDid, mode) {
    if (this.depositFailure) throw new WireError(this.depositFailure)
    this.deposited.push({ bytes: bytes.slice(), egressDid, mode })
  }

  async ackReceived (accessToken, queueIds) {
    if (this.ackFailure) throw new WireError('refused-retriable')
    for (const id of queueIds) this.queue.delete(id)
  }

  onDeliver (cb) { this.consumer = cb }

  async deliverFromPeer (bytes) {
    const id = await queueIdOf(bytes)
    this.queue.set(id, bytes.slice())
    await this.consumer(bytes)
    return id
  }

  async redeliverAll () {
    for (const bytes of [...this.queue.values()]) await this.consumer(bytes)
  }
}

// ── identity derivations against the SHIPPED oracle (R4-M7) ──────────
test('connection and egress derive byte-exactly to the vector corpus', async () => {
  const ikm = Uint8Array.from(VEC.rootIkm.match(/../g).map((b) => parseInt(b, 16)))
  const nonce = new Uint8Array(await crypto.subtle.digest('SHA-256',
    te.encode('rltp/vector/carrier-relationship/nonce-1')))
  const A = VEC.adapterScopedIdentities
  const conn = await carrierScopedIdentity(ikm, A.carrier, nonce, 'connection')
  const egress = await carrierScopedIdentity(ikm, A.carrier, nonce, 'egress')
  assert.equal(conn.did, A.connection.did)
  assert.equal(conn.info, A.connection.info)
  assert.equal(egress.did, A.egress.did)
  assert.equal(egress.info, A.egress.info)
  const p = await carrierPrincipal(ikm, A.carrier, nonce)
  assert.equal(p.principal, VEC.carrierRelationship.cases[0].principal)
  assert.equal(new Set([p.principal, conn.did, egress.did]).size, 3)
})

// ── identity discipline (§5a.10) ─────────────────────────────────────
test('the principal never touches the wire; deposits carry the egress identity', async () => {
  const wire = new WireDouble()
  const { a, p, conn, egress } = await adapter(wire)
  a.register(['rkid-1'], 0)
  a.submit(te.encode('x'), 1)
  await a.settle()
  for (const did of wire.authDids) assert.equal(did, conn.did)
  assert.equal(wire.deposited[0].egressDid, egress.did)
  for (const seen of [...wire.authDids, wire.deposited[0].egressDid]) {
    assert.notEqual(seen, p.principal)
  }
  assert.deepEqual(wire.keylists, [['rkid-1']])
  assert.equal(a.keylistSynced, true)
})

test('register never awaits the mediator; advance retries until the keylist lands (R4-B1)', async () => {
  const wire = new WireDouble()
  let release
  wire.keylistUpdate = () => new Promise((res) => { release = res })
  const { a } = await adapter(wire)
  a.register(['rk-a'], 0)              // returns synchronously despite the hang
  assert.equal(a.keylistSynced, false)
  while (!release) await new Promise((r) => setTimeout(r, 1))
  release()
  await a.settle()
  assert.equal(a.keylistSynced, true)

  const wire2 = new WireDouble()
  const real = wire2.keylistUpdate.bind(wire2)
  let fail = true
  wire2.keylistUpdate = async (t, r) => { if (fail) throw new WireError('refused-retriable'); return real(t, r) }
  const { a: a2 } = await adapter(wire2)
  a2.register(['rk-b'], 0)
  await a2.settle()
  assert.equal(a2.keylistSynced, false, 'first attempt failed')
  fail = false
  a2.advance(1)
  await a2.settle()
  assert.equal(a2.keylistSynced, true, 'advance retried the intent')
  assert.deepEqual(wire2.keylists, [['rk-b']])
})

test('the trio cannot be supplied — only derived: direct construction is refused (R7-B2)', async () => {
  const wire = new WireDouble()
  const { p, conn, egress } = await identities()
  // even a CORRECT trio is refused at the door: the coupling is the
  // factory's, and a caller who could supply identities could mix
  // relationships
  assert.throws(() => new MediatorCarrierAdapter(p, conn, egress, wire), /create/)
  assert.throws(() => new MediatorCarrierAdapter(Symbol('forged'), p, conn, egress, wire), /create/)
})

// ── auth: silent carrier policy ──────────────────────────────────────
// review on #7 (issue #9): an unreachable mediator during the refresh is a
// transient failure — the still-valid tokens survive, and once the network
// is back the next operation refreshes them instead of a new handshake
test('an unreachable refresh keeps the tokens for the next attempt (#9)', async () => {
  let t = 1_000_000
  const wire = new WireDouble(() => t)
  wire.accessTtlMs = 10_000
  const { a } = await adapter(wire)
  a.submit(te.encode('one'), t)
  await a.settle()
  assert.equal(wire.authCount, 1)
  t += 20_000
  wire.refreshFailure = 'unreachable'
  wire.challengeFailure = 'unreachable'
  a.submit(te.encode('two'), t)
  await a.settle()
  assert.equal(wire.refreshCount, 1, 'one refresh tried while offline')
  wire.refreshFailure = false
  wire.challengeFailure = null
  t += 1_000
  const id3 = a.submit(te.encode('three'), t)
  await a.settle()
  assert.deepEqual(a.status(id3), { state: 'accepted' }, 'sends again once the network is back')
  assert.equal(wire.refreshCount, 2, 'the kept refresh token is used again')
  assert.equal(wire.authCount, 1, 'no new handshake was needed')
})

// CodeRabbit on #5: a refused refresh (revoked by the mediator before its
// expiry) falls back to the challenge handshake instead of replaying the
// rejected refresh token until refreshExpiresAt
test('a refused refresh falls back to the challenge handshake', async () => {
  let t = 1_000_000
  const wire = new WireDouble(() => t)
  wire.accessTtlMs = 10_000
  const { a } = await adapter(wire)
  a.submit(te.encode('one'), t)
  await a.settle()
  assert.equal(wire.authCount, 1)
  t += 20_000
  wire.refreshFailure = true
  const id2 = a.submit(te.encode('two'), t)
  await a.settle()
  assert.deepEqual(a.status(id2), { state: 'accepted' }, 'the send goes through on a fresh handshake')
  assert.equal(wire.refreshCount, 1, 'the refused refresh was tried once')
  assert.equal(wire.authCount, 2, 'then one new challenge')
  wire.refreshFailure = false
  t += 20_000
  a.submit(te.encode('three'), t)
  await a.settle()
  assert.equal(wire.refreshCount, 2, 'the next expiry refreshes the NEW token')
  assert.equal(wire.authCount, 2)
})

test('JWT lifecycle is silent: one challenge, refresh on expiry, no port event', async () => {
  let t = 1_000_000
  const wire = new WireDouble(() => t)
  wire.accessTtlMs = 10_000
  const { a } = await adapter(wire)
  const id1 = a.submit(te.encode('one'), t)
  await a.settle()
  assert.deepEqual(a.status(id1), { state: 'accepted' })
  assert.equal(wire.authCount, 1)
  t += 20_000
  const id2 = a.submit(te.encode('two'), t)
  await a.settle()
  assert.deepEqual(a.status(id2), { state: 'accepted' })
  assert.equal(wire.authCount, 1)
  assert.equal(wire.refreshCount, 1)
  assert.equal(a.drainTransitions().length, 0)
})

// ── honest pre-transport reports (R4-B2) ─────────────────────────────
test('absence is absent: status() is null before the first honest report; has() knows the id', async () => {
  const wire = new WireDouble()
  let release
  wire.deposit = () => new Promise((res) => { release = res })
  const { a } = await adapter(wire)
  const id = a.submit(te.encode('x'), 0)
  assert.equal(a.status(id), null, 'no report exists yet — and none is invented')
  assert.equal(a.has(id), true)
  assert.equal(a.has('s999'), false)
  while (!release) await new Promise((r) => setTimeout(r, 1))
  release()
  await a.settle()
  assert.deepEqual(a.status(id), { state: 'accepted' })

  wire.isOffline = true
  const id2 = a.submit(te.encode('y'), 1)
  assert.deepEqual(a.status(id2), { state: 'awaiting-transport', reason: 'offline' })
  // R13-B1: the offline signal is re-consulted on every tick — a
  // knowingly offline wire never earns an invented unreachable
  a.advance(1 + DECLARED.statusHorizonMs)
  a.advance(DECLARED.giveUpHorizonMs)      // diff = horizon − 1: short of give-up
  assert.deepEqual(a.status(id2), { state: 'awaiting-transport', reason: 'offline' },
    'offline stays offline through every tick short of the give-up')
  wire.isOffline = false
  wire.deposit = async (t, b, e) => { wire.deposited.push({ bytes: b.slice(), egressDid: e }) }
  a.advance(DECLARED.giveUpHorizonMs)
  await a.settle()
  assert.deepEqual(a.status(id2), { state: 'accepted' }, 'back online: the attempt runs and lands')
})

test('an overdue attempt earns transport-unreachable — even over a stale earlier reason (R4-B3)', async () => {
  const wire = new WireDouble()
  wire.deposit = () => new Promise(() => {})
  const { a } = await adapter(wire)
  const id = a.submit(te.encode('x'), 0)
  a.advance(DECLARED.statusHorizonMs - 1)
  assert.equal(a.status(id), null, 'within the horizon no report is owed')
  a.advance(DECLARED.statusHorizonMs)
  assert.deepEqual(a.status(id), { state: 'awaiting-transport', reason: 'transport-unreachable' })

  // stale reason: one completed retriable refusal, then a hanging retry
  const wire2 = new WireDouble()
  const { a: a2 } = await adapter(wire2)
  wire2.depositFailure = 'refused-retriable'
  const id2 = a2.submit(te.encode('y'), 0)
  await a2.settle()
  assert.equal(a2.status(id2).reason, 'carrier-refused-retriable')
  wire2.depositFailure = null
  wire2.deposit = () => new Promise(() => {})
  a2.advance(1_000)                       // starts the hanging retry
  a2.advance(1_000 + DECLARED.statusHorizonMs)
  assert.deepEqual(a2.status(id2), { state: 'awaiting-transport', reason: 'transport-unreachable' },
    'the stale reason does not outlive the overdue attempt')
})

// ── sender contract (§6.1) ───────────────────────────────────────────
test('transport failure reports, retries on advance, recovers', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  wire.depositFailure = 'unreachable'
  const id = a.submit(te.encode('x'), 0)
  await a.settle()
  assert.deepEqual(a.status(id), { state: 'awaiting-transport', reason: 'transport-unreachable' })
  wire.depositFailure = 'refused-retriable'
  a.advance(1_000); await a.settle()
  assert.deepEqual(a.status(id), { state: 'awaiting-transport', reason: 'carrier-refused-retriable' })
  wire.depositFailure = null
  a.advance(2_000); await a.settle()
  assert.deepEqual(a.status(id), { state: 'accepted' })
})

test('give-up binds awaiting AND accepted; late ack transitions, surfaced', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  wire.depositFailure = 'unreachable'
  const idA = a.submit(te.encode('a'), 0)
  await a.settle()
  wire.depositFailure = null
  const idB = a.submit(te.encode('b'), 0)
  await a.settle()
  assert.equal(a.status(idB).state, 'accepted')
  wire.depositFailure = 'unreachable'
  a.advance(DECLARED.giveUpHorizonMs - 1); await a.settle()
  assert.equal(a.status(idA).state, 'awaiting-transport')
  a.advance(DECLARED.giveUpHorizonMs); await a.settle()
  assert.deepEqual(a.status(idA), { state: 'failed', reason: 'expired-by-adapter-policy' })
  assert.deepEqual(a.status(idB), { state: 'failed', reason: 'expired-by-adapter-policy' })
  a.acknowledged(idB)
  assert.deepEqual(a.status(idB), { state: 'delivered', late: true })
  assert.deepEqual(a.drainTransitions(), [{ id: idB, to: 'delivered' }])
})

test('unroutable only for a COMPLETED admission refusal with no attempt in flight (R4-B3)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  wire.depositFailure = 'refused-admission'
  const x = a.submit(te.encode('x'), 0)
  await a.settle()
  a.advance(DECLARED.giveUpHorizonMs)
  assert.deepEqual(a.status(x), { state: 'failed', reason: 'unroutable' })

  // admission once, then a hanging retry whose outcome is unknown
  const wire2 = new WireDouble()
  const { a: a2 } = await adapter(wire2)
  wire2.depositFailure = 'refused-admission'
  const y = a2.submit(te.encode('y'), 0)
  await a2.settle()
  wire2.depositFailure = null
  wire2.deposit = () => new Promise(() => {})
  a2.advance(1_000)                       // hanging retry in flight
  a2.advance(DECLARED.giveUpHorizonMs)
  assert.deepEqual(a2.status(y), { state: 'failed', reason: 'expired-by-adapter-policy' },
    'no unroutable verdict while an outcome is unknown')

  // pure overload never becomes unroutable
  const wire3 = new WireDouble()
  const { a: a3 } = await adapter(wire3)
  wire3.depositFailure = 'refused-retriable'
  const z = a3.submit(te.encode('z'), 0)
  await a3.settle()
  a3.advance(DECLARED.giveUpHorizonMs)
  assert.deepEqual(a3.status(z), { state: 'failed', reason: 'expired-by-adapter-policy' })
})

test('a hanging deposit cannot block give-up: one serial advance applies the horizon', async () => {
  const wire = new WireDouble()
  wire.deposit = () => new Promise(() => {})
  const { a } = await adapter(wire)
  const id = a.submit(te.encode('r'), 0)
  a.advance(DECLARED.giveUpHorizonMs)
  assert.equal(a.status(id).state, 'failed')
})

test('receiver refusal acts on live submissions only; terminal states stand', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const id = a.submit(te.encode('x'), 0)
  await a.settle()
  a.receiverRefused(id, 'proofInvalid')
  assert.deepEqual(a.status(id), { state: 'failed', reason: 'rejected-by-receiver', code: 'proofInvalid' })
  a.acknowledged(id)
  assert.equal(a.status(id).state, 'delivered')
  a.receiverRefused(id, 'proofInvalid')
  assert.equal(a.status(id).state, 'delivered')

  const idGone = a.submit(te.encode('g'), 1)
  await a.settle()
  a.advance(1 + DECLARED.giveUpHorizonMs)
  a.receiverRefused(idGone, 'unsupportedType')
  assert.equal(a.status(idGone).reason, 'expired-by-adapter-policy')
})

// ── receiver: delete-to-ack, three registers ─────────────────────────
test('collect/conclude: only the conclude releases the mediator copy; conclude never blocks', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const qid = await wire.deliverFromPeer(te.encode('hello'))
  const c = a.collect(0)
  assert.equal(c.items[0].queueId, qid)
  assert.equal(wire.queue.size, 1)
  let release
  const realAck = wire.ackReceived.bind(wire)
  wire.ackReceived = async (t, ids) => {
    await new Promise((res) => { release = res })
    return realAck(t, ids)
  }
  a.conclude(c, 1)
  assert.equal(a.ackState().pending.length, 1)
  while (!release) await new Promise((r) => setTimeout(r, 1))
  release()
  await a.settle()
  assert.equal(wire.queue.size, 0)
  assert.equal(a.ackState().pending.length, 0)
})

test('a conclusion during a hanging flush gets its own flush when the first ends (R4-M6)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const realAck = wire.ackReceived.bind(wire)
  let release
  let calls = 0
  wire.ackReceived = async (t, ids) => {
    calls++
    if (calls === 1) await new Promise((res) => { release = res })
    return realAck(t, ids)
  }
  await wire.deliverFromPeer(te.encode('one'))
  const c1 = a.collect(0)
  a.conclude(c1, 1)                      // flush 1 hangs
  await wire.deliverFromPeer(te.encode('two'))
  const c2 = a.collect(2)
  a.conclude(c2, 3)                      // newcomer while flush 1 hangs
  while (!release) await new Promise((r) => setTimeout(r, 1))
  release()
  await a.settle()
  assert.equal(calls, 2, 'the newcomer got its own flush without waiting for an advance')
  assert.equal(wire.queue.size, 0)
  assert.equal(a.ackState().pending.length, 0)
})

test('redelivery of buffered or outstanding frames is ignored and never acked', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  await wire.deliverFromPeer(te.encode('m1'))
  await wire.redeliverAll()
  a.advance(1); await a.settle()
  assert.equal(wire.queue.size, 1)
  const c = a.collect(2)
  assert.equal(c.items.length, 1)
  await wire.redeliverAll()
  a.advance(3); await a.settle()
  assert.equal(wire.queue.size, 1)
  a.conclude(c, 4); await a.settle()
  assert.equal(wire.queue.size, 0)
})

test('lost ack: re-acked from the concluded register, never re-dispatched; advance retries', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  await wire.deliverFromPeer(te.encode('m2'))
  const c = a.collect(0)
  wire.ackFailure = true
  a.conclude(c, 1); await a.settle()
  assert.equal(wire.queue.size, 1)
  await wire.redeliverAll()
  assert.equal(a.collect(2).items.length, 0)
  wire.ackFailure = false
  a.advance(3); await a.settle()
  assert.equal(wire.queue.size, 0)
})

test('the window beats everything: intent and absorption fall together at its end (R14-B)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  await wire.deliverFromPeer(te.encode('owed'))
  const c = a.collect(0)
  wire.ackFailure = true
  a.conclude(c, 1); await a.settle()
  a.advance(DECLARED.giveUpHorizonMs); await a.settle()     // diff = horizon − 1: absorption stands
  await wire.redeliverAll()
  assert.equal(a.collect(DECLARED.giveUpHorizonMs).items.length, 0, 'absorbed inside the give-up horizon')
  a.advance(DECLARED.duplicateWindowMs); await a.settle()   // diff = window − 1: inside
  assert.equal(a.ackState().pending.length, 1, 'inside the window the intent is retried')
  a.advance(1 + DECLARED.duplicateWindowMs); await a.settle()
  assert.equal(a.ackState().pending.length, 0, 'at the window end the intent falls')
  assert.equal(a.ackState().concluded.length, 0, 'together with the entry')
  await wire.redeliverAll()
  const c2 = a.collect(2 + DECLARED.duplicateWindowMs)
  assert.equal(c2.items.length, 1, 'beyond the window the redelivery is a new item for §6.2')
  wire.ackFailure = false
  a.conclude(c2, 3 + DECLARED.duplicateWindowMs)
  await a.settle()
  assert.equal(wire.queue.size, 0)
})

test('a byte-identical arrival beyond the window is a NEW item — absorbed never, acked never (R11-B1)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const bytes = te.encode('reissue')
  await wire.deliverFromPeer(bytes)
  const c = a.collect(0)
  a.conclude(c, 1); await a.settle()
  assert.equal(wire.queue.size, 0, 'ack landed')
  a.advance(2)                                     // clock well inside the window
  await wire.deliverFromPeer(bytes)                // same bytes again, inside window
  assert.equal(a.collect(3).items.length, 0, 'inside the window: absorbed')
  await a.settle()
  a.advance(4 + DECLARED.duplicateWindowMs)        // move the clock past the window
  const qid = await wire.deliverFromPeer(bytes)    // same bytes again, beyond window
  const c2 = a.collect(5 + DECLARED.duplicateWindowMs)
  assert.equal(c2.items.length, 1, 'beyond the window: a new item reaches the holder')
  assert.ok(wire.queue.has(qid), 'and nothing acked it away beforehand')
  a.conclude(c2, 6 + DECLARED.duplicateWindowMs); await a.settle()
  assert.equal(wire.queue.size, 0)
})

test('restore: an expired entry is dropped AT construction — owed or not, the window beats it (R4-B4/R14-B)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const bytes = te.encode('old')
  await wire.deliverFromPeer(bytes)
  const c = a.collect(0)
  a.conclude(c, 1); await a.settle()      // ack landed: concluded, no debt
  const persisted = a.ackState()
  assert.equal(persisted.pending.length, 0)

  // restart far beyond the window: the entry must NOT absorb anew
  const { a: a2 } = await adapter(wire, persisted, 1 + DECLARED.duplicateWindowMs)
  wire.onDeliver(wire.consumer)
  await wire.deliverFromPeer(bytes)       // the same bytes reappear
  assert.equal(a2.collect(2 + DECLARED.duplicateWindowMs).items.length, 1,
    'beyond the declared window the item reaches the holder (whose §6.2 rule owns it now)')

  // a PHANTOM debt (ack landed just before a close, pending survived
  // in the snapshot) can never outlive the window: beyond it the
  // entry falls, owed or not, and the fresh copy reaches the holder
  // instead of being acked away (R14-B2)
  await assert.rejects(
    adapter(new WireDouble(), { concluded: [], pending: ['deadbeef'] }, 0),
    /invariant/,
  )
  const wire3 = new WireDouble()
  const { a: a3 } = await adapter(wire3,
    { concluded: [{ queueId: await queueIdOf(bytes), concludedAt: 0 }], pending: [await queueIdOf(bytes)] },
    5 * DECLARED.duplicateWindowMs)
  wire3.onDeliver(wire3.consumer)
  const qid3 = await wire3.deliverFromPeer(bytes)
  const c3 = a3.collect(5 * DECLARED.duplicateWindowMs + 1)
  assert.equal(c3.items.length, 1, 'the window beats the phantom debt: a new item for the holder')
  assert.ok(wire3.queue.has(qid3), 'and nothing acked the fresh copy away')
})

test('online→offline during a hanging attempt: the derived report says offline, never silence (R14-B1)', async () => {
  const wire = new WireDouble()
  wire.deposit = () => new Promise(() => {})   // hangs forever
  const { a } = await adapter(wire)
  const id = a.submit(te.encode('x'), 0)      // started online
  wire.isOffline = true                        // connectivity drops mid-attempt
  a.advance(DECLARED.statusHorizonMs)          // exactly at the horizon
  assert.deepEqual(a.status(id), { state: 'awaiting-transport', reason: 'offline' },
    'the snapshot precedence answers offline — no silent cell, no invented unreachable')
  wire.isOffline = null                        // signal gone: precedence falls through
  assert.deepEqual(a.status(id), { state: 'awaiting-transport', reason: 'transport-unreachable' },
    'without the offline signal the overdue attempt reports honestly')
})

test('restoring without a finite restoredAt is refused', async () => {
  await assert.rejects(adapter(new WireDouble(), { concluded: [], pending: [] }), /restoredAt/)
})

test('max-queue-bytes counts buffered AND outstanding together', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const mk = (fill) => { const b = new Uint8Array(6 * 1_048_576); b[0] = fill; return b }
  await wire.deliverFromPeer(mk(1)); a.collect(0)
  await wire.deliverFromPeer(mk(2)); a.collect(1)
  const qid3 = await wire.deliverFromPeer(mk(3))
  assert.equal(a.collect(2).items.length, 0)
  assert.ok(wire.queue.has(qid3))
})

test('empty collections create no register entry; floor guarantee holds', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  for (let i = 0; i < 50; i++) a.conclude(a.collect(i), i)
  for (let i = 0; i < DECLARED.queueFloorCount; i++) {
    await wire.deliverFromPeer(te.encode('f' + i))
  }
  const c = a.collect(100)
  assert.equal(c.items.length, DECLARED.queueFloorCount)
  a.conclude(c, 101); await a.settle()
  assert.equal(wire.queue.size, 0)
})

test('a hanging AUTH extends no window: beyond it the arrival is new and no ack was ever sent (R16-B1)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const bytes = te.encode('authhang')
  await wire.deliverFromPeer(bytes)
  const c = a.collect(0)
  let releaseAuth
  const realChallenge = wire.authChallenge.bind(wire)
  wire.authChallenge = async (did) => {
    await new Promise((res) => { releaseAuth = res })
    return realChallenge(did)
  }
  wire.tokenSeq = 0; a.conclude(c, 1)            // flush starts, auth hangs
  let acks = 0
  const realAck = wire.ackReceived.bind(wire)
  wire.ackReceived = async (t, ids) => { acks++; return realAck(t, ids) }
  a.advance(1 + DECLARED.duplicateWindowMs)       // window closes under the hanging auth
  await wire.redeliverAll()
  const c2 = a.collect(2 + DECLARED.duplicateWindowMs)
  assert.equal(c2.items.length, 1, 'beyond the window the arrival is a NEW item — no auth-stretched stay')
  while (!releaseAuth) await new Promise((r) => setTimeout(r, 1))
  releaseAuth()
  await a.settle()
  assert.equal(acks, 0, 'the fallen intent was never sent — nothing acked the fresh copy away')
  assert.ok(wire.queue.size >= 1, 'the mediator copy survives for the new collection')
})

test('the stay covers only an ack ON the wire: expiry and absorption defer to its return (R15-B1)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const bytes = te.encode('ackfly')
  await wire.deliverFromPeer(bytes)
  const c = a.collect(0)
  let releaseAck
  const realAck = wire.ackReceived.bind(wire)
  wire.ackReceived = async (t, ids) => {
    await new Promise((res) => { releaseAck = res })
    return realAck(t, ids)
  }
  a.conclude(c, 1)
  while (!releaseAck) await new Promise((r) => setTimeout(r, 1))   // the ack IS on the wire
  a.advance(1 + DECLARED.duplicateWindowMs)       // window closes under the flying ack
  assert.equal(a.ackState().concluded.length, 1, 'expiry is stayed while the ack flies')
  await wire.redeliverAll()
  assert.equal(a.collect(2 + DECLARED.duplicateWindowMs).items.length, 0,
    'absorption is stayed too — the irrecallable ack cannot delete an unabsorbed copy')
  releaseAck()
  await a.settle()
  assert.equal(a.ackState().concluded.length, 0, 'the account settles the moment the call returns')
  assert.equal(a.ackState().pending.length, 0)
})

test('the live filter is WINDOW-live: an unswept expired id never reaches the wire (R17-B1)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const oldBytes = te.encode('old-item')
  await wire.deliverFromPeer(oldBytes)
  const c1 = a.collect(0)
  wire.ackFailure = true
  a.conclude(c1, 1); await a.settle()          // old intent, ack lost
  wire.ackFailure = false
  // move the clock to the window edge WITHOUT advance (no prune runs)
  const fresh = te.encode('fresh-item')
  await wire.deliverFromPeer(fresh)
  const c2 = a.collect(1 + DECLARED.duplicateWindowMs)
  let acked = []
  const realAck = wire.ackReceived.bind(wire)
  wire.ackReceived = async (t, ids) => { acked.push(...ids); return realAck(t, ids) }
  a.conclude(c2, 1 + DECLARED.duplicateWindowMs)  // new flush at the edge
  await a.settle()
  const oldId = await queueIdOf(oldBytes)
  assert.ok(!acked.includes(oldId), 'the expired-but-unswept id was never sent')
  assert.ok(acked.includes(await queueIdOf(fresh)), 'the live id was')
})

test('give-up precedence: a standing offline signal blocks the unroutable verdict (R17-B3)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  wire.depositFailure = 'refused-admission'
  const id = a.submit(te.encode('x'), 0)
  await a.settle()
  wire.isOffline = true                         // wire drops before the horizon
  a.advance(DECLARED.giveUpHorizonMs)
  assert.deepEqual(a.status(id), { state: 'failed', reason: 'expired-by-adapter-policy' },
    'offline at the horizon outranks the stored admission class')
})

test('a late-returning ack sweeps nothing on a retired instance (R17-B2)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  await wire.deliverFromPeer(te.encode('m'))
  const c = a.collect(0)
  let releaseAck
  const realAck = wire.ackReceived.bind(wire)
  wire.ackReceived = async (t, ids) => {
    await new Promise((res) => { releaseAck = res })
    return realAck(t, ids)
  }
  a.conclude(c, 1)
  while (!releaseAck) await new Promise((r) => setTimeout(r, 1))
  a.advance(1 + DECLARED.duplicateWindowMs)     // window closes under the flying ack
  a.close()
  const before = a.ackState()
  releaseAck()
  await a.settle()
  assert.deepEqual(a.ackState(), before,
    'the final-persist surface is byte-stable across the late return')
})

// ── lifecycle (R4-B5) ────────────────────────────────────────────────
test('close(): every state port is inert — including acknowledged and receiverRefused', async () => {
  const wire = new WireDouble()
  let release
  wire.deposit = () => new Promise((res) => { release = res })
  const { a } = await adapter(wire)
  const id = a.submit(te.encode('x'), 0)
  while (!release) await new Promise((r) => setTimeout(r, 1))
  a.close()
  release()
  await a.settle()
  // status is a port: a retired instance refuses instead of answering
  // with reports whose horizons it no longer drives (R5-B3)
  assert.throws(() => a.status(id), /retired/)
  assert.throws(() => a.has(id), /retired/)
  a.acknowledged(id)                       // inbound reports: no-ops
  a.receiverRefused(id, 'proofInvalid')
  assert.throws(() => a.drainTransitions(), /retired/)
  assert.throws(() => a.keylistSynced, /retired/)
  assert.throws(() => a.submit(te.encode('y'), 1), /retired/)
  assert.throws(() => a.collect(1), /retired/)
  assert.throws(() => a.advance(1), /retired/)
  assert.throws(() => a.register(['rk'], 1), /retired/)
  assert.deepEqual(a.ackState(), { concluded: [], pending: [], send: { mode: 'routed', open: [] } })
})

test('a late success outranks the interim horizon report — accepted, sent once (R5-B1)', async () => {
  const wire = new WireDouble()
  let release
  const realDeposit = wire.deposit.bind(wire)
  wire.deposit = async (t, b, e) => {
    await new Promise((res) => { release = res })
    return realDeposit(t, b, e)
  }
  const { a } = await adapter(wire)
  const id = a.submit(te.encode('slow'), 0)
  a.advance(DECLARED.statusHorizonMs)
  assert.deepEqual(a.status(id), { state: 'awaiting-transport', reason: 'transport-unreachable' })
  while (!release) await new Promise((r) => setTimeout(r, 1))
  release()
  await a.settle()
  assert.deepEqual(a.status(id), { state: 'accepted' }, 'the real outcome displaces the interim report')
  a.advance(DECLARED.statusHorizonMs + 1)
  await a.settle()
  assert.equal(wire.deposited.length, 1, 'and the bytes were sent exactly once')
})

test('close during the auth handshake: neither authenticate nor deposit starts afterwards (R5-B2/R6-B1)', async () => {
  const wire = new WireDouble()
  let releaseAuth
  const realChallenge = wire.authChallenge.bind(wire)
  wire.authChallenge = async (did) => {
    await new Promise((res) => { releaseAuth = res })
    return realChallenge(did)
  }
  let authenticateCalls = 0
  const realAuth = wire.authenticate.bind(wire)
  wire.authenticate = async (ans) => { authenticateCalls++; return realAuth(ans) }
  const { a } = await adapter(wire)
  a.submit(te.encode('x'), 0)
  while (!releaseAuth) await new Promise((r) => setTimeout(r, 1))
  a.close()
  releaseAuth()
  await a.settle()
  assert.equal(authenticateCalls, 0, 'not even the challenge answer starts on a retired instance')
  assert.equal(wire.deposited.length, 0)
})

test('retryable counterpart conditions are refused by the terminal refusal channel (R6-B2)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const id = a.submit(te.encode('x'), 0)
  await a.settle()
  assert.throws(() => a.receiverRefused(id, 'unavailable'), /transport outcomes/)
  assert.throws(() => a.receiverRefused(id, 'internalError'), /transport outcomes/)
  assert.deepEqual(a.status(id), { state: 'accepted' }, 'no verdict was minted')
})

test('a conclusion instant after restoredAt is refused (R5-B4)', async () => {
  await assert.rejects(
    adapter(new WireDouble(), { concluded: [{ queueId: 'aa', concludedAt: 100 }], pending: [] }, 50),
    /after restoredAt/,
  )
})

test('runtime identity fields are unwritable; the create tuple is snapshotted at entry (R8-B1/B2)', async () => {
  const wire = new WireDouble()
  const { a, conn, egress } = await adapter(wire)
  assert.throws(() => { a.connectionDid = 'did:key:zForged' }, TypeError)
  assert.throws(() => { a.egressDid = 'did:key:zForged' }, TypeError)
  assert.equal(a.connectionDid, conn.did)
  assert.equal(a.egressDid, egress.did)

  const ikm = new Uint8Array(32).fill(7)
  const nonce = new Uint8Array(32).fill(9)
  const pending = MediatorCarrierAdapter.create(ikm, MEDIATOR_DID, nonce, new WireDouble())
  ikm.fill(1); nonce.fill(2)             // mutate while the factory awaits
  const b = await pending
  const clean = await identities(new Uint8Array(32).fill(7), new Uint8Array(32).fill(9))
  assert.equal(b.principal, clean.p.principal, 'the tuple was read once, at entry')
  assert.equal(b.connectionDid, clean.conn.did)
  assert.equal(b.egressDid, clean.egress.did)
})

test('a validated refusal during the report-less phase survives the deposit resolution (R9-B2)', async () => {
  const wire = new WireDouble()
  let release
  const realDeposit = wire.deposit.bind(wire)
  wire.deposit = async (t, b, e) => {
    await new Promise((res) => { release = res })
    return realDeposit(t, b, e)
  }
  const { a } = await adapter(wire)
  const id = a.submit(te.encode('x'), 0)
  assert.equal(a.status(id), null)
  // establish the claimed causal order: the deposit call has actually
  // reached the mediator (its hang point) BEFORE the counterpart's
  // validated refusal arrives (R10-N4)
  while (!release) await new Promise((r) => setTimeout(r, 1))
  a.receiverRefused(id, 'proofInvalid')
  assert.deepEqual(a.status(id), { state: 'failed', reason: 'rejected-by-receiver', code: 'proofInvalid' })
  while (!release) await new Promise((r) => setTimeout(r, 1))
  release()
  await a.settle()
  assert.deepEqual(a.status(id), { state: 'failed', reason: 'rejected-by-receiver', code: 'proofInvalid' },
    'the late accepted never displaces the real terminal verdict')
})

test('getter overrides never reach the wire; duplicate acks never rewrite late (R9-B1/M4)', async () => {
  const wire = new WireDouble()
  const { a, conn, egress } = await adapter(wire)
  Object.defineProperty(a, 'connectionDid', { value: 'did:key:zForged', configurable: true })
  Object.defineProperty(a, 'egressDid', { value: a.principal, configurable: true })
  a.submit(te.encode('x'), 0)
  await a.settle()
  for (const did of wire.authDids) assert.equal(did, conn.did, 'the wire saw the real connection DID')
  assert.equal(wire.deposited[0].egressDid, egress.did, 'and the real egress identity — never the principal')

  const wire2 = new WireDouble()
  wire2.depositFailure = 'unreachable'
  const { a: a2 } = await adapter(wire2)
  const id = a2.submit(te.encode('y'), 0)
  await a2.settle()
  a2.advance(DECLARED.giveUpHorizonMs)
  a2.acknowledged(id)
  assert.deepEqual(a2.status(id), { state: 'delivered', late: true })
  a2.acknowledged(id)
  assert.deepEqual(a2.status(id), { state: 'delivered', late: true }, 'idempotent: late stays true')
})

test('teardown edge: a stray ack consumes one copy; later copies land (priced in §6.1 coin, R19/R20)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const bytes = te.encode('retrans')
  await wire.deliverFromPeer(bytes)
  const c = a.collect(0)
  let releaseAck
  const realAck = wire.ackReceived.bind(wire)
  wire.ackReceived = async (t, ids) => {
    await new Promise((res) => { releaseAck = res })
    return realAck(t, ids)
  }
  a.conclude(c, 1)
  while (!releaseAck) await new Promise((r) => setTimeout(r, 1))
  a.close()                                        // ack still flying at teardown
  // successor far beyond the window: expired entry falls at restore
  const { a: a2 } = await adapter(wire, a.ackState(), 2 * DECLARED.duplicateWindowMs)
  wire.ackReceived = realAck                       // successor's own acks work normally
  wire.onDeliver(wire.consumer)
  const qid = await queueIdOf(bytes)
  wire.queue.set(qid, bytes.slice())               // sender retransmits: queued at the mediator
  releaseAck()                                     // the stray ack lands ONCE and deletes that copy
  await a.settle()
  assert.equal(wire.queue.size, 0, 'one transmission lost — like any single transport loss')
  await wire.deliverFromPeer(bytes)                // a later application resubmission
  const c2 = a2.collect(1 + 2 * DECLARED.duplicateWindowMs)
  assert.equal(c2.items.length, 1, 'a later copy meets no stray ack and reaches the successor')
})

test('within the window a retried ack deletes only what absorption would swallow anyway (R21)', async () => {
  const wire = new WireDouble()
  const ikm = crypto.getRandomValues(new Uint8Array(32))
  const nonce = crypto.getRandomValues(new Uint8Array(32))
  const a = await MediatorCarrierAdapter.create(ikm, MEDIATOR_DID, nonce, wire)
  const bytes = te.encode('equiv')
  await wire.deliverFromPeer(bytes)
  const c = a.collect(0)
  // acks reach the mediator (which deletes) but every RESPONSE is
  // lost — the ambivalent error edge: pending survives, retries run
  let ackCalls = 0
  const realAck = wire.ackReceived.bind(wire)
  wire.ackReceived = async (t, ids) => { ackCalls++; await realAck(t, ids); throw new WireError('unreachable') }
  a.conclude(c, 1); await a.settle()
  a.close()
  // the SAME (root, C, N): a genuine successor of this relationship
  const a2 = await MediatorCarrierAdapter.create(ikm, MEDIATOR_DID, nonce, wire, a.ackState(), 2)
  wire.onDeliver(wire.consumer)
  const qid = await queueIdOf(bytes)
  for (let i = 0; i < 3; i++) {
    wire.queue.set(qid, bytes.slice())     // a resubmitted byte-identical copy
    a2.advance(3 + i); await a2.settle()   // retry lands, deletes it, response lost again
    assert.equal(wire.queue.size, 0, 'deleted by the retried ack')
    // PORT-EQUIVALENCE: had the copy been DELIVERED instead, the
    // window absorption would have swallowed it just the same
    await wire.deliverFromPeer(bytes)
    assert.equal(a2.collect(3 + i).items.length, 0,
      'inside the window the copy never surfaces either way — deletion adds no loss')
    a2.conclude({ id: 'c-empty' }, 3 + i)
  }
  assert.ok(ackCalls >= 3, 'retries ran — and none of them changed what the holder observes')
  // beyond the window no intent survives: the account is closed
  a2.advance(4 + DECLARED.duplicateWindowMs); await a2.settle()
  assert.equal(a2.ackState().pending.length, 0)
  await wire.deliverFromPeer(bytes)
  const c3 = a2.collect(5 + DECLARED.duplicateWindowMs)
  assert.equal(c3.items.length, 1, 'beyond the window every copy lands — nothing is left to delete it')
  a2.conclude(c3, 6 + DECLARED.duplicateWindowMs)
  wire.ackReceived = realAck
  a2.advance(7 + DECLARED.duplicateWindowMs); await a2.settle()
})

test('one stray call, many digests: it deletes one copy per digest it was sealed with — no more (R24-N)', async () => {
  const wire = new WireDouble()
  const ikm = crypto.getRandomValues(new Uint8Array(32))
  const nonce = crypto.getRandomValues(new Uint8Array(32))
  const a = await MediatorCarrierAdapter.create(ikm, MEDIATOR_DID, nonce, wire)
  const bytesA = te.encode('digest-a')
  const bytesB = te.encode('digest-b')
  await wire.deliverFromPeer(bytesA)
  await wire.deliverFromPeer(bytesB)
  const c = a.collect(0)
  let releaseAck
  const realAck = wire.ackReceived.bind(wire)
  wire.ackReceived = async (t, ids) => {
    await new Promise((res) => { releaseAck = res })
    return realAck(t, ids)
  }
  a.conclude(c, 1)                                 // ONE flush, batching both digests
  while (!releaseAck) await new Promise((r) => setTimeout(r, 1))
  a.close()                                        // the stray flies with its sealed two-digest batch
  const a2 = await MediatorCarrierAdapter.create(ikm, MEDIATOR_DID, nonce, wire,
    a.ackState(), 2 * DECLARED.duplicateWindowMs)  // successor beyond the window: nothing survives
  wire.onDeliver(wire.consumer)
  const qa = await queueIdOf(bytesA)
  const qb = await queueIdOf(bytesB)
  wire.queue.set(qa, bytesA.slice())               // fresh post-window copies of BOTH digests
  wire.queue.set(qb, bytesB.slice())
  releaseAck()                                     // the stray lands once
  await a.settle()
  assert.equal(wire.queue.size, 0, 'one copy fell per sealed digest — the priced reach of one call')
  wire.ackReceived = realAck                       // the successor's own acks work normally
  await wire.deliverFromPeer(bytesA)               // the NEXT copies meet no stray
  await wire.deliverFromPeer(bytesB)
  const c2 = a2.collect(1 + 2 * DECLARED.duplicateWindowMs)
  assert.equal(c2.items.length, 2, 'beyond the sealed batch, every copy lands')
  a2.conclude(c2, 2 + 2 * DECLARED.duplicateWindowMs); await a2.settle()
})

// ── clock discipline ─────────────────────────────────────────────────
test('non-finite time throws; the clock is a high-water mark', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  assert.throws(() => a.submit(te.encode('z'), Number.NaN))
  const id = a.submit(te.encode('z'), 5_000)
  await a.settle()
  a.advance(1_000)
  assert.equal(a.status(id).state, 'accepted')
})

// ── the ports' DeliveryReport (lib Stage 2, PR 3; note §4.3, §4.6) ──────

test('deliveryReportOf maps every SubmissionState onto the ports\' DeliveryReport, one to one', () => {
  const d = 'uDoc'
  const cases = [
    [{ state: 'awaiting-transport', reason: 'offline' }, { digest: d, status: 'awaiting-transport', reason: 'offline' }],
    [{ state: 'awaiting-transport', reason: 'transport-unreachable' }, { digest: d, status: 'awaiting-transport', reason: 'transport-unreachable' }],
    [{ state: 'awaiting-transport', reason: 'carrier-refused-retriable' }, { digest: d, status: 'awaiting-transport', reason: 'carrier-refused-retriable' }],
    [{ state: 'accepted' }, { digest: d, status: 'accepted' }],
    [{ state: 'delivered', late: false }, { digest: d, status: 'delivered', late: false }],
    [{ state: 'delivered', late: true }, { digest: d, status: 'delivered', late: true }],
    [{ state: 'failed', reason: 'unroutable' }, { digest: d, status: 'failed', reason: 'unroutable' }],
    [{ state: 'failed', reason: 'oversize' }, { digest: d, status: 'failed', reason: 'oversize' }],
    [{ state: 'failed', reason: 'expired-by-adapter-policy' }, { digest: d, status: 'failed', reason: 'expired-by-adapter-policy' }],
    ...['malformedRequest', 'unsupportedType', 'proofRequired', 'proofInvalid', 'wrongRecipient', 'identityMismatch'].map((code) =>
      [{ state: 'failed', reason: 'rejected-by-receiver', code }, { digest: d, status: 'failed', reason: 'rejected-by-receiver', code }]),
  ]
  for (const [st, report] of cases) assert.deepEqual(deliveryReportOf(d, st), report, JSON.stringify(st))
})

test('reconcile files the holder\'s custody set; report(id) feeds holder.report keyed by the digest (Delivery 0.83)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const { holderA } = await pair()
  const out = (await holderA.act('note.send', {}, T0)).outbound[0]
  assert.deepEqual(await holderA.pendingTransport(T0), { ok: false, code: 'not-resumed' }, 'no view before the opening\'s resume')
  await holderA.resume(T0)
  const view = await holderA.pendingTransport(T0)
  assert.deepEqual(view.entries.map((e) => [e.digest, e.kind, e.since]), [[out.digest, 'document', T0]])
  const [ref] = a.reconcile(view, holderA, 0)
  assert.deepEqual(Object.keys(ref).sort(), ['digest', 'submissionId'])
  assert.equal(ref.digest, out.digest)
  assert.deepEqual(a.reconcile(view, holderA, 0), [], 'filed once per digest')
  await a.settle()
  const rep = a.report(ref.submissionId)
  assert.deepEqual(rep, { digest: out.digest, status: 'accepted' })
  assert.deepEqual(JSON.parse(new TextDecoder().decode(wire.deposited[0].bytes)), out.envelope)
  const r = await holderA.report(rep, T0 + 1)
  assert.deepEqual(r.events.map((e) => [e.type, e.digest, e.status]), [['delivery.status', out.digest, 'accepted']])
  assert.deepEqual(wire.deposited.length, 1)
  assert.deepEqual((await holderA.pendingTransport(T0 + 1)).entries, [], 'accepted: custody ends')
  // a submission filed without a digest has no report form
  const bare = a.submit(te.encode('x'), 0)
  await a.settle()
  assert.throws(() => a.report(bare), /reconcile/)
  assert.throws(() => a.reconcile({ entries: [] }, holderA, 0), /pendingTransport/)
  assert.throws(() => a.reconcile(view, {}, 0), /gate/)
})

test('reconcile: a digest the view no longer names is withdrawn before the trias, never sent; a closed holder sends nothing (RLTP-DEL-6125, 6135)', async () => {
  const wire = new WireDouble()
  wire.isOffline = true
  const { a } = await adapter(wire)
  const { holderA, storeA, A } = await pair()
  const one = (await holderA.act('note.send', {}, T0)).outbound[0]
  const two = (await holderA.act('note.send', {}, T0 + 1)).outbound[0]
  await holderA.resume(T0 + 2)
  const refs = a.reconcile(await holderA.pendingTransport(T0 + 2), holderA, 0)
  assert.equal(refs.length, 2)
  // the holder records `one` accepted (another opening's report, say): the next view lacks it
  await holderA.report({ digest: one.digest, status: 'accepted' }, T0 + 3)
  assert.deepEqual(a.reconcile(await holderA.pendingTransport(T0 + 3), holderA, 0), [])
  assert.equal(a.has(refs.find((r) => r.digest === one.digest).submissionId), false, 'withdrawn')
  // the lock: the holder closes, the adapter still holds `two` and comes online
  holderA.close()
  wire.isOffline = false
  a.advance(1)
  await a.settle()
  assert.deepEqual(wire.deposited, [], 'nothing went out after the close')
  assert.equal(a.has(refs.find((r) => r.digest === two.digest).submissionId), false, 'the gate said no: withdrawn')
  // the next opening: a new holder over the store, resumed, offers `two`
  // again — byte-identical — and the new adapter instance sends it
  const { createHolder } = await import('../dist/index.js')
  const { noteModule } = await import('./pair-fixture.mjs')
  const again = await createHolder({ store: storeA, keys: A.keys }, { modules: [noteModule()] })
  await assert.rejects(holderA.pendingTransport(T0 + 4), (e) => e.code === 'closed', 'the old opening runs nothing')
  await again.resume(T0 + 4)
  const view = await again.pendingTransport(T0 + 4)
  assert.deepEqual(view.entries.map((e) => [e.digest, e.since]), [[two.digest, T0 + 1]])
  const wire2 = new WireDouble()
  const { a: a2 } = await adapter(wire2)
  assert.equal(a2.reconcile(view, holderA, 1).length, 1, 'filed …')
  await a2.settle()
  assert.equal(wire2.deposited.length, 0, '… but the closed opening as gate refuses it')
  assert.throws(() => a2.reconcile(view, again, 2), /one adapter per opening/)
  const { a: a3 } = await adapter(wire2)
  const [ref2] = a3.reconcile(view, again, 2)
  await a3.settle()
  assert.equal(wire2.deposited.length, 1)
  assert.deepEqual(JSON.parse(new TextDecoder().decode(wire2.deposited[0].bytes)), two.envelope, 'the envelope the holder kept')
  assert.deepEqual(a3.report(ref2.submissionId), { digest: two.digest, status: 'accepted' })
})

// ── lib 0.5.0: the selective conclusion (Delivery RLTP-DEL-5810, 5820) ──

test('conclude with keep: a collected item whose disposition is transient (failed(rate-limited)) is not concluded — it goes back to the buffer, the next collect offers it again, the mediator keeps its copy; the rest of the collection is concluded (RLTP-DEL-5820, 6280)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const q1 = await wire.deliverFromPeer(te.encode('one'))
  const q2 = await wire.deliverFromPeer(te.encode('two'))
  const c = a.collect(0)
  assert.deepEqual(c.items.map((i) => i.queueId).sort(), [q1, q2].sort())
  a.conclude(c, 1, { keep: [q2] })
  await a.settle()
  assert.deepEqual([...wire.queue.keys()], [q2], 'only the concluded copy is released at the mediator')
  assert.deepEqual(a.ackState().concluded.map((x) => x.queueId), [q1])
  const again = a.collect(2)
  assert.deepEqual(again.items.map((i) => i.queueId), [q2], 'offered again')
  // a redelivery by the mediator meanwhile is absorbed: one copy in the buffer
  await wire.deliverFromPeer(te.encode('two'))
  assert.equal(a.collect(3).items.length, 0)
  a.conclude(again, 4)
  await a.settle()
  assert.equal(wire.queue.size, 0)
})

test('conclude with keep: ids that are not in the collection are ignored; keep never concludes, never acks (RLTP-DEL-5810)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const q = await wire.deliverFromPeer(te.encode('only'))
  const c = a.collect(0)
  a.conclude(c, 1, { keep: [q, 'not-in-it'] })
  await a.settle()
  assert.deepEqual(a.ackState(), { concluded: [], pending: [], send: { mode: 'routed', open: [] } })
  assert.equal(wire.queue.size, 1)
  assert.deepEqual(a.collect(2).items.map((i) => i.queueId), [q])
})

test('concludable: every receive outcome but failed(rate-limited) is terminal (RLTP-DEL-5820; 5a.8)', async () => {
  const { concludable } = await import('@real-life/trust-protocol/adapters/vti-mediator')
  assert.equal(concludable({ disposition: 'unique', digest: 'u', type: 't', outbound: [], events: [] }), true)
  assert.equal(concludable({ disposition: 'duplicate-known', digest: 'u', outbound: [] }), true)
  assert.equal(concludable({ disposition: 'discarded', digest: 'u', type: 't', reason: 'resource-limit' }), true)
  assert.equal(concludable({ disposition: 'failed', reason: 'validation-failed', stage: 8 }), true)
  assert.equal(concludable({ disposition: 'failed', reason: 'stale-issuance', stage: 9 }), true)
  assert.equal(concludable({ disposition: 'failed', reason: 'rate-limited', stage: 8 }), false)
})

test('the holder and the adapter: a rate-limited message stays at its carrier and is accepted once the rate has room (RLTP-MSG-4120, 4140; RLTP-DEL-5820)', async () => {
  const { concludable } = await import('@real-life/trust-protocol/adapters/vti-mediator')
  const { holderA, holderB, storeB } = await pair()
  // B's tuple ready, A's too: a note each way
  await holderA.receive((await holderB.act('note.send', { text: 'hi' }, T0)).outbound[0].envelope, T0 + 1)
  await holderB.receive((await holderA.act('note.send', { text: 'hi' }, T0 + 2)).outbound[0].envelope, T0 + 3)
  const m = await holderA.sendMessage('c1', 'hello', { when: T0 + 4, actId: 'm1' })
  assert.equal(m.ok, true, JSON.stringify(m))
  // B's rate for r1 is exhausted in the window
  const { state, version } = await storeB.read()
  const s = structuredClone(state); s.messages.rates.r1 = { invites: [], messages: Array.from({ length: 500 }, () => T0) }
  await storeB.commit(version, s)
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const bytes = te.encode(JSON.stringify(m.outbound[0].envelope))
  const q = await wire.deliverFromPeer(bytes)
  const run = async (when) => {
    const c = a.collect(when)
    const keep = []
    for (const it of c.items) {
      const got = await holderB.receive(JSON.parse(new TextDecoder().decode(it.bytes)), when)
      if (!concludable(got)) keep.push(it.queueId)
    }
    a.conclude(c, when, { keep })
    await a.settle()
    return keep
  }
  assert.deepEqual(await run(T0 + 10), [q], 'rate-limited: kept')
  assert.equal(wire.queue.size, 1, 'the mediator keeps its copy')
  assert.deepEqual(await run(T0 + 86_400_000 + 10), [], 'accepted after the window, concluded')
  assert.equal(wire.queue.size, 0)
  assert.equal((await holderB.inbox()).length, 1)
})

test('conclude with keep (review 112-1): the collected bytes are the caller\'s own copies — mutated or transferred, the kept item comes back intact under its digest', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const q = await wire.deliverFromPeer(te.encode('intact'))
  const c = a.collect(0)
  c.items[0].bytes.fill(0x21)                                   // the app scribbles over its copy
  structuredClone(c.items[0].bytes.buffer, { transfer: [c.items[0].bytes.buffer] })   // and transfers the buffer
  a.conclude(c, 1, { keep: [q] })
  const again = a.collect(2)
  assert.equal(new TextDecoder().decode(again.items[0].bytes), 'intact')
  assert.equal(again.items[0].queueId, q)
})

test('conclude with keep (review 112-2): a Node Buffer delivered is copied in and out — mutated, the kept item still comes back intact under its digest', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const q = await wire.deliverFromPeer(Buffer.from('intact'))
  const c = a.collect(0)
  c.items[0].bytes.fill(33)
  a.conclude(c, 1, { keep: [q] })
  const again = a.collect(2)
  assert.equal(new TextDecoder().decode(again.items[0].bytes), 'intact')
  assert.equal(again.items[0].queueId, q)
})

test('submit (review 112-3): the adapter keeps its own copy of a submission and hands each deposit attempt a fresh one — the caller\'s Buffer mutated after submit, or the wire scribbling over a failed attempt\'s bytes, never changes what is sent', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const input = Buffer.from('intact')
  a.submit(input, 0)
  input.fill(33)                                                // the caller mutates its Buffer
  await a.settle()
  assert.equal(new TextDecoder().decode(wire.deposited[0].bytes), 'intact')

  const wire2 = new WireDouble()
  const { a: a2 } = await adapter(wire2)
  const real = wire2.deposit.bind(wire2)
  let first = true
  wire2.deposit = async (t, bytes, egress) => {
    if (first) { first = false; bytes.fill(33); throw new WireError('unreachable') }   // scribbles, then fails
    return real(t, bytes, egress)
  }
  a2.submit(te.encode('intact'), 0)
  await a2.settle()
  a2.advance(DECLARED.statusHorizonMs + 1)
  await a2.settle()
  assert.equal(new TextDecoder().decode(wire2.deposited[0].bytes), 'intact', 'the retry sends the original')
})

test('ack flush (review 112-4): the wire gets its own id list — a wire that empties it neither keeps the ids in flight nor extends their absorption past the duplicate window', async () => {
  for (const mutate of [false, true]) {
    const wire = new WireDouble()
    const real = wire.ackReceived.bind(wire)
    wire.ackReceived = async (t, ids) => { const copy = [...ids]; if (mutate) ids.splice(0); return real(t, copy) }
    const { a } = await adapter(wire)
    const bytes = te.encode('once')
    await wire.deliverFromPeer(bytes)
    a.conclude(a.collect(0), 1)
    await a.settle()
    a.advance(1 + DECLARED.duplicateWindowMs + 1)
    await a.settle()
    await wire.deliverFromPeer(bytes)
    assert.equal(a.collect(2 + DECLARED.duplicateWindowMs).items.length, 1, `after the window the same bytes are a new item (wire mutates: ${mutate})`)
  }
})

test('object boundaries (review 112-5): status() answers copies, the keylist the wire gets is its own, DECLARED is frozen, the token sets the wire answers are copied in', async () => {
  // status
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const id = a.submit(te.encode('s'), 0)
  await a.settle()
  const st = a.status(id)
  assert.equal(st.state, 'accepted')
  Object.assign(st, { state: 'delivered', late: false })
  assert.equal(a.status(id).state, 'accepted', 'the adapter\'s own state is untouched')
  // keylist: the wire changes its old argument list into the new desire
  const wire2 = new WireDouble()
  let release, seenList
  wire2.keylistUpdate = async (t, rkids) => { seenList = rkids; await new Promise((r) => { release = r }) }
  const { a: a2 } = await adapter(wire2)
  a2.register(['old'], 0)
  while (!release) await new Promise((r) => setTimeout(r, 1))
  a2.register(['new'], 1)
  seenList.splice(0, seenList.length, 'new')
  release()
  await a2.settle()
  assert.equal(a2.keylistSynced, false, 'no update for the new desire has happened')
  // DECLARED
  assert.ok(Object.isFrozen(DECLARED))
  assert.throws(() => { 'use strict'; DECLARED.duplicateWindowMs = 1 }, TypeError)
  // tokens
  const wire3 = new WireDouble()
  const realAuth = wire3.authenticate.bind(wire3)
  let handed
  wire3.authenticate = async (x) => { handed = await realAuth(x); return handed }
  const { a: a3 } = await adapter(wire3)
  a3.submit(te.encode('one'), 0)
  await a3.settle()
  const token = handed.accessToken
  handed.accessToken = 'forged'
  const seenTokens = []
  const realDeposit = wire3.deposit.bind(wire3)
  wire3.deposit = async (t, b, e) => { seenTokens.push(t); return realDeposit(t, b, e) }
  a3.submit(te.encode('two'), 1)
  await a3.settle()
  assert.deepEqual(seenTokens, [token], 'the adapter kept its own copy of the token set')
})

// ── Astra review 1 on #115 ─────────────────────────────────────────────

test('reconcile (#115 R1-2): an entry taken over past the adapter horizon counted from its first submission is given up, never deposited (RLTP-DEL-6130)', async () => {
  const wire = new WireDouble()
  const { holderA, storeA, A } = await pair()
  await holderA.act('note.send', {}, T0)
  holderA.close()
  const { createHolder } = await import('../dist/index.js')
  const { noteModule } = await import('./pair-fixture.mjs')
  const again = await createHolder({ store: storeA, keys: A.keys }, { modules: [noteModule()] })
  const at = T0 + 4 * 86_400_000
  await again.resume(at)
  const view = await again.pendingTransport(at)
  assert.equal(view.entries.length, 1, 'still inside the holder\'s own horizon (P7D)')
  const { a } = await adapter(wire)
  const [ref] = a.reconcile(view, again, at)
  await a.settle()
  assert.equal(wire.deposited.length, 0)
  assert.deepEqual(a.report(ref.submissionId), { digest: ref.digest, status: 'failed', reason: 'expired-by-adapter-policy' })
})

test('reconcile (#115 R1-1): a deadline passed while the holder checked stops the deposit — the adapter re-checks inside the holder\'s step', async () => {
  const wire = new WireDouble()
  const { holderA } = await pair()
  await holderA.act('note.send', {}, T0)
  await holderA.resume(T0)
  const view = await holderA.pendingTransport(T0)
  const { a } = await adapter(wire)
  const late = view.entries[0].since + DECLARED.giveUpHorizonMs
  const slow = { closed: false, handOver: async (e, w, start) => { a.advance(late); return holderA.handOver(e, w, start) } }
  const [ref] = a.reconcile(view, slow, T0)
  await a.settle()
  assert.equal(wire.deposited.length, 0)
  assert.equal(a.report(ref.submissionId).status, 'failed')
})

test('reconcile (#115 R1-3): a duplicate after the ack\'s retries ended is handed over once, through the view', async () => {
  const wire = new WireDouble()
  const { holderA, holderB } = await pair()
  const out = (await holderA.act('note.send', {}, T0)).outbound[0]
  const ack = (await holderB.receive(out.envelope, T0 + 1)).outbound[0]
  const { a } = await adapter(wire)
  await holderB.resume(T0 + 1)
  a.reconcile(await holderB.pendingTransport(T0 + 1), holderB, T0 + 1)
  await a.settle()
  assert.equal(wire.deposited.length, 1)
  await holderB.report({ digest: ack.digest, status: 'accepted' }, T0 + 2)
  const dup = await holderB.receive(out.envelope, T0 + 10 * 86_400_000)
  assert.equal(dup.disposition, 'duplicate-known')
  const v = await holderB.pendingTransport(T0 + 10 * 86_400_000)
  assert.deepEqual(v.entries.map((e) => [e.digest, typeof e.resend]), [[ack.digest, 'number']])
  a.reconcile(v, holderB, T0 + 10 * 86_400_000)
  await a.settle()
  assert.equal(wire.deposited.length, 2)
  assert.deepEqual(JSON.parse(new TextDecoder().decode(wire.deposited[1].bytes)), ack.envelope)
  a.reconcile(await holderB.pendingTransport(T0 + 10 * 86_400_000), holderB, T0 + 10 * 86_400_000)
  a.advance(T0 + 10 * 86_400_000 + 1); await a.settle()
  assert.equal(wire.deposited.length, 2, 'once')
})

test('reconcile (#115 R4-1): a duplicate\'s ack while the ended retries\' submission is still held is a submission of its own, deposited at once', async () => {
  const wire = new WireDouble()
  wire.isOffline = true
  const { holderA, holderB } = await pair()
  const out = (await holderA.act('note.send', {}, T0)).outbound[0]
  const ack = (await holderB.receive(out.envelope, T0 + 1)).outbound[0]
  const { a } = await adapter(wire)
  await holderB.resume(T0 + 1)
  const [held] = a.reconcile(await holderB.pendingTransport(T0 + 1), holderB, T0 + 1)
  await holderB.report(a.report(held.submissionId), T0 + 2)
  const later = T0 + 8 * 86_400_000
  await holderB.resume(later)                       // the ack's retries end at its horizon
  assert.equal((await holderB.receive(out.envelope, later)).disposition, 'duplicate-known')
  wire.isOffline = false
  const refs = a.reconcile(await holderB.pendingTransport(later), holderB, later)
  assert.deepEqual(refs.map((r) => r.digest), [ack.digest])
  assert.equal(a.has(held.submissionId), false, 'the held one withdrawn')
  await a.settle()
  assert.equal(wire.deposited.length, 1)
  assert.deepEqual(a.report(refs[0].submissionId), { digest: ack.digest, status: 'accepted' })
})

test('reconcile (#115 R5-1): each duplicate is a hand-over of its own — two duplicates after the retries, two deposits; one grant reconciled twice, one', async () => {
  const wire = new WireDouble()
  const { holderA, holderB } = await pair()
  const out = (await holderA.act('note.send', {}, T0)).outbound[0]
  const ack = (await holderB.receive(out.envelope, T0 + 1)).outbound[0]
  const { a } = await adapter(wire)
  const later = T0 + 8 * 86_400_000
  await holderB.resume(later)                       // retries over, never sent
  for (let n = 1; n <= 2; n++) {
    await holderB.receive(out.envelope, later + n)
    const v = await holderB.pendingTransport(later + n)
    assert.equal(a.reconcile(v, holderB, later + n).length, 1)
    assert.equal(a.reconcile(v, holderB, later + n).length, 0, 'the same grant: idempotent')
    await a.settle()
    assert.equal(wire.deposited.length, n)
    assert.deepEqual(JSON.parse(new TextDecoder().decode(wire.deposited[n - 1].bytes)), ack.envelope)
  }
})

test('reconcile (#115 R6-1): an adapter serves one opening — the next opening\'s grants go through a new adapter, never mistaken for the old ones', async () => {
  const wire = new WireDouble()
  const { holderA, holderB, storeB, B } = await pair()
  const out = (await holderA.act('note.send', {}, T0)).outbound[0]
  await holderB.receive(out.envelope, T0 + 1)
  const later = T0 + 8 * 86_400_000
  await holderB.resume(later)
  await holderB.receive(out.envelope, later)
  const { a } = await adapter(wire)
  a.reconcile(await holderB.pendingTransport(later), holderB, later)
  await a.settle()
  assert.equal(wire.deposited.length, 1)
  await holderB.close()
  const { createHolder } = await import('../dist/index.js')
  const { noteModule } = await import('./pair-fixture.mjs')
  const next = await createHolder({ store: storeB, keys: B.keys }, { modules: [noteModule()] })
  await next.resume(later + 1)
  await next.receive(out.envelope, later + 1)
  const v = await next.pendingTransport(later + 1)
  assert.throws(() => a.reconcile(v, next, later + 1), /one adapter per opening/)
  const { a: fresh } = await adapter(wire)
  assert.equal(fresh.reconcile(v, next, later + 1).length, 1)
  await fresh.settle()
  assert.equal(wire.deposited.length, 2)
})

test('reconcile (#115 R7-1): a duplicate\'s answer does not wait for the retries\' report — accepted by the adapter, unreported at the holder, the duplicate still goes out', async () => {
  const wire = new WireDouble()
  const { holderA, holderB } = await pair()
  const out = (await holderA.act('note.send', {}, T0)).outbound[0]
  const ack = (await holderB.receive(out.envelope, T0 + 1)).outbound[0]
  await holderB.resume(T0 + 1)
  const { a } = await adapter(wire)
  const [first] = a.reconcile(await holderB.pendingTransport(T0 + 1), holderB, T0 + 1)
  await a.settle()
  assert.equal(a.status(first.submissionId).state, 'accepted', 'accepted, not yet reported')
  assert.equal((await holderB.receive(out.envelope, T0 + 2)).disposition, 'duplicate-known')
  const v = await holderB.pendingTransport(T0 + 2)
  assert.deepEqual(v.entries.map((e) => [e.digest, e.resend === undefined ? 'retries' : 'answer']), [[ack.digest, 'retries'], [ack.digest, 'answer']])
  assert.equal(a.reconcile(v, holderB, T0 + 2).length, 1)
  await a.settle()
  assert.equal(wire.deposited.length, 2)
  // the report of the first arrives late: the retries end, the answer stays given
  await holderB.report(a.report(first.submissionId), T0 + 3)
  assert.deepEqual((await holderB.pendingTransport(T0 + 3)).entries, [])
})

test('reconcile (#115 R9-1): a wire refusing while the holder still commits the answer\'s hand-over is a report, never an unhandled rejection', async () => {
  const { holderA, A } = await pair()
  const { InMemoryStore } = await import('../dist/testing.js')
  const { createHolder } = await import('../dist/index.js')
  const { noteModule } = await import('./pair-fixture.mjs')
  // B over a store whose commits can be held
  const p = await pair()
  class Slow extends InMemoryStore { constructor () { super(); this.hold = null } async commit (v, n) { if (this.hold) await this.hold; return super.commit(v, n) } }
  const store = new Slow()
  await store.commit(null, (await p.storeB.read()).state)
  const B = await createHolder({ store, keys: p.B.keys }, { modules: [noteModule()] })
  void A
  const out = (await p.holderA.act('note.send', {}, T0)).outbound[0]
  const ack = (await B.receive(out.envelope, T0 + 1)).outbound[0]
  await B.report({ digest: ack.digest, status: 'accepted' }, T0 + 2)
  await B.receive(out.envelope, T0 + 3)
  await B.resume(T0 + 3)
  const wire = new WireDouble()
  wire.depositFailure = 'unreachable'
  const { a } = await adapter(wire)
  const unhandled = []
  const onU = (e) => unhandled.push(e)
  process.on('unhandledRejection', onU)
  let release; store.hold = new Promise((r) => { release = r })
  const [ref] = a.reconcile(await B.pendingTransport(T0 + 3), B, T0 + 3)
  await new Promise((r) => setTimeout(r, 20))
  store.hold = null; release()
  await a.settle()
  await new Promise((r) => setTimeout(r, 20))
  process.off('unhandledRejection', onU)
  assert.deepEqual(unhandled, [])
  assert.deepEqual(a.report(ref.submissionId), { digest: ack.digest, status: 'awaiting-transport', reason: 'transport-unreachable' })
  void holderA
})

// ── profile 0.24: the sending form and its switch (§3a, RLTP-VTI-3110 to 3140) ──

const H = 3_600_000
const DEADLINE = 72 * H
const gateAll = () => ({ closed: false, handOver: async (_e, _w, start) => start() })
const viewOf = (...entries) => ({ ok: true, entries })
const entryOf = (digest, { kind = 'document', since = 0, resend } = {}) => ({
  digest, kind, envelope: { digest, kind, ...(resend === undefined ? {} : { resend }) }, type: 'test', threadId: 'th-' + digest, recipient: {},
  attempt: 0, since, notAfter: since + 10 * DECLARED.giveUpHorizonMs, ...(resend === undefined ? {} : { resend }),
})
/** a conclusion that leaves nothing pending: collect (empty or not), conclude whole */
const cleanConclude = (a, t) => a.conclude(a.collect(t), t)

const EMPTY = Object.freeze({ mode: 'routed', open: [] })
const openOf = (a) => a.ackState().send.open.map((o) => `${o.digest}@${o.acceptedAt}`)

test('send mode (RLTP-VTI-3110): every instance starts in routed, every deposit names its mode at the wire; a routed document is an open deposit', async () => {
  assert.equal(DECLARED.routedAckDeadlineMs, 72 * H)
  assert.equal(DECLARED.routedAckDeadlineMs, DECLARED.giveUpHorizonMs, 'equal to the give-up horizon (§2)')
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  assert.equal(a.sendMode, 'routed')
  a.submit(te.encode('x'), 0)
  await a.settle()
  a.reconcile(viewOf(entryOf('d1')), gateAll(), 5)
  await a.settle()
  assert.deepEqual(wire.deposited.map((d) => d.mode), ['routed', 'routed'])
  assert.deepEqual(a.ackState().send, { mode: 'routed', open: [{ digest: 'd1', acceptedAt: 5}] },
    'the submit() without a digest opened nothing')
})

test('switch (RLTP-VTI-3130): an open routed deposit at the deadline, checked in an advance after a conclusion that left nothing pending; open deposits leave, every later hand-over goes egress-session', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  a.reconcile(viewOf(entryOf('d1')), gateAll(), 0)
  await a.settle()
  a.advance(DEADLINE)
  assert.equal(a.sendMode, 'routed', 'no conclusion yet: no check')
  cleanConclude(a, DEADLINE)
  assert.equal(a.sendMode, 'routed', 'conclude records, advance checks')
  a.advance(DEADLINE + 1)
  assert.equal(a.sendMode, 'egress-session')
  assert.deepEqual(a.ackState().send, { mode: 'egress-session', open: [] })
  a.submit(te.encode('y'), DEADLINE + 2)
  await a.settle()
  assert.equal(wire.deposited.at(-1).mode, 'egress-session')

  // an ack waiting in the buffer at the deadline holds the check until collected and reported
  const wire2 = new WireDouble()
  const { a: b } = await adapter(wire2)
  const [ref] = b.reconcile(viewOf(entryOf('d1')), gateAll(), 0)
  await b.settle()
  cleanConclude(b, H)
  b.advance(DEADLINE - 1)
  assert.equal(b.sendMode, 'routed', 'before the deadline')
  await wire2.deliverFromPeer(te.encode('the ack of d1'))
  b.advance(DEADLINE)
  assert.equal(b.sendMode, 'routed', 'a frame in the buffer')
  const c = b.collect(DEADLINE)
  b.advance(DEADLINE + 1)
  assert.equal(b.sendMode, 'routed', 'collected, not concluded')
  b.acknowledged(ref.submissionId)
  b.conclude(c, DEADLINE + 1)
  await b.settle()
  b.advance(DEADLINE + 2)
  assert.equal(b.sendMode, 'routed', 'answered: nothing open')
  assert.deepEqual(b.ackState().send.open, [])
})

test('a wire without queueEmpty never completes a collection: no switch (RLTP-VTI-3130, closed)', async () => {
  const wire = new WireDouble()
  wire.queueEmpty = undefined
  const { a } = await adapter(wire)
  a.reconcile(viewOf(entryOf('d1')), gateAll(), 0)
  await a.settle()
  cleanConclude(a, DEADLINE)
  a.advance(DEADLINE + 1)
  assert.equal(a.sendMode, 'routed')
})

test('the mediator still holding frames at the check holds the switch, though a clean conclusion came earlier (RLTP-VTI-3130)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  a.reconcile(viewOf(entryOf('d1')), gateAll(), 0)
  await a.settle()
  cleanConclude(a, H)
  wire.queueEmpty = () => false
  a.advance(DEADLINE + H)
  assert.equal(a.sendMode, 'routed')
  wire.queueEmpty = () => true
  a.advance(DEADLINE + H + 1)
  assert.equal(a.sendMode, 'egress-session')
})

test('no switch without a conclusion that leaves nothing pending: frames still at the mediator, or a kept item in the buffer (RLTP-VTI-3130)', async () => {
  const wire = new WireDouble()
  wire.queueEmpty = () => false
  const { a } = await adapter(wire)
  a.reconcile(viewOf(entryOf('d1')), gateAll(), 0)
  await a.settle()
  cleanConclude(a, H)
  a.advance(DEADLINE + H)
  assert.equal(a.sendMode, 'routed')
  wire.queueEmpty = () => true
  cleanConclude(a, DEADLINE + H)
  a.advance(DEADLINE + H + 1)
  assert.equal(a.sendMode, 'egress-session')

  const wire2 = new WireDouble()
  const { a: b } = await adapter(wire2)
  b.reconcile(viewOf(entryOf('d1')), gateAll(), 0)
  await b.settle()
  const q = await wire2.deliverFromPeer(te.encode('rate-limited'))
  b.conclude(b.collect(H), H, { keep: [q] })
  b.advance(DEADLINE + H)
  assert.equal(b.sendMode, 'routed', 'a kept item waits in the buffer')
  cleanConclude(b, DEADLINE + H)
  b.advance(DEADLINE + H + 1)
  assert.equal(b.sendMode, 'egress-session')
})

test('no switch on another refusal by the mediator, on an offline signal, or with nothing accepted in routed (RLTP-VTI-3130, §5)', async () => {
  for (const setup of [
    (w) => { w.depositFailure = 'refused-admission' },
    (w) => { w.depositFailure = 'refused-retriable' },
    (w) => { w.isOffline = true },
  ]) {
    const wire = new WireDouble()
    setup(wire)
    const { a } = await adapter(wire)
    a.reconcile(viewOf(entryOf('d1')), gateAll(), 0)
    await a.settle()
    cleanConclude(a, H)
    a.advance(DEADLINE + H)
    await a.settle()
    assert.equal(a.sendMode, 'routed')
    assert.deepEqual(a.ackState().send, EMPTY)
  }
})

test('a validated refusal of the routed form switches at once; the submission stays awaiting-transport and goes egress-session at its next hand-over (RLTP-VTI-3130, §5)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const gate = gateAll()
  a.reconcile(viewOf(entryOf('d0')), gate, 0)
  await a.settle()
  assert.deepEqual(openOf(a), ['d0@0'])
  wire.depositFailure = 'routed-refused'
  const refs = a.reconcile(viewOf(entryOf('d0'), entryOf('d1')), gate, 1)
  await a.settle()
  assert.equal(a.sendMode, 'egress-session', 'at once, without a conclusion or a deadline')
  assert.deepEqual(a.ackState().send, { mode: 'egress-session', open: [] })
  assert.deepEqual(a.status(refs[0].submissionId), { state: 'awaiting-transport', reason: 'carrier-refused-retriable' })
  wire.depositFailure = null
  a.advance(2)
  await a.settle()
  assert.deepEqual(a.status(refs[0].submissionId), { state: 'accepted' })
  assert.equal(wire.deposited.at(-1).mode, 'egress-session')
  // never unroutable at the horizon for it
  const wire2 = new WireDouble()
  wire2.depositFailure = 'routed-refused'
  const { a: b } = await adapter(wire2)
  const [r2] = b.reconcile(viewOf(entryOf('d9')), gateAll(), 0)
  await b.settle()
  wire2.depositFailure = 'unreachable'
  b.advance(DECLARED.giveUpHorizonMs)
  assert.deepEqual(b.status(r2.submissionId), { state: 'failed', reason: 'expired-by-adapter-policy' })
})

test('answers are per deposit (RLTP-VTI-3130): an answered deposit leaves; an earlier answer does not protect a later unanswered one', async () => {
  const provers = {
    acknowledged: (a, ref) => a.acknowledged(ref.submissionId),
    receiverRefused: (a, ref) => a.receiverRefused(ref.submissionId, 'proofInvalid'),
    answered: (a, ref) => a.answered(ref.digest, 2),
  }
  for (const [name, answer] of Object.entries(provers)) {
    const wire = new WireDouble()
    const { a } = await adapter(wire)
    const refs = a.reconcile(viewOf(entryOf('d1'), entryOf('d2')), gateAll(), 0)
    await a.settle()
    answer(a, refs[0])
    assert.deepEqual(openOf(a), ['d2@0'], name)
    cleanConclude(a, H)
    a.advance(DEADLINE + H)
    assert.equal(a.sendMode, 'egress-session', `${name}: d2 is still open`)
    const wire2 = new WireDouble()
    const { a: b } = await adapter(wire2)
    const r2 = b.reconcile(viewOf(entryOf('d1'), entryOf('d2')), gateAll(), 0)
    await b.settle()
    answer(b, r2[0]); answer(b, r2[1])
    cleanConclude(b, H)
    b.advance(DEADLINE + H)
    assert.equal(b.sendMode, 'routed', `${name}: everything answered`)
  }
  // an answer for a digest the send state does not name answers nothing
  const { a } = await adapter(new WireDouble())
  a.reconcile(viewOf(entryOf('d1')), gateAll(), 0)
  await a.settle()
  a.answered('elsewhere', 1)
  assert.deepEqual(openOf(a), ['d1@0'])
})

test('a verdict that outruns the acceptance answers it: the digest is never opened', async () => {
  const wire = new WireDouble()
  let release
  const real = wire.deposit.bind(wire)
  wire.deposit = (...args) => new Promise((res) => { release = () => res(real(...args)) })
  const { a } = await adapter(wire)
  const [ref] = a.reconcile(viewOf(entryOf('d1')), gateAll(), 0)
  while (!release) await new Promise((r) => setTimeout(r, 1))
  a.receiverRefused(ref.submissionId, 'proofInvalid')
  release()
  await a.settle()
  assert.deepEqual(a.ackState().send, EMPTY)
})

test('send state persists with the ack state; a successor resumes it, egress-session included; no send state starts in routed (RLTP-VTI-3130, 6120)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  a.reconcile(viewOf(entryOf('d1'), entryOf('k1', { kind: 'ack' })), gateAll(), 0)
  await a.settle()
  const snap = a.ackState()
  a.close()
  assert.deepEqual(a.ackState().send, snap.send, 'readable after close')
  const { a: b } = await adapter(new WireDouble(), snap, 10)
  assert.deepEqual(b.ackState().send, snap.send)
  cleanConclude(b, DEADLINE)
  b.advance(DEADLINE)
  assert.equal(b.sendMode, 'egress-session', 'the deadline counts from the acceptance recorded')
  const snap2 = b.ackState()
  b.close()
  const wire3 = new WireDouble()
  const { a: c } = await adapter(wire3, snap2, DEADLINE + 1)
  assert.equal(c.sendMode, 'egress-session')
  c.submit(te.encode('x'), DEADLINE + 1)
  await c.settle()
  assert.equal(wire3.deposited[0].mode, 'egress-session', 'one way')
  const { a: d } = await adapter(new WireDouble(), { concluded: [], pending: [] }, 5)
  assert.deepEqual(d.ackState().send, EMPTY)
})

test('send state restore is fail-closed (§4): the form is { mode, open } and nothing else', async () => {
  const ok = { mode: 'routed', open: [{ digest: 'd', acceptedAt: 1 }, { digest: 'e', acceptedAt: 2 }] }
  const bad = [
    null, 'routed',
    { ...ok, mode: 'direct' },
    { ...ok, open: 'd' },
    { mode: 'routed' },
    { ...ok, open: [{ digest: 7, acceptedAt: 1 }] },
    { ...ok, open: [{ digest: 'd', acceptedAt: Number.NaN }] },
    { ...ok, open: [{ digest: 'd', acceptedAt: 6 }] },
    { ...ok, open: [{ digest: 'd', acceptedAt: 1 }, { digest: 'd', acceptedAt: 2 }] },
    { ...ok, open: [{ digest: 'd', acceptedAt: 1, kind: 'ack' }] },
    { mode: 'egress-session', open: [{ digest: 'd', acceptedAt: 1 }] },
    // the fields of acknowledgements counting as deposits are gone: refused, not ignored
    { ...ok, sentAcks: [] },
    { ...ok, seenResends: [] },
    { ...ok, extra: 1 },
  ]
  for (const send of bad) {
    await assert.rejects(adapter(new WireDouble(), { concluded: [], pending: [], send }, 5), /send state/, JSON.stringify(send))
  }
  const { a } = await adapter(new WireDouble(), { concluded: [], pending: [], send: ok }, 5)
  assert.deepEqual(a.ackState().send, ok)
  ok.open.push({ digest: 'mutated', acceptedAt: 1 })
  assert.equal(a.ackState().send.open.length, 2, 'restored by copy')
  const { a: e } = await adapter(new WireDouble(), { concluded: [], pending: [], send: { mode: 'egress-session', open: [] } }, 5)
  assert.equal(e.sendMode, 'egress-session')
})

test('a successor applies the answers the holder hands it before the check: no switch (RLTP-VTI-3130)', async () => {
  const send = { mode: 'routed', open: [{ digest: 'd1', acceptedAt: 0}] }
  const now = DEADLINE + 5
  const { a } = await adapter(new WireDouble(), { concluded: [], pending: [], send }, now)
  a.answered('d1', now)
  cleanConclude(a, now)
  a.advance(now + 1)
  assert.equal(a.sendMode, 'routed')
  assert.deepEqual(a.ackState().send, EMPTY)
  const { a: b } = await adapter(new WireDouble(), { concluded: [], pending: [], send }, now)
  cleanConclude(b, now)
  b.advance(now + 1)
  assert.equal(b.sendMode, 'egress-session')
  b.close()
  b.answered('d1', now + 2)
})

test('after the switch an accepted submission is not deposited again; one still in custody goes in the new mode (RLTP-VTI-3135, 7130)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const gate = gateAll()
  a.reconcile(viewOf(entryOf('d1')), gate, 0)
  await a.settle()
  wire.depositFailure = 'unreachable'
  // d2 a little later, so the deadline of d1 comes before d2's give-up horizon
  const refs = a.reconcile(viewOf(entryOf('d1'), entryOf('d2', { since: H })), gate, H)
  await a.settle()
  assert.equal(a.status(refs[0].submissionId).state, 'awaiting-transport')
  cleanConclude(a, H)
  wire.depositFailure = null
  a.advance(DEADLINE)
  await a.settle()
  assert.equal(a.sendMode, 'egress-session')
  assert.deepEqual(wire.deposited.map((d) => [JSON.parse(new TextDecoder().decode(d.bytes)).digest, d.mode]),
    [['d1', 'routed'], ['d2', 'egress-session']])
  a.advance(DEADLINE + H)
  await a.settle()
  assert.equal(wire.deposited.length, 2, 'd1 accepted in routed: never again')
  assert.deepEqual(a.ackState().send.open, [], 'egress-session holds no open routed deposits')
})

test('an attempt begun before the switch ends in the mode it began in; accepted after the switch, it opens nothing (RLTP-VTI-3135)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const gate = gateAll()
  a.reconcile(viewOf(entryOf('d0')), gate, 0)
  await a.settle()
  const modes = []
  let release
  wire.deposit = (_t, _b, _e, mode) => { modes.push(mode); return new Promise((res) => { release = res }) }
  const [ref] = a.reconcile(viewOf(entryOf('d0'), entryOf('d1', { since: H })), gate, H)
  while (!release) await new Promise((r) => setTimeout(r, 1))
  cleanConclude(a, H)
  a.advance(DEADLINE)
  assert.equal(a.sendMode, 'egress-session')
  release()
  await a.settle()
  assert.deepEqual(modes, ['routed'])
  assert.equal(a.status(ref.submissionId).state, 'accepted')
  assert.deepEqual(a.ackState().send.open, [])
})

test('an open deposit does not fall at its give-up horizon: no conclusion removes it (RLTP-VTI-3130)', async () => {
  const wire = new WireDouble()
  wire.queueEmpty = () => false
  const { a } = await adapter(wire)
  a.reconcile(viewOf(entryOf('d1')), gateAll(), 0)
  await a.settle()
  wire.queueEmpty = () => true
  a.conclude(a.collect(10 * DEADLINE), 10 * DEADLINE)
  assert.deepEqual(openOf(a), ['d1@0'])
  a.advance(10 * DEADLINE + 1)
  assert.equal(a.sendMode, 'egress-session')
})

test('a submit() without a digest opens nothing: submit-only never switches (RLTP-VTI-3130)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const id = a.submit(te.encode('x'), 0)
  await a.settle()
  assert.equal(a.status(id).state, 'accepted')
  assert.deepEqual(a.ackState().send, EMPTY)
  cleanConclude(a, H)
  a.advance(10 * DEADLINE)
  assert.equal(a.sendMode, 'routed')
})

test('depositAddressing reproduces vectors/vti-routed-addressing.json (RLTP-VTI-1110, 1120, 3110, 3115, 3120)', async () => {
  const V = JSON.parse(readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'vectors', 'vti-routed-addressing.json'), 'utf8'))
  const sha2 = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(s)))
  // the sides as the vector's source names them, derived here
  const ikmA = Uint8Array.from(VEC.rootIkm.match(/../g).map((b) => parseInt(b, 16)))
  const nonceA = await sha2('rltp/vector/carrier-relationship/nonce-1')
  const ikmB = await sha2('rltp/vector/vti-routed/root-B')
  const nonceB = await sha2('rltp/vector/vti-routed/nonce-B')
  const sides = {}
  for (const [k, ikm, nonce] of [['A', ikmA, nonceA], ['B', ikmB, nonceB]]) {
    sides[k] = {
      connection: (await carrierScopedIdentity(ikm, V.carrier, nonce, 'connection')).did,
      egress: (await carrierScopedIdentity(ikm, V.carrier, nonce, 'egress')).did,
    }
  }
  assert.deepEqual(sides, V.sides)
  const strip = ({ sealedTo, signedBy, ...rest }) => rest
  for (const [from, to] of [['A', 'B'], ['B', 'A']]) {
    const key = `${from}→${to}`
    const r = depositAddressing('routed', sides[from], sides[to].connection, V.carrier)
    const want = V.routed[key]
    assert.deepEqual(r, { inner: strip(want.inner), outer: strip(want.outer), session: want.session }, key)
    const e = depositAddressing('egress-session', sides[from], sides[to].connection, V.carrier)
    const wantE = V.egressSession[key]
    assert.deepEqual(e, { inner: strip(wantE.message), outer: null, session: wantE.session }, key)
  }
  assert.throws(() => depositAddressing('egress', sides.A, sides.B.connection, V.carrier), /mode/)
})

test('app contract (TRANSPORT rule 5): after a withdrawal nothing new starts, and a late-resolving wire call has no local effect (a call already on the wire may still land at the mediator)', async () => {
  // before the deposit started
  const wire = new WireDouble()
  wire.isOffline = true
  const { a } = await adapter(wire)
  const gate = gateAll()
  const [ref] = a.reconcile(viewOf(entryOf('d1')), gate, 0)
  a.reconcile(viewOf(), gate, 1)
  assert.equal(a.has(ref.submissionId), false)
  wire.isOffline = false
  a.advance(2)
  await a.settle()
  assert.equal(wire.deposited.length, 0, 'no deposit after the withdrawal')
  // while the deposit is on the wire
  const wire2 = new WireDouble()
  let release
  let calls = 0
  wire2.deposit = () => { calls++; return new Promise((res) => { release = res }) }
  const { a: b } = await adapter(wire2)
  const gate2 = gateAll()
  const [ref2] = b.reconcile(viewOf(entryOf('d1')), gate2, 0)
  while (!release) await new Promise((r) => setTimeout(r, 1))
  b.reconcile(viewOf(), gate2, 1)
  release()
  await b.settle()
  assert.equal(b.has(ref2.submissionId), false)
  assert.equal(b.report(ref2.submissionId), null)
  assert.deepEqual(b.ackState().send, EMPTY, 'nothing recorded for it')
  b.advance(H)
  await b.settle()
  assert.equal(calls, 1, 'and nothing deposited again')
})

// What this shows: every deposit is a submission with an id of its own,
// and a duplicate's answer (`resend`) is another submission with another id
// although it carries the same digest. The DeliveryReport handed to the
// holder carries the digest; the app pairs a report with its deposit
// through the submission id it polls (report(id)).
test('app contract (TRANSPORT rule 6): every deposit has a submission id of its own, report(id) answers per id — a duplicate\'s answer included', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const real = wire.deposit.bind(wire)
  let n = 0
  wire.deposit = async (...args) => { if (n++ === 0) throw new WireError('unreachable'); return real(...args) }
  const refs = a.reconcile(viewOf(entryOf('k1', { kind: 'ack' }), entryOf('k1', { kind: 'ack', resend: 1 })), gateAll(), 0)
  await a.settle()
  assert.equal(refs.length, 2)
  assert.notEqual(refs[0].submissionId, refs[1].submissionId)
  assert.deepEqual(refs.map((r) => r.digest), ['k1', 'k1'])
  assert.deepEqual(a.report(refs[0].submissionId), { digest: 'k1', status: 'awaiting-transport', reason: 'transport-unreachable' })
  assert.deepEqual(a.report(refs[1].submissionId), { digest: 'k1', status: 'accepted' })
})


test('onDeliver answers whether the adapter took the frame: false when not buffered (over the cap) or retired, true when buffered, held or absorbed', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  assert.equal(await wire.consumer(te.encode('one')), true, 'buffered')
  assert.equal(await wire.consumer(te.encode('one')), true, 'already held')
  const c = a.collect(1)
  assert.equal(await wire.consumer(te.encode('one')), true, 'outstanding')
  a.conclude(c, 2)
  await a.settle()
  assert.equal(await wire.consumer(te.encode('one')), true, 'absorbed')
  const big = new Uint8Array(DECLARED.maxQueueBytes)
  assert.equal(await wire.consumer(big), true, 'below the floor: buffered')
  assert.equal(await wire.consumer(new Uint8Array(DECLARED.queueFloorBytes)), false, 'above the cap: left with the mediator')
  a.close()
  assert.equal(await wire.consumer(te.encode('two')), false, 'retired')
})


test('a withdrawn attempt that ends routed-refused still switches: the refusal is evidence about the mediator (RLTP-VTI-3130)', async () => {
  const wire = new WireDouble()
  let refuse
  wire.deposit = () => new Promise((_res, rej) => { refuse = () => rej(new WireError('routed-refused')) })
  const { a } = await adapter(wire)
  const gate = gateAll()
  const [ref] = a.reconcile(viewOf(entryOf('d1')), gate, 0)
  while (!refuse) await new Promise((r) => setTimeout(r, 1))
  a.reconcile(viewOf(), gate, 1)               // withdrawn while on the wire
  refuse()
  await a.settle()
  assert.equal(a.has(ref.submissionId), false, 'the withdrawal stands')
  assert.equal(a.sendMode, 'egress-session')
})

test('answered(digest) before the acceptance of a running attempt keeps the document from being opened, like acknowledged (RLTP-VTI-3130)', async () => {
  const wire = new WireDouble()
  let release
  const real = wire.deposit.bind(wire)
  wire.deposit = (...args) => new Promise((res) => { release = () => res(real(...args)) })
  const { a } = await adapter(wire)
  a.reconcile(viewOf(entryOf('d1')), gateAll(), 0)
  while (!release) await new Promise((r) => setTimeout(r, 1))
  a.answered('d1', 1)
  release()
  await a.settle()
  assert.deepEqual(a.ackState().send.open, [])
})

test('acknowledgements are no open routed deposits: an ack-only side never switches, a duplicate\'s answer opens nothing (RLTP-VTI-3130, Open Issue 9)', async () => {
  const G = DECLARED.giveUpHorizonMs
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const gate = gateAll()
  a.reconcile(viewOf(entryOf('k1', { kind: 'ack' })), gate, 0)
  await a.settle()
  assert.deepEqual(a.ackState().send, EMPTY)
  a.reconcile(viewOf(entryOf('k1', { kind: 'ack', resend: 1, since: 2 * G })), gate, 2 * G)
  await a.settle()
  assert.deepEqual(a.ackState().send, EMPTY)
  cleanConclude(a, 2 * G)
  a.advance(10 * G)
  assert.equal(a.sendMode, 'routed')
})

test('absorption lasts a give-up horizon after the conclusion: a later byte-identical copy goes to the holder as a new item; entry and ack intent stand for the window (§2, §4, RLTP-DEL-6330)', async () => {
  const G = DECLARED.giveUpHorizonMs
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const bytes = te.encode('a document')
  const q = await wire.deliverFromPeer(bytes)
  a.conclude(a.collect(0), 0)
  await a.settle()
  // before the horizon: absorbed, re-acked, never surfaced
  await wire.consumer(bytes)
  a.advance(G - 1)
  assert.equal(a.collect(G - 1).items.length, 0, 'absorbed')
  assert.ok(a.ackState().concluded.some((c) => c.queueId === q))
  await a.settle()
  // from the horizon on: a new item for the holder, who absorbs and answers it
  a.advance(G)
  assert.equal(await wire.consumer(bytes), true)
  const c = a.collect(G)
  assert.deepEqual(c.items.map((i) => i.queueId), [q], 'surfaced to the holder')
  assert.deepEqual(a.ackState().concluded.map((x) => [x.queueId, x.concludedAt]), [[q, 0]], 'the entry stands until the new conclusion')
  a.conclude(c, G)
  await a.settle()
  assert.deepEqual(a.ackState().concluded.map((x) => [x.queueId, x.concludedAt]), [[q, G]])
})

test('a copy that arrives past the horizon while an ack for its id is on the wire is still absorbed (§4, R15-B1)', async () => {
  const G = DECLARED.giveUpHorizonMs
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const bytes = te.encode('flying')
  await wire.deliverFromPeer(bytes)
  let release
  wire.ackReceived = () => new Promise((res) => { release = res })
  a.conclude(a.collect(0), 0)
  while (!release) await new Promise((r) => setTimeout(r, 1))
  a.advance(G + 1)
  await wire.consumer(bytes)
  assert.equal(a.collect(G + 1).items.length, 0, 'absorbed while its ack flies')
  release()
  await a.settle()
})

test('a later copy in the buffer is not acknowledged away by a standing intent before the holder concludes it: hand off → await → ack (§3, §4)', async () => {
  const G = DECLARED.giveUpHorizonMs
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const bytes = te.encode('resubmitted')
  await wire.deliverFromPeer(bytes)
  wire.ackFailure = true
  a.conclude(a.collect(0), 0); await a.settle()
  assert.equal(a.ackState().pending.length, 1, 'the intent stands')
  a.advance(G)
  const qid = await wire.deliverFromPeer(bytes)      // a copy past the horizon: a new item
  wire.ackFailure = false
  a.advance(G + 1); await a.settle()
  assert.ok(wire.queue.has(qid), 'not acknowledged while the holder has not handled it')
  assert.equal(a.ackState().pending.length, 1)
  const c = a.collect(G + 2)
  a.advance(G + 3); await a.settle()
  assert.ok(wire.queue.has(qid), 'nor while it is outstanding')
  a.conclude(c, G + 4); await a.settle()
  assert.equal(wire.queue.has(qid), false, 'acknowledged once concluded')
})

test('a later copy is buffered; buffered and outstanding go before concluded: a redelivery of it is ignored, even while an ack for its id flies (§3)', async () => {
  const G = DECLARED.giveUpHorizonMs
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const bytes = te.encode('again')
  await wire.deliverFromPeer(bytes)
  a.conclude(a.collect(0), 0); await a.settle()
  a.advance(G)
  await wire.consumer(bytes)                         // a later copy: buffered
  let release
  wire.ackReceived = () => new Promise((res) => { release = res })
  // another concluded item makes a flush fly; the buffered id is not in it
  await wire.deliverFromPeer(te.encode('other'))
  const c0 = a.collect(G)
  assert.equal(c0.items.length, 2)
  await wire.consumer(bytes)                         // redelivery while outstanding
  assert.equal(a.collect(G).items.length, 0, 'ignored: outstanding goes before concluded')
  a.conclude(c0, G + 1)
  while (!release) await new Promise((r) => setTimeout(r, 1))
  await wire.consumer(bytes)                         // its ack is on the wire now: absorbed
  assert.equal(a.collect(G + 1).items.length, 0)
  release(); await a.settle()
})

test('open routed deposits fall routed-ack-deadline plus duplicate-window after their acceptance, also without a statement that nothing is pending; a restore cuts them (RLTP-VTI-3130)', async () => {
  const D = DECLARED.routedAckDeadlineMs
  const W = DECLARED.duplicateWindowMs
  const wire = new WireDouble()
  wire.queueEmpty = undefined                        // never a switch
  const { a } = await adapter(wire)
  a.reconcile(viewOf(entryOf('d1')), gateAll(), 0)
  await a.settle()
  a.advance(D + W - 1)
  assert.deepEqual(openOf(a), ['d1@0'])
  a.advance(D + W)
  assert.deepEqual(openOf(a), [], 'fallen')
  assert.equal(a.sendMode, 'routed')
  const send = { mode: 'routed', open: [{ digest: 'old', acceptedAt: 0 }, { digest: 'new', acceptedAt: 5 }] }
  const { a: b } = await adapter(new WireDouble(), { concluded: [], pending: [], send }, D + W + 1)
  assert.deepEqual(openOf(b), ['new@5'], 'cut at the restore, not refused')
})
