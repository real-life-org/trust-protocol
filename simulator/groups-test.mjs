#!/usr/bin/env node
// groups-test — Stage C over the INTRODUCED channel, on the holder:
// Jonathan founds a group and invites Emil, whom he never met. Prelude →
// invite → accept → admission → welcome, every document a sealed delivery
// through the network, with the negatives at their points.
import { createPerson, createNetwork, meet, at, decideAll, eventOf, contactNamed, labeledContext, diSign, diVerify, seal, unseal, iso, digestDoc, sameDigest, toU, oidOf, base58, fromB64u, TYPES } from './holder.mjs'

let pass = 0, fail = 0
const check = (c, m) => { if (c) { pass++; console.log(`  ok    ${m}`) } else { fail++; console.error(`  FAIL  ${m}`) } }
const T0 = Date.parse('2026-08-26T10:00:00Z')
const MIN = 60_000

// ── prehistory: the introduction (Anton offline while it waits) ─────────
const anton = await createPerson('Anton', { when: T0 }), jonathan = await createPerson('Jonathan', { when: T0 }), emil = await createPerson('Emil', { when: T0 })
const net = createNetwork([anton, jonathan, emil])
const aj = await meet(net, jonathan, anton, T0)
const ae = await meet(net, emil, anton, T0 + MIN)
const intro = await anton.h.introduce(aj.atDisplayer.id, ae.atDisplayer.id, at(T0 + 2 * MIN, { label: 'Emil' }))
await net.send(anton, intro.outbound, T0 + 2 * MIN)
await net.setOnline(anton, false, T0 + 2 * MIN)
await decideAll(net, jonathan, 'introduction', 'accept', T0 + 3 * MIN)
await net.setOnline(anton, true, T0 + 4 * MIN)
await decideAll(net, emil, 'introduction', 'accept', T0 + 5 * MIN)
await net.settle(T0 + 6 * MIN)
const jEmil = contactNamed(jonathan.view.contacts, 'Emil')
check(jEmil?.provenance === 'introduced', 'prehistory: Jonathan holds Emil, introduced via Anton (Anton was offline in between)')

// ── founding ────────────────────────────────────────────────────────────
const t = T0 + 10 * MIN
const f = await jonathan.h.foundGroup({ name: 'Orga subgroup' }, at(t))
const gid = eventOf(f, 'group.founded').groupId
await jonathan.refresh()
const gJ = jonathan.view.state.groups[gid]
check(gid.startsWith('u') && toU(gid) === gid, 'genesis digest: a canonical u multihash')
check(gJ.memberLabel.startsWith('pair/') && gJ.memberAnchor === gJ.genesis.founder, 'the founder\'s member anchor is the fresh founding pair anchor, never group/<digest> (RLTP-ACC-3235, 3275)')
const [g0] = jonathan.view.groups
check(g0.members.length === 1 && g0.members[0].self && gJ.roster[g0.members[0].anchor].op === oidOf(gid) && gJ.memberOp === oidOf(gid), 'the roster: the founder, named by the genesis\'s oid (5400)')
check(await diVerify(gJ.genesis, gJ.genesis.founder), 'the genesis verifies under the founding pair anchor')

// ── prelude → invite → accept → admission → welcome (all over channels) ──
const w0 = net.wire.length
const inv = await jonathan.h.invite(gid, jEmil.id, at(t + MIN))
check(inv.ok && inv.outbound.map((o) => o.type).join() === TYPES.preludeRequest, 'the invite act starts with the prelude request on the introduced channel')
await net.send(jonathan, inv.outbound, t + MIN)
const kinds = () => net.wire.slice(w0).filter((w) => w.disp === 'unique').map((w) => w.type)
check(kinds().includes(TYPES.preludeReply) && kinds().includes(TYPES.invite), 'prelude: Emil derives his member anchor and replies; Jonathan issues the invitation (VIC) to it')
await emil.refresh()
const [prompt] = emil.view.prompts
check(prompt?.kind === 'group-invite' && prompt.groupId === gid, 'the invitation arrives as a prompt — the prelude check passed')
const invE = Object.values(emil.view.state.joining.invites)[0]
check(invE.invite.payload.invite.credentialSubject.genesisDigest === gid, 'the VIC pins the group identity (genesisDigest)')
await decideAll(net, emil, 'group-invite', 'accept', t + 2 * MIN)
await net.settle(t + 3 * MIN)
check(kinds().includes(TYPES.accept) && kinds().includes(TYPES.welcome), 'accept → admission → welcome, each a sealed delivery')
check(jonathan.view.groups[0].members.length === 2, 'Jonathan\'s roster: 2 members')
const gE = emil.view.groups.find((g) => g.id === gid)
check(gE?.members.length === 2 && gE.members.some((m) => m.self), 'Emil\'s view: the group with the founder and himself')
const eRelAnchors = Object.values(emil.view.state.relationships).flatMap((r) => r.tuples).map((x) => x.counterpartAnchor)
check(!eRelAnchors.includes(gE.members.find((m) => m.self).anchor) && emil.view.state.groups[gid].memberLabel === 'group/' + gid, 'member anchor ≠ relationship anchor (context separation, Access 5.1)')
for (const [p, type] of [[jonathan, TYPES.invite], [emil, TYPES.accept], [jonathan, TYPES.welcome]]) {
  const [digest] = Object.entries(p.view.state.outbox).find(([, o]) => o.type === type)
  check((await p.h.deliveryStatus(digest)).items[0].status === 'delivered', `${type.split('/').slice(-2).join('/')}: delivered at its sender (the signed ack came back)`)
}

