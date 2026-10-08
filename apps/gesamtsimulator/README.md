# RLTP Gesamtsimulator — the workbench, wired to the real protocol

A Claude Design project (`.dc.html` + `support.js` runtime). The workbench shows
one trust network from three cameras (God's eye · Outside · as a person), with
floating device windows that run the full app, a visible delivery channel with
fault injection, and per-device artifact sheets.

**Everything that happens, happens for real.** Since 05.09.2026 the world model
is `@real-life/trust-protocol` (frozen ESM under `lib/`, a copy of the repository's `simulator/lib`, currently 0.3.2): one `Person` per
device; every act is a real sealed document over the channel; the graph, the
contact lists, the group rosters and the artifact sheets are DERIVED from what
the devices hold — nothing is invented.

| Act | Library | On the wire |
|---|---|---|
| QR ceremony (show · scan · confirm · counter) | `ceremony` (Encounter 0.31 on Delivery 0.79) | `encounter-bundle/0.1`, `encounter-credential-delivery/0.1`, signed `delivery-ack/0.1` |
| optical fallback (held ack) | `ceremony.captureSentCard` | the sent card as a code — same enactment, other carrier |
| trust act (device button · ★ Trust) | `visibility.trust.setTrust` + `starRefreshAll` | `anchor-mapping/0.2` (carrying `anchor-mapping@3`), `grade-declaration/0.1`, `star/0.1`, MAC acks |
| re-encounter → one relationship | `visibility.continuity` (probe/mapping sweep) | `continuity-probe/0.1`, `continuity-mapping/0.1` |
| groups (found · join by drag or ＋ Membership) | `/probe` `membership` | prelude → invite → `membership-accept/0.2` → welcome |
| god-mode verify (drag · ＋ Verification) | the same ceremony, run programmatically | same documents |

Faults act on the real envelopes: **Hold** parks them (the ack-wait then switches the
encounter to the optical leg), **Duplicate** delivers twice (the completed-effect cache
answers `duplicate-known`), **Flip a bit** corrupts the ciphertext (stage 3,
`failed(decryption-failed)`), **Lose** drops them. The wire list shows each
delivery's disposition and the Delivery Contract 6.2 stage where it ended.

The demo world (five people, four groups, the seeded encounters and trust acts)
is produced through the same acts at load time, silently.

## Files

- `Workbench.dc.html` — the workbench (graph, devices, channel, faults, god mode)
- `DeviceScreen.dc.html` — the app panes (contacts · groups · profile · ceremony screens)
- `support.js` — the Claude Design runtime (generated, do not edit)
- `lib/` — `@real-life/trust-protocol`, a byte-identical copy of `../../simulator/lib` (the committed freeze of `lib/dist`; CI checks the identity). The copy stays here so the folder also runs as a Claude Design project
  (`index.js` = root: `ceremony`, `visibility`, primitives · `probe.js` = introduce, membership)

## Run locally

Serve the folder (any static server, e.g. `python3 -m http.server 8200`) and open
`Workbench.dc.html`. React 18 loads from unpkg (the runtime's default), d3-force
and the QR generator from jsdelivr.

## Host duties carried here

The library proves the protocol logic, not persistence. The workbench is in-memory;
the duties an app with real storage must carry (atomic writes, resume before flush,
ack/mutual correlation) are listed in the workshop handoff
(kept in the private design workshop).

## Known simplifications (workbench policy, not protocol)

- A device that receives a bundle confirms back after a beat (the app would show the
  "verify back?" prompt). A device that receives a group invitation accepts it.
- Re-encounters are chained by a continuity sweep that runs once the act's burst has
  settled (bounded follow-up rounds, spaced like the reference host's ticks). One trust
  act therefore costs the protocol's 8–9 deliveries on the wire: mapping + grade with
  their acks, then one blinded star per side with its ack.
