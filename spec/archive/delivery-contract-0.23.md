# RLTP Delivery Contract

**Real Life Trust Protocol — service contract: Delivery**

- **Status:** Editor's Draft
- **Version:** 0.23.0-draft (twenty-third casting — the **carrier
  cut**, jointly with Identity 0.14 and against
  `design/traeger-beziehungsidentitaet-zerlegung-2026-08.md`
  (decisions E1–E9): the new Section 5a makes the addressing
  **triple** normative — `rkid` per relationship · queue locator
  below the port line · **control principal** per (relationship ×
  carrier), Identity §7a — decides that submission stays
  principal-free, separates the storage-entry role from the
  delivery-pickup role as a MUST, states pickup discipline as a
  SHOULD with its residual, and adds two mandatory declaration
  slots to the 4.4 registry (admission resource, orphan horizon).
  §10's empty A7 promise is redeemed. **No wire byte changes**)
- **Editors:** Anton Tranelis
- **Date:** 2026-08-27
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Task-type namespace:** `https://real-life.org/trust-tasks/`
- **Target Trust Tasks framework version:** 0.4
- **Conformance profile:** `rltp-delivery@0.23` (draft)
- **Position:** not a layer. Delivery is the service behind the port
  the Encounter Layer requires; every layer may use it, none depends
  on its internals.

## Abstract

This document specifies how RLTP documents travel between people. The
delivery service moves **signed, anchor-encrypted, typed documents**
from one person to another — eventually, at least once, never silently
lost — and tells both sides honestly what it knows: the sender its
transport state, the receiver nothing the content does not prove
itself, and the sender **never** what the receiver decided.

Messages are **Trust Task documents** of private, versioned types under
`https://real-life.org/trust-tasks/` (ToIP DTGWG Trust Tasks framework
0.4, §6.5 private specifications). This casting registers four types
of its own — `encounter-bundle`, `delivery-ack`,
`encounter-credential-delivery`, `registry-declaration` — the RLTP
document profile all types
share, the sealed envelope they travel in, and the **task registry**
(4.4) through which companion layers register theirs: the membership
and access types (registered in their own documents), the
introduction and continuity types of the network-visibility layer,
and the member-mapping disclosure of the access layer.

Addressing is a **triple**, never an account (Section 5a): the
`rkid` a sender seals to, one per relationship; a queue locator
that is the carrier's own business and appears in no rule of this
contract; and a **control principal**, derived per (relationship ×
carrier) by Identity §7a, under which a recipient registers
addresses and collects what arrives. Submission needs no sender
identity, and abuse is answered with resources rather than
accounts. The point is a modest one, stated plainly: a carrier of a
relationship knows that relationship — but relationships must not
converge into a person at whoever carries them.

## Status of This Document

This is an **Editor's Draft** with no standing beyond its own
argument. It is developed together with the Encounter Layer through
an adversarial convergence process — each casting is reviewed in full
by an independent adversarial reviewer and recast, never patched. The
seventeenth casting's review round returned no findings and the pair
was judged blocker-free and compatibly implementable.

The eighteenth and nineteenth castings carried this document
through the **M-DID loop**: the Encounter re-pin to the
fresh-always wire, and the **task registry** of 4.4 as an
implementable contract — registry-entry form, published
operational constants, and the `registry-declaration/0.1` type
that carries them per party. The twenty-second casting took two
cuts from the replication joint loop: the service-identity `rkid`
clause was withdrawn, and the registry gained its direct-effect
prohibition.

This twenty-third casting is the **carrier cut**, cast jointly
with **Identity 0.14** against the decomposition
`design/traeger-beziehungsidentitaet-zerlegung-2026-08.md`
(editor's decisions E1–E9, 27.08.2026). Its subject is not what a
carrier reads — a carrier is key-blind and always was — but **under
which identity one faces it**, and what it can therefore add up
about who corresponds with whom, how often. Three things were true
before this casting and are now said: the recipient address is
already per relationship and stays so; submission carries no
sender identity at all; and §10 promised a bound ("derived service
identities bound what a transport learns") that Identity §7 never
defined for a delivery relationship. Section 5a redeems the
promise with the addressing triple, decides the principal-free
submission, and adds the two prohibitions the decomposition found
to be load-bearing: the role separation between storage entry and
delivery pickup, and the discipline of not bundling principals
into one collection session. What remains correlatable is stated
in §10 rather than implied away. Known open questions are
collected in Section 12; this casting begins a fresh joint
convergence loop with Identity. Feedback is welcome via the issues
of the publication repository
(github.com/real-life-org/rltp-spec).

## 1. Introduction (informative)

### 1.1 Essence and principles

- **Eventually, at least once, never silently lost.** Delivery time is
  unbounded and never affects validity (Encounter 1.3). At-least-once
  makes duplicates and lost acknowledgements the *normal case*, so
  idempotency is law, not precaution. A document the service accepted
  is delivered or reported failed; silent loss is non-conformant.
- **Documents and promises, never pipes.** No normative statement
  mentions a relay, a broker, a socket, or a wire. Transport-internal
  signals never appear here.
- **Authenticity always has exactly one carrier.** Where a document's
  payload contains material signed under the Layer-1 binding rule
  (credentials, cards), that material is the carrier and the document
  needs no proof. Where it does not — the acknowledgement — the
  document itself carries a proof. Nothing is trusted because a
  channel said so.
- **The acknowledgement is arrival, and arrival only.** It is
  machine-generated at the durable recording of a document's defined
  effect, waits on no human, and carries no statement about any
  decision. The mutual-recognition moment of an encounter is carried
  by the counter-credential itself, not by any receipt.

### 1.2 The user experience this serves (informative)

After A scans and confirms, A's app shows a waiting state; the arrival
acknowledgement dissolves it ("nothing more to do on your side"), and
its absence within `ack-wait` flips A's screen to the optical
presentation of the sent card — the same enactment on another
carrier. When B's counter-credential later arrives, A sees the
relation confirmed; B's own view becomes mutual only when A's
credential reaches B (Encounter 4.2 — every view is local). Section 8
gives both state machines; a lost acknowledgement after B's commit
reconciles through redelivery and `duplicate-known`, never through a
second enactment (6.3).

## 2. Conventions and Terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" are to be interpreted as described in BCP 14 [RFC2119]
[RFC8174] when, and only when, they appear in all capitals.

The **interim securing profile** of Encounter 2.3 applies (did:key
anchors, Ed25519/X25519 as Multikeys with decoded multicodec
verification, `eddsa-jcs-2022` embedded proofs, JCS, SHA-256,
multibase, RFC3339-UTC-`Z` timestamps).

**Document** — a Trust Task document conforming to the RLTP document
profile (Section 3). **Document digest** — the multibase-encoded
multihash (Encounter 2.3: emit `u`, accept `u`/`z`, SHA-256) over
`JCS(document)` of the plaintext document; the document's identity for
idempotency and acknowledgement reference, and format-identical to
DTGWG `digestMultibase` values. **Sealed
envelope** — the encrypted form in which a document travels
(Section 5). **Disposition** — the receiver's classification of a
processed envelope (Section 6).

**Carrier** — a party that holds delivery queues on behalf of
recipients: the adapter side of this contract, below the port
line, key-blind by construction (Section 5a). **Control
principal** — the carrier-relationship identity of Identity §7a,
the identity a recipient presents to one carrier for one
relationship. **Queue locator** — a carrier-local, opaque handle
for one queue (5a.1).

*Disambiguation, because the word does double duty in ordinary
English:* where 1.1 says authenticity "has exactly one carrier",
and where 1.2 and 6.3 speak of the **carrier switch** to the
optical leg (Encounter 5.8), the word means "that which carries"
and names no party. The role defined here is always the party of
Section 5a, and every normative sentence about it points there.

| Term | Fragment |
|---|---|
| Document digest | `#DocumentDigest` |
| Sealed envelope | `#SealedEnvelope` |
| Disposition | `#Disposition` |
| Delivery acknowledgement | `#DeliveryAck` |
| Carrier | `#Carrier` |
| Control principal | `#ControlPrincipal` |
| Queue locator | `#QueueLocator` |

## 3. The RLTP Document Profile

RLTP delivery documents are Trust Task documents [TT], target framework
version **0.4**, under the private task-type rules of TT §6.5. The
profile — normative wire form
`schemas/rltp-delivery-document.schema.json` — requires:

- `id` — REQUIRED; UUID v4.
- `type` — REQUIRED; a registered RLTP task type
  (`https://real-life.org/trust-tasks/<slug>/<MAJOR.MINOR>`). Slugs
  never match `^trust-task(-|/)?` (TT §6.1).
- `issuer`, `recipient` — REQUIRED, in-band, as anchors. A consumer
  MUST reject a document whose `recipient` is not its own anchor
  (TT §7.2 rule 5 — the receiver principle at the envelope level).
- `threadId` — REQUIRED: fresh (UUID v4) on thread-opening documents,
  equal to the answered document's `threadId` on responses.
- `ceremony` — OPTIONAL, and **entirely unconstrained by the task
  specifications**, per TT §4.11.1: a task specification declares
  nothing about ceremonies, absence is never grounds for rejection,
  and every framework-defined member (`enactment`, `step`, `round`,
  `terminal`, `prev`, …) passes through unrejected. One RLTP
  *profile-level* rule applies to consumers of this contract: **where
  the member is present and carries an `enactment`, that value MUST
  recompute** against the enclosed material or the document is
  `failed(validation-failed)`; a member that grants nothing can still
  not be allowed to lie. It grants no authority (TT §7.2 rule 9); the
  authoritative enactment binding always lives in the enclosed
  credential itself.
- `issuedAt` — REQUIRED.
- `expiresAt` — MUST be absent. Delivery time is unbounded; validity
  windows live in payloads and ceremonies, with issuance semantics.
- `proof` — REQUIRED on `delivery-ack` and on
  `registry-declaration` (4.4) — the two types whose authenticity
  has no other carrier (1.1); MUST be absent on the other types of
  this casting, whose authenticity is carried by the signed
  payloads inside. Where `proof` is present, TT §4.8.2 audience binding is
  satisfied by the in-band `recipient`.
- `payload` — REQUIRED; governed by the type's **payload schema**.
  For the types this document registers itself, the schema's `$id`
  is the Type URI (TT §6.3); companion-registered types dispatch
  through their registry entry (4.4), whose schema reference is
  authoritative — one dispatch rule, stated once. Payload schemas describe only
  the payload; the outer members are validated by the document-profile
  schema.

**Offline schema rule:** implementations MUST pre-register every
schema of this contract by its `$id` and MUST NOT resolve any `$ref`
over the network. The shipped `schemas/` directory is the complete
closure; a validator that cannot resolve a reference from its local
registry treats the document as `malformed`.

Unknown `type` → the document MUST be rejected with disposition
`failed(unknown-type)`; a document that would have an effect is never
silently ignored.

## 4. Registered Task Types

Each type below is a private Trust Task specification with: Type URI,
target framework 0.4, payload schema (shipped), proof declaration (per
Section 3), and the consistency rules stated here.

### 4.1 `encounter-bundle/0.1`

The transmission of the one-scan ceremony (Encounter 5.8): the
scanner's sent card and step credential.

- `payload`: `{ "card", "credential" }` per
  `schemas/payload-encounter-bundle.schema.json`.
- `threadId`: fresh (opens the exchange). `proof`: absent.
- **Declarations (TT §7.3):** side effects: *mutating* (creates the
  enactment record); exposure: recipient-only, never retained by
  third parties.
- **Outer/inner consistency (MUST, before any effect):**
  `issuer` = `card.anchor` = `credential.issuer`;
  `recipient` = `credential.credentialSubject.id`;
  the card carries a sent-challenge with `sentTo` = `recipient` and
  `boundTo` = `credential.credentialSubject.challenge`
  (Encounter 6); a present `ceremony.enactment` equals
  `credential.credentialSubject.enactmentBinding`. Under
  fresh-always enactment (Encounter §4.4) every anchor of these
  equalities is a **fresh pair anchor** of the enacting parties;
  the checks are anchor-class-neutral and stand unchanged.
- **Pre-lock validation (MUST, in order — validate, then consume:
  read-only against local state **except for Encounter 5.3's aging
  latch, which every resolution writes**, and consuming nothing;
  together with the authoritative in-lock resolution this implements
  the acceptance set of Encounter 5.6):**
  1. document profile + payload schema valid; timestamps
     calendar-valid; keys decode to correct multicodec + length;
  2. card proof verifies under `card.anchor`;
  3. credential proof verifies under its issuer anchor;
  4. `credential.credentialSubject.id` = the local anchor;
  5. the credential's bound challenge **resolves** (Encounter 5.3;
     the resolution itself latches any held aged value it observes —
     the latch is monotone and lock-free, so this provisional
     observation already stands) to `open` or `recorded` — an
     `unknown` resolution ends the pre-lock checks, but is **never
     final pre-lock**: the evaluation skips the remaining checks and
     proceeds directly to the serialization point (6.2 stage 9),
     where the authoritative resolution decides. If it is still
     `unknown`, the disposition is `failed(validation-failed)` — the
     one state-free outcome that covers garbage, foreign,
     rotated-away, and record-gone bundles alike, always produced
     under the lock. If it is **any other state** (the state moved —
     e.g. the optical record arrived between pre-lock and lock), the
     evaluation MUST NOT proceed on the skipped checks: it releases
     the lock and **re-enters at stage 4** (the waiter rule of 6.2),
     completing every check under the new state before any effect;
     **`credentialSubject.ceremony` equals this
     ceremony (`encounter-scan@0.25`)** — a credential labelled
     with any other ceremony is `failed(validation-failed)`, so the
     record's ceremony is grounded rather than copied from the
     sender's label; and the enactment binding recomputes per
     Encounter 5.4 from {the resolved own challenge, card's
     sent-challenge};
  6. **the issuance window (Encounter 5.6 step 6):** `validFrom` and
     `proof.created` inside the closed interval anchored at `t_ch`
     from the resolution — held with an `open` value by its owner,
     held in the record for a `recorded` one (Encounter 5.5/5.3) —
     and `proof.created ≥ validFrom − skew-tolerance`.

  This pre-lock resolution is **provisional**; the resolution
  repeated inside the critical section is authoritative and alone
  selects the effect.
  Only after 1–6 pass does evaluation reach the final stage (6.2
  stage 9), whose critical section is keyed for bundles on **both**
  the document digest and the credential's bound challenge — the
  **record key**, the same serialization point the optical input of
  Encounter 5.8 passes through. Inside that section, and only there,
  the bound challenge is **re-resolved authoritatively** (Encounter
  5.3), and the resolution selects the effect:

  **`open` → record-creating effect:** the explicit future check
  (Encounter 5.5) — an own challenge future-dated beyond
  `skew-tolerance` is `failed(gate-future)`; the expiry side is
  structural (an aged value never resolves `open`), so no
  `gate-expired` disposition exists — then the effect committed **as
  one durable transaction**: the enactment record, **the accepted
  credential itself with its direction and credential digest** (the
  state Encounter 4.2 needs to hold `received` across restarts), the
  completed-effect cache entry, **and the acknowledgement document
  itself, retained with the cache entry** (4.2). After commit the
  credential **is accepted**; no later check can fail it.

  **`recorded` → the record decides:** a record whose counterparty is
  **not** the document issuer means the challenge was consumed by a
  different enactment — `failed(consumed-challenge)`, the only way
  this disposition arises, and it is stable under waiter re-entry:
  the record survives, so re-resolution yields `recorded` again and
  the same disposition. Otherwise (the offline path completed first,
  Encounter 5.8) the enclosed card MUST be **JCS-identical to the
  counterparty card stored in that record** — a bundle combining a
  valid credential with any other card, however well signed, is
  `failed(validation-failed)`. The binding is verified against the
  record, and the credential MUST pass Encounter acceptance (5.6) in
  full, including uniqueness; `ERR_STALE_ISSUANCE` maps to
  `failed(stale-issuance)`, every other rejection to
  `failed(validation-failed)`, and nothing is consumed. On pass, the
  **record-aware effect** committed as one durable transaction: the
  accepted credential with direction and credential digest, the
  completed-effect cache entry, and the retained acknowledgement —
  **no gate, no record creation, no consumed-challenge conflict**.

  **`unknown` → `failed(validation-failed)`:** nothing exists to
  consume; a provisional pre-lock pass only means the state moved.

  Any failure before a committed effect consumes nothing and earns no
  acknowledgement (the poisoning rule). Documents with **distinct
  digests** competing for one challenge serialize on the record key:
  exactly one commits first; each later evaluation re-selects its
  branch against the new state — an identical enclosed credential
  (equal credential digest) lands idempotently via Encounter 5.6
  step 8 with its own effect and acknowledgement; a conflicting
  credential **from the record's counterparty** (it passed the
  counterparty check) is `failed(validation-failed)`; a foreign
  counterparty is always `failed(consumed-challenge)` (above) —
  never a second record.

### 4.2 `delivery-ack/0.1`

The arrival acknowledgement (DO-1).

- `payload`: `{ "ref": <document digest of the acknowledged document>,
  "meaning": "received" }` per
  `schemas/payload-delivery-ack.schema.json`.
- **Declarations (TT §7.3):** side effects: sender status update only;
  exposure: retained only by the acknowledged document's sender.
- `threadId`: = the acknowledged document's `threadId`.
- `proof`: **REQUIRED** — `eddsa-jcs-2022` under the ack's `issuer`
  anchor. An unsigned or foreign-signed acknowledgement is invalid.
- **Consistency (MUST, on receipt):** proof verifies under `issuer`;
  `issuer` = the acknowledged document's `recipient`; `recipient` =
  the acknowledged document's `issuer`; `threadId` matches; `ref`
  matches a document this sender actually sent on that thread. Any
  failure → the ack is discarded (`failed(validation-failed)`) and the
  sender's status is unchanged.
- Generation: **automatic at the durable recording of the referenced
  document's defined effect** (4.1: the committed bundle effect,
  record-creating or record-aware; 4.3: durable buffering). It MUST NOT wait for, depend on, or reveal any
  human decision, and MUST NOT be sent for a document rejected at
  document level. **The acknowledgement document is created inside
  the effect's transaction and retained together with the
  completed-effect cache entry it belongs to** — both persist at
  least `key-retention` after commit (Section 7), the bound that
  outlives every adapter's give-up horizon and therefore every live
  redelivery. Within that bound, redelivery of a `duplicate-known`
  document MUST re-send exactly this stored document, byte-identical
  — never a newly generated one. After the bound, entry and stored
  acknowledgement MAY be discarded together; a document redelivered
  later is re-evaluated as fresh, and byte-identity binds only within
  the retention bound. The re-evaluation is harmless in both possible
  states: a bundle whose enactment record still exists (records live
  for the life of the relation, Encounter 5.5) lands in the
  **record-aware effect** and is accepted idempotently (equal
  credential digest, Encounter 5.6 step 8), earning a **freshly
  generated** acknowledgement; a bundle whose record is gone fails
  **by derivation from the state model**: with the record deleted,
  the bound challenge resolves `unknown` (Encounter 5.3 — no
  challenge history exists beyond open values and records), so
  check 5 of 4.1 fails — `failed(validation-failed)` — and no gate
  is ever reached or needed. Its sender has long reported
  `failed` either way, and a late acknowledgement only transitions
  that status honestly (6.1).
