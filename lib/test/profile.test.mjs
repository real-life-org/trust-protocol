#!/usr/bin/env node
// profile (lib Stage 2, PR 6; Trust Layer 0.31 §6b): the root builders
// against vectors/profile.json; setProfile → duties → a sealed profile@1 →
// receive → the view; one revision counter across scopes (6450); the
// revision rule per tuple (6270, 6460); pictures refused by their header
// before any decoding (6435, 6475); the class off and a lagging
// relationship get nothing (6455, 6595); a chaining re-sends (6465) and a
// tuple that is no active head is no longer shown (6461).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  createHolder, labeledContext, ecdh, xRawOfMk, jcs, seal, iso, digestDoc,
  PROFILE_TYPE, assembleProfile, profileKey, profileInfo, profileMacOk, profileSchemaOk, imageDimensions, imageWithinBounds, profileProblem,
} from '../dist/index.js'
import { InMemoryStore, stateBuilder, continuityTestModule } from '../dist/testing.js'
import { T0 } from './pair-fixture.mjs'
import { person, pairSide, network, state, edit, sharedOf } from './star-fixture.mjs'

const vec = (f) => JSON.parse(readFileSync(new URL('../../vectors/' + f, import.meta.url), 'utf8'))
const hex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)))
const PV = vec('profile.json')
const IMAGE = PV.inputs.body.image
const neg = (name) => PV.negatives.find((n) => n.name === name)
const ofType = (out, type) => out.filter((o) => o.type === type)
const T1 = T0 + 3_600_000

test('profile: the root builders reproduce vectors/profile.json byte for byte — k_pr, the mac, the negatives (6430–6440, 6475)', async () => {
  const IKM = hex(vec('identity-derivation.json').rootIkm)
  const { sender: S, recipient: R, body } = PV.inputs
  const A = await labeledContext(IKM, S.label), B = await labeledContext(IKM, R.label)
  assert.deepEqual([A.anchor, B.anchor], [S.anchor, R.anchor])
  const shared = await ecdh(A.x.priv, xRawOfMk(B.keyAgreement))
  assert.equal('u' + Buffer.from(shared).toString('base64url'), PV.intermediate.sharedSecret)
  assert.equal(profileInfo(A.anchor, B.anchor), PV.intermediate.info)
  assert.equal('u' + Buffer.from(await profileKey(shared, A.anchor, B.anchor)).toString('base64url'), PV.intermediate.kpr)
  const p = await assembleProfile(body, shared, A.anchor, B.anchor)
  assert.equal(jcs(p), jcs(PV.output.profile))
  assert.equal(profileSchemaOk(p), true)
  assert.equal(profileProblem(p), null)
  assert.deepEqual(imageDimensions(IMAGE), PV.inputs.dimensions)
  // the recipient's side of the key: the same secret, the same direction
  const back = await ecdh(B.x.priv, xRawOfMk(A.keyAgreement))
  assert.equal(await profileMacOk(p, back, A.anchor, B.anchor), true)
  assert.equal(await profileMacOk(p, back, B.anchor, A.anchor), false, 'the reverse direction is another key (6440)')
  for (const n of PV.negatives) {
    if (n.wrongMac) {
      assert.notEqual(n.wrongMac, p.proof.mac, n.name)
      continue
    }
    const a = n.artifact ?? (() => { const d = structuredClone(PV.output.profile); d.body.image = n.mutate.prefix + n.mutate.repeat.char.repeat(n.mutate.repeat.count); return d })()
    if (n.expect === 'reject: schema') assert.equal(profileProblem(a), 'RLTP-TRU-6430', n.name)
    if (n.expect === 'reject: mac') assert.equal(await profileMacOk(a, back, A.anchor, B.anchor), false, n.name)
    if (n.expect === 'reject: dimensions') {
      assert.equal(profileSchemaOk(a), true, n.name)
      assert.deepEqual(imageDimensions(a.body.image), n.dimensions, n.name)
      assert.equal(imageWithinBounds(imageDimensions(a.body.image)), false, n.name)
      assert.equal(profileProblem(a), 'RLTP-TRU-6475', n.name)
    }
  }
})

