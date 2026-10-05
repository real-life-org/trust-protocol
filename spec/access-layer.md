# RLTP Access Layer

**Real Life Trust Protocol — Layer 3: Access**

- **Status:** Editor's Draft
- **Version:** 0.54.0-draft
- **Editors:** Anton Tranelis
- **Date:** 2026-10-06
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Conformance profile:** `rltp-access@0.54` (draft). Wire forms:
  the operation envelope `rltp-access/0.25`, the `0.24` family
  (`rltp-access-view/0.24`, `rltp-access-material/0.24`,
  `rltp-access-keydist/0.24`,
  `rltp-access-removal-notice/0.24`,
  `rltp-access-member-mapping/0.24`),
  `rltp-access-registration/0.27`, the session-plane evidence
  forms `…/1` (3.6), the vouch (`vouch@2`, 5.3) as a W3C VC in
  DTG form. Registered key adapters: `linear/0.1`, `beekem/0.1`
  (experimental).
- **Companions:** RLTP Identity 0.51 (securing profile, 2.3);
  RLTP Encounter 0.30; RLTP Delivery Contract 0.79 (normative
  reference for every frame this layer addresses to one party:
  key delivery, removal notice, view and registration transport);
  Membership Tasks 0.16 (the task types that transport this
  layer's admission documents).
- **Supersedes:** version 0.53 (archived as
  `archive/access-layer-0.53.md`). Earlier versions: Appendix C.

## Status of This Document

This is an Editor's Draft with no standing beyond its own argument.
The reference library (Appendix A) implements its wire types,
schemas and identity derivations; the authority rules, the conflict
matrix of 3.6, the two ports of Section 9 and the service classes of
9.3 are derived from experiments against three existing key-
agreement systems and are implemented against the adapter
`beekem/0.1` in an experimental harness, not yet in the library. The
next expected changes are signed device bindings and policy under
`beekem/0.1`, and an active-attacker review of the service rules;
each is a new version. Open questions are listed in Section 15, and
feedback is welcome via the issues of the publication repository
(github.com/real-life-org/trust-protocol).


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
an end-to-end-encrypted, local-first setting.

The layer is cut into two ports. The **authority port** — the log,
its materialization, the conflict matrix, policy, and
authorization views — is this layer's own and is not replaceable:
it alone decides who belongs and who may do what. The **key port**
produces the epoch secrets that make those decisions effective,
under six invariants that every registered **adapter** states
against; `linear/0.1` is the reference adapter and `beekem/0.1` a
registered experimental one. Persons are members of the log;
their devices hold keys in the adapter's key structure, each bound
to its person by a signed **device card**, so that losing a device
is not losing membership. Concurrent removals that carry authority
all take effect; only concurrent constitutional changes, and a
dissolution against an enforcement, fork the group, fail-closed.

Services carry a group's data and follow its log; they never
decide it. Every service a group registers declares its **service
class** — `blind`, `view`, or `log` — which states what that
service learns of the group: ciphertext only, the chained,
quorum-signed authorization views as well, or the authority log
itself. What a service knows is the group's choice, stated in the
registration.

Two things are deliberately deferred, not designed badly:
grantable capabilities for non-members (the exercise mechanism
must exist first — Section 15) and group-issued credentials (the
credential profile must exist first — Section 15). This document
specifies only what it can make sound.

Access is deliberately separate from trust: the Encounter layer
records that people met and recognized each other; the Access
layer governs what a collective grants, and how it takes it back.
Encounter credentials are immutable and never revoked; access is
revocable by construction. That difference is why the layers
exist.


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
   in a continuing group carries its key operation in the same
   signed envelope; leaving obligates one; dissolution ends the
   group itself.
4. **Services follow the log.** No service keeps its own registry
   of who belongs, and none is asked to decide anything. A service
   knows of a group exactly what the group's registration grants
   it — ciphertext, the chained and quorum-signed authorization
   views, or the log itself — and it gates effects only by the
   authorization state it was given, never by a judgement of its
   own.
5. **Authority and keys are two ports.** The authority port —
   log, materialization, conflict matrix, policy, views — is this
   layer's own and is not replaceable, because authority held by a
   replaceable component would be authority held by whoever
   supplies it. The key port is a set of invariants on epoch
   secrets that registered adapters satisfy; an adapter is part of
   the trusted computing base for confidentiality, never for
   authority, and its obligations are stated (Section 9.2).

### 1.2 Position and scope

The Identity layer supplies anchors and key recovery; the anchor a
member acts under is a per-group context anchor (5.1). A member is
a person; the devices a person acts from are bound to that anchor
by device cards and hold keys in the key port's structure (5.1).
The Encounter layer supplies immutable evidence that people met —
consumable here as policy inputs (4.2). The Replication Contract
carries the encrypted log and documents between replicas and
services. The Delivery Contract carries documents to parties the
replica cannot reach; the Membership Tasks define how invitation,
consent, and welcome travel; this layer defines what makes an
admission — or any other operation — canonical, and registers two
further task types of its own: `key-delivery/0.1` (10.1), by which
key material and key requests travel, and `removal-notice/0.1`
(10.2), by which a removed member is told.

Out of scope by decision, tracked as open issues (Section 15):
capability grants to non-members and their service-side exercise;
group-issued outward credentials.

### 1.3 Principles inherited

- **Issuance counts, arrival never** (Encounter 1.3): an
  operation's validity is a function of its signatures and its
  causal position, never of arrival time (RLTP-ACC-3180).
- **Authenticity has exactly one carrier, one direction**
  (Delivery 1.1, Membership §4): the operation envelope carries its
  signatures and encloses or digest-commits everything it vouches
  for; nothing an operation commits to ever points back at the
  operation's id (RLTP-ACC-3005), and this layer's own key
  artifacts obey the rule.
- **The log is canonical; a task is a feeder** (Membership 1.2):
  effects follow materialization, never delivery (RLTP-ACC-3370).
- **Authority before concurrency.** Whether an operation carries
  authority is read from its own position first; how concurrent
  branches combine is decided only afterwards, and only between
  operations that carry it (Section 3.6).


## 2. Conventions and Terminology

### 2.1 Requirement language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" in this document are to be interpreted as described in
BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all
capitals, as shown here.

Every normative statement of this document is one numbered rule of
the form `RLTP-ACC-<Block><nnn>`. The block names the section the
rule belongs to (2xxx for Section 2, 3xxx for Section 3, and so on;
12xxx for Sections 12 and 13, 14xxx for Section 14); within a
block, numbers advance in steps of ten, except in block 3, which
advances in steps of five. In block 9 the authority port (9.1)
starts at 9010, the key port's invariants (9.2) at 9230, the
service (9.3) at 9500, and `linear/0.1` (9.4.1) at 9700. A rule
number is a stable name, never reused, and gaps are left for
insertions. Paragraphs marked
*Rationale* and *Editor's note*, the "In plain terms" paragraphs,
tables introduced as informative, and the sections marked
informative carry no requirement. A table carries requirements
only where a numbered rule says so; that rule then binds every
row.

### 2.2 Terms

Permanent identifiers are `https://real-life.org/rltp/v1#<Fragment>`.
The names are those of the RLTP term register (`terms/rltp.skos.jsonld`).

- **Group** — a collective actor with members, a policy, an
  authority log and documents; its identity is the digest of its
  genesis operation, its address its group DID (3.2).
- **Member anchor** — the per-group context anchor under which one
  member acts in one group (5.1; DTG scope `directed`).
- **Community anchor** — the anchor of a person's personal
  community, an ordinary member anchor of Identity §6, serving as
  the person's chosen cross-relationship coordinate; it appears in
  no artifact of this layer except inside `member-mapping@1` (5.5).
- **Device card** — the signed binding of one device's key
  material to the member anchor of the person it belongs to (5.1).
- **Authority log** — the append-only operation DAG rooted in the
  genesis operation; the sole source of authorization state (3.1).
- **Operation** — a signed, causally anchored envelope (3.3).
- **Materialization** — the deterministic derivation of group state
  from the log (3.5, 3.6); the **materialized state** is its result.
- **Canonical** — an operation is canonical when materialization at
  its causal position accepts it and no outcome rule of 3.6
  disposes of it.
- **Forked state** — the fail-closed materialization outcome of the
  fork pairing that 3.6 names: a policy change concurrent with an
  enforcement operation.
- **Policy** — group-defined data stating, per rule key, which
  proof satisfies the group's decision rule (Section 4).
- **Policy proof** — the signatures and credentials an operation
  carries to satisfy its rule key's requirement (4.3).
- **Privileged operation** — an operation of the catalog (4.5) that
  a policy rule key gates.
- **Epoch** — a numbered period of the group's key world;
  enforcement takes effect as epoch transitions (Section 7); term
  aligned with MLS [RFC9420].
- **Retained members** — the normatively computed set of members an
  enforcement operation's new epoch secret reaches (7.1).
- **Pending exit** — the state of a member whose `member.leave` has
  merged but whose discharging transition has not (5.4).
- **Authorization view** — the chained, quorum-signed object by
  which a service of class `view` learns a group's epoch and
  authorized device identities (7.3).
- **Implicit capability** — the read/write standing every member
  holds by membership alone (Section 6).
- **Replica boundary** — the set of parties holding, and entitled
  to hold, the group's replicated log at a given materialized state
  (Membership §2).
- **Authority port** — the part of this layer that decides
  membership, policy and authorization: log, materialization,
  conflict matrix, policy, views; not replaceable (9.1).
- **Key port** — the interface through which a registered adapter
  produces epoch secrets satisfying the invariants KV1 to KV6
  (9.2).
- **Adapter** — a registered binding of one key-agreement procedure
  to the key port (9.4).
- **Epoch-key lineage** — the chain of per-transition entries by
  which the adapter `linear/0.1` makes a previous content key
  readable under the next (9.4.1).
- **Healing** — the key port's correction of its key structure to
  the materialized membership (9.2).
- **Service** — a party that stores and forwards a group's items
  without holding its keys; its **class** (`blind`, `view`, `log`)
  is the registered statement of what it knows of the group (9.3).
- **Key service duty** — the standing obligation of members to
  (re)deliver verifiable current-epoch key material to a party the
  materialized state entitles to it (5.3, 7.1, 10.1).

| Term | Fragment | | Term | Fragment |
|---|---|---|---|---|
| Group | `#Group` | | Epoch | `#Epoch` |
| Member anchor | `#MemberAnchor` | | Community anchor | `#CommunityAnchor` |
| Canonical | `#Canonical` | | Replica boundary | `#ReplicaBoundary` |
| Service | `#Service` | | Materialization | `#Materialization` |
| Authority log | `#AuthorityLog` | | Epoch-key lineage | `#EpochKeyLineage` |
| Operation | `#Operation` | | Authorization view | `#AuthorizationView` |
| Materialized state | `#MaterializedState` | | Privileged operation | `#PrivilegedOperation` |
| Forked state | `#ForkedState` | | Visibility mode | `#VisibilityMode` |
| Member | `#Member` | | Implicit capability | `#ImplicitCapability` |
| Device card | `#DeviceCard` | | Authority port | `#AuthorityPort` |
| Retained members | `#RetainedMembers` | | Key port | `#KeyPort` |
| Pending exit | `#PendingExit` | | Adapter | `#Adapter` |
| Policy | `#Policy` | | Healing | `#Healing` |
| Policy proof | `#PolicyProof` | | Service class | `#ServiceClass` |
| Key service duty | `#KeyServiceDuty` | | | |

### 2.3 Securing profile (bound to Encounter 2.3)

This layer consumes the securing profile of the Encounter layer
(Encounter 2.3), which in turn restates the surface of Identity
0.51 it consumes. Where the rules below and Encounter 2.3
disagree, Encounter governs.

**RLTP-ACC-2010** — The securing profile of Encounter 2.3 MUST
apply to every artifact of this layer.

**RLTP-ACC-2020** — A digest of this layer MUST be a multibase
multihash over the JCS [RFC8785] bytes of its input unless a rule
names other input bytes.

**RLTP-ACC-2030** — A signature of this layer MUST be Ed25519
under a `did:key` anchor unless a registered profile states
otherwise.

*Rationale.* One proof, digest, and time rule across all layers
means two verifiers never judge the same bytes differently because
they apply different profiles. Without one canonical serialization
the same object would have two digests, and every identity built
on a digest (3.2) would split. A signature scheme that is not
bound to a self-certifying anchor could not be verified offline,
and this layer's verdicts must be reproducible by every replica
without a directory.


## 3. The Authority Log

*In plain terms.* Everything a group decides is written down as
signed entries in one shared log, and each entry names the entries
it builds on. Whoever holds the log can recompute, step by step and
without asking anyone, who belongs to the group and what its rules
are; two people holding the same entries always get the same
answer. The group's name is a fingerprint of its very first entry,
so no one can swap in a different group under the same address.

### 3.1 One log, one truth

**RLTP-ACC-3005** — An artifact an operation commits to MUST NOT
contain or reference that operation's `id`.

**RLTP-ACC-3010** — A group MUST have exactly one authority log.

**RLTP-ACC-3015** — Every authorization decision MUST be derived
from the materialized state of the authority log and from nothing
else — never from document content, replication metadata, or
service state.

**RLTP-ACC-3020** — The authority log MUST be readable only by
the group's members and, where the group has registered a service
of class `log` (Section 9.3), by that service, in every visibility
mode.

**RLTP-ACC-3025** — Epoch content keys MUST NOT gate the authority
operations, which every replica holder reads whatever epoch keys
it holds.

*Rationale.* An artifact that pointed back at the `id` of the
operation committing to it would be an unconstructible hash fixed
point; authenticity therefore runs in one direction only. Two logs
would be two truths about membership. Document content,
replication metadata, and service state can be influenced by
parties without authority, so authority follows only from signed
operations. The log reveals membership, policy, and history:
`open` visibility opens document content, never the log (Section
8), and a service reads the log only where the group chose class
`log` for it. The confidentiality boundary of the log is the
replica, never the epoch: epoch keys gate content, and a member
who lost an epoch's key must still be able to materialize the
authority state — otherwise a recovery rotation out of an epoch
nobody can read would not be constructible.

### 3.2 Group identity: the genesis digest

**RLTP-ACC-3030** — The identity of a group MUST be the multibase
multihash digest over its genesis operation's signature input: the
JCS serialization with `id` set to the empty string and `proof`
omitted (3.3).

**RLTP-ACC-3035** — The bytes of an envelope's `proof` accumulator
MUST NOT enter a group identity or any other digest of this layer;
a signed artifact enclosed in a body is digested as its own
digest rule states, its embedded proof included.

**RLTP-ACC-3040** — Every artifact that binds to a group —
membership invites (`genesisDigest`, Membership 3.1),
authorization views (7.3), key deliveries, replica state — MUST be
keyed by the group's genesis digest.

**RLTP-ACC-3045** — Where the genesis digest enters cryptographic
or canonical bytes — the `group/<digest>` label (5.1), the
service-identity info string (5.2), and the constructions of a
registered adapter (Section 9.4) — its canonical multibase `u`
rendering MUST be used.

**RLTP-ACC-3050** — A signed artifact MUST NOT be rewritten when
its digest is re-encoded for a construction.

**RLTP-ACC-3055** — A string-backed index keyed by a digest MUST
canonicalize the digest to `u` before indexing.

**RLTP-ACC-3060** — The group DID's secret key MAY be destroyed
after the genesis is signed.

*Rationale.* The genesis digest and the genesis `id` encode the
same hash bytes; the identity is their multibase multihash form, so
existing `genesisDigest` fields keep their format. Signatures are
malleable — one signer can produce many valid signature bytes over
one message — so an identity over proof bytes would not be unique.
An artifact bound only by the group DID could be carried into a
sibling genesis under the same DID. A `z`-carried digest
(Encounter 2.3 obliges its acceptance) would yield different
derivation inputs and associated data than the `u` form of the same
digest, so the canonical form is used for bytes, and only for
them: rewriting the signed artifact would break its proof, and two
renderings in an index would split state that is one. The group
DID self-certifies the genesis (3.4.1) and then retires; a kept
group key would be a theft target that confers nothing.

**RLTP-ACC-3065** — An implementation MUST scope all group state
by genesis digest.

**RLTP-ACC-3070** — An invitee MUST bootstrap against the genesis
digest its own invite pinned (Membership 3.3).

**RLTP-ACC-3075** — Operations of one genesis MUST NOT affect the
state of another genesis under the same DID.

**RLTP-ACC-3080** — Every slot, window and throttle defined by this
layer — the provisional bootstrap candidate and its
`provisional-window` (10.1), the key-service slot and its deadline
(5.3, 10.1), and the service-side presentation rate limit (7.3) —
MUST be keyed by `genesisDigest`, never by the group DID.

**RLTP-ACC-3085** — A newcomer MUST verify a group from the genesis
digest through genesis validation and the operation DAG to the
materialized state, and by no other path.

*Rationale.* Two distinct genesis operations under one DID are not
a conflict to resolve but two distinct groups sharing an address; a
founder who mints several has founded several groups, and nothing
lets them merge or bind one another. An invitee steered into a
sibling genesis of the same founder would join a group it never
agreed to. The scoping covers operational state, not only the
replicated log: keyed by the shared DID, two sibling geneses with
one invitee or requester in common would displace each other's
candidates, consume each other's deadlines, and exhaust each
other's rate budgets — one group affecting the liveness of a group
it is defined not to bind. Every shortcut to a group's state — a
snapshot, a service's statement — would be a second, forgeable
truth; the log is the genesis chain.

**RLTP-ACC-3090** — The initial membership of a group MUST be
exactly one anchor, the founder.

**RLTP-ACC-3095** — Every membership other than the founder's MUST
rest on a signed accept.

*Rationale.* The founder creates the group key, signs the genesis
with it, and countersigns as themselves; everyone else, co-founders
included, joins through the ordinary admission chain (5.3). No one
can be claimed into a group they never consented to.

### 3.3 The operation envelope

Every operation is one envelope (shown as JSON; JCS is the
canonical serialization). The body of an enforcement operation
carries its `transition` (Section 7), which carries `keyOpDigest`
(Section 9.2).

```json
{
  "v": "rltp-access/0.25",
  "op": "member.remove",
  "group": "did:key:z6Mk…group",
  "epoch": 7,
  "policyVersion": 3,
  "prev": ["oid:…", "oid:…"],
  "body": { …operation-specific, Section 4.5… },
  "crit": ["…extension fields that must be understood…"],
  "id": "oid:…",
  "author": "did:key:z6Mk…member",
  "proof": {
    "mechanism": "signature-set",
    "signatures": [ { "signer": "did:key:…", "sig": "…" } ]
  }
}
```

**RLTP-ACC-3100** — An operation's `id` MUST be `oid:` followed by
the unpadded base64url SHA-256 of the JCS serialization of the
envelope with `id` set to the empty string and `proof` omitted.

**RLTP-ACC-3105** — Every signature in `proof` MUST be over exactly
the serialization from which `id` is computed.

**RLTP-ACC-3110** — `proof.signatures` MUST be sorted by `signer`
in unsigned bytewise order of the DID string.

**RLTP-ACC-3115** — An operation with an unsorted proof MUST be
rejected as invalid.

*Rationale.* The `id` is self-addressing and bound by every
signature; the envelope binds operation type, full content, group,
epoch, `policyVersion`, and causal predecessors, so an operation is
not valid anywhere else, at any other position, or under any other
policy. A signature over other bytes would let an operation be
transplanted. The sort order is hygiene, not identity: no identity
or digest of this layer is computed over proof bytes (3.2), but one
canonical proof form keeps serializations comparable.

**RLTP-ACC-3120** — A replica holding several valid proofs for one
`id` MUST hold exactly one merged proof.

**RLTP-ACC-3125** — A merged proof is a pair of sets: a signature
set and a vouch set.

**RLTP-ACC-3130** — A signature MUST NOT enter a merged proof
unless its signer is an eligible signer of the operation (3.4.2).

**RLTP-ACC-3135** — A vouch MUST NOT enter a merged proof unless it
is admissible per 4.3 for this operation's subject, accept,
ancestor-position policy currency, and rule key.

**RLTP-ACC-3140** — A merged proof MUST keep, per signer and per
voucher, the first valid entry seen and ignore later ones.

**RLTP-ACC-3145** — A rule of this layer MUST NOT read the
`mechanism` label of a merged proof.

**RLTP-ACC-3150** — Proof evaluation MUST read only the signer set
and the voucher set of the merged proof.

The derived label of a merged proof is `signature-set` when its
vouch set is empty, `encounter-presentation` when its vouch set is
non-empty and its signer set is exactly the operation's subject,
and `composite` otherwise; a replica emits it when re-serializing
(RLTP-ACC-4240).

*Rationale.* `proof` lies outside the `id`, so replicas collect
independent evidence for one operation, and that evidence must
neither be lost nor produce two states. Entry is position-bounded
on both sides: anchors are freely mintable, so a signer outside the
eligible set, or a voucher outside the currency, would otherwise
occupy entries however many valid bytes it signed, and a vouch
about another subject or accept could poison its issuer's entry
with evidence that proves nothing about this operation. Keeping
the first valid entry avoids replacement churn and bounds the
merge by the membership plus one. Any valid signature is
equivalent evidence of its signer and any admissible vouch of its
voucher's edge, so replicas whose proof bytes differ reach
identical verdicts, and the merge proves whatever any valid variant
proved; a label that rules could read would make proof bytes a
ground of judgement.

**RLTP-ACC-3155** — Replication MAY convey proof evidence for one
`id` across several transmissions.

**RLTP-ACC-3160** — While membership is at or below the wire
ceiling, a canonical merged proof MUST re-serialize
schema-conformantly in one artifact.

**RLTP-ACC-3165** — Application of an operation MUST be idempotent
by `id`.

*Rationale.* The merge is an accumulator, not a wire artifact: the
wire caps of the shipped schemas (8192, twice the admission bound,
Section 3.6) bound one serialized artifact, never the accumulated
evidence. Outside the degraded state of Section 3.6 the merge still
fits one artifact, so replication of a canonical operation is
always constructible. A duplicated delivery must not have a
duplicated effect.

**RLTP-ACC-3170** — `prev` MUST list the op-ids of the DAG heads
known to the author at authoring time.

**RLTP-ACC-3175** — `epoch` and `policyVersion` MUST equal those of
the state materialized from the operation's ancestors.

**RLTP-ACC-3180** — Validity and epoch effect MUST NOT depend on a
verifier's wall clock.

**RLTP-ACC-3185** — Two honest verifiers holding the same
operations MUST reach the same verdict at any time.

**RLTP-ACC-3190** — Wall-clock claims MUST appear only at the
service boundary (7.3), as signed fields with declared skew bounds.

*Rationale.* `prev` anchors every operation causally; every
position check rests on it. The genesis has `prev: []` and is the
only such operation (3.4.1). An operation whose ancestors do not
produce its declared epoch and policy version is invalid — this,
not wall-clock time, is the replay and race gate. Two concurrent
enforcement operations both name the epoch of their common
ancestor and both open the next one; an adapter declaring KV6
merges their secrets under that one number (Section 9.2), and under
an adapter without KV6 enforcement is serialized. Arrival time is
controlled by the network and by an attacker; a rule that
consulted it would split honest replicas. Clocks belong to the
freshness of views, never to validity.

**RLTP-ACC-3195** — A verifier MUST reject an envelope that lists
an unknown field in `crit`.

**RLTP-ACC-3200** — A verifier MUST ignore an unknown envelope
field not listed in `crit`.

**RLTP-ACC-3205** — The envelope schema MUST pass unknown
envelope-level fields through.

**RLTP-ACC-3210** — A field defined in this document MUST NOT be
listed in `crit`.

*Rationale.* `crit` names extension fields whose semantics restrict
authority; silently ignoring such a field would grant authority the
extension meant to withhold. Ignoring every other unknown field
keeps the envelope forward-compatible, and a schema that rejected
unknown envelope fields would take that decision away from the
`crit` mechanism. A field this document defines is known to every
conformant verifier and can never be unknown.

### 3.4 Operation validity

#### 3.4.1 Genesis validation

The genesis operation has no ancestors and is validated by its own
complete procedure.

**RLTP-ACC-3215** — A genesis MUST parse, carry `op`
`"group.genesis"`, and have an `id` that recomputes.

**RLTP-ACC-3220** — A genesis MUST have `prev` `[]`, `epoch` `0`,
and `policyVersion` `1`.

**RLTP-ACC-3225** — A genesis proof MUST be a `signature-set` of
exactly two signatures over the envelope serialization, one by the
key of the DID in `group` and one by the founder's anchor.

**RLTP-ACC-3230** — The group DID MUST differ from the founder's
anchor.

**RLTP-ACC-3235** — A genesis body's `members` MUST be exactly the
founder's anchor.

**RLTP-ACC-3240** — A genesis `card` MUST be a contact card in the
displayed form of Encounter §6, carrying neither `sentTo` nor
`boundTo`, whose `anchor` equals the founder and whose proof
verifies under it.

**RLTP-ACC-3245** — A genesis `policy` MUST be structurally valid
and satisfiable against the founder-only membership per 4.4.

**RLTP-ACC-3250** — A genesis body MUST carry the initial
visibility mode (Section 8) as `visibility`.

**RLTP-ACC-3255** — A genesis body MUST name a registered adapter
of the key port (Section 9.4) as `adapter`.

**RLTP-ACC-3260** — A genesis body MUST carry the adapter's binding
of epoch 0 to its secret (Section 9.2), including `keyOpDigest`.

**RLTP-ACC-3265** — A genesis body MUST carry the founder's derived
service identity (5.2) as `serviceIdentity`.

**RLTP-ACC-3270** — A genesis `author` MUST be the founder.

*Rationale.* The two signatures by two distinct keys are
self-certification of the address and the founder's consent; no
one founds a group over someone else's name, and a single key in
both roles would collapse them into one signature. The genesis
card is the founder's person card: it is the founder's counterpart
of an admitted member's accept card, and the key-agreement key it
names must come from the founder alone. A group founded with a
policy its founder cannot satisfy could never act. Every replica
must speak the same key procedure from epoch 0 on and check the
same binding; without the binding in the log, a different epoch-0
secret could be substituted. The view chain needs a signer from
epoch 0 on (7.3).

**RLTP-ACC-3275** — The founder's anchor MUST be a fresh context
anchor minted for the founding act and used in no other context.

**RLTP-ACC-3280** — An operation other than the genesis with empty
`prev` MUST be treated as belonging to a different group.

*Rationale.* A joiner's member anchor derives from the
`group/<genesis digest>` context (5.1), which cannot exist before
the genesis digest does; the founder therefore mints a context of
Identity §6's nonce-based pair class, a founding being a
relationship-creation act — the same scoping property from a
different register row. A standing anchor would correlate the
group with the founder's other relationships. A second root in one
group would be a second genesis, and 3.2 already makes that a
second group.

#### 3.4.2 General validation

A non-genesis operation is valid exactly when the checks below hold,
in order. *S* denotes the state materialized from its ancestors.

**RLTP-ACC-3285** — A non-genesis operation MUST parse and have an
`id` that recomputes.

**RLTP-ACC-3290** — Every `prev` reference of a non-genesis
operation MUST resolve to a valid operation of the same group.

**RLTP-ACC-3295** — A non-genesis operation's policy proof MUST
satisfy the applicable rule, or rules (4.1), of *S*'s policy
against *S*'s policy currency — the members of *S* excluding
pending exits (5.4) — except as RLTP-ACC-3300 to RLTP-ACC-3310
state.

**RLTP-ACC-3300** — `member.leave`, `service-identity.announce`,
`device.add`, and a `device.revoke` whose subject is the author
MUST be valid with the author's own signature alone.

**RLTP-ACC-3305** — A leave-discharging `epoch.rotate` and the
last-member and drained `group.dissolve` MUST be valid with any
single entitled signature, whatever the policy says.

**RLTP-ACC-3310** — For the leave discharge, the drained dissolve,
and, under `linear/0.1`, `lineage.repair` (9.4.1), the rule
MUST be evaluated against the members of *S* including pending
exits.

**RLTP-ACC-3315** — An operation's eligible signers are the members
of *S* including pending exits, plus its `body.subject` where it
has one; the genesis, which has no ancestors, has exactly the group
DID key and the founder's anchor.

**RLTP-ACC-3320** — A non-genesis operation's body MUST pass
operation-specific validation (Sections 4 to 8), including
post-state validation at its declared position: anti-deadlock
(4.4), the key port's coverage of the retained members (Section
9.2), and no narrowing without a key operation (Section 7).

*Rationale.* Authority comes only from the policy at the
operation's position. Leaving and binding one's own service
identity or device must never depend on others, and neither must
revoking one's own lost device. A policy that could block the
discharge or the ending of a group would hold its members hostage.
The operations a pending exit may author are judged against the
set that includes pending exits, so the same gate that permits
their authorship accepts their signatures. The eligible set is a
superset of every signer any validity path can count — the
currency, the self-authorized author, the pending-exit exceptions,
the genesis pair — and stays Sybil-bounded, because membership of
the ancestor state cannot be minted. Post-state checks prevent
dead ends: a state no policy change can leave, a narrowing that
skips its key operation, or a key operation whose new secret does
not reach exactly the members it must reach.

**RLTP-ACC-3325** — Validity MUST be judged against the operation's
ancestor closure and nothing else.

**RLTP-ACC-3330** — Whether a valid operation takes effect in a
merged materialization MUST be decided only by the closed set of
outcome rules of Section 3.6.

*Rationale.* Validity that depended on branches arriving later
would never be final. An open list of exceptions to an operation's
effect is the seed of a suppression cascade; the outcome rules are
closed and named.

### 3.5 Materialization

**RLTP-ACC-3335** — Materialization MUST be deterministic.

**RLTP-ACC-3340** — Materialization MUST fold, repeatedly, the
operation with the smallest `id` among the not-yet-folded
operations all of whose ancestors have been folded (the ready
set), comparing the complete `oid:` strings' ASCII bytes unsigned
and bytewise, without locale or decoding.

