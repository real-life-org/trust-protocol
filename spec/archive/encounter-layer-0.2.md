# RLTP Encounter Layer

**Real Life Trust Protocol — Layer 2: Encounter**

- **Status:** Editor's Draft
- **Version:** 0.2.0-draft (second casting)
- **Editors:** Anton Tranelis
- **Date:** 2026-08-10
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Conformance profile:** `rltp-encounter@0.2` (draft)
- **Supersedes on adoption:** `02-wot-trust/001-encounter credentials.md` and
  `002-verifikation.md` (wot-spec v0.1, German); see Appendix B.

## Abstract

This document specifies the Encounter layer of the Real Life Trust
Protocol: how two people establish, record, and maintain the fact that
they have met and recognized each other.

An encounter is performed as an **enactment** of a registered
**ceremony**, in which each party sees the other's fresh challenge and
deliberately confirms recognition. Each confirmation is a **step** whose
product is an **encounter credential**, immutable and issued to the
person it is about. Credentials between two anchors form an **edge**,
which may be one-sided or mutual. Every ceremony produces the same kind
of credential. Relations that are not encounters — knowing someone
through a mutual contact, say — exist as paths in the graph and are
computed rather than asserted.

Cryptography proves freshness and authorship; only a human can witness a
human. When a person's anchor changes, their edges follow through
witnessed succession, specified separately in *RLTP Succession*.

## Status of This Document

Second casting. It answers review round 1 (roots W2, W4–W7 as they apply
to this layer; see `../design/l2-review-2026-08.md`) and the intake items
E-V1 and the enactment-correlation finding. Terminology is aligned with
the ToIP DTGWG Trust Ceremonies vocabulary (Appendix C). It awaits
adversarial review round 2; the convergence criterion is a casting whose
external review yields no blocker-level findings. Open issues:
Section 15.

## 1. Introduction (informative)

### 1.1 Essence

> An encounter is a **protocolled act of mutual recognition between
> people**, cryptographically bound to key control and freshness, whose
> cost is a real interaction and whose yield is a durable, immutable
> record between stable anchors.

Three consequences shape this document:

1. **The protocol does not prove personhood.** It proves that a key was
   controlled and that an exchange was fresh. That a human is present, and
   that this human is the one they appear to be, is witnessed by another
   human. The protocol's contribution is to make that witnessing
   unforgeable, fresh, attributable — and expensive to fake at scale.
2. **An encounter is one thing.** An enactment establishes fresh mutual
   recognition; whatever ceremony it enacts, it produces the same kind of
   credential. Relations of other kinds — "A knows B through C", "both
   attended the same event" — are **paths and shared contexts derived
   from the graph**, computed rather than asserted.
3. **Recognition is not trust.** An encounter says "this person is real
   and I met them". It does not say "I trust them". Anything that
   requires deliberate trust — notably guardianship, specified in
   *RLTP Succession* — is a separate, explicit act.

### 1.2 Position in the layer model

This layer consumes Layer-1 anchors and produces the edges that Layer 3
policies may reference and that applications display. It requires no
authority substrate. It uses the Delivery service through a port
(Section 11); nothing in this layer depends on a transport, and **nothing
in this layer depends on connectivity during an enactment**.

### 1.3 Design-principles note

*SRP:* this layer owns recognition and its record, nothing else — no
permissions, no group semantics. *OCP:* ceremonies and channels are an
open set extended by registration. *LSP:* any enactment satisfying the
contract in 5.2 produces an equivalent encounter credential. *ISP:*
consumers of an edge need not understand the ceremony that produced it.
*DIP:* the Delivery port is defined by this layer's needs.

Two further principles govern this document and *RLTP Succession*
jointly:

- **Issuance counts, arrival does not.** Every validity judgment in this
  family is a function of signed issuance-time data, never of when an
  artifact happened to arrive. Documents may travel for an unbounded
  time.
