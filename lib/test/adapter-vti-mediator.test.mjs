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
import { MediatorCarrierAdapter, DECLARED, WireError, queueIdOf, deliveryReportOf, depositAddressing, readTrustTaskError, TRUST_TASK_ERROR_TYPE, TRUST_TASK_ERROR_TYPES,
  wrapSealed, readBindingEnvelope, readTrustTaskNextStep, TRUST_TASK_NEXT_STEP_TYPE, TSP_BINDING_ENVELOPE_TYPE, SEALED_ENVELOPE_TYPE }
  from '@real-life/trust-protocol/adapters/vti-mediator'
import { pair, T0 } from './pair-fixture.mjs'
import { carrierPrincipal, carrierScopedIdentity }
  from '../dist/carrier-identity.js'
import { jcs } from '../dist/core.js'

const te = new TextEncoder()
const MEDIATOR_DID = 'did:webvh:example:mediator'
const VEC = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'vectors', 'identity-derivation.json'), 'utf8'))

// ── sealed envelopes of the right form (Delivery §5) ─────────────────
const b64u = (bytes) => Buffer.from(bytes).toString('base64url')
const filled = (label, n) => { const out = new Uint8Array(n); const t = te.encode(label); for (let i = 0; i < n; i++) out[i] = t[i % t.length] ^ i; return out }
/** a schema-valid sealed envelope whose ciphertext carries `label` */
function sealOf (label) {
  return {
    rkid: 'z6LS' + 'abcdefghijk'.repeat(4),
    epk: b64u(filled('epk/' + label, 32)),
    nonce: b64u(filled('nonce/' + label, 12)),
    ciphertext: b64u(te.encode(('ciphertext:' + label).padEnd(28, '.'))),
  }
}
/** the JCS bytes of sealOf(label): what submit() takes and collect() gives */
const sealBytes = (label) => te.encode(jcs(sealOf(label)))
const sealText = (label) => jcs(sealOf(label))
/** the digest a test entry's seal names (entryOf) */
const labelOf = (bytes) => Buffer.from(JSON.parse(new TextDecoder().decode(bytes)).ciphertext, 'base64url').toString().replace(/^ciphertext:/, '').replace(/\.+$/, '').split('/')[0]

// the counterpart's connection DID: a canonical Ed25519 did:key
const PEER_ID = await carrierScopedIdentity(new Uint8Array(32).fill(0x51), MEDIATOR_DID, new Uint8Array(32).fill(0x52), 'connection')
const PEER = PEER_ID.did

async function identities (ikm, nonce) {
  ikm ??= crypto.getRandomValues(new Uint8Array(32))
  nonce ??= crypto.getRandomValues(new Uint8Array(32))
  const p = await carrierPrincipal(ikm, MEDIATOR_DID, nonce)
  const conn = await carrierScopedIdentity(ikm, MEDIATOR_DID, nonce, 'connection')
  return { p, conn }
}

/** an adapter over `wire`; a second adapter over the same wire is a
 *  successor of the same relationship (same root and carrier nonce) */
async function adapter (wire, restored, restoredAt) {
  wire.keys ??= { ikm: crypto.getRandomValues(new Uint8Array(32)), nonce: crypto.getRandomValues(new Uint8Array(32)) }
  const { ikm, nonce } = wire.keys
  const a = await MediatorCarrierAdapter.create(ikm, MEDIATOR_DID, nonce, wire, restored, restoredAt)
  wire.self = a.connectionDid
  const { p, conn } = await identities(ikm, nonce)
  return { a, p, conn }
}

/** The binding envelope a deposit carried, taken apart as the
 *  counterpart's binding would: the seal's JCS bytes stand where the
 *  sealed envelope stood before (profile 0.29 §3b). */
function unwrap (payload) {
  const o = JSON.parse(new TextDecoder().decode(payload))
  assert.equal(o.type, TSP_BINDING_ENVELOPE_TYPE)
  assert.equal(o.document.type, SEALED_ENVELOPE_TYPE)
  return { payload: payload.slice(), document: o.document, bytes: te.encode(jcs(o.document.payload)) }
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
    this.refusedDirect = false
    this.peer = PEER
    this.self = null
    this.logged = []
  }

  counterpart () { return this.peer }

  log (line) { this.logged.push(line) }

  // RLTP-VTI-3120: the carrier refused direct delivery
  directRefused () { return this.refusedDirect }

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

  async deposit (accessToken, bytes, mode) {
    if (this.depositFailure) throw new WireError(this.depositFailure)
    this.deposited.push({ ...unwrap(bytes), mode })
  }

  async ackReceived (accessToken, queueIds) {
    if (this.ackFailure) throw new WireError('refused-retriable')
    for (const id of queueIds) this.queue.delete(id)
  }

  onDeliver (cb) { this.consumer = cb }

  /** The payload a counterpart's adapter deposits for `sealBytes`: the
   *  binding envelope from the peer to this side (RLTP-VTI-3150). */
  async wrap (sealBytes, { since = 0, issuer = this.peer, recipient = this.self } = {}) {
    assert.ok(recipient, 'the double knows the adapter\'s connection DID (wire.self)')
    return (await wrapSealed(JSON.parse(new TextDecoder().decode(sealBytes)), { issuer, recipient, since })).bytes
  }

  /** hands the adapter's consumer the carried form of `sealBytes` from the peer */
  async offer (sealBytes, opts) { return this.consumer(await this.wrap(sealBytes, opts), this.peer) }

  async deliverFromPeer (sealBytes, opts) {
    return this.deliverRaw(await this.wrap(sealBytes, opts), this.peer)
  }

  /** a payload as it is, from `sender` */
  async deliverRaw (bytes, sender = this.peer) {
    const id = await queueIdOf(bytes)
    this.queue.set(id, { bytes: bytes.slice(), sender })
    await this.consumer(bytes, sender)
    return id
  }

  /** the queue id of the carried form of `sealBytes` from the peer */
  async qid (sealBytes, opts) { return queueIdOf(await this.wrap(sealBytes, opts)) }

  async redeliverAll () {
    for (const { bytes, sender } of [...this.queue.values()]) await this.consumer(bytes, sender)
  }
}

// ── identity derivations against the SHIPPED oracle (R4-M7) ──────────
test('the connection DID derives byte-exactly to the vector corpus; the egress scope is gone (Identity 13)', async () => {
  const ikm = Uint8Array.from(VEC.rootIkm.match(/../g).map((b) => parseInt(b, 16)))
  const nonce = new Uint8Array(await crypto.subtle.digest('SHA-256',
    te.encode('rltp/vector/carrier-relationship/nonce-1')))
  const A = VEC.adapterScopedIdentities
  const conn = await carrierScopedIdentity(ikm, A.carrier, nonce, 'connection')
  assert.equal(conn.did, A.connection.did)
  assert.equal(conn.info, A.connection.info)
  await assert.rejects(carrierScopedIdentity(ikm, A.carrier, nonce, 'egress'), /connection DID/)
  const p = await carrierPrincipal(ikm, A.carrier, nonce)
  assert.equal(p.principal, VEC.carrierRelationship.cases[0].principal)
  assert.notEqual(p.principal, conn.did)
})

// ── identity discipline (§5a.10) ─────────────────────────────────────
test('the principal never touches the wire; the carried document names the connection DID as issuer (RLTP-VTI-1120, 3150)', async () => {
  const wire = new WireDouble()
  const { a, p, conn } = await adapter(wire)
  a.register(['rkid-1'], 0)
  a.submit(sealBytes('x'), 1)
  await a.settle()
  for (const did of wire.authDids) assert.equal(did, conn.did)
  assert.equal(wire.deposited[0].document.issuer, conn.did)
  assert.equal(wire.deposited[0].document.recipient, PEER)
  for (const seen of [...wire.authDids, wire.deposited[0].document.issuer]) {
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

test('the pair cannot be supplied — only derived: direct construction is refused (R7-B2)', async () => {
  const wire = new WireDouble()
  const { p, conn } = await identities()
  // even a CORRECT pair is refused at the door: the coupling is the
  // factory's, and a caller who could supply identities could mix
  // relationships
  assert.throws(() => new MediatorCarrierAdapter(p, conn, wire), /create/)
  assert.throws(() => new MediatorCarrierAdapter(Symbol('forged'), p, conn, wire), /create/)
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
  a.submit(sealBytes('one'), t)
  await a.settle()
  assert.equal(wire.authCount, 1)
  t += 20_000
  wire.refreshFailure = 'unreachable'
  wire.challengeFailure = 'unreachable'
  a.submit(sealBytes('two'), t)
  await a.settle()
  assert.equal(wire.refreshCount, 1, 'one refresh tried while offline')
  wire.refreshFailure = false
  wire.challengeFailure = null
  t += 1_000
  const id3 = a.submit(sealBytes('three'), t)
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
  a.submit(sealBytes('one'), t)
  await a.settle()
  assert.equal(wire.authCount, 1)
  t += 20_000
  wire.refreshFailure = true
  const id2 = a.submit(sealBytes('two'), t)
  await a.settle()
  assert.deepEqual(a.status(id2), { state: 'accepted' }, 'the send goes through on a fresh handshake')
  assert.equal(wire.refreshCount, 1, 'the refused refresh was tried once')
  assert.equal(wire.authCount, 2, 'then one new challenge')
  wire.refreshFailure = false
  t += 20_000
  a.submit(sealBytes('three'), t)
  await a.settle()
  assert.equal(wire.refreshCount, 2, 'the next expiry refreshes the NEW token')
  assert.equal(wire.authCount, 2)
})

test('JWT lifecycle is silent: one challenge, refresh on expiry, no port event', async () => {
  let t = 1_000_000
  const wire = new WireDouble(() => t)
  wire.accessTtlMs = 10_000
  const { a } = await adapter(wire)
  const id1 = a.submit(sealBytes('one'), t)
  await a.settle()
  assert.deepEqual(a.status(id1), { state: 'accepted' })
  assert.equal(wire.authCount, 1)
  t += 20_000
  const id2 = a.submit(sealBytes('two'), t)
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
  const id = a.submit(sealBytes('x'), 0)
  assert.equal(a.status(id), null, 'no report exists yet — and none is invented')
  assert.equal(a.has(id), true)
  assert.equal(a.has('s999'), false)
  while (!release) await new Promise((r) => setTimeout(r, 1))
  release()
  await a.settle()
  assert.deepEqual(a.status(id), { state: 'accepted' })

  wire.isOffline = true
  const id2 = a.submit(sealBytes('y'), 1)
  assert.deepEqual(a.status(id2), { state: 'awaiting-transport', reason: 'offline' })
  // R13-B1: the offline signal is re-consulted on every tick — a
  // knowingly offline wire never earns an invented unreachable
  a.advance(1 + DECLARED.statusHorizonMs)
  a.advance(DECLARED.giveUpHorizonMs)      // diff = horizon − 1: short of give-up
  assert.deepEqual(a.status(id2), { state: 'awaiting-transport', reason: 'offline' },
    'offline stays offline through every tick short of the give-up')
  wire.isOffline = false
  wire.deposit = async (t, b, m) => { wire.deposited.push({ ...unwrap(b), mode: m }) }
  a.advance(DECLARED.giveUpHorizonMs)
  await a.settle()
  assert.deepEqual(a.status(id2), { state: 'accepted' }, 'back online: the attempt runs and lands')
})

test('an overdue attempt earns transport-unreachable — even over a stale earlier reason (R4-B3)', async () => {
  const wire = new WireDouble()
  wire.deposit = () => new Promise(() => {})
  const { a } = await adapter(wire)
  const id = a.submit(sealBytes('x'), 0)
  a.advance(DECLARED.statusHorizonMs - 1)
  assert.equal(a.status(id), null, 'within the horizon no report is owed')
  a.advance(DECLARED.statusHorizonMs)
  assert.deepEqual(a.status(id), { state: 'awaiting-transport', reason: 'transport-unreachable' })

  // stale reason: one completed retriable refusal, then a hanging retry
  const wire2 = new WireDouble()
  const { a: a2 } = await adapter(wire2)
  wire2.depositFailure = 'refused-retriable'
  const id2 = a2.submit(sealBytes('y'), 0)
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
  const id = a.submit(sealBytes('x'), 0)
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
  const idA = a.submit(sealBytes('a'), 0)
  await a.settle()
  wire.depositFailure = null
  const idB = a.submit(sealBytes('b'), 0)
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
  const x = a.submit(sealBytes('x'), 0)
  await a.settle()
  a.advance(DECLARED.giveUpHorizonMs)
  assert.deepEqual(a.status(x), { state: 'failed', reason: 'unroutable' })

  // admission once, then a hanging retry whose outcome is unknown
  const wire2 = new WireDouble()
  const { a: a2 } = await adapter(wire2)
  wire2.depositFailure = 'refused-admission'
  const y = a2.submit(sealBytes('y'), 0)
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
  const z = a3.submit(sealBytes('z'), 0)
  await a3.settle()
  a3.advance(DECLARED.giveUpHorizonMs)
  assert.deepEqual(a3.status(z), { state: 'failed', reason: 'expired-by-adapter-policy' })
})

test('a hanging deposit cannot block give-up: one serial advance applies the horizon', async () => {
  const wire = new WireDouble()
  wire.deposit = () => new Promise(() => {})
  const { a } = await adapter(wire)
  const id = a.submit(sealBytes('r'), 0)
  a.advance(DECLARED.giveUpHorizonMs)
  assert.equal(a.status(id).state, 'failed')
})

test('receiver refusal acts on live submissions only; terminal states stand', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const id = a.submit(sealBytes('x'), 0)
  await a.settle()
  a.receiverRefused(id, 'proofInvalid')
  assert.deepEqual(a.status(id), { state: 'failed', reason: 'rejected-by-receiver', code: 'proofInvalid' })
  a.acknowledged(id)
  assert.equal(a.status(id).state, 'delivered')
  a.receiverRefused(id, 'proofInvalid')
  assert.equal(a.status(id).state, 'delivered')

  const idGone = a.submit(sealBytes('g'), 1)
  await a.settle()
  a.advance(1 + DECLARED.giveUpHorizonMs)
  a.receiverRefused(idGone, 'unsupportedType')
  assert.equal(a.status(idGone).reason, 'expired-by-adapter-policy')
})

// ── receiver: delete-to-ack, three registers ─────────────────────────
test('collect/conclude: only the conclude releases the mediator copy; conclude never blocks', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const qid = await wire.deliverFromPeer(sealBytes('hello'))
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
  await wire.deliverFromPeer(sealBytes('one'))
  const c1 = a.collect(0)
  a.conclude(c1, 1)                      // flush 1 hangs
  await wire.deliverFromPeer(sealBytes('two'))
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
  await wire.deliverFromPeer(sealBytes('m1'))
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
  await wire.deliverFromPeer(sealBytes('m2'))
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
  await wire.deliverFromPeer(sealBytes('owed'))
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
  const bytes = sealBytes('reissue')
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
  const bytes = sealBytes('old')
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
  wire3.keys = wire.keys                  // the same relationship, restored
  const { a: a3 } = await adapter(wire3,
    { concluded: [{ queueId: await wire.qid(bytes), concludedAt: 0 }], pending: [await wire.qid(bytes)] },
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
  const id = a.submit(sealBytes('x'), 0)      // started online
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
  // the largest seal a carried document holds (ciphertext 87 400 characters)
  const big = (i) => te.encode(jcs({ ...sealOf('big' + i), ciphertext: b64u(filled('big/' + i, 65_550)) }))
  const size = big(0).length
  let i = 0
  // above the floor, below the cap: buffered; half collected (outstanding), half buffered
  const half = Math.floor(DECLARED.maxQueueBytes / size / 2)
  for (; i < half; i++) assert.equal(await wire.offer(big(i)), true)
  a.collect(0)
  for (; (i + 1) * size <= DECLARED.maxQueueBytes; i++) assert.equal(await wire.offer(big(i)), true, `item ${i} fits`)
  const qid = await wire.deliverFromPeer(big(i))
  assert.equal(a.collect(2).items.length, i - half, 'the item over the cap is not taken')
  assert.ok(wire.queue.has(qid))
})

test('empty collections create no register entry; floor guarantee holds', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  for (let i = 0; i < 50; i++) a.conclude(a.collect(i), i)
  for (let i = 0; i < DECLARED.queueFloorCount; i++) {
    await wire.deliverFromPeer(sealBytes('f' + i))
  }
  const c = a.collect(100)
  assert.equal(c.items.length, DECLARED.queueFloorCount)
  a.conclude(c, 101); await a.settle()
  assert.equal(wire.queue.size, 0)
})

test('a hanging AUTH extends no window: beyond it the arrival is new and no ack was ever sent (R16-B1)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const bytes = sealBytes('authhang')
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
  const bytes = sealBytes('ackfly')
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
  const oldBytes = sealBytes('old-item')
  await wire.deliverFromPeer(oldBytes)
  const c1 = a.collect(0)
  wire.ackFailure = true
  a.conclude(c1, 1); await a.settle()          // old intent, ack lost
  wire.ackFailure = false
  // move the clock to the window edge WITHOUT advance (no prune runs)
  const fresh = sealBytes('fresh-item')
  await wire.deliverFromPeer(fresh)
  const c2 = a.collect(1 + DECLARED.duplicateWindowMs)
  let acked = []
  const realAck = wire.ackReceived.bind(wire)
  wire.ackReceived = async (t, ids) => { acked.push(...ids); return realAck(t, ids) }
  a.conclude(c2, 1 + DECLARED.duplicateWindowMs)  // new flush at the edge
  await a.settle()
  const oldId = await wire.qid(oldBytes)
  assert.ok(!acked.includes(oldId), 'the expired-but-unswept id was never sent')
  assert.ok(acked.includes(await wire.qid(fresh)), 'the live id was')
})

