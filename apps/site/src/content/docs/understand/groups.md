---
title: Groups
description: How a group holds itself together. A place on its members' devices, rules instead of admins, joining by consent, leaving and removal, people and their devices, and what happens when changes meet.
---

## What a group is

A [group](term:Group) is a place its [members](term:Member) hold together: an encrypted document on
each member's device, with a [log](term:AuthorityLog) of who joined, who left and which
[rules](term:Policy) apply. Inside it is the group's shared space:
replicated state that holds the app's data: events, places, tasks,
messages. The protocol does not care what the data is;
it cares who may read and change it.

The log is the group's memory of itself. Every entry is a signed act of
one member: founding the group, admitting someone, removing someone,
changing a rule. Each device reads the same log in the same way and
arrives at the same answer to who belongs and what is allowed. No server decides who belongs.

The group's identity is the digest of its founding entry, not a key
anyone holds, so nobody owns the group or can take it over.

Spec: [Access Layer §3](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#3-the-authority-log)

## Rules, not admins

The group states its own rules as data: who may invite, who may admit,
who may remove, whether a newcomer needs [vouches](term:Vouch), and who may change
the rules. Every device checks them before it accepts a change.

A founder in charge is only the simplest rule,
and the group can replace it, for example with two members deciding
together, or with every member having a say in removals. The rules for
changing the rules are protected in the same way, so a group cannot
lock itself out of its own constitution.

Spec: [Access Layer §4](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#4-policy)

## Joining

Someone who knows you invites you. The [invitation](term:Invite) carries no keys; it
names you and the group, and it expires. Nobody joins without accepting.

When you accept, a member who may admit writes your admission into the
log, with the invitation and your [acceptance](term:Accept) enclosed as proof. A
[welcome](term:Welcome) then brings you the current key. Older content becomes readable
through the group's own copy, as far back as its keys reach.

If the group asks for vouches ([Trust](/understand/trust/)), other members confirm your admission
before it counts. A vouch is for this one admission and never stands
for a later one.

Spec: [Access Layer §5.3](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#53-admission-and-removal) ·
[Membership Tasks](https://github.com/real-life-org/trust-protocol/blob/main/spec/membership-tasks.md)

## Leaving and removal

You can leave at any time. A member can be removed when the group's
rule allows it. Either way, and when a device is lost, the group moves
to a new [key epoch](term:Epoch).

What is written afterwards stays unreadable to whoever lost access.
What they already read, they keep; no protocol can make someone forget.
The person who was removed is told so.

A group can also end itself. Dissolving it is one more entry in the
log, made under the group's rules like any other.

Spec: [Access Layer §5.4](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#54-leave-pending-exit-and-dissolve) ·
[§7](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#7-epochs)

## People and devices

Members are people, not devices. Each of a member's devices holds its
own key and is tied to the person by a signed [device card](term:DeviceCard) in the log.
The person adds their own devices, up to eight.

So a lost phone can be cut off without its owner leaving the group. A member whose devices are all gone is still a member.
How the keys follow such changes, and how a device gets back in, is
on [Group keys and replication](/understand/group-keys/).

Spec: [Access Layer §5.1](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#51-identity)

## When things happen at the same time

Members often act without knowing of each other, offline or at the
same moment. Devices merge such changes once they meet, and the rules
decide how.

Two removals both take effect, even when two members remove each
other. A dissolution made at the same time as a removal lapses and can
be made again. Only one collision stops the group: a change of the
rules made at the same time as a removal. The group then shows this
openly and waits until a member writes a rule change that takes both
sides into account.

Spec: [Access Layer §3.6](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#36-concurrency-the-conflict-matrix)

## Try it

The [app simulator](/simulator/network.html) runs the same app on three
devices: found a group, invite, accept, and watch every sealed envelope
on the wire. The other simulators are listed under
[Try it](/get-started/try-it/).
