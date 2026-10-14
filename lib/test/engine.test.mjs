#!/usr/bin/env node
// The engine core (lib Stage 2, PR 1; design note §4.1–4.4, 4.7): act in
// four steps over a CAS store, the act journal, events only after the
// commit, the built-in tick/resume/report, lastWhen, registration.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEngine, ENGINE_DEFAULTS } from '../dist/engine.js'
import { createHolder, seedKeys, CryptoUnavailableError, InfraError, CODEC, jcs } from '../dist/index.js'
import { InMemoryStore, scriptedEntropy, freezeDeep, emptyState } from '../dist/testing.js'

const IKM = new Uint8Array(64).fill(3)
const keys = seedKeys(IKM)
const KA = 'z6LSbysY2xFMRpGMhb7tFTLMpeuPRaqaWM1yECx2AtzE3KCc'   // counterpart key
const OWN = 'z6LSownOwnOwnOwnOwnOwnOwnOwnOwnOwnOwnOwnOwnOwnOwn'   // own rkid
const TYPE = 'https://real-life.org/trust-tasks/profile/0.1'
const T0 = Date.parse('2026-10-14T12:00:00Z')
const ids = (n) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)

/** A small module: one human command that records a note (and sends it
 *  when asked), one that refuses, one that mutates its input state, one
 *  non-human command. `hooks.prepare` runs inside every preparation. */
const fakeModule = (hooks = {}) => ({
  name: 'fake',
  commands: {
    'fake.note': {
      human: true,
      async prepare (ctx, input) {
        hooks.prepared = (hooks.prepared ?? 0) + 1
        if (hooks.prepare) await hooks.prepare(ctx, input)
        const id = ctx.entropy.id('doc.id')
        return { id, digest: 'u' + id, envelope: { rkid: KA, epk: 'e', nonce: 'n', ciphertext: id } }
      },
      apply (state, prepared, input, when) {
        hooks.applied = { when, preparedVersion: prepared.version, preparedSeq: prepared.commitSeq, stateSeq: state.commitSeq }
        const { id, digest, envelope } = prepared.value
        const next = {
          ...state,
          encounter: { ...state.encounter, records: { ...state.encounter.records, [id]: { text: input.text, at: when } } },
          profile: { ...state.profile, revision: String(BigInt(state.profile.revision) + 1n) },
        }
        const outbound = input.send ? [{ digest, envelope, type: TYPE, threadId: id, recipient: { contactId: 'c1', rkid: OWN, keyAgreement: KA } }] : []
        return { state: next, outbound, events: [{ type: 'profile.updated', contactId: null }] }
      },
    },
    'fake.refuse': { human: true, apply: () => ({ ok: false, code: 'unknown-contact', ref: 'RLTP-TRU-0000' }) },
    'fake.mutate': {
      human: true,
      apply (state) { state.profile.revision = '9'; return { state } },
    },
    'fake.touch': { human: false, apply: (state) => ({ state: { ...state } }) },
    'fake.noop': { human: false, apply: (state) => ({ state }) },
    'fake.prompt': {
      human: false,
      apply: (state, _p, input, when) => ({ state: { ...state, prompts: { ...state.prompts, [input.id]: { id: input.id, kind: 'group-invite', openedAt: when, expiresAt: when + 1000 } } } }),
    },
    'fake.effect': {
      human: false,
      apply: (state, _p, input, when) => ({ state: { ...state, effects: { ...state.effects, [input.digest]: { ack: null, expiresAt: when + 1000 } } } }),
    },
  },
})

const make = async (store, { entropy, hooks, retry, modules } = {}) =>
  createEngine({ store, keys, entropy: entropy ?? scriptedEntropy({ 'doc.id': ids(40) }), retry }, modules ?? [fakeModule(hooks)])

const read = async (store) => (await store.read()).state

// ── construction ───────────────────────────────────────────────────────

test('engine: a fresh store is initialised with the empty state', async () => {
  const store = new InMemoryStore()
  await make(store)
  const s = await read(store)
  assert.equal(jcs(s), jcs(emptyState(CODEC)))
  assert.notEqual((await store.read()).version, null)
})

test('engine: an existing state is loaded, not overwritten', async () => {
  const store = new InMemoryStore()
  const s0 = emptyState(CODEC); s0.lastWhen = 5; s0.commitSeq = '4'
  const c = await store.commit(null, s0)
  await make(store)
  assert.equal((await store.read()).version, c.version)
  const e = await make(store)
  assert.equal((await e.snapshot()).commitSeq, '4')
})

