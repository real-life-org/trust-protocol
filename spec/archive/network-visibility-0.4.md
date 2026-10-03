# RLTP Network Visibility

**Real Life Trust Protocol — cross-cutting: Network Visibility**

- **Status:** Editor's Draft
- **Version:** 0.4.0-draft (fourth casting)
- **Editors:** Anton Tranelis
- **Date:** 2026-08-23
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Conformance profile:** `rltp-visibility@0.4` (draft). Wire
  artifacts: `star@1` · `grade-declaration@1` · `anchor-mapping@2` ·
  `self-card@1` · `continuity-probe@1` · `continuity-mapping@1` ·
  `introduction-request@1` · `introduction-reply@1` ·
  `introduction-ack@1` · `introduction-voucher@1`.
- **Companions (pinned):** **Identity 0.9** (`pair/` registry §6.1 —
  REQUIRED) · **Encounter 0.24** (fresh-always pair enactment — the
  continuity machinery of §6a is the other half of its §4.4) ·
  Access 0.25 · Membership 0.11 (read-only; their recast is the
  M-DID loop). Delivery 0.17 is consumed with an open registration
  debt (§8.1).
- **Supersedes:** versions 0.3–0.1 (archived under
  `archive/network-visibility-*.md`).
- **Source material:** design docs and triages
  `design/visibility-publikumsprinzip-2026-08.md` ·
  `design/mdid-bindung-2026-08.md` · `design/visibility-review1/2-2026-08.md`
  · `design/joint-pair-seam-review1-2026-08.md` (all findings of the
  joint round answered by this casting).

## Abstract

This document specifies who gets to see what about the edges of the
trust graph: which artifacts are provable to whom (the audience
principle), how knowledge about one's contacts may travel (the star),
how anchors of one person are linked for exactly one addressee
(anchor mapping), how one relationship persists across fresh-anchor
enactments (continuity), and how strangers become contacts (the
introduction act).

Its central commitment: **links between anchors are the protected
good.** Everything here is cryptographically authenticated, but only
artifacts whose purpose is presentation are transferably signed.
Everything else convinces exactly its addressee and no one further.

## Status of This Document

Fourth casting, answering the joint pair-seam round 1 in full. New:
the **continuity probe and mapping** (§6a — the author's
fresh-always decision, executed), the introduction **carrier**
(§8.1), star **chunking** (5.2a), the relationship **lifecycle**
(§6.4), the **provenance attribute** (§8.6), corrected schemas, and
vectors for **every** wire type including executable negatives
(`vectors/visibility.json`). The browser simulator still predates
this casting and MUST be aligned; it is a probe, not the normative
source.

The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted
as described in BCP 14 (RFC 2119, RFC 8174) when, and only when,
they appear in all capitals.

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
ways to gain a new contact — a real-life encounter (Encounter 0.24)
or the introduction act (Section 8).** No artifact of this document
transports a **standing** anchor of a third party to anyone. Fresh
anchors created by their own issuers for a new relationship are the
rule working, not an exception to it.

## 2. Terminology

- **Anchor** — a context identifier of an identity (Identity 0.9 §5,
  §6): the self context, or a `pair/…`, `group/…`, `persona/…`
  context.
