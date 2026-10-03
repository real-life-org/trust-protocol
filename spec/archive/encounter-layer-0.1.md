# RLTP Encounter Layer

**Real Life Trust Protocol — Layer 2: Encounter**

- **Status:** Editor's Draft
- **Version:** 0.1.0-draft (first casting)
- **Editors:** Anton Tranelis
- **Date:** 2026-08-09
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Conformance profile:** `rltp-encounter@0.1` (draft)
- **Supersedes on adoption:** `02-wot-trust/001-encounter credentials.md` and
  `002-verifikation.md` (wot-spec v0.1, German); see Appendix B.

## Abstract

This document specifies the Encounter layer of the Real Life Trust
Protocol: how two people establish, record, and maintain the fact that
they have met and recognized each other.

An encounter is a **ceremony** in which each party sees the other's fresh
challenge and deliberately confirms recognition. Its product is an
**encounter credential**, immutable and issued to the person it is about.
Credentials between two anchors form an **edge**, which may be one-sided
or mutual. A ceremony may take several forms and the channel used is
recorded; each form produces the same kind of credential. Relations that
are not encounters — knowing someone through a mutual contact, say —
exist as paths in the graph and are computed rather than asserted.

Cryptography proves freshness and authorship; only a human can witness a
human. When a person's anchor changes, their edges follow through
witnessed succession, specified separately in *RLTP Succession*.

## Status of This Document

First casting. It is written against requirements V1–V8 and the layer-1
requirements I1–I14 revision 2 (`../design/`), and against the design
decisions recorded in that series. It awaits adversarial review; the
convergence criterion is a casting whose external review yields no
blocker-level findings. Open issues: Section 13.

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
2. **An encounter is one thing.** A ceremony establishes fresh mutual
   recognition; whatever form it takes, it produces the same credential.
   Relations of other kinds — "A knows B through C", "both attended the
   same event" — are **paths and shared contexts derived from the
   graph**, computed rather than asserted.
3. **Recognition is not trust.** An encounter says "this person is real
   and I met them". It does not say "I trust them". Anything that
   requires deliberate trust — notably guardianship, specified in
   *RLTP Succession* — is a separate, explicit act.

### 1.2 Position in the layer model

This layer consumes Layer-1 anchors and produces the edges that Layer 3
policies may reference and that applications display. It requires no
authority substrate. It uses the Delivery service through a port
(Section 10); nothing in this layer depends on a transport.

### 1.3 Design-principles note

*SRP:* this layer owns recognition and its record, nothing else — no
permissions, no group semantics. *OCP:* ceremonies and channels are an
open set extended by registration. *LSP:* any ceremony satisfying the
contract in 5.1 produces an equivalent encounter credential. *ISP:*
consumers of
an edge need not understand the ceremony that produced it. *DIP:* the
Delivery port is defined by this layer's needs.

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
attach. This layer makes no assumption about its DID method (5.3).

**Contact card** — a person's self-description carrying the verification
material needed to recognize and reach them. Not a credential (Section 6).

**Challenge** — a fresh, single-use value published in a contact card for
one ceremony.

**Ceremony** — an interaction establishing fresh mutual recognition
(Section 5).

**Encounter credential** — the immutable credential in which one party
records that they recognized another (Section 7).

**Edge** — the relation between two anchors constituted by one or more
encounter credentials; **incoming**, **outgoing**, or **mutual**.

| Term | Fragment | | Term | Fragment |
|---|---|---|---|---|
| Anchor | `#Anchor` | | Edge | `#Edge` |
| Contact card | `#ContactCard` | | | |
| Challenge | `#Challenge` | | | |
| Ceremony | `#Ceremony` | | | |
| Encounter credential | `#EncounterCredential` | | | |

Referenced: **Credential** (W3C VC 2.0 + DTG types), **Delivery port**
*(L3/services)*, **recovery seed / device key** *(L1)*.

## 3. What an Encounter Establishes

An encounter establishes exactly four things, and implementations MUST
NOT present it as establishing more:

| Established | By |
|---|---|
| **Key control** — the issuer controlled their anchor's key | signature |
| **Freshness** — the exchange happened within one ceremony | challenge binding (5.2) |
| **Deliberate recognition** — a human decided to confirm | the confirmation step (5.1, C4) |
| **A durable record** — the fact survives the moment | the encounter credential (Section 7) |

It does **not** establish physical presence (a channel may be relayed),
personhood (only the witnessing human asserts that), identity of a name
to a legal person, or trust.

## 4. Anchors, Credentials, Edges

### 4.1 The atom is the encounter credential

An encounter credential is issued by one party about another. It is the atom
of
this layer. It is complete on its own and is delivered to its subject,
who holds it (receiver principle, 7.3).

### 4.2 The edge is the relation

An **edge** between anchors A and B is constituted by the encounter
credentials
that exist between them. Implementations MUST distinguish:

- **incoming** (someone attested me) — evidence *about* the subject,
  because a third party signed it;
- **outgoing** (I attested someone) — evidence about the other party,
  and **no evidence about the issuer**, who signed it themselves;
- **mutual** — encounter credentials in both directions from the same ceremony.

Counting or evaluating a person's edges (for example in a Layer-3 policy
predicate) MUST consider incoming encounter credentials only, or mutual edges;
outgoing encounter credentials MUST NOT count toward the issuer's own
standing.

Mutuality is a **semantic** property, not a security measure: two
colluding people can attest each other. The cost of an edge is the
encounter itself.

### 4.3 The anchor is method-agnostic

An encounter credential references anchors as identifiers. This layer places
no
requirement on the DID method beyond those of Layer 1. Verification
material needed at first contact travels in the contact card (Section 6),
**not** through resolution — this is the interoperability seam: a
counterparty using an online-resolved method remains verifiable offline
because their card carries what is needed.

## 5. Ceremonies

### 5.1 The ceremony contract

A ceremony is an encounter ceremony if and only if it establishes all of:

- **C1 Material exchange.** Each party obtains the other's contact card,
  including a fresh challenge.
- **C2 Freshness.** Each challenge is single-use and generated for this
  ceremony.
- **C3 Binding.** Each encounter credential binds the challenge of its **subject**
  (5.2).
- **C4 Deliberate confirmation.** Before issuing, a human confirms
  recognition. Implementations MUST NOT issue encounter credentials
  automatically.
- **C5 Local record.** Each party durably records the ceremony,
  minimally: counterparty anchor, own challenge, counterparty challenge,
  time. Acceptance is checked against this record (5.4).

Any interaction meeting C1–C5 produces an encounter credential, whatever
form the interaction took. Interactions that establish something else
(possession of a phone number, control of a domain) are **not** encounter
ceremonies and MUST NOT produce credentials under this specification.

### 5.2 Challenge binding and cross-binding

An encounter credential MUST bind the challenge published by its **subject**
in
this ceremony. This proves the issuer saw the subject's fresh card.

Where both parties exchange cards (a two-way ceremony), each encounter
credential
MUST additionally name the issuer's own challenge. Both encounter
credentials then
reference the same challenge pair, which proves they arose from one
exchange — **including when delivery happens much later**.

*Rationale (informative):* without cross-binding, an encounter credential
from a
disconnected two-way ceremony arrives after its subject has rotated their
card, cannot be matched, and is rejected. The strongest ceremony would
produce the weakest outcome. Cross-binding removes the dependency on a
still-live challenge.

### 5.3 The channel is informative

The channel and its properties (in person, video, near-field) are
recorded in the encounter credential as informative metadata and carry
**no normative weight**. What a channel evidences beyond the four items
of Section 3 is a judgment for the humans and the applications, not a
protocol claim.

### 5.4 Acceptance

On receiving an encounter credential, a party MUST verify: signature validity;
that it is addressed to the local anchor; that the bound challenge
matches a ceremony in the local record (C5); and that the challenge has
not been consumed before. A conforming implementation MUST maintain a
consumed-challenge history sufficient to reject replays.