- Meaning, normatively and honestly bounded: *the recipient's anchor
  **attests** that the document reached its authenticated device and
  that its defined effect is durably recorded.* It is an attestation,
  not a proof of causal receipt — a recipient who signs falsely harms
  only their own state, and the sender's `delivered` is exactly as
  strong as that attestation. Implementations MUST NOT present it as
  acceptance, verification beyond the recording gate, or any human
  act (Encounter 7.4). `meaning` is a closed one-value set in this
  version.
- **Terminal.** The acknowledgement is a **terminal document**: its
  defined effect (the sender-status update, idempotent by
  construction) earns a completed-effect cache entry like any other,
  retained at least `key-retention` after commit — the same bound as
  every cache entry — but it generates **no acknowledgement of its
  own**: there is no acknowledgement of an acknowledgement, and the
  chain ends here by rule, not by accident. A stage-4 duplicate of a
  terminal document is `duplicate-known` with **nothing to re-send**
  (6.2).

### 4.3 `encounter-credential-delivery/0.1`

Post-enactment delivery of a step credential: the counter-step of
`encounter-scan` (`"counter"`), or a standalone credential delivery
outside any bundle thread (`"deliver"`).

- `payload`: `{ "credential" }` per
  `schemas/payload-encounter-credential-delivery.schema.json`.
