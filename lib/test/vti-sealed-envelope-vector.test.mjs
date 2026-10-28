#!/usr/bin/env node
// vectors/vti-sealed-envelope.json replayed through the library: the
// carried document byte for byte (wrapSealed), the payloads a receiver
// does not deliver and the answers it reads (readBindingEnvelope), and the
// submission state each bound answer leaves from accepted, held and
// delivered, driven through the adapter (MediatorCarrierAdapter) over a
// minimal wire (VTI profile 0.29 §3b, §5, §7; Delivery 0.85 §4.6).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MediatorCarrierAdapter, wrapSealed, readBindingEnvelope } from '@real-life/trust-protocol/adapters/vti-mediator'
import { jcs } from '../dist/core.js'

const read = (f) => JSON.parse(readFileSync(new URL('../../vectors/' + f, import.meta.url), 'utf8'))
const V = read('vti-sealed-envelope.json')
const ID = read('identity-derivation.json')
const te = new TextEncoder()
const hexToBytes = (h) => Uint8Array.from(h.match(/../g).map((b) => parseInt(b, 16)))

test('the carried document: wrapSealed reproduces every carried case byte for byte, a repeat included (RLTP-VTI-3150, RLTP-DEL-4610, 4620, 5040)', async () => {
  for (const c of V.carried) {
    const w = await wrapSealed(c.seal, { issuer: c.issuer, recipient: c.recipient, since: c.since })
    assert.equal(new TextDecoder().decode(w.bytes), c.payload, c.case)
    assert.equal(w.outerId, c.id, c.case)
    assert.deepEqual(w.envelope.document, c.document, c.case)
  }
  const again = await wrapSealed(V.carried[V.repeat.of].seal, V.carried[V.repeat.of])
  assert.equal(new TextDecoder().decode(again.bytes), V.carried[V.repeat.of].payload)
})

test('what a receiver reads: the carried document delivers its seal; every refused payload is ignored (RLTP-VTI-7160)', async () => {
  const d = await readBindingEnvelope(te.encode(V.delivered.payload), { sender: V.delivered.sender, self: V.delivered.self })
  assert.equal(d.kind, 'sealed')
  assert.equal(jcs(d.seal), V.delivered.item)
  for (const c of V.refused) {
    const r = await readBindingEnvelope(te.encode(c.payload), { sender: c.sender, self: c.self })
    assert.deepEqual(r, { kind: 'ignored', why: c.why }, c.case)
  }
})

test('the answers of a framework consumer read as the vector states (RLTP-VTI-5040 to 5060)', async () => {
  for (const c of V.answers) {
    const r = await readBindingEnvelope(te.encode(c.payload), { sender: V.sides.B, self: V.sides.A })
    assert.deepEqual(r.kind === 'ignored' ? { kind: 'ignored' } : r, c.reading, c.case)
  }
})

// side A's adapter (vti-routed-addressing side A = adapterScopedIdentities of identity-derivation)
class Wire {
  constructor () { this.consumer = null; this.acked = [] }
  counterpart () { return V.sides.B }
  async authChallenge () { return { challenge: 'c', sessionId: 's' } }
  async authenticate () { return { accessToken: 'a', accessExpiresAt: Number.MAX_SAFE_INTEGER, refreshToken: 'r', refreshExpiresAt: Number.MAX_SAFE_INTEGER } }
  async refresh () { return this.authenticate() }
  async keylistUpdate () {}
  async deposit () {}
  async ackReceived (_t, ids) { this.acked.push(...ids) }
  onDeliver (cb) { this.consumer = cb }
  queueEmpty () { return true }
}

const sideA = async () => {
  const wire = new Wire()
  const a = await MediatorCarrierAdapter.create(hexToBytes(ID.rootIkm), V.carrier, hexToBytes(ID.carrierRelationship.relationshipNonce), wire)
  assert.equal(a.connectionDid, V.sides.A)
  const c = V.carried[0]
  const id = a.submit(te.encode(jcs(c.seal)), c.since)
  await a.settle()
  return { a, wire, id }
}
const deliver = (wire, payload) => wire.consumer(te.encode(payload), V.sides.B)
const shape = (st) => st === null ? null : st.state === 'failed' && st.reason === 'rejected-by-receiver' ? st : st.state === 'failed' ? { state: 'failed', reason: st.reason } : st.state === 'delivered' ? { state: 'delivered' } : st
const PROCEED = V.answers.find((c) => c.reading.kind === 'next-step').payload

test('the state a bound answer leaves from accepted, held and delivered (RLTP-VTI-5010 to 5050, RLTP-DEL-6140)', async () => {
  for (const c of V.answers) {
    for (const before of ['accepted', 'held', 'delivered']) {
      const { a, wire, id } = await sideA()
      if (before === 'held') await deliver(wire, PROCEED)
      if (before === 'delivered') a.acknowledged(id)
      await deliver(wire, c.payload)
      assert.deepEqual(shape(a.status(id)), c.effect[before], `${c.case}, from ${before}`)
      // an answer is never an item for the holder, and it is acknowledged at the next step
      a.advance(V.carried[0].since + 1)
      const col = a.collect(V.carried[0].since + 2)
      assert.equal(col.items.length, 0, c.case)
      // a bound answer travels with its report and is acknowledged at the conclusion (RLTP-VTI-5080)
      for (const an of col.answers) assert.deepEqual(an.report, a.report(an.submissionId), c.case)
      // a bound indeterminate changes nothing and travels as a diagnosis (RLTP-VTI-5020); this
      // side's submit files no digest, so its answers carry no report here (the adapter test does)
      for (const an of col.answers) assert.deepEqual(an.diagnosis, c.diagnosis, `${c.case}: diagnosis`)
      a.conclude(col, V.carried[0].since + 2)
      await a.settle()
      assert.ok(wire.acked.length > 0, `${c.case}: acknowledged`)
    }
  }
})

test('an answer in a later opening binds the accepted document the holder offers (RLTP-VTI-5065, RLTP-DEL-6150)', async () => {
  const L = V.laterOpening
  const wire = new Wire()
  const a = await MediatorCarrierAdapter.create(hexToBytes(ID.rootIkm), V.carrier, hexToBytes(ID.carrierRelationship.relationshipNonce), wire)
  const [ref] = a.reconcile({ ok: true, entries: [], answerable: [L.answerable] }, { handOver: async () => false }, L.answerable.since)
  assert.deepEqual(a.status(ref.submissionId), L.before)
  await deliver(wire, L.answer)
  await a.settle()
  assert.deepEqual(shape(a.status(ref.submissionId)), L.after)
})
