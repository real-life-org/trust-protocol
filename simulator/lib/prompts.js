// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
/** The command name of the decision. */
export const DECIDE = 'prompt.decide';
const decide = {
    human: true,
    apply(state, _prepared, input, when) {
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
        const prompts = { ...state.prompts };
        delete prompts[promptId];
        return { state: { ...state, prompts }, events: [{ type: 'prompt.decided', promptId, kind: p.kind, choice }] };
    },
};
/** The prompts module createHolder registers. */
export const promptsModule = Object.freeze({
    name: 'prompts',
    commands: Object.freeze({ [DECIDE]: decide }),
});
