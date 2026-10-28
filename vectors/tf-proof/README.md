# Trust Tasks TF shared proof vectors

The seven signed documents and `manifest.json` in this directory are
copied unchanged from the Trust Tasks framework repository of the ToIP
Decentralized Trust Graph Working Group:

- repository: <https://github.com/trustoverip/dtgwg-trust-tasks-tf>
- path: `fixtures/proof/`
- commit: `adf094757cf822702d9b1c2b6093db5531b7aa94` (2026-10-28)
- framework text: `SPEC.md` at that commit, Working Draft 0.7.0,
  §4.7 (What a consumer verifies), §4.7.1 (Cryptosuites), §4.7.3
  (Proof Purpose and Verification Relationship)

`rltp-profile.json` names the upstream git blob of every copied file;
`conformance/tf-proof-vectors.mjs` checks that each copy is byte-identical
to it. To take up a later commit, copy the files again, update the
blobs, the commit and each case's TF expectation in `rltp-profile.json`,
and run `npm run validate`.

`rltp-profile.json` is this repository's own file: the RLTP reading of
each vector (the TF's expectation, whether the signature holds under its
own suite without profile gates, and the RLTP verdict with the rule that
decides it).

## Licence

The copied files are the work of the contributors to
`trustoverip/dtgwg-trust-tasks-tf` and are code-tree fixtures of that
repository, published under the Apache License, Version 2.0
(`SOURCE_CODE.md` there). They are redistributed unchanged under it, with
this notice as the attribution. The framework specification itself is
under CC BY 4.0, and OWFa 1.0 (`LICENSE.md` there) covers the copyright
and patent rights in that specification.
`rltp-profile.json` and this README are under this
repository's licences.