- **Every mechanism names its user action.** A rule that adds no human
  action may be arbitrarily strict; a rule that adds one must justify
  it. The user actions of this layer are exactly two: exchange cards,
  confirm recognition.

## 2. Conventions and Terminology

### 2.1 Requirement language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" in this document are to be interpreted as described in
BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all
capitals, as shown here.

### 2.2 Terms

Permanent identifiers are `https://real-life.org/rltp/v1#<Fragment>`.

**Anchor** — the stable Layer-1 identifier of a person, to which edges
attach. This layer makes no assumption about its DID method (4.3).

**Contact card** — a person's signed self-description carrying the
verification material needed to recognize and reach them. Not a
credential (Section 6).

**Challenge** — a fresh, single-use value published in a contact card
for one enactment.

**Ceremony** — a registered, versioned definition of an encounter
interaction (Section 5). *Aligned with DTGWG usage: the ceremony is the
definition, not the meeting.*

**Enactment** — one performed run of a ceremony between two people.
Never reused.

**Step** — one credential issuance within an enactment.

**Enactment key** — a secret derived by both parties of an enactment
from its challenge material (5.4); proves shared participation.

**Enactment commitment** — the per-credential blinded binding to the
enactment key (5.4).

**Enactment record** — a party's durable local record of an enactment
(5.5).

**Encounter credential** — the immutable credential in which one party
records that they recognized another (Section 7).

**Edge** — the relation between two anchors constituted by the encounter
credentials between them; **incoming**, **outgoing**, or **mutual**
(4.2).

| Term | Fragment | | Term | Fragment |
|---|---|---|---|---|
| Anchor | `#Anchor` | | Enactment | `#Enactment` |
| Contact card | `#ContactCard` | | Enactment key | `#EnactmentKey` |
| Challenge | `#Challenge` | | Enactment commitment | `#EnactmentCommitment` |
| Ceremony | `#Ceremony` | | Encounter credential | `#EncounterCredential` |
| Step | `#Step` | | Edge | `#Edge` |

Referenced: **Credential** (W3C VC 2.0 + DTG types), **Delivery port**
*(services)*, **recovery seed / device key** *(L1)*.

### 2.3 Interim securing profile

The Layer-1 (Identity) specification is not yet cast. Until it is, this
document is self-contained by requiring, normatively:

- An **anchor** is a DID. No resolution is required at any point in this
  layer: all verification material travels in the contact card (4.3).
- An anchor's verification material comprises an **Ed25519 signature
  key** and an **X25519 key-agreement key**.
- Credentials are W3C Verifiable Credentials 2.0 secured with
  **VC-JOSE-COSE** (compact JWS, `EdDSA`). Canonicalization of any
  digest input in this family is **JCS** [RFC8785].
- Digests are **SHA-256**; digest values are multibase-encoded
  (`base64url`, prefix `u`).

The Identity layer will restate this profile; on adoption it supersedes
this section. Nothing else in this document depends on the details.

## 3. What an Encounter Establishes

An encounter establishes exactly four things, and implementations MUST
NOT present it as establishing more:

| Established | By |
|---|---|
| **Key control** — the issuer controlled their anchor's key | signature |
| **Freshness** — the exchange happened within one enactment | challenge binding (5.3) |
| **Deliberate recognition** — a human decided to confirm | the confirmation step (5.2, C4) |
| **A durable record** — the fact survives the moment | the encounter credential (Section 7) |

It does **not** establish physical presence (a channel may be relayed),
personhood (only the witnessing human asserts that), identity of a name
to a legal person, or trust.

## 4. Anchors, Credentials, Edges

### 4.1 The atom is the encounter credential

An encounter credential is issued by one party about another. It is the
atom of this layer. It is complete on its own and is delivered to its
subject, who holds it (receiver principle, 7.3). **The issuer keeps a
copy**; holding does not confer authority (7.3).

### 4.2 The edge is the relation, and it is local state