test('give-up precedence: a standing offline signal blocks the unroutable verdict (R17-B3)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  wire.depositFailure = 'refused-admission'
  const id = a.submit(sealBytes('x'), 0)
  await a.settle()
  wire.isOffline = true                         // wire drops before the horizon
  a.advance(DECLARED.giveUpHorizonMs)
  assert.deepEqual(a.status(id), { state: 'failed', reason: 'expired-by-adapter-policy' },
    'offline at the horizon outranks the stored admission class')
})

test('a late-returning ack sweeps nothing on a retired instance (R17-B2)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  await wire.deliverFromPeer(sealBytes('m'))
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
  const id = a.submit(sealBytes('x'), 0)
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
  assert.throws(() => a.submit(sealBytes('y'), 1), /retired/)
  assert.throws(() => a.collect(1), /retired/)
  assert.throws(() => a.advance(1), /retired/)
  assert.throws(() => a.register(['rk'], 1), /retired/)
  assert.deepEqual(a.ackState(), { concluded: [], pending: [], send: { mode: 'routed', open: [] } })
})

test('a late success outranks the interim horizon report — accepted, sent once (R5-B1)', async () => {
  const wire = new WireDouble()
  let release
  const realDeposit = wire.deposit.bind(wire)
  wire.deposit = async (t, b, m) => {
    await new Promise((res) => { release = res })
    return realDeposit(t, b, m)
  }
  const { a } = await adapter(wire)
  const id = a.submit(sealBytes('slow'), 0)
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
  a.submit(sealBytes('x'), 0)
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
  const id = a.submit(sealBytes('x'), 0)
  await a.settle()
  assert.throws(() => a.receiverRefused(id, 'unavailable'), /transport outcomes/)
  assert.throws(() => a.receiverRefused(id, 'internalError'), /transport outcomes/)
  assert.deepEqual(a.status(id), { state: 'accepted' }, 'no verdict was minted')
})

test('the terminal codes of trust-task-error/0.5 enter the refusal channel; an extended or unknown code does not (RLTP-VTI-5020)', async () => {
  for (const code of ['unsupportedVersion', 'permissionDenied', 'cancelled', 'taskFailed']) {
    const wire = new WireDouble()
    const { a } = await adapter(wire)
    const id = a.submit(sealBytes('x'), 0)
    await a.settle()
    a.receiverRefused(id, code)
    assert.deepEqual(a.status(id), { state: 'failed', reason: 'rejected-by-receiver', code }, code)
  }
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const id = a.submit(sealBytes('x'), 0)
  await a.settle()
  // the delivery layer reads an extended code as taskFailed before it reaches the port
  assert.throws(() => a.receiverRefused(id, 'example:somethingElse'), /transport outcomes/)
  assert.throws(() => a.receiverRefused(id, 'idConflict'), /transport outcomes/, 'idConflict is an answer, never a refusal (RLTP-VTI-5030)')
  assert.throws(() => a.receiverRefused(id, 'indeterminate'), /transport outcomes/, 'indeterminate is no verdict (RLTP-VTI-5020)')
  assert.deepEqual(a.status(id), { state: 'accepted' })
})

test('unsupportedExtension of trust-task-error/0.6 enters the refusal channel as a terminal verdict (RLTP-VTI-5020)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const id = a.submit(sealBytes('x'), 0)
  await a.settle()
  a.receiverRefused(id, 'unsupportedExtension')
  assert.deepEqual(a.status(id), { state: 'failed', reason: 'rejected-by-receiver', code: 'unsupportedExtension' })
})

test('a conclusion instant after restoredAt is refused (R5-B4)', async () => {
  await assert.rejects(
    adapter(new WireDouble(), { concluded: [{ queueId: 'aa', concludedAt: 100 }], pending: [] }, 50),
    /after restoredAt/,
  )
})

test('runtime identity fields are unwritable; the create tuple is snapshotted at entry (R8-B1/B2)', async () => {
  const wire = new WireDouble()
  const { a, conn } = await adapter(wire)
  assert.throws(() => { a.connectionDid = 'did:key:zForged' }, TypeError)
  assert.equal(a.connectionDid, conn.did)
  assert.equal('egressDid' in a, false, 'one wire identity (profile 0.29 §1)')

  const ikm = new Uint8Array(32).fill(7)
  const nonce = new Uint8Array(32).fill(9)
  const pending = MediatorCarrierAdapter.create(ikm, MEDIATOR_DID, nonce, new WireDouble())
  ikm.fill(1); nonce.fill(2)             // mutate while the factory awaits
  const b = await pending
  const clean = await identities(new Uint8Array(32).fill(7), new Uint8Array(32).fill(9))
  assert.equal(b.principal, clean.p.principal, 'the tuple was read once, at entry')
  assert.equal(b.connectionDid, clean.conn.did)
})

test('a validated refusal during the report-less phase survives the deposit resolution (R9-B2)', async () => {
  const wire = new WireDouble()
  let release
  const realDeposit = wire.deposit.bind(wire)
  wire.deposit = async (t, b, m) => {
    await new Promise((res) => { release = res })
    return realDeposit(t, b, m)
  }
  const { a } = await adapter(wire)
  const id = a.submit(sealBytes('x'), 0)
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
  const { a, conn } = await adapter(wire)
  Object.defineProperty(a, 'connectionDid', { value: a.principal, configurable: true })
  a.submit(sealBytes('x'), 0)
  await a.settle()
  for (const did of wire.authDids) assert.equal(did, conn.did, 'the wire saw the real connection DID')
  assert.equal(wire.deposited[0].document.issuer, conn.did, 'and the carried document names it — never the principal')

  const wire2 = new WireDouble()
  wire2.depositFailure = 'unreachable'
  const { a: a2 } = await adapter(wire2)
  const id = a2.submit(sealBytes('y'), 0)
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
  const bytes = sealBytes('retrans')
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
  const qid = await wire.qid(bytes)
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
  wire.self = a.connectionDid
  const bytes = sealBytes('equiv')
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
  const qid = await wire.qid(bytes)
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
  wire.self = a.connectionDid
  const bytesA = sealBytes('digest-a')
  const bytesB = sealBytes('digest-b')
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
  const qa = await wire.qid(bytesA)
  const qb = await wire.qid(bytesB)
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
  assert.throws(() => a.submit(sealBytes('z'), Number.NaN))
  const id = a.submit(sealBytes('z'), 5_000)
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
    ...['malformedRequest', 'unsupportedType', 'unsupportedVersion', 'proofRequired', 'proofInvalid', 'permissionDenied', 'wrongRecipient', 'identityMismatch', 'cancelled', 'taskFailed'].map((code) =>
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
  const bare = a.submit(sealBytes('x'), 0)
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
  // custody ended: withdrawn; the holder offers it for binding answers only (RLTP-VTI-5065, RLTP-DEL-6150)
  const bound = a.reconcile(await holderA.pendingTransport(T0 + 3), holderA, 0)
  assert.deepEqual(bound.map((r) => r.digest), [one.digest])
  assert.equal(a.has(refs.find((r) => r.digest === one.digest).submissionId), false, 'withdrawn')
  assert.deepEqual(a.status(bound[0].submissionId), { state: 'accepted' }, 'filed for binding, never attempted')
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
  assert.deepEqual(view.answerable.map((x) => x.digest), [one.digest], 'the accepted one, for binding only')
  assert.equal(a2.reconcile(view, holderA, 1).length, 2, 'filed (and the accepted one for binding) …')
  await a2.settle()
  assert.equal(wire2.deposited.length, 0, '… but the closed opening as gate refuses it')
  assert.throws(() => a2.reconcile(view, again, 2), /one adapter per opening/)
  const { a: a3 } = await adapter(wire2)
  const [ref2] = a3.reconcile(view, again, 2)
  await a3.settle()
  assert.equal(wire2.deposited.length, 1, 'the custody entry goes out; the one filed for binding never does')
  assert.deepEqual(JSON.parse(new TextDecoder().decode(wire2.deposited[0].bytes)), two.envelope, 'the envelope the holder kept')
  assert.deepEqual(a3.report(ref2.submissionId), { digest: two.digest, status: 'accepted' })
})

// ── lib 0.5.0: the selective conclusion (Delivery RLTP-DEL-5810, 5820) ──

test('conclude with keep: a collected item whose disposition is transient (failed(rate-limited)) is not concluded — it goes back to the buffer, the next collect offers it again, the mediator keeps its copy; the rest of the collection is concluded (RLTP-DEL-5820, 6280)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const q1 = await wire.deliverFromPeer(sealBytes('one'))
  const q2 = await wire.deliverFromPeer(sealBytes('two'))
  const c = a.collect(0)
  assert.deepEqual(c.items.map((i) => i.queueId).sort(), [q1, q2].sort())
  a.conclude(c, 1, { keep: [q2] })
  await a.settle()
  assert.deepEqual([...wire.queue.keys()], [q2], 'only the concluded copy is released at the mediator')
  assert.deepEqual(a.ackState().concluded.map((x) => x.queueId), [q1])
  const again = a.collect(2)
  assert.deepEqual(again.items.map((i) => i.queueId), [q2], 'offered again')
  // a redelivery by the mediator meanwhile is absorbed: one copy in the buffer
  await wire.deliverFromPeer(sealBytes('two'))
  assert.equal(a.collect(3).items.length, 0)
  a.conclude(again, 4)
  await a.settle()
  assert.equal(wire.queue.size, 0)
})

test('conclude with keep: ids that are not in the collection are ignored; keep never concludes, never acks (RLTP-DEL-5810)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const q = await wire.deliverFromPeer(sealBytes('only'))
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
  const q = await wire.deliverFromPeer(sealBytes('intact'))
  const c = a.collect(0)
  c.items[0].bytes.fill(0x21)                                   // the app scribbles over its copy
  structuredClone(c.items[0].bytes.buffer, { transfer: [c.items[0].bytes.buffer] })   // and transfers the buffer
  a.conclude(c, 1, { keep: [q] })
  const again = a.collect(2)
  assert.equal(new TextDecoder().decode(again.items[0].bytes), sealText('intact'))
  assert.equal(again.items[0].queueId, q)
})

test('conclude with keep (review 112-2): a Node Buffer delivered is copied in and out — mutated, the kept item still comes back intact under its digest', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const q = await wire.deliverRaw(Buffer.from(await wire.wrap(sealBytes('intact'))))
  const c = a.collect(0)
  c.items[0].bytes.fill(33)
  a.conclude(c, 1, { keep: [q] })
  const again = a.collect(2)
  assert.equal(new TextDecoder().decode(again.items[0].bytes), sealText('intact'))
  assert.equal(again.items[0].queueId, q)
})

test('submit (review 112-3): the adapter keeps its own copy of a submission and hands each deposit attempt a fresh one — the caller\'s Buffer mutated after submit, or the wire scribbling over a failed attempt\'s bytes, never changes what is sent', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const input = Buffer.from(sealBytes('intact'))
  a.submit(input, 0)
  input.fill(33)                                                // the caller mutates its Buffer
  await a.settle()
  assert.equal(new TextDecoder().decode(wire.deposited[0].bytes), sealText('intact'))

  const wire2 = new WireDouble()
  const { a: a2 } = await adapter(wire2)
  const real = wire2.deposit.bind(wire2)
  let first = true
  wire2.deposit = async (t, bytes, mode) => {
    if (first) { first = false; bytes.fill(33); throw new WireError('unreachable') }   // scribbles, then fails
    return real(t, bytes, mode)
  }
  a2.submit(sealBytes('intact'), 0)
  await a2.settle()
  a2.advance(DECLARED.statusHorizonMs + 1)
  await a2.settle()
  assert.equal(new TextDecoder().decode(wire2.deposited[0].bytes), sealText('intact'), 'the retry sends the original')
})

