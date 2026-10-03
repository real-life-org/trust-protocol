# RLTP Replication Contract

**Real Life Trust Protocol — service contract: Replication**

- **Status:** Editor's Draft
- **Version:** 0.1.0-draft (first casting)
- **Editors:** Anton Tranelis
- **Date:** 2026-08-26
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Conformance profile:** `rltp-replication@0.1` (draft)
- **Companion pins:** Access Layer 0.30 (wire 0.24) · Identity Layer
  0.12 · Delivery Contract 0.21 · Membership Tasks 0.16 · Encounter
  Layer 0.28 (wire 0.25)
- **Position:** not a layer. Replication is the service behind the
  port the Access Layer requires (Access §10); every layer may use
  it, none depends on its internals.

## Abstract

This document specifies how replicated group state travels between
the replicas of its members. The replication service converges
**individually signed, sealed, causally linked entries** — gaplessly
relative to an attested target, idempotently, never silently
diverging — and promises **convergence over entries, never
readability of content**. It is key-blind by construction: no key
material crosses its port, no plaintext is required for any promise
it makes, and the substrate that moves the bytes stands outside the
trusted computing base.

The contract is sixteen promises (I1–I16, Section 5), each stated
with its preconditions, its closed set of observable outcomes, and a
counter-vector that falsifies a nonconformant implementation. Around
them it fixes the port line (Section 3), the attested convergence
target (Section 4), service authorization by presented authorization
views (Section 6), the single ingest admission every entry passes
regardless of how it arrived (Section 7), and the reader-state
vocabulary that keeps "converged" and "readable" from ever being
conflated above the line (Section 8).

## Status of This Document

This is an **Editor's Draft** with no standing beyond its own
argument, and the **first casting** of this contract. Its
requirements were not invented here: they are the decision record of
the port-contract pair (`design/portvertrags-paar-entscheide-2026-08.md`,
Revision 2), distilled from roughly 120 field issues of the deployed
previous-generation implementation and hardened by two adversarial
decision reviews (`design/portvertrag-review1-2026-08.md`,
`design/portvertrag-review2-2026-08.md`) before a single normative
sentence was cast. The sixteen promises carry their field provenance
in Appendix B.

This casting is deliberately **thin at the mechanism and honest
about where it is not thin** (1.3). It ships no wire schemas: every
encoding it needs is named by an adapter registration (Section 9),
and the vector plan (Section 13) is a trace-vector plan. It begins
its own adversarial convergence loop; the convergence criterion is
two consecutive review rounds without blocker-level findings.

## 1. Introduction (informative)

### 1.1 Essence and principles

- **Services read no foreign truth. They are shown it, attested —
  or they do not need it.** No promise of this contract requires
  any party to read another party's replicated state live. Where a
  service needs authorization truth, it is presented an
  authorization view (Access §7.3); where a replica needs a
  completeness truth, it is presented an attested convergence
  target (Section 4). Everything else it does not need.
- **Convergence is promised; readability is never promised.**
  The port replicates sealed bytes and verifies structure,
  signatures, and causality. Whether a converged entry can be
  *read* is a statement of a higher layer, made against key
  material this contract never touches (Section 8).
- **Key-blind by construction.** No unsealing, no derivation of
  secret material, and private keys never cross the port (I6).
  The payoff is architectural: a relay operator, a peer-to-peer
  mesh, or a cloud store moves sealed bytes without being trusted
  with anything — the trusted computing base shrinks to the
  enforcement adapter on the members' devices (Access §9.1).
- **One admission, every road.** State does not care how it
  arrived. Sync, a delivery-document effect, a local import, a
  recovery — every ingress passes the same admission (I14), so
  there is no privileged side door for a removed member's stale
  ciphertext and no carrier ever needs to read types in
  self-defense (Section 11).
- **The recovery channel is the replication channel.** A new or
  recovered replica converges from the log under I1 and rebinds
  under I15; nobody retains mail for unknown future replicas, and
  no additional recovery service exists or is needed.
- **Idempotency is content-bound.** An entry's identity is a
  deterministic function of its bytes; `duplicate` can therefore
  never mask divergent content.

### 1.2 The two sides of the line

Two conformance classes implement this contract (Section 13):

- A **replica** is the entry store on a member's device, below the
  enforcement adapter (Access §9). It holds plaintext-capable
  context *above* itself but is itself only the store-and-exchange
  machine; it runs the full ingest admission (P1 + the epoch gate +
  P2), applies entries causally, and forwards only what it has
  canonically committed.
- A **service** is a durable, key-blind party — a relay, a broker,
  a storage host — registered by the group under Access §7.3 and
  thereby holding the `relay` role (Access §7.3, registration):
  it stores and forwards the group's ciphertext. It authorizes
  read and write **only** against presented authorization views,
  it cannot evaluate policy, and it never needs to.

Adapters — the bindings of concrete substrates and transports to
this port — are below the line and appear only through their
registration (Section 9).

### 1.3 Honest thinness: the doors that are fixed

"Thin" does not mean mechanism-free. This contract deliberately
fixes four doors, and names them rather than pretending openness:

1. entries are **individually signed operations in a causal DAG**
   (Access §9.1 — the substrate admissibility floor);
2. enforcement operations and their epoch transitions are **atomic
   commits** with replica eviction (I4, Access §9.3);
3. authorization toward services is **view-shaped** (I7, Access
   §7.3) — chained, quorum-signed, epoch-monotone;
4. concurrency of enforcement is **fail-closed** (I16, Access
   §3.6) — no winner-picking anywhere.

Everything below those doors is open: transport, topology, storage,
encoding, batching, CRDT or log, push or pull. Section 10 maps the
candidate substrates against exactly this line and says honestly
which door each one currently fails.