An **edge** between anchors A and B is constituted by the encounter
credentials that exist between them. A party's view of an edge is local.
Implementations MUST model, per counterparty and direction, the
following states:

- **recorded** — an enactment record exists (5.5), no credential yet;
- **issued** — the local party has issued its step credential;
- **received** — a credential from the counterparty has been accepted
  under 5.6.

From a party's local view: an edge is **outgoing** when they have issued
and not received, **incoming** when they have received and not issued,
and **mutual** when, for one enactment record, they have both issued and
received. Delivery status never changes these states on its own
(arrival does not count, 1.3).

Evidence weight differs by direction: an **incoming** credential is
evidence about the subject, because a third party signed it; an
**outgoing** credential is evidence about the other party and **no
evidence about the issuer**, who signed it themselves. Counting or
evaluating a person's edges (for example in a Layer-3 policy predicate)
MUST consider incoming credentials only, or mutual edges; outgoing
credentials MUST NOT count toward the issuer's own standing.

Mutuality is a **semantic** property, not a security measure: two
colluding people can attest each other. The cost of an edge is the
encounter itself. How mutuality is proven to a third party is specified
in Section 8.

### 4.3 The anchor is method-agnostic

An encounter credential references anchors as identifiers. This layer
places no requirement on the DID method beyond those of Layer 1.
Verification material needed at first contact travels in the contact
card (Section 6), **not** through resolution — this is the
interoperability seam: a counterparty using an online-resolved method
remains verifiable offline because their card carries what is needed.

## 5. Ceremonies and Enactments

### 5.1 Registered ceremonies

A **ceremony** is a registered, versioned definition. Ceremonies are an
open set. This version registers two (5.8): `two-way-scan@0.2` and
`one-way-scan-online@0.2`. An enactment names the ceremony it enacts;
an encounter credential names it too.

### 5.2 The enactment contract

An interaction is an enactment of an encounter ceremony if and only if
it establishes all of:

- **C1 Material exchange.** Each party obtains the other's contact card,
  including a fresh challenge.
- **C2 Freshness.** Each challenge is single-use, generated for this
  enactment, and no older than `challenge-max-age` at the time of the
  enactment (Section 9).
- **C3 Binding.** Each step credential binds the challenge of its
  **subject** and the enactment commitment (5.3, 5.4).
- **C4 Deliberate confirmation.** Before issuing, a human confirms
  recognition. Implementations MUST NOT issue encounter credentials
  automatically.
- **C5 Enactment record.** Each party durably records the enactment
  (5.5) before issuing.

Any interaction meeting C1–C5 is an enactment, whatever form the
interaction took. Interactions that establish something else (possession
of a phone number, control of a domain) are **not** encounter enactments
and MUST NOT produce credentials under this specification.

### 5.3 Challenge binding

A step credential MUST bind the challenge published by its **subject**
in this enactment. This proves the issuer saw the subject's fresh card.
Acceptance is checked against the subject's own enactment record (5.6),
so the binding remains checkable **however late the credential is
delivered**.

### 5.4 Enactment key and commitment

Both step credentials of an enactment must be provably products of *one*
enactment — without giving every observer of both credentials a shared
value to correlate them by. A shared plaintext identifier in two durable
credentials is a correlation handle; this layer uses a blinded binding
instead.

**Enactment key.** Both parties derive
`e = HKDF-SHA-256(ikm, salt, info)` where `ikm` is the concatenation of
the two challenge values in ascending byte order, `salt` is the ASCII
string `rltp/v1/enactment`, and `info` is the ceremony identifier. Only
parties who saw both challenges can derive `e`.

**Enactment commitment.** Each step credential carries
`c = SHA-256(JCS({"e": e, "subject": <subject anchor>}))`, multibase-
encoded. The two credentials of one enactment therefore carry
**different** commitment values; neither reveals `e`.

