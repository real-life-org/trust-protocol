# RLTP Trust Layer

**Real Life Trust Protocol — Layer 3: Trust**

- **Status:** Editor's Draft
- **Version:** 0.31.0-draft
- **Editors:** Anton Tranelis
- **Date:** 2026-10-14
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Conformance profile:** `rltp-trust@0.31` (draft). Wire
  artifacts: `star@2` · `group-star@1` · `group-pair@1` (inside `c`
  of a group star) · `anchor-mapping@4` · `anchor-rotation@2` ·
  `self-card@2` · `profile@1` · `continuity-probe@1` ·
  `continuity-mapping@1` · `introduction-request@1` ·
  `introduction-reply@1` · `introduction-ack@1` ·
  `introduction-voucher@1`.
- **Companions (pinned):** **Identity 0.54** (normative reference: the
  `pair/` registry, §6.1; the community anchor's generations and their
  pre-rotation binding, §5.4) · **Encounter 0.31** (fresh-always
  enactment, §4.4; Section 6a here is the other half of it) · **Access
  0.57** (the roster a group pair points into, §5.5; the
  `anchor.rotate` entry, §5.6) · Membership 0.19 · **Delivery 0.81**
  (the §4.4 registry, including `star/0.2`, `group-star/0.1`,
  `anchor-mapping/0.3`, `profile/0.1`, and the `ack-delay` publication
  path `registry-declaration/0.1`).
- **Supersedes:** Network Visibility 0.30 (archived as
  `archive/network-visibility-0.30.md`).

## Abstract

This document specifies the Trust layer of the Real Life Trust
Protocol: what a person reveals to a contact, and how far that
knowledge may travel. A sender's acts toward one contact fall into
**trust classes** (Section 2a) — the star, the blinded group star,
the anchor mapping, the sealed group star, and the profile — each
with a normative default set of recipients. A contact is **trusted**
when the sender's anchor mapping is on toward it; the **Trust act**
turns it on, and with it every class whose default is the trusted
contacts. A sender may set classes singly, per contact and per group.

Around the classes, the document specifies which artifacts are
provable to whom (the audience principle), how knowledge about one's
contacts may travel (the star), how anchors of one person are linked
for exactly one addressee (the anchor mapping), how a person states
a name and picture to the people they trust (the profile), how one
relationship persists across fresh-anchor enactments (continuity),
and how strangers become contacts (the introduction act).

Its central commitment: **links between anchors are the protected
good.** Everything here is cryptographically authenticated, but only
artifacts whose purpose is presentation are transferably signed.
Everything else convinces exactly its addressee and no one further.

## Status of This Document

This is an Editor's Draft with no standing beyond its own argument.
Its artifacts other than `profile@1` are implemented in the reference
library, the introduction act under its `/probe` subpath, whose
transport shapes are not yet stable. Three parts are specified here
and not yet implemented: the profile, the trust classes of Section 2a,
and what a relationship that lags is not sent (6595, 6596); the
library's send paths withhold nothing on such a relationship, the
re-issue after a rotation included. The profile has conformance
vectors (`vectors/profile.json`). The next expected changes are the
implementation of these three in the reference library. The
attestation is a documented option without an artifact (Section 9).
Open points are listed in Section 9, and feedback is welcome via the
issues of the publication repository
(github.com/real-life-org/trust-protocol).

## Requirement language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" in this document are to be interpreted as described in
BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all
capitals, as shown here.

Every normative statement of this document is one numbered rule of
the form `RLTP-TRU-nnnn`. The leading digits of a rule number name
the section block it belongs to (2xxx for Sections 2, 2.1 and 2a,
6xxx for Sections 6, 6a and 6b, 11xxx for Section 11, 12xxx for
Section 12); the number is a stable name, kept when a rule moves
between sections, never reused, and gaps are left for insertions.
Paragraphs marked *Rationale*, the "In plain terms" paragraphs, and
the sections marked informative carry no requirement.

## 1. Introduction

*In plain terms.* You get a new contact in exactly two ways: you
meet the person, or someone introduces you and both of you agree.
Nothing in this protocol ever passes one person's lasting identifier
on to someone that person did not choose. Everything else in this
document follows from that.

### 1.1 The case this layer excludes (informative)

Hans has one contact, Peter. Suppose one act of Peter's toward Hans
delivered the standing anchors of three of Peter's contacts to Hans
as "unknown" contacts — people who never met Hans and never chose
him. No act of this document can do that.

An anchor is a capability: a tag test key, a correlation point, a
recognition mark. Deniability of a relationship claim does not
protect the anchor itself — a data collector buys keys, not claims.
The rule this document enforces everywhere is RLTP-TRU-1010
(Section 2a): whoever issues an anchor decides, per recipient, who
gets to see it, and no holder of an anchor forwards it on its
issuer's behalf.

### 1.2 Position in the layer model (informative)

This layer sits between Encounter (Layer 2) and Access (Layer 4). It
consumes the pair anchors and fresh tuples that encounters produce
(Encounter 0.31 §4.4) and the community anchor and its generations
(Identity 0.54 §5.4). It produces what one person reveals to
another — the star, the group star, the anchor mapping, the
profile — and the continuity that keeps one relationship across
enactments. Access consumes two of its artifacts: the group pair
(5.2b) and `anchor-rotation@2` (6.5). Every artifact of this layer
travels as a registered task of the Delivery Contract (its §4.4).

Layers are ordered by dependency, not by the moment an artifact
travels. The star travels to every contact before any Trust act,
yet it consists of this layer's state; a contact is the lowest
stage of this layer, and trust is what a sender reveals beyond it.

### 1.3 Two ways to a new contact (normative)

*In plain terms.* There are two doors to a new contact: meeting, or an
introduction both sides agree to. No message of this layer ever
carries someone else's lasting identifier to anyone; the fresh anchors
of an introduction are made by their owners for the new relationship.

**RLTP-TRU-1020** — An implementation MUST NOT add a contact other
than through an enactment of Encounter 0.31 or through the
introduction act (Section 8).

**RLTP-TRU-1030** — An artifact of this document MUST NOT transport
a standing anchor of a third party to anyone.

Fresh anchors created by their own issuers for a new relationship
are RLTP-TRU-1010 working, not an exception to it: the fresh pair
anchors of the introduction act are issued by their own owners for
the new relationship — issuance, not forwarding.

*Rationale.* Any third path to a new contact would hand a standing
anchor to a party its issuer never chose — the case of 1.1 in
general form. A standing anchor of a third party is a capability
whoever receives it can test tags against and correlate with; a
deniable claim around it protects the claim, not the key, so the
only protection is that no artifact carries it.

## 2. Terminology

*In plain terms.* Your contacts who have shared their community
anchor with you form the set your star is built from. Each of them
holds exactly one place in it, in the order they first shared, and
keeps that place when they resend, update or move to a new key.
When you find out that two of your relationships are the same
person, their places merge into the earlier one, as soon as the keys
they show you connect; and when one you merged by hand turns out to
show a key of someone else, it leaves without disturbing the rest.
None of this is visible to the other side.

- **Anchor** — a context identifier of an identity (Identity 0.54
  §6): a `pair/…`, `group/…`, or `persona/…` context.
- **Anchor classes (DTGWG-aligned naming):** **R-DID** = pair-context
  anchor (pairwise, no correlation) · **P-DID** = persona anchor
  (intentional correlation) · **M-DID** = group-context anchor
  ("per-community member identifier") — the DTGWG ladder, adopted
  without additions. The **community anchor** is the M-DID of a
  person's personal community at its current generation (Identity
  §5.4), serving as their private cross-relationship coordinate.
- **Generation**, **Lineage** — per Identity §5.4: the community
  anchor's generation 1 is `group/<digest>`; the lineage is the
  chain of `anchor-rotation@2` artifacts, each linking one community
  anchor to the next by `prev` and `next` and carrying the
  pre-rotation binding of `next` — a key chain, carrying no numbers
  (6.5).
- **Pre-rotation binding** — of one generation of a community
  anchor: the sha2-256 multihash of the public key of the generation
  after it (Identity §5.4, RLTP-TRU-2475), carried as `commit` by the
  artifact that introduces the generation — the self card (6.2) or
  the rotation (6.5). An anchor **meets** a binding when the binding
  computed over it equals it; only the next generation, derived from
  the holder's seed, does.
- **Rotation** — the holder's move of its community anchor to the
  next generation of the same digest, the one key that meets the
  current generation's pre-rotation binding (Identity §5.4); here,
  what the anchor mapping carries and the recipient follows (6.3,
  6.5).
- **Standing anchor** — an anchor that already identifies its owner
  in an existing context: a community anchor, a member anchor, or the
  pair anchor of an existing relationship; as opposed to a fresh pair
  anchor its owner creates for a new relationship (Encounter 0.31
  §4.4, Section 8).
- **Standing artifact** — an artifact that states a sender's current
  state toward a recipient and is kept current over time: the star,
  the group star, the anchor mapping, and the profile; as opposed to
  an artifact of one act (the continuity flow, the introduction act).
- **Trust-layer family** — the registered tasks `star/0.2`,
  `group-star/0.1`, `anchor-mapping/0.3` and `profile/0.1` of the
  Delivery Contract (its §4.4), which carry the standing artifacts
  of this layer on the relationship channel of their tuple; the
  continuity tasks and the introduction tasks are registered beside
  it, not in it (Section 12).
- **Delivery contact** — an occasion on which a delivery service
  (the Delivery Contract) is available to the sender for the channel
  of one tuple, so that a document can be handed to it; the **next
  available** delivery contact is the first such occasion after a
  duty arises. How often delivery contacts occur is not normative
  (5780); on the optical enactment path there is none until a
  delivery service is reachable (6820).
- **Trusted contact** — of a party: a contact toward which that
  party's anchor mapping class is on (Section 2a, RLTP-TRU-2020).
- **Trust class** — one kind of act of a sender toward one contact,
  with what it states, who can verify it, its default recipients and
  its prerequisite (Section 2a).
- **Setting** — of one trust class toward one contact: `default`,
  `on`, or `off` (RLTP-TRU-2810); the class is **on** toward the
  contact when its setting is `on`, or `default` and the contact is
  in the class's default recipient set.
- **Trust act** — the one decision of a sender toward one contact
  that turns the anchor mapping class on toward it (RLTP-TRU-2770);
  its user surface is the Trust button.
- **Star** — the artifact (`star@2`) by which a sender lets one
  recipient relate the sender's contact set to the recipient's own
  (Section 5).
- **Group pair** — one entry of a group star: a blinded genesis
  digest and a sealed member anchor (5.2b).
- **Profile** — the artifact (`profile@1`) in which a sender states
  its name, and optionally an image and a text, to one contact
  (Section 6b).
- **Deliverable set** — for one recipient of a sender's star: the
  admitted entries of the sender's contacts who have issued the
  sender their anchor mapping (RLTP-TRU-2040).
- **Entry** — one position of the deliverable set, committed by the
  first verified anchor mapping on one relationship (RLTP-TRU-2060):
  a relationship identity, an order position, and an admitted or
  deliverable-pending status, standing for one relationship or, after
  a merge, for several. A relationship on which no anchor mapping has
  been verified holds no entry unless a merge joined it to one.
- **Entry commit** — the sender's local event that writes an entry
  (RLTP-TRU-2060); **entry-commit order** is the order of these
  events at the sender.
- **Tuple** — the pair `(own pair anchor, counterpart pair anchor)`
  of one enactment or introduction. Fresh-always enactment creates
  a fresh tuple every time.
- **Relationship** — a holder-local chain of tuples with exactly
  one **active head**, the one live tuple of the chain (RLTP-TRU-2280,
  6.4); one such chain is also called a **strand**.
- **Anchor head** — of a relationship: its current `self`, the
  community anchor its verified anchor mapping states (6.3, 6a.1); a
  relationship on which no anchor mapping has been verified has none.
  Of an entry: the newest community anchor the entry holds, advanced
  only along a lineage (RLTP-TRU-6560), which is what the star blinds
  (5010); every entry has exactly one, since a verified mapping
  commits it (2060) and one entry never holds two successors of one
  anchor (6605). A relationship **lags** where its anchor head is held
  in its entry as superseded, as the `prev` of a link one of the
  entry's relationships holds (6550, 6595). An anchor head is an
  anchor, an active head a tuple.
- **Record side** — of one fresh tuple: the party that chooses the
  continuity mapping (RLTP-TRU-2290, 6a.4).
- **Prior-candidate set** — of one fresh tuple, per party: the
  active heads of its relationships that tuple's continuity is
  evaluated against (RLTP-TRU-2300, 6a.2, 6a.4).
- **Act** — one run of the introduction protocol, identified by
  its **act id alone** (8.1); `issuedAt` — carried by the act's
  request — is the act's lifetime datum, not an identity
  component. Per-role lifecycles and an absolute lifetime (8.1).
- **Resolver class** — of one *publication*: the set of parties
  able to make use of that publication (Section 4).
- **Audience class** — S, P, V, or D, defined in Section 3.
- **DV** — designated-verifier: verifiable only with the
  addressee's secrets; the addressee could have forged it; third
  parties cannot even check it.

#### Community anchor and trusted contacts

**RLTP-TRU-2010** — A party MUST disclose its community anchor only
selectively, to one chosen recipient at a time.

**RLTP-TRU-2020** — A party's trusted contacts MUST be exactly the
contacts toward which its anchor mapping class (Section 2a) is on.

*Rationale.* The community anchor is a stable coordinate across all
of a person's relationships; disclosed to more than the chosen
recipient, it makes every relationship of its holder correlatable.
The trusted set fixes the default recipients of the classes of
Section 2a and the recipients of a rotation (6.5). One definition,
decided by the sender's own setting of one class, makes every rule
that names trusted contacts decidable at the sender; the setting of
any other class changes what the sender sends, never who counts as
trusted. A recipient cannot tell from the mapping it holds whether
it is still trusted: a mapping it verified stays with it after the
class is turned off (2790). It can infer it from what followed the
default: where the sealed pair of a group it shares with the sender
turns to filler, or the profile stops, it sees that the sender's
settings toward it changed (2840, Section 11).

#### The deliverable set

**RLTP-TRU-2040** — The deliverable set MUST contain only contacts
whose `anchor-mapping@4` toward the sender the sender has verified
under 6.3.

**RLTP-TRU-2050** — The deliverable set MUST admit at most 10¹⁸−1
members (the wire-integer domain, 2.1), ordered by entry-commit
order, oldest first.

**RLTP-TRU-2060** — The first successful 6.3 verification of a
contact's `anchor-mapping@4` on an active head of a relationship
MUST commit an entry for that relationship, with the relationship as
the commit's idempotence key, so that one relationship holds exactly
one entry, the transitional state of 2145 excepted.

**RLTP-TRU-2070** — Every later successful verification on a
relationship that holds an entry — a repeat, a higher revision, a
rotation — MUST update the held mapping in place, keeping the entry's
position and admission status and committing no new entry.

A changed `self` changes the blinded content and reconciles as
ordinary divergence (5.4). The one exception to RLTP-TRU-2070 is the
split below.

*Rationale.* Only a contact who disclosed their community anchor to
the sender can be blinded into the sender's star (5.1); a contact who
never chose the sender must not appear in it. The bound makes
admission total: every entry has a defined place, the set is never
unbounded, and overflow is specified rather than left open; the bound
exceeds the number of humans who have ever lived and exists for
totality, not for practice. Without the relationship as idempotence
key, repeat deliveries would create duplicate entries, and a resent
or rotated mapping would move the contact to the end of the order or
trigger admission a second time.

#### Split

**RLTP-TRU-2080** — Where the first verified anchor mapping on a
relationship that joined a merged entry by the manual merge (6640)
leaves that relationship holding none of the anchors the entry's
other relationships hold, or, for one anchor they hold, a pre-rotation
binding that differs from theirs (6610), that relationship MUST leave
the merged entry atomically, while the entry keeps its position, its
admission status and its remaining relationships with their aliases,
releases no slot, and recomputes its anchor head from what its
remaining relationships hold, as it also does when one of its
relationships departs.

**RLTP-TRU-2090** — The leaving relationship MUST take its chain
aliases and its provenance and continuity facts (8.6, 6a) with it
and re-enter the deliverable set through an ordinary entry commit:
its own entry at the next position in entry-commit order, admitted,
or deliverable-pending if the set is full, subject to 6a.1.

**RLTP-TRU-2100** — The leaving relationship MUST keep its
relationship identity as the identity of its new entry, and where
that identity was the merged entry's, the remaining entry takes the
identity of its oldest remaining relationship in entry-commit order,
with every holder-local key that resolved through the old identity
rewritten to the new one in the same atomic step; the same holds
when that relationship departs.

**RLTP-TRU-2115** — The leaving relationship MUST start every trust
class, and the sealed group star in every group (2830), at
`default`, except where the merged entry held `off`, which the
leaving relationship takes with it, while the remaining entry keeps
its settings.

One verification splits an entry: the first mapping on a relationship
that joined the entry by hand, which the head rule and the binding
rule never checked (6640). It splits where that mapping names no
anchor the entry's other relationships hold, or another pre-rotation
binding for one they hold. A first mapping that names an anchor the
others hold, a superseded one included, keeps the relationship in the
entry, lagging where the anchor is superseded (6595). Every other
verification on a relationship of an entry keeps its `self`, follows a
rotation the bindings it holds admit, or is rejected (6.3), so it
leaves the relationship connected to the others.

*Rationale.* The manual merge rests on the holder's judgment alone; a
mapping that then shows no anchor of the entry, or a binding the
entry's anchors do not carry, shows that the judgment joined
relationships nothing links. Such a relationship must not drag the
others along, and must not reorder the set or free a slot that a
pending entry would then take. A relationship that states another
binding for one of the entry's anchors could follow a successor the
entry's binding refuses and leave the entry with two successors of one
anchor (6605). The leaver must neither lose its chain facts nor keep
the old entry's position, which belonged to the person the entry
stands for, not to it. A holder-local key that resolves through an
identity that no longer exists would dangle. The settings of the
merged entry were made for the person it stands for: an `on` the
leaver inherited would disclose what the user chose for that person to
a party nothing links to it any longer, while a stop the user set must
not lapse through a change the user did not decide. Where the leaver
is that person after all, the net merges it back once it presents an
anchor head the head rule and the binding rule admit (6a.1), and the
merge combines the settings again (2160).

#### One entry, one commit

**RLTP-TRU-2120** — One commit MUST write an entry whole —
relationship identity, order position, admitted or pending status —
as one step, and the sender's persistence totally orders these
commits.

**RLTP-TRU-2130** — The deliverable set, its order and its pending
entries MUST survive chaining as chain-level sender state, attached
to relationships, not to tuples.

*Rationale.* A half-written entry would admit a member without a
position, or hold a position without a member; this is 6.4's
allocation atomicity applied to the entry. Admission attached to
tuples would reset every member's position at each re-encounter,
since fresh-always enactment creates a new tuple every time.

#### Merge

**RLTP-TRU-2140** — Every merge path of 6a.1 — chaining, under 2145
where both sides hold an entry, a later mapping that satisfies the
head rule and the binding rule against another entry, the manual act
— MUST make the merged relationships' entries one entry at the
earliest position among them, whose identity is the surviving
entry's and whose other identities become its aliases, while
per-tuple keys (baselines, salts) stay with their tuples.

**RLTP-TRU-2145** — Where a chaining (6a.4) appends a tuple whose
relationship holds an entry to a chain whose relationship holds
another, the holder MUST merge the two entries only once their anchor
heads are comparable, equal or joined by a link the chain holds
(6610), and the binding rule of 6a.1 admits them, the two entries
meanwhile each keeping its position, its admission status and its
anchor head, and the appended tuple's entry taking every later
verification on the chain's active head.

This is the one state in which one relationship stands behind two
entries: the two anchor heads are community anchors whose connection
the mappings held so far do not show. It arises where the appended
tuple received a mapping under a later generation before the chaining,
with no lineage, since the sender had issued nothing earlier on it
(6420). The sender's re-issue after such a chaining (6985) carries the
lineage that connects the two; until it is verified, the star blinds
both anchor heads.

**RLTP-TRU-2146** — While a relationship stands behind two entries
(2145), the holder MUST send on it under the trust-class settings
(Section 2a) of the entry that takes its verifications, the appended
tuple's, and under 6595 as a relationship of that entry, lagging where
that entry holds its `self` as superseded, until the two entries
merge.

**RLTP-TRU-2150** — A merged entry MUST be admitted if any merged
entry was admitted and pending otherwise, and merging `k` admitted
entries frees `k−1` slots and admits the next `k−1` pending entries
in entry-commit order in one atomic merge evaluation, never pairwise,
each admission a set change (5.4).

**RLTP-TRU-2160** — A merge MUST give the merged member, per trust
class and, for the sealed group star, per (group, contact) as well
(2830), the setting `off` where any merged relationship held `off`,
otherwise `on` where any held `on`, and otherwise `default` (Section
2a, 2820), every per-group `on` of the sealed group star resetting
to `default` where the merged class setting is `off` (5450).

`off` wins only where a merged relationship held it as its setting; a
`default` that resolved to off on one strand is no `off`. A merged
`default` resolves against the merged member (2760): where the anchor
mapping class is on toward it, every class whose default is the
trusted contacts is on, on every strand. A merge takes away no trust
that no strand deliberately ended by an `off`, and grants none that no
strand held. The pause of 5.4 is the star and the blinded group star
set `off` (5830, 5760) and combines with them. Surfacing to the user
which settings a merge changed is a UI concern (11010).

**RLTP-TRU-2170** — A non-chaining merge (6a.1 rungs 2 and 3) MUST
change the admission layer only: each merged relationship stays fully
active with its active head, its subscription and its baseline, and the
counterpart is never affected.

**RLTP-TRU-2180** — Where no merged source holds an entry, the
merged identity MUST be the relationship whose active head was most
recently created in the holder's local order, with no tie-break
needed, and the first later entry commit writes its one entry under
that identity.

**RLTP-TRU-2190** — The holder's persistence MUST serialize every
verification commit into one total local order, which a
multi-device holder's store merges to one order.

**RLTP-TRU-2210** — The holder MUST serve the subscription of every
live relationship of a merged member.

**RLTP-TRU-2220** — An implementation MUST NOT unify two strands of
one person into one on the wire by chaining: an append replaces the
active head within one strand (6.4).

The admission layer is what makes parallel strands harmless — one
entry, one star content, one setting per trust class (2820). Their
cost, one delivery per strand toward one person, stays until strand
unification, an open point (9.5).

**RLTP-TRU-2230** — A verification, including its entry-commit
effect, MUST commit before a merge applies, and the merge applies as
one atomic step.

*Rationale.* A recovered mapping of any merged source must find its
entry in the survivor, and every holder-local key of the admission
layer must resolve through one identity; a merge must neither grant a
later member an earlier position nor lose one. Pairwise evaluation of
a multi-entry merge would admit pending entries in an order that
depends on merge order. Settings are held per person (2820), so a
merge must leave one setting per class; where the merged relationships
disagree, a stop the user set on any of them holds for the person, and
an explicit `on` comes next, so that a merge never resumes a
distribution the user stopped; a stop of the sealed group star as a
class covers every group, so a per-group `on` from another strand does
not reopen it. The counterpart may not know of the holder-local merge;
touching its relationship would leak the merge or break the
relationship, and 6.4 needs no new tuple state for it. A merge before
any entry commit still needs exactly one identity, and the local order
of active-head creation is total. Entry order and merge identities are
decidable only from one serialized order of verification commits.
Serving every strand of a merged member is redundant toward one person
but correct and convergent; dropping a strand would starve its
channel. The mapping wire names a single `prior`, so a chained strand
cannot absorb a second one. A merge evaluated against an uncommitted
verification could place an entry at a position that does not exist. A
relationship behind two entries counts toward the one its
verifications go to until the merge; under the settings of both, what
the holder sends on it would be undefined, and the merge then combines
the two (2160).

#### State loss and a full set

**RLTP-TRU-2240** — After state loss, an entry present in the
recovered state MUST keep its position, a verified mapping recovered
without its entry re-commits the entry immediately from the held
mapping, and where neither survived, the entry re-commits on
re-verification and appends.

No re-delivery is needed where the verification already happened,
and a re-delivered identical revision stays the repeat 6.4 says it
is.

**RLTP-TRU-2250** — A first verified mapping that arrives while the
set is full MUST yield a deliverable-pending entry that is not a
member, triggers nothing, and joins the set the moment a departure
frees room, that admission, not the earlier entry commit, being the
set change of 5.4.

**RLTP-TRU-2260** — A pending entry MUST be removed with its
relationship's departure.

*Rationale.* Recovery must not require re-delivery, and must not
turn an identical resend into a new entry at the end of the order.
At the bound, a first mapping must neither be lost silently nor
exceed the bound; the pending state keeps its place in the order.
A pending entry of a departed relationship would later admit a party
that is no longer a contact.

#### Relationships and fresh tuples

**RLTP-TRU-2280** — A relationship MUST be a holder-local chain of
tuples with exactly one active head (6.4), holding star salts, probe
sequences and mapping state per tuple, and provenance, evidence
accumulation, contact memory, the admission state of the deliverable
set, the earliest generation of 2285, the links and pre-rotation
bindings of 6610 and the trust-class settings of Section 2a, the
pause of 5.4 among them, at chain level.

**RLTP-TRU-2285** — A party MUST hold, per relationship, the earliest
community anchor under which it issued an anchor mapping on that
relationship, as chain-level state that carries over at chaining —
where both the chain and the tuple it appends hold one, as the
earlier of the two by generation — stays with a relationship that
leaves an entry (the split), and is never combined across the
relationships of one merged entry.

**RLTP-TRU-2290** — The record side of a fresh tuple MUST be the
party whose new pair anchor is lexicographically smaller by byte
order of the `did:key` strings.

**RLTP-TRU-2300** — A party's prior-candidate set of a fresh tuple
MUST be the snapshot, taken when the fresh tuple was created, of the
active heads of its relationships then, excluding the fresh tuple
itself.

*Rationale.* The split between per-tuple and chain-level state fixes
what dies with a tuple and what survives chaining; without it, a
re-encounter would either lose the relationship's history or carry
counters into a tuple they were never issued for. Both parties must
know the chooser of the continuity mapping deterministically the
moment the tuple exists, without a message. The earliest generation
decides where the lineage of a mapping begins (6420): held per tuple,
it would be lost at the first chaining, and the sender would no longer
know which generation the addressee held; at chaining the addressee
has held the chain's earlier generation on the relationship the tuple
continues, so the earlier one is where its lineage begins; held per
contact, it would have two answers where the strands of one person
began under different generations. A frozen snapshot lets both sides
evaluate continuity against the same active heads, and a chaining can
never invalidate its own `prior`. The links and bindings a
relationship holds are what condition 4b and the binding rule compare
with (6.3, 6a.1); held per tuple, they would be lost at the first
chaining, and the binding of an anchor the relationship already
followed could no longer refuse a successor of another party's
choosing on the new active head.

#### Audience class

**RLTP-TRU-2310** — An audience class (Section 3) MUST be assigned
per artifact, never per act.

*Rationale.* One act mixes artifacts of different purpose; one class
for the whole act would over-protect some of its parts and
under-protect others.

### 2.1 Common wire conventions (normative)

