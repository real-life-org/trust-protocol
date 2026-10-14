// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
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
import { createEngine } from './engine.js';
import { DECIDE, collectDecisions, promptsModule } from './prompts.js';
import { toOpaque } from './state.js';
import { contactView, contactsView, deliveryStatusView, groupsView, profileView, promptsView } from './views.js';
/** A holder over its ports: `{store, keys, entropy?, log?, access?, retry?, crypto?}`.
 *  The crypto handle (default globalThis.crypto) is resolved and probed
 *  here and also feeds the default entropy; an app that injects one
 *  passes the same handle to seedKeys(seed, crypto). */
export async function createHolder(ports, opts = {}) {
    const modules = [...(opts.modules ?? [])];
    const engine = await createEngine(ports, [promptsModule(collectDecisions(modules)), ...modules]);
    const read = async () => (await engine.snapshot()).state;
    return Object.freeze({
        act: (command, input, when, o) => engine.act(command, input, when, o),
        decide: (promptId, choice, o) => engine.act(DECIDE, { promptId, choice }, o?.when, o?.actId === undefined ? {} : { actId: o.actId }),
        tick: (when) => engine.tick(when),
        resume: (when) => engine.resume(when),
        report: (report, when) => engine.report(report, when),
        subscribe: (listener) => engine.subscribe(listener),
        snapshot: async () => {
            const s = await engine.snapshot();
            return Object.freeze({ commitSeq: s.commitSeq, state: toOpaque(s.state) });
        },
        contacts: async () => contactsView(await read()),
        contact: async (id) => contactView(await read(), id),
        groups: async () => groupsView(await read()),
        profile: async () => profileView(await read()),
        prompts: async () => promptsView(await read()),
        deliveryStatus: async (x) => deliveryStatusView(await read(), x),
    });
}
