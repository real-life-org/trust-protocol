# RLTP Personhood Predicates

**Real Life Trust Protocol — verifier-relative witnessing predicates**

- **Status:** Editor's Draft
- **Version:** 0.1.0-draft (first casting)
- **Editors:** Anton Tranelis
- **Date:** 2026-08-13
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Conformance profile:** `rltp-predicates@0.1` (draft)
- **Position:** a consumer of the **RLTP Encounter Layer 0.22**
  (normative reference: credential form §7, evidence direction §4.2,
  the counting rule and its honesty §4.2/§13). P3 additionally
  consumes materialized group membership from the **RLTP Access
  Layer** (currently 0.25). This document defines **evaluation**,
  not transport: nothing here travels; a presentation is whatever
  set of credentials a subject hands a verifier by any channel.

## Abstract

This document defines three **predicates** a verifier can evaluate
over encounter credentials presented by a subject: how many of the
witnessing anchors the verifier already knows (P1), how far back the
presented witnessing reaches in time (P2), and how many witnesses
belong to a named group (P3). Each predicate is a deterministic,
stateless, offline computation over presented documents — the same
verification discipline as the credentials themselves.

The name of this document names the **need** it serves — evidence of
personhood where no authority is in reach — not a claim any predicate
makes. No predicate here says *"this is a human."* Each says: **"from
this verifier's standpoint, with the anchors it already knows, this
anchor is witnessed thus."** Personhood evidence in RLTP is
verifier-relative and graph-rooted, where issuer-rooted systems make
it absolute and certificate-shaped. Both the strength and the limit
of that choice are stated in this document, in the same breath.

## Status of This Document

This is an **Editor's Draft** with no standing beyond its own
argument, the first casting of this document. It is developed through
the same adversarial convergence process as the other RLTP documents
(casting, independent adversarial review, full recast — never a
patch); this casting has not yet completed a review round. The
document will change; known open questions are collected in Section
10. Feedback is welcome via the issues of the publication repository
(github.com/real-life-org/rltp-spec).

## 1. Introduction (informative)

### 1.1 The two structural facts

Everything in this document follows from two properties of the RLTP
encounter graph:

**The graph is nowhere.** There is no global view, no directory, no
crawling. Every person holds their own edges — issued and received.
A verifier learns of a subject's edges only because the subject
**presents** them. This is a presentation model, not a lookup model,
and three consequences follow: disclosure is controlled by the
subject, so privacy is the default rather than a feature; a verifier
can anchor its judgment only to anchors it **already knows**; and
every step beyond the first edge would disclose edges of third
parties who were never asked — which is the hard boundary that
decides which predicates can exist at all (Section 7).

**Trust does not propagate.** There is no transitive trust
computation, no introducer model, no PGP-style trust depth. An edge
is evidence of one encounter between two anchors; what a *set* of
edges means is decided by the **verifier's policy**, never by the
graph. This document therefore defines *measures*, not *thresholds*:
a predicate computes a fact; whether the fact suffices is the
consumer's decision, made in the consumer's context.

### 1.2 Relation to issuer-rooted personhood

Issuer-rooted personhood systems bind a boolean to a person: an
accredited issuer certifies humanity, governance ensures it happens
once. That design serves strangers — anyone can check the boolean —
and it stands or falls with issuer accreditation and global
uniqueness, which are hard open problems.

The predicates here make no uniqueness claim and need no issuer.
They serve **acquaintances**: a verifier that already knows some
anchors — its community, its earlier encounters, a group's
membership — learns something real about a subject witnessed by
them. A verifier that knows no anchors learns nothing. Most real
trust decisions are taken among acquaintances; that is the ground
this document stands on, and its honest boundary.

## 2. Conventions and Terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" are to be interpreted as described in BCP 14 [RFC2119]
[RFC8174] when, and only when, they appear in all capitals.

The **interim securing profile** of Encounter 2.3 applies to every
document evaluated here.

**Subject** — the anchor whose witnessing is being evaluated.
**Verifier** — the party evaluating; also the owner of the
known-anchor set. **Witness** — the issuer of an encounter
credential about the subject. **Incoming credential** — an
encounter credential issued *by* a witness *about* the subject
(Encounter §4.2); the only direction that is evidence about the
subject. **Presentation** — the set of complete encounter
credentials a subject hands a verifier, by any channel; this
document imposes no wire form on it. **Known-anchor set (K)** — the
set of anchors the verifier already associates with people it has
reason to trust as distinct: its own encounter counterparts, a
group's members, a community roster. Its composition is the
verifier's responsibility and the root of every verdict (Section 7).
**Admitted credential** — a presented credential that passed the
admission checks of Section 3. **Measure** — the deterministic value
a predicate computes over admitted credentials.

