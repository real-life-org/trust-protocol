# RLTP Message Tasks

**Real Life Trust Protocol — task types: Message**

- **Status:** Editor's Draft
- **Version:** 0.1.0-draft
- **Editors:** Anton Tranelis
- **Date:** 2026-10-19
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Task-type namespace:** `https://real-life.org/trust-tasks/`
- **Target Trust Tasks framework version:** 0.4
- **Conformance profile:** `rltp-message@0.1` (draft). Registered
  task type: `message/0.1`, carrying the artifact `message@1`.
- **Position:** a task-type registration on top of the **RLTP
  Delivery Contract 0.82** (normative reference: document profile,
  sealed envelope, staged dispositions, acknowledgement), travelling
  on the relationship channel of a tuple of the **RLTP Trust Layer
  0.31** (normative reference: tuples and relationships, its 2 and
  6.4; wire conventions, its 2.1; the audience principle, its 3).
  This document owns one task type, its reception, and the block a
  holder applies to a relationship. It changes the defined effect of
  no other type; the companion changes that extend the block to other
  types are listed in Appendix A.
- **Companions:** RLTP Identity 0.54; RLTP Encounter 0.31; RLTP Trust
  Layer 0.31; RLTP Delivery Contract 0.82; RLTP Membership Tasks
  0.20; RLTP Access Layer 0.57.

## Status of This Document

This is an Editor's Draft with no standing beyond its own argument.
It is expected to change together with the next castings of the
Delivery Contract, Membership Tasks and the Trust Layer, which take up
the companion changes of Appendix A. The reference library does not
implement it; its vector is the MAC vector of 10.2. Open questions are listed in Section 9, and feedback is
welcome via the issues of the publication repository
(github.com/real-life-org/trust-protocol).

## Abstract

This document registers `message/0.1`: a text message from one person
to one contact, carried over the relationship of a tuple as a private
Trust Task. Its body is authenticated by a MAC under a directional key
of that relationship, so it convinces its addressee and nobody else.
A recipient records every message it accepts in a content-free
completion record, so a message is never shown twice and a message
discarded or deleted once never reappears. The document also defines
the **block**: a holder-local state of a relationship under which
messages and the offers of that relationship are discarded silently,
the protocol steps a holder owes continue, and the blocked party
observes nothing it would not observe without the block.

## 1. Introduction (informative)

### 1.1 Essence

Two people who met, or who were introduced and both agreed, hold a
relationship: a chain of tuples with one active head, each tuple a
pair of pair anchors with their key-agreement keys (Trust 2, 6.4).
A message travels on the active head as a sealed Delivery document.
Its body carries an identifier, a send time and the text; its proof
is a MAC under a key derived from the two pair keys in sender order.
Either party can compute every MAC of the relationship: the recipient
is convinced, a third party is not, and a message cannot be presented
as proof of what someone said.

A recipient keeps three things apart: the **completion record**,
which remembers per tuple which message identifiers it accepted and
under which body digest; the **inbox**, which holds accepted messages
until the application has taken them over; and the application's
conversation history, which this document does not govern.

### 1.2 Scope

In scope: direct messages between the two parties of one
relationship, text only, at most 4096 characters. Out of scope: group
messages, media, read receipts, typing indicators, editing and
deleting at the other party, and any form of reporting to a third
party. Group messages, when they come, are entries in the group's
replicated space, signed like every entry, and not a task of this
document.

### 1.3 Relation to the registry type `chat/message/0.1`

The public Trust Tasks registry holds a draft `chat/message/0.1`
(message between an agent and a messenger bridge, proof required,
messages chained by `prev`, durable retention for audit). This
document takes over its own type rather than a payload in that type,
the field names `text` and `sentAt`, the principle of a reference to
an earlier message, and the timestamp inside the protected content.
It deviates on purpose: no transferable signature (Trust 3, 3020),
no hash chain (the chain would add per-direction ordering state, fork
as soon as two devices of one sender write, and lose verifiability
with every local deletion), and no conversation or direction field
(the relationship is the conversation, the key gives the direction).

## 2. Conventions and Terminology

### 2.1 Requirement language

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD,
SHOULD NOT, RECOMMENDED, NOT RECOMMENDED, MAY, and OPTIONAL in this
document are to be interpreted as described in BCP 14 (RFC 2119,
RFC 8174) when, and only when, they appear in all capitals, as shown
here.

Every numbered rule is followed by its rationale where one is needed.
Section 10.3 places every rule either in the vector-checked set or in
the state-dependent set.

### 2.2 Terms

- **Tuple, relationship, active head** — as in Trust 2 and 6.4.
- **Arrival tuple** — the tuple the arrival channel's `rkid` selects
  (Delivery 4.4).
- **Completion record** — per tuple, the set of `(mid, bodyDigest,
  sentAt)` of the messages the recipient accepted on that tuple
  (4.4).
- **Inbox** — the recipient's durable store of accepted messages not
  yet taken over by its application (4.5).
- **Ready** — a tuple on which the holder has accepted at least one
  document whose `issuer` is the counterpart pair anchor (5.1).
- **Block** — the holder-local state of a relationship under which
  Section 6 applies.
- **Register of declined invitations** — the holder-wide set of
  credential digests of invitations declined under a block (6.4).
- **`H`** — the message lifetime of this version, `P180D`.

