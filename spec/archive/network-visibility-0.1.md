# RLTP Network Visibility

**Real Life Trust Protocol — cross-cutting: Network Visibility**

- **Status:** Editor's Draft
- **Version:** 0.1.0-draft (first casting)
- **Editors:** Anton Tranelis
- **Date:** 2026-08-23
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Conformance profile:** `rltp-visibility@0.1` (draft). Wire
  artifacts defined here: `anchor-mapping@2`, `star@1`.
- **Companions (pinned):** Identity 0.6 (`spec/identity-layer.md`,
  §5.2 key-agreement families) · Encounter 0.22, wire `0.19`
  (`spec/encounter-layer.md`) — read, never modified by this document.
- **Source material:** `design/visibility-publikumsprinzip-2026-08.md`
  (22.08., executed in `simulator/graph.html`),
  `design/trust-modelle-gegenueberstellung-2026-08.md` §2.9–2.11, §8.

## Abstract

This document specifies who gets to see what about the edges of the
trust graph: which artifacts are provable to whom (the audience
principle), how knowledge about one's contacts may travel (the star),
how a pairwise anchor is linked to a self anchor (anchor mapping), and
how strangers become contacts (the introduction act).

Its central commitment: **links between anchors are the protected
good.** Everything in this document is cryptographically
authenticated, but only artifacts whose purpose is presentation are
transferably signed. Everything else convinces exactly its addressee
and no one further.

## Status of This Document

First casting. The mechanics of Sections 5–8 are executed in the
repository's browser simulator, including negative demonstrations
(forgeability of mappings by the addressee, collusion resistance of
blinded stars); they are design-proven, not yet independently
reviewed. Section 9 lists documented options and deliberately open
questions. This casting opens the review loop; it is not converged.

JSON Schemas for the wire artifacts (`star@1`, `anchor-mapping@2`) do
not exist yet; the simulator's structures are the reference until the
first review casting produces them. Conformance vectors follow the
same path.

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
transports a new anchor to anyone.

## 2. Terminology

- **Anchor** — a context identifier of an identity (Identity §5):
  `self` (stable, one per identity) or `pair` (per relationship).
