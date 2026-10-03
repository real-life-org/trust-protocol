# RLTP Access Layer

**Real Life Trust Protocol — Layer 3: Access**

- **Status:** Editor's Draft
- **Version:** 0.5.0-draft (fifth casting)
- **Editors:** Anton Tranelis
- **Date:** 2026-08-11
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Conformance profile:** `rltp-access@0.5` (draft)
- **Position:** Layer 3 of RLTP, above the Encounter Layer 0.19 and
  the Identity layer, carried by the Delivery Contract 0.17 where
  operations or keys must reach parties outside the replica; the
  Membership Tasks 0.7 register the task types that transport this
  layer's admission documents and are a normative companion.
- **Supersedes:** version 0.4.0-draft (archived as
  `archive/access-layer-0.4-viertguss.md`); version 0.3.0-draft
  (wot-spec `rltp/access-layer.md`, archived there with its
  reviews); on adoption, the group/membership portions of wot-spec
  `03-wot-sync/005-gruppen.md`.

## Abstract

This document specifies the Access layer of the Real Life Trust
Protocol (RLTP): how a **group** of people holds shared authority
over its membership, its data, and itself. Its spine is the
**authority log** — a causally linked DAG of individually signed
operations rooted in a self-certifying, single-founder genesis.
Group state is a deterministic materialization of this log;
**policies** are group-defined decision rules gating privileged
operations; **epochs** are the enforcement periods that make
revocation real — prospectively — in an end-to-end-encrypted,
local-first setting; services follow the log through chained,
quorum-signed **authorization views**.

The machinery that replicates the log, converges branches, agrees
and rotates keys, and opens history is an **enforcement substrate**
behind a normative **port** of four requirements (Section 9). The
constitution is this layer's own; the substrate is replaceable, and
a linear interim adapter satisfies the port with the semantics
deployed today.

Two things are deliberately deferred, not designed badly: grantable
capabilities for non-members (the exercise mechanism must exist
first — OI-12) and group-issued credentials (the credential profile
must exist first — OI-13). This casting specifies only what it can
make sound.

Access is deliberately separate from trust: the Encounter layer
records that people met and recognized each other; the Access layer
governs what a collective grants, and how it takes it back.
Encounter credentials are immutable and never revoked; access is
revocable by construction. That difference is why the layers exist.

## Status of This Document

This is an **Editor's Draft** with no standing beyond its own
argument, the fifth casting of this layer. It is developed through
the same adversarial convergence process as the Encounter Layer,
the Delivery Contract, and the Membership Tasks (casting,
independent adversarial review, full recast — never a patch). The
first two castings were answered by review rounds one and two of
the previous line; the fourth casting — the first built on the
enforcement port — was answered by an adversarial round finding
blocker-level gaps in merge semantics, key bootstrap, service
freshness, and capability exercise, all answered by this recast.
This casting has not yet completed its own round. The document will
change; known open questions are collected in Section 15. Feedback
is welcome via the issues of the publication repository
(github.com/real-life-org/rltp-spec).

## 1. Introduction (informative)

### 1.1 Essence

Five consequences follow from making the log the sole authority,
and they are the layer:

1. **There are no admins.** Privileged operations are gated by the
   group's own policy — a decision rule stated as data. A single
   founder-admin is the `k = 1` special case, not the model.
2. **Authority is a log, not a key.** No key held by anyone confers
   standing authority; the genesis key signs once and may be
   destroyed. Every authorization decision is a deterministic
   reading of signed operations.
3. **Revocation is an epoch, honestly stated.** Removing someone
   cannot un-teach them what they read; it can and must stop them
   prospectively. Every operation that removes or narrows authority
   in a continuing group carries a key-world transition,
   atomically; leaving obligates one; dissolution ends the group
   itself.
4. **Services follow the log.** No service keeps its own registry
   of who belongs; infrastructure learns authorization state
   through chained, quorum-signed views — position-monotone,
   freshness-bounded, fail-closed — and is never asked to decide
   anything.
5. **The substrate is a port.** Replication, convergence mechanics,
   group key agreement, and history opening are requirements on an
   adapter, not designs of this layer. The adapter is thereby also
   named honestly for what it is: part of the trusted computing
   base for confidentiality, with its obligations stated (9.1).

### 1.2 Position and scope

The Identity layer supplies anchors (main DIDs) and key recovery.
The Encounter layer supplies immutable evidence that people met —
consumable here as policy inputs (4.2). The Delivery Contract
carries documents to parties the replica cannot reach; the
Membership Tasks define how invitation, consent, and welcome
travel; this layer defines what makes an admission — or any other
operation — canonical, and registers one further task type of its
own: `key-delivery/0.1` (10.1), by which transition keys and
re-welcomes travel.

Out of scope by decision, tracked as open issues: capability grants
to non-members and their service-side exercise (OI-12); group-issued
outward credentials (OI-13).

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
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY",
and "OPTIONAL" are to be interpreted as described in BCP 14
[RFC2119] [RFC8174] when, and only when, they appear in all
capitals.

The **interim securing profile** of Encounter 2.3 applies: JCS
[RFC8785] is the canonical serialization; digests are multibase
multihash over JCS bytes; signatures are Ed25519 under `did:key`
anchors unless a registered profile states otherwise. The **sealed
envelope** construction of Delivery §5 is reused with its own HKDF
info strings where this document says so.

**Group** — a collective actor with members, a policy, an authority
log, and documents, identified by a self-certifying group DID
(3.2). **Authority log** — the append-only operation DAG rooted in
the genesis operation; the sole source of authorization state; its
content is readable by members only, always (3.1). **Operation** —
a signed, causally anchored envelope (3.3). **Materialization** —
the deterministic derivation of group state from the log (3.5,
3.6); an operation is **canonical** when materialization at its
causal position accepts it and no rule of 3.6 suppresses or
displaces it. **Forked state** — the distinguished, fail-closed
materialization outcome produced by sibling epochs (3.6). **Policy**
— group-defined data stating, per privileged operation, which proof
satisfies the group's decision rule (Section 4). **Epoch** — a
numbered period of the group's key world; enforcement takes effect
as epoch transitions (Section 7); term aligned with MLS [RFC9420].
**Epoch-key lineage** — the chain of per-transition entries by
which the previous epoch's content key is readable under the next
epoch's key (7.1). **Authorization view** — the chained,
quorum-signed object by which a service learns a group's epoch,
log position, and authorized service identities (7.3). **Implicit
capability** — the read/write standing every member holds by
membership alone (Section 6). **Replica boundary** — the set of
parties holding (and entitled to hold) the group's replicated log
at a given materialized state (Membership §2). **Enforcement
substrate** — the machinery satisfying the port of Section 9;
**adapter** — a registered binding of one substrate to that port.
**Welcome duty / re-welcome** — the standing obligation of members
to (re)deliver current-epoch key material to a party the
materialized state entitles to it (3.6, 5.3).

| Term | Fragment | | Term | Fragment |
|---|---|---|---|---|
| Group | `#Group` | | Epoch | `#Epoch` |
| Authority log | `#AuthorityLog` | | Epoch-key lineage | `#EpochKeyLineage` |
| Operation | `#Operation` | | Authorization view | `#AuthorizationView` |
| Materialized state | `#MaterializedState` | | Privileged operation | `#PrivilegedOperation` |
| Forked state | `#ForkedState` | | Visibility mode | `#VisibilityMode` |
| Member | `#Member` | | Implicit capability | `#ImplicitCapability` |
| Policy | `#Policy` | | Enforcement substrate | `#EnforcementSubstrate` |
| Policy proof | `#PolicyProof` | | Adapter | `#Adapter` |

## 3. The Authority Log

### 3.1 One log, one truth

- A group MUST have exactly one authority log. All authorization
  decisions MUST be derived from its materialized state and from
  nothing else — never from document content, replication metadata,
  or service state.
- The log replicates through the substrate (Section 9) as encrypted
  state **readable by members only — in every visibility mode**.
  `open` visibility opens document content, never the authority log
  (Section 8).

### 3.2 Group identity and genesis

- A group identifier MUST be a self-certifying DID: the DID's key
  signs the genesis operation (3.4.1). After genesis the root key
  confers no standing authority; the root secret MAY be destroyed.
