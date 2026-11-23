# binding — the VTI mediator wire (dev only)

The concrete `MediatorWire` of the VTI mediator adapter
(`spec/adapter-vti-mediator.md`, profile 0.30, §3a, §7) over
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

## A local test mediator

`test-mediator/docker-compose.yml` starts the mediator image and the
settings of `mediator.web-of-trust.de` with Redis, over plain HTTP, bound
to `127.0.0.1:7037`. Probes that open many sessions, or that make sessions
fight for a socket, belong there and not on a shared instance. Its
identity is a `did:peer` generated once (git-ignored, with its secrets):

```sh
cd binding/test-mediator
IMAGE=ghcr.io/affinidi/messaging-mediator:v0.45.0@sha256:3e53ea634d9a3a26352480ff0b5266b8486489e0e672faa6bd6705549005f538
mkdir -p setup secrets
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/setup:/work" -w /work \
  --entrypoint mediator-setup "$IMAGE" \
  --non-interactive --deployment container --protocol tsp \
  --did-method peer --public-url "http://127.0.0.1:7037/mediator/v1" --ssl none \
  --secret-storage file --database-url "redis://redis:6379/" \
  --admin generate -c conf/mediator.toml > /dev/null   # stdout carries the admin key
cp setup/conf/secrets.json secrets/secrets.json && chmod 600 secrets/secrets.json
{ echo "MEDIATOR_DID=$(sed -n 's/^mediator_did = "did:\/\/\(.*\)"/\1/p' setup/conf/mediator.toml)"
  echo "ADMIN_DID=$(sed -n 's/^admin_did = "did:\/\/\(.*\)"/\1/p' setup/conf/mediator.toml)"
  echo "MEDIATOR_UID=$(id -u)"; echo "MEDIATOR_GID=$(id -g)"; } > .env
docker compose up -d
```

Then, from `binding/`:

```sh
RLTP_LIVE_MEDIATOR=1 MEDIATOR_ALLOW_INSECURE=1 \
  MEDIATOR_DID="$(sed -n 's/^MEDIATOR_DID=//p' test-mediator/.env)" node live-probe.mjs
```

`docker compose down -v` stops it and forgets every account and message.
Against this mediator `live-probe.mjs` passes and
`live-two-devices-probe.mjs` gives the result measured on the shared
instance, with one difference: without a rate limit in front, the two
devices that share a DID change places faster.

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
- `live-two-devices-probe.mjs` — one address, two devices: two wires over
  the same relationship root and carrier nonce (the same connection DID)
  and one for the peer. A measurement, not a verdict; it prints what
  happens. On 23 November 2026 against `mediator.web-of-trust.de` and the
  local test mediator (mediator 0.45.0): the mediator keeps one live
  websocket per DID (`w.websocket.duplicate-channel-refused`,
  `w.websocket.duplicate-channel`); a document one device concluded is
  gone for the other; one left unconcluded is handed to the other. Two
  further results are this binding's doing, not the mediator's: the two
  wires reconnect against each other for the whole run (the wire reopens
  its socket as soon as it closes), and the device without the socket
  cannot deposit (`transport-unreachable`: the wire deposits only on its
  socket). Run it on the local mediator.
- `live-shared-address-probe.mjs` — the same shared connection DID without
  those two habits of the binding, against the local test mediator (three
  runs, the same each time): a second session without a socket is
  admitted beside the device that holds it, which keeps its socket and is
  told of no duplicate; over HTTP that session fetches (`/fetch`) the
  document the first collected and has not concluded, and deposits
  (`/inbound`) a document the peer receives. When the first device does
  not reconnect after losing the socket, the second holds the unconcluded
  document about 30 ms after starting, deposits and is handed the peer's
  next document; the mediator reports one `duplicate-channel` to the
  device that yielded and nothing to the one that took over. For a
  recipient that is offline the mediator refuses the sender with
  `e.p.limits.queue.peer` (per-peer limit 50 in its configuration); of
  120 documents deposited the recipient was handed 8 on return, a number
  this probe does not explain.
- `live-device-addresses-probe.mjs` — the counterpart: one carrier nonce,
  so one connection DID, per device, and at the peer one leg per device.
  On 23 November 2026 against the local test mediator (below), three runs:
  the peer's document on both legs reaches both devices; a device that was
  offline gets its copy when it comes back, although the other concluded
  its own; both devices deposit at the same time and the peer gets both;
  a leg between the two devices carries a document each way; the mediator
  reports no duplicate websocket.
- `live-delivery-probe.mjs` — the full delivery contract live: a
  lib-sealed document, the staged `receive()`, a signed `delivery-ack/0.1`
  back, the trias closing `accepted → delivered`.
- `live-interop-probe.mjs` — the adapter against a foreign Trust Task
  consumer on the same mediator (`FOREIGN_DID`, its did:key; `EXPECT`
  `unsupportedType`, `next-step` or `indeterminate`): the consumer of
  `trust-protocol-interop-double` (Rust: `trust-tasks-rs` and
  `trust-tasks-tsp` 0.36.0, which write `trust-task-error/0.6`;
  `affinidi-tsp` 0.3.0) dispatches the carried
  document by its `type` without opening the seal and answers the
  authenticated sender; the probe files the document as a holder's
  custody entry (`reconcile`), checks that the adapter binds the answer
  and carries it in the collection (`collect().answers`, with the report a
  host records at its holder), that the answer stays at the mediator
  until `conclude` (it closes the opening without one and binds the
  redelivered answer in the next), and that nothing comes after the
  conclusion (profile RLTP-VTI-5065, 5070, 5080). `CROSS_OPENING=1` closes the adapter
  right after the acceptance and opens a new one over the same
  relationship, which files the document as the holder offers it for
  binding (RLTP-VTI-5065) and binds the answer the mediator kept;
  `REGISTER_FIRST=1` registers that opening before it reconciles, so the
  answer arrives first and is held until the reconcile. With
  `EXPECT=indeterminate` (the double with `--indeterminate`) the answer
  is a retryable `indeterminate`: the probe checks that it is bound to
  the carried document (the collection carries it for that submission
  with the diagnosis `{ code: 'indeterminate', retryable: true }` beside
  the unchanged `accepted` report), that the submission stays
  `accepted`, that it is acknowledged at the conclusion, and that a
  later opening receives nothing (profile RLTP-VTI-5020, 5080). The
  probe prints the type and code of every answer.

