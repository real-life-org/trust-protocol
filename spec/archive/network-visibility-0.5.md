# RLTP Network Visibility

**Real Life Trust Protocol — cross-cutting: Network Visibility**

- **Status:** Editor's Draft
- **Version:** 0.5.0-draft (fifth casting)
- **Editors:** Anton Tranelis
- **Date:** 2026-08-23
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Conformance profile:** `rltp-visibility@0.5` (draft). Wire
  artifacts: `star@1` · `grade-declaration@1` · `anchor-mapping@2` ·
  `self-card@1` · `continuity-probe@1` · `continuity-mapping@1` ·
  `introduction-request@1` · `introduction-reply@1` ·
  `introduction-ack@1` · `introduction-voucher@1`.
- **Companions (pinned):** **Identity 0.10** (`pair/` registry §6.1 —
  REQUIRED) · **Encounter 0.25** (fresh-always enactment, wire 0.24 —
  §6a here is the other half of its §4.4) · Access 0.25 · Membership
  0.11 (read-only; their recast is the M-DID loop). Delivery 0.17 is
  consumed with an open registration debt (8.1).
- **Supersedes:** versions 0.4–0.1 (archived under
  `archive/network-visibility-*.md`).
- **Source material:** `design/visibility-publikumsprinzip-2026-08.md`
  · `design/mdid-bindung-2026-08.md` ·
  `design/visibility-review1/2-2026-08.md` ·
  `design/joint-pair-seam-review1/2-2026-08.md` (all joint-round-2
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

Fifth casting, answering joint round 2 in full — and written **out
in full**: round 2 rightly found that 0.4 replaced normative
sections with references to its superseded predecessor; this
casting restores the casting rule (a casting is implementable from
itself). Substance new in 0.5: the continuity ladder with the probe
as normative core (6a), probe chunking (6a.2), the explicit-prior
rule for multiple matches (6a.4), the introduction precondition and
role-bound keys (8.1, 8.4), payload schemas
(`schemas/visibility-payload-*.schema.json`), the 18-digit integer
domain (2.1), and vectors with state fixtures and per-negative
check order (`vectors/visibility.json`). The browser simulator
predates this casting and MUST be aligned; it is a probe, not the
normative source.

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
0.25) or the introduction act (Section 8).** No artifact of this
document transports a **standing** anchor of a third party to
anyone. Fresh anchors created by their own issuers for a new
relationship are the rule working, not an exception to it.

## 2. Terminology