- **Declarations (TT §7.3):** side effects: buffering only; exposure:
  recipient-only.
- `threadId`: fresh for standalone deliveries (`ceremony.step` =
  `"deliver"` when the member is used); = the bundle's `threadId` for
  a one-scan counter-step (`"counter"`). `proof`: absent.
- **Outer/inner consistency (MUST, before any effect):**
  `issuer` = `credential.issuer`; `recipient` =
  `credential.credentialSubject.id`; if `ceremony` is present, its
  `enactment` = `credential.credentialSubject.enactmentBinding`.
  A document violating these is `failed(validation-failed)` and
  produces no acknowledgement — an acknowledgement never goes to a
  party other than the credential's own issuer.
- **Defined effect:** durable buffering of the enclosed credential for
  Encounter acceptance. The acknowledgement is sent at buffering;
  Encounter acceptance (5.6) runs separately, never acknowledges, and
  its outcome is never signaled to the issuer (Encounter 7.4).

### 4.4 The task registry — companion-registered types

Every type under the task-type namespace shares the document
profile (Section 3), the sealed envelope (Section 5), and the
disposition and acknowledgement rules (Section 6). Beyond the
four types this document registers itself, the registry's
members are registered **where their semantics live**, each as a
private Trust Task specification naming its type URI, payload
schema, proof declaration, and consistency rules:

- `membership-invite/0.2` · `membership-accept/0.2` ·
  `access-operation/0.1` · `membership-evidence/0.1` — Membership
  Tasks §3;
- `key-delivery/0.1` · `removal-notice/0.1` — Access §10;
- `introduction-request/0.1` · `introduction-forward/0.1` ·
  `introduction-reply/0.1` · `introduction-ack/0.1` ·
  `introduction-voucher/0.1` — Network Visibility §8.1; payload
  schemas `schemas/visibility-payload-introduction-request.schema.json`,
  `…-forward…`, `…-reply…`, `…-ack…`, `…-voucher….schema.json`;
  proofs per Visibility §2.1 (the artifacts carry their own MACs
  and signatures; the documents carry none — one carrier);
- `continuity-probe/0.1` · `continuity-mapping/0.1` — Network
  Visibility §6a.2/§6a.4; the payload is the artifact itself
  (`schemas/visibility-continuity-probe.schema.json`,
  `schemas/visibility-continuity-mapping.schema.json`), travelling
  on the enactment tuple's own channel (its §6a.3);
- `member-mapping/0.1` — Access §5.5; payload
  `schemas/member-mapping.schema.json`, travelling on the existing
  relationship channel between discloser and addressee, never a
  group space.

**The registry-entry form (normative):** a registry is a set of
entries, one per type, each carrying exactly: the **type URI**
(under the task-type namespace) · the **payload schema
reference** (the shipped schema file the receiver validates
against — dispatch resolves through the entry, so a companion
schema needs no `$id` equal to the type URI; §3's `$id` rule
binds the types this document registers itself) · the **proof
declaration** (proof present/absent and its carrier, per the
registering specification) · and optionally **operational
constants** of the role (below). A type absent from a receiver's
registry is `unknown-type` (6.2), exactly as for this document's
own types; registration creates no authority anywhere — every
type's effects are governed by its own specification, **under one
global rule no registration can waive: a registered type's
defined effect MUST NOT write replicated state directly. Where an
effect touches replicated state, it does so exclusively by
handing full entries with their closure to the Replication
Contract's ingest admission (Replication §7, I14) — the admission
verdict, not the delivery disposition, decides any replicated
effect.** A registry entry whose specification defines a direct
replicated write is not registrable.

