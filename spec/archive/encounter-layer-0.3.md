# RLTP Encounter Layer

**Real Life Trust Protocol — Layer 2: Encounter**

- **Status:** Editor's Draft
- **Version:** 0.3.0-draft (third casting)
- **Editors:** Anton Tranelis
- **Date:** 2026-08-10
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Conformance profile:** `rltp-encounter@0.3` (draft)
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
witnessed succession, specified separately in *RLTP Succession*
(currently parked).

## Status of This Document

Third casting. It answers the Encounter-side roots of review round 2
(R1–R4, `../design/l2-review2-2026-08.md`) and folds in the securing
decision of `../design/proof-frage-2026-08.md` (`eddsa-jcs-2022`). The
0.2 privacy construction (enactment key and blinded commitment) is
withdrawn: under stable anchors the credential pair is inherently
correlatable, and this casting says so instead of decorating it. Wire
formats are normative JSON Schemas shipped in `../schemas/`. It awaits
adversarial review round 3; the convergence criterion is a casting whose
external review yields no blocker-level findings. Open issues:
Section 16.

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
   credential. Relations of other kinds are **paths and shared contexts
   derived from the graph**, computed rather than asserted.
3. **Recognition is not trust.** An encounter says "this person is real
   and I met them". It does not say "I trust them". Anything that
   requires deliberate trust is a separate, explicit act.

### 1.2 Position in the layer model

This layer consumes Layer-1 anchors and produces the edges that Layer 3
policies may reference and that applications display. It requires no
authority substrate. It uses the Delivery service through a port
(Section 11); nothing in this layer depends on a transport, and **nothing
in this layer depends on connectivity during an enactment**.

### 1.3 Design-principles note

*SRP:* this layer owns recognition and its record, nothing else. *OCP:*
ceremonies and channels are an open set extended by registration. *LSP:*
any enactment satisfying the contract in 5.2 produces an equivalent
encounter credential. *ISP:* consumers of an edge need not understand
the ceremony that produced it. *DIP:* the Delivery port is defined by
this layer's needs.

Two further principles govern this family:

- **Issuance counts, arrival does not.** Every validity judgment is a
  function of signed issuance-time data, never of when an artifact
  happened to arrive. Documents may travel for an unbounded time.
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
attach. In this casting, a `did:key` (2.3).

**Contact card** — a person's signed self-description carrying the
verification material needed to recognize and reach them. Not a
credential (Section 6).

**Challenge** — a fresh, single-use, high-entropy value published in a
contact card for one enactment (5.3).

**Ceremony** — a registered, versioned definition of an encounter
interaction (Section 5). *The ceremony is the definition, not the
meeting (DTGWG alignment, Appendix C).*

**Enactment** — one performed run of a ceremony between two people.
Never reused.

**Step** — one credential issuance within an enactment.

**Enactment binding** — the digest, identical in both step credentials
of an enactment, that proves they arose from one exchange (5.4).

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
| Contact card | `#ContactCard` | | Enactment binding | `#EnactmentBinding` |
| Challenge | `#Challenge` | | Encounter credential | `#EncounterCredential` |
| Ceremony | `#Ceremony` | | Edge | `#Edge` |
| Step | `#Step` | | | |

Referenced: **Credential** (W3C VC 2.0 + DTG types), **Delivery port**
*(services)*.

### 2.3 Interim securing profile

The Layer-1 (Identity) specification is not yet cast. Until it is, this
document is self-contained by requiring, normatively:

- An **anchor** is a **`did:key`** DID whose method-specific identifier
  encodes an Ed25519 public key. The anchor is therefore
  **self-certifying**: the signature-verification key is contained in
  the anchor itself, and no resolution, registry, or directory is
  involved at any point.
- Signatures under an anchor MUST verify under the Ed25519 key encoded
  in that anchor. *(This is the rule that binds keys to anchors; an
  artifact naming anchor X but verifying only under some other key is
  invalid, whatever it carries.)*
