# binding — the VTI mediator wire (dev only)

The concrete `MediatorWire` of the VTI mediator adapter
(`spec/adapter-vti-mediator.md`, profile 0.29, §3a, §7) over
`@openvtc/vti-didcomm-js` 0.13.0 and `@openvtc/vti-tsp-js` 0.4.0, TSP 1.0.
It is never a dependency of the zero-dependency library: the library's
adapter (`lib/src/adapters/vti-mediator.ts`) takes any wire that keeps the
`MediatorWire` contract, and this one is the measured one.

## What it does

- `createVtiWire({ rootIkm, mediatorDid, nonce, peerDid, log?, depositMode?, transport? })`
  derives the one wire identity, the connection DID, from the same root,
  carrier and nonce as the adapter (`rltp/v1/carrier-connection/ed25519/v1/`,
  Identity §13), authenticates under it (ATM), and holds one session per
  relationship and side. `peerDid` is the counterpart's connection DID,
  the `id` without `#tsp` of its delivery hint (RLTP-VTI-1240); the wire
  refuses to be built without it, or with this side's own (1235, 1227).
- `deposit(token, bytes, mode)` packs the payload the adapter hands over —
  the binding envelope around the carried `sealed-envelope/0.1` document
  (RLTP-VTI-3150) — anew for every attempt (7110):
  - **`routed`** (the mode of every relationship from the start): an inner
    TSP 1.0 `direct` message connection DID → peer's connection DID
    (HPKE-Base to its key, signed by the connection DID) inside an outer
    `packRouted` message connection DID → `C`, route [peer's connection
    DID], sealed to the key `C` names first under `keyAgreement` as
    resolved at the last authentication (7120);
  - **`direct`** (the fallback after the switch of RLTP-VTI-3130): the
    inner message alone, on the same session.
- On receipt it opens a TSP 1.0 `direct` message from the peer's
  connection DID to its own and hands the adapter the payload bytes
  unchanged together with the authenticated sender (M-2, RLTP-VTI-7140);
  the adapter reads the carried document (7160). Control frames
  (`XRFI`/`XRFA`/`XRFD`), padding, `nested`/`routed`, empty `direct`
  frames, frames of another sender or receiver, frames that fail a TSP 1.0
  receiver check and frames of another major version (Rev 3 included)
  never reach the adapter: they are logged with their type and sender VID
  and acknowledged.
- Delete-to-ack stays the adapter's: the session subclass acks a frame
  only when the adapter concludes it (payload digest ↔ mediator queue id).
- A problem report of the mediator on the session is logged; a refusal of
  direct delivery (`e.p.direct_delivery.denied`, mediator 0.45 with local
  direct delivery off) sets `directRefused()` for the wire's life and
  makes every later `direct` deposit fail as `WireError('direct-refused')`
  (RLTP-VTI-3120); `routed` deposits still go.
- `counterpart()` names `peerDid`; `log(line)` takes the adapter's lines;
  `queueEmpty()` is the statement of RLTP-VTI-7150 as far as the wire can
  tell (session open, nothing on its way to the adapter, nothing left at
  the mediator since the socket opened, 1 s without a frame);
  `sentFrames()` gives the frame sizes for the probes.
- A closed socket fails a deposit or an ack as `WireError('unreachable')`
  and reconnects in the background (single-flight, backoff 50 ms to 30 s).
- `RLTP_WIRE_DEPOSIT` (or `cfg.depositMode`): `routed` (default) follows
  the adapter's mode; `direct` forces the fallback for every deposit.

## Tests and probes

- `test/wire-demux.test.mjs` — offline (`npm test`): the real wire, the
  real adapter and the real TSP 1.0 code of `vti-tsp-js` 0.4.0 over a
  mediator double (ATM HTTP, DID resolution and socket through
  `cfg.transport`). Both sending forms byte for byte against
  `vectors/vti-routed-addressing.json`, the payload carried unchanged, the
  frames refused on receipt, problem reports, key rotation and rebinding,
  the switch to `direct`, `queueEmpty()`, acks and the buffer cap.
- `live-probe.mjs` — `RLTP_LIVE_MEDIATOR=1`, `MEDIATOR_DID` required (a
  TSP 1.0 mediator ≥ 0.45): two sides of one relationship exchange a
  carried document both ways (deposit → deliver → conclude) and print
  delivery, frame sizes and times.
- `live-delivery-probe.mjs` — the full delivery contract live: a
  lib-sealed document, the staged `receive()`, a signed `delivery-ack/0.1`
  back, the trias closing `accepted → delivered`.