## 2. Conventions and Terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" are to be interpreted as described in BCP 14 [RFC2119]
[RFC8174] when, and only when, they appear in all capitals.

**Group identity** is the genesis digest of Access §3.2; it is the
only group name this contract uses, and it is never derived from key
material (I15).

**Entry** — the unit of replication: an immutable byte string with
port metadata. Two classes exist: **authority entries** (the
operation envelopes of Access §3.3, individually signed, forming the
authority log) and **content entries** (sealed document bytes bound
into the same causal DAG). **Entry id** — the content-bound identity
of an entry: a deterministic function of its bytes under the
adapter's registered id rule; for authority entries it MUST equal
the operation id of Access §3.3. **Parents** — the entry ids an
entry causally depends on. **Closure** — an entry together with
every ancestor reachable through parent references. **Frontier** —
a set of entry ids no held entry has as a parent (the heads of a
DAG). **Session** — one authenticated exchange between a replica
and a source, with a fresh session identifier. **Source** — the
counterparty a replica converges from in a session: a service or
another replica. **Page** — a source-delimited batch of entries
within a session. **Run** — one identified attempt at a declared
goal (a catch-up, a repair), session-scoped, with exactly one
terminal outcome (I3). **Convergence target** — the attested triple
`(source, session, frontier)` of Section 4. **Ingest admission** —
the single evaluation of Section 7. **Reader state** — the
above-the-line readability vocabulary of Section 8.

| Term | Fragment |
|---|---|
| Entry | `#Entry` |
| Frontier | `#Frontier` |
| Convergence target | `#ConvergenceTarget` |
| Ingest admission | `#IngestAdmission` |
| Admission verdict | `#AdmissionVerdict` |
| Run | `#Run` |
| Reader state | `#ReaderState` |

## 3. The Port Line

### 3.1 What the port knows

The port metadata of an entry is **closed**: group identity, entry
id, parent ids, class (`authority` | `content`), size, and the
session it arrived in. A conformant implementation MUST NOT require
any further metadata for any promise of this contract, and an
adapter registration MUST NOT extend this set with fields whose
values require plaintext to produce.

### 3.2 What the port never knows

The port knows no persons, no devices, no document types, no group
membership of its own reading, no keys, and no plaintext.
Normatively:

- No promise of this contract may be implemented by reading
  replicated state that belongs to another party's authority —
  membership truth reaches a service only as a presented view
  (I7), never by inspection.
- The port performs **no unsealing and no derivation of secret
  material**, and **private keys MUST NOT cross the port in either
  direction** (I6). Public-key operations — verifying a signature,
  checking a digest, comparing a commitment — are duties, not
  violations.
- A service stores and forwards ciphertext; nothing in this
  contract requires it to distinguish entry payloads beyond the
  closed metadata of 3.1. In particular, **no carrier reads
  payload types**: type dispatch is the receiving replica's
  admission (Section 7) and the Delivery Contract's receiver
  pipeline (Delivery §6.2), never transport self-defense.

### 3.3 Where the keys live instead

Key handling stays where the Access Layer put it: in the
enforcement adapter as named trusted computing base (Access §9.1,
P4) and in the pull path `key-delivery/0.1` (Access §10.1). Epoch
transitions commit their key material **by digest** (Access §7.1);
the sealed envelopes travel as delivery documents and are separately
repairable under the key service duty (Access §5.3). Delivery
transports no authority disposition — but it does transport that
disposition's digest-bound, separately repairable key material. The
replication port sees neither: it replicates the transition entry
like any other entry.

## 4. The Convergence Target

Every completeness statement of this contract is relative to an
**attested convergence target** — never to silence, never to local
shape, never to "the log" as an unbounded whole.

A convergence target is the triple:

- **source** — the authenticated identity of the counterparty in
  this session (Section 6: a registered service, or a peer replica
  authenticated as a member);
- **session** — the session identifier both sides hold;
- **frontier** — the source's declared frontier at attestation
  time: the set of entry ids it asserts as its heads for this
  group.

**Attestation rule.** The target MUST be attested by the source:
bound to the session and verifiable under the same identity the
session was authenticated with. The encoding is named by the
adapter registration (Section 9); the fields above and the binding
are normative regardless of encoding.

**Supersession rule.** A later target from the same source
supersedes an earlier one; it never retroactively invalidates a
verdict reached against the earlier target. `reached(F)` remains
true for `F` forever; the world has merely moved on to `F′`.

**No-vacuum rule.** Absence of a target licenses no completeness
claim of any strength. A replica that has exchanged entries without
holding an attested target holds pages, not convergence (I5).

## 5. The Sixteen Promises

Each promise below is stated with the discipline this contract
demands of itself: the normative statement, the conformance class
it binds, its preconditions, its closed set of observable outcomes,
and at least one **counter-vector** — a trace on which a
nonconformant implementation is caught. Field provenance is
collected in Appendix B.

### 5.1 I1 — Catch-up

**Promise.** A replica that appears late — a new device, a
recovery, a long-offline peer — converges against an attested
convergence target from the log itself. No party retains delivered
mail for unknown future replicas, and no catch-up promise rests on
retained delivery documents.

**Class.** Replica (as consumer); source duty on service and
replica (as source).

**Preconditions.** An authenticated session (Section 6); an
attested target `(source, session, frontier F)` (Section 4).

**Observable outcomes** (closed set, per run):

- `reached(F)` — every entry of `F`'s closure is admitted locally;
- `missing(set)` — the run terminated with the named entry ids
  still absent (repair continues under I12);
- `source-ended-before(F)` — the source ended the session before
  serving `F`'s closure.

