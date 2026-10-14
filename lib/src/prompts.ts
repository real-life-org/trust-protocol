// prompts — the human's open decisions and the act that closes them
// (lib Stage 2, note §2.1 prompts, §4.4, §4.5).
//
// Domain modules open prompts (encounter-confirm, group-invite,
// introduction) inside their own transitions and announce prompt.opened;
// this module closes them. `prompt.decide` is one human act (journaled
// under the app's actId): it removes the prompt and announces
// prompt.decided with the choice. createHolder registers this module
// beside the domain modules, so its command name is taken.
//
// What a choice does in its domain (joining the group, confirming the
// encounter, accepting the introduction) belongs to the module that opens
// that kind of prompt and arrives with it (PR 4, PR 7); until then a
// decision closes the prompt and nothing else.
//
// Expiry: a prompt with expiresAt <= when is refused as prompt-expired;
// the refusal commits nothing, so the prompt stays until tick removes it
// (engine.ts, built-in tick). An id without an open prompt is
// unknown-prompt. A malformed input (a promptId that is no string, a
// choice other than accept or decline) is a programming error and throws.
import type { CommandDef, HolderModule } from './engine.js'
import type { PromptChoice } from './state.js'

/** The command name of the decision. */
export const DECIDE = 'prompt.decide'

export interface DecideInput { promptId: string, choice: PromptChoice }

const decide: CommandDef<DecideInput> = {
  human: true,
  apply (state, _prepared, input, when) {
    if (input === null || typeof input !== 'object' || typeof input.promptId !== 'string') throw new TypeError('prompt.decide needs {promptId: string, choice}')
    if (input.choice !== 'accept' && input.choice !== 'decline') throw new TypeError(`prompt.decide: choice must be accept or decline, got ${String(input.choice)}`)
    const { promptId, choice } = input
    if (!Object.hasOwn(state.prompts, promptId)) return { ok: false, code: 'unknown-prompt' }
    const p = state.prompts[promptId]
    if (p.expiresAt !== undefined && p.expiresAt <= when) return { ok: false, code: 'prompt-expired' }
    const prompts = { ...state.prompts }
    delete prompts[promptId]
    return { state: { ...state, prompts }, events: [{ type: 'prompt.decided', promptId, kind: p.kind, choice }] }
  },
}

/** The prompts module createHolder registers. */
export const promptsModule: HolderModule = Object.freeze({
  name: 'prompts',
  commands: Object.freeze({ [DECIDE]: decide }),
})
