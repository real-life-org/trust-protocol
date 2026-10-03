# RLTP Replication Contract

**Real Life Trust Protocol — service contract: Replication**

- **Status:** Editor's Draft
- **Version:** 0.8.0-draft (eighth casting — the joint round-7
  answer: the executable evidence session (§6, I11), the
  three-value disposition sweep (§2, I14), the run/exchange
  separation (`target-chain-unavailable` only for target-requiring
  goals; unattested exchanges produce no §4.3 run), and the pins;
  `design/replication-review7-joint-2026-08.md`). The seventh
  casting was the joint round-6 answer: the evidence authorization for the forked state (I11,
  I16, word-aligned with Access 0.33 §3.6), the total disposition
  order with closed transitions (7.1, I8, I14), the goal-run
  distinction for `target-chain-unavailable` (4.3/4.4), and the
  sweep; `design/replication-review6-joint-2026-08.md`). The
  sixth casting was the joint round-5 answer: the shared disposition algebra gains
  `removed-disposed` (7.1, I8, I14), evidence transport is bounded
  to currently authorized counterparties (I11, I16), the
  no-target precedence is closed (4.3), and the version pins are
  swept; `design/replication-review5-joint-2026-08.md`)
- **Editors:** Anton Tranelis
- **Date:** 2026-08-26
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Conformance profile:** `rltp-replication@0.8` (draft)
- **Companion pins:** Access Layer 0.34 (wire 0.24; registration
  artifact 0.25) · Identity Layer
  0.12 · Delivery Contract 0.21 · Membership Tasks 0.16 · Encounter
  Layer 0.28 (wire 0.25)
- **Supersedes:** 0.5 (archived,
  `spec/archive/replication-contract-0.5-fuenftguss.md`; earlier
  castings alongside). Before that: 0.4 (archived,
  `spec/archive/replication-contract-0.4-viertguss.md`; 0.1–0.3
  archived alongside)
- **Position:** not a layer. Replication is the service behind the
  port the Access Layer requires (Access §10); every layer may use
  it, none depends on its internals.

## Abstract

This document specifies how replicated group state travels between
the replicas of its members. The replication service converges
**individually signed, causally linked entries** — gaplessly
relative to an attested and equivocation-protected target,
idempotently, never silently diverging where evidence has met — and
promises **convergence over entries, never readability of
content**. It is key-blind by construction: no secret material
crosses its port, no plaintext is required for any promise it
makes, and the substrate that moves the bytes stands outside the
trusted computing base.

Two entry profiles travel through the port (Section 3.4): the
**authority entries** of the Access Layer's operation envelope, and
**content entries** under this contract's signed public header —
the artifact-shaped authentication the previous generation's
channel-gated model lacked. The contract is sixteen promises
(I1–I16, Section 5), each stated with its preconditions, its
outcomes from one shared algebra (4.3), and a counter-vector.
Around them it fixes the port line (Section 3), the attested
convergence target with its per-source consistency chain and its
honest restart (Section 4), service authorization by presented
authorization views (Section 6), the single ingest admission every
entry passes regardless of how it arrived — with immutable
admission verdicts separated from merge-revisable canonicality
dispositions, and with the rule that **canonicality is never
attested, only computed** (Section 7) — and the reader-state
vocabulary that keeps "converged" and "readable" from ever being
conflated above the line (Section 8).

## Status of This Document

This is an **Editor's Draft** with no standing beyond its own
argument. Its requirements are the decision record of the
port-contract pair (`design/portvertrags-paar-entscheide-2026-08.md`,
Revision 2), distilled from roughly 120 field issues of the deployed
previous-generation implementation; the sixteen promises carry their
field provenance in Appendix B. The first review round
(`design/replication-review1-2026-08.md`, 7B/8M/2m) was answered by
the second casting; the second round
(`design/replication-review2-2026-08.md`, 8B/7M/2m) by the third;
the third round (`design/replication-review3-2026-08.md`, 5B/8M/0m
— each round also confirmed that no prior resolution had been
defined away) was answered by the fourth casting; the fourth round
(`design/replication-review4-2026-08.md`, 5B/8M/1m) split into a
contract-side class and a seam class, and on the editor's decision
(26.08.2026, option 1) the seam class was answered where it lives:
**Access 0.31, the surgical replication-seam casting**
(`design/access-031-nahtguss-plan-2026-08.md`) — evidence transport
distinguished from authority forwarding, the removal disposition
over concurrent authorship, the service fail-closed wording, and
the registration generation with attestation-key rebind
(registration artifact 0.25). The fifth casting answered the
contract-side class — the observable `target-chain-unavailable`
in place of an unprovable negative, the forked prefix as a
whole-DAG function, run-global source failures and the
`unresolved` terminal, disjoint arrival results, charge lifetime,
total-bound and floor-reservation rules, the `stalenessBound` cap,
and the domain-separated cross-signature — and re-pins the seam.
The fourth casting's deepest cuts:

- the target chain can no longer shed duties by self-assertion:
  attestation-key rotation is **in-chain and cross-signed**, and
  after honest state loss a source resumes only through **group
  re-registration** — never a self-declared restart (R3 B-1/B-2;
  the Certificate-Transparency doctrine: a log does not drop
  append-only by declaring loss);
- the blind service honestly cannot detect an authority fork:
  `fail-closed(forked)` is **withdrawn** from its verdicts; the
  real mechanism is view staleness and view divergence, and the
  bounded window in between is a named residual (R3 B-3);
- the **forked materialization** is defined in Access §3.5/§3.6's
  own terms: effects already taken are retained, never revised,
  and not presented as current; the unforked prefix stays
  queryable; no *new* effect arises on any branch (R3 B-4);
- the outcome precedence is **total** (aborted, successes, and
  rebind conflicts included), arrival results are separated from
  entry states, evidence provenance and the repair reserve are
  bounded, service-wide capacity is admitted honestly, and the
  author-removal debt is stated byte-checkably (R3 B-5, M-1–M-8).

The third casting's cuts remain:

- the **fork model is one consistent machine**: the forked trigger
  is two fully `accepted` siblings, nothing weaker (B-5);
  **canonicality is never attested** — targets carry `stored` and
  `admitted` scopes only, the sync plan runs on the admitted
  closure, and fork evidence therefore always flows, so fail-closed
  spreads instead of silently diverging (B-6); accepted entries —
  forked ones included — are store, never evictable, and the
  insider fork-spam residual is named and priced (B-7);
- the content-entry id is computed over the **signature-less**
  header — Access §3.2 excludes signature bytes from identities for
  exactly the signer-malleability reason this round demonstrated
  (B-3) — and the service authorizes **only the session
  principal**, never the entry's writer (B-2);
- the target chain gains a **durability duty** (B-4), and the
  split-view claim is narrowed to what the chain actually gives:
  provable equivocation where evidence meets, with guaranteed
  detection deferred to witness rules (M-1, RO-8);
- the outcome algebra is a **tagged sum with normative precedence**,
  and the rebind outcomes are genuine variants of it (B-8);
- the removed-member analysis is completed for authority entries:
  the editor's decision (26.08.2026, review-2 triage) is the
  **author-removal-prevails rule** — an authorized removal prevails
  over the removed member's own concurrent additive operations —
  as a **coordinated Access re-cast debt**; under this version's
  only registrable concurrency scope (`single-partition`) the
  attack window does not structurally exist, so the debt is due
  before Access OI-1, not before this contract (B-1, Section 11).

The convergence criterion is two consecutive review rounds without
blocker-level findings.

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
- **Evidence flows; effect is gated.** Replication transports
  every accepted entry — divergence evidence included; what
  admission and disposition gate is effect, forwarding-as-
  canonical, and eviction, never the transport of proof. A group
  that has forked learns it everywhere, instead of splitting into
  replicas that know and replicas that never will.
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
- **Idempotency is byte-artifact idempotency, honestly bounded.**
  A content entry's identity is a deterministic function of its
  signature-less header (3.4.2); an authority entry's identity is
  its operation id, whose proof accumulator merges instead of
  deduplicating (3.4.1). `duplicate` can never mask divergent
  content — and the contract does not pretend the converse:
  re-sealing the same plaintext is a new artifact; semantic
  deduplication is a layer-above concern.

### 1.2 The two sides of the line

Two conformance classes implement this contract (Section 13):

- A **replica** is the entry store on a member's device, below the
  enforcement adapter (Access §9). It runs the full ingest
  admission (P1 + the epoch gate + P2), applies entries causally,
  and forwards only what it has durably admitted (I4, I11).
- A **service** is a durable, key-blind party — a relay, a broker,
  a storage host — registered by the group under Access §7.3 and
  thereby holding the `relay` role: it stores and forwards the
  group's entries. It authorizes read and write **only** against
  presented authorization views — and only the **session
  principal**, never an entry's writer (7.4) — judges storage,
  never validity, and never needs to.

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
candidate substrates against exactly these doors and says honestly
which each one currently fails.

## 2. Conventions and Terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" are to be interpreted as described in BCP 14 [RFC2119]
[RFC8174] when, and only when, they appear in all capitals.

The **interim securing profile** of Encounter 2.3 applies where
this contract signs or hashes (Ed25519 raw signatures over JCS,
SHA-256 multihash, multibase `u` emission, RFC3339-UTC-`Z`
timestamps).

