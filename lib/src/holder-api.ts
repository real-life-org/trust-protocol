// holder-api — createHolder, the facade over the engine (lib Stage 2,
// note §4.1, §4.5). Domain modules (identity, encounter, trust, continuity,
// membership, profile) register with the engine as they graduate; today
// the facade carries the engine's built-ins, the prompts module, the trust
// module (trust/mapping.ts: the Trust act, the class settings, the anchor
// mapping's issuance and reception, the entry commit; trust/star.ts and
// trust/group-star.ts: the star and the group star, reconciled on resume
// and received with their assemblies; trust/entries.ts: merge, split and
// departure; trust/continuity.ts: the probe, the continuity mapping and
// the chaining) and the modules given.
//
// The human acts (note §4.2) are typed methods with an options object
// `{when, actId}`; actId is required, minted by the app when the human
// acts, and journaled with the act's result (a repeat with the same actId
// replays it, another input under it is actid-conflict). They wrap `act`
// with the trust module's command names, which stays for modules and
// tests:
//   trust(contactId, opts)                    trust.set {on: true}      human
//   untrust(contactId, opts)                  trust.set {on: false}     human
//   pauseTrust(contactId, paused, opts)       trust.pause               human
//   setClass(contactId, cls, setting, opts)   trust.setClass            human
//   setGroupClass(contactId, groupId, setting, opts)  trust.setGroupClass human
//   merge(contactIds, opts)                   trust.merge               human
//   depart(contactId, opts{relationshipId?})  trust.depart              human
//   decide(promptId, choice, opts)            prompt.decide             human
//   addDevice(name, opts)                     identity.addDevice        human
//   revokeDevice(name, opts)                  identity.revokeDevice     human
//   recover({when})                           trust.recover          not human
// and the read deviceKey(name, contextLabel): the device key of a held,
// unrevoked name under an own anchor context (identity-state.ts).
// A missing actId is refused at runtime as actid-missing.
//
// Reading: the views (views.ts) over one snapshot each, carrying its
// commitSeq. `subscribe` announces every commit with its commitSeq and
// events; the app re-reads the views it shows, and a view read after the
// announcement is at that commitSeq or later.
//
// Delivery: `receive(env, when)` runs Delivery §6.2 in the core and
// dispatches through the task register (receive.ts); `report` takes the
// adapter's reports (on an ack's digest it marks the ack sent); `resume`
// re-emits, runs due duties and re-emits unsent acks; `tick` expires and
// retains (engine.ts).
import { createEngine } from './engine.js'
import type { CommitListener, EnginePorts, HolderModule } from './engine.js'
import type { DeliveryReport } from './ports.js'
import { DECIDE, collectDecisions, promptsModule } from './prompts.js'
import type { ActResult, ReceiveResult, ResumeResult } from './results.js'
import { InfraError } from './results.js'
import { commitViolations } from './invariants.js'
import type { CommitOp } from './invariants.js'
import type { HolderState } from './state.js'
import { toOpaque } from './state.js'
import { trustModule } from './trust/mapping.js'
import { IDENTITY_COMMANDS, deviceKeyOf, identityModule } from './identity-state.js'
import type { DeviceKeyResult } from './identity-state.js'
import type { Dec, Millis, OpaqueHolderState, PromptChoice, Setting, TrustClass } from './state.js'
import { TRUST_COMMANDS } from './trust/mapping.js'
import { ENTRY_COMMANDS } from './trust/entries.js'
import { contactView, contactsView, deliveryStatusView, groupsView, profileView, promptsView } from './views.js'
import type { ContactView, DeliveryStatusView, GroupView, ProfileView, PromptView } from './views.js'

/** The committed state and its commitSeq; the state is opaque (note §4.5):
 *  apps read the views, store tooling may persist it. */
export interface HolderSnapshot { commitSeq: Dec, state: OpaqueHolderState }

