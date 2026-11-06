#!/usr/bin/env node
// access/log (stage 1 of the group log, rltp design 2026-11): the genesis
// under linear/0.1 (Access 3.4.1), member.add under rules 0–5 (5.3),
// member.leave with the stage-1 membership rule (DEVIATION D2), the
// materialization as a pure function of the accepted set (3335), and the
// admission: form first, proof merge on a known id, held entries for a
// missing parent or ineligible signers, healing ancestor-first, bounds.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { access, anchorOfEd, cardBody, diSignWith, digestDoc, edFromSeed, inviteCredentialBody, mkOfX, xFromSeed } from '../dist/index.js'

const { admit, contentKeyCommitment, emptyLog, envelopeId, formProblem, genesisDigestOf, genesisProblem, genesisUnsigned, materialize, openLog, signEnvelope, signGenesis, STAGE1_BOUNDS } = access
const S = globalThis.crypto.subtle
const T = '2026-11-06T10:00:00Z'
const LATER = '2026-11-07T10:00:00Z'

/** a person with one context anchor: Ed25519 to sign, X25519 as the card's key agreement */
async function person (seed) {
  const ed = await edFromSeed(Uint8Array.from({ length: 32 }, () => seed))
  const x = await xFromSeed(Uint8Array.from({ length: 32 }, () => seed + 1))
  const anchor = anchorOfEd(ed.pubRaw)
  const keyAgreement = mkOfX(x.pubRaw)
  const sign = async (bytes) => new Uint8Array(await S.sign({ name: 'Ed25519' }, ed.priv, bytes))
  const signer = { signer: anchor, sign }
  const card = (name) => diSignWith(anchor, sign, cardBody({ anchor, keyAgreement }, name ? { name } : {}), T, S)
  return { anchor, keyAgreement, sign, signer, card }
}

let counter = 0
/** document and thread ids are uuids (Delivery §3) */
const did = () => globalThis.crypto.randomUUID()

async function founding (founderSeed = 0x10) {
  ++counter
  const founder = await person(founderSeed)
  const groupKey = await edFromSeed(Uint8Array.from({ length: 32 }, () => 0x99 - founderSeed))
  const group = anchorOfEd(groupKey.pubRaw)
  const gk = { signer: group, sign: async (b) => new Uint8Array(await S.sign({ name: 'Ed25519' }, groupKey.priv, b)) }
  const contentKey = Uint8Array.from({ length: 32 }, (_, i) => i)
  const unsigned = await genesisUnsigned({ group, founder: founder.anchor, card: await founder.card('Founder'), serviceIdentity: founder.anchor, contentKey }, S)
  const genesis = await signGenesis(unsigned, gk, founder.signer, S)
  const digest = await genesisDigestOf(genesis, S)
  return { founder, group, gk, genesis, digest, log: emptyLog(digest, genesis) }
}

/** the invite and accept documents of Membership 3.1/3.2 for one admission */
async function admission (f, inviter, invitee, validUntil = LATER, threadId = did()) {
  const cred = inviteCredentialBody({ issuer: inviter.anchor, invitee: invitee.anchor, group: f.group, genesisDigest: f.digest, card: await inviter.card('Inviter'), validFrom: T, validUntil, taskContext: threadId })
  const invite = await diSignWith(inviter.anchor, inviter.sign, cred, T, S)
  const inviteDoc = { id: did(), type: 'https://real-life.org/trust-tasks/spec/membership-invite/0.2', issuer: inviter.anchor, recipient: invitee.anchor, threadId, issuedAt: T, payload: { invite } }
  const ref = await digestDoc(invite, S)
  const acceptBody = { id: did(), type: 'https://real-life.org/trust-tasks/spec/membership-accept/0.2', issuer: invitee.anchor, recipient: inviter.anchor, threadId, issuedAt: T, payload: { accept: { group: f.group, subject: invitee.anchor, ref, card: await invitee.card('Invitee'), candidacy: true } } }
  const accept = await diSignWith(invitee.anchor, invitee.sign, acceptBody, T, S)
  return { invite: inviteDoc, accept, welcome: await digestDoc({ welcome: threadId }, S) }
}

const heads = async (log) => (await materialize(log, S)).heads

async function addOp (f, inviter, invitee, prev, adm) {
  const a = adm ?? await admission(f, inviter, invitee)
  const unsigned = { v: 'rltp-access/0.25', op: 'member.add', group: f.group, epoch: 0, policyVersion: 1, prev, body: { subject: invitee.anchor, admission: a }, author: inviter.anchor }
  return signEnvelope(unsigned, [inviter.signer], S)
}
async function leaveOp (f, who, prev) {
  return signEnvelope({ v: 'rltp-access/0.25', op: 'member.leave', group: f.group, epoch: 0, policyVersion: 1, prev, body: {}, author: who.anchor }, [who.signer], S)
}
const at = (source) => ({ source, now: 1_000 })
const members = async (log) => (await materialize(log, S)).members