*Rationale.* Non-deterministic materialization splits replicas
without any attacker. A pairwise rule "concurrent operations in id
order" is not a linearization: causality between two operations
plus id comparisons against a third concurrent one can demand a
cycle. The ready-set rule is a total, causality-respecting
linearization of any DAG, and "fold position" everywhere in this
document means position in exactly this linearization.

**RLTP-ACC-3345** — An operation caught by an outcome rule of
Section 3.6 MUST remain valid and MUST confer no effect in that
materialization.

**RLTP-ACC-3350** — Canonicality, including terminality (5.4), MUST
be computed over the full materialization at hand, identically on
every replica holding the same DAG.

**RLTP-ACC-3355** — A later-merged concurrent branch MUST NOT change
the effect of an operation other than through the outcome rules
that Section 3.6 lists.

**RLTP-ACC-3360** — Concurrent admissions of the same subject MUST
NOT void one another.

**RLTP-ACC-3365** — Materialization MUST yield exactly one of: a
group state, the terminal state (5.4), or the forked state (Section
3.6).

*Rationale.* Validity and effect are separate: a merge never
re-judges an operation at its position, it only decides what the
operation confers in the merged state. Same data, same verdict.
What a later branch can change is closed and listed in Section 3.6
— the remaining fork pairing, a dissolution lapsing beside an
enforcement or prevailing over additive operations, the removal
disposition, a removal with authority taking effect,
and the revision of a terminality-by-emptiness verdict (5.4) —
and nothing else; an open list would let a merge revoke an
admission whose welcome was already delivered. Same-subject
admission concurrency is idempotent (5.3): a rule that voided the
"losing" admission would strand its valid descendants under a
voided ancestor. The three outcomes are a closed result set, each
a deterministic function of the DAG.

**RLTP-ACC-3370** — An operation received as a signal, including a
trust task, MUST NOT change materialized state on receipt.

**RLTP-ACC-3375** — A received signal MAY create durable pending
records and provisional UX only if it is valid against local
state.

**RLTP-ACC-3380** — Signal disposition MUST be a deterministic
function of the operation, the local state, and the existing
pending state.

*Rationale.* Delivery is not a path to canonicality; the merged log
decides. An invalid signal must leave no trace in storage or UX.
Equal inputs must be handled equally on every replica.


### 3.6 Concurrency: the conflict matrix

*In plain terms.* Two members can change the group at the same
time without knowing of each other. When their branches meet,
every replica must reach the same answer about who is a member
and which operations count. This section gives that answer. The
one principle behind it: first decide, for every operation, who
had the authority to make it; only then ask what happens when two
authorized operations collide. An authorized removal always
holds. What an authorized removal takes away from the removed
member is only what they added at the same time. Two things
cannot be merged by any rule and stops the group until a member
decides: a change of the group's rules concurrent with an
enforcement. A dissolution concurrent with an enforcement simply
lapses and is issued again.

**Classes.** Operations divide into **additive** operations (no
epoch effect), **enforcement** operations (they carry an epoch
transition, 4.5), and **terminal** operations (`group.dissolve`,
including the last-member leave, 5.4).

**RLTP-ACC-3420** — Every operation MUST belong to exactly one
class — additive, enforcement or terminal — and concurrent
branches MUST merge by the class rules and the matrix of defined
pairings of this section.

**RLTP-ACC-3385** — Materialization MUST determine each
operation's authority from its valid ancestors before any
concurrency rule of this section applies, and the concurrency
rules MUST take no input other than that authority verdict.

**RLTP-ACC-3390** — A removal without authority at its position
MUST NOT dispose of, suppress or displace any concurrent
operation.

*Rationale.* Validity is position-local (3.4): whether an author
was entitled is decided by the operation's own ancestors and by
nothing that happened beside it. If concurrency rules were allowed
to consume unauthorized operations, a member without authority
could remove an administrator and thereby make the
administrator's concurrent admission of a third person vanish; no
signature forgery is needed for that, only a removal nobody was
entitled to issue. Deciding authority first, and letting only
authorized operations into the concurrency rules, closes that
path (the S4f and the unauthorized-removal scenarios of the
conformance vectors).

**Class rules.**

**RLTP-ACC-3425** — Concurrent additive operations MUST both take
effect, with set-valued state merging by union.

**RLTP-ACC-3430** — A scalar field contested by concurrent
additive operations MUST take the value folded last under 3.5's
order.

**RLTP-ACC-3435** — An additive and a concurrent enforcement
operation MUST both take effect, the enforcement side prevailing
where they conflict about authority.

**RLTP-ACC-3395** — A removal with authority at its position MUST
take effect in every merged materialization containing it, even
when a concurrent removal removes its author.

**RLTP-ACC-3405** — Two concurrent removals with authority of
different subjects MUST both take effect.

**RLTP-ACC-3410** — Two concurrent removals with authority, each
removing the other's author, MUST both take effect, so that both
subjects leave.

**RLTP-ACC-3415** — A removal and a concurrent `epoch.rotate`
MUST both take effect, with the key port merging their epoch
secrets (9.2, KV6).

**RLTP-ACC-3417** — Two concurrent `epoch.rotate` operations MUST
both take effect, with the key port merging their epoch secrets.

**RLTP-ACC-3418** — Two concurrent enforcement operations other
than a `policy.change` or a terminal operation — removals,
rotations, `device.revoke`, `visibility.change`, `document.detach`
in any combination — MUST both take effect where their authority
verdicts allow, the key port merging their epoch secrets.

**RLTP-ACC-3400** — Of a removed subject's concurrent operations,
only its additive operations and the admissions it caused MUST
lapse under the removal disposition below; its concurrent
removals with authority MUST NOT lapse.

*Rationale.* Two administrators removing two different people
while apart is the ordinary case of a group that works offline,
not an exception. Treating it as a fork would stop the group
exactly when it is doing what it is for. Both removals are
decisions the group's rules allowed at the moment each was made;
materializing both is what the rules say, and merging the two
resulting epoch secrets is the key port's duty (KV6), so no
removed member reads on (S4b). When two administrators remove
each other, there is no honest way to pick one: either choice
hands the group to whichever side wins a tie-break that neither
side consented to, and a tie-break over operation identifiers is
grindable by the party that wants to win. Both leave; the
remaining members carry the group on (S4c). The same reasoning
extends to chains: if A removes B while B removes C, B's removal
was authorized when B issued it, and letting it lapse because A
removed B concurrently would let the order in which removals
happen to be merged decide whether C stays. What a removal takes
from its subject is the subject's power to add — members, and
operations that confer standing — never the enforcement the
subject was entitled to make. A rotation beside a removal is the
same case with one secret fewer to argue about (S4d).

**The remaining fork pairing.**

**RLTP-ACC-3495** — A `policy.change` and a concurrent enforcement
operation, another `policy.change` included, MUST produce the
forked state.

**RLTP-ACC-3460** — A `group.dissolve` concurrent with a canonical
enforcement operation, a `policy.change` included, MUST lapse: the
enforcement takes effect, the merged state is not terminal, and a
dissolution of the merged state requires a new `group.dissolve`;
the last-member leave and the drained dissolve of 5.4 are
dissolutions for this rule.

**RLTP-ACC-3440** — In the forked state an operation building on
either fork sibling MUST NOT be canonical, and every authorization
answer MUST be fail-closed.

**RLTP-ACC-3445** — The forked state MUST be surfaced to the
members.

**RLTP-ACC-3450** — Evidence of fork siblings and disposed
operations MUST keep travelling to the replicas entitled to it.

**RLTP-ACC-3455** — A service of class `view` MUST reach its
fail-closed state for a forked group through the view freshness
bound and the divergence obligations of 7.3 alone; a service of
class `log` reaches it by its own materialization.

**RLTP-ACC-3565** — The forked state MUST end exactly when a
`policy.change` whose ancestry contains both siblings is valid as
the resolving operation: it MUST be validated against the state
materialized from the maximal prefix free of the fork pairing — its
members, policy and policy version — its `policyVersion` MUST be
that prefix's version plus one, its `newEpoch` follows
RLTP-ACC-7040 over its whole ancestry, its author MUST NOT be the
subject of a removal on either sibling, and RLTP-ACC-3440 MUST NOT
apply to it.

**RLTP-ACC-3566** — The maximal prefix free of a fork pairing MUST
be the maximal causally closed sub-DAG of the accepted entries that
contains no member of the pairing and no descendant of a member;
for a pairing P → {T₁, T₂} it is exactly the closure of P.

**RLTP-ACC-3567** — After the forked state ends, the materialization
MUST be re-derived over the reconciled DAG by the ordinary rules of
this section: the siblings' policy effects MUST lapse, their epoch
transitions and other effects and every operation building on them
take effect in 3.5's order where their authority verdict allows,
and the resolving `policy.change` folds last and sets the policy.

**RLTP-ACC-3569** — An operation whose authority effect lapses under
RLTP-ACC-3460 or RLTP-ACC-3567 MUST carry the status `lapsed`: it
remains valid at its position, its epoch transition, if any,
counts for RLTP-ACC-7040 and for the key port, and it confers no
other effect.

**RLTP-ACC-3568** — While the forked state lasts, every operation
building on either sibling MUST carry the status `forked`, and a
removal carrying that status MUST NOT seed the removal
disposition.

*Rationale.* A policy change is a claim about which rule decides
all later claims. Two concurrent ones cannot be raced: the rule
that would pick a winner is itself what is in dispute, and a
deterministic tie-break over malleable fields would let one
administrator rewrite the constitution by regenerating an
identifier until it sorts last. The group therefore stops changing
membership and keys until a member writes a policy change that
descends from both siblings, which is a decision about the
conflict made in the open and signed. That resolving operation is
judged against the last state everyone agreed on, the prefix below
the fork, because the forked branches have no agreed state to judge
it against; it cannot itself be caught by the fork it ends, or no
fork would ever end. Once it stands, the siblings are ordinary
operations again: a removal one of them carried takes effect, the
rival policies lapse and the resolving policy is the one in force.
A dissolution is different from a policy change: it costs nothing
to lapse, because whoever meant it issues it again over the merged
state, while a lapsed removal or rotation would undo an
enforcement someone had authority for. So the dissolution yields,
always to the same side, and nobody loses more than a second
signature. Content keeps flowing in the forked state; only
authorization answers fail closed. A malicious authorized member
can force this state; that is denial of service by an insider
against their own group, fail-closed and attributable, never an
authority gain.

**RLTP-ACC-3465** — A terminal operation and a concurrent additive
operation MUST yield the terminal state, except that a canonical
`member.add` keeps alive a group whose terminal outcome arose from
emptiness.

**RLTP-ACC-3470** — A canonical `group.dissolve` MUST prevail over
every concurrent additive operation.

**Matrix of defined pairings.**

**RLTP-ACC-3475** — Concurrent admissions of the same subject MUST
be idempotent, each consuming the accept it encloses, none voided
and none distinguished (5.3).

**RLTP-ACC-3480** — An admission and a concurrent additive
operation about a different subject MUST merge by union.

**RLTP-ACC-3485** — A removal with authority of X MUST prevail over
a concurrent admission of X, and that admission's accept MUST
count as consumed; re-admission needs fresh consent.

**RLTP-ACC-3490** — A subject admitted concurrently with an epoch
transition MUST be a member of the merged state, and the key port
MUST bring it into the new epoch (healing, RLTP-ACC-9320).

**RLTP-ACC-3500** — A leave concurrent with an epoch transition
MUST merge, discharged only if the transition's ancestry contains
it (7.1); an undischarged merged leave keeps its obligation.

**RLTP-ACC-3505** — A leave and a concurrent removal of the same
subject MUST both end the membership, the removal's transition
governing.

**RLTP-ACC-3510** — Concurrent leaves of different subjects MUST
both merge, with obligations and emptiness per 5.4.

**RLTP-ACC-3515** — A `service-identity.announce` and a concurrent
additive operation MUST merge by union, the per-anchor key taking
the value folded last and first-bound-wins across anchors per 5.2.

| Concurrent pairing | Merge rule |
|---|---|
| `member.add` ∥ `member.add`, same subject | idempotent (RLTP-ACC-3475) |
| `member.add` ∥ additive op, different subjects | union (RLTP-ACC-3480) |
| `member.add` of X ∥ `member.remove` of X | the removal prevails; accept consumed (RLTP-ACC-3485) |
| `member.add` ∥ epoch transition | member of the merged state; the key port heals it in (RLTP-ACC-3490) |
| `member.remove` ∥ `member.remove`, different subjects | both take effect (RLTP-ACC-3405) |
| `member.remove` ∥ `member.remove`, each removing the other's author | both take effect (RLTP-ACC-3410) |
| `member.remove` ∥ `epoch.rotate` | both take effect; secrets merged (RLTP-ACC-3415) |
| `epoch.rotate` ∥ `epoch.rotate` | both take effect; secrets merged (RLTP-ACC-3417) |
| other enforcement ∥ enforcement (`device.revoke`, `visibility.change`, `document.detach`, in any combination with removals and rotations) | both take effect; secrets merged (RLTP-ACC-3418) |
| `policy.change` ∥ any enforcement operation | forked state (RLTP-ACC-3495) |
| `group.dissolve` ∥ enforcement operation | the dissolution lapses; the enforcement takes effect (RLTP-ACC-3460) |
| terminal ∥ additive | terminal, with the emptiness exception (RLTP-ACC-3465, 3470) |
| `member.leave` ∥ epoch transition | merges; discharged iff in the transition's ancestry (RLTP-ACC-3500) |
| `member.leave` ∥ `member.remove`, same subject | gone either way; the removal's transition governs (RLTP-ACC-3505) |
| `member.leave` ∥ `member.leave` | both merge (RLTP-ACC-3510) |
| `service-identity.announce` ∥ additive | union; folded-last per anchor (RLTP-ACC-3515) |

*Rationale.* Every pairing in the table is decided by the
authority verdict of its two sides and by nothing else: additive
beside additive is union, enforcement beside additive is the
enforcement doing its job on a genuine member of its ancestry,
enforcement beside enforcement is both doing their job with the
key port merging the result, a dissolution yields to any
enforcement because it can be repeated at no cost, and only the
constitutional pairing has no merge. Unlisted additive pairings merge by union.
The table contains no arbitration about who belongs.

**The removal disposition over concurrent authorship.**

**RLTP-ACC-3520** — A removal with authority MUST dispose the
operations listed in RLTP-ACC-3525 to RLTP-ACC-3540 as
`removed-disposed`, a whole-DAG disposition computed over the
merged materialization, without revising their position-local
validity or proof evaluation.

**RLTP-ACC-3525** — The removal disposition MUST include every
concurrent additive operation authored by the removed subject.

**RLTP-ACC-3530** — The removal disposition MUST include every
concurrent admission whose consumed accept encloses an invite the
removed subject issued.

**RLTP-ACC-3535** — The removal disposition MUST include every
concurrent additive operation whose proof does not satisfy its
rule without the removed subject's signatures, as a disposition
and not as a proof shortfall.

**RLTP-ACC-3540** — The removal disposition MUST be closed
transitively over admissions by, and additive operations of,
subjects whose own admission it disposes.

**RLTP-ACC-3545** — The subject of a disposed admission MUST NOT
be a member of the merged state through that admission, and its
accept MUST count as consumed; a concurrent canonical admission of
the same subject keeps the subject a member (RLTP-ACC-3475,
RLTP-ACC-3572).

**RLTP-ACC-3550** — The removal disposition MUST be recomputed over
the whole DAG on merge without re-validating any operation.

*Rationale.* A member who is being removed must not be able to
leave behind a trail of concurrent admissions and grants that
outlive the removal: without this disposition the removed member
could place a `member.add` of a puppet beside their own removal and
regain the next epoch's keys through the puppet (S4f). What is
disposed is exactly the removed subject's additive reach, directly
and through the people it admitted; its concurrent removals with
authority stand (RLTP-ACC-3400). Nothing is re-validated: at its
position every disposed operation was and remains valid, so the
disposition is a property of the merged DAG and recomputes
identically on every replica.

**RLTP-ACC-3555** — Rule RLTP-ACC-3535 MUST be evaluated against
the policy version at the operation's position and its current
merged proof, setting aside exactly the removed subject's
signatures and proof material, on every change of that proof.

**RLTP-ACC-3560** — A `removed-disposed` operation under
RLTP-ACC-3535 MUST become `canonical` when its merged proof
satisfies the position's policy without the removed subject.

**RLTP-ACC-3570** — The transitive disposition MUST be computed as
the least fixpoint of the operator seeded by RLTP-ACC-3525 to
RLTP-ACC-3535 whose step adds the admissions and additive
operations of admission-orphaned issuers.

**RLTP-ACC-3572** — An issuer MUST count as admission-orphaned at an
artifact exactly when every admission that carries the issuer's
membership at that artifact's causal position lies in the
disposition set; one surviving legitimizing admission keeps the
issuer, and everything it issued, out of the transitive step.

**RLTP-ACC-3575** — The genesis MUST NOT be disposable by the
transitive disposition.

**RLTP-ACC-3580** — The removal-disposition set MUST be one least
fixpoint over the union of the seeds of all removals with
authority, with authority re-determined in every round of the
computation and every operation re-examined in every round.

**RLTP-ACC-3585** — Only admissions carrying an issuer's membership
at an artifact's causal position MUST count as legitimizing that
artifact.

**RLTP-ACC-3590** — A healing under RLTP-ACC-3560 MUST re-run the
fixpoint computation.

**RLTP-ACC-3595** — A healing duty of the key port (RLTP-ACC-9320)
MUST bind only for canonical admissions whose subject is a member
of the final materialization; a `removed-disposed` admission
disposes its open duties non-effectingly.

*Rationale.* The fixpoint is what makes the disposition
deterministic and terminating: its step only adds identifiers, so
on a finite DAG it stops, and two replicas holding the same DAG
compute the same set. Seeding it from all authorized removals
jointly matters because two removals may each dispose one of an
issuer's admissions and only together orphan the issuer. Authority
is re-determined in every round because an operation excluded in
one round may owe its exclusion to a removal that a later round
finds unauthorized; a computation that never re-examined excluded
operations would let an unauthorized removal suppress an
authorized admission for good. Causal binding of legitimization
closes the time machine: a re-admission later never heals an
earlier puppet act. The genesis is its own root; a founder is
reached only by an explicit removal.

**The send-point recheck of every key-bearing duty.**

**RLTP-ACC-3600** — Every key-bearing duty MUST serialize
production, the final entitlement recheck and the send handoff
under one materialization-generation token that advances
monotonically and is never reused while a handoff is open, and
that advances with every authorization-relevant change of the
helper's materialization: canonical application, any disposition
change, membership change, epoch change and terminality.

**RLTP-ACC-3605** — At production, the helper MUST verify that the
recipient is a current member of the token's snapshot, that the
admission entitling them is canonical, and that no
membership-ending operation lies in that snapshot's ancestry for
them, and MUST bind the material to exactly that snapshot's epoch.

**RLTP-ACC-3610** — At the send handoff, the helper MUST re-read the
token atomically with the handoff and, if it changed, discard the
material and re-evaluate the slot against the new generation.

**RLTP-ACC-3615** — A membership-ending operation MUST dispose every
open healing duty and key-service slot for its subject
non-effectingly.

**RLTP-ACC-3620** — The normative entitlement check for a
key-bearing duty MUST be the recheck at the send point, never a
check at request receipt alone.

*Rationale.* Between the moment a helper decides that someone is
entitled to a key and the moment the key irreversibly leaves, the
materialization can change: a removal arrives, a disposition flips,
an epoch moves. A key sent on a stale decision reaches a former
member. The token closes that window without a lock on the log:
whatever changed the answer also changed the token, and a handoff
that sees a changed token starts over. A slot is never discharged
to a former member, so no welcome is ever issued from a decision the
group has not kept.

**The total disposition order.**

**RLTP-ACC-3562** — Where an operation is both a fork-sibling
descendant and in the removal-disposition set, its disposition
MUST be the greatest under the order `forked` ≻
`removed-disposed` ≻ `lapsed` ≻ `canonical`, and transitions MUST
be closed under that order.

*Rationale.* One operation can fall under two outcome rules at
once. A total order over the outcomes keeps the answer single and
the same everywhere.


**Evidence transport.** Entries that are admitted but not
canonically applicable are the fork siblings of the remaining fork
pairing (RLTP-ACC-3495) with their descendants, the lapsed
operations (RLTP-ACC-3569), and the operations under the removal
disposition. They travel as
evidence under an authorization of their own.

**RLTP-ACC-3625** — Admitted but non-canonical entries MUST
continue to replicate as non-effecting evidence.

**RLTP-ACC-3630** — The peers entitled to evidence MUST be the
members of the materialization of the maximal prefix free of the
remaining fork pairing; where no fork exists, removals and the
removal disposition included, they MUST be the current members.

**RLTP-ACC-3635** — An item causally newer than a peer's removal
within that prefix MUST NOT travel to that peer, evidence
included (5.3).

**RLTP-ACC-3640** — Fail-closed answers MUST govern authority,
reads and writes, and MUST NOT govern the evidence plane.

*Rationale.* Fork and disposition evidence is needed by every
replica exactly when the group is in trouble; if the fork's
fail-closed answers also closed the evidence plane, the evidence
would reach nobody, and divergence would stay silent. Defining the
entitled peers by the prefix below the fork keeps the forked state
from starving its own cure. A removal draws the opposite line: a
removed peer receives nothing causally new after its removal, or
evidence would become a back door to read on. Transport is not
authority: commit-before-forward (5.3) gates forwarding as
authority, never the travel of proof, and the replication
contract's send set runs on this admitted closure. RLTP-ACC-9500
(9.3) states the same rule for services: a service never gates the
transport of authority operations, whoever authored them.

**The evidence session.** Two replicas whose current heads are
fail-closed still need to exchange evidence. They do so in a
bilateral session judged against a presented prefix claim instead
of the current head. The *conflict DAG* of an exchange is the union
of the ancestor closures of the evidence root and of every conflict
artifact of the exchange: for a disputed transition, both fork
siblings; for a disposed operation, the operation and its disposing
removal; for a target root, the closure of the target's frontier
heads (a target is no authority entry; its domain is its attested
closure).

**RLTP-ACC-3645** — Two replicas MAY establish an evidence session,
authenticated by the ordinary challenge-possession mechanism and
judged against a presented prefix claim instead of the current
head, for evidence of the removal disposition, of the remaining
fork pairing, and of service and replica target roots.

**RLTP-ACC-3650** — An evidence session MUST open with exactly one
canonical prefix claim, `rltp-access-evidence-claim/1`; no other
claim form exists.

**RLTP-ACC-3655** — The claimed prefix MUST be computed over the
conflict DAG of the exchange.

**RLTP-ACC-3660** — A verifier holding conflict artifacts missing
from a claim's set MUST answer, before granting any standing, with
`rltp-access-evidence-supplement/1`, its `body` carrying the
complete verifier-side conflict set and the `snapshotDigest`.

**RLTP-ACC-3665** — `snapshotDigest` MUST be the multihash over the
JCS array of the sorted operation-ids of the conflict-relevant
projection: for authority roots, every fork sibling and disposition
cause the verifier holds for the named root, with their authority
ancestor closures; for target roots the same construction, targets
entering by the digest of their sig-less target signature input
and registrations exclusively by their `registrationCoreDigest`.

**RLTP-ACC-3670** — After a supplement the initiator MUST issue
exactly one fresh claim over the union, and a supplement or claim
against a changed projection MUST yield `superseded-snapshot`.

*Rationale.* The root's own closure cannot see its sibling, which
is why the domain is the conflict DAG and not the root closure.
Completeness is enforced by the verifier, never chosen by the
initiator: an initiator selecting its own conflict set would leave
out the branch that defeats it, just as a merge base is computed
from the repository and not from the requester's selection. The
supplement makes that enforcement a closed wire step. The snapshot
is a projection, not the whole DAG, so a change outside the
projection never supersedes a turn; a registration enters only by
its core digest, because one registration must never yield two
projection identities. One fresh claim over the union ends the
exchange of sets; anything more would be a loop.

**RLTP-ACC-3675** — An evidence session MUST end in exactly one of
the results `standing-granted`, `invalid-bundle`,
`superseded-snapshot` (retriable) or `evidence-saturated`; response
variants such as `unknown-baseline` and `missing-registration-core`
MUST occur only inside a response body, never as a session result.

**RLTP-ACC-3680** — An exchange MUST carry at most 16 parts and 4096
artifacts in total; past the cap it MUST end
`evidence-saturated`, and any retry MUST be a new transcript.

**RLTP-ACC-3685** — A bundle whose conflict set is incomplete
relative to the answering verifier's snapshot MUST be rejected as
invalid as a whole.

*Rationale.* A closed result set lets both sides and the
conformance vectors agree on how every exchange ended. The caps
bound what an exchange can cost a verifier in memory and work. An
initiator cannot regain standing by omitting the branch that
defeats it, and invented siblings convict themselves at admission,
because only valid enforcement artifacts count.

**RLTP-ACC-3690** — Over the conflict DAG the claimed prefix MUST
be the maximal causally closed sub-DAG of accepted entries
containing no member of any fork-sibling pair of the full conflict
DAG and no descendant of such a member, the pairs being judged
over the whole conflict DAG.

**RLTP-ACC-3695** — A claim MUST bind the root, the complete
conflict artifact set (after supplementation, the union) and the
resulting prefix frontier in one digest.

**RLTP-ACC-3700** — An older prefix MUST NOT suffice to claim
standing for a later root.

**RLTP-ACC-3705** — Claim, evidence request and whatever claim
closure the verifier lacks MUST travel and be verified as one
atomic bundle, and session standing of any kind MUST NOT exist
before the whole bundle verifies.

*Rationale.* A lone branch tip is not "pair-free": for P → {T₁, T₂}
the prefix is exactly P, never a branch tip, and only the conflict
DAG shows both siblings. Binding root, set and frontier in one
digest prevents swapping any one of them. Under a removal the
conflict DAG contains the removal, so a removed member belongs to
no claimable prefix for any later root, and a claim to a prefix
before the removal does not reopen the past. For a genuinely
disputed sibling the prefix ends below the fork and the
counter-vector stands: B holds P → T₁ removing A, A holds
P → {T₁, T₂} and claims P for root T₂; B accepts and receives T₂.
A verifier missing closure verifies it from the bundle; granting
first and checking later would be standing on credit.

**RLTP-ACC-3710** — An evidence session MUST carry only one request
type, the evidence request, answered by the total response
function `evidenceResponse(root)`.

**RLTP-ACC-3715** — `evidenceResponse(root)` MUST return, per root
kind and baseline, exactly the response of the following table,
including its closed variants.

| Root | Response |
|---|---|
| disputed transition (`rootKind` `"transition"`), a fork sibling of the remaining fork pairing | both siblings |
| disposed operation (`"disposition"`) | the operation and the removal that disposes it |
| replica target (`"target"`, `admitted` scope; no chain, no generation) | the current in-session span, root and baseline of the same session: baseline `null` → the full root-session span back to seq 1; a known same-session ancestor of the root → the span down to it; a foreign or unknown session, or a known same-session non-ancestor → the variant `foreign-session-baseline` or `non-ancestor-baseline`, answered with the full root-session span |
| service target (`"target"`, `stored` scope) | the target chain from the named target back to `lastKnownTargetDigest` (`digest \| null`): `null` → back to the chain's `seq = 1`; a non-ancestor or foreign-generation digest → the variant `unknown-baseline`, answered with the full chain of the current generation; a chain restart inside the span → back to the restart marker, which carries its own continuity statement |

**RLTP-ACC-3720** — A response for a service chain MUST include the
full registration artifact of every generation a returned target
commits to, deduplicated and ordered by `registrationGeneration`,
each g+1 registration accompanied by its authorization-root view
and the recursive view-dependency closure down to evidence the
verifier already holds verified (a held skeleton entry, the anchor
or the seq-0 root).

**RLTP-ACC-3725** — A service MUST retain, or reproducibly serve,
that registration closure for as long as it holds targets of the
generation, the closure counting against the response bounds.

**RLTP-ACC-3730** — A service that conformantly cannot serve that
closure MUST answer with the closed variant
`missing-registration-authorization-evidence`.

**RLTP-ACC-3735** — Each received registration MUST match the
returned targets' core digests and signature chain, and a response
that cannot supply a committed generation MUST be the closed
outcome `missing-registration-core`.

**RLTP-ACC-3740** — A service MUST retain the full registration
artifact of every generation whose targets it still holds (7.3).

**RLTP-ACC-3745** — In every authority variant the response closure
MUST be the union of the authority ancestor closures of every
returned artifact.

*Rationale.* A total function has no gap for an initiator to
exploit: every root and every baseline has exactly one answer,
including the answer that the baseline is unknown. A single
request type keeps the session from becoming a door to general
reads. A digest is a commitment, not a verification root:
historical targets verify against their own generation, not the
serving one, and without the registration and its view closure the
effective `m` and the signers' membership cannot be checked, so the
registration would be no root at all; standing also needs the
verifier's own session anchor and the `previousRegistration` chain
into it (7.3), or the bundle is `invalid-bundle`. A sole-tip view
alone suffices only where its parent chain is already held
verified. A closure the service cannot serve is named, never a
silently unverifiable root. A conflict artifact whose authorization
path the verifier cannot check is worthless, so the sibling and the
disposing removal bring their own branch-specific authority chains.

**Transcript profile.** The session has four closed artifacts:
`rltp-access-evidence-claim/1`, `rltp-access-evidence-request/1`,
`rltp-access-evidence-response/1` and
`rltp-access-evidence-supplement/1`. Their one signature input is
the JCS serialization of `{ "v", "genesisDigest", "session",
"challenge", "initiator", "responder", "rootKind": "transition" |
"disposition" | "target", "evidenceRoot", "prefixFrontier", "body" }`
with `sig` omitted.

**RLTP-ACC-3750** — The four evidence artifacts MUST be closed and
versioned and MUST share the one signature input form above.

**RLTP-ACC-3752** — Every evidence artifact MUST carry and bind both
`initiator` and `responder`.

