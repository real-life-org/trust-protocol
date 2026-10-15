# Changelog

## 0.4.0

- `createHolder`: one person's device state behind typed human acts
  (`{when, actId}`, journaled), `receive`, `report`, `resume` and `tick`,
  with the views `contacts`, `contact`, `groups`, `profile`, `prompts`,
  `deliveryStatus` and `subscribe`. Results are a closed union with rule
  references; events are a closed union, issued after the commit.
- Ports: `Store` (compare-and-swap), `KeyProvider` (`seedKeys` by default),
  `Entropy` by closed purpose, `Log`, `Access`, `RetryPolicy`,
  `DeliveryReport`, pure-JSON `Outbound`. `storeContract` is the suite a
  Store adapter passes.
- Modules on the holder: identity (the register, device names, the
  community anchor's rotation over the Log port), trust (the trust act and
  the classes, the anchor mapping, the star and the group star, merge,
  split and departure, continuity, `profile@1`, the duties), encounter
  (`encounter-scan@0.25` with both paths), membership (founding, prelude,
  invite, admission, welcome, `vouch@2`) and introduction (Trust §8, three
  roles).
- Delivery: stages 1–9 once per envelope through a task register, the
  completed-effect cache with stored acks, the outbox with the status
  trias, retry by backoff, give-up at the horizon.
- State codec 1 with golden fixtures (`test/fixtures/`); a newer codec is
  `codec-newer`, a codec without a validator `codec-unknown`.
- Entry points: the root, `./testing`, `./internal`,
  `./adapters/vti-mediator`. `visibility` and `ceremony` carry pure wire
  builders and verifiers only. There is no `./probe` entry point.
- Invariant predicates over every commit (`invariants: true`) and a
  generator over random sequences of acts on two and three holders.