Consequences: a passive observer of both credentials cannot link them;
the participants (or anyone they disclose `e` to) can prove to a
verifier that both credentials bind the same `e` and thus one enactment
(Section 8). The raw challenge bound under 5.3 appears in only one
credential each and links nothing on its own.

### 5.5 The enactment record

Before issuing, each party MUST durably record: the ceremony identifier
and version; the counterparty anchor and its verification material as
received; both challenge values; the derived enactment key `e`; and the
local time of the enactment. The record is the party's proof of
participation, the acceptance reference (5.6), and the source for
mutuality proofs (Section 8).

Records MUST be retained for the life of the relation. A record marks
its challenges consumed; a challenge present in any record MUST NOT be
accepted in a new enactment.

### 5.6 Acceptance

On receiving a credential claiming to be an encounter credential about
the local anchor, an implementation MUST evaluate, in order:

1. **Version.** The ceremony and credential versions are known; else
   reject `ERR_VERSION`.
2. **Signature.** The VC proof verifies under the issuer material in the
   matching enactment record; else reject `ERR_SIG`.
3. **Addressee.** The credential subject is the local anchor; else
   reject `ERR_ADDRESSEE`.
4. **Record.** An enactment record exists whose own-challenge equals the
   bound challenge and whose counterparty equals the issuer; else reject
   `ERR_NO_RECORD`.
5. **Issuance window.** The credential's `validFrom` lies within
   `[t_rec − skew-tolerance, t_rec + issuance-window + skew-tolerance]`
   where `t_rec` is the record's enactment time; else reject
   `ERR_STALE_ISSUANCE`. *Late issuance is rejected here; late delivery
   is not, because no rule in this document references arrival time.*
6. **Commitment.** The enactment commitment recomputes from the record's
   `e` and the local anchor; else reject `ERR_BINDING`.
7. **Uniqueness.** No credential has been accepted for this record and
   direction. An identical credential (same digest) is accepted
   idempotently; a different one is rejected `ERR_CONFLICT`.

A credential failing any check is **not an encounter credential**. It
MAY be retained and displayed as an unverified claim; it MUST NOT be
counted as an encounter and MUST NOT satisfy a Layer-3 encounter
predicate. Each error state above is a distinct conformance vector.

### 5.7 The channel is informative

The channel and its properties (in person, video, near-field) are
recorded in the encounter credential as informative metadata and carry
**no normative weight**. What a channel evidences beyond the four items
of Section 3 is a judgment for the humans and the applications, not a
protocol claim.

### 5.8 Registered ceremonies of this version

**`two-way-scan@0.2`.** Both parties display and scan each other's
cards; each derives `e`, records the enactment, confirms, issues, and
delivers when connectivity next allows. Requires no connectivity and no
third party during the enactment. Message flow: (1) A and B exchange
cards optically; (2) each records; (3) each confirms and issues; (4)
each delivers via the Delivery port, unbounded in time.

**`one-way-scan-online@0.2`.** One party (A) scans; B's card is
obtained; A generates a **local nonce** `n` which takes the place of A's
challenge in the `ikm` of 5.4. Message flow: (1) A scans B's card;
(2) A records, confirms, issues its step credential binding B's
challenge, and delivers it to B **together with `n`** over an
authenticated channel; (3) B verifies under 5.6 (B's record is created
at this point from B's own challenge, A's card material, and `n`); (4) B
MAY confirm in turn and issue the counter-step, binding A's card
challenge from A's card and the same `e`. Requires connectivity for at
least one party. Until step (4), the edge is one-sided.

## 6. The Contact Card

A contact card is a person's **self-description**. It is explicitly
**not a credential**: it asserts nothing about anyone but its author,
and carries no third-party signature.

A card MUST carry: a **format version**; the anchor; verification
material sufficient to verify the author's signatures and to encrypt to
them without online resolution (2.3); a **challenge value** with its
**issuance time**, when the card is used in an enactment; and the
author's signature over the card body. It MAY carry a display name and
delivery hints.

