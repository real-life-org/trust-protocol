---
title: Read the spec
description: The layer documents of RLTP, where to start and in which order.
specs: [encounter-layer, identity-layer, delivery-contract, access-layer, membership-tasks, trust-layer, message-tasks, personhood-predicates, replication-contract, adapter-vti-mediator, succession]
---

New to RLTP? Start with [Foundations](/understand/foundations/) and the
[Encounter primer](/understand/encounter/); they explain the concepts the
specifications assume.

Each document opens with a status block that says which of its parts are
built, built differently, not built or superseded; all of them are
collected in [`spec/status.json`](https://github.com/real-life-org/trust-protocol/blob/main/spec/status.json). Where a text and
the library disagree, the library holds.

The specifications are written for implementers and reviewers: English,
BCP 14 normative language, every document with Security and Privacy
Considerations. They are dense. This order keeps the dependencies in view.

| # | Document | What it settles |
|---|---|---|
| 1 | [Encounter Layer](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md) | How two people verify each other and keep the record of it: the [ceremony](term:Ceremony) `encounter-scan`, [contact cards](term:ContactCard), [challenges](term:Challenge), [encounter credentials](term:EncounterCredential), [edges](term:Edge). <!-- now:encounter-ceremony -->The app connects people with `shared-connect` instead, defined in [`interop/ceremonies/`](https://github.com/real-life-org/trust-protocol/tree/main/interop/ceremonies).<!-- /now:encounter-ceremony --> |
| 2 | [Identity Layer](https://github.com/real-life-org/trust-protocol/blob/main/spec/identity-layer.md) | One root seed, every identity derived: per-relationship [pair anchors](term:PairAnchor), per-group [member anchors](term:MemberAnchor), service identities. <!-- now:identity -->With the library's default key provider `seedKeys`, the person's anchors are derived from a root seed given as bytes, which the Identity Layer text (§4) derives from the words; each anchor is a `did:key`, and an app may bind another key provider.<!-- /now:identity --> <!-- now:derived-identities -->The service identity derivation of Identity §7 is not built; for a group's founding the library uses a provisional derivation ([D3](https://github.com/real-life-org/trust-protocol/blob/main/lib/DEVIATIONS.md)).<!-- /now:derived-identities --> The model is planned to change ([direction note](https://github.com/real-life-org/trust-protocol/blob/main/spec/direction/identity.md)). |
| 3 | [Delivery Contract](https://github.com/real-life-org/trust-protocol/blob/main/spec/delivery-contract.md) | How documents travel: private Trust Task types, the sealed envelope, staged dispositions, delivery promises. |
| 4 | [Access Layer](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md) | How a group holds shared authority: the [authority log](term:AuthorityLog), [policies](term:Policy) as decision rules, [epochs](term:Epoch) that make revocation real. |
| 5 | [Membership Tasks](https://github.com/real-life-org/trust-protocol/blob/main/spec/membership-tasks.md) | How membership changes travel: [invitation](term:Invite), explicit consent, the admitting operation and its [welcome](term:Welcome). |
| 6 | [Trust Layer](https://github.com/real-life-org/trust-protocol/blob/main/spec/trust-layer.md) | What a person reveals to a contact and how far it travels: [trust classes](term:TrustClass), [stars](term:Star), [anchor mappings](term:AnchorMapping), the [profile](term:Profile), [introductions](term:Introduction). |
| 7 | [Message Tasks](https://github.com/real-life-org/trust-protocol/blob/main/spec/message-tasks.md) | Direct messages between two contacts, and the [block](term:Block) a person applies to a contact. |
| 8 | [Personhood Predicates](https://github.com/real-life-org/trust-protocol/blob/main/spec/personhood-predicates.md) | What "a human vouched for a human" can and cannot prove, relative to a verifier. |
| 9 | [Replication Contract](https://github.com/real-life-org/trust-protocol/blob/main/spec/replication-contract.md) | The service contract behind the Access Layer's replication port. |

Two companions: the [VTI mediator adapter](https://github.com/real-life-org/trust-protocol/blob/main/spec/adapter-vti-mediator.md),
a delivery profile over the Verifiable Trust Infrastructure, and
[Succession](https://github.com/real-life-org/trust-protocol/blob/main/spec/succession.md),
recovering a person's anchor through several people, parked as a draft.

## How the documents are made

The protocol is designed in test benches and in the library. A change of
behaviour lands in the library with its vectors and flows; the
specification text follows from what runs, one flow at a time. Until then
the texts under `spec/` stay as they are, apart from their status block,
and where a text and the library disagree, the library holds. Earlier
versions are kept unchanged in
[`spec/archive/`](https://github.com/real-life-org/trust-protocol/tree/main/spec/archive)
as history, not as the current state.

Feedback is welcome as an [issue](https://github.com/real-life-org/trust-protocol/issues).
Disagreement, counterexamples and "your Security Considerations missed X" are
the most useful contributions.