- **Genesis is single-founder.** The initial membership is exactly
  one anchor — the founder, who creates the group key, signs the
  genesis with it, and countersigns as themselves. Everyone else,
  co-founders included, joins through the ordinary admission chain
  (5.3). No one can be claimed into a group they never consented
  to: every membership except the founder's rests on a signed
  accept, and the founder's rests on their own two signatures.
- A newcomer verifies a group by: group DID → genesis validation →
  operation DAG → materialized state. There is no other bootstrap;
  the log **is** the genesis chain. The genesis digest a newcomer
  compares against is the one bound into their own invitation
  (Membership 3.1) — lineage verification, not state verification.

### 3.3 The operation envelope

Every operation is one envelope (shown as JSON; JCS is the
canonical serialization):

```json
{
  "v": "rltp-access/0.5",
  "op": "member.remove",
  "group": "did:key:z6Mk…group",
  "epoch": 7,
  "policyVersion": 3,
  "prev": ["oid:…", "oid:…"],
  "body": { …operation-specific, Section 4.5… },
  "crit": ["…extension fields that MUST be understood…"],
  "id": "oid:…",
  "author": "did:key:z6Mk…member",
  "proof": {
    "mechanism": "signature-set",
    "signatures": [ { "signer": "did:key:…", "sig": "…" } ]
  }
}
```

- **`id` (self-addressing):** the digest of the JCS serialization
  of the envelope with `id` set to the empty string and `proof`
  omitted, encoded as `oid:` + base64url(SHA-256), unpadded. Every
  signature in `proof` is over exactly that same serialization. The
  `id` is therefore bound by every signature, and the envelope
  binds operation type, full content, group, epoch,
  `policyVersion`, and causal predecessors — an operation is not
  valid anywhere else, at any other position, or under any other
  policy.
- **One envelope per id.** `proof` is outside the `id`. A replica
  holding several envelopes with the same `id` MUST store and
  propagate exactly one: among those whose proof validates, the one
  whose complete-envelope JCS digest is smallest under the byte
  order of 3.5; envelopes whose proof does not validate are not
  candidates. Application of an operation MUST be idempotent by
  `id`.
- **`prev`:** the op-ids of the DAG heads known to the author at
  authoring time. The genesis operation has `prev: []` and is the
  only such operation.
