// vectors4 — the deniable delivery-ack vector (Delivery 4.2/4.4
// acknowledgement class rule): recompute key, preimage and MAC from the
// stated inputs and hold them against vectors/delivery-ack.json,
// including every negative. Review 12, finding 7: the class rule is
// only as real as its executable vector.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pairContext } from '../dist/identity.js'
import { ecdh, hkdf, b64uOf, diVerify } from '../dist/crypto.js'
import { jcs, makeValidator } from '../dist/core.js'
import { SCHEMAS } from '../dist/schemas.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const v = JSON.parse(readFileSync(join(ROOT, 'vectors/delivery-ack.json'), 'utf8'))
const fill = (n, x) => new Uint8Array(n).fill(x)
const S = globalThis.crypto.subtle
const te = new TextEncoder()
const hmac = async (key, msg) => {
  const k = await S.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return 'u' + b64uOf(new Uint8Array(await S.sign('HMAC', k, te.encode(msg))))
}

test('delivery-ack vector — key, preimage and MAC reproduce byte-exactly', async () => {
  const A = await pairContext(fill(64, 7), fill(32, 3))
  const B = await pairContext(fill(64, 9), fill(32, 5))
  assert.equal(A.anchor, v.inputs.issuerPairAnchor)
  assert.equal(B.anchor, v.inputs.recipientPairAnchor)
  const info = `rltp/v1/delivery/mac/ack/${A.anchor}/${B.anchor}`
  assert.equal(info, v.inputs.info)
  const k = await hkdf(await ecdh(A.x.priv, B.x.pubRaw), info, 32)
  const preimage = jcs(v.inputs.document)
  assert.equal(preimage, v.intermediate.preimage)
  assert.equal(await hmac(k, preimage), v.output.proof.mac)
  // the recipient (payload sender) derives the SAME key from its side
  const k2 = await hkdf(await ecdh(B.x.priv, A.x.pubRaw), info, 32)
  assert.equal(await hmac(k2, preimage), v.output.proof.mac)
})

test('delivery-ack vector — every negative fails as declared', async () => {
  const A = await pairContext(fill(64, 7), fill(32, 3))
  const B = await pairContext(fill(64, 9), fill(32, 5))
  const k = await hkdf(await ecdh(A.x.priv, B.x.pubRaw), v.inputs.info, 32)
  const byName = Object.fromEntries(v.negatives.map((n) => [n.name, n]))
  // tampered preimage: the held document's MAC must not match the stored wrongMac's source
  const tampered = byName['tampered-preimage']
  assert.notEqual(await hmac(k, jcs(tampered.document)), v.output.proof.mac)
  assert.equal(await hmac(k, jcs(tampered.document)), tampered.wrongMac)
  // wrong direction: re-derive the reversed-info key and reproduce byte-exactly
  const kRev = await hkdf(await ecdh(A.x.priv, B.x.pubRaw), `rltp/v1/delivery/mac/ack/${B.anchor}/${A.anchor}`, 32)
  assert.equal(await hmac(kRev, v.intermediate.preimage), byName['wrong-direction'].wrongMac)
  assert.notEqual(byName['wrong-direction'].wrongMac, v.output.proof.mac)
  // wrong key: re-derive the foreign tuple's key from the vector's stated inputs
  const C = await pairContext(fill(64, 7), fill(32, 6))
  assert.equal(C.anchor, v.wrongKeyInputs.foreignPairAnchor)
  const kFor = await hkdf(await ecdh(C.x.priv, B.x.pubRaw), v.wrongKeyInputs.info, 32)
  assert.equal(await hmac(kFor, v.intermediate.preimage), byName['wrong-key'].wrongMac)
  assert.notEqual(byName['wrong-key'].wrongMac, v.output.proof.mac)
  // missing proof: the document schema's if/then rejects a proof-less ack
  const V = makeValidator(SCHEMAS)
  const schema = SCHEMAS['rltp-delivery-document.schema.json']
  const bare = { ...v.inputs.document }
  assert.ok(V.validate(bare, schema, schema).length > 0, 'a delivery-ack without proof must fail the document schema')
  const withProof = { ...v.inputs.document, proof: v.output.proof }
  assert.equal(V.validate(withProof, schema, schema).length, 0, 'the MAC-form ack must pass the document schema')
  // class crossings, EXECUTED: implement the 4.2 class predicate as
  // written and show each crossing is schema-valid, proof-valid, and
  // rejected by the class rule alone
  const DV_TYPES = new Set(['star/0.2', 'group-star/0.1', 'anchor-mapping/0.3', 'profile/0.1', 'continuity-probe/0.1', 'continuity-mapping/0.1', 'introduction-ack/0.1', 'introduction-voucher/0.1'].map((s) => `https://real-life.org/trust-tasks/${s}`))
  const proofForm = (d) => d.proof?.mac && d.proof?.proofValue ? 'hybrid' : d.proof?.mac ? 'mac' : d.proof?.proofValue ? 'signature' : 'none'
  const classOk = (d, acknowledgedType) => proofForm(d) === (DV_TYPES.has(acknowledgedType) ? 'mac' : 'signature')
  const c1 = byName['signature-form-for-dv-payload']
  assert.equal(V.validate(c1.document, schema, schema).length, 0, 'DI-form ack is schema-valid')
  assert.equal(await diVerify(c1.document, v.inputs.issuerPairAnchor), true, 'the crossing carries a GENUINE signature — only the class rejects it')
  assert.equal(classOk(c1.document, c1.acknowledgedType), false)
  assert.equal(c1.expected, 'failed(validation-failed)')
  const c2 = byName['mac-form-for-signature-payload']
  const c2doc = { ...c2.document, proof: c2.proof }
  assert.equal(V.validate(c2doc, schema, schema).length, 0, 'MAC-form ack is schema-valid')
  assert.equal(await hmac(k, jcs(c2.document)), c2.proof.mac, 'the crossing carries the GENUINE MAC — only the class rejects it')
  assert.equal(classOk(c2doc, c2.acknowledgedType), false)
  assert.equal(c2.expected, 'failed(validation-failed)')
  // and the matching (non-crossing) combinations pass the predicate —
  // the group star and the anchor mapping asserted directly (round 17
  // minor: regression-real)
  assert.equal(classOk(c2doc, 'https://real-life.org/trust-tasks/star/0.2'), true)
  assert.equal(classOk(c2doc, 'https://real-life.org/trust-tasks/group-star/0.1'), true)
  assert.equal(classOk(c1.document, 'https://real-life.org/trust-tasks/group-star/0.1'), false)
  assert.equal(classOk(c2doc, 'https://real-life.org/trust-tasks/anchor-mapping/0.3'), true)
  assert.equal(classOk(c1.document, 'https://real-life.org/trust-tasks/encounter-credential-delivery/0.1'), true)
  // hybrid proof: schema-invalid (both branches closed) and never a valid form
  const hybrid = byName['hybrid-proof']
  const hdoc = { ...hybrid.document, proof: hybrid.proof }
  assert.ok(V.validate(hdoc, schema, schema).length > 0, 'a hybrid DI+mac proof must fail the document schema')
  assert.equal(proofForm(hdoc), 'hybrid')
  // outer proof on a proof-less own type is now schema-forbidden
  const bundle = { ...v.inputs.document, type: 'https://real-life.org/trust-tasks/encounter-bundle/0.1', proof: v.output.proof }
  assert.ok(V.validate(bundle, schema, schema).length > 0, 'an outer proof on encounter-bundle must fail the document schema')
})

