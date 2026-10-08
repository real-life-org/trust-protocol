---
title: Read the spec
description: The layer documents of RLTP, where to start and in which order.
---

New to RLTP? Start with [Foundations](/understand/foundations/) and the
[Encounter primer](/understand/encounter/); they explain the concepts the
specifications assume.

The specifications are written for implementers and reviewers: English,
BCP 14 normative language, every document with Security and Privacy
Considerations. They are dense. This order keeps the dependencies in view.

| # | Document | What it settles |
|---|---|---|
| 1 | [Encounter Layer](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md) | How two people verify each other and keep the record of it: the [ceremony](term:Ceremony), [contact cards](term:ContactCard), [challenges](term:Challenge), [encounter credentials](term:EncounterCredential), [edges](term:Edge). |
| 2 | [Identity Layer](https://github.com/real-life-org/trust-protocol/blob/main/spec/identity-layer.md) | One root seed, every identity derived: per-relationship [pair anchors](term:PairAnchor), per-group [member anchors](term:MemberAnchor), service identities. |
| 3 | [Delivery Contract](https://github.com/real-life-org/trust-protocol/blob/main/spec/delivery-contract.md) | How documents travel: private Trust Task types, the sealed envelope, staged dispositions, delivery promises. |
| 4 | [Access Layer](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md) | How a group holds shared authority: the [authority log](term:AuthorityLog), [policies](term:Policy) as decision rules, [epochs](term:Epoch) that make revocation real. |
| 5 | [Membership Tasks](https://github.com/real-life-org/trust-protocol/blob/main/spec/membership-tasks.md) | How membership changes travel: [invitation](term:Invite), explicit consent, the admitting operation and its [welcome](term:Welcome). |
| 6 | [Network Visibility](https://github.com/real-life-org/trust-protocol/blob/main/spec/network-visibility.md) | Who may learn that an edge exists: the trust act, visibility grades, [stars](term:Star), [anchor mappings](term:AnchorMapping), [introductions](term:Introduction). |
| 7 | [Personhood Predicates](https://github.com/real-life-org/trust-protocol/blob/main/spec/personhood-predicates.md) | What "a human vouched for a human" can and cannot prove, relative to a verifier. |
| 8 | [Replication Contract](https://github.com/real-life-org/trust-protocol/blob/main/spec/replication-contract.md) | The service contract behind the Access Layer's replication port. |

Two companions: the [VTI mediator adapter](https://github.com/real-life-org/trust-protocol/blob/main/spec/adapter-vti-mediator.md),
a delivery profile over the Verifiable Trust Infrastructure, and
[Succession](https://github.com/real-life-org/trust-protocol/blob/main/spec/succession.md),
recovering a person's anchor through several people, parked as a draft.

## How the documents are made

Every document converges through an adversarial process. Each casting is
reviewed by an independent reviewer, every finding is triaged and answered,
and the document is recast, never patched. A layer counts as converged when
consecutive review rounds produce no blocker-level findings. Earlier castings
are kept unchanged in [`spec/archive/`](https://github.com/real-life-org/trust-protocol/tree/main/spec/archive).

Feedback is welcome as an [issue](https://github.com/real-life-org/trust-protocol/issues).
Disagreement, counterexamples and "your Security Considerations missed X" are
the most useful contributions.
