# RLTP Identity Layer

**Real Life Trust Protocol — Layer 1: Identity**

- **Status:** Editor's Draft
- **Version:** 0.1.0-draft (first casting)
- **Editors:** Anton Tranelis
- **Date:** 2026-08-22
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Conformance profile:** `rltp-identity@0.1` (draft)
- **Supersedes on adoption:** `01-wot-identity/001-identitaet-und-schluesselableitung.md`
  and `003-did-resolution.md` (wot-spec v0.1, German). The planned
  device-delegation profile `01-wot-identity/004-device-key-delegation.md`
  is not superseded; it is referenced as prior work by Section 14.1.

## Abstract

This document specifies the Identity layer of the Real Life Trust
Protocol: how a person's cryptographic identity is rooted, derived, and
presented to every other layer.

A person holds **one root secret** and derives from it **one anchor per
context**: one for their personal community, one per group they join,
one per public persona they choose to maintain. Derivation is
deterministic — the root reconstructs every anchor — and one-way:
without the root, two anchors of the same person are unlinkable.

An anchor's outside face is a **self-certifying identifier**: a DID
that binds its own key material without any registry, resolver
infrastructure, or network access. This casting normatively specifies
the smallest self-certifying form, `did:key`, in which the identifier
is the key and the key history is empty. The extension to anchors with
a verifiable key history — enabling rotation, per-device keys, and
recovery from key compromise — is a named, deliberately open successor
(Section 14).

What an anchor *means* — who may link it to a person or to another
anchor — is not decided here. Derivation determines how many anchors
exist; **disclosure determines what they mean**, and disclosure is
specified by the layers above. This document only guarantees that the
separation exists: anchors of one person share no derivable relation
visible to anyone who lacks the root.

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

This is the **first casting**. It has not yet been through a review
round. It is cast against the requirements list of the layer's
decomposition (`design/identitaets-schicht-2026-08.md`, I-list
Revision 3): the exclusion criteria A1–A9 are normative sections of
this document, the graded properties B1–B4 are stated honestly for
the native profile in Section 10, and the compensations C1/C2 are
referenced with their real status (C1 parked, C2 planned). Appendix B
maps every requirement to its section. Its design decisions were
pre-run executably: the derivation scheme, the label registry, and
the unlinkability claims of this document are exercised with real
WebCrypto credentials by the graph simulator
(`simulator/graph-web.mjs`), whose own adversarial review and the
resulting invariants (deterministic replay, strict verification,
append-only publication) precede this text. Known open questions are
collected in Section 14.

This layer defines **no wire artifact**. Its normative surface is the
derivation scheme, the label registry, the anchor form, and the rules
it imposes on consuming layers. Its test vectors are derivation
vectors (Section 15).

## 1. Introduction (informative)

### 1.1 Essence

> A person is one root secret. Everything a person *is* toward a
> context — their personal community, a group, the public — is an
> anchor derived from that root: reconstructible by its holder,
> unlinkable for everyone else, and resolvable by anyone as a plain
> DID.

Three consequences shape this document:

1. **One backup.** The root (in practice: twelve words) is the only
   secret a person must keep. Every anchor, for every context past and
   future, is re-derivable from it. There is no keystore to back up
   and no per-context enrollment secret.
2. **Separation by construction, meaning by disclosure.** Contexts are
   separated cryptographically, not by policy: linking two anchors
   requires either the root or an act of disclosure by the holder.
   The disclosure acts themselves — to a contact, to a group, to
   everyone — belong to the layers above; this document guarantees
   only that there is something to disclose.
3. **The waist stays narrow.** To every consumer, an anchor is an
   opaque, standard-resolvable DID. Nothing on the wire reveals how an
   anchor was derived, what label produced it, or whether it was
   derived at all. Interoperability with neighboring ecosystems
   happens at this waist.

### 1.2 The derivation is private

