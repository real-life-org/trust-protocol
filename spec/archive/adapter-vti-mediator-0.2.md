# RLTP Carrier Adapter Profile: VTI Mediator

**Real Life Trust Protocol — Adapter Profile (below the port line)**

- **Status:** Editor's Draft
- **Version:** 0.2.0-draft (second casting — review 1 answered,
  `design/adapter-review1-triage-2026-08.md`: the wire speaks only
  scoped identities (connection DID + egress identity, never the
  principal); every declared constant is enforced; three receiver
  registers make re-acks conclusion-gated; give-up binds accepted;
  conclude is infallible at the port; counterpart errors map into
  §6.1's own vocabulary. First casting: Anton's four adapter
  decisions of 31.08. — g1-a, per-carrier identities, digest-set
  conclude, silent JWT lifecycle)
- **Editors:** Anton Tranelis

Status: second casting. Normative for the adapter it describes;
adds **no wire form** to the Delivery Contract (5a.10). Target
carrier: the VTI/Affinidi messaging mediator as released in
**VTI-Dogwood** (pins: `vti-didcomm-js` @ `1d110bf`,
`verifiable-trust-infrastructure` @ `e0f700b7`; protocol texts:
Coordinate Mediation 2.0 @ `d5909369`, Message Pickup 3.0 @
`9dfa409f`, TSP @ `ea01152` — `sources/pins/PINS.md`). Seam
evidence: `design/mediator-naht-bestandsaufnahme-2026-08.md`.

The adapter plays the **carrier side of the port** toward its
holder (Delivery §4.4, §5a) and the **client side of the mediator
protocols** toward the carrier. Everything the mediator does that
the port does not promise is carrier policy below the port line
and MUST NOT surface except as the port's own forms.

## 1. Carrier identity and principal

- `C` is the **mediator's DID**, exactly as the holder configured
  it (Identity §7a.2 — never a hop beyond it, never the URL the
  DID currently resolves to).
- The control principal is derived per Identity §7a:
  `carrierPrincipal(rootIkm, C, nonce)`. **The principal never
  touches the wire.** Beside it the adapter derives, from the same
  root under distinct info prefixes, two wire-facing identities
  (`carrierScopedIdentity`): the **connection DID** (all mediator
  protocol traffic: auth, keylist, pickup, receipts) and the
  **egress identity** (presented on every deposit — the
  sender-side identifier of §5a.10's ingress rules, one per
  relationship × carrier). Each is derivable from the root; none
  is derivable from any other — which satisfies "never a control
  principal or derivable from one" by construction. Both are
  `did:key`s, offline resolvable — the form ref-04 proves the
  mediator admits.
- Connection DID and egress identity each carry §5a.10's three
  prohibitions in full: **not well-known**, **not person-wide**,
  **not reused outside this relationship**. They are retired with
  the principal, never reassigned. `from_prior` is **forbidden**: a
  new connection DID means a fresh mediation relationship and a
  new registration (5a.3), never a rotation statement linking the
  two.
- One mediation relationship per principal (5a.10). The adapter
  MUST NOT register two principals' `rkid`s on one connection,
  MUST NOT answer or cache any keylist view spanning two
  principals, and scopes every status, pickup, and receipt
  operation to one principal's connection.
- Live Mode is a property of the mediation relationship (MUST,
  per principal). Multiplexing two principals' relationships over
  one WebSocket is a timing decision under 5a.7's spacing policy;
  this adapter's default is **one socket per principal** and it
  declares any deviation.

## 2. Declared constants (Decision g1-a)

The mediator publishes no operating constants. Per the accepted
resolution, **the adapter declares its own and fulfils them
client-side**; the mediator remains invisible policy beneath
them. Declared values, revisable only per §5a.3's declared-
revision rules (a revision lowering a bound trims atomically):

| Constant (§4.4) | Value | Enforced by |
|---|---|---|
| `challenge-lifetime` | 300 s | an ATM challenge older than the bound is never answered — a fresh one is fetched |
| `queue-floor` | 64 envelopes **and** 1 MiB | below both bounds, an inbound frame is always buffered |
| `max-queue-bytes` | 16 MiB | above it, an inbound frame is not buffered and **not acknowledged** — the mediator keeps its copy and re-covers |
| `max-binding-tombstones` | 64 | tombstone store, evicted in the normative order (longest-released first, ties ascending rkid bytes) |
| `orphan-horizon` | 30 days | a binding uncollected for the horizon is dropped and tombstoned; concluded digests are pruned the same span after conclusion |
| `give-up-horizon` | 72 h | every submission not confirmed delivered — `accepted` included — fails at the horizon |
| `status-horizon` | 60 s | the §6.1 report exists synchronously at submit |

The honest limit, stated as §4.4 requires: these bind the
**adapter**. Where the mediator is stricter (an unpublished TTL,
an ACL change, a quota), the holder sees only the port's
retriable refusals or a `failed` from the closed set — never a
mediator-shaped error.

## 3. Operation mapping

