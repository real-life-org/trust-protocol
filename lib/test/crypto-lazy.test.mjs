#!/usr/bin/env node
// Crypto at construction, never at import (lib Stage 2, PR 1; design
// note §3 Crypto): a runtime without globalThis.crypto can import the
// library; building a holder then fails with CryptoUnavailableError, or
// works when the app injects a handle.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const DIST = new URL('../dist/', import.meta.url)
const run = (body) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
  delete globalThis.crypto
  const out = {}
  try { ${body} } catch (e) { out.thrown = { name: e.name, message: e.message } }
  console.log(JSON.stringify(out))
`], { encoding: 'utf8', env: { ...process.env, DIST: fileURLToPath(DIST) } }))

test('crypto: dist/index.js and dist/testing.js import without globalThis.crypto', () => {
  const out = run(`
    out.before = typeof globalThis.crypto
    const m = await import(process.env.DIST + 'index.js')
    await import(process.env.DIST + 'testing.js')
    out.ok = typeof m.createHolder === 'function'
  `)
  assert.deepEqual(out, { before: 'undefined', ok: true })
})

test('crypto: without a handle createHolder, seedKeys and randomEntropy throw CryptoUnavailableError', () => {
  const out = run(`
    const { createHolder, seedKeys, randomEntropy, CryptoUnavailableError } = await import(process.env.DIST + 'index.js')
    const { InMemoryStore } = await import(process.env.DIST + 'testing.js')
    const name = (f) => { try { f(); return 'none' } catch (e) { return e instanceof CryptoUnavailableError ? 'CU:' + e.missing.join(',') : e.name } }
    out.seedKeys = name(() => seedKeys(new Uint8Array(64)))
    out.entropy = name(() => randomEntropy())
    const fakeKeys = { anchorOf: async () => ({}), sign: async () => new Uint8Array(), agree: async () => ({ status: 'unknown' }), carrierPrincipal: async () => ({}) }
    try { await createHolder({ store: new InMemoryStore(), keys: fakeKeys }); out.holder = 'none' } catch (e) { out.holder = e instanceof CryptoUnavailableError ? 'CU' : e.name }
  `)
  assert.equal(out.seedKeys, 'CU:subtle')
  assert.equal(out.entropy, 'CU:getRandomValues,randomUUID')
  assert.equal(out.holder, 'CU')
})

test('crypto: an injected handle carries keys, entropy and the engine without the global', () => {
  const out = run(`
    const { webcrypto } = await import('node:crypto')
    const { createHolder, seedKeys } = await import(process.env.DIST + 'index.js')
    const { InMemoryStore } = await import(process.env.DIST + 'testing.js')
    const keys = seedKeys(new Uint8Array(64).fill(3), webcrypto)
    out.anchor = (await keys.anchorOf('persona/Anton')).anchor.slice(0, 9)
    const h = await createHolder({ store: new InMemoryStore(), keys, crypto: webcrypto }, { modules: [{ name: 'm', commands: { 'm.x': { human: true, prepare: async (ctx) => ctx.entropy.id('doc.id'), apply: (s) => ({ state: { ...s } }) } } }] })
    out.act = (await h.act('m.x', {}, 1, { actId: 'a' })).ok
  `)
  assert.deepEqual(out, { anchor: 'did:key:z', act: true })
})

// (The target's first star, group star and probe can reach the requester
// before the relayed reply opens its tuple; they are refused at stage 8 and
// go out again after the sender's backoff, so a few failed dispositions
// belong to this run.)
test('crypto: an injected handle carries a whole encounter, a group and an introduction without the global — scan, receive, signed and MAC acks, every proof check', () => {
  const out = run(`
    const { webcrypto } = await import('node:crypto')
    const { createHolder, seedKeys, digestBytes } = await import(process.env.DIST + 'index.js')
    const { InMemoryStore, stateBuilder, memoryLog } = await import(process.env.DIST + 'testing.js')
    const T0 = Date.parse('2026-10-16T09:00:00Z')
    let n = 0
    const at = (when) => ({ when, actId: 'a' + (++n) })
    const person = async (fill) => {
      const store = new InMemoryStore()
      const genesis = await digestBytes(new Uint8Array(32).fill(fill), webcrypto.subtle)
      await store.commit(null, stateBuilder({ at: T0 }).community(genesis, '1').build())
      const h = await createHolder({ store, keys: seedKeys(new Uint8Array(64).fill(fill), webcrypto), crypto: webcrypto, log: memoryLog(genesis) }, { invariants: true })
      return { h, store }
    }
    const P = [await person(0x51), await person(0x52), await person(0x53)]
    const settle = async (outbound, when) => {
      const q = [...outbound]
      for (let round = 0; round < 12; round++) {
        for (const p of P) q.push(...(await p.h.resume(when)).outbound)
        if (!q.length) return
        while (q.length) {
          const o = q.shift()
          const to = await (async () => { for (const p of P) if (Object.hasOwn((await p.store.read()).state.addresses.keys, o.envelope.rkid)) return p })()
          const r = await to.h.receive(o.envelope, when)
          out.dispositions[r.disposition] = (out.dispositions[r.disposition] ?? 0) + 1
          if (r.disposition === 'unique' || r.disposition === 'duplicate-known') q.push(...r.outbound)
        }
      }
    }
    out.dispositions = {}
    const meet = async (S, D, t) => {
      const shown = await D.h.show(at(t))
      const sc = await S.h.scan(shown.events.find((e) => e.type === 'encounter.shown').card, at(t + 1))
      if (!sc.ok) throw new Error('scan ' + sc.code)
      await settle(sc.outbound, t + 2)
      const [p] = await D.h.prompts()
      await settle((await D.h.decide(p.id, 'accept', at(t + 3))).outbound, t + 4)
      return { s: sc.events.find((e) => e.type === 'contact.added').contactId, d: p.contactId }
    }
    const [A, B, C] = P
    const m1 = await meet(A, B, T0)
    const m2 = await meet(C, B, T0 + 10_000)
    out.mutual = (await A.h.contacts())[0].verification
    const ab = m1.s, ba = m1.d, bc = m2.d
    // a group: B founds, invites A, A accepts, the welcome lands
    const f = await B.h.foundGroup({ name: 'G' }, at(T0 + 20_000))
    const gid = f.events.find((e) => e.type === 'group.founded').groupId
    await settle((await B.h.invite(gid, ba, at(T0 + 20_001))).outbound, T0 + 20_002)
    const [gp] = await A.h.prompts()
    await settle((await A.h.decide(gp.id, 'accept', at(T0 + 20_003))).outbound, T0 + 20_004)
    out.joined = (await A.h.groups()).length
    // an introduction: B introduces A to C
    await settle((await B.h.introduce(ba, bc, at(T0 + 30_000))).outbound, T0 + 30_001)
    const [ip] = (await A.h.prompts()).filter((p) => p.kind === 'introduction')
    await settle((await A.h.decide(ip.id, 'accept', at(T0 + 30_002))).outbound, T0 + 30_003)
    const [tp] = (await C.h.prompts()).filter((p) => p.kind === 'introduction')
    await settle((await C.h.decide(tp.id, 'accept', at(T0 + 30_004))).outbound, T0 + 30_005)
    await settle([], T0 + 70_000)
    out.introduced = (await A.h.contacts()).filter((c) => c.provenance === 'introduced').length
    out.trust = (await A.h.trust(ab, at(T0 + 80_000))).ok
    await settle([], T0 + 80_001)
    out.received = (await B.h.contact(ba)).trust.received
  `)
  assert.equal(out.thrown, undefined, JSON.stringify(out.thrown))
  assert.deepEqual([out.mutual, out.joined, out.introduced, out.trust, out.received], ['mutual', 1, 1, true, true])
  assert.ok(out.dispositions.unique > 40 && out.dispositions['duplicate-known'] > 0, JSON.stringify(out.dispositions))
})