test('ack flush (review 112-4): the wire gets its own id list — a wire that empties it neither keeps the ids in flight nor extends their absorption past the duplicate window', async () => {
  for (const mutate of [false, true]) {
    const wire = new WireDouble()
    const real = wire.ackReceived.bind(wire)
    wire.ackReceived = async (t, ids) => { const copy = [...ids]; if (mutate) ids.splice(0); return real(t, copy) }
    const { a } = await adapter(wire)
    const bytes = sealBytes('once')
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
  const id = a.submit(sealBytes('s'), 0)
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
  a3.submit(sealBytes('one'), 0)
  await a3.settle()
  const token = handed.accessToken
  handed.accessToken = 'forged'
  const seenTokens = []
  const realDeposit = wire3.deposit.bind(wire3)
  wire3.deposit = async (t, b, m) => { seenTokens.push(t); return realDeposit(t, b, m) }
  a3.submit(sealBytes('two'), 1)
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
  digest, kind, envelope: sealOf(`${digest}/${kind}${resend === undefined ? '' : '/' + resend}`), type: 'test', threadId: 'th-' + digest, recipient: {},
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
  a.submit(sealBytes('x'), 0)
  await a.settle()
  a.reconcile(viewOf(entryOf('d1')), gateAll(), 5)
  await a.settle()
  assert.deepEqual(wire.deposited.map((d) => d.mode), ['routed', 'routed'])
  assert.deepEqual(a.ackState().send, { mode: 'routed', open: [{ digest: 'd1', acceptedAt: 5}] },
    'the submit() without a digest opened nothing')
})

test('switch (RLTP-VTI-3130): an open routed deposit at the deadline, checked in an advance after a conclusion that left nothing pending; open deposits leave, every later hand-over goes direct', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  a.reconcile(viewOf(entryOf('d1')), gateAll(), 0)
  await a.settle()
  a.advance(DEADLINE)
  assert.equal(a.sendMode, 'routed', 'no conclusion yet: no check')
  cleanConclude(a, DEADLINE)
  assert.equal(a.sendMode, 'routed', 'conclude records, advance checks')
  a.advance(DEADLINE + 1)
  assert.equal(a.sendMode, 'direct')
  assert.deepEqual(a.ackState().send, { mode: 'direct', open: [] })
  a.submit(sealBytes('y'), DEADLINE + 2)
  await a.settle()
  assert.equal(wire.deposited.at(-1).mode, 'direct')

  // an ack waiting in the buffer at the deadline holds the check until collected and reported
  const wire2 = new WireDouble()
  const { a: b } = await adapter(wire2)
  const [ref] = b.reconcile(viewOf(entryOf('d1')), gateAll(), 0)
  await b.settle()
  cleanConclude(b, H)
  b.advance(DEADLINE - 1)
  assert.equal(b.sendMode, 'routed', 'before the deadline')
  await wire2.deliverFromPeer(sealBytes('the ack of d1'))
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
  assert.equal(a.sendMode, 'direct')
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
  assert.equal(a.sendMode, 'direct')

  const wire2 = new WireDouble()
  const { a: b } = await adapter(wire2)
  b.reconcile(viewOf(entryOf('d1')), gateAll(), 0)
  await b.settle()
  const q = await wire2.deliverFromPeer(sealBytes('rate-limited'))
  b.conclude(b.collect(H), H, { keep: [q] })
  b.advance(DEADLINE + H)
  assert.equal(b.sendMode, 'routed', 'a kept item waits in the buffer')
  cleanConclude(b, DEADLINE + H)
  b.advance(DEADLINE + H + 1)
  assert.equal(b.sendMode, 'direct')
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

test('a validated refusal of the routed form switches at once; the submission stays awaiting-transport and goes direct at its next hand-over (RLTP-VTI-3130, §5)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const gate = gateAll()
  a.reconcile(viewOf(entryOf('d0')), gate, 0)
  await a.settle()
  assert.deepEqual(openOf(a), ['d0@0'])
  wire.depositFailure = 'routed-refused'
  const refs = a.reconcile(viewOf(entryOf('d0'), entryOf('d1')), gate, 1)
  await a.settle()
  assert.equal(a.sendMode, 'direct', 'at once, without a conclusion or a deadline')
  assert.deepEqual(a.ackState().send, { mode: 'direct', open: [] })
  assert.deepEqual(a.status(refs[0].submissionId), { state: 'awaiting-transport', reason: 'carrier-refused-retriable' })
  wire.depositFailure = null
  a.advance(2)
  await a.settle()
  assert.deepEqual(a.status(refs[0].submissionId), { state: 'accepted' })
  assert.equal(wire.deposited.at(-1).mode, 'direct')
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

test('the immediate switch needs no statement that nothing is pending (RLTP-VTI-7150)', async () => {
  const wire = new WireDouble()
  wire.queueEmpty = () => false
  const { a } = await adapter(wire)
  wire.depositFailure = 'routed-refused'
  a.reconcile(viewOf(entryOf('d0')), gateAll(), 0)
  await a.settle()
  assert.equal(a.sendMode, 'direct', 'at once, with frames still pending at the mediator')
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
    assert.equal(a.sendMode, 'direct', `${name}: d2 is still open`)
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

test('send state persists with the ack state; a successor resumes it, direct included; no send state starts in routed (RLTP-VTI-3130, 6120)', async () => {
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
  assert.equal(b.sendMode, 'direct', 'the deadline counts from the acceptance recorded')
  const snap2 = b.ackState()
  b.close()
  const wire3 = new WireDouble()
  const { a: c } = await adapter(wire3, snap2, DEADLINE + 1)
  assert.equal(c.sendMode, 'direct')
  c.submit(sealBytes('x'), DEADLINE + 1)
  await c.settle()
  assert.equal(wire3.deposited[0].mode, 'direct', 'one way')
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
    { mode: 'direct', open: [{ digest: 'd', acceptedAt: 1 }] },
    // the fields of acknowledgements counting as deposits are gone: refused, not ignored
    { ...ok, sentAcks: [] },
    { ...ok, seenResends: [] },
    { ...ok, extra: 1 },
    // a refusal of direct delivery is recorded only in direct, as a finite instant not after restoredAt
    { ...ok, directRefusedAt: 1 },
    { mode: 'direct', open: [], directRefusedAt: Number.NaN },
    { mode: 'direct', open: [], directRefusedAt: 6 },
    { mode: 'direct', open: [], directRefusedAt: '1' },
    { mode: 'direct', open: [], directRefusedAt: null },
  ]
  for (const send of bad) {
    await assert.rejects(adapter(new WireDouble(), { concluded: [], pending: [], send }, 5), /send state/, JSON.stringify(send))
  }
  const { a } = await adapter(new WireDouble(), { concluded: [], pending: [], send: ok }, 5)
  assert.deepEqual(a.ackState().send, ok)
  ok.open.push({ digest: 'mutated', acceptedAt: 1 })
  assert.equal(a.ackState().send.open.length, 2, 'restored by copy')
  const { a: e } = await adapter(new WireDouble(), { concluded: [], pending: [], send: { mode: 'direct', open: [] } }, 5)
  assert.equal(e.sendMode, 'direct')
  const refused = { mode: 'direct', open: [], directRefusedAt: 5 }
  const { a: f } = await adapter(new WireDouble(), { concluded: [], pending: [], send: refused }, 5)
  assert.deepEqual(f.ackState().send, refused)
})

test('a refusal of direct delivery (RLTP-VTI-3120) is recorded in the send state and survives openings: nothing is handed over or deposited, every submission reads carrier-refused-retriable', async () => {
  const DIRECT = { concluded: [], pending: [], send: { mode: 'direct', open: [] } }
  const wire = new WireDouble()
  const { a } = await adapter(wire, DIRECT, 0)
  let handOvers = 0
  const gate = { closed: false, handOver: async (_e, _w, start) => { handOvers++; return start() } }
  wire.depositFailure = 'direct-refused'
  const [r0] = a.reconcile(viewOf(entryOf('d0', { since: 5 })), gate, 5)
  await a.settle()
  assert.deepEqual(a.status(r0.submissionId), { state: 'awaiting-transport', reason: 'carrier-refused-retriable' })
  assert.deepEqual(a.ackState().send, { mode: 'direct', open: [], directRefusedAt: 5 })
  // the carrier would take it now: the relationship still deposits nothing
  wire.depositFailure = null
  const before = handOvers
  const refs = a.reconcile(viewOf(entryOf('d0', { since: 5 }), entryOf('d1', { since: 6 }), entryOf('k1', { kind: 'ack', since: 6 })), gate, 6)
  a.advance(7)
  await a.settle()
  assert.equal(handOvers, before, 'no hand-over after the refusal')
  assert.deepEqual(wire.deposited, [])
  for (const r of refs) assert.deepEqual(a.status(r.submissionId), { state: 'awaiting-transport', reason: 'carrier-refused-retriable' })
  const snap = a.ackState()
  a.close()
  // a successor over a new wire, restored from the ack state
  const wire2 = new WireDouble()
  const { a: b } = await adapter(wire2, snap, 10)
  let handOvers2 = 0
  const gate2 = { closed: false, handOver: async (_e, _w, start) => { handOvers2++; return start() } }
  const refs2 = b.reconcile(viewOf(entryOf('d2', { since: 10 })), gate2, 10)
  b.advance(11)
  await b.settle()
  assert.equal(handOvers2, 0)
  assert.deepEqual(wire2.deposited, [])
  assert.deepEqual(b.status(refs2[0].submissionId), { state: 'awaiting-transport', reason: 'carrier-refused-retriable' })
  assert.deepEqual(b.ackState().send, { mode: 'direct', open: [], directRefusedAt: 5 })
  // at the give-up horizon it fails like any retriable refusal
  b.advance(10 + DECLARED.giveUpHorizonMs)
  await b.settle()
  assert.deepEqual(b.status(refs2[0].submissionId), { state: 'failed', reason: 'expired-by-adapter-policy' })
  // any other retriable refusal in direct records nothing
  const wire3 = new WireDouble()
  const { a: c } = await adapter(wire3, DIRECT, 0)
  wire3.depositFailure = 'refused-retriable'
  c.reconcile(viewOf(entryOf('e0')), gateAll(), 1)
  await c.settle()
  assert.deepEqual(c.ackState().send, { mode: 'direct', open: [] })
  wire3.depositFailure = null
  c.advance(2)
  await c.settle()
  assert.equal(wire3.deposited.length, 1)
})

test('a refusal of direct delivery the wire receives after an accepted deposit (MediatorWire.directRefused) is recorded at once: in ackState(), at advance, before any hand-over; a successor deposits nothing (RLTP-VTI-3120)', async () => {
  const DIRECT = { concluded: [], pending: [], send: { mode: 'direct', open: [] } }
  const wire = new WireDouble()
  const { a } = await adapter(wire, DIRECT, 0)
  const [r0] = a.reconcile(viewOf(entryOf('d0', { since: 3 })), gateAll(), 3)
  await a.settle()
  assert.deepEqual(a.status(r0.submissionId), { state: 'accepted' }, 'the refused deposit had already left (Open Issue 4)')
  // the report arrives afterwards; no further deposit in this opening
  wire.refusedDirect = true
  assert.deepEqual(a.ackState().send, { mode: 'direct', open: [], directRefusedAt: 3 }, 'read in ackState()')
  const snap = a.ackState()
  a.close()
  const wire2 = new WireDouble()
  const { a: b } = await adapter(wire2, snap, 4)
  const [r1] = b.reconcile(viewOf(entryOf('d1', { since: 4 })), gateAll(), 4)
  await b.settle()
  assert.deepEqual(wire2.deposited, [])
  assert.deepEqual(b.status(r1.submissionId), { state: 'awaiting-transport', reason: 'carrier-refused-retriable' })
  // read at advance too, and before a hand-over, without ackState()
  const wire3 = new WireDouble()
  const { a: c } = await adapter(wire3, DIRECT, 0)
  wire3.refusedDirect = true
  c.advance(7)
  const [r2] = c.reconcile(viewOf(entryOf('d2', { since: 8 })), gateAll(), 8)
  await c.settle()
  assert.deepEqual(wire3.deposited, [])
  assert.deepEqual(c.status(r2.submissionId), { state: 'awaiting-transport', reason: 'carrier-refused-retriable' })
  assert.equal(c.ackState().send.directRefusedAt, 7)
  // a wire's signal in routed records nothing (the refusal belongs to direct)
  const wire4 = new WireDouble()
  const { a: d } = await adapter(wire4)
  wire4.refusedDirect = true
  d.advance(1)
  assert.deepEqual(d.ackState().send, { mode: 'routed', open: [] })
})

test('a hand-over under way when the refusal of direct delivery is recorded is declined and reads carrier-refused-retriable at once, not null (RLTP-VTI-3120)', async () => {
  const DIRECT = { concluded: [], pending: [], send: { mode: 'direct', open: [] } }
  const wire = new WireDouble()
  const { a } = await adapter(wire, DIRECT, 0)
  let release
  const held = new Promise((res) => { release = res })
  const gate = { closed: false, handOver: async (_e, _w, start) => { await held; return start() } }
  const [r] = a.reconcile(viewOf(entryOf('h0', { since: 1 })), gate, 1)
  await new Promise((res) => setTimeout(res, 5))
  wire.refusedDirect = true
  a.advance(2)
  release()
  await a.settle()
  assert.deepEqual(wire.deposited, [])
  assert.deepEqual(a.status(r.submissionId), { state: 'awaiting-transport', reason: 'carrier-refused-retriable' })
})

test('golden ack state with a refusal of direct delivery (test/adapter-fixtures/ack-state-direct-refused.json): restored, written back unchanged, nothing deposited', async () => {
  const golden = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'adapter-fixtures', 'ack-state-direct-refused.json'), 'utf8'))
  const wire = new WireDouble()
  const { a } = await adapter(wire, golden, 2000)
  assert.deepEqual(a.ackState(), golden)
  assert.equal(JSON.stringify(a.ackState()), JSON.stringify(golden), 'written back byte for byte')
  const [r] = a.reconcile(viewOf(entryOf('g', { since: 2000 })), gateAll(), 2000)
  await a.settle()
  assert.deepEqual(wire.deposited, [])
  assert.deepEqual(a.status(r.submissionId), { state: 'awaiting-transport', reason: 'carrier-refused-retriable' })
})

test('the golden ack state of lib 0.9 (mode egress-session) is read as direct, its refusal of direct delivery kept, and written back as direct (RLTP-VTI-3120, 3130)', async () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'adapter-fixtures')
  const old = JSON.parse(readFileSync(join(dir, 'ack-state-direct-refused-lib-0.9.json'), 'utf8'))
  const now = JSON.parse(readFileSync(join(dir, 'ack-state-direct-refused.json'), 'utf8'))
  assert.equal(old.send.mode, 'egress-session')
  const wire = new WireDouble()
  const { a } = await adapter(wire, old, 2000)
  assert.equal(a.sendMode, 'direct')
  assert.deepEqual(a.ackState(), now)
  a.reconcile(viewOf(entryOf('g', { since: 2000 })), gateAll(), 2000)
  await a.settle()
  assert.deepEqual(wire.deposited, [], 'the refusal stands: nothing deposited')
  // an egress-session send state with open deposits was never produced, and a direct one neither
  for (const mode of ['egress-session', 'direct']) {
    await assert.rejects(adapter(new WireDouble(), { concluded: [], pending: [], send: { mode, open: [{ digest: 'd', acceptedAt: 1 }] } }, 5), /open routed deposits/)
  }
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
  assert.equal(b.sendMode, 'direct')
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
  assert.equal(a.sendMode, 'direct')
  assert.deepEqual(wire.deposited.map((d) => [labelOf(d.bytes), d.mode]),
    [['d1', 'routed'], ['d2', 'direct']])
  a.advance(DEADLINE + H)
  await a.settle()
  assert.equal(wire.deposited.length, 2, 'd1 accepted in routed: never again')
  assert.deepEqual(a.ackState().send.open, [], 'direct holds no open routed deposits')
})