The derivation scheme of this document is a **convention of the
holder**, not a claim on the wire. No verifier ever checks that an
anchor was HKDF-derived; no credential ever names a label. This has
two consequences worth stating plainly. First, migration is trivial:
a pre-existing key can serve as an anchor without anyone being able to
tell the difference (Section 9). Second, proving that two anchors
share a root is an *act* — a future disclosure primitive — not a
property a third party could ever compute (Section 14.3).

### 1.3 Position in the stack

The Encounter Layer issues credentials **between anchors**. The
Delivery Contract seals envelopes **to anchors**. Membership and
Access admit **anchors** to groups. Succession replaces **an anchor**
while preserving its relations. All of them consume this document
through two rules only: an anchor is an opaque resolvable DID
(Section 7.3), and key material for signing and key agreement exists
per anchor (Section 5).

## 2. Terminology

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be
interpreted as described in BCP 14 (RFC 2119, RFC 8174) when, and only
when, they appear in all capitals.

- **Root**: the person's single master secret, 256 bits.
- **Context**: a social surface toward which a person acts under one
  identity: their personal community, one group, one public persona.
- **Label**: the canonical string naming a context in the derivation
  (Section 6).
- **Anchor**: the DID a person presents toward one context. Evidence
  accumulates on anchors.
- **Anchor key pair**: the Ed25519 assertion key pair of an anchor.
- **Key agreement seed**: the X25519 seed derived alongside each
  anchor for sealing (consumed by the Delivery Contract).
- **Self anchor**: the anchor of the person's personal community,
  label `self`. Under the converged Encounter Layer profile, this is
  the anchor under which encounters are performed.
- **Holder**: the person controlling the root.

## 3. Creation and the key hierarchy (normative)

### 3.1 Self-creation (A1)

An identity exists because someone brings it into existence — by
generating entropy, nothing more. No issuer, no registry, no domain,
and no service participates in creation or is a condition of
existence. An implementation MUST NOT require any online interaction
to create an identity or to derive any anchor.

### 3.2 The hierarchy

The hierarchy of `rltp-identity@0.1` has two levels:

```text
root (256 bit, cold; encoded as 12 words)
 └── per context: anchor key pair (Ed25519) + key agreement seed (X25519)
```

- The root MUST NOT be used directly as a signing key.
- Anchor key pairs MUST NOT be reused across contexts: one label, one
  key pair. Deriving two labels to intentionally equal keys is not
  possible under Section 5; presenting one anchor under two contexts
  is a disclosure decision of the holder, not a key-reuse mechanism.
- A third level — per-device operational keys authorized by an anchor —
  is **not part of this profile**. In `rltp-identity@0.1`, a device
  that acts for a person holds the root (the shared-seed model).
  Section 14.1 names the successor and the constraint any successor
  MUST honor.

## 4. The root (normative)

- The root MUST be 256 bits of uniformly random entropy.
- The RECOMMENDED user-facing encoding is a BIP-39 mnemonic of twelve
  words from the English wordlist. Implementations MUST NOT localize
  the wordlist: recovery phrases are exchanged and typed across
  implementations, and a single wordlist is what makes them portable.
- The root SHOULD be treated as recovery material: stored coldly,
  entered rarely. This casting's device model (Section 3) forces
  operational presence of the root on acting devices; Section 14.1
  exists to lift that.
- Implementations MUST NOT derive anything from the root except
  through Section 5, and MUST NOT transmit the root, any derived
  seed, or any private key off the device that holds it, except as
  user-initiated recovery input on another device of the same person.

## 5. Derivation (normative)

For a context with canonical label `L` (Section 6):

```text
edSeed(L) = HKDF-SHA-256(ikm = root, salt = empty, info = "rltp/anchor/ed/" || L, length = 32)
xSeed(L)  = HKDF-SHA-256(ikm = root, salt = empty, info = "rltp/anchor/x/"  || L, length = 32)
```