- **Anchor** — a context identifier of an identity (Identity 0.10
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
  one **active head** (6.4). Per-tuple state: star salts, grade
  revisions, mapping state. Chain-level facts: provenance,
  evidence accumulation, contact memory.
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
- **Timestamps** (`issuedAt`) follow Encounter 2.3's `rfc3339utc`
  profile: UTC `Z` form, at most three fractional digits,
  whole-second comparison.
- **Integers on the wire** (`salt`, `seq`, `revision`, `count`) are
  JSON strings: base-10, no leading zeros, no sign, no exponent,
  **at most 18 digits** (domain 0 … 10¹⁸−1; `salt`, `seq`,
  `revision` ≥ 1; `count` ≥ 0). The schema pattern enforces the
  full domain — schema and prose admit the same set.
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
rule (5.2a). Duplicate entries MUST NOT be emitted; entries are
sorted lexicographically within each chunk and across the assembled
union.

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
  form. The two directions of one relationship never share a key,
  whatever their salts.

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
1…n, `last: true` marks the final chunk. Rules:

- A chunk MUST stay within the Delivery Contract's 65 536-byte
  plaintext limit; `blinded[]` per chunk is capped at 1024 entries
  (measured: a maximal 1024-entry chunk serializes to 48 328 bytes
  JCS — ample margin). There is **no bound on total contacts**.
- The recipient assembles per (tuple, salt). A repeated `seq` that
  is **byte-identical** to the held chunk is ignored (delivery
  retries are normal); a repeated `seq` with different bytes
  rejects the delivery. Missing `seq` after `last`, entries out of
  order across the union, duplicates across chunks, or
  `|union| > count` reject the delivery.
- **One open assembly per tuple:** a chunk with a higher `salt`
  discards any incomplete older assembly. Only a **completed**
  delivery advances the accepted salt; assembly retention follows
  the Delivery Contract's retention rules. Withholding `last`
  therefore starves that delivery and occupies the single assembly
  slot until a newer salt arrives — nothing else.

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

- Scope of `revision`: the tuple (subject, holder), monotone.
  Higher revision wins; equal revision with JCS-identical body is
  idempotent; equal revision with a different body is an
  **equivocation error** — reject and keep current state.
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
  and carries no veracity (5.2) — a lying holder is an equivocating
  sender, already in the model. Suppression: withholding a newer
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

The addressee MUST accept a mapping only if **all** of the
following hold; the unclaimability property exists only as the sum
of these checks, evaluated in this order:

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

### 6.4 Tuples, chains, and the relationship lifecycle (normative)

- All mapping, grade, and star state is indexed by **tuple**. A
  mapping naming a pair anchor that is not the active head of any
  current relationship MUST be rejected.
- **Chaining:** a verified continuity mapping (6a) appends the new
  tuple to the relationship's chain and makes it the **active
  head**; the prior tuple is thereby **deactivated** — atomically
  with the append, persisted before acted upon. Deactivated tuples
  accept no new artifacts; their history (credentials, delivered
  snapshots) remains what it is. Per-tuple state does not migrate:
  grade and star begin fail-closed on the new tuple; provenance and
  evidence are chain facts and carry over (8.6).
- **Reset:** a party that cannot answer the continuity probe is,
  protocol-wise, a new relationship (Identity §9.3: re-created, not
  recovered). Old mappings die with their tuples and cannot be
  re-attached; replay of a verified mapping with identical body on
  its own tuple is idempotent and harmless (disclosure is
  irreversible, register no. 5).
- Revision scopes: grade per (subject, holder) tuple ·
  anchor-mapping per (pair, to) — `self` is content, so a wrong
  self claim is correctable by a higher revision · continuity
  mapping per (prior, next, to).

## 6a. Continuity (normative — the other half of Encounter §4.4)

Fresh-always enactment means every ceremony creates a fresh tuple.
Whether it was a **re-encounter** is resolved here, after the
ceremony — automatically, with no user dialog and no
pre-selection.

### 6a.1 The ladder (normative order)

1. **The probe (6a.2–6a.4) is the normative core** — the default
   path, run on every enactment. It recognizes via shared pair
   history, before and independent of any disclosure decision.
2. **The S-DID convergence net:** where a probe was lost or never
   ran, a later verified `anchor-mapping@2` whose `self` equals the
   `self` held on another relationship merges the two chains (the
   holder-local merge is the addressee's act; no wire artifact).
3. **The manual fallback:** the human merges contact entries
   locally (data-loss case; contact memory is local anyway).

An implementation MUST support 1 and 2; 3 is a UI concern, named
for honesty.

### 6a.2 continuity-probe@1 — chunked, padded, blinded

Sent by either party (SHOULD by both) after enactment completion.
Body: `{ "type": "continuity-probe@1", "seq": <int-string>,
"last": <boolean>, "blinded": [ exactly 256 entries ] }`; proof:
`mac` under `k_p`.

- `k_p = HKDF(X25519(newPairX_sender, newPairX_recipient),
  "rltp/visibility/blind/probe/" || senderNewPair || "/" ||
  recipientNewPair)`.
- Entries: `HMAC(k_p, ownPriorPairAnchor bytes)` for **all** of the
  sender's own prior pair anchors (its side of every relationship
  it holds), spread over as many chunks as needed (`seq` 1…n,
  `last` on the final chunk) — **no cap and no ordering
  heuristic**; every prior anchor is always included.
- Every chunk is **padded to exactly 256 entries** with random
  32-byte values encoded like MACs, then sorted; on the
  (cryptographically negligible) collision of a padding value with
  a real entry or another padding value, the padding value MUST be
  resampled. A genuinely new counterpart sees n uniform blocks of
  256 opaque values: cardinality is quantized to the chunk count,
  membership tests are impossible without holding a prior anchor of
  the sender.
- Chunk assembly follows the 5.2a rules (byte-identical repeats
  ignored, conflicts reject, one open assembly per tuple).
- The recipient computes `HMAC(k_p, counterpartAnchor)` for each
  counterpart anchor it holds and intersects with the assembled
  union. Matches identify shared prior relationships; zero matches
  identifies a new contact.

### 6a.3 Carrier and the offline path

Probe and mapping travel as sealed deliveries **on the same channel
as the enactment bundle** (the Delivery Contract leg the ceremony
already used) — their task registration shares the introduction
tasks' registration debt (8.1). On the **optical** enactment path
(no delivery service), the probe is **pending**: until it runs, the
tuple is honestly an unchained relationship — two entries where
there was one. Pending probes are sent on the next available
delivery contact of that tuple; mappings are **idempotently
resendable** (revision rules, 6.4), so a lost mapping is a
repetition, not a wedge, and one-sided chains converge as soon as
either side resends. A one-sided chain is a legal transitional
state, never a terminal one: a conformant party with a pending or
unanswered probe/mapping MUST resend on next contact.

### 6a.4 continuity-mapping@1 — the responder names the prior

On a match, the matching party answers: body `{ "type":
"continuity-mapping@1", "prior": <own prior pair anchor>, "next":
<own new pair anchor>, "to": <counterpart's new pair anchor>,
"revision": <int-string>, "issuedAt": <timestamp> }`; `mac1` under
the **prior** relationship key
(`HKDF(ECDH(priorPairX_sender, priorPairX_addressee),
"rltp/visibility/mac/cont1")`), `mac2` under the **new**
relationship key (`…/cont2`).

- **Multiple matches** (several prior relationships with the same
  counterpart, e.g. after resets): the responder **chooses freely**
  which chain to continue — the app may prefer the chain with the
  richer history — and its choice is **binding through the explicit
  `prior`**: the counterpart chains along the named prior and MUST
  NOT apply its own ordering heuristic. One decider, announced,
  beats two guessers.
- Verification mirrors 6.3, in order: `to` == own new anchor ·
  `prior` == held counterpart anchor of a matched tuple · `next` ==
  counterpart anchor of the fresh tuple · both ECDH non-zero · both
  MACs. mac1 proves control of the old side, mac2 of the new —
  **only the same key controller can compute both** (a stolen,
  still-active old device is a key controller: Identity §11 grades
  takeover resistance under operational key possession as *none*,
  and the exposure window is exactly while the stolen tuple remains
  an active head — succession is the answer, not this artifact).
  The addressee can forge the whole artifact (class V, deniable);
  third parties cannot verify.
- On verification, chain per 6.4. The counterpart SHOULD answer
  with its own mapping in the other direction; until it does, the
  chain is one-sided and 6a.3's resend duty applies.
- After a verified match, a party MAY re-send its existing
  `anchor-mapping@2` (self disclosure) on the new tuple without a
  fresh user decision: the addressee already holds the self anchor
  — re-delivery to the same holder, register no. 5.

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

### 8.1 Precondition, carrier, and the registration debt

**Precondition (normative):** the requester and the mediator, and
the target and the mediator, each already share a pair
relationship — the mediator is a *contact* of both; that is what
being a mediator means. The requester's anchor **toward the
mediator** (`requesterMediatorPair`) is named in the act and is
distinct from the fresh anchor the requester creates for the
target.

The act runs over the Delivery Contract as four sealed tasks
(payload schemas: `schemas/visibility-payload-*.schema.json`):

1. `introduction-request` (requester → mediator): payload `{
   "introduction": <introduction-request@1>, "card": <requester's
   fresh Encounter contact card> }`. The receiver MUST check
   `introduction.body.cardDigest` == multihash of `JCS(card)`.
2. `introduction-forward` (mediator → target): payload
   byte-identical `introduction` and `card`. **The target receives
   the full request and card**, verifies the request signature
   under the card's anchor, the digest, and — over its own channel
   to the mediator — that `target` designates itself (8.3). Consent
   is the target's local act.
3. `introduction-reply` (target → mediator → requester): payload `{
   "introduction": <introduction-reply@1>, "card": <target's fresh
   card> }`, same digest rule; the mediator forwards it unchanged.
4. `introduction-ack` (mediator → requester): payload
   `introduction-ack@1` per 8.4.

**Registration debt, stated honestly:** these task names — and the
continuity tasks of 6a.3 — live in the Delivery Contract's
registry; registering them is part of the declared Delivery re-pin
recast (Encounter §12). Until that lands, the carrier is specified
but unconsumable — the same class of openness Encounter carries,
ending with the same block.

### 8.2 Artifacts

`introduction-request@1` body: `{ type, act: <32-byte random,
u-base64url 43 chars>, mediator: <mediator's pair anchor toward
the requester>, requesterMediatorPair: <requester's pair anchor
toward the mediator>, target: <opaque designator, 8.3>,
cardDigest: <multibase multihash of JCS(card)>, profile: <closed
object: displayName ≤ 64, note ≤ 256> }`, `proofValue` under the
fresh card's anchor (raw Ed25519, 2.1).

`introduction-reply@1` body: `{ type, act, mediator: <mediator's
pair anchor toward the target>, requestDigest: <multibase
multihash of JCS(request body)>, requesterPair: <the card anchor
from step 1>, cardDigest: <digest of the target's fresh card> }`,
signed under the target's fresh card anchor. `requestDigest` binds
the reply to exactly one request — reply splicing across requests
breaks the signature.

### 8.3 The target designator

`target` is an opaque string, `u`-base64url, **at most 343
characters** (≤ 256 payload bytes), minted in the mediator's own
namespace (it is the mediator's addressing capability being
exercised). Requirements: stable per (mediator, target) at least
for the act's lifetime; resolvable by the mediator to a
deliverable party; verifiable by the **target**, over its own
channel to the mediator, as designating itself before consenting.
It carries no global meaning and MUST NOT be built from any
anchor.

### 8.4 introduction-ack@1 — uniform, role-bound, testable

Body `{ type, act }` — no other member exists in the schema.
Proof: `mac` under `k = HKDF(ECDH(pairX_mediator,
pairX_requesterMediator), "rltp/visibility/mac/ack")` — the
**mediator↔requester relationship tuple named by
`requesterMediatorPair`**, which exists by the 8.1 precondition;
no role ambiguity remains. The mediator MUST send exactly one ack
per received request at its declared constant delay `ack-delay`
(a fixed parameter published in the mediator's task registration
entry, not adaptive), **identically for existing, refusing,
unknown, and expired targets**. The requester verifies MAC and act
id; a second ack, a missing ack after `ack-delay` plus skew, or
any deviation is a mediator conformance failure.

### 8.5 The voucher — bound to the held act

`introduction-voucher@1` body `{ type, act, requesterPair,
targetPair }`; two artifacts, one per side, `mac` under
`HKDF(ECDH(pairX_mediator, pairX_side),
"rltp/visibility/mac/voucher")`, where `pairX_side` is the
mediator's relationship tuple with that side (8.1 precondition). A
recipient MUST accept a voucher only if it holds the act locally
and `requesterPair`/`targetPair` match its held request/reply
artifacts of that act — a valid MAC over unheld values is not a
voucher of anything.

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

A finer per-recipient ladder (up to introduction permission) was
tried in UX and withdrawn (22.08.); the two-grade declaration of
5.5 is the specified surface. Reintroduction would extend the
`grade` enum in a new version, nothing structural.

### 9.2 The encounter-credential flank — seam pre-wired with suites

Encounter 0.25 carries `commitment: { suite, value }` with an
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
M-DID), with the S-DID as the private cross-relationship coordinate
disclosed per co-member via the Section 6 pattern (group→self); the
UI surface of that disclosure is the **Trust** act. Current reality
(review finding M5): roster *readers* — not only social co-members
— and colluding insiders of different groups can correlate
S-DID-bound members across groups, and admission artifacts
replicate stable anchors into group logs permanently. Technically
the star is anchor-agnostic (finding M6): group anchors can
participate in blinded intersection wherever the recipient
legitimately holds them. The open questions are semantic: which
anchor class counts as a "contact"; how group-specific hits on the
same person deduplicate without rebuilding the linkability the
change removes; when an M-DID may bind to a relationship. The
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
- **Salt rollback / reuse / equivocation** — atomic persistence
  both sides, strictly-greater acceptance, directional keys; a
  restoring sender without a high-water mark re-forms the
  subscription on the next tuple instead of guessing (5.2).