test('engine: duplicate command, task or duty names across modules throw; registries are frozen', async () => {
  const store = new InMemoryStore()
  const a = { name: 'a', commands: { 'x.do': { human: false, apply: (s) => ({ state: s }) } } }
  const b = { name: 'b', commands: { 'x.do': { human: false, apply: (s) => ({ state: s }) } } }
  await assert.rejects(createEngine({ store, keys }, [a, b]), /duplicate command/)
  const t = (name) => ({ name, commands: {}, tasks: { 'https://real-life.org/trust-tasks/star/0.2': { apply: (s) => ({ state: s }) } } })
  await assert.rejects(createEngine({ store, keys }, [t('a'), t('b')]), /duplicate task/)
  const d = (name) => ({ name, commands: {}, duties: { 'class-on': { apply: (s) => ({ state: s }) } } })
  await assert.rejects(createEngine({ store, keys }, [d('a'), d('b')]), /duplicate duty/)
  await assert.rejects(createEngine({ store, keys }, [{ name: 'c', commands: { tick: { human: false, apply: (s) => ({ state: s }) } } }]), /duplicate command/, 'built-in names are taken')
  await assert.rejects(createEngine({ store, keys }, [{ name: 'p', commands: {}, tasks: { 'https://real-life.org/trust-tasks/star': { apply: (s) => ({ state: s }) } } }]), /task URI/, 'no prefix registrations')
  const e = await createEngine({ store, keys }, [t('a'), d('b')])
  assert.ok(Object.isFrozen(e.registry) && Object.isFrozen(e.registry.tasks))
  assert.deepEqual(e.registry.tasks, ['https://real-life.org/trust-tasks/star/0.2'])
  assert.deepEqual(e.registry.duties, ['class-on'])
})

test('engine: constructing without the WebCrypto algorithms throws CryptoUnavailableError', async () => {
  const store = new InMemoryStore()
  await assert.rejects(createEngine({ store, keys, crypto: {} }, []), (e) => e instanceof CryptoUnavailableError && e.missing.length >= 5)
  const S = globalThis.crypto.subtle
  const noX = {
    subtle: new Proxy(S, {
      get: (t, p) => p === 'importKey'
        ? (fmt, k, alg, ...r) => ((alg?.name ?? alg) === 'X25519' ? Promise.reject(new Error('NotSupported')) : t.importKey(fmt, k, alg, ...r))
        : (typeof t[p] === 'function' ? t[p].bind(t) : t[p]),
    }),
  }
  await assert.rejects(createEngine({ store, keys, crypto: noX }, []), (e) => e instanceof CryptoUnavailableError && jcs(e.missing) === jcs(['X25519']))
})

// ── acts, journal, idempotency ─────────────────────────────────────────

test('engine: a human command without actId is refused and nothing is committed', async () => {
  const store = new InMemoryStore()
  const e = await make(store)
  const v = (await store.read()).version
  assert.deepEqual(await e.act('fake.note', { text: 'a' }, T0), { ok: false, code: 'actid-missing' })
  assert.equal((await store.read()).version, v)
})

test('engine: an act commits state, outbox, journal and commitSeq, then returns outbound and events', async () => {
  const store = new InMemoryStore()
  const e = await make(store)
  const seen = []
  e.subscribe((c) => seen.push(c))
  const r = await e.act('fake.note', { text: 'hello', send: true }, T0, { actId: 'act-1' })
  assert.equal(r.ok, true)
  assert.equal(r.outbound.length, 1)
  assert.equal(r.outbound[0].attempt, 1)
  assert.deepEqual(r.events.map((x) => [x.type, x.actId, x.commitSeq]), [['profile.updated', 'act-1', '1']])
  const s = await read(store)
  assert.equal(s.commitSeq, '1')
  assert.equal(s.lastWhen, T0)
  const item = s.outbox[r.outbound[0].digest]
  assert.equal(item.attempt, 1)
  assert.deepEqual(item.history, [{ status: 'submitted', at: T0, attempt: 1 }])
  assert.deepEqual(s.acts['act-1'].outboundDigests, [r.outbound[0].digest])
  assert.equal(s.acts['act-1'].commitSeq, '1')
  assert.equal(seen.length, 1)
  assert.equal(seen[0].commitSeq, '1')
  assert.deepEqual(seen[0].events, r.events)
})

