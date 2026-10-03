# RLTP Access Layer

**Real Life Trust Protocol — Layer 3: Access**

- **Status:** Editor's Draft
- **Version:** 0.4.0-draft (fourth casting)
- **Editors:** Anton Tranelis
- **Date:** 2026-08-11
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Conformance profile:** `rltp-access@0.4` (draft)
- **Position:** Layer 3 of RLTP, above the Encounter Layer 0.19 and
  the Identity layer, carried by the Delivery Contract 0.17 where
  operations must reach parties outside the replica; the Membership
  Tasks 0.7 register the task types that transport this layer's
  operations and are a normative companion.
- **Supersedes:** version 0.3.0-draft (wot-spec `rltp/access-layer.md`,
  archived there together with its adversarial reviews); on adoption,
  the group/membership portions of wot-spec
  `03-wot-sync/005-gruppen.md`.

## Abstract

This document specifies the Access layer of the Real Life Trust
Protocol (RLTP): how a **group** of people holds shared authority over
its membership, its data, and itself. Its spine is the **authority
log** — a causally linked DAG of individually signed operations rooted
in a self-certifying genesis. Group state is a deterministic
materialization of this log; **policies** are group-defined decision
rules gating privileged operations; **epochs** are the enforcement
periods that make revocation real — prospectively — in an
end-to-end-encrypted, local-first setting.

What this layer deliberately does **not** specify is the machinery
that replicates the log, converges concurrent branches, rotates keys,
and opens history to a new member. That machinery is an **enforcement
substrate** behind a normative **port** of four requirements (Section
9). The group's constitution — envelope, policy, admission,
materialization rules — is this layer's own; the substrate is
replaceable, and a linear interim adapter satisfies the port with the
semantics deployed today.

Access is deliberately separate from trust: the Encounter layer
records that people met and recognized each other; the Access layer
governs what a collective grants, and how it takes it back. Encounter
credentials are immutable and never revoked; access is revocable by
construction. That difference is why the layers exist.

## Status of This Document

This is an **Editor's Draft** with no standing beyond its own
argument, the fourth casting of this layer. It is developed through
the same adversarial convergence process as the Encounter Layer, the
Delivery Contract, and the Membership Tasks (casting, independent
adversarial review, full recast — never a patch). The first two
castings were answered by adversarial review rounds one and two; the
third casting was superseded, before its own round, by the substrate
decision and the membership convergence this casting embodies. This
casting has not yet completed a review round. The document will
change; known open questions are collected in Section 15. Feedback is
welcome via the issues of the publication repository
(github.com/real-life-org/rltp-spec).

## 1. Introduction (informative)

### 1.1 Essence

Four consequences follow from making the log the sole authority, and
they are the layer:

1. **There are no admins.** Privileged operations are gated by the
   group's own policy — a decision rule stated as data. A single
   founder-admin is the `k = 1` special case, not the model.
2. **Authority is a log, not a key.** No key held by anyone confers
   standing authority; the genesis key signs once and may be
   destroyed. Every authorization decision is a deterministic reading
   of signed operations.
3. **Revocation is an epoch, honestly stated.** Removing someone
   cannot un-teach them what they read; it can and must stop them
   prospectively. Every operation that removes or narrows authority
   carries a key-world transition, atomically.
4. **Services follow the log.** No service keeps its own registry of
   who belongs; infrastructure learns authorization state from the
   log, freshness-bounded and fail-closed, and is never asked to
   decide anything.

This casting adds a fifth, structural consequence:

5. **The substrate is a port.** Replication, convergence mechanics,
   group key agreement, and history opening are requirements on an
   adapter, not designs of this layer. What the group *decides* is
   ours; *how the machinery carries it out* is pluggable — and
   auditable against four port requirements.

### 1.2 Position

The Identity layer supplies anchors (main DIDs) and key recovery. The
Encounter layer supplies immutable evidence that people met —
consumable here as policy inputs (4.2). The Delivery Contract carries
operations to parties outside the replica boundary, as the task types
of the Membership Tasks; inside the boundary, the replicated log
itself is the transport. The Membership Tasks define how invitation,
consent, and welcome travel; this layer defines what makes an
admission — or any other operation — canonical.

### 1.3 Principles inherited

- **Issuance counts, arrival never** (Encounter 1.3): an operation's
  validity is a function of its signatures and its causal position,
  never of arrival time. No rule in Sections 3–8 consults a clock.
- **Authenticity has exactly one carrier** (Delivery 1.1): the
  operation envelope carries its signatures and encloses or
  digest-commits everything it vouches for.
- **The log is canonical; a task is a feeder** (Membership 1.2):
  effects follow materialization, never delivery.

## 2. Conventions and Terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" are to be interpreted as described in BCP 14 [RFC2119]
[RFC8174] when, and only when, they appear in all capitals.

The **interim securing profile** of Encounter 2.3 applies: JCS
[RFC8785] is the canonical serialization; digests are multibase
multihash over JCS bytes; signatures are Ed25519 under `did:key`
anchors unless a registered profile states otherwise.

**Group** — a collective actor with members, a policy, an authority
log, and documents, identified by a self-certifying group DID (3.2).
**Authority log** — the append-only operation DAG rooted in the
genesis operation; the sole source of authorization state.
**Operation** — a signed, causally anchored envelope (3.3).
**Materialization** — the deterministic derivation of group state
from the log (3.5, 3.6); an operation is **canonical** when
materialization at its causal position accepts it and no rule of 3.6
suppresses or displaces it. **Policy** — group-defined data stating,
per privileged operation, which proof satisfies the group's decision
rule (Section 4). **Capability** — a grantable, narrowable permission
(Section 6). **Epoch** — a numbered period of the group's key world;
enforcement takes effect as epoch transitions (Section 7); term
aligned with MLS [RFC9420]. **Epoch-key lineage** — the chain of
per-transition entries by which the previous epoch's content key is
readable under the next epoch's key (7.1). **Replica boundary** — the
set of parties holding (and entitled to hold) the group's replicated
log at a given materialized state (Membership §2). **Enforcement
substrate** — the machinery satisfying the port of Section 9;
**adapter** — a registered binding of one substrate to that port.

