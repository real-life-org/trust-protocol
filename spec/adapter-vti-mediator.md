# RLTP Transport Adapter Profile: VTI Mediator

**Real Life Trust Protocol — Transport Adapter Profile (below the port line)**

- **Status:** Editor's Draft
- **Version:** 0.30.0-draft (thirtieth casting)
- **Status of This Document:** Editor's Draft, not yet converged.
  This profile changes normatively between castings and MUST NOT be
  relied upon for implementation or interoperability claims. Review
  and comment are welcome through the editors.
- **Editors:** Anton Tranelis
- **Companions:** RLTP Delivery Contract 0.85 (§4.6, §5, §5a.10, §6.1,
  §6.2, §6.3, RLTP-DEL-5030, RLTP-DEL-5040, RLTP-DEL-6120 to
  RLTP-DEL-6135, RLTP-DEL-6330, RLTP-DEL-6335; Appendix A names the
  changes its next casting takes up); RLTP Identity 0.55 (§7a, §9.3,
  §13); RLTP Encounter 0.32 (§5.3, §5.5, §5.8, §6, RLTP-ENC-6050,
  RLTP-ENC-6060, RLTP-ENC-6080, RLTP-ENC-6090); RLTP Trust Layer 0.31
  (§6a)

Target carrier: the VTI/Affinidi messaging mediator from release
**0.45.0** on (`affinidi/affinidi-messaging-mediator` @ `7e378c03`),
which opens a TSP message addressed to itself only in TSP 1.0, run
with local direct delivery allowed for mode `direct` (RLTP-VTI-3120)
(pins: `vti-didcomm-js` 0.13.0 @ `8054313f`, `vti-tsp-js` 0.4.0
(`OpenVTC/vta-browser-plugin` @ `a24e498f`); protocol texts:
Coordinate Mediation 2.0 @ `d5909369`, Message Pickup 3.0 @
`9dfa409f`, TSP 1.0 @ `ccda6b33` — `sources/pins/PINS.md`; the wire
binding speaks TSP 1.0 and nothing else, see §7). Carriage of a
document: the registry's TSP binding `bindings/tsp/0.1` (§2 document
carriage, §3 identity mapping), counterpart refusals
`trust-task-error/0.5` and recipient-suggested continuations
`trust-task-next-step/0.1` (`trustoverip/dtgwg-trust-tasks-tf` @
`579d8e29`), and `trust-task-error/0.6`, which extends 0.5 (@
`3c4ef4d0`; RLTP-VTI-5015). Seam evidence:
`design/mediator-naht-bestandsaufnahme-2026-08.md`.

## 0. What this contract is, and is not

The mediator is a **foreign carrier**: it keeps its own contract
(mediation, pickup, delete-to-ack) and has never given the RLTP
port's promises — no proof-gated registration, no generations or
tombstones, no published constants, no wind-up. TSP 1.0 says the
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
   §6.2 rule: it absorbs a copy only for `give-up-horizon` after its
   conclusion, and hands every later copy to the holder, whose
   absorption answers it again (RLTP-DEL-6330, RLTP-DEL-6335);
3. the **§5a.10 identity obligations**, with one wire identity per
   relationship and carrier that deposits and collects alike (§1a),
   except the change of the direct TSP peer under an unchanged `C`,
   which this profile does not serve (RLTP-VTI-7120, Appendix A);
4. the **carriage of every document as a Trust Task document** in the
   registry's TSP binding (Delivery §4.6, RLTP-DEL-5030), so that a
   consumer of the binding that does not know RLTP reads a document it
   can dispatch, refuse or answer (§3b, §5).

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
  the same root under the normative prefix
  `rltp/v1/carrier-connection/ed25519/v1/` (Identity §13), **one wire
  identity** per relationship × carrier, the **connection DID**: this
  side's account at the mediator and its address in the relationship.
  The one session of the relationship runs under it (auth, keylist,
  pickup, receipts, and every deposit in both sending modes, §3a); it
  is the sender of every TSP message this side deposits, in every
  layer, and the receiver of every message the counterpart sends.

  The counterpart's connection DID is an input to an instance. A side
  takes it from the counterpart's delivery hint in the card that
  opened the relationship (§1b), and from nowhere else. The one
  instance that starts without it is a displayed card's instance
  (§1c), which takes it from the same hint when it is bound.

  The connection DID is derivable from the root; the principal is not
  derivable from it, nor it from the principal. **The pair is derived
  by the adapter's factory itself** from one (root, `C`, `N`), `N` the
  relationship's carrier nonce (Identity §7a.3, RLTP-VTI-1215) —
  caller-supplied identities are refused at the door, so a mixed pair
  (identities from two relationships) cannot be built at all.
- The connection DID carries §5a.10's three prohibitions — **not
  well-known**, **not person-wide**, **not reused outside this
  relationship** — and is retired with the principal, never
  reassigned. The delivery hint (§1b) names it only in the card of
  the enactment that opens its relationship; Appendix A states the
  reading of "not well-known" this needs. `from_prior` is
  **forbidden**; a new connection DID is a fresh mediation
  relationship, never a rotation statement.
- One mediation relationship per principal; keylists
  principal-local; every status, pickup and receipt operation
  scoped to one principal's connection; Live Mode per relationship
  (MUST), one socket per principal by default (5a.7 spacing
  declares any multiplexing). Each relationship holds **one session
  per side**, the connection DID's, in both sending modes. A
  displayed card's instance (§1c) holds the connection DID's session
  and socket from the display on, before the relationship exists.

## 1a. One wire identity

Delivery §5a.10 lets one wire identity per relationship and carrier
deposit and collect: what it forbids is that the sending side meets
the control principal, or a value derivable from it, which never
appears on the wire here. This profile uses that permission
completely. The counterpart sees one identifier of this side, the
identifier it addresses and the identifier it verifies are the same,
and its answers go where TSP's own model sends them: to the
authenticated sender of the message it opened (TSP binding §3,
framework §8.1).

**RLTP-VTI-1120** — The sender of every layer of every deposit MUST be
the connection DID of the same relationship and carrier, and nothing
else: the inner `direct` message in both modes (RLTP-VTI-3110, 3120)
and the outer routed message in mode `routed`. It MUST NOT be the
control principal or a value derivable from it.

*Rationale.* A second identity that only sends would protect
nothing: the counterpart would know both identifiers of this side, and
the mediator would read both in one frame of mode `routed` (§9). It
would cost the answers of every consumer that follows the registry's
binding: such a consumer sends a refusal or a next step to the
authenticated sender of the message it opened, and an identity that
only sends collects nothing. One identity makes the delivery hint an
ordinary `TSPTransport` service entry (§1b) and the fallback mode a
second form on the same session (§3a).

## 1b. The delivery hint

A card MAY carry delivery hints (Encounter RLTP-ENC-6080); their form
is the carrier profile's. This section fixes the hint by which a side
offers this carrier to a counterpart, and how the counterpart reads it.
The card that carries it is the card of the enactment that opens the
relationship: for the displaying side its displayed card, for the
scanning side its sent card (Encounter §5.8). Both are signed under the
fresh pair anchor of that enactment, so the hint is bound to the
enactment by the card's proof, and to nothing else.

**RLTP-VTI-1210** — A hint of this profile is the JCS serialization
(RFC 8785) of a JSON object with exactly three members: `type`, the
string `TSPTransport`; `id`, the side's connection DID followed by
`#tsp`; and `serviceEndpoint`, `C` exactly as configured. The
connection DID is an Ed25519 `did:key` identifier in exactly the form
the derivation of §1 produces: `did:key:z` followed by the base58btc
encoding of the multicodec prefix `0xed 0x01` and the 32-byte public
key, in its canonical rendering (decoding and re-encoding yields the
same string); a string that only matches the pattern `did:key:z6Mk…`
without decoding so is not one. A card carries at most one hint of
this profile per `C`; a side reachable through two mediators places
two hints, and the card stays within RLTP-ENC-6090.

**RLTP-VTI-1215** — The identity a hint names is the connection DID
the adapter factory derives from (root, `C`, `N`), where `N` is the carrier nonce (Identity §7a.3) of the
relationship the card opens. The displaying side draws `N` fresh when
it makes the displayed card and records it in its register under the
relationship that card's enactment opens; the scanning side draws `N`
fresh at the scan. `N` is not derived from the card, its anchor, its
challenge or any pair nonce, and it appears in no card and on no wire;
only the identity derived from it does. A displayed card that ages
unscanned leaves its `N` to no relationship (RLTP-VTI-1270).

**RLTP-VTI-1220** — A receiver reads a hint as this profile's only if
it parses as a JSON object, its bytes are the JCS serialization of that
object, and the object satisfies RLTP-VTI-1210, or does so beside a
fourth member `rltpEgress`, which the receiver ignores whatever its
value. A hint that fails any of these is ignored; it is no fault of the card, which may carry hints
of other profiles. The reader is a total function: every input that
does not have exactly one of these forms — a string that is not
JSON, JSON that has no JCS serialization (an unpaired surrogate), any
other value or shape — is ignored, and no input makes the reading of a
hint or of a card's hints fail.

**RLTP-VTI-1225** — A receiver at carrier `C` takes, of the hints not
ignored under RLTP-VTI-1220 and RLTP-VTI-1227, the hint whose
`serviceEndpoint` is byte-equal to its own `C`. Where none or more than
one such hint remains, the counterpart has no wire identities at `C`.

**RLTP-VTI-1227** — A receiver ignores a hint that names its own
connection DID of this relationship and carrier. The counterpart's
identity is never this side's own.

**RLTP-VTI-1230** — The hints act at first contact only. A side takes
the counterpart's wire identities from the card of the enactment that
opened the relationship, and keeps them, and its own `N`, for the
relationship chain. That card is the counterpart's card on the
enactment record whose relationship is this one: every enactment opens
a fresh relationship (Encounter §4.4), so until the continuity machinery
chains a later enactment into the chain (Trust §6a), that enactment's
relationship is one of its own, and its card is its first contact.
Once chained, the later card leaves the chain unchanged: its hints are
ignored, and the `N` drawn for it stays with the fresh relationship it
opened. The chain is carried under the `N` of its first contact. An
adapter instance built for the later enactment's relationship before
the chaining is closed at the chaining (§6): it collects and deposits
nothing more. A document the counterpart deposited to that
relationship's account in the window and that was not collected before
the close fails at the sender's give-up horizon (§6.1), the resubmission
being the sender's recourse.

**RLTP-VTI-1235** — A relationship whose counterpart has no wire
identities at `C` (RLTP-VTI-1225, an introduced relationship, a card
without hints) is not carried by this profile at `C`: no adapter
instance is built for it there, a displayed card's instance whose
record opened it is closed at that record (RLTP-VTI-1260), and its
documents stay in the holder's custody (RLTP-DEL-6120) until another
transport takes them or they fail at their horizon. A relationship that
had no hint at first contact stays so, a re-encounter included
(RLTP-VTI-1230); the re-announcement of Open Issue 10 covers this case
as well. A displayed card's instance before it is bound serves no
relationship and is governed by §1c alone.

