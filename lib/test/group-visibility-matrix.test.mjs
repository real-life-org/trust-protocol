#!/usr/bin/env node
// Who sees whom in a group, as a matrix. Three people: F founds the group
// and invites X and Y, who know each other apart from the group. Five
// things happen in every order that can happen: X joins, Y joins, X and Y
// meet, X trusts Y, Y trusts X. Whatever the order, each holder ends with
// the same picture, and that picture follows from the facts alone:
//
//   at P, about a fellow member Q
//   sharedGroups names the group   P and Q are contacts, both are members
//                                  (the blinded group star goes to every
//                                  contact, 2760)
//   the roster names Q's contact   P and Q stand at the two ends of an
//                                  invitation, or Q trusts P (the sealed
//                                  group star goes to a trusted contact
//                                  and proves which member Q is, 5530–5580)
//
// Nothing else names anybody: a holder never learns from the group who a
// member is, only from that member or from the invitation between the two.
//
// Further down: a member invites its own contact (the invitation names the
// two to each other, the founder and the invitee stay strangers), and the
// block, which changes nothing in who is known.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupsView } from '../dist/internal.js'
import { T0, ev, opts, settle, met, communityPerson } from './holder-fixture.mjs'

const STEPS = ['joinX', 'joinY', 'meet', 'trustXY', 'trustYX']
/** every order of the five steps in which X and Y meet before either trusts the other */
function orders () {
  const out = []
  const walk = (rest, done) => {
    if (!rest.length) return void out.push(done)
    for (const s of rest) {
      if ((s === 'trustXY' || s === 'trustYX') && !done.includes('meet')) continue
      walk(rest.filter((x) => x !== s), [...done, s])
    }
  }
  walk(STEPS, [])
  return out
}

let seed = 0
/** F founded the group and met X and Y; the steps run in the given order, each settled among all three. */
async function world (order) {
  const base = 0x20 + (seed++ % 60) * 3
  const F = await communityPerson(base), X = await communityPerson(base + 1), Y = await communityPerson(base + 2)
  const all = [F, X, Y]
  let t = T0
  const next = () => (t += 100_000)
  const fx = await met(F, X, next())
  const fy = await met(F, Y, next())
  const founded = await F.h.foundGroup({ name: 'Garden' }, opts(next()))
  const groupId = ev(founded, 'group.founded')[0].groupId
  const xy = {}
  const join = async (P, contactAtF) => {
    await settle(all, (await F.h.invite(groupId, contactAtF.id, opts(next()))).outbound, next())
    const [p] = (await P.h.prompts()).filter((x) => x.kind === 'group-invite')
    assert.ok(p, 'the invitation surfaced')
    await settle(all, (await P.h.decide(p.id, 'accept', opts(next()))).outbound, next())
  }
  const run = {
    joinX: () => join(X, fx.a),
    joinY: () => join(Y, fy.a),
    meet: async () => { const m = await met(X, Y, next()); xy.yAtX = m.a; xy.xAtY = m.b; await settle(all, [], next()) },
    trustXY: async () => settle(all, (await X.h.trust(xy.yAtX.id, opts(next()))).outbound, next()),
    trustYX: async () => settle(all, (await Y.h.trust(xy.xAtY.id, opts(next()))).outbound, next()),
  }
  for (const s of order) await run[s]()
  // time passes: whatever a holder still owes goes out
  await settle(all, [], next())
  await settle(all, [], next())
  return { F, X, Y, groupId, fx, fy, xy, all, next }
}

/** what P's views say of the member Q: whether P's roster holds Q's member anchor at all (`present`:
 *  "no contact" says something only of a member that is there), whether the group is shared with Q's
 *  contact, and the contact Q's roster entry names */
async function sees (P, Q, groupId, qAtP) {
  const anchorQ = (await Q.read()).groups[groupId].memberAnchor
  assert.equal(typeof anchorQ, 'string', 'Q holds a member anchor in the group')
  const group = (await P.h.groups()).find((g) => g.id === groupId)
  const entry = group?.members.find((m) => m.anchor === anchorQ)
  const shared = qAtP ? ((await P.h.contact(qAtP.id)).sharedGroups ?? []).includes(groupId) : false
  return { phase: group?.phase, present: entry !== undefined, shared, named: entry?.contactId ?? null }
}

/** the premise of every world of the first kind: each of the three holds exactly the other two as
 *  contacts, so what a holder is shown comes from these relationships and from the group, nothing else */
async function threeContacts ({ F, X, Y, fx, fy, xy }, at) {
  const ids = async (P) => (await P.h.contacts()).map((c) => c.id).sort()
  assert.deepEqual(await ids(F), [fx.a.id, fy.a.id].sort(), `F holds X and Y · ${at}`)
  assert.deepEqual(await ids(X), [fx.b.id, xy.yAtX.id].sort(), `X holds F and Y · ${at}`)
  assert.deepEqual(await ids(Y), [fy.b.id, xy.xAtY.id].sort(), `Y holds F and X · ${at}`)
}