test('profile: imageDimensions reads headers only — unreadable, animated, mistyped and truncated pictures are null (6475)', () => {
  const b64 = IMAGE.slice(IMAGE.indexOf(',') + 1)
  assert.equal(imageDimensions('data:image/jpeg;base64,' + b64), null, 'a WebP declared as JPEG is not a picture of the declared type')
  assert.equal(imageDimensions('data:image/webp;base64,' + b64.slice(0, 20)), null, 'truncated')
  assert.equal(imageDimensions('data:image/webp;base64,@@@@'), null, 'not base64')
  assert.equal(imageDimensions('data:image/png;base64,' + b64), null, 'not an admitted media type')
  // a VP8X container flagged as animation is no single still picture
  const raw = Buffer.from(neg('image-vp8x-canvas-1025-frame-8').artifact.body.image.split(',')[1], 'base64')
  const anim = Buffer.from(raw); anim[20] |= 0x02
  assert.equal(imageDimensions('data:image/webp;base64,' + anim.toString('base64')), null)
  // a JPEG header: SOI, APP0, SOF0 (one component) 640 × 480, SOS
  assert.deepEqual(imageDimensions(jpegOf(640, 480)), { width: 640, height: 480 })
  assert.equal(imageWithinBounds(imageDimensions(jpegOf(1025, 8))), false)
})

// ── synthetic headers (the pixels after them are never read) ──────────

const u16 = (n) => [n >> 8, n & 0xff]
const SOI = [0xff, 0xd8], APP0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00], EOI = [0xff, 0xd9]
const sof = (w, h, m = 0xc0) => [0xff, m, 0x00, 0x0b, 0x08, ...u16(h), ...u16(w), 0x01, 0x01, 0x11, 0x00]
const SOS = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34]
const jpegRaw = (bytes) => 'data:image/jpeg;base64,' + Buffer.from(bytes).toString('base64')
function jpegOf (w, h) { return jpegRaw([...SOI, ...APP0, ...sof(w, h), ...SOS, ...EOI]) }
const le32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
const chunk = (fourcc, payload, size = payload.length) => [...Buffer.from(fourcc, 'ascii'), ...le32(size), ...payload, ...(payload.length & 1 ? [0] : [])]
const vp8l = (w, h) => chunk('VP8L', [0x2f, ...le32(((w - 1) | ((h - 1) << 14)) >>> 0)])
const vp8x = (w, h, flags = 0) => chunk('VP8X', [flags, 0, 0, 0, (w - 1) & 0xff, ((w - 1) >> 8) & 0xff, (w - 1) >> 16, (h - 1) & 0xff, ((h - 1) >> 8) & 0xff, (h - 1) >> 16])
const webpOf = (...chunks) => { const body = chunks.flat(); return 'data:image/webp;base64,' + Buffer.from([...Buffer.from('RIFF'), ...le32(4 + body.length), ...Buffer.from('WEBP'), ...body]).toString('base64') }

test('profile: the bound is exact — 1024 × 1024 is accepted and 1025 refused, in JPEG, WebP and both VP8X declarations (6435, 6475)', () => {
  const ok = (uri) => imageWithinBounds(imageDimensions(uri))
  assert.equal(ok(jpegOf(1024, 1024)), true)
  assert.equal(ok(jpegOf(1025, 1024)), false)
  assert.equal(ok(jpegOf(1024, 1025)), false)
  assert.equal(ok(webpOf(vp8l(1024, 1024))), true)
  assert.equal(ok(webpOf(vp8l(1025, 1024))), false)
  assert.deepEqual(imageDimensions(webpOf(vp8x(1024, 1024), vp8l(1024, 1024))), { canvas: { width: 1024, height: 1024 }, frame: { width: 1024, height: 1024 } })
  assert.equal(ok(webpOf(vp8x(1024, 1024), vp8l(1024, 1024))), true)
  assert.equal(ok(webpOf(vp8x(1025, 1024), vp8l(8, 8))), false, 'the canvas counts')
  assert.equal(ok(webpOf(vp8x(8, 8), vp8l(1024, 1025))), false, 'the frame counts')
})

