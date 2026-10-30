#!/usr/bin/env node
// personal-community (lib 0.11.0): the founding of the holder's personal
// community (Identity §2, §5.4, §9.3; Access 3.4.1) — an ordinary group
// under a fresh pair anchor whose genesis digest D names the community
// anchor group/<D>. Before it the holder has no community anchor and the
// Trust act is refused (no-community); after it the act issues the
// anchor mapping. The group stays the holder's own: not in the groups
// view, not in the group star, no invitation into it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { communityLabel } from '../dist/index.js'
import { T0, ev, opts, person, met, settle } from './holder-fixture.mjs'

const MAPPING = 'https://real-life.org/trust-tasks/spec/anchor-mapping/0.3'

test('founding: an ordinary group under a fresh pair label; its genesis digest becomes the community anchor group/<D> at generation 1', async () => {
  const A = await person(0x71)
  assert.equal((await A.read()).register.community, null, 'a fresh holder has no community anchor')
  assert.equal((await A.h.profile()).community, undefined)
  const before = await A.h.trust('nobody', opts(T0))
  assert.equal(before.ok, false)

  const f = await A.h.foundPersonalCommunity({ name: 'Al' }, opts(T0 + 1000))
  assert.equal(f.ok, true, JSON.stringify(f))
  const founded = ev(f, 'group.founded')
  assert.equal(founded.length, 1)
  const D = founded[0].groupId
  const s = await A.read()
  assert.deepEqual(s.register.community, { genesis: D, head: '1' }, 'the community anchor is the group context over D at generation 1')
  assert.ok(s.register.labels.includes(communityLabel(D, 1)), 'the label group/<D> is in the register before any key derived from it is presented')
  const g = s.groups[D]
  assert.ok(g, 'the personal community is a group of the holder')
  assert.ok(g.memberLabel.startsWith('pair/'), 'founded under a fresh pair label (Access 3.4.1)')
  assert.equal(g.listed, false, 'not in the group star: nobody can ever match a group of one')
  assert.deepEqual(Object.keys(g.roster), [g.memberAnchor], 'the founder is its sole member')

  const profile = await A.h.profile()
  assert.deepEqual(profile.community, { genesis: D, head: '1' }, 'the profile view carries the community anchor')
  const groups = await A.h.groups()
  assert.ok(!groups.some((x) => x.id === D), 'the groups view does not list the personal community')
})

test('founding: once — a second founding is refused (already-founded); the same act under its actId replays', async () => {
  const A = await person(0x72)
  const o = opts(T0)
  const f = await A.h.foundPersonalCommunity({ name: 'Al' }, o)
  assert.equal(f.ok, true)
  const again = await A.h.foundPersonalCommunity({ name: 'Al' }, opts(T0 + 1000))
  assert.deepEqual(again, { ok: false, code: 'already-founded' })
  const replay = await A.h.foundPersonalCommunity({ name: 'Al' }, o)
  assert.equal(replay.ok, true, 'the journaled act answers again under its actId')
  assert.deepEqual(ev(replay, 'group.founded'), ev(f, 'group.founded'))
})

test('founding: no invitation into the personal community', async () => {
  const A = await person(0x73)
  const B = await person(0x74)
  const f = await A.h.foundPersonalCommunity({ name: 'Al' }, opts(T0))
  const D = ev(f, 'group.founded')[0].groupId
  const { a } = await met(A, B, T0 + 1000)
  const inv = await A.h.invite(D, a.id, opts(T0 + 60_000))
  assert.deepEqual(inv, { ok: false, code: 'personal-community' })
})

test('founding, then trust: A trusts B — the class-on duty issues the anchor mapping; B derives "trusts you" from the verified anchor', async () => {
  const A = await person(0x75)
  const B = await person(0x76)
  assert.equal((await A.h.foundPersonalCommunity({ name: 'Al' }, opts(T0))).ok, true)
  assert.equal((await B.h.foundPersonalCommunity({ name: 'Bea' }, opts(T0))).ok, true)
  const { a, b } = await met(A, B, T0 + 1000)
  const t = await A.h.trust(a.id, opts(T0 + 60_000))
  assert.equal(t.ok, true, JSON.stringify(t))
  const res = await A.h.resume(T0 + 61_000)
  const out = res.outbound.filter((o) => o.type === MAPPING)
  assert.equal(out.length, 1, 'one anchor mapping toward B')
  await settle([A, B], out, T0 + 62_000)
  const seenByB = await B.h.contact(b.id)
  assert.equal(seenByB.trust.received, true, 'B holds A\'s verified anchor')
  assert.equal(seenByB.trust.given, false)
  const seenByA = await A.h.contact(a.id)
  assert.deepEqual({ given: seenByA.trust.given, received: seenByA.trust.received }, { given: true, received: false })
})