**Counter-vector.** Source S serves a closed page up to head H and
ends the session; no attested target was presented. A conformant
replica reports a delivered page and **no** catch-up outcome; an
implementation that reports `reached` — "converged from the log" —
on this trace is nonconformant. "From the log" is not a
completeness bound; the target is.

### 5.2 I2 — Causal application

**Promise.** No epoch-N content is ever applied, forwarded, or
exposed to a reader before the epoch-N transition is canonically
applied. In the DAG model this is causality, not a special rule: an
entry of epoch N causally descends from the epoch-N transition, and
admission requires the closure (I14) while application follows
causal order.

**Class.** Replica.

**Preconditions.** Admission per Section 7.

**Observable outcomes.** An entry is either applied at a position
where its full closure is applied, or held `missing-closure` —
never applied ahead of its causal past.

**Counter-vector.** A content entry of epoch N arrives before the
epoch-N transition. A conformant replica holds it
(`missing-closure`, repair per I12) and applies it only after the
transition; an implementation that applies or surfaces it first —
or that buffers it in a side pool that bypasses admission when the
transition arrives — is nonconformant.

### 5.3 I3 — Run/outcome pairing

**Promise.** Every reported run reaches **exactly one** terminal
outcome from its goal's closed outcome set — under overlap, under
error, under crash-and-restart. Runs carry fresh identifiers;
overlapping runs each terminate independently; a crashed run is
terminated (`aborted`) by its successor, never silently absorbed.

**Class.** Both.

**Preconditions.** A run is *reported* when the implementation
surfaces its start through the samplable state of I8.

**Observable outcomes.** The goal's closed set — for catch-up, the
I1 set; for repair, the I12 set — plus `aborted(reason)` and
`failed(reason)` with reasons from the adapter's registered closed
reason set.

**Counter-vector.** Two catch-up runs against different sources
overlap; the first completes `reached(F₁)`, the second crashes. A
conformant implementation later shows both terminals (`reached(F₁)`
and `aborted`); an implementation showing one combined outcome, or
a started run with no outcome after restart, is nonconformant.

### 5.4 I4 — Commit-before-forward and replica eviction

**Promise.** This contract promises what Access P2 requires of it
(Access §9.3), as three separable assertions:

1. **Commit:** an enforcement operation and its epoch transition
   are one committable artifact in the replica's store — no
   observable state in which one holds without the other.
2. **Forward gate:** a replica forwards an entry only after its own
   canonical, durable application of that entry
   (commit-before-forward; durability per I9).
3. **Eviction:** replica-side, the forwarding gate stops serving
   descendants of a removal to the removed member's replicas once
   the removal is committed; service-side, eviction is enacted by
   the next presented view (I7) — the removed member's derived
   identity is absent, and the service fails closed toward it.

**Class.** Replica (1, 2); replica and service (3).

**Preconditions.** Admission of the enforcement artifact (I14).

**Observable outcomes.** For any crash point: after restart, either
the whole enforcement artifact is durably applied or none of it is;
no counterparty ever received an entry its sender had not durably
committed.

**Counter-vector.** A replica applies a removal, crashes before the
transition's commit completes, restarts, and serves pre-removal
descendants to the removed member's replica. Conformant behavior:
the artifact is atomic, so after restart either both halves hold
(and the gate blocks) or neither does (and nothing claims the
removal happened). An implementation observable in the half-state
is nonconformant.

### 5.5 I5 — The convergence predicate, three-staged and never about readability

**Promise.** Convergence is a three-stage predicate over entries,
always relative to an attested target (Section 4):

1. **locally read** — the entry is admitted into the local store;
2. **page delivered** — a source-delimited page arrived complete;
3. **gaplessly converged** — `reached(F)`: the target frontier's
   closure is admitted, no gaps.

Readability is **never** a stage of this predicate and MUST NOT be
inferred from any stage of it (Section 8). Later frontiers
supersede; they never retroactively invalidate (Section 4).

**Class.** Replica.

**Preconditions.** Stages 2–3 require the session's page
delimiters, respectively the attested target.

**Observable outcomes.** The three stages as samplable state (I8),
each relative to its `(source, session, frontier)`.

**Counter-vector.** A replica holds a contiguous chain to head H,
sees network silence, and reports "fully synchronized" without an
attested target — nonconformant (the field's false
`complete: true`). Equally nonconformant: any surface deriving
"readable" or "up to date, contents available" from stage 3 alone.

### 5.6 I6 — Key-blindness

**Promise.** The port performs no unsealing and no derivation of
**secret** material; private keys never cross the port in either
direction; no promise of this contract requires plaintext. Public
material is untouched by this rule: verifying signatures, computing
entry ids, comparing commitments and digests are port duties.

**Class.** Both, and every adapter.

**Preconditions.** None — this is an unconditional prohibition.

**Observable outcomes.** Not samplable at runtime; this is an audit
criterion of the conformance class (Section 13), like Access
§9.1's adapter obligations. Its checkable core: no API of a
conformant port implementation accepts or returns private key
material, and no port metadata field (3.1) requires plaintext to
produce.

**Counter-vector.** An adapter that "optimizes" catch-up by
unsealing entries to deduplicate semantically, or a port API whose
sync request carries a content key so the service can filter — both
nonconformant by construction, whatever their behavior.

### 5.7 I7 — Authorization only against the presented view

