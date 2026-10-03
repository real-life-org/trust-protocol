# RLTP Membership Tasks

**Real Life Trust Protocol — task types: Membership**

- **Status:** Editor's Draft
- **Version:** 0.2.0-draft (second casting)
- **Editors:** Anton Tranelis
- **Date:** 2026-08-10
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Task-type namespace:** `https://real-life.org/trust-tasks/`
- **Target Trust Tasks framework version:** 0.4
- **Conformance profile:** `rltp-membership@0.2` (draft)
- **Position:** a task-type registration on top of the **RLTP Delivery
  Contract 0.17** (normative reference), carrying operations of the
  **RLTP Access Layer** (currently drafted as `access-layer.md` 0.3;
  the operation envelope of its §3.3 is the payload this
  specification transports, never re-defines).

## Abstract

This document registers the task types with which membership changes
of an RLTP group travel between people: the **invitation** and its
explicit **acceptance**, and the generic carrier for **access
operations** — including the welcome material a new member needs and
the removal notice a removed member is owed.

The dividing line is the replica boundary: inside a group, the
authority log replicates as shared state; **tasks carry operations to
parties who stand outside the replica** — the invitee who is not yet
a member, the removed member whom the capability gate has just shut
out. The log is canonical; a task is a feeder, never a second truth.
Authority never comes from a task: every operation carries its own
signatures, and its validity is judged by the Access layer's
materialization rules alone — issuance counts, arrival never.

Membership is entered only by explicit, cryptographically bound
consent: invitation and acceptance form a signed chain that the
admitting operation commits to, which also makes **invitation
provenance provable** — who invited whom is derived from signatures,
never asserted by a field.

## Status of This Document

This is an **Editor's Draft** with no standing beyond its own
argument, the second casting of this document. It is developed
through the same adversarial convergence process as the Encounter
Layer and the Delivery Contract (casting, independent adversarial
review, full recast — never a patch); the first casting's review
found seven blockers, all addressed here, and this casting has not
yet completed its own round. The document will change; known open
questions are collected in Section 9. Feedback is welcome via the
issues of the publication repository
(github.com/real-life-org/rltp-spec).

## 1. Introduction (informative)

### 1.1 What this fixes

The deployed app enforces membership on two disconnected planes: a
membership document that only clients check, and a relay registry
that only the relay checks. The seams show — a promoted admin passes
every client check and still cannot enforce a removal; a removed
member never canonically learns of the removal, because the same
capability gate that enforces it also cuts off the replica that would
tell them; an invitation hands the full key history to someone who
never consented to join. This specification is one half of the
repair: operations travel as first-class, acknowledged task documents
to exactly the parties the replica cannot reach, and keys travel only
after consent. The other half — one authority plane, the operation
log, with services fed by chain-proven epoch updates instead of their
own registries — belongs to the Access layer and its service ports.

### 1.2 The flow at a glance

1. A member sends an **invite** — no key material, but the inviter's
   contact card (so the answer has a key to travel under) and the
   group's genesis digest (so the invitee can later verify the
   bootstrap against what was offered).
2. The invitee decides, humanly, and sends an **accept**: signed by
   themselves, bound to that exact invite, carrying their own fresh
   contact card (so the welcome has a key to travel under).