- `edSeed(L)` is the Ed25519 private-key seed of the anchor. The
  anchor is the `did:key` of the resulting public key (Section 7).
- `xSeed(L)` is the X25519 seed for key agreement toward this
  context. Its public representation and use are specified by the
  Delivery Contract; this document only fixes its derivation, so that
  recovery restores it.
- The salt MUST be empty. The info strings MUST be exactly the ASCII
  prefixes above followed by the label bytes. The prefixes are the
  domain separation between signing and key agreement material;
  implementations MUST NOT derive both from one info string.
- Derivation MUST be deterministic: the same root and label produce
  the same seeds on every conforming implementation. Section 14 gives
  vectors.

Derivation is lazy by nature: an anchor exists the moment its label is
first derived, and re-derives identically forever after. There is no
registration step and no state.

## 6. Context labels (normative)

### 6.1 Registry

| Label | Context | Notes |
|---|---|---|
| `self` | the personal community | exactly one; the anchor under which encounters run |
| `group/<digest>` | one group | `<digest>` is the group's genesis digest (multibase, as issued by the Membership Tasks), never a human-readable name |
| `persona/<name>` | one public persona | `<name>` is the persona's chosen public name (Section 6.2); a person MAY hold several personas |
| `service/<scope>` | one infrastructure relation | a deterministic pseudonym toward infrastructure (brokers, relays, registries), so that operating a service never requires seeing a social anchor (A7). `<scope>` names the infrastructure relation; its granularity (per operator, per endpoint) is chosen by the consuming layer's policy |

Prefixes `pair/` and `device/` are **reserved** for the successors
named in Section 14 and MUST NOT be assigned by implementations of
this profile.

Unknown labels are permitted — the registry constrains the *meaning*
of the listed prefixes, not the set of derivable labels — but an
implementation that invents labels outside the registry accepts that
no other layer of this protocol will attach semantics to them.

### 6.2 Canonicalization

Labels are UTF-8 strings. Because two byte-different labels derive two
different anchors, label equality is anchor identity, and sloppy
normalization silently splits an identity:

- Labels MUST be normalized to Unicode NFC before derivation.
- Labels MUST NOT contain code points from the Unicode categories
  Cc (control) or Cf (format), and MUST NOT begin or end with
  whitespace.
- `group/` labels take the genesis digest **verbatim** (it is ASCII
  multibase; no normalization applies). Implementations MUST use the
  digest, never a display name: display names collide, drift, and
  translate; digests do none of these.
- `persona/` names are chosen by the holder. The name inside the
  label is the persona's identity for derivation only; changing the
  public display name of a persona without intending a new identity
  requires keeping the label stable. Implementations SHOULD therefore
  store the label separately from the display name.

### 6.3 Labels are local

Labels never appear on the wire. They exist only inside the holder's
derivation. Consequently they need no privacy protection of their own —
but implementations MUST NOT embed labels in identifiers, filenames,
or metadata that leave the device, because a leaked label together
with a future root-proof primitive (Section 14.3) would narrow the
proof's audience in ways the holder did not choose.

## 7. Anchors (normative)

### 7.1 Self-certification

An anchor is a **self-certifying identifier**: it binds its own key
material by construction, without any registry, blockchain, domain,
or resolver service. In this profile the binding is maximal and the
history minimal — the identifier *is* the key:

```text
anchor = did:key:z<base58btc(0xed01 || ed25519-public-key)>
```

as specified by the did:key method and the multikey encoding.

### 7.2 Consequences of the empty history

`did:key` anchors cannot rotate: there is no place where a key event
could live. This casting accepts that limitation deliberately
(Section 14.2 records why, and what lifts it):

- Compromise of an anchor's private key is compromise of the anchor.
  There is no in-band recovery; recovery of the *relations* attached
  to a compromised or lost anchor is the subject of *RLTP Succession*.
- Verification of any signature by an anchor is offline and
  instantaneous: resolve the key from the identifier, verify. No
  history means nothing to fetch and nothing to be out of date about.