**Operational constants and `registry-declaration/0.1`
(normative):** a party serving a role whose specification names a
published constant declares it **per party** — fixed,
non-adaptive — and its counterparts MUST hold it before they
depend on it. The carrier is this contract's own task type
`registry-declaration/0.1`: `payload`
`{ "declaration": { "role": <type URI of the served role>,
"revision": <int-string, ≥ 1>,
"constants": { <name>: <value string> } } }`
per `schemas/payload-registry-declaration.schema.json`;
`threadId` fresh; `proof` **REQUIRED**, verifying under the
document `issuer` (the declaring party — §3's proof rule names
this type). Defined effect: durable recording per (issuer,
role) under the **generic revision rule** (the pattern of
Visibility §6.4): a higher `revision` wins; an equal revision
with JCS-identical payload is idempotent; an equal revision with
a different payload is an equivocation error — reject, keep
state; a lower revision is rejected — so a delayed or redelivered
older declaration can never roll a value back. A replacement is
prospective, never retroactive for a running act. **Roles and
their constants are named by the registering specification**: the
role URI is the type URI of the task the party serves as
receiver — for the introduction mediator,
`https://real-life.org/trust-tasks/introduction-request/0.1` —
and the registering specification closes which constant names a
role admits and their domains; unknown constant names or
out-of-domain values reject the declaration. The first
registration: `ack-delay`, an RFC 3339/ISO-8601 duration,
`PT1S ≤ ack-delay ≤ PT1H` (Visibility §8.4). **This declaration IS
the "task registration entry" Visibility §8.4 publishes from** —
that entry's per-party published form; one mechanism, two names.
**Act binding and revision skew, stated honestly:** each side of a
running act computes from the declaration it holds — the mediator
from its own current value at the act's arrival, the requester
from the highest revision it holds at send. A revision landing
between the two is safe by construction: the requester's early
`failed` is Visibility §8.4's named role divergence, converged by
the retry as a new act; a mediator that raises its `ack-delay`
SHOULD expect such retries until the new declaration reaches its
contacts. **A party MUST declare identical constants to all
counterparts** ("per party, fixed"); the declaration is
transferably signed for exactly this reason — two counterparts
comparing declarations hold attributable proof of an
equivocation. The first registered constant is the introduction
mediator's `ack-delay` (Visibility §8.4): a requester computes
its verdict window from the mediator's declared value and MUST
NOT send an `introduction-request` to a mediator whose
declaration it does not hold — asking first is the flow, not an
error path.

**The carrier role and its two mandatory slots (normative).** A
**carrier** (Section 5a) serves no task type — it is below the
port line and is nobody's document counterparty — but it does run
a role with published constants, and those constants belong in
this registry for the same reason every other constant does: a
counterpart must be able to check a declaration against a
**domain** it did not invent. The carrier role is therefore
registered here under the role URI
`https://real-life.org/trust-tasks/delivery-carrier/0.1`. **This
slug is a role identifier, not a task type:** it registers no
payload schema, is never a document `type`, and a document
carrying it as `type` is `failed(unknown-type)` like any unknown
slug. Two constants are **REQUIRED** of every carrier — a carrier
that declares neither, or only one, is nonconformant, and a
principal MUST hold both before it registers anything (5a.3,
5a.6):

- **`admission-resource`** — what the carrier spends to admit
  submissions and registrations. Closed domain: `none` · `size` ·
  `rate` · `work` · `payment`. Whatever the token, the metering
  scope is fixed by this contract and not by the carrier: it MUST
  be **per principal or per submission, never per person**. A
  carrier MUST NOT operate an account, an invitation, a device
  certificate, a device attestation, or any counter or quota that
  spans two principals — the precedent is Access §7.3, whose
  `divergenceQuota` is group-scoped for the same reason. `none` is
  a **declared** residual and a conformant value: a carrier that
  gates nothing says so, and the honest reading of §9's
  "adapters are untrusted" is that submission defence is
  resource-shaped, never identity-shaped. `payment` is admissible
  **only** where the instrument is itself per principal and
  carries no identifier common to two of them; a payment
  instrument that identifies the paying person across principals
  is a person-wide counter under another name and is nonconformant.
- **`orphan-horizon`** — an RFC 3339 / ISO 8601 duration,
  `P7D ≤ orphan-horizon ≤ P365D`, after which the carrier MAY
  discard a principal's registration together with anything queued
  under it, measured from the last successful collection under
  that principal, or from its registration if it never collected.
  It exists because principals **do** go orphaned — a lost register
  is unrecoverable for carrier nonces (Identity §9.3), and the
  relationship then re-registers under fresh principals — and
  without a published horizon the carrier's inbox surface grows
  monotonically, which is the class of the 1148-pending stall the
  field record carries. Expiry is a **storage decision of the
  carrier**, never a verdict about a party, and it is reported to
  nobody: a sender learns only what §6.1 already gives it.

**How a principal holds these, honestly:** the mediator case
travels as a `registry-declaration/0.1` over an existing
relationship channel, because a mediator *is* a document
counterparty. A carrier is not, so its declaration reaches a
principal through the carrier's own registration interface, which
is **below the port line and deliberately unspecified here**. What
this registry fixes is what the declaration must contain and which
values are admissible; where it fixes nothing, it says so rather
than pretending the carrier is a party it is not. A carrier MAY
additionally publish its declaration as a signed
`registry-declaration/0.1` where it happens to hold a relationship
channel; nothing in this contract requires it to.

## 5. The Sealed Envelope

A document travels sealed to its recipient:

```
seal = { "rkid":       <recipient key-agreement key, Multikey z6LS…>,
         "epk":        <ephemeral X25519 public key, base64url, 32 bytes>,
         "nonce":      <96-bit nonce, base64url>,
         "ciphertext": <AES-256-GCM ciphertext || 128-bit tag, base64url> }
```

Normative construction, exactly one way:

- **Plaintext** is the JCS canonicalization of the document (UTF-8),
  at most **65 536 bytes**; larger documents are non-conformant and
  oversize envelopes MUST be rejected without decryption
  (`failed(oversize)`).
- **Ephemeral key:** a fresh X25519 key pair MUST be generated per
  envelope from a CSPRNG and MUST NOT be reused. **Nonce:** 96 bits
  from a CSPRNG per envelope.
- **Shared secret:** X25519(ephemeral private, recipient public),
  where the recipient public key is the one identified by `rkid` —
  the key-agreement Multikey from the recipient's card. (A derived
  service identity is **not** admissible here: Identity §7 defines
  it Ed25519-only, and no sealing-to-service exists in the 0.x
  stack; a future service-seal capability needs its own X25519
  key, binding artifact, and flow.) An all-zero shared secret MUST be
  rejected on both sides.
- **Key derivation:** AES-256 key = HKDF-SHA-256(ikm = shared secret,
  salt = empty, info = ASCII `rltp/v1/seal`), 32 bytes.
- **Encryption:** AES-256-GCM, 128-bit tag, **AAD = empty (exactly
  zero bytes; nothing is authenticated outside the ciphertext by
  design — all binding lives inside the document)**. Ciphertext of a
  zero-length plaintext is invalid.
- **The document digest is computed over the plaintext, never the
  ciphertext** — re-sealing on retry changes `epk`, `nonce` and
  `ciphertext`, never the document's identity.
- **Key retention (bounded by the delivery horizon):** recipients
  MUST retain every key-agreement private key that ever appeared in a
  displayed or sent card, addressable by `rkid`, for at least
  `key-retention` (Section 7) after the key last appeared in any
  card — **including keys displayed before any relation or record
  existed**, because a scanner may hold the card before the recipient
  knows them. `key-retention` MUST be at least the longest give-up
  horizon any adapter in the deployment declares (6.1), so a key can
  never retire while a delivery sealed to it is still live; adapters
  therefore declare their horizon. **A retired identifier remains
  known indefinitely as a tombstone** — the `rkid` value alone, its
  private key destroyed; tombstones are a few bytes per card ever
  issued, and they keep the disposition honest: stage 2's "known"
  includes tombstones (6.2), so an envelope sealed to a retired key
  reaches decryption and fails as `failed(decryption-failed)` —
  never `malformed`, which is reserved for identifiers this party
  never issued.