3. **Any authorized member** — not only the inviter — completes the
   admission: a `member.add` operation that commits to the accept,
   travelling together with the **welcome** (epoch keys, sealed to
   the invitee, digest-committed by the operation's signatures).
   Until it arrives, the invitee's state is honest and visible:
   *accepted — waiting for a group member to come online and hand
   over the keys* (Section 7).

### 1.3 The three principles inherited

- **Issuance counts, arrival never** (Encounter 1.3): an operation's
  validity is a function of its signatures and its causal position,
  never of when its task arrived.
- **Authenticity always has exactly one carrier** (Contract 1.1): the
  operation envelope carries its signatures and commits to its
  welcome by digest, so `access-operation` documents carry no proof;
  the invitation and the acceptance have no enclosed signed material,
  so they do.
- **The acknowledgement is arrival, and arrival only** (Contract
  4.2): no acknowledgement of this specification is ever a consent,
  an acceptance of membership, or a policy proof. Consent has its own
  document, signed by the person consenting.

## 2. Conventions and Terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" are to be interpreted as described in BCP 14 [RFC2119]
[RFC8174] when, and only when, they appear in all capitals.

The **interim securing profile** of Encounter 2.3 applies. The
**document profile, sealed envelope, staged dispositions, and
acknowledgement rules** of the Delivery Contract (Sections 3–6) apply
to every type registered here; this document adds only what each type
declares beyond them. **Task proofs of this document** (on invite and
accept) MUST verify under the key bound to the document `issuer`
anchor (Encounter 2.3), and the proof's `verificationMethod` DID MUST
equal that `issuer`.

**Group** — an Access-layer group, identified by its group DID.
**Operation** — an Access-layer operation envelope (its §3.3):
self-addressing (`oid:`), causally referenced (`prev`), individually
signed (`proof.signatures`). **Materialization** — the Access layer's
deterministic derivation of group state from the operation DAG; an
operation is **canonical** when materialization at its causal
position accepts it. **Replica boundary** — the set of parties
holding (and entitled to hold) the group's replicated log at a given
materialized state. **Admission chain** — the signed chain
invite → accept → `member.add`, bound by document digests as
specified in Section 3.

## 3. Registered Task Types

### 3.1 `membership-invite/0.1`

The invitation: one member proposes membership to a person outside
the group. **It carries no key material and no operation** — nothing
a non-accepting recipient could hold against the group.

- `payload`: per `schemas/payload-membership-invite.schema.json` —
  `invite` object with:
  - `group` — the group DID;
  - `inviter` — anchor; MUST equal the document `issuer`;
  - `invitee` — anchor; MUST equal the document `recipient`. Signed
    into the invite so that consent cannot be transplanted: only
    this person's accept answers this invite;
  - `card` — the inviter's contact card (Encounter 6, displayed
    form): the key-agreement key the accept will be sealed to;
  - `genesisDigest` — multibase multihash of the group's genesis
    operation. This identifies the group's **lineage** (two
    divergent histories can share a genesis — it is not a state
    commitment); its role is bootstrap verification: the invitee
    MUST later verify the fetched genesis against it (3.3);
  - `validUntil` — RFC3339; bounds the invite's answerable life and
    thereby the inviter's reply-key retention (Section 5). An accept
    whose own `issuedAt` lies after `validUntil + skew-tolerance` is
    invalid (issuance semantics — the comparison never involves
    arrival time);
  - optional display fields (`name`, `note`, bounded).
- `threadId`: fresh — opens the membership thread.
- `proof`: **REQUIRED**, verifying under `issuer` (Section 2).
- **Declarations (TT §7.3):** side effects: durable buffering and
  surfacing to the human only; exposure: recipient-only.
- **Key obligation:** the inviter MUST retain the key-agreement
  private key of `card` at least until `validUntil` plus the longest
  adapter give-up horizon (Contract §5's retention rule, anchored to
  the invite instead of the card's last display).
- **Defined effect:** durable buffering plus surfacing for the
  recipient's decision. Accepting or ignoring is a human act; the
  acknowledgement says arrival, never inclination.

### 3.2 `membership-accept/0.1`

The explicit acceptance — the consent artifact. **Membership is
entered only through it:** a `member.add` admitting a subject across
the replica boundary MUST commit to a valid accept (3.3); without
one, issuing such a `member.add` is non-conformant, and a welcome
MUST NOT be sent.

- `payload`: per `schemas/payload-membership-accept.schema.json` —
  `accept` object with:
  - `group` — MUST equal the referenced invite's `group`;
  - `subject` — anchor; MUST equal the document `issuer` (consent is
    signed by the person consenting) **and** MUST equal the
    referenced invite's `invitee` (consent cannot be transplanted);
  - `ref` — the document digest of the invite being accepted
    (content-bound: this accept answers exactly that invitation);
  - `card` — the subject's contact card (Encounter 6, displayed
    form), fresh at consent time: the key-agreement key the welcome
    will be sealed to.
