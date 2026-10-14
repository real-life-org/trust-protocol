// holder-api — createHolder, the facade over the engine (lib Stage 2,
// note §4.1, §4.5). Domain modules (identity, encounter, trust, continuity,
// membership, profile) register with the engine as they graduate; today
// the facade carries the engine's built-ins, the prompts module and the
// modules given.
//
// Reading: the views (views.ts) over one snapshot each, carrying its
// commitSeq. `subscribe` announces every commit with its commitSeq and
// events; the app re-reads the views it shows, and a view read after the
// announcement is at that commitSeq or later.
//
// `receive(env, when)` is deliberately absent: it arrives in PR 3 with
// the Delivery stages 1–4 in the core and the task register's dispatch.
// No stub stands in for it.
import { createEngine } from './engine.js'
import type { CommitListener, EnginePorts, HolderModule, HolderSnapshot } from './engine.js'
import type { DeliveryReport } from './ports.js'
import { DECIDE, promptsModule } from './prompts.js'
import type { ActResult, ResumeResult } from './results.js'
import type { Millis, PromptChoice } from './state.js'
import { contactView, contactsView, deliveryStatusView, groupsView, profileView, promptsView } from './views.js'
import type { ContactView, DeliveryStatusView, GroupView, ProfileView, PromptView } from './views.js'

export interface HolderOptions {
  /** domain modules to register beside the built-ins and the prompts module */
  modules?: readonly HolderModule[]
}

export interface Holder {
  act (command: string, input: unknown, when: Millis, opts?: { actId?: string }): Promise<ActResult>
  /** the human's decision on an open prompt: a human act, needs an actId */
  decide (promptId: string, choice: PromptChoice, when: Millis, opts?: { actId?: string }): Promise<ActResult>
  tick (when: Millis): Promise<ActResult>
  resume (when: Millis): Promise<ResumeResult>
  report (report: DeliveryReport, when: Millis): Promise<ActResult>
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
  const engine = await createEngine(ports, [promptsModule, ...(opts.modules ?? [])])
  const read = async () => (await engine.snapshot()).state
  return Object.freeze({
    act: (command: string, input: unknown, when: Millis, o?: { actId?: string }) => engine.act(command, input, when, o),
    decide: (promptId: string, choice: PromptChoice, when: Millis, o?: { actId?: string }) => engine.act(DECIDE, { promptId, choice }, when, o),
    tick: (when: Millis) => engine.tick(when),
    resume: (when: Millis) => engine.resume(when),
    report: (report: DeliveryReport, when: Millis) => engine.report(report, when),
    subscribe: (listener: CommitListener) => engine.subscribe(listener),
    snapshot: () => engine.snapshot(),
    contacts: async () => contactsView(await read()),
    contact: async (id: string) => contactView(await read(), id),
    groups: async () => groupsView(await read()),
    profile: async () => profileView(await read()),
    prompts: async () => promptsView(await read()),
    deliveryStatus: async (x: string) => deliveryStatusView(await read(), x),
  })
}
