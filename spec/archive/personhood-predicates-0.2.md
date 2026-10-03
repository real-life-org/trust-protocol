# RLTP Personhood Predicates

**Real Life Trust Protocol — verifier-relative witnessing predicates**

- **Status:** Editor's Draft
- **Version:** 0.2.0-draft (second casting)
- **Editors:** Anton Tranelis
- **Date:** 2026-08-13
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Conformance profile:** `rltp-predicates@0.2` (draft)
- **Position:** a consumer of the **RLTP Encounter Layer 0.22**
  (normative reference: credential form §7, evidence direction and
  counting rule §4.2, enactment binding §5.4, pair honesty §8, Sybil
  economics §13). P3 additionally consumes a materialized group
  snapshot from the **RLTP Access Layer** (currently 0.25). This
  document defines **evaluation**, not transport: nothing here
  travels; the presented set reaches the verifier by any channel.
- **Supersedes:** version 0.1.0-draft (archived as
  `archive/personhood-predicates-0.1.md`).

## Abstract

This document defines how a verifier evaluates **recognition
assertions** — encounter credentials presented by a subject — into
three measures: how many of the asserting anchors the verifier
already knows (P1), how far back those assertions reach in time
(P2), and how many asserters a named group's own admission
discipline vouches for (P3). Evaluation is a deterministic,
stateless, **clock-free** function from a defined input model to a
defined result model; it consults no network, no registry, and no
wall clock.

The name of this document names the **need** it serves — evidence
of personhood where no authority is in reach — not a claim any
predicate makes. No predicate here says *"this is a human,"* and no
predicate here proves *a meeting took place*: a credential in a
third party's hands is a **signed assertion of recognition**, and
its weight is exactly the weight of the anchor that signed it
(Encounter §8). Each measure says: **"from this verifier's
standpoint, with the roots it names, this anchor is asserted
thus."** Personhood evidence in RLTP is verifier-relative and
graph-rooted, where issuer-rooted systems make it absolute and
certificate-shaped. Both the strength and the limit of that choice
are stated in this document, in the same breath.

## Status of This Document

This is an **Editor's Draft** with no standing beyond its own
argument, the second casting of this document. It is developed
through the same adversarial convergence process as the other RLTP
documents (casting, independent adversarial review, full recast —
never a patch); the first casting drew seven blocker-level findings,
answered by this recast. It has not yet completed its own round.
The document will change; known open questions are collected in
Section 10. Feedback is welcome via the issues of the publication
repository (github.com/real-life-org/rltp-spec).

## 1. Introduction (informative)

### 1.1 The two structural facts

Everything here follows from two properties of the RLTP encounter
graph:

**The graph is nowhere.** No global view, no directory, no
crawling. Every person holds their own edges; a verifier learns of
a subject's edges only because the subject **presents** them. This
is a presentation model, not a lookup model: disclosure is the
subject's controlled act, a verifier can anchor its judgment only
in roots it already holds, and every step beyond the first edge
would disclose edges of third parties who were never asked — the
hard boundary that decides which predicates can exist at all
(Section 7).

**Trust does not propagate.** No transitive computation, no
introducer model, no trust depth. An edge is one anchor's signed
recognition of another; what a *set* of edges means is decided by
the **verifier's policy**, never by the graph. This document
defines *measures*, not *thresholds*.

### 1.2 What a presented credential is — and is not

Inside an enactment, the Encounter layer's gates (records,
challenges, issuance windows) bind a credential to a live exchange
— for the two participants. **None of that travels.** A third party
holds no enactment record and cannot check one (Encounter §5.6 is
participant-local by design). What a third party can verify is
exactly this: *an anchor signed a recognition of this subject,
following the credential form*. Where the subject also presents its
own matching step credential of the same enactment, the third party
can additionally verify that *both* anchors signed consistently
(the `mutual` quality, Section 4.1) — which is still not proof of a
meeting, and Encounter §8 says so in as many words. This document
therefore speaks of **assertions** throughout, and every measure's
strength reduces to the trustworthiness of the asserting keys.

### 1.3 Relation to issuer-rooted personhood

