# RLTP Replication Contract

**Real Life Trust Protocol — service contract: Replication**

- **Status:** Editor's Draft
- **Version:** 0.2.0-draft (second casting)
- **Editors:** Anton Tranelis
- **Date:** 2026-08-26
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Conformance profile:** `rltp-replication@0.2` (draft)
- **Companion pins:** Access Layer 0.30 (wire 0.24) · Identity Layer
  0.12 · Delivery Contract 0.21 · Membership Tasks 0.16 · Encounter
  Layer 0.28 (wire 0.25)
- **Supersedes:** 0.1 (archived,
  `spec/archive/replication-contract-0.1-erstguss.md`)
- **Position:** not a layer. Replication is the service behind the
  port the Access Layer requires (Access §10); every layer may use
  it, none depends on its internals.

## Abstract

This document specifies how replicated group state travels between
the replicas of its members. The replication service converges
**individually signed, causally linked entries** — gaplessly
relative to an attested and equivocation-protected target,
idempotently, never silently diverging — and promises **convergence
over entries, never readability of content**. It is key-blind by
construction: no secret material crosses its port, no plaintext is
required for any promise it makes, and the substrate that moves the
bytes stands outside the trusted computing base.

Two entry profiles travel through the port (Section 3.4): the
**authority entries** of the Access Layer's operation envelope, and
**content entries** under this contract's signed public header — the
artifact-shaped authentication the previous generation's
channel-gated model lacked. The contract is sixteen promises
(I1–I16, Section 5), each stated with its preconditions, its
outcomes from one shared algebra (4.3), and a counter-vector.
Around them it fixes the port line (Section 3), the attested
convergence target with its per-source consistency chain
(Section 4), service authorization by presented authorization views
(Section 6), the single ingest admission every entry passes
regardless of how it arrived — with admission verdicts separated
from merge-revisable canonicality dispositions (Section 7) — and
the reader-state vocabulary that keeps "converged" and "readable"
from ever being conflated above the line (Section 8).

## Status of This Document

This is an **Editor's Draft** with no standing beyond its own
argument. Its requirements are the decision record of the
port-contract pair (`design/portvertrags-paar-entscheide-2026-08.md`,
Revision 2), distilled from roughly 120 field issues of the deployed
previous-generation implementation; the sixteen promises carry their
field provenance in Appendix B.

This **second casting** answers the first adversarial review round
in full (`design/replication-review1-2026-08.md`, 7 blockers /
8 major / 2 minor — triaged, all accepted). Its deepest cuts:
authority-entry identity and the proof accumulator are separated,
so deduplication can never suppress the proof merge Access §3.3
mandates (B-1); content entries get a complete signed header
profile whose fields are all identity-bound (B-2, editor's
decision); the removed-member claim of the first casting is
replaced by an **honestly named residual** grounded in a
determinism theorem (B-3, editor's decision); the convergence
target gains a canonical signature input, a per-source consistency
chain, and a provable-equivocation outcome (B-4); services and
replicas get hard evidence bounds with deterministic refusal
(B-5); rebinding is grounded in optional recoverable
acknowledgement evidence and judged against closures, not
frontiers (B-6); and admission verdicts are separated from
canonicality dispositions so the forked state is exactly Access
§3.6's merge-revisable outcome rather than a retroactive
impossibility (B-7). One outcome algebra replaces the three
divergent sets of the first casting (M-3). The convergence
criterion is two consecutive review rounds without blocker-level
findings.

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
  The port replicates entries whose payloads are sealed and
  verifies structure, signatures, and causality. Whether a
  converged entry can be *read* is a statement of a higher layer,
  made against key material this contract never touches
  (Section 8).
- **Verdicts are artifact-shaped, never door-shaped.** The
  previous generation authenticated the *channel* (a capability
  gate at one relay); this contract authenticates the *artifact*
  (every entry individually signed, every admission field
  identity-bound). Where every road is legal — sync, delivery
  effect, local import, recovery — only the artifact can carry the
  verdict. The price of that determinism is stated honestly in
  Section 11.
- **Key-blind by construction.** No unsealing, no derivation of
  secret material, and private keys never cross the port (I6).
  The payoff is architectural: a relay operator, a peer-to-peer
  mesh, or a cloud store moves sealed bytes without being trusted
  with anything — the trusted computing base shrinks to the
  enforcement adapter on the members' devices (Access §9.1).
- **One admission, every road** (I14): there is no privileged side
  door, so no carrier ever needs to read types in self-defense.
- **The recovery channel is the replication channel.** A new or
  recovered replica converges from the log under I1 and rebinds
  under I15; nobody retains mail for unknown future replicas, and
  no additional recovery service exists or is needed.
- **Idempotency is content-bound, per profile.** A content entry's
  identity is a deterministic function of its signed header; an
  authority entry's identity is its operation id, whose proof
  accumulator merges instead of deduplicating (3.4.1). In both
  profiles, `duplicate` can never mask divergent content.

### 1.2 The two sides of the line

Two conformance classes implement this contract (Section 13):

- A **replica** is the entry store on a member's device, below the
  enforcement adapter (Access §9). It runs the full ingest
  admission (P1 + the epoch gate + P2), applies entries causally,
  and forwards only what it has canonically and durably committed.
- A **service** is a durable, key-blind party — a relay, a broker,
  a storage host — registered by the group under Access §7.3 and
  thereby holding the `relay` role: it stores and forwards the
  group's entries. It authorizes read and write **only** against
  presented authorization views, judges storage, never validity,
  and never needs to.

Adapters — the bindings of concrete substrates and transports to
this port — are below the line and appear only through their
registration (Section 9).

### 1.3 Honest thinness: the doors that are fixed

"Thin" does not mean mechanism-free. This contract deliberately
fixes five doors, and names them rather than pretending openness:

1. entries are **individually signed and causally linked**
   (Access §9.1 for authority entries; 3.4.2 for content entries);
2. enforcement operations and their epoch transitions are **atomic
   commits** with replica eviction (I4, Access §9.3);
3. authorization toward services is **view-shaped** (I7, Access
   §7.3) — chained, quorum-signed, epoch-monotone;
4. concurrency of enforcement is **fail-closed** (I16, Access
   §3.6) — no winner-picking anywhere;
5. every completeness claim rides the **target-control overlay**
   of Section 4 — an adapter may reuse any data-plane sync
   (have/need, Bloom filters, gossip), but it carries the attested
   target protocol in addition; an exchange without it is legal
   and yields pages, never convergence (4.4).

Everything below those doors is open: transport, topology, storage,
encoding, batching, CRDT or log, push or pull. Section 10 maps the
candidate substrates against exactly this line and says honestly
which door each one currently fails.

## 2. Conventions and Terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" are to be interpreted as described in BCP 14 [RFC2119]
[RFC8174] when, and only when, they appear in all capitals.

The **interim securing profile** of Encounter 2.3 applies where
this contract signs or hashes (Ed25519 `eddsa-jcs-2022`-style raw
signatures over JCS, SHA-256 multihash, multibase `u` emission,
RFC3339-UTC-`Z` timestamps).

**Group identity** is the genesis digest of Access §3.2; it is the
only group name this contract uses, and it is never derived from
key material (I15).

**Entry** — the unit of replication, in one of two profiles
(3.4): an **authority entry** (the operation envelope of Access
§3.3) or a **content entry** (this contract's signed header plus
sealed payload). **Entry id** — the profile's identity: the
operation id for authority entries; the header digest for content
entries (3.4.2). **Parents** — the entry ids an entry causally
depends on. **Closure** — an entry together with every ancestor
reachable through parent references; `closure(F)` for a frontier F
is the union over its heads. **Frontier** — a set of entry ids no
other held entry of the same scope has as a parent; three scopes
exist (4.2): `stored`, `admitted`, `canonical`. **Session** — one
authenticated exchange between a replica and a source (Section 6).
**Source** — the counterparty a replica converges from: a service
or another replica. **Page** — a source-delimited batch of entries
within a session. **Run** — one identified attempt at a declared
goal (a catch-up, a repair, a rebind), with exactly one terminal
outcome from the algebra of 4.3 (I3). **Convergence target** — the
attested artifact of 4.1. **Admission verdict** — the immutable
per-entry result of Section 7. **Canonicality disposition** — the
merge-revisable per-entry disposition `canonical | forked` (7.1
step 5, I16). **Ack receipt** — the optional recoverable
acknowledgement evidence of I15. **Reader state** — the
above-the-line readability vocabulary of Section 8.

| Term | Fragment |
|---|---|
| Entry | `#Entry` |
| Content header | `#ContentHeader` |
| Frontier | `#Frontier` |
| Convergence target | `#ConvergenceTarget` |
| Outcome algebra | `#OutcomeAlgebra` |
| Ingest admission | `#IngestAdmission` |
| Admission verdict | `#AdmissionVerdict` |
| Canonicality disposition | `#CanonicalityDisposition` |
| Run | `#Run` |
| Ack receipt | `#AckReceipt` |
| Reader state | `#ReaderState` |

## 3. The Port Line

### 3.1 What the port knows

The port metadata of an entry is **closed**, and it is exactly the
data its profile signs (3.4): group identity, entry id, parent
ids, profile (`authority` | `content`), the content header's
`epoch` and `writer` where the profile is `content`, size, and the
session it arrived in. A conformant implementation MUST NOT
require any further metadata for any promise of this contract, and
an adapter registration MUST NOT extend this set with fields whose
values require plaintext to produce. Every metadata field except
size and session is identity-bound: it is covered by the entry's
signature and its id (3.4), so the same bytes can never be
presented with different metadata.

### 3.2 What the port never knows

The port knows no persons, no devices, no document types, no group
membership of its own reading, no keys, and no payload plaintext.
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
- A service stores and forwards entries; nothing in this contract
  requires it to distinguish entry payloads beyond the closed
  metadata of 3.1. In particular, **no carrier reads payload
  types**: type dispatch is the receiving replica's admission
  (Section 7) and the Delivery Contract's receiver pipeline
  (Delivery §6.2), never transport self-defense.

### 3.3 Where the keys live instead

Key handling stays where the Access Layer put it: in the
enforcement adapter as named trusted computing base (Access §9.1,
P4) and in the pull path `key-delivery/0.1` (Access §10.1). Epoch
transitions commit their key material **by digest** (Access §7.1);
the sealed envelopes travel as delivery documents and are
separately repairable under the key service duty (Access §5.3).
Delivery transports no authority disposition — but it does
transport that disposition's digest-bound, separately repairable
key material. The replication port sees neither: it replicates the
transition entry like any other entry.

### 3.4 The two entry profiles

#### 3.4.1 Authority entries

An authority entry is the operation envelope of Access §3.3,
transported with its **signature input unmodified** (Access §9.1).
Its port metadata derives from the envelope: the group identity,
the operation's causal references as parents, profile `authority`.

**Identity and the proof accumulator, separated.** The entry id is
the **operation id** of Access §3.3 — computed over the envelope's
proof-less signature input. The `proof` field is the deliberate
exception to immutability (Access §9.1): it is a **mutable
evidence accumulator**, and replicas MUST maintain it per Access
§3.3's canonical merge. Therefore, normatively:

- On **every** arrival of an authority entry — first or repeat —
  the arriving proof evidence is merged into the held accumulator
  **before** any verdict is read or recomputed. Deduplication by
  operation id suppresses re-application of *effect*, never the
  proof merge.
- An operation whose held proof evidence does not yet satisfy its
  rule is **not** terminally invalid: it is held as incomplete
  evidence (verdict `missing-closure`, 7.1 — the same held,
  healable class as an absent parent), and its verdict is
  recomputed on every proof merge. Two individually insufficient
  proof variants MUST become valid when their union satisfies the
  rule.
- Terminal `invalid` is reserved for defects no additional
  evidence can heal: malformed envelope, failing signature bytes,
  a rule violation of the operation's ancestry (Access §§3.4,
  5.3).

