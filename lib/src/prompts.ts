// prompts — the human's open decisions and the act that closes them
// (lib Stage 2, note §2.1 prompts, §4.4, §4.5).
//
// Domain modules open prompts (encounter-confirm, group-invite,
// introduction) inside their own transitions and announce prompt.opened;
// this module closes them. `prompt.decide` is one human act (journaled
// under the app's actId). createHolder registers this module beside the
// domain modules, so its command name is taken.
//
// What a choice does in its domain (joining the group, confirming the
// encounter, accepting the introduction) belongs to the module that opens
// that kind of prompt: it registers a DecisionHandler for the kind
// (HolderModule.decisions). The decision runs that handler in its own
// transition, so the domain effect, its outbound and duties, and the
// closing of the prompt commit together or not at all; a handler's
// refusal refuses the decision. A kind without a handler is only closed.
// The events are the handler's, then prompt.decided. At most one handler
// per kind across all modules; a second, an unknown kind or a handler
// that is no function throws when the holder is built.
//
// Expiry: a prompt with expiresAt <= when is refused as prompt-expired;
// the refusal commits nothing, so the prompt stays until tick removes it
// (engine.ts, built-in tick). An id without an open prompt is
// unknown-prompt. A malformed input (a promptId that is no string, a
// choice other than accept or decline) is a programming error and throws.
//
// A handler that signs or seals (PR 7: the counter-step, the membership
// accept, the introduction's consent) is the prepared form {prepare?,
// apply}: its preparation runs in the decision's own preparation, against
// the snapshot its apply then sees (engine.ts, step 2).
import type { Applied, CommandDef, DecisionDef, DecisionHandler, EventDraft, HolderModule, Refusal } from './engine.js'
import { handlerPrepared } from './receive.js'
import type { HolderState, PromptChoice, PromptKind } from './state.js'

/** The command name of the decision. */
export const DECIDE = 'prompt.decide'

export interface DecideInput { promptId: string, choice: PromptChoice }

const KINDS: readonly PromptKind[] = ['encounter-confirm', 'group-invite', 'introduction']

export type Decisions = ReadonlyMap<PromptKind, DecisionHandler>

/** The decision handlers of the modules, one per kind at most. */
export function collectDecisions (modules: readonly HolderModule[]): Decisions {
  const out = new Map<PromptKind, DecisionHandler>()
  for (const m of modules) {
    for (const [kind, h] of Object.entries(m?.decisions ?? {})) {
      if (!(KINDS as readonly string[]).includes(kind)) throw new Error(`unknown prompt kind ${kind} (module ${m.name})`)
      if (out.has(kind as PromptKind)) throw new Error(`duplicate decision handler ${kind} (module ${m.name})`)
      if (typeof h !== 'function' && (h === null || typeof h !== 'object' || typeof (h as DecisionDef).apply !== 'function' || ((h as DecisionDef).prepare !== undefined && typeof (h as DecisionDef).prepare !== 'function'))) {
        throw new TypeError(`decision handler ${kind} (module ${m.name}) must be a function or {prepare?, apply}`)
      }
      out.set(kind as PromptKind, h)
    }
  }
  return out
}

const validInput = (input: DecideInput): boolean =>
  input !== null && typeof input === 'object' && typeof input.promptId === 'string' && (input.choice === 'accept' || input.choice === 'decline')

const decideDef = (decisions: Decisions): CommandDef<DecideInput, unknown> => ({
  human: true,
  // a prepared handler's preparation, against the snapshot apply sees;
  // nothing for an unknown, expired or malformed decision (apply answers it)
  async prepare (ctx, input) {
    if (!validInput(input) || !Object.hasOwn(ctx.snapshot.prompts, input.promptId)) return undefined
    const p = ctx.snapshot.prompts[input.promptId]
    if (p.expiresAt !== undefined && p.expiresAt <= ctx.when) return undefined
    const h = decisions.get(p.kind)
    return h && typeof h !== 'function' && h.prepare ? h.prepare(ctx, p, input.choice) : undefined
  },
  apply (state, prepared, input, when) {
    if (input === null || typeof input !== 'object' || typeof input.promptId !== 'string') throw new TypeError('prompt.decide needs {promptId: string, choice}')
    if (input.choice !== 'accept' && input.choice !== 'decline') throw new TypeError(`prompt.decide: choice must be accept or decline, got ${String(input.choice)}`)
    const { promptId, choice } = input
    if (!Object.hasOwn(state.prompts, promptId)) return { ok: false, code: 'unknown-prompt' }
    const p = state.prompts[promptId]
    if (p.expiresAt !== undefined && p.expiresAt <= when) return { ok: false, code: 'prompt-expired' }
    const handler = decisions.get(p.kind)
    const r: Applied | Refusal = !handler ? { state: state as HolderState }
      : typeof handler === 'function' ? handler(state, p, choice, when)
        : handler.apply(state, p, choice, when, handlerPrepared(prepared, prepared.value))
    if ((r as Refusal).ok === false) return r as Refusal
    const done = r as Applied
    const prompts = { ...done.state.prompts }
    delete prompts[promptId]
    const decided: EventDraft = { type: 'prompt.decided', promptId, kind: p.kind, choice }
    return {
      state: { ...done.state, prompts },
      ...(done.outbound ? { outbound: done.outbound } : {}),
      ...(done.duties ? { duties: done.duties } : {}),
      events: [...(done.events ?? []), decided],
    }
  },
})

/** The prompts module createHolder registers, over the modules' decision handlers. */
export function promptsModule (decisions: Decisions = new Map()): HolderModule {
  return Object.freeze({ name: 'prompts', commands: Object.freeze({ [DECIDE]: decideDef(decisions) }) })
}