| Term | Fragment | | Term | Fragment |
|---|---|---|---|---|
| Group | `#Group` | | Grant | `#Grant` |
| Authority log | `#AuthorityLog` | | Epoch | `#Epoch` |
| Operation | `#Operation` | | Epoch-key lineage | `#EpochKeyLineage` |
| Materialized state | `#MaterializedState` | | Privileged operation | `#PrivilegedOperation` |
| Member | `#Member` | | Visibility mode | `#VisibilityMode` |
| Policy | `#Policy` | | Implicit capability | `#ImplicitCapability` |
| Policy proof | `#PolicyProof` | | Enforcement substrate | `#EnforcementSubstrate` |
| Capability | `#Capability` | | Adapter | `#Adapter` |

## 3. The Authority Log

### 3.1 One log, one truth

- A group MUST have exactly one authority log. All authorization
  decisions MUST be derived from its materialized state and from
  nothing else — never from document content, replication metadata,
  or service state.
- The log replicates through the substrate (Section 9) as encrypted
  state readable by members — and, where visibility is `open`, per
  Section 8.

### 3.2 Group identity and genesis

- A group identifier MUST be a self-certifying DID: the DID's key
  signs the genesis operation (3.4.1). After genesis the root key
  confers no standing authority; the root secret MAY be destroyed.
- A newcomer verifies a group by: group DID → genesis validation →
  operation DAG → materialized state. There is no other bootstrap;
  the log **is** the genesis chain. The genesis digest a newcomer
  compares against is the one bound into their own invitation
  (Membership 3.1) — lineage verification, not state verification.

### 3.3 The operation envelope

Every operation is one envelope (shown as JSON; JCS is the canonical
serialization):

```json
{
  "v": "rltp-access/0.4",
  "op": "member.remove",
  "group": "did:key:z6Mk…group",
  "epoch": 7,
  "policyVersion": 3,
  "prev": ["oid:…", "oid:…"],
  "body": { …operation-specific… },
  "crit": ["…extension fields that MUST be understood…"],
  "id": "oid:…",
  "author": "did:key:z6Mk…member",
  "proof": {
    "mechanism": "signature-set",
    "signatures": [ { "signer": "did:key:…", "sig": "…" } ]
  }
}
```

- **`id` (self-addressing):** the digest of the JCS serialization of
  the envelope with `id` set to the empty string and `proof` omitted,
  encoded as `oid:` + base64url(SHA-256), unpadded. Every signature
  in `proof` is over exactly that same serialization. The `id` is
  therefore bound by every signature, and the envelope binds
  operation type, full content, group, epoch, `policyVersion`, and
  causal predecessors — an operation is not valid anywhere else, at
  any other position, or under any other policy.
- **`prev`:** the op-ids of the DAG heads known to the author at
  authoring time. The genesis operation has `prev: []` and is the
  only such operation.
- **`epoch` / `policyVersion`:** MUST equal the epoch and policy
  version of the state materialized from the operation's ancestors.
  An operation whose ancestors do not produce that pair is invalid —
  this, not wall-clock time, is the replay and race gate.
- **No clock in validity:** no rule in Sections 3–8 makes validity or
  epoch effect depend on a verifier's wall clock. Two honest
  verifiers holding the same operations MUST reach the same verdict
  at any time. Wall-clock claims exist only at service boundaries,
  as signed fields with declared skew bounds (7.3).
- **`crit`:** extension fields whose semantics restrict authority. A
  verifier encountering an unknown field listed in `crit` MUST reject
  the envelope; unknown fields not listed in `crit` MUST be ignored.
  Fields defined in this document are never listed in `crit`.
- Application of an operation MUST be idempotent by `id`.

### 3.4 Operation validity

#### 3.4.1 Genesis validation

The genesis operation has no ancestors and is validated by its own
complete procedure. It is valid iff:

1. its envelope parses and its `id` recomputes;
2. `prev` is `[]`, `epoch` is `0`, `policyVersion` is `1`;
3. `proof.mechanism` is `signature-set` with exactly one signature,
   by the key of the DID in `group`, over the envelope serialization
   — this, and nothing else, makes the group DID self-certifying;
4. its body contains `members` (initial membership, at least one
   anchor, duplicate-free), `policy` (structurally valid and
   satisfiable against the initial membership per 4.4), and
   `visibility` (Section 8);
5. `author` names one of the initial members.

A log MUST contain exactly one operation with empty `prev`; two
distinct genesis operations for one group DID are a fork of the group
itself, and implementations MUST treat the group as invalid until
exactly one genesis is established. The initial members' implicit
capabilities (6.1) are rooted here; epoch 0's key material is
produced by the adapter at genesis (9.5).

#### 3.4.2 General validation

A non-genesis operation is valid iff, in order:

1. its envelope parses and its `id` recomputes;
2. all `prev` references resolve to valid operations of the same
   group;
3. with *S* the state materialized from its ancestors: `epoch` and
   `policyVersion` equal those of *S*;
4. its policy proof satisfies the applicable rule of *S*'s policy
   against *S*'s membership (4.3) — except `member.leave` and the
   last-member `group.dissolve`, where the subject's own signature
   suffices (5.4);
5. its body passes operation-specific validation (Sections 4–8),
   including post-state validation at its declared position
   (anti-deadlock 4.4; chain rule 6.2; no narrowing without
   transition 7.1).

Validity is judged at the operation's declared position. Whether a
valid operation *takes effect* in a merged materialization is
governed by 3.6.

### 3.5 Materialization

- Materialization MUST be deterministic: fold valid operations in
  topological order of the DAG; mutually concurrent operations fold
  in ascending `id` order under unsigned bytewise comparison of the
  complete `oid:` string's ASCII bytes — an exact total order, no
  locale, no decoding.
- The fold applies each operation's effect subject to 3.6; a
  suppressed operation remains *valid* but confers no effect in that
  materialization. Canonicality is revisable until the DAG is stable:
  a later-merged concurrent branch MAY displace previously
  materialized effects, deterministically and identically on every
  replica.
- **Signals versus canonical state:** operations travelling as
  messages (signals, including trust tasks) MUST NOT change
  materialized state on receipt; they MAY create durable pending
  records and provisional UX only if valid against local state; the
  merged log decides. Signal disposition MUST be a deterministic
  function of `(operation, local state, existing pending state)`.

### 3.6 Concurrency: the conflict matrix