export interface HolderOptions {
  /** domain modules to register beside the built-ins, the prompts and the trust module */
  modules?: readonly HolderModule[]
  /** testing mode: check the invariants of invariants.ts on every commit,
   *  before the store's CAS; a violation throws InfraError
   *  'invariant-violated' (cause: the violations) and nothing commits */
  invariants?: boolean
}

/** The options of a human act (note §4.2): its time and the actId the app
 *  mints when the human acts. */
export interface HumanActOptions { when: Millis, actId: string }

export interface Holder {
  /** any registered command by name, for modules and tests; apps use the typed acts */
  act (command: string, input: unknown, when: Millis, opts?: { actId?: string }): Promise<ActResult>
  /** the human's decision on an open prompt: a human act under the app's
   *  actId (note §4.2); a missing actId is also refused at runtime */
  decide (promptId: string, choice: PromptChoice, opts: HumanActOptions): Promise<ActResult>
  /** the Trust act: the anchor mapping class on toward the contact (2770); human */
  trust (contactId: string, opts: HumanActOptions): Promise<ActResult>
  /** trust withdrawn: the anchor mapping class off (2840, 2850); human */
  untrust (contactId: string, opts: HumanActOptions): Promise<ActResult>
  /** the pause of 5.4: star and blinded group star off, or back to default; human */
  pauseTrust (contactId: string, paused: boolean, opts: HumanActOptions): Promise<ActResult>
  /** one class's setting toward the contact (2780, 2810); human */
  setClass (contactId: string, cls: TrustClass, setting: Setting, opts: HumanActOptions): Promise<ActResult>
  /** the sealed group star's setting for one group toward the contact (2830); human */
  setGroupClass (contactId: string, groupId: string, setting: Setting, opts: HumanActOptions): Promise<ActResult>
  /** the manual merge (6640): at most one of them holds an entry; human */
  merge (contactIds: string[], opts: HumanActOptions): Promise<ActResult>
  /** departure (2260): the entry, the relationships of an alias, or one
   *  relationship (relationshipId); human */
  depart (contactId: string, opts: HumanActOptions & { relationshipId?: string }): Promise<ActResult>
  /** 2240: entries re-commit from verified mappings recovered without them; not human */
  recover (opts: { when: Millis }): Promise<ActResult>
  /** a device name into the register before any key derived from it is presented (Identity §5.5); human */
  addDevice (name: string, opts: HumanActOptions): Promise<ActResult>
  /** the name's revocation mark: never removed, the name never given again (Identity §5.5); human */
  revokeDevice (name: string, opts: HumanActOptions): Promise<ActResult>
  /** the device key of a held, unrevoked device name under an own anchor
   *  context (Identity §5.5); reads, changes nothing */
  deviceKey (name: string, contextLabel: string): Promise<DeviceKeyResult>
  tick (when: Millis): Promise<ActResult>
  resume (when: Millis): Promise<ResumeResult>
  report (report: DeliveryReport, when: Millis): Promise<ActResult>
  /** an arriving envelope, as the app's transport delivered it (non-human,
   *  no actId; idempotent over the document digest) */
  receive (env: unknown, when: Millis): Promise<ReceiveResult>
  /** after every commit: its commitSeq and events, the cue to re-read the views */
  subscribe (listener: CommitListener): () => void
  snapshot (): Promise<HolderSnapshot>
  contacts (): Promise<ContactView[]>
  /** by entry id or alias */
  contact (id: string): Promise<ContactView | undefined>
  groups (): Promise<GroupView[]>
  profile (): Promise<ProfileView>
  prompts (): Promise<PromptView[]>
  /** by document digest or threadId */
  deliveryStatus (digestOrThreadId: string): Promise<DeliveryStatusView>
}

/** A holder over its ports: `{store, keys, entropy?, log?, access?, retry?, crypto?}`.
 *  The crypto handle (default globalThis.crypto) is resolved and probed
 *  here and also feeds the default entropy; an app that injects one
 *  passes the same handle to seedKeys(seed, crypto). */