## 3. Admission of Presented Credentials

Before any predicate is evaluated, each presented credential MUST
pass, independently:

1. **Document validity** per Encounter §7: schema, proof under the
   issuer's anchor, decoded key checks, context pinned by value.
2. **Direction:** the credential's subject anchor equals the
   evaluated subject, and its issuer anchor differs from the
   subject. Outgoing credentials — issued *by* the subject — MUST
   be rejected for these predicates: they are no evidence about the
   subject (Encounter §4.2).
3. **Issuer distinctness:** for every predicate, at most one
   credential per issuer anchor counts. Additional credentials from
   the same issuer are admissible input but MUST NOT increase any
   measure — Encounter counts **edges, never credentials or
   enactments** (§4.2).

A credential failing any check is excluded from evaluation; its
exclusion MUST NOT fail the evaluation as a whole (a presentation
is a claim of *at least*, Section 6).

**Possession is a separate question.** Predicates evaluate evidence
about an **anchor**. Whether the party presenting is the controller
of that anchor is proof of possession — a live signature by the
subject anchor over a verifier-supplied challenge — and is REQUIRED
whenever the verdict is attached to a present counterparty rather
than to a stored anchor. Its mechanics (challenge form, freshness)
are the consumer's profile; conflating possession with witnessing
is the classic mistake this paragraph exists to prevent.

## 4. The Predicates

Each predicate is a pure function of `(admitted credentials, K,
parameters)` — stateless, offline, no resolution, no clock except
where stated. Verifiers MUST compute measures exactly as defined;
what measure suffices is policy and out of scope.

### 4.1 P1 — Known-witness count

> **P1(K)** = the number of distinct witness anchors, over admitted
> credentials, that are members of the verifier's known-anchor set
> K.

The measure of direct witnessing: *"n of the anchors that witnessed
this subject, I already know."* Witnesses outside K contribute
nothing — anchors are free to create, so edges among unknown
anchors are free to manufacture; what is expensive is an edge to a
**specific, known** anchor (Encounter §13). P1 inherits exactly
that economics, and only that.

### 4.2 P2 — Temporal depth

> **P2** = the age of the oldest `validFrom` among admitted
> credentials whose issuer is in K, measured against the verifier's
> clock.

The measure of history: *"the witnessing I can anchor reaches back
n months."* A Sybil ring can mint any number of edges today; it
cannot mint edges that existed last year. Issuance time is signed
by the issuer, so backdating requires the **issuer's** key — and
because P2 is restricted to issuers in K, backdating requires
collusion of an anchor the verifier already trusts as a person.
Stated honestly: P2 is an honest-clock measure whose strength is
exactly the strength of K; it is the cheapest strong signal this
document defines, and it is not free of trust — it relocates trust
from a certificate to the verifier's own history.

P2 over issuers outside K is explicitly meaningless and MUST NOT be
computed: unknown anchors' clocks attest nothing.

### 4.3 P3 — Contextual witnessing

> **P3(G)** = the number of distinct witness anchors, over admitted
> credentials, that are members of group G's materialized
> membership at evaluation time.

The measure of community witnessing: *"n members of this group have
witnessed this subject."* G's membership is the materialized state
of an Access-layer group the verifier can read — which means the
verifier is a member of G or holds its membership by another
entitled route; P3 toward a group the verifier cannot read is not
computable, by design (membership is member-only state, Access
§3.1/§13). P3 turns the global question "is this a person" into the
local question "is this someone my context has met" — and it is the
predicate form of the admission rule Access already registers
(`encounter(count)`, Access §4.2), lifted out of the group's own
admission decision into any member's evaluation.

### 4.4 Composition

Measures MAY be combined by the consumer in any way; this document
defines no composition algebra. A consumer needing conjunctions
("at least 3 known witnesses AND the oldest older than a year")
evaluates the measures and applies its own rule. Where a *group*
wants such a rule as policy, the place for it is the Access layer's
policy object, not this document.

## 5. The Report (informative, non-wire)

