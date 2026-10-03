# RLTP Network Visibility

**Real Life Trust Protocol — cross-cutting: Network Visibility**

- **Status:** Editor's Draft
- **Version:** 0.2.0-draft (second casting)
- **Editors:** Anton Tranelis
- **Date:** 2026-08-23
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Conformance profile:** `rltp-visibility@0.2` (draft). Wire
  artifacts: `star@1`, `grade-declaration@1`, `anchor-mapping@2`,
  `introduction-request@1`, `introduction-reply@1`.
- **Companions (pinned):** **Identity 0.7** (`spec/identity-layer.md`
  — this document REQUIRES the `pair/` contexts its Section 6.1
  defines; against Identity ≤ 0.6 this profile is not implementable)
  · Encounter 0.22, wire `0.19` (read, never modified; see §1.1 for
  the honest gap) · Access 0.25 · Membership 0.11.
- **Supersedes:** version 0.1 (archived as
  `archive/network-visibility-0.1.md`).
- **Source material:** `design/visibility-publikumsprinzip-2026-08.md`
  · `design/mdid-bindung-2026-08.md` · triage
  `design/visibility-review1-2026-08.md` (5B/9M/3m, all answered by
  this casting).

## Abstract

This document specifies who gets to see what about the edges of the
trust graph: which artifacts are provable to whom (the audience
principle), how knowledge about one's contacts may travel (the star),
how anchors of one person are linked for exactly one addressee
(anchor mapping), and how strangers become contacts (the introduction
act).

Its central commitment: **links between anchors are the protected
good.** Everything here is cryptographically authenticated, but only
artifacts whose purpose is presentation are transferably signed.
Everything else convinces exactly its addressee and no one further.

## Status of This Document

Second casting, answering review round 1 in full (triage:
`design/visibility-review1-2026-08.md`). The wire artifacts are now
normatively specified (bodies, canonicalization, KDF labels,
encodings, rejection rules); JSON Schemas and conformance vectors are
the announced product of the next casting. The mechanics of
Sections 5–8 are executed in the repository's browser simulator
(which MUST be brought onto this casting's labels — it currently
carries `rltp-sim/…` prefixes).

The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted
as described in BCP 14 (RFC 2119, RFC 8174) when, and only when, they
appear in all capitals.

## 1. Introduction (informative)

The founding incident: Hans has one contact, Peter. One trust act of
Peter's delivered three foreign self anchors to Hans as "unknown"
contacts — people who never met Hans and never chose him.

An anchor is a capability: a tag test key, a correlation point, a
recognition mark. Deniability of a relationship claim does not
protect the anchor itself — a data collector buys keys, not claims.
The rule this document enforces everywhere:

> **Whoever issues an anchor decides, per recipient, who gets to see
> it.** No holder of my anchor may forward it on my behalf.

Consequence, decided for the whole protocol: **there are exactly two
ways to gain a new contact — a real-life encounter (Encounter layer)
or the introduction act (Section 8).** No artifact of this document
transports a **standing** anchor of a third party to anyone. The one
anchor an introduction does transport is **fresh, created for the
new relationship itself, by its own issuer** — that is the rule
working, not an exception to it (Section 8).

### 1.1 The honest gap toward the frozen Encounter profile

Encounter 0.22 enacts ceremonies under the **self** anchor; this
document's relationship fabric runs on **pair** anchors (Identity 0.7
`pair/` contexts). Until an Encounter casting defines a
pair-enacting ceremony profile, the pair fabric is exercised by the
introduction act and by the simulator, not by the deployed ceremony.
This gap is carried openly (Identity 0.7 §15.3); nothing in this
document silently modifies the frozen Encounter profile.

## 2. Terminology

- **Anchor** — a context identifier of an identity (Identity §5, §6):
  the self context, or a `pair/…`, `group/…`, `persona/…` context.
- **Anchor classes (DTGWG-aligned naming):** **R-DID** = pair-context
  anchor (defined by Identity ≥ 0.7; pairwise, no correlation) ·
  **P-DID** = persona anchor (intentional correlation) · **S-DID** =
  the self anchor — the stable coordinate across a person's
  *relationships*, disclosed selectively per recipient (RLTP's
  extension to the DTGWG ladder) · **M-DID** names the *class*
  "per-community member identifier"; in this family membership
  currently binds the S-DID, and whether the group-context anchor
  becomes a true M-DID is a confirmed direction with open semantics
  (Section 9.4).
