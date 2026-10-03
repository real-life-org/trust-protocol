# RLTP Network Visibility

**Real Life Trust Protocol — cross-cutting: Network Visibility**

- **Status:** Editor's Draft
- **Version:** 0.9.0-draft (ninth casting)
- **Editors:** Anton Tranelis
- **Date:** 2026-08-23
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Conformance profile:** `rltp-visibility@0.9` (draft). Wire
  artifacts: `star@1` · `grade-declaration@1` · `anchor-mapping@2` ·
  `self-card@1` · `continuity-probe@1` · `continuity-mapping@1` ·
  `introduction-request@1` · `introduction-reply@1` ·
  `introduction-ack@1` · `introduction-voucher@1`.
- **Companions (pinned):** **Identity 0.11** (`pair/` registry §6.1 —
  REQUIRED) · **Encounter 0.26** (fresh-always enactment, wire 0.24 —
  §6a here is the other half of its §4.4) · Access 0.25 · Membership
  0.11 (read-only; their recast is the M-DID loop). Delivery 0.17 is
  consumed with an open registration debt (8.1).
- **Supersedes:** versions 0.8–0.1 (archived under
  `archive/network-visibility-*.md`).
- **Source material:** `design/visibility-publikumsprinzip-2026-08.md`
  · `design/mdid-bindung-2026-08.md` ·
  `design/visibility-review1/2-2026-08.md` ·
  `design/joint-pair-seam-review1…6-2026-08.md` (all round-6
  findings answered by this casting).

## Abstract

This document specifies who gets to see what about the edges of the
trust graph: which artifacts are provable to whom (the audience
principle), how knowledge about one's contacts may travel (the
star), how anchors of one person are linked for exactly one
addressee (anchor mapping), how one relationship persists across
fresh-anchor enactments (continuity), and how strangers become
contacts (the introduction act).

Its central commitment: **links between anchors are the protected
good.** Everything here is cryptographically authenticated, but only
artifacts whose purpose is presentation are transferably signed.
Everything else convinces exactly its addressee and no one further.

## Status of This Document

Ninth casting, answering joint round 6 — and, on the round's meta
finding, produced as a **complete rewrite** rather than an edit:
rounds 4–6 each caught sentences from superseded machinery
surviving next to their replacements. Substantially new against
0.8: chaining's single trigger is stated once, in one place, with
no competing generic rule (6.4/6a.4); acts carry `issuedAt` and an
absolute lifetime so replays are rejectable statelessly and
tombstones are bounded (8.1, 8.2); the act lifecycle is defined
**per role** — no globally shared terminal state is claimed,
because none can exist in a distributed act (8.1); mapping
verification is decoupled from a prior own probe match (6a.4); and
the theft-window statement matches the pin mechanics (8.1, §10).

The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted
as described in BCP 14 (RFC 2119, RFC 8174) when, and only when,
they appear in all capitals.

## 1. Introduction (informative)

The founding incident: Hans has one contact, Peter. One trust act
of Peter's delivered three foreign self anchors to Hans as
"unknown" contacts — people who never met Hans and never chose him.

An anchor is a capability: a tag test key, a correlation point, a
recognition mark. Deniability of a relationship claim does not
protect the anchor itself — a data collector buys keys, not claims.
The rule this document enforces everywhere:

> **Whoever issues an anchor decides, per recipient, who gets to
> see it.** No holder of my anchor may forward it on my behalf.

Consequence, decided for the whole protocol: **there are exactly
two ways to gain a new contact — a real-life encounter (Encounter
0.26) or the introduction act (Section 8).** No artifact of this
document transports a **standing** anchor of a third party to
anyone. Fresh anchors created by their own issuers for a new
relationship are the rule working, not an exception to it.

## 2. Terminology

- **Anchor** — a context identifier of an identity (Identity 0.11
  §5, §6): the self context, or a `pair/…`, `group/…`, `persona/…`
  context.
- **Anchor classes (DTGWG-aligned naming):** **R-DID** =
  pair-context anchor (pairwise, no correlation) · **P-DID** =
  persona anchor (intentional correlation) · **S-DID** = the self
  anchor — the stable coordinate across a person's relationships,
  disclosed selectively per recipient (RLTP's extension to the
  DTGWG ladder) · **M-DID** names the *class* "per-community member
  identifier"; membership currently binds the S-DID, and the
  group-context anchor becoming a true M-DID is a confirmed
  direction with open semantics (9.4).
- **Promotion** — the trust act of a holder toward one of their
  contacts; the UI surface of promotion and of S-DID disclosure is
  the **Trust** act.
- **Star** — the artifact by which a sender lets one recipient
  relate the sender's contact set to the recipient's own (Section
  5).
- **Deliverable set** — for one recipient: the contacts who have
  promoted the sender, each under its effective grade (5.5).
- **Tuple** — the pair `(own pair anchor, counterpart pair anchor)`
  of one enactment or introduction. Fresh-always enactment creates
  a fresh tuple every time.
- **Relationship** — a holder-local chain of tuples with exactly
  one **active head** (6.4). Per-tuple state: star salts, probe
  sequences, grade revisions, mapping state. Chain-level facts:
  provenance, evidence accumulation, contact memory.
- **Record side** — of one fresh tuple: the party whose new pair
  anchor is lexicographically smaller (byte order of the `did:key`
  strings); deterministic, known to both the moment the tuple
  exists (6a.4).
- **Act** — one run of the introduction protocol, identified by
  (act id, `issuedAt`), with per-role lifecycles and an absolute
  lifetime (8.1).
- **Resolver class** — of one *publication*: the set of parties
  able to make use of that publication (Section 4).
- **Audience class** — P, V, or D per Section 3, assigned per
  artifact, never per act.
- **DV** — designated-verifier: verifiable only with the
  addressee's secrets; the addressee could have forged it; third
  parties cannot even check it.