*In plain terms.* Every message of this layer is a small JSON
document with a body and a proof, and nothing in it may be unknown.
Either it is signed, and then anyone can check it, or it carries a
code that only its addressee can check. Every number is written as
text so that no computer rounds it, every counter only ever counts
up, and a counter that runs out stops rather than starting over.
There is exactly one way to write each value, and old or unknown
message versions are refused.

#### Envelope and proofs

**RLTP-TRU-2410** — Every artifact MUST be a JSON document `{
"body": { … }, "proof": { … } }` whose `body` carries `type` (the
versioned artifact name) and the fields its schema closes.

**RLTP-TRU-2420** — Unknown members anywhere in an artifact MUST be
rejected; every schema is closed.

**RLTP-TRU-2430** — `proof` MUST carry exactly the members its type
names: `mac`, `mac1` + `mac2`, `proofValue`, or `proofValue` +
`successorProofValue`.

**RLTP-TRU-2440** — The canonical bytes of an artifact MUST be
`JCS(body)` (RFC 8785) — the body object only, never the envelope,
never the proof.

The artifacts of this document by proof form:

| Proof members | Artifacts |
|---|---|
| `mac` | `star@2` · `group-star@1` · `profile@1` · `continuity-probe@1` · `introduction-ack@1` · `introduction-voucher@1` |
| `mac1` + `mac2` | `anchor-mapping@4` · `continuity-mapping@1` |
| `proofValue` | `self-card@2` · `introduction-request@1` · `introduction-reply@1` |
| `proofValue` + `successorProofValue` | `anchor-rotation@2` |

A `group-pair@1` is an object inside the `c` of a group star, not an
envelope of its own; its MAC is its member `proof` (5.2b).

*Rationale.* One envelope shape for every artifact keeps
canonicalization and proof placement unambiguous. Unknown members
are room for smuggling data the receiver never consented to carry.
An extra proof member could turn a deniable artifact into a
transferable one. One preimage per artifact means MAC and signature
cover exactly the content and nothing an intermediary could add.

#### Signatures, MACs, digests

**RLTP-TRU-2450** — A `proofValue` MUST be a raw Ed25519 signature
over the canonical bytes (RFC 8032), encoded `z` + base58btc, 65 to
89 characters.

This is not a W3C Data Integrity suite; Encounter cards keep their
own DI proofs — two artifact families, deliberately distinct.

**RLTP-TRU-2460** — A MAC MUST be HMAC-SHA-256 over the canonical
bytes, encoded `u` + 43 unpadded base64url characters (44 characters
in total).

**RLTP-TRU-2470** — Every digest of this document (`cardDigest`,
`requestDigest`, and any digest equality it names), the pre-rotation
binding of 2475 excepted, MUST be a sha2-256 multihash — the prefix
bytes `0x12 0x20` followed by the 32 SHA-256 bytes, encoded `u` + 46
unpadded base64url characters (47 characters in total) — over the JCS
of the digested document: the canonical bytes of the body for an
artifact of this document, and the complete card document including
its `proof` for an embedded Encounter card.

**RLTP-TRU-2480** — A digest MUST bind the canonical (JCS) document,
never its transport serialization, while the card's validity is
checked by Encounter's own DI rules (8.2), never by the digest, and
no other digest suite exists in this profile.

**RLTP-TRU-2475** — A pre-rotation binding (`commit`) MUST be the
sha2-256 multihash that Identity §5.4 defines over the Multikey bytes
of an Ed25519 public key (`0xed 0x01` followed by the 32 key bytes),
encoded as 2470 encodes a digest; the binding computed over an
anchor is that multihash over the Multikey bytes its `did:key`
identifier encodes.

*Rationale.* One signature form for this family, distinct from
Encounter's DI proofs, means neither verifier accepts the other's
form. A fixed MAC form and length make MAC equality byte equality.
An embedded Encounter card is a closed root document with its own
proof, not a `{body, proof}` envelope; a digest over only part of it
would let a different proof ride under the same digest. A transport
re-serialization must not change an artifact's identity, and a
digest binds a document without validating it. A pre-rotation
binding hashes a key, not a document, and Identity defines the
function; one encoding for every multihash makes binding equality
byte equality.

#### Key derivation and sealing

**RLTP-TRU-2490** — The KDF MUST be HKDF-SHA-256 with an empty salt,
a 32-byte output, and exact-ASCII info strings.

Every info string this document defines begins with
`rltp/visibility/`; the prefix is a frozen wire value and does not
name this document.

**RLTP-TRU-2500** — An ECDH shared secret — X25519 over Identity
§5.2 key-agreement keys — that is all-zero MUST be rejected before
key derivation.

**RLTP-TRU-2510** — AEAD MUST be AES-256-GCM with a 128-bit tag, a
96-bit nonce from a cryptographically secure source per sealing, and
a 32-byte key from the KDF above, encoded `u` + unpadded base64url of
`nonce || ciphertext || tag`, with the AAD named per use.

**RLTP-TRU-2520** — Anchor bytes MUST be the UTF-8 bytes of the
anchor's `did:key` string.

*Rationale.* One derivation everywhere, with info strings that
separate every key use, means no key serves two purposes. A low-order
public key forces a known all-zero shared secret, from which an
attacker derives the key and forges the MAC. Nonce reuse under one
GCM key breaks confidentiality and integrity. One byte form for an
anchor makes every HMAC and info string over it reproducible.

#### Timestamps

**RLTP-TRU-2530** — A timestamp (`issuedAt`) MUST be a UTC RFC 3339
date-time in `Z` form with at most three fractional digits.

The schema pattern enforces calendar value ranges — month `01`–`12`,
day bounded per month (no `31` in a 30-day month, no `30` or `31` in
February), hour `00`–`23`, minute and second `00`–`59` — with one
named remainder: `02-29` is admitted in every year.

**RLTP-TRU-2540** — A producer MUST emit a calendar-valid RFC 3339
date.

**RLTP-TRU-2550** — A verifier MUST reject a date its RFC 3339
parser refuses.

The schema thus admits exactly the named remainder beyond the RFC
set, and the verifier closes it.

**RLTP-TRU-2560** — A leap second MUST NOT be emitted.

**RLTP-TRU-2570** — Every time comparison of this document (the act
lifetime and the ack windows, 8.1, 8.4) MUST truncate every operand,
including `now`, to whole seconds toward the past, every tolerance
widening acceptance.

*Rationale.* Three fractional digits bound the field. Leap-year
arithmetic does not belong in a pattern, so the pattern leaves one
remainder; an honest producer never uses it, and a verifier that
accepted a date its parser refuses would leave implementations
normalizing an invalid date differently and disagreeing on the
verdict. A leap second is not representable in the pattern, and
parsers disagree on it. Without truncation, the verdict at a
window's edge would depend on the verifier's clock resolution;
truncation with widening tolerances can add an accepted borderline
case, never withdraw one. Encounter's whole-second rule governs
Encounter comparisons only and does not reach a companion's own
windows (Encounter 0.31, RLTP-ENC-2200), so this document states its
own.

#### Integers and exhaustion

**RLTP-TRU-2580** — Integers on the wire (`salt`, `seq`, `probe`,
`revision`) MUST be JSON strings in base 10 with no leading zeros, no
sign and no exponent, at least 1 and at most 18 digits long (domain 1
… 10¹⁸−1).

The schema pattern enforces the full domain; schema and prose admit
the same set.

**RLTP-TRU-2590** — Comparisons of `salt`, `seq`, `probe` and
`revision` MUST be exact over the full 18-digit domain, by
arbitrary-precision integers or by length-then-lexicographic
comparison of the canonical strings; a consumer that compares
through a binary floating-point type is nonconformant.

**RLTP-TRU-2600** — A counter that has issued its maximum value MUST
issue nothing further in that scope — no rollover, no reset.

**RLTP-TRU-2610** — A duty whose discharge would require issuing in
an exhausted scope MUST be treated as suspended, not violated:
nothing issues, the duty dies with its tuple like every duty (5.4,
6.4), and nothing migrates to a later tuple.

It is the relationship that waits, not the duty: continuity of
service is restored by the next tuple's own formation rules, which
need no duty, counter, or revision state from the old one — the
subscription re-forms under the new-head corollary of 5.4, and
probes and mappings are per fresh tuple (6a). The 6a construction
consumes the prior-candidate set and the prior relationship key;
those are its inputs, not migrated duties.

**RLTP-TRU-2620** — Until the next tuple forms, the exhausted scope's
last issued state MUST stand, so that a suspended alignment leaves
only the outbound claim stale, never the local graph, which follows
the record side's mapping (6a.4).

**RLTP-TRU-2630** — An exhausted scope MUST NOT deactivate anything;
chaining's single trigger stays 6a.4.

*Rationale.* Strings in base 10 are exact on every platform. The
domain exceeds 2⁵³; above it, a floating-point comparison accepts a
replayed lower value as greater. Rollover would re-issue values the
receiver already accepted, which is a replay window. A duty that
cannot be met must not make every implementation nonconformant, and
carrying old counters into a new tuple would reintroduce the values
exhaustion protects. Because the local graph follows the record
side's mapping, a stale outbound claim cannot fork it. Exhaustion as
a trigger would let one party chain unilaterally. At one issuance
per second the domain lasts over 31 billion years; the rules exist
because totality is this document's standard, not because the state
is reachable.

#### Encodings and types

**RLTP-TRU-2650** — Every `u…`/`z…` value MUST re-encode
byte-identically; a value whose canonical re-encoding differs is
malformed, and equality of MACs, act ids and digests is byte
equality of canonical encodings.

**RLTP-TRU-2660** — A consumer MUST reject any `type` it does not
implement, explicitly including `anchor-mapping@1`,
`anchor-mapping@2`, `anchor-mapping@3`, `anchor-rotation@1`,
`self-card@1`, `star@1`, and every unknown version.

There is no version negotiation.

*Rationale.* Two encodings of one value would defeat every
byte-equality check — a replay under a different spelling. Version
negotiation is a downgrade path to weaker forms; a consumer that
accepted a superseded version would accept exactly the form the
current one was made to replace.

## 2a. Trust classes (normative)

*In plain terms.* Trust is not a level. It is a set of things a person
chooses to show one contact: which of their own contacts that contact
also knows (blinded), which groups the two share, the key that ties
all of their relationships together, who they are inside a shared
group, and their name and picture. Each of these is a class, and each
class has, toward each contact, one of three settings: its default,
on, or off. Giving someone your anchor mapping is what makes them a
trusted contact; the Trust button does exactly that, and every class
whose default is "trusted contacts" follows. Taking the mapping back
makes the contact untrusted again: what followed the default stops,
and what you switched on by hand stays on. A setting holds for the
person, on every channel you have with them, except a channel that
still shows a key the person has moved on from: that one gets nothing
but your star and your blinded group star until it shows the current
key. Only your own new key after a rotation still reaches it: where
that channel was not yet behind when you rotated, or once it shows
the key the person had then. Whom you gave your anchor mapping shows
in that contact's star:
everyone who receives that star and holds your anchor sees it, which
is what the star is for, and after you rotate your anchor they also
see whom you no longer gave it. Every other setting shows in what you
send only to the contact it concerns, although someone who carries
several of your channels can guess from the size and timing of profile
deliveries which contacts get your profile. Switching off stops
sending; what the other already has, they keep. And nobody passes on
another person's key: whoever issues an anchor decides, per recipient,
who gets it.

A trust class is one kind of act of a sender toward one contact. The
table states, for each class, what it states about, who can verify
it, its audience class (Section 3), its default recipient set, and
what it presupposes.

| Class | Artifact | States about | Verifiable by | Audience class | Default recipients | Presupposes |
|---|---|---|---|---|---|---|
| star | `star@2` (5.2) | the sender's contacts that have issued the sender their anchor mapping, blinded | the addressee alone, and only for anchors it holds itself | D | every contact | nothing on the sender's side; the content arises from the anchor mappings the sender holds |
| blinded group star | `group-star@1`, entry `d` (5.2b) | the groups the sender is a current member of, blinded | the addressee alone, for each group whose genesis digest `G` it holds | D | every contact; switchable per group | nothing |
| anchor mapping | `anchor-mapping@4` (6.1) | the link between the sender's pair anchor and its community anchor | the addressee alone (DV) | S | no contact; the Trust act turns it on, and the contacts it is on toward are the trusted contacts | nothing |
| sealed group star | `group-pair@1` inside `c` (5.2b) | the sender's member anchor in one group | the addressee alone; it opens the seal whenever it holds `G` (5.2b) | V | trusted contacts; switchable per group and per contact | nothing |
| profile | `profile@1` (6b) | the sender itself: name, picture, text | the addressee alone (MAC) | S | trusted contacts | nothing |

A trusted contact is a contact toward which the sender's anchor
mapping class is on (Section 2). The Trust act is the one decision of
a sender toward one contact that turns that class on (2770). A class
answers "what", not "how much": what a sender reveals to a contact is
the measure of its trust in that contact.

**RLTP-TRU-1010** — An anchor MUST reach a party only through an act
of its issuer toward that party, decided by the issuer per recipient,
and never through a holder that forwards it on the issuer's behalf.

*Rationale.* An anchor is a capability: a tag-test key, a correlation
point, a recognition mark. A data collector buys keys, not claims,
and the deniability of a relationship claim does not protect the
anchor itself. Without this rule one decision of one contact could
deliver the standing anchors of third parties to someone who never
met them and whom they never chose. Fresh anchors that their own
issuers create for a new relationship are this rule at work, not an
exception to it (Section 8).

#### The classes

**RLTP-TRU-2710** — An implementation MUST apply each trust class as
one act of a sender toward one contact, with the subject, verifier
set, default recipient set and prerequisite the table of this section
states for it.

**RLTP-TRU-2720** — An implementation MUST NOT treat any act other
than the five classes of the table — star, blinded group star, anchor
mapping, sealed group star, profile — as a trust class.

*Rationale.* Without a closed definition every new artifact would
invent its own consent semantics, and two implementations would
disagree about what one press of the Trust button discloses. A closed
list makes the trust surface decidable.

**RLTP-TRU-2730** — An implementation MUST NOT change the setting of
one trust class toward a contact as an effect of setting another
trust class toward that contact or any other.

A `default` setting resolves against its class's default recipient
set (2760), which for the sealed group star and the profile is the
set of trusted contacts; that is what the default is, and the setting
itself stays `default`.

**RLTP-TRU-2740** — A sender MAY send a sealed group pair for a group
it lists to any contact, whether or not its anchor mapping class is on
toward that contact.

The sealed group star travels inside the blinded group star's entry
for the same group (5.2b). Where the blinded group star is not sent
toward a contact, or the group is switched off, there is no entry to
carry a sealed pair; this is the carrier, not a condition between the
settings of the two classes.

*Rationale.* A coupling between settings forces a disclosure the user
did not choose, or blocks one the user did choose: a sender who wants
one contact to recognise it inside one group need not hand that
contact the key that links all its relationships. A group pair names
the member anchor of one group, not the community anchor, and the
recipient verifies it against its own state of that group (5.2b); it
needs no anchor mapping to be meaningful.

**RLTP-TRU-2750** — An artifact of a trust class MUST NOT carry a
field that expresses a degree of trust.

*Rationale.* A degree-of-trust field would be a trust score that every
recipient could compare and pass on; global per-everyone scores are
either forgeable or central (Section 7). The class model already
answers the question such a field would answer, by what the sender
reveals.

#### Defaults and the Trust act

**RLTP-TRU-2760** — An implementation MUST resolve a `default` setting
(2810) to the default recipient set the table states for its class:
every contact for the star and the blinded group star, no contact for
the anchor mapping, and the trusted contacts for the sealed group star
and the profile.

A class is on toward a contact when its setting is `on`, or `default`
and the contact is in the class's default recipient set; otherwise it
is off.

**RLTP-TRU-2770** — The Trust act toward a contact MUST set the
anchor mapping class toward that contact to `on`.

**RLTP-TRU-2780** — A sender MAY set any trust class toward a contact
locally to `on`, `off`, or back to `default`, per contact and, for the
two group classes, per group.

No wire field carries a setting: a setting changes only what the
sender sends. The local switches of this specification are such
settings: the pause (5.4) is the star and the blinded group star set
`off` toward one contact, the per-group switch (5.2b) takes one group
out of the blinded group star toward every contact, and the
per-(group, contact) setting of 2830 turns the sealed group star on or
off for one group toward one contact.

*Rationale.* Two conformant implementations must reveal the same
things by default; a default left to the implementation would make
the user's disclosure depend on the app. One human decision makes one
contact trusted, and the classes whose default is the trusted
contacts follow it, so that a person who presses Trust gets what the
button promises. Power users set classes one by one. A setting of any
class other than the anchor mapping never changes who is a trusted
contact, so a profile sent without an anchor mapping does not make
its recipient trusted. A setting visible on the wire would tell
whoever sees the artifact what the sender chose to withhold, which is
why the sealed group star has a filler form indistinguishable from a
sealed pair to anyone who cannot open it (5.2b). The filler hides
nothing from the contact it concerns where that contact holds the
group's digest: it finds that `c` does not open (Section 11). What
the anchor mapping reveals through other parties' stars is its
purpose and is named in Section 11.

**RLTP-TRU-2790** — Whenever a trust class turns off toward a contact,
the sender MUST stop sending that class to that contact, sending
filler in its place only where the class has a padded form, the
sealed group star (5430), and nothing in its place otherwise; what
the contact already holds stays with it.

*Rationale.* A sent artifact cannot be unsent, so no recall is
possible; the honest promise is to stop distribution. A protocol that
claimed more would mislead the user about what the contact still
holds (Section 11). The sealed group star travels inside an artifact
that keeps flowing, so a pair left out would show in that artifact's
shape; the filler keeps the shape. Every other class is an artifact
of its own: a filler star, group star, mapping or profile would be a
delivery that carries nothing, and a delivery is itself metadata
(5720); silence is also what an unchanged state looks like.

#### Settings per contact and their withdrawal

**RLTP-TRU-2810** — A sender MUST hold, per trust class and contact,
exactly one of the settings `default`, `on` and `off`, every setting
starting at `default`.

**RLTP-TRU-2820** — A sender MUST apply each setting toward a contact
to every relationship of that contact, the relationships of one merged
member (Section 2) counting as one contact, except as 6595 states for
a relationship that lags.

A merge combines the settings of the merged relationships by 2160;
the settings are chain-level state and survive chaining (2280).

**RLTP-TRU-2830** — For the sealed group star, a sender MUST hold a
setting per (group, contact) as well, a per-group `on` or `off`
taking precedence over the class's setting toward that contact.

**RLTP-TRU-2840** — Where the anchor mapping class turns off toward a
contact, every class whose setting toward that contact is `default`
and whose default is the trusted contacts MUST turn off with it, while
every class set to `on` stays on.

**RLTP-TRU-2850** — Whenever a trust class turns on for a relationship
of a contact, because it turns on toward that contact or because that
relationship ceases to lag (6595), the sender MUST send that class's
current artifact on that relationship, the star and the group star
through the reconciliation of 5.4.

A class that turns on toward a contact does not turn on for a
relationship of that contact that lags, unless it is the star or the
blinded group star (6595).

Withdrawing one class toward a contact sets that class `off`.
Withdrawing trust sets the anchor mapping class `off`; the contact is
no longer trusted (2020), and 2840 states what follows.

*Rationale.* Three settings keep the user's explicit choices apart
from the defaults, so that a later change of trust moves only what
followed the default. A class the sender switched on by hand is a
decision about that contact of its own: sending a profile without an
anchor mapping is a deliberate choice, and taking trust back must not
undo it. A setting held per relationship would let a stop the user
decided on one channel leave the same artifacts flowing to the same
person on another, after a merge or a parallel re-encounter. The
sealed group star is the one class with a decision per group toward
one contact, because a sender may want to be recognised in one shared
group without being recognised in all of them. A class that turns on
without its artifact being sent would leave the contact without what
the sender chose to give it.

## 3. The audience principle (normative)

*In plain terms.* Before anything gets a proof, two questions: whom
must it convince, and must the receiver be able to show it to others?
Most things only need to convince the one person they are for, so they
carry a proof only that person can check. One's profile and the key
that ties one's relationships together go to one person each, and that
person cannot show what it got to anyone else as proof that you sent
it. Only things meant to be shown, like a card or an encounter
credential, are signed so that anyone can check them, and so are the
two messages of an introduction that must convince the person on the
far side, each under a fresh key made for that introduction alone.
Nothing that ties two of a person's identities together is ever
signed. Statements about other people are also blinded, because
knowing them is already the harm.

For every artifact, two questions decide its cryptographic form:
**(F1)** whom must the statement convince for its purpose to be
fulfilled? **(F2)** must the recipient be able to pass it on?

**RLTP-TRU-3010** — The set of parties able to verify an artifact
MUST be the smallest set the artifact's purpose demands under F1 and
F2.

**RLTP-TRU-3020** — An artifact MUST take the deniable (DV) form
unless its purpose requires that parties beyond its addressee verify
it.

*Rationale.* Every party able to verify more than it needs is a party
that can pass the knowledge on as proof. A transferable proof of a
relationship outlives every context it was made for; the burden of
justification therefore lies with the signature, never with
deniability.

Every artifact belongs to one of four audience classes:

| Class | Covers | Members | Proof |
|---|---|---|---|
| **S** (about myself, directed) | statements about the sender itself, addressed to one recipient and never meant for presentation | `profile@1` (6b), `anchor-mapping@4` (6.1) | MAC under keys only the sender and the addressee can derive |
| **P** (presentable) | statements whose purpose is being shown beyond their addressee | `self-card@2` (6.2), `anchor-rotation@2` (6.5); of other layers: the encounter credential and the contact card (Encounter), the membership document (Membership); the attestation (documented option, 9.1) | transferable signature |
| **V** (links) | statements that connect two contexts of one person | `continuity-mapping@1` (6a.4), `group-pair@1` (5.2b), `introduction-voucher@1` (8.5) | DV |
| **D** (third parties) | statements about third parties | `star@2` (5.2), `group-star@1` (5.2b), `continuity-probe@1` (6a.2), `introduction-request@1`, `introduction-reply@1` (8.2), `introduction-ack@1` (8.4) | DV and blinded content; the introduction request and reply signed (3060) |

Every artifact of this document stands in exactly one row. Only
class-P artifacts are called **credentials** or **cards**. The anchor
mapping is class S and connects two contexts of its sender;
RLTP-TRU-3040 binds it as it binds class V.

**RLTP-TRU-3030** — A class-P artifact MUST be transferably signed.

**RLTP-TRU-3040** — A statement that connects two contexts of one
person MUST NOT exist anywhere as a transferable proof.

**RLTP-TRU-3050** — A key binding within one context (the self card:
Ed and X key of the same context) and a link between two generations
of one context (the anchor rotation) are not cross-context links and
MAY be transferably signed as class P.

**RLTP-TRU-3060** — A class-D artifact MUST blind its content in
addition to its DV form, the introduction request and the
introduction reply excepted (8.2).

The introduction request and reply are statements toward the other
side of an introduction act, and they are signed: each must convince
a party beyond its addressee across the mediator, the request the
target (8050) and the reply the requester (8550), which is the case
3020 leaves to a signature. Each is signed under a fresh card anchor
its owner created for the act, which identifies its owner in no
existing context, and neither names a standing anchor: the target
appears only as the mediator's opaque designator (8.3), and the
requester only as the fresh card anchor it handed out for the act
itself. The introduction acknowledgement answers a request about a
third party and carries nothing about it (8630); its MAC is DV.

*Rationale.* Presentation needs third-party verifiability, and nothing
else gets it. A transferable cross-context link proves to anyone that
two pseudonyms are one person, which is the protected good of this
specification. The personal community's context persists across the
generations of its anchor (Identity §2, "Context"; §5.4), so the
anchor rotation binds within one context; the self card binds two keys
of one context. Both keep a residue — the stable anchor and authentic
addressing material a recipient can pass on — which Section 11 names.
For statements about third parties the proof axis is not enough: the
knowledge itself harms, and deniability alone does not stop a
collector from harvesting it. The introduction request and reply
cannot be deniable and still reach the far side of the act; what keeps
them from harming is that they carry no standing anchor and no
existing relationship (8030, 8460).

**RLTP-TRU-3070** — Every artifact of this specification MUST travel
end-to-end encrypted and channel-authenticated.

*Rationale.* Authentication and audience are orthogonal: the proof
form decides who can verify a statement, the transport decides who
can read it, and a transport that widened the readers would undo the
audience the proof form chose.

**RLTP-TRU-3080** — A class-S artifact MUST carry as its own proof
only MACs under keys that only its sender and its one addressee can
derive.

*Rationale.* A statement about oneself that is meant for one person —
a name and picture, the key that ties one's relationships together —
must convince that person and no one further. A signature would turn
it into a transferable proof that this name or this community anchor
belongs to this pair anchor, presentable to anyone the recipient
chooses. Class-P artifacts carried inside a class-S artifact, such as
the self card inside the anchor mapping, keep their own class and
residue (6.2).

Class S covers the document, not the facts in it. A profile is no
transferable proof that its sender said it; the sender's name is not
thereby unprovable: a sender's contact card may carry a signed
display name (Encounter 0.31, RLTP-ENC-6080), and an introduction
request carries a signed `displayName` (8450). Section 11 names this
residue.

## 4. The publication-space rule (normative)

*In plain terms.* When something is put into a shared place, it goes
into the smallest place that holds everyone who needs it, never a
bigger one, judged at the moment it is put there. Only things meant
to be shown, like a card, may go to a place open to everyone.
Statements about oneself meant for one person, such as the profile
or the anchor mapping, and statements about others never go into a
shared place at all: they are sent to their one recipient. Sending
something to its addressee is delivery, not publication.

The rule is total and decidable. The resolver class of a publication
is the set of parties that resolve the published artifact; a group
pair, for example, is resolvable by its one addressee alone.

**RLTP-TRU-4010** — The publication-space rule MUST be applied to
every publication of a class-P or class-V artifact.

Class-S and class-D artifacts, every standing artifact among them,
are never published (4080); the rule has nothing to decide for them.

**RLTP-TRU-4020** — A publisher MUST NOT publish into any space
outside the closed list of candidate spaces: a group space (members:
the group's current members per Access and Membership at the
snapshot), a pair channel (members: the two relationship parties),
and, for class P only, a persona surface (members: unbounded).

**RLTP-TRU-4030** — The resolver class of a publication MUST be
evaluated at publication time; later growth of a space obliges
nothing, and later shrinkage is the space's own epoch and rekey
business under Access, never the artifact's.

*Rationale.* A closed scope and a closed list of spaces make the
choice decidable; a space outside the list would have no member set
to judge it by. Class P declares its audience by its purpose and is
the one class for which an unbounded audience can be the minimal
one. Without a snapshot no publication could ever be judged
conformant, because every member set changes after the fact.

**RLTP-TRU-4040** — The publisher MUST choose a candidate space that
contains the resolver class and is minimal by member-set inclusion
among the candidates that do.

**RLTP-TRU-4050** — Where several incomparable minimal spaces exist,
the publisher MAY choose any one of them; each further space is a
fresh publication decision.

**RLTP-TRU-4060** — A delivered artifact MUST be governed by its
addressee binding, never by the publication-space rule.

*Rationale.* Publishing into a larger space than the resolver class
needs widens the audience beyond the purpose: every additional member
learns the artifact and can pass the knowledge on. Where minimality
has no unique answer, the rule must still give one, so any minimal
space is conformant and a second space is judged on its own.
Transport is not publication: a delivery is bound to its addressee by
its envelope, and treating it as a publication would subject every
message to a space choice it does not have.

