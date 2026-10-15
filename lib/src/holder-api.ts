// holder-api — createHolder, the facade over the engine (lib Stage 2,
// note §4.1, §4.5). Domain modules (identity, encounter, trust, continuity,
// membership, profile) register with the engine as they graduate; today
// the facade carries the engine's built-ins, the prompts module, the trust
// module (trust/mapping.ts: the Trust act, the class settings, the anchor
// mapping's issuance and reception, the entry commit; trust/star.ts and
// trust/group-star.ts: the star and the group star, reconciled on resume
// and received with their assemblies) and the modules given.
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
import { toOpaque } from './state.js'
import { trustModule } from './trust/mapping.js'
import type { Dec, Millis, OpaqueHolderState, PromptChoice } from './state.js'
import { contactView, contactsView, deliveryStatusView, groupsView, profileView, promptsView } from './views.js'
import type { ContactView, DeliveryStatusView, GroupView, ProfileView, PromptView } from './views.js'

/** The committed state and its commitSeq; the state is opaque (note §4.5):
 *  apps read the views, store tooling may persist it. */
export interface HolderSnapshot { commitSeq: Dec, state: OpaqueHolderState }

export interface HolderOptions {
  /** domain modules to register beside the built-ins, the prompts and the trust module */
  modules?: readonly HolderModule[]
}

export interface Holder {
  act (command: string, input: unknown, when: Millis, opts?: { actId?: string }): Promise<ActResult>
  /** the human's decision on an open prompt: a human act under the app's
   *  actId (note §4.2); a missing actId is also refused at runtime */
  decide (promptId: string, choice: PromptChoice, opts: { when: Millis, actId: string }): Promise<ActResult>
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
  const modules = [trustModule(), ...(opts.modules ?? [])]
  const engine = await createEngine(ports, [promptsModule(collectDecisions(modules)), ...modules])
  const read = async () => (await engine.snapshot()).state
  return Object.freeze({
    act: (command: string, input: unknown, when: Millis, o?: { actId?: string }) => engine.act(command, input, when, o),
    decide: (promptId: string, choice: PromptChoice, o: { when: Millis, actId: string }) =>
      engine.act(DECIDE, { promptId, choice }, o?.when as Millis, o?.actId === undefined ? {} : { actId: o.actId }),
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
