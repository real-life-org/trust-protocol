# Agent Instructions for `trust-protocol`

## What This Repository Is

`trust-protocol` is the **public, openly licensed home** (spec text
CC BY 4.0, code Apache-2.0) of the **Real Life Trust Protocol (RLTP)**: a
decentralized trust protocol rooted in encounters between people,
published by the
[Real Life Organisation](https://real-life.org).

It holds four things:

- the **specification**: layer documents, normative JSON Schemas, JSON-LD
  contexts, test vectors, must-fail fixtures, a conformance runner, the
  term register, and the ceremony definitions for interoperability;
- the **reference library** `@real-life/trust-protocol` under `lib/`,
  published to npm, which reproduces the vectors byte for byte;
- two **buildless simulators** that run on a frozen copy of that library:
  the ceremony simulator under `simulator/` and the workbench under
  `apps/gesamtsimulator/`;
- the **site** <https://trust-protocol.real-life.org> under `apps/site/`,
  which publishes the normative files and the simulators unchanged.

The specification text is drafted and reviewed elsewhere and arrives here
when a casting is ready to be public. The library, the simulators, and the
site are developed here.

Nothing in this repository is a deployed service, and nothing here
targets or probes systems the authors do not own. The one place that
talks to a foreign system is `binding/`: a dev-only wire binding whose
live probes run, only when `RLTP_LIVE_MEDIATOR=1` is set, against the
public development instance of the OpenVTC mediator, as agreed
interoperability testing with that project. The probes send and receive
the repository's own documents; they test nothing else.

Consequently, the following are **normal, expected, defensive
specification work** in this repository, on the authors' own protocol:

- **Threat modelling and attack analysis of our own design.** Asking "how
  would an attacker defeat this rule?" is *how protocol requirements are
  derived*. IETF- and W3C-style specifications **require** `Security
  Considerations` and `Privacy Considerations` sections; writing them means
  enumerating attacks against our own construction and stating honestly
  what it does and does not prevent. Every RLTP document here carries both
  sections, and they are written that way on purpose.
- **Cryptographic design work**: signature binding, canonicalization
  (JCS/RFC 8785), key derivation and rotation, replay and forgery
  resistance, revocation semantics, partition behaviour, post-compromise
  security.
- **Adversarial review of our own drafts and our own library.** Findings
  phrased "an attacker can do X" are review output **about this
  specification or its implementation**, never instructions against a
  third party; each is answered by revising the text or the code.
- **Comparison with adjacent open protocols** (ToIP/TSP and the DTGWG Trust
  Tasks framework, KERI/ACDC, UCAN, MLS, Keyhive/BeeKEM, p2panda, Solid,
  Murmurations), including honest assessment of their weaknesses and ours.

### Vocabulary note

Security specification text is necessarily dense with adversarial
vocabulary — *attacker, adversary, forgery, replay, Sybil, equivocation,
revocation, denial of service*. In every instance the subject is **this
specification**, and the purpose is to make it correct.

## Scope Boundary

This repository does not contain, and must not be used to produce:
exploitation tooling, attacks against systems the authors do not own,
techniques whose purpose is to evade detection, or any operational
offensive capability. Protocol weaknesses identified here are documented
and fixed in the specification and the library.

---

## Repository Layout

```text
spec/          the layer specifications and task-type registrations;
               spec/archive/ keeps every earlier casting unchanged
schemas/       normative JSON Schemas for every wire artifact
contexts/      the pinned RLTP JSON-LD context (and the DTG context)
vectors/       deterministic test vectors (implementations MUST reproduce
               them byte-for-byte)
fixtures/      must-fail examples for validator conformance
conformance/   the conformance runner: recomputes every cryptographic claim
               of the vectors, validates every schema claim, and holds the
               rule-id lists per layer casting
interop/       RLTP ceremonies in the ToIP DTGWG ceremony-definition format
terms/         the SKOS term register (rltp.skos.jsonld)
lib/           the library @real-life/trust-protocol (TypeScript, zero
               dependencies; npm, released by tag lib-v*)
simulator/     the ceremony simulator (browser + Node engine); simulator/lib/
               is the committed freeze of lib/dist
apps/gesamtsimulator/
               the workbench: one trust network, device windows running the
               app, a visible channel with fault injection; its lib/ is a
               byte-identical copy of simulator/lib (checked in CI)
apps/site/     the Astro site for trust-protocol.real-life.org; its build
               copies the normative files and the simulators next to the
               pages (apps/site/scripts/assemble.mjs). Its own pages live in
               apps/site/src/content/docs/:
                 understand/   explanations of the protocol in plain
                               language (why, foundations, encounter, trust,
                               groups, group keys), linking into spec
                               sections by anchor
                 get-started/  try the simulators, read the spec, implement
                 reference/    the list of specifications, the registered
                               Trust Tasks, and the glossary (generated
                               from terms/ at build time)
binding/       dev-only wire binding of the VTI mediator adapter
               (spec/adapter-vti-mediator.md §7) over vti-didcomm-js and
               vti-tsp-js; never a dependency of lib/
scripts/       publication checks, vector generators, and the build scripts
               for the simulator freeze and the generated types
```

### Specification paths are never auto-merged

Changes under `spec/`, `schemas/`, `contexts/`, `vectors/`, `fixtures/`,
`conformance/`, `interop/` and `terms/` are normative. An agent may prepare
them as a pull request, but only a human maintainer merges them (see
`.github/CODEOWNERS`).

## Checks

Run from the repository root before proposing a change:

```sh
npm ci && npm run validate
```

This runs the script tests, the companion pin check, the check of links
into spec sections and of the castings the READMEs name
(`scripts/check-doc-refs.mjs`), the `specs:` declarations of the site
pages (`scripts/check-doc-specs.mjs`), the check of this file and `CLAUDE.md`
against the repository (`scripts/check-agents-md.mjs`),
the schema and vector validation, the freshness of the generated
`lib/src/schemas.ts` and `lib/src/wire.ts`, and the vector generators in
`--check` mode: each committed vector must be reproduced byte for byte.

For a change under `lib/`, `simulator/` or `apps/gesamtsimulator/`:

```sh
cd lib && npm ci && npm run build && npm test && cd ..
node scripts/build-simulator-lib.mjs --check
npm run check:generators:lib
node scripts/check-code-samples.mjs
diff -r simulator/lib apps/gesamtsimulator/lib
cd simulator && npm test && for t in rltp-crypto-test clock-test introduce-test \
  trust-test groups-test continuity-test delivery-test graph-web-test; do node "$t.mjs"; done
```

In `simulator/`, `npm test` covers only `simulator/test/*.test.mjs`; the
eight standalone `*-test.mjs` scripts in the loop are the rest of its suite.

When the library changes, refreeze both copies and commit them in the same
change. `scripts/build-simulator-lib.mjs` writes `simulator/lib/` only; the
workbench copy is replaced wholesale so that modules removed from the
library do not survive as orphans:

```sh
node scripts/build-simulator-lib.mjs
rm -rf apps/gesamtsimulator/lib && cp -r simulator/lib apps/gesamtsimulator/lib
```

CI (`.github/workflows/validate.yml`) runs the check steps above.

## When a Casting Lands

A new casting of a specification arrives as one pull request. Besides the
specification text, schemas, vectors, and library, that pull request
updates everything that describes the specification:

1. **Companion pins** in the other specifications. `npm run validate`
   warns on stale pins.
2. **Status line** in `README.md` and the versions named in
   `lib/README.md`. `npm run validate` fails on a README that names an
   old casting and warns on a library README that lags one.
3. **Pages under `apps/site/src/content/docs/`**: every link into a
   renamed or renumbered section, and every statement the casting made
   untrue. `npm run validate` fails on a link into a section that no
   longer exists, here and in the term register. Each page names the
   specifications it rests on in its `specs:` frontmatter; the
   `docs-follow` workflow (`.github/workflows/docs-follow.yml`) fails a
   pull request that edits one of them until the pages are updated or a
   person has read them and labelled the pull request `docs-checked`.
   Read the `understand/` pages that cover the layer; the links alone
   prove nothing about the text.
4. **Term register** `terms/rltp.skos.jsonld` for terms the casting adds,
   renames, or removes; the glossary follows from it.
5. **This file and `CLAUDE.md`** when the casting adds a directory, a
   script, a check, or a workflow. `npm run validate` fails when a
   directory is missing from the layout above, or when a path or an
   `npm run` script named here does not exist.

## When the Library Is Released

A release changes the version in `lib/package.json`; the tag follows the
merge. The pull request that changes the version also updates:

1. **`lib/README.md` and `lib/CHANGELOG.md`**: the exports, the acts, the
   module table, and what changed.
2. **The pages that describe the library**, marked `library: true` in
   their frontmatter (today `get-started/implement.md`). The `docs-follow`
   workflow fails the pull request until they are updated or labelled
   `docs-checked`.

The code samples on the site and in `lib/README.md` are compiled
against every library build (`scripts/check-code-samples.mjs`, in the CI
library job): a sample that imports an export or an entry point the
library no longer has, or calls a method a holder no longer offers, fails.
Pages describe the library briefly and link to `lib/README.md` for the
lists of exports and modules, so those lists exist once.

## Conventions

- **English throughout**, in documents, code comments, and commit messages.
  BCP 14 normative language (`MUST` / `SHOULD` / `MAY`), RFC model
  structure, mandatory Security and Privacy Considerations.
- **Offline schema closure.** Conforming implementations pre-register every
  schema by its `$id` and never resolve schemas or contexts over the
  network at runtime. The identifiers under `https://real-life.org/rltp/v1`
  and `https://real-life.org/trust-tasks/` exist for documentation and
  distribution, not as runtime infrastructure.
- **Drafts are castings.** A new version is a complete re-write answering
  an adversarial review round; earlier castings are archived unchanged
  under `spec/archive/`. A document's `Status of This Document` section
  states its maturity honestly.
- **Specification, schemas, vectors, and library move together.** A change
  to normative behaviour keeps all four aligned in one pull request, with
  the simulator freeze refrozen.
- **Releases.** A tag `lib-v<version>` whose version matches
  `lib/package.json` publishes the library with npm provenance
  (`.github/workflows/release.yml`). The tag is pushed by a human.
- **Site pages state the current protocol, not its history.** No "since
  casting 0.30", no "previously", no "earlier generation". Explaining how
  documents converge, as `get-started/read-the-spec.md` does, is content
  and stays. A heading names its content, the first sentence states a
  fact, no promotional language.
- **Dependencies** are updated by Renovate under the shared preset of the
  real-life-org repositories (`renovate.json5`).

## Feedback

Issues and discussion are welcome via this repository's issue tracker.
This is an early-stage specification: disagreement, counterexamples, and
"your Security Considerations missed X" are the most useful contributions
we can receive.