### 2.3 Document profile

**RLTP-MSG-2010** — A `message/0.1` document MUST follow the document
profile, sealed envelope, staged dispositions and acknowledgement
rules of the Delivery Contract (its Sections 3 to 6).

**RLTP-MSG-2020** — A `message/0.1` document MUST carry no
document-level `proof`; its one authenticity carrier MUST be the MAC
of its payload (3.3).

**RLTP-MSG-2030** — The document's `threadId` MUST be fresh per
message, opening a thread (Delivery 3).

**RLTP-MSG-2040** — The document's `issuer` MUST be the sender's pair
anchor of the arrival tuple and its `recipient` the addressee's pair
anchor of that tuple.

*Rationale.* One carrier keeps the proof where the class rule can see
it (Delivery 4.4). A message is no answer in the sense of Delivery;
the reference to an earlier message lives in the protected body. The
outer anchors bind the document to the tuple whose key verifies it.

## 3. `message/0.1`

### 3.1 Document

The payload is the artifact `message@1`, a `{ body, proof }` envelope
in the form of Trust 2.1, per `schemas/message.schema.json`:

```json
{
  "id": "…UUID v4…",
  "type": "https://real-life.org/trust-tasks/message/0.1",
  "issuer": "did:key:z6Mk…sender pair anchor",
  "recipient": "did:key:z6Mk…recipient pair anchor",
  "threadId": "…UUID v4, fresh…",
  "issuedAt": "2026-10-20T09:14:00Z",
  "payload": {
    "body": {
      "type": "message@1",
      "mid": "…UUID v4…",
      "sentAt": "2026-10-20T09:14:03Z",
      "text": "See you at the stall.",
      "replyTo": "…mid of an earlier message of this relationship…"
    },
    "proof": { "mac": "u…" }
  }
}
```

### 3.2 Body

| Property | Type | Card. | Content |
|---|---|---|---|
| `type` | string | 1 | `message@1` |
| `mid` | UUID v4, lowercase | 1 | fresh per message; the message's identity |
| `sentAt` | timestamp | 1 | the sender's clock at sending, RFC 3339 UTC in `Z` form, whole seconds |
| `text` | string | 1 | 1 to 4096 characters (Unicode code points) |
| `replyTo` | UUID v4, lowercase | 0..1 | the `mid` of an earlier message of the same relationship |

**RLTP-MSG-3010** — A `message@1` MUST consist of a body with exactly
the members of the table above and a proof with exactly `mac`.

**RLTP-MSG-3020** — `text` MUST hold 1 to 4096 Unicode code points.

**RLTP-MSG-3030** — `sentAt` MUST be a calendar-valid RFC 3339 UTC
date-time in `Z` form without fractional seconds; a verifier MUST
reject a date its RFC 3339 parser refuses (Trust 2550).

**RLTP-MSG-3040** — A sender MUST mint `mid` fresh from a
cryptographically secure source for every new message and MUST NOT
reuse it for a different body.

*Rationale.* A closed body leaves no room for a field the recipient
never agreed to carry, such as an anchor of a third party. `issuedAt`
lies outside the MAC; the send time the recipient shows must be
protected, so it lives in the body. Whole seconds are enough for a
conversation and give the clock no finer resolution than needed.

### 3.3 Key and MAC

**RLTP-MSG-3110** — The `mac` MUST be the MAC of Trust 2.1
(HMAC-SHA-256 over `JCS(body)`, encoded `u` + 43 base64url
characters) under the directional key `k_msg = HKDF-SHA-256(ikm =
X25519(pairX_sender, pairX_recipient), salt = empty, info =
"rltp/v1/message/mac/" || senderPairAnchor || "/" ||
recipientPairAnchor, 32 bytes)`, both anchors as anchor bytes (Trust
2520), `pairX` the key-agreement keys of the arrival tuple.

**RLTP-MSG-3120** — An all-zero X25519 output MUST be rejected before
derivation (Trust 2500).

*Rationale.* The key binds both pair anchors in sender order, so a
message cannot be replayed from one direction into the other or into
another relationship. Its own info string keeps it apart from every
other key derived from the same pair (Trust 2490). The key is the
same whether the relationship began with an encounter or with an
introduction: a tuple is the pair of pair anchors of either act
(Trust 2), and an introduction's card carries the key-agreement key
like an encounter's (Trust 8050, Encounter 6020).

### 3.4 Declarations

**RLTP-MSG-3210** — The registration of `message/0.1` MUST declare:
payload schema `schemas/message.schema.json`; document proof absent;
payload proof the inner MAC of 3.3; acknowledgement in the MAC form
of Delivery 4.2 (designated-verifier class, Delivery 4.4); side
effect *mutating* (completion record and inbox); exposure
recipient-only.

**RLTP-MSG-3220** — `message@1` MUST be treated as audience class S
of Trust 3: a statement of the sender directed at one addressee,
deniable, never presentable.

*Rationale.* The framework asks every type to declare its proof
(Trust Tasks 0.4); the profile of RLTP keeps the document free of a
proof and authenticates the body. A transferable signature would hand
every recipient a permanent proof of what was said, which the purpose
of a message never requires (Trust 3010, 3020).

## 4. Reception

### 4.1 Checks

