# RLTP Identity Layer

**Real Life Trust Protocol — Layer 1: Identity**

- **Status:** Editor's Draft
- **Version:** 0.2.0-draft (second casting)
- **Editors:** Anton Tranelis
- **Date:** 2026-08-22
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Conformance profile:** `rltp-identity@0.2` (draft)
- **Supersedes:** version 0.1 (archived as
  `archive/identity-layer-0.1.md`).
- **Supersedes on adoption:** `01-wot-identity/001-identitaet-und-schluesselableitung.md`
  and `003-did-resolution.md` (wot-spec v0.1, German). The planned
  device-delegation profile `01-wot-identity/004-device-key-delegation.md`
  is not superseded; it is referenced as prior work by Section 15.1.

## Abstract

This document specifies the Identity layer of the Real Life Trust
Protocol: how a person's cryptographic identity is rooted, derived, and
presented to every other layer.

A person keeps **one secret and one register**. The secret is a
mnemonic; from the seed it encodes, the person derives **one anchor
per context**: one for their personal community, one per group they
join, one per public persona they choose to maintain, and one service
identity per group toward infrastructure. The register is the list of
contexts — data, not secret — synchronized in the person's encrypted
state. Derivation is deterministic: secret plus register reconstructs
every key. And it is one-way: without the seed, two anchors of the
same person are unlinkable.

An anchor's outside face is a **self-certifying identifier**: a DID
that binds its own key material without any registry, resolver
infrastructure, or network access. This casting normatively specifies
the smallest self-certifying form, `did:key`, in which the identifier
is the key and the key history is empty — and states honestly that
the frozen consumers of this stack pin exactly that form today. The
extension to anchors with a verifiable key history — enabling
rotation, per-device keys, and recovery from key compromise — is a
named, deliberately open successor (Section 15).

What an anchor *means* — who may link it to a person or to another
anchor — is not decided here. Derivation determines how many anchors
exist; **disclosure determines what they mean**, and disclosure is
specified by the layers above. This document only guarantees that the
separation exists: anchors of one person share no derivable relation
visible to anyone who lacks the seed.

## Status of This Document

This is an **Editor's Draft** with no standing beyond its own argument.
It is developed through the same adversarial convergence process as its
companions: every casting is reviewed in full by an independent
adversarial reviewer, findings are triaged, and the document is recast —
never patched — until a casting is judged blocker-free and compatibly
implementable. The converged companions above this layer are the **RLTP
Encounter Layer 0.22**, the **RLTP Delivery Contract 0.17**, the **RLTP
Membership Tasks 0.11** and the **RLTP Access Layer 0.25**. *RLTP
Succession* (0.2, parked) operates on the anchors this document
defines.

This **second casting** answers review round 1
(`design/identity-review1-2026-08.md`, 5 blockers, 7 majors, 2
minors, all accepted). The deepest cuts: the root contract is now the
64-byte BIP-39 seed — which resolves the 12-word/256-bit
contradiction, makes migration reconstructible from the mnemonic
alone, and lands exactly on the Access Layer's frozen service-identity
contract; X25519 is normed end to end into the contact card; the
label registry is a closed, byte-precise grammar with mandatory
rejection; the waist is stated honestly as `did:key`-bound in 0.x;
and the "one backup" claim is corrected to **one secret, one
register**.

It is cast against the requirements list of the layer's decomposition
(`design/identitaets-schicht-2026-08.md`, I-list Revision 3): the
exclusion criteria A1–A9 are normative sections of this document, the
graded properties B1–B4 are stated honestly for the native profile in
Section 11, and the compensations C1/C2 are referenced with their
real status (C1 parked, C2 planned). Appendix B maps every
requirement to its section.

Parts of this design were pre-run executably by the graph simulator
(`simulator/graph-web.mjs`): the Ed25519 label derivation, the
unlinkability of derived anchors, and the `did:key` encoding run
there under WebCrypto with real credentials. The simulator does
**not** yet exercise digest-form group labels, X25519 derivation, or
label rejection; these are pending probes, not executed claims.

This layer defines **no wire artifact**. Its normative surface is the
derivation scheme, the label registry, the anchor and key-agreement
forms, and the rules it imposes on consuming layers. Its test vectors
are derivation vectors (Section 16).

## 1. Introduction (informative)

### 1.1 Essence

> A person is one mnemonic. Everything a person *is* toward a
> context — their personal community, a group, the public — is an
> anchor derived from its seed: reconstructible by its holder,
> unlinkable for everyone else, and resolvable by anyone as a plain
> DID.

Three consequences shape this document:

1. **One secret, one register.** The mnemonic is the only *secret* a
   person must keep. The *register* of contexts (which groups, which
   personas) is data: it must exist for recovery, but it carries no
   authority and lives root-encrypted in the person's synchronized
   state like any other holding. Nothing else exists — no keystore,
   no per-context enrollment secret.