**RLTP-VTI-1240** — The counterpart's connection DID is the `id`
without `#tsp` of the hint taken under RLTP-VTI-1225, 1227 and 1230. It
is the receiver of every inner message this side sends (RLTP-VTI-3110),
the sender of every message this side accepts (RLTP-VTI-7140), and the
`recipient` of every document this side carries to it (RLTP-VTI-3150).

**RLTP-VTI-1245** — This profile carries no change of `N` for a
relationship whose identities a hint announced: neither the rotation of
Identity §7a.3 (`generation + 1`) nor a fresh `N` after the loss of the
register entry. The counterpart keeps the identities of the first
contact (RLTP-VTI-1230), so a holder that rotates or replaces `N` ends
the relationship's reachability over this carrier: its new identity
reaches no one, and documents to it stay in custody as under
RLTP-VTI-1235. The same holds for a second first entry that the
register convergence of Identity §7a.3 makes canonical over the `N` of
the hint (two devices writing a first `N` apart): it is a change of `N`
in this sense. A holder with one writer of its register, as this
casting assumes, never produces one. Re-announcing the wire identities
over the relationship, which all these cases and several writing
devices need, is Open Issue 10.

The hint is read below the port line. The holder that carries the
card passes the hints on as signed and interprets none; building and
reading them is the adapter's, and the mapping
from the counterpart's `rkid` to its wire identities is the host's
state beside the adapter instance. A sender above the port still knows
nothing of the counterpart's carrier arrangement but the `rkid`
(Delivery §5a.1).

## 1c. The displayed card's instance

The scanning side reads the displaying side's connection DID from the
displayed card. The displaying side learns the scanning side's only from
the sent card, which reaches it inside the encounter bundle or on the
optical leg (Encounter §5.8). For the bundle to reach it over this
carrier, an instance must collect for the displayed card before the
counterpart is known. This section fixes that instance. Its adapter is
the one every relationship has, which checks the carried document
against the frame's sender (RLTP-VTI-7160); what is particular to it
lies in the wire binding and the host: the wire takes a frame from any
sender, the check of RLTP-VTI-1255, and the counterpart's connection
DID the instance takes at RLTP-VTI-1260 (the host's
state beside the adapter, as in §1b). The optical leg needs none of it
and stays equivalent: an optical record binds the instance as a bundle
does (RLTP-VTI-1260).

**RLTP-VTI-1250** — A side that shows a displayed card carrying a hint
of this profile for `C` MUST hold, from the display on, an adapter
instance over the pair the factory derives from (root, `C`, `N`), `N`
the carrier nonce of that card (RLTP-VTI-1215), while the card's
challenge resolves `open` (Encounter RLTP-ENC-5190, RLTP-ENC-5240). It
collects under the card's connection DID, knows no counterpart, and
deposits nothing before it is bound. Every displayed card has its own:
a rotation of the displayed card (Encounter RLTP-ENC-5200) starts the
next card's instance beside those of the cards still open.

**RLTP-VTI-1255** — Before the instance is bound, the wire binding
hands its adapter a received frame only if it is a TSP 1.0 `direct`
message with a non-empty payload whose receiver is the card's
connection DID, from any sender, and hands the frame's sender VID to
the adapter with the payload, which takes a sealed RLTP envelope from
it only under RLTP-VTI-7160. Before the holder sees that envelope, the
host reads its `rkid` (Delivery §5, a member in the clear) and passes
the envelope to the holder's receive (Delivery §6.2) only if that
`rkid` is the key-agreement key of this displayed card: a bundle answering the
card is sealed to that key (Delivery §5, the recipient key from the
recipient's card), and no other relationship's documents are (Delivery
§5a.2). An envelope with any other `rkid`, or one that does not parse,
never reaches the holder and is discarded under RLTP-VTI-1265. The
holder's receive is the only place that opens the envelope. The
instance accepts the frame only if all three hold:

1. the frame is such a `direct` message (the wire binding's filter)
   whose payload carries a sealed RLTP envelope under RLTP-VTI-7160;
2. the payload is an encounter bundle that answers this displayed
   card: the holder's verdict on the bundle (Encounter RLTP-ENC-5380,
   RLTP-ENC-6050, RLTP-ENC-6060; Delivery §4.1) and the host's
   comparison of the record's own challenge with this card's;
3. the holder takes the bundle: its receive answers `unique`, or
   `duplicate-known` for a bundle it took before.

After the receive the host compares the connection DID that the hint
of the record's sent card names for `C` (RLTP-VTI-1220, 1225, 1227)
with the frame's sender VID, where that hint names one, and logs a
difference. The comparison is a diagnosis: it changes neither the
acceptance, nor the binding, nor the acknowledgement.

**RLTP-VTI-1260** — The instance is bound when the host observes the
card's challenge first resolve `recorded` (the holder's resolution),
whatever carrier, instance or leg brought the record: a frame accepted
under RLTP-VTI-1255, a bundle over another carrier or another transport,
or the optical leg (Encounter RLTP-ENC-5710, RLTP-VTI-1230). Bound, it
is the instance of the relationship that record opens, under the same
`N` and the same identity; no new instance is built. The counterpart's
connection DID is the one the hint of the record's sent card names for
the instance's `C` (RLTP-VTI-1240), never the sender of a frame, and from
then on RLTP-VTI-7140 applies to the instance unchanged. Where that sent
card names no wire identities at the instance's `C` (RLTP-VTI-1225), the
instance is closed at the record (RLTP-VTI-1235). A card with hints for
several carriers has an instance at each (RLTP-VTI-1250); the record
binds or closes each of them.

**RLTP-VTI-1265** — Every other frame that reaches the instance before
it is bound is discarded: logged with its type and sender VID, and
acknowledged — by the wire binding; by the adapter where its payload
carries no sealed RLTP envelope (RLTP-VTI-7160); by the adapter's
conclusion without a receive where its envelope is not sealed to the
card's key
(RLTP-VTI-1255); or by the adapter's conclusion where its payload
reached the holder, the holder refused it, and the refusal is
concludable (§4). Such a frame never
binds the instance and never names the counterpart. A frame whose sender
differs from the connection DID of the record's hint is logged, never
discarded on that ground. A bundle of another scanner on the same
displayed card is refused: by the holder (`failed(consumed-challenge)`,
Delivery §4.1; Encounter RLTP-ENC-5410) or, once the instance is bound,
by RLTP-VTI-7140. The first record binds (RLTP-VTI-1260); of bundles,
the first the holder takes (Open Issue 8). A bundle the counterpart
re-issues for the same enactment comes from its connection DID after
the binding and lands as Delivery §4.1 states.

**RLTP-VTI-1270** — An instance not bound when the host observes the
card's challenge resolve `unknown` (the holder's resolution, Encounter
§5.3, RLTP-ENC-5260) is closed then (§6). From then on the holder
refuses a bundle on that challenge (`failed(validation-failed)`,
Delivery §4.1; on the optical leg `gate-expired`, Encounter
RLTP-ENC-5460), so the close loses nothing the holder would take. What
the mediator still holds for the card's connection DID stays there for
the mediator's own retention; the sender's submission fails at its
give-up horizon (Delivery §6.1), which deletes nothing at the mediator.
The card's `N` opens no relationship; the account its connection DID
authenticated at `C` is left behind at the carrier (Appendix A).

## 2. Declared constants

Seven constants with transport meaning, every one enforced in the
implementation. They are promises of **this casting**: a revision
is a new casting of profile and code together — there is no
runtime revision machinery, and this profile claims none:

| Constant | Value | Enforced by |
|---|---|---|
| `give-up-horizon` | 72 h | every submission not confirmed delivered — `accepted` included, except an `accepted` submission that is `held` (§5, RLTP-VTI-5050) — fails at the horizon; `unroutable` only for the persistent admission-refusal class — never overload, never an outcome in flight, and never over a standing offline signal (the give-up verdict applies the same precedence as every observation) |
| `status-horizon` | 60 s | `submit` returns synchronously. The pre-transport report is an **honest snapshot, derived at each observation** by one precedence order — (a) the wire knows itself offline → `offline`; (b) an attempt is overdue past the horizon → `transport-unreachable`; (c) otherwise the last completed attempt's report; (d) otherwise honestly **no report yet** (absence answered as null, never a fourth value beside §6.1's closed set). One order, every observation point — no stored patchwork, no cell a connectivity change can leave silent. No attempt is ever started against a knowingly offline wire |
| `queue-floor` | 64 envelopes **and** 1 MiB | below both bounds an inbound frame is always buffered |
| `max-queue-bytes` | 16 MiB | buffered **and** collected-but-unconcluded bytes together; above it a frame is not buffered and **not acknowledged** — the mediator keeps its copy and re-covers |
| `duplicate-window` | 30 days | a concluded digest's entry and any unpaid ack intent stand for the window, measured from conclusion — and **the window beats everything**: at its end both fall together. The adapter absorbs a byte-identical copy only during the first `give-up-horizon` of the window; a later copy goes to the holder as a new item, so a counterpart that resubmits after a lost acknowledgement is answered again (RLTP-DEL-6330) |
| `routed-ack-deadline` | 72 h | the deadline of RLTP-VTI-3130: an open routed deposit (a document of this side without its answer) this long after its acceptance switches the relationship to `direct`; equal to `give-up-horizon`; a validated refusal of the routed form switches at once |
| `payload-bound` | 90 182 bytes | the largest TSP payload the adapter reads (RLTP-VTI-7160): the binding envelope, 70 bytes, around a `sealed-envelope/0.1` document at its size bound of 90 112 bytes (Delivery §4.6); a larger payload is not parsed |