**RLTP-MSG-4010** — At Delivery stage 7 the payload MUST validate
against `schemas/message.schema.json`, else `failed(malformed)`.

**RLTP-MSG-4020** — At stage 8 the receiver MUST reject with
`failed(validation-failed)` a document whose `issuer` is not the
counterpart pair anchor of the arrival tuple, whose `recipient` is not
the own pair anchor of that tuple, or whose `mac` does not verify
under `k_msg` of that tuple.

**RLTP-MSG-4030** — At stage 8 the receiver MUST reject a document
arriving on a tuple that is not the active head of a current
relationship (Trust 6190, 6240) with `failed(validation-failed)`.

**RLTP-MSG-4040** — Inside the stage-9 critical section (4230) the
receiver MUST reject with `failed(stale-issuance)` a message whose
`sentAt + H` lies before the reference time `t_ref` of 4060.

**RLTP-MSG-4050** — Inside the stage-9 critical section the receiver
MUST reject with `failed(validation-failed)` a message whose `sentAt`
lies more than one day (`P1D`) after `t_ref`.

**RLTP-MSG-4060** — The holder MUST persist a time `mark` that never
lowers. Every transaction that accepts a message or deletes a
completion-record entry MUST read `t_ref = max(now, mark)` once, use
that `t_ref` for every time comparison it makes, write `mark = t_ref`,
and commit only if `mark` is unchanged since its read; otherwise it
MUST commit nothing and re-enter at stage 4 (acceptance) or start
again (deletion). A receiver MAY apply 4040 and 4050 at stage 8 as an
early check against its clock; that check never replaces the one in
stage 9.

*Rationale.* The outer binding and the MAC tie the message to one
direction of one tuple. A deactivated tuple accepts nothing new; the
continuity and introduction exceptions of Trust 6200 and 6210 do not
concern messages. The age bound is what lets a recipient forget its
completion record (4.4): a message older than `H` can no longer be
accepted, so no record older than `H` is needed to refuse its replay.
It is a rule of this type and an exception to Delivery 1.1 and 7,
under which delivery time is unbounded; Appendix A names the change.
The future bound is wide enough for a wrong clock and only bounds how
long a record is kept. A clock set back after a record was deleted
would let the deleted message pass the age bound again; the persisted
mark keeps the age bound and the deletion on one time that never runs
backwards.

### 4.2 Rate and inbox bound

**RLTP-MSG-4110** — Per relationship, a receiver MUST NOT accept more
than 500 new `message/0.1` document digests in any 24 hours, and MUST
NOT hold more than 2000 inbox entries.

**RLTP-MSG-4115** — Per relationship, a receiver MUST NOT accept more
than 20 invitations with a credential digest new to it in any 24 hours
(attribution per 6110).

**RLTP-MSG-4120** — A document beyond a bound of 4110 or 4115 MUST be disposed
`failed(rate-limited)` at stage 8: nothing is committed, no
acknowledgement is produced, the digest does not enter the
completed-effect cache, and the receiver MUST NOT conclude the
document toward its carrier (Delivery 5a.8).

**RLTP-MSG-4130** — The bounds MUST be counted before the block of
Section 6 is applied, and a message discarded under a block MUST count
toward the inbox bound as an entry taken over at once.

**RLTP-MSG-4140** — A receiver MUST re-evaluate a document it disposed
`failed(rate-limited)` in full when it is delivered again (Delivery
6.2 stage 4).

*Rationale.* 4096 characters bound one message, not the state a
contact can make a recipient hold. Counting new digests, not new
`mid`s, also bounds a known body sent again in fresh envelopes. A
rate-limited document is not decided: it stays with the carrier and
is evaluated again later. That is a second chance, not a guarantee: a
document still held back when the carrier's give-up horizon or the
age bound (4040) is reached fails for good. The invitation bound
keeps one relationship from filling the register of 6.4 without
limit. Counting before the block keeps the bound's
observable behaviour equal for a blocked and an unblocked
relationship. `rate-limited` is not in the closed failure set of
Delivery 0.81 and every failure there is terminal; Appendix A names
the change.

### 4.3 Defined effect

**RLTP-MSG-4210** — The defined effect of an accepted `message/0.1`
MUST be, in the stage-9 transaction together with the completed-effect
cache entry and the acknowledgement (Delivery 4.2, 6.2): the entry of
the completion record (4.4), and, unless the relationship is blocked
(Section 6), an inbox entry (4.5).

**RLTP-MSG-4220** — The receiver MUST NOT use a disposition that
skips the cache entry or the acknowledgement for an accepted message.

**RLTP-MSG-4230** — The stage-9 lock set of a `message/0.1` document,
and of an invitation attributed to a relationship (6110), MUST extend
by that relationship, acquired with the digest as one acquisition
(Delivery 6.2); inside the critical section the receiver MUST evaluate
4030, 4040, 4050, 4110 to 4130, 4310 to 4330 and the block on the
state it holds then, and a waiter MUST re-enter at stage 4.

**RLTP-MSG-4240** — Setting or clearing a block, a chaining onto the
relationship (Trust 6220), a merge or split that moves it, and a
deletion of a completion-record entry of one of its tuples MUST
acquire the same relationship key before they commit.

