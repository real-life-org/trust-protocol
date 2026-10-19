#!/usr/bin/env node
// message-holder (lib 0.5.0): Message Tasks 0.1 on the holder
// (message/holder.ts) — sending on a ready, unblocked relationship (5010–
// 5030), reception through the stages (4010–4050), the defined effect with
// the completion record and the inbox in one transaction with the cache
// entry and the ack (4210, 4310–4350, 4410–4420), the bounds with the
// transient failed(rate-limited) (4110–4140), the block's discard (6210,
// 6220, 6510), the time mark (4060) and the #103 race, the sender's
// lifetime (5110, Delivery 6110, 6115, 7020). The scenario set of §10.2.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { labeledContext, seal, unseal, iso, ecdh, digestDoc, createHolder, seedKeys } from '../dist/index.js'
import { messageKeyOf, messageMac, MESSAGE_TYPE } from '../dist/message.js'
import { InMemoryStore } from '../dist/testing.js'
import { T0, ev, opts, settle, met, communityPerson } from './holder-fixture.mjs'

const ACK = 'https://real-life.org/trust-tasks/delivery-ack/0.1'
const DAY = 86_400_000
const H = 180 * DAY

/** The tuple of `P` whose counterpart is `Q`'s pair anchor of the same relationship. */
async function tupleTo (P, contactId) {
  const s = await P.read()
  const c = Object.values(s.contacts).find((x) => x.id === contactId || x.aliases.includes(contactId))
  const r = s.relationships[c.relIds[0]]
  return r.tuples.find((t) => t.ownPairLabel === r.activeHead)
}

/** The plain document of a message envelope, opened with the receiver's pair key. */
async function openMsg (R, env) {
  const s = await R.read()
  const label = s.addresses.keys[env.rkid].label
  return (await unseal(env, (await labeledContext(R.seed, label)).x.priv)).document
}

/** A message document from S to R on their tuple, signed as S would but
 *  with `body` chosen here (a re-wrap or an equivocation). */
async function craft (S, sContact, body, { id = crypto.randomUUID(), threadId = crypto.randomUUID(), when = T0 } = {}) {
  const t = await tupleTo(S, sContact)
  const own = await labeledContext(S.seed, t.ownPairLabel)
  const peer = (await import('../dist/crypto.js')).xRawOfMk(t.counterpartKeyAgreement)
  const key = await messageKeyOf(await ecdh(own.x.priv, peer), own.anchor, t.counterpartAnchor)
  const doc = { id, type: MESSAGE_TYPE, issuer: own.anchor, recipient: t.counterpartAnchor, threadId, issuedAt: iso(when), payload: { body, proof: { mac: await messageMac(key, body) } } }
  return { doc, envelope: await seal(doc, t.counterpartKeyAgreement), digest: await digestDoc(doc) }
}

const inboxTexts = async (P) => (await P.h.inbox()).map((m) => m.text)

test('message: A sends, B receives — the inbox entry with the body, sentAt, receivedAt and the display time; the ack in MAC form commits with it; A sees delivered; takeMessages empties the inbox and the record stays (RLTP-MSG-4210, 4310, 4350, 4410, 4420; 3210)', async () => {
  const A = await communityPerson(0x31), B = await communityPerson(0x32)
  const { a, b } = await met(A, B)
  assert.equal((await A.h.contact(a.id)).canMessage, true, 'the tuple is ready after the encounter (5.1)')
  const sent = await A.h.sendMessage(a.id, 'See you at the stall.', opts(T0 + 10_000_500))
  assert.equal(sent.ok, true, JSON.stringify(sent))
  const [o] = sent.outbound
  assert.equal(o.type, MESSAGE_TYPE)
  const [e] = ev(sent, 'message.sent')
  assert.deepEqual([e.contactId, e.digest], [a.id, o.digest])
  const doc = await openMsg(B, o.envelope)
  assert.equal(doc.payload.body.sentAt, iso(T0 + 10_000_000), 'whole seconds (3030)')
  assert.equal(doc.proof, undefined, 'no document proof (2020)')
  const got = await B.h.receive(o.envelope, T0 + 10_001_000)
  assert.equal(got.disposition, 'unique', JSON.stringify(got))
  assert.deepEqual(got.outbound.map((x) => x.type), [ACK])
  assert.equal((await openMsg(A, got.outbound[0].envelope)).proof.mac !== undefined, true, 'the designated-verifier ack (4.4)')
  const [rx] = ev(got, 'message.received')
  assert.equal(rx.contactId, b.id)
  const [m] = await B.h.inbox()
  assert.deepEqual([m.id, m.contactId, m.text, m.sentAt, m.receivedAt, m.displayAt, m.blocked], [rx.inboxId, b.id, 'See you at the stall.', T0 + 10_000_000, T0 + 10_001_000, T0 + 10_000_000, false])
  await A.h.receive(got.outbound[0].envelope, T0 + 10_002_000)
  assert.equal((await A.h.deliveryStatus(o.digest)).items[0].status, 'delivered')
  // the app took it over: it leaves the inbox; the record stays (4350), a replay has no new effect
  assert.equal((await B.h.takeMessages([m.id, 'unknown'], { when: T0 + 10_003_000 })).ok, true)
  assert.deepEqual(await B.h.inbox(), [])
  const s = await B.read()
  assert.ok(Object.values(s.messages.records).some((r) => Object.hasOwn(r, doc.payload.body.mid)))
  const dup = await B.h.receive(o.envelope, T0 + 10_004_000)
  assert.equal(dup.disposition, 'duplicate-known')
  assert.deepEqual(await B.h.inbox(), [])
})

