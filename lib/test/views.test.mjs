#!/usr/bin/env node
// The views (lib Stage 2, PR 2; design note §4.5): pure synchronous
// projections state → View, tested against the sampleState fixture
// without an engine, plus the holder's read surface over them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as root from '../dist/index.js'
import { createHolder, seedKeys, jcs } from '../dist/index.js'
import {
  contactsView, contactView, groupsView, profileView, promptsView, deliveryStatusView, encodeState, decodeState,
} from '../dist/internal.js'
import { InMemoryStore, sampleState, freezeDeep } from '../dist/testing.js'

const keys = seedKeys(new Uint8Array(64).fill(5))
const T0 = Date.parse('2026-10-14T12:00:00Z')

/** A mutable copy of the fixture, for one derivation case. */
const copy = () => structuredClone(sampleState())
const byId = (views, id) => views.find((v) => v.id === id)

// ── the fixture ────────────────────────────────────────────────────────

test('sampleState: a populated, valid HolderState that survives the codec, fresh on every call', () => {
  const s = sampleState()
  assert.equal(jcs(decodeState(encodeState(s))), jcs(s))
  assert.equal(Object.keys(s.contacts).length, 2)
  assert.equal(Object.keys(s.groups).length, 1)
  assert.equal(Object.keys(s.outbox).length, 1)
  assert.equal(Object.keys(s.prompts).length, 1)
  assert.notEqual(s.profile.body, null)
  assert.notEqual(sampleState(), s)
  s.contacts = {}
  assert.equal(Object.keys(sampleState().contacts).length, 2, 'no shared object between calls')
})

// ── contacts ───────────────────────────────────────────────────────────

test('views: contactsView — every contact in entry order, each carrying the snapshot commitSeq', () => {
  const s = sampleState()
  const v = contactsView(s)
  assert.deepEqual(v.map((c) => c.id), ['c-alice', 'c-bob'])
  for (const c of v) assert.equal(c.commitSeq, s.commitSeq)
  const a = byId(v, 'c-alice')
  assert.equal(a.provenance, 'ceremony')
  assert.equal(a.via, undefined)
  assert.equal(a.verification, 'mutual')
  assert.deepEqual(a.trust, { given: true, received: true, paused: false, pending: false })
  assert.equal(a.displayName, 'Alice', 'from the verified profile')
  assert.deepEqual(a.profile, { revision: '2', name: 'Alice', text: 'hello' })
  assert.equal(a.sharedGroups, undefined, 'not derivable before the group star graduates (PR 4)')
  const b = byId(v, 'c-bob')
  assert.equal(b.provenance, 'introduced')
  assert.equal(b.via, 'c-alice')
  assert.deepEqual(b.aliases, ['e-bob-old'])
  assert.deepEqual(b.trust, { given: true, received: true, paused: true, pending: true }, 'paused by settings, pending by the lagging relationship')
  assert.equal(b.displayName, undefined)
  assert.equal(b.profile, undefined)
})

test('views: contactView — by entry id or by alias; unknown is undefined', () => {
  const s = sampleState()
  assert.equal(contactView(s, 'c-alice').id, 'c-alice')
  assert.equal(contactView(s, 'e-bob-old').id, 'c-bob', 'the id is the entry id, stable across aliases')
  assert.equal(contactView(s, 'nobody'), undefined)
  assert.equal(contactView(s, '__proto__'), undefined)
  assert.equal(jcs(contactView(s, 'c-bob')), jcs(byId(contactsView(s), 'c-bob')))
})

test('views: verification is derived from the issued and the verified anchor mappings', () => {
  const set = (s, out, inn) => {
    for (const t of s.relationships['r-alice'].tuples) {
      if (!out) t.mappingOut = { rev: '0', body: null, underAnchor: null }
      if (!inn) t.mappingIn = { rev: '0', body: null, self: null, card: null }
    }
    return contactView(s, 'c-alice').verification
  }
  assert.equal(set(copy(), true, true), 'mutual')
  assert.equal(set(copy(), true, false), 'outgoing')
  assert.equal(set(copy(), false, true), 'incoming')
  assert.equal(set(copy(), false, false), 'met')
  const s = copy()
  s.relationships['r-alice'].tuples.forEach((t) => { t.mappingIn = { rev: '0', body: null, self: null, card: null } })
  assert.equal(contactView(s, 'c-alice').trust.received, false)
})

