---
title: Trust Tasks
description: "Every registered task type, by layer: where it is registered, what it carries, where the rules are."
specs: [access-layer, delivery-contract, encounter-layer, membership-tasks, message-tasks, trust-layer]
---

Every RLTP message is a Trust Task document of a private, versioned
type under `https://real-life.org/trust-tasks/`, with in-band
`issuer` and `recipient` anchors and no `expiresAt`. An unknown type
is rejected, never silently ignored.

The types form one register, the
[task registry](https://github.com/real-life-org/trust-protocol/blob/main/spec/delivery-contract.md#44-the-task-registry--companion-registered-types)
of the Delivery Contract. Each type is registered by the specification
where its semantics live, which names its payload schema, its proof
and its rules.

## Encounter

The two transmissions of the encounter ceremony
([Encounter §5.8](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#58-the-registered-ceremony-of-this-version)),
registered by the Delivery Contract itself.

| Type | Carries | Rules | Schema |
|---|---|---|---|
| `encounter-bundle/0.1` | `{ card, credential }`: the scanner's sent card and step credential, in one scan | [Delivery §4.1](https://github.com/real-life-org/trust-protocol/blob/main/spec/delivery-contract.md#41-encounter-bundle01) | [`payload-encounter-bundle`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/payload-encounter-bundle.schema.json) |
| `encounter-credential-delivery/0.1` | `{ credential }`: a step credential after the scan, as counter-step or standalone delivery | [Delivery §4.3](https://github.com/real-life-org/trust-protocol/blob/main/spec/delivery-contract.md#43-encounter-credential-delivery01) | [`payload-encounter-credential-delivery`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/payload-encounter-credential-delivery.schema.json) |

## Trust

The standing artifacts of the trust-layer family, the continuity
tasks and the five steps of the introduction act. The payload is the
artifact; the artifacts carry their own MACs or signatures, the
documents carry no proof.

| Type | Carries | Rules | Schema |
|---|---|---|---|
| `star/0.2` | one chunk of a `star@2`: the contacts who gave you their community anchor, blinded per recipient | [Trust §5.2](https://github.com/real-life-org/trust-protocol/blob/main/spec/trust-layer.md#52-star2--directional-epochal-blinding) · [§5.2a](https://github.com/real-life-org/trust-protocol/blob/main/spec/trust-layer.md#52a-chunking-normative) · [Delivery §4.4](https://github.com/real-life-org/trust-protocol/blob/main/spec/delivery-contract.md#44-the-task-registry--companion-registered-types) | [`visibility-star`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/visibility-star.schema.json) |
| `group-star/0.1` | one chunk of a `group-star@1`: your groups, blinded to every contact, your member anchor sealed to the ones you choose | [Trust §5.2b](https://github.com/real-life-org/trust-protocol/blob/main/spec/trust-layer.md#52b-group-star1--the-senders-groups-blinded-to-every-contact-sealed-to-the-chosen-ones) · [Delivery §4.4](https://github.com/real-life-org/trust-protocol/blob/main/spec/delivery-contract.md#44-the-task-registry--companion-registered-types) | [`visibility-group-star`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/visibility-group-star.schema.json) |
| `anchor-mapping/0.3` | an `anchor-mapping@4`: links a pair anchor to the community anchor for one addressee | [Trust §6.1](https://github.com/real-life-org/trust-protocol/blob/main/spec/trust-layer.md#61-purpose-and-construction) · [Delivery §4.4](https://github.com/real-life-org/trust-protocol/blob/main/spec/delivery-contract.md#44-the-task-registry--companion-registered-types) | [`visibility-anchor-mapping`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/visibility-anchor-mapping.schema.json) |
| `profile/0.1` | a `profile@1`: your name, with an optional picture and text, for one contact | [Trust §6b](https://github.com/real-life-org/trust-protocol/blob/main/spec/trust-layer.md#6b-profile1-normative) · [Delivery §4.4](https://github.com/real-life-org/trust-protocol/blob/main/spec/delivery-contract.md#44-the-task-registry--companion-registered-types) | [`trust-profile`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/trust-profile.schema.json) |
| `continuity-probe/0.1` | a `continuity-probe@1`: blinded values, one per existing relationship, padded to a fixed size | [Trust §6a.2](https://github.com/real-life-org/trust-protocol/blob/main/spec/trust-layer.md#6a2-continuity-probe1-sequenced-chunked-padded-blinded) | [`visibility-continuity-probe`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/visibility-continuity-probe.schema.json) |
| `continuity-mapping/0.1` | a `continuity-mapping@1`: chains a re-encounter to the existing relationship | [Trust §6a.4](https://github.com/real-life-org/trust-protocol/blob/main/spec/trust-layer.md#6a4-continuity-mapping1-one-chooser-one-trigger) | [`visibility-continuity-mapping`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/visibility-continuity-mapping.schema.json) |
| `introduction-request/0.1` | `{ introduction, card }`, requester to mediator: the request and the requester's fresh card | [Trust §8.1](https://github.com/real-life-org/trust-protocol/blob/main/spec/trust-layer.md#81-precondition-carrier-pins-and-the-per-role-lifecycle) · [§8.2](https://github.com/real-life-org/trust-protocol/blob/main/spec/trust-layer.md#82-artifacts) | [`visibility-payload-introduction-request`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/visibility-payload-introduction-request.schema.json) |
| `introduction-forward/0.1` | `{ introduction, card }`, mediator to target: the request, byte-identical | [Trust §8.1](https://github.com/real-life-org/trust-protocol/blob/main/spec/trust-layer.md#81-precondition-carrier-pins-and-the-per-role-lifecycle) | [`visibility-payload-introduction-forward`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/visibility-payload-introduction-forward.schema.json) |
| `introduction-reply/0.1` | `{ introduction, card }`, target to mediator to requester: the reply and the target's fresh card | [Trust §8.1](https://github.com/real-life-org/trust-protocol/blob/main/spec/trust-layer.md#81-precondition-carrier-pins-and-the-per-role-lifecycle) · [§8.2](https://github.com/real-life-org/trust-protocol/blob/main/spec/trust-layer.md#82-artifacts) | [`visibility-payload-introduction-reply`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/visibility-payload-introduction-reply.schema.json) |
| `introduction-ack/0.1` | `{ introduction }`, mediator to requester: an `introduction-ack@1`, after a fixed delay | [Trust §8.1](https://github.com/real-life-org/trust-protocol/blob/main/spec/trust-layer.md#81-precondition-carrier-pins-and-the-per-role-lifecycle) · [§8.4](https://github.com/real-life-org/trust-protocol/blob/main/spec/trust-layer.md#84-the-acknowledgement) | [`visibility-payload-introduction-ack`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/visibility-payload-introduction-ack.schema.json) |
| `introduction-voucher/0.1` | `{ voucher }`, mediator to each side: which fresh anchor belongs to the other | [Trust §8.1](https://github.com/real-life-org/trust-protocol/blob/main/spec/trust-layer.md#81-precondition-carrier-pins-and-the-per-role-lifecycle) · [§8.5](https://github.com/real-life-org/trust-protocol/blob/main/spec/trust-layer.md#85-the-voucher) | [`visibility-payload-introduction-voucher`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/visibility-payload-introduction-voucher.schema.json) |

## Message

A text message from one contact to the other. The payload is the
artifact; it carries its own MAC, the document carries no proof.

| Type | Carries | Rules | Schema |
|---|---|---|---|
| `message/0.1` | a `message@1`: a text of at most 4096 characters for one contact, deniable | [Message Tasks §3](https://github.com/real-life-org/trust-protocol/blob/main/spec/message-tasks.md#3-message01) · [§4](https://github.com/real-life-org/trust-protocol/blob/main/spec/message-tasks.md#4-reception) | [`message`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/message.schema.json) |

## Access

Key material and the removal notice.

| Type | Carries | Rules | Schema |
|---|---|---|---|
| `key-delivery/0.1` | `{ keyDelivery }`: epoch keys, welcomes, refresh material, and the request for them | [Access §10.1](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#101-key-delivery01) | [`payload-key-delivery`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/payload-key-delivery.schema.json) |
| `removal-notice/0.1` | the signed notice object: tells a removed member of the `member.remove` | [Access §10.2](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#102-removal-notice01) | [`payload-removal-notice`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/payload-removal-notice.schema.json) |

## Membership

The transport of membership changes: invitation, consent, the
admitting operation, and the evidence relay. A sender issues
`membership-evidence/0.2`; a receiver also accepts `/0.1`
([RLTP-MT-3815](https://github.com/real-life-org/trust-protocol/blob/main/spec/membership-tasks.md#34-membership-evidence02)).

| Type | Carries | Rules | Schema |
|---|---|---|---|
| `membership-invite/0.2` | `{ invite }`: a DTG InvitationCredential, with no keys and no operation | [Membership §3.1](https://github.com/real-life-org/trust-protocol/blob/main/spec/membership-tasks.md#31-membership-invite02) | [`payload-membership-invite`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/payload-membership-invite.schema.json) |
| `membership-accept/0.2` | `{ accept }`: the invitee's signed consent to exactly one invite | [Membership §3.2](https://github.com/real-life-org/trust-protocol/blob/main/spec/membership-tasks.md#32-membership-accept02) | [`payload-membership-accept`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/payload-membership-accept.schema.json) |
| `access-operation/0.1` | `{ operation, welcome }`: the admitting `member.add` and its [welcome](term:Welcome), sent to the new member | [Membership §3.3](https://github.com/real-life-org/trust-protocol/blob/main/spec/membership-tasks.md#33-access-operation01) | [`payload-access-operation`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/payload-access-operation.schema.json) |
| `membership-evidence/0.2` | `{ evidence }`: the enclosed invite and accept, with up to 16 vouches, for any member who can admit | [Membership §3.4](https://github.com/real-life-org/trust-protocol/blob/main/spec/membership-tasks.md#34-membership-evidence02) | [`payload-membership-evidence`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/payload-membership-evidence.schema.json) |
| `membership-evidence/0.1` | `{ evidence }`: the same without vouches; accepted, not issued | [Membership §3.4](https://github.com/real-life-org/trust-protocol/blob/main/spec/membership-tasks.md#34-membership-evidence02) | [`payload-membership-evidence-0.1`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/payload-membership-evidence-0.1.schema.json) |

## Delivery

The Delivery Contract's own types: the acknowledgement every
document earns, and a party's operational constants.

| Type | Carries | Rules | Schema |
|---|---|---|---|
| `delivery-ack/0.1` | `{ ref, meaning: "received" }`: arrival of one document, never acceptance | [Delivery §4.2](https://github.com/real-life-org/trust-protocol/blob/main/spec/delivery-contract.md#42-delivery-ack01) | [`payload-delivery-ack`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/payload-delivery-ack.schema.json) |
| `registry-declaration/0.1` | `{ declaration }`: a party's signed operational constants for one role | [Delivery §4.4](https://github.com/real-life-org/trust-protocol/blob/main/spec/delivery-contract.md#44-the-task-registry--companion-registered-types) | [`payload-registry-declaration`](https://github.com/real-life-org/trust-protocol/blob/main/schemas/payload-registry-declaration.schema.json) |

`https://real-life.org/trust-tasks/delivery-carrier/0.1` names the
carrier role in a `registry-declaration/0.1`. It is not a document
type: a document of that type is rejected as unknown.