**RLTP-TRU-4070** — A group pair MUST NOT enter a group space; it
travels only inside the group star, on its relationship's pair
channel.

**RLTP-TRU-4080** — A class-S or class-D artifact MUST NOT be placed
into a group space or a persona surface; it travels only as a
delivery under its addressee binding.

*Rationale.* In the group space every member would learn the sender's
member pseudonym for that contact. The body of a class-S artifact is
readable by whoever holds it — a profile's name and picture, an
anchor mapping's community anchor — so in a shared space every member
would hold what its issuer decides per recipient (RLTP-TRU-1010). A
class-D artifact is keyed to one relationship and convinces only its
addressee; in a shared space it would still show every member that
the sender addressed it, when, and how large it is, which is the
metadata a collector gathers. Both classes are addressed to one
recipient by construction, so the choice of a space has nothing to
decide for them.

## 5. The star (normative)

*In plain terms.* What you show each contact about the people you
know and the groups you are in comes as two lists, the star and the
group star. Both are scrambled under a key only you and that contact
share, so the contact recognizes only people and groups it knows
itself, and neither is signed, so it cannot prove to anyone what you
sent. They are not news sent when something happens: you keep each
contact's copy current and send only when what it should hold
differs from what it has confirmed. You can switch either list off
toward one contact; then nothing is sent, and what it already has,
it keeps.

### 5.1 Standing contents: blinded — nothing else

*In plain terms.* The star is the list of the sender's contacts who
gave the sender their community anchor, each one scrambled under a
key only the sender and this one recipient share. The recipient can
check, for the people it knows itself, whether they are on the list,
and learns nobody new. No star ever shows an anchor in the clear. A
stranger becomes a contact without meeting only by an introduction,
and even then it gets no one's existing anchor, only a fresh one
made for the new relationship.

A star lets one recipient relate the sender's contact set to its own
anchors. It carries every contact in one form only, blinded.

**RLTP-TRU-5010** — A star MUST carry each member of the deliverable
set (Section 2) in exactly one form, blinded: the anchor head of
that member's entry (6560), as `HMAC(k, anchor bytes)` under the
delivery key `k` of 5.2.

For an entry of one relationship, the anchor head is the community
anchor held for that relationship (6.3); for a merged entry, it is
the newest anchor the entry holds, advanced only along a lineage
(6.5, 6560), and never the anchor of a relationship that lags behind
it. A deliverable-pending entry is not a member (2250) and stands in
no star until it is admitted. Two members whose entries hold the same
anchor head, which the binding rule can leave apart (6605), stand in
the star as one blinded value (5050). When a change of the anchor
head is owed as a new delivery is the domain of the reconciliation
view (5.4).

**RLTP-TRU-5020** — A raw third-party anchor MUST NOT appear in any
star.

**RLTP-TRU-5030** — An implementation MUST NOT disclose a third-party
anchor to a stranger through any standing artifact.

A stranger becomes a contact without an encounter only through the
introduction act (Section 8), which carries no standing anchor of a
third party (1030), only the fresh pair anchors its parties issue for
the new relationship.

**RLTP-TRU-5040** — The assembled union of `blinded[]` MUST be exactly
the set of blinded anchor heads of all members in the reconciliation
view of 5.4 at production.

**RLTP-TRU-5050** — A sender MUST NOT emit duplicate entries in a
star; members whose entries hold the same anchor head contribute one
entry.

**RLTP-TRU-5060** — A star MUST NOT carry anything about groups; what
the sender states about its own groups travels in the separate group
star of the same relationship channel (5.2b).

*Rationale.* One blinded form lets the recipient test entries against
anchors it already holds and gives it no new anchor. A raw anchor in a
star would let every recipient harvest the anchors of the sender's
contacts, and a standing form that shows an anchor would make that
harvest a feature; the introduction act is the one path by which a
stranger becomes a contact without an encounter, and it hands over
fresh anchors their own issuers create, never a standing one. A star
that carried anything other than the reconciliation view would let the
baseline of 5.4 record a state the recipient never received, and the
divergence would never be delivered. A duplicate leaks that one anchor
is held under more than one relationship or member and breaks the
sorted-union check of 5.2a. Contacts and groups travel in separate
artifacts so that each can be switched on its own (Section 2a).

### 5.2 star@2 — directional epochal blinding

*In plain terms.* Every star is new: each delivery gets a fresh,
ever-increasing number, and that number goes into the key, so two
stars cannot be compared and one direction cannot be tested against
the other. The recipient remembers the highest number it accepted and
refuses anything older. A hit means only that both hold the same
anchor; the sender could have left people out or added people it
knows, so a star is never proof of anyone's relationships.

**RLTP-TRU-5070** — A star body MUST be exactly `{ "type": "star@2",
"salt": <int-string>, "seq": <int-string>, "last": <boolean>,
"blinded": [ <mac encoding> … ] }`, validating against
`schemas/visibility-star.schema.json`.

**RLTP-TRU-5080** — A star MUST carry as its proof a `mac` under the
same key `k` that blinds its entries.

*Rationale.* A closed wire shape admits no field that would carry
meaning past the rules of this section. Because the same key blinds
and authenticates, the recipient can compute every star it receives
itself; the artifact is recipient-forgeable by construction, which is
what keeps it deniable (5.3).

**RLTP-TRU-5090** — A sender MUST use as `salt` the delivery sequence
of the relationship direction: starting at 1, strictly increasing, and
persisted atomically before send.

**RLTP-TRU-5100** — After state loss, a sender without a recovered
high-water mark from its synchronized state MUST NOT resume delivery
under the old tuple; the subscription re-forms on the relationship's
next tuple (5.4).

**RLTP-TRU-5110** — A sender MUST serialize production per direction,
so that taking the set snapshot, assigning the salt and committing are
one step.

**RLTP-TRU-5120** — The salt order MUST equal the snapshot order, so
that a star under a higher salt never carries an older set state than
a star under any lower salt.

**RLTP-TRU-5130** — A sender MUST NOT reuse a salt consumed by a
production that never completed.

Salts are therefore strictly increasing and never dense.

**RLTP-TRU-5140** — The recipient MUST persist, atomically and per
tuple, the highest completed salt.

**RLTP-TRU-5150** — The recipient MUST reject any delivery whose
`salt` is not strictly greater than the persisted highest completed
salt.

*Rationale.* A reused salt reuses `k`, and the recipient could then
track opaque entries across deliveries; a salt guessed after state
loss risks exactly that reuse, so the subscription re-forms on the
next tuple instead. The recipient keeps the highest completed salt as
truth: concurrent productions that paired a newer salt with an older
set would make it discard the newer state forever. A salt left
unacknowledged and used again could pair one key with two contents.
Without the persisted high-water mark, a replayed older star would
overwrite newer state; the strict comparison rejects replay and
rollback.

**RLTP-TRU-5160** — Sender and recipient MUST derive the star key `k`,
with both anchors as anchor bytes and `salt` in its wire string form,
as

```
k = HKDF( ikm  = X25519(pairX_sender, pairX_recipient),
          info = "rltp/visibility/blind/star/" || senderPairAnchor
                 || "/" || recipientPairAnchor || "/" || salt )
```

The two directions of one relationship never share a key.

*Rationale.* A key shared by both directions would let the entries of
one direction be tested against those of the other; the salt in the
info string gives every delivery its own key.

Properties of the star, with their limits:

- **Intersection only.** The recipient can test entries against
  anchors it legitimately holds; no new anchor reaches it.
- **No veracity.** The star is a claim by the sender, who knows `k`
  and can omit, fabricate or equivocate entries per recipient. A hit
  proves that both parties hold the anchor, nothing about any
  relationship of the sender. Fabricating a hit requires holding the
  target's anchor, which is already a capability.
- **Collusion.** Values under different `k` are not comparable;
  unknown anchors are neither extractable nor linkable across
  recipients. Not prevented: colluders pooling known anchors and keys
  can enrich retained snapshots by dictionary test.
- **Deniability.** A MAC under a shared key proves nothing to a third
  party.
- **Longitudinal tracking.** Opaque entries cannot be tracked across
  deliveries, because salts are unique per direction on both sides
  (5090, 5150). Residue: anchors learned later remain testable against
  retained snapshots, whatever the construction.

**RLTP-TRU-5170** — Consumers MUST NOT treat a star as evidence of the
sender's relationships.

*Rationale.* The sender knows `k` and can omit, fabricate or
equivocate entries per recipient; a hit establishes common possession
of an anchor, and reading it as a relationship would credit a claim
nobody can check.

### 5.2a Chunking (normative)

*In plain terms.* A large star is sent in pieces under one number,
numbered 1 to n, the last one marked. The recipient collects the
pieces in whatever order they come and accepts the star only when all
are there. Pieces that contradict each other, an end marked twice, a
piece past the end, wrong order or a repeated entry make the whole
delivery invalid. Only one delivery per contact is collected at a
time, and a newer one replaces an unfinished older one; a recipient
may also drop one that grows past what it can hold.

**RLTP-TRU-5180** — One delivery MAY span several chunks under one
`salt`, with `seq` running 1…n and exactly one chunk carrying
`last: true`.

**RLTP-TRU-5190** — A chunk MUST stay within the Delivery Contract's
65 536-byte plaintext limit.

**RLTP-TRU-5200** — A chunk MUST carry at most 1024 entries in
`blinded[]`.

**RLTP-TRU-5210** — A sender MUST carry every member of the
reconciliation view in the delivery, without truncation; the only
bound on its size is Section 2's admission rule, at most 10¹⁸−1
members (the wire-integer domain, 2.1).

**RLTP-TRU-5220** — The sender MUST sort the full entry union once,
lexicographically, and slice it into chunks in that order.

*Rationale.* Large sets must fit the Delivery plaintext limit, and
Delivery rejects an oversize envelope without decrypting it. A maximal
1024-entry chunk serializes to 48 328 bytes of JCS, well under the
limit. The admission bound is stated in Section 2, so the set is never
silently cut to fit; a sender that dropped entries would deliver a
state it does not hold. Sorting the union once means no chunk order
reveals which entries were added when.

**RLTP-TRU-5240** — The recipient MUST assemble per (tuple, salt) in
any arrival order, holding a delivery with a gap open until every
`seq` from 1 to the `last` chunk's is held.

**RLTP-TRU-5250** — The recipient MUST ignore a repeated `seq` that is
byte-identical as a document, `threadId` included.

**RLTP-TRU-5260** — The recipient MUST reject the delivery on a
repeated `seq` with different bytes.

**RLTP-TRU-5270** — The recipient MUST reject a delivery in which more
than one chunk carries `last: true`.

**RLTP-TRU-5280** — The recipient MUST reject a delivery whose chunks
disagree on `threadId`.

**RLTP-TRU-5290** — The recipient MUST reject a delivery containing a
`seq` greater than the held `last` chunk's.

**RLTP-TRU-5300** — The recipient MUST reject a delivery whose entries
are out of order across the assembled union.

**RLTP-TRU-5310** — The recipient MUST reject a delivery with
duplicate entries across chunks.

*Rationale.* Delivery guarantees no order, so a gap is no error: an
unfilled gap only starves the delivery under the withholding rule
below, and a rejection there would be an oracle. A retry re-sends the
same document bytes (Delivery §4.2) and must stay harmless, while a
repeated `seq` with other bytes is a substituted chunk. Two `last`
chunks make the extent of the assembly ambiguous, and a chunk beyond
the held `last` would extend a closed one. The sender stamps one fresh
thread per delivery on every chunk (Delivery §4.4); chunks on
different threads splice two deliveries. The order and duplicate
checks enforce 5220 and 5050 at the receiver.

**RLTP-TRU-5330** — The recipient MUST hold at most one open assembly
per tuple, discarding any incomplete older assembly when a chunk with
a higher `salt` arrives.

**RLTP-TRU-5340** — The recipient MUST reject a chunk whose salt lies
below the open assembly's but above the completed high-water mark.

**RLTP-TRU-5350** — The recipient MUST advance the accepted salt only
on a completed delivery.

**RLTP-TRU-5360** — The recipient MUST discard an open assembly
atomically with its tuple's deactivation (6.4).

**RLTP-TRU-5365** — A recipient MAY discard an open assembly that
reaches a local resource limit, which leaves that delivery uncompleted
(5680) and advances no salt.

**RLTP-TRU-5366** — A recipient that discarded an assembly MUST reject
every later chunk of the same artifact on that tuple whose salt is not
greater than the discarded one, as 5340 rejects a salt below the open
assembly's, so that none of them is acknowledged, holding the
discarded salt as a lower bound beside the completed high-water mark
of the same sequence: per tuple and per artifact, for the star, the
group star (5470) and the continuity probe (6790) each.

Withholding `last` starves that delivery and occupies the single
assembly slot until a newer salt arrives; it does nothing else.

*Rationale.* One slot per tuple bounds the number of open assemblies a
recipient holds; the size of each chunk is bounded by 5190 and 5200,
and the size of one assembly only by the sender's set (5210), which
carries no count a recipient could check in advance. A recipient must
be able to protect itself against an assembly that never ends; a
discarded assembly is the same case as a starved one: its delivery
never completes, and the sender's divergence stands (Section 10).
Without the lower bound, a retried chunk of the discarded salt would
open the assembly again, past the limit the recipient protected itself
with, and retries could complete it and acknowledge a delivery the
recipient had given up. Only a strictly higher salt displaces the open
assembly, so old chunks cannot evict a newer one. A partial delivery
that advanced the salt would burn the window for the complete one. The
assembly is tuple state; one that outlived its tuple would accept
chunks addressed to a dead anchor.

### 5.2b group-star@1 — the sender's groups, blinded to every contact, sealed to the chosen ones

*In plain terms.* The group star is a second list beside the star:
the sender's groups, each scrambled so that a contact recognizes only
groups it is in itself. Every entry also carries a sealed slot. For
contacts the sender has chosen, by default those it trusts, the slot
holds who the sender is inside that group, with proof; for everyone
else it holds random bytes that look the same. The list is padded to
a multiple of 16 so the number of groups does not show. Anyone who
knows the group and is a contact of the sender can open a real slot
for that group, so the choice of whom to seal for stays the sender's
protection.

**RLTP-TRU-5370** — A group star body MUST be exactly `{ "type":
"group-star@1", "salt": <int-string>, "seq": <int-string>, "last":
<boolean>, "groups": [ { "d": <mac encoding>, "c": <aead encoding> }
… ] }`, proved by a `mac` under `k_g`.

**RLTP-TRU-5380** — Sender and recipient MUST derive `k_g` and, per
group `G` (its genesis digest in canonical `u…` form, 47 characters,
Identity §6.1), `k_e(G)`, with anchors and `salt` as in 5.2, as

```
k_g    = HKDF( ikm  = X25519(pairX_sender, pairX_recipient),
               info = "rltp/visibility/blind/group-star/" || senderPairAnchor
                      || "/" || recipientPairAnchor || "/" || salt )

k_e(G) = HKDF( ikm  = X25519(pairX_sender, pairX_recipient),
               info = "rltp/visibility/seal/group-star/" || senderPairAnchor
                      || "/" || recipientPairAnchor || "/" || salt || "/" || G )
```

**RLTP-TRU-5390** — Each entry MUST be `d = HMAC(k_g, UTF-8 bytes of
G)` and `c` = the AEAD (2.1) under `k_e(G)`, with AAD `d` in its
canonical encoding bytes, of the canonical bytes of a `group-pair@1`
body.

**RLTP-TRU-5400** — A `group-pair@1` body MUST be exactly the
following, with `memberX_sender` the key-agreement key of the card
enclosed in the operation `memberOp` names:

```
{ "type":     "group-pair@1",
  "group":    G,
  "member":   <the sender's member anchor in G>,
  "memberOp": <oid: of the canonical admission of member,
               or the genesis where the sender founded G>,
  "to":       <recipientPairAnchor>,
  "salt":     <this salt>,
  "proof":    <mac encoding> }

proof = HMAC( HKDF(ECDH(memberX_sender, pairX_recipient),
                   "rltp/visibility/mac/group-pair"),
              canonical bytes of the body without proof )
```

**RLTP-TRU-5410** — A group pair MUST NOT travel outside `c`.

*Rationale.* `k_g` and `k_e(G)` are directional, per salt and, for the
seal, per group, so no two uses share a key. The AAD binds each sealed
pair to its digest entry. The proof shows control of the member
anchor's key-agreement key to the recipient alone, because only the
recipient's pair key enters the ECDH. Outside the seal the group pair
would be a cross-context link visible to the transport; this is why
its proof sits inside the sealed body rather than beside it (2.1).

**RLTP-TRU-5420** — A sender MUST list in its group star every group it
is a current member of, open groups included, unless it has switched
that group off.

**RLTP-TRU-5430** — A sender MUST put a real group pair into `c`
exactly when the sealed group star class (Section 2a) is on for this
group toward this recipient (2760, 2830) and the recipient's
relationship does not lag (6595), and otherwise filler: random bytes
of exactly the length a real `c` would have for this entry.

**RLTP-TRU-5440** — A filler `c` MUST be indistinguishable from a
sealed pair to anyone who cannot open it.

**RLTP-TRU-5450** — Setting the sealed group star class `off` toward
a contact MUST reset every per-group `on` toward that contact to
`default` (2830), so that every `c` toward it is filler until the
sender sets a group `on` for it again.

**RLTP-TRU-5460** — The sender MUST reconcile per recipient the
entry's semantic content (the group, its mode and, for a sealed entry,
the `member` and `memberOp` the pair names), never its bytes (5.4).

The listing of a group is the blinded group star class, on toward
every contact by default, switched off per group, or switched off
toward one contact as a whole (5760, Section 2a). The sealed pair is
its own class, "who I am in this group": on by default toward trusted
contacts, and settable per (group, contact) toward any contact; it
presupposes no anchor mapping (Section 2a). Turning the anchor mapping
off toward a contact turns the sealed pairs off that follow the
default, and leaves a per-group `on` in place (2840).

*Rationale.* Default visibility of shared groups is the artifact's
purpose; the per-group switch is the sender's answer where a group
must not show. The member pseudonym goes only to contacts the sender
chooses, and a visible mode would leak whom the sender chose, so
filler and sealed pair differ only in whether they open. A per-group
`on` that survived setting its class `off` would keep sealing the
pseudonym to a contact the sender has stopped choosing. Fresh nonces
make every production's bytes differ; a comparison over bytes would
see a divergence every time.

**RLTP-TRU-5470** — The sender MUST pad the entry list with filler
entries (`d` random 32 bytes encoded like a MAC, `c` filler) to the
next positive multiple of 16, sort by `d` once, and slice it into
chunks of at most 64 entries under the rules of 5.2a, with the group
star's own `salt`, `seq`, `last` and single open assembly per tuple.

**RLTP-TRU-5480** — A sender with no group to list MUST still send one
all-filler group star toward every contact the blinded group star
class is on toward.

**RLTP-TRU-5490** — The sender MUST resample a filler that collides
with any value.

**RLTP-TRU-5500** — A completed assembly MUST have a positive multiple
of 16 entries; otherwise the recipient rejects the delivery.

**RLTP-TRU-5510** — Every `c` of one assembly MUST have the same
length; otherwise the recipient rejects the delivery.

*Rationale.* Padding hides the exact number of groups, and sorting by
`d` hides the order of joining. A missing group star would say "zero
groups". A filler colliding with a real value would test as a hit. An
entry count off the multiple of 16, or a `c` of another length, would
single out entries by size and tell filler from sealed pair.

**RLTP-TRU-5520** — For each group it is a current member of, the
recipient MUST compute `d`, test the assembled union and, on a hit,
attempt to open `c` under `k_e(G)`, treating a `c` that does not open
as a miss, not an error.

**RLTP-TRU-5880** — The recipient MUST evaluate an opened body by
steps 1 to 5 (5530 to 5570) in this order and accept it only if every
step passes, a failed step rejecting the pair as a whole.

**RLTP-TRU-5530** — Step 1, schema: an opened body MUST validate
against `schemas/visibility-group-pair.schema.json`.

**RLTP-TRU-5540** — Step 2, group: `group` MUST equal `G`.

**RLTP-TRU-5550** — Step 3, address: `to` MUST equal the recipient's
own active pair anchor of this tuple, and `salt` the assembly's.

**RLTP-TRU-5560** — Step 4, membership: `memberOp` MUST name a
canonical admission of `member`, or the genesis whose
`body.members[0]` is `member`, in the recipient's materialized state
of `G`, with `member` a current member there.

**RLTP-TRU-5570** — Step 5, proof: the MAC MUST verify under the
key-agreement key of the card in the operation `memberOp` names, with
a non-zero ECDH.

**RLTP-TRU-5580** — The recipient MUST treat an accepted pair as class
V (Section 3): it merges `member` with the sender holder-locally
(6a.1), and never republishes it, carries it into any group space, or
presents it as evidence toward a third party.

*Rationale.* A failed open must be neither an oracle nor an error
path. A fixed order gives every opened body one verdict, and a pair
accepted in part would merge a pseudonym some check refused. An
unvalidated body would admit fields outside the closed schema
(2.1). A pair sealed for another group must not answer this digest; a
pair copied from another relationship or delivery fails on `to` or
`salt`. A pair naming a non-member or a non-canonical operation would
bind a pseudonym the group never admitted, and only the MAC under the
named card's key shows that the sender controls the member anchor. The
crossing from member pseudonym to contact must stay with its one
addressee.

