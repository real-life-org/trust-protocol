// Reference materialization of the anchor.rotate entries of a personal
// community's log under Access 0.56 §5.6 — the oracle behind
// vectors/access-anchor-rotate.json.
//
// An operation is a real rltp-access/0.25 envelope (group.genesis,
// dag.join, anchor.rotate) or a STATE FIXTURE `{ fixture: true, op:
// 'member.add', id, subject, prev }` standing for a canonical admission
// whose body lies outside the vector. Ids, signatures and schemas are
// the runner's business; this module decides only what §5.6 decides:
//
//   1. each anchor.rotate is judged against its own ancestry (3325):
//      5950 — its author is the sole member at its position;
//      5955 — its body is exactly { rotation } and the rotation verifies
//             as anchor-rotation@1 under both its signatures (the caller
//             supplies that predicate);
//      5960 — its generation is 2 where no canonical anchor.rotate is in
//             its ancestry, else the previous canonical one's + 1, and
//             its prev is that one's next;
//   2. 5965 between two CONCURRENT canonical anchor.rotate of equal
//      generation: a JCS-identical rotation.body is a repeat (canonical,
//      no further effect); differing bodies: the smaller id in unsigned
//      bytewise order is canonical, the other invalid — and what was
//      judged against it is judged again, to a fixpoint;
//   3. 5970 — no anchor.rotate changes the roster, the epoch or the
//      policy version: the state is that of the other operations.
//
// Returns { status: { label → canonical | invalid }, repeat: [label],
// head: { generation, anchor } | null, state: { members, epoch,
// policyVersion } } — the `expect` shape of the vector.
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
  // causal order: ancestry size, then id bytewise — a linear extension
  const rotates = ops.filter((o) => o.op === 'anchor.rotate')
    .sort((a, b) => ancestors(a.id).size - ancestors(b.id).size || cmpBytes(a.id, b.id))
  const verified = new Map()
  for (const o of rotates) {
    const keys = Object.keys(o.body ?? {})
    verified.set(o.id, keys.length === 1 && keys[0] === 'rotation' && await verifyRotation(o.body.rotation))
  }
  const gen = (o) => BigInt(o.body.rotation.body.generation)
  const concurrent = (a, b) => a.id !== b.id && !ancestors(a.id).has(b.id) && !ancestors(b.id).has(a.id)

  const lost = new Set()   // invalid by 5965
  let status, repeat
  for (;;) {
    status = new Map(); repeat = new Set()
    for (const o of rotates) {
      const m = membersAt(o.id)
      if (lost.has(o.id) || !(m.size === 1 && m.has(o.author)) || !verified.get(o.id)) { status.set(o.id, 'invalid'); continue }
      const prior = rotates.filter((x) => ancestors(o.id).has(x.id) && status.get(x.id) === 'canonical')
      const prev = prior.sort((a, b) => (gen(b) > gen(a) ? 1 : gen(b) < gen(a) ? -1 : 0))[0]
      const ok = prev ? gen(o) === gen(prev) + 1n && o.body.rotation.body.prev === prev.body.rotation.body.next : gen(o) === 2n
      status.set(o.id, ok ? 'canonical' : 'invalid')
    }
    let changed = false
    for (const a of rotates) for (const b of rotates) {
      if (cmpBytes(a.id, b.id) >= 0 || status.get(a.id) !== 'canonical' || status.get(b.id) !== 'canonical') continue
      if (!concurrent(a, b) || gen(a) !== gen(b)) continue
      if (jcs(a.body.rotation.body) === jcs(b.body.rotation.body)) repeat.add(b.id)   // b: the larger id
      else if (!lost.has(b.id)) { lost.add(b.id); changed = true }
    }
    if (!changed) break
  }
  const canon = rotates.filter((o) => status.get(o.id) === 'canonical')
  const top = canon.sort((a, b) => (gen(b) > gen(a) ? 1 : gen(b) < gen(a) ? -1 : 0))[0]
  const members = new Set(genesis.body.members)
  for (const o of ops) if (o.op === 'member.add') members.add(o.subject)
  const label = (id) => byId.get(id).label ?? id
  return {
    status: Object.fromEntries(rotates.map((o) => [label(o.id), status.get(o.id)]).sort((a, b) => (a[0] < b[0] ? -1 : 1))),
    repeat: [...repeat].map(label).sort(),
    head: top ? { generation: top.body.rotation.body.generation, anchor: top.body.rotation.body.next } : null,
    state: { members: [...members].sort(), epoch: genesis.epoch, policyVersion: genesis.policyVersion },
  }
}
