# RLTP Delivery Contract

**Real Life Trust Protocol — service contract: Delivery**

- **Status:** Editor's Draft
- **Version:** 0.1.0-draft (first casting)
- **Editors:** Anton Tranelis
- **Date:** 2026-08-10
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Task-type namespace:** `https://real-life.org/trust-tasks/`
- **Conformance profile:** `rltp-delivery@0.1` (draft)
- **Position:** not a layer. Delivery is the service behind the port
  that Encounter §11 requires; every layer may use it, none depends on
  its internals.

## Abstract

This document specifies how RLTP documents travel between people. The
delivery service moves **signed, anchor-encrypted, typed documents**
from one person to another — eventually, at least once, never silently
lost — and tells both sides honestly what it knows: the sender its
transport state, the receiver nothing the content does not prove
itself, and the sender **never** what the receiver decided.

Messages are **Trust Task documents** of private, versioned types under
`https://real-life.org/trust-tasks/` (ToIP DTGWG Trust Tasks framework,
§6.5 private specifications). This casting registers three types —
`encounter-bundle`, `delivery-ack`, `encounter-credential-delivery` —
and the sealed envelope they travel in. Enactment-bound documents carry
the framework's `ceremony` member with the RLTP enactment binding as
its `enactment` identifier, which makes RLTP encounters first-class
DTGWG enactments.

## Status of This Document

First casting, from the decomposition
`../design/zustell-contract-zerlegung-2026-08.md` (requirements
D1–D13) and two decided questions: the reception acknowledgement means
**arrival** (DO-1), and the sealing construction transcribes the
deployed Sync-001 ECIES (DO-2). It exists to close the delivery-shaped
blockers of Encounter review round 5. It awaits adversarial review.
Open issues: Section 12.

## 1. Introduction (informative)

### 1.1 Essence and principles

Three commitments shape every rule here:

- **Eventually, at least once, never silently lost.** Delivery time is
  unbounded and never affects validity (Encounter 1.3). At-least-once
  makes duplicates and lost acknowledgements the *normal case*, so
  idempotency is law, not precaution. A document the service accepted
  is delivered or reported failed; silent loss is non-conformant.
- **Documents and promises, never pipes.** No normative statement in
  this contract mentions a relay, a broker, a socket, or a wire.
  Today's WebSocket relay is one adapter below the port line; a second
  broker, a P2P mesh, or a USB stick are others. Transport-internal
  signals (queue clearing, registration) never appear here.
- **The acknowledgement is arrival, and arrival only.** It is
  machine-generated at durable recording, waits on no human, and
  carries no statement about any decision. The mutual-recognition
  moment of an encounter is carried by the counter-credential itself,
  not by any receipt.

### 1.2 The user experience this serves (informative)

The one-scan ceremony's UX depends on fast channel feedback: after A
scans and confirms, A's app shows a waiting state; the arrival
acknowledgement dissolves it ("nothing more to do on your side"), and
its absence within `ack-wait` flips A's screen to the two-way QR
("show this to B"). When B's counter-credential later arrives, both
sides see the relation confirmed. Section 8 gives both state machines.

## 2. Conventions and Terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" are to be interpreted as described in BCP 14 [RFC2119]
[RFC8174] when, and only when, they appear in all capitals.

The **interim securing profile** of Encounter 2.3 applies (did:key
anchors, Ed25519/X25519, `eddsa-jcs-2022` for embedded proofs, JCS,
SHA-256, multibase, RFC3339-UTC-`Z` timestamps).

**Document** — a Trust Task document of a registered RLTP type
(Section 4). **Document digest** — `SHA-256(JCS(document))` over the
plaintext document, multibase-`base64url`; the document's identity for
idempotency and acknowledgement reference. **Sealed envelope** — the
encrypted form in which a document travels (Section 5). **Disposition**
— the receiver's classification of a processed envelope (Section 6).

| Term | Fragment |
|---|---|
| Document digest | `#DocumentDigest` |
| Sealed envelope | `#SealedEnvelope` |
| Disposition | `#Disposition` |
| Delivery acknowledgement | `#DeliveryAck` |

## 3. The Document Profile

RLTP delivery documents are Trust Task documents [TT] under the private
task-type rules of TT §6.5, with this profile:

- `id` — REQUIRED; UUID v4.
- `type` — REQUIRED; a registered RLTP task type
  (`https://real-life.org/trust-tasks/<slug>/<MAJOR.MINOR>`). Slugs
  never match `^trust-task(-|/)?` (TT §6.1 reservation).
- `issuer`, `recipient` — REQUIRED, in-band, as anchors. A consumer
  MUST reject a document whose `recipient` is not its own anchor
  (TT §7.2 rule 5 — the receiver principle at the envelope level).
- `threadId` — REQUIRED on responses (set to the `threadId` of the
  document responded to), REQUIRED on thread-opening documents (fresh
  UUID v4).
- `ceremony` — REQUIRED on enactment-bound documents:
  `{"enactment": <enactment binding per Encounter 5.4>, "step":
  <step name>}`. Membership of an enactment grants no authority
  (TT §7.2 rule 9); the member is provenance.
- `issuedAt` — REQUIRED.
- `expiresAt` — MUST be absent. Delivery time is unbounded; validity
  windows live in payloads and ceremonies, with issuance semantics.
- `proof` — MUST be absent in the types of this casting. Every type
  registered here declares itself **not for third-party reliance**:
  authenticity comes from the sealed envelope's addressing and from
  the signed payloads (credentials, cards) inside. The first type
  whose documents are retained or relied on by third parties MUST
  carry a proof per TT §4.7.1 — and does not exist yet.
- `payload` — REQUIRED; governed by the type's bundled JSON Schema.
  **Schemas are bundled with implementations, never resolved at
  runtime** (offline rule).

Unknown `type` → the document MUST be rejected with a named error
(Section 6); a document that would have an effect is never silently
ignored.

## 4. Registered Task Types

### 4.1 `encounter-bundle/0.1`

The transmission of the one-scan ceremony (Encounter 5.8): the
scanner's sent card and step credential.

- `payload`: `{ "card": <contact card per Encounter schema>,
  "credential": <encounter credential per Encounter schema> }`.
- `threadId`: fresh (opens the exchange).
- `ceremony`: REQUIRED — `enactment` = the enactment binding, `step` =
  `"scan"`.
- Consistency rules the receiver MUST check before recording
  (Encounter 5.8 order: **validate, then consume**): card and
  credential verify under the same issuer anchor = `issuer`; the
  credential's bound challenge is the receiver's own displayed
  challenge; the card carries a fresh sent-challenge; the `ceremony`
  member's `enactment` recomputes per Encounter 5.4.

### 4.2 `delivery-ack/0.1`

The arrival acknowledgement (DO-1).

- `payload`: `{ "ref": <document digest of the acknowledged document>,
  "meaning": "received" }`.
- `threadId`: = the acknowledged document's `threadId`.
- Generation: **automatic at durable recording** of the referenced
  document's effect (for an `encounter-bundle`: at enactment-record
  creation). It MUST NOT wait for, depend on, or reveal any human
  decision, and MUST NOT be sent for a document that was rejected.
- Meaning, normatively: *the document reached the recipient's
  authenticated device and its effect is durably recorded.* Nothing
  more. Implementations MUST NOT present it as acceptance,
  verification success beyond the recording gate, or any human act
  (Encounter 7.4). `meaning` is a closed one-value set in 0.1;
  future stages register new values, never reinterpret this one.

### 4.3 `encounter-credential-delivery/0.1`

Post-enactment delivery of a step credential (two-way ceremony, or the
counter-step of the one-scan ceremony).

- `payload`: `{ "credential": <encounter credential> }`.
- `threadId`: fresh for two-way deliveries; = the bundle's `threadId`
  for a one-scan counter-step.
- `ceremony`: REQUIRED — `enactment` = the enactment binding, `step` =
  `"counter"` or `"deliver"`.
- Acceptance of the credential itself is entirely Encounter 5.6; this
  type only carries it. A `delivery-ack` is sent at durable buffering
  of the credential, before and independent of Encounter acceptance.

## 5. The Sealed Envelope

A document travels sealed to its recipient:

```
seal = { "epk": <ephemeral X25519 public key, base64url>,
         "nonce": <96-bit AES-GCM nonce, base64url>,
         "ciphertext": <AES-256-GCM over plaintext, base64url> }
```