test('profile: JPEG headers — DHP, differential and second frame headers, a frame without a scan, and segment lengths out of bounds are refused (6475; review PR 6 C4, K4)', () => {
  const cases = {
    'DHP declaring 65535 × 65535, then SOF5 8 × 8': [...SOI, 0xff, 0xde, 0x00, 0x08, 0x08, 0xff, 0xff, 0xff, 0xff, 0x01, ...sof(8, 8, 0xc5), ...SOS, ...EOI],
    'SOF5 (differential) alone': [...SOI, ...sof(8, 8, 0xc5), ...SOS, ...EOI],
    'SOF13 (differential)': [...SOI, ...sof(8, 8, 0xcd), ...SOS, ...EOI],
    'two frame headers': [...SOI, ...sof(8, 8), ...sof(4096, 4096, 0xc2), ...SOS, ...EOI],
    'a frame header without a scan': [...SOI, ...sof(8, 8), ...EOI],
    'a scan without a frame header': [...SOI, ...APP0, ...SOS, ...EOI],
    'a segment length 0': [...SOI, 0xff, 0xc0, 0x00, 0x00, ...sof(8, 8), ...SOS],
    'a segment length 1': [...SOI, 0xff, 0xe0, 0x00, 0x01, ...sof(8, 8), ...SOS],
    'a segment beyond the data': [...SOI, 0xff, 0xe0, 0x7f, 0xff, 0x00],
    'a frame header of the wrong length': [...SOI, 0xff, 0xc0, 0x00, 0x08, 0x08, 0x00, 0x08, 0x00, 0x08, 0x01, ...SOS],
    'a restart marker before the scan': [...SOI, 0xff, 0xd0, ...sof(8, 8), ...SOS],
    'a second SOI': [...SOI, ...SOI, ...sof(8, 8), ...SOS],
  }
  for (const [name, bytes] of Object.entries(cases)) assert.equal(imageDimensions(jpegRaw(bytes)), null, name)
  assert.deepEqual(imageDimensions(jpegRaw([...SOI, ...APP0, 0xff, ...sof(8, 9), ...SOS])), { width: 8, height: 9 }, 'fill bytes before a marker')
  assert.deepEqual(imageDimensions(jpegRaw([...SOI, ...sof(8, 9, 0xc2), ...SOS])), { width: 8, height: 9 }, 'progressive (SOF2) is one frame')
})

test('profile: WebP containers — chunk lengths beyond the container, animation anywhere, a second frame, extra chunks in the simple format are refused (6475; review PR 6 C4, K4)', () => {
  const cases = {
    'a chunk length 0xffffffff': webpOf(chunk('VP8L', [0x2f, ...le32(0)], 0xffffffff)),
    'a chunk past the RIFF end': webpOf(chunk('VP8L', [0x2f, 0, 0, 0, 0], 40)),
    'ANIM after the frame (VP8X)': webpOf(vp8x(8, 8), vp8l(8, 8), chunk('ANIM', [0, 0, 0, 0, 0, 0])),
    'ANMF (VP8X)': webpOf(vp8x(8, 8), chunk('ANMF', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), vp8l(8, 8)),
    'the animation flag': webpOf(vp8x(8, 8, 0x02), vp8l(8, 8)),
    'a second frame (VP8X)': webpOf(vp8x(8, 8), vp8l(8, 8), vp8l(4096, 4096)),
    'a VP8X without a frame': webpOf(vp8x(8, 8), chunk('EXIF', [1, 2])),
    'a second VP8X': webpOf(vp8x(8, 8), vp8x(8, 8), vp8l(8, 8)),
    'the simple format with an extra chunk': webpOf(vp8l(8, 8), chunk('ANIM', [0, 0, 0, 0, 0, 0])),
    'the simple format with a second frame': webpOf(vp8l(8, 8), vp8l(4096, 4096)),
    'a VP8L chunk too short for its header': webpOf(chunk('VP8L', [0x2f, 0])),
  }
  for (const [name, uri] of Object.entries(cases)) assert.equal(imageDimensions(uri), null, name)
  // trailing bytes beyond the RIFF size
  const good = Buffer.from(webpOf(vp8l(8, 8)).split(',')[1], 'base64')
  assert.equal(imageDimensions('data:image/webp;base64,' + Buffer.concat([good, Buffer.from([0, 0])]).toString('base64')), null)
  // metadata chunks around the one frame are allowed in VP8X (the app re-encodes, 6445)
  assert.deepEqual(imageDimensions(webpOf(vp8x(8, 8), chunk('ICCP', [1, 2, 3]), vp8l(8, 8), chunk('EXIF', [4]))), { canvas: { width: 8, height: 8 }, frame: { width: 8, height: 8 } })
})

