#!/usr/bin/env node
// introduce-test — the Jonathan/Anton/Emil script as executable assertions,
// on the holder (Trust Layer 0.31 §8): Anton's one act (the offer to
// Jonathan), Jonathan's request, Anton's forward, Emil's consent, the reply
// relayed back, the vouchers, and an introduced relationship on both sides
// under fresh anchors Anton never holds.
//
// CHANGED in lib Stage 2 (PR 7b): the scenario "mediator in airplane mode"
// (the probe's rendezvous drop: the parties fetched each other's cards from
// a drop while the mediator stayed offline) is now "mediator offline: the
// act waits until the mediator is back and relays". Trust §8 relays the act
// through the mediator; there is no rendezvous drop any more, so the request
// waits in transit while Anton is away, and his device forwards it when it
// is back. Away past the requester's ack window (8690), the act fails.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeValidator } from './rltp-core.mjs'
import { createPerson, createNetwork, meet, at, decideAll, TYPES } from './holder.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCHEMAS = {}
for (const f of ['contact-card-0.25.schema.json', 'contact-card.schema.json']) SCHEMAS[f] = JSON.parse(readFileSync(join(ROOT, 'schemas', f), 'utf8'))
const V = makeValidator(SCHEMAS)

let pass = 0, fail = 0
const check = (c, m) => { if (c) { pass++; console.log(`  ok    ${m}`) } else { fail++; console.error(`  FAIL  ${m}`) } }
const T0 = Date.parse('2026-08-25T15:00:00Z')
const MIN = 60_000

/** M has met R and T; M introduces R (the requester) to T (the target). */
async function triangle (names, t) {
  const [M, R, Tt] = await Promise.all(names.map((n) => createPerson(n, { when: t })))
  const net = createNetwork([M, R, Tt])
  const mr = await meet(net, R, M, t)              // R scans M's code
  const mt = await meet(net, Tt, M, t + 10_000)    // T scans M's code
  return { M, R, T: Tt, net, mr, mt }
}
const typesOf = (net, from) => net.wire.slice(from).map((w) => w.type)

// ── setup: Anton has met Jonathan and Emil (real ceremonies) ────────────
const { M: anton, R: jonathan, T: emil, net, mr, mt } = await triangle(['Anton', 'Jonathan', 'Emil'], T0)
check(anton.view.contacts.length === 2 && jonathan.view.contacts.length === 1 && emil.view.contacts.length === 1, 'setup: Anton holds both, each of them holds only Anton')
check(mr.atScanner.verification === 'mutual' && mt.atScanner.verification === 'mutual', 'both ceremonies are mutual (⇄ verified)')
check(![...emil.anchors.keys()].some((a) => jonathan.view.state && JSON.stringify(jonathan.view.state.relationships).includes(a)), 'Jonathan holds NO anchor of Emil (not connected)')

// ── Anton's ONE act: the offer to Jonathan ──────────────────────────────
const t1 = T0 + 5 * MIN
const act = await anton.h.introduce(mr.atDisplayer.id, mt.atDisplayer.id, at(t1, { label: 'Emil' }))
check(act.ok && act.outbound.map((o) => o.type).join() === [TYPES.declaration, TYPES.offer].join(), 'Anton\'s act: his ack-delay declaration and the offer, sealed to Jonathan')
await net.send(anton, act.outbound, t1)
await jonathan.refresh()
const [offerPrompt] = jonathan.view.prompts
check(offerPrompt?.kind === 'introduction' && offerPrompt.contactId === mr.atScanner.id, 'Jonathan: "Anton offers to introduce you to Emil" — a prompt on his Anton contact')

// ── mediator offline: the act waits until the mediator is back ──────────
await net.setOnline(anton, false, t1 + 1000)
const w0 = net.wire.length
const [req] = await decideAll(net, jonathan, 'introduction', 'accept', t1 + 2000)
check(req.ok && req.outbound.map((o) => o.type).join() === TYPES.request, 'Jonathan accepts: the introduction request with his fresh card goes toward Anton')
check(net.channel.transit.get('Anton')?.length === 1, 'Anton is offline: the request waits in transit at the relay')
check(!typesOf(net, w0).includes(TYPES.forward) && emil.view.prompts.length === 0, 'nothing reaches Emil while Anton is away — the act is relayed by the mediator, not by a drop')
const jAct = Object.values((await jonathan.read()).encounter.introductions)[0]
check(jAct.role === 'requester' && jAct.status === 'sent', 'Jonathan\'s act stands as sent')