- **Sender equivocation / fabricated stars** — not preventable and
  normatively de-fanged: stars carry no veracity (5.2).
- **Chunk games** — partial deliveries never advance the accepted
  salt; byte-identical retries are ignored; one assembly slot per
  tuple bounds recipient state (5.2a).
- **Mapping mis-binding** — closed by the 6.3 condition list; the
  unclaimability claim is defined as the sum of those checks.
- **Mapping downgrade / replay / reset** — version exact-match
  (2.1), tuple-scoped state, reset rule (6.4).
- **Probe abuse** — a stranger cannot test candidate anchors:
  entries are HMACs of the *sender's own* anchors under a key bound
  to this fresh tuple; testing a third anchor requires the sender's
  cooperation per value. Replay into another tuple fails (`k_p`
  binds both new anchors). Fixed 256-entry chunks kill cardinality
  below chunk granularity; padding is indistinguishable without a
  matching held anchor.
- **Continuity hijack by key theft** — a stolen, still-active old
  device is a *key controller* and can continue a chain (6a.4);
  Identity §11 grades this honestly as *none* under operational key
  possession, the window is bounded by the stolen tuple's
  active-head status, and succession — not this artifact — is the
  remedy.
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
  further.
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
   atomicity (5.4) — state-dependent, simulator-checked;
