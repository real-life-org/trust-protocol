# RLTP Delivery Contract

**Real Life Trust Protocol — service contract: Delivery**

- **Status:** Editor's Draft
- **Version:** 0.85.1-draft (eighty-fifth casting — a sealed envelope
  travels as a Trust Task document of its own in a carrier's Trust
  Task binding, and `accepted` carries the feature `held`; patch 1: a
  consumer's refusal is a `trust-task-error` of 0.4 to 0.6, no rule
  change)
- **Editors:** Anton Tranelis
- **Date:** 2026-10-28
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Task-type namespace:** `https://real-life.org/trust-tasks/spec/`
- **Target Trust Tasks framework version:** 0.6.0
- **Conformance profile:** `rltp-delivery@0.85` (draft)
- **Companions:** RLTP Identity 0.55; RLTP Encounter 0.32; RLTP Trust
  Layer 0.31; RLTP Access 0.58; RLTP Membership Tasks 0.21.1; RLTP
  Replication 0.26; RLTP Message Tasks 0.2.
- **Supersedes:** version 0.85.0 (archived as
  `archive/delivery-contract-0.85.0.md`), version 0.84 (archived as
  `archive/delivery-contract-0.84.md`) and versions 0.83–0.1,
  archived alongside it.
- **Supersedes on adoption:** `04-transport/001-sync-protokoll.md`
  (wot-spec v0.1, German) in its delivery aspects.

## Abstract

This document specifies how RLTP documents travel between people. The
delivery service moves **proof-carrying, anchor-encrypted, typed documents**
from one person to another — eventually, at least once, never silently
lost — and tells both sides honestly what it knows: the sender its
transport state, the receiver nothing the content does not prove
itself, and the sender **never** what the receiver decided.

Messages are **Trust Task documents** of private, versioned types under
`https://real-life.org/trust-tasks/spec/` (ToIP DTGWG Trust Tasks
framework 0.6.0, §6.5 private specifications). This casting registers five types
of its own — `encounter-bundle`, `delivery-ack`,
`encounter-credential-delivery`, `registry-declaration`, and
`sealed-envelope`, the form in which a carrier that carries Trust Task
documents carries the sealed envelope of every other — the RLTP
document profile all types
share, the sealed envelope they travel in, and the **task registry**
(4.4) through which companion layers register theirs: the membership
and access types and the message type (registered in their own
documents) and the Trust layer's introduction and continuity types
and its trust-layer family. The receiver's stages carry two states
a holder keeps about a relationship without telling it: a **block**,
under which a registering specification discards offers and content
while the protocol steps continue, and a **rate**, beyond which a
document waits at its carrier rather than being decided.

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

