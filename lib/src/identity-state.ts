// identity-state — the Identity Layer on the holder (lib Stage 2, PR 6):
// the label register (Identity §2, §6.3) with its device names and
// revocation marks (§5.5), and the community anchor's rotation as a
// resumable procedure over the Log port (§5.4; Trust 6360–6420, 6596;
// Access §5.6). Module `identity`, built into createHolder.
//
// What the module registers:
//   commands  identity.addDevice {name}      a device name into the
//               register (§5.5), before any key derived from it is
//               presented; human
//             identity.revokeDevice {name}   the name's revocation mark
//               (§5.5): never removed, the name never given again; human
//
// Pure register helpers for the modules that open contexts (the encounter
// in PR 7, continuity.newTuple until then): withLabel, withPairNonce.
//
// Choices this file makes where note and spec leave them open:
//   - a device name is stored in its 6.2 canonical form (NFC applied), so
//     the register compares what the derivation uses
//   - a name the register already holds is refused (device-name-held: the
//     SHOULD of §5.5 is followed); a revoked name is refused as
//     device-name-revoked (the MUST)
//   - revoking a name already revoked is ok and changes nothing; revoking
//     a name the register does not hold is unknown-device
//   - deviceKey (holder) derives only for a held, unrevoked name and an
//     own anchor context: a label of the register or a generation of the
//     community anchor up to its head (§5.5: names recorded before any
//     derived key is presented; a revoked name offers no key for a new
//     binding). Reading it changes nothing
import type { CommandDef, HolderModule, Refusal } from './engine.js'
import type { HolderState, Register } from './state.js'
import { canonicalLabel, communityLabel, deviceLabel, deviceName } from './identity.js'
import type { KeyProvider } from './ports.js'

/** The identity module's command names. */
export const IDENTITY_COMMANDS = Object.freeze({
  addDevice: 'identity.addDevice', revokeDevice: 'identity.revokeDevice',
} as const)

export interface DeviceInput { name: string }

/** The register with `label` among its labels (a set: added once). */
export const withLabel = (r: Readonly<Register>, label: string): Register =>
  r.labels.includes(label) ? r as Register : { ...r, labels: [...r.labels, label] }

/** The register with a pair label and its relationship nonce (Identity
 *  §6.1): the nonce is recorded alongside the label and never changes. */
export function withPairNonce (r: Readonly<Register>, label: string, nonce: string): Register {
  if (Object.hasOwn(r.pairNonces, label)) {
    if (r.pairNonces[label] !== nonce) throw new Error(`identity: ${label} already holds another relationship nonce (§6.1)`)
    return withLabel(r, label)
  }
  return { ...withLabel(r, label), pairNonces: { ...r.pairNonces, [label]: nonce } }
}

const needName = (x: unknown, cmd: string): string => {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) throw new TypeError(`${cmd} needs an input object`)
  const n = (x as { name?: unknown }).name
  if (typeof n !== 'string') throw new TypeError(`${cmd}: name must be a string`)
  return n
}

const refuse = (code: Refusal['code'], ref?: string): Refusal => ({ ok: false, code, ...(ref ? { ref } : {}) })

const commands: Record<string, CommandDef> = {
  // §5.5: the name is persisted before any key derived from it is presented
  [IDENTITY_COMMANDS.addDevice]: {
    human: true,
    apply (state, _p, input: DeviceInput) {
      const n = deviceName(needName(input, IDENTITY_COMMANDS.addDevice))
      if (n === null) return refuse('device-name-invalid', 'Identity §6.2')
      const d = state.register.devices
      if (d.revoked.includes(n)) return refuse('device-name-revoked', 'Identity §5.5')
      if (d.names.includes(n)) return refuse('device-name-held', 'Identity §5.5')
      return {
        state: { ...state, register: { ...state.register, devices: { ...d, names: [...d.names, n] } } },
        events: [{ type: 'device.added', name: n }],
      }
    },
  } satisfies CommandDef<DeviceInput>,
  // §5.5: revocation consumes the name; the mark is never removed
  [IDENTITY_COMMANDS.revokeDevice]: {
    human: true,
    apply (state, _p, input: DeviceInput) {
      const n = deviceName(needName(input, IDENTITY_COMMANDS.revokeDevice))
      const d = state.register.devices
      if (n === null || !d.names.includes(n)) return refuse('unknown-device', 'Identity §5.5')
      if (d.revoked.includes(n)) return { state: state as HolderState }
      return {
        state: { ...state, register: { ...state.register, devices: { ...d, revoked: [...d.revoked, n] } } },
        events: [{ type: 'device.revoked', name: n }],
      }
    },
  } satisfies CommandDef<DeviceInput>,
}

/** A device key as deviceKey derives it: the device label, the device's
 *  did:key and its key-agreement multikey (Identity §5.5). */
export type DeviceKeyResult =
  | { ok: true, label: string, device: string, keyAgreement: string }
  | { ok: false, code: 'unknown-device' | 'device-revoked' | 'unknown-context' }

/** Whether `label` names an own anchor context: a label of the register,
 *  or a generation of the community anchor up to its head (§5.4). */
function ownContext (state: Readonly<HolderState>, label: string): boolean {
  if (label.startsWith('device/')) return false
  if (state.register.labels.includes(label)) return true
  const c = state.register.community
  if (c === null) return false
  const base = communityLabel(c.genesis, 1)
  if (label === base) return true
  if (!label.startsWith(base + '/')) return false
  const g = BigInt(label.slice(base.length + 1))
  return g >= 2n && g <= BigInt(c.head)
}

/**
 * The device key of a held, unrevoked device name under an own anchor
 * context (Identity §5.5): derived through the KeyProvider, never stored
 * (keys are not state, 9.3).
 */
export async function deviceKeyOf (state: Readonly<HolderState>, keys: KeyProvider, name: string, contextLabel: string): Promise<DeviceKeyResult> {
  const n = deviceName(name)
  const d = state.register.devices
  if (n === null || !d.names.includes(n)) return { ok: false, code: 'unknown-device' }
  if (d.revoked.includes(n)) return { ok: false, code: 'device-revoked' }
  const a = canonicalLabel(contextLabel)
  if (a === null || !ownContext(state, a)) return { ok: false, code: 'unknown-context' }
  const label = await deviceLabel(n, a)
  const k = await keys.anchorOf(label)
  return { ok: true, label, device: k.anchor, keyAgreement: k.keyAgreement }
}

/** The identity module createHolder builds in (see the header). */
export function identityModule (): HolderModule {
  return Object.freeze({
    name: 'identity',
    commands: Object.freeze({ ...commands }),
  })
}