Operations divide into **additive** operations (no epoch effect —
they only ever extend membership, capabilities, or metadata),
**enforcement** operations (they carry an epoch transition, 4.5), and
the **terminal** `group.dissolve`. Three class rules govern merges of
concurrent branches; the matrix fixes every defined pairing; unlisted
additive pairings merge freely. Where any rule leaves a choice, the
materialized result MUST take the lesser authority (authority
conservatism).

**Class rules.**

1. *additive ∥ additive:* both take effect. Set-valued state merges
   by union; a contested scalar field takes the value folded last
   under 3.5's order.
2. *additive ∥ enforcement:* both take effect; where they conflict
   about authority, the enforcement side prevails. The merge creates
   remediation duties (below).
3. *enforcement ∥ enforcement:* sibling epochs. Their merge is
   undefined in this version (OI-1). Interim rule: an implementation
   observing sibling epochs MUST NOT build further
   enforcement-relevant operations on either sibling and MUST
   surface the condition for reconciliation; silently discarding
   either sibling is not conformant — it discards security effects.
   Until OI-1 is resolved, conformant operation is single-partition
   per group for enforcement operations — which is exactly the
   linear interim adapter's scope (9.6).

**Matrix of defined pairings.**

| Concurrent pairing | Merge rule |
|---|---|
| `member.add` ∥ `member.add`, same enclosed accept | one canonical admission by the arbitration rule of 5.3; all candidates admit the same subject, so membership is unaffected; any delivered welcome remains effective |
| `member.add` ∥ `member.add`/`grant`, different subjects | union |
| `grant` ∥ `grant` | union of capabilities |
| `grant` ∥ `member.remove` of the granter | the grant confers nothing; the removal prevails |
| `member.add` of X ∥ `member.remove` of X | the removal prevails; X is not a member of the merged state |
| `member.add` ∥ epoch transition (any) | X is a member of the merged state but lacks post-transition keys → **re-welcome duty** |
| `grant` ∥ epoch transition (any) | the grant survives iff its granter survives; services learn the merged set via authorization refresh |
| `grant` ∥ `grant.revoke` of the same grant | impossible: a `grant.revoke` MUST name a grant in its ancestry (6.2), so the pair cannot be concurrent |
| `policy.change` ∥ `policy.change`, same base version | the one folded **first** under 3.5's order takes effect; every other same-base `policy.change` takes no effect and MUST be surfaced for re-proposal |
| `policy.change` ∥ enforcement operation | both valid at their positions; post-merge validation applies |
| `member.leave` ∥ epoch transition | the leave merges; its rotation obligation (5.4) is satisfied iff the merged state contains a transition from whose key distribution the leaver was excluded, otherwise it stands |
| `member.leave` ∥ `member.remove`, same subject | the subject is gone either way; the removal's transition governs and satisfies the obligation |

**Post-merge validation.** After folding concurrent branches the
materializer MUST validate the merged state:

- *Anti-deadlock:* if a `policy.change` that took effect renders
  `policy.change` unsatisfiable against the **merged** membership, it
  retroactively takes no effect and the prior policy stands.
- *Key coverage:* every merged member either holds the current
  epoch's key material or is the subject of an open re-welcome duty.

**Remediation duties** obligate members, never services:

- *Re-welcome:* on merging a branch in which a member was admitted
  concurrently with an epoch transition, any member holding the
  current epoch keys MUST deliver them to the affected member via
  Delivery as soon as the merge is materialized.
- *Authorization refresh:* on merging authorization changes from
  another branch, a member MUST propagate the merged state toward
  services through the adapter (7.3), so no service acts on a
  narrower or wider set than the log's.
- *Rotation on displacement:* upon merging a displacement of a
  concurrent admission (5.3), the group SHOULD issue an
  `epoch.rotate` where a history-narrowing visibility policy is in
  force (Membership §8).

## 4. Policy

### 4.1 The policy object

```json
{
  "policyVersion": 3,
  "rules": {
    "member.add":     { "type": "any-member" },
    "member.remove":  { "type": "threshold", "k": 2 },
    "policy.change":  { "type": "strongest" },
    "history.expose": { "type": "strongest" }
  }
}
```

- Every group has a policy from genesis. Operations without an
  explicit rule fall to the default rule
  `{"type": "actors", "actors": [<genesis members>], "k": 1}`.
- `policyVersion` MUST increase by exactly 1 with every effective
  `policy.change`.

### 4.2 Requirement types

Four types are defined; the set is open (Section 11); unknown types
are unsatisfiable (degradation direction, 11).

- **`any-member`** — one signature of any current member;
  semantically `threshold` with `k: 1`.
- **`actors`** — `{ "type": "actors", "actors": [did…], "k": n }`:
  signatures of `k` distinct listed identities that are current
  members. `actors` MUST be non-empty and duplicate-free;
  `1 ≤ k ≤ |actors|`.
- **`threshold`** — `{ "type": "threshold", "k": n }`: signatures of
  `k` distinct current members, `k ≥ 1`. Currency is evaluated
  against the membership of the operation's declared position.
- **`encounter`** — `{ "type": "encounter", "count": n }`: satisfied
  when the operation's **subject** (e.g. the candidate of
  `member.add`) proves encounter edges to `n` distinct current
  members. An edge counts iff the subject presents an encounter
  credential **issued by that member about the subject** (incoming
  evidence, Encounter 4.2); grades do not exist at Layer 2 and are
  not invented here. Proof form: `encounter-presentation` (4.3).
  Verifiers MUST evaluate presented credentials only; no registry
  resolution. *(Minimal-disclosure presentation: OI-5.)*

Rules MAY be composed: `{ "type": "all", "of": [rule…] }` and
`{ "type": "any", "of": [rule…] }` with the obvious semantics;
composition depth MUST NOT exceed 4.

### 4.3 Policy proofs

`proof` carries a `mechanism` and its material. Two mechanisms are
defined; future mechanisms (e.g. a FROST threshold signature, OI-2)
MAY satisfy the same contract.

- **`signature-set`** — `proof.signatures`: signatures over the
  envelope serialization (3.3), each by a signer qualifying under the
  applicable rule at the operation's declared position. Verification
  MUST check signer qualification, signature validity, distinctness,
  and arity.