- **Promotion** — the trust act of a holder toward one of their
  contacts; the UI surface of promotion and of S-DID disclosure is
  the **Trust** act.
- **Star** — the artifact by which a sender lets one recipient relate
  the sender's contact set to the recipient's own (Section 5).
- **Deliverable set** — the set of entries a star to a given
  recipient may carry: anchors of contacts who have promoted the
  sender, under their effective grade (Section 5.5).
- **Resolver class** of an artifact — the set of parties able to make
  use of it at all.
- **Audience class** — P, V, or D per Section 3. Classification
  applies **per artifact**, never per act; one act may produce
  artifacts of several classes.
- **DV** — designated-verifier: verifiable only with the addressee's
  secrets; the addressee could have forged it; third parties cannot
  even check it.

### 2.1 Common wire conventions (normative)

For every artifact of this document:

- **Canonical bytes** are the JCS (RFC 8785) serialization of the
  body object. MACs and signatures are computed over exactly these
  bytes.
- **MAC** is HMAC-SHA-256; output is encoded `u` + unpadded
  base64url (43 characters).
- **KDF** is HKDF-SHA-256, salt empty unless stated, output length
  32 bytes. Info strings are exact ASCII.
- **ECDH** is X25519 over the key-agreement keys of Identity §5.2.
  An implementation MUST reject an all-zero shared secret before
  deriving any key from it.
- **Anchor bytes** in any MAC input are the UTF-8 bytes of the
  anchor's `did:key` string.
- Every body carries `type` (the versioned name, e.g.
  `anchor-mapping@2`). A consumer MUST reject an artifact whose
  `type` it does not implement — explicitly including
  `anchor-mapping@1` and any unknown version. There is no version
  negotiation.

## 3. The audience principle (normative)

For every artifact, two questions decide its cryptographic form:

- **F1:** Whom must the statement convince for its purpose to be
  fulfilled?
- **F2:** Must the recipient be able to pass it on?

Provability MUST be the smallest set the purpose demands. The default
is deniable (DV); a transferable signature is the exception that
carries the burden of justification.

Three classes:

- **Class P (presentable).** Statements about myself whose purpose is
  showing: persona profile (audience: everyone), membership document
  (audience: roster readers). Transferably signed. Only class-P
  artifacts are called **credentials**.
- **Class V (links).** Every statement that **connects two contexts
  of one person**: pair→self mappings, group mappings, the
  mediator's introduction voucher (Section 8.4). Always DV. A
  cross-context link MUST NOT exist anywhere as a transferable
  proof. **Boundary, stated precisely:** a key binding *within* one
  context (such as the self card of Section 6.2 — Ed and X key of
  the *same* context) is not a link and may be transferably signed;
  what it authenticates is addressing material, not a connection
  between contexts. The possession residue this creates is named in
  Section 11.
- **Class D (statements about third parties).** Stars and
  introduction requests. The proof axis is not enough, because the
  knowledge itself harms (the collector argument); class D therefore
  adds a content grading (Section 5.1), default per Section 5.5.

Authentication and audience are orthogonal: every artifact travels
end-to-end encrypted and channel-authenticated regardless of class.

## 4. The publication-space rule (normative)

Principle (register entry no. 2): *publication space = the smallest
space that contains the artifact's resolver class.* This section
makes it decidable:

1. The resolver class of an artifact is evaluated **at publication
   time** (epoch snapshot). Later growth of the class does NOT
   oblige republication or migration — possession is history
   (register no. 5).
2. Candidate spaces are the protocol's delimited publication
   contexts: a group space (Membership/Access), a pair channel
   (Delivery), a persona's public surface. Their order is **member-set
   inclusion at the snapshot**.
3. The publisher MUST choose a space that (a) contains the resolver
   class and (b) is **minimal**: no candidate space strictly
   contained in it also contains the class. Where several
   incomparable minimal spaces exist (overlapping groups), the
   publisher MAY choose any one of them; publishing into more than
   one minimal space is a fresh publication decision per space, not
   a default.
