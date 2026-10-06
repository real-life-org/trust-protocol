---
title: Groups
description: How a group holds itself together. A place on its members' devices, rules instead of admins, joining by consent, leaving and removal, people and their devices, and what happens when changes meet.
---

## What a group is

A group is a place its members hold together: an encrypted document on
each member's device, with a log of who joined, who left and which
rules apply. Everything the group knows about itself is read from that
log, the same way on every device.

Its identity is the digest of its founding entry, not a key anyone
holds. Nobody owns the group, and nobody can take it over by taking a
key.

Spec: [Access Layer §3](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#3-the-authority-log)

## Rules, not admins

The group states its own rules as data: who may invite, admit or
remove, and who may change the rules. Every device checks them before
it accepts a change. A founder in charge is only the simplest rule,
and the group can replace it with another, for example two members
deciding together.

Spec: [Access Layer §4](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#4-policy)

## Joining

Someone who knows you invites you. You accept or decline; nobody joins
without consenting. A member who may admit writes your admission into
the log, with the invitation and your acceptance as proof, and you
receive the key. If the group asks for vouches, other members confirm
this one admission.

Spec: [Access Layer §5.3](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#53-admission-and-removal) ·
[Membership Tasks](https://github.com/real-life-org/trust-protocol/blob/main/spec/membership-tasks.md)

## Leaving and removal

Removal, leaving or losing a device starts a new key epoch. What is
written afterwards stays unreadable to whoever lost access; what they
already read, they keep. Nothing waits for an expiry date.

Spec: [Access Layer §7](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#7-epochs)

## People and devices

Members are people. Each of their devices holds its own key, so a lost
phone can be cut off without its owner leaving the group.

Spec: [Access Layer §5.1](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#51-identity)

## When things happen at the same time

Members often act without knowing of each other, offline or at the
same moment. Devices merge such changes. Two removals both take effect,
even when two members remove each other. Only a rule change made at the
same time as a removal stops the group, visibly, until a member
resolves it.

Spec: [Access Layer §3.6](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#36-concurrency-the-conflict-matrix)

## Try it

The [app simulator](/simulator/network.html) runs the same app on three
devices: found a group, invite, accept, and watch every sealed envelope
on the wire. The other simulators are listed under
[Try it](/get-started/try-it/).