export async function createHolder (ports: EnginePorts, opts: HolderOptions = {}): Promise<Holder> {
  const modules = [identityModule(), trustModule(), ...(opts.modules ?? [])]
  const check = opts.invariants === true
    ? (before: Readonly<HolderState>, after: Readonly<HolderState>, op: CommitOp) => {
        const v = commitViolations(before, after, op)
        if (v.length) throw new InfraError('invariant-violated', `invariants broken by ${op.kind}: ${v.map((x) => `[${x.invariant}] ${x.detail}`).join('; ')}`, { cause: v })
      }
    : undefined
  const engine = await createEngine(ports, [promptsModule(collectDecisions(modules)), ...modules], check ? { check } : {})
  const read = async () => (await engine.snapshot()).state
  /** a human act: `when` and actId from the options, a missing actId refused by the engine */
  const human = (command: string, input: unknown, o: HumanActOptions | undefined) =>
    engine.act(command, input, o?.when as Millis, o?.actId === undefined ? {} : { actId: o.actId })
  return Object.freeze({
    act: (command: string, input: unknown, when: Millis, o?: { actId?: string }) => engine.act(command, input, when, o),
    decide: (promptId: string, choice: PromptChoice, o: HumanActOptions) => human(DECIDE, { promptId, choice }, o),
    trust: (contactId: string, o: HumanActOptions) => human(TRUST_COMMANDS.set, { contactId, on: true }, o),
    untrust: (contactId: string, o: HumanActOptions) => human(TRUST_COMMANDS.set, { contactId, on: false }, o),
    pauseTrust: (contactId: string, paused: boolean, o: HumanActOptions) => human(TRUST_COMMANDS.pause, { contactId, paused }, o),
    setClass: (contactId: string, cls: TrustClass, setting: Setting, o: HumanActOptions) => human(TRUST_COMMANDS.setClass, { contactId, cls, setting }, o),
    setGroupClass: (contactId: string, groupId: string, setting: Setting, o: HumanActOptions) =>
      human(TRUST_COMMANDS.setGroupClass, { contactId, groupId, setting }, o),
    merge: (contactIds: string[], o: HumanActOptions) => human(ENTRY_COMMANDS.merge, { contactIds }, o),
    depart: (contactId: string, o: HumanActOptions & { relationshipId?: string }) =>
      human(ENTRY_COMMANDS.depart, o?.relationshipId === undefined ? { contactId } : { contactId, relationshipId: o.relationshipId }, o),
    recover: (o: { when: Millis }) => engine.act(TRUST_COMMANDS.recover, {}, o?.when as Millis),
    addDevice: (name: string, o: HumanActOptions) => human(IDENTITY_COMMANDS.addDevice, { name }, o),
    revokeDevice: (name: string, o: HumanActOptions) => human(IDENTITY_COMMANDS.revokeDevice, { name }, o),
    deviceKey: async (name: string, contextLabel: string) => deviceKeyOf(await read(), ports.keys, name, contextLabel),
    tick: (when: Millis) => engine.tick(when),
    resume: (when: Millis) => engine.resume(when),
    report: (report: DeliveryReport, when: Millis) => engine.report(report, when),
    receive: (env: unknown, when: Millis) => engine.receive(env, when),
    subscribe: (listener: CommitListener) => engine.subscribe(listener),
    snapshot: async (): Promise<HolderSnapshot> => {
      const s = await engine.snapshot()
      return Object.freeze({ commitSeq: s.commitSeq, state: toOpaque(s.state) })
    },
    contacts: async () => contactsView(await read()),
    contact: async (id: string) => contactView(await read(), id),
    groups: async () => groupsView(await read()),
    profile: async () => profileView(await read()),
    prompts: async () => promptsView(await read()),
    deliveryStatus: async (x: string) => deliveryStatusView(await read(), x),
  })
}