2. **Separation by construction, meaning by disclosure.** Contexts
   are separated cryptographically, not by policy: linking two
   anchors requires either the seed or an act of disclosure by the
   holder. The disclosure acts themselves — to a contact, to a group,
   to everyone — belong to the layers above; this document guarantees
   only that there is something to disclose.
3. **The waist is narrow — and today it is `did:key`.** To every
   consumer, an anchor is an opaque, standard-resolvable DID, and
   nothing on the wire reveals how it was derived. In the 0.x stack
   the frozen consumers additionally pin the concrete form (Section
   8.3); the waist rule is the discipline that keeps a future form's
   cost contained, not a claim that no cost exists.

### 1.2 The derivation is private

The derivation scheme of this document is a **convention of the
holder**, not a claim on the wire. No verifier ever checks that an
anchor was HKDF-derived; no credential ever names a label. This has
two consequences worth stating plainly. First, migration is a
derivation rule, not a data migration: a pre-existing identity keeps
its anchor because that anchor *is* one of this document's
derivations (Section 10). Second, proving that two anchors share a
seed is an *act* — a future disclosure primitive — not a property a
third party could ever compute (Section 15.3).

### 1.3 Position in the stack

The Encounter Layer issues credentials **between anchors** and
carries key-agreement material in its **contact card**. The Delivery
Contract seals envelopes **to** that material. Membership and Access
admit **anchors** to groups, and Access consumes the **service
identities** of Section 7. Succession replaces **an anchor** while
preserving its relations. All of them consume this document through
three rules: an anchor is an opaque resolvable DID (Section 8.3),
verification material is bound to the anchor and available offline
(Section 8.4), and key material exists per context exactly as
Sections 5–7 derive it.

## 2. Terminology

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be
interpreted as described in BCP 14 (RFC 2119, RFC 8174) when, and only
when, they appear in all capitals.

- **Mnemonic**: the person's single master secret, a BIP-39 word
  sequence (Section 4).
- **Root IKM**: the 64-byte BIP-39 seed derived from the mnemonic;
  the input keying material of every derivation in this document.
- **Context**: a social surface toward which a person acts under one
  identity: their personal community, one group, one public persona.
- **Label**: the canonical string naming a context in the derivation
  (Section 6).
- **Label register**: the holder's list of used labels plus the self
  mode of Section 10 — data required for recovery, stored
  root-encrypted in synchronized state.
- **Anchor**: the DID a person presents toward one context. Evidence
  accumulates on anchors.
- **Anchor key pair**: the Ed25519 assertion key pair of an anchor.
- **Key agreement key**: the X25519 key pair derived alongside each
  anchor for sealing (Section 5.2).
- **Self anchor**: the anchor of the person's personal community.
  Under the converged Encounter Layer profile, this is the anchor
  under which encounters are performed.
- **Service identity**: the derived pseudonym a person presents to
  infrastructure for one group (Section 7).
- **Holder**: the person controlling the mnemonic.

## 3. Creation, hierarchy, and human actions (normative)

### 3.1 Self-creation (A1)

An identity exists because someone brings it into existence — by
generating entropy, nothing more. No issuer, no registry, no domain,
and no service participates in creation or is a condition of
existence. An implementation MUST NOT require any online interaction
to create an identity or to derive any key.

### 3.2 The hierarchy

The hierarchy of `rltp-identity@0.2` has two levels:

```text
mnemonic → root IKM (64-byte BIP-39 seed; cold in principle)
 └── per context: anchor key pair (Ed25519) + key agreement key (X25519)
 └── per group:   service identity (Ed25519), Access contract
```

- The root IKM MUST NOT be used directly as a signing or agreement
  key.
- Anchor key pairs MUST NOT be reused across contexts: one label,
  one key pair. Deriving two labels to the same key material is
  computationally infeasible under Section 5 (accidental collision
  probability ≈ 2⁻²⁵⁶ per pair); an implementation that nevertheless
  detects a collision MUST fail closed rather than proceed with a
  shared key. Presenting one anchor under two contexts is a
  disclosure decision of the holder, not a key-reuse mechanism.
- A third level — per-device operational keys authorized by an
  anchor — is **not part of this profile**. In `rltp-identity@0.2`,
  a device that acts for a person holds the mnemonic or root IKM
  (the shared-seed model). Section 15.1 names the successor and the
  constraint any successor MUST honor.

### 3.3 Human actions (A8)

Every mechanism of this document that a human triggers MUST be
presentable as the everyday action of this table; mechanisms listed
as *automatic* MUST NOT require a user decision. A profile that
introduces a second long-term secret MUST state that cost where the
profile is defined.