test('message: the display time is min(sentAt, receivedAt) and the inbox orders by it, then mid; a sender clock a day ahead is accepted, more is refused (RLTP-MSG-4410, 4430, 4050)', async () => {
  const A = await communityPerson(0x33), B = await communityPerson(0x34)
  const { a } = await met(A, B)
  const t = T0 + 10_000_000
  const ahead = await A.h.sendMessage(a.id, 'from the future', opts(t + DAY))          // A's clock a day ahead
  const early = await A.h.sendMessage(a.id, 'early', opts(t + DAY + 1000))
  const r1 = await B.h.receive(ahead.outbound[0].envelope, t)
  assert.equal(r1.disposition, 'unique', 'exactly one day ahead: accepted')
  const r2 = await B.h.receive(early.outbound[0].envelope, t)
  assert.deepEqual([r2.disposition, r2.reason, r2.stage, r2.ref], ['failed', 'validation-failed', 9, 'RLTP-MSG-4050'])
  const late = await A.h.sendMessage(a.id, 'late', opts(t - 5000))   // A raised to its lastWhen: sentAt = t + DAY + 1 s; B now later
  const r3 = await B.h.receive(late.outbound[0].envelope, t + 2 * DAY)
  assert.equal(r3.disposition, 'unique')
  const inbox = await B.h.inbox()
  assert.deepEqual(inbox.map((m) => m.text), ['from the future', 'late'])
  assert.equal(inbox[0].displayAt, t, 'min(sentAt, receivedAt): a clock ahead cannot push a message above later ones')
})

test('message: readiness — a tuple on which no document of the counterpart was accepted refuses the send as not-ready; the first accepted document of the counterpart makes it ready (RLTP-MSG-5020, 5.1)', async () => {
  const { pair, noteModule } = await import('./pair-fixture.mjs')
  const { holderA, holderB, storeA, storeB } = await pair()
  assert.equal((await holderA.contact('c1')).canMessage, false)
  assert.deepEqual(await holderA.sendMessage('c1', 'hello', opts(T0 + 1000)), { ok: false, code: 'not-ready', ref: 'RLTP-MSG-5020' })
  void noteModule
  const note = await holderB.act('note.send', { text: 'hi' }, T0 + 2000)
  const got = await holderA.receive(note.outbound[0].envelope, T0 + 3000)
  assert.equal(got.disposition, 'unique')
  assert.deepEqual((await storeA.read()).state.messages.ready, [(await storeA.read()).state.relationships.r1.activeHead])
  assert.equal((await holderA.contact('c1')).canMessage, true)
  const sent = await holderA.sendMessage('c1', 'hello', opts(T0 + 4000))
  assert.equal(sent.ok, true, JSON.stringify(sent))
  // B has accepted nothing of A's yet: its own send is still refused, but A's message arrives
  assert.equal((await holderB.receive(sent.outbound[0].envelope, T0 + 5000)).disposition, 'unique')
  assert.equal((await holderB.contact('c1')).canMessage, true, 'A\'s message made B\'s tuple ready')
  void storeB
})