- **`epoch` / `policyVersion`:** MUST equal the epoch and policy
  version of the state materialized from the operation's ancestors.
  An operation whose ancestors do not produce that pair is invalid
  — this, not wall-clock time, is the replay and race gate.
  (Whether the policy its ancestors produced remains effective
  after a merge is 3.6's suppression cascade.)
- **No clock in validity:** no rule in Sections 3–8 makes validity
  or epoch effect depend on a verifier's wall clock. Two honest
  verifiers holding the same operations MUST reach the same verdict
  at any time. Wall-clock claims exist only at the service boundary
  (7.3), as signed fields with declared skew bounds.
- **`crit`:** extension fields whose semantics restrict authority.
  A verifier encountering an unknown field listed in `crit` MUST
  reject the envelope; unknown fields not listed in `crit` MUST be
  ignored. The shipped transcription schema accordingly passes
  unknown fields through; rejection on unknown content is the
  `crit` mechanism's job, never the schema's. Fields defined in
  this document are never listed in `crit`.

### 3.4 Operation validity

#### 3.4.1 Genesis validation

The genesis operation has no ancestors and is validated by its own
complete procedure. It is valid iff:

1. its envelope parses, `op` is `"group.genesis"`, and its `id`
   recomputes;
2. `prev` is `[]`, `epoch` is `0`, `policyVersion` is `1`;
3. `proof.mechanism` is `signature-set` with exactly two
   signatures over the envelope serialization: one by the key of
   the DID in `group` (self-certification) and one by the founder's
   anchor (consent — no one founds a group over someone else's
   name);
4. its body contains: `members` — exactly one anchor, the founder;
   `policy` — structurally valid and satisfiable against the
   founder-only membership per 4.4; `visibility` — the initial mode
   (Section 8); `adapter` — the registered adapter id (Section 9);
   `contentKeyCommitment` — digest of the epoch-0 content key,
   which the founder produces locally through the adapter (9.5; no
   distribution exists or is needed at genesis);
   `serviceIdentity` — the founder's derived service identity
   (5.2), seeding the view quorum (7.3);
5. `author` is the founder.

A log MUST contain exactly one operation with empty `prev`; two
distinct genesis operations for one group DID are a fork of the
group itself, and implementations MUST treat the group as invalid
until exactly one genesis is established.

#### 3.4.2 General validation

A non-genesis operation is valid iff, in order:

1. its envelope parses and its `id` recomputes;
2. all `prev` references resolve to valid operations of the same
   group;
3. with *S* the state materialized from its ancestors: `epoch` and
   `policyVersion` equal those of *S*;
4. its policy proof satisfies the applicable rule of *S*'s policy
   against *S*'s membership (4.3) — except `member.leave`,
   `service-identity.announce`, and the last-member
   `group.dissolve`, where the author's own signature suffices
   (4.5, 5.4);
5. its body passes operation-specific validation (Sections 4–8),
   including post-state validation at its declared position
   (anti-deadlock 4.4; no narrowing without transition 7.1).

Validity is judged at the operation's declared position. Whether a
valid operation *takes effect* in a merged materialization is
governed by 3.6, including its suppression cascade.

### 3.5 Materialization

- Materialization MUST be deterministic: fold valid operations in
  topological order of the DAG; mutually concurrent operations fold
  in ascending `id` order under **unsigned bytewise comparison of
  the complete `oid:` string's ASCII bytes** — an exact total
  order, no locale, no decoding.
- The fold applies each operation's effect subject to 3.6; a
  suppressed operation remains *valid* but confers no effect in
  that materialization. Canonicality is revisable until the DAG is
  stable: a later-merged concurrent branch MAY displace previously
  materialized effects, deterministically and identically on every
  replica.
- Materialization has three possible outcomes: a group state, the
  **terminal** state (dissolved, or membership empty — 5.4), or the
  **forked state** (3.6). All three are deterministic functions of
  the DAG.
- **Signals versus canonical state:** operations travelling as
  messages (signals, including trust tasks) MUST NOT change
  materialized state on receipt; they MAY create durable pending
  records and provisional UX only if valid against local state; the
  merged log decides. Signal disposition MUST be a deterministic
  function of `(operation, local state, existing pending state)`.

### 3.6 Concurrency: the conflict matrix

Operations divide into **additive** operations (no epoch effect),
**enforcement** operations (they carry an epoch transition, 4.5),
and the **terminal** `group.dissolve`. Class rules govern merges of
concurrent branches; the matrix fixes the defined pairings;
unlisted additive pairings merge by union. (The design principle
behind every rule — where authority is contested, materialize the
lesser authority — is informative; the rules themselves are
exhaustive and explicit.)

**Class rules.**

1. *additive ∥ additive:* both take effect. Set-valued state merges
   by union; a contested scalar field takes the value folded last
   under 3.5's order.
2. *additive ∥ enforcement:* both take effect; where they conflict
   about authority, the enforcement side prevails. The merge
   creates remediation duties (below).
3. *enforcement ∥ enforcement:* sibling epochs. Their merged key
   world is undefined in this version (OI-1); their merged
   **materialization outcome is defined**: the group enters the
   **forked state** — a distinguished, deterministic outcome in
   which no operation building on either sibling is canonical, all
   authorization answers are fail-closed, services holding evidence
   of both siblings hold their own fail-closed state (7.3), and the
   condition MUST be surfaced. The forked state ends only by
   reconciliation (OI-1); until OI-1 is resolved, conformant
   operation is single-partition per group for enforcement
   operations — the linear interim adapter's scope (9.6). A
   malicious authorized member can force the forked state; that is
   a denial of service by an insider against their own group,
   fail-closed and attributable, never an authority gain.
4. *terminal ∥ anything:* the dissolution prevails. Operations
   concurrent with a canonical `group.dissolve` remain valid at
   their positions but confer no effect in the merged
   materialization; the merged state is terminal.

**Matrix of defined pairings.**

| Concurrent pairing | Merge rule |
|---|---|
| `member.add` ∥ `member.add`, same subject (same or different accepts) | exactly one canonical admission by 5.3's arbitration; the others confer nothing and consume nothing |
| `member.add` ∥ `member.add`/additive op, different subjects | union |
| `member.add` of X ∥ `member.remove` of X | the removal prevails; X is not a member of the merged state; X's accept is not consumed (5.3) |
| `member.add` of X ∥ `member.leave` of X | impossible to conflict: at the add's position X was still a member (leave undischarged) → the add is not canonical by rule 0 of 5.3; after a discharged leave, re-admission requires a fresh invite and accept |
| `member.add` ∥ epoch transition (any) | X is a member of the merged state but lacks post-transition keys → **re-welcome duty** |
| `policy.change` ∥ `policy.change`, same base version | the one folded **first** under 3.5's order takes effect; every other same-base `policy.change` confers nothing and MUST be surfaced for re-proposal |
| `policy.change` ∥ enforcement operation | both valid at their positions; post-merge validation and the suppression cascade apply |
| `member.leave` ∥ epoch transition | the leave merges; its rotation obligation (5.4) is satisfied iff the merged state contains a transition from whose key distribution the leaver was excluded, otherwise it stands |
| `member.leave` ∥ `member.remove`, same subject | the subject is gone either way; the removal's transition governs and discharges the obligation |
| `member.leave` ∥ `member.leave` (any subjects) | both merge; obligations per 5.4; if the merged membership is empty, the state is terminal (5.4) |
| `service-identity.announce` ∥ anything additive | union; per-anchor scalar (the announced key) takes the value folded last |

**Post-merge validation.** After folding concurrent branches the
materializer MUST validate the merged state:

- *Anti-deadlock:* if a `policy.change` that took effect renders
  `policy.change` unsatisfiable against the **merged** membership,
  it retroactively confers nothing and the prior policy stands.
- *Key coverage (structural):* for every epoch transition in the
  merged state, the recipient set of its `keyDist` (7.1) MUST equal
  the members retained by it; every member admitted concurrently
  with a transition MUST be the subject of an open re-welcome duty.
  (Whether a recipient has *decrypted* their envelope is delivery
  state, not log state; the log-checkable predicate is coverage.)

**The suppression cascade.** Validation (3.4.2) judges an operation
against the state its *ancestors* produce. A merge can render an
ancestor ineffective (a losing same-base `policy.change`, an
anti-deadlock reversal). Therefore, deterministically: after
folding, every operation whose step-4 evaluation used a policy
introduced by an operation that confers no effect in the merged
materialization MUST be re-evaluated against the policy effective
at its position in the merged materialization; if its proof does
not satisfy the effective rule, the operation confers no effect —
and this re-evaluation cascades to operations that depended on
*it*, recursively, until a fixed point. The cascade only ever
removes effects, never adds them, so it terminates and is
order-independent. An attacker can therefore not park an operation
under a permissive losing policy and have it survive the loss.

**Remediation duties** obligate members, never services:

- *Re-welcome:* on merging a branch in which a member was admitted
  concurrently with an epoch transition, any member holding the
  current epoch keys MUST deliver them to the affected member via
  `key-delivery` (10.1) as soon as the merge is materialized.
- *View refresh:* on merging authorization changes from another
  branch, a member of the view quorum MUST issue a fresh
  authorization view (7.3), so no service acts on a narrower or
  wider set than the merged log's.
- *Rotation on displacement:* upon merging a displacement of a
  concurrent admission (5.3), the group SHOULD issue an
  `epoch.rotate` where history has been narrowed (7.1), closing the
  displaced welcome's adjacent-epoch exposure forward.

## 4. Policy

### 4.1 The policy object and the defaults

```json
{
  "policyVersion": 3,
  "rules": {
    "member.remove":  { "type": "threshold", "k": 2 },
    "policy.change":  { "type": "strongest" }
  }
}
```

- Every group has a policy from genesis. `policyVersion` MUST
  increase by exactly 1 with every effective `policy.change`.
- **Registered defaults.** Every registered privileged operation
  has exactly one registered default rule, effective where the
  policy names none. There is no second fallback; the defaults
  are:

| Operation | Default rule |
|---|---|
| `member.add` | `any-member` |
| `member.remove` | `strongest` |
| `epoch.rotate` | `any-member` (hygiene must stay cheap; the leave obligation requires it, 5.4) |
| `policy.change` | `strongest` |
| `visibility.change` | `strongest` |
| `history.expose` | `strongest` |
| `document.attach` | `any-member` |
| `document.detach` | `strongest` |
| `group.dissolve` (collective path) | `strongest` |

  `member.leave` and `service-identity.announce` are
  self-authorized (author's signature; not policy-gated, not
  overridable). A future registered operation MUST register its
  default rule with its definition (Section 11). An operation type
  with no registration is invalid as a proof subject — there is
  nothing to default to.

### 4.2 Requirement types

Four types are defined; the set is open (Section 11); unknown
types are unsatisfiable (degradation direction, Section 11).

- **`any-member`** — one signature of any current member;
  semantically `threshold` with `k: 1`.
- **`actors`** — `{ "type": "actors", "actors": [did…], "k": n }`:
  signatures of `k` distinct listed identities that are current
  members. `actors` MUST be non-empty and duplicate-free;
  `1 ≤ k ≤ |actors|`.
- **`threshold`** — `{ "type": "threshold", "k": n }`: signatures
  of `k` distinct current members, `k ≥ 1`. Currency is evaluated
  against the membership of the operation's declared position.
- **`encounter`** — `{ "type": "encounter", "count": n }`:
  satisfied when the operation's **subject** proves encounter edges
  to `n` distinct current members. An edge counts iff the subject
  presents an encounter credential **issued by that member about
  the subject** (incoming evidence, Encounter 4.2); grades do not
  exist at Layer 2 and are not invented here. Proof form:
  `encounter-presentation` (4.3). Verifiers MUST evaluate presented
  credentials only; no registry resolution. **Subject-bound:** an
  encounter rule (also inside a composition) is assignable only to
  operations with a defined subject distinct from the proof's
  signers — in this catalog, exactly `member.add`. A
  `policy.change` introducing an encounter rule for any other
  operation is structurally invalid (4.4). *(Minimal-disclosure
  presentation: OI-5.)*

Rules MAY be composed: `{ "type": "all", "of": [rule…] }` and
`{ "type": "any", "of": [rule…] }` with the obvious semantics;
composition depth MUST NOT exceed 4.

### 4.3 Policy proofs

`proof` carries a `mechanism` and its material. Two mechanisms are
defined; future mechanisms (e.g. a FROST threshold signature, OI-2)
MAY satisfy the same contract.

- **`signature-set`** — `proof.signatures`: signatures over the
  envelope serialization (3.3), each by a signer qualifying under
  the applicable rule at the operation's declared position.
  Verification MUST check signer qualification, signature validity,
  distinctness, and arity.
- **`encounter-presentation`** — `proof.credentials`: one complete
  encounter credential per claimed edge (validated per Encounter
  §7), each issued **by** a distinct current member of the declared
  position **about** the subject; plus, in `proof.signatures`, the
  subject's signature over the envelope. The envelope signature is
  what binds the presentation to exactly this operation — the
  credentials are immutable evidence and need no freshness.
  Verification MUST check credential validity, issuer currency and
  distinctness, subject binding, count, and the subject's envelope
  signature.

Where a composed rule mixes types, `proof.mechanism` is
`composite` and the object carries both `signatures` and
`credentials`; each component rule is verified against its material
under its own contract.

### 4.4 The policy algebra

**The proof space.** A **proof situation** over an evaluation state
*S* is a pair *(A, P)*: *A* a set of signers, *P* a presentation —
a set of (issuer, credential) edges about the operation's subject
(empty where the operation has none). All satisfaction sets live in
this one product space:

- `Sat(any-member)` = { (A, P) : A contains ≥ 1 current member }
- `Sat(threshold k)` = { (A, P) : A contains ≥ k distinct current
  members }
- `Sat(actors A₀, k)` = { (A, P) : A contains ≥ k distinct current
  members listed in A₀ }
- `Sat(encounter n)` = { (A, P) : P proves edges from ≥ n distinct
  current members, and A contains the subject }
- `Sat(all[…])` = intersection; `Sat(any[…])` = union — ordinary
  set operations, well-defined because every set is a set of pairs.

**Strength order.** *R₁ ≥ R₂ iff Sat(R₁, S) ⊆ Sat(R₂, S).*
Verifiers MUST compute the order from satisfaction sets — by
enumeration over the finite signer and edge universe of *S* or a
provably equivalent symbolic procedure. Syntactic shortcuts are not
conformant: they are unsound. Two consequences any conformant
procedure reproduces (and the vector suite tests):
`actors({a,b}, 2) ≥ actors({a}, 1)`, and
`all[actors({a},1), actors({b},1)] ≥ threshold(2)` where a, b are
current members. For an operation without a subject, every
encounter set is empty, hence maximal under ⊆ — one more reason
encounter rules are subject-bound (4.2).

**`strongest`** is a meta-rule valid only inside a policy. Its
resolution, per operation: (1) discard **all** meta-rules from the
policy's rule set — `strongest` never ranges over itself or
another meta-rule; (2) discard rules not assignable to the
operation (subject-binding, 4.2); (3) `strongest` denotes
`all[ the maximal elements of the remainder under ≥ at the
evaluation state ]`, incomparable maxima all included. A policy
MUST contain at least one concrete (non-meta) rule; resolution
against an empty remainder is structurally invalid.

**Validation.** At genesis and every `policy.change`, the new
policy MUST be structurally valid (arities per 4.2, depth ≤ 4,
subject-binding respected, `strongest` resolvable) and
**satisfiable**: every rule, after meta-resolution, against the
post-operation membership — `threshold(k)` requires
`k ≤ |members|`, `actors(A,k)` requires `|A ∩ members| ≥ k`,
`encounter(n)` requires `n ≤ |members|` excluding a candidate
subject. An enforcement operation (other than a leave-discharging
rotation) whose post-state makes `policy.change` unsatisfiable is
invalid (anti-deadlock); the post-merge re-check and cascade are in
3.6. If shrinkage renders *other* rules unsatisfiable, the affected
operations are blocked (fail closed) until the policy is changed —
which anti-deadlock keeps possible. Groups SHOULD prefer
`threshold` over `actors` where shrinkage is expected
*(shrink-robust forms: OI-10)*.

### 4.5 Privileged operations (catalog and body profiles)

| Operation | Class | Epoch effect | Body (normative profile) |
|---|---|---|---|
| `group.genesis` | — (root) | creates epoch 0 | 3.4.1: `members`, `policy`, `visibility`, `adapter`, `contentKeyCommitment`, `serviceIdentity` |
| `member.add` | additive | none | `subject`, `admission` (5.3) |
| `member.remove` | enforcement | **transition, atomic** | `subject`, `transition` (7.1) |
| `member.leave` | additive¹ | obligates next transition | empty; the subject is the author (5.4) |
| `epoch.rotate` | enforcement | **transition, atomic** | `transition` |
| `policy.change` | additive | none | `policy` (the complete new object, 4.1) |
| `visibility.change` | enforcement | **transition, atomic** | `mode`, `transition` (Section 8) |
| `history.expose` | additive | none | `fromEpoch`, `keys` (Section 8) |
| `document.attach` | additive | none | `document` (identifier), `dataPolicy` (Layer-4 disposition declaration) |
| `document.detach` | enforcement | **transition, atomic** | `document`, `transition` |
| `group.dissolve` | terminal | terminal | empty (two paths, 5.4) |
| `service-identity.announce` | additive | none | `serviceIdentity` (5.2); self-authorized |

¹ `member.leave` cannot carry a transition (the leaver must not
know post-leave keys); it is classed additive for merge purposes
and covered by its obligation mechanism (5.4).

Every registered operation MUST declare its class, epoch effect,
default rule (4.1), and body profile; the shipped transcription
schema carries the body profiles. Operations marked *transition,
atomic* carry the transition **in the same envelope**: claim and
ability change together or not at all — the atomicity the port
enforces (9.3). The class assignment upholds the epoch invariant of
7.1.

## 5. Members

### 5.1 Identity

Members are anchors — main DIDs of the Identity layer; the native
profile is `did:key` with mnemonic recovery. Device-level signing
is an Identity-layer concern. *(Method agnosticism and identity
scoping: OI-7.)*

### 5.2 Derived service identities

- For every service interaction an actor MUST use a **derived
  service identity** and MUST NOT present its main anchor to a
  service. The native derivation: an Ed25519 key derived from the
  actor's recovery seed via HKDF with info
  `rltp/v1/service-identity/<group DID>` — deterministic,
  per-group, re-derivable after total device loss (nothing
  authority-bearing lives only on a device).
- The binding member ↔ derived identity lives **inside the
  encrypted log**: the founder's identity in the genesis body, every
  other member's via `service-identity.announce` — additive,
  self-authorized, body `{ "serviceIdentity": "did:key:…" }`,
  authored by the member it binds. A member MUST announce before
  participating in the view quorum (7.3); implementations SHOULD
  announce immediately upon admission. Toward services the derived
  identities appear bare; the mapping to anchors never leaves the
  log.

### 5.3 Admission and removal

**Admission is consent-bound.** This section owns, normatively, the
`member.add` body profile and materialization rules that Membership
Tasks 0.7 §3.3 defined and marked for adoption (its MO-5); the
document shapes (invite, accept, welcome seal) remain defined
there.

An admitting `member.add`'s body carries:

- `subject` — the admitted anchor;
- `admission` — the full consent evidence:
  `{ "invite": <complete membership-invite document>,
     "accept": <complete membership-accept document>,
     "welcome": <digest of the welcome plaintext> }`.

Enclosing the complete signed documents — not digests — is what
makes admission verifiable without private knowledge: every replica
holds the evidence, any authorized member can complete an
admission, and invitation provenance is read from the enclosed
invite's signature, never from an assertable field.

**Materialization accepts an admitting `member.add` only if, at
its causal position:**

0. `subject` is **not** a member of the state materialized from the
   operation's ancestors (re-admission after a discharged leave or
   removal requires a fresh invite and accept; an accept is never
   reusable, rule 5);