/** the trust X and Y actually reached, as both sides hold it: [X gave, Y holds it as received, Y gave, X holds it as received] */
async function trustReached (X, Y, xy) {
  const x = await X.h.contact(xy.yAtX.id), y = await Y.h.contact(xy.xAtY.id)
  return [x.trust.given, y.trust.received, y.trust.given, x.trust.received]
}

test('visibility matrix: every order of joining, meeting and trusting ends in the same picture, which follows from the facts alone', async () => {
  const all = orders()
  assert.equal(all.length, 40, 'five steps, the meeting before either trust')
  for (const order of all) {
    const w = await world(order)
    const at = order.join(' → ')
    const { F, X, Y, groupId, fx, fy, xy } = w
    await threeContacts(w, at)
    assert.deepEqual(await trustReached(X, Y, xy), [true, true, true, true], `the trust both ways arrived · ${at}`)
    // the two who know each other apart from the group
    assert.deepEqual(await sees(X, Y, groupId, xy.yAtX), { phase: 'member', present: true, shared: true, named: xy.yAtX.id }, `X about Y · ${at}`)
    assert.deepEqual(await sees(Y, X, groupId, xy.xAtY), { phase: 'member', present: true, shared: true, named: xy.xAtY.id }, `Y about X · ${at}`)
    // the two ends of each invitation
    assert.deepEqual(await sees(F, X, groupId, fx.a), { phase: 'member', present: true, shared: true, named: fx.a.id }, `F about X · ${at}`)
    assert.deepEqual(await sees(F, Y, groupId, fy.a), { phase: 'member', present: true, shared: true, named: fy.a.id }, `F about Y · ${at}`)
    assert.deepEqual(await sees(X, F, groupId, fx.b), { phase: 'member', present: true, shared: true, named: fx.b.id }, `X about F · ${at}`)
    assert.deepEqual(await sees(Y, F, groupId, fy.b), { phase: 'member', present: true, shared: true, named: fy.b.id }, `Y about F · ${at}`)
  }
})

test('visibility matrix: without trust the blinded star says that a contact shares the group and names no member; one-sided trust names one way only', async () => {
  for (const order of [['joinX', 'joinY', 'meet'], ['meet', 'joinX', 'joinY'], ['joinX', 'meet', 'joinY'], ['joinY', 'meet', 'joinX']]) {
    const w = await world(order)
    const { X, Y, groupId, xy } = w
    const at = order.join(' → ')
    await threeContacts(w, at)
    assert.deepEqual(await trustReached(X, Y, xy), [false, false, false, false], `no trust · ${at}`)
    assert.deepEqual(await sees(X, Y, groupId, xy.yAtX), { phase: 'member', present: true, shared: true, named: null }, `X about Y · ${at}`)
    assert.deepEqual(await sees(Y, X, groupId, xy.xAtY), { phase: 'member', present: true, shared: true, named: null }, `Y about X · ${at}`)
  }
  for (const order of [['joinX', 'joinY', 'meet', 'trustXY'], ['meet', 'trustXY', 'joinX', 'joinY'], ['meet', 'joinY', 'trustXY', 'joinX'], ['joinX', 'meet', 'trustXY', 'joinY']]) {
    const w = await world(order)
    const { X, Y, groupId, xy } = w
    const at = order.join(' → ')
    await threeContacts(w, at)
    assert.deepEqual(await trustReached(X, Y, xy), [true, true, false, false], `X trusts Y, and only X · ${at}`)
    // X trusts Y: X proved to Y which member X is; Y proved nothing to X
    assert.deepEqual(await sees(Y, X, groupId, xy.xAtY), { phase: 'member', present: true, shared: true, named: xy.xAtY.id }, `Y about X · ${at}`)
    assert.deepEqual(await sees(X, Y, groupId, xy.yAtX), { phase: 'member', present: true, shared: true, named: null }, `X about Y · ${at}`)
  }
})

test('visibility matrix: two who never met see each other in the group as members without a contact, and no shared group', async () => {
  const { X, Y, groupId, fx, fy } = await world(['joinX', 'joinY'])
  // each holds the founder as its one contact: nothing but the group connects the two
  assert.deepEqual((await X.h.contacts()).map((c) => c.id), [fx.b.id])
  assert.deepEqual((await Y.h.contacts()).map((c) => c.id), [fy.b.id])
  assert.deepEqual(await sees(X, Y, groupId, null), { phase: 'member', present: true, shared: false, named: null })
  assert.deepEqual(await sees(Y, X, groupId, null), { phase: 'member', present: true, shared: false, named: null })
})

