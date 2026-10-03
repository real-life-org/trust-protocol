# RLTP Encounter Layer

**Real Life Trust Protocol — Layer 2: Encounter**

- **Status:** Editor's Draft
- **Version:** 0.4.0-draft (fourth casting)
- **Editors:** Anton Tranelis
- **Date:** 2026-08-10
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Conformance profile:** `rltp-encounter@0.4` (draft)
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
of credential. Relations that are not encounters exist as paths in the
graph and are computed rather than asserted.

Cryptography proves freshness and authorship; only a human can witness a
human. When a person's anchor changes, their edges follow through
witnessed succession, specified separately in *RLTP Succession*
(currently parked).

## Status of This Document

Fourth casting. It answers review round 3
(`../design/l2-review3-2026-08.md`): the one-way ceremony is recast as a
synchronous enactment whose online leg is part of the enactment itself;
the nonce takes the challenge's place throughout; and a second round of
honesty debts is paid — third-party mutuality verification, the
issuer's retained copy, and the limits of edge counting are now stated
as they are. Wire formats are normative JSON Schemas shipped in
`../schemas/`. It awaits adversarial review round 4; the convergence
criterion is a casting whose external review yields no blocker-level
findings. Open issues: Section 16.

## 1. Introduction (informative)

### 1.1 Essence

> An encounter is a **protocolled act of mutual recognition between
> people**, cryptographically bound to key control and freshness, whose
> cost is a real interaction and whose yield is a durable, immutable
> record between stable anchors.

Three consequences shape this document:

1. **The protocol does not prove personhood.** It proves that a key was
   controlled and that an exchange was fresh. That a human is present,
   and that this human is the one they appear to be, is witnessed by
   another human. Because anchors are free to create, nothing in a
   credential proves that distinct anchors are distinct people; what the
   protocol makes expensive is forging an edge **to a specific, known
   anchor** — not manufacturing edges among anchors nobody knows
   (Section 13).
2. **An encounter is one thing.** An enactment establishes fresh mutual
   recognition; whatever ceremony it enacts, it produces the same kind
   of credential. Relations of other kinds are **paths and shared
   contexts derived from the graph**, computed rather than asserted.
3. **Recognition is not trust.** An encounter says "this person is real
   and I met them". It does not say "I trust them". Anything that
   requires deliberate trust is a separate, explicit act.

### 1.2 Position in the layer model

This layer consumes Layer-1 anchors and produces the edges that Layer 3
policies may reference and that applications display. It requires no
authority substrate. It uses the Delivery service through a port
(Section 11); nothing in this layer depends on a transport, and **the
`two-way-scan` ceremony depends on no connectivity at all**.

### 1.3 Design-principles note

*SRP:* this layer owns recognition and its record, nothing else. *OCP:*
ceremonies and channels are an open set extended by registration. *LSP:*
any enactment satisfying the contract in 5.2 produces an equivalent
encounter credential. *ISP:* consumers of an edge need not understand
the ceremony that produced it. *DIP:* the Delivery port is defined by
this layer's needs.

Two further principles govern this family:

- **Issuance counts, arrival does not — for delivery after an
  enactment.** The validity of a credential delivered after its
  enactment is a function of signed and locally recorded issuance-time
  data, never of when it arrived; such documents may travel for an
  unbounded time. A ceremony MAY, however, include a synchronous leg
  **inside** the enactment (5.8); real-time checks on that leg bound
  the enactment itself and do not touch this principle.
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
contact card for one enactment (5.3). In `one-way-scan-online`, the
scanning party's **nonce** takes the challenge's place in every rule of
this document (5.8).

**Ceremony** — a registered, versioned definition of an encounter
interaction, **including its time parameters** (Sections 5, 9).

**Enactment** — one performed run of a ceremony between two people.
Never reused.

**Step** — one credential issuance within an enactment.