**Promise.** A service authorizes **read and write** exclusively
against the presented authorization view, under the **complete**
duty set of Access §7.3, incorporated here by reference:
registration with exact-byte service identity, seq/prevView chain
verification, quorum-intersection signature checking, epoch
monotonicity, the freshness window on both ends, challenge-based
proof of possession under derived identities, and the divergence
obligations (never a winner-picker; evidence contract; anchor
ratchet). An expired or inconsistent view is **fail-closed for
reads AND writes**. Between replicas, authorization derives from
each replica's own materialized membership at its current head
(P1) — with the same fail-closed rule under the forked state
(Access §3.6).

**Class.** Service (view path); replica (peer path).

**Preconditions.** Registration (Access §7.3) for the service
path; an authenticated member identity for the peer path.

**Observable outcomes.** Per request: `authorized` ·
`denied(no-standing)` · `fail-closed(stale-view)` ·
`fail-closed(divergence)` · `fail-closed(forked)` — a closed set;
`denied`/`fail-closed` answers carry no information beyond the
verdict.

**Counter-vector.** A member is removed in epoch N+1; the service's
newest accepted view is the epoch-N view, now past `validUntil`.
The removed member requests a full catch-up read. An implementation
that serves the read because "reads are harmless" is nonconformant
— fail-closed binds both directions; this is the review-confirmed
correction of exactly that leaning.

### 5.8 I8 — State, not edge

**Promise.** Every promised condition of this contract —
convergence stages per target, admission verdicts, run outcomes,
fork state, durability states, reader states where surfaced — is
exposed as **idempotently samplable state**, monotone within its
scope. Events MAY exist in addition; no promise is discharged by an
event alone. A consumer that missed every event can still read the
truth.

**Class.** Both.

**Preconditions.** None.

**Observable outcomes.** The named query surface itself: for each
promise, a predicate over current state, stable under re-query,
whose value depends only on held state — never on having observed a
transition.

**Counter-vector.** An implementation signals `reached(F)` once on
a callback; a consumer attaching later finds no way to learn it and
re-triggers a full catch-up, or worse, reports non-convergence. Any
design in which sampling and event disagree, or in which the truth
is only in the event, is nonconformant.

### 5.9 I9 — Transaction-bound durability

**Promise.** Three states are distinguished and never conflated:
**written** (applied inside an open local transaction), **durable**
(that transaction committed to the named durable store), **offered**
(made available beyond the local replica). Every durability gate
binds to the **concrete transaction** of the state it gates — never
to a global flush flag, a timer, or an unrelated commit. Allowed
transitions: written → durable → offered; a crash rolls back to the
last durable state, and nothing ever reported `durable` is lost by
a crash after the report.

**Class.** Both.

**Preconditions.** The adapter registration names the durable
store.

**Observable outcomes.** The three states per entry (or per page,
I13), samplable (I8).

**Counter-vector.** An implementation reports `durable` when the
write buffer is handed to the storage engine but before its
transaction commits; a crash loses the entry while a counterparty
already advanced its frontier accounting. Nonconformant — the
field's acked-but-lost class.

### 5.10 I10 — Local truth never replicates

**Promise.** The following classes of state are **local by
contract** and MUST NOT be written into replicated state, in any
encoding, by any party:

1. reader states and readability verdicts (Section 8);
2. convergence verdicts and targets (they are session-relative);
3. transport and delivery status, retry and scheduling state;
4. local store namespaces, device-scoped identifiers, and any
   identifier whose scope is one installation;
5. admission verdicts — a verdict travels as recomputation under
   P1 (every replica re-judges identically), never as data;
6. the local clock.

**Class.** Replica.

**Preconditions.** None.

**Observable outcomes.** Structural: no replicated entry admitted
under this contract carries state of the classes above.

**Counter-vector.** A replica replicates "device X has read up to
seq N" into group state to drive another device's UI; a second
implementation, correctly, does not — and the two now disagree
about the group's replicated content on identical input.
Nonconformant on the first side; the class of the field's
device-table coupling.

### 5.11 I11 — Retry authority lives in the durable log

**Promise.** For replication traffic, the durable log **is** the
send-truth: what must reach a counterparty is derived, at any time,
from the durable store and the counterparty's acknowledged
frontier — never from a generic outbox of queued send-intents.
There is no replication outbox to drain, and after any crash the
send set is recomputed, not replayed.

**Class.** Replica (sender side).

**Preconditions.** I9 durability states.

**Observable outcomes.** After crash-and-restart with a
counterparty at frontier F: the send set equals the durable store's
excess over F — nothing doubled beyond idempotency, nothing
dropped, no orphaned queue intent.

**Counter-vector.** An implementation enqueues "send entry E to S"
as its authority; the queue survives a store rollback (or is lost
while the store kept E) and the two truths diverge — an endless
resend loop, or a silent drop. Nonconformant; the field's outbox
loop class.

### 5.12 I12 — Gap repair, addressed and terminating

**Promise.** On detecting a missing dependency — a parent id
referenced by an admitted or held entry that no held entry bears —
the replica issues a **repair request**: addressed to an
authenticated source (Section 6), carrying evidence (the
referencing entry ids, so the request is checkable), and
**terminating**: each repair run ends, within the adapter's
declared `repair-horizon`, in exactly one outcome. Repair is
re-runnable; an unreachable source yields a retryable state, never
silence.

**Class.** Replica (requester); source duty on both (responder: a
source MUST answer a checkable repair request for entries it holds
and the requester is authorized to read, per I7).

**Preconditions.** A named missing set; an authenticated source.

**Observable outcomes** (closed set, per run): `repaired(set)` ·
`missing(set)` (still absent; retryable) ·
`source-ended-before(set)` · `denied` (I7) · `aborted(reason)`.

**Counter-vector.** A replica detects a gap and waits, unbounded
and unreported, for the substrate to gossip the entry by chance; no
run, no outcome, no samplable state — nonconformant. Equally
nonconformant: a repair "protocol" whose request names no evidence,
so a source cannot distinguish it from a fishing read.