What the group star provides, and what it does not. A digest hit
tells the recipient that the sender claims membership in a group the
recipient is in; the claim is as unverified as every star entry (5.2,
no veracity), and a forged hit requires holding `G`, the capability
the test presupposes. A sealed pair additionally proves, to the
recipient alone, control of `member`'s key-agreement key. Residue:
`k_e(G)` derives from the relationship key and `G` alone, so whoever
holds both (any contact of the sender holding `G`: a current member, a
former member, anyone holding an open group's digest) tests the hit
and opens a real sealed pair for that group, learning the sender's
member pseudonym there; a digest obtained later opens stored group
stars the same way. The "current member" condition of 5520 is the
recipient's own acceptance rule, not a cryptographic barrier. The
sender's answers are the per-group switch of the blinded group star
and the per-contact setting of the sealed group star (Section 2a).

### 5.3 The star is not signed

*In plain terms.* Neither list is ever signed. The recipient could
have produced it itself, so it cannot show it to anyone as proof of
who the sender knows.

**RLTP-TRU-5590** — A star and a group star MUST NOT be signed.

**RLTP-TRU-5600** — Credibility of a star beyond its addressee, if
ever needed, MUST be established by a DV-ZK predicate (9.3), never by
a signature.

*Rationale.* A transferable signature would make "these values are
this person's circle" provable to third parties once `k` leaks.
Forgeability by the recipient is a requirement, not a defect; a
designated-verifier predicate convinces one verifier and no one
further.

### 5.4 Subscription — reconciliation, not an event log

*In plain terms.* For each contact, the sender keeps two lists: the
people who should currently appear, blinded, in what that contact
receives, and what the contact has last confirmed receiving. When
the lists differ, the next time the two are in contact the sender
sends the current state, under a new salt; when they are equal, it
sends nothing, because a delivery alone would say that something
happened. Whoever gives the sender an anchor mapping appears at
once; a new anchor for someone counts as a change. Nothing is ever
rolled back, and a delivery that does not get through is simply
followed by the current state next time. The group star works the
same way with its own lists. The sender can switch the star or the
group star off toward one contact, by its own decision only; then
nothing is sent, not even filler, the switch survives a new key, and
what was already delivered stays delivered. Both switched off is the
pause.

The star and the group star are state, not an event log. Per
recipient, the sender compares what the recipient should hold with
what the recipient has confirmed, and delivers when, and only when,
the two differ.

#### The two views

**RLTP-TRU-5610** — Per recipient, the sender MUST hold two views,
the reconciliation view and the baseline, over one domain: the
abstract, unordered set of pairs *(member, anchor head of its
entry)* (5010), never wire bytes and never salts.

**RLTP-TRU-5620** — The reconciliation view MUST contain every
admitted member of the current deliverable set (Section 2) from the
commit that admits it, and no deliverable-pending entry (2250).

**RLTP-TRU-5630** — The baseline MUST consist of a retained
high-water mark H, the highest completed salt and initially 0,
together with either nothing (absent, ⊥) or the pair (H, S), where
S is the snapshot completed at H.

A member enters the view in the same commit that admits it: whoever
has given the sender an anchor mapping (Section 2, 6.3) stands in the
reconciliation view at once, blinded, with no intermediate state. A
change of a member's anchor head, whether a rotation followed under
6.3, or a merge or a split that moves it, changes the view and is
therefore ordinary divergence. The time pattern this creates, a new
star shortly after a mapping, is named in Section 11.

*Rationale.* Every delivery uses a fresh salt, so the blinded values
and the bytes differ each time; a comparison over bytes or salts would
see a divergence after every delivery and never come to rest. The
anchor head belongs to the domain because it is what the star blinds:
without it, a rotated or corrected anchor would never reach the
recipient, who would keep testing against a value the sender no longer
holds. One anchor head per entry gives a merged entry exactly one
blinded value. A deliverable-pending member lies outside the bounded
set (2050); listing it would deliver more than the set. H outlives an
absent baseline, so a production after state loss cannot be seeded
from an older snapshot and a stale salt cannot recur.

#### Delivery and completion

**RLTP-TRU-5640** — The star MUST travel as the registered task
`star/0.2` (Delivery §4.4), one document per chunk.

**RLTP-TRU-5650** — Every document of the trust-layer task family
(Delivery §4.4) MUST be acknowledged deniably, by a MAC-proved
`delivery-ack` under the channel-keyed ack regime of Delivery §4.2.

**RLTP-TRU-5660** — The sender MUST treat a delivery as completed
only when it holds the verified deniable acknowledgement of every
chunk of its salt, the completing chunk's acknowledgement being
transactionally bound to the receiver's validated, committed
assembly (Delivery §4.4).

Completion is one event per salt, and nothing reorders it after the
fact.

*Rationale.* Delivery's per-document contract applies to each
chunk, so the chunk is the unit of transport. An acknowledgement
that is more provable than the artifact it acknowledges would turn a
deniable star into transferable evidence that the recipient received
it. A completion counted on mere arrival would advance the baseline
over a state the receiver rejected or never committed, and the
divergence would be lost.

#### The baseline automaton

**RLTP-TRU-5670** — The sender MUST run the baseline as the
following total automaton, in which any event not listed changes
nothing and every transition persists H and the snapshot
atomically:

| State | Event | Next state |
|---|---|---|
| H, any | completion(s, S′), s > H | H = s, baseline (s, S′) |
| H, any | completion(s, S′), s ≤ H | unchanged |
| any | state loss without recovery | 5100 applies: no resumption under this tuple, the relationship continues on its next active head |

**RLTP-TRU-5680** — An implementation MUST treat a delivery that
never completes, such as one lost on the channel or rejected by the
receiver (5.2a's below-assembly rule included), as no event: the
baseline does not roll back, and the divergence stands for the next
available delivery contact, which ships the current view under a
fresh, higher salt.

An absent baseline diverges by definition.

*Rationale.* Completions can arrive out of order; without the `s ≤ H`
row an older completion would roll the baseline back and the sender
would believe the recipient holds a state it has already replaced. A
failure event would invite resending old bytes under an old salt or
moving the baseline backwards; both pair a delivery key with a second
content or misstate what the recipient holds. A non-atomic write of H
and snapshot could, after a crash, leave a high-water mark without its
snapshot or the reverse.

#### The delivery duty

**RLTP-TRU-5690** — Whenever the two views differ, the sender MUST
deliver the reconciliation view itself under a fresh `salt` (the
scope's next unissued value) on the next available delivery contact
of the active head, unless the star class is off toward the
recipient (5830) or the scope cannot issue.

**RLTP-TRU-5700** — The sender MUST treat the scope as unable to
issue only where 2.1 forbids issuance (exhaustion, 2600) or 5.2
forbids it (state loss without a recovered high-water mark, 5100).

**RLTP-TRU-5710** — A sender MUST NOT leave a divergence standing
past an available delivery contact while the star class is on toward
the recipient and the scope can issue.

**RLTP-TRU-5720** — Where the reconciliation view equals the
baseline's snapshot, the sender MUST NOT deliver.

The star's `blinded[]` arises from the same projection that the
comparison uses: what is compared is what is produced.

*Rationale.* Liveness: the recipient must converge to the sender's
current state, so a standing divergence cannot be left for some
later occasion. An open excuse for not issuing would hollow out
that duty; the closed predicate leaves only the two states in which
issuing would reuse or guess a salt. A delivery is itself metadata,
showing that the sender's state changed at a certain time; a
delivery where nothing diverges would broadcast that event (who met
whom, when) without carrying anything the recipient lacks.

#### The group star

**RLTP-TRU-5730** — The sender MUST reconcile the group star (5.2b)
toward each recipient by the rule of 5690, with the blinded group star
class in the place of the star class, so that the group star is
suppressed while that class is off toward the recipient (5760) and the
star class has no bearing on it, and with the group star's own scope,
over its own domain: the set of tuples *(group, mode, member,
memberOp)* with mode ∈ {digest, sealed}, `member` and `memberOp`
present for sealed entries only, and salt, nonce and ciphertext
outside the domain.

**RLTP-TRU-5740** — The group star MUST travel as the registered
task `group-star/0.1` (Delivery §4.4) under the completion and
acknowledgement contract of 5650 and 5660, with its own baseline and
its own salt sequence.

**RLTP-TRU-5750** — The sender MUST treat as group-star divergence
toward a recipient only a change of the view toward that recipient
caused by: the sender joining, leaving or being removed from a
group; a change of the sender's member anchor or of the admission
`memberOp` names for a sealed entry; switching a group off or on;
or the sealed group star turning on or off toward this recipient,
for one group or for all, by its own setting, by the anchor mapping
class its default follows (Section 2a), or by the recipient's
relationship starting or ceasing to lag (6595).

**RLTP-TRU-5760** — While the blinded group star class (Section 2a)
is off toward a contact, the sender MUST NOT deliver a group star to
that contact on any of its relationships (2820), the initial delivery
of a new active head (5810) included, and sends nothing in its place.

**RLTP-TRU-5770** — A sealed entry whose `member` or `memberOp`
differs from the baseline MUST be treated as divergence even where the
group stays listed and sealed, so that the next delivery replaces
the recipient's old pair.

The domain describes the groups the sender lists toward this
recipient, per group whether `c` carries a sealed pair, and for a
sealed pair the member anchor and the admission it names.

Example: a sender that founded G lists it sealed toward a recipient,
with `member` its founding pair anchor and `memberOp` the genesis. It
leaves the continuing group and later rejoins it through an ordinary
admission under `group/<G>` (Access §5.1), with no delivery contact
toward this recipient in between, so the intermediate states
collapse. Both views list G sealed, but `member` and `memberOp`
differ: the view diverges, and the next delivery contact ships the
new pair, which replaces the recipient's old one.

*Rationale.* The group star carries the same metadata risk and the
same convergence promise as the star, so it follows the same rule.
Salt, nonce and ciphertext change with every production; inside the
domain they would make every delivery a divergence. A separate
baseline and salt sequence let the star and the group star be switched
independently without one disturbing the other's state. The closed
trigger list keeps every other event, for example a change in some
other contact's state, from causing a delivery to this recipient. The
group star is its own class with its own switch toward a contact
(Section 2a), held per person like the star's: a user who pauses a
contact switches both off and must not find the group star still
flowing on another strand. Without 5770 a founder who left and
rejoined would leave the recipient holding a pseudonym that is no
longer a current member anchor.

#### Convergence

**RLTP-TRU-5780** — At every available delivery contact the sender
MUST deliver the divergence standing at that moment, while how many
intermediate states collapse between two delivery contacts is not
normative.

Normative are **safety**, every delivery carries the set current at
its production commit, serialized per 5.2 (salt order equals
snapshot order, 5120), and **liveness**, the per-contact rule of
5690. Salts consumed by productions that never complete stay
consumed (5130).

*Rationale.* The star is state: two conformant implementations may
produce different numbers of stars for one burst of changes, but
never a different converged state. Making the number of
intermediate stars normative would turn the subscription into an
event log, and every intermediate star is metadata.

#### Corollaries

**RLTP-TRU-5790** — A new encounter that changes the set of no
recipient MUST NOT trigger a delivery.

**RLTP-TRU-5800** — The sender MUST evaluate group-star divergence
per contact, so that a change diverges the group star toward exactly
the contacts whose view it alters, and a change to a switched-off
group, or a class change toward a contact while the sender lists no
group toward it, diverges toward none.

**RLTP-TRU-5810** — The sender MUST treat a relationship's new active
head (chaining, 6a.4) that holds no completed delivery as diverging
by definition and deliver its initial star under the scope's next
unissued salt, replacing whatever the old active head's death
(deactivation, exhaustion, state loss) left undelivered.

**RLTP-TRU-5820** — Where the fresh tuple completed a delivery
before chaining, the sender MUST keep that baseline and decide by
the equality predicate of 5690 alone, so that a chaining or merge
that changes nothing delivers nothing.

A change of a listed group typically diverges the group star toward
every contact at once, a class change toward one. The initial star
of 5810 is the re-formation 5.2 names. Its recipient is the party of
the chaining itself, so it broadcasts nothing that recipient does
not already hold. A new active head whose scope cannot issue falls under
the suspension of 2610 like every duty.

*Rationale.* The encounter event is itself metadata; a star sent
because someone was met would tell the recipient when. The same holds
for groups: a change the recipient's view does not show must not
become a delivery to that recipient. A new active head starts without
a baseline, so without 5810 the subscription would stay silent after
chaining, exhaustion or state loss, and the recipient would keep a
state from the dead tuple. Where the new tuple already holds a
completed delivery, that baseline is this very tuple's state;
delivering again would only repeat the chaining event to the
counterpart.

#### Switching off and pausing

**RLTP-TRU-5830** — While the star class (Section 2a) is off toward a
contact, the sender MUST NOT deliver a star to that contact on any of
its relationships (2820), the initial star of 5810 included, and
sends nothing in its place.

**RLTP-TRU-5840** — An implementation MUST change the setting of the
star and of the blinded group star toward a contact only through the
deliberate local act of the sender (a user or policy decision) or
through a merge or a split (2160, 2115).

**RLTP-TRU-5850** — Whenever the star or the blinded group star
turns on toward a contact again, the sender MUST re-evaluate that
artifact's divergence toward the contact and resume the rule of 5690
for it.

The pause is both settings `off` toward one contact (Section 2a,
2780); each of the two classes can also be switched off alone. While
a class is off, its delivery duty is suppressed, not violated, and
nothing takes its place: neither the star nor the group star has a
filler form for a whole delivery (2790). The baseline stays as it
was, so turning the class on again delivers exactly the divergence
that stood meanwhile, and nothing where none stands. A merge keeps an
`off` that any merged relationship held (2160), a split takes it
along (2115); no other event sets or clears it. Snapshots delivered
before remain with the recipient: switching off stops distribution,
it does not revoke possession.

*Rationale.* The user's stop must survive a re-encounter; a setting
attached to a tuple would lapse at the next chaining and resume
delivery without the user's decision, and settings are chain-level
state (2280). A pause held per relationship would leave the same star
flowing to the same person on another strand; the price is that the
pause is no means against the redundant deliveries of parallel
strands toward one person (Section 11), which cost bandwidth, not
privacy. A setting changed by default or by any event other than the
sender's act would silently starve contacts of the star the protocol
promises them, the default the star class carries (Section 2a); a
merge or a split only carries over a setting the sender made. A
filler delivery would itself be metadata (5720); silence while
switched off looks like a state that has not changed. No mechanism
can recall what a recipient already holds; the honest promise is to
stop further distribution.

#### Admission in one step

**RLTP-TRU-5860** — A departure that admits a pending member in the
same step MUST change the deliverable set once.

*Rationale.* One set change yields at most one divergence and one
delivery; evaluating the departure and the admission separately
would produce an intermediate star that only reveals the exchange.

## 6. Anchor mapping (normative)

*In plain terms.* Your contact knows you under the pair anchor of your
shared relationship, not under the community anchor that stands for
you across all your relationships. The anchor mapping tells exactly
this one contact: "the person behind this pair anchor is this
community anchor". You send it to the contacts you trust; the Trust
act turns it on (Section 2a). Only the addressee can check it, and the
addressee could have made it up itself, so it proves nothing to anyone
else. When you move your community anchor to a new key, you send every
contact you trust a new mapping that carries the chain from the old
key to the new one, so they keep recognizing you. Each key names in
advance a fingerprint of the one that comes after it, so whoever
copies one of your keys cannot take your contacts along to a key of
its own: where they hold your fingerprint, its next key is discarded,
and under a fingerprint of its own it stays a separate contact to
them. On each relationship, the chain starts at the first key you gave
there, and a relationship that never carried an older key gets no
chain, only the current key. Every relationship state belongs to one
pair of anchors at a time; when a relationship moves to a fresh pair,
the old pair stops accepting anything. Taking trust back works forward
only: you stop sending, and what the contact already holds, it keeps.

### 6.1 Purpose and construction

*In plain terms.* The anchor mapping links the pair anchor of one
relationship to your community anchor, for the one contact on the
other side of that relationship. It carries two check values, one made
with the relationship's key and one with your community key, so only
you can make it and only that contact can check it. Where you moved
your key before, it can carry the chain of keys from the first one you
gave on that relationship, never further back.

An anchor mapping is a double-DH MAC construction in the Signal
pattern, computable entirely in WebCrypto. The sender issues it to the
contacts toward which its anchor mapping class is on, its trusted
contacts (Section 2, 2a); the addressee's first successful
verification of it on an active head commits the sender's one entry in
the addressee's deliverable set (Section 2).

**RLTP-TRU-6010** — An `anchor-mapping@4` MUST link the sender's pair
anchor in one relationship to the sender's current community anchor
for exactly one addressee, the counterpart in that relationship.

**RLTP-TRU-6020** — The body of an `anchor-mapping@4` MUST consist of
exactly the members below, with `lineage` either empty or holding, in
chain order and ending at `self`, at most the 64 most recent elements
of the sender's lineage from the first generation the addressee held
on this relationship (2285), as 6420 decides per relationship:

```
{ "type":     "anchor-mapping@4",
  "pair":     <sender's pair anchor in this relationship>,
  "self":     <sender's current community anchor>,
  "to":       <addressee's pair anchor in this relationship>,
  "card":     <self-card@2 document under self, 6.2>,
  "lineage":  [ <anchor-rotation@2>, … ],   // at most 64, chain order, ending at self; may be empty (6.5)
  "revision": <int-string>,
  "issuedAt": <timestamp> }
```

The field name `self` is a frozen wire spelling.

**RLTP-TRU-6030** — The proof of an `anchor-mapping@4` MUST consist of
`mac1` and `mac2`, both over the canonical bytes (2.1), keyed as
follows, where `selfX` is the key-agreement key of the sender's current
community anchor:

```
k1 = HKDF( ECDH( pairX_sender, pairX_addressee ), "rltp/visibility/mac/map1" )   // mac1
k2 = HKDF( ECDH( selfX_sender, pairX_addressee ), "rltp/visibility/mac/map2" )   // mac2
```

*Rationale.* The mapping is class S (Section 3): a statement about
oneself, directed at one addressee, deniable. A transferable link
between a pair anchor and a community anchor would prove to anyone
that two contexts are one person (3040); the double MAC convinces its
addressee and no one further. Only the controller of both the pair
key and the community key can compute both MACs, so the mapping
cannot claim a community anchor the sender does not control. The
lineage bound keeps the mapping's size bounded and still lets a
contact follow up to 64 rotations (6.5); the lineage exists for
following a rotation, so it starts at the first generation the
addressee held on this relationship, and an addressee that never held
an earlier generation there gets none (6420).

### 6.2 self-card@2 — binding, not link

*In plain terms.* The self card is the community anchor's own small
signed note: this is my key for agreeing on secrets, and this is the
fingerprint of my next key. It links nothing to anything else, but it
is signed, so whoever receives it can pass it on, and you cannot take
it back.

**RLTP-TRU-6040** — A `self-card@2` MUST be the document below, signed
raw-Ed25519 under its `anchor` per 2.1, binding the Ed25519 and X25519
keys of that one community context, carrying in `commit` the
pre-rotation binding of `anchor` (2475, Identity §5.4), and linking no
two contexts:

```
{ "body":  { "type": "self-card@2",
             "anchor": <community anchor>,
             "keyAgreement": <X25519 multikey>,
             "commit": <pre-rotation binding of anchor: to the generation after it> },
  "proof": { "proofValue": … } }
```

The type name `self-card` is a frozen wire spelling. The card is
class P (Section 3) and is not harmless: it carries the stable
community anchor and authentic addressing material, and once disclosed
the addressee can pass it on. Its `commit` is the binding of the
generation a contact learns from the card itself rather than from a
rotation into it: generation 1, or whichever generation a contact
first receives on a relationship (6420).

**RLTP-TRU-6050** — Implementations and documentation MUST NOT claim
that a disclosed self card stays with its addressee: the anchor rule
(1010) governs issuance, not possession (Section 11).

*Rationale.* The addressee needs an authentic key-agreement key of the
claimed community anchor to derive `k2`; without the card's signature
a sender could pair a foreign community anchor with a key of its own.
A key binding within one context is not a cross-context link (3050),
so it may be signed. A contact that first receives a generation from a
mapping holds no rotation into it, and without the card's `commit` it
would hold no binding for that generation, so the rotation away from
it would be unbound (Identity §5.4). What the addressee does with the
card afterwards is beyond the sender's control; promising otherwise
would be a false privacy claim.

### 6.3 Verification — the closed condition list

*In plain terms.* A contact accepts your mapping only after a fixed
list of checks, in a fixed order: it is addressed to this contact on
this relationship, its card is signed, every step in the chain of keys
is signed by both keys and goes to the key named in advance, and both
check values are right. A new key is accepted only where the carried
chain reaches the key the contact already holds; otherwise the mapping
is rejected and the contact keeps what it had. What a relationship has
learned about your keys and their fingerprints stays with it across
re-encounters.

**RLTP-TRU-6060** — The addressee MUST accept an anchor mapping only if
all conditions 6070 to 6170 hold, evaluated in this order.

**RLTP-TRU-6070** — Condition 1: the mapping MUST be a schema-valid
envelope (2.1) of a `type` the addressee implements (2420, 2660).

**RLTP-TRU-6080** — Condition 2: `body.to` MUST equal the addressee's
own active pair anchor of the relationship the mapping arrived on.

**RLTP-TRU-6090** — Condition 3: `body.pair` MUST equal the
counterpart's pair anchor of that same tuple, as held from the ceremony
or the introduction.

**RLTP-TRU-6100** — Condition 4: `card` MUST verify as `self-card@2`
under its own `anchor`.

**RLTP-TRU-6110** — Condition 4a: `lineage` MUST be empty or hold at
most 64 elements, each verifying as `anchor-rotation@2` under both its
signatures (6.5) and chained as given, each `prev` equal to the
preceding element's `next` and the last element's `next` equal to
`self`.

An empty `lineage` means only that the sender presents no history. The
chain carries no numbers, so the addressee cannot tell where in the
lineage the carried segment begins.

**RLTP-TRU-6115** — Condition 4b, pre-rotation within the chain: each
element of `lineage` after the first MUST name a `next` that meets
the `commit` of the element before it.

**RLTP-TRU-6117** — Condition 4b, the card: where `lineage` is not
empty, `card.commit` MUST equal the `commit` of its last element.

**RLTP-TRU-6118** — Condition 4b, the held bindings: for every anchor
for which the relationship, its whole chain (2280), holds a
pre-rotation binding (6610), the mapping MUST agree with that
binding, an element of `lineage` whose `prev` is that anchor naming a
`next` that meets it, and a card whose `anchor` is that anchor
carrying it as `commit`.

Where the relationship holds no binding for the `prev` of the first
element, nothing held checks that element: the addressee held no
earlier generation on this relationship (6420), and the chain proves
to it the joint authorization of each link and, from the first
element on, that each successor is the one its predecessor was bound
to (Identity §5.4).

**RLTP-TRU-6120** — Condition 5: `card.anchor` MUST equal `body.self`.

**RLTP-TRU-6130** — Condition 6: `k2` MUST be derived from
`card.keyAgreement`, never from a key claimed elsewhere.

**RLTP-TRU-6140** — Condition 7: both MACs MUST verify, each under a
key derived from a non-zero ECDH output (2500).

**RLTP-TRU-6150** — Condition 8, revision: the addressee MUST apply
the generic revision rule (6270) against the `self` this relationship
holds, never against the anchor head of a merged entry it may belong
to, and a higher revision that leaves that `self` unchanged updates
the held mapping in place (Section 2).

**RLTP-TRU-6160** — Condition 8, rotation: where a higher revision
changes `self`, the addressee holds a previous `self` for this scope,
and that previous `self` appears as `prev` of some element of
`lineage`, the addressee MUST advance the held anchor to `body.self`
as this relationship's anchor head, keep every holder-local merge
keyed by an earlier anchor, apply the head rule and the binding rule
of 6a.1 to a new merge in both processing directions, and test stars
against every anchor it holds for this contact.

Condition 4b has then checked the step from the previous `self`
against the binding held for it (6118): a rotation names no successor
of an anchor other than the one key that meets its binding, so a
relationship's anchor head advances along one chain only, and a
segment that names another successor is rejected with the current
state kept.

**RLTP-TRU-6170** — Condition 8, a linked change: where a higher
revision changes `self`, its `lineage` MUST carry the previous `self`
this scope holds as the `prev` of one of its elements (6160).

A mapping that changes `self` without a segment that reaches the held
one is rejected like every mapping that fails a condition, with the
current state kept. A holder moves its community anchor only to the
next generation of the same digest (Identity §5.4), and every
re-issue after a rotation carries the segment from the first
generation held on the relationship (6370), so a segment that misses
the held `self` arises honestly only where a contact missed more than
64 rotations (6400).

**RLTP-TRU-6610** — The links and pre-rotation bindings a
relationship holds MUST be those of the mappings verified on any of
its tuples, accumulated across rotations: each element of `lineage` a
link from its `prev` to its `next`, the `commit` of each element the
binding of its `next`, `card.commit` the binding of `self`, and, for
the `prev` of a held link, the binding computed over that link's
`next`.

They are chain-level state (2280) and carry over as 2285 states for
the earliest generation: at chaining, the chain holds the union of
what the chain and the tuple it appends hold; a relationship that
leaves an entry (the split) keeps its own; and they are never combined
across the relationships of one merged entry, the head rule and the
binding rule comparing them relationship by relationship (6a.1).

*Rationale.* Unclaimability exists only as the sum of the conditions;
a fixed order yields one verdict for every input. Condition 1 closes
smuggled members and downgrades to earlier mapping versions; condition
2 a replay of a mapping to another addressee; condition 3 binding a
mapping to a different relationship; condition 4 unsigned key material
in the card; condition 4a a broken or overlong chain that would move
the held anchor; condition 4b a successor its predecessor's binding
does not admit, which is what a key copied without the seed would have
to name (Identity §5.4), and a card or chain that states another
binding for an anchor than the one the relationship already holds, on
any of its tuples; condition 5 a valid card of someone else standing
in for the claimed `self`; condition 6 claiming a foreign community
anchor with one's own key; condition 7 a low-order key forcing a known
shared secret, and forgery. Condition 8 compares with this
relationship's own `self` because the anchor head of a merged entry
must not decide a single relationship's update. A rotation lets
contacts follow the holder without losing the relationship; a change
of `self` that no carried segment links to the held one would put an
anchor on the relationship that neither the held binding nor any link
connects to the held one, and the holder never makes such a change.
The held links and bindings are what condition 4b and the binding rule
of 6a.1 compare with. With conditions 2 to 7 in place, foreign
community anchors are unclaimable (the card is unsignable, `k2`
uncomputable), the addressee can still forge the whole artifact
(deniability preserved), and third parties can verify nothing of
`mac1` and `mac2`, which tie the mapping to this pair and this
addressee. The class-P artifacts the mapping embeds are not deniable:
the self card and every element of `lineage` verify for anyone (6.2,
6.5, Section 11).

### 6.4 Tuples, chains, revisions — the relationship lifecycle

*In plain terms.* Every encounter makes a fresh pair of anchors, and a
relationship is the chain of those pairs, of which only the newest is
live. Counters and keys belong to one pair; what the relationship
knows, its history, its settings and its place in your list, belongs
to the chain. Every artifact that can be updated carries a revision
number: the higher one wins, the same one twice must be the same
document, and a lower one is turned away.

**RLTP-TRU-6180** — An implementation MUST index star salts, probe
sequences, anchor mapping state and profile state (6b) by tuple.

**RLTP-TRU-6190** — An artifact addressed to a pair anchor that is not
the active head of any current relationship MUST be rejected, with
exactly the two exceptions 6200 and 6210.

**RLTP-TRU-6200** — Exception (a): continuity verification MUST
evaluate `prior` against the fresh tuple's snapshotted prior-candidate
set (6a.4), a bounded read of tuples that were active heads when the
fresh tuple was created, never against deeper chain history.

**RLTP-TRU-6210** — Exception (b): artifacts of an introduction act
pinned to a tuple before its deactivation MUST remain verifiable under
the pinned keys within the act's bounded lifetime (8.1).

The pin freezes keys, not state, and dies per the pin rules of 8.1.

Chaining has exactly one trigger, defined in 6a.4 (6900); this section
states only the append mechanics.

**RLTP-TRU-6220** — A chain append MUST be performed atomically with
the deactivation of the prior active head and persisted before it is
acted upon.

**RLTP-TRU-6230** — Processing the same chaining event more than once
MUST be idempotent: a double append of the same tuple onto the same
chain is one append.

**RLTP-TRU-6240** — A deactivated tuple MUST NOT accept new artifacts,
except as 6200 and 6210 state.

A non-chaining merge (Section 2) deactivates nothing: it is an
admission-layer event, and every merged relationship keeps its
active head (2170).

**RLTP-TRU-6250** — Per-tuple state MUST NOT migrate to a new tuple:
the star begins fail-closed on the new tuple, and only chain-level
state (2280), such as provenance and evidence, carries over (8.6).

The new-head corollary of 5.4 (5810) closes the star's window without
a fresh user decision. The anchor mapping can be issued on the new
tuple after a verified match while its class is on (6980); the
profile follows the active head as 6b states.

**RLTP-TRU-6260** — An implementation MUST treat a party that cannot
answer the continuity probe as a new relationship (Identity §9.3), to
which no mapping of an earlier tuple is re-attached.

**RLTP-TRU-6270** — For every revisioned type, within its scope, the
receiver MUST apply the generic revision rule: a higher revision wins;
an equal revision with a JCS-identical body is a repeat and is
ignored; an equal revision with a different body is an equivocation
error, rejected with the current state kept; a lower revision is
rejected.

The revisioned types are `anchor-mapping@4`, `continuity-mapping@1`
and `profile@1` (6b).

**RLTP-TRU-6280** — A revision MUST be compared only within its scope:
the anchor mapping per (`pair`, `to`), with `self` as content that a
higher revision changes only as a rotation (6.3, condition 8), and the
continuity mapping per (`next`, `to`) per sender, with `prior` as
content.

The scope of `profile@1` is stated in 6b.

**RLTP-TRU-6290** — A record-side continuity mapping whose `prior`
differs from that side's first verified mapping for the same (`next`,
`to`) MUST be rejected as an equivocation error, whatever its revision
(6a.4).

For the record side, `prior` is thereby frozen; the non-record side
re-issues with a higher revision to align.

**RLTP-TRU-6300** — An issuer MUST assign a revision and persist the
issued body as one step per scope.

**RLTP-TRU-6310** — An issuance whose body differs from the scope's
last issued body MUST carry a revision strictly greater than every
revision previously issued in that scope.

The issuer keeps a counter, not a pool. Send order needs no rule: the
receiver is total under monotonicity, so an overtaken older issuance
is rejected and the newest state wins.

*Rationale.* Fresh-always enactment makes the tuple the key scope, so
state indexed otherwise would mix relationships. Artifacts accepted on
a dead tuple would revive deactivated state; the two exceptions exist
because the just-deactivated tuple must stay a valid `prior` for its
own chaining, and a chaining during an introduction act must not
orphan the act. A crash between append and deactivation would leave
two active heads, and a redelivered chaining event would otherwise
append twice. Migrating keys or counters across tuples would link the
fresh tuple to the old one on the wire. A party that cannot prove the
relationship gets no back door into it: relationships are re-created,
not recovered. The revision rule closes equivocation and rollback and
makes resends harmless; revisions are comparable only within one
scope; a frozen record-side `prior` closes choice-flapping. Atomic,
monotone allocation keeps the issuer's own concurrency from
manufacturing an equivocation and makes a dead-on-arrival lower
revision unissuable.

### 6.5 anchor-rotation@2 and the rotation of the community anchor

*In plain terms.* Moving your community anchor to a new key leaves a
small document signed by the old key and the new one, carrying the
fingerprint of the key after that. The new key is always the next one
your recovery words yield, and nobody else can make a key that matches
its fingerprint. You send the move to the contacts you trust, inside
their mapping, from the first key each relationship got; a contact
that fell more than 64 moves behind cannot follow any more on that
relationship. A contact you leave out of a move keeps your old key
and loses sight of the new one.

**RLTP-TRU-6320** — An `anchor-rotation@2` MUST be the document below,
both signatures over the canonical bytes (2.1):

```
{ "body":  { "type": "anchor-rotation@2",
             "prev": <the current community anchor>,
             "next": <the next one>,
             "commit": <pre-rotation binding of next: to the generation after it> },
  "proof": { "proofValue":          <raw Ed25519 under prev>,
             "successorProofValue": <raw Ed25519 under next> } }
```

**RLTP-TRU-6330** — `next` MUST be the next generation of the same
digest (`group/<D>/<g + 1>`, at most generation 2^53 − 2), the one key
that meets the pre-rotation binding of `prev` (2475, Identity §5.4).

**RLTP-TRU-6335** — `commit` MUST be the pre-rotation binding of
`next` (2475, Identity §5.4).

Rotation ends at generation 2^53 − 2 (Identity §5.4), so every
generation a self card or a rotation introduces has a successor and
therefore a binding: `commit` is present in every `self-card@2` and
every `anchor-rotation@2`.

**RLTP-TRU-6340** — An `anchor-rotation@2` MUST NOT carry a number; the
lineage is a key chain ordered by `prev` and `next` alone.

The artifact proves that the two keys jointly authorized the link,
and, on a relationship that holds the binding of `prev`, that `next`
is the one successor `prev` was bound to before it could be copied
(6.3, condition 4b): a holder of a copied current key can co-sign a
link to a key of its own, but no key it can produce meets the
binding (Identity §5.4). It does not prove the same person, the same
seed, or any relationship, and on a relationship that holds no
binding of `prev` it proves joint authorization only. It binds two
successive anchors of the holder's community context, one context
across its lineage, independent of which personal group's log carries
the entries (Identity §2, "Context"), and links no two contexts.

**RLTP-TRU-6350** — An `anchor-rotation@2` MUST be carried only inside
an `anchor-mapping@4` (6.1) and the holder's own log (Access §5.6).

The rotation is class P (Section 3), with the transferability residue
Section 11 names.

Section 10 states what a copied key can and cannot do toward a
contact.

**RLTP-TRU-6360** — After a rotation, the sender MUST persist the label
(Identity §5.4) before it writes the `anchor.rotate` entry (Access
§5.6).

**RLTP-TRU-6370** — After a rotation, the sender MUST re-issue
`anchor-mapping@4` with a higher revision to every contact toward
which its anchor mapping class is on (Section 2a), on every
relationship of that contact that did not lag at the moment of the
rotation (6595, 6596), carrying on each relationship the lineage
segment 6420 allows for it, from the first generation held on that
relationship (2285).

**RLTP-TRU-6380** — After a rotation, the sender MUST re-issue the self
card under the new anchor wherever it is carried.

**RLTP-TRU-6390** — A contact whose held anchor the carried lineage
reaches MUST keep holding the old anchor and testing stars against it
until the new mapping arrives, and then follow the rotation under
6160.

**RLTP-TRU-6400** — A contact that no longer finds its held anchor in
the carried segment, because it missed more than 64 rotations, MUST
keep the anchor it holds and reject the mapping (6170).

On that relationship the contact no longer follows the holder: every
later mapping changes `self` against the anchor it holds and carries
no segment that reaches it.

**RLTP-TRU-6410** — While its anchor mapping class is off toward a
contact, a sender MUST NOT issue `anchor-mapping@4` to that contact,
rotation re-issues included; turning the class off is forward-only
(2790), and what the contact holds, it keeps.

A sender whose mapping a contact has verified stands blinded in that
contact's star for as long as the contact holds the sender's community
anchor; no wire signal takes this back. The way out is a rotation whose
new generation goes only to contacts the class is still on toward
(6370, Section 11). That way out is not hidden: the contact left out
receives no new mapping, and its hits on the sender in other stars
fade as their senders follow the rotation (Section 11).

**RLTP-TRU-6420** — A holder MUST issue its lineage only per recipient,
never publicly, only on a relationship on which it has issued an
anchor mapping under an earlier community anchor, and only from the
earliest community anchor under which it issued a mapping on that
relationship (2285), the first generation the addressee held there.

An addressee that never held an earlier generation on the relationship
receives a mapping with an empty `lineage`: the current generation
only. An addressee that did receives the chain from the first
generation it held there, never before it, up to the 64-element bound
(6020, 6400). The reference is the relationship, not the contact: on
each strand of one person the segment starts where that strand began.
The lineage serves following a rotation (2 → 3 → 4), not catching up
on the holder's history; nobody needs a generation before the one it
held. The chain is contiguous, so it carries every generation between
the first one the addressee held and the current one, including
generations issued while the class was off toward that addressee;
Section 11 names that residue. Per recipient is issuance discipline,
not technical non-transferability: the embedded artifacts are
signatures a recipient can extract and any third party can verify
(Section 11).

*Rationale.* Both keys sign the link, so neither a holder of the old
key alone nor of the new key alone can create it; a self-loop would
make the chain ambiguous, and a number would leak the rotation count
and invite gaps. The binding fixes the successor before the current
key is in use: a successor chosen later, by whoever copied that key,
meets no binding, and the next generation's binding travels with the
rotation that introduces it, so that the rotation after it is bound in
turn. Carrying the rotation only inside the mapping and the holder's
own log keeps it with the recipients the holder chose. A crash between
rotating and persisting the label would leave an anchor whose key
cannot be re-derived. Contacts must learn the rotation to follow it,
and `k2` must derive from the current key; holding the old anchor
until the new mapping arrives leaves no gap in star testing. The
64-element bound gives a contact that fell further behind an honest
outcome instead of an unbounded chain: it stops following, and accepts
no anchor that nothing links to the one it holds. No recall of a
delivered mapping is possible, so the honest promise is to stop
distribution; issuing the lineage per recipient limits its linkage
residue. A lineage reaching back before the first generation held on a
relationship would show its addressee generations it never held there
and, through the stars of their holders, who held them; a rotation
that left a contact out would then not hold toward the contacts
trusted after it.

## 6a. Continuity (normative, the other half of Encounter §4.4)

*In plain terms.* Every encounter creates a fresh pair of anchors, so
after the ceremony both sides find out, without asking the user,
whether they already know each other. Each side sends a blinded list
of the anchors it holds for its existing contacts; only someone who
shares that history finds a match, and a stranger learns nothing. On a
match one side, the record side, chooses which old relationship the
new one continues, and the other side follows, so both end on the same
relationship. Where the probe misses, the community anchor and then
the human can still join the two, as the ladder below sets out. A
contact who lost their data cannot answer and is a new relationship.

Fresh-always enactment (Encounter §4.4) means every ceremony creates a
fresh tuple. Whether it was a **re-encounter** is resolved in this
section.

**RLTP-TRU-6500** — Whether an enactment was a re-encounter MUST be
resolved after the ceremony, automatically, with no user dialog and no
pre-selection.

*Rationale.* A dialog or a pre-selection before the ceremony would
reveal an existing relationship to a wrong scanner; resolving it
afterwards, over the fresh enactment channel, keeps the ceremony
uninformative to anyone who does not share the history.

### 6a.1 The ladder (normative order)

*In plain terms.* A re-encounter is recognized first by the probe,
which compares shared history. Where that fails, two relationships
that show the same community anchor, or a chain of keys connecting
theirs, are merged on the device, unless they disagree about which key
comes next after one they share, which only someone who copied a key
can cause, or one shows a key the person has moved on from. A
relationship that still shows an old key of the person gets nothing
but the star and the blinded group star until it catches up; only
one's own new key after a rotation still reaches it: where it was not
yet behind at the rotation, or once it shows the key the person had
then. Where
neither works, the human can merge by hand, as long as at most one of
the relationships already carries a community anchor.

Recognition has three rungs, in this order: (1) the probe (6a.2 to
6a.4), (2) the community-anchor convergence net, (3) the manual
fallback.

#### Rung 1: the probe

**RLTP-TRU-6510** — An implementation MUST run the continuity probe
(6a.2 to 6a.4) on every enactment as the default path, before and
independent of any disclosure decision.

*Rationale.* The probe recognizes via shared pair history alone.
Recognition must not depend on whether an anchor mapping was issued,
or a relationship without one would never be recognized.

#### Rung 2: the community-anchor convergence net

A relationship's **verified anchor set** is its `self` together with
every anchor of the links it holds (6610), the lineages its
`anchor-mapping@4` carried. A relationship's **anchor head** is its
current `self` (Section 2).

**RLTP-TRU-6520** — Where continuity did not complete, the addressee
MUST merge the contact entries of two relationships whose verified
anchor sets intersect, as the holder-local admission-layer merge of
Section 2 with no wire artifact and with both relationships staying
active, subject to the head rule and the binding rule below.

*Rationale.* The net is the second chance for a re-encounter the
probe missed. The merge is a holder-local act of the addressee, so it
needs no wire artifact and never touches the counterpart; the chains
themselves unify at the next chaining (6a.4).

**The head rule.** One rule for the whole entry, in both processing
directions, with two conditions, (a) and (b).

**RLTP-TRU-6530** — Head rule (a): a relationship `r` MUST NOT merge
with a contact entry `E` unless `r`'s anchor head equals `E`'s anchor
head or the lineage `r` carries extends `E`'s anchor head, that is,
carries it as a `prev`.

**RLTP-TRU-6540** — Head rule (b): a relationship `r` MUST NOT merge
with a contact entry `E` where either side holds the other's anchor
head as superseded, that is, where `r`'s anchor head is a `prev` of
any link held by `E` from any of its relationships, or where `E`'s
anchor head is a `prev` of any link `r`'s own entry holds.

**RLTP-TRU-6550** — A relationship MUST NOT pull in another entry
under an anchor its own entry already held as superseded, nor count as
evidence toward another entry while it lags behind its own entry's
anchor head.

**RLTP-TRU-6560** — An entry's anchor head MUST be the newest anchor
the entry holds, advanced only along a lineage that extends it.

**RLTP-TRU-6580** — An implementation MUST apply the head rule both to
the incoming relationship, whose verification is being committed,
against every other entry, and, where an update on a relationship of
`E` (a rotation under 6.3, condition 8) changes `E`'s anchor head, to
every relationship `r'` of another entry against `E` at that moment.

**RLTP-TRU-6590** — A relationship refused under a superseded anchor
MUST NOT join through a later update of another relationship, the
honest one included; it joins once it presents the current anchor
head itself.

*Rationale.* Only knowledge the committed mapping newly carries
connects. A copied old anchor must not attach to the current person,
in either direction (a, b); stale knowledge, held by an entry or by a
relationship lagging behind its own entry, must not create a merge.
The operand of the rule, the entry's anchor head, is defined so that
it only moves forward along a lineage. Applying the rule in both
directions at the moment of every anchor-head change means the order
in which relationships are processed never decides a merge, and a
copier cannot ride the honest rotation into the entry.

**RLTP-TRU-6595** — While a relationship of an entry lags, that is,
while its `self` is held in the entry as superseded (Section 2), a
party MUST NOT send on that relationship any trust class other than
the star and the blinded group star until the relationship presents
the entry's anchor head itself, whatever the settings toward the
contact: no sealed group pair, no profile, and no `anchor-mapping@4`,
whether on the class turning on (2850), after a verified match (6980),
after a chaining (6985) or after a rotation of its own (6370), the
last except where 6596 lets it go out.

The sealed pairs toward such a relationship are filler (5430), and its
sealed group star diverges as it starts and stops lagging (5750). Once
the relationship presents the anchor head, every class that is on
toward the contact turns on for it, and 2850 sends that class's
current artifact, the anchor mapping included where its class is on.
The star and the blinded group star, whose default is every contact,
are not affected.

*Rationale.* An honest relationship lags for minutes: the holder's
rotation reaches each of its relationships over that relationship's
own channel (6370). A relationship that merged under a copied key
before the holder rotated lags for good, since the copier cannot
advance it (Section 10). Without this rule, what the contact gives the
person it trusts would keep reaching the copier through the setting
held per person (2820). Every issuance of the anchor mapping hands its
addressee the contact's community anchor, and the re-issue after a
rotation the contact's next generation as well; on a relationship that
lags, any of them would hand it to a party the contact never chose.
The star and the blinded group star go to every contact by default, so
through them a lagging relationship receives nothing that any contact
does not.

**RLTP-TRU-6596** — Whether 6595 withholds the re-issue of 6370 on a
relationship MUST be decided at the moment of the party's own
rotation, against the entry as the verifications committed before the
party commits that rotation by persisting its label (6360) left it:
the re-issue goes out on every relationship that did not lag then,
whether or not it lags later, and stays owed on every relationship
that lagged then until that relationship presents as its anchor head
`H`, the anchor head the entry held at that moment, or a later anchor,
its links (6610) carrying `H` as a `prev`, whether or not the
relationship still lags then.

An owed re-issue goes out as the anchor mapping current when it goes
out, under the party's current community anchor and with the lineage
segment 6420 allows, on the relationship's active head; one delivery
meets every re-issue still owed on that relationship.

*Rationale.* Decided continuously, the rule could hold two honest
parties back for good. Where both rotate at about the same time, the
rotation of each can reach the other on one strand before its re-issue
on another strand has arrived; each then sees the other's relationship
on that other strand lag, withholds its own re-issue there, and waits
for the other's, which never comes. Decided at the rotation, a party
withholds on a relationship only where the counterpart's rotation
reached it before its own rotation, on another relationship of the
same entry. Of two parties that each rotate once, at most one can have
received the other's rotation first, so on no relationship do both
withhold: the re-issue of the one that did not withhold reaches the
other, the relationship there then presents the anchor head the
other's entry held at its rotation, and what was withheld goes out.
Where both rotate before either delivery arrives, no relationship
lagged at either rotation, and both deliver.

A party that rotates again while a delivery is still underway can
withhold on the same relationship as well. Let `X` and `Y` each hold
one entry for the other with two strands `s` and `t`. `X` rotates to
`X2`; its re-issue reaches `Y` on `s` first, so `t` lags at `Y`, and
`Y`, rotating to `Y2`, withholds there. `Y`'s re-issue reaches `X` on
`s`, so `t` lags at `X`, and `X`, rotating again to `X3`, withholds
there too. When `X`'s first re-issue then arrives on `t`, `t` presents
`X2` while `Y`'s entry already stands at `X3`. Held until `t` presents
the current anchor head, `Y`'s re-issue would wait for `X3` on `t`,
which `X` withholds until `Y2` arrives there, which `Y` withholds: both
wait for good. Tied to the anchor head the entry held at the rotation,
`Y`'s re-issue goes out once `t` presents `X2`; `t` then presents at
`X` the anchor head `Y2` that `X`'s entry held at its second rotation,
and `X3` goes out. A later anchor on the lineage of `H` counts as well:
a relationship that presents one has followed the person beyond where
the entry stood when the party rotated. Sent as the current mapping,
the owed re-issue carries every generation since, so nothing stays
owed behind it.

The condition keeps a copy out. A relationship that merged under a
copied key and lagged at the rotation presents a superseded anchor and
cannot present `H` or any anchor after it, since that takes a key the
copy cannot derive (Section 10). A relationship that merged under a
copied key and did not yet lag when the contact rotated, because the
holder's rotation had not yet reached the contact, receives the
re-issue; that is the residue Section 10 names for a contact the
holder's rotation reaches only after the copier.

**The binding rule.**

**RLTP-TRU-6605** — A relationship `r` MUST NOT merge with a contact
entry `E` where a relationship of `r`'s entry, `r` included, and a
relationship of `E` hold different pre-rotation bindings (6610) for one
anchor that is in the verified anchor sets of both, in either
processing direction (6580).

The rule compares the two entries whole, every relationship of the one
against every relationship of the other, since the merge joins them
whole; an anchor only one of two relationships holds is not compared
between them. The anchor `r` presents as `self` is among those
compared, since `r` holds the binding its card states for it (6610): a
binding `E` holds for that anchor that differs from it refuses the
merge. Head rule (a) puts `E`'s anchor head into `r`'s verified anchor
set, as its `self` or as the `prev` of a link it carries (6530), so the
comparison never comes up empty. Two relationships of one person hold
the same binding for
every anchor they share, since the holder computes every binding from
its seed (Identity §5.4), and every anchor a relationship holds comes
with its binding, since every self card and every rotation carries one
(6040, 6335). Every rotation a relationship of an entry follows meets
the binding the relationship holds for its `prev` (6118), so one entry
never holds two successors of one anchor: every anchor it holds lies
on one chain, and its anchor head (6560) is always defined.

*Rationale.* A binding that differs for one anchor shows that a party
other than the holder holds that anchor's key, since the holder states
the same binding everywhere. Merged, such a relationship could follow
a successor of its own on its own tuple and leave the entry with two
successors of one anchor and no anchor head; apart, it is an entry of
its own under the anchors it chose, and the copied key gains nothing
at the holder's entry. Compared over every anchor both hold, the rule
also refuses two different successors of one anchor, since a held link
fixes the binding of its `prev` (6610). An anchor only one side holds
shows no disagreement: a relationship whose lineage begins at a later
generation than another's honestly holds no binding for the earlier
anchors (6420), and comparing over them would keep two relationships
of one person apart. The anchor `r` presents is where a copy under a
binding of its own shows, since its card states that binding. Compared
for `r` alone, the rule would let another relationship of `r`'s entry
join `E` with a binding no comparison checked. A copier that copies
the holder's own binding
from a self card passes the rule but cannot advance past the copied
generation; Section 10 follows that case.

**State cases.**

**RLTP-TRU-6630** — An implementation MUST produce the results of the
three state-case tables below, which follow from the head rule and
the binding rule.

Holder anchors `A → B → C`; the contact's entries:

| Step | Arrives at the contact | Result |
|---|---|---|
| 1 | relationship `r1`: `self = B`, lineage `A → B` | entry `E1`, anchor head `B`; `A` is superseded in `E1` |
| 2 | relationship `r2` (a copy of `A`): `self = A`, empty lineage | (a) fails (`A` ≠ `B`), (b) fails (`A` is a `prev` in `E1`): entry `E2` |
| 3 | on `r1`: `self = C`, lineage `A → B → C` | a rotation on `r1`; `E1`'s anchor head becomes `C`. `r2` against `E1`: (a) fails (`A` ≠ `C`, `r2` carries nothing), (b) fails: no merge, two entries |

| State | Arrives | Result |
|---|---|---|
| `r1` and `r2` merged in `E`; `r2` received `A → B`; `r1` still holds `A` | relationship `r3`: `self = A`, empty lineage | `E`'s anchor head is `B`, and `A` is a `prev` in `E` (held by `r2`): no merge, although `r1` holds `A` as its own anchor head |
| the same | then on `r3`: `self = B`, lineage `A → B` | (a) and (b) hold: `r3` merges into `E` |

| State | Arrives | Result |
|---|---|---|
| entry `E1`: `r1` with `self = A`, holding the binding of `A` that `B` meets | relationship `r2` (a copy of `A`): `self = A`, empty lineage, `card.commit` a binding that `X ≠ B` meets | (a) and (b) hold, the binding rule fails: entry `E2`; both entries have the anchor head `A`, which the contact's star carries once (5050) |
| the same | then on `r2`: `self = X`, lineage `A → X` | a rotation on `r2`, meeting the binding `r2` holds; `E2`'s anchor head becomes `X`. `r2` against `E1`: (b) fails (`A` is a `prev` in `E2`), and so does the binding rule: no merge |
| the same | then on `r1`: `self = B`, lineage `A → B` | a rotation on `r1`; `E1`'s anchor head becomes `B`. `E1` and `E2` each hold one successor of `A`, and no entry holds two |

*Rationale.* The tables are the vector-testable anchors of the merge
logic: a copy of a superseded anchor stays apart from the current
person through a later rotation, a relationship that lags behind its
own entry is admitted only once it presents the current anchor head,
and a copy under a binding of its own stays apart in every order.

#### Rung 3: the manual fallback

**RLTP-TRU-6640** — The holder MAY merge relationships locally by
the admission-layer merge of Section 2 where at most one of them
holds an entry, the merged identity following 2180 where none does;
relationships of two different entries merge only by the net (rung
2).

**RLTP-TRU-6650** — An implementation MUST support rung 1 and rung 2;
rung 3 is a UI concern.

*Rationale.* Both automatic paths must exist for recognition to be
total. The manual fallback covers what neither reaches, and contact
memory is local anyway: a contact that came through an introduction,
for which no probe runs (6510); a re-encounter whose continuity flow
never completed (6870); relationships on which no anchor mapping
travels, so that the net has nothing to compare. A relationship
without an entry carries no community anchor, so joining it to an
entry or to other such relationships contradicts nothing the holder
verified. Two entries each hold an anchor head and are merged by the
net wherever their anchors connect them under the head rule and the
binding rule; where they do not, nothing shows that the two anchors
are one person's, and a merge would leave one entry with two anchor
heads, neither of which its star could blind as the person's. A
relationship merged by hand whose first mapping then names an anchor
the entry does not hold, or another binding for one it holds, leaves
the entry by the split (2080).

### 6a.2 continuity-probe@1: sequenced, chunked, padded, blinded

*In plain terms.* After the ceremony each side sends a list of
scrambled values, one per relationship it has, filled up with random
values to a fixed size and sorted. Only a counterpart that shares one
of those relationships can find a match; anyone else sees noise of a
fixed size. A resent probe is made fresh, so nobody can tell it is a
resend.

**RLTP-TRU-6660** — Both parties SHOULD send a continuity probe after
enactment completion.

*Rationale.* Matching needs only one probe to arrive (6a.4,
termination); a probe from each side makes the loss of either one
harmless.

**RLTP-TRU-6670** — A continuity probe MUST have exactly this body,
with the proof `mac` under `k_p`:

```
{ "type": "continuity-probe@1",
  "probe": <int-string>,
  "seq": <int-string>,
  "last": <boolean>,
  "blinded": [ exactly 256 entries ] }
```

**RLTP-TRU-6680** — `probe` MUST be the probe sequence of this tuple
direction, starting at 1, strictly increasing, and persisted
atomically before send.

**RLTP-TRU-6690** — The recipient MUST persist, atomically and per
tuple, the highest **completed** probe.

**RLTP-TRU-6700** — The recipient MUST reject any delivery whose
`probe` is not strictly greater than the highest completed probe.

**RLTP-TRU-6710** — A resend MUST be a fresh `probe` sequence with
freshly sampled padding, never a reproduction of old chunks.

*Rationale.* `probe` is the exact analogue of the star's `salt`, on
both sides. A fixed chunk size quantizes the cardinality of the entry
set. Persisting the highest completed probe atomically and rejecting
anything not strictly greater stops the replay of an older probe.
Reproduced chunks or padding would let a watcher link a resend to its
original.

**RLTP-TRU-6720** — The probe key MUST be derived as

```
k_p = HKDF(X25519(newPairX_sender, newPairX_recipient),
           "rltp/visibility/blind/probe/" || senderNewPair || "/" || recipientNewPair)
```

**RLTP-TRU-6730** — The entries MUST be `HMAC(k_p, ownPriorPairAnchor
bytes)` for the sender's **own** pair anchors of its prior-candidate
set (Section 2), the active heads of its relationships when the
fresh tuple was created, and from nowhere else.

**RLTP-TRU-6740** — The fresh tuple MUST NOT contribute an entry.

**RLTP-TRU-6750** — Deactivated links MUST NOT be probed.

*Rationale.* `k_p` binds the probe to this fresh tuple, so a probe
replayed into another tuple fails. Blinding the sender's own anchors
under that key means a stranger cannot test candidate anchors: only a
counterpart that shares the history computes a match. A self-entry
would make every probe match trivially against its own enactment.
Deactivated links are reachable through their chain's active head;
probing them as well would widen the exposure window.

**RLTP-TRU-6760** — The sender MUST pad the full entry set with random
32-byte values encoded like MACs up to the next multiple of 256, sort
the padded union lexicographically once, and slice it into 256-entry
chunks in order (`seq` 1…n, exactly one `last`), resampling any
padding value that collides with any other value.

**RLTP-TRU-6770** — Pure-padding chunks beyond the minimal number of
chunks MUST NOT be sent.

**RLTP-TRU-6780** — A sender with an empty prior-candidate set MUST
still send one all-padding probe.

**RLTP-TRU-6790** — Chunk assembly per (tuple, probe) MUST follow the
5.2a rules with `probe` in the salt role: byte-identical repeats are
ignored, conflicts reject, one assembly is open per tuple, and a
higher `probe` discards an open older assembly.

*Rationale.* Global padding and a single sort hide both the
cardinality and the order of the entries. Extra pure-padding chunks
would be a covert channel and waste. Without the all-padding probe,
the absence of a probe would leak the cardinality "zero". A padding
collision is cryptographically negligible; resampling keeps the union
free of duplicates. One assembly discipline serves the whole family of
star and probe.

**RLTP-TRU-6800** — The recipient MUST compute `HMAC(k_p,
counterpartAnchor)` for each counterpart anchor of **its own**
prior-candidate set of this fresh tuple and intersect the results
with the assembled union, matches identifying shared prior
relationships and zero matches identifying a new contact.

*Rationale.* Recognition comes from shared history alone. Cardinality
is quantized to the minimal chunk count toward a matched counterpart
and hidden entirely from strangers.

### 6a.3 Carrier, the offline path, and the resend duties

*In plain terms.* The probe and the continuity mapping travel the same
way as the ceremony's own messages. Where the ceremony happened
offline, they wait until a delivery service is reachable, and until
then the new relationship stands alone. Whatever was not answered is
sent again at the next chance, until both sides agree.

**RLTP-TRU-6810** — The continuity probe and the continuity mapping
MUST travel as sealed deliveries on the same channel as the enactment
bundle, as the tasks `continuity-probe/0.1` and
`continuity-mapping/0.1` registered in the Delivery Contract's task
registry (Delivery §4.4).

**RLTP-TRU-6820** — On the optical enactment path, where no delivery
service is available, the probe is **pending**, and until it runs the
tuple MUST be treated as an unchained relationship.

*Rationale.* Probe and mapping carry the same binding as the
enactment when they share its channel. Without a delivery service
nothing can be probed yet, and an unchained relationship is the honest
state of the tuple until the probe runs.

The following duties are standing; each is discharged on the next
available delivery contact of the tuple, by completed delivery.

**RLTP-TRU-6830** — On the next available delivery contact of the
tuple, a party MUST send each pending probe and retry each unanswered
probe, both with a fresh sequence.

**RLTP-TRU-6840** — On the next available delivery contact of the
tuple, a party MUST resend, with the same revision, every continuity
mapping not yet answered by the counterpart's aligned mapping.

**RLTP-TRU-6850** — On verifying the record side's mapping on a fresh
tuple, the non-record side's match-report resend duty for that tuple
MUST end, keyed on the tuple and never on a literal scope comparison,
and the alignment duty of 6a.4 arises in its place, standing until the
aligned mapping's delivery completes.

**RLTP-TRU-6860** — A match report flushed after the choice MUST NOT
be sent.

*Rationale.* The duties guarantee progress in both loss directions.
The same revision makes a mapping resend idempotent (6.4). The tuple
is the key of the discharge: per fresh tuple each sender has exactly
one (next, to), and the two senders' scopes mirror each other, so a
comparison of scopes would never match. From the record side's
mapping on, a match report would be a stale counter-claim competing
with the record side's choice. Verification creates the alignment
duty and delivery ends it, so a failed alignment production leaves the
duty standing.

**RLTP-TRU-6870** — A one-sided chain is a legal transitional state
and MUST NOT become terminal while contact exists and the issuing
scopes can issue (exhaustion suspends, 2.1).

Without further contact, two honestly unchained relationships remain,
which is the truthful description of that situation.

*Rationale.* The standing duties keep continuity live: as long as the
two parties can still reach each other, a half-finished chaining is
completed.

### 6a.4 continuity-mapping@1: one chooser, one trigger

*In plain terms.* When the probe finds a match, one side, fixed in
advance by comparing the two new anchors, chooses which old
relationship the new one continues, and its choice is final. The other
side follows that choice and confirms it. Only someone who holds the
keys of both the old and the new relationship can make this message.
Where you had given your anchor mapping on the old and the new pair
under different keys, you send it once more on the new pair, with the
chain that joins them.

**RLTP-TRU-6880** — A continuity mapping MUST have exactly this body,
with `mac1` under the **prior** relationship key
(`HKDF(ECDH(priorPairX_sender, priorPairX_addressee),
"rltp/visibility/mac/cont1")`) and `mac2` under the **new**
relationship key (`…/cont2`):

```
{ "type": "continuity-mapping@1",
  "prior": <own prior pair anchor>,
  "next": <own new pair anchor>,
  "to": <counterpart's new pair anchor>,
  "revision": <int-string>,
  "issuedAt": <timestamp> }
```

*Rationale.* Only the controller of both relationship keys can link
the two relationships.

**The machine: one chooser, one final choice, one trigger.** The
record side of a fresh tuple (Section 2) is deterministic and known to
both parties the moment the tuple exists. It chooses freely among its
matches; the app may prefer the chain with the richer history.

**RLTP-TRU-6890** — The record side's first verified continuity
mapping for a given (next, to) MUST freeze as its choice forever, a
differing later `prior` from the record side being an equivocation
error whatever its revision (6.4).

**RLTP-TRU-6900** — Chaining MUST be triggered only as follows, and
this rule is the protocol's only chaining trigger (6.4 refers here):
the record side chains atomically with issuing its choice, and the
non-record side chains only on verifying the record side's mapping.

A mapping received *from* the non-record side is a **match report**:
it tells the record side "I recognize these prior relationships".

**RLTP-TRU-6910** — A match report MAY inform the record side's
choice.

**RLTP-TRU-6920** — A match report MUST NOT cause chaining on any
side.

**RLTP-TRU-6930** — On verifying the record side's mapping, the
non-record side MUST send its own mapping naming its prior anchor on
the record-chosen relationship, with a higher revision where an
unaligned match report exists.

The re-issue changes the non-record side's outbound claim, never its
local graph, which follows the record side's mapping.

*Rationale.* The record side never needs to re-align, so its choice
can freeze; choice-flapping is structurally invalid. With one chooser
and one trigger, no side chains unilaterally: two choosers would fork
the chain. A match report lets the record side match whichever probe
was lost. The alignment duty makes both sides end on the same
relationship.

**Verification.**

**RLTP-TRU-6940** — The receiver MUST verify a continuity mapping by
steps 1 to 6 in order, without requiring a prior own probe match,
step 1 being a valid envelope and schema with an implemented `type`
(2.1).

**RLTP-TRU-6950** — Steps 2 and 3, tuple: `to` MUST equal the own new
pair anchor of the fresh tuple the mapping arrived on, and `next` the
counterpart's new pair anchor of that tuple.

**RLTP-TRU-6960** — Step 4, prior: `prior` MUST be a member of the
receiver's **prior-candidate set** of this fresh tuple (Section 2), a
counterpart pair anchor of an active head of one of its relationships
when the fresh tuple was created, and never an anchor of the fresh
tuple itself or a deeper chain position (6.4 exception (a)).

**RLTP-TRU-6970** — Step 5, keys: both ECDH outputs MUST be non-zero,
with `mac1` verifying under the prior relationship key and `mac2`
under the new one; step 6 applies the revision rule of 6.4, the
record freeze included.

*Rationale.* Not requiring an own probe match is what keeps both loss
directions terminating. Binding `to` and `next` to the arrival tuple
stops replay into another tuple. Holding `prior` is the evidence, no
probe match required; a deeper chain position would widen the theft
window. The snapshot keeps the alignment flow valid: both sides
evaluate against the active heads as they stood at enactment, so a
tuple deactivated by this very chaining remains a valid `prior` for
this tuple. Only the same key controller can compute both MACs. A
stolen, still-active old device is a key controller: Identity §11
grades takeover resistance under operational key possession as *none*,
and succession, not this artifact, is the remedy.

The addressee can forge the whole artifact (class V, deniable); third
parties cannot verify it. On verification of a record-side mapping
the receiver chains per 6.4 (RLTP-TRU-6900), and the alignment duty
arises (RLTP-TRU-6850): verification creates the duty, delivery ends
it.

**RLTP-TRU-6980** — After a verified match, a party whose anchor
mapping class is on toward the counterpart MAY issue its
`anchor-mapping@4` on the new tuple without a fresh user decision,
unless the relationship lags (6595).

**RLTP-TRU-6985** — After a chaining at which the sender had issued
its anchor mapping both on the chain and on the appended tuple, under
different community anchors, a sender whose anchor mapping class is on
toward the counterpart MUST re-issue `anchor-mapping@4` on the new
active head, unless the relationship lags (6595), with a higher
revision, carrying the lineage segment 6420 allows from the earliest
generation of 2285, the one the counterpart held on the chain.

The counterpart merges the two entries the chaining left apart once
that segment connects their anchor heads (2145). Where the
relationship lags, the mapping that 2850 sends once it presents the
anchor head carries the same segment.

*Rationale.* The addressee already holds the community anchor; the
issue on the new tuple is re-delivery to the same holder and
discloses nothing new. While the class is off, 6410 forbids it: a
re-encounter does not undo a withdrawal. A mapping issued on a fresh
tuple before the chaining carries no lineage, since nothing earlier
was issued on that tuple (6420); where the chain held an earlier
generation, the counterpart then holds two anchors of the sender that
nothing it holds connects, and keeps two entries for the sender
(2145). After the chaining, the earliest generation of the chain is
the relationship's (2285), so the segment from it is the lineage 6420
allows, and it is the one thing that shows the counterpart the two
anchors are one chain. The profile follows the active head of the
relationship by its own rule (6b).

**Termination.**

**RLTP-TRU-6990** — Every continuity flow MUST end with both sides
chained to the record-chosen relationship, or honestly unchained
pending transport.

*Rationale.* Matching requires only that some probe arrived: the
record side can match against the non-record side's probe, or its
match report, and choose, whichever probe was lost. The duties of
6a.3 guarantee progress in both loss directions. With one chooser, one
final choice, and one trigger, no other end state exists.

### 6a.5 What this buys (informative)

The probe is the third member of one family: star, mapping and probe
are all blinded values under relationship keys. In the interface, a
re-encounter shows "re-verified" a round-trip after the scan, with no
dialog; a data-loss counterpart cannot answer and is honestly a new
relationship; a wrong scanner learns nothing.

## 6b. profile@1 (normative)

*In plain terms.* The profile is your name, and if you like a picture
and a short text, sent to the contacts you trust. It is one profile,
the same for everyone who gets it. It travels inside one relationship
and carries a check value made with that relationship's key, so the
contact can check that it came from you, but cannot prove that to
anyone else. It is never signed, and it names no one but you. The
picture is re-encoded before it leaves, so it carries pixels and
nothing else: no place, no time, no camera in its file. What the
picture itself shows, it still shows. When you change it, every
contact it is on for gets the new version, which replaces the older
one; where you share several channels with one contact, the one with
the highest version number is shown. When you stop sending it, the
contact keeps what it already saw.

A profile is the artifact of the trust class "profile" (2a): the
sender's own name, an optional image and an optional text, sent by
default to trusted contacts (2760) and settable per contact (2780).
It is class S (Section 3): a statement about the sender itself,
directed at one addressee, deniable, never presentable. This version
knows one profile per sender, sent alike to every recipient of the
class; different profiles per recipient and selective fields are not
defined.

### 6b.1 Body and proof

*In plain terms.* A profile holds a name, and optionally a picture and
a short text, all with fixed maximum sizes. It carries a check value
made with the relationship's key in one direction, so it cannot be
moved to another relationship or turned around. The picture is made
anew from its pixels before sending, so nothing from the original file
travels with it.

Body: `{ "type": "profile@1", "revision": <int-string>, "name":
<string>, "image"?: <data URI>, "text"?: <string> }`. Proof: `mac`
under `k_pr`.

| Property | Type | Card. | Content |
|---|---|---|---|
| `type` | string | 1 | `profile@1` |
| `revision` | int-string (2.1) | 1 | ≥ 1, per 6450 |
| `name` | string | 1 | at most 64 characters (6435) |
| `image` | data URI | 0..1 | `data:image/jpeg;base64,…` or `data:image/webp;base64,…`, one still picture, at most 60 000 characters and 1024 × 1024 pixels (6435, 6475), re-encoded (6445) |
| `text` | string | 0..1 | at most 256 characters (6435) |

**RLTP-TRU-6430** — A `profile@1` MUST consist of a body with exactly
the members of the table above and a proof with exactly `mac`.

**RLTP-TRU-6435** — `name` MUST be at most 64 characters, `text` at
most 256 characters, and `image`, where present, a base64 data URI of
media type `image/jpeg` or `image/webp` of at most 60 000 characters
whose picture is at most 1024 × 1024 pixels.

**RLTP-TRU-6440** — The `mac` of a `profile@1` MUST be the MAC of 2.1
over the canonical bytes under the directional key `k_pr =
HKDF(ikm = X25519(pairX_sender, pairX_recipient), info =
"rltp/visibility/mac/profile/" || senderPairAnchor || "/" ||
recipientPairAnchor)`, with both anchors as anchor bytes (2.1).

**RLTP-TRU-6445** — A sender MUST produce `image` by re-encoding the
picture's pixels into a new file of an admitted media type, carrying
no metadata of its source, such as EXIF or XMP data, embedded
thumbnails or bytes after the image data.

*Rationale.* A closed body with bounded members keeps the artifact
testable and leaves no room for a field that would carry something
other than the sender's own presentation; the name and text maxima
are those of the introduction request's `profile` (8.2), and the
image maximum keeps the whole profile inside one Delivery document
(6480). The pixel bound keeps the decoded picture small, since a few
compressed bytes can declare a picture whose decoding exhausts the
recipient's memory. A picture taken by a phone carries, beside the
pixels, where and when it was taken and which device took it; only
re-encoding the pixels leaves all of that behind, whatever container
fields the source used. The key is the relationship key, so the
profile convinces its addressee and no one further; binding both pair
anchors in sender order gives each direction its own key, so a
profile cannot be replayed from one direction into the other or into
another relationship.

### 6b.2 Revision, delivery, and reception

*In plain terms.* Every change of your profile gets a higher number,
from one counter for all your contacts, and goes to every relationship
of every contact it is on for, except a relationship that still shows
a key that contact has moved on from. A contact keeps only the newest
profile per relationship, and where it has several relationships with
you, shows the one with the highest number, leaving out a relationship
that still shows a key you have moved on from. After a re-encounter,
the profile is sent again on the new pair.

**RLTP-TRU-6450** — Within the scope (`senderPairAnchor`,
`recipientPairAnchor`), `profile@1` MUST follow the generic revision
rule (6270) and the atomic, monotone allocation (6300, 6310) of 6.4,
the sender drawing its profile revisions from one monotone counter
across all its profile scopes, each new content taking the counter's
next value, under which it is issued in every scope.

**RLTP-TRU-6455** — The sender MUST deliver each new revision of its
profile, and its current profile whenever the profile class turns on
toward a contact or one of its relationships (2850), on every live
relationship of every contact toward which the class is on (2210,
2820) that does not lag (6595), each as a `profile@1` under that
relationship's key and revision scope.

The profile travels by Delivery like every document (6495), whose
retries carry it (Delivery §4.2). It has no reconciliation view and
no delivery duty on divergence: it is not reconciled like the star,
and a revision whose delivery fails for good stays undelivered until
the next one.

**RLTP-TRU-6460** — A recipient MUST hold, per relationship tuple,
only the newest `profile@1` revision whose `mac` verified under
`k_pr`, replacing the one it held before.

**RLTP-TRU-6461** — A recipient MUST NOT show the profile of a tuple
once that tuple is no longer an active head.

A profile is state of its tuple (6180) and does not migrate to a new
active head (6250); a profile addressed to a pair anchor that is not
an active head is rejected (6190).

**RLTP-TRU-6425** — A recipient MUST show for a contact, among the
profiles it holds on the active heads of the relationships of that
contact that do not lag (6460, 6461, 6595), the one with the highest
revision, and among equal revisions the one it verified last, the
relationships of one merged member counting as one contact (2820).

Revisions of different relationships count in separate scopes
(6280), drawn from the sender's one counter (6450), so the highest
revision among them is the sender's newest content; comparing them
here only chooses which held profile is shown and replaces nothing,
so each relationship keeps its own newest revision (6460) and the
rollback within a scope stays closed. The profiles a sender serves on
several strands carry one content, the one profile of the sender.

**RLTP-TRU-6465** — After a chaining (6a.4) of a relationship toward
whose contact the profile class is on, the sender SHOULD send its
current profile on the new active head, as a `profile@1` of the new
tuple's revision scope, without a fresh user decision.

*Rationale.* Without the revision rule, an attacker on the transport
path, or the sender's own stale device, could roll the recipient back
to an old name or picture, and two different profiles under one
revision would leave the recipient with two truths. A profile the
sender changed and did not deliver would leave every contact with a
name or picture the sender no longer shows; delivery on change, not
reconciliation, is enough, because the profile is one document that
replaces itself. A merged member keeps one active head per strand
(2210, 9.5); a profile served on one strand only would leave the
others without it, and the redundancy toward one person is correct and
convergent. Holding only the newest revision per tuple gives the
recipient one current profile per relationship; keeping the history
would widen what a recipient holds about the sender beyond what the
sender currently shows. Reception order across relationships would let
a revision that is older but still the newest of its own strand,
delayed on the transport, displace a newer profile shown from another
strand: a rollback by delivery order. The highest revision is an order
the sender itself gave, which a delay can hold back but not reverse
within any one strand; drawn from one counter, it is the sender's
order across strands as well, so a strand that a change has not yet
reached cannot keep the older content shown by a higher count of its
own. A profile held on a deactivated tuple can no longer be replaced,
since its scope accepts nothing further (6240); counting it would let
a dead strand decide for good what is shown. A relationship that lags
may be one that merged under a copied key before the sender's rotation
reached the recipient (6595, Section 10); counting it would let a
profile from whoever holds that key, at any revision, speak for the
sender. The re-send after a chaining is re-delivery to the same
holder, which already saw the profile on the old active head (6980);
without it the relationship's new active head stays without a profile
until the sender's next change.

### 6b.3 One unsigned document, about oneself, pixels only

*In plain terms.* A profile is never signed, so it proves nothing to
anyone but its addressee. A picture that claims to be larger than the
limit, has several frames, or is not what it says it is, is rejected
before it is decoded. A profile fits one delivery, names nobody else,
and its receipt is confirmed in a way that proves nothing to a third
party.

**RLTP-TRU-6470** — A profile MUST NOT be signed.

**RLTP-TRU-6475** — A recipient MUST reject a profile whose `image`
is not a single still picture of the media type its data URI
declares, or whose dimensions, read from that picture's own header
before any allocation for its pixels, cannot be read or exceed
1024 × 1024 pixels, every dimension the header states counting: for
a WebP picture in the extended (VP8X) container, both its canvas and
its frame.

**RLTP-TRU-6480** — A profile MUST travel as one unchunked Delivery
document within the 65 536-byte plaintext limit of Delivery §5.

**RLTP-TRU-6485** — A recipient MUST use only the pixels of `image`,
ignoring any metadata embedded in it.

**RLTP-TRU-6490** — A `profile@1` MUST NOT carry any anchor or any
statement about a third party.

**RLTP-TRU-6495** — A profile MUST travel as the registered task
`profile/0.1` (Delivery §4.4), acknowledged deniably by a MAC-proved
`delivery-ack` under the channel-keyed ack regime of Delivery §4.2.

*Rationale.* A signature would turn the profile into a transferable
proof that this name and this picture belong to this pair anchor, the
proof 5.3 refuses the star for the same reason. A recipient that
decoded first and checked afterwards would already have spent the
memory the bound protects, and the bound protects it only where the
decoder decodes what the checked header describes: a second frame, an
animation, a header other than the one the decoder later trusts, a
container that states a small canvas and a large frame, or data of
another type than declared would each let the decoder allocate past
the bound. Delivery rejects an oversize envelope without decryption
(`failed(oversize)`); a profile that did not fit would be lost, not
delayed, and the maxima of 6435 leave the Delivery frame room inside
the limit, so no chunking is needed. Metadata a sender failed to strip
must not reach the recipient's display or storage as data about the
sender's place, time or device. A profile that named an anchor or a
third party would transport what 1030 keeps out of every artifact of
this specification; a profile is a statement about oneself only. A
signed acknowledgement would make the receipt of a profile provable
where the profile itself is not (5650).

Properties, with their honest limits:

- **Deniable.** A MAC under a shared key: the recipient could have
  computed it itself. This covers the document, not the name: the
  same name can stand signed on the sender's contact card (Section 3,
  Section 11).
- **No recall.** What a recipient saw, it keeps; the MAC prevents
  passing the profile on as proof, not passing on the picture.
  Turning the class off stops distribution (2790).
- **No anchor.** A profile received without the anchor mapping (6, 2a)
  names a person behind a pair anchor; the recipient cannot attach it
  to a community anchor and so not to any star hit. Its content is
  still the same on every relationship it is sent on, and links them
  for whoever holds two of them (Section 11).

## 7. Relational counts (normative principle, artifact unwritten)

*In plain terms.* Anyone can create as many identities as they like,
and those identities can vouch for each other without end. So a claim
like "many people know me" counts only when it says how many of them
the person checking already trusts. A single score for everyone is
not part of this protocol. The artifact that would carry such a
counted claim does not exist yet; until it does, the rule binds the
layers that will use it.

Anchors are free; a Sybil swarm issues itself arbitrary
self-evidence. The scarce resource is the **boundary edge** into the
honest graph, and the blinded star supplies the verifier-side test
instrument. The proof artifact is unwritten: it needs the substrate
of 9.2.

**RLTP-TRU-7010** — A count or personhood statement MUST be anchored
relationally ("≥ N, of which k inside the verifier's trust horizon"),
never absolutely.

**RLTP-TRU-7020** — A consuming layer MUST NOT accept a global
per-everyone score as a count or personhood statement.

**RLTP-TRU-7030** — Until a proof artifact for relational counts is
specified, 7010 binds consuming layers as a design constraint, and
conformance to it MUST be assessed as state-dependent (Section 12).

*Rationale.* An absolute count is satisfied by any swarm of free
anchors; a relational count is bounded by the edges into the
verifier's own horizon, which a swarm cannot issue itself. A global
per-everyone score is either forgeable, when anyone may compute it,
or central, when only one party may; both contradict the protocol.
Without an artifact there is nothing a vector can test, so the
requirement is stated as a constraint and assessed against state.

## 8. The Introduction Act

*In plain terms.* A person can ask a contact, the mediator, to
introduce them to one of the mediator's contacts, the target. The
requester sends a fresh card through the mediator; the target looks at
it and decides alone. If the target agrees, it sends its own fresh
card back the same way. The mediator passes messages along but never
hands anyone a standing anchor, and no message names an existing
relationship. The mediator confirms receipt after a fixed delay,
whatever happens next, so the requester cannot tell whether the target
exists, is unreachable, or said no. At the end the mediator tells each
side which fresh anchor belongs to the other. A relationship made this
way is marked as introduced until the two meet in an encounter.

**RLTP-TRU-8010** — A mediator MUST NOT forward any standing anchor in
an introduction act; the act's fresh pair anchors are issued by their
own owners for the new relationship.

*Rationale.* Forwarding a third party's standing anchor is exactly
what the issuer rule (1010) forbids: the issuer decides per recipient,
and no holder forwards on its behalf. An introduction is issuance, not
forwarding.

### 8.1 Precondition, carrier, pins, and the per-role lifecycle

*In plain terms.* An introduction runs only through a mediator who is
already a contact of both sides. Each act has a random identifier and
a fixed lifetime; anything outside that window is rejected from its
own bytes, and repeats are recognized by their exact content. Each
party keeps the keys of the channel the act started on, and each runs
its own steps: there is no shared state, so the parties can end in
different states, which a new attempt resolves.

**RLTP-TRU-8020** — An introduction act MUST run only where the
requester and the mediator, and the target and the mediator, each
already share a pair relationship.

**RLTP-TRU-8030** — An act body MUST NOT contain any relationship
anchor; each leg rides its delivery channel, and that channel's
transport tuple is the binding.

*Rationale.* The mediator is a contact of both sides; there are no
cold introductions. The transport tuple is known to both ends of its
channel and shown to no one else, whereas a relationship anchor in a
body would hand it to the other side of the act.

The act travels in five sealed Delivery tasks. Their payload schemas
are `schemas/visibility-payload-*.schema.json`, enumerated in the
References.

| Task | Direction | Payload |
|---|---|---|
| `introduction-request` | requester → mediator | `{ introduction, card }` |
| `introduction-forward` | mediator → target | the byte-identical `introduction` and `card` of the request |
| `introduction-reply` | target → mediator → requester | `{ introduction, card }`, forwarded unchanged |
| `introduction-ack` | mediator → requester | `introduction-ack@1` (8.4) |
| `introduction-voucher` | mediator → each side | `{ voucher }`, that side's voucher (8.5) |

All five task names, together with the continuity tasks of 6a.3, are
registered in the Delivery Contract's task registry (its 4.4), with
their payload schemas and the one-carrier proof rule stated there.

**RLTP-TRU-8040** — The mediator MUST accept an
`introduction-request`, carried as `{ introduction, card }`, only
where `cardDigest` equals the 2.1 digest of the accompanying card
document.

**RLTP-TRU-8050** — The target MUST consent to an introduction only
after verifying, on the `introduction-forward` it received, the
request signature under the card's anchor, `cardDigest`, the card
itself under Encounter's DI rules (`rltp-card/0.25`), and, over its
own channel to the mediator, that `target` designates itself.

**RLTP-TRU-8060** — An `introduction-reply` MUST travel as `{
introduction, card }` under the digest rule of 8040, from the target
to the mediator and unchanged from the mediator to the requester.

Consent is the target's local act. The acceptance lists of the
mediator and the requester for a reply are in 8.2.

*Rationale.* A card swapped between request and card document would
let a party substitute its own anchor for the requester's; the digest
inside the signed body pins the one card. The target must know that
the request is genuine and meant for it before it reveals anything,
and the return direction carries the same binding.

#### Act identity

**RLTP-TRU-8070** — An act MUST be identified by its act id alone,
32 fresh random bytes minted by the requester per act.

**RLTP-TRU-8080** — A requester MUST NOT reuse an act id.

**RLTP-TRU-8090** — An implementation MUST treat `issuedAt`, taken
from the act's request, as the act's lifetime datum and never as a
component of the act's identity.

**RLTP-TRU-8100** — An implementation MUST NOT hold two acts under one
act id: within the retention window, a request carrying a held act id
with different canonical bytes is an equivocation and is rejected
(8240).

*Rationale.* A composite identity is one that two parties could
compute differently, and an identity built on a clock would depend on
clocks. 256-bit randomness makes collision negligible, so deliberate
reuse is nonconformance: a reused id would merge two acts' state at
mediator and target. A requester that sends two different requests
under one id is equivocating.

#### The acceptance window

**RLTP-TRU-8110** — At its arrival of any act artifact, every role
MUST reject the artifact unless both bounds of 8120 and 8130 hold,
evaluated per 2.1's truncation rule with the fixed profile parameters
`act-expiry = PT72H` and `act-skew = PT5M`, both bounds inclusive.

**RLTP-TRU-8120** — Future bound: a role MUST reject an act artifact
unless `issuedAt ≤ now + act-skew`.

**RLTP-TRU-8130** — Absolute lifetime: a role MUST NOT produce or
accept any artifact of an act unless `now ≤ issuedAt + act-expiry +
act-skew`.

Every tolerance widens acceptance.

*Rationale.* The window is stateless replay protection: an artifact
outside it is rejected from its own bytes. A future-dated `issuedAt`
cannot start an act's lifetime later than its arrival, and the
absolute lifetime bounds the state every role must keep.

#### Boundary serialization

**RLTP-TRU-8140** — Per act, a role MUST process artifacts arriving at
a given instant before any time-driven transition of that same
instant, and fire every time-driven transition (the requester's
`failed`, any `expired`, the pending-voucher discard of 8.5) at the
first whole second strictly after its bound.

*Rationale.* 2.1's truncation makes instants whole seconds.
Acceptance bounds are inclusive and expiry is strictly after, so a
boundary-second arrival always wins against a same-second expiry and
no same-second race exists.

#### The mediator's processing cutoffs

**RLTP-TRU-8150** — A production bound MUST NOT include a tolerance;
tolerances belong to acceptance only.

**RLTP-TRU-8160** — The mediator MUST NOT move a request into
`received` unless `now + ack-delay ≤ issuedAt + act-expiry` (2.1
comparison).

**RLTP-TRU-8170** — The mediator MUST NOT accept a reply unless
`now ≤ issuedAt + act-expiry` at reply arrival.

**RLTP-TRU-8180** — The mediator MUST handle a late arrival without
any artifact: a request after the cutoff of 8160 is rejected without
ack at step 2 of the mediator checks, like a window failure, and a
reply after the cutoff of 8170 is dropped silently while the act runs
into `expired`.

`ack-delay` is the mediator's own declared constant (8.4), so the
check of 8160 is stateless from the request bytes. Forward and
vouchers follow a reply immediately; there is no declared delay to
reserve for them.

*Rationale.* A production made inside a tolerance could be rejected
by its receiver. Without the request cutoff, the ack duty could become
unsatisfiable inside the lifetime; without the reply cutoff, forward
and vouchers could. The cutoffs keep every production duty and the
production bound from ever being unsatisfiable at the same time, and
give late arrivals a defined outcome.

#### Duplicate detection and retention

**RLTP-TRU-8190** — A role MUST decide the acceptance window from the
artifact's own bytes and its own clock alone, without act state.

**RLTP-TRU-8200** — Within the window, each role MUST retain per held
act, until the absolute lifetime, the canonical bytes of every act
artifact and payload it produced or accepted, the accompanying card
documents at least as their verified card anchors, the pin identities
and, at the requester, any pending voucher (8.5).

The retained artifacts are the request, the reply, the ack value
(8.4) and sent vouchers; payloads with a card are the request, the
forward and the reply. A forward is the byte-identical request payload
of `introduction` and `card`, not a body of its own. This state is
bounded per act and is discarded at the absolute lifetime (8310).

**RLTP-TRU-8210** — Two act artifacts MUST count as byte-identical
exactly when their canonical body bytes `JCS(body)` are equal.

Duplicates follow the idempotency pattern of 6.4, per role.

**RLTP-TRU-8220** — Before its ack production event (8.4), the
mediator MUST NOT reschedule, advance or duplicate that production on
a byte-identical duplicate of a held request; the one produced value
answers every arrival up to that point.

**RLTP-TRU-8230** — After its ack production event, the mediator MUST
answer a byte-identical duplicate of a held request by re-delivering
the retained ack value.

**RLTP-TRU-8240** — The mediator MUST reject, at any time, a request
whose act id is held and whose bytes differ from the held request.

**RLTP-TRU-8250** — The mediator MUST absorb a byte-identical repeated
reply into the single processing event before `completed`, ignore it
after `completed`, and reject a differing reply at any time.

**RLTP-TRU-8260** — The target on a repeated forward, the requester on
a repeated reply, and either side on a repeated voucher MUST ignore a
byte-identical repeat and reject a differing one.

*Rationale.* Because the window is decided from the bytes, duplicate
state is needed only inside the window, and it is bounded. The
retained state is exactly what the byte-equality decisions of this
section, the acceptance lists of 8.2, and the
`requesterPair`/`targetPair` matching of 8.5 consume after
acceptance. If a duplicate request could move the ack production, a
requester could shift the ack's timing and use it as an oracle. A
re-delivered ack is a retransmission, not a second ack (8660). Forward
and vouchers happen once. A differing artifact under a held act id is
an equivocation (8100).

#### Pins

**RLTP-TRU-8270** — Every act artifact MUST use the keys of the pinned
tuples: the requester pins its requester↔mediator tuple at send (its
active head then), the mediator pins the arrival tuple at arrival and
its mediator↔target tuple at forward, and the target pins at forward
arrival.

**RLTP-TRU-8280** — A role MUST NOT produce an act artifact after its
terminal state or after the absolute lifetime, whichever is first;
retransmitting an already-produced value is delivery, not production.

**RLTP-TRU-8290** — A role MUST verify the act's inbound artifacts
addressed to it under the pinned keys until the absolute lifetime,
also after its terminal state.

**RLTP-TRU-8300** — After the absolute lifetime, a role MUST reject act
artifacts under the pinned keys.

**RLTP-TRU-8310** — After the absolute lifetime, a role SHOULD discard
the act's state.

After a terminal state a role is accept-only: it produces nothing
further under the act, and the act's remaining inbound artifacts
addressed to it, notably the voucher (8.5), verify under the pinned
keys until the window closes.

*Rationale.* A chaining during the act (6.4) must not change which
keys the act uses. Nothing is produced after a role is done, yet late
vouchers must still verify. Rejecting after the lifetime stops replay
of stale acts; the window bound keeps that rejection possible even
after the state is discarded, so discarding is a storage bound only.

#### Per-role lifecycles

**RLTP-TRU-8320** — An implementation MUST NOT derive or rely on a
global act state; each role runs its own lifecycle.

**RLTP-TRU-8330** — The requester MUST move an act from `sent` to
`acked` on a verified ack and to `completed` on a reply accepted per
8.2 from either `sent` or `acked`, absorbing an ack that arrives after
completion.

**RLTP-TRU-8340** — The requester MUST move an act to `failed` in
`sent` without an accepted reply on the ack timeout of 8.4, to
`failed` in `acked` on the reply timeout `act-expiry`, and to
`expired` at the absolute lifetime.

**RLTP-TRU-8350** — The requester MUST ignore a late reply of a
`failed` act.

An absorbed ack is verified against the pinned tuple and then
discarded; it is neither a conformance failure nor a late ack of a
failed act. A retry after `failed` converges as a new act (8700).

**RLTP-TRU-8360** — The mediator MUST move an act from `received`
(channel and form checks passed, ack cutoff included, pin set, ack
duty bound) to `forwarded` (target resolved, forward sent) to
`completed`, entering `completed` only once the ack has been produced
(8.4), the reply has been forwarded and both vouchers have been sent
(8.5), in any order.

**RLTP-TRU-8370** — The mediator MUST move an act to `rejected` when
its form checks fail, artifact-free where the arrival channel was
inactive, and to `expired` at the absolute lifetime, including an act
whose target never resolved.

An act whose target never resolved stays in `received`, acked and
silent, until the window closes. A request on an inactive channel is
the one honest unacknowledged case: no ack key exists for it.

**RLTP-TRU-8380** — The target MUST move an act from `received` to
`consented` when it sends its reply, to `refused` locally and silently,
or to `expired`.

**RLTP-TRU-8390** — A terminal state MUST end a role's production
under the act and never its acceptance; a target in `consented` still
accepts its voucher within the window.

**RLTP-TRU-8400** — An implementation MUST NOT treat divergence
between roles, such as the mediator at `completed` and the requester
at `failed`, as nonconformance; the requester's retry as a new act
converges the outcome.

*Rationale.* A distributed act has no global state, and pretending
otherwise breaks under partition. Delivery guarantees no order between
ack and reply, so a reply may complete the act before any ack. A
failed act must not complete behind the requester's back. Gating the
mediator's `completed` on all three production duties keeps the
terminal rule and the ack schedule from conflicting when a fast reply
arrives before `t_received + ack-delay`. Refusal stays local so that
it is private. A transport adversary can always hold the mediator at
`completed` and the requester at `failed` (8.4); naming the divergence
is honest where a guarantee would be false.

#### Mediator checks

**RLTP-TRU-8410** — The mediator MUST run the checks of steps 1 to 4
on an arriving request in order, starting with step 1, channel: a
request that did not arrive on an active relationship channel with
the pin set is dropped artifact-free.

**RLTP-TRU-8420** — Step 2, form: the mediator MUST reject without ack
a request failing schema, digest, signature, or the acceptance window
including the ack cutoff (8160).

**RLTP-TRU-8430** — Step 3, ack duty: a request passing steps 1 and 2
MUST enter `received` with its ack duty bound (8.4), before and
independent of target resolution.

**RLTP-TRU-8440** — Step 4, resolution: the mediator MUST use target
resolution for forwarding only and silently, forwarding the
byte-identical payload on the active mediator↔target channel on
success and producing ack plus silence on failure (unknown
designator, unresolvable, no active mediator↔target channel).

A resolution failure is indistinguishable at the requester from a
refusing target.

*Rationale.* On an inactive channel no ack key exists. A malformed
body authenticates no act, and a request too late to ack is
window-expired for this mediator. Binding the ack duty before target
resolution removes the target-existence oracle: whether the mediator
has a given contact is not testable through this act.

### 8.2 Artifacts

*In plain terms.* The request names the target by an opaque handle,
carries a fingerprint of the requester's fresh card and a short name
and note, and is signed under the fresh card. The reply names the
request it answers and the target's fresh card, signed under that
card. Mediator and requester accept a reply only after a fixed list of
checks, the costly card check last.

**RLTP-TRU-8450** — An `introduction-request@1` body MUST be
`{ type, act: <32-byte random, u-base64url 43 chars>, issuedAt:
<timestamp>, target: <opaque designator, 8.3>, cardDigest: <2.1
digest of the card document>, profile: <closed object: displayName ≤
64, note ≤ 256> }`, with `proofValue` under the fresh card's anchor
(raw Ed25519, 2.1).

**RLTP-TRU-8460** — An `introduction-request@1` body MUST NOT name a
mediator anchor or any existing relationship.

The `profile` of the request is the introduction's own way to show a
name to a stranger before any relationship exists; it is not the
profile class of 6b, whose `name` and `text` carry the same limits.

**RLTP-TRU-8470** — An `introduction-reply@1` body MUST be `{ type,
act, requestDigest: <2.1 digest of the request body>, requesterPair:
<the card anchor of the act's request>, cardDigest: <2.1 digest of
the target's fresh card document> }`, signed under the target's fresh
card anchor.

*Rationale.* The request signature under the fresh card's anchor binds
the act to that card. The target must not learn the requester's
relationships, and the mediator's anchor would be one of them.
`requestDigest` binds a reply to exactly one request: splicing a reply
across requests breaks the signature.

#### Reply acceptance at the mediator

**RLTP-TRU-8480** — The mediator MUST accept a reply only after steps
1 to 7 pass in order, starting with step 1, envelope and schema valid
and `type` implemented (2.1), and step 2, arrival on the act's pinned
mediator↔target tuple (8270).

**RLTP-TRU-8490** — Step 3, state: the act MUST be held in
`forwarded`, with the acceptance window and the reply cutoff (8170)
holding.

**RLTP-TRU-8500** — Step 4, card binding: the reply signature MUST
verify under the anchor of the accompanying card document, whose 2.1
digest equals `cardDigest`.

**RLTP-TRU-8510** — Step 5, request binding: `requestDigest` MUST
equal the digest of the retained request bytes (8200).

**RLTP-TRU-8520** — Step 6, requester binding: `requesterPair` MUST
equal the card anchor of the act's request.

**RLTP-TRU-8530** — Step 7, card: the accompanying card MUST verify
under Encounter's own DI rules (`rltp-card/0.25`).

**RLTP-TRU-8540** — The mediator MUST NOT forward the reply payload or
produce the vouchers (8.5) before the reply has passed steps 1 to 7.

The forward is the byte-identical payload; a repeat is handled by the
duplicate rule of 8250. Positive card material is in
`vectors/encounter-cards.json`.

#### Reply acceptance at the requester

**RLTP-TRU-8550** — The requester MUST accept a reply only after steps
1 to 6 pass in order, starting with step 1, envelope and schema valid
and `type` implemented (2.1), and step 2, `act` naming a held act of
this requester with the acceptance window holding (8110).

**RLTP-TRU-8560** — Step 3, card binding: the reply signature MUST
verify under the anchor of the accompanying card document, whose 2.1
digest equals `cardDigest`.

**RLTP-TRU-8570** — Step 4, request binding: the requester MUST reject
a reply whose `requestDigest` differs from the digest of its retained
request bytes (8200).

**RLTP-TRU-8580** — Step 5, requester binding: `requesterPair` MUST
equal the card anchor of the act's own request.

**RLTP-TRU-8590** — Step 6, card: the accompanying card MUST verify
under Encounter's own DI rules (`rltp-card/0.25`).

**RLTP-TRU-8600** — An accepted reply MUST complete the act at the
requester, from `sent` or `acked` (8330), and trigger re-evaluation of
a pending voucher (8770).

*Rationale.* A reply over another channel is not from the target, and
a late or unsolicited reply answers no held act. The card binding
stops card substitution; the request and requester bindings stop
splicing, and a `requestDigest` mismatch means the reply answers some
other request. The card's DI verification is the expensive check and
runs last, after the cheap ones. Nothing leaves the mediator before
acceptance. Re-evaluating the pending voucher makes the outcome
independent of arrival order.

### 8.3 The target designator

*In plain terms.* The mediator names the target with a handle that
means nothing outside the mediator and is never built from an anchor,
so the requester learns nothing about the target from it.

**RLTP-TRU-8610** — The mediator MUST mint `target` as an opaque
`u`-base64url string of at most 343 characters (at most 256 payload
bytes) in its own namespace, stable per (mediator, target) at least
for the act's lifetime, resolvable by the mediator to a deliverable
party, and verifiable by the target, over its own channel to the
mediator, as designating itself before consenting.

**RLTP-TRU-8620** — The mediator MUST NOT build a target designator
from any anchor.

*Rationale.* The designator is an opaque handle without global
meaning. Built from an anchor, it would hand the target's anchor to
the requester before the target consented.

### 8.4 The acknowledgement

*In plain terms.* The mediator confirms every request exactly once, at
a fixed delay after it arrived, in the same way whether the target
exists, refuses or cannot be reached. Without that confirmation in
time, the requester counts the act as failed and tries again with a
new act.

**RLTP-TRU-8630** — An `introduction-ack@1` body MUST be `{ type, act
}` with no other member, proved by a `mac` under `k =
HKDF(ECDH(pairX_mediator, pairX_requester),
"rltp/visibility/mac/ack")` with the keys of the act's pinned
requester↔mediator tuple (8270).

**RLTP-TRU-8640** — The mediator MUST produce exactly one ack value per
act that reached `received`, in exactly one production event at
`t_received + ack-delay` on its own clock, where `t_received` is the
moment the act entered `received` and `ack-delay` is a fixed,
non-adaptive parameter published in the mediator's task registration
entry.

**RLTP-TRU-8650** — The mediator MUST produce the ack identically for
existing, refusing, unknown and unreachable targets, with the ack duty
bound before, and never depending on, target resolution (8430).

The production event follows its own schedule and may in time follow
a fast resolution; that is why the mediator's `completed` is gated on
it (8360).

**RLTP-TRU-8660** — A retransmission of the byte-identical ack value,
on delivery retry or on a duplicate request (8230), MUST count as the
same ack and never as a second one.

**RLTP-TRU-8670** — A mediator MUST NOT produce a second, differing ack
value or a malformed one for an act; either is a mediator conformance
failure.

**RLTP-TRU-8680** — The requester MUST verify an ack's MAC under the
pinned tuple and its act id, and absorb an ack of a completed act
(8330).

*Rationale.* No member of the ack can carry information about the
target. If the timing or the number of acks depended on the target,
the requester could learn whether the target exists, is reachable or
refused; one value at one fixed instant removes that oracle. Retries
must not count as answers, and two different acks could encode
information. A forged ack fails the MAC; a late ack of a completed act
is harmless.

#### The verdict rule

**RLTP-TRU-8690** — With no verified ack and no accepted reply by
`t_sent + ack-delay + act-skew` on its own clock, measured from its own
send (2.1 comparison, boundary serialization per 8140), the requester
MUST move the act to `failed`, terminally.

**RLTP-TRU-8700** — A retry MUST be a new act, with a fresh act id, a
fresh `issuedAt` and a fresh request.

**RLTP-TRU-8710** — The requester MUST ignore a late ack or a late
reply of a failed act.

**RLTP-TRU-8720** — A missing ack MUST count as a mediator conformance
failure only where the request demonstrably arrived on a channel
active at the mediator.

*Rationale.* The verdict is total and independent of the mediator's
state. Transport delay can fail the requester early; that is safe
under this rule, because both parties remain individually correct and
the retry converges them. A retried act id would be an equivocation
(8100). Transport loss is not the mediator's fault.

### 8.5 The voucher

*In plain terms.* At the end the mediator tells each side, over its
own channel, which fresh anchors belong to the act. A side accepts
this only for an act it holds and only where the anchors match what it
has; the order in which the messages arrive does not change the
result.

**RLTP-TRU-8730** — An `introduction-voucher@1` body MUST be
`{ type, act, requesterPair, targetPair }`, one artifact per side,
proved by a `mac` under `HKDF(ECDH(pairX_mediator, pairX_side),
"rltp/visibility/mac/voucher")` with the keys of the act's pinned
channel tuple with that side (8270).

**RLTP-TRU-8740** — The mediator MUST produce both vouchers and send
each as an `introduction-voucher` task on the act's pinned channel
with that side before it enters `completed`.

**RLTP-TRU-8750** — A Delivery retry of a sent voucher MUST count as
retransmission, not production; a repeated voucher at its recipient
follows the duplicate rule of 8260.

**RLTP-TRU-8760** — A recipient MUST accept a voucher only if it holds
the act within its absolute lifetime, role-terminal states included,
and `requesterPair` and `targetPair` match its held request and reply
artifacts of that act.

**RLTP-TRU-8770** — Where the act is held but its reply is not yet
accepted, the recipient MUST retain a voucher as pending, at most one
per side per act and as part of the retention of 8200, re-evaluate it
when a reply is accepted (8.2), and discard it unmatched at the first
whole second strictly after the absolute lifetime (8140).

**RLTP-TRU-8780** — An implementation MUST reach the same state for
all six arrival orders of ack, reply and voucher that complete within
the act's window and before a requester timeout.

Where a reply arrives only after the requester's `failed`, the outcome
is the role divergence of 8400, converged by the retry.

*Rationale.* Each side learns the other's fresh anchor from its own
mediator only, over its own pinned channel. No production duty may
remain open at the mediator's terminal state. A valid MAC over values
the recipient does not hold vouches for nothing. A voucher that
arrives before the reply must not be lost to arrival order, and the
pending state stays bounded. Order independence is stated as a
testable property.

### 8.6 Provenance

*In plain terms.* Every relationship remembers whether it began with
an encounter or an introduction. An introduced relationship becomes an
encountered one at the first real encounter, and never goes back.

**RLTP-TRU-8790** — Every relationship MUST carry the local chain fact
(6.4) `provenance ∈ { "encounter", "introduction" }`.

**RLTP-TRU-8800** — `provenance` MUST change only by two transitions:
an introduction sets `introduction`, and the first completed
enactment chained onto the relationship sets `encounter`, exactly
then and never downward.

UI wording such as "◇ verified via <mediator>" and "⇄ verified" is
informative; the attribute and its transition are normative.

*Rationale.* A mediated relationship is weaker than an encountered one
and must stay distinguishable (8.7). Only a real encounter lifts the
residue of a mediator that played an endpoint.

### 8.7 What the binding buys and what it cannot

*In plain terms.* The signatures stop a mediator from swapping cards
or stitching acts together, but a mediator can still pose as one of
the two sides; that is why an introduced relationship stays marked
until the two meet. Accepting an introduction is a deliberate step on
each person's own device.

Signatures over act-bound bodies remove card substitution and act
splicing: a mediator cannot swap cards between acts or splice
half-relationships, because any altered body breaks a signature whose
key it does not hold. A mediator can still be an endpoint: it can
fabricate an act in which it plays the target, or run two acts posing
as each side. Without a prior relationship there is no cryptographic
remedy; this is why a mediated relationship carries the weaker
provenance (8.6), upgradeable only by a real encounter. Refusal
privacy holds at the protocol surface, through the uniform ack, and
not against a talkative mediator; timing below `ack-delay` resolution
remains.

**RLTP-TRU-8810** — An implementation MUST present acceptance of an
introduction as a button plus sheet, never as a toggle, with each of
the three parties deciding on its own device.

*Rationale.* Accepting an introduction cannot be undone; a toggle
would make a one-way door look reversible.

## 9. Documented options and open points

*In plain terms.* This section names what the protocol has in view
but does not yet build. An attestation, a signed statement by one
person about another, is described here with its form and its rules,
so that a later version can add it without changing anything else;
this version has no such artifact. The other points are seams to
neighboring layers, a map of what proofs are feasible, and questions
that stay open on purpose.

### 9.1 Attestation (documented option)

*In plain terms.* An attestation would be a signed statement of a fact
that one person makes about another, which the subject can show to
others. It never states trust, needs both people to hold each other's
community anchor, and counts only once the subject accepts it. This
version has no such artifact; this section fixes its form for a later
one.

An attestation is a statement of a fact that one person, the issuer,
makes about another, the subject, and that the subject can show to
others. It is not a trust class of this version (2720). Its audience
class is P (Section 3): its purpose is presentation. This version
fixes its form, its rule and its dependency; trust in an attestation
arises in whoever reads it.

**RLTP-TRU-9110** — An attestation, where a later version specifies
one, MUST be a credential signed by the issuer's community anchor
about the subject's community anchor, in the DTG credential form the
encounter credential uses (Encounter §7.1).

**RLTP-TRU-9120** — An attestation MUST NOT state trust or a degree
of trust; it states a fact the issuer attests.

**RLTP-TRU-9130** — An issuer MUST NOT issue an attestation unless
issuer and subject each hold the other's community anchor through the
anchor mapping class (Section 6).

**RLTP-TRU-9140** — An attestation MUST take effect for others only
once its subject has accepted it, and the subject decides whether to
hold and present it.

**RLTP-TRU-9150** — An implementation MUST NOT emit an attestation as
an artifact of this version: it defines no attestation artifact,
schema or task type.

*Rationale.* The encounter credential is the one credential form RLTP
already ships; reusing it keeps verifiers on one form. Community
anchors, because an attestation is about the person, not about one
relationship. A statement of trust would bring back, as a portable
score, the degree of trust that the class model leaves out (2750) and
that 7020 refuses. The issuer can name the subject's community anchor
only if the subject disclosed it (1010), and the subject can verify
the attestation only if it holds the issuer's. Nobody becomes the
subject of a statement shown to others that they did not accept, as
with the encounter credential (Encounter §7.4). A half-specified
artifact would ship a transferable link between community anchors
before its consequences are specified.

**Residue.** An attestation connects two community anchors
transferably: whoever is shown it learns both and the link between
them. It lies outside the classes S, V and D (Section 3), and it is
the one case in which an anchor leaves the rule that its issuer
decides per recipient (1010), with the consent of the subject (9140).
Nothing in the construction keeps the issuer from retaining a copy.

### 9.2 The encounter-credential flank (normative)

*In plain terms.* An encounter credential can carry a commitment whose
meaning only Encounter's registry may give; this layer reads that
registry and adds no meaning of its own.

Encounter carries `commitment: { suite, value }` with an initially
empty suite registry and a producer emission gate (Encounter §7.2);
assigning meaning is registration in that registry, its own loop.

**RLTP-TRU-9010** — An implementation of this layer MUST NOT assign
meaning to an Encounter `commitment` beyond what Encounter's
commitment suite registry registers; this specification reserves only
the consumer role of that registry.

*Rationale.* Meaning assigned here, outside the registry, would
re-interpret existing credentials the day a suite registers.

### 9.3 Feasibility map for predicates (informative)

DV mapping = double-DH MAC (Section 6) · DV-ZK counting predicates =
Sigma-OR (@noble/curves, no audited library) · selective disclosure /
counting = BBS+ (W3C bbs-2023 draft) · general SNARKs only if
predicates outgrow counting and subsets.

### 9.4 M-DID binding of membership (normative, with open semantics)

*In plain terms.* In a group, a person is known by a member anchor of
that group, which links to none of their other groups. Only the sealed
group pair connects such a member anchor to a contact. A legacy
anchor never becomes a key for recognizing a re-encounter.

Membership binds to the group-context anchor (a true M-DID), with the
community anchor (the M-DID of the personal community) as the private
cross-relationship coordinate disclosed per contact (Section 6); its
default surface is the Trust act (2770). Access carries the
member-anchor scoping property (its §5.1).

**RLTP-TRU-9020** — The group pair (5.2b) MUST be the only artifact of
this specification that connects a member anchor to a contact.

**RLTP-TRU-9030** — An implementation MUST NOT run the continuity
machinery of 6a on a legacy relationship that carries no pair tuple
until the two people re-establish it as a relationship-creation act
(Identity §10, rule 2), and never under the legacy anchor.

*Rationale.* Member pseudonyms stay unlinkable across groups and
toward contacts except where the sender chooses to seal a group pair;
a second crossing would link them without that choice. A legacy
anchor must not become a continuity key: it is stable across groups,
and continuity under it would carry that stability into every fresh
tuple.

A legacy anchor stays in the rosters that admitted it and keeps
acting there (Identity §10, Access §5.1); for those groups the
pseudonymity a group pair lifts deliberately (5.2b) does not exist.
The star is anchor-agnostic.

**Open, and deliberately so; these are semantic, not directional:**
which anchor class counts as a "contact"; how group-specific hits on
the same person deduplicate without rebuilding the linkability the
member anchor removes; when an M-DID may bind to a relationship.

### 9.5 Strand unification (open)

*In plain terms.* Where you know that two relationships are one
person, they stay two channels on the wire and are merged only in your
own list. That costs one delivery per channel; joining the channels
themselves would need a new message, which this version leaves open.

Two chains the holder knows to be one person (a non-chaining merge,
Section 2) never become one chain on the wire: a chain append replaces
the active head within one strand, and `continuity-mapping@1` names a
single frozen `prior`. The admission layer makes the parallel strands
semantically harmless (one entry, one star content, one setting per
trust class, 2820, one profile content on every strand, 6455); their
cost, one delivery per strand, has no bound short of unifying the
strands themselves, which would need a wire change (a multi-prior
mapping or a successor artifact) and is left open rather than built
badly.

## 10. Security Considerations

*In plain terms.* Everything this layer sends is readable only by the
person it is addressed to, and checkable only by that person, except
what is signed so that it can be shown: cards, the rotation of a key,
and the two signed messages of an introduction. Every trick of
replaying, rolling back or splicing an artifact is caught by a named
rule. Someone who copies a community key cannot take the holder's
contacts along to a key of its own, because each key named its
successor in advance: where a contact holds that binding, the copier's
successor is discarded, and under a binding of its own the copier
stays a separate entry. Three things no rule stops: a sender can lie
about its contacts and about itself, a recipient keeps what it has
seen, and someone holding a copied community key can be taken for the
holder by a contact that still knows the holder under exactly that
key, and stays joined to the holder there, although, once the holder's
next key reaches that contact, it receives from that contact nothing
but the star and the blinded group star, and the contact's own new key
only from a rotation the contact made before then. Whoever holds a
person's seed
is that person to everyone; that is identity takeover, outside this
protocol.

Each consideration names an attack on this specification's
construction and the section that answers it, or states the residue
that no section removes.

- **Anchor harvesting via stars** — countered structurally: no
  standing form shows an anchor (5.1), so an implementation that
  harvests anchors from stars is nonconformant by artifact shape.
- **Star downgrade** — a `star@1` is rejected like every type a
  consumer does not implement; there is no version negotiation (2.1).
- **Star inflation** — `star@2` carries no aggregate number, so the
  only cardinality a star states is its entry list, and that list is
  the sender's claim like every entry: a sender can add values that
  match nothing, and only hits against anchors the recipient holds
  carry meaning (5.2, Section 7).
- **Salt/probe rollback, reuse, equivocation** — atomic persistence
  on both sides, strictly-greater acceptance, directional keys; a
  restoring sender without a high-water mark re-forms on the next
  tuple instead of guessing (5.2, 6a.2).
- **Sender equivocation / fabricated stars** — not preventable and
  normatively de-fanged: stars carry no veracity (5.2).
- **Chunk games** — partial deliveries never advance the accepted
  salt; byte-identical retries are ignored; one assembly slot per
  tuple bounds the number of open assemblies, and 5190 and 5200 bound
  each chunk; the size of one assembly is bounded only by the
  sender's set (5210, 5.2a). A star carries no count, so a contact
  can make a recipient hold an assembly of any size; the recipient
  may discard it at its own resource limit (5365), which leaves the
  delivery uncompleted and the sender's divergence standing (5680).
  Residue: between a sender whose set exceeds what a recipient can
  hold and that recipient, the star does not converge.
- **A copied community key** — whoever holds a copy of the
  community-anchor key `A`, with no seed and no pair key of the
  holder, holds neither the next generation's key nor any key that
  meets the binding of `A` (Identity §5.4). It cannot take the
  holder's contacts along to a key of its own. It can co-sign a
  rotation from `A` onto a key of its own, but wherever a contact
  holds the binding of `A`, that successor is rejected (6118), and a
  mapping is accepted only on the holder's own relationship tuple
  under the holder's pair key (6.3), so the copy cannot replace what
  that tuple holds. What remains is `A` itself, in a mapping on a
  relationship of the copier's own with a contact of the holder, where
  every check of 6.3 passes. Under a binding of its own for `A`, the
  binding rule keeps that relationship apart from the contact's entry
  for the holder (6605): it is an entry of its own under the anchors
  the copier chose, its rotations meet its own binding and move only
  that entry, and where both entries stand at `A` the contact's star
  carries `A` once (5050); this is the one place a copier rotates, and
  it moves none of the holder's entries. Under the holder's binding
  for `A`, copied from a self card the holder disclosed, it merges by
  head rule (a) where the contact's entry for the holder still stands
  at `A` (6530), and the star blinds `A` for the entry as it would for
  the holder alone; it cannot advance the entry. Once the holder's
  rotation reaches the contact, a further relationship under `A`
  merges with nothing (the head rule), and one merged before stays in
  the entry, lagging behind its anchor head: it counts as evidence
  toward no other entry (6550), it receives from the contact nothing
  but the star and the blinded group star (6595), except the re-issue
  of the anchor mapping from a rotation of the contact's own made
  while that relationship did not yet lag (6596), and the contact no
  longer shows a profile it sent for the holder (6425). No rule ends
  that merge; what still reaches the copier is named in Section 11.
  The holder's rotation keeps the copier out only at contacts it
  reaches before the copier does; the residue is a key copied before
  the holder rotated, not a takeover of the holder's tuples, and B2
  for the community anchor is graded accordingly (Identity §11, §13).
- **Mapping mis-binding** — closed by the 6.3 condition list; the
  unclaimability claim is defined as the sum of those checks.
- **Mapping downgrade / replay / reset** — exact version match
  (2.1), tuple-scoped state, and the generic revision rule with the
  record-freeze (6.4).
- **Group-star dictionary test and opening** — any contact of the
  sender holding a group's digest (a co-member, a former member,
  anyone holding an open group's digest) can test a group star it
  receives for that group and, where `c` is a real sealed pair, open
  it and learn the sender's member pseudonym there, because `k_e(G)`
  needs only the relationship key and `G` (5.2b); the "current
  member" condition is an acceptance rule, not a barrier. The
  sender's answers are the blinded group star switched off per group
  and the sealed group star switched per (group, contact) (2a, 5.2b).
- **Assembly shape** — a completed group-star assembly of no
  positive multiple of 16 entries, or with `c` of differing length,
  is rejected (5.2b), so no assembly carries an entry singled out by
  size.
- **Filler indistinguishability** — a filler `c` has exactly the
  length of a real one and a filler `d` the form of a MAC, so without
  `k_e(G)` a sealed pair and a filler are indistinguishable and the
  padded entry count reveals only its multiple of 16 (5.2b).
- **Rotation proves joint authorization and the bound successor** —
  an `anchor-rotation@2` shows that its two keys jointly authorized
  the link at rotation time and, on a relationship that holds the
  binding of `prev`, that `next` is the successor `prev` was bound to
  (6.3, condition 4b); it carries no evidence about who holds the
  keys. On a relationship that holds no binding of `prev`, it proves
  joint authorization only; what a copied key does with that is the
  consideration above (6.5, Identity §8.6).
- **A copied seed** — whoever holds the seed derives every
  generation, every binding and every pair key, and is, to every
  contact, the holder: identity takeover, which no rule of this layer
  can tell apart from the person (Identity §13).
- **Probe abuse** — a stranger cannot test candidate anchors:
  entries are HMACs of the *sender's own* anchors under a key bound
  to this fresh tuple; replay into another tuple fails (`k_p` binds
  both new anchors); fixed 256-entry chunks quantize cardinality;
  padding is indistinguishable without a matching held anchor.
  Self-matching is excluded by construction: the fresh tuple
  contributes no probe entry and is no valid `prior` (6a.2, 6a.4),
  so a probe can only ever prove *shared prior* history, never its
  own enactment.
- **Continuity choice-flapping** — structurally invalid: the record
  side's choice freezes at first verified issue (6.4, 6a.4).
- **Continuity hijack by key theft** — a stolen, still-active old
  device is a *key controller* and can continue a chain (6a.4);
  Identity §11 grades this as *none* under operational key
  possession. The exposure window, per phase: probe entries and
  `prior` candidates are drawn from the active heads at enactment
  (the snapshotted prior-candidate set), so a stolen tuple that has
  been superseded as active head before the enactment is worthless for
  continuity; artifacts of an act already pinned to a stolen tuple
  remain valid within that act's acceptance window, bounded by
  `issuedAt + act-expiry + act-skew` (8.1). Succession, not this
  artifact, is the remedy.
- **Act replay, future-dating, and id reuse** — the acceptance
  window is bounded in both directions (8.1): outside it, rejection
  is stateless; a future `issuedAt` beyond `act-skew` is rejected at
  every role. Inside the window, duplicate handling runs on the
  retained per-role artifact bytes, with pre-production duplicates
  absorbed into the single production event and a held act id under
  different bytes rejected as equivocation: there are never two acts
  under one id (8.1). Late acks and late replies of failed acts are
  ignored (8.4); boundary seconds are serialized (8.1).
- **Target-existence oracle** — removed by ordering: the ack duty
  binds before target resolution, and resolution failure is ack plus
  silence, indistinguishable from a refusing target (8.1, 8.4).
  Whether a mediator has a given contact is not testable by a
  requester holding a designator.
- **Introduction MITM** — card-digest binding plus `requestDigest`
  remove substitution and splicing (the ordered acceptance lists of
  8.2, including the card's own DI verification); the
  mediator-as-endpoint residue is irreducible and carried in
  provenance (8.6, 8.7).
- **Sybil self-evidence** — relational anchoring is mandatory
  (Section 7); the verifier's own holdings are ground truth.
- **Profile forgery and replay** — a third party can neither forge
  nor verify a `profile@1`: its `mac` is keyed by the relationship's
  key agreement and bound to both pair anchors in order, so a
  profile replayed into another tuple or into the other direction of
  the same relationship fails, and rollback to an older name or
  picture, or two profiles under one revision, fall under the generic
  revision rule (6b, 6.4).
- **Profile content has no veracity** — a profile is the sender's
  own statement about itself: nothing binds its name or picture to
  the person behind the pair anchor, and nothing makes the profile a
  sender shows one contact equal to the one it shows another. A
  contact using another person's name and picture is recognized, if
  at all, by people; who someone is rests on the encounter, never on
  the profile (6b).
- **Profile size and content** — an oversize envelope is rejected
  without decryption (Delivery §5), and 6b bounds every field so that
  a profile fits one document. A picture whose few compressed bytes
  declare huge dimensions is rejected before decoding, and so is one
  with a second frame, an animation, unreadable dimensions or data
  of another type than its data URI declares (6475). The picture is
  still sender-chosen bytes decoded by the recipient; the two
  admitted media types, the single still picture and the pixel bound
  narrow the format and the memory, not the exposure of the
  recipient's image decoder.
- **Picture metadata** — the sender re-encodes the picture (6445), so
  no place, time or device identifier of the source file travels; a
  recipient uses the pixels only (6485), so metadata a sender failed
  to strip reaches nothing. What the pixels themselves show, a place,
  a face, a moment, is content the sender chose and travels as it is.

## 11. Privacy Considerations

*In plain terms.* A star lets everyone who receives it check, for
each person they already know, whether the sender knows that person
too, and they can keep checking old stars forever. Once you have
given someone your community anchor, you stay in their star as long
as they hold it; the only way out is to rotate your anchor and not
give the new one to them, and the old one still matches for whoever
holds it. Whom you gave your anchor is visible to everyone who holds
it and receives a star from that person, because that is what the
star is for; after a rotation, so is whom you left out, and the one
you left out notices. Every other choice shows in what you send only
to the contact it concerns, although someone who carries several of
your channels can guess from profile deliveries who gets your
profile. Your profile goes to the people you trust, and they keep
what they saw. Where they also have your anchor, the profile links
nothing the anchor does not; where you give it without the anchor,
the same profile on two relationships is what links them, as can the
same group pseudonym sealed to several people or the name on your
contact card.

**RLTP-TRU-11010** — An implementation SHOULD show the user that a
pause or any other setting toward a person applies on every strand
of that person, and which settings a merge changed (2160).

*Rationale.* Settings are held per person (2820), and a merge
combines them (2160); a user who thinks in channels would otherwise
believe a stop or a start reached one channel only, or miss that a
merge carried a stop or an `on` from one strand to the others, or
that a split took a stop along (2115).

**RLTP-TRU-11020** — An implementation SHOULD tell the user, whenever
the profile class comes to be on toward a contact the anchor mapping
class is off toward, by turning the profile on or by withdrawing
trust while the profile is set `on`, that the profile's content links
the relationships it is sent on for whoever holds two of them.

*Rationale.* Without the anchor mapping, the profile's content ties
the sender's relationships together for whoever holds two of them.
It is not the only feature that can: a sealed group pair names the
same member anchor toward every contact it is sealed to, and a
contact card may carry the same signed display name (Encounter 0.31,
RLTP-ENC-6080); but it is the one this class switches on, and
withdrawing trust while the profile stays `on` leaves it flowing
without the mapping. Sending it anyway is a legitimate choice, and
the user makes it knowingly only if told.

**RLTP-TRU-11030** — A sender SHOULD spread the deliveries of one
profile revision to its recipients over time instead of sending them
at once.

*Rationale.* A new revision goes to every contact the class is on
toward as documents of nearly one size, larger than most of this
layer's; sent at once, they let a carrier that sees several of the
sender's channels pair those channels by size and moment. Padding
every profile to the image maximum would remove the size signal at
the cost of the largest document on every update; this specification
does not require it. Spreading blurs the moment, not the size: a
carrier that sees several of the sender's channels can still tie
the sender's trusted contacts to one sender by it.

- **The one-bit oracle is the feature.** A star recipient can test
  every anchor it legitimately holds, including future ones, against
  retained snapshots: offline, unthrottled, forever. The sender's
  remedy is switching the star off toward that recipient
  (distribution, not possession, 5830). The affected person's control
  lies before the fact: whether to issue the anchor mapping to a
  holder at all (2a). Once issued, no wire signal removes the person
  from the holder's star: the holder's entry stands, blinded, as long
  as the holder holds the community anchor (Section 2, 5.4).
  Withdrawal is rotation: the person rotates its community anchor and
  re-issues the anchor mapping only to contacts its anchor mapping
  class is still on toward (6.5). The holder keeps the old anchor, and
  its star keeps blinding it, so the old anchor still tests as a hit
  for every recipient who holds it, contacts following the rotation
  included, since they test against every anchor they hold for the
  person (6.3, condition 8). What rotation ends is the holder's view
  of the person's current anchor; what it cannot end is the bit for
  the old one.
- **Whom a person gave its anchor mapping is visible, and so is the
  withdrawal.** A holder's star blinds the anchor of every person who
  gave the holder its mapping (5010), so every recipient of that star
  who holds the person's anchor learns that the person gave the holder
  its mapping; that is the purpose of the star, not a leak of it.
  After a rotation, a recipient that follows it sees, in the star of a
  holder left out, a hit on the old anchor and none on the new, and so
  learns whom the person left out. The withdrawal is not hidden from
  the holder left out either: it receives no new mapping, and its own
  hits on the person in other contacts' stars fade as their senders
  follow the rotation (6.5). The holder left out still holds the
  pre-rotation binding of the generation it was given, which the new
  generation meets: it cannot derive the new anchor from it or test
  stars against it, but it recognizes the new anchor as the person's
  wherever it is shown that anchor in the clear, in a lineage or a
  self card passed on to it (6.2, 6.5).
- **Counts and deliveries are metadata.** Cardinality, churn, and
  delivery timing leak; 5.4 restricts delivery events to actual
  divergence: an encounter that changes nothing is not broadcast,
  and the delivery a chaining typically adds goes to the chaining
  party itself; probe chunking quantizes contact cardinality to
  256er steps toward a matched counterpart and hides it entirely
  from strangers. The entry list of `star@2` states the size of the
  sender's reconciliation view to every recipient, unpadded.
- **A new star follows a new anchor mapping.** Admission is immediate:
  verifying a contact's anchor mapping changes the reconciliation view
  at once (Section 2, 5.4), so a new star typically reaches every
  recipient the star class is on toward shortly after the mapping
  arrives. A recipient who knows when two people met, or who holds the
  new member's community anchor, learns roughly when the Trust act
  happened. This specification sets no delay that would blur that
  timing.
- **Redundant alias strands amplify the pattern.** Until strands
  are unified (Section 9), one divergence toward a merged member
  produces synchronized deliveries and counter-direction
  acknowledgements on several channels of one person, exactly the
  pairing surface Delivery §10 names for a carrier holding both
  directions. The pause is per person and stops all of them at once;
  nothing stops the redundancy alone. The profile adds to the
  pattern: it is one per tuple, so a merged person receives the same
  profile on every strand it is served on, under the same revision
  (6450).
- **A profile update has a size and a moment** (11030): a carrier
  that sees several of the sender's channels can tie the sender's
  trusted contacts to one sender; spreading the deliveries blurs the
  moment, not the size.
- **The group star reveals shared groups to every contact by
  default** (5.2b, 2a); that is its stated purpose, and a change of
  a listed group is one delivery toward every contact whose view it
  alters, typically all at once (5.4); a switched-off group's changes
  reach nobody. The per-group switch is the answer. Sealed pairs
  reveal the member pseudonym to the chosen contacts, and to every
  other contact of the sender that holds the group's digest, for the
  stars it receives, since the digest and the relationship key open
  them (5.2b, Section 10); only filler toward such a contact
  withholds it.
- **The lineage is a transferable linkage proof** (6.5). Every
  element of a carried lineage is signed by both keys it joins; a
  recipient can extract the elements and show them to anyone, who can
  verify that the two community anchors were jointly authorized as a
  link. This is a lasting correlation residue beyond the deniable
  mapping that carries it, accepted because a contact must be able to
  check the rotation it follows: it proves the joint authorization of
  the link, not the same person, the same seed, or any relationship
  with the recipient who discloses it. "Per recipient, never
  publicly" is the holder's issuance discipline, not a technical
  non-transferability. The segment starts at the first generation
  held on the relationship it is carried on (6420, 2285), and a
  relationship that never carried an earlier generation receives no
  lineage, so a rotation that left someone out also holds toward
  contacts trusted afterwards: they learn no earlier generation to
  test in the stars of those who held it. Residue: the chain is
  contiguous, so a relationship receives every generation between
  the first one held on it and the current one, including generations
  issued while the anchor mapping class was off toward the contact.
  Trusting a contact again after leaving it out of a rotation thus
  hands it, in retrospect, the generations of the time it was left
  out, which it can test in the stars it retained from that time; the
  rotation that left it out holds only until the contact is trusted
  again.
- **What a copied community key receives** (Section 10). A
  relationship of a copier that merged into a contact's entry for the
  holder, under the holder's binding and before the holder's rotation
  reached that contact, is one of the holder's relationships to that
  contact. While it does not lag, the contact's settings toward the
  holder reach it (2820, 2160): where the contact's anchor mapping,
  its sealed group pairs or its profile are on toward the holder, the
  contact sends them to the copier's relationship as well, and a
  profile the copier sends under a higher revision is the one the
  contact shows for the holder (6425). Once the holder's rotation
  reaches the contact, that relationship lags: nothing but the star
  and the blinded group star, whose default is every contact, still
  reaches it, and no anchor mapping of the contact in any issuance
  (6595), except the re-issue from a rotation of the contact's own
  made while that relationship did not yet lag (6596). What it
  already received, it
  keeps. A profile the copier sent is no longer among those the
  contact shows for the holder (6425).
- **Possession residue of the self card** (6.2): after disclosure,
  the card is transferable addressing material; the issuance rule of
  2a controls issuance, not recall.
- **Membership correlation at true size** (membership binding,
  Section 9): roster readers and colluding insiders, permanent log
  replication.
- **What a matched counterpart learns** (6a): "we share this prior
  relationship", exactly the fact being established, per the consent
  embodied in completing the ceremony together.
- **Refusal privacy** holds at the protocol surface (8.4, 8.7), no
  further; the target's `refused` state is deliberately silent, and
  an unresolvable target is indistinguishable from a refusing one
  (8.1), so the mediator's contact list is not probed through acts.
- **Third parties cannot verify** artifacts of classes S, V and D
  (Section 3), the introduction request and reply excepted, which are
  signed under fresh card anchors (3060); this is stronger than
  deniability alone.
- **What links, class by class.** The trust classes are independent
  (2a), and each combination states what it reveals:
  - *Profile with anchor mapping:* the profile adds no link. The
    community anchor already ties together every relationship that
    holds it, deliberately; the same profile on those relationships
    ties nothing the anchor does not.
  - *Profile without anchor mapping:* name, picture and text go to
    every contact the profile class is on toward, by default every
    trusted contact (2a), and they are the same for all of them (6b).
    The recipient can attach them to no community anchor and to no
    star hit, but whoever holds two of them, one recipient on two
    strands or recipients who compare, recognizes the same person by
    them. That is the disclosure the sender makes by the profile
    being on without the mapping, and the implementation tells the
    user so (11020).
  - *Anchor mapping without profile:* the recipient holds the
    community anchor, tests stars against it and follows its
    rotations, and receives no name or picture from this
    specification.
  - *Sealed group star without anchor mapping:* the recipient learns
    the sender's member anchor in that group and cannot link it to
    the community anchor or to star hits. The member anchor is the
    same toward every contact the pair is sealed to, so recipients
    who compare link their relationships with the sender by it, with
    or without a profile.
  - *Without any class:* a contact card may carry the sender's signed
    display name (Encounter 0.31, RLTP-ENC-6080), the same on every
    relationship it is given on, and an introduction request carries
    a signed `displayName` (8450).
- **The profile's MAC protects the document, not what it shows.**
  Class S promises that the profile is no transferable proof that the
  sender said it (Section 3); the name itself is not thereby
  unprovable (above). What a recipient has seen, it keeps, and can
  pass on as a picture or a name. Replacing the held profile on a
  newer revision is a rule for conformant recipients, not a guarantee
  against a recipient that archives (6b).
- **What settings show to the contact concerned.** Beyond the anchor
  mapping, which shows through stars, and the profile deliveries a
  carrier can pair (both above), a setting shows only to the contact
  it concerns, and to that contact it does show: a contact that
  receives no profile knows it has not been given one, and a contact
  that shares a group with the sender sees its sealed pair turn to
  filler, for example when trust is withdrawn (2840); filler hides
  the absence of a sealed pair only from contacts that do not hold
  the group's digest (5.2b).

## 12. Conformance

*In plain terms.* An implementation conforms to this layer when it
passes these sixteen checks. Some are fixed input-output vectors
anyone can run; the others are about behaviour over time and are
checked by running the implementation.

- **Profile** `rltp-trust@0.31`. Wire artifacts: `star@2` ·
  `group-star@1` · `group-pair@1` (inside `c` of a group star) ·
  `anchor-mapping@4` · `anchor-rotation@2` · `self-card@2` ·
  `profile@1` · `continuity-probe@1` · `continuity-mapping@1` ·
  `introduction-request@1` · `introduction-reply@1` ·
  `introduction-ack@1` · `introduction-voucher@1`.
- **Registered tasks** (Delivery Contract 0.81, §4.4): the
  trust-layer family `star/0.2` · `group-star/0.1` ·
  `anchor-mapping/0.3` · `profile/0.1`; the continuity tasks
  `continuity-probe/0.1` · `continuity-mapping/0.1`; the
  introduction tasks `introduction-request/0.1` ·
  `introduction-forward/0.1` · `introduction-reply/0.1` ·
  `introduction-ack/0.1` · `introduction-voucher/0.1`.
- **Normative schemas, one file per artifact:**
  `schemas/visibility-star.schema.json` (`star@2`) ·
  `schemas/visibility-group-star.schema.json` ·
  `schemas/visibility-group-pair.schema.json` ·
  `schemas/visibility-self-card.schema.json` ·
  `schemas/visibility-anchor-mapping.schema.json` ·
  `schemas/visibility-anchor-rotation.schema.json` ·
  `schemas/trust-profile.schema.json` ·
  `schemas/visibility-continuity-probe.schema.json` ·
  `schemas/visibility-continuity-mapping.schema.json` ·
  `schemas/visibility-introduction-request.schema.json` ·
  `schemas/visibility-introduction-reply.schema.json` ·
  `schemas/visibility-introduction-ack.schema.json` ·
  `schemas/visibility-introduction-voucher.schema.json`; payload
  schemas `schemas/visibility-payload-introduction-request.schema.json`
  · `schemas/visibility-payload-introduction-forward.schema.json` ·
  `schemas/visibility-payload-introduction-reply.schema.json` ·
  `schemas/visibility-payload-introduction-ack.schema.json` ·
  `schemas/visibility-payload-introduction-voucher.schema.json`.
- **Vectors:** `vectors/visibility.json` · `vectors/group-star.json`
  · `vectors/anchor-rotation.json` · `vectors/profile.json`.
  `vectors/visibility.json` carries payload-level positive vectors
  with real Encounter contact cards (eddsa-jcs-2022 DI proofs,
  `rltp-card/0.25`; the card vectors themselves live in
  `vectors/encounter-cards.json`, from the same key oracle and
  relationship nonces); the card digests follow the 2.1 preimage rule
  (the complete card document as transported), and the DI steps of
  the 8.2 lists are exercised by the same material.

Each rule below names what it covers and how it is tested:
*vector-testable* means a fixed input and output decide it,
*state-dependent* means it is checked against an implementation's
behaviour over time.

**RLTP-TRU-12010** — A conformant implementation MUST NOT emit a raw
third-party anchor in any artifact of this document (5.1, 8.1).

Vector-testable.

**RLTP-TRU-12020** — A conformant implementation MUST produce and
verify `star@2` per 5.2, 5.2a and 5.3, which forbids signing it.

Covers directional keys and the salt and chunk discipline on both
sides. Vector-testable (`vectors/visibility.json`).

**RLTP-TRU-12030** — A conformant implementation MUST maintain the
reconciliation contract of 5.4.

Covers safety (every delivery carries its production-commit snapshot,
serialized per 5.2, salt order equal to snapshot order), liveness (no
standing divergence while contact exists, the star class is on toward
the recipient, and the scope can issue), the initial star of a new
active head, and the suppression of the star and the group star while
their class is off toward a contact, with nothing sent in their place;
the intermediate snapshot sequence is not a conformance surface.
State-dependent.

**RLTP-TRU-12040** — A conformant implementation MUST verify
`anchor-mapping@4` by the complete condition list of 6.3, including
the lineage condition 4a, the pre-rotation condition 4b and the
linked-change rule of condition 8 over the carried segment, and hold
the links and pre-rotation bindings of 6610 per relationship.

Condition 4a bounds the lineage at 64 elements and takes the chain as
given; condition 4b checks every successor against the binding of its
predecessor. Vector-testable, including the mis-binding negative, a
rotation, a chain of three generations, and the 64/65 bound
(`vectors/visibility.json`); state-dependent (the bindings held per
relationship across its tuples, the rejection of an unlinked change of
`self`).

**RLTP-TRU-12050** — A conformant implementation MUST emit continuity
probes per 6a.2 and run the continuity-mapping machine of 6a.4.

Covers sequenced, globally sorted, padded probes drawn from the
snapshotted prior-candidate set (never the fresh tuple), one chooser,
the frozen choice, the single 6a.4 trigger, the alignment duty,
prior-candidate verification, no probe-match precondition, and the
re-issue of the anchor mapping after a chaining across two community
anchors (6985). Vector-testable (probe shape, mapping MACs);
state-dependent (chain atomicity, snapshot discipline, the 6a.3
duties).

**RLTP-TRU-12060** — A conformant implementation MUST run the
introduction carrier per 8.1 to 8.5.

Covers the precondition, act-id uniqueness, the two-sided acceptance
window with both mediator cutoffs and boundary serialization, pins
with the accept-only rule, the per-role lifecycles with the ack duty
bound before resolution, the direct `sent → completed` transition,
`completed` gated on all three mediator production duties, both
ordered reply-acceptance lists including the card's DI verification,
per-role duplicate handling on retained artifact bytes including
pre-production and pre-completion absorption, the pending voucher,
and the single pinned ack value with named clocks and the total
verdict rule. Vector-testable (bindings, ack MAC, stateless window
rejection); state-dependent (ack uniformity, resolution silence, role
states).

**RLTP-TRU-12070** — A conformant implementation MUST maintain
`provenance` per 8.6.

State-dependent.

**RLTP-TRU-12080** — A conformant implementation MUST publish per
Section 4.

State-dependent (the snapshot rule).

**RLTP-TRU-12090** — A conformant implementation MUST NOT treat
stars, relational counts or continuity probes as evidence (5.2,
Section 7).

State-dependent consumer rule.

**RLTP-TRU-12100** — A conformant implementation MUST compare wire
integers exactly over the full 18-digit domain and treat scope
exhaustion as terminal with suspension (2.1).

Exhaustion means no rollover and no reset: affected duties issue
nothing and die with their tuple, and service re-forms under the next
tuple's own rules. Vector-testable (comparison); state-dependent
(exhaustion).

**RLTP-TRU-12110** — A conformant implementation MUST admit
deliverable-set members per the total admission rule of Section 2 and
merge entries per 6a.1 under the head rule and the binding rule.

Covers the commit of a relationship's first verified
`anchor-mapping@4`, written whole, as chain-level state with its merge
and state-loss rules; overflow as deliverable-pending with its stated
lifecycle; the state-case tables of 6630; the merge at a chaining only
once the two anchor heads are comparable (2145); the split of Section
2 with the identity of the remaining entry; the manual merge limited
to relationships of which at most one holds an entry; and what a
lagging relationship is not sent (6595), decided for the re-issue
after a rotation at the rotation itself (6596). State-dependent.

**RLTP-TRU-12120** — A conformant implementation MUST produce and
receive `group-star@1` per 5.2b and reconcile it per 5.4 over the
tuples *(group, mode, member, memberOp)*.

Covers the keys, the entry construction, the modes per (group,
contact) under the classes of 2a, padding to a multiple of 16, the
assembly rule (a positive multiple of 16 entries, one `c` length),
and the ordered reception checks. Vector-testable
(`vectors/group-star.json`, including the rejected assemblies and a
pair whose `memberOp` is an ordinary admission); state-dependent
(modes, triggers, the view).

**RLTP-TRU-12130** — A conformant implementation MUST produce and
verify `anchor-rotation@2` per 6.5 and carry out the sender duties
after a rotation.

Covers `next` as the one key that meets the binding of `prev`,
`commit` as the binding of `next`, `next` differing from `prev`, and
no number in the body. Vector-testable
(`vectors/anchor-rotation.json`, including a successor that does not
meet the binding held for its `prev`); state-dependent (the duties,
including the lineage segment per relationship from the first
generation held on that relationship).

**RLTP-TRU-12140** — A conformant implementation MUST apply the
generic revision rule of 6.4, with atomic and monotone allocation, to
every revisioned type.

The revisioned types are the anchor mapping, the continuity mapping
and the profile. Vector-testable (the rule); state-dependent
(allocation).

**RLTP-TRU-12150** — A conformant implementation MUST produce and
verify `profile@1` per 6b.

Covers the closed body and its field bounds, the pixel bound and the
decoder discipline of 6475, the re-encoded image without metadata, the
directional `mac` under `k_pr`, the revision scope and the one
revision counter across scopes, replacement of the held profile by the
newest verified revision, delivery of every new revision, the profile
shown per contact only from the active heads of relationships that do
not lag, and the absence of any signature. Vector-testable
(`vectors/profile.json`: the closed body and its field bounds, the
pixel bound by a negative whose image exceeds 1024 × 1024 pixels, the
directional `mac`, the absence of a signature); state-dependent (the
rest of 6475, re-encoding, delivery, replacement, the profile shown,
re-delivery after a chaining).

**RLTP-TRU-12160** — A conformant implementation MUST apply the trust
classes of 2a.

Covers the three settings per class and contact, held per person
across strands and combined at a merge; the default recipient set of
each class; the trusted contacts as the contacts the anchor mapping
class is on toward, and the Trust act as turning it on; what turning
the anchor mapping off stops and what it leaves on; settings that
change only what is sent; and forward-only withdrawal.
State-dependent.

*Rationale.* A conformance claim is only as strong as the rule list a
tester can check it against; a rule without a named test drifts
between implementations until two of them disagree on the wire. The
split into vector-testable and state-dependent tells a tester which
claims a fixed input decides and which need an implementation run over
time, so neither kind is passed off as the other. Leaving the profile
or the class defaults out of the list would let an implementation
claim conformance while revealing more, or less, by default than
another.

## References

[RFC2119] · [RFC8174] BCP 14 · [RFC8785] JCS · [RFC2104] HMAC ·
[RFC5869] HKDF · [RFC7748] X25519 · [RFC8032] Ed25519 · [RFC2397]
`data` URL scheme · **RLTP Identity 0.54** (§2, §5.2, §5.4 including
the pre-rotation binding, §6.1, §8.6, §9.3, §10, §11, §13) · **RLTP
Encounter 0.31** (fresh-always enactment §4.4, commitment §7.2,
contact cards and their DI rules) · **RLTP Delivery Contract 0.81**
(the §4.4 registry, the 65 536-byte plaintext limit of §5, the
acknowledgement regime of §4.2, §10) · RLTP Access Layer 0.57 (§5.5,
§5.6) · RLTP Membership Tasks 0.19.