| Mechanism | Everyday action | Visible consequence | Required warning |
|---|---|---|---|
| Create identity (3.1, 4) | "Write down your twelve words" | the person exists; contacts can be made | the words are the only secret; losing them is final (8.2) |
| Recover (9) | "Enter your words on the new device" | anchors return; holdings return from synced state | none |
| Join a group (6.1) | joining itself — no key step | the group appears | none (label handling is automatic) |
| Create a public persona (6.1) | "Create public profile" | publicly findable under the chosen name | publishing is forever — stopping does not unpublish (visibility layer) |
| Report loss or compromise (8.2, C1) | "Start succession with your guardians" | witnessed transition to a new identity | this is a new identity with witnessed continuity, not recovery |
| Service identities (7) | *automatic* | none visible | none |
| Adopt a legacy identity (10) | "Enter your words" (same gesture as recovery) | the existing identity continues | none |

## 4. The mnemonic and the root IKM (normative)

- The master secret is a **BIP-39 mnemonic** of at least twelve
  words. Implementations MUST use the English wordlist and MUST NOT
  localize it: recovery phrases are exchanged and typed across
  implementations, and a single wordlist is what makes them portable.
- Twelve words encode 128 bits of entropy; this is the security
  floor of the native profile and Section 13 states it as such.
  Implementations MAY offer twenty-four words (256 bits); the
  derivation below is unchanged.
- The **root IKM** is the 64-byte BIP-39 seed of the mnemonic:
  PBKDF2-HMAC-SHA-512 over the NFKD-normalized mnemonic with salt
  `"mnemonic" || passphrase` and 2048 iterations, per BIP-39. In the
  native profile the passphrase MUST be empty. A profile that uses a
  non-empty passphrase introduces a second long-term secret and
  MUST state that cost (3.3).
- The mnemonic SHOULD be treated as recovery material: stored
  coldly, entered rarely. This casting's device model (3.2) forces
  operational presence of the root IKM on acting devices; Section
  15.1 exists to lift that.
- Implementations MUST NOT derive anything from the root IKM except
  through Sections 5 and 7, and MUST NOT transmit the mnemonic, the
  root IKM, any derived seed, or any private key off the device that
  holds it, except as user-initiated recovery input on another
  device of the same person.

## 5. Context derivation (normative)

### 5.1 The two seeds

For a context with canonical label `L` (Section 6):

```text
edSeed(L) = HKDF-SHA-256(ikm = root IKM, salt = empty, info = "rltp/anchor/ed/" || L, length = 32)
xSeed(L)  = HKDF-SHA-256(ikm = root IKM, salt = empty, info = "rltp/anchor/x/"  || L, length = 32)
```

- `edSeed(L)` is the Ed25519 private-key seed of the anchor
  (Section 8).
- `xSeed(L)` is the X25519 secret of the context's key agreement
  key (Section 5.2).
- The salt MUST be empty. The info strings MUST be exactly the
  ASCII prefixes above followed by the label bytes. The prefixes are
  the domain separation between signing and key-agreement material;
  implementations MUST NOT derive both from one info string, and
  MUST NOT add further key types under these prefixes — a future key
  type gets a future prefix through a new casting. (The two fixed
  prefixes differ before the label begins and UTF-8 is injective, so
  no choice of label can collide the two purposes or make two
  distinct labels concatenate to one info string.)
- Derivation MUST be deterministic: the same mnemonic and label
  produce the same seeds on every conforming implementation.
  Section 16 gives vectors, anchored in a public BIP-39 test
  mnemonic.

Derivation is lazy by nature: a context's keys exist the moment its
label is first derived, and re-derive identically forever after.
There is no registration step and no state beyond the label register.

### 5.2 Key agreement material, end to end

`xSeed(L)` is the 32-byte X25519 secret of the context, interpreted
per RFC 7748 (clamping is applied by the X25519 function itself; the
stored seed is the raw HKDF output):

- The public key is `X25519(xSeed, 9)` (the base point), 32 bytes.
- Its interchange form is the **multikey**: `z` followed by the
  base58btc encoding of `0xec 0x01 || public-key` (the `z6LS…`
  form).
- Its **place** is the `keyAgreement` field of the Encounter Layer's
  contact card, exactly as the frozen contact-card schema requires;
  the card as a whole is signed under the anchor, which is what
  binds the agreement key to the anchor (Section 8.4). The Delivery
  Contract's `rkid` designates this key when sealing to the context.

A conforming implementation MUST produce, for every context it
derives, the anchor and the multikey of this section such that a
counterpart holding only the contact card can seal to it per the
Delivery Contract with no further information.

## 6. Context labels (normative)

### 6.1 The closed registry

The registry of `rltp-identity@0.2` is **closed**: exactly the
following label forms are derivable, and a derivation API presented
with any other string MUST reject it before any key derivation
(fail closed, no normalization repair beyond Section 6.2). A closed
registry is what makes the label register portable: two conforming
implementations accept exactly the same labels.