## Measurements

Mediator 0.45.0 at
`did:webvh:QmUTUkdHgppiciLpqcxkTi6Pbc9VuZzWXvH4L2Dk2dY2WL:mediator.web-of-trust.de`
(local direct delivery allowed), 27.10.2026, one run each:

| Probe | `routed` | `direct` |
|---|---|---|
| `live-probe.mjs` | PASS: 657 B payload → inner 984 B → outer 1392 B, delivered after 282 ms; reply 635 B → 963 B → 1371 B, 262 ms | PASS: 657 B → 984 B, 270 ms; 635 B → 963 B, 258 ms |
| `live-delivery-probe.mjs` | PASS: document 1105 B → 1434 B → 1842 B, ack 1647 B → 1974 B → 2382 B, deposit → ack validated 569 ms | PASS: 1105 B → 1434 B, ack 1646 B → 1974 B, 529 ms |

`live-interop-probe.mjs` (28.10.2026, profile 0.30, library 0.10.1,
the double on `trust-tasks-rs` and `trust-tasks-tsp` 0.36.0), each cell
one run: the answer bound by the carried document's `id`, carried in
the collection with its report, still at the mediator when the opening
closed without a conclusion (delivered again and bound again in the next
opening), acknowledged at the conclusion, and nothing delivered after it.
Every refusal arrived as `trust-task-error/0.6`.

| Variant | `routed` | `direct` |
|---|---|---|
| no handler (`unsupportedType`), same opening | PASS: `trust-task-error/0.6`, `failed(rejected-by-receiver(unsupportedType))` | PASS |
| no handler, `CROSS_OPENING=1` | PASS | PASS |
| no handler, `CROSS_OPENING=1 REGISTER_FIRST=1` | PASS | PASS |
| `--next-step`, same opening | PASS: `accepted`, `held` | PASS |
| `--next-step`, `CROSS_OPENING=1` | PASS | PASS |
| `--next-step`, `CROSS_OPENING=1 REGISTER_FIRST=1` | PASS | PASS |
| `--indeterminate` (`EXPECT=indeterminate`) | PASS: `trust-task-error/0.6` `indeterminate`, `retryable: true`; bound (diagnosis in the collection beside the unchanged report), stays `accepted`, acknowledged at the conclusion, nothing again | PASS |

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
RLTP_LIVE_MEDIATOR=1 FOREIGN_DID=did:key:... EXPECT=unsupportedType node live-interop-probe.mjs   # or next-step, indeterminate
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

## shared-connect (dev only)

Two command lines for the shared connection ceremony across apps
(`lib/src/shared-connect.ts`, `vectors/shared-connect.json`;
trustoverip/dtgwg-trust-tasks-tf#1034, dtgwg-vti-spec#86), both gated by
`RLTP_LIVE_MEDIATOR=1`:

Both CLIs carry frames only; the enactment itself runs in the library's step
machines (`sharedConnectFlow.Inviter` / `Responder`, `lib/src/shared-connect-flow.ts`),
the same code the app will use.

- `shared-connect-invite.mjs`: makes a per-encounter `did:peer:2` naming
  the mediator as its TSP relay, shows the link, logs in at the mediator
  under that DID, answers a relationship-forming XRFI from a sender it has
  never seen with XRFA while the link is live, accepts the propose, issues,
  receipts the counterpart's issue, writes every document to `--out`.
- `shared-connect-respond.mjs <link>`: the scanner side: logs in at the
  relay the link names under a fresh `did:peer:2`, sends XRFI and the
  propose, receipts the inviter's credential, issues, waits for the receipt.
- `shared-connect-loopback.mjs`: both sides in one process over real TSP
  frames, no network, once with did:peer:2 and once with did:peer:4.

Both CLIs take `--did peer2|peer4`. At `mediator.web-of-trust.de` only
`peer2` logs in: the mediator's authcrypt login does not resolve did:peer:4
(403 `e.p.message.unpack`, measured 6 November 2026).

Documents travel as TSP 1.0 `direct` messages (HPKE-Base to the
counterpart's X25519 key, signed by the sender's Ed25519 key, both from the
`did:peer:2`), inside the registry's TSP binding envelope
`{ type: "https://trusttasks.org/binding/tsp/0.1/envelope", document }`;
the inviter answers in the form the counterpart used (bare or enveloped).
The CLIs are dev runs: the inviter accepts the first valid propose without
a person confirming, where the app shows the (unverified) name from the
propose and asks first; `inviter.json` writes the handle (`_id`) to disk;
no `trust-task-error` (a decline) is handled. The mediator needs open
sign-up and direct delivery for logged-in senders,
which `deploy/mediator` in `real-life-org/web-of-trust` configures. A run
on 6 November 2026 against `mediator.web-of-trust.de` completed the
enactment in six seconds.