### 5.13 I13 — The scale statement

**Promise.** Per-entry obligations are bounded and batchable: the
contract requires **no** per-entry durable commit and no per-entry
round trip. Admission MAY be judged and committed **per page** (one
durable transaction per page), frontier comparison is per session,
and every per-entry duty (id computation, signature verification,
dedup) MAY be performed in batch. What remains per entry is
identity and verdict — never I/O.

**Class.** Both.

**Preconditions.** Page semantics per the adapter registration.

**Observable outcomes.** The durability states of I9 at page
granularity; per-entry verdicts (I14) regardless of batching.

**Counter-vector.** An implementation that *requires* an fsync per
entry to satisfy I9, or a port API that forces one request per
entry for catch-up, fails this promise's ceiling — it makes the
contract unimplementable at field scale. (The field's
8 990-key-import cold start is the neighboring lesson **above** the
line: the key import that dominated it is reader-side work outside
this port per I6 — noted here so no one relocates that cost into
the port to "fix" it.)

### 5.14 I14 — All-ingress admission

**Promise.** Every ingress into replicated state — network sync, a
delivery-document effect, a local import, a snapshot, a recovery —
passes the **same** ingest admission (Section 7) before any effect
or forwarding. There is no privileged road. Input forms per
ingress are closed: a full operation with its closure available; a
registered verifiable snapshot profile (**none is registered in
this casting** — snapshot ingest is therefore inadmissible today);
anything else is inadmissible. The verdict set is closed:
`accepted | duplicate | missing-closure | invalid | forked` — and
**only `accepted` triggers effect or forwarding**.

**Class.** Replica (full admission); service (the blind admission
of 7.3).

**Preconditions.** Per ingress type, per Section 7.

**Observable outcomes.** The five verdicts, per entry, samplable
(I8).

**Counter-vector.** A registered delivery task type's "defined
effect" writes an attached artifact directly into the replica's
store because the document already passed Delivery's §6.2 pipeline.
A removed member wraps stale old-epoch ciphertext in exactly such a
document. Conformant behavior: the artifact enters admission like
any synced entry and falls to `invalid` at the epoch gate;
the direct write is nonconformant — it is the reopened
generation-gate bypass this promise exists to close (Section 11).

### 5.15 I15 — Rebinding after local loss

**Promise.** After loss of local replica state — store wipe,
namespace loss, device migration — a replica rebinds to durable
sources through the **stable group identity alone**: the genesis
digest (Access §3.2), never a local namespace, never a
device-scoped identifier, and never an identity derived from key
material. Rebinding separates four concerns, each with its own
failure: the stable identity (what to rebind), discovery (where —
adapter-registered mechanism), source authentication (Section 6),
and the target frontier (Section 4). A local namespace MUST NOT
determine the reachability of previously acknowledged entries.

**Class.** Replica (rebinding); service (durable source presenting
an attested frontier on rebind).

**Preconditions.** Held or recovered group identity and member
identity; a discovery mechanism.

**Observable outcomes** (closed set, per rebind run):
`rebound-and-reached` · `source-auth-failed` ·
`entry-not-in-frontier` (a previously acknowledged entry is absent
from every authenticated source's attested frontier — surfaced,
never silently accepted) · `conflicting-sources` (authenticated
sources present irreconcilable frontiers for the same group —
surfaced; resolution is union catch-up under I1 where closures
merge, or the forked state where they conflict per I16).

**Counter-vector.** Sources S₁ and S₂ both authenticate for group
G; only S₂ holds previously acknowledged entry E. An implementation
that rebinds to S₁ (last known), reports success, and never
surfaces E's absence is nonconformant: the vector
`(stable-id, source proof, advertised frontier, acknowledged E)`
must end in `rebound-and-reached` only if E's frontier check
passes — otherwise `entry-not-in-frontier` or union catch-up. The
field's orphaned-acked-log class.

### 5.16 I16 — Enforcement concurrency is forked, nothing else

**Promise.** Two transitions of the same predecessor epoch that are
not causally ordered yield **one** result: the **forked state** of
Access §3.6, verbatim — no sibling and no descendant of a sibling
is canonically applied or forwarded; all authorization answers are
fail-closed; services holding evidence of both siblings hold their
own fail-closed state (Access §7.3 obligation 5); the condition is
surfaced. Winner selection does not exist in this contract and MAY
only ever be introduced together with Access OI-1 as a coordinated
Access re-cast. Eviction (I4) applies to the canonical commit — in
the forked state there is none, and no eviction is enacted on
either sibling's claim.

**Class.** Replica (application and forwarding); the service side
is Access §7.3 obligation 5, incorporated via I7.

**Preconditions.** Admission of two sibling transitions (verdict
`forked`, Section 7).

**Observable outcomes.** The forked state as samplable state (I8);
per sibling entry the `forked` verdict; exit only by
reconciliation (OI-1 terrain — RO-1).

**Counter-vector.** Implementation A picks the sibling with the
smaller operation id, applies it, forwards its descendants;
implementation B materializes `forked` and forwards nothing. Same
trace, opposite worlds — A is nonconformant, and the wire it
forwarded is the divergence. Any deterministic-looking local
tie-break is winner-picking and forbidden.

## 6. Sessions and Source Authentication

A session is one authenticated exchange. Its authentication is the
precondition of every completeness artifact (Section 4) and every
authorization verdict (I7):

- **Replica ↔ service:** the service authorizes the replica by
  challenge-based proof of possession of a derived identity listed
  in the current accepted view (Access §7.3); the replica
  authenticates the service against the exact-byte service
  identity of the group's registration (Access §7.3 —
  registration). Personal anchors are never presented to a service
  (Identity §7).