const t2 = t1 + 3 * MIN    // back inside the requester's ack window (ack-delay + act-skew)
await net.setOnline(anton, true, t2)
check(typesOf(net, w0).includes(TYPES.forward), 'Anton back online: his device takes the request and forwards it to Emil')
await emil.refresh()
const [consentPrompt] = emil.view.prompts
check(consentPrompt?.kind === 'introduction' && consentPrompt.contactId === mt.atScanner.id, 'Emil: a consent prompt on his Anton contact')
const w1 = net.wire.length
await decideAll(net, emil, 'introduction', 'accept', t2 + 1000)
check(typesOf(net, w1).filter((t) => t === TYPES.reply).length === 2, 'Emil consents: the reply goes to Anton, who relays it to Jonathan')
check(typesOf(net, w1).filter((t) => t === TYPES.voucher).length === 2, 'Anton vouches toward both (introduction-voucher, act-bound)')
await net.settle(t2 + 1000 + 31_000)     // Anton's one ack at t_received + ack-delay
for (const p of [anton, jonathan, emil]) await p.refresh()

// ── the core claims ─────────────────────────────────────────────────────
const jc = jonathan.view.contacts.find((c) => c.provenance === 'introduced')
const ec = emil.view.contacts.find((c) => c.provenance === 'introduced')
check(jc?.displayName === 'Emil' && jc.via === mr.atScanner.id, 'Jonathan holds Emil: introduced via his Anton contact, under the label Anton typed')
check(ec?.displayName === 'Jonathan' && ec.via === mt.atScanner.id, 'Emil holds Jonathan: introduced via his Anton contact, under Jonathan\'s own display name')
const sJ = jonathan.view.state, sE = emil.view.state
const jAnchors = Object.values(sJ.relationships).flatMap((r) => r.tuples).map((t) => t.counterpartAnchor)
const eAnchors = Object.values(sE.relationships).flatMap((r) => r.tuples).map((t) => t.counterpartAnchor)
check(jAnchors.some((a) => emil.owns(a)) && eAnchors.some((a) => jonathan.owns(a)), 'the new relationship: each holds a fresh anchor of the other')
const antonHolds = Object.values(anton.view.state.relationships).flatMap((r) => r.tuples).map((t) => t.counterpartAnchor)
check(!jAnchors.filter((a) => emil.owns(a)).some((a) => antonHolds.includes(a)) && !eAnchors.filter((a) => jonathan.owns(a)).some((a) => antonHolds.includes(a)), 'the crossed anchors are fresh — Anton holds neither (nothing was transferred)')
const intros = (p) => Object.values(p.view.state.encounter.introductions)
check(intros(jonathan)[0].status === 'completed' && intros(jonathan)[0].vouched, 'Jonathan\'s act: completed, the voucher verified (the evidence behind the introduced contact)')
check(intros(emil)[0].status === 'consented' && intros(emil)[0].vouched, 'Emil\'s act: consented, vouched')
check(intros(anton).find((a) => a.role === 'mediator')?.status === 'completed', 'Anton\'s act completed only after his ack went out')
const card = intros(emil)[0].requestCard
check(V.validate(card, SCHEMAS['contact-card-0.25.schema.json'], SCHEMAS['contact-card-0.25.schema.json']).length === 0, 'the card Jonathan sent is schema-valid (0.25 card form)')
check(jc.trust.given === false && ec.trust.given === false, 'an introduction discloses nothing: no trust given on either side')

