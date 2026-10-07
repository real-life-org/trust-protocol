---
title: Foundations
description: What a protocol developer needs to know before reading the RLTP specifications. Identifiers, credentials, trust, Trust Tasks, groups, and the two service ports.
---

## What RLTP is

RLTP records encounters: two people meet, each verifies the other,
and each verification becomes an immutable
verifiable credential held by the person it is about. A group is a
place rather than a certificate: an encrypted document replicated on
every member's device, with its own log of who joined, who left and
which rules apply. Delivery and replication are services behind
ports, so the specification names no transport and no CRDT.

Specs: [Encounter Layer](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md) ·
[Access Layer](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md)

## Identifiers

A person keeps one secret, a BIP-39 mnemonic with the English
wordlist. Every identity is derived from its seed, one **anchor** per
context:

| Context | Label | DTG scope |
|---|---|---|
| One relationship-creation act (encounter, introduction, founding a group) | `pair/<digest of a fresh 32-byte nonce>` | `pairwise` |
| One group; for the personal community this is the **community anchor** | `group/<genesis digest>` | `directed` |
| One public persona | `persona/<name>` | `public` |

The DTG scope is the correlation scope a holder declares for an
identifier: `pairwise` is known to one counterpart, `directed` to a
set the holder chooses, `public` to anyone. A pair anchor is
`pairwise`; a member anchor is `directed`, because every member of
the group can correlate it; a persona is `public`, because its
profile is meant for everyone. Personas are specified but not yet
built, and whether RLTP also needs personas toward a chosen set is an
open question; today that role falls to the member anchor.

Further derivations have no social surface: a service identity per
group, a carrier identity per relationship and carrier, and a
recovery context for the person's own encrypted state. Without the
seed, two anchors of one person cannot be linked.

Each context has an Ed25519 key pair, whose public key is the anchor
as a `did:key`, and an X25519 key for key agreement, carried in the
contact card. Verification needs no network.

`did:key` over Ed25519 is the only DID method specified today.
Consumers treat an anchor as an opaque DID, but the schemas pin the
`did:key` pattern, so another method would be a coordinated change. A
`did:key` cannot rotate; a successor with verifiable key history is
named as open work, its format deliberately not chosen. `did:webvh`
and `did:peer` are not specified.

The mnemonic restores keys, not state. Which groups, personas and
relationships exist is a register in the person's encrypted,
synchronized state; with a copy of it, everything returns. A lost
mnemonic is final, unless the person has set up succession:
recovering an anchor through several trusted people is specified
separately and currently parked.