A **shipped test vector** (`vectors/seal.json`) fixes recipient key,
ephemeral key, nonce, plaintext, ciphertext, and document digest;
implementations MUST reproduce it byte-for-byte. The vector's
plaintext document is a **seal-only sample** (type
`…/seal-vector-sample/0.1`, never a wire type): it exercises this
section's construction, not the document profile, and MUST NOT be
processed as a delivery document.

No channel authentication is required or assumed: confidentiality
comes from the seal, authenticity from proofs and signed payloads
bound to anchors by the Layer-1 binding rule. This is a decision,
not an omission, and 5a.3 states it as one.

## 5a. Addressing, registration, and collection

A **carrier** holds queues for other people. It never reads a
document — the seal of Section 5 sees to that, and no rule of this
contract asks a carrier to be trusted with content. What it does
see is who registers which addresses and who comes to collect
them, and that is a social fact even when every byte is opaque.

This section fixes the identities involved. Its aim is bounded and
worth stating before the rules, so that nobody reads more into
them: **it is not a goal to hide from a carrier the relationship
it carries.** The carrier of a relationship knows the
relationship. The goal is that a person's relationships **do not
converge into a person** at whoever carries them — that a carrier
holding six of someone's relationships holds six relationships,
not a directory of one life.

### 5a.1 The addressing triple (normative)

Addressing is three identifiers with three different owners, and
conflating any two of them is where the previous generation went
wrong:

| Identifier | Owned by | Seen by | Governed in |
|---|---|---|---|
| `rkid` | the recipient | sender and carrier | Section 5, 5a.2 |
| queue locator | the carrier | the carrier, and whoever it hands it to | 5a.1 (below the port line) |
| **control principal** | the recipient | the carrier | Identity §7a, 5a.3–5a.6 |

- The **`rkid`** is the end-to-end address: the recipient's
  key-agreement Multikey, the only thing a sender needs, and the
  only one of the three a sender ever sees. Senders MUST use it and
  MUST NOT be required to know anything else about the carrier
  arrangement of the recipient.
- The **queue locator** is a carrier-local, opaque handle for one
  queue. It is **below the port line**: no rule of this contract
  constrains its form, lifetime, or allocation, and no document
  field carries it. It is named here only so that it is not
  silently fused with either of the other two — a locator that is
  the `rkid`, or that is the principal, is not a third identifier
  but a leak.
- The **control principal** is the identity a recipient presents
  to **one carrier** for **one relationship**, derived per
  (relationship × carrier) by **Identity §7a**. Registration,
  query, collection, and conclusion happen under it. It is
  Ed25519-only: it signs and authenticates, and nothing is ever
  sealed to it.

**The binding rule (MUST):** a principal registers, queries, and
collects **only the `rkid`s of its own relationship**. A carrier
MUST NOT expose any operation that answers, for one principal,
about another principal's registrations, and a conforming
recipient MUST NOT ask for one. A convenience query returning
"every key of this person" is the whole failure this section
exists to prevent, wearing a helpful face.

### 5a.2 The recipient address is per relationship (normative)

An `rkid` MUST NOT be reused across relationships. This is less a
new rule than a rule finally written down: under fresh-always
enactment (Encounter §4.4) every relationship-creation act derives
its own pair context with its own key-agreement key (Identity
§5.2), so encounter relationships already address differently by
construction. What this section adds is that the property is
**required**, not incidental: a `persona/` or `group/` context that
shows one card to many counterparts makes those counterparts
neighbours of one node at the carrier, and a recipient MUST NOT
register such a shared `rkid` at a carrier as if it were a
relationship address.

A recipient MAY hold arbitrarily many `rkid`s (this is the
recipient-managed property the contract has always allowed), and
Section 5's `key-retention` rule applies to every one of them
unchanged.

### 5a.3 Submission is principal-free (normative)

**A sender presents no identity to a carrier.** There is no sender
principal, no sender account, no channel authentication, and no
carrier-visible sender identifier of any kind — a carrier learns
from a submission exactly what Section 5 leaks (an `rkid`, a size,
a time) and nothing that spans two submissions.

This is a decision with a price, and the price is named: there is
no sender quota, no sender ban, and no negotiated permission to
send. Defence is **resource-shaped**, and its form is the
`admission-resource` constant every carrier declares (4.4),
metered per principal or per submission and never per person. A
carrier that answers abuse by identifying senders has not hardened
this contract; it has replaced it.

The neighbours resolve this the same way, which is some comfort
that it is not eccentric: a DIDComm mediator does not authenticate
the sender at all and draws its permission from the *recipient's*
standing connection, and ToIP/TSP addresses a carrier under a
private per-relationship VID rather than a person. Both authorize
**relationship-wise**, not person-wise.

### 5a.4 Two roles, one process, never one principal (normative)

A party may run both the storage a person recovers from and the
queues a person's relationships are delivered to. The deployed
previous-generation relay does exactly that in one process. The
port line between the two roles MUST therefore also be an
**identity line**:

> A party MUST NOT present, to the same carrier, one identity for
> both the storage-entry role (the recovery context, Identity §5.3)
> and any delivery-collection role (a control principal, Identity
> §7a). The two MUST be distinct identities even where one process,
> one operator, and one endpoint serve both.

The reason is not tidiness. The recovery context is, by
construction, the one identity of a person that is **derivable
with no register at all** — it must be, or recovery could not
start. It is therefore the closest thing a person has to a
person-wide constant. A service that saw a person's delivery
principals and their recovery context on one connection would join
every one of those relationships to that constant: not to a
pseudonym, but to the root of the person's own storage. That is
the strongest join available anywhere in this stack, and it is
available for free to any service that is asked to be both things
at once.

Two consequences, stated so that implementers do not have to
derive them: a device MUST NOT reuse a storage session for
collection or the reverse, and a carrier MUST NOT offer, and a
recipient MUST NOT accept, any "link your storage account"
convenience that establishes such a binding.

**Migrated identities are the honest exception.** For an identity
migrated from the previous generation, the historic recovery
context already carries social attachments (Identity §10), and its
own storage is already bound to the person. The separation of this
section therefore works **prospectively** for them — new
principals are separate from the first day — and cannot undo what
the deployed generation already showed its relay.

### 5a.5 Collection discipline (normative, SHOULD)

A device that serves **n** principals in **one** collection
session hands the carrier, in that session's shape alone, the join
that 5a.1 and Identity §7a were built to withhold. No derivation
can prevent this: it is behaviour, not cryptography.

> A recipient SHOULD NOT collect for two control principals within
> one session with a carrier, and SHOULD NOT correlate its
> collection times across principals more tightly than its traffic
> already requires.

This is a SHOULD and stays one, for a reason this document would
rather write down than pretend away: separate sessions cost
connections, battery, and latency, and on a mobile device that
cost is real and recurring. A MUST that implementations cannot
afford is a MUST that gets quietly worked around, and a
specification that carries such a rule is less honest, not more.
The residual is written out in §10 instead of being defined away.

*Several devices, one principal (informative).* Under the
shared-seed device model of Identity §3.2 every device of a person
derives the **same** principal for the same (relationship,
carrier). A carrier therefore sees one principal collected from
several sessions, which reveals device multiplicity for that one
relationship and nothing across relationships. This is DO-3's
question in the identity dimension, and it is answered the same
way: the principal is relationship-scoped, not device-scoped, and
whatever a future device model brings must keep it so.

### 5a.6 Loss, re-registration, and orphans (normative)

The carrier nonce of a relationship lives in the holder's
register (Identity §7a.3). Ordinary device loss recovers it: the
recovery context reaches the person's storage, the register comes
back, every principal re-derives, and no carrier is involved
(Identity §9.3).

Total loss of the register is different, and the difference is not
repairable here:

- The holder generates a fresh carrier nonce, and the
  relationship's `rkid`s are registered afresh under **new**
  principals.
- The old principals become **orphans**: registrations nobody will
  ever collect again. A carrier MUST NOT offer to hand a person
  "their" principals back — such an operation is precisely the
  cross-principal answer 5a.1 forbids, and offering it would make
  every carrier a de-anonymization service for its own users.