A credential failing these checks is **not an encounter credential**. It
MAY be retained and displayed as an unverified claim; it MUST NOT be
counted as an encounter, and MUST NOT satisfy a Layer-3 encounter
predicate.

### 5.5 Registered ceremony profiles

Profiles are an open set. This version registers:

- **`two-way-scan`** — both parties display and scan; both encounter credentials
  cross-bound (5.2). Requires no connectivity during the ceremony.
- **`one-way-scan-online`** — one party scans; the encounter credential is
  delivered immediately and the subject counter-attests, referencing the
  first encounter credential. Requires connectivity for at least one party.

## 6. The Contact Card

A contact card is a person's **self-description**. It is explicitly
**not a credential**: it asserts nothing about anyone but its author, and
carries no third-party signature.

It MUST carry: a version identifier; the anchor; verification material
sufficient to verify the author's signatures and to encrypt to them
without online resolution; and, when used in a ceremony, a challenge.
It MAY carry a display name and delivery hints.

The name in a card is **self-declared** and MUST NOT be treated as
verified. Recipients bind their own local name to the anchor
(petname principle).

Cards are updated in the relationship: a party MAY send an updated card
to those who hold one. Card format SHOULD be aligned with an established
contact interchange format where this does not conflict with the above.

## 7. The Encounter Credential

### 7.1 Form

An encounter credential is a W3C Verifiable Credential 2.0 secured as
specified in
Layer 1, of DTG type **`WitnessCredential`**, with a witness context
carrying the ceremony profile, the bound challenge(s), and the channel
(5.3). Statements *about* a person that are not encounters use
`EndorsementCredential` and are outside this specification.

### 7.2 Immutability

Encounter credentials are immutable and are **never revoked**. A changed
assessment is expressed by issuing a new encounter credential; both remain
true of
their moment. *(This is the property that distinguishes this layer from
Access: recognition is a testimony about the past, access is a grant in
the present.)*

### 7.3 Receiver principle

An encounter credential belongs to its subject. It is delivered to them; they
decide whether to keep, display, or publish it. Issuers retain no
authority over it and receive no protocol-level signal of acceptance.
Transport acknowledgements MUST NOT be presented as acceptance.

## 8. Paths and Shared Contexts (informative)

Relations weaker than an encounter are **computed, not asserted**:

- *A knows B through C* — a path in the graph. No credential exists or
  should exist; the honest reading is that A trusts C's judgment.
- *A and B share a context* — both hold edges into the same group or
  attended the same event. Derived from Layer 3 membership or from a
  shared context artifact (Open Issue OI-3).

Because these are derived, they cannot be forged independently of the
edges they rest on.

## 9. Service Port

**Delivery.** This layer requires authenticated, end-to-end-encrypted
delivery of encounter credentials to a subject, with
durable buffering and explicit delivery status; silent loss is
non-conformant. Ceremonies themselves MUST be possible without any
service (two-way-scan, 5.5).

## 10. Evolvability

- Every wire artifact carries an explicit version (`rltp-encounter/0.1`);
  **contact cards carry a version identifier** (Section 6), because the
  card is the first artifact exchanged between strangers and must be able
  to negotiate future ceremonies.
- New ceremony profiles, channels and card fields register new
  identifiers; existing ones are never re-interpreted.
- Unknown constructs degrade toward *less* assurance: an unknown ceremony
  profile means the encounter credential is not accepted as an encounter
  (5.4);
  unknown informative fields are ignored.
- Renames only via alias table; key-derivation paths are never renamed.

## 11. Security Considerations

- **Freshness is not presence.** The challenge proves the exchange was
  live, not that the parties shared a room; a channel can be relayed.
  Implementations MUST NOT claim presence.
- **The confirmation step is the security boundary.** C4 is where a human
  decides. Automating it — issuing on scan without confirmation — removes
  the only thing this layer actually secures.
- **Replay.** Challenge binding plus consumed-challenge history prevents
  reuse of a captured encounter credential. Cards that are photographed become
  useless once their challenge is consumed or rotated.
