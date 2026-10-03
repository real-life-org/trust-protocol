# RLTP Carrier Adapter Profile: VTI Mediator

**Real Life Trust Protocol — Adapter Profile (below the port line)**

- **Status:** Editor's Draft
- **Version:** 0.1.0-draft (first casting — Anton's four adapter
  decisions of 31.08.: adapter-declared constants (g1-a),
  per-carrier `did:key` principal, digest-set conclude,
  silent JWT lifecycle)
- **Editors:** Anton Tranelis

Status: first casting. Normative for the adapter it describes;
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
  `carrierPrincipal(rootIkm, C, nonce)`. From the principal the
  adapter mints one **connection DID** (a `did:key`, offline
  resolvable — the form ref-04 proves the mediator admits).
- That connection DID carries §5a.10's three prohibitions in
  full: **not well-known**, **not person-wide** (never a control
  principal or derivable from one — the derivation above yields
  the key material, and the DID is minted from a dedicated
  subkey, not from any value that appears elsewhere), **not
  reused outside this relationship**. It is retired with the
  principal, never reassigned. `from_prior` is **forbidden**: a
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

| Constant (§4.4) | Value | Fulfilled by |
|---|---|---|
| `challenge-lifetime` | 300 s | adapter-issued port challenges |
| `queue-floor` | 64 envelopes · 1 MiB | adapter-side buffer accounting |
| `max-queue-bytes` | 16 MiB | adapter-side buffer accounting |
| `max-binding-tombstones` | 64 | adapter store, normative order §5a.3 |
| `orphan-horizon` | 30 days | adapter clock over last collection |
| `give-up-horizon` | 72 h | adapter clock over each submission |
| `status-horizon` | 60 s | pre-transport reports, §6.1 |

The honest limit, stated as §4.4 requires: these bind the
**adapter**. Where the mediator is stricter (an unpublished TTL,
an ACL change, a quota), the holder sees only the port's
retriable refusals or a `failed` from the closed set — never a
mediator-shaped error.

## 3. Operation mapping

| Port (§5a) | Mediator wire | Notes |
|---|---|---|
| `issueChallenge` / `register` | ATM auth: `POST /challenge` → authcrypt `atm/1.0/authenticate` → access+refresh JWT; then keylist update for the principal's `rkid`s | port challenge/possession-proof stays the port's own (rkid-bound, consume-before-verify); the ATM handshake is transport admission beneath it |
| `submit` | `POST /inbound` or WS frame; payload = the sealed RLTP envelope as a **TSP frame** (routed form) | principal-free egress; sender-side outer VID per (relationship × carrier), §5a.10 ingress rules, three prohibitions, retired with the relationship |
| `collect` | Live delivery / `delivery-request`; mediator fetches with `DoNotDelete` | redelivery before ack is re-cover, not a new item |
| `conclude` | `messages-received` over the **digest set of the collection** (Decision 3) | queue-id = sha256 of the delivered bytes (mediator convention); clears queue entries, carries no verdict (§5a.8) |
| `advance` | adapter clock only | give-up, orphan and wind-up run on the adapter's declared horizons; the mediator has no wind-up the adapter can observe |

Order inside `collect`→`conclude` is **hand off → await → ack**
(the Dogwood contract, `vti-didcomm-js` `29b92cc`): the holder's
durable acceptance completes before the acknowledgement releases
the mediator's only other copy. A redelivery after a lost ack is
re-acknowledged and absorbed by the duplicate rule below, never
dispatched twice.

## 4. Duplicate rule and delivery promise

- At-least-once transport + delete-to-ack means duplicates are a
  **normal** event. The adapter's duplicate absorption is
  digest-keyed over delivered bytes and held for at least the
  span in which the mediator can redeliver (bounded client-side
  by `orphan-horizon`); this composes with, and never replaces,
  the receiver's own §6.2 absorption.
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
| `trust-task-error/0.2` from a TT-speaking counterpart | per the mapping table in `design/trust-tasks-05-abgleich-2026-08.md` (Befund 4): `malformedRequest`→`failed(malformed)`, `unsupportedType`→`failed(unknown-type)`, `proofRequired`/`proofInvalid`→`failed(validation-failed)`, `idConflict`→§6.2 absorption, `unavailable`/`internalError` (retryable)→retriable family, `wrongRecipient`/`identityMismatch`→outer/inner consistency (§4.2), `expired`→no port equivalent (recorded divergence) |
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