### 2.1 Common wire conventions (normative)

Every artifact is a JSON document `{ "body": { … }, "proof":
{ … } }`.

- **body** carries `type` (the versioned artifact name) and the
  fields its schema closes. **Unknown members anywhere MUST be
  rejected** — every schema is closed.
- **proof** carries exactly the members the type names: `mac`,
  `mac1` + `mac2`, or `proofValue`.
- **Canonical bytes** are `JCS(body)` (RFC 8785) — the body object
  only, never the envelope, never the proof.
- **Signatures** (`proofValue`) are **raw Ed25519 over the
  canonical bytes** (RFC 8032), encoded `z` + base58btc (65–89
  characters). Stated plainly: this is not a W3C Data Integrity
  suite; Encounter cards keep their own DI proofs — two artifact
  families, deliberately distinct.
- **MAC** is HMAC-SHA-256 over the canonical bytes; encoded `u` +
  43 unpadded base64url characters (44 characters in total).
- **KDF** is HKDF-SHA-256, salt empty, output 32 bytes,
  exact-ASCII info strings.
- **ECDH** is X25519 over Identity §5.2 key-agreement keys; an
  all-zero shared secret MUST be rejected before key derivation.
- **Anchor bytes** are the UTF-8 bytes of the anchor's `did:key`
  string.
- **Timestamps** (`issuedAt`) are UTC RFC 3339 `Z` form, at most
  three fractional digits. **Time comparisons of this document**
  (act lifetime and ack windows, 8.1/8.4) truncate every operand,
  including `now`, to whole seconds toward the past, and every
  tolerance widens acceptance — this document's own rule, stated
  here because Encounter §2.3's comparison rule explicitly does
  not reach into companions' own windows.
- **Integers on the wire** (`salt`, `seq`, `probe`, `revision`,
  `count`) are JSON strings: base-10, no leading zeros, no sign,
  no exponent, **at most 18 digits** (domain 0 … 10¹⁸−1; `salt`,
  `seq`, `probe`, `revision` ≥ 1; `count` ≥ 0). The schema pattern
  enforces the full domain — schema and prose admit the same set.
- **Multibase canonicality:** every `u…`/`z…` value MUST re-encode
  byte-identically; a value whose canonical re-encoding differs is
  malformed. Equality of MACs, act ids, and digests is byte
  equality of canonical encodings.
- A consumer MUST reject any `type` it does not implement —
  explicitly including `anchor-mapping@1` and every unknown
  version. There is no version negotiation.

## 3. The audience principle (normative)

For every artifact, two questions decide its cryptographic form:
**(F1)** whom must the statement convince for its purpose to be
fulfilled? **(F2)** must the recipient be able to pass it on?
Provability MUST be the smallest set the purpose demands. The
default is deniable (DV); a transferable signature is the exception
that carries the burden of justification.

- **Class P (presentable).** Statements about myself whose purpose
  is showing: persona profile (audience: everyone), membership
  document (audience: roster readers), the self card and the
  contact card (audience: the parties I hand them to — addressing
  material). Transferably signed. Only class-P artifacts are called
  **credentials** or cards.
- **Class V (links).** Every statement that **connects two contexts
  of one person**: the anchor mapping, the continuity mapping,
  group mappings, the introduction voucher. Always DV; a
  cross-context link MUST NOT exist anywhere as a transferable
  proof. **Boundary, stated precisely:** a key binding *within* one
  context (the self card — Ed and X key of the same context) is not
  a link; it is class P with the possession residue Section 11
  names.
- **Class D (statements about third parties).** Stars, continuity
  probes, and introduction requests. The proof axis is not enough,
  because the knowledge itself harms (the collector argument);
  class D therefore adds content grading/blinding (Sections 5, 6a).

Authentication and audience are orthogonal: every artifact travels
end-to-end encrypted and channel-authenticated.

## 4. The publication-space rule (normative)

Principle (register no. 2), total and decidable:

1. **Scope.** The rule governs class-V and class-D artifacts and
   every publication of a standing artifact into a shared context.
   **Class-P artifacts are exempt by class**: their audience is
   declared by their purpose (a persona surface is deliberately
   unbounded; a card is handed, not published), and handing them is
   an issuance act under Section 3, not a publication under this
   rule.
2. **Candidate spaces**, closed list, with member sets: a **group
   space** (members: the group's current members per
   Access/Membership at the snapshot) · a **pair channel** (members:
   the two relationship parties) · a **persona surface** (members:
   unbounded — admissible only for class P).
3. **Snapshot.** The resolver class of a publication is evaluated
   at publication time. Later growth obliges nothing (register
   no. 5); later shrinkage is the space's own epoch/rekey business
   (Access), never the artifact's.
4. **Choice.** The publisher MUST choose a candidate space that
   contains the resolver class and is minimal by member-set
   inclusion among candidates that do. Where several incomparable
   minimal spaces exist, the publisher MAY choose any one; each
   further space is a fresh publication decision.
5. **Transport is not publication.** A delivered artifact is
   governed by its addressee binding, not by this rule.

Applied: a group member's self-anchor tag is published into the
group space — its resolver class (co-members holding that anchor)
lies within the group at publication time. World publication of
that tag is a violation.

## 5. The star (normative)

### 5.1 Standing contents: count or blinded — nothing else

A star carries, per affected contact, one of exactly two standing
forms:

- **Count** — inclusion only in the aggregate number. No anchor or
  intersection leak; cardinality and delivery metadata remain
  (Section 11). Freely claimable, therefore zero credibility.
- **Blinded** — the anchor travels as `HMAC(k, anchor bytes)` under
  the delivery key of 5.2.