- **Plaintext** is the JCS canonicalization of the document (UTF-8).
- **Key derivation:** ephemeral X25519 key pair; shared secret =
  X25519(ephemeral private, recipient public); AES key =
  HKDF-SHA-256(shared secret, salt = empty, info =
  `rltp/v1/seal`), 32 bytes. The recipient public key is the
  key-agreement key of the recipient's contact card (or a derived
  service identity, Layer-1 A7).
- **Framing:** ciphertext includes the GCM tag; empty plaintext and
  tag-only ciphertexts are invalid.
- The sealed envelope plus the recipient anchor (routing) is all an
  adapter carries. **The document digest is computed over the
  plaintext, never the ciphertext** — re-sealing on retry changes the
  ciphertext but never the document's identity.

No channel authentication is required or assumed: confidentiality comes
from the seal, authenticity from the signed material inside the
document, bound to anchors by the Layer-1 binding rule.

*(This construction transcribes the deployed Sync-001 ECIES with a new
info string; see Appendix A. HPKE alignment is Open Issue DO-2b.)*

## 6. Delivery Promises

### 6.1 Sender: the status trias

For every document handed to the service, the sender can observe
exactly three terminal-capable states:

| State | Meaning |
|---|---|
| `accepted` | the service durably buffered it; delivery is owed |
| `delivered` | a valid `delivery-ack` referencing its digest arrived |
| `failed` | the service gave up; a named reason is attached |

Nothing else is observable — in particular, no acceptance state exists.
A document MUST NOT remain in `accepted` silently forever without the
possibility of eventually reaching `delivered` or `failed`; adapters
define their give-up policy and report it as `failed` with reason.

### 6.2 Receiver: dispositions

Every received envelope is classified, and the classification is
normative vocabulary:

- `unique` — decrypted, validated, effect durably recorded (ack sent
  where the type prescribes one);
- `duplicate-known` — the document digest is already recorded; the
  prior outcome applies idempotently; a prescribed ack MAY be resent,
  identical;
- `failed(reason)` — named reasons, closed set per type version:
  `decryption-failed` · `malformed` · `unknown-type` ·
  `wrong-recipient` · `validation-failed` (type-specific consistency,
  4.1) · `consumed-challenge` (Encounter gate) · `gate-expired`
  (Encounter 5.8 record gate);
- `incomplete(missing)` — a dependency is absent (out-of-order
  arrival); the envelope is durably parked and re-evaluated when the
  dependency arrives. Parking is not loss; parked envelopes count as
  undelivered for the sender.

**Validate, then consume:** no disposition may consume single-use
material (challenges) before the envelope's content is fully validated
(the poisoning rule, Encounter review F3).

### 6.3 At-least-once and reconciliation

Adapters MAY deliver any envelope multiple times; receivers MUST
converge via 6.2 (`duplicate-known`). A lost acknowledgement is
indistinguishable from a lost document to the sender; the sender's
remedy is bounded by `ack-wait` (Section 7) and the ceremony's
fallback, and the resulting duplicate enactments are harmless by the
edge-per-pair rule (Encounter: enactment multiplicity never multiplies
edges).

## 7. Timing

| Parameter | Default | Meaning |
|---|---|---|
| `ack-wait` | PT30S | RECOMMENDED sender-side wait before treating a one-scan transmission as failed and offering the two-way fallback |

`ack-wait` is a UX pacing parameter, not a validity rule: an
acknowledgement arriving after it is still valid, and the merge rule
(6.3) makes any timing safe. Delivery time itself is unbounded (D11);
no rule in this contract references arrival time for validity.

## 8. State Machines (informative)

**Sender (A, one-scan):**
`scanning → confirmed/sent (waiting animation) → delivered ("nothing
more to do") → [counter-credential accepted] → relation confirmed`
— with `waiting --ack-wait elapsed--> two-way screen (show own QR)`.

**Receiver (B, one-scan):**
`bundle received → validated → recorded + auto-ack → prompt: "verify A
back?" → [human confirms] → counter-step issued → relation confirmed`
— rejection at validation sends no ack; B's prompt is C4, never
automated.

## 9. Security Considerations

- **The seal is to a card key.** Whoever holds the recipient's card
  can seal to them — including the bystander of the challenge race
  (Encounter §13). The seal provides confidentiality, not sender
  authenticity; sender authenticity lives in the signed payloads.