test('an attempt begun before the switch ends in the mode it began in; accepted after the switch, it opens nothing (RLTP-VTI-3135)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const gate = gateAll()
  a.reconcile(viewOf(entryOf('d0')), gate, 0)
  await a.settle()
  const modes = []
  let release
  wire.deposit = (_t, _b, mode) => { modes.push(mode); return new Promise((res) => { release = res }) }
  const [ref] = a.reconcile(viewOf(entryOf('d0'), entryOf('d1', { since: H })), gate, H)
  while (!release) await new Promise((r) => setTimeout(r, 1))
  cleanConclude(a, H)
  a.advance(DEADLINE)
  assert.equal(a.sendMode, 'direct')
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
  assert.equal(a.sendMode, 'direct')
})

test('a submit() without a digest opens nothing: submit-only never switches (RLTP-VTI-3130)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const id = a.submit(sealBytes('x'), 0)
  await a.settle()
  assert.equal(a.status(id).state, 'accepted')
  assert.deepEqual(a.ackState().send, EMPTY)
  cleanConclude(a, H)
  a.advance(10 * DEADLINE)
  assert.equal(a.sendMode, 'routed')
})

test('depositAddressing: the connection DID sends every layer of both modes; it reproduces vectors/vti-routed-addressing.json (RLTP-VTI-1120, 3110, 3115, 3120)', async () => {
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
    sides[k] = (await carrierScopedIdentity(ikm, V.carrier, nonce, 'connection')).did
  }
  for (const k of ['A', 'B']) assert.equal(V.sides[k].connection, sides[k], `side ${k}`)
  const strip = ({ sealedTo, signedBy, payload, ...rest }) => rest
  for (const [from, to] of [['A', 'B'], ['B', 'A']]) {
    const key = `${from}→${to}`
    const r = depositAddressing('routed', sides[from], sides[to], V.carrier)
    assert.deepEqual(r, {
      inner: { messageType: 'direct', sender: sides[from], receiver: sides[to] },
      outer: { messageType: 'routed', sender: sides[from], receiver: V.carrier, route: [sides[to]] },
      session: sides[from],
    }, key)
    const want = V.routed[key]
    assert.deepEqual(r, { inner: strip(want.inner), outer: strip(want.outer), session: want.session }, key)
    const d = depositAddressing('direct', sides[from], sides[to], V.carrier)
    assert.deepEqual(d, { inner: r.inner, outer: null, session: sides[from] }, key)
    const wantD = V.direct[key]
    assert.deepEqual(d, { inner: strip(wantD.message), outer: null, session: wantD.session }, key)
  }
  assert.throws(() => depositAddressing('egress-session', sides.A, sides.B, V.carrier), /mode/)
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
  // the first entry's deposit fails (picked by its seal: the attempts run concurrently)
  wire.deposit = async (...args) => { if (jcs(unwrap(args[1]).document.payload) === sealText('k1/ack')) throw new WireError('unreachable'); return real(...args) }
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
  assert.equal(await wire.offer(sealBytes('one')), true, 'buffered')
  assert.equal(await wire.offer(sealBytes('one')), true, 'already held')
  const c = a.collect(1)
  assert.equal(await wire.offer(sealBytes('one')), true, 'outstanding')
  a.conclude(c, 2)
  await a.settle()
  assert.equal(await wire.offer(sealBytes('one')), true, 'absorbed')
  const big = (i) => te.encode(jcs({ ...sealOf('cap' + i), ciphertext: b64u(filled('cap/' + i, 65_550)) }))
  let i = 0
  while (await wire.offer(big(i))) i++
  assert.ok(i > DECLARED.queueFloorCount && i * big(0).length <= DECLARED.maxQueueBytes, 'buffered up to the cap, then left with the mediator')
  assert.equal(await wire.consumer(new Uint8Array(DECLARED.payloadBound + 1), PEER), true, 'over payload-bound: not parsed, consumed (RLTP-VTI-7160)')
  a.close()
  assert.equal(await wire.offer(sealBytes('two')), false, 'retired')
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
  assert.equal(a.sendMode, 'direct')
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
  const bytes = sealBytes('a document')
  const q = await wire.deliverFromPeer(bytes)
  a.conclude(a.collect(0), 0)
  await a.settle()
  // before the horizon: absorbed, re-acked, never surfaced
  await wire.offer(bytes)
  a.advance(G - 1)
  assert.equal(a.collect(G - 1).items.length, 0, 'absorbed')
  assert.ok(a.ackState().concluded.some((c) => c.queueId === q))
  await a.settle()
  // from the horizon on: a new item for the holder, who absorbs and answers it
  a.advance(G)
  assert.equal(await wire.offer(bytes), true)
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
  const bytes = sealBytes('flying')
  await wire.deliverFromPeer(bytes)
  let release
  wire.ackReceived = () => new Promise((res) => { release = res })
  a.conclude(a.collect(0), 0)
  while (!release) await new Promise((r) => setTimeout(r, 1))
  a.advance(G + 1)
  await wire.offer(bytes)
  assert.equal(a.collect(G + 1).items.length, 0, 'absorbed while its ack flies')
  release()
  await a.settle()
})