test('engine: the same actId with the same input returns the persisted result without a new commit', async () => {
  const store = new InMemoryStore()
  const e = await make(store)
  const r1 = await e.act('fake.note', { text: 'hello', send: true }, T0, { actId: 'act-1' })
  const v1 = (await store.read()).version
  const seen = []
  e.subscribe((c) => seen.push(c))
  const r2 = await e.act('fake.note', { send: true, text: 'hello' }, T0 + 5, { actId: 'act-1' })
  assert.equal(jcs(r2), jcs(r1))
  assert.equal((await store.read()).version, v1, 'no new commit')
  assert.equal((await read(store)).commitSeq, '1')
  assert.equal(seen.length, 0, 'a replay announces nothing')
  // a fresh engine over the same store answers the same
  const e2 = await make(store)
  assert.equal(jcs(await e2.act('fake.note', { text: 'hello', send: true }, T0, { actId: 'act-1' })), jcs(r1))
})

test('engine: the same actId with a different input is actid-conflict', async () => {
  const store = new InMemoryStore()
  const e = await make(store)
  await e.act('fake.note', { text: 'hello' }, T0, { actId: 'act-1' })
  assert.deepEqual(await e.act('fake.note', { text: 'other' }, T0, { actId: 'act-1' }), { ok: false, code: 'actid-conflict' })
  assert.deepEqual(await e.act('fake.refuse', { text: 'hello' }, T0, { actId: 'act-1' }), { ok: false, code: 'actid-conflict' }, 'the command name is part of the input hash')
})

test('engine: non-human commands ignore actId and journal nothing', async () => {
  const store = new InMemoryStore()
  const e = await make(store)
  const r = await e.act('fake.touch', {}, T0, { actId: 'ignored' })
  assert.equal(r.ok, true)
  const s = await read(store)
  assert.deepEqual(s.acts, {})
  assert.equal(s.commitSeq, '1')
  assert.equal((await e.act('fake.noop', {}, T0)).ok, true)
  assert.equal((await read(store)).commitSeq, '1', 'a non-human no-op at the same when does not commit')
  assert.equal((await e.act('fake.noop', {}, T0 + 1)).ok, true)
  const s2 = await read(store)
  assert.equal(s2.commitSeq, '2', 'a higher when is a state change')
  assert.equal(s2.lastWhen, T0 + 1)
})

test('engine: a refusal commits nothing', async () => {
  const store = new InMemoryStore()
  const e = await make(store)
  const v = (await store.read()).version
  assert.deepEqual(await e.act('fake.refuse', {}, T0, { actId: 'r1' }), { ok: false, code: 'unknown-contact', ref: 'RLTP-TRU-0000' })
  assert.equal((await store.read()).version, v)
})

test('engine: apply sees a deeply frozen snapshot — mutation throws, nothing is committed', async () => {
  const store = new InMemoryStore()
  const e = await make(store)
  const v = (await store.read()).version
  await assert.rejects(e.act('fake.mutate', {}, T0, { actId: 'm1' }), TypeError)
  assert.equal((await store.read()).version, v)
  assert.equal((await read(store)).profile.revision, '0')
  const snap = await e.snapshot()
  assert.ok(Object.isFrozen(snap.state) && Object.isFrozen(snap.state.profile), 'snapshot() is deep-frozen too')
  assert.throws(() => { snap.state.profile.revision = '1' }, TypeError)
})

test('engine: prepare is bound to the snapshot it ran against', async () => {
  const store = new InMemoryStore()
  const hooks = {}
  const e = await make(store, { hooks })
  await e.act('fake.touch', {}, T0)
  const { version } = await store.read()
  await e.act('fake.note', { text: 'x' }, T0, { actId: 'b1' })
  assert.deepEqual(hooks.applied, { when: T0, preparedVersion: version, preparedSeq: '1', stateSeq: '1' })
})

test('engine: lastWhen — a lower when is raised to lastWhen', async () => {
  const store = new InMemoryStore()
  const hooks = {}
  const e = await make(store, { hooks })
  await e.act('fake.note', { text: 'late' }, T0 + 100, { actId: 'w1' })
  await e.act('fake.note', { text: 'early' }, T0, { actId: 'w2' })
  assert.equal(hooks.applied.when, T0 + 100, 'apply sees the raised when')
  const s = await read(store)
  assert.equal(s.lastWhen, T0 + 100)
  assert.equal(s.acts.w2.at, T0 + 100)
})

