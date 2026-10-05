#!/usr/bin/env node
// Generates vectors/access-conflicts.json — deterministic authority DAGs
// and their materialization under the conflict matrix of Access 0.54
// §3.5–3.6 (RLTP-ACC-14050). The scenarios are those of the port
// experiments (port-experimente tests/authority.test.ts), re-decided by
// 0.54: removals with authority always take effect, also along a chain.
//
// Deterministic: every operation id is the oid: digest of its own JCS
// form (conformance/access-conflicts.mjs opId). Re-running this script
// reproduces the vector file byte-for-byte; conformance/runner.mjs
// re-derives every id, status, member set and epoch.
//
//   usage: node scripts/gen-access-conflicts-vector.mjs
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { opId, materialize, deliver, STATUSES } from '../conformance/access-conflicts.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// An operation on explicit predecessors; `label` is informative only.
const op = (label, kind, author, subject, role, preds) => {
  const o = { kind, author, subject, role, preds: preds.map((p) => p.id) }
  return { label, id: opId(o), ...o }
}

// The common start of every case: alice founds; bob joins as admin,
// carol and dave as members, in one causal chain.
const setup = () => {
  const create = op('create', 'create', 'alice', 'alice', 'admin', [])
  const addBob = op('add-bob', 'add', 'alice', 'bob', 'admin', [create])
  const addCarol = op('add-carol', 'add', 'alice', 'carol', 'member', [addBob])
  const addDave = op('add-dave', 'add', 'alice', 'dave', 'member', [addCarol])
  return [create, addBob, addCarol, addDave]
}

const cases = []
const add = (name, scenario, rules, ops, extra = {}) => {
  const r = materialize(ops)
  const c = {
    name,
    scenario,
    rules,
    ops,
    expected: { members: r.members, epoch: r.epoch, status: r.status }
  }
  if (extra.deliveryOrders) {
    for (const order of extra.deliveryOrders) {
      const d = deliver(ops, order)
      if (JSON.stringify(d.members) !== JSON.stringify(r.members) || JSON.stringify(d.status) !== JSON.stringify(r.status)) {
        throw new Error(`${name}: delivery order changes the result`)
      }
    }
    c.deliveryOrders = extra.deliveryOrders
  }
  cases.push(c)
}

{ // S4b — two concurrent removals of different subjects
  const s = setup(); const head = s.at(-1)
  add('two concurrent removals with authority of different subjects both take effect', 'S4b',
    ['RLTP-ACC-3395', 'RLTP-ACC-3405', 'RLTP-ACC-7040'],
    [...s, op('alice-removes-carol', 'remove', 'alice', 'carol', null, [head]),
      op('bob-removes-dave', 'remove', 'bob', 'dave', null, [head])])
}
{ // S4c — mutual removal
  const s = setup(); const head = s.at(-1)
  add('mutual removal: both removals take effect, both subjects leave', 'S4c',
    ['RLTP-ACC-3395', 'RLTP-ACC-3400', 'RLTP-ACC-3410'],
    [...s, op('alice-removes-bob', 'remove', 'alice', 'bob', null, [head]),
      op('bob-removes-alice', 'remove', 'bob', 'alice', null, [head])])
}
{ // removal chain — A removes B while B removes C
  const s = setup(); const head = s.at(-1)
  add('removal chain: alice removes bob while bob removes carol — both take effect', 'removal chain',
    ['RLTP-ACC-3395', 'RLTP-ACC-3400'],
    [...s, op('alice-removes-bob', 'remove', 'alice', 'bob', null, [head]),
      op('bob-removes-carol', 'remove', 'bob', 'carol', null, [head])])
}
{ // S4d — removal concurrent with a rotation
  const s = setup(); const head = s.at(-1)
  add('a removal and a concurrent rotation both take effect; one merged epoch', 'S4d',
    ['RLTP-ACC-3415', 'RLTP-ACC-7040', 'RLTP-ACC-9310'],
    [...s, op('alice-removes-carol', 'remove', 'alice', 'carol', null, [head]),
      op('dave-rotates', 'rotate', 'dave', null, null, [head])])
}
// S4f — the removed subject's concurrent admission, and what that admitted
// party added, are disposed transitively; built on both heads, the next
// admission is judged at a position where x is no member and is invalid.
const s4f = () => {
  const s = setup(); const head = s.at(-1)
  const rmBob = op('alice-removes-bob', 'remove', 'alice', 'bob', null, [head])
  const addX = op('bob-adds-x', 'add', 'bob', 'x', 'admin', [head])
  const addY = op('x-adds-y', 'add', 'x', 'y', 'member', [addX])
  const addZ = op('x-adds-z-after-merge', 'add', 'x', 'z', 'member', [rmBob, addY])
  return [...s, rmBob, addX, addY, addZ]
}
add('strong removal: the removed admin\'s concurrent admission and its descendants are disposed transitively', 'S4f',
  ['RLTP-ACC-3385', 'RLTP-ACC-3520', 'RLTP-ACC-3525', 'RLTP-ACC-3540', 'RLTP-ACC-3545', 'RLTP-ACC-3570'],
  s4f())
{ // review #11 — an unauthorized removal suppresses nothing
  const s = setup(); const head = s.at(-1)
  add('an unauthorized concurrent removal suppresses no valid admission', 'review #11',
    ['RLTP-ACC-3385', 'RLTP-ACC-3390', 'RLTP-ACC-3580'],
    [...s, op('alice-adds-eve', 'add', 'alice', 'eve', 'member', [head]),
      op('carol-removes-alice', 'remove', 'carol', 'alice', null, [head])])
}
{ // delivery order — the S4f DAG, delivered in three orders
  const ops = s4f()
  const ids = ops.map((o) => o.id)
  add('delivery order does not change the result (the S4f DAG in three orders)', 'delivery order',
    ['RLTP-ACC-3335', 'RLTP-ACC-3340', 'RLTP-ACC-3550'],
    ops, { deliveryOrders: [ids, [...ids].reverse(), [...ids].sort()] })
}