- **Replica ↔ replica:** mutual proof of possession of member
  identities; each side judges the other against its own
  materialized membership at its current head (P1), fail-closed
  under the forked state.

Session identifiers MUST be fresh per session; frontier
attestations and page delimiters bind to the session (Section 4).
A source MUST NOT reuse a session's attestations in another
session.

## 7. Ingest Admission

### 7.1 One admission, stated once

Admission is the single evaluation between "bytes arrived" and
"entry exists in replicated state". For a replica it comprises, in
order:

1. **Shape:** port metadata complete (3.1); entry id recomputes
   under the registered id rule (content-bound); size within the
   registered bound.
2. **Dedup:** an already-admitted id is `duplicate` — terminal,
   idempotent, no second effect. Only ids whose admission
   *completed* count; a previously rejected entry is re-evaluated
   in full.
3. **Closure:** every parent admitted or present in the same page;
   otherwise `missing-closure` (held, repair per I12; never
   effect, never forwarding).
4. **Validity (the epoch gate included):** for authority entries,
   the full P1 evaluation — Access §§3.4, 3.6 (outcome rules
   included), 5.3 — under the materialized state of the entry's
   ancestry; for content entries, writer signature verification
   and the **epoch gate**: the writer holds membership at the
   entry's causal position, and the entry's declared epoch is the
   epoch of its position. Failure is `invalid` — terminal for
   these bytes.
5. **Concurrency outcome:** a sibling transition of an already
   admitted transition of the same predecessor epoch — or any
   descendant of a sibling — is `forked` (I16): held as evidence,
   surfaced, never effect, never forwarding.
6. **Effect:** only now, and atomically where the entry is an
   enforcement artifact (I4): `accepted`.

The verdict set is closed: **`accepted | duplicate |
missing-closure | invalid | forked`**. Only `accepted` triggers
effect or forwarding. Verdicts are recomputation, never data
(I10): every conformant replica reaches the same verdict for the
same entry over the same ancestry — Access P1's raw-state clause
(Access §9.2) applies to every ingress form.

### 7.2 Ingress forms

| Ingress | Admissible input form |
|---|---|
| Network sync (session) | full entries with closure per page |
| Delivery-document effect | the enclosed artifact as full entries with closure — through this admission, never a direct write (I14) |
| Local import / tooling | full entries with closure |
| Recovery / rebind | full entries with closure (I15 governs the source) |
| Snapshot | a **registered verifiable snapshot profile** — the registry is empty in this casting; snapshot ingest is inadmissible (RO-2) |

A future snapshot profile MUST preserve P1's equal-verdict rule
(a replica ingesting the snapshot reaches the same verdicts as one
that replayed the operations) — that is the registration bar, and
it is why the registry ships empty rather than half-open.

### 7.3 The service-side (blind) admission

A service cannot evaluate validity and never needs to. Its
admission is: writer authorized per the current view (I7); shape
and size bounds (3.1); dedup by entry id. Its verdict set:
`stored | duplicate | denied(no-standing) | refused(bounds) |
fail-closed(stale-view | divergence | forked)`. A service verdict
is a storage verdict, **never** a validity claim — poison that an
authorized writer stores is caught by every replica's admission
(7.1), and standing itself is revoked by the next view (I4
eviction). This two-sided cut is the structural successor of the
previous generation's carrier-side type whitelist (Section 11).

## 8. Above the Line: Reader States

Whether an admitted entry is *readable* is not this contract's
promise — but the vocabulary in which the layer above answers it is
fixed here, so that "converged" can never silently impersonate
"readable" again:

- `readable` — key material at hand; content opens.
- `blocked-by-key(retryable)` — material not yet at hand, and a
  live claim exists: the normative entitlement of the key service
  duty (Access §5.3) or a pending `key-delivery` (Access §10.1).
  This is a waiting state with a named claim, never an error.
- `unreadable(no-holder | lineage-void | history-narrowed |
  repair-refused)` — the terminal dark states of Access §7.1: no
  member holds the span's key · an unbridged void · an authorized
  narrowing · repair entitlement exhausted or refused. Terminal
  until the world changes (a holder returns, a repair lands).

**Surface rule (normative for conformant consumers of this port):**
any surface that shows convergence MUST show the convergence
frontier (I5) and the readability frontier as **two** statements;
deriving one from the other, in either direction, is nonconformant.
Authority state is never dark (Access §3.1) — at most content is,
and at most until repaired.

## 9. Adapter Registration

An adapter binds a substrate and transport to this port. Its
registration names, at minimum:

- the **substrate** and which conformance classes it serves
  (replica, service, both);
- the **entry-id rule** (content-bound; equal to Access §3.3
  operation ids for authority entries);
- the **session** mechanism and its authentication binding
  (Section 6);
- the **target and page encodings** (Section 4) — how frontier
  attestations and page delimiters travel;
- the **discovery mechanism** for rebinding (I15);
- the **durable store** boundary that I9's `durable` binds to;
- the declared constants: `repair-horizon` (I12) and the closed
  `aborted`/`failed` reason sets (I3);
- the **snapshot profile**, where one exists (none in this
  casting — RO-2).

A registration MUST NOT weaken any promise of Section 5; where a
substrate cannot carry a promise, the adapter carries it above the
substrate or the substrate is not admissible (Access §9.1 names
the floor).

## 10. Candidate Substrates (informative, assessed 2026-08)

The honesty companion of 1.3: per candidate, against the fixed
doors. "Native" — the substrate carries the promise itself;
"adapter duty" — an adapter above it must; "excluded today" — a
current property of the substrate contradicts a door.