- **`encounter-presentation`** — `proof.credentials`: one complete
  encounter credential per claimed edge (validated per Encounter §7),
  each issued **by** a distinct current member of the declared
  position **about** the subject; plus, in `proof.signatures`, the
  subject's signature over the envelope. The envelope signature is
  what binds the presentation to exactly this operation — the
  credentials themselves are immutable evidence and need no
  freshness. Verification MUST check credential validity, issuer
  currency and distinctness, subject binding, count, and the
  subject's envelope signature.

Where a composed rule mixes types, `proof.mechanism` is `composite`
and the object carries both `signatures` and `credentials`; each
component rule is verified against its material under its own
contract.

### 4.4 The policy algebra

**Satisfaction sets.** The strength order is semantic, not syntactic.
For a rule *R* and evaluation state *S*, define **Sat(R, S)** — the
set of proof situations satisfying *R* — recursively: `any-member` =
all signer sets containing ≥ 1 current member; `threshold k` = ≥ k
distinct current members; `actors A, k` = ≥ k distinct current
members listed in A; `all[…]` = intersection; `any[…]` = union;
`encounter n` = all presentation situations proving edges to ≥ n
distinct current members. Signature and encounter situations live in
disjoint universes; a composed rule's situations are pairs drawn from
both.

**Strength order.** *R₁ ≥ R₂ iff Sat(R₁, S) ⊆ Sat(R₂, S).* Verifiers
MUST compute the order from satisfaction sets — by enumeration over
the finite signer universe of *S* or a provably equivalent symbolic
procedure. Syntactic shortcuts are not conformant: they are unsound.
Two consequences any conformant procedure reproduces (and the vector
suite tests): `actors({a,b}, 2) ≥ actors({a}, 1)`, and
`all[actors({a},1), actors({b},1)] ≥ threshold(2)` where a, b are
current members. Pure `encounter` rules compare by `count`; they are
incomparable with pure signature rules; composed rules compare via
their satisfaction sets.

**`strongest`** is a meta-rule valid only inside a policy: it denotes
`all[ maximal elements of the policy's other rules under ≥ at the
evaluation state ]`, computed deterministically (incomparable maxima
are all included). A policy whose rules are all meta-rules is
invalid.

**Validation.** At genesis and every `policy.change`, the new policy
MUST be structurally valid (arities per 4.2, depth ≤ 4, `strongest`
resolvable to a non-empty rule) and **satisfiable**: every rule,
after meta-resolution, against the post-operation membership — in
particular `threshold(k)` requires `k ≤ |members|`, `actors(A,k)`
requires `|A ∩ members| ≥ k`, `encounter(n)` requires
`n ≤ |members|` excluding a candidate subject. An enforcement
operation (other than `member.leave`) whose post-state makes
`policy.change` unsatisfiable is invalid (anti-deadlock); the
post-merge re-check is in 3.6. If shrinkage renders *other* rules
unsatisfiable, the affected operations are blocked (fail closed)
until the policy is changed — which anti-deadlock keeps possible.
Groups SHOULD prefer `threshold` over `actors` where shrinkage is
expected *(shrink-robust forms: OI-10)*.

### 4.5 Privileged operations (catalog)

| Operation | Class | Epoch effect | Notes |
|---|---|---|---|
| `member.add` | additive | none | body per 5.3; consumes an accept; commits its welcome |
| `member.remove` | enforcement | **transition, atomic** | body carries the transition (7.1) |
| `member.leave` | additive¹ | obligates next transition | single-signature path (5.4) |
| `epoch.rotate` | enforcement | **transition, atomic** | hygiene / post-compromise rotation |
| `policy.change` | additive | none | validation per 4.4; concurrency per 3.6 |
| `visibility.change` | enforcement | **transition, atomic** | constraints in Section 8 |
| `history.expose` | additive | none | body carries the disclosure (Section 8); default rule `strongest` |
| `grant` | additive | none | Section 6 |
| `grant.revoke` | enforcement | **transition, atomic — always** | no liveness judgment: revoking any grant transitions, expired or not |
| `document.attach` | additive | none | |
| `document.detach` | enforcement | **transition, atomic** | detach rotates |
| `group.dissolve` | terminal | terminal | two paths (5.4) |
| `credential.issue` | additive | none | Section 8.4; default rule `strongest` |

¹ `member.leave` shrinks membership but cannot carry a transition
(the leaver must not know post-leave keys); it is classed additive
for merge purposes and covered by its obligation mechanism (5.4).

Every registered operation MUST declare its class and epoch effect.
Operations marked *transition, atomic* carry the transition **in the
same envelope**: claim and ability change together or not at all —
the atomicity requirement the port enforces (9.3). The class
assignment upholds the epoch invariant of 7.1: **every operation that
removes or narrows a live capability is an enforcement operation.**

## 5. Members

### 5.1 Identity

Members are anchors — main DIDs of the Identity layer; the native
profile is `did:key` with mnemonic recovery. Device-level signing is
an Identity-layer concern. *(Method agnosticism and identity scoping:
OI-7.)*

### 5.2 Derived service identities

For every service interaction an actor MUST use a derived service
identity, deterministically derivable from its recovery seed and the
group context, and MUST NOT present its main anchor to a service.
Loss of all devices MUST NOT extinguish standing: every
authority-bearing key of this layer MUST be re-derivable from the
recovery seed.

### 5.3 Admission and removal

**Admission is consent-bound.** This section owns, normatively, the
`member.add` body profile and materialization rules that Membership
Tasks 0.7 §3.3 defined and marked for adoption (its MO-5); the
document shapes (invite, accept, welcome seal) remain defined there.

An admitting `member.add`'s body carries:

- `subject` — the admitted anchor;
- `admission` — the full consent evidence:
  `{ "invite": <complete membership-invite document>,
     "accept": <complete membership-accept document>,
     "welcome": <digest of the welcome plaintext> }`.

Enclosing the complete signed documents — not digests — is what
makes admission verifiable without private knowledge: every replica
holds the evidence, any authorized member can complete an admission,
and invitation provenance is read from the enclosed invite's
signature, never from an assertable field.

**Materialization accepts an admitting `member.add` only if, at its
causal position:**

1. both enclosed documents validate against their schemas and their
   proofs verify — the invite under `invite.inviter`, the accept
   under `accept.subject`;