// ── the holder ─────────────────────────────────────────────────────────

/** Persons with one relationship per edge, the continuity test module,
 *  invariants on; `trusted` pairs trust each other (their mappings out). */
async function world (names, edges, { build = {}, fills = [0x71, 0x72, 0x73] } = {}) {
  const persons = []
  for (const [i, n] of names.entries()) persons.push(await person(n, fills[i]))
  const by = Object.fromEntries(persons.map((p) => [p.name, p]))
  const r = await network(persons, edges.map(([a, b]) => [by[a], by[b]]), {
    build: Object.fromEntries(names.map((n) => [n, (b) => build[n]?.(b)])),
    holder: Object.fromEntries(names.map((n) => [n, (p) => createHolder({ store: p.store, keys: p.keys }, { modules: [continuityTestModule], invariants: true })])),
  })
  let k = 0
  const opts = (when = T0) => ({ when, actId: `act-${++k}` })
  return { ...by, persons, ...r, opts }
}

test('profile: setProfile → a profile/1 duty per relationship the class is on for → a sealed profile@1 → B verifies, the view shows the name (6450, 6455, 6460, 6425)', async () => {
  const w = await world(['A', 'B'], [['A', 'B']])
  const { A, B, opts } = w
  await A.holder.trust('B', opts()); await B.holder.trust('A', opts())
  await w.pump(T0)
  const r = await A.holder.setProfile({ name: 'Anna', image: IMAGE, text: 'Brot.' }, opts(T0 + 1))
  assert.equal(r.ok, true)
  assert.deepEqual(r.events.map((e) => [e.type, e.contactId]), [['profile.updated', null]])
  assert.equal(r.nextDueAt, T0 + 1)
  let sA = await state(A)
  assert.deepEqual(sA.profile, { body: { name: 'Anna', image: IMAGE, text: 'Brot.' }, revision: '1' })
  assert.deepEqual(Object.values(sA.duties), [{ kind: 'profile', v: 1, id: 'profile:r-B', contactId: 'B', relId: 'r-B', rev: '1' }])
  assert.deepEqual(await A.holder.profile(), { commitSeq: sA.commitSeq, revision: '1', name: 'Anna', image: IMAGE, text: 'Brot.', community: sA.register.community })
  const res = await A.holder.resume(T0 + 2)
  const out = ofType(res.outbound, PROFILE_TYPE)
  assert.equal(out.length, 1)
  sA = await state(A)
  assert.deepEqual(sA.duties, {})
  assert.equal(sA.relationships['r-B'].tuples[0].profileOut.rev, '1')
  // the document: one unchunked profile@1 under k_pr, proof-free (6480, 6495)
  const { openAt } = await import('./star-fixture.mjs')
  const doc = await openAt(B, A, out[0].envelope)
  assert.equal(doc.type, PROFILE_TYPE)
  assert.equal(doc.proof, undefined)
  assert.deepEqual(doc.payload.body, { type: 'profile@1', revision: '1', name: 'Anna', image: IMAGE, text: 'Brot.' })
  assert.equal(await profileMacOk(doc.payload, await sharedOf(B, A), A.pairs.B.anchor, B.pairs.A.anchor), true)
  const [rb] = await w.deliver(out, T0 + 3)
  assert.equal(rb.r.disposition, 'unique')
  assert.deepEqual(rb.r.events.map((e) => [e.type, e.contactId]), [['profile.updated', 'A']])
  assert.equal(ofType(rb.r.outbound, 'https://real-life.org/trust-tasks/spec/delivery-ack/0.1').length, 1, 'acked like the family (6495)')
  const v = await B.holder.contact('A')
  assert.equal(v.displayName, 'Anna')
  assert.deepEqual(v.profile, { revision: '1', name: 'Anna', image: IMAGE, text: 'Brot.' })
  // a new content takes the next revision; the same content changes nothing
  assert.deepEqual(await A.holder.setProfile({ name: 'Anna', image: IMAGE, text: 'Brot.' }, opts(T0 + 4)), { ok: true, outbound: [], events: [] })
  await A.holder.setProfile({ name: 'Anna B.' }, opts(T0 + 5))
  await w.pump(T0 + 6)
  assert.deepEqual((await B.holder.contact('A')).profile, { revision: '2', name: 'Anna B.' })
})