// ── CAS, unknown outcomes, events after commit ─────────────────────────

test('engine: a second engine committing in between — the first retries with fresh entropy and succeeds', async () => {
  const store = new InMemoryStore()
  const other = await make(store, { entropy: scriptedEntropy({ 'doc.id': ['ffffffff-0000-4000-8000-000000000000'] }) })
  let fired = false
  const hooks = { async prepare () { if (!fired) { fired = true; await other.act('fake.note', { text: 'between' }, T0, { actId: 'other-1' }) } } }
  const e = await make(store, { hooks, entropy: scriptedEntropy({ 'doc.id': ['a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'] }) })
  const r = await e.act('fake.note', { text: 'mine', send: true }, T0, { actId: 'mine-1' })
  assert.equal(r.ok, true)
  assert.equal(hooks.prepared, 2, 'prepared again after the conflict')
  assert.equal(r.outbound[0].digest, 'ua0000000-0000-4000-8000-000000000002', 'the second preparation drew fresh entropy')
  const s = await read(store)
  assert.equal(s.commitSeq, '2')
  assert.equal(s.acts['other-1'].commitSeq, '1')
  assert.equal(s.acts['mine-1'].commitSeq, '2')
  assert.equal(Object.keys(s.outbox).length, 1)
})

class ConflictStore extends InMemoryStore {
  conflicts = 0
  async commit (version, next) {
    if (version !== null && this.conflicts-- > 0) return { ok: false, reason: 'conflict' }
    return super.commit(version, next)
  }
}

test('engine: CAS conflicts are bounded — commit-conflict after retry.commitAttempts, and no event leaks', async () => {
  const store = new ConflictStore()
  const hooks = {}
  const e = await make(store, { hooks, retry: { commitAttempts: 3 } })
  const seen = []
  e.subscribe((c) => seen.push(c))
  store.conflicts = 3
  await assert.rejects(e.act('fake.note', { text: 'x' }, T0, { actId: 'c1' }), (err) => err instanceof InfraError && err.code === 'commit-conflict')
  assert.equal(hooks.prepared, 3)
  assert.equal(seen.length, 0, 'a listener sees nothing when the commit fails')
  store.conflicts = 2
  assert.equal((await e.act('fake.note', { text: 'x' }, T0, { actId: 'c1' })).ok, true, 'within the bound it succeeds')
  assert.equal(seen.length, 1)
  assert.equal(ENGINE_DEFAULTS.commitAttempts, 8)
})

class ThrowingStore extends InMemoryStore {
  mode = null   // 'before': nothing lands; 'after': lands, answer lost
  async commit (version, next) {
    const m = this.mode; this.mode = null
    if (m === 'before') throw new Error('connection reset')
    if (m === 'after') { await super.commit(version, next); throw new Error('answer lost') }
    return super.commit(version, next)
  }
}

test('engine: a commit that throws is unknown-commit-outcome; a new engine replays the actId from the journal', async () => {
  const store = new ThrowingStore()
  const e = await make(store)
  const seen = []
  e.subscribe((c) => seen.push(c))
  store.mode = 'after'
  await assert.rejects(e.act('fake.note', { text: 'x', send: true }, T0, { actId: 'u1' }), (err) => err instanceof InfraError && err.code === 'unknown-commit-outcome')
  assert.equal(seen.length, 0, 'nothing announced while the outcome is unknown')
  const e2 = await make(store)
  const r = await e2.act('fake.note', { text: 'x', send: true }, T0, { actId: 'u1' })
  assert.equal(r.ok, true)
  assert.equal(r.outbound.length, 1)
  assert.equal(r.events[0].actId, 'u1')
  assert.equal((await read(store)).commitSeq, '1', 'replayed, not committed twice')
})