test('a later copy in the buffer is not acknowledged away by a standing intent before the holder concludes it: hand off → await → ack (§3, §4)', async () => {
  const G = DECLARED.giveUpHorizonMs
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const bytes = sealBytes('resubmitted')
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
  const bytes = sealBytes('again')
  await wire.deliverFromPeer(bytes)
  a.conclude(a.collect(0), 0); await a.settle()
  a.advance(G)
  await wire.offer(bytes)                         // a later copy: buffered
  let release
  wire.ackReceived = () => new Promise((res) => { release = res })
  // another concluded item makes a flush fly; the buffered id is not in it
  await wire.deliverFromPeer(sealBytes('other'))
  const c0 = a.collect(G)
  assert.equal(c0.items.length, 2)
  await wire.offer(bytes)                         // redelivery while outstanding
  assert.equal(a.collect(G).items.length, 0, 'ignored: outstanding goes before concluded')
  a.conclude(c0, G + 1)
  while (!release) await new Promise((r) => setTimeout(r, 1))
  await wire.offer(bytes)                         // its ack is on the wire now: absorbed
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


// ── counterpart refusals: trust-task-error/0.5 (profile §5, RLTP-VTI-5010 to 5030) ──
const errDoc = (payload, over = {}) => ({ id: 'e1', type: TRUST_TASK_ERROR_TYPE, issuer: 'did:key:z6MkA', recipient: 'did:key:z6MkB', threadId: 't', issuedAt: '2026-10-25T10:00:00Z', payload, ...over })

test('readTrustTaskError: the verdict follows retryable, never the code alone (RLTP-VTI-5010, 5020)', () => {
  assert.equal(TRUST_TASK_ERROR_TYPE, 'https://trusttasks.org/spec/trust-task-error/0.5')
  for (const code of ['malformedRequest', 'unsupportedType', 'unsupportedVersion', 'proofRequired', 'proofInvalid', 'permissionDenied', 'wrongRecipient', 'identityMismatch', 'cancelled', 'taskFailed']) {
    assert.deepEqual(readTrustTaskError(errDoc({ code, retryable: false })), { verdict: 'refused', code }, code)
    assert.deepEqual(readTrustTaskError(errDoc({ code, retryable: true })), { verdict: 'retry', retryAfter: null }, code + ' retryable')
  }
  // a retryable code marked not retryable is a terminal verdict, read as taskFailed
  assert.deepEqual(readTrustTaskError(errDoc({ code: 'unavailable', retryable: false })), { verdict: 'refused', code: 'taskFailed' })
  assert.deepEqual(readTrustTaskError(errDoc({ code: 'internalError', retryable: false })), { verdict: 'refused', code: 'taskFailed' })
  assert.deepEqual(readTrustTaskError(errDoc({ code: 'unavailable', retryable: true, retryAfter: '2026-10-25T10:05:00Z' })), { verdict: 'retry', retryAfter: Date.parse('2026-10-25T10:05:00Z') })
  assert.deepEqual(readTrustTaskError(errDoc({ code: 'unavailable', retryable: true, retryAfter: '2026-10-25T12:05:00+02:00' })), { verdict: 'retry', retryAfter: Date.parse('2026-10-25T10:05:00Z') })
  // an extended code is taskFailed, its retryable and retryAfter honoured
  assert.deepEqual(readTrustTaskError(errDoc({ code: 'acl/grant:roleNotRecognized', retryable: false })), { verdict: 'refused', code: 'taskFailed' })
  assert.deepEqual(readTrustTaskError(errDoc({ code: 'acl/grant:roleNotRecognized', retryable: true, retryAfter: '2026-10-25T11:00:00Z' })), { verdict: 'retry', retryAfter: Date.parse('2026-10-25T11:00:00Z') })
  // idConflict is an answer, whatever it says about retrying (RLTP-VTI-5030)
  assert.deepEqual(readTrustTaskError(errDoc({ code: 'idConflict', retryable: false })), { verdict: 'answered' })
  // expired has no port equivalent
  assert.deepEqual(readTrustTaskError(errDoc({ code: 'expired', retryable: false })), { verdict: 'none' })
  assert.deepEqual(readTrustTaskError(errDoc({ code: 'proofInvalid', retryable: false, message: 'm', inResponseTo: { typeUri: 'https://real-life.org/trust-tasks/spec/star/0.2', id: 'x' }, details: {} })), { verdict: 'refused', code: 'proofInvalid' })
})

const ERR04 = 'https://trusttasks.org/spec/trust-task-error/0.4'
const ERR05 = 'https://trusttasks.org/spec/trust-task-error/0.5'
const ERR06 = 'https://trusttasks.org/spec/trust-task-error/0.6'

test('the versions read: trust-task-error/0.4 (K ≤ N, TT §5.2), 0.5, and 0.6, which extends 0.5 (RLTP-VTI-5015)', () => {
  assert.deepEqual([...TRUST_TASK_ERROR_TYPES], [ERR04, ERR05, ERR06])
  assert.equal(TRUST_TASK_ERROR_TYPE, ERR05)
  // every code of 0.5 reads the same in 0.6
  for (const code of ['malformedRequest', 'unsupportedType', 'unsupportedVersion', 'proofRequired', 'proofInvalid', 'permissionDenied', 'wrongRecipient', 'identityMismatch', 'cancelled', 'taskFailed', 'unavailable', 'internalError', 'idConflict', 'expired', 'acl/grant:roleNotRecognized']) {
    for (const retryable of [false, true]) {
      assert.deepEqual(readTrustTaskError(errDoc({ code, retryable }, { type: ERR06 })), readTrustTaskError(errDoc({ code, retryable }, { type: ERR05 })), `${code} ${retryable}`)
    }
  }
  assert.deepEqual(readTrustTaskError(errDoc({ code: 'unsupportedType', retryable: false, message: 'm', inResponseTo: { typeUri: SEALED_ENVELOPE_TYPE, id: 'x' } }, { type: ERR06 })), { verdict: 'refused', code: 'unsupportedType' })
})

test('trust-task-error/0.4: read by its own schema — the codes of 0.5 but cancelled (RLTP-VTI-5015)', () => {
  for (const code of ['malformedRequest', 'unsupportedType', 'unsupportedVersion', 'proofRequired', 'proofInvalid', 'permissionDenied', 'wrongRecipient', 'identityMismatch', 'taskFailed', 'unavailable', 'internalError', 'idConflict', 'expired', 'acl/grant:roleNotRecognized']) {
    for (const retryable of [false, true]) {
      assert.deepEqual(readTrustTaskError(errDoc({ code, retryable }, { type: ERR04 })), readTrustTaskError(errDoc({ code, retryable }, { type: ERR05 })), `${code} ${retryable}`)
    }
  }
  assert.deepEqual(readTrustTaskError(errDoc({ code: 'unsupportedType', retryable: false, inResponseTo: { typeUri: SEALED_ENVELOPE_TYPE, id: 'x' } }, { type: ERR04 })), { verdict: 'refused', code: 'unsupportedType' })
  for (const code of ['cancelled', 'unsupportedExtension', 'indeterminate']) assert.equal(readTrustTaskError(errDoc({ code, retryable: false }, { type: ERR04 })), null, `${code} in 0.4`)
})

test('trust-task-error/0.6: unsupportedExtension is terminal; indeterminate is never a refusal, whatever its retryable (RLTP-VTI-5020, TT §8.3)', () => {
  assert.deepEqual(readTrustTaskError(errDoc({ code: 'unsupportedExtension', retryable: false }, { type: ERR06 })), { verdict: 'refused', code: 'unsupportedExtension' })
  assert.deepEqual(readTrustTaskError(errDoc({ code: 'unsupportedExtension', retryable: true }, { type: ERR06 })), { verdict: 'retry', retryAfter: null }, 'read by retryable, never by the default of the code')
  assert.deepEqual(readTrustTaskError(errDoc({ code: 'indeterminate', retryable: true }, { type: ERR06 })), { verdict: 'undecided', retryable: true, retryAfter: null })
  assert.deepEqual(readTrustTaskError(errDoc({ code: 'indeterminate', retryable: true, retryAfter: '2026-10-28T10:05:00.000000000Z', details: { reference: 'schema' } }, { type: ERR06 })), { verdict: 'undecided', retryable: true, retryAfter: Date.parse('2026-10-28T10:05:00Z') })
  assert.deepEqual(readTrustTaskError(errDoc({ code: 'indeterminate', retryable: false }, { type: ERR06 })), { verdict: 'undecided', retryable: false, retryAfter: null })
})

test('the codes of 0.6 are no codes of 0.5; other versions are no refusal (RLTP-VTI-5015)', () => {
  for (const code of ['unsupportedExtension', 'indeterminate']) {
    for (const retryable of [false, true]) assert.equal(readTrustTaskError(errDoc({ code, retryable }, { type: ERR05 })), null, `${code} in 0.5`)
  }
  for (const v of ['0.1', '0.2', '0.3', '0.7', '1.0', '0.60', '0.06', '0.40']) {
    assert.equal(readTrustTaskError(errDoc({ code: 'unsupportedType', retryable: false }, { type: 'https://trusttasks.org/spec/trust-task-error/' + v })), null, v)
  }
  assert.equal(readTrustTaskError(errDoc({ code: 'unsupportedType', retryable: false, severity: 'high' }, { type: ERR06 })), null, 'a member outside the 0.6 schema')
})

test('readTrustTaskError is total: anything not a trust-task-error/0.5 document is null, never a throw', () => {
  const bad = [
    undefined, null, 5, 'x', [], {},
    errDoc({ code: 'proofInvalid', retryable: false }, { type: 'https://trusttasks.org/spec/trust-task-error/0.2' }),
    errDoc({ code: 'proofInvalid' }),
    errDoc({ retryable: false }),
    errDoc({ code: 'proofInvalid', retryable: 'no' }),
    errDoc({ code: 'notACode', retryable: false }),
    errDoc({ code: 'Acl:x', retryable: false }),
    errDoc({ code: 'proofInvalid', retryable: false, extra: 1 }),
    errDoc({ code: 'unavailable', retryable: true, retryAfter: '2026-02-30T10:00:00Z' }),
    errDoc({ code: 'unavailable', retryable: true, retryAfter: 'tomorrow' }),
    errDoc({ code: 'unavailable', retryable: true, retryAfter: 5 }),
    errDoc({ code: 'proofInvalid', retryable: false, message: 'x'.repeat(1025) }),
    errDoc({ code: 'proofInvalid', retryable: false, inResponseTo: {} }),
    errDoc({ code: 'proofInvalid', retryable: false, details: [] }),
    errDoc(null), errDoc([]),
    { get type () { throw new Error('getter') } },
  ]
  bad.forEach((d, i) => assert.equal(readTrustTaskError(d), null, `case ${i}`))
})

test('a counterpart retry with retryAfter: the next attempt starts no earlier, the give-up horizon still ends it (RLTP-VTI-5010)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  wire.depositFailure = 'refused-retriable'
  const id = a.submit(sealBytes('x'), 0)
  await a.settle()
  assert.equal(a.status(id).state, 'awaiting-transport')
  wire.depositFailure = null
  // a validated retryable refusal arrives before the deposit resolved: no port transition
  a.receiverRetry(id, 10_000)
  assert.equal(a.status(id).state, 'awaiting-transport')
  a.advance(9_999); await a.settle()
  assert.equal(wire.deposited.length, 0, 'not before retryAfter')
  a.advance(10_000); await a.settle()
  assert.equal(wire.deposited.length, 1, 'at retryAfter')
  assert.deepEqual(a.status(id), { state: 'accepted' })
  // a retryAfter beyond the horizon: the submission ends at the horizon, never attempted
  const wire2 = new WireDouble()
  const { a: a2 } = await adapter(wire2)
  wire2.depositFailure = 'refused-retriable'
  const id2 = a2.submit(sealBytes('y'), 0)
  await a2.settle()
  wire2.depositFailure = null
  a2.receiverRetry(id2, DECLARED.giveUpHorizonMs + 1)
  a2.advance(DECLARED.giveUpHorizonMs - 1); await a2.settle()
  assert.equal(wire2.deposited.length, 0)
  a2.advance(DECLARED.giveUpHorizonMs); await a2.settle()
  assert.deepEqual(a2.status(id2), { state: 'failed', reason: 'expired-by-adapter-policy' })
  // without retryAfter the next advance may try; on an accepted submission nothing moves back
  const wire3 = new WireDouble()
  const { a: a3 } = await adapter(wire3)
  const id3 = a3.submit(sealBytes('z'), 0)
  await a3.settle()
  a3.receiverRetry(id3, null)
  assert.deepEqual(a3.status(id3), { state: 'accepted' }, 'accepted stays accepted')
  assert.throws(() => a3.receiverRetry(id3, Number.NaN), /retryAfter/)
})

test('readTrustTaskError: RFC 3339 as written — lowercase t and z, a leap second, an offset (review 2 of #129)', () => {
  const retry = (retryAfter) => readTrustTaskError(errDoc({ code: 'unavailable', retryable: true, retryAfter }))
  assert.deepEqual(retry('2026-10-25t10:05:00z'), { verdict: 'retry', retryAfter: Date.parse('2026-10-25T10:05:00Z') })
  assert.deepEqual(retry('2026-12-31T23:59:60Z'), { verdict: 'retry', retryAfter: Date.parse('2027-01-01T00:00:00Z') }, 'a leap second reads as the next second')
  assert.deepEqual(retry('2026-10-25T12:05:00.5+02:00'), { verdict: 'retry', retryAfter: Date.parse('2026-10-25T10:05:00.500Z') })
  // years 0000 to 0099 are years, not 19xx
  assert.deepEqual(retry('0050-03-01T00:00:00Z'), { verdict: 'retry', retryAfter: Date.parse('0050-03-01T00:00:00Z') })
  assert.deepEqual(retry('0000-01-01T00:00:00Z'), { verdict: 'retry', retryAfter: Date.parse('0000-01-01T00:00:00Z') })
  assert.equal(retry('0099-02-29T00:00:00Z'), null, '99 is no leap year')
  for (const bad of ['2026-10-25T24:00:00Z', '2026-10-25T10:60:00Z', '2026-10-25T10:00:61Z', '2026-10-25T10:00:00+24:00', '2026-10-25 10:00:00Z', '2026-10-25T10:00:00'])
    assert.equal(retry(bad), null, bad)
})

test('readTrustTaskError: fuzz — 20 000 seeded mutations of a valid error document never throw and answer null or one verdict', () => {
  let seed = 0x5eed5010
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const base = JSON.stringify(errDoc({ code: 'acl/grant:roleNotRecognized', retryable: true, retryAfter: '2026-10-25T10:05:00Z', message: 'm', inResponseTo: { typeUri: 'https://real-life.org/trust-tasks/spec/star/0.2', id: 'x' }, details: {} }))
  const pool = ['"', '{', '}', '[', ']', ',', ':', '\\', ' ', 'true', 'false', 'null', '1', 'z', 'T', '+', '-', '__proto__', 'idConflict', 'expired', 'unavailable', 'retryable', 'code', '\ud800', '🌱', 'é', '😀😀', '\udc00', '\u0000', 'm'.repeat(600), '🌱'.repeat(600)]
  const ok = (r) => r === null || (r.verdict === 'refused' && typeof r.code === 'string') || (r.verdict === 'retry' && (r.retryAfter === null || Number.isFinite(r.retryAfter))) || (r.verdict === 'undecided' && typeof r.retryable === 'boolean') || r.verdict === 'answered' || r.verdict === 'none'
  let read = 0
  for (let i = 0; i < 20_000; i++) {
    let t = base
    for (let k = 1 + Math.floor(rnd() * 3); k > 0; k--) {
      const at = Math.floor(rnd() * (t.length + 1)), op = rnd()
      const piece = pool[Math.floor(rnd() * pool.length)]
      t = op < 0.34 ? t.slice(0, at) + piece + t.slice(at) : op < 0.67 ? t.slice(0, at) + t.slice(at + 1 + Math.floor(rnd() * 8)) : t.slice(0, at) + piece + t.slice(at + 1)
    }
    let doc
    try { doc = JSON.parse(t) } catch { doc = t }
    const r = readTrustTaskError(doc)
    assert.ok(ok(r), `mutation ${i}: ${t}`)
    if (r !== null) read++
  }
  assert.ok(read > 0 && read < 20_000, `some mutations still read (${read})`)
})


test('readTrustTaskError: message is bounded in code points, as the registry schema\'s maxLength counts, never in UTF-16 units (#130)', () => {
  for (const [code, retryable, want] of [['permissionDenied', false, { verdict: 'refused', code: 'permissionDenied' }], ['unavailable', true, { verdict: 'retry', retryAfter: null }]]) {
    for (const [ch, n, ok] of [['a', 1024, true], ['a', 1025, false], ['🌱', 512, true], ['🌱', 513, true], ['🌱', 1024, true], ['🌱', 1025, false], ['é', 1024, true], ['é', 1025, false]]) {
      const r = readTrustTaskError(errDoc({ code, retryable, message: ch.repeat(n) }))
      assert.deepEqual(r, ok ? want : null, `${code}: ${n} × ${ch}`)
    }
  }
})

// ── the carried document (profile 0.29 §3b, RLTP-VTI-3150, 7160) ──────

test('submit refuses bytes that are no sealed envelope (Delivery §5): not JSON, other members, non-strings', async () => {
  const { a } = await adapter(new WireDouble())
  assert.throws(() => a.submit(te.encode('x'), 0), TypeError)
  assert.throws(() => a.submit(te.encode(jcs({ ...sealOf('x'), extra: 'y' })), 0), TypeError)
  assert.throws(() => a.submit(te.encode(jcs({ ...sealOf('x'), epk: 5 })), 0), TypeError)
  assert.equal(a.has('s1'), false, 'nothing filed')
})

test('RLTP-VTI-3150: a deposit carries the binding envelope byte for byte as wrapSealed builds it from seal, both connection DIDs and since', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  a.reconcile(viewOf(entryOf('d1', { since: 1_700_000_123_456 })), gateAll(), 1_700_000_200_000)
  await a.settle()
  const want = await wrapSealed(sealOf('d1/document'), { issuer: a.connectionDid, recipient: PEER, since: 1_700_000_123_456 })
  assert.deepEqual(wire.deposited[0].payload, want.bytes)
  assert.equal(wire.deposited[0].document.issuedAt, '2023-11-14T22:15:23Z', 'the entry\'s since in whole seconds with Z, never the hand-over')
  assert.equal(wire.deposited[0].document.id, want.outerId)
  assert.equal(wire.deposited[0].document.threadId, want.outerId)
  assert.match(want.outerId, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'UUID v8 (RLTP-DEL-4620)')
})

test('RLTP-VTI-3150, RLTP-DEL-5040: a retry carries a byte-identical payload', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const payloads = []
  let fail = true
  wire.deposit = async (t, b, m) => { payloads.push(b.slice()); if (fail) { fail = false; throw new WireError('unreachable') } }
  a.reconcile(viewOf(entryOf('d1', { since: 1000 })), gateAll(), 1000)
  await a.settle()
  a.advance(2000)
  await a.settle()
  assert.equal(payloads.length, 2)
  assert.deepEqual(payloads[1], payloads[0])
})

test('RLTP-VTI-3150: without a counterpart (a displayed card\'s instance not bound) nothing is deposited: awaiting-transport(transport-unreachable)', async () => {
  const wire = new WireDouble()
  wire.peer = null
  const { a } = await adapter(wire)
  const id = a.submit(sealBytes('x'), 0)
  await a.settle()
  assert.deepEqual(wire.deposited, [])
  assert.deepEqual(a.status(id), { state: 'awaiting-transport', reason: 'transport-unreachable' })
})

test('RLTP-VTI-7160: a carried document from the sender to this side becomes an item: the JCS of its seal, under the digest of the payload', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const q = await wire.deliverFromPeer(sealBytes('in'), { since: 5000 })
  assert.equal(q, await queueIdOf(await wire.wrap(sealBytes('in'), { since: 5000 })))
  const c = a.collect(1)
  assert.equal(c.items.length, 1)
  assert.equal(c.items[0].queueId, q)
  assert.equal(new TextDecoder().decode(c.items[0].bytes), sealText('in'))
})

/** the carried document of `label`, altered by `mutate`, as a payload */
async function carried (wire, label, mutate = (d) => d) {
  const o = JSON.parse(new TextDecoder().decode(await wire.wrap(sealBytes(label))))
  o.document = mutate(o.document)
  return te.encode(jcs(o))
}

test('RLTP-VTI-7160: every payload that carries no sealed envelope to this side is no item, is logged, and is acknowledged at the next step', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const OTHER = (await carrierScopedIdentity(new Uint8Array(32).fill(3), MEDIATOR_DID, new Uint8Array(32).fill(4), 'connection')).did
  const cases = [
    ['issuer is not the sender', await carried(wire, 'c1', (d) => ({ ...d, issuer: OTHER }))],
    ['recipient is not this side', await carried(wire, 'c2', (d) => ({ ...d, recipient: OTHER }))],
    ['a proof', await carried(wire, 'c3', (d) => ({ ...d, proof: { type: 'DataIntegrityProof' } }))],
    ['an extra member in the payload', await carried(wire, 'c4', (d) => ({ ...d, payload: { ...d.payload, extra: 'x' } }))],
    ['a non-canonical ciphertext', await carried(wire, 'c5', (d) => ({ ...d, payload: { ...d.payload, ciphertext: d.payload.ciphertext.slice(0, -1) + 'B' } }))],
    ['threadId other than id', await carried(wire, 'c6', (d) => ({ ...d, threadId: '00000000-0000-8000-8000-000000000000' }))],
    ['an id of version 4', await carried(wire, 'c7', (d) => ({ ...d, id: '00000000-0000-4000-8000-000000000000', threadId: '00000000-0000-4000-8000-000000000000' }))],
    ['over payload-bound', te.encode(' '.repeat(DECLARED.payloadBound + 1))],
    ['a bare seal as the payload', sealBytes('bare')],
    ['a document of another type', await carried(wire, 'c8', (d) => ({ ...d, type: 'https://real-life.org/trust-tasks/spec/message/0.1' }))],
    ['another envelope type', te.encode(jcs({ type: 'https://example.org/other', document: {} }))],
  ]
  const ids = []
  for (const [, bytes] of cases) ids.push(await wire.deliverRaw(bytes))
  assert.equal(a.collect(1).items.length, 0, 'no item for the holder')
  assert.equal(wire.logged.length, cases.length, 'one log line each')
  assert.equal(wire.queue.size, cases.length)
  a.advance(2)
  await a.settle()
  assert.equal(wire.queue.size, 0, 'all acknowledged at the next step')
  for (const id of ids) assert.ok(a.ackState().concluded.some((c) => c.queueId === id))
  // the carried document itself passes: the cases fail on their alteration alone
  await wire.deliverFromPeer(sealBytes('c1'))
  assert.equal(a.collect(3).items.length, 1)
})