test('message: the send refuses a blocked contact, an unknown one, and a text outside 1 to 4096 code points or a replyTo that is no UUID v4 (RLTP-MSG-5030, 6410, 3020)', async () => {
  const A = await communityPerson(0x35), B = await communityPerson(0x36)
  const { a } = await met(A, B)
  assert.deepEqual(await A.h.sendMessage(a.id, '', opts(T0 + 10_000_000)), { ok: false, code: 'message-invalid', ref: 'RLTP-MSG-3020' })
  assert.deepEqual(await A.h.sendMessage(a.id, '🌱'.repeat(4097), opts(T0 + 10_000_001)), { ok: false, code: 'message-invalid', ref: 'RLTP-MSG-3020' })
  assert.equal((await A.h.sendMessage(a.id, '🌱'.repeat(4096), opts(T0 + 10_000_002))).ok, true, '4096 code points, more UTF-16 units')
  assert.deepEqual(await A.h.sendMessage(a.id, 'x', opts(T0 + 10_000_003, { replyTo: 'NOT-A-UUID' })), { ok: false, code: 'message-invalid', ref: 'RLTP-MSG-3020' })
  assert.deepEqual(await A.h.sendMessage('nobody', 'x', opts(T0 + 10_000_004)), { ok: false, code: 'unknown-contact' })
  assert.equal((await A.h.block(a.id, opts(T0 + 10_000_005))).ok, true)
  assert.equal((await A.h.contact(a.id)).canMessage, false)
  assert.deepEqual(await A.h.sendMessage(a.id, 'x', opts(T0 + 10_000_006)), { ok: false, code: 'blocked', ref: 'RLTP-MSG-5030' })
})

test('message: the completion record — a re-wrapped body is no new effect with a fresh ack, a different body under a known mid is validation-failed, a replay after the cache is gone finds the record (RLTP-MSG-4320, 4330; Delivery 4.2)', async () => {
  const A = await communityPerson(0x37), B = await communityPerson(0x38)
  const { a } = await met(A, B)
  const t = T0 + 10_000_000
  const sent = await A.h.sendMessage(a.id, 'original', opts(t))
  const doc = await openMsg(B, sent.outbound[0].envelope)
  assert.equal((await B.h.receive(sent.outbound[0].envelope, t + 1000)).disposition, 'unique')
  // re-wrap: the same body in a fresh document
  const rewrap = await craft(A, a.id, doc.payload.body, { when: t + 2000 })
  const r1 = await B.h.receive(rewrap.envelope, t + 2000)
  assert.equal(r1.disposition, 'unique', 'a fresh document: its own cache entry and ack')
  assert.deepEqual(r1.events, [], 'no new effect')
  assert.deepEqual(r1.outbound.map((x) => x.type), [ACK])
  assert.deepEqual(await inboxTexts(B), ['original'])
  // equivocation: another body under the mid
  const eq = await craft(A, a.id, { ...doc.payload.body, text: 'changed' }, { when: t + 3000 })
  const r2 = await B.h.receive(eq.envelope, t + 3000)
  assert.deepEqual([r2.disposition, r2.reason, r2.ref], ['failed', 'validation-failed', 'RLTP-MSG-4330'])
  // the cache gone (P90D), the record not (H = P180D): a replay is no new effect
  await B.h.tick(t + 100 * DAY)
  const r3 = await B.h.receive(sent.outbound[0].envelope, t + 100 * DAY + 1)
  assert.equal(r3.disposition, 'unique')
  assert.deepEqual(r3.events, [])
  assert.deepEqual(await inboxTexts(B), ['original'])
})

