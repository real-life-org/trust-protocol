// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// holder-api — createHolder, the facade over the engine (lib Stage 2,
// note §4.1). Domain modules (identity, encounter, trust, continuity,
// membership, profile) register with the engine as they graduate; today
// the facade carries only the engine's built-ins plus the modules given.
//
// `receive(env, when)` is deliberately absent: it arrives in PR 3 with
// the Delivery stages 1–4 in the core and the task register's dispatch.
// No stub stands in for it.
import { createEngine } from './engine.js';
/** A holder over its ports: `{store, keys, entropy?, log?, access?, retry?, crypto?}`. */
export async function createHolder(ports, opts = {}) {
    const engine = await createEngine(ports, [...(opts.modules ?? [])]);
    return Object.freeze({
        act: (command, input, when, o) => engine.act(command, input, when, o),
        tick: (when) => engine.tick(when),
        resume: (when) => engine.resume(when),
        report: (report, when) => engine.report(report, when),
        subscribe: (listener) => engine.subscribe(listener),
        snapshot: () => engine.snapshot(),
    });
}
