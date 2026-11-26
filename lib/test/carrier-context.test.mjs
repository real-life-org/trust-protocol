// The carrier context (KeyProvider.carrierContext): a host builds the transport adapter, its
// delivery hint, the holder's carrier proofs and the wire of one relationship at one carrier
// from it, and never holds the root (profile spec/adapter-vti-mediator.md §1, DEVIATION D7).
// Everything here goes through the package's entry points, as a host imports them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { seedKeys, holderContextOf, holderContext, registrationProof, sessionProof, edFromSeed, anchorOfEd } from '@real-life/trust-protocol'
import { MediatorCarrierAdapter, deliveryHintOf, deliveryHint } from '@real-life/trust-protocol/adapters/vti-mediator'
import { connectionSeed } from '@real-life/trust-protocol/adapters/vti-mediator/software-keys'
import { carrierPrincipal, carrierScopedIdentity } from '@real-life/trust-protocol/internal'

const ID = JSON.parse(readFileSync(new URL('../../vectors/identity-derivation.json', import.meta.url), 'utf8'))
const HINTS = JSON.parse(readFileSync(new URL('../../vectors/vti-delivery-hints.json', import.meta.url), 'utf8'))
const ROUTED = JSON.parse(readFileSync(new URL('../../vectors/vti-routed-addressing.json', import.meta.url), 'utf8'))
const hex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)))
const sha = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
const IKM = hex(ID.rootIkm)
const N = hex(ID.carrierRelationship.relationshipNonce)
const C = HINTS.carrier

/** A wire that names its connection DID and records who authenticates. */
function wireDouble (connectionDid, peer) {
  return {
    connectionDid,
    authDids: [],
    consumer: null,
    async authChallenge (did) { this.authDids.push(did); return { challenge: 'ch', sessionId: 's' } },
    async authenticate ({ did }) { this.authDids.push(did); return { accessToken: 'a', accessExpiresAt: 1e15, refreshToken: 'r', refreshExpiresAt: 1e15 } },
    async refresh () { throw new Error('not here') },
    async keylistUpdate () {},
    async deposit () {},
    async ackReceived () {},
    onDeliver (cb) { this.consumer = cb },
    counterpart () { return peer },
  }
}

test('carrierContext reproduces both DIDs of the vectors: the principal (carrierRelationship) and the connection DID (the hints, the routed sides)', async () => {
  const keys = seedKeys(IKM)
  for (const c of ID.carrierRelationship.cases) {
    if (typeof c.principal !== 'string' || typeof c.carrier !== 'string') continue
    assert.equal((await keys.carrierContext(N, c.carrier)).principal.principal, c.principal, c.case)
  }
  const A = await keys.carrierContext(N, C)
  assert.equal(deliveryHintOf(A.connection), HINTS.hints.A)
  assert.equal(A.connection.did, ROUTED.sides.A.connection)
  const B = await seedKeys(await sha('rltp/vector/vti-routed/root-B')).carrierContext(await sha('rltp/vector/vti-routed/nonce-B'), C)
  assert.equal(deliveryHintOf(B.connection), HINTS.hints.B)
  assert.equal(B.connection.did, ROUTED.sides.B.connection)
  // byte-equal to the root-derived forms they replace
  assert.equal(A.principal.principal, (await carrierPrincipal(IKM, C, N)).principal)
  assert.equal(A.connection.did, (await carrierScopedIdentity(IKM, C, N, 'connection')).did)
  assert.equal(deliveryHintOf(A.connection), await deliveryHint(IKM, C, N))
  assert.equal(A.carrier, C)
  assert.equal(A.connection.carrier, C)
  assert.notEqual(A.principal.principal, A.connection.did)
  assert.equal('nonce' in A, false, 'N is not in the context (RLTP-VTI-1215)')
})

test('carrierContext: another N at the same C, or the same N at another C, gives another principal and another connection DID', async () => {
  const keys = seedKeys(IKM)
  const base = await keys.carrierContext(N, C)
  const otherN = await keys.carrierContext(await sha('another nonce'), C)
  const otherC = await keys.carrierContext(N, 'did:web:other-carrier.example')
  for (const [name, x] of [['other N', otherN], ['other C', otherC]]) {
    assert.notEqual(x.principal.principal, base.principal.principal, name)
    assert.notEqual(x.connection.did, base.connection.did, name)
  }
  await assert.rejects(keys.carrierContext(new Uint8Array(31), C), /32 bytes/)
  await assert.rejects(keys.carrierContext(N, 'bad id'), /carrier identifier/)
})

test('carrierContext: N is read once at entry; a buffer changed after the call changes nothing', async () => {
  const keys = seedKeys(IKM)
  const n = new Uint8Array(N)
  const pending = keys.carrierContext(n, C)
  n.fill(7)
  const ctx = await pending
  assert.equal(ctx.principal.principal, (await carrierPrincipal(IKM, C, N)).principal)
  assert.equal(ctx.connection.did, (await carrierScopedIdentity(IKM, C, N, 'connection')).did)
})