| Candidate | Assessment |
|---|---|
| `linear/0.1` (Access §9.6) | the reference: all sixteen promises, single-lane enforcement (I16 trivially — no sibling epochs by construction); the interim scope until OI-1 |
| **p2panda** | best fit for admission and causality: P1 via replaceable resolver — I14/I2 near-native; its encryption must live in the enforcement adapter (TCB), only sync/storage stays behind this port; I1/I5 targets and I15 discovery are adapter duty; browser story open |
| **Keyhive/BeeKEM** | P3 exemplar (causal encryption), but removal rekeying is lazy and removal/rekey are separable — fails I4's atomic door today (excluded today at I4; adapter cannot repair a substrate-level atomicity gap); policy injection point (P1/I14) missing — contribution target |
| **SECSYNC** | key distribution and rotation are explicitly out of its scope, authorization optional/external, a central service can exclude participants undetected — fails I4, I7, I12 without an authorization-and-repair layer above; snapshot-centric model meets an empty snapshot registry (RO-2); adapter duty at best, substantial |
| **NextGraph** | causal DAG and key-blind broker transport are native (I2, I6 service-side); brings its own repo/permission/quorum/epoch system — its verifier decrypts and therefore lives in the TCB adapter, and translating authorization views into its permission model is a thick adapter, not a binding; I7-as-specified is adapter duty |

None is a conformant adapter today; the two named gaps
(Keyhive P1/P2, p2panda P3-relocation) are concrete contribution
targets, and the port is shaped so each could become an adapter
without changing this contract.

## 11. Security Considerations

- **The removed-member injection, closed structurally.** The
  previous generation's carrier whitelist existed because a
  removed member could wrap old-epoch ciphertext in an arbitrary
  envelope type and reach replicated state live, bypassing the
  generation gate; with one channel for two delivery classes, a
  cold-start inbox that must stay open, and an E2EE-blind broker,
  the type space was the only lever left — at the price of carrier
  extensibility. This contract removes the lever's reason: no
  delivery document reaches replicated state except through
  admission (I14), the epoch gate sits in admission at **every**
  replica (7.1 step 4), service standing is view-shaped and
  revoked by the next view (I7, I4), and the carrier is type-blind
  again (3.2). What remains for a service is resource defense —
  bounds, quotas, registration — never content inspection.
- **TOCTOU on authorization.** A service acting on live-read
  foreign truth was the field's stale-authorization class. Views
  are presented, chained, freshness-bounded, and fail-closed in
  both directions (I7); within one epoch the authorized set only
  grows (Access §7.1), so a slightly stale view never grants what
  the log revoked.
- **Insider fork is denial of service, never authority gain.** A
  malicious authorized member can force the forked state (I16);
  it is fail-closed, attributable, and surfaced (Access §3.6).
  Winner-picking anywhere — including "just locally, just for
  liveness" — converts that DoS into potential authority theft
  and is forbidden.
- **Dark spans are stated, not argued away.** Where no member
  holds a span's keys, that content is factually dark (Access
  §7.1's durability theorem); Section 8 forces surfaces to say so
  instead of hiding it behind a convergence checkmark.
- **Replay and duplication are the normal case.** At-least-once
  transport, crash-retry, and multi-source catch-up all converge
  through content-bound idempotency (7.1 step 2); re-serving old
  entries is harmless by construction, and admission verdicts
  never depend on arrival order beyond causality (closure).
- **Resource exhaustion at services** is bounded by registration
  (Access §7.3's evidence contract bounds view-path work;
  presentation rate limits per genesis digest), size bounds
  (3.1), and page bounds (adapter-registered). A service under
  attack fails toward refusal of storage, never toward serving
  unauthorized reads.
- **The port stands outside the TCB** (3.3): nothing in this
  contract makes a substrate operator safe to trust with keys,
  because nothing ever hands them any.

## 12. Privacy Considerations

- **What a service sees:** the group's genesis digest, derived
  service identities from presented views (never personal anchors
  — Identity §7), entry sizes, parent-graph shape, session timing,
  and its own storage verdicts. It never sees plaintext, types,
  member counts beyond the view's identity list, or reader
  behavior (reads are catch-up-shaped, not per-document).
- **Traffic analysis is not hidden.** DAG shape and timing
  correlate activity; this contract does not claim otherwise.
  What bounds the exposure is identity discipline (derived
  identities per group; the carrier-relationship identity of the
  Delivery side is its own coordinated work) — not the absence of
  observers.
- **Local truth stays local by contract** (I10): reader states,
  retry state, and device identifiers never enter replicated
  state, so they are not exposed to any counterparty, service or
  peer.

## 13. Conformance

- **Profile** `rltp-replication@0.1`; companion pins per the
  header.
