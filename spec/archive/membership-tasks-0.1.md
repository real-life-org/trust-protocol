# RLTP Membership Tasks

**Real Life Trust Protocol — task types: Membership**

- **Status:** Editor's Draft
- **Version:** 0.1.0-draft (first casting)
- **Editors:** Anton Tranelis
- **Date:** 2026-08-10
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Task-type namespace:** `https://real-life.org/trust-tasks/`
- **Target Trust Tasks framework version:** 0.4
- **Conformance profile:** `rltp-membership@0.1` (draft)
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
out, and any future policy participant beyond the group. The log is
canonical; a task is a feeder, never a second truth. Authority never
comes from a task: every operation carries its own signatures, and
its validity is judged by the Access layer's materialization rules
alone — issuance counts, arrival never.

## Status of This Document

This is an **Editor's Draft** with no standing beyond its own
argument, the first casting of this document. It is developed through
the same adversarial convergence process as the Encounter Layer and
the Delivery Contract (casting, independent adversarial review, full
recast — never a patch) and has not yet completed a review round. Its
requirements list (M1–M12) and the runtime inventory it rests on are
recorded in the design notes of the private working repository. The
document will change; known open questions are collected in
Section 8. Feedback is welcome via the issues of the publication
repository (github.com/real-life-org/rltp-spec).

## 1. Introduction (informative)

### 1.1 What this fixes

The deployed app enforces membership on two disconnected planes: a
membership document that only clients check, and a relay registry
that only the relay checks. The seams show — a promoted admin passes
every client check and still cannot enforce a removal; a removed
member never canonically learns of the removal, because the same
capability gate that enforces it also cuts off the replica that would
tell them. This specification is one half of the repair: operations
travel as first-class, acknowledged task documents to exactly the
parties the replica cannot reach. The other half — one authority
plane, the operation log, with services fed by chain-proven epoch
updates instead of their own registries — belongs to the Access
layer and its service ports, and is out of scope here.

### 1.2 The three principles inherited

- **Issuance counts, arrival never** (Encounter 1.3): an operation's
  validity is a function of its signatures and its causal position,
  never of when its task arrived.
- **Authenticity always has exactly one carrier** (Contract 1.1): the
  operation envelope carries its signatures, so `access-operation`
  documents carry no proof; the invitation and the acceptance have no
  enclosed signed material, so they do.
- **The acknowledgement is arrival, and arrival only** (Contract
  4.2): no acknowledgement of this specification is ever a consent,
  an acceptance of membership, or a policy proof. Consent has its own
  document (`membership-accept`), signed by the person consenting.

## 2. Conventions and Terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" are to be interpreted as described in BCP 14 [RFC2119]
[RFC8174] when, and only when, they appear in all capitals.

The **interim securing profile** of Encounter 2.3 applies. The
**document profile, sealed envelope, staged dispositions, and
acknowledgement rules** of the Delivery Contract (Sections 3–6) apply
to every type registered here; this document adds only what each type
declares beyond them.

**Group** — an Access-layer group, identified by its group DID.
**Operation** — an Access-layer operation envelope (its §3.3):
self-addressing (`oid:`), causally referenced (`prev`), individually
signed (`proof.signatures`). **Materialization** — the Access layer's
deterministic derivation of group state from the operation DAG.
**Replica boundary** — the set of parties holding (and entitled to
hold) the group's replicated log at a given materialized state.

## 3. Registered Task Types

### 3.1 `membership-invite/0.1`

The invitation: one member proposes membership to a person outside
the group. **It carries no key material and no operation** — nothing
a non-accepting recipient could hold against the group.

- `payload`: per `schemas/payload-membership-invite.schema.json` —
  `invite` object with `group` (group DID), `inviter` (anchor, MUST
  equal the document `issuer`), `genesisDigest` (multibase multihash
  of the group's genesis operation — lets the accept bind to a
  specific group history, and the invitee later verify the bootstrap
  against what was offered), and optional display fields (`name`,
  `note`, bounded).
- `threadId`: fresh — opens the membership thread.
- `proof`: **REQUIRED** (authenticity has no other carrier).
- **Declarations (TT §7.3):** side effects: none beyond durable
  buffering and surfacing to the human; exposure: recipient-only.