Specs: [Identity Layer](https://github.com/real-life-org/trust-protocol/blob/main/spec/identity-layer.md) ·
[Succession](https://github.com/real-life-org/trust-protocol/blob/main/spec/succession.md) (parked)

## Credentials we issue

RLTP issues three credentials, all W3C Verifiable Credentials 2.0
with closed schemas and three contexts pinned by value (W3C
credentials v2, DTG v1, RLTP v1), verified without JSON-LD
processing.

| Credential | Issued when | Issuer → subject | `type` | Proof | Revocation | Schema · vector |
|---|---|---|---|---|---|---|
| Encounter credential | A person verifies the other during an encounter; one per direction | Issuer's fresh pair anchor → counterpart's fresh pair anchor | `VerifiableCredential`, `DTGCredential`, `RelationshipCredential`, `EncounterCredential` | `DataIntegrityProof`, `eddsa-jcs-2022` | Never revoked, never expires: no `validUntil`, no `credentialStatus` | `encounter-credential-0.25` · `encounter-cards.json` |
| Membership invite (VIC) | A member invites someone into a group | Inviter's member anchor → invitee's member anchor | `VerifiableCredential`, `DTGCredential`, `InvitationCredential`, `MembershipInvite` | `DataIntegrityProof`, `eddsa-jcs-2022` | No `credentialStatus`; `validUntil`, default 90 days | `payload-membership-invite` · `dtg-credentials.json` |
| Admission vouch (`vouch@2`) | A member vouches for a candidate's admission | Vouching member's anchor → candidate's member anchor | `VerifiableCredential`, `DTGCredential`, `EndorsementCredential`, `AdmissionVouch` | `DataIntegrityProof`, `eddsa-jcs-2022` | No `credentialStatus`, no `validUntil`; usable only for the one acceptance it is bound to | `access-vouch` · `dtg-credentials.json` |

The **contact card** is not a credential. It is a signed
self-description: anchor, key agreement key, and in an encounter a
fresh challenge.

An encounter establishes exactly four things: the issuer controlled
their key, the exchange was fresh, a human deliberately verified
the other, and the fact survives as a record. It does not
establish physical presence, personhood, that a name belongs to a
legal person, or trust. Freshness and verification are established
toward the two participants only.

Status: the credentials follow DTG Credentials WD01. The move to the
DTG context v2 is pending, and the vouch is to become a DTG
`StatementCredential` with its own predicate. Both are planned as one
wire change.

Specs: [Encounter Layer](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md) ·
[Membership Tasks](https://github.com/real-life-org/trust-protocol/blob/main/spec/membership-tasks.md) ·
[Access Layer](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md)

## How we use credentials

An edge between two anchors consists of the encounter credentials
between them, and every view of it is local: outgoing, incoming or
mutual. There is one edge per anchor pair, however many encounters.
An encounter credential is one person's statement that they
verified the other; in a mutual encounter each holds the other's
statement. On its own it proves only that two keys asserted an
encounter, and since anyone can create anchors at no cost, a count of
such confirmations proves nothing by itself. Its meaning arises in
context: for an evaluator who already knows one of the anchors, from
its own encounters or its groups, the confirmation is evidence; for
anyone else it is a claim.

Verification is not trust. Trusting a contact means showing them
context about yourself: an **anchor mapping** reveals, to this one
contact only, that the relationship's pair anchor and your community
anchor, the stable identifier of your personal community, belong to
the same person. Trusting also allows the contact to include you,
blinded, in the **star** they send to their own contacts, a picture
of their circle that only people who already know you can read you
out of. The mapping is designated-verifier: a MAC under a key the two
share, so the contact can check it but could have forged it, and
nobody else can.

Meeting the same person again needs no disclosure: a continuity probe
after the encounter detects the re-encounter from the shared
history and chains it to the existing relationship.

Every artifact belongs to one audience class. Class P covers
statements about oneself meant to be shown, such as contact cards and
membership documents, and only these are transferably signed; class V
covers anything linking two contexts of one person, and class D
covers statements about third parties, both designated-verifier, with
class D additionally blinded.

A third party holding both credentials of one encounter can verify
both proofs and the shared enactment binding, and learns exactly
this: two anchors consistently assert an encounter. Whether two
people met, and who they are, stays with those who know the anchors.
Personhood predicates therefore measure confirmations relative to
anchors the verifier already knows.

Specs: [Encounter Layer](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md) ·
[Network Visibility](https://github.com/real-life-org/trust-protocol/blob/main/spec/network-visibility.md) ·
[Personhood Predicates](https://github.com/real-life-org/trust-protocol/blob/main/spec/personhood-predicates.md)

## Trust Tasks

Every RLTP message is a Trust Task document of a private, versioned
type under `https://real-life.org/trust-tasks/`, with in-band
`issuer` and `recipient` anchors and no `expiresAt`. An unknown type
is rejected, never silently ignored.

| Type | Registered in | Purpose |
|---|---|---|
| `encounter-bundle/0.1` | Delivery | the scanner's sent card and credential, in one scan |
| `encounter-credential-delivery/0.1` | Delivery | a credential delivered after the encounter |
| `delivery-ack/0.1` | Delivery | arrival acknowledgement, never acceptance |
| `registry-declaration/0.1` | Delivery | a party's signed operational constants |
| `membership-invite/0.2` | Membership | the invitation, carrying the VIC |
| `membership-accept/0.2` | Membership | the invitee's signed consent |
| `membership-evidence/0.1` | Membership | relays invite and accept to any member who can admit |
| `access-operation/0.1` | Membership | the admitting operation and welcome, sent to the new member |
| `key-delivery/0.1` | Access | epoch keys, welcomes, key requests |
| `removal-notice/0.1` | Access | tells a removed member |
| `star/0.1` | Visibility | lets a contact relate your contacts to theirs, blinded or as a count |
| `group-star/0.1` | Visibility | your groups, blinded to every contact; your member anchor sealed to the ones you choose |
| `grade-declaration/0.1` | Visibility | a contact's choice between count and blinded |
| `anchor-mapping/0.2` | Visibility | links a pair anchor to the community anchor for one addressee |
| `continuity-probe/0.1`, `continuity-mapping/0.1` | Visibility | detect a re-encounter and chain it to the existing relationship |
| `introduction-request/0.1`, `introduction-forward/0.1`, `introduction-reply/0.1`, `introduction-ack/0.1`, `introduction-voucher/0.1` | Visibility | the five steps of introducing two people through a mutual contact |

The Delivery Contract and the Membership Tasks declare Trust Tasks
framework 0.4 as their target. The current framework is 0.7.0; the
lift is pending, and with it the type URIs change form.

Specs: [Delivery Contract](https://github.com/real-life-org/trust-protocol/blob/main/spec/delivery-contract.md) ·
[Membership Tasks](https://github.com/real-life-org/trust-protocol/blob/main/spec/membership-tasks.md)

## Groups

A group is a shared place: a document that its members hold together,
replicated on each of their devices and encrypted end to end, so that
only members can read it. Inside it they collaborate and share state
with the tools an application brings: a map, a calendar, a task
board, whatever the app puts there. The protocol does not care what
the data is; it cares who may read and change it.

A group gives itself its own rules. Who may invite, who may admit,
who may remove, whether a newcomer needs vouches: the group states
these as data, and every member's device enforces them. There are no
admins. A sole founder in charge is only the simplest rule, and it
can be changed like any other.

Membership is a fact in the group's state, and a member's devices hold
the current key. No membership certificate is needed; a credential
for showing membership to outsiders is an open item. Being removed,
leaving, or losing a device starts a new key epoch, so what is written
afterwards stays unreadable to whoever lost access. What they already read, they keep.

Behind this stands the **authority log**: a causally linked graph of
individually signed operations, starting from a founding operation
whose digest is the group's identity. The group's state is a
deterministic reading of that log. Changes made at the same
time are merged: two removals both take effect, even when two members
remove each other. Only a change of the rules made at the same time as
a removal stops the group, visibly, until a member writes a rule change
that builds on both.

Joining takes five steps. The invitee's app derives its anchor for
the group and hands it to the inviter. The inviter sends an
invitation naming that anchor, with no keys in it. The invitee signs
an acceptance bound to the invitation. A member who may admit writes
the admission into the log, enclosing invitation and acceptance as
proof of consent. A welcome sealed to the newcomer carries the
current keys. If the group requires vouches, written `vouch(n)`, the
newcomer needs n members who vouch for this one admission; a vouch
never stands for a later one.

Specs: [Access Layer](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md) ·
[Membership Tasks](https://github.com/real-life-org/trust-protocol/blob/main/spec/membership-tasks.md)

## Delivery and replication: the ports

RLTP names no transport and no data store. It states two contracts,
delivery and replication, and any substrate that keeps a contract
can carry the protocol: a relay, a mesh, a cloud store, a messaging
mediator, each behind an adapter. Everything that crosses a substrate
is sealed, so an operator sees delivery metadata and never content.

Delivery moves one document to one addressee and is done on arrival:
a credential, an invitation, an acknowledgement. Replication keeps a
group's document identical on every member's device for the group's
lifetime. A letter and a shared table, each with its own contract.

**Delivery.** Eventually, at least once, never silently lost:
delivery time is unbounded, duplicates and lost receipts are the
normal case, every effect is idempotent. The envelope is sealed end
to end; a carrier holds queues and reads nothing. The sender sees
`accepted`, `delivered` or `failed`, never a success that was not
one. An acknowledgement means arrival only. Whether the recipient agrees
is said by a document they issue themselves: the counter-credential
in an encounter, the signed acceptance of an invitation. Each relationship registers under its own
principal, so a relay holding six of your relationships holds six
strangers.

**Replication.** Every entry is individually signed and causally
linked, so a replica judges it on its own, by whatever road it came:
sync, import, recovery. Convergence is promised, readability never;
the port checks signatures and causality and never touches content
keys.
Evidence always flows, effect is gated: a forked group learns it on
every device. The contract condenses this into five doors and
maps p2panda, Keyhive, SECSYNC, NextGraph and Automerge against them.

**Today.** One delivery adapter is specified, for the Verifiable
Trust Infrastructure mediator over TSP, being moved to TSP revision
3. DIDComm appears only as that mediator's mediation and pickup
protocols, not as a form for RLTP documents. No replication adapter
is specified.

Specs: [Delivery Contract](https://github.com/real-life-org/trust-protocol/blob/main/spec/delivery-contract.md) ·
[Replication Contract](https://github.com/real-life-org/trust-protocol/blob/main/spec/replication-contract.md) ·
[VTI mediator adapter](https://github.com/real-life-org/trust-protocol/blob/main/spec/adapter-vti-mediator.md)

## What is deliberately different

- **Groups are protocol objects.** Membership is a fact in replicated
  group state and the holding of a key, not a certificate in a wallet.
- **Rooms and invitations, not checkpoints.** The host consults their
  own graph and invites; nobody presents a credential at a door.
- **There are no admins.** Privileged operations are gated by a rule
  the group states as data.
- **Revocation is an epoch.** A removal carries its key transition
  atomically; nothing waits for an expiry date.
- **Relationships never converge into a person.** Every relationship
  has its own anchor and, toward every carrier, its own principal.

More: [README of the specification repository](https://github.com/real-life-org/trust-protocol#what-is-different-about-it)

## Next

The [Encounter primer](/understand/encounter/) explains the first layer in
detail. The [specifications](/get-started/read-the-spec/) follow in
reading order.
