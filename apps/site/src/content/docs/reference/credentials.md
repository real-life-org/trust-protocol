---
title: Credentials
description: "The three verifiable credentials of the protocol: who issues each to whom, what it does, where its rules, schema and vectors are."
specs: [access-layer, encounter-layer, membership-tasks, succession, trust-layer]
---

RLTP uses three verifiable credentials: the encounter credential, the
invitation credential and the admission vouch. All three are W3C
Verifiable Credentials 2.0 in the form of the
[DTG credential specification](https://github.com/trustoverip/dtgwg-cred-spec),
signed with `eddsa-jcs-2022` over `did:key`.

| Credential | DTG type | Who issues it to whom | What it does |
|---|---|---|---|
| [Encounter credential](#encounter-credential) | `RelationshipCredential` | one party to the other, after they met | records one recognition; never revoked |
| [Invitation credential](#invitation-credential) | `InvitationCredential` | a member to one person | offers membership in a group until `validUntil` |
| [Admission vouch](#admission-vouch) | `EndorsementCredential` | a member to a candidate | supports one admission of that candidate |

## Encounter credential

One step of an [encounter](/understand/encounter/) yields one
encounter credential: the recognizing party's signed statement that
it recognized the other in this enactment, issued to the recognized
party under a fresh [pair anchor](term:PairAnchor) of that enactment.
Its `type` is `VerifiableCredential`, `DTGCredential`,
`RelationshipCredential`, `EncounterCredential`, with `issuerScope`
`pairwise`. It has no `validUntil` and no `credentialStatus`: it is
never revoked, and a changed assessment is a new credential.

Spec: [Encounter §7](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#7-the-encounter-credential) ·
Schema: [`encounter-credential-0.26`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/encounter-credential-0.26.schema.json) ·
Vectors: [`encounter-cards.json`](https://github.com/real-life-org/trust-protocol/blob/main/vectors/encounter-cards.json)

## Invitation credential

A member who wants to admit one person into a [group](/understand/groups/)
issues an invitation credential to that person's member anchor, and
sends it as the payload of `membership-invite/0.2`. Its `type` is
`VerifiableCredential`, `DTGCredential`, `InvitationCredential`,
`MembershipInvite`. The invitee answers it with a
[`membership-accept/0.2`](https://github.com/real-life-org/trust-protocol/blob/main/spec/membership-tasks.md#32-membership-accept02)
that names the credential by its [digest](term:CredentialDigest).
`validUntil` bounds the time in which it can be answered; no document
withdraws it earlier
([MO-8](https://github.com/real-life-org/trust-protocol/blob/main/spec/membership-tasks.md#9-open-issues)).

Spec: [Membership §3.1](https://github.com/real-life-org/trust-protocol/blob/main/spec/membership-tasks.md#31-membership-invite02) ·
Schema: [`payload-membership-invite`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/payload-membership-invite.schema.json), property `invite` ·
Vectors: [`dtg-credentials.json`](https://github.com/real-life-org/trust-protocol/blob/main/vectors/dtg-credentials.json)

## Admission vouch

A member who knows a candidate, from meeting or by introduction,
issues a vouch (`vouch@2`) to the candidate's member anchor once the
candidate has accepted an invitation. Its `type` is
`VerifiableCredential`, `DTGCredential`, `EndorsementCredential`,
`AdmissionVouch`, and it names the accept it supports. The group's
policy counts the vouches enclosed in the admitting `member.add`. A
vouch counts for that one admission only: a later re-admission of the
same person needs fresh consent and fresh vouches.

Spec: [Access §5.3](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#53-admission-and-removal) ·
Schema: [`access-vouch`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/access-vouch.schema.json) ·
Vectors: [`dtg-credentials.json`](https://github.com/real-life-org/trust-protocol/blob/main/vectors/dtg-credentials.json)

## Why there is no membership credential

Membership is a fact of the group's state, not a document a member
presents. A group has one authority log, and every authorization
decision is derived from the state materialized from that log, never
from document content
([Access §3.1](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#31-one-log-one-truth)).
A person becomes a member by a `member.add` in that log, which
encloses the accept and the vouches the policy requires
([Access §5.3](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#53-admission-and-removal)),
and stops being one by a `member.remove`, which starts a new epoch:
revocation is an epoch, prospective and honestly stated
([Access §1.1](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#11-essence),
[§7](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#7-epochs)).
Every replica of the log reaches the same answer about who is a
member
([Access §3.6](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#36-concurrency-the-conflict-matrix)).
A credential a group issues outward, such as a membership
attestation, is deferred until a closed credential profile exists
([Access §15, OI-13](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#15-open-issues)).

Everything that moves between devices is a
[Trust Task](/reference/trust-tasks/) document. The invitation and
the vouch travel as credentials inside one; the accept, the admitting
operation, key material and the removal notice are signed payloads
without a credential.

## Details

**Securing profile**
([Encounter §2.3](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#23-securing-profile-bound-to-identity-051)).
Issuer and subject are `did:key` anchors over Ed25519, verified
without resolution. The proof is an embedded `DataIntegrityProof`,
cryptosuite `eddsa-jcs-2022`. `@context` is exactly three pinned
contexts: W3C credentials v2, a DTG context, RLTP v1. Verification is
JSON Schema plus the rules of the specification; no JSON-LD
expansion, no context fetched at runtime. Each schema is closed.

**DTG context**
([Encounter §2.3, Contexts](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#contexts)).

| Credential | DTG context pinned now |
|---|---|
| Encounter credential, `rltp-encounter-credential/0.26` | `https://registry.trustoverip.org/dtg/context/v1` (Working Draft 0.6.0) |
| Encounter credential, `rltp-encounter-credential/0.25` (read, not issued) | `https://firstperson.network/credentials/dtg/v1` (Working Draft 01) |
| Invitation credential | `https://firstperson.network/credentials/dtg/v1` (Working Draft 01) |
| Admission vouch | `https://firstperson.network/credentials/dtg/v1` (Working Draft 01) |

The next expected change is the wire step of the encounter credential
to the DTG context of the DTG Implementer's Draft and the fields it
defines; the ceremony stays as it is
([Encounter, Status](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#status-of-this-document)).
A producer issues `rltp-encounter-credential/0.26`; a receiver also
reads a held `/0.25`, because a credential is never re-issued
([Encounter §12](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#12-evolvability)).

**Not credentials in this version.**

- The [contact card](term:ContactCard) is signed like a credential but is a self-description ([Encounter §6](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#6-the-contact-card)).
- The [accept](term:Accept) is the signed payload of `membership-accept/0.2` ([Membership §3.2](https://github.com/real-life-org/trust-protocol/blob/main/spec/membership-tasks.md#32-membership-accept02)).
- An attestation is a documented option of the Trust Layer with no artifact in this version ([Trust §9.1](https://github.com/real-life-org/trust-protocol/blob/main/spec/trust-layer.md#91-attestation-documented-option)).
- Group-issued credentials are deferred until a closed credential profile exists ([Access §15](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#15-open-issues)).
- The succession credential belongs to the parked Succession draft ([Succession, Status](https://github.com/real-life-org/trust-protocol/blob/main/spec/succession.md#status-of-this-document)).
