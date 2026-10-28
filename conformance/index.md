# RLTP Conformance Runner

Recomputes every cryptographic claim of the shipped vectors and validates every schema claim. Run from the repository root with `npm run validate`.

- [`access-conflicts.mjs`](access-conflicts.mjs)
- [`dtg-vrc.mjs`](dtg-vrc.mjs) — *informative test tool:* checks a foreign plain DTG `RelationshipCredential` (DTG Credentials WD 0.6.0 base structure, `issuerScope`, `eddsa-jcs-2022`; `did:key` or `did:peer:2` issuer, the verification method listed under the proof's `proofPurpose`, which defaults to `assertionMethod` only when absent). Usage: `node conformance/dtg-vrc.mjs <file.json> …`. It makes no claim about which DID methods RLTP accepts.
- [`iut-simulator.mjs`](iut-simulator.mjs)
- [`ld-expand.mjs`](ld-expand.mjs)
- [`lib.mjs`](lib.mjs)
- [`runner.mjs`](runner.mjs)
- [`tf-proof-vectors.mjs`](tf-proof-vectors.mjs) — the Trust Tasks TF shared proof vectors (`vectors/tf-proof/`) as a standing profile comparison: each copy byte-identical to its upstream blob, the TF's expectation as recorded, the signature under its own suite without profile gates (`eddsa-jcs-2022`; `ecdsa-jcs-2019` over P-256 and P-384, on WebCrypto), and the RLTP verdict of the library's `diVerify` (the freeze `simulator/lib`) and of an oracle written from the profile's rules. Runs in `npm run validate`.
- [`vwc-composition.mjs`](vwc-composition.mjs)

Back to the [specification index](../).