- **Anchor classes, FPP-aligned naming.** This family adopts the
  First Person Project's tier names for prose and adds one class of
  its own: **R-DID** = pair context (pairwise, no correlation) ·
  **P-DID** = persona context (intentional correlation) · **S-DID** =
  the self anchor (stable across contexts, disclosed selectively per
  recipient — RLTP's extension to the DTGWG ladder) · **M-DID**
  names the *class* "per-community member identifier"; in this
  family, membership currently binds the **S-DID** (co-members hold
  the self anchor), and the group derivation context carries key
  material — whether it becomes a true M-DID is an open design
  question (Section 9.4).
  The underlying derivation info-strings of Identity §6 are
  cryptographic constants and keep their registry names; see
  `fpp-mapping/docs/ableitung-vs-wallet.md` §1.
- **Promotion** — the trust act of a holder toward one of their
  contacts; triggers star delivery to that contact.
- **Star** — the artifact by which a sender lets one recipient relate
  the sender's contact set to the recipient's own (Section 5).
- **Resolver class** of an artifact — the set of parties that can
  make use of it at all (e.g. holders of the anchor a tag is derived
  from).
- **Audience class** — P, V, or D per Section 3.
- **DV** — designated-verifier: verifiable only with the addressee's
  secrets; the addressee could have forged it, third parties cannot
  even check it.

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
- **Class V (links).** Everything that connects two anchors:
  pair→self mappings (Section 6), group mappings, introduction
  vouchers. Always DV. Links MUST NOT exist anywhere as a
  transferable proof.
- **Class D (statements about third parties).** Stars and
  introductions. The proof axis is not enough, because the knowledge
  itself harms (the collector argument); class D therefore adds a
  content grading (Section 5), default blinded.

Authentication and audience are orthogonal: every artifact travels
end-to-end encrypted and channel-authenticated regardless of class.

## 4. The publication-space rule (normative)

> **Publication space = the smallest space that contains the
> artifact's resolver class.**

An artifact MUST NOT be published to a wider space than its resolver
class requires. Existence metadata ("this identity publishes
something") is a cost accounted to the publisher.

Applied: the self-anchor tag of a group member is published into the
**group space**, not the world — its resolver class (co-members
holding that self anchor) lies entirely within the group. World
publication is a violation, not an option.

## 5. The star (normative)

### 5.1 Standing contents: count or blinded — nothing else

A star delivered on promotion carries, chosen by each **affected
contact** (the person whose anchor would travel), one of exactly two
standing forms:

- **Count** — the affected contact is included only in an aggregate
  number. No leak; also no credibility (freely claimable).
- **Blinded** (the default) — the anchor travels as
  `HMAC(k, anchor)` under a delivery-specific key (Section 5.2).

A raw anchor MUST NOT appear in any star. There is no standing "show"
grade: disclosure of an anchor to a stranger happens only as the
introduction act (Section 8), with case-by-case consent. An
implementation that emits raw third-party anchors in a star is
nonconformant.

The balance sentence: blinding turns the star from "I distribute my
friends' capabilities" into "I allow you to see overlaps with people
you already know."

### 5.2 Epochal blinding

Per delivery: `salt` = monotone delivery sequence for this
relationship; `k = HKDF(ECDH(pairX_sender, pairX_recipient),
'blind/star/' || salt)`. The X25519 pair-context keys are the Identity
§5.2 family, exchanged in the ceremony (contact-card keyAgreement).
Freight = `{salt, count, blinded[]}`, `blinded` sorted.

Properties (all demonstrated in the simulator):

- Intersection only: the recipient can test the star against anchors
  they legitimately hold; no new anchor reaches them.
- Collusion breaks precisely: values under different `k` are not
  comparable; unknown anchors are not extractable or linkable across
  recipients. NOT prevented: colluders pooling *known* anchors and
  keys can enrich retained snapshots by dictionary test.
- Deniability is free: a MAC under a shared key — the recipient could
  have computed every value.
- Longitudinal tracking of opaque entries dies with the
  delivery-specific key; the residue: anchors learned later remain
  testable against retained snapshots (construction-independent).

Honest costs, accepted: a one-bit oracle per legitimately held anchor
("in this circle: yes/no" — offline, unthrottled, forever; the
feature and the leak are the same thing) · list length and churn are
metadata.

### 5.3 The star MUST NOT be signed

A transferable signature over a blinded star would be a class-V
breach: it would make "these values are this person's circle"
provable to third parties once `k` leaks. Forgeability of the star is
a requirement, not a defect. Credibility beyond the addressee, if
ever needed, is a DV-ZK predicate (Section 9.3), never a signature.

### 5.4 The star is a subscription

Stars are not one-shot artifacts. A conformant sender MUST redeliver
on: a trust act · a new encounter of the sender · an incoming
promotion of the sender (the deliverable set grew). Pausing stops
future deliveries; delivered snapshots remain (honesty: revocation of
distribution, not of possession).

### 5.5 The grade is chosen by the affected contact

The count/blinded choice is made by the person whose anchor travels,
declared at their promotion of the holder ("may count me / may
intersect me"). Because "blinded" is the default and "count" is
strictly more restrictive, a forged or lost grade declaration can
only ever *narrow* what travels — never widen it. The authenticated
delivery of grade declarations is a documented open point
(Section 9.1); its absence is not an anchor leak.

## 6. Anchor mapping (normative)

`anchor-mapping@2` links a pair anchor to a self anchor for exactly
one addressee, in the Signal pattern, entirely in WebCrypto:

- **self card** — Ed↔X binding of the same identity, Ed-signed.
  Transferable but harmless: it links no contexts.
- **mac1** under the relationship key (`ECDH(pairX, pairX)`).
- **mac2** under `ECDH(selfX_sender, pairX_recipient)`.

Properties (each carried as a simulator assertion):

- Foreign self anchors are unclaimable: the card is not signable, k2
  not computable without the self secret.
- The addressee can compute both MACs and therefore forge the whole
  mapping — the claim is deniable.
- Third parties cannot even **verify** a mapping (verification needs
  addressee secrets) — a strictly stronger DV property than
  proof-based constructions.

The earlier Schnorr-OR form is withdrawn ("never roll your own
crypto"); Sigma-OR remains noted as the tool for DV-ZK counting
predicates (Section 9.3), then with an audited library and review.

## 7. Relational counts (normative principle)

Even a perfect ZK proof shows only the existence of correctly signed
artifacts — signed by anchors, and anchors are free. A Sybil swarm
issues itself arbitrary self-evidence. The scarce resource is the
**boundary edge** into the honest graph.

Count and personhood statements MUST therefore be anchored
relationally — "≥ N, of which k inside the verifier's trust horizon"
— never absolutely. The blinded star already supplies the test
instrument (intersection with the verifier's own holdings). Global
per-everyone scores are either forgeable or central; both are
rejected.

## 8. The introduction act (normative)

Principle: **the mediator transfers messages, never anchors.**

1. **Request:** requester → mediator, with an introduction card: a
   **fresh pairwise anchor** (for the relationship that does not yet
   exist) plus released profile data. No stable anchor travels.
2. **Consent:** the mediator forwards to the target (their legitimate
   addressing capability). The target decides. On refusal the
   requester learns nothing — not even the target's existence.
3. **Completion:** the target answers with its own fresh pairwise
   card. Result: a pairwise relationship as after an encounter;
   thereafter the normal deferred disclosure (each side shares its
   stable ID separately, unilaterally, later).

Honesty: a mediated relationship has a weaker verification grade (no
co-presence; mediator-MITM possible). UI: "◇ verified via <mediator>"
instead of "⇄ verified", upgradeable by a real encounter. The
mediator's vouching is signed but DV to both sides (class V).

UX invariant (one-way-door rule): acceptance is a button plus sheet,
never a toggle; three devices, three decisions, each at the right
party.

## 9. Documented options and open points

### 9.1 Authenticated grade delivery (option, mechanics unproven)

The count/blinded declaration (Section 5.5) should travel as an
addressee-bound DV policy artifact with monotone revision. The
simulator probe was removed rather than simulated wrongly (its first
version let anyone set foreign policies). Risk is bounded: see 5.5 —
forgery can only narrow. A finer grade ladder (per-recipient
"show" up to introduction permission) was tried in the UX and
withdrawn (22.08.): the spec may offer granularity; the default UX
collapses it to the one human question "do I trust this person?".

### 9.2 The encounter-credential flank (deliberately undecided)

By the audience principle the encounter credential's audience would
be only the counterpart (class V, DV). Against that: ZK counting
predicates need a proof-friendly substrate, and Ed25519 + SHA-256 are
ZK-hostile. Noted candidate: **pre-wire a commitment** (e.g. a
Pedersen commitment as an additional credential field — cheap now,
keeps the ZK door open, analogous to the SCID seam). Not decided
here: it would touch converged Encounter 0.22 and needs its own
loop.

### 9.3 Feasibility map for predicates (informative, early 2026)

DV mapping = 3DH-MAC (implemented, Section 6) · DV-ZK counting
predicates = Sigma-OR, implementable with @noble/curves, no audited
off-the-shelf library · selective disclosure / counting = BBS+
(@mattrglobal, W3C bbs-2023 draft, WASM) · general SNARKs = expensive,
only if predicates outgrow counting and subsets.

### 9.4 Per-community membership pseudonymity (deliberately open)

FPP/DTGWG establish a separate M-DID per community; cross-community
correlation happens only by deliberate P-DID reuse. In this family,
co-members hold the S-DID: people who share two groups can correlate
a member across them — deliberate design (members know each other;
membership is metadata-visible), but a real difference, not a
translation detail. Open question for the review loop: MAY
membership optionally bind to the group-context anchor instead? The
cost side is named: the star and the introduction act live on
co-members holding S-DIDs — a pseudonymous membership cannot be
counted or intersected. See
`fpp-mapping/docs/ableitung-vs-wallet.md` §1a.

### 9.5 Standing disclosure (from the architecture map)

Normatively capturing the standing disclosure of one's own edges to
one's own network ("unrevocable in possession, revocable in
distribution, deniable in derivation") remains open; until then it is
deliberate app policy.

## 10. Security Considerations

Attacks on our own construction, and what this document does about
them:

- **Anchor harvesting via stars.** The classic failure this document
  exists to prevent: one promotion delivering raw third-party anchors
  (the founding incident, Section 1). Countered structurally — no
  standing raw grade exists (5.1); a harvesting app is nonconformant
  by artifact shape, not by policy.
- **Collusion of star recipients.** Direct comparison of blinded
  values breaks (delivery-specific keys). NOT prevented and stated
  honestly: colluders can pool *known* anchors and keys and enrich
  retained snapshots by dictionary test (5.2). The design accepts
  this residue; it grows only with anchors the colluders already
  hold legitimately.
- **Key leak turns the star into evidence.** If `k` leaks, a
  *signed* star would prove relationships to third parties. Countered
  by 5.3: signing the star is forbidden; after a leak the artifact
  remains forgeable-by-recipient and therefore deniable.
- **Mapping forgery.** The addressee can forge any
  `anchor-mapping@2` — by design (deniability). The attack that
  matters is a *third party* claiming or verifying a mapping, and
  both are blocked: foreign self cards are unsignable, k2 is
  uncomputable, and verification itself needs addressee secrets
  (Section 6).
- **Grade-declaration forgery.** Until authenticated delivery exists
  (9.1), a forged declaration can only narrow what travels (count
  instead of blinded), never widen it (5.5). Denial-of-signal, not a
  leak.
- **Mediator man-in-the-middle in the introduction act.** Possible
  and stated: a mediated relationship carries a weaker verification
  grade, displayed as such, upgradeable only by a real encounter
  (Section 8).
- **Sybil self-evidence.** Anchors are free; any count proved
  absolutely is forgeable by a swarm. Countered by Section 7:
  relational anchoring is mandatory, the verifier's own holdings are
  the ground truth.

## 11. Privacy Considerations

- **The one-bit oracle is the feature.** A star recipient can test
  every anchor they legitimately hold — including future ones —
  against retained snapshots: "in this circle: yes/no", offline,
  unthrottled, forever. Feature and leak are the same object; the
  affected contact's remedy is the count grade, the sender's remedy
  is pausing the subscription (revocation of distribution, not of
  possession — principle 5 of the register).
- **Existence metadata.** List length and churn of a star leak.
  Publication-space rule (Section 4) bounds who observes existence
  at all: no artifact of this document is world-visible.
- **Longitudinal tracking** of opaque star entries across deliveries
  dies with epochal blinding (5.2); the stated residue is
  retrospective testing of later-learned anchors against retained
  snapshots, which no blinding construction prevents.
- **Refusal privacy.** A refused introduction leaks nothing to the
  requester, not even the target's existence (Section 8).
- **What third parties see:** class-V artifacts are not even
  verifiable by them (Section 6) — a stronger property than
  deniability alone.

## 12. Conformance

A conformant implementation:

1. emits no raw third-party anchor in any artifact of this document
   (5.1, 8.1);
2. blinds stars epochally per 5.2 and never signs them (5.3);
3. redelivers stars on the subscription triggers (5.4);
4. verifies and forges `anchor-mapping@2` exactly per Section 6 (the
   forgeability demonstration is itself a conformance check);
5. publishes every artifact into the smallest space containing its
   resolver class (Section 4);
6. anchors count statements relationally (Section 7).

## References

- Identity Layer 0.6 — `spec/identity-layer.md` (§5.2 key agreement).
- Encounter Layer 0.22 (wire 0.19) — `spec/encounter-layer.md`.
- Design source: `design/visibility-publikumsprinzip-2026-08.md`,
  `design/trust-modelle-gegenueberstellung-2026-08.md`.
- Reference mechanics: `simulator/graph.html` + `simulator/graph.mjs`
  (WebCrypto; assertions as executable negative demonstrations).