2. all cross-bindings hold: `accept.ref` = document digest of the
   enclosed invite; `accept.subject` = `invite.invitee` =
   `body.subject`; `accept.group` = `invite.group` =
   `operation.group`; `invite.inviter` = the enclosed invite's
   `issuer`; card ownership per Membership 3.1/3.2; the enclosed
   invite's `recipient` = `invite.invitee`; the enclosed accept's
   `recipient` = the enclosed invite's `issuer`; both documents share
   the invite's `threadId`; `invite.validUntil` ≥ the invite's
   `issuedAt`;
3. the time window holds: the accept's `issuedAt` and `proof.created`
   ≤ `invite.validUntil` + `membership-skew` (an honest-clock bound;
   the effective gate on stale consent is the human admission
   decision);
4. `invite.inviter` is authorized to invite at the operation's causal
   position, per the group's policy for `member.add`;
5. **the accept is consumed exactly once, merge-stably**, in two
   steps. *Causal step:* a candidate whose `prev` closure already
   contains a rule-passing admission for the same accept digest is
   non-canonical outright — a causally later replay can never
   displace its ancestor. *Concurrency step:* among the remaining,
   mutually concurrent candidates exactly one is canonical: smallest
   `id` under 3.5's byte order. Displacement is benign for
   membership — all candidates enclose the identical accept and
   therefore the identical subject; the bootstrap effect is served by
   any rule-passing candidate's welcome, and arbitration never
   invalidates a delivered welcome.

A `member.add` failing any of these is not canonical, whatever its
signatures. The welcome seal, its digest commitment
(`admission.welcome`), and the boundary-crossing delivery rule are
Membership §3.3/§4; the welcome's `material` is produced by the
adapter (9.5) and carries the current epoch only — history opens
through the lineage (7.1).

**Removal.** `member.remove`'s body names the subject **and carries
the epoch transition** (7.1). On merging a removal that
materialization accepts as a new canonical transition — never on
delivery — implementations MUST apply removal hygiene: stop write
attempts after durably preserving unsent local work, invalidate
runtime authority immediately (no privileged operation may race a
removal), and SHOULD wipe group key material once the removal is
canonical, subject to the unique-data boundary (Section 12). The
removal notice travelling to the removed member is Membership §3.3
case 2.

### 5.4 Leave and dissolve

- `member.leave` is always valid with exactly the subject's own
  signature, independent of policy. Because the leaver MUST NOT know
  post-leave keys, the leave cannot carry its own transition; it
  **obligates** the next one: any remaining member is authorized
  (rule `any-member`, non-overridable) to issue the follow-up
  `epoch.rotate`, and implementations MUST issue it as soon as they
  merge a leave. The obligation is discharged exactly when the
  materialized state contains a transition from whose key
  distribution the leaver was excluded. The window between leave and
  that transition is prospective-only exposure and MUST be surfaced
  as such.
- `group.dissolve` has two paths: **last-member** (when the
  materialized membership at the declared position contains exactly
  the author, the author's own signature suffices; a `member.leave`
  by the last member MUST be treated as this path) and **collective**
  (valid under its policy rule, default `strongest`). Dissolution is
  terminal: no further operations are valid; disposition of documents
  follows the Layer-4 data policy declared at attach time.

## 6. Capabilities

### 6.1 Actions and the implicit capability

Three actions are defined — **`relay`** (store and forward
ciphertext, no read: the formal name of can't-be-evil
infrastructure), **`read`**, **`write`** — an open set; unknown
actions confer nothing. **There is no `admin` action**: privileged
operations are policy-gated, never capability-gated; collective
authority is not delegable.

Every member holds, by membership alone, the implicit capability
`{ actions: ["read", "write"], scope: <the whole group>,
validUntil: null }`, rooted in the operation that made it a member.
This is the root of the chain rule: every grant chain bottoms out in
an implicit capability. Implicit capabilities end with membership —
removal and leave carry or obligate epoch transitions, so no implicit
capability of a former member survives into the epoch after its
departure.

### 6.2 Grants

A `grant` operation body:

```json
{ "grantee": "did:key:…", "actions": ["read"],
  "validUntil": "2026-12-31T00:00:00Z",
  "scope": { "documents": ["…"] } }
```

- Signed by the granting member (the envelope `author`); authorized
  per the policy rule for `grant` (default `any-member`).
- **Chain rule:** a granter MUST NOT confer actions or scope
  exceeding its own current capability; a grant exceeding it is
  invalid. The chain is finite and grounded by construction.
- Grants are valid offline: validity is judged at the grant's
  declared position; a later-merged grant is subject to the conflict
  matrix if its granter was concurrently removed.
- `grant.revoke` names a grant `id`, which MUST be in the revoke's
  ancestry, and always carries an epoch transition (4.5) — no
  liveness judgment, no clock.
- Attenuation happens at grant time: subset of the granter's
  actions, shorter validity, narrower scope. Chained re-delegation:
  OI-4.
- Grant operations live in the encrypted log; no artifact presented
  outward carries the granter identity (Section 13).

How a grantee *exercises* a capability toward a service — and how a
service checks it — is adapter and service-contract territory bound
by 7.3's obligations; this layer defines only the in-log authority.
*(The 0.3 commitment/token machinery is withdrawn; its successor is
OI-12.)*

## 7. Epochs

### 7.1 Transitions and the epoch-key lineage

An epoch transition is carried **inside** the operation that requires
it (4.5). Its body section `transition` contains:

- `newEpoch` = epoch + 1;
- `keyDist`: references to the per-remaining-member key envelopes
  (new content key and epoch secrets, encrypted to each retained
  member, distributed via Delivery);
- `lineage`: the previous epoch's content key, encrypted under the
  new epoch's key — **present by default, absent exactly where the
  group's visibility policy narrows history at this transition**.
  Omission is the narrowing act; nothing else narrows (Section 8).

The transition envelope MUST NOT contain plaintext secret material of
the new epoch: the log remains readable to members of the old epoch —
including the subject of a removal — so anything they must not learn
travels only inside the per-recipient encrypted envelopes. Members
MUST apply transitions in ancestry order; on a gap, buffer and
recover material through the adapter.