- **Anchor classes (DTGWG-aligned naming):** **R-DID** = pair-context
  anchor · **P-DID** = persona anchor · **S-DID** = the self anchor,
  the stable coordinate across a person's relationships, disclosed
  selectively per recipient (RLTP's extension to the DTGWG ladder) ·
  **M-DID** names the class "per-community member identifier"
  (confirmed direction with open semantics, Section 9.4).
- **Promotion** — the trust act of a holder toward one of their
  contacts; the UI surface of promotion and of S-DID disclosure is
  the **Trust** act.
- **Star** — the artifact by which a sender lets one recipient
  relate the sender's contact set to the recipient's own (Section 5).
- **Deliverable set** — for one recipient: the contacts who have
  promoted the sender, each under its effective grade (5.5).
- **Tuple** — the pair `(own pair anchor, counterpart pair anchor)`
  of one enactment or introduction. Fresh-always enactment creates a
  fresh tuple every time.
- **Relationship** — a holder-local chain of tuples with exactly one
  **active head** (§6.4). All per-relationship state (star salts,
  grade revisions, mapping state) is indexed by tuple; relationship-
  level facts (provenance, evidence accumulation) live on the chain.
- **Resolver class** — of one *publication*: the set of parties able
  to make use of that publication (Section 4).
- **Audience class** — P, V, or D per Section 3, per artifact.
- **DV** — designated-verifier: verifiable only with the addressee's
  secrets; the addressee could have forged it; third parties cannot
  even check it.

### 2.1 Common wire conventions (normative)

Every artifact is a JSON document `{ "body": { … }, "proof": { … } }`.

- **body** carries `type` and the fields its schema closes.
  **Unknown members anywhere MUST be rejected** — every schema is
  closed.
- **proof** carries exactly the members the type names: `mac`,
  `mac1` + `mac2`, or `proofValue`.
- **Canonical bytes** are `JCS(body)` (RFC 8785) — never the
  envelope, never the proof.
- **Signatures** (`proofValue`) are **raw Ed25519 over the canonical
  bytes** (RFC 8032), encoded `z` + base58btc (65–89 characters).
  Stated plainly: this is not a W3C Data Integrity suite; Encounter
  cards keep their own DI proofs — two artifact families, deliberately
  distinct.
- **MAC** is HMAC-SHA-256 over the canonical bytes; encoded `u` +
  43 unpadded base64url characters (44 total).
- **KDF** is HKDF-SHA-256, salt empty, output 32 bytes, exact-ASCII
  info strings.
- **ECDH** is X25519 over Identity §5.2 keys; an all-zero shared
  secret MUST be rejected.
- **Anchor bytes** are the UTF-8 bytes of the anchor's `did:key`
  string.
- **Timestamps** follow Encounter 2.3's `rfc3339utc` profile (UTC
  `Z`, ≤ 3 fractional digits, whole-second comparison).
- **Integers on the wire** (`salt`, `seq`, `revision`, `count`) are
  JSON strings: base-10, no leading zeros, no sign, no exponent,
  value ≤ 2⁶³−1 (`salt`, `seq`, `revision` ≥ 1; `count` ≥ 0). A
  consumer MUST reject values outside the domain even where the
  pattern admits them.
- **Multibase canonicality:** every `u…`/`z…` value MUST re-encode
  byte-identically; a value whose canonical re-encoding differs is
  malformed. Equality of MACs, act ids, and digests is byte equality
  of canonical encodings.
- A consumer MUST reject any `type` it does not implement —
  including `anchor-mapping@1` and every unknown version. No
  version negotiation.

## 3. The audience principle (normative)

For every artifact: **(F1)** whom must the statement convince?
**(F2)** must the recipient pass it on? Provability MUST be the
smallest set the purpose demands; default deniable (DV), a
transferable signature is the justified exception.

- **Class P (presentable):** statements about myself whose purpose
  is showing — persona profile, membership document, self card,
  contact card. Transferably signed. Only class-P artifacts are
  credentials or cards.
- **Class V (links):** every statement connecting two contexts of
  one person — anchor mapping, **continuity mapping**, group
  mappings, introduction voucher. Always DV; never transferable.
  Boundary: a key binding within one context (self card) is class P
  with the possession residue of Section 11.
- **Class D (statements about third parties):** stars,
  **continuity probes**, introduction requests. Knowledge itself
  harms; class D adds content grading/blinding.

Authentication and audience are orthogonal: everything travels
end-to-end encrypted and channel-authenticated.

## 4. The publication-space rule (normative)

Principle (register no. 2), total and decidable:

1. **Scope:** class-V/D artifacts and standing publications into
   shared contexts. Class P is exempt by class (audience declared by
   purpose; handing is issuance, not publication).
2. **Candidate spaces** (closed list, member sets): group space
   (current members at snapshot) · pair channel (the two) · persona
   surface (unbounded; class P only).
3. **Snapshot** at publication; later growth obliges nothing; later
   shrinkage is the space's epoch business.
4. **Choice:** a containing, minimal-by-member-set-inclusion
   candidate; among incomparable minima, any one (each further space
   a fresh decision).
5. **Transport is not publication.**

Applied: a member's self-anchor tag goes to the group space; world
publication is a violation.

## 5. The star (normative)

