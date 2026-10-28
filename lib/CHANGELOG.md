# Changelog

## 0.10.1

Takes up the VTI Mediator Adapter Profile 0.30 and the Delivery Contract
0.85.1: a counterpart's refusal is read in `trust-task-error/0.6` and
`0.4` as in 0.5. The registry's libraries write 0.6 since the registry
published it (`extends: "0.5"`, the standard codes
`unsupportedExtension` and `indeterminate`); 0.10.0 read only 0.5, so a
0.6 refusal was logged and acknowledged and the document stayed open
until the horizon. No wire change of this side, so a patch.

- **`readTrustTaskError`** and `readBindingEnvelope` read
  `trust-task-error/0.4`, `0.5` and `0.6` (RLTP-VTI-5015), each with the
  standard codes of its registry schema: `cancelled` in a 0.4 document,
  `unsupportedExtension` or `indeterminate` in a 0.4 or 0.5 document is
  no refusal. Other versions (0.3 and earlier, 0.7 and later) are no
  refusal.
- **`TRUST_TASK_ERROR_TYPES`** (new): the Type URIs read, oldest first.
  `TRUST_TASK_ERROR_TYPE` stays the 0.5 URI.
- **Codes** (RLTP-VTI-5020). `unsupportedExtension` is a terminal
  verdict and joins `ReceiverRefusalCode`. `indeterminate` is never a
  refusal: `readTrustTaskError` reads it as the new verdict `undecided`
  (`retryable`, `retryAfter`); the adapter moves no submission on it,
  with `retryable: true` bounds the next attempt, with `false` makes no
  further attempt in this opening, and carries a bound one in the
  collection beside the unchanged report with the new optional
  `CollectedAnswer.diagnosis` (`{ code: 'indeterminate', retryable }`),
  acknowledged at the conclusion.
- **Hosts.** `ReceiverRefusalCode` and `TrustTaskErrorReading` gain a
  member each: an exhaustive `switch` over either needs a case.
- **Storage.** The stored state accepts the code `unsupportedExtension`
  on a refused outbox step (codec 4, an added enum value; the codec
  stays 4). A state holding this code is not read by 0.10.0, which
  refuses it as `shape`, not as `codec-newer`: once a counterpart has
  sent `unsupportedExtension` with `retryable: false`, a host cannot go
  back to 0.10.0 with that state.
- **Vectors.** `vti-sealed-envelope.json` carries 0.6 answers as
  trust-tasks-rs 0.36.0 sends them (`unsupportedType`, `indeterminate`
  retryable and not, each with its `diagnosis`, `unsupportedExtension`),
  a 0.4 answer, and as no answer a 0.5 document with 0.6 codes, `cancelled`
  in 0.4, and the versions 0.3 and 0.7; `types.errors` replaces
  `types.error`.

## 0.10.0

Takes up the Delivery Contract 0.85, the VTI Mediator Adapter Profile
0.29 and Identity 0.55: every document travels as a Trust Task document
in the registry's TSP binding, one wire identity per relationship and
carrier, and `accepted` carries `held`. A wire break, so a minor version:
a 0.9 adapter reads the carried document as no envelope, a 0.10 adapter
refuses a bare seal as payload, and nothing accepts both forms. It also
takes up Encounter 0.32 (RLTP-ENC-2150, 2155): a reader accepts a
timestamp in the offset spelling `+00:00` beside `Z`.

- **`calOK`** accepts `Z` and `+00:00`, at most three fractional digits
  and at most 29 characters, and still rejects `-00:00`, every other
  offset, a lowercase `t` or `z` and a calendar-invalid date. Every
  reader of the library goes through it: cards, credentials, delivery
  documents, acknowledgements, membership documents, proofs.
- **Schemas.** The timestamp pattern of the Encounter 2.3 schemas
  (contact card, encounter credential, delivery document, access vouch,
  membership invite and prelude request) takes `(Z|\+00:00)$` with
  `maxLength` 29; `schemas.ts` and `wire.ts` regenerated. The Trust
  Layer and Message Tasks schemas keep their own `Z` rules
  (RLTP-TRU-2530, RLTP-MSG-3030).