1. both enclosed documents validate against their schemas and their
   proofs verify — the invite under `invite.inviter`, the accept
   under `accept.subject`;
2. all cross-bindings hold: `accept.ref` = document digest of the
   enclosed invite; `accept.subject` = `invite.invitee` =
   `body.subject`; `accept.group` = `invite.group` =
   `operation.group`; `invite.inviter` = the enclosed invite's
   `issuer`; card ownership per Membership 3.1/3.2; the enclosed
   invite's `recipient` = `invite.invitee`; the enclosed accept's
   `recipient` = the enclosed invite's `issuer`; both documents
   share the invite's `threadId`; `invite.validUntil` ≥ the
   invite's `issuedAt`;
3. the time window holds: the accept's `issuedAt` and
   `proof.created` ≤ `invite.validUntil` + `membership-skew` (an
   honest-clock bound; the effective gate on stale consent is the
   human admission decision);
4. `invite.inviter` is authorized to invite at the operation's
   causal position, per the applicable `member.add` rule;
5. **consumption and arbitration, merge-stable.** *Causal step:* a
   candidate whose `prev` closure already contains a rule-passing
   admission of the same subject **or** of the same accept digest
   is non-canonical outright — a causally later replay can never
   displace its ancestor. *Concurrency step:* among the remaining,
   mutually concurrent admission candidates **of the same subject**
   (whatever their accepts), exactly one is canonical: smallest
   `id` under 3.5's byte order. Only the canonical admission
   consumes its accept; a displaced candidate's accept remains
   unconsumed. Displacement is benign for membership — every
   candidate admits the same subject; the bootstrap effect is
   served by any rule-passing candidate's welcome, and arbitration
   never invalidates a delivered welcome.

A `member.add` failing any of these is not canonical, whatever its
signatures.

**The welcome duty (no admission hostage).** A canonical admission
entitles its subject to the current epoch's key material,
independently of whether the admitting member ever delivered the
committed welcome. Any member holding the current epoch keys MUST,
upon a request from the subject of a canonical admission (or upon
otherwise learning the subject lacks its welcome), produce fresh
welcome material through the adapter (9.5) at the current
materialized position and deliver it via `key-delivery` (10.1).
Consuming an accept without publishing a usable welcome therefore
delays a bootstrap; it cannot hold membership hostage. The welcome
seal, its digest commitment, and the boundary-crossing delivery
rule are Membership §3.3/§4.