4. Departure of a member is handled by the space's own epoch/rekey
   machinery (Access), never by the artifact.
5. A world-visible publication is conformant only where the resolver
   class is genuinely unbounded (class-P persona surfaces).

Applied: the self-anchor tag of a group member is published into the
group space — its resolver class (co-members holding that anchor)
lies within the group at publication time. World publication of that
tag is a violation.

## 5. The star (normative)

### 5.1 Standing contents: count or blinded — nothing else

A star carries, per affected contact, one of exactly two standing
forms:

- **Count** — inclusion only in the aggregate number. No **anchor or
  intersection** leak; cardinality and delivery timing remain
  metadata (Section 11). Freely claimable, therefore zero
  credibility.
- **Blinded** — the anchor travels as
  `HMAC(k, anchor bytes)` under the delivery-specific key of 5.2.

A raw third-party anchor MUST NOT appear in any star. There is no
standing "show" grade: disclosure of an anchor to a stranger happens
only as the introduction act (Section 8). An implementation that
emits raw third-party anchors in a star is nonconformant.

### 5.2 star@1 and epochal blinding

Body: `{ "type": "star@1", "salt": <unsigned integer>, "count":
<unsigned integer>, "blinded": [ <mac encoding> … ] }`, `blinded`
sorted lexicographically.

- `salt` is the delivery sequence for this relationship: an
  unsigned integer the sender MUST increment per delivery,
  persisted **atomically before** the delivery is sent. A sender
  that cannot guarantee the persisted value survived (backup
  restore) MUST NOT deliver until it has re-established a strictly
  greater value than any it may ever have used.
- The recipient MUST track the highest accepted `salt` per
  relationship and MUST reject any star whose `salt` is not
  strictly greater.
- `k = HKDF(ikm = X25519(pairX_sender, pairX_recipient), info =
  "rltp/visibility/blind/star/" || decimal(salt))`.
- Entries are `HMAC(k, anchor bytes)` of deliverable S-DIDs (or
  group anchors, where the recipient legitimately holds them —
  Section 9.4).

Properties, with their honest limits:

- **Intersection only:** the recipient can test entries against
  anchors they legitimately hold; no new anchor reaches them.
- **No veracity.** The star is a **claim by the sender**, nothing
  more: the sender knows `k` and can omit, fabricate, or equivocate
  entries per recipient. A hit proves that both parties **hold** the
  anchor — it proves nothing about any relationship of the sender.
  Fabricating a hit itself requires holding the target's anchor,
  which is already a capability. Consumers MUST NOT treat a star as
  evidence of the sender's relationships (this is the same honesty
  Section 7 demands of counts).
- **Collusion:** values under different `k` are not comparable;
  unknown anchors are not extractable or linkable across recipients.
  NOT prevented: colluders pooling *known* anchors and keys can
  enrich retained snapshots by dictionary test.
- **Deniability is free:** a MAC under a shared key.
- **Longitudinal tracking** of opaque entries dies with the
  delivery-specific key **given unique salts** — which 5.2's
  persistence and rejection rules make normative, not hopeful.
  Residue: anchors learned later remain testable against retained
  snapshots (construction-independent).

### 5.3 The star MUST NOT be signed

A transferable signature would make "these values are this person's
circle" provable to third parties once `k` leaks. Forgeability is a
requirement. Credibility beyond the addressee, if ever needed, is a
DV-ZK predicate (Section 9.3), never a signature.

### 5.4 The star is a subscription

A conformant sender MUST redeliver **when and only when the
deliverable set for that recipient changes** (a new promotion of the
sender, a grade change, a departure). A new encounter of the sender
that does not change the deliverable set MUST NOT trigger a
delivery — the event itself is metadata the subscription must not
broadcast. Pausing stops future deliveries; delivered snapshots
remain (revocation of distribution, not of possession).

### 5.5 grade-declaration@1 — authenticated, fail-closed

The count/blinded choice belongs to the affected contact and travels
as a DV artifact to the holder:

Body: `{ "type": "grade-declaration@1", "subject": <affected
anchor>, "holder": <sender anchor>, "grade": "count" | "blinded",
"revision": <unsigned integer>, "issuedAt": <RFC 3339 UTC> }`.

