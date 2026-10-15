#!/usr/bin/env node
// trust-entries (lib Stage 2, PR 4c; Trust Section 2, 6a.1): the entries
// of the deliverable set on the holder — the net merge (rung 2) as a
// persisted continuation after the verification commit (2230), k−1 slots
// and pending admission in one evaluation (2150), the settings merge
// (2160, 5450), the manual merge (6640) and its split (2080–2115) with
// the identity rewrite, departure (2250, 2260, 5860), the relationship
// behind two entries (2145, 2146) and the binding rule (6605).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { digestBytes, communityContext, labeledContext, iso, ecdh, xRawOfMk } from '../dist/index.js'
import { bindingOf, signRaw, assembleAnchorMapping, makeAnchorRotation } from '../dist/anchor.js'
import { InMemoryStore, stateBuilder, openPromptModule, OPEN_PROMPT } from '../dist/testing.js'
import { createEngine, trustModule, contactView, contactsView, viewDigest } from '../dist/internal.js'
import { T0, side, withCommunity, mappingEnvelope, craftMapping, read, edit } from './pair-fixture.mjs'

const genesis = (n) => digestBytes(new Uint8Array(32).fill(n))

/**
 * B holds one relationship per counterpart side: r1 → C (contact c1),
 * r2 → C2 (C's second pair side, the same person, contact c2), r3 → D
 * (contact c3). The star and the blinded group star are paused toward
 * every contact (no star traffic) unless `stars`.
 */
async function world ({ bound = 10n ** 18n - 1n, build = (b) => b, stars = false, modules = [] } = {}) {
  const gC = await genesis(0x41), gD = await genesis(0x42), gB = await genesis(0x43)
  const C = await withCommunity(await side(0x0b, 0x0c), gC)
  const C2 = await withCommunity(await side(0x0b, 0x0d), gC)
  const D = await withCommunity(await side(0x0e, 0x0f), gD)
  const B1 = await side(0x09, 0x21), B2 = await side(0x09, 0x22), B3 = await side(0x09, 0x23)
  const B = await withCommunity(B1, gB)
  const spec = (mine, theirs) => ({ ownPairLabel: mine.label, counterpartAnchor: theirs.anchor, counterpartKeyAgreement: theirs.keyAgreement, rkid: mine.keyAgreement })
  const b = stateBuilder({ at: T0 }).community(gB, '1')
    .relationship('r1', { contactId: 'c1', tuples: [spec(B1, C)] })
    .relationship('r2', { contactId: 'c2', tuples: [spec(B2, C2)] })
    .relationship('r3', { contactId: 'c3', tuples: [spec(B3, D)] })
  if (!stars) for (const c of ['c1', 'c2', 'c3']) b.settings(c, { star: 'off', groupStar: 'off' })
  const store = new InMemoryStore()
  await store.commit(null, build(b).build())
  const holder = await createEngine({ store, keys: B.keys }, [trustModule({ admissionBound: bound }), ...modules])
  const mapOn = async (from, to, opts = {}, when = T0) => holder.receive((await mappingEnvelope(from, to, await craftMapping(from, to, opts))).envelope, when)
  return { B, B1, B2, B3, C, C2, D, store, holder, mapOn, restart: () => createEngine({ store, keys: B.keys }, [trustModule({ admissionBound: bound }), ...modules]) }
}

const human = (h, cmd, input, id, when = T0) => h.act(cmd, input, when, { actId: id })