A party encountering a card with an **unknown version** MUST NOT enter
an enactment with it, and MAY import its display fields as an unverified
contact. Degradation is always toward less assurance.

The name in a card is **self-declared** and MUST NOT be treated as
verified. Recipients bind their own local name to the anchor (petname
principle).

Cards are updated in the relationship: a party MAY send an updated card
to those who hold one. Card format SHOULD be aligned with an established
contact interchange format where this does not conflict with the above.

## 7. The Encounter Credential

### 7.1 Form

An encounter credential is a W3C Verifiable Credential 2.0 secured as in
2.3, of DTG type **`WitnessCredential`**. Its witness context carries the
properties of 7.2. Statements *about* a person that are not encounters
use `EndorsementCredential` and are outside this specification.

### 7.2 Data model

| Property | Type | Card. | Content |
|---|---|---|---|
| `issuer` | anchor | 1 | the recognizing party |
| `credentialSubject.id` | anchor | 1 | the recognized party |
| `validFrom` | datetime | 1 | issuance time (E-V1: SHOULD equal enactment time) |
| `ceremony` | string | 1 | registered ceremony id and version |
| `challenge` | string | 1 | the subject's challenge value (5.3) |
| `enactmentCommitment` | multibase | 1 | per 5.4 |
| `channel` | string | 0..1 | informative (5.7) |

The credential MUST NOT carry the enactment key, the issuer's own
challenge, or any value equal across both credentials of an enactment.
Unknown additional properties MUST be ignored on verification and MUST
NOT contribute assurance. A machine-readable JSON Schema for this model
is a normative deliverable of the conformance suite (Section 14).

### 7.3 Immutability

Encounter credentials are immutable and are **never revoked**. A changed
assessment is expressed by issuing a new credential; both remain true of
their moment. *(This is the property that distinguishes this layer from
Access: recognition is a testimony about the past, access is a grant in
the present.)* A credential is a durable, independently meaningful claim
from the moment of issuance; the enactment is its provenance, not a
condition of its validity.

### 7.4 Receiver principle

An encounter credential belongs to its subject. It is delivered to them;
they decide whether to keep, display, or publish it. The issuer retains
a copy but **no authority**: no protocol operation of the issuer can
alter, revoke, or condition a delivered credential, and issuers receive
no protocol-level signal of acceptance. Transport acknowledgements MUST
NOT be presented as acceptance.

## 8. Proving an Edge to Third Parties

A single credential is verified by signature and content alone; this
requires no cooperation.

**Mutuality** is proven by presenting both step credentials **plus a
disclosure of the enactment key `e`**. The verifier recomputes both
commitments (5.4); if both match, the credentials are products of one
enactment. Disclosure of `e` is a deliberate act of a participant;
without it, mutuality is not third-party checkable — by design (12).

*(Informative: in DTGWG evidence terms, a single credential is
`collected` evidence of its step; the pair with disclosed `e` is
`countersigned` evidence of the enactment — each participant signed
their step, and the commitments join them. A two-party enactment has no
recorder, and needs none.)*

## 9. Time Parameters

| Parameter | Default | Meaning |
|---|---|---|
| `challenge-max-age` | PT24H | max age of a challenge at enactment time (C2) |
| `issuance-window` | PT24H | max delay from enactment to credential issuance (5.6 step 5) |
| `skew-tolerance` | PT5M | clock-skew allowance on every comparison above |

Defaults MAY be tightened by deployment profiles and MUST NOT be
loosened beyond one order of magnitude. All comparisons use the signed
times in artifacts and the local record time; **no rule in this layer
references arrival time**. Retention: enactment records for the life of
the relation (5.5); no separate consumed-challenge store is required,
because records subsume it and `ERR_STALE_ISSUANCE` bounds the horizon
within which a challenge can still be bound.