test('engine: after an unknown outcome the engine settles first — a landed commit is announced late, a lost one never', async () => {
  const store = new ThrowingStore()
  const e = await make(store)
  const seen = []
  e.subscribe((c) => seen.push(c))
  store.mode = 'after'
  await assert.rejects(e.act('fake.touch', {}, T0), InfraError)
  await e.act('fake.noop', {}, T0)
  assert.deepEqual(seen.map((c) => c.commitSeq), ['1'], 'the landed commit is released on settling')
  store.mode = 'before'
  await assert.rejects(e.act('fake.touch', {}, T0), (err) => err.code === 'unknown-commit-outcome')
  await e.act('fake.noop', {}, T0)
  assert.deepEqual(seen.map((c) => c.commitSeq), ['1'], 'a commit that never landed is never announced')
  const r = await e.act('fake.note', { text: 'y' }, T0, { actId: 'after' })
  assert.equal(r.events[0].commitSeq, '2')
})

// ── restart, resume, report ────────────────────────────────────────────

test('engine: restart between commit and send — a new holder over the store re-emits with attempt 2', async () => {
  const store = new InMemoryStore()
  const e = await make(store)
  const r = await e.act('fake.note', { text: 'x', send: true }, T0, { actId: 's1' })
  const sent = r.outbound[0]
  // the process dies before the app sends; a new holder comes up
  const h = await createHolder({ store, keys, entropy: scriptedEntropy({}) })
  const early = await h.resume(T0)
  assert.deepEqual(early.outbound, [], 'not due before the backoff')
  assert.equal(early.nextDueAt, T0 + ENGINE_DEFAULTS.backoff(1))
  const due = await h.resume(early.nextDueAt)
  assert.equal(due.outbound.length, 1)
  assert.equal(due.outbound[0].attempt, 2)
  assert.equal(jcs(due.outbound[0].envelope), jcs(sent.envelope), 'the stored envelope is resent')
  assert.equal(due.nextDueAt, early.nextDueAt + ENGINE_DEFAULTS.backoff(2))
  const s = await read(store)
  assert.equal(s.outbox[sent.digest].attempt, 2)
  assert.deepEqual(s.outbox[sent.digest].history.map((x) => x.status), ['submitted', 'submitted'])
})

const DAY = 86_400_000

test('engine: the holder gives up only at the horizon — no give-up before it with the defaults', async () => {
  const store = new InMemoryStore()
  const e = await make(store)
  const r = await e.act('fake.note', { text: 'x', send: true }, T0, { actId: 'g0' })
  const d = r.outbound[0].digest
  let due = (await e.resume(T0)).nextDueAt
  let rounds = 0
  while (due < T0 + ENGINE_DEFAULTS.horizonMs) {
    const res = await e.resume(due)
    assert.equal(res.outbound.length, 1, `re-emitted at ${due - T0} ms`)
    assert.deepEqual(res.events, [])
    due = res.nextDueAt
    rounds++
  }
  assert.ok(rounds > 8, 'more attempts than the old count bound')
  const gave = await e.resume(due)
  assert.deepEqual(gave.outbound, [])
  assert.deepEqual(gave.events.map((x) => [x.type, x.status]), [['delivery.status', 'failed']])
  assert.equal(gave.nextDueAt, undefined)
  assert.deepEqual((await read(store)).outbox[d].history.at(-1), { status: 'failed', at: due, reason: 'expired-by-adapter-policy' })
  assert.equal('maxAttempts' in ENGINE_DEFAULTS, false)
})

test('engine: resume pauses re-emission of items the adapter holds, but the horizon still gives them up', async () => {
  const store = new InMemoryStore()
  const e = await make(store, { retry: { horizonMs: DAY, backoff: () => 10 } })
  const r = await e.act('fake.note', { text: 'x', send: true }, T0, { actId: 'aw' })
  const digest = r.outbound[0].digest
  await e.report({ digest, status: 'awaiting-transport', reason: 'offline' }, T0 + 1)
  const before = await e.resume(T0 + DAY - 1)
  assert.deepEqual(before.outbound, [], 'no re-emission while the adapter holds it')
  assert.deepEqual(before.events, [], 'no give-up before the horizon')
  assert.equal(before.nextDueAt, T0 + DAY, 'the horizon is the next due time')
  assert.equal((await read(store)).outbox[digest].attempt, 1)
  const after = await e.resume(T0 + DAY)
  assert.deepEqual(after.outbound, [])
  assert.deepEqual(after.events.map((x) => [x.type, x.digest, x.status]), [['delivery.status', digest, 'failed']])
  assert.equal(after.nextDueAt, undefined)
  assert.deepEqual((await read(store)).outbox[digest].history.at(-1), { status: 'failed', at: T0 + DAY, reason: 'expired-by-adapter-policy' })
})