**Removal.** `member.remove`'s body names the subject **and
carries the epoch transition** (7.1). On merging a removal that
materialization accepts as a new canonical transition — never on
delivery — implementations MUST apply removal hygiene: stop write
attempts after durably preserving unsent local work, invalidate
runtime authority immediately (no privileged operation may race a
removal), and SHOULD wipe group key material once the removal is
canonical, subject to the unique-data boundary (Section 12). The
removal notice travelling to the removed member is Membership §3.3
case 2.

### 5.4 Leave and dissolve

- `member.leave` is always valid with exactly the author's own
  signature, independent of policy. **Its authority effect takes
  place at the discharging transition, not at the leave itself:**
  the leaver remains a member — honestly, since they hold the
  epoch keys either way — until the materialized state contains an
  epoch transition from whose key distribution they were excluded.
  The leave *obligates* that transition: any remaining member is
  authorized (rule `any-member`, non-overridable) to issue the
  follow-up `epoch.rotate`, and implementations MUST issue it as
  soon as they merge a leave. Until discharge, the pending exit
  MUST be surfaced (membership list and services see the leaver as
  a member with a pending exit; the window is prospective-only
  exposure). Because membership shrinks only at the transition, the
  epoch invariant (7.1) and the service grow-only argument (7.3)
  hold without exception.
- **Empty membership is terminal.** If a materialization's
  membership is empty — concurrent leaves of the last members, in
  any pattern — the group state is terminal, exactly as after
  `group.dissolve`. No obligation survives into a terminal state;
  the two-branch mutual-leave deadlock does not exist.
- `group.dissolve` has two paths: **last-member** (when the
  materialized membership at the declared position contains exactly
  the author, the author's own signature suffices; a `member.leave`
  by the last member MUST be treated as this path) and
  **collective** (valid under its rule, default `strongest`).
  Dissolution is terminal: no further operations are valid, and
  concurrent operations confer nothing (3.6 class rule 4).
  Capabilities end with the group — the terminal state is the
  exception to the transition requirement, stated as such in 7.1:
  there is no next epoch to transition into. Former members retain
  the last key world as knowledge (7.2's honesty applies);
  services MUST treat a group whose view chain announces
  dissolution as permanently fail-closed. Disposition of documents
  follows the Layer-4 `dataPolicy` declared at attach time.

## 6. Actions and the Implicit Capability

Three actions are defined — **`relay`** (store and forward
ciphertext, no read: the formal name of can't-be-evil
infrastructure), **`read`**, **`write`** — an open set; unknown
actions confer nothing. **There is no `admin` action**: privileged
operations are policy-gated, never capability-gated; collective
authority is not delegable.

Every member holds, by membership alone, the **implicit
capability**: read and write over the whole group, rooted in the
operation that made them a member, ending at the epoch transition
that excludes them (removal, discharged leave, dissolution). In
this version it is the only capability: **grantable, narrowable
capabilities — in particular for non-members — are deferred to
OI-12**, because a capability without a sound exercise mechanism
toward services is a promise this layer could not keep. Nothing in
this document may be read as licensing an ad-hoc grant mechanism;
a group that needs to share content with a non-member today admits
them, or waits for OI-12.

## 7. Epochs

### 7.1 Transitions and the epoch-key lineage

An epoch transition is carried **inside** the operation that
requires it (4.5). Its body section `transition` contains:

- `newEpoch` = epoch + 1;
- `contentKeyCommitment`: digest of the new epoch's content key;
- `keyDist`: the per-retained-member key distribution — an array of
  `{ "recipient": <anchor>, "envelope": <digest of the sealed key
  envelope> }`. The sealed envelope is the Delivery §5 construction
  with HKDF info **`rltp/v1/keydist`** and AAD binding
  `(group, newEpoch, operation id, recipient anchor)`; it carries
  the new content key and epoch secrets, sealed to the recipient's
  current key-agreement key, and travels via `key-delivery` (10.1).
  **Coverage is structural and checked at materialization:** the
  set of `recipient` anchors MUST equal exactly the members
  retained by this transition — no omission, no stranger. (What a
  recipient does with their envelope is delivery state; a recipient
  whose envelope fails to unseal or mismatches
  `contentKeyCommitment` has a re-welcome claim under the welcome
  duty, 5.3.)
- `lineage`: the previous epoch's content key, AEAD-encrypted under
  the new epoch's content key with AAD
  `(group, newEpoch, previous epoch, operation id)`, its ciphertext
  digest committed here. **Present by default.** It is absent only
  where the transition's body additionally carries
  `historyNarrow: true` — an explicit, separately gated narrowing
  act: the applicable rule for `history.narrow` (registered
  default `strongest`) MUST additionally be satisfied by this
  operation's proof. A transition without `lineage` and without an
  authorized `historyNarrow` is invalid. Omission — and nothing
  else — narrows history (Section 8).

The transition envelope MUST NOT contain plaintext secret material
of the new epoch: the log remains readable to members of the old
epoch — including the subject of a removal — so anything they must
not learn travels only inside the per-recipient sealed envelopes.
Members MUST apply transitions in ancestry order; on a gap, buffer
and recover material through the adapter.

**The lineage discharges Membership's MO-6:** a member holding the
current epoch key unlocks the readable history from the replica,
epoch by epoch, exactly as far back as unbroken lineage entries
reach. History never burdens the welcome; nothing can be withheld
from a new member that is not equally withheld from the replica.
Across a narrowed span, a bootstrap yields current-epoch access
plus whatever unbroken lineage reaches, and MUST surface the
narrowed span as such. An adapter MAY realize the lineage invariant
in another form (9.4) — the invariant, not the encoding, is
normative.

**The epoch invariant (grow-only).** Within one epoch of a
continuing group, the authorized set only grows: every operation
that removes or narrows standing authority carries an epoch
transition (4.5); a leave takes authority effect only at its
discharging transition (5.4); the terminal state ends the group
rather than narrowing it (5.4). Normatively: **an operation whose
effect removes or narrows standing authority in a continuing group
without carrying an epoch transition is invalid.** Consequence: a
service view of an epoch is a subset of every later view of the
same epoch — acting on a slightly stale view of the current epoch
never grants what the log revoked (7.3).

### 7.2 What rotation guarantees

Rotation yields **prospective confidentiality** (new-epoch content
is unreadable to non-members of that epoch) and **post-compromise
security** (compromise of pre-rotation material does not extend
into post-rotation epochs). It does not and cannot revoke
knowledge: keys and plaintext already held remain held.
Implementations MUST NOT present removal as erasure.

### 7.3 Authorization views

Services learn a group's authorization state only through
**authorization views** — chained, quorum-signed, position-bound:

```json
{ "v": "rltp-access-view/0.5", "type": "authorization-view",
  "group": "did:key:z6Mk…group",
  "genesisDigest": "…digest of the genesis operation…",
  "seq": 12,
  "epoch": 8,
  "heads": ["oid:…", "oid:…"],
  "identities": ["did:key:…derived…", "…"],
  "terminal": false,
  "prevView": "…digest of the seq-11 view's signature input…",
  "issuedAt": "2026-08-11T12:00:00Z",
  "validUntil": "2026-08-12T12:00:00Z",
  "sigs": [ { "signer": "did:key:…derived…", "sig": "…" } ]
}
```

- **Format and chaining.** The signature input is the JCS
  serialization with `sigs` omitted; `prevView` chains to the
  previous view; `genesisDigest` ties every view to the genesis.
  `seq` increases by exactly 1; `epoch` is non-decreasing; `heads`
  names the log position whose materialization produced the view.
  `identities` is the set of derived service identities of current
  members at that position (5.2) — what the service authorizes
  `relay`/`read`/`write` requests against, by proof of possession
  (a signature over a service-issued challenge). `terminal: true`
  announces dissolution and is irrevocable. `issuedAt`/`validUntil`
  are the quorum's signed freshness claim — the only wall-clock
  statement in this layer, evaluated by the service against its own
  clock within a declared skew bound.
- **Quorum.** Views are signed by `m` distinct identities from
  `identities` of the **previous accepted view** (`m` declared at
  registration, default 1; the genesis `serviceIdentity` seeds
  seq 0). A view whose `identities` changes the quorum set is
  thereby authorized by the outgoing set — quorum change is
  chained, like everything else.
- **Registration (bootstrap).** At first contact a group presents
  `{ group, genesisDigest, m, stalenessBound }` signed by `m` of
  the identities of its seq-0 view, followed by that view. The
  service binds group → genesisDigest → chain (trust-on-first-use
  at the service boundary, Section 12) and persists
  `stalenessBound`.
- **Service obligations** (all five MUST):
  1. **Authenticated:** accept only `seq + 1` with matching
     `prevView`, matching `genesisDigest`, non-decreasing `epoch`,
     and `m` valid quorum signatures. Unauthenticated assertions of
     authorization are never accepted.
  2. **Position-monotone:** an accepted view's `heads` MUST be a
     descendant position of the previous accepted view's (as
     attested by the chain itself); the chain never moves backwards
     — rollback protection.
  3. **Freshness-bounded:** when the newest accepted view's
     `validUntil` lies beyond the skew bound in the past, fail
     closed for epoch-sensitive decisions until a fresh view
     arrives.
  4. **Fail-closed:** on a `seq` gap, a `prevView` mismatch, an
     unknown group, or any inconsistency: rejection, never a
     lookup or a guess.
  5. **Never a winner-picker:** on two individually valid views
     with the same `(group, seq)`, or any divergence from one
     `prevView` — including sibling epochs — enter a persistent
     fail-closed state for the group, durably retaining both
     artifacts as evidence, cleared only by a reconciliation view
     naming both tips in `prevView` (array form), signed by `m` of
     the last commonly accepted view's identities. Responsibility
     for the choice lies in the group's log, attributably — never
     at a service.

