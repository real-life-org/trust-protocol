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

**Custody and the lock** (Delivery 0.83, RLTP-DEL-6120 to 6135). The
holder keeps every outbound document until a service takes it or the
holder gives it up, across a lock and the end of a process; a transport
takes what it hands over from the holder, never from a store of its own.
One `createHolder` is one opening of the store:

```ts
await holder.resume(Date.now())                      // the opening's first resume comes first
const view = await holder.pendingTransport(Date.now())
if (view.ok) for (const entry of view.entries) {
  // entry: digest, kind ('document' | 'ack'), envelope, recipient,
  // since (first submission), notAfter (deadline), held?, nextAttemptAt?
  if (await holder.mayHandOver(entry, Date.now())) transport.send(entry)
}
// a lock or the end of the process: nothing issued before authorizes anything
holder.close()
```

`pendingTransport` answers `{ok: false, code: 'not-resumed'}` until a
resume of this opening has completed (a resume that throws withdraws it
again). It names every outbox document neither terminal nor accepted
(held ones included) and every unsent ack, none past its deadline.
`mayHandOver` says yes only for an entry this opening issued that is
still pending, unchanged and before its deadline; a document missing from
the view is not to be sent. After `close()` every call rejects with
`InfraError('closed')` and `mayHandOver` answers false; the next opening
is a new `createHolder` over the same store. An ack is sent once a
service took it (`accepted`/`delivered` report), the adapter reports it
failed, or its horizon passes; an `awaiting-transport` report records
that the adapter holds it and ends nothing (RLTP-DEL-6330), and it stays
retained with its effect for a duplicate (6335).
`./adapters/vti-mediator` reconciles from the view
(`reconcile(view, holder, now)`).

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
`vouchFor`, `introduce`, `sendMessage`, `block`, `unblock`, `rotateAnchor`,
`addDevice`, `revokeDevice`. Not
human: `receive`, `report`, `resume`, `tick`, `recover`, `takeMessages`.
Reads: `contacts`, `contact`, `groups`, `profile`, `prompts`, `inbox`,
`deliveryStatus`, `deviceKey`, `snapshot`, `subscribe`. Custody:
`pendingTransport`, `mayHandOver`, `close`, `closed`.

## What the root exports

- `createHolder` and its types (`Holder`, `HolderOptions`, `HumanActOptions`,
  `HolderSnapshot`).
- The ports: `Store`, `KeyProvider`, `Entropy`, `Log`, `Access`,
  `RetryPolicy`, `DeliveryReport`, `Outbound`; `seedKeys(seed)` is the
  default KeyProvider, `randomEntropy` the default Entropy.
- The views: `ContactView`, `GroupView`, `PromptView`, `ProfileView`,
  `InboxMessageView`, `DeliveryStatusView` and their parts.
- The results and events: `ActResult`, `ReceiveResult`, `ResumeResult`,
  `InfraError`, `CryptoUnavailableError`, `HolderEvent`.
- The state as an opaque type (`HolderState`), `decodeState`, `CODEC`,
  `StateCodecError`, and `storeContract`, the suite a Store adapter passes.