### 7.3 The waist rule

Consuming layers and foreign verifiers MUST treat an anchor as an
**opaque, standard-resolvable DID**:

- They MUST NOT assume anything about how it was derived, and MUST
  NOT require evidence of derivation.
- They MUST NOT compare anchors other than by exact string equality.
- They MUST resolve key material only through the DID method.

This rule is what keeps the waist narrow: a future anchor form with a
verifiable history (Section 14.2) enters the protocol by satisfying
this section, and nothing above it changes.

### 7.4 First contact and the anchor–key binding rule (A2, A3)

- **Offline first contact (A2).** All verification material of an
  anchor — the assertion key and, where the relation requires
  sealing, the key agreement key — MUST be available to the
  counterpart at first contact without any online resolution. In the
  native profile the `did:key` anchor *is* the assertion key, and the
  **contact card** (Encounter Layer) is the native carrier of the
  remainder. No resolver service may ever be a precondition of
  meeting someone.
- **Anchor–key binding (A3).** Every profile MUST define an
  offline-checkable rule that binds verification material to the
  anchor — by containment (`did:key`: the key is the anchor) or by a
  method-defined, self-contained binding that travels with the
  material. An artifact that names an anchor but verifies only under
  material not bound to that anchor is **invalid**, and verifiers
  MUST reject it. Consuming layers restate this rule for their
  artifacts; it originates here.
- **Control proof.** Control of an anchor is proven by signature
  under its assertion key. Artifacts across this stack are secured
  with Data Integrity `eddsa-jcs-2022` (the stack-wide securing
  decision); this document imposes only that the proof's verification
  method MUST resolve from the anchor per A3.

### 7.5 Stability is a chosen position (A9)

Anchors are stable **per person per context** — not per relationship.
Pairwise anchors are excluded as carriers of evidence in this
profile: evidence must accumulate somewhere a witness can be
recognized, and the decomposition's analysis stands — pairwise
granularity makes asserters unrecognizable to third parties. The
price of stability (correlatability of everything one anchor ever
signed, for whoever links it once) is accepted knowingly and is
restated where it is paid (Section 13). Pairwise *disclosure* and
pairwise *transport* identities remain untouched by this exclusion,
and the door to collector-blind constructions stays open
(Section 14.3) — reserved, not walked through.

## 8. Recovery (normative)

### 8.1 Without custodians (A4)

Recovery MUST NOT require any service, cloud custody, or third party.
The root in the holder's own keeping is sufficient to recover all key
material on a fresh device.

### 8.2 The two loss cases (A5)

- **Device loss with the root intact** is the recovered case:
  re-derive per Section 5, restore data state from the holder's
  synchronized encrypted storage.
- **Loss of the root is cryptographically final.** No mechanism in
  this document or above it restores a lost root. What the protocol
  offers instead is **social succession** (*RLTP Succession*,
  parked): a **new identity** whose continuity with the old one is
  witnessed by people — and implementations MUST present it as that,
  never as recovery. A user interface that calls witnessed succession
  "account recovery" misstates what was proven.

Every human-triggered mechanism in this section MUST map to a
nameable everyday action (A8); a profile that introduces a second
long-term secret MUST state that cost explicitly where the profile is
defined.

### 8.3 What the root restores

The root reconstructs **key material, not state**. Implementations
MUST make this distinction, and user interfaces SHOULD state it
plainly, because "twelve words restore everything" over-promises:

Restored by the root alone:

- every anchor key pair and key agreement seed, for every label the
  holder re-derives.

NOT restored by the root — this is data state, held and synchronized
by the layers above (vault, delivery, membership state):

- the *list of labels* the holder has used (which groups, which
  personas). Without it, the holder knows how to derive but not what
  to derive. Implementations MUST persist the label list in the
  holder's synchronized encrypted state.
