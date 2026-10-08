# RLTP Conformance Runner

Recomputes every cryptographic claim of the shipped vectors and validates every schema claim. Run from the repository root with `npm run validate`.

- [`access-conflicts.mjs`](access-conflicts.mjs)
- [`dtg-vrc.mjs`](dtg-vrc.mjs) — *informative test tool:* checks a foreign plain DTG `RelationshipCredential` (DTG Credentials WD 0.6.0 base structure, `issuerScope`, `eddsa-jcs-2022`; `did:key` or `did:peer:2` issuer). Usage: `node conformance/dtg-vrc.mjs <file.json> …`. It makes no claim about which DID methods RLTP accepts.
- [`iut-simulator.mjs`](iut-simulator.mjs)
- [`ld-expand.mjs`](ld-expand.mjs)
- [`lib.mjs`](lib.mjs)
- [`runner.mjs`](runner.mjs)
- [`vwc-composition.mjs`](vwc-composition.mjs)

Back to the [specification index](../).