- **Collusion bounds the value of counting.** Two parties can mutually
  attest without meeting. Edge counts are therefore evidence of
  interaction cost, not of honesty; Layer-3 policies relying on them
  MUST state that assumption.
- **Time gates.** Challenge and ceremony-record validity MUST apply a
  bounded, configured skew tolerance consistent with the enclosing
  delivery gates; an inner gate stricter than an outer accepting gate
  silently drops accepted material.

## 12. Privacy Considerations

- **Encounter credentials are addressee-bound.** They are delivered to the subject
  and published only by the subject's deliberate act. The protocol
  provides no directory.
- **Cards reveal what their author put in them.** A card carries
  verification material by necessity; anything else is the author's
  choice, and implementations SHOULD default to minimal cards.
- **Anchors are stable and therefore correlatable** across contexts. This
  is the chosen trade of Layer 1 (I13): it buys unforgeable edge counting
  and offline verification. Channel and service identifiers MAY be
  derived per relationship; the anchor is not.

## 13. Conformance

- **Profile** `rltp-encounter@0.1`; requires `rltp-identity@…`.
- **Classes:** *participant* (full: ceremonies, issuance, acceptance,
  ceremonies, issuance, acceptance) · *verifier* (credential verification
  only).
- **Vector plan:** ceremony contract compliance (C1–C5) · challenge
  binding and cross-binding · acceptance gate including replay,
  unknown-challenge and stale-record rejection · delayed delivery of a
  two-way ceremony (the case that fails without cross-binding) ·
  encounter credential form and DTG mapping · edge direction and counting
  rules ·
  card versioning and unknown-field handling.
- Every normative statement is vector-testable or explicitly marked
  state-dependent (the local ceremony record, the confirmation step).

## 14. Open Issues

- **OI-1 Group encounters.** *n* people in a circle currently require
  *n(n−1)/2* pairwise ceremonies. A collective ceremony would need a
  shared context artifact and a definition of what it establishes for
  each pair.
- **OI-2 Shared contexts.** "Attended the same event", "scanned the same
  code" — a derived relation with no credential. Form and evidence
  undefined.
- **OI-3 Minimal-disclosure presentation.** Which bundle satisfies a
  Layer-3 encounter predicate with least disclosure.
- **OI-4 Time and renewal.** Whether the age of an edge is expressible,
  and whether repeated encounters between the same anchors are
  distinguishable from one.
- **OI-5 Card format alignment.** Whether to adopt an established contact
  interchange format, and at what cost to minimality.

## Appendix A (informative): bindings to the current implementation

| This specification | wot-core v0.x | Status |
|---|---|---|
| Contact card | QR-challenge payload (`did`, `name`, `enc`, `nonce`, `ts`, `broker`) | **no version field** — Section 11 requires one |
| Challenge | `nonce` (UUID v4) | carries over |
| Encounter credential | `WotVerification`-typed VC-JWS | type becomes DTG `WitnessCredential` |
| Cross-binding (5.2) | *absent* — only the subject's nonce is bound | **new**; resolves the delayed-delivery degradation |
| Local ceremony record (C5) | active challenge held until rotation; `pendingCounterVerification` | generalized to both directions |
| Acceptance gate | Trust 002 acceptance gate | carries over; degraded class removed |
| Encounter grades | implicit `WotVerification` yes/no | replaced by one kind plus informative channel |

## Appendix B (informative): relation to prior specifications

On adoption this document supersedes `02-wot-trust/001-encounter
credentials.md`
and `002-verifikation.md`. The credential envelope moves to Layer 1 and
the DTG mapping; group and permission concerns were never part of these
documents and live in Access. The remote-verification path of Trust 002
§"Verifikation ohne physisches Treffen" is **removed**: that relation is
a path through the graph (Section 8), not a credential.

## References

[RFC2119] · [RFC8174] BCP 14 · [RFC8785] JCS · W3C Verifiable Credentials
Data Model 2.0 · DTG Credential Specification (ToIP DTGWG, draft) ·
wot-spec v0.1 (superseded parts, Appendix B).