- Orphans are therefore aged out, never reclaimed, on the
  published `orphan-horizon` (4.4). Its expiry is a storage
  decision, is reported to no one, and changes no verdict.

Senders are unaffected in their contract: an envelope to a retired
address fails through the ordinary path (Section 5's tombstone
rule, §6.2 stage 2/3), with the ordinary status.

### 5a.7 Neighbouring carrier forms (informative)

An adapter for a ToIP/TSP mediator maps the control principal onto
the **private relationship VID** that layer already uses for the
same purpose — a mapping in the adapter, not a second form in this
contract. A DIDComm mediator adapter maps it onto the connection
under which a keylist is maintained, with the caveat that DIDComm
has no per-principal keylist query and a conforming adapter must
therefore not build one across principals (5a.1). Both mappings
are adapter work, below the port line, and neither adds a wire
form here.

## 6. Delivery Promises

### 6.1 Sender: the status trias

| State | Meaning |
|---|---|
| `accepted` | the service durably buffered it; delivery is owed |
| `delivered` | a **valid** `delivery-ack` (4.2 consistency) referencing its digest arrived |
| `failed(reason)` | the service gave up; reason from the closed set below |

Sender failure reasons (closed set): `unroutable` · `oversize` ·
`expired-by-adapter-policy` (the adapter's declared give-up bound) ·
`rejected-by-receiver(<receiver reason>)` where an adapter conveys
one. A late valid acknowledgement after `failed` transitions the
status to `delivered`; implementations MUST surface the transition.
No other states exist — in particular, no acceptance state.

### 6.2 Receiver: dispositions, in mandatory order

The pipeline, as a picture (informative — the numbered stages below
are normative):

```mermaid
flowchart TD
    E[envelope arrives] --> S1{stage 1 size gate}
    S1 -- no --> F1[failed oversize]
    S1 --> S2{stage 2 envelope schema, rkid known}
    S2 -- no --> F2[failed malformed]
    S2 --> S3{stage 3 decryption}
    S3 -- no --> F3[failed decryption-failed]
    S3 --> S4{stage 4 parse, digest, dedup}
    S4 -- fails --> F4[failed malformed]
    S4 -- duplicate --> DK[duplicate-known, stored ack re-sent]
    S4 --> S5{stages 5 to 7 profile, recipient, type, payload}
    S5 -- no --> F5[failed at the failing stage]
    S5 --> S8{stage 8 consistency, pre-lock checks}
    S8 -- no --> F8[failed validation or stale-issuance]
    S8 --> S9[stage 9 critical section under the lock set]
    S9 --> EO[own challenge open: record-creating effect]
    S9 --> ER[recorded: the record decides]
    S9 --> EU[unknown: failed validation-failed]
    EO --> U[effect plus retained ack, one durable transaction]
    ER --> U
```

Every received envelope is evaluated in this order, and the first
failing stage names the disposition:

1. size bound (5) — else `failed(oversize)`;
2. envelope schema, **base64url canonicity** (lengths `mod 4 ≠ 1`,
   zero trailing bits) and `rkid` known — live or tombstoned
   (Section 5) — else `failed(malformed)`;
3. decryption (all-zero check, tag) — else `failed(decryption-failed)`;
4. document parse + digest computation — a plaintext that does not
   parse as JSON or defeats JCS/digest computation is
   `failed(malformed)`; **duplicate check against the
   completed-effect cache** — the cache contains ONLY digests whose
   stage 9 completed successfully; a digest previously rejected at
   any stage is NOT in it and is re-evaluated in full. Duplicate →
   `duplicate-known`: the prior outcome applies idempotently and the
   **stored** acknowledgement of the completed effect **MUST be
   re-sent, byte-identical** (it exists by construction for every
   acknowledging type: the ack document is retained inside the
   effect's transaction, stage 9; a crash between commit and
   transmission would otherwise lose it permanently — for a
   **terminal** document, 4.2, no acknowledgement exists and nothing
   is re-sent). Evaluation ends;
5. document-profile schema + `recipient` = own anchor — else
   `failed(malformed)` / `failed(wrong-recipient)`;
6. `type` known — else `failed(unknown-type)`;
7. payload schema — else `failed(malformed)`;
8. type consistency rules and pre-lock acceptance checks
   (Section 4, incl. the issuance window for bundles) — else
   `failed(validation-failed)` / `failed(stale-issuance)`; **one
   exception:** a bundle whose bound challenge provisionally
   resolves `unknown` (the resolution itself has already latched any
   held aged value — Encounter 5.3) skips the rest of this stage and
   enters stage 9, where the authoritative resolution decides:
   still `unknown` → dispose; any other state → release and
   re-enter at stage 4 (4.1 check 5);
9. **gates and effect, serialized per lock set:** stage 9 is a
   critical section whose **lock set** is the document digest and,
   for bundles, additionally the credential's bound challenge (the
   **record key**). The lock protocol, normatively:
   the full lock set is acquired **atomically, as one acquisition**
   — never one key after the other; an evaluation whose set overlaps
   a held set **holds nothing while waiting**; and when the way is
   free it does not resume — it **re-enters at stage 4**, rechecking
   the completed-effect cache and re-selecting its branch on the
   state actually found. One rule covers both keys; there is no
   ordering to get wrong and no lock held across the re-entry. The
   record-key namespace and lifetime are shared with the optical
   input of Encounter 5.8/5.5 — the same lock, not an equivalent one
   — so record creation, branch selection, and credential uniqueness
   are serialized with every competing trigger. The completed-effect
   cache therefore never holds provisional state: a waiter either
   finds a completed entry (→ `duplicate-known`, mandatory re-ack
   where one is retained — for a terminal document, 4.2, there is
   nothing to re-send) or finds nothing and proceeds as a fresh
   evaluation. Inside the critical section: the authoritative
   resolution and effects of 4.1 — `open` → record-creating behind
   the future check (else `failed(gate-future)`), `recorded` → the
   record decides (foreign counterparty: `failed(consumed-challenge)`;
   else record-aware), `unknown` → `failed(validation-failed)` —
   each effect committed as one durable
   transaction (record where created, accepted material, cache
   entry, **the acknowledgement document itself where the type
   acknowledges, retained together with the cache entry per 4.2**;
   4.1) → `unique`.

**Validate, then consume:** no stage before 9 consumes single-use
material, and stage 9 consumes only after 1–8 passed in full — for a
bundle that includes the issuance window, so **nothing that stage 9
records can subsequently fail** (the poisoning rule, closed).

**`incomplete(missing)`** exists in the taxonomy for types with
declared dependencies. **No type of this casting declares any**; a
future type that does MUST define its closed `missing` vocabulary,
its re-evaluation trigger, and its retention bound in its own
specification.

### 6.3 At-least-once and reconciliation

Adapters MAY deliver any envelope multiple times; receivers converge
via stage 4 (`duplicate-known`). A lost acknowledgement is
indistinguishable from a lost document to the sender; the sender's
remedy is the carrier switch of Encounter 5.8 — the **same
enactment** continues on the optical leg, and the late bundle is
accepted via the record (4.1). A **fresh enactment** arises only when
the optical leg's `boundTo` no longer resolves — the `gate-expired`
outcome of Encounter 5.8; the resulting parallel enactments are
reconciled by **Encounter 0.29 (wire 0.25), 4.2 and 5.8**: both are valid, a late
counter-credential to the first is accepted, and enactment
multiplicity never multiplies edges (one edge per anchor pair). This
contract adds nothing to those rules and relies on them.

## 7. Timing

| Parameter | Default | Meaning |
|---|---|---|
| `ack-wait` | PT30S | RECOMMENDED sender-side wait before **automatically** presenting the optical leg — the carrier switch within the same enactment (Encounter 5.8); presentation is permitted at any moment, and conformance never depends on when the switch happens; **cancelled by an arriving acknowledgement or counter-credential** |
| `key-retention` | max(P90D, longest adapter give-up horizon) | minimum retention of a key-agreement private key after it last appeared in any card (Section 5) |

