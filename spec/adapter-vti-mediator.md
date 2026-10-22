# RLTP Transport Adapter Profile: VTI Mediator

**Real Life Trust Protocol — Transport Adapter Profile (below the port line)**

- **Status:** Editor's Draft
- **Version:** 0.24.0-draft (twenty-fourth casting)
- **Status of This Document:** Editor's Draft, not yet converged.
  This profile changes normatively between castings and MUST NOT be
  relied upon for implementation or interoperability claims. Review
  and comment are welcome through the editors.
- **Editors:** Anton Tranelis
- **Companions:** RLTP Delivery Contract 0.83 (§5a.10, §6.1, §6.2,
  RLTP-DEL-6120 to RLTP-DEL-6135; Appendix A names the changes its
  next casting takes up); RLTP Identity 0.54 (§7a, §13)

Target carrier: the VTI/Affinidi messaging mediator as released in
**VTI-Dogwood** (pins: `vti-didcomm-js` @ `1d110bf`,
`verifiable-trust-infrastructure` @ `e0f700b7`; protocol texts:
Coordinate Mediation 2.0 @ `d5909369`, Message Pickup 3.0 @
`9dfa409f`, TSP @ `ea01152` — `sources/pins/PINS.md`; TSP Rev 3 is
tracked and the wire binding targets its cipher suite posture, see
§7). Seam evidence:
`design/mediator-naht-bestandsaufnahme-2026-08.md`.

## 0. What this contract is, and is not

The mediator is a **foreign carrier**: it keeps its own contract
(mediation, pickup, delete-to-ack) and has never given the RLTP
port's promises — no proof-gated registration, no generations or
tombstones, no published constants, no wind-up. TSP Rev 3 says the
same of intermediaries in its own name: *"TSP provides no delivery
guarantee, and an intermediary that declines to relay a message
cannot be distinguished by the sender from one that has not yet
delivered it."*

This profile therefore does **not** present the §4.4/§5a carrier
port. It presents the **transport contract**: everything a holder
can rely on when its counterpart is reached through a carrier that
answers to its own protocol. Where a holder needs the full port,
the full port exists — the `Carrier` machine of this library — and
a service that fronts it to real tenants is a different profile
with real observers.

What this adapter owes, completely:

1. the **§6.1 sender contract** — the status trias, the closed
   pre-transport reports, the declared give-up, late-ack
   transitions, and the receiver refusal channel;
2. a **duplicate absorption** that composes with the receiver's
   §6.2 rule and never replaces it;
3. the **§5a.10 identity obligations** in full, under the reading
   of §1a (which layer of a deposit the sending-side prohibitions
   apply to).

What it expressly does not owe, and no holder may read into it:
proof-bound registration, generation ordering, tombstone
consumption, orphan wind-up, published carrier constants beyond
those declared below. Those guarantees are obtainable only from an
RLTP carrier; a holder that requires them must not settle for a
foreign one.

## 1. Identities (§5a.10)

- `C` is the **mediator's DID**, exactly as configured (Identity
  §7a.2 — never a hop beyond it, never the URL it resolves to).
- The control principal (`carrierPrincipal(rootIkm, C, nonce)`)
  **never touches the wire.** Beside it the adapter derives, from
  the same root under the normative prefixes
  `rltp/v1/carrier-connection/ed25519/v1/` and
  `rltp/v1/carrier-egress/ed25519/v1/` (Identity §13 lists both),
  two wire identities, one per relationship × carrier each:
  - the **connection DID** — this side's account at the mediator
    and its address in the relationship: all mediator protocol
    traffic (auth, keylist, pickup, receipts) runs under it, the
    counterpart addresses every document to it, and it is the
    **outer** sender of every deposit in mode `routed` (§3a);
  - the **egress identity** — the **inner**, end-to-end sender of
    every deposit: the sender the counterpart sees and verifies,
    §5a.10's sender-side identifier under the reading of §1a. In
    mode `routed` it never authenticates to the mediator; in the
    fallback mode `egress-session` it holds one send-only session
    of its own (§3a).

  Each is derivable from the root; none from any other. **The trio
  is derived by the adapter's factory itself** from one (root,
  `C`, `N`) — caller-supplied identities are refused at the door,
  so a mixed trio (identities from two relationships) cannot be
  built at all.