- MAC over the canonical bytes under
  `k = HKDF(ECDH(pairX_subject, pairX_holder),
  "rltp/visibility/mac/grade")` — the relationship key of the two.
- `revision` is monotone per (subject, holder); the holder MUST
  keep the highest verified revision and MUST reject lower ones.
- **Fail-closed:** absent any verified declaration — none received,
  MAC failure, unknown version — the effective grade is **count**.
  A forged or replayed declaration can therefore never widen
  disclosure beyond what the subject last verifiably declared; the
  residual attack is suppression to count (denial of signal), named
  and accepted.

The default experience remains one human question: the **Trust** act
issues `grade: "blinded"` — the spec offers the granularity, the
default UX collapses it (register no. 3).

## 6. Anchor mapping (normative)

### 6.1 Purpose and construction

`anchor-mapping@2` links a pair anchor to the self anchor of the
same person for exactly one addressee — a **double-DH MAC
construction in the Signal pattern** (the 0.1 name "3DH" overstated;
two DH values plus a signed card), entirely in WebCrypto.

Body: `{ "type": "anchor-mapping@2", "pair": <sender R-DID>,
"self": <sender S-DID>, "to": <addressee R-DID>, "card": <self
card, 6.2>, "revision": <unsigned integer>, "issuedAt": <RFC 3339
UTC> }`.

Two MACs over the canonical bytes:

- `mac1` under `k1 = HKDF(ECDH(pairX_sender, pairX_addressee),
  "rltp/visibility/mac/map1")` — proves the relationship side.
- `mac2` under `k2 = HKDF(ECDH(selfX_sender, pairX_addressee),
  "rltp/visibility/mac/map2")` — proves control of the self
  context toward this addressee.

Verification (addressee only): validate the card (6.2), reject
all-zero shared secrets, recompute both MACs. Replay of a verified
mapping with identical (pair, self, to) is **idempotent and
harmless** — disclosure is deliberately irreversible (register
no. 5); `revision` exists for correction, and the addressee MUST
keep the highest verified revision.

Properties (each a simulator assertion, to be carried into vectors):
foreign self anchors are unclaimable (card unsignable, `k2`
uncomputable); the addressee can compute both MACs and forge the
whole mapping — deniable; third parties cannot even **verify** —
strictly stronger than deniability alone.

### 6.2 The self card — binding, not link; residue named

The self card binds the Ed25519 and X25519 keys of the **same self
context**, Ed-signed: `{ "anchor": <S-DID>, "keyAgreement":
<multikey> }` over canonical bytes. It links no two contexts and is
therefore class-compatible with transfer (Section 3) — but it is
**not harmless**: it carries the stable anchor and authentic
addressing material. After disclosure, the addressee can pass it on;
rule §1 governs issuance, not possession. This residue is accepted
and restated in Section 11.

## 7. Relational counts (normative principle, artifact unwritten)

Anchors are free; a Sybil swarm issues itself arbitrary
self-evidence. The scarce resource is the **boundary edge** into the
honest graph. Count and personhood statements MUST therefore be
anchored relationally — "≥ N, of which k inside the verifier's trust
horizon" — never absolutely; the blinded star already supplies the
verifier-side test instrument. Global per-everyone scores are
rejected.

**Honesty:** the proof artifact for such statements is deliberately
UNWRITTEN — it depends on the proof substrate of Section 9.2. Until
it exists, relational counts are a design constraint on consuming
layers, not a testable wire conformance point (Section 12 marks it
state-dependent).

## 8. The introduction act (normative)

Principle: **the mediator transfers messages, never standing
anchors.** The fresh pair anchor of step 1 is created by its own
issuer for the new relationship — issuance, not forwarding.

### 8.1 The three steps

1. **Request.** Requester → mediator: `introduction-request@1` with
   body `{ "type", "act": <32-byte random act id, u-base64url>,
   "mediator": <mediator anchor as held by requester>, "target":
   <opaque target designator chosen by the mediator's namespace>,
   "card": <requester's FRESH pair contact card>, "profile":
   <released profile data> }` — the card's signature is computed
   over the canonical bytes of the **whole body**, binding it to
   this act, this mediator, and this designator.