- received credentials, contact memory (names, display data),
  received disclosures and delivered snapshots, membership documents,
  and every other holding.

A conforming implementation MUST be able to re-derive all anchors
from (root, label list) alone, with no keystore.

## 9. Migration (normative)

A pre-existing Web of Trust identity consists of one Ed25519 `did:key`
derived directly from a BIP-39 mnemonic (wot-spec v0.1). Such an
identity is adopted as follows:

- The existing DID **becomes the person's self anchor** by
  declaration. Because derivation is private (Section 1.2), no
  consumer can nor need distinguish an adopted self anchor from a
  derived one; all existing edges, memberships, and logs remain
  attached and remain valid.
- New contexts of the same person MUST use Section 5 derivation from
  the same root entropy.
- Implementations MUST NOT re-derive a *different* self anchor for an
  identity that already has one: one person, one self anchor, and the
  adopted one wins. The label `self` is thereby bound (not derived)
  for migrated identities; Section 8's (root, label list) rule reads
  the binding from synchronized state like any other label.

## 10. Profile properties — the graded table (normative honesty)

The decomposition grades every identity profile on four functional
properties (B1–B4). Which grade a group requires is that group's
policy, not this protocol's. The native profile of this casting
(BIP-39 root · HKDF labels · Ed25519/X25519 · `did:key` ·
`eddsa-jcs-2022`) grades as follows, and implementations claiming
`rltp-identity@0.1` claim exactly these grades — no better:

| Property | Grades (best → weakest) | **Native profile 0.1** |
|---|---|---|
| **B1** Edge survival across key change | native (identifier stable across key events) · compensated (edge succession, C1) · re-encounter | **re-encounter.** C1 (*RLTP Succession*) is parked; until its re-cast, edges survive an anchor change only by being witnessed anew |
| **B2** Takeover resistance under operational key possession | pre-separated successor anchor · witnessed succession quorum (C1) · none | **none.** Operational possession of an anchor key is control of the anchor. A first-mover race would also grade as *none*; this profile does not pretend otherwise |
| **B3** Time-fixed authorization checkability | trivial (one key, never changed) · history travels along · per-signature delegation proof (C2) | **trivial — and strong.** Precisely because `did:key` never rotates, "was this key authorized then" has an unconditional answer |
| **B4a** Devices sign independently without the root | delegation proofs (C2) · shared seed | **shared seed** |
| **B4b** Device revocation is cryptographically effective | effective (requires a mutable locus: log, card update, or group substrate) · cosmetic | **cosmetic.** Whoever extracts the root can act as any device; removal is bookkeeping, not cryptography |

This table is the honest core of the casting: the native profile is
**deliberately weak where it is weak**, with every gap named and its
compensation either parked (C1) or planned (C2, Section 14.1). A
future profile (Section 14.2) enters by publishing its own row of
this table.

## 11. Conformance

The profile `rltp-identity@0.1` is claimed by an implementation that:

1. creates identities per Section 3.1 and generates roots per
   Section 4,
2. derives per Section 5 and canonicalizes labels per Section 6,
3. produces anchors per Section 7.1, obeys the waist rule of 7.3
   toward foreign anchors, and enforces the binding rule of 7.4,
4. implements recovery per Section 8 (including the A5 presentation
   rule) and migration per Section 9,
5. claims the property grades of Section 10 as stated, and no better,
6. reproduces the vectors of Section 15 bit-exactly.

## 12. Security Considerations

- **The root is a single point of failure by design.** One secret
  reconstructs every context. This is the accepted price of the
  one-backup property; the mitigations are cold storage (Section 4)
  and, until Section 14.1 lands, the honest statement that every
  acting device is fully trusted.
- **No rotation (7.2).** An attacker with an anchor's private key is
  that anchor, indefinitely. Containment is social, not
  cryptographic: witnessed succession devalues the anchor and moves
  its relations. Implementations SHOULD make anchor compromise a
  first-class user flow (trigger succession), not an error state.