- Both wire identities carry §5a.10's three prohibitions — **not
  well-known**, **not person-wide**, **not reused outside this
  relationship** — and are retired with the principal, never
  reassigned. `from_prior` is **forbidden**; a new connection DID
  is a fresh mediation relationship, never a rotation statement.
- One mediation relationship per principal; keylists
  principal-local; every status, pickup and receipt operation
  scoped to one principal's connection; Live Mode per relationship
  (MUST), one socket per principal by default (5a.7 spacing
  declares any multiplexing). Mode `routed` holds **one session
  per relationship and side**, the connection DID's; mode
  `egress-session` adds the egress identity's send-only session.

## 1a. Which layer counts (§5a.10, read for routed deposits)

A routed deposit carries two senders: the inner one the counterpart
verifies, and the outer one the direct carrier authenticates. Delivery
§5a.10 attaches its sending-side prohibitions to "the sender-side
outer VID an adapter presents when depositing", among them that the
sending side and the collecting side of one person must never meet
in one identifier. That clause protects what a counterpart can join:
the identifier a document arrives under against the identifier the
same person collects under. This profile applies it to the layer the
counterpart sees.

**RLTP-VTI-1110** — The inner sender of every deposit MUST be the
egress identity of this relationship and carrier. It MUST NOT be the
connection DID, the control principal, or a value derivable from
either, and it carries all three prohibitions of §5a.10.

**RLTP-VTI-1120** — The outer sender of a routed deposit MUST be the
connection DID of the same relationship and carrier, and nothing
else. It is a hop identifier toward the direct carrier, which already
authenticates it as this relationship's account; it carries the
prohibitions of §5a.10 except the separation of sending and
collecting, which RLTP-VTI-1110 places on the inner sender.

**RLTP-VTI-1130** — A deposit whose only layer names the connection
DID as its sender is nonconformant: there the counterpart would see
the collecting identifier as the sender.

Delivery 0.83 hangs the separation on the outer sender. The change
this reading needs in the Delivery Contract is stated in Appendix A;
until its next casting takes it up, an implementation of this
profile states in its conformance notes that it applies RLTP-VTI-1110
and 1120 in place of that clause. The sentence of §5a.10 that a
nested private end-to-end VID is "hidden from intermediaries by
construction" is not a property of routed mode: the mediator opens
the routing layer and reads the inner sender (§9).

## 2. Declared constants (decision g1-a, revised under Option B)

Six constants with transport meaning, every one enforced in the
implementation. They are promises of **this casting**: a revision
is a new casting of profile and code together — there is no
runtime revision machinery, and this profile claims none:

| Constant | Value | Enforced by |
|---|---|---|
| `give-up-horizon` | 72 h | every submission not confirmed delivered — `accepted` included — fails at the horizon; `unroutable` only for the persistent admission-refusal class — never overload, never an outcome in flight, and never over a standing offline signal (the give-up verdict applies the same precedence as every observation) |
| `status-horizon` | 60 s | `submit` returns synchronously. The pre-transport report is an **honest snapshot, derived at each observation** by one precedence order — (a) the wire knows itself offline → `offline`; (b) an attempt is overdue past the horizon → `transport-unreachable`; (c) otherwise the last completed attempt's report; (d) otherwise honestly **no report yet** (absence answered as null, never a fourth value beside §6.1's closed set). One order, every observation point — no stored patchwork, no cell a connectivity change can leave silent. No attempt is ever started against a knowingly offline wire |
| `queue-floor` | 64 envelopes **and** 1 MiB | below both bounds an inbound frame is always buffered |
| `max-queue-bytes` | 16 MiB | buffered **and** collected-but-unconcluded bytes together; above it a frame is not buffered and **not acknowledged** — the mediator keeps its copy and re-covers |
| `duplicate-window` | 30 days | a concluded digest is absorbed for the window, measured from conclusion — and **the window beats everything**: at its end, entry, absorption and any unpaid ack intent fall together |
| `routed-ack-deadline` | 24 h | the one switch signal of §3a: a deposit in mode `routed` accepted this long without a valid acknowledgement, while no routed deposit of the instance has been acknowledged |