This profile declares no `challenge-lifetime` (the adapter has no
wall-clock source of its own; the ATM challenge's freshness is the
mediator's own concern), and no `max-binding-tombstones` or
`orphan-horizon` (binding machinery of the carrier port this
contract does not present).

The honest limit: these bind the **adapter**. Where the
mediator is stricter (an unpublished TTL, an ACL change, a quota),
the holder sees only the port's own forms — never a
mediator-shaped error.

## 3. Operation mapping

| Adapter operation | Mediator wire | Notes |
|---|---|---|
| `register(rkids)` | ATM auth (challenge → authcrypt `atm/1.0/authenticate` → access+refresh JWT) under the connection DID; keylist update for this principal's `rkid`s | transport admission and routing registration only — expressly **not** §5a.3 registration; no generation, no proof toward this adapter. `register` records the desired keylist and returns; synchronization is a tracked background task retried by `advance` (the no-await rule covers every port operation). The auth handshake is **single-flight**: concurrent operations share one challenge/response session |
| `submit` | `POST /inbound` / WS frame; the sealed RLTP envelope carried as §3b states, in the sending form of §3a, on the connection DID's session in both modes | returns the submission id **synchronously**; the transport attempt runs behind it. The carried document is the adapter's, built at every attempt (RLTP-VTI-3150); TSP framing is the wire binding's duty, built anew for every attempt (§7) |
| `collect` | live delivery / `delivery-request`; mediator fetches with `DoNotDelete` | redelivery before ack is re-cover, not a new item; an item is the sealed envelope a payload carries (RLTP-VTI-7160), and a payload that carries none never becomes an item; a bound answer travels beside the items with its report (RLTP-VTI-5080) |
| `conclude` | `messages-received` over the digest set of the collection | infallible at the port; see §4 |
| `advance` | adapter clock only | give-up, retries (each a hand-over through the holder, RLTP-VTI-3135), the switch check of RLTP-VTI-3130, ack flushing, duplicate-window pruning |

Delete-to-ack order is **hand off → await → ack** (`vti-didcomm-js`
0.13.0), kept with three receiver registers:
buffered, outstanding, concluded. Only a **concluded** digest is
ever (re-)acknowledged; a redelivery of a buffered or outstanding
frame is ignored without acknowledgement. A digest concluded
`give-up-horizon` or more ago that arrives again is buffered as a new
item (§4); buffered and outstanding go before concluded, so a
redelivery of it is ignored while it is buffered or outstanding, and
its standing ack intent is not sent until the new item is concluded,
which sets the conclusion instant anew. Collections carry an
adapter-issued id; conclusion uses the adapter's authoritative
digest set; an empty collection creates no register entry and
counts as a concluded collection (RLTP-VTI-3130). The digest of a
frame is taken over the payload the binding delivers, the binding
envelope; a payload that carries no sealed envelope (an answer of §5,
or one RLTP-VTI-7160 ignores) is concluded by the adapter itself at its
next step and enters the same registers.

## 3a. Sending form

Two modes, one of them the rule. Both put the same message in
front of the counterpart: a TSP 1.0 `direct` message from this
side's connection DID to the counterpart's connection DID, whose
payload carries the document of §3b. They differ in how it reaches
the mediator.

**RLTP-VTI-3110** — Mode `routed` is the mode of every adapter
instance from its construction. A deposit in it is two TSP 1.0
layers:

1. **inner:** a `direct` message whose payload is the JCS
   serialization of the binding envelope of RLTP-VTI-3150, sender the
   connection DID, receiver the counterpart's connection DID, sealed
   (HPKE-Base) to the key the counterpart's DID document names first
   under `keyAgreement`, signed by the connection DID;
2. **outer:** a routed message (TSP 1.0 routed mode, the
   library's `packRouted`) whose payload is the inner message's
   bytes, unchanged; sender the connection DID, receiver `C`,
   sealed to the key `C`'s DID document names first under
   `keyAgreement` as last resolved for the session (RLTP-VTI-7120), and
   the route list of RLTP-VTI-3115.

It is deposited on the connection DID's authenticated session.

**RLTP-VTI-3115** — The route list of an outer layer has exactly one
entry, the counterpart's connection DID: TSP 1.0's `VID_exit`, the
destination's own VID with its intermediary. It never names a control
principal or a second hop; what the mediator arranges beyond itself is
its own (§5a.10).

**RLTP-VTI-3120** — Mode `direct` is a fallback, permitted only after
the switch of RLTP-VTI-3130. A deposit in it is the inner message of
RLTP-VTI-3110 alone, deposited on the same session of the connection
DID. The carrier MUST accept a TSP `direct` message addressed to an
account it serves (mediator 0.45: `local_direct_delivery_allowed =
true`, `LOCAL_DIRECT_DELIVERY_ALLOWED`; its code default is `false`);
on a carrier that does not, the fallback form carries nothing. A
refusal of direct delivery is recorded in the relationship's send
state (RLTP-VTI-3130) when the binding receives it, not at a later
deposit: the binding signals it from that moment (§7), and the adapter
records it at its next step, at the latest before its next hand-over
and in the state it hands the host to persist; a host persists that
state after the binding closed. A report that arrives after the
binding closed, or after the host's last reading of the state, is not
recorded: the next opening deposits once more, and records the refusal
at its report. A recorded refusal survives openings: from then on the
adapter hands nothing over and deposits nothing for the relationship
at `C`, and reports every submission `awaiting-transport`
(`carrier-refused-retriable`) until its give-up horizon (§5; Open
Issue 2). Any other problem report maps as §5 states.

**RLTP-VTI-3130** — The sending mode belongs to the relationship, not
to the instance: it is kept in the adapter's send state, which the
host persists with the ack state (§4), and a successor instance
resumes it. The send state holds the mode, in mode `direct`
the instant of a refusal of direct delivery if one was received
(RLTP-VTI-3120), and the **open routed
deposits**: every **document** accepted in mode `routed` and not yet
answered, with its digest and acceptance instant. A valid
acknowledgement, a validated receiver refusal (§5), a validated
`idConflict` answer or a validated next step (RLTP-VTI-5050) for that
document answers it — reported to the
instance that deposited it, bound by a later instance that files the
document for binding (RLTP-VTI-5065), or reported by the holder to a
later instance when it arrives after that one's close; answers that are no verdict
(`unavailable`, `internalError`, `indeterminate`, §5) do not. A report for a digest
the send state does not name answers nothing, so after a loss of the
send state earlier reports answer nothing. Acknowledgements this side
deposits are no open routed deposits: nothing answers them, and the
signal rests on this side's own documents only (§10).

An instance in mode `routed` MUST switch to `direct` when an
open routed deposit was accepted `routed-ack-deadline` (§2) or more
in the past, checked only after the instance has concluded (§3,
`conclude`) a collection that left no frame pending for it at the
mediator, with the reports that collection produced applied (an
acknowledgement that arrived while no instance ran waits in the
connection DID's own queue). It MUST switch at once when the
mediator answers a routed deposit with a refusal that names the
routed form and that the binding authenticates as the mediator's
(a validated refusal of routed: evidence against `routed`, §5); the
refused submission stays in the holder's custody and goes in the new
mode at its next hand-over, reported `awaiting-transport`
(`carrier-refused-retriable`) until then. It MUST NOT switch otherwise: not on any
other refusal by the mediator (it maps as §5 says), not on a
mediator status or problem-report frame that refuses no deposit
(consumed, §5), not on an offline signal. An answer of one
deposit settles that deposit only: a relationship in which routed
deposits were answered before switches by the same rule when a
later one goes unanswered. A successor applies the reports the
holder hands it before it checks the deadline. The switch is one-way
for the relationship: nothing returns it to `routed` but a new
principal — a new relationship, a rebind or a change of `C` (§6) —
or a lost send state (a host that persists nothing), each of which
starts in `routed`; at the switch the open
routed deposits leave the send state, and a routed attempt accepted
after the switch enters none. An open routed deposit also leaves the
send state once `routed-ack-deadline` plus `duplicate-window` has
passed since its acceptance, so the send state stays bounded where
no check could run (RLTP-VTI-7150).

**RLTP-VTI-3135** — Every attempt to deposit a submission in the
holder's custody is a hand-over through the holder (RLTP-DEL-6125),
a retry included. From the switch on, every hand-over uses the new
mode; an attempt begun before the switch ends in the mode it began
in. A submission still in the holder's custody (no report yet, or
`awaiting-transport`) goes in the new mode at its next hand-over
through the holder (RLTP-DEL-6125). A submission already `accepted`
is not deposited again (RLTP-VTI-7130): it ends `delivered` or
`failed` at the give-up horizon as §6.1 states, unless it is `held`
(RLTP-VTI-5050), which no horizon ends; resubmission after a failure is
the application's recourse.

**RLTP-VTI-3140** — The receiving side needs no mode. In both modes
what reaches its connection DID's session is the inner `direct`
message: in mode `routed` the mediator opens the routing layer and
passes the inner message on unchanged. A receiving binding delivers
only a TSP 1.0 `direct` message with a non-empty payload from the
counterpart's connection DID to its own connection DID (§7), and the
adapter reads its payload under RLTP-VTI-7160.

The signal is honest about what it cannot tell apart: a missing
acknowledgement is also what a counterpart produces that stays
offline, or what this side produces when it stays closed and the
acknowledgement waits in its own queue, so a relationship can switch
without need. The deadline equals the give-up horizon for that
reason: a switch caused by absence is the more frequent error than a
mediator that accepts routed messages and does not deliver them, and
at 72 hours a document that has gone unacknowledged has already
failed at its own horizon. A needless switch is conforming — both
modes satisfy §1a — and costs nothing beyond the form: mode `direct`
runs on the same session and shows the mediator no identifier mode
`routed` does not (§9). The other side of the trade is a relationship
whose documents fail at the give-up horizon until the switch; what was
accepted in mode `routed` before the switch on such a mediator fails
at its horizon (§10), the switch carries what follows it. A mediator
that refuses routed deposits with a validated refusal of the routed
form switches the relationship at once; one that refuses them in any
other way produces no acceptance and no switch, and the documents fail
as `unroutable` (§5).

## 3b. The carried document

A deposit carries no bare sealed envelope. It carries a Trust Task
document of the type `sealed-envelope/0.1` (Delivery §4.6) whose
payload is the sealed envelope, framed as the registry's TSP binding
frames every Trust Task document. A consumer of that binding reads the
document's `type` without opening the seal, and refuses or answers it
by the framework's rules; the counterpart's adapter takes the seal out
and hands it to its holder.

**RLTP-VTI-3150** — The payload of every inner message this side
deposits is the JCS serialization of the binding envelope
`{ "type": "https://trusttasks.org/binding/tsp/0.1/envelope",
"document": D }` (TSP binding §2), where `D` is the
`sealed-envelope/0.1` document of Delivery §4.6 with `issuer` this
side's connection DID, `recipient` the counterpart's connection DID
(RLTP-VTI-1240), `payload` the sealed envelope the holder handed over,
and `issuedAt` the instant of that envelope's first submission as the
holder recorded it (its `since`; for an acknowledgement, the commit of
its effect). The adapter builds `D` at every attempt from these four
values and from nothing else, so every attempt of one sealed envelope
toward one counterpart carries byte-identical payload (Delivery
RLTP-DEL-5040) and the same `id` (RLTP-VTI-5040).

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
construction; the send state of §3a (mode, in mode `direct`
the instant of a refusal of direct delivery, open routed deposits)
travels in the same snapshot, and an
instant in it after the restore instant is refused like a
conclusion instant, as is a refusal of direct delivery in a send state
whose mode is `routed`. The snapshot invariant — every pending intent names
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
never outlive the window. The adapter
absorbs a byte-identical arrival only within `give-up-horizon` of its
conclusion; a later one, inside the window or beyond it, is a new
item, with the exceptions listed below, and the receiver's §6.2
absorption owns it, answering it with the stored acknowledgement
(RLTP-DEL-6330, RLTP-DEL-6335). That is how a counterpart that
resubmits after a lost acknowledgement is answered; a resubmission
that arrives sooner than `give-up-horizon` after this side's
conclusion is still absorbed here and acknowledged only toward the
mediator. One boundary precision: a wire call cannot be
recalled, so **the window closes for an id no earlier than the end
of an acknowledgement call already carrying it on the wire** — the
stay of expiry begins at the wire call itself, never earlier (a
hanging authentication extends no window; ids whose entry already
fell are not sent at all), it covers absorption too, and the
account is settled the moment the call returns.

The exceptions, a closed list, all at one price — the
counterpart's resubmission goes unanswered, and no document is lost,
because the holder concluded it:

1. the later copy arrives while an acknowledgement carrying its id
   is on the wire: it is absorbed (the stay of expiry above);
2. the intent was already sent before the later copy arrived: that
   acknowledgement can delete the copy at the mediator before the
   holder sees it;
3. after a restart only the buffer is gone: a restored intent can
   delete the copy at the mediator if it is sent before the mediator
   offers the copy again.

**The teardown edge, priced honestly.** An acknowledgement still
flying at `close()` cannot be carried by the snapshot; a restored
successor retries a persisted intent until it lands or the window
closes. Two regimes, both closed:

- **Inside the window, a deletion by any of these calls removes
  a copy of a document the holder already concluded.** Within
  `give-up-horizon` of the conclusion this profile's own duplicate
  rule (§2) would have absorbed it without surfacing it, and the
  holder observes the same thing either way. Later, the deleted copy
  is one the holder would have absorbed and answered again; the
  counterpart's next resubmission is answered instead. Retried
  acknowledgements therefore lose no document, however many times a
  lost response makes them retry; at most they leave a resubmission
  unanswered.
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
carries the duty to pass received bytes unchanged.

## 5. Sender states and refusal mapping

Trias per §6.1 with the closed sets, `accepted` with its closed
feature `held` (Delivery §6.1). Additionally the port carries the
**receiver refusal channel**: a validated refusal of a counterpart
fails the submission as `failed(rejected-by-receiver(<code>))`. A
counterpart answers a carried document (§3b) with a framework
document in the same binding: it refuses with the registry's
`trust-task-error`, of a version RLTP-VTI-5015 reads, and it names
what it expects before it can proceed with `trust-task-next-step/0.1`. The adapter reads such an
answer from the payload that carries it (RLTP-VTI-7160), binds it to
the submission it answers (RLTP-VTI-5040) and applies it; a host that
reads an answer itself reports it to the adapter through the same
channel, under the same rules.

**RLTP-VTI-5010** — A reader of a refusal MUST read it by the
`retryable` member the error document carries, never by the default
of its code. `retryable: false` is a **terminal verdict** and enters
the refusal channel with its code; `retryable: true` produces **no
port transition at all** — it is an availability condition of the
counterpart's infrastructure, the adapter retries under its
own schedule, and a submission that already entered the trias keeps
its trias state (§6.1: pre-transport reports end at trias entry —
nothing moves `accepted` back). A `retryAfter` is the lower bound of
the document's next attempt: no attempt starts before it. The bound
is capped by the give-up horizon (§2): a `retryAfter` beyond it is
never waited for, and the submission ends at the horizon. An accepted
submission makes no further attempt from this side (Delivery §6.1),
so a `retryAfter` binds nothing there. The bound holds for the
adapter instance that took it, until the next opening: it is not
part of the persisted ack state (§4), since a counterpart's hint is a
SHOULD of the registry and a new opening may try again.

The reading of an error document is by its form: a `type` of a
version RLTP-VTI-5015 reads, a payload with exactly the members of
that version's registry schema, a standard code of that version or an
extended `code`, a
boolean `retryable`, a `message` of at most 1024 code points (the
registry schema's `maxLength`, which counts code points, never UTF-16
units), an RFC 3339 `retryAfter` (either case of `T`
and `Z`, a leap second read as the next second, any offset), and a
`proof`, where present, that verifies as for a next step
(RLTP-VTI-5050); anything else is no refusal and changes nothing. TSP
authenticates the sender of every answer alike, so a proof adds no
authenticity here; it is held to what it claims so that the two kinds
of answer are read by one rule.

**RLTP-VTI-5015** — A reader reads the versions of the registry's
`trust-task-error` whose declared extension chain (TT §5.2, the
`extends` front-matter field) reaches 0.5, and of those only the
versions it knows: in this casting
`https://trusttasks.org/spec/trust-task-error/0.5` and
`https://trusttasks.org/spec/trust-task-error/0.6`, which declares
`extends: "0.5"` and adds the standard codes `unsupportedExtension`
and `indeterminate`. Each is read by its own registry schema under
RLTP-VTI-5010 and mapped under RLTP-VTI-5020 and 5030; a code is read
the same in every version that has it. An implementation MAY read a
later version without a new casting of this profile once the
registry publishes it with an extension chain reaching 0.5: a member
its schema adds is ignored, and a standard code it adds is read as
an extended code is (RLTP-VTI-5020) until a casting names it. A
document of any other version — an earlier one, a later one not
known to reach 0.5, another `MAJOR` — is no refusal and changes
nothing.

*Rationale.* The framework asks a consumer to accept a later version
whose `extends` chain reaches the one it implements and to apply no
forward minor-version processing to a `draft` specification without
that declaration (TT §5.2); the registry's own libraries do the same
from an index of declared extensions that each release carries. A
reader here cannot learn a declaration at runtime (schemas and
registry entries are pre-registered, never resolved), so it reads the
versions it knows to extend 0.5, as those libraries do, and a new
code it does not know falls to `taskFailed`, as TT §8.5 has a
consumer treat an extended code it does not recognize. Nothing here
is particular to RLTP: the reading is the framework's, and the codes
keep the meaning the registry gives them.

**RLTP-VTI-5020** — The codes of a terminal verdict are the
standard codes `malformedRequest`, `unsupportedType`,
`unsupportedVersion`, `unsupportedExtension`, `proofRequired`,
`proofInvalid`, `permissionDenied`, `wrongRecipient`,
`identityMismatch`, `cancelled` and `taskFailed`; an extended code
`<slug>:<name>` MUST be read as `taskFailed`, with the `retryable` it
carries. `unavailable`, `internalError` and `indeterminate` with
`retryable: false` are read as `taskFailed`; with `retryable: true`,
their default, they are an availability condition under
RLTP-VTI-5010 and move nothing. `indeterminate` says the counterpart
could not decide (TT §8.3): it is never read as a refusal of the
document or a verdict on it, and a reader MUST NOT report it as
`proofInvalid` or `permissionDenied`. `expired` has no port
equivalent (recorded divergence).

**RLTP-VTI-5030** — `idConflict` MUST be read as the absorption of
Delivery §6.2 and as an answer (RLTP-VTI-3130), never as a failure.
This is a named divergence: `trust-task-error` (0.5 and 0.6) and TT
§7.2 item 11 make it a refusal of an equal `id` over different bytes,
while the Delivery Contract deduplicates by document digest (its
DO-10; Open Issue 13). The carried document of §3b declares its
repeated execution safe and intended (Delivery §4.6), so a consumer
that follows the framework answers a repeated attempt of it, which is
byte-identical (RLTP-VTI-3150), as a duplicate and never as
`idConflict`.

**RLTP-VTI-5040** — An answer — an error document read under
RLTP-VTI-5010 to 5030, or a next step read under RLTP-VTI-5050 —
answers the submission of this instance whose carried document's `id`
(RLTP-VTI-3150) equals the answer's `payload.inResponseTo.id`, or,
where the payload names no `inResponseTo.id`, equals the answer's
`threadId`. It is bound only if, besides: the frame that carried it
came from the counterpart's connection DID (RLTP-VTI-7140), the
`recipient` of that carried document; the answer's `issuer`, where
present, is that connection DID; its `recipient`, where present, is
this side's connection DID; and its `inResponseTo.typeUri`, where
present, is exactly the Type URI of `sealed-envelope/0.1`. A bound
answer is the validated answer of RLTP-VTI-3130 and §6.1 for that
submission. The submissions of an instance include those it files for
binding under RLTP-VTI-5065, also one the holder has ended since it was
filed in this opening: an answer bound to it reaches the holder, which
keeps the end it recorded (§6.1). Whether a bound answer may change the
submission is RLTP-VTI-5070's; when it is acknowledged, RLTP-VTI-5080's.
An answer that binds no submission of this instance — none matches, a
check fails, or the document was terminal at the holder before this
opening and so never offered (Open Issue 16) — changes nothing: it is
logged and acknowledged. An answer bound to a carried acknowledgement
changes nothing either: an acknowledgement has no trias (Delivery
§6.1), and it ends as its own rules state.

**RLTP-VTI-5050** — A next step is read by its form: `type` exactly
`https://trusttasks.org/spec/trust-task-next-step/0.1`; a payload with
no members but the registry schema's, among them `expects`, a list of
at least one object with no members but `typeUri`, a non-empty
string, `reason`, a string of at most 1024 code points, and `hint`,
an object; `continuation`, where present, `resubmit` or `proceed`;
`inResponseTo`, where present, an object with no members but a
non-empty string `typeUri` and a non-empty string `id`, the latter
optional; `message`, where present, a string of at most 1024 code
points; `ext`, where present, an object. A `proof`, where present,
MUST verify as an `eddsa-jcs-2022` Data Integrity proof under the
`did:key` the document's `issuer` names; a document whose proof does
not, or that carries a proof and no `issuer`, is no next step.
Anything else is no next step and changes nothing. `expects` is read
and never followed: the adapter starts no task a next step names (a
consumer that declines to continue simply stops).

A bound next step is the counterpart's statement that the document
arrived and waits there for something it names. It moves a
submission in any **non-terminal** state — the report-less phase,
awaiting, and accepted alike — to `accepted` with the feature `held`,
and answers its open routed deposit (RLTP-VTI-3130); on a terminal
state it changes nothing, and a later next step for a submission
already `held` changes nothing. A `held` submission is not ended at the
give-up horizon (§2): it ends `delivered` on a valid acknowledgement,
or `failed(rejected-by-receiver(<code>))` on a validated terminal
refusal, and in no other way (Delivery §6.1).

**RLTP-VTI-5060** — An answer is a framework document, not an RLTP
document: its timestamps follow the framework (TT §4.2, §8.2), not the
timestamp form of the RLTP document profile (Encounter RLTP-ENC-2150
and its reading rule). A reader MUST accept as an answer's `issuedAt`
and `retryAfter` every RFC 3339 date-time — any number of
fractional-second digits, `Z` or a numeric offset, either case of `T`
and `Z`, a leap second read as the next second — and MUST NOT refuse an
answer for the precision or the offset of either. An `issuedAt` that is
present and is no RFC 3339 date-time makes the document no answer. The
reader evaluates `issuedAt` for its form only: answers carry no
acceptance window here.

The answers of a counterpart follow one contract, whatever the state of
the opening in which they arrive: every open document can be found
(RLTP-VTI-5065), only the counterpart can change it (RLTP-VTI-5070), and
an answer leaves the mediator only after its outcome is kept
(RLTP-VTI-5080).

**RLTP-VTI-5065** — Every open document of the holder has the `id` of
its carried document in the instance, independent of sending: each
entry of the holder's custody (RLTP-VTI-6110) and each accepted document
the holder offers for binding (Delivery RLTP-DEL-6150) is filed, and its
`id` computed from the sealed envelope and the two connection DIDs
(Delivery RLTP-DEL-4620) as it was when the document travelled — whether
or not an attempt runs, the wire is offline, or the document was
deposited in an earlier opening and its acceptance never recorded.
Custody decides only whether a document may be deposited, never whether
an answer can find it. An answer is decided only against these `id`s:
one that arrives before the instance has filed the holder's view (its
first `reconcile`, or its first submission where the host submits
without the holder's view), while an `id` is still being computed, or
while the counterpart's connection DID is unknown to the wire, is held
in memory and not acknowledged until then. Held answers, and bound
answers not yet concluded, count together toward `queue-floor` (§2), by
number and by bytes; an answer beyond it is not taken and stays with the
mediator. A document filed
for binding only is in the state the holder records — `accepted`,
`held` where the holder marks it — and is never attempted or deposited;
no horizon of this instance ends it (it ends as §6.1 and Delivery
RLTP-DEL-6140 state: at the holder's horizon unless `held`), it opens no
routed deposit, and a later view that no longer offers it withdraws
nothing; an answer bound to it answers its open routed deposit
(RLTP-VTI-3130).

**RLTP-VTI-5070** — An answer changes a submission only if its sender,
as TSP authenticated it (RLTP-VTI-7140), is the counterpart's connection
DID that the submission's carried document named as `recipient`. The
adapter checks this at the transition itself; the binding's filter of
RLTP-VTI-7140 is a second guard, not the guard. An answer from any other
sender, its `id` and `threadId` correct or not, changes nothing: it is
logged and acknowledged.

**RLTP-VTI-5080** — An answer that changes a document of the holder
travels in the next collection beside its items, with the report its
outcome makes (§3, `collect`). The host records that report at the
holder before it concludes the collection, and the adapter acknowledges
the answer at the mediator only at that conclusion; a `keep` returns it
to the next collection. Every other answer — one that binds nothing,
changes nothing, or concerns a submission without a holder entry — is
acknowledged at the adapter's next step. Where the instance or the host
ends at any point before the conclusion, the answer stays at the
mediator and arrives again, is bound again under RLTP-VTI-5065 and its
report recorded again; the holder's report is idempotent (Delivery
§6.1), so no outcome is lost and none takes effect twice. The send
state's part of an answer — that it answers an open routed deposit
(RLTP-VTI-3130) — is as durable as the host's snapshot of the ack state:
the host persists the ack state after the conclusion, and a successor
restored from an earlier snapshot learns the outcomes the holder
recorded through the holder's answers for earlier deposits.

*Rationale.* A counterpart answers when it answers: a next step now, a
refusal hours later, typically in another opening of a device that
opens for minutes, and possibly before the opening knows what it sent.
Binding by an `id` that the holder's own records determine, checking the
sender at the transition, and acknowledging only what is kept make the
outcome independent of the order of the host's calls, of the network,
and of where a process ends. The `id` needs no new state: it is a
function of what the holder keeps until the document is terminal.

A validated
refusal acts on every **non-terminal** state — the report-less
phase, awaiting, and accepted alike — because the validated
refusal is itself the proof that the counterpart received the
envelope (the mediator can accept and forward while the
depositor's own call is still unresolved), and the attempt's
later resolution never displaces it. Terminal states stand: §6.1
knows exactly one late correction of a terminal state — the valid
acknowledgement — and this profile adds no second. The refusal channel carries **terminal verdicts only**: a refusal
with `retryable: true` is an availability condition of the transport,
not a receiver verdict — it never enters `receiverRefused` (the
runtime refuses it fail-closed), and the submission simply remains
governed by the adapter clock like any other transport outcome. A validated
refusal acts on a `held` submission like on any `accepted` one.

Transport conditions map as follows: 401/403/ACL →
retriable, persistent → `failed(unroutable)` at the horizon; 413 →
`failed(oversize)`; upgrade drop/timeout/DNS →
`awaiting-transport(transport-unreachable)`; 429/5xx →
`awaiting-transport(carrier-refused-retriable)`;
a refusal of direct delivery in mode `direct` →
`awaiting-transport(carrier-refused-retriable)` for every submission
of the relationship from then on, recorded in the send state, no
further deposit (RLTP-VTI-3120), `failed(expired-by-adapter-policy)`
at the horizon;
`duplicate-channel` → re-establish, no port event; mediator
status frames, and problem-report frames that refuse no deposit →
consumed, never acked, never items; a problem-report frame that
refuses a deposit is a refusal of that deposit and maps as below;
any other refusal of a deposit → retriable, persistent →
`failed(unroutable)` at the horizon. A refusal of a routed deposit maps like any other deposit refusal
above, with one exception: a validated refusal of the routed form
switches the relationship at once and leaves the submission
`awaiting-transport` (RLTP-VTI-3130).

## 6. Lifecycle coupling (§5a.10, applied)

Change of the direct carrier = change of `C` = new principal, new
adapter instance, new connection DID; the old one is retired, never
re-pointed. Changes beyond the direct carrier change nothing. A rebind
is likewise a new instance. A relationship that the continuity machinery
chains into another is closed at the chaining and gets no successor; the
chain is carried by the instance of its first contact (RLTP-VTI-1230).
The documents of the closed instance that are still in the holder's
custody are taken over by the chain's instance as under RLTP-VTI-6110
and RLTP-VTI-6120, and the appended tuple's `rkid` maps to the chain's
connection DIDs. A displayed card's instance (§1c) is built at the
display, before any relationship; it becomes the instance of the
relationship its card's record opens (RLTP-VTI-1260) without a takeover,
is closed at that record when the counterpart names no connection DID at `C`
(RLTP-VTI-1235), or is closed when the card's challenge ages
(RLTP-VTI-1270). Bound in a re-encounter that the continuity machinery
chains, it is closed at the chaining like any instance of the later
enactment's relationship (RLTP-VTI-1230). There is no wind-up here to
run: the adapter holds no bindings — what it holds at teardown is its
ack state (§4, the host persists it) and its submissions. **A close with
live submissions ends their reporting** — a retired instance has no
clock, so it does not pretend to fail them at a horizon it no longer
drives. A document not yet accepted is still in the holder's custody
(RLTP-DEL-6120); an accepted one left it at acceptance, and the holder
ends it as §6.1 does: `delivered` on a valid acknowledgement, `failed`
at its horizon otherwise, unless it is `held`, which only an
acknowledgement or a validated terminal refusal ends (RLTP-VTI-5050,
Delivery RLTP-DEL-6140). The retired instance's copies were volatile
and authorize nothing after its close.

**RLTP-VTI-6110** — A successor instance takes documents over only
through the holder's custody view of an active opening — the
entries the holder offers for transport (RLTP-DEL-6120), at any
point while that opening is active (RLTP-DEL-6125, RLTP-DEL-6130). A copy, list or snapshot
that the retired instance or the host took before the lock or the
close authorizes no submission.

**RLTP-VTI-6120** — A successor instance's give-up horizon for a
document runs from the document's first submission as the sender
recorded it, never from the takeover (RLTP-DEL-6130). The successor
resumes the send state the host restores to it (RLTP-VTI-3130).

This profile refuses to promise more than a retired instance can
keep. The boundary is realized in code:
`close()` retires the instance — subsequent port operations
refuse, a late-resolving wire mutates nothing, and the ack state
remains readable for the host's final persist; the one change it still
takes is a refusal of direct delivery the binding received
(RLTP-VTI-3120), recorded when the host reads the ack state. Beside the port
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
TSP framing in the sending form of §3a under **TSP 1.0** (version
`YTSP-BAA`; HPKE-Base only, no sealed box; the sender's VID in every
confidential payload; TSP 1.0 has no HPKE-Auth), the CESR demux discipline of the measured binding (one message type per
frame, dispatched on its CESR code), the duty to pass raw received
bytes unchanged, the authenticated sender VID of every payload it
delivers, a signal from the moment it receives a refusal of direct
delivery that stays set for the binding's life and that the adapter
reads (RLTP-VTI-3120), and the rules below. On receipt, this profile reads
TSP's versioning (a major version MAY break backward compatibility) as:
TSP 1.0 is major version 1 with any minor version; a 1.x message the
binding cannot read fails a receiver check (RLTP-VTI-7140).

**RLTP-VTI-7110** — The adapter's copy of a submission is the
sealed RLTP envelope, never a TSP frame and never the carried
document. The adapter builds the binding envelope of RLTP-VTI-3150 at
every attempt; the binding packs every layer its mode requires
(RLTP-VTI-3110, 3120) around it anew for every attempt, with the keys resolved for the
session that attempt uses, as a TSP 1.0 message that carries its
sender's VID in the confidential payload; a frame sealed to a key the
mediator no longer names is never deposited again.

**RLTP-VTI-7120** — The direct TSP peer of every outer layer is `C`
itself (RLTP-VTI-3110). This profile does not serve a mediator whose
TSP VID differs from its configured DID, nor a change of that VID
under an unchanged `C`: the connection DID is derived from (root,
`C`, `N`), so the fresh outer VID Delivery §5a.10 asks for in that
case cannot be established (Appendix A). Routed deposits addressed
to `C` then reach no one; they fail at the give-up horizon, and the
switch of RLTP-VTI-3130 may carry what follows, since mode
`direct` seals nothing to `C`, if the connection DID's
authentication at `C` still succeeds. What can change under an unchanged
`C` is the key `C`'s DID document names first under `keyAgreement`
(a key change of `C`). The binding resolves that key at
every authentication and every token renewal of the connection DID's
session, and the adapter renews at the latest when its access token
expires, so a change is seen no later than then. The token lifetime
is the mediator's; this profile declares no bound on it, and the
window in which frames go to a retired key is as long as the
mediator makes it. Every outer layer
packed after that is sealed to the new key. A submission still in
the holder's custody is packed for the new key at its next
hand-over; one already accepted under the old key is not deposited
again (RLTP-VTI-7130) and ends as §6.1 states. In mode
`direct` no layer is sealed to `C`, and a key change of `C` changes
nothing but the session.

**RLTP-VTI-7130** — Neither the switch of RLTP-VTI-3130 nor a
key change of `C` makes the adapter deposit anything the holder does not
hand over. The holder's custody ends at acceptance (RLTP-DEL-6120),
and the absence of an accepted document from what the holder offers
is no leave to deposit it again (RLTP-DEL-6135); the adapter's copies
are the bytes of the hand-over they came from and authorize nothing
beyond it.

**RLTP-VTI-7140** — On receipt the binding delivers to the adapter only
a TSP 1.0 `direct` message with a non-empty payload whose sender, in
the envelope and in the confidential payload alike, is the
counterpart's connection DID and whose receiver is this side's
connection DID, and delivers its payload bytes unchanged together with
that sender VID, as TSP authenticated it. The one
exception is a displayed card's instance before it is bound, which knows
no counterpart: it takes such a message from any sender, under
RLTP-VTI-1255 and 1265. Control messages, padding, routed and nested
messages, and empty `direct` messages are logged with their type and
sender VID and acknowledged, never delivered. A message that fails a
receiver check of TSP 1.0 — among them a sender VID in the confidential
payload other than the envelope's, or the NULL VID there — is logged
with its envelope sender and acknowledged, never delivered. A message
of another major version is logged with the version it declares and
acknowledged, never delivered; TSP has no version negotiation.

**RLTP-VTI-7160** — The adapter reads a delivered payload, together
with its authenticated sender VID, before anything else touches it:

1. a payload larger than `payload-bound` (§2) is not parsed;
2. the payload MUST parse as a JSON object whose `type` is exactly
   `https://trusttasks.org/binding/tsp/0.1/envelope` and whose
   `document` is a JSON object (TSP binding §2);
3. a `document` of the type `sealed-envelope/0.1` is the carried
   document of §3b. It MUST satisfy the document profile and the type's
   rules (Delivery §3, §4.6), its `issuer` MUST be the sender VID and
   its `recipient` this side's connection DID, exactly as strings (TSP
   binding §3); its payload, the sealed envelope, then becomes an item
   for the holder (§3, `collect`), whose receive alone opens it
   (Delivery §6.2);
4. a `document` of the type `trust-task-error`, of a version
   RLTP-VTI-5015 reads, or `trust-task-next-step/0.1` is an answer,
   read under §5 and bound under RLTP-VTI-5040; it never reaches the
   holder;
5. every other payload — a document of another type, a carried
   document that fails a check of item 3, a payload that fails item 1
   or 2, a sealed envelope sent as the payload itself — is logged with
   the sender VID and the reason and acknowledged, never delivered.

What item 5 consumes, the adapter concludes itself (§3); an answer of
item 4 is concluded as RLTP-VTI-5080 states; the holder receives only
what item 3 hands it.

**RLTP-VTI-7150** — The binding states whether the mediator holds
nothing more for the connection DID, from the pickup protocol's
status or from an approximation it names that errs toward
"something is pending", never toward "nothing is pending". The check of RLTP-VTI-3130
runs only on that statement: a binding that cannot make it never
lets the deadline switch happen, and an implementation that uses
such a binding states so in its conformance notes. The immediate switch on a validated
refusal of the routed form needs no such statement.

Of the §5a.10 vector debt (Delivery §11), this profile discharges
what is decidable **here**: the identity derivations are
deterministic and vector-tested (fixed inputs → byte-exact
principal and connection DID, distinct, prefix-separated), the
addressing of both sending modes is vector-tested
(`vectors/vti-routed-addressing.json`: inner and outer sender,
receiver, route list and session per mode, the addressings §1a and §3a
refuse, and the messages RLTP-VTI-7140 refuses on receipt), the
delivery hint is vector-tested (`vectors/vti-delivery-hints.json`:
each side's hint from the derived identity, its length, a displayed
card and the sent card answering it, each carrying its side's hint
under its proof, a card whose hint exceeds 512 characters, the hints a
receiver ignores, a hint with a fourth member `rltpEgress`, and
what a receiver reads from a card's hint list), the carried document
is vector-tested (`vectors/vti-sealed-envelope.json`: the binding
envelope byte for byte in both modes, its deterministic `id`, a
repeated attempt byte-identical, the payloads RLTP-VTI-7160 refuses
with the item that refuses them, and the answers of §5 with the
submission state each leaves), and the adapter obligations of this
contract are exercised against the wire double. The byte form
of a routed frame is the TSP library's and is not vectored here.
What genuinely needs a carrier **interface** — proof-gated
registration vectors, generation and tombstone cases — remains
with the first RLTP-carrier service, which is the first place it
is decidable.

## 8. Security Considerations

- **Identity coupling is constructive.** The factory derives
  principal and connection DID from one (root, `C`, `N`),
  snapshotted at entry; caller-supplied
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
  bound ends in a §6.1 report, except for a `held` submission, which
  no bound ends (RLTP-VTI-5050): the counterpart said it has the
  document, and its acknowledgement or refusal ends it (the item on
  answers below states what that leaves to the counterpart); the teardown
  paragraph (§6) states the one case where reporting ends, and leaves
  the document with the holder, who ends it under §6.1. There is no path on which an envelope is
  dropped without either a report or a mediator-retained copy.

- **The fallback is not a downgrade of what the mediator
  learns.** A mediator can force the switch of §3a by dropping
  routed frames. In mode `direct` it reads the same identifiers on the
  same session as in mode `routed` (§9); the counterpart sees the same
  sender in both modes.
- **The switch can be forced.** The mediator can drop routed
  frames, or deliver them and suppress the acknowledgements; the
  counterpart can withhold its acknowledgements for the deadline;
  the mediator can refuse the routed form, which switches at once —
  the validation of a refusal guards only against parties other
  than the mediator. Each leaves an open routed deposit past the
  deadline, or switches at once. Either way the result is the
  fallback bullet above, made permanent for the relationship
  (RLTP-VTI-3130).
- **Replayed inner messages are absorbed.** The mediator can
  deliver an inner message again; the receiver's §6.2 absorption
  makes the copy a duplicate with no second effect on the
  document; a copy the adapter hands to the holder after
  `give-up-horizon` (§2) is answered again with the stored
  acknowledgement, and nothing more.
- **A hint binds through the card's proof alone.** The connection
  DID does not sign the hint, so a card's author can name an identity
  that is not its own, for instance a connection DID read off someone
  else's displayed card. A hint naming the reader's own connection DID
  is ignored (RLTP-VTI-1227), so the author cannot point the
  counterpart at itself. What remains steers only the counterpart's
  documents of this one relationship: they go to the named account.
  Its holder receives frames it cannot open: the inner message is
  sealed to the named connection DID's key, but the RLTP envelope
  inside stays sealed to the author's `rkid`. The account bears the
  load: its adapter's buffering is bounded by §2, the mediator's queue
  and the deposit rate are the mediator's own limits (§2, the honest
  limit), and the mediator sees a pairing of the counterpart's
  connection DID with that account that no relationship holds (§9).
  The counterpart's binding accepts inner messages only from the named
  connection DID (RLTP-VTI-7140), so the author's own deposits are
  refused: the relationship runs in neither direction over this
  carrier, and the damage stays with the relationship the author leads
  itself; the load also falls on the holder of the named account. A
  signature of the hint by the connection DID would prove possession;
  it is Open Issue 11.
- **Who learns a displayed card's hint can deposit.** The displayed
  card shows the displaying side's connection DID to everyone who sees
  it (§9). A party other than the counterpart can deposit frames to
  that account at the mediator. Once the instance is bound, the
  binding refuses each (RLTP-VTI-7140), logs and acknowledges it, and
  the documents it carried have no effect; before, the wire binding
  hands it every `direct` frame from any sender, an envelope not
  sealed to the card's key is discarded before the holder sees it, an
  envelope sealed to it that carries no bundle the holder takes is
  discarded with no effect (RLTP-VTI-1255, 1265), and only a record of
  the card's challenge binds the instance, to the connection DID of the
  sent card's hint (RLTP-VTI-1260; the next item). The cost is load:
  the receiving adapter's buffering is bounded by §2; the mediator's
  queue and the deposit rate are the mediator's own limits, which this
  profile does not bind (§2, the honest limit).
- **A displayed card's instance takes frames from anyone, and binds
  through the card alone.** Before it is bound, the instance cannot
  refuse a `direct` frame by its sender (RLTP-VTI-1255): everyone who
  saw the card can deposit to its connection DID. A frame whose
  envelope is not sealed to the card's key costs a TSP opening, a
  parse and an acknowledgement, and never reaches the holder
  (RLTP-VTI-1255): a valid document of another relationship of the
  same holder, deposited to the card's connection DID, is discarded
  before the holder could commit it. A frame sealed to the card's key
  that carries no bundle on this card costs, beyond that, a receive
  the holder refuses; the adapter's buffering is bounded by §2, and
  the mediator's queue and deposit rate are its own limits. A flood of
  such frames can hold the bundle back beyond the challenge's age; the
  network leg then fails and the optical leg remains (Encounter §5.8,
  RLTP-ENC-5690). What bounds the flood is the mediator's rate and the
  challenge's age, not this profile. The binding is no trust on first
  use: the counterpart's connection DID comes from the sent card, signed
  under the counterpart's fresh pair anchor and bound to the card's
  challenge (Encounter RLTP-ENC-6050, RLTP-ENC-6060), never from the
  sender of a frame (RLTP-VTI-1260); the sender changes nothing in it
  (RLTP-VTI-1255). A third party cannot pass the counterpart's payload
  on under its own sender unchanged: the inner message is sealed to the
  card's connection DID and signed by the counterpart's connection DID,
  and the carried document names that connection DID as its `issuer`,
  which RLTP-VTI-7160 holds against the sender. A differing sender is
  in practice the counterpart's own other connection DID (a second
  `N`, RLTP-VTI-1245) or a party the counterpart gave the sealed
  envelope to, which carries it in a document of its own; the case
  stays defined.
- **Several scanners of one displayed card.** The first record binds
  the instance (RLTP-VTI-1260); of bundles, the first the holder
  takes; a bundle of another scanner is refused by the holder or by
  RLTP-VTI-7140 (RLTP-VTI-1265). The second scanner recorded its
  relationship at its scan; that relationship reaches no one over this
  carrier, and its documents fail at its give-up horizon (Open Issue
  8). With RLTP-VTI-1250 the challenge race (Encounter §13) also runs
  from afar over this carrier: whoever saw the card, a photograph of a
  projected card included, can answer first with a bundle of its own,
  and the scanner present sees only that nothing is delivered. The
  protection is the human check at confirmation (Encounter §13, C4),
  not this profile.
- **A session per displayed card.** Every displayed card holds an
  authenticated session and a socket at the mediator from the display
  until a record binds or closes it, or its challenge ages
  (RLTP-VTI-1250, 1260, 1270): a rotation of the displayed card adds
  one per card still open. A card that is never answered over this
  carrier leaves a session that collected nothing. The bound is the
  challenge's age bound; this profile declares no constant of its own
  for it.
- **Foreign inner messages fail at the receiver.** The mediator
  opens the routing layer and could pass on an inner message of
  its own choosing. An inner message is sealed to the
  counterpart's connection key and signed by this side's connection
  DID; the receiving binding delivers only the expected pair
  (RLTP-VTI-7140), so a substituted or forged inner message is
  refused before the adapter and has no effect. A mediator that
  ignores the route list, or delivers late or not at all, is a
  carrier that loses a document: the give-up horizon covers it.
- **The carried document is authenticated by TSP alone.** It carries
  no proof (Delivery §4.6): TSP authenticates its sender end to end,
  and the adapter holds the document's `issuer` and `recipient` against
  the authenticated sender and its own connection DID (RLTP-VTI-7160).
  A document whose parties differ is never delivered, so a party that
  holds a sealed envelope of someone else cannot make it arrive under
  that someone's name; it can carry it under its own, where the
  holder's receive and the inner document's own proofs decide
  (Delivery §6.2). The seal is unchanged by the carriage: the
  carried document adds no member the receive reads.
- **Answers bind to this side's own documents.** An answer changes a
  submission only when it comes from the counterpart's connection DID
  and names the `id` of a document this instance carried to it
  (RLTP-VTI-5040). The `id` is not secret — it is a function of the
  seal and the parties, and the counterpart reads it — but only the
  counterpart can send under its connection DID, and the adapter holds
  the sender against the document's recipient at the transition
  (RLTP-VTI-5070), so a third party, the mediator included, cannot
  refuse, hold or answer a document of this side, whatever the wire lets
  through. An answer leaves the mediator only after its outcome is kept
  at the holder (RLTP-VTI-5080), so a crash loses no outcome there; the
  send state learns it again from the holder (RLTP-VTI-3130). The counterpart can: a refusal ends a submission, and a
  next step keeps it from failing at the horizon (RLTP-VTI-5050), so a
  counterpart that sends a next step and never acknowledges keeps a
  submission `accepted` (`held`) for as long as it likes. That is a
  statement the counterpart makes about its own state, and the
  holder shows it as such; the document was in its hands. A
  retryable answer — `unavailable`, `indeterminate` — gives it no
  more than silence would: the submission keeps its state and ends
  at the horizon (RLTP-VTI-5010).

## 9. Privacy Considerations

- **What the mediator learns.** In mode `routed`, from one frame:
  the sender's connection DID (outer sender, and inner sender once the
  routing layer is open) and the counterpart's connection DID (route
  list and inner receiver); besides these, timing, sizes (the routing
  layer adds about 400 bytes per frame, the binding envelope and the
  carried document about 400 bytes more inside the inner message) and
  frequency. Over both directions it holds both connection DIDs of one
  relationship. In mode `direct` it learns the same identifiers on the
  same session. It never reads the carried document: the inner message
  is sealed to the counterpart. An operator's undertaking not to store
  forwarded frames is not a guarantee this profile can rely on; it
  assumes the mediator keeps what it sees.
