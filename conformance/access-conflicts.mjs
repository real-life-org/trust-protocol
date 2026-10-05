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
//      fail-closed (3440), except for a `policy.change`: it is the
//      resolving operation and is judged against the state materialized
//      from the maximal prefix of its ancestry free of the fork pairing —
//      that prefix's members, policy, policy version and epoch (3565);
//   2. the one remaining fork pairing (RLTP-ACC-3495): an authorized
//      `policy.change` concurrent with an authorized enforcement operation,
//      another `policy.change` included. A pairing is decided when an
//      authorized, non-forked `policy.change` has both siblings in its
//      ancestry (3565); the rest are open. Every sibling of an open
//      pairing and every operation building on one is `forked` (3440,
//      3568); the state is `forked`, and the member set, epoch and policy
//      are those of the maximal prefix free of the open pairings (3630).
//      Once decided, the pairing is no pairing: a sibling `policy.change`
//      is `lapsed` (its policy effect lapses), every other sibling and
//      what builds on it is re-derived by the rules below, and the
//      resolving `policy.change` sets the policy (3567);
//   3. the lapsing dissolution (RLTP-ACC-3460): an authorized
//      `group.dissolve` concurrent with an authorized enforcement
//      operation is `lapsed` — no effect, the merged state is not
//      terminal; a `group.dissolve` whose ancestry holds both is judged
//      against that merged state and ends the group;
//   4. the removal disposition (RLTP-ACC-3520 … 3580): one least fixpoint,
//      seeded by every authorized, non-forked removal R of S with the
//      operations concurrent to R that are additive and authored by S
//      (3525, 3530), and the concurrent admission of S itself (3485);
//      the step disposes the additive operations of admission-orphaned
//      issuers (3540, 3570), an issuer being orphaned at an operation
//      exactly when every admission carrying its membership at that
//      operation's causal position is disposed (3572, 3585). A forked
//      removal confers no effect (3345), so it seeds nothing;
//   5. status: `forked` ≻ `removed-disposed` ≻ `lapsed` ≻ `canonical`
//      (3562, `lapsed` placed by these vectors), an unauthorized operation
//      outside the forked set `invalid`; removals with authority all take
//      effect (3395, 3400, 3405, 3410), a rotation beside them too (3415,
//      3417), and a visibility change (3418);
//   6. state: canonical operations folded in ready-set order, smallest id
//      first (RLTP-ACC-3340); the epoch of a canonical enforcement is its
//      position's epoch + 1, the state's epoch the maximum over the
//      canonical transitions it contains (RLTP-ACC-7040); the policy
//      version of a canonical `policy.change` its position's version + 1
//      (the resolver's: the prefix's + 1, 3565); a canonical
//      `group.dissolve` makes the state `terminal` (3365); the retained
//      set of a group state is its members minus its pending exits
//      (RLTP-ACC-7010; no leaves are modelled, so: its members).
// Not modelled: the terminal-versus-additive rules (3465, 3470), leaves,
// devices, and an operation other than a `policy.change` positioned on an
// open fork (fail-closed: such an operation is `forked` while the fork is
// open and `invalid` once the fork is decided).
import { createHash } from 'node:crypto'
import { jcs } from './lib.mjs'

export const STATUSES = ['canonical', 'lapsed', 'removed-disposed', 'forked', 'invalid']
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