#### 3.4.2 Content entries

A content entry is a **public signed header** plus a **sealed
payload**:

```
header = {
  "v":             "rltp-replication-content/0.2",
  "group":         <genesis digest, canonical u form (Access §3.2)>,
  "parents":       [ <entry id>, … ],
  "epoch":         <integer>,
  "writer":        <the writer's member identity for this group
                    (Access §5.1/5.2 — the per-group context)>,
  "payloadDigest": <multibase multihash over the sealed payload
                    bytes>,
  "sig":           <signature under writer over the JCS
                    serialization of the header with sig omitted>
}
```

- **Identity:** the entry id is the multibase multihash over the
  UTF-8 bytes of `JCS(header)` — the full header, `sig` included.
  Via `payloadDigest` the id is transitively content-bound to the
  payload; via the header it binds group, parents, epoch, and
  writer, so no metadata equivocation is representable (3.1).
- **Writer:** the per-group member identity that already exists in
  the stack (Access §5.1/5.2) — this profile introduces **no new
  identity class**. The signature MUST verify under it.
- **Epoch binding:** `epoch` MUST equal the epoch materialized at
  the entry's causal position — the newest transition in the
  entry's ancestry closure. A mismatch is `invalid`.
- **Writer membership:** the writer MUST be a member of the state
  materialized from the entry's ancestry closure (pending exits
  included until their discharging transition, Access §5.4). A
  non-member writer at position is `invalid`.
- **Payload:** opaque sealed bytes; the port never interprets
  them. The sealing construction (which key of the entry's epoch,
  its AAD binding) is Layer-4/Access coordination terrain and is
  named as such (RO-7); whatever the construction, the port's
  duties bind only header and digest.
- **Size:** header and payload are bounded by the registered size
  bound (Section 9); an oversize entry is refused at shape
  (7.1 step 1).

This profile is the coordinated-debt boundary of this casting: it
is the **port transport form** of content, deliberately
semantics-free. What a payload means, and how Layer 4 composes
documents from entries, is outside; the profile is shaped so that
neither question can ever require a port change (RO-7).

## 4. Targets, Frontiers, and Outcomes

### 4.1 The attested convergence target

Every completeness statement of this contract is relative to an
**attested convergence target** — never to silence, never to local
shape, never to "the log" as an unbounded whole.

```
target = {
  "v":             "rltp-replication-target/0.2",
  "genesisDigest": <group identity>,
  "source":        <canonical source identity (Section 6)>,
  "session":       <session identifier>,
  "seq":           <integer ≥ 1: this source's attestation
                    sequence for this group, strictly increasing>,
  "frontier":      { "scope": "stored" | "admitted" | "canonical",
                     "heads": [ <entry id>, … , sorted by unsigned
                                bytewise order ] },
  "prev":          <digest of this source's previous target for
                    this group (its signature input), or null
                    iff seq = 1>,
  "sig":           <signature over the JCS serialization with sig
                    omitted, under the source's attestation key>
}
```

- **Attestation rule.** The signature input is canonical as given;
  the attestation key MUST be cryptographically bound to the
  source identity of Section 6 and MUST be stable across that
  source's sessions for the group, so cross-session equivocation
  is provable. The wire encoding of transport is adapter-named
  (Section 9); the fields, the signature input, and the binding
  are normative regardless of encoding.
- **Scope honesty.** A key-blind service attests `stored` — it
  cannot judge admission and MUST NOT claim it. A replica source
  attests `admitted` or `canonical`. A consumer judges `reached`
  against what the scope can promise: a `stored` frontier may
  contain entries that fail admission — that outcome is
  `target-unadmissible`, not equivocation (4.3).
- **The consistency chain.** `seq` increases by exactly 1 per
  attestation of a `(source, group)`; `prev` chains to the
  predecessor. A source MUST only attest extensions:
  `closure(heads_{seq}) ⊇ closure(heads_{seq−1})` on its own held
  state of the attested scope. This duty makes split-views
  **evidence**, not weather: two signed targets of one
  `(source, group)` with the same `seq` and different content, a
  broken `prev` chain, or a demonstrable closure regression are
  **provable equivocation** — the artifacts themselves are the
  transportable proof (the Certificate-Transparency argument:
  signatures alone prevent nothing; chains plus comparison do).
  Replicas MAY exchange held targets of a shared source at any
  time; comparison is by digest, no trust required.
- **Supersession rule.** A later target of the same
  `(source, group)` chain supersedes an earlier one; it never
  retroactively invalidates a verdict reached against the earlier
  one. `reached(F)` remains true for `F` forever; the world has
  merely moved on.
- **No-vacuum rule.** Absence of a target licenses no completeness
  claim of any strength (4.4).

### 4.2 Three frontiers

Because admission and canonicality are judgments a blind party
cannot make, frontier scopes are distinguished and never
interchangeable:

- `stored` — heads over everything held, verdicts unknown (the
  only scope a service can compute);
- `admitted` — heads over entries with verdict `accepted`;
- `canonical` — heads over entries `accepted` **and** disposed
  `canonical` (7.1; excludes forked branches).