- **What the counterpart learns.** The connection DID as the sender
  of every document and as this side's address; it appears in no
  other relationship. The sender VID that TSP 1.0 carries in every
  confidential payload is the envelope's sender again, in each layer
  of either mode: it shows the counterpart, and the mediator in the
  outer layer, no identifier the envelope does not, and Delivery
  §5a.10 applies to the same identifier. The carried document shows
  the counterpart, before it opens the seal, the two connection DIDs,
  the type `sealed-envelope/0.1`, the instant of the first submission
  in whole seconds, and an `id` that is the same for every attempt of
  one sealed envelope; a consumer that is not RLTP's learns these and
  nothing of the content.
- **Linkability, per party.** Every wire identity is per
  relationship × carrier and carries §5a.10's three prohibitions.
  **Toward counterparts** nothing joins one relationship to
  another. **Toward the mediator** the two directions of one
  relationship are paired by identifier, not only by timing — in mode
  `routed` the outer sender is this side's account and the route the
  counterpart's — while nothing joins its relationships to each other
  through identifiers; timing, source address and volume remain, as
  §10 of the Delivery Contract records, and this profile claims no
  unlinkability.
- **What a card reveals.** A card carrying a hint names `C` and the
  connection DID of the relationship it opens. A sent card travels
  sealed inside the encounter bundle, except on the optical leg
  (Encounter §5.8). A displayed card is readable by everyone who sees
  it while it is displayed: bystanders, and a second scanner of the
  same image (Open Issue 8). They learn an identifier of a
  relationship that only one enactment can form (Encounter
  RLTP-ENC-5170); `N` itself never appears (RLTP-VTI-1215). A hint
  that names another party's account (§8) shows the mediator a
  pairing between that account and the counterpart's connection DID
  that no relationship holds.