**Enactment binding** — the digest, identical in both step credentials
of an enactment, that ties them to one exchange descriptor (5.4).

**Enactment record** — a party's durable local record of an enactment
(5.5).

**Encounter credential** — the immutable credential in which one party
records that they recognized another (Section 7).

**Credential digest** — `SHA-256(JCS(document))` over the complete
credential including its proof, multibase-encoded as in 2.3. The
identity of a credential for idempotency and conflict decisions
(5.6 step 8).

**Edge** — the relation between two anchors constituted by the
encounter credentials between them; **incoming**, **outgoing**, or
**mutual** (4.2).

| Term | Fragment | | Term | Fragment |
|---|---|---|---|---|
| Anchor | `#Anchor` | | Enactment | `#Enactment` |
| Contact card | `#ContactCard` | | Enactment binding | `#EnactmentBinding` |
| Challenge | `#Challenge` | | Encounter credential | `#EncounterCredential` |
| Ceremony | `#Ceremony` | | Credential digest | `#CredentialDigest` |
| Step | `#Step` | | Edge | `#Edge` |

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
  in that anchor. An artifact naming anchor X but verifying only under
  some other key is invalid, whatever it carries.
- A card's **key-agreement key** is an X25519 public key encoded as a
  **Multikey**: multibase `base58btc` over the multicodec
  `x25519-pub` prefix followed by the 32 key bytes (the `z6LS…` form).
  Raw, unprefixed keys are non-conformant. The card's proof binds it to
  the anchor (Section 6).
- Credentials and cards are JSON documents carrying an embedded
  **`DataIntegrityProof`** with cryptosuite **`eddsa-jcs-2022`**
  [DI-EDDSA]: canonicalization is JCS [RFC8785], the hash is SHA-256,
  the signature is Ed25519, and the proof's `verificationMethod` MUST
  be the anchor's `did:key` verification method. No RDF processing is
  required or permitted for verification.
- Digest values are SHA-256 over JCS-canonicalized JSON,
  multibase-encoded (`base64url`, prefix `u`).
- All timestamps are [RFC3339] date-times in UTC with the `Z`
  designator, enforced by pattern in the schemas — schema validation
  MUST NOT depend on JSON Schema `format` assertion, which is
  annotation-only in the general meta-schema.

Method-agnosticism is a Layer-1 goal and is **not claimed by this
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
to a legal person, or trust. Freshness and recognition are established
**toward the participants**; what a third party can later verify is
strictly less (Section 8).

## 4. Anchors, Credentials, Edges

### 4.1 The atom is the encounter credential

An encounter credential is issued by one party about another. It is the
atom of this layer. It is complete on its own and is delivered to its
subject, who holds it (7.4). **The issuer keeps a copy**; holding does
not confer authority.

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

**What counting is worth, honestly:** anchors are free to create, so
edges between unknown anchors are free to manufacture. An edge count is
meaningful only **relative to anchors the evaluator already has reason
to care about** — typically through paths from the evaluator's own
position, or through a Layer-3 group context. A Layer-3 policy that
counts edges MUST state this assumption; a raw count over unknown
anchors is not evidence of anything.

### 4.3 Anchor scope, honestly stated

This casting requires `did:key` anchors (2.3). A counterparty using any
conforming client is therefore verifiable offline, from the card alone.
Interoperating with anchors of other DID methods is a Layer-1 concern;
until the Identity layer is cast, claims of DID method-agnosticism would
be unbacked, and this document makes none.

## 5. Ceremonies and Enactments

### 5.1 Registered ceremonies

A **ceremony** is a registered, versioned definition, and the
registration **pins the ceremony's time parameters** (Section 9).
Ceremonies are an open set. This version registers two (5.8):
`two-way-scan@0.4` and `one-way-scan-online@0.4`. An enactment names
the ceremony it enacts; an encounter credential names it too. Two
conforming parties evaluating the same credential under the same
registered ceremony therefore reach the same verdict; there is no
deployment-local parameter variation to disagree over.

