# RLTP Network Visibility

**Real Life Trust Protocol — cross-cutting: Network Visibility**

- **Status:** Editor's Draft
- **Version:** 0.3.0-draft (third casting)
- **Editors:** Anton Tranelis
- **Date:** 2026-08-23
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Conformance profile:** `rltp-visibility@0.3` (draft). Wire
  artifacts: `star@1` · `grade-declaration@1` · `anchor-mapping@2` ·
  `self-card@1` · `introduction-request@1` · `introduction-reply@1` ·
  `introduction-ack@1` · `introduction-voucher@1`.
- **Companions (pinned):** **Identity 0.8** (`pair/` registry §6.1 —
  REQUIRED) · **Encounter 0.23** (the pair casting — the ceremony now
  enacts under pair anchors; the 0.2-era gap note is obsolete) ·
  Access 0.25 · Membership 0.11 (both read-only; their recast is the
  M-DID loop, after convergence here).
- **Supersedes:** versions 0.2 and 0.1 (archived as
  `archive/network-visibility-0.2.md` / `-0.1.md`).
- **Source material:** `design/visibility-publikumsprinzip-2026-08.md`
  · `design/mdid-bindung-2026-08.md` · triages
  `design/visibility-review1-2026-08.md` (5B/9M/3m),
  `design/visibility-review2-2026-08.md` (4B/8M/2m — all answered by
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

Third casting, answering review round 2 in full. New in this casting:
the uniform wire envelope (2.1), the closed verification conditions
of the anchor mapping (6.3), the act-binding construction of the
introduction (8.1), directional star keys (5.2), the honest DV threat
model of the grade declaration (5.5), a total publication-space rule
(4), and — as round 2 demanded — **schemas
(`schemas/visibility-*.schema.json`) and vectors
(`vectors/visibility.json`) shipped with the casting**. The browser
simulator still carries pre-0.3 labels and MUST be aligned; it is a
probe, not the normative source.

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
ways to gain a new contact — a real-life encounter (Encounter 0.23,
enacting under pair anchors) or the introduction act (Section 8).**
No artifact of this document transports a **standing** anchor of a
third party to anyone. The one anchor an introduction does transport
is **fresh, created for the new relationship itself, by its own
issuer** — the rule working, not an exception to it.

## 2. Terminology

- **Anchor** — a context identifier of an identity (Identity 0.8 §5,
  §6): the self context, or a `pair/…`, `group/…`, `persona/…`
  context.
- **Anchor classes (DTGWG-aligned naming):** **R-DID** = pair-context
  anchor (Identity 0.8 §6.1; pairwise, no correlation) · **P-DID** =
  persona anchor (intentional correlation) · **S-DID** = the self
  anchor — the stable coordinate across a person's *relationships*,
  disclosed selectively per recipient (RLTP's extension to the DTGWG
  ladder) · **M-DID** names the *class* "per-community member
  identifier"; in this family membership currently binds the S-DID,
  and the group-context anchor becoming a true M-DID is a confirmed
  direction with open semantics (Section 9.4).
- **Promotion** — the trust act of a holder toward one of their
  contacts; the UI surface of promotion and of S-DID disclosure is
  the **Trust** act.
- **Star** — the artifact by which a sender lets one recipient relate
  the sender's contact set to the recipient's own (Section 5).
- **Deliverable set** — for one recipient: the contacts who have
  promoted the sender, each under its effective grade (5.5).
- **Relationship tuple** — the pair `(local pair anchor, remote pair
  anchor)` of one active relationship. All per-relationship state of
  this document (star salts, grade revisions, mapping state) MUST be
  indexed by relationship tuple, never by a human-contact notion
  above it (see 6.4).
- **Resolver class** — of one *publication* of an artifact: the set
  of parties able to make use of that publication (Section 4).
- **Audience class** — P, V, or D per Section 3, assigned per
  artifact, never per act.
- **DV** — designated-verifier: verifiable only with the addressee's
  secrets; the addressee could have forged it; third parties cannot
  even check it.

### 2.1 Common wire conventions (normative)

Every artifact of this document is a JSON document of the form

```json
{ "body": { … }, "proof": { … } }
```

- **body** carries `type` (the versioned artifact name) and the
  fields its schema closes. **Unknown members anywhere in the
  document MUST be rejected** — every schema is closed.
- **proof** carries exactly the proof members its schema names for
  the type: `mac` (single-MAC artifacts), `mac1` + `mac2` (the
  anchor mapping), or `proofValue` (Ed25519 signature artifacts,
  produced per Encounter 2.3's `eddsa-jcs-2022` discipline over
  `JCS(body)`).
- **Canonical bytes** are `JCS(body)` (RFC 8785) — the body object
  only, never the envelope, never the proof.
- **MAC** is HMAC-SHA-256 over the canonical bytes; encoded as `u`
  followed by 43 unpadded base64url characters (44 characters in
  total).
- **KDF** is HKDF-SHA-256, salt empty, output 32 bytes, info strings
  exact ASCII as given per artifact.
- **ECDH** is X25519 over Identity §5.2 key-agreement keys. An
  all-zero shared secret MUST be rejected before key derivation.
- **Anchor bytes** in MAC inputs and KDF info strings are the UTF-8
  bytes of the anchor's `did:key` string.
- **Timestamps** (`issuedAt`) follow Encounter 2.3's `rfc3339utc`
  profile: UTC `Z` form, at most three fractional digits, whole-
  second comparison.
- **Integers on the wire** (`salt`, `revision`, `count`) are JSON
  strings holding a base-10 integer, no leading zeros, no sign, no
  exponent; domain 0 … 2⁶³−1 (`salt` and `revision` start at 1;
  `count` at 0). String encoding keeps JCS number canonicalization
  out of the security path.
- A consumer MUST reject any `type` it does not implement —
  explicitly including `anchor-mapping@1` and every unknown version.
  There is no version negotiation.

## 3. The audience principle (normative)

For every artifact, two questions decide its cryptographic form:
**(F1)** whom must the statement convince for its purpose to be
fulfilled? **(F2)** must the recipient be able to pass it on?
Provability MUST be the smallest set the purpose demands. The default
is deniable (DV); a transferable signature is the exception that
carries the burden of justification.

- **Class P (presentable).** Statements about myself whose purpose is
  showing: persona profile (audience: everyone), membership document
  (audience: roster readers), the self card and the contact card
  (audience: the parties I hand them to — addressing material).
  Transferably signed. Only class-P artifacts are called
  **credentials** or cards.
- **Class V (links).** Every statement that **connects two contexts
  of one person**: the anchor mapping, group mappings, the
  introduction voucher. Always DV; a cross-context link MUST NOT
  exist anywhere as transferable proof. **Boundary:** a key binding
  *within* one context (the self card — Ed and X key of the same
  context) is not a link; it is class P with the possession residue
  Section 11 names.
- **Class D (statements about third parties).** Stars and
  introduction requests. Knowledge itself harms here (the collector
  argument), so class D adds the content grading of Section 5.

Authentication and audience are orthogonal: every artifact travels
end-to-end encrypted and channel-authenticated regardless of class.

## 4. The publication-space rule (normative)

Principle (register no. 2): *publication space = the smallest space
that contains the resolver class.* Made total and decidable:

1. **Scope.** The rule governs class-V and class-D artifacts and
   every publication of a standing artifact into a shared context.
   **Class-P artifacts are exempt by class**: their audience is
   declared by their purpose (a persona surface is deliberately
   unbounded; a card is handed, not published), and handing them is
   an issuance act under Section 3, not a publication under this
   rule.
2. **Candidate spaces**, closed list, with their member sets: a
   **group space** (members: the group's current members per
   Access/Membership at the snapshot) · a **pair channel** (members:
   the two relationship parties) · a **persona surface** (members:
   unbounded — admissible only for class P, see 1).
3. **Snapshot.** The resolver class of a publication is evaluated at
   publication time. Later growth obliges nothing (register no. 5);
   later shrinkage is the space's own epoch/rekey business (Access),
   never the artifact's.
4. **Choice.** The publisher MUST choose a candidate space that
   contains the resolver class and is minimal by member-set
   inclusion among candidates that do. Where several incomparable
   minimal spaces exist, the publisher MAY choose any one; each
   further space is a fresh publication decision.
5. **Transport is not publication.** An artifact being *delivered*
   (introduction legs, star delivery) is governed by its addressee
   binding, not by this rule.

Applied: a group member's self-anchor tag is published into the
group space. World publication of it is a violation.

## 5. The star (normative)

### 5.1 Standing contents: count or blinded — nothing else

Per affected contact, exactly one standing form:

- **Count** — inclusion only in the aggregate number. No anchor or
  intersection leak; cardinality and delivery metadata remain
  (Section 11).
- **Blinded** — the anchor travels as `HMAC(k, anchor bytes)` under
  the delivery key of 5.2.

A raw third-party anchor MUST NOT appear in any star; there is no
standing "show" grade — disclosure to a stranger is only the
introduction act. `count` is the number of **all** deliverable
contacts (count-graded and blinded-graded together); `blinded[]` is
the subset that is blinded-graded. Duplicate entries MUST NOT be
emitted; entries are sorted lexicographically.

### 5.2 star@1 — directional epochal blinding

Body: `{ "type": "star@1", "salt": <integer-string>, "count":
<integer-string>, "blinded": [ <mac encoding> … ] }`. Proof: `mac`
under `k` (below) — the same key blinds and authenticates; the
artifact stays recipient-forgeable by construction.

- `salt` is the delivery sequence of this relationship **direction**:
  starting at 1, strictly increasing, persisted **atomically before**
  send. After state loss (backup restore) a sender MUST NOT deliver
  until it holds a persisted high-water mark from its synchronized
  state; if none is recoverable, the relationship's star subscription
  is re-created (fresh tuple semantics per 6.4), never resumed by
  guess.
- The recipient MUST persist, atomically and per relationship tuple,
  the highest accepted `salt`, and MUST reject any star whose `salt`
  is not strictly greater.
- **Directional key:** `k = HKDF(ikm = X25519(pairX_sender,
  pairX_recipient), info = "rltp/visibility/blind/star/" ||
  senderPairAnchor || "/" || recipientPairAnchor || "/" || salt)`
  with both anchors as anchor bytes and `salt` in its wire string
  form. The two directions of one relationship therefore never share
  a key, whatever their salts.

Properties, with honest limits: **intersection only** (tests against
legitimately held anchors; no new anchor arrives) · **no veracity**
— the star is a claim by the sender; a hit proves both parties hold
the anchor, nothing about any relationship; consumers MUST NOT treat
stars as relationship evidence · **collusion** breaks across keys;
NOT prevented: pooling of *known* anchors against retained snapshots
· **deniability free** (shared-key MAC) · **longitudinal tracking**
dies with unique directional salts — normative on both sides here —
with the stated residue that later-learned anchors remain testable
against retained snapshots.

### 5.3 The star MUST NOT be signed

A transferable signature would make "these values are this person's
circle" provable once `k` leaks. Forgeability is a requirement;
credibility beyond the addressee is a DV-ZK predicate (9.3), never a
signature.

### 5.4 Subscription — delivery on set change only

A sender MUST deliver a new star when and only when the deliverable
set for that recipient changes: a new promotion of the sender, an
effective-grade change, a departure. A new encounter that does not
change the deliverable set MUST NOT trigger delivery. Pausing stops
future deliveries; snapshots remain.

**Transition atomicity:** when a promotion creates a new deliverable
contact, the sender MUST deliver exactly one star for that change:
after the contact's grade declaration is verified, or after the
declaration window `grade-wait = PT24H` elapses (then under the
fail-closed grade). No interim delivery under a provisional grade.

### 5.5 grade-declaration@1 — DV, fail-closed, threat model stated

Body: `{ "type": "grade-declaration@1", "subject": <affected pair
anchor toward the holder>, "holder": <holder's pair anchor toward
the subject>, "grade": "count" | "blinded", "revision":
<integer-string>, "issuedAt": <timestamp> }`. Proof: `mac` under
`k = HKDF(ECDH(pairX_subject, pairX_holder),
"rltp/visibility/mac/grade/" || subjectPairAnchor || "/" ||
holderPairAnchor)`.

- Scope of `revision`: the relationship tuple (subject, holder),
  monotone. Higher revision wins; equal revision with JCS-identical
  body is idempotent; equal revision with different body is an
  **equivocation error** — reject and keep current state.
- **Effective grade:** the grade of the highest verified revision;
  absent any verified declaration, **count**.
- **Threat model, stated honestly (this is DV):** the holder is the
  designated verifier and can compute every MAC — the declaration
  does not and cannot constrain a malicious holder. What it
  provides: third parties cannot fabricate or verify declarations,
  and an honest holder cannot be confused about the subject's
  choice by transport tampering (fail-closed + equivocation rule).
  Against a malicious holder the protection is structural, not
  cryptographic: the star travels only to the holder's own
  recipients and carries no veracity (5.2) — a lying holder is an
  equivocating sender, already in the model. Suppression:
  withholding a newer revision keeps the older verified state
  active (initially count); the 0.2 claim "can only narrow" is
  withdrawn.

The default UX remains one human question: the **Trust** act issues
`grade: "blinded"` (register no. 3).

## 6. Anchor mapping (normative)

### 6.1 Purpose and construction

`anchor-mapping@2` links a pair anchor to the self anchor of the
same person for exactly one addressee — a **double-DH MAC
construction in the Signal pattern**, entirely in WebCrypto.

Body: `{ "type": "anchor-mapping@2", "pair": <sender's pair anchor
in this relationship>, "self": <sender's S-DID>, "to": <addressee's
pair anchor in this relationship>, "card": <self-card@1 document,
6.2>, "revision": <integer-string>, "issuedAt": <timestamp> }`.

Proof: `mac1` under `k1 = HKDF(ECDH(pairX_sender, pairX_addressee),
"rltp/visibility/mac/map1")` and `mac2` under `k2 =
HKDF(ECDH(selfX_sender, pairX_addressee),
"rltp/visibility/mac/map2")`, both over the canonical bytes.

### 6.2 self-card@1 — binding, not link; residue named

`{ "body": { "type": "self-card@1", "anchor": <S-DID>,
"keyAgreement": <X25519 multikey> }, "proof": { "proofValue": … } }`
— Ed-signed under `anchor` per 2.1. It binds the Ed25519 and X25519
keys of the **same self context**; it links no two contexts (class
boundary, Section 3) — but it is **not harmless**: it is stable
addressing material, transferable after disclosure. Rule §1 governs
issuance, not possession (Section 11).

### 6.3 Verification — the closed condition list

The addressee MUST accept a mapping only if **all** of the
following hold; the unclaimability property exists only as the sum
of these checks:

1. envelope and schemas valid, `type` implemented (2.1);
2. `body.to` equals the addressee's **own active pair anchor** of
   the relationship the mapping arrived on;
3. `body.pair` equals the **counterpart's pair anchor** of that same
   relationship tuple, as held from the ceremony;
4. `card` verifies as `self-card@1` under **its own** `anchor`;
5. `card.anchor == body.self` — the card is the claimed self, not
   merely *a* valid card;
6. `k2` is derived from **`card.keyAgreement`** — the key the card
   binds, never a key the body claims elsewhere;
7. both ECDH outputs are non-zero; both MACs verify;
8. `revision` per 6.4.

With 2–7 in place: foreign self anchors are unclaimable (the card is
unsignable, `k2` uncomputable), the addressee can still forge the
whole artifact (deniability preserved), and third parties can verify
nothing.

### 6.4 Revision, replay, and relationship reset

- Scope of `revision`: the relationship tuple `(pair, to)` — `self`
  is **content**, not scope, so a wrong self claim is correctable by
  a higher revision.
- Higher revision wins; equal + JCS-identical = idempotent replay,
  harmless by declared semantics (disclosure is irreversible,
  register no. 5); equal + different = equivocation error.
- **Reset rule:** all mapping state is indexed by relationship
  tuple. A mapping naming a pair anchor that is not the *active*
  tuple of any current relationship MUST be rejected. A re-created
  relationship (Identity §9.3: re-created, not recovered) is a new
  tuple with empty state — old mappings die with the old tuple and
  cannot be re-attached.

## 7. Relational counts (normative principle, artifact unwritten)

Anchors are free; a Sybil swarm issues itself arbitrary
self-evidence. The scarce resource is the boundary edge into the
honest graph. Count and personhood statements MUST be anchored
relationally — "≥ N, of which k inside the verifier's trust
horizon" — never absolutely; the blinded star supplies the
verifier-side instrument. Global scores are rejected. **The proof
artifact is deliberately unwritten** (it needs 9.2's substrate);
until it exists this is a design constraint on consuming layers,
marked state-dependent in Section 12.

## 8. The introduction act (normative)

Principle: **the mediator transfers messages, never standing
anchors.** The fresh pair anchor of step 1 is issuance by its owner
for the new relationship, not forwarding.

### 8.1 Artifacts and steps

All four artifacts use the 2.1 envelope; the request and reply are
signed (`proofValue`) under the **fresh pair anchor** their `card`
carries — over `JCS(body)`, where the card appears as a **digest**,
breaking the 0.2 self-reference:

1. **`introduction-request@1`** (requester → mediator). Body:
   `{ type, act: <32-byte random, u-base64url, 43 chars>, mediator:
   <mediator's pair anchor toward the requester>, target: <opaque
   designator, 8.2>, cardDigest: <multibase multihash of
   JCS(card document)>, profile: <released profile object, closed
   schema> }`. The full Encounter 0.23 contact card (fresh pair
   context) travels **beside** the introduction document in the same
   sealed delivery; the signature under the card's anchor binds act,
   mediator, target, and card digest into one act.
2. **`introduction-ack@1`** (mediator → requester). Body: `{ type,
   act }` — nothing else; no status member exists in the schema. The
   mediator MUST send exactly one ack per received request, at its
   declared constant delay `ack-delay` (a mediator-published fixed
   parameter, not adaptive), **identically for existing, refusing,
   unknown, and expired targets**. Outcome travels only as step 3.
3. **`introduction-reply@1`** (target → requester, through the
   mediator). Body: `{ type, act, mediator: <mediator's pair anchor
   toward the target>, requestDigest: <multibase multihash of
   JCS(request body)>, requesterPair: <the card anchor from step 1>,
   cardDigest: <digest of the target's fresh card> }`, signed under
   the target's fresh pair anchor; the target's card travels beside
   it. `requestDigest` binds the reply to exactly one request —
   reply splicing across requests breaks the signature.
4. Result: a pairwise relationship (a relationship tuple); deferred
   disclosure thereafter per Section 6.

### 8.2 The target designator

`target` is an opaque string, 1–256 bytes in `u`-base64url form,
minted by the mediator's own namespace (it is the mediator's
addressing capability that is being exercised). Requirements: stable
per (mediator, target) at least for the act's lifetime; the mediator
MUST be able to resolve it to a deliverable party; the **target**
MUST be able to verify, over its own channel to the mediator, that
the designator denotes itself before consenting. The designator
carries no global meaning and MUST NOT be built from any anchor.

### 8.3 What the binding buys — and what it cannot

Signatures over `{act, mediator, target, cardDigest}` and
`{act, mediator, requestDigest, requesterPair, cardDigest}` remove
card substitution and act splicing: a mediator cannot swap cards
between acts or splice half-relationships — any altered body breaks
a signature whose key it does not hold. What remains, stated
honestly: the mediator can **be** an endpoint — fabricate acts in
which it plays the target, or run two acts posing as each side.
There is no cryptographic remedy without a prior relationship; a
mediated relationship therefore carries the weaker verification
grade "◇ verified via <mediator>", upgradeable only by a real
encounter (which, under Encounter 0.23, enacts on the same pair
tuple and lifts its grade).

### 8.4 The introduction voucher

`introduction-voucher@1` — the mediator's statement "I mediated
this act between these two". Class V, therefore **two artifacts**,
one per side, each DV under the mediator's relationship key with
that side: body `{ type, act, requesterPair, targetPair }`, proof
`mac` under `k = HKDF(ECDH(pairX_mediator, pairX_side),
"rltp/visibility/mac/voucher")`. No transferable signature exists;
neither side can prove the mediation to anyone.

### 8.5 Refusal privacy — scope stated honestly

The single, constant-delay, content-free ack removes the protocol
signal. What remains: timing side channels below `ack-delay`
resolution and a mediator who talks out of band. Refusal privacy
holds at the protocol surface, not against a malicious mediator. UX
invariant (one-way-door): acceptance is a button plus sheet, never a
toggle; three devices, three decisions, each at the right party.

## 9. Documented options and open points

### 9.1 Grade ladder beyond two — withdrawn surface

A finer ladder was tried in UX and withdrawn (22.08.);
reintroduction would extend the `grade` enum in a new version.

### 9.2 The encounter-credential flank — seam now pre-wired

Encounter 0.23 carries the optional, semantically unassigned
`commitment` member. Assigning it — commitment scheme, predicate
suite, verification — remains deliberately undecided and is its own
loop; this document only reserves its consumer role.

### 9.3 Feasibility map for predicates (informative, early 2026)

DV mapping = double-DH MAC (Section 6) · DV-ZK counting predicates =
Sigma-OR (@noble/curves, no audited library) · selective disclosure
= BBS+ (W3C bbs-2023 draft) · SNARKs only beyond counting/subsets.

### 9.4 M-DID binding of membership — confirmed direction, open semantics

Unchanged from 0.2 (decision 23.08., `design/mdid-bindung-2026-08.md`):
target picture is membership bound to the group-context anchor, with
the S-DID as private coordinate disclosed per co-member via the
Section 6 pattern (group→self), UI surface = the Trust act. Current
reality (finding M5): roster *readers* and colluding insiders can
correlate S-DID-bound members across groups; admission artifacts
replicate stable anchors into logs permanently. Technically the star
is anchor-agnostic (M6); the open questions are semantic (contact
class, dedup without rebuilding linkability, M-DID↔relationship
binding). The change is the Access/Membership recast — its own loop
after this document converges, coordinated with Encounter 0.23's pin
debt (Encounter §12).

### 9.5 Standing disclosure (from the architecture map)

Unchanged: normative capture of standing disclosure of one's own
edges remains open; until then deliberate app policy.

## 10. Security Considerations

- **Anchor harvesting via stars** — structurally countered (5.1);
  harvesting apps are nonconformant by artifact shape.
- **Grade forgery** — third parties cannot forge (relationship-key
  DV); the malicious holder is outside what DV can constrain and is
  handled structurally (5.5 threat model); suppression keeps the
  last verified state, initially count.
- **Salt rollback / reuse / equivocation** (M1) — atomic persistence
  both sides, strictly-greater acceptance, directional keys; a
  restoring sender without a high-water mark re-creates the
  subscription instead of guessing.
- **Sender equivocation / fabricated stars** (M2) — not preventable;
  normatively de-fanged: stars carry no veracity.
- **Mapping mis-binding** (round-2 B1) — closed by the 6.3 condition
  list; the unclaimability claim is defined as the sum of those
  checks.
- **Mapping downgrade / replay / reset** — version exact-match
  (2.1), tuple-scoped state, reset rule (6.4).
- **Introduction MITM** (round-2 B2/M5) — card-digest binding plus
  `requestDigest` in the reply remove substitution and splicing; the
  mediator-as-endpoint residue is irreducible and carried in the
  verification grade.
- **Sybil self-evidence** — relational anchoring mandatory (7).

## 11. Privacy Considerations

- **The one-bit oracle is the feature.** A star recipient can test
  every legitimately held anchor — including future ones — against
  retained snapshots, offline, forever. Remedies: count grade
  (fail-closed initial), pausing (distribution, not possession).
- **Counts and deliveries are metadata**: cardinality, churn, and
  delivery timing leak; 5.4 restricts delivery events to actual set
  changes so encounters as such are not broadcast.
- **Possession residue of the self card** (6.2): transferable
  addressing material after disclosure; §1 is issuance control, not
  recall.
- **Membership correlation at true size** (9.4): roster readers and
  colluding insiders, permanent log replication — the standing
  motivation of the M-DID direction.
- **Refusal privacy** holds at the protocol surface (8.5), no
  further.
- **Third parties** cannot even verify class-V artifacts.

## 12. Conformance

A conformant implementation:

1. emits no raw third-party anchor in any artifact (5.1, 8.1) —
   vector-testable;
2. produces and verifies `star@1` per 5.2 (directional keys, salt
   discipline both sides, no signature) — vector-testable
   (`vectors/visibility.json`);
3. delivers exactly on deliverable-set change with the 5.4
   transition rule — state-dependent, simulator-checked;
4. enforces `grade-declaration@1` per 5.5 (fail-closed count,
   revision + equivocation rules) — vector-testable;
5. verifies `anchor-mapping@2` by the complete 6.3 list and the 6.4
   reset rule, rejecting legacy/unknown versions — vector-testable
   including the forgeability and mis-binding demonstrations;
6. produces act-bound introduction artifacts and the uniform ack
   (8.1–8.4) — binding vector-testable; ack uniformity
   state-dependent against the declared `ack-delay`;
7. publishes per Section 4 — state-dependent (snapshot rule);
8. treats stars and counts as non-evidence (5.2, 7) —
   state-dependent consumer rule.

## References

- Identity Layer 0.8 — `spec/identity-layer.md` (§5.2, §6.1, §9.3).
- Encounter Layer 0.23 — `spec/encounter-layer.md` (pair enactment
  §4.4, commitment seam §7.2, securing profile §2.3).
- RFC 8785 (JCS) · RFC 2104 (HMAC) · RFC 5869 (HKDF) · RFC 7748
  (X25519) · RFC 8032 (Ed25519) · BCP 14.
- Schemas: `schemas/visibility-*.schema.json`. Vectors:
  `vectors/visibility.json`.
- Design sources and triages: `design/visibility-publikumsprinzip-2026-08.md`,
  `design/mdid-bindung-2026-08.md`,
  `design/visibility-review1-2026-08.md`,
  `design/visibility-review2-2026-08.md`.