test('net merge: a verification whose anchor head is another entry\'s commits first; the merge runs as a persisted duty after it, also across a restart (2230, 6530)', async () => {
  const w = await world()
  assert.equal((await w.mapOn(w.C, w.B1)).disposition, 'unique')
  const r = await w.mapOn(w.C2, w.B2, {}, T0 + 1)
  assert.equal(r.disposition, 'unique')
  assert.equal(r.nextDueAt, T0 + 1, 'the merge is due at once')
  let s = await read(w.store)
  assert.deepEqual([s.contacts.c1.pos, s.contacts.c2.pos], ['0', '1'], 'the verification committed its entry first')
  assert.deepEqual(Object.values(s.duties).map((d) => [d.kind, d.entryIds]), [['merge', ['c1', 'c2']]])
  // a restart between the verification commit and the merge commit
  const again = await w.restart()
  const m = await again.resume(T0 + 2)
  assert.deepEqual(m.events.map((e) => [e.type, e.contactId, e.merged]), [['contact.merged', 'c1', ['c2']]])
  s = await read(w.store)
  assert.deepEqual(Object.keys(s.contacts).sort(), ['c1', 'c3'])
  assert.deepEqual([s.contacts.c1.pos, s.contacts.c1.aliases, s.contacts.c1.relIds, s.contacts.c1.anchorHead], ['0', ['c2'], ['r1', 'r2'], w.C.self])
  assert.equal(s.relationships.r2.tuples[0].entryId, 'c1', 'the merged id resolves to the survivor everywhere')
  assert.equal(contactView(s, 'c2').id, 'c1', 'the alias finds the merged contact')
  assert.deepEqual(s.duties, {})
  // both relationships stay live with their active heads (2170)
  assert.deepEqual([s.relationships.r1.tuples[0].deactivated, s.relationships.r2.tuples[0].deactivated], [false, false])
})

test('net merge: merging k admitted entries frees k−1 slots and admits the next pending entry in the same step (2150, bound 2)', async () => {
  const w = await world({ bound: 2n })
  await w.mapOn(w.C, w.B1)
  await w.mapOn(w.C2, w.B2, {}, T0 + 1)          // admitted, a merge duty opens
  await w.mapOn(w.D, w.B3, {}, T0 + 2)           // the set is full: pending
  let s = await read(w.store)
  assert.deepEqual(['c1', 'c2', 'c3'].map((c) => s.contacts[c].status), ['admitted', 'admitted', 'pending'])
  const before = s.commitSeq
  await w.holder.resume(T0 + 3)
  s = await read(w.store)
  assert.equal(BigInt(s.commitSeq), BigInt(before) + 1n, 'merge and admission are one commit')
  assert.deepEqual([s.contacts.c1.status, s.contacts.c3.status, s.contacts.c3.pos], ['admitted', 'admitted', '2'])
})

test('net merge: no merge where a relationship states another pre-rotation binding for the shared anchor (6605); a copy of a superseded anchor stays apart (6540)', async () => {
  const w = await world()
  await w.mapOn(w.C, w.B1)
  // a copy of C's anchor under a binding of its own: card.commit binds another key
  const g1 = await communityContext(w.C.seed, w.C.genesis, 1)
  const other = await communityContext(new Uint8Array(64).fill(0x5a), await genesis(0x44), 1)
  const cardBody = { type: 'self-card@2', anchor: g1.anchor, keyAgreement: g1.keyAgreement, commit: await bindingOf(other.anchor) }
  const card = { body: cardBody, proof: { proofValue: await signRaw(g1, cardBody) } }
  const pair = await labeledContext(w.C2.seed, w.C2.label)
  const body = { type: 'anchor-mapping@4', pair: pair.anchor, self: g1.anchor, to: w.B2.anchor, card, lineage: [], revision: '1', issuedAt: iso(T0 + 1) }
  const copy = await assembleAnchorMapping(body, await ecdh(pair.x.priv, xRawOfMk(w.B2.keyAgreement)), await ecdh(g1.x.priv, xRawOfMk(w.B2.keyAgreement)))
  assert.equal((await w.holder.receive((await mappingEnvelope(w.C2, w.B2, copy)).envelope, T0 + 1)).disposition, 'unique')
  let s = await read(w.store)
  assert.deepEqual(s.duties, {}, 'the binding rule refuses the merge')
  assert.deepEqual([s.contacts.c1.anchorHead, s.contacts.c2.anchorHead], [w.C.self, w.C.self], 'two entries with one anchor head')
  // table 1: r1 rotates C to generation 2 with the lineage 1 → 2; a later copy of generation 1 joins nothing
  const w2 = await world()
  const g = (n) => communityContext(w2.C.seed, w2.C.genesis, n)
  const rot = await makeAnchorRotation(await g(1), await g(2), await g(3))
  await w2.mapOn(w2.C, w2.B1, { gen: 2, lineage: [rot] })
  await w2.mapOn(w2.C2, w2.B2, { gen: 1 }, T0 + 1)
  s = await read(w2.store)
  assert.deepEqual(s.duties, {}, 'head rule (b): generation 1 is superseded in c1')
  assert.equal(s.contacts.c1.anchorHead, (await g(2)).anchor)
  // once r2 presents the current anchor head itself, it joins (6590)
  await w2.mapOn(w2.C2, w2.B2, { gen: 2, lineage: [rot], revision: '2' }, T0 + 2)
  s = await read(w2.store)
  assert.deepEqual(Object.values(s.duties).map((d) => d.entryIds), [['c1', 'c2']])
})