test('message: the age bound and the mark — at sentAt + H the message is still accepted, after it failed(stale-issuance) in stage 9; after the record is deleted a clock set back still refuses it (RLTP-MSG-4040, 4060, 4340)', async () => {
  const A = await communityPerson(0x39), B = await communityPerson(0x3a)
  const { a } = await met(A, B)
  const t = T0 + 10_000_000
  const m1 = await A.h.sendMessage(a.id, 'one', opts(t))
  const m2 = await A.h.sendMessage(a.id, 'two', opts(t))
  const r1 = await B.h.receive(m1.outbound[0].envelope, t + H)
  assert.equal(r1.disposition, 'unique', 'sentAt + H is not before t_ref')
  const r2 = await B.h.receive(m2.outbound[0].envelope, t + H + 1)
  assert.deepEqual([r2.disposition, r2.reason, r2.stage, r2.ref], ['failed', 'stale-issuance', 9, 'RLTP-MSG-4040'])
  // the record of m1 leaves only after sentAt + H (4340), at the deadline tick announces
  const label = Object.keys((await B.read()).messages.records)[0]
  const res = await B.h.resume(t + H + 2)
  assert.ok(res.nextDueAt !== undefined)
  await B.h.tick(t + H + 2)
  assert.deepEqual((await B.read()).messages.records[label] ?? {}, {}, 'deleted, the mark raised with it')
  // the clock set back: t_ref is the mark, never lower (4060) — a re-wrap
  // of m1 (its own envelope is still cached, a duplicate)
  const doc1 = await openMsg(B, m1.outbound[0].envelope)
  const rewrap = await craft(A, a.id, doc1.payload.body, { when: t + 10 })
  const r3 = await B.h.receive(rewrap.envelope, t + 10)
  assert.deepEqual([r3.disposition, r3.reason, r3.ref], ['failed', 'stale-issuance', 'RLTP-MSG-4040'])
  assert.equal((await B.h.receive(m1.outbound[0].envelope, t + 10)).disposition, 'duplicate-known', 'the cached copy is a duplicate (Delivery 4.2)')
  assert.equal((await B.h.inbox()).length, 1, 'one inbox entry in total')
})

test('message: the block discards — the record, the cache entry and the ack, no inbox entry, no event; unblocking surfaces nothing and a replay finds the record (RLTP-MSG-6210, 6220, 6510; RLTP-DEL-6240, 6260)', async () => {
  const A = await communityPerson(0x3b), B = await communityPerson(0x3c)
  const { a, b } = await met(A, B)
  assert.equal((await B.h.block(b.id, opts(T0 + 9_000_000))).ok, true)
  const sent = await A.h.sendMessage(a.id, 'can you hear me', opts(T0 + 10_000_000))
  const got = await B.h.receive(sent.outbound[0].envelope, T0 + 10_001_000)
  assert.equal(got.disposition, 'unique')
  assert.deepEqual(got.events, [])
  assert.deepEqual(got.outbound.map((x) => x.type), [ACK], 'the blocked sender sees the ack as before')
  assert.deepEqual(await B.h.inbox(), [])
  assert.equal(Object.values((await B.read()).messages.records).reduce((n, r) => n + Object.keys(r).length, 0), 1)
  assert.equal((await B.h.unblock(b.id, opts(T0 + 10_002_000))).ok, true)
  assert.deepEqual(await B.h.inbox(), [], 'nothing reappears')
  const doc = await openMsg(B, sent.outbound[0].envelope)
  const again = await craft(A, a.id, doc.payload.body, { when: T0 + 10_003_000 })
  const r = await B.h.receive(again.envelope, T0 + 10_003_000)
  assert.deepEqual([r.disposition, r.events], ['unique', []])
  assert.deepEqual(await B.h.inbox(), [], 'the record answers the replay after the unblock')
})

/** Edit a holder's stored state by hand (CAS on its version). */
async function edit (P, fn) {
  const { state, version } = await P.store.read()
  const s = structuredClone(state); fn(s)
  assert.equal((await P.store.commit(version, s)).ok, true)
}