2. **Consent.** The mediator forwards to the target. The target
   decides. The mediator MUST return to the requester a **uniform
   acknowledgement** (same artifact, same size class, same schedule)
   regardless of existence, refusal, or expiry of the target; a
   non-uniform response is nonconformant. Outcome reaches the
   requester only via step 3.
3. **Completion.** Target → requester (through the mediator):
   `introduction-reply@1`, body `{ "type", "act": <same act id>,
   "requesterPair": <the pair anchor from step 1>, "card": <target's
   FRESH pair contact card> }`, card signature over the whole body.
   Result: a pairwise relationship; thereafter normal deferred
   disclosure (each side separately, unilaterally, later).

### 8.2 What the act binding buys — and what it cannot

Both cards sign over act id and counterpart references: a mediator
can no longer **substitute** cards between acts or splice two
half-relationships from different requests — any altered body breaks
the card signature. What remains, stated honestly: a mediator can
still **be** a full endpoint — fabricate an act in which it plays
the target, or run two acts posing as each side. Against that there
is no cryptographic remedy without a prior relationship; it is why a
mediated relationship carries a weaker verification grade, displayed
as "◇ verified via <mediator>", upgradeable only by a real
encounter. The mediator's vouching artifact (the **introduction
voucher**) is signed but DV to both sides — class V.

### 8.3 Refusal privacy — scope stated honestly

The uniform-acknowledgement rule removes the *protocol* signal.
Timing side channels and a mediator who simply tells the requester
out of band remain — refusal privacy holds against the protocol
surface, not against a talkative or malicious mediator. UX
invariant (one-way-door rule): acceptance is a button plus sheet,
never a toggle; three devices, three decisions, each at the right
party.

## 9. Documented options and open points

### 9.1 Grade ladder beyond two

A finer per-recipient ladder (up to introduction permission) was
tried in UX and withdrawn (22.08.); the two-grade declaration of 5.5
is the specified surface. Reintroduction would extend
`grade-declaration@1`'s enum in a new version, nothing structural.

### 9.2 The encounter-credential flank (deliberately undecided)

Unchanged from 0.1: ZK counting predicates need a proof-friendly
substrate; Ed25519 + SHA-256 are ZK-hostile. Candidate: pre-wire a
Pedersen commitment field — cheap, keeps the ZK door open; touches
converged Encounter 0.22, own loop required.

### 9.3 Feasibility map for predicates (informative, early 2026)

DV mapping = double-DH MAC (specified, Section 6) · DV-ZK counting
predicates = Sigma-OR (@noble/curves, no audited library) ·
selective disclosure / counting = BBS+ (W3C bbs-2023 draft) ·
general SNARKs only if predicates outgrow counting and subsets.

### 9.4 M-DID binding of membership — confirmed direction, open semantics

Decision (23.08., `design/mdid-bindung-2026-08.md`): the target
picture is membership bound to the group-context anchor (a true
M-DID), with the S-DID as the private cross-relationship coordinate
disclosed per co-member via a DV mapping (the Section 6 pattern,
group→self) — the UI surface of that disclosure is the existing
**Trust** act. Motivation: rule §1 applied consistently (today,
joining disloses the S-DID to every present and future roster
reader; review finding M5 sharpened this to roster *readers* and
colluding insiders, with admission artifacts replicating stable
anchors into group logs permanently).

Technically the star is anchor-agnostic (finding M6): group anchors
can participate in blinded intersection wherever the recipient
legitimately holds them, and the introduction act needs no S-DID.
The open questions are semantic, and they gate the change: which
anchor class counts as a "contact"; how group-specific hits on the
same person deduplicate without rebuilding the very linkability the
change removes; when an M-DID may bind to a relationship. The
change itself is a gated Access/Membership recast — its own loop,
after this document converges.

### 9.5 Standing disclosure (from the architecture map)