test('profile: one revision counter across all scopes — every relationship gets the same revision, each scope only rising (6450, 6300)', async () => {
  const w = await world(['A', 'B', 'C'], [['A', 'B'], ['A', 'C']])
  const { A, B, C, opts } = w
  for (const [p, q] of [[A, 'B'], [A, 'C'], [B, 'A'], [C, 'A']]) await p.holder.trust(q, opts())
  await A.holder.setProfile({ name: 'one' }, opts(T0 + 1))
  await w.pump(T0 + 1)
  await A.holder.setProfile({ name: 'two' }, opts(T0 + 2))
  await A.holder.setProfile({ name: 'three' }, opts(T0 + 3))
  assert.deepEqual(Object.values((await state(A)).duties).map((d) => [d.id, d.rev]).sort(), [['profile:r-B', '3'], ['profile:r-C', '3']], 'one duty per relationship, at the newest revision')
  await w.pump(T0 + 4)
  const sA = await state(A)
  assert.equal(sA.profile.revision, '3')
  assert.deepEqual(['r-B', 'r-C'].map((r) => sA.relationships[r].tuples[0].profileOut.rev), ['3', '3'])
  for (const p of [B, C]) assert.deepEqual((await p.holder.contact('A')).profile, { revision: '3', name: 'three' })
})

test('profile: a newer revision supersedes the one still owed — two changes before a resume deliver the second only (6455 read through its rationale; the wording is a Trust 0.32 follow-up)', async () => {
  // 6455 says "each new revision"; its rationale (a failed delivery stays
  // undelivered until the next revision, 6460 keeps only the newest) is
  // what the library follows: the owed revision is superseded, never sent
  const w = await world(['A', 'B'], [['A', 'B']])
  const { A, B, opts } = w
  await A.holder.trust('B', opts()); await B.holder.trust('A', opts())
  await w.pump(T0)
  await A.holder.setProfile({ name: 'first' }, opts(T0 + 1))
  await A.holder.setProfile({ name: 'second' }, opts(T0 + 2))
  assert.deepEqual(Object.values((await state(A)).duties).map((d) => [d.id, d.rev]), [['profile:r-B', '2']])
  const out = ofType((await A.holder.resume(T0 + 3)).outbound, PROFILE_TYPE)
  assert.equal(out.length, 1)
  await w.deliver(out, T0 + 4)
  assert.deepEqual((await B.holder.contact('A')).profile, { revision: '2', name: 'second' })
})

