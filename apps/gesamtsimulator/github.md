repo: real-life-org/trust-protocol
branch: main
path: apps/gesamtsimulator, simulator, lib

## Last sync
date: 2026-09-05

### Updated in this project
- The workbench is WIRED to `@real-life/trust-protocol` (frozen under `lib/`, a copy of `simulator/lib`, currently 0.3.2): one real `Person` per device, every act a real sealed document; graph/contacts/groups/artifacts derived from the devices. See README.md.
- Ceremony on the normative forms (encounter-bundle · counter-step · signed acks), optical fallback via `captureSentCard`, trust act + stars, continuity sweep (re-encounters chain), membership flow (prelude → invite → accept → welcome).
- Faults act on real envelopes; the wire shows real dispositions and the 6.2 stage.
- DeviceScreen: the verification badge is derived (⇄ / → / ← / ◇, introduced), no longer hardcoded.

## Screen map
| Project screen | Repo files |
| --- | --- |
| Workbench.dc.html — graph layer, forces, palette | simulator/graph.html |
| Workbench.dc.html — world, acts, channel | lib (ceremony · visibility · probe), simulator/network.html (reference host) |
| DeviceScreen.dc.html — app panes, ceremony screens | simulator/PhoneScreen.dc.html, simulator/network.html |
| DeviceScreen.dc.html — holds / artifact layer | the devices' real contents |

## Sync history
- 2026-09-05 — wired to the real library (0.3.0); README added.
- 2026-08-27T14:22:40Z — graph rebuilt on d3-force with graph.html's forces; real demo world and app design adopted.
- 2026-08-27T12:46:27Z — first import: workbench shell built from simulator/ and design-system/
