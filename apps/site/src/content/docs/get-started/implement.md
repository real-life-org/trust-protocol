---
title: Implement
description: The library on npm, the test vectors, and the conformance runner.
specs: [encounter-layer]
library: true
---

## The library

```sh
npm i @real-life/trust-protocol
```

[`@real-life/trust-protocol`](https://www.npmjs.com/package/@real-life/trust-protocol)
is the executable form of the specifications, published with provenance. It
has no runtime dependencies and uses WebCrypto only (Ed25519, X25519, HKDF,
AES-256-GCM). It has no DOM, no storage and no network: the library computes
and verifies, the app stores the state and carries the envelopes. Node 20 is
the minimum; which runtimes are tested is in the
[library README](https://github.com/real-life-org/trust-protocol/blob/main/lib/README.md#runtime).

## One device, one holder

`createHolder` is one person's device. The app passes a store and the keys
derived from the person's root seed; the holder keeps its state behind the
human acts.

```ts
import { createHolder, seedKeys } from '@real-life/trust-protocol'
import { InMemoryStore } from '@real-life/trust-protocol/testing'

const rootSeed = crypto.getRandomValues(new Uint8Array(32))
const holder = await createHolder({ store: new InMemoryStore(), keys: seedKeys(rootSeed) })

// a human act: the person shows their contact card
const shown = await holder.show({ when: Date.now(), actId: crypto.randomUUID() })
if (shown.ok) {
  // shown.events: what to display; shown.outbound: the envelopes to deliver
}
```

Every act returns the envelopes to deliver and the events to display, or a
closed error code. The app delivers each envelope and passes every arriving
one to `receive`. Acts, receives and resumes name `nextDueAt`, the earliest
time something is due; the app keeps one timer at the earliest of them, and
when it fires calls `tick` and then `resume`, delivers what `resume` returns
and sets the timer anew. A transport that must survive a lock or the end
of the process resumes the holder first, then takes what it sends from
`pendingTransport`, which names every document the holder still keeps for
transport, and starts each send inside `handOver(entry, when, start)`, so
the holder's check and the start of the send are one step (the VTI
mediator adapter does this in `reconcile(view, holder, now)`;
`mayHandOver` is the check alone and authorizes nothing afterwards). At
the lock it awaits `close`, which returns once the holder's running
operation has finished; only then does the next opening, a new holder over
the same store, begin. The VTI mediator adapter keeps the relationship's
send state in its `ackState()` (the sending mode, the open routed deposits,
the routed acknowledgements sent); the app persists it with the ack state,
restores it into the adapter of the next opening, and hands that adapter
the answers for earlier deposits through `answered(digest, now)` before its
next `advance` (see the
[library README](https://github.com/real-life-org/trust-protocol/blob/main/lib/README.md)). An app that does not know whether a human act
committed (a crash, a lock) asks `replay(actId, when)`, which answers the
act's journaled result or `unknown-act` and never runs the act again.
`InMemoryStore` is for tests;
an app brings its own store, which passes the `storeContract` suite.

The [library README](https://github.com/real-life-org/trust-protocol/blob/main/lib/README.md)
lists every act, every export and entry point, and for each module the
sections of the specifications it implements.

## The test vectors

[`vectors/`](https://github.com/real-life-org/trust-protocol/blob/main/vectors/index.md)
holds deterministic test vectors for every layer, each listed with what it
covers. An implementation must reproduce them byte for byte; every negative
must fail at its declared stage.

## The conformance runner

```sh
git clone https://github.com/real-life-org/trust-protocol
cd trust-protocol
node conformance/runner.mjs
```

The runner recomputes every cryptographic claim of the shipped vectors from
their documented inputs, validates every schema claim against the shipped
schemas, and checks that every negative fails at its declared stage. It needs
no install.

After `npm ci`, `npm run validate` runs the publication checks: schemas
compile, vectors recompute, the must-fail fixtures fail, and the references
from the documentation into the specifications resolve.