// ── refusal is local and silent ─────────────────────────────────────────
{
  const { M, R, T: Tt, net: n2, mr: r1, mt: r2 } = await triangle(['Mia', 'Rolf', 'Ida'], T0)
  const a = await M.h.introduce(r1.atDisplayer.id, r2.atDisplayer.id, at(T0 + MIN, { label: 'Ida' }))
  await n2.send(M, a.outbound, T0 + MIN)
  await decideAll(n2, R, 'introduction', 'accept', T0 + MIN + 1000)
  const w = n2.wire.length
  await decideAll(n2, Tt, 'introduction', 'decline', T0 + MIN + 2000)
  check(n2.wire.length === w, 'Ida declines: nothing leaves her device')
  await n2.settle(T0 + MIN + 40_000)
  check(Object.values(R.view.state.encounter.introductions)[0].status === 'acked', 'Rolf still gets the one uniform ack at the declared delay — refusal and silence look alike (8650)')
  check(!R.view.contacts.some((c) => c.provenance === 'introduced') && !Tt.view.contacts.some((c) => c.provenance === 'introduced'), 'no relationship on either side')
  await R.h.tick(T0 + MIN + 1000 + 72 * 3600_000 + 1000); await R.refresh()
  check(Object.values(R.view.state.encounter.introductions)[0].status === 'failed', 'Rolf\'s act fails on the reply timeout (8340)')
}

// ── a mediator away past the requester's ack window ─────────────────────
{
  const { M, R, net: n3, mr: r1, mt: r2 } = await triangle(['Max', 'Anna', 'Bert'], T0)
  const a = await M.h.introduce(r1.atDisplayer.id, r2.atDisplayer.id, at(T0 + MIN))
  await n3.send(M, a.outbound, T0 + MIN)
  await n3.setOnline(M, false, T0 + MIN)
  await decideAll(n3, R, 'introduction', 'accept', T0 + MIN + 1000)
  await n3.settle(T0 + 20 * MIN)          // Max still offline
  check(Object.values(R.view.state.encounter.introductions)[0].status === 'failed', 'no ack within ack-delay + act-skew: Anna\'s act fails (8690)')
  await n3.setOnline(M, true, T0 + 21 * MIN)
  await n3.settle(T0 + 21 * MIN)
  check(!R.view.contacts.some((c) => c.provenance === 'introduced'), 'the late relay changes nothing at Anna: a failed act stays failed (8350)')
}

// ── a chain introduction: an introduced contact can be introduced on ────
{
  const { M, R: U, T: Vv, net: n4, mr: r1, mt: r2 } = await triangle(['Mira', 'Udo', 'Vera'], T0)
  const a = await M.h.introduce(r1.atDisplayer.id, r2.atDisplayer.id, at(T0 + MIN, { label: 'Vera' }))
  await n4.send(M, a.outbound, T0 + MIN)
  await decideAll(n4, U, 'introduction', 'accept', T0 + MIN + 1000)
  await decideAll(n4, Vv, 'introduction', 'accept', T0 + MIN + 2000)
  await n4.settle(T0 + 2 * MIN)
  const W = n4.add(await createPerson('Wim', { when: T0 }))
  const uw = await meet(n4, W, U, T0 + 3 * MIN)
  const veraAtUdo = U.view.contacts.find((c) => c.provenance === 'introduced')
  const i2 = await U.h.introduce(uw.atDisplayer.id, veraAtUdo.id, at(T0 + 4 * MIN, { label: 'Vera' }))
  check(i2.ok, 'Udo introduces Wim to Vera, whom he knows only by introduction: the act stands on his introduced relationship')
  await n4.send(U, i2.outbound, T0 + 4 * MIN)
  await decideAll(n4, W, 'introduction', 'accept', T0 + 4 * MIN + 1000)
  await decideAll(n4, Vv, 'introduction', 'accept', T0 + 4 * MIN + 2000)
  await n4.settle(T0 + 5 * MIN)
  const wv = W.view.contacts.find((c) => c.provenance === 'introduced')
  check(wv?.displayName === 'Vera' && wv.via === uw.atScanner.id, 'the chain stands: Wim holds Vera, introduced via Udo')
  check(wv.verification === 'met', 'an introduced contact carries no ceremony credential: never shown as verified')
  const unknown = await U.h.introduce('no-such-contact', veraAtUdo.id, at(T0 + 6 * MIN))
  check(!unknown.ok && unknown.code === 'no-own-channel', 'introducing someone without an own channel to them is refused (no-own-channel, 8020)')
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) { console.error('introduce: FAILED'); process.exit(1) }
console.log('introduce: the Jonathan/Anton/Emil scenario holds — the act waits for the mediator and is relayed by him.')