| Label form | Context | Notes |
|---|---|---|
| `self` | the personal community | exactly one; see Section 10 for the migrated self mode |
| `group/<digest>` | one group | `<digest>` is the group's genesis digest exactly as issued by the Membership Tasks: `u` followed by the base64url encoding of a `sha2-256` multihash — bytes `0x12 0x20` followed by exactly 32 digest bytes (47 characters in total). Implementations MUST validate the multihash structure and MUST NOT accept a display name |
| `persona/<name>` | one public persona | `<name>` per Section 6.2; a person MAY hold several personas |

Prefixes `pair/` and `device/` are **reserved** for the successors
named in Section 15 and MUST be rejected like unknown labels.
Service identities are NOT labels of this registry; they derive per
Section 7.

### 6.2 Name grammar and canonicalization

`<name>` in `persona/<name>` is constrained byte-precisely, because
two byte-different labels derive two different anchors — label
equality *is* anchor identity:

- 1 to 64 Unicode code points; at most 256 UTF-8 bytes.
- MUST be normalized to Unicode NFC before derivation; an
  implementation MUST apply NFC itself rather than reject
  unnormalized input (this is the one permitted normalization).
- Comparison after NFC is **byte equality**; names are
  **case-sensitive** (`persona/Anna` and `persona/anna` are two
  personas — Section 16 carries the pair).
- MUST NOT contain `/` (labels have exactly the components the
  registry shows), any code point of Unicode categories Cc
  (control) or Cf (format), or any leading or trailing code point
  with the Unicode `White_Space` property.
- The Unicode version used for NFC and properties is the
  implementation's; the constrained repertoire above keeps
  cross-version drift out of the derivable set for all assigned
  code points.
- The name inside the label is the persona's identity for
  derivation only; changing the public display name without
  intending a new identity requires keeping the label stable.
  Implementations SHOULD therefore store the label separately from
  the display name.

### 6.3 The label register is sensitive

Labels never appear on the protocol wire. They are nevertheless
**sensitive data**: a `group/<digest>` label reveals membership to
anyone who can map the digest, `persona/<name>` reveals the chosen
persona, and the register as a whole is a map of the person's
contexts. Therefore:

- The label register MUST be stored root-encrypted within the
  holder's synchronized state, never in plaintext at rest.
- Implementations MUST NOT embed labels in identifiers, filenames,
  telemetry, or any metadata that leaves the device.
- Section 14 records the leakage consequences.

## 7. Derived service identities (A7, normative)

For infrastructure interactions a person MUST use a **derived
service identity** and MUST NOT present any anchor of Section 6 to a
service. This document adopts the Access Layer's frozen contract
verbatim as the stack-wide rule:

```text
serviceSeed(g) = HKDF-SHA-256(ikm = root IKM, salt = empty, info = "rltp/v1/service-identity/" || <genesis digest of g>, length = 32)
```

- The service identity is the Ed25519 `did:key` of `serviceSeed(g)`
  — deterministic, per group, re-derivable after total device loss.
- The binding member ↔ service identity lives inside the group's
  encrypted log per Access §5.2; it is not this document's concern.
- Granularity is **per group** (the genesis digest is the scope).
  A future casting may add non-group scopes only together with the
  Access Layer, in one move.
- Section 16 carries a seam vector: root IKM plus genesis digest
  MUST produce the same service identity under this document and
  under Access §5.2, byte-exactly.

## 8. Anchors (normative)

### 8.1 Self-certification

An anchor is a **self-certifying identifier**: it binds its own key
material by construction, without any registry, blockchain, domain,
or resolver service. In this profile the binding is maximal and the
history minimal — the identifier *is* the key:

```text
anchor = did:key:z<base58btc(0xed01 || ed25519-public-key)>
```

as specified by the did:key method and the multikey encoding.

### 8.2 Consequences of the empty history

`did:key` anchors cannot rotate: there is no place where a key event
could live. This casting accepts that limitation deliberately
(Section 15.2 records why, and what lifts it):

- Compromise of an anchor's private key is compromise of the anchor.
  There is no in-band recovery; recovery of the *relations* attached
  to a compromised or lost anchor is the subject of *RLTP
  Succession*.
- Verification of any signature by an anchor is offline and
  instantaneous: resolve the key from the identifier, verify. No
  history means nothing to fetch and nothing to be out of date
  about.

### 8.3 The waist rule — stated honestly

Consuming layers and foreign verifiers MUST treat an anchor as an
**opaque, standard-resolvable DID**: no assumption about derivation,
no comparison other than exact string equality, resolution only
through the DID method.

At the same time, the frozen 0.x consumers pin the concrete form:
the Encounter Layer's contact-card schema requires the Ed25519
`did:key` pattern, and the Access Layer names the same interim
profile. Therefore, honestly: **in the 0.x stack the waist is
`did:key`-bound.** A future anchor form (Section 15.2) enters by
satisfying this section *and* by a coordinated recast of the
consumers' pinned patterns — the waist rule's value is that this
recast is confined to those pins and to this document, while
credential semantics, membership semantics, and delivery semantics
do not change.