Withdrawn from the second casting, with reasons on the record:
`challenge-lifetime` (the adapter has no wall-clock source of its
own; a bound it cannot measure is a promise it cannot keep — the
ATM challenge's freshness is the mediator's own concern),
`max-binding-tombstones` and `orphan-horizon` (binding machinery of
the carrier port this contract does not present).

The honest limit, as before: these bind the **adapter**. Where the
mediator is stricter (an unpublished TTL, an ACL change, a quota),
the holder sees only the port's own forms — never a
mediator-shaped error.

## 3. Operation mapping

| Adapter operation | Mediator wire | Notes |
|---|---|---|
| `register(rkids)` | ATM auth (challenge → authcrypt `atm/1.0/authenticate` → access+refresh JWT) under the connection DID; keylist update for this principal's `rkid`s | transport admission and routing registration only — expressly **not** §5a.3 registration; no generation, no proof toward this adapter. `register` records the desired keylist and returns; synchronization is a tracked background task retried by `advance` (the no-await rule covers every port operation). The auth handshake is **single-flight**: concurrent operations share one challenge/response session |
| `submit` | `POST /inbound` / WS frame; the sealed RLTP envelope in the sending form of §3a, on the connection DID's session (mode `routed`) or the egress identity's send-only session (mode `egress-session`) | returns the submission id **synchronously**; the transport attempt runs behind it. TSP framing is the wire binding's duty, built anew for every attempt (§7) |
| `collect` | live delivery / `delivery-request`; mediator fetches with `DoNotDelete` | redelivery before ack is re-cover, not a new item |
| `conclude` | `messages-received` over the digest set of the collection (decision 3) | infallible at the port; see §4 |
| `advance` | adapter clock only | give-up, retries, ack flushing, duplicate-window pruning |

Delete-to-ack order is **hand off → await → ack** (Dogwood,
`vti-didcomm-js` `29b92cc`), kept with three receiver registers:
buffered, outstanding, concluded. Only a **concluded** digest is
ever (re-)acknowledged; a redelivery of a buffered or outstanding
frame is ignored without acknowledgement. Collections carry an
adapter-issued id; conclusion uses the adapter's authoritative
digest set, and an empty collection creates no register entry.

## 3a. Sending form

Two modes, one of them the rule. Both put the same message in
front of the counterpart: a TSP Rev 3 `direct` message from this
side's egress identity to the counterpart's connection DID. They
differ in how it reaches the mediator.

**RLTP-VTI-3110** — Mode `routed` is the mode of every adapter
instance from its construction. A deposit in it is two TSP Rev 3
layers:

1. **inner:** a `direct` message whose payload is the sealed RLTP
   envelope, sender the egress identity, receiver the
   counterpart's connection DID, sealed (HPKE-Base) to the key the
   counterpart's DID document names first under `keyAgreement`,
   signed by the egress identity;