- A card's **key-agreement key** (X25519) is bound to the anchor by the
  card's proof (Section 6), which verifies under the anchor's key.
- Credentials and cards are W3C Verifiable Credentials 2.0 /
  JSON documents carrying an embedded **`DataIntegrityProof`** with
  cryptosuite **`eddsa-jcs-2022`** [DI-EDDSA]: canonicalization is JCS
  [RFC8785], the hash is SHA-256, the signature is Ed25519, and the
  proof's `verificationMethod` MUST be the anchor's `did:key`
  verification method. No RDF processing is required or permitted for
  verification.
- Digest values in this family are SHA-256 over JCS-canonicalized JSON,
  multibase-encoded (`base64url`, prefix `u`).

Method-agnosticism — supporting anchors whose keys are not contained in
the identifier — is a Layer-1 goal and is **not claimed by this
casting**. The Identity layer, when cast, defines the binding rule for
other methods and supersedes this section.

## 3. What an Encounter Establishes

An encounter establishes exactly four things, and implementations MUST
NOT present it as establishing more:

| Established | By |
|---|---|
| **Key control** — the issuer controlled their anchor's key | proof (2.3) |
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
subject, who holds it (receiver principle, 7.4). **The issuer keeps a
copy**; holding does not confer authority.

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
received. Delivery status never changes these states on its own.

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

### 4.3 Anchor scope, honestly stated

This casting requires `did:key` anchors (2.3). A counterparty using any
conforming client is therefore verifiable offline, from the card alone.
Interoperating with anchors of other DID methods is a Layer-1 concern:
it requires a binding rule between method and key material that this
layer must not invent. Until the Identity layer is cast, claims of DID
method-agnosticism would be unbacked, and this document makes none.

## 5. Ceremonies and Enactments

### 5.1 Registered ceremonies

A **ceremony** is a registered, versioned definition. Ceremonies are an
open set. This version registers two (5.8): `two-way-scan@0.3` and
`one-way-scan-online@0.3`. An enactment names the ceremony it enacts;
an encounter credential names it too.

### 5.2 The enactment contract

An interaction is an enactment of an encounter ceremony if and only if
it establishes all of:

- **C1 Material exchange.** Each party obtains the other's contact card,
  including a fresh challenge.
- **C2 Freshness.** Each challenge meets 5.3, is single-use, and is no
  older than `challenge-max-age` at the time of the enactment.
- **C3 Binding.** Each step credential binds the challenge of its
  **subject** and the enactment binding (5.4).
- **C4 Deliberate confirmation.** Before issuing, a human confirms
  recognition. Implementations MUST NOT issue encounter credentials
  automatically.
- **C5 Enactment record.** Each party durably records the enactment
  (5.5) before issuing.

Any interaction meeting C1–C5 is an enactment. Interactions that
establish something else (possession of a phone number, control of a
domain) are **not** encounter enactments and MUST NOT produce
credentials under this specification.

### 5.3 Challenges

A challenge MUST be a string of at least 128 bits of cryptographically
random material, encoded as base64url without padding. It is published
in its owner's contact card together with its **issuance time** and is
single-use: a challenge present in any enactment record MUST NOT be
accepted in a new enactment.

A step credential MUST bind the challenge published by its **subject**
in this enactment. This proves the issuer saw the subject's fresh card.
Acceptance is checked against the subject's own enactment record (5.6),
so the binding remains checkable **however late the credential is
delivered**.

### 5.4 The enactment binding

Both step credentials of an enactment carry the same **enactment
binding**:

```
binding = multibase-base64url(
  SHA-256( JCS( {
    "ceremony":   <ceremony identifier and version>,
    "challenges": [ <value_1>, <value_2> ]   // ascending lexicographic
                                             // order of the encoded strings
  } ) ) )
```