- **Unchanged.** `iso` writes `Z`; digests and proofs run over the
  received bytes, so a document in the offset spelling has its own
  digest; `tsec` reads both spellings as the same instant.

- **The carried document** (`./adapters/vti-mediator`). Every deposit's
  payload is the JCS of the binding envelope
  `{ type: 'https://trusttasks.org/binding/tsp/0.1/envelope', document }`
  around a `sealed-envelope/0.1` document whose payload is the seal,
  `issuer` this side's and `recipient` the counterpart's connection DID,
  `id` = `threadId` a UUID v8 of SHA-256(`rltp/v1/sealed-envelope-id` ‖
  JCS({issuer, recipient, seal})), `issuedAt` the entry's `since` in whole
  seconds, no proof. New: `wrapSealed`, `sealedEnvelopeId`,
  `readBindingEnvelope`, `readTrustTaskNextStep`,
  `TSP_BINDING_ENVELOPE_TYPE`, `TRUST_TASK_NEXT_STEP_TYPE`,
  `SEALED_ENVELOPE_TYPE` (also from `task-uri`),
  `SEALED_ENVELOPE_DOCUMENT_BOUND` (90 112), `DECLARED.payloadBound`
  (90 182), `BindingReading`.
- **Receipt** (RLTP-VTI-7160). The adapter reads every payload with its
  authenticated sender: a carried document from the sender to this side
  (profile, `threadId` = `id`, canonical ciphertext) becomes an item whose
  bytes are the JCS of the seal, its queue id the digest of the payload;
  everything else is logged through `wire.log` and acknowledged at the
  adapter's next step, never an item.
- **Answers** (RLTP-VTI-5040 to 5060). A counterpart's
  `trust-task-error/0.5` or `trust-task-next-step/0.1` binds the
  submission whose carried document's `id` it names (`inResponseTo.id`,
  else `threadId`), its parties checked against the sender and this side,
  its timestamps any RFC 3339 date-time (nine fractional digits, offsets).
  The adapter applies it: a terminal refusal fails the submission
  (`rejected-by-receiver`), a retryable one bounds its next attempt,
  `idConflict` answers it, a next step (its proof, if any, verified under
  the issuer) makes it `accepted` with `held: true`, which the give-up
  horizon does not end. `SubmissionState` and `deliveryReportOf` carry
  `held`; `TriasReport` `accepted` has `held?: true`. An error document
  with a `proof` is held to it like a next step; an answer to a carried
  acknowledgement changes nothing.
- **Answers across openings** (RLTP-VTI-5065, Delivery RLTP-DEL-6150).
  `pendingTransport(when)` answers `answerable` beside `entries`: the
  accepted documents not yet terminal, `held` marked, with envelope,
  recipient and first submission (`AnswerableEntry`), derived from the
  outbox (the codec is unchanged), refused by `mayHandOver`. `reconcile`
  files them as submissions without an attempt in their state, computes
  their carried document's `id`, and binds a counterpart's answer to
  them; the adapter's horizon does not end them, a later view without
  them withdraws nothing.
- **The answer contract** (RLTP-VTI-5065, 5070, 5080). Every filed
  submission, custody or offered, gets its carried document's `id` when
  it is filed, independent of any attempt; answers wait, unacknowledged,
  until the opening's first `reconcile` (or `submit`) and every id is
  known, then take one path (bind and apply). Only the recipient the
  document named may change it (the sender checked at the transition,
  whatever the wire lets through). A bound answer travels in the
  collection, `Collection.answers: CollectedAnswer[]` (`{ queueId,
  submissionId, report }`): the host records the report at the holder,
  then concludes; the answer is acknowledged only at that conclusion, so
  a crash at any point re-delivers and re-binds it, and the holder's
  report is idempotent. Answers also wait while the wire names no
  counterpart; waiting and bound answers count toward the queue floor by
  number and by bytes (64, 1 MiB).