- **At-least-once is an attack surface made safe by idempotency.**
  Replayed envelopes are `duplicate-known` by plaintext digest;
  re-sealed replays converge identically because the digest ignores
  the ciphertext.
- **The acknowledgement is signed addressing, not content proof.** A
  `delivery-ack` is itself a sealed, typed document from the
  recipient's anchor; a forged ack would need the recipient's key.
  Suppressed acks cause fallback, not loss (6.3).
- **Adapters are untrusted for content.** A transport can delay, drop,
  duplicate, and observe metadata; it can never read, alter, or forge
  documents without detection.

## 10. Privacy Considerations

- **Transport metadata is visible to adapters:** recipient anchor,
  timing, sizes. Derived service identities (A7) bound what a
  transport learns about the person; the contract does not hide
  traffic patterns.
- **An acknowledgement is a presence signal.** `delivered` tells the
  sender the recipient's device was recently online. This is inherent
  to the UX it serves (the one-scan flow depends on it) and is stated
  rather than hidden. It reveals device liveness, never human
  attention.
- **Sealed content is opaque end to end**; parked (`incomplete`)
  envelopes are stored sealed.

## 11. Conformance

- **Profile** `rltp-delivery@0.1`.
- **Classes:** *sender* (sealing, status trias, ack-wait fallback
  trigger) · *receiver* (unsealing, dispositions, ack generation) ·
  adapters are below the port line and unconstrained except through
  the promises their side must keep.
- **Normative schemas (shipped):** `schemas/sealed-envelope.schema.json`,
  `schemas/task-encounter-bundle.schema.json`,
  `schemas/task-delivery-ack.schema.json`,
  `schemas/task-encounter-credential-delivery.schema.json`.
- **Vector plan:** seal/unseal roundtrip with fixed test keys · digest
  over plaintext invariant under re-sealing · every disposition of 6.2
  as a distinct vector, including validate-then-consume (a malformed
  bundle consumes nothing) and `incomplete` parking with later
  completion · duplicate and concurrent delivery converge
  (`duplicate-known`, single record, identical re-ack) · ack
  generation at recording, none on rejection, no dependency on the
  confirmation step · recipient enforcement (`wrong-recipient`) ·
  unknown type rejection · threadId rules per type · `ceremony`
  member recomputation · status trias transitions including
  `failed(reason)` · ack after `ack-wait` still valid, merge rule
  applies.

## 12. Open Issues

- **DO-2b HPKE.** Whether to align the seal with RFC 9180 HPKE in a
  future version; the 0.1 construction is the deployed one.
- **DO-3 Multi-device delivery.** What `delivered` means when an
  anchor has several devices; adapter-defined until the Layer-1
  device model (IO-4) lands, and the ack meaning is deliberately
  device-scoped ("the recipient's authenticated device").
- **DO-4 Third-party task types.** The first type retained by third
  parties triggers the proof requirement (Section 3); none exists.
- **DO-5 Ordering.** No global ordering is promised; `incomplete`
  parking plus thread causality is the working hypothesis for every
  current flow.

## Appendix A (informative): mapping to the current implementation

| This contract | Today (Sync 001/003, wot-core) |
|---|---|
| Document (Trust Task) | `MessageEnvelope` / DIDComm plaintext + `MessageType` union |
| `threadId` | `thid`/`pthid` |
| Sealed envelope (5) | ECIES body `{epk, nonce, ciphertext}`, info `wot/ecies/v1` → `rltp/v1/seal` |
| Status trias (6.1) | `RelayReceipt accepted/delivered/failed` |
| `delivery-ack` (4.2) | `attestation-receipt` (Häkchen 2) — **semantics change: arrival at recording, no longer post-verification** |
| Dispositions (6.2) | K1 `InboxAck*` taxonomy (`unique`/`duplicate-known`/`failed` + missing-dependency) |
| Transport queue ack | relay `{type:'ack'}` — stays below the port line, unspecified here |

## References

[RFC2119] · [RFC8174] BCP 14 · [RFC3339] · [RFC8785] JCS · [RFC5869]
HKDF · [TT] ToIP DTGWG Trust Tasks framework specification (private
specifications, §6.5; `ceremony` member, §4.11) · RLTP Encounter Layer
0.5 (port requirements §11, enactment binding 5.4, ceremonies 5.8) ·
Sync 001/003 (superseded transport specs, Appendix A).