Every promise of Section 5 names the scope it binds; an
attestation names its scope (4.1); an implementation MUST NOT
substitute one scope for another.

### 4.3 The outcome algebra

One algebra serves every goal (catch-up I1, repair I12, rebind
I15); each goal names the subset it can produce. **Terminal
outcomes** (exactly one per run, I3):

- `reached(F)` — the target frontier's closure is admitted
  locally;
- `repaired(set)` — the named missing entries arrived and were
  admitted;
- `missing(set)` — the run ended with the named entry ids still
  absent;
- `source-ended-before(goal)` — the source ended the session
  before serving the goal;
- `target-unadmissible(set)` — the closure was delivered, but the
  named entries fail admission (possible against `stored`-scope
  targets; attributable to the entries' writers, not to the
  source);
- `denied` — authorization refused (I7);
- `source-equivocation(evidence)` — the source provably
  equivocated (4.1); fail-closed toward this source, evidence
  retained and transportable;
- `aborted(reason)` — locally ended; `reason` from the adapter's
  registered closed reason set (transport failure included).

**Retryable states** (samplable per I8, never terminal, never
silent): `awaiting-source` (source unreachable; retry
scheduled or offered) · `awaiting-evidence` (held incomplete
evidence: absent parents or insufficient proof accumulation,
7.1). Rebind (I15) additionally names its four run outcomes,
drawn from this algebra: `rebound-and-reached` (= `reached`
through rediscovered sources) · `source-auth-failed` ·
`entry-not-in-closure` · `conflicting-sources`.

### 4.4 The unattested exchange profile

An exchange without attested targets — plain gossip, opportunistic
peer sync, a data-plane protocol run on its own — is **legal**. It
yields pages and admitted entries; it MUST NOT produce `reached`,
any completeness claim, or any run outcome other than `aborted`.
This is the honest home of classical local-first sync engines
below the target-control overlay (1.3, door 5).

## 5. The Sixteen Promises

Each promise is stated with the discipline this contract demands
of itself: the normative statement, the conformance class it
binds, its preconditions, its outcomes (from 4.3 where the promise
is a goal), and at least one **counter-vector**. Field provenance
is collected in Appendix B.

### 5.1 I1 — Catch-up

**Promise.** A replica that appears late — a new device, a
recovery, a long-offline peer — converges against an attested
convergence target from the log itself. No party retains delivered
mail for unknown future replicas, and no catch-up promise rests on
retained delivery documents.

**Class.** Replica (as consumer); source duty on service and
replica (as source: serve the closure of what you attested, to
authorized requesters, per I7).

**Preconditions.** An authenticated session (Section 6); an
attested target (4.1).

**Outcomes.** `reached(F)` · `missing(set)` ·
`source-ended-before(F)` · `target-unadmissible(set)` · `denied` ·
`source-equivocation(evidence)` · `aborted(reason)`.

**Counter-vector.** Source S serves a closed page up to head H and
ends the session; no attested target was presented. A conformant
replica reports a delivered page and **no** catch-up outcome
(4.4); an implementation that reports `reached` on this trace is
nonconformant. "From the log" is not a completeness bound; the
target is.

### 5.2 I2 — Causal application

