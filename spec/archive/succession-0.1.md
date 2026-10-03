# RLTP Succession

**Real Life Trust Protocol — cross-cutting specification**

- **Status:** Editor's Draft
- **Version:** 0.1.0-draft (first casting)
- **Editors:** Anton Tranelis
- **Date:** 2026-08-09
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Conformance profile:** `rltp-succession@0.1` (draft)
- **Position:** not a layer. Succession is an act performed *on* a
  person's anchor *by* several people, and its consequences reach every
  layer (see Section 1.2).

## Abstract

A person's anchor may change: deliberately, after compromise, or after
loss of the recovery secret. This document specifies how the relations
attached to that anchor survive the change.

Authority to declare a succession rests with **guardians** the person
designated in advance — never with possession of a key, because the
holder of a stolen key can sign as readily as the rightful one, and the
rightful one cannot know whether their key was seen. A succession is
complete when enough designated guardians have witnessed, each by their
own human judgment, that the person at the new anchor is the person they
knew at the old one.

Succession asserts **human continuity**. It does not assert that the two
anchors share a key holder — that is precisely what cannot be shown when
a key is lost.

## Status of This Document

First casting, extracted from the first casting of the Encounter layer,
where it sat uneasily: an encounter credential is never revoked, while a
guardian designation must be, and two artifacts with opposite
requirements do not belong in one document. It awaits adversarial review.
Open issues: Section 9.

## 1. Introduction (informative)

### 1.1 Why authority cannot rest on the key

The obvious design is to let the old key sign the new one. It is also
unsafe, and not marginally so.

An attacker who has seen a key can sign a succession with it. The
rightful holder can sign one too. The two are cryptographically
indistinguishable, and no in-band rule breaks the tie: first-seen favours
whoever acts fastest, which is the attacker who chose the moment.

The deeper problem is that **key compromise leaves no trace**. A person
cannot know whether their key was copied, so they cannot know whether
self-succession is safe in their case. A mechanism whose safety depends
on knowledge the user cannot have is not a mechanism.

The protocol therefore places the authority where it can be exercised
knowingly: with people who can look at the person and decide.

> The key proves that you control the key. That you are you can only be
> witnessed by someone who knows you.

### 1.2 Why this is not a layer

Succession touches every part of the stack — the anchor changes
(Identity), edges must follow (Encounter), group memberships must follow
(Access) — and it is performed on one person by several. It sits across
the ordering rather than in it, alongside the other cross-cutting
concerns of this family.

It depends on Identity for the anchor and on Encounter for the ceremony
form and for the pool from which guardians may be drawn. It deliberately
does **not** depend on Access: recovering an identity must work in the
simplest client, offline, without any authority substrate.

### 1.3 Recognition is not designation

Having met someone makes them a contact. It does not make them a
guardian. In this protocol an encounter credential says "this person is
real and I met them" and nothing more — a contact list therefore
contains people met once in passing.

Guardianship is a **grant**: deliberate, made in advance, purpose-bound
to this one operation. It is not a trust score, is not transitive, and
says nothing about the guardian's standing.

## 2. Conventions and Terminology

### 2.1 Requirement language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" in this document are to be interpreted as described in
BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all
capitals, as shown here.

### 2.2 Terms

Permanent identifiers are `https://real-life.org/rltp/v1#<Fragment>`.

**Guardian** — a person deliberately designated to witness the
designator's succession.

**Guardian declaration** — the signed artifact naming a person's guardian
set and the threshold *k*.

**Succession** — the witnessed transition of a person from one anchor to
another.

**Succession credential** — the credential in which one guardian records
that the person at the new anchor is the person they knew at the old one.

| Term | Fragment |
|---|---|
| Guardian | `#Guardian` |
| Guardian declaration | `#GuardianDeclaration` |
| Succession | `#Succession` |
| Succession credential | `#SuccessionCredential` |

Referenced: **Anchor**, **Ceremony**, **Edge**, **Encounter credential**
*(Encounter layer)*; **recovery seed** *(Identity layer)*.

## 3. The Guardian Declaration

A person designates guardians by issuing a **guardian declaration**,
signed by their anchor, naming the guardian set and the threshold *k*.
Each guardian receives a copy.

- A declaration MUST name at least *k* guardians and MUST state *k*
  explicitly; `k ≥ 2`. A threshold of one would restore the single point
  of failure this document exists to remove.
- Because the declaration is signed while the key is available, it
  remains verifiable **after that key is lost**. This is what makes
  recovery possible at all.
- A declaration MUST carry a version and a monotonically increasing
  sequence number, so that a later declaration supersedes an earlier one
  (Section 4).
- The guardian set MUST NOT be published. It becomes visible only
  through the guardians who act, and only to those who verify that
  succession.
- Guardians SHOULD be drawn from the designator's mutual edges;
  implementations SHOULD propose candidates from that set and MUST
  require an explicit act to designate.

*Note (informative):* the declaration has the shape of a policy — a set
and a threshold — and a guardian circle therefore resembles a group in
the Access sense. The resemblance is deliberate but the dependency is
not: this document defines its own minimal rule so that recovery never
requires an authority substrate.

## 4. Changing the Circle

Withdrawing or adding a guardian requires issuing a new declaration with
a higher sequence number, signed by the anchor. This is possible only
while the key is available — a person who has lost their key cannot
change their circle, only use it.

Verifiers MUST evaluate a succession against the **highest-sequence
declaration they hold** and MUST reject succession credentials from
guardians not named in it. Guardians MUST forward a superseding
declaration to the other guardians they know of.