test('message: the bounds — the 501st new document digest of a relationship in 24 h and a message beyond 2000 inbox entries are failed(rate-limited) at stage 8, nothing committed; counted before the block, the inbox bound under it too; evaluated afresh after the window (RLTP-MSG-4110, 4120, 4130, 4140; RLTP-DEL-5820, 6270, 6280)', async () => {
  const A = await communityPerson(0x3d), B = await communityPerson(0x3e)
  const { a, b } = await met(A, B)
  const t = T0 + 10_000_000
  const relId = (await B.h.contact(b.id)).relationships[0].id
  // 500 acceptances inside the window
  await edit(B, (s) => { s.messages.rates[relId] = { invites: [], messages: Array.from({ length: 500 }, (_, i) => t - 500 + i) } })
  const m = await A.h.sendMessage(a.id, 'one too many', opts(t))
  const before = await B.store.read()
  const r = await B.h.receive(m.outbound[0].envelope, t + 1000)
  assert.deepEqual([r.disposition, r.reason, r.stage, r.ref], ['failed', 'rate-limited', 8, 'RLTP-MSG-4110'])
  assert.equal((await B.store.read()).version, before.version, 'nothing committed, the mark included')
  // counted before the block: blocked, still refused
  assert.equal((await B.h.block(b.id, opts(t + 2000))).ok, true)
  assert.equal((await B.h.receive(m.outbound[0].envelope, t + 3000)).reason, 'rate-limited')
  assert.equal((await B.h.unblock(b.id, opts(t + 4000))).ok, true)
  // the window moved on: evaluated in full, accepted
  const later = await B.h.receive(m.outbound[0].envelope, t + 600)
  assert.equal(later.reason, 'rate-limited', 'not yet')
  const ok = await B.h.receive(m.outbound[0].envelope, t + DAY + 600)
  assert.equal(ok.disposition, 'unique', JSON.stringify(ok))
  // the inbox bound: 2000 entries of this relationship held
  const label = Object.values((await B.read()).messages.inbox)[0].tuple
  await edit(B, (s) => {
    s.messages.rates[relId].messages = []
    for (let i = 0; i < 1999; i++) s.messages.inbox['uFill' + i] = { id: 'uFill' + i, tuple: label, mid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, body: { type: 'message@1', text: 'x', sentAt: iso(t) }, receivedAt: t, displayAt: t }
  })
  const full = await A.h.sendMessage(a.id, 'inbox full', opts(t + DAY + 1000))
  const rf = await B.h.receive(full.outbound[0].envelope, t + DAY + 2000)
  assert.deepEqual([rf.disposition, rf.reason], ['failed', 'rate-limited'])
  // the bound is counted before the block (4130): blocked, the full inbox still refuses — the block is not observable here (review 111-1 #2)
  assert.equal((await B.h.block(b.id, opts(t + DAY + 3000))).ok, true)
  const rb = await B.h.receive(full.outbound[0].envelope, t + DAY + 4000)
  assert.deepEqual([rb.disposition, rb.reason], ['failed', 'rate-limited'])
  // once the app took entries over, the message passes the bound and the block discards it
  await B.h.takeMessages(['uFill0'], { when: t + DAY + 5000 })
  const ok2 = await B.h.receive(full.outbound[0].envelope, t + DAY + 6000)
  assert.deepEqual([ok2.disposition, ok2.events], ['unique', []])
  assert.equal(Object.keys((await B.read()).messages.inbox).length, 1999, 'discarded: no entry')
})

test('message (review 111-1 #1): the replay of a human act never hands out a document past its sender lifetime or the horizon, before any resume moved it (RLTP-MSG-5110; RLTP-DEL-6110, 6115)', async () => {
  const A = await communityPerson(0x46), B = await communityPerson(0x47)
  const { a } = await met(A, B)
  const t = T0 + 10_000_000
  const first = await A.h.sendMessage(a.id, 'once', { when: t, actId: 'same-act' })
  assert.equal(first.outbound.length, 1)
  const early = await A.h.sendMessage(a.id, 'once', { when: t + 1000, actId: 'same-act' })
  assert.deepEqual(early.outbound.map((o) => o.digest), [first.outbound[0].digest], 'replayed while live')
  const pastHorizon = await A.h.sendMessage(a.id, 'once', { when: t + 8 * DAY, actId: 'same-act' })
  assert.equal(pastHorizon.ok, true)
  assert.deepEqual(pastHorizon.outbound, [], 'past the horizon: not handed out')
  // the give-up committed: failed, the mark raised — a replay with the clock set back hands out nothing either (review 111-2 #1)
  const st = (await A.h.deliveryStatus(first.outbound[0].digest)).items[0]
  assert.deepEqual([st.status, st.reason], ['failed', 'expired-by-adapter-policy'])
  assert.ok((await A.read()).lastWhen >= t + 8 * DAY)
  const back = await A.h.sendMessage(a.id, 'once', { when: t + 1000, actId: 'same-act' })
  assert.deepEqual(back.outbound, [], 'never again (6115)')
  const pastLife = await A.h.sendMessage(a.id, 'once', { when: t + H, actId: 'same-act' })
  assert.deepEqual(pastLife.outbound, [], 'past the lifetime: not handed out (6115)')
})

