#!/usr/bin/env node
// Generates vectors/vti-sealed-envelope.json — the carried document of the
// VTI mediator adapter profile 0.29 (§3b, §5, §7; Delivery 0.85 §4.6,
// RLTP-DEL-4610 to 4630, 5030, 5040):
//
//   · carried: the sealed envelope of vectors/seal.json carried from side A
//     to side B and from B to A of vectors/vti-routed-addressing.json — the
//     id preimage, the UUID v8, the carried document and the binding
//     envelope byte for byte (the TSP payload, the same in mode routed and
//     mode direct), its SHA-256 and length; a repeat of the same hand-over
//     byte-identical; the same seal later (another since) under the same id;
//     another sending identity (A in another relationship) under another id;
//   · bounds: the largest carried document (a seal at the plaintext bound)
//     against the size bound 90 112 and payload-bound 90 182;
//   · refused: payloads RLTP-VTI-7160 does not deliver, seen from B with
//     sender A, each with the item that refuses it;
//   · answers: a framework consumer's trust-task-error/0.5 and
//     trust-task-next-step/0.1 to A's carried document, in the form the
//     registry's Rust crates send (trust-tasks-rs 0.35.4, issuedAt with nine
//     fractional digits), each with its reading and the submission state it
//     leaves from each state before it (RLTP-VTI-5040 to 5060).
//
// Built and read by the library's adapter module (wrapSealed,
// readBindingEnvelope); conformance/runner.mjs recomputes the bytes and the
// readings independently.
//
//   usage: node scripts/gen-vti-sealed-envelope-vector.mjs [--check]   (from repo root;
//          requires lib/dist — build the library first)
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')
const OUT = join(ROOT, 'vectors/vti-sealed-envelope.json')
const { carrierScopedIdentity } = await import(join(ROOT, 'lib/dist/carrier-identity.js'))
const { jcs } = await import(join(ROOT, 'lib/dist/core.js'))
const { base58, cat, sha } = await import(join(ROOT, 'lib/dist/crypto.js'))
const { wrapSealed, readBindingEnvelope, DECLARED, SEALED_ENVELOPE_DOCUMENT_BOUND, TSP_BINDING_ENVELOPE_TYPE, SEALED_ENVELOPE_TYPE, TRUST_TASK_ERROR_TYPE, TRUST_TASK_NEXT_STEP_TYPE } =
  await import(join(ROOT, 'lib/dist/adapters/vti-mediator.js'))

const ID = JSON.parse(readFileSync(join(ROOT, 'vectors/identity-derivation.json'), 'utf8'))
const ROUTED = JSON.parse(readFileSync(join(ROOT, 'vectors/vti-routed-addressing.json'), 'utf8'))
const SEAL = JSON.parse(readFileSync(join(ROOT, 'vectors/seal.json'), 'utf8')).output.sealedEnvelope
const label = (s) => new Uint8Array(createHash('sha256').update(s, 'ascii').digest())
const hexToBytes = (h) => Uint8Array.from(h.match(/../g).map((b) => parseInt(b, 16)))
const te = new TextEncoder()
const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const C = ROUTED.carrier
const A = ROUTED.sides.A.connection
const B = ROUTED.sides.B.connection
// side A in another relationship (vti-routed-addressing's A2)
const A2 = (await carrierScopedIdentity(hexToBytes(ID.rootIkm), C, label('rltp/vector/vti-routed/nonce-A2'), 'connection')).did
const SINCE = Date.parse('2026-10-27T18:04:11.734Z')
const LATER = Date.parse('2026-10-28T09:30:00.000Z')

const carry = async (name, issuer, recipient, since, seal = SEAL) => {
  const w = await wrapSealed(seal, { issuer, recipient, since })
  const payload = new TextDecoder().decode(w.bytes)
  const preimage = 'rltp/v1/sealed-envelope-id' + jcs({ issuer, recipient, seal })
  return {
    case: name, issuer, recipient, since, seal,
    idPreimage: preimage, idPreimageSha256: sha256(te.encode(preimage)), id: w.outerId,
    document: w.envelope.document, payload, payloadSha256: sha256(w.bytes), payloadLength: w.bytes.length,
    rules: ['RLTP-VTI-3150', 'RLTP-DEL-4610', 'RLTP-DEL-4620', 'RLTP-DEL-5040'],
  }
}
const carried = [
  await carry('A→B, the seal of vectors/seal.json', A, B, SINCE),
  await carry('B→A, the same seal', B, A, SINCE),
  await carry('A→B, the same seal submitted later: same id, another issuedAt', A, B, LATER),
  await carry('A→B from A\'s connection DID of another relationship: another id', A2, B, SINCE),
]
const repeat = await wrapSealed(SEAL, { issuer: A, recipient: B, since: SINCE })
if (new TextDecoder().decode(repeat.bytes) !== carried[0].payload) throw new Error('a repeat is not byte-identical')
if (carried[2].id !== carried[0].id || carried[3].id === carried[0].id || carried[1].id === carried[0].id) throw new Error('id derivation')

