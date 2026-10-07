// Reference materialization of the anchor.rotate entries of a personal
// community's log under Access 0.56 §5.6 — the oracle behind
// vectors/access-anchor-rotate.json.
//
// An operation is a real rltp-access/0.25 envelope (group.genesis,
// dag.join, anchor.rotate) or a STATE FIXTURE `{ fixture: true, op:
// 'member.add', id, subject, prev }` standing for a canonical admission
// whose body lies outside the vector. Ids, signatures and schemas are
// the runner's business; this module decides only what §5.6 decides,
// keeping VALIDITY and CANONICITY apart (3325, 3330, 3345):
//
//   1. validity — each anchor.rotate is judged against its own ancestor
//      closure and nothing else (3325):
//      5950 — its author is the sole member at its position;
//      5955 — its body is exactly { rotation } and the rotation verifies
//             as anchor-rotation@1 under both its signatures (the caller
//             supplies that predicate);
//      5960 — its rotation.body.prev equals the next of the lineage head
//             of its ancestor closure, or is unconstrained where that
//             closure holds no canonical anchor.rotate;
//   2. canonicity — 5965, over the log at hand: the lineage is walked
//      from its first canonical entry. An ENTRY is a rotation body; the
//      valid operations carrying JCS-identical bodies are one entry
//      (idempotent, 3475): the smallest id among them is its
//      representative, the others are repeats. An entry's PARENT is the
//      lineage head of its operations' ancestor closures (none for a
//      first entry). The walk starts among the entries without a parent
//      and continues among the children of the current head; where
//      several compete — the same prev, or both first entries — the one
//      whose representative has the smaller id in unsigned bytewise
//      order is canonical, and every entry reachable from it; the others,
//      and every entry reachable only from them, stay VALID but are not
//      canonical (the 5240 pattern);
//   3. 5970 — no anchor.rotate changes the roster, the epoch or the
//      policy version: the state is that of the other operations.
//
// The head of an ancestor closure is the same walk over that closure;
// it is memoized per operation.
//
// Returns { status: { label → canonical | valid | invalid }, repeat:
// [label], chain: [label], head: { anchor } | null, state: { members,
// epoch, policyVersion } } — the `expect` shape of the vector. `chain`
// lists the representatives of the canonical entries in walk order.
import { jcs } from './lib.mjs'

const cmpBytes = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))

export async function materializeRotations (ops, verifyRotation) {
  const byId = new Map(ops.map((o) => [o.id, o]))
  const anc = new Map()
  const ancestors = (id) => {
    if (anc.has(id)) return anc.get(id)
    const out = new Set()
    for (const p of byId.get(id)?.prev ?? []) { out.add(p); for (const x of ancestors(p)) out.add(x) }
    anc.set(id, out)
    return out
  }
  const genesis = ops.find((o) => o.op === 'group.genesis')
  // members at a position: the genesis founder plus every (fixture) admission in the ancestry
  const membersAt = (id) => {
    const m = new Set(genesis.body.members)
    for (const a of ancestors(id)) { const o = byId.get(a); if (o?.op === 'member.add') m.add(o.subject) }
    return m
  }
  const rotates = ops.filter((o) => o.op === 'anchor.rotate')
  const shapeOK = new Map()
  for (const o of rotates) {
    const keys = Object.keys(o.body ?? {})
    shapeOK.set(o.id, keys.length === 1 && keys[0] === 'rotation' && await verifyRotation(o.body.rotation))
  }
  const bodyKey = (o) => jcs(o.body.rotation.body)

  // validity (memoized; depends on the ancestor closure only)
  const validMemo = new Map()
  const valid = (o) => {
    if (validMemo.has(o.id)) return validMemo.get(o.id)
    let ok = shapeOK.get(o.id)
    if (ok) { const m = membersAt(o.id); ok = m.size === 1 && m.has(o.author) }
    if (ok) {
      const head = walk(ancestors(o.id)).head
      ok = !head || o.body.rotation.body.prev === head.next
    }
    validMemo.set(o.id, ok)
    return ok
  }
  // the parent entry of an operation: the head of its ancestor closure (memoized)
  const parentMemo = new Map()
  const parentOf = (o) => {
    if (!parentMemo.has(o.id)) parentMemo.set(o.id, walk(ancestors(o.id)).head?.key ?? null)
    return parentMemo.get(o.id)
  }
  // the canonical walk over a set of operation ids (an ancestor-closed set)
  function walk (ids) {
    const inSet = rotates.filter((o) => ids.has(o.id) && valid(o))
    const entries = new Map()   // body key → { key, next, ops: [...] }
    for (const o of inSet) {
      const k = bodyKey(o)
      if (!entries.has(k)) entries.set(k, { key: k, next: o.body.rotation.body.next, ops: [] })
      entries.get(k).ops.push(o)
    }
    for (const e of entries.values()) e.ops.sort((a, b) => cmpBytes(a.id, b.id))
    const children = (parentKey) => [...entries.values()].filter((e) => e.ops.some((o) => parentOf(o) === parentKey))
    const chain = []
    const seen = new Set()
    let at = null
    for (;;) {
      const cands = children(at).filter((e) => !seen.has(e.key))
      if (!cands.length) break
      cands.sort((a, b) => cmpBytes(a.ops[0].id, b.ops[0].id))
      const win = cands[0]
      chain.push(win); seen.add(win.key); at = win.key
    }
    return { chain, head: chain.at(-1) ?? null }
  }

  const all = new Set(ops.map((o) => o.id))
  const { chain, head } = walk(all)
  const canonicalKeys = new Set(chain.map((e) => e.key))
  const label = (id) => byId.get(id).label ?? id
  const status = new Map()
  const repeat = []
  for (const o of rotates) {
    if (!valid(o)) { status.set(o.id, 'invalid'); continue }
    status.set(o.id, canonicalKeys.has(bodyKey(o)) ? 'canonical' : 'valid')
  }
  for (const e of chain) for (const o of e.ops.slice(1)) repeat.push(label(o.id))
  const members = new Set(genesis.body.members)
  for (const o of ops) if (o.op === 'member.add') members.add(o.subject)
  return {
    status: Object.fromEntries(rotates.map((o) => [label(o.id), status.get(o.id)]).sort((a, b) => (a[0] < b[0] ? -1 : 1))),
    repeat: repeat.sort(),
    chain: chain.map((e) => label(e.ops[0].id)),
    head: head ? { anchor: head.next } : null,
    state: { members: [...members].sort(), epoch: genesis.epoch, policyVersion: genesis.policyVersion },
  }
}