test('engine (review 111-2 #1): a replay that finds a document past its declared lifetime moves it to failed(task-expired) in a commit of its own, announced once, and never hands it out again, the clock set back included (RLTP-DEL-6110, 6115)', async () => {
  const { pair, noteModule } = await import('./pair-fixture.mjs')
  const lifeModule = () => {
    const m = noteModule()
    const send = m.commands['note.send']
    return { ...m, commands: { 'note.send': { ...send, human: true, apply (state, p, input, when) { const r = send.apply(state, p, input, when); return { ...r, outbound: r.outbound.map((o) => ({ ...o, expiresAt: when + 60_000 })) } } } } }
  }
  const { holderA } = await pair({ modules: () => [lifeModule()] })
  const seen = []
  holderA.subscribe((c) => seen.push(...c.events))
  const first = await holderA.act('note.send', { text: 'short' }, T0, { actId: 'n1' })
  const d = first.outbound[0].digest
  const r1 = await holderA.act('note.send', { text: 'short' }, T0 + 60_000, { actId: 'n1' })
  assert.deepEqual(r1.outbound, [])
  const st = (await holderA.deliveryStatus(d)).items[0]
  assert.deepEqual([st.status, st.reason], ['failed', 'task-expired'], 'persisted')
  assert.deepEqual(seen.filter((e) => e.type === 'delivery.status').map((e) => e.status), ['failed'], 'announced once')
  const r2 = await holderA.act('note.send', { text: 'short' }, T0 + 1000, { actId: 'n1' })
  assert.deepEqual(r2.outbound, [], 'the clock set back: never again')
  assert.deepEqual((await holderA.resume(T0 + 120_000)).outbound, [])
})

test('message (review 111-1 #3): a verified delivery-ack of the counterpart makes the tuple ready, like any accepted document of it (RLTP-MSG-5020, 5.1)', async () => {
  const { pair } = await import('./pair-fixture.mjs')
  const { holderA, holderB } = await pair()
  const note = await holderA.act('note.send', { text: 'hi' }, T0)
  const got = await holderB.receive(note.outbound[0].envelope, T0 + 1)
  assert.equal((await holderA.contact('c1')).canMessage, false)
  const ack = await holderA.receive(got.outbound[0].envelope, T0 + 2)
  assert.equal(ack.disposition, 'unique')
  assert.equal((await holderA.contact('c1')).canMessage, true, 'the ack was accepted on the tuple: ready')
})

test('message: the sender gives up — with the longest retry horizon P90D before its lifetime sentAt + H − P1D, failed(expired-by-adapter-policy); a late valid ack still delivers it (RLTP-MSG-5110; RLTP-DEL-6110, 7020)', async () => {
  const A = await communityPerson(0x41), B = await communityPerson(0x42)
  const { a } = await met(A, B)
  const t = T0 + 10_000_000
  const sent = await A.h.sendMessage(a.id, 'lost', opts(t))
  const item = (await A.read()).outbox[sent.outbound[0].digest]
  assert.equal(item.expiresAt, t + H - DAY, 'the declared sender lifetime (7020)')
  await A.h.resume(t + 8 * DAY)
  const st = (await A.h.deliveryStatus(sent.outbound[0].digest)).items[0]
  assert.deepEqual([st.status, st.reason], ['failed', 'expired-by-adapter-policy'], 'the default horizon P7D ends first')
  const got = await B.h.receive(sent.outbound[0].envelope, t + 9 * DAY)
  await A.h.receive(got.outbound[0].envelope, t + 9 * DAY + 1)
  const late = (await A.h.deliveryStatus(sent.outbound[0].digest)).items[0]
  assert.deepEqual([late.status, late.late], ['delivered', true])
})

test('engine: a sender lifetime a type declares ends the item as failed(task-expired) before the horizon, never handed out again; a late valid ack delivers it (RLTP-DEL-6110, 6115)', async () => {
  const { pair, noteModule, NOTE } = await import('./pair-fixture.mjs')
  const lifeModule = () => {
    const m = noteModule()
    const send = m.commands['note.send']
    return { ...m, name: 'note', commands: { 'note.send': { ...send, apply (state, p, input, when) { const r = send.apply(state, p, input, when); return { ...r, outbound: r.outbound.map((o) => ({ ...o, expiresAt: when + 60_000 })) } } } } }
  }
  const { holderA, holderB } = await pair({ modules: () => [lifeModule()] })
  const sent = await holderA.act('note.send', { text: 'short-lived' }, T0)
  const d = sent.outbound[0].digest
  const r1 = await holderA.resume(T0 + 30_000)
  assert.deepEqual(r1.outbound.map((o) => o.digest), [d], 'retried while alive')
  assert.ok(r1.nextDueAt <= T0 + 60_000)
  const r2 = await holderA.resume(T0 + 60_000)
  assert.deepEqual(r2.outbound, [], 'never handed out after its lifetime (6115)')
  assert.deepEqual(r2.events.map((e) => [e.type, e.status]), [['delivery.status', 'failed']])
  const st = (await holderA.deliveryStatus(d)).items[0]
  assert.deepEqual([st.status, st.reason], ['failed', 'task-expired'])
  assert.deepEqual((await holderA.resume(T0 + 120_000)).outbound, [])
  const got = await holderB.receive(sent.outbound[0].envelope, T0 + 130_000)
  await holderA.receive(got.outbound[0].envelope, T0 + 131_000)
  const late = (await holderA.deliveryStatus(d)).items[0]
  assert.deepEqual([late.status, late.late], ['delivered', true], 'a late valid ack transitions it (6.1)')
  void NOTE
})