`ack-wait` is a UX pacing parameter, not a validity rule: an
acknowledgement arriving after it is still valid (6.1 late
transition), and the record-aware effect (4.1) makes any switch
timing safe.
Delivery time itself is unbounded; no rule in this contract references
arrival time for validity.

## 8. State Machines (informative)

**Sender (A, one-scan):**
`scanning → confirmed/sent (waiting animation) → delivered ("nothing
more to do") → [counter-credential accepted] → relation confirmed`
— with `waiting --ack-wait elapsed--> optical presentation (show the
sent card as QR)`, and `failed --late valid ack--> delivered`.

**Receiver (B, one-scan):**
`envelope → staged evaluation (6.2) → recorded + auto-ack → prompt:
"verify A back?" → [human confirms] → counter-step issued → relation
confirmed` — any rejection before the final stage (6.2 stage 9) sends
no ack and consumes nothing; B's prompt is C4, never automated.

## 9. Security Considerations

- **The seal is to a card key.** Whoever holds the recipient's card
  can seal to them — including the bystander of the challenge race
  (Encounter §13). The seal provides confidentiality, never sender
  authenticity.
- **The acknowledgement is now a proof-carrying document.** Forging
  one requires the acknowledging anchor's key; replaying one is
  idempotent (same digest, same thread); redirecting one fails the
  4.2 consistency rules. Suppressing acknowledgements causes fallback,
  not loss, and the late-ack transition plus the Encounter merge rule
  bound the damage of selective suppression to UX, never to state
  divergence.
- **At-least-once is an attack surface made safe by idempotency.**
  Replayed envelopes converge by plaintext digest; re-sealed replays
  converge identically.
- **Oversize and garbage envelopes are rejected before expensive
  work** (6.2 order; size bound before decryption).
- **Adapters are untrusted for content.** A transport can delay, drop,
  duplicate, and observe metadata; it can never read, alter, or forge
  documents without detection.
- **Principal-free submission is a deliberate exposure, bounded by
  resources.** Without a sender identity there is no sender ban and
  no sender quota, so a carrier's only lever against flooding is the
  declared `admission-resource` (4.4). That constant is where this
  contract is most easily defeated **from behind**: an admission
  scheme keyed to an account, an invitation, a device certificate,
  or any person-wide counter would re-identify every principal of a
  person at the moment of admission and undo all of 5a at once.
  Hence the metering scope is fixed by this contract and not
  negotiable by the carrier (4.4, 5a.3) — the registration
  mechanism is the most dangerous surface of this design, and it is
  the one this document constrains most tightly.
- **A control principal is a signing identity and nothing else.**
  Compromise of a principal's key lets an attacker collect and
  conclude for one relationship at one carrier; it decrypts
  nothing (sealing is to the `rkid`, Section 5) and reaches no
  other principal, because principals share no derivation path
  (Identity §7a.4). The blast radius is one relationship at one
  carrier — which is what per-(relationship × carrier)
  granularity buys on the compromise side, not only the privacy
  side.

## 10. Privacy Considerations

- **What a carrier sees, exactly.** From an envelope: the `rkid`,
  the size, and the time — and **not** the recipient's anchor,
  which travels inside the sealed document and never in the
  envelope (Section 5). From the registration and collection side:
  the control principals presented to it, the `rkid`s each one
  registers, and when each one collects. Earlier castings named
  the recipient anchor here and credited "derived service
  identities (A7)" with bounding what a transport learns. Both
  were wrong: the anchor is not on the envelope, and Identity §7's
  service identities are scoped **per group** and never applied to
  a delivery relationship. The bound is now real and has a name —
  the carrier-relationship identity of Identity §7a, consumed by
  5a — and this section states what it does and does not buy.
- **What the identity discipline buys.** A carrier cannot join two
  of a person's relationships through the identities it is shown:
  principals are per (relationship × carrier), the `rkid`s are per
  relationship, submission carries no sender identity, and no
  operation answers across principals (5a.1). Two carriers of one
  person see principal sets with no computable relation. That
  closes the **list join** — the one that needs no analysis at
  all, only a query — which was the cheapest and most dangerous of
  the four.
- **What it does not buy, named one by one.** *Timing and volume:*
  the `delivery-ack` is a document in the opposite direction, so a
  carrier holding both directions can pair two `rkid`s by response
  time with no identity whatsoever; no identity rule reaches this.
  *The collection pattern:* a device that serves several principals
  closely together gives back exactly what the derivation
  separated — this is why 5a.5 is a SHOULD with its price named,
  and it is the strongest residual join that remains. *The network
  layer:* without network anonymity a carrier sees addresses; that
  is deployment terrain and is not argued away here. *Colluding
  carriers:* two carriers comparing traffic correlate by time and
  volume; the derivation defeats the shared list, not the shared
  analysis. *Migrated identities:* they carry the previous
  generation's exposure forward, and 5a.4 helps them prospectively
  only. **No unlinkability claim follows from this section**, and
  implementations MUST NOT present one.
- **An acknowledgement is a probe response, and this is stated
  precisely:** its presence tells the sender that the recipient's
  device was online **and** that the document passed every stage
  through recording — including, for a bundle, that either the
  displayed challenge was still unconsumed and the gate open
  (record-creating effect) or that the optical leg had already
  created the matching record (record-aware effect); the
  acknowledgement does not distinguish the two. A sender can
  distinguish "online but gate closed" from "recorded" by ack
  presence. This is inherent to the flow the acknowledgement serves.
  Its life differs by effect, and this is stated honestly: the **gate
  probe** ("was the challenge still open?") is bounded by the
  challenge's short life, but on the **record-aware path** an
  acknowledgement — stored or freshly generated after retention — can
  arise for as long as the enactment record lives, revealing arrival
  and the record's existence to its own counterparty, and nothing
  more. Implementations MUST NOT extend the ack with further detail.
- **Sealed content is opaque end to end.**

## 11. Conformance

- **Profile** `rltp-delivery@0.23`; the Identity pin is
  **Identity 0.14** (§7a, the control principal); the Encounter pin is
  `rltp-encounter@0.29` (wire 0.25); companion registrations per
  4.4 (Network Visibility 0.16, Access 0.53, Membership Tasks 0.16, Replication 0.26).
- **Classes:** *sender* (sealing, status trias, ack-wait switch
  trigger; principal-free submission, 5a.3) · *receiver*
  (unsealing, staged dispositions, ack generation; the addressing
  triple of 5a.1, per-relationship `rkid`s 5a.2, the role
  separation of 5a.4, the collection discipline of 5a.5) ·
  adapters are below the port line. A **carrier** is an adapter
  and conforms through 4.4's carrier role: it declares both
  required constants, meters admission per principal or per
  submission and never per person, answers no query across
  principals, and ages orphans on its published horizon
  (5a.1, 5a.6).
- **Normative schemas (shipped, complete closure for offline
  registration):** `schemas/rltp-delivery-document.schema.json` ·
  `schemas/sealed-envelope.schema.json` ·
  `schemas/payload-encounter-bundle.schema.json` ·
  `schemas/payload-delivery-ack.schema.json` ·
  `schemas/payload-encounter-credential-delivery.schema.json` ·
  `schemas/payload-registry-declaration.schema.json` —
  plus, by reference through 4.4, the companion-registered payload
  schemas named there.