test('delivery-ack vector — the ack.ts builders and the holder\'s KeyProvider path reproduce it byte-identically', async () => {
  const { ACK_TYPE, ackInfo, ackKeyOf, ackDocument, macAck, macAckForm, macAckValid } = await import('../dist/ack.js')
  const { seedKeys, digestBytes, xRawOfMk } = await import('../dist/index.js')
  const labelOf = async (n) => 'pair/' + await digestBytes(fill(32, n))
  const kA = seedKeys(fill(64, 7))
  const kB = seedKeys(fill(64, 9))
  const lA = await labelOf(3)
  const lB = await labelOf(5)
  const A = await kA.anchorOf(lA)
  const B = await kB.anchorOf(lB)
  assert.equal(A.anchor, v.inputs.issuerPairAnchor)
  assert.equal(B.anchor, v.inputs.recipientPairAnchor)
  assert.equal(ackInfo(A.anchor, B.anchor), v.inputs.info)
  const doc = v.inputs.document
  const built = ackDocument({ id: doc.id, issuer: doc.issuer, recipient: doc.recipient, threadId: doc.threadId, issuedAt: doc.issuedAt, ref: doc.payload.ref })
  assert.equal(built.type, ACK_TYPE)
  assert.equal(jcs(built), v.intermediate.preimage)
  // the issuer's key agreement through the KeyProvider, under its release
  const shared = await kA.agree(A.keyAgreement, xRawOfMk(B.keyAgreement), () => ({ status: 'live', label: lA }))
  assert.equal(shared.status, 'available')
  const k = await ackKeyOf(shared.shared, A.anchor, B.anchor)
  const signed = await macAck(built, k)
  assert.equal(jcs(signed), jcs({ ...doc, proof: v.output.proof }), 'byte-identical to the vector')
  assert.equal(await macAckValid(signed, k), true)
  assert.deepEqual(macAckForm(signed), { ok: true, ref: doc.payload.ref, threadId: doc.threadId })
  // the recipient verifies from its side
  const sharedB = await kB.agree(B.keyAgreement, xRawOfMk(A.keyAgreement), () => ({ status: 'live', label: lB }))
  assert.equal(await macAckValid(signed, await ackKeyOf(sharedB.shared, A.anchor, B.anchor)), true)
  // negatives through the same builders
  const byName = Object.fromEntries(v.negatives.map((n) => [n.name, n]))
  assert.equal(await macAckValid({ ...byName['tampered-preimage'].document, proof: v.output.proof }, k), false)
  assert.equal(await macAckValid({ ...doc, proof: { mac: byName['wrong-direction'].wrongMac } }, k), false)
  assert.equal(await macAckValid(signed, await ackKeyOf(shared.shared, B.anchor, A.anchor)), false, 'the reversed direction does not verify')
  await assert.rejects(ackKeyOf(new Uint8Array(32), A.anchor, B.anchor), /all-zero/)
})