test('engine: nextDueAt is the earlier of re-emission and horizon expiry', async () => {
  const store = new InMemoryStore()
  const e = await make(store, { retry: { horizonMs: DAY, backoff: () => 2 * DAY } })
  await e.act('fake.note', { text: 'x', send: true }, T0, { actId: 'nd' })
  const r = await e.resume(T0)
  assert.equal(r.nextDueAt, T0 + DAY, 'the horizon comes before the backoff')
  const g = await e.resume(T0 + DAY)
  assert.deepEqual(g.events.map((x) => x.status), ['failed'], 'given up at the horizon although no attempt was due')
})

test('engine: the retry policy is validated at construction; fractional backoff is normalised', async () => {
  const store = new InMemoryStore()
  for (const retry of [{ horizonMs: NaN }, { horizonMs: DAY - 1 }, { horizonMs: 90 * DAY + 1 }, { horizonMs: DAY + 0.5 }, { backoff: () => NaN }, { backoff: () => -1 }, { backoff: (n) => (n === 3 ? Infinity : 1) }, { commitAttempts: 0 }, { commitAttempts: 1.5 }]) {
    await assert.rejects(make(store, { retry }), RangeError, JSON.stringify(retry) + String(retry.backoff ?? ''))
  }
  const e = await make(store, { retry: { backoff: (n) => 1000 * 1.5 ** n } })
  const r = await e.act('fake.note', { text: 'x', send: true }, T0, { actId: 'fr' })
  let due = (await e.resume(T0)).nextDueAt
  assert.equal(due, T0 + 1500)
  for (let i = 0; i < 6; i++) {
    const res = await e.resume(due)
    assert.equal(res.outbound.length, 1)
    assert.ok(Number.isSafeInteger(res.nextDueAt))
    due = res.nextDueAt
  }
  assert.equal((await read(store)).outbox[r.outbound[0].digest].attempt, 7)
})

test('engine: a higher when on a no-op resume is kept — a later act cannot go back below it (lastWhen)', async () => {
  const store = new InMemoryStore()
  const hooks = {}
  const e = await make(store, { hooks })
  await e.resume(T0 + 100)
  assert.equal((await read(store)).lastWhen, T0 + 100)
  await e.act('fake.note', { text: 'x' }, T0 + 50, { actId: 'lw' })
  assert.equal(hooks.applied.when, T0 + 100)
  assert.equal((await read(store)).acts.lw.at, T0 + 100)
  await e.report({ digest: 'unope', status: 'accepted' }, T0 + 500)
  assert.equal((await read(store)).lastWhen, T0 + 100, 'a refusal commits nothing, not even lastWhen')
  await e.tick(T0 + 200)
  assert.equal((await read(store)).lastWhen, T0 + 200)
})

test('engine: report — idempotent per (digest, status), monotone, unknown digest', async () => {
  const store = new InMemoryStore()
  const e = await make(store)
  const r = await e.act('fake.note', { text: 'x', send: true }, T0, { actId: 'p1' })
  const digest = r.outbound[0].digest
  const seen = []
  e.subscribe((c) => seen.push(...c.events))

  assert.deepEqual(await e.report({ digest: 'unope', status: 'accepted' }, T0), { ok: false, code: 'unknown-digest' })

  const a = await e.report({ digest, status: 'awaiting-transport', reason: 'offline' }, T0 + 1)
  assert.deepEqual(a.events, [], 'pre-transport is history, not a trias event')
  const acc = await e.report({ digest, status: 'accepted' }, T0 + 2)
  assert.deepEqual(acc.events.map((x) => [x.type, x.digest, x.status]), [['delivery.status', digest, 'accepted']])
  const seq = (await read(store)).commitSeq
  const again = await e.report({ digest, status: 'accepted' }, T0 + 2)
  assert.deepEqual(again, { ok: true, outbound: [], events: [] })
  assert.equal((await read(store)).commitSeq, seq, 'idempotent: no commit')
  const back = await e.report({ digest, status: 'awaiting-transport', reason: 'offline' }, T0 + 4)
  assert.deepEqual(back.events, [], 'no step back to pre-transport')

  assert.equal((await e.report({ digest, status: 'failed', reason: 'unroutable' }, T0 + 5)).events[0].status, 'failed')
  const late = await e.report({ digest, status: 'delivered', late: false }, T0 + 6)
  assert.deepEqual(late.events.map((x) => [x.status, x.late]), [['delivered', true]], 'after failed, delivered is late by the holder\'s own history')
  assert.deepEqual((await e.report({ digest, status: 'delivered', late: true }, T0 + 7)).events, [], 'delivered is idempotent')
  assert.deepEqual((await e.report({ digest, status: 'failed', reason: 'oversize' }, T0 + 8)).events, [], 'nothing after delivered')
  assert.deepEqual((await e.report({ digest, status: 'accepted' }, T0 + 9)).events, [])

  const h = (await read(store)).outbox[digest].history
  assert.deepEqual(h.map((x) => x.status), ['submitted', 'awaiting-transport', 'accepted', 'failed', 'delivered'])
  assert.equal(h.at(-1).late, true)
  assert.deepEqual(seen.map((x) => x.status), ['accepted', 'failed', 'delivered'])
  assert.deepEqual((await e.resume(T0 + 10 ** 9)).outbound, [], 'a reported document is not retried')
})