Implementations will want a common shape for evaluation results.
This document deliberately defines **no wire format for reports**:
a report is a local value, interoperability happens at the
credential level, and freezing a report format before two
independent consumers exist would be invention. The reference
library returns, per evaluation: the admitted-credential count, the
excluded-credential count with reasons, P1, P2 (as the oldest
`validFrom`, not a precomputed age), and P3 per requested group.
Consumers MUST derive ages from timestamps themselves — shipping
ages invites clock disagreement.

## 6. What No Predicate Establishes

This section is normative in the sense that presenting any of these
as established is non-conformant.

- **No predicate establishes personhood.** The protocol proves key
  control and witnessed exchange; that a human was present is
  witnessed by humans, not proven by mathematics (Encounter §1).
- **Every measure is a floor, never a census.** The subject chooses
  what to present; edges can be withheld, never invented. All
  measures are *at-least* statements, and consumers MUST treat a
  low measure as absence of evidence, not evidence of absence.
- **No global uniqueness.** Nothing here prevents one person from
  holding several anchors, each independently witnessed. These
  predicates measure witnessing of *an anchor*, not enumeration of
  *persons*. Uniqueness claims require an issuer-rooted or
  ZK-uniqueness system and are out of scope by design.
- **Colluding manufacture is possible below K.** A consistent set
  of credentials among colluding key holders is manufacturable and
  wire-indistinguishable from real encounters (Encounter §8). Every
  predicate's resistance to it comes solely from K: collusion must
  then include anchors the verifier already knows as people.
- **A stranger learns nothing.** A verifier with an empty
  known-anchor set gets P1 = 0, no meaningful P2, and no readable
  group for P3 — correctly. These predicates serve acquaintances;
  they do not replace issuer-rooted personhood for strangers, and
  claiming otherwise would be the dishonesty this document exists
  to avoid.
- **Nothing propagates.** A witnessed witness confers nothing
  transitively. There is no depth parameter anywhere in this
  document, deliberately.

## 7. Excluded Predicates (named non-goals)

