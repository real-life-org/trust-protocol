---
title: Credentials
description: "Every verifiable credential of the protocol: its types, who issues it to whom, what it carries, how it is signed, how long it holds, where the rules are."
specs: [access-layer, delivery-contract, encounter-layer, membership-tasks, succession, trust-layer]
---

RLTP defines three verifiable credentials: the encounter credential,
the invitation credential and the admission vouch. Each is a W3C
Verifiable Credential 2.0 in the form of the DTG credential
specification, with one RLTP type beside its DTG type, and each has
a closed JSON Schema: a property the schema does not list makes the
credential invalid.

## Securing profile

All three are secured by the profile of
[Encounter §2.3](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#23-securing-profile-bound-to-identity-051),
which the Membership Tasks
([§2.4](https://github.com/real-life-org/trust-protocol/blob/main/spec/membership-tasks.md#24-securing-and-document-profile))
and the Access Layer
([§5.3](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#53-admission-and-removal))
apply to their credentials.

| | |
|---|---|
| Issuer and subject | `did:key` anchors over Ed25519, verified without resolution |
| Proof | an embedded `DataIntegrityProof`, cryptosuite `eddsa-jcs-2022` (JCS, SHA-256, Ed25519), `verificationMethod` the issuer's `did:key` verification method |
| Proof context | the proof carries a copy of the credential's `@context` array, as the W3C procedure requires |
| `@context` | exactly three pinned contexts, in order: W3C credentials v2, a DTG context, RLTP v1 (`https://real-life.org/rltp/v1`); no other set is accepted |
| Processing | JSON Schema plus the rules of the specifications; no RDF or JSON-LD expansion, no context fetched at runtime |
| Timestamps | RFC 3339 UTC with `Z`, at most three fractional-second digits |

The [credential digest](term:CredentialDigest), the multibase
multihash over the JCS of the complete credential including its
proof, is how a credential is named: an accept names the invitation it
answers by it.

## Encounter credential

The product of one step of an encounter: one party's signed statement
that it recognized the other in this enactment
([Encounter §7](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#7-the-encounter-credential)).
See also the [encounter credential](term:EncounterCredential) in the
glossary and [Encounter](/understand/encounter/) for the ceremony.

| | |
|---|---|
| `type` | `VerifiableCredential`, `DTGCredential`, `RelationshipCredential`, `EncounterCredential`: a DTG RelationshipCredential, with `EncounterCredential` as a non-authoritative RLTP hint type |
| Issuer to subject | from the recognizing party to the recognized party, each under a fresh [pair anchor](term:PairAnchor) of this enactment; delivered to its subject, the issuer keeps a copy |
| `issuerScope` | `pairwise`; a credential without it or with another value is rejected |
| Carries | `validFrom` (issuance time); in `credentialSubject`: `id` (the recognized party), `format`, `ceremony`, `challenge` (the subject's challenge), `enactmentBinding`, and optionally `channel` (informative) and `commitment` (not emitted while its suite registry is empty) |
| Size | every property is bounded, so no schema-valid credential exceeds 2048 bytes of JCS |
| Lifetime | no `validUntil`, no `credentialStatus`; never expires, never revoked. A changed assessment is a new credential |
| Travels in | `encounter-bundle/0.1` and `encounter-credential-delivery/0.1` ([Trust Tasks](/reference/trust-tasks/#encounter)) |
| Rules | [§7.1 Form](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#71-form) · [§7.2 Data model](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#72-data-model) · [§7.3 Immutability](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#73-immutability) · [§7.4 Receiver principle](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#74-receiver-principle) · [§7.5 Bounded size](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#75-bounded-size-guaranteed-at-the-source) |
| Schema | [`encounter-credential-0.26`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/encounter-credential-0.26.schema.json) |
| Vectors | [`encounter-cards.json`](https://github.com/real-life-org/trust-protocol/blob/main/vectors/encounter-cards.json) |

Two formats exist
([Encounter §12](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#12-evolvability)).
A producer issues `rltp-encounter-credential/0.26`. A receiver also
reads a held `rltp-encounter-credential/0.25`, the same closed form
without `issuerScope` and under the Working Draft 01 DTG context,
against
[`encounter-credential-0.25`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/encounter-credential-0.25.schema.json).
A credential is never re-issued, so a 0.25 credential stays valid
under the format it was signed in.

## Invitation credential

A member's signed offer of membership in a group to exactly one
person, the payload of `membership-invite/0.2`
([Membership §3.1](https://github.com/real-life-org/trust-protocol/blob/main/spec/membership-tasks.md#31-membership-invite02)).
See also the [invite](term:Invite) in the glossary and
[Groups](/understand/groups/).

| | |
|---|---|
| `type` | `VerifiableCredential`, `DTGCredential`, `InvitationCredential`, `MembershipInvite`: a DTG InvitationCredential, with `MembershipInvite` as the RLTP type |
| Issuer to subject | from the inviter's member anchor, equal to the document `issuer`, to the invitee's member anchor for this group, obtained in the prelude and equal to the document `recipient` |
| Carries | `validFrom`, `validUntil`, `taskContext` (the membership thread); in `credentialSubject`: `id`, `group` (the group DID), `genesisDigest` (the group's identity), `card` (the inviter's contact card, displayed form), and optionally `name` and `note` |
| Signature | the credential's proof is the invite document's one authenticity carrier; the document carries no proof of its own |
| Identity | the credential digest, never the digest of the enclosing document: one credential re-wrapped is still one invitation |
| Lifetime | `validUntil` bounds the time in which it can be answered. No document withdraws an invitation earlier; an inviter relies on a short `validUntil` |
| Answered by | a [`membership-accept/0.2`](https://github.com/real-life-org/trust-protocol/blob/main/spec/membership-tasks.md#32-membership-accept02), whose `ref` is the credential digest |
| Rules | [Membership §2.4](https://github.com/real-life-org/trust-protocol/blob/main/spec/membership-tasks.md#24-securing-and-document-profile) · [§3.1](https://github.com/real-life-org/trust-protocol/blob/main/spec/membership-tasks.md#31-membership-invite02) · [§9 MO-8](https://github.com/real-life-org/trust-protocol/blob/main/spec/membership-tasks.md#9-open-issues) |
| Schema | [`payload-membership-invite`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/payload-membership-invite.schema.json), property `invite` |
| Vectors | [`dtg-credentials.json`](https://github.com/real-life-org/trust-protocol/blob/main/vectors/dtg-credentials.json) |

## Admission vouch

One member's signed statement for exactly one admission of exactly one
person, `vouch@2`
([Access §5.3](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#53-admission-and-removal)).
A group's vouch rule counts it for that admission and no later one.
See also the [vouch](term:Vouch) in the glossary.

| | |
|---|---|
| `type` | `VerifiableCredential`, `DTGCredential`, `EndorsementCredential`, `AdmissionVouch`: a DTG EndorsementCredential, with `AdmissionVouch` as the RLTP endorsement vocabulary |
| Issuer to subject | from the vouching member's anchor to the candidate's member anchor |
| Carries | `validFrom`; in `credentialSubject`: `id` and `endorsement` with `type` `AdmissionVouch`, `genesisDigest` (the group), `accept` (the document digest of the accept it supports) and `provenance`, `met` or `introduced` |
| `provenance` | the voucher's own word; a verifier does not treat it as verified |
| Lifetime | no `validUntil`. The accept binding ends its use: it supports one consented candidacy, and a later re-admission needs fresh vouches |
| Counted | only when admissible: valid `vouch@2`, issuer in the policy currency at the operation's declared position, subject, accept digest and genesis digest matching the admission ([Access §4.3](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#43-policy-proofs)). An encounter credential is not a vouch |
| Travels in | `proof.credentials` of an admitting `member.add`, at most 16 of at most 2048 bytes each; and `membership-evidence/0.2`, at most 16 ([Membership §3.4](https://github.com/real-life-org/trust-protocol/blob/main/spec/membership-tasks.md#34-membership-evidence02)) |
| Rules | [Access §4.2](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#42-requirement-types) · [§4.3](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#43-policy-proofs) · [§5.3](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#53-admission-and-removal) |
| Schema | [`access-vouch`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/access-vouch.schema.json) |
| Vectors | [`dtg-credentials.json`](https://github.com/real-life-org/trust-protocol/blob/main/vectors/dtg-credentials.json) |

## The DTG credential specification

The credentials follow the
[DTG credential specification](https://github.com/trustoverip/dtgwg-cred-spec)
of the ToIP Decentralized Trust Graph Working Group. Each is a
conformant credential of its DTG type, under a DTG context, with the
RLTP fields as legal additional properties. The RLTP context defines
no term the DTG context defines.

| Credential | DTG type | DTG context pinned now |
|---|---|---|
| Encounter credential, `rltp-encounter-credential/0.26` | `RelationshipCredential` | `https://registry.trustoverip.org/dtg/context/v1` (Working Draft 0.6.0) |
| Encounter credential, `rltp-encounter-credential/0.25` (read, not issued) | `RelationshipCredential` | `https://firstperson.network/credentials/dtg/v1` (Working Draft 01) |
| Invitation credential | `InvitationCredential` | `https://firstperson.network/credentials/dtg/v1` (Working Draft 01) |
| Admission vouch | `EndorsementCredential` | `https://firstperson.network/credentials/dtg/v1` (Working Draft 01) |

The registry context is used from the byte-exact copy
[`contexts/dtg-v1.jsonld`](https://github.com/real-life-org/trust-protocol/blob/main/contexts/dtg-v1.jsonld),
pinned by its SHA-256 digest, and the IRI is never dereferenced
([Encounter §2.3, Contexts](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#contexts)).
The invitation credential and the vouch keep the Working Draft 01
context until their own wire step.

The next expected change to the encounter credential is the wire step
to the DTG context of the DTG Implementer's Draft and the fields it
defines; the ceremony stays as it is
([Encounter, Status](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#status-of-this-document)).
Each format version pins its own context array; a held credential is
never re-issued and keeps the context it was signed under.

What a DTG verifier can read from an encounter credential, and what
stays holder-local, is set out in
[Encounter Appendix B](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#appendix-b-informative-vocabulary-alignment-with-dtgwg-trust-ceremonies).

## Not credentials in this version

- The **[contact card](term:ContactCard)** is signed like a credential
  but is a self-description, not a credential
  ([Encounter §6](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#6-the-contact-card)).
- The **[accept](term:Accept)** is a signed payload object of
  `membership-accept/0.2`, not a verifiable credential.
- An **attestation** is a documented option of the Trust Layer; this
  version defines no attestation artifact, schema or task type
  ([Trust §9.1](https://github.com/real-life-org/trust-protocol/blob/main/spec/trust-layer.md#91-attestation-documented-option)).
- **Group-issued credentials** are deferred until a closed credential
  profile exists
  ([Access §15](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#15-open-issues)).
- The **succession credential** belongs to the parked Succession
  draft, which is not to be implemented until it is re-cast
  ([Succession, Status](https://github.com/real-life-org/trust-protocol/blob/main/spec/succession.md#status-of-this-document)).