test('engine: delivered after the holder\'s own give-up is surfaced as late even when the adapter says late:false', async () => {
  const store = new InMemoryStore()
  const e = await make(store, { retry: { horizonMs: DAY, backoff: () => 10 } })
  const r = await e.act('fake.note', { text: 'x', send: true }, T0, { actId: 'gl' })
  const digest = r.outbound[0].digest
  const gave = await e.resume(T0 + DAY)
  assert.deepEqual(gave.events.map((x) => x.status), ['failed'])
  const d = await e.report({ digest, status: 'delivered', late: false }, T0 + DAY + 1)
  assert.deepEqual(d.events.map((x) => [x.type, x.status, x.late]), [['delivery.status', 'delivered', true]])
  assert.deepEqual((await read(store)).outbox[digest].history.at(-1), { status: 'delivered', at: T0 + DAY + 1, late: true })
})

test('engine: replay returns outbound only for documents that are not terminal', async () => {
  const store = new InMemoryStore()
  const e = await make(store)
  const r = await e.act('fake.note', { text: 'x', send: true }, T0, { actId: 'rp' })
  await e.report({ digest: r.outbound[0].digest, status: 'accepted' }, T0)
  assert.equal((await e.act('fake.note', { text: 'x', send: true }, T0, { actId: 'rp' })).outbound.length, 1, 'accepted is not terminal')
  await e.report({ digest: r.outbound[0].digest, status: 'delivered', late: false }, T0)
  const again = await e.act('fake.note', { text: 'x', send: true }, T0, { actId: 'rp' })
  assert.equal(again.ok, true)
  assert.deepEqual(again.outbound, [], 'a delivered document is not handed out again')
  assert.deepEqual(again.events, r.events)
})

test('engine: the input is bound at the call — a later change by the caller reaches neither hash, prepare nor apply', async () => {
  const store = new InMemoryStore()
  let release
  const gate = new Promise((res) => { release = res })
  const hooks = { async prepare (_ctx, input) { if (input.text === 'slow') await gate } }
  const e = await make(store, { hooks })
  const slow = e.act('fake.note', { text: 'slow' }, T0, { actId: 'slow' })
  const form = { text: 'original', extra: undefined }
  const p = e.act('fake.note', form, T0, { actId: 'b1' })
  form.text = 'typed later'
  release()
  await slow
  const r = await p
  assert.equal(r.ok, true)
  const s = await read(store)
  const rec = Object.values(s.encounter.records).find((x) => x.text !== 'slow')
  assert.equal(rec.text, 'original')
  const seq = s.commitSeq
  const replay = await e.act('fake.note', { text: 'original' }, T0, { actId: 'b1' })
  assert.equal(jcs(replay), jcs(r), 'the original input replays')
  assert.equal((await read(store)).commitSeq, seq)
  assert.deepEqual(await e.act('fake.note', { text: 'typed later' }, T0, { actId: 'b1' }), { ok: false, code: 'actid-conflict' })
  await assert.rejects(e.act('fake.note', { text: new Date(0) }, T0, { actId: 'nj' }), /jcs/, 'non-JSON input is refused')
})