test('profile: the revision rule per tuple — a lower revision is refused, an equal identical one is a repeat, an equal different one an equivocation (6270, 6460)', async () => {
  const w = await world(['A', 'B'], [['A', 'B']])
  const { A, B, opts } = w
  await A.holder.trust('B', opts()); await B.holder.trust('A', opts())
  await w.pump(T0)
  await A.holder.setProfile({ name: 'v1' }, opts(T0 + 1))
  const first = ofType((await A.holder.resume(T0 + 1)).outbound, PROFILE_TYPE)
  await A.holder.setProfile({ name: 'v2' }, opts(T0 + 2))
  const second = ofType((await A.holder.resume(T0 + 2)).outbound, PROFILE_TYPE)
  assert.equal((await w.deliver(second, T0 + 3))[0].r.disposition, 'unique')
  const late = (await w.deliver(first, T0 + 4))[0].r
  assert.deepEqual([late.disposition, late.reason, late.ref], ['failed', 'validation-failed', 'RLTP-TRU-6460'], 'a delayed older revision does not roll back (6460)')
  assert.equal((await B.holder.contact('A')).profile.name, 'v2')
  // crafted documents of A's side under the same key
  const craft = async (body) => {
    const fs = A.pairs.B, ts = B.pairs.A
    const p = await assembleProfile(body, await sharedOf(A, B), fs.anchor, ts.anchor)
    const doc = { id: crypto.randomUUID(), type: PROFILE_TYPE, issuer: fs.anchor, recipient: ts.anchor, threadId: crypto.randomUUID(), issuedAt: iso(T0), payload: p }
    return { envelope: await seal(doc, ts.keyAgreement), digest: await digestDoc(doc) }
  }
  const seq = (await state(B)).commitSeq
  const repeat = await B.holder.receive((await craft({ type: 'profile@1', revision: '2', name: 'v2' })).envelope, T0 + 5)
  assert.equal(repeat.disposition, 'unique', 'a repeat under a new document id: acknowledged')
  assert.equal(repeat.events.length, 0, 'and nothing changes')
  assert.equal(BigInt((await state(B)).commitSeq), BigInt(seq) + 1n, 'only its ack commits')
  const equiv = await B.holder.receive((await craft({ type: 'profile@1', revision: '2', name: 'other' })).envelope, T0 + 6)
  assert.deepEqual([equiv.disposition, equiv.ref], ['failed', 'RLTP-TRU-6270'])
  // a forged mac (another key) and a third party's anchor are refused
  const fs = A.pairs.B, ts = B.pairs.A
  const wrong = await assembleProfile({ type: 'profile@1', revision: '9', name: 'x' }, await sharedOf(A, B), ts.anchor, fs.anchor)
  const doc = { id: crypto.randomUUID(), type: PROFILE_TYPE, issuer: fs.anchor, recipient: ts.anchor, threadId: crypto.randomUUID(), issuedAt: iso(T0), payload: wrong }
  const bad = await B.holder.receive(await seal(doc, ts.keyAgreement), T0 + 7)
  assert.deepEqual([bad.disposition, bad.ref], ['failed', 'RLTP-TRU-6440'])
  const third = { ...doc, id: crypto.randomUUID(), payload: { body: { type: 'profile@1', revision: '9', name: 'x', anchor: 'did:key:z6MkThird' }, proof: { mac: wrong.proof.mac } } }
  const t3 = await B.holder.receive(await seal(third, ts.keyAgreement), T0 + 8)
  assert.deepEqual([t3.disposition, t3.reason, t3.stage], ['failed', 'malformed', 7], 'the closed body (6430, 6490)')
})