- **What this buys, honestly.** The view check is freshness,
  rollback protection, and identity listing by pseudonymous quorum
  — **not** policy enforcement, which lives in the log. A colluding
  quorum can delay or misstate authorization state toward a
  service: within the staleness bound it can keep a removed
  member's identity listed, or omit a member (denial of service).
  It cannot forge operations or obtain keys, and the exposure is
  bounded by the staleness bound the group itself declared. A
  quorum that withholds enforcement operations from its views is a
  misbehaving *member* quorum — attributable inside the group by
  comparing views (signed, chained) against the log. An adapter
  MAY replace the wire format with an equivalent mechanism iff it
  preserves all five obligations and this exposure bound;
  the replacement is part of the adapter registration (9.1).

## 8. Visibility Modes

- Default `private`: reading requires membership (epoch key
  material). The authority log is member-only in every mode (3.1).
- `open`: **document content** from epoch `E` onward is
  world-readable; write remains membership-bound; moderation is
  policy. Mechanically: the content keys from `E` onward are
  published through the group's open content channel — the
  adapter MUST expose attached documents' ciphertext plus the
  published keys to non-members in `open` mode; the authority log,
  the admission evidence, and the membership stay sealed.
- `visibility.change` (atomic transition) constraints: the stated
  `E` MUST equal the transition's `newEpoch` — a visibility change
  can only ever open from its own new epoch onward. Closing takes
  effect from `newEpoch`; what was world-readable remains so
  factually, and implementations MUST NOT suggest otherwise.
- **`history.expose {fromEpoch, keys}`** is the sole way to expose
  anything earlier (default rule `strongest`). It is valid only
  where the materialized visibility at its declared position is
  `open`, with `fromEpoch` earlier than the opening epoch; `keys`
  MUST contain exactly the content keys of the epochs
  `[fromEpoch, E)`, verified against their commitments
  (`contentKeyCommitment` chain) at materialization. Within the
  replica, merging the operation is the disclosure. Toward the
  world, merging it creates an immediate, non-discretionary
  **publication duty**: members MUST publish the disclosed keys
  through the same open content channel as current keys; the log
  entry is the group's attributable record that it did so. No other
  mechanism may publish historical keys.
- Concurrency: as enforcement operations, visibility changes fall
  under 3.6's sibling-epoch rule; a removal and an opening on
  concurrent branches cannot silently combine.

## 9. The Enforcement Port

This layer's constitution (Sections 3–8) is enforced by a
substrate: the machinery that replicates the log, converges
branches, agrees group keys, rotates them, and opens history. The
substrate is bound through a **port** of four requirements. An
**adapter** is a registered binding of one substrate to this port;
a registration names the substrate, its concurrency scope, its
lineage form (9.4), its `material` key schema (9.5), and its
authorization-view mechanism where it replaces 7.3's wire format.

### 9.1 What the port presupposes — and what the adapter is

A substrate is admissible only if it provides: individually signed
operations in a causal DAG; deterministic materialization with a
deterministic concurrency tie-break; idempotent application by
operation id; and transport of this layer's envelope (3.3)
**unmodified** — the envelope stays the sole authority carrier,
and a substrate that re-signs, re-wraps, or re-orders authority
content is not admissible.

**The adapter is trusted computing base, named as such.** An
adapter handles key material; no port requirement can make a
malicious key-handler safe. Therefore, normatively: an adapter
MUST NOT disclose key material, welcome material, lineage
plaintext, or document plaintext to any party other than those
this layer names as entitled (retained members per `keyDist`, the
welcome subject, the world for `open`-mode content and exposed
history) — and the §13 privacy floor is part of the adapter
conformance class (Section 14). These obligations are audit
criteria against an adapter's implementation, not properties a
vector suite can fully establish; the port's contribution is that
the trust boundary is explicit, small, and auditable instead of
diffused through an application.

### 9.2 P1 — Policy injection

The substrate's materialization MUST evaluate this layer's
validity and canonicality rules (3.4, 3.6 including the
suppression cascade, 5.3): an operation this layer rejects MUST
NOT take effect in any replica's materialization, and a replica
ingesting raw substrate state MUST reach the same verdicts as one
fed through any API. A substrate whose materialization cannot be
extended with profile rules — or that enforces them only in a
local wrapper other replicas can bypass — does not satisfy P1.

### 9.3 P2 — Atomic enforcement

An enforcement operation and its epoch transition are **one
committable artifact**: no observable state in which the authority
claim has taken effect but the key world has not transitioned, or
the reverse. Lazy rekeying that leaves a removed member's key
world intact until some later write does not satisfy P2.

### 9.4 P3 — History opening

Invariant: **current-epoch key + replica ⇒ readable history
exactly as far as the log's unbroken lineage reaches** (7.1).
Admissible forms include the native epoch-key lineage (the
per-transition AEAD entry of 7.1) and causal encryption (each
content block carrying predecessor pointers and keys), provided
the narrowing gate of 7.1 (`historyNarrow`, separately authorized)
is representable. Whatever the form: history material MUST live in
the replica, never in the welcome — the welcome carries the
current epoch only and is bounded by Membership's plaintext
budget. A substrate whose only history channel is welcome-time
bulk key transfer does not satisfy P3.

### 9.5 P4 — Key-world production

The adapter MUST produce, at genesis, at each transition, and for
each admission at a given materialized position, the key material
this layer commits to: the epoch content key behind
`contentKeyCommitment`, the sealed `keyDist` envelopes (7.1), and
the welcome `material`:

```json
{ "v": "rltp-access-material/0.5", "adapter": "linear/0.1",
  "epoch": 7, "keys": { …per the adapter registration… } }
```

The binding fields (`v`, `adapter`, `epoch`) are owned by this
layer; `keys` is owned and **closed** by the adapter registration.
Welcome material MUST be re-derivable at any later materialized
position of the same epoch (the welcome duty depends on it, 5.3),
MUST carry the current epoch only, and MUST fit the welcome
plaintext budget (Membership §4). This object is the `material`
Membership §4 carries opaquely; the schema above, plus the
per-adapter `keys` registration, discharges its MO-4. (Membership
0.7's schema prose still calls `material` unpinned and mentions an
implicit-capability blind of the withdrawn 0.3 machinery; its next
casting updates the prose — the wire shape is unchanged.)

### 9.6 Adapter #1: `linear/0.1` (normative)