### 5.2 The enactment contract

An interaction is an enactment of an encounter ceremony if and only if
it establishes all of:

- **C1 Material exchange.** Each party obtains the other's contact card;
  the material includes one fresh value per party (challenge or nonce,
  5.3).
- **C2 Freshness.** Each fresh value meets 5.3, is single-use, and is no
  older than `challenge-max-age` at the time of the enactment.
- **C3 Binding.** Each step credential binds the fresh value of its
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

### 5.3 Challenges and nonces

A challenge MUST be a string of 22 to 88 characters of base64url
alphabet without padding, carrying at least 128 bits of
cryptographically random material; producers SHOULD emit exactly 22
characters (132 bits). It is published in its owner's contact card
together with its **issuance time** and is single-use: a value present
in any enactment record MUST NOT be accepted in a new enactment.

A **nonce** (`one-way-scan-online`, 5.8) meets the same entropy,
encoding, and single-use rules; its issuance time is the moment of its
generation, recorded locally by its generator. Wherever this document
says *challenge*, the nonce stands in its place for the party that
generated it.

A step credential MUST bind the fresh value of its **subject** in this
enactment. This proves the issuer saw it. Acceptance is checked against
the subject's own enactment record (5.6), so the binding remains
checkable however late the credential is delivered.

### 5.4 The enactment binding

Both step credentials of an enactment carry the same **enactment
binding**:

```
binding = multibase-base64url(
  SHA-256( JCS( {
    "ceremony":   <ceremony identifier and version>,
    "challenges": [ <value_1>, <value_2> ]   // the two fresh values,
                                             // ascending lexicographic
                                             // order of the strings
  } ) ) )
```

JCS provides the framing: values are distinct JSON strings, so no
concatenation ambiguity exists.

**What the binding is (exactly):** a shared exchange descriptor. Two
credentials carrying the same binding commit to the same
(ceremony, value-pair) — that is all. For the **participants**, whose
records tie the values to a live exchange, it proves one enactment. For
a **third party** it proves consistency, not occurrence (Section 8).

*Honesty note (normative for claims):* the binding does not hide the
relation. The two credentials of an enactment name the two anchors as
issuer and subject in plaintext; **anyone holding both can correlate
them from the anchors alone**. Under this protocol's stable-anchor
model that correlation is inherent, and implementations and
documentation MUST NOT claim otherwise.

### 5.5 The enactment record

Before issuing, each party MUST durably record: the ceremony identifier
and version; the counterparty anchor and its card as received; both
fresh values; the computed enactment binding; and the local time of the
enactment. Records MUST be retained for the life of the relation, and
they subsume the consumed-value history (5.3).

### 5.6 Acceptance

On receiving a credential claiming to be an encounter credential about
the local anchor, an implementation MUST evaluate, in order:

1. **Format.** The document validates against
   `schemas/encounter-credential.schema.json`, and its
   `credentialSubject.format`, ceremony, and ceremony version are known
   to this implementation; else reject `ERR_VERSION`.
2. **Signature.** The `DataIntegrityProof` verifies under the Ed25519
   key encoded in the credential's issuer anchor (2.3); else reject
   `ERR_SIG`.
3. **Addressee.** `credentialSubject.id` is the local anchor; else
   reject `ERR_ADDRESSEE`.
4. **Record.** Exactly one enactment record exists whose own fresh
   value equals the credential's bound value. Values are single-use, so
   multiplicity indicates a local fault: with zero or multiple matches,
   reject `ERR_NO_RECORD`. The record's counterparty anchor MUST equal
   the credential's issuer, else `ERR_NO_RECORD`.
5. **Ceremony.** The credential's ceremony equals the record's
   ceremony; else reject `ERR_CEREMONY`.
