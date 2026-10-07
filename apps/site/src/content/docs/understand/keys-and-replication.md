---
title: Keys and replication
description: What holds a group's secrets and who carries them. Two ports, key states instead of epoch numbers, the adapters that produce keys, what the replication service may know, and how a person gets back in after losing a phone.
---

## Two ports

A group has two kinds of truth. Who belongs and what is allowed is
decided by the **authority log**: every device replays the same
signed entries and arrives at the same answer. What the content is
encrypted with is produced by the **key port**: a procedure that turns
the current membership into a secret only members hold.

The protocol keeps the two apart. The authority side is the
protocol's own and the same for every group. The key side is a port
with six invariants, and a group picks a registered adapter to fill
it. Whatever the adapter does, the log decides and the keys follow:
when the log says someone is out, the adapter owes a key that person
cannot derive.

Spec: [Access Layer §9.1](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#91-the-authority-port) ·
[§9.2](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#92-the-key-port)

## Key states, not epoch numbers

Every removal, rotation or rule change starts a new **key state**. A
key state is named by the entry that created it, not by a counter,
because two members who act at the same time both create one, and
the group must be able to tell them apart afterwards. Each new state
says which states it succeeds, so the history of keys is a small
graph that grows with the log.

Where two states meet, the adapter brings them together into one,
either by merging their secrets or by a fresh rotation that heals the
split. Nobody has to notice; the next entry anyone writes carries the
repair. The epoch number still exists, but only as a counter for
views and ordering.

Spec: [Access Layer §7.1](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#71-transitions-and-the-retained-set) ·
[§9.2](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#92-the-key-port)

## Reading back

A member holding the current key can read the group's history as far
back as the adapter's chain reaches. Under the first adapter each new
state carries the previous key sealed under the new one, so a
newcomer unlocks the past step by step from the group's own copy.
History is never narrowed: a welcome brings one key, the replica
brings the rest.

A group that opens its content to the world publishes its keys from
that moment on. Opening older content is a separate, recorded
decision, and it always opens from the beginning, because a key opens
everything its chain reaches.

Spec: [Access Layer §8](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#8-visibility-modes) ·
[§9.4.1](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#941-linear01)

## Two adapters

**linear/0.1** is the procedure in use today: one content key per
state, delivered to each device individually, healed by rotation when
states merge. It is simple and costs one message per device per
change.

**beekem/0.1** is experimental: a key tree in the style of MLS and
Keyhive, where a change costs a path through the tree instead of a
message per device. It is registered so that implementations can try
it against the same log and the same invariants; the parts that are
not settled are listed as open issues.

Spec: [Access Layer §9.4](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#94-registered-adapters)

## What the replication service may know

Members are rarely online at the same time, so a group may register a
**replication service**: a party that stores its encrypted entries and
hands them to whichever member connects next. The service holds no
keys. What it knows beyond the ciphertext is the group's choice,
stated at registration in one of three classes:

| Class | Knows | Can do |
|---|---|---|
| `blind` | ciphertext and addresses | store and hand on, nothing else |
| `view` | also who the current devices are, from a view the members sign | refuse content from devices that are not members |
| `log` | also the authority log itself | check every entry on its own |

Four rules hold for every class. A service never blocks an entry of
the authority log, whoever wrote it. It drops nothing silently: a
refusal is visible and the sender can try again. A member who was
removed still receives the notice that says so. And a service declares
how much it will take in, so nobody is surprised by a limit.

A view is signed by a quorum of the previous view, so a service cannot
be talked into a new membership by the newcomers alone. The group pays
for the `view` class with one known residual: if an honest group
shrinks below its own quorum, the service freezes until the group
registers it again. A service of class `log` reads the removals
itself and has no such freeze.

Spec: [Access Layer §9.3](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#93-the-service) ·
[§7.3](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#73-authorization-views)

## Getting in, and getting back in

Keys travel in three situations, and each has its own path.

A **newcomer** receives a welcome sealed to the key in their
acceptance, together with the entry that admits them. They keep it
provisionally, fetch the log, and become a member once the log
confirms the admission. If the welcome never arrives or turns out
wrong, they ask again, naming their own acceptance; a fabricated
admission in a bad welcome cannot send them down a dead end.

A **second phone** is bound by the person's first phone with a signed
device card in the log, and receives material sealed to its own key.
If the first phone is lost before the second ever synced, the second
one bootstraps on its own: it asks any member, keeps the answer
provisionally, and the log confirms that the person is a member and
the device is bound and not revoked.

A **lost phone** is revoked by another of the person's devices, and
the group moves to a new key state. If it was the last device, the
person binds a new one under the rule that governs revocation; the
membership itself was never in question.

Spec: [Access Layer §10.1](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#101-key-delivery01) ·
[§5.1](https://github.com/real-life-org/trust-protocol/blob/main/spec/access-layer.md#51-identity) ·
[Membership Tasks §3.3](https://github.com/real-life-org/trust-protocol/blob/main/spec/membership-tasks.md#33-access-operation01)

## What this does not promise

A service of class `blind` can delay or withhold messages, and
nothing in the protocol proves that it did; what it cannot do is
change who belongs or read what members write. A person who was
removed keeps what they already read. And an adapter that is honest
about its invariants is still only as strong as the devices that hold
its keys.

## Where this comes from

None of this runs in a simulator yet. The two ports, the key states
and the service classes were derived in the
[port experiments](https://github.com/real-life-org/port-experimente):
one authority log driven against three existing key-agreement systems
and against a service that enforces what it is told, with the
scenarios that produced each rule recorded there.