### 8.4 First contact and the anchor–key binding rule (A2, A3)

- **Offline first contact (A2).** All verification material of a
  context — the assertion key and the key agreement multikey — MUST
  be available to the counterpart at first contact without any
  online resolution. In the native profile the `did:key` anchor *is*
  the assertion key, and the **contact card** (Encounter Layer) is
  the native carrier of the key agreement multikey. No resolver
  service may ever be a precondition of meeting someone.
- **Anchor–key binding (A3).** Every profile MUST define an
  offline-checkable rule that binds verification material to the
  anchor — by containment (`did:key`: the key is the anchor), or by
  a signature under the anchor (the contact card binds the
  agreement key this way), or by a method-defined, self-contained
  binding that travels with the material. An artifact that names an
  anchor but verifies only under material not bound to that anchor
  is **invalid**, and verifiers MUST reject it. Consuming layers
  restate this rule for their artifacts; it originates here.
- **Control proof.** Control of an anchor is proven by signature
  under its assertion key. Artifacts across this stack are secured
  with Data Integrity `eddsa-jcs-2022` (the stack-wide securing
  decision); this document imposes only that the proof's
  verification method MUST resolve from the anchor per A3.

### 8.5 Stability is a chosen position (A9)

Anchors are stable **per person per context** — not per
relationship. Pairwise anchors are excluded as carriers of evidence
in this profile: evidence must accumulate somewhere a witness can be
recognized, and the decomposition's analysis stands — pairwise
granularity makes asserters unrecognizable to third parties. The
price of stability (correlatability of everything one anchor ever
signed, for whoever links it once) is accepted knowingly and is
restated where it is paid (Sections 13, 14). Pairwise *disclosure*
and pairwise *transport* identities remain untouched by this
exclusion, and the door to collector-blind constructions stays open
(Section 15.3) — reserved, not walked through.

## 9. Recovery (normative)

### 9.1 Without custodians (A4)

Recovery MUST NOT require any service, cloud custody, or third
party. The mnemonic in the holder's own keeping, together with the
label register from the holder's own synchronized state, is
sufficient to recover all key material on a fresh device.

### 9.2 The two loss cases (A5)

- **Device loss with the mnemonic intact** is the recovered case:
  re-derive per Sections 5, 7, and 10; restore data state — the
  label register among it — from the holder's synchronized encrypted
  storage.
- **Loss of the mnemonic is cryptographically final.** No mechanism
  in this document or above it restores a lost mnemonic. What the
  protocol offers instead is **social succession** (*RLTP
  Succession*, parked): a **new identity** whose continuity with the
  old one is witnessed by people — and implementations MUST present
  it as that, never as recovery. A user interface that calls
  witnessed succession "account recovery" misstates what was proven.

### 9.3 What the mnemonic restores

The mnemonic reconstructs **key material, not state**.
Implementations MUST make this distinction, and user interfaces
SHOULD state it plainly:

Restored by the mnemonic alone: every anchor key pair, key agreement
key, and service identity — **for every label the holder can name**.

NOT restored by the mnemonic — this is data state, held and
synchronized by the layers above:

- the **label register** (which groups, which personas, which self
  mode). Without it, the holder knows how to derive but not what to
  derive. Implementations MUST persist the label register in the
  holder's synchronized encrypted state (6.3), and recovery UIs
  MUST treat "mnemonic present, register lost" as partial recovery:
  `self` (both modes, Section 10) and any label re-learnable from
  counterparts are recoverable; the rest is not enumerable.
- received credentials, contact memory, received disclosures and
  delivered snapshots, membership documents, and every other
  holding.

A conforming implementation MUST be able to re-derive all key
material from (mnemonic, label register) alone, with no keystore.

## 10. Migration (normative)

A pre-existing Web of Trust identity (wot-spec v0.1) consists of one
Ed25519 `did:key` and one X25519 key, both derived from the person's
BIP-39 mnemonic with the legacy info strings. Migration is a
**derivation rule**, not a data transfer:

- The migrated person's root IKM is the same 64-byte BIP-39 seed
  (Section 4) — the legacy derivation already used it.
- The migrated person's **self context derives with the legacy info
  strings**:

  ```text
  edSeed(self, legacy) = HKDF-SHA-256(ikm = root IKM, salt = empty, info = "wot/identity/ed25519/v1", length = 32)
  xSeed(self, legacy)  = HKDF-SHA-256(ikm = root IKM, salt = empty, info = "wot/encryption/x25519/v1", length = 32)
  ```

  The resulting anchor is byte-identical to the existing identity:
  all edges, memberships, and logs remain attached, and nothing any
  consumer observes changes. Implementations MUST support the legacy
  self derivation.