test('manual merge (6640): at most one entry; settings off > on > default per class and per group, a per-group on reset where the sealed group star is off (2160, 5450)', async () => {
  const w = await world({
    build: (b) => b
      .settings('c1', { profile: 'on', sealedGroupStar: 'default' }).with((s) => { s.contacts.c1.groupSettings = { g1: 'on', g3: 'off' } })
      .settings('c2', { anchorMapping: 'on', profile: 'off', sealedGroupStar: 'off' }).with((s) => { s.contacts.c2.groupSettings = { g2: 'on' } }),
  })
  await w.mapOn(w.C, w.B1)
  await w.mapOn(w.D, w.B3, {}, T0 + 1)
  assert.deepEqual(await human(w.holder, 'trust.merge', { contactIds: ['c1', 'c3'] }, 'm0'), { ok: false, code: 'not-mergeable', ref: 'RLTP-TRU-6640' })
  const r = await human(w.holder, 'trust.merge', { contactIds: ['c2', 'c1'] }, 'm1')
  assert.equal(r.ok, true)
  assert.deepEqual(r.events.map((e) => [e.type, e.contactId, e.merged]), [['contact.merged', 'c1', ['c2']]])
  const s = await read(w.store)
  const c = s.contacts.c1
  assert.deepEqual(c.settings, { star: 'off', groupStar: 'off', anchorMapping: 'on', sealedGroupStar: 'off', profile: 'off' })
  assert.deepEqual(c.groupSettings, { g3: 'off' }, 'every per-group on reset, the off kept')
  assert.deepEqual([c.pos, c.status, c.aliases, c.relIds], ['0', 'admitted', ['c2'], ['r1', 'r2']])
})

test('manual merge without entries: the identity of the relationship whose active head was created last (2180); the first later entry commit writes the entry under it, and no split: 2080 read literally would split every manual merge of unmapped relationships at the first mapping; open point for Trust 0.32', async () => {
  const w = await world()
  await human(w.holder, 'trust.merge', { contactIds: ['c1', 'c2'] }, 'm1')
  let s = await read(w.store)
  assert.deepEqual(Object.keys(s.contacts).sort(), ['c2', 'c3'], 'r2\'s head is the newer')
  assert.deepEqual([s.contacts.c2.pos, s.contacts.c2.aliases], [null, ['c1']])
  const r = await w.mapOn(w.C, w.B1)
  assert.deepEqual(r.events.filter((e) => e.type === 'contact.split'), [], 'the literal 2080 would split here; this library keeps it (open point)')
  s = await read(w.store)
  assert.deepEqual([s.contacts.c2.pos, s.contacts.c2.status, s.contacts.c2.anchorHead, [...s.contacts.c2.relIds].sort()], ['0', 'admitted', w.C.self, ['r1', 'r2']])
})

/** Every path in `x` where the string `id` appears, as a value or a key. */
function pathsOf (x, id, path = '$', out = []) {
  if (typeof x === 'string') { if (x === id) out.push(path) } else if (Array.isArray(x)) x.forEach((e, i) => pathsOf(e, id, `${path}[${i}]`, out))
  else if (x && typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) { if (k === id) out.push(`${path}{${k}}`); pathsOf(v, id, `${path}.${k}`, out) }
  }
  return out
}