where the two values are the challenge values of the enactment (for
`one-way-scan-online`, the issuer nonce takes the place of the scanning
party's challenge, 5.8). JCS provides the framing: values are distinct
JSON strings, so no concatenation ambiguity exists.

The binding proves that two credentials carrying it arose from **one
exchange** — including when delivery happens much later — and it is
verifiable by anyone holding both credentials, with no participant
cooperation (Section 8).

*What the binding does not do (honesty note, normative for claims):*
it does not hide the relation. The two credentials of an enactment name
the two anchors as issuer and subject in plaintext; **anyone holding
both can correlate them from the anchors alone**. Under this protocol's
stable-anchor model (I13) that correlation is inherent, and
implementations and documentation MUST NOT claim otherwise. The 0.2
blinded-commitment construction claimed it and was withdrawn for that
reason.

### 5.5 The enactment record

Before issuing, each party MUST durably record: the ceremony identifier
and version; the counterparty anchor and its card as received; both
challenge values (or challenge and nonce); the computed enactment
binding; and the local time of the enactment. Records MUST be retained
for the life of the relation, and they subsume the consumed-challenge
history (5.3).

### 5.6 Acceptance

On receiving a credential claiming to be an encounter credential about
the local anchor, an implementation MUST evaluate, in order:

1. **Schema.** The document validates against
   `schemas/encounter-credential.schema.json`, and its ceremony and
   credential versions are known; else reject `ERR_VERSION`.
2. **Signature.** The `DataIntegrityProof` verifies under the Ed25519
   key encoded in the credential's issuer anchor (2.3); else reject
   `ERR_SIG`.
3. **Addressee.** `credentialSubject.id` is the local anchor; else
   reject `ERR_ADDRESSEE`.
4. **Record.** Exactly one enactment record exists whose own-challenge
   equals the credential's bound challenge. Challenges are single-use,
   so multiplicity indicates a local fault: with zero or multiple
   matches, reject `ERR_NO_RECORD`. The record's counterparty anchor
   MUST equal the credential's issuer, else `ERR_NO_RECORD`.
5. **Ceremony.** The credential's ceremony equals the record's ceremony;
   else reject `ERR_CEREMONY`.
6. **Issuance window.** With `t_ch` the issuance time of the local
   party's own challenge (5.3), the credential's `validFrom` MUST lie
   in the **closed** interval
   `[t_ch − skew-tolerance,
     t_ch + challenge-max-age + issuance-window + skew-tolerance]`;
   else reject `ERR_STALE_ISSUANCE`. Both endpoints are inclusive, and
   `skew-tolerance` always widens the interval — skew never rejects.
   *Late issuance is rejected here; late delivery is not: no rule in
   this document references arrival time, and `t_ch` is local, signed
   data.*
7. **Binding.** The enactment binding recomputes from the record per
   5.4; else reject `ERR_BINDING`.
8. **Uniqueness.** No credential has been accepted for this record and
   direction. A byte-identical credential (same digest) is accepted
   idempotently; a different one is rejected `ERR_CONFLICT`.

A credential failing any check is **not an encounter credential**. It
MAY be retained and displayed as an unverified claim; it MUST NOT be
counted as an encounter and MUST NOT satisfy a Layer-3 encounter
predicate. Each error state is a distinct conformance vector.

### 5.7 The channel is informative

The channel and its properties (in person, video, near-field) are
recorded in the encounter credential as informative metadata and carry
**no normative weight**. What a channel evidences beyond the four items
of Section 3 is a judgment for the humans and the applications, not a
protocol claim.

### 5.8 Registered ceremonies of this version

**`two-way-scan@0.3`.** Both parties display and scan each other's
cards; each records the enactment, confirms, issues, and delivers when
connectivity next allows. Requires no connectivity and no third party
during the enactment. Message flow: (1) A and B exchange cards
optically; (2) each computes the binding over the two challenges and
records; (3) each confirms and issues; (4) each delivers via the
Delivery port, unbounded in time.

**`one-way-scan-online@0.3`.** One party (A) scans; B's card is
obtained; A generates a **nonce** meeting the entropy and encoding rules
of 5.3, which takes the place of A's challenge in the binding. Message
flow: (1) A scans B's card; (2) A records, confirms, issues its step
credential binding B's challenge, and delivers it to B **together with
the nonce and A's card** over an authenticated channel; (3) B records
(B's own challenge, A's card, the nonce) and verifies under 5.6 —
B's window in step 6 is anchored to `t_ch` of B's own challenge, so the
late creation of B's record has no bearing; (4) B MAY confirm in turn
and issue the counter-step, binding A's card challenge and the same
enactment binding. Requires connectivity for at least one party. Until
step (4), the edge is one-sided.

## 6. The Contact Card

A contact card is a person's **self-description**. It is explicitly
**not a credential**: it asserts nothing about anyone but its author,
and carries no third-party signature.

A card MUST validate against `schemas/contact-card.schema.json` and
carries: a **format version**; the **anchor**; a **key-agreement key**
(X25519, multibase) for encrypting to the author; a **challenge** with
its **issuance time**, when the card is used in an enactment; and a
`DataIntegrityProof` per 2.3, verifying under the anchor. It MAY carry
a display name and delivery hints. *(The signature key travels in the
anchor itself; the card's proof is what binds the key-agreement key to
it.)*

A party encountering a card with an **unknown version** MUST NOT enter
an enactment with it, and MAY import its display fields as an unverified
contact. Degradation is always toward less assurance.

The name in a card is **self-declared** and MUST NOT be treated as
verified. Recipients bind their own local name to the anchor (petname
principle).

Cards are updated in the relationship: a party MAY send an updated card
to those who hold one.

## 7. The Encounter Credential

### 7.1 Form

An encounter credential is a W3C Verifiable Credential 2.0 secured per
2.3, of type `VerifiableCredential`, `DTGCredential`,
**`WitnessCredential`** (DTG). Statements *about* a person that are not
encounters use `EndorsementCredential` and are outside this
specification.

### 7.2 Data model

The normative wire format is `schemas/encounter-credential.schema.json`.
Field placement: protocol fields live in `credentialSubject`, alongside
the subject anchor.

| Property | Type | Card. | Content |
|---|---|---|---|
| `issuer` | anchor | 1 | the recognizing party |
| `validFrom` | datetime | 1 | issuance time (SHOULD equal enactment time) |
| `credentialSubject.id` | anchor | 1 | the recognized party |
| `credentialSubject.ceremony` | string | 1 | registered ceremony id and version |
| `credentialSubject.challenge` | string | 1 | the subject's challenge value (5.3) |
| `credentialSubject.enactmentBinding` | multibase | 1 | per 5.4 |
| `credentialSubject.channel` | string | 0..1 | informative (5.7) |
| `proof` | object | 1 | `DataIntegrityProof`, `eddsa-jcs-2022` (2.3) |

The credential MUST NOT carry the counterparty's challenge or nonce.
Unknown additional properties MUST be ignored on verification and MUST
NOT contribute assurance.

### 7.3 Immutability

Encounter credentials are immutable and are **never revoked**. A changed
assessment is expressed by issuing a new credential; both remain true of
their moment. A credential is a durable, independently meaningful claim
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

A single credential is verified from its content alone: proof under the
issuer anchor's key (2.3), schema validity. This requires no
cooperation.

**Mutuality** is proven by presenting both step credentials of an
enactment. The verifier checks both proofs, checks that issuer and
subject anchors are reciprocal, that each credential binds its own
subject's challenge, and that both carry the **same enactment binding**,
which recomputes from the two bound challenges per 5.4. No participant
cooperation is required — and, per the honesty note in 5.4, none could
be: the pair is correlatable from the anchors regardless.

*(Informative: in DTGWG evidence terms, the credential pair is
`countersigned` evidence of the enactment — each participant signed
their step, and the shared binding joins them. A two-party enactment
has no recorder, and needs none.)*

## 9. Time Parameters

| Parameter | Default | Meaning |
|---|---|---|
| `challenge-max-age` | PT24H | max age of a challenge at enactment time (C2) |
| `issuance-window` | PT24H | max delay from enactment to credential issuance |
| `skew-tolerance` | PT5M | clock-skew allowance; always widens intervals (5.6 step 6) |

Defaults MAY be tightened by deployment profiles and MUST NOT be
loosened beyond one order of magnitude. All intervals in this document
are closed (endpoints inclusive). All comparisons use signed times in
artifacts and the local record; **no rule in this layer references
arrival time**. Retention: enactment records for the life of the
relation (5.5).

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
possible without any service (`two-way-scan`, 5.8). The message
semantics of this port are specified in the RLTP Delivery Contract
(pending; adopted decision: private Trust Task specifications).

## 12. Evolvability

- Every wire artifact carries an explicit version; **contact cards carry
  a format version** (Section 6), because the card is the first artifact
  exchanged between strangers and must be able to negotiate future
  ceremonies.
- New ceremonies, channels and card fields register new identifiers;
  existing ones are never re-interpreted.
- Unknown constructs degrade toward *less* assurance: an unknown
  ceremony or card version is rejected from enactment and acceptance;
  unknown informative fields are ignored.
- Renames only via alias table; the binding construction string layout
  (5.4) is never renamed.

## 13. Security Considerations

- **Freshness is not presence.** The challenge proves the exchange was
  live, not that the parties shared a room; a channel can be relayed.
  Implementations MUST NOT claim presence.
- **The confirmation step is the security boundary.** C4 is where a
  human decides. Automating it removes the only thing this layer
  actually secures.
- **Keys are bound to anchors by construction.** A `did:key` anchor
  contains its verification key; an artifact naming an anchor but
  verifying under a different key is invalid (2.3). A card cannot
  smuggle foreign key material under someone else's anchor, because the
  card's proof must verify under the anchor itself.
- **Replay and substitution.** Challenge binding plus the uniqueness
  check prevent reuse of a captured credential and substitution of a
  second credential onto a consumed challenge. A photographed card is
  useless once its challenge is consumed or aged out.
- **Late issuance is the attack; late delivery is not.** A card pocketed
  and signed weeks later would fabricate an encounter that never
  completed; the issuance window (5.6 step 6) rejects it on the
  subject's side regardless of how long delivery took, anchored to the
  subject's own challenge issuance time.
- **Challenge entropy is load-bearing.** With ≥128-bit random
  challenges (5.3), the binding is not enumerable from one credential;
  low-entropy challenges would make the counter-credential linkable by
  brute force and are non-conformant.
- **Collusion bounds the value of counting.** Two parties can mutually
  attest without meeting. Edge counts are evidence of interaction cost,
  not of honesty; Layer-3 policies relying on them MUST state that
  assumption.
- **Time gates are layered consistently.** Every gate tolerates
  `skew-tolerance` by widening; an inner gate stricter than an outer
  accepting gate silently drops accepted material and is non-conformant.

## 14. Privacy Considerations

- **Encounter credentials are addressee-bound.** They are delivered to
  the subject and published only by the subject's deliberate act. The
  protocol provides no directory.
- **The credential pair is correlatable, and this document says so.**
  Anyone holding both credentials of an enactment sees the edge: the
  anchors are plaintext, and the shared enactment binding confirms the
  exchange. This is the direct consequence of stable anchors (I13),
  which buy unforgeable edge counting and offline verification. What
  protects the relation is **possession**: each credential is held by
  its subject and disclosed by choice. Minimal-disclosure presentations
  are Open Issue OI-3.
- **Cards reveal what their author put in them.** A card carries
  verification material by necessity; anything else is the author's
  choice, and implementations SHOULD default to minimal cards.
- **Anchors are stable and therefore correlatable** across contexts.
  Channel and service identifiers MAY be derived per relationship; the
  anchor is not.

## 15. Conformance

- **Profile** `rltp-encounter@0.3`; includes the interim securing
  profile (2.3) until `rltp-identity` is cast.
- **Classes:** *participant* (enactments, issuance, acceptance) ·
  *verifier* (credential and mutuality verification only).
- **Normative schemas (shipped):**
  `schemas/encounter-credential.schema.json`,
  `schemas/contact-card.schema.json`.
- **Vector plan:** enactment contract compliance (C1–C5) · challenge
  entropy/encoding conformance · binding computation (both ceremonies,
  including lexicographic ordering) · every error state of 5.6 as a
  distinct vector, including idempotent re-delivery, `ERR_CEREMONY`
  and `ERR_CONFLICT` · window boundary vectors at both inclusive
  endpoints, with and without skew · delayed delivery of a two-way
  enactment (accepted) versus late issuance (rejected) · one-way
  enactment with late record creation (accepted; the F4 case) ·
  mutuality verification with matching and non-matching bindings ·
  card versioning and unknown-version refusal · card with foreign key
  material under another anchor (rejected; the F3 case) · edge-state
  transitions of 4.2.
- Every normative statement is vector-testable or explicitly marked
  state-dependent (the enactment record, the confirmation step).

## 16. Open Issues

- **OI-1 Group encounters.** *n* people in a circle currently require
  *n(n−1)/2* pairwise enactments.
- **OI-2 Shared contexts.** "Attended the same event" — a derived
  relation with no credential. Form and evidence undefined.
- **OI-3 Minimal-disclosure presentation.** Which bundle satisfies a
  Layer-3 encounter predicate with least disclosure. *(The 0.2 blinded
  construction is withdrawn; if selective disclosure is wanted, it must
  come from the presentation layer — e.g. SD-JWT or a ZK form — not
  from hiding values that the anchors reveal anyway.)*
- **OI-4 Time and renewal.** Whether the age of an edge is expressible,
  and whether repeated encounters between the same anchors are
  distinguishable from one.
- **OI-5 Card format alignment.** Whether to adopt an established
  contact interchange format, and at what cost to minimality.

## Appendix A (informative): bindings to the current implementation

| This specification | wot-core v0.x | Status |
|---|---|---|
| Contact card | QR-challenge payload (`did`, `name`, `enc`, `nonce`, `ts`, `broker`) | **no version field**; challenge entropy to verify against 5.3 |
| Challenge | `nonce` (UUID v4) | **UUID v4 has 122 random bits — conforms**; issuance time now required |
| Encounter credential | `WotVerification`-typed VC-JWS | becomes DTG `WitnessCredential` with embedded `eddsa-jcs-2022` proof — one migration, two changes |
| Enactment binding (5.4) | *absent* | **new**; restores the 0.1 cross-binding purpose with framing, honestly labeled |
| Enactment record (C5) | active challenge held until rotation; `pendingCounterVerification` | generalized to both directions |
| Acceptance gate | Trust 002 acceptance gate | carries over; error states named; window anchored to challenge issuance |

## Appendix B (informative): relation to prior specifications

On adoption this document supersedes `02-wot-trust/001-encounter
credentials.md` and `002-verifikation.md`. The remote-verification path
of Trust 002 §"Verifikation ohne physisches Treffen" is **removed**:
that relation is a path through the graph (Section 10), not a
credential.

## Appendix C (informative): vocabulary alignment with DTGWG Trust Ceremonies

The terms *ceremony* (definition), *enactment* (one run), and *step*
follow ToIP DTGWG ADR 0001, adopted deliberately after finding
independent convergence on the word and its rationale. This layer adopts
the vocabulary and the evidence framing (Section 8). RLTP messages adopt
Trust Tasks as private specifications (decision of 2026-08-10); the
message layer is specified in the RLTP Delivery Contract, not here.

## References

[RFC2119] · [RFC8174] BCP 14 · [RFC8785] JCS · [DI-EDDSA] W3C Data
Integrity EdDSA Cryptosuites v1.0 (`eddsa-jcs-2022`) · W3C Verifiable
Credentials Data Model 2.0 · DTG Credential Specification (ToIP DTGWG,
draft) · ToIP DTGWG Trust Ceremonies ADR 0001 and design note
(Proposed) · did:key method draft · wot-spec v0.1 (superseded parts,
Appendix B).
