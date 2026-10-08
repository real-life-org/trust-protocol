---
title: Implement
description: The library on npm, the test vectors, and the conformance runner.
---

## The library

```sh
npm i @real-life/trust-protocol
```

[`@real-life/trust-protocol`](https://www.npmjs.com/package/@real-life/trust-protocol)
is the executable form of the specification, published with provenance.
Zero dependencies, WebCrypto only (Ed25519, X25519, HKDF, AES-256-GCM). It
runs in browsers, Node 20 and later, Deno and Bun. It has no DOM, no storage
and no network: the library computes and verifies, the host decides where
bytes live.

Its modules mirror the documents: `identity`, `encounter`, `delivery`,
`ceremony`, `visibility`, and beside them `core` and `crypto`.

```ts
import { ceremony, visibility } from '@real-life/trust-protocol'
import { introduce, membership } from '@real-life/trust-protocol/probe'
```

The `/probe` subpath carries the converged semantics of [introductions](term:Introduction) and
group membership, but its transport shapes are not wire-normative yet. Do not
treat them as an interoperability target.

The [library README](https://github.com/real-life-org/trust-protocol/tree/main/lib)
lists every module with the document it answers to.

## The test vectors

[`vectors/`](https://github.com/real-life-org/trust-protocol/tree/main/vectors)
holds deterministic test vectors: the sealed envelope, identity derivation,
encounter cards, DTG credentials, visibility. An implementation must
reproduce them byte for byte.

## The conformance runner

```sh
git clone https://github.com/real-life-org/trust-protocol
cd trust-protocol
node conformance/runner.mjs
```

The runner recomputes every cryptographic claim of the shipped vectors from
their documented inputs, validates every schema claim against the shipped
schemas, and checks that every negative fails at its declared stage. Zero
dependencies.

`npm run validate` runs the publication checks: schemas compile, vectors
recompute, and the must-fail fixtures fail.