test('split (2080–2115): the first mapping of a hand-merged relationship shares no anchor — it leaves atomically with its identity; the entry keeps position and status, frees no slot, settles its head, and every key that resolved through the old identity is rewritten', async () => {
  const w = await world({ modules: [openPromptModule], stars: true })
  // c1 and c3 merged by hand before any mapping: the identity is c3, r3's head being the newer (2180)
  await human(w.holder, 'trust.merge', { contactIds: ['c1', 'c3'] }, 'm1')
  await w.mapOn(w.C, w.B1)                                       // the entry commits under c3 (pos 0)
  await human(w.holder, 'trust.setClass', { contactId: 'c3', cls: 'profile', setting: 'off' }, 's1')
  await human(w.holder, 'trust.set', { contactId: 'c3', on: true }, 's2')
  await w.holder.act(OPEN_PROMPT, { id: 'p1', kind: 'introduction', contactId: 'c3' }, T0)
  await w.holder.resume(T0)                                      // star and mapping go out on r1 and r3 under c3
  // a star baseline naming c3 on r2's tuple, as a completed delivery would
  // leave it; r2 came by an introduction from the merged contact c3
  await edit(w.store, (s) => {
    s.relationships.r2.provenance = { kind: 'introduced', via: 'c3', at: T0 }
    const t = s.relationships.r2.tuples[0]
    const view = [{ member: 'c3', head: w.C.self }]
    t.starOut.snapshot = view; t.starOut.snapshotDigest = viewDigest(view)
  })
  let s = await read(w.store)
  assert.equal(s.contacts.c3.pos, '0')
  assert.ok(Object.values(s.outbox).some((o) => o.recipient.contactId === 'c3' && o.recipient.rkid === w.B1.keyAgreement))
  // D's first mapping on r3 names no anchor r1 holds: r3 leaves
  const r = await w.mapOn(w.D, w.B3, {}, T0 + 5)
  assert.equal(r.disposition, 'unique')
  assert.deepEqual(r.events.filter((e) => e.type === 'contact.split').map((e) => [e.contactId, e.leaver, e.relationshipId]), [['c1', 'c3', 'r3']])
  s = await read(w.store)
  // the remaining entry: position, status and settings kept, its identity the oldest remaining relationship's (2100)
  assert.deepEqual([s.contacts.c1.pos, s.contacts.c1.status, s.contacts.c1.relIds, s.contacts.c1.aliases, s.contacts.c1.anchorHead], ['0', 'admitted', ['r1'], [], w.C.self])
  assert.deepEqual([s.contacts.c1.settings.anchorMapping, s.contacts.c1.settings.profile], ['on', 'off'])
  // the leaver: its identity, an ordinary entry commit at the next position, settings at default but the off (2115)
  assert.deepEqual([s.contacts.c3.pos, s.contacts.c3.status, s.contacts.c3.relIds, s.contacts.c3.anchorHead], ['1', 'admitted', ['r3'], w.D.self])
  assert.deepEqual(s.contacts.c3.settings, { star: 'default', groupStar: 'default', anchorMapping: 'default', sealedGroupStar: 'default', profile: 'off' })
  assert.equal(s.entryOrder.nextPos, '2', 'no slot freed, one entry commit')
  // the scan: c3 remains only where it names the leaver
  const allowed = [
    /^\$\.contacts\{c3\}$/, /^\$\.contacts\.c3\.id$/, /^\$\.relationships\.r3\.contactId$/, /^\$\.relationships\.r3\.tuples\[\d+\]\.entryId$/,
    /^\$\.acts\./, /^\$\.outbox\.[^.]+\.recipient\.contactId$/, /^\$\.effects\.[^.]+\.ack\.recipient\.contactId$/, /^\$\.duties\.[^.]+\.contactId$/,
  ]
  const found = pathsOf(s, 'c3')
  for (const p of found) assert.ok(allowed.some((a) => a.test(p)), `c3 left at ${p}`)
  for (const p of found.filter((x) => x.startsWith('$.outbox.'))) assert.equal(s.outbox[p.split('.')[2]].recipient.rkid, w.B3.keyAgreement, 'only the leaver\'s documents name it')
  for (const p of found.filter((x) => x.startsWith('$.effects.'))) assert.equal(s.effects[p.split('.')[2]].ack.recipient.rkid, w.B3.keyAgreement, 'only the leaver\'s acks name it')
  assert.ok(Object.values(s.effects).some((e) => e.ack?.recipient.rkid === w.B1.keyAgreement && e.ack.recipient.contactId === 'c1'), 'the remaining entry\'s acks follow the rename')
  assert.equal(s.relationships.r2.provenance.via, 'c1', 'the introduction names the remaining contact (provenance.via)')
  assert.equal(contactsView(s).find((c) => c.id === 'c2').via, 'c1')
  for (const p of found.filter((x) => x.startsWith('$.duties.'))) assert.equal(s.duties[p.split('.')[2]].relId, 'r3')
  assert.equal(s.prompts.p1.contactId, 'c1')
  assert.equal(s.relationships.r1.tuples[0].entryId, 'c1')
  assert.equal(s.relationships.r2.tuples[0].starOut.snapshot[0].member, 'c1', 'the baseline renamed')
  assert.equal(s.relationships.r2.tuples[0].starOut.snapshotDigest, viewDigest([{ member: 'c1', head: w.C.self }]))
  assert.ok(!Object.values(s.duties).some((d) => d.kind === 'class-on' && d.relId === 'r3' && d.cls === 'anchorMapping'), 'the leaver\'s anchor mapping class is off (6410)')
  assert.deepEqual(contactsView(s).map((c) => c.id), ['c1', 'c3', 'c2'])
})