- **What a displayed card's instance shows the mediator.** The card's
  connection DID authenticates at the mediator from the display on,
  before anyone scans (RLTP-VTI-1250). The mediator sees one account
  per displayed card, how long it lives, and whether a frame reached
  it: whether the card was answered over this carrier. An account that
  closes without a frame is a card not answered over it.
- **The principal never appears on the wire** — the mediator
  cannot see, and therefore cannot leak, the identifier under
  which port-level authority is exercised.
- **The ack store reveals traffic history.** `AckState` holds
  digests and instants of concluded deliveries, and the send state
  the digests and acceptance instants of the open routed deposits
  (outbound history) and the instant of a refusal of direct
  delivery — metadata about
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

1. **The value of `routed-ack-deadline`.** 72 hours, equal to the
   give-up horizon (§3a); no measurement of how long counterparts
   stay absent underlies it.
2. **Recognising a refusal of the routed form.** RLTP-VTI-3130
   switches at once on a validated refusal of the routed form; what
   the target mediator sends in that case, and how a binding ties it
   to the deposit and authenticates it, is not measured, and the
   target binding attributes no refusal to the routed form yet. The
   same holds for problem reports in general: §5 requires a
   problem report that refuses a deposit to count as a refusal of
   that deposit, and the target binding does not yet correlate a
   problem report with a deposit. A carrier that does not accept
   direct delivery (RLTP-VTI-3120) answers a deposit in mode `direct`
   with a refusal of direct delivery on the connection DID's session
   (mediator 0.45: `e.p.direct_delivery.denied`); all deposits sent
   before the report arrives were reported `accepted` and end at the
   give-up horizon. The binding logs a refusal of direct delivery,
   and the adapter records it in the send state; it survives openings
   and is never lifted under this profile. A report that arrives after
   the binding closed is lost, and each opening shorter than the
   report's way deposits once more and fails at the horizon. Only a
   new principal (a new relationship, a rebind, a change of `C`, §6,
   whose identity reaches the counterpart only as Open Issue 10
   allows) or a lost send state (RLTP-VTI-3130, Open Issue 4) starts
   in `routed` again; a carrier whose operator later allows direct
   delivery does not by that carry the relationship again.
