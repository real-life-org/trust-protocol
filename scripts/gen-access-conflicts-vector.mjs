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
// re-derives every id, status, state, member set, retained set, epoch,
// policy and policy version, every transition's newEpoch and retained set
// at its position. The fork and lapse cases (policy.change, group.dissolve,
// the last-member leave) follow §3.6 as review 2 left it: the only fork is
// policy.change ∥ enforcement (3495), a dissolution beside an enforcement
// lapses (3460) and its transitions keep counting (3569, 7040), the
// resolver's author is no subject of a sibling removal (3565), a leave
// never lapses (3462), empty membership is terminal (5850).
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
    expected: { state: r.state, members: r.members, pendingExits: r.pendingExits, retained: r.retained, epoch: r.epoch, policy: r.policy, policyVersion: r.policyVersion, transitions: r.transitions, status: r.status }
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
{ // (c) group.dissolve ∥ member.remove — no fork: the dissolution lapses
  const s = setup(); const head = s.at(-1)
  add('group.dissolve ∥ member.remove: the dissolution lapses, the removal takes effect, the state is a group', 'dissolve ∥ removal: lapses',
    ['RLTP-ACC-3460', 'RLTP-ACC-3418', 'RLTP-ACC-3365', 'RLTP-ACC-7010'],
    [...s, op('alice-dissolves', 'dissolve', 'alice', null, null, [head]),
      op('bob-removes-carol', 'remove', 'bob', 'carol', null, [head])])
}
{ // (c') the dissolution issued anew over the merged state ends the group
  const s = setup(); const head = s.at(-1)
  const d = op('alice-dissolves', 'dissolve', 'alice', null, null, [head])
  const rm = op('bob-removes-carol', 'remove', 'bob', 'carol', null, [head])
  const ops = [...s, d, rm, op('alice-dissolves-the-merged-state', 'dissolve', 'alice', null, null, [d, rm])]
  const ids = ops.map((o) => o.id)
  add('the lapsed dissolution of (c) issued anew over the merged state: terminal', 'dissolve ∥ removal: issued anew',
    ['RLTP-ACC-3460', 'RLTP-ACC-3365', 'RLTP-ACC-3385'],
    ops, { deliveryOrders: [ids, [...ids].reverse(), [...ids].sort()],
      comment: 'The new group.dissolve is judged at its own position, whose ancestry holds the lapsed dissolution and the removal: there the state is a group without carol and alice an admin, so it is valid and makes the whole DAG terminal. The first dissolution stays lapsed.' })
}
{ // (d) case (a) continued: bob's policy.change over both heads ends the fork
  const { ops: forkOps, pb, rot } = policyFork()
  const ops = [...forkOps, op('bob-decides-the-fork', 'policy', 'bob', null, null, [rot, pb])]
  const ids = ops.map((o) => o.id)
  add('the fork of (a) ended by a policy.change descending from both siblings, judged against the fork-free prefix', 'fork ended: policy ∥ policy',
    ['RLTP-ACC-3565', 'RLTP-ACC-3567', 'RLTP-ACC-3562', 'RLTP-ACC-7040'],
    ops,
    { deliveryOrders: [ids, [...ids].reverse(), [...ids].sort()],
      comment: 'RLTP-ACC-3565/3567: the resolving policy.change is validated against the maximal prefix free of the fork pairing (here the setup: bob an admin, policy version 1), so its policyVersion is 2; its newEpoch follows RLTP-ACC-7040 over its whole ancestry: the valid transitions there are the two sibling policy.change operations (newEpoch 1 each) and the rotation built on alice\'s change (newEpoch 2), so the resolver\'s is 3. After the end both sibling policy.change operations are lapsed — their policy effect lapses, their transitions keep counting (RLTP-ACC-3569) — and the rotation is canonical. The state\'s epoch is the maximum over canonical and lapsed transitions, 3; the policy in effect is the resolver\'s. The resolver\'s retained set at its position is the merged retained set of the reconciled DAG (RLTP-ACC-3565, 7015): its ancestry with the pairing decided, members minus pending exits — {alice, bob, carol, dave}.' })
}
{ // (e) case (b) ended: the removal takes effect once the fork is decided
  const s = setup(); const head = s.at(-1)
  const pa = op('alice-changes-policy', 'policy', 'alice', null, null, [head])
  const rm = op('bob-removes-carol', 'remove', 'bob', 'carol', null, [head])
  add('the fork of (b) ended by a policy.change descending from both: the sibling policy lapses, the removal takes effect', 'fork ended: policy ∥ removal',
    ['RLTP-ACC-3565', 'RLTP-ACC-3567', 'RLTP-ACC-3395', 'RLTP-ACC-7040'],
    [...s, pa, rm, op('alice-decides-the-fork', 'policy', 'alice', null, null, [pa, rm])],
    { comment: 'RLTP-ACC-3567: the sibling policy.change is lapsed, the sibling removal canonical (carol is no member), the resolver — judged against the setup prefix, policyVersion 2 — sets the policy. Both siblings carry newEpoch 1; the lapsed one keeps counting (RLTP-ACC-3569), so the resolver\'s newEpoch over its whole ancestry is 2 (RLTP-ACC-3565, 7040), and so is the state\'s. A sibling removal that stayed without effect would let the fork undo an authorized removal.' })
}
{ // RLTP-ACC-3572 — one surviving legitimizing admission keeps the issuer
  const s = setup(); const head = s.at(-1)
  const rmBob = op('alice-removes-bob', 'remove', 'alice', 'bob', null, [head])
  const xByAlice = op('alice-adds-x', 'add', 'alice', 'x', 'admin', [head])
  const xByBob = op('bob-adds-x', 'add', 'bob', 'x', 'admin', [head])
  const yByX = op('x-adds-y', 'add', 'x', 'y', 'member', [xByAlice, xByBob])
  add('x admitted concurrently by alice and by bob; only bob is removed: x stays, x\'s admission of y stays canonical', 'admission-orphaned: one admission survives',
    ['RLTP-ACC-3572', 'RLTP-ACC-3585', 'RLTP-ACC-3475', 'RLTP-ACC-3530', 'RLTP-ACC-3570'],
    [...s, rmBob, xByAlice, xByBob, yByX],
    { comment: 'Bob\'s admission of x is disposed (3525); alice\'s is canonical. At x-adds-y both admissions carry x\'s membership, and only one lies in the disposition set, so x is not admission-orphaned there (3572) and the transitive step does not reach y. RLTP-ACC-3545 (\"the subject of a disposed admission MUST NOT be a member\") is read for a subject without a surviving admission: x stays through alice\'s (3475).' })
}
{ // RLTP-ACC-7040 — transitions of unequal depth
  const s = setup(); const head = s.at(-1)
  const r1 = op('dave-rotates', 'rotate', 'dave', null, null, [head])
  add('one branch rotates twice, the other removes once: the merged epoch is the deeper one, 2', 'epoch: unequal depth',
    ['RLTP-ACC-7040', 'RLTP-ACC-3415', 'RLTP-ACC-3417'],
    [...s, r1, op('dave-rotates-again', 'rotate', 'dave', null, null, [r1]),
      op('alice-removes-carol', 'remove', 'alice', 'carol', null, [head])])
}
{ // RLTP-ACC-7010 — the retained set of the merged state
  const create = op('create', 'create', 'alice', 'alice', 'admin', [])
  const addBob = op('add-bob', 'add', 'alice', 'bob', 'admin', [create])
  const addCarol = op('add-carol', 'add', 'alice', 'carol', 'admin', [addBob])
  const addX = op('carol-adds-x', 'add', 'carol', 'x', 'member', [addCarol])
  add('branch 1: alice removes bob; branch 2: carol admits x and rotates — retained set {alice, carol, x}', 'retained set: merged state',
    ['RLTP-ACC-7010', 'RLTP-ACC-3490', 'RLTP-ACC-3415', 'RLTP-ACC-7040'],
    [create, addBob, addCarol, addX,
      op('alice-removes-bob', 'remove', 'alice', 'bob', null, [addCarol]),
      op('carol-rotates', 'rotate', 'carol', null, null, [addX])],
    { comment: 'RLTP-ACC-7015: the merged retained set is the members of the merged materialization minus its pending exits (none here), {alice, carol, x}; not the intersection of the branches\' retained sets ({alice, carol} ∩ {alice, bob, carol, x}), which would strip x of every key. RLTP-ACC-7010 per transition: alice\'s removal reaches {alice, carol} at its position, carol\'s rotation {alice, bob, carol, x} at its own; neither reaches the merged set, which the key port obtains by merge or healing (RLTP-ACC-9255, KV6).' })
}

