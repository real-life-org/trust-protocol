# Changelog

## 0.6.0

Takes up Delivery Contract 0.83: the holder keeps custody of what waits
for transport, and only an open, resumed opening hands anything over.

- **Custody** (RLTP-DEL-6120 to 6135): `pendingTransport(when)` names
  what the holder keeps for transport, after this opening's first
  completed resume (else `{ok: false, code: 'not-resumed'}`): every
  outbox document neither terminal nor accepted, the ones the adapter
  reported `awaiting-transport` included, and every unsent ack, each with
  its envelope, recipient, `since` (first submission), `notAfter` (the
  horizon or the type's sender lifetime, whichever first), `held` and
  `nextAttemptAt`; none past its deadline, whether or not a resume has
  recorded the give-up. Entries are deep-frozen and issued to the
  opening. `handOver(entry, when, start)` re-reads the store and, for an
  entry this opening issued that is still pending, unchanged and before
  its deadline, calls `start` inside the holder's queue: the check and the
  start of the deposit are one step. `mayHandOver(entry, when)` is the
  check alone, and authorizes nothing afterwards. Both read at
  max(when, lastWhen): the holder's time never runs back. A resume that throws, the settling of an earlier commit
  included, withdraws the opening's authority until one completes. One
  opening per store at a time is the app's to keep: two openings are not
  serialized with each other.
- **A duplicate's answer** (RLTP-DEL-6330): a duplicate makes an answer
  due, stored with the ack (`answers`, `answerDue`) and so kept across a
  lock; `pendingTransport` offers it as a `resend` entry numbered by it,
  beside the ack's retries and independent of their state, with the
  effect's retention as deadline. The begun hand-over ends it (a commit);
  a duplicate arriving while one is due is answered by it (the same
  bytes), the next one after it makes the next due. A duplicate therefore
  commits that answer (else, as before, lastWhen only).
- **The opening ends**: `await close()` (a lock, the end of a process),
  resolved once the operation running at the call has finished; only then
  may the next opening start. Every
  later call rejects with `InfraError('closed')` (a new code),
  `mayHandOver` answers false, `closed` says so. The next opening is a new
  `createHolder` over the same store.
- **Acks** (RLTP-DEL-6330, 6335): an `awaiting-transport` report on an
  ack no longer marks it sent; it records `held`, resume stops re-offering
  it and `pendingTransport` keeps it. `accepted` or `delivered` marks it
  sent (`sentBy: 'accepted'`), `failed` gives it up (`'failed'`), the
  horizon ends its retries (`'horizon'`). Sent or not, it stays with its
  effect until the effect's retention; a duplicate re-sends it once
  without new retries.
- **Codec 3**: `StoredAck.sentBy` is `accepted | failed | horizon`, present
  exactly when sent, and `held` only while unsent. The migration from
  codec 2 makes every ack sent by a report (`sentBy: 'report'`, which
  codec 2 also wrote for `awaiting-transport`) unsent again, due at once:
  codec 2 cannot tell an ack a service took from one an adapter held, so
  some acks go out twice and their receivers absorb the duplicate.
  `schemas/holder-state-v3.schema.json`, `HolderStateV3`, fixtures
  `state-v3*.json` (generated) and `state-v2-acks.json` (lib 0.5.0,
  frozen) with a migration test; the codec-2 fixtures are frozen.
- **`./adapters/vti-mediator`**: `reconcile(view, gate, now)` replaces
  `submitOutbound`. It files the entries of the view not yet filed and
  withdraws every submission before the trias whose digest the view no
  longer names; each deposit starts inside `gate.handOver` (the holder),
  after the adapter's own re-check (retired, withdrawn, past the trias,
  past the entry's deadline or its horizon): the holder's no withdraws,
  an error skips the attempt. Its give-up horizon counts from the entry's
  `since`; an entry taken over past it is given up at once, never
  attempted. A `resend` entry is a submission of its own. One adapter
  serves one opening: bound to the holder of its first reconcile, it
  refuses another, and the next opening gets a new adapter. It keeps no
  custody of its own.
- Tests: the custody scenarios (`test/transport-custody.test.mjs`, among
  them the open counter-probes of the store-launch reviews) and seeded
  interleavings of locks, the end of a process, hand-overs and acks with
  every cell reached (`test/transport-interleavings.test.mjs`).

## 0.5.0

Takes up Message Tasks 0.1, Delivery Contract 0.82 and Membership Tasks
0.20.

- **Messages** (Message Tasks 0.1): `sendMessage(contactId, text,
  {when, actId, replyTo?})` sends a `message@1` on a ready, unblocked
  relationship (refused as `not-ready`, `blocked` or `message-invalid`;
  event `message.sent` with the mid and the document digest). Reception
  runs the stages of Delivery 6.2: the MAC under `k_msg`, the age bound
  (`failed(stale-issuance)`) and the future bound on the holder's time
  mark, the completion record per tuple (no new effect for a known body,
  equivocation refused), the inbox entry committed with the cache entry
  and the acknowledgement. `inbox()` lists the messages not yet taken
  over, in display order; `takeMessages(ids, {when})` takes them over.
  `ContactView.canMessage`. The pure forms (`messageKeyOf`,
  `messageMac`, `messageProblem`, `MESSAGE_TYPE`, …) are exported from the
  root.
- **The block** (Message Tasks 6): `block(contactId)` and
  `unblock(contactId)`, chain-level state of every relationship of the
  entry, kept through chaining, merge and split; event `contact.blocked`,
  `ContactView.blocked`. Under a block messages are discarded and
  invitations declined into the register of declined invitations,
  silently and acknowledged; the holder's own messages, invitations and
  introduction acts toward a blocked relationship are refused. The
  treatment of the Trust Layer's types waits for that layer's next
  casting.
- **Invitations** (Membership Tasks 0.20 §3.1): attributed to the
  relationship of their prelude binding, or to none; at most 20 new
  credential digests per relationship and day; one surfacing per
  credential digest, decided with the register and the permanent record
  of surfaced invitations.
- **The prelude** (Membership §3.5): the registered types
  `membership-prelude-request/0.1` and `membership-prelude-reply/0.1` with
  the binding `membership-inviter@1`, kept per relationship for its life;
  genesis digests compared by their bytes. **Breaking:** a holder of 0.4.0
  sends `x-membership-prelude-*`, which 0.5.0 refuses as `unknown-type`.
- The inviter admits without a human act only before
  `validUntil + membership-skew + P90D` (Membership 3282).
- **Delivery 0.82**: the transient disposition `failed(rate-limited)`
  (nothing committed, no ack, no cache entry, evaluated afresh when
  delivered again); an outbound may carry its type's sender lifetime,
  after which resume moves it to `failed(task-expired)` and never hands it
  out again — for a message `sentAt + P179D`, after any retry horizon
  (at most P90D), so an undelivered message fails as
  `failed(expired-by-adapter-policy)` first.
- `./adapters/vti-mediator`: `conclude(collection, now, {keep})` leaves
  transient items unconcluded and offers them again; `concludable(result)`.
- **State codec 2**, with a pure migration from codec 1 (no block, no
  rate, no record, no inbox; the ready tuples read from the state; every
  received invitation counted as surfaced), its non-normative schema
  `schemas/holder-state-v2.schema.json` and the type `HolderStateV2`, and
  golden fixtures reproduced in `npm test`. The codec 1 fixtures are
  frozen as 0.4.0 wrote them and migrated in the tests.
- Closed unions grown: `ActError` (`blocked`, `not-ready`,
  `message-invalid`), `ReceiveFailure` (`rate-limited`), `HolderEvent`
  (`contact.blocked`, `message.sent`, `message.received`), the outbox's
  failure reasons (`task-expired`), the entropy purposes (`message.mid`).
- Engine (for modules): `keepKeys(state, when)` gets the tick's time; the
  module hook `accepted` runs in the stage-9 transaction of every unique
  document.
- Tests: the scenario set of Message Tasks §10.2, the race of #103 on two
  engines over one store, and a seeded interleaving generator over
  messages, the block, take-over and the record's retention.

## 0.4.0

- `createHolder`: one person's device state behind typed human acts
  (`{when, actId}`, journaled), `receive`, `report`, `resume` and `tick`,
  with the views `contacts`, `contact`, `groups`, `profile`, `prompts`,
  `deliveryStatus` and `subscribe`. Results are a closed union with rule
  references; events are a closed union, issued after the commit.
- Ports: `Store` (compare-and-swap), `KeyProvider` (`seedKeys` by default),
  `Entropy` by closed purpose, `Log`, `Access`, `RetryPolicy`,
  `DeliveryReport`, pure-JSON `Outbound`. `storeContract` is the suite a
  Store adapter passes.
- Modules on the holder: identity (the register, device names, the
  community anchor's rotation over the Log port), trust (the trust act and
  the classes, the anchor mapping, the star and the group star, merge,
  split and departure, continuity, `profile@1`, the duties), encounter
  (`encounter-scan@0.25` with both paths), membership (founding, prelude,
  invite, admission, welcome, `vouch@2`) and introduction (Trust §8, three
  roles).
- Delivery: stages 1–9 once per envelope through a task register, the
  completed-effect cache with stored acks, the outbox with the status
  trias, retry by backoff, give-up at the horizon.
- State codec 1 with golden fixtures (`test/fixtures/`) and a
  non-normative JSON Schema (`schemas/holder-state-v1.schema.json`) with
  the generated type `HolderStateV1`; a newer codec is `codec-newer`, a
  codec without a validator `codec-unknown`.
- Entry points: the root, `./testing`, `./internal`,
  `./adapters/vti-mediator`. `visibility` and `ceremony` carry pure wire
  builders and verifiers only. There is no `./probe` entry point.
- Invariant predicates over every commit (`invariants: true`) and a
  generator over random sequences of acts on two and three holders.