const vector = {
  source: 'RLTP Access Layer 0.54 §3.5 (materialization), §3.6 (the conflict matrix: authority before concurrency, class rules, matrix, removal disposition), §7.1 (RLTP-ACC-7040); RLTP-ACC-14050. Scenarios S4b, S4c, S4d, S4f, review #11, the removal chain and delivery order, from the port experiments. Generated by scripts/gen-access-conflicts-vector.mjs; the oracle is conformance/access-conflicts.mjs.',
  note: 'Abstract authority DAGs: no signatures, no policy objects, no key material. Party names stand for member anchors. An operation is judged by the state materialized from its own ancestors (RLTP-ACC-3385): an author holding role admin there satisfies member.add and member.remove, any member satisfies epoch.rotate (default any-member, 4.1). The forked pairings (policy.change, terminal operations) are not exercised here.',
  format: {
    'cases[].ops[]': '{ label, id, kind, author, subject, role, preds } — label informative; id = "oid:" + unpadded base64url SHA-256 over the JCS of { kind, author, subject, role, preds }; kind ∈ create (group.genesis), add (member.add), remove (member.remove), rotate (epoch.rotate); role = the standing an add confers (admin | member), null otherwise; subject null for rotate; preds = op ids',
    'cases[].expected.members': 'member → role after materialization of the whole DAG',
    'cases[].expected.epoch': 'the merged epoch: the largest position epoch + 1 over canonical enforcement operations (concurrent transitions from one position share their newEpoch, RLTP-ACC-7040)',
    'cases[].expected.status': `op id → one of ${STATUSES.join(', ')}: invalid = no authority at its own position (it enters no concurrency rule, RLTP-ACC-3390); removed-disposed = valid but disposed by the removal disposition (RLTP-ACC-3520); canonical otherwise`,
    'cases[].deliveryOrders': 'optional: op-id sequences in which a receiver gets the operations, holding each until its predecessors arrived; every order MUST yield expected',
    'cases[].rules': 'the rules of Access 0.54 the case exercises'
  },
  cases
}
const out = join(ROOT, 'vectors/access-conflicts.json')
writeFileSync(out, JSON.stringify(vector, null, 1) + '\n')
console.log(`vectors/access-conflicts.json written: ${cases.length} cases`)