- `threadId`: = the invite's `threadId`.
- `proof`: **REQUIRED**, verifying under `issuer` (Section 2).
- `recipient`: the invite's `issuer`. Other members learn of the
  accept through the admission chain, not through fan-out of the
  consent itself.
- **Consistency (MUST, on receipt, before any effect):** proof
  verifies under `issuer`; `issuer` = `accept.subject`; `ref`
  matches a `membership-invite` this recipient actually sent on this
  thread; `accept.subject` = that invite's `invitee`; `accept.group`
  = that invite's `group`; the accept's `issuedAt` ≤ the invite's
  `validUntil + skew-tolerance`. Any failure →
  `failed(validation-failed)`, no acknowledgement.
- **Defined effect:** durable recording of the consent. The consent
  is input to the group's admission policy (Access §4): under a
  single-admitter policy any authorized member now completes the
  admission (3.3); richer policies MAY require more. The accept
  itself grants nothing, and **one accept authorizes at most one
  admission** (3.3).

### 3.3 `access-operation/0.1`

The generic carrier: one Access-layer operation, travelling to a
party outside the replica boundary.

- `payload`: per `schemas/payload-access-operation.schema.json` —
  `operation` (the Access §3.3 envelope, validated against
  `schemas/access-operation-envelope.schema.json`, a transcription
  owned by the Access layer) and OPTIONAL `welcome` (a
  `rltp-welcome/0.1` **welcome seal**, Section 4).
- `threadId`: = the membership thread when the operation is the
  admitting `member.add`; fresh otherwise.
- `proof`: **absent** — the operation envelope carries its own
  signatures (one carrier); the welcome is bound by the operation's
  digest commitment (Section 4), so it needs none either.
- **Outer/inner consistency (MUST, before any effect):**
  - the document `issuer` MUST equal `operation.author` or one of
    `operation.proof.signatures[].signer` — a party uninvolved in
    the operation cannot harvest arrival acknowledgements by
    wrapping it;
  - the operation's `group` is well-formed;
  - **pre-buffer validation** (these need no group state and MUST
    pass before any durable buffering — the admission boundary
    against storage flooding): payload schemas valid; the
    operation's `id` recomputes per its self-addressing rule; every
    signature in `operation.proof` verifies under its signer's
    anchor;
  - if `welcome` is present: `operation.op` = `member.add`; the
    document `recipient` equals the operation's subject; the
    operation commits to this welcome per Section 4, and the
    commitment verifies.
  A violation is `failed(validation-failed)` and earns no
  acknowledgement.
- **Declarations (TT §7.3):** side effects: mutating (log merge,
  bootstrap, removal hygiene); exposure: recipient-only.
- **The admission binding (MUST):** a `member.add` that admits a
  subject across the replica boundary carries, in its operation
  body, the profile member `admission`:
  `{ "accept": <document digest of the accept>,
     "invite": <document digest of the invite>,
     "welcome": <digest of the welcome plaintext, Section 4> }`.
  The admitting member MUST have verified the accept against its
  invite (3.2's consistency, replayed from the documents) before
  issuing. Materialization (Access §4) MUST treat the accept digest
  as a consumable: **at most one canonical `member.add` per accept
  digest**; a second one is invalid at materialization. Any
  authorized member MAY issue the admission — the inviter has no
  privileged role after the invite. *(The `admission` member is a
  profile of the Access body by this specification; the Access layer
  owns the body and is expected to adopt the member on its next
  casting.)*
- **Invitation provenance (derived, never asserted):** who invited a
  member follows from the admission chain — the `invite` digest in
  the admission binding names a document whose signed `inviter` is
  the answer. Applications MUST be able to display provenance from
  this chain; no separately asserted "added by" field exists in this
  profile, so the answer cannot lie.
- **Defined effects, by case:**
  1. **Bootstrap (`member.add` + welcome to its subject):** this
     document is **self-contained** — its effect MUST NOT require
     resolving the operation's `prev` closure (the invitee has no
     group state yet; requiring it would be circular). After the
     consistency checks above and verification that the `admission`
     binding names the invitee's own accept, the effect is: durably
     buffer operation and welcome, unseal the welcome (Section 4),
     verify its binding fields, and start the Access bootstrap —
     fetch the log, **verify the fetched genesis against the
     invite's `genesisDigest`**, and verify the chain (N2). Group
     authority is adopted only from successful materialization,
     never from the task; if materialization ultimately rejects the
     admission, the bootstrap state is discarded.
  2. **Removal notice (`member.remove` whose subject = the
     `recipient`):** effect = durable buffering plus an immediate
     **merge attempt** against the recipient's own replica (which
     they hold up to their removal — the `prev` closure is
     theirs to resolve). **Removal hygiene** (Access §5.3: durably
     preserve unsent local work, invalidate runtime authority, wipe
     group key material once canonical) triggers **only when
     materialization accepts the removal as a new canonical
     transition** — never on delivery, never on task shape. A
     forged operation fails materialization and triggers nothing; a
     replayed or already-materialized operation is idempotent by
     operation id and triggers nothing new. (M7 holds: enforcement
     arises on merge, never on delivery.)
  3. **Other operations:** durable buffering for log merge.