test('views: trust.paused is star and blinded group star both off (5.4 pause, 2780)', () => {
  const s = copy()
  assert.equal(contactView(s, 'c-alice').trust.paused, false)
  s.contacts['c-alice'].settings.star = 'off'
  assert.equal(contactView(s, 'c-alice').trust.paused, false, 'one of the two is no pause')
  s.contacts['c-alice'].settings.groupStar = 'off'
  assert.equal(contactView(s, 'c-alice').trust.paused, true)
  s.contacts['c-bob'].settings.star = 'default'
  assert.equal(contactView(s, 'c-bob').trust.paused, false)
})

test('views: classes resolve settings against the default recipient sets (2760, 2840)', () => {
  const s = copy()
  const a = contactView(s, 'c-alice').classes
  assert.deepEqual(a.anchorMapping, { setting: 'on', on: true })
  assert.deepEqual(a.star, { setting: 'default', on: true })
  assert.deepEqual(a.profile, { setting: 'default', on: true }, 'default follows the trusted contacts')
  s.contacts['c-alice'].settings.anchorMapping = 'default'
  s.contacts['c-alice'].settings.sealedGroupStar = 'on'
  const b = contactView(s, 'c-alice')
  assert.deepEqual(b.classes.anchorMapping, { setting: 'default', on: false }, 'no contact by default')
  assert.deepEqual(b.classes.profile, { setting: 'default', on: false })
  assert.deepEqual(b.classes.sealedGroupStar, { setting: 'on', on: true, groups: { 'g-garden': { setting: 'default', on: true } } }, 'an explicit on stays on')
  assert.equal(b.trust.given, false)
  assert.equal(b.trust.pending, false, 'nothing is pending without the Trust act')
  assert.deepEqual(contactView(s, 'c-bob').classes.star, { setting: 'off', on: false })
})

test('views: the sealed group star per (group, contact) — every own group and every group with a per-group setting, the per-group setting first (2830)', () => {
  const s = copy()
  // alice is trusted: the class resolves on, and so does every group at default
  assert.deepEqual(contactView(s, 'c-alice').classes.sealedGroupStar, { setting: 'default', on: true, groups: { 'g-garden': { setting: 'default', on: true } } })
  // bob holds the garden off; a per-group on for a group the holder is not in is listed too
  s.contacts['c-bob'].groupSettings = { 'g-garden': 'off', 'g-other': 'on' }
  assert.deepEqual(contactView(s, 'c-bob').classes.sealedGroupStar.groups, {
    'g-garden': { setting: 'off', on: false }, 'g-other': { setting: 'on', on: true },
  })
  // the class off toward alice turns every default group off with it; a per-group on stays (2830)
  s.contacts['c-alice'].settings.sealedGroupStar = 'off'
  assert.deepEqual(contactView(s, 'c-alice').classes.sealedGroupStar.groups, { 'g-garden': { setting: 'default', on: false } })
  s.contacts['c-alice'].groupSettings = { 'g-garden': 'on' }
  assert.deepEqual(contactView(s, 'c-alice').classes.sealedGroupStar.groups, { 'g-garden': { setting: 'on', on: true } })
})

test('views: trust.pending — given, but the mapping is not out on every live relationship', () => {
  const s = copy()
  s.relationships['r-bob-1'].links = []
  assert.equal(contactView(s, 'c-bob').trust.pending, false, 'without the link r-bob-2 no longer lags')
  const t = copy()
  t.relationships['r-alice'].tuples.at(-1).mappingOut = { rev: '0', body: null, underAnchor: null }
  assert.equal(contactView(t, 'c-alice').trust.pending, true, 'no mapping issued on the active head')
  const u = copy()
  u.duties['d1'] = { kind: 'reissue-mapping', v: 1, id: 'd1', contactId: 'c-alice', relId: 'r-alice', awaitHead: null }
  assert.equal(contactView(u, 'c-alice').trust.pending, true, 'an owed re-issue (6370)')
  // a known kind at a version the library does not handle is opaque: it owes nothing the view could show (note §2.1)
  for (const d of [
    { kind: 'reissue-mapping', v: 2, id: 'd2', contactId: 'c-alice', relId: 'r-alice', awaitHead: null },
    { kind: 'class-on', v: 2, id: 'd3', contactId: 'c-alice', relId: 'r-alice', cls: 'anchorMapping' },
  ]) {
    const o = copy()
    o.duties[d.id] = d
    assert.equal(contactView(o, 'c-alice').trust.pending, false, `an opaque ${d.kind} v2 owes nothing`)
  }
  const w = copy()
  w.relationships['r-bob-2'].chainedInto = 'r-bob-1'
  assert.equal(contactView(w, 'c-bob').trust.pending, false, 'a chained relationship is no longer live')
})