- The label register records the **self mode**: `labeled` (Section
  5 with label `self`) for identities created under this document,
  `legacy` for adopted ones. One person has exactly one self anchor;
  an implementation MUST NOT derive a second self anchor for a
  person whose register names a mode.
- After total loss of the register, both self candidates are
  derivable from the mnemonic alone; which one is the person's is
  decided by where their relations are (informative: attempt
  `legacy` first for mnemonics that predate adoption — the register
  exists precisely so that this guess is never needed).
- New contexts of a migrated person MUST use Section 5 derivation.
  Existing group memberships of the one-context world remain
  attached to the self anchor — they were made under it and
  membership documents are immutable; groups joined after adoption
  use `group/<digest>` anchors. Both states are legitimate and
  permanent; the visibility layer decides what linking between them
  is disclosed, exactly as for any two contexts.
- Section 16 carries the migration vector: mnemonic → legacy anchor
  and key agreement multikey.

## 11. Profile properties — the graded table (normative honesty)

The decomposition grades every identity profile on four functional
properties (B1–B4). Which grade a group requires is that group's
policy, not this protocol's. The native profile of this casting
(BIP-39 · HKDF labels · Ed25519/X25519 · `did:key` ·
`eddsa-jcs-2022`) grades as follows, and implementations claiming
`rltp-identity@0.2` claim exactly these grades — no better:

| Property | Grades (best → weakest) | **Native profile 0.2** |
|---|---|---|
| **B1** Edge survival across key change | native (identifier stable across key events) · compensated (edge succession, C1) · re-encounter | **re-encounter.** C1 (*RLTP Succession*) is parked; until its re-cast, edges survive an anchor change only by being witnessed anew |
| **B2** Takeover resistance under operational key possession | pre-separated successor anchor · witnessed succession quorum (C1) · none | **none.** Operational possession of an anchor key is control of the anchor. A first-mover race would also grade as *none*; this profile does not pretend otherwise |
| **B3** Time-fixed authorization checkability | trivial (one key, never changed) · history travels along · per-signature delegation proof (C2) | **trivial — and strong.** Precisely because `did:key` never rotates, "was this key authorized then" has an unconditional answer |
| **B4a** Devices sign independently without the root | delegation proofs (C2) · shared seed | **shared seed** |
| **B4b** Device revocation is cryptographically effective | effective (requires a mutable locus: log, card update, or group substrate) · cosmetic | **cosmetic.** Whoever extracts the root IKM can act as any device; removal is bookkeeping, not cryptography |

This table is the honest core of the casting: the native profile is
**deliberately weak where it is weak**, with every gap named and its
compensation either parked (C1) or planned (C2, Section 15.1). A
future profile (Section 15.2) enters by publishing its own row of
this table.

## 12. Conformance

The profile `rltp-identity@0.2` is claimed by an implementation
that:

1. creates identities per Section 3.1, presents human actions per
   3.3, and implements the mnemonic/root-IKM contract of Section 4,
2. derives contexts per Section 5 (both seeds, and the key
   agreement chain of 5.2 through to the contact-card multikey),
3. enforces the closed registry and grammar of Section 6 with
   rejection before derivation, and stores the label register per
   6.3,
4. derives service identities per Section 7,
5. produces anchors per 8.1, obeys the waist rule of 8.3 toward
   foreign anchors, and enforces the binding rule of 8.4,
6. implements recovery per Section 9 (including the A5 presentation
   rule and the partial-recovery rule) and migration per Section 10,
7. claims the property grades of Section 11 as stated, and no
   better,
8. reproduces the vectors of Section 16 bit-exactly, including the
   rejection vectors.

## 13. Security Considerations

- **The mnemonic is a single point of failure by design.** One
  secret reconstructs every context — and its compromise is
  **retroactive**: an attacker with the root IKM derives every
  anchor and thereby links every context of the person, past and
  future, with certainty; the unlinkability of Section 14 is exactly
  as strong as the secrecy of the seed. This is the accepted price
  of the one-secret property; the mitigations are cold storage
  (Section 4) and, until Section 15.1 lands, the honest statement
  that every acting device is fully trusted.
- **No forward secrecy against seed compromise.** `xSeed` is static
  and deterministically re-derivable. An attacker who records
  sealed envelopes and later obtains the root IKM (or a context's
  `xSeed`) decrypts the recorded traffic of that context
  retroactively. The Delivery Contract's sealing provides
  confidentiality against everyone *except* a future holder of this
  material; implementations and threat-model documentation MUST NOT
  claim forward secrecy for it.
- **128-bit floor.** The native profile's twelve words carry 128
  bits of entropy. That is the profile's security level against
  seed-guessing, stated here so that no other number is implied by
  the 256-bit HKDF outputs downstream.