2. **outer:** a routed message (TSP Rev 3 routed mode, the
   library's `packRouted`) whose payload is the inner message's
   bytes, unchanged; sender the connection DID, receiver `C`,
   sealed to the key `C`'s DID document names first under
   `keyAgreement` as resolved at the session's authentication, and
   route list `[` the counterpart's connection DID `]`.

It is deposited on the connection DID's authenticated session.

**RLTP-VTI-3115** — The route list of an outer layer has exactly one
entry, the counterpart's connection DID. It never names the
counterpart's egress identity, a control principal, or a second hop;
what the mediator arranges beyond itself is its own (§5a.10).

**RLTP-VTI-3120** — Mode `egress-session` is a fallback, permitted
only after the switch of RLTP-VTI-3130. A deposit in it is the inner
message of RLTP-VTI-3110 alone, deposited on a session the egress
identity authenticates at `C` for this purpose. That session is
send-only: it collects nothing, acknowledges nothing, holds no
keylist and no Live Mode.

**RLTP-VTI-3130** — An instance switches from `routed` to
`egress-session` only when both hold:

1. a deposit in mode `routed` has been `accepted` for
   `routed-ack-deadline` (§2) without a valid acknowledgement, and
2. no deposit of this instance in mode `routed` has been
   acknowledged.

Nothing else switches: not a refusal (it maps as §5 says), not a
mediator status or problem-report frame (consumed, §5), not an
offline signal. The switch is one-way for the instance; an
instance that saw one routed deposit acknowledged never switches,
and a successor instance (§6) starts in `routed`.

**RLTP-VTI-3135** — From the switch on, every attempt uses the new
mode. A submission still in the holder's custody (no report yet, or
`awaiting-transport`) goes in the new mode at its next hand-over
through the holder (RLTP-DEL-6125). A submission already `accepted`
in mode `routed` and not yet `delivered` is deposited once more in
the new mode from the instance's own copy (RLTP-VTI-7130), and only
while the opening that handed it over is still open; a terminal
submission (`delivered`, `failed`) is never deposited again. Its
trias state does not move (§6.1: nothing moves `accepted` back), and
its give-up horizon keeps running from its first submission
(RLTP-DEL-6130). A document that thereby arrives twice is absorbed by
the receiver (Delivery §6.2).

**RLTP-VTI-3140** — The receiving side needs no mode. In both modes
what reaches its connection DID's session is the inner `direct`
message: in mode `routed` the mediator opens the routing layer and
passes the inner message on unchanged. A receiving binding delivers
only a Rev 3 `direct` message with a non-empty payload from the
counterpart's egress identity to its own connection DID (§7).

The signal is honest about what it cannot tell apart: a missing
acknowledgement is also what a counterpart produces that stays
offline for the whole deadline, so a fresh relationship with an
absent counterpart can switch without need. Such a switch is
conforming — both modes satisfy §1a — and costs what §9 states for
mode `egress-session`: a second session and a link between the two
identities through two logins. The other side of the trade is a
relationship whose every document fails at the give-up horizon on
a mediator that does not carry routed messages.

## 4. Acknowledgement intent and durability

`conclude` records the digest set as **ack intent** and returns —
it never awaits the mediator; the flush runs as a tracked
background task and every `advance` starts a fresh one for what
has not landed. No wire error, and no hanging wire, ever reaches
the holder through `conclude`. An intent is retried for the length of
the duplicate-window and no longer: at the window's end intent,
entry and absorption fall together (the rule of §2, restated here
where the flush lives).

The intent's durability is the **host's store**: the adapter
exposes its ack state (concluded digests with conclusion instants,
pending intents) for the host to persist, and accepts it back at
construction. The snapshot invariant — every pending intent names
a concluded entry — is enforced **fail-closed**: an inconsistent
snapshot is refused at construction, never silently trimmed. A
restore names its instant; a concluded entry older than the
duplicate-window is dropped **at the restore instant**, owed or
not, and a conclusion instant **after** the restore instant is
refused outright (it would stretch the window past its declared
span). **The window beats everything** — at absorption, at the
prune, at the restore: an ack intent is retried until the window
closes, then intent and absorption fall together; there is no
ageless debt whose truth the adapter would have to know, and a
phantom debt (an ack that in fact landed just before a close) can
never outlive the window and delete a fresh copy. A byte-identical
arrival beyond the window is a new item — always, without
exception; what this can produce in the worst case (one duplicate
delivery after a lost ack, a restart and thirty days) is owned by
the receiver's §6.2 absorption, which the Delivery Contract
requires regardless. One boundary precision: a wire call cannot be
recalled, so **the window closes for an id no earlier than the end
of an acknowledgement call already carrying it on the wire** — the
stay of expiry begins at the wire call itself, never earlier (a
hanging authentication extends no window; ids whose entry already
fell are not sent at all), it covers absorption too (so the
irrecallable ack can never delete a copy the holder has not
absorbed), and the account is settled the moment the call returns.