This is an **Editor's Draft** with no standing. The document
remains as the scope re-cast of 2026-08-27 shaped it: **the
promise is protocol; the mechanism is carrier policy.** What a
counterpart can observe at the port line is specified and
vector-tested; how a carrier meets it internally is its own affair.
The sealed envelope, the delivery promises and the disposition
machinery (5, 6) have been stable across many castings; the carrier
sections (4.4's role, 5a) are the youngest part and the most likely
to change.

This casting carries the sealed envelope into the Trust Task bindings
of the framework's registry. A carrier that carries Trust Task
documents — the registry's TSP binding is the first — carries every
sealed envelope as the payload of a document of the new type
`sealed-envelope/0.1` (4.6, RLTP-DEL-5030), built so that every
repeated submission of one envelope is byte-identical (RLTP-DEL-5040).
A consumer outside RLTP reads that document's type and parties
without opening the seal, and refuses or answers it by the
framework's rules. The sender's `accepted` carries one closed feature,
`held`: the counterpart's answer that the document arrived and waits
for something it names, under which the document is no longer given
up at a horizon (6.1, RLTP-DEL-6140). One wire identity per
relationship and carrier may deposit and collect (5a.10). The
sealed envelope itself, the document profile of every other type, the
dispositions and the trias are unchanged. Rules new in a casting
carry identifiers (`RLTP-DEL-nnnn`); the rest of the text keeps its
prose form until a form casting gives every rule one. **The next
casting is expected to change the document substantially**,
together with the Trust Layer's next casting: the introduction
types of 4.4, the rest of a submission contract between a sender
and its adapter in 6.1, addresses issued ahead of an act in 5 and
5a, and the lock protocol of 6.2 moving into a companion on holder
state.

The reference library implements the sealed envelope, the receive
stages of 6.2 with the completed-effect cache and the disposition
`discarded`, the key classes of Section 5, the sender's status of
6.1 and the acknowledgement classes of 4.2 on its holder, and the
carrier port of 4.4 and 5a, `message/0.1` with its age bound and
sender lifetime, `failed(rate-limited)`, `failed(task-expired)`, and
the block for `message/0.1` and `membership-invite/0.2`, and the
custody and retry rules (RLTP-DEL-6120 to RLTP-DEL-6135,
RLTP-DEL-6330, RLTP-DEL-6335) on its holder and in its VTI mediator
adapter, and the carried document of 4.6 and the feature `held` in that
adapter and on its holder; transports beyond that adapter are not in
it. Review
happens against the converged companion documents; the convergence
criterion is a review round with no blocker-level findings.
Feedback is welcome via the issues of the publication repository
([`real-life-org/trust-protocol`](https://github.com/real-life-org/trust-protocol)).

## 1. Introduction (informative)

### 1.1 Essence and principles

- **Eventually, at least once, never silently lost.** Delivery time is
  unbounded and never affects validity (Encounter 1.3); a registered
  type may bound the age of a sender timestamp inside its own
  protected payload, and then that type's rule, not this contract,
  refuses an old document (Section 7). At-least-once
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
idempotency and acknowledgement reference. Because it covers the
document with any `proof`, it is the framework's `stepDigest`, not its
`taskDigest` (TT §4.9.3); for a document without `proof` the two
values coincide. **Sealed
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
version **0.6.0**, under the private task-type rules of TT §6.5. The
profile — normative wire form
`schemas/rltp-delivery-document.schema.json` — requires:

- `id` — REQUIRED; UUID v4, except on `sealed-envelope/0.1`, whose
  `id` is the UUID v8 of RLTP-DEL-4620.
- `type` — REQUIRED; the Type URI of a registered RLTP task type, in
  the form of RLTP-DEL-3010.
- `issuer`, `recipient` — REQUIRED, in-band, as anchors. A consumer
  MUST reject a document whose `recipient` is not its own anchor
  (TT §7.2 rule 5 — the receiver principle at the envelope level).
  The parties of `sealed-envelope/0.1` are its carrier's identifiers,
  not anchors, and its carrier checks them (4.6, RLTP-DEL-5030).
- `threadId` — REQUIRED: fresh (UUID v4) on thread-opening documents,
  equal to the answered document's `threadId` on responses; on
  `sealed-envelope/0.1` equal to its `id`.
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
  windows live in payloads and ceremonies, with issuance semantics,
  and an age bound a type declares lives in its protected payload
  (Section 7).
- `proof` — REQUIRED on `delivery-ack` and on
  `registry-declaration` (4.4) — the two types whose authenticity
  has no other carrier (1.1); MUST be absent on `sealed-envelope/0.1`,
  whose carrier authenticates its sender end to end (4.6), and on the
  other types of this casting, whose authenticity is carried by the payloads'
  own proofs inside — signatures or designated-verifier MACs
  (the trust-layer family of 4.4 is deliberately unsigned). Where `proof` is present, TT §4.8.2 audience binding is
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

**RLTP-DEL-3010** — A Type URI MUST have the form
`https://real-life.org/trust-tasks/spec/<slug>/<MAJOR.MINOR>`. The
slug is the path between `/spec/` and the version, satisfies the slug
grammar of TT §6.1, and MUST NOT match `^trust-(task|ceremony)($|-|/)`;
the version has no leading zero (TT §5.1); the URI carries no fragment,
since no type defines a response variant (RLTP-DEL-3020). A `type` in
any other form fails the document-profile schema and is
`failed(malformed)` (6.2 stage 5), a registered slug and version
without the `/spec/` segment included; no other form of a registered
type's name is accepted.

*Rationale.* A consumer extracts the slug as the segments between
`/spec/` and the version (TT §6.1); without that segment a foreign
consumer cannot name the specification at all. The form is the one
the framework's Working Draft 0.7.0 requires of every private Type
URI as well.

**RLTP-DEL-3020** — Every registering specification MUST declare, per
type, the framework's specification declarations (TT §7.3): the
parties with their `identifierScope` (item 5), the proof requirement
(item 8), the side-effect class (item 13), the exposure class with
`discloses`, `actsAsSubject` and `ingests` (item 14), the retention
class (item 18), the free-text members (item 19), and the document
size bound of RLTP-DEL-3030. The following hold for every registered
type and need not be repeated in a declaration:

- **Parties.** `issuer` and `recipient` are REQUIRED in-band, as
  `did:key` anchors (Ed25519) — on `sealed-envelope/0.1` as the
  carrier's `did:key` identifiers (4.6); a declaration names the role
  of each and its `identifierScope`.
- **Freshness (item 17).** `issuedAt` is REQUIRED; `expiresAt` is
  absent. No document carries an acceptance window: delivery time is
  unbounded (Section 7), and a type that bounds age does so inside
  its protected payload.
- **No response variant.** No type defines a `#response`; the only
  answer to a document is the `delivery-ack` (4.2) or a document of
  another registered type, and to a `sealed-envelope/0.1` document the
  framework's own `trust-task-error` (0.4 to 0.6) or
  `trust-task-next-step/0.1` of a consumer that refuses it or cannot complete it in isolation
  (4.6). Every type therefore declares `discloses: none`.
- **No subject agency.** No type has its recipient act in another
  party's name; every type declares `actsAsSubject: false`.
- **Repeated execution.** Every type but `sealed-envelope/0.1` is
  bound by TT §7.2 item 11 as this contract reads it at 6.2 stage 4,
  by document digest (Section 12, DO-10); `sealed-envelope/0.1`
  declares its repeated execution safe and intended (4.6).
- **No extensions.** No type opts into `ext`.
- **No JSON-LD context** is published for any type (item 10), and
  no type defines task-specific error codes (item 9).
- **Authorization evidence (item 15).** Every type is consequential
  (each declares `mutating` or `destructive`), and none carries
  authority: a document grants nothing by its arrival or its form. What
  a consumer holds to interpret one is the group's authority log
  (Access 5.3) for the types that act on a group, and its own holder
  state for every other type: the challenge it issued, the tuple a
  document arrives on, the documents it sent, the act it holds. The
  registering specification names that evidence per type (4.5,
  Membership Tasks §3, Access §10, Message Tasks 3.4).
- **Execution checkpoints (item 16).** Per document, a type's effect
  is evaluated at 6.2 stage 9 under the lock set and commits as one
  transaction; no document's effect is applied in part. Where a layer
  judges again later, that is a stage of its own, named by the
  registering specification, not a partial application. Such stages
  are, for example, the provisional adoption of a welcome or a
  re-welcome until the log arrives (Access RLTP-ACC-10200 to
  RLTP-ACC-10310, Membership RLTP-MT-3495), a document pending its
  group state and judged once that state arrives (Access
  RLTP-ACC-10190, Membership 3.3), the Encounter acceptance of a
  buffered credential (Encounter 5.6), and an introduction's held
  voucher, judged again when a reply is accepted (Trust Layer
  RLTP-TRU-8770).

**RLTP-DEL-3030** — Each type declares a **document size bound**: the
largest UTF-8 JCS serialization of a document of that type, `proof`
included and the sealed envelope the document travels in excluded; for
`sealed-envelope/0.1`, which travels in none, the sealed envelope it
carries as its payload is included. The bound is the plaintext
bound of Section 5, 65 536 bytes, unless the registering
specification declares a smaller one. One type is named as the
exception: `sealed-envelope/0.1` carries a sealed envelope as its
payload, a ciphertext of a document within the plaintext bound, and
declares 90 112 bytes (4.6); it is never sealed itself, so the
plaintext bound does not reach it. A document over the plaintext
bound is `failed(oversize)` before decryption (6.2 stage 1); a
document within it but over its type's smaller bound is disposed as
the registering specification states. A receiver MUST NOT refuse a
document within its type's bound on grounds of size alone. For a
chunked type the bound applies to each chunk, which is one document.

*Rationale.* The bound is the one the framework's editor's draft
asks a specification to declare (item 21 after Working Draft 0.7.0,
`dtgwg-trust-tasks-spec` f0b5b8e); the JCS plaintext is exactly the
document "as received". The number is not new: Section 5 has bounded
every document since the first casting.

## 4. Registered Task Types

Each type below is a private Trust Task specification with: Type URI,
target framework 0.6.0, payload schema (shipped), proof declaration (per
Section 3), the declarations of RLTP-DEL-3020 (4.5; for
`sealed-envelope/0.1`, 4.6), and the consistency rules stated here.

### 4.1 `encounter-bundle/0.1`

The transmission of the one-scan ceremony (Encounter 5.8): the
scanner's sent card and step credential.

- `payload`: `{ "card", "credential" }` per
  `schemas/payload-encounter-bundle.schema.json`.
- `threadId`: fresh (opens the exchange). `proof`: absent.
- **Declarations (TT §7.3):** 4.5.
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
     sender's label — **placement note:** for a bundle this ceremony
     equality is evaluated HERE, at check 5 after the card proof,
     credential proof, and addressee, while Encounter 5.6 step 1
     evaluates it as part of the FORMAT check for a credential
     received on its own (4.3); the two orders are both normative,
     each for its carrier, and a receiver MUST apply the one that
     matches the document it holds; and the enactment binding
     recomputes per Encounter 5.4 from {the resolved own challenge,
     card's sent-challenge};
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
  never a second record. **Thread freshness under re-issue:** a bundle
  re-issued for the same enactment (a new document, not a byte-identical
  redelivery) opens a **fresh** `threadId` like every thread-opening
  document (Section 3); the record keeps the thread of the bundle that
  committed first, and every later bundle lands idempotently via the
  record-aware effect. A new bundle document on an already used thread
  is `failed(validation-failed)`.

### 4.2 `delivery-ack/0.1`

The arrival acknowledgement (DO-1).

- `payload`: `{ "ref": <document digest of the acknowledged document>,
  "meaning": "received" }` per
  `schemas/payload-delivery-ack.schema.json`.
- **Declarations (TT §7.3):** 4.5.
- `threadId`: = the acknowledged document's `threadId`.
- `proof`: **REQUIRED**, in the form the acknowledgement class rule
  (4.4) selects by the acknowledged payload's audience class:
  - for a payload whose authenticity is a **transferable
    signature**: `eddsa-jcs-2022` under the ack's `issuer` anchor —
    an unsigned or foreign-signed acknowledgement is invalid;
  - for a **designated-verifier** payload: `{ "mac": … }` —
    HMAC-SHA-256 over **JCS of the ack document without `proof`**
    (binding `id`, `type`, `issuer`, `recipient`, `threadId`,
    `issuedAt`, and the payload with its `ref`), encoded `u` + 43
    base64url characters, under the **ack key of the arrival
    tuple**: `k = HKDF-SHA-256(ikm = X25519(pairX_issuer,
    pairX_recipient), salt = empty, info =
    "rltp/v1/delivery/mac/ack/" || issuerPairAnchor || "/" ||
    recipientPairAnchor, output 32 bytes)` with both anchors as
    anchor bytes; an all-zero shared secret MUST be rejected
    before derivation (as in Section 5) — **one regime for every
    DV-type ack**, keyed by the channel, never by the payload's
    internal MAC structure (a multi-MAC payload like
    `anchor-mapping@4` changes nothing here). A wrong proof form for the payload's class is
    invalid. The MAC form is receiver-forgeable by construction —
    that is its purpose (deniability): for DV payloads the ack is
    **evidence to the sender alone**, not an attestation.
- **Consistency (MUST, on receipt):** proof verifies under `issuer`
  (signature form) or under the arrival tuple's ack key (MAC form);
  `issuer` = the acknowledged document's `recipient`; `recipient` =
  the acknowledged document's `issuer`; `threadId` matches; `ref`
  matches a document this sender actually sent on that thread. Any
  failure → the ack is rejected (`failed(validation-failed)`) and the
  sender's status is unchanged.
- Generation: **automatic at the durable recording of the referenced
  document's defined effect** (4.1: the committed bundle effect,
  record-creating or record-aware; 4.3: durable buffering). It MUST NOT wait for, depend on, or reveal any
  human decision, and MUST NOT be sent for a document rejected at
  document level, nor for a document disposed `discarded` or
  `failed(rate-limited)` (6.2), neither of which records a defined
  effect. **The acknowledgement document is created inside
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
- Meaning, normatively and honestly bounded — **by class**: for
  signature-class payloads, *the recipient's anchor **attests** that
  the document reached its authenticated device and that its defined
  effect is durably recorded* — an attestation, not a proof of
  causal receipt; a recipient who signs falsely harms only their own
  state, and the sender's `delivered` is exactly as strong as that
  attestation. For DV-class payloads the MAC-proved ack carries the
  **same meaning to the sender** but is no attestation toward
  anyone else: either party can compute it, which is exactly the
  deniability the class rule requires. Implementations MUST NOT present it as
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
- **Declarations (TT §7.3):** 4.5.
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
types this document registers itself, the registry's
members are registered **where their semantics live**, each as a
private Trust Task specification naming its type URI, payload
schema, proof declaration, the declarations of RLTP-DEL-3020, and
consistency rules. The Trust Layer's types are the exception for
their declarations only: their registration text is this section,
so their declarations stand in 4.5. The registry's members:

- `membership-invite/0.2` · `membership-accept/0.2` ·
  `access-operation/0.1` · `membership-evidence/0.2`, with
  `membership-evidence/0.1` still accepted (its RLTP-MT-3815) ·
  `membership-prelude-request/0.1` · `membership-prelude-reply/0.1`
  (its 3.5) — Membership Tasks §3;
- `key-delivery/0.1` · `removal-notice/0.1` — Access §10;
- `introduction-request/0.1` · `introduction-forward/0.1` ·
  `introduction-reply/0.1` · `introduction-ack/0.1` ·
  `introduction-voucher/0.1` — Trust Layer §8.1; payload
  schemas `schemas/visibility-payload-introduction-request.schema.json`,
  `…-forward…`, `…-reply…`, `…-ack…`, `…-voucher….schema.json`;
  proofs per Trust Layer §2.1 (the artifacts carry their own MACs
  and signatures; the documents carry none — one carrier);
- `message/0.1` — Message Tasks §3; the payload is the artifact
  `message@1` (`schemas/message.schema.json`), authenticated by its
  inner MAC under a directional key of the arrival tuple; the
  document carries no proof — one carrier; it travels on the
  relationship channel of the active head of a relationship; its
  defined effect, its age bound (Section 7), its rate (6.2) and the
  relationship key of its lock set (6.2) are Message Tasks §4;
- `continuity-probe/0.1` · `continuity-mapping/0.1` — Trust
  Layer §6a.2/§6a.4; the payload is the artifact itself
  (`schemas/visibility-continuity-probe.schema.json`,
  `schemas/visibility-continuity-mapping.schema.json`), travelling
  on the enactment tuple's own channel (its §6a.3);
- `star/0.2` · `group-star/0.1` · `anchor-mapping/0.3` ·
  `profile/0.1` — the trust-layer family, Trust Layer
  §5.2/§5.2b/§6.1/§6b; the payload is the artifact itself
  (`schemas/visibility-star.schema.json`,
  `schemas/visibility-group-star.schema.json`,
  `schemas/visibility-anchor-mapping.schema.json`,
  `schemas/trust-profile.schema.json`), travelling on
  the relationship channel of its tuple; the artifacts carry
  their own MACs, the documents carry none — one carrier.
  **Defined effect, per document:** durable buffering toward the
  recipient's receive chain — for a star or group-star chunk,
  into the single open assembly of its artifact (Trust Layer §5.2a,
  §5.2b); the acknowledgement fires at
  that effect like every type's (4.2), under the class rule
  below — **with one sharpening for the completing chunk**: the
  chunk that closes an assembly has as its defined effect the
  **validated, committed assembly** — assembly validation
  (Trust Layer §5.2a), the accepted snapshot, and the receiver's
  completed-salt advance commit in the same transaction as the
  effect cache entry and the acknowledgement (6.2) — and for star
  and group-star chunks the stage-9 lock set extends by the
  **assembly key (tuple, type, salt)**, so concurrent chunks of
  one assembly serialize and the completing commit sees them all. A crash
  before that commit leaves the completing chunk unacknowledged,
  so a sender's completion (Trust Layer §5.4) always attests the
  receiver's committed state, never a buffered fragment. **Closed acceptance bindings:** the outer document's
  `issuer` MUST equal the sender's pair anchor of the tuple and
  its `recipient` the addressee's; the tuple is selected by the
  arrival channel's `rkid`, and the artifact's MAC MUST verify
  under exactly that tuple's relationship key — an outer/inner
  mismatch rejects. For the star and the group star, **one
  `salt` is one thread**: the sender mints one fresh `threadId` per delivery and stamps it on
  **every** chunk of that salt — arrival order is irrelevant, and
  the receiver rejects a delivery whose chunks disagree on
  `threadId` (Trust Layer §5.2a); each chunk is its own **document** under
  this contract's dispositions and earns its own acknowledgement —
  "delivery" in this entry always means the salt-level unit.
  A retried chunk is re-sent **byte-identical as a document**
  (threadId included), per 4.2's redelivery rule — re-packaging a
  chunk under a new threadId is nonconformant. A chunked star
  delivery (Trust Layer §5.2a) is one document per chunk under one
  `salt`; each chunk is its own **document** under this
  contract's dispositions, and what "the delivery completed"
  means for the sender's reconciliation state is Trust Layer
  §5.4's definition over the acknowledgements.

**The acknowledgement class rule (normative, for every registered
type):** an acknowledgement MUST NOT be more provable than the
payload it acknowledges. For a type whose payload authenticity is
a transferable signature, the `delivery-ack` carries its standard
proof. For a type whose payload authenticity is
designated-verifier — the trust-layer family above,
`continuity-probe/0.1` and `continuity-mapping/0.1`, `message/0.1`,
and every future MAC-authenticated type — the `delivery-ack`'s `proof` is
the **MAC form of 4.2**, under the arrival tuple's ack key: one
channel-keyed regime for every DV-type ack, independent of the
payload's internal MAC structure. Deniable, receiver-forgeable
exactly as the payload is, verifiable by the sender alone. The ack
still fires at the defined effect (4.2, §11) — only its proof form
follows the payload's audience class. A document whose evaluation
records no defined effect has nothing for the acknowledgement to
fire at and earns none (`discarded`, `failed(rate-limited)`, 6.2).

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
Trust Layer §6.4): a higher `revision` wins; an equal revision
with JCS-identical payload is idempotent; an equal revision with
a different payload is an equivocation error — reject, keep
state; a lower revision is rejected — so a delayed or redelivered
older declaration can never roll a value back. A replacement is
prospective, never retroactive for a running act. **Roles and
their constants are named by the registering specification**: the
role URI is the type URI of the task the party serves as
receiver — for the introduction mediator,
`https://real-life.org/trust-tasks/spec/introduction-request/0.1` —
and the registering specification closes which constant names a
role admits and their domains; unknown constant names or
out-of-domain values reject the declaration. The first
registration: `ack-delay`, a duration in the grammar this section
fixes below, `PT1S ≤ ack-delay ≤ PT1H` (Trust Layer §8.4). **This declaration IS
the "task registration entry" Trust Layer §8.4 publishes from** —
that entry's per-party published form; one mechanism, two names.
**Act binding and revision skew, stated honestly:** each side of a
running act computes from the declaration it holds — the mediator
from its own current value at the act's arrival, the requester
from the highest revision it holds at send. A revision landing
between the two is safe by construction: the requester's early
`failed` is Trust Layer §8.4's named role divergence, converged by
the retry as a new act; a mediator that raises its `ack-delay`
SHOULD expect such retries until the new declaration reaches its
contacts. **A party MUST declare identical constants to all
counterparts** ("per party, fixed"); the declaration is
transferably signed for exactly this reason — two counterparts
comparing declarations hold attributable proof of an
equivocation. The first registered constant is the introduction
mediator's `ack-delay` (Trust Layer §8.4): a requester computes
its verdict window from the mediator's declared value and MUST
NOT send an `introduction-request` to a mediator whose
declaration it does not hold — asking first is the flow, not an
error path.

**The carrier role: what a carrier declares, and what it
guarantees (normative).** A **carrier** (Section 5a) serves no
task type — and its declaration therefore needs a role key that
is not one (round-44 B-1): **a carrier declares its constants in
a `registry-declaration/0.1` whose `role` is byte-equal to
`https://real-life.org/trust-tasks/spec/delivery-carrier/0.1`.** That
URI names the carrier **role**, and only the role: it has the
Type URI form so that one pattern governs every `role`, names no
specification, and used as a document `type` it stays
`failed(unknown-type)` (Section 11),
because a carrier is nobody's document counterparty. Constants
for this role declared under any other `role` URI are not a
carrier declaration, and a counterpart MUST NOT treat them as
one — without this rule, two counterparts could hold different
entries as authoritative and the first guarantee below would not
be byte-decidable. It is below the port line, it is nobody's document
counterparty, and **how it manages its own storage, its own rate
limiting and its own denial-of-service defence is its business,
not this contract's.** Nineteen review rounds were spent
specifying that machinery here, and the specification of it never
belonged in a protocol: every carrier that runs will do it
differently, and none of it is what a counterpart observes.

What a counterpart *does* observe, and what this contract
therefore fixes, is five things.

1. **A carrier publishes the constants a counterpart plans
   with**, in a transferably signed declaration (the form above).
   **For these seven, the declaration binds**: a carrier MUST NOT
   enforce a value stricter or looser than it published, and MUST
   NOT hold a counterpart to a constant it did not publish. Its
   remaining private limits reach the port line **only** as
   guarantee 2's retriable refusals — never as a terminal
   verdict, and never as a silently different value for a
   published constant (round-44 B-3: an earlier wording read as
   if no unpublished value could influence any outcome, which
   guarantees 2 and 3 plainly contradict). The seven are `orphan-horizon` and `give-up-horizon` (how long
   a holder may be away, and how long a deposit lives — 5a.9),
   `challenge-lifetime` (how long an issued challenge is good
   for — 5a.3), `queue-floor` and `max-queue-bytes` (guarantee 5),
   `max-binding-tombstones` (how many released addresses keep
   their anti-resurrection record — 5a.3), and `status-horizon`
   (below). Every other limit a carrier keeps
   is **unpublished by design**: publishing occupancy is
   publishing occupancy.
2. **Refusals for a carrier's own limits exist, are marked
   `retriable`, and say nothing about any party.** The family is
   closed and split across the two closed sets: on registration,
   `registration-refused(capacity)` and
   `refused(admission-resource)` (5a.3); on submission,
   `refused(admission-resource)`, `refused(queue-saturated)` and
   `refused(capacity)` (5a.5) — and **which member answers is not
   the carrier's choice**: the evaluation orders of 5a.3 (r1–r5)
   and 5a.5 (s1–s6) name it (round-45 B-2: an earlier wording
   listed two of the five, and a carrier could have read the
   other three as forbidden or as free variants). A carrier that
   refuses with a reason about *who* asked has left this
   contract, and a carrier that marks any of these terminal has
   misreported its own state.
3. **No asymmetric operation before the decision to spend on
   it.** A carrier MUST decide whether it will serve a request —
   against whatever budget it keeps — **before** performing any
   randomness, sealing, or asymmetric key operation for it. This
   is the one resource rule that is protocol-shaped rather than
   local: 5a.3 has the carrier seal a challenge before it knows
   anything about the requester, so a carrier that seals first and
   counts afterwards can be made to do unbounded work by an
   unauthenticated party. What it counts is its own affair; the
   **order** is not.
4. **Traffic for other addresses cannot starve a binding the
   carrier holds.** A request that names an `rkid` this carrier
   has a `live` or `closing` binding for MUST NOT be refused
   because requests for *unknown* addresses have exhausted
   something — **at any step of an evaluation order, r2 and r4
   alike** (round-44 B-2: an admission meter drained by
   unknown-address traffic that then refuses a held binding's
   rebind at r2 is exactly the starvation this guarantee
   forbids). Whatever a carrier reserves or meters, it arranges
   so that this holds; the guarantee is the requirement, the
   arrangement is its own.
5. **A queue below its declared `queue-floor` is beyond the
   reach of every other queue.** A submission whose post-admission
   occupancy stays within the floor MUST NOT be refused for
   global occupancy (s6) **and MUST NOT be refused because
   traffic for *other* queues drained a meter** (s4) — the same
   cross-traffic rule as guarantee 4, in the submission direction
   (round-45 B-1: an earlier wording said its admission "depends
   on nothing but itself", which overclaimed — the queue's **own**
   metering may refuse it, retriably, and that is the DO-6
   residual: the party spending a queue's own budget holds its
   address). Above the floor, a carrier may refuse with
   `capacity` like anywhere else. `queue-floor ≤ max-queue-bytes`
   and both are published, so a holder knows what it can rely on
   and what it is merely hoping for.

**What this contract deliberately does not answer**, and records
as open rather than half-building: nothing in it authenticates a
*depositor*, so anyone who learns an `rkid` may spend a queue's
own budget (Section 12, DO-6). Guarantees 4 and 5 bound what that costs
the rest of a carrier; they do not stop it, and no arrangement of
local limits will, because the gap is the absence of a
sender-side gate rather than the size of any limit.


- **`status-horizon`** — a duration in this section's grammar,
  `PT5S ≤ status-horizon ≤ PT5M`, within which an adapter that has
  been handed a submission MUST report **some** honest state for
  it to the party it serves. **Every** delivery adapter owes it,
  sending side included — but only the **carrier's** travels in
  the registry, as one of its seven under the carrier role. A
  non-carrier adapter serves its **own** principal, so its
  `status-horizon` is declared to that principal by whatever
  configuration surface the adapter has, and it appears in no
  registry (round-46 B-1: an earlier sentence parked every
  adapter's value "under the carrier role", which made identical
  declaration bytes acceptable as a complete non-carrier
  declaration and rejectable as an incomplete carrier one — a
  declaration under the carrier role URI either carries all
  seven constants or rejects, and nothing else ever stands under
  that URI).

  **Field provenance, because this constant exists for a
  reason.** A single-broker WebSocket adapter with no connect
  timeout left a socket in CONNECTING for roughly **forty
  minutes**, and for those forty minutes the sender received no
  status of any kind — not a failure, not a wait, nothing (field
  record wot#355/#357, follow-on wot#359). Nothing in this
  contract was violated, which was the problem: §7 says delivery
  time is unbounded, and no rule said anything about *statuslessness*.

  **The distinction this constant draws, stated so it cannot be
  read as a retreat:** *delivery* time stays unbounded and still
  never affects validity (§7, Encounter 1.3) — what is now bounded
  is the time a submission may spend with **no honest report at
  all**. A submission may legitimately be un-delivered for weeks;
  it may not be un-*described* for more than `status-horizon`.
- **An offline sender never violates this**, and the rule is built
  so that it cannot: what must be reached within the horizon is a
  **state**, not a success. `failed(…)` satisfies it, `accepted`
  satisfies it, and so does an honest **pre-transport report** —
  which is not a fourth status of the §6.1 trias but a statement
  about the adapter's own situation, from the closed set
  `awaiting-transport(offline)` ·
  `awaiting-transport(transport-unreachable)` ·
  `awaiting-transport(carrier-refused-retriable)` (the last is
  where 5a.5's retriable refusals surface). A device in a tunnel
  reports the first of these immediately and conforms; the forty
  silent minutes do not.


**How the published constants are written, and how they are read
(normative).** The values above travel as **value strings** in a
signed declaration, so two carriers must not be able to read one
declaration differently. Three rules, and none of them is new
work:

- **Integers** are canonical decimal in `[1, 2^53-1]`: no sign, no
  leading zero, no exponent, no fraction. A verifier compares the
  **received bytes**, not a parsed number — `1`, `1.0` and `1e0`
  parse alike and are not alike here, and Identity §7a.3 learned
  this for `generation` before this section learned it for these.
- **Durations** use the grammar of Access §7.3 — the day-and-time
  subset of ISO 8601, both parts optional, no fractional
  component — and this contract defines no second grammar. A
  value outside it is **rejected, never rounded**: an
  implementation that rounds a duration it cannot represent has
  made two carriers disagree about the same declaration.
- **Every decision these constants drive is atomic**: a
  counterpart sees the state before or the state after, never a
  carrier midway through its own bookkeeping. What the bookkeeping
  is remains the carrier's affair; that it is not observable
  half-done is not.


### 4.5 Declarations

**RLTP-DEL-4510** — The four types of 4.1 to 4.4 and the Trust
Layer's types of 4.4 declare, under RLTP-DEL-3020, the values below.
Every Type URI is `https://real-life.org/trust-tasks/spec/` followed by
the type's slug and version as named in the first column; every type
is at maturity level `draft`.

| Type | `issuer` · `recipient`, `identifierScope` | Proof (item 8) | Side effects (item 13) | `ingests` (item 14) | Retention (item 18) | Size bound |
|---|---|---|---|---|---|---|
| `encounter-bundle/0.1` | scanner · displayer; `pairwise` · `pairwise` | absent | `mutating` | `personal` | `durable` | 65 536 |
| `delivery-ack/0.1` | the acknowledged document's recipient · its issuer; `any` · `any` | REQUIRED | `mutating` | `none` | `exchange` | 65 536 |
| `encounter-credential-delivery/0.1` | credential issuer · credential subject; `pairwise` · `pairwise` | absent | `mutating` | `personal` | `durable` | 65 536 |
| `registry-declaration/0.1` | declaring party · counterpart; `any` · `any` | REQUIRED | `mutating` | `metadata` | `durable` | 65 536 |
| `star/0.2` | sender · addressee, pair anchors of the tuple; `pairwise` · `pairwise` | absent | `mutating` | `personal` | `durable` | 65 536 per chunk |
| `group-star/0.1` | as `star/0.2` | absent | `mutating` | `personal` | `durable` | 65 536 per chunk |
| `anchor-mapping/0.3` | as `star/0.2` | absent | `mutating` | `personal` | `durable` | 65 536 |
| `profile/0.1` | as `star/0.2` | absent | `mutating` | `personal` | `durable` | 65 536 |
| `continuity-probe/0.1` | sender · addressee on the enactment tuple; `pairwise` · `pairwise` | absent | `mutating` | `metadata` | `exchange` | 65 536 per chunk |
| `continuity-mapping/0.1` | as `continuity-probe/0.1` | absent | `destructive` | `personal` | `durable` | 65 536 |
| `introduction-request/0.1` | requester · mediator on their tuple; `pairwise` · `pairwise` | absent | `mutating` | `personal` | `exchange` | 65 536 |
| `introduction-forward/0.1` | mediator · target on their tuple; `pairwise` · `pairwise` | absent | `mutating` | `personal` | `exchange` | 65 536 |
| `introduction-reply/0.1` | target · mediator, then mediator · requester, each on that leg's tuple; `pairwise` · `pairwise` | absent | `mutating` | `personal` | `exchange` | 65 536 |
| `introduction-ack/0.1` | mediator · requester on their tuple; `pairwise` · `pairwise` | absent | `mutating` | `none` | `exchange` | 65 536 |
| `introduction-voucher/0.1` | mediator · each side on that side's tuple; `pairwise` · `pairwise` | absent | `mutating` | `metadata` | `exchange` | 65 536 |

What each type does at its recipient (the rationale of item 13) and
what a consumer holds to interpret it (item 15):

| Type | Effect | Authorization evidence |
|---|---|---|
| `encounter-bundle/0.1` | creates the enactment record and records the accepted credential (4.1) | the recipient's own challenge the credential binds, resolved from its holder state (Encounter 5.3), and the pair anchor its displayed card names |
| `delivery-ack/0.1` | updates the sender's status of one document it sent, nothing else (4.2) | the sender's own record of the acknowledged document on that thread |
| `encounter-credential-delivery/0.1` | buffers the credential for Encounter acceptance (4.3) | the enactment record and the challenge it binds (Encounter 5.6) |
| `registry-declaration/0.1` | records a party's constants per (issuer, role) under the revision rule (4.4) | none beyond the relationship: a party declares for itself alone |
| `star/0.2`, `group-star/0.1` | buffers a chunk into its assembly; the completing chunk commits the snapshot and the salt floor (4.4) | the arrival tuple and its relationship key, from the recipient's holder state |
| `anchor-mapping/0.3` | writes the sender's chain state for the addressee (Trust Layer §6.1, §6.4) | the arrival tuple and the held lineage |
| `profile/0.1` | replaces the profile held for the tuple by a newer revision (Trust Layer §6b) | the arrival tuple and its relationship key |
| `continuity-probe/0.1` | buffers the probe and raises the completed-probe floor (Trust Layer §6a.2) | the enactment tuple |
| `continuity-mapping/0.1` | chains the new relationship to the prior one, see below (Trust Layer §6a.4) | the enactment tuple and the prior relationship's key |
| `introduction-request/0.1`, `introduction-forward/0.1`, `introduction-reply/0.1` | enters or advances the act state of the introduction (Trust Layer §8) | the act the holder holds and the tuple of each leg; the request rests on the mediator's declared `ack-delay` (4.4) |
| `introduction-ack/0.1` | moves the requester's act from `sent` to `acked` (Trust Layer §8.4) | the act the requester sent |
| `introduction-voucher/0.1` | holds the voucher for the act's match (Trust Layer §8.5) | the act the side holds |

Every row declares `discloses: none` and `actsAsSubject: false`
(RLTP-DEL-3020). The rationales the framework requires:

- **Proof.** REQUIRED where the document is the only carrier of
  its authenticity (1.1): the acknowledgement, relied upon by its
  sender, and the declaration, relied upon by every counterpart that
  compares it with another (4.4). Absent everywhere else, because the
  payload carries its own signatures or MACs and a second carrier
  could diverge from the first (1.1). The declaration "absent" is
  outside the framework's item-8 vocabulary (Section 12, DO-10).
- **`pairwise`.** An encounter's anchors are fresh pair anchors of
  the enactment (Encounter §4.4); the Trust Layer's types travel on
  one tuple, whose pair anchors the outer document carries (the
  closed acceptance bindings of 4.4, Trust Layer §6a.3 and §8.1).
- **`any` for `delivery-ack/0.1`.** The acknowledgement's parties are
  the acknowledged document's, reversed; its scope is that
  document's, and the type itself takes no position.
- **`any` for `registry-declaration/0.1`.** Which anchor a declaring
  party signs under is not settled (Section 12, DO-11).
- **`destructive` for `continuity-mapping/0.1`.** Its verified effect
  on the side without the record appends the chain and deactivates
  the prior active head, atomically and irreversibly; the side with
  the record freezes its choice (Trust Layer §6a.4, §6.4).
- **`ingests: personal`.** The bundle carries the scanner's card
  (self-declared name, delivery hints) and a credential stating an
  encounter; the credential delivery a credential stating an
  encounter; the star a person's contact set and the group star
  a person's group memberships, both blinded; the anchor mapping
  links a pair anchor to a person's community anchor; the profile a
  person's name, image and text; the continuity mapping links two
  contexts of one person; the introduction request, forward and
  reply carry a person's name, note and card.
- **`ingests: metadata`.** The declaration carries a role's
  constants; the continuity probe blinded, padded values that match
  only for a counterpart sharing history; the voucher two fresh pair
  anchors.
- **`durable`.** The bundle and the credential delivery: the
  accepted credential and the enactment record, kept for the life of
  the relation (Encounter 5.5), because recording the encounter is
  what the task is for. The declaration: the record per (issuer,
  role), held so that counterparts can depend on it and prove an
  equivocation (4.4). The star and the group star: the accepted
  snapshot and the completed-salt floor per tuple (Trust Layer
  §5.2a, §5.2b). The anchor mapping and the continuity mapping: the
  chain state they write (Trust Layer §6.4). The profile: the newest
  revision per tuple (Trust Layer §6b).
- **`exchange`.** The acknowledgement: the completed-effect cache
  entry and the stored acknowledgement, held `key-retention` (4.2).
  The continuity probe: the assembly and the completed-probe floor.
  The introduction types: the act's state until its lifetime ends
  (Trust Layer §8).

**Free-text members (item 19).** Each is bounded by its schema, read
by the recipient's person, and stated by the party whose proof or MAC
covers it, to whom every rendering attributes it: a card's `name`
(at most 200 characters, self-declared, Encounter RLTP-ENC-6090 and
RLTP-ENC-6120) and its `deliveryHints` (at most 8 of at most 512
characters, read by the delivery adapter, opaque); an encounter
credential's `channel` (at most 64, informative); a profile's `name`
and `text` (at most 64 and 256); an introduction request's
`displayName` and `note` (at most 64 and 256), which the forward
carries unchanged. The other types carry no free text.

### 4.6 `sealed-envelope/0.1`

The form in which a carrier that carries Trust Task documents carries
a sealed envelope (Section 5): the envelope is the payload of a
document of this type. A consumer of the carrier's binding that does
not know RLTP reads the document's `type` and parties without opening
the seal, and can refuse it or answer it by the framework's rules; the
recipient's carrier takes the envelope out and hands it to the
receive of 6.2 (RLTP-DEL-5030). It is the one type whose documents
are never sealed: they travel inside their carrier's own end-to-end
protection, and they carry nothing the seal does not already carry
but the parties of the carrier and the instant of submission.

**RLTP-DEL-4610** — A producer writes a `sealed-envelope/0.1` document
with exactly the members `id`, `type`, `issuer`, `recipient`,
`threadId`, `issuedAt` and `payload`:

- `type` — `https://real-life.org/trust-tasks/spec/sealed-envelope/0.1`;
- `issuer` — the identifier under which the carrier authenticates the
  sending side as the sender of the message that carries the
  document, and `recipient` — the identifier of the receiving side to
  which that message is addressed; both Ed25519 `did:key` identifiers
  of the carrier's, per relationship and carrier (for the VTI
  mediator adapter, the two sides' connection DIDs);
- `payload` — the sealed envelope, per
  `schemas/payload-sealed-envelope.schema.json` (whose `$id` is the
  Type URI and which refers to `schemas/sealed-envelope.schema.json`);
- `id` — per RLTP-DEL-4620, and `threadId` equal to `id`;
- `issuedAt` — the instant of the envelope's first submission as the
  sender recorded it (for an acknowledgement, the commit of its
  effect), in whole seconds with `Z`;
- `proof` and `expiresAt` — absent; a consumer refuses a document
  that carries either. A `ceremony` member is never written; a consumer
  that finds one passes it through unread (Section 3, TT §4.11.1),
  and the profile's recomputation of `ceremony.enactment` has no
  enclosed material here and does not apply.

**RLTP-DEL-4620** — The `id` is a UUID of version 8 (RFC 9562 §5.8):
the first 16 bytes of SHA-256 over the ASCII string
`rltp/v1/sealed-envelope-id` followed by the UTF-8 JCS serialization
of `{ "issuer", "recipient", "seal" }` — the document's two parties and
its payload — with bits 48 to 51 set to `1000` (the version) and bits
64 and 65 set to `10` (the variant), written as 32 lower-case
hexadecimal digits in the groups 8-4-4-4-12. A receiver reads the
`id` as it arrives and attaches no disposition to its derivation.

**RLTP-DEL-4630** — `sealed-envelope/0.1` declares, under
RLTP-DEL-3020:

| Declaration | Value |
|---|---|
| Parties (item 5) | sender's carrier identifier · recipient's carrier identifier; `pairwise` · `pairwise` |
| Proof (item 8) | absent |
| Repeated execution (item 11) | safe and intended |
| Side effects (item 13) | `destructive` |
| Exposure (item 14) | `discloses: none`, `actsAsSubject: false`, `ingests: personal` |
| Authorization evidence (item 15) | the carrier's authentication of the sender; nothing beyond it |
| Execution checkpoint (item 16) | one: the hand-over of the sealed envelope to 6.2 |
| Retention (item 18) | `transient` |
| Free text (item 19) | none |
| Size bound | 90 112 bytes |

The rationales the framework requires:

- **Proof absent.** The carrier authenticates the sender end to end
  (TT §4.7.2): a TSP message is signed by its sender and sealed to its
  receiver, and the carrier holds the document's parties against both
  (RLTP-DEL-5030). The document is not kept, so no third party relies
  on it later. A proof would also make every framework consumer
  without a configured verifier refuse the document before reading
  its type. The declaration "absent" is outside the framework's
  item-8 vocabulary (Section 12, DO-10).
- **Repeated execution safe and intended.** Executing the document
  hands its sealed envelope to 6.2, whose stage 4 absorbs every
  repeated envelope by the digest of the document inside it; a repeat
  has no second effect. Every repeated submission is byte-identical
  (RLTP-DEL-5040), so a framework consumer sees a duplicate of an
  equal `id`, never a conflict.
- **`pairwise`.** The carrier's identifiers are per relationship and
  carrier (5a.10).
- **`destructive`, `ingests: personal`.** The effect and the content
  are those of the document inside, which may be of any registered
  type; the most consequential, `continuity-mapping/0.1`, deactivates a
  relationship's head irreversibly (4.5), and several types carry a
  person's data. The outer document itself changes nothing and
  carries nothing a consumer can read but its members.
- **`transient`.** Nothing of the document is kept: the carrier hands
  the envelope on and discards the rest. What the document inside
  leaves behind is its own type's retention.

A consumer that refuses a document of this type answers with the
framework's `trust-task-error` (0.4, 0.5 or 0.6, the versions the VTI
mediator adapter profile reads, its RLTP-VTI-5015); one that
understands it and cannot complete it in isolation, with
`trust-task-next-step/0.1`. Both answer
the document by its `id` (`inResponseTo.id`, or `threadId`), and
both are read and applied by the carrier adapter (VTI mediator
adapter profile §5); RLTP sends neither in this casting. A next step
makes the document `held` (RLTP-DEL-6140).

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
  therefore declare their horizon. What remains of a key after its
  private key is deleted depends on its class (below).

**Two classes of key-agreement keys.** A recipient's key-agreement
keys fall into two classes by the role they serve. An **address
key** serves as the `rkid` of one relationship or one act and
retires when that use ends: the key of a card the holder displayed
or sent, which is the address of one relationship (5a.2). A **key
of an identity context** is the key-agreement key of a context the
holder derives again, under the same label, whenever it needs that
context (Identity §6.1): today the member key of a `group/` context,
to which the invitations and accepts of one group are sealed
(Membership Tasks 1.2). The retention rule above holds for both
classes; a registering specification may require longer
(Membership Tasks RLTP-MT-3090).

**RLTP-DEL-5010** — When a holder deletes the private key of an
address key, it MUST keep the key's `rkid` as a tombstone, so that a
later envelope sealed to it passes stage 2 of 6.2 as known and fails
at stage 3 as `failed(decryption-failed)`.

**RLTP-DEL-5020** — A holder MUST NOT keep as a tombstone the `rkid`
of a key of an identity context; once it no longer holds such a key,
the `rkid` is unknown at stage 2 (`failed(malformed)`) until the
holder derives the context again.

*Rationale.* A tombstone is the `rkid` value alone, a few bytes per
address ever issued, and it keeps the disposition honest: an envelope
sealed to a retired address reaches decryption and fails there, never
as `malformed`. An identity context is different in kind. The same
derivation serves the same group whenever the holder is invited to it
again, so a tombstone would make the holder refuse, at stage 3, the
documents of its own next membership, and the promise a tombstone
makes, that the private key is gone for good, cannot be kept by a key
the holder will derive again. What an unknown identity-context key
reveals, and to whom, is stated in Section 9.

A **shipped test vector** (`vectors/seal.json`) fixes recipient key,
ephemeral key, nonce, plaintext, ciphertext, and document digest;
implementations MUST reproduce it byte-for-byte. The vector's
plaintext document is a **seal-only sample** (type
`…/spec/seal-vector-sample/0.1`, never a wire type): it exercises this
section's construction, not the document profile, and MUST NOT be
processed as a delivery document.

No channel authentication is required or assumed **of a sender**:
confidentiality comes from the seal, authenticity from the
payloads' own proofs — signatures or designated-verifier MACs —
bound to anchors by the Layer-1 binding rule. This
is a decision, not an omission, and 5a.4 states it as one. The
**recipient** side is the exact opposite and always has been:
registering, collecting from, and concluding a queue are
authorized acts under a control principal, and 5a.3 fixes the
proofs they require. The two are not in tension — they are the
asymmetry the whole section rests on: anyone may put something
into a queue, and exactly one party may take it out.

**Carriage in a Trust Task binding.** A carrier whose own protocol
carries Trust Task documents (a binding of the framework's registry)
carries the sealed envelope in a document of that kind, so that the
carrier's own consumers can read it.

**RLTP-DEL-5030** — A carrier that carries documents as Trust Task
documents MUST carry every sealed envelope as the payload of a
`sealed-envelope/0.1` document (4.6), and MUST carry nothing else as
such a payload. On receipt it MUST hold the document's `issuer` and
`recipient` against the sender it authenticated and the receiving
identifier, exactly as strings, and check the document against the
profile (Section 3, 4.6); a document that passes is taken apart and
its payload, in its JCS serialization, handed to the recipient's
receive (6.2) as the sealed envelope. The carried document does not
pass 6.2 itself: no stage reads it, it has no digest, earns no
acknowledgement and no cache entry, and a document that fails a check
delivers nothing.

**RLTP-DEL-5040** — The carried document MUST be a function of the
sealed envelope, its `issuer`, its `recipient` and the instant of the
envelope's first submission alone, carried as its JCS serialization:
every repeated submission of one sealed envelope to one recipient
under one pair of carrier identifiers carries it byte-identical, and
the same `id` (RLTP-DEL-4620).

*Rationale.* A sender re-offers a sealed envelope byte-identical
(RLTP-DEL-6120), and the receiver absorbs it by the digest of the
document inside (6.2 stage 4). A framework consumer deduplicates by
the outer document's `id` and treats a second document under an equal
`id` as a conflict (TT §7.2 item 11); fixing the outer document by the
envelope makes the two rules meet: a repeat is a repeat on both sides,
and an answer finds its document by the `id` without the sender
storing anything new. A change of a carrier identifier — a rebind, a
change of carrier — yields a new `id`.

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
| **control principal** | the recipient | the carrier | Identity §7a, 5a.3–5a.10 |

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
exists to prevent, wearing a helpful face. **What makes this rule
enforceable rather than merely stated is 5a.3**: the carrier does
not take the claim "this is my relationship's address" on trust,
because it cannot check it by computation — it requires it to be
proved.

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

### 5a.3 Registration proves possession, of both halves (normative)

5a.1 states the binding rule — a principal registers only the
`rkid`s of **its own** relationship — as a duty of honest
behaviour. Duty is not enough here: an `rkid` is a **public**
value. A sender sees it, a carrier sees it on every envelope, and
anyone who holds a contact card holds one. If registration were a
mere assertion, whoever observed an `rkid` could register it under
a principal of their own — a perfectly well-formed principal,
since principals are derived, not issued — and the carrier could
not tell the two claims apart, **because 7a.5's first prohibition
deliberately removed every computable relation between a principal
and the addresses it registers**. The consequence is not
confidentiality loss (sealing is to the `rkid`; the attacker
decrypts nothing) but queue hijack: collecting, concluding, and
thereby discarding another person's deliveries.

The binding cannot be **computed** — that is the privacy
property — so it MUST be **proved**:

> **A carrier MUST NOT bind an `rkid` to a principal without,
> in one exchange, a valid proof of possession of the
> principal's Ed25519 private key and a valid proof of possession
> of the `rkid`'s key-agreement private key.** A registration
> presenting one proof, or neither, is refused.

- **Principal possession** is a signature under the principal over
  a carrier-issued challenge — Access §7.3's proof of possession,
  adopted unchanged.
- **`rkid` possession** cannot be a signature: an `rkid` is an
  X25519 key-agreement key and signs nothing (Section 5, Identity
  §7a.1). It is proved by **decryption instead**: the carrier
  seals a second challenge to the `rkid` using exactly the
  envelope construction of Section 5, and the registrant returns
  the opened challenge value. Only a party holding that `rkid`'s
  private key can open it, and no observer of the wire, past or
  present, can.

**The proof exchange, byte-precisely.** The signed object is a
**versioned artifact whose `v` constant is inside the signed
bytes**, in the shape Access §7.3 already uses:

```json
{ "v": "rltp-carrier-proof/0.3",
  "type": "carrier-registration-proof",
  "purpose": "register",
  "carrier": "did:web:carrier.example",
  "principal": "did:key:z6Mk…",
  "rkid": "z6LS…",
  "generation": 1,
  "principalChallenge": "…43 base64url characters…",
  "addressChallenge": "…43 base64url characters…",
  "sig": "…" }
```

- **The signature input is the JCS serialization (RFC 8785) of
  this object with `sig` omitted**, and the signature is Ed25519
  under `principal`. JCS fixes field order, escaping, and number
  form, so the bytes are a function of the values and of nothing
  else. `sig` itself is canonical base58btc with the `z` multibase
  prefix, exactly 64 signature bytes, by the rule Encounter §2.3
  imposes on every signature of this stack: a shortened or
  non-canonical rendering is not a signature.
- **`v` is the domain tag and it is inside the signed bytes.**
  `rltp-carrier-proof/0.3` appears in no other signed artifact of
  this stack, so a signature made here verifies as nothing else,
  and no signature made elsewhere verifies as this. A verifier
  MUST reject an object whose `v` is not byte-equal to the
  constant.
- **`purpose`** is a closed set: `register` · `rebind` ·
  `collect` · `conclude`. It is part of the signed bytes, so a
  proof made for one purpose is not a proof for another — a
  collection authorization can never be replayed as a
  registration. For `register` and `rebind` every field above is
  REQUIRED. For `collect` and `conclude`, **`rkid` is REQUIRED
  too** — it names the queue the act works on, inside the signed
  bytes, because a relationship may hold several addresses at one
  carrier and a proof that named none would let two conformant
  carriers answer identical bytes differently. What stays
  **absent** in those two purposes is `generation` and
  `addressChallenge` — those acts are authorized per session
  against a binding that already exists and change no
  succession — and their absence is part of the JCS bytes like
  everything else.
- **`generation` carries the register's succession to the
  carrier, and the carrier enforces it.** It is the `generation`
  of the holder's carrier-nonce entry (Identity §7a.3), an integer
  in that section's domain `[1, 2^53 − 1]`. Without it, possession
  alone would decide which principal holds an address — and
  possession is **not** monotone: a device restored from an older
  backup still holds the root IKM, the older nonce and the
  `rkid`'s private key, so it could prove everything a rebind
  requires and roll the binding **back** to a principal the
  register had already superseded. So:

  > **A rebind binds only with a `generation` strictly greater
  > than the one recorded for the current binding** — the
  > `live`/`closing`/`released` rows of the outcome table below
  > carry the equal and lower cases. The carrier cannot decide a
  > tie the register decides by nonce bytes, and fails closed
  > rather than guessing.

  This contract carries **no tie-breaker**: a tie value that
  travelled would have to be derivable identically by both
  devices, authentically bound to its derivation, and analysed
  for what it leaks to a carrier that also sees the principal and
  the address. No such construction is designed here; whether a
  safe one exists is Section 12's DO-7, and the refusal rule does
  not depend on the answer.

  **`refused(stale-generation)` carries the generation the
  carrier holds for that `rkid`.** This is a disclosure and it is
  stated as one: the verdict is reachable only by a request that
  has **already** cleared both possession proofs. What the number
  is for is **ordering**, not access — a party who can open the
  sealed challenge may rebind at any higher generation whether or
  not it knows the current one, so the generation was never a
  barrier — while *withholding* it would break Identity §9.3's
  promise, because a holder who lost their carrier entry has no
  other way to learn what to exceed. A carrier MUST include it;
  it discloses nothing to anyone who has not already proven they
  may take the binding.

  **A refusal at an equal generation is a wait state, not an end
  state.** Two partitioned devices can honestly create nonces at
  the same generation; the register converges deterministically
  on one (Identity §7a.3), the canonical device is refused at the
  carrier — same generation, different principal — and **it
  rotates**: `generation + 1` wins the register by construction
  and binds by strict monotonicity. One extra rotation, no new
  instrument. At the very top of the generation domain, where
  Identity §7a.3 forbids further rotation, the incumbent binding
  simply **stands and stays collectable** — entries are
  superseded, never deleted, so every device retains the losing
  entry and can derive its principal. What the tie costs there is
  only the ability to change *which* of two principals holds the
  binding, and at that point there is nothing left to change it
  for. (A corner on the order of a hundred million years of
  per-second rotation away — written down so the domain has no
  undefined cell, not because anyone will stand in it.)

  **A superseded generation buys no new authorization — and no
  less than it has.** A principal whose generation the register
  has superseded but which the carrier is still bound to keeps
  working: it collects, it concludes, and it holds its queue
  until a proof carrying a strictly greater generation rebinds
  the address. What it cannot do is **register, rebind, or
  resurrect**: it cannot take an address it does not already
  hold, cannot displace a higher generation, and cannot re-enter
  after release. Supersession is a statement about succession,
  not about a live binding's ability to serve.

  **And the memory outlives the binding.** On releasing a binding
  (5a.9), a carrier MUST retain, per `rkid`, the **highest
  generation it ever accepted** for it — the **binding
  tombstone** `(rkid, generation)` — and MUST refuse any later
  registration for that `rkid` whose `generation` is not strictly
  greater. Without it, a superseded generation could return by
  waiting for the release: resurrection by patience rather than
  by force. A tombstone has **no expiry in time**; it leaves in
  exactly two ways — a registration carrying a strictly greater
  generation **consumes** it, or the store's declared bound
  **evicts** it. The first draft of this casting made eviction a
  free storage decision, and that re-opened a divergence this
  loop had closed long before (round-43 B-2, rounds 15/19): with
  the bound private and the order a SHOULD, two carriers with
  identical observable histories could answer the same old proof
  `refused(stale-generation)` and `registered` — an authority
  difference, not a bookkeeping one. So both halves are
  promise-shaped and normative again, **without** prescribing the
  mechanism that implements them:

  > **`max-binding-tombstones`** is a declared constant (4.4
  > guarantee 1) — an integer in `[1, 2^53 − 1]`: how many
  > binding tombstones this carrier retains. Whenever the store
  > exceeds the declared bound, the carrier MUST evict **the
  > longest-released** tombstone, ties broken by ascending
  > unsigned bytewise order of the decoded `rkid` key bytes — a
  > total order over facts the carrier already holds — until the
  > store is within it. That covers both ways the bound can be
  > exceeded: admitting a new tombstone at the bound, and **a
  > declaration revision that lowers the bound**, which trims the
  > store **in one linearized transition at the instant the
  > revision takes effect** (round-45 B-3: "prospective, never
  > retroactive" governs running *acts*, and a store is standing
  > state, not a running act — leaving the trim to the next
  > release would let two carriers hold different stores after
  > identical histories, the divergence this order exists to
  > remove). How an implementation realizes the order across
  > restarts is its own affair; that it holds is not.

  The consequence stays stated honestly: **for an evicted `rkid`
  the anti-resurrection guarantee ends**, and the only party that
  can use that is the holder — re-installing a superseded
  generation still needs both possession proofs, which no third
  party ever has. Eviction is reported to no one and is an input
  to no verdict about any party.

- **Both challenges are exactly 32 bytes** from a
  cryptographically secure source, carried as canonical unpadded
  base64url — exactly 43 characters, the same canonicity rule
  Section 5 applies to envelope fields. Challenges MUST be
  **single-use** — a challenge is **consumed by the first
  response attempt, before that response is verified**, so one
  challenge buys at most one verification and a failed attempt
  buys a fresh challenge, never a retry — and MUST expire on the
  carrier's declared `challenge-lifetime` (4.4): an unexpiring
  challenge is a standing forgery target.
- Issuing a challenge is work, and 4.4's guarantee 3 orders it:
  syntactic checks, then the carrier's own admission decision,
  then — only for a request the carrier has decided to serve —
  any randomness, sealing, or asymmetric operation at all. A
  carrier MUST reject a proof whose `carrier` field is not
  byte-equal to its own configured identifier (Identity §7a.2),
  whose `principalChallenge` it did not issue for this exchange,
  or whose `addressChallenge` is not the value it sealed to
  exactly this `rkid`. **And it MUST reject —
  `refused(malformed)` — a proof whose `generation` is not in the
  canonical decimal form Identity §7a.3 requires, checked on the
  received bytes and not on the parsed number**: `1.0` and `1e0`
  parse to the same number, JCS canonicalizes both to `1`, and
  the shipped signature verifies over them — nothing later in the
  exchange can catch a non-canonical spelling, and the shipped
  schema cannot express the check either. Section 11 ships the
  negatives.
- **What stays below the port line is the carriage, not the
  bytes.** How the object travels — HTTP body, DIDComm message,
  socket frame — is deliberately unspecified. What it contains,
  how it is serialized, and what is signed are fixed here.

**Outcomes are a closed, deterministic set**, in the manner of the
Replication Contract's §7.4 verdicts — a function of the proofs,
the carrier's declared constants, and its held state, and of
**nothing about the party presenting them**:

**Verdicts** — what a presenter is told:

`registered` · `registered(idempotent)` · `rebound` · `served` ·
`refused(no-such-queue)` · `refused(possession-failed)` ·
`refused(malformed)` · `refused(stale-generation)` ·
`registration-refused(capacity)` *(retriable)* ·
`refused(admission-resource)` *(retriable)*

**Internal transitions** — cells with no presenter and no
verdict, listed so that the table draws every cell from **one**
closed set and Section 11 can require exactly that:

`wind-up begins` · `obligations discharged + released` (one
transition, 5a.9) · `evicted` · `cannot arise`

**And the machine that produces them is one total table.** One
`rkid` at one carrier is in **exactly one** state:

`unbound` (no binding, no tombstone) · `live(g, P)` ·
`closing(g, P)` (5a.9's wind-up) · `released(t)` (no binding; a
binding tombstone recording the highest generation `t` ever
accepted). The tombstone store holds exactly the `rkid`s in
`released`.

**`release` is not an input of this table at all**: a release
happens only *inside* the deadline transition, so "no release
before the deadline" is enforced by the domain rather than by a
row (round-43 B-1, round-45 M-2 — a pseudo-row for a
non-existent input made the totality proof lie about its
domain). The table is entered only by a request that has already
passed **the possession proofs its operation requires** — both
halves for `register`/`rebind`, the principal proof alone for
`collect`/`conclude` (5a.3's collection rule: the same proof,
without the sealed half); `refused(malformed)`,
`refused(admission-resource)` and `refused(possession-failed)` are
decided **before** the state is consulted, **in the r1–r5 order —
syntax, then admission, then possession — for every operation**
(collect and conclude run the same order over the proofs they
carry), and are therefore not
cells; a **submission** is not an input here either — it runs
5a.5's own outcome set. `g′`/`P′` are the generation and principal
the proof carries. `registration-refused(capacity)` is a carrier
resource answer (4.4 guarantee 2) and may meet any
`register`/`rebind` request; two rules bound it rather than a
formula: **a request for a binding the carrier already holds is
never refused because traffic for *other* addresses exhausted
something** (4.4 guarantee 4), and **a return outranks an
arrival** (5a.9) — at its limits a carrier refuses the
registration that would create a new binding before the one that
resumes a binding it already holds.

**The registration-side checks run in one normative order too**
(round-43 B-3): **r1** syntax and canonical encodings →
`refused(malformed)` · **r2** the carrier's own admission
metering → `refused(admission-resource)` (before any asymmetric
work, 4.4 guarantee 3 — **and subject to guarantee 4**: a
request naming an `rkid` the carrier holds a binding for is not
refused here because unknown-address traffic drained the meter,
round-44 B-2) · **r3** both possession proofs →
`refused(possession-failed)` · **r4** capacity, under the two
rules above → `registration-refused(capacity)` · **r5** the
state table. The first condition that holds names the verdict.
An implementation free to pick among simultaneously true refusals
would be observably divergent from one that picked differently;
this order removes the choice.

| state | input | precondition | outcome | next state |
|---|---|---|---|---|
| `unbound` | register / rebind | — | `registered` | `live(g′, P′)` |
| `unbound` | collect / conclude | — | `refused(no-such-queue)` (5a.5) | `unbound` |
| `unbound` | orphan-expiry · deadline · eviction | — | `cannot arise` (no binding, no tombstone) | `unbound` |
| `live(g, P)` | register / rebind | `g′ > g` | `rebound` | `live(g′, P′)` |
| `live(g, P)` | register / rebind | `g′ = g`, `P′ = P` | `registered(idempotent)` | `live(g, P)` |
| `live(g, P)` | register / rebind | `g′ = g`, `P′ ≠ P` | `refused(stale-generation)` | `live(g, P)` |
| `live(g, P)` | register / rebind | `g′ < g` | `refused(stale-generation)` | `live(g, P)` |
| `live(g, P)` | collect / conclude | proof under `P` | `served` (5a.7, 5a.8) | `live(g, P)` |
| `live(g, P)` | collect / conclude | valid, fresh proof under `P′ ≠ P` | `refused(no-such-queue)` (5a.5 — no queue exists **under that principal**; the answer reveals nothing about other principals' queues) | `live(g, P)` |
| `live(g, P)` | orphan-expiry | no collection within `orphan-horizon` | `wind-up begins` (5a.9) | `closing(g, P)` |
| `live(g, P)` | deadline · eviction | — | `cannot arise` (the wind-up has not begun) | `live(g, P)` |
| `closing(g, P)` | register / rebind | as the four `live` rows above, verbatim | same outcome | on `rebound` / `registered(idempotent)`: **`live`**, the wind-up ends (5a.9); on a refusal: `closing(g, P)` |
| `closing(g, P)` | collect / conclude | proof under the bound principal | `served` — concluding is what `closing` is for | `closing(g, P)` |
| `closing(g, P)` | collect / conclude | valid, fresh proof under `P′ ≠ P` | `refused(no-such-queue)` (as in `live`) | `closing(g, P)` |
| `closing(g, P)` | orphan-expiry · eviction | — | `cannot arise` (the wind-up has begun; only `released` is evictable) | `closing(g, P)` |
| `closing(g, P)` | **deadline** | the wind-up deadline arrives (5a.9) | `obligations discharged` **and** `released` — **one linearized transition**: every held deposit's inherited life has ended at or before this instant, so all are given up, and queue and binding release in the same step; **one** tombstone created, `t := g`. A submission or return linearized before this transition is served by the `closing` rows; one linearized after it meets `released(t)` | `released(g)` |
| `released(t)` | register / rebind | `g′ > t` | `registered` | `live(g′, P′)`, and the tombstone is **consumed** |
| `released(t)` | register / rebind | `g′ ≤ t` | `refused(stale-generation)` | `released(t)` |
| `released(t)` | collect / conclude | — | `refused(no-such-queue)` (5a.5) | `released(t)` |
| `released(t)` | eviction | the store exceeds the declared `max-binding-tombstones` — a new tombstone at the bound, or a revision that lowered it — and this is the longest-released tombstone (ties by ascending `rkid` key bytes) | `evicted` — the anti-resurrection guarantee for this `rkid` ends | `unbound` |
| `released(t)` | orphan-expiry · deadline | — | `cannot arise` (no binding exists) | `released(t)` |

**Consumption** weakens nothing: the only proof that consumes a
tombstone is one the tombstone already permits, and an `rkid`
never holds both a binding and a tombstone. **`rebound` names the
succession, not a change of person**: with `g′ > g` the recorded
generation MUST advance, `P′ = P` or not. And **`purpose` does
not select a cell** — `register` and `rebind` are distinct in the
signed bytes and equivalent in effect, because a holder
recovering from a partial loss cannot know which state the
carrier is in, and 5a.9's return path depends on its guess not
mattering; what purpose separation buys is transplantation
resistance, not intent.

- `refused(possession-failed)` — one or both proofs failed. The
  challenge is already consumed at this point, so this outcome is
  not retriable in the strongest sense available: the same
  response cannot be presented again against anything live, and
  another attempt begins with a fresh challenge.
- `registration-refused(capacity)` and
  `refused(admission-resource)` — the carrier's own limits (4.4
  guarantee 2): **retriable**, deterministic in the carrier's
  state, and never about the presenter. They are named here so
  that a registration cannot be refused for a reason outside the
  closed set.

**Rebind, and the exact condition under which it exists.** A
rebind is the ordinary path, not an incident: the holder comes
back with a **new** principal for an address it already
registered, because its carrier nonce changed while the address
did not (Identity §7a.3, §9.3). Three situations produce it — a
carrier entry lost or corrupted, a deliberate rotation of `N`,
and the convergence of two concurrently created nonces in a
multi-device register — and all three share the one property the
proof rule needs:

> **A rebind requires the `rkid`'s private key, so it exists
> exactly where the pair context survived.** That key is the pair
> context's key-agreement half (Section 5, Identity §5.2); it
> does not live in the carrier entry and is not reconstructible
> from anything a counterpart holds — a counterpart holds the
> **public** address. **After a total register loss with no state
> copy there is therefore no rebind at all**: the pair contexts
> are gone with everything else, the sealed challenge cannot be
> opened by anyone, and the relationship re-addresses instead
> (5a.9). Which loss took the pair contexts with it is decided in
> Identity §9.3.

An attacker never holds that key in **any** of these cases, so no
loss on the holder's side ever becomes an opportunity on the
attacker's. Two rules complete the mechanism:

1. **Possession is the authority; incumbency is not.** A live
   binding does not outrank a fresh valid pair of proofs. Any
   other rule would let a hijack that once succeeded become
   permanent, and would leave the honest holder with no way back
   short of abandoning the address.
2. **A rebind is one durable commit** — the linearizable
   compare-and-swap of Access §7.3's acceptance rule, for the
   same reason: verification, the displacement of the old
   binding, and the installation of the new one either all take
   effect or none do. Two concurrent valid registrations for one
   `rkid` yield one binding, never two, and never a queue with no
   authorized collector.

**The residual this creates, named.** A carrier that observes a
rebind learns that two principals successively controlled one
`rkid` — a link **within one relationship at one carrier**, which
is precisely what that carrier already carries and is not a join
across relationships (the same argument Identity §7a.3 makes for
one principal across a relationship chain). A holder who does not
want even that link rotates the `rkid` as well — the ordinary
Section 5 tombstone path, one card exchange. And a rebind is only
ever available to a party that can open a challenge sealed to the
address, so the rule buys the honest holder a return path without
buying an attacker anything.

**Collection is the same proof, without the sealed half.** Every
collection and every conclusion (5a.8) under a principal MUST be
authorized by a fresh proof of possession of that principal's
key — a signature over a carrier-issued challenge, Access §7.3
again. A carrier MUST NOT grant standing to a bearer token that
outlives the session, and MUST NOT accept a collection for one
principal inside a session authorized for another.

**Three things have been called "session" here, and they are kept
apart:**

| Term | What it is | Rule |
|---|---|---|
| **Authorization session** | the scope of one proof of possession: what a carrier has been shown the right to act on | **MUST** carry exactly one principal. A collection or conclusion for a second principal inside it is nonconformant, full stop. |
| **Mediation connection** | the neighbouring protocol's long-lived relationship (a DIDComm connection, a TSP relationship) | **MUST** be one per principal (5a.10). |
| **Transport socket** | TCP, TLS, WebSocket, an HTTP connection | **below the port line**; it carries whatever the transport carries, and this contract says nothing about it. |

The MUST of the first row is what this section owns. What 5a.7
discusses is none of the three: it is the **timing** of separate
authorization sessions, and that is a SHOULD because it is a
scheduling cost, not an authorization question.


### 5a.4 Submission is principal-free (normative)

**This contract carries no submitter identifier.** A submission
consists of an `rkid`, a size, and the sealed bytes — that is the
whole of what this contract puts on the wire — and no rule of it
requires a sender principal, a sender account, or channel
authentication of the submitter. **No field at or above this
contract's port line identifies a submitter or links two
submissions to one.**

**What the transport underneath shows, stated rather than
promised away.** An earlier casting said categorically that a
sender presents no identity to a carrier of any kind, and the
transport this stack targets contradicts it: TSP authenticates
the **outer VID pair** of a direct relationship to each
neighbour, so a carrier reached over TSP sees an authenticated
transport identifier of the party delivering to it (5a.10 fixes
which one it may be). The categorical sentence is **withdrawn**,
and the honest statement has two halves:

> This contract contributes no submitter identifier, and the
> transport identifier beneath it MUST be scoped per carrier
> relationship — exclusive to that relationship, never
> person-wide, never reused across carriers (5a.10). **A carrier
> can therefore count and rate one transport peer's submissions;
> what it cannot do, from any protocol field at either layer, is
> name the person behind them or join them to that peer's
> relationships elsewhere.**

That is the boundary TSP itself draws — the outer VID of a direct
relationship is visible to that neighbour by design; it is the
*nested inner* VID that is private, and 5a.10 forbids mapping the
control principal onto the outer one — and this contract does not
claim to be more anonymous than the transport it rides.

Principal-free submission removes the *identifier*; it does not
remove the *observation*. A carrier still sees, and this contract
does not pretend otherwise: the **network layer** (source
addresses, connection reuse, TLS session resumption — without
network anonymity, a carrier that wants a submitter identity has
one and needed no protocol field for it); **timing and volume**;
**ack pairing** (a carrier holding both directions pairs two
`rkid`s by response time with no identity whatsoever); and
**collection patterns** (5a.7, where the residual is priced).
Unlinkability is a property of a mix network — cover traffic,
randomized delay, constant-rate collection, in the manner of the
Loopix line of work — and **this contract implements none of it
and claims none of it** (Section 10 restates the same boundary
from the privacy side; the two MUST NOT drift apart).

This is a decision with a price, and the price is named: there is
no sender quota, no sender ban, and no negotiated permission to
send. Defence is **resource-shaped** (5a.5), and a carrier that
answers abuse by identifying senders has not hardened this
contract; it has replaced it.

The neighbours resolve this the same way: a DIDComm mediator does
not authenticate the sender at all and draws its permission from
the *recipient's* standing connection, and TSP addresses a
carrier under a per-relationship VID rather than a person. Both
authorize **relationship-wise**, not person-wise.


### 5a.5 Admission: what a carrier may check, and what it never may (normative)

This section fixes what a carrier is allowed to look at when a
submission arrives, and closes the outcome set — otherwise
"principal-free submission" is a prohibition with no positive
story, and an implementer fills the silence with the first thing
that works, which is a sender identity.

**A carrier MAY consider exactly these, and MUST consider nothing
else:**

1. **Whether the `rkid` names a queue it holds** — live or
   closing per 5a.3, or tombstoned per Section 5. This is a
   lookup on the value the envelope carries, not a judgement
   about anyone.
2. **The envelope's shape and size** against Section 5 and its
   declared `max-queue-bytes`.
3. **Its own resource state**, at a metering scale of per
   submission or per queue — never per person, and never per
   inferred submitter.
4. **Its own held state**: the storage already occupied by that
   queue, and its overall capacity.

**A carrier MUST NOT consider, require, or record as an input to
this decision:** any sender identity, account, credential,
invitation, device certificate or attestation; any channel
authentication of the submitter; any counter, quota, or
reputation keyed to a submitter rather than to a submission or a
queue; or any correlation of two submissions to one submitter.
The last one is a rule about **inputs**: a carrier inevitably
*observes* addresses and timing (5a.4), and this contract does
not pretend to prevent that — but it MUST NOT turn such an
observation into an admission rule, because a rule keyed to an
inferred submitter is a sender account under another name.

**The outcome set is closed**, with retriability marked because
the sender's behaviour depends on it:

`admitted` · `duplicate` · `refused(no-such-queue)` ·
`refused(bounds)` ·
`refused(admission-resource)` *(retriable)* ·
`refused(queue-saturated)` *(retriable)* ·
`refused(capacity)` *(retriable)*

**And the checks run in one normative order, so that overlapping
conditions name one verdict rather than an implementation's
choice of several** (round-43 B-3 — two carriers answering
`queue-saturated` and `capacity` to the same submission are
observably divergent, and no internal bookkeeping is needed to
prevent it, only a port rule):

> **s1** queue lookup → `refused(no-such-queue)` · **s2** shape
> and size → `refused(bounds)` · **s3** byte-identity →
> `duplicate` · **s4** the carrier's own admission metering →
> `refused(admission-resource)` · **s5** the queue's own bound →
> `refused(queue-saturated)` · **s6** global occupancy →
> `refused(capacity)` · otherwise `admitted`.

The first condition that holds names the verdict, later ones are
not consulted, and the order is from the **most specific to the
most global** — a sender learns the most actionable true thing:
that the address is wrong before that the queue is full, that the
queue is full before that the carrier is.

- **`duplicate`, byte-exactly.** Two submissions to one queue are
  duplicates **iff their sealed envelopes are byte-identical** —
  the only comparison a key-blind carrier can make. Re-sealing
  the same document is a **different envelope** (Section 5 draws
  a fresh `epk` and `nonce` every time) and is admitted; repeated
  *documents* are the receiver's business, handled on the digest
  after decryption (§6.2), and neither layer pretends to do the
  other's work. A carrier holds the comparison value exactly as
  long as it holds the deposit; once the deposit has left, a
  byte-identical re-presentation is a new submission. A
  `duplicate` consumes admission work like an `admitted`
  submission — free byte-identical replay would be an
  amplification channel — and consumes no storage, since no
  storage happened. The sender sees nothing new: the deposit is
  present, so its status stays `accepted` (6.1).
- **Retriable** means: the same submission, presented later, may
  be admitted; the resource was momentarily unavailable, and
  nothing about the submission was judged. **Non-retriable**
  means this contract makes no promise that repetition changes
  anything, and the sender is told to stop — which it now has to
  say in only one case: an address that does not exist. (A queue
  being wound up used to be a second case; 5a.9 withdrew the
  machinery that made it one.) The retriable refusals are
  honestly unpredictable — they are the carrier's own fill, which
  it cannot publish without publishing its occupancy — and
  everything else is a function of the envelope, the declared
  constants, and the queue's own state.
- `admitted` is what the sender sees as `accepted` (6.1) and
  carries the durability duty from that moment. The refusals map
  into the sender's closed status set without adding a state:
  `refused(no-such-queue)` → `failed(unroutable)` (the address
  does not receive, and a sender learns exactly that much and
  never why); `refused(bounds)` → `failed(oversize)`; a retriable
  refusal is **not yet a status** — the sender retries until its
  adapter's declared give-up, at which point it is
  `failed(expired-by-adapter-policy)`.
- **No refusal ever carries a reason about a party**, and none is
  reported to the recipient. A carrier that answers "this sender
  is not allowed" has left this contract.

**The residual, stated at full strength.** Because admission is
resource-shaped and the address is public within the
relationship, **anyone who holds an `rkid` can spend that queue's
budget** — sealed garbage is indistinguishable from sealed
content to a key-blind carrier. The queue fills, legitimate
submissions meet `refused(queue-saturated)`, and per-queue
metering means the flooder and the honest counterpart share one
budget: the attack is a denial of service against **one
relationship**, never the person — 4.4's guarantees 4 and 5 are
what hold that boundary, since below its floor a queue's
admission is beyond the reach of any other queue.

**And the reason no resource parameter closes it is the whole
architecture in one sentence:** telling the flooder apart from
the honest sender **is** sender identification. Every
resource-shaped lever changes what the attack costs and never who
is allowed. So the defence is not prevention but a cheap,
terminating cure, and the contract owes that path precisely:

> **Rotation is the named healing path (normative).** A recipient
> whose queue is under flood SHOULD rotate the `rkid` of that
> relationship: it publishes a fresh key-agreement key to its
> counterpart in a new contact card **over the existing
> relationship channel**, and retires the flooded one by the
> ordinary Section 5 tombstone rule. The old queue winds up by
> 5a.9, nothing admitted is silently lost, and the counterpart's
> outbound path is uninterrupted, because it holds the new card
> before the old address dies (`key-retention`, Section 5).

**Who is left, once rotation is in place.** An `rkid` travels
only inside the relationship it addresses, so the flood needs the
address, and there are exactly two ways to hold it:

- **A third party** that obtained an old address once — a leaked
  card, a compromised backup, an old device. Against this
  attacker the rules **stop the attack**: rotation removes the
  address it holds, the new one never reaches it, and the attack
  terminates.
- **The relationship insider** — the counterpart itself, which
  receives every new address by construction. This one the rules
  do not stop, and the answer is **social, never mechanical
  suppression**: there is exactly one counterpart per queue, so
  the attacker is known to the victim **by name**; the flood
  destroys the only channel the attacker has and gains it
  nothing, and a recipient that rotates and does not re-establish
  has ended it. This is the point at which a delivery contract
  stops being the right instrument. (A party observing rotated
  addresses continuously either *is* the insider or has
  compromised the insider's endpoint, which no carrier rule
  reaches — Section 9.)

**A second residual of the same family: door starvation.**
Nothing here authenticates a requester before the registration
exchange, so an identity-free flood can keep **new onboarding at
one carrier** — and the return of an address whose binding has
already been **released** — starved indefinitely. What it cannot
reach is any binding the carrier still holds: 4.4's guarantee 4
puts every `live` and `closing` binding's service beyond traffic
for unknown addresses, so device restore, nonce rotation and the
rebind of any relationship whose address the attacker does not
know cannot be starved at all. The post-release return is not
time-critical — a tombstone does not expire — and the deployment
answer is the plural one this design assumes: a person's
relationships are not all at one carrier, and a starved door is a
reason to register at another, never a reason to lose a
relationship. This is the DO-6 family: bounded in blast radius,
priced rather than prevented, re-evaluated on evidence of
operational abuse rather than on possibility.

**The road not taken, named rather than omitted.** A
recipient-issued admission token — a secret capability handed to
accepted counterparts, presented with each submission, revoked by
rotation — would close exactly the part of this residual that
belongs to parties the recipient never accepted. It would close
nothing else: an accepted insider holds the token by design (that
is what accepting means — Signal's sealed-sender delivery token
has precisely this shape and this boundary), and door starvation
is not a submission question at all. **The editor's decision for
the 0.x line is: not now, and remembered** (Section 12, DO-6). If
it is ever adopted, it belongs in a casting of its own, and the
property it must preserve is stated in advance: the token MUST be
per (relationship × carrier), like the principal beside it, or it
is a person-wide credential with a friendly name.


### 5a.6 Two roles, one process, never one principal (normative)

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

**What this MUST proves — and what it does not, which is the part
that must not be overstated.** The rule is written as an
**identity and interface** rule precisely because that is the part
that is *checkable*: the two identities are distinct values, the
sessions are distinct sessions, and no operation of either role
answers about the other. A conformance run can decide all three
from what crosses the interface, and 5a.3's session rule makes the
last one operative. What no rule reachable from here can decide is
**operator conduct behind the interface**: one company running
both roles can join a recovery context and a set of control
principals through source addresses, timing, device telemetry,
billing, or an internal account, and it needs no protocol field to
do it. That is a **named residual, not a MUST** — a MUST that a
conformance run cannot decide is a claim, not a requirement, and
this document would rather carry the residual honestly (Section
10 restates it from the privacy side). What the rule therefore
buys, exactly: it removes the **free** join — the one that needs
no analysis, only an equality check on two identifiers presented
on one connection — and it makes the remaining join a matter of
deployment trust, which a person can at least choose against by
choosing two operators. A recipient that wants the residual closed
rather than named uses a **different party** for storage and for
delivery, and this document RECOMMENDS exactly that.

**Migrated identities are the honest exception.** For an identity
migrated from the previous generation, the historic recovery
context already carries social attachments (Identity §10), and its
own storage is already bound to the person. The separation of this
section therefore works **prospectively** for them — new
principals are separate from the first day — and cannot undo what
the deployed generation already showed its relay.

### 5a.7 Collection discipline (normative, SHOULD)

**This section is about timing, and only about timing.** Serving
two principals inside **one authorization session** is already
forbidden by 5a.3's MUST, and sharing one mediation connection
between them is forbidden by 5a.10; neither is discussed here. The
join this section addresses is the one that survives all of those
rules being kept: a device that opens two perfectly separate,
perfectly authorized sessions **three seconds apart, every time**,
hands the carrier the same grouping through their shape in time.
No derivation can prevent that: it is scheduling, not
cryptography.

> A recipient SHOULD NOT correlate its collection times across
> principals more tightly than its traffic already requires — and
> an implementation that claims this discipline **MUST declare the
> policy by which it does so**: its minimum spacing between
> collection sessions for different principals, the range of the
> randomization it applies to that spacing, and **whether it
> multiplexes two principals' mediation relationships over one
> persistent transport** (5a.10's SHOULD, which lands here because
> a shared transport is a co-timing decision and nothing else).

**The declaration is what makes a SHOULD checkable**, which is the
half an earlier casting was missing: "more tightly than its
traffic already requires" can excuse any burst, so a conformance
run had nothing to test and the rule was decorative. It is
deliberately **not** a fixed number in this contract — a phone on
a metered link and a desktop on mains power have honestly
different answers, and a value invented here would be wrong for
both. What is required is that the answer be **stated and then
kept**: a run can check the declared spacing against observed
behaviour, and a party that declares `PT0S` has said plainly that
it does not take this discipline, which is information rather than
silence.

It stays a SHOULD for a reason this document would
rather write down than pretend away: separate, spaced sessions
cost connections, battery, and latency, and on a mobile device
that cost is real and recurring. A MUST that implementations
cannot afford is a MUST that gets quietly worked around, and a
specification that carries such a rule is less honest, not more.
**And the honest ceiling is named too:** spacing and jitter raise
the cost of the correlation, they do not remove it. Removing it is
mixnet terrain — cover traffic, Poisson delays, constant-rate
pulls, the Loopix line of work — and this contract implements none
of that and claims none of it (5a.4, §10).

*Several devices, one principal (informative).* Under the
shared-seed device model of Identity §3.2 every device of a person
derives the **same** principal for the same (relationship,
carrier). A carrier therefore sees one principal collected from
several sessions, which reveals device multiplicity for that one
relationship and nothing across relationships. This is DO-3's
question in the identity dimension, and it is answered the same
way: the principal is relationship-scoped, not device-scoped, and
whatever a future device model brings must keep it so.

### 5a.8 Conclusion: nothing admitted ends silently (normative)

The Abstract's promise — "eventually, at least once, **never
silently lost**" — has, until this casting, had no counterpart on
the carrier side of the interface. Two holes followed from that,
and the field record found both:

- **Nothing cleared a slot.** A receiver that terminally rejected
  a collected document simply did not acknowledge it, so the
  carrier redelivered it at every connection, forever, and the
  queue only grew. The deployed previous generation shows the
  end state of this: one address stalled at **1148 pending**
  documents, every one of them already decided and none of them
  concludable. This is a *contract* gap, not an implementation
  bug: 6.2 gives a closed, ordered disposition taxonomy from which
  "deterministically final" is derivable, but no duty existed to
  say so to the carrier.
- **Nothing bounded the other end.** A document nobody ever
  collects sat in a queue until a carrier decided, unilaterally
  and silently, to drop it.

Both are closed here, in one rule and its two directions.

**The receiver's duty (MUST).** A recipient that has reached a
**terminal** disposition for a collected document MUST conclude it
toward the carrier, under the principal that collected it, and a
carrier MUST offer that operation and MUST NOT redeliver what has
been concluded. Terminal means every 6.2 outcome that repetition
cannot change: every failure disposition of stages 1 to 9, whether
it arises before the critical section or inside it (a type's age
bound checked in stage 9 among them), except `failed(rate-limited)`;
`unique`; `discarded` once the transaction recording it has
committed; and `duplicate-known`.

**RLTP-DEL-5810** — A receiver MUST treat a disposition as
transient, neither terminal nor concluded, where the device could
not complete the critical section, storage was unavailable, the
lock set was not obtained, or the evaluation's transaction could
not be committed whole.

**RLTP-DEL-5820** — A receiver MUST treat `failed(rate-limited)`
(6.2) as transient and MUST NOT conclude a document so disposed.

*Rationale.* The distinction between terminal and transient is what
keeps this rule from turning a local fault into a silent loss. A
transaction commits whole or not at all: an effect that does not fit
the device's storage commits nothing, earns no acknowledgement, and
stays with the carrier, which offers it again until it fits or until
the carrier gives it up at its declared horizon (below); no part of
an effect is ever concluded. A rate-limited document is not decided
either: it waits at its carrier for a later evaluation under a rate
that has room again, and the same give-up horizon bounds the wait.

**A conclusion carries no reason.** It says "this digest is
decided", and nothing else — not the disposition, not the stage,
not whether the document was accepted or rejected. The
carrier is key-blind and stays verdict-blind, and 6.1's rule that
the sender never learns what the receiver decided is untouched:
the sender's view of a concluded-but-rejected document is
`accepted` and, absent an acknowledgement, nothing more.

**The carrier's duty (MUST).** A carrier MUST NOT discard an
admitted deposit without first concluding it toward the sender
path. Concretely: a deposit that reaches the carrier's declared
`give-up-horizon` (4.4) without being collected and concluded is
**given up** — the carrier stops offering it and the sender's
status becomes `failed(expired-by-adapter-policy)`, the reason
6.1 has always carried for exactly this — and only then may its
storage be released. There is no other way for an admitted
deposit to leave a queue: it is collected and concluded, or it is
given up. **A carrier that silently drops an admitted deposit is
nonconformant**, and no other constant of 4.4 — the
`orphan-horizon` included (5a.9) — creates an exception.

*Why the sender path can be served at all here, since the carrier
knows no sender:* it does not need to. `failed(...)` is a
statement the sender's **own** adapter makes about a submission it
is tracking, from the carrier's refusal to keep offering it; the
carrier concludes the deposit, not the person. That is the same
asymmetry 6.1 already relies on, written down.

### 5a.9 Loss, re-registration, and orphans (normative)

The carrier nonce of a relationship lives in the holder's
register (Identity §7a.3), and its recovery is the recovery of the
register itself — which this stack does **not** get from the
Replication Contract's group rebind (that machinery rebinds a
stable *group* identity and presupposes held or recovered group
and member identity; it defines no path to a person's own
register). It gets it from the storage side of the S-DID cut, and
Identity §9.3 states it conditionally, which is the honest form
and is adopted here verbatim in substance: the recovery context of
Identity §5.3 is derivable with no register at all, and **with any
state copy it unlocks**, the register returns and every principal
re-derives, with no carrier involved. Ordinary device loss is that
case. The storage contract that makes the state copy exist is a
**named, still unwritten external prerequisite** (Identity §6.3),
satisfied in fact by today's encrypted vault rather than by a
referenceable specification — so this section claims recovery
exactly where §9.3 does, and not one sentence further.

**Two losses, and only one of them leaves a way back.** Which one
happened is decided in Identity §9.3, and this contract follows it
without adding anything:

- **A carrier entry is lost, the pair contexts are held** — a
  corrupted or selectively restored entry, a deliberate rotation
  of `N`, or the convergence of two concurrent nonces in a
  multi-device register (Identity §7a.3). The addresses and their
  **private** keys survive, so the holder can open a sealed
  challenge and re-registers under the new principal: this is the
  **rebind** of 5a.3, the binding moves, and **the queue's
  contents move with nothing, because they were never the old
  principal's**.
- **The whole register is lost with no state copy** — then the
  **pair contexts go with it**, and every `rkid`'s private key
  with them (Identity §9.3). A counterpart's copy of an address is
  the **public** value and re-derives nothing, so the sealed
  challenge of 5a.3 cannot be opened by anybody: **there is no
  rebind in this case, and this contract does not offer one.** An
  earlier casting claimed the opposite — that a surviving `rkid`
  carried the proof — which would have made the recovery branch a
  normative instruction to perform an impossible step. The
  relationship re-addresses by the ordinary Section 5 path
  (a new encounter or a new introduction act, Identity §9.3), and
  the old queues are collected by nobody.

- Old principals that are not rebound become **orphans**:
  bindings nobody will ever present again. A carrier MUST NOT
  offer to hand a person "their" principals back — such an
  operation is precisely the cross-principal answer 5a.1 forbids,
  and offering it would make every carrier a de-anonymization
  service for its own users. A rebind is not that operation and
  must not be confused with it: it answers about **one address
  whose possession was just proved**, and it names no principal to
  anyone.
- Orphaned bindings are aged out, never reclaimed, on the
  published `orphan-horizon` (4.4). Ageing out is a storage
  decision about a **binding**, is reported to no one, and changes
  no verdict about any party.

**The wind-up runs to a deadline, and the deadline does not move
(normative).** A queue nobody collects would grow without end, so
a binding whose `orphan-horizon` passes with no collection enters
`closing` and is released when it is done. What makes that
terminate is **one absolute instant**, fixed when `closing`
begins:

> `wind-up deadline := the instant closing begins +
> give-up-horizon`

A deposit admitted **during** `closing` does not start a fresh
give-up life. It **inherits the remaining time to that deadline**.
So the newest deposit the queue can hold expires no later than
every other one, and the bound follows from the construction
rather than from comparing two durations.

**And the deadline is the release — one transition, not two**
(round-43 B-1). An earlier draft of this casting split the
deadline into a give-up sweep and a separate release, and the
split was a hole: between the two, an admission could arrive
undisposed and 5a.8 would forbid the release it was already due —
a flooder could repeat that forever, and a return in the gap
could void a deadline that had already arrived. So the arrival of
the deadline **is** the linearized transition (4.4's atomicity
rule): everything held is given up — every inherited life has
ended at or before this instant by construction — and queue and
binding release in the same step. There is **no release before
the deadline**: an empty closing queue simply waits, which costs
nothing, and the early release was the race in another place. A
submission or return linearized before the transition is served
by the `closing` rows; one linearized after it meets
`released(t)` — the return then costs the tombstone path's two
exchanges instead of ending the wind-up, and the boundary between
the two is exact rather than raced.

**Admission therefore stays open, and this is a deliberate
reversal.** Earlier castings closed admission at the instant
`closing` began, and answered every further submission with
`refused(queue-closed)` — a verdict this contract no longer has.
Closing admission was never the point; **terminating was**, and a
fixed deadline terminates without refusing anyone. What closing
admission cost is easy to name and was paid for several castings:
a deposit that arrived while the wind-up ran was lost **even when
the holder came back the next day**, and a sender was told an
address does not receive when it was about to receive again. Both
are gone. A carrier keeps taking bytes for a closing queue exactly
as it does for a live one, and it may refuse for `capacity` there
exactly as it does anywhere else.

**And a closing queue is now indistinguishable from a live one at
the port line**, which is a stronger privacy property than the
one the withdrawn verdict was defending: there is no longer any
answer that separates *a wind-up is running* from *this address
is fine*, because there is no longer any separate answer at all.

**A holder who comes back reopens it** — 5a.3's outcome table,
`closing × register/rebind`. Possession is the authority here as
everywhere, and a person who recovers a device on day 91 must not
lose a relationship to a bookkeeping state. **A return outranks an
arrival**: when a carrier is at its limits it refuses the
registration that would create a **new** binding before it refuses
the one that resumes a binding it already holds. A full service
stops taking new work; it does not shed work it has already
accepted, and the asymmetry of harm is the argument — a refused
newcomer registers later or elsewhere and loses nothing, a refused
returner loses a channel that exists and the deposits sitting in
it. This cannot be gamed: the cell is reachable only by both
possession proofs for an address the carrier already holds.

**And the return ends the wind-up, deadline included.** With the
`rebound` or `registered(idempotent)` the binding is `live`
again, the wind-up deadline is void, and **every deposit still
held reverts to its own admission-dated `give-up-horizon`** —
including those admitted during `closing`, whose inherited short
life existed only to make an *unattended* wind-up terminate. The
inherited deadline was never a property of the deposit; it was a
property of the wind-up, and the wind-up is over. (Without this
rule a deposit admitted a minute before the holder's return would
expire almost immediately in a queue that is being actively
collected, which serves nobody and protects nothing.)

What was concluded stays concluded; what is still held is
collectable again, **including whatever arrived while the wind-up
ran**.

A carrier that discards a binding together with undisposed
admitted deposits has violated 5a.8, whatever its horizons say.

Senders are unaffected in their contract: an envelope to a retired
address fails through the ordinary path (Section 5's tombstone
rule, §6.2 stage 2/3), with the ordinary status.


### 5a.10 Neighbouring carrier forms: adapter obligations (normative)

E9's decision stands — the control principal is mapped onto the
form the neighbouring layer already has, and **no second wire form
is added here**. What changes in this casting is the *status* of
the mapping: "an adapter maps it onto the relationship VID" and
"an adapter maps it onto the connection" were sentences that named
no unique object, and a naive adapter built exactly against the
neighbouring standard's defaults would re-create the very joins
5a.1 exists to prevent. The mapping stays adapter work; the
**obligations** of that work are normative, and they are stated
here because there is nowhere else they could live. An adapter
profile that does not declare them is not a conforming carrier
adapter.

**ToIP/TSP (deterministic mapping).** TSP names several distinct
relationships at once — the endpoint's relationship with its
direct intermediary, each intermediary-to-intermediary hop, the
end-to-end relationship, and private VIDs nested inside it — so
"the private relationship VID" was underdetermined. The rule:

- **One principal ↔ exactly one endpoint-side outer VID of the
  relationship with the *direct* carrier**, and the mapping is
  injective in both directions **at any one time**: an adapter MUST
  NOT serve two principals under one outer VID, and MUST NOT hold
  two **live** outer VIDs for one principal at one carrier. The
  words "at any one time" are load-bearing and were missing: TSP
  identifies the direct relationship by the VID pair with **that**
  intermediary, while `C` — and therefore the principal — is a
  string the holder configured and survives a proxy, a federation
  member, or a key rotation behind it (Identity §7a.2). So the
  direct TSP peer or its VID can change underneath a stable `C`,
  and an earlier casting left that case with three exits and no
  door: reusing the local VID broke exclusivity, minting a second
  one broke a 1:1 read over all time, and deriving a new principal
  contradicted the derivation. The resolution is the third of
  those, read correctly:

  > **When the direct TSP peer or its VID changes under an
  > unchanged `C`, the adapter establishes a fresh outer VID for
  > the *same* principal and retires the old one.** The old VID is
  > retired — never reused, never reassigned, never live beside
  > its successor. The principal does not change, because nothing
  > that enters its derivation changed; the registration does not
  > change either, because the carrier's identity is the
  > configured string and not its hop. It is one live VID per
  > principal, in sequence, and that is exactly what exclusivity
  > requires — exclusivity forbids *sharing* an identifier, not
  > succeeding one.
- **That outer VID MUST be exclusive to this principal — and
  "exclusive" is three prohibitions, not the word "public".** A
  mapping can be perfectly one-to-one *inside* the adapter and
  still hand over the whole join: an adapter could satisfy the
  bullet above with a VID the person already publishes, or with
  the same VID it uses for three other TSP relationships, and a
  carrier that recognizes it has joined those relationships
  without doing any analysis. An earlier casting tried to forbid
  that by forbidding a "public" VID — **which is unsatisfiable and
  was a mistake in our sentence, not in TSP**: in TSP's routed
  model the outer layer *is* the public layer, so the endpoint's
  outer VID toward its direct carrier is public **by
  construction**, and a rule requiring it not to be could never be
  met. Visibility to the direct carrier is inherent and is not the
  danger; **linkability beyond the relationship** is. The three
  MUSTs that actually say that:

  1. **Not well-known.** The VID MUST NOT be published in a
     directory, a well-known location, a profile, a card, or any
     place that resolves it for a party that is not this carrier
     — a VID an outsider can look up is a name, and a name joins.
  2. **Not person-wide.** It MUST NOT be used for a second
     principal, a second carrier, or any purpose of the same
     person beyond this one relationship — including, expressly,
     that it MUST NOT be, or be derivable from, a control
     principal (5a.4's ingress rule states the mirror image for
     the sending side).
  3. **Not reused outside this relationship.** It MUST NOT appear
     in another TSP relationship, application, or account, and it
     is **retired with the principal**, never reassigned.

  What remains permitted, and must remain permitted for the
  mapping to exist at all: the direct carrier **sees** this VID,
  observers of the outer envelope may see it, and TSP's own
  metadata-privacy properties in routed mode apply exactly as that
  specification defines them. One principal, one relationship, one
  carrier, one live VID — the sentence Identity §7a.5(4) makes
  about principals, carried through the mapping so it survives it.
  **Honest limit:** exclusivity is a property of what an adapter
  does with an identifier, and nothing at this contract's port
  line can observe an adapter reusing a VID elsewhere. It is a
  declared obligation of the adapter profile, checkable against
  that profile and against the adapter's own key management, not
  from the wire.
- **The nested private end-to-end VID is expressly NOT the
  principal.** It is hidden from intermediaries by construction,
  which is the opposite of what a control principal is for: the
  principal MUST be visible to the carrier — it is what
  registration, collection, and conclusion are authorized under
  (5a.3). Mapping the principal onto an inner VID is a category
  error and is nonconformant.
- **Per-hop VIDs beyond the first are never the principal.** The
  carrier identifier `C` is the string the holder configured for
  the **direct** carrier (Identity §7a.2, "never the next hop");
  what that carrier arranges beyond itself is below the port line
  and does not enter any derivation.
- **Lifecycle coupling is total — and "intermediary" here means
  the *direct* one, always.** TSP routes through hop lists that
  the carrier may vary at will, so the rule has to say which
  change matters:
  - A change of the **direct** carrier is a change of the
    configured string `C`, therefore a different principal,
    therefore a new registration (Identity §7a.2's move rule) —
    the adapter MUST establish a **new** outer VID and MUST NOT
    re-point the old one.
  - A change **beyond** the direct carrier — hop 2 and onward,
    including a carrier that adds, drops, or reorders its
    downstream intermediaries — changes **nothing here**: same
    configured string, same principal, same outer VID, no
    re-registration. It is the carrier's own arrangement, below
    the port line, and an adapter that re-derived on such a change
    would be deriving from something the holder does not control
    (Identity §7a.2). The two bullets are one rule read at two
    distances, and an earlier casting's bare "a change of
    intermediary" left them looking like two rules in conflict.
  - A rebind (5a.3) is likewise a new principal: the adapter
    establishes a new outer VID and retires the old one; an
    orphaned outer VID is retired, never reassigned.

**TSP ingress, and what "principal-free" was always a statement
about.** A complete TSP carrier adapter must also *deliver into*
a carrier, and there it meets a real collision: an outer TSP
envelope carries and authenticates the **sender-side VID of its
direct neighbour relationship**, and nesting hides the inner VIDs
from intermediaries, not the outer one from the direct carrier. A
reviewer reading 5a.4's "no carrier-visible sender identifier of
any kind" as a claim about **every layer beneath us** is reading
it correctly as written, and as written it made a conforming TSP
ingress impossible. So the rule is restated as what it always
was — **a statement about this contract's port**:

> This contract defines no sender identity, requires none, carries
> none in any field it specifies, and permits no rule of its own
> to depend on one (5a.4). It does **not** claim that a
> neighbouring transport carries no hop identifier; a transport
> that authenticates its own hops is not thereby nonconformant,
> and pretending otherwise would exclude every real protocol from
> the port.

What an adapter owes instead is that the hop identifier stays
**hop-local and relationship-scoped**, and these are MUSTs:

- the sender-side outer VID an adapter presents when depositing
  MUST be **per (relationship × carrier it deposits to)**, freshly
  established for that pair;
- it carries **the same three prohibitions the collecting side
  carries**, and for the same reason — the word "public" is not
  among them, because in TSP's routed model an outer VID is public
  by construction and a rule forbidding that could never be met
  (the collecting side was corrected for exactly this a few
  paragraphs above; the ingress side must not re-introduce it):
  **not well-known** (in no directory, profile, card, or other
  location that resolves it for a party which is not this
  carrier), **not person-wide** (no second relationship, no second
  carrier, and expressly never a **control principal** of the same
  person or a value derivable from one — the sending side never meets
  the principal under which the recipient side registers and
  concludes, and which never appears on the wire), and **not reused
  outside this relationship** (no other TSP relationship,
  application, or account);
- being **visible** to the carrier it deposits to, and to
  observers of the outer envelope, is inherent and is not
  forbidden — linkability beyond the relationship is;
- it is retired with the relationship, never reassigned.

**RLTP-DEL-5990** — One wire identifier per (relationship × carrier)
MAY both deposit and collect: the sender-side VID of this paragraph
MAY be the outer VID under which the adapter collects for the
principal of the same relationship and carrier (the collecting side
above), in every layer of a deposit. Neither MAY be the control
principal or a value derivable from it, and each carries the three
prohibitions.

*Rationale.* The counterpart of a relationship knows the identifier it
addresses and the one it verifies, and the carrier reads both, so
keeping them apart hides nothing from either. Keeping them together
lets a counterpart that follows a Trust Task binding answer a
document where TSP's own model sends an answer, to the authenticated
sender.

**What that buys, exactly, and what it does not.** A carrier then
sees, for one queue, deposits arriving under one stable
sender-side VID — which links those deposits **to each other**
inside a relationship the carrier already carries end to end
(there is exactly one counterpart per `rkid`, 5a.2). **Through
that VID** it learns nothing across relationships and nothing
about the person — and the qualifier is the whole sentence, not a
hedge: the same carrier can still group relationships by source
address, timing, volume, ack pairing or a shared transport,
exactly as §10 records. What the rule buys is that the
**identifier** contributes nothing to those joins; it does not buy
their absence, and this contract claims no unlinkability anywhere
(5a.4, §10). A
**fresh VID per deposit** is explicitly *not* required and *not*
better: it is equally visible, buys nothing the per-relationship
rule does not already buy, and costs an establishment handshake
per message. The residual is stated plainly: a TSP carrier sees a
per-relationship ingress identifier, and this contract's claim is
bounded accordingly — no join **across** a person's relationships,
never a claim that ingress is unobservable (§10).

**DIDComm mediation and pickup (the standard's defaults are the
attack).** Coordinate Mediation 2.0 and Message Pickup 3.0 are
**connection-scoped** protocols: a `keylist` belongs to a
connection, `keylist-query` returns everything registered for that
connection, `status-request` and `delivery-request` may omit
`recipient_did` and then speak for the whole connection, batches
and `messages-received` receipt lists span recipients, and Live
Mode is a state of a connection that a persistent transport
carries. Each of the first four is, in this contract's terms, a
cross-principal answer; the last is two things at once, and is
split accordingly below — the **logical** live state is governed
here, the **transport** underneath it is not. A conforming adapter
therefore MUST:

- maintain a **separate mediation relationship — its own
  connection and its own connection DID — per control principal**,
  and give that connection DID the **same exclusivity the TSP
  outer VID has above**, for the same reason: separating
  connections *internally* is worth nothing if the DID naming one
  of them is a value the person already publishes elsewhere. So
  the connection DID MUST be **created for this principal and for
  nothing else**, under the same three prohibitions the outer VID
  carries above and for the same reason — **not well-known** (in
  no directory, profile, or resolvable public location), **not
  person-wide** (no second principal, no second mediator, never a
  control principal or derivable from one), **not reused outside
  this connection** — and it is **retired with the principal**,
  never reassigned. As there, the mediator's *seeing* the
  connection DID is inherent and is not what is forbidden;
  linkability beyond this one relationship is.
  **`from_prior` is forbidden here** — DIDComm's DID rotation
  hands a mediator a signed statement binding a new DID to a prior
  one, which would re-identify the principal externally no matter
  how principal-local its keylist is. An adapter MUST NOT rotate
  *into* a principal's connection DID from any other DID, MUST NOT
  emit `from_prior` on such a connection, and where a new
  connection DID is needed it establishes a **fresh mediation
  relationship** and registers again (5a.3) rather than linking
  the two.
  This is the load-bearing rule, and everything below follows from
  it: once one connection carries exactly one principal, the
  standard's connection-scoped operations become principal-scoped
  by construction, which is the only way to use them at all;
- keep **keylists principal-local**: the `rkid`s registered on a
  connection are those of that principal's relationship and no
  others, and the adapter MUST NOT construct, cache, or answer any
  keylist view spanning two principals — including for its own
  operational convenience;
- **scope every status, pickup, batch, and receipt operation to
  one principal's connection.** An ungrouped `status-request`,
  an omitted `recipient_did`, a batched `delivery` and its
  `messages-received` acknowledgement are all admissible *only*
  because the connection they run on is one principal wide;
- **keep Live Mode a per-principal property of the mediation
  relationship (MUST), and treat the socket underneath it as what
  5a.3's table says it is (SHOULD).** An earlier casting wrote
  "never share a Live Delivery socket across principals" as a
  MUST, and that put the same object on both sides of the port
  line: the session table declares TCP, TLS and WebSocket
  **below** it, while this bullet made a property of a WebSocket
  nonconformant. **This contract settles which object is which, and
  says so in its own name** (round-33 M-1): Pickup 3.0 binds Live
  Mode to a **connection**, allows it only on a persistent
  transport, and brings it back **off** after a drop — it does not
  define a relationship state separate from that connection, so it
  is evidence for where the re-arming lives, not authority for the
  split. The split is this contract's adapter duty: live state
  belongs to the logical relationship, and its re-arming is
  transport behaviour. Split
  accordingly:
  - **MUST:** Live Mode is enabled per **mediation relationship**,
    and since one relationship carries exactly one principal, no
    live delivery ever spans two principals *logically*. An
    adapter MUST NOT activate live delivery for two principals
    within one mediation relationship, MUST NOT let a
    `status`/`delivery` flow on one relationship report or carry
    another's, and MUST NOT treat the re-arming of a reconnected
    transport as authorization for anything — authorization is
    5a.3's, and it is per session.
  - **SHOULD:** an adapter SHOULD NOT multiplex two principals'
    mediation relationships over **one persistent transport**. The
    reason it is a SHOULD and not a MUST is 5a.7's reason exactly,
    and it would be dishonest to pretend otherwise: a shared
    socket leaks no **identifiers** — the DIDs, keylists, pickups,
    batches and receipts stay separate by the rules above — but it
    does leak their **common transport grouping**, which is a
    correlation and not nothing: a carrier can tell that these two
    mediation relationships arrive together, and that is the
    residual 5a.7 prices and §10 records. The distinction the
    SHOULD rests on is that the grouping is a *timing* fact, not
    an identity one; saying it leaks "nothing about identity"
    overstated even that. And a mobile device that must hold one live
    socket per relationship pays in connections and battery
    exactly where E7 said an unaffordable MUST gets worked around.
    An implementation that multiplexes declares it under 5a.7's
    spacing policy, because that is what it is: a timing decision.
  - The honest note: a carrier that sees two mediation
    relationships arrive and re-arm on one transport can group
    them, and no identity rule prevents that. It is the same
    residual as bundled collection, reached through a socket
    instead of through a schedule;
- map conclusions (5a.8) onto the standard's `messages-received`
  and nothing more — the acknowledgement clears the **queue
  entry** and carries no verdict.

Both mappings remain adapter work, below the port line, and
neither adds a wire form to this contract. The vector debt they
create is named in Section 11: these obligations are decidable
only against an implementation with a carrier interface, and the
first place that exists is the mediator adapter itself.

## 6. Delivery Promises

### 6.1 Sender: the status trias

| State | Meaning |
|---|---|
| `accepted` | the service durably buffered it; delivery is owed — with the feature `held`, the counterpart said it arrived and waits there (RLTP-DEL-6140) |
| `delivered` | a **valid** `delivery-ack` (4.2 consistency) referencing its digest arrived |
| `failed(reason)` | the service or the sender gave up; reason from the closed set below |

Sender failure reasons (closed set): `unroutable` · `oversize` ·
`expired-by-adapter-policy` (the adapter's declared give-up bound) ·
`task-expired` (the sender lifetime the document's type declares
has run out, Section 7) ·
`rejected-by-receiver(<receiver reason>)` where an adapter conveys
one. A late valid acknowledgement after `failed`, whatever its
reason, transitions the status to `delivered`; implementations MUST
surface the transition. No other states exist — in particular, no
acceptance state; `held` is a feature of `accepted`, not a state.

**RLTP-DEL-6140** — `accepted` carries one closed feature, `held`: a
validated `trust-task-next-step/0.1` of the counterpart answered the
document (4.6; the adapter profile names the validation), stating
that it arrived and waits there for something the counterpart names.
A document in any state before a terminal one — before the trias, or
`accepted` — becomes `accepted` and `held` at that answer; a terminal
document stays as it is, and a second such answer changes nothing.
A `held` document leaves `accepted` only for `delivered`, on a valid
acknowledgement, or for `failed(rejected-by-receiver(<code>))`, on a
validated terminal refusal: no horizon ends it, neither an adapter's
nor the sender's own give-up (RLTP-DEL-6110 included), and an
implementation MUST surface it as distinct from `accepted` without
the feature.

*Rationale.* `accepted` says a service took the document; a horizon
ends it because a document no one acknowledges may never have
arrived. A next step removes that doubt: the counterpart has the
document, its own state decides when it proceeds, and failing the
document at the sender's horizon would report a loss that did not
happen. The feature adds no state: the trias and its exits are
unchanged, and only the horizon's reach is narrowed.

**RLTP-DEL-6110** — A sender MUST move a document whose type
declares a sender lifetime (RLTP-DEL-7020) to `failed(task-expired)`
once that lifetime has run out on its clock without `delivered`,
unless the document is `held` (RLTP-DEL-6140).

**RLTP-DEL-6115** — A sender MUST NOT hand a document to an adapter
after moving it to `failed(task-expired)`.

*Rationale.* The lifetime is the sender's own reading of a timestamp
it wrote into the protected payload, and its type sets it to end
before the age bound its receivers apply. That orders the two
deadlines numerically, not in time: sender and receiver read
different clocks, and a receiver whose clock runs ahead of the
sender's by more than the margin refuses earlier (Section 7). A copy
an adapter already holds can still
arrive inside the receivers' bound and earn an acknowledgement; the
status then becomes `delivered`, the honest outcome. This contract
gives a sender no way to withdraw a copy from an adapter, so the
reason says what the sender decided, not that no copy is in flight.

**Before the trias there is a report, not a fourth state.**
`accepted` and `delivered` describe a submission a service has
**taken**; `failed` also records the sender's own give-up, which can
come before any service took the document (RLTP-DEL-6110, the
adapter's declared horizon).
A submission an adapter still holds — because it is offline, the
transport is unreachable, or the carrier refused retriably (5a.5)
— has no trias state yet, and inventing one would break the
closed set. What it MUST have, within the adapter's declared
`status-horizon` (4.4), is an honest **pre-transport report** from
the closed set `awaiting-transport(offline)` ·
`awaiting-transport(transport-unreachable)` ·
`awaiting-transport(carrier-refused-retriable)`. These are
adapter conditions, never verdicts about a party, never visible to
a receiver, and they end the moment the submission enters the
trias. Silence is not one of them: an adapter that reports nothing
within its declared horizon is nonconformant, and that rule —
not a shortened delivery time — is what the forty-minute
CONNECTING socket of the field record would have caught.

**Custody before the trias.** A pre-transport report says where a
document is not yet; it hands nothing over. The sender keeps the
document until a service has taken it or the sender has stopped
submitting it, and that holds across a lock of the holder and the
end of its process alike. *Cessation of submission under the
applicable policy* is the sender's own give-up — the adapter's
declared horizon, `failed(expired-by-adapter-policy)`; a type's
sender lifetime, `failed(task-expired)` (RLTP-DEL-6110); any other
`failed` the trias records — and, for an acknowledgement, the end
of its retries (RLTP-DEL-6330).

**RLTP-DEL-6120** — An awaiting-transport report MUST NOT relinquish
durable custody: the sender MUST retain the exact outbound envelope
and make it recoverable until durable service acceptance or
cessation of submission under the applicable policy; custody
introduces no additional delivery status.

**RLTP-DEL-6125** — A sender MUST hand a document to an adapter only
from an active holder state: one that is open and has been neither
locked nor ended since.

**RLTP-DEL-6130** — A copy, list, or snapshot of outbound documents
taken before a lock or the end of a process MUST NOT authorize a
submission after it; a submission after reopening MUST rest on the
holder state as that opening finds it, with the transitions due by
then (RLTP-DEL-6110, the adapter's horizon) applied first. A type's
sender lifetime runs from the type's own timestamp (RLTP-DEL-7020);
the adapter's horizon runs from the first submission as the sender
recorded it, also for an adapter instance that takes a document over
after a reopening; neither a reopening nor a new adapter instance
restarts either.

**RLTP-DEL-6135** — A sender MUST NOT submit a document whose
transitions due at the time of submission could not be applied, nor
read a document's absence from what its holder offers as leave to
keep submitting it.

*Rationale.* `accepted` begins at the service. Until then only the
sender knows the document is owed, and if a report that it
waits were enough to let the sender forget it, a lock or a crash
between the report and the service would lose it with nobody left
to submit it again. The rule puts custody where the status already lives, in the
holder: the envelope is stored there once, sealed, and re-offered
byte-identical, so the copy an adapter holds is volatile and bound
to an open holder state. Custody is no fourth state; the closed set
of 6.1 is unchanged and the reports keep their meaning. Two limits
are stated plainly. A copy an adapter handed to a service before a
lock is beyond recall, and a crash between a service's acceptance
and the stored report makes the sender submit again; the receiver's
stage 4 absorbs the duplicate (6.3), so at-least-once is kept and
no second effect arises, but no rule here makes a hand-over
exactly-once. And custody is not a draft store: what a person wrote
and never turned into a document is the application's affair.

The second half bounds who may submit. A lock ends the authority of
everything taken from the holder before it, so a locked device sends
nothing it kept in memory, and a reopened holder decides afresh: a
document that expired or was given up while the holder was closed
(RLTP-DEL-6115) is not revived by an older copy. Where the due
transitions cannot be applied — the store refuses the write, say —
the sender submits nothing rather than guess; and where its holder
no longer offers a document, the absence means *stop*, never
*carry on*.

**RLTP-DEL-6150** — Beside the documents in its custody, a sender MAY
offer an adapter its documents that are `accepted` and not terminal —
`held` or not — with their sealed envelope and the first submission it
recorded, for one purpose only: that the adapter binds a counterpart's
answer to them (4.6; the VTI mediator adapter profile, its
RLTP-VTI-5065). Such an offer is no custody: it authorizes no hand-over
and no deposit, and a document's presence in it is no leave to submit
it, as its absence from the custody set never is (RLTP-DEL-6135). What an answer
bound to an offered or a custody document decides reaches the sender as
any report does (6.1); the adapter profile states when the carrier's
copy of the answer may go (the VTI mediator adapter: after the sender
recorded the report, its RLTP-VTI-5080).

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
    S8 -- beyond a declared rate --> RL[failed rate-limited, nothing committed, not concluded]
    S8 --> S9[stage 9 critical section under the lock set]
    S9 --> EO[own challenge open: record-creating effect]
    S9 --> ER[recorded: the record decides]
    S9 --> EU[unknown: failed validation-failed]
    S9 --> DS[discarded: the section's discard state, no ack, no cache entry]
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
   stage 9 committed a defined effect; a digest previously rejected
   at any stage, disposed `failed(rate-limited)` or disposed
   `discarded` is NOT in it and is re-evaluated in full. Duplicate →
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
   (Section 4, incl. the issuance window for bundles, and a type's
   declared age bound and rate where the type places them here) —
   else `failed(validation-failed)` / `failed(stale-issuance)` /
   `failed(rate-limited)`; **one exception:** a bundle whose bound challenge provisionally
   resolves `unknown` (the resolution itself has already latched any
   held aged value — Encounter 5.3) skips the rest of this stage and
   enters stage 9, where the authoritative resolution decides:
   still `unknown` → dispose; any other state → release and
   re-enter at stage 4 (4.1 check 5);
9. **gates and effect, serialized per lock set:** stage 9 is a
   critical section whose **lock set** is the document digest; for
   bundles, additionally the credential's bound challenge (the
   **record key**); for chunked star documents, additionally the
   assembly key (tuple, salt) (4.4); for the types named below,
   additionally a relationship key or a credential-digest key
   (RLTP-DEL-6210, RLTP-DEL-6220). The lock protocol, normatively:
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
   and for every other type the checks and the effect its
   registering specification places there, including a block
   (below), each effect committed as one durable
   transaction (record where created, accepted material, cache
   entry, **the acknowledgement document itself where the type
   acknowledges, retained together with the cache entry per 4.2**;
   4.1) → `unique`; a transaction that commits only a registering
   specification's discarding state → `discarded` (below).

**Validate, then consume:** no stage before 9 consumes single-use
material, and stage 9 consumes only after 1–8 passed in full — for a
bundle that includes the issuance window, so **nothing that stage 9
records can subsequently fail** (the poisoning rule, closed).

**Lock keys a registering specification adds.** The digest key
serializes copies of one document; a registering specification that
checks a state shared by several documents names the key of that
state, and the protocol above acquires it with the rest of the set.

**RLTP-DEL-6210** — The stage-9 lock set of a `message/0.1` document,
of a `membership-invite` document that Message Tasks 6.2 attributes
to a relationship, and of every other document whose block treatment
is in effect (RLTP-DEL-6240) and is *discard* (Message Tasks 6.3),
MUST include the key of the relationship the document is attributed
to (Message Tasks RLTP-MSG-4230).

**RLTP-DEL-6220** — The stage-9 lock set of every `membership-invite`
document MUST include the holder-wide key of its credential digest
(Membership Tasks RLTP-MT-2180), whether or not the invitation is
attributed to a relationship (Message Tasks RLTP-MSG-6330).

**RLTP-DEL-6230** — A holder-local operation that a registering
specification names as a writer of such a key (Message Tasks
RLTP-MSG-4240: setting or clearing a block, a chaining, merge or
split that moves the relationship, the deletion of a
completion-record entry) MUST acquire the key under the protocol of
stage 9 before it commits: with every other key it needs in one
acquisition, holding nothing while it waits, and deciding on the
state it reads after the wait.

*Rationale.* A key per relationship serializes every message and
every attributed invitation of one relationship, as the assembly key
does for the chunks of one star, so two documents at the last unit of
a rate cannot both pass. The credential digest is an invitation's
identity across every path it can arrive on: two envelopes of one
invitation under two relationships, or under none, share that key
and no other. The writers that change what these checks read take
the same key, so nothing a check read can change before its commit.
One acquisition for the whole set keeps the rule of stage 9 that no
evaluation holds part of a set while it waits.

**The block of a relationship.** A holder may block a relationship
(Message Tasks Section 6): holder-local state, never sent, under
which offers and content of that relationship are discarded while the
protocol steps continue.

**RLTP-DEL-6240** — A receiver that holds a block on the
relationship a document is attributed to (Message Tasks 6.2) MUST
evaluate the document through stages 1 to 8 as without the block, and
MUST apply inside the stage-9 critical section, on the block state it
reads there, the treatment Message Tasks 6.3 names for the
document's type, where that treatment is in effect.

**RLTP-DEL-6245** — A block treatment MUST be in effect for a type
exactly when the specification that registers the type defines it:
for `message/0.1` by Message Tasks itself, for every other type by
that type's own specification taking up the change Message Tasks
Appendix A names (Message Tasks RLTP-MSG-6240); for a type without
one, a block MUST NOT change the evaluation.

**RLTP-DEL-6250** — A block MUST NOT change the evaluation of a
terminal document (4.2).

**RLTP-DEL-6260** — A document whose treatment under a block is
*discard* MUST be disposed `unique`, with its completed-effect cache
entry and its acknowledgement: the record that prevents its
reappearance is its defined effect (Message Tasks RLTP-MSG-6220), and
it is not the disposition `discarded`.

*Rationale.* The treatment of a type is part of that type's defined
effect, which only its registering specification can change (4.4);
this contract applies a treatment where one is defined and nowhere
else, so a type whose specification has not taken the block up runs
as it always did. Stages 1 to 8 decide what a document is and whether it
is authentic, which a block does not change; an acknowledgement still
attests a durable defined effect and never a human decision (4.2), so
a blocked sender observes what an unblocked one would. A terminal
document carries the sender's own status and touches no
relationship's offers. Reading the block inside the critical section
makes a block set concurrently with an arrival apply to one of them
whole.

**A declared rate.** A registering specification may bound what one
relationship can make a receiver accept and hold (Message Tasks
4.2).

**RLTP-DEL-6270** — A receiver MUST dispose a document beyond a
bound its type declares `failed(rate-limited)`, at stage 8 or inside
the stage-9 critical section as the type places the check, committing
nothing, producing no acknowledgement, and entering no completed-effect
cache entry.

**RLTP-DEL-6280** — A receiver MUST evaluate a document it disposed
`failed(rate-limited)` in full when the document is delivered again.

*Rationale.* A rate refusal is a statement about the receiver's state
now, not about the document; deciding the document would turn a
temporary limit into a permanent loss. It is therefore the one
failure that is transient (RLTP-DEL-5820): the document stays with the
carrier and is evaluated again later, under the carrier's give-up
horizon and under any age bound its type declares (Section 7).

**The disposition `discarded`.** A registering specification may
require a receiver to commit a state that ends a delivery without its
defined effect. Today these are the Trust Layer's star and group-star
assemblies: an open assembly discarded at a local resource limit
(Trust RLTP-TRU-5365), or an assembly whose delivery the recipient
rejects as a whole on a rule of Trust 5.2a or 5.2b after the chunk
authenticated (for example RLTP-TRU-5260 to RLTP-TRU-5310,
RLTP-TRU-5500, RLTP-TRU-5510), the discarded salt then held as a lower
bound (RLTP-TRU-5366).

**RLTP-DEL-6290** — A receiver MUST dispose `discarded` a document
whose stage-9 transaction commits the discarding state its
registering specification prescribes and no defined effect.

**RLTP-DEL-6300** — A receiver MUST NOT acknowledge a document it
disposes `discarded`.

**RLTP-DEL-6305** — A receiver MUST NOT enter a document it disposes
`discarded` into the completed-effect cache.

**RLTP-DEL-6310** — A receiver MUST conclude a document disposed
`discarded` toward its carrier (5a.8) only after the transaction
recording the discarding state has committed.

**RLTP-DEL-6320** — A receiver MUST evaluate a redelivered document
it disposed `discarded` afresh, the discarding state of its
registering specification deciding the outcome.

*Rationale.* The discarding state is what keeps the delivery from
completing later out of other chunks; it has to be durable before
anything tells the carrier the document is decided. An acknowledgement
would tell the sender the chunk took effect, and for the star the
sender's completion is computed from acknowledgements (Trust 5.4), so
a discarded delivery must not earn one; the sender sends again under a
new salt. The cache holds completed effects only, so a redelivered
copy of the discarded chunk is evaluated again and meets the lower
bound (RLTP-TRU-5366 rejects it as `failed(validation-failed)`). A
transaction that cannot commit leaves the document transient
(RLTP-DEL-5810), never `discarded`.

**RLTP-DEL-6325** — A redelivered chunk whose own effect completed
before its assembly was discarded MUST be answered at stage 4 as
`duplicate-known`, with its stored acknowledgement re-sent, while its
cache entry is retained; the lower bound of the discarding state
governs only documents evaluated afresh.

*Rationale.* The earlier chunk's buffering did happen, and its
acknowledgement said so; re-sending it is byte-identical and changes
nothing at the sender, whose delivery cannot complete because the
chunk that met the discard earns no acknowledgement (Trust 5.4).
Reading Trust RLTP-TRU-5366 ("none of them is acknowledged") as
reaching such a duplicate would make stage 4 depend on a later state
of the assembly, which it never reads; the Trust Layer's next casting
aligns its wording with this rule.

**RLTP-DEL-6330** — A receiver MUST keep offering a stored
acknowledgement to its adapter, under the retry policy that applies
to it, until a service durably accepts it or that policy ends its
retries; an awaiting-transport report ends neither the retries nor
the custody of RLTP-DEL-6120. The retries run from the commit of
the effect. A re-send answering a stage-4 duplicate is one hand-over
of its own: it starts no new retries, and a later redelivery of the
document is what asks for the next one.

**RLTP-DEL-6335** — The end of an acknowledgement's retries MUST NOT
discard it: the stored acknowledgement stays retained with its
completed-effect cache entry for the retention of 4.2 and is the
document re-sent, byte-identical, on a stage-4 duplicate.

*Rationale.* An acknowledgement is an outbound document like any
other, but it has no trias of its own — nothing acknowledges it — so
its sending ends either at a service's acceptance or when the retry
policy gives up. Two bounds do two jobs. The retry bound decides how
long the receiver pushes the acknowledgement on its own; the
retention bound (`key-retention`, 4.2) decides how long it can still
answer a duplicate with the same bytes. Tying the second to the first
would turn every redelivery after the retries into a fresh
evaluation that a duplicate should never need, and would break the
byte-identity 4.2 promises within the retention bound.

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
reconciled by **Encounter 0.31 (wire 0.25), 4.2 and 5.8**: both are valid, a late
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
arrival time for validity. A registered type may bound the age of a
document by a timestamp of its own:

**RLTP-DEL-7010** — A registered type MAY declare an age bound on a
timestamp inside its own protected payload, together with the time
a receiver compares it with and the stage at which it is checked.

**RLTP-DEL-7015** — A receiver MUST dispose a document outside the
age bound its type declares `failed(stale-issuance)`, without effect,
at the stage the type names.

**RLTP-DEL-7020** — A type that declares an age bound MUST declare a
sender lifetime, measured from the same timestamp, that ends before
the bound (6.1, RLTP-DEL-6110).

*Rationale.* For such a type, delivery time does affect validity: a
document the carriers hold beyond the bound is refused. That is the
type's choice and its specification states why it needs it (for
`message/0.1`, a receiver may forget per-message state after the
bound, Message Tasks 4.4). The timestamp sits inside the payload's
proof, so neither a carrier nor a third party can move it; the sender
can, and an age bound therefore bounds how long a receiver keeps
state for an honest sender, not what a dishonest one can send. The
sender's lifetime ends first on the numbers; in time it ends first
only while the two clocks differ by less than the margin between
lifetime and bound. A receiver clock further ahead refuses a document
its sender still retries, which costs that document's delivery and
nothing else: the refusal is terminal, its sender sees no
acknowledgement, and the sender's own lifetime ends the retries.

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
  a signature-class ack requires the acknowledging anchor's key; a
  DV-class ack is forgeable by exactly the two relationship parties
  — deniability by design, and toward third parties it proves
  nothing (the class rule of 4.2/4.4). Replaying either is
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
- **Principal-free submission is a deliberate exposure, bounded
  by resources.** Without a sender identity there is no sender ban
  and no sender quota, so a carrier's levers against flooding are
  resource-shaped and its own (4.4). Admission is where this
  contract is most easily defeated **from behind**: an admission
  rule keyed to an account, an invitation, a device certificate,
  or any person-wide counter would re-identify every principal of
  a person at the moment of admission and undo all of 5a at
  once — hence the metering scale (per submission or per queue,
  never per person or inferred submitter) is fixed by this
  contract and not negotiable by the carrier (5a.4, 5a.5). What
  the resource lever does **not** reach is named in 5a.5: a party
  holding an `rkid` spends that queue's own budget — a denial of
  service against one relationship, whose storage reach ends at
  every other queue's guaranteed floor (4.4 guarantee 5). Cured
  by rotation and never by identification; the closure beyond
  that is deferred as DO-6 rather than improvised.
- **A public address plus an unproved registration would be a
  queue hijack, and is not.** An `rkid` is public by construction —
  it is on every envelope and in every card — so a registration
  that merely *asserted* ownership would let any observer bind a
  stranger's address to a principal of its own and collect,
  conclude, and thereby destroy that relationship's deliveries
  (decrypting nothing). 5a.3 closes this with the only instrument
  available once the derivation deliberately shares no computable
  relation with the address: a **proof of possession of both
  halves** — a signature under the principal and the decryption of
  a challenge sealed to the `rkid` — bound into one signature over
  principal, address, carrier string, and both challenges, so that
  no half can be transplanted from another exchange.
- **Possession proofs bound theft, not volume — so registration
  is bounded separately.** Proving possession stops an attacker
  from taking *someone else's* queue; it says nothing about an
  attacker minting arbitrarily many pairs of its own. That Sybil
  surface is closed the way this stack closes Sybil surfaces
  everywhere: resource-shaped, with retriable, deterministic
  refusals and no statement about the party (4.4 guarantee 2,
  5a.3). Two rules keep the defence from becoming the attack:
  **no asymmetric operation before the decision to spend on it**
  (4.4 guarantee 3 — a carrier that seals challenges first and
  decides afterwards can be made to do unbounded work by an
  unauthenticated party), and **nothing durable is allocated
  before both proofs verify** — durable state begins with the
  binding, so the pre-verification phase leaves nothing behind an
  attacker could aim at.
- **A second residual, and it is not the flood: door
  starvation.** An identity-free request flood can keep new
  onboarding — and the return of an already-released address — at
  one carrier starved indefinitely (5a.5). What bounds it is not
  time but **reach**: every binding the carrier still holds is
  beyond it (4.4 guarantee 4), so restore, rotation and rebind of
  a relationship whose address the attacker does not know cannot
  be starved at all. Every remedy beyond that would have to
  distinguish the attacker from an honest newcomer, which is
  sender identity by another name; the levers that remain are
  priced admission and the plural carrier world.
- **The flooding residual is classified, not merely conceded**
  (5a.5): against a **third party** holding an old address the
  rules terminate the attack — rotation removes the address, the
  new one travels only inside the relationship, the old queue
  winds up and is concluded. What remains is the **relationship
  insider**, and it carries the three properties this stack
  already accepts for fork spam in the Replication Contract: the
  cost falls on the attacker's own relationship, the artifacts are
  attributable within it, and the answer is social — ending the
  relationship — never mechanical suppression. A party who learns
  rotated addresses *continuously* is either that insider or has
  **compromised the insider's endpoint**; endpoint compromise is
  outside this contract, and no carrier rule reaches it.
- **A control principal is a signing identity and nothing else.**
  Compromise of a principal's key lets an attacker collect and
  conclude for one relationship at one carrier; it decrypts
  nothing (sealing is to the `rkid`, Section 5) and reaches no
  other principal, because principals share no derivation path
  (Identity §7a.4). The blast radius is one relationship at one
  carrier — which is what per-(relationship × carrier)
  granularity buys on the compromise side, not only the privacy
  side.
- **A block changes no disposition a sender can see.** Under a block
  stages 1 to 8 run unchanged, a discarded offer or message is still
  `unique` with its acknowledgement, and a terminal document is never
  affected (RLTP-DEL-6240 to RLTP-DEL-6260). What a blocked party can
  still infer is a matter of the registering specification's
  treatments, and Message Tasks Section 7 names those residues.
- **A rate refusal leaves work at the carrier.** A document beyond a
  declared rate is not concluded (RLTP-DEL-5820): it keeps its place in
  the queue and is offered again at each collection, and each offer
  costs the receiver stages 1 to 8 again. For a relationship's own
  address the cost stays inside that relationship's queue (4.4
  guarantees 4 and 5), and the carrier's give-up horizon ends it; a
  type's age bound ends it earlier only where the type checks the
  bound before its rate. **One queue is shared:** invitations travel
  to the invitee's member key, the key of an identity context, which
  every inviter to the same group uses. An inviter that sends beyond
  its rate fills that queue up to `max-queue-bytes`, and another
  inviter's invitation to the same group then meets a retriable
  refusal until the carrier gives the excess up. A block does not
  stop it, because the rate is counted before the block (Message
  Tasks RLTP-MSG-4130). The reach is one group context of one holder;
  the residual is recorded as DO-8.
- **A transaction that cannot be committed whole** commits nothing and
  stays with the carrier (RLTP-DEL-5810). A document whose effect can
  never fit the device's storage is offered until the carrier gives it
  up; nothing is lost silently and no partial state is concluded, and
  the sender sees `failed(expired-by-adapter-policy)`. That is an
  availability residual, not a correctness one.
- **A discarded delivery earns nothing.** A chunk disposed `discarded`
  earns no acknowledgement, so its sender's delivery does not
  complete and the sender sends again under a new salt (Trust 5.4).
  Only the counterpart of the tuple can produce an authenticated chunk,
  so only the counterpart can make a receiver discard that
  counterpart's own delivery.
- **A key of an identity context has no tombstone.** An envelope
  sealed to a member key the holder no longer holds fails at stage 2;
  once the holder derives the context again for a new invitation, an
  old envelope sealed to the same key, replayed by whoever captured
  it, decrypts again and, after its cache entry has expired, is
  evaluated afresh, and may surface again where the registering
  specification keeps no record of it. What this contract does not
  bound, the registering specification does: an accept to an
  invitation past its window is refused (Membership Tasks
  RLTP-MT-5050), and where it keeps the register of invitations
  declined under a block (Message Tasks 6.4), those never surface
  again. Forward secrecy is not a property of a key the holder
  derives again by design.
- **`failed(task-expired)` is the sender's decision, not a recall.** A
  copy an adapter holds may still be delivered and accepted inside the
  receiver's age bound (RLTP-DEL-6110, RLTP-DEL-7010).
- **A holder-wide lock key serializes one invitation, not a holder.**
  Every envelope of one invitation credential waits on the same key
  (RLTP-DEL-6220); envelopes of other invitations, and every other
  document, do not.
- **Custody is a duty, not a recall** (RLTP-DEL-6120 to
  RLTP-DEL-6135). A sender keeps what waits for transport across a
  lock and a crash, so neither loses a document; a lock withdraws
  the authority to submit, so a locked device hands nothing over.
  Neither recalls a copy a service already took, and a crash between
  acceptance and the stored report submits again: duplicates are
  absorbed at the receiver's stage 4 (6.3), never turned into a
  second effect. An implementation that keeps an adapter-side store
  of its own beside the holder's reintroduces the split this rule
  removes: two stores that disagree on whether a document is still
  owed resend an expired one or drop a live one.
- **An acknowledgement outlives its retries** (RLTP-DEL-6330,
  RLTP-DEL-6335). A receiver that discarded an acknowledgement when
  its retries ended would answer a later duplicate with a freshly
  generated one, or with none; keeping it to the retention bound keeps
  the answer byte-identical and the sender's status unchanged.

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
  separated — this is why 5a.7 is a SHOULD with its price named,
  and it is the strongest residual join that remains. *The network
  layer:* without network anonymity a carrier sees addresses; that
  is deployment terrain and is not argued away here. *Colluding
  carriers:* two carriers comparing traffic correlate by time and
  volume — and, **stated exactly rather than left to the weaker
  word**, by something sharper than analysis. An `rkid` is per
  **relationship**, not per (relationship × carrier): a recipient
  may register the same address at two carriers, and those two
  then hold **byte-identical** values and can join their views by
  equality alone, with no timing and no inference. What that join
  reaches is bounded and worth being precise about: it links **the
  two carriers' views of one and the same relationship**, which is
  the relationship each of them already carries — it does **not**
  link two different relationships of one person, which is the
  property 5a.1 and Identity §7a.4 exist to protect and which the
  principals continue to protect (they share no derivation path
  across carriers). A recipient who does not want even that link
  uses **different `rkid`s at different carriers**, which the
  contract has always permitted (5a.2: arbitrarily many `rkid`s,
  one relationship). The derivation defeats the shared list; it
  was never claimed to defeat a shared address the recipient
  itself handed to both. *Migrated identities:* they carry the previous
  generation's exposure forward, and 5a.6 helps them prospectively
  only. *One operator in both roles:* 5a.6's MUST is an identity
  and interface rule and is checkable as one — distinct
  identities, distinct sessions, no cross-role answer — but it
  cannot reach an operator that joins a recovery context with a
  person's control principals **behind** that interface, through
  addresses, timing, telemetry, or billing; the residual is named
  there rather than defined away, and the only full answer to it
  is two operators. *A rebind:* a carrier that sees one `rkid`
  successively bound to two principals (5a.3) learns a link
  **within the one relationship it already carries**, and nothing
  across relationships. **No unlinkability claim follows from this
  section**, and implementations MUST NOT present one — the same
  boundary 5a.4 draws from the submission side, and the two
  statements MUST NOT drift apart.
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
- **What a carrier learns from a transient disposition.** A
  rate-limited document stays unconcluded and is offered again, so a
  carrier that watches conclusions learns that some documents of a
  queue stay undecided: the relationship's sender went beyond a rate,
  or the receiver had a local fault, which look alike. Because the
  rate is counted before the block, this tells the carrier nothing
  about a block. A document discarded under a block, or disposed
  `discarded`, is concluded like an accepted one, and a conclusion
  carries no reason (5a.8).
- **What waits for transport stays on the device, sealed.** Custody
  (RLTP-DEL-6120) keeps the outbound envelope — ciphertext to the
  recipient's card key — with its recipient address until a service
  takes it or the sender stops; an acknowledgement stays to the
  retention bound (RLTP-DEL-6335). A device inspected while locked
  holds these envelopes and the addresses they go to, as it already
  holds its effect cache; nothing new reaches a carrier.

## 11. Conformance

- **Profile** `rltp-delivery@0.85`; the Identity pin is
  **Identity 0.55** (§6.1 the context labels, §7a the control
  principal); the Encounter pin is `rltp-encounter@0.32` (wire
  0.25); companion registrations per 4.4 (Trust Layer 0.31,
  Access 0.58, Membership Tasks 0.21.1, Replication 0.26, Message
  Tasks 0.2).
- **Classes:** *sender* (sealing, status trias including
  `failed(task-expired)`, ack-wait switch trigger; principal-free
  submission, 5a.4; `held` of 6.1) · *carrier of Trust Task
  documents* (the carried document of 4.6, built under RLTP-DEL-5040
  and taken apart under RLTP-DEL-5030) · *receiver* (unsealing, staged dispositions
  including `discarded` and the transient `failed(rate-limited)`,
  the lock keys and the block of 6.2, the key classes of Section 5,
  ack generation; the addressing
  triple of 5a.1, per-relationship `rkid`s 5a.2, the registration
  proofs of 5a.3, the role separation of 5a.6, the collection
  discipline of 5a.7, the conclusion duty of 5a.8) · adapters are
  below the port line, but **every** adapter declares
  `status-horizon` and reports a trias state or a pre-transport
  condition within it (4.4, 6.1). A **carrier** is an adapter and
  conforms through 4.4's carrier role: it publishes the seven
  declared constants and honours the five guarantees, binds no
  address without both possession proofs (5a.3), admits on the
  closed outcome set with the fixed metering scale (5a.5),
  answers no query across principals, concludes or gives up every
  admitted deposit rather than dropping it (5a.8), and winds
  orphaned bindings up on its published horizons (5a.1, 5a.9). An
  adapter for a neighbouring carrier form conforms additionally
  through 5a.10.
- **Normative schemas (shipped):**
  `schemas/rltp-delivery-document.schema.json` ·
  `schemas/sealed-envelope.schema.json` ·
  `schemas/payload-encounter-bundle.schema.json` ·
  `schemas/payload-delivery-ack.schema.json` ·
  `schemas/payload-encounter-credential-delivery.schema.json` ·
  `schemas/payload-registry-declaration.schema.json` ·
  **`schemas/carrier-proof.schema.json`** (`rltp-carrier-proof/0.3`,
  the proof form of 5a.3 in all four of its purposes — the one
  artifact of this contract that travels below the port line and
  is nevertheless signed, so its bytes are fixed and its shape is
  shipped) — plus, by reference through 4.4, the
  companion-registered payload schemas named there.
- **Schema validity is not acceptance (5a.3).** A carrier
  conforms only if it **decodes** the base58btc identifiers of a
  proof before any other check and refuses `malformed` unless
  `principal` is `0xed 0x01` followed by exactly 32 bytes, `rkid`
  is `0xec 0x01` followed by exactly 32 bytes, and `sig` is
  exactly **64** bytes. The shipped schema **cannot** express
  these, and says so in its own description: base58btc is not
  positional, so a decoded prefix or length is a numeric interval
  no pattern in this dialect states. `vectors/carrier-proof.json`
  ships six schema-valid, normatively invalid aliases — two per
  field — plus the positive control that the shipped proof itself
  decodes. An implementation that stops at schema validation
  **fails this section**. *(On the version string in that file:
  `rltp-carrier-proof/0.3` is versioned independently of the
  `rltp-delivery@` profile; the coherence scan treats it as an
  artifact of its own.)*
- **Shipped vectors:** `vectors/seal.json` (5) ·
  **`vectors/carrier-proof.json`** (5a.3) — the registration
  proof object, its JCS bytes and signature; the `collect` and
  `conclude` forms with their absent fields; six transplant
  negatives (second `rkid`, second carrier, second principal,
  changed `purpose`, foreign domain tag, replaced challenge),
  each of which changes the signed bytes so the shipped signature
  fails; six encoding aliases with decoded lengths and prefixes;
  the **challenge-consumption** sequence (a failed verification
  does not restore the challenge); the **duplicate** cases
  (byte-identical replay against re-sealed repetition, 5a.5); the
  **generation-monotonicity** cases, whose counter-vector is a
  device restored from an older backup presenting valid proofs
  and still not moving the binding; the **generation-spelling**
  negatives (two that reach the signature, two that die in the
  parser); the **equal-generation tie** run end to end (converge,
  refuse, rotate with a fresh nonce whose principal is derived in
  the vector, bind), with the tie at the generation maximum,
  where no rotation exists and the binding stands and stays
  collectable; the **released-then-re-registered** case, where
  the tombstone refuses a superseded generation after the binding
  itself is gone; the **carrier-entry-loss recovery**, executed
  per held state; and the **queue-floor** case that decides
  guarantee 5 — a queue one byte below its floor, admitted
  regardless of global occupancy · **`vectors/vti-sealed-envelope.json`**
  (4.6, RLTP-DEL-5030, RLTP-DEL-5040) — the carried document and its
  binding envelope byte for byte, its `id`, a repeat byte-identical,
  the documents a carrier does not hand on, and the answers of a
  framework consumer with the sender state each leaves, `held`
  included (RLTP-DEL-6140).
- **Vector plan:** seal/unseal roundtrip against the shipped
  vector · digest invariance under re-sealing · every disposition
  stage of 6.2 as a distinct vector, in-order (including oversize
  before decryption, tag-only ciphertext as `malformed`, unknown
  `rkid`, all-zero secret rejection) · validate-then-consume (a
  bundle failing stage 8 consumes nothing) · duplicate and
  concurrent delivery converge with identical re-ack · **ack
  forgery matrix:** unsigned ack rejected, foreign-signed
  rejected, wrong-thread rejected, wrong-direction rejected,
  valid ack accepted, late valid ack transitions
  `failed → delivered` · **ack class matrix** (shipped: `vectors/delivery-ack.json` —
  derivation, preimage, MAC, tampered/wrong-direction/wrong-key/
  missing-proof negatives): signature-form ack
  for a DV payload rejected, MAC-form ack for a signature payload
  rejected, MAC under a wrong key rejected, valid MAC-form ack
  accepted · ack generation at each type's defined
  effect, none on rejection, no dependency on the confirmation
  step · outer/inner consistency vectors per type
  (Mallory-wrapped credential produces no ack to Mallory) ·
  `ceremony` member absent (accepted), present-and-matching
  (accepted), present-and-wrong (rejected) · threadId rules per
  type · status trias transitions including every failure reason ·
  **record-aware effect:** bundle after optical completion →
  accepted via record + ack · binding mismatch against record →
  rejected, nothing consumed · enclosed card not JCS-identical to
  the record's stored counterparty card →
  `failed(validation-failed)` · conflicting or re-proofed
  credential on an existing record → `failed(validation-failed)`,
  no ack · every Encounter 5.6 rejection exercised on the
  record-aware path · optical record creation racing a bundle
  between stage 8 and stage 9 → branch re-selected inside the
  critical section, accepted via record, never
  `failed(consumed-challenge)` · two bundles with distinct
  digests competing for one challenge → exactly one
  record-creating effect · crash after a record-aware commit and
  before ack transmission → redelivery yields the mandatory
  byte-identical re-ack · resolution selects every branch: `open`
  → record-creating, `recorded` → record decides, `unknown` →
  `failed(validation-failed)` · envelope sealed to a retired
  (tombstoned) `rkid` → passes stage 2, fails stage 3
  `failed(decryption-failed)`; `rkid` never issued →
  `failed(malformed)` at stage 2 · redelivered `delivery-ack` →
  `duplicate-known`, no ack-of-ack, sender status unchanged ·
  invalid JSON inside a valid seal → `failed(malformed)` at
  stage 4 · concurrent first deliveries → exactly one `unique`,
  one `duplicate-known`, identical acks · key retirement never
  precedes the declared adapter horizon · a companion-registered
  type with a registry entry → dispatched to its own
  specification's consistency rules; the same type absent from
  the registry → `failed(unknown-type)` per 6.2, no effect ·
  **key classes:** an address key past its retention → tombstone,
  a later envelope to it passes stage 2 and fails stage 3
  `failed(decryption-failed)`; a member key leaving the holder →
  no tombstone, an envelope to it `failed(malformed)` at stage 2,
  and after the group context is derived again the envelope
  decrypts (RLTP-DEL-5010, RLTP-DEL-5020) · **`discarded`:** a star
  chunk over the receiver's resource limit → `discarded`, no ack,
  no cache entry, concluded only after the commit; a crash before
  the commit → transient, offered again; the same chunk delivered
  again after the commit → `failed(validation-failed)` under the
  held lower bound; an earlier chunk of the discarded assembly
  delivered again while its cache entry is retained →
  `duplicate-known` with its stored ack, the delivery still never
  completing (RLTP-DEL-6325); an authenticated chunk breaking an assembly
  rule of Trust 5.2a → `discarded` with the same consequences
  (RLTP-DEL-6290 to RLTP-DEL-6320) · **rate:** a `message/0.1`
  document beyond the bound of Message Tasks 4.2 →
  `failed(rate-limited)`, nothing committed, no ack, not concluded;
  the same document delivered again under a rate with room →
  evaluated in full and accepted; a rate-limited document concluded
  → nonconformant (RLTP-DEL-5820, RLTP-DEL-6270, RLTP-DEL-6280) ·
  **block:** each row of the table of Message Tasks 6.3 whose
  treatment is in effect (RLTP-DEL-6245) under a block, stages 1 to
  8 unchanged, a discarded message `unique` with
  its ack; a `delivery-ack` under a block → evaluated as without it;
  a block set between stage 8 and stage 9 → applied on the state read
  in stage 9; a type whose registering specification defines no
  block treatment, such as `membership-invite/0.2` under a
  Membership Tasks casting that defines none → evaluated, and its
  defined effect committed, as without the block (RLTP-DEL-6240 to
  RLTP-DEL-6260) · **lock keys:** two
  messages of one relationship at the last unit of its rate →
  exactly one accepted; one invitation credential in two envelopes
  under two relationships, one of them blocked, where the
  invitation's registering specification defines its block
  treatment → no open prompt and the credential digest in the
  register, whichever commits first, and both envelopes serialized
  on the credential-digest key in every case; a
  block set while a message waits → the message re-enters at stage 4
  and sees the block (RLTP-DEL-6210 to RLTP-DEL-6230) · **age bound
  and lifetime:** a `message/0.1` document past its age bound,
  found in stage 9 → `failed(stale-issuance)`, terminal and
  concluded toward the carrier; a sender past the declared lifetime →
  `failed(task-expired)`, no further hand-over, and a valid
  acknowledgement arriving later → `delivered` (RLTP-DEL-6110,
  RLTP-DEL-6115, RLTP-DEL-7015, RLTP-DEL-7020) · **custody:** a
  document reported `awaiting-transport`, then the holder locked and
  its process ended → after reopening it is offered again,
  byte-identical, and reaches the service; the same document past its
  lifetime or the horizon when the holder reopens → given up first,
  never offered; a snapshot of outbound documents taken before the
  lock → submits nothing after it; the due give-up failing to commit
  on reopening → nothing submitted (RLTP-DEL-6120 to RLTP-DEL-6135) ·
  **acknowledgement retries:** an acknowledgement reported
  `awaiting-transport` → still offered after a lock and a restart;
  past its retry bound → no longer offered, and a duplicate within
  the retention bound re-sends it byte-identical, once, with no new
  retries — reported `awaiting-transport` and then online again, the
  next redelivery re-sends it again (RLTP-DEL-6330, RLTP-DEL-6335) · **commit not whole:** a stage-9
  transaction that fails for storage → nothing persisted, no ack, not
  concluded, evaluated again on the next delivery (RLTP-DEL-5810) ·
  `registry-declaration/0.1`: valid declaration recorded;
  without `proof` → `failed(malformed)` at stage 5 (the document
  profile requires it); foreign-signed or with a proof that does not
  verify → `failed(validation-failed)` at stage 8; nothing recorded
  in either case; replacement
  prospective-only · introduction-ack timing computed from the
  declared `ack-delay` (Trust Layer §8.4); an introduction-request
  sent without holding the mediator's declaration →
  nonconformant at the sender ·
  the derivation seam itself is executable in
  `vectors/identity-derivation.json` (`carrierRelationship`) and
  MUST be reproduced by any implementation claiming this profile:
  one relationship at two carriers → two principals with no
  computable relation; a case-variant carrier string → a third
  principal (Identity §7a.2); no key-agreement key derived for
  the class.
- **The carrier interface, clause by clause:** one `rkid`
  registered under two principals → nonconformant (5a.2) · a
  cross-principal query offered by a carrier → nonconformant; the
  same query issued by a recipient → nonconformant (5a.1) · a
  submission carrying any sender identifier **in a field of this
  contract** → nonconformant; a transport authenticating its own
  hop is not a violation of 5a.4, while an outer VID that is
  well-known, person-wide, or reused across TSP relationships is
  (5a.4, 5a.10) · an admission rule keyed to an account,
  invitation, device certificate, or any counter spanning two
  principals → nonconformant (5a.5) · a carrier acting on a
  declared constant it has not published, or a principal
  registering before it holds the carrier's declaration →
  nonconformant (4.4) · `orphan-horizon` outside `[P7D, P365D]`,
  `give-up-horizon` outside `[P1D, P90D]`, `status-horizon`
  outside `[PT5S, PT5M]`, `challenge-lifetime` outside
  `[PT5S, PT5M]`, `queue-floor` outside
  `[65536, max-queue-bytes]`, `max-queue-bytes` outside
  `[1048576, 1073741824]`, `max-binding-tombstones` outside
  `[1, 2^53 − 1]`, an integer constant outside its domain
  or in a non-canonical decimal spelling, or a duration outside
  Access §7.3's grammar (rejected, never rounded) → the
  declaration rejects (4.4) · **status horizon:** a submission
  held with no report beyond the declared horizon →
  nonconformant; an offline or unreachable adapter reporting
  `awaiting-transport(...)` within it → conformant, and the
  report MUST NOT be surfaced as a trias state (4.4, 6.1) ·
  **registration:** a binding created without both possession
  proofs → nonconformant · a signature input that is not the JCS
  serialization of the 5a.3 object with `sig` omitted, an object
  whose `v` is not byte-equal to `rltp-carrier-proof/0.3`, a
  challenge that is not exactly 32 bytes in canonical unpadded
  base64url, or a `sig` that is not canonical 64-byte base58btc →
  nonconformant · a `collect` or `conclude` proof carrying
  `generation` or `addressChallenge`, a proof of **any** purpose
  omitting `rkid`, or a `register`/`rebind` proof omitting
  `generation` or `addressChallenge` → nonconformant (5a.3 and
  the shipped schema agree: every purpose names the queue it acts
  on) · a challenge accepted twice, or without expiry →
  nonconformant; a failed verification restoring its challenge →
  nonconformant · **any randomness, sealing, or asymmetric
  operation performed for a request the carrier has not decided
  to serve** → nonconformant (4.4 guarantee 3) · **a request for
  a binding the carrier holds refused because traffic for unknown
  addresses exhausted something** → nonconformant (4.4
  guarantee 4) · a retriable refusal marked terminal, a refusal
  carrying a reason about a party, or an outcome outside the
  closed sets of 5a.3 and 5a.5 → nonconformant · **a verdict that
  is not the one the normative evaluation order names** — s1–s6
  for submissions, r1–r5 for registrations — → nonconformant,
  overlapping conditions included (round-43 B-3) ·
  **`generation`:** a rebind accepted at a generation not
  strictly greater than the recorded one → nonconformant; equal
  generation with the same principal → `registered(idempotent)`;
  equal generation with a different principal, or any lower
  generation → `refused(stale-generation)` and the binding does
  not move; **`refused(stale-generation)` without the held
  generation in it** → nonconformant, because it turns a
  recoverable loss into an unrecoverable one (5a.3, Identity
  §9.3); a carrier that *decides* the equal-generation tie →
  nonconformant, and a proof carrying any value from which the
  register's nonce ordering could be reconstructed →
  nonconformant (no such field exists; DO-7) · a `generation`
  accepted in a non-canonical decimal spelling → nonconformant
  (the check is on the received bytes; the schema cannot express
  it) · **the tombstone:** a registration for a released `rkid`
  accepted at a generation not strictly greater than the highest
  ever accepted → nonconformant; a tombstone dropped with the
  binding, or expiring **in time** → nonconformant; a tombstone
  kept beside the binding a strictly greater generation installed
  → nonconformant (it is consumed); an eviction reported to
  anyone, or used as an input to any verdict about a party →
  nonconformant; an eviction below the declared
  `max-binding-tombstones`, or of any tombstone but the
  longest-released (ties by ascending `rkid` key bytes) →
  nonconformant — the order is total and normative, its
  implementation is not (5a.3, round-43 B-2) · **the outcome table of 5a.3 is the
  conformance condition:** every cell is checked, a
  `(state, input)` answered with an outcome other than the one it
  names → nonconformant, and so is any outcome outside the closed
  set; two concurrent valid registrations for one `rkid` → exactly
  one binding (the compare-and-swap vector); a `g′ > g` proof
  under the same principal answered with anything but `rebound` →
  nonconformant; a proof refused because its `purpose` disagreed
  with the state → nonconformant · **the two loss cases:** a
  rebind attempted after total register loss (no state copy, pair
  contexts gone) → the sealed challenge is unopenable and the
  attempt fails at `refused(possession-failed)`; a rebind after
  loss of a carrier entry alone, with the pair context held →
  **succeeds, in a number of exchanges the held state fixes**:
  two from `live` or `closing` (first
  `refused(stale-generation)` carrying the held generation, then
  `rebound` at `generation + 1` — a carrier that makes it succeed
  in one accepted a generation it holds a higher record for), one
  from `unbound` (an evicted tombstone leaves no record to
  exceed), and a return may additionally meet a retriable
  `capacity` refusal, in which case **it outranks every arrival**
  (5a.9); shipped as an executed per-state vector · a carrier
  operation offering to enumerate or restore a person's
  principals after register loss → nonconformant (5a.9); a rebind
  under proof of possession of one named `rkid` → conformant, and
  the two MUST NOT be conflated · **wind-up:** a binding whose
  `orphan-horizon` passes without a collection and that never
  enters `closing` → nonconformant; a wind-up deadline that moves
  once `closing` has begun → nonconformant, as is a deposit
  admitted during `closing` given a fresh `give-up-horizon`
  rather than the remaining time to that deadline; a submission
  refused **because** the queue is closing → nonconformant, the
  address admitting exactly as a live one does; a return during
  `closing` → the binding is `live` again, the deadline is void,
  and every held deposit reverts to its admission-dated
  `give-up-horizon`; a binding released while a held deposit is
  undisposed → nonconformant; orphan expiry produces no document,
  no disposition, and no status change beyond §6.1's ordinary
  path (5a.9) · **queue floor:** a submission to a queue below
  its `queue-floor` refused for global occupancy →
  nonconformant; admission decided on the occupancy **before**
  the deposit → nonconformant (the occupancy is computed after
  admission); between floor and `max-queue-bytes` a
  `refused(capacity)` for global occupancy → conformant, and
  named as the elastic range it is (4.4 guarantee 5) ·
  **`duplicate`:** two submissions to one queue whose sealed
  envelopes are byte-identical → `duplicate`, **one** stored
  copy, admission work charged for both; the same document
  re-sealed → `admitted` twice (a key-blind carrier cannot and
  must not see through the seal; §6.2 absorbs the repetition at
  the receiver); identical bytes to a different `rkid` →
  `admitted`; a byte-identical re-presentation after the first
  deposit concluded or was given up → `admitted` (5a.5) ·
  **conclusion:** a terminal 6.2 disposition not concluded toward
  the carrier → nonconformant; a transient one concluded →
  nonconformant; a concluded digest redelivered by a carrier →
  nonconformant; a conclusion carrying any reason, stage, or
  verdict → nonconformant (5a.8); an admitted deposit discarded
  without give-up or conclusion → nonconformant; give-up at the
  declared horizon → `failed(expired-by-adapter-policy)` and only
  then storage release (5a.8, 6.1) · one identity presented for
  both storage entry and delivery collection at one party →
  nonconformant under 5a.6, **including where one process serves
  both roles** · **the three sessions:** a collection or
  conclusion for a second principal inside one authorization
  session → nonconformant (5a.3); two principals on one mediation
  connection → nonconformant (5a.10); several messages on one
  transport socket → not this contract's business · two
  authorization sessions for different principals scheduled
  inside the declared spacing → conformant but SHOULD-violating,
  and reported as such; an implementation claiming the discipline
  without declaring spacing and jitter → nonconformant (5a.7) ·
  **live delivery:** live mode activated for two principals
  inside one mediation relationship, a status or delivery flow
  reporting across relationships, or a reconnected transport's
  re-armed live mode treated as authorization → nonconformant;
  two mediation relationships multiplexed over one persistent
  transport → conformant but SHOULD-violating (5a.10) · **an
  adapter** serving two principals under one TSP outer VID, or
  one DIDComm mediation connection, keylist, pickup scope, batch,
  or receipt list → nonconformant (5a.10) · a principal mapped
  onto a nested private end-to-end VID, or onto a per-hop VID
  beyond the direct carrier → nonconformant (5a.10) · an outer
  VID that is **well-known**, **person-wide**, or **reused** in
  another TSP relationship, application, or account →
  nonconformant — while an outer VID merely being **visible** to
  its direct neighbour is conformant, because in TSP's routed
  model it cannot be otherwise; a retired one reassigned →
  nonconformant; two live outer VIDs for one principal →
  nonconformant, while a fresh one succeeding a retired one under
  an unchanged `C` → conformant (5a.10) · a DIDComm connection
  DID that is well-known, person-wide, or used in any other
  connection → nonconformant; `from_prior` emitted on a
  principal's connection → nonconformant (5a.10) · **TSP
  ingress:** a sender-side outer VID that is well-known,
  person-wide, or reused → nonconformant; a
  per-(relationship × carrier) VID → conformant, and a carrier
  authenticating its own hop is not a violation of 5a.4 (5a.4,
  5a.10); one VID per (relationship × carrier) that is the sender of
  every layer of a deposit and the collecting outer VID of the same
  relationship and carrier → conformant; a sender-side VID that is the
  control principal or derivable from it → nonconformant
  (RLTP-DEL-5990) · a change of the **direct** carrier → new principal,
  new outer VID; a change of hops beyond it → no change of
  principal, VID, or registration (5a.10) ·
  `https://real-life.org/trust-tasks/spec/delivery-carrier/0.1` used
  as a document `type` → `failed(unknown-type)` (4.4).
- **Rule coverage.** The rules with identifiers are listed in
  `conformance/delivery-rule-ids-0.85.txt`. **State-dependent** —
  each verdict needs a holder state, a clock, a cache, a carrier, or a
  registering specification's state, and the scenarios of the vector
  plan above exercise it (planned, with the reference
  implementation): RLTP-DEL-5010 · RLTP-DEL-5020 · RLTP-DEL-5810 ·
  RLTP-DEL-5820 · RLTP-DEL-6110 · RLTP-DEL-6115 · RLTP-DEL-6120 ·
  RLTP-DEL-6125 · RLTP-DEL-6130 · RLTP-DEL-6135 · RLTP-DEL-6140 ·
  RLTP-DEL-6150 ·
  RLTP-DEL-6210 ·
  RLTP-DEL-6220 · RLTP-DEL-6230 · RLTP-DEL-6240 · RLTP-DEL-6250 ·
  RLTP-DEL-6260 · RLTP-DEL-6270 · RLTP-DEL-6280 · RLTP-DEL-6290 ·
  RLTP-DEL-6300 · RLTP-DEL-6305 · RLTP-DEL-6310 · RLTP-DEL-6320 ·
  RLTP-DEL-6325 · RLTP-DEL-6330 · RLTP-DEL-6335 · RLTP-DEL-7015.
  **Schema- and fixture-checked** — the document-profile schema's
  `type` pattern and the must-fail fixtures: RLTP-DEL-3010.
  **Vector-checked** — `vectors/vti-sealed-envelope.json`, the
  carried document byte for byte, its `id`, its repeats, and the
  documents a carrier does not hand on: RLTP-DEL-4610 ·
  RLTP-DEL-4620 · RLTP-DEL-5030 · RLTP-DEL-5040.
  **Declaration** — the rule binds
  what a type's registration states or which specification defines
  a treatment: RLTP-DEL-3020 · RLTP-DEL-3030 · RLTP-DEL-4510 ·
  RLTP-DEL-4630 · RLTP-DEL-5990 · RLTP-DEL-6245 · RLTP-DEL-7010 ·
  RLTP-DEL-7020.


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
- **DO-10 Framework gaps of the document profile.** Questions the
  move to framework 0.6.0 names and leaves open:
  the MAC form of the acknowledgement's `proof` (4.2) is no Data
  Integrity proof, which a framework consumer rejects;
  the profile rule that a present `ceremony.enactment` MUST
  recompute (Section 3) constrains the member, which the framework's
  Working Draft 0.7.0 forbids a specification to do;
  this contract deduplicates by document digest (6.2 stage 4) where
  the framework rejects an equal `id` over different bytes as
  `idConflict` (TT §7.2 item 11) — for the types inside the seal,
  which no framework consumer reads; the one type a framework
  consumer reads on the wire, `sealed-envelope/0.1`, declares its
  repeated execution safe and intended and repeats byte-identical
  (4.6, RLTP-DEL-5040);
  a consumer does not reject a future `issuedAt` as
  `malformedRequest` (TT §7.2 item 13), because no stage of 6.2
  reads it;
  "absent" is no proof requirement in the vocabulary of TT §7.3
  item 8;
  every type signs with `proofPurpose` `assertionMethod`, where the
  framework's editor's draft asks a producer to sign a document for
  `authentication`;
  and a companion schema's `$id` is not its Type URI (4.4), where TT
  §7.3 item 7 asks that it be.
- **DO-11 The anchor of a declaration.** A party declares identical
  constants to all its counterparts (4.4), and two counterparts
  comparing declarations hold proof of an equivocation only if they
  recognise the same signer. Which anchor signs a
  `registry-declaration/0.1` — one per relationship or one per party —
  is not settled; the type declares `identifierScope: any` until it
  is.
- **DO-12 A `held` document without a bound.** No horizon ends a
  `held` document (RLTP-DEL-6140): it ends only on the counterpart's
  acknowledgement or validated terminal refusal, and the sender keeps
  its sealed envelope until then. Neither a bound nor a withdrawal by
  the sender is defined. A counterpart that never answers again keeps
  the document `held`.
- **DO-5 Ordering.** No global ordering is promised; thread
  causality plus the merge rule cover every current flow.
- **DO-8 A shared queue under a rate.** Documents on the key of an
  identity context share one queue across every counterpart that
  uses that context, and a rate-limited document keeps its place in
  it (Section 9). Whether such documents should be concluded rather
  than kept, which would let a carrier tell a rate refusal from a
  decision, or whether the counting belongs before the queue, is
  open.
- **DO-9 Block and lock keys across devices.** The block, the
  relationship keys and the credential-digest keys are state of one
  holder device until holder state is shared across devices.
- **DO-7 A carrier-scoped ordering proof.** *Open question, not a
  settled prohibition.* Where two register entries share a
  generation, Identity §7a.3 decides by nonce bytes and this
  contract carries no value that would let a carrier reproduce
  that decision — so an equal-generation rebind is refused and
  healed by a rotation (5a.3). A previous casting called a
  travelling tie-breaker *impossible*; that argument was wrong
  (a carrier-scoped order-preserving map exists trivially) and is
  withdrawn. What a usable construction would have to satisfy is
  written down instead, so the question can be answered rather
  than re-argued: derivable identically by both devices from
  register state alone · **authentically bound to the
  derivation**, so a presenter cannot hand a carrier an ordering
  of its choosing · analysed for what it discloses to a party that
  already holds the principal and the address · and per-carrier,
  so it is not a cross-carrier join key. Nothing in the current
  rules depends on the answer; the refusal-and-rotate path is
  complete without it, which is why this is a candidate and not a
  debt.
- **DO-6 Recipient-issued admission token.** *Deliberately not
  built in the 0.x line; kept as named candidate work rather than
  as an unstated gap.* The flooding residual of 5a.5 — anyone
  holding a public `rkid` can spend that queue's admission budget
  — is bounded to one relationship's guaranteed capacity at one
  carrier (the shared elastic room above the floors is not) and answered
  today by rotation and by a resource-shaped defence, never by
  identifying a sender. **Independent review has now twice judged
  this residual blocker-level under the rule "an attack the rules
  do not stop", and the record says so rather than softening it**:
  the sharpest form is a denial of service against **one
  relationship**, because the rate bucket is keyed to the queue
  and a flooder therefore spends the honest counterpart's
  allowance (5a.5). The editor's decision stands for the 0.x line,
  with the reasoning stated rather than assumed: the cure
  (rotation, in-relationship and terminating) is cheap and
  bounded, the blast radius is one relationship's **guaranteed**
  capacity at one carrier — the shared elastic room above the
  floors is honestly not covered — and the alternative changes
  what the carrier port *is*. The
  neighbouring deployed answer is a
  recipient-issued capability presented with each submission
  (Signal's sealed-sender delivery token), and it would close the
  part of the residual that belongs to parties the recipient never
  accepted — **not** the accepted insider, who holds such a token
  by design (Signal derives it from a profile key shared with
  accepted contacts and rotates it only on blocking), and not the
  identity-free door starvation of 5a.5, which is no submission
  at all — stated here so the candidate is not mistaken for a
  cure. **Re-evaluation trigger, stated in advance so the
  decision is revisited by evidence rather than by mood:** adapter
  evidence of *real* floods in operation — a queue's budget
  repeatedly exhausted by a party the recipient did not accept —
  not the theoretical possibility, which is already conceded. **The
  retrofit point:** a token would be presented at admission and
  checked as one of 5a.5's admissible inputs — a new casting
  would add it there, and nowhere else. Its non-negotiable
  property is fixed here in advance: per (relationship × carrier),
  or it is a person-wide credential under a friendlier name.

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
HKDF · [RFC9562] UUID (§5.8, version 8) · **RLTP Identity Layer
0.55** (normative; §5.2 the `rkid`'s
key material, §5.3 the recovery context, §6.1 the context labels,
§7 service identities,
**§7a the carrier-relationship identity**, §9.3 recovery) ·
[TT] ToIP DTGWG Trust Tasks framework specification, document
version 0.6 (`trustoverip/dtgwg-trust-tasks-tf` at `285f9a0a`,
`SPEC.md`; envelope schema `specs/_framework/0.6`), target
framework version 0.6.0 (§4.7.1, §4.8.2, §4.9.3, §4.11.1, §6.1, §6.3,
§6.5, §7.2–7.3); the Type URI form of RLTP-DEL-3010 also satisfies
Working Draft 0.7.0 (`trustoverip/dtgwg-trust-tasks-spec` at
`23b33b9`), and the size bound of RLTP-DEL-3030 answers item 21 of the
editor's draft (`f0b5b8e`) · [TT-TSP] the registry's TSP binding
`bindings/tsp/0.1` (§2 document carriage, §3 identity mapping, §5.3,
§7.1) and the registry entries `trust-task-error/0.5` and
`trust-task-next-step/0.1` (`trustoverip/dtgwg-trust-tasks-tf` at
`579d8e29`) and `trust-task-error/0.4` and `0.6`, `extends: "0.5"`
(at `3c4ef4d0`); the framework text they cite, §4.7.2, §4.9, §7.2 item 11,
§8.1 and §8.6, read in the same commit's `SPEC.md` · RLTP Encounter Layer
0.31, wire 0.25 (delivery port, binding 5.4, ceremony 5.8,
fresh-always §4.4, state model 5.3, merge rule 4.2) · RLTP Trust
Layer 0.31 (§2.1, §5.2b, §6a, §6b, §8) · RLTP Access Layer 0.58,
wire 0.25 · RLTP Replication Contract 0.26 (§7/I14, the
direct-effect seam of 4.4) · RLTP Membership Tasks 0.21.1 (§3, §3.5,
RLTP-MT-2180, RLTP-MT-3090, RLTP-MT-3815) · RLTP Message Tasks 0.2
(§3, §4, §6; the block, the rate, the lock keys and the age bound
of 6.2 and 7) · Sync
001/003 (superseded transport specs, Appendix A).

**External references of the adapter obligations (5a.10).** These
are the only normative rules of this contract that point *outside
the stack*, and they were the only ones with no reference entry at
all — so a reader could not tell which document "TSP-conformant"
meant:

| Reference | Identity | Version pin |
|---|---|---|
| **[TSP]** ToIP Trust Spanning Protocol | `trustoverip/tswg-tsp-specification` | commit **`ccda6b33159d860f05c328eb436dabe83548b705`** (`spec/spec.md`, TSP 1.0). The VID taxonomy, the routed model, nested envelopes, and the direct-neighbour relationship are the surfaces 5a.10 consumes; the sender's VID that TSP 1.0 carries in every confidential payload names the envelope's sender again. The VID taxonomy's rules for public and for static private VIDs do not cover a per-relationship wire identifier named on a card (the VTI mediator adapter profile, its Open Issue 15) |
| **[DIDCOMM-MED]** Coordinate Mediation 2.0 | `decentralized-identity/aries-rfcs` / didcomm.org | the **immutable snapshot the adapter profile records** (below); the version label `2.0` names a moving target and is not by itself a pin |
| **[DIDCOMM-PICKUP]** Message Pickup 3.0 | didcomm.org | as above — label plus recorded snapshot, never the label alone |

**One status, stated once.** This document is read against the
commit named in the table above — `ccda6b33…` — and against nothing
else. Two earlier castings each added a sentence around that pin
without removing the previous one, so the same reference carried
three statuses at once: pinned, "written against the model, not a
fixed revision", and "honestly unpinned". All three cannot be
true, and only the first is: the surfaces 5a.10 consumes — outer
versus nested VIDs, routed mode, the direct-neighbour relationship
— are read **in that commit**.

What is *not* a second status but a duty on someone else:

> **A conforming adapter profile MUST identify every external
> specification it implements by an *immutable snapshot
> identity*** — a commit hash, a content digest, or another
> identifier that names **bytes** — and MUST state which of its
> constructs it maps 5a.10's obligations onto. A **version label
> is not a pin** and neither is a date: "Rev 2", "Latest Draft"
> and "2026-08-27" all admit more than one byte sequence, and two
> changes on one day are indistinguishable under the last of them.
> A profile that names only a label is not a conforming profile,
> for the same reason a carrier that declares only `"rate"` is not
> a conforming carrier (4.4): a rule whose external target is not
> reproducible is not reproducibly checkable. **No such profile
> exists in this corpus yet**, so the two DIDComm rows above are
> **not byte-reproducible today** — unlike the TSP row, which
> carries a commit. That is reference debt of the same kind §11
> records as vector debt, owed at the first adapter casting, and
> it is why 5a.10's obligations are written to stand on their own
> reading rather than on a clause number. **What that debt does
> and does not cover, since an unpinned reference is otherwise an
> open invitation to read it charitably** (round-25 M-2): 5a.10's
> obligations are **normative as written here** and their
> conformance is decided against this text, so nothing in this
> contract becomes uncheckable while the debt stands; what is
> **not** reproducibly checkable is the *mapping claim* — that
> those obligations land on the constructs those two documents
> actually define. A review of that claim can today only be read
> against the moving pages and is therefore **advisory until the
> adapter casting pins bytes**: a commit in the repository named
> above, or a content digest of the retrieved document. This
> contract does not guess one — and **no review round can supply
> it either**: a reviewer reads the same moving pages, so a
> reviewed mapping claim is advisory **by construction** until the
> adapter casting records bytes. That is why it is carried here as
> a **dated obligation on a future casting** rather than as an
> open question about this one (round-29 M-2).

(Two earlier repairs are folded into that one rule: "a commit
**or** a dated revision" was half a repair, since a commit
identifies bytes and a date does not; and a deferral of the whole
pin is not a status a pinned row can also have.)

**The direction of travel, which is not a second status:** an
adapter profile records the snapshot **it** implements, which may
be this commit or a later one; where it is later, **this document
is re-read against that snapshot at the adapter stage** and the
table above follows. Until such a re-reading happens, 5a.10 means
what it means against `ccda6b33…`, and nothing about a newer draft
is silently inherited.