The reference adapter binds the port to a totally ordered log:
enforcement operations form a single lane (no sibling epochs by
construction — the honest embodiment of 3.6's scope), additive
operations may interleave. It evaluates this layer's rules
natively (P1), commits an enforcement operation and its transition
as one artifact in the total order (P2), records the 7.1 lineage
entries (P3), and produces key material (P4) with the closed
schema:

```json
"keys": {
  "contentKey":  "…base64url, 32 bytes…",
  "epochSecret": "…base64url, 32 bytes…"
}
```

`contentKey` is the epoch's AES-256 content key (its digest is the
epoch's `contentKeyCommitment`); `epochSecret` is the epoch's
HKDF input for adapter-internal derivations. Exactly these two
properties, no others; both REQUIRED. The adapter uses 7.3's view
wire format unchanged. It is intentionally modest: no partition
tolerance for enforcement, which 3.6 requires of every conformant
implementation until OI-1 resolves — the adapter's scope and the
layer's are the same.

### 9.7 Candidate adapters (informative)

Two existing substrates were mapped against this port in design
(2026-08): **p2panda-auth/encryption** satisfies P1 through its
replaceable resolver and P2 through its space-membership commit;
its welcome-time full-secret-bundle history model must relocate to
the replica for P3, and its browser story is open. **Keyhive** is
the P3 exemplar — causal encryption is the cleanest existing form
of the history invariant — but today lacks a policy-injection
point (P1) and performs removal rekeying lazily (P2). Neither is a
conformant adapter today; both port gaps are concrete, scoped
contribution targets, and the port is shaped so that either could
become an adapter without changing this layer.

## 10. Service Ports and the Key-Delivery Task Type

This layer requires, and does not define:

- **Delivery port:** authenticated end-to-end-encrypted delivery
  to derived identities with durable buffering and explicit
  disposition — satisfied by the Delivery Contract 0.17, whose
  task types for this layer are the Membership Tasks 0.7 plus the
  type registered below.
- **Replication port:** convergent replication of the encrypted
  authority log and documents; deterministic merge; offline
  operation; no reachable central service required — satisfied
  through the enforcement adapter (Section 9).

Services themselves are bound by 7.3. No vocabulary of any
concrete service appears in this layer's model beyond the view
object of 7.3; any service satisfying a port contract is
substitutable.

### 10.1 `key-delivery/0.1`

The task type by which epoch key material reaches a specific
party: transition key envelopes to retained members, re-welcomes
to admitted subjects. Registered here; document profile, sealed
envelope, dispositions, and acknowledgement rules per the Delivery
Contract §§3–6.

- `payload`: `keyDelivery` object with:
  - `group` — the group DID;
  - `epoch` — the epoch the material belongs to;
  - `op` — the `oid:` of the operation this delivery serves (the
    transition, or the canonical admission for a re-welcome);
  - `kind` — `"keydist"` or `"re-welcome"`;
  - `sealed` — for `keydist`: the sealed key envelope whose digest
    the transition's `keyDist` names for this recipient (7.1); for
    `re-welcome`: a welcome seal per Membership §4, built from
    fresh P4 material at the sender's current position.
- `proof`: **absent** — for `keydist` the transition operation is
  the authority carrier (the sealed envelope's digest is committed
  there, its AAD binds recipient and operation); for `re-welcome`
  the welcome's binding fields and the canonical admission carry
  it (welcome duty, 5.3).
- **Consistency (MUST, before any effect):** payload schema valid;
  for `keydist`: the recipient's anchor appears in the named
  operation's `keyDist` with exactly this envelope digest; for
  `re-welcome`: the named operation is a canonical admission whose
  subject is the document `recipient`. A violation is
  `failed(validation-failed)`, no acknowledgement.
- **Defined effect:** durable buffering of the material; unsealing
  and application are the recipient's local acts against their
  replica. Idempotent by document digest; a differing document
  carrying material for the same `(op, recipient)` is applied at
  most once per successfully unsealed content.
- **Dependency:** none — key deliveries are self-contained against
  the recipient's replica state; a recipient lacking the named
  operation buffers under the same pending mechanics as Membership
  §3.3 (`incomplete(missing: group-state)`, `bootstrap-retention`).

## 11. Evolvability

- Every wire artifact carries its version (`rltp-access/0.5`,
  `rltp-access-view/0.5`, `rltp-access-material/0.5`,
  `key-delivery/0.1`).
- Extension is additive: new operations (with class, epoch effect,
  default rule, body profile — 4.5), requirement types, actions,
  proof mechanisms, visibility modes, and adapters register new
  identifiers; existing identifiers are never re-interpreted.
- **Degradation direction:** unknown constructs degrade toward
  *less* authority — unknown requirement type → unsatisfiable;
  unknown action → nothing; unknown operation → invalid as proof
  subject; unknown critical field → reject; unknown non-critical
  field → ignore (the transcription schema passes unknown fields;
  3.3). Hard rejection is reserved for cryptographic invalidity
  and `crit` violations.
- Renames only via alias table; key-derivation info strings
  (`rltp/v1/keydist`, `rltp/v1/service-identity/…`,
  `rltp/v1/welcome`) are never renamed. A group MAY pin a minimum
  profile version in policy.

## 12. Security Considerations

- **Fail-closed evaluation.** Authorization defaults to deny. A
  verifier without current materialized state MUST NOT authorize
  privileged operations against a stale one; epoch and
  policyVersion binding make stale proofs invalid rather than
  dangerous, and the suppression cascade (3.6) closes the
  parked-under-a-losing-policy loophole: an operation authorized
  under a policy the merge rejects falls with that policy,
  deterministically and recursively.
- **The log is the perimeter, extended through the port.**
  Everything reduces to operation validity and the deterministic
  merge; implementations MUST NOT introduce side channels of
  authority. P1 (9.2) extends the perimeter through the substrate:
  an adapter that lets raw ingestion bypass profile rules reopens
  exactly the two-plane split this layer exists to close. The
  adapter's confidentiality obligations (9.1) name the remaining
  trust honestly: a malicious adapter implementation can exfiltrate
  keys — the port makes that surface explicit and auditable, it
  does not abolish it.
- **Consent is verifiable by everyone who must judge it.** The
  admitting operation encloses the signed invite and accept (5.3);
  a malicious authorized member cannot make a consentless admission
  canonical; the consumable rule caps one admission per accept —
  causally against replay, deterministically under concurrency —
  and rule 0 caps one canonical admission per subject. Genesis
  claims no one: the founder signs twice, everyone else accepts
  (3.4.1).
- **No admission hostage.** The welcome duty (5.3) detaches
  membership from the goodwill of the admitting member: any member
  can re-produce welcome material (P4 re-derivability) and owes it
  on request. A consumed accept without a delivered welcome is a
  delay, never a permanent exclusion.
- **Honest revocation, honest leave.** 7.2 states exactly what
  rotation buys; UX MUST NOT present removal as retroactive
  erasure. A leave takes authority effect at its discharging
  transition (5.4) — the pending window is stated, surfaced, and
  MUST be minimized (immediate rotation on merge); implementations
  MUST NOT accept new content into the old epoch after observing a
  leave. Claiming instant leave-revocation would be fiction — the
  leaver holds the keys; the design says so instead of pretending.
- **Terminal honesty.** Dissolution (and empty membership) ends
  the group without a next key world; former members keep the last
  epoch as knowledge, services fail closed on the terminal view.
  Nothing retroactive is claimed.
- **Merge remediation windows.** A member admitted concurrently
  with a transition has a keyless window until re-welcome (3.6) —
  an availability gap, never an authority gap; implementations
  MUST discharge the duty eagerly and surface the pending state.
- **Service staleness, bounded and stated.** Within the declared
  staleness bound, a service acts on the current epoch's grow-only
  past — never on a revoked epoch (views are epoch- and
  position-monotone). The residual exposure — a colluding view
  quorum keeping a removed identity listed, or omitting a member —
  is bounded by the staleness bound, is denial or delay rather
  than forgery or key access, and is attributable inside the group
  from the signed view chain. Registration is trust-on-first-use:
  an attacker registering a fake chain first can deny service,
  never read or forge.
- **Lineage is a disclosure surface, gated.** Each lineage entry
  extends what one current key unlocks; that is its purpose.
  Omission is a separately authorized act (`historyNarrow`, 7.1),
  never a transition author's private choice, and never an
  adapter's accident (P3). Narrowed spans are irreversible except
  through `history.expose` — deliberate, logged, carrying its
  disclosure in its body.
- **Deadlock by shrinkage.** Anti-deadlock (4.4) blocks removals
  that would kill the constitution; leaves cannot be blocked, but
  a fully drained group is terminal (5.4), not locked. A group can
  still become constitutionally stuck above emptiness (only leaves
  remain); stated, surfaced, shrink-robust forms are OI-10.
- **Teardown.** Runtime authority (cached views, derived keys,
  open handles) MUST be invalidated on removal and identity
  switch; stale runtime generations must not act.
- **Unique data at removal.** Wiping MUST NOT destroy the only
  copy of data the group is entitled to retain, and MUST NOT
  retain what the removed member is entitled to withdraw; the
  Layer-4 `dataPolicy` governs; the boundary MUST be explicit.
- **Time gates.** The only wall-clock checks in this layer sit at
  the service boundary (7.3), each against a declared skew bound
  consistent with enclosing transport gates. Log validity never
  consults a clock.

## 13. Privacy Considerations

- **Toward services:** a service sees derived pseudonymous
  identities, epoch numbers, view sequence numbers, and opaque
  log-head digests — never main anchors, the membership mapping,
  policy, admission evidence, or the invitation graph. **This is a
  floor on adapters and part of their conformance class:** an
  adapter MUST NOT expose membership, policy, or the invitation
  graph in plaintext to non-members or infrastructure.
  (Informative: both candidate substrates of 9.7 currently sit
  below this floor — plaintext control messages in one, a
  plaintext authorization graph at sync providers in the other;
  the floor is a required contribution, not an aspiration.)
- **Stated residue:** the view's `identities` list reveals to a
  service the **cardinality** of the group and the churn of its
  pseudonym set — the price of removing the commitment machinery
  (OI-12 tracks hiding schemes); view cadence reveals *that*
  authorization changes, not what changed. Both are
  addressee-directed toward a service the group chose.
- **Inside the group:** admissions are individually attributable
  (internal accountability), encrypted to members (external
  invisibility). The permanence cost of admission enclosure —
  both cards, both proofs, forever in the log — is stated in
  Membership §8 and capped by its size budget.
- **Encounter predicates** disclose to the verifying members that
  the subject holds edges to specific members — bounded,
  addressee-directed disclosure; the subject's wider graph stays
  undisclosed (OI-5 minimizes further).
- **Open mode opens content, never the log** (3.1, 8): membership,
  admission evidence, and policy stay sealed in every visibility
  mode. Its retroactive form, `history.expose`, is a separate,
  deliberate, logged act whose body is the disclosure itself.

## 14. Conformance

- **Profile** `rltp-access@0.5`; normatively references
  `rltp-membership@0.7` (document shapes, welcome seal, admission
  transport) and `rltp-delivery@0.17` (document profile, sealed
  envelope, dispositions — also for `key-delivery/0.1`); where
  encounter rules are used, `rltp-encounter@0.19`.
- **Classes:** *member agent* (log, materialization including
  conflict matrix, cascade, and admission rules; policy
  evaluation; transitions; duties; hygiene) · *policy verifier*
  (3.4/Section 4 evaluation only) · *adapter* (Section 9: P1–P4,
  9.1 including confidentiality obligations and the §13 floor) ·
  *service* (7.3 obligations only).
- **Vector plan:**
  - genesis: valid single-founder; `op` ≠ `group.genesis`
    rejected; missing founder countersignature rejected;
    multi-member body rejected; nonzero epoch, second genesis
    rejected; policy satisfiability against one member;
  - envelope: id recomputation; cross-group/cross-epoch/
    cross-position replay rejection; `crit` handling; unknown
    non-critical fields pass the shipped schema and are ignored;
    duplicate-id envelopes → deterministic single survivor;
  - materialization: determinism incl. concurrent folds under the
    byte order; one vector per matrix row; terminal class rule
    (op concurrent with dissolve confers nothing); forked state on
    sibling epochs, fail-closed, surfaced; empty-membership
    terminality; suppression cascade: grant-free scenario — an
    operation validated under a losing same-base `policy.change`
    confers nothing after merge, recursively;
  - admission: rule 0 (subject already member → not canonical);
    each cross-binding of rules 1–4 violated → not canonical;
    causal replay of consumed accept or admitted subject →
    non-canonical outright; concurrent same-subject admissions
    (same and different accepts) → exactly one canonical,
    identical on every replica; displaced candidate's accept
    unconsumed; welcome duty: re-welcome material re-derived at a
    later position unseals and matches commitments;
  - policy algebra: product-space satisfaction sets to depth 4
    incl. the two counterexamples of 4.4; subject-binding: policy
    assigning `encounter` to a subjectless operation rejected;
    `strongest` with meta-rules present (discarded first) and with
    incomparable maxima; satisfiability validation; anti-deadlock
    incl. post-merge reversal;
  - transitions: no-plaintext-secret check; ancestry-order
    application; `keyDist` coverage ≠ retained members → invalid;
    keydist AAD binding (wrong recipient/epoch/op → unseal fails);
    lineage present by default; absent without authorized
    `historyNarrow` → invalid; absent with it → valid, narrowed
    span surfaced; lineage AEAD binding;
  - leave/dissolve: obligated rotation; authority effect at
    discharge (leaver in membership until excluded); last-member
    single-signature dissolve; collective dissolve; concurrent
    leaves → terminal;
  - views (7.3): registration; seq/chain/position monotonicity;
    epoch non-decreasing; gap, staleness, fork fail-closed incl.
    persistence across restart; reconciliation view; quorum change
    signed by outgoing set; terminal view irrevocable; a view
    listing a non-announced identity is detectable against the log
    (member-agent check);
  - key-delivery: keydist digest-match against the named
    transition; re-welcome recipient = admission subject; wrong
    recipient/digest → `failed(validation-failed)`; unknown op →
    pending mechanics; idempotency;
  - port: P1 raw-ingestion equivalence; P2 no observable
    claim-without-transition state; P3 history readable exactly to
    the unbroken-lineage bound; P4 material schema-valid,
    re-derivable, current-epoch-only, within budget; `linear/0.1`
    keys schema closed (extra property → invalid);
  - visibility: `E = newEpoch` constraint; `history.expose`
    key-verification against commitments, open-mode-only validity,
    range check.
- Every normative statement is vector-testable or explicitly
  state-dependent (disposition, duties, teardown, adapter
  confidentiality audit criteria — 9.1), exercised with controlled
  state and clock.

## 15. Open Issues

- **OI-1 Sibling-epoch merge.** Causal epoch DAG with conflict
  keys (the BeeKEM direction) versus deterministic winner plus
  re-rotation. The forked state (3.6) and the view fork handling
  (7.3) are its boundary and hook; the port keeps the resolution
  adapter-shaped.
- **OI-2 Threshold proofs (FROST).** Collapses policy proofs and
  view quorums to single group signatures; DKG/resharing on
  membership change; external indistinguishability.
- **OI-3 Group identifier migration** (legacy UUID spaces →
  genesis DIDs; alias discipline).
- **OI-5 Encounter-presentation minimal disclosure.**
- **OI-7 Member-identity model** (method agnosticism; main DID vs.
  per-group derived member identity with a verifiable Layer-2
  link) — to be settled by the Identity layer casting.
- **OI-10 Shrink-robust policy forms** (relative thresholds;
  recovery from constitutional lock above emptiness).
- **OI-12 Grantable capabilities and their exercise.** Grants,
  attenuation, revocation of grants, non-member read/relay
  exercise toward services, and set-hiding schemes (the withdrawn
  0.3 commitment/token machinery is the ancestor design). Blocked
  on a sound exercise mechanism; nothing in 0.5 licenses an
  interim one.
- **OI-13 The membrane.** Group-issued outward credentials
  (membership credentials, personhood projection) need a closed
  credential profile — body, group-signature mechanism after
  root-key destruction, claims discipline — before the
  `credential.issue` operation returns to the catalog.
- *(Resolved elsewhere: delivery envelope by the Delivery Contract
  0.17; policy-proof transport for richer admission rules and
  leave/dissolve notices are Membership MO-2 and MO-3.)*

## References

[RFC2119] · [RFC8174] BCP 14 · [RFC8785] JCS · [RFC9420] MLS
(epoch terminology) · **RLTP Encounter Layer 0.19** (securing
profile 2.3, credentials §7, evidence direction §4.2) · **RLTP
Delivery Contract 0.17** (document profile §3, sealed envelope §5,
dispositions §6) · **RLTP Membership Tasks 0.7** (document shapes
§3, welcome seal §4, timing §5) · W3C Verifiable Credentials Data
Model 2.0 · Keyhive / BeeKEM design documents (causal encryption;
ePrint 2026/1434) · p2panda-auth documentation (resolver model)