**The teardown edge, priced honestly.** An acknowledgement still
flying at `close()` cannot be carried by the snapshot; a restored
successor retries a persisted intent until it lands or the window
closes. Two regimes, both closed:

- **Inside the window, a deletion by any of these calls is
  port-equivalent to the declared absorption.** A deleted copy is
  byte-identical to a digest whose entry is still concluded and
  whose window is still open — had it been delivered instead, this
  profile's own duplicate rule (§2) would have absorbed it without
  surfacing it. The holder observes the same thing either way: the
  copy does not appear. Retried acknowledgements therefore add no
  loss beyond what the window already declares, however many times
  a lost response makes them retry.
- **Beyond the window, no intent survives to be retried** — intent,
  entry and absorption fell together — so the only calls that can
  still land are those a teardown left irrecallably flying: **at
  most one call per teardown that abandoned a flying
  acknowledgement**. One such call carries the finite batch of
  digests that were pending at that teardown — state, not traffic —
  and deletes **at most one copy per digest it carries**, each
  landing once. The number of calls is bounded by the host's own
  succession behaviour, the reach of each call by the state it was
  sealed with, and a host that drains with `settle()` before
  succession leaves none. Each deleted copy is priced identically: the affected
  submission never becomes `delivered` and fails honestly at the
  sender's declared give-up horizon, exactly as after any transport
  loss following acceptance, and resubmission after a failure is
  the application's documented recourse. This profile invents no
  sender retransmission machinery §6.1 does not define; it prices
  the edge in §6.1's own coin.

A host that wants the tidier shutdown still has `settle()` (§6) to
drain before succession.
 A conclusion arriving while a flush is
running receives its own flush when that one ends; a failing wire
waits for the next `advance` instead of spinning. A
host that persists nothing re-receives concluded items after a
restart and owes their absorption to §6.2 — stated here as the
honest boundary, exactly as the library's byte boundary already
carries M-2.

## 5. Sender states and refusal mapping