// ── answers (RLTP-VTI-5040, 5010 to 5030, 5050) ──────────────────────

let answerSeq = 0
/** a counterpart's framework document answering this side, as a payload */
function answer (wire, type, payload, extra = {}) {
  const n = String(++answerSeq).padStart(12, '0')
  const document = { id: `0d6c0000-0000-4000-8000-${n}`, type, issuer: PEER, recipient: wire.self, issuedAt: '2026-10-27T18:04:12Z', payload, ...extra }
  return te.encode(jcs({ type: TSP_BINDING_ENVELOPE_TYPE, document }))
}
const refusal = (code, retryable, inResponseTo) => ({ code, retryable, ...(inResponseTo ? { inResponseTo } : {}) })
const NEXT = { expects: [{ typeUri: 'https://example.org/spec/more/0.1' }] }

/** a document reconciled and accepted; its carried document's id */
const gates = new WeakMap()
async function accepted (a, wire, digest = 'd1') {
  if (!gates.has(a)) gates.set(a, gateAll())
  const [ref] = a.reconcile(viewOf(entryOf(digest)), gates.get(a), 0)
  await a.settle()
  return { ref, outerId: wire.deposited.at(-1).document.id }
}

test('RLTP-VTI-5040: unsupportedType with inResponseTo.id = the carried document\'s id fails the accepted submission; the answer is no item and is acknowledged', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const { ref, outerId } = await accepted(a, wire)
  const q = await wire.deliverRaw(answer(wire, TRUST_TASK_ERROR_TYPE, refusal('unsupportedType', false, { typeUri: SEALED_ENVELOPE_TYPE, id: outerId }), { threadId: outerId }))
  assert.deepEqual(a.report(ref.submissionId), { digest: 'd1', status: 'failed', reason: 'rejected-by-receiver', code: 'unsupportedType' })
  const c = a.collect(1)
  assert.equal(c.items.length, 0)
  assert.deepEqual(c.answers.map((x) => x.report), [a.report(ref.submissionId)], 'the answer travels in the collection with its report (RLTP-VTI-5080)')
  a.advance(2); await a.settle()
  assert.equal(wire.queue.has(q), true, 'not acknowledged before the conclusion')
  a.conclude(c, 2); await a.settle()
  assert.equal(wire.queue.has(q), false, 'acknowledged at the conclusion')
})

test('RLTP-VTI-5040: without inResponseTo the answer binds by threadId', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const { ref, outerId } = await accepted(a, wire)
  await wire.deliverRaw(answer(wire, TRUST_TASK_ERROR_TYPE, refusal('unsupportedType', false), { threadId: outerId }))
  assert.equal(a.status(ref.submissionId).code, 'unsupportedType')
})

test('RLTP-VTI-5040: an answer that binds nothing changes nothing — a foreign id, another issuer, another recipient, another typeUri', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const { ref, outerId } = await accepted(a, wire)
  const OTHER = (await carrierScopedIdentity(new Uint8Array(32).fill(3), MEDIATOR_DID, new Uint8Array(32).fill(4), 'connection')).did
  const r = (inResponseTo) => refusal('unsupportedType', false, inResponseTo)
  await wire.deliverRaw(answer(wire, TRUST_TASK_ERROR_TYPE, r({ typeUri: SEALED_ENVELOPE_TYPE, id: 'not-ours' }), { threadId: outerId }))
  await wire.deliverRaw(answer(wire, TRUST_TASK_ERROR_TYPE, r({ typeUri: SEALED_ENVELOPE_TYPE, id: outerId }), { issuer: OTHER }))
  await wire.deliverRaw(answer(wire, TRUST_TASK_ERROR_TYPE, r({ typeUri: SEALED_ENVELOPE_TYPE, id: outerId }), { recipient: OTHER }))
  await wire.deliverRaw(answer(wire, TRUST_TASK_ERROR_TYPE, r({ typeUri: 'https://real-life.org/trust-tasks/spec/message/0.1', id: outerId })))
  // from another sender altogether
  await wire.deliverRaw(answer(wire, TRUST_TASK_ERROR_TYPE, r({ typeUri: SEALED_ENVELOPE_TYPE, id: outerId })), OTHER)
  assert.deepEqual(a.status(ref.submissionId), { state: 'accepted' })
  assert.equal(wire.logged.length, 5)
})

test('RLTP-VTI-5010, 5030: retryable:true is no transition; idConflict answers the open routed deposit and changes no state', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const { ref, outerId } = await accepted(a, wire)
  const to = { typeUri: SEALED_ENVELOPE_TYPE, id: outerId }
  await wire.deliverRaw(answer(wire, TRUST_TASK_ERROR_TYPE, refusal('unavailable', true, to)))
  assert.deepEqual(a.status(ref.submissionId), { state: 'accepted' })
  assert.deepEqual(a.ackState().send.open.map((o) => o.digest), ['d1'], 'a retry answers nothing')
  await wire.deliverRaw(answer(wire, TRUST_TASK_ERROR_TYPE, refusal('idConflict', false, to)))
  assert.deepEqual(a.status(ref.submissionId), { state: 'accepted' })
  assert.deepEqual(a.ackState().send.open, [], 'idConflict answers it')
})

test('RLTP-VTI-5020: indeterminate moves nothing, retryable or not; bound, it travels in the collection with the unchanged report and its diagnosis, and is acknowledged at the conclusion', async () => {
  for (const retryable of [true, false]) {
    const wire = new WireDouble()
    const { a } = await adapter(wire)
    const { ref, outerId } = await accepted(a, wire)
    const q = await wire.deliverRaw(answer(wire, 'https://trusttasks.org/spec/trust-task-error/0.6', { ...refusal('indeterminate', retryable, { typeUri: SEALED_ENVELOPE_TYPE, id: outerId }), details: { reference: 'schema' } }, { threadId: outerId }))
    assert.deepEqual(a.status(ref.submissionId), { state: 'accepted' }, `no port transition (retryable ${retryable})`)
    assert.deepEqual(a.ackState().send.open.map((o) => o.digest), ['d1'], 'answers no routed deposit')
    const c = a.collect(1)
    assert.equal(c.items.length, 0)
    assert.deepEqual(c.answers.map((x) => [x.submissionId, x.report, x.diagnosis]), [[ref.submissionId, { digest: 'd1', status: 'accepted' }, { code: 'indeterminate', retryable }]])
    a.advance(2); await a.settle()
    assert.equal(wire.queue.has(q), true, 'not acknowledged before the conclusion')
    a.conclude(c, 2); await a.settle()
    assert.equal(wire.queue.has(q), false, 'acknowledged at the conclusion')
  }
})

test('RLTP-VTI-5015, 5020: trust-task-error/0.6 as the registry crates send it — unsupportedType fails, indeterminate retryable moves nothing and answers no routed deposit, unsupportedExtension fails', async () => {
  const ERR6 = 'https://trusttasks.org/spec/trust-task-error/0.6'
  {
    const wire = new WireDouble()
    const { a } = await adapter(wire)
    const { ref, outerId } = await accepted(a, wire)
    await wire.deliverRaw(answer(wire, ERR6, refusal('unsupportedType', false, { typeUri: SEALED_ENVELOPE_TYPE, id: outerId }), { threadId: outerId }))
    assert.deepEqual(a.report(ref.submissionId), { digest: 'd1', status: 'failed', reason: 'rejected-by-receiver', code: 'unsupportedType' })
  }
  {
    const wire = new WireDouble()
    const { a } = await adapter(wire)
    const { ref, outerId } = await accepted(a, wire)
    const to = { typeUri: SEALED_ENVELOPE_TYPE, id: outerId }
    await wire.deliverRaw(answer(wire, ERR6, { ...refusal('indeterminate', true, to), details: { reference: 'schema' } }, { threadId: outerId }))
    assert.deepEqual(a.status(ref.submissionId), { state: 'accepted' }, 'no port transition')
    assert.deepEqual(a.ackState().send.open.map((o) => o.digest), ['d1'], 'a retry answers nothing')
    await wire.deliverRaw(answer(wire, ERR6, refusal('unsupportedExtension', false, to), { threadId: outerId }))
    assert.deepEqual(a.report(ref.submissionId), { digest: 'd1', status: 'failed', reason: 'rejected-by-receiver', code: 'unsupportedExtension' })
  }
  {
    // the codes 0.6 adds are no codes of 0.5: such a document is no answer
    const wire = new WireDouble()
    const { a } = await adapter(wire)
    const { ref, outerId } = await accepted(a, wire)
    await wire.deliverRaw(answer(wire, TRUST_TASK_ERROR_TYPE, refusal('unsupportedExtension', false, { typeUri: SEALED_ENVELOPE_TYPE, id: outerId }), { threadId: outerId }))
    assert.deepEqual(a.status(ref.submissionId), { state: 'accepted' })
  }
})

test('RLTP-VTI-5050: a valid next step makes the submission accepted and held; report() carries held; it answers the open routed deposit', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const { ref, outerId } = await accepted(a, wire)
  const q = await wire.deliverRaw(answer(wire, TRUST_TASK_NEXT_STEP_TYPE, { ...NEXT, inResponseTo: { typeUri: SEALED_ENVELOPE_TYPE, id: outerId } }, { threadId: outerId }))
  assert.deepEqual(a.status(ref.submissionId), { state: 'accepted', held: true })
  assert.deepEqual(a.report(ref.submissionId), { digest: 'd1', status: 'accepted', held: true })
  assert.deepEqual(a.ackState().send.open, [])
  const c = a.collect(1)
  assert.equal(c.items.length, 0, 'a next step never reaches the holder as an item')
  assert.equal(c.answers.length, 1)
  a.conclude(c, 2); await a.settle()
  assert.equal(wire.queue.has(q), false)
})

test('RLTP-VTI-5050: a next step without inResponseTo binds by threadId; one before the deposit resolves makes it held too', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const { ref, outerId } = await accepted(a, wire)
  await wire.deliverRaw(answer(wire, TRUST_TASK_NEXT_STEP_TYPE, NEXT, { threadId: outerId }))
  assert.deepEqual(a.status(ref.submissionId), { state: 'accepted', held: true })

  const wire2 = new WireDouble()
  let release
  const real = wire2.deposit.bind(wire2)
  wire2.deposit = (...args) => new Promise((res) => { release = () => res(real(...args)) })
  const { a: a2 } = await adapter(wire2)
  const [r2] = a2.reconcile(viewOf(entryOf('d2')), gateAll(), 0)
  while (!release) await new Promise((r) => setTimeout(r, 1))
  const id2 = (await wrapSealed(sealOf('d2/document'), { issuer: a2.connectionDid, recipient: PEER, since: 0 })).outerId
  await wire2.deliverRaw(answer(wire2, TRUST_TASK_NEXT_STEP_TYPE, NEXT, { threadId: id2 }))
  assert.deepEqual(a2.status(r2.submissionId), { state: 'accepted', held: true }, 'the next step proves the arrival')
  release(); await a2.settle()
  assert.deepEqual(a2.status(r2.submissionId), { state: 'accepted', held: true }, 'the resolution does not displace it')
  assert.deepEqual(a2.ackState().send.open, [], 'and nothing is opened after it')
})

test('RLTP-VTI-5050: what is no next step changes nothing — expects empty, typeUri empty, an unknown member, continuation outside the enum, a message of 1025 code points, an invalid proof', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const { ref, outerId } = await accepted(a, wire)
  const bad = [
    { expects: [] },
    { expects: [{ typeUri: '' }] },
    { ...NEXT, other: 1 },
    { ...NEXT, expects: [{ typeUri: 'x', more: 1 }] },
    { ...NEXT, continuation: 'later' },
    { ...NEXT, message: '😀'.repeat(1025) },
  ]
  for (const p of bad) await wire.deliverRaw(answer(wire, TRUST_TASK_NEXT_STEP_TYPE, p, { threadId: outerId }))
  await wire.deliverRaw(answer(wire, TRUST_TASK_NEXT_STEP_TYPE, NEXT, {
    threadId: outerId,
    proof: { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', created: '2026-10-27T18:04:12Z', verificationMethod: PEER + '#' + PEER.slice(8), proofPurpose: 'authentication', proofValue: 'z' + '1'.repeat(80) },
  }))
  assert.deepEqual(a.status(ref.submissionId), { state: 'accepted' })
  assert.equal(wire.logged.length, bad.length + 1)
  // 1024 code points is still a message
  await wire.deliverRaw(answer(wire, TRUST_TASK_NEXT_STEP_TYPE, { ...NEXT, message: '😀'.repeat(1024) }, { threadId: outerId }))
  assert.deepEqual(a.status(ref.submissionId), { state: 'accepted', held: true })
})

test('RLTP-VTI-5050: a next step with a valid eddsa-jcs-2022 proof under its issuer (purpose authentication) makes it held', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const { ref, outerId } = await accepted(a, wire)
  const { cat, sha, base58 } = await import('../dist/crypto.js')
  const doc = { id: '0d6c0000-0000-4000-8000-0000000000ff', type: TRUST_TASK_NEXT_STEP_TYPE, issuer: PEER, recipient: wire.self, threadId: outerId, issuedAt: '2026-10-27T18:04:12Z', payload: NEXT }
  const cfg = { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', created: '2026-10-27T18:04:12Z', verificationMethod: PEER + '#' + PEER.slice(8), proofPurpose: 'authentication' }
  const hashData = cat(await sha(te.encode(jcs(cfg))), await sha(te.encode(jcs(doc))))
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, PEER_ID.key.priv, hashData))
  const signed = { ...doc, proof: { ...cfg, proofValue: 'z' + base58(sig) } }
  assert.notEqual(await readTrustTaskNextStep(signed), null)
  await wire.deliverRaw(te.encode(jcs({ type: TSP_BINDING_ENVELOPE_TYPE, document: signed })))
  assert.deepEqual(a.status(ref.submissionId), { state: 'accepted', held: true })
})