6. **Issuance window.** With `t_ch` the issuance time of the local
   party's own fresh value (5.3), the credential's `validFrom` MUST lie
   in the **closed** interval
   `[t_ch − skew-tolerance,
     t_ch + challenge-max-age + issuance-window + skew-tolerance]`;
   else reject `ERR_STALE_ISSUANCE`. Both endpoints are inclusive, and
   `skew-tolerance` always widens the interval — skew never rejects.
   *(`validFrom` is issuer-asserted; what makes this check meaningful
   is the record gate of step 4 — a record exists only under the
   enactment rules of 5.8, which is where real-time bounds live for
   the synchronous ceremony.)*
7. **Binding.** The enactment binding recomputes from the record per
   5.4; else reject `ERR_BINDING`.
8. **Uniqueness.** No credential has been accepted for this record and
   direction. A credential whose **credential digest** (2.2) equals the
   accepted one is accepted idempotently; any other credential —
   including a re-proofed copy with a different `proof.created` — is
   rejected `ERR_CONFLICT`.

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

**`two-way-scan@0.4`.** Both parties display and scan each other's
cards; each records the enactment, confirms, issues, and delivers when
connectivity next allows. Requires no connectivity and no third party
during the enactment; both records are created during the live
exchange. Message flow: (1) A and B exchange cards optically; (2) each
computes the binding over the two challenges and records; (3) each
confirms and issues; (4) each delivers via the Delivery port, unbounded
in time.

**`one-way-scan-online@0.4`.** One party (A) scans; the enactment is
**synchronous**: its online delivery leg is part of the enactment
itself, and real-time bounds on that leg bound the enactment (1.3).

Flow, normatively:

1. A scans B's card and generates a **nonce** (5.3), noting its
   generation time `t_n`. The nonce is A's fresh value for this
   enactment, everywhere.
2. A records (B's card, B's challenge, the nonce, the binding over
   `{B's challenge, nonce}`), confirms, issues its step credential
   binding **B's challenge**, and transmits it to B **together with the
   nonce and A's card** over an authenticated channel.
3. B, on receiving, MUST create its enactment record only if, by B's
   own clock, B's challenge is no older than `challenge-max-age`; a
   later-arriving transmission MUST NOT create a record — without a
   record, any credential from this exchange dies at 5.6 step 4.
   *(This real-time check is inside the enactment and does not touch
   the delivery principle of 1.3; it is what defeats a pocketed card
   presented months later.)*