A raw third-party anchor MUST NOT appear in any star. There is no
standing "show" grade: disclosure of an anchor to a stranger
happens only as the introduction act (Section 8). An implementation
that emits raw third-party anchors in a star is nonconformant.
`count` is the number of **all** deliverable contacts (count-graded
and blinded-graded together); the assembled union of `blinded[]` is
the blinded-graded subset, so `|union| ≤ count` is the consistency
rule (5.2a). Duplicate entries MUST NOT be emitted; the union is
globally sorted (5.2a).

### 5.2 star@1 — directional epochal blinding

Body: `{ "type": "star@1", "salt": <int-string>, "seq":
<int-string>, "last": <boolean>, "count": <int-string>, "blinded":
[ <mac encoding> … ] }`. Proof: `mac` under `k` — the same key
blinds and authenticates; the artifact stays recipient-forgeable by
construction.

- `salt` is the delivery sequence of this relationship
  **direction**: starting at 1, strictly increasing, persisted
  **atomically before** send. After state loss, a sender without a
  recovered high-water mark from its synchronized state MUST NOT
  resume delivery under the old tuple — the subscription re-forms
  on the relationship's next tuple (6.4), never by guessing.
- The recipient MUST persist, atomically and per tuple, the highest
  **completed** salt, and MUST reject any delivery whose `salt` is
  not strictly greater.
- **Directional key:** `k = HKDF(ikm = X25519(pairX_sender,
  pairX_recipient), info = "rltp/visibility/blind/star/" ||
  senderPairAnchor || "/" || recipientPairAnchor || "/" || salt)`
  with both anchors as anchor bytes and `salt` in its wire string
  form. The two directions of one relationship never share a key.

Properties, with their honest limits:

- **Intersection only:** the recipient can test entries against
  anchors it legitimately holds; no new anchor reaches it.
- **No veracity.** The star is a **claim by the sender**: the
  sender knows `k` and can omit, fabricate, or equivocate entries
  per recipient. A hit proves that both parties **hold** the
  anchor — nothing about any relationship of the sender.
  Fabricating a hit itself requires holding the target's anchor,
  which is already a capability. Consumers MUST NOT treat a star as
  evidence of the sender's relationships.
- **Collusion:** values under different `k` are not comparable;
  unknown anchors are not extractable or linkable across
  recipients. NOT prevented: colluders pooling *known* anchors and
  keys can enrich retained snapshots by dictionary test.
- **Deniability is free:** a MAC under a shared key.
- **Longitudinal tracking** of opaque entries dies with unique
  directional salts — normative on both sides. Residue: anchors
  learned later remain testable against retained snapshots
  (construction-independent).

### 5.2a Chunking (normative)

One delivery MAY span several chunks under one `salt`: `seq` runs
1…n, exactly one chunk carries `last: true`. Rules:

- A chunk MUST stay within the Delivery Contract's 65 536-byte
  plaintext limit; `blinded[]` per chunk is capped at 1024 entries
  (measured: a maximal 1024-entry chunk serializes to 48 328 bytes
  JCS). There is **no bound on total contacts**.
- **Global order:** the sender sorts the full entry union once,
  lexicographically, and slices it into chunks in order.
- `count` MUST be identical in every chunk of one delivery.
- The recipient assembles per (tuple, salt). A repeated `seq` that
  is **byte-identical** to the held chunk is ignored (delivery
  retries are normal); a repeated `seq` with different bytes
  rejects the delivery. More than one `last`, differing `count`
  values, missing `seq` after `last`, entries out of order across
  the union, duplicates across chunks, or `|union| > count` reject
  the delivery.
- **One open assembly per tuple:** a chunk with a higher `salt`
  discards any incomplete older assembly. Only a **completed**
  delivery advances the accepted salt; assembly retention follows
  the Delivery Contract's retention rules. Withholding `last`
  starves that delivery and occupies the single assembly slot until
  a newer salt arrives — nothing else.

### 5.3 The star MUST NOT be signed

A transferable signature would make "these values are this
person's circle" provable to third parties once `k` leaks.
Forgeability is a requirement, not a defect. Credibility beyond the
addressee, if ever needed, is a DV-ZK predicate (9.3), never a
signature.

### 5.4 Subscription — delivery on set change only

A sender MUST deliver a new star when and only when the deliverable
set for that recipient changes: a new promotion of the sender, an
effective-grade change, a departure. A new encounter that does not
change the deliverable set MUST NOT trigger delivery — the event
itself is metadata the subscription must not broadcast. Pausing
stops future deliveries; delivered snapshots remain (revocation of
distribution, not of possession).

**Transition atomicity:** when a promotion creates a new
deliverable contact, the sender MUST deliver exactly one star for
that change: after the contact's grade declaration is verified, or
after the declaration window `grade-wait = PT24H` elapses (then
under the fail-closed grade). No interim delivery under a
provisional grade.

### 5.5 grade-declaration@1 — DV, fail-closed, threat model stated

The count/blinded choice belongs to the affected contact and
travels as a DV artifact to the holder.

Body: `{ "type": "grade-declaration@1", "subject": <affected pair
anchor toward the holder>, "holder": <holder's pair anchor toward
the subject>, "grade": "count" | "blinded", "revision":
<int-string>, "issuedAt": <timestamp> }`. Proof: `mac` under
`k = HKDF(ECDH(pairX_subject, pairX_holder),
"rltp/visibility/mac/grade/" || subjectPairAnchor || "/" ||
holderPairAnchor)`.

- Revision scope and rules per 6.4 (generic rule).
- **Effective grade:** the grade of the highest verified revision;
  absent any verified declaration — none received, MAC failure,
  unknown version — **count**.
- **Threat model, stated honestly (this is DV):** the holder is the
  designated verifier and can compute every MAC — the declaration
  does not and cannot constrain a malicious holder. What it
  provides: third parties cannot fabricate or verify declarations,
  and an honest holder cannot be confused about the subject's
  choice by transport tampering (fail-closed default plus the
  equivocation rule). Against a malicious holder the protection is
  structural: the star travels only to the holder's own recipients
  and carries no veracity (5.2). Suppression: withholding a newer
  revision keeps the older verified state active (initially count).