test('RLTP-VTI-5050: a next step after delivered or failed changes nothing; after held a late ack delivers and a refusal fails', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const one = await accepted(a, wire, 'd1')
  const two = await accepted(a, wire, 'd2')
  a.acknowledged(one.ref.submissionId)
  a.receiverRefused(two.ref.submissionId, 'proofInvalid')
  for (const { outerId } of [one, two]) await wire.deliverRaw(answer(wire, TRUST_TASK_NEXT_STEP_TYPE, NEXT, { threadId: outerId }))
  assert.deepEqual(a.status(one.ref.submissionId), { state: 'delivered', late: false })
  assert.equal(a.status(two.ref.submissionId).state, 'failed')

  const three = await accepted(a, wire, 'd3')
  const four = await accepted(a, wire, 'd4')
  for (const { outerId } of [three, four]) await wire.deliverRaw(answer(wire, TRUST_TASK_NEXT_STEP_TYPE, NEXT, { threadId: outerId }))
  a.acknowledged(three.ref.submissionId)
  assert.deepEqual(a.status(three.ref.submissionId), { state: 'delivered', late: false })
  await wire.deliverRaw(answer(wire, TRUST_TASK_ERROR_TYPE, refusal('permissionDenied', false), { threadId: four.outerId }))
  assert.deepEqual(a.status(four.ref.submissionId), { state: 'failed', reason: 'rejected-by-receiver', code: 'permissionDenied' })
})

test('RLTP-VTI-5050, §2: a held submission is not ended at the give-up horizon; one not held is', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const held = await accepted(a, wire, 'd1')
  const plain = await accepted(a, wire, 'd2')
  await wire.deliverRaw(answer(wire, TRUST_TASK_NEXT_STEP_TYPE, NEXT, { threadId: held.outerId }))
  a.advance(DECLARED.giveUpHorizonMs + 1)
  assert.deepEqual(a.status(held.ref.submissionId), { state: 'accepted', held: true })
  assert.deepEqual(a.status(plain.ref.submissionId), { state: 'failed', reason: 'expired-by-adapter-policy' })
})

test('RLTP-VTI-5050, 3130: a next step answers the open routed deposit — no switch at the deadline', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const { outerId } = await accepted(a, wire)
  await wire.deliverRaw(answer(wire, TRUST_TASK_NEXT_STEP_TYPE, NEXT, { threadId: outerId }))
  cleanConclude(a, 1)
  a.advance(DECLARED.routedAckDeadlineMs + 10)
  assert.equal(a.sendMode, 'routed')
})

test('readBindingEnvelope is total: no input throws', async () => {
  for (const bytes of [new Uint8Array(0), te.encode('null'), te.encode('[]'), new Uint8Array([0xff, 0xfe]), te.encode('{"type":1}')]) {
    assert.equal((await readBindingEnvelope(bytes, { sender: PEER, self: PEER })).kind, 'ignored')
  }
})

// ── RLTP-VTI-5060: an answer's timestamps are the framework's ─────────
test('an answer is read with any RFC 3339 issuedAt — nine fractional digits, an offset — and refused only when it is none (RLTP-VTI-5060)', async () => {
  const { readBindingEnvelope: read, TSP_BINDING_ENVELOPE_TYPE: ENV, SEALED_ENVELOPE_TYPE: SE } = await import('@real-life/trust-protocol/adapters/vti-mediator')
  const self = 'did:key:z6MkSelf', peer = 'did:key:z6MkPeer'
  // the form trust-tasks-rs 0.35.4 sends (Dispatcher::dispatch_or_reject)
  const answer = (issuedAt) => te.encode(JSON.stringify({ type: ENV, document: {
    id: 'urn:uuid:0d6c1b52-6b0e-4a8a-9d1c-3e2f4a5b6c7d', type: TRUST_TASK_ERROR_TYPE, issuer: peer, recipient: self,
    threadId: 'f00d', issuedAt, payload: { code: 'unsupportedType', retryable: false, inResponseTo: { id: 'f00d', typeUri: SE } },
  } }))
  for (const t of ['2026-10-27T17:27:50.395371028Z', '2026-10-27T19:27:50.4+02:00', '2026-10-27t17:27:50z']) {
    assert.deepEqual(await read(answer(t), { sender: peer, self }), { kind: 'error', reading: { verdict: 'refused', code: 'unsupportedType' }, answers: 'f00d' }, t)
  }
  for (const t of ['2026-10-27 17:27:50Z', '2026-13-01T00:00:00Z', 1761586070]) {
    assert.equal((await read(answer(t), { sender: peer, self })).kind, 'ignored', String(t))
  }
})

// ── review of #136, M5: answers to an acknowledgement change nothing ──
test('RLTP-VTI-5040: an answer to a carried acknowledgement changes nothing — no held, no refusal; acknowledgements have no trias (review #136 M5)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const [ref] = a.reconcile(viewOf(entryOf('k1', { kind: 'ack' })), gateAll(), 0)
  await a.settle()
  const outerId = wire.deposited.at(-1).document.id
  const before = a.status(ref.submissionId)
  await wire.deliverRaw(answer(wire, TRUST_TASK_NEXT_STEP_TYPE, NEXT, { threadId: outerId }))
  assert.deepEqual(a.status(ref.submissionId), before, 'a next step on an ack: no held')
  await wire.deliverRaw(answer(wire, TRUST_TASK_ERROR_TYPE, refusal('unsupportedType', false, { typeUri: SEALED_ENVELOPE_TYPE, id: outerId })))
  assert.deepEqual(a.status(ref.submissionId), before, 'a refusal on an ack: nothing')
  assert.equal(wire.logged.length, 2, 'both logged')
  a.advance(DECLARED.giveUpHorizonMs + 1)
  assert.equal(a.status(ref.submissionId).state, 'failed', 'the ack ends at its horizon like any accepted ack')
})

// ── review of #136, M4: an error document with a proof is held to it ──
test('RLTP-VTI-5010: an error document whose proof does not verify under its issuer is no refusal; a valid one is (review #136 M4)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const { ref, outerId } = await accepted(a, wire)
  const to = { typeUri: SEALED_ENVELOPE_TYPE, id: outerId }
  const cfg = { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', created: '2026-10-27T18:04:12Z', verificationMethod: PEER + '#' + PEER.slice(8), proofPurpose: 'authentication' }
  await wire.deliverRaw(answer(wire, TRUST_TASK_ERROR_TYPE, refusal('unsupportedType', false, to), { proof: { ...cfg, proofValue: 'z' + '1'.repeat(80) } }))
  assert.deepEqual(a.status(ref.submissionId), { state: 'accepted' }, 'an invalid proof: no refusal')
  const { cat, sha, base58 } = await import('../dist/crypto.js')
  const doc = { id: '0d6c0000-0000-4000-8000-0000000000fe', type: TRUST_TASK_ERROR_TYPE, issuer: PEER, recipient: wire.self, threadId: outerId, issuedAt: '2026-10-27T18:04:12.395371028Z', payload: refusal('unsupportedType', false, to) }
  const hashData = cat(await sha(te.encode(jcs(cfg))), await sha(te.encode(jcs(doc))))
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, PEER_ID.key.priv, hashData))
  await wire.deliverRaw(te.encode(jcs({ type: TSP_BINDING_ENVELOPE_TYPE, document: { ...doc, proof: { ...cfg, proofValue: 'z' + base58(sig) } } })))
  assert.equal(a.status(ref.submissionId).code, 'unsupportedType', 'a valid proof: the refusal stands')
})

// ── answers across openings (RLTP-VTI-5065, Delivery RLTP-DEL-6150) ───
const answerableOf = (digest, { since = 0, held = false } = {}) => ({ digest, kind: 'document', envelope: sealOf(`${digest}/document`), recipient: {}, since, held })
const viewWith = (entries, answerable) => ({ ok: true, entries, answerable })
/** opening 1: d1 deposited and accepted; then closed. Opening 2 over the same wire. */
async function twoOpenings (opts = {}) {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const { outerId } = await accepted(a, wire, 'd1')
  const first = wire.deposited.at(-1)
  a.close()
  const { a: b } = await adapter(wire, a.ackState(), 1)
  const deposits = wire.deposited.length
  const gate = gateAll()
  const [ref] = b.reconcile(viewWith([], [answerableOf('d1', opts)]), gate, 2)
  return { wire, b, ref, outerId, first, deposits, gate }
}
const errorTo = (wire, outerId, code = 'unsupportedType') => answer(wire, TRUST_TASK_ERROR_TYPE, refusal(code, false, { typeUri: SEALED_ENVELOPE_TYPE, id: outerId }), { threadId: outerId })

test('RLTP-VTI-5065: a refusal that arrives in a later opening binds the accepted document the holder offers and fails it', async () => {
  const { wire, b, ref, outerId } = await twoOpenings()
  assert.ok(ref, 'reconcile files the answerable document')
  assert.deepEqual(b.report(ref.submissionId), { digest: 'd1', status: 'accepted' })
  await wire.deliverRaw(errorTo(wire, outerId))
  assert.deepEqual(b.report(ref.submissionId), { digest: 'd1', status: 'failed', reason: 'rejected-by-receiver', code: 'unsupportedType' })
})

test('RLTP-VTI-5065: a next step in opening 1, the refusal in opening 2: held, then failed(rejected-by-receiver)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const { ref, outerId } = await accepted(a, wire, 'd1')
  await wire.deliverRaw(answer(wire, TRUST_TASK_NEXT_STEP_TYPE, NEXT, { threadId: outerId }))
  assert.deepEqual(a.report(ref.submissionId), { digest: 'd1', status: 'accepted', held: true })
  a.close()
  const { a: b } = await adapter(wire, a.ackState(), 1)
  const [r2] = b.reconcile(viewWith([], [answerableOf('d1', { held: true })]), gateAll(), 2)
  assert.deepEqual(b.report(r2.submissionId), { digest: 'd1', status: 'accepted', held: true }, 'held as the holder records it')
  await wire.deliverRaw(errorTo(wire, outerId, 'permissionDenied'))
  assert.deepEqual(b.report(r2.submissionId), { digest: 'd1', status: 'failed', reason: 'rejected-by-receiver', code: 'permissionDenied' })
})

test('RLTP-VTI-5065: a next step in a later opening makes the accepted document held', async () => {
  const { wire, b, ref, outerId } = await twoOpenings()
  await wire.deliverRaw(answer(wire, TRUST_TASK_NEXT_STEP_TYPE, NEXT, { threadId: outerId }))
  assert.deepEqual(b.report(ref.submissionId), { digest: 'd1', status: 'accepted', held: true })
})

test('RLTP-VTI-5065: a document filed for binding is never deposited, and its id equals the one it travelled under (byte-identical carried document)', async () => {
  const { wire, b, first, deposits } = await twoOpenings()
  b.advance(3); await b.settle()
  b.advance(DECLARED.giveUpHorizonMs * 2); await b.settle()
  assert.equal(wire.deposited.length, deposits, 'no deposit in opening 2')
  const again = await wrapSealed(sealOf('d1/document'), { issuer: b.connectionDid, recipient: PEER, since: 0 })
  assert.equal(b64u(again.bytes), b64u(first.payload), 'the carried document of opening 1, recomputed byte for byte')
})

test('RLTP-VTI-5065: the adapter\'s horizon does not end a document filed for binding; the holder\'s does', async () => {
  const { b, ref } = await twoOpenings()
  b.advance(DECLARED.giveUpHorizonMs * 3)
  assert.deepEqual(b.report(ref.submissionId), { digest: 'd1', status: 'accepted' })
})

test('RLTP-VTI-5065: an answer to a document the holder no longer offers (terminal) binds nothing: logged and acknowledged', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const { outerId } = await accepted(a, wire, 'd1')
  a.close()
  const { a: b } = await adapter(wire, a.ackState(), 1)
  b.reconcile(viewWith([], []), gateAll(), 2)
  const before = wire.logged.length
  const q = await wire.deliverRaw(errorTo(wire, outerId))
  assert.equal(wire.logged.length, before + 1)
  b.advance(3); await b.settle()
  assert.equal(wire.queue.has(q), false, 'acknowledged')
})

test('RLTP-VTI-5065: a later reconcile without the document withdraws nothing it filed for binding, and refiles nothing twice', async () => {
  const { wire, b, ref, outerId, gate } = await twoOpenings()
  assert.deepEqual(b.reconcile(viewWith([], [answerableOf('d1')]), gate, 3), [], 'filed once')
  b.reconcile(viewWith([], []), gate, 4)
  await wire.deliverRaw(errorTo(wire, outerId))
  assert.equal(b.report(ref.submissionId).code, 'unsupportedType')
})

test('RLTP-VTI-5065: an answerable document this opening already deposited is not filed again', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const { ref, outerId } = await accepted(a, wire, 'd1')
  assert.deepEqual(a.reconcile(viewWith([], [answerableOf('d1')]), gates.get(a), 1), [])
  await wire.deliverRaw(errorTo(wire, outerId))
  assert.equal(a.report(ref.submissionId).code, 'unsupportedType')
})

test('RLTP-VTI-5065: a view without answerable (an earlier host) reconciles as before', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  assert.equal(a.reconcile(viewOf(entryOf('d9')), gateAll(), 0).length, 1)
})

test('RLTP-VTI-5065: a document filed for binding opens no routed deposit; an answer bound to it answers the one the send state restored (RLTP-VTI-3130)', async () => {
  const { wire, b, outerId } = await twoOpenings()
  assert.deepEqual(b.ackState().send.open.map((o) => o.digest), ['d1'], 'restored from opening 1, not opened again')
  await wire.deliverRaw(answer(wire, TRUST_TASK_NEXT_STEP_TYPE, NEXT, { threadId: outerId }))
  assert.deepEqual(b.ackState().send.open, [], 'the bound next step answers it')
})