// After review 2. Two administrators only: alice and bob.
const twoAdmins = () => {
  const create = op('create', 'create', 'alice', 'alice', 'admin', [])
  const addBob = op('add-bob', 'add', 'alice', 'bob', 'admin', [create])
  return [create, addBob]
}
{ // RLTP-ACC-3565 — the resolver's author removed on a sibling
  const s = setup(); const head = s.at(-1)
  const pa = op('alice-changes-policy', 'policy', 'alice', null, null, [head])
  const rmA = op('bob-removes-alice', 'remove', 'bob', 'alice', null, [head])
  add('policy.change ∥ removal of its author: a policy.change by the removed author over both siblings does not end the fork', 'fork: resolver removed on a sibling',
    ['RLTP-ACC-3565', 'RLTP-ACC-3440', 'RLTP-ACC-3568'],
    [...s, pa, rmA, op('alice-would-decide-the-fork', 'policy', 'alice', null, null, [pa, rmA])],
    { comment: 'RLTP-ACC-3565: alice is an admin in the fork-free prefix, but the sibling bob-removes-alice has her as subject, so her policy.change is not valid as the resolving operation. It builds on both siblings and therefore carries the status forked (RLTP-ACC-3568); the state stays forked with the prefix members.' })
}
{ // RLTP-ACC-3462 — a last-member leave beside a rotation stays a leave
  const s = twoAdmins(); const head = s.at(-1)
  const rmBob = op('alice-removes-bob', 'remove', 'alice', 'bob', null, [head])
  const leave = op('alice-leaves-as-last-member', 'leave', 'alice', 'alice', null, [rmBob])
  const rot = op('bob-rotates', 'rotate', 'bob', null, null, [head])
  const ops = [...s, rmBob, leave, rot]
  const ids = ops.map((o) => o.id)
  add('last-member leave ∥ rotation: the leave does not lapse, it merges as an ordinary leave with its discharge open', 'leave ∥ rotation: never lapses',
    ['RLTP-ACC-3462', 'RLTP-ACC-3460', 'RLTP-ACC-5830', 'RLTP-ACC-3395', 'RLTP-ACC-7015'],
    ops, { deliveryOrders: [ids, [...ids].reverse(), [...ids].sort()],
      comment: 'At its own position alice is the only member, so her leave is the last-member leave (RLTP-ACC-5860). Beside bob\'s rotation, an enforcement operation, it MUST NOT lapse (RLTP-ACC-3462): it merges as an ordinary member.leave, alice stays a member in pending exit, no transition in the DAG discharges it (RLTP-ACC-5830), and the state is a group, not terminal. Bob\'s removal takes effect (RLTP-ACC-3395). The merged retained set is the members minus the pending exits (RLTP-ACC-7015): empty — every member is a pending exit, the dormant state of RLTP-ACC-5810/5820. The leave is canonical: its effect as a leave stands, only its terminal effect yields.' })
}
{ // RLTP-ACC-5850 before RLTP-ACC-3460 — concurrent removals empty the membership
  const s = twoAdmins(); const head = s.at(-1)
  add('mutual removal of the only two members beside a dissolution: the dissolution lapses, the empty membership is terminal', 'removals empty the group: terminal',
    ['RLTP-ACC-5850', 'RLTP-ACC-3460', 'RLTP-ACC-3410', 'RLTP-ACC-3569', 'RLTP-ACC-7040'],
    [...s, op('alice-removes-bob', 'remove', 'alice', 'bob', null, [head]),
      op('bob-removes-alice', 'remove', 'bob', 'alice', null, [head]),
      op('alice-dissolves', 'dissolve', 'alice', null, null, [head])],
    { comment: 'Both removals take effect (RLTP-ACC-3410), the dissolution beside them lapses (RLTP-ACC-3460). RLTP-ACC-3460 makes the merged state not terminal "unless its membership is empty": here it is, so RLTP-ACC-5850 governs and the state is terminal; there is no retained set (RLTP-ACC-7015).' })
}