test('departure: an admitted entry leaves and the pending one is admitted in the same commit (2250, 5860); a pending entry leaves with its relationship (2260)', async () => {
  const w = await world({ bound: 1n })
  await w.mapOn(w.C, w.B1)
  await w.mapOn(w.D, w.B3, {}, T0 + 1)
  let s = await read(w.store)
  assert.deepEqual([s.contacts.c1.status, s.contacts.c3.status], ['admitted', 'pending'])
  const seq = s.commitSeq
  const r = await human(w.holder, 'trust.depart', { contactId: 'c1' }, 'd1', T0 + 2)
  assert.deepEqual(r.events.map((e) => [e.type, e.contactId, e.relationshipIds, e.removed]), [['contact.departed', 'c1', ['r1'], true]])
  s = await read(w.store)
  assert.equal(BigInt(s.commitSeq), BigInt(seq) + 1n)
  assert.deepEqual([Object.hasOwn(s.contacts, 'c1'), Object.hasOwn(s.relationships, 'r1'), s.contacts.c3.status], [false, false, 'admitted'])
  assert.ok(!s.entryOrder.heads.includes('r1'))
  // a pending entry: removed, nothing admitted
  const w2 = await world({ bound: 1n })
  await w2.mapOn(w2.C, w2.B1)
  await w2.mapOn(w2.D, w2.B3, {}, T0 + 1)
  await human(w2.holder, 'trust.depart', { contactId: 'c3' }, 'd2', T0 + 2)
  s = await read(w2.store)
  assert.deepEqual([Object.hasOwn(s.contacts, 'c3'), s.contacts.c1.status], [false, 'admitted'])
  assert.deepEqual(await human(w2.holder, 'trust.depart', { contactId: 'nobody' }, 'd3'), { ok: false, code: 'unknown-contact' })
})

test('departure of one relationship of a merged entry: by alias the alias drops and the entry stays; the relationship whose identity is the entry\'s leaves and the entry takes the oldest remaining one\'s (2100)', async () => {
  const w = await world()
  await w.mapOn(w.C, w.B1)
  await w.mapOn(w.C2, w.B2, {}, T0 + 1)
  await w.holder.resume(T0 + 2)                 // merged: c1 with alias c2
  const r = await human(w.holder, 'trust.depart', { contactId: 'c2' }, 'd1', T0 + 3)
  assert.deepEqual(r.events.map((e) => [e.contactId, e.relationshipIds, e.removed]), [['c1', ['r2'], false]])
  let s = await read(w.store)
  assert.deepEqual([s.contacts.c1.aliases, s.contacts.c1.relIds, s.contacts.c1.status], [[], ['r1'], 'admitted'])
  // again merged, then the relationship whose identity is c1 departs
  const w2 = await world()
  await w2.mapOn(w2.C, w2.B1)
  await w2.mapOn(w2.C2, w2.B2, {}, T0 + 1)
  await w2.holder.resume(T0 + 2)
  await human(w2.holder, 'trust.depart', { contactId: 'c1', relationshipId: 'r1' }, 'd2', T0 + 3)
  s = await read(w2.store)
  assert.deepEqual(Object.keys(s.contacts).sort(), ['c2', 'c3'])
  assert.deepEqual([s.contacts.c2.pos, s.contacts.c2.status, s.contacts.c2.relIds, s.contacts.c2.aliases, s.contacts.c2.anchorHead], ['0', 'admitted', ['r2'], [], w2.C.self])
  assert.equal(s.relationships.r2.tuples[0].entryId, 'c2', 'the keys follow the new identity')
  // c1 remains only on the departed relationship's past documents and the journal
  for (const p of pathsOf(s, 'c1').filter((x) => !x.startsWith('$.acts.'))) {
    const [, part, d] = p.split('.')
    const rkid = part === 'outbox' ? s.outbox[d].recipient.rkid : part === 'effects' ? s.effects[d].ack.recipient.rkid : null
    assert.equal(rkid, w2.B1.keyAgreement, `c1 left at ${p}`)
  }
})