test('visibility matrix: the contact a proven member is named as does not depend on the order of the contacts, nor on a contact that merely lists the relationship; two relationships proving the same member for different entries name nobody (review of #204)', async () => {
  const { X, groupId, xy } = await world(['joinX', 'joinY', 'meet', 'trustYX'])
  const s = await X.read()
  const named = (state) => groupsView(state).find((g) => g.id === groupId).members.filter((m) => !m.self).map((m) => m.contactId ?? null).sort()
  const before = named(s)
  assert.ok(before.includes(xy.yAtX.id))
  // a second entry that lists the same relationship, none of whose tuples is its own: before and after the real one
  const real = s.contacts[xy.yAtX.id]
  const twin = { ...real, id: real.id + '-2', aliases: [] }
  for (const contacts of [{ [twin.id]: twin, ...s.contacts }, { ...s.contacts, [twin.id]: twin }]) {
    assert.deepEqual(named({ ...s, contacts }), before, 'the entry the relationship\'s tuples belong to, not a contact that lists the relationship')
  }
  // the relationship to the founder is made to hold a pair for the same member
  const [relId, rel] = Object.entries(s.relationships).find(([, r]) => r.memory.groupMembers?.[groupId])
  const [otherId, other] = Object.entries(s.relationships).find(([id]) => id !== relId)
  const relationships = { ...s.relationships, [otherId]: { ...other, memory: { ...other.memory, groupMembers: { [groupId]: rel.memory.groupMembers[groupId] } } } }
  assert.ok(!named({ ...s, relationships }).includes(xy.yAtX.id), 'two entries claim the member: named as neither')
})

test('visibility matrix: what a member proved stays known after it withdraws its trust (a disclosure is not taken back, as the anchor mapping is not); leaving the group ends both', async () => {
  const { X, Y, groupId, xy, all, next } = await world(['joinX', 'joinY', 'meet', 'trustYX'])
  const named = { phase: 'member', present: true, shared: true, named: xy.yAtX.id }
  assert.deepEqual(await sees(X, Y, groupId, xy.yAtX), named)
  // Y withdraws its trust in X: X keeps what Y proved, as it keeps the anchor mapping it verified
  await settle(all, (await Y.h.untrust(xy.xAtY.id, opts(next()))).outbound, next())
  await settle(all, [], next())
  assert.deepEqual(await sees(X, Y, groupId, xy.yAtX), named)
  assert.equal((await X.h.contact(xy.yAtX.id)).trust.received, true, 'the mapping X verified stays, too')
  // Y leaves the group: no member of that anchor, and Y's group star names the group no more
  const anchorY = (await Y.read()).groups[groupId].memberAnchor
  const left = await Y.h.leaveGroup(groupId, opts(next()))
  assert.equal(left.ok, true, JSON.stringify(left))
  await settle(all, left.outbound, next())
  await settle(all, [], next())
  await settle(all, [], next())
  const g = (await X.h.groups()).find((x) => x.id === groupId)
  assert.equal(g.members.some((m) => m.anchor === anchorY), false, 'no roster entry for the one who left')
  assert.equal(g.members.some((m) => m.contactId === xy.yAtX.id), false, 'and nobody else is named as that contact')
  assert.deepEqual((await X.h.contact(xy.yAtX.id)).sharedGroups ?? [], [], 'the group is shared no more')
})

// ── a member invites its own contact ──────────────────────────────────────
// F founds and invites X; X, a member, invites Y, whom it knows apart from
// the group. X and Y stand at the two ends of an invitation: each names the
// other in the roster without any trust. F and Y never met: each is a
// member without a contact to the other, and no group is shared.
const INVITE_STEPS = ['joinX', 'meet', 'inviteY', 'trustXY', 'trustYX']
function inviteOrders (steps) {
  const before = { inviteY: ['joinX', 'meet'], trustXY: ['meet'], trustYX: ['meet'] }
  const out = []
  const walk = (rest, done) => {
    if (!rest.length) return void out.push(done)
    for (const s of rest) {
      if ((before[s] ?? []).some((b) => steps.includes(b) && !done.includes(b))) continue
      walk(rest.filter((x) => x !== s), [...done, s])
    }
  }
  walk(steps, [])
  return out
}