*Rationale.* The acknowledgement attests the durable defined effect,
never display or reading (Delivery 4.2). Writing all of it in one
transaction leaves no state in which a sender sees "delivered" for a
message the recipient can lose. The digest alone serializes only
copies of one document: two envelopes of one `mid`, or two documents
at the last unit of a rate, would otherwise both pass. The
relationship key serializes every message and invitation of one
relationship, as the assembly key does for the chunks of a star
(Delivery 6.2), and the writers that change head or block take the
same key, so nothing a check read can change before the commit.

### 4.4 Completion record

**RLTP-MSG-4310** — A receiver MUST hold, per tuple and inbound
direction, a completion record of `(mid, bodyDigest, sentAt)` for
every message it accepted on that tuple, `bodyDigest` the digest of
Trust 2470 over `JCS(body)`.

**RLTP-MSG-4320** — A message whose `mid` the completion record of
the arrival tuple holds with an equal `bodyDigest` MUST have no new
effect and MUST earn a freshly generated acknowledgement, with its own
cache entry.

**RLTP-MSG-4330** — A message whose `mid` the completion record holds
with a different `bodyDigest` MUST be disposed
`failed(validation-failed)`.

**RLTP-MSG-4340** — A receiver MAY delete a completion-record entry
only in a transaction under 4240 and 4060 whose `t_ref` lies after
the entry's `sentAt + H`, or once its tuple is deactivated, and MUST
keep it otherwise.

**RLTP-MSG-4350** — Deleting a message from the inbox or from the
application's history MUST NOT delete its completion-record entry.

*Rationale.* The Delivery cache answers duplicates of one document
only while it is retained (Delivery 4.2), and a fresh envelope of the
same body is a new document. The completion record makes the answer
per message and outlives the cache: a message accepted, discarded or
deleted once has no second effect. A different body under a known
`mid` is equivocation. After `sentAt + H` the age bound refuses the
message by itself (4040), and a deactivated tuple accepts nothing
(4030). Age check, deletion and acceptance read one persisted time
under one key: a deletion raises `mark` past `sentAt + H` before the
entry is gone, so an acceptance that commits after it reads that mark
and refuses the message by age; an acceptance that commits before it
still finds the entry. A message that passed an early check at stage 8
and waited while the entry was deleted is refused in stage 9.

### 4.5 Inbox, time and order

**RLTP-MSG-4410** — An inbox entry MUST hold the body unchanged, the
`t_ref` of its acceptance (`receivedAt`, 4060), and a display time
`min(sentAt, receivedAt)` fixed at acceptance.

**RLTP-MSG-4420** — A receiver MUST NOT remove an inbox entry before
its application has durably taken the message over.

**RLTP-MSG-4430** — An application SHOULD order messages by display
time and, among equal display times, by `mid`, and MUST present
`sentAt` as the sender's statement, distinct from `receivedAt`.

*Rationale.* Events of a holder do not survive a restart; a message
committed and not yet taken over would otherwise be lost between the
two. The body stays unchanged so that its MAC and digest stay
checkable. A display time fixed once cannot be moved by a later
duplicate, and a sender's clock far ahead cannot push its message
above later ones. Delivery guarantees no order (Delivery 6.3), and
without a chain gaps are not detectable.

## 5. Sending

### 5.1 Who may send, and when

**RLTP-MSG-5010** — A sender MUST send a message only on the active
head of a live relationship whose relationship act is complete: an
enactment of Encounter or an introduction act of Trust 8 in which the
sender's tuple was opened.

**RLTP-MSG-5020** — A sender MUST NOT send a message on a tuple that
is not ready: until the holder has accepted on that tuple a document
whose `issuer` is the counterpart pair anchor, it MUST hold the
message unsent.

**RLTP-MSG-5030** — A sender MUST NOT send a message on a blocked
relationship (6.5).

*Rationale.* Both doors to a contact give the same key material
(3.3). They do not open both ends at once: in an introduction the
target opens its tuple at consent and the requester at the accepted
reply (Trust 8.2), and a message reaching a tuple its recipient has
not opened fails at stage 8 without an acknowledgement. Every fresh
tuple carries a continuity probe from each party (Trust 6a.3, 6830),
so readiness comes without a message of its own; on the optical path
it waits for the next delivery contact (Trust 6820).

### 5.2 Retry horizon and replies

**RLTP-MSG-5110** — A sender MUST stop retrying a message once its
clock is past `sentAt + H − P1D` and report it failed (Delivery 6.1).

**RLTP-MSG-5120** — A sender MUST set `replyTo` only to the `mid` of a
message of the same relationship, and a receiver MUST NOT reject a
message because its `replyTo` is unknown to it.

*Rationale.* A retry that outlived `H` would be refused by the age
bound; giving up a day earlier leaves room for the recipient's clock.
A `replyTo` is a pointer for display; a receiver that missed the
original, or deleted it, still shows the reply.

## 6. The block

### 6.1 Block state

**RLTP-MSG-6010** — A block MUST be chain-level state of a
relationship (Trust 2280), never per tuple and never per contact
entry.

**RLTP-MSG-6020** — Blocking a contact MUST set the block on every
relationship of its entry; unblocking MUST clear it on every one.

**RLTP-MSG-6030** — A chaining (Trust 6a.4) MUST keep the block of the
chain; a merge (Trust 2140) MUST set the block on every relationship
of the merged entry where any of them held it; a split (Trust 2080 to
2115) MUST leave each relationship with its own block.