// ── negatives (each check at its declared point) ────────────────────────
{
  // 1. prelude mismatch: an invitation to a FOREIGN anchor dies at the invitee
  const f2 = await jonathan.h.foundGroup({ name: 'Second group' }, at(t + 10 * MIN))
  const g2 = eventOf(f2, 'group.founded').groupId
  const i2 = await jonathan.h.invite(g2, jEmil.id, at(t + 11 * MIN))
  await net.send(jonathan, i2.outbound, t + 11 * MIN)
  await Promise.all([jonathan.refresh(), emil.refresh()])
  const gs = jonathan.view.state.groups[g2]
  const jctx = await labeledContext(jonathan.seed, gs.memberLabel)
  const pre = Object.values(emil.view.state.joining.preludes).find((x) => x.group === g2)
  const mine = await emil.keys.anchorOf(pre.memberLabel)
  const real = Object.values(emil.view.state.joining.invites).find((x) => x.group === g2).invite
  const cred = real.payload.invite
  const { proof: _p, ...credBody } = cred
  const foreign = await diSign(jctx, { ...credBody, credentialSubject: { ...cred.credentialSubject, id: gJ.memberAnchor } }, iso(t + 12 * MIN))
  const doc = { ...real, id: crypto.randomUUID(), threadId: crypto.randomUUID(), payload: { invite: foreign } }
  const r = await emil.h.receive(await seal(doc, mine.keyAgreement), t + 12 * MIN)
  check(r.disposition === 'failed' && r.ref === 'RLTP-MT-3025', 'an invitation naming another anchor than Emil\'s own derivation dies before any effect: the subject must be the recipient (3025)')

  // 2. a consent after validUntil + skew: the invitee's own decision is refused
  const late = await emil.h.decide(emil.view.prompts.find((p) => p.groupId === g2).id, 'accept', at(t + 11 * MIN + 25 * 3600_000))
  check(!late.ok && late.code === 'prompt-expired', `an expired invitation is refused at the consent (${late.code})`)

  // 3. ref tamper: the accept re-signed coherently with a foreign digest dies at the credential digest
  const f3 = await jonathan.h.foundGroup({ name: 'Third group' }, at(t + 30 * MIN))
  const g3 = eventOf(f3, 'group.founded').groupId
  await net.send(jonathan, (await jonathan.h.invite(g3, jEmil.id, at(t + 31 * MIN))).outbound, t + 31 * MIN)
  await emil.refresh()
  const d3 = await emil.h.decide(emil.view.prompts.find((p) => p.groupId === g3).id, 'accept', at(t + 32 * MIN))
  await jonathan.refresh()
  const jm = await labeledContext(jonathan.seed, jonathan.view.state.groups[g3].memberLabel)
  const opened = (await unseal(d3.outbound[0].envelope, jm.x.priv)).document
  const em = await labeledContext(emil.seed, 'group/' + g3)
  const resign = async (accept) => { const { proof: _x, ...body } = opened; return diSign(em, { ...body, id: crypto.randomUUID(), payload: { accept } }, opened.issuedAt) }
  const bad = await resign({ ...opened.payload.accept, ref: await digestDoc({ x: 'other' }) })
  const rT = await jonathan.h.receive(await seal(bad, jm.keyAgreement), t + 33 * MIN)
  check(rT.disposition === 'failed' && rT.reason === 'validation-failed', `ref tamper (coherently re-signed) dies at the credential digest comparison (${rT.ref})`)
  check(Object.keys((await jonathan.read()).groups[g3].roster).length === 1, 'nothing admitted')

  // 4. u/z: a z-carried ref MUST pass (equality over the decoded bytes)
  const refU = opened.payload.accept.ref
  const refZ = 'z' + base58(fromB64u(refU.slice(1)))
  check(sameDigest(refU, refZ), 'control: the u and the z ref are the same digest')
  const zed = await resign({ ...opened.payload.accept, ref: refZ })
  const rZ = await jonathan.h.receive(await seal(zed, jm.keyAgreement), t + 34 * MIN)
  check(rZ.disposition === 'unique' && eventOf(rZ, 'group.admitted'), 'a z-carried accept.ref is admitted (equality over decoded bytes)')
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) { console.error('groups: FAILED'); process.exit(1) }
console.log('groups: Stage C holds — a group over the introduced channel, every check at its point.')