async function inviteWorld (order) {
  const base = 0x20 + (seed++ % 60) * 3
  const F = await communityPerson(base), X = await communityPerson(base + 1), Y = await communityPerson(base + 2)
  const all = [F, X, Y]
  let t = T0
  const next = () => (t += 100_000)
  const fx = await met(F, X, next())
  const founded = await F.h.foundGroup({ name: 'Garden' }, opts(next()))
  const groupId = ev(founded, 'group.founded')[0].groupId
  const xy = {}
  const join = async (inviter, contactAtInviter, P) => {
    const inv = await inviter.h.invite(groupId, contactAtInviter.id, opts(next()))
    assert.equal(inv.ok, true, JSON.stringify(inv))
    await settle(all, inv.outbound, next())
    const [p] = (await P.h.prompts()).filter((x) => x.kind === 'group-invite')
    assert.ok(p, 'the invitation surfaced')
    await settle(all, (await P.h.decide(p.id, 'accept', opts(next()))).outbound, next())
  }
  const run = {
    joinX: () => join(F, fx.a, X),
    meet: async () => { const m = await met(X, Y, next()); xy.yAtX = m.a; xy.xAtY = m.b; await settle(all, [], next()) },
    inviteY: () => join(X, xy.yAtX, Y),
    trustXY: async () => settle(all, (await X.h.trust(xy.yAtX.id, opts(next()))).outbound, next()),
    trustYX: async () => settle(all, (await Y.h.trust(xy.xAtY.id, opts(next()))).outbound, next()),
  }
  for (const s of order) await run[s]()
  await settle(all, [], next())
  await settle(all, [], next())
  return { F, X, Y, groupId, fx, xy, all, next }
}

test('visibility matrix: a member invites its own contact — the two name each other by the invitation in every order, with or without trust; the founder and the invitee, who never met, stay members without a contact', async () => {
  const orders = [...inviteOrders(['joinX', 'meet', 'inviteY']), ...inviteOrders(INVITE_STEPS)]
  assert.equal(orders.length, 2 + 18, 'without trust, and with both trusts wherever they can stand')
  for (const order of orders) {
    const { F, X, Y, groupId, fx, xy } = await inviteWorld(order)
    const at = order.join(' → ')
    // the invitation names the two with or without trust: so the trust the order names is checked on its own
    const [gaveXY, gaveYX] = [order.includes('trustXY'), order.includes('trustYX')]
    assert.deepEqual(await trustReached(X, Y, xy), [gaveXY, gaveXY, gaveYX, gaveYX], `the trust the order names, and no other · ${at}`)
    assert.equal((await F.h.groups())[0].members.length, 3, `the founder's log names all three · ${at}`)
    assert.deepEqual(await sees(X, Y, groupId, xy.yAtX), { phase: 'member', present: true, shared: true, named: xy.yAtX.id }, `X about Y · ${at}`)
    assert.deepEqual(await sees(Y, X, groupId, xy.xAtY), { phase: 'member', present: true, shared: true, named: xy.xAtY.id }, `Y about X · ${at}`)
    assert.deepEqual(await sees(F, X, groupId, fx.a), { phase: 'member', present: true, shared: true, named: fx.a.id }, `F about X · ${at}`)
    assert.deepEqual(await sees(X, F, groupId, fx.b), { phase: 'member', present: true, shared: true, named: fx.b.id }, `X about F · ${at}`)
    assert.deepEqual((await X.h.contacts()).map((c) => c.id).sort(), [fx.b.id, xy.yAtX.id].sort(), `X holds F and Y · ${at}`)
    // never met: each holds X as its one contact, so nothing but the group connects them; the group
    // names a member, and that is all either holds of the other
    assert.deepEqual((await F.h.contacts()).map((c) => c.id), [fx.a.id], `F's one contact is X · ${at}`)
    assert.deepEqual((await Y.h.contacts()).map((c) => c.id), [xy.xAtY.id], `Y's one contact is X · ${at}`)
    assert.deepEqual(await sees(F, Y, groupId, null), { phase: 'member', present: true, shared: false, named: null }, `F about Y · ${at}`)
    assert.deepEqual(await sees(Y, F, groupId, null), { phase: 'member', present: true, shared: false, named: null }, `Y about F · ${at}`)
  }
})

// ── the block ─────────────────────────────────────────────────────────────
test('visibility matrix: a block (Message Tasks 6) changes nothing in who is known in a group — the blocker still names the blocked member and the shared group, the blocked one notices nothing', async () => {
  const { F, X, Y, groupId, fx, xy, all, next } = await world(['joinX', 'joinY', 'meet', 'trustXY', 'trustYX'])
  const seen = async () => ({
    xy: await sees(X, Y, groupId, xy.yAtX), yx: await sees(Y, X, groupId, xy.xAtY),
    fx: await sees(F, X, groupId, fx.a), xf: await sees(X, F, groupId, fx.b),
  })
  const before = await seen()
  // a member blocks one proved by its star; the founder blocks one it invited
  for (const [P, c] of [[X, xy.yAtX], [F, fx.a]]) {
    const b = await P.h.block(c.id, opts(next()))
    assert.equal(b.ok, true, JSON.stringify(b))
    await settle(all, b.outbound, next())
  }
  await settle(all, [], next())
  assert.equal((await X.h.contact(xy.yAtX.id)).blocked, true)
  assert.equal((await F.h.contact(fx.a.id)).blocked, true)
  assert.deepEqual(await seen(), before)
})