- The pure wire builders and verifiers of every layer (`core`, `crypto`,
  `identity`, `profile`, `encounter`, `membership`, `message` —
  `MESSAGE_TYPE`, `messageKeyOf`, `messageMac`, `messageProblem`,
  `messageShapeOk` and the constants of Message Tasks 0.1 —,
  `introduction`, `delivery`, `carrier-identity`, `carrier`,
  `carrier-holder`), and two
  namespaces of pure forms: `visibility` (anchor, star, group star,
  continuity, acks) and `ceremony` (the encounter's, the group's and the
  introduction's forms).

Other entry points:

| Entry point | What it holds |
|---|---|
| `./testing` | `InMemoryStore`, `memoryLog`, `scriptedEntropy`, `storeContract`, `emptyState`, `stateBuilder`, `freezeDeep`, `sampleState`, `openPromptModule`, the invariant checks, `forgeMapping` (deniability, Trust 6.1), `SCHEMAS` and the generated `wire` types. For tests, vectors and adapter authors; not for production holders. |
| `./internal` | The structural `HolderState`, `encodeState` and the codec chain, the engine's module types, the pure view functions, the modules' factories and pure reads. For the library's own modules and tests; not an app contract. |
| `./adapters/vti-mediator` | The VTI mediator as a carrier adapter: its submission states as `DeliveryReport`, collection and ack handling, the selective conclusion of a collection (`conclude(c, now, {keep})`, `concludable(result)`: a `failed(rate-limited)` item stays with the carrier). |

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
| `membership`, `membership/holder` | Membership Tasks 0.20 on Access 0.57 | founding (Access 3.4.1), the prelude (3.5: `membership-prelude-request/0.1`, `membership-prelude-reply/0.1`, the binding per relationship), invite, accept, admission within the bound of 3282 and welcome, evidence relay and `vouch@2` (Access 5.3), an in-library Access over the holder's groups |
| `message`, `message/holder` | Message Tasks 0.1 | `message@1`, `k_msg` and its MAC (3); sending on a ready, unblocked relationship with the sender lifetime (5); reception through the stages with the age and future bounds on the time mark, the completion record, the inbox taken over by the app, the rates and the inbox bound as `failed(rate-limited)` (4); the block of a relationship (6010–6030, 6510), its discard of messages and its treatment of invitations and prelude replies (Membership 3115, 3975), the holder's own offers refused (6410) |
| `introduction`, `introduction/holder` | Trust §8 on Delivery §4.4 | the Introduction Act in its three roles: request, forward, reply, the mediator's one ack at its declared delay, the vouchers; the requester's timeout at the act's expiry (8340; A20, spec follow-up 18: no ack timeout of 8690) |
| `receive`, `engine` | Delivery 0.83 §5, §6.1, §6.2 | the sealed envelope and the two key classes, stages 1–9 once per envelope with the dispositions `discarded` and the transient `failed(rate-limited)`, the task register by full task URI, the completed-effect cache with stored acks, the outbox with the status trias, retry by backoff, give-up at the horizon, custody before the trias and the hand-over gate (`pendingTransport`, `mayHandOver`, `close`), ack retries apart from ack retention, the act journal |
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
  fixtures (`test/fixtures/state-v1*.json`, written by lib 0.4.0 with
  `test/fixtures/gen-state-v1.mjs` and frozen since) cover a settled
  holder, one with work open (prompts, a joining invite, duties, a
  rotation at step 2) and one with a tombstone, a revoked device and
  carrier entries. They validate under codec 1 and migrate to codec 2.
- **Codec 2** is the format of 0.5.0: codec 1 with the state of Message
  Tasks 0.1 (`messages`: the block, the rates, the ready tuples, the
  completion record, the inbox), an outbox item's sender lifetime
  (`expiresAt`) and `failed(task-expired)`, and the record of surfaced
  and the register of declined invitations (`joining.surfaced`,
  `joining.declined`); an invitation may be attributed to no
  relationship. The migration from codec 1 is pure: no block, no rate, no
  record, no inbox, the ready tuples read from what the counterparts'
  documents left, every invitation received counted as surfaced. Its
  fixtures (`test/fixtures/state-v2*.json`, deterministic runs of
  `test/fixtures/gen-state-v2.mjs` under lib 0.5.0) add
  messages to the settled holder and a block and a declined invitation to
  the open one; each decodes and re-encodes byte for byte. A later codec brings its validator, a pure
  migration from the one before, and its own fixture with a migration
  test. Frozen since 0.6.0 beside `test/fixtures/state-v2-acks.json`
  (written by lib 0.5.0 with `test/fixtures/gen-state-v2-acks.mjs`: its
  stored acks in every form codec 2 knows); they validate under codec 2
  and migrate to codec 3.
- **Codec 3** is the format of 0.6.0 (Delivery 0.83): a stored ack is
  `sent` exactly when it says why (`sentBy`: `accepted`, `failed`,
  `horizon`) and may be `held` by the adapter while unsent. Codec 2 marked
  an ack sent on any report (`sentBy: 'report'`), an `awaiting-transport`
  report included, so a stored state does not tell an ack a service took
  from one an adapter only held: the migration makes every such ack
  unsent again, due at once. The next resume offers it until a service
  takes it or its horizon passes; one a service did take arrives twice at
  its receiver, which absorbs the duplicate (a terminal document, nothing
  re-sent). Its fixtures (`test/fixtures/state-v3*.json`, deterministic
  runs of `test/fixtures/gen-state-v3.mjs`, reproduced in `npm test`) add
  a holder with acks held, accepted, failed and unsent and an own
  document held.
- A newer codec is refused as `codec-newer`, a codec without a validator
  as `codec-unknown`; nothing is read best-effort.
- `schemas/holder-state-v1.schema.json`,
  `schemas/holder-state-v2.schema.json` and
  `schemas/holder-state-v3.schema.json` describe the codecs as
  non-normative JSON Schemas (published with the package). The types
  `HolderStateV1`, `HolderStateV2` and `HolderStateV3` (`./internal`) are generated from
  them (`scripts/build-holder-state-types.mjs`); the build holds the
  current one against the library's `HolderState`, and the tests hold each
  schema against its codec's validator on the fixtures and on mutations
  of them. Rules only the codec states: a record's id equals its key, an
  envelope's `rkid` equals its recipient's `keyAgreement`, and (codec 2) a
  set of strings is sorted.

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
| membership | Membership Tasks 0.20, Access 0.57 | the Access envelope (Membership 3.3: `access-operation/0.1` with `member.add` and the sealed welcome; this library sends its own `x-membership-welcome/0.1`); an admission prompt after the bound of RLTP-MT-3282; roster replication: a holder knows the members it admitted and the roster its welcome carried |
| introduction | Trust 0.31 §8 | how a requester learns the mediator's designator (8.3): this library's mediator sends `x-introduction-offer/0.1` |
| delivery | Delivery 0.83 | transport adapters beyond `./adapters/vti-mediator`; the block of the Trust Layer's types (Message Tasks 6240: their treatments wait for the next casting of the Trust Layer) |
| message | Message Tasks 0.1 | holding a message unsent until its tuple is ready (5020): `sendMessage` answers `not-ready` and the app keeps the message; checking `replyTo` against the relationship's history (5120), which is the app's; multi-device (§9); `failed(task-expired)` for a message: reachable only with a retry horizon beyond P179D, which the engine does not admit (at most P90D), so an undelivered message ends as `failed(expired-by-adapter-policy)` |
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