Issuer-rooted systems bind a boolean to a person: an accredited
issuer certifies humanity, governance ensures it happens once. That
serves strangers — anyone can check the boolean — and it stands or
falls with accreditation and global uniqueness, which are hard open
problems. The predicates here claim no uniqueness and need no
issuer. They serve **acquaintances**: a verifier that already holds
roots — its own encounter history, a group it belongs to — learns
something real about a subject asserted by them. A verifier with no
roots learns nothing, correctly. Most real trust decisions are
taken among acquaintances; that is the ground this document stands
on, and its honest boundary.

## 2. Conventions and Terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY",
and "OPTIONAL" are to be interpreted as described in BCP 14
[RFC2119] [RFC8174] when, and only when, they appear in all
capitals.

The **interim securing profile** of Encounter §2.3 applies to every
document evaluated here. Timestamps compare as instants (RFC3339
UTC, per that profile); this document never derives durations.

**Subject** — the anchor whose assertions are being evaluated.
**Verifier** — the party evaluating. **Asserter** — the issuer of
an encounter credential about the subject; called *witness* only
informally. **Incoming credential** — issued *by* an asserter
*about* the subject (Encounter §4.2); the only direction that is
evidence about the subject. **Presented set** — the input
collection of credential documents (3.1); deliberately not named
"presentation" — the Access layer's `encounter-presentation` is a
different, operation-bound artifact. **Known-anchor set (K)** — the
set of anchors the verifier already associates with people it has
reason to treat as distinct; its curation is the verifier's
responsibility and P1/P2's entire root (Section 8). **Group
snapshot** — a materialization of an Access group that the verifier
itself holds, identified as in 3.3. **Edge record** — the
per-asserter unit every measure is computed from (4.1).
**Measure** — a deterministic value over edge records. **Non-result**
— a named outcome from the closed set of 5.3, distinct from any
measure value.

## 3. The Input Model (normative, abstract)

Evaluation is a pure function of the following input; no other
information may influence any measure.

### 3.1 The presented set

A finite set of candidate documents, deduplicated by **document
digest** (byte-identical documents are one document). Bounds: at
most **1024** documents per evaluation; each document at most
**2048 bytes** in its JCS serialization (the Encounter credential
cap). Exceeding either bound yields the non-result
`input-too-large` for the whole evaluation — bounds are checked
before any expensive validation.

### 3.2 Parameters

The subject anchor; the known-anchor set K (possibly empty); zero
or more group snapshots (3.3); optionally a possession proof (3.4).

### 3.3 Group snapshots (for P3)

A group snapshot is the verifier's own materialized state of an
Access group, identified by `(genesisDigest, epoch, position
identifier)` — the position identifier is whatever the verifier's
Access implementation uses to name its materialized heads; it is
carried into the result verbatim and never interpreted here. The
membership used is the **policy currency** at that snapshot —
pending exits excluded — aligning P3 with the Access layer's own
`encounter` rule semantics. A snapshot in the `forked` or
`terminal` state, or a group the verifier cannot read, yields the
corresponding non-result (5.3); *unreadable is not zero*.

### 3.4 The possession proof (profile)

Predicates evaluate evidence about an **anchor**. Whether a live
counterparty controls that anchor is a separate proof, REQUIRED
whenever a verdict attaches to a present counterparty rather than
to a stored anchor:

- the verifier generates a **challenge**: single-use, ≥ 128 bits of
  entropy, never reused across evaluations;
- the counterparty returns an Ed25519 signature by the subject
  anchor over the UTF-8 bytes of the JCS serialization of
  `{ "challenge": <the challenge>, "audience": <the verifier's
  identifier as it stated it>, "subject": <the subject anchor> }`,
  prefixed by the domain separator **`rltp/v1/possession`**;
- the verifier MUST verify the signature, the audience (itself),
  and the subject binding, and MUST NOT accept a challenge it did
  not itself issue for this evaluation; a seen challenge is
  consumed.

The result records possession as one of `proven` / `not-attempted`
/ `failed` (5.2). Conflating possession with assertion evidence is
the classic mistake this section exists to prevent.

### 3.5 Admission of candidate documents