*Rationale.* A block attached to a tuple would lapse at the next
re-encounter; one attached to a contact entry would be lost or
misplaced when entries merge, split, or stand two behind one
relationship for a while (Trust 2145). The rules follow the setting
`off`, which a merge keeps and a split takes along (Trust 2160,
2115).

### 6.2 Attribution

**RLTP-MSG-6110** — A document arriving on the tuple path MUST be
attributed to the relationship of its arrival tuple; an invitation
arriving on a member key MUST be attributed to the relationship of
the prelude binding that names its inviter. An implementation that
holds no such binding for an invitation MUST attribute it to no
relationship and MUST state in its conformance notes that it cannot
block invitations.

*Rationale.* A block applies to what one relationship sends. Documents
on member keys bind their channel themselves (Membership 3.1); for an
invitation, the binding to the contact that asked as the inviter is
what says whose offer it is. Membership defines the prelude only as
an application exchange; the binding it needs is a companion change
(Appendix A).

### 6.3 Three treatments

**RLTP-MSG-6210** — On a blocked relationship a receiver MUST treat
each type as the table below states, with stages 1 to 8 unchanged.

| Type | Treatment under block | What prevents a reappearance |
|---|---|---|
| `message/0.1` | **discard**: completion record, cache entry and acknowledgement, no inbox entry | the completion record (4.4) |
| `membership-invite/0.2` | **discard**: the silent decline of Membership 7020, recorded in the register of declined invitations (6.4) | the register (6.4) |
| `x-introduction-offer/0.1` (library form) | **discard**: the offer declined | its document digest, kept until `issuedAt + act-expiry + act-skew` (Trust 8.1) |
| `introduction-forward/0.1` | **discard**: the act enters `refused` (Trust 8380) | the act with its request digest, kept until the end of acceptance (Trust 8.1); a differing request under the same act id stays an equivocation (Trust 8100, 8240) |
| `profile/0.1`, `star/0.2`, `group-star/0.1`, `anchor-mapping/0.3` | **process, do not show**: every check and state rule as without block; the application shows nothing of the relationship | the type's own rules (Trust 6270, 6450, 6460, 5340, 5366) |
| `continuity-probe/0.1`, `continuity-mapping/0.1` | **process** | Trust 6a |
| `introduction-request/0.1` from a blocked relationship, or from an unblocked one naming a target on a blocked relationship | **unaffected**: received with its acknowledgement duty bound (Trust 8430), acknowledged at its fixed time (8650); the target counts as unresolvable, so acknowledgement and silence (8440) | Trust 8.1 |
| `introduction-reply/0.1`, `introduction-ack/0.1`, `introduction-voucher/0.1` | **unaffected**: steps of a running act | Trust 8.1 |
| `x-membership-prelude-request/0.1` (library form) | **unaffected**: answered without display; the invitation that follows is discarded | the prelude state |
| `x-membership-prelude-reply/0.1` (library form), answering the holder's own earlier request | **close**: verified, the waiting prelude closed and acknowledged; no invitation produced or sent | the closed prelude |
| `delivery-ack/0.1` | **unaffected**: terminal, sender status (Delivery 4.2) | the cache entry |
| `encounter-credential-delivery/0.1`, `registry-declaration/0.1` | **unaffected** | their own rules |
| `encounter-bundle/0.1` | **not concerned**: it opens a new relationship, which only the holder's own act can do (Trust 1020) | Encounter 5 |
| `membership-accept/0.2`, `membership-evidence/0.1`, `membership-evidence/0.2`, `access-operation/0.1`, `key-delivery/0.1`, `x-membership-welcome/0.1` (library form) | **unaffected, shown as without block**: group state | Membership 3, Access |
| `removal-notice/0.1` | **unaffected and shown** (Access 10390, 10410) | Access 10450 |

**RLTP-MSG-6220** — Discard MUST commit, in the stage-9 transaction,
the cache entry, the acknowledgement, and the record of the right-hand
column, and nothing else.

**RLTP-MSG-6230** — An application MUST NOT show content or offers of
a blocked relationship, and MUST show group state and removal notices
as without block.

*Rationale.* A block acts on the relationship, not on the transport.
Discard is reserved for types that bring an offer or content to
display or decision and have no state machine of revisions,
assemblies or consumption of their own; where the type knows a
decline, discard is that decline, triggered by the block instead of
the person. Types with such a state machine run it unchanged and are
only not shown, so that their checks, acknowledgements and the
sender's baseline stay what they would be without the block. Protocol
steps the holder owes, and the state of groups, continue: the block of
one relationship is no block of a group. The acknowledgement is kept
in every case because it attests the defined effect, never a human
decision (Delivery 4.2).

**RLTP-MSG-6240** — For every type other than `message/0.1`, 6210 to
6230 take effect with the companion changes of Appendix A; until then
an implementation of this profile that applies them MUST say so in
its conformance notes.

### 6.4 Register of declined invitations

**RLTP-MSG-6310** — A holder MUST record the credential digest
(Membership 2180) of every invitation it declines under a block in a
holder-wide register, and MUST keep the entry as long as the holder
exists.

**RLTP-MSG-6320** — Before surfacing an invitation, a holder MUST
consult the register and MUST decline silently an invitation whose
credential digest it holds, whatever relationship or prelude binding
the invitation arrives under.