The default experience remains one human question: the **Trust**
act issues `grade: "blinded"` — the spec offers the granularity,
the default UX collapses it (register no. 3).

## 6. Anchor mapping (normative)

### 6.1 Purpose and construction

`anchor-mapping@2` links a pair anchor to the self anchor of the
same person for exactly one addressee — a **double-DH MAC
construction in the Signal pattern**, entirely in WebCrypto.

Body: `{ "type": "anchor-mapping@2", "pair": <sender's pair anchor
in this relationship>, "self": <sender's S-DID>, "to": <addressee's
pair anchor in this relationship>, "card": <self-card@1 document,
6.2>, "revision": <int-string>, "issuedAt": <timestamp> }`.

Proof: `mac1` under `k1 = HKDF(ECDH(pairX_sender, pairX_addressee),
"rltp/visibility/mac/map1")` and `mac2` under `k2 =
HKDF(ECDH(selfX_sender, pairX_addressee),
"rltp/visibility/mac/map2")`, both over the canonical bytes.

### 6.2 self-card@1 — binding, not link; residue named

`{ "body": { "type": "self-card@1", "anchor": <S-DID>,
"keyAgreement": <X25519 multikey> }, "proof": { "proofValue":
… } }` — signed raw-Ed25519 under `anchor` per 2.1. It binds the
Ed25519 and X25519 keys of the **same self context**; it links no
two contexts (class boundary, Section 3) — but it is **not
harmless**: it carries the stable anchor and authentic addressing
material. After disclosure, the addressee can pass it on; rule §1
governs issuance, not possession (Section 11).

### 6.3 Verification — the closed condition list

The addressee MUST accept an anchor mapping only if **all** of the
following hold, evaluated in this order; the unclaimability
property exists only as their sum:

1. envelope and schema valid, `type` implemented (2.1);
2. `body.to` equals the addressee's **own active pair anchor** of
   the relationship the mapping arrived on;
3. `body.pair` equals the **counterpart's pair anchor** of that
   same tuple, as held from the ceremony or introduction;
4. `card` verifies as `self-card@1` under **its own** `anchor`;
5. `card.anchor == body.self` — the card is the claimed self, not
   merely *a* valid card;
6. `k2` is derived from **`card.keyAgreement`** — the key the card
   binds, never a key claimed elsewhere;
7. both ECDH outputs are non-zero; both MACs verify;
8. `revision` per 6.4.

With 2–7 in place: foreign self anchors are unclaimable (the card
is unsignable, `k2` uncomputable), the addressee can still forge
the whole artifact (deniability preserved), and third parties can
verify nothing.

## 6.4 Tuples, chains, revisions — the relationship lifecycle (normative)

**State is per tuple.** Star salts, probe sequences, grade
revisions, and mapping state are indexed by tuple. An artifact
addressed to a pair anchor that is not the active head of any
current relationship MUST be rejected — with exactly two
exceptions: **(a)** continuity verification reads *prior* tuples by
design (6a.4), and **(b)** artifacts of an introduction act pinned
to a tuple before its deactivation remain verifiable under the
pinned keys for the act's bounded lifetime (8.1); the pin freezes
keys, not state, and dies with the act.

**Chaining has exactly one trigger, defined in 6a.4 and nowhere
else.** The record side chains atomically with issuing its choice;
the non-record side chains exactly on verifying the record side's
mapping. **No other event chains** — in particular, receiving a
continuity mapping from the *non-record* side never chains
anything (it is a match report, 6a.4). A chain append is atomic
with the deactivation of the prior head and MUST be persisted
before acted upon. Deactivated tuples accept no new artifacts
(exceptions above). Per-tuple state does not migrate: grade and
star begin fail-closed on the new tuple; provenance and evidence
are chain facts and carry over (8.6).

**Reset.** A party that cannot answer the continuity probe is,
protocol-wise, a new relationship (Identity §9.3: re-created, not
recovered). Old mappings die with their tuples and cannot be
re-attached.

**The generic revision rule** for every revisioned type (grade
declaration, anchor mapping, continuity mapping), within its
scope: a higher revision wins; an equal revision with
JCS-identical body is idempotent (a repeat, ignored — which is
also what makes resends harmless); an equal revision with a
different body is an **equivocation error** — reject and keep
current state; a lower revision is rejected. Scopes: grade per
(subject, holder) tuple · anchor mapping per (pair, to) — `self`
is content, correctable by higher revision · continuity mapping
per (next, to) per sender — `prior` is content, and **for the
record side it is frozen**: a record-side mapping whose `prior`
differs from that side's first verified mapping for the same
(next, to) is an equivocation error **whatever its revision**
(6a.4); the non-record side may re-issue with a higher revision to
align.

## 6a. Continuity (normative — the other half of Encounter §4.4)

Fresh-always enactment means every ceremony creates a fresh tuple.
Whether it was a **re-encounter** is resolved here, after the
ceremony — automatically, with no user dialog and no
pre-selection.

### 6a.1 The ladder (normative order)

1. **The probe (6a.2–6a.4) is the normative core** — the default
   path, run on every enactment. It recognizes via shared pair
   history, before and independent of any disclosure decision.
2. **The S-DID convergence net:** where continuity did not
   complete, a later verified `anchor-mapping@2` whose `self`
   equals the `self` held on another relationship merges the two
   chains — a holder-local act of the addressee, no wire artifact.
3. **The manual fallback:** the human merges contact entries
   locally (the data-loss case; contact memory is local anyway).

An implementation MUST support 1 and 2; 3 is a UI concern, named
for honesty.

### 6a.2 continuity-probe@1 — sequenced, chunked, padded, blinded

