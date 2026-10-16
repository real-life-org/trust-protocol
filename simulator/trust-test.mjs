#!/usr/bin/env node
// trust-test — Stage 2 on the holder: the trust act (the anchor mapping,
// designated verifier), the channel rule, the blinded star and the
// contacts it shows in common, deniability, the pause of 5.4, and vouch@2
// over the channel. Integration of encounter → introduction → trust →
// membership on createHolder.
import { createPerson, createNetwork, meet, at, decideAll, editState, eventOf, contactNamed, labeledContext, pairContext, diSign, digestDoc, seal, unseal, iso, TYPES, forgeMapping } from './holder.mjs'

let pass = 0, fail = 0
const check = (c, m) => { if (c) { pass++; console.log(`  ok    ${m}`) } else { fail++; console.error(`  FAIL  ${m}`) } }
const T0 = Date.parse('2026-08-27T10:00:00Z')
const MIN = 60_000

// ── a triangle from real ceremonies: A–B, A–C, B–C ──────────────────────
const anton = await createPerson('Anton', { when: T0 }), berta = await createPerson('Berta', { when: T0 }), carla = await createPerson('Carla', { when: T0 })
const net = createNetwork([anton, berta, carla])
await meet(net, anton, berta, T0)
await meet(net, anton, carla, T0 + MIN)
await meet(net, berta, carla, T0 + 2 * MIN)
const c = (p, name) => contactNamed(p.view.contacts, name)
const tupleOf = (p, contact) => p.view.state.relationships[contact.relationships[0].id].tuples.at(-1)
const communityAnchor = async (p) => (await p.keys.anchorOf('group/' + p.view.state.register.community.genesis)).anchor
const trustAct = async (from, to, t) => {
  const r = await from.h.trust(c(from, to.name).id, at(t))
  await net.settle(t + 1000)
  return r
}

// ── 1. the trust act: one-sided, verified, a one-way door ───────────────
{
  const w = net.wire.length
  const r = await trustAct(anton, berta, T0 + 10 * MIN)
  check(r.ok && eventOf(r, 'trust.given'), 'trust act Anton→Berta: committed, trust.given')
  check(net.wire.slice(w).filter((x) => x.type === TYPES.mapping && x.disp === 'unique').length === 1, 'the anchor mapping went out on resume, sealed on the channel, taken once')
  const bA = c(berta, 'Anton')
  check(bA.trust.received && !bA.trust.given, 'direction: Berta reads ← trusts you, nothing given back')
  check(tupleOf(berta, bA).mappingIn.self === await communityAnchor(anton), 'Berta holds Anton\'s stable (community) anchor — the mapping VERIFIED and taken')
  check(c(anton, 'Berta').trust.given && !c(anton, 'Berta').trust.pending, 'Anton: the one-way door is open, nothing pending')
  const again = await anton.h.trust(c(anton, 'Berta').id, at(T0 + 12 * MIN))
  check(!again.ok && again.code === 'already-given', 'a second act is refused: already-given')
}

// ── 2. the channel rule: an introduced relationship may carry trust ─────
const dora = net.add(await createPerson('Dora', { when: T0 }))
{
  const t = T0 + 20 * MIN
  await meet(net, dora, anton, t)
  const intro = await anton.h.introduce(c(anton, 'Berta').id, c(anton, 'Dora').id, at(t + MIN, { label: 'Dora' }))
  await net.send(anton, intro.outbound, t + MIN)
  await decideAll(net, berta, 'introduction', 'accept', t + MIN + 1000)
  await decideAll(net, dora, 'introduction', 'accept', t + MIN + 2000)
  await net.settle(t + MIN + 40_000)
  const bD = c(berta, 'Dora')
  check(bD?.provenance === 'introduced' && bD.verification === 'met', 'Berta holds Dora by introduction only: no ceremony, never shown as verified')
  const r = await trustAct(berta, dora, t + 2 * MIN)
  check(r.ok && c(dora, 'Berta')?.trust.received, 'introduced and both consented: the trust act is ALLOWED, the mapping verifies over the introduced channel — no ceremony credential needed')
  check(tupleOf(dora, c(dora, 'Berta')).mappingIn.self === await communityAnchor(berta), 'Dora holds Berta\'s stable anchor')
  const none = await berta.h.trust('no-such-contact', at(t + 3 * MIN))
  check(!none.ok && none.code === 'unknown-contact', 'no contact, no channel: the trust act is refused (unknown-contact)')
}