- **One wire identity.** The connection DID sends and collects;
  `carrierScopedIdentity` has no `egress` scope, `EGRESS_INFO_PREFIX` and
  the adapter's `egressDid` are gone. `deliveryHint` builds the
  three-member hint; `readDeliveryHint(s)` reads three members, or a
  fourth `rltpEgress` ignored, and `DeliveryHintIdentities` is
  `{ connectionDid, carrier }`; `readDeliveryHints(hints, C, {connection})`.
  `depositAddressing(mode, self, peer, C)` takes the connection DID.
- **Mode `direct`** replaces `egress-session` (`SendMode`): the inner
  message alone on the connection DID's session. A restored send state
  with mode `egress-session` (0.9) is read as `direct`; golden fixtures
  `test/adapter-fixtures/ack-state-direct-refused*.json`.
- **`MediatorWire`** (breaking): `deposit(accessToken, bytes, mode)` (no
  egress parameter; `bytes` the binding envelope),
  `onDeliver(cb(bytes, sender))`, `counterpart(): string | null`
  (required), `log?(line)`. `submit()` takes the JCS bytes of a sealed
  envelope and refuses anything else with a `TypeError`.
- **Holder.** `accepted` carries the closed feature `held` (Delivery
  RLTP-DEL-6140). A report `{ status: 'accepted', held: true }` makes a
  document that is not yet terminal accepted and held, once, and
  announces it as `delivery.status` with `held: true`. A held document is
  ended neither by the holder's horizon nor by its sender lifetime
  (RLTP-DEL-6110); only a valid acknowledgement (`delivered`) or a
  `rejected-by-receiver` report (`failed`) ends it. `heldOf(item)`;
  `DeliveryItemView.held`.
- **Codec 4**: codec 3 plus the optional `held` on an accepted outbox
  step and on its `delivery.status` event. A codec-3 state is read
  through `MIGRATIONS[3]`, which sets only the version, so the state of
  0.9.1 loads unchanged. New: `schemas/holder-state-v4.schema.json`,
  `HolderStateV4`, fixtures `state-v4*.json` from
  `test/fixtures/gen-state-v4.mjs`; the codec-3 fixtures are kept as
  written.

## 0.9.1

Takes up the VTI Mediator Adapter Profile 0.28 (RLTP-VTI-3120): a refusal
of direct delivery is a state of the relationship at the carrier, not of
one opening.

- **`MediatorWire.directRefused?(): boolean`** (optional). A wire says
  with it, from the moment the carrier's report arrives, that the carrier
  refused direct delivery on the egress session; the report comes after
  the refused deposit was accepted. The adapter reads it at `advance()`,
  before every hand-over and in `ackState()`. A wire without it can
  still report the refusal as `WireError('direct-refused')` on a later
  deposit in mode `egress-session`.
- **The record.** The adapter records the instant in the send state
  (`SendState.directRefusedAt`) and from then on hands nothing over and
  deposits nothing for the relationship: every submission reads
  `awaiting-transport(carrier-refused-retriable)` and fails at its
  give-up horizon (`expired-by-adapter-policy`). A successor restored from `ackState()` keeps it. Any
  other `refused-retriable` records nothing.
- **Storage.** `SendState` gains the optional `directRefusedAt`; a
  missing field is "not refused". The restore check stays fail-closed: the
  field only in `egress-session`, a finite instant not after `restoredAt`.
  The holder-state codec is untouched (3). Golden fixture
  `test/adapter-fixtures/ack-state-direct-refused.json`.
- **License.** The library is licensed under the Apache License 2.0
  instead of CC BY 4.0. Versions up to 0.9.0 keep CC BY 4.0.

## 0.9.0

Takes up the Delivery Contract 0.84, Membership Tasks 0.21, Access 0.58,
Message Tasks 0.2 and the VTI Mediator Adapter Profile 0.27: every
Trust Task type is named under `https://real-life.org/trust-tasks/spec/`
(Delivery RLTP-DEL-3010). A wire break, so a minor version: a document
this version sends is unknown to a 0.8 holder, and a document under the
earlier names fails the document profile here (`failed(malformed)` at
stage 5). Nothing accepts both forms.

