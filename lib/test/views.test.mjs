#!/usr/bin/env node
// The views (lib Stage 2, PR 2; design note §4.5): pure synchronous
// projections state → View, tested against the sampleState fixture
// without an engine, plus the holder's read surface over them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  contactsView, contactView, groupsView, profileView, promptsView, deliveryStatusView,
  createHolder, seedKeys, encodeState, decodeState, jcs,
} from '../dist/index.js'
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
  assert.deepEqual(b.classes.sealedGroupStar, { setting: 'on', on: true }, 'an explicit on stays on')
  assert.equal(b.trust.given, false)
  assert.equal(b.trust.pending, false, 'nothing is pending without the Trust act')
  assert.deepEqual(contactView(s, 'c-bob').classes.star, { setting: 'off', on: false })
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
  const w = copy()
  w.relationships['r-bob-2'].chainedInto = 'r-bob-1'
  assert.equal(contactView(w, 'c-bob').trust.pending, false, 'a chained relationship is no longer live')
})

// ── groups, profile, prompts ───────────────────────────────────────────

test('views: groupsView, profileView and promptsView carry the commitSeq', () => {
  const s = sampleState()
  assert.deepEqual(groupsView(s), [{ commitSeq: s.commitSeq, id: 'g-garden', listed: true, vouchThreshold: '2' }])
  assert.deepEqual(profileView(s), { commitSeq: s.commitSeq, revision: '3', name: 'Me', text: 'about me' })
  const p = promptsView(s)
  assert.deepEqual(p, [{ commitSeq: s.commitSeq, id: 'p-invite', kind: 'group-invite', contactId: 'c-alice', groupId: 'g-garden', openedAt: s.prompts['p-invite'].openedAt, expiresAt: s.prompts['p-invite'].expiresAt }])
  const e = copy()
  e.profile = { body: null, revision: '0' }
  assert.deepEqual(profileView(e), { commitSeq: e.commitSeq, revision: '0' })
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