/** A copy of r-alice's tuple as an older tuple of its chain. */
const olderTuple = (s, label, extra = {}) => ({ ...structuredClone(s.relationships['r-alice'].tuples[0]), ownPairLabel: label, ...extra })
const profileIn = (rev, name, verifiedSeq = '4') => ({ rev, body: { type: 'profile@1', revision: rev, name }, verifiedSeq })

test('views: the profile of a lagging relationship is not shown, whatever its revision (6425, 6595)', () => {
  const s = copy()
  s.relationships['r-bob-2'].tuples[0].profileIn = profileIn('99', 'Copier')
  const b = contactView(s, 'c-bob')
  assert.equal(b.displayName, undefined)
  assert.equal(b.profile, undefined)
  s.relationships['r-bob-1'].tuples[0].profileIn = profileIn('1', 'Bob')
  assert.equal(contactView(s, 'c-bob').displayName, 'Bob', 'the non-lagging head is shown, though its revision is lower')
})

test('views: the profile of a tuple that is no longer an active head is not shown (6461)', () => {
  const s = copy()
  const r = s.relationships['r-alice']
  r.tuples.unshift(olderTuple(s, 'pair/alice-0', { deactivated: true, profileIn: profileIn('9', 'Stale') }))
  assert.equal(contactView(s, 'c-alice').displayName, 'Alice')
  r.tuples[1].profileIn = { rev: '0', body: null, verifiedSeq: '0' }
  assert.equal(contactView(s, 'c-alice').profile, undefined, 'the older tuple does not stand in')
})

test('views: the profile on a chained-away relationship is not shown', () => {
  const s = copy()
  s.relationships['r-bob-1'].tuples[0].profileIn = profileIn('4', 'Gone')
  s.relationships['r-bob-1'].chainedInto = 'r-bob-2'
  assert.equal(contactView(s, 'c-bob').displayName, undefined)
})

test('views: among equal revisions the profile verified last is shown', () => {
  const s = copy()
  s.relationships['r-bob-1'].links = []   // r-bob-2 no longer lags
  s.relationships['r-bob-1'].tuples[0].profileIn = profileIn('2', 'Bob A', '4')
  s.relationships['r-bob-2'].tuples[0].profileIn = profileIn('2', 'Bob B', '9')
  assert.equal(contactView(s, 'c-bob').displayName, 'Bob B')
  s.relationships['r-bob-1'].tuples[0].profileIn.verifiedSeq = '10'
  assert.equal(contactView(s, 'c-bob').displayName, 'Bob A')
  assert.deepEqual(contactView(s, 'c-bob').profile, { revision: '2', name: 'Bob A' })
})

test('views: a verification stays as history after its tuple is deactivated', () => {
  const s = copy()
  s.relationships['r-alice'].tuples[0].deactivated = true
  const a = contactView(s, 'c-alice')
  assert.equal(a.verification, 'mutual')
  assert.equal(a.trust.received, true)
  assert.equal(a.profile, undefined, 'a deactivated head shows no profile')
  assert.equal(a.trust.pending, false, 'nothing can be sent on a deactivated head')
})

test('views: one relationship behind two entries (2145) — tuples count for the entry they carry', () => {
  const s = copy()
  const r = s.relationships['r-alice']
  // the old tuple stays with c-alice; the appended active head belongs to c-alice-2
  r.tuples.push(olderTuple(s, 'pair/alice-2', {
    entryId: 'c-alice-2',
    mappingOut: { rev: '0', body: null, underAnchor: null },
    profileIn: profileIn('5', 'Alice New'),
  }))
  r.activeHead = 'pair/alice-2'
  s.contacts['c-alice-2'] = { ...structuredClone(s.contacts['c-alice']), id: 'c-alice-2', pos: '2', settings: { ...s.contacts['c-alice'].settings, anchorMapping: 'default' } }
  s.entryOrder.nextPos = '3'
  assert.equal(jcs(decodeState(encodeState(s))), jcs(s))
  const old = contactView(s, 'c-alice')
  const neu = contactView(s, 'c-alice-2')
  assert.equal(neu.verification, 'incoming', 'only the appended tuple counts for the new entry')
  assert.equal(neu.displayName, 'Alice New')
  assert.equal(old.verification, 'mutual', 'the old entry keeps its own tuple')
  assert.equal(old.displayName, undefined, 'the appended head\'s profile is not the old entry\'s, and its own tuple is no head')
  assert.equal(old.trust.pending, false, 'the old entry takes no verification on the active head (2146)')
  s.contacts['c-alice-2'].settings.anchorMapping = 'on'
  assert.equal(contactView(s, 'c-alice-2').trust.pending, true, 'the new entry owes its mapping on the head')
  assert.deepEqual(contactsView(s).map((c) => c.id), ['c-alice', 'c-bob', 'c-alice-2'])
})