test('carrierContext and carrierPrincipal: every part is frozen, every call its own object; changing an earlier result is impossible and changes no later one', async () => {
  const keys = seedKeys(IKM)
  const p1 = await keys.carrierPrincipal(N, C)
  assert.ok(Object.isFrozen(p1))
  assert.throws(() => { p1.principal = 'did:key:mixed' }, TypeError)
  const p2 = await keys.carrierPrincipal(N, C)
  assert.notEqual(p1, p2, 'not the cached object')
  const ctx = await keys.carrierContext(N, C)
  for (const o of [ctx, ctx.principal, ctx.connection]) assert.ok(Object.isFrozen(o))
  assert.throws(() => { ctx.connection.did = p1.principal }, TypeError)
  assert.throws(() => { ctx.principal.principal = 'did:key:mixed' }, TypeError)
  const again = await keys.carrierContext(N, C)
  assert.notEqual(again.connection, ctx.connection)
  assert.equal(again.principal.principal, p1.principal)
})

test('holderContextOf signs through the context: the four proofs are byte-identical to those of the root-derived holder context, and the context holds no private key', async () => {
  const ctx = await seedKeys(IKM).carrierContext(N, C)
  const rkid = 'z6LSrkid'
  const viaKeys = holderContextOf(ctx, rkid, 3)
  const viaRoot = await holderContext(IKM, C, N, rkid, 3)
  assert.ok(Object.isFrozen(viaKeys) && Object.isFrozen(viaKeys.identity))
  assert.deepEqual(Object.keys(viaKeys.identity).sort(), ['principal', 'sign'])
  for (const purpose of ['register', 'rebind']) {
    assert.deepEqual(await registrationProof(viaKeys, purpose, 'pc', 'ac'), await registrationProof(viaRoot, purpose, 'pc', 'ac'), purpose)
  }
  for (const purpose of ['collect', 'conclude']) {
    assert.deepEqual(await sessionProof(viaKeys, purpose, 'pc'), await sessionProof(viaRoot, purpose, 'pc'), purpose)
  }
})

test('a host without the root: adapter, hint and wire from one context of a provider that releases no key (seedKeys default)', async () => {
  const ctx = await seedKeys(IKM).carrierContext(N, C)
  assert.throws(() => connectionSeed(ctx.connection), /did not release/)
  const PEER = ROUTED.sides.B.connection
  const wire = wireDouble(ctx.connection.did, PEER)
  const a = await MediatorCarrierAdapter.open(ctx, wire)
  assert.equal(a.principal, ctx.principal.principal)
  assert.equal(a.connectionDid, ctx.connection.did)
  a.register([], 0)
  await a.settle()
  assert.ok(wire.authDids.length > 0)
  assert.deepEqual([...new Set(wire.authDids)], [ctx.connection.did], 'the session runs under the context\'s connection DID')
  assert.equal(JSON.parse(deliveryHintOf(ctx.connection)).id, a.connectionDid + '#tsp', 'the hint names the adapter\'s connection DID')
  a.close()
})

test('MediatorCarrierAdapter.open refuses a wire that names no connection DID or another one, and a context that is not one', async () => {
  const keys = seedKeys(IKM)
  const ctx = await keys.carrierContext(N, C)
  const other = await keys.carrierContext(await sha('another nonce'), C)
  const PEER = ROUTED.sides.B.connection
  await assert.rejects(MediatorCarrierAdapter.open(ctx, wireDouble(undefined, PEER)), /RLTP-VTI-1120/)
  await assert.rejects(MediatorCarrierAdapter.open(ctx, wireDouble(other.connection.did, PEER)), /RLTP-VTI-1120/)
  await assert.rejects(MediatorCarrierAdapter.open(null, wireDouble(ctx.connection.did, PEER)), /not a carrier context/)
  await assert.rejects(MediatorCarrierAdapter.open({ ...ctx, carrier: 'did:web:other-carrier.example' }, wireDouble(ctx.connection.did, PEER)), /two carriers/)
  await assert.rejects(MediatorCarrierAdapter.open({ ...ctx, principal: { principal: 'did:key:z6Mk', sign: ctx.principal.sign } }, wireDouble(ctx.connection.did, PEER)), /principal/)
  await assert.rejects(MediatorCarrierAdapter.open({ ...ctx, connection: { did: ctx.principal.principal, carrier: C } }, wireDouble(ctx.principal.principal, PEER)), /distinct/)
  assert.throws(() => deliveryHintOf({ did: 'did:key:z6Mk', carrier: C }), /canonical/)
  assert.throws(() => deliveryHintOf({ did: ctx.connection.did, carrier: '' }), /carrier/)
  // the deprecated factory still refuses a wire of another connection, when the wire names one
  await assert.rejects(MediatorCarrierAdapter.create(IKM, C, N, wireDouble(other.connection.did, PEER)), /RLTP-VTI-1120/)
})

test('connectionSeed releases the key of one connection only, and only under exportConnectionSeed: the seed of the context\'s connection DID, a fresh copy each time', async () => {
  const ctx = await seedKeys(IKM, { exportConnectionSeed: true }).carrierContext(N, C)
  const s1 = connectionSeed(ctx.connection)
  assert.equal(s1.length, 32)
  assert.equal(anchorOfEd((await edFromSeed(s1)).pubRaw), ctx.connection.did)
  s1.fill(0)
  assert.equal(anchorOfEd((await edFromSeed(connectionSeed(ctx.connection))).pubRaw), ctx.connection.did, 'a copy: changing it changes nothing')
  assert.throws(() => connectionSeed({ ...ctx.connection }), /did not release/, 'a copy of the object is not the capability')
  assert.throws(() => connectionSeed(ctx), /did not release/, 'the context itself releases nothing')
  assert.throws(() => connectionSeed(ctx.principal), /did not release/)
  assert.throws(() => connectionSeed(null), /did not release/)
})