test('genesis under linear/0.1: schema-valid, two signatures, the identity is the digest over its signing input (3030), validated on its own (3.4.1)', async () => {
  const f = await founding()
  assert.equal(await formProblem(f.genesis, S), null)
  assert.equal(await genesisProblem(f.genesis, S), null)
  assert.equal(f.genesis.op, 'group.genesis')
  assert.equal(f.genesis.body.adapter, 'linear/0.1')
  assert.equal(f.genesis.body.contentKeyCommitment, await contentKeyCommitment(Uint8Array.from({ length: 32 }, (_, i) => i), S))
  assert.match(f.digest, /^u/)
  assert.equal(f.genesis.id, await envelopeId(f.genesis, S))
  const m = await materialize(f.log, S)
  assert.deepEqual(m.members, [f.founder.anchor])
  assert.equal(m.memberOp[f.founder.anchor], f.genesis.id)
  assert.equal(m.keyAgreement[f.founder.anchor], f.founder.keyAgreement)
  assert.deepEqual(m.heads, [f.genesis.id])
})

test('genesis problems: the group DID must not be the founder (3230), members exactly the founder (3235), the card at the founder (3240)', async () => {
  const f = await founding()
  const other = await person(0x42)
  const bad = async (patch) => {
    const u = await genesisUnsigned({ group: f.group, founder: f.founder.anchor, card: await f.founder.card(), serviceIdentity: f.founder.anchor, contentKey: new Uint8Array(32) }, S)
    return patch(u)
  }
  const sameKey = await signEnvelope({ ...(await bad((u) => u)), group: f.founder.anchor }, [f.founder.signer, { signer: f.founder.anchor, sign: f.founder.sign }], S)
  assert.notEqual(await genesisProblem(sameKey, S), null)
  const wrongMembers = await signGenesis(await bad((u) => ({ ...u, body: { ...u.body, members: [other.anchor] } })), f.gk, f.founder.signer, S)
  assert.equal(await genesisProblem(wrongMembers, S), 'members')
  const wrongCard = await signGenesis(await bad(async (u) => ({ ...u, body: { ...u.body, card: await other.card() } })), f.gk, f.founder.signer, S)
  assert.equal(await genesisProblem(wrongCard, S), 'card')
  assert.equal(await genesisProblem({ ...f.genesis, body: { ...f.genesis.body, visibility: 'sealed' } }, S), 'form')
})

test('member.add by the founder: canonical, the subject a member with its accept card key; the add is the head', async () => {
  const f = await founding()
  const noah = await person(0x20)
  const add = await addOp(f, f.founder, noah, await heads(f.log))
  const r = await admit(f.log, add, at('jonas'), S)
  assert.equal(r.verdict.kind, 'applied')
  const m = await materialize(r.log, S)
  assert.deepEqual(m.members, [f.founder.anchor, noah.anchor].sort())
  assert.equal(m.memberOp[noah.anchor], add.id)
  assert.equal(m.keyAgreement[noah.anchor], noah.keyAgreement)
  assert.deepEqual(m.heads, [add.id])
  assert.equal(m.verdict[add.id], 'canonical')
})

test('form first: a tampered envelope is invalid; a known id merges the proof and has no second effect; an unregistered op is invalid', async () => {
  const f = await founding()
  const noah = await person(0x20)
  const add = await addOp(f, f.founder, noah, await heads(f.log))
  const tampered = { ...add, body: { ...add.body, subject: f.founder.anchor } }
  assert.deepEqual((await admit(f.log, tampered, at('x'), S)).verdict, { kind: 'invalid', problem: 'id' })
  const once = await admit(f.log, add, at('x'), S)
  const twice = await admit(once.log, add, at('y'), S)
  assert.deepEqual(twice.verdict, { kind: 'duplicate' })
  assert.equal(twice.log, once.log)
  const unregistered = await signEnvelope({ ...add, op: 'member.teleport', id: undefined, proof: undefined }, [f.founder.signer], S)
  assert.deepEqual((await admit(f.log, unregistered, at('x'), S)).verdict, { kind: 'invalid', problem: 'unregistered-op' })
})