- **No rotation (8.2).** An attacker with an anchor's private key is
  that anchor, indefinitely. Containment is social, not
  cryptographic: witnessed succession devalues the anchor and moves
  its relations. Implementations SHOULD make anchor compromise a
  first-class user flow (trigger succession), not an error state.
- **Domain separation.** The `ed`/`x` prefixes and the Access
  service-identity info string are three disjoint derivation
  families; Section 5.1's argument records why labels cannot
  collide them.
- **Label collision as attack surface.** If an attacker can
  influence a label (a group's genesis digest is
  adversary-influenced input), they still cannot influence the
  derived key beyond selecting *which* fresh key the holder derives
  — HKDF's security does not depend on honest info strings. The
  registry's digest validation (6.1) exists for identity stability
  and seam correctness, not for key security.
- **The derivation's privacy is not secrecy of the scheme.** The
  scheme is public; what protects unlinkability is the seed's
  entropy. Anyone may hypothesize that two anchors share a seed;
  nobody can check it without the seed (HKDF is a PRF; outputs are
  computationally independent without the key).

## 14. Privacy Considerations

- **Unlinkability holds until disclosed — or stolen.** Two anchors
  of one person are unlinkable to any party lacking the seed —
  including co-members, verifiers, and any collector of leaked
  artifacts. Every *legitimate* reduction of that separation is an
  act of the holder, specified by the layers above; theft of the
  seed reduces it without any act (Section 13, first
  consideration).
- **A disclosed linkage is retroactive and permanent.** Because
  anchors are stable, whoever learns a linkage learns it for the
  anchor's whole past and future. The visibility layer must carry
  this warning; this document notes it because stability is a
  property chosen *here*.
- **The label register is a map of the person's life.** Its leakage
  reveals group memberships (digest labels), chosen personas, and
  service relations in one artifact — which is why 6.3 requires
  root-encrypted storage and forbids labels in outbound metadata.
- **The human layer correlates past the cryptography.** A display
  name reused across contexts, or a persona named after the holder,
  links anchors socially with no key material involved. The
  registry cannot prevent this; Section 6.2's separation of label
  and display name at least keeps renaming cheap.
- **Structure is a fingerprint.** Even fully anonymous anchors form
  a graph whose shape can be matched against outside knowledge.
  That residual risk is inherent to stable identifiers and is
  assessed in the trust-model documentation; it is one of the
  motivations for the `pair/` successor (Section 15.3).

## 15. Open Issues

### 15.1 Device keys and the delegation ladder

The shared-seed model of Section 3.2 is the honest floor, not the
goal. The successor is a three-rung ladder, of which substantial
prior work exists as `wot-device-delegation@0.1` (planned draft,
wot-spec `01-wot-identity/004`):

1. **Shared seed** (this casting): devices are root holders;
   removal of a device is not expressible.
2. **Delegation bindings** (prior work, to be re-cast into RLTP
   forms): per-device key pairs authorized by an anchor through a
   signed binding with capabilities and validity window; revocation
   is best-effort, and a compromised device key can backdate
   signatures — the prior draft names this honestly.
3. **Verifiable history** (15.2): device enrollment and revocation
   as key events; strong temporal verification.

Any successor MUST honor the **context-scoping rule**: a device key
authorized for one anchor MUST NOT be reused under another anchor of
the same person — a shared device key is a cryptographically
provable cross-context linker, defeating Section 14's first
guarantee. The expected construction mirrors Section 5 on a
per-device root (`device/` prefix, reserved).

### 15.2 Verifiable key history (the SCID extension)

`did:key` is the smallest self-certifying identifier: identifier =
key, history = empty. The named successor keeps the anchor
self-certifying and adds an append-only, self-signed key event log
(pre-rotation commitments, device events, witnesses optional), in
the KERI family of constructions — enabling rotation and cold roots
without any domain or registry, with the history travelling
alongside credentials like any other artifact.

The event-log **format is deliberately not chosen in this casting**:
the nearest neighboring implementation (the DTGWG "P2P Trust
Stack", which independently chose SCID-based verifiable history over
domain-bound methods) is not yet published, and freezing a format
before comparison would guarantee divergence at the exact point
where convergence is cheap. Two integration paths are kept open:
attaching a history to existing `did:key` anchors (genesis key signs
event 1; known duplicity window before the first rotation), or a
digest-form anchor as a new form under 8.3 with succession linkage
from the old anchor. Either path is a coordinated recast of the
consumers' pinned patterns (8.3, honest form).

### 15.3 Root proofs and pairwise evidence

Two disclosure primitives are anticipated by this document but
specified above it: **root proofs** (proving on demand that two
anchors share a seed — interactively, or designated-verifier so
that leaked proofs convince nobody) and the **`pair/` derivation**
(one anchor per counterpart, with linkage delivered per recipient
rather than standing in credentials — the collector-blind regime
whose prices are recorded in the design journal). This document
reserves the label prefix and guarantees that the derivation tree
has room; whether and when the visibility layer adopts them is its
decision.