test('2145: a relationship behind two entries sends under the appended tuple\'s (2146) and merges once a mapping connects their anchor heads; it stays apart where a relationship of one holds another binding (6605)', async () => {
  const run = async (copy) => {
    const w = await world({ stars: true })
    const g = (n) => communityContext(w.C.seed, w.C.genesis, n)
    const rot = await makeAnchorRotation(await g(1), await g(2), await g(3))
    const g1 = (await g(1)).anchor, g2 = (await g(2)).anchor
    // r1: an old tuple (deactivated, entry c-old with head g1) and the appended active tuple (entry c1, head g2)
    await edit(w.store, (s) => {
      const r = s.relationships.r1
      const old = { ...structuredClone(r.tuples[0]), ownPairLabel: 'pair/old', rkid: 'z6LSold', deactivated: true, entryId: 'c-old' }
      r.tuples.unshift(old)
      r.heldCounterpartHead = g2
      s.contacts['c-old'] = { id: 'c-old', pos: '0', status: 'admitted', aliases: [], relIds: ['r1'], anchorHead: g1, settings: { ...s.contacts.c1.settings, star: 'off' }, groupSettings: {} }
      s.contacts.c1.pos = '1'; s.contacts.c1.status = 'admitted'; s.contacts.c1.anchorHead = g2
      s.entryOrder.nextPos = '2'
      if (copy) {
        // c-old also holds r3 with a binding of g1 that differs (a copy)
        s.contacts['c-old'].relIds.push('r3'); s.contacts.c3.relIds = []; delete s.contacts.c3
        s.relationships.r3.contactId = 'c-old'; s.relationships.r3.tuples[0].entryId = 'c-old'
        s.relationships.r3.heldCounterpartHead = g1; s.relationships.r3.bindings = { [g1]: ['uEiCopiedBindingCopiedBindingCopiedBindingCopiedBin'] }
      }
    })
    let s = await read(w.store)
    // 2146: r1 sends under c1, once, not under c-old (whose star is off)
    const out = (await w.holder.resume(T0)).outbound.filter((o) => o.recipient.rkid === w.B1.keyAgreement)
    assert.deepEqual([...new Set(out.map((o) => o.recipient.contactId))], ['c1'])
    // the re-issue after the chaining (6985) carries the lineage g1 → g2
    const r = await w.mapOn(w.C, w.B1, { gen: 2, lineage: [rot], revision: '2' }, T0 + 1)
    assert.equal(r.disposition, 'unique')
    s = await read(w.store)
    return { w, s }
  }
  const { w, s } = await run(false)
  assert.deepEqual(Object.values(s.duties).filter((d) => d.kind === 'merge').map((d) => d.entryIds), [['c-old', 'c1']])
  await w.holder.resume(T0 + 2)
  const m = await read(w.store)
  assert.deepEqual([Object.keys(m.contacts).sort(), m.contacts['c-old'].aliases, m.contacts['c-old'].pos], [['c-old', 'c2', 'c3'], ['c1'], '0'])
  assert.equal(m.contacts['c-old'].anchorHead, (await communityContext(w.C.seed, w.C.genesis, 2)).anchor, 'the newest along the lineage (6560)')
  assert.equal(m.contacts['c-old'].settings.star, 'off', '2160: the off holds for the person')
  const apart = await run(true)
  assert.deepEqual(Object.values(apart.s.duties).filter((d) => d.kind === 'merge'), [], 'the binding rule keeps them apart')
})