// After review 3: the prefix free of every open pairing (3566), nested
// pairings and the resolver concurrent with an enforcement (3564), the
// resolver's retained set and newEpoch (3565, 7015, 7030).
const policyRemovalFork = () => {
  const s = setup(); const head = s.at(-1)
  const pa = op('alice-changes-policy', 'policy', 'alice', null, null, [head])
  const rm = op('bob-removes-carol', 'remove', 'bob', 'carol', null, [head])
  return { s, head, pa, rm }
}
{ // RLTP-ACC-3566 — an independent admission beside the fork belongs to the prefix
  const { s, head, pa, rm } = policyRemovalFork()
  const addEve = op('alice-adds-eve-beside-the-fork', 'add', 'alice', 'eve', 'admin', [head])
  add('an admission concurrent with the fork that touches no pairing belongs to the fork-free prefix: eve is a member of the forked state', 'fork: independent admission in the prefix',
    ['RLTP-ACC-3566', 'RLTP-ACC-3630', 'RLTP-ACC-3440'],
    [...s, pa, rm, addEve],
    { comment: 'RLTP-ACC-3566: the prefix is the maximal causally closed sub-DAG with no sibling of an open pairing and no descendant of one; alice-adds-eve is concurrent with both siblings but is neither, so it belongs to the prefix and the forked state lists eve (RLTP-ACC-3630). An admission is no enforcement operation, so it forms no pairing (RLTP-ACC-3495).' })
}
{ // RLTP-ACC-3566 continued — the independently admitted member resolves
  const { s, head, pa, rm } = policyRemovalFork()
  const addEve = op('alice-adds-eve-beside-the-fork', 'add', 'alice', 'eve', 'admin', [head])
  const ops = [...s, pa, rm, addEve, op('eve-decides-the-fork', 'policy', 'eve', null, null, [pa, rm, addEve])]
  const ids = ops.map((o) => o.id)
  add('eve, admitted beside the fork, ends it: her standing comes from the prefix that contains her admission', 'fork ended: resolver admitted beside the fork',
    ['RLTP-ACC-3566', 'RLTP-ACC-3565', 'RLTP-ACC-3567', 'RLTP-ACC-7015'],
    ops, { deliveryOrders: [ids, [...ids].reverse(), [...ids].sort()],
      comment: 'The resolver is validated against the maximal prefix of its ancestry free of every open pairing (RLTP-ACC-3565, 3566); that prefix holds eve\'s admission, so eve is an admin there and her policy.change is the resolving operation (policyVersion 2). A prefix read as the closure of the pairing alone would not hold eve, and her resolution would be invalid. Her retained set is the merged one of the reconciled ancestry: carol\'s removal takes effect, {alice, bob, dave, eve} (RLTP-ACC-7015).' })
}
const nestedFork = () => {
  const { s, pa, rm } = policyRemovalFork()
  const pb = op('bob-changes-policy-after-his-removal', 'policy', 'bob', null, null, [rm])
  const rot = op('dave-rotates-after-the-removal', 'rotate', 'dave', null, null, [rm])
  const rB = op('bob-decides-the-inner-fork', 'policy', 'bob', null, null, [pb, rot])
  return { ops: [...s, pa, rm, pb, rot, rB], pa, rB }
}
{ // RLTP-ACC-3564 — a nested pairing inside a fork branch
  const { ops: inner, pa, rB } = nestedFork()
  const ops = [...inner, op('alice-decides-the-outer-fork', 'policy', 'alice', null, null, [pa, rB])]
  const ids = ops.map((o) => o.id)
  add('a pairing nested inside a fork branch, decided inside that branch, is one more open pairing of the outer prefix; the outer resolver ends both, one above every valid transition of its ancestry', 'fork: nested pairing',
    ['RLTP-ACC-3564', 'RLTP-ACC-3565', 'RLTP-ACC-3566', 'RLTP-ACC-3569', 'RLTP-ACC-7040'],
    ops, { deliveryOrders: [ids, [...ids].reverse(), [...ids].sort()],
      comment: 'Branch 1: alice changes the policy. Branch 2: bob removes carol, then bob\'s policy.change and dave\'s rotation pair inside that branch, and bob decides that inner pairing. From the outer resolver\'s ancestry every operation of branch 2 is concurrent with alice\'s change, so all of them, bob\'s inner resolver included, are siblings of open pairings: the prefix is the setup (RLTP-ACC-3564, 3566). Bob\'s inner resolver is valid at its own position: its prefix is the setup with bob\'s removal (the removal pairs with nothing in that ancestry), its newEpoch is max(removal 1, policy 2, rotation 2) + 1 = 3, its retained set the reconciled {alice, bob, dave}. Alice\'s outer resolver counts every valid transition of its ancestry, bob\'s inner one included: newEpoch 4 (RLTP-ACC-3565, 7040). After the end the three sibling policy.change operations lapse and their transitions keep counting (RLTP-ACC-3569); the removal and the rotation are canonical.' })
}
{ // RLTP-ACC-3564 — the resolver concurrent with an enforcement operation forks again
  const { s, pa, rm } = policyRemovalFork()
  const rot = op('alice-rotates-on-her-change', 'rotate', 'alice', null, null, [pa])
  const res = op('bob-would-decide-the-fork', 'policy', 'bob', null, null, [pa, rm])
  add('a resolver concurrent with an enforcement operation forms a new pairing and does not end the fork', 'fork: resolver ∥ enforcement',
    ['RLTP-ACC-3564', 'RLTP-ACC-3565', 'RLTP-ACC-3495', 'RLTP-ACC-3568'],
    [...s, pa, rm, rot, res],
    { comment: 'Bob\'s policy.change holds both siblings of alice-changes-policy ∥ bob-removes-carol, but alice\'s rotation on her own change is concurrent with it: the pair resolver ∥ rotation is a new fork pairing (RLTP-ACC-3495), so the resolver is not canonical and the fork it would have ended stays open (RLTP-ACC-3564, 3565). The rotation is no sibling of the first pairing (it descends from one and is concurrent only with the removal, an enforcement operation), but it builds on a sibling and is forked.' })
  const ops = [...s, pa, rm, rot, res, op('alice-decides-both', 'policy', 'alice', null, null, [rot, res])]
  const ids = ops.map((o) => o.id)
  add('the fork of the resolver ∥ enforcement case ended by a policy.change over all of it', 'fork ended: resolver ∥ enforcement decided',
    ['RLTP-ACC-3564', 'RLTP-ACC-3565', 'RLTP-ACC-3567', 'RLTP-ACC-7040', 'RLTP-ACC-7015'],
    ops, { deliveryOrders: [ids, [...ids].reverse(), [...ids].sort()],
      comment: 'Alice\'s policy.change holds every sibling of both pairings. Its newEpoch: the valid transitions of its ancestry are alice\'s change (1), the removal (1), the rotation (2) and bob\'s resolver, valid at its own position with newEpoch max(1, 1) + 1 = 2; so 3 (RLTP-ACC-3565, 7040). Both earlier policy.change operations lapse (RLTP-ACC-3567, 3569), the removal and the rotation are canonical; retained set {alice, bob, dave}.' })
}
{ // RLTP-ACC-7030 — a resolver whose merged retained set is empty
  const s = twoAdmins(); const head = s.at(-1)
  const pa = op('alice-changes-policy', 'policy', 'alice', null, null, [head])
  const rmA = op('bob-removes-alice', 'remove', 'bob', 'alice', null, [head])
  const leave = op('bob-leaves-after-removing-alice', 'leave', 'bob', 'bob', null, [rmA])
  add('a resolver whose reconciled ancestry leaves no retained member is invalid, and the fork stays open', 'fork: resolver with an empty retained set',
    ['RLTP-ACC-7030', 'RLTP-ACC-7015', 'RLTP-ACC-3565', 'RLTP-ACC-3462'],
    [...s, pa, rmA, leave, op('bob-would-decide-the-fork', 'policy', 'bob', null, null, [pa, leave])],
    { comment: 'Bob is an admin and no pending exit in the fork-free prefix (the two-admin setup), and no sibling removes him, so the resolver passes RLTP-ACC-3565\'s author checks. Its retained set is the merged one of the reconciled ancestry (RLTP-ACC-7015): alice removed, bob\'s leave beside alice\'s policy.change — an enforcement operation — merging as an ordinary leave (RLTP-ACC-3462), so bob is a pending exit and the set is empty; the resolving transition is invalid (RLTP-ACC-7030). It builds on both siblings and is forked; the state stays forked.' })
}