- **P4 — Witness independence** ("n witnesses not densely connected
  among themselves") is the real collusion measure and requires
  edges *among the witnesses* — third-party data the subject cannot
  rightfully present and the verifier can only approximate from its
  own prior knowledge. A future revision MAY define P4 as an
  explicitly approximate, verifier-local measure; this version does
  not, rather than define it badly.
- **P5 — Path distance** ("a chain of length k from me to you")
  requires the edges of intermediate persons who were never asked.
  It is excluded, not deferred: a predicate whose evaluation
  discloses the social graph of non-parties is structurally at odds
  with the presentation model (§1.1), and no minimal-disclosure
  refinement of *this* document changes that.
- **Zero-knowledge presentation** ("n of my witnesses lie in S,
  without revealing which") is the genuine minimal-disclosure
  direction for P1/P3 and belongs to the Encounter layer's OI-5
  presentation work, not here. Named as a direction, not implied as
  a feature.

## 8. Security Considerations

- **K is the root of every verdict.** Poisoning the verifier's
  known-anchor set — inserting Sybil anchors as "known people" — is
  the primary attack, and it happens before this document's
  machinery runs. How K is built (own encounters, group
  memberships, community rosters) determines everything;
  implementations MUST make K's provenance inspectable and MUST NOT
  merge anchors into K from unauthenticated sources.
- **The Sybil economics are inherited, not improved.** Free anchors,
  free edges among them; expensive edges to known anchors
  (Encounter §13). P1/P3 are exactly as strong as that boundary.
  P2 strengthens it in one dimension (time) and inherits it in the
  other (K-membership of the issuer).
- **Backdating requires known-issuer collusion.** `validFrom` is
  issuer-signed. For issuers in K, backdating means an anchor the
  verifier trusts as a person signs falsely — possible, bounded,
  and attributable if ever compared against other holders'
  documents. For issuers outside K it is free, which is why P2
  excludes them.
- **Possession-witnessing conflation.** A presentation proves what
  was witnessed about an anchor; it does not prove the presenter
  controls it. Section 3's possession requirement is the gate;
  omitting it where verdicts attach to a live counterparty is the
  most likely implementation error and MUST be tested for
  (Section 9).
- **Edges are never revoked — memory, not snapshot.** A compromised
  anchor's historical edges remain valid history; what changed is
  who controls the key now. This is the deliberate trade of the
  Encounter layer (immutable evidence) and the succession work owns
  the recovery path. Consumers weighing stale evidence about a
  possibly-compromised anchor SHOULD weigh P2 both ways: old edges
  mean established history *and* a longer window in which
  compromise may have occurred.
- **Replay of presentations.** Credentials are public-shaped
  documents; holding someone's presented set does not confer their
  standing (possession gate), but it does disclose their witnesses.
  That is a privacy, not an authority, consequence (Section 9's
  companion in §9).

## 9. Privacy Considerations

- **Disclosure is the subject's act, addressee-directed.** A
  presentation reveals to the verifier exactly: which anchors
  witnessed the subject (P1/P3), and when the presented witnessing
  began (P2). Subjects SHOULD present the minimum set that satisfies
  the consumer's stated need, and consumers SHOULD state their need
  ("three known witnesses suffice") rather than requesting
  everything.
- **The verifier learns witness identities.** P1 and P3 are
  meaningful *because* they de-pseudonymize witnesses toward the
  verifier — that is their function, bounded and addressee-directed
  (Access §13's language applies). The ZK direction (Section 7)
  exists precisely to narrow this further; until it exists, the
  disclosure is honest and stated.
- **P3 discloses group association.** Evaluating P3(G) tells the
  verifier that the subject is witnessed by members of G — which
  reveals proximity to G. Subjects present toward a group-reading
  verifier knowingly; implementations MUST NOT evaluate P3 against
  groups the verifier's user did not name.
- **Verifiers accumulate graphs.** Every presentation enriches the
  verifier's picture of who witnesses whom. This is inherent to the
  presentation model; the mitigations are minimum presentation
  (above), and the fact that no lookup model exists to enrich it
  further. Implementations SHOULD NOT persist presented credentials
  beyond the evaluation's need without the subject's consent.

## 10. Open Issues

- **PP-1 Possession profile.** The challenge form for proof of
  possession (Section 3) is left to consumer profiles; a common
  form (likely reusing the Encounter card-challenge discipline)
  would help interop and could be registered here.
- **PP-2 The K interchange question.** Groups and communities will
  want to *share* known-anchor sets ("our roster, as a K you can
  adopt"). That is a trust decision with real attack surface
  (Section 8) and needs its own design — related to the Access
  membrane (Access OI-13).
- **PP-3 P4 as approximate measure.** Whether a verifier-local
  independence approximation is worth defining, once field
  experience exists.
- **PP-4 Report wire form.** If two independent consumers emerge, a
  minimal report format may be worth freezing (Section 5).

## 11. Conformance

- **Profile** `rltp-predicates@0.1`; normatively references
  `rltp-encounter@0.22` (credential form, evidence direction,
  counting rule); P3 additionally requires read access to an Access
  group's materialized membership.
- **Class:** *predicate evaluator* — a stateless, offline, pure
  function from `(presentation, K, parameters)` to measures,
  implementing Sections 3–4 exactly.
- **Vector plan:**
  - admission: an outgoing credential (issuer = subject) is
    rejected; a credential failing Encounter §7 validation is
    excluded without failing the evaluation; two credentials from
    one issuer count once in every measure; subject mismatch
    rejected;
  - P1: witnesses inside/outside K counted/ignored; empty K → 0;
    duplicate issuers collapse;
  - P2: oldest `validFrom` among K-issuers only; non-K issuers
    never considered; single-credential and empty cases; the
    library returns the timestamp, never an age;
  - P3: membership evaluated against a fixed materialized roster;
    witnesses outside G ignored; G unreadable → not computable
    (distinct from 0);
  - possession: an evaluation attached to a live counterparty
    without the possession signature MUST be reported as
    unbound — the vector suite distinguishes *witnessed anchor*
    from *present controller*;
  - honesty: hiding credentials lowers measures monotonically
    (at-least property); no input can raise a measure above the
    distinct-K-witness count.
- Every normative statement is vector-testable or explicitly
  marked as consumer policy.

## References

[RFC2119] · [RFC8174] BCP 14 · **RLTP Encounter Layer 0.22**
(credential form §7, evidence direction and counting rule §4.2,
Sybil economics §13, pair honesty §8) · **RLTP Access Layer 0.25**
(materialized membership §3, `encounter(count)` policy rule §4.2,
addressee-directed disclosure §13) · RLTP Succession draft
(compromise recovery) · W3C Verifiable Credentials Data Model 2.0