export function materialize (ops) {
  const order = linearize(ops)
  const anc = new Map()           // id → strict ancestors
  for (const op of order) {
    const s = new Set()
    for (const p of op.preds) { s.add(p); for (const a of anc.get(p) ?? []) s.add(a) }
    anc.set(op.id, s)
  }
  const concurrent = (a, b) => a.id !== b.id && !anc.get(a.id).has(b.id) && !anc.get(b.id).has(a.id)

  // 1. authority at each position, from the materialization of its ancestors;
  //    a policy.change on a forked position: from the fork-free prefix (3565)
  const EMPTY = { members: {}, epoch: 0, policy: null, policyVersion: 0, state: 'empty' }
  const position = new Map()
  const authorized = new Set()
  for (const op of order) {
    const sub = order.filter((o) => anc.get(op.id).has(o.id))
    let st = sub.length ? materialize(sub) : EMPTY
    if (st.state === 'forked' && op.kind === 'policy') {
      const prefix = sub.filter((o) => st.status[o.id] !== 'forked')
      st = prefix.length ? materialize(prefix) : EMPTY
    }
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

  // 2. the fork pairing policy.change ∥ enforcement; decided by an
  //    authorized, non-forked policy.change holding both siblings in its
  //    ancestry (greatest fixpoint: start from every authorized
  //    policy.change, drop those that end up forked themselves)
  const pairs = []
  for (const [i, a] of order.entries()) {
    for (const b of order.slice(i + 1)) {
      if (!authorized.has(a.id) || !authorized.has(b.id) || !concurrent(a, b)) continue
      const fork = (x, y) => x.kind === 'policy' && ENFORCEMENT.has(y.kind)
      if (fork(a, b) || fork(b, a)) pairs.push([a.id, b.id])
    }
  }
  let resolvers = order.filter((o) => o.kind === 'policy' && authorized.has(o.id))
  let forked
  let open
  for (;;) {
    open = pairs.filter(([a, b]) => !resolvers.some((r) => anc.get(r.id).has(a) && anc.get(r.id).has(b)))
    const siblings = new Set(open.flat())
    forked = new Set(order.filter((o) => siblings.has(o.id) || [...siblings].some((s) => anc.get(o.id).has(s))).map((o) => o.id))
    const kept = resolvers.filter((r) => !forked.has(r.id))
    if (kept.length === resolvers.length) break
    resolvers = kept
  }
  const lapsed = new Set()
  for (const [a, b] of pairs.filter((p) => !open.includes(p))) {
    for (const id of [a, b]) if (order.find((o) => o.id === id).kind === 'policy') lapsed.add(id)
  }

  // 3. the lapsing dissolution (3460)
  for (const d of order) {
    if (!TERMINAL.has(d.kind) || !authorized.has(d.id)) continue
    if (order.some((e) => ENFORCEMENT.has(e.kind) && authorized.has(e.id) && concurrent(d, e))) lapsed.add(d.id)
  }

  // 4. the removal disposition, one least fixpoint over all authorized,
  //    non-forked removals
  const removals = order.filter((o) => o.kind === 'remove' && authorized.has(o.id) && !forked.has(o.id))
  const disposed = new Set()
  // the admissions carrying `issuer`'s membership at `o`'s causal position
  // (3585): its authorized admissions and the genesis in o's ancestry that
  // no removal of the issuer in o's ancestry follows
  const carrying = (issuer, o) => order.filter((a) =>
    (a.kind === 'add' || a.kind === 'create') && a.subject === issuer && authorized.has(a.id) && anc.get(o.id).has(a.id) &&
    !order.some((r) => r.kind === 'remove' && r.subject === issuer && authorized.has(r.id) && anc.get(o.id).has(r.id) && anc.get(r.id).has(a.id)))
  for (;;) {
    const before = disposed.size
    for (const r of removals) {
      for (const o of order) {
        if (!authorized.has(o.id) || !ADDITIVE.has(o.kind) || !concurrent(o, r)) continue
        if (o.author === r.subject || o.subject === r.subject) disposed.add(o.id)
      }
    }
    for (const o of order) {
      if (disposed.has(o.id) || !authorized.has(o.id) || !ADDITIVE.has(o.kind)) continue
      const legit = carrying(o.author, o)
      if (legit.length && legit.every((a) => disposed.has(a.id))) disposed.add(o.id)   // 3572
    }
    if (disposed.size === before) break
  }

  // 5./6. status and state
  const status = {}
  const members = {}
  let epoch = 0
  let policy = null
  let policyVersion = 0
  let terminal = false
  for (const op of order) {
    status[op.id] = forked.has(op.id) ? 'forked' : !authorized.has(op.id) ? 'invalid'
      : disposed.has(op.id) ? 'removed-disposed' : lapsed.has(op.id) ? 'lapsed' : 'canonical'
    if (status[op.id] !== 'canonical') continue
    if (op.kind === 'create') { members[op.subject] = 'admin'; policyVersion = 1 }
    else if (op.kind === 'add') members[op.subject] = op.role
    else if (op.kind === 'remove') delete members[op.subject]
    else if (op.kind === 'policy') { policy = op.id; policyVersion = position.get(op.id).policyVersion + 1 }
    else if (op.kind === 'dissolve') terminal = true
    if (ENFORCEMENT.has(op.kind)) epoch = Math.max(epoch, position.get(op.id).epoch + 1)
  }
  const sorted = Object.fromEntries(Object.keys(members).sort().map((k) => [k, members[k]]))
  const state = terminal ? 'terminal' : forked.size ? 'forked' : 'group'
  const retained = state === 'group' ? Object.keys(sorted) : null
  return { state, members: sorted, epoch, policy, policyVersion, retained, status }
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
