---
title: Trust
description: What turns encounters into a network. One relationship across many meetings, what you reveal when you trust someone, the blinded star, being introduced, vouching inside a group, and what nobody else can read.
---

## Trust is a second step

Verifying someone means this: a real person stands here, and this
key is theirs. That is all an encounter records, and it is why you
can do it with anyone, without risk. Every encounter runs under a
fresh pairwise anchor, so verifying a stranger gives them nothing of
you beyond this one meeting.

Trust is a second, deliberate act. It follows only if you want it to,
and only toward people you actually trust. It is not a document you
could show to a third party; it is you sharing something about
yourself explicitly with this one person. This page is about that act
and what grows from it.

Spec: [Encounter Layer §3](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#3-what-an-encounter-establishes)

## One relationship, many meetings

Every encounter runs under a fresh pair anchor, so on the wire a second
meeting with the same person looks like a stranger. Right after the
scan, before anything else, the two devices run a **continuity
probe**: a short list of blinded values that only a counterpart
holding the earlier relationship can match. A match links the new
pair to the old one, and the app shows "re-verified" instead of a new
contact. No match means a new contact, honestly.

The chain of pairs is held by the two of them and visible to nobody
else. A contact who lost their data cannot answer the probe and is,
truthfully, a new relationship from then on.

Spec: [Network Visibility §6a](https://github.com/real-life-org/trust-protocol/blob/main/spec/network-visibility.md#6a-continuity-normative--the-other-half-of-encounter-44) ·
[Encounter Layer §4.4](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#44-the-enacting-anchor-fresh-always-normative)

## Trusting means showing who you are

Besides the pair anchors of each relationship, every person has one
anchor that is theirs across relationships: the **community anchor**,
the member anchor of their own personal community. Nothing links it
to any pair anchor, unless the holder says so.

Trusting a contact is saying so, to that one contact: an **anchor
mapping** that states "the person you met under this pair anchor and
the holder of this community anchor are the same". It is built so
that only the addressee can check it; the proof is a shared secret
between the two, not a signature. Whoever issues an anchor decides,
per recipient, who gets to see it. Nobody may pass it on in your
name.

Spec: [Network Visibility §6.1](https://github.com/real-life-org/trust-protocol/blob/main/spec/network-visibility.md#61-purpose-and-construction) ·
[Identity Layer §6](https://github.com/real-life-org/trust-protocol/blob/main/spec/identity-layer.md#6-context-labels-normative)

## What your contact can do with it

Two things. They can recognize you: wherever your community anchor
turns up for them again, in another relationship or in a group where
you lifted the pseudonym for them, their app knows it is you, and two
entries become one person on their device. And they can test: when
someone else sends them a star, they can check whether you are in it.

Two things they cannot do. They cannot prove the link to anyone else;
the mapping verifies for them alone, and they could have forged it
themselves. And they cannot take your community anchor into a group
or a star as a plain value; it never appears in the open.

What they do hold from then on is your anchor and how to reach you.
Trust is revocable in distribution, not in possession: you can stop
sending, you cannot make someone forget.

Spec: [Network Visibility §6.3](https://github.com/real-life-org/trust-protocol/blob/main/spec/network-visibility.md#63-verification--the-closed-condition-list) ·
[Access Layer §5.5](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#55-member-mapping1--the-deliberate-crossing-of-the-group-boundary)

## The blinded star

A **star** is what one person sends to one contact to let them relate
the two contact sets. It lists the people who trusted the sender,
but not as anchors: each entry is the person's community anchor run
through a keyed hash, with a key that holds for this sender, this
recipient and this delivery only.

The recipient can do exactly one thing with it: test the anchors
they already hold. A hit means "this person trusted both of us".
An anchor they do not hold reveals nothing, and no new anchor ever
reaches them through a star. A star is deliberately unsigned, so it
proves nothing about the sender's relationships to anyone; it is a
test instrument, not evidence.

That is also what it is for. When a verifier asks how many people
stand behind someone, the useful answer is not "forty" but "forty,
three of whom you know". The star is how the three are found without
anyone handing over a list.

Spec: [Network Visibility §5](https://github.com/real-life-org/trust-protocol/blob/main/spec/network-visibility.md#5-the-star-normative) ·
[§7](https://github.com/real-life-org/trust-protocol/blob/main/spec/network-visibility.md#7-relational-counts-normative-principle-artifact-unwritten)

## Meeting through someone you both know

There are two ways to gain a contact: meet them, or be introduced by
someone who knows you both. An **introduction** is five messages
through the mediator: the request with a fresh card, the forward, the
reply with the target's fresh card, the acknowledgement, and a voucher
to each side. The mediator carries messages, never anchors; the two
new pair anchors are issued by their owners for the new relationship.
The target decides on their own device, and the requester is told the
same thing whether the answer was yes or silence.

A relationship from an introduction carries that origin with it. The
first real encounter upgrades it, and nothing downgrades it. The
limit is stated plainly: a mediator could play one side itself.
That is why an introduced relationship is the weaker one until the two
have met.

Spec: [Network Visibility §8](https://github.com/real-life-org/trust-protocol/blob/main/spec/network-visibility.md#8-the-introduction-act-normative)

## Vouching inside a group

A group can require that a newcomer is vouched for. A **vouch** is a
member's signed statement for exactly one admission of exactly one
person, made inside the group where other members can check it. It
names how the voucher knows the person, met or introduced, as their
own word, not as a verified fact. A vouch never stands for a later
admission, and an encounter credential is not a vouch: its anchors are
fresh pair anchors that no group rule can name.

Spec: [Access Layer §5.3](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#53-admission-and-removal)

## What nobody else can read

There is no graph anywhere. No directory, no crawl, no server that
holds the relationships. A third party who collects leaked
credentials learns that two anchors it cannot attribute assert an
encounter. Mappings, continuity, vouchers of an introduction: a third
party cannot even verify them, let alone attribute them.

And trust does not travel. If you trust someone and they trust a
third, the protocol computes nothing from it. There is no trust depth
and no transitive score, on purpose. A verifier learns about a
person's relationships only because that person shows them, and only
as far as the verifier already knows the people involved.

A transferable statement of trust, something you could present about
a third person, does not exist in this version. Whether and in what
form it should is an open question, discussed with the people who
build the credential formats this protocol uses.

Spec: [Personhood Predicates §1.1](https://github.com/real-life-org/trust-protocol/blob/main/spec/personhood-predicates.md#11-the-two-structural-facts) ·
[§6](https://github.com/real-life-org/trust-protocol/blob/main/spec/personhood-predicates.md#6-what-no-predicate-establishes) ·
[Encounter Layer §8](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#8-what-a-third-party-can-verify)