// ── the root surface ───────────────────────────────────────────────────

test('surface: the root hands out the holder, views as types and an opaque state; internals live under ./internal', async () => {
  for (const n of ['createHolder', 'seedKeys', 'decodeState', 'storeContract', 'StateCodecError', 'InfraError']) assert.equal(typeof root[n], 'function', n)
  for (const n of ['encodeState', 'sameState', 'VALIDATORS', 'MIGRATIONS', 'isKnownDuty', 'contactsView', 'contactView', 'promptsView', 'freezeDeep', 'emptyState']) {
    assert.equal(n in root, false, `${n} is not at the root`)
  }
  const internal = await import('../dist/internal.js')
  for (const n of ['encodeState', 'sameState', 'VALIDATORS', 'MIGRATIONS', 'isKnownDuty', 'contactsView', 'deliveryStatusView', 'freezeDeep', 'emptyState']) assert.ok(n in internal, n)
  const s = root.decodeState(JSON.stringify(sampleState()))
  assert.equal(jcs(s), jcs(sampleState()), 'the opaque state is the decoded state at runtime')
})

// ── groups, profile, prompts ───────────────────────────────────────────

test('views: groupsView, profileView and promptsView carry the commitSeq', () => {
  const s = sampleState()
  assert.deepEqual(groupsView(s), [{ commitSeq: s.commitSeq, id: 'g-garden', name: 'Garden', listed: true, vouchThreshold: '2', members: [], pending: [] }])
  assert.deepEqual(profileView(s), { commitSeq: s.commitSeq, revision: '3', name: 'Me', text: 'about me', community: { genesis: 'uCommunityGenesis', head: '1' } })
  const p = promptsView(s)
  assert.deepEqual(p, [{ commitSeq: s.commitSeq, id: 'p-invite', kind: 'group-invite', contactId: 'c-alice', groupId: 'g-garden', openedAt: s.prompts['p-invite'].openedAt, expiresAt: s.prompts['p-invite'].expiresAt }])
  const e = copy()
  e.profile = { body: null, revision: '0' }
  assert.deepEqual(profileView(e), { commitSeq: e.commitSeq, revision: '0', community: { genesis: 'uCommunityGenesis', head: '1' } })
})

test('views: promptsView orders by opening time, then id', () => {
  const s = copy()
  s.prompts['p-a'] = { id: 'p-a', kind: 'introduction', contactId: 'c-bob', openedAt: 1 }
  s.prompts['p-0'] = { id: 'p-0', kind: 'encounter-confirm', openedAt: 1 }
  assert.deepEqual(promptsView(s).map((p) => p.id), ['p-0', 'p-a', 'p-invite'])
})

// ── delivery status ────────────────────────────────────────────────────

test('views: deliveryStatusView by digest and by threadId; unknown yields no items', () => {
  const s = sampleState()
  const [digest] = Object.keys(s.outbox)
  const it = s.outbox[digest]
  const want = {
    digest, type: it.type, threadId: it.threadId, contactId: 'c-alice', status: 'accepted',
    attempt: 1, submittedAt: it.history[0].at, updatedAt: it.history.at(-1).at,
  }
  assert.deepEqual(deliveryStatusView(s, digest), { commitSeq: s.commitSeq, items: [want] })
  assert.deepEqual(deliveryStatusView(s, it.threadId), { commitSeq: s.commitSeq, items: [want] })
  assert.deepEqual(deliveryStatusView(s, 'nothing'), { commitSeq: s.commitSeq, items: [] })
})

test('views: deliveryStatusView reports the trias, a held item, late delivery and refusal codes', () => {
  const s = copy()
  const [digest] = Object.keys(s.outbox)
  const it = s.outbox[digest]
  const at = it.history.at(-1).at
  it.history = [it.history[0], { status: 'awaiting-transport', at: at + 1, reason: 'offline' }]
  let v = deliveryStatusView(s, digest).items[0]
  assert.equal(v.status, 'submitted')
  assert.equal(v.awaiting, 'offline')
  assert.equal(v.nextAttemptAt, it.nextAttemptAt)
  delete it.nextAttemptAt
  it.history.push({ status: 'failed', at: at + 2, reason: 'expired-by-adapter-policy' }, { status: 'delivered', at: at + 3, late: true })
  v = deliveryStatusView(s, digest).items[0]
  assert.deepEqual([v.status, v.late, v.awaiting, v.reason], ['delivered', true, undefined, undefined])
  it.history = [it.history[0], { status: 'failed', at: at + 4, reason: 'rejected-by-receiver', code: 'proofInvalid' }]
  v = deliveryStatusView(s, digest).items[0]
  assert.deepEqual([v.status, v.reason, v.code, v.updatedAt], ['failed', 'rejected-by-receiver', 'proofInvalid', at + 4])
})

