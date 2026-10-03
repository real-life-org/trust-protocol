# RLTP Access Layer

**Real Life Trust Protocol — Layer 3: Access**

- **Status:** Editor's Draft
- **Version:** 0.15.0-draft (fifteenth casting)
- **Editors:** Anton Tranelis
- **Date:** 2026-08-11
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Conformance profile:** `rltp-access@0.15` (draft)
- **Position:** Layer 3 of RLTP, above the Encounter Layer 0.19 and
  the Identity layer, carried by the Delivery Contract 0.17 where
  operations or keys must reach parties outside the replica; the
  Membership Tasks 0.7 register the task types that transport this
  layer's admission documents and are a normative companion.
- **Supersedes:** versions 0.14 through 0.4 (archived as
  `archive/access-layer-0.14-vierzehntguss.md`,
  `archive/access-layer-0.13-dreizehntguss.md`,
  `archive/access-layer-0.12-zwoelftguss.md`,
  `archive/access-layer-0.11-elftguss.md`,
  `archive/access-layer-0.10-zehntguss.md`,
  `archive/access-layer-0.9-neuntguss.md`,
  `archive/access-layer-0.8-achtguss.md`,
  `archive/access-layer-0.7-siebtguss.md`,
  `archive/access-layer-0.6-sechstguss.md`,
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
argument, the fifteenth casting of this layer. It is developed
through the same adversarial convergence process as the Encounter
Layer, the Delivery Contract, and the Membership Tasks (casting,
independent adversarial review, full recast — never a patch). The
fourth casting — the first on the enforcement port — drew 22
blockers; every round since has judged the document clearly
converging but not yet converged. This fifteenth casting answers
round 11 principally by deletion: the capacity machinery that
rounds 9 and 10 grew (displacement, then deferral, then
epoch-bounded lapse) is gone — the group bound is an admission
bound, merged overshoot is tolerated within doubled wire caps,
and whoever was admitted with consent under the rules is simply
a member. It also unifies the proof-merge and validity gates on
one defined eligible-signer set (pending-exit exceptions and
genesis included), gives the discharge a declared unbridged
lineage state so a leave stays undischargeable by no one, makes
the divergence quota a real storage bound with an
uncrowdable reconciliation exit, and gives the service
registration a versioned wire form and schema. It has not yet
completed its own round. The document will
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
- **The log's confidentiality boundary is the replica, never the
  epoch.** Epoch content keys gate *content* (documents, lineage
  plaintext); they never gate the authority operations themselves,
  which every replica holder reads regardless of which epoch keys
  they hold — 7.1 already depends on this (the log stays readable
  to members of the old epoch), and it is what makes a recovery
  rotation out of a key-void epoch constructible: authority state
  is always materializable, only content can be dark (7.1).

### 3.2 Group identity: the genesis digest

- A group's **identity is the multibase multihash digest over its
  genesis operation's signature input** — the JCS serialization
  with `id` empty and `proof` omitted (3.3). These are the same
  hash bytes the genesis `id` encodes in `oid:` form; the identity
  is their multibase multihash encoding, so existing
  `genesisDigest` fields keep their format. Excluding the proof is
  what makes the identity unique: signatures are malleable (one
  signer can produce many valid signature bytes over one message),
  so no proof bytes may enter an identity. Every artifact that
  binds to a group —
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
  "v": "rltp-access/0.15",
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
  an unsorted proof is invalid. (Hygiene, not identity: no
  identity or digest in this layer is ever computed over proof
  bytes — 3.2.)
- **Proof variants merge canonically.** `proof` is outside the
  `id`. Encountering several envelopes with the same `id` and
  different valid proofs (independently collected evidence), a
  replica MUST hold exactly one **merged proof**. The merged
  proof is, normatively, a **pair of sets**: a signature set and
  a credential set. It is built entry-wise, and **entry to the
  merge is position-bounded on both sides**: a signature enters
  only if its signer is one of the operation's **eligible
  signers** (3.4.2) — the members of the state materialized from
  the operation's ancestors, pending exits included, plus the
  operation's `body.subject` where it has one, plus, for the
  genesis only, the group DID key and the founder's anchor. The
  eligible set is a superset of every signer any validity path
  of the operation can count — the policy currency, the
  self-authorized author, every §5.4 pending-exit exception, and
  the genesis pair — while staying Sybil-bounded: membership of
  the ancestor state is not mintable. A credential enters only
  if it is
  admissible per 4.3 — it validates (Encounter §7), its
  `credentialSubject.id` equals the operation's `body.subject`,
  its **issuer is in the ancestor-position policy currency**
  (only rules read credentials, and rules read the currency),
  and
  the operation's rule key can carry an encounter rule at
  all (any other operation admits no credential). Within those
  bounds: per signer, the first valid signature seen; per
  issuer, the first admissible credential seen. Nothing outside
  the bounds ever occupies an entry — a Sybil signer or issuer
  merges nothing however many valid bytes it signs (anchors are
  freely mintable; currency membership is not), and a variant
  cannot poison an issuer's slot with evidence that proves
  nothing about this operation. The bound is also what the
  suppression cascade may rely on: the cascade only ever removes
  effects, so any state effective at the position in a merged
  materialization has a currency that is a subset of the
  ancestor-position currency — the merge retains a superset of
  every signer or issuer any re-validation can ever count. Later arrivals for an
  already-covered signer or issuer are ignored — no replacement
  churn of any kind; entries sorted per the canonical form. A
  merged proof carries no authoritative single `mechanism`: the
  label is derived, in exactly one way everywhere —
  `signature-set` when the credential set is empty;
  `encounter-presentation` when the credential set is non-empty
  and the signer set is exactly the operation's subject;
  `composite` otherwise — and nothing normative reads
  it. **What
  converges — and all that evaluation ever reads — is the signer
  and issuer *sets***: any valid signature is equivalent evidence
  of its signer, any admissible credential of its issuer's edge,
  so replicas whose proof bytes differ still
  reach identical verdicts, and no digest or identity in this
  layer is ever computed over proof bytes (3.2). Because only
  subject-bound credentials enter, the merge
  dominates every variant (superset of each variant's
  currency signers and
  admissible issuer edges — the only entries evaluation ever
  counts) — so whatever any valid variant
  proved, the merge proves; that dominance is what the
  suppression cascade (3.6) needs. And it is bounded
  by one entry per eligible signer and per currency issuer —
  never more than the membership plus one, which the admission
  bound keeps at or near 4096 (5.3) and merged overshoot keeps
  strictly below the doubled wire caps of the shipped schemas
  (8192, 3.6): every canonical merge re-serializes
  schema-conformantly. Application of an operation MUST
  be idempotent by `id`.
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
   of *S* excluding pending exits (5.4) — with a closed exception
   list, identical here and in 5.4: `member.leave`
   and `service-identity.announce` are self-authorized;
   a leave-discharging `epoch.rotate` (5.4) and the last-member
   and drained `group.dissolve` paths (5.4) are valid with any
   single entitled signature, non-overridably; and for exactly
   the three ending-or-repairing operations a pending exit may
   author — the discharge, the drained dissolve, and
   `lineage.repair` (5.4) — the rule evaluates against **the
   members of *S* including pending exits** instead of the
   currency, so the same gate that permits their authorship
   accepts their signatures. (Terminology, used by 3.3's proof
   merge: an operation's **eligible signers** at its position
   are the members of *S* including pending exits, plus its
   `body.subject` where it has one; the genesis, which has no
   ancestors, has exactly the group DID key and the founder's
   anchor — 3.4.1.);
5. its body passes operation-specific validation (Sections 4–8),
   including post-state validation at its declared position
   (anti-deadlock 4.4; retained-set coverage 7.1; no narrowing
   without transition 7.1).

Validity is judged at the operation's declared position. Whether a
valid operation *takes effect* in a merged materialization is
governed by 3.6, including its suppression cascade.

### 3.5 Materialization

- Materialization MUST be deterministic, and its order is a
  defined linearization, not a pairwise rule: **repeatedly, among
  the not-yet-folded operations all of whose ancestors have been
  folded (the ready set), fold the one with the smallest `id`**
  under unsigned bytewise
  comparison of the complete `oid:` string's ASCII bytes — no
  locale, no decoding. This ready-set rule is a total,
  causality-respecting linearization of any DAG (a pairwise
  "concurrent operations in id order" is not: causality between
  A and C plus id comparisons against a third concurrent B can
  demand a cycle; the ready-set rule cannot). "Fold position"
  everywhere in this document means position in exactly this
  linearization.
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
- *Over-capacity tolerance:* admission rule 0's group bound
  (5.3) is
  position-local and therefore not merge-stable on its own: two
  admissions of different subjects, each valid at 4095 members,
  union to 4097. This document does **not** repair that with an
  arbitration — capacity is not a who-question, and every
  machinery that makes it one (displacement, a queue, a lapse)
  hands an envelope-grinding rival influence over *who* belongs,
  a policy-grade outcome no tie-break may carry, or takes back
  admissions whose welcomes were already conformantly delivered.
  Instead: **everyone admitted with consent under the rules at a
  valid position is a member.** A merged materialization MAY
  therefore transiently exceed the 4096 admission bound; while
  it does, rule 0 freezes all further admissions (every position
  shows ≥ 4096 members), and departures shrink the group back
  under the bound. The wire caps of the shipped schemas are
  sized at **8192 — twice the admission bound** — as
  denial-of-service ceilings, not group bounds, so
  membership-scaled artifacts (proofs, `keyDist`, view
  identities) stay schema-valid under any overshoot short of the
  pathological. The pathological remainder is stated, not
  defined away: a merge whose membership exceeded even the
  doubled caps could not build those artifacts — the affected
  operations fail closed until the group shrinks (OI-14). No
  ordering, no queue, no grinding surface: there is nothing left
  to order.

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

**Evaluation reads sets, never labels.** A proof's material is
two sets — the **signer set** (from `proof.signatures`, each
signature over the envelope serialization, 3.3) and the
**admissible credential set** (from `proof.credentials`) — and
rule satisfaction is a function of these sets alone (4.4's proof
space is exactly this pair). A credential is **admissible** iff
it validates per Encounter §7 **and** its `credentialSubject.id`
(Encounter §7.2) equals the operation's `body.subject` **and**
the operation's rule key can carry an encounter rule at all
(4.2's subject binding — in this catalog exactly `member.add`;
a `member.remove` also has a `body.subject`, but its rules can
never contain an encounter rule, so no credential is admissible
on it). Inadmissible credentials are ignored for satisfaction
and never merge (3.3). The component checks per rule type:

- for signature components: signer qualification under the
  applicable rule at the operation's declared position,
  signature validity, distinctness, arity;
- for encounter components: admissibility as above, issuer
  currency and distinctness, count — plus the **subject's own
  signature over the envelope** in the signer set, which is what
  binds the immutable credentials to exactly this operation (no
  freshness is claimed or needed).

**`mechanism` is a shape descriptor, not an input.** On the wire
each envelope's proof declares the shape it carries —
`signature-set` (signatures only), `encounter-presentation`
(credentials plus the subject's envelope signature), `composite`
(both, for composed rules) — and the shipped schema checks
shape-consistency (a `signature-set` proof carries no
`credentials`). No verification step branches on the label; a
proof whose *sets* satisfy the applicable rule satisfies it
under any consistent label. A replica's **merged proof** (3.3)
is exactly the pair of sets; when re-serializing an envelope for
transport, the replica emits the merged material under the
derived label of 3.3 (one derivation, everywhere) — always
schema-consistent by construction. Future mechanisms (e.g. a
FROST threshold signature, OI-2) register new shape descriptors
satisfying the same contract: material in, sets out.

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
| `group.dissolve` | terminal | terminal | empty (three paths, 5.4) |
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
  immediately upon admission. **A replacement announcement (a
  member changing their own identity) takes effect at the first
  canonical epoch transition whose ancestry contains it, never
  within the running epoch** — the ancestry binding makes the
  effective set deterministic under concurrency (a transition
  merged concurrently with the announcement does not carry it;
  the next one does), the view identity set of one epoch stays
  strictly grow-only (7.3), and an identity rotation after key
  compromise rides the `epoch.rotate` that such a compromise
  warrants anyway. Toward
  services the derived identities appear bare; the mapping to
  anchors never leaves the log.

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
   the operation's ancestors, and the resulting membership does
   not exceed **4096 members — this profile's registered group
   bound** (the wire caps of every membership-scaled artifact:
   proofs, `keyDist`, view identities; larger groups need a
   future profile — OI-14). This check is position-local; a
   *merged* materialization tolerates a transient overshoot
   under 3.6's over-capacity rule — everyone admitted at a valid
   position is a member, further admissions freeze until the
   group shrinks below the bound. (Re-admission after a discharged
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
canonical admission entitles its subject — and
every retained
member of a canonical transition (7.1) — to key material that
verifies against the log's commitments, independently of what the
operation's author actually delivered. The claim travels as an
**authenticated key request**: a `key-delivery` document of kind
`request` (10.1) — signed by the claiming anchor, naming the
operation (`oid:`) it claims under, carrying a contact card in
the displayed form whose proof verifies under that same anchor (a
seal needs a *live* key, not a fresh one — Membership §2's rule;
no freshness is claimed or needed). The requester MAY address any
member whose card it holds — the enclosed cards of the log's
admissions are address material, and members MUST retain the
key-agreement private key of their enclosed admission card (the
founder: the genesis card) for as long as they are members. On
receiving a request, a member holding the current epoch keys MUST
first evaluate **entitlement at its own current materialized
state**: the requesting anchor is a member there, and the named
operation is (still) the canonical basis of that membership — a
request from an anchor whose admission has since been overtaken by
a removal or a discharged exit MUST be refused; a former member's
old admission entitles them to nothing now. If entitled: produce
fresh material through the adapter (9.5) at the current position
and answer with the matching kind (10.1): `re-welcome` toward a
not-yet-bootstrapped admission subject, **`refresh`** toward any
current member — the founder included — whose transition envelope
failed or vanished, both sealed to the request's card. The
signature gate makes the duty non-triggerable by third parties;
the response duty is once per (requester, operation, card digest,
**answered epoch**) — exactly 10.1's key, so a rotation renews
the duty — and helpers SHOULD rate-limit repeated new-card
requests to one response per group and requester per
`key-request-interval` (10.1). What
the recipient verifies — and what makes garbage deliveries
harmless — is 10.1's commitment check: material is adopted only if
it verifies against the epoch's `contentKeyCommitment` chain in
the log. Consuming an accept without delivering a usable welcome,
or committing a transition with undecryptable envelopes, therefore
delays key possession; it cannot revoke entitlement — it is
attributable misbehavior of the operation's author, and where an
author's garbage distribution walls off an epoch entirely, the
recovery rotation of 7.1 reopens the group without them —
**in a fork-free log**: an insider who additionally mints a
sibling transition forces the forked state (3.6), which is
fail-closed and attributable, never an authority gain — but exit
from it awaits OI-1's reconciliation, and this document says so
rather than promising otherwise (12, OI-1). The duty has one
proactive arm: a member holding both keys of a skipped or
failing lineage step MUST publish the `lineage.repair` entry
upon materializing the defect (7.1) — repair is owed to the
group, not merely available to it.

**Removal.** `member.remove`'s body names the subject — who MUST
be a member at the declared position — **and carries the epoch
transition** (7.1). On merging a removal that materialization
accepts as a new canonical transition — never on delivery —
implementations MUST apply removal hygiene: stop write attempts
after durably preserving unsent local work, invalidate runtime
authority immediately (no privileged operation may race a
removal), and SHOULD wipe group key material once the removal is
canonical, subject to the unique-data boundary (Section 12).
**Replica eviction is part of the same enforcement boundary — for
every way membership ends, with local responsibility:** each
replica's adapter MUST apply eviction no later than **its own
canonical application** of the membership-ending operation — the
removal transition, the leave-discharging transition, or the
terminal state (where replication of the group ends for all
peers; local holdings follow the Layer-4 `dataPolicy`). Where the
substrate itself commits the operation, eviction is part of that
commit (9.3); where a replica merges a remotely authored one, the
duty binds at the merge — no replica can act on a commit it has
not yet seen, and none may forward to the evicted peer after it
has. Authority operations after that commit MUST NOT be
replicated to them. And so that a lagging replica cannot leak
around its own lag: **commit-before-forward** — a replica MUST
NOT forward an operation it has not itself canonically applied.
Application is ancestor-first (7.1), so a batch containing a
removal and its descendants is materialized — eviction included —
before any of those descendants moves on; the window in which a
replica still serves the removed peer by its old state can
therefore never carry operations that causally postdate the
removal. "A member's peers" are the replication
endpoints authenticated by that member's identities — anchor and
derived identities; the device-to-anchor binding underneath is
Identity-layer property (§15). What was replicated before remains
held — knowledge honesty, 7.2 — but "member-only in every mode"
(3.1) is thereby a port obligation, not a hope. The removal notice travelling to the
removed member is Membership §3.3 case 2.

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
  thresholds, nor invite. Exactly three acts remain open to a
  pending exit, each because it ends or repairs rather than
  exercises authority: the discharge, the drained dissolve
  (both this section), and **`lineage.repair`** (7.1 — its
  entries are byte-verifiable against the commitment chain, so
  authoring one asserts nothing; without this exception the
  repair duty could bind a key holder the currency exclusion
  forbids to act, a MUST against a MUST NOT). The discharge: an
  `epoch.rotate` whose
  ancestry contains an undischarged leave is valid with a single
  signature of **any member of the state at its declared
  position — pending exits included** (this is the one privileged
  operation a pending exit may author or sign), **bypassing the
  `epoch.rotate` policy rule** (non-overridable, like the leave
  itself; it is also exempt from anti-deadlock, 4.4). This holds
  in a key-void too: the discharge out of a void uses the
  recovery form of the lineage (7.1), which is a bridge, not a
  narrowing, and needs no further gate — and a discharger who
  holds no prior epoch key at all (admitted into the void,
  nothing to bridge with) declares `lineageVoid` (7.1), equally
  ungated — **a leave can never be
  blocked, by anyone, in any key-world state, by any
  key-possession shape.**
  Implementations MUST issue the discharging rotation
  as soon as they merge a leave and MUST surface the pending
  window (prospective-only exposure).
- **The drain rule.** A group in which **every member is a
  pending exit** has nobody left to rotate
  *for*: no next key world exists to transition into, so the
  ending is not a rotation at all — it is the **drained path of
  `group.dissolve`** (5.4 below): terminal class, empty body, no
  transition, valid with a single signature of **one of the
  pending exits themselves** (the one operation class a pending
  exit may author; it ends the pending state rather than
  exercising authority within it). The condition is exact: one
  member who has *not* left needs no shortcut — their discharge
  rotation retains a non-empty set ({themselves} at least), after
  which the ordinary last-member paths stand open — so the
  drained path never hands an active member single-signature
  terminal power over a collective rule.
  Concurrent leaves therefore drain to termination through one
  ordinary terminal operation by any of the leavers. And one
  honest boundary instead of a false equivalence: if every
  member leaves and then no one ever authors that operation, the
  group is **dormant, not terminal** — all members are pending
  exits, no authoritative change can occur except a finalization
  any of them
  can sign at any time (verifiable `lineage.repair` entries
  remain possible — they repair, they do not decide); nothing is
  blocked, something is simply
  unfinished, and implementations MUST surface the all-pending
  state as exactly that.
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
- `group.dissolve` has three paths: **last-member** (when the
  materialized membership at the declared position contains
  exactly the author, the author's own signature suffices),
  **drained** (when every member of the declared position is a
  pending exit and the author is one of them, a single signature
  suffices, non-overridably — the drain rule above), and
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
stranger, no duplicates — or the operation is invalid. A
transition whose computed retained set is **empty** is invalid
outright: there is no next member to hold a next key world, and
the defined ending for that situation is the drained dissolve
path (5.4), not a rotation into nobody.

The body section `transition` contains:

- `newEpoch` = epoch + 1;
- `contentKeyCommitment`: the commitment to the new epoch's
  content key. **Commitment rule (all epochs, genesis included):**
  the multibase multihash over the **raw key bytes** (for
  `linear/0.1`: the 32 content-key bytes), not over any JSON or
  base64url form. **Freshness rule:** the new content key MUST be
  freshly generated by a cryptographically secure random source,
  independent of and distinct from every prior epoch key of the
  group — and the log enforces the checkable core of that: **a
  transition whose `contentKeyCommitment` equals any earlier
  epoch's commitment in the same group is invalid.** Without
  this, a rotator could re-commit the old key and rotation would
  revoke nothing (7.2's guarantees rest here); fresh generation
  beyond the equality check is a P4 audit criterion (9.5);
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
  `{ "v": "rltp-access-keydist/0.15", "adapter": "<registered id>",
  "epoch": <newEpoch>,
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
    form** — the exit from an epoch whose key distribution was
    garbage (a **key-void**: no member beyond its author ever
    received a usable key there). `opens` names the most recent
    epoch whose content key the rotating author holds; `ct` is
    that key, so the bridge is only constructible by someone who
    actually holds it. **The recovery form is a bridge, not a
    narrowing act, and is therefore gated only by the
    operation's own rule.** The reasoning rests on one honest
    theorem, stated here once for every lineage form:
    **reachable history across a lineage step is exactly as
    durable as the set of members holding that step's keys.** A
    lineage entry — original, bridging, or repairing — is
    constructible only by a key holder; no rule can conjure a
    key nobody entitled still has. The claim about the recovery
    form is deliberately one-directional: **a declared skip
    grants no darkening power that the default form does not
    already grant** — whatever a skip closes, a garbage `ct` in
    a default-form transition closes for exactly the same key
    holders to repair. The forms are not identical (a skip is
    visible to every log reader at once, a garbage `ct` only to
    a key recipient on first decryption; a valid bridge proves
    possession of the `opens` key, garbage proves nothing) — the
    skip is the *more* honest wire form, public and surfaced,
    and — unlike `historyNarrow`
    below, which is the *authorized*, duty-free closure — it is
    never a legitimization. Therefore, normatively: a skipped
    span — the epochs `(opens, newEpoch−1]` — MUST be surfaced,
    as skipped and, once repaired, as repaired; **repairing it
    is a duty, not an option** — a member holding both keys of a
    skipped or failing lineage step MUST publish the
    `lineage.repair` entry (additive, default `any-member`,
    byte-verifiable against the commitment chain) upon
    materializing the skip, as part of the key service duty
    (5.3). The duty binds conformant implementations; its breach
    is not always provable from outside (non-publication proves
    neither possession nor malice — a holder may be gone), so
    the duty is an obligation, not a guarantee. And the residual
    is stated rather than argued away:
    where no member holds both keys of a step — every holder of
    the span key removed, departed, or withholding — that span's
    content is factually dark, under this form and every other.
    That loss is real: content a member wrote in such an epoch
    was group content in the replica, and it is what darkness
    costs. This is the same honesty class as the
    all-members-withhold-keys residual of Section 12;
    authority state in the span was never dark (3.1) — at most
    content is, and at most until repaired;
  - absence of `lineage` altogether is the **narrowing act**,
    gated by the aspect rule `history.narrow` (4.1): the
    operation's proof MUST satisfy it in addition to the
    operation's own rule;
  - **`lineageVoid: true`** is the fourth state, valid **only on
    a leave-discharging `epoch.rotate`** (5.4): the discharger
    declares that they hold no prior epoch key at all — a member
    admitted into a key-void has exactly nothing to bridge
    *with*, and the discharge must never be blockable (5.4), not
    even by its author's own keylessness. It is not a
    legitimized narrowing (`history.narrow` does not gate it and
    does not excuse it): the unbridged step is surfaced as
    damage, it stands under the repair duty of every member who
    does hold the keys, and the durability theorem above says
    honestly what happens if none remains. A discharge with
    `lineageVoid` where the author verifiably could bridge is
    attributable misbehavior with a repairable effect — the same
    class as a garbage `ct`.
    A transition with none of `lineage`,
    an authorized `historyNarrow`, a registered non-native
    `lineageForm` (9.4), or — on a discharge only —
    `lineageVoid` is invalid.
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
{ "v": "rltp-access-view/0.15", "type": "authorization-view",
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
  that would shrink `identities` below the chained quorum
  requirement is unacceptable — the group lowers `m` in a
  **preceding** view first (`m` timing, below) — and a service
  MUST reject a view violating
  `1 ≤ m_effective ≤ |identities|`. RECOMMENDED: raise
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
- **Registration (bootstrap).** At first contact a group
  presents a **registration** — a versioned wire artifact
  (`schemas/access-registration.schema.json`):
  `{ "v": "rltp-access-registration/0.15",
  "type": "service-registration", "group", "genesisDigest",
  "m": 1, "stalenessBound", "terminalRetention",
  "divergenceQuota", "sig" }` — durations as ISO-8601, the
  quota an integer in **[16, 4096]**, the signature by the
  seq-0 identity over the JCS serialization with `sig` omitted
  (a value outside its range, a missing field, or a failing
  signature makes the registration invalid: two services never
  parse one registration into two behaviors). It is followed by
  the seq-0 view — which is accepted
  iff its `seq` is 0, its `prevView` is null (the only view where
  it may be), and it is signed by the registration's identity;
  from seq 1 on the ordinary quorum rule applies with `m` as
  chained. The service binds genesisDigest → chain
  (trust-on-first-use at the service boundary, Section 12) and
  persists `stalenessBound`, `terminalRetention` (the terminal
  grace window of obligation 5; RECOMMENDED default `P30D`), and
  `divergenceQuota` (the full-artifact evidence bound of
  obligation 5; RECOMMENDED default 64). **`m` timing, exactly:** the quorum
  size that view *n* must satisfy is the latest non-null `m`
  declared at view *n−1* or earlier; a view that shrinks
  `identities` below that requirement cannot repair itself — the
  group lowers `m` in a preceding view first. The
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
     for the group, durably retaining the artifacts as evidence.
     While fail-closed the service holds **the DAG of every view
     it has accepted or retained** (each view names its parents:
     `prevView`, singular or array), and it MUST go on admitting
     valid views into that DAG — an ordinary view whose parent is
     held, a divergent view opening a new branch, a
     reconciliation view joining branches — bounded by the
     registered `divergenceQuota`. The quota's unit is defined:
     it counts **retained full view artifacts** for the group.
     Ancestry and maximality questions (tip derivation, the
     `predecessor` check) do not need full artifacts: the
     service MUST retain the **digest skeleton** — per view its
     signature-input digest, its parent digests, and its `seq`,
     a few hundred bytes per node — back to its last single-tip
     state, and MAY drop a full artifact to skeleton once the
     view is no longer a tip. Full-artifact storage is thereby
     quota-bounded while every check this section requires stays
     computable. At the quota the service is
     **evidence-saturated**: it MUST reject further *divergent*
     views (retriable, like any rejection here) but MUST still
     accept a valid reconciliation — and because a flood may
     have crowded out exactly the views a reconciliation needs,
     saturation acceptance is defined over the **reconciliation
     bundle**: the reconciliation view together with any of its
     named parents the service no longer or never held,
     presented in one exchange; the service verifies the bundle
     (each parent against the skeleton where it has one — a
     digest match readmits evidence it once held; a
     never-seen parent joins as evidence), accepts it as a
     whole, and lets the tips re-derive — a transient overshoot
     of at most the parent cap (8), immediately reclaimed as the
     reconciliation covers its parents. The exit is thereby
     independent of what the flood's arrival order left
     standing.
     The quota bounds what an insider quorum's view spam can
     cost a service (a single legitimate `m = 1` signer could
     otherwise mint unbounded valid siblings and conformance
     would mean unbounded storage); what such spam still buys is
     the fail-closed state this obligation already grants any
     misbehaving quorum, now at bounded cost — and `m ≥ 2`
     (RECOMMENDED above) makes it a conspiracy. **The divergence tips are not a stateful
     register but a derived quantity: the maximal elements of the
     held DAG** — every held view that is not an ancestor of
     another held view. Deriving the tips from the DAG is what
     makes the machine convergent: DAG union is commutative, so
     two services holding the same views hold the same tips,
     whatever order the views arrived in — crossing
     reconciliations included (two reconciliations sharing a
     named parent leave both standing as tips; the shared parent
     is an ancestor of each and simply stops being maximal). The
     state is cleared only by **reconciliation
     views**. A reconciliation view (a) names two or more
     divergent views in `prevView` (array form); (b) names, in a
     `predecessor` field, the digest of one accepted view that is
     an ancestor of every named parent and whose `seq` is maximal
     among such common ancestors — the choice among several
     qualifying ancestors (possible once reconciliation views
     with multiple parents enter the ancestry) is the issuing
     quorum's, made in the open and covered by its signatures,
     not derived by a verifier (a covert tie-break over malleable
     fields would be grindable; an overt choice among
     quorum-accepted ancestors stays within the exposure this
     section already states); (c) carries `seq` = 1 + the maximum
     `seq` over the **named** parents and `epoch` ≥ the maximum
     epoch over the **named** parents — named, not locally
     current: every requirement is a function of what the view
     itself names, so its acceptability does not depend on which
     tips a particular service happens to hold; (d) is signed by
     `m` of
     the `predecessor` view's identities intersected with the
     reconciliation view's own `identities`; and (e) is accepted
     iff the service holds every named parent **somewhere in its
     DAG** — as a tip or as an ancestor, no distinction — on a
     named parent it does not hold, rejection as always
     (fail-closed, obligation 4), retriable after that view has
     been presented to it; on acceptance the view joins the DAG
     and the tips re-derive. The fail-closed state ends exactly
     when the derived tip set has one element — no fixed
     array bound ever makes a divergence permanent. For this
     derivation the service retains the ancestry closure **as
     digest skeleton** back to its last single-tip state (beyond
     which it MAY prune — the `predecessor`
     check needs no view older than the last convergence; full
     artifacts follow the quota rule above). Two
     honest
     statements about scope: acceptance is deterministic **in the
     service's evidence** — services holding different view sets
     converge when the views themselves reach them, an eventual
     guarantee, not an instant global one; and responsibility for
     the reconciliation's content lies in the group's log,
     attributably — never at a service.
     A `terminal: true` view is
     itself final only as the chain is: a falsely terminal view is
     a divergence like any other (the group's next honest view
     contradicts it), handled by exactly this rule — a malicious
     quorum member can force the fail-closed state, not a
     permanent grave. **A terminal view carries its predecessor's
     `identities` unchanged, as the attesting set** — capabilities
     ended with the group, so the listing authorizes nothing; it
     exists so the quorum and intersection checks remain
     evaluable. **Terminal grace:** on accepting a terminal view
     the service does NOT discard the group binding at once: for
     the registered `terminalRetention` window — **measured from
     the service's own acceptance of the terminal view**, the
     one point every service can determine locally — it keeps the
     binding in a state equivalent to fail-closed (every
     authorization denied, the `relay` role ended) but
     chain-continuable — a valid view contradicting the terminal
     one within the window is a divergence like any other and
     enters exactly this rule's machinery. Only after the window
     passes undisputed is the binding discarded. Denial is the
     terminal state's whole effect anyway, so the grace window
     costs nothing in authority; what it buys is that a malicious
     quorum's false terminal view is recoverable evidence, not an
     irreversible deregistration. The residual stands stated: a
     false terminal view left undisputed past the window ends the
     binding, and the group re-registers (trust-on-first-use
     again) — symmetric with the whole-quorum-removal residual
     above.

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
operation id; and transport of this layer's envelope (3.3) with
its **signature input unmodified** — the envelope stays the sole
authority carrier, and a substrate that re-signs, re-wraps, or
re-orders the signed content is not admissible. The `proof` field
is the deliberate exception: it is a mutable evidence
accumulator, and replicas MUST maintain it per 3.3's canonical
merge — merging proofs is a conformance duty, not a modification
of authority content (nothing signed, no digest, and no identity
ever covers proof bytes).

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
world intact until some later write does not satisfy P2; neither
does replication that keeps serving a removed member's peers
after the removal commit — **replica eviction is part of the
enforcement artifact**, and forwarding is gated on the
forwarder's own prior canonical application
(commit-before-forward, 5.3). (P2
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
four states (`lineage` / `historyNarrow` / `lineageForm` /
`lineageVoid`, the last on discharges only — 7.1). Whatever the
form:
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
{ "v": "rltp-access-material/0.15", "adapter": "linear/0.1",
  "epoch": 7, "keys": { …per the adapter registration… } }
```

The same `keys` object, under `rltp-access-keydist/0.15`, is the
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
  "contentKey": "…base64url, 32 bytes…"
}
```

`contentKey` is the epoch's AES-256 content key — its commitment
is the multihash over its raw 32 bytes (7.1); it MUST be freshly
generated per epoch (7.1's freshness rule; fresh CSPRNG
generation is a P4 audit criterion). Exactly this one property,
no others. **Everything else is a domain-separated derivation,
never a transported secret:** the adapter's per-epoch working key
is `HKDF-SHA256(salt = empty, IKM = the raw content-key bytes,
info = the UTF-8 bytes of "rltp/v1/epoch-secret/" followed by the
genesis digest string, L = 32)`. It is a *subkey* of the content
key, honestly so: it adds domain separation, not independent
secrecy — in `open` mode, epochs whose content key is published
have no adapter-internal secrets either, which is consistent
(their content is world-readable anyway). The one commitment
check of 10.1 thereby authenticates the entire consensus-relevant
key material; a helper cannot deliver a correct content key with
a poisoned side secret, because there is no side secret to
deliver. The adapter uses 7.3's view wire
format unchanged. It is intentionally modest: no
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
refresh material to current members under the key service duty,
and the authenticated request itself. Registered here; document
profile, sealed envelope, dispositions, and acknowledgement rules
per the Delivery Contract §§3–6.

- `payload`: `keyDelivery` object with:
  - `group` — the group DID; `genesisDigest` — the group's
    identity (3.2);
  - `epoch` — the epoch the material belongs to (for `request`:
    the requester's best knowledge, informative);
  - `op` — the `oid:` of the operation this document serves (the
    transition for `keydist`; the canonical admission for
    `re-welcome`; the entitlement basis for `refresh`; the
    operation the claim rests on for `request`);
  - `kind` — `"keydist"`, `"re-welcome"`, `"refresh"`, or
    `"request"`;
  - `sealed` — REQUIRED for the three material kinds, absent for
    `request`; shape per `sealed-envelope.schema.json`: for
    `keydist` the key envelope whose digest the named
    transition's `keyDist` carries for this recipient (7.1's seal
    profile); for `re-welcome` a welcome seal per Membership §4,
    built from fresh P4 material at the sender's current
    position, sealed to the accept's card or to the card of the
    request it answers (5.3); for `refresh` a seal per 7.1's
    keydist profile — same HKDF info, AAD with the requester as
    recipient and the sender's current epoch as `newEpoch` —
    whose plaintext is a fresh keydist object from P4 at the
    sender's current position, sealed to the request's card (the
    committed-digest rule of `keydist` does not apply: the
    authenticity carrier is the commitment check at adoption);
  - `card` — REQUIRED for `request`, absent otherwise: the
    requester's contact card in the displayed form, its proof
    verifying under the requester's anchor (live key, no
    freshness claim — 5.3).
- `proof`: for the material kinds **absent** — authenticity is
  content-bound: for `keydist`, the named transition commits this
  envelope's digest, AAD-bound to group, epoch, and recipient;
  for `re-welcome` and `refresh`, the **material is adopted only
  if it verifies against the log** (below). For `request` the
  proof is **REQUIRED**, verifying under the document `issuer`,
  which MUST equal the claiming anchor and the enclosed card's
  anchor — the signature gate of the key service duty (5.3).
- **Consistency (MUST, before any effect):** payload schema
  valid; `genesisDigest` matches the recipient's state for that
  group (or, for a bootstrapping invitee, their own invite's
  digest); for `keydist`: the recipient's anchor appears in the
  named operation's `keyDist` with exactly this sealed envelope's
  digest, and `epoch` = that transition's `newEpoch`; for
  `re-welcome` and `refresh`: the named operation is a canonical
  admission (re-welcome: whose subject is the document
  `recipient`) or the recipient's entitlement basis (refresh),
  and — checked by the recipient at adoption — `epoch` = the
  unsealed material's `epoch` = the current epoch of the
  recipient's materialized (or freshly bootstrapped) state, whose
  `contentKeyCommitment` the unsealed content key MUST match; for
  `request`: proof and card as above. A violation is
  `failed(validation-failed)`, no acknowledgement.
- **Effect of `request`:** the receiver evaluates entitlement at
  its current materialized state (5.3) and, where it holds the
  current keys and the requester is entitled, MUST answer with
  the matching material kind (`re-welcome` or `refresh`, 5.3).
  The response duty is **once per (requester anchor, `op`, card
  digest, answered epoch)** — the epoch component keeps the duty
  alive across rotations: when the current epoch has advanced
  past the last answer, the same request (re-sent as a new
  document, since a byte-identical one is `duplicate-known` at
  the Contract's stage 4) earns a fresh answer without needing a
  new card. Receivers SHOULD answer at most one request per
  (group, requester) per **`key-request-interval` (default
  PT1H)** — per group, so one group's throttle never starves
  another's. An unentitled
  request is `failed(validation-failed)`. **A request never
  pends:** a receiver that cannot resolve the named group or
  operation against its own state disposes it
  `failed(validation-failed)` immediately — the requester retries
  later; the pending mechanics below exist for material a lagging
  recipient will grow into, never for demands on the receiver.
- **Defined effect (material kinds):** durable buffering;
  unsealing, the commitment check above, and application are the
  recipient's local acts against their replica. Idempotent by
  document digest; material for the same `(op, recipient)` is
  applied at most once per successfully verified content.
- **Dependency (material kinds only):** `group-state` — a
  recipient that cannot yet resolve the named operation disposes
  `incomplete(missing: group-state)` under the same pending
  mechanics as Membership §3.3 (keyed by document digest,
  retention `bootstrap-retention`, redelivery idempotent) — except
  the re-welcome answering a bootstrap, which is self-contained
  against the invitee's own accept exactly like the welcome it
  replaces (Membership §3.3 case 1).

## 11. Evolvability

- Every wire artifact carries its version (`rltp-access/0.15`,
  `rltp-access-view/0.15`, `rltp-access-material/0.15`,
  `rltp-access-keydist/0.15`,
  `rltp-access-registration/0.15`,
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
  requests are authenticated (signed by the entitled anchor, a
  live-keyed card enclosed), and adopted material must verify
  against the
  log's commitments (10.1) — so withheld welcomes, garbage
  envelopes, and broken lineage entries (repairable via
  `lineage.repair`) are delays and attributable misbehavior, never
  revocations of entitlement. Two residuals, stated: history
  whose every key holder is removed, departed, or withholding
  stays dark — 7.1's durability theorem names the one case where
  a delay hardens into loss; and a group whose *every* member
  withholds
  keys has factually expelled the victim without an operation —
  visible to the victim, deliberate, and equivalent to the group
  refusing to interact; no protocol makes people cooperate.
- **Honest revocation, honest leave.** 7.2 states exactly what
  rotation buys; UX MUST NOT present removal as retroactive
  erasure. A leave takes key-world effect at its discharging
  transition (5.4); in the pending window the leaver reads (they
  hold keys — pretending otherwise would be fiction) but has no
  policy standing in the log (excluded from the currency:
  authoring, co-signing, inviting) — while toward services they
  stay listed and view-signature-capable until discharge (7.3 is
  authoritative there: a service can check nothing else, and the
  in-epoch grow-only argument requires it) — and the discharge is
  a non-overridable single-signature act that no policy and no
  key-world state can block (the void discharge bridges history,
  it does not narrow it — 5.4, 7.1). Concurrent leaves drain to
  terminality through the drained dissolve path (5.4: any of the
  leavers ends the group with a single signature); a
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
- **Lineage is a disclosure surface; only its omission is a
  legitimized closure.** Each lineage entry
  extends what one current key unlocks; that is its purpose.
  Omission is a separately gated act (`history.narrow` aspect
  rule), never a transition author's private choice, and never an
  adapter's accident (P3). Narrowed spans are irreversible except
  through `history.expose` — deliberate, logged, carrying its
  disclosure in its body, byte-verifiable against the commitment
  chain. The recovery form is the deliberate opposite: it
  *bridges over* a key-void, under 7.1's honest theorem —
  reachable history is exactly as durable as the membership of
  its key holders. A falsely declared void is re-opened by the
  key holders' repair **duty**; where no member holds a step's
  keys, that span is dark under every form, the recovery form
  included — stated as the residual it is, not gated by an
  electorate that could hold a leave hostage (7.1, 5.4).
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
  the group chose. After a terminal view the service retains the
  last identity list for the `terminalRetention` window (7.3) —
  a bounded, registered prolongation of the same residue, ending
  with the binding's discard.
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

- **Normative schemas (shipped, offline closure):**
  `schemas/access-operation-envelope.schema.json` ·
  `schemas/payload-key-delivery.schema.json` ·
  `schemas/access-material.schema.json` ·
  `schemas/authorization-view.schema.json` ·
  `schemas/access-registration.schema.json` — plus, by reference,
  Membership's document schemas, `sealed-envelope.schema.json`,
  and `contact-card.schema.json`.
- **Profile** `rltp-access@0.15`; normatively references
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
    canonical proof merge (union of signers and issuers,
    first-valid entry per signer/issuer; the signer and issuer
    **sets** identical across arrival orders — signature bytes
    may differ and nothing reads them; merge dominates every
    variant; bounded by one entry per signer and issuer) with
    effects applied once per `id`;
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
  - key service duty: authenticated request (signature,
    live-keyed card) honored; unsigned or third-party request →
    no duty;
    re-derived material verifies against commitments; garbage
    material fails the 10.1 commitment check and is not adopted;
  - policy: rule keys incl. `history.narrow` aspect (both rules
    evaluated on one proof); product-space order to depth 4 incl.
    the two counterexamples; subject-binding rejection;
    `strongest` meta-resolution; satisfiability against policy
    currency (pending exits excluded); pending exit cannot
    author/co-sign/invite in the log yet remains view-listed and
    view-signature-capable until discharge (7.3); discharge
    rotation valid on a single signature against a restrictive
    `epoch.rotate` policy;
  - transitions: retained set computed (remove subject excluded;
    ancestry leaves discharged; rotation cannot exclude others —
    coverage mismatch → invalid; duplicates → invalid);
    no-plaintext-secret check; keydist AAD (genesis digest,
    newEpoch, recipient) — constructibility (no id in AAD) and
    cross-transition replay inertness; lineage embedded,
    verified against the previous commitment, absent only with
    authorized `historyNarrow`; `lineage.repair` accepted when
    verifying, first canonical repair counts;
  - leave/dissolve: pending exit excluded from the policy
    currency while remaining view-listed and
    view-signature-capable until discharge (7.3 — the one
    consistent statement, tested in both places); discharge by
    ancestry-containing transition, authorable by any member of
    its position, a pending exit included;
    last-member leave = terminal; concurrent leaves → drained
    dissolve path (single signature of any leaver, empty body,
    no transition, terminal);
    `member.remove` of a non-member → invalid;
  - views (7.3): registration; seq/prevView chain; epoch
    monotonicity as rollback protection (older-epoch view
    rejected; same-epoch older view only shrinks); freshness
    window enforced at acceptance (`validUntil` beyond
    `issuedAt + stalenessBound` → rejected); `m` change rule and
    `m ≤ |identities|`; gap/divergence → persistent fail-closed
    across restart; disputed terminal → fail-closed, cleared by
    a reconciliation view naming the divergent tips under its
    explicit `predecessor`;
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
    `rltp-access-keydist/0.15`; `lineageForm` third state accepted
    for a registered non-native adapter, rejected for the native
    one; views: `m = 0` invalid, signer-intersection rule,
    future-dated `issuedAt` rejected, pending exit still listed
    until discharge; key request: proof + card required, response
    once per (requester, op, card digest, answered epoch),
    unentitled (removed) requester refused at the helper's
    current state; re-welcome
    epoch equalities; last-member leave revived by a concurrent
    canonical admission;
  - *(round-4 additions)* group identity computed over the
    proof-free signature input — proof variants (same signer, new
    signature bytes) change nothing; proof-variant union: a
    variant satisfying the post-cascade effective rule keeps the
    operation effective on every replica holding it; recovery
    `opens` valid under the operation's own rule (a bridge, 7.1 —
    only the *absence* of lineage is `history.narrow`-gated);
    replacement `service-identity.announce` effective
    only at the next transition (in-epoch view sets strictly
    grow-only); stepwise reconciliation over more than eight
    divergent tips; seq-0 acceptance rule; `m`-timing (a shrink
    below the chained quorum requirement is unacceptable without
    a preceding `m`-lowering view); `refresh` toward a retained
    member and toward the founder — sealed to the request card,
    adopted only on commitment match; a `request` naming unknown
    state fails immediately and never pends; `ct` below the
    80-character minimum schema-rejected;
  - *(round-5 additions)* proof merge replaces variant retention:
    storage bounded by one entry per signer/issuer, the evaluated
    sets identical across arrival orders, post-cascade evaluation
    over the merged signer set; replica eviction in the removal commit
    (post-removal operations unreachable to the evicted peer —
    port vector P2); epochSecret derived from contentKey (a
    poisoned side secret is unconstructible; refresh material
    fully authenticated by the commitment check); replacement
    announcement effective at the first transition containing it
    in its ancestry (concurrent transition does not carry it);
    duty dedupe
    includes the answered epoch (same request re-earns material
    after a rotation); per-group rate limiting; reconciliation
    state machine (seq, epoch, tip replacement, quorum source)
    stepwise to one tip;
  - *(round-6 additions)* credential merge per issuer (one per
    issuer; an issuer minting many credentials gains nothing);
    merged mechanism label derived, nothing normative reads it
    (3.3); caps at 4096; commitment
    equality across epochs → transition invalid (key reuse dead);
    first-valid-wins per signer (a pre-computed descending
    signature series causes no re-propagation); reconciliation
    predecessor checkable incl. diverged reconciliation views,
    ordinary views
    extend their tip during fail-closed; eviction at every
    membership end (removal / discharge / terminal); epoch-secret
    derivation bytes exact; duty dedupe keys identical in 5.3 and
    10.1;
  - *(round-7 additions)* pure encounter proof keeps its derived
    `encounter-presentation` label through the merge (never
    falsely `composite`); first-valid per issuer (no
    digest-smallest replacement); terminal view
    carries the predecessor's identities as attesting set and is
    constructible; 4097th admission invalid at its position
    (serial case of the profile group
    bound); eviction bound at each replica's own canonical
    application; cross-group / sibling key-reuse as P4 audit
    vector;
  - *(round-8 additions)* proof merge admissibility: a
    cryptographically valid credential about a different subject
    never enters the merge and never occupies its issuer's entry
    (slot poisoning dead; the later subject-bound credential of
    the same issuer merges); merged proof evaluated as the pair
    of sets whatever the variants' labels; schema rejects
    `credentials` under `mechanism: signature-set`; recovery
    bridge: `opens = 0` valid (bridges to the genesis epoch's
    key), constructible only by a holder of `opens`'s key,
    skipped span surfaced, discharge-out-of-void on a single
    signature; explicit `predecessor` field checked
    (non-ancestor or non-maximal-seq → invalid); terminal grace:
    contradicting view within `terminalRetention` → ordinary
    divergence machinery, binding kept; past the window →
    binding discarded, re-registration; commit-before-forward:
    batch with removal + descendants at a lagging replica →
    nothing causally past the removal ever forwarded to the
    removed peer, transitive third-replica forwarding included;
    keydist plaintext version current end-to-end
    (schema description included);
  - *(round-9 additions)* lineage durability theorem: a false
    skip whose span keys are held by remaining members is
    re-opened by the repair **duty**; the disjoint-holder shapes
    (span
    key holders all removed, departed, or the void author alone)
    → span dark under the recovery form AND under a garbage-`ct`
    default form alike — the skip adds no darkening power,
    no false repair promise; credential admissibility exact:
    `credentialSubject.id` = `body.subject` compared, and a
    credential on a rule key that cannot carry an encounter rule
    (`member.remove`) inadmissible even with matching subject;
    proof evaluation label-free (same sets under different
    labels → same verdict; merged emission always
    schema-consistent); drained dissolve path: all members
    pending exits on merged branches → a pending exit's
    single-signed
    `group.dissolve` (drained path) valid, terminal, schema-valid
    with empty body and no transition;
    crossing reconciliations (Rxy/Ryz over shared parent Y) →
    identical derived tip sets on every service holding the same
    views, any arrival order; tips = maximal elements of the
    held DAG; ancestry-closure retention back to the last
    single-tip state, pruning beyond it; `terminalRetention`
    measured from local acceptance;
  - *(round-10 additions)* fold linearization: the ready-set
    smallest-id rule on the A→C, B-concurrent,
    id(C)<id(B)<id(A) shape → one defined order (B, A, C) on
    every replica (the pairwise rule has no consistent order
    there); proof-merge position bound: a flood of valid
    signatures by non-currency Sybil signers and subject-correct
    credentials by non-currency Sybil issuers merges zero
    entries; merged proof re-serializes within the wire
    cap at full currency plus subject; drained dissolve narrowed: an
    active (non-leaving) author cannot use the drained path
    even when all others are pending exits (their discharge
    retains {author} instead), and all-pending with no authored
    dissolve = dormant, surfaced, any leaver finalizes later;
    pending exit authors `lineage.repair` validly (the third
    exception, at the validity gate AND the merge);
    label derivation single-form:
    pure encounter merge (credentials + subject-only signer) →
    `encounter-presentation`, credentials-empty →
    `signature-set`, else `composite`, identical from 3.3 and
    4.3;
  - *(round-11 additions)* over-capacity: two admissions
    concurrent at 4095 → merged membership 4097, both members,
    all artifacts (proofs, `keyDist`, view identities)
    schema-valid under the 8192 caps, every further admission
    invalid at its ≥ 4096 position until departures shrink the
    group; no arbitration vector exists because no arbitration
    exists; eligible-signer merge: a discharge proven by two
    different pending exits' variants merges both signatures and
    re-serializes schema-validly; a genesis proof merges exactly
    its two required signatures; Sybil signatures outside the
    member set merge nothing on any operation; `lineageVoid`:
    valid only on a discharge, ungated, surfaced as unbridged,
    repairable by key holders, invalid on every other
    transition; a keyless discharger (admitted into a void, void
    author departed) discharges validly with `lineageVoid`;
    divergence quota unit: full artifacts bounded at
    `divergenceQuota`, non-tip views droppable to digest
    skeleton with all checks still computable, saturated service
    accepts a reconciliation bundle whose named parents the
    flood crowded out (skeleton digest-match readmission and
    never-seen parents both covered), transient overshoot ≤ 8
    reclaimed on acceptance; registration artifact: schema-valid
    registration accepted, quota outside [16, 4096] rejected,
    bad signature rejected, missing field rejected.
- Every normative statement is vector-testable or explicitly
  state-dependent — the state-dependent set is named: signal
  dispositions, remediation and key service duties (helper
  reachability included), teardown, and the adapter
  confidentiality audit criteria of 9.1 — exercised with
  controlled state and clock.

## 15. Open Issues

- **OI-1 Sibling-epoch merge** — now explicitly also the
  boundary of the recovery guarantee: an insider can pair a
  garbage distribution with a sibling transition and force the
  forked state, so the exit from a key-void is guaranteed only in
  a fork-free log until OI-1 resolves. Causal epoch DAG with conflict
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
  design). Blocked on a sound exercise mechanism; nothing in 0.12
  licenses an interim one.
- **OI-13 The membrane.** Group-issued outward credentials
  (membership credentials, personhood projection) need a closed
  credential profile — body, group-signature mechanism after
  root-key destruction, claims discipline — before a
  `credential.issue` operation returns to the catalog.
- **OI-14 Large groups.** This profile bounds admission at 4096
  members (5.3) and sizes every membership-scaled wire cap at
  8192 — twice the bound — so merged overshoot stays
  schema-valid (3.6). A merge exceeding even the doubled caps
  cannot build its artifacts and fails closed until the group
  shrinks; groups that genuinely need that size need a successor
  profile with chunked or accumulator-based artifacts (the same
  succinct-membership direction the withdrawn commitment
  machinery gestured at, OI-12); until it exists, the bound
  pair is the honest, enforced limit rather than an unstated
  assumption.
- *(Cross-document debts, tracked for Membership 0.8: adopt the
  MO-4 material pin and update its §4/welcome-schema prose — 9.5;
  align its "identified by its group DID" terminology and its
  per-group keying — pending stores, evidence authorization —
  with the genesis-digest identity of 3.2, whose value is
  computed over the proof-free signature input (its §3.1
  "multihash of the genesis operation" needs that scope); adopt
  admission rule 0 and the same-subject arbitration set of 5.3
  (its §3.3 arbitrates same-accept candidates only) and the
  `genesisDigest` cross-binding of rule 2; update its Access
  references from draft 0.3 and its service pointer from Access
  §10 to §7.3; align its §1.2 flow wording ("fresh card") with
  the live-key rule of its own §2. (No admission-state change is
  owed: under 3.6's over-capacity rule, "membership stands upon
  a canonical admission" holds literally.) Until then this layer
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