Trias per §6.1 with the closed sets, unchanged. Additionally the
port carries the **receiver refusal channel** (review 2 B8): the
delivery layer, which alone can validate a counterpart's refusal,
reports it to the adapter and the submission fails as
`failed(rejected-by-receiver(<code>))` — for `trust-task-error/0.2`
counterparts the code is the registry code (`malformedRequest`,
`unsupportedType`, `proofRequired`, `proofInvalid`,
`wrongRecipient`, `identityMismatch`); `idConflict` is §6.2
absorption, never a failure; `unavailable`/`internalError`
(retryable) produce **no port transition at all** — they are
availability conditions of the counterpart's infrastructure, the
delivery layer simply retries under its own schedule, and a
submission that already entered the trias keeps its trias state
(§6.1: pre-transport reports end at trias entry — nothing moves
`accepted` back); `expired` has no port equivalent (recorded
divergence). A validated
refusal acts on every **non-terminal** state — the report-less
phase, awaiting, and accepted alike — because the validated
refusal is itself the proof that the counterpart received the
envelope (the mediator can accept and forward while the
depositor's own call is still unresolved), and the attempt's
later resolution never displaces it. Terminal states stand: §6.1
knows exactly one late correction of a terminal state — the valid
acknowledgement — and this profile adds no second. The refusal channel carries **terminal verdicts only**: `unavailable` and
`internalError` are availability conditions of the transport, not
receiver verdicts — they never enter `receiverRefused` (the
runtime refuses them fail-closed), and the submission simply
remains governed by the adapter clock like any other transport
outcome.

Transport conditions map as before: 401/403/ACL →
retriable, persistent → `failed(unroutable)` at the horizon; 413 →
`failed(oversize)`; upgrade drop/timeout/DNS →
`awaiting-transport(transport-unreachable)`; 429/5xx →
`awaiting-transport(carrier-refused-retriable)`;
`duplicate-channel` → re-establish, no port event; mediator
status/problem-report frames → consumed, never acked, never items.
A refusal of a routed deposit maps like any other deposit refusal
above; it is not a switch signal (§3a).

## 6. Lifecycle coupling (§5a.10, applied)

Change of the direct carrier = change of `C` = new principal, new
adapter instance, new wire identities; the old ones are retired,
never re-pointed. Changes beyond the direct carrier change
nothing. A rebind is likewise a new instance. There is no wind-up
here to run: the adapter holds no bindings — what it holds at
teardown is its ack state (§4, the host persists it) and its
submissions. **A close with live submissions ends their
reporting** — a retired instance has no clock, so it does not
pretend to fail them at a horizon it no longer drives. The
documents stay in the holder's custody (RLTP-DEL-6120); the
retired instance's copies were volatile and authorize nothing
after its close.

**RLTP-VTI-6110** — A successor instance takes documents over only
from the holder's custody view of an active opening, at its own first
reconcile (RLTP-DEL-6125, RLTP-DEL-6130). A copy, list or snapshot
that the retired instance or the host took before the lock or the
close authorizes no submission.

**RLTP-VTI-6120** — A successor instance's give-up horizon for a
document runs from the document's first submission as the sender
recorded it, never from the takeover (RLTP-DEL-6130). The successor
starts in mode `routed` (RLTP-VTI-3130).

This profile refuses to promise more than a retired instance can
keep. The boundary is realized in code:
`close()` retires the instance — subsequent port operations
refuse, a late-resolving wire mutates nothing, and the ack state
remains readable for the host's final persist. Beside the port
stands one host teardown aid: `settle()` awaits the in-flight
background tasks so a host can drain before persisting its ack
state — it is not a port operation, it may wait as long as a
hanging wire does, and a host bounds it externally because this
library holds no clock. "Every state port"
includes the reads: `status`, `has`, `drainTransitions` and
`keylistSynced` refuse on a retired instance — a port that no longer drives its horizons
must not keep answering as if it did — and the inbound reports
(`acknowledged`, `receiverRefused`) are no-ops. The honest limit:
a wire call already in flight at close time cannot be recalled —
it may still land at the mediator; it merely cannot change
anything here, and nothing new starts after retirement (checked
between the auth handshake and every subsequent wire call).

## 7. Due at the wire binding

The concrete binding over `vti-didcomm-js` and `vti-tsp-js` owes:
TSP framing in the sending form of §3a under **Rev 3's cipher
posture** (HPKE-Base; HPKE-Auth is removed in Rev 3), the CESR
demux discipline of ref-04, the M-2 duty (raw received bytes
passed truthfully), and the rules below.

**RLTP-VTI-7110** — The adapter's copy of a submission is the
sealed RLTP envelope, never a TSP frame. The binding packs both
layers anew for every attempt, with the keys resolved for the
session that attempt uses; a frame sealed to a key the mediator no
longer names is never deposited again.

**RLTP-VTI-7120** — The direct TSP peer of every outer layer is `C`
itself, so its VID cannot change under an unchanged `C`, and the
case of §5a.10 that establishes a fresh outer VID does not arise in
this profile; no Referral is used. What can change under an
unchanged `C` is the key `C`'s DID document names first under
`keyAgreement` (a rebinding of the intermediary). The binding
resolves that key at every authentication of the connection DID's
session, and the adapter authenticates again at the latest when its
access token expires, so a change is seen no later than the next
authentication. When the key resolved differs from the one a
submission was accepted under, that submission, if it is neither
`delivered` nor `failed`, is deposited once more under the new key,
from the instance's own copy and only while the opening that handed
it over is still open: state and horizon unchanged, a duplicate
absorbed by the receiver. A submission still in the holder's custody
is packed for the new key at its next hand-over.

**RLTP-VTI-7130** — The re-deposits of RLTP-VTI-3135 and 7120
draw on the instance's own copies, which it took from the holder's
custody (RLTP-DEL-6120). They are no new hand-over: the holder's
custody is not touched by them, a retired instance makes none, and
nothing taken before a lock or a close authorizes one
(RLTP-DEL-6130).

**RLTP-VTI-7140** — On receipt the binding delivers to the adapter
only a Rev 3 `direct` message with a non-empty payload whose sender
is the counterpart's egress identity and whose receiver is this
side's connection DID, and delivers its payload bytes unchanged.
Control messages, padding, routed and nested messages, and empty
`direct` messages are logged with their type and sender VID and
acknowledged, never delivered.

Of the §5a.10 vector debt (Delivery §11), this profile discharges
what is decidable **here**: the identity derivations are
deterministic and vector-tested (fixed inputs → byte-exact
principal, connection and egress DIDs, pairwise distinct,
prefix-separated), the addressing of both sending modes is
vector-tested (`vectors/vti-routed-addressing.json`: inner and
outer sender, receiver, route list and session per mode, and the
addressings §1a and §3a refuse), and the adapter obligations of
this contract are exercised against the wire double. The byte form
of a routed frame is the TSP library's and is not vectored here.
What genuinely needs a carrier **interface** — proof-gated
registration vectors, generation and tombstone cases — remains
with the first RLTP-carrier service, which is the first place it
is decidable.

## 8. Security Considerations

- **Identity coupling is constructive.** The factory derives
  principal, connection DID and egress identity from one
  (root, `C`, `N`), snapshotted at entry; caller-supplied
  identities are refused. The wire paths read the private fields
  directly, so overriding the public getters changes what an
  external reader sees, never what reaches the wire. The honest
  scope: this holds within the language's integrity model — a
  party that can rewrite the adapter's code, its wire object, or
  the process memory is the host itself, and no in-process
  construction defends against its own host.
- **Mediator JWT theft.** The access/refresh tokens authorize use
  of the mediator as this principal's relay: a thief can deposit
  under the stolen session and drain queued frames to itself.
  They do NOT let the thief read envelope contents (E2E-sealed to
  the rkid) or forge delivery-acks (which need the counterpart's
  key). Tokens live in adapter memory only, are never persisted
  in `AckState`, and die with the instance; the residual risk is
  the host process's memory, as with every key this library
  holds.
- **Queue bounds are the DoS posture.** Defence is
  resource-shaped (§5a.4): the floor guarantees admission below
  the declared bounds, the cap refuses above them by *not
  acknowledging* — an attacker who fills the inbox delays
  delivery but deletes nothing, because the unacknowledged copy
  stays at the mediator.
- **The ack store is integrity-critical at the host.** A host
  store that fabricates `pending` entries can make the adapter
  acknowledge (delete) mediator copies it never handled;
  fail-closed restore limits this to entries the snapshot also
  declares concluded, and a host that cannot protect its store
  inherits exactly the §6.2 duty the profile names. The
  duplicate-window rules (the window beats everything; no future
  instants) bound what a corrupted clock can stretch.
- **Give-up produces failure, never silence.** Every declared
  bound ends in a §6.1 report; the teardown paragraph (§6)
  states the one case where reporting ends, and hands it to the
  host explicitly. There is no path on which an envelope is
  dropped without either a report or a mediator-retained copy.

- **The fallback is not a downgrade of what the mediator
  learns.** A mediator can force the switch of §3a by dropping
  routed frames. In mode `egress-session` it then learns through
  two logins what it reads in one frame in mode `routed`: the
  connection DID and the egress identity of one relationship
  (§9). The counterpart sees the same sender in both modes; the
  cost of a forced switch is the second session.
- **Foreign inner messages fail at the receiver.** The mediator
  opens the routing layer and could pass on an inner message of
  its own choosing. An inner message is sealed to the
  counterpart's connection key and signed by the egress identity;
  the receiving binding delivers only the expected pair
  (RLTP-VTI-7140), so a substituted or forged inner message is
  refused before the adapter and has no effect. A mediator that
  ignores the route list, or delivers late or not at all, is a
  carrier that loses a document: the give-up horizon covers it.

## 9. Privacy Considerations

- **What the mediator learns.** In mode `routed`, from one frame:
  the sender's connection DID (outer sender), its egress identity
  (inner sender, once the routing layer is open), and the
  counterpart's connection DID (route list and inner receiver);
  besides these, timing, sizes (the routing layer adds about
  400 bytes per frame) and frequency. Over both directions it holds
  both connection DIDs and both egress identities of one
  relationship. In mode `egress-session` it learns the same
  identifiers, and links connection DID and egress identity through
  two logins from one device instead of one frame. An operator's
  undertaking not to store forwarded frames is not a guarantee this
  profile can rely on; it assumes the mediator keeps what it sees.
- **What the counterpart learns.** The egress identity as the
  sender of every document, and the connection DID as this side's
  address. Neither appears in any other relationship.
- **Linkability, per party.** Every wire identity is per
  relationship × carrier and carries §5a.10's three prohibitions.
  **Toward counterparts** nothing joins one relationship to
  another, and the sending identifier stays apart from the
  collecting one (§1a). **Toward the mediator** the two are joined
  inside each relationship — in one frame in mode `routed` — while
  nothing joins its relationships to each other through
  identifiers; timing, source address and volume remain, as §10 of
  the Delivery Contract records, and this profile claims no
  unlinkability. Only a nested inner relationship (TSP §4, §5.5),
  in which the egress identity travels inside a layer the mediator
  cannot open, would keep it from the mediator (§10).
- **The principal never appears on the wire** — the mediator
  cannot see, and therefore cannot leak, the identifier under
  which port-level authority is exercised.
- **The ack store reveals traffic history.** `AckState` holds
  digests and instants of concluded deliveries — metadata about
  what arrived and when, not content. A host persisting it should
  protect it like the message store it accompanies.
- **Instance retirement is not principal retirement.** `close()`
  ends one instance's ports; the identities belong to the
  **relationship** (Identity §7a: `N` survives instances), so a
  successor instance over the same (root, `C`, `N`) resumes the
  same relationship under the same names — that is the §6
  successor path, not a revival by an outsider (the names are
  worthless without the root's keys). Retired **for good** they
  are only with the principal — on a rebind or a change of `C` —
  and then never reassigned.

## 10. Open Issues

1. **Keeping the egress identity from the mediator.** A nested
   inner relationship (TSP §4, §5.5) between the egress identity
   and the counterpart would hide the egress identity from the
   mediator, at the cost of a further sealed layer and a nested
   relationship per pair. The TSP library this profile targets
   offers no nested relationship forming; not measured, not part
   of this casting.
2. **Separate pickup identities.** A form in which each
   relationship collects under an identity of its own with its own
   login has not been measured live.
3. **The value of `routed-ack-deadline`.** 24 hours trades a false
   switch against stranded documents (§3a); no measurement of
   counterpart absence underlies the value.
4. **An explicit refusal of routed messages.** A mediator that
   answers a routed deposit with a refusal is handled by §5 and
   does not switch (RLTP-VTI-3130). Whether a refusal that names
   the routed form should switch at once is open.
5. **Keylist.** §1 and §3 name keylist updates; the target
   mediator keeps no keylist for TSP clients, and the binding
   treats the update as a no-op.

## Appendix A: Companion changes

§1a reads one clause of Delivery §5a.10 differently from its
present wording. The Delivery Contract owns that clause; these are
the changes its next casting takes up.

**Delivery Contract (next casting):**

- 5a.10, TSP ingress, the prohibition "not person-wide": the clause
  "the sending side and the collecting side of one person must never
  meet in one identifier" applies to the sender-side identifier the
  receiving endpoint verifies, the innermost end-to-end sender of the
  deposit. An outer layer addressed to the direct carrier MAY carry
  the collecting identifier of the same relationship and carrier.
  The other prohibitions — not well-known, no second relationship,
  no second carrier, never a control principal or a value derivable
  from one, not reused outside the relationship — apply to every
  layer the adapter presents.
- 5a.10, the paragraph on the nested private end-to-end VID: "hidden
  from intermediaries by construction" holds for nested envelopes;
  in routed mode the direct carrier opens the routing layer and
  reads the inner sender and receiver.
- §11, conformance examples under "TSP ingress": a routed deposit
  whose outer sender is the depositing side's collecting identifier
  at the direct carrier and whose inner sender is an identifier
  exclusive to sending → conformant; a single-layer deposit whose
  sender is the collecting identifier → nonconformant.