3. **Keylist.** §1 and §3 name keylist updates; the target
   mediator keeps no keylist for TSP clients, and the binding
   treats the update as a no-op.
4. **No return to `routed`.** The switch is final for the
   relationship; a mediator that carries routed messages again later
   is used in mode `routed` only by a new principal (a new
   relationship, a rebind or a change of `C`) or after a lost send
   state (RLTP-VTI-3130).
5. **Documents accepted before a switch or a key change of `C`.** They
   end at the give-up horizon (RLTP-VTI-7130); depositing them again
   would need the holder's leave after acceptance, which the
   Delivery Contract does not give (Delivery 0.85).
6. **A side that only acknowledges.** The signal rests on this
   side's own documents (RLTP-VTI-3130); acknowledgements count for
   nothing. A side that only acknowledges never switches, so on a
   mediator that does not deliver routed messages its
   acknowledgements are lost: the counterpart switches after its own
   documents went unanswered and its later documents arrive, but
   their delivery status stays at `accepted` (sent) and ends
   `failed` at the horizon while they arrived.
7. **A mediator VID other than `C`.** Not served (RLTP-VTI-7120);
   serving it needs a connection DID that is not a function of
   (root, `C`, `N`) alone.
8. **Several scanners of one displayed card.** The connection DID
   of a displayed card belongs to that card's `N` until the card is
   replaced with its challenge, so everyone who scans or sees the same
   image reads the same identifier (§8, §9). The displayed card's
   instance is bound by the first bundle the holder takes; a second
   scanner's bundle is refused (RLTP-VTI-1265), and the relationship
   that scanner recorded reaches no one over this carrier. A two-stage
   form — a short-lived invitation identity on the displayed card, the
   relationship's identity afterwards in a signed document of the
   relationship — would keep the identity from all but the
   counterpart; it needs a document type that does not exist and is
   not part of this casting.
