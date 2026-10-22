# Changelog

## 0.7.0

Takes up the VTI Mediator Adapter Profile 0.24: the sending form of §3a.

- **Two sending modes** (RLTP-VTI-3110 to 3140): `SendMode` is
  `'routed' | 'egress-session'`. Every adapter instance starts in
  `routed`; `MediatorWire.deposit(accessToken, bytes, egressDid, mode)`
  now receives the mode of each deposit, read at the hand-over, so an
  attempt begun before a switch ends in the mode it began in. A wire may
  offer `queueEmpty()` (true when the mediator holds nothing more for
  the connection). Closed: a wire without it never completes a
  collection, and the adapter over it never switches.
- **The send state** (RLTP-VTI-3130), per relationship: the mode, the
  instant a document (an entry of kind `document`, or a `submit()`
  without an entry; never an acknowledgement, which goes through
  `reconcile`) was first accepted in
  `routed`, the digests of the documents accepted in `routed` and not yet
  answered (with acceptance and the end of their give-up horizon), and
  whether `routed` is proven. It travels in `AckState.send` (new type
  `SendState`); a restore checks it fail-closed (a known mode, finite
  instants, none after the restore instant, no digest twice, each
  horizon within the give-up horizon after its acceptance, and routed
  digests only with a first acceptance at or before them) and a snapshot
  without it starts in `routed`. `sendMode` reads the current mode.
- **Proof and switch**: `acknowledged(id)` and `receiverRefused(id, code)`
  for a document deposited in `routed` prove `routed`; the new
  `answered(digest, now)` carries an answer the holder hands a later
  instance (a valid acknowledgement, a validated refusal or a validated
  `idConflict`) and proves `routed` when the send state names the digest.
  `advance` switches one way to `egress-session` when `routed` is not
  proven and the first acceptance lies `DECLARED.routedAckDeadlineMs`
  (24 h) or more in the past, checked only after the instance concluded
  a collection that left nothing pending (an empty collection counts;
  `queueEmpty()` true, nothing buffered or outstanding) and only while
  nothing is pending again at the check, so an acknowledgement that
  arrived since is collected and reported first. Such a conclusion also
  drops the routed digests past their give-up horizon. A digest once
  answered never enters the send state again.
  An accepted submission is never deposited again; one still in the
  holder's custody goes in the new mode at its next hand-over
  (RLTP-VTI-3135, 7130).
- **What the host owes**: the reports a collection carries are applied
  before its `conclude`, at the latest before the next `advance`, since
  the switch check counts them as applied. A host that persists only
  `concluded` and `pending` starts every opening in `routed` with no
  first acceptance, so a relationship whose openings last less than
  24 hours never switches; `mode` and `proven` in a restored snapshot are
  as trustworthy as the host's store. A verdict proves `routed` only for a
  document the send state names (or, for a `submit()` without a digest,
  one accepted in `routed` and within its give-up horizon); a verdict
  before the acceptance proves at an acceptance in `routed`.
- **`depositAddressing(mode, self, peerConnection, carrier)`**: the
  addressing of both layers and the session per mode, as
  `vectors/vti-routed-addressing.json` states it (RLTP-VTI-1110, 1120,
  3110, 3115, 3120); the wire binding packs from it.
- **The app's transport contract**, stated and tested (it held before):
  after a withdrawal by `reconcile` the adapter starts no deposit for that
  submission, and an outcome that resolves late changes nothing, the send
  state included; a wire call already running cannot be recalled and may
  still land at the mediator (profile §6), and the copy that arrives is a
  duplicate the receiver absorbs (Delivery §6.2). Every deposit is a
  submission with an id of its own, a duplicate's answer included; the
  report handed to the holder carries the digest, and the app pairs it
  with its deposit through the submission id it polls.
- Breaking for wire implementations: `deposit` takes the mode as its
  fourth argument. `AckState` gains the optional `send`.

## 0.6.1

One actId, one result.

- **`replay(actId, when)`**: the journaled result of a human act without
  the act — `{ok: true, result: {actId, commitSeq, at, events, outbound}}`,
  each document of the act with `live` (whether a repeat at `when` would
  hand it out), or `{ok: false, code: 'unknown-act'}` (`actid-missing` for
  an empty id). For `sendMessage` the `message.sent` event carries the
  `mid` and the `digest`; `at` is the commit time the message's `sentAt`
  was taken from. A pure read in the holder's queue: nothing runs, nothing
  is given up, nothing commits, lastWhen included; no key is used, so it
  answers on an opening whose keys are locked. New types `ReplayResult`,
  `ActReplay`, `ReplayOutbound`.
- **The rule, stated and tested** (it held before; the engine takes one
  path for every human act, and the tests cover `sendMessage`, `show`,
  `scan`, `setProfile`, `foundGroup`, `block`, `unblock` and `trust`): a repeat under a journaled actId answers the
  journaled events — for `sendMessage` the same `mid` — whatever the clock
  says (ahead, set back), across `close()` and a new opening, with keys
  that answer nothing, and after a commit whose outcome was unknown; it
  never mints a second `mid`. Another input under the same actId stays
  `actid-conflict`.
- **The journal keeps an act as long as its documents' completion**: the
  retention max(P90D, the retry horizon) now runs from the act's commit
  and from the last step of each of its documents (delivered or failed),
  whichever is later; a document not yet terminal keeps the act. Before,
  it ran from the commit alone, so an act delivered late left the journal
  while its delivery status stayed. The bound is in holder time and of
  time, not of count: one entry per human act, removed by the tick that is
  due. A clock set ahead by more than the retention ends it early in real time; `replay` then answers `unknown-act`, and
  a repeat under that actId would be a new act. An app asks `replay`
  instead of repeating an act blind.
- **Fixes**: a tick that drops journal entries keeps an entry whose actId
  is `__proto__` as an own member (it set the prototype of the kept
  journal, and the commit failed the codec); the settling after an
  `unknown-commit-outcome` counts the act as landed only when the journal
  holds it with the same events, not another opening's commit of the same
  actId at the same commitSeq; an act that issues documents names in
  `nextDueAt` each one's first retry or send deadline, whichever comes
  first (a repeat names its live documents' the same way), so a holder
  whose timer had run out reaches the retries, the give-up and the
  journal's end on the timers alone. An act without documents names no
  journal deadline; the next `resume` names its entry's end, a `tick`
  does not.
- The state and codec 3 are unchanged: the journal was already part of the
  stored state.

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
- **Codec 3, a clean cut**: `StoredAck.sentBy` is `accepted | failed |
  horizon`, present exactly when sent, `held` only while unsent, and the
  answers (`answers`, `answerDue`). Codec 3 replaces codecs 1 and 2
  without a migration: neither ever held a rolled-out app's state, so a
  state of either is refused as `codec-unknown`. Removed: the migrations
  1 → 2 and 2 → 3 (`MIGRATIONS` is empty), the codec-1 and codec-2
  validators, `schemas/holder-state-v1.schema.json`,
  `schemas/holder-state-v2.schema.json`, the types `HolderStateV1` and
  `HolderStateV2`, and their fixtures and generators. New:
  `schemas/holder-state-v3.schema.json`, `HolderStateV3`, fixtures
  `state-v3*.json` (generated, reproduced in `npm test`).
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
