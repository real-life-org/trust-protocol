// Reference materialization of an abstract authority DAG under the
// conflict matrix of Access 0.54 §3.5–3.6 — the oracle behind
// vectors/access-conflicts.json.
//
// The model abstracts from signatures and policies. An operation is
//   { id, kind, author, subject, role, preds }
// with kind ∈ create | add | remove | rotate. `role` (admin | member) is
// the standing an `add` confers; an author's standing at an operation's
// position stands for the policy: an `admin` satisfies `member.add` and
// `member.remove` (and creates the group), any member satisfies
// `epoch.rotate` (its default `any-member`, Access 4.1).
//
// The fold follows the spec, in this order:
//   1. authority first (RLTP-ACC-3385): each operation is judged by the
//      state materialized from its own ancestors and by nothing else;
//      an unauthorized operation is `invalid` and enters no concurrency
//      rule (RLTP-ACC-3390);
//   2. the removal disposition (RLTP-ACC-3520 … 3580): one least fixpoint,
//      seeded by every authorized removal R of S with the operations
//      concurrent to R that are additive and authored by S (3525, 3530),
//      and the concurrent admission of S itself (3485); closed over the
//      additive operations of subjects whose admission it disposes (3540);
//   3. every other authorized operation is `canonical`; removals with
//      authority all take effect (3395, 3400, 3405, 3410), a rotation
//      beside them too (3415);
//   4. state: canonical operations folded in ready-set order, smallest id
//      first (RLTP-ACC-3340); the epoch of a canonical enforcement is its
//      position's epoch + 1, the merged epoch the largest such number
//      (RLTP-ACC-7040).
// The forked pairings (policy.change, terminal) are outside this model.
import { createHash } from 'node:crypto'
import { jcs } from './lib.mjs'

export const STATUSES = ['canonical', 'removed-disposed', 'invalid']

// oid: + unpadded base64url SHA-256 over the JCS of the operation without id
// (the self-addressing rule of RLTP-ACC-3100, applied to the abstract op).
export const opId = ({ kind, author, subject, role, preds }) =>
  'oid:' + createHash('sha256').update(jcs({ kind, author, subject, role, preds }), 'utf8').digest('base64url')

const ENFORCEMENT = new Set(['remove', 'rotate'])
const ADDITIVE = new Set(['add'])

// Ready-set linearization (RLTP-ACC-3340): repeatedly the smallest id
// among the operations whose predecessors are all folded.
export function linearize (ops) {
  const byId = new Map(ops.map((o) => [o.id, o]))
  const done = new Set()
  const out = []
  while (out.length < ops.length) {
    const ready = ops.filter((o) => !done.has(o.id) && o.preds.every((p) => done.has(p) || !byId.has(p)))
    if (!ready.length) throw new Error('cycle or missing predecessor')
    ready.sort((a, b) => (Buffer.compare(Buffer.from(a.id, 'ascii'), Buffer.from(b.id, 'ascii'))))
    out.push(ready[0]); done.add(ready[0].id)
  }
  return out
}

export function materialize (ops) {
  const order = linearize(ops)
  const anc = new Map()           // id → strict ancestors
  for (const op of order) {
    const s = new Set()
    for (const p of op.preds) { s.add(p); for (const a of anc.get(p) ?? []) s.add(a) }
    anc.set(op.id, s)
  }
  const concurrent = (a, b) => a.id !== b.id && !anc.get(a.id).has(b.id) && !anc.get(b.id).has(a.id)

  // 1. authority at each position, from the materialization of its ancestors
  const position = new Map()
  const authorized = new Set()
  for (const op of order) {
    const sub = order.filter((o) => anc.get(op.id).has(o.id))
    const st = sub.length ? materialize(sub) : { members: {}, epoch: 0, created: false }
    position.set(op.id, st)
    const role = st.members[op.author]
    let ok = false
    if (op.kind === 'create') ok = !sub.length && op.author === op.subject
    else if (op.kind === 'add') ok = role === 'admin' && !(op.subject in st.members)
    else if (op.kind === 'remove') ok = role === 'admin' && op.subject in st.members
    else if (op.kind === 'rotate') ok = role !== undefined
    if (ok) authorized.add(op.id)
  }

  // 2. the removal disposition, one least fixpoint over all authorized removals
  const removals = order.filter((o) => o.kind === 'remove' && authorized.has(o.id))
  const disposed = new Set()
  const orphaned = new Set()      // subjects whose admission is disposed
  for (;;) {
    const before = disposed.size
    for (const r of removals) {
      for (const o of order) {
        if (!authorized.has(o.id) || !ADDITIVE.has(o.kind) || !concurrent(o, r)) continue
        if (o.author === r.subject || o.subject === r.subject) disposed.add(o.id)
      }
    }
    for (const o of order) {
      if (disposed.has(o.id) && o.kind === 'add') orphaned.add(o.subject)
    }
    for (const o of order) {
      if (authorized.has(o.id) && ADDITIVE.has(o.kind) && orphaned.has(o.author)) disposed.add(o.id)
    }
    if (disposed.size === before) break
  }

  // 3./4. status and state
  const status = {}
  const members = {}
  let epoch = 0
  for (const op of order) {
    status[op.id] = !authorized.has(op.id) ? 'invalid' : disposed.has(op.id) ? 'removed-disposed' : 'canonical'
    if (status[op.id] !== 'canonical') continue
    if (op.kind === 'create') members[op.subject] = 'admin'
    else if (op.kind === 'add') members[op.subject] = op.role
    else if (op.kind === 'remove') delete members[op.subject]
    if (ENFORCEMENT.has(op.kind)) epoch = Math.max(epoch, position.get(op.id).epoch + 1)
  }
  const sorted = Object.fromEntries(Object.keys(members).sort().map((k) => [k, members[k]]))
  return { members: sorted, epoch, status, created: true }
}

// Delivery in an arbitrary order: an operation waits until its predecessors
// arrived (the experiment's queue); the result must not depend on the order.
export function deliver (ops, orderIds) {
  const byId = new Map(ops.map((o) => [o.id, o]))
  const held = []
  let pending = orderIds.map((id) => byId.get(id))
  while (pending.length) {
    const rest = []
    for (const op of pending) {
      if (op.preds.every((p) => held.some((h) => h.id === p))) held.push(op)
      else rest.push(op)
    }
    if (rest.length === pending.length) throw new Error('predecessors missing for good')
    pending = rest
  }
  return materialize(held)
}