- **Domain separation.** The `ed`/`x` info prefixes prevent cross-use
  of signing and agreement material. Implementations MUST NOT add
  further key types under these prefixes; a future key type gets a
  future prefix through a new casting.
- **Label collision as attack surface.** If an attacker can influence
  a label (for example, a group that chooses its genesis digest
  adversarially), they still cannot influence the derived key beyond
  selecting *which* fresh key the holder derives — HKDF's security
  does not depend on honest info strings. The registry's rule that
  `group/` labels are digests (high-entropy, issuer-fixed) exists for
  identity stability, not for key security.
- **The derivation's privacy is not secrecy of the scheme.** The
  scheme is public; what protects unlinkability is the root's
  entropy. Anyone may hypothesize that two anchors share a root;
  nobody can check it (HKDF with a 256-bit ikm is a PRF; outputs are
  computationally independent without the key).

## 13. Privacy Considerations

- **Unlinkability holds exactly until disclosed.** Two anchors of one
  person are unlinkable to any party lacking the root — including
  co-members, verifiers, and any collector of leaked artifacts. Every
  reduction of that separation is an act of the holder, specified by
  the layers above. This document deliberately provides no mechanism
  by which a third party could enumerate or correlate a person's
  contexts.
- **A disclosed linkage is retroactive and permanent.** Because
  anchors are stable, whoever learns a linkage learns it for the
  anchor's whole past and future. The visibility layer must carry
  this warning; this document notes it because stability is a
  property chosen *here*.
- **The human layer correlates past the cryptography.** A display
  name reused across contexts, or a persona named after the holder,
  links anchors socially with no key material involved. The registry
  cannot prevent this; Section 6.2's separation of label and display
  name at least keeps renaming cheap.
- **Structure is a fingerprint.** Even fully anonymous anchors form a
  graph whose shape can be matched against outside knowledge. That
  residual risk is inherent to stable identifiers and is assessed in
  the trust-model documentation; it is one of the motivations for the
  `pair/` successor (Section 14.3).

## 14. Open Issues

### 14.1 Device keys and the delegation ladder

The shared-seed model of Section 3 is the honest floor, not the goal.
The successor is a three-rung ladder, of which substantial prior work
exists as `wot-device-delegation@0.1` (planned draft, wot-spec
`01-wot-identity/004`):

1. **Shared seed** (this casting): devices are root holders; removal
   of a device is not expressible.
2. **Delegation bindings** (prior work, to be re-cast into RLTP
   forms): per-device key pairs authorized by an anchor through a
   signed binding with capabilities and validity window; revocation
   is best-effort, and a compromised device key can backdate
   signatures — the prior draft names this honestly.
3. **Verifiable history** (13.2): device enrollment and revocation as
   key events; strong temporal verification.

Any successor MUST honor the **context-scoping rule**: a device key
authorized for one anchor MUST NOT be reused under another anchor of
the same person — a shared device key is a cryptographically provable
cross-context linker, defeating Section 12's first guarantee. The
expected construction mirrors Section 5 on a per-device root
(`device/` prefix, reserved).

### 14.2 Verifiable key history (the SCID extension)

`did:key` is the smallest self-certifying identifier: identifier =
key, history = empty. The named successor keeps the anchor
self-certifying and adds an append-only, self-signed key event log
(pre-rotation commitments, device events, witnesses optional), in the
KERI family of constructions — enabling rotation and cold roots
without any domain or registry, with the history travelling alongside
credentials like any other artifact.

The event-log **format is deliberately not chosen in this casting**:
the nearest neighboring implementation (the DTGWG "P2P Trust Stack",
which independently chose SCID-based verifiable history over
domain-bound methods) is not yet published, and freezing a format
before comparison would guarantee divergence at the exact point where
convergence is cheap. Two integration paths are kept open by the
waist rule (7.3): attaching a history to existing `did:key` anchors
(genesis key signs event 1; known duplicity window before the first
rotation), or a digest-form anchor as a new form under 7.3 with
succession linkage from the old anchor.