const vector = {
  source: 'RLTP Access Layer 0.54 §3.5 (materialization), §3.6 (the conflict matrix: authority before concurrency, class rules, fork pairings, matrix, removal disposition), §5.4 (leave, pending exit), §7.1 (RLTP-ACC-7010, 7015, 7040); RLTP-ACC-14050. Scenarios S4b, S4c, S4d, S4f, review #11, the removal chain and delivery order, from the port experiments; visibility.change beside a removal and the fork cases (policy.change ∥ policy.change, policy.change ∥ member.remove, and the fork ended) from the vector plan of Access 14; after review 1 the lapsing dissolution (group.dissolve ∥ member.remove, and the dissolution issued anew), one surviving admission against admission-orphaned (RLTP-ACC-3572), transitions of unequal depth (RLTP-ACC-7040) and the merged retained set (RLTP-ACC-7010); after review 2 the resolver whose author a sibling removes (RLTP-ACC-3565), the last-member leave beside a rotation (RLTP-ACC-3462) and removals that empty the group (RLTP-ACC-5850), with lapsed transitions counting for the epoch (RLTP-ACC-3569, 7040) and every transition\'s retained set at its position (RLTP-ACC-7010); after review 3 the prefix free of every open pairing with an independent admission in it (RLTP-ACC-3566), a nested pairing and a resolver concurrent with an enforcement operation (RLTP-ACC-3564), the resolver\'s retained set from the reconciled DAG and its emptiness (RLTP-ACC-3565, 7015, 7030). Generated by scripts/gen-access-conflicts-vector.mjs; the oracle is conformance/access-conflicts.mjs.',
  note: 'Abstract authority DAGs: no signatures, no policy objects, no key material. Party names stand for member anchors. An operation is judged by the state materialized from its own ancestors (RLTP-ACC-3385): an author holding role admin there satisfies member.add, member.remove, visibility.change, policy.change and the collective group.dissolve, any member satisfies epoch.rotate (default any-member, 4.1). A policy object has no content: which policy.change is in effect is the last canonical one folded. A position in the forked state answers fail-closed, except that a policy.change there is the resolving operation and is judged against the maximal prefix of its ancestry free of the fork pairing (RLTP-ACC-3565), whose author MUST NOT be the subject of a removal among the siblings. A leave is valid by its author alone at a position where the author is a member and no pending exit; at a position of sole membership it is the last-member leave (terminal class), which stays an ordinary leave beside an enforcement operation (RLTP-ACC-3462) or a canonical admission (RLTP-ACC-5840); a canonical transition whose ancestry holds a leave discharges it (RLTP-ACC-5830). A pending exit has no policy standing (RLTP-ACC-5750) but may rotate. No devices and no drained dissolve are modelled.',
  format: {
    'cases[].ops[]': '{ label, id, kind, author, subject, role, preds } — label informative; id = "oid:" + unpadded base64url SHA-256 over the JCS of { kind, author, subject, role, preds }; kind ∈ create (group.genesis), add (member.add), remove (member.remove), rotate (epoch.rotate), visibility (visibility.change), policy (policy.change), dissolve (group.dissolve, collective path), leave (member.leave; subject = author); role = the standing an add confers (admin | member), null otherwise; subject null for rotate, visibility, policy and dissolve; preds = op ids',
    'cases[].expected.state': `one of ${STATES.join(', ')} (RLTP-ACC-3365): forked while a policy.change ∥ enforcement pairing (RLTP-ACC-3495) is open, terminal after a canonical group.dissolve or last-member leave, or with empty membership (RLTP-ACC-5850)`,
    'cases[].expected.members': 'member → role after materialization of the whole DAG; in the forked state the members of the maximal prefix free of the open fork pairings (RLTP-ACC-3630)',
    'cases[].expected.pendingExits': 'the members whose leave is canonical and not discharged, sorted (5.4, RLTP-ACC-5830)',
    'cases[].expected.retained': 'the retained set of the merged state, sorted: its members minus its pending exits (RLTP-ACC-7015); null in the forked and the terminal state',
    'cases[].expected.epoch': 'the epoch of the materialized state: the maximum newEpoch over the canonical and lapsed transitions it contains (RLTP-ACC-7040, 3569)',
    'cases[].expected.transitions': 'op id → { newEpoch, retainedAtPosition } for every enforcement operation valid at its position: newEpoch = its position\'s epoch + 1, a resolving policy.change\'s = the maximum newEpoch over the valid transitions of its whole ancestry + 1 (RLTP-ACC-7040, 3565); retainedAtPosition = the members of its position minus a removed subject minus the pending exits there, sorted (RLTP-ACC-7010); for a resolving policy.change the merged retained set of the reconciled DAG — its ancestry materialized with every pairing it contains decided, members minus pending exits (RLTP-ACC-3565, 7015); an enforcement operation, the resolver included, whose retained set is empty is invalid (RLTP-ACC-7030)',
    'cases[].expected.policy': 'the id of the policy.change in effect (the last canonical one folded; after a fork ends, the resolver, 3567), null for the genesis policy',
    'cases[].expected.policyVersion': 'the policy version in effect: 1 at the genesis, a canonical policy.change\'s position version + 1, the resolver\'s the fork-free prefix\'s version + 1 (RLTP-ACC-3565)',
    'cases[].expected.status': `op id → one of ${STATUSES.join(', ')}: forked = a sibling of an open fork pairing or an operation building on one (RLTP-ACC-3440, 3568), greatest under RLTP-ACC-3562; invalid = no authority at its own position (it enters no concurrency rule, RLTP-ACC-3390); removed-disposed = valid but disposed by the removal disposition (RLTP-ACC-3520); lapsed = valid, confers no effect but its epoch transition (RLTP-ACC-3569): a group.dissolve concurrent with an enforcement operation (RLTP-ACC-3460), or a sibling policy.change of an ended fork, whose policy effect lapses (RLTP-ACC-3567); order forked ≻ removed-disposed ≻ lapsed ≻ canonical; canonical otherwise`,
    'cases[].comment': 'optional: the reading of the spec a case fixes where the text leaves it open',
    'cases[].deliveryOrders': 'optional: op-id sequences in which a receiver gets the operations, holding each until its predecessors arrived; every order MUST yield expected',
    'cases[].rules': 'the rules of Access 0.54 the case exercises'
  },
  cases
}
const out = join(ROOT, 'vectors/access-conflicts.json')
writeFileSync(out, JSON.stringify(vector, null, 1) + '\n')
console.log(`vectors/access-conflicts.json written: ${cases.length} cases`)