test('message: readiness after an introduction — the target opens its tuple at consent and the requester at the accepted reply; each can message once a document of the other was accepted on it (RLTP-MSG-5010, 5020; 3.3 both doors give the same key)', async () => {
  const M = await communityPerson(0x43), R = await communityPerson(0x44), Tt = await communityPerson(0x45)
  const mr = await met(R, M, T0)
  const mt = await met(Tt, M, T0 + 10_000)
  const intro = await M.h.introduce(mr.b.id, mt.b.id, opts(T0 + 20_000, { label: 'Tia' }))
  const all = [M, R, Tt]
  await settle(all, intro.outbound, T0 + 21_000)
  const [po] = await R.h.prompts()
  await settle(all, (await R.h.decide(po.id, 'accept', opts(T0 + 22_000))).outbound, T0 + 23_000)
  const [pt] = await Tt.h.prompts()
  await settle(all, (await Tt.h.decide(pt.id, 'accept', opts(T0 + 24_000))).outbound, T0 + 25_000)
  await settle(all, [], T0 + 60_000)
  const introduced = async (P) => (await P.h.contacts()).find((c) => c.provenance === 'introduced')
  const rt = await introduced(R), tr = await introduced(Tt)
  assert.ok(rt && tr, 'the introduced relationship on both sides')
  assert.equal(rt.canMessage, true, 'the requester\'s tuple: the target\'s continuity probe accepted')
  assert.equal(tr.canMessage, true, 'the target\'s tuple: the requester\'s accepted')
  const m = await R.h.sendMessage(rt.id, 'nice to meet you', opts(T0 + 70_000))
  assert.equal(m.ok, true, JSON.stringify(m))
  const got = await settle(all, m.outbound, T0 + 71_000)
  assert.ok(got.some((x) => x.o.type === MESSAGE_TYPE && x.got.disposition === 'unique'))
  assert.deepEqual((await Tt.h.inbox()).map((x) => [x.text, x.contactId]), [['nice to meet you', tr.id]])
})

test('engine (review 111-3 #2): the give-up a replay runs names the timer work it opened — a failure handler\'s duty due later is the replay\'s nextDueAt', async () => {
  const { pair, noteModule } = await import('./pair-fixture.mjs')
  const mod = () => {
    const m = noteModule({}, { onFailed: (state, ref, when) => ({ state, duties: [{ kind: 'note-retry', v: 1, id: 'retry:' + ref, dueAt: when + 1234 }] }) })
    const send = m.commands['note.send']
    return {
      ...m,
      duties: { 'note-retry': { v: 1, apply: () => 'not-due' } },
      commands: { 'note.send': { ...send, human: true, apply (state, p, input, when) { const r = send.apply(state, p, input, when); return { ...r, outbound: r.outbound.map((o) => ({ ...o, expiresAt: when + 60_000 })) } } } },
    }
  }
  const { holderA, storeA } = await pair({ modules: () => [mod()] })
  await holderA.act('note.send', { text: 'short' }, T0, { actId: 'n2' })
  const r = await holderA.act('note.send', { text: 'short' }, T0 + 60_000, { actId: 'n2' })
  assert.deepEqual(r.outbound, [])
  assert.equal(r.nextDueAt, T0 + 60_000 + 1234, 'the failure handler\'s duty is announced')
  assert.ok(Object.values((await storeA.read()).state.duties).some((d) => d.kind === 'note-retry'))
})