### 14.3 Root proofs and pairwise evidence

Two disclosure primitives are anticipated by this document but
specified above it: **root proofs** (proving on demand that two
anchors share a root — interactively, or designated-verifier so that
leaked proofs convince nobody) and the **`pair/` derivation** (one
anchor per counterpart, with linkage delivered per recipient rather
than standing in credentials — the collector-blind regime whose
prices are recorded in the design journal). This document reserves
the label prefix and guarantees that the derivation tree has room;
whether and when the visibility layer adopts them is its decision.

### 14.4 Key agreement representation

Section 5 derives `xSeed(L)`, and the Delivery Contract consumes it.
Whether the X25519 public key is published as a second `did:key`, as
a verification method of the anchor, or inside the contact card is
currently fixed by the Delivery Contract's existing practice; a
future casting should state the representation here, once, and the
Delivery Contract should reference it.

## 15. Test Vectors

`vectors/identity-derivation.json`. Root
`000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f`
(hex), salt empty, HKDF-SHA-256:

| Label | edSeed (hex) | anchor |
|---|---|---|
| `self` | `1fa71d41eeaef1f4bff377b7cf22aa60dd8de6bf72dff22026771474e7a3ea53` | `did:key:z6MksW2B4KMzUaivvq53yi64jpeHWweMsgWZap9m3KoN9fiu` |
| `group/uEiBHZWZvbmRlZC1ncm91cC1kaWdlc3QtZXhhbXBsZQ` | `269085e44153f2a807f95dbb0c6dd2788ddc12f0b8b82cbf4f01e467e9d8e3e9` | `did:key:z6MknCiUHmdJacGiDBuB1V9uQL8fieLPf3FKaybbSf7oz7Pn` |
| `persona/Anna` | `13d727899c7cdc101160396d5ca1f80bdbbd4357134aa60ca0633550e44163f0` | `did:key:z6MkuLvvq6jEHrERXd89xvgkCK1MpScXA1FZY78k3VEfWN1N` |

The full file additionally carries the `xSeed` values. A conforming
implementation MUST reproduce all values bit-exactly. The vectors
were computed by the same WebCrypto code the graph simulator executes
(`simulator/graph-web.mjs`).

## Appendix A. Relation to prior wot-spec documents (informative)

`wot-identity@0.1` (German) specified one identity key derived
directly from the mnemonic, its did:key form, and resolution. This
document generalizes it: the single identity key becomes the adopted
self anchor of a many-context person (Section 9), derivation gains
the label dimension, and everything a consumer could observe stays
the same — which is the migration argument in one sentence.

## Appendix B. Requirements coverage (informative)

Cast against `design/identitaets-schicht-2026-08.md`, I-list
Revision 3:

| Requirement | Where |
|---|---|
| A1 self-creation | 3.1 |
| A2 offline first contact | 7.4 |
| A3 anchor–key binding | 7.4 |
| A4 recovery without custodians | 8.1 |
| A5 honesty about the second loss case | 8.2 |
| A6 separated key purposes | 5 (ed/x domain separation) |
| A7 derived service identities | 6.1 (`service/<scope>`) |
| A8 operability without cryptography knowledge | 8.2 (closing rule) |
| A9 anchor stability as chosen position | 7.5 |
| B1–B4 graded properties | 10 (native profile row) |
| C1 edge succession | 10 (B1/B2), status parked, *RLTP Succession* |
| C2 delegation proofs | 14.1 (ladder rung 2, prior work wot-spec 004) |
| IO-1/IO-4 continuity, device model | 14.1, 14.2 |
| IO-3 member identity scoping | 6.1 (`group/<digest>`), §6a of the decomposition executed by the simulator |
| IO-5 migration burden | 9 |
| IO-6 grade requirements as group policy | 10 (preamble) |