- `live-interop-probe.mjs` — the adapter against a foreign Trust Task
  consumer on the same mediator (`FOREIGN_DID`, its did:key; `EXPECT`
  `unsupportedType` or `next-step`): the consumer of
  `trust-protocol-interop-double` (Rust: `trust-tasks-rs` and
  `trust-tasks-tsp` 0.35.4, `affinidi-tsp` 0.3.0) dispatches the carried
  document by its `type` without opening the seal and answers the
  authenticated sender; the probe checks that the adapter binds the answer
  to the submission and applies it. `CROSS_OPENING=1` closes the adapter
  right after the acceptance and opens a new one over the same
  relationship, which files the document as the holder offers it for
  binding (RLTP-VTI-5045) and binds the answer the mediator kept.

## Measurements

Mediator 0.45.0 at
`did:webvh:QmUTUkdHgppiciLpqcxkTi6Pbc9VuZzWXvH4L2Dk2dY2WL:mediator.web-of-trust.de`
(local direct delivery allowed), 27.10.2026, one run each:

| Probe | `routed` | `direct` |
|---|---|---|
| `live-probe.mjs` | PASS: 657 B payload → inner 984 B → outer 1392 B, delivered after 282 ms; reply 635 B → 963 B → 1371 B, 262 ms | PASS: 657 B → 984 B, 270 ms; 635 B → 963 B, 258 ms |
| `live-delivery-probe.mjs` | PASS: document 1105 B → 1434 B → 1842 B, ack 1647 B → 1974 B → 2382 B, deposit → ack validated 569 ms | PASS: 1105 B → 1434 B, ack 1646 B → 1974 B, 529 ms |
| `live-interop-probe.mjs`, consumer without a handler | PASS: `unsupportedType` → `failed(rejected-by-receiver(unsupportedType))` after 219 ms | PASS: the same after 216 ms |
| `live-interop-probe.mjs`, consumer with `--next-step` | PASS: `trust-task-next-step/0.1` → `accepted`, `held` after 240 ms | PASS: the same after 230 ms |
| `live-interop-probe.mjs`, `CROSS_OPENING=1`, without a handler | PASS: bound in the second opening, `failed(rejected-by-receiver(unsupportedType))` | PASS: the same |
| `live-interop-probe.mjs`, `CROSS_OPENING=1`, `--next-step` | PASS: bound in the second opening, `accepted`, `held` | PASS: the same |

The binding envelope and the carried document add about 400 bytes to a
sealed envelope; the routing layer about 408 bytes more. A routed message
whose inner and outer sender are the same connection DID is relayed.

## Operating facts

1. The mediator relays a TSP frame only when the sender VID of its
   envelope is the socket's authenticated DID (measured at mediator 0.44
   with Rev 2 and Rev 3 frames): a frame with another sender vanishes
   without a problem report. Every layer this wire sends carries the
   connection DID, the socket's DID.
2. `register()` is the transport admission: it opens the ATM session and
   the pickup socket; `collect()` has no wire traffic of its own.
3. The mediator routes on the envelope's receiver VID; a keylist is not
   needed for did:key clients.
4. `accepted` means the frame went onto the socket; only the signed
   acknowledgement, or a counterpart's answer, says more.
5. Mode `direct` needs a mediator that allows local direct delivery
   (0.45: `LOCAL_DIRECT_DELIVERY_ALLOWED=true`; code default `false`).

## Running

```sh
cd binding && npm ci --ignore-scripts
export MEDIATOR_DID=...                              # a TSP 1.0 mediator (≥ 0.45), required
RLTP_LIVE_MEDIATOR=1 npm run probe
RLTP_LIVE_MEDIATOR=1 node live-delivery-probe.mjs
RLTP_LIVE_MEDIATOR=1 RLTP_WIRE_DEPOSIT=direct npm run probe
RLTP_LIVE_MEDIATOR=1 FOREIGN_DID=did:key:... EXPECT=unsupportedType node live-interop-probe.mjs
npm test                                             # offline
RLTP_WIRE_DEBUG=1 ...                                # frame sizes, dispatch errors
MEDIATOR_ALLOW_INSECURE=1 ...                        # a local instance over http/ws
```

The probes import `../lib/dist`; build the library first.

## Open

- `queueEmpty()` (RLTP-VTI-7150) is an approximation; a frame that
  arrives after the quiet second is not covered. A status request over
  Pickup 3.0 is outstanding.
- Problem reports are not correlated with a deposit; a refusal of the
  routed form (`WireError('routed-refused')`) is never raised (profile
  Open Issue 2).
- The change of the direct TSP peer under an unchanged `C` is not served
  (RLTP-VTI-7120, profile Open Issue 7).
- The wire forms no TSP relationship (`XRFI`/`XRFA`); incoming
  relationship frames are logged and dropped (profile Open Issues 9, 15).