**Promise.** No epoch-N content is ever applied, forwarded, or
exposed to a reader before the epoch-N transition is canonically
applied. In the DAG model this is causality, not a special rule:
an entry of epoch N causally descends from the epoch-N transition
(3.4.2's epoch binding), admission requires the closure (I14), and
application follows causal order under the deterministic ready-set
evaluation of 7.2.

**Class.** Replica.

**Preconditions.** Admission per Section 7.

**Outcomes.** An entry is either applied at a position where its
full closure is applied, or held `missing-closure` — never applied
ahead of its causal past.

**Counter-vector.** A page contains `[E, T]` in wire order, where
content entry E depends on transition T. Conformant admission
evaluates the page as one ready-set (7.2) and admits T then E;
equally conformant is holding E `missing-closure` only if T is
genuinely absent. Nonconformant: applying or surfacing E before T
on any evaluation order, or a side buffer that releases E without
re-entering admission.

### 5.3 I3 — Run/outcome pairing

**Promise.** Every run reaches **exactly one** terminal outcome
from 4.3 — under overlap, under error, under crash-and-restart.
Normative trigger: **every catch-up, repair, or rebind performed
through the port creates a run record** — there is no unreported
mode of these goals. A run record carries a fresh run id, the
goal, its target (where one exists), its current state, and its
terminal outcome; overlapping runs terminate independently; a
crashed run is terminated (`aborted(crash)`) by its successor's
recovery, never silently absorbed. Run records are retained at
least until superseded by a later run of the same
`(goal, group, source)` **and** at least the adapter's declared
minimum retention.

**Class.** Both.

**Preconditions.** None — the trigger is the operation itself.

**Outcomes.** The algebra of 4.3.

**Counter-vector.** Two catch-up runs against different sources
overlap; the first completes `reached(F₁)`, the second crashes.
After restart, a conformant implementation's run records show both
terminals (`reached(F₁)`, `aborted(crash)`); an implementation
showing one combined outcome, a run with no record, or a started
run with no outcome after restart is nonconformant.

### 5.4 I4 — Commit-before-forward and replica eviction

**Promise.** This contract promises what Access P2 requires of it
(Access §9.3), as three separable assertions — and it names the
division of labor: the **store** carries artifact atomicity; the
**enforcement adapter** (the TCB above this port) carries the key
world; P2's atomicity claim binds their composition:

1. **Commit:** an enforcement operation and its epoch transition
   are one committable artifact in the replica's store — no
   observable store state in which the authority claim holds
   without the transition or the reverse. (That the *committed*
   key world transitions with it is the enforcement adapter's P2
   duty; this contract's store never holds key material to
   transition.)
2. **Forward gate:** a replica forwards an entry only after its
   own durable (I9), canonical (7.1) application of that entry —
   commit-before-forward.
3. **Eviction:** replica-side, the forwarding gate stops serving
   descendants of a removal to the removed member's replicas once
   the removal is committed; service-side, eviction is enacted by
   the next presented view (I7) — the removed member's derived
   identity is absent, and the service fails closed toward it.

**Class.** Replica (1, 2); replica and service (3).

**Preconditions.** Admission of the enforcement artifact (I14).

**Outcomes.** For any crash point: after restart, either the whole
enforcement artifact is durably applied or none of it is; no
counterparty ever received an entry its sender had not durably and
canonically committed.

**Counter-vector.** A replica applies a removal, crashes before
the transition's commit completes, restarts, and serves
pre-removal descendants to the removed member's replica.
Conformant behavior: the artifact is atomic, so after restart
either both halves hold (and the gate blocks) or neither does (and
nothing claims the removal happened). An implementation observable
in the half-state is nonconformant.

### 5.5 I5 — The convergence predicate, three-staged and never about readability

**Promise.** Convergence is a three-stage predicate over entries,
always relative to an attested target (4.1) and always naming its
frontier scope (4.2):

1. **locally read** — the entry is admitted into the local store;
2. **page delivered** — a source-delimited page arrived complete;
3. **gaplessly converged** — `reached(F)`: the target frontier's
   closure is admitted, no gaps.

Readability is **never** a stage of this predicate and MUST NOT be
inferred from any stage of it (Section 8). Later targets supersede
without retro-invalidation (4.1).

**Class.** Replica.

**Preconditions.** Stages 2–3 require the session's page
delimiters, respectively the attested target.

**Outcomes.** The three stages as samplable state (I8), each
relative to its `(source, session, frontier)`.

**Counter-vector.** A replica holds a contiguous chain to head H,
sees network silence, and reports "fully synchronized" without an
attested target — nonconformant (the field's false
`complete: true`). Equally nonconformant: any surface deriving
"readable" from stage 3, and any implementation treating a
`stored`-scope attestation as a `canonical` one (4.2).

### 5.6 I6 — Key-blindness

**Promise.** The port performs no unsealing and no derivation of
**secret** material; private keys never cross the port in either
direction; no promise of this contract requires payload plaintext.
Public material is untouched by this rule: verifying signatures,
computing entry ids, comparing commitments and digests are port
duties.

**Class.** Both, and every adapter.

**Preconditions.** None — this is an unconditional prohibition.

**Outcomes.** This promise is an **audit criterion** of the
conformance class (Section 13), in the same class as Access
§9.1's adapter obligations — it is deliberately **excluded** from
I8's samplable set. Its checkable core: no API of a conformant
port implementation accepts or returns private key material, and
no port metadata field (3.1) requires plaintext to produce.

**Counter-vector.** An adapter that "optimizes" catch-up by
unsealing entries to deduplicate semantically, or a port API whose
sync request carries a content key so the service can filter —
both nonconformant by construction, whatever their runtime
behavior; the vector class is an audit finding, not a trace.

### 5.7 I7 — Authorization only against the presented view

**Promise.** A service authorizes **read and write of entries**
exclusively against the presented authorization view, under the
**complete** duty set of Access §7.3, incorporated by reference:
registration with exact-byte service identity, seq/prevView chain
verification, quorum-intersection signature checking, epoch
monotonicity, the freshness window on both ends, challenge-based
proof of possession under derived identities, and the divergence
obligations (never a winner-picker; the evidence contract; the
anchor ratchet). An expired or inconsistent view is **fail-closed
for entry reads AND entry writes** — while the **control plane
stays open exactly as Access §7.3 obligation 5 commands**: valid
view presentations — ordinary, divergent, and reconciliation —
MUST go on being admitted into the service's view DAG even while
the service is fail-closed for entries, or divergence could never
heal. Between replicas, authorization derives from each replica's
own materialized membership at its current head (P1) — with the
same fail-closed rule under the forked state (Access §3.6).

**Class.** Service (view path); replica (peer path).

**Preconditions.** Registration (Access §7.3) for the service
path; an authenticated member identity for the peer path.

**Outcomes.** Per request: `authorized` · `denied(no-standing)` ·
`fail-closed(stale-view)` · `fail-closed(divergence)` ·
`fail-closed(forked)` — a closed set; `denied`/`fail-closed`
answers carry no information beyond the verdict.

**Counter-vector.** A member is removed in epoch N+1; the
service's newest accepted view is the epoch-N view, now past
`validUntil`. The removed member requests a full catch-up read: an
implementation that serves it because "reads are harmless" is
nonconformant. The mirror vector: while fail-closed, a quorum
presents a valid reconciliation view — an implementation that
refuses it "because fail-closed" is equally nonconformant
(obligation 5).

### 5.8 I8 — State, not edge

**Promise.** The promised conditions of this contract are exposed
as **idempotently samplable state**, and the set is enumerated:
per-target convergence stages (I5), per-entry admission verdicts
(I14), per-entry canonicality dispositions (I16), run records with
their states and outcomes (I3), the retryable states of 4.3,
durability states (I9), the forked condition (I16), and — where a
consumer surfaces readability — the reader states of Section 8.
(I6 is excluded by design: it is an audit criterion, 5.6.) Each is
monotone **in held evidence**: re-sampling without new evidence
never changes the answer, and the answer is a function of held
state, never of having observed a transition. Events MAY exist in
addition; no promise is discharged by an event alone. A consumer
that missed every event can still read the truth, including after
restart.

**Class.** Both.

**Preconditions.** None.

**Outcomes.** The named query surface itself.

**Counter-vector.** An implementation signals `reached(F)` once on
a callback; a consumer attaching later (or after restart) finds no
sampling surface that returns it and re-triggers a full catch-up
or reports non-convergence. Any design in which sampling and event
disagree, or in which the truth is only in the event, is
nonconformant.

### 5.9 I9 — Transaction-bound durability

**Promise.** Three states are distinguished and never conflated:
**written** (applied inside an open local transaction), **durable**
(that transaction committed to the durable store the adapter
registration names), **offered** (made available beyond the local
replica). Every durability gate binds to the **concrete
transaction** of the state it gates — never to a global flush
flag, a timer, or an unrelated commit. Allowed transitions:
written → durable → offered; a crash rolls back to the last
durable state, and nothing ever reported `durable` is lost by a
crash after the report.

**Class.** Both.

**Preconditions.** The adapter registration names the durable
store and its crash model.

**Outcomes.** The three states per entry or per page (I13),
samplable (I8).

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
2. convergence verdicts, targets, and run records (they are
   session- and source-relative);
3. transport and delivery status, retry and scheduling state;
4. local store namespaces, device-scoped identifiers, and any
   identifier whose scope is one installation;
5. admission verdicts and canonicality dispositions — a verdict
   travels as recomputation under P1 (every replica re-judges
   identically), never as data;
6. the local clock, and any arrival-time observation. (A replica
   MAY hold and surface arrival-time knowledge locally — "arrived
   after the removal was known here" — Section 11; it never
   replicates it and never lets it touch a verdict.)

**Class.** Replica.

**Preconditions.** None.

**Outcomes.** Structural: no replicated entry admitted under this
contract carries state of the classes above.

**Counter-vector.** A replica replicates "device X has read up to
seq N" into group state to drive another device's UI; a second
implementation, correctly, does not — and the two now disagree
about the group's replicated content on identical input.
Nonconformant on the first side; the class of the field's
device-table coupling.

### 5.11 I11 — Retry authority lives in the durable log

**Promise.** For replication traffic, the durable log **is** the
send-truth. The send set toward a counterparty is a defined DAG
operation: `closure(canonical frontier_local) ∖
closure(F_counterparty)`, where `F_counterparty` is the newest
attested target (4.1) held from that counterparty — minus entries
disposed `forked` (I16). It is recomputed from the durable store
at any time — never maintained as a generic outbox of queued
send-intents. There is no replication outbox to drain, and after
any crash the send set is recomputed, not replayed.

**Class.** Replica (sender side).

**Preconditions.** I9 durability; a held counterparty target
(absent one, the send set is the full canonical closure, and the
counterparty converges by dedup).

**Outcomes.** After crash-and-restart with a counterparty at
attested frontier F: the send set equals the defined difference —
nothing doubled beyond idempotency, nothing dropped, no orphaned
queue intent.

**Counter-vector.** An implementation enqueues "send entry E to S"
as its authority; the queue survives a store rollback (or is lost
while the store kept E) and the two truths diverge — an endless
resend loop, or a silent drop. Nonconformant; the field's outbox
loop class.

### 5.12 I12 — Gap repair, addressed and terminating

**Promise.** On detecting a missing dependency — a parent id
referenced by a held entry that no held entry bears — the replica
issues a **repair request**: addressed to an authenticated source
(Section 6), carrying evidence (the referencing entry ids, so the
request is checkable and distinguishable from a fishing read), and
**terminating**: each repair run ends, within the adapter's
declared `repair-horizon`, in exactly one outcome from 4.3. Repair
is re-runnable; an unreachable source yields the retryable state
`awaiting-source` (samplable, never silent). A source MUST answer
a checkable repair request for entries it holds and the requester
is authorized to read (I7).

**Class.** Replica (requester); source duty on both (responder).

**Preconditions.** A named missing set; an authenticated source.

**Outcomes.** `repaired(set)` · `missing(set)` ·
`source-ended-before(set)` · `target-unadmissible(set)` · `denied`
· `source-equivocation(evidence)` · `aborted(reason)`; plus the
retryable `awaiting-source` between runs.

**Counter-vector.** A replica detects a gap and waits, unbounded
and unreported, for the substrate to gossip the entry by chance;
no run record, no outcome, no samplable state — nonconformant.
Equally nonconformant: a repair request naming no evidence, and a
repair run still unterminated past `repair-horizon`.

### 5.13 I13 — The scale ceiling

**Promise.** The port's required cost is bounded per **page**,
not per entry: a conformant port interface MUST NOT require more
than one durable transaction per page (I9 at page granularity),
nor more than one request/response exchange per page beyond the
transport's own framing, nor any per-entry round trip. Frontier
comparison is per session. Per-entry duties (id computation,
signature verification, dedup, verdicts) remain per entry but MAY
be executed in batch. An implementation MAY be internally stricter
(per-entry commits are conformant); the ceiling binds what the
**contract and its interfaces demand**, so the contract stays
implementable at field scale.

**Class.** Both.

**Preconditions.** Page semantics per the adapter registration.

**Outcomes.** The durability states of I9 at page granularity;
per-entry verdicts (I14) regardless of batching.

**Counter-vector.** An adapter registration whose port interface
admits entries only through a one-entry-per-durable-transaction
call, or whose catch-up protocol forces one request per entry —
nonconformant: the *interface* demands super-ceiling cost. (An
implementation that internally fsyncs per entry while its
interfaces accept pages is conformant. The field's
8 990-key-import cold start is the neighboring lesson **above**
the line: key import is reader-side work outside this port per I6
— noted so no one relocates that cost into the port to "fix" it.)

### 5.14 I14 — All-ingress admission

**Promise.** Every ingress into replicated state — network sync, a
delivery-document effect, a local import, a snapshot, a recovery —
passes the **same** ingest admission (Section 7) before any effect
or forwarding. There is no privileged road. Input forms per
ingress are closed (7.3): full entries with closure available, or
a registered verifiable snapshot profile (**none is registered in
this casting** — snapshot ingest is inadmissible today). The
**admission verdict** set is closed and immutable per entry:
`accepted | duplicate | missing-closure | invalid` — `invalid`
terminal, `missing-closure` provisional and healable (absent
parents or insufficient proof evidence, 3.4.1), `duplicate`
idempotent (with the authority-profile proof-merge duty). Above
the verdicts sits the merge-revisable **canonicality disposition**
`canonical | forked` (7.1 step 5, I16). **Effect and forwarding
require `accepted` AND `canonical`** — nothing else triggers
either. (The five-outcome surface of the decision record is
preserved: `forked` is reported per entry exactly as decided; this
casting separates its revisability from the immutable verdicts,
because Access §3.6 makes canonicality a property of the merged
DAG.)

**Class.** Replica (full admission); service (the blind admission
of 7.4).

**Preconditions.** Per ingress type, per Section 7.

**Outcomes.** The verdicts and dispositions, per entry, samplable
(I8).

**Counter-vector.** A registered delivery task type's "defined
effect" writes an attached artifact directly into the replica's
store because the document already passed Delivery's §6.2
pipeline. Conformant behavior: the artifact enters admission like
any synced entry — where it forges its epoch (a claimed epoch its
position does not carry) it falls `invalid` at 3.4.2's epoch
binding; where it is a causally pre-removal entry of a removed
member it is **admissible by design and the residual is named**
(Section 11), never silently effected outside admission. The
direct write itself is the nonconformance — it is the reopened
generation-gate bypass this promise exists to close.

### 5.15 I15 — Rebinding after local loss

**Promise.** After loss of local replica state — store wipe,
namespace loss, device migration — a replica rebinds to durable
sources through the **stable group identity alone**: the genesis
digest (Access §3.2), never a local namespace, never a
device-scoped identifier, and never an identity derived from key
material. Rebinding separates four concerns, each with its own
failure: the stable identity (what to rebind), discovery (where —
the adapter-registered mechanism; the source set of a rebind run
is **the sources discovered and authenticated in that run**,
stated as such), source authentication (Section 6), and the
target (4.1). A local namespace MUST NOT determine the
reachability of previously acknowledged entries. Loss detection is
**evidence-bound**: the judgment `entry-not-in-closure` binds
exactly when **ack-receipt evidence** is presented — a recoverable
artifact (recovered store fragment, another device's records, a
retained receipt) naming previously acknowledged entry ids;
whether ack receipts are persisted and recoverable is
adapter-declared (Section 9, RO-6). Presented evidence E is judged
as `E ∈ closure(F)` against each authenticated source's attested
target. **Without evidence, absence is undetectable and the
contract says so**: the rebind may honestly end
`rebound-and-reached` — it MUST NOT fabricate a loss claim it
cannot ground, and equally MUST NOT report "nothing was lost", only
"everything attested was reached".

**Class.** Replica (rebinding); service (durable source presenting
an attested target on rebind).

**Preconditions.** Held or recovered group identity and member
identity; a discovery mechanism; optionally ack-receipt evidence.

**Outcomes.** `rebound-and-reached` · `source-auth-failed` ·
`entry-not-in-closure` (evidence-bound, surfaced, never silently
accepted) · `conflicting-sources` (authenticated sources present
irreconcilable targets — surfaced; resolution is union catch-up
under I1 where closures merge, the forked state where siblings
conflict per I16, or `source-equivocation` where one source signed
both).

**Counter-vector.** Replica R holds ack receipts naming entry E;
sources S₁ and S₂ both authenticate for group G; only S₂'s
attested closure contains E. An implementation that rebinds to S₁
(last known), reports `rebound-and-reached`, and never judges its
evidence against S₂ — or reports `entry-not-in-closure` while E
sits in S₂'s attested closure it never fetched — is nonconformant.
Without any evidence, the same trace conformantly ends
`rebound-and-reached`; claiming `entry-not-in-closure` from
nothing is equally nonconformant. The field's orphaned-acked-log
class.

### 5.16 I16 — Enforcement concurrency is forked, nothing else

**Promise.** Two transitions of the same predecessor epoch that
are not causally ordered put the group in the **forked state** of
Access §3.6, adopted verbatim: *no operation building on either
sibling is canonical* — a fail-closed verdict pending
reconciliation, not a selection. Canonicality is therefore
**merge-revisable by construction**: a transition individually
valid and sole-sibling today (`accepted`, disposed `canonical`) is
re-disposed `forked` the moment its sibling is admitted; admission
verdicts never change, dispositions do (I14). From the moment a
replica's held DAG shows the fork: **no further forwarding** of
either sibling or any descendant, all authorization answers
fail-closed, services holding evidence of both siblings hold their
own fail-closed state (Access §7.3 obligation 5, via I7), and the
condition is surfaced. Bytes forwarded before the fork was visible
are history — this contract does not pretend to unsend them; it
promises that every conformant receiver re-judges them identically
and stops forwarding on its own fork detection. Winner selection
does not exist in this contract and MAY only ever be introduced
together with Access OI-1 as a coordinated Access re-cast.
Eviction (I4) applies to the canonical commit — in the forked
state there is none, and no eviction is enacted on either
sibling's claim. **Liveness residual, stated:** once two
enforcement siblings exist, this contract promises no resumption
of enforcement; until Access OI-1 resolves, conformant enforcement
operation is single-partition per group — and that is a
**binding registration precondition**, not advice: an adapter
registers `concurrencyScope` (Section 9), and `single-partition`
is the only registrable value for enforcement in this version.

**Class.** Replica (application and forwarding); the service side
is Access §7.3 obligation 5, incorporated via I7.

**Preconditions.** Two admitted sibling transitions in the held
DAG.

**Outcomes.** The forked state as samplable state (I8); per
entry the disposition `forked`; exit only by reconciliation (RO-1).

**Counter-vector.** T₁ arrives alone, is `accepted` and
`canonical`; its descendant D₁ is conformantly forwarded. T₂ (the
sibling) arrives later. Conformant behavior: T₁, T₂, and D₁ are
now all disposed `forked`; no further forwarding; authorization
fail-closed; the samplable disposition of T₁ has changed while its
admission verdict has not. Nonconformant: implementation A picks
the sibling with the smaller operation id and keeps forwarding its
descendants — winner-picking; equally nonconformant:
implementation B claims conformance is impossible because D₁ "was
already forwarded" — the promise binds from detection, not
retroactively.

## 6. Sessions and Source Authentication

A session is one authenticated exchange. Its authentication is the
precondition of every completeness artifact (Section 4) and every
authorization verdict (I7):

- **Replica ↔ service:** the service authorizes the replica by
  challenge-based proof of possession of a derived identity listed
  in the current accepted view (Access §7.3); the replica
  authenticates the service against the exact-byte service
  identity of the group's registration (Access §7.3). Personal
  anchors are never presented to a service (Identity §7).
- **Replica ↔ replica:** mutual proof of possession of member
  identities; each side judges the other against its own
  materialized membership at its current head (P1), fail-closed
  under the forked state.

**The attestation key.** Every source that issues targets (4.1)
holds an attestation key; the session authentication MUST bind it:
for a replica source, it is (or is verifiably held by) the member
identity the session authenticated; for a service, the adapter
registration names the binding between the service identity string
and its attestation key, and that binding MUST be stable across
sessions and verifiable by every registered group member — a
service whose attestation key is not verifiable across sessions
cannot issue targets, only unattested pages (4.4). Session
identifiers MUST be fresh per session; targets and page delimiters
bind to the session; a source MUST NOT reuse a session's
attestations in another session (the per-source chain of 4.1
spans sessions; the artifacts do not).

## 7. Ingest Admission

### 7.1 One admission, stated once

Admission is the single evaluation between "bytes arrived" and
"entry exists in replicated state". Per entry, in order:

1. **Shape:** profile form valid (3.4); the profile's signature
   verifies (content: header signature under `writer`; authority:
   envelope signature per Access §3.3); the id recomputes under
   the profile's id rule; size within the registered bound.
   Failure: `invalid` (terminal).
2. **Dedup and proof merge:** an already-admitted id is
   `duplicate` — idempotent, no second effect; for authority
   entries the arriving proof evidence is merged into the held
   accumulator **first**, on every arrival (3.4.1), and held
   verdicts are recomputed after the merge. Only completed
   admissions count as held; previously rejected bytes are
   re-evaluated in full.
3. **Closure:** every parent admitted or admissible within the
   same evaluation (7.2); otherwise `missing-closure` — held,
   provisional, healable (repair per I12; the retryable state
   `awaiting-evidence`); never effect, never forwarding. An
   authority entry whose proof accumulator does not yet satisfy
   its rule is held in the same class (3.4.1).
4. **Validity:** for authority entries, the full P1 evaluation —
   Access §§3.4, 3.6 (outcome rules included), 5.3 — under the
   materialized state of the entry's ancestry: **validity and
   canonicality judgments both**, exactly as Access §9.2 requires
   of raw substrate ingest. For content entries: the epoch
   binding and writer-membership-at-position checks of 3.4.2.
   Irreparable failure: `invalid` (terminal). Success:
   `accepted` (immutable).
5. **Disposition:** `canonical | forked` — a **function of the
   held DAG**, recomputed on merge (I16): an accepted transition
   with an admitted non-causally-ordered sibling of the same
   predecessor epoch, and every descendant of either, is disposed
   `forked`; everything else `canonical`.
6. **Effect and forwarding:** only `accepted` ∧ `canonical`, and
   atomically where the entry is an enforcement artifact (I4).

**Precedence.** Terminal beats provisional: a trace establishing
`invalid` yields `invalid` whatever else holds. Verdicts (steps
1–4) are immutable per entry once assigned — except the healing
path `missing-closure → accepted | invalid` as evidence arrives —
and are **recomputation, never data** (I10): every conformant
replica reaches the same verdicts and dispositions for the same
held evidence, over any arrival order and any ingress road —
Access P1's raw-state clause (Access §9.2) applies to every
ingress form.

**Held-evidence bounds.** Entries held as `missing-closure` and
sibling evidence held under `forked` are bounded: the adapter
registration declares byte and count bounds per group; at a bound
the replica MUST refuse further held-class intake (retriable —
re-fetchable via repair once evidence heals), evicting nothing
that is `accepted`. Eviction within the held class is
deterministic: largest-first by held bytes, ties by unsigned
bytewise order of entry id.

### 7.2 Page evaluation

A page is evaluated as one **deterministic, causality-respecting
ready-set evaluation**: repeatedly admit every entry whose parents
are satisfied by held state or by already-admitted entries of the
same page, in topological order (ties broken by unsigned bytewise
order of entry id), until a fixpoint; the remainder is judged per
7.1 step 3. Wire order within a page carries no meaning; two
conformant implementations reach identical verdicts for any
permutation of one page (M-1). Expensive checks MAY be deferred
for entries currently disposed `forked` — but MUST complete before
any effect, should the disposition revert on reconciliation.

### 7.3 Ingress forms

| Ingress | Admissible input form |
|---|---|
| Network sync (session) | full entries with closure per page |
| Delivery-document effect | the enclosed artifact as full entries with closure — through this admission, never a direct write (I14) |
| Local import / tooling | full entries with closure |
| Recovery / rebind | full entries with closure (I15 governs the source) |
| Snapshot | a **registered verifiable snapshot profile** — the registry is empty in this casting; snapshot ingest is inadmissible (RO-2) |

A future snapshot profile MUST preserve P1's equal-verdict rule —
a replica ingesting the snapshot reaches the same validity **and
canonicality** judgments as one that replayed the operations —
that is the registration bar, and it is why the registry ships
empty rather than half-open. (The Delivery-side mirror rule — a
registered task type MUST NOT have a direct replicated effect —
is a planned Delivery §4.4 addendum, tracked in the decision
record §5.2; until Delivery carries it, the port-side rule above
is the binding one, and it suffices: nothing reaches replicated
state except through this admission.)

### 7.4 The service-side (blind) admission

A service cannot evaluate validity and never needs to. Its
admission is: writer authorized per the current view (I7); shape
and size bounds (3.1); dedup by entry id; **quota** (Section 9:
per-group and per-session-principal byte and entry quotas,
mandatory registration fields). Its verdict set:

`stored | duplicate | denied(no-standing) | refused(bounds) |
refused(quota) | evidence-saturated |
fail-closed(stale-view | divergence | forked)`

Quota refusal is deterministic (the quotas are registered
constants; headroom is a function of held state);
`evidence-saturated` is the storage analogue of Access §7.3's
saturation: at the registered bound the service refuses further
intake for the group, retriable, evicting nothing — a service
never silently drops what it attested (4.1 consistency duty). The
control plane stays open throughout (I7). A service verdict is a
storage verdict, **never** a validity claim — poison that an
authorized writer stores is caught by every replica's admission
(7.1), reflected as `target-unadmissible` against that service's
`stored`-scope targets (4.3), and standing itself is revoked by
the next view (I4 eviction). This two-sided cut is the structural
successor of the previous generation's carrier-side type whitelist
(Section 11).

## 8. Above the Line: Reader States

Whether an admitted entry is *readable* is not this contract's
promise — but the vocabulary in which the layer above answers it is
fixed here, in **observable** terms, so that "converged" can never
silently impersonate "readable" and no surface claims knowledge it
cannot have:

- `readable` — key material at hand; content opens.
- `blocked-by-key(repair-pending)` — material not at hand, and a
  live claim exists: the normative entitlement of the key service
  duty (Access §5.3) or an open `key-delivery` exchange (Access
  §10.1 — whose requests, note, never pend server-side: the state
  is the *claimant's*, between its own attempts). A waiting state
  with a named claim, never an error.
- `repair-exhausted(policy | deadline)` — the claim was exercised
  to its declared bound without yielding material; re-entry into
  `repair-pending` is legal whenever the world changes.
- `declared-history-narrowed` — an authorized `historyNarrow`
  (Access §7.1) covers the span: closed by declaration, not by
  damage.
- `lineage-damage(unrepaired)` — a skipped, void, or failing
  lineage step (Access §7.1) covers the span and no repair entry
  has landed; under Access §7.1 repairing it is a **duty** of
  every member holding both keys, and non-publication proves
  neither absence nor malice — which is exactly why this state
  is named by the observable (the damaged step) and **not** by
  the unobservable (`no-holder`): a surface MUST NOT claim "no
  holder exists", only "no repair has landed".

**Surface rule (normative for conformant consumers of this
port):** any surface that shows convergence MUST show the
convergence frontier (I5) and the readability frontier as **two**
statements; deriving one from the other, in either direction, is
nonconformant. Authority state is never dark (Access §3.1) — at
most content is, and at most until repaired.

## 9. Adapter Registration

An adapter binds a substrate and transport to this port. Its
registration names, at minimum:

- the **substrate** and which conformance classes it serves
  (replica, service, both);
- the **concurrencyScope** — in this version the only registrable
  value for enforcement is `single-partition` (I16's liveness
  residual; Access §3.6/§9.6);
- the **entry-id rule** confirmation per profile (3.4);
- the **session** mechanism, its authentication binding, and —
  for services — the **attestation-key binding** (Section 6);
- the **target and page encodings** (4.1) — how targets and page
  delimiters travel;
- the **discovery mechanism** for rebinding (I15), and whether
  **ack receipts** are persisted and recoverable (I15, RO-6);
- the **durable store** boundary and crash model that I9's
  `durable` binds to;
- the **quotas and bounds**: entry size bound (3.1), per-group and
  per-session-principal service quotas (7.4), replica held-evidence
  bounds (7.1);
- the declared constants: `repair-horizon` (I12), run-record
  minimum retention (I3), and the closed `aborted` reason set
  (4.3);
- the **snapshot profile**, where one exists (none in this
  casting — RO-2).

A registration MUST NOT weaken any promise of Section 5; where a
substrate cannot carry a promise, the adapter carries it above the
substrate or the substrate is not admissible (Access §9.1 names
the floor). Every adapter carries the target-control overlay of
Section 4 in addition to whatever data-plane sync it reuses (1.3,
door 5).

## 10. Candidate Substrates (informative; per component, sources as of 2026-08)

The honesty companion of 1.3, per candidate **component and
version state** — "native" (the component carries the promise) ·
"adapter duty" (an adapter above it must) · "excluded today" (a
current property contradicts a door):

| Candidate (component, state) | Assessment |
|---|---|
| `linear/0.1` (Access §9.6, normative reference) | native across all sixteen promises; single-lane enforcement (I16 trivially — no sibling epochs by construction); the interim scope until OI-1 |
| **p2panda** (core + auth + encryption components, 2025 releases) | P1/I14: **adapter duty with a pinned RLTP resolver** — the resolver being replaceable is the hook, not the satisfaction; different resolvers reach different verdicts, so only a registered, pinned resolver meets the equal-verdict rule. Causality/I2 near-native. Its auth/encryption components (PCS/FS capable) sit **above** this port in the TCB adapter per deployment cut; sync/storage stays behind the port. Targets (Section 4) and discovery (I15): adapter duty. Browser story open. |
| **Keyhive/BeeKEM** (Ink & Switch notebook state, 2025) | P3 exemplar (causal encryption). Correction from review: removal **blanks the member leaf and its whole path** on remove — the earlier "lazy removal" characterization was wrong. The exclusion ground that remains: **P2/I4 atomicity of the RLTP authority claim + transition is not present** (RLTP-shaped enforcement artifacts and their commit are foreign to it), and a policy-injection point (P1/I14) is missing — both concrete contribution targets, not permanent verdicts. |
| **SECSYNC** (repo state, 2025) | Separated honestly: **native gaps** — key distribution/rotation explicitly out of scope; a central service can exclude a participant undetected. **Adapter duty on top** — authorization (I7), repair (I12), targets (Section 4): substantial but constructible. **Excluded today** — its snapshot-centric authority ingest meets an empty snapshot registry (RO-2); until a verifiable snapshot profile exists, its core model cannot carry the authority log. |
| **NextGraph** (docs state, 2025) | **Port-dependent**: its internal broker protocol sees commit headers (DAG servable — I1/I12 duties constructible); its external protocol strips them (DAG not reconstructable — a service on that cut cannot serve closures). An adapter must name which NextGraph port it binds. Verifier decrypts → TCB adapter, correctly. Translating authorization views (I7) into its own repo/permission/quorum system is a thick adapter, not a binding. |
| **Automerge / classical local-first sync engines** | data-plane only (1.3 door 5): have/need and Bloom-filter sync run **below** the target-control overlay; without the overlay their exchanges are the unattested profile (4.4) — pages, never `reached`. Adapter duty: session auth, targets, consistency chain. |

None is a conformant adapter today; the named gaps are concrete,
scoped contribution targets, and the port is shaped so each could
become an adapter without changing this contract.

## 11. Security Considerations

- **What removal cuts — and the named residual.** A removal cuts,
  structurally: **standing at services** (the next view no longer
  lists the removed member's identity — writes and reads
  fail-closed, I7/I4); **every future epoch** (key world, Access
  §7.1/§7.2); and nothing anonymously — every entry is signed and
  attributable (3.4). What it cannot cut, in any deterministic
  system, is stated rather than hidden: **a causally pre-removal
  entry remains admissible forever**, and a removed member who
  still holds pre-removal keys can construct such entries after
  the fact. The artifact is byte-indistinguishable from an honest
  offline write that arrived late — and the wot#232 family is the
  field proof that honest late arrivals are real and must not be
  lost. **The determinism theorem behind the residual:** any
  admission rule that varies with arrival time relative to local
  state violates P1's raw-state equal-verdict requirement (Access
  §9.2) — two replicas ingesting the same DAG would disagree.
  So the verdict stays artifact-shaped, and the residual is
  bounded: no access to any post-removal epoch, no service
  standing, full attributability, and a replica MAY surface
  "arrived here after the removal" as local knowledge (I10 —
  never verdict-relevant, never replicated). The previous
  generation closed this door with a carrier type whitelist —
  and paid with carrier extensibility, a shared capability
  secret, and no attributability; its gate also only ever
  guarded one road. This contract closes artifact-shaped what is
  closable and names what is not.
- **TOCTOU on authorization.** A service acting on live-read
  foreign truth was the field's stale-authorization class. Views
  are presented, chained, freshness-bounded, and fail-closed in
  both directions (I7); within one epoch the authorized set only
  grows (Access §7.1), so a slightly stale view never grants what
  the log revoked.
- **Source equivocation is evidence, not weather.** The
  per-source consistency chain (4.1) turns a split-view into two
  signed artifacts that convict their signer; replicas may gossip
  targets cheaply by digest. A source that never equivocates never
  pays; one that does is caught by any two replicas that compare
  (the CT lesson: RFC 6962/9162).
- **Insider fork is denial of service, never authority gain.** A
  malicious authorized member can force the forked state (I16);
  it is fail-closed, attributable, and surfaced (Access §3.6).
  Winner-picking anywhere — including "just locally, just for
  liveness" — converts that DoS into potential authority theft
  and is forbidden. The liveness price is stated in I16.
- **Amplification and exhaustion are bounded by named constants.**
  Authorized-writer floods meet per-principal and per-group quotas
  with deterministic refusal (7.4); held-evidence floods
  (missing-closure chains, fork spam) meet the replica bounds of
  7.1; view-path work is bounded by Access §7.3's evidence
  contract. A service under attack fails toward refusal of
  storage, never toward serving unauthorized reads and never
  toward silent eviction of attested data.
- **Dark spans are stated, not argued away.** Where no repair for
  a damaged lineage step has landed, Section 8 forces surfaces to
  say exactly that — and forbids the unprovable stronger claim.
- **Replay and duplication are the normal case.** At-least-once
  transport, crash-retry, and multi-source catch-up converge
  through per-profile idempotency (7.1 step 2) — with the proof
  accumulator explicitly exempted from suppression (3.4.1), so
  dedup can never starve a quorum.
- **The port stands outside the TCB** (3.3): nothing in this
  contract makes a substrate operator safe to trust with keys,
  because nothing ever hands them any.

## 12. Privacy Considerations

- **What a service sees:** the group's genesis digest, derived
  service identities from presented views (never personal anchors
  — Identity §7), and — new in this casting, stated honestly —
  the **content-entry header** (3.4.2): per-group writer
  identities, epochs, parent-graph shape, sizes, timing. This is
  the price of artifact-shaped verdicts, and it is bounded by
  identity discipline: the writer identity is the per-group
  context of Access §5.1/5.2, correlatable within the group's
  service relationship, not across groups. The previous
  generation's relay saw more with less protection (account DID,
  device ids, doc ids, sequence numbers — unsigned). It never
  sees payload plaintext, document types, or reader behavior.
