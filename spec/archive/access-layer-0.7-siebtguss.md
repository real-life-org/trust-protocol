# RLTP Access Layer

**Real Life Trust Protocol — Layer 3: Access**

- **Status:** Editor's Draft
- **Version:** 0.7.0-draft (seventh casting)
- **Editors:** Anton Tranelis
- **Date:** 2026-08-11
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Conformance profile:** `rltp-access@0.7` (draft)
- **Position:** Layer 3 of RLTP, above the Encounter Layer 0.19 and
  the Identity layer, carried by the Delivery Contract 0.17 where
  operations or keys must reach parties outside the replica; the
  Membership Tasks 0.7 register the task types that transport this
  layer's admission documents and are a normative companion.
- **Supersedes:** versions 0.6.0-draft, 0.5.0-draft, and 0.4.0-draft
  (archived as `archive/access-layer-0.6-sechstguss.md`,
  `archive/access-layer-0.5-fuenftguss.md`, and
  `archive/access-layer-0.4-viertguss.md`); version 0.3.0-draft
  (wot-spec `rltp/access-layer.md`, archived there with its
  reviews); on adoption, the group/membership portions of wot-spec
  `03-wot-sync/005-gruppen.md`.

## Abstract

This document specifies the Access layer of the Real Life Trust
Protocol (RLTP): how a **group** of people holds shared authority
over its membership, its data, and itself. Its spine is the
**authority log** — a causally linked DAG of individually signed
operations rooted in a single-founder genesis whose digest **is**
the group's identity. Group state is a deterministic
materialization of this log; **policies** are group-defined
decision rules gating privileged operations; **epochs** are the
enforcement periods that make revocation real — prospectively — in
an end-to-end-encrypted, local-first setting; services follow the
log through chained, quorum-signed **authorization views**.

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
argument, the seventh casting of this layer. It is developed
through the same adversarial convergence process as the Encounter
Layer, the Delivery Contract, and the Membership Tasks (casting,
independent adversarial review, full recast — never a patch). The
fourth casting — the first on the enforcement port — drew 22
blockers; the fifth answered them and drew 12; the sixth answered
those and drew 11, largely precision gaps; this casting answers
them. It has not yet completed its own round. The document will
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
2. **Authority is a log, not a key.** The genesis digest is the
   group's identity; the DID is its address. No key held by anyone
   confers standing authority; the genesis key signs once and may
   be destroyed. Every authorization decision is a deterministic
   reading of signed operations.
3. **Revocation is an epoch, honestly stated.** Removing someone
   cannot un-teach them what they read; it can and must stop them
   prospectively. Every operation that removes or narrows authority
   in a continuing group carries a key-world transition,
   atomically; leaving obligates one; dissolution ends the group
   itself.
4. **Services follow the log.** No service keeps its own registry
   of who belongs; infrastructure learns authorization state
   through chained, quorum-signed views — epoch-monotone,
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
own: `key-delivery/0.1` (10.1), by which transition keys,
re-welcomes, and key repairs travel.

Out of scope by decision, tracked as open issues: capability
grants to non-members and their service-side exercise (OI-12);
group-issued outward credentials (OI-13).

### 1.3 Principles inherited

- **Issuance counts, arrival never** (Encounter 1.3): an
  operation's validity is a function of its signatures and its
  causal position, never of arrival time. No rule in Sections 3–8
  consults a clock.
- **Authenticity has exactly one carrier, one direction**
  (Delivery 1.1, Membership §4): the operation envelope carries its
  signatures and encloses or digest-commits everything it vouches
  for; nothing an operation commits to ever points back at the
  operation's id — that would be an unconstructible hash fixed
  point, and this layer's own key artifacts obey the rule (7.1).
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
multihash over JCS bytes unless a rule names other input bytes;
signatures are Ed25519 under `did:key` anchors unless a registered
profile states otherwise.

**Group** — a collective actor with members, a policy, an
authority log, and documents. Its **identity** is the digest of its
genesis operation; its **address** is its group DID (3.2).
**Authority log** — the append-only operation DAG rooted in the
genesis operation; the sole source of authorization state; its
content is readable by members only, always (3.1). **Operation** —
a signed, causally anchored envelope (3.3). **Materialization** —
the deterministic derivation of group state from the log (3.5,
3.6); an operation is **canonical** when materialization at its
causal position accepts it and no rule of 3.6 suppresses or
displaces it. **Forked state** — the distinguished, fail-closed
materialization outcome produced by sibling epochs (3.6).
**Policy** — group-defined data stating, per rule key, which proof
satisfies the group's decision rule (Section 4). **Epoch** — a
numbered period of the group's key world; enforcement takes effect
as epoch transitions (Section 7); term aligned with MLS [RFC9420].
**Retained members** — the normatively computed recipient set of a
transition's key distribution (7.1). **Pending exit** — the state
of a member whose `member.leave` has merged but whose discharging
transition has not (5.4). **Epoch-key lineage** — the chain of
per-transition entries by which the previous epoch's content key is
readable under the next epoch's key (7.1). **Authorization view** —
the chained, quorum-signed object by which a service learns a
group's epoch and authorized service identities (7.3). **Implicit
capability** — the read/write standing every member holds by
membership alone (Section 6). **Replica boundary** — the set of
parties holding (and entitled to hold) the group's replicated log
at a given materialized state (Membership §2). **Enforcement
substrate** — the machinery satisfying the port of Section 9;
**adapter** — a registered binding of one substrate to that port.
**Key service duty** — the standing obligation of members to
(re)deliver verifiable current-epoch key material to a party the
materialized state entitles to it (5.3, 7.1, 10.1).

| Term | Fragment | | Term | Fragment |
|---|---|---|---|---|
| Group | `#Group` | | Epoch | `#Epoch` |
| Authority log | `#AuthorityLog` | | Epoch-key lineage | `#EpochKeyLineage` |
| Operation | `#Operation` | | Authorization view | `#AuthorizationView` |
| Materialized state | `#MaterializedState` | | Privileged operation | `#PrivilegedOperation` |
| Forked state | `#ForkedState` | | Visibility mode | `#VisibilityMode` |
| Member | `#Member` | | Implicit capability | `#ImplicitCapability` |
| Retained members | `#RetainedMembers` | | Enforcement substrate | `#EnforcementSubstrate` |
| Pending exit | `#PendingExit` | | Adapter | `#Adapter` |
| Policy | `#Policy` | | Key service duty | `#KeyServiceDuty` |
| Policy proof | `#PolicyProof` | | | |

## 3. The Authority Log

### 3.1 One log, one truth

- A group MUST have exactly one authority log. All authorization
  decisions MUST be derived from its materialized state and from
  nothing else — never from document content, replication
  metadata, or service state.
- The log replicates through the substrate (Section 9) as
  encrypted state **readable by members only — in every visibility
  mode**. `open` visibility opens document content, never the
  authority log (Section 8).

### 3.2 Group identity: the genesis digest

- A group's **identity is the multibase multihash digest of its
  genesis operation** — well-defined because the genesis has one
  byte form: its proof set is exactly determined and canonically
  sorted (3.3). Every artifact that binds to a group —
  membership invites (`genesisDigest`, Membership 3.1),
  authorization views (7.3), key deliveries, replica state — is
  keyed by it. The **group DID** in the envelope is the group's
  address: the key that self-certifies the genesis (3.4.1) and then
  retires; the root secret MAY be destroyed.
- Two distinct genesis operations under one DID are therefore not a
  conflict to resolve but **two distinct groups sharing an
  address**. An implementation MUST scope all group state by
  genesis digest; an invitee bootstraps against the digest their
  own invite pinned (Membership 3.3) and can never be steered into
  a sibling genesis. A founder who mints several geneses under one
  DID has founded several groups; no rule of this document lets
  them merge, and nothing any of them does binds another.
- A newcomer verifies a group by: genesis digest → genesis
  validation → operation DAG → materialized state. There is no
  other bootstrap; the log **is** the genesis chain.
- **Genesis is single-founder.** The initial membership is exactly
  one anchor — the founder, who creates the group key, signs the
  genesis with it, and countersigns as themselves. Everyone else,
  co-founders included, joins through the ordinary admission chain
  (5.3). No one can be claimed into a group they never consented
  to: every membership except the founder's rests on a signed
  accept, and the founder's rests on their own countersignature.

### 3.3 The operation envelope

Every operation is one envelope (shown as JSON; JCS is the
canonical serialization):