9. **Foreign TSP clients.** A hint is a `TSPTransport` service entry
   that a TSP client reads as it is, and this side sends and collects
   under the identity it names. A client of the target TSP library
   still drops an application message from a sender with which it has
   formed no relationship (XRFI/XRFA), and this profile forms none, so
   such a client cannot be reached through a hint alone.
10. **Re-announcing the wire identity over the relationship.** A
   rotation or replacement of `N` (RLTP-VTI-1245), a second first `N`
   from several devices writing the register (RLTP-VTI-1245) and a
   relationship without a hint at first contact (RLTP-VTI-1235) all
   need the relationship's connection DID announced in a signed
   document of the relationship rather than in a card. That document
   type does not exist; together with the two-stage form of Open
   Issue 8 it is the same construction, not part of this casting.
11. **Possession of the named identity.** A hint is bound by the
   card's proof alone (§8). A signature by the connection DID would
   prove that the author holds it; this casting does not require it.
12. **Deposit state from the mediator.** The registry's
   `messaging/message/status/0.2` (`trustoverip/dtgwg-trust-tasks-tf`
   @ `f27ea538`; it renames the response's `at` to `reachedAt`, the
   instant a message reached its state) lets a depositor ask the
   mediator for the state of its deposits. The pinned mediator
   implements its predecessor `messaging/message/status/0.1`, and
   `vti-didcomm-js` 0.13.0 has no client for either. None of its states
   (`queued`, `delivered`, `collected`, `withdrawn`, `discarded`,
   `unknown`) carries a `delivered` of the trias, which a valid
   acknowledgement alone does (Delivery §6.1); a state could at most
   inform a report before the trias or an earlier `failed`. Its use
   waits for a carrier pin that has 0.2, with the derivation of a
   message id for a TSP deposit and the identity that signs the
   request in each sending mode.