- **Traffic analysis is not hidden.** DAG shape and timing
  correlate activity; this contract does not claim otherwise.
  What bounds the exposure is identity discipline, not the
  absence of observers; the carrier-relationship identity of the
  Delivery side is its own coordinated work.
- **Local truth stays local by contract** (I10): reader states,
  run records, retry state, arrival-time observations, and device
  identifiers never enter replicated state, so they are not
  exposed to any counterparty, service or peer.

## 13. Conformance

- **Profile** `rltp-replication@0.2`; companion pins per the
  header.
- **Classes:** *replica* (Sections 3–9 in full) · *service*
  (Sections 3, 4, 6, 7.4, and I1/I3/I6/I7/I8/I9/I12/I13/I15 in
  their service roles). Adapters are below the line and conform
  through their registration (Section 9). I6 and the TCB boundary
  are audit criteria (Access §9.1's class); everything else is
  trace-testable.
- **No shipped schemas in this casting.** The two canonical
  signature inputs this contract defines (the content header
  3.4.2, the target 4.1) are normative as JCS field sets; their
  wire encodings and everything else are adapter-registered
  (Section 9). Schema shipment becomes due with the first adapter
  registration (RO-3).
- **Trace-vector plan** (each vector is a trace plus the required
  verdicts; the sixteen counter-vectors of Section 5 are the
  floor):
  - page-without-target → pages only, no completeness claim
    (I1/4.4);
  - proof-merge convergence: two individually insufficient proof
    variants of one operation, either arrival order → held, then
    valid after merge; dedup never suppresses the merge (3.4.1);
  - content-header binding: same payload under two headers
    (different parents/epoch/writer) → two ids, both judged
    independently; no metadata equivocation representable
    (3.4.2);
  - epoch forgery (claimed epoch ≠ position epoch) → `invalid`;
    non-member writer at position → `invalid`; pre-removal
    positioned entry of a removed writer → `accepted` (the named
    residual, Section 11);
  - out-of-order epoch content within a page, both permutations →
    identical verdicts (7.2, I2);
  - overlapping runs, crash between them → two run records, two
    terminals (I3);
  - crash inside an enforcement artifact → atomic both-or-neither
    (I4);
  - the three predicate stages, each relative to its target and
    scope; a later target supersedes without retro-invalidation;
    `stored`-scope never substitutes for `canonical` (I5, 4.2);
  - removed member's read and write against a stale view → both
    fail-closed; reconciliation view still admitted while
    fail-closed (I7);
  - late-attaching consumer samples every promised condition,
    including after restart (I8);
  - durable-report crash-safety (I9);
  - replicated reader-state / run-record attempt → structurally
    rejected (I10);
  - crash-and-restart send-set recomputation as closure
    difference; forked-disposed entries excluded (I11);
  - gap repair: evidence-carrying request; every outcome of 4.3
    exercised; unreachable source → `awaiting-source`, samplable;
    run unterminated past `repair-horizon` → nonconformant (I12);
  - a port interface demanding per-entry durable transactions →
    nonconformant; page-granular commit satisfying I9 (I13);
  - delivery-effect ingress through admission; direct-write
    attempt caught; snapshot ingest refused (I14, 7.3);
  - rebind matrix: `(stable-id, source proof, attested target,
    ack evidence | none)` × all four outcomes; evidence judged
    against closure(F), not F; no fabricated loss claims (I15);
  - sibling transitions, late-arrival order: first `canonical`
    then both `forked`, dispositions revised, verdicts unchanged,
    no further forwarding, authorization fail-closed (I16);
  - source-equivocation: two signed targets, same
    `(source, group, seq)`, different heads → fail-closed toward
    the source, evidence retained and transportable (4.1);
  - quota and saturation: deterministic `refused(quota)` /
    `evidence-saturated`, control plane still open, nothing
    attested evicted (7.4);
  - held-evidence bound: missing-closure flood → deterministic
    refusal/eviction of held (never accepted) entries (7.1);
  - blind service admission: authorized poison `stored` at the
    service, `invalid` at every replica,
    `target-unadmissible(set)` against the service's
    `stored`-scope target (7.4, 4.3).

## 14. Open Issues

- **RO-1 — Fork reconciliation.** Exit from the forked state is
  Access OI-1 terrain; until it resolves, `concurrencyScope =
  single-partition` is the only registrable enforcement scope
  (I16, Section 9) and I16 is forked-only. Winner selection may
  only arrive as a coordinated Access re-cast.
- **RO-2 — Snapshot profiles.** The registry ships empty. The
  registration bar is P1's equal-verdict rule — validity **and
  canonicality** — over snapshot input; a candidate profile must
  state what a verifier recomputes versus what it trusts, and why
  the difference cannot change any verdict.
- **RO-3 — Wire encodings and schemas.** The content header
  (3.4.2) and the target (4.1) are normative as canonical JCS
  field sets; their wire encodings are adapter-named. With the
  first adapter registration, shipped schemas and shipped vectors
  become due; with the second independent adapter, a common
  normative encoding becomes a candidate.
- **RO-4 — Published service constants.** Quotas and bounds are
  mandatory registration fields (Section 9); whether any deserve
  cross-deployment registry publication (the Delivery §4.4
  `registry-declaration` pattern) is deferred to adapter
  evidence.
- **RO-5 — Key-regime neutrality.** The personal group's declared
  key regime (root-derived epochal / independent-keys) is Access
  and Identity terrain. This contract's only stake is stated in
  I6, I15, and 3.3: nothing at or below the port line assumes
  derivability of any key, and the stable group identity is never
  derived from key material — both regimes replicate identically.
- **RO-6 — Ack receipts.** I15's loss-detection evidence is
  adapter-declared in persistence and recovery; a normalized
  receipt artifact (form, signing, recovery channel) is a
  candidate for a later casting once adapter evidence exists.
- **RO-7 — The content payload seal.** The header profile (3.4.2)
  is deliberately payload-opaque; the sealing construction (which
  epoch key, AAD binding to `{group, epoch, payloadDigest}`) is
  coordination terrain with Access §7.1/§9.5 and the future
  Layer 4 — named here so the debt is visible, constrained here
  only by I6 (the port never needs the answer).

## Appendix A (informative): mapping to the current implementation

| This contract | Today (Gen 2: Sync 001–003, wot-core) |
|---|---|
| I1/I15 catch-up + rebind | vault pull, seq-log recovery, migration re-anchor-on-connect fix |
| I5 three-stage predicate | `loaded`/`complete` heuristics (~200 lines, rls#274) — replaced by target-relative stages |
| Content entries (3.4.2) | unsigned Yjs updates `{docId, seq, ciphertext}` under channel auth — replaced by signed headers under artifact auth; seq → causal parents (the seq↔nonce coupling debt ends here) |
| Section 8 reader states | `classifyLogEntryKeyDisposition` — relocated above the line as `blocked-by-key(repair-pending)` + observable dark states |
| I2 + closure admission | `evaluateKeyRotationDisposition` (`future-buffer`/`apply`/`ignore-stale-or-duplicate`) — evaporates: causality + idempotency + gap handling |
| I7 presented views | `present-capability` control frame under the shared `spaceCapabilitySigningKey` — replaced by Access §7.3 views; the capability-seed bug family ends structurally |
| I14 all-ingress admission | relay type whitelist (VE-R2) + `devices`-table join in `isFullyDelivered` — both costs of the missing cut; carrier becomes type-blind again |
| Targets (Section 4) | none — completeness was inferred from silence (rls#274); the attested chain is new |
| I11 log as send-truth | outbox resend loop class |
| I9 transaction-bound gates | acked-but-not-durable loss class |
| I16 forked | no counterpart (single relay total order) — `linear/0.1` is that honesty as an adapter |

## Appendix B (informative): field provenance of the promises

| # | Provenance |
|---|---|
| I1 | multi-device silent loss family (wot#232); decision seam 4; review 1 B-5 (target-unadmissible) |
| I2 | two-channel rotation race (Sync 001/003 key-rotation inbox type); Access P2/§7.1; review 1 M-1 (page order) |
| I3 | unpaired sync-run reporting (wot#346); review 1 M-2 (normative trigger, retention) |
| I4 | Access P2/§5.3 commit-before-forward; decision seam 1; review 1 M-4 (adapter carries the key world) |
| I5 | false `complete: true` (rls#274); first-sync signal harvest (wot#343/#344); review 1 B-4/m-1 (scopes) |
| I6 | key-export prohibition lesson (wot#306); decision seam 3 |
| I7 | stale-authorization TOCTOU (wot#289); capability-seed family (wot#234); review 1 M-4 (control plane open) |
| I8 | state-vs-edge gate lesson (wot#288, gate 3); review 1 M-2 (enumerated scope) |
| I9 | durability gate losses (wot#328, wot#193) |
| I10 | local/replicated coupling (wot#285); devices-table terminality |
| I11 | outbox loop (wot#236, wot#245, wot#249); review 1 M-5 (defined send set) |
| I12 | gap-repair gate (wot#288, gate 2); review 1 M-3 (one algebra) |
| I13 | cold-start scale measurement (wot#353: 8 990 `importKey`); review 1 M-5 (ceiling form) |
| I14 | review 1 of the decision pair B-6 + whitelist genealogy (Sync 003 §Relay-Whitelist); review 1 B-1/B-7 (verdict/disposition split) |
| I15 | acked-log orphan after migration (register §C); decision-pair M-5/M-2; review 1 B-6 (evidence-bound loss detection) |
| I16 | decision-pair B-5/B-4; Access §3.6; MLS comparison; review 1 B-7/M-6 (revisable disposition, liveness residual) |

## References

[RFC2119] · [RFC8174] BCP 14 · [RFC8785] JCS · RLTP Access Layer
0.30, wire 0.24 (§§3.2, 3.3, 3.4, 3.6, 5.1–5.4, 7.1–7.3, 9, 10) ·
RLTP Identity Layer 0.12 (§7) · RLTP Delivery Contract 0.21
(§§4.4, 6) · RLTP Membership Tasks 0.16 · RLTP Encounter Layer
0.28, wire 0.25 (§2.3 interim securing profile) · Decision record:
`design/portvertrags-paar-entscheide-2026-08.md` (Revision 2) with
reviews; casting review: `design/replication-review1-2026-08.md` ·
Sync 001/003 (superseded transport specs, Appendix A) · MLS:
RFC 9420, RFC 9750 (I16/liveness comparison) · Certificate
Transparency: RFC 6962, RFC 9162 (equivocation-evidence rationale,
4.1) · Candidate substrate documentation per Section 10.