**Group identity** is the genesis digest of Access §3.2; it is the
only group name this contract uses, and it is never derived from
key material (I15).

**Entry** — the unit of replication, in one of two profiles
(3.4): an **authority entry** (the operation envelope of Access
§3.3) or a **content entry** (this contract's signed header plus
sealed payload). **Entry id** — the profile's identity: the
operation id for authority entries; the digest of the
signature-less header for content entries (3.4.2). **Parents** —
the entry ids an entry causally depends on. **Closure** — an entry
together with every ancestor reachable through parent references;
`closure(F)` for a frontier F is the union over its heads.
**Frontier** — a set of entry ids no other held entry of the same
scope has as a parent; scopes are `stored` and `admitted`
(attestable) and `canonical` (local only, 4.2). **Session** — one
authenticated exchange between a replica and a source (Section 6).
**Source** — the counterparty a replica converges from: a service
or another replica. **Page** — a source-delimited batch of entries
within a session. **Run** — one identified attempt at a declared
goal (a catch-up, a repair, a rebind), with exactly one terminal
outcome from the algebra of 4.3 (I3). **Convergence target** — the
attested artifact of 4.1. **Chain restart** — the signed,
surfaced re-start of a source's target chain after honest state
loss (4.1). **Admission verdict** — the immutable per-entry result
of Section 7. **Canonicality disposition** — the merge-revisable
per-entry disposition `canonical | forked | removed-disposed`
(7.1 step 5, I16; total order `forked ≻ removed-disposed ≻
canonical`), computed, never attested. **Ack receipt** — the optional
recoverable acknowledgement evidence of I15. **Reader state** —
the above-the-line readability vocabulary of Section 8.