13. **`idConflict`.** RLTP-VTI-5030 keeps the reading of an
   absorption against the framework's refusal; it follows the
   Delivery Contract's decision on duplicate keys (its DO-10). On the
   wire the question does not arise for a consumer that follows the
   framework: the carried document declares repeated execution safe
   and intended, and every repeated attempt is byte-identical
   (Delivery §4.6, RLTP-DEL-5040).
14. **Peers and mediators on TSP Rev 3.** A mediator before 0.45
   refuses a TSP 1.0 message at its ingress; from 0.45 on it opens a
   routed layer addressed to itself only in 1.0. A binding on Rev 3
   and a binding of this profile refuse each other's frames
   (RLTP-VTI-7140). A relationship whose two sides or whose `C` do not
   all speak TSP 1.0 is not carried; this profile names no transition.
   The same holds for consumers of the registry's binding: its
   TypeScript implementation (`@openvtc/trust-tasks-tsp` 0.1.1)
   depends on `vti-tsp-js` from 0.2.0, which speaks Rev 3, while its
   Rust implementation (`trust-tasks-tsp`) uses `affinidi-tsp` 0.3.0,
   the TSP of mediator 0.45.
15. **The wire identity and the VID rules of TSP 1.0.** TSP 1.0
   requires a VID for public use to support key rotation and the
   verification of its key state's provenance, lets a VID stay simple
   and static only when it is private to an established TSP
   relationship, and discards a message from a VID the destination has
   no relationship with. The connection DIDs are static `did:key`s,
   named on a card (on a displayed card readable by anyone who sees it,
   Open Issue 8), and form no TSP relationship (Open Issue 9): they are
   neither. The profile puts the RLTP relationship, bound by the card's
   proof (§8), where TSP puts the established relationship, and
   replaces them through a new `N` (Open Issue 10), not by key
   rotation. A TSP 1.0 endpoint without this reading discards their
   messages; how this profile meets TSP-conformant counterparts is
   open.
16. **Answers after the end.** An answer binds a submission of the
   instance it reaches, those filed for binding included
   (RLTP-VTI-5065). An answer to a document the holder already ended —
   failed at its horizon, delivered, or refused — changes nothing: in a
   later opening it binds nothing, and within the opening that filed the
   document it binds, but the holder keeps the end it recorded. This
   holds also where the answer would have said more than that end (a
   refusal after `failed(expired-by-adapter-policy)`).
   An answer that reaches a displayed card's instance before it is bound
   binds nothing either: that instance has deposited nothing.
17. **Answers of this side.** This side reads the framework's answers
   and sends none: a carried document it does not deliver is logged
   and acknowledged (RLTP-VTI-7160), and a foreign document of another
   type is not refused with a `trust-task-error`. Sending refusals is
   not part of this casting.

## Appendix A: Companion changes

§1b, §1c and §3a read clauses of Delivery §5a.4, §5a.9 and §5a.10
differently from their present wording. The Delivery Contract owns those clauses; these
are the changes its next casting takes up.

**Delivery Contract (next casting):**

- 5a.10, every clause that names a card or a resolvable location as a
  forbidden place for an identifier — "not well-known", item 1 (the
  VID "MUST NOT be published in a directory, a well-known location, a
  profile, a card, …"); the TSP ingress clause ("in no directory,
  profile, card, or other location that resolves it for a party which
  is not this carrier"); and the DIDComm connection DID ("in no
  directory, profile, or resolvable public location"): what each
  forbids is every place that makes the identifier resolvable for a
  party outside this relationship. The card of this relationship,
  given to its counterpart (the sent card answering the displayed
  card), is no such place and MAY name the identifier. A displayed
  card is the one named exception: it MAY name the identifier, it is
  carried to its scanner or scanners only, for the time it is
  displayed and for one enactment (Encounter RLTP-ENC-5170), and a
  card scanned or seen by more than one party is the bound an adapter
  profile that uses such a card states (this profile: §9, Open
  Issue 8). The conformance list of the same
  casting (§11: the well-known outer VID, the well-known DIDComm
  connection DID, TSP ingress) reads "well-known" alike.
- 5a.10, the paragraph on the nested private end-to-end VID: "hidden
  from intermediaries by construction" holds for nested envelopes;
  in routed mode the direct carrier opens the routing layer and
  reads the inner sender and receiver.
- 5a.10, "What that buys", and §10: in routed mode the direct
  carrier pairs the two directions of one relationship by
  identifier — the outer sender is the depositing side's collecting
  identifier, the route the counterpart's — not only by timing; the
  claim stays bounded to no join across relationships.
- 5a.10, the change of the direct TSP peer under an unchanged `C`:
  an adapter whose outer peer is the configured carrier itself, and
  whose collecting identifier is derived from (root, `C`, `N`), MAY
  decline to serve a carrier whose TSP VID differs from `C` or
  changes under it; an adapter profile that declines MUST state it,
  and the fresh-outer-VID rule binds every adapter that serves the
  case.
- 5a.10, "One principal, one relationship, one carrier, one live VID",
  and the retirement with the principal: a principal whose relationship
  is the one a displayed card opens is live at the carrier from the
  display on, before that relationship exists (this profile:
  RLTP-VTI-1250).
- 5a.9, the aging of orphaned bindings (`orphan-horizon`), extended: the
  account of a displayed card's instance that is closed without a
  relationship it carries — a card never answered (RLTP-VTI-1270), or a
  record whose sent card names no identities at that carrier
  (RLTP-VTI-1260) — is aged out like an orphaned binding; 5a.9 names
  that case.
- 5a.10, DIDComm, "a connection DID … for this principal and for
  nothing else": the principal's own deposits, routed and direct,
  under its connection DID are part of its mediation relationship,
  not another purpose.
- 5a.4, the paragraph on ack pairing by response time "with no
  identity whatsoever": in routed mode the direct carrier pairs the
  two directions by identifier as well (the entry above on "What
  that buys"); 5a.4 and §10 change together.

## Appendix B: Changelog

One line per casting; the earlier castings are archived unchanged
under `archive/`.

| Version | Date | Change |
|---|---|---|
| 0.30 | 2026-10-28 | `trust-task-error/0.6` (`extends: "0.5"`) read beside 0.5 (RLTP-VTI-5015, new; 5010, 7160): each version by its own schema, the versions read are those whose declared extension chain reaches 0.5 and the reader knows, a later one added without a casting, its new codes read as extended codes until a casting names them. `unsupportedExtension` is a terminal verdict, `indeterminate` an availability condition with `retryable: true` and `taskFailed` with `false`, never a refusal or a verdict (RLTP-VTI-5020). Security Considerations: a retryable answer gives the counterpart no more than silence. |
| 0.29 | 2026-10-27 | One wire identity per relationship and carrier: the connection DID sends and collects, in every layer of both modes (§1, §1a, RLTP-VTI-1120); the delivery hint has three members, a fourth `rltpEgress` read and ignored (RLTP-VTI-1210, 1220, 1227, 1240); the fallback mode `direct` runs on the connection DID's session (RLTP-VTI-3120). Every document travels as a `sealed-envelope/0.1` document in the registry's TSP binding envelope (§3b, RLTP-VTI-3150; Delivery §4.6), built at every attempt and byte-identical across attempts; the adapter reads a delivered payload with its authenticated sender (RLTP-VTI-7140, 7160), holds the carried document's parties against it, and hands the seal to the holder; `payload-bound` 90 182 bytes (§2). Answers in the binding: `trust-task-error/0.5` and `trust-task-next-step/0.1` bound to the submission by the carried document's `id` (RLTP-VTI-5040); a next step makes a submission `accepted` and `held`, which the give-up horizon does not end (RLTP-VTI-5050, §2). Open Issues renumbered; 16 (answers after the end) and 17 (answers of this side) new; the answer contract (RLTP-VTI-5065, 5070, 5080): every open document, custody and the accepted documents the holder offers (Delivery RLTP-DEL-6150), has its id independent of sending; only the recipient the document named changes it; a bound answer travels in the collection with its report and is acknowledged only at the conclusion, after the host recorded it. |
| 0.28 | 2026-10-26 | TSP 1.0 (`YTSP-BAA`, @ `ccda6b33`) in place of Rev 3: both layers of a deposit are 1.0 messages carrying the sender's VID in the confidential payload, HPKE-Base only (§3a, §7, RLTP-VTI-7110); on receipt (RLTP-VTI-1255, 3140, 7140) only major version 1 with any minor version, a message failing a 1.0 receiver check (payload sender other than the envelope's, NULL sender) or of another major version logged and acknowledged; the route entry is 1.0's `VID_exit` (RLTP-VTI-3115); target carrier the mediator from 0.45.0 with `vti-didcomm-js` 0.13.0 and `vti-tsp-js` 0.4.0, which MUST allow local direct delivery for mode `egress-session`, a refusal of it recorded in the send state when the binding receives it (§7), across openings, no deposit after it (RLTP-VTI-3120, 3130, §5, Open Issue 2); §9 on the sender VID in the payload; Open Issue 12 names the mediator's `status/0.1`; Open Issues 14 (peers and mediators on Rev 3) and 18 (the wire identities against TSP 1.0's VID rules); Appendix A re-reads Delivery 5a.10 against TSP 1.0. |
| 0.27 | 2026-10-25 | Counterpart refusals per `trust-task-error/0.5` (§5, RLTP-VTI-5010 to 5030): read by the document's `retryable`, `retryAfter` the lower bound of the next attempt within the give-up horizon, terminal verdicts with the codes `unsupportedVersion`, `permissionDenied`, `cancelled` and `taskFailed` added, extended codes as `taskFailed`, `idConflict` an absorption as a named divergence; `messaging/message/status/0.2` an Open Issue (15) for want of a carrier that has it; Delivery 0.84 pinned. §1c unchanged. |
| 0.26 | 2026-10-23 | The displayed card's instance (§1c, RLTP-VTI-1250 to 1270): an instance per displayed card from the display until its challenge ages, collecting without a counterpart; only an envelope sealed to the card's key reaches the holder, and it accepts a frame only for a bundle answering the card that the holder takes, the frame's sender a diagnosis; any record of the card's challenge, by whatever carrier or leg, binds it to the hint's identities and makes it the relationship's instance, or closes it; every other frame is discarded; RLTP-VTI-1235 and 7140 name it as their one exception; Delivery 5a.9 and 5a.10 on the account of a displayed card in Appendix A. |
| 0.25 | 2026-10-23 | The delivery hint (§1b, RLTP-VTI-1210 to 1245): a `TSPTransport` service entry per carrier in the card that opens the relationship, identities from a fresh `N`, first contact only, a total reader that ignores a hint naming the reader's own identities, a chained relationship's instance closes at the chaining, no change of `N`; Delivery 5a.10 card and resolvable-location clauses in Appendix A. |