```json
{
  "v": "rltp-access/0.7",
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
  signature in `proof` is over exactly that same serialization.
  The `id` is therefore bound by every signature, and the envelope
  binds operation type, full content, group, epoch,
  `policyVersion`, and causal predecessors — an operation is not
  valid anywhere else, at any other position, or under any other
  policy.
- **Canonical proof form.** `proof.signatures` MUST be sorted by
  `signer` under unsigned bytewise comparison of the DID string;
  an unsorted proof is invalid. Consequence: an envelope whose
  proof set is fixed by rule — the genesis, with its exactly two
  determined signers — has exactly one byte representation, so the
  genesis digest that names the group (3.2) is stable; nobody can
  mint a second identity for the same group by reordering
  published signatures.
- **One envelope per id.** `proof` is outside the `id`. A replica
  holding several envelopes with the same `id` MUST store and
  propagate exactly one: among those whose proof validates, the
  one whose complete-envelope JCS digest is smallest under the
  byte order of 3.5; envelopes whose proof does not validate are
  not candidates. Application of an operation MUST be idempotent
  by `id`.
- **`prev`:** the op-ids of the DAG heads known to the author at
  authoring time. The genesis operation has `prev: []` and is the
  only such operation.
- **`epoch` / `policyVersion`:** MUST equal the epoch and policy
  version of the state materialized from the operation's
  ancestors. An operation whose ancestors do not produce that pair
  is invalid — this, not wall-clock time, is the replay and race
  gate. (Whether that state survives a merge is 3.6's suppression
  cascade.)
- **No clock in validity:** no rule in Sections 3–8 makes validity
  or epoch effect depend on a verifier's wall clock. Two honest
  verifiers holding the same operations MUST reach the same
  verdict at any time. Wall-clock claims exist only at the service
  boundary (7.3), as signed fields with declared skew bounds.
- **`crit`:** extension fields whose semantics restrict authority.
  A verifier encountering an unknown field listed in `crit` MUST
  reject the envelope; unknown fields not listed in `crit` MUST be
  ignored. The shipped transcription schema accordingly passes
  unknown envelope-level fields through; rejection on unknown
  restrictive content is the `crit` mechanism's job, never the
  schema's. Fields defined in this document are never listed in
  `crit`.

### 3.4 Operation validity

#### 3.4.1 Genesis validation

The genesis operation has no ancestors and is validated by its own
complete procedure. It is valid iff:

1. its envelope parses, `op` is `"group.genesis"`, and its `id`
   recomputes;
2. `prev` is `[]`, `epoch` is `0`, `policyVersion` is `1`;
3. `proof.mechanism` is `signature-set` with exactly two
   signatures over the envelope serialization, **by two distinct
   keys**: one by the key of the DID in `group`
   (self-certification) and one by the founder's anchor (consent —
   no one founds a group over someone else's name). The group DID
   MUST differ from the founder's anchor;
4. its body contains: `members` — exactly one anchor, the founder;
   `card` — the founder's contact card in the displayed form of
   Encounter §6 (proof verifying under its `anchor`, which MUST
   equal the founder; neither `sentTo` nor `boundTo`) — its
   key-agreement key is what later transitions seal the founder's
   key envelopes to, exactly as an accept's card serves admitted
   members; `policy` — structurally valid and satisfiable against
   the founder-only membership per 4.4; `visibility` — the initial
   mode (Section 8); `adapter` — the registered adapter id
   (Section 9); `contentKeyCommitment` — the epoch-0 commitment
   per 7.1's commitment rule, the key produced locally by the
   founder through the adapter (9.5; no distribution exists or is
   needed at genesis); `serviceIdentity` — the founder's derived
   service identity (5.2), seeding the view quorum (7.3);
5. `author` is the founder.

Within one group (one genesis digest), the genesis is by
construction the only operation with empty `prev`; any other
operation with empty `prev` belongs to a different group (3.2).

#### 3.4.2 General validation

A non-genesis operation is valid iff, in order:

1. its envelope parses and its `id` recomputes;
2. all `prev` references resolve to valid operations of the same
   group;
3. with *S* the state materialized from its ancestors: `epoch` and
   `policyVersion` equal those of *S*;
4. its policy proof satisfies the applicable rule (or rules, 4.1)
   of *S*'s policy against *S*'s **policy currency** — the members
   of *S* excluding pending exits (5.4) — except: `member.leave`
   and `service-identity.announce` are self-authorized;
   a leave-discharging `epoch.rotate` (5.4) and the last-member
   `group.dissolve` (5.4) are valid with any single entitled
   signature, non-overridably;
5. its body passes operation-specific validation (Sections 4–8),
   including post-state validation at its declared position
   (anti-deadlock 4.4; retained-set coverage 7.1; no narrowing
   without transition 7.1).

Validity is judged at the operation's declared position. Whether a
valid operation *takes effect* in a merged materialization is
governed by 3.6, including its suppression cascade.

### 3.5 Materialization

- Materialization MUST be deterministic: fold valid operations in
  topological order of the DAG; mutually concurrent operations
  fold in ascending `id` order under **unsigned bytewise
  comparison of the complete `oid:` string's ASCII bytes** — an
  exact total order, no locale, no decoding.
- The fold applies each operation's effect subject to 3.6; a
  suppressed operation remains *valid* but confers no effect in
  that materialization. Canonicality — including terminality
  (5.4) — is a property of the **full materialization at hand**
  and revisable until the DAG is stable: a later-merged concurrent
  branch MAY displace previously materialized effects (or revive a
  group a partial view showed terminal), deterministically and
  identically on every replica holding the same DAG.
- Materialization has three possible outcomes: a group state, the
  **terminal** state (5.4), or the **forked state** (3.6). All
  three are deterministic functions of the DAG.
- **Signals versus canonical state:** operations travelling as
  messages (signals, including trust tasks) MUST NOT change
  materialized state on receipt; they MAY create durable pending
  records and provisional UX only if valid against local state;
  the merged log decides. Signal disposition MUST be a
  deterministic function of `(operation, local state, existing
  pending state)`.

### 3.6 Concurrency: the conflict matrix

Operations divide into **additive** operations (no epoch effect),
**enforcement** operations (they carry an epoch transition, 4.5),
and **terminal** operations (`group.dissolve`, including the
last-member leave — 5.4). Class rules govern merges of concurrent
branches; the matrix fixes the defined pairings; unlisted additive
pairings merge by union. (The design principle behind every rule —
where authority is contested, materialize the lesser authority —
is informative; the rules themselves are exhaustive and explicit.)

**Class rules.**

1. *additive ∥ additive:* both take effect. Set-valued state
   merges by union; a contested scalar field takes the value
   folded last under 3.5's order.
2. *additive ∥ enforcement:* both take effect; where they conflict
   about authority, the enforcement side prevails. The merge
   creates remediation duties (below).
3. *enforcement ∥ enforcement:* sibling epochs. Their merged key
   world is undefined in this version (OI-1); their merged
   **materialization outcome is defined**: the group enters the
   **forked state** — a distinguished, deterministic outcome in
   which no operation building on either sibling is canonical, all
   authorization answers are fail-closed, services holding
   evidence of both siblings hold their own fail-closed state
   (7.3), and the condition MUST be surfaced. The forked state
   ends only by reconciliation (OI-1); until OI-1 is resolved,
   conformant operation is single-partition per group for
   enforcement operations — the linear interim adapter's scope
   (9.6). A malicious authorized member can force the forked
   state; that is denial of service by an insider against their
   own group, fail-closed and attributable, never an authority
   gain.
4. *terminal ∥ enforcement:* forked state (a dissolution carries
   the group's end, an enforcement operation a new epoch; they are
   sibling claims about the key world's future).
   *terminal ∥ additive:* both are judged at their positions; the
   merged state is terminal — except that a `member.add` canonical
   at its position keeps the group alive as stated in 5.4's
   emptiness rule when the terminal outcome arose from emptiness
   rather than from `group.dissolve`. A canonical `group.dissolve`
   always prevails: concurrent additive operations confer nothing.

**Matrix of defined pairings.**

| Concurrent pairing | Merge rule |
|---|---|
| `member.add` ∥ `member.add`, same subject (same or different accepts) | exactly one canonical admission by 5.3's arbitration; the others confer nothing and consume nothing |
| `member.add` ∥ additive op, different subjects | union |
| `member.add` of X ∥ `member.remove` of X | the removal prevails; X is not a member of the merged state; X's accept is not consumed (5.3) |
| `member.add` ∥ epoch transition (any) | the subject is a member of the merged state but lacks post-transition keys → **re-welcome duty** |
| `policy.change` ∥ `policy.change`, same base version | the one folded **first** under 3.5's order takes effect; every other same-base `policy.change` confers nothing and MUST be surfaced for re-proposal |
| `policy.change` ∥ enforcement operation | both valid at their positions; post-merge validation and the suppression cascade apply |
| `member.leave` ∥ epoch transition | the leave merges; it is discharged iff the transition's ancestry contains it (7.1); an undischarged merged leave keeps its obligation |
| `member.leave` ∥ `member.remove`, same subject | the subject is gone either way; the removal's transition governs |
| `member.leave` ∥ `member.leave` (different subjects) | both merge; obligations per 5.4; emptiness per 5.4 |
| `service-identity.announce` ∥ anything additive | union; per-anchor scalar (the announced key) takes the value folded last; first-bound-wins across anchors per 5.2 |

**Post-merge validation.** After folding concurrent branches the
materializer MUST validate the merged state:

- *Anti-deadlock:* if a `policy.change` that took effect renders
  `policy.change` unsatisfiable against the **merged** policy
  currency, it retroactively confers nothing and the prior policy
  stands.
- *Retained-set coverage:* every transition's `keyDist` recipient
  set equals its computed retained set (7.1) — checked at
  validity; re-checked here because merges change nothing about it
  (the retained set is computed at the operation's position, which
  is merge-invariant).

**The suppression cascade.** Validation (3.4.2) judges an
operation against the state its *ancestors* produce. A merge can
render an ancestor ineffective (a losing same-base
`policy.change`, an anti-deadlock reversal). Therefore,
deterministically: after folding, every operation any part of
whose validation (steps 3–5 — policy version equality included,
not proof satisfaction alone) was computed against state
introduced by an operation that confers no effect in the merged
materialization MUST be **fully re-validated** (steps 3–5) against
the state effective at its position in the merged materialization;
if any step fails, the operation confers no effect — and this
re-evaluation cascades to operations whose validation used *its*
effects, recursively, until a fixed point. The cascade only ever
removes effects, never adds them, so it terminates and is
order-independent; the fixed point is a fixed point of the
complete validity function, not of proof-checking alone. An
attacker can therefore not park an operation under a permissive
losing policy — or under its version number — and have it survive
the loss.

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
  `epoch.rotate` where history has been narrowed (7.1), closing
  the displaced welcome's adjacent-epoch exposure forward.

## 4. Policy

### 4.1 The policy object, rule keys, and the defaults

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
- **Rule keys.** A policy maps **rule keys** to rules. Most rule
  keys are operation types; one is an **aspect key**:
  `history.narrow`, evaluated *in addition to* the operation's own
  rule when a transition omits lineage (7.1) — the operation's
  proof MUST satisfy both rules. Registered rule keys and their
  defaults:

| Rule key | Default rule |
|---|---|
| `member.add` | `any-member` |
| `member.remove` | `strongest` |
| `epoch.rotate` | `any-member` (hygiene must stay cheap; the leave discharge additionally bypasses policy, 5.4) |
| `policy.change` | `strongest` |
| `visibility.change` | `strongest` |
| `history.expose` | `strongest` |
| `history.narrow` (aspect) | `strongest` |
| `lineage.repair` | `any-member` |
| `document.attach` | `any-member` |
| `document.detach` | `strongest` |
| `group.dissolve` (collective path) | `strongest` |

  `member.leave` and `service-identity.announce` are
  self-authorized (author's signature; not policy-gated, not
  overridable); the leave-discharging rotation and the last-member
  dissolve are non-overridable single-signature paths (3.4.2,
  5.4). A future registered rule key MUST register its default
  with its definition (Section 11). An operation type with no
  registration is invalid as a proof subject — there is nothing to
  default to.

### 4.2 Requirement types

Four types are defined; the set is open (Section 11); unknown
types are unsatisfiable (degradation direction, Section 11).

- **`any-member`** — one signature of any identity in the policy
  currency (3.4.2); semantically `threshold` with `k: 1`.
- **`actors`** — `{ "type": "actors", "actors": [did…], "k": n }`:
  signatures of `k` distinct listed identities in the policy
  currency. `actors` MUST be non-empty and duplicate-free;
  `1 ≤ k ≤ |actors|`.
- **`threshold`** — `{ "type": "threshold", "k": n }`: signatures
  of `k` distinct identities in the policy currency, `k ≥ 1`,
  evaluated at the operation's declared position.
- **`encounter`** — `{ "type": "encounter", "count": n }`:
  satisfied when the operation's **subject** proves encounter
  edges to `n` distinct identities in the policy currency. An edge
  counts iff the subject presents an encounter credential **issued
  by that member about the subject** (incoming evidence, Encounter
  4.2); grades do not exist at Layer 2 and are not invented here.
  Proof form: `encounter-presentation` (4.3). Verifiers MUST
  evaluate presented credentials only; no registry resolution.
  **Subject-bound:** an encounter rule (also inside a composition)
  is assignable only to rule keys whose operations have a defined
  subject distinct from the proof's signers — in this catalog,
  exactly `member.add`. A `policy.change` introducing an encounter
  rule elsewhere is structurally invalid (4.4).
  *(Minimal-disclosure presentation: OI-5.)*

Rules MAY be composed: `{ "type": "all", "of": [rule…] }` and
`{ "type": "any", "of": [rule…] }` with the obvious semantics;
composition depth MUST NOT exceed 4.

### 4.3 Policy proofs

`proof` carries a `mechanism` and its material. Two mechanisms are
defined; future mechanisms (e.g. a FROST threshold signature,
OI-2) MAY satisfy the same contract.

- **`signature-set`** — `proof.signatures`: signatures over the
  envelope serialization (3.3), each by a signer qualifying under
  the applicable rule at the operation's declared position.
  Verification MUST check signer qualification, signature
  validity, distinctness, and arity.
- **`encounter-presentation`** — `proof.credentials`: one complete
  encounter credential per claimed edge (validated per Encounter
  §7), each issued **by** a distinct member of the declared
  position's policy currency **about** the subject; plus, in
  `proof.signatures`, the subject's signature over the envelope.
  The envelope signature is what binds the presentation to exactly
  this operation — the credentials are immutable evidence and need
  no freshness. Verification MUST check credential validity,
  issuer currency and distinctness, subject binding, count, and
  the subject's envelope signature.

Where a composed rule mixes types, `proof.mechanism` is
`composite` and the object carries both `signatures` and
`credentials`; each component rule is verified against its
material under its own contract.

### 4.4 The policy algebra

**The proof space.** A **proof situation** over an evaluation
state *S* is a pair *(A, P)*: *A* a set of signers, *P* a
presentation — a set of (issuer, credential) edges about the
operation's subject (empty where the operation has none). All
satisfaction sets live in this one product space:

- `Sat(any-member)` = { (A, P) : A contains ≥ 1 of the policy
  currency }
- `Sat(threshold k)` = { (A, P) : A contains ≥ k distinct of the
  policy currency }
- `Sat(actors A₀, k)` = { (A, P) : A contains ≥ k distinct of the
  policy currency listed in A₀ }
- `Sat(encounter n)` = { (A, P) : P proves edges from ≥ n distinct
  of the policy currency, and A contains the subject }
- `Sat(all[…])` = intersection; `Sat(any[…])` = union — ordinary
  set operations, well-defined because every set is a set of
  pairs.

**Strength order.** *R₁ ≥ R₂ iff Sat(R₁, S) ⊆ Sat(R₂, S).*
Verifiers MUST compute the order from satisfaction sets — by
enumeration over the finite signer and edge universe of *S* or a
provably equivalent symbolic procedure. Syntactic shortcuts are
not conformant: they are unsound. Two consequences any conformant
procedure reproduces (and the vector suite tests):
`actors({a,b}, 2) ≥ actors({a}, 1)`, and
`all[actors({a},1), actors({b},1)] ≥ threshold(2)` where a, b are
in the policy currency. For an operation without a subject, every
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
post-operation policy currency — `threshold(k)` requires
`k ≤ |currency|`, `actors(A,k)` requires `|A ∩ currency| ≥ k`,
`encounter(n)` requires `n ≤ |currency|` excluding a candidate
subject. An enforcement operation whose post-state makes
`policy.change` unsatisfiable is invalid (anti-deadlock; the
leave-discharging rotation is exempt — it must never be
blockable, and emptiness is terminal anyway, 5.4); the post-merge
re-check and cascade are in 3.6. If shrinkage renders *other*
rules unsatisfiable, the affected operations are blocked (fail
closed) until the policy is changed — which anti-deadlock keeps
possible. Groups SHOULD prefer `threshold` over `actors` where
shrinkage is expected *(shrink-robust forms: OI-10)*.

### 4.5 Privileged operations (catalog and body profiles)

| Operation | Class | Epoch effect | Body (normative profile; closed) |
|---|---|---|---|
| `group.genesis` | — (root) | creates epoch 0 | 3.4.1: `members`, `card`, `policy`, `visibility`, `adapter`, `contentKeyCommitment`, `serviceIdentity` |
| `member.add` | additive | none | `subject`, `admission` (5.3) |
| `member.remove` | enforcement | **transition, atomic** | `subject` (MUST be a member at the declared position), `transition` (7.1) |
| `member.leave` | additive¹ / terminal² | obligates next transition | empty; the subject is the author (5.4) |
| `epoch.rotate` | enforcement | **transition, atomic** | `transition` |
| `policy.change` | additive | none | `policy` (the complete new object, 4.1) |
| `visibility.change` | enforcement | **transition, atomic** | `mode`, `transition` (Section 8) |
| `history.expose` | additive | none | `fromEpoch`, `keys` (Section 8) |
| `lineage.repair` | additive | none | `epoch`, `opens`, `ct` (7.1: re-publication or gap-bridging of a lineage entry, verifiable against commitments) |
| `document.attach` | additive | none | `document` (identifier), `dataPolicy` (Layer-4 disposition declaration) |
| `document.detach` | enforcement | **transition, atomic** | `document`, `transition` |
| `group.dissolve` | terminal | terminal | empty (two paths, 5.4) |
| `service-identity.announce` | additive | none | `serviceIdentity` (5.2); self-authorized |

¹ `member.leave` cannot carry a transition (the leaver must not
know post-leave keys); it obligates one (5.4).
² a leave at a position of sole membership is the last-member
dissolve — terminal class (5.4).

Every registered operation MUST declare its class, epoch effect,
rule key default (4.1), and closed body profile; the shipped
transcription schema carries the body profiles, closed
(`member.leave` and `group.dissolve` bodies are empty and the
schema enforces emptiness). Operations marked *transition, atomic*
carry the transition **in the same envelope**: claim and ability
change together or not at all — the atomicity the port enforces
(9.3). The class assignment upholds the epoch invariant of 7.1.

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
  `rltp/v1/service-identity/<genesis digest>` — deterministic,
  per-group, re-derivable after total device loss (nothing
  authority-bearing lives only on a device).
- The binding member ↔ derived identity lives **inside the
  encrypted log**: the founder's identity in the genesis body,
  every other member's via `service-identity.announce` — additive,
  self-authorized, body `{ "serviceIdentity": "did:key:…" }`,
  authored by the member it binds. Its author MUST be a member at
  the declared position; a derived identity already bound to a
  different anchor in the operation's ancestry cannot be bound
  again — **first binding wins**, later conflicting announcements
  are not canonical. A member MUST announce before participating
  in the view quorum (7.3); implementations SHOULD announce
  immediately upon admission. Toward services the derived
  identities appear bare; the mapping to anchors never leaves the
  log.

### 5.3 Admission and removal

**Admission is consent-bound.** This section owns, normatively,
the `member.add` body profile and materialization rules that
Membership Tasks 0.7 §3.3 defined and marked for adoption (its
MO-5); the document shapes (invite, accept, welcome seal) remain
defined there.

An admitting `member.add`'s body carries:

- `subject` — the admitted anchor;
- `admission` — the full consent evidence:
  `{ "invite": <complete membership-invite document>,
     "accept": <complete membership-accept document>,
     "welcome": <digest of the welcome plaintext> }`.

Enclosing the complete signed documents — not digests — is what
makes admission verifiable without private knowledge: every
replica holds the evidence, any authorized member can complete an
admission, and invitation provenance is read from the enclosed
invite's signature, never from an assertable field.

**Materialization accepts an admitting `member.add` only if, at
its causal position:**

0. `subject` is **not** a member of the state materialized from
   the operation's ancestors. (Re-admission after a discharged
   exit needs a fresh admission; whether an *older unconsumed*
   accept may serve it is bounded by rule 3 — consent staleness is
   capped by the invite's validity window, and this document says
   so rather than pretending causal ordering against wall-clock
   documents, 12);
1. both enclosed documents validate against their schemas and
   their proofs verify — the invite under `invite.inviter`, the
   accept under `accept.subject`;
2. all cross-bindings hold: `accept.ref` = document digest of the
   enclosed invite; `accept.subject` = `invite.invitee` =
   `body.subject`; `accept.group` = `invite.group` =
   `operation.group` and the invite's `genesisDigest` = this
   group's genesis digest (3.2); `invite.inviter` = the enclosed
   invite's `issuer`; card ownership per Membership 3.1/3.2; the
   enclosed invite's `recipient` = `invite.invitee`; the enclosed
   accept's `recipient` = the enclosed invite's `issuer`; both
   documents share the invite's `threadId`; `invite.validUntil` ≥
   the invite's `issuedAt`;
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
   mutually concurrent admission candidates **of the same
   subject** (whatever their accepts), exactly one is canonical:
   smallest `id` under 3.5's byte order. Only the canonical
   admission consumes its accept; a displaced candidate's accept
   remains unconsumed. Displacement is benign for membership —
   every candidate admits the same subject; the bootstrap effect
   is served by any rule-passing candidate's welcome, and
   arbitration never invalidates a delivered welcome.

A `member.add` failing any of these is not canonical, whatever its
signatures.

**The key service duty (no admission hostage, no key hostage).** A
canonical admission entitles its subject — and every retained
member of a canonical transition (7.1) — to key material that
verifies against the log's commitments, independently of what the
operation's author actually delivered. The claim travels as an
**authenticated key request**: a `key-delivery` document of kind
`request` (10.1) — signed by the claiming anchor, naming the
operation (`oid:`) it claims under, carrying a fresh contact card
in the displayed form (its proof verifying under that same
anchor). On receiving one, a member holding the current epoch keys
MUST first evaluate **entitlement at its own current materialized
state**: the requesting anchor is a member there, and the named
operation is (still) the canonical basis of that membership — a
request from an anchor whose admission has since been overtaken by
a removal or a discharged exit MUST be refused; a former member's
old admission entitles them to nothing now. If entitled: produce
fresh material through the adapter (9.5) at the current position
and deliver it via `key-delivery` (10.1), sealed to the request's
card. The signature gate makes the duty non-triggerable by third
parties; the response duty is once per (requester, operation,
card digest), and helpers SHOULD rate-limit repeated fresh-card
requests to one response per `key-request-interval` (10.1). What
the recipient verifies — and what makes garbage deliveries
harmless — is 10.1's commitment check: material is adopted only if
it verifies against the epoch's `contentKeyCommitment` chain in
the log. Consuming an accept without delivering a usable welcome,
or committing a transition with undecryptable envelopes, therefore
delays key possession; it cannot revoke entitlement — it is
attributable misbehavior of the operation's author, and where an
author's garbage distribution walls off an epoch entirely, the
recovery rotation of 7.1 reopens the group without them (12).

**Removal.** `member.remove`'s body names the subject — who MUST
be a member at the declared position — **and carries the epoch
transition** (7.1). On merging a removal that materialization
accepts as a new canonical transition — never on delivery —
implementations MUST apply removal hygiene: stop write attempts
after durably preserving unsent local work, invalidate runtime
authority immediately (no privileged operation may race a
removal), and SHOULD wipe group key material once the removal is
canonical, subject to the unique-data boundary (Section 12). The
removal notice travelling to the removed member is Membership §3.3
case 2.

### 5.4 Leave, pending exit, and dissolve

- `member.leave` is always valid with exactly the author's own
  signature, independent of policy. **Its authority effect takes
  place at the discharging transition:** the leaver holds the
  epoch keys either way, so this layer does not pretend otherwise.
  Between merge and discharge the leaver is in **pending exit**:
  still a member for key purposes (they can read; they remain
  listed in authorization views until the discharging transition —
  7.3; they appear in no further `keyDist`), but **excluded from
  the policy currency** (3.4.2) — a pending exit can neither
  author nor co-sign privileged operations, count toward
  thresholds, nor invite. The one thing a pending exit (or anyone
  else) can always do is discharge: an `epoch.rotate` whose
  ancestry contains an undischarged leave is valid with any single
  signature of the remaining members, **bypassing the
  `epoch.rotate` policy rule** (non-overridable, like the leave
  itself; it is also exempt from anti-deadlock, 4.4).
  Implementations MUST issue the discharging rotation as soon as
  they merge a leave and MUST surface the pending window
  (prospective-only exposure).
- A leave is **discharged** exactly when a canonical transition
  whose ancestry contains it excludes the leaver (7.1's retained
  set does this by construction). Discharge ends membership.
- **Last-member leave is dissolution — revisably.** A
  `member.leave` at a position whose membership is exactly the
  author is the last-member `group.dissolve` (terminal class; no
  transition exists to discharge it, and none is needed — there
  is no next epoch). Like emptiness, this terminality is a
  verdict of the materialization at hand: if a concurrent
  canonical `member.add` merges, the group is not sole-membered
  after all — the leave reverts to an ordinary leave (pending
  exit; the rotation obligation falls to the merged membership,
  the newcomer included), deterministically and identically on
  every replica.
- **Emptiness is terminal, evaluated on the whole
  materialization.** If the full materialization's membership is
  empty, the state is terminal. A concurrent branch can change
  that verdict: a `member.add` canonical at its position (its
  ancestors still showed a member) keeps the group alive — the
  merged membership is non-empty, the newcomer inherits the open
  duties (their own re-welcome among them, 3.6), and terminality —
  like every canonicality verdict — was revisable until the DAG
  was stable (3.5). A canonical `group.dissolve` is different:
  it is an *operation*, it prevails over concurrent additive
  branches (3.6 class rule 4), and it is not revived.
- `group.dissolve` has two paths: **last-member** (when the
  materialized membership at the declared position contains
  exactly the author, the author's own signature suffices) and
  **collective** (valid under its rule, default `strongest`).
  Dissolution is terminal: no further operations are valid, and
  concurrent operations confer nothing. Capabilities end with the
  group — the terminal state is the exception to the transition
  requirement, stated as such in 7.1: there is no next epoch to
  transition into. Former members retain the last key world as
  knowledge (7.2's honesty applies); services treat a terminal
  view per 7.3. Disposition of documents follows the Layer-4
  `dataPolicy` declared at attach time.

## 6. Actions and the Implicit Capability

Three actions are defined — **`relay`**, **`read`**, **`write`** —
an open set; unknown actions confer nothing. **There is no `admin`
action**: privileged operations are policy-gated, never
capability-gated; collective authority is not delegable.

Every member holds, by membership alone, the **implicit
capability**: read and write over the whole group, rooted in the
operation that made them a member, ending at the epoch transition
that excludes them (discharged leave, removal, dissolution).
Toward services, members exercise read and write under their
derived identities as listed in the authorization views (7.3).
**`relay`** is not a member capability: it is the role of the
group's chosen infrastructure itself — storing and forwarding
ciphertext without reading it (can't-be-evil) — conferred on a
service by the group's registration at that service (7.3) and
ending with the registration.

In this version the implicit capability is the only member
capability: **grantable, narrowable capabilities — in particular
for non-members — are deferred to OI-12**, because a capability
without a sound exercise mechanism toward services is a promise
this layer could not keep. Nothing in this document may be read as
licensing an ad-hoc grant mechanism; a group that needs to share
content with a non-member today admits them, or waits for OI-12.

## 7. Epochs

### 7.1 Transitions and the epoch-key lineage

An epoch transition is carried **inside** the operation that
requires it (4.5). First, its recipient set is defined:

**The retained set** of a transition-carrying operation at its
declared position is computed, not asserted: the members of the
state materialized from the operation's ancestors, **minus** the
operation's `subject` where the operation is a `member.remove`,
**minus** every member whose undischarged `member.leave` lies in
the operation's ancestry. A transition thereby **discharges every
pending leave it causally knows of** — that is the only way
membership shrinks at a rotation, and it is why a rotation can
never be abused to expel anyone else: `keyDist`'s recipient set
MUST equal exactly the computed retained set — no omission, no
stranger, no duplicates — or the operation is invalid.

The body section `transition` contains:

- `newEpoch` = epoch + 1;
- `contentKeyCommitment`: the commitment to the new epoch's
  content key. **Commitment rule (all epochs, genesis included):**
  the multibase multihash over the **raw key bytes** (for
  `linear/0.1`: the 32 content-key bytes), not over any JSON or
  base64url form;
- `keyDist`: the per-retained-member key distribution — an array
  of `{ "recipient": <anchor>, "envelope": <digest of the sealed
  key envelope> }`, one entry per retained member. The sealed
  envelope is the construction of Delivery §5 **with three
  deliberate differences, in the manner in which the welcome seal
  makes its own** (Membership §4): (1) HKDF info
  **`rltp/v1/keydist`**; (2) non-empty AAD — **the UTF-8 bytes of
  the JCS serialization of**
  `{ "genesis": <the group identity string>, "newEpoch": <integer>,
  "recipient": <anchor DID string> }`; (3) the plaintext is not a
  delivery document but the **keydist object**
  `{ "v": "rltp-access-keydist/0.7", "epoch": <newEpoch>,
  "keys": { …per the adapter registration, as in 9.5… } }`,
  JCS-serialized. It is sealed to the recipient's current
  key-agreement key (the card of their accept, the founder's
  genesis card, or the freshest card a key request carried — 5.3)
  and travels via `key-delivery` (10.1). **One carrier, one
  direction:** the operation commits to the envelopes by digest;
  no envelope or its AAD contains the operation `id` — the id
  covers the digests, so a back-pointer would be an
  unconstructible hash fixed point (1.3). Replay across
  operations is idle: a sealed envelope is bound to group, epoch,
  and recipient, and which envelope is *this* transition's is
  exactly what the committed digest says;
- `lineage`: an object `{ "opens": <epoch number>, "ct": … }` —
  the content key of epoch `opens`, AEAD-encrypted under the new
  epoch's content key with AAD = the UTF-8 bytes of the JCS
  serialization of `{ "genesis": <the group identity string>,
  "newEpoch": <integer>, "opens": <integer> }`, **the ciphertext
  embedded** (one key — small; embedding removes any availability
  question). **Present by default, with `opens` = the previous
  epoch.** Two deviations exist:
  - `opens` earlier than the previous epoch is the **recovery
    form**: permitted exactly where the author does not hold the
    keys of the skipped span `(opens, newEpoch−1]` — the honest
    exit from an epoch whose distribution was garbage (a
    **key-void**: only its author could write there, so nothing
    of the group's is lost). The skipped span MUST be surfaced;
    where other members do hold its keys, they bridge it with
    `lineage.repair`, so a *false* void claim narrows nothing
    for long: it is attributable and repairable;
  - absence of `lineage` altogether is the **narrowing act**,
    gated by the aspect rule `history.narrow` (4.1): the
    operation's proof MUST satisfy it in addition to the
    operation's own rule. A transition with neither `lineage` nor
    an authorized `historyNarrow` (nor a registered non-native
    `lineageForm`, 9.4) is invalid.
  Members verify a lineage entry on first decryption (does it
  yield the key matching epoch `opens`'s commitment?); a failing
  entry is attributable misbehavior of the transition's author
  and is repairable by **`lineage.repair`** (additive; rule key
  registered, default `any-member`; any member holding both keys
  publishes body `{ "epoch": <the transition's newEpoch>,
  "opens": <epoch it opens>, "ct": … }` under the same AAD rule;
  verified identically; the first canonical verifying entry per
  `(epoch, opens)` counts).

The transition envelope MUST NOT contain plaintext secret material
of the new epoch: the log remains readable to members of the old
epoch — including the subject of a removal — so anything they must
not learn travels only inside the per-recipient sealed envelopes.
Members MUST apply transitions in ancestry order; on a gap, buffer
and recover material through the adapter or a key request (5.3).

**The lineage discharges Membership's MO-6:** a member holding the
current epoch key unlocks the readable history from the replica,
epoch by epoch, exactly as far back as unbroken lineage entries
reach. History never burdens the welcome; nothing can be withheld
from a new member that is not equally withheld from the replica.
Across a narrowed span, a bootstrap yields current-epoch access
plus whatever unbroken lineage reaches, and MUST surface the
narrowed span as such. An adapter MAY realize the lineage
invariant in another form (9.4) — the invariant, not the encoding,
is normative.

**The epoch invariant (grow-only).** Within one epoch of a
continuing group, the authorized set only grows: every operation
that removes or narrows standing authority carries an epoch
transition (4.5); a leave takes authority effect only at its
discharging transition (5.4; the pending exit's loss of *policy*
standing is not key-world authority and is log-visible to every
verifier); the terminal state ends the group rather than narrowing
it (5.4). Normatively: **an operation whose effect removes or
narrows standing authority in a continuing group without carrying
an epoch transition is invalid.** Consequence: a service view of
an epoch is a subset of every later view of the same epoch —
acting on a slightly stale view of the current epoch never grants
what the log revoked (7.3).

### 7.2 What rotation guarantees

Rotation yields **prospective confidentiality** (new-epoch content
is unreadable to non-members of that epoch) and **post-compromise
security** (compromise of pre-rotation material does not extend
into post-rotation epochs). It does not and cannot revoke
knowledge: keys and plaintext already held remain held.
Implementations MUST NOT present removal as erasure.

### 7.3 Authorization views

Services learn a group's authorization state only through
**authorization views** — chained, quorum-signed, epoch-monotone:

```json
{ "v": "rltp-access-view/0.7", "type": "authorization-view",
  "group": "did:key:z6Mk…group",
  "genesisDigest": "…the group's identity (3.2)…",
  "seq": 12,
  "epoch": 8,
  "identities": ["did:key:…derived…", "…"],
  "m": null,
  "terminal": false,
  "prevView": "…digest of the seq-11 view's signature input…",
  "issuedAt": "2026-08-11T12:00:00Z",
  "validUntil": "2026-08-11T18:00:00Z",
  "sigs": [ { "signer": "did:key:…derived…", "sig": "…" } ]
}
```

- **Format and chaining.** The signature input is the JCS
  serialization with `sigs` omitted; `prevView` chains to the
  previous view; `genesisDigest` names the group (its identity,
  3.2). `seq` increases by exactly 1; `epoch` is non-decreasing.
  `identities` is the set of announced derived service identities
  of the **members** at the view's position (5.2) — pending exits
  included until their discharging transition, so within one
  epoch the set only grows, and read/write standing toward
  services ends exactly where the capability ends (5.4, 7.1). It
  is what the service authorizes `read`/`write` requests against,
  by proof of possession (a signature over a service-issued
  challenge). `m`, when non-null, replaces the quorum size from
  the next view on and MUST satisfy `1 ≤ m ≤ |identities|` of
  this view — a quorum of zero does not exist, and a view
  claiming one is invalid.
  `terminal: true` announces dissolution. `issuedAt`/`validUntil`
  are the quorum's signed freshness claim — the only wall-clock
  statement in this layer, evaluated by the service against its
  own clock within a declared skew bound.
- **Quorum.** Views are signed by `m` distinct identities that
  appear in **both** the previous accepted view's `identities` and
  the new view's `identities` (`m` starts as registered; the
  genesis `serviceIdentity` seeds seq 0, so the registered `m`
  MUST be 1 initially and grow via the `m` field as identities
  accrue). The intersection rule means a quorum can never remove
  itself and hand the chain to nobody in the same step; a view
  that shrinks `identities` below the effective quorum MUST
  simultaneously lower `m`, and a service MUST reject a view
  violating `1 ≤ m_effective ≤ |identities|`. RECOMMENDED: raise
  `m` to ≥ 2 as soon as the group has two announced identities — a
  singleton quorum is a singleton point of misstatement. **Stated
  residual:** a group that legitimately removes its *entire* view
  quorum at once cannot continue any chain those identities
  anchored — the binding at every such service is lost, the group
  re-registers (trust-on-first-use again), and the service fails
  closed in between. Removing in steps, or lowering `m` first,
  avoids this; the spec prefers a stated self-DoS over a
  service-side escape hatch that something other than the chain
  could invoke.
- **Registration (bootstrap).** At first contact a group presents
  `{ group, genesisDigest, m: 1, stalenessBound }` signed by the
  seq-0 identity, followed by the seq-0 view. The service binds
  genesisDigest → chain (trust-on-first-use at the service
  boundary, Section 12) and persists `stalenessBound`. The
  registration is also what confers the **`relay`** role on the
  service itself (Section 6) — the service stores and forwards
  this group's ciphertext; the role ends with deregistration or a
  terminal view.
- **Service obligations** (all five MUST):
  1. **Authenticated:** accept only `seq + 1` with matching
     `prevView`, matching `genesisDigest`, non-decreasing
     `epoch`, valid quorum signatures per the intersection rule,
     `issuedAt ≤ validUntil ≤ issuedAt + stalenessBound`, **and**
     `issuedAt` no further than the declared skew bound past the
     service's own clock — both window ends are checked, so
     neither a year-9999 `validUntil` nor a future-dated
     `issuedAt` extends a view's life. Unauthenticated assertions
     of authorization are never accepted.
  2. **Epoch-monotone — and that is the rollback protection:**
     epochs never decrease across the chain. Within one epoch the
     authorized set only grows (7.1), so replaying an older view
     of the same epoch can only *shrink* what the service accepts
     — denial, never authority; and a view of a superseded epoch
     is rejected by monotonicity. (Log heads are not part of the
     view: a service cannot read the log, so nothing is claimed
     that a service cannot check.)
  3. **Freshness-bounded:** when the newest accepted view's
     `validUntil` lies beyond the skew bound in the past, fail
     closed for epoch-sensitive decisions until a fresh view
     arrives.
  4. **Fail-closed:** on a `seq` gap, a `prevView` mismatch, an
     unknown group, or any inconsistency: rejection, never a
     lookup or a guess.
  5. **Never a winner-picker:** on two individually valid views
     with the same `(genesisDigest, seq)`, or any divergence from
     one `prevView` — including sibling epochs, and including a
     disputed `terminal` — enter a persistent fail-closed state
     for the group, durably retaining the artifacts as evidence,
     cleared only by a **reconciliation view** naming the
     divergent tips in `prevView` (array form), signed by `m` of
     the identities of the last commonly accepted view.
     Responsibility for the choice lies in the group's log,
     attributably — never at a service. A `terminal: true` view is
     itself final only as the chain is: a falsely terminal view is
     a divergence like any other (the group's next honest view
     contradicts it), handled by exactly this rule — a malicious
     quorum member can force the fail-closed state, not a
     permanent grave.

- **What this buys, honestly.** The view check is freshness,
  rollback protection, and identity listing by pseudonymous
  quorum — **not** policy enforcement, which lives in the log. A
  colluding quorum can, within the staleness bound the group
  itself declared: keep a removed identity listed, omit a member
  (denial), or list an identity the log never announced. The last
  is bounded by end-to-end encryption — a listed stranger obtains
  ciphertext access and write standing at the service, never keys
  or plaintext — and all three are **attributable inside the
  group**: views are signed and chained, and any member can
  compare them against the log. `m ≥ 2` (RECOMMENDED above) makes
  every misstatement a conspiracy rather than an accident. An
  adapter MAY replace the wire format with an equivalent mechanism
  iff it preserves all five obligations and this exposure bound;
  the replacement is part of the adapter registration (9.1).

## 8. Visibility Modes

- Default `private`: reading requires membership (epoch key
  material). The authority log is member-only in every mode (3.1).
- `open`: **document content** from epoch `E` onward is
  world-readable; write remains membership-bound; moderation is
  policy. Mechanically: the content keys from `E` onward are
  published through the group's open content channel — the
  adapter MUST expose attached documents' ciphertext plus the
  published keys to non-members in `open` mode; the authority
  log, the admission evidence, and the membership stay sealed.
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
  `[fromEpoch, E)`, verified at materialization against the
  epochs' commitments (7.1's commitment rule makes this a byte
  check). Within the replica, merging the operation is the
  disclosure. Toward the world, merging it creates an immediate,
  non-discretionary **publication duty**: members MUST publish
  the disclosed keys through the same open content channel as
  current keys; the log entry is the group's attributable record
  that it did so. No other mechanism may publish historical keys.
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
lineage form (9.4), its `material` key schema and commitment
encoding (9.5, 7.1), and its authorization-view mechanism where it
replaces 7.3's wire format.

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
this layer names as entitled (retained members per the computed
retained set, admission subjects, the world for `open`-mode
content and exposed history) — and the §13 privacy floor is part
of the adapter conformance class (Section 14). These obligations
are audit criteria against an adapter's implementation, not
properties a vector suite can fully establish; the port's
contribution is that the trust boundary is explicit, small, and
auditable instead of diffused through an application.

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
world intact until some later write does not satisfy P2. (P2
atomizes the *committed* key world; that a malicious author can
commit envelopes only he can't be decrypted is a delivery failure
with a normative repair — the key service duty, 5.3 — not an
atomicity gap: the claim and the committed transition still stand
or fall together.)

### 9.4 P3 — History opening

Invariant: **current-epoch key + replica ⇒ readable history
exactly as far as the log's unbroken lineage reaches** (7.1).
Admissible forms include the native epoch-key lineage (the
embedded per-transition AEAD entry of 7.1) and causal encryption
(each content block carrying predecessor pointers and keys),
provided the narrowing gate of 7.1 (`historyNarrow`, separately
gated by the aspect rule) is representable. A non-native form is
declared per transition by `lineageForm: "<adapter id>"` in place
of the native `lineage` entry — an adapter never fakes a native
field, and the transcription schema admits exactly one of the
three states (`lineage` / `historyNarrow` / `lineageForm`). Whatever the form:
history material MUST live in the replica, never in the welcome —
the welcome carries the current epoch only and is bounded by
Membership's plaintext budget. A substrate whose only history
channel is welcome-time bulk key transfer does not satisfy P3.

### 9.5 P4 — Key-world production

The adapter MUST produce, at genesis, at each transition, and for
each admission or authenticated key request at a given
materialized position, the key material this layer commits to: the
epoch content key behind `contentKeyCommitment` (7.1's commitment
rule), the sealed `keyDist` envelopes (7.1), and the welcome
`material`:

```json
{ "v": "rltp-access-material/0.7", "adapter": "linear/0.1",
  "epoch": 7, "keys": { …per the adapter registration… } }