Propagation is eventual, and a stale declaration is the residual risk of
withdrawal: a removed guardian remains effective toward anyone who has
not yet learned of the change (Open Issue OI-1).

## 5. The Succession Ceremony

Succession is performed as an encounter ceremony between the person at
their **new** anchor and each participating guardian:

1. The person generates a new anchor and states which anchor it
   succeeds. The request is authenticated by the new anchor's key; this
   is not a separate step but how the guardians learn which key is
   meant.
2. Each participating guardian verifies, **by their own human
   judgment**, that this is the person they knew. The ceremony provides
   the occasion; the judgment is theirs and the protocol does not
   constrain it.
3. Each participating guardian issues a **succession credential**: *the
   person at anchor Y is the person I knew at anchor X*, bound to the
   ceremony as the Encounter layer requires, and accompanied by their
   guardian designation.

A succession is **complete** when *k* valid succession credentials exist
from distinct guardians named in the applicable declaration.

A signature by the old key MUST NOT constitute or contribute to
authority for a succession (Section 1.1). Implementations MUST NOT offer
a succession path that does not require *k* guardians.

Ceremonies MAY be performed in person or over any channel the guardian
considers sufficient; the channel is recorded as informative metadata,
as for any encounter.

## 6. Following a Succession

A party holding an edge to X, on verifying a complete succession to Y,
MAY update that edge to reference Y. Implementations SHOULD surface the
change to the user rather than applying it silently, because an anchor
change is a socially significant event.

Verification requires: the guardian declaration of X; *k* valid
succession credentials from distinct guardians named in it; and a valid
ceremony binding for each.

Different contacts will learn of a succession at different times. A
party MAY hold edges to both X and Y for a period; implementations
SHOULD present them as one person once the succession is verified
(Open Issue OI-2).

## 7. What Succession Does Not Do

- It does not transfer credentials. Credentials issued to X remain
  issued to X and continue to name X. The graph learns that X's person
  is now at Y; the historical record is not rewritten.
- It does not assert a shared key holder. In the loss case there is no
  cryptographic link between the anchors, and the specification claims
  none.
- It does not repair Access-layer memberships by itself. A group
  learning of a succession must decide, under its own policy, whether to
  admit Y in place of X (Open Issue OI-3).
- It does not prove that the person was not coerced.

## 8. Security Considerations

- **Guardian collusion is the threat this design accepts.** *k*
  colluding guardians can move a person's identity. This is the price of
  removing self-succession, and it is bounded by the fact that only
  people the person deliberately chose can do it. Implementations SHOULD
  encourage *n* meaningfully larger than *k*, and SHOULD notify the
  designator's contacts when a succession is followed.
- **Stale declarations.** A withdrawn guardian remains effective toward
  parties holding an older declaration. Sequence numbers bound the
  window but do not close it (OI-1).
- **The bootstrap gap.** A person who has designated no guardians cannot
  be succeeded and must start over. Implementations SHOULD prompt for
  designation once a person holds enough mutual edges, and MUST NOT
  present an un-designated identity as recoverable.
- **The human judgment is the security boundary.** Everything
  cryptographic here only records a decision; the decision itself is
  made by a person deciding whether they recognise someone. Guidance to
  guardians matters more than any parameter in this document.
- **Coercion.** A person can be compelled to run a succession, or
  guardians compelled to witness one. The protocol has no defence and
  MUST NOT be presented as having one.
- **Time gates.** Ceremony bindings and declaration validity MUST apply
  a bounded, configured skew tolerance consistent with the enclosing
  delivery gates.

## 9. Privacy Considerations

- The **guardian set is private** until it acts; a succession reveals
  only the *k* who participated, and only to those who verify it.
- A **succession is a visible event** to everyone holding an edge. This
  is intended — continuity is a social fact — but it means an anchor
  change cannot be kept private from one's contacts.
- Designation itself is private between designator and guardian and
  MUST NOT be published or made discoverable.

## 10. Conformance

- **Profile** `rltp-succession@0.1`; requires `rltp-identity@…` and
  `rltp-encounter@…`.
- **Classes:** *participant* (declaration, ceremony, issuance,
  following) · *verifier* (succession verification only).
- **Vector plan:** declaration validity including `k ≥ 2` and sequence
  monotonicity · supersession by a higher sequence · rejection of
  credentials from undesignated signers · completeness at *k* and
  rejection at *k−1* · **rejection of a succession carrying only an
  old-key signature** · ceremony binding per credential · following
  behaviour with a stale declaration · edge update and dual-anchor
  presentation.

## 11. Open Issues

- **OI-1 Withdrawal propagation.** Bounding the window in which a
  withdrawn guardian remains effective, without requiring connectivity.
- **OI-2 Succession propagation.** Conflicting or partial views across
  contacts; whether a superseded anchor should remain resolvable.
- **OI-3 Group memberships.** How an Access-layer group follows a
  succession of one of its members, and under whose policy.
- **OI-4 Guardian lifecycle.** Expiry of designations, behaviour when a
  guardian is themselves succeeded, and recovery when *k* guardians are
  unreachable.
- **OI-5 Competing successions.** Two complete successions of the same
  anchor to different targets, produced by disjoint guardian subsets.

## Appendix A (informative): relation to prior work

The guardian-vouching sketch in `wot-spec/research/identity-migration.md`
anticipated this document; that sketch also proposed a self-signed
migration path with "the first migration message wins" as the conflict
rule, which this specification rejects for the reasons in Section 1.1.

## References

[RFC2119] · [RFC8174] BCP 14 · RLTP Identity Layer · RLTP Encounter Layer.