### 15.4 Remaining vector debt

Three rejection families are named but not yet vectorized (tooling
decision pending): X25519 low-order/all-zero shared-secret
rejection, non-canonical base58btc rejection, and mnemonic checksum
rejection. They belong to the consuming layers' validation surfaces
as much as to this document; the next casting should place them
deliberately.

## 16. Test Vectors

`vectors/identity-derivation.json`. All values derive from the
public BIP-39 test mnemonic

```text
abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about
```

with empty passphrase, English wordlist. Root IKM (the 64-byte
BIP-39 seed, independently verifiable against public BIP-39
vectors):

```text
5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4
```

Genesis-digest sample (a valid `u`-multibase sha2-256 multihash):
`uEiDYLnFbXqm2cwuJWuk9yNzRmlzWDpCTH6yA_4aP_1z_RA`.

| Label | anchor | keyAgreement |
|---|---|---|
| `self` | `did:key:z6MknWP2Um8T9JL3GeaNHhzNhVCnpgKVrJmoNYsNe3VbsHmT` | `z6LSj6ihSHGAQuokH3F1yZKE6FMEf8A6GwPCiKzHju6NyTMX` |
| `group/uEiDYLnFbXqm2cwuJWuk9yNzRmlzWDpCTH6yA_4aP_1z_RA` | `did:key:z6Mkp252PiZp5e3EzakYaFCbWuJjpCiVfkr2ZffkqyEVAE2t` | `z6LSfGq1jMrqQ3jmQFB1pJrsKvVQhgQxRFtdkpdBYSn6Lum6` |
| `persona/Anna` | `did:key:z6MkkfafvRtofcUe2qRjeN5wWF3pbJ8cX3wM8hPrNc5m6eQi` | `z6LSmJ5NXLqcbrro1dQ3XGmf5D1foCq5PUtRDbNj7GKPjipA` |

Further vectors in the file:

- **Legacy (migration):** info `wot/identity/ed25519/v1` →
  `did:key:z6Mko3ZEjKJWQAM5nDXKoZ9jErvvxbWbYgS8KJXYpC5Hbu8a`, plus
  the legacy X25519 multikey.
- **Service seam:** info
  `rltp/v1/service-identity/<genesis-digest sample>` → the service
  anchor; MUST equal the Access §5.2 derivation byte-exactly.
- **NFC pair:** `persona/Café` composed and decomposed derive the
  same seed after NFC.
- **Case pair (implied by 6.2):** `persona/Anna` and `persona/anna`
  derive different anchors.
- **Rejection labels:** empty label; `persona/` and `group/`
  (empty component); `persona/a/b` (slash in name); the 0.1 group
  string `group/uEiBHZWZvbmRlZC1ncm91cC1kaWdlc3QtZXhhbXBsZQ`
  (declared sha2-256 multihash carrying 29 of 32 digest bytes);
  `pair/x` and `device/x` (reserved); leading whitespace; Cc and Cf
  code points in a name.

A conforming implementation MUST reproduce all derivation values
bit-exactly and MUST reject every rejection label before
derivation.

## Appendix A. Relation to prior wot-spec documents (informative)

`wot-identity@0.1` (German) specified one identity key and one
encryption key derived from the full BIP-39 seed with the
`wot/identity/ed25519/v1` and `wot/encryption/x25519/v1` info
strings, the did:key form, and resolution. This document generalizes
it without moving it: the same seed remains the root IKM, the legacy
derivation remains valid as the migrated self mode (Section 10), and
derivation gains the label dimension for every further context. A
migrated person's observable identity does not change — which is the
migration argument in one sentence.

## Appendix B. Requirements coverage (informative)

Cast against `design/identitaets-schicht-2026-08.md`, I-list
Revision 3:

| Requirement | Where |
|---|---|
| A1 self-creation | 3.1 |
| A2 offline first contact | 8.4 |
| A3 anchor–key binding | 8.4 |
| A4 recovery without custodians | 9.1 |
| A5 honesty about the second loss case | 9.2 |
| A6 separated key purposes | 5.1 (ed/x domain separation) |
| A7 derived service identities | 7 (Access §5.2 contract, seam vector) |
| A8 operability without cryptography knowledge | 3.3 (normative table) |
| A9 anchor stability as chosen position | 8.5 |
| B1–B4 graded properties | 11 (native profile row) |
| C1 edge succession | 11 (B1/B2), status parked, *RLTP Succession* |
| C2 delegation proofs | 15.1 (ladder rung 2, prior work wot-spec 004) |
| IO-1/IO-4 continuity, device model | 15.1, 15.2 |
| IO-3 member identity scoping | 6.1 (`group/<digest>`) |
| IO-5 migration burden | 10 (legacy derivation rule, vector) |
| IO-6 grade requirements as group policy | 11 (preamble) |