Sent by either party (SHOULD by both) after enactment completion.
Body: `{ "type": "continuity-probe@1", "probe": <int-string>,
"seq": <int-string>, "last": <boolean>, "blinded": [ exactly 256
entries ] }`; proof: `mac` under `k_p`.

- `probe` is the probe sequence of this tuple direction — the
  exact analogue of the star's `salt`, on both sides: starting at
  1, strictly increasing, persisted atomically before send; the
  recipient MUST persist, atomically and per tuple, the highest
  **completed** probe and MUST reject any delivery whose `probe`
  is not strictly greater. A **resend is always a fresh `probe`
  sequence with freshly sampled padding** — a sender never
  reproduces old chunks.
- `k_p = HKDF(X25519(newPairX_sender, newPairX_recipient),
  "rltp/visibility/blind/probe/" || senderNewPair || "/" ||
  recipientNewPair)`.
- Entries: `HMAC(k_p, ownPriorPairAnchor bytes)` for the sender's
  own pair anchors of the **active heads** of every relationship
  it holds (deactivated links are reachable through their chain's
  head and MUST NOT be probed).
- **Global padding and order:** the sender pads the full entry set
  with random 32-byte values encoded like MACs up to the next
  multiple of 256, sorts the padded union lexicographically once,
  and slices it into 256-entry chunks in order (`seq` 1…n, exactly
  one `last`), using the **minimal** number of chunks —
  pure-padding chunks beyond the minimum MUST NOT be sent. On the
  (cryptographically negligible) collision of a padding value with
  any other value, the padding value is resampled. **A sender with
  zero prior relationships MUST still send one all-padding probe**
  — otherwise the absence of a probe would leak the cardinality
  "zero".
- Chunk assembly per (tuple, probe) follows the 5.2a rules with
  `probe` in the salt role (byte-identical repeats ignored,
  conflicts reject, one open assembly per tuple, higher `probe`
  discards an open older assembly).
- The recipient computes `HMAC(k_p, counterpartAnchor)` for each
  counterpart anchor it holds and intersects with the assembled
  union. Matches identify shared prior relationships; zero matches
  identifies a new contact. Cardinality is quantized to the
  minimal chunk count toward a matched counterpart and hidden
  entirely from strangers.

### 6a.3 Carrier, the offline path, and the resend duties

Probe and mapping travel as sealed deliveries **on the same
channel as the enactment bundle**; their task registration shares
the introduction tasks' registration debt (8.1). On the
**optical** enactment path (no delivery service), the probe is
**pending**: until it runs, the tuple is honestly an unchained
relationship. The standing duties, all MUST, all "on next
available delivery contact of that tuple":

- a pending probe is sent (fresh sequence);
- an unanswered probe situation is retried (fresh sequence);
- a continuity mapping that has not been answered by the
  counterpart's aligned mapping is resent (same revision —
  idempotent by 6.4);
- the alignment duty of 6a.4 is discharged.

A one-sided chain is therefore a legal transitional state, never a
terminal one while contact exists; without further contact, two
honestly unchained relationships remain — which is the truthful
description of that situation.

### 6a.4 continuity-mapping@1 — one chooser, one trigger

Body: `{ "type": "continuity-mapping@1", "prior": <own prior pair
anchor>, "next": <own new pair anchor>, "to": <counterpart's new
pair anchor>, "revision": <int-string>, "issuedAt": <timestamp> }`;
`mac1` under the **prior** relationship key
(`HKDF(ECDH(priorPairX_sender, priorPairX_addressee),
"rltp/visibility/mac/cont1")`), `mac2` under the **new**
relationship key (`…/cont2`).

**The machine — one chooser, one final choice, one trigger:**

- **The record side chooses once, finally.** Its first verified
  continuity mapping for a given (next, to) is its choice forever
  (6.4: a differing later `prior` from the record side is an
  equivocation error whatever its revision). The record side
  chooses freely among its matches — the app may prefer the chain
  with the richer history; it never needs to re-align, so its
  choice may and MUST freeze. Choice-flapping is structurally
  invalid.
- **Chaining is triggered only as follows.** The record side
  chains atomically with issuing its choice. The non-record side
  chains **only** on verifying the record side's mapping. A
  mapping received *from* the non-record side is a **match
  report**: it tells the record side "I recognize these prior
  relationships" and MAY inform its choice — it MUST NOT cause
  chaining on any side.
