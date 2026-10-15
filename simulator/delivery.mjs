// delivery.mjs — the observable channel of the simulators. The receiver's
// verdict is the library's alone: every envelope that reaches a device goes
// through ONE call, holder.receive(env, when) (Delivery §6.2 stages 1–9 in
// the library's receive core and task register). Simulator-own is only the
// channel itself: offline transit, the hold/dup/tamper/lose faults, and the
// inspection that renders the library's disposition as stage rows.

// Delivery Contract 6.2: the receiver's stages, in mandatory order
export const STAGES = [
  '1 sealed size within bounds',
  '2 envelope form · rkid known',
  '3 AES-256-GCM open · tag verified',
  '4 parse · digest · duplicate cache',
  '5 document profile · recipient is me',
  '6 type registered',
  '7 payload schema',
  '8 type checks before the commit',
  '9 effect committed',
]

/** The stage rows of one ReceiveResult: every stage passed up to where it ended. */
export function stagesOf (r) {
  const ok = (k) => STAGES.slice(0, k).map((label) => ({ label, ok: true }))
  if (r.disposition === 'unique') return ok(9)
  if (r.disposition === 'duplicate-known') return [...ok(4), { label: '  → duplicate-known · the prior outcome applies, no second effect', ok: true }]
  if (r.disposition === 'discarded') return [...ok(8), { label: STAGES[8] + ' — discarded (' + r.reason + ')', ok: false }]
  const k = r.stage ?? 1
  return [...ok(k - 1), { label: STAGES[k - 1], ok: false }]
}

/** The disposition as one short string: unique, duplicate-known, failed(reason). */
export const dispOf = (r) => r.disposition === 'failed' ? `failed(${r.reason})`
  : r.disposition === 'discarded' ? `discarded(${r.reason})` : r.disposition

export function createChannel () {
  return {
    faults: { hold: false, dup: false, tamper: false, lose: false },
    held: [],                 // deliveries the hold fault parks
    transit: new Map(),       // name -> [env] for devices that are offline
  }
}

/** One bit flipped in the ciphertext: the AES-GCM tag must catch it (stage 3). */
export function tamper (env) {
  const c = String(env.ciphertext ?? '')
  const i = Math.floor(c.length / 2)
  const ch = c[i] === 'A' ? 'B' : 'A'
  return { ...env, ciphertext: c.slice(0, i) + ch + c.slice(i + 1) }
}

/**
 * One delivery: faults → transit → the receiver's holder. `to` is a
 * simulator person ({name, online, h}). Returns
 * { arrived, disp, stages, result } — arrived = the envelope reached the
 * device (the ack semantics: arrival, never acceptance); result the
 * library's ReceiveResult.
 */
export async function deliver (ch, to, env, when, opts = {}) {
  if (ch.faults.lose && !opts.replay) {
    return { arrived: false, disp: 'lost (fault) — the channel gives no sign; only the missing ack tells', stages: [] }
  }
  if (ch.faults.tamper && !opts.replay) env = tamper(env)
  if (ch.faults.hold && !opts.replay) {
    ch.held.push({ toName: to.name, env, kind: opts.kind, meta: opts.meta })
    return { arrived: false, disp: 'held (fault) — parked on the channel', stages: [] }
  }
  if (!to.online) {
    const q = ch.transit.get(to.name) ?? []
    q.push(env)
    ch.transit.set(to.name, q)
    return { arrived: false, disp: 'transit — device offline, delivery time is unbounded', stages: [] }
  }
  const result = await to.h.receive(env, when)
  return { arrived: true, disp: dispOf(result), stages: stagesOf(result), result }
}

// the hold fault released / a device back online: what was parked
export function drainHeld (ch) { return ch.held.splice(0) }
export function drainTransit (ch, name) {
  const q = ch.transit.get(name) ?? []
  ch.transit.set(name, [])
  return q
}