**The lineage discharges Membership's MO-6:** a member holding the
current epoch key unlocks the readable history from the replica,
epoch by epoch, exactly as far back as unbroken lineage entries
reach. History never burdens the welcome; nothing can be withheld
from a new member that is not equally withheld from the replica.
Where lineage is absent (narrowed, or an adapter without it), a
bootstrap degrades honestly to current-epoch access and MUST be
surfaced as such. An adapter MAY realize the lineage invariant in
another form (9.4) — the invariant, not the encoding, is normative.

**The epoch invariant (grow-only).** Within one epoch, live
capabilities only grow: every operation that removes or narrows a
live capability carries an epoch transition (4.5), and
`member.leave` obligates one. Normatively: **an operation whose
effect removes or narrows a live capability without carrying an
epoch transition is invalid.** Consequence: any service view of an
epoch's authorization set is a subset of every later view of the
same epoch — acting on a slightly stale view of the current epoch
never grants what the log revoked (7.3).

### 7.2 What rotation guarantees

Rotation yields **prospective confidentiality** (new-epoch content is
unreadable to non-members of that epoch) and **post-compromise
security** (compromise of pre-rotation material does not extend into
post-rotation epochs). It does not and cannot revoke knowledge: keys
and plaintext already held remain held. Implementations MUST NOT
present removal as erasure.

### 7.3 Services follow the log

A service (relay, replication provider, or any infrastructure
enforcing an action) MUST derive its authorization view from the
group's materialized state, through the adapter, under four
obligations:

1. **Authenticated:** the view is traceable to signed operations or
   to an authenticated digest of materialized state; a service MUST
   NOT accept unauthenticated assertions of authorization.
2. **Freshness-bounded:** the group declares a staleness bound; a
   service whose view is older than the bound MUST fail closed for
   epoch-sensitive decisions until refreshed. Wall-clock enters here
   and only here, against declared skew bounds.
3. **Fail-closed:** on any gap, inconsistency, or unknown state, the
   answer is rejection, never a lookup or a guess.
4. **Never a winner-picker:** on evidence of a fork (sibling epochs,
   divergent views), a service MUST enter a persistent fail-closed
   state for the group, durably retaining the evidence, until the
   group reconciles in its log. Responsibility for the choice lies in
   the group's log, attributably — never at a service.

The wire mechanism carrying the view is adapter-specific and MUST be
registered with the adapter (9.1); the chained authorization-update
format of draft 0.3 is one admissible mechanism, archived with that
draft. A service-side authorization profile for capability exercise
by non-members is OI-12.

## 8. Visibility Modes

- Default `private`: reading requires epoch key material or a `read`
  capability exercised per 7.3.
- `open`: content **from epoch `E` onward** is world-readable
  (content keys from `E` published); write remains capability-bound;
  moderation is policy.
- `visibility.change` (atomic transition) constraints: the stated `E`
  MUST equal the transition's `newEpoch` — a visibility change can
  only ever open from its own new epoch onward. Closing takes effect
  from `newEpoch`; what was world-readable remains so factually, and
  implementations MUST NOT suggest otherwise.
- **`history.expose {fromEpoch}`** is the sole way to expose anything
  earlier (default rule `strongest`). It is valid only where the
  materialized visibility at its declared position is `open`, with
  `fromEpoch` earlier than the opening epoch. Its body MUST carry the
  disclosure artifact itself: the content keys of the epochs
  `[fromEpoch, E)`. The operation is world-readable like all
  open-epoch log content, so merging the operation **is** the
  disclosure — the log entry and real readability cannot diverge. No
  other mechanism may publish historical keys.
- Concurrency: as enforcement operations, visibility changes fall
  under 3.6's sibling-epoch interim rule; a removal and an opening on
  concurrent branches cannot silently combine.

### 8.4 The membrane

A group MAY issue credentials about its own state, gated by
`credential.issue` (default rule `strongest`):

- **Membership credential** (interoperable with DTG
  `MembershipCredential`), issued under the group DID; issuance is an
  operation, so the log records it.
- **Personhood projection:** where `member.add` includes an
  `encounter` rule, membership credentials MAY state that fact — a
  personhood credential anchored in the encounter graph rather than a
  certification authority.
- Outward credentials reveal exactly their claims — never grants,
  granters, the invitation graph, or non-subject members.

## 9. The Enforcement Port

This layer's constitution (Sections 3–8) is enforced by a substrate:
the machinery that replicates the log, converges branches, agrees
group keys, rotates them, and opens history. The substrate is bound
through a **port** of four requirements. An **adapter** is a
registered binding of one substrate to this port; a registration
names the substrate, its concurrency scope, its lineage form (9.4),
its `material` key schema (9.5), and its service-view mechanism
(7.3).

### 9.1 What the port presupposes

A substrate is admissible only if it provides: individually signed
operations in a causal DAG; deterministic materialization with a
deterministic concurrency tie-break; idempotent application by
operation id; and transport of this layer's envelope (3.3)
**unmodified** — the envelope stays the sole authority carrier, and a
substrate that re-signs, re-wraps, or re-orders authority content is
not admissible.

### 9.2 P1 — Policy injection

The substrate's materialization MUST evaluate this layer's validity
and canonicality rules (3.4, 3.6, 5.3): an operation this layer
rejects MUST NOT take effect in any replica's materialization, and a
replica ingesting raw substrate state MUST reach the same verdicts
as one fed through any API. A substrate whose materialization cannot
be extended with profile rules — or that enforces them only in a
local wrapper other replicas can bypass — does not satisfy P1.

### 9.3 P2 — Atomic enforcement

An enforcement operation and its epoch transition are **one
committable artifact**: no observable state in which the authority
claim has taken effect but the key world has not transitioned, or the
reverse. Lazy rekeying that leaves a removed member's key world
intact until some later write does not satisfy P2.

### 9.4 P3 — History opening

Invariant: **current-epoch key + replica ⇒ readable history exactly
as the visibility policy permits** (7.1). Admissible forms include
the native epoch-key lineage (a per-transition entry in the log) and
causal encryption (each content block carrying predecessor pointers
and keys). Whatever the form: history material MUST live in the
replica, never in the welcome — the welcome carries the current epoch
only and is bounded by Membership's plaintext budget. A substrate
whose only history channel is welcome-time bulk key transfer does not
satisfy P3.

### 9.5 P4 — Welcome production

The adapter MUST produce, for an admission at a given materialized
position, the welcome `material`: what the subject needs to
participate in the current epoch, and nothing older.

