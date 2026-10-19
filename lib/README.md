# @real-life/trust-protocol

**The Real Life Trust Protocol (RLTP), as running code.** Trust rooted in
encounters between people: two humans meet, recognize each other, and record
that recognition as verifiable credentials. Cryptography proves freshness and
authorship; only a human can witness a human.

This package is the reference library of the specification. It lives beside
the schemas and the test vectors it reproduces byte for byte. Published by the
[Real Life Organisation](https://real-life.org) under CC BY 4.0.

- Specification, schemas and vectors: <https://trust-protocol.real-life.org>
- Zero runtime dependencies. WebCrypto only (Ed25519, X25519, HKDF,
  AES-256-GCM, SHA-256), with one scoped exception: a synchronous SHA-256
  (`sha256.ts`) digests local reconciliation views inside synchronous state
  transitions (the star and the group star). It never touches wire bytes,
  keys or MACs.
- No DOM, no storage, no network: the holder computes and verifies, the app
  stores its state and carries its envelopes.

## Install

```sh
npm i @real-life/trust-protocol
```

## The holder

`createHolder` is one person's device: its state behind the human acts, the
delivery channel's three calls and the views an app reads.

```ts
import { createHolder, seedKeys } from '@real-life/trust-protocol'
import { InMemoryStore } from '@real-life/trust-protocol/testing'

const holder = await createHolder({ store: new InMemoryStore(), keys: seedKeys(rootSeed) })

// a human act: its time and an actId the app mints when the human acts
const shown = await holder.show({ when: Date.now(), actId: crypto.randomUUID() })
// shown.events carries the card to display; shown.outbound the envelopes to send

// the channel: one receive per arriving envelope, the adapter's reports,
// and resume on a timer (retries and due duties)
const got = await holder.receive(envelope, Date.now())
await holder.report({ digest, status: 'accepted' }, Date.now())
const { outbound, nextDueAt } = await holder.resume(Date.now())

// the views, read after each commit (subscribe announces them)
holder.subscribe(async () => render(await holder.contacts(), await holder.prompts()))
```

**The timer.** Every act, receive and resume may name `nextDueAt`: the
earliest time something is due, delivery work (retries, duties, acks)
and expiry work (a prompt's expiry, an act's timeout or lifetime, an aging
challenge, the retention of the effect cache, the journal, the outbox and
the address keys) alike. The app keeps one timer at the earliest
`nextDueAt` it was given; when it fires, it calls `tick(now)` and then
`resume(now)`, sends the outbound and sets the timer anew.

Every act returns `{ok: true, outbound, events} | {ok: false, code, ref?}`;
`code` is a closed union, `ref` names the rule where one applies. Every
`outbound` item is pure JSON (`digest`, `envelope`, `type`, `threadId`,
`recipient`, `attempt`); the app delivers it to the device holding
`envelope.rkid` and reports what its transport saw by `digest`.

The human acts: `show`, `scan`, `captureSentCard`, `counter` (the encounter),
`decide` (a prompt: confirm an encounter, accept an invitation, take up or
consent to an introduction), `trust`, `untrust`, `pauseTrust`, `setClass`,
`setGroupClass`, `merge`, `depart`, `setProfile`, `foundGroup`, `invite`,
`vouchFor`, `introduce`, `rotateAnchor`, `addDevice`, `revokeDevice`. Not
human: `receive`, `report`, `resume`, `tick`, `recover`. Reads: `contacts`,
`contact`, `groups`, `profile`, `prompts`, `deliveryStatus`, `deviceKey`,
`snapshot`, `subscribe`.

## What the root exports

- `createHolder` and its types (`Holder`, `HolderOptions`, `HumanActOptions`,
  `HolderSnapshot`).
- The ports: `Store`, `KeyProvider`, `Entropy`, `Log`, `Access`,
  `RetryPolicy`, `DeliveryReport`, `Outbound`; `seedKeys(seed)` is the
  default KeyProvider, `randomEntropy` the default Entropy.
- The views: `ContactView`, `GroupView`, `PromptView`, `ProfileView`,
  `DeliveryStatusView` and their parts.
- The results and events: `ActResult`, `ReceiveResult`, `ResumeResult`,
  `InfraError`, `CryptoUnavailableError`, `HolderEvent`.
- The state as an opaque type (`HolderState`), `decodeState`, `CODEC`,
  `StateCodecError`, and `storeContract`, the suite a Store adapter passes.
- The pure wire builders and verifiers of every layer (`core`, `crypto`,
  `identity`, `profile`, `encounter`, `membership`, `introduction`,
  `delivery`, `carrier-identity`, `carrier`, `carrier-holder`), and two
  namespaces of pure forms: `visibility` (anchor, star, group star,
  continuity, acks) and `ceremony` (the encounter's, the group's and the
  introduction's forms).

Other entry points:

| Entry point | What it holds |
|---|---|
| `./testing` | `InMemoryStore`, `memoryLog`, `scriptedEntropy`, `storeContract`, `emptyState`, `stateBuilder`, `freezeDeep`, `sampleState`, `openPromptModule`, the invariant checks, `forgeMapping` (deniability, Trust 6.1), `SCHEMAS` and the generated `wire` types. For tests, vectors and adapter authors; not for production holders. |
| `./internal` | The structural `HolderState`, `encodeState` and the codec chain, the engine's module types, the pure view functions, the modules' factories and pure reads. For the library's own modules and tests; not an app contract. |
| `./adapters/vti-mediator` | The VTI mediator as a carrier adapter: its submission states as `DeliveryReport`, collection and ack handling. |

## The modules and the rules they implement

Bare four-digit numbers are RLTP-TRU rules; the other layers name theirs.

| Module | Specification | Rules |
|---|---|---|
| `core` | all layers | the canonical form: JCS (RFC 8785), multibase, digest equality over decoded bytes, whole-second timestamps, calendar validity, the JSON-Schema subset validator |
| `crypto` | primitives | HKDF, key pairs, did:key and multikey, X25519, the `eddsa-jcs-2022` Data Integrity proof |
| `identity` | Identity 0.54 §6.1, §6.2, §5.4, §5.5 | context derivation under the closed label registry: `group/<digest>` and its generations, `pair/…`, `persona/…`, `device/<n>/<c>`; the name pipeline pinned to Unicode 15.0 |
| `identity-state` | Identity §2, §5.4, §5.5 | the label register with monotone sets, device names and revocation marks, the community anchor's rotation as a procedure over the Log port (register before log before duties) |
| `encounter`, `encounter/ceremony` | Encounter 0.31 §4–§7 | `encounter-scan@0.25`: challenges and their aging latch (5.3), the enactment record (5.5), the 5.6 acceptance in its order, both paths of 5.8, `encounter-bundle/0.1` and `encounter-credential-delivery/0.1` with signed acks, the confirm prompt |
| `trust/mapping` | Trust Section 2, 2a, §6.1–§6.5 | the trust act and the class settings (2720–2850), `anchor-mapping@4` issuance (6300/6310, 6420) and verification (6.3, conditions 4a, 4b, 8), the entry commit and the admission bound |
| `trust/star`, `trust/group-star` | Trust §5.1–§5.4, §5.2b | `star@2` and `group-star@1` reconciled per recipient (5.4: salt scope, baseline automaton, completion by the ack), reception with assemblies and lower bounds |
| `trust/entries` | Trust Section 2, §6a.1 | merge (net and manual, 6640), split (2080–2115), departure (2260), the head rule and the binding rule (6605) |
| `trust/continuity` | Trust §6a | `continuity-probe@1` and `continuity-mapping@1`, chaining a re-encounter into the existing relationship (6a.4) |
| `trust/profile`, `profile` | Trust §6b | `profile@1`: the one revision counter (6450), delivery on the class gates (6455), reception and the image bounds (6475) |
| `trust/duties` | Trust 2850, 6370, 6455, 6595, 6596 | the duties a commit leaves: class on, re-issue after a rotation, the lag rule |
| `membership`, `membership/holder` | Membership Tasks 0.20 on Access 0.57 | founding (Access 3.4.1), the prelude, invite, accept, admission and welcome, evidence relay and `vouch@2` (Access 5.3), an in-library Access over the holder's groups |
| `introduction`, `introduction/holder` | Trust §8 on Delivery §4.4 | the Introduction Act in its three roles: request, forward, reply, the mediator's one ack at its declared delay, the vouchers; the requester's timeout at the act's expiry (8340; A20, spec follow-up 18: no ack timeout of 8690) |
| `receive`, `engine` | Delivery 0.82 §5, §6.1, §6.2 | the sealed envelope and the two key classes, stages 1–9 once per envelope with the disposition `discarded`, the task register by full task URI, the completed-effect cache with stored acks, the outbox with the status trias, retry by backoff, give-up at the horizon, the act journal |
| `carrier-identity`, `carrier`, `carrier-holder` | Identity §7a, Delivery §4.4, §5a, Identity §9.3 | the carrier-relationship principal, the carrier port's state machine, proofs, verdicts and recovery |
| `views`, `prompts` | — | the read model: contacts by entry (2120, 2140), groups, prompts, the delivery status |

## Runtime

| Runtime | Status |
|---|---|
| Node 22 | tested in CI (the library job) |
| Node 24 | tested locally |
| Node 20 | the declared minimum (`engines`); Ed25519 and X25519 are in its WebCrypto |
| Chromium 145 | tested by the workbench's end-to-end run (`apps/gesamtsimulator/tests/local-perspective.mjs`) |
| Chromium ≥ 137, Firefox ≥ 129, Safari ≥ 17 | expected: they carry Ed25519 and X25519 in WebCrypto; not tested here |

The WebCrypto handle is resolved when a holder is built, not at import: an
app may pass its own (`createHolder({crypto})`, `seedKeys(seed, crypto)`),
and a runtime without Ed25519 or X25519 is reported then as
`CryptoUnavailableError`.

## State, codec and storage

A holder's state is pure JSON under a codec version. The Store port takes
the state as opaque JSON and gives it back; the library decodes it
(`decodeState`), the adapter never migrates.

- **Codec 1** is the format of 0.4.0, the first stable one. Its golden
  fixtures (`test/fixtures/state-v1*.json`, deterministic runs of
  `test/fixtures/gen-state-v1.mjs`, reproduced in `npm test`) cover a
  settled holder, one with work open (prompts, a joining invite, duties, a
  rotation at step 2) and one with a tombstone, a revoked device and
  carrier entries; each decodes and re-encodes byte for byte. A later codec brings its validator, a pure migration from the
  one before, and its own fixture with a migration test.
- A newer codec is refused as `codec-newer`, a codec without a validator
  as `codec-unknown`; nothing is read best-effort.
- `schemas/holder-state-v1.schema.json` describes codec 1 as a
  non-normative JSON Schema (published with the package). The type
  `HolderStateV1` (`./internal`) is generated from it
  (`scripts/build-holder-state-types.mjs`); the build holds it against the
  library's `HolderState`, and the tests hold the schema against the
  codec's validator on the fixtures and on mutations of them. Two rules
  only the codec states: a record's id equals its key, and an envelope's
  `rkid` equals its recipient's `keyAgreement`.

**Writing a Store adapter.** Implement `read(): Promise<{state, version}>`
(a deep, independent copy; `null` state and version for an empty store) and
`commit(version, next): Promise<{ok: true, version} | {ok: false, reason:
'conflict'}>` as compare-and-swap: atomic, storing a copy, a version token
never reused in the store's lifetime. One writer per holder; the adapter
guarantees it. Then run the contract against it:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { storeContract } from '@real-life/trust-protocol'

storeContract(() => new MyStore(), { test, assert })   // a fresh, empty store per call
```

It checks snapshot isolation, CAS, atomicity, a lost result, the codec
boundary and reopening. Durability across process loss is the persistent
adapter's own test.

## Invariants and the generator

`invariants.ts` states predicates over a commit (`state → state'`): the
register and revocation marks only grow, tombstones never shrink, a salt is
issued at most once per tuple, the effect cache holds only completed
digests, `accepted` arises only from a report, a duty leaves only by its
specified fulfilment. `createHolder(ports, {invariants: true})` checks them
on every commit. `test/invariants-generator.test.mjs` runs random sequences
of acts, receives, reports and ticks over two and three holders and checks
every predicate after every step.

## Versions

This package uses its own semver; the specification uses castings.

| Area | Casting | Not in this package |
|---|---|---|
| identity | Identity 0.54 | recovery derivation (§5.3), service identities (§7) |
| encounter | Encounter 0.31, cards 0.25, credentials 0.26 | — |
| trust | Trust Layer 0.31 | — |
| membership | Membership Tasks 0.20, Access 0.57 | the Access envelope (Membership 3.3: `access-operation/0.1` with `member.add` and the sealed welcome; this library sends its own `x-membership-welcome/0.1`); the prelude's registered types (Membership 3.5: this library carries the same binding as `x-membership-prelude-*` and `x-membership-inviter@0.1`, and refuses an invitation without a binding); the invitation rate, the block and the register of declined invitations (3.1); roster replication: a holder knows the members it admitted and the roster its welcome carried |
| introduction | Trust 0.31 §8 | how a requester learns the mediator's designator (8.3): this library's mediator sends `x-introduction-offer/0.1` |
| delivery | Delivery 0.82 | transport adapters beyond `./adapters/vti-mediator`; `message/0.1` (Message Tasks 0.1), the block, `failed(rate-limited)`, `failed(task-expired)`, the lock keys of 6.2 |
| devices | Identity §5.5 | multi-device production: one writer per holder |

## The contract: the vectors

A version that does not reproduce `vectors/` byte for byte is not a valid
version. The conformance runner checks every cryptographic claim, and every
negative case fails at its declared stage. An implementation in another
language checks itself against the same vectors; it does not need this
package.

## License

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), specification and
reference implementation alike.