- **Shipped vector:** `vectors/seal.json` (5).
- **Vector plan:** seal/unseal roundtrip against the shipped vector ·
  digest invariance under re-sealing · every disposition stage of 6.2
  as a distinct vector, in-order (including oversize before
  decryption, tag-only ciphertext as `malformed`, unknown `rkid`,
  all-zero secret rejection) · validate-then-consume (a bundle
  failing stage 8 consumes nothing) · duplicate and concurrent
  delivery converge with identical re-ack · **ack forgery matrix:**
  unsigned ack rejected, foreign-signed rejected, wrong-thread
  rejected, wrong-direction rejected, valid ack accepted, late valid
  ack transitions `failed → delivered` · ack generation at each
  type's defined effect, none on rejection, no dependency on the
  confirmation step · outer/inner consistency vectors per type
  (Mallory-wrapped credential produces no ack to Mallory) ·
  `ceremony` member absent (accepted), present-and-matching
  (accepted), present-and-wrong (rejected) · threadId rules per type
  · status trias transitions including every failure reason ·
  **record-aware effect:** bundle after optical completion → accepted
  via record + ack · binding mismatch against record → rejected,
  nothing consumed · enclosed card not JCS-identical to
  the record's stored counterparty card → `failed(validation-failed)`
  · conflicting or re-proofed credential on an existing record →
  `failed(validation-failed)`, no ack · every Encounter 5.6 rejection
  exercised on the record-aware path · optical record creation racing
  a bundle between stage 8 and stage 9 → branch re-selected inside
  the critical section, accepted via record, never
  `failed(consumed-challenge)` · two bundles with distinct digests
  competing for one challenge → exactly one record-creating effect;
  the other accepted idempotently (equal credential digest), or —
  **from the record's same counterparty** — a conflicting credential
  `failed(validation-failed)`, or — foreign counterparty —
  `failed(consumed-challenge)`; never a second record · crash after a
  record-aware commit and before ack transmission → redelivery yields
  the mandatory byte-identical re-ack · **state-model additions:**
  resolution selects every branch: `open` → record-creating,
  `recorded` → record decides, `unknown` → `failed(validation-failed)`
  · card `boundTo` ≠ credential's bound challenge →
  `failed(validation-failed)` at outer/inner consistency ·
  wrong-counterparty disposition stable under waiter re-entry
  (re-resolution yields `recorded` again → `failed(consumed-challenge)`
  both times) · aged-out challenge, no record → resolution `unknown`
  → `failed(validation-failed)`, no gate disposition · envelope
  sealed to a retired (tombstoned) `rkid` → passes stage 2, fails
  stage 3 `failed(decryption-failed)`; `rkid` never issued →
  `failed(malformed)` at stage 2 · **polish-round additions:**
  future-dated own challenge beyond skew at the record-creating gate
  → `failed(gate-future)` · record held by a different counterparty →
  `failed(consumed-challenge)`, nothing consumed anew · redelivered
  `delivery-ack` → `duplicate-known`, no ack-of-ack, sender status
  unchanged · post-retention redelivery with surviving record →
  record-aware idempotent acceptance, freshly generated ack;
  without surviving record → `failed(validation-failed)` at the
  pre-record checks (check 5), no gate reached · lock-set
  atomicity: interleaved bundle/optical triggers on one record key
  under load → no deadlock, one effect per document: every delivery
  waiter re-enters at stage 4, every optical waiter reacquires its
  singleton lock and reruns the record resolution of Encounter 5.5 ·
  invalid JSON inside a valid seal → `failed(malformed)` at stage 4 ·
  **polish-round additions:** framework-expanded `ceremony`
  (`round`/`terminal`/`prev` present → accepted) · credential with
  foreign ceremony label in a bundle → `failed(validation-failed)` ·
  concurrent first deliveries → exactly one `unique`, one
  `duplicate-known`, identical acks · crash between effect commit and
  ack transmission → redelivery yields the mandatory re-ack ·
  key retirement never precedes the declared adapter horizon ·
  **eighteenth-casting additions (the registry):** a
  companion-registered type with a registry entry → dispatched to
  its own specification's consistency rules; the same type absent
  from the registry → `failed(unknown-type)` per 6.2, no effect · a
  registry entry publishing an adaptive constant → nonconformant
  (constants are fixed) · `registry-declaration/0.1`: valid
  declaration recorded; unsigned or foreign-signed → discarded;
  replacement prospective-only · introduction-ack timing computed
  from the declared `ack-delay` (Visibility §8.4's verdict
  window); an introduction-request sent without holding the
  mediator's declaration → nonconformant at the sender ·
  a `member-mapping/0.1` document from a party the receiver holds
  no relationship with → rejected by the receiver's own
  acceptance list (Access §5.5 step 2 — the transport verdict is
  ordinary; the channel rule is the artifact's, stated honestly) ·
  **twenty-third-casting additions (the carrier cut, §5a):**
  the derivation seam itself is executable in
  `vectors/identity-derivation.json` (`carrierRelationship`) and
  MUST be reproduced by any implementation claiming this profile:
  one relationship at two carriers → two principals with no
  computable relation; a case-variant carrier string → a third
  principal (byte-exactness, Identity §7a.2); no key-agreement key
  derived for the class · one `rkid` registered under two
  principals → nonconformant (5a.2) · a cross-principal query
  (`list the keys of this principal's person`) offered by a carrier
  → nonconformant; the same query issued by a recipient →
  nonconformant (5a.1) · a submission carrying any sender
  identifier at the carrier interface → nonconformant (5a.3) ·
  an `admission-resource` metered by an account, invitation,
  device certificate, or any counter spanning two principals →
  nonconformant, `none` accepted as a declared value (4.4) · a
  carrier declaring only one of the two required constants, or
  neither → nonconformant; a principal registering before it holds
  both → nonconformant (4.4, 5a.6) · `orphan-horizon` outside
  `[P7D, P365D]` → the declaration rejects, as for every
  out-of-domain constant (4.4) · one identity presented for both
  storage entry and delivery collection at one party → nonconformant
  under 5a.4, **including where one process serves both roles** ·
  a carrier operation offering to enumerate or restore a person's
  principals after register loss → nonconformant (5a.6) · orphan
  expiry produces no document, no disposition, and no status
  change beyond §6.1's ordinary path (5a.6) · collection of two
  principals in one session → conformant but SHOULD-violating,
  and reported as such rather than passed silently (5a.5) ·
  `https://real-life.org/trust-tasks/delivery-carrier/0.1` used as
  a document `type` → `failed(unknown-type)` (4.4).

## 12. Open Issues

- **DO-2b HPKE.** Whether to align the seal with RFC 9180 in a future
  version; the 0.2 construction transcribes the deployed one.
- **DO-3 Multi-device delivery.** What `delivered` means when an
  anchor has several devices; adapter-defined until the Layer-1
  device model (IO-4) lands; the ack meaning is deliberately
  device-scoped.
- **DO-4 Third-party task types.** The first type retained by third
  parties beyond the ack's sender needs its proof rules stated per
  TT §4.7.1; the ack itself is retained only by its sender.
- **DO-5 Ordering.** No global ordering is promised; thread
  causality plus the merge rule cover every current flow.

## Appendix A (informative): mapping to the current implementation

| This contract | Today (Sync 001/003, wot-core) |
|---|---|
| Document (Trust Task, profile §3) | `MessageEnvelope` / DIDComm plaintext + `MessageType` union |
| `threadId` | `thid`/`pthid` |
| Sealed envelope (5) | ECIES body `{epk, nonce, ciphertext}`, info `wot/ecies/v1` → `rltp/v1/seal`, plus new `rkid` |
| Status trias (6.1) | `RelayReceipt accepted/delivered/failed` |
| `delivery-ack` (4.2) | `attestation-receipt` (Häkchen 2) — semantics move to arrival-at-recording, **and the ack gains a proof** |
| Dispositions (6.2) | K1 `InboxAck*` taxonomy, now with mandatory order |
| Transport queue ack | relay `{type:'ack'}` — below the port line, unspecified here |

## References

[RFC2119] · [RFC8174] BCP 14 · [RFC3339] · [RFC8785] JCS · [RFC5869]
HKDF · **RLTP Identity Layer 0.14** (normative; §5.2 the `rkid`'s
key material, §5.3 the recovery context, §7 service identities,
**§7a the carrier-relationship identity**, §9.3 recovery) ·
[TT] ToIP DTGWG Trust Tasks framework specification 0.4
(§4.8.2, §4.11.1, §6.1, §6.3, §6.5, §7.2–7.3) · RLTP Encounter Layer
0.29, wire 0.25 (delivery port, binding 5.4, ceremony 5.8,
fresh-always §4.4, state model 5.3, merge rule 4.2) · RLTP Network
Visibility 0.16 (§2.1, §6a, §8) · RLTP Access Layer 0.53, wire
0.24 · RLTP Replication Contract 0.26 (§7/I14, the
direct-effect seam of 4.4) · RLTP Membership Tasks 0.16 (§3) · Sync
001/003 (superseded transport specs, Appendix A).
