// Reference materialization of an abstract authority DAG under the
// conflict matrix of Access 0.54 §3.5–3.6 — the oracle behind
// vectors/access-conflicts.json.
//
// The model abstracts from signatures and policies. An operation is
//   { id, kind, author, subject, role, preds }
// with kind ∈ create | add | remove | rotate | visibility | policy | dissolve.
// `role` (admin | member) is the standing an `add` confers; an author's
// standing at an operation's position stands for the policy: an `admin`
// satisfies `member.add`, `member.remove`, `visibility.change`,
// `policy.change` (default `strongest`), the collective `group.dissolve`
// and creates the group; any member satisfies `epoch.rotate` (default
// `any-member`, Access 4.1). A policy object has no content here: which
// `policy.change` is in effect is the last canonical one folded.
//
// The fold follows the spec, in this order:
//   1. authority first (RLTP-ACC-3385): each operation is judged by the
//      state materialized from its own ancestors and by nothing else;
//      an unauthorized operation is `invalid` and enters no concurrency
//      rule (RLTP-ACC-3390). A position in the forked state answers
//      fail-closed (3440), except for a `policy.change`: it is judged
//      against its ancestry reconciled, every fork pairing in it counted
//      as decided (the reading of 3565 the vectors fix: the closing
//      `policy.change` is judged by the state its own decision produces
//      from its ancestors);
//   2. the fork pairings (RLTP-ACC-3495, 3460): an authorized
//      `policy.change` concurrent with an authorized enforcement operation
//      (another `policy.change` included), or an authorized terminal
//      operation concurrent with an authorized enforcement operation. A
//      pairing is decided when an authorized, non-forked `policy.change`
//      has both siblings in its ancestry (3565); the rest are open. Every
//      sibling of an open pairing and every operation building on one is
//      `forked` (3440); the state is `forked`, and the member set, epoch
//      and policy are those of the maximal prefix free of the open
//      pairings (3630). Once decided, the pairing is no pairing: statuses
//      are re-derived by the rules below over the reconciled DAG, so the
//      former siblings become `canonical` or `removed-disposed` (3565);
//   3. the removal disposition (RLTP-ACC-3520 … 3580): one least fixpoint,
//      seeded by every authorized, non-forked removal R of S with the
//      operations concurrent to R that are additive and authored by S
//      (3525, 3530), and the concurrent admission of S itself (3485);
//      closed over the additive operations of subjects whose admission it
//      disposes (3540). A forked removal confers no effect (3345), so it
//      seeds nothing;
//   4. status: `forked` ≻ `removed-disposed` ≻ `canonical` (3562), an
//      unauthorized operation outside the forked set `invalid`; removals
//      with authority all take effect (3395, 3400, 3405, 3410), a rotation
//      beside them too (3415), and a visibility change (3435);
//   5. state: canonical operations folded in ready-set order, smallest id
//      first (RLTP-ACC-3340); the epoch of a canonical enforcement is its
//      position's epoch + 1, the merged epoch the largest such number
//      (RLTP-ACC-7040); a canonical `group.dissolve` makes the state
//      `terminal` (3365).
// Not modelled: the terminal-versus-additive rules (3465, 3470), leaves,
// and an operation other than a `policy.change` positioned on an open
// fork (fail-closed: such an operation is `forked` while the fork is
// open and `invalid` once the fork is decided).
import { createHash } from 'node:crypto'
import { jcs } from './lib.mjs'

export const STATUSES = ['canonical', 'removed-disposed', 'forked', 'invalid']
export const STATES = ['group', 'forked', 'terminal']

// oid: + unpadded base64url SHA-256 over the JCS of the operation without id
// (the self-addressing rule of RLTP-ACC-3100, applied to the abstract op).
export const opId = ({ kind, author, subject, role, preds }) =>
  'oid:' + createHash('sha256').update(jcs({ kind, author, subject, role, preds }), 'utf8').digest('base64url')

const ENFORCEMENT = new Set(['remove', 'rotate', 'visibility', 'policy'])
const TERMINAL = new Set(['dissolve'])
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

export function materialize (ops, { reconciled = false } = {}) {
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
    let st = sub.length ? materialize(sub) : { members: {}, epoch: 0, policy: null, state: 'empty' }
    if (st.state === 'forked' && op.kind === 'policy') st = materialize(sub, { reconciled: true })
    position.set(op.id, st)
    const role = st.state === 'group' ? st.members[op.author] : undefined   // forked, terminal: fail-closed
    let ok = false
    if (op.kind === 'create') ok = !sub.length && op.author === op.subject
    else if (op.kind === 'add') ok = role === 'admin' && !(op.subject in st.members)
    else if (op.kind === 'remove') ok = role === 'admin' && op.subject in st.members
    else if (op.kind === 'rotate') ok = role !== undefined
    else if (op.kind === 'visibility' || op.kind === 'policy' || op.kind === 'dissolve') ok = role === 'admin'
    if (ok) authorized.add(op.id)
  }

  // 2. the fork pairings; a pairing is decided by an authorized, non-forked
  //    policy.change holding both siblings in its ancestry (greatest
  //    fixpoint: start from every authorized policy.change, drop those that
  //    end up forked themselves)
  const pairs = []
  if (!reconciled) {
    for (const [i, a] of order.entries()) {
      for (const b of order.slice(i + 1)) {
        if (!authorized.has(a.id) || !authorized.has(b.id) || !concurrent(a, b)) continue
        const fork = (x, y) => (x.kind === 'policy' || TERMINAL.has(x.kind)) && ENFORCEMENT.has(y.kind)
        if (fork(a, b) || fork(b, a)) pairs.push([a.id, b.id])
      }
    }
  }
  let resolvers = order.filter((o) => o.kind === 'policy' && authorized.has(o.id))
  let forked
  for (;;) {
    const open = pairs.filter(([a, b]) => !resolvers.some((r) => anc.get(r.id).has(a) && anc.get(r.id).has(b)))
    const siblings = new Set(open.flat())
    forked = new Set(order.filter((o) => siblings.has(o.id) || [...siblings].some((s) => anc.get(o.id).has(s))).map((o) => o.id))
    const kept = resolvers.filter((r) => !forked.has(r.id))
    if (kept.length === resolvers.length) break
    resolvers = kept
  }

  // 3. the removal disposition, one least fixpoint over all authorized,
  //    non-forked removals
  const removals = order.filter((o) => o.kind === 'remove' && authorized.has(o.id) && !forked.has(o.id))
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

  // 4./5. status and state
  const status = {}
  const members = {}
  let epoch = 0
  let policy = null
  let terminal = false
  for (const op of order) {
    status[op.id] = forked.has(op.id) ? 'forked' : !authorized.has(op.id) ? 'invalid' : disposed.has(op.id) ? 'removed-disposed' : 'canonical'
    if (status[op.id] !== 'canonical') continue
    if (op.kind === 'create') members[op.subject] = 'admin'
    else if (op.kind === 'add') members[op.subject] = op.role
    else if (op.kind === 'remove') delete members[op.subject]
    else if (op.kind === 'policy') policy = op.id
    else if (op.kind === 'dissolve') terminal = true
    if (ENFORCEMENT.has(op.kind)) epoch = Math.max(epoch, position.get(op.id).epoch + 1)
  }
  const sorted = Object.fromEntries(Object.keys(members).sort().map((k) => [k, members[k]]))
  const state = terminal ? 'terminal' : forked.size ? 'forked' : 'group'
  return { state, members: sorted, epoch, policy, status }
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