4. enforces grade declarations per 5.5 (fail-closed count,
   revision and equivocation rules) — vector-testable;
5. verifies `anchor-mapping@2` by the complete 6.3 list and the
   6.4 reset rule, rejecting legacy/unknown versions —
   vector-testable including the mis-binding negative;
6. emits chunked, padded probes and verifies continuity mappings
   per 6a, chains atomically per 6.4, and resends pending
   probes/mappings on next contact (6a.3) — vector-testable
   (probe shape, mapping MACs), state-dependent (chain atomicity,
   resend duty);
7. runs the introduction carrier per 8.1–8.5 including the
   precondition, digest checks, and the uniform role-bound ack —
   vector-testable (bindings, ack MAC), state-dependent (ack
   uniformity against the declared `ack-delay`);
8. maintains `provenance` per 8.6 — state-dependent;
9. publishes per Section 4 — state-dependent (snapshot rule);
10. treats stars, counts, and probes as non-evidence (5.2, 7) —
    state-dependent consumer rule.

## References

- Identity Layer 0.10 — `spec/identity-layer.md` (§5.2, §6.1,
  §9.3, §11).
- Encounter Layer 0.25 (wire 0.24) — `spec/encounter-layer.md`
  (fresh-always §4.4, commitment §7.2, versioned schemas).
- RFC 8785 (JCS) · RFC 2104 (HMAC) · RFC 5869 (HKDF) · RFC 7748
  (X25519) · RFC 8032 (Ed25519) · BCP 14.
- Schemas: `schemas/visibility-*.schema.json`,
  `schemas/visibility-payload-*.schema.json`. Vectors:
  `vectors/visibility.json`.
- Design sources and triages as listed in the header.