**RLTP-MSG-6330** — The stage-9 lock set of every `membership-invite`
document MUST include the holder-wide key of its credential digest,
whether or not the invitation is attributed to a relationship,
acquired with the rest of the lock set as one acquisition under
Delivery 6.2, and the following MUST happen in that one transaction: the check of the
register, the check for an open prompt of the same credential digest,
and exactly one outcome of three: decline (register entry written,
an open prompt of that digest closed as declined), surface (a prompt
opened, only if none is open for that digest and the register holds
none), or no new effect (the digest is in the register, or a prompt
is open for it).

*Rationale.* A prelude binding is renewable and one contact may hold
several relationships; a record kept with one relationship or one
binding would let the same signed invitation surface again through
another. Two envelopes of one invitation can arrive under two relationships,
or under none; a key per relationship would let one path read "not
declined" while the other writes the decline, and then surface the
invitation anyway. The credential digest is the invitation's identity
(Membership 2180), so its key is the one every path of one invitation
shares, and binding the surfacing decision to it makes the outcome one
of two: no prompt, or one prompt that a later decline under a block
closes. The key is part of the lock set and acquired with it in one
acquisition (Delivery 6.2), so two such paths never hold part of a
set while waiting for the rest. Invitations are rare and a digest is small; a register for
the life of the holder costs little and closes every path.

### 6.5 Outbound

**RLTP-MSG-6410** — A holder MUST refuse, toward a blocked
relationship, a message, an invitation, and the start of an
introduction act in which that relationship would be requester,
target or mediator.

**RLTP-MSG-6420** — A holder MUST continue the protocol steps it owes
on a blocked relationship: acknowledgements, the `introduction-ack` of
a request it received, the steps of an act begun before the block
(reply, acknowledgement, voucher), continuity.

*Rationale.* A block that let the holder's own offers through would
invite the answer it is meant to stop. Withholding an owed step would
show the block to the blocked party.

### 6.6 Unblock

**RLTP-MSG-6510** — Unblocking MUST NOT delete a completion record, a
register entry, or the decline of an act, and MUST NOT surface what
was discarded under the block.

*Rationale.* After an unblock nothing reappears that was discarded as
an offer or as content during the block; the processed types show
their current state, which is not old content but the present one.

## 7. Security Considerations

**Forgery by the counterpart.** Under a MAC either party can compute
every message of the relationship, in both directions. A recipient can
fabricate a message "from" its contact; nobody else can verify either
the original or the fabrication. This is the deniability of class S
(Trust 3) and the reason a message is no evidence toward third
parties.

**No forward secrecy.** The envelope is sealed to the recipient's
key-agreement key of the tuple (Delivery 5), held for the tuple's
lifetime, and `k_msg` is derived statically. Whoever later obtains
that key decrypts every recorded envelope of the tuple; whoever
obtains a holder's state can forge messages in both directions. This
version provides deniability, neither forward secrecy nor recovery
after compromise; a new tuple from a re-encounter is the only change
of keys.

**The mediator as endpoint.** In an introduction the mediator can play
one of the two sides (Trust 8.7). Messages on such a relationship
reach the mediator. The provenance `introduction` (Trust 8790) is
what tells the person, until an encounter lifts it.

**Replay.** A captured envelope delivered again is a duplicate at
stage 4 while the cache holds it, and finds the completion record
after that (4320); a body re-wrapped in a fresh document is the same
`mid`; after `sentAt + H` the age bound refuses it (4040). A replay
into the other direction or another relationship fails the MAC
(3110). A replay after an unblock finds the completion record or the
decline it was discarded into (6510).

**Equivocation.** A sender that sends two bodies under one `mid`
gets the second refused (4330); the recipient keeps the first.

**Flooding.** A contact can send without limit. The rate and the inbox
bound (4110) cap what one relationship can make a recipient hold, and
the invitation bound (4115) caps the register of 6.4 at about 7300
entries a year per relationship, kept for the life of the holder:
with the rate exhausted for `H`, about 90 500 completion-record
entries and, for the cache retention of the Delivery Contract, about
45 000 cache entries per relationship, plus at most 2000 inbox entries.
The number of relationships is bounded only by the person's own acts,
since each needs an encounter or an accepted introduction.

**Observing a block.** The blocked party sees acknowledgements as
before for messages, invitations and offers (discard acknowledges),
and the processed types run unchanged, including the sender's star
baseline. The rate is counted before the block (4130). Two residues
remain: a request to be introduced through the blocking holder ends
like one for an unresolvable target, which is indistinguishable from
a refusal (Trust 8650); and when an unblocked relationship's inbox is
full because the application failed to take messages over, its sender
waits without acknowledgement while a blocked sender would not. The
pause of the star that a blocking application typically applies is
visible as far as Trust 5.4 makes it visible.

**Clock set back.** A deleted completion-record entry would let its
message pass the age bound again once the clock runs backwards; the
persisted mark (4060), raised with every deletion, closes this for a
clock change, not for a
holder state restored from an older backup, which restores older
records with it.