**RLTP-ACC-3754** — Every evidence artifact MUST be signed by the
issuing side's session principal.

**RLTP-ACC-3756** — Every evidence artifact MUST carry the `body`
of the following table.

| Artifact | `body` |
|---|---|
| `rltp-access-evidence-claim/1` | the complete conflict-set digest and, where a supplement preceded, the supplement's snapshot digest |
| `rltp-access-evidence-request/1` | the variant parameters: for targets `lastKnownTargetDigest: digest \| null` and, where registration closures are expected, the view cursor `lastKnownAuthorizationViewDigest: digest \| null` (a held ancestor view → only the missing suffix is served; unknown or non-ancestor → the closed variant `unknown-view-cursor`, answered with the closure from the seq-0 root or the last shared anchor) |
| `rltp-access-evidence-response/1` | the artifact-list digest |
| `rltp-access-evidence-supplement/1` | the complete verifier-side conflict set and the `snapshotDigest` |

**RLTP-ACC-3755** — A bundle MUST carry at most 256 artifacts; a
longer exchange MUST continue under one transcript of parts
numbered 1..n, each in the part envelope of the following table.

| Field | Content |
|---|---|
| `v` | `"rltp-access-evidence-part/1"` |
| `transcriptId` | the transcript's identifier |
| `part` | the part number, 1..n |
| `prevPartDigest` | the previous part's `partDigest`; null iff `part` = 1 |
| `artifacts` | the part's artifacts |
| `final` | true on the last part only |
| `count` | the total number of parts; final part only |
| `transcriptDigest` | final part only |
| `sig` | over the full envelope, `transcriptDigest` included |

**RLTP-ACC-3760** — `partDigest` MUST be the multihash over the JCS
serialization of the part envelope with `sig` omitted and, on the
final part, `transcriptDigest` omitted; `transcriptDigest` MUST be
the multihash over the JCS array of all part digests in order
1..n.

**RLTP-ACC-3765** — Standing of any kind MUST NOT exist until the
final part's `transcriptDigest` verifies over the complete
sequence.

*Rationale.* One signature input for all four artifacts means no
artifact can be reinterpreted as another, and binding both
parties in each, the supplement included, keeps an artifact from
being moved into a different session. The bundle limit follows
the `closureBound` pattern of 7.3. Omitting `transcriptDigest`
from the final part's own digest is the one exception that avoids
hash recursion. Truncation, reordering, duplication and a false
final all leave the exchange without standing; the vectors of
Section 14 check each. The artifacts and the part envelope are
normative as JCS field sets; Section 11 names them as the
profile's session-plane forms.

**RLTP-ACC-3770** — View artifacts fully verified inside a
transcript MUST be admitted into the verifier's view-evidence DAG
(7.3, under its quotas and compaction) whatever the transcript's
outcome.

**RLTP-ACC-3775** — An evidence session MUST NOT serve anything
outside `evidenceResponse(root)`: no unqualified frontier
difference, no authority standing, no general content read or
write, no eviction effect; the ordinary current-head session rule
governs everything else.

**RLTP-ACC-3780** — Every receiver MUST run its own admission over
transported evidence, and transport MUST NOT assert canonicality
or trigger effect.

*Rationale.* Evidence standing is withheld when a transcript
fails, but view knowledge is never discarded: each retry roots in
a farther verified anchor, and a closure over the cap shrinks with
every attempt instead of saturating forever. A session that served
anything beyond its response function would be a back door to
content or authority for a replica whose head is fail-closed.
Every receiver reaches the same disposition on its own, so the
carrier of evidence decides nothing.

**Post-merge validation.**

**RLTP-ACC-3785** — After folding concurrent branches, the
materializer MUST validate the merged state.

**RLTP-ACC-3790** — After a merge, the key port MUST satisfy KV2
against the merged retained set (RLTP-ACC-9250): every new epoch
secret reaches exactly that set.

*Rationale.* Two removals with authority, each valid at its
position, compute their retained sets without each other; the
merged state removes both subjects, and a key structure that
honoured only one retained set would let the other removed member
read on (S4b) or leave a remaining member without the secret. The
check is therefore against the merged set, not against each
operation's position. How a key adapter shows it is the adapter's
form; under `linear/0.1` it is the equality of the `keyDist`
recipient set and the computed retained set (RLTP-ACC-9700).

**RLTP-ACC-3795** — An admission canonical at its position MUST
NOT be suppressed, displaced, deferred or revised by any merge rule
other than the removal disposition; short of that disposition,
its subject is a member of every merged materialization containing
it.

**RLTP-ACC-3800** — A merged materialization MAY exceed the 4096
admission bound.

**RLTP-ACC-3805** — Membership-scaled wire fields (proofs, key
material, view `identities`) MUST accept up to 8192 entries, twice
the admission bound, as denial-of-service ceilings and not group
bounds.

**RLTP-ACC-3810** — Beyond 8192 entries of a membership-scaled
field — members for views, bound devices for a per-device key
distribution — operations whose artifacts scale with it MUST fail
closed at construction, membership itself untouched.

**RLTP-ACC-3815** — `member.leave` and `group.dissolve`, and
additive operations whose artifacts do not scale with membership,
MUST remain constructible in that degraded state.

*Rationale.* The group bound of admission rule 0 is position-local
(RLTP-ACC-5410), so two admissions of different subjects, each
valid at 4095 members, union to 4097. Repairing that at the merge
would take a rule deciding which valid admission takes effect, and
every such rule (displacement, a queue, a lapse, a fold-order cap)
has the same two defects: it gives an envelope-grinding rival a
say over who belongs in a mixed honest-and-Sybil flood, and it
makes a delivered admission revisable by later merges, retracting
welcomes that were conformantly delivered. Capacity is not a
question of who. The bound therefore has one mechanism, the
position-local freeze; departures shrink the group back under it.
Honest overshoot stays schema-valid under the doubled wire caps.
Past them lies a named degraded state, not a mechanism: recovery
is by attrition, as leaves shrink the next retained set until the
group can rotate, remove and issue views again. Reaching that
state takes *n* disjoint partitions each flooding to the freeze
before any merge, and every admission carries its inviter's
signature, so the flood is attributable inside the group (OI-14).
The residual is stated because every mechanism examined was worse
than the state it prevents. The removal disposition is the one
merge rule that does take an admission back, and only for a
removal with authority (RLTP-ACC-3520).

**Merge-finality.** Validity and effect are functions of the
operation's ancestor closure, and no merge revises them, apart
from the named outcome rules of this section.

**RLTP-ACC-3820** — A merge MUST NOT revise an operation's validity
or effect except through exactly these outcome rules: the remaining
fork pairing (RLTP-ACC-3495), the lapsing dissolution
(RLTP-ACC-3460), the terminal prevail rule (RLTP-ACC-3470), the
enforcement-prevails pairings
(RLTP-ACC-3485, RLTP-ACC-3505), the removal disposition applied
only by removals with authority (RLTP-ACC-3385, RLTP-ACC-3390,
RLTP-ACC-3520), and the terminality-by-emptiness verdict of 5.4.

**RLTP-ACC-3825** — A `policy.change` that a concurrent
`member.leave` renders unsatisfiable MUST NOT be reversed
retroactively, and the resulting stuck state MUST be surfaced to
the members.

*Rationale.* A suppression cascade, re-validating the descendants
of operations a merge has rendered ineffective, is itself a merge
rule that revises membership: an admission would be revoked after
its welcome had been delivered. This section removes the causes
of such a cascade instead of scoping it. A concurrent rival
`policy.change` forces the forked state rather than losing a race,
so no permissive policy can be silently replaced and nothing is
left to park an operation under; an admission sharing its subject
with a concurrent one keeps its effect, so its descendants stand
on ground the merge confirms. None of the outcome rules re-decides
who belongs by arbitration: the forked state is a fail-closed
verdict, not a selection; the terminal rule is an ending; an
authorized removal prevailing over a concurrent additive claim
about the same subject is the enforcement class doing its job; the
removal disposition takes back only what the removed subject added
at the same time, and only under a removal its author was entitled
to make; emptiness is a property of the whole materialization. One
shrinkage channel remains and is named rather than reversed: a
concurrent leave removes its author from the policy currency at
once (5.4), so a `policy.change` satisfiable at its position can
merge into a state where it is unsatisfiable. The group is then
stuck above emptiness (OI-10), with leaves and dissolution always
open; a retroactive reversal would seed exactly the cascade this
section excludes (4.4).

**Remediation duties.**

**RLTP-ACC-3830** — Remediation duties MUST obligate members, never
services.

**RLTP-ACC-3835** — On merging a branch in which a member was
admitted concurrently with an epoch transition, a member holding
the current epoch keys MUST discharge the key port's healing duty
(RLTP-ACC-9320) toward the admitted member as soon as the merge is
materialized; under `linear/0.1` it does so by delivering the
current epoch keys via `key-delivery` (10.1).

**RLTP-ACC-3840** — On merging authorization changes from another
branch, a member of the view quorum MUST issue a fresh
authorization view (7.3).

*Rationale.* Services decide nothing about a group, so a merge's
consequences are carried out by those who can see the merged log.
A member admitted beside an epoch transition is a member of the
merged state (RLTP-ACC-3490) but holds no secret of the new epoch
until the key structure follows the membership; healing closes
that gap, and the membership never follows the key structure. A
service still acting on a view from before the merge serves a set
narrower or wider than the merged log's; a fresh view brings it
back in line.


## 4. Policy

*In plain terms.* Each group writes down its own decision rules:
for every kind of change, how many members — or which ones, or how
many vouches — must sign before it counts. There are no built-in
admins; "one founder decides everything" is just the simplest rule
a group can choose. The rules are checked the same way by every
member, and the rules for changing the rules are guarded so that a
group can never lock itself out of its own constitution.

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

A policy maps **rule keys** to rules. Most rule keys are operation
types; one is an **aspect key**, `history.narrow`, evaluated in
addition to the operation's own rule.

**RLTP-ACC-4010** — A group MUST have a policy from its genesis on.

**RLTP-ACC-4020** — `policyVersion` MUST increase by exactly 1 with
every effective `policy.change`.

**RLTP-ACC-4030** — The rule key `history.narrow` MUST gate the
narrowing act as the key adapter defines it (9.4.1, RLTP-ACC-9790),
in addition to the operation's own rule.

**RLTP-ACC-4040** — A rule key without an explicit rule in the
group's policy MUST evaluate under its registered default from the
table below.

| Rule key | Default rule |
|---|---|
| `member.add` | `any-member` |
| `member.remove` | `strongest` |
| `epoch.rotate` | `any-member` (the leave discharge additionally bypasses policy, 5.4) |
| `policy.change` | `strongest` |
| `visibility.change` | `strongest` |
| `history.expose` | `strongest` |
| `history.narrow` (aspect; `linear/0.1`, 9.4.1) | `strongest` |
| `lineage.repair` (`linear/0.1`, 9.4.1) | `any-member` |
| `document.attach` | `any-member` |
| `document.detach` | `strongest` |
| `device.revoke` (a device of another member) | `strongest` |
| `group.dissolve` (collective path) | `strongest` |

`member.leave`, `service-identity.announce`, `device.add`, and the
revocation of one's own device are self-authorized and have no rule
key (RLTP-ACC-3300); the leave-discharging rotation and the
last-member and drained dissolve are single-signature paths no
policy overrides (RLTP-ACC-3305, 5.4).

**RLTP-ACC-4050** — A newly registered rule key MUST register its
default rule with its definition (Section 11).

**RLTP-ACC-4060** — An operation of an unregistered type MUST be
rejected as invalid.

*Rationale.* Without a policy a group would have no decision rule,
only whoever holds a key. `policyVersion` is half of the replay and
race gate of 3.3. Omitting lineage closes history for every later
member; that is a decision of its own, and a cheap rotation must
not make it on the side. Every operation has a rule even where the
group wrote none; an operation type without a registered default
has nothing to fall back to. Rotation stays cheap because hygiene
must; removing another member's device takes as much as removing a
member, because it cuts someone else's access.

### 4.2 Requirement types

Four requirement types are defined; the set is open (Section 11).

- **`any-member`** — one signature of any identity in the policy
  currency (3.4.2); semantically `threshold` with `k: 1`.
- **`actors`** — `{ "type": "actors", "actors": [did…], "k": n }`:
  signatures of `k` distinct listed identities in the policy
  currency.
- **`threshold`** — `{ "type": "threshold", "k": n }`: signatures
  of `k` distinct identities in the policy currency.
- **`vouch`** — `{ "type": "vouch", "count": n }`: satisfied when
  the operation's subject presents vouches from `n` distinct
  identities in the policy currency. Proof form:
  `encounter-presentation` (4.3; the wire constant keeps its
  registered spelling, and no verification step branches on it).

**RLTP-ACC-4070** — A rule of an unknown requirement type MUST be
treated as unsatisfiable.

**RLTP-ACC-4080** — `any-member` is satisfied by one signature of
any identity in the policy currency.

**RLTP-ACC-4090** — An `actors` rule MUST list a non-empty,
duplicate-free set and have `1 ≤ k ≤ |actors|`.

**RLTP-ACC-4100** — A `threshold` rule MUST have `k ≥ 1` and be
satisfied by `k` distinct currency signatures at the operation's
declared position.

**RLTP-ACC-4110** — A `vouch` rule MUST have an integer `count` with
`1 ≤ n ≤ 16`.

**RLTP-ACC-4120** — A vouch MUST count only if it is a `vouch@2`
(5.3) issued by a currency member about the operation's subject.

**RLTP-ACC-4130** — A verifier MUST evaluate presented vouches only,
without registry resolution.

**RLTP-ACC-4140** — A vouch rule, also inside a composition, MUST be
assigned only to rule keys whose operations have a subject distinct
from the proof's signers; in this catalog, exactly `member.add`.

*Rationale.* Unknown must never permit (Section 11). An `actors`
rule listing nobody, or listing one identity twice, is unsatisfiable
or double-counting. Sixteen is the transported variant proof's
credential cap (5.3); a rule demanding more vouches than any
admission can carry is structurally unsatisfiable. A vouch is the
deliberate human act "I vouch for this admission", made
cryptographic; an Encounter credential is not one, because its
issuer and subject are fresh pair anchors (Encounter 4.4) and can
never meet this rule. A registry lookup would be a dependency and a
point of observation. For an operation without a subject every
vouch set is empty and therefore maximal under the strength order
(4.4), so a vouch rule there would be meaningless.

Rules compose: `{ "type": "all", "of": [rule…] }` and
`{ "type": "any", "of": [rule…] }`, with intersection and union of
their satisfaction sets (4.4).

**RLTP-ACC-4150** — Rules MAY be composed with `all` and `any`.

**RLTP-ACC-4160** — Composition depth MUST NOT exceed 4.

**RLTP-ACC-4170** — The `of` list of a composition MUST be
non-empty.

*Rationale.* Depth bounds the cost of evaluation. An empty `all`
would be the universal requirement, satisfied by anything at zero
cost — an admission gate no member ever agreed to lower — and an
empty `any` is unsatisfiable with an undefined cost; neither is a
rule.

### 4.3 Policy proofs

A proof's material is two sets: the **signer set**, from
`proof.signatures`, each over the envelope serialization (3.3), and
the **admissible vouch set**, from `proof.credentials` (the wire
member keeps its name; it carries `vouch@2` artifacts).

**RLTP-ACC-4180** — Rule satisfaction MUST be a function of the
signer set and the admissible vouch set alone.

**RLTP-ACC-4190** — A vouch MUST be admissible only if it validates
as `vouch@2` (5.3), its `issuer` is in the policy currency at the
operation's declared position, its `credentialSubject.id` equals
the operation's `body.subject`, its
`credentialSubject.endorsement.accept` equals the document digest
of the operation's enclosed `admission.accept`, its
`credentialSubject.endorsement.genesisDigest` is this group's
identity (3.2), and the operation's rule key can carry a vouch rule
(4.2).

**RLTP-ACC-4200** — An inadmissible vouch MUST be ignored for
satisfaction and MUST NOT merge (3.3).

**RLTP-ACC-4210** — A signature component MUST be checked for
signer qualification under the applicable rule at the declared
position, signature validity, distinctness, and arity.

**RLTP-ACC-4220** — A vouch component MUST be checked for
admissibility, voucher distinctness, and count, and MUST require
the subject's own signature over the envelope in the signer set.

*Rationale.* A vouch for another admission, another subject, or
another group proves nothing about this operation; digest equality
is over decoded multihash bytes (Encounter 2.3). A `member.remove`
also has a `body.subject`, but its rules can never contain a vouch
rule, so no vouch is admissible on it. The subject's own signature
is what binds the immutable vouches to exactly this operation; no
freshness is claimed or needed.

On the wire each proof declares the shape it carries —
`signature-set` (signatures only), `encounter-presentation` (the
vouch set plus the subject's envelope signature), `composite`
(both, for composed rules).

**RLTP-ACC-4230** — A proof's `mechanism` MUST be consistent with
the shape it carries, and a verification step MUST NOT branch on
it.

**RLTP-ACC-4240** — A replica re-serializing a merged proof MUST
emit it under the label derived per 3.3.

**RLTP-ACC-4250** — A future proof mechanism MUST register a shape
descriptor that maps its material to the signer set and the vouch
set.

*Rationale.* A label that changed verdicts would make the proof's
form, not its content, the ground of judgement; a proof whose sets
satisfy the rule satisfies it under any consistent label, and one
derivation everywhere keeps every emitted proof schema-consistent.
New mechanisms — a FROST threshold signature, a zero-knowledge
membership or linkage proof — enter as registrations, material in
and sets out, without changing any consumer (Section 15).

### 4.4 The policy algebra

**The proof space.** A proof situation over an evaluation state *S*
is a pair *(A, P)*: *A* a set of signers, *P* a presentation — a set
of (voucher, vouch) edges about the operation's subject, empty
where the operation has none. All satisfaction sets live in this
one product space:

- `Sat(any-member)` = { (A, P) : A contains ≥ 1 of the policy
  currency }
- `Sat(threshold k)` = { (A, P) : A contains ≥ k distinct of the
  policy currency }
- `Sat(actors A₀, k)` = { (A, P) : A contains ≥ k distinct of the
  policy currency listed in A₀ }
- `Sat(vouch n)` = { (A, P) : P proves vouches from ≥ n distinct
  of the policy currency, and A contains the subject }
- `Sat(all[…])` = intersection; `Sat(any[…])` = union.

**Strength order.** *R₁ ≥ R₂ iff Sat(R₁, S) ⊆ Sat(R₂, S).*

**RLTP-ACC-4260** — A verifier MUST compute the strength order from
satisfaction sets, by enumeration over the finite signer and edge
universe of *S* or by a provably equivalent symbolic procedure.

**RLTP-ACC-4270** — `strongest` MUST resolve, per operation, to
`all` over the maximal elements under ≥, at the evaluation state,
of the policy's concrete rules assignable to the operation (4.2),
incomparable maxima included, never ranging over itself or another
meta-rule.

**RLTP-ACC-4280** — A policy MUST contain at least one concrete
(non-meta) rule.

*Rationale.* Syntactic shortcuts are unsound. Two consequences
every conformant procedure reproduces: `actors({a,b}, 2) ≥
actors({a}, 1)`, and `all[actors({a},1), actors({b},1)] ≥
threshold(2)` where a and b are in the currency. A meta-rule that
ranged over meta-rules would be self-referential, and `strongest`
over an empty remainder would denote nothing.

**Satisfaction cost.** The cost of a rule is a pair (signatures,
credentials), defined recursively: `any-member` → (1, 0);
`threshold k` → (k, 0); `actors A, k` → (k, 0); `vouch n` →
(1, n), the subject's envelope signature plus n vouches; `all[…]`
→ the componentwise sum; `any[…]` → the componentwise maximum.

**RLTP-ACC-4290** — At genesis and at every `policy.change`, the
new policy MUST be structurally valid: arities per 4.2, depth at
most 4, compositions non-empty, subject binding respected, and
`strongest` resolvable.

**RLTP-ACC-4300** — The rule assigned to `member.add`, as a whole
after meta-resolution, MUST satisfy `cost ≤ (64, 16)`.

**RLTP-ACC-4310** — Every rule of a new policy, after
meta-resolution, MUST be satisfiable against the post-operation
policy currency.

*Rationale.* An admission's proof must cross the Delivery carrier
inside its 64 KiB plaintext budget when a boundary-crossing
admission is enclosed for the invitee's bootstrap (5.3, Membership
§2); every other rule key's proofs stay inside the replica.
Per-leaf caps do not close under composition: sixty-three
individually capped components conjoined still demand thousands of
signatures, so the bound is aggregate. The maximum for `any` is
deliberate: the minimum says nothing in a state where only the
expensive branch is satisfiable. With the maximum the bound is a
theorem, by induction: every satisfying proof contains a satisfying
variant whose entry counts are at most `cost(R)`, and over-counting
shared signers is conservative, never permissive. Satisfiability
means `threshold(k)` needs `k ≤ |currency|`, `actors(A, k)` needs
`|A ∩ currency| ≥ k`, and `vouch(n)` needs `n ≤ |currency|`
excluding a candidate subject; an unsatisfiable rule is a dead end.

**RLTP-ACC-4320** — The rule assigned to, or resolving under
`strongest` for, the `policy.change` rule key MUST NOT contain an
`actors` component at any depth.

**RLTP-ACC-4330** — Where the policy currency is plural, the
`policy.change` rule MUST remain satisfiable against the currency
minus any single member.

**RLTP-ACC-4340** — An enforcement operation other than a leave
discharge whose post-state makes `policy.change` unsatisfiable MUST
be rejected as invalid.

**RLTP-ACC-4350** — The anti-deadlock check MUST be position-local
and MUST NOT be reversed after a merge.

**RLTP-ACC-4360** — An operation whose rule shrinkage has made
unsatisfiable MUST fail closed until the policy is changed.

**RLTP-ACC-4370** — A group SHOULD prefer `threshold` over `actors`
where shrinkage is expected.

*Rationale.* Constitutional power pinned to persons is un-amendable
after natural growth and departure: a founder-pinned rule minted at
a singleton genesis leaves every later member unable to amend once
the founder leaves, and no position-local margin catches a pinning
whose fragility appears only as the group grows. A constitution
demanding unanimity of a plural currency has no shrink margin, and
one concurrent leave would lock it for good; the one-leave margin
absorbs any single racing departure. A removal that kills the
constitution would leave the group unable to ever change its rules;
the discharge is exempt because a leave must never be blockable,
and emptiness is terminal anyway (5.4). A retroactive reversal
after a merge would be a cascade seed. A `policy.change` concurrent
with any enforcement operation forks the group fail-closed (Section
3.6), so concurrent enforcement cannot shrink the currency under a
new constitution unseen; several concurrent leaves, or several
concurrent removals that each pass at their own position, can still
leave a satisfiable `policy.change` unsatisfiable in the merged
state beyond the margin — the constitutional lock of Section 15,
surfaced, never reversed. Rules other than `policy.change` that
shrinkage makes unsatisfiable block their operations until the
policy changes, which anti-deadlock keeps possible.

### 4.5 Privileged operations (catalog and body profiles)

**RLTP-ACC-4380** — Every operation MUST have the class, epoch
effect, and closed body profile that the following table states.