test('profile: pictures are refused by their header before anything decodes — on setProfile and on receive; oversize content is refused (6435, 6475, 6430)', async () => {
  const w = await world(['A', 'B'], [['A', 'B']])
  const { A, B, opts } = w
  await A.holder.trust('B', opts()); await B.holder.trust('A', opts())
  await w.pump(T0)
  for (const n of ['image-1025x1025', 'image-4096x4096', 'image-vp8x-canvas-8-frame-1025', 'image-vp8x-canvas-1025-frame-8']) {
    const r = await A.holder.setProfile({ name: 'A', image: neg(n).artifact.body.image }, opts())
    assert.deepEqual(r, { ok: false, code: 'profile-invalid', ref: 'RLTP-TRU-6475' }, n)
  }
  assert.deepEqual(await A.holder.setProfile({ name: 'A'.repeat(65) }, opts()), { ok: false, code: 'profile-invalid', ref: 'RLTP-TRU-6430' })
  assert.deepEqual(await A.holder.setProfile({ name: 'A', text: 't'.repeat(257) }, opts()), { ok: false, code: 'profile-invalid', ref: 'RLTP-TRU-6430' })
  assert.deepEqual(await A.holder.setProfile({ name: 'A', image: 'data:image/png;base64,iVBORw0KGgo=' }, opts()), { ok: false, code: 'profile-invalid', ref: 'RLTP-TRU-6430' })
  assert.deepEqual(await A.holder.setProfile({ name: 'A', image: 'data:image/webp;base64,' + 'A'.repeat(59980) }, opts()), { ok: false, code: 'profile-invalid', ref: 'RLTP-TRU-6430' })
  assert.equal((await state(A)).profile.revision, '0', 'nothing committed')
  // received: a schema-valid, mac-valid profile whose header declares 1025 × 1025
  const fs = A.pairs.B, ts = B.pairs.A
  const p = await assembleProfile({ type: 'profile@1', revision: '1', name: 'A', image: neg('image-vp8x-canvas-8-frame-1025').artifact.body.image }, await sharedOf(A, B), fs.anchor, ts.anchor)
  const doc = { id: crypto.randomUUID(), type: PROFILE_TYPE, issuer: fs.anchor, recipient: ts.anchor, threadId: crypto.randomUUID(), issuedAt: iso(T0), payload: p }
  const r = await B.holder.receive(await seal(doc, ts.keyAgreement), T0 + 1)
  assert.deepEqual([r.disposition, r.reason, r.ref], ['failed', 'validation-failed', 'RLTP-TRU-6475'])
  assert.equal((await B.holder.contact('A')).profile, undefined)
})

test('profile: the class off toward a contact — no duty, nothing sent; on again sends the current profile (6455, 2790, 2850)', async () => {
  const w = await world(['A', 'B'], [['A', 'B']])
  const { A, B, opts } = w
  await A.holder.trust('B', opts()); await B.holder.trust('A', opts())
  await w.pump(T0)
  await A.holder.setClass('B', 'profile', 'off', opts(T0 + 1))
  const r = await A.holder.setProfile({ name: 'hidden' }, opts(T0 + 2))
  assert.equal(r.ok, true)
  assert.deepEqual((await state(A)).duties, {})
  const log = await w.pump(T0 + 3)
  assert.equal(log.filter((l) => l.type === PROFILE_TYPE).length, 0)
  assert.equal((await B.holder.contact('A')).profile, undefined)
  await A.holder.setClass('B', 'profile', 'on', opts(T0 + 4))
  await w.pump(T0 + 5)
  assert.equal((await B.holder.contact('A')).displayName, 'hidden', 'turning on sends the current profile (2850)')
})