test('engine (review 111-4): with commitAttempts 1 the replay\'s give-up and its re-read still answer — the journal\'s result, the give-up committed once, its timer', async () => {
  const { pair, noteModule } = await import('./pair-fixture.mjs')
  const mod = () => {
    const m = noteModule()
    const send = m.commands['note.send']
    return { ...m, commands: { 'note.send': { ...send, human: true, apply (state, p, input, when) { const r = send.apply(state, p, input, when); return { ...r, outbound: r.outbound.map((o) => ({ ...o, expiresAt: when + 60_000 })) } } } } }
  }
  const { holderA } = await pair({ modules: () => [mod()], retry: { commitAttempts: 1 } })
  const seen = []
  holderA.subscribe((c) => seen.push(...c.events))
  const first = await holderA.act('note.send', { text: 'one try' }, T0, { actId: 'n3' })
  const r = await holderA.act('note.send', { text: 'one try' }, T0 + 60_000, { actId: 'n3' })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.deepEqual(r.outbound, [])
  const st = (await holderA.deliveryStatus(first.outbound[0].digest)).items[0]
  assert.deepEqual([st.status, st.reason], ['failed', 'task-expired'])
  assert.equal(seen.filter((e) => e.type === 'delivery.status').length, 1)
})

test('engine (review 111-5): with commitAttempts 1 a replay whose documents fall due one after the other — the mark raised past the second by a tick of another engine in between — still answers', async () => {
  const { pair, noteModule } = await import('./pair-fixture.mjs')
  const { createHolder: mk } = await import('../dist/index.js')
  const twice = () => {
    const m = noteModule()
    const send = m.commands['note.send']
    return {
      ...m,
      commands: {
        'note.send': {
          human: true,
          async prepare (ctx, input) { return [await send.prepare(ctx, input), await send.prepare(ctx, input)] },
          apply (state, p, input, when) {
            const out = p.value.map((v, i) => ({ digest: v.digest, envelope: v.envelope, type: v.type, threadId: v.threadId, recipient: { contactId: v.contactId, rkid: v.rkid, keyAgreement: v.keyAgreement }, expiresAt: when + 60_000 * (i + 1) }))
            return { state, outbound: out }
          },
        },
      },
    }
  }
  const { holderA, storeA, A } = await pair({ modules: () => [twice()], retry: { commitAttempts: 1 } })
  const other = await mk({ store: storeA, keys: A.keys, retry: { commitAttempts: 1 } }, { modules: [twice()] })
  const first = await holderA.act('note.send', { text: 'two' }, T0, { actId: 'n4' })
  assert.equal(first.outbound.length, 2)
  // the other engine gives the second up between the replay's give-up of the first and its re-read
  const realCommit = storeA.commit.bind(storeA)
  let n = 0
  storeA.commit = async (v, next) => {
    const r = await realCommit(v, next)
    if (r.ok && ++n === 1) { storeA.commit = realCommit; await other.tick(T0 + 120_000) }
    return r
  }
  const r = await holderA.act('note.send', { text: 'two' }, T0 + 60_000, { actId: 'n4' })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.deepEqual(r.outbound, [])
  for (const o of first.outbound) assert.equal((await holderA.deliveryStatus(o.digest)).items[0].status, 'failed')
})

test('message (CodeRabbit on #110): blocked on the fresh relationship of a re-encounter, then chained — a message over the chain is discarded and acknowledged (RLTP-MSG-6030, 6210, 6220)', async () => {
  const { scanned } = await import('./holder-fixture.mjs')
  const A = await communityPerson(0x48), B = await communityPerson(0x49)
  const { a } = await met(A, B)
  const { bundle } = await scanned(A, B, T0 + 100_000)
  const got = await B.h.receive(bundle.envelope, T0 + 102_000)
  const fresh = ev(got, 'contact.added')[0].contactId
  assert.equal((await B.h.block(fresh, opts(T0 + 102_500))).ok, true)
  const prompt = (await B.h.prompts()).find((p) => p.kind === 'encounter-confirm')
  await settle([A, B], [...got.outbound, ...(await B.h.decide(prompt.id, 'accept', opts(T0 + 103_000))).outbound], T0 + 104_000)
  assert.ok(Object.values((await B.read()).relationships).some((r) => r.chainedInto !== null), 'chained')
  const m = await A.h.sendMessage(a.id, 'after the chaining', opts(T0 + 10_000_000))
  assert.equal(m.ok, true, JSON.stringify(m))
  const r = await B.h.receive(m.outbound[0].envelope, T0 + 10_001_000)
  assert.deepEqual([r.disposition, r.events], ['unique', []])
  assert.deepEqual(r.outbound.map((o) => o.type), [ACK], 'acknowledged')
  assert.deepEqual(await B.h.inbox(), [], 'discarded')
})