// ── 3. the star and contacts in common (blinded, recipient-private) ─────
{
  // B→A, C→A, C→B, B→C — then A holds B.self and C.self, and Carla holds
  // B.self (only by that can she compute the match)
  let t = T0 + 30 * MIN
  for (const [from, to] of [[berta, anton], [carla, anton], [carla, berta], [berta, carla]]) { await trustAct(from, to, t); t += MIN }
  // A→C: Anton's star to Carla carries (blinded) B.self; it follows the
  // mapping through the 5.4 reconciliation on resume
  await trustAct(anton, carla, T0 + 40 * MIN)
  await net.settle(T0 + 42 * MIN)
  const cA = c(carla, 'Anton')
  const star = tupleOf(carla, cA).starIn.accepted
  check(star && star.blinded.length >= 1, `Carla holds Anton's star: ${star?.blinded.length} blinded entries, no anchor in the clear`)
  const known = (star?.matches ?? []).map((id) => carla.view.contacts.find((x) => x.id === id || x.aliases.includes(id))?.displayName)
  check(known.includes('Berta'), 'contact in common recognised: Berta (only because Carla holds B.self legitimately)')
  check(!star.blinded.includes(await communityAnchor(berta)), 'no raw third-party anchor in the snapshot — everything blinded')
  const aB = tupleOf(anton, c(anton, 'Berta')).starIn.accepted
  check(aB && tupleOf(anton, c(anton, 'Carla')).starIn.accepted, 'Anton holds the stars of both — the reconciliation delivered')
  check((aB?.matches ?? []).map((id) => anton.view.contacts.find((x) => x.id === id)?.displayName).includes('Carla'), 'Anton\'s view of Berta: "you both know Carla"')
}

// ── 4. deniability: the addressee forges a mapping that verifies alike ──
{
  // Xaver met Yara and Zoe; Zoe trusted Yara, so Yara holds Zoe's self
  // card. Yara forges: Xaver's pair anchor ↦ ZOE's self, and feeds it to her
  // own holder on her Xaver relationship
  const t = T0 + 50 * MIN
  const [xa, ya, zo] = [await createPerson('Xaver', { when: T0 }), await createPerson('Yara', { when: T0 }), await createPerson('Zoe', { when: T0 })]
  const n2 = createNetwork([xa, ya, zo])
  await meet(n2, xa, ya, t)
  await meet(n2, zo, ya, t + MIN)
  await zo.h.trust(c(zo, 'Yara').id, at(t + 2 * MIN))
  await n2.settle(t + 3 * MIN)
  const tX = tupleOf(ya, c(ya, 'Xaver'))
  const zoeCard = tupleOf(ya, c(ya, 'Zoe')).mappingIn.card
  const own = await labeledContext(ya.seed, tX.ownPairLabel)
  const forged = await forgeMapping({ own, pair: tX.counterpartAnchor, pairKeyAgreement: tX.counterpartKeyAgreement, card: zoeCard, issuedAt: iso(t + 4 * MIN) })
  const doc = { id: crypto.randomUUID(), type: TYPES.mapping, issuer: tX.counterpartAnchor, recipient: own.anchor, threadId: crypto.randomUUID(), issuedAt: iso(t + 4 * MIN), payload: forged }
  // first a copy changed after its MACs were computed: they fail
  const tampered = { ...forged, body: { ...forged.body, revision: '2' } }
  const r2 = await ya.h.receive(await seal({ ...doc, id: crypto.randomUUID(), payload: tampered }, own.keyAgreement), t + 4 * MIN)
  check(r2.disposition === 'failed' && r2.stage === 8 && r2.ref === 'RLTP-TRU-6140', 'a manipulated body: the MAC check fails at stage 8 (6140)')
  const r = await ya.h.receive(await seal(doc, own.keyAgreement), t + 4 * MIN)
  check(r.disposition === 'unique', 'the FORGERY verifies like a real mapping and is taken: a leaked mapping proves nothing to third parties')
  await ya.refresh()
  check(c(ya, 'Xaver').trust.received && !c(xa, 'Yara').trust.given, 'Yara\'s own holder now reads "Xaver trusts you" — Xaver never acted')
}

// ── 5. the pause: the subscription stops, what was delivered stays ──────
{
  const t = T0 + 60 * MIN
  const p = await anton.h.pauseTrust(c(anton, 'Berta').id, true, at(t))
  check(p.ok && eventOf(p, 'trust.paused')?.paused === true, 'Anton pauses toward Berta: star and blinded group star off')
  const before = tupleOf(anton, c(anton, 'Berta')).starOut.hwm
  // a divergence arises during the pause: Dora trusts Anton
  await dora.h.trust(c(dora, 'Anton').id, at(t + 2 * MIN))
  const w = net.wire.length
  await net.settle(t + 3 * MIN)
  const toBerta = () => net.wire.slice(w).filter((x) => x.type === TYPES.star && x.from === 'Anton' && x.to === 'Berta')
  check(toBerta().length === 0, 'paused: no new star to Berta — the duty is suppressed, not violated (5.4)')
  check(tupleOf(anton, c(anton, 'Berta')).starOut.hwm === before, 'the sender\'s baseline unchanged — what was delivered stays, the new stops')
  check(net.wire.slice(w).some((x) => x.type === TYPES.star && x.from === 'Anton' && x.to === 'Carla'), 'Carla, not paused, gets the grown star')
  const w2 = net.wire.length
  await anton.h.pauseTrust(c(anton, 'Berta').id, false, at(t + 4 * MIN))
  await net.settle(t + 5 * MIN)
  check(net.wire.slice(w2).some((x) => x.type === TYPES.star && x.to === 'Berta' && x.disp === 'unique'), 'unpaused: the divergence is re-evaluated, the star flows again (5.4)')
  const w3 = net.wire.length
  await net.settle(t + 30 * MIN)
  check(!net.wire.slice(w3).some((x) => x.type === TYPES.star && x.to === 'Berta'), 'converged: no divergence, no delivery — reconciliation, not an event list')
}