test('profile: a relationship that lags gets nothing; it gets the profile once it ceases to lag (6455, 6595, 2850)', async () => {
  const A = await person('A', 0x81), B = await person('B', 0x82)
  const B1 = await pairSide(B), B2 = await pairSide(B), A1 = await pairSide(A), A2 = await pairSide(A)
  A.pairs = { 'B#1': A1, 'B#2': A2 }
  const H = 'did:key:z6MkNewHead', OLD = 'did:key:z6MkOldHead'
  const store = new InMemoryStore()
  const spec = (mine, theirs) => ({ ownPairLabel: mine.label, counterpartAnchor: theirs.anchor, counterpartKeyAgreement: theirs.keyAgreement, rkid: mine.keyAgreement })
  await store.commit(null, stateBuilder({ at: T0 }).community(A.genesis, '1')
    .relationship('r1', { contactId: 'c1', tuples: [spec(A1, B1)], heldCounterpartHead: H, links: [{ prev: OLD, next: H }] })
    .relationship('r2', { contactId: 'c1', tuples: [spec(A2, B2)], heldCounterpartHead: OLD })
    .entry('c1').contact('c1', { anchorHead: H }).settings('c1', { profile: 'on', star: 'off', groupStar: 'off' })
    .build())
  const h = await createHolder({ store, keys: A.keys }, { invariants: true })
  await h.setProfile({ name: 'A' }, { when: T0, actId: 'p' })
  assert.deepEqual(Object.keys((await store.read()).state.duties), ['profile:r1'], 'r2 lags: no profile there (6455)')
  const r = await h.resume(T0 + 1)
  assert.deepEqual(ofType(r.outbound, PROFILE_TYPE).map((o) => o.recipient.keyAgreement), [B1.keyAgreement])
  // r2 comes to present the entry's head: it ceases to lag, the class turns on for it (2850)
  const { state: s, version } = await store.read()
  s.relationships.r2.heldCounterpartHead = H
  s.relationships.r2.links = [{ prev: OLD, next: H }]
  await store.commit(version, s)
  // (here through a settings change, which runs the follow rule; a verification on r2 would too)
  const h2 = await createHolder({ store, keys: A.keys }, { invariants: true })
  await h2.setClass('c1', 'profile', 'off', { when: T0 + 3, actId: 'off' })
  await h2.setClass('c1', 'profile', 'on', { when: T0 + 4, actId: 'on' })
  const r2 = await h2.resume(T0 + 5)
  assert.deepEqual(ofType(r2.outbound, PROFILE_TYPE).map((o) => o.recipient.keyAgreement).sort(), [B1.keyAgreement, B2.keyAgreement].sort())
})

test('profile: a chaining re-sends the profile on the new head (6465); a tuple that is no longer an active head is not shown (6461)', async () => {
  const w = await world(['A', 'B'], [['A', 'B']], { fills: [0x91, 0x92] })
  const { A, B, opts } = w
  await A.holder.trust('B', opts()); await B.holder.trust('A', opts())
  await w.pump(T0)
  await A.holder.setProfile({ name: 'Anna' }, opts(T0 + 1))
  await w.pump(T0 + 1)
  assert.equal((await B.holder.contact('A')).displayName, 'Anna')
  // a re-encounter: fresh tuples on both sides; the probe and the continuity mapping chain them
  const mine = await pairSide(A), theirs = await pairSide(B)
  A.pairs['B#2'] = mine; B.pairs['A#2'] = theirs
  const open = (x, own, other, otherSide) => x.holder.act('continuity.newTuple', {
    relId: `r-${other.name}-2`, contactId: `${other.name}-2`, ownPairLabel: own.label, counterpartAnchor: otherSide.anchor, counterpartKeyAgreement: otherSide.keyAgreement,
  }, T1)
  assert.equal((await open(A, mine, B, theirs)).ok, true)
  assert.equal((await open(B, theirs, A, mine)).ok, true)
  // everything but A's profile goes through: B chains, and the old tuple is no active head any more
  const held = []
  const { router } = await import('./star-fixture.mjs')
  const persons = [A, B]
  for (let i = 0; i < 10; i++) {
    const out = []
    for (const p of persons) out.push(...(await p.holder.resume(T1)).outbound)
    const go = out.filter((o) => { if (o.type === PROFILE_TYPE) { held.push(o); return false } return true })
    if (!go.length) break
    const log = []
    await router(persons).deliver(go, T1, log)
  }
  const sB = await state(B)
  const chain = sB.relationships['r-A']
  assert.equal(chain.tuples.length, 2, 'B chained')
  assert.equal(chain.tuples[0].deactivated, true)
  assert.equal(chain.tuples[0].profileIn.rev, '1', 'the old tuple still holds the profile it verified')
  assert.equal((await B.holder.contact('A')).profile, undefined, 'a tuple that is no active head is not shown (6461)')
  // 6465: A sent the current profile on the new head without a new act
  assert.equal(held.length, 1)
  assert.equal(held[0].envelope.rkid, theirs.keyAgreement)
  await w.deliver(held, T1 + 1)
  const v = await B.holder.contact('A')
  assert.equal(v.displayName, 'Anna')
  assert.equal((await state(B)).relationships['r-A'].tuples[1].profileIn.rev, '1', 'the new scope takes revision 1 again: scopes are per tuple (6280)')
})