test('a missing parent holds the entry; the parent heals it ancestor-first (5720), both applied', async () => {
  const f = await founding()
  const noah = await person(0x20)
  const lea = await person(0x30)
  const addNoah = await addOp(f, f.founder, noah, await heads(f.log))
  const addLea = await addOp(f, f.founder, lea, [addNoah.id])
  const r1 = await admit(f.log, addLea, at('jonas'), S)
  assert.deepEqual(r1.verdict, { kind: 'held', reason: 'missing-parent' })
  assert.deepEqual(await members(r1.log), [f.founder.anchor])
  const r2 = await admit(r1.log, addNoah, at('jonas'), S)
  assert.deepEqual(r2.verdict, { kind: 'applied', healed: [addLea.id] })
  assert.deepEqual(await members(r2.log), [f.founder.anchor, noah.anchor, lea.anchor].sort())
  assert.deepEqual(Object.keys(r2.log.held), [])
})

test('an author who is not a member at the position is not an eligible signer (3315, 3130): held as ineligible, never applied', async () => {
  const f = await founding()
  const stranger = await person(0x50)
  const mara = await person(0x60)
  const add = await addOp(f, stranger, mara, await heads(f.log))
  const r = await admit(f.log, add, at('stranger'), S)
  assert.deepEqual(r.verdict, { kind: 'held', reason: 'ineligible' })
  assert.deepEqual(await members(r.log), [f.founder.anchor])
})

test('rule 0 and rule 5: a second admission of a member is not canonical; a replayed accept is not canonical (5470)', async () => {
  const f = await founding()
  const noah = await person(0x20)
  const adm = await admission(f, f.founder, noah)
  const add1 = await addOp(f, f.founder, noah, await heads(f.log), adm)
  const r1 = await admit(f.log, add1, at('j'), S)
  const add2 = await addOp(f, f.founder, noah, [add1.id], adm)
  const r2 = await admit(r1.log, add2, at('j'), S)
  assert.equal(r2.verdict.kind, 'applied')
  const m = await materialize(r2.log, S)
  assert.equal(m.verdict[add2.id], 'not-canonical')
  assert.equal(m.memberOp[noah.anchor], add1.id)
})

test('concurrent admissions of one subject do not void one another (3360): both canonical, the smaller id names the member', async () => {
  const f = await founding()
  const noah = await person(0x20)
  const lea = await person(0x30)
  const addLea = await addOp(f, f.founder, lea, await heads(f.log))
  let log = (await admit(f.log, addLea, at('j'), S)).log
  const byJonas = await addOp(f, f.founder, noah, [addLea.id])
  const byLea = await addOp(f, lea, noah, [addLea.id])
  log = (await admit(log, byJonas, at('j'), S)).log
  log = (await admit(log, byLea, at('l'), S)).log
  const m = await materialize(log, S)
  assert.equal(m.verdict[byJonas.id], 'canonical')
  assert.equal(m.verdict[byLea.id], 'canonical')
  assert.equal(m.memberOp[noah.anchor], [byJonas.id, byLea.id].sort()[0])
  assert.deepEqual(m.heads, [byJonas.id, byLea.id].sort())
})

test('member.leave: the leaver is out at once; a leave defeats a concurrent admission of its subject; no re-admission (DEVIATION D2)', async () => {
  const f = await founding()
  const noah = await person(0x20)
  const lea = await person(0x30)
  const g = await heads(f.log)
  // two concurrent branches from the genesis: Jonas admits Noah; Jonas admits Lea, who admits Noah herself
  const addNoah = await addOp(f, f.founder, noah, g)
  const addLea = await addOp(f, f.founder, lea, g)
  const byLea = await addOp(f, lea, noah, [addLea.id])
  let log = (await admit(f.log, addNoah, at('j'), S)).log
  const leave = await leaveOp(f, noah, [addNoah.id])
  const r = await admit(log, leave, at('n'), S)
  assert.equal(r.verdict.kind, 'applied')
  assert.deepEqual(await members(r.log), [f.founder.anchor])
  // the other branch arrives: Lea's admission of Noah is canonical at its position (Noah no member there), and the leave defeats it
  log = (await admit(r.log, addLea, at('j'), S)).log
  const r2 = await admit(log, byLea, at('l'), S)
  assert.equal(r2.verdict.kind, 'applied')
  const m2 = await materialize(r2.log, S)
  assert.equal(m2.verdict[byLea.id], 'canonical')
  assert.deepEqual(m2.members, [f.founder.anchor, lea.anchor].sort())
  // a re-admission after the leave is not canonical (rule 0 with the leave read as a pending exit)
  const after = await addOp(f, lea, noah, [leave.id, byLea.id])
  const r3 = await admit(r2.log, after, at('l'), S)
  assert.equal(r3.verdict.kind, 'applied')
  assert.equal((await materialize(r3.log, S)).verdict[after.id], 'not-canonical')
  assert.ok(!(await members(r3.log)).includes(noah.anchor))
  // and a second admission at a position where the subject is a member is not canonical (rule 0)
  const dup = await addOp(f, f.founder, noah, [addNoah.id])
  const r4 = await admit(r.log, dup, at('j'), S)
  assert.equal((await materialize(r4.log, S)).verdict[dup.id], 'not-canonical')
})