## 10. Paths and Shared Contexts (informative)

Relations weaker than an encounter are **computed, not asserted**:

- *A knows B through C* — a path in the graph. No credential exists or
  should exist; the honest reading is that A trusts C's judgment.
- *A and B share a context* — both hold edges into the same group or
  attended the same event. Derived from Layer 3 membership or from a
  shared context artifact (Open Issue OI-2).

Because these are derived, they cannot be forged independently of the
edges they rest on.

## 11. Service Port

**Delivery.** This layer requires authenticated, end-to-end-encrypted
delivery of encounter credentials to a subject, with durable buffering
and explicit delivery status; silent loss is non-conformant. Delivery
time is unbounded and never affects validity. Enactments MUST be
possible without any service (`two-way-scan`, 5.8).

## 12. Evolvability

- Every wire artifact carries an explicit version; **contact cards carry
  a format version** (Section 6), because the card is the first artifact
  exchanged between strangers and must be able to negotiate future
  ceremonies.
- New ceremonies, channels and card fields register new identifiers;
  existing ones are never re-interpreted.
- Unknown constructs degrade toward *less* assurance: an unknown
  ceremony or card version is rejected from enactment and acceptance
  (5.6, 6); unknown informative fields are ignored.
- Renames only via alias table; key-derivation strings (5.4) are never
  renamed.

## 13. Security Considerations

- **Freshness is not presence.** The challenge proves the exchange was
  live, not that the parties shared a room; a channel can be relayed.
  Implementations MUST NOT claim presence.
- **The confirmation step is the security boundary.** C4 is where a
  human decides. Automating it — issuing on scan without confirmation —
  removes the only thing this layer actually secures.
- **Replay and substitution.** Challenge binding plus the uniqueness
  check (5.6 step 7) prevent reuse of a captured credential and
  substitution of a second credential onto a consumed challenge. A
  photographed card is useless once its challenge is consumed or aged
  out.
- **Late issuance is the attack; late delivery is not.** A card pocketed
  and signed weeks later would fabricate an encounter that never
  completed; `issuance-window` (5.6 step 5) rejects it on the subject's
  side regardless of how long delivery took.
- **Enactment-key exposure.** `e` proves shared participation; a party
  who discloses it enables correlation of the two credentials (that is
  its purpose). It grants no issuance or signing capability. Bystanders
  who optically capture both QR codes during an enactment can derive
  `e`; the parties standing next to each other is exactly the situation
  the layer records, and such a bystander still cannot forge either
  signature.
- **Collusion bounds the value of counting.** Two parties can mutually
  attest without meeting. Edge counts are therefore evidence of
  interaction cost, not of honesty; Layer-3 policies relying on them
  MUST state that assumption.
- **Time gates are layered consistently.** Every gate in Section 9
  tolerates `skew-tolerance`; an inner gate stricter than an outer
  accepting gate silently drops accepted material and is non-conformant.

## 14. Privacy Considerations

- **Encounter credentials are addressee-bound.** They are delivered to
  the subject and published only by the subject's deliberate act. The
  protocol provides no directory.
- **No passive pair-correlation.** The two credentials of an enactment
  share no plaintext value (5.4); linking them requires a participant's
  disclosure of `e`. This is the deliberate answer to the correlation
  handle that a shared enactment identifier would create.
- **Cards reveal what their author put in them.** A card carries
  verification material by necessity; anything else is the author's
  choice, and implementations SHOULD default to minimal cards.
- **Anchors are stable and therefore correlatable** across contexts.
  This is the chosen trade of Layer 1 (I13): it buys unforgeable edge
  counting and offline verification. Channel and service identifiers MAY
  be derived per relationship; the anchor is not.

## 15. Conformance

- **Profile** `rltp-encounter@0.2`; requires the interim securing
  profile (2.3) until `rltp-identity` is cast.
- **Classes:** *participant* (enactments, issuance, acceptance) ·
  *verifier* (credential and mutuality verification only).