- **Type URIs.** `ACK_TYPE`, `PROFILE_TYPE`, `MESSAGE_TYPE`,
  `STAR_TYPE`, `GROUP_STAR_TYPE`, `ANCHOR_MAPPING_TYPE`,
  `CONTINUITY_PROBE_TYPE`, `CONTINUITY_MAPPING_TYPE`, the encounter,
  membership and introduction types, the library's own `x-` forms and
  `CARRIER_ROLE_URI` carry the `/spec/` segment; every module builds them
  from one prefix (`task-uri`).
- **Schemas.** The bundled schemas (`SCHEMAS`, the generated `wire`
  types) follow `schemas/`: the document profile's `type` pattern takes
  the slug grammar of the framework under `/spec/` and excludes the
  reserved slugs; the payload schemas' `$id`s are the new Type URIs.
- **Refusal codes.** `ReceiverRefusalCode` takes the terminal codes of
  `trust-task-error/0.5`: `unsupportedVersion`, `permissionDenied`,
  `cancelled` and `taskFailed` join the six (profile RLTP-VTI-5020). The
  stored state accepts them (codec 3, an added enum value).
- **Storage.** The codec stays 3 and nothing migrates. A state written by
  0.8 names its types in the earlier form; `decodeState` refuses it as
  `codec-type-uri` (a new `StateCodecErrorCode`), fail-closed, so no 0.9
  holder opens it or sends its documents on. The app discards it. Only
  the places that hold a document's type are read (outbox items, a
  received or issued invitation, the invite and accept of buffered
  evidence), never text a person wrote.
- **Counterpart refusals** (profile RLTP-VTI-5010 to 5030), in
  `./adapters/vti-mediator`: `readTrustTaskError(doc)` reads a
  `trust-task-error/0.5` document by its form, totally (null for anything
  else), into a verdict: refused with its code (an extended code and a
  retryable code marked not retryable as `taskFailed`), retry with its
  `retryAfter`, answered (`idConflict`), or none (`expired`).
  `receiverRetry(id, retryAfter)` takes a retry: no port transition, and
  no attempt of the submission before `retryAfter`, within this adapter
  instance; the give-up horizon still ends it. `retryAfter` is read as
  RFC 3339 allows it (either case of `T` and `Z`, a leap second, any
  offset), and `message` is bounded at 1024 code points, as the registry
  schema's `maxLength` counts. `TRUST_TASK_ERROR_TYPE` names the read
  type.

## 0.8.0

Takes up the VTI Mediator Adapter Profile 0.25 (§1b, the delivery hint)
and Encounter 0.31.1: a card carries the hints by which its side is
reachable in the relationship the card opens. A minor version: the
public API grows (`CarrierOffer`, a new `ActError` member, new
`RelationshipView` fields, three adapter exports); the storage format
does not change.

- **The carrier offer** of `show` and `scan`: `carrier: {nonce,
  deliveryHints}` (new type `CarrierOffer`). `nonce` is the
  relationship's carrier nonce N, 32 bytes the app draws fresh (Identity
  §7a.3); `deliveryHints` are the hints the app built from the wire
  identities its adapter derives from N. The displayed card (`show`) or
  the scanner's sent card (`scan`) carries the hints under its proof.
  The library interprets no hint. The offer is act input: bound and
  journaled with the act, so a repeat under the same actId answers the
  same card and another offer under it is `actid-conflict`.
- **N in the register** (`register.carriers`, generation 1) under the
  relationship the card opens: at `show` already, as the card's pair
  label enters the register before display (Encounter 4110); a card that
  ages unscanned leaves its entry, as it leaves its label. At `scan`
  under the scanner's fresh relationship. The storage format is
  unchanged (codec 3).