| Port (§5a) | Mediator wire | Notes |
|---|---|---|
| `issueChallenge` / `register` | ATM auth: `POST /challenge` → authcrypt `atm/1.0/authenticate` → access+refresh JWT; then keylist update for the principal's `rkid`s | port challenge/possession-proof stays the port's own (rkid-bound, consume-before-verify); the ATM handshake is transport admission beneath it |
| `submit` | `POST /inbound` or WS frame; payload = the sealed RLTP envelope, presented under the **egress identity** | principal-free egress; the egress identity is §5a.10's sender-side identifier per (relationship × carrier). The **TSP framing itself is the wire binding's duty** (the byte boundary of the library), and so is §5a.10's peer-change rule — a changed direct TSP peer under an unchanged `C` retires the outer VID and establishes a fresh one for the same principal; only the wire binding can see the peer |
| `collect` | Live delivery / `delivery-request`; mediator fetches with `DoNotDelete` | redelivery before ack is re-cover, not a new item |
| `conclude` | `messages-received` over the **digest set of the collection** (Decision 3) | queue-id = sha256 of the delivered bytes (mediator convention); clears queue entries, carries no verdict (§5a.8) |
| `advance` | adapter clock only | give-up, orphan and wind-up run on the adapter's declared horizons; the mediator has no wind-up the adapter can observe |

Order inside `collect`→`conclude` is **hand off → await → ack**
(the Dogwood contract, `vti-didcomm-js` `29b92cc`), and the
adapter keeps it with **three receiver registers**: buffered
(inbox), outstanding (collected, not yet concluded), concluded.
Only a digest in the **concluded** register is ever
(re-)acknowledged; a redelivery of a buffered or outstanding
frame is ignored without an acknowledgement — the mediator keeps
its copy, which is precisely the safety wanted while the only
adapter copy is volatile. The conclusion itself is a durable ack
intent: recorded first, sent best-effort, retried on every
`advance` until it lands. Collections carry an adapter-issued id
and conclude against the adapter's **authoritative digest set**;
caller-supplied arrays are ignored.

## 4. Duplicate rule and delivery promise

- At-least-once transport + delete-to-ack means duplicates are a
  **normal** event. The adapter's duplicate absorption is
  digest-keyed over delivered bytes. Concluded digests are held
  for `orphan-horizon` **measured from conclusion** (always a
  finite instant). The honest limit: after that span a late
  redelivery — possible only through an acknowledgement the
  mediator never received — reaches the holder again and falls to
  the receiver's own §6.2 absorption, which composes with this
  rule and never replaces it.
- Status trias per §6.1. Pre-transport reports use the closed
  set `awaiting-transport(offline | transport-unreachable |
  carrier-refused-retriable)` within `status-horizon`.
  `failed(expired-by-adapter-policy)` fires at `give-up-horizon`;
  a later valid `delivery-ack` still transitions to `delivered`
  and the transition is surfaced.
- JWT lifecycle is silent carrier policy (Decision 4): access
  tokens are renewed via refresh with no port-visible event; only
  a renewal that fails terminally surfaces, as the retriable
  refusal family, and a registration that must re-run the ATM
  handshake reports `awaiting-transport(carrier-refused-retriable)`
  meanwhile — existing port terrain, no new state.

## 5. Refusal and error mapping

Wire → port, most specific first; the port's five-member
retriable family and evaluation orders (s1–s6, r1–r5) are
unchanged.

| Wire condition | Port form |
|---|---|
| HTTP 401/403, ATM challenge refused, ACL block | retriable refusal (admission-resource); persistent → `failed(unroutable)` at give-up |
| HTTP 413 / mediator size refusal | s2 bounds → `failed(oversize)` |
| WS close `duplicate-channel` | adapter re-establishes; no port event (transport below the line) |
| WS upgrade drop / timeout / DNS | `awaiting-transport(transport-unreachable)` |
| HTTP 429 / 5xx | `awaiting-transport(carrier-refused-retriable)` |
| `trust-task-error/0.2` from a TT-speaking counterpart | into §6.1's **own** vocabulary — a counterpart refusal is a receiver verdict, so it lands as `failed(rejected-by-receiver(<code>))`: `malformedRequest`, `unsupportedType`, `proofRequired`, `proofInvalid`, `wrongRecipient`, `identityMismatch` each conveyed as the receiver reason; `idConflict`→§6.2 absorption (no failure); `unavailable`/`internalError` (retryable)→`awaiting-transport(carrier-refused-retriable)`; `expired`→no port equivalent (recorded divergence). Background: `design/trust-tasks-05-abgleich-2026-08.md` Befund 4 |
| mediator problem-report / status frames | consumed by the adapter, never acked, never surfaced as items |

## 6. Lifecycle coupling (§5a.10, applied)

- Change of the **direct** carrier = change of `C` = new
  principal, new registration, new connection DID; the old one is
  retired, never re-pointed.
- Change **beyond** the direct carrier (the mediator's own
  arrangements) changes nothing at the port.
- A rebind (5a.3) establishes a fresh mediation relationship and
  a new connection DID; orphaned DIDs are retired, never
  reassigned.
- Wind-up per §5a.9 runs entirely on the adapter: the deadline is
  the release, deposits admitted during closing inherit remaining
  time, a return ends the wind-up. The mediator sees only that
  collection stops and queue entries are acknowledged.

## 7. Discharged and due obligations

- §5a.10's "vector debt" (Section 11): the obligations above are
  decidable against this adapter — the conformance vectors are
  due with the implementation, not with this text.
- Hardening register (port code, due at this stage): M-1
  (give-up sender path), M-2 (rawGeneration bytes), M-3
  (derivation snapshot) — to be discharged in `lib` alongside the
  adapter implementation.
- Not in scope of v0.1: DIDComm-v1 bridging (Keyring's current
  wallet-to-wallet path), VTA enrollment/ACL administration, and
  any TT transport binding (a later, separate contribution).
