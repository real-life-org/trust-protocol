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
//   2. canonicity — 5965, over the log at hand. An ENTRY is a rotation
//      body; the valid operations carrying JCS-identical bodies are one
//      entry (idempotent, 3475), its id the smallest id among them (the
//      representative), the others repeats. The walk starts at a virtual
//      root, where the candidates are the FIRST entries (carried by a
//      valid operation whose ancestor closure holds no canonical
//      anchor.rotate); at a chosen head the candidates are the entries
//      not yet visited whose prev equals the head's next; of the
//      candidates the one with the smaller id in unsigned bytewise order
//      becomes the new head; repeat until no candidate. Exactly the
//      visited entries (and their repeats) are canonical; every other
//      valid operation stays VALID but not canonical (the 5240 pattern);
//   3. 5970 — no anchor.rotate changes the roster, the epoch or the
//      policy version: the state is that of the other operations.
//
// The head of an ancestor closure is the same walk over that closure;
// it is memoized per operation. Nothing else enters the walk.
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
      const head = closureHead(o)
      ok = !head || o.body.rotation.body.prev === head.next
    }
    validMemo.set(o.id, ok)
    return ok
  }
  // the head of an operation's ancestor closure (memoized): 5960 and "first"
  const headMemo = new Map()
  const closureHead = (o) => {
    if (!headMemo.has(o.id)) headMemo.set(o.id, walk(ancestors(o.id)).head)
    return headMemo.get(o.id)
  }
  // the canonical walk over a set of operation ids (an ancestor-closed set)
  function walk (ids) {
    const entries = new Map()   // body key → { key, prev, next, first, ops: [...] }
    for (const o of rotates) {
      if (!ids.has(o.id) || !valid(o)) continue
      const k = bodyKey(o)
      if (!entries.has(k)) entries.set(k, { key: k, prev: o.body.rotation.body.prev, next: o.body.rotation.body.next, first: false, ops: [] })
      const e = entries.get(k)
      e.ops.push(o)
      if (!closureHead(o)) e.first = true
    }
    for (const e of entries.values()) e.ops.sort((a, b) => cmpBytes(a.id, b.id))
    const chain = []
    const visited = new Set()
    let at = null
    for (;;) {
      const cands = [...entries.values()].filter((e) => !visited.has(e.key) && (at === null ? e.first : e.prev === at.next))
      if (!cands.length) break
      cands.sort((a, b) => cmpBytes(a.ops[0].id, b.ops[0].id))
      at = cands[0]
      chain.push(at); visited.add(at.key)
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
