# Claude Instructions for `trust-protocol`

This file delegates to `AGENTS.md`, the shared source of truth for agent
guidance in this repository. **Read it first** — in particular the opening
section **"What This Repository Is"**, which states the nature of the work
here: a public, openly licensed protocol specification and its reference
library, whose Security and Privacy Considerations necessarily analyse
attacks against the specification itself. Apart from the env-gated
interoperability probes in `binding/`, nothing in this repository talks to
anyone else's systems.

@AGENTS.md

## Claude-specific notes

- Specification text is drafted and reviewed in the private workshop and
  arrives here when a casting is ready to be public. The library under
  `lib/`, the simulators, and the site are developed here, as pull requests
  against `main`.
- Before proposing any change, run `npm run validate` from the root; for
  changes under `lib/` also the library steps listed in `AGENTS.md`
  under "Checks". `node scripts/validate.mjs` alone is not the full
  contract.
- Both simulators are static browser artifacts published at
  <https://trust-protocol.real-life.org/simulator/> and
  <https://trust-protocol.real-life.org/apps/gesamtsimulator/>; they use no
  network services and store nothing remotely.
- Mermaid diagrams in the specifications render on GitHub. Three
  constraints apply to them: no semicolons in message text (mermaid reads
  them as statement separators), no HTML such as `<br/>` (GitHub strips it
  and the labels collide), and no light hard-coded `rect rgb(...)` blocks
  (unreadable in dark mode — use a neutral `rgba(...)`).