Each candidate is classified independently, in this order, with the
first failing step naming the **exclusion reason** from the closed
set: `oversize` · `invalid-document` (Encounter §7 validation:
schema, proof under the issuer's anchor, decoded keys, pinned
context) · `not-yet-valid` (`validFrom` later than every other
admitted timestamp comparison is deliberately impossible — a
credential whose `validFrom` is in the issuer's asserted future
relative to nothing is admitted; see honesty note below) ·
`wrong-subject` (subject anchor ≠ the evaluated subject) ·
`self-issued` (issuer = subject; outgoing credentials are no
evidence about the subject, Encounter §4.2).

*Honesty note on time at admission:* the evaluator holds no clock,
so it cannot reject "future" timestamps; it admits them and reports
them as what they are — timestamps. The `not-yet-valid` reason
exists for consumers that re-run admission **with** a clock in
their own policy layer; the core evaluation never uses it.

Documents surviving admission are **admitted**; the rest are
**excluded** with their reason. Exclusions MUST NOT fail the
evaluation (a presented set claims *at least*, Section 6).

## 4. Edges and Measures

### 4.1 The edge model

From the admitted documents, the evaluator builds **one edge record
per distinct asserter anchor**:

```
edge := { asserter, earliestValidFrom, mutual, documents }
```

- `asserter` — the issuer anchor;
- `earliestValidFrom` — the minimum `validFrom` over that
  asserter's admitted documents (an edge began when its first
  assertion says it began);
- `mutual` — `true` iff the presented set also contains an admitted
  **outgoing** document of the subject *about this asserter* whose
  **enactment binding equals** that of one of the asserter's
  admitted documents (Encounter §5.4). Outgoing documents serve
  *only* this flag; they are never edges. Mutuality upgrades an
  edge from *one anchor asserts* to *both anchors assert,
  consistently* — Encounter §8's exact honest reading, and still
  not proof of a meeting;
- `documents` — the admitted documents collapsed into this edge
  (count reported; additional documents beyond the first are state
  `collapsed`, neither admitted-counted twice nor excluded).