### 5.1 Standing contents: count or blinded — nothing else

Per affected contact exactly one standing form: **count** (aggregate
number only) or **blinded** (`HMAC(k, anchor bytes)` under 5.2's
key). No raw third-party anchor in any star; no standing "show"
grade. `count` counts **all** deliverable contacts; `blinded[]` is
the blinded-graded subset; duplicates MUST NOT be emitted; entries
sorted lexicographically.

### 5.2 star@1 — directional epochal blinding

Body: `{ "type": "star@1", "salt": <int-string>, "seq":
<int-string>, "last": <boolean>, "count": <int-string>, "blinded":
[ … ] }`. Proof: `mac` under `k`.

- `salt` is the delivery sequence of this relationship direction:
  starting at 1, strictly increasing, persisted **atomically
  before** send. After state loss, a sender without a recovered
  high-water mark MUST NOT resume — the subscription is re-created
  under a fresh tuple (§6.4), never guessed.
- The recipient MUST persist per tuple the highest **completed**
  salt and MUST reject any delivery whose `salt` is not strictly
  greater.
- **Directional key:** `k = HKDF(X25519(pairX_sender,
  pairX_recipient), "rltp/visibility/blind/star/" ||
  senderPairAnchor || "/" || recipientPairAnchor || "/" || salt)`.

### 5.2a Chunking (normative)

One delivery MAY span several chunks under one `salt`: `seq` runs
1…n, `last: true` marks the final chunk, `count` and the sorted
union of `blinded[]` describe the whole delivery. Bounds: a chunk
MUST stay within the Delivery Contract's 65 536-byte plaintext
limit; a `blinded[]` per chunk of at most 1024 entries keeps ample
margin. The recipient assembles per (tuple, salt); it MUST reject
the delivery on missing/duplicate `seq`, on entries out of order
across the union, or on a `count` inconsistent with the assembled
claim; only a completed delivery advances the accepted salt. There
is **no upper bound on total contacts** — the round-1 schema cap is
withdrawn (a 4097th promotion is a chunk, not a protocol failure).

Properties with honest limits (unchanged from 0.3): intersection
only · **no veracity** (the star is a sender claim; consumers MUST
NOT treat it as relationship evidence) · collusion breaks across
keys, pooling of known anchors against retained snapshots remains ·
deniability free · longitudinal tracking dies with unique
directional salts; later-learned anchors remain testable against
snapshots.

### 5.3 The star MUST NOT be signed

Unchanged: forgeability is a requirement; credibility beyond the
addressee is a DV-ZK predicate (9.3), never a signature.

### 5.4 Subscription — delivery on set change only

Unchanged from 0.3, including transition atomicity: exactly one
delivery per deliverable-set change, after the grade declaration is
verified or after `grade-wait = PT24H` under the fail-closed grade.

### 5.5 grade-declaration@1 — DV, fail-closed, threat model stated

Unchanged from 0.3: relationship-key MAC
(`"rltp/visibility/mac/grade/" || subjectPair || "/" ||
holderPair`), revision monotone per tuple, equal+different =
equivocation error, effective grade = last verified else **count**.
Threat model: protects against third parties and honest-holder
confusion; a malicious holder is not cryptographically constrainable
under DV and is structurally bounded (stars carry no veracity).
The **Trust** act issues `blinded` (register no. 3).

## 6. Anchor mapping (normative)

### 6.1 Purpose and construction

`anchor-mapping@2` links a pair anchor to the self anchor of the
same person for exactly one addressee — double-DH MAC, Signal
pattern. Body: `{ "type", "pair", "self", "to", "card":
<self-card@1>, "revision", "issuedAt" }`; `mac1` under
`k1 = HKDF(ECDH(pairX_sender, pairX_addressee),
"rltp/visibility/mac/map1")`, `mac2` under `k2 =
HKDF(ECDH(selfX_sender, pairX_addressee),
"rltp/visibility/mac/map2")`.

### 6.2 self-card@1 — binding, not link; residue named

Unchanged from 0.3 (raw-Ed25519 proof per 2.1): binds Ed and X keys
of the same self context; transferable after disclosure; §1 is
issuance control, not recall.

### 6.3 Verification — the closed condition list