- **Classes:** *replica* (Sections 4–9 in full; the admission of
  7.1) · *service* (Sections 4, 6, 7.3, and I1/I3/I6/I7/I8/I9/
  I12/I13/I15 in their service roles). Adapters are below the
  line and conform through their registration (Section 9). I6 and
  the TCB boundary are audit criteria (Access §9.1's class);
  everything else is trace-testable.
- **No shipped schemas in this casting.** Encodings are
  adapter-registered (Section 9); the normative surface of this
  contract is semantics, fields, and closed outcome sets.
- **Trace-vector plan** (each vector is a trace plus the required
  verdicts; the sixteen counter-vectors of Section 5 are the
  floor):
  - page-without-target → no completeness claim (I1/I5);
  - out-of-order epoch content → held, then applied causally
    (I2);
  - overlapping runs, crash between them → two terminals (I3);
  - crash inside an enforcement artifact → atomic both-or-neither
    (I4);
  - the three predicate stages, each relative to its target,
    superseded by a later frontier without retro-invalidation
    (I5, Section 4);
  - removed member's read and write against a stale view → both
    fail-closed (I7);
  - late-attaching consumer samples every promised condition
    (I8);
  - durable-report crash-safety (I9);
  - replicated reader-state attempt → rejected structurally
    (I10);
  - crash-and-restart send-set recomputation (I11);
  - gap repair: evidence-carrying request, each outcome of the
    closed set exercised, unreachable source retryable (I12);
  - page-granular commit satisfying I9 (I13);
  - delivery-effect ingress through admission; direct-write
    attempt caught; snapshot ingest refused (I14, 7.2);
  - rebind matrix: `(stable-id, source proof, advertised
    frontier, acknowledged entry)` × all four outcomes (I15);
  - sibling transitions → `forked` on both, no forwarding of
    descendants, service divergence handling via I7 (I16);
  - blind service admission: authorized poison stored at the
    service, `invalid` at every replica (7.3, 7.1).

## 14. Open Issues

- **RO-1 — Fork reconciliation.** Exit from the forked state is
  Access OI-1 terrain; until it resolves, conformant enforcement
  operation is single-partition per group (Access §3.6, §9.6) and
  I16 is forked-only. Winner selection may only arrive as a
  coordinated Access re-cast.
- **RO-2 — Snapshot profiles.** The registry ships empty. The
  registration bar is P1's equal-verdict rule over snapshot
  input; a candidate profile must state what a verifier recomputes
  versus what it trusts, and why the difference cannot change any
  verdict.
- **RO-3 — Target attestation wire form.** Adapter-registered in
  this casting; once two independent adapters exist, a common
  normative encoding becomes a candidate for a later casting.
- **RO-4 — Service resource constants.** Page bounds, storage
  quotas, and refusal thresholds are adapter-registered; whether
  any deserve registry-published constants (the Delivery §4.4
  pattern) is deferred to adapter evidence.
- **RO-5 — Key-regime neutrality.** The personal group's declared
  key regime (root-derived epochal / independent-keys) is Access
  and Identity terrain. This contract's only stake is stated in
  I6, I15, and 3.3: nothing at or below the port line assumes
  derivability of any key, and the stable group identity is never
  derived from key material — both regimes replicate identically.

## Appendix A (informative): mapping to the current implementation

| This contract | Today (Gen 2: Sync 001–003, wot-core) |
|---|---|
| I1/I15 catch-up + rebind | vault pull, seq-log recovery, migration re-anchor-on-connect fix |
| I5 three-stage predicate | `loaded`/`complete` heuristics (~200 lines, rls#274) — replaced by target-relative stages |
| Section 8 reader states | `classifyLogEntryKeyDisposition` — relocated above the line as `blocked-by-key` + dark states |
| I2 + closure admission | `evaluateKeyRotationDisposition` (`future-buffer`/`apply`/`ignore-stale-or-duplicate`) — evaporates: causality + idempotency + gap handling |
| I7 presented views | `present-capability` control frame under the shared `spaceCapabilitySigningKey` — replaced by Access §7.3 views; the capability-seed bug family ends structurally |
| I14 all-ingress admission | relay type whitelist (VE-R2) + `devices`-table join in `isFullyDelivered` — both costs of the missing cut; carrier becomes type-blind again |
| I11 log as send-truth | outbox resend loop class |
| I9 transaction-bound gates | acked-but-not-durable loss class |
| I16 forked | no counterpart (single relay total order) — `linear/0.1` is that honesty as an adapter |

## Appendix B (informative): field provenance of the promises

| # | Provenance |
|---|---|
| I1 | multi-device silent loss family (wot#232); decision seam 4 |
| I2 | two-channel rotation race (Sync 001/003 key-rotation inbox type); Access P2/§7.1 |
| I3 | unpaired sync-run reporting (wot#346) |
| I4 | Access P2/§5.3 commit-before-forward; decision seam 1 |
| I5 | false `complete: true` (rls#274); first-sync signal harvest (wot#343/#344) |
| I6 | key-export prohibition lesson (wot#306); decision seam 3 |
| I7 | stale-authorization TOCTOU (wot#289); capability-seed family (wot#234) |
| I8 | state-vs-edge gate lesson (wot#288, gate 3) |
| I9 | durability gate losses (wot#328, wot#193) |
| I10 | local/replicated coupling (wot#285); devices-table terminality |
| I11 | outbox loop (wot#236, wot#245, wot#249) |
| I12 | gap-repair gate (wot#288, gate 2) |
| I13 | cold-start scale measurement (wot#353: 8 990 `importKey`) |
| I14 | review 1 B-6 + whitelist genealogy (Sync 003 §Relay-Whitelist) |
| I15 | acked-log orphan after migration (register §C); review 1 M-5 |
| I16 | review 1 B-5 / review 2 B-4; Access §3.6; MLS comparison |

## References

[RFC2119] · [RFC8174] BCP 14 · RLTP Access Layer 0.30, wire 0.24
(§§3.2, 3.3, 3.4, 3.6, 5.2, 5.3, 7.1–7.3, 9, 10) · RLTP Identity
Layer 0.12 (§7) · RLTP Delivery Contract 0.21 (§§4.4, 6) · RLTP
Membership Tasks 0.16 · RLTP Encounter Layer 0.28, wire 0.25 ·
Decision record: `design/portvertrags-paar-entscheide-2026-08.md`
(Revision 2) with reviews 1–2 · Sync 001/003 (superseded transport
specs, Appendix A) · MLS: RFC 9420, RFC 9750 (comparison basis for
I16) · Candidate substrate documentation per Section 10.
