---
title: Encounter
description: How two people record that they met. The card, the challenge, the one scan, the credential each side holds, and what nobody else can read from it.
---

## What an encounter records

Two people stand together. One shows a code, the other scans it,
and whoever presses the button that says "I recognize this person"
produces a credential that the other person keeps. Often both press.
One press is enough for an encounter in RLTP; the second is a free
decision, not a requirement.

The credential proves four things and nothing more:

| It proves | Because |
|---|---|
| The issuer held their key at that moment | the credential is signed with it |
| The two codes were exchanged within one act | the credential binds the other side's fresh challenge |
| A human decided | nothing is issued without the press |
| The fact survives the moment | the credential is immutable and stays with its holder |

It does not prove that the two were in the same room, that their
names are real, or that either trusts the other. Trust is a separate
act, described in [Foundations](/understand/foundations/).

Spec: [Encounter Layer §3](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#3-what-an-encounter-establishes)

## The card

What travels over the code is a **contact card**: the anchor the
person uses for this encounter, an encryption key so that the other
side can seal messages to them, a one-time challenge, and optionally
a name and delivery hints. The card is signed with the anchor. It is a
self-description, not a credential: it says how to recognize and reach
someone, not that anyone vouches for them.

The name on a card is self-declared. The receiver binds their own
local name to the anchor, the way a phone book entry is the owner's
word, not the contact's.

There are two kinds. The **displayed card** is the one shown as a
code; it is addressed to nobody, anyone may scan it. The **sent card**
is the one the scanner creates in answer. It carries two fields more:
whom it is for, and which displayed challenge it answers. Both fields
exist so that a card cannot be redirected to a third person or
replayed into another encounter.

Spec: [Encounter Layer §6](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#6-the-contact-card)

## The challenge

A **challenge** is a fresh random value on the card, with the time it
was issued. It turns "I know your anchor" into "I saw your code in
this exchange": the credential one side issues binds the challenge
the other side showed, and nobody who did not see that value can
issue a credential for this encounter. It does not prove presence; a
code can be relayed to someone elsewhere. What stops that is the
person pressing the button, not the challenge.

Three rules keep it that way. Each person generates the challenge
that protects them. A challenge is consumed once; the displayer
rotates its code and never accepts the same value for a second act.
And a challenge ages out; five minutes after it was issued it is
unusable, whatever a clock says later.

Spec: [Encounter Layer §5.3](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#53-challenges)

## One scan

The ceremony of this version needs one scan.

1. B shows a card with challenge *c<sub>B</sub>*.
2. A scans it, creates a sent card with a fresh challenge
   *c<sub>A</sub>*, addressed to B and answering *c<sub>B</sub>*.
3. A confirms the person and issues a credential that binds
   *c<sub>B</sub>*. Card and credential go to B.
4. B checks that *c<sub>B</sub>* is still open, records the encounter,
   and may confirm in turn, issuing a credential that binds
   *c<sub>A</sub>*.

Two clocks apply, and they are different. A credential must be dated
within a day of the exchange it belongs to, or the receiver rejects it
as stale. Its delivery has no deadline: it may arrive weeks later and
is still accepted, because the receiver checks the dates it carries,
not the day it arrived.

Step 3 reaches B in one of two ways, and the device may switch
between them at any moment. With a network, card and credential travel
as a sealed bundle through the delivery service. Without one, A shows
the sent card as a code and B scans it; the credential follows
whenever a network next carries it. Neither way needs a third party,
and nothing about the encounter is decided by when a message arrives.

A credential issued before the press, or without the other side's
challenge, does not exist. The record on each device precedes the
credential, so a crash between the two leaves nothing half-written.

Spec: [Encounter Layer §5](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#5-ceremonies-and-enactments)

## One-sided is a result

The credentials of one encounter form an **edge** between the two
anchors. If only A confirmed, the edge is one-sided: A says they
recognized B, B has said nothing. That is a legitimate outcome, not a
failure, and the app shows it as such. The edge becomes mutual when
each side holds the other's credential. Mutuality is held, never
inferred: a card addressed to you suggests recognition, only the
credential proves it.

Spec: [Encounter Layer §4](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#4-anchors-credentials-edges)

## Fresh anchors, and what outsiders see

Every encounter is performed under a **fresh pair anchor**, an
identifier created for this one act. The credential names that
anchor, not the person. Anyone can verify that a credential is
properly signed, and anyone holding both credentials of an encounter
can verify that they fit together. What that shows is that two
anchors mutually assert an encounter, consistently. It does not show
that a meeting took place, since two colluding key holders can
produce the same pair. And the credential pair alone does not show
who the two are; that takes a link one of the holders discloses, and
either of them can, since each keeps a copy.

What fresh anchors do not hide is the exchange itself. The codes are
readable by anyone who sees the screens: the anchors, a name if the
card carries one, and the field that ties the second code to the
first. Someone watching both screens sees that these two anchors met
just now. What they cannot see is any earlier encounter or any
existing relationship of either person, because every act uses a new
anchor.

Meeting the same person again creates a new pair anchor. After the
ceremony, a continuity probe over the fresh channel lets the two
devices find out that they already share a relationship; only a
counterpart that holds the earlier one can answer it. On a match the
new pair is chained to that relationship, and the chain is visible to
its two holders alone.

Spec: [Encounter Layer §8](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#8-what-a-third-party-can-verify) ·
[Network Visibility](https://github.com/real-life-org/trust-protocol/blob/main/spec/network-visibility.md)

## What the credential is

A **DTG Relationship Credential**: a verifiable credential in the
form of the ToIP Decentralized Trust Graph work, issued to the person
it is about, who holds it and shows it to whom they choose. The
issuer keeps a copy, may show it too, and cannot alter, revoke, or
condition it afterwards;
whether the recipient agrees is said only by a credential they issue
themselves. Its size is bounded by the issuer: at most 2048 bytes in canonical form, so no transport ever has to refuse one.

Spec: [Encounter Layer §7](https://github.com/real-life-org/trust-protocol/blob/main/spec/encounter-layer.md#7-the-encounter-credential)

## Try it

The [ceremony simulator](/simulator/index.html) runs one encounter
between two devices in your browser, with both paths and the
one-sided case. The other simulators are listed under
[Try it](/get-started/try-it/).