test('a leave of a non-member is held as ineligible; a leave at sole membership dissolves the group (4410), nothing after it takes effect', async () => {
  const f = await founding()
  const stranger = await person(0x50)
  const l1 = await leaveOp(f, stranger, await heads(f.log))
  assert.deepEqual((await admit(f.log, l1, at('s'), S)).verdict, { kind: 'held', reason: 'ineligible' })
  const noah = await person(0x20)
  const bye = await leaveOp(f, f.founder, await heads(f.log))
  const r = await admit(f.log, bye, at('j'), S)
  assert.equal(r.verdict.kind, 'applied')
  const m = await materialize(r.log, S)
  assert.equal(m.dissolved, true)
  assert.deepEqual(m.members, [])
  const late = await addOp(f, f.founder, noah, [bye.id])
  const r2 = await admit(r.log, late, at('j'), S)
  // the founder is no member at that position: not an eligible signer
  assert.deepEqual(r2.verdict, { kind: 'held', reason: 'ineligible' })
})

test('the materialization is a pure function of the accepted set: two arrival orders, one result', async () => {
  const f = await founding()
  const noah = await person(0x20)
  const lea = await person(0x30)
  const addNoah = await addOp(f, f.founder, noah, await heads(f.log))
  const addLea = await addOp(f, f.founder, lea, [addNoah.id])
  const leave = await leaveOp(f, noah, [addLea.id])
  const again = await addOp(f, lea, noah, [addLea.id])
  const ops = [addNoah, addLea, leave, again]
  const run = async (order) => {
    let log = f.log
    for (const i of order) log = (await admit(log, ops[i], at('x'), S)).log
    const m = await materialize(log, S)
    return { members: m.members, verdict: m.verdict, heads: m.heads, held: Object.keys(log.held) }
  }
  const a = await run([0, 1, 2, 3])
  const b = await run([3, 2, 1, 0])
  assert.deepEqual(a, b)
  assert.deepEqual(a.held, [])
})

test('bounds: held intake is refused at the group bound (rate-limited); the own partition evicts largest-first', async () => {
  const f = await founding()
  const noah = await person(0x20)
  const lea = await person(0x30)
  const addNoah = await addOp(f, f.founder, noah, await heads(f.log))
  const orphans = []
  for (let i = 0; i < 4; i++) orphans.push(await addOp(f, f.founder, await person(0x70 + i), [addNoah.id]))
  const bounds = { ...STAGE1_BOUNDS, perSource: 2, perGroup: 3 }
  let log = f.log
  const r0 = await admit(log, orphans[0], { source: 'a', now: 1, bounds }, S)
  const r1 = await admit(r0.log, orphans[1], { source: 'a', now: 2, bounds }, S)
  const r2 = await admit(r1.log, orphans[2], { source: 'a', now: 3, bounds }, S)
  assert.equal(r2.verdict.kind, 'held')
  assert.equal(Object.keys(r2.log.held).length, 2, 'the partition stays at its bound by eviction')
  const r3 = await admit(r2.log, orphans[3], { source: 'b', now: 4, bounds }, S)
  assert.equal(r3.verdict.kind, 'held')
  const r4 = await admit(r3.log, await addOp(f, f.founder, lea, [addNoah.id]), { source: 'c', now: 5, bounds }, S)
  assert.deepEqual(r4.verdict, { kind: 'rate-limited' })
  assert.deepEqual(Object.keys(r4.log.held).length, 3)
})

test('openLog: a newcomer starts from a genesis validated against the digest its invite pinned (3070, 3085)', async () => {
  const f = await founding()
  const ok = await openLog(f.genesis, f.digest, S)
  assert.ok('log' in ok)
  const wrong = await openLog(f.genesis, 'u' + 'A'.repeat(46), S)
  assert.deepEqual(wrong, { problem: 'genesis-digest' })
  const other = await founding(0x11)
  assert.deepEqual(await openLog(other.genesis, f.digest, S), { problem: 'genesis-digest' })
})