**Residual storage paths.** Two paths are bounded only by the rates of
the documents that carry them: a blocked relationship's prelude
requests are still answered (6210), and in the library form each new
genesis digest registers a member key and a prelude entry; the same
invitation credential in ever new documents earns a cache entry and an
acknowledgement each (6220) without counting against 4115, which
counts new credential digests. Both are retained only as long as
Delivery 4.2 and the prelude's lifetime require.

**Block across devices.** The block is holder state of one device;
this version does not synchronize it.

## 8. Privacy Considerations

A message is exposed to its recipient only: the carrier sees a sealed
envelope addressed to a per-relationship key (Delivery 5a.2) and no
sender (Delivery 5a.4). The recipient holds the text in its inbox and
history, and a content-free completion record of identifiers, digests
and send times for at least `H` after each send time (4340), which it
SHOULD delete then. There are no read receipts and no
typing indicators: the acknowledgement says arrival, never reading.

The send time is the sender's clock in whole seconds; it tells the
recipient when the sender wrote, which the conversation needs, and
nothing finer.

A recipient can disclose messages it holds, for instance to report
them; such a disclosure is the recipient's act, outside this
protocol, and carries no proof of authorship (Section 7). The block is
silent: it tells the blocked party nothing beyond the residues of
Section 7.

## 9. Open Issues

- **Group messages** are out of scope; whether a direct conversation
  should itself become a replicated space is open.
- **Multi-device.** Block, completion record and register are state
  of one holder device until the holder state is synchronized between
  devices.
- **Framework 0.5.** The checks of a future `issuedAt` and of
  `idConflict` concern the document profile of every type and are a
  question for the Delivery Contract.

## 10. Conformance

### 10.1 Schema

`schemas/message.schema.json` is the normative payload schema. It
closes body and proof and bounds `text`; the code-point count of
3020 is the schema's `maxLength`, the calendar validity of 3030 is
the verifier's.

### 10.2 Vector plan

`vectors/message.json`, generated by `scripts/gen-message-vector.mjs`
and recomputed by `scripts/validate.mjs`, holds:

- the positive: parties A → B of `vectors/visibility.json`, the
  shared secret, the info string, `k_msg`, the preimage, the MAC, the
  artifact validating against the schema (3010, 3110);
- MAC negatives: the reverse direction, another relationship, a
  tampered body (3110);
- schema negatives: a signature in place of the MAC, a MAC plus a
  signature, an extra member, `text` empty and of 4097 code points,
  `sentAt` with fractional seconds and on 31 April, an uppercase `mid`
  (3010, 3020, 3030);
- a calendar negative: `sentAt` on 29 February of a common year,
  schema-valid and MAC-valid, rejected by the calendar check (3030);
- a low-order negative: a recipient key-agreement key of u-coordinate
  0, whose derivation MUST fail before HKDF (3120).

Planned, with the reference implementation: a scenario set for the
reception rules with controlled clock and state (the age and future
bounds, the persisted clock mark under a clock set back after a
deletion, a replay that passes stage 8 at `sentAt + H − 1 s` while a
deletion at `sentAt + H + 1 s` commits before its stage 9 (expected:
`failed(stale-issuance)`, one inbox entry in total), concurrent
acceptances on two relationships against one `mark`, the rate, invitation and inbox bounds and the re-evaluation
of a rate-limited document, concurrent documents of one `mid` and of
one relationship under the lock set, one invitation credential in two
envelopes under two relationships, one of them blocked, and under a
missing and a renewed prelude binding (expected: no open prompt and
the digest in the register, whichever commits first; with neither
relationship blocked, exactly one prompt), the completion record under replay, re-wrap,
equivocation, cache expiry and deletion, the block table row by row,
the register across two relationships and a renewed prelude, and
readiness after an introduction).

### 10.3 Rule coverage

**Vector-checked:** RLTP-MSG-3010 · RLTP-MSG-3020 · RLTP-MSG-3030 ·
RLTP-MSG-3110 · RLTP-MSG-3120 · RLTP-MSG-4010.

**State-dependent** — the verdict needs a tuple and relationship
state, a clock, a cache, a carrier, or an application; the scenario
set of 10.2 is planned to exercise it: RLTP-MSG-2010 · RLTP-MSG-2020 ·
RLTP-MSG-2030 · RLTP-MSG-2040 · RLTP-MSG-3040 · RLTP-MSG-4020 ·
RLTP-MSG-4030 · RLTP-MSG-4040 · RLTP-MSG-4050 · RLTP-MSG-4060 ·
RLTP-MSG-4110 · RLTP-MSG-4115 · RLTP-MSG-4120 · RLTP-MSG-4130 · RLTP-MSG-4140 · RLTP-MSG-4210 ·
RLTP-MSG-4220 · RLTP-MSG-4230 · RLTP-MSG-4240 · RLTP-MSG-4310 · RLTP-MSG-4320 · RLTP-MSG-4330 ·
RLTP-MSG-4340 · RLTP-MSG-4350 · RLTP-MSG-4410 · RLTP-MSG-4420 ·
RLTP-MSG-5010 · RLTP-MSG-5020 · RLTP-MSG-5030 · RLTP-MSG-5110 ·
RLTP-MSG-5120 · RLTP-MSG-6010 · RLTP-MSG-6020 · RLTP-MSG-6030 ·
RLTP-MSG-6110 · RLTP-MSG-6210 · RLTP-MSG-6220 · RLTP-MSG-6240 ·
RLTP-MSG-6310 · RLTP-MSG-6320 · RLTP-MSG-6330 · RLTP-MSG-6410 · RLTP-MSG-6420 ·
RLTP-MSG-6510.