Unchanged from 0.3, and the unclaimability property is defined as
the sum of these checks: envelope/schema/type · `to` == own active
pair anchor of the arrival relationship · `pair` == counterpart's
anchor of that tuple · card verifies under its own anchor ·
`card.anchor == self` · `k2` from `card.keyAgreement` · non-zero
ECDH · both MACs · revision per 6.4.

### 6.4 Tuples, chains, and the relationship lifecycle (normative)

- All mapping/grade/star state is indexed by **tuple**. A mapping
  naming a pair anchor that is not the active head of any current
  relationship MUST be rejected.
- **Chaining:** a verified continuity mapping (§6a) appends the new
  tuple to the relationship's chain and makes it the **active
  head**; the prior tuple is thereby **deactivated** — atomically
  with the append, and this MUST survive restart (persist the chain
  update before acting on it). Deactivated tuples accept no new
  artifacts; their history (credentials, delivered snapshots)
  remains what it is.
- **Reset:** a party that cannot answer the continuity probe is,
  protocol-wise, a new relationship (Identity §9.3: re-created, not
  recovered). Old mappings die with their tuples and cannot be
  re-attached (replay of a verified mapping with identical body on
  its own tuple stays idempotent and harmless).
- Revision scopes: grade per (subject, holder) tuple ·
  anchor-mapping per (pair, to) — `self` is content · continuity
  mapping per (prior, next, to).

## 6a. Continuity: probe and mapping (normative — the other half of Encounter §4.4)

Fresh-always enactment (Encounter 0.24 §4.4) means every ceremony
creates a fresh tuple. Whether it was a **re-encounter** is resolved
here, after the ceremony, over the fresh channel — automatically,
with no user dialog and no pre-selection.

### 6a.1 continuity-probe@1

Sent by either party (SHOULD by both) immediately after enactment
completion. Body: `{ "type": "continuity-probe@1", "blinded":
[ exactly 256 entries ] }`; proof: `mac` under `k_p`.

- `k_p = HKDF(X25519(newPairX_sender, newPairX_recipient),
  "rltp/visibility/blind/probe/" || senderNewPair || "/" ||
  recipientNewPair)`.
- Entries: `HMAC(k_p, ownPriorPairAnchor bytes)` for the sender's
  own prior pair anchors — its side of every relationship it holds
  (most recent 256 if more; stated cap). The array MUST be **padded
  to exactly 256** with random 32-byte values encoded like MACs and
  then sorted: a genuinely new counterpart sees 256 uniform opaque
  values — **cardinality does not leak**, membership tests are
  impossible without holding a prior anchor of the sender.
- The recipient computes `HMAC(k_p, counterpartAnchor)` for each
  counterpart anchor it holds and intersects. A match identifies
  the shared prior relationship; zero matches identifies a new
  contact. More than one match (several prior relationships with
  the same person, e.g. after resets) is resolved toward the most
  recent chain.

### 6a.2 continuity-mapping@1

On a match, the matching party answers: body `{ "type":
"continuity-mapping@1", "prior": <own prior pair anchor>, "next":
<own new pair anchor>, "to": <counterpart's new pair anchor>,
"revision", "issuedAt" }`; `mac1` under the **prior** relationship
key (`HKDF(ECDH(priorPairX_sender, priorPairX_addressee),
"rltp/visibility/mac/cont1")`), `mac2` under the **new**
relationship key (`…/cont2`). Verification mirrors 6.3: `to` ==
own new anchor · `prior` == held counterpart anchor of the matched
tuple · `next` == counterpart anchor of the fresh tuple · both
MACs. mac1 proves control of the old side, mac2 of the new — only
the same person can compute both; the addressee can forge the
whole artifact (class V, deniable); third parties cannot verify.
On verification, chain per 6.4. The counterpart SHOULD answer with
its own mapping in the other direction; a one-sided chain is valid
but marks the relationship's provenance upgrade only for the side
that verified.

### 6a.3 What this buys (informative)

The probe is the third member of one family — star, mapping, probe
are all blinded values under relationship keys. UX: a re-encounter
shows "re-verified" a round-trip after the scan, with no dialog; a
data-loss counterpart simply cannot answer and is honestly a new
relationship; a wrong scanner learns nothing (256 uniform values
under a key that binds this fresh tuple only).