test('views: a thread with several documents lists them by first submission, then digest', () => {
  const s = copy()
  const [digest] = Object.keys(s.outbox)
  const it = s.outbox[digest]
  s.outbox.uAAA = { ...structuredClone(it), history: [{ status: 'submitted', at: it.history[0].at, attempt: 1 }] }
  s.outbox.uZZZ = { ...structuredClone(it), history: [{ status: 'submitted', at: it.history[0].at - 1, attempt: 1 }] }
  assert.ok('uAAA' < digest)
  assert.deepEqual(deliveryStatusView(s, it.threadId).items.map((x) => x.digest), ['uZZZ', 'uAAA', digest])
})

// ── purity ─────────────────────────────────────────────────────────────

test('views: read a deep-frozen state without mutating it; the views themselves are frozen', () => {
  const s = freezeDeep(sampleState())
  const before = jcs(s)
  const [digest] = Object.keys(s.outbox)
  const all = [
    contactsView(s), contactView(s, 'c-bob'), groupsView(s), profileView(s), promptsView(s),
    deliveryStatusView(s, digest), deliveryStatusView(s, s.outbox[digest].threadId),
  ]
  assert.equal(jcs(s), before)
  for (const v of all) assert.ok(Object.isFrozen(v))
  assert.ok(Object.isFrozen(all[0][1].aliases) && Object.isFrozen(all[0][0].trust) && Object.isFrozen(all[5].items[0]))
  assert.notEqual(all[0][1].aliases, s.contacts['c-bob'].aliases, 'no reference into the state')
})

test('views: a contact without a relationship is a broken invariant and throws', () => {
  const s = copy()
  s.contacts['c-alice'].relIds = []
  assert.throws(() => contactView(s, 'c-alice'), /no relationship/)
})

// ── the holder's read surface ──────────────────────────────────────────

/** A holder over a store that already holds sampleState, plus a module
 *  whose non-human command pauses one contact. */
const seeded = async () => {
  const store = new InMemoryStore()
  await store.commit(null, sampleState())
  const pause = {
    name: 'test-pause',
    commands: {
      'test.pause': {
        human: false,
        apply: (state, _p, input) => {
          const c = state.contacts[input.contactId]
          return {
            state: { ...state, contacts: { ...state.contacts, [c.id]: { ...c, settings: { ...c.settings, star: 'off', groupStar: 'off' } } } },
            events: [{ type: 'trust.paused', contactId: c.id, paused: true }],
          }
        },
      },
    },
  }
  return { store, h: await createHolder({ store, keys }, { modules: [pause] }) }
}

test('holder: contacts, contact, groups, profile, prompts and deliveryStatus read the committed state', async () => {
  const { h } = await seeded()
  const s = sampleState()
  const [digest] = Object.keys(s.outbox)
  assert.equal(jcs(await h.contacts()), jcs(contactsView(s)))
  assert.equal(jcs(await h.contact('e-bob-old')), jcs(contactView(s, 'c-bob')))
  assert.equal(await h.contact('nobody'), undefined)
  assert.equal(jcs(await h.groups()), jcs(groupsView(s)))
  assert.equal(jcs(await h.profile()), jcs(profileView(s)))
  assert.equal(jcs(await h.prompts()), jcs(promptsView(s)))
  assert.equal(jcs(await h.deliveryStatus(digest)), jcs(deliveryStatusView(s, digest)))
})

test('holder: after a commit, subscribe announces the new commitSeq and contacts() reflects the change', async () => {
  const { h } = await seeded()
  const before = await h.contact('c-alice')
  assert.equal(before.trust.paused, false)
  const seen = []
  h.subscribe((c) => seen.push(c))
  await h.act('test.pause', { contactId: 'c-alice' }, T0)
  assert.equal(seen.length, 1)
  const want = String(BigInt(before.commitSeq) + 1n)
  assert.equal(seen[0].commitSeq, want)
  assert.deepEqual(seen[0].events.map((e) => [e.type, e.contactId, e.commitSeq]), [['trust.paused', 'c-alice', want]])
  const after = await h.contact('c-alice')
  assert.equal(after.trust.paused, true)
  assert.equal(after.commitSeq, want, 're-read after the announcement, the view is at the announced commit')
})