Edges are a set keyed by asserter: deterministic for any input
order, any duplication, any mix of valid and invalid documents from
one asserter (invalid ones were excluded independently in 3.5 and
never poison the asserter's slot). **Every measure is a function of
the edge set and nothing else.** This is Encounter §4.2's rule —
*counts edges, never credentials or enactments* — made structural.

### 4.2 P1 — Known-asserter count

> **P1(K)** = |{ edges e : e.asserter ∈ K }|

*"n of the anchors asserting this subject, I already know."*
Distinctness is **anchor**-distinctness and nothing more: one
person holding several anchors in K counts once per anchor
(Section 8). Anchors outside K contribute nothing — anchors are
free to create, edges among unknown anchors are free to
manufacture; what is expensive is an assertion signed by a
**specific, known key** (Encounter §13). P1's root is K, entirely.

### 4.3 P2 — Temporal depth

> **P2(K)** = the multiset { e.earliestValidFrom : e.asserter ∈ K }

*"the assertions I can anchor reach back to these instants."* P2
returns **timestamps, never ages** — evaluation is clock-free;
turning instants into durations is the consumer's act with the
consumer's clock. Consumers thereby express robust policies over
the whole multiset ("at least m entries older than T"), which no
single stolen key can satisfy alone.

Stated honestly: a backdated entry requires the **signing key** of
an anchor in K — by collusion *or by compromise*; the signature
does not distinguish owner from thief (Section 8). P2's strength is
therefore the strength of K's *keys* over time, and its robust form
is the multiset policy above, not any single minimum. P2 over
asserters outside K is meaningless and MUST NOT be computed.

### 4.4 P3 — Contextual assertion

> **P3(G)** = |{ edges e : e.asserter ∈ currency(G-snapshot) }|

*"n anchors this group's own admission discipline vouches for have
asserted this subject."* The membership is the snapshot's policy
currency (3.3). **P3's root is not K — it is G's gatekeeping**: a
verifier trusting P3 trusts the group's admission policy and the
integrity of its own replica of G. That the verifier can read G at
all means it belongs to that context (membership is member-only
state, Access §3.1/§13) — P3 turns "is this a person" into "is
this someone my context has admitted people who then met them".

P3 is the **sibling** of the Access layer's registered
`encounter(count)` rule (Access §4.2), not the same predicate: the
Access rule is evaluated at an operation's causal position during
admission decisions; P3 is evaluated at a verifier-named snapshot
for the verifier's own purposes. Two verifiers holding different
replicas may compute different P3 — inherent to local-first, and
visible: the result names the snapshot.

### 4.5 Composition

Measures MAY be combined by the consumer in any way; this document
defines no composition algebra and no thresholds. Groups wanting
predicate thresholds *as group policy* would need new registered
requirement types in the Access layer's open rule set — a future
registration, not a present capability.

## 5. The Result Model (normative, abstract)

### 5.1 No wire format, one data model

Interoperability happens at the credential level; a result is a
local value. This document defines no serialization for results —
but it defines their **abstract content**, because a result whose
meaning cannot be reconstructed is not evidence of anything.

### 5.2 Result content

An evaluation result contains, at minimum: the profile version
(`rltp-predicates@0.2`) · the subject anchor · a reference
identifying which K was used (by the verifier's own naming; K's
contents are not embedded) · the edge records of 4.1 (asserter,
earliestValidFrom, mutual, collapsed-document count) · the
counts of admitted, excluded (by closed reason), and collapsed
documents · P1 and P2 for the given K · per requested group: the
snapshot identifier of 3.3 and P3 or its non-result · the
possession status: `proven` / `not-attempted` / `failed`.
Timestamps appear as instants; **no age, duration, or "now" may
appear anywhere in a result.**

### 5.3 Non-results (closed set)

`input-too-large` (3.1, whole evaluation) ·
`group-unreadable` · `group-forked` · `group-terminal` ·
`group-unknown` (each per requested group, 3.3). A non-result is
distinct from every measure value; in particular,
**`group-unreadable` is not `P3 = 0`**, and implementations MUST
preserve the distinction in their result types.

## 6. What No Predicate Establishes

Presenting any of the following as established is non-conformant.

- **No predicate establishes personhood, and none establishes that
  a meeting took place.** A credential in third-party hands is a
  signed recognition assertion (§1.2); a mutual edge is two
  consistent assertions (Encounter §8). The protocol proves key
  control and signing; humans witness humans.
- **Every measure is a floor over what was presented, bounded by
  what was signed.** The *subject* can withhold, never invent:
  hiding documents can lower measures, and no subject-side input
  raises any measure beyond what asserting keys actually signed.
  Whether *asserters* signed truthfully is exactly the trust
  P1/P2 place in K and P3 places in G — issuer-side fabrication is
  not prevented, it is priced (Section 8).
- **Monotonicity holds in the strength order, per measure:**
  adding admitted input never weakens a measure (P1, P3
  non-decreasing; the P2 multiset only gains entries or
  earlier-or-equal instants); removing input never strengthens
  one. Conformance tests this order, not raw values (Section 11).
- **No global uniqueness.** One person may hold several anchors,
  each independently asserted. These predicates measure assertion
  of *an anchor*, not enumeration of *persons* — true on the
  subject side and equally on the asserter side (Section 8).
- **A verifier without roots learns nothing.** Empty K yields
  P1 = 0 and an empty P2; no readable group yields P3 non-results.
  Correct, and the honest boundary: these predicates serve
  acquaintances and contexts, not strangers.
- **Nothing propagates.** An asserted asserter confers nothing
  transitively. There is no depth parameter anywhere in this
  document, deliberately.

## 7. Excluded Predicates (named non-goals)

- **P4 — Asserter independence** ("n asserters not densely
  connected among themselves") is the real collusion measure and
  requires edges *among the asserters* — third-party data the
  subject cannot rightfully present and a verifier can only
  approximate from its own prior knowledge. A future revision MAY
  define P4 as an explicitly approximate, verifier-local measure;
  this version does not, rather than define it badly.
- **P5 — Path distance** is excluded, not deferred: a predicate
  whose evaluation disclosed the social graph of non-parties is
  structurally at odds with the presentation model (§1.1).
- **Zero-knowledge presentation** ("n of my asserters lie in S,
  without revealing which") is the genuine minimal-disclosure
  direction for P1/P3 and belongs to the Encounter layer's OI-5
  presentation work. Named as a direction, not implied as a
  feature.

## 8. Security Considerations

- **Each predicate's root, named:** P1 and P2 root **entirely in
  K**; P3 roots **entirely in G's admission discipline and the
  verifier's replica integrity**. There is no common root, and no
  statement in this document may be read as K protecting P3 or G
  protecting P1.
- **K is anchor-distinct, never person-distinct.** One person
  entering K under several anchors counts once per anchor in P1
  and contributes several entries to P2 — the same multi-anchor
  reality §6 states for subjects. K curation (one anchor per
  person, provenance per entry) is the verifier's security work;
  implementations MUST make K's provenance inspectable and MUST
  NOT merge anchors into K from unauthenticated sources.
  K poisoning — Sybil anchors admitted as "known people" — defeats
  P1/P2 before any machinery here runs.
- **The Sybil economics are inherited, not improved:** free
  anchors, free assertions among them; expensive assertions from
  **specific known keys** (Encounter §13). A K-anchor asserting
  falsely is a known key lying — possible, and exactly the trust
  being spent.
- **Key compromise beats collusion-talk.** Backdating or false
  assertion requires a K-anchor's *key*, not its owner's consent;
  signatures do not distinguish owner from thief, there is no
  transparency log, and multiple credentials per issuer are legal.
  Consequences drawn here: P2 is a multiset so consumers can
  require *m* independent old edges (one stolen key ≠ m); §8
  treats **asserter**-anchor compromise as a first-class threat,
  not only subject compromise; and stale evidence about a
  long-lived anchor means both established history *and* a longer
  compromise window — consumers weigh both.
- **Succession (bridge rule).** This version evaluates raw
  anchors. An implementation applying succession resolution
  (mapping a superseded anchor to its successor) MUST collapse
  resolved anchors into **one** edge slot — resolution must never
  double-count a person across their own anchors — and MUST
  exclude, with reason `ambiguous-succession`, credentials whose
  issuer's succession is contested. Everything further is PP-5.
- **Possession replay.** The 3.4 profile makes possession
  signatures single-challenge, audience-bound, and
  domain-separated; a captured signature verifies nowhere else. An
  implementation accepting an unbound signature where a verdict
  attaches to a live counterparty is non-conformant, and the
  vector suite distinguishes *asserted anchor* from *present
  controller* (Section 11).
- **Presented sets are not secrets, and holding one is not
  standing.** Possession gates authority; what holding a foreign
  presented set does confer is knowledge — a privacy consequence,
  treated in Section 9.

## 9. Privacy Considerations

- **What a presented credential actually disclores — in full.** A
  complete encounter credential reveals its asserter and subject
  anchors, `validFrom`, ceremony identifier, the subject's
  challenge, the enactment binding, any channel hint, and the
  proof with its own metadata (`proof.created` among it). Bindings
  and challenges are correlatable with counterpart credentials
  obtained elsewhere. Consumers therefore learn substantially more
  than the measures; this document does not pretend otherwise.
- **Disclosure within this flow is the subject's act** — scoped
  claim: the asserter of every credential also holds a copy
  (Encounter §7.4) and may disclose it independently; nothing here
  restrains issuers. Within the evaluation flow, the subject
  chooses what to present.
- **Stated need first.** A consumer MUST state, before receiving
  any credential, which measures it needs, against which K it
  evaluates (by name, not contents), and **which groups** it will
  request P3 for; a subject presents in response to that stated
  need. Evaluating P3 against groups not stated beforehand is
  non-conformant. (Against a malicious verifier this is a
  conformance line, not a shield — such a verifier learns whatever
  it is handed; the protection is that the subject hands over less,
  guided by the stated need.)
- **Subjects SHOULD present minimally**: the fewest credentials
  satisfying the stated need — and consumers SHOULD design stated
  needs to be satisfiable minimally ("three known asserters
  suffice").
- **P3 discloses context proximity.** Computing P3(G) tells the
  verifier the subject is asserted by G-members — proximity to G.
  Multiple requested groups compose into a profile; the
  stated-need rule makes that composition visible to the subject
  before disclosure.
- **Verifiers accumulate graphs.** Every evaluation enriches the
  verifier's picture of who asserts whom — inherent to the
  presentation model. Implementations SHOULD NOT persist presented
  documents beyond the evaluation's need without the subject's
  consent, and results (5.2) reference K by name precisely so
  results need not embed graph knowledge.

## 10. Open Issues

- **PP-2 The K interchange question.** Communities will want to
  share known-anchor sets ("our roster as a K you can adopt") —
  a trust decision with real attack surface (Section 8), related
  to the Access membrane (Access OI-13).
- **PP-3 P4 as approximate measure**, once field experience
  exists.
- **PP-4 Report wire form.** If two independent consumers emerge,
  a minimal serialization of the 5.2 model may be worth freezing.
- **PP-5 Succession-resolved evaluation** beyond the §8 bridge
  rule: inputs, contested-succession handling, person-slot
  semantics.
- *(PP-1, the possession profile, was resolved into §3.4 by this
  casting.)*

## 11. Conformance

- **Profile** `rltp-predicates@0.2`; normatively references
  `rltp-encounter@0.22` (credential form, evidence direction,
  enactment binding, counting rule); P3 additionally requires a
  group snapshot per 3.3.
- **Class:** *predicate evaluator* — a stateless, clock-free, pure
  function from the input model (Section 3) to the result model
  (Section 5), implementing Sections 3–5 exactly.
- **Vector plan:**
  - input bounds: 1025 documents → `input-too-large` before
    validation; an oversize single document excluded `oversize`;
  - admission: outgoing (issuer = subject) → `self-issued`;
    Encounter-invalid → `invalid-document` without failing the
    evaluation; subject mismatch → `wrong-subject`; every
    exclusion reason from the closed set exercised; an invalid and
    a valid document from one asserter → the valid one forms the
    edge (independent classification, no slot poisoning);
  - edges: duplicates by byte-digest collapse before counting;
    two admitted documents from one asserter → one edge,
    `earliestValidFrom` = the minimum, second document state
    `collapsed`; mutual: matching enactment binding on an admitted
    outgoing document sets `mutual`, a non-matching binding does
    not, and outgoing documents never form edges;
  - P1: inside/outside K; empty K → 0; anchor-distinctness (two
    anchors, one person, both in K → both count);
  - P2: multiset equals the K-edges' `earliestValidFrom` values;
    instants only — a result containing any age or "now" fails;
    empty intersection → empty multiset, not an error;
  - P3: evaluated against the snapshot's policy currency — a
    pending exit's assertion does not count; snapshot identifier
    reproduced verbatim in the result; `group-unreadable` /
    `-forked` / `-terminal` / `-unknown` distinct from 0 in the
    result type;
  - possession: valid proof → `proven`; absent → `not-attempted`;
    wrong audience, reused challenge, wrong subject → `failed`;
    a verdict attached to a live counterparty with status other
    than `proven` MUST be reported as unbound;
  - monotonicity (strength order): adding an admitted document
    never lowers P1/P3 and never removes or latens a P2 entry;
    removing one never raises P1/P3 and never adds or earlifies a
    P2 entry;
  - determinism: permuting input order and duplicating documents
    changes no result field.
- Every normative statement is vector-testable or explicitly
  marked as consumer policy.

## References

[RFC2119] · [RFC8174] BCP 14 · **RLTP Encounter Layer 0.22**
(credential form §7, evidence direction and counting rule §4.2,
enactment binding §5.4, participant-local acceptance §5.6, pair
honesty §8, issuer copy §7.4, Sybil economics §13) · **RLTP Access
Layer 0.25** (materialized state and currency §3–§4, membership
privacy §3.1/§13, `encounter(count)` rule §4.2) · RLTP Succession
draft (anchor resolution) · W3C Verifiable Credentials Data Model
2.0
