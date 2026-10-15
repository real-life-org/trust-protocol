// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
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
import { createEngine } from './engine.js';
import { DECIDE, collectDecisions, promptsModule } from './prompts.js';
import { toOpaque } from './state.js';
import { trustModule } from './trust/mapping.js';
import { contactView, contactsView, deliveryStatusView, groupsView, profileView, promptsView } from './views.js';
/** A holder over its ports: `{store, keys, entropy?, log?, access?, retry?, crypto?}`.
 *  The crypto handle (default globalThis.crypto) is resolved and probed
 *  here and also feeds the default entropy; an app that injects one
 *  passes the same handle to seedKeys(seed, crypto). */
export async function createHolder(ports, opts = {}) {
    const modules = [trustModule(), ...(opts.modules ?? [])];
    const engine = await createEngine(ports, [promptsModule(collectDecisions(modules)), ...modules]);
    const read = async () => (await engine.snapshot()).state;
    return Object.freeze({
        act: (command, input, when, o) => engine.act(command, input, when, o),
        decide: (promptId, choice, o) => engine.act(DECIDE, { promptId, choice }, o?.when, o?.actId === undefined ? {} : { actId: o.actId }),
        tick: (when) => engine.tick(when),
        resume: (when) => engine.resume(when),
        report: (report, when) => engine.report(report, when),
        receive: (env, when) => engine.receive(env, when),
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