4. B verifies A's credential under 5.6. B MAY then confirm in turn and
   issue the counter-step, binding **the nonce** (A's fresh value) and
   the same enactment binding, delivered to A unbounded in time.
5. A accepts B's counter-credential under 5.6, with A's `t_ch` being
   `t_n` and A's record from step 2 supplying the match.

Requires connectivity for at least one party during the enactment.
Until step (4), the edge is one-sided.

## 6. The Contact Card

A contact card is a person's **self-description**. It is explicitly
**not a credential**: it asserts nothing about anyone but its author,
and carries no third-party signature.

A card MUST validate against `schemas/contact-card.schema.json` and
carries: a **format version**; the **anchor**; a **key-agreement key**
(Multikey, 2.3); a **challenge** with its **issuance time**, when the
card is used in an enactment; and a `DataIntegrityProof` per 2.3,
verifying under the anchor. It MAY carry a display name and delivery
hints. *(The signature key travels in the anchor itself; the card's
proof is what binds the key-agreement key to it.)*

A party encountering a card with an **unknown version** MUST NOT enter
an enactment with it, and MAY import its display fields as an
unverified contact. Degradation is always toward less assurance.

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
Protocol fields live in `credentialSubject`, alongside the subject
anchor.

| Property | Type | Card. | Content |
|---|---|---|---|
| `issuer` | anchor | 1 | the recognizing party |
| `validFrom` | datetime (UTC `Z`) | 1 | issuance time (SHOULD equal enactment time) |
| `credentialSubject.id` | anchor | 1 | the recognized party |
| `credentialSubject.format` | string | 1 | `rltp-encounter-credential/0.4` — the credential-format version checked in 5.6 step 1 |
| `credentialSubject.ceremony` | string | 1 | registered ceremony id and version |
| `credentialSubject.challenge` | string | 1 | the subject's fresh value (5.3) |
| `credentialSubject.enactmentBinding` | multibase | 1 | per 5.4 |
| `credentialSubject.channel` | string | 0..1 | informative (5.7) |
| `proof` | object | 1 | `DataIntegrityProof`, `eddsa-jcs-2022` (2.3) |

The credential MUST NOT carry the counterparty's fresh value. Unknown
additional properties MUST be ignored on verification and MUST NOT
contribute assurance.

### 7.3 Immutability

Encounter credentials are immutable and are **never revoked**. A changed
assessment is expressed by issuing a new credential; both remain true of
their moment. A credential is a durable, independently meaningful claim
from the moment of issuance; the enactment is its provenance, not a
condition of its validity.

### 7.4 Receiver principle, honestly bounded

An encounter credential belongs to its subject **in authority, not in
exclusivity**. It is delivered to the subject, who decides what to do
with their copy; the issuer retains a copy, and **the protocol gives
the subject no control over the issuer's copy** — a party who issues a
credential can disclose it, and after a mutual enactment either
participant holds material exposing both anchors and the relation.
What the protocol guarantees is narrower and real: no directory, no
publication mechanism, no protocol operation by which an issuer can
alter, revoke, or condition a delivered credential, and no
protocol-level acceptance signal to the issuer. Transport
acknowledgements MUST NOT be presented as acceptance. Implementations
MUST NOT present the relation as disclosable only by the subject.

## 8. What a Third Party Can Verify

A single credential is verified from its content alone: proof under the
issuer anchor's key (2.3), schema validity. This requires no
cooperation.

Presented with **both step credentials** of an enactment, a verifier
can check: both proofs; that issuer and subject anchors are reciprocal;
that each binds its own subject's fresh value; and that both carry the
same enactment binding, which recomputes from the two bound values per
5.4.

**What that establishes, exactly:** two reciprocal, independently
signed statements committing to one exchange descriptor. It does
**not** establish that C1–C5 occurred — two colluding key holders can
manufacture a consistent pair without cards, records, freshness, or any
human confirmation, and nothing on the wire can expose that (4.2,
Section 13). Implementations MUST NOT present pair-verification as
proof that a meeting took place; its honest reading is *these two
anchors mutually assert an encounter, consistently*.

*(Informative: in DTGWG evidence terms the pair is `collected` step
evidence joined by a shared descriptor. This document deliberately
claims no more; a two-party enactment has no recorder, and no evidence
level can conjure occurrence from signatures alone.)*

## 9. Time Parameters

| Parameter | Value at 0.4 | Meaning |
|---|---|---|
| `challenge-max-age` | PT24H | max age of a fresh value at enactment time (C2; 5.8 step 3) |
| `issuance-window` | PT24H | max delay from enactment to credential issuance (5.6 step 6) |
| `skew-tolerance` | PT5M | clock-skew allowance; always widens intervals |

**The registered ceremony version pins these values.** A deployment
that needs different parameters registers a new ceremony version; two
conforming parties evaluating the same credential therefore never
disagree because of local configuration. All intervals in this document
are closed (endpoints inclusive). Retention: enactment records for the
life of the relation (5.5).

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
and explicit delivery status; silent loss is non-conformant.
Post-enactment delivery time is unbounded and never affects validity;
the synchronous leg of `one-way-scan-online` is part of the enactment,
not of delivery (5.8). Enactments MUST be possible without any service
(`two-way-scan`). The message semantics of this port are specified in
the RLTP Delivery Contract (pending; adopted decision: private Trust
Task specifications).

## 12. Evolvability

- Every wire artifact carries an explicit format version — cards
  (Section 6) and credentials (`credentialSubject.format`, 7.2) — so
  future formats are distinguishable on the wire, not by guessing from
  context URLs.
- New ceremonies, channels and card fields register new identifiers;
  existing ones are never re-interpreted. Ceremony registrations pin
  time parameters (Section 9).
- Unknown constructs degrade toward *less* assurance: an unknown
  ceremony, card, or credential format is rejected from enactment and
  acceptance; unknown informative fields are ignored.
- Renames only via alias table; the binding construction layout (5.4)
  is never renamed.

## 13. Security Considerations

- **Freshness is not presence.** The challenge proves the exchange was
  live, not that the parties shared a room; a channel can be relayed.
  Implementations MUST NOT claim presence.
- **The confirmation step is the security boundary.** C4 is where a
  human decides. Automating it removes the only thing this layer
  actually secures.
- **Keys are bound to anchors by construction.** A `did:key` anchor
  contains its verification key; an artifact naming an anchor but
  verifying under a different key is invalid (2.3).
- **Sybil anchors are free; targeted forgery is not.** Anyone can
  manufacture anchors and mutually consistent credential pairs among
  them (Section 8). What the design makes expensive is attaching an
  edge to a **specific existing anchor**: that requires its fresh
  value, which exists only in its owner's live card, and survives the
  owner's acceptance gate. Consumers of edges MUST treat counts as
  meaningful only relative to known anchors (4.2).
- **Replay and substitution.** Value binding plus the uniqueness check
  prevent reuse of a captured credential and substitution of a second
  credential onto a consumed value.
- **Backdating is bounded by the record gate, not by `validFrom`.**
  `validFrom` is issuer-asserted. What defeats a pocketed card is that
  no enactment record exists for it: in `two-way-scan` because the
  victim never participated, in `one-way-scan-online` because record
  creation is real-time-bounded inside the synchronous enactment
  (5.8 step 3). The issuance window then bounds honest-but-slow
  issuance among parties that do hold records.
- **Challenge entropy is load-bearing.** With ≥128-bit random values
  (5.3), a binding is not enumerable from one credential. UUID v4
  values carry 122 random bits and are **non-conformant** (Appendix A).
- **Time gates are layered consistently.** Every gate tolerates
  `skew-tolerance` by widening; parameters are ceremony-pinned
  (Section 9), so no conforming pair of implementations disagrees on a
  verdict because of configuration.

## 14. Privacy Considerations

- **No directory, no publication mechanism.** The protocol never
  publishes credentials; disclosure is always an act of a holder.
- **Holders include the issuer.** Each party to an enactment ends up
  holding material that exposes both anchors and the relation, and the
  protocol cannot and does not promise otherwise (7.4). The credential
  pair is correlatable by anyone holding both (5.4). What bounds
  disclosure is the social fact that holders are the two people who
  met — and their choices.
- **Cards reveal what their author put in them.** A card carries
  verification material by necessity; anything else is the author's
  choice, and implementations SHOULD default to minimal cards.
- **Anchors are stable and therefore correlatable** across contexts.
  Channel and service identifiers MAY be derived per relationship; the
  anchor is not. Minimal-disclosure presentations are Open Issue OI-3.

## 15. Conformance

- **Profile** `rltp-encounter@0.4`; includes the interim securing
  profile (2.3) until `rltp-identity` is cast.
- **Classes:** *participant* (enactments, issuance, acceptance) ·
  *verifier* (credential and pair verification only).
- **Normative schemas (shipped):**
  `schemas/encounter-credential.schema.json`,
  `schemas/contact-card.schema.json`. Timestamp and key fields are
  pattern-enforced; validators MUST NOT rely on `format` assertion.
- **Vector plan:** enactment contract compliance (C1–C5) · fresh-value
  entropy and encoding bounds (22 and 88 chars accepted, 21 and 89
  rejected; UUID v4 rejected) · binding computation, both ceremonies,
  including ordering · every error state of 5.6, including idempotent
  re-delivery by credential digest and `ERR_CONFLICT` on a re-proofed
  copy · window boundaries at both inclusive endpoints, with and
  without skew · **two-way delayed delivery accepted; backdated
  `validFrom` on a pocketed card rejected via missing record** ·
  **one-way complete both directions: late transmission refused at
  record creation (5.8 step 3); counter-step binding the nonce;
  A-side acceptance with `t_ch = t_n`** · credential-format version
  unknown → `ERR_VERSION` · Multikey key-agreement roundtrip; raw
  32-byte key rejected · pair verification with matching and
  non-matching bindings · card versioning and unknown-version refusal
  · foreign-key card rejected (anchor binding) · edge-state
  transitions of 4.2.
- Every normative statement is vector-testable or explicitly marked
  state-dependent (the enactment record, the confirmation step).

## 16. Open Issues

- **OI-1 Group encounters.** *n* people in a circle currently require
  *n(n−1)/2* pairwise enactments.
- **OI-2 Shared contexts.** "Attended the same event" — a derived
  relation with no credential. Form and evidence undefined.
- **OI-3 Minimal-disclosure presentation.** Which bundle satisfies a
  Layer-3 encounter predicate with least disclosure; selective
  disclosure must come from the presentation layer, not from hiding
  values the anchors reveal anyway.
- **OI-4 Time and renewal.** Whether the age of an edge is expressible,
  and whether repeated encounters between the same anchors are
  distinguishable from one.
- **OI-5 Card format alignment.** Whether to adopt an established
  contact interchange format, and at what cost to minimality.

## Appendix A (informative): bindings to the current implementation

| This specification | wot-core v0.x | Status |
|---|---|---|
| Contact card | QR-challenge payload (`did`, `name`, `enc`, `nonce`, `ts`, `broker`) | **no version field**; `enc` must become Multikey |
| Challenge | `nonce` (UUID v4) | **non-conformant: 122 random bits < 128** — migration generates new values per 5.3; issuance time now required |
| Encounter credential | `WotVerification`-typed VC-JWS | becomes DTG `WitnessCredential` with embedded `eddsa-jcs-2022` proof and `credentialSubject.format` |
| Enactment binding (5.4) | *absent* | **new** |
| Enactment record (C5) | active challenge held until rotation; `pendingCounterVerification` | generalized to both directions |
| Acceptance gate | Trust 002 acceptance gate | carries over; error states named; window anchored to fresh-value issuance |

## Appendix B (informative): relation to prior specifications

On adoption this document supersedes `02-wot-trust/001-encounter
credentials.md` and `002-verifikation.md`. The remote-verification path
of Trust 002 §"Verifikation ohne physisches Treffen" is **removed**:
that relation is a path through the graph (Section 10), not a
credential.

## Appendix C (informative): vocabulary alignment with DTGWG Trust Ceremonies

The terms *ceremony* (definition), *enactment* (one run), and *step*
follow ToIP DTGWG ADR 0001, adopted deliberately after finding
independent convergence on the word and its rationale. This layer
adopts the vocabulary and, with the bounds stated in Section 8, the
evidence framing. RLTP messages adopt Trust Tasks as private
specifications (decision of 2026-08-10); the message layer is specified
in the RLTP Delivery Contract, not here.

## References

[RFC2119] · [RFC8174] BCP 14 · [RFC3339] timestamps · [RFC8785] JCS ·
[DI-EDDSA] W3C Data Integrity EdDSA Cryptosuites v1.0
(`eddsa-jcs-2022`) · W3C Verifiable Credentials Data Model 2.0 · DTG
Credential Specification (ToIP DTGWG, draft) · ToIP DTGWG Trust
Ceremonies ADR 0001 and design note (Proposed) · did:key method draft ·
Multikey / multicodec registry · wot-spec v0.1 (superseded parts,
Appendix B).