Unchanged: normatively capturing standing disclosure of one's own
edges to one's own network remains open; until then deliberate app
policy ("unrevocable in possession, revocable in distribution,
deniable in derivation").

## 10. Security Considerations

- **Anchor harvesting via stars** — countered structurally: no
  standing raw grade exists (5.1); harvesting apps are nonconformant
  by artifact shape.
- **Grade forgery** — the 0.1 claim is corrected (review B2): with
  5.5's authenticated, fail-closed declaration, forgery or loss can
  only suppress toward count; widening requires the subject's
  relationship key. Residual: denial of signal.
- **Salt rollback / reuse** (review M1) — countered by atomic
  persistence and the recipient's strictly-greater rule; a sender
  equivocating under one salt is rejected on delivery.
- **Sender equivocation / fabricated stars** (review M2) — not
  preventable and now normatively de-fanged: stars carry no
  veracity; consumers MUST NOT read them as relationship evidence.
- **Key leak turns a signed star into evidence** — signing is
  forbidden (5.3); the artifact stays forgeable-by-recipient.
- **Mapping forgery** — by design for the addressee (deniability);
  third parties can neither claim (unsignable card, uncomputable
  k2) nor verify (addressee secrets required). Downgrade to
  `anchor-mapping@1` or unknown versions MUST be rejected (2.1);
  replay is idempotent by declared semantics (6.1).
- **Mediator MITM** (review B4) — act binding removes card
  substitution and act splicing; the mediator-as-endpoint residue is
  irreducible without prior relationship and is carried in the
  verification grade, not hidden.
- **Sybil self-evidence** — relational anchoring mandatory
  (Section 7); the verifier's own holdings are ground truth.

## 11. Privacy Considerations

- **The one-bit oracle is the feature.** A star recipient can test
  every anchor they legitimately hold — including future ones —
  against retained snapshots: offline, unthrottled, forever. The
  affected contact's remedy is the count grade (now fail-closed
  default until declared otherwise); the sender's remedy is pausing.
- **Counts are metadata.** Cardinality, churn, and delivery timing
  leak (the 0.1 "no leak" wording is withdrawn); 5.4 minimizes
  delivery events to actual set changes so that encounters as such
  are not broadcast (review M7).
- **Possession residue of the self card** (review M3): after
  disclosure, the card is transferable addressing material; §1 is
  issuance control, not recall. Register no. 5 names the frame.
- **Membership correlation, stated at true size** (review M5): under
  S-DID-bound membership, roster *readers* — not only social
  co-members — and colluding insiders of different groups can
  correlate members across groups, and admission artifacts replicate
  stable anchors into logs permanently. This is the standing
  motivation of 9.4.
- **Refusal privacy** holds at the protocol surface (8.3), no
  further.
- **Third parties** cannot even verify class-V artifacts — stronger
  than deniability alone.

## 12. Conformance

A conformant implementation:

1. emits no raw third-party anchor in any artifact of this document
   (5.1, 8.1) — vector-testable;
2. blinds stars per 5.2 (key schedule, salt monotonicity both
   sides) and never signs them (5.3) — vector-testable;
3. redelivers exactly on deliverable-set change (5.4) —
   state-dependent, simulator-checked;
4. enforces grade declarations per 5.5 including fail-closed count
   and revision monotonicity — vector-testable;
5. produces and verifies `anchor-mapping@2` per Section 6,
   rejecting unknown/legacy versions and all-zero shared secrets —
   vector-testable (including the forgeability demonstration);
6. binds introduction cards to act bodies and answers step 2
   uniformly (8.1–8.3) — vector-testable for the binding,
   state-dependent for uniformity;
7. publishes every artifact into a minimal space per Section 4 —
   state-dependent (snapshot rule makes it decidable);
8. treats stars and counts as non-evidence (5.2, 7) —
   state-dependent consumer rule.

## References

- Identity Layer 0.7 — `spec/identity-layer.md` (§5.2 key
  agreement, §6.1 `pair/` registry).
- Encounter Layer 0.22 (wire 0.19) — `spec/encounter-layer.md`.
- RFC 8785 (JCS), RFC 2104 (HMAC), RFC 5869 (HKDF), RFC 7748
  (X25519), BCP 14.
- Design sources and triage: `design/visibility-publikumsprinzip-2026-08.md`,
  `design/mdid-bindung-2026-08.md`,
  `design/visibility-review1-2026-08.md`.
- Reference mechanics: `simulator/graph.html` + `simulator/graph.mjs`
  (to be aligned to this casting's labels).
