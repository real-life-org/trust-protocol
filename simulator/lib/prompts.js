// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
import { handlerPrepared } from './receive.js';
/** The command name of the decision. */
export const DECIDE = 'prompt.decide';
const KINDS = ['encounter-confirm', 'group-invite', 'introduction'];
/** The decision handlers of the modules, one per kind at most. */
export function collectDecisions(modules) {
    const out = new Map();
    for (const m of modules) {
        for (const [kind, h] of Object.entries(m?.decisions ?? {})) {
            if (!KINDS.includes(kind))
                throw new Error(`unknown prompt kind ${kind} (module ${m.name})`);
            if (out.has(kind))
                throw new Error(`duplicate decision handler ${kind} (module ${m.name})`);
            if (typeof h !== 'function' && (h === null || typeof h !== 'object' || typeof h.apply !== 'function' || (h.prepare !== undefined && typeof h.prepare !== 'function'))) {
                throw new TypeError(`decision handler ${kind} (module ${m.name}) must be a function or {prepare?, apply}`);
            }
            out.set(kind, h);
        }
    }
    return out;
}
const validInput = (input) => input !== null && typeof input === 'object' && typeof input.promptId === 'string' && (input.choice === 'accept' || input.choice === 'decline');
const decideDef = (decisions) => ({
    human: true,
    // a prepared handler's preparation, against the snapshot apply sees;
    // nothing for an unknown, expired or malformed decision (apply answers it)
    async prepare(ctx, input) {
        if (!validInput(input) || !Object.hasOwn(ctx.snapshot.prompts, input.promptId))
            return undefined;
        const p = ctx.snapshot.prompts[input.promptId];
        if (p.expiresAt !== undefined && p.expiresAt <= ctx.when)
            return undefined;
        const h = decisions.get(p.kind);
        return h && typeof h !== 'function' && h.prepare ? h.prepare(ctx, p, input.choice) : undefined;
    },
    apply(state, prepared, input, when) {
        if (input === null || typeof input !== 'object' || typeof input.promptId !== 'string')
            throw new TypeError('prompt.decide needs {promptId: string, choice}');
        if (input.choice !== 'accept' && input.choice !== 'decline')
            throw new TypeError(`prompt.decide: choice must be accept or decline, got ${String(input.choice)}`);
        const { promptId, choice } = input;
        if (!Object.hasOwn(state.prompts, promptId))
            return { ok: false, code: 'unknown-prompt' };
        const p = state.prompts[promptId];
        if (p.expiresAt !== undefined && p.expiresAt <= when)
            return { ok: false, code: 'prompt-expired' };
        const handler = decisions.get(p.kind);
        const r = !handler ? { state: state }
            : typeof handler === 'function' ? handler(state, p, choice, when)
                : handler.apply(state, p, choice, when, handlerPrepared(prepared, prepared.value));
        if (r.ok === false)
            return r;
        const done = r;
        const prompts = { ...done.state.prompts };
        delete prompts[promptId];
        const decided = { type: 'prompt.decided', promptId, kind: p.kind, choice };
        return {
            state: { ...done.state, prompts },
            ...(done.outbound ? { outbound: done.outbound } : {}),
            ...(done.duties ? { duties: done.duties } : {}),
            events: [...(done.events ?? []), decided],
        };
    },
});
/** The prompts module createHolder registers, over the modules' decision handlers. */
export function promptsModule(decisions = new Map()) {
    return Object.freeze({ name: 'prompts', commands: Object.freeze({ [DECIDE]: decideDef(decisions) }) });
}
