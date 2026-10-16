# RLTP Gesamtsimulator — the workbench, wired to the real protocol

A Claude Design project (`.dc.html` + `support.js` runtime). The workbench shows
one trust network from three cameras (God's eye · Outside · as a person), with
floating device windows that run the full app, a visible delivery channel with
fault injection, and per-device artifact sheets.

**Everything that happens, happens for real.** The world model is
`@real-life/trust-protocol` (frozen ESM under `lib/`, a copy of the repository's
`simulator/lib`): one holder per device (`createHolder` over an in-memory store,
its own seed, a personal community anchor, its name as its profile). Every act is
a human act on that holder; every document is a sealed envelope over the channel
into ONE `receive` of the device whose addresses hold its key; each device's
`resume` (and `tick`) runs on the clock and carries its retries and duties. The
graph, the contact lists, the group rosters and the artifact sheets are read from
the devices' views and state — nothing is invented.

| Act | Holder | On the wire |
|---|---|---|
| QR ceremony (show · scan · confirm · counter) | `show`, `scan`, `decide` on the `encounter-confirm` prompt | `encounter-bundle/0.1`, `encounter-credential-delivery/0.1`, signed `delivery-ack/0.1` |
| optical fallback (held ack) | `captureSentCard` | the sent card as a code — same enactment, other carrier |
| trust act (device button · ★ Trust) | `trust`; the mapping and the stars follow on `resume` | `anchor-mapping/0.3` (carrying `anchor-mapping@4`), `star/0.2`, `group-star/0.1`, MAC acks |
| re-encounter → one relationship | the continuity duties on `resume` | `continuity-probe/0.1`, `continuity-mapping/0.1` |
| groups (found · join by drag or ＋ Membership) | `foundGroup`, `invite`, `decide` on the `group-invite` prompt | prelude → `membership-invite/0.2` → `membership-accept/0.2` → welcome |
| introduction (＋ Introduction) | `introduce` by a device holding both, `decide` on the `introduction` prompts | `x-introduction-offer/0.1`, `introduction-request/0.1`, `-forward/0.1`, `-reply/0.1`, `-ack/0.1`, `-voucher/0.1` |
| god-mode verify (drag · ＋ Verification) | the same ceremony, run programmatically | same documents |

Faults act on the real envelopes: **Hold** parks them (the ack-wait then switches the
encounter to the optical leg), **Duplicate** delivers twice (the completed-effect cache
answers `duplicate-known`), **Flip a bit** corrupts the ciphertext (stage 3,
`failed(decryption-failed)`), **Lose** drops them (the sender's `resume` re-offers the
same envelope after its backoff). The wire list shows each
delivery's disposition and the Delivery Contract 6.2 stage where it ended.

The demo world (five people, four groups, the seeded encounters and trust acts)
is produced through the same acts at load time, silently.

## Files

- `Workbench.dc.html` — the workbench (graph, devices, channel, faults, god mode)
- `DeviceScreen.dc.html` — the app panes (contacts · groups · profile · ceremony screens)
- `support.js` — the Claude Design runtime (generated, do not edit)
- `lib/` — `@real-life/trust-protocol`, a byte-identical copy of `../../simulator/lib` (the committed freeze of `lib/dist`; CI checks the identity). The copy stays here so the folder also runs as a Claude Design project
  (`index.js` = the root with `createHolder` · `testing.js` = `InMemoryStore`, `memoryLog`, `stateBuilder`)
- `tests/local-perspective.mjs` — the end-to-end run: the person camera and the device app show only what that device holds

## Run locally

Serve the folder (any static server, e.g. `python3 -m http.server 8200`) and open
`Workbench.dc.html`. React 18 loads from unpkg (the runtime's default), d3-force
and the QR generator from jsdelivr.

## Host duties carried here

The workbench is in-memory: each device's store is an `InMemoryStore`, gone on reload.
It mints an `actId` per human act, routes each outbound envelope by its `rkid`,
reports the channel's acceptance (`report`), and calls each device's `resume` on the
clock — what an app with real storage and transport does the same way.

## Known simplifications (workbench policy, not protocol)

- A device decides its prompts after a beat: it confirms an encounter (the app would
  show the "verify back?" prompt), accepts a group invitation, and takes up or
  consents to an introduction.
- God mode's introduction is run by a device that holds both people; the target's
  name is the label its human types.