| Term | Fragment |
|---|---|
| Entry | `#Entry` |
| Content header | `#ContentHeader` |
| Frontier | `#Frontier` |
| Convergence target | `#ConvergenceTarget` |
| Chain restart | `#ChainRestart` |
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
signature and — signature bytes themselves excepted (3.4.2) — by
its id, so the same signed content can never be presented with
different metadata.

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
  "v":             "rltp-replication-content/0.8",
  "group":         <genesis digest, canonical u form (Access §3.2)>,
  "parents":       [ <entry id>, … ],
  "epoch":         <integer>,
  "writer":        <the writer's member identity for this group
                    (Access §5.1 — the per-group member anchor)>,
  "payloadDigest": <multibase multihash over the sealed payload
                    bytes>,
  "sig":           <signature under writer over the JCS
                    serialization of the header with sig omitted>
}
```

- **Identity:** the entry id is the multibase multihash over the
  UTF-8 bytes of `JCS(header with sig omitted)` — the
  **signature-less** header. Signature bytes are excluded from the
  identity for the same reason Access §3.2 excludes them from
  every identity: a signer can produce many valid signatures over
  one input, and an id that covered them would let one author mint
  unbounded distinct ids for identical content. `sig`
  authenticates exactly the id input; it never contributes to it.
  Two arrivals of one header with different valid signatures are
  one entry (`duplicate`; the first verifying signature suffices —
  nothing about the entry depends on which). Via `payloadDigest`
  the id is transitively bound to the sealed payload bytes; via
  the header it binds group, parents, epoch, and writer, so no
  metadata equivocation is representable. **Idempotency scope,
  stated honestly:** this is byte-artifact identity — re-sealing
  the same plaintext yields new sealed bytes, a new
  `payloadDigest`, a new entry; the port neither detects nor
  promises semantic equality (I6 forbids it the means).
- **Writer:** the per-group member anchor that already exists in
  the stack (Access §5.1) — this profile introduces **no new
  identity class**. The signature MUST verify under it. The
  `writer` field is judged **only by replicas** (admission, step
  4); it is never a service's concern (7.4) — a service cannot
  know it (the member↔service-identity mapping is deliberately
  inside the encrypted log), and an authorized replicator
  forwards entries signed by others as a matter of course.
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
  "v":             "rltp-replication-target/0.8",
  "genesisDigest": <group identity>,
  "source":        <canonical source identity (Section 6)>,
  "session":       <session identifier>,
  "seq":           <integer ≥ 1: this source's attestation
                    sequence for this group, strictly increasing
                    by 1 within a chain>,
  "frontier":      { "scope": "stored" | "admitted",
                     "heads": [ <entry id>, … , sorted by unsigned
                                bytewise order ] },
  "prev":          <digest of this source's previous target for
                    this group (its signature input), or null
                    iff seq = 1>,
  "keyRotation":   <absent, or { "newKey": <the successor
                    attestation public key>, "crossSig":
                    <signature under the CURRENT attestation key
                    over the UTF-8 JCS bytes of
                    { "v": "rltp-replication-keyrotation/0.8",
                      "genesisDigest", "source", "seq", "prev",
                      "newKey" } — domain-separated and
                    chain-bound; a bare-key signature is not a
                    rotation> } — the next target verifies under
                    newKey; the chain continues>,
  "restart":       <absent, or — only together with seq = 1 and a
                    fresh group re-registration (below) —
                    { "lastKnown": <digest of the last retained
                       own target's signature input, or null> }>,
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
- **Scope honesty — canonicality is never attested.** A key-blind
  service attests `stored` — it cannot judge admission and MUST
  NOT claim it. A replica source attests `admitted`. **No source
  attests `canonical`:** canonicality is a merge-revisable local
  disposition (7.1, I16), and an attestation of it would be
  falsified by the next arriving sibling — the second casting made
  that mistake and the fork machine broke on it. Both attestable
  scopes are grow-only, so the consistency duty below is
  satisfiable forever. A consumer judges `reached` against what
  the scope can promise: a `stored` frontier may contain entries
  that fail admission — that outcome is `unadmissible(set)`, not
  equivocation (4.3).
- **The consistency chain.** Within a chain, `seq` increases by
  exactly 1 per attestation of a `(source, group)`; `prev` chains
  to the predecessor. A source MUST only attest extensions:
  `closure(heads_{seq}) ⊇ closure(heads_{seq−1})` on its own held
  state of the attested scope. **Chain durability is a duty:** a
  source MUST hold its chain state (last seq and digest) within
  the same durability boundary as the entries it attests (I9) —
  losing one means losing both, and the answer to honest loss is
  the restart, not a fork.
- **Key rotation is in-chain, never a restart.** The attestation
  key rotates only through `keyRotation`: the current key
  cross-signs the successor inside a chained target, and the chain
  continues under the new key. A claimed rotation without the
  cross-signature is not a rotation — **no self-assertion ever
  changes the verification root**. A source that has lost its
  current attestation key has lost its chain continuity and takes
  the state-loss path below.
- **State loss ends continuity — and only the group restores it.**
  A source cannot shed its attestation duties by declaring loss
  (the Certificate-Transparency doctrine: an append-only log does
  not drop its obligations by self-declared reset). A source
  without its chain state MUST stop issuing targets; toward its
  consumers the observable state is `target-chain-unavailable`
  (a run outcome, 4.3 — deliberately claiming only what a
  consumer can see: no chain-valid target was obtainable, whether
  by partition, withholding, or loss), fail-closed for
  targets, unattested pages still legal (4.4). Target issuance
  resumes **only through a fresh group registration** (Access
  §7.3 — since Access 0.31 a first-class act: the
  generation-g+1 registration with `previousRegistration` digest
  and fresh `attestationKey`, artifact 0.25): the first
  post-rebind target carries `seq = 1` and the `restart` marker
  with the last retained digest or null. Supersession is thereby
  **evidence, not inference**: a held generation-g+1 registration
  proves the old chain's standing ended; targets verify only
  under the current generation's attestation key — which also
  heals a **stolen** attestation key (the group rebinds; the
  thief's chain keeps evidence value and loses standing; the
  window until the rebind is a named residual, Section 11).
  Consumers judge ack evidence (I15) against old and new chains
  together. **Two live chains without an intervening
  re-registration — or two distinct targets claiming the same
  `(source, group, chain, seq)` — are provable equivocation.** A
  re-registration does not launder equivocation: the old chain's
  artifacts remain evidence, and a source "restarting" while
  demonstrably continuing its old chain elsewhere has equivocated.
- **What the chain gives — and what it does not (stated
  honestly).** Where two artifacts of one source meet — in one
  replica, or between two replicas that compare — equivocation is
  **provable** from the artifacts alone, and the proof transports
  (the Certificate-Transparency lesson). What the chain does
  **not** give is guaranteed detection: comparison is opportunistic
  (replicas MAY exchange held targets of a shared source at any
  time, by digest, no trust required); a closure-regression proof
  additionally requires holding the regressed entries. Mandatory
  witness or gossip rules that would turn "provable" into
  "detected" are deliberately deferred (RO-8).
- **Supersession rule.** A later target of the same chain
  supersedes an earlier one; it never retroactively invalidates a
  verdict reached against the earlier one. `reached(F)` remains
  true for `F` forever; the world has merely moved on.
- **No-vacuum rule.** Absence of a target licenses no completeness
  claim of any strength (4.4).

### 4.2 Frontiers: two attestable, one local

- `stored` — heads over everything held, verdicts unknown (the
  only scope a service can compute); grow-only.
- `admitted` — heads over entries with verdict `accepted`
  (dispositions irrelevant — forked entries are admitted
  evidence); grow-only. **The admitted closure is the transport
  plane:** sync plans (I11) and repair run over it, which is what
  makes fork evidence flow (I16).
- `canonical` — a **local, never-attested** frontier: heads over
  entries `accepted` and disposed `canonical`. It exists for
  surfaces and for effect-gating (7.1 step 6), shrinks when a
  fork is detected, and is nobody's promise to anybody.

Every promise of Section 5 names the scope it binds; an
attestation names its scope (4.1); an implementation MUST NOT
substitute one scope for another.

### 4.3 The outcome algebra

One algebra serves every goal (catch-up I1, repair I12, rebind
I15). It is a **tagged sum**: common variants any run can produce,
plus goal-specific variants; a goal produces exactly the variants
listed for it, and nothing else.

**Common variants:**

- `denied` — authorization refused (I7);
- `source-equivocation(evidence)` — the source provably
  equivocated (4.1); fail-closed toward this source, evidence
  retained and transportable;
- `unadmissible(set)` — the source delivered the named entries,
  but they fail admission (7.1); attributable to the entries'
  writers, not to the source (expected against `stored`-scope
  sources; never equivocation);
- `missing(set)` — the run terminated (by requester decision or
  declared horizon) with the named entry ids still absent;
- `source-ended-before(goal)` — the source ended the session
  before the goal was served;
- `target-chain-unavailable` — only for target-requiring goals
  (catch-up, rebind; never repair — 4.4): the run ended without
  obtaining a chain-valid target from this source (partition,
  withholding, and state loss are deliberately indistinguishable
  here; a held superseding registration additionally *proves* the
  old chain's standing ended, 4.1);
- `unresolved(set)` — the run's horizon ended with the named
  entries **held but unhealed** (`missing-closure`: absent
  parents or insufficient proof) — distinct from `missing`
  (absent) and from `unadmissible` (terminally invalid); the
  held evidence stays, healable as ever;
- `aborted(reason)` — locally ended; `reason` from the adapter's
  registered closed reason set (transport failure included).

**Goal-specific success variants:** catch-up `reached(F)` · repair
`repaired(set)` · rebind `rebound-and-reached`.

**Rebind-specific variants** (I15): `source-auth-failed` ·
`entry-not-in-closure` · `conflicting-sources`.

**Precedence (normative, total).** A run's terminal outcome is
determined in two steps. **Step 1 — success test:** a run
terminates in its goal's success variant iff its goal set is fully
achieved (catch-up: the target closure admitted; repair: the named
set admitted; rebind: rediscovered sources reached and, where
evidence was presented, the evidence check passed) **and** no
failure condition of step 2 holds *within the goal set*.
**Scope rule:** source- and chain-level conditions —
`source-equivocation`, `target-chain-unavailable`, `denied` — are
**always run-global**: they concern the run's source or target
and are never "outside the goal set". Only entry-level conditions
scope to the goal set: an unadmissible or unhealed *extra* entry
the source volunteered, or a fault after achievement, never
displaces success; those remain per-entry verdicts and, where
evidence-grade, retained evidence. **Step 2 — failure order:** otherwise the
outcome is the first applicable of
`source-equivocation` ≻ `denied` ≻ `unadmissible` ≻
`conflicting-sources` ≻ `entry-not-in-closure` ≻ `missing` ≻
`source-ended-before` ≻ `unresolved` ≻ `target-chain-unavailable`
≻ `aborted`. Disambiguations: **`target-chain-unavailable` is the run-global
pre-emptive outcome whenever no chain-valid target ever defined
the run's goal closure** — entry-level outcomes (`unadmissible`,
`missing`, `unresolved`) apply only against a defined goal set;
`source-ended-before` applies only
when the source ended the session before serving the goal; a run
the requester ends, or that exhausts its horizon, with the source
still available, terminates `missing`; `aborted` applies only when
no listed condition above it holds — a local transport fault
concurrent with proven equivocation terminates
`source-equivocation`.

**Retryable states and evidence-driven termination** (samplable
per I8, never terminal, never silent): `awaiting-source` (source
unreachable; retry scheduled or offered) · `awaiting-evidence`
(held incomplete evidence: absent parents or insufficient proof
accumulation, 7.1). A retryable state ends the moment
higher-grade evidence decides the run: proven source equivocation
terminates an `awaiting-source` run immediately as
`source-equivocation` — waiting never outranks proof.

### 4.4 The unattested exchange profile

An exchange without attested targets — plain gossip, opportunistic
peer sync, a data-plane protocol run on its own — is **legal**. It
yields pages and admitted entries; **it declares no goal, is no
run, and produces no outcome of 4.3 at all** — local exchange
failures are an implementation surface, never run outcomes. The
distinction to 4.3's pre-emptive outcome is the declared goal:
`target-chain-unavailable` exists exactly for the goals whose
definition requires a target — **catch-up and rebind** — when the
run requests one and never obtains a chain-valid one. Repair
needs no target (its goal set is the named missing ids) and never
produces `target-chain-unavailable`.
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

**Outcomes.** `reached(F)` plus the common variants of 4.3, under
its precedence.

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
goal, its run key, its target (where one exists), its current
state, and its terminal outcome. The **run key** is
`(goal, group, source)` — for rebind, `source` is the
`sourceSetDigest`: the multihash over the sorted set of the run's
discovered source identities. Overlapping runs terminate
independently; a crashed run is terminated (`aborted(crash)`) by
its successor's recovery, never silently absorbed. Run records are
retained at least until superseded by a later run of the same run
key **and** at least the adapter's declared minimum retention.

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
   own durable (I9) admission of that entry —
   commit-before-forward. (Forwarding of admitted entries is
   evidence transport and includes forked-disposed entries, I16;
   what requires canonicality is *effect*, 7.1 step 6.)
3. **Eviction:** replica-side, once a removal is **canonically**
   committed, the forwarding gate stops serving the removed
   member's replicas; service-side, eviction is enacted by the
   next presented view (I7) — the removed member's derived
   identity is absent, and the service fails closed toward it. In
   the forked state there is no canonical commit and no eviction
   is enacted on either sibling's claim (I16).

**Class.** Replica (1, 2); replica and service (3).

**Preconditions.** Admission of the enforcement artifact (I14).

**Outcomes.** For any crash point: after restart, either the whole
enforcement artifact is durably applied or none of it is; no
counterparty ever received an entry its sender had not durably
admitted.

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
inferred from any stage of it (Section 8). Neither is
canonicality: stage 3 is a statement about the admitted closure;
what is canonical within it is the local disposition (4.2). Later
targets supersede without retro-invalidation (4.1).

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
`stored`-scope attestation as an `admitted` one (4.2).

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
anchor ratchet). What it authorizes is the **session principal**
(Section 6) — never an entry's writer (3.4.2, 7.4). An expired or
inconsistent view is **fail-closed for entry reads AND entry
writes** — while the **control plane stays open exactly as Access
§7.3 obligation 5 commands**: valid view presentations — ordinary,
divergent, and reconciliation — MUST go on being admitted into the
service's view DAG even while the service is fail-closed for
entries, or divergence could never heal. Between replicas,
authorization derives from each replica's own materialized
membership at its current head (P1) — with the same fail-closed
rule under the forked state (Access §3.6).

**Class.** Service (view path); replica (peer path).

**Preconditions.** Registration (Access §7.3) for the service
path; an authenticated member identity for the peer path.

**Outcomes.** Per request: `authorized` · `denied(no-standing)` ·
`fail-closed(stale-view)` · `fail-closed(divergence)` ·
`fail-closed(forked)` (**peer path only** — a replica knows its
own forked state; a blind service never produces it, 7.4) — a
closed set; `denied`/`fail-closed` answers carry no information
beyond the verdict.

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
(I14), per-entry canonicality dispositions and entry states with
their per-arrival projection (I14), run records with their states
and outcomes (I3), the retryable states of 4.3, durability states
(I9), the forked condition and its materialization surfaces (I16),
continuity state of held source chains (4.1), and — where
a consumer surfaces readability — the reader states of Section 8.
(I6 is excluded by design: it is an audit criterion, 5.6.) Each
sampled value is **evidence-determined and stable absent new
evidence**: it is a function of held evidence, and re-sampling
without new evidence never changes the answer — never a function
of having observed a transition. The allowed transitions are
closed per field: verdicts only `missing-closure → accepted |
invalid` (3.4.1, 7.1); dispositions `canonical → forked` on
sibling admission, `forked → canonical` only through a future
reconciliation entry (RO-1), `canonical ↔ removed-disposed` exactly per Access §3.6's
rule-(c) evaluation point and d′ fixpoint,
`removed-disposed → forked` on an enclosing fork, and
`forked → removed-disposed | canonical` only through
reconciliation (the total order `forked ≻ removed-disposed ≻
canonical` of 7.1); run states `running →` one terminal;
durability `written → durable → offered`. Events MAY exist in
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
disagree, in which the truth is only in the event, or in which a
sampled field takes a transition outside its closed set, is
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
crash after the report. A source's target-chain state lives inside
this same boundary (4.1).

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
operation: `closure(admitted frontier_local) ∖
closure(F_counterparty)`, where `F_counterparty` is the newest
attested target (4.1) held from that counterparty. The send set
runs on the **admitted** scope (4.2) — forked- and
removed-disposed entries are included, because divergence and
disposition evidence must reach every replica (I16) — since
Access 0.31/0.32 this is the companion's own evidence-transport
rule (§3.6/§5.3: commit-before-forward gates
forwarding-as-authority, never the travel of proof). **Bounded by the
evidence authorization, word-aligned with Access 0.33 §3.6:** the
peers entitled to evidence are the **members of the maximal
unforked prefix's materialization** (equivalently, under an
undisputed removal: the current members) — so the forked state can
never starve its own cure: fail-closed governs authority, reads,
and writes, never the evidence plane — and the **evidence
session** of Section 6 makes the delivery path executable: peers
authenticate against the prefix membership for exactly this
session class. A member canonically removed
within that prefix stays excluded — to a removed peer nothing
causally new travels after the removal, evidence included (I4). Effect-gating
is the receiver's admission and disposition, never the sender's
filter. It is recomputed from the durable store
at any time — never maintained as a generic outbox of queued
send-intents. There is no replication outbox to drain, and after
any crash the send set is recomputed, not replayed.

**Class.** Replica (sender side).

**Preconditions.** I9 durability; a held counterparty target
(absent one, the send set is the full admitted closure, and the
counterparty converges by dedup).

**Outcomes.** After crash-and-restart with a counterparty at
attested frontier F: the send set equals the defined difference —
nothing doubled beyond idempotency, nothing dropped, no orphaned
queue intent, no fork side withheld.

**Counter-vector.** Replica A admits sibling T₂ after attesting
heads containing T₁; peer B holds only T₁. An implementation whose
send set excludes T₂ "because it is forked" leaves B permanently
ignorant of the fork — nonconformant; the divergence-evidence
class. Equally nonconformant: the queue-as-authority design of the
field's outbox loop (queue survives a store rollback, or is lost
while the store kept the entry — endless resend or silent drop).

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

**Outcomes.** `repaired(set)` plus the common variants of 4.3,
under its precedence; the retryable `awaiting-source` between
runs.

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
`accepted | missing-closure | invalid` — `invalid` terminal,
`missing-closure` provisional and healable (absent parents or
insufficient proof evidence, 3.4.1). `duplicate` is **not** an
entry verdict: it is an arrival result (below), and re-arrival
never re-judges or re-effects a held entry (idempotency, with the
authority-profile proof-merge duty). Above
the verdicts sits the merge-revisable **canonicality disposition**
`canonical | forked | removed-disposed` (7.1 step 5, I16 — the
total order of 7.1). **Effect requires
`accepted` AND `canonical`; forwarding requires `accepted`**
(evidence flows, I11/I16). Two surfaces are distinguished and
never conflated (they answer different questions): the
**arrival result** — per arrival —
`new(→ its verdict) | duplicate | proof-merged` (disjoint per
7.1 step 2: `proof-merged` iff the accumulator strictly grew),
and the
**entry state** — per entry, evidence-determined (I8) —
`missing-closure | invalid | accepted∧canonical |
accepted∧forked | accepted∧removed-disposed`. The five-outcome surface of the decision record
is preserved as the **normative per-arrival projection**:
`report(arrival) = invalid | missing-closure | duplicate | forked
| removed-disposed | accepted` — the verdict the arrival received,
with the disposition folded in for accepted entries at that
moment (the decision record's five values plus the
`removed-disposed` sixth that Access 0.31/0.32 introduced — the
delta is named, not hidden); it is
an arrival answer ("what did this ingest do"), while the entry
state is the samplable truth ("what is this entry now"), and only
the latter is immutable-modulo-healing.

**Class.** Replica (full admission); service (the blind admission
of 7.4).

**Preconditions.** Per ingress type, per Section 7.

**Outcomes.** The verdicts, dispositions, and projection, per
entry, samplable (I8).

**Counter-vector.** A registered delivery task type's "defined
effect" writes an attached artifact directly into the replica's
store because the document already passed Delivery's §6.2
pipeline. Conformant behavior: the artifact enters admission like
any synced entry — where it forges its epoch (a claimed epoch its
position does not carry) it falls `invalid` at 3.4.2's epoch
binding; where it is a causally pre-removal content entry of a
removed member it is **admissible by design and the residual is
named** (Section 11), never silently effected outside admission.
The direct write itself is the nonconformance — it is the reopened
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
stated as such, keyed by `sourceSetDigest` in the run record, I3),
source authentication (Section 6), and the target (4.1). A local
namespace MUST NOT determine the reachability of previously
acknowledged entries. Loss detection is **evidence-bound**: the
judgment `entry-not-in-closure` binds exactly when **ack-receipt
evidence** is presented — a recoverable artifact (recovered store
fragment, another device's records, a retained receipt) naming
previously acknowledged entry ids; whether ack receipts are
persisted and recoverable is adapter-declared (Section 9, RO-6).
Presented evidence E is judged as `E ∈ closure(F)` against each
authenticated source's attested target. **Without evidence,
absence is undetectable and the contract says so**: the rebind may
honestly end `rebound-and-reached` — it MUST NOT fabricate a loss
claim it cannot ground, and equally MUST NOT report "nothing was
lost", only "everything attested was reached".

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
both) — plus the common variants of 4.3.

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

**Promise.** Two **fully admitted** transitions (`accepted`, 7.1
steps 1–4 complete) of the same predecessor epoch that are not
causally ordered put the group in the **forked state** of Access
§3.6, adopted verbatim: *no operation building on either sibling
is canonical* — a fail-closed verdict pending reconciliation, not
a selection. **The trigger is exactly this, nothing weaker:** a
structural sibling still `missing-closure` or unverified triggers
nothing (an implementation MAY hold a local, non-authoritative
"fork suspicion"; it grants and denies nothing). Canonicality is
therefore **merge-revisable by construction**: a transition
individually valid and sole-sibling today (`accepted`, disposed
`canonical`) is re-disposed `forked` the moment its sibling is
admitted; admission verdicts never change, dispositions do (I14),
and the local canonical frontier shrinks to the siblings' common
ancestry (4.2). From the fork's visibility in a replica's held
DAG: **no *new* effect on either sibling or any descendant, all
authorization answers fail-closed, no eviction on either sibling's
claim (I4), and no canonicality claim toward anybody — while the
entries themselves keep replicating as evidence to the
evidence-authorized peers — the members of the maximal unforked
prefix** (I11; eviction is never bypassed), so every entitled
replica reaches the same fail-closed state instead of a silent
split. Services follow
with bounded delay through view freshness and view divergence, not
through fork detection of their own (7.4; since Access 0.31 the
companion says the same in §3.6 — the seam is word-aligned; the
window is a named residual bounded by `stalenessBound`, capped in
Section 9).

**The forked materialization (normative — what "fail-closed"
presents).** Access is precise here and this contract transcribes
it: effects already taken at their position are never revised by a
merge (Access §3.5), and the forked state is a *materialization
outcome* in which no side is current authority and the merged key
world is undefined (Access §3.6). Concretely, a replica in the
forked state:

1. answers every current-authority query fail-closed — neither
   sibling's effects are presented as the current state;
2. keeps the **maximal unforked prefix** queryable as the last
   canonical state — defined over the whole DAG, not per sibling
   pair: the materialization of the **maximal causally closed
   sub-DAG of accepted entries that contains no member of any
   enforcement-sibling pair and no descendant of one**. This is
   deterministic in the held DAG, keeps concurrent additive
   entries on the prefix inside it (Access's
   additive ∥ enforcement rule stands), and handles nested and
   late-arriving forks by construction — a sibling to an ancestor
   simply shrinks the sub-DAG further;
3. **retains, never reverts, and never presents** the effects
   already taken from a now-forked branch: they are queryable as
   branch-bound evidence ("taken under T₁, now forked"), not as
   state;
4. holds key material already produced as knowledge (nothing can
   be unlearned) and derives **nothing new** on either branch —
   the merged key world is undefined and this contract does not
   define it;
5. surfaces the condition (I8), and consumers of this port
   (Layer 4 included) MUST present branch-bound effects as
   historical evidence, never as current content.

Bytes and effects from before the fork's visibility are history —
this contract does not pretend to unsend or unmake them; it
promises that every conformant replica re-judges identically,
converges on this same forked materialization, and takes no new
effect from its own detection onward. Winner selection does not exist in this
contract and MAY only ever be introduced together with Access OI-1
as a coordinated Access re-cast; a future reconciliation is a
signed join entry (the Git lesson), OI-1 terrain (RO-1).
**Liveness residual, stated:** once two enforcement siblings
exist, this contract promises no resumption of enforcement; until
Access OI-1 resolves, conformant enforcement operation is
single-partition per group — a **binding registration
precondition**: an adapter registers `concurrencyScope`
(Section 9), and `single-partition` is the only registrable value
for enforcement in this version. **Fork-spam residual, named and
priced:** every admitted sibling is a fully valid enforcement
operation signed by an authorized member — accepted evidence,
part of the store, never evicted (7.1); an insider can mint many.
The cost falls on the attacker's own group, the artifacts are
attributable, and the group's answer is social (removal,
dissolution), not mechanical suppression.

**Class.** Replica (application and effect); the service side is
Access §7.3 obligation 5, incorporated via I7.

**Preconditions.** Two fully admitted sibling transitions in the
held DAG.

**Outcomes.** The forked state as samplable state (I8); per entry
the disposition `forked` and the projection `forked` (I14); exit
only by reconciliation (RO-1).

**Counter-vector.** T₁ arrives alone, is `accepted` and
`canonical`; its descendant D₁ is conformantly applied and
forwarded. T₂ (the sibling) arrives later and is admitted.
Conformant behavior: T₁, T₂, and D₁ are now disposed `forked`;
no further effect; authorization fail-closed; T₂ **appears in the
send set** toward peers that lack it; the samplable disposition of
T₁ has changed while its admission verdict has not. Nonconformant:
picking the smaller operation id and continuing effect
(winner-picking); withholding T₂ from peers "because forked"
(silent divergence); disposing `forked` on a `missing-closure`
structural sibling (trigger too weak); or claiming conformance is
impossible because D₁ "was already forwarded" — the promise binds
from detection, not retroactively.

## 6. Sessions and Source Authentication

A session is one authenticated exchange. Its authentication is the
precondition of every completeness artifact (Section 4) and every
authorization verdict (I7):

- **Replica ↔ service:** the service authorizes the replica by
  challenge-based proof of possession of a derived identity listed
  in the current accepted view (Access §7.3) — this identity is
  the **session principal**, and it is all the service ever
  authorizes (7.4); the replica authenticates the service against
  the exact-byte service identity of the group's registration
  (Access §7.3). Personal anchors are never presented to a service
  (Identity §7).
- **Replica ↔ replica:** mutual proof of possession of member
  identities; each side judges the other against its own
  materialized membership at its current head (P1), fail-closed
  under the forked state — with the one executable exception,
  word-aligned with Access 0.34 §3.6: an **evidence session** is
  authenticated by the same challenge-possession mechanism judged
  against the membership of the **maximal unforked prefix's
  materialization**; it reads and writes admitted evidence only —
  entries and admitted-scope targets — confers no authority
  standing, no content read or write, and no eviction effect, and
  its request set is closed to exactly that.

**The attestation key.** Every source that issues targets (4.1)
holds an attestation key; the session authentication MUST bind it:
for a replica source, it is (or is verifiably held by) the member
identity the session authenticated; for a service, **the group's
registration binds it** (Access 0.31 §7.3: the `attestationKey`
field of the 0.25 registration artifact, generation-chained) —
verifiable by every group member, stable across sessions by the
chain rule of 4.1; a service whose attestation key is not so
bound cannot issue targets, only unattested pages (4.4). The initial
binding is established at registration; every later change of the
key is **in-chain and cross-signed** (`keyRotation`, 4.1) — the
registration binding plus the cross-signature chain is the entire
verification story, and no out-of-band assertion (adapter
configuration included) ever substitutes for either. A source that
lost its current key takes the state-loss path (4.1:
re-registration). Session identifiers
MUST be fresh per session; targets and page delimiters bind to the
session; a source MUST NOT reuse a session's attestations in
another session (the per-source chain of 4.1 spans sessions; the
artifacts do not).

## 7. Ingest Admission

### 7.1 One admission, stated once

Admission is the single evaluation between "bytes arrived" and
"entry exists in replicated state". Per entry, in order:

1. **Shape:** profile form valid (3.4); the profile's signature
   verifies (content: header signature under `writer`; authority:
   envelope signature per Access §3.3); the id recomputes under
   the profile's id rule; size within the registered bound.
   Failure: `invalid` (terminal).
2. **Dedup and proof merge:** an already-held id produces no
   second effect; for authority entries the arriving proof
   evidence is merged into the held accumulator **first**, on
   every arrival (3.4.1), and held verdicts are recomputed after
   the merge. The arrival result is **disjoint by definition**:
   `proof-merged` iff the accumulator strictly grew, else
   `duplicate`. Only completed admissions count as held;
   previously rejected bytes are re-evaluated in full.
3. **Closure:** every parent admitted or admissible within the
   same evaluation (7.2); otherwise `missing-closure` — held,
   provisional, healable (repair per I12; the retryable state
   `awaiting-evidence`); never effect, never forwarding. An
   authority entry whose proof accumulator does not yet satisfy
   its rule is held in the same class (3.4.1).
4. **Validity — position-local only:** for authority entries, the
   P1 *validity* evaluation — Access §§3.4, 5.3 — under the
   materialized state of the entry's ancestry closure, and nothing
   wider. For content entries: the epoch binding and
   writer-membership-at-position checks of 3.4.2. Irreparable
   failure: `invalid` (terminal). Success: `accepted` (immutable).
   Validity evaluation is **never skipped or deferred for
   disposition reasons** — dispositions are computed over fully
   judged entries only.
5. **Disposition — the whole-DAG judgment:**
   `canonical | forked | removed-disposed` — the mapping of
   Access's canonicality and materialization outcomes (Access
   §§3.5, 3.6, its outcome rules included — the removal
   disposition over concurrent authorship among them) over the
   **entire held DAG of accepted entries**, recomputed on merge
   (I16): an accepted transition with an accepted,
   non-causally-ordered sibling of the same predecessor epoch, and
   every accepted descendant of either, is disposed `forked`; an
   accepted operation in the transitive removal-disposition set of
   Access §3.6 (the a/b/c/d′ closure) is disposed
   `removed-disposed`; everything else `canonical`. **The order is
   total — `forked` ≻ `removed-disposed` ≻ `canonical`** (an
   operation matching both non-canonical classes is `forked`), and
   transitions are closed under it: `forked` resolves only through
   reconciliation (RO-1), re-evaluated then against the reconciled
   DAG (`forked → removed-disposed | canonical`);
   `removed-disposed → forked` when an enclosing fork arises;
   `removed-disposed ↔ canonical` exactly per Access §3.6's
   rule-(c) evaluation point and d′ fixpoint (healing recomputes
   the fixpoint, so downstream operations heal with their cause). **Access §9.2's raw-state
   equal-verdict rule binds the pair of steps 4 and 5 together**:
   a replica ingesting raw substrate state reaches the same
   validity verdicts *and* the same dispositions as one fed
   through any API — neither step alone is the Access judgment.
6. **Effect:** only `accepted` ∧ `canonical`, and atomically where
   the entry is an enforcement artifact (I4). Forwarding: every
   `accepted` entry (evidence transport, I11).

**Precedence.** Terminal beats provisional: a trace establishing
`invalid` yields `invalid` whatever else holds. Verdicts (steps
1–4) are immutable per entry once assigned — except the healing
path `missing-closure → accepted | invalid` as evidence arrives —
and are **recomputation, never data** (I10): every conformant
replica reaches the same verdicts and dispositions for the same
held evidence, over any arrival order and any ingress road —
Access P1's raw-state clause (Access §9.2) applies to every
ingress form.

**Storage classes and their bounds.** Three classes, separated:

- **Accepted entries are the durable store.** They are never
  evicted by any bound of this contract — forked-disposed entries
  included (they are the group's divergence evidence, I16).
- **Held pre-accepted evidence** (`missing-closure`: absent
  parents or insufficient proof) is bounded **per source
  partition**: the adapter registration declares byte and count
  bounds per `(group, source)` **and a per-group total across all
  partitions** (many registered sources never multiply the
  replica's exposure past the total). **At the total bound the
  rule is refusal, never foreign eviction:** further held-class
  intake is refused (retriable) regardless of the delivering
  source's own partition headroom; no entry of another source's
  partition is ever evicted for it. Consequently the earlier
  "cross-source starvation structurally excluded" claim is
  retracted to what the partitions actually give: **isolation
  holds below the group total**; at the total, sources sharing a
  full group bound displace one another's *intake* (never held
  evidence) — a named residual (Section 11). **Charge rule
  (deterministic, per retention instance):** a held entry is
  charged to the source of its first delivery **of the current
  retention instance**, once; later arrivals of the same id from
  other sources add no charge (their proof evidence still merges,
  3.4.1). Eviction ends the instance and its charge; a later
  re-delivery opens a new instance charged to *its* first
  deliverer — one rule, one outcome, no provenance tombstones. Within a partition at its bound: intake of further
  held-class entries from that source is refused (retriable),
  except that intake MAY proceed by evicting held-class entries of
  the **same partition**, largest-first, ties by unsigned bytewise
  order of entry id. **The repair reserve, itself bounded:**
  entries referenced by an active repair run are exempt from
  eviction — for at most **one protected run per entry within the
  rolling `repair-reserve-window`** (a registered constant), and
  the reserve as a whole is capped by its registered byte and
  count bounds; an entry whose protection is exhausted is
  ordinarily evictable until the window rolls. Cross-source
  starvation is structurally excluded (partitions); a source can
  still starve its own partition, and an attacker can exhaust an
  entry's reserve — named residuals (Section 11). Evicted held
  entries are re-fetchable via repair once their closure heals.
- **Targets and equivocation evidence** are small signed
  artifacts, retained per 4.1; run records per I3.

### 7.2 Page evaluation

A page is evaluated as one **deterministic, causality-respecting
ready-set evaluation**: repeatedly admit every entry whose parents
are satisfied by held state or by already-admitted entries of the
same page, in topological order (ties broken by unsigned bytewise
order of entry id), until a fixpoint; the remainder is judged per
7.1 step 3. Wire order within a page carries no meaning; two
conformant implementations reach identical verdicts for any
permutation of one page.

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
empty rather than half-open. **Seam state, stated honestly:** the
Delivery-side mirror rule — a registered task type MUST NOT have a
direct replicated effect — is a planned Delivery §4.4 addendum
(decision record §5.2) and is **not yet carried by the pinned
Delivery 0.21**; until that addendum lands, the seam is closed on
this side only: the port-side rule above binds every conformant
replica, and it suffices for them — but a Delivery task
specification could still be written that is unimplementable in
combination with this contract. The addendum is the next scheduled
work after this contract (decision record §5.3).

### 7.4 The service-side (blind) admission

A service cannot evaluate validity and never needs to. Its
admission is: **session principal** authorized per the current
view (I7 — the entry's `writer` is never examined: the service
cannot know it, and authorized replicators forward foreign-signed
entries as a matter of course); shape and size bounds (3.1); dedup
by entry id; **quota** (Section 9: per-group and
per-session-principal byte and entry quotas, mandatory
registration fields with normative floors). Its verdict set:

`stored | duplicate | denied(no-standing) | refused(bounds) |
refused(quota) | evidence-saturated |
fail-closed(stale-view | divergence)`

**The fork and the blind service, honestly.** `forked` does not
appear in this set, because a blind service **cannot detect an
authority fork**: sibling transitions are entry bytes whose
validity it is forbidden to judge (that is the whole point of
key-blindness). The mechanisms that do close the service are
named: a forked group cannot issue a fresh canonical view, so the
**freshness window** ends the service's authorization at the
current view's `validUntil` (Access §7.3 obligation 3), and where
the split produces divergent views, obligation 5's divergence
handling fires. **The window between a replica-visible fork and
the view's expiry is a named residual, bounded by the registered
`stalenessBound`** — during it, an already-authorized principal
can still read and write entries at the service; every replica
judges those entries itself (7.1). Stated fully, the window buys:
download of held old ciphertext (readable with old keys already
held — knowledge honesty, Access §7.2), ingress of historically
positioned old-epoch content (the permanent-amplification
residual, Section 11), and service-quota occupation — never a
verdict, never a new epoch, never standing beyond `validUntil`.
The replication profile caps the window's length (Section 9:
`stalenessBound` ≤ P30D as a registration condition).

Quota refusal is deterministic (the quotas are registered
constants; headroom is a function of held state);
`evidence-saturated` is the storage analogue of Access §7.3's
saturation: at the registered per-group bound the service refuses
further intake for the group, retriable, evicting nothing — a
service never silently drops what it attested (4.1). **The
saturation residual, stated honestly:** a group's quota filled by
a principal that is later removed has **no in-contract
reclamation** — the stored entries were attested and stay; the
consequence is displacement of future legitimate writes at this
service ("retriable" then means: retriable elsewhere). The
recovery paths are outside this contract's machinery and are
named: the group re-registers at a fresh service
(trust-on-first-use again, Access §7.3), or the operator acts
outside the contract; verifiable compaction is deferred (RO-4).
This is the same residual family as the delivery-side admission
resource (decision record §5.2). The control plane stays open
throughout (I7). A service verdict is a storage verdict, **never**
a validity claim — poison that an authorized principal stores is
caught by every replica's admission (7.1), reflected as
`unadmissible(set)` against that service's `stored`-scope targets
(4.3), and standing itself is revoked by the next view (I4
eviction). This two-sided cut is the structural successor of the
previous generation's carrier-side type whitelist (Section 11).

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
- the **target and page encodings** (4.1) — how targets, restarts,
  and page delimiters travel;
- the **discovery mechanism** for rebinding (I15), and whether
  **ack receipts** are persisted and recoverable (I15, RO-6);
- the **durable store** boundary and crash model that I9's
  `durable` binds to (target-chain state included, 4.1);
- the **quotas and bounds** (7.1, 7.4), including the
  **service-wide capacity**: `maxGroups` and a global byte bound
  satisfying `global bound ≥ Σ (registered floor of every
  accepted group)` — the floor is thereby **logically reserved**:
  ordinary admission for one group can never consume another
  accepted group's unreached floor, and a registration that would
  break the inequality is refused with the honest closed outcome
  `registration-refused(capacity)` (floor ≠ quota: the floor is
  what capacity must reserve, the quota is where refusal begins;
  no physical preallocation is demanded);
- the declared constants: `repair-horizon` (I12),
  `repair-reserve-window` (7.1), run-record minimum retention
  (I3), and the closed `aborted` reason set (4.3);
- the **snapshot profile**, where one exists (none in this
  casting — RO-2).

**Constant domains (normative).** Every registered constant and
quota declares a value from a closed domain — type, unit, range —
with these floors, so no registration can hollow a promise while
claiming not to "weaken" it: entry size bound ≥ 65 536 bytes and
finite; per-group service quota ≥ 256 × the entry size bound;
per-principal service quota ≥ 16 × the entry size bound;
held-evidence partition bound ≥ 16 entries and ≥ 16 × the entry
size bound, per-group held total ≥ 4 × the partition bound;
repair-reserve byte/count bounds ≥ one partition bound;
`repair-horizon` a finite duration in [PT10S, P30D];
`repair-reserve-window` a finite duration in [PT1M, P7D];
run-record minimum retention ≥ PT1H; `maxGroups` ≥ 1 and finite.
**And one cap on an Access-side value:** a service adapter under
this contract MUST NOT accept a registration whose
`stalenessBound` exceeds **P30D** — Access's duration profile
admits values near three years, and the blind-service fork window
(7.4) is exactly as long as this bound, so the replication
profile caps what it will amplify.
Registered values are deployment-local; two deployments with
different values are different profiles, not a divergence.

A registration MUST NOT weaken any promise of Section 5; where a
substrate cannot carry a promise, the adapter carries it above the
substrate or the substrate is not admissible (Access §9.1 names
the floor). Every adapter carries the target-control overlay of
Section 4 in addition to whatever data-plane sync it reuses (1.3,
door 5).

## 10. Candidate Substrates (informative; per component, sources as of 2026-08)

The honesty companion of 1.3, judged against the five doors (D1
signed causal DAG · D2 atomic enforcement · D3 view-shaped
authorization · D4 fail-closed concurrency · D5 target-control
overlay) plus bounds/saturation (B): **native** — the component
carries it; **adapter** — an adapter above it must; **excluded** —
a current property contradicts the door.

| Candidate (component, state) | D1 | D2 | D3 | D4 | D5 | B | Notes |
|---|---|---|---|---|---|---|---|
| `linear/0.1` (Access §9.6, normative reference) | native | native | native | native (single-lane: no siblings by construction) | native | native | the interim scope until OI-1 |
| **p2panda** (core + auth + encryption, 2025 releases) | native (append-only logs, causal refs) | adapter (RLTP enforcement artifact + commit) | adapter | adapter (needs the pinned RLTP resolver — a *replaceable* resolver is the hook, not the satisfaction: different resolvers reach different verdicts) | adapter | adapter | auth/encryption components (PCS/FS-capable) sit above this port in the TCB per deployment cut; browser story open |
| **Keyhive/BeeKEM** (Ink & Switch notebook, 2025) | native | **excluded today** — RLTP authority-claim+transition atomicity absent (correction from round 1 stands: removal *does* blank leaf+path; the gap is P2-shaped commits, not "lazy removal") | adapter | adapter (P1 injection point missing) | adapter | adapter | both gaps are concrete contribution targets |
| **SECSYNC** (repo state, 2025) | adapter (its snapshots/updates need the entry profiles) | **excluded today** for the authority log — snapshot-centric ingest meets an empty snapshot registry (RO-2) | adapter (authorization optional/external; server can exclude undetected) | adapter | adapter | adapter | native gaps honest: key distribution/rotation out of scope |
| **NextGraph** (docs, 2025) | port-dependent: internal broker sees commit headers (DAG servable); external protocol strips them (closures unservable on that cut) | adapter | adapter (thick: view ↔ own repo/permission/quorum model) | adapter | adapter | adapter | verifier decrypts → TCB adapter, correctly; an adapter must name which NextGraph port it binds |
| **Automerge / classical local-first sync** | adapter | n/a (data plane only) | adapter | n/a | **the defining case of door 5**: have/need + Bloom sync run below the overlay; without it = the unattested profile (4.4), pages, never `reached` | adapter | session auth, targets, chain: all overlay duty |

None is a conformant adapter today; the named gaps are concrete,
scoped contribution targets, and the port is shaped so each could
become an adapter without changing this contract.

## 11. Security Considerations

- **What removal cuts — and the two named residuals.** A removal
  cuts, structurally: **standing at services** (the next view no
  longer lists the removed member's identity — writes and reads
  fail-closed, I7/I4); **every future epoch** (key world, Access
  §7.1/§7.2); and nothing anonymously — every entry is signed and
  attributable (3.4).
  **Content residual (decided, round 1):** a causally pre-removal
  **content** entry remains admissible forever, and a removed
  member who still holds pre-removal keys can construct such
  entries after the fact — byte-indistinguishable from an honest
  offline write arriving late (the wot#232 family is the field
  proof that honest late arrivals are real and must not be lost).
  **The determinism theorem behind it:** any admission rule that
  varies with arrival time relative to local state violates P1's
  raw-state equal-verdict requirement (Access §9.2). The residual
  is bounded in *authority*: no access to any post-removal epoch,
  no service standing, full attributability; a replica MAY surface
  "arrived here after the removal" as local knowledge (I10 — never
  verdict-relevant, never replicated). It is **not** bounded in
  *storage*, and that is stated (the SSB lesson): a former member
  can mint unboundedly many historically positioned content
  entries — each valid at its causal position, each `accepted`,
  each store-permanent (7.1). This permanent-amplification
  residual is priced (old epochs only, fully attributable,
  colluder- or import-dependent for ingress) and unmechanized in
  0.x: any cut would need an authoritatively bound per-writer
  frontier — candidate work (RO-9), not a rule this contract can
  conjure.
  **Authority entries (decided, round 2 — the editor's
  author-removal-prevails rule):** the same retro-positioning
  applied to an *additive authority operation* — a removed member
  back-dating a `member.add` of a puppet onto a pre-removal head —
  would, under Access 0.30 §3.6 alone, merge as a member with a
  re-welcome duty and thereby regain post-removal epoch access.
  The decided rule closes it, and its set is byte-checkable
  (review-3 sharpening): a removal prevails over exactly
  (a) concurrent additive operations whose **`author`** is the
  removed member, and (b) concurrent admissions whose consumed
  invite the removed member **issued** — "their pending invites
  and admissions fall with them" (the MLS doctrine: a commit that
  removes a member kills their open proposals). It does **not**
  automatically void (c) operations authored by others where the
  removed member is merely one of several proof signers — those
  stand iff their proof still satisfies the policy without the
  removed member's signatures, and otherwise fall by their own
  proof shortfall; (d) descendants ride the existing same-subject
  mechanics of Access §3.6, never a revived cascade. Deterministic,
  arrival-time-free, an extension of Access §3.6's existing
  enforcement-prevails family. **Discharged: since Access 0.31
  this is the companion's own normative removal disposition over
  concurrent authorship (§3.6, the a/b/c/d set verbatim — with
  (c) correctly categorized as a disposition, never a
  proof-shortfall re-evaluation; §3.5 untouched).** **Why the debt is not an open hole in this
  version:** under `concurrencyScope = single-partition` — the
  only registrable enforcement scope (I16, Section 9) — no
  concurrent enforcement branch exists to merge: in the total
  order, a removed member's later-constructed operation sits
  *after* the removal, where they are no longer a member, and is
  `invalid` at step 4. The Access re-cast is therefore due before
  OI-1 opens multi-partition enforcement, and is recorded as its
  precondition.
  The previous generation closed this whole door with a carrier
  type whitelist — and paid with carrier extensibility, a shared
  capability secret, and no attributability; its gate also only
  ever guarded one road. This contract closes artifact-shaped
  what is closable and names what is not.
- **TOCTOU on authorization.** A service acting on live-read
  foreign truth was the field's stale-authorization class. Views
  are presented, chained, freshness-bounded, and fail-closed in
  both directions (I7); within one epoch the authorized set only
  grows (Access §7.1), so a slightly stale view never grants what
  the log revoked.
- **Source equivocation is provable — detection is opportunistic,
  and that is stated.** The per-source chain (4.1) turns a
  split-view into signed artifacts that convict their signer
  wherever they meet. **A source cannot reset its way out**: key
  rotation is in-chain and cross-signed, and state loss ends
  target issuance until the group itself re-registers the service
  — a self-declared restart authorizes nothing (4.1; the
  CT doctrine). What this version does not promise is *guaranteed*
  meeting: witness/gossip duties are deferred (RO-8), and until
  then "never silently diverging" holds where evidence flows (I11
  makes it flow among connected replicas), not against a source
  that perfectly partitions its consumers forever.
- **Insider fork is denial of service, never authority gain.** A
  malicious authorized member can force the forked state (I16);
  it is fail-closed, attributable, and surfaced (Access §3.6) —
  and its evidence reaches every replica (I11), so the group
  fails closed together. Winner-picking anywhere — including
  "just locally, just for liveness" — converts that DoS into
  potential authority theft and is forbidden. The liveness price
  and the fork-spam residual are stated in I16.
- **Amplification and exhaustion are bounded by named constants —
  and the permanent-saturation residual is named.** Authorized
  floods meet per-principal and per-group quotas with
  deterministic refusal (7.4); held-evidence floods meet
  per-source partitions with a repair reserve (7.1) —
  cross-source starvation is structurally excluded, self-partition
  starvation and post-removal quota occupation are named residuals
  (7.1, 7.4); view-path work is bounded by Access §7.3's evidence
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
  dedup can never starve a quorum, and signature bytes excluded
  from identity (3.4.2), so a signer cannot mint id multiplicity.
- **The port stands outside the TCB** (3.3): nothing in this
  contract makes a substrate operator safe to trust with keys,
  because nothing ever hands them any.

## 12. Privacy Considerations

- **What a service sees:** the group's genesis digest, derived
  service identities from presented views (never personal anchors
  — Identity §7), and the **content-entry header** (3.4.2):
  per-group writer identities, epochs, parent-graph shape, sizes,
  timing. This is the price of artifact-shaped verdicts, and it is
  bounded by identity discipline: the writer identity is the
  per-group member anchor of Access §5.1, correlatable within the
  group's service relationship, not across groups; the service
  additionally cannot join writers to session principals beyond
  observing sessions (the member↔service-identity mapping stays
  inside the encrypted log). The previous generation's relay saw
  more with less protection (account DID, device ids, doc ids,
  sequence numbers — unsigned). It never sees payload plaintext,
  document types, or reader behavior.
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

- **Profile** `rltp-replication@0.8`; companion pins per the
  header.
- **Classes:** *replica* (Sections 3–9 in full) · *service*
  (Sections 3, 4, 6, 7.4, and I1/I3/I6/I7/I8/I9/I12/I13/I15 in
  their service roles). Adapters are below the line and conform
  through their registration (Section 9). I6 and the TCB boundary
  are audit criteria (Access §9.1's class); everything else is
  trace-testable.
- **No shipped schemas in this casting.** The two canonical
  signature inputs this contract defines (the content header
  3.4.2, the target with restart 4.1) are normative as JCS field
  sets; their wire encodings and everything else are
  adapter-registered (Section 9). Schema shipment becomes due with
  the first adapter registration (RO-3).
- **Trace-vector plan** (each vector is a trace plus the required
  verdicts; the sixteen counter-vectors of Section 5 are the
  floor):
  - page-without-target → pages only, no completeness claim
    (I1/4.4);
  - proof-merge convergence: two individually insufficient proof
    variants of one operation, either arrival order → held, then
    valid after merge; dedup never suppresses the merge (3.4.1);
  - signature-malleability: one header, two valid signatures →
    **one** entry id, `duplicate` on the second arrival (3.4.2);
  - content-header binding: same payload under two headers
    (different parents/epoch/writer) → two ids, both judged
    independently; no metadata equivocation representable
    (3.4.2);
  - epoch forgery (claimed epoch ≠ position epoch) → `invalid`;
    non-member writer at position → `invalid`; pre-removal
    positioned content entry of a removed member → `accepted`
    (the named residual, Section 11); retro-positioned authority
    operation under `single-partition` → `invalid` at its
    position (Section 11);
  - out-of-order epoch content within a page, both permutations →
    identical verdicts (7.2, I2);
  - overlapping runs, crash between them → two run records, two
    terminals (I3);
  - crash inside an enforcement artifact → atomic both-or-neither
    (I4);
  - the three predicate stages, each relative to its target and
    scope; a later target supersedes without retro-invalidation
    (I5, 4.1);
  - removed member's read and write against a stale view → both
    fail-closed; reconciliation view still admitted while
    fail-closed (I7);
  - late-attaching consumer samples every promised condition,
    including after restart; every sampled field honors its
    closed transition set (I8);
  - durable-report crash-safety, target-chain state included
    (I9, 4.1);
  - replicated reader-state / run-record attempt → structurally
    rejected (I10);
  - crash-and-restart send-set recomputation as admitted-closure
    difference; fork evidence included (I11);
  - gap repair: evidence-carrying request; every outcome of 4.3
    exercised under its precedence; unreachable source →
    `awaiting-source`, samplable; run unterminated past
    `repair-horizon` → nonconformant (I12);
  - a port interface demanding per-entry durable transactions →
    nonconformant; page-granular commit satisfying I9 (I13);
  - delivery-effect ingress through admission; direct-write
    attempt caught; snapshot ingest refused (I14, 7.3);
  - arrival result vs entry state: first arrival → `accepted`
    projection while the entry state is `accepted∧canonical`;
    re-arrival → arrival `duplicate`, entry state unchanged;
    proof-bearing re-arrival → arrival `proof-merged`, entry state
    may heal (I14, I8, M-1 class);
  - rebind matrix: `(stable-id, source proof, attested target,
    ack evidence | none)` × all outcomes; evidence judged against
    closure(F), not F; no fabricated loss claims; run key =
    `sourceSetDigest` (I15, I3);
  - sibling transitions, late-arrival order: first `canonical`
    then both `forked`, dispositions revised, verdicts unchanged,
    effect stopped, **T₂ in the send set**, authorization
    fail-closed; a `missing-closure` structural sibling triggers
    nothing (I16, B-5/B-6 class);
  - source-equivocation: two signed targets, same
    `(source, group, chain, seq)`, different heads → fail-closed
    toward the source, evidence retained and transportable;
    equivocation proof arriving during `awaiting-source` →
    immediate terminal `source-equivocation` (4.1, 4.3);
  - chain continuity: in-chain `keyRotation` with valid cross-sig
    → chain continues under the new key; claimed rotation without
    cross-sig → not a rotation, targets unverifiable; state loss →
    no further targets, runs end `target-chain-unavailable`, pages
    still legal; resumption only after group re-registration, ack
    evidence judged against both chains; a self-declared restart
    without re-registration → no target standing; periodic
    "state-loss resets" never regain serving standing by
    themselves (4.1, B-1/B-2 class);
  - forked materialization: after a late sibling, current-authority
    queries fail-closed, the unforked prefix queryable as last
    canonical state, branch effects queryable as evidence only,
    no new derivation on either branch — one defined state, not
    three implementations (I16, B-4 class);
  - service capacity: a registration beyond `maxGroups`/global
    bound → `registration-refused(capacity)`, never silent
    under-service (§9, 7.4);
  - precedence totality: goal achieved + incidental extra
    unadmissible entries → success, extras stay per-entry
    verdicts; equivocation + local abort in one step →
    `source-equivocation`; rebind with both conflict grounds →
    `conflicting-sources` ≻ `entry-not-in-closure` (4.3);
  - repair-reserve exhaustion: perpetually renewed runs cannot pin
    an entry past its window's one protected attempt; charge rule:
    the same id from a second source adds no partition charge
    while its proof still merges (7.1, M-2/M-3 class);
  - quota and saturation: deterministic `refused(quota)` /
    `evidence-saturated`, control plane still open, nothing
    attested evicted; post-removal occupation → displacement
    surfaced as the named residual (7.4);
  - held-evidence partitions: flood from source A never evicts
    source B's held evidence; repair-reserve entries survive
    eviction pressure (7.1);
  - blind service admission: session principal authorized, writer
    never examined; foreign-signed entries uploaded by an
    authorized replicator → `stored`; authorized poison `stored`
    at the service, `invalid` at every replica,
    `unadmissible(set)` against the service's `stored`-scope
    target (7.4, 4.3).

## 14. Open Issues and Coordination Debts

- **RO-1 — Fork reconciliation.** Exit from the forked state is
  Access OI-1 terrain; a reconciliation will be a signed join
  entry binding both sides (the Git lesson). Until it resolves,
  `concurrencyScope = single-partition` is the only registrable
  enforcement scope (I16, Section 9) and I16 is forked-only.
- **RO-2 — Snapshot profiles.** The registry ships empty. The
  registration bar is P1's equal-verdict rule — validity **and
  canonicality** — over snapshot input.
- **RO-3 — Wire encodings and schemas.** The content header
  (3.4.2) and the target (4.1) are normative as canonical JCS
  field sets; wire encodings are adapter-named. With the first
  adapter registration, shipped schemas and vectors become due;
  with the second independent adapter, a common normative
  encoding becomes a candidate.
- **RO-4 — Published service constants and compaction.** Whether
  quotas/bounds deserve cross-deployment registry publication
  (the Delivery §4.4 `registry-declaration` pattern), and whether
  a verifiable compaction can relieve the permanent-saturation
  residual (7.4), are deferred to adapter evidence.
- **RO-5 — Key-regime neutrality.** The personal group's declared
  key regime (root-derived epochal / independent-keys) is Access
  and Identity terrain. This contract's only stake is stated in
  I6, I15, and 3.3: nothing at or below the port line assumes
  derivability of any key, and the stable group identity is never
  derived from key material — both regimes replicate identically.
- **RO-6 — Ack receipts.** I15's loss-detection evidence is
  adapter-declared in persistence and recovery; a normalized
  receipt artifact is a candidate for a later casting once
  adapter evidence exists.
- **RO-7 — The content payload seal.** The header profile (3.4.2)
  is deliberately payload-opaque; the sealing construction (which
  epoch key, AAD binding to `{group, epoch, payloadDigest}`) is
  coordination terrain with Access §7.1/§9.5 and the future
  Layer 4 — named here so the debt is visible, constrained here
  only by I6 (the port never needs the answer).
- **RO-8 — Witness rules.** Turning provable source equivocation
  into *guaranteed detection* needs mandatory comparison duties
  (witnesses, gossip rounds, or checkpoint cross-signing).
  Deferred until adapter evidence shows where the comparison
  naturally rides.
- **RO-9 — Per-writer accountability.** An authoritatively bound
  per-writer sequence (the SSB lesson) would make writer
  equivocation visible and could bound the historical-minting
  amplification residual (Section 11). Any such cut must itself be
  authority-bound (a removal-carried writer frontier) and is
  Access-coordinated candidate work, not a 0.x rule.

**Coordination debts (recorded decisions, owed elsewhere):**

1. **Discharged (Access 0.31, 26.08.2026):** the removal
   disposition over concurrent authorship, the evidence-transport
   rule, the service fail-closed wording, and the registration
   generation with attestation-key rebind all landed in the
   companion (`design/access-031-nahtguss-plan-2026-08.md`); this
   contract now pins Access 0.31 and the seam texts above cite
   it. What remains Access-side is OI-1 itself (RO-1).
2. **Delivery §4.4 addendum** — registered task types must not
   have direct replicated effects (decision record §5.2); the
   seam is port-side-only until it lands (7.3).
3. **Layer 4 / Access:** the content payload seal (RO-7) and the
   semantic composition of documents from entries.

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
| Targets (Section 4) | none — completeness was inferred from silence (rls#274); the attested chain and its honest restart are new |
| I11 log as send-truth | outbox resend loop class |
| I9 transaction-bound gates | acked-but-not-durable loss class |
| I16 forked | no counterpart (single relay total order) — `linear/0.1` is that honesty as an adapter |

## Appendix B (informative): field provenance of the promises

Round-3 sharpenings (chain continuity and re-registration, the
forked materialization, precedence totality, the arrival/state
split, provenance charging, reserve bounds, service capacity, the
byte-checkable author-removal set) are recorded with their attacks
in `design/replication-review3-2026-08.md`.

| # | Provenance |
|---|---|
| I1 | multi-device silent loss family (wot#232); decision seam 4; R1 B-5 (`unadmissible`) |
| I2 | two-channel rotation race (Sync 001/003 key-rotation inbox type); Access P2/§7.1; R1 M-1 (page order) |
| I3 | unpaired sync-run reporting (wot#346); R1 M-2 (normative trigger, retention); R2 m-1 (sourceSetDigest) |
| I4 | Access P2/§5.3 commit-before-forward; decision seam 1; R1 M-4 (adapter carries the key world); R2 B-6 (forward = evidence transport) |
| I5 | false `complete: true` (rls#274); wot#343/#344; R1 B-4/m-1, R2 B-6 (scopes; canonical never attested) |
| I6 | key-export prohibition lesson (wot#306); decision seam 3 |
| I7 | stale-authorization TOCTOU (wot#289); capability-seed family (wot#234); R1 M-4 (control plane open); R2 B-2 (session principal) |
| I8 | state-vs-edge gate lesson (wot#288, gate 3); R1 M-2 (enumerated scope); R2 M-5 (evidence-determined, closed transitions) |
| I9 | durability gate losses (wot#328, wot#193); R2 B-4 (chain state in the boundary) |
| I10 | local/replicated coupling (wot#285); devices-table terminality |
| I11 | outbox loop (wot#236, wot#245, wot#249); R1 M-5 (defined send set); R2 B-6 (admitted scope, evidence flows) |
| I12 | gap-repair gate (wot#288, gate 2); R1 M-3, R2 B-8 (one algebra with precedence) |
| I13 | cold-start scale measurement (wot#353: 8 990 `importKey`); R1 M-5 (ceiling form) |
| I14 | decision-pair B-6 + whitelist genealogy (Sync 003 §Relay-Whitelist); R1 B-1/B-7, R2 M-4 (verdict/disposition split + projection) |
| I15 | acked-log orphan after migration (register §C); decision-pair M-5/M-2; R1 B-6, R2 B-8 (evidence-bound, algebra variants) |
| I16 | decision-pair B-5/B-4; Access §3.6; MLS comparison; R1 B-7/M-6, R2 B-5/B-6/B-7 (trigger, evidence flow, storage of fork evidence) |

## References

[RFC2119] · [RFC8174] BCP 14 · [RFC8785] JCS · RLTP Access Layer
0.34, wire 0.24 (§§3.2, 3.3, 3.4, 3.6, 5.1–5.4, 7.1–7.3, 9, 10) ·
RLTP Identity Layer 0.12 (§7) · RLTP Delivery Contract 0.21
(§§4.4, 6) · RLTP Membership Tasks 0.16 · RLTP Encounter Layer
0.28, wire 0.25 (§2.3 interim securing profile) · Decision record:
`design/portvertrags-paar-entscheide-2026-08.md` (Revision 2);
casting reviews: `design/replication-review1-2026-08.md`,
`design/replication-review2-2026-08.md` (with triages) · Sync
001/003 (superseded transport specs, Appendix A) · MLS: RFC 9420,
RFC 9750 (I16/liveness; the removed-proposals doctrine,
Section 11) · Certificate Transparency: RFC 6962, RFC 9162
(equivocation-evidence rationale and its limits, 4.1) · Candidate
substrate documentation per Section 10.