// the bounds (RLTP-DEL-3030, 4.6; payload-bound §2): a seal of a 65 536-byte plaintext
const maxSeal = { rkid: SEAL.rkid, epk: SEAL.epk, nonce: SEAL.nonce, ciphertext: Buffer.alloc(65536 + 16, 7).toString('base64url') }
const maxW = await wrapSealed(maxSeal, { issuer: A, recipient: B, since: SINCE })
const maxDoc = te.encode(jcs(maxW.envelope.document)).length
if (maxDoc > SEALED_ENVELOPE_DOCUMENT_BOUND || maxW.bytes.length > DECLARED.payloadBound) throw new Error('the largest carried document exceeds its bound')
const bounds = {
  documentBound: SEALED_ENVELOPE_DOCUMENT_BOUND, payloadBound: DECLARED.payloadBound, envelopeOverhead: DECLARED.payloadBound - SEALED_ENVELOPE_DOCUMENT_BOUND,
  largestCiphertextLength: maxSeal.ciphertext.length, largestDocumentLength: maxDoc, largestPayloadLength: maxW.bytes.length,
  rules: ['RLTP-DEL-3030', 'RLTP-DEL-4630'],
}

// what B refuses from sender A (RLTP-VTI-7160); item = the item of 7160 that refuses it
const doc0 = carried[0].document
const env = (document) => jcs({ type: TSP_BINDING_ENVELOPE_TYPE, document })
const withDoc = (patch) => env({ ...doc0, ...patch })
const without = (k) => { const d = { ...doc0 }; delete d[k]; return env(d) }
const refused = [
  { case: 'not JSON', payload: 'sealed', item: 2 },
  { case: 'the bare seal as payload', payload: jcs(SEAL), item: 2 },
  { case: 'binding envelope type of another binding', payload: jcs({ type: 'https://trusttasks.org/binding/didcomm/0.1/envelope', document: doc0 }), item: 2 },
  { case: 'binding envelope without a document', payload: jcs({ type: TSP_BINDING_ENVELOPE_TYPE }), item: 2 },
  { case: 'document a string', payload: jcs({ type: TSP_BINDING_ENVELOPE_TYPE, document: jcs(doc0) }), item: 2 },
  { case: 'document of another type', payload: withDoc({ type: 'https://real-life.org/trust-tasks/spec/message/0.1' }), item: 5 },
  { case: 'issuer is not the sender', payload: withDoc({ issuer: A2 }), item: 3 },
  { case: 'recipient is not this side', payload: withDoc({ recipient: A }), item: 3 },
  { case: 'a proof', payload: withDoc({ proof: { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', created: '2026-10-27T18:04:11Z', verificationMethod: A + '#' + A.slice(8), proofPurpose: 'assertionMethod', proofValue: 'z' + base58(new Uint8Array(64)) } }), item: 3 },
  { case: 'expiresAt', payload: withDoc({ expiresAt: '2026-10-30T18:04:11Z' }), item: 3 },
  { case: 'id a UUID v4', payload: withDoc({ id: '5b0e8f3a-91c2-4d4e-a6f0-2c7d93b1e4a5', threadId: '5b0e8f3a-91c2-4d4e-a6f0-2c7d93b1e4a5' }), item: 3 },
  { case: 'threadId other than id', payload: withDoc({ threadId: carried[1].id }), item: 3 },
  { case: 'no issuedAt', payload: without('issuedAt'), item: 3 },
  { case: 'seal with an extra member', payload: withDoc({ payload: { ...SEAL, aad: '' } }), item: 3 },
  { case: 'seal ciphertext not canonical (non-zero trailing bits)', payload: withDoc({ payload: { ...SEAL, ciphertext: SEAL.ciphertext.slice(0, -2) + 'B' } }), item: 3 },
  { case: 'payload over payload-bound', payload: withDoc({ payload: { ...SEAL, ciphertext: Buffer.alloc(67600, 7).toString('base64url') } }), item: 1 },
].map((c) => ({ ...c, sender: A, self: B, rules: ['RLTP-VTI-7160', 'RLTP-DEL-5030'] }))
for (const c of refused) {
  const r = await readBindingEnvelope(te.encode(c.payload), { sender: c.sender, self: c.self })
  if (r.kind !== 'ignored') throw new Error(`${c.case}: read as ${r.kind}`)
  c.why = r.why
}
const accepted = await readBindingEnvelope(te.encode(carried[0].payload), { sender: A, self: B })
if (accepted.kind !== 'sealed' || jcs(accepted.seal) !== jcs(SEAL) || accepted.outerId !== carried[0].id) throw new Error('the carried document is not read')
const delivered = { payload: carried[0].payload, sender: A, self: B, item: jcs(SEAL), rules: ['RLTP-VTI-7160', 'RLTP-DEL-5030'] }

// the answers of a framework consumer B to A's carried document (seen from A, sender B)
const OUT_ID = carried[0].id
const NOW9 = '2026-10-27T17:27:50.395371028Z'
const errorDoc = (payload, extra = {}) => ({ id: 'urn:uuid:0d6c1b52-6b0e-4a8a-9d1c-3e2f4a5b6c7d', type: TRUST_TASK_ERROR_TYPE, issuer: B, recipient: A, threadId: OUT_ID, issuedAt: NOW9, payload, ...extra })
const unsupported = { code: 'unsupportedType', retryable: false, message: 'no handler for https://real-life.org/trust-tasks/spec/sealed-envelope/0.1', inResponseTo: { id: OUT_ID, typeUri: SEALED_ENVELOPE_TYPE } }
const nextDoc = (payload, extra = {}) => ({ id: 'urn:uuid:7e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b', type: TRUST_TASK_NEXT_STEP_TYPE, issuer: B, recipient: A, threadId: OUT_ID, issuedAt: NOW9, payload, ...extra })
const proceed = { expects: [{ typeUri: 'https://trusttasks.org/spec/trust-task-ok/0.1' }], continuation: 'proceed', inResponseTo: { id: OUT_ID, typeUri: SEALED_ENVELOPE_TYPE }, message: 'sealed-envelope/0.1 understood; waiting' }
// a next step with a valid proof under B's connection key, purpose authentication
const bKey = (await carrierScopedIdentity(new Uint8Array(label('rltp/vector/vti-routed/root-B')), C, new Uint8Array(label('rltp/vector/vti-routed/nonce-B')), 'connection')).key
const signed = async (doc) => {
  const cfg = { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', created: '2026-10-27T17:27:50Z', verificationMethod: B + '#' + B.slice(8), proofPurpose: 'authentication' }
  const hashData = cat(await sha(te.encode(jcs(cfg))), await sha(te.encode(jcs(doc))))
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, bKey.priv, hashData))
  return { ...doc, proof: { ...cfg, proofValue: 'z' + base58(sig) } }
}
const goodSigned = await signed(nextDoc(proceed))
const badSigned = { ...goodSigned, proof: { ...goodSigned.proof, proofValue: 'z' + base58(new Uint8Array(64).fill(1)) } }
const { inResponseTo: _irt, ...noIrt } = unsupported
const { inResponseTo: _irt2, ...proceedNoIrt } = proceed
// effect: the submission state the bound answer leaves from each state before it
// (accepted/held/delivered/failed; RLTP-VTI-5010 to 5050, Delivery RLTP-DEL-6140)
const REFUSED = { state: 'failed', reason: 'rejected-by-receiver', code: 'unsupportedType' }
const HELD = { state: 'accepted', held: true }
const terminalStays = { delivered: { state: 'delivered' }, failed: { state: 'failed', reason: 'expired-by-adapter-policy' } }
const refusal = { 'no report': REFUSED, 'awaiting-transport': REFUSED, accepted: REFUSED, held: REFUSED, ...terminalStays }
const nextStep = { 'no report': HELD, 'awaiting-transport': HELD, accepted: HELD, held: HELD, ...terminalStays }
const unchanged = { 'no report': null, 'awaiting-transport': { state: 'awaiting-transport' }, accepted: { state: 'accepted' }, held: HELD, ...terminalStays }
const answers = [
  { case: 'unsupportedType, as trust-tasks-rs sends it (inResponseTo and threadId)', document: errorDoc(unsupported), reading: { kind: 'error', reading: { verdict: 'refused', code: 'unsupportedType' }, answers: OUT_ID }, effect: refusal, rules: ['RLTP-VTI-5040', 'RLTP-VTI-5010', 'RLTP-VTI-5020', 'RLTP-VTI-5060'] },
  { case: 'unsupportedType without inResponseTo: bound by threadId', document: errorDoc(noIrt), reading: { kind: 'error', reading: { verdict: 'refused', code: 'unsupportedType' }, answers: OUT_ID }, effect: refusal, rules: ['RLTP-VTI-5040'] },
  { case: 'unsupportedType with issuedAt at an offset', document: errorDoc(unsupported, { issuedAt: '2026-10-27T19:27:50.395+02:00' }), reading: { kind: 'error', reading: { verdict: 'refused', code: 'unsupportedType' }, answers: OUT_ID }, effect: refusal, rules: ['RLTP-VTI-5060'] },
  { case: 'unsupportedType naming another document', document: errorDoc({ ...unsupported, inResponseTo: { id: carried[3].id, typeUri: SEALED_ENVELOPE_TYPE } }), reading: { kind: 'error', reading: { verdict: 'refused', code: 'unsupportedType' }, answers: carried[3].id }, effect: unchanged, rules: ['RLTP-VTI-5040'] },
  { case: 'unavailable, retryable', document: errorDoc({ code: 'unavailable', retryable: true, retryAfter: '2026-10-27T17:32:50.000000000Z', inResponseTo: unsupported.inResponseTo }), reading: { kind: 'error', reading: { verdict: 'retry', retryAfter: Date.parse('2026-10-27T17:32:50Z') }, answers: OUT_ID }, effect: unchanged, rules: ['RLTP-VTI-5010', 'RLTP-VTI-5060'] },
  { case: 'idConflict: an answer, no failure', document: errorDoc({ code: 'idConflict', retryable: false, inResponseTo: unsupported.inResponseTo }), reading: { kind: 'error', reading: { verdict: 'answered' }, answers: OUT_ID }, effect: unchanged, rules: ['RLTP-VTI-5030'] },
  { case: 'next step, as trust-tasks-rs sends it (continuation proceed)', document: nextDoc(proceed), reading: { kind: 'next-step', answers: OUT_ID }, effect: nextStep, rules: ['RLTP-VTI-5050', 'RLTP-VTI-5040', 'RLTP-DEL-6140'] },
  { case: 'next step without inResponseTo: bound by threadId', document: nextDoc(proceedNoIrt), reading: { kind: 'next-step', answers: OUT_ID }, effect: nextStep, rules: ['RLTP-VTI-5050', 'RLTP-VTI-5040'] },
  { case: 'next step with a valid proof under the issuer, purpose authentication', document: goodSigned, reading: { kind: 'next-step', answers: OUT_ID }, effect: nextStep, rules: ['RLTP-VTI-5050'] },
  // not an answer, or not bound: ignored, nothing changes
  { case: 'error: issuer is not the sender', document: errorDoc(unsupported, { issuer: A2 }), rules: ['RLTP-VTI-5040'] },
  { case: 'error: recipient is not this side', document: errorDoc(unsupported, { recipient: A2 }), rules: ['RLTP-VTI-5040'] },
  { case: 'error: inResponseTo names another type', document: errorDoc({ ...unsupported, inResponseTo: { id: OUT_ID, typeUri: 'https://real-life.org/trust-tasks/spec/message/0.1' } }), rules: ['RLTP-VTI-5040'] },
  { case: 'error: issuedAt is no RFC 3339 date-time', document: errorDoc(unsupported, { issuedAt: '2026-10-27 17:27:50Z' }), rules: ['RLTP-VTI-5060'] },
  { case: 'error: a member outside the registry form', document: errorDoc({ ...unsupported, severity: 'high' }), rules: ['RLTP-VTI-5010'] },
  { case: 'next step: expects empty', document: nextDoc({ ...proceed, expects: [] }), rules: ['RLTP-VTI-5050'] },
  { case: 'next step: an empty typeUri', document: nextDoc({ ...proceed, expects: [{ typeUri: '' }] }), rules: ['RLTP-VTI-5050'] },
  { case: 'next step: an unknown member', document: nextDoc({ ...proceed, priority: 1 }), rules: ['RLTP-VTI-5050'] },
  { case: 'next step: continuation outside the enumeration', document: nextDoc({ ...proceed, continuation: 'later' }), rules: ['RLTP-VTI-5050'] },
  { case: 'next step: a message of 1025 code points', document: nextDoc({ ...proceed, message: '\u{1F600}'.repeat(1025) }), rules: ['RLTP-VTI-5050'] },
  { case: 'next step: a proof that does not verify', document: badSigned, rules: ['RLTP-VTI-5050'] },
  { case: 'next step naming no document', document: (() => { const d = nextDoc(proceedNoIrt); delete d.threadId; return d })(), rules: ['RLTP-VTI-5040'] },
].map((c) => c.reading ? c : { ...c, reading: { kind: 'ignored' }, effect: unchanged })
for (const c of answers) {
  c.payload = env(c.document)
  const r = await readBindingEnvelope(te.encode(c.payload), { sender: B, self: A })
  const got = r.kind === 'ignored' ? { kind: 'ignored' } : r
  if (jcs(got) !== jcs(c.reading)) throw new Error(`${c.case}: read as ${jcs(r)}`)
  delete c.document
}

const vector = {
  description: 'VTI mediator adapter profile 0.29 (§3b, §5, §7) and Delivery 0.85 (§4.6): the carried document — a sealed-envelope/0.1 Trust Task document whose payload is the sealed envelope, inside the registry\'s TSP binding envelope (bindings/tsp/0.1 §2) — byte for byte as the payload of the inner TSP direct message, the same in mode routed and mode direct (the layers around it: vectors/vti-routed-addressing.json); its id, a UUID v8 of SHA-256("rltp/v1/sealed-envelope-id" ‖ JCS({issuer, recipient, seal})); a repeat byte-identical; the size bounds; the payloads a receiver does not deliver (RLTP-VTI-7160, item = the item that refuses it); and a framework consumer\'s answers to it, in the form trust-tasks-rs 0.35.4 sends, with the reading and the submission state each leaves from each state before it (effect: null = no report).',
  source: 'seal: output.sealedEnvelope of vectors/seal.json; A and B: sides.A and sides.B of vectors/vti-routed-addressing.json (connection DIDs); A2: side A under N = sha2-256("rltp/vector/vti-routed/nonce-A2"); since 2026-10-27T18:04:11.734Z and 2026-10-28T09:30:00.000Z; the proof of the signed next step: B\'s connection key (rootIkm sha2-256("rltp/vector/vti-routed/root-B"), N sha2-256("rltp/vector/vti-routed/nonce-B")). Generated by scripts/gen-vti-sealed-envelope-vector.mjs.',
  types: { bindingEnvelope: TSP_BINDING_ENVELOPE_TYPE, carried: SEALED_ENVELOPE_TYPE, error: TRUST_TASK_ERROR_TYPE, nextStep: TRUST_TASK_NEXT_STEP_TYPE },
  carrier: C,
  sides: { A, B, A2 },
  carried,
  repeat: { of: 0, payloadSha256: sha256(repeat.bytes), byteIdentical: true, rules: ['RLTP-VTI-3150', 'RLTP-DEL-5040'] },
  modes: { routed: 'the payload of the inner direct message, inside an outer routed message to C', direct: 'the payload of the direct message, alone', payloadIdentical: true, rules: ['RLTP-VTI-3110', 'RLTP-VTI-3120'] },
  bounds,
  delivered,
  refused,
  answers,
}

const manifest = new Set([
  ...readFileSync(join(ROOT, 'conformance/adapter-vti-rule-ids-0.29.txt'), 'utf8').split('\n'),
  ...readFileSync(join(ROOT, 'conformance/delivery-rule-ids-0.85.txt'), 'utf8').split('\n'),
].filter((l) => /^RLTP-/.test(l)))
for (const c of [...carried, ...refused, ...answers, bounds, delivered]) for (const id of c.rules) if (!manifest.has(id)) throw new Error(`${c.case ?? 'case'}: ${id} is not in a rule manifest`)

const text = JSON.stringify(vector, null, 1) + '\n'
if (CHECK) {
  const have = readFileSync(OUT, 'utf8')
  if (have !== text) { console.error('vectors/vti-sealed-envelope.json differs from its generator'); process.exit(1) }
  console.log('vti-sealed-envelope: reproduced byte for byte')
} else {
  writeFileSync(OUT, text)
  console.log(`wrote ${OUT}`)
}