```json
{ "v": "rltp-access-material/0.4", "adapter": "<registered id>",
  "epoch": 7, "keys": { …adapter-defined, closed per registration… } }
```

The binding fields (`v`, `adapter`, `epoch`) are owned by this layer;
`keys` is owned by the adapter registration and closed there. The
serialized material MUST fit the welcome plaintext budget (Membership
§4); an adapter that cannot bound its material does not satisfy P4.
This object is the `material` Membership §4 carries opaquely — its
MO-4 is discharged by this schema.

### 9.6 Adapter #1: the linear interim adapter (normative)

The reference adapter binds the port to a totally ordered log:
enforcement operations form a single lane (no sibling epochs by
construction — the honest embodiment of 3.6's interim rule);
additive operations may interleave. It evaluates this layer's rules
natively (P1), commits an enforcement operation and its transition
as one artifact in the total order (P2), records epoch-key lineage
entries (P3), and emits `material` containing exactly the current
content key and epoch secret (P4). Registration id: `linear/0.1`.
It is intentionally modest: no partition tolerance for enforcement,
which 3.6 requires of every conformant implementation until OI-1
resolves — the adapter's scope and the layer's are the same.

### 9.7 Candidate adapters (informative)

Two existing substrates were mapped against this port in design
(2026-08): **p2panda-auth/encryption** satisfies P1 through its
replaceable resolver and P2 through its space-membership commit; its
welcome-time full-secret-bundle history model must relocate to the
replica for P3, and its browser story is open. **Keyhive** is the
P3 exemplar — causal encryption is the cleanest existing form of the
history invariant — but today lacks a policy-injection point (P1)
and performs removal rekeying lazily (P2). Neither is a conformant
adapter today; both port gaps are concrete, scoped contribution
targets, and the port is shaped so that either could become an
adapter without changing this layer.

## 10. Service Ports

This layer requires, and does not define:

- **Delivery port:** authenticated end-to-end-encrypted delivery to
  derived identities with durable buffering and explicit disposition
  — satisfied by the Delivery Contract 0.17, whose task types for
  this layer are the Membership Tasks 0.7. Carries: operation
  documents crossing the replica boundary, welcome and key
  envelopes, re-welcome deliveries.
- **Replication port:** convergent replication of the encrypted
  authority log and documents; deterministic merge; offline
  operation; no reachable central service required — satisfied
  through the enforcement adapter (Section 9).

Services themselves are bound by 7.3. No vocabulary of any concrete
service (brokers, heads, sequence numbers) appears in this layer's
model; any service satisfying a port contract is substitutable.

## 11. Evolvability

- Every wire artifact carries its version (`rltp-access/0.4`,
  `rltp-access-material/0.4`).
- Extension is additive: new operations, requirement types, actions,
  proof mechanisms, visibility modes, and adapters register new
  identifiers; existing identifiers are never re-interpreted. A newly
  registered operation MUST declare its class and epoch effect; an
  operation that can remove or narrow capabilities MUST be
  enforcement class (7.1).
- **Degradation direction:** unknown constructs degrade toward *less*
  authority — unknown requirement type → unsatisfiable; unknown
  action → nothing; unknown operation → invalid as proof subject;
  unknown critical field → reject; unknown non-critical field →
  ignore. Hard rejection is reserved for cryptographic invalidity
  and `crit` violations.
- Renames only via alias table; key-derivation paths are never
  renamed. A group MAY pin a minimum profile version in policy.

## 12. Security Considerations

- **Fail-closed evaluation.** Authorization defaults to deny. A
  verifier without current materialized state MUST NOT authorize
  privileged operations against a stale one; epoch and policyVersion
  binding make stale proofs invalid rather than dangerous.
- **The log is the perimeter.** Everything reduces to operation
  validity and the deterministic merge; implementations MUST NOT
  introduce side channels of authority — shared keys, service flags,
  document contents. The port presupposition (9.1) extends the
  perimeter through the substrate: an adapter that lets raw ingestion
  bypass profile rules reopens exactly the two-plane split this
  layer exists to close.
- **Consent is verifiable by everyone who must judge it.** The
  admitting operation encloses the signed invite and accept (5.3), so
  a malicious authorized member cannot make a consentless admission
  canonical, and the consumable rule caps one admission per accept —
  causally against replay, deterministically under concurrency.
- **Honest revocation.** 7.2 states exactly what rotation buys; UX
  MUST NOT present removal as retroactive erasure.
- **Leave window.** Between `member.leave` and the obligated
  transition, the leaver retains read ability for in-flight content;
  implementations MUST minimize the window (immediate rotation on
  merge) and MUST NOT accept new content into the old epoch after
  observing a leave.
- **Merge remediation windows.** A member admitted concurrently with
  a transition has a keyless window until re-welcome (3.6). It is an
  availability gap, never an authority gap — no key decrypts during
  it; implementations MUST discharge the duty eagerly and surface
  the pending state.
- **Service staleness.** A service acting within its declared
  staleness bound on the current epoch can at worst honor the epoch's
  grow-only past (7.1), never a revoked state; beyond the bound it
  fails closed. A colluding party feeding a service a narrower view
  achieves denial of service, never authority.
- **Lineage is a disclosure surface.** Each lineage entry extends
  what one current key unlocks; that is its purpose, and its
  presence is governed by visibility policy alone (7.1). Narrowing
  by omission is irreversible for the omitted span except through
  `history.expose` — deliberate, logged, and carrying its own
  disclosure.
- **Deadlock by shrinkage.** Anti-deadlock (4.4) blocks removals that
  would kill the constitution, but `member.leave` cannot be blocked;
  a group can become constitutionally locked (only leaves and
  dissolution remain). Stated, surfaced, and preferable to
  hostage-taking; shrink-robust forms are OI-10.
- **Teardown.** Runtime authority (cached views, derived keys, open
  handles) MUST be invalidated on removal and identity switch; stale
  runtime generations must not act.
- **Unique data at removal.** Wiping MUST NOT destroy the only copy
  of data the group is entitled to retain, and MUST NOT retain what
  the removed member is entitled to withdraw; the Layer-4 data
  policy governs; the boundary MUST be explicit.
- **Time gates.** The only wall-clock checks in this layer sit at the
  service boundary (7.3), each against a declared skew bound
  consistent with enclosing transport gates. Log validity never
  consults a clock.

## 13. Privacy Considerations

- **Toward services:** a service sees derived pseudonymous
  identities, epoch numbers, and whatever its registered view
  mechanism carries — never main anchors, membership, grants,
  granters, policy, or the invitation graph. **This is a floor on
  adapters:** an adapter MUST NOT expose membership, policy, grants,
  or the invitation graph in plaintext to non-members or
  infrastructure. (Informative: both candidate substrates of 9.7
  currently sit below this floor — plaintext control messages in
  one, a plaintext authorization graph at sync providers in the
  other; the floor is a required contribution, not an aspiration.)
- **Inside the group:** grants and admissions are individually
  attributable (internal accountability), encrypted to members
  (external invisibility). The permanence cost of admission
  enclosure — both cards, both proofs, forever in the log — is
  stated in Membership §8 and capped by its size budget.
- **Encounter predicates** disclose to the verifying members that the
  subject holds edges to specific members — bounded,
  addressee-directed disclosure; the subject's wider graph stays
  undisclosed (OI-5 minimizes further).
- **Open mode is a one-way door**, and `history.expose` exists so
  that its retroactive form is a separate, deliberate, logged act
  whose body is the disclosure itself.

## 14. Conformance

- **Profile** `rltp-access@0.4`; normatively references
  `rltp-membership@0.7` (document shapes, welcome seal, transport)
  and, through it, `rltp-delivery@0.17`; where encounter rules are
  used, `rltp-encounter@0.19`.
- **Classes:** *member agent* (log, materialization including
  conflict matrix and admission rules, policy evaluation, grants,
  transitions, remediation duties, hygiene) · *policy verifier*
  (3.4/Section 4 evaluation only) · *adapter* (Section 9, P1–P4
  plus 9.1) · *service* (7.3 obligations only).
- **Vector plan:**
  - genesis: valid; empty-membership, wrong-signer, nonzero-epoch,
    second-genesis rejection; initial-policy satisfiability;
  - envelope: id recomputation; cross-group/cross-epoch/
    cross-position replay rejection; `crit` handling; idempotent
    re-application;
  - materialization: determinism including concurrent folds under
    the byte order; one vector per conflict-matrix row; post-merge
    anti-deadlock and key-coverage checks; leave-obligation
    discharge;
  - admission (rules 1–5): each cross-binding violated → not
    canonical; expired accept; unauthorized inviter; causal replay
    of a consumed accept → non-canonical outright; concurrent
    consumption → exactly one canonical, identical on every replica;
    displacement leaves membership and delivered welcome intact;
  - policy algebra: satisfaction-set order to depth 4 including the
    two counterexamples of 4.4; `strongest` with incomparable
    maxima; satisfiability validation; anti-deadlock;
  - proofs: arity, distinctness, stale policyVersion/epoch
    rejection; encounter-presentation: issuer currency and
    distinctness, subject binding, count, envelope signature; an
    outgoing credential presented as evidence → rejected;
  - grants: chain rule grounded in implicit capabilities;
    offline-authored merge; concurrent-removal conservatism;
    narrowing-without-transition invalidity; `grant.revoke`
    transition always, including expired grants;
  - transitions: no-plaintext-secret envelope check; ancestry-order
    application; lineage present by default, absent exactly under
    narrowing; degraded bootstrap surfaced where lineage is absent;
  - services (7.3): stale view within bound honors grow-only set;
    beyond bound fails closed; fork evidence → persistent
    fail-closed, surviving restart, cleared only by group
    reconciliation;
  - port: an operation rejected by profile rules ingested raw into
    the substrate takes no effect on any replica (P1); no observable
    claim-without-transition state (P2); history readable from
    replica with only the current key, exactly to the policy bound
    (P3); `material` schema-valid, current-epoch-only, within the
    welcome budget (P4);
  - visibility: `E = newEpoch` constraint; `history.expose`
    key-artifact presence, open-mode-only validity, range check.
- Every normative statement is vector-testable or explicitly
  state-dependent (disposition, remediation duties, teardown),
  exercised with controlled state and clock.

## 15. Open Issues

- **OI-1 Sibling-epoch merge.** Causal epoch DAG with conflict keys
  (the BeeKEM direction) versus deterministic winner plus
  re-rotation. The interim rule (3.6) and the service fork handling
  (7.3) are its boundary and hook; the port keeps the resolution
  adapter-shaped.
- **OI-2 Threshold proofs (FROST).** Collapses policy proofs to one
  group signature; DKG/resharing on membership change; external
  indistinguishability of quorum composition.
- **OI-3 Group identifier migration** (legacy UUID spaces → genesis
  DIDs; alias discipline).
- **OI-4 Chained attenuation** (re-delegation by non-members).
- **OI-5 Encounter-presentation minimal disclosure.**
- **OI-7 Member-identity model** (method agnosticism; main DID vs.
  per-group derived member identity with a verifiable Layer-2 link)
  — to be settled by the Identity layer casting.
- **OI-10 Shrink-robust policy forms** (relative thresholds;
  recovery from constitutional lock).
- **OI-12 Capability exercise toward services.** With the 0.3
  commitment/token machinery withdrawn, the concrete mechanism by
  which a non-member grantee proves a capability to a service —
  and by which a `relay` service gates pulls — is open, bound by
  7.3's obligations and Section 13's floor. Candidates: a slimmed
  commitment scheme, UCAN-style envelopes, adapter-native
  authorization.
- *(Resolved elsewhere: the delivery envelope question by the
  Delivery Contract 0.17; policy-proof transport for richer
  admission rules and leave/dissolve notices are Membership MO-2 and
  MO-3.)*

## References

[RFC2119] · [RFC8174] BCP 14 · [RFC8785] JCS · [RFC9420] MLS (epoch
terminology) · **RLTP Encounter Layer 0.19** (securing profile 2.3,
credentials §7, evidence direction §4.2) · **RLTP Delivery Contract
0.17** (delivery port) · **RLTP Membership Tasks 0.7** (document
shapes §3, welcome seal §4, timing §5) · W3C Verifiable Credentials
Data Model 2.0 · DTG Credential Specification (ToIP DTGWG, draft) ·
Keyhive / BeeKEM design documents (causal encryption; ePrint
2026/1434) · p2panda-auth documentation (resolver model)