test('RLTP-VTI-5065 with a holder: next step in opening 1, refusal in opening 2 → the holder records failed(rejected-by-receiver); the codec is unchanged', async () => {
  const { createHolder } = await import('../dist/index.js')
  const { noteModule } = await import('./pair-fixture.mjs')
  const { holderA, storeA, A } = await pair()
  const out = (await holderA.act('note.send', {}, T0)).outbound[0]
  await holderA.resume(T0 + 1)
  // opening 1
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const [r1] = a.reconcile(await holderA.pendingTransport(T0 + 1), holderA, T0 + 1)
  await a.settle()
  await holderA.report(a.report(r1.submissionId), T0 + 2)
  const outerId = wire.deposited.at(-1).document.id
  await wire.deliverRaw(answer(wire, TRUST_TASK_NEXT_STEP_TYPE, NEXT, { threadId: outerId }))
  await holderA.report(a.report(r1.submissionId), T0 + 3)
  assert.equal((await holderA.deliveryStatus(out.digest)).items[0].held, true)
  a.close(); holderA.close()
  // opening 2, past the horizon: held stays
  const again = await createHolder({ store: storeA, keys: A.keys }, { modules: [noteModule()] })
  await again.resume(T0 + 4 * DECLARED.giveUpHorizonMs)
  const view = await again.pendingTransport(T0 + 4 * DECLARED.giveUpHorizonMs)
  assert.deepEqual(view.entries, [])
  assert.deepEqual(view.answerable.map((x) => [x.digest, x.held]), [[out.digest, true]])
  const { a: b } = await adapter(wire, a.ackState(), T0 + 4)
  const [r2] = b.reconcile(view, again, T0 + 5)
  const deposits = wire.deposited.length
  await wire.deliverRaw(answer(wire, TRUST_TASK_ERROR_TYPE, refusal('permissionDenied', false, { typeUri: SEALED_ENVELOPE_TYPE, id: outerId }), { threadId: outerId, issuedAt: '2026-10-27T17:27:50.395371028Z' }))
  await again.report(b.report(r2.submissionId), T0 + 6)
  const item = (await again.deliveryStatus(out.digest)).items[0]
  assert.deepEqual([item.status, item.reason, item.code], ['failed', 'rejected-by-receiver', 'permissionDenied'])
  assert.equal(wire.deposited.length, deposits, 'nothing deposited in opening 2')
  assert.equal((await storeA.read()).state.codec, 4)
})

test('RLTP-VTI-5065: an answer that arrives before the first reconcile of the opening is held, unacknowledged, and bound at that reconcile (review #136 S6)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const { outerId } = await accepted(a, wire, 'd1')
  a.close()
  const { a: b } = await adapter(wire, a.ackState(), 1)
  b.register(['rk'], 2)
  await b.settle()
  // the answer waited at the mediator and arrives before the holder's offer
  const q = await wire.deliverRaw(errorTo(wire, outerId))
  b.advance(3); await b.settle()
  assert.equal(wire.queue.has(q), true, 'not acknowledged before the first reconcile')
  assert.equal(b.collect(4).items.length, 0, 'and no item')
  const [ref] = b.reconcile(viewWith([], [answerableOf('d1')]), gateAll(), 5)
  await b.settle()
  assert.deepEqual(b.report(ref.submissionId), { digest: 'd1', status: 'failed', reason: 'rejected-by-receiver', code: 'unsupportedType' })
  b.conclude(b.collect(6), 6); await b.settle()
  assert.equal(wire.queue.has(q), false, 'acknowledged once concluded')
})

test('RLTP-VTI-5065: a held answer that binds nothing at the first reconcile is logged and acknowledged then; a retired instance leaves it with the mediator', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const { outerId } = await accepted(a, wire, 'd1')
  a.close()
  const { a: b } = await adapter(wire, a.ackState(), 1)
  const q = await wire.deliverRaw(errorTo(wire, outerId))
  const logged = wire.logged.length
  b.reconcile(viewWith([], []), gateAll(), 2)
  await b.settle()
  b.advance(3); await b.settle()
  assert.equal(wire.logged.length, logged + 1)
  assert.equal(wire.queue.has(q), false)
  // retired before its first reconcile: nothing is acknowledged, the mediator keeps the answer
  const { a: c } = await adapter(wire, b.ackState(), 4)
  const q2 = await wire.deliverRaw(answer(wire, TRUST_TASK_NEXT_STEP_TYPE, NEXT, { threadId: outerId }))
  c.close()
  assert.equal(wire.queue.has(q2), true)
})

// ── the answer contract (RLTP-VTI-5065, 5070, 5080): three invariants ──
/** the host's step for a collection: receive its items, record the reports
 *  its answers carry, then conclude it — answers are acknowledged only then */
async function hostStep (adapterI, holder, at) {
  const c = adapterI.collect(at)
  for (const it of c.items) await holder.receive(JSON.parse(new TextDecoder().decode(it.bytes)), at)
  for (const an of c.answers ?? []) await holder.report(an.report, at)
  adapterI.conclude(c, at)
  return c
}

test('I1 (RLTP-VTI-5065, Codex repro 1): a crash between the deposit and the stored accepted — the next opening offers the document in custody, an answer that arrives before the reconcile binds to it', async () => {
  const { createHolder } = await import('../dist/index.js')
  const { noteModule } = await import('./pair-fixture.mjs')
  const { holderA, storeA, A } = await pair()
  const out = (await holderA.act('note.send', {}, T0)).outbound[0]
  await holderA.resume(T0 + 1)
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const [r1] = a.reconcile(await holderA.pendingTransport(T0 + 1), holderA, T0 + 1)
  await a.settle()
  assert.equal(a.status(r1.submissionId).state, 'accepted')
  const outerId = wire.deposited.at(-1).document.id
  // the crash: the accepted report is never stored
  a.close(); holderA.close()
  const again = await createHolder({ store: storeA, keys: A.keys }, { modules: [noteModule()] })
  await again.resume(T0 + 2)
  const view = await again.pendingTransport(T0 + 2)
  assert.deepEqual(view.entries.map((e) => e.digest), [out.digest], 'still in custody')
  wire.isOffline = true
  const { a: b } = await adapter(wire, a.ackState(), T0 + 2)
  const q = await wire.deliverRaw(answer(wire, TRUST_TASK_ERROR_TYPE, refusal('unsupportedType', false, { typeUri: SEALED_ENVELOPE_TYPE, id: outerId }), { threadId: outerId }))
  b.reconcile(view, again, T0 + 3)
  await b.settle()
  await hostStep(b, again, T0 + 4)
  const item = (await again.deliveryStatus(out.digest)).items[0]
  assert.deepEqual([item.status, item.reason, item.code], ['failed', 'rejected-by-receiver', 'unsupportedType'])
  b.advance(T0 + 5); await b.settle()
  assert.equal(wire.queue.has(q), false, 'acknowledged after the holder stored it')
})

test('I2 (RLTP-VTI-5070, Codex repro 2): an answer without issuer, with a known id, from another authenticated sender changes nothing; logged and acknowledged', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const { ref, outerId } = await accepted(a, wire)
  const OTHER = (await carrierScopedIdentity(new Uint8Array(32).fill(7), MEDIATOR_DID, new Uint8Array(32).fill(8), 'connection')).did
  const n = String(++answerSeq).padStart(12, '0')
  const doc = { id: `0d6c0000-0000-4000-8000-${n}`, type: TRUST_TASK_ERROR_TYPE, threadId: outerId, payload: refusal('unsupportedType', false, { typeUri: SEALED_ENVELOPE_TYPE, id: outerId }) }
  const before = wire.logged.length
  const q = await wire.deliverRaw(te.encode(jcs({ type: TSP_BINDING_ENVELOPE_TYPE, document: doc })), OTHER)
  await a.settle()
  assert.deepEqual(a.status(ref.submissionId), { state: 'accepted' })
  assert.equal(a.collect(1).answers?.length ?? 0, 0)
  assert.equal(wire.logged.length, before + 1)
  a.advance(2); await a.settle()
  assert.equal(wire.queue.has(q), false)
})

// I3 (RLTP-VTI-5080): the crash matrix — receive | bind | store | acknowledge
/** a holder with one note accepted over a wire; its opening and adapter */
async function acceptedWithHolder () {
  const { createHolder } = await import('../dist/index.js')
  const { noteModule } = await import('./pair-fixture.mjs')
  const { holderA, storeA, A } = await pair()
  const out = (await holderA.act('note.send', {}, T0)).outbound[0]
  await holderA.resume(T0 + 1)
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const [r] = a.reconcile(await holderA.pendingTransport(T0 + 1), holderA, T0 + 1)
  await a.settle()
  await holderA.report(a.report(r.submissionId), T0 + 1)
  const outerId = wire.deposited.at(-1).document.id
  const reopen = async (prev, at) => {
    prev.a.close(); prev.h.close()
    const h = await createHolder({ store: storeA, keys: A.keys }, { modules: [noteModule()] })
    await h.resume(at)
    const { a: next } = await adapter(wire, prev.a.ackState(), at)
    return { a: next, h }
  }
  return { wire, out, outerId, storeA, first: { a, h: holderA }, reopen }
}
const refusalTo = (wire, outerId) => answer(wire, TRUST_TASK_ERROR_TYPE, refusal('unsupportedType', false, { typeUri: SEALED_ENVELOPE_TYPE, id: outerId }), { threadId: outerId })
const nextTo = (wire, outerId) => answer(wire, TRUST_TASK_NEXT_STEP_TYPE, NEXT, { threadId: outerId })
const statusOf = async (h, digest) => { const i = (await h.deliveryStatus(digest)).items[0]; return [i.status, i.held ?? null, i.code ?? null] }
const failedSteps = async (storeA, digest) => (await storeA.read()).state.outbox[digest].history.filter((s) => s.status === 'failed').length

for (const [name, crashAfter] of [['receive → bind', 'receive'], ['bind → store', 'bind'], ['store → acknowledge', 'store']]) {
  test(`I3 (RLTP-VTI-5080): a crash between ${name} — after the restart the refusal is recorded once and acknowledged`, async () => {
    const t = await acceptedWithHolder()
    const { wire, out, outerId } = t
    let o = t.first
    const q = await wire.deliverRaw(refusalTo(wire, outerId))
    await o.a.settle()
    if (crashAfter !== 'receive') {
      o.a.reconcile(await o.h.pendingTransport(T0 + 2), o.h, T0 + 2)
      await o.a.settle()
      const c = o.a.collect(T0 + 3)
      assert.equal(c.answers.length, 1, 'bound into the collection')
      if (crashAfter === 'store') for (const an of c.answers) await o.h.report(an.report, T0 + 3)
      // no conclude: the crash
    }
    assert.equal(wire.queue.has(q), true, 'not acknowledged before the holder stored the outcome')
    o = await t.reopen(o, T0 + 10)
    o.a.reconcile(await o.h.pendingTransport(T0 + 10), o.h, T0 + 10)
    await wire.redeliverAll()
    await o.a.settle()
    await hostStep(o.a, o.h, T0 + 11)
    assert.deepEqual(await statusOf(o.h, out.digest), ['failed', null, 'unsupportedType'])
    assert.equal(await failedSteps(t.storeA, out.digest), 1, 'no second effect')
    o.a.advance(T0 + 12); await o.a.settle()
    assert.equal(wire.queue.has(q), false, 'acknowledged once stored')
  })
}

test('I3 (RLTP-VTI-5080): after the acknowledgement nothing comes again, and a next step stored once stays one held step', async () => {
  const t = await acceptedWithHolder()
  const { wire, out, outerId } = t
  const o = t.first
  const q = await wire.deliverRaw(nextTo(wire, outerId))
  o.a.reconcile(await o.h.pendingTransport(T0 + 2), o.h, T0 + 2)
  await o.a.settle()
  await hostStep(o.a, o.h, T0 + 3)
  o.a.advance(T0 + 4); await o.a.settle()
  assert.equal(wire.queue.has(q), false)
  // the mediator redelivers anyway (a lost acknowledgement): absorbed, no second held step
  await wire.deliverRaw(nextTo(wire, outerId))
  await o.a.settle()
  await hostStep(o.a, o.h, T0 + 5)
  assert.deepEqual(await statusOf(o.h, out.digest), ['accepted', true, null])
  const held = (await t.storeA.read()).state.outbox[out.digest].history.filter((s) => s.held === true).length
  assert.equal(held, 1)
})

// ── second review of the answer contract (REV-A, REV-D) ───────────────
test('REV-A (RLTP-VTI-5065): while the counterpart is unknown no answer is decided — held unacknowledged, bound once it is known', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const { outerId } = await accepted(a, wire, 'd1')
  a.close()
  wire.peer = null
  const { a: b } = await adapter(wire, a.ackState(), 1)
  const [ref] = b.reconcile(viewWith([], [answerableOf('d1')]), gateAll(), 2)
  await b.settle()
  // the frame comes from the counterpart, as the binding authenticated it
  const q = await wire.deliverRaw(errorTo(wire, outerId), PEER)
  await b.settle()
  b.advance(3); await b.settle()
  assert.equal(wire.queue.has(q), true, 'not acknowledged while the counterpart is unknown')
  assert.deepEqual(b.status(ref.submissionId), { state: 'accepted' })
  wire.peer = PEER
  b.advance(4); await b.settle()
  assert.equal(b.status(ref.submissionId).code, 'unsupportedType', 'bound once the counterpart is known')
  b.conclude(b.collect(5), 5); await b.settle()
  assert.equal(wire.queue.has(q), false)
})

test('REV-D (RLTP-VTI-5080, 3130): a crash after the acknowledgement and before the next snapshot of ackState — the successor learns the outcome from the holder through answered(digest)', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  const { outerId } = await accepted(a, wire, 'd1')
  const stale = a.ackState()
  assert.deepEqual(stale.send.open.map((o) => o.digest), ['d1'])
  await wire.deliverRaw(errorTo(wire, outerId))
  a.conclude(a.collect(1), 1); await a.settle()
  // the crash: the snapshot after the conclusion is never stored
  a.close()
  const { a: b } = await adapter(wire, stale, 2)
  assert.deepEqual(b.ackState().send.open.map((o) => o.digest), ['d1'], 'the stale snapshot still names it open')
  // the host hands the holder's recorded outcome to the successor
  b.answered('d1', 3)
  assert.deepEqual(b.ackState().send.open, [], 'answered: no switch at the deadline on its account')
})

test('M3 (RLTP-VTI-5065): held and bound answers count toward queue-floor by number and by bytes; beyond it an answer is not taken', async () => {
  const wire = new WireDouble()
  const { a } = await adapter(wire)
  a.close()
  const { a: b } = await adapter(wire, a.ackState(), 1)
  // no reconcile: every answer is held
  const big = (i) => answer(wire, TRUST_TASK_NEXT_STEP_TYPE, { ...NEXT, message: 'x'.repeat(1000) + i }, { threadId: 'x' + i })
  let taken = 0
  for (let i = 0; i < 80; i++) { const bytes = big(i); if (await wire.consumer(bytes, PEER)) taken++ }
  assert.equal(taken, DECLARED.queueFloorCount, 'by number')
  const wire2 = new WireDouble()
  const { a: c } = await adapter(wire2)
  const huge = (i) => answer(wire2, TRUST_TASK_NEXT_STEP_TYPE, { ...NEXT, ext: { pad: 'y'.repeat(85_000) } }, { threadId: 'y' + i })
  let taken2 = 0
  for (let i = 0; i < 20; i++) if (await wire2.consumer(huge(i), PEER)) taken2++
  assert.ok(taken2 < 20 && taken2 * 85_000 <= DECLARED.queueFloorBytes + 90_000, `by bytes: ${taken2}`)
  void c
})