```

The same `keys` object, under `rltp-access-keydist/0.7`, is the
keydist plaintext of 7.1; both shapes ship as
`schemas/access-material.schema.json`.

The binding fields (`v`, `adapter`, `epoch`) are owned by this
layer; `keys` is owned and **closed** by the adapter registration.
Welcome material MUST be re-derivable at any later materialized
position of the same epoch (the key service duty depends on it,
5.3), MUST carry the current epoch only, and MUST fit the welcome
plaintext budget (Membership §4). This object is the `material`
Membership §4 carries opaquely. **Proposed pin (MO-4):** this
schema plus the per-adapter `keys` registration is proposed as the
`material` pin; adoption happens in Membership's next casting,
which also updates its prose that still reflects the withdrawn 0.3
machinery (an implicit-capability blind no longer exists — the
implicit capability follows from membership itself). Until then
the wire shape is compatible (Membership's `material` is opaque)
and the debt is recorded, not suspended.

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

`contentKey` is the epoch's AES-256 content key — its commitment
is the multihash over its raw 32 bytes (7.1); `epochSecret` is the
epoch's HKDF input for adapter-internal derivations. Exactly these
two properties, no others; both REQUIRED. The adapter uses 7.3's
view wire format unchanged. It is intentionally modest: no
partition tolerance for enforcement, which 3.6 requires of every
conformant implementation until OI-1 resolves — the adapter's
scope and the layer's are the same.

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
- **Publication port** (open visibility only): world-readable
  publication of attached documents' ciphertext and the published
  content keys (Section 8), addressed by the group's genesis
  digest, idempotent per artifact, requiring no reader identity.
  The mechanism is named in the adapter registration; a group
  using `private` visibility never needs this port. Members
  discharge the publication duties of Section 8 through it.

Services themselves are bound by 7.3. No vocabulary of any
concrete service appears in this layer's model beyond the view
object of 7.3; any service satisfying a port contract is
substitutable.

### 10.1 `key-delivery/0.1`

The task type by which epoch key material reaches a specific
party — and by which it is claimed: transition key envelopes to
retained members, welcomes and re-welcomes to admitted subjects,
authenticated key requests under the key service duty. Registered
here; document profile, sealed envelope, dispositions, and
acknowledgement rules per the Delivery Contract §§3–6.

- `payload`: `keyDelivery` object with:
  - `group` — the group DID; `genesisDigest` — the group's
    identity (3.2);
  - `epoch` — the epoch the material belongs to (for `request`:
    the requester's best knowledge, informative);
  - `op` — the `oid:` of the operation this document serves (the
    transition for `keydist`; the canonical admission for
    `re-welcome`; the operation the claim rests on for
    `request`);
  - `kind` — `"keydist"`, `"re-welcome"`, or `"request"`;
  - `sealed` — REQUIRED for the two material kinds, absent for
    `request`; shape per `sealed-envelope.schema.json`: for
    `keydist` the key envelope whose digest the named
    transition's `keyDist` carries for this recipient (7.1's seal
    profile); for `re-welcome` a welcome seal per Membership §4,
    built from fresh P4 material at the sender's current
    position, sealed to the accept's card or to the card of the
    request it answers (5.3);
  - `card` — REQUIRED for `request`, absent otherwise: the
    requester's fresh contact card in the displayed form, its
    proof verifying under the requester's anchor.
- `proof`: for the two material kinds **absent** — authenticity
  is content-bound, one carrier each: for `keydist`, the named
  transition commits this envelope's digest, AAD-bound to group,
  epoch, and recipient; for `re-welcome`, the welcome's binding
  fields tie it to group, subject, and accept, and the **material
  is adopted only if it verifies against the log** (below). For
  `request` the proof is **REQUIRED**, verifying under the
  document `issuer`, which MUST equal the claiming anchor and the
  enclosed card's anchor — the signature gate of the key service
  duty (5.3).
- **Consistency (MUST, before any effect):** payload schema
  valid; `genesisDigest` matches the recipient's state for that
  group (or, for a bootstrapping invitee, their own invite's
  digest); for `keydist`: the recipient's anchor appears in the
  named operation's `keyDist` with exactly this sealed envelope's
  digest, and `epoch` = that transition's `newEpoch`; for
  `re-welcome`: the named operation is a canonical admission
  whose subject is the document `recipient`, and — checked by the
  recipient at adoption — `epoch` = the unsealed material's
  `epoch` = the current epoch of the recipient's materialized (or
  freshly bootstrapped) state, whose `contentKeyCommitment` the
  unsealed content key MUST match; for `request`: proof and card
  as above. A violation is `failed(validation-failed)`, no
  acknowledgement.
- **Effect of `request`:** the receiver evaluates entitlement at
  its current materialized state (5.3) and, where it holds the
  current keys and the requester is entitled, MUST answer with
  the matching material kind. The response duty is **once per
  (requester anchor, `op`, card digest)** — an identical request
  is `duplicate-known`; a request with a fresh card MAY be
  answered again, and receivers SHOULD answer at most one request
  per requester per **`key-request-interval` (default PT1H)**.
  An unentitled request is `failed(validation-failed)`.
- **Defined effect:** durable buffering; unsealing, the commitment
  check above, and application are the recipient's local acts
  against their replica. Idempotent by document digest; material
  for the same `(op, recipient)` is applied at most once per
  successfully verified content.
- **Dependency:** `group-state` — a recipient that cannot yet
  resolve the named operation disposes
  `incomplete(missing: group-state)` under the same pending
  mechanics as Membership §3.3 (keyed by document digest,
  retention `bootstrap-retention`, redelivery idempotent) — except
  the re-welcome answering a bootstrap, which is self-contained
  against the invitee's own accept exactly like the welcome it
  replaces (Membership §3.3 case 1).

## 11. Evolvability

- Every wire artifact carries its version (`rltp-access/0.7`,
  `rltp-access-view/0.7`, `rltp-access-material/0.7`,
  `rltp-access-keydist/0.7`,
  `key-delivery/0.1`).
- Extension is additive: new operations (with class, epoch
  effect, default rule key, closed body profile — 4.5),
  requirement types, actions, proof mechanisms, visibility modes,
  and adapters register new identifiers; existing identifiers are
  never re-interpreted.
- **Degradation direction:** unknown constructs degrade toward
  *less* authority — unknown requirement type → unsatisfiable;
  unknown action → nothing; unknown operation → invalid as proof
  subject; unknown critical field → reject; unknown non-critical
  envelope field → ignore (the transcription schema passes them;
  3.3; operation *bodies* are closed per profile — a new body
  field is a new operation version). Hard rejection is reserved
  for cryptographic invalidity and `crit` violations.
- Renames only via alias table; key-derivation info strings
  (`rltp/v1/keydist`, `rltp/v1/service-identity/…`,
  `rltp/v1/welcome`) are never renamed. A group MAY pin a minimum
  profile version in policy.

## 12. Security Considerations

- **Fail-closed evaluation.** Authorization defaults to deny. A
  verifier without current materialized state MUST NOT authorize
  privileged operations against a stale one; epoch and
  policyVersion binding make stale proofs invalid rather than
  dangerous, and the suppression cascade (3.6) re-runs the *full*
  validation under merged-effective state — an operation cannot
  survive its policy's loss through a coincidentally satisfying
  proof or a matching version number.
- **Identity is the digest.** Group state, invitations, views,
  and key AADs bind the genesis digest (3.2), so a founder
  equivocating geneses under one DID creates parallel groups, not
  parallel truths about one group; nobody can be moved between
  them without failing a digest check they themselves hold.
- **The log is the perimeter, extended through the port.**
  Everything reduces to operation validity and the deterministic
  merge; implementations MUST NOT introduce side channels of
  authority. P1 (9.2) extends the perimeter through the substrate;
  the adapter's confidentiality obligations (9.1) name the
  remaining trust honestly: a malicious adapter implementation can
  exfiltrate keys — the port makes that surface explicit and
  auditable, it does not abolish it.
- **Consent is verifiable by everyone who must judge it.** The
  admitting operation encloses the signed invite and accept
  (5.3); a malicious authorized member cannot make a consentless
  admission canonical; the consumable rule caps one admission per
  accept and rule 0 one canonical admission per subject. Genesis
  claims no one: the founder countersigns, everyone else accepts.
  **Consent staleness is wall-clock-bounded, stated:** an
  unconsumed accept can serve a (re-)admission only within
  `validUntil + membership-skew` of its invite (5.3 rule 3);
  inside that window a re-admission the subject no longer wants is
  possible in principle and is surfaced by the subject's own
  client (it knows its exits) — the bound is the invite validity
  the inviter chose, not a pretended causal order over wall-clock
  documents.
- **No key hostage.** The key service duty (5.3) detaches key
  possession from the goodwill of any single operation author:
  entitlement follows the log, material is re-derivable (P4),
  requests are authenticated (signed by the entitled anchor, fresh
  card enclosed), and adopted material must verify against the
  log's commitments (10.1) — so withheld welcomes, garbage
  envelopes, and broken lineage entries (repairable via
  `lineage.repair`) are delays and attributable misbehavior, never
  revocations. The residual: a group whose *every* member withholds
  keys has factually expelled the victim without an operation —
  visible to the victim, deliberate, and equivalent to the group
  refusing to interact; no protocol makes people cooperate.
- **Honest revocation, honest leave.** 7.2 states exactly what
  rotation buys; UX MUST NOT present removal as retroactive
  erasure. A leave takes key-world effect at its discharging
  transition (5.4); in the pending window the leaver reads (they
  hold keys — pretending otherwise would be fiction) but has no
  policy standing (excluded from currency, quorums, inviting), and
  the discharge is a non-overridable single-signature act that no
  policy can block. Concurrent leaves drain to terminality; a
  falsely "instant" leave semantics was rejected as unsound, not
  as undesirable.
- **Terminal honesty.** Dissolution and drained groups end
  without a next key world; former members keep the last epoch as
  knowledge; services fail closed on a terminal or disputed view
  (7.3). Nothing retroactive is claimed.
- **Merge remediation windows.** A member admitted concurrently
  with a transition has a keyless window until re-welcome (3.6) —
  an availability gap, never an authority gap; implementations
  MUST discharge the duty eagerly and surface the pending state.
- **Service exposure, bounded and stated.** Within the declared
  staleness bound — itself enforced at view acceptance
  (`validUntil ≤ issuedAt + stalenessBound`, 7.3) — a colluding
  view quorum can delay removal effects, deny a member, or list a
  stranger; end-to-end encryption caps the stranger at ciphertext
  and write-spam, epoch monotonicity plus in-epoch grow-only caps
  rollback at denial, and every misstatement is signed, chained,
  and comparable against the log inside the group. `m ≥ 2` turns
  accidents into conspiracies. Registration is trust-on-first-use:
  an attacker registering a fake chain first can deny service,
  never read or forge.
- **Lineage is a disclosure surface, gated.** Each lineage entry
  extends what one current key unlocks; that is its purpose.
  Omission is a separately gated act (`history.narrow` aspect
  rule), never a transition author's private choice, and never an
  adapter's accident (P3). Narrowed spans are irreversible except
  through `history.expose` — deliberate, logged, carrying its
  disclosure in its body, byte-verifiable against the commitment
  chain.
- **Deadlock by shrinkage.** Anti-deadlock (4.4) blocks removals
  that would kill the constitution; leaves cannot be blocked, but
  the discharge path is policy-exempt and a fully drained group
  is terminal (5.4), not locked. A group can still become
  constitutionally stuck above emptiness (only leaves remain);
  stated, surfaced, shrink-robust forms are OI-10.
- **Teardown.** Runtime authority (cached views, derived keys,
  open handles) MUST be invalidated on removal and identity
  switch; stale runtime generations must not act.
- **Unique data at removal.** Wiping MUST NOT destroy the only
  copy of data the group is entitled to retain, and MUST NOT
  retain what the removed member is entitled to withdraw; the
  Layer-4 `dataPolicy` governs; the boundary MUST be explicit.
- **Time gates.** The only wall-clock checks in this layer sit at
  the service boundary (7.3) and in the consent-staleness bound
  (5.3 rule 3, honest-clock), each against a declared skew bound.
  Log validity never consults a clock.

## 13. Privacy Considerations

- **Toward services:** a service sees derived pseudonymous
  identities, epoch numbers, view sequence numbers, and the
  genesis digest — never main anchors, the membership mapping,
  policy, admission evidence, or the invitation graph. **This is
  a floor on adapters and part of their conformance class:** an
  adapter MUST NOT expose membership, policy, or the invitation
  graph in plaintext to non-members or infrastructure.
  (Informative: both candidate substrates of 9.7 currently sit
  below this floor — plaintext control messages in one, a
  plaintext authorization graph at sync providers in the other;
  the floor is a required contribution, not an aspiration.)
- **Stated residue:** the view's `identities` list reveals to a
  service the cardinality and churn of the group's **announced
  service-identity set** — members who have announced, pending
  exits included until discharge; not admitted-but-unannounced
  members, and never the anchor mapping. This is the price of
  removing the commitment machinery (OI-12 tracks hiding
  schemes); view cadence reveals *that* authorization changes,
  not what changed. Both are addressee-directed toward a service
  the group chose.
- **Inside the group:** admissions are individually attributable
  (internal accountability), encrypted to members (external
  invisibility). The permanence cost of admission enclosure —
  both cards, both proofs, forever in the log — is stated in
  Membership §8 and capped by its size budget.
- **Encounter predicates** disclose to the verifying members that
  the subject holds edges to specific members — bounded,
  addressee-directed disclosure; the subject's wider graph stays
  undisclosed (OI-5 minimizes further).
- **Open mode opens content, never the log** (3.1, 8):
  membership, admission evidence, and policy stay sealed in every
  visibility mode. Its retroactive form, `history.expose`, is a
  separate, deliberate, logged act whose body is the disclosure
  itself.

## 14. Conformance

- **Profile** `rltp-access@0.7`; normatively references
  `rltp-membership@0.7` (document shapes, welcome seal, admission
  transport) and `rltp-delivery@0.17` (document profile, sealed
  envelope, dispositions — also for `key-delivery/0.1`); where
  encounter rules are used, `rltp-encounter@0.19`.
- **Classes:** *member agent* (log, materialization including
  conflict matrix, cascade, retained-set computation, and
  admission rules; policy evaluation; transitions; duties;
  hygiene) · *policy verifier* (3.4/Section 4 evaluation only) ·
  *adapter* (Section 9: P1–P4, 9.1 including confidentiality
  obligations and the §13 floor) · *service* (7.3 obligations
  only).
- **Vector plan:**
  - genesis: valid single-founder incl. card; `op` ≠
    `group.genesis`, missing/duplicate-key countersignature,
    group DID = founder anchor, missing card or foreign card
    anchor, multi-member body → each rejected; policy
    satisfiability against one member; commitment = multihash
    over raw key bytes;
  - identity-by-digest: two geneses under one DID → two groups;
    an invitee's bootstrap against their pinned digest rejects
    the sibling; views and key deliveries scope by digest;
  - envelope: id recomputation; cross-group/cross-epoch/
    cross-position replay rejection; `crit` handling; unknown
    envelope fields pass the shipped schema, unknown body fields
    fail the closed profile; duplicate-id envelopes →
    deterministic single survivor;
  - materialization: determinism incl. concurrent folds; one
    vector per matrix row incl. terminal∥enforcement → forked and
    terminal∥additive rules; forked state fail-closed and
    surfaced; emptiness terminal on the full materialization and
    revived by a concurrent canonical add; a canonical dissolve
    not revived; suppression cascade: descendant of a losing
    policy.change with matching version and coincidentally
    satisfying proof → still no effect (full re-validation);
    cascade recursion; anti-deadlock incl. post-merge reversal
    and the discharge exemption;
  - admission: rule 0; each cross-binding of rules 1–4 violated →
    not canonical (incl. genesis-digest binding); causal replay of
    consumed accept or admitted subject → non-canonical outright;
    concurrent same-subject admissions → exactly one canonical,
    identical on every replica; displaced accept unconsumed;
    post-expiry accept rejected (consent-staleness bound);
  - key service duty: authenticated request (signature, fresh
    card) honored; unsigned or third-party request → no duty;
    re-derived material verifies against commitments; garbage
    material fails the 10.1 commitment check and is not adopted;
  - policy: rule keys incl. `history.narrow` aspect (both rules
    evaluated on one proof); product-space order to depth 4 incl.
    the two counterexamples; subject-binding rejection;
    `strongest` meta-resolution; satisfiability against policy
    currency (pending exits excluded); pending exit cannot
    author/co-sign/invite; discharge rotation valid on a single
    signature against a restrictive `epoch.rotate` policy;
  - transitions: retained set computed (remove subject excluded;
    ancestry leaves discharged; rotation cannot exclude others —
    coverage mismatch → invalid; duplicates → invalid);
    no-plaintext-secret check; keydist AAD (genesis digest,
    newEpoch, recipient) — constructibility (no id in AAD) and
    cross-transition replay inertness; lineage embedded,
    verified against the previous commitment, absent only with
    authorized `historyNarrow`; `lineage.repair` accepted when
    verifying, first canonical repair counts;
  - leave/dissolve: pending exit excluded from currency and
    quorums; discharge by ancestry-containing transition;
    last-member leave = terminal; concurrent leaves → terminal;
    `member.remove` of a non-member → invalid;
  - views (7.3): registration; seq/prevView chain; epoch
    monotonicity as rollback protection (older-epoch view
    rejected; same-epoch older view only shrinks); freshness
    window enforced at acceptance (`validUntil` beyond
    `issuedAt + stalenessBound` → rejected); `m` change rule and
    `m ≤ |identities|`; gap/divergence → persistent fail-closed
    across restart; disputed terminal → fail-closed, cleared by
    reconciliation view of the last common quorum;
  - key-delivery: keydist digest+epoch match against the named
    transition; re-welcome recipient = admission subject;
    commitment check gate; genesis-digest binding; unknown op →
    pending mechanics; bootstrap re-welcome self-contained;
    idempotency;
  - port: P1 raw-ingestion equivalence; P2 no observable
    claim-without-transition state; P3 history readable exactly
    to the unbroken-lineage bound; P4 material schema-valid,
    re-derivable, current-epoch-only, within budget;
    `linear/0.1` keys schema closed (extra property → invalid);
  - visibility: `E = newEpoch` constraint; `history.expose`
    byte-verification against commitments, open-mode-only
    validity, range check; publication through the publication
    port idempotent per artifact;
  - *(round-3 additions)* canonical proof form: unsorted
    signatures → invalid; genesis digest byte-stable under any
    proof presentation; digest fields accept `u` and `z`
    encodings; lineage `{opens, ct}`: default opens = previous
    epoch; recovery form with skipped span surfaced; false void
    bridged by `lineage.repair` (registered rule key); AAD bytes
    = JCS of the named objects, cross-implementation seal/unseal
    vectors for keydist and lineage; keydist plaintext =
    `rltp-access-keydist/0.7`; `lineageForm` third state accepted
    for a registered non-native adapter, rejected for the native
    one; views: `m = 0` invalid, signer-intersection rule,
    future-dated `issuedAt` rejected, pending exit still listed
    until discharge; key request: proof + card required, response
    once per (requester, op, card digest), unentitled (removed)
    requester refused at the helper's current state; re-welcome
    epoch equalities; last-member leave revived by a concurrent
    canonical admission.
- Every normative statement is vector-testable or explicitly
  state-dependent (disposition, duties, teardown, adapter
  confidentiality audit criteria — 9.1), exercised with
  controlled state and clock.

## 15. Open Issues

- **OI-1 Sibling-epoch merge.** Causal epoch DAG with conflict
  keys (the BeeKEM direction) versus deterministic winner plus
  re-rotation. The forked state (3.6) and the view divergence
  handling (7.3) are its boundary and hook; the port keeps the
  resolution adapter-shaped.
- **OI-2 Threshold proofs (FROST).** Collapses policy proofs and
  view quorums to single group signatures; DKG/resharing on
  membership change; external indistinguishability.
- **OI-3 Group identifier migration** (legacy UUID spaces →
  genesis digests; alias discipline).
- **OI-5 Encounter-presentation minimal disclosure.**
- **OI-7 Member-identity model** (method agnosticism; main DID
  vs. per-group derived member identity with a verifiable Layer-2
  link) — to be settled by the Identity layer casting.
- **OI-10 Shrink-robust policy forms** (relative thresholds;
  recovery from constitutional lock above emptiness).
- **OI-12 Grantable capabilities and their exercise.** Grants,
  attenuation, revocation of grants, non-member read/relay
  exercise toward services, and identity-set hiding schemes (the
  withdrawn 0.3 commitment/token machinery is the ancestor
  design). Blocked on a sound exercise mechanism; nothing in 0.7
  licenses an interim one.
- **OI-13 The membrane.** Group-issued outward credentials
  (membership credentials, personhood projection) need a closed
  credential profile — body, group-signature mechanism after
  root-key destruction, claims discipline — before a
  `credential.issue` operation returns to the catalog.
- *(Cross-document debts, tracked for Membership 0.8: adopt the
  MO-4 material pin and update its §4/welcome-schema prose — 9.5;
  align its "identified by its group DID" terminology and its
  per-group keying — pending stores, evidence authorization —
  with the genesis-digest identity of 3.2, which its
  `genesisDigest` binding already carries in substance; update
  its Access references from draft 0.3. Until then this layer
  requires of its own implementers: key all group state by
  genesis digest. Resolved elsewhere: delivery envelope by the
  Delivery Contract 0.17; policy-proof transport and
  leave/dissolve notices are Membership MO-2 and MO-3.)*

## References

[RFC2119] · [RFC8174] BCP 14 · [RFC8785] JCS · [RFC9420] MLS
(epoch terminology) · **RLTP Encounter Layer 0.19** (securing
profile 2.3, contact card §6, credentials §7, evidence direction
§4.2) · **RLTP Delivery Contract 0.17** (document profile §3,
sealed envelope §5, dispositions §6) · **RLTP Membership Tasks
0.7** (document shapes §3, welcome seal §4, timing §5) · W3C
Verifiable Credentials Data Model 2.0 · Keyhive / BeeKEM design
documents (causal encryption; ePrint 2026/1434) · p2panda-auth
documentation (resolver model)