- **Refusals**: more than eight hints or a hint over 512 characters
  (Encounter RLTP-ENC-6090) is `card-invalid` with `ref`
  `RLTP-ENC-6090`; an offer without a hint, or with a hint that is no
  string, is `card-invalid` without a `ref` (an empty offer announces
  nothing; a card without hints needs no offer, 6080); a nonce that is not 32 bytes in canonical base64url,
  or that the register already holds as a carrier or pair nonce, is the
  new code `carrier-nonce-invalid`. Nothing commits on a refusal.
- **The view**: each `RelationshipView` names the relationship's
  canonical carrier-nonce entry (`carrierNonce: {nonce, generation}`) and
  the counterpart's hints from the card of the enactment that opened it
  (`counterpartDeliveryHints`), as signed. A re-encounter chained into
  the relationship changes neither (profile RLTP-VTI-1230). Without an
  offer both are absent.
- `cardBody` takes `deliveryHints`.
- **The adapter builds and reads the hint** (`./adapters/vti-mediator`,
  below the port line): `deliveryHint(rootIkm, C, N)` derives this
  side's connection DID and egress identity from (root, `C`, `N`), as
  the factory derives the instance's trio (derived, not supplied), and
  gives its hint (RLTP-VTI-1210: the JCS form of the `TSPTransport`
  entry);
  `readDeliveryHint(hint, C)` reads one hint strictly (1210, 1220: JSON,
  byte-equal to its JCS form, exactly the four members, both identities
  canonical Ed25519 `did:key` that decode to `0xed01` and 32 bytes,
  `serviceEndpoint` = `C`) into `{connectionDid, egressDid, carrier}` or null;
  `readDeliveryHints(hints, C, self)` reads a card's list as the side
  `self` (its own connection DID and egress identity): a hint naming one
  of them is ignored (RLTP-VTI-1227), then exactly one hint for `C`
  (1225), else null. Both readers are total (RLTP-VTI-1220): any input
  answers null or the complete identities, nothing throws — a hint that
  parses but has no JCS form (a lone surrogate) included; tested over the
  vector's corpus and 20 000 seeded mutations. The app passes the
  identities to the wire (`peerDid`, `peerEgressDid` of the binding),
  which refuses a counterpart identity that is one of its own.
- **No change of N.** The library offers no rotation of a carrier nonce
  (Identity §7a.3, `generation + 1`) and no replacement after loss:
  `register.carriers` is written once per relationship, at `show` or
  `scan`. The profile carries none either (RLTP-VTI-1245). With one
  writer of the register per holder, as in this library, `carrierNonce`
  is the `N` whose identities the counterpart saw; two devices writing a
  first `N` apart would make that untrue (profile Open Issue 13). A
  relationship chained into another is no `RelationshipView` of its own
  (only an id in `chainedFrom`) and shows no `carrierNonce`: the app
  closes the adapter instance of a relationship once its id appears in
  another relationship's `chainedFrom` (RLTP-VTI-1230).

## 0.7.0

Takes up the VTI Mediator Adapter Profile 0.24: the sending form of §3a.

- **Two sending modes** (RLTP-VTI-3110 to 3140): `SendMode` is
  `'routed' | 'egress-session'`. Every adapter instance starts in
  `routed`; `MediatorWire.deposit(accessToken, bytes, egressDid, mode)`
  now receives the mode of each deposit, read at the hand-over, so an
  attempt begun before a switch ends in the mode it began in. A wire may
  offer `queueEmpty()` (true when the mediator holds nothing more for
  the connection). Closed: a wire without it never completes a
  collection, and the adapter over it never switches. The consumer a
  wire registers with `onDeliver` now answers a boolean: whether the
  adapter took the frame (buffered, already held, or absorbed); `false`
  (above `max-queue-bytes`, or a retired instance) leaves the frame with
  the mediator, and a wire does not take its queue for drained until the
  frame is offered again.
