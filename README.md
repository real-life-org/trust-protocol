# RLTP — Real Life Trust Protocol

**Specifications, schemas, and test vectors** for a decentralized trust
protocol rooted in **encounters between people**: two humans meet,
recognize each other, and record that recognition as verifiable
credentials. Trust is anchored in real meetings rather than in a
certifying institution. Cryptography proves freshness and authorship;
only a human can witness a human.

Published by the [Real Life Organisation](https://real-life.org). RLTP is
the third generation of this protocol and runs in the
[Web of Trust app](https://github.com/real-life-org/web-of-trust/tree/main/apps/wot-v3),
available in the [App Store](https://apps.apple.com/de/app/web-of-trust/id6829947239)
and from our own [F-Droid repository](https://fdroid.utopia-lab.org/fdroid/repo/).
The second generation,
[`wot-spec`](https://github.com/real-life-org/wot-spec), was its field
test at festivals and community gatherings.

## What is different about it

- **Groups are first-class protocol objects.** A group is not a set of
  membership claims in individual wallets but a *place*: an encrypted
  document replicated on every member's device, with its own log of
  who joined, who left, and which rules apply. Membership is a fact in
  that state and a capability (holding the key), not a certificate.
- **Rooms and invitations, not checkpoints.** Nobody presents a
  credential at a door. A person consults their own graph ("through
  whom do we know each other?") and invites. The verifier is always the
  host, nothing portable results from the check, and no third party
  keeps a log of it.
- **There are no admins.** Privileged operations are gated by a
  decision rule the group states as data; a single founder is the
  k = 1 special case. Contested authority never picks a winner: the
  group fails closed, visibly, until a quorum of both branches
  reconciles.
- **Revocation is an epoch.** A removal carries its key-world
  transition atomically. No expiry dates, no caches that keep working.
- **Relationships never converge into a person.** Every relationship
  has its own anchor and, toward every carrier, its own principal. A
  relay holding six of your relationships holds six relationships.

These points describe the design the specification texts set out. <!-- now:groups -->The library and the app run a membership log replicated among the members, with founding, admission and leaving; removal, rule changes, epoch transitions and key changes are not built ([status](https://github.com/real-life-org/trust-protocol/blob/main/spec/status.json)).<!-- /now:groups -->

## Try it in your browser

Two simulators, no installation, everything running locally in your
tab — real Ed25519/X25519/AES-GCM, no mocked crypto:

- **[The workbench](https://web-of-trust.de/simulator/)** — the real
  Web of Trust app on several phones in one trust network: meet, verify,
  give trust. The graph from above or through one person's eyes, a
  clock, and every envelope on the wire.
- **[The ceremony](https://trust-protocol.real-life.org/simulator/index.html)** —
  one encounter under the microscope: two devices, one delivery
  channel, every receive stage, clock skew.

Everything a person sees in the app is a function of what their own
device holds. No identifier is correlatable across relationships:
every encounter mints fresh pairwise anchors, and a blinded continuity
probe re-recognizes an existing relationship afterwards — so meeting
the same person twice normally produces one contact, not two, without any
stable identifier travelling. <!-- now:continuity -->In the library a hit of the continuity probe chains nothing yet; a re-encounter is chained into the existing relationship once the continuity mapping that follows is processed. Two re-encounters at the same time can leave relationships unchained on both sides (test `one-sided chaining`).<!-- /now:continuity -->

## The shape of it

| Layer | Concern |
|---|---|
| 5 Data | items, relations, schema composition, portability (not published yet) |
| 4 Access | groups as places, policy, epochs, authorization views toward services |
| 3 Trust | trust classes, stars, anchor mappings, profile, continuity, introductions |
| 2 Encounter | ceremony, encounter credentials, contact cards |
| 1 Identity | anchors per context, devices, recovery |

Delivery and Replication are **services behind ports**, not layers.
The specification names no transport and no CRDT. A substrate is
judged against five fixed doors (signed causal DAG, atomic
enforcement, view-shaped authorization, fail-closed concurrency,
attested convergence target) and either carries a door natively,
needs an adapter, or is excluded; Replication Contract §10 maps
p2panda, Keyhive, SECSYNC, NextGraph and Automerge against them. The
first delivery adapter binds TSP through the VTI mediator. <!-- now:vti-adapter -->The library implements this adapter; the wire binding under `binding/` has live probes against a public development instance of the mediator.<!-- /now:vti-adapter -->

## What is in this repository

| Path | Content |
|---|---|
| [`spec/encounter-layer.md`](spec/encounter-layer.md) | **RLTP Encounter Layer** — how two people establish, record, and maintain mutual recognition: the ceremony `encounter-scan` (a connected and an offline path), contact cards, challenges, the own-challenge state model, the enactment binding, encounter credentials, edges |
| [`spec/delivery-contract.md`](spec/delivery-contract.md) | **RLTP Delivery Contract** — how documents travel: private Trust Task types (`encounter-bundle`, `delivery-ack`, `encounter-credential-delivery`), the sealed envelope, staged dispositions, delivery promises |
| [`spec/membership-tasks.md`](spec/membership-tasks.md) | **RLTP Membership Tasks** — how membership changes travel: invitation, explicit consent (`membership-invite`, `membership-accept`, `membership-evidence`), the `access-operation` carrier narrowed to the one operation that crosses the replica boundary — the admitting `member.add` delivered to its own subject — with the admission chain (provable invitation provenance), and the welcome seal |
| [`spec/message-tasks.md`](spec/message-tasks.md) | **RLTP Message Tasks** — direct messages between the two parties of a relationship (`message/0.1`, MAC under a directional relationship key, deniable), the completion record that keeps a message from appearing twice, and the block a holder applies to a relationship |
| [`spec/access-layer.md`](spec/access-layer.md) | **RLTP Access Layer** — how a group holds shared authority over its membership, data, and itself: the authority log (a causally linked DAG whose genesis digest *is* the group's identity), policies as group-defined decision rules, epochs that make revocation real, chained quorum-signed authorization views toward services, and the enforcement port that keeps the replication/key-agreement substrate replaceable |
| [`spec/identity-layer.md`](spec/identity-layer.md) | **RLTP Identity Layer** — one root seed, every identity derived: the community anchor of the person's personal community, each generation bound in advance to the next (pre-rotation), per-relationship pair anchors, per-group member anchors, derived service identities; contexts never link without their holder's deliberate act. <!-- now:identity -->With the library's default key provider `seedKeys`, the person's anchors are derived from a root seed given as bytes, which the Identity Layer text (§4) derives from the words; each anchor is a `did:key`, and an app may bind another key provider.<!-- /now:identity --> The model is planned to change; see the [direction note](spec/direction/identity.md). |
| [`spec/replication-contract.md`](spec/replication-contract.md) | **RLTP Replication Contract** — the service contract behind the Access Layer's replication port: sixteen promises over individually signed, causally linked entries — attested convergence targets, one ingest admission for every road, immutable verdicts under merge-revisable canonicality dispositions, key-blind by construction; the substrate that moves the bytes stays outside the trusted computing base |
| [`spec/trust-layer.md`](spec/trust-layer.md) | **RLTP Trust Layer** — what a person reveals to a contact and how far it travels: trust classes, stars, anchor mappings (`anchor-mapping@4` with `self-card@2`), the rotation of the community anchor (`anchor-rotation@2`), the profile, continuity, introductions, and the audience discipline the other layers build on |
| [`spec/personhood-predicates.md`](spec/personhood-predicates.md) | **RLTP Personhood Predicates** — verifier-relative witnessing predicates over encounter credentials: what "a human vouched for a human" can and cannot prove |
| [`spec/succession.md`](spec/succession.md) | **RLTP Succession** (parked draft) — recovering a person's anchor by the act of several people when the seed is lost |
| [`schemas/`](schemas/) | Normative JSON Schemas for every wire artifact |
| [`contexts/`](contexts/) | The pinned RLTP JSON-LD context |
| [`vectors/`](vectors/) | Deterministic test vectors (seal, identity derivation, encounter cards, DTG credentials, the trust layer, the profile) — implementations MUST reproduce them byte-for-byte |
| [`conformance/`](conformance/) | Conformance runner — recomputes every cryptographic claim of the shipped vectors and validates every schema claim; negatives must fail at their declared stage |
| [`interop/ceremonies/`](interop/ceremonies/) | RLTP ceremonies expressed in the ToIP DTGWG ceremony-definition format |
| [`simulator/`](simulator/) | Interactive browser simulator of the full ceremony (both paths, fault injections) + a Node reference engine |
| [`lib/`](lib/) | The library [`@real-life/trust-protocol`](https://www.npmjs.com/package/@real-life/trust-protocol): the executable form of the specifications |
| [`apps/gesamtsimulator/`](apps/gesamtsimulator/) | The workbench: one trust network, device windows running the app, a visible channel with fault injection — everything on the real library |
| [`scripts/validate.mjs`](scripts/validate.mjs) | Publication checks: schema compilation, vector recomputation, and conformance fixtures that MUST fail |

## Status

All documents are **Editor's Drafts**. Design happens in test benches and
in the library, and a specification text follows from what runs.

<!-- spec-status:begin (generated by scripts/build-spec-status.mjs from spec/status.json; do not edit) -->
The texts under [`spec/`](spec/) are frozen at the version named below and are not edited, apart from a generated status block at their top. They are brought up to date one flow at a time. What holds, part by part, is in [`spec/status.json`](spec/status.json). *Built* means the library implements the part; the texts have not been reconciled with the library rule by rule, so single rules may differ. Where a specification text and the library disagree, the library with its vectors and flows holds until the text is brought up to date.

| Document | Version | State | Last reconciled |
|---|---|---|---|
| [Identity Layer](spec/identity-layer.md) | 0.55.0-draft | Partly built; direction changed ([direction](spec/direction/identity.md)) | not reconciled |
| [Encounter Layer](spec/encounter-layer.md) | 0.32.0-draft | Built; its ceremony is superseded in the app | not reconciled |
| [Trust Layer](spec/trust-layer.md) | 0.31.0-draft | Built, with the gaps listed | not reconciled |
| [Access Layer](spec/access-layer.md) | 0.58.0-draft | Mostly not built; the stage-1 group log is built | not reconciled |
| [Membership Tasks](spec/membership-tasks.md) | 0.21.1-draft | Mostly built; one part built differently, two in part | not reconciled |
| [Message Tasks](spec/message-tasks.md) | 0.2.0-draft | Partly built | not reconciled |
| [Delivery Contract](spec/delivery-contract.md) | 0.85.2-draft | Built, with the gaps listed | not reconciled |
| [VTI mediator adapter](spec/adapter-vti-mediator.md) | 0.30.0-draft | Built, with one deviation and the gaps listed | not reconciled |
| [Replication Contract](spec/replication-contract.md) | 0.26.0-draft | Not built as a contract; parts used by the group log | not reconciled |
| [Personhood Predicates](spec/personhood-predicates.md) | 0.12.0-draft | Not verified | not reconciled |
| [Succession](spec/succession.md) | 0.2.0-draft | Parked; direction changed ([direction](spec/direction/identity.md)) | not reconciled |
<!-- spec-status:end -->

<!-- now:encounter-ceremony:long -->
`encounter-scan`, the ceremony of the Encounter Layer, is superseded: the Web of Trust app connects people with `shared-connect` instead ([web-of-trust#555](https://github.com/real-life-org/web-of-trust/pull/555), [`apps/wot-v3/src/adapters/rltp/index.ts`](https://github.com/real-life-org/web-of-trust/blob/af18d3df0e02b1b924df9670076c63b6195f2857/apps/wot-v3/src/adapters/rltp/index.ts#L60-L65)). It is defined in [`interop/ceremonies/`](https://github.com/real-life-org/trust-protocol/tree/main/interop/ceremonies) with its vector and implemented as holder acts in the library; no specification text describes it yet ([status](https://github.com/real-life-org/trust-protocol/blob/main/spec/status.json)).
<!-- /now:encounter-ceremony -->

The identity model is
planned to change; the [direction note](spec/direction/identity.md) says
how. <!-- now:direction-identity:long -->The library has neither identifiers with a log nor linked devices, generated personal keys or guardians.<!-- /now:direction-identity -->

What the Access Layer text sets out, in its own words: **there are no
admins** (privileged operations are gated by group-defined policy);
**the merge never decides membership** (every admission canonical at
its position is final); **revocation is honest** (a removal carries
its key-world transition atomically, and what rotation cannot
guarantee is stated rather than implied); and **the substrate is a
port** (replication and group key agreement are requirements on a
replaceable adapter).

## Alignment with the ToIP DTGWG

RLTP deliberately aligns with the emerging ToIP Decentralized Trust
Graph work where the two effort meet:

- **Vocabulary:** *ceremony* (definition) / *enactment* (run) / *step*
  follow DTGWG ADR 0001.
- **Co-derived enactment anchors:** the RLTP enactment binding is a
  concrete instantiation of the `coDerived` anchor of the Trust
  Ceremonies design; the DTGWG registry's
  [`mutual-attestation/0.1`](https://github.com/trustoverip/dtgwg-trust-tasks-tf/blob/main/ceremonies/mutual-attestation/0.1/ceremony.json)
  is the upstream expression of RLTP's mutual encounter.
- **Digests:** every digest is a multibase-encoded multihash over
  JCS (RFC 8785), format-identical to `digestMultibase` — emit `u`,
  accept `u`/`z` per W3C CID 1.0.
- **Proofs:** embedded `DataIntegrityProof` with `eddsa-jcs-2022` — no
  RDF processing, offline-verifiable.
- **Messages:** RLTP delivery documents are private Trust Task
  specifications (framework 0.6.0, §6.5), named `https://real-life.org/trust-tasks/spec/<slug>/<version>`.
- **Roles:** in DTGWG terms the Web of Trust app is a *PNM* (Personal
  Network Manager): local-first, keys on the device, no hosted agent
  (VTA) required, interoperable through Trust Tasks.

Where RLTP differs, it differs deliberately and says why in the
specifications themselves: participant recognition rather than
third-party witness, per-relationship anchors with blinded continuity
rather than a stable identifier per person, and honestly stated
correlation properties.

## Design principles (the short version)

- **Issuance counts, arrival does not.** Documents may travel for an
  unbounded time; validity is a function of signed issuance-time data.
- **Clock tolerance never rejects.** Real devices drift; every gate
  widens.
- **Validate, then consume.** Nothing consumes single-use material
  before the content fully validates.
- **Authenticity always has exactly one carrier.**
- **Every mechanism names its user action.** In the encounter
  ceremony `encounter-scan` the user actions are two: exchange cards,
  confirm recognition.

## Term register

The vocabulary terms of this specification are also published as a SKOS concept
scheme, [`terms/rltp.skos.jsonld`](terms/rltp.skos.jsonld) (JSON-LD, namespace
`https://real-life.org/rltp/v1#`, label and one-sentence definition in English
and German, source section per term). The specification files stay normative,
except where they and the library disagree: there the library holds (see
[Status](#status)); the scheme is their machine-readable digest. Mappings to the terms of the Real
Life Network Protocol and the Real Life Stack live in the shared register,
[real-life-org/meta](https://github.com/real-life-org/meta), not here.

## License

The specification text in [`spec/`](spec/) and the vocabulary in
[`terms/`](terms/) are licensed under
[Creative Commons Attribution 4.0](LICENSE-SPEC) (CC BY 4.0). Everything else,
including the library, schemas, contexts, vectors, fixtures, the conformance
suite, the simulators, the apps and the scripts, is licensed under the
[Apache License 2.0](LICENSE).

Copyright 2026 Anton Tranelis and trust-protocol contributors.

## Implementations

- **Library:** [`@real-life/trust-protocol`](https://www.npmjs.com/package/@real-life/trust-protocol),
  published with provenance from its tag: one person's device as
  a holder; its acts and the parts of each specification it implements are listed in [`lib/README.md`](https://github.com/real-life-org/trust-protocol/blob/main/lib/README.md) and in the [status](https://github.com/real-life-org/trust-protocol/blob/main/spec/status.json).
- **Simulators:** [`simulator/`](simulator/) and the workbench
  [`apps/gesamtsimulator/`](apps/gesamtsimulator/), both on the real
  library.
- **Web of Trust app:** a demonstration of the protocol on iOS and
  Android, built on the library: in the
  [App Store](https://apps.apple.com/de/app/web-of-trust/id6829947239) and
  from our own [F-Droid repository](https://fdroid.utopia-lab.org/fdroid/repo/)
  (not the official F-Droid catalogue); source in
  [`real-life-org/web-of-trust`](https://github.com/real-life-org/web-of-trust/tree/main/apps/wot-v3).
- **An independent implementation** is the goal, not yet a fact. The
  [vectors](vectors/) and the [conformance runner](conformance/) are the
  test it would have to pass.

## Contact

Anton Tranelis · mail@antontranelis.de