- **Dependency (`incomplete(missing)`, Contract 6.2):** this type
  declares the one dependency `group-state`: an operation whose
  `prev` closure cannot be resolved against any local state of that
  group — **except case 1 above, which is self-contained by
  definition** — is disposed `incomplete(missing: group-state)`.
  Mechanics, normatively:
  - the pending store is keyed by **document digest**; redelivery of
    a pending document is idempotent and MUST NOT reset its
    retention clock (retention runs from first receipt);
  - re-evaluation triggers are arrival, over any carrier, of
    material that resolves the closure; triggers MUST be coalesced
    per group and re-evaluations serialized per group;
  - within `bootstrap-retention` (Section 5) the document MUST be
    retained and re-evaluated in full on each trigger, earning no
    acknowledgement; past the bound it MAY be discarded, and a later
    redelivery is evaluated fresh;
  - receivers MAY enforce quotas (per group, per issuer, per byte
    size) on the pending store; a quota rejection is
    `failed(validation-failed)` and consumes nothing. The pre-buffer
    validation above is the floor: nothing unverifiable ever
    occupies the store.
- **Idempotency, two levels:** redelivery of the same document is
  `duplicate-known` (Contract 6.2, byte-identical re-ack); a
  different document carrying the same operation is accepted at the
  task level and merges idempotently by operation id (N3) — the log
  deduplicates, and effects keyed to *new canonical transitions*
  (case 2) therefore fire at most once per operation.

## 4. The Welcome Seal

The welcome carries the epoch keys and implicit capability a new
member needs. It travels sealed and is bound to the admitting
operation — one carrier, exactly one.

- **Plaintext** is a `rltp-welcome/0.1` document
  (`schemas/welcome.schema.json`): `{ "v": "rltp-welcome/0.1",
  "group", "subject", "op": <the admitting operation's id>,
  "material": { …Access-owned epoch keys and capability… },
  "more": [ <digests of continuation bundles>, … ] }`. The binding
  fields (`v`, `group`, `subject`, `op`) are owned by this
  specification and closed; `material` is owned by the Access layer
  and opaque here.
- **Commitment:** `admission.welcome` in the operation body is the
  multibase multihash over `JCS(plaintext)` (Encounter 2.3). Because
  the operation's signatures cover its body, the welcome has the
  operation as its authenticity carrier: it cannot be swapped
  between groups, subjects, or operations without breaking either
  the digest or the signed binding fields, which the receiver MUST
  verify against the operation (`group` = operation's group,
  `subject` = operation's subject, `op` = operation's id).
- **Seal construction:** as Contract §5 with two deliberate
  differences — the HKDF info string is `rltp/v1/welcome` (domain
  separation from delivery seals), and the plaintext is the
  `rltp-welcome` document, **never a delivery document**: a welcome
  seal never enters the staged dispositions of Contract 6.2. The
  recipient key is the key-agreement key of the **accept's enclosed
  card** — fresh at consent time, so no retired-key window opens
  between consent and welcome; the subject MUST retain it per
  Contract §5's retention rule from the accept's issuance.
