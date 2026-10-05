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
// re-derives every id, status, state, member set, epoch and policy.
// The fork cases (policy.change, group.dissolve) follow the vector plan
// of Access 14.
//
//   usage: node scripts/gen-access-conflicts-vector.mjs
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { opId, materialize, deliver, STATUSES, STATES } from '../conformance/access-conflicts.mjs'

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
    expected: { state: r.state, members: r.members, epoch: r.epoch, policy: r.policy, status: r.status }
  }
  if (extra.comment) c.comment = extra.comment
  if (extra.deliveryOrders) {
    for (const order of extra.deliveryOrders) {
      const d = deliver(ops, order)
      if (JSON.stringify(d) !== JSON.stringify(r)) {
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
{ // visibility.change concurrent with a removal (Access 14 vector plan)
  const s = setup(); const head = s.at(-1)
  add('a visibility change and a concurrent removal both take effect; one merged epoch', 'visibility ∥ removal',
    ['RLTP-ACC-3435', 'RLTP-ACC-7040'],
    [...s, op('alice-removes-carol', 'remove', 'alice', 'carol', null, [head]),
      op('bob-opens-visibility', 'visibility', 'bob', null, null, [head])])
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

// The fork pairings (Access 14 vector plan): alice and bob are admins.
// (a) policy.change ∥ policy.change; alice also rotates on her own
// change, so the rotation is a further sibling (it is an enforcement
// operation concurrent with bob's policy.change) and builds on a sibling.
const policyFork = () => {
  const s = setup(); const head = s.at(-1)
  const pa = op('alice-changes-policy', 'policy', 'alice', null, null, [head])
  const pb = op('bob-changes-policy', 'policy', 'bob', null, null, [head])
  const rot = op('alice-rotates-on-her-change', 'rotate', 'alice', null, null, [pa])
  return { ops: [...s, pa, pb, rot], pb, rot }
}
{
  const { ops } = policyFork()
  add('policy.change ∥ policy.change: forked; members of the maximal fork-free prefix; both siblings and what builds on them forked', 'fork: policy ∥ policy',
    ['RLTP-ACC-3495', 'RLTP-ACC-3440', 'RLTP-ACC-3562', 'RLTP-ACC-3630'], ops)
}
{ // (b) policy.change ∥ member.remove
  const s = setup(); const head = s.at(-1)
  add('policy.change ∥ member.remove: forked; the removal confers no effect, carol stays in the prefix member set', 'fork: policy ∥ removal',
    ['RLTP-ACC-3495', 'RLTP-ACC-3440', 'RLTP-ACC-3345', 'RLTP-ACC-3630'],
    [...s, op('alice-changes-policy', 'policy', 'alice', null, null, [head]),
      op('bob-removes-carol', 'remove', 'bob', 'carol', null, [head])])
}
{ // (c) group.dissolve ∥ member.remove
  const s = setup(); const head = s.at(-1)
  add('group.dissolve ∥ member.remove: forked, not terminal; members of the prefix', 'fork: dissolve ∥ removal',
    ['RLTP-ACC-3460', 'RLTP-ACC-3440', 'RLTP-ACC-3365', 'RLTP-ACC-3630'],
    [...s, op('alice-dissolves', 'dissolve', 'alice', null, null, [head]),
      op('bob-removes-carol', 'remove', 'bob', 'carol', null, [head])])
}
{ // (d) case (a) continued: bob's policy.change over both heads ends the fork
  const { ops: forkOps, pb, rot } = policyFork()
  const ops = [...forkOps, op('bob-decides-the-fork', 'policy', 'bob', null, null, [rot, pb])]
  const ids = ops.map((o) => o.id)
  add('the fork of (a) ended by a policy.change descending from both siblings; statuses re-derived over the reconciled DAG', 'fork ended: policy ∥ policy',
    ['RLTP-ACC-3565', 'RLTP-ACC-3562', 'RLTP-ACC-3430', 'RLTP-ACC-7040'],
    ops,
    { deliveryOrders: [ids, [...ids].reverse(), [...ids].sort()],
      comment: 'Reading of RLTP-ACC-3565 (not settled by the spec text): the closing policy.change is judged against its ancestry with every fork pairing in it counted as decided; once it is canonical the pairing no longer counts, and the former siblings are re-derived by the ordinary rules. They become canonical (3565 names canonical and removed-disposed as the outcomes); their transitions count for the epoch, and the policy in effect is the closing one, folded after both. A sibling policy.change is thus canonical but superseded.' })
}
{ // (e) case (b) ended: the removal takes effect once the fork is decided
  const s = setup(); const head = s.at(-1)
  const pa = op('alice-changes-policy', 'policy', 'alice', null, null, [head])
  const rm = op('bob-removes-carol', 'remove', 'bob', 'carol', null, [head])
  add('the fork of (b) ended by a policy.change descending from both: the removal takes effect', 'fork ended: policy ∥ removal',
    ['RLTP-ACC-3565', 'RLTP-ACC-3395', 'RLTP-ACC-7040'],
    [...s, pa, rm, op('alice-decides-the-fork', 'policy', 'alice', null, null, [pa, rm])],
    { comment: 'Same reading as the fork ended in (a): re-derived, the removal sibling is canonical and carol is no member; a sibling that stayed without effect would let the fork undo an authorized removal.' })
}

const vector = {
  source: 'RLTP Access Layer 0.54 §3.5 (materialization), §3.6 (the conflict matrix: authority before concurrency, class rules, fork pairings, matrix, removal disposition), §7.1 (RLTP-ACC-7040); RLTP-ACC-14050. Scenarios S4b, S4c, S4d, S4f, review #11, the removal chain and delivery order, from the port experiments; visibility.change beside a removal and the fork cases (policy.change ∥ policy.change, policy.change ∥ member.remove, group.dissolve ∥ member.remove, and the fork ended) from the vector plan of Access 14. Generated by scripts/gen-access-conflicts-vector.mjs; the oracle is conformance/access-conflicts.mjs.',
  note: 'Abstract authority DAGs: no signatures, no policy objects, no key material. Party names stand for member anchors. An operation is judged by the state materialized from its own ancestors (RLTP-ACC-3385): an author holding role admin there satisfies member.add, member.remove, visibility.change, policy.change and the collective group.dissolve, any member satisfies epoch.rotate (default any-member, 4.1). A policy object has no content: which policy.change is in effect is the last canonical one folded. A position in the forked state answers fail-closed, except that a policy.change there is judged against its ancestry with every fork pairing in it decided (the reading of RLTP-ACC-3565 these vectors fix; see the case comments).',
  format: {
    'cases[].ops[]': '{ label, id, kind, author, subject, role, preds } — label informative; id = "oid:" + unpadded base64url SHA-256 over the JCS of { kind, author, subject, role, preds }; kind ∈ create (group.genesis), add (member.add), remove (member.remove), rotate (epoch.rotate), visibility (visibility.change), policy (policy.change), dissolve (group.dissolve, collective path); role = the standing an add confers (admin | member), null otherwise; subject null for rotate, visibility, policy and dissolve; preds = op ids',
    'cases[].expected.state': `one of ${STATES.join(', ')} (RLTP-ACC-3365): forked while a fork pairing (RLTP-ACC-3495, 3460) is open, terminal after a canonical group.dissolve`,
    'cases[].expected.members': 'member → role after materialization of the whole DAG; in the forked state the members of the maximal prefix free of the open fork pairings (RLTP-ACC-3630)',
    'cases[].expected.epoch': 'the merged epoch: the largest position epoch + 1 over canonical enforcement operations (concurrent transitions from one position share their newEpoch, RLTP-ACC-7040)',
    'cases[].expected.policy': 'the id of the policy.change in effect (the last canonical one folded), null for the genesis policy',
    'cases[].expected.status': `op id → one of ${STATUSES.join(', ')}: forked = a sibling of an open fork pairing or an operation building on one (RLTP-ACC-3440), greatest under RLTP-ACC-3562; invalid = no authority at its own position (it enters no concurrency rule, RLTP-ACC-3390); removed-disposed = valid but disposed by the removal disposition (RLTP-ACC-3520); canonical otherwise`,
    'cases[].comment': 'optional: the reading of the spec a case fixes where the text leaves it open',
    'cases[].deliveryOrders': 'optional: op-id sequences in which a receiver gets the operations, holding each until its predecessors arrived; every order MUST yield expected',
    'cases[].rules': 'the rules of Access 0.54 the case exercises'
  },
  cases
}
const out = join(ROOT, 'vectors/access-conflicts.json')
writeFileSync(out, JSON.stringify(vector, null, 1) + '\n')
console.log(`vectors/access-conflicts.json written: ${cases.length} cases`)