- **Deliverables:** JSON Schemas for the credential (7.2) and the
  contact card (6); test vectors per the plan below. Schema and vector
  serialization use JCS.
- **Vector plan:** enactment contract compliance (C1–C5) · challenge
  binding · enactment-key derivation and commitment (5.4, both
  ceremonies) · every error state of 5.6 as a distinct vector, including
  idempotent re-delivery and `ERR_CONFLICT` · delayed delivery of a
  two-way enactment (accepted) versus late issuance (rejected) ·
  mutuality proof with correct and incorrect `e` · card versioning and
  unknown-version refusal · edge-state transitions of 4.2.
- Every normative statement is vector-testable or explicitly marked
  state-dependent (the enactment record, the confirmation step).

## 16. Open Issues

- **OI-1 Group encounters.** *n* people in a circle currently require
  *n(n−1)/2* pairwise enactments. A collective ceremony would need a
  shared context artifact and a definition of what it establishes for
  each pair.
- **OI-2 Shared contexts.** "Attended the same event", "scanned the same
  code" — a derived relation with no credential. Form and evidence
  undefined.
- **OI-3 Minimal-disclosure presentation.** Which bundle satisfies a
  Layer-3 encounter predicate with least disclosure; whether `e` can be
  proven without being disclosed (a ZK membership form).
- **OI-4 Time and renewal.** Whether the age of an edge is expressible,
  and whether repeated encounters between the same anchors are
  distinguishable from one.
- **OI-5 Card format alignment.** Whether to adopt an established
  contact interchange format, and at what cost to minimality.

## Appendix A (informative): bindings to the current implementation

| This specification | wot-core v0.x | Status |
|---|---|---|
| Contact card | QR-challenge payload (`did`, `name`, `enc`, `nonce`, `ts`, `broker`) | **no version field** — Section 6 requires one |
| Challenge | `nonce` (UUID v4) | carries over; issuance time now required |
| Encounter credential | `WotVerification`-typed VC-JWS | type becomes DTG `WitnessCredential`; commitment added |
| Enactment key / commitment (5.4) | *absent* | **new**; replaces 0.1 cross-binding, removes the correlation handle |
| Enactment record (C5) | active challenge held until rotation; `pendingCounterVerification` | generalized to both directions, retains `e` |
| Acceptance gate | Trust 002 acceptance gate | carries over; error states named; issuance window added |
| Encounter grades | implicit `WotVerification` yes/no | replaced by one kind plus informative channel |

## Appendix B (informative): relation to prior specifications

On adoption this document supersedes `02-wot-trust/001-encounter
credentials.md` and `002-verifikation.md`. The credential envelope moves
to Layer 1 and the DTG mapping; group and permission concerns were never
part of these documents and live in Access. The remote-verification path
of Trust 002 §"Verifikation ohne physisches Treffen" is **removed**:
that relation is a path through the graph (Section 10), not a
credential.

## Appendix C (informative): vocabulary alignment with DTGWG Trust Ceremonies

The terms *ceremony* (definition), *enactment* (one run), and *step*
follow ToIP DTGWG ADR 0001, adopted deliberately after finding
independent convergence on the word and its rationale. This layer adopts
the vocabulary and the evidence framing (Section 8), not the Trust Tasks
mechanism; whether RLTP messages adopt Trust Tasks is a separate
decision tracked in `../design/trust-tasks-entscheidung-2026-08.md`.

## References

[RFC2119] · [RFC8174] BCP 14 · [RFC5869] HKDF · [RFC8785] JCS · W3C
Verifiable Credentials Data Model 2.0 · W3C VC-JOSE-COSE · DTG
Credential Specification (ToIP DTGWG, draft) · ToIP DTGWG Trust
Ceremonies ADR 0001 and design note (Proposed) · wot-spec v0.1
(superseded parts, Appendix B).