- **The send state** (RLTP-VTI-3130), per relationship: the mode and the
  **open routed deposits** (`SendState.open`, each with digest and
  acceptance instant): every document (an entry of kind `document` filed
  by `reconcile`) accepted in `routed` and not yet answered.
  Acknowledgements are no open deposits, so a side that only
  acknowledges never switches by the deadline (profile Open Issue 9). A
  document's acceptance instant is the adapter clock (the last port
  instant) when its deposit resolved; without a port call in between it
  is the hand-over instant. The send state travels in `AckState.send`
  (new type `SendState`); a restore checks it fail-closed: exactly `mode`
  and `open`, a known mode, each entry exactly digest and acceptance
  instant, finite and not after the restore instant, each digest once,
  nothing open in `egress-session` — any other field is refused, not
  ignored. A snapshot without it starts in `routed`. `sendMode` reads the
  current mode. A `submit()` without a digest opens nothing. An open
  deposit falls `routedAckDeadlineMs` plus `duplicateWindowMs` after its
  acceptance, also where no switch check runs; a restore cuts such
  entries instead of refusing them. A routed attempt accepted after the
  switch enters nothing.
- **Absorption for the give-up horizon** (profile §2, §4): the adapter
  absorbs a byte-identical copy of a concluded item only within
  `give-up-horizon` of its conclusion (or while an acknowledgement for it
  is on the wire); a later copy is a new item for the holder, whose
  absorption answers it with the stored acknowledgement (RLTP-DEL-6330,
  6335); its new conclusion sets the conclusion instant anew. Buffered
  and outstanding go before concluded, so a redelivery of such a copy is
  ignored while the holder has it. The entry and its ack intent stand for
  the duplicate window; while such a later copy waits in the buffer or is outstanding,
  the standing intent is not sent, so it never deletes the copy before
  the holder concluded it (hand off → await → ack).
- **"Nothing pending" is the binding's statement** (RLTP-VTI-7150):
  `queueEmpty()` true; without it, no switch.
- **Answers and switch**: `acknowledged(id)`, `receiverRefused(id, code)`
  and the new `answered(digest, now)` (an answer the holder hands a later
  instance: a valid acknowledgement, a validated refusal or a validated
  `idConflict`) answer the open deposit of that document's digest; a
  verdict that outruns the acceptance (`answered` included) keeps the
  document from being opened. An open acknowledgement is answered by nothing. Each answer
  settles its own deposit only. `advance` switches one way to
  `egress-session` when an open routed deposit was accepted
  `DECLARED.routedAckDeadlineMs` (72 h, equal to the give-up horizon) or
  more ago, checked only after the instance concluded a collection that
  left nothing pending (an empty collection counts; `queueEmpty()` true,
  nothing buffered or outstanding) and only while nothing is pending
  again at the check, so an acknowledgement that arrived since is
  collected and reported first. A deposit the wire refuses with the new
  `WireError` kind `'routed-refused'` (a validated refusal of the routed
  form) switches at once; the submission stays
  `awaiting-transport(carrier-refused-retriable)` and goes in
  `egress-session` at its next hand-over. This holds for an attempt the
  holder withdrew while it ran as well: the refusal is evidence about the
  mediator, not about the document. At the switch the open deposits
  leave; nothing returns to `routed`. An accepted submission is never
  deposited again; one still in the holder's custody goes in the new mode
  at its next hand-over (RLTP-VTI-3135, 7130).
- **What the host owes**: the reports a collection carries are applied
  before its `conclude`, at the latest before the next `advance`, since
  the switch check counts them as applied. A host that persists only
  `concluded` and `pending` starts every opening in `routed` with nothing
  open, so a relationship whose openings last less than 72 hours never
  switches by the deadline; the mode in a restored snapshot is as
  trustworthy as the host's store.
- **`depositAddressing(mode, self, peerConnection, carrier)`**: the
  addressing of both layers and the session per mode, as
  `vectors/vti-routed-addressing.json` states it (RLTP-VTI-1110, 1120,
  3110, 3115, 3120); the wire binding packs from it.
- **The app's transport contract**, stated and tested (it held before):
  after a withdrawal by `reconcile` the adapter starts no deposit for that
  submission, and an outcome that resolves late changes nothing, the send
  state included, except a validated refusal of the routed form, which
  switches; a wire call already running cannot be recalled and may
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