- **Default content — the full history:** the default `material`
  carries the **complete epoch-key history** (a new member sees the
  group's shared world whole: calendar, board, map); the group's
  visibility policy (Access §8) MAY narrow this, the default never
  does.
- **Size and continuation:** the complete task document remains
  bounded by Contract §5's size limit. Where the full history does
  not fit, the welcome is a **manifest**: recent epochs inline in
  `material`, older history in continuation bundles, each a sealed
  `rltp-welcome/0.1` document with the same binding fields, each
  listed by plaintext digest in `more` (transitively for deep
  histories), each travelling as its own `access-operation` document
  on the membership thread carrying **the same operation** (the log
  deduplicates; the continuations are welcome cargo, not new
  authority). The digest chain from the committed manifest makes
  every continuation exactly as bound as the manifest itself.

## 5. Timing

| Parameter | Default | Meaning |
|---|---|---|
| `invite-validity` | P90D | default for `validUntil` when the inviter names none; bounds the answerable life of an invite and the inviter's reply-key retention (3.1) |
| `bootstrap-retention` | P90D | minimum retention of an `incomplete(missing: group-state)` document, measured from first receipt; redelivery never resets it |

Delivery time is unbounded (Contract §7); no rule of this document
references arrival time for validity. The one issuance-time window is
the invite's `validUntil` against the accept's `issuedAt` (3.1),
widened by `skew-tolerance` per Encounter 1.3 — clock tolerance never
rejects.

## 6. What is deliberately absent

- **No member-update signal type.** The operations themselves travel
  as tasks; the canonical truth remains the materialized log.
- **No membership-level acknowledgement.** There is no
  join-confirmed, no removal-acknowledged document. Arrival is the
  ack's whole meaning; group state is read from the log.
- **No service frames.** Registration, rotation announcement, and
  scope invalidation toward brokers are service-port concerns
  (Access §10, freshness contract): services learn authority from
  chain-proven epoch updates, never from their own registries, and
  never via trust tasks.

## 7. State Machines (informative)

**Invitee:** `invited (human decision pending) → accepted — waiting
for a group member to come online and hand over the keys → welcome
arrived → bootstrapping (fetch log, verify genesis against the
invite, materialize) → member` — the waiting state is honest and
MUST be user-visible as such (the admission may take as long as the
group's next liveness); decline or expiry (`validUntil`) ends the
thread with local state only.

**Admitting member (any authorized member):** `accept received →
verify chain (invite ↔ accept) → issue member.add with admission
binding + welcome → done` — the acknowledgement of the
access-operation document says the invitee's device has it; the
invitee's membership says the log has it.

**Removed member:** `remove-op arrives → merge attempt against own
replica → canonical? → hygiene (preserve, invalidate, wipe when
canonical)` — a non-canonical op changes nothing.

## 8. Security Considerations

- **A task conveys, never authorizes.** Every acceptance decision
  about an operation is the Access layer's materialization; a forged
  or replayed task can at worst deliver a document that fails those
  checks. Validate, then consume holds throughout; the pre-buffer
  checks keep even the pending store behind signature verification.
- **Consent is bound in both directions:** the invite names its
  invitee inside the signed payload; the accept binds subject, group
  and the exact invite document; the admission commits to the accept
  and is consumable exactly once. A disclosed invite is useless to a
  third party; a consent cannot be replayed into a second admission.
- **Keys travel only after consent,** sealed to a key created at
  consent time, digest-committed by the admitting operation. A
  person who never accepts never holds group material; a welcome
  cannot be substituted without breaking the operation's signatures.
- **The removal notice is honest but not privileged:** hygiene fires
  only on a canonically materialized removal; suppressing the task
  delays knowledge but never re-admits — enforcement lives in epoch
  rotation and the service freshness contract, not in this notice.
- **Provenance without assertion:** who invited whom is derived from
  the signed admission chain; there is no assertable field to forge.

## 9. Open Issues

- **MO-1 Fan-out inside the boundary.** Whether operations SHOULD
  additionally travel as tasks to members whose replicas lag. This
  casting says: replication owns the inside.
- **MO-2 Policy-proof transport.** Richer admission policies (Z9)
  need more inputs than one accept; whether those travel as further
  documents on the membership thread or as operation attachments is
  undecided.
- **MO-3 Leave and dissolve notices.** Whether `member.leave` and
  `group.dissolve` owe departing parties a task the way removal
  does.
- **MO-4 The `material` schema** is Access-layer property and
  unpinned here; once the Access layer converges, this document pins
  the version it transports. The binding fields of the welcome are
  pinned now (Section 4).
- **MO-5 Upstreaming `admission`.** The `admission` body member is a
  profile of this specification; the Access layer is expected to
  adopt it (with the accept-digest consumable rule) on its next
  casting.

## 10. Conformance

- **Profile** `rltp-membership@0.2`; normatively references
  `rltp-delivery@0.17` and the Access layer's operation envelope.
- **Normative schemas (shipped, offline closure):**
  `schemas/payload-membership-invite.schema.json` ·
  `schemas/payload-membership-accept.schema.json` ·
  `schemas/payload-access-operation.schema.json` ·
  `schemas/welcome.schema.json` ·
  `schemas/access-operation-envelope.schema.json` (transcription;
  the Access layer owns the definition).
- **Vector plan:** invite without proof, or proof not verifying
  under `issuer`, rejected · invite whose `inviter` ≠ `issuer` or
  `invitee` ≠ `recipient` rejected · accept whose `issuer` ≠
  `subject` rejected · **accept whose `subject` ≠ invite's
  `invitee` rejected (transplantation)** · accept whose `ref`
  matches no sent invite rejected; matching accept accepted · accept
  after `validUntil + skew` rejected; within, accepted · **one
  accept, two `member.add` operations → second invalid at
  materialization (consumable)** · same genesis, divergent branch:
  bootstrap verifies fetched genesis = invite's digest; a divergent
  admission fails materialization, bootstrap state discarded ·
  `member.add` across the boundary without `admission` binding, or
  without welcome, non-conformant · welcome digest mismatch
  rejected · **welcome with correct digest but foreign
  group/subject/op binding fields rejected** · welcome swapped
  between two groups for one subject → binding check fails ·
  attacker-resealed welcome next to a valid operation → digest
  mismatch → rejected · welcome next to a non-`member.add`
  operation rejected · document `issuer` neither author nor signer
  → rejected (no ack harvesting) · operation whose `id` does not
  recompute, or with a non-verifying signature → rejected
  **pre-buffer**, pending store untouched · operation for an
  unknown group (non-bootstrap) → `incomplete(missing:
  group-state)`, no ack; resolving material triggers re-evaluation
  → effect + ack · pending redelivery → idempotent, retention clock
  unreset · retention from first receipt; fresh evaluation after
  discard · **bootstrap case: `member.add` + welcome to the subject
  evaluated self-contained — never `incomplete`** · removal notice:
  forged remove-op → materialization rejects → no hygiene ·
  replayed/rewrapped canonical remove-op → idempotent by oid → no
  new hygiene · genuine new canonical removal → hygiene fires once ·
  same document redelivered → `duplicate-known`, byte-identical
  re-ack · different document, same operation → both `unique`, one
  log entry, case-2 effects at most once · full-history overflow →
  manifest + continuations, each bounded, digest chain verified;
  a continuation not listed in the chain rejected · provenance:
  inviter derived from the admission chain equals the invite's
  signed `inviter`.
- Every normative statement is vector-testable or explicitly marked
  state-dependent.

## References

[RFC2119] · [RFC8174] BCP 14 · [RFC8785] JCS · [TT] ToIP DTGWG Trust
Tasks framework 0.4 · **RLTP Delivery Contract 0.17** (normative) ·
**RLTP Encounter Layer 0.19** (securing profile 2.3, principles 1.3,
contact card §6) · RLTP Access Layer draft 0.3 (operation envelope
§3.3, welcome material §5.3, policy §4, visibility §8, service ports
§10).
