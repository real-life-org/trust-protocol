// holder-api — createHolder, the facade over the engine (lib Stage 2,
// note §4.1). Domain modules (identity, encounter, trust, continuity,
// membership, profile) register with the engine as they graduate; today
// the facade carries only the engine's built-ins plus the modules given.
//
// `receive(env, when)` is deliberately absent: it arrives in PR 3 with
// the Delivery stages 1–4 in the core and the task register's dispatch.
// No stub stands in for it.
import { createEngine } from './engine.js'
import type { CommitListener, EnginePorts, HolderModule, HolderSnapshot } from './engine.js'
import type { DeliveryReport } from './ports.js'
import type { ActResult, ResumeResult } from './results.js'
import type { Millis } from './state.js'

export interface HolderOptions {
  /** domain modules to register beside the built-ins */
  modules?: readonly HolderModule[]
}

export interface Holder {
  act (command: string, input: unknown, when: Millis, opts?: { actId?: string }): Promise<ActResult>
  tick (when: Millis): Promise<ActResult>
  resume (when: Millis): Promise<ResumeResult>
  report (report: DeliveryReport, when: Millis): Promise<ActResult>
  subscribe (listener: CommitListener): () => void
  snapshot (): Promise<HolderSnapshot>
}

/** A holder over its ports: `{store, keys, entropy?, log?, access?, retry?, crypto?}`. */
export async function createHolder (ports: EnginePorts, opts: HolderOptions = {}): Promise<Holder> {
  const engine = await createEngine(ports, [...(opts.modules ?? [])])
  return Object.freeze({
    act: (command: string, input: unknown, when: Millis, o?: { actId?: string }) => engine.act(command, input, when, o),
    tick: (when: Millis) => engine.tick(when),
    resume: (when: Millis) => engine.resume(when),
    report: (report: DeliveryReport, when: Millis) => engine.report(report, when),
    subscribe: (listener: CommitListener) => engine.subscribe(listener),
    snapshot: () => engine.snapshot(),
  })
}