- **Defined effect:** durable buffering plus surfacing for the
  recipient's decision. Accepting or ignoring is a human act
  (Encounter C4's sibling); the acknowledgement says arrival, never
  inclination.

### 3.2 `membership-accept/0.1`

The explicit acceptance — the consent artifact. Membership is never
entered unilaterally: without an accept, no `member.add` naming this
subject SHOULD be issued, and a welcome MUST NOT be sent.

- `payload`: per `schemas/payload-membership-accept.schema.json` —
  `accept` object with `group`, `subject` (anchor, MUST equal the
  document `issuer` — consent is signed by the person consenting),
  and `ref` (the document digest of the invite being accepted —
  content-bound: this accept answers exactly that invitation).
- `threadId`: = the invite's `threadId`.
- `proof`: **REQUIRED** (the consent's authenticity has no other
  carrier).
- **Consistency (MUST, before any effect):** `issuer` =
  `accept.subject`; `recipient` = the invite's `issuer`; `ref`
  matches a `membership-invite` this recipient actually sent on this
  thread; `group` matches that invite. Any failure →
  `failed(validation-failed)`, no acknowledgement.
- **Defined effect:** durable recording of the consent. The consent
  is input to the group's admission policy (Access §4): under a
  single-admitter policy the inviter now issues `member.add`; richer
  policies MAY require more. The accept itself grants nothing.

### 3.3 `access-operation/0.1`

The generic carrier: one Access-layer operation, travelling to a
party outside the replica boundary.

- `payload`: per `schemas/payload-access-operation.schema.json` —
  `operation` (the Access §3.3 envelope, validated against
  `schemas/access-operation-envelope.schema.json`, a transcription
  owned by the Access layer) and OPTIONAL `welcome`.
- `threadId`: = the membership thread when the operation is the
  `member.add` answering an accept; fresh otherwise.
- `proof`: **absent** — the operation envelope carries its own
  signatures (N1); a task-level proof would be a second carrier.
- **Outer/inner consistency (MUST, before any effect):** the
  operation's `group` is well-formed; if `welcome` is present, then
  `operation.op` = `member.add`, the document `recipient` equals the
  operation's subject, and `welcome.sealed` is a Contract §5 sealed
  envelope addressed to that subject (`rkid` = a key-agreement key
  from the subject's contact card — the key-retention rule of
  Contract §5 covers keys held before any relation existed). A
  violation is `failed(validation-failed)` and earns no
  acknowledgement.
- **Welcome cargo:** `welcome.sealed`'s plaintext is the Access
  layer's welcome bundle (its §5.3): epoch keys and the subject's
  implicit capability. **This specification treats it as opaque
  cargo**; its content is owned by the Access layer. The default
  bundle carries the **full epoch-key history** — a new member sees
  the group's shared world whole (calendar, board, map); the group's
  visibility policy (Access §8) MAY narrow this, the default never
  does.
- **Defined effect:** durable buffering of the operation for log
  merge, and of the welcome for the Access layer's bootstrap
  (verify the chain from genesis, N2 — never adopt authority from
  the task). For an operation that removes the document's own
  recipient (`member.remove` whose subject = `recipient`), the
  effect additionally triggers **removal hygiene** (Access §5.3):
  durably preserve unsent local work, invalidate runtime authority
  immediately, wipe group key material once the removal is
  canonical. The task is the feeder that reaches the removed member
  precisely because the replica no longer does.
- **Dependency (`incomplete(missing)`, Contract 6.2):** this type
  declares the one dependency `group-state`: an operation whose
  `prev` closure cannot be resolved against any local state of that
  group — including the case that the group is entirely unknown — is
  disposed `incomplete(missing: group-state)`. Re-evaluation
  trigger: arrival, over any carrier, of material that resolves the
  closure (a welcome bootstrap, replicated log state, or earlier
  operations). Retention bound: `bootstrap-retention` (Section 5).
  Within the bound the disposition earns no acknowledgement and the
  document is re-evaluated in full on each trigger; past the bound
  it MAY be discarded and a later redelivery is evaluated fresh.
- **Idempotency, two levels:** redelivery of the same document is
  `duplicate-known` (Contract 6.2, byte-identical re-ack); a
  different document carrying the same operation is accepted and
  merges idempotently by operation id (N3) — the log deduplicates,
  the task layer never has to.

## 4. What is deliberately absent

- **No member-update signal type.** The deployed app's advisory
  member-update messages are replaced by the operations themselves
  travelling as tasks; the canonical truth remains the materialized
  log (the signal/canon split of the app, generalized).
- **No membership-level acknowledgement.** There is no
  join-confirmed, no removal-acknowledged document. Arrival is the
  ack's whole meaning; group state is read from the log.
- **No service frames.** Registration, rotation announcement, and
  scope invalidation toward brokers are service-port concerns
  (Access §10, freshness contract): services learn authority from
  chain-proven epoch updates, never from their own registries, and
  never via trust tasks. The deployed `admin-add`/`admin-remove`
  control frames have no successor here — deliberately.

## 5. Timing

| Parameter | Default | Meaning |
|---|---|---|
| `bootstrap-retention` | P90D | minimum retention of an `incomplete(missing: group-state)` document awaiting its group state |

Delivery time is unbounded (Contract §7); no rule of this document
references arrival time for validity. `bootstrap-retention` bounds
only the receiver's buffering obligation for out-of-order arrivals.

## 6. Security Considerations

- **A task conveys, never authorizes.** Every acceptance decision
  about an operation is the Access layer's materialization; a
  forged or replayed task can at worst deliver a document that fails
  those checks. Validate, then consume (Contract 6.2) holds
  throughout; no task effect consumes single-use material.
- **Keys travel only after consent.** The invite carries no key
  material; the welcome travels with `member.add`, which SHOULD
  follow an accept. A person who never accepts never holds group
  material — unlike the deployed flow this replaces.
- **The removal notice is honest but not privileged:** the removed
  member learns of the removal from the operation itself, signed and
  chain-positioned; suppressing the task delays knowledge but never
  re-admits — enforcement lives in epoch rotation and the service
  freshness contract, not in this notice.
- **Consent is bound:** an accept binds inviter, group, and the
  exact invite document (`ref`), preventing a consent given to one
  invitation from being replayed against another.

## 7. Conformance

- **Profile** `rltp-membership@0.1`; normatively references
  `rltp-delivery@0.17` and the Access layer's operation envelope.
- **Normative schemas (shipped, offline closure):**
  `schemas/payload-membership-invite.schema.json` ·
  `schemas/payload-membership-accept.schema.json` ·
  `schemas/payload-access-operation.schema.json` ·
  `schemas/access-operation-envelope.schema.json` (transcription;
  the Access layer owns the definition).
- **Vector plan:** invite without proof rejected · accept whose
  `issuer` ≠ `subject` rejected · accept whose `ref` matches no sent
  invite rejected; matching accept accepted; replayed accept against
  a second invite rejected (`ref` mismatch) · access-operation with
  task-level proof rejected (one carrier) · welcome next to a
  non-`member.add` operation rejected · welcome whose recipient ≠
  operation subject rejected · welcome sealed to a foreign `rkid`
  fails at decryption exactly per Contract 6.2 · operation for an
  unknown group → `incomplete(missing: group-state)`, no ack;
  welcome arrival triggers re-evaluation → effect + ack · same
  document redelivered → `duplicate-known`, byte-identical re-ack ·
  different document, same operation id → both `unique`, one log
  entry · remove-op naming the recipient → removal-hygiene effect
  triggered, ack still arrival-only · retention: document held at
  least `bootstrap-retention`, fresh evaluation after discard ·
  thread rules: accept on the invite's thread; member.add on the
  membership thread when answering an accept.
- Every normative statement is vector-testable or explicitly marked
  state-dependent.

## 8. Open Issues

- **MO-1 Fan-out inside the boundary.** Whether operations SHOULD
  additionally travel as tasks to *members* whose replicas lag
  (bridging outages), or whether replication alone owns the inside.
  This casting says: replication owns the inside.
- **MO-2 Policy-proof transport.** Richer admission policies (Z9:
  quorum, consent) need more inputs than one accept; whether those
  travel as further documents on the membership thread or as
  operation attachments is undecided.
- **MO-3 Leave and dissolve notices.** Whether `member.leave` and
  `group.dissolve` owe departing parties a task the way removal
  does.
- **MO-4 The welcome bundle's schema** is Access-layer property and
  unpinned here; once the Access layer converges, this document
  pins the version it transports.

## References

[RFC2119] · [RFC8174] BCP 14 · [RFC8785] JCS · [TT] ToIP DTGWG Trust
Tasks framework 0.4 · **RLTP Delivery Contract 0.17** (normative) ·
**RLTP Encounter Layer 0.19** (securing profile 2.3, principles 1.3)
· RLTP Access Layer draft 0.3 (operation envelope §3.3, welcome
§5.3, visibility §8, service ports §10).