- **Alignment duty (MUST).** On verifying the record side's
  mapping, the non-record side MUST send its own mapping naming
  its prior anchor on the record-chosen relationship (a higher
  revision where an unaligned match report exists — the re-issue
  changes its outbound claim, never its local graph, which follows
  the record side's mapping).

**Verification** of a received continuity mapping, in order —
**a prior own probe match is NOT a precondition** (this is what
keeps both loss directions terminating):

1. envelope and schema valid, `type` implemented (2.1);
2. `to` == own new pair anchor of the fresh tuple the mapping
   arrived on;
3. `next` == the counterpart's new pair anchor of that tuple;
4. `prior` == a counterpart pair anchor the receiver **holds** on
   some tuple of one of its relationships (any chain position —
   6.4 exception (a); holding it is the evidence, no probe match
   required);
5. both ECDH outputs non-zero; `mac1` verifies under the prior
   relationship key, `mac2` under the new — only the same **key
   controller** can compute both (a stolen, still-active old
   device is a key controller: Identity §11 grades takeover
   resistance under operational key possession as *none*;
   succession, not this artifact, is the remedy);
6. `revision` per 6.4 (including the record-freeze rule).

The addressee can forge the whole artifact (class V, deniable);
third parties cannot verify. On verification of a **record-side**
mapping, chain per 6.4 and discharge the alignment duty. After a
verified match, a party MAY re-send its existing
`anchor-mapping@2` (self disclosure) on the new tuple without a
fresh user decision: the addressee already holds the self anchor —
re-delivery to the same holder, register no. 5.

**Termination:** matching requires only that **some** probe
arrived — the record side can match against the non-record side's
probe (or its match report) and choose, whichever probe was lost;
the 6a.3 duties guarantee progress in both loss directions. With
one chooser, one final choice, and one trigger, every flow ends
with both sides chained to the record-chosen relationship, or
honestly unchained pending transport.

### 6a.5 What this buys (informative)

The probe is the third member of one family — star, mapping, probe
are all blinded values under relationship keys. UX: a re-encounter
shows "re-verified" a round-trip after the scan, with no dialog; a
data-loss counterpart cannot answer and is honestly a new
relationship; a wrong scanner learns nothing.

## 7. Relational counts (normative principle, artifact unwritten)

Anchors are free; a Sybil swarm issues itself arbitrary
self-evidence. The scarce resource is the **boundary edge** into
the honest graph. Count and personhood statements MUST be anchored
relationally — "≥ N, of which k inside the verifier's trust
horizon" — never absolutely; the blinded star supplies the
verifier-side test instrument. Global per-everyone scores are
either forgeable or central; both are rejected. **The proof
artifact is deliberately unwritten** (it needs 9.2's substrate);
until it exists, relational counts are a design constraint on
consuming layers, marked state-dependent in Section 12.

## 8. The introduction act (normative)

Principle: **the mediator transfers messages, never standing
anchors.** The fresh pair anchors of the act are issued by their
own owners for the new relationship — issuance, not forwarding.

### 8.1 Precondition, carrier, pins, and the per-role lifecycle

**Precondition (normative):** the requester and the mediator, and
the target and the mediator, each already share a pair
relationship — the mediator is a *contact* of both. **The
relationship anchors never appear in any act body**: each leg
rides its delivery channel, and that transport tuple is the
binding — known to both ends of the channel, shown to no one else.

**Carrier:** four sealed Delivery tasks (payload schemas
`schemas/visibility-payload-*.schema.json`): `introduction-request`
(requester → mediator: `{ introduction, card }`, receiver checks
`cardDigest` == multihash of `JCS(card)`) ·
`introduction-forward` (mediator → target: the byte-identical
`introduction` and `card`; the target verifies the request
signature under the card's anchor, the digest, and — over its own
channel to the mediator — that `target` designates itself; consent
is the target's local act) · `introduction-reply` (target →
mediator → requester: `{ introduction, card }`, same digest rule,
forwarded unchanged) · `introduction-ack` (mediator → requester,
8.4). **Registration debt, stated honestly:** these task names —
and the continuity tasks of 6a.3 — live in the Delivery Contract's
registry; registering them is part of the declared Delivery
re-pin recast (Encounter §12). Until that lands, the carrier is
specified but unconsumable.

**Act identity and absolute lifetime:** an act is identified by
(act id, `issuedAt` of the request). **No artifact of an act may
be produced or accepted after `issuedAt + act-expiry`**, with
`act-expiry = PT72H`, a fixed parameter of this profile, compared
per 2.1's truncation rule with tolerance `act-skew = PT5M`
(widening acceptance only). This bound is stateless: a replayed
request older than the window is rejected from its own bytes, so
duplicate-act tombstones are needed only inside the window —
bounded state. Within the window, a request whose act id is held
in any per-role state (below) MUST be treated as a duplicate
(byte-identical: re-deliver the existing ack; different bytes:
reject).

**Pins:** the requester pins the act to its requester↔mediator
tuple **at send** (its active head then); the mediator pins to
the arrival tuple **at arrival**, and to its mediator↔target
tuple at forward; the target pins at forward arrival. Every act
artifact uses the pinned tuples' keys. Pins die with the role's
terminal state or the absolute lifetime, whichever is first;
after that, act artifacts under the pinned keys MUST be rejected
and act state SHOULD be discarded (the window bound above keeps
rejection possible without it).

**Per-role lifecycles (normative; there is deliberately no global
act state — a distributed act has none):**

- **Requester:** `sent` → `acked` (ack verified) → `completed`
  (reply verified) · → `failed` (ack timeout per 8.4, or reply
  timeout `act-expiry`) · → `expired` (absolute).
- **Mediator:** `received` (checks passed, pin set, ack scheduled)
  → `forwarded` → `completed` (reply forwarded) · → `rejected`
  (checks failed — where the arrival channel was inactive, no ack
  key exists and the drop is artifact-free, the one honest
  unacknowledged case) · → `expired`.
- **Target:** `received` → `consented` (reply sent) · `refused`
  (local, silent — refusal privacy) · → `expired`.

Divergence between roles is possible and named — a transport
adversary can hold the mediator at `completed` and the requester
at `failed`; neither is nonconformant (8.4's verdict rule), and
the requester's retry as a **new act** converges the outcome.

**Mediator checks (normative, in order):** (1) arrival on an
active relationship channel (pin; else artifact-free drop); (2)
schema, digest, signature, `issuedAt` window; (3) `target`
resolves in the mediator's namespace; forward on the active
mediator↔target channel.

### 8.2 Artifacts

`introduction-request@1` body: `{ type, act: <32-byte random,
u-base64url 43 chars>, issuedAt: <timestamp>, target: <opaque
designator, 8.3>, cardDigest: <multibase multihash of JCS(card)>,
profile: <closed object: displayName ≤ 64, note ≤ 256> }`,
`proofValue` under the fresh card's anchor (raw Ed25519, 2.1). The
body names **no mediator anchor and no existing relationship**.

`introduction-reply@1` body: `{ type, act, requestDigest:
<multibase multihash of JCS(request body)>, requesterPair: <the
card anchor from step 1>, cardDigest: <digest of the target's
fresh card> }`, signed under the target's fresh card anchor.
`requestDigest` binds the reply to exactly one request — reply
splicing across requests breaks the signature.

### 8.3 The target designator

`target` is an opaque string, `u`-base64url, **at most 343
characters** (≤ 256 payload bytes), minted in the mediator's own
namespace. Requirements: stable per (mediator, target) at least
for the act's lifetime; resolvable by the mediator to a
deliverable party; verifiable by the **target**, over its own
channel to the mediator, as designating itself before consenting.
It carries no global meaning and MUST NOT be built from any
anchor.

### 8.4 introduction-ack@1 — uniform, pinned, total verdict

Body `{ type, act }` — no other member exists in the schema.
Proof: `mac` under `k = HKDF(ECDH(pairX_mediator,
pairX_requester), "rltp/visibility/mac/ack")` — the keys of the
act's **pinned** requester↔mediator tuple (8.1). The mediator MUST
send exactly one ack per act in `received`, at its declared
constant delay `ack-delay` (a fixed parameter published in the
mediator's task registration entry, not adaptive), **identically
for existing, refusing, unknown, and expired targets**. The
requester verifies MAC (pinned tuple) and act id.

**The verdict rule is total and honest about divided state:** a
second or malformed ack is a mediator conformance failure. A
*missing* ack after `ack-delay + act-skew` (2.1 comparison) moves
the act to `failed` at the requester — terminal: a retry MUST be a
**new act** (fresh act id, fresh `issuedAt`, fresh request), and a
late ack of the failed act MUST be ignored. Missing acks are a
mediator conformance failure only where the request demonstrably
arrived on a channel active *at the mediator*; one-sided chain
divergence makes both parties individually correct, and the retry
converges them.

### 8.5 The voucher — bound to the held act

`introduction-voucher@1` body `{ type, act, requesterPair,
targetPair }`; two artifacts, one per side, `mac` under
`HKDF(ECDH(pairX_mediator, pairX_side),
"rltp/visibility/mac/voucher")`, where the keys are those of the
act's **pinned** channel tuple with that side (8.1). A recipient
MUST accept a voucher only if it holds the act locally (within the
act's lifetime) and `requesterPair`/`targetPair` match its held
request/reply artifacts of that act — a valid MAC over unheld
values is not a voucher of anything.

### 8.6 Provenance (normative)

Every relationship carries a local attribute `provenance ∈
{ "encounter", "introduction" }` — a chain fact (6.4). An
introduction sets `introduction`; the first completed enactment
chained onto the relationship upgrades it to `encounter` — exactly
then, never downward. UI wording ("◇ verified via <mediator>" /
"⇄ verified") is informative; the attribute and its transition are
normative.

### 8.7 What the binding buys — and what it cannot

Signatures over act-bound bodies remove card substitution and act
splicing: a mediator cannot swap cards between acts or splice
half-relationships — any altered body breaks a signature whose key
it does not hold. What remains, stated honestly: a mediator can
still **be** an endpoint — fabricate an act in which it plays the
target, or run two acts posing as each side. There is no
cryptographic remedy without a prior relationship; it is why a
mediated relationship carries the weaker provenance, upgradeable
only by a real encounter. Refusal privacy holds at the protocol
surface (uniform ack), not against a talkative mediator; timing
below `ack-delay` resolution remains. UX invariant (one-way-door
rule): acceptance is a button plus sheet, never a toggle; three
devices, three decisions, each at the right party.

## 9. Documented options and open points

### 9.1 Grade ladder beyond two — withdrawn surface

A finer per-recipient ladder was tried in UX and withdrawn
(22.08.); the two-grade declaration of 5.5 is the specified
surface. Reintroduction would extend the `grade` enum in a new
version, nothing structural.

### 9.2 The encounter-credential flank — seam pre-wired with suites

Encounter (0.26) carries `commitment: { suite, value }` with an
initially empty suite registry and a producer emission gate;
assigning meaning is registration in that registry — its own loop.
This document only reserves its consumer role.

### 9.3 Feasibility map for predicates (informative, early 2026)

DV mapping = double-DH MAC (Section 6) · DV-ZK counting predicates
= Sigma-OR (@noble/curves, no audited library) · selective
disclosure / counting = BBS+ (W3C bbs-2023 draft) · general SNARKs
only if predicates outgrow counting and subsets.

### 9.4 M-DID binding of membership — confirmed direction, open semantics

Decision (23.08., `design/mdid-bindung-2026-08.md`): the target
picture is membership bound to the group-context anchor (a true
M-DID), with the S-DID as the private cross-relationship
coordinate disclosed per co-member via the Section 6 pattern
(group→self); the UI surface of that disclosure is the **Trust**
act. Current reality (review finding M5): roster *readers* and
colluding insiders of different groups can correlate S-DID-bound
members across groups, and admission artifacts replicate stable
anchors into group logs permanently. Technically the star is
anchor-agnostic (finding M6). The open questions are semantic:
which anchor class counts as a "contact"; how group-specific hits
on the same person deduplicate without rebuilding the linkability
the change removes; when an M-DID may bind to a relationship. The
change is the Access/Membership recast — a **membership
proof-model** change, not a pin rename (joint finding S-B2) — its
own loop after this document converges.

### 9.5 Standing disclosure (from the architecture map)

Normatively capturing the standing disclosure of one's own edges
to one's own network remains open; until then it is deliberate app
policy ("unrevocable in possession, revocable in distribution,
deniable in derivation").

## 10. Security Considerations

- **Anchor harvesting via stars** — countered structurally: no
  standing raw grade exists (5.1); harvesting apps are
  nonconformant by artifact shape.
- **Grade forgery** — third parties cannot forge or verify
  (relationship-key DV); the malicious holder is outside what DV
  can constrain and is handled structurally (5.5); suppression
  keeps the last verified state, initially count.
- **Salt/probe rollback, reuse, equivocation** — atomic
  persistence both sides, strictly-greater acceptance, directional
  keys; a restoring sender without a high-water mark re-forms on
  the next tuple instead of guessing (5.2, 6a.2).
- **Sender equivocation / fabricated stars** — not preventable and
  normatively de-fanged: stars carry no veracity (5.2).
- **Chunk games** — partial deliveries never advance the accepted
  sequence; byte-identical retries are ignored; one assembly slot
  per tuple bounds recipient state (5.2a).
- **Mapping mis-binding** — closed by the 6.3 condition list; the
  unclaimability claim is defined as the sum of those checks.
- **Mapping downgrade / replay / reset** — version exact-match
  (2.1), tuple-scoped state, generic revision rule with the
  record-freeze (6.4).
- **Probe abuse** — a stranger cannot test candidate anchors:
  entries are HMACs of the *sender's own* anchors under a key
  bound to this fresh tuple; replay into another tuple fails
  (`k_p` binds both new anchors); fixed 256-entry chunks quantize
  cardinality; padding is indistinguishable without a matching
  held anchor.
- **Continuity choice-flapping** — structurally invalid: the
  record side's choice freezes at first verified issue (6.4,
  6a.4).
- **Continuity hijack by key theft** — a stolen, still-active old
  device is a *key controller* and can continue a chain (6a.4);
  Identity §11 grades this as *none* under operational key
  possession. **The exposure window, stated per phase:** starting
  a new act or answering a probe requires the stolen tuple to
  still be an active head; artifacts of an act already pinned to
  the stolen tuple remain valid until that act's own terminal
  state, bounded by `issuedAt + act-expiry` (8.1). Succession —
  not this artifact — is the remedy.
- **Act replay** — stateless rejection outside the `issuedAt`
  window; duplicate handling inside the window via per-role state
  (8.1). Late acks of failed acts are ignored (8.4).
- **Introduction MITM** — card-digest binding plus `requestDigest`
  remove substitution and splicing; the mediator-as-endpoint
  residue is irreducible and carried in provenance (8.6, 8.7).
- **Sybil self-evidence** — relational anchoring mandatory
  (Section 7); the verifier's own holdings are ground truth.

## 11. Privacy Considerations

- **The one-bit oracle is the feature.** A star recipient can test
  every anchor it legitimately holds — including future ones —
  against retained snapshots: offline, unthrottled, forever.
  Remedies: the count grade (fail-closed initial), pausing
  (distribution, not possession — register no. 5).
- **Counts and deliveries are metadata.** Cardinality, churn, and
  delivery timing leak; 5.4 restricts delivery events to actual
  set changes so encounters as such are not broadcast; probe
  chunking quantizes contact cardinality to 256er steps toward a
  matched counterpart and hides it entirely from strangers.
- **Possession residue of the self card** (6.2): after disclosure,
  the card is transferable addressing material; §1 is issuance
  control, not recall.
- **Membership correlation at true size** (9.4): roster readers
  and colluding insiders, permanent log replication — the standing
  motivation of the M-DID direction.
- **What a matched counterpart learns** (6a): "we share this prior
  relationship" — exactly the fact being established, per the
  consent embodied in completing the ceremony together.
- **Refusal privacy** holds at the protocol surface (8.4, 8.7), no
  further; the target's `refused` state is deliberately silent.
- **Third parties** cannot even verify class-V artifacts —
  stronger than deniability alone.

## 12. Conformance

A conformant implementation:

1. emits no raw third-party anchor in any artifact of this
   document (5.1, 8.1) — vector-testable;
2. produces and verifies `star@1` per 5.2/5.2a (directional keys,
   salt and chunk discipline both sides) and never signs it (5.3)
   — vector-testable (`vectors/visibility.json`);
3. delivers exactly on deliverable-set change with transition
   atomicity (5.4) — state-dependent;
4. enforces grade declarations per 5.5 and the generic revision
   rule of 6.4 — vector-testable;
5. verifies `anchor-mapping@2` by the complete 6.3 list —
   vector-testable including the mis-binding negative;
6. emits sequenced, globally-sorted, padded probes and runs the
   6a.4 machine (one chooser, frozen choice, one trigger,
   alignment duty, no probe-match precondition) — vector-testable
   (probe shape, mapping MACs), state-dependent (chain atomicity,
   6a.3 duties);
7. runs the introduction carrier per 8.1–8.5 including the
   precondition, `issuedAt` window, pins, per-role lifecycles,
   digest checks, and the uniform pinned ack with the total
   verdict rule — vector-testable (bindings, ack MAC, stateless
   window rejection), state-dependent (ack uniformity, role
   states);
8. maintains `provenance` per 8.6 — state-dependent;
9. publishes per Section 4 — state-dependent (snapshot rule);
10. treats stars, counts, and probes as non-evidence (5.2, 7) —
    state-dependent consumer rule.

## References

- Identity Layer 0.11 — `spec/identity-layer.md` (§5.2, §6.1,
  §9.3, §11).
- Encounter Layer 0.26 (wire 0.24) — `spec/encounter-layer.md`
  (fresh-always §4.4, commitment §7.2, versioned schemas).
- **Named vector debt:** the introduction payload vectors require
  real Encounter contact cards (DI proofs, `rltp-card/0.24`);
  until Encounter's card vectors exist, `vectors/visibility.json`
  ships the introduction artifacts and bindings but no
  payload-level positive vector — carried openly rather than
  shipping schema-invalid stand-ins.
- RFC 8785 (JCS) · RFC 2104 (HMAC) · RFC 5869 (HKDF) · RFC 7748
  (X25519) · RFC 8032 (Ed25519) · BCP 14.
- Schemas: `schemas/visibility-*.schema.json`,
  `schemas/visibility-payload-*.schema.json`. Vectors:
  `vectors/visibility.json`.
- Design sources and triages as listed in the header.