test('engine: a failing KeyProvider, Log or Access in prepare is InfraError, and nothing commits', async () => {
  const store = new InMemoryStore()
  const failing = { ...keys, sign: async () => { throw new Error('keystore locked') } }
  const mod = {
    name: 'ports',
    commands: {
      'p.sign': { human: false, prepare: (ctx) => ctx.keys.sign('persona/Anton', new Uint8Array(1)), apply: (st) => ({ state: { ...st } }) },
      'p.log': { human: false, prepare: (ctx) => ctx.log.head(), apply: (st) => ({ state: { ...st } }) },
      'p.access': { human: false, prepare: (ctx) => ctx.access.memberships(), apply: (st) => ({ state: { ...st } }) },
    },
  }
  const log = { head: async () => { throw new Error('log down') }, append: async () => ({ status: 'failure', reason: 'x' }) }
  const access = { memberships: async () => { throw new Error('access down') }, membership: async () => null }
  const e = await createEngine({ store, keys: failing, log, access }, [mod])
  const v = (await store.read()).version
  for (const [cmd, code] of [['p.sign', 'key-provider'], ['p.log', 'log'], ['p.access', 'access']]) {
    await assert.rejects(e.act(cmd, {}, T0 + 1), (err) => err instanceof InfraError && err.code === code && err.cause instanceof Error, cmd)
  }
  assert.equal((await store.read()).version, v)
})

test('engine: events are frozen; listeners cannot change what others or the caller see; async rejections are swallowed', async () => {
  const store = new InMemoryStore()
  const e = await make(store)
  let unhandled = 0
  const onU = () => { unhandled++ }
  process.on('unhandledRejection', onU)
  const tried = []
  e.subscribe((c) => {
    for (const f of [() => { c.events.length = 0 }, () => { c.events[0].type = 'x' }]) {
      try { f(); tried.push('mutated') } catch (err) { tried.push(err.name) }
    }
  })
  e.subscribe(async () => { throw new Error('async listener') })
  const seen = []
  e.subscribe((c) => seen.push(c))
  const r = await e.act('fake.note', { text: 'x' }, T0, { actId: 'ev' })
  await new Promise((res) => setImmediate(res))
  process.off('unhandledRejection', onU)
  assert.equal(unhandled, 0)
  assert.deepEqual(tried, ['TypeError', 'TypeError'])
  assert.ok(Object.isFrozen(r.events) && Object.isFrozen(r.events[0]))
  assert.equal(seen[0].events.length, 1)
})

// ── tick ───────────────────────────────────────────────────────────────

test('engine: tick expires effects and prompts at their expiry and acts after the retention', async () => {
  const store = new InMemoryStore()
  const e = await make(store)
  await e.act('fake.effect', { digest: 'uEff' }, T0)
  await e.act('fake.prompt', { id: 'pr1' }, T0)
  await e.act('fake.note', { text: 'x' }, T0, { actId: 'k1' })
  await e.tick(T0 + 999)
  let s = await read(store)
  assert.ok(s.effects.uEff && s.prompts.pr1 && s.acts.k1, 'nothing expires early')
  await e.tick(T0 + 1000)
  s = await read(store)
  assert.deepEqual(s.effects, {})
  assert.deepEqual(s.prompts, {})
  assert.ok(s.acts.k1, 'acts follow the retention')
  assert.equal(s.lastWhen, T0 + 1000)
  await e.tick(T0 + ENGINE_DEFAULTS.retentionMs)
  assert.deepEqual((await read(store)).acts, {})
  assert.equal(ENGINE_DEFAULTS.retentionMs, 90 * 24 * 3600 * 1000)
  const seq = (await read(store)).commitSeq
  await e.tick(T0)
  assert.equal((await read(store)).commitSeq, seq, 'a tick with nothing to do commits nothing')
})

// ── helpers ────────────────────────────────────────────────────────────

test('testing: freezeDeep freezes nested objects and arrays and returns its argument', () => {
  const o = { a: { b: [1, { c: 2 }] } }
  assert.equal(freezeDeep(o), o)
  assert.ok(Object.isFrozen(o.a.b[1]))
})

test('holder: createHolder exposes the act surface and no receive until PR 3', async () => {
  const h = await createHolder({ store: new InMemoryStore(), keys }, { modules: [fakeModule()] })
  for (const m of ['act', 'tick', 'resume', 'report', 'subscribe', 'snapshot']) assert.equal(typeof h[m], 'function', m)
  assert.equal('receive' in h, false)
})