**Interaction and display** — the rule binds what an application
shows or declares: RLTP-MSG-3210 · RLTP-MSG-3220 · RLTP-MSG-4430 ·
RLTP-MSG-6230.

## Appendix A: Companion changes

The block of Section 6, the bounds of 4.2 and the sender's give-up of
5110 touch rules that other documents own. A new document cannot
redefine them; these are the changes their next castings take up. An
implementation that applies this document before them states in its
conformance notes where it departs from the rules named here.

**Delivery Contract (next casting):**

- 4.4: register `message/0.1` (Message Tasks 0.1) with its payload
  schema and proof declaration (3210).
- 6.2: a document arriving on a relationship its receiver has
  blocked is treated at stage 9 as Message Tasks 6.3 states, stages 1
  to 8 unchanged; a terminal document (4.2) is never affected.
- 6.2 and 5a.8: add `failed(rate-limited)` as a disposition that is
  not terminal: nothing committed, no acknowledgement, no cache
  entry, no conclusion toward the carrier, re-evaluated in full on
  the next delivery.
- 6.2 stage 9: the lock set of a `membership-invite` document extends
  by the holder-wide key of its credential digest, acquired with the
  rest of the set as one acquisition (Message Tasks 6330); the lock set of a `message/0.1` document, and of an
  invitation attributed to a relationship, extends by that
  relationship; block changes, chaining, merge and split take the same
  key (Message Tasks 4230, 4240).
- 6.1: a sender failure reason `task-expired` for a document whose
  type declares a lifetime that has run out (Message Tasks 5110); a
  valid acknowledgement arriving later transitions the status as a
  late acknowledgement does.
- 1.1 and 7: a registered type may declare an age bound on a protected
  sender timestamp of its own (Message Tasks 4040, 5110).

**Membership Tasks (next casting):**

- RLTP-MT-3085: the declaration adds "discarded where the inviter's
  relationship is blocked (Message Tasks 6.3)".
- Prelude (1.2): a normative prelude binding. The request travels on a
  tuple, signed under the sender's pair anchor, and carries a binding
  object `{ inviter, genesisDigest, threadId, from, to }` signed under
  the inviter's member anchor, `from` and `to` the document's
  `issuer` and `recipient`, `threadId` the document's; the answering
  holder verifies both signatures and the equality of these fields
  and keeps the binding under `(genesis digest, inviter)` with the
  arrival tuple. A later request under the same key from a tuple of
  the same contact entry replaces the tuple; one from another entry is
  refused, unless the bound tuple is no longer an active head, in
  which case the key is free. The binding moves with its tuple at
  merge, split and chaining (it is per tuple, Trust 6180), and lives
  as long as invitations under it can still be answered (RLTP-MT-3090
  horizon). An invitation is attributed to the relationship of the
  binding's tuple at its arrival; without a binding it is attributed
  to no relationship (Message Tasks 6110); the rate of 4115 counts on
  that relationship.
- 3.1: at most 20 invitations with a new credential digest per
  relationship in 24 hours, beyond that `failed(rate-limited)`
  (Message Tasks 4115).
- RLTP-MT-3095: the surfacing decision of an invitation is made under
  the key of its credential digest, together with the register check
  and the check for an open prompt of that digest; one invitation is
  surfaced at most once (Message Tasks 6330).
- RLTP-MT-3095: an invitation attributed by its prelude binding to a
  blocked relationship has as its defined effect the silent decline
  of RLTP-MT-7020, its credential digest recorded in the holder-wide
  register of declined invitations (Message Tasks 6.4), which every
  later invitation is checked against before surfacing; the
  acknowledgement still says arrival only.

**Trust Layer (next casting):**

- RLTP-TRU-2280: the block joins the chain-level state.
- RLTP-TRU-6220 and 2140 to 2115: a chaining, a merge and a split
  acquire the relationship key of Message Tasks 4240 before they
  commit.
- RLTP-TRU-6425: the display duty of the profile holds subject to the
  block; holding and revisions (6450, 6460) unchanged.
- RLTP-TRU-8380 and 8440: an `introduction-forward` on a blocked
  relationship is the target's silent refusal; an
  `introduction-request` from a blocked relationship, or naming a
  target whose relationship with the mediator is blocked, resolves its
  target as unresolvable, the acknowledgement duty unchanged (8430,
  8650); steps of an act begun before a block continue.

## References

- RLTP Delivery Contract 0.82, `spec/delivery-contract.md`.
- RLTP Trust Layer 0.31, `spec/trust-layer.md`.
- RLTP Membership Tasks 0.20, `spec/membership-tasks.md`.
- RLTP Access Layer 0.57, `spec/access-layer.md`.
- RLTP Encounter Layer 0.31, `spec/encounter-layer.md`.
- RLTP Identity Layer 0.54, `spec/identity-layer.md`.
- Trust Tasks framework, Trust over IP Foundation, DTGWG, version 0.4.
- RFC 2119, RFC 8174 (BCP 14); RFC 3339; RFC 5869 (HKDF); RFC 7748
  (X25519); RFC 8785 (JCS); RFC 2104 (HMAC).