## 7. Relational counts (normative principle, artifact unwritten)

Unchanged from 0.3: counts MUST be relational; the proof artifact
is deliberately unwritten (needs 9.2's substrate); state-dependent
in Section 12.

## 8. The introduction act (normative)

Principle: **the mediator transfers messages, never standing
anchors.**

### 8.1 Carrier (normative) — and its registration debt

The act runs over the Delivery Contract as four sealed tasks:

1. `introduction-request` (requester → mediator): payload `{
   "introduction": <introduction-request@1 document>, "card":
   <requester's fresh Encounter 0.24 contact card> }`. Receiver
   MUST check `introduction.body.cardDigest` == multihash of
   `JCS(card)`.
2. `introduction-forward` (mediator → target): payload `{
   "introduction": <the unchanged introduction-request@1>, "card":
   <the unchanged card> }`. **The target receives the full request
   and card**, verifies the request signature under the card's
   anchor, the digest, and — over its own channel to the mediator —
   that `target` designates itself (8.2). Consent is the target's
   local act.
3. `introduction-reply` (target → mediator → requester): payload `{
   "introduction": <introduction-reply@1>, "card": <target's fresh
   card> }`, same digest rule; the mediator forwards it unchanged.
4. `introduction-ack` (mediator → requester): payload
   `introduction-ack@1` per 8.4.

**Registration debt, stated honestly:** these task names live in
the Delivery Contract's registry; registering them is part of the
declared Delivery re-pin recast (Encounter §12). Until that lands,
the carrier is specified but unconsumable — the same class of
openness Encounter 0.24 carries, and it ends with the same block.

### 8.2 Artifacts

`introduction-request@1` body: `{ type, act: <32-byte random,
u-base64url 43 chars>, mediator: <mediator's pair anchor toward the
requester>, target: <opaque designator, 8.3>, cardDigest, profile:
<closed object: displayName ≤ 64, note ≤ 256> }`, `proofValue`
under the fresh card's anchor (raw Ed25519 per 2.1).

`introduction-reply@1` body: `{ type, act, mediator: <mediator's
pair anchor toward the target>, requestDigest: <multihash of
JCS(request body)>, requesterPair, cardDigest }`, signed under the
target's fresh card anchor. `requestDigest` binds the reply to
exactly one request; reply splicing breaks the signature.

### 8.3 The target designator

Opaque string, `u`-base64url, **at most 343 characters** (≤ 256
payload bytes), minted in the mediator's namespace; stable for the
act's lifetime; resolvable by the mediator; verifiable by the
target as designating itself over the target↔mediator channel;
never derived from an anchor.

### 8.4 introduction-ack@1 — uniform, testable

Body `{ type, act }` — no other member exists. Proof: `mac` under
`k = HKDF(ECDH(pairX_mediator, pairX_requester),
"rltp/visibility/mac/ack")` (the mediator↔requester relationship
key). The mediator MUST send exactly one ack per received request
at its declared constant delay `ack-delay` — a fixed parameter
published in the mediator's task registration entry, not adaptive —
identically for existing, refusing, unknown, and expired targets.
The requester verifies the MAC and the act id; a second ack, a
missing ack after `ack-delay` + skew, or any deviation is a
mediator conformance failure.

### 8.5 The voucher — bound to the held act

`introduction-voucher@1` body `{ type, act, requesterPair,
targetPair }`; two artifacts, one per side, `mac` under
`HKDF(ECDH(pairX_mediator, pairX_side),
"rltp/visibility/mac/voucher")`. A recipient MUST accept a voucher
only if it holds the act locally and `requesterPair`/`targetPair`
match its held request/reply artifacts of that act — a valid MAC
over unheld values is not a voucher of anything.

### 8.6 Provenance (normative)

Every relationship carries a local attribute `provenance ∈
{ "encounter", "introduction" }`. An introduction sets
`introduction`; the first completed enactment chained onto the
relationship (§6a) upgrades it to `encounter` — exactly then, and
never downward. UI wording ("◇ verified via <mediator>" /
"⇄ verified") is informative; the attribute and its transition are
normative.

### 8.7 What the binding buys — and what it cannot

Unchanged honesty from 0.3: signatures over act-bound bodies remove
card substitution and act splicing; a mediator can still *be* an
endpoint — irreducible without a prior relationship, carried in
`provenance`, upgradeable only by a real encounter. Refusal privacy
holds at the protocol surface (uniform ack), not against a
talkative mediator; timing below `ack-delay` resolution remains.
One-way-door UX invariant unchanged.

## 9. Documented options and open points

### 9.1 Grade ladder beyond two — withdrawn surface

Unchanged.

### 9.2 The encounter-credential flank — seam pre-wired with suites

Encounter 0.24 carries `commitment: { suite, value }` with an
initially empty suite registry; assigning meaning is registration
in that registry, its own loop.

### 9.3 Feasibility map for predicates (informative)

Unchanged.

### 9.4 M-DID binding of membership — confirmed direction, open semantics

Unchanged from 0.3 — and sharpened by the joint round's S-B2: the
Access recast is a **membership proof-model** change (its subject
and policy-currency rules assume the credential subject is the
membership anchor), not a pin rename. That loop follows this
document's convergence.

### 9.5 Standing disclosure (from the architecture map)

Unchanged.

## 10. Security Considerations

Carried from 0.3 (anchor harvesting · grade forgery bounds · salt
rollback/equivocation · sender equivocation de-fanged · mapping
mis-binding closed by 6.3 · downgrade/replay/reset · introduction
MITM residue · Sybil relational anchoring), plus:

- **Probe abuse.** A stranger cannot use a probe to test candidate
  anchors: entries are HMACs of the *sender's own* anchors under a
  key bound to this fresh tuple — testing a third anchor requires
  the sender's cooperation per value. Replaying a probe into
  another tuple fails (k_p binds both new anchors). Padding to a
  fixed 256 kills cardinality; random padding values are
  indistinguishable from real entries without a matching held
  anchor.
- **Continuity forgery.** Claiming someone else's relationship
  ("I am your old friend") requires mac1 under the prior
  relationship key — exactly the secret a data-loss party lacks and
  a stranger never had. The addressee can forge inbound continuity
  (DV), which convinces only itself; chaining is therefore a local
  act on the addressee's own graph, consistent with the register's
  principle 4.
- **Chunk games.** Partial deliveries never advance the accepted
  salt (5.2a); withholding `last` starves that delivery, not the
  relationship.

## 11. Privacy Considerations

Carried from 0.3 (one-bit oracle · counts as metadata · self-card
possession residue · membership correlation at true size · refusal
privacy scope · class-V non-verifiability), plus: the probe's fixed
256-entry shape leaks neither cardinality nor membership to
non-holders; what a *matched* counterpart learns — "we share this
prior relationship" — is exactly the fact being established, per
consent embodied in completing the ceremony together.

## 12. Conformance

A conformant implementation:

1. emits no raw third-party anchor in any artifact — vector-testable;
2. produces/verifies `star@1` with directional keys, salt and chunk
   discipline (5.2, 5.2a), unsigned — vector-testable;
3. delivers exactly on deliverable-set change with transition
   atomicity (5.4) — state-dependent;
4. enforces grade declarations (5.5) — vector-testable;
5. verifies `anchor-mapping@2` per 6.3/6.4 — vector-testable
   including mis-binding negatives;
6. emits padded 256-entry probes and verifies continuity mappings
   per §6a, chaining atomically per 6.4 — vector-testable (probe
   shape, mapping MACs), state-dependent (chain atomicity);
7. runs the introduction carrier per 8.1–8.5 including digest
   checks and uniform ack — vector-testable (bindings, ack MAC),
   state-dependent (ack uniformity against declared `ack-delay`);
8. maintains `provenance` per 8.6 — state-dependent;
9. publishes per Section 4 — state-dependent;
10. treats stars, counts, and probes as non-evidence — consumer
    rule.

## References

- Identity Layer 0.9 · Encounter Layer 0.24 (fresh-always §4.4,
  commitment §7.2, versioned schemas).
- RFC 8785 · RFC 2104 · RFC 5869 · RFC 7748 · RFC 8032 · BCP 14.
- Schemas: `schemas/visibility-*.schema.json`. Vectors:
  `vectors/visibility.json`.
- Design sources and triages as listed in the header.
