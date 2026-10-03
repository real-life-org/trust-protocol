# RLTP Transport Adapter Profile: VTI Mediator

**Real Life Trust Protocol — Transport Adapter Profile (below the port line)**

- **Status:** Editor's Draft
- **Version:** 0.4.0-draft (fourth casting — review 3 answered,
  `design/adapter-review3-triage-2026-09.md`: no port operation ever
  awaits the mediator (attempts and ack flushes are tracked
  background tasks); no report is invented (a first attempt in
  flight has no pre-transport report until the status-horizon
  elapses); `unroutable` is reserved for the persistent
  admission-refusal class; an unpaid delete-to-ack debt is never
  pruned; refusals act on live submissions only; snapshots are
  fail-closed; `close()` realizes the §5a.10 lifecycle boundary.
  Third casting: Anton's Option B — a transport adapter contract,
  not a carrier at the port; §5a.3/§5a.9 expressly not claimed)
- **Editors:** Anton Tranelis

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
3. the **§5a.10 identity obligations** in full.

What it expressly does not owe, and no holder may read into it:
proof-bound registration, generation ordering, tombstone
consumption, orphan wind-up, published carrier constants beyond
those declared below. Those guarantees are obtainable only from an
RLTP carrier; a holder that requires them must not settle for a
foreign one.

## 1. Identities (§5a.10, unchanged from the second casting)

- `C` is the **mediator's DID**, exactly as configured (Identity
  §7a.2 — never a hop beyond it, never the URL it resolves to).
- The control principal (`carrierPrincipal(rootIkm, C, nonce)`)
  **never touches the wire.** Beside it the adapter derives, from
  the same root under the normative prefixes
  `rltp/v1/carrier-connection/ed25519/v1/` and
  `rltp/v1/carrier-egress/ed25519/v1/` (Identity §13 lists both),
  the **connection DID** (all mediator protocol traffic: auth,
  keylist, pickup, receipts) and the **egress identity** (presented
  on every deposit — §5a.10's sender-side identifier, one per
  relationship × carrier). Each is derivable from the root; none
  from any other. The adapter refuses construction if any two of
  principal, connection DID and egress identity coincide.
- Both wire identities carry §5a.10's three prohibitions — **not
  well-known**, **not person-wide**, **not reused outside this
  relationship** — and are retired with the principal, never
  reassigned. `from_prior` is **forbidden**; a new connection DID
  is a fresh mediation relationship, never a rotation statement.
- One mediation relationship per principal; keylists
  principal-local; every status, pickup and receipt operation
  scoped to one principal's connection; Live Mode per relationship
  (MUST), one socket per principal by default (5a.7 spacing
  declares any multiplexing).

## 2. Declared constants (decision g1-a, revised under Option B)

Five constants with transport meaning, every one enforced in the
implementation. They are promises of **this casting**: a revision
is a new casting of profile and code together — there is no
runtime revision machinery, and this profile claims none:

| Constant | Value | Enforced by |
|---|---|---|
| `give-up-horizon` | 72 h | every submission not confirmed delivered — `accepted` included — fails at the horizon; `unroutable` only for the persistent admission-refusal class, overload never |
| `status-horizon` | 60 s | `submit` returns synchronously; while the first attempt is in flight and the horizon has not elapsed there is honestly **no report yet** (§6.1 owes the report *within* the horizon, and this profile refuses to fill the window with an invented reason); an attempt overdue past the horizon reports `transport-unreachable`, and a wire that knows itself offline reports `offline` immediately |
| `queue-floor` | 64 envelopes **and** 1 MiB | below both bounds an inbound frame is always buffered |
| `max-queue-bytes` | 16 MiB | buffered **and** collected-but-unconcluded bytes together; above it a frame is not buffered and **not acknowledged** — the mediator keeps its copy and re-covers |
| `duplicate-window` | 30 days | a concluded digest is absorbed for the window, measured from conclusion |

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
| `register(rkids)` | ATM auth (challenge → authcrypt `atm/1.0/authenticate` → access+refresh JWT) under the connection DID; keylist update for this principal's `rkid`s | transport admission and routing registration only — expressly **not** §5a.3 registration; no generation, no proof toward this adapter |
| `submit` | `POST /inbound` / WS frame; sealed RLTP envelope under the egress identity | returns the submission id **synchronously**; the transport attempt runs behind it. TSP framing is the wire binding's duty, including §5a.10's peer-change rule (only the binding sees the peer) |
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

## 4. Acknowledgement intent and durability

`conclude` records the digest set as **ack intent** and returns —
it never awaits the mediator; the flush runs as a tracked
background task and every `advance` starts a fresh one for what
has not landed. No wire error, and no hanging wire, ever reaches
the holder through `conclude`. The duplicate-window prunes only
digests whose acknowledgement has **landed**: an unpaid
delete-to-ack debt is never forgotten, and its absorption stands
while it is owed.

The intent's durability is the **host's store**: the adapter
exposes its ack state (concluded digests with conclusion instants,
pending intents) for the host to persist, and accepts it back at
construction. The snapshot invariant — every pending intent names
a concluded entry — is enforced **fail-closed**: an inconsistent
snapshot is refused at construction, never silently trimmed. A
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
(retryable) are `awaiting-transport(carrier-refused-retriable)`;
`expired` has no port equivalent (recorded divergence). A refusal
acts on a **live** submission (awaiting or accepted) only: §6.1
knows exactly one late correction of a terminal state — the valid
acknowledgement — and this profile adds no second.

Transport conditions map as before: 401/403/ACL →
retriable, persistent → `failed(unroutable)` at the horizon; 413 →
`failed(oversize)`; upgrade drop/timeout/DNS →
`awaiting-transport(transport-unreachable)`; 429/5xx →
`awaiting-transport(carrier-refused-retriable)`;
`duplicate-channel` → re-establish, no port event; mediator
status/problem-report frames → consumed, never acked, never items.

## 6. Lifecycle coupling (§5a.10, applied)

Change of the direct carrier = change of `C` = new principal, new
adapter instance, new wire identities; the old ones are retired,
never re-pointed. Changes beyond the direct carrier change
nothing. A rebind is likewise a new instance. There is no wind-up
here to run: the adapter holds no bindings — what it holds at
teardown is its ack state (§4, the host persists it) and its
submissions (which fail honestly at the give-up horizon if the
teardown outlasts them). The boundary is realized in code:
`close()` retires the instance — subsequent port operations
refuse, a late-resolving wire mutates nothing, and the ack state
remains readable for the host's final persist.

## 7. Due at the wire binding

The concrete binding over `vti-didcomm-js` owes: TSP framing
toward **Rev 3's cipher posture** (HPKE-Base; HPKE-Auth is removed
in Rev 3 and the OpenVTC stack switches before its next event),
the peer-change rule (a changed direct TSP peer under an unchanged
`C` retires the outer VID and establishes a fresh one via Rev 3's
Referral field where available), the CESR demux discipline of
ref-04, and the M-2 duty (raw received bytes passed truthfully).

Of the §5a.10 vector debt (Delivery §11), this profile discharges
what is decidable **here**: the identity derivations are
deterministic and vector-tested (fixed inputs → byte-exact
principal, connection and egress DIDs, pairwise distinct,
prefix-separated), and the adapter obligations of this contract
are exercised against the wire double. What genuinely needs a
carrier **interface** — proof-gated registration vectors,
generation and tombstone cases — remains with the first
RLTP-carrier service, which is the first place it is decidable.