// ── 6. vouch@2: the vouch, accept-bound, over the channel ───────────────
{
  const t = T0 + 120 * MIN
  const f = await berta.h.foundGroup({ name: 'Vouch circle' }, at(t))
  const groupId = eventOf(f, 'group.founded').groupId
  // Anton joins under the rule of one
  const i1 = await berta.h.invite(groupId, c(berta, 'Anton').id, at(t + MIN))
  await net.send(berta, i1.outbound, t + MIN)
  await decideAll(net, anton, 'group-invite', 'accept', t + 2 * MIN)
  await net.settle(t + 3 * MIN)
  check(berta.view.groups[0].members.length === 2, 'Anton admitted under the rule of one')
  // the group's rule becomes two (a policy change this library does not build)
  await editState(berta, (s) => { s.groups[groupId].rules.vouchThreshold = '2' })
  const i2 = await berta.h.invite(groupId, c(berta, 'Carla').id, at(t + 4 * MIN))
  await net.send(berta, i2.outbound, t + 4 * MIN)
  const w = net.wire.length
  await decideAll(net, carla, 'group-invite', 'accept', t + 5 * MIN)
  await net.settle(t + 6 * MIN)
  check(net.wire.slice(w).some((x) => x.type === TYPES.evidence && x.to === 'Anton' && x.disp === 'unique'), 'Carla\'s consent pair is relayed to the other member as evidence')
  check(berta.view.groups[0].members.length === 2 && berta.view.groups[0].pending[0]?.vouches === 0, 'not admitted yet: one member stands behind it, the rule asks two')
  const pend = anton.view.groups[0].pending[0]
  check(pend?.member, 'Anton holds the consent pair and can vouch')
  const v = await anton.h.vouchFor(groupId, pend.member, at(t + 7 * MIN, { provenance: 'met' }))
  check(v.ok && eventOf(v, 'group.vouched'), 'Anton vouches: vouch@2, bound to Carla\'s accept, travels back as evidence')
  const again = await anton.h.vouchFor(groupId, pend.member, at(t + 7 * MIN + 1))
  check(!again.ok && again.code === 'already-given', 'a second vouch is refused at the voucher')
  // negatives at the receiving member, before the real vouch travels
  const ownB = await labeledContext(berta.seed, berta.view.state.groups[groupId].memberLabel)
  const evidence = (await unseal(v.outbound[0].envelope, ownB.x.priv)).document
  const vouch = evidence.payload.evidence.vouches[0]
  const ctxA = await labeledContext(anton.seed, anton.view.state.groups[groupId].memberLabel)
  const { proof: _vp, ...vouchBody } = vouch
  const foreign = await diSign(ctxA, { ...vouchBody, credentialSubject: { ...vouch.credentialSubject, endorsement: { ...vouch.credentialSubject.endorsement, accept: await digestDoc({ x: 'another accept' }) } } }, vouch.proof.created)
  const rForeign = await berta.h.receive(await seal({ ...evidence, id: crypto.randomUUID(), payload: { evidence: { ...evidence.payload.evidence, vouches: [foreign] } } }, ownB.keyAgreement), t + 7 * MIN + 2)
  check(rForeign.disposition === 'failed' && rForeign.ref === 'RLTP-MT-3810', 'a vouch coherently signed over a foreign accept digest dies at the accept binding (3810)')
  const outsider = await pairContext(anton.seed, new Uint8Array(32).fill(0x77))
  const rOut = await berta.h.receive(await seal({ ...evidence, id: crypto.randomUUID(), issuer: outsider.anchor }, ownB.keyAgreement), t + 7 * MIN + 3)
  check(rOut.disposition === 'failed' && rOut.ref === 'RLTP-MT-3750', 'evidence from an anchor not on the roster, over a valid channel key, dies at the roster check (3750)')
  await berta.refresh()
  check(berta.view.groups[0].pending[0]?.vouches === 0 && berta.view.groups[0].members.length === 2, 'neither counted: still no admission')
  await net.send(anton, v.outbound, t + 8 * MIN)
  await net.settle(t + 9 * MIN)
  check(berta.view.groups[0].members.length === 3 && berta.view.groups[0].pending.length === 0, 'the rule of two is met: Carla admitted')
  check(carla.view.groups.find((g) => g.id === groupId)?.members.length === 3, 'the welcome carries the roster to Carla')
  const own = await berta.h.vouchFor(groupId, pend.member, at(t + 10 * MIN))
  check(!own.ok && own.code === 'no-evidence', 'after the admission no consent pair is held: nothing left to vouch for')
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) { console.error('trust: FAILED'); process.exit(1) }
console.log('trust: Stage 2 holds — the trust act, the star and the vouch with every check at its point.')