| Operation | Class | Epoch effect | Body (normative profile; closed) |
|---|---|---|---|
| `group.genesis` | — (root) | creates epoch 0 | 3.4.1: `members`, `card`, `policy`, `visibility`, `adapter`, the adapter's epoch-0 binding (`contentKeyCommitment` under `linear/0.1`, 9.4.1), `keyOpDigest`, `serviceIdentity` |
| `member.add` | additive | none | `subject`, `admission` (5.3) |
| `member.remove` | enforcement | **transition, atomic** | `subject`, `transition` (Section 7) |
| `member.leave` | additive¹ / terminal² | obligates next transition | empty; the subject is the author (5.4) |
| `epoch.rotate` | enforcement | **transition, atomic** | `transition` |
| `policy.change` | enforcement | **transition, atomic** | `policy` (the complete new object, 4.1), `transition` |
| `visibility.change` | enforcement | **transition, atomic** | `mode`, `transition` (Section 8) |
| `history.expose` | additive | none | `fromEpoch`, `toEpoch` (optional), `keys` (Section 8) |
| `lineage.repair` | additive | none | `epoch`, `opens`, `ct`; valid only under `linear/0.1` (9.4.1) |
| `document.attach` | additive | none | `document` (identifier), `dataPolicy` (Layer-4 disposition declaration) |
| `document.detach` | enforcement | **transition, atomic** | `document`, `transition` |
| `device.add` | additive | none | `card` (the device card, 5.1); the author is the device's person |
| `device.revoke` | enforcement | **transition, atomic** | `subject` (the device's person), `device` (the digest of the revoked device card), `transition` |
| `group.dissolve` | terminal | terminal | empty (three paths, 5.4) |
| `service-identity.announce` | additive | none | `serviceIdentity` (5.2) |

¹ `member.leave` cannot carry a transition; it obligates one (5.4).
² a leave at a position of sole membership is the last-member
dissolve (5.4).

**RLTP-ACC-4390** — The `subject` of `member.remove` MUST be a
member at the declared position.

**RLTP-ACC-4400** — `member.leave` MUST NOT carry a transition.

**RLTP-ACC-4410** — A leave at a position of sole membership MUST be
treated as the last-member dissolve.

**RLTP-ACC-4420** — A registered operation MUST declare its class,
epoch effect, rule key default (4.1), and closed body profile.

**RLTP-ACC-4430** — The bodies of `member.leave` and
`group.dissolve` MUST be empty.

**RLTP-ACC-4440** — An enforcement operation MUST carry its
transition, including `keyOpDigest` (Section 9.2), in the same
envelope.

*Rationale.* The operation set is closed: an operation without a
class would escape the conflict matrix, and an open body would let
a field carry authority no rule judges. Removing a non-member would
be a lever for the removal disposition (Section 3.6) without a
removal. The leaver must not learn the keys of the world after
their leave, so the leave cannot carry the transition that would
create them. Empty bodies keep leaving and dissolving constructible
even in the degraded state. Carrying the key operation's digest in
the same signed envelope makes claim and ability change together or
not at all: a removal without its key operation would be a claim
without effect, a key operation without its removal an effect
without a claim. A `policy.change` is an authority change, and
carrying a transition is what makes concurrent constitutional
claims sibling epochs rather than a race. A device's revocation
cuts a device out of the key structure, which is an enforcement in
kind (Section 9.2), but it changes no membership (5.1). The
transcription schema carries the body profiles, closed.


## 5. Members

*In plain terms.* A member is a person, known to the group under a
name that exists only in this group. A person may use several
devices; each device holds its own keys and is tied to the person
by a signed device card, so a lost phone can be cut off without
the person leaving. Nobody joins without having said yes, the
evidence of that yes travels with the admission, and leaving can
never be blocked.

### 5.1 Identity

**Persons.** Members are anchors, and a member's anchor is a
per-group context anchor (its member anchor), never a cross-group
coordinate. Two register rows of Identity §6 supply it: a joiner
derives the `group/<genesis digest>` context, which exists before
admission because the invite carries the genesis digest
(Membership 3.1); the founder, for whom that context cannot exist
before the genesis digest does, mints a fresh context of the
nonce-based pair class (RLTP-ACC-3275).

**RLTP-ACC-5010** — A member's anchor MUST be a per-group context
anchor.

**RLTP-ACC-5020** — A member of the authority log MUST be a
person's member anchor; a device MUST NOT appear as a member of the
log.

**RLTP-ACC-5030** — A member anchor MUST be created for exactly one
group.

**RLTP-ACC-5040** — A member anchor MUST NOT be used in any other
context, group, or relationship.

**RLTP-ACC-5050** — A joiner MUST derive its member anchor from the
`group/<genesis digest>` context.

**RLTP-ACC-5060** — Before forming the `group/<digest>` label, the
validated genesis digest MUST be re-encoded to its canonical `u`
form, for the derivation only.

**RLTP-ACC-5070** — A member's community anchor MUST NOT appear in
any artifact of this layer other than `member-mapping@1` (5.5).

*Rationale.* An anchor shared across groups would let anyone
holding two rosters join a person across them. The conflict matrix
decides about persons; a device change is not a membership change,
and a log that listed devices would turn every new phone into a
policy decision. A received genesis digest may arrive in either
accepted encoding (Encounter 2.3); Identity §6 accepts exactly the
`u` form, so the same multihash yields the same member anchor
whichever rendering carried it, and the signed artifact is never
rewritten (RLTP-ACC-3050). Joining discloses a group-scoped
identifier to the roster, never the coordinate that links a person
across groups; crossing that boundary is the deliberate act of 5.5.

**RLTP-ACC-5080** — An anchor that a group's materialized
membership already carries MUST remain a valid member anchor of
that group, whether or not it is scoped to that group.

**RLTP-ACC-5090** — An admission MUST NOT enter an anchor that is
not scoped to the group into a group whose membership does not
already carry it.

*Rationale.* An identity's recovery context can stand in a roster
it joined before member anchors were per group (Identity §10). A
change of anchor form must not end an existing membership: that
member keeps authorizing operations there until an ordinary
membership event ends the membership, and migrating the entry onto
a `group/<genesis digest>` anchor is that group's own ordinary
membership event. What the scoping property forbids is new use:
such an anchor is visible across groups by construction, so for
the groups that already carry it the pseudonymity of 5.5 was never
established, and no further group may acquire it.

**Devices.** A person acts from one or more devices. The authority
port knows only the person; the key port holds key material per
device (Section 9.2), and a **device card** binds one device to its
person's member anchor. A device card carries:

| Field | Content |
|---|---|
| `anchor` | the member anchor of the device's person in this group |
| `device` | the device's Ed25519 `did:key`, under which the device acts in the key port |
| `keyAgreement` | the device's X25519 key-agreement Multikey, to which key material for this device is sealed |
| `serviceIdentity` | the device's derived service identity (5.2) |
| `proof` | `{ "signer": <the signing device's did:key>, "sig": <multibase base58btc (`z…`) Ed25519 signature> }` over the JCS serialization with `proof` omitted (RLTP-ACC-5120) |

A device card's **digest** is the multibase multihash over the JCS
serialization of the card with `proof` omitted; `device.revoke`
names a card by this digest (4.5).

**RLTP-ACC-5100** — The key port MUST hold separate key material for
each bound device of a member.

**RLTP-ACC-5110** — A device MUST be bound to its person's member
anchor by a device card carrying exactly the fields of the table
above, entered into the authority log by a `device.add` operation
(4.5) authored by that member anchor.

**RLTP-ACC-5120** — A device card MUST be signed by a device of the
same person bound and not revoked at the operation's position.

**RLTP-ACC-5125** — A person's first device binding MUST be derived
from the contact card its genesis or membership-accept carries:
`device` is the member anchor's own key, `keyAgreement` is the
card's, `serviceIdentity` follows 5.2; it is not a separate
artifact, carries no proof of its own, and needs no `device.add`.

**RLTP-ACC-5130** — Adding a further device MUST be an operation of
the key port and MUST NOT change membership.

**RLTP-ACC-5140** — Admitting a person MUST bring every device bound
to that person at that point into the key structure.

**RLTP-ACC-5145** — A member MUST NOT have more than 8 bound,
unrevoked devices at any position; a `device.add` beyond that
bound MUST be rejected as invalid, and a merged state MAY exceed it
as 3.6 states for membership.

*Rationale.* Only separate material per device lets one device be
removed without its person, and a captured device then does not
yield the secrets of the other devices of the same person (S5b).
The card is the bridge between the person in the log and the device
in the key structure; recorded in the log, it is replicated,
ordered, and judged like every other binding. Without the
signature of an existing device of the same person, a stranger
could bind a device to someone else's name and read along. The
first device needs no separate binding: the contact card that
founds the group or accepts the admission already carries the
anchor's key and a key-agreement key, and the key port gives its
first leaf to exactly that pair; a second card form for the same
device would only create a second thing to forge. A
second device is not a policy decision (S5); the person adds it,
and membership does not move. A device already bound when its person is
admitted would otherwise be left without keys.

**RLTP-ACC-5150** — Removing a device MUST be an operation of the
key port and MUST NOT change membership.

**RLTP-ACC-5160** — Removing a device MUST yield an epoch secret the
removed device cannot derive.

**RLTP-ACC-5170** — A device revocation MUST be recorded in the
authority log as a `device.revoke` operation (4.5).

**RLTP-ACC-5175** — A revoked device key MUST NOT be bound again by
an ordinary `device.add`; re-binding it MUST satisfy the
`device.revoke` rule key (4.1), and a revoked device MUST NOT sign
a device card.

**RLTP-ACC-5180** — Removing a person MUST remove every device of
that person from the key structure.

*Rationale.* After a device is lost, its finder must read nothing
new while its person stays a member (S5b): the key port's removal
invariant applies per device (Section 9.2). A revocation that
travelled only as a loose message would not be authoritative:
another device of the same person could re-add the revoked one
later, and members could not heal a key structure that missed the
revocation (Section 9.2). In the log the revocation is ordered,
replicated, and authorized like a removal — by the device's own
person or under the `device.revoke` rule (4.1). A person without a
remaining device is still a member; whether a person can be
removed is decided by the log, never by the set of cards. No leaf
of a removed person may read anything new (S5c).

### 5.2 Derived service identities

**RLTP-ACC-5190** — A device MUST use a derived service identity for
every service interaction.

**RLTP-ACC-5200** — A device MUST NOT present its person's member
anchor or any other personal anchor to a service.

**RLTP-ACC-5210** — A device's derived service identity MUST be
derived from its person's root IKM, per group and per device, by
the derivation the Identity layer defines for it.

**RLTP-ACC-5220** — The binding of a member and its device to a
derived service identity MUST be recorded only in the authority
log: by the genesis for the founder, by the device card (5.1), or
by `service-identity.announce`.

**RLTP-ACC-5230** — The author of `service-identity.announce` MUST
be a member at the declared position.

**RLTP-ACC-5240** — An announcement binding an identity already
bound to a different anchor in its ancestry MUST NOT be canonical.

**RLTP-ACC-5250** — A device MUST have its service identity bound
in the authority log before participating in the view quorum (7.3).

**RLTP-ACC-5260** — An implementation SHOULD bind the service
identity of its device immediately upon admission.

**RLTP-ACC-5270** — A replacement announcement MUST take effect at
the first canonical epoch transition whose ancestry contains it,
never within the running epoch.

**RLTP-ACC-5280** — Derived service identities MUST appear bare
toward services, and the mapping to anchors MUST NOT leave the
authority log, except toward a service the group registered with
class `log` (Section 9.3).

`service-identity.announce` is additive and self-authorized, with
body `{ "serviceIdentity": "did:key:…" }`, authored by the member
it binds.

*Rationale.* A personal anchor presented to a service would let
the service correlate one person across groups. The derivation is
deterministic and re-derivable after total device loss, because
nothing authority-bearing may live only on a device. The mapping
between anchors and identities never leaves the log, so a service
of class `blind` or `view` learns no persons; a service of class
`log` reads the log and with it the mapping, because the group
chose so. First binding wins: an identity already bound to another
anchor cannot be taken over. A device outside the log's binding
could sign views the log never authorized. Effect at the next
transition containing the announcement makes the effective set
deterministic under concurrency — a transition merged concurrently
with the announcement does not carry it, the next one does — keeps
the view identity set of one epoch grow-only (7.3), and lets an
identity rotation after a key compromise ride the `epoch.rotate`
that the compromise warrants anyway.

*Editor's note (device × group).* Identity 0.51 derives the service
identity per person and group (Identity §7, the information string
`rltp/v1/service-identity/` followed by the canonical genesis
digest) and reserves the `device/` prefix for a device-level
successor (Identity §15.1); it defines no per-device derivation. A
byte-exact derivation for RLTP-ACC-5210 therefore awaits that
successor, and until it exists conformance to RLTP-ACC-5210 cannot
be claimed. The same successor decides the open half of the device
model: device keys global across groups would let a service that
serves several groups link them through a device, whereas device
keys scoped to the group, or bound per group only through the
device card, would not. This document keeps the member anchor of
Identity per group and leaves the device side to Identity.

### 5.3 Admission and removal

**Admission is consent-bound.** This section owns, normatively, the
`member.add` body profile and materialization rules; the document
shapes — invite, accept, welcome seal — are defined in the
Membership Tasks.

An admitting `member.add` body carries `subject`, the admitted
member anchor (5.1), and `admission`:

```json
{ "invite": "<complete membership-invite document>",
  "accept": "<complete membership-accept document>",
  "welcome": "<digest of the welcome plaintext>" }
```

**RLTP-ACC-5290** — An admitting `member.add` body MUST carry
`subject` and `admission` with the complete invite document, the
complete accept document, and the welcome digest.

**RLTP-ACC-5300** — Invitation provenance MUST be read from the
enclosed invite's signature, never from an assertable field.

*Rationale.* Enclosing the complete signed documents, not digests,
makes an admission verifiable without private knowledge: every
replica holds the evidence, any authorized member can complete an
admission, and nobody can claim to have been invited by someone who
did not sign.

**RLTP-ACC-5310** — An admission travelling to its subject for
bootstrap MUST carry a transported variant proof, not the replica's
merged proof.

**RLTP-ACC-5320** — A transported variant proof MUST satisfy the
applicable rule at the admission's position and carry at most 64
signatures and at most 16 credentials of at most 2048 bytes each in
JCS serialization.

**RLTP-ACC-5330** — A sender MUST verify the complete serialized
task against the Delivery plaintext limit before sending.

**RLTP-ACC-5340** — Where the full boundary-crossing admission does
not fit, the bootstrap MUST be possible by the self-contained
(re-)welcome (10.1).

**RLTP-ACC-5350** — An envelope carrying a transition MUST NOT cross
the replica boundary.

*Rationale.* Merged evidence is unbounded; the variant that crosses
the boundary is defined as a checkable property of the artifact,
not by a minimality order or a chooser, and one exists whenever the
rule is satisfiable (4.4's aggregate cost bound). The 64 KiB
Delivery budget is the hard limit. Fit is a sender duty, not a
theorem: Membership's maxima for invite, accept, and welcome can in
the worst case consume the budget on their own (Section 12). The
(re-)welcome is verified against the invitee's own accept and
always fits; the admission evidence then reaches the subject by
replication after bootstrap, so no legitimate admission is
undeliverable. A transition's key distribution is scaled to the
retained members and fits no carrier budget, and nothing outside the
replica is entitled to it; what outside parties need travels in
purpose-built artifacts (`key-delivery`, 10.1; the removal notice,
10.2).

**The vouch.** Where the `member.add` rule contains a vouch
component, its inputs are DTG EndorsementCredentials with this
layer's `AdmissionVouch` endorsement vocabulary. A vouch is one
closed VC (schema `schemas/access-vouch.schema.json`):

```json
{ "@context": ["https://www.w3.org/ns/credentials/v2",
               "https://firstperson.network/credentials/dtg/v1",
               "https://real-life.org/rltp/v1"],
  "type": ["VerifiableCredential", "DTGCredential",
           "EndorsementCredential", "AdmissionVouch"],
  "issuer": "<the vouching member's anchor>",
  "validFrom": "<RFC 3339 UTC Z>",
  "credentialSubject": {
    "id": "<the candidate's member anchor>",
    "endorsement": {
      "type": "AdmissionVouch",
      "genesisDigest": "<the group's identity, 3.2>",
      "accept": "<document digest of the membership-accept this vouch supports>",
      "provenance": "met | introduced" } },
  "proof": "<DataIntegrityProof eddsa-jcs-2022 under issuer, incl. the proof-@context copy (Encounter 2.3)>" }
```

**RLTP-ACC-5360** — A vouch MUST be the closed `vouch@2` VC with
the context, types, subject, and endorsement fields shown above.

**RLTP-ACC-5370** — A vouch MUST NOT carry `validUntil`.

**RLTP-ACC-5380** — A verifier MUST NOT treat a vouch's
`provenance` as verified.

**RLTP-ACC-5390** — The evidence relay of Membership §3.4 MAY carry
vouches alongside the consent pair.

*Rationale.* One closed form is DTG-conformant and leaves no room
for a second reading. The accept binding, not a clock, ends a
vouch's usability: a vouch supports exactly one consented
candidacy, so a later re-admission of the same anchor needs fresh
consent and fresh vouches, and no standing vouch exists.
`provenance` is the voucher's own statement — an honest input to
the people a policy puts in charge, never a verified claim. Vouches
are issued about the candidate's member anchor, a disclosure the
candidate consents to in asking for them, so the log learns the
member anchor and nothing else; enclosed vouches count against the
transported variant proof's caps. The candidate never needs to
know who is a member: the inviter surfaces the candidacy into the
group space as Layer-4 content, and members vouch over an existing
relationship, after meeting, or by introduction (Network
Visibility §8). A group that wants a fallback without vouches
writes `any[vouch(n), …]` into its policy.

**Materialization accepts an admitting `member.add` only if, at its
causal position, rules 0 to 5 hold.** Path convention (Membership
3.4): `invite` names the enclosed invite credential — the
`payload.invite` of the enclosed invite document; `accept` names
the enclosed accept document's payload object; the enclosing
delivery documents are named explicitly.

**RLTP-ACC-5400** — *(Rule 0)* An admitting `member.add` MUST NOT be
canonical if its subject is a member of the state materialized from
its ancestors.

**RLTP-ACC-5410** — *(Rule 0)* An admitting `member.add` MUST NOT be
canonical if the resulting membership at its position exceeds 4096
members, this profile's registered group bound.

**RLTP-ACC-5420** — *(Rule 1)* Both enclosed admission documents
MUST validate against their schemas, the invite credential's
DataIntegrityProof MUST verify under its `issuer`, and the accept
MUST verify under `accept.subject`.

**RLTP-ACC-5430** — *(Rule 1)* The invite document's own `id`,
`issuedAt`, and `ceremony` MUST NOT carry authority.

**RLTP-ACC-5440** — *(Rule 2)* All of the following cross-bindings
MUST hold:

- `accept.ref` = the credential digest of the enclosed invite (the
  multibase multihash over the JCS of the complete
  `payload.invite`, its proof included; digest equality over
  decoded multihash bytes, Encounter 2.3);
- `accept.subject` = `invite.credentialSubject.id` =
  `body.subject`;
- `accept.group` = `invite.credentialSubject.group` =
  `operation.group`, and the invite's `genesisDigest` = this
  group's genesis digest (3.2);
- the invite credential's `issuer` = the enclosing invite
  document's `issuer`;
- card ownership per Membership 3.1 and 3.2;
- the enclosed invite document's `recipient` =
  `invite.credentialSubject.id`, and the enclosed accept's
  `recipient` = the invite's `issuer`;
- both enclosed documents share the enclosed invite document's
  `threadId` (= the invite's `taskContext`);
- `invite.validUntil` ≥ the invite's `validFrom`.

**RLTP-ACC-5450** — *(Rule 3)* The enclosed accept document's
`issuedAt` and its `proof.created` MUST NOT be later than
`invite.validUntil` plus `membership-skew`.

**RLTP-ACC-5460** — *(Rule 4)* The invite's `issuer` MUST be
authorized to invite at the operation's causal position, per the
applicable `member.add` rule.

**RLTP-ACC-5470** — *(Rule 5)* An admission whose ancestry already
contains a rule-passing admission of the same accept digest MUST
NOT be canonical.

**RLTP-ACC-5480** — *(Rule 5)* Every canonical admission MUST
consume the accept it encloses.

**RLTP-ACC-5490** — *(Rule 5)* Entitlement MUST rest on any
canonical admission of the anchor.

**RLTP-ACC-5500** — *(Rule 5)* A delivered welcome of a rule-passing
candidate MUST NOT be invalidated.

**RLTP-ACC-5510** — A `member.add` failing any of rules 0 to 5 MUST
NOT be canonical, whatever its signatures.

*Rationale.* Rule 0 prevents double admission, and the group bound
is what every membership-scaled artifact — proofs, key
distribution, view identities — is sized for; it is position-local,
and a merged materialization tolerates a transient overshoot under
the over-capacity rule of Section 3.6, which freezes further
admissions until the group shrinks below the bound. Larger groups
need a future profile (Section 15). The invite document's wrapper
metadata is unauthenticated; a present `ceremony.enactment` must
still recompute (Delivery §3), which is validity, not authority.
The cross-bindings close every way to consent to one invitation and
be admitted under another, into another group, or as another
person; consent binds to the credential, so byte-different wrappers
around one credential are one invitation. Rule 3 is an honest-clock
bound: the effective gate on stale consent is the human admission
decision, and the bound is the validity window the inviter chose,
not a pretended causal order over wall-clock documents (Section
12). The causal step of rule 5 is same-accept only: a causally
later replay of consumed consent can never displace its ancestor,
whereas a re-admission after an ended membership — which carries
the old admission in its closure — is legitimate exactly when it
encloses fresh consent. Concurrent admissions of the same subject
all confer the same thing, membership; none is voided and none is
distinguished, because a "canonical basis" chosen by smallest id
would be one more artifact a merge could move. Consumption is
content-bound and follows from each candidate's own canonicality,
which is merge-final, so no accept becomes free again under any
merge, and no merge can invalidate a key request by reshuffling a
distinguished operation.

**The key service duty.** A canonical admission entitles its
subject, and every retained member of a canonical transition
(Section 7) entitles that member, to key material that verifies
against the log's binding of the epoch, independently of what the
operation's author actually delivered.

**RLTP-ACC-5520** — A canonical admission or retention MUST entitle
its subject to key material that verifies against the log's binding
of the epoch (Section 9.2).

**RLTP-ACC-5530** — A key claim MUST travel as a `key-delivery`
document of kind `request` (10.1), signed by the claiming anchor,
naming the operation it claims under, and carrying a contact card
in the displayed form whose proof verifies under that anchor.

**RLTP-ACC-5540** — A requester MAY address any member whose card
it holds.

**RLTP-ACC-5550** — A member MUST retain the key-agreement private
key of its enclosed admission card — for the founder, the genesis
card — for as long as it is a member.

**RLTP-ACC-5560** — A member holding the current epoch keys MUST
evaluate a request's entitlement at its own current materialized
state before answering: the requesting anchor is a member there,
and the named operation is a canonical admission of that anchor or,
for the founder, the genesis.

**RLTP-ACC-5570** — A request from an anchor whose membership has
ended by a removal or a discharged exit MUST be refused.

**RLTP-ACC-5580** — An entitled request MUST be answered with fresh
material produced by the key port at the helper's current position,
in the recovery kind the adapter registers (9.4: `re-welcome` or
`refresh` under `linear/0.1`, `material` under `beekem/0.1`),
sealed to the request's card.

*Rationale.* Without the duty, the author of an admission or a
transition could hold the new member's or a retained member's keys
hostage. The signature gate makes the duty non-triggerable by third
parties; a seal needs a live key, not a fresh one (Membership §2),
so no freshness is claimed. The enclosed cards of the log's
admissions are address material, so no single helper can withhold
alone, and a member who discarded its card key could no longer
open the answers addressed to it. A former member's old admission
is history and entitles them to nothing now. Any canonical
admission of the anchor serves; none is distinguished (rule 5).

**RLTP-ACC-5590** — A helper MUST keep one key-service slot per
(`genesisDigest`, requester anchor).

**RLTP-ACC-5600** — A valid authenticated request MUST fill an empty
slot and start its deadline.

**RLTP-ACC-5610** — A request processed while the slot is full MUST
replace the slot's content — request and card — and MUST NOT change
the deadline.

**RLTP-ACC-5620** — A helper MUST discharge a filled slot with one
answer, sealed to the card the slot then holds, as soon as its own
rate limit allows and at the latest within `key-request-interval`
of the deadline's start; discharge empties the slot.

*Rationale.* The duty's shape is one outstanding answer,
rate-served, not a once-per-anything dedupe: every dedupe key —
operation, card, epoch — either leaves a multiplier one party
controls or refuses a legitimate repeat, such as a lost card or a
displaced delivery. Keyed by the group's identity, sibling geneses
under one address never share a slot (3.2). "Newest" means the
helper's local processing order and nothing more. A deadline that a
new request could reset would let a helper stay silent forever
against a requester who keeps asking. An abusive requester can
extract one forced answer per interval per genesis digest and
accumulates no state; an honest member is guaranteed a fresh answer
to their newest request within the interval, whatever happened to
cards, clones, or earlier deliveries.

**RLTP-ACC-5630** — Received key material MUST be adopted only if it
verifies against the log's binding of that epoch (Section 9.2).

Under `linear/0.1`, the key service duty has one proactive arm: a
member holding both keys of a skipped or failing lineage step owes
the `lineage.repair` entry (RLTP-ACC-9830).

*Rationale.* Verification at adoption makes garbage deliveries
harmless. Consuming an accept without delivering a usable welcome,
or committing a transition whose key material cannot be opened,
delays key possession; it cannot revoke entitlement. It is
attributable misbehavior of the operation's author, and where it
walls off an epoch entirely, a recovery rotation reopens the group
without them (9.4.1).

**Removal.** `member.remove` names the subject and carries the
transition (4.5).

**RLTP-ACC-5650** — On materializing a canonical removal, never on
delivery, an implementation MUST stop write attempts after durably
preserving unsent local work and MUST invalidate runtime authority
immediately.

**RLTP-ACC-5660** — An implementation SHOULD wipe group key material
once the removal is canonical, subject to the unique-data boundary
(Section 12).

**RLTP-ACC-5670** — Each replica MUST evict the former member no
later than its own canonical application of the membership-ending
operation — the removal transition, the leave-discharging
transition, or the terminal state.

**RLTP-ACC-5680** — Where replication commits the operation itself,
eviction MUST be part of that commit.

**RLTP-ACC-5690** — Authority operations after the eviction commit
MUST NOT be replicated to the evicted peer.

**RLTP-ACC-5700** — A replica MUST NOT forward as authority an
operation it has not itself canonically applied.

**RLTP-ACC-5710** — A replica MUST NOT withhold non-effecting
evidence (Section 3.6) from the evidence-authorized peers of
Section 3.6.

**RLTP-ACC-5720** — Operations MUST be applied ancestor-first.

**RLTP-ACC-5730** — A member's peers are the replication endpoints
authenticated by that member's anchor, its derived identities, and
its devices bound by device cards (5.1).

*Rationale.* No privileged operation may race a removal, and a
removed member's device is a theft target. Eviction binds for every
way membership ends; in the terminal state replication of the group
ends for all peers, and local holdings follow the Layer-4
`dataPolicy`. No replica can act on a commit it has not yet seen,
and none may forward to the evicted peer after it has; a lagging
replica must not leak around its own lag (commit-before-forward).
The forwarding gate is a gate on authority, not on evidence: entries
that cannot be applied — fork siblings, their descendants,
operations under the removal disposition — travel as non-effecting
evidence so that every replica reaches the same verdict, and
withholding them would let replicas diverge silently (Section 9.3);
to the removed peer travels nothing, evidence included.
Ancestor-first application means a batch holding a removal and its
descendants is materialized, eviction included, before any
descendant moves on. What was replicated before stays held —
knowledge cannot be withdrawn (Section 7) — but member-only
readability (RLTP-ACC-3020) is thereby an obligation of replication,
not a hope.

**RLTP-ACC-5740** — The removal notice to a removed member MUST be a
`removal-notice/0.1` task (10.2), never the operation envelope.

*Rationale.* No enforcement envelope leaves the replica
(RLTP-ACC-5350). A service that stops serving a removed member owes
that member the notice (Section 9.3).

### 5.4 Leave, pending exit, and dissolve

`member.leave` is valid with exactly the author's own signature
(RLTP-ACC-3300). Its authority effect takes place at the
discharging transition: between merge and discharge the leaver is
in **pending exit** — still a member for key purposes, listed in
authorization views until the discharge (7.3), but without policy
standing.

**RLTP-ACC-5750** — A pending exit MUST be excluded from the policy
currency.

**RLTP-ACC-5760** — A pending exit MUST NOT receive any further
epoch secret.

**RLTP-ACC-5770** — A pending exit MUST be able to author exactly the
leave discharge, the drained dissolve, and, under `linear/0.1`,
`lineage.repair`.

**RLTP-ACC-5780** — A leave MUST NOT be blockable by anyone, in any
state of the key port.

**RLTP-ACC-5790** — An implementation MUST issue the discharging
rotation as soon as it merges a leave.

**RLTP-ACC-5800** — An implementation MUST surface the pending-exit
window.

*Rationale.* Whoever leaves no longer decides: a pending exit can
neither author nor co-sign privileged operations, count toward
thresholds, nor invite. The leaver holds the epoch keys either way,
so this layer does not pretend otherwise, but no secret created
after the leave may reach them. The three open acts end or repair
rather than exercise authority; without the repair exception, the
repair duty of `linear/0.1` could bind a key holder whom the
currency exclusion forbids to act. The discharge is valid with a
single signature of any member of its position, pending exits
included, bypassing the `epoch.rotate` rule and exempt from
anti-deadlock (RLTP-ACC-3305, 4.4); the means by which a discharge
leaves a key state nobody can read are the adapter's (9.4.1).
A leave that could be blocked would make keys a hostage. The
exposure of a leave is prospective only, and the window must be
visible.

**RLTP-ACC-5810** — When every member is a pending exit, a
`group.dissolve` signed by any one of them MUST be valid.

**RLTP-ACC-5820** — An implementation MUST surface the all-pending
state as dormant, not terminal.

**RLTP-ACC-5830** — A leave MUST count as discharged exactly when a
canonical transition whose ancestry contains it excludes the
leaver.

*Rationale.* A group in which every member is a pending exit has
nobody left to rotate for; the ending is not a rotation but the
drained path of `group.dissolve`: terminal class, empty body, no
transition. The condition is exact: one member who has not left
needs no shortcut, because their discharge retains at least
themselves, after which the ordinary last-member path stands open;
the drained path never hands an active member single-signature
terminal power over a collective rule. If every member leaves and
nobody authors the dissolve, nothing is blocked — any of them can
finalize at any time — but something is unfinished, and the
interface must say so. The retained members of a transition (Section
7) exclude a discharged leaver by construction, and discharge ends
membership.

**RLTP-ACC-5840** — A last-member leave MUST revert to an ordinary
leave when a concurrent canonical admission merges.

**RLTP-ACC-5850** — A materialization with empty membership MUST be
terminal unless a concurrent canonical admission keeps it
non-empty.

**RLTP-ACC-5860** — `group.dissolve` MUST be valid by exactly one of
three paths: last-member (the materialized membership at the
declared position is exactly the author), drained (every member of
the declared position is a pending exit and the author is one of
them), or collective (under its rule, default `strongest`).

**RLTP-ACC-5870** — An operation MUST NOT be valid after a
canonical dissolution.

*Rationale.* A leave at a position of sole membership is the
last-member dissolve — there is no next epoch to discharge into —
but like emptiness this is a verdict of the materialization at
hand: a concurrent admission means the group was not sole-membered
after all, the rotation obligation falls to the merged membership,
and the newcomer inherits the open duties. A canonical
`group.dissolve` is different: it is an operation, it prevails over
concurrent additive branches (Section 3.6), and it is not revived.
Dissolution ends capabilities with the group; there is no next key
world, former members keep the last one as knowledge, services
treat a terminal view per 7.3, and documents follow the Layer-4
`dataPolicy` declared at attach time.

### 5.5 `member-mapping@1` — the deliberate crossing of the group boundary

Joining under a member anchor makes co-membership pseudonymous;
this artifact is the one way the pseudonym is lifted — per
co-member, deniably. It follows the class-V discipline of Network
Visibility §3 (a link between two contexts of one person is
designated-verifier, never transferable) and its §6 construction,
with the anchor classes swapped.

Body: `{ "type": "member-mapping@1", "member": <the sender's own
member anchor in this group>, "memberOp": <oid: of a canonical
admission of `member` — or the genesis, where `member` is the
founder>, "self": <the sender's community anchor — the field name
is a frozen wire spelling>, "to": <the addressee's member anchor in
the same group>, "toOp": <oid: of a canonical admission of `to` —
or the genesis>, "card": <a self-card@1 per Network Visibility
§6.2>, "revision": <int-string>, "issuedAt": <timestamp> }`, wire
conventions per Network Visibility §2.1. Proof: `mac1` under
`HKDF(ECDH(memberX_sender, memberX_addressee),
"rltp/access/mac/member-map1")` and `mac2` under
`HKDF(ECDH(selfX_sender, memberX_addressee),
"rltp/access/mac/member-map2")`, both over the canonical body
bytes. Schema: `schemas/member-mapping.schema.json`
(`rltp-access-member-mapping/0.24`).

**RLTP-ACC-5880** — `member-mapping@1` MUST be the only artifact of
this layer that links a member anchor to a community anchor.

**RLTP-ACC-5890** — A `member-mapping@1` body MUST carry exactly the
fields listed above, naming by `memberOp` and `toOp` the admissions,
or the genesis, whose enclosed cards supply the key-agreement keys.

**RLTP-ACC-5900** — A `member-mapping@1` proof MUST be the `mac1` and
`mac2` pair as defined above, computed with exactly the
key-agreement keys of the cards enclosed in the operations
`memberOp` and `toOp` name (the genesis card for a founder side).

**RLTP-ACC-5910** — The addressee MUST accept a `member-mapping@1`
only if the following checks pass, in order:

1. envelope and schema valid, `type` implemented;
2. `to` equals the addressee's own member anchor of this group, and
   `toOp` names a canonical admission whose subject is `to` — or
   the genesis whose `body.members[0]` is `to` — and whose enclosed
   card is the addressee's own;
3. `memberOp` names a canonical admission whose subject is `member`
   — or the genesis, whose `body.members[0]` is `member` — in this
   group's log, and `member` is a current member of the
   addressee's materialized state;
4. the card verifies as `self-card@1` under its own anchor and
   `card.anchor == self`;
5. `mac1`'s keys are the key-agreement keys of the cards named by
   `memberOp` and `toOp`, and `mac2`'s addressee-side key is the
   `toOp` card's;
6. both ECDH outputs are non-zero and both MACs verify;
7. `revision` per the generic revision rule of Network Visibility
   §6.4, scoped per (`member`, `to`): higher wins; equal and
   JCS-identical is idempotent; equal and different is an
   equivocation error; lower is rejected.

**RLTP-ACC-5920** — A `member-mapping@1` MUST NOT be published into
the group space.

**RLTP-ACC-5930** — A verified mapping MUST be merged
holder-locally only, per Network Visibility §6a.1.

**RLTP-ACC-5940** — A new linkage mechanism MUST enter as a new
registration under a new version of this type, under the same
acceptance contract.

*Rationale.* Pseudonymity of membership holds only if exactly one,
deliberate artifact crosses it. Several canonical admissions of one
anchor may enclose different cards (5.3 distinguishes none), so the
mapping names the admission whose card supplies each side's key and
the key choice is deterministic. With the checks in place, foreign
community anchors are unclaimable and a former member's mapping
offer is refused, exactly as their key requests are (5.3); the
addressee could forge the whole artifact, so it stays deniable, and
third parties — co-members included — can verify nothing. The
mapping travels on the existing relationship channel between
discloser and addressee, registered as a Delivery task (Delivery
§4); a group-space carrier would leak the disclosure edge itself as
group-visible metadata. The user-facing act is the Trust act; on
verification, roster entry and contact become one person locally,
and nothing changes on any wire. The proof above is the
`dv-double-dh` mechanism, the first registered for this artifact
class; a zero-knowledge linkage proof enters as a registration,
never as a change to its consumers.


## 6. Actions and the Implicit Capability

*In plain terms.* Being a member means being able to read and write
everything in the group, from the moment you are admitted until
the moment you are removed or leave. There is no separate "admin"
switch: bigger decisions go through the group's rules (Section 4).
The service that stores and forwards the group's data gets a role
of its own, and what it may see of the group is what the group
registered for it.

Three actions are defined — **`relay`**, **`read`**, **`write`** —
an open set.

**RLTP-ACC-6010** — An unknown action MUST confer nothing.

**RLTP-ACC-6020** — A privileged operation MUST be gated by policy,
never by a capability.

**RLTP-ACC-6030** — Every member MUST hold read and write over the
whole group — the implicit capability — from the operation that
made it a member to the epoch transition that excludes it
(discharged leave, removal, dissolution).

**RLTP-ACC-6040** — `relay` MUST be conferred only on a service, by
the group's registration at that service (7.3), and MUST end with
that registration.

**RLTP-ACC-6050** — A member capability other than the implicit
capability MUST NOT exist in this version.

*Rationale.* Unknown actions degrade toward less authority (Section
11). An `admin` action would be a back door around the policy;
collective authority is not delegable. Toward services, members
exercise read and write under the derived identities of their
devices as listed in the authorization views (7.3). `relay` is not
a member capability but the role of the group's chosen
infrastructure: storing and forwarding the group's data. It never
includes reading content; what else the service learns — nothing
but ciphertext, the views as well, or the authority log — is the
service class the group registered (Section 9.3). Grantable,
narrowable capabilities, in particular for non-members, would be
promises without a sound way to exercise them toward services
(Section 15); a group that must share content with a non-member
today admits them.


## 7. Epochs

*In plain terms.* An epoch is a period in which one set of people
can read. Every operation that takes authority away starts a new
one. Who is in the new epoch is computed from the log, never
asserted by the operation; how the new secret is made and handed
out is the adapter's job (Section 9); that a service follows the
log only through signed, chained statements of who is in, is 7.3.

### 7.1 Transitions and the retained set

**RLTP-ACC-7010** — The retained set of an enforcement operation
MUST be computed as the members of the state materialized from its
ancestors, minus the operation's `subject` where it is a
`member.remove`, minus every member whose undischarged
`member.leave` lies in its ancestry; the retained set of a merged
state MUST be the members of the merged materialization minus its
pending exits, and in devices, minus the devices revoked in it; the
forked and the terminal state have no retained set, because no
transition is valid there.

**RLTP-ACC-7020** — A rotation MUST NOT shrink membership other than
by discharging the pending leaves in its ancestry.

**RLTP-ACC-7030** — An enforcement operation whose computed retained
set is empty MUST be rejected as invalid.

**RLTP-ACC-7040** — A transition's `newEpoch` MUST be its position's
epoch plus 1, and the epoch of any materialized state MUST be the
maximum `newEpoch` over the canonical transitions it contains, so
that concurrent transitions from one position share a number and
transitions of unequal depth merge under the deeper one.

**RLTP-ACC-7045** — The body section `transition` MUST carry
`newEpoch`, `keyOpDigest` (RLTP-ACC-9270) and the material binding
the adapter registration names (9.4); the transition envelope MUST
NOT contain plaintext secret material of the new epoch.

**RLTP-ACC-7050** — Members MUST apply transitions in ancestry
order, buffering on a gap and recovering material through the key
port or a key request (5.3).

**RLTP-ACC-7060** — A bootstrap across a span the adapter's chain
does not open MUST surface that span as narrowed.

**RLTP-ACC-7070** — An operation that removes or narrows standing
authority in a continuing group without carrying an epoch
transition MUST be rejected as invalid.

*Rationale.* The retained set is computed, not asserted, so that a
rotation can never be abused to expel anyone: the only way
membership shrinks at a rotation is by discharging leaves the
rotator causally knows of, and an adapter that reached anyone else
or missed anyone would violate KV2 (RLTP-ACC-9250). An empty
retained set has no next member to hold a next secret; the defined
ending is the drained dissolve (5.4). Two enforcements from one
position are two decisions about the same next epoch; they share
its number, and the key port merges their secrets (KV6), so the
epoch count stays a count of decisions, not of branches; where
one branch rotated twice and another once, the merged state is the
deeper epoch and the adapter binds both key states under it (KV6,
or the healing rotation of `linear/0.1`). The transition carries a
digest of its key operation and never the secret, because the log
remains readable to members of the old epoch, including the subject
of a removal. A merged retained set is computed from the merged
membership, never from the branches' sets alone: an intersection
would strip a member admitted on one branch of every key, and a
union would keep a member removed on one branch in. What a service
may rely on is weaker than it was under a totally ordered log:
within one epoch number the authorized set can shrink when a
concurrent enforcement merges in, so a stale view's safety rests on
its sequence, on the divergence rules and on its freshness bound
(7.3), not on the epoch number alone.

### 7.2 What rotation guarantees

**RLTP-ACC-7080** — Rotation yields prospective confidentiality:
new-epoch content MUST be unreadable to non-members of that epoch;
under an adapter declaring KV5 it also yields post-compromise
security against a captured device state.

**RLTP-ACC-7090** — An implementation MUST NOT present removal as
erasure.

*Rationale.* Keys and plaintext already held remain held; no
protocol revokes knowledge. What rotation revokes is the future.
Whether it also recovers from a device whose state an attacker
copied depends on the adapter (S7): a per-member list of sealed
keys cannot, a key tree with a fresh path can.

### 7.3 Authorization views

*In plain terms.* A service of class `view` never reads the log. It
learns who is in through a view: a signed, numbered statement of
the members' device identities, chained to the previous one and
signed by enough of them that no single member can lie. The price
is that a view cannot shrink below the number of signatures it
needs: a group that removes its whole quorum at once leaves the
service frozen until it registers again, so a group lowers the
quorum first, or uses a service of class `log`.

**RLTP-ACC-7100** — A service of class `view` MUST learn a group's
authorization state only through authorization views; a service of
class `log` materializes the log itself (9.3), and a service of
class `blind` holds no authorization state.

```json
{ "v": "rltp-access-view/0.24", "type": "authorization-view",
  "group": "did:key:z6Mk…group",
  "genesisDigest": "…the group's identity (3.2)…",
  "seq": 12,
  "epoch": 8,
  "identities": ["did:key:…device…", "…"],
  "m": null,
  "terminal": false,
  "prevView": "…digest of the seq-11 view's signature input…",
  "issuedAt": "2026-08-11T12:00:00Z",
  "validUntil": "2026-08-11T18:00:00Z",
  "sigs": [ { "signer": "did:key:…device…", "sig": "…" } ]
}
```

**RLTP-ACC-7110** — A view's signature input MUST be its JCS
serialization with `sigs` omitted, chaining by `prevView` and
naming the group by `genesisDigest`.

**RLTP-ACC-7120** — A view's `seq` MUST increase by exactly 1 and
its `epoch` MUST NOT decrease.

**RLTP-ACC-7130** — A view's `identities` MUST be the service
identities of the members at its position, pending exits included
until their discharging transition.

**RLTP-ACC-7140** — A view's `identities` MUST list one identity per
bound device of each member (5.1).

**RLTP-ACC-7150** — A service MUST authorize `read` and `write` only
by proof of possession of a listed identity over a service-issued
challenge.

**RLTP-ACC-7160** — A non-null `m` MUST satisfy `1 ≤ m ≤
|identities|` of its view and replaces the registered quorum size
from the next view on.

**RLTP-ACC-7170** — `issuedAt` and `validUntil` MUST be evaluated by
the service against its own clock within the declared skew bound.

**RLTP-ACC-7180** — A view MUST be signed by `m` distinct identities
listed in both the previous accepted view and the new view, where
`m` is the effective quorum size of the previous accepted view.

**RLTP-ACC-7190** — The effective quorum size of a view MUST be its
own non-null `m`, else the value 7.3 defines for ordinary and
reconciliation views; a view that lists fewer identities than the
quorum it must satisfy MUST be rejected, and a group that intends
to shrink below its quorum lowers `m` in a preceding view first.

**RLTP-ACC-7200** — The registered `m` at the genesis MUST be 1.

**RLTP-ACC-7210** — A view claiming a quorum of zero MUST be
rejected as invalid.

**RLTP-ACC-7220** — A group SHOULD raise `m` to at least 2 once it
has two announced identities.

*Rationale.* The view is a statement of who is in, by those who
are in; the intersection rule means a quorum can never remove
itself and hand the chain to nobody, and whoever a view expels
cannot sign it (the quorum-without-the-removed rule of the
conflict matrix). Identities are per device because a service
authenticates devices, not people, and because a lost device must
be removable alone (5.1). The quorum is taken from the previous
view and never from the new one: a blind service cannot tell an
honest shrink from a claimed one, and a rule that let the new
view's size cap the quorum would let one listed signer present
"members: me, quorum: one" and own the binding from then on. The
cost is stated: when concurrent removals honestly shrink the group
below its quorum, as when two of three members remove each other
(S10c), no view can be formed and the service freezes until the
group registers again; a service of class `log` materializes the
removals itself and has no such freeze. A singleton quorum is a
singleton point of misstatement; two signatures make every lie a
conspiracy.
What the view check buys is freshness, rollback protection and
identity listing by pseudonymous quorum, not policy enforcement,
which lives in the log; a colluding quorum can, within the
staleness bound the group itself declared, keep a removed identity
listed or omit a member, and both are attributable inside the
group because views are signed and chained.


**Registration (bootstrap).** At first contact a group binds itself
to a service by presenting a registration, a versioned wire artifact
(`schemas/access-registration.schema.json`):

```json
{ "v": "rltp-access-registration/0.27",
  "type": "service-registration", "group": "…", "genesisDigest": "…",
  "identity": "…", "service": "…", "m": 1, "class": "view",
  "stalenessBound": "…", "terminalRetention": "…", "divergenceQuota": …,
  "attestationKey": "…", "registrationGeneration": …,
  "previousRegistration": …, "authorizationRoot": …, "sig": "…" }
```

**RLTP-ACC-7230** — At first contact a group MUST present a
registration `rltp-access-registration/0.27` carrying exactly the
fields of the following table, `class` declaring the service class
per RLTP-ACC-9560 (9.3).

| Field | Content |
|---|---|
| `v` | `"rltp-access-registration/0.27"` |
| `type` | `"service-registration"` |
| `group` | the group DID |
| `genesisDigest` | the group's identity (3.2) |
| `identity` | the seq-0 derived service identity; root signer of the view chain |
| `service` | the one service this registration is for, compared by exact bytes (RLTP-ACC-7290) |
| `m` | the registered quorum size, `1` (RLTP-ACC-7200) |
| `class` | the service class: `"blind"`, `"view"` or `"log"` (RLTP-ACC-9560) |
| `stalenessBound` | whole days, `P1D` to `P30D` (RLTP-ACC-7550) |
| `terminalRetention` | the terminal grace window, day/time subset (RLTP-ACC-7560) |
| `divergenceQuota` | integer in [16, 4096], the full-artifact evidence bound (RLTP-ACC-7330) |
| `attestationKey` | the service's target-attestation key (RLTP-ACC-7240) |
| `registrationGeneration` | integer ≥ 1 (RLTP-ACC-7250) |
| `previousRegistration` | the superseded registration's `registrationCoreDigest`, or null iff the generation is 1 |
| `authorizationRoot` | signature-input digest of the sole-tip view this registration was authorized against, or null iff the generation is 1 |
| `sig` | signature under `identity` (RLTP-ACC-7270) |
| `authorization` | generation > 1 only: the quorum signatures of RLTP-ACC-7340 |
| `abandon` | generation > 1 only, optional: the block of RLTP-ACC-7370 |

**RLTP-ACC-7240** — The service's target-attestation key, the key
under which the service signs convergence targets (Replication
Contract §4), MUST be bound by the registration's
`attestationKey`.

**RLTP-ACC-7250** — `registrationGeneration` MUST be an integer
≥ 1, and `previousRegistration` and `authorizationRoot` MUST be
null exactly when it is 1.

**RLTP-ACC-7260** — `authorizationRoot` MUST be inside the
`registrationCoreDigest` and inside the quorum's signed input.

**RLTP-ACC-7270** — A registration's `sig` MUST verify under its
`identity` over its JCS serialization with `sig` omitted.

**RLTP-ACC-7280** — The seq-0 view MUST be signed by exactly the
registration's `identity`.

*Rationale.* The registration is the one place where a group tells
a service everything the service will hold it to; whatever is not
in it can later be asserted out of band, and an out-of-band
attestation key is a key someone else can substitute. The service
class is part of that statement: what a service learns about a
group is the group's choice, and without a declared class nobody
can tell what a service is entitled to see (9.3). Binding the
authorization root inside both the core digest and the signed
input means the checkpoint a quorum authorized against travels
with the signature and cannot be exchanged for another. The chain's
root signer is a named field, not an inference from the first view
that happens to arrive.

**RLTP-ACC-7290** — `service` MUST be compared by exact byte
equality of the UTF-8 string, without case folding,
percent-decoding, default-port or trailing-slash equivalence,
alias or DID resolution, or any other normalization.

**RLTP-ACC-7300** — A service MUST be configured with exactly one
canonical identifier string.

**RLTP-ACC-7310** — A service identifier SHOULD be a service DID or
an absolute `https` URI.

**RLTP-ACC-7320** — A service MUST reject a registration whose
`service` is not byte-identical to its configured identifier.

**RLTP-ACC-7330** — A registration with a missing field, a failing
signature, a duration outside its profile subset or a
`divergenceQuota` outside [16, 4096] MUST be rejected as invalid.

*Rationale.* If two services could parse one registration into two
behaviours, "a service the group chose" (Section 13) would name
nobody in particular. Exact bytes are the only comparison every
implementation computes alike; a deployment reachable under
several names picks one string and advertises exactly that one,
and two strings that differ in any byte name two services. The
same rule stops replay: a registration captured in transit cannot
bind the group at a different service, because that service's
identifier differs. A value out of range is never repaired by the
service, since a repaired registration is one the group did not
sign.

**Generations.** A service's registration state for a group is a
chain of generations. Generation 1 is the trust-on-first-use
bootstrap, self-signed as above. A later generation re-binds a
service whose attestation-key continuity ended (state loss, key
compromise, key loss; Replication Contract §4.1): it carries the
fresh `attestationKey`, and the target chain it roots begins its
standing there. Below, the *effective quorum* of a view is
`m_effective` per the quorum rule of this section (RLTP-ACC-7190),
its signers listed in that view's `identities`.

**RLTP-ACC-7340** — A registration of generation g+1 MUST carry
`authorization`: signatures by the effective quorum of the sole tip
of the service's held view chain.

**RLTP-ACC-7350** — While the service's view DAG holds more than
one tip, a g+1 presentation MUST wait, retriable, until a
reconciliation view restores the sole tip.

**RLTP-ACC-7360** — A service MUST NOT end a binding irreversibly
on the sole ground that reconciliation over its held tips is
unconstructible, that is, that the continuity cut of RLTP-ACC-7890
holds fewer identities than the quorum of RLTP-ACC-7870.

**RLTP-ACC-7370** — A registration of generation > 1 MAY carry an
`abandon` block `{ "abandonedRoot", "abandonedTipsDigest" }` inside
its core, its `authorization` then being signed by the effective
quorum of the named pre-divergence root; `abandonedRoot` is the
signature-input digest of the last pre-divergence sole-tip view,
and `abandonedTipsDigest` is the multihash over the UTF-8 bytes of
the JCS array of the abandoned tips' signature-input digest
strings, sorted by unsigned bytewise order.

**RLTP-ACC-7380** — Only a registration whose core contains an
`abandon` block MUST end a divergence irreversibly; an ordinary
g+1 registration MUST NOT be reinterpreted as an abandon.

**RLTP-ACC-7390** — An abandon's root and tip set MUST verify
exactly against the service's held view DAG; the tombstone then
freezes the named root, and a further g+1 presentation MUST verify
against exactly it.

**RLTP-ACC-7400** — Concurrent distinct abandons of one generation
MUST be treated as a registration equivocation, fail-closed, both
retained as evidence.

*Rationale.* A re-binding is an act of the group, so the quorum
that currently speaks for the group signs it; a stranger who knows
the previous registration has no signature to offer. While views
diverge there is no current quorum to ask, and picking one branch
for the rebind would make the service the judge of a dispute it
cannot see into, so the rebind waits. Momentary absence of a
reconciliation proves nothing: later views can restore the cut.
The only irreversible exit is an explicit abandon, signed by the
quorum of the last undisputed view and naming exactly the tips it
gives up; an ordinary rebind signed earlier is byte-distinct, so a
holder of it cannot replay it as an abandon. Where that quorum can
no longer sign either, the honest outcome is a new service
identifier: waiting forever is not an outcome, and neither is a
verdict the service reaches on its own.

**RLTP-ACC-7410** — The `authorization` quorum MUST sign,
domain-separated, the JCS serialization of the registration with
`sig` and `authorization` omitted and `authorizationRoot`
included.

**RLTP-ACC-7420** — A registration whose view closure proves a root
other than its `authorizationRoot` MUST be rejected as invalid.

**RLTP-ACC-7430** — A registration's identity for every purpose
(generation identity, equivocation judgment,
`previousRegistration` linkage, tombstone) MUST be its
`registrationCoreDigest`, the multihash over the JCS serialization
of the registration with `sig` and `authorization` omitted.

**RLTP-ACC-7440** — Two registrations of one generation whose core
digests differ MUST be treated as a registration equivocation,
fail-closed, both retained as evidence.

**RLTP-ACC-7450** — Before superseding, a service MUST verify a g+1
registration against its own held view chain, its
`authorizationRoot` being the service's current sole tip.

*Rationale.* Every security parameter (`stalenessBound`,
`terminalRetention`, `divergenceQuota`, `m`, `class`) and the root
itself fall under the quorum's signature, so none of them can be
loosened after the quorum signed. One digest serves every purpose
because two digests for one registration would let proof bytes
create chain identity: a re-signed copy would count as a second
generation. Signers are distinct and sorted by unsigned bytewise
order, so the signature set has one form and conformance can check
it. The check against the service's own sole tip is what stops a
party that merely knows the prior digest from re-rooting the chain
at a view of its choosing.

**RLTP-ACC-7460** — Toward a third party, a g+1 generation MUST
serve as a verification root only through the verifier's own live
session with the exact-byte service, which attests the current
generation, or through the `previousRegistration` core chain from
that generation into a session-attested generation; absent that
anchor, every evidence bundle MUST be `invalid-bundle`.

**RLTP-ACC-7470** — An acceptance artifact (receipt or statement of
acceptance) MUST NOT exist.

**RLTP-ACC-7480** — Registration acceptance, tombstone advance and
the new target chain's initial state MUST be one durable service
commit, conditioned on the expected prior generation,
`previousCore`, tombstone status and sole tip still holding inside
the commit, or nothing advances.

**RLTP-ACC-7490** — A service SHOULD issue the first target of a
new generation promptly upon acceptance.

*Rationale.* "Newest" is not a property anyone can verify locally:
a presenter choosing its own checkpoint cannot prove that nothing
later exists. An acceptance artifact would have to prove its own
acceptance, which no artifact can; so acceptance is anchored in
the present, in the verifier's own session with the service, and
older generations are proven by the chain that leads into it. Two
candidates validated in parallel against the same prior state
would otherwise both be accepted; a compare-and-swap inside one
commit yields exactly one. Between acceptance and the first target
of the new generation nothing outside the service proves the
acceptance; from the first target on, the targets themselves,
signed under the new key and bound to the registration core, are
the transportable evidence, so that window should be short. A
substituted generation the service never accepted has neither a
successor binding nor a session attestation, however valid its
closure looks.

**RLTP-ACC-7500** — Only generation 1 MUST have a seq-0 view.

**RLTP-ACC-7505** — A g+1 registration MUST restart only the target
chain, the view chain continuing unbroken.

**RLTP-ACC-7510** — A registration MUST be rejected unless its
`registrationGeneration` is exactly one above the accepted one and
its `previousRegistration` matches the accepted registration's
`registrationCoreDigest`; an accepted g+1 registration supersedes
generation g.

**RLTP-ACC-7520** — Per `(genesisDigest, service)` a service MUST
retain, through every discard, the terminal grace discard
included, a tombstone: the highest accepted generation, its
digest, its status (`active | superseded | terminal`), and the
last authorization root as digest skeleton of the last sole-tip
view (its `identities`, effective `m` and signature-input digest).

**RLTP-ACC-7530** — After a terminal discard, generation 1 MUST NOT
be eligible for trust-on-first-use again for that pair; a return
MUST be a g+1 registration authorized against the retained root,
and a tombstone without a root MUST close the pair permanently.

**RLTP-ACC-7540** — Targets under a superseded attestation key MUST
NOT have serving standing; they keep their evidence value,
equivocation proofs included.

*Rationale.* Generations never decrease, so a replayed old
registration cannot reopen a superseded generation or its keys.
The tombstone is tiny and survives every discard because it is
exactly what a later g+1 verification needs after the full state
is gone; without it a replayed generation-1 registration would
restart trust-on-first-use for a group that already had a chain.
A fresh start after a rootless tombstone needs a new service
identifier. Replay at the same service after a terminal discard
rebinds only the group's own chain, which the replayer cannot
extend; that is the trust-on-first-use residual of Section 12.

**RLTP-ACC-7550** — `stalenessBound` MUST be whole days only, from
`P1D` to `P30D`.

**RLTP-ACC-7560** — `terminalRetention` MUST use exactly the
day/time subset of ISO 8601 (`P<d>D`, optionally `T<h>H<m>M<s>S`
components in descending order, at least one component, each value
1 to 3 digits, no years, months or weeks), with fixed-length
arithmetic (`1D` = 86 400 s).

**RLTP-ACC-7570** — The seq-0 view MUST be accepted only if its
`seq` is 0, its `prevView` is null and it is signed by the
registration's `identity`; from seq 1 on the quorum rule of this
section applies.

**RLTP-ACC-7580** — On first registration a service MUST bind
`genesisDigest` to the chain and persist `stalenessBound`,
`terminalRetention` and `divergenceQuota`.

**RLTP-ACC-7590** — `terminalRetention` SHOULD default to `P30D`.

**RLTP-ACC-7600** — `divergenceQuota` SHOULD default to 64.

*Rationale.* The staleness bound is shared with the Replication
Contract, so both sides of the port fail closed at the same
boundary, and the schema enforces it as stated. Calendar
arithmetic (months, leap years) would let two services compute
different expiries from one string; fixed-length days do not. The
seq-0 view is the only view with a null parent, which makes it
unforgeable as a second root. Binding the genesis digest on first
registration is trust on first use at the service boundary
(Section 12); everything later is checked against that binding.
The registration also confers the `relay` role on the service
(Section 6), which ends with deregistration or a terminal view.

**Service obligations.** A service holding a view chain has five
obligations; obligations 1 to 4 are RLTP-ACC-7610 to RLTP-ACC-7660,
obligation 5 (never a winner-picker) is RLTP-ACC-7670 to
RLTP-ACC-7940.

**RLTP-ACC-7610** — A service MUST accept a view only with
`seq + 1`, matching `prevView`, matching `genesisDigest`,
non-decreasing `epoch` and valid quorum signatures per the quorum
rule of this section.

**RLTP-ACC-7620** — A service MUST accept a view only if
`issuedAt ≤ validUntil ≤ issuedAt + stalenessBound` and `issuedAt`
lies no further than the declared skew bound past the service's own
clock.

**RLTP-ACC-7630** — A service MUST NOT accept an unauthenticated
assertion of authorization.

**RLTP-ACC-7640** — A service MUST reject a view whose `epoch` is
below the chain's current epoch.

**RLTP-ACC-7650** — When the newest accepted view's `validUntil`
lies more than the skew bound in the past, a service MUST fail
closed for epoch-sensitive decisions until a fresh view arrives.

**RLTP-ACC-7660** — On a `seq` gap, a `prevView` mismatch, an
unknown group or any other inconsistency, a service MUST reject,
never look up or guess.

*Rationale.* Checking both ends of the validity window means
neither a year-9999 `validUntil` nor a future-dated `issuedAt`
extends a view's life. Epoch monotonicity is the rollback
protection: within one epoch the authorized set only grows, so
replaying an older view of the same epoch can only shrink what the
service accepts, which is denial and never authority, and a view of
a superseded epoch is rejected outright. A view carries no log
heads: a service of class `view` cannot read the log, and a view
claims nothing a service cannot check. Without a freshness bound a
stale view would keep a removed member served indefinitely. A
service that looks up or guesses on inconsistency has made itself
an authority over the group.

**RLTP-ACC-7670** — On two individually valid views with the same
`(genesisDigest, seq)`, or on any divergence from one `prevView`,
sibling epochs and a disputed `terminal` included, a service MUST
enter a persistent fail-closed state for the group and durably
retain the artifacts as evidence.

**RLTP-ACC-7680** — While fail-closed, a service MUST hold the DAG
of every view it has accepted or retained (each view naming its
parents in `prevView`, singular or array) and MUST keep admitting
valid views into it: ordinary views whose parent is held, divergent
views opening a branch, reconciliation views joining branches.

**RLTP-ACC-7690** — A service MUST reject outright, and never admit
as divergence evidence, a view whose ancestry does not pass through
its anchor.

**RLTP-ACC-7700** — A service's anchor MUST be the seq-0 view at
registration and MUST advance by exactly one rule: on accepting a
view whose parent is the current sole tip T, the anchor becomes T.

*Rationale.* A service that picks a winner between two valid views
decides a dispute about authority it has no standing in; it can
only refuse and keep the evidence. Refusing must not mean
forgetting: if the service stopped admitting views while
fail-closed, no reconciliation could ever reach it. The anchor is
the last single-tip view the chain has built beyond, not the live
head: a view the service accepted but did not yet build on stays
contestable, so a sibling of the live head, a false terminal view
included, enters as ordinary divergence evidence. Ratcheting on the
live head would discard exactly that evidence. Below the anchor,
the ratchet keeps a fabricated branch out of the machine entirely;
a fork at the anchor is legal, and what keeps an expelled quorum
from winning it is the continuity cut of RLTP-ACC-7890, not the
ratchet. Services that accepted different sides of an equivocation
before converging have ratcheted apart, and the disadvantaged
binding ends in re-registration; an honest quorum never
equivocates, so the ratchet prices only equivocation.

**The evidence contract.** All admission runs under one contract:
the service persists bounded accepted evidence, the bound enforced
and not derived; everything beyond it is supplied by the presenter,
verified by digest linkage to what is held, and bounded per
presentation. A skeleton entry is the service's durable record
that it once fully verified and accepted exactly that view: per
accepted view its signature-input digest, its parent digests and
its `seq`.

**RLTP-ACC-7710** — A service MUST NOT discard its anchor or its
current tips.

**RLTP-ACC-7720** — A service MAY drop a full view artifact once
its view is no longer a tip, full artifacts being bounded by the
registered `divergenceQuota`.

**RLTP-ACC-7730** — A service's digest skeleton MUST hold at most
8 × `divergenceQuota` entries.

**RLTP-ACC-7740** — A service MAY compress linear skeleton runs
(one parent, one child) to their endpoints at any time.

**RLTP-ACC-7750** — At the skeleton bound a service MUST compact by
discarding interior skeleton entries, never the anchor and never a
tip, compressed runs first, then whole reconciled fork-join
regions.

**RLTP-ACC-7760** — A presented full artifact whose signature-input
digest matches a held skeleton entry MUST be readmitted as evidence
without re-verification, and a view segment presented to span a
compressed run MUST verify by digest chaining against the run's
endpoints.

*Rationale.* A single legitimate signer under `m = 1` could mint
unbounded valid siblings; without a hard bound, conformance would
mean unbounded storage. The bound holds in every DAG shape by
construction: quota-many full artifacts plus eight times as many
skeleton entries. Cheap linear spam collapses to run endpoints, and
a ladder of repeated fork-and-reconcile against a held-open tip
fills the skeleton budget and is compacted instead of growing a
branching record without limit. Compaction forfeits only the
readmission shortcut, never safety: a compacted view, when needed
again, is re-presented and verified in full like a never-seen one.
Readmission makes a held view's `identities`, `m` and `epoch`
available again to check a new child or sibling, so late arrivals
need no state the service did not keep.

**RLTP-ACC-7770** — A service MUST accept any presentation,
ordinary, divergent or reconciliation, that is accompanied by the
ancestor views it needs down to digest linkage with held evidence
(skeleton or full).

**RLTP-ACC-7780** — A presentation MUST carry at most
`closureBound` = 256 views, a profile constant; a larger bundle, or
one missing its closure within the bound, MUST be rejected
retriable.

**RLTP-ACC-7790** — A service SHOULD rate-limit presentations per
`genesisDigest` and presenter, never per group DID.

**RLTP-ACC-7800** — Presenters of sibling geneses under one group
DID MUST NOT share a rate budget.

*Rationale.* Every chain roots in the seq-0 view or the anchor,
which are always retained, so a never-seen branch verifies
recursively from held evidence. A longer chain enters
incrementally: each presentation roots in evidence held or
admitted earlier, and each newly verified view is admitted as
skeleton, consuming budget. Per-presentation work is thereby
bounded by `closureBound` times the schema-capped view size, a
protocol bound rather than a presenter's promise. The number of
presentations is deliberately not a protocol bound; it is the
presenter's own effort, and rate limiting prices it. A sibling
genesis under the same DID is a different group (3.2); a shared
budget would let one exhaust the other's.

**RLTP-ACC-7810** — At the quota a service MUST drop non-tip full
artifacts, keeping their skeleton entries, to admit
otherwise-acceptable evidence, smallest `seq` first, ties broken by
the unsigned bytewise order of the signature-input digest.

**RLTP-ACC-7820** — A presentation, a single view or a bundle with
a reconciliation, MUST be judged as an atomic whole and accepted
only if every named parent is held or supplied within the bundle
and either the service, after eviction, has quota headroom for the
bundle's full artifacts or applying the whole bundle strictly
reduces the derived tip count; otherwise it MUST wait, retriable.

**RLTP-ACC-7830** — A service MUST derive its divergence tips as the
maximal elements of its held view DAG, every held view that is not
an ancestor of another held view.

*Rationale.* Eviction is a MUST because a MAY would let two honest
services diverge on the same evidence: headroom has to be a
deterministic function of the held DAG, not of a local retention
choice. At the quota with no headroom the service is
evidence-saturated and rejects further tip-increasing
presentations. The exemption for reconciliation exists only
because reconciliation shrinks the divergence, so a
"reconciliation" over long-joined historical parents that does
not shrink it has no claim to it. The exit is guaranteed in every
shape: a join of a service's own current tips is always
tip-reducing; the joined tips become non-tips and are evicted,
which frees headroom; a branch the service has never seen then
enters below the quota; the global join lands as tip-reducing.
Two services saturated on disjoint evidence converge through
exactly this sequence. The transient overshoot of an atomic
acceptance is bounded by `closureBound`, provisioned per
presentation and reclaimed on acceptance. Deriving tips from the
DAG, rather than keeping them as a register, makes the machine
convergent: DAG union is commutative, so two services holding the
same views hold the same tips, whatever the arrival order. What
view spam still buys is the fail-closed state any misbehaving
quorum can force, at bounded cost, and `m ≥ 2` makes it a
conspiracy.

**Reconciliation views.** The fail-closed state is cleared only by
reconciliation views. A view's *registered quorum size*
`m_registered` is defined recursively over the DAG: the view's own
`m` where that is non-null; otherwise, for a reconciliation view,
the maximum of the registered quorum sizes of its named parents;
otherwise its single parent's. The recursion terminates at the
seq-0 view, whose size is the registration's `m`.

**RLTP-ACC-7840** — A reconciliation view MUST name two or more
divergent views in `prevView` (array form).

**RLTP-ACC-7850** — A reconciliation view MUST name, in a
`predecessor` field, the digest of one accepted view that is an
ancestor of every named parent and whose `seq` is at least the
`seq` of the service's anchor.

**RLTP-ACC-7860** — A reconciliation view MUST carry `seq` = 1 +
the maximum `seq` over its named parents and an `epoch` at least
the maximum `epoch` over its named parents.

**RLTP-ACC-7870** — A reconciliation view MUST be signed by
`min(m_registered, |identities|)` distinct identities, where
`m_registered` is the maximum of the registered quorum sizes over
its named parents and `identities` is the reconciliation view's
own.

**RLTP-ACC-7880** — The registered quorum size of a view MUST be
computed by the recursion above, from the artifacts the presenter
supplies, with exactly one value per view.

**RLTP-ACC-7890** — Each signer of a reconciliation view MUST be
listed in the `identities` of every named parent and in the
reconciliation view's own `identities`.

**RLTP-ACC-7900** — A service MUST accept a reconciliation view
only if it holds every named parent somewhere in its DAG, as tip
or ancestor; on a named parent it does not hold, it MUST reject,
retriable after that parent has been presented.

**RLTP-ACC-7910** — A service's fail-closed state MUST end exactly
when its derived tip set has one element.

*Rationale.* Two honest views can list different identity sets:
when two removals with authority take effect concurrently (3.6),
each branch's view drops its own subject, and the reconciliation
is what brings the two lists together (S4b). After a mutual
removal the remaining set can be smaller than any quorum
registered before; taking the quorum from the reconciliation's own
`identities`, capped by the strictest registered size of the
parents, lets the remaining members sign the join instead of
freezing the service with the removed members still served
(S10c). The continuity cut is what makes a takeover impossible:
were the quorum drawn from the historical `predecessor` alone, an
expelled quorum could fork at the anchor and join its own fork over
the very view that removed it; a signer excluded by any named
parent never signs the join. The predecessor is an ancestry floor
and nothing more. "Maximal among the common ancestors" is a claim
of non-existence no bounded evidence can check; the anchor always
qualifies, so a qualifying predecessor always exists, and which one
serves is the quorum's open, signed choice. Every requirement is a
function of what the view names, so acceptance does not depend on
which tips a particular service happens to hold; parents' lists
come from their full artifacts, by readmission or re-presentation.
Where the cut holds fewer identities than the quorum, no
reconciliation is constructible and the binding ends in
re-registration: denial, attributable, never a takeover.
Acceptance is deterministic in the service's evidence; services
holding different view sets converge when the views reach them,
and responsibility for a reconciliation's content lies in the
group's log, never at a service.

**Terminal views.**

**RLTP-ACC-7920** — A terminal view contradicted by a valid view
MUST be handled as a divergence under RLTP-ACC-7670 to
RLTP-ACC-7910.

**RLTP-ACC-7930** — A terminal view MUST carry its predecessor's
`identities` unchanged, as the attesting set.

**RLTP-ACC-7940** — On accepting a terminal view, a service MUST
keep the group binding for the registered `terminalRetention`,
measured from its own acceptance of that view, in a state that
denies every authorization and ends the `relay` role but stays
chain-continuable, and MUST discard the binding only after the
window passes undisputed.

*Rationale.* A terminal view is final only as the chain is: a
malicious quorum member can force the fail-closed state by issuing
one, but not dig a permanent grave, because the group's next honest
view contradicts it. The listing in a terminal view authorizes
nothing, since capabilities ended with the group; it exists so the
quorum and intersection checks stay evaluable. The service's own
acceptance time is the one point every service can determine
locally. Denial is the terminal state's whole effect anyway, so
the grace window costs nothing in authority and turns a false
terminal view into recoverable evidence instead of an irreversible
deregistration. A false terminal view left undisputed past the
window ends the binding, and the group re-registers.


## 8. Visibility Modes

*In plain terms.* By default only members can read a group's
content. A group can decide to open its content to everyone from
some point on; that never opens the list of members or the record
of decisions. Older content becomes public only by a separate,
recorded decision, and closing a group again cannot make the world
forget what it already could read.

**RLTP-ACC-8010** — The default visibility mode MUST be `private`, in
which reading content requires membership.

**RLTP-ACC-8020** — In `open` mode, document content from epoch `E`
onward MUST be world-readable, and writing MUST remain
membership-bound.

**RLTP-ACC-8030** — In `open` mode, the ciphertext of attached
documents and the published content keys MUST be exposed to
non-members through the publication port (Section 10).

**RLTP-ACC-8040** — In `open` mode, the authority log, the admission
evidence, and the membership MUST stay sealed to non-members other
than a service the group registered with class `log` (Section 9.3).

*Rationale.* Membership is the default gate. `open` opens content,
never membership: the log stays readable only as RLTP-ACC-3020
states, in every mode. Mechanically, the content keys from `E`
onward are published through the group's open content channel;
moderation is policy. A service of class `log` reads the log
because the group chose so, not because the group's content is
open.

**RLTP-ACC-8050** — The stated `E` of a `visibility.change` MUST
equal its transition's `newEpoch`.

**RLTP-ACC-8060** — An implementation MUST NOT suggest that closing
makes previously world-readable content unreadable.

*Rationale.* A visibility change opens only from its own new epoch
onward; anything earlier would be a retroactive opening without the
decision `history.expose` requires. Closing takes effect from
`newEpoch`; what was world-readable remains so factually, and
knowledge cannot be withdrawn.

**RLTP-ACC-8070** — `history.expose { fromEpoch, toEpoch?, keys }`
MUST be valid only where the materialized visibility at its
declared position is `open`, with `fromEpoch` earlier than the
opening epoch `E`, and MUST be the only way to expose content of
epochs before `E`.

**RLTP-ACC-8080** — A present `toEpoch` MUST satisfy
`fromEpoch < toEpoch ≤ E`; an absent `toEpoch` defaults to `E`.

**RLTP-ACC-8090** — `keys` MUST contain exactly the content keys of
the epochs `[fromEpoch, toEpoch)` in the form the group's adapter
defines (for `linear/0.1`, 9.4.1), each verified at
materialization against the log's binding of its epoch (Section
9.2).

**RLTP-ACC-8100** — One `history.expose` MUST cover at most 4096
epochs.

**RLTP-ACC-8110** — On merging a `history.expose`, members MUST
publish the disclosed keys through the open content channel of
current keys.

**RLTP-ACC-8120** — Historical keys MUST NOT be published by any
other mechanism.

*Rationale.* Exposing history is a deliberate, logged act whose
body is the disclosure itself (default rule `strongest`, 4.1). The
binding check makes a false or missing key in the publication a
byte-level verdict rather than a matter of trust. 4096 is the
schema's wire cap; a longer history is exposed by several
operations with adjacent ranges, so a group past 4096 epochs can
still construct the artifact its own rule demands. Within the
replica, merging the operation is the disclosure; toward the world,
it creates an immediate publication duty, and the log entry is the
group's attributable record that it disclosed. Any other mechanism
would be disclosure nobody decided.

**RLTP-ACC-8130** — A `visibility.change` concurrent with a removal
MUST NOT fork the group; the two MUST be merged as the pairing
rules of Section 3.6 state.

*Rationale.* A visibility change is an enforcement operation with a
key operation of its own, and so is a removal; neither claims
authority over the other's subject, and an adapter declaring KV6
merges their secrets (Section 9.2); under an adapter without KV6 the
group issues enforcement operations one at a time
(RLTP-ACC-9315). A fork would punish a harmless combination and
stop the group. A `visibility.change` concurrent with a
`policy.change` still forks, as every enforcement operation
concurrent with a constitutional change does (Section 3.6).


## 9. The Two Ports and the Service

*In plain terms.* This layer decides who belongs to a group and
what they may do. It does not invent the cryptography that keeps
content private. Those are two different jobs, and this section
keeps them apart. The **authority port** is the deciding part: the
log, the conflict matrix, the policy, the views. It is this
layer's own and nothing can replace it. The **key port** is the
interface to the machinery that turns each decision into a new
secret only the right people hold; a registered **adapter** fills
it, and two adapters are registered today. Between the members
sits, optionally, a **service** that stores and forwards; it
declares how much it knows about the group, from nothing to
everything, and whatever it knows, it never silences a decision
and never drops a member without telling them.

### 9.1 The authority port

**RLTP-ACC-9010** — The authority port — log, materialization,
conflict matrix, policy and authorization views — MUST be this
layer's own and MUST NOT be replaceable by an adapter.

**RLTP-ACC-9020** — Replication MUST transport the operation
envelope (3.3) with its signature input unmodified; the `proof`
accumulator is the only field replicas merge.

**RLTP-ACC-9030** — Every replica's materialization MUST evaluate
this layer's validity and canonicality rules (3.4, 3.5, 3.6, 5.3).

**RLTP-ACC-9040** — An operation this layer rejects MUST NOT take
effect in any replica's materialization.

**RLTP-ACC-9050** — A replica ingesting raw replicated state MUST
reach the same verdicts as one fed through any API.

**RLTP-ACC-9060** — Only key operations resulting from canonical
authority decisions MUST be handed to the key port.

*Rationale.* Whoever decides membership decides everything else;
if that decision could be outsourced to replaceable machinery with
its own merge rules, two groups running different machinery would
reach different answers to the same log, and that machinery's tie-break
would silently become the group's constitution. The deciding part
is therefore fixed, and the key port receives only its results: no
key operation enters the key structure without a canonical
authority decision behind it. Machinery that re-signs, re-wraps
or re-orders signed operations would make the envelope stop being
the sole carrier of authority.

### 9.2 The key port

*In plain terms.* Every decision that takes authority away must
produce a fresh secret that the person who lost it cannot derive.
The port states six properties of that secret and leaves the
procedure to the adapter.

**RLTP-ACC-9230** — Every enforcement operation MUST yield an epoch
secret that no member it removes can derive (KV1).

**RLTP-ACC-9240** — Every new epoch secret MUST be generated from a
cryptographically secure random source, independent of every prior
epoch secret of the group.

**RLTP-ACC-9250** — Every new epoch secret MUST reach exactly the
computed retained set (7.1), and under concurrency exactly the
merged retained set (KV2).

**RLTP-ACC-9260** — The authority log MUST bind each epoch to its
secret without containing the secret (KV3).

**RLTP-ACC-9270** — Every enforcement operation and the genesis
MUST carry `keyOpDigest`, the digest of its key operation as its
adapter defines it.

**RLTP-ACC-9280** — A member holding the current epoch secret and
the replica MUST be able to read history as far as the adapter's
chain reaches (KV4).

**RLTP-ACC-9290** — The welcome MUST carry the current epoch only;
history material MUST live in the replica.

**RLTP-ACC-9300** — An adapter declaring KV5 MUST let every member
force a new epoch secret without a membership change, after which
a passive reader holding a captured device state reads nothing
new (KV5).

**RLTP-ACC-9310** — An adapter declaring KV6 MUST merge two
concurrently arising epoch secrets deterministically without
forking the group (KV6).

**RLTP-ACC-9315** — An adapter MUST satisfy KV1 to KV4 and MUST
declare in its registration whether it satisfies KV5, and how it
satisfies KV6: by merging secrets, or by a healing rotation as
9.4.1 defines; a group using an adapter that heals SHOULD avoid
issuing concurrent enforcement operations.

*Rationale.* The six invariants are what every tested key
procedure either has or measurably lacks. KV1 and KV2 are the
removal itself: a removed member who still derives the next
secret was not removed (S2), and a secret that misses a retained
member locks out someone the log kept (S3). KV3 is what lets a
replica check that the secret an adapter produced is the one the
decision meant, without the log ever carrying the secret: the
digest in the enforcement operation binds decision and key
operation into one artifact, so neither can be swapped under the
other. KV4 is why history lives in the replica and never in the
welcome: a welcome bounded by its plaintext budget cannot carry a
group's past, and a replica that carries it under a chain of keys
can. KV5 is the only answer to a captured device: a secret the
captured device helped derive is compromised, and the next one
must not be (S7). KV6 is what the conflict matrix of 3.6 rests on:
two authorized enforcements produce two secrets, and a group
whose adapter cannot merge them would have to fork. The adapter
deployed today cannot merge; it heals instead, by a rotation over
the merged state that every key holder owes on sight (9.4.1), and
it has no post-compromise security against a captured device; it
says both in its registration.

**Healing and replay.**

**RLTP-ACC-9320** — The key port MUST correct its key structure to
the materialized membership whenever the two differ; the
membership MUST NOT follow the key structure.

**RLTP-ACC-9330** — A concurrent key-structure change MUST take
effect for each device at the latest with that device's next own
key operation.

**RLTP-ACC-9340** — Under an adapter whose chain does not make
history readable to a newly admitted member at once, the
admitting member MUST write an entry under the new epoch secret
immediately after the admission.

*Rationale.* An admission that the conflict matrix later disposes
has already put a leaf into the key structure (S4f); a member
admitted concurrently with a transition is in the log but not yet
in the new epoch (3.6). In both cases the key structure is wrong
and the log is right, and the direction of correction is never in
doubt: the log decides, the keys follow. Tree-shaped procedures
apply concurrent structural changes when a device next acts, so a
device's view of the structure may lag; an adapter must say by
when it catches up, or a member could read a secret the structure
had already withdrawn. Where history reaches a new member only
through the key chain of the next entry, the group would otherwise
sit dark until someone happens to write (S6).

### 9.3 The service

*In plain terms.* A service stores and forwards. It may know
nothing about the group, or only who is in it, or the whole log;
the group chooses, and the service declares it. Whatever it knows,
four duties hold: it carries every authority operation whether or
not it likes the author, it never drops anything silently, it
tells a member it has stopped serving them, and it never freezes
on a membership that honestly shrank.

**RLTP-ACC-9560** — A registration (7.3) MUST declare the service
class `blind`, `view` or `log`.

**RLTP-ACC-9570** — A service MUST NOT receive more of a group than
its declared class grants: `blind` ciphertext only, `view` also
authorization views, `log` also the authority log.

**RLTP-ACC-9500** — A service MUST NOT gate the transport of
authority operations it receives, whoever authored them, nor of
the key operations an authority operation binds by `keyOpDigest`.

**RLTP-ACC-9510** — A service of class `view` or `log` MUST gate
content and loose key operations by the authorization state it
holds, and MUST serve only devices that state lists.

**RLTP-ACC-9520** — A service MUST NOT discard an accepted item
silently.

**RLTP-ACC-9530** — A service's rejection MUST be visible to the
sender and retriable.

**RLTP-ACC-9535** — A service MAY bound its intake by size, rate
and syntactic validity per sender, visibly and retriably, and MUST
NOT bound it by the sender's membership or by the author of an
authority operation; a valid authority operation presented within
the bound MUST eventually be admitted.

**RLTP-ACC-9540** — A service that stops serving a removed member
MUST deliver the removal notice (10.2) to that member once a member
hands it the notice.

**RLTP-ACC-9542** — The author of a canonical removal, or any member
materializing it while no notice exists, MUST produce the signed
removal notice (10.2) and hand it to every service of the group
for delivery.

**RLTP-ACC-9545** — A service of every class MUST register (7.3); a
service of class `view` MUST hold the view chain and meet the
service obligations of 7.3, and a service of class `log` MUST
materialize the log by this layer's rules (9.1) in their place.

**RLTP-ACC-9550** — A service of class `view` MUST apply the quorum
rule of 7.3 unchanged; a view that lists fewer identities than the
quorum it must satisfy is rejected, and the resulting freeze is the
stated residual of that class.

*Rationale.* How much a service knows is a privacy choice the
group makes for itself: a group that runs its own service may hand
it the log, a group that rents one may want it blind, and a
service used by many groups learns, in class `view`, device
identities it could correlate across groups (Section 13). What no
class may do is bend the group's decisions. A service that drops
an authority operation because its author is not a member in the
service's current state destroys the conflict matrix: a mutual
removal is then seen by one side only, the two sides' replicas
materialize different groups, and a view-based service freezes on
a state nobody holds (S10c). Authority operations are evidence,
and evidence is never gated; what a service gates is effect —
content and key operations from a device it does not serve
(S10a). Silent discarding leaves a writer believing an entry
exists that nobody will ever read; a visible, retriable rejection
lets the writer bring the missing view first. A member the
service stops serving no longer receives the operation that
removed them, so without a notice they learn of their removal
only when their next write fails (S10c); the notice is a delivery
to one party and is specified by the Delivery Contract; who removed
whom, under which anchor, by which operation, a `view` service
cannot know, so it cannot write the notice: the members write it
and the service carries it. A view whose identities shrink below
the previous quorum is, to a blind service, indistinguishable from
a listed signer shrinking the group to itself; the freeze is the
price of blindness, and a group that cannot pay it lowers its
quorum first or registers a service of class `log` (7.3). Evidence
that is never gated still needs a floor under it: a service may
refuse what is too large, too frequent or malformed, as long as it
never refuses because of who sent it, and as long as valid evidence
within the floor gets through.

What each class receives and learns is tabulated in Section 13.

### 9.4 Registered adapters

**RLTP-ACC-9200** — An adapter registration MUST name its
key-agreement procedure, its closed `keys` schema, the form of its
`keyOpDigest`, and whether it satisfies KV5 and KV6.

**RLTP-ACC-9210** — An adapter MUST NOT disclose key material,
welcome material, history keys or document plaintext to any party
other than those this layer names as entitled.

**RLTP-ACC-9220** — An adapter MUST meet the privacy floor of
Section 13.

**RLTP-ACC-9350** — An adapter MUST produce, at genesis, at each
enforcement operation and for each admission or entitled key
request, the key material the log binds.

**RLTP-ACC-9360** — `v`, `adapter` and `epoch` of a material object
MUST be this layer's, and `keys` MUST be closed by the adapter
registration.

**RLTP-ACC-9370** — Welcome material MUST be re-derivable at any
later materialized position of the same epoch.

**RLTP-ACC-9380** — Welcome material MUST fit the welcome plaintext
budget (Membership §4).

```json
{ "v": "rltp-access-material/0.24", "adapter": "linear/0.1",
  "epoch": 7, "keys": { …per the adapter registration… } }
```

*Rationale.* An adapter handles key material; no port rule can make
a malicious key handler safe. The trust boundary is therefore
named and kept small: what an adapter must produce, when, and to
whom, is stated here, and the rest is audit.

#### 9.4.1 `linear/0.1`

*In plain terms.* The adapter deployed today. One fresh content
key per epoch, sealed to every retained member one by one, with
the previous key embedded under the new one so history stays
readable. It cannot merge two concurrent enforcements; when they
meet, the first key holder to see both rotates once more over the
merged group, and until then nobody writes. It offers no
post-compromise security against a captured device.

**RLTP-ACC-9700** — Under `linear/0.1`, the `keyDist` recipient set
MUST equal exactly the bound, unrevoked devices of the computed
retained set, one entry per device, without omission, stranger or
duplicate.

**RLTP-ACC-9710** — Under `linear/0.1`, `contentKeyCommitment` MUST
be the multibase multihash over the raw 32 content-key bytes.

**RLTP-ACC-9720** — Under `linear/0.1`, a transition whose
`contentKeyCommitment` equals an earlier epoch's commitment in the
group MUST be rejected as invalid.

**RLTP-ACC-9730** — Under `linear/0.1`, `keyDist` MUST be an array
with one `{ "recipient": <device did:key>, "envelope": <digest> }`
entry per retained device, `envelope` being the digest of the
sealed key envelope.

**RLTP-ACC-9740** — Under `linear/0.1`, a key envelope MUST be the
Delivery §5 seal with HKDF info `rltp/v1/keydist`, AAD the UTF-8
bytes of the JCS serialization of `{ "genesis": <group identity,
canonical u>, "newEpoch": <integer>, "recipient": <device did:key
string> }`, and the keydist object as plaintext.

**RLTP-ACC-9750** — Under `linear/0.1`, a key envelope MUST be
sealed to the recipient device's current key-agreement key (its
device card, 5.1) and travel via `key-delivery` (10.1).

**RLTP-ACC-9860** — Under `linear/0.1`, `keyOpDigest` MUST be the
multibase multihash over the JCS serialization of the operation's
`keyDist` array, the empty array at the genesis.

**RLTP-ACC-9865** — Under `linear/0.1`, a member who materializes two
concurrent canonical transitions and holds either secret MUST issue
an `epoch.rotate` over the merged state at once; until a rotation
whose ancestry contains both transitions is canonical, writes MUST
fail closed and each member reads under the sibling secrets it
holds. This is the adapter's KV6.

**RLTP-ACC-9840** — Under `linear/0.1`, `keys` MUST contain exactly
`contentKey`, the epoch's 32-byte AES-256 content key.

**RLTP-ACC-9850** — Under `linear/0.1`, every other key MUST be
derived from the content key; the working key is `HKDF-SHA256(salt
= empty, IKM = the raw content-key bytes, info = the UTF-8 bytes
of "rltp/v1/epoch-secret/" followed by the genesis digest in
canonical u form, L = 32)`.

```json
{ "v": "rltp-access-keydist/0.24", "adapter": "linear/0.1",
  "epoch": 7, "keys": { "contentKey": "…base64url, 32 bytes…" } }
```

*Rationale.* One content key is the only transported secret;
everything else derives from it with domain separation, so a
helper cannot deliver a correct content key with a poisoned side
secret. Sealing is bound to group, epoch and recipient, and the
operation commits to the envelopes by digest, so an envelope
cannot be replayed under another transition. The commitment check
on the raw key bytes is the checkable core of freshness; a rotator
re-committing an old key would revoke nothing. Two concurrent
transitions leave two key worlds this adapter cannot fold into
one; the healing rotation is deterministic in its duty, every key
holder owes it on sight, and it is evidence-preserving, since both
siblings stay in the log and both secrets stay readable to those
who held them. Two members healing concurrently produce two
healing secrets and one more healing; that converges as soon as
the partition does.

**History under `linear/0.1`: the epoch-key lineage.**

**RLTP-ACC-9760** — Under `linear/0.1`, a transition MUST by default
carry `lineage`, an object `{ "opens": <epoch>, "ct": … }` with
`opens` = the previous epoch and `ct` the AEAD ciphertext of that
epoch's content key under the new content key with AAD the UTF-8
bytes of the JCS serialization of `{ "genesis", "newEpoch",
"opens" }`.

**RLTP-ACC-9770** — Under `linear/0.1`, a recovery-form lineage
(`opens` earlier than the previous epoch) MUST be gated only by the
operation's own rule.

**RLTP-ACC-9780** — Under `linear/0.1`, a skipped span MUST be
surfaced as skipped and, once repaired, as repaired.

**RLTP-ACC-9790** — Under `linear/0.1`, a transition without
`lineage` is the narrowing act and its proof MUST satisfy
`history.narrow` (4.1) in addition to its own rule.

**RLTP-ACC-9800** — Under `linear/0.1`, `lineageVoid: true` MUST be
valid only on a leave-discharging `epoch.rotate`, and the unbridged
step MUST be surfaced as damage.

**RLTP-ACC-9810** — Under `linear/0.1`, a transition with none of
`lineage`, an authorized `historyNarrow`, or (on a discharge only)
`lineageVoid` MUST be rejected as invalid.

**RLTP-ACC-9820** — Under `linear/0.1`, members MUST verify a lineage
entry on first decryption against the `opens` epoch's commitment,
and the first canonical verifying `lineage.repair` entry per
`(epoch, opens)` MUST count.

**RLTP-ACC-9830** — Under `linear/0.1`, a member holding both keys of
a skipped or failing lineage step MUST publish the `lineage.repair`
entry upon materializing the skip.

*Rationale.* Reachable history across a lineage step is exactly as
durable as the set of members holding that step's keys: a lineage
entry is constructible only by a key holder, and no rule can
conjure a key nobody entitled still has. A declared skip grants no
darkening power that a garbage ciphertext does not already grant;
the skip is the more honest form, visible to every reader, and
repairing it is a duty. Where no member holds both keys of a step,
that span is dark under this form and every other; authority state
in the span was never dark, at most content is, and at most until
repaired. `lineage.repair` is a log operation of this adapter: it
exists because the adapter keeps history in a chain of embedded
ciphertexts, and it is valid only under this adapter.

#### 9.4.2 `beekem/0.1` (experimental)

**RLTP-ACC-9870** — `beekem/0.1` MUST be registered as an
experimental adapter whose key operation travels as bytes beside
the enforcement operation, whose `keyOpDigest` is the multibase
multihash over those bytes, and which declares KV5 and KV6.

**RLTP-ACC-9880** — Under `beekem/0.1`, a member's devices MUST be
leaves of one key tree, one leaf per bound device (5.1), and the
removal of a member MUST remove every leaf of that member.

**RLTP-ACC-9890** — Under `beekem/0.1`, `keys` MUST contain exactly
`op`, the base64url encoding of the key operation addressed to the
material's recipient, and a transition MUST carry no material
binding beyond `keyOpDigest`.

```json
{ "v": "rltp-access-material/0.24", "adapter": "beekem/0.1",
  "epoch": 7, "keys": { "op": "…base64url…" } }
```

**RLTP-ACC-9895** — Under `beekem/0.1`, key operations and the
material for an admitted device MUST travel as replication items
beside the operation that caused them, addressed to all.

**RLTP-ACC-9897** — `beekem/0.1` MUST register the `key-delivery`
kind `material`: its document is the material object of 9.4
(`epoch` = the helper's current epoch, `keys.op` = a key operation
that gives the requesting device a leaf or path for that epoch),
sealed as 10.1 seals `re-welcome` to the key-agreement key of the
device card the request carries, with the recipient check of 10.1
applied to that device; the receiver verifies the operation against
the `keyOpDigest` of the enforcement operation it answers.

*Editor's note.* The registration exists because this adapter is
the one under which all six invariants have been shown together
with this layer's conflict matrix; its `keys` schema is expected
to change once signed operations and policy are tested against it,
and a change is a new adapter version.

*Rationale.* A key tree agrees one secret among many devices with
logarithmic work, removes a leaf by a path update the removed
device cannot follow, and merges concurrent updates by keeping
both until the next operation; that is KV1, KV5 and KV6 by
construction, which a per-member list has to serialize to achieve.


## 10. Service Ports and Task Types

*In plain terms.* This layer does not build its own network. It
relies on three kinds of service — one delivers messages to a
specific person, one keeps the group's copies in step, one
publishes open content — and any service that keeps the contract
can be swapped for another. Two message types are defined here:
one carries keys to people entitled to them, or asks for them; the
other tells a removed person that they were removed.

This layer requires, and does not define:

- **Delivery port:** authenticated end-to-end-encrypted delivery to
  derived identities with durable buffering and explicit
  disposition — satisfied by the Delivery Contract (0.79), whose
  task types for this layer are the Membership Tasks (0.16) plus the
  two types registered below.
- **Replication port:** convergent replication of the encrypted
  authority log and documents; deterministic merge; offline
  operation; no reachable central service required — satisfied by
  the Replication Contract.
- **Publication port** (`open` visibility only): world-readable
  publication of attached documents' ciphertext and the published
  content keys (Section 8), addressed by the group's genesis
  digest, idempotent per artifact, requiring no reader identity. A
  group in `private` visibility never needs this port; members
  discharge the publication duties of Section 8 through it.

**RLTP-ACC-10010** — An implementation of this layer MUST obtain
delivery, replication, and, for `open` visibility, publication
through the ports above, which this layer does not define.

**RLTP-ACC-10020** — A service satisfying a port contract MUST be
substitutable by any other service satisfying it.

*Rationale.* No vocabulary of a concrete service appears in this
layer's model beyond the view object of 7.3 and the service class
of the registration (Section 9.3); services themselves are bound by
7.3 and Section 9.3. Binding the group to one provider would make
that provider a point of control. How a group moves from one
service to another while views are in use is open (Section 15).

*Editor's note (Trust Tasks framework).* The task types below are
registered under type URIs that target the Trust Tasks framework
0.4, like the Membership Tasks. The move to framework 0.7.0 is made
together with the Delivery Contract and the Membership Tasks, not by
this layer alone.

### 10.1 `key-delivery/0.1`

The task type by which key material reaches a specific party and by
which it is claimed: key material to retained members, welcomes and
re-welcomes to admitted subjects, refresh material to current
members under the key service duty (5.3), and the authenticated
request itself. Type URI
`https://real-life.org/trust-tasks/key-delivery/0.1`, payload schema
`schemas/payload-key-delivery.schema.json`.

**RLTP-ACC-10030** — `key-delivery/0.1` MUST follow the Delivery
Contract §§3–6 for document profile, sealed envelope, dispositions,
and acknowledgements.

The `payload` is a `keyDelivery` object with these fields:

| Field | Content |
|---|---|
| `group` | the group DID |
| `genesisDigest` | the group's identity (3.2) |
| `epoch` | the epoch the material belongs to; for `request`, the requester's best knowledge, informative |
| `op` | the `oid:` of the operation this document serves; for `request`, the operation the claim rests on |
| `kind` | `request`, or a material kind the group's adapter registers |
| `sealed` | for material kinds: the sealed material, shape per `sealed-envelope.schema.json` and per kind; absent for `request` |
| `card` | for `request`: the requester's contact card in the displayed form; absent otherwise |

The material kinds are registered per adapter (Section 9.4).
`linear/0.1` registers three:

| Kind | `op` names | `sealed` carries |
|---|---|---|
| `keydist` | the transition | the key envelope whose digest the named transition's `keyDist` carries for this recipient (the seal profile of 9.4.1) |
| `re-welcome` | the canonical admission | a welcome seal per Membership §4, built from fresh material of the key port at the sender's current position, sealed to the accept's card or to the card of the request it answers (5.3) |
| `refresh` | any canonical admission of the recipient, or the genesis for the founder | a seal per the `keydist` profile of 9.4.1 — same HKDF info, associated data with the requester as recipient and the sender's current epoch as `newEpoch` — whose plaintext is a fresh `keydist` object from the key port at the sender's current position, sealed to the request's card |

**RLTP-ACC-10040** — A `keyDelivery` payload MUST carry `group`,
`genesisDigest`, `epoch`, `op`, and `kind`, with `kind` being
`request` or a material kind registered by the group's adapter.

**RLTP-ACC-10050** — `sealed` MUST be present for every material
kind and absent for `request`, in the shape the kind defines.

**RLTP-ACC-10060** — `card` MUST be present for `request` and absent
otherwise.

**RLTP-ACC-10065** — A request's `card` proof MUST verify under the
requester's anchor.

**RLTP-ACC-10070** — A document of a material kind MUST NOT carry a
`proof`.

**RLTP-ACC-10080** — A `request` MUST carry a proof verifying under
the document `issuer`.

**RLTP-ACC-10090** — A `request`'s `issuer` MUST equal the claiming
anchor and the enclosed card's anchor.

*Rationale.* Authenticity of material is content-bound: a `keydist`
envelope is committed by digest in the named transition and bound
by its associated data to group, epoch, and recipient; `re-welcome`
and `refresh` material is adopted only if it verifies against the
log's binding of its epoch. A request is a demand on the receiver,
so it is signed; the signature gate is what keeps third parties from
triggering the key service duty (5.3), and a card verifying under
the same anchor is the live key the answer is sealed to. The
`refresh` seal does not need the committed-digest rule of `keydist`
because the binding check at adoption carries its authenticity.
Kinds are registered per adapter because what a new member needs
depends on how the adapter distributes secrets.

**RLTP-ACC-10100** — Before any effect, a receiver MUST check that
the payload is schema-valid; that `genesisDigest` matches the
recipient's state for that group, or, for a bootstrapping invitee,
its own invite's digest; and, per kind: for `keydist`, that the
recipient appears in the named operation's `keyDist` with exactly
this sealed envelope's digest and `epoch` equals that transition's
`newEpoch`; for `re-welcome` and `refresh`, that the named operation
is a canonical admission whose subject is the document `recipient`,
or the genesis whose founder is the recipient, and that the
recipient, where it already holds a materialized state, is a current
member of it; for `request`, proof and card per RLTP-ACC-10060 to
RLTP-ACC-10090.

**RLTP-ACC-10110** — At adoption, the unsealed material's epoch MUST
equal the recipient's current epoch, and the material MUST verify
against the log's binding of that epoch (Section 9.2).

**RLTP-ACC-10120** — A document violating RLTP-ACC-10100 or
RLTP-ACC-10110 MUST be disposed `failed(validation-failed)` without
acknowledgement.

*Rationale.* A former member must adopt nothing on this path; only
the expressly provisional bootstrap below stands apart. Material
from another epoch, or material that does not match the binding, is
garbage or a substitution, and the binding check makes it harmless.
Any canonical admission of the recipient serves; none is
distinguished (5.3).

**RLTP-ACC-10130** — A receiver holding the current keys MUST answer
an entitled request with the matching material kind — `re-welcome`
or `refresh` under `linear/0.1` — through the key-service slot of
5.3.

**RLTP-ACC-10140** — `key-request-interval` MUST default to PT1H and
MUST apply per genesis digest.

**RLTP-ACC-10150** — A receiver MUST NOT deduplicate requests by
operation, card, or epoch.

**RLTP-ACC-10160** — An unentitled request MUST be disposed
`failed(validation-failed)`.

**RLTP-ACC-10170** — A request the receiver cannot resolve against
its own state MUST be disposed `failed(validation-failed)`
immediately, never pending.

*Rationale.* The response duty is the slot of 5.3, one per
(`genesisDigest`, requester anchor), and the throttle is per genesis
digest so that one group never starves another, sibling geneses
under one DID included (3.2). Every dedupe key fails: by operation,
admission clones would multiply the duty; by card, a lost card —
exactly the repeat this shape serves — would go unanswered; by
epoch, a request after a rotation would be refused although material
is produced fresh at the receiver's current position anyway. A
byte-identical re-send is `duplicate-known` at the Delivery
Contract's stage 4, so a repeat always travels as a new document. A
request is a demand on the receiver; letting it pend would turn
requests into storage load the requester controls. The requester
retries later.

Material kinds have this defined effect: durable buffering; then
unsealing, the binding check, and application as the recipient's
local acts against its replica, idempotent by document digest.

**RLTP-ACC-10180** — Material for the same `(op, recipient)` MUST be
applied at most once per successfully verified content.

**RLTP-ACC-10190** — A recipient that cannot yet resolve the named
operation MUST dispose material `incomplete(missing: group-state)`
under the pending mechanics of Membership §3.3 — keyed by document
digest, retention `bootstrap-retention`, redelivery idempotent —
except a re-welcome answering a bootstrap.

*Rationale.* Pending mechanics exist for material a lagging
recipient will grow into, never for demands on the receiver. The
re-welcome answering a bootstrap is self-contained against the
invitee's own accept, exactly like the welcome it replaces
(Membership §3.3 case 1).

**Bootstrap semantics of the re-welcome.** A bootstrapping invitee
cannot check canonicality or the epoch binding before holding the
log — neither could it for the original welcome — and the
re-welcome inherits the welcome's trust sequence rather than
pretending a stronger one. Adoption is provisional.

**RLTP-ACC-10200** — Before provisional adoption, an invitee MUST
check that the seal opens under the key-agreement key of its own
accept's card, that the payload's `group` and `genesisDigest` equal
the pin of its own invite (3.2), and that the unsealed material is
well-formed for the named adapter.

**RLTP-ACC-10210** — An invitee MUST hold at most one active
provisional candidate per (`genesisDigest`, invitee).

**RLTP-ACC-10220** — The `provisional-window` MUST open with the
first provisionally valid bootstrap document, welcome or
re-welcome, for that pair and MUST NOT be extended by a change of
candidate.

**RLTP-ACC-10230** — While the window is open, further provisionally
valid candidates MUST NOT be adopted, and at most one MUST be
buffered: a newly arriving candidate replaces the buffered one if
and only if its document digest is smaller in unsigned bytewise
order.

**RLTP-ACC-10240** — A displaced candidate's material MUST be
discarded, and only its document digest and disposition (`unique`;
on re-send `duplicate-known`) MUST be kept.

**RLTP-ACC-10250** — When the active candidate fails, the buffered
candidate MUST be checked immediately.

*Rationale.* The invite pin is held since the invite and no sender
can move it, so a sibling genesis under the same DID neither
displaces this candidate nor consumes its window. A window per
candidate would let an attacker multiply the delay by the number of
fabricated candidates; per pair, any number of them costs one
window. The buffer rule is deterministic and constant-space, and
stating discard explicitly keeps retention identical across
implementations. The buffer is an optimization, never the carrier
of the liveness guarantee: any one-slot rule can be gamed into
displacing the honest candidate, so the guarantee rests on the
request path (RLTP-ACC-10330). A failure presupposes the log, so no
window mechanics apply to the successor.

The provisional state of the active candidate is exactly: the
unsealed material and every key derived from it, replicated group
data, the derived service identity for this group, and pending key
requests with their Delivery-level completed-effect records.

**RLTP-ACC-10260** — Before its first materialization succeeds, a
provisional state MUST NOT publish writes, announce a service
identity, register at a service, or take part in views; it MAY
only replicate, scoped by the pinned digest, toward first
materialization.

**RLTP-ACC-10270** — An implementation MUST NOT offer the
provisional space for user authoring.

**RLTP-ACC-10280** — User-authored content in a provisional space
MUST survive every wipe, as unique data under Section 12's
boundary.

*Rationale.* An unverified group must not be represented outward,
and it is not a writing surface. Should user content exist
nonetheless, losing it to a wipe would be data loss, exactly as
removal hygiene preserves unsent work (5.3).

**RLTP-ACC-10290** — A bootstrap MUST succeed only if, at first
materialization, the named admission is canonical with the invitee
as subject, the invitee is a member of that materialized state, and
the unsealed material verifies against the current epoch's binding
in the log (Section 9.2).

**RLTP-ACC-10300** — `provisional-window` SHOULD default to P30D,
measured from the first candidate's adoption for the
(`genesisDigest`, invitee) pair, and an attempt whose first
materialization has not succeeded within it MUST count as failed.

**RLTP-ACC-10310** — The provisional phase MUST end at log arrival,
after which every held candidate, and every candidate arriving
later, MUST be checked against the log at once.

**RLTP-ACC-10320** — On a failed candidate, the invitee MUST wipe that
candidate's provisional state, unique data excepted, surface the
failure, and check the buffered candidate.

**RLTP-ACC-10330** — When every held candidate has failed, or the
window closes with no log arrival, the invitee MUST wipe everything
provisional and request afresh, from the still-held invite and
accept, by an authenticated key request.

*Rationale.* An admission is history and stays canonical after the
removal that ended it, and material derived honestly at the current
position verifies against the binding for anyone; without the
membership condition, a subject admitted in one epoch and removed in
the next could re-enter on a re-welcome a malicious remaining member
minted for them. The membership condition is the eviction rule of
5.3 and the member-only readability of the log (RLTP-ACC-3020)
reaching this gate; Membership §3.3 requires it here. A removal the
invitee's first materialized state does not contain is no reason to
fail: it takes effect on merge under 5.3's eviction, never as a
retroactive bootstrap failure. The window is deliberately not
Membership's `bootstrap-retention`, which is a minimum retention,
the opposite duty. The liveness guarantee is a chain, each link
named: once the log reaches the invitee, every held candidate is
checkable at once; if none verifies, a reachable helper holding the
current keys owes the answer within `key-request-interval` of the
request filling its slot (5.3), and the bootstrap succeeds when that
answer is delivered and verified. The delivery leg's latency is the
Delivery Contract's and is not time-bounded; its durable buffering
is the residual here. What a malicious sender can cost before the
log arrives is bounded delay and bounded storage inside one window —
never a false membership, never an unbounded hold, never a partial
teardown, never lost user data — and the sender of record is
attributable through the delivery chain.

### 10.2 `removal-notice/0.1`

The task type by which a removed member is told of their removal.
Type URI `https://real-life.org/trust-tasks/removal-notice/0.1`;
the payload is the compact notice object, schema
`schemas/payload-removal-notice.schema.json`:

```json
{ "v": "rltp-access-removal-notice/0.24",
  "type": "removal-notice",
  "group": "did:key:z6Mk…group",
  "genesisDigest": "…the group's identity (3.2)…",
  "op": "oid:…the member.remove operation…",
  "subject": "did:key:z6Mk…removed",
  "epoch": 8,
  "author": "did:key:z6Mk…remover",
  "sig": "…author's signature over the JCS serialization with
          sig omitted…" }
```

A service that stops serving a removed member owes that member this
notice (Section 9.3); the form in which it reaches the member is the
Delivery Contract's.

**RLTP-ACC-10340** — `removal-notice/0.1` MUST be registered with its
document profile, dispositions, and acknowledgement rules per the
Delivery Contract §§3–6, and with its payload schema `$id` equal to
its type URI.

**RLTP-ACC-10350** — A removal notice MUST name in `op` the
`member.remove`, in `subject` the removed anchor, in `epoch` the
removal transition's `newEpoch`, and in `author` the operation's
author.

**RLTP-ACC-10360** — A removal notice's `sig` MUST verify under
`author`.

**RLTP-ACC-10370** — A removal-notice document MUST carry no
`proof`, and its `issuer` MUST equal `author`.

**RLTP-ACC-10380** — Before any effect, a recipient MUST check that
the payload is schema-valid, that `sig` verifies, that
`genesisDigest` matches a group of the recipient's last-held state,
that `author` was a member there, and that `subject` is the
recipient; a violation MUST be disposed `failed(validation-failed)`
without acknowledgement.

*Rationale.* An offline validator resolves the payload schema by
type URI (Delivery §3), so the type is dispatchable and never
`unknown-type`. Authenticity is content-bound in the payload's own
`sig`; a document proof would be a second, divergent carrier.

**RLTP-ACC-10390** — A verified removal notice MUST be surfaced to
the person.

**RLTP-ACC-10400** — A verified removal notice SHOULD trigger a
verification attempt by replication or a key request.

**RLTP-ACC-10410** — A removal notice MUST NOT by itself suspend
writing, wipe material, or alter any authorization state.

**RLTP-ACC-10420** — Write hygiene MUST bind only on the member's
own canonical application of the removal.

**RLTP-ACC-10430** — A peer's refusal to serve SHOULD trigger
verification and MUST NOT be a binding event.

*Rationale.* The one thing a notice cannot carry is proof that the
named operation exists; any mandatory effect would turn every
present or former member's signature into a policy-free lever to
deny service. Enforcement never needs the notice, nor the removed
member's cooperation: its security is carried entirely by the other
parties — eviction at every peer (5.3) and the rotated epoch at every
service (7.3) — so a removed member who ignores everything can write
locally forever and it propagates nowhere. A bare refusal
authenticates only the refusing peer, not a canonical removal. A
false notice is a signed, surfaced, attributable statement with no
mechanical effect, and the verification it prompts reveals the
truth in either direction.

**RLTP-ACC-10440** — A removal notice MUST be disposed `unique` on
first surfacing and `duplicate-known` on redelivery within the
Delivery Contract's completed-effect retention.

**RLTP-ACC-10450** — An implementation MUST NOT re-alert a removal it
has already surfaced, identified by `op`.

**RLTP-ACC-10460** — A notice for a group the recipient never held
MUST be disposed `failed(validation-failed)`, never pending.

*Rationale.* This layer uses Delivery §6's closed set of
dispositions and invents none. Beyond the retention the Delivery
Contract legitimately re-evaluates a redelivered document as fresh,
so the durable dedupe is the recipient's own, by `op` — application
idempotence, not an authority question.


## 11. Evolvability

Profile `rltp-access@0.54` produces and accepts these wire forms:

| Artifact | Wire version |
|---|---|
| operation envelope (3.3) | `rltp-access/0.25` |
| authorization view (7.3) | `rltp-access-view/0.24` |
| key material, key distribution (9.4, 9.4.1) | `rltp-access-material/0.24`, `rltp-access-keydist/0.24` |
| service registration (7.3), with the field `class` (Section 9.3) | `rltp-access-registration/0.27` |
| removal notice (10.2) | `rltp-access-removal-notice/0.24` |
| member mapping (5.5) | `rltp-access-member-mapping/0.24` |
| evidence session (Section 3.6) | `rltp-access-evidence-claim/1`, `rltp-access-evidence-request/1`, `rltp-access-evidence-response/1`, `rltp-access-evidence-supplement/1`, `rltp-access-evidence-part/1` |
| task types (Section 10) | `key-delivery/0.1`, `removal-notice/0.1` |

The vouch (`vouch@2`, 5.3) is a W3C VC in DTG form and carries no
`v` constant; its version lives in the `AdmissionVouch` hint type
and this profile's schema. Registered adapter identifiers are
`linear/0.1` and `beekem/0.1` (Section 9.4).

**RLTP-ACC-11010** — Every wire artifact of this layer MUST carry its
version as the table above states.

**RLTP-ACC-11020** — A wire version MUST advance exactly when a wire
shape changes, independently of the profile version.

*Rationale.* A verifier must know which rules apply to the bytes it
holds. The profile version names the document; the wire version
names a shape. Shapes that did not change keep their version, so
their existing instances, fixtures, and transcribed schemas stay
valid.

**RLTP-ACC-11030** — An implementation MUST NOT produce or interpret
`rltp-access-acceptance-receipt` or
`rltp-access-generation-statement`.

*Rationale.* An artifact by which a service attests its own
acceptance would have to prove its own acceptance; acceptance of a
registration generation rests on the live session or the
`previousRegistration` chain into a session-attested generation
(7.3), and needs no artifact. No schema for either form exists and
no instance does.

**RLTP-ACC-11040** — An existing identifier MUST NOT be
re-interpreted, and an extension — a new operation (with class,
epoch effect, rule key default, and closed body profile, 4.5),
requirement type, action, proof mechanism, visibility mode, adapter,
service class, or task kind — MUST register a new identifier.

**RLTP-ACC-11050** — Every unknown construct MUST degrade toward less
authority: an unknown requirement type is unsatisfiable, an unknown
action confers nothing, an unknown operation is invalid as a proof
subject, an unknown critical field rejects the envelope, and an
unknown non-critical envelope field is ignored.

**RLTP-ACC-11060** — A new body field MUST be introduced only as a
new operation version.

**RLTP-ACC-11070** — Hard rejection MUST be reserved for
cryptographic invalidity and `crit` violations.

*Rationale.* A silent re-interpretation would give existing
artifacts a new meaning after the fact. Unknown must never permit.
Operation bodies are closed per profile (4.5), so a body field
cannot ride in unnoticed; `keyOpDigest` (Section 9.2) is such a
field, and the genesis and every enforcement operation that carry it
are new operation versions, travelling in the envelope version
`rltp-access/0.25`. For `linear/0.1` the digest is computed over the
transition's `keyDist` (9.4.1), so the reference adapter's key
distribution itself is unchanged. Rejecting anything else hard would
let an extension break verifiers it was meant to pass.

**RLTP-ACC-11080** — A rename MUST go through the alias table, and
the key-derivation info strings (`rltp/v1/keydist`,
`rltp/v1/service-identity/…`, `rltp/v1/welcome`) MUST NOT be
renamed.

**RLTP-ACC-11090** — A group MAY pin a minimum profile version in
its policy.

*Rationale.* An alias table keeps old identifiers resolvable. A
renamed info string would derive different keys from the same
secrets and silently split every replica that had not renamed it. A
group that depends on a rule introduced by a later profile can
refuse operations under an earlier one.

**RLTP-ACC-11100** — The task type `access-operation/0.1` of the
Membership Tasks (0.16, pinned to envelope `rltp-access/0.24`) MUST
transport envelopes of version `rltp-access/0.25` under this
profile; a receiver MUST accept both versions in that payload until
the companion's pin advances, and `keyOpDigest` is required only
under `0.25`.

*Rationale.* A companion pin that lags one wire version is a
compatibility statement, not a contradiction, as long as the
statement is written down; without it two conformant
implementations would read the same task differently.


## 12. Security Considerations

**RLTP-ACC-12010** — Authorization MUST default to deny.

**RLTP-ACC-12020** — A verifier without current materialized state
MUST NOT authorize privileged operations against a stale one.

**RLTP-ACC-12030** — An implementation MUST NOT introduce side
channels of authority.

*Rationale.* Epoch and `policyVersion` binding make stale proofs
invalid rather than dangerous (3.3), but a verifier that answered
from an old state would still grant what the group has since taken
back. Everything reduces to operation validity and the
deterministic merge; any other path to authority bypasses both.

- **Fail-closed evaluation.** An operation can never ride a policy
  that lost a race, because constitutional races do not exist: a
  `policy.change` is an enforcement operation, and a `policy.change`
  concurrent with any enforcement operation forks the group
  fail-closed (Section 3.6). The fork ends only by a later
  `policy.change` whose ancestry contains both siblings — a
  constitutional decision about the conflict, never a tiebreak.
- **Authority before concurrency.** Whether a removal carries
  authority is decided at its own position before any concurrency
  rule applies (Section 3.6). A removal without authority — a
  member removing an admin — suppresses nothing, so it cannot be
  used to void a concurrent valid admission. Removals with
  authority all take effect, even when one removes the author of
  another: two concurrent removals of different subjects remove
  both; two members who remove each other concurrently both leave;
  in a chain where A removes B while B removes C, B and C both
  leave. Any other outcome would let the order of arrival decide
  authority, or would need a tiebreak someone can grind. The price
  is stated: two members with removal authority can remove each
  other, and the group then continues without both.
- **Identity is the digest, including the operational state.**
  Group state, invitations, views, and key derivation inputs bind
  the genesis digest (3.2), so a founder equivocating geneses under
  one DID creates parallel groups, not parallel truths about one
  group, and nobody can be moved between them without failing a
  digest check they hold themselves. The same keying covers every
  slot, window, and throttle (3.2, 5.3, 7.3, 10.1); keyed by the
  shared DID, one genesis could displace the other's bootstrap
  candidate, consume its answer deadline, or exhaust its rate
  budget.
- **A bootstrap is judged against the living state, not the
  archive.** The first-materialization gate (10.1) requires current
  membership alongside canonicality and the epoch binding. An
  admission stays canonical after the removal that ended it, and
  material derived honestly at the current position verifies for
  anyone; only the membership condition separates a legitimate late
  bootstrap from a removed member re-entering on a re-welcome minted
  by a malicious insider.
- **The log is the perimeter; the adapter holds keys, not
  authority.** The authority port is this layer's own (Section 9.1),
  and only key operations resulting from canonical authority
  decisions reach the key port: a key structure that accepted any
  signer's removal cannot decide membership here. What remains of
  the adapter's trust is confidentiality: a malicious adapter
  implementation can exfiltrate keys. The key port makes that
  surface explicit and auditable (Section 9.2); it does not abolish
  it.
- **Consent is verifiable by everyone who must judge it.** The
  admitting operation encloses the signed invite and accept (5.3);
  a malicious authorized member cannot make a consentless admission
  canonical; every canonical admission consumes the accept it
  encloses, no merge frees one, and rule 0 bars re-admitting a
  standing member. The genesis claims no one: the founder
  countersigns, everyone else accepts. Admission cloning — several
  concurrent admissions of one subject by an authorized inviter —
  buys log growth, capped per admission by Membership's size budget
  and signed by the inviter every time, and nothing else.
- **Consent staleness is wall-clock-bounded, stated.** An unconsumed
  accept can serve a (re-)admission only within
  `validUntil + membership-skew` of its invite (5.3, rule 3); inside
  that window a re-admission the subject no longer wants is
  possible in principle and is surfaced by the subject's own client,
  which knows its exits.
- **No key hostage.** The key service duty (5.3) detaches key
  possession from the goodwill of any single operation author:
  entitlement follows the log, material is produced afresh by the
  key port, requests are authenticated, the newest request earns a
  fresh answer within `key-request-interval`, and adopted material
  must verify against the log's binding (10.1). Withheld welcomes
  and garbage key material are delays and attributable misbehavior,
  never revocations of entitlement. Two residuals: history whose
  every key holder is removed, departed, or withholding stays dark
  (9.4.1 states the bound for `linear/0.1`); and a group whose
  every member withholds keys has in fact expelled the victim
  without an operation — visible to the victim, deliberate, and no
  different from the group refusing to interact.
- **Honest revocation, honest leave.** Section 7 states what a new
  epoch buys, and no interface presents removal as retroactive
  erasure (RLTP-ACC-7090). A leave takes effect at its discharge (5.4);
  in the pending window the leaver reads, but has no policy standing
  in the log, while toward services it stays listed until the
  discharge (7.3). The discharge can be blocked by no policy and no
  key state (5.4). An "instant" leave was rejected as unsound, not
  as undesirable.
- **Terminal honesty.** Dissolution and drained groups end without a
  next key world; former members keep the last epoch as knowledge;
  services fail closed on a terminal or disputed view (7.3).
- **Merge remediation windows.** A member admitted concurrently with
  an enforcement operation is a member of the merged state but may
  lack the new secret until the key port heals its structure
  (Section 9.2) — an availability gap, never an authority gap.
- **Capacity is never a merge decision.** Every admission canonical
  at its position is final (Section 3.6); the only capacity
  mechanism is the position-local freeze of rule 0 (5.3). Beyond the
  8192 wire ceiling the group is degraded, not re-decided:
  membership-scaled artifacts are unconstructible, leaves and
  dissolution remain available, and recovery is by attrition.
  Driving a group there requires coordinated flooding across
  partitions and is attributable through the inviter signature
  every admission carries.
- **The transport budget, arithmetically.** The transported-variant
  caps bound an admission proof at about 44.5 KiB in the worst case:
  64 envelope signatures at about 200 bytes each serialized
  (12.5 KiB) plus 16 credentials at most 2048 bytes JCS each
  (32 KiB). Membership's maxima bound invite and accept at 16 384
  bytes each and the welcome plaintext at 16 384 bytes, whose seal
  reaches about 22.5 KiB. Nominal documents of a few KiB carry even
  the full-cap proof inside the Delivery Contract's 65 536-byte
  plaintext budget with margin; adversarially maximized documents do
  not, and the sender check (RLTP-ACC-5330) and the always-fitting
  self-contained re-welcome (5.3, 10.1) cover that case.
- **Services by class.** A service of class `view` or `log` gates
  content and key operations by the authorization state it holds;
  a service of class `blind` gates nothing, and a removed member can
  keep fetching ciphertext from it — ciphertext of epochs whose
  secrets the removed member cannot derive (Section 9.2). That
  residual is the price of a service that learns nothing, and the
  group chooses it. Within the declared staleness bound, a colluding
  view quorum can delay removal effects, deny a member, or list a
  stranger; end-to-end encryption caps the stranger at ciphertext
  and write spam, and every misstatement is signed, chained, and
  comparable against the log inside the group (7.3). Registration is
  trust-on-first-use: an attacker registering a fake chain first can
  deny service, never read or forge. No service silently drops
  evidence or work (Section 9.3).
- **Deadlock by shrinkage.** Anti-deadlock (4.4) blocks single
  removals that would kill the constitution; leaves cannot be
  blocked, but the discharge is policy-exempt and a fully drained
  group is terminal (5.4). A group can still become constitutionally
  stuck above emptiness — by several concurrent leaves, or by several
  concurrent removals that each pass at their own position — stated,
  surfaced, and tracked (Section 15).
- **Post-compromise security depends on the adapter.** A new epoch
  always cuts off removed members (KV1). Whether it also cuts off a
  passive reader who copied a member's device state depends on the
  adapter (RLTP-ACC-7080): an adapter declaring KV5 recovers from
  it, `linear/0.1` does not, because its key material is sealed to
  card keys that stay on the device (9.4.1). A group that needs
  recovery from a captured device chooses its adapter accordingly.
- **Devices.** A lost device is cut off by `device.revoke` without
  its person leaving (5.1), and a device card needs the signature of
  an existing device of the same person, so a stranger cannot bind a
  device to someone else's name. Under the shared-seed device model
  of Identity 0.51 (Identity 3.2), every acting device holds its
  person's root IKM; a captured device whose seed is extracted
  yields the member anchor itself, and revoking the device does not
  revoke the seed. Recovery from a seed compromise is the Identity
  layer's, not this layer's.

**RLTP-ACC-12040** — An implementation MUST discharge the healing
duty (Section 9.2) for a concurrently admitted member eagerly.

**RLTP-ACC-12050** — An implementation MUST surface a pending
healing state.

**RLTP-ACC-12060** — Runtime authority — cached views, derived keys,
open handles — MUST be invalidated on removal and on identity
switch.

**RLTP-ACC-12070** — Wiping MUST NOT destroy the only copy of data
the group is entitled to retain.

**RLTP-ACC-12080** — Wiping MUST NOT retain what the removed member
is entitled to withdraw.

**RLTP-ACC-12090** — The unique-data boundary MUST be explicit.

*Rationale.* A keyless window that is not closed quickly turns a
merge into exclusion, and a hidden one leaves a member wondering why
they read nothing. A stale runtime generation that keeps acting
after a removal or an identity switch acts with authority nobody
holds any more. Wiping is a security act with a data-loss failure
mode in both directions; the Layer-4 `dataPolicy` governs it, and
only an explicit boundary makes it checkable.

- **Time gates.** The only wall-clock checks of this layer sit at
  the service boundary (7.3) and in the consent-staleness bound
  (5.3, rule 3), each against a declared skew bound. Log validity
  never consults a clock (RLTP-ACC-3180).
- **Member-anchor scoping and the mapping's deniability.** A member
  anchor reused across groups voids its own pseudonymity, so 5.1's
  scoping rule is normative, not advice. A leaked `member-mapping@1`
  proves nothing to third parties — the addressee could have forged
  it — so a cross-group link exists as knowledge, never as
  transferable evidence; and the vouch's subject is the member
  anchor, so the log never carries the coordinate that would join a
  person across groups.

## 13. Privacy Considerations

What a service learns of a group is the service class the group
registered for it (Section 9.3):

| Class | The service learns | The service never learns |
|---|---|---|
| `blind` | ciphertext and operations as opaque items, their sizes and timing, the device addresses it delivers to, the genesis digest | authorization views, membership, policy, admission evidence, the invitation graph, any plaintext or key |
| `view` | additionally the authorization views: the derived service identities of the members' devices, epoch numbers, view sequence numbers | anchors, the mapping between identities and anchors, policy, admission evidence, the invitation graph, any plaintext or key |
| `log` | additionally the authority log: members under their member anchors, policy and roles, admission evidence, the invitation graph, every operation, the mapping between identities and anchors | community anchors, content plaintext, any key |

**RLTP-ACC-12100** — An adapter MUST NOT expose membership, policy,
or the invitation graph in plaintext to non-members or
infrastructure, other than to a service the group registered with
class `log`.

*Rationale.* A key structure that sent its control messages in
plaintext, or a provider that held the authorization graph in the
clear, would turn infrastructure into a collector of membership
graphs that no group chose. The class is the group's statement of
what its service may know; nothing beyond it reaches the service
(Section 9.3).

- **Stated residue toward a `view` service.** The view's
  `identities` list reveals the cardinality and churn of the set of
  bound device identities — pending exits included until discharge;
  not devices whose identity is not yet bound, and never the
  mapping to anchors. View cadence reveals that authorization
  changes, not what changed. After a terminal view the service
  keeps the last identity list for the `terminalRetention` window
  (7.3), a bounded, registered prolongation of the same residue.
- **Devices across groups.** Whether a device identity seen by a
  service in one group can be linked to the same device in another
  group depends on the device-level derivation the Identity layer
  has yet to define (5.2); a service that serves several groups
  could otherwise link them through a device.
- **Inside the group.** Admissions are individually attributable to
  members and encrypted against everyone else. The permanence cost
  of admission enclosure — both cards, both proofs, forever in the
  log — is stated in Membership §8 and capped by its size budget,
  and it prices in group-scoped identifiers, never cross-group
  coordinates: without a person's own `member-mapping@1`
  disclosures, no cryptographic join key exists. After voluntary
  disclosures toward members of several groups, those members can
  join the person as knowledge, never as transferable proof; the
  disclosure stays a per-recipient decision of the person. Display
  profiles, behavior, and timing can still identify a person
  socially; this layer removes the cryptographic join key, not human
  recognizability.
- **Vouch presentations** disclose to the group that specific
  members vouch for the subject — bounded, deliberate,
  group-directed disclosure by each voucher; the subject's wider
  graph stays undisclosed.
- **Open mode opens content, never the log** (RLTP-ACC-3020,
  Section 8): membership, admission evidence, and policy stay
  sealed in every visibility mode; `history.expose` is a separate,
  deliberate, logged act whose body is the disclosure itself.


## 14. Conformance

**RLTP-ACC-14010** — The following schemas MUST be normative and MUST
ship with offline closure: `schemas/access-operation-envelope.schema.json`
(envelope `rltp-access/0.25`, `keyOpDigest` in the genesis and in every
transition, the body profiles of 4.5 including `device.add` and
`device.revoke`) · `schemas/payload-access-operation.schema.json` ·
`schemas/payload-key-delivery.schema.json` ·
`schemas/access-material.schema.json` (the `keys` schemas of
`linear/0.1` and `beekem/0.1`) · `schemas/authorization-view.schema.json`
· `schemas/access-registration.schema.json`
(`rltp-access-registration/0.27`, field `class`) ·
`schemas/payload-removal-notice.schema.json` ·
`schemas/member-mapping.schema.json` ·
`schemas/access-vouch.schema.json` — plus, by reference, the
Membership Tasks' document schemas, `sealed-envelope.schema.json`, and
`contact-card.schema.json`.

**RLTP-ACC-14020** — The profile `rltp-access@0.54` MUST produce and
accept exactly the wire forms of Section 11 and MUST be read against
the companions RLTP Identity 0.51 (whose per-device derivation 5.2
awaits, so conformance claims no device-level derivation), RLTP
Encounter 0.30 (`rltp-encounter@0.30`, wire 0.25, where cards are
consumed), the Delivery Contract 0.79, and the Membership Tasks 0.16
under the compatibility statement RLTP-ACC-11100, whose profile
strings are pinned on their side.

**RLTP-ACC-14030** — Conformance MUST be claimed per class:

- *member agent* — the authority port: log, materialization
  including the conflict matrix and the outcome rules of Section
  3.6, retained-set computation, admission rules, device bindings
  (5.1), policy evaluation, transitions, duties, hygiene;
- *policy verifier* — the evaluation of 3.4 and Section 4 only;
- *adapter* — the key port: KV1 to KV4, KV5 and KV6 as its
  registration declares, healing and the replay bound (Section 9.2),
  the obligations of 9.4, and the privacy floor of Section 13;
- *service* — the obligations of 7.3 that its class carries, the
  rules of 9.3, and its declared service class.

*Rationale.* A verifier needs the shapes offline, without resolving
anything. A profile that named its companions loosely could be
satisfied against a companion version whose rules differ. Classes
keep a claim checkable: an adapter is judged on keys, never on
authority, because authority is the member agent's (Section 9.1);
a service is judged on what its class lets it hold.

**RLTP-ACC-14040** — The vector suite MUST cover every rule
identifier of this document, by a vector or by the state-dependent
set of RLTP-ACC-14070.

**RLTP-ACC-14050** — The vector suite MUST include
`vectors/access-conflicts.json`, exported as JSON operation DAGs with
their expected materializations, covering: two concurrent removals
of different subjects (S4b); two concurrent removals each removing
the other's author (S4c); a removal concurrent with an `epoch.rotate`
(S4d); a transitive removal disposition over an admission chain
(S4f); a removal without authority concurrent with a valid admission,
which suppresses nothing; and the removal chain in which A removes B
while B removes C.

**RLTP-ACC-14060** — A vector and a conformance report MUST reference
rules by their `RLTP-ACC` identifiers, against the identifier list
`conformance/access-rule-ids-0.54.txt`.

**RLTP-ACC-14070** — Every normative statement of this document MUST
be vector-testable or named in the state-dependent set: signal
dispositions (3.5); remediation, healing, and key service duties,
helper reachability included (5.3, 9.2); the replay bound of the key
port (RLTP-ACC-9330); KV5 and KV6, testable only by scenario;
teardown (Section 12); the service duties of 9.3; and the adapter
confidentiality criteria of 9.4 — each exercised with controlled
state and clock.

*Rationale.* The conflict matrix decides between operations, and only
scenarios over a DAG can show what it decides; the six scenarios of
RLTP-ACC-14050 are those in which a fork, a wrong tiebreak, or
concurrency judged before authority would give a different result.
A rule without a vector, and without a named reason for having none,
drifts. Identifiers make the trace from rule to vector mechanical
in both directions.

**Shipped vectors.**

- `vectors/member-mapping.json` — a complete positive
  `member-mapping@1` with `mac1` recomputed under
  HKDF(ECDH(memberX_sender, memberX_addressee)) and `mac2` under
  HKDF(ECDH(communityX_sender, memberX_addressee)) over the canonical
  body bytes, the enclosed `self-card@1` verified under its own
  anchor, and step 4 (`card.anchor == self`); the foreign-self
  negative recomputes both MACs over the mutated body so that step 4
  is the sole failing check. `memberOp` and `toOp` are placeholder
  digests, not ids of real admission envelopes, so acceptance steps
  2 and 3 are not exercised by this file.
- `vectors/dtg-credentials.json` — `vouch@2` and invite forms,
  digests, member-anchor derivations, and `u`/`z` equivalence: the
  `linear/0.1` epoch-secret derivation and both associated-data
  constructions recomputed from either rendering of the genesis
  digest, the raw `z` bytes shown to diverge (3.2).
- `vectors/acceptance-anchoring.json` — registration generations,
  quorum authorization, the two-way acceptance anchor, the CAS
  acceptance commit, and registration equivocation (7.3).
- `vectors/seal.json` — the Delivery §5 seal the `linear/0.1` key
  envelope uses.

**Vector file to ship with this version.**

- `vectors/access-conflicts.json` — the six scenarios of
  RLTP-ACC-14050, plus: a `visibility.change` concurrent with a
  removal (both take effect); `policy.change` concurrent with any
  enforcement operation, another `policy.change` included (forked
  state: the member set is that of the maximal prefix free of the
  fork pairing, every operation on either sibling carries status
  `forked`, and a `policy.change` descending from both siblings
  ends the state, after which statuses are re-derived), and the fork
  ended by a `policy.change` whose ancestry contains both siblings;
  a terminal operation concurrent with an enforcement operation
  (forked state).

**Test goals not yet in a vector file**, by area:

- *Genesis* — a valid single-founder genesis with card; `op` other
  than `group.genesis`, missing or same-key countersignature, group
  DID equal to the founder anchor, missing or foreign card, a
  multi-member body, a missing `keyOpDigest` → each rejected; policy
  satisfiability against one member; a founder anchor equal to a
  `group/<digest>` context of the same genesis → genesis invalid.
- *Identity by digest* — two geneses under one DID are two groups;
  an invitee's bootstrap against its pinned digest rejects the
  sibling; views and key deliveries scope by digest; with one party
  in common, candidate slots and windows, key-service slots and
  deadlines, rate limits, and completed-effect records stay
  independent per digest (keying any of them by DID is the
  regression check).
- *Envelope* — `id` recomputation; replay across group, epoch, or
  position rejected; `crit` handling; unknown envelope fields pass
  the schema, unknown body fields fail the closed profile; unsorted
  signatures invalid; the group identity unchanged under any proof
  presentation; digest fields accept `u` and `z`.
- *Proof merge* — duplicate-id envelopes merge to the union of
  signer and voucher sets, first valid entry per signer and voucher,
  identical sets across arrival orders; Sybil signers and vouchers
  outside the eligible set or currency merge nothing; a vouch about
  another subject never occupies its issuer's entry; the derived
  label (`signature-set`, `encounter-presentation`, `composite`) is
  identical from 3.3 and 4.3, and verdicts do not depend on it; the
  merged proof re-serializes within the wire cap at full currency
  plus subject; effects apply once per `id`.
- *Materialization* — determinism of the ready-set fold, including
  the shape A→C with B concurrent and id(C) < id(B) < id(A), which
  folds as (B, A, C) everywhere; one vector per matrix row of
  Section 3.6; emptiness terminal on the full materialization and
  revived by a concurrent canonical admission; a canonical dissolve
  not revived; an admission valid at its position under an ancestral
  `policy.change` is a member of every non-forked merged state.
- *Admission* — rule 0, including the 4097th admission invalid at
  its position and an overshoot to 4097 by two concurrent admissions
  at 4095 tolerated, all artifacts schema-valid under the 8192 caps;
  every cross-binding of rules 1 to 4 violated → not canonical;
  causal replay of a consumed accept → not canonical, while a
  re-admission after an ended membership with fresh consent is
  canonical; concurrent admissions of one subject with accepts α and
  β → both canonical, both accepts consumed, no candidate voided, a
  descendant of either keeps its verdict; a post-expiry accept
  rejected; the transported variant within (64, 16) and 2048 bytes
  per credential fits the 64 KiB budget with nominal documents; an
  enclosed admission over the plaintext limit is non-conformant at
  the sender while its subject bootstraps by the self-contained
  re-welcome; a transition-carrying envelope as boundary payload is
  non-conformant.
- *Vouch* — `vouch@2` positive (signature, currency at position,
  subject, accept and genesis-digest binding); a vouch by a
  non-member, about another subject, on `member.remove`, by the
  subject itself, or an Encounter credential in the vouch slot →
  inadmissible; duplicate vouchers counted once.
- *Policy* — rule keys including the `history.narrow` aspect under
  `linear/0.1` (both rules on one proof); the product-space order to
  depth 4 with the two consequences of 4.4; subject binding;
  `strongest` resolution; satisfiability against the currency with
  pending exits excluded; aggregate cost: `all[actors(A1,64), …,
  actors(A63,64)]` and `any[threshold(65), vouch(17)]` on
  `member.add` structurally invalid, and from any satisfying proof
  of a valid rule a variant within (64, 16) extractable; empty
  `all[]` and `any[]` invalid at any depth; an `actors` component in
  the `policy.change` rule invalid; `threshold(|currency|)` for
  `policy.change` with plural currency invalid,
  `threshold(|currency| − 1)` valid; anti-deadlock position-local
  with the discharge exemption.
- *Devices* — a second device added by its person without a
  membership change reads old and new content (S5); a revoked device
  reads nothing new while its person stays a member (S5b); a removed
  person's every device reads nothing new (S5c); a device card not
  signed by a bound device of the same person rejected; `device.revoke`
  of one's own device valid on the author's signature alone, of
  another member's device only under the `device.revoke` rule; a
  person whose last device is revoked remains a member.
- *Key port* — per adapter: KV1 (no removed device derives the new
  secret), KV2 (the new secret reaches exactly the retained set, the
  merged set under concurrency), KV3 (`keyOpDigest` present on the
  genesis and every enforcement operation and matching the key
  operation; for `linear/0.1` the digest over `keyDist`), KV4
  (history readable as far as the chain reaches), welcome carrying
  the current epoch only; KV5 and KV6 by scenario where declared
  (S7, S4b, S4d); healing after S4f; only key operations of
  canonical decisions reach the key port; a replica fed raw
  replicated state reaches the verdicts of one fed through any API.
- *`linear/0.1`* — retained set computed (remove subject excluded,
  discharged leaves excluded, no other shrink; mismatch or
  duplicate → invalid); no plaintext secret; key-envelope associated
  data bound to genesis digest, new epoch, and recipient, with
  cross-transition replay inert; commitment equality across epochs →
  invalid; `keys` closed (an extra property invalid); lineage in
  exactly one of `lineage`, authorized `historyNarrow`, or
  `lineageVoid` on a discharge only; the recovery form valid under
  the operation's own rule, `opens = 0` included; a false skip
  repaired by the repair duty, a span whose key holders are all gone
  dark under every form; the first canonical `lineage.repair`
  counts.
- *Key service duty and key delivery* — an authenticated request
  honored, an unsigned or third-party one not; a removed requester
  refused at the helper's current state; one outstanding answer per
  (`genesisDigest`, requester): requests at t = 0 and t = 59 min →
  one answer no later than t = 60 min, sealed to the card held at
  discharge; N requests in one interval → one forced answer; a
  request naming unknown state fails at once and never pends;
  `keydist` digest and epoch matched against the named transition;
  `refresh` toward a retained member and toward the founder, adopted
  only on a binding match; garbage material not adopted.
- *Bootstrap* — case-1 pre-checks, provisional adoption, and the
  three conditions at first materialization; a subject admitted in
  epoch N and removed in N+1, handed an honestly derived re-welcome
  for the epoch after the removal → the bootstrap fails on current
  membership, while the same shape without the removal in the
  reached state, and a re-admission with fresh consent, succeed; N
  fabricated re-welcomes plus one honest one → delay bounded by one
  `provisional-window`, at most one alternate buffered, a displaced
  candidate kept as digest and disposition only; the honest
  candidate displaced by ground digests → the invitee still
  bootstraps through the request path; window expiry without log
  arrival → complete wipe and retry from invite and accept; user
  drafts in a provisional space survive every wipe.
- *Leave and dissolve* — a pending exit excluded from the currency
  yet listed in views until discharge; discharge by any member of
  its position, a pending exit included, on a single signature
  against a restrictive `epoch.rotate` rule; last-member leave
  terminal, revived by a concurrent canonical admission; all members
  pending → the drained dissolve by any of them, while an active
  author cannot use the drained path; all-pending without a dissolve
  surfaced as dormant; `member.remove` of a non-member invalid;
  eviction at every membership end; commit-before-forward at a
  lagging replica, transitive forwarding included.
- *Views* (7.3) — registration with `class`; `seq` and `prevView`
  chain; epoch monotonicity; freshness window at acceptance; the
  quorum `m_effective = min(m_registered, |identities|)`, including
  a mutual removal that shrinks the identities below the registered
  `m` without freezing the service (S10c); gap and divergence
  persistently fail-closed; reconciliation; the terminal view and
  its retention window.
- *Services* — a registration without `class` invalid; each class
  receives no more than it grants; a service of every class carries
  authority operations of removed authors (S10c on both sides); a
  `view` or `log` service refuses content from an unlisted device
  (S10a) visibly and retriably; a removed member receives the
  removal notice.
- *Removal notice* — `$id` equal to the type URI; document proof
  absent, `issuer` equal to `author`; consistency failures
  `failed(validation-failed)`; `unique` on first surfacing and
  `duplicate-known` on redelivery; no state effect, a notice naming
  a fabricated `op` surfaced and inert; no re-alert by `op` after the
  completed-effect retention.
- *Visibility* — `E = newEpoch`; `history.expose` verified against
  the epochs' binding, valid only in `open` mode, range checked,
  adjacent ranges composing, a range over 4096 schema-invalid;
  publication idempotent per artifact.
- *`member-mapping@1` against real admissions* — both MACs against
  the cards named by `memberOp` and `toOp`, the founder side via the
  genesis; `to` not the addressee's member anchor → step 2; `memberOp`
  naming a non-admission, a foreign admission, or a former member →
  step 3; two admissions with different cards, the mapping verifying
  only under the named one; revision equivocation per (`member`,
  `to`) → step 7; a member anchor appearing in a second group's log
  → non-conformant at issuance.
- *Candidacy carrier* — a `member.add` that cites only Layer-4
  candidacy content fails materialization.


## 15. Open Issues

1. **OI-2 Threshold proofs (FROST).** Policy proofs and view
   quorums as single group signatures; DKG and resharing on
   membership change; external indistinguishability.
2. **OI-3 Group identifier migration.** Legacy UUID spaces to
   genesis digests; alias discipline.
3. **OI-5 Encounter-presentation minimal disclosure.**
4. **OI-7 Member-identity model.** Method agnosticism beyond
   `did:key`.
5. **OI-10 Shrink-robust policy forms.** Relative thresholds;
   recovery from a constitutional lock above emptiness.
6. **OI-12 Grantable capabilities and their exercise.** Grants,
   attenuation, revocation of grants, non-member read and relay
   exercise toward services, identity-set hiding. Blocked on a
   sound exercise mechanism.
7. **OI-13 The membrane.** Group-issued outward credentials need a
   closed credential profile before a `credential.issue` operation
   returns to the catalog.
8. **OI-14 Large groups.** Admission bounded at 4096 members, wire
   caps at 8192; membership beyond the bound is a named degraded
   state (3.6), recovery by attrition; devices bounded at 8 per
   member (5.1), so a view of a large group with many devices can
   exceed the 8192 identities the wire allows and is then
   unconstructible, the same degraded state. A successor profile
   with chunked or accumulator-based artifacts is needed for larger
   groups.
9. **OI-15 Concurrent admission of one device by two devices of
   its owner.** Two devices of one person, apart, may each bind the
   same third device into the key tree; the key port's merge of the
   duplicate is untested.
10. **OI-16 Service change.** Moving a group from one service to
    another without losing the view chain or the service's targets;
    with class `view` the successor must take the chain over from a
    registered view, with class `log` it replays the log.
11. **OI-17 Active attacker at the service.** The service rules of
    9.3 are shown against passive capture and against unauthorized
    operations; forged device cards, forged revocations and a
    service that lies about rejections are not yet tested.
12. **OI-18 Device × group identities.** A device identity that is
    the same across groups lets a service of class `view` or `log`
    correlate groups through the device (Section 13). An identity
    per device and group would close that; it is not in this
    version.


## Appendix A (informative): implementation notes

The reference library `lib/` (`@real-life/trust-protocol`) implements
the parts of this layer listed below. The table maps rule areas to the
modules and symbols that carry them; it describes the library as it
is.

| This specification | `lib/` module | Symbols |
|---|---|---|
| Canonical form, digest equality over decoded bytes, canonical `u` rendering (2.3, 3.2) | `core` | `jcs`, `toU`, `sameDigest` |
| Digests, `eddsa-jcs-2022` proofs for the vouch and the cards (2.3, 5.3), HKDF and ECDH primitives | `crypto` | `digestDoc`, `diSign`, `diVerify`, `hkdf`, `ecdh`, `anchorOfEd`, `mkOfX` |
| Member anchor from `group/<genesis digest>` and the founder's pair context (5.1, 3.4.1); community anchor (5.5) | `identity` | `labeledContext`, `pairContext`, `communityContext` |
| Wire shapes of this layer — envelope, material, view, registration, key delivery, removal notice, member mapping, vouch (Sections 3, 7, 9, 10; 5.3, 5.5) | `schemas`, `wire` | `SCHEMAS`, the generated types `AccessOperationEnvelope`, `AccessMaterial`, `AuthorizationView`, `AccessRegistration`, `PayloadKeyDelivery`, `PayloadRemovalNotice`, `MemberMapping`, `AccessVouch`, `PayloadAccessOperation` |
| Founding, the invitation prelude, invite, accept, the pair-internal admission checks of 5.3 (path convention, time window, size budget, card enclosure), `vouch@2` issuance | `/probe` `membership` | `foundGroup`, `memberContext`, `preludeRequest`, `buildInvite`, `acceptInvite`, `receiveDoc`, `vouchFor` |

The `/probe` entry point is not wire-normative: its transport shapes
carry `@probe` and will change, while the checks it runs are those of
5.3. The generated `wire` types and the `SCHEMAS` bundle track the
schemas in the repository and change with them; the 0.54 forms of the
envelope (`rltp-access/0.25`) and of the registration
(`rltp-access-registration/0.27`) enter the library when the schemas
are regenerated.

Not in the library: the operation envelope with `oid`, `prev`, and
epochs; materialization, the conflict matrix, and the outcome rules
(Sections 3.5, 3.6); policy evaluation (Section 4); device bindings
(5.1); the key port and both adapters (Section 9); authorization views
and service registration (7.3); the key service duty and the
`key-delivery` and `removal-notice` task flows (Section 10). The
authority rules of Section 3.6, the key port's invariants, the device
model, and the service classes are exercised in the experiment harness
`real-life-org/port-experimente` against `beekem/0.1`; that harness is
evidence for this document, not a reference implementation of it.

The conformance runner (`conformance/runner.mjs`) recomputes the
shipped vectors of Section 14 against the library, including the
`member-mapping@1` MACs, the `vouch@2` forms and digests, the
`u`/`z` equivalence of 3.2, and the registration artifacts of 7.3.


## Appendix C (informative): changelog

One line per version; the archived text of 0.4 and later is under
`archive/`, that of 0.1 to 0.3 in the previous-generation repository
(`real-life-org/wot-spec`, `rltp/`).

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-08-09 | First draft: authority log, policies, capabilities, epochs, service updates. |
| 0.2 | 2026-08-09 | Normative binding: operation envelope, revocation guarantees, policy algebra. |
| 0.3 | 2026-08-09 | Completed spine: authorization updates binding epoch, commitment, and log position. |
| 0.4 | 2026-08-11 | Enforcement port with a linear adapter; admission through the Membership Tasks. |
| 0.5 | 2026-08-11 | Single-founder genesis; leave takes effect at a transition; grants and group credentials deferred; merge, key bootstrap, and service freshness rebuilt. |
| 0.6 | 2026-08-11 | Group identity = genesis digest; no id in key associated data; founder card; retained set computed. |
| 0.7 | 2026-08-11 | Proof-free genesis digest; `u`/`z` digest encodings; pending exits listed in views; `1 ≤ m`. |
| 0.8 | 2026-08-11 | Canonical proof form; recovery rotation; `refresh` duty kind; replacement announcement; stepwise reconciliation. |
| 0.9 | 2026-08-11 | Canonical proof union; replica eviction; epoch secret derived from the content key; announcement effective at the next transition. |
| 0.10 | 2026-08-11 | Proof merge per voucher; fresh content key per epoch; deterministic reconciliation predecessor; caps at 4096. |
| 0.11 | 2026-08-11 | Derived merge label; terminal view constructible; group bound 4096 as a profile limit. |
| 0.12 | 2026-08-11 | Recovery form as a bridge, not a narrowing. |
| 0.13 | 2026-08-11 | History durability stated with repair as a duty; drained-group ending on the dissolve path; divergence tips from the held view DAG. |
| 0.14 | 2026-08-11 | Ready-set fold linearization; position-bounded proof merge; divergence quota. |
| 0.15 | 2026-08-11 | Capacity machinery removed: admission bound with tolerated overshoot; one eligible-signer set; `lineageVoid` on a discharge. |
| 0.16 | 2026-08-11 | Two-tier capacity bound; one contract for service-side divergence evidence. |
| 0.17 | 2026-08-11 | Merge never decides membership; aggregate transport cost bound; enforced evidence quota; removal notice as its own artifact. |
| 0.18 | 2026-08-11 | `policy.change` an enforcement operation; suppression cascade deleted; cost `any` = maximum. |
| 0.19 | 2026-08-11 | Non-empty compositions; concurrent same-subject admissions idempotent; closed merge-finality exception list. |
| 0.20 | 2026-08-11 | Content-bound accept consumption; no distinguished admission; reconciliation quorum from every named parent. |
| 0.21 | 2026-08-11 | Same-accept-only replay rule; no `actors` in the constitution; reconciliation quorum as the parents' maximum. |
| 0.22 | 2026-08-11 | Recursive effective quorum size; provisional window per (group, invitee). |
| 0.23 | 2026-08-11 | Key service duty as one outstanding, rate-served answer; bootstrap liveness on the request path. |
| 0.24 | 2026-08-11 | Duty slot with a fixed deadline; bootstrap guarantee stated as a chain; wire family 0.24. |
| 0.25 | 2026-08-12 | Current-member condition at the first-materialization gate; genesis-digest keying of slots, windows, throttles. |
| 0.26 | 2026-08-24 | Per-group member anchor; `member-mapping@1`; policy rule type `vouch`. |
| 0.27 | 2026-08-24 | Vouch admissibility; mappings name their admissions; founder key service via the genesis. |
| 0.28 | 2026-08-24 | Vouch bound to its accept digest; proof merge in vouch vocabulary. |
| 0.29 | 2026-08-24 | Task-type dispatch and companion pins aligned. |
| 0.30 | 2026-08-24 | `vouch@2` as a DTG EndorsementCredential. |
| 0.31 | 2026-08-26 | Evidence transport separated from authority forwarding; removal disposition over concurrent authorship; registration generations (`rltp-access-registration/0.25`). |
| 0.32 | 2026-08-26 | Quorum-authorized registration generations with tombstone; transitive removal disposition; shared `stalenessBound` cap. |
| 0.33 | 2026-08-26 | Evidence authorization for the forked state; sole-tip verification path; total disposition order. |
| 0.34 | 2026-08-26 | Evidence session; atomic send-point recheck; `reconciliation-impossible` rebind exit. |
| 0.35 | 2026-08-26 | Prefix claim and evidence request; generation token; byte-exact service-identity derivation. |
| 0.36 | 2026-08-26 | Canonical prefix claim bound to its evidence root; total evidence response; signed abandon block. |
| 0.37 | 2026-08-26 | Conflict-DAG prefix definition; three closed evidence artifacts; byte-exact abandon digests. |
| 0.38 | 2026-08-26 | Verifier-side conflict-DAG completeness; unified evidence signature input; restart asymmetry stated. |
| 0.39 | 2026-08-26 | Signed conflict supplement; single claim field set; total part envelope. |
| 0.40 | 2026-08-26 | Two-stage replica-source chain bootstrap; closed supplement artifact; per-generation registration preimages. |
| 0.41 | 2026-08-26 | Replica-source chain machinery removed; replica-source attestation session-scoped. |
| 0.42 | 2026-08-26 | Session scope applied throughout the evidence machinery. |
| 0.43 | 2026-08-26 | Unambiguous exclusion formula; total target-root domain; view evidence for historical generations. |
| 0.44 | 2026-08-26 | Recursive view-dependency closure for historical registration roots; total replica baseline partition. |
| 0.45 | 2026-08-26 | Registration binds `authorizationRoot`; transcripts feed the view DAG. |
| 0.46 | 2026-08-26 | Generation statement; view cursor; `rltp-access-registration/0.26`. |
| 0.47 | 2026-08-26 | Acceptance receipt under the predecessor root. |
| 0.48 | 2026-08-26 | Atomic acceptance commit; closed session-result mapping. |
| 0.49 | 2026-08-26 | Acceptance anchored in the live service session and the successor chain; CAS acceptance commit. |
| 0.50 | 2026-08-26 | Session anchoring applied throughout the evidence inventory and the vectors. |
| 0.51 | 2026-08-26 | Editorial: text reorganized; no rule changed. |
| 0.52 | 2026-08-26 | Acceptance-receipt and generation-statement forms removed. |
| 0.53 | 2026-08-26 | Community anchor terminology; `member-mapping@1` unchanged. |
| 0.54 | 2026-10-06 | Two ports: authority port and key port (KV1–KV6), adapters `linear/0.1` and `beekem/0.1`; conflict matrix without the enforcement-pair fork, concurrent removals with authority all take effect; persons in the log, devices in the key structure with device cards; service classes `blind`, `view`, `log` (`rltp-access-registration/0.27`); `keyOpDigest` (`rltp-access/0.25`); numbered rules with separate rationale; the sibling-epoch-merge open issue closed. |


## References

[RFC2119] · [RFC8174] BCP 14 · [RFC8785] JCS · [RFC9420] MLS
(epoch terminology) · W3C Data Integrity EdDSA Cryptosuites v1.0
(`eddsa-jcs-2022`) · W3C Verifiable Credentials Data Model 2.0 · DTG
Credential Specification (ToIP DTGWG, draft; EndorsementCredential)
· **RLTP Identity 0.51** (root IKM §4, contexts and the label
registry §6, derived service identities §7, migration §10, device
keys §15.1) · **RLTP Encounter Layer 0.30**, wire 0.25 (securing
profile 2.3, contact card §6, pair anchors §4.4) · **RLTP Delivery
Contract 0.79 (normative)** (document profile, sealed envelope §5,
dispositions §6) · **RLTP Membership Tasks 0.16 (normative)**
(document shapes §3, welcome seal §4, timing §5) · **RLTP Replication
Contract** (replication port, service targets) · **RLTP Network
Visibility 0.29** (§2.1 wire conventions, §3 audience classes, §6
mapping construction, §6a convergence net, §8 introduction act) ·
Keyhive / BeeKEM design documents (causal encryption; ePrint
2026/1434) · p2panda-auth documentation (resolver model).
