# Direction: identity

**Not built, not normative, may change.** Dated 2026-11-28.

This note says where the identity model of RLTP is heading. It is not a
specification. <!-- now:direction-identity:long -->The library has neither identifiers with a log nor linked devices, generated personal keys or guardians.<!-- /now:direction-identity --> What holds today is the library and
[`spec/status.json`](../status.json).

## What runs today

<!-- now:identity:long -->
The library's seed key provider derives a person's long-lived anchor keys from one root seed. Each anchor context (a relationship, a group, a persona) has its own key, derived from the seed and the context's label, and the context's identifier is a `did:key` of that key; device keys are derived per device within an anchor context.
<!-- /now:identity -->
<!-- now:holder -->
One holder holds one identity: two stores over one root seed hold two states that never reconcile, so a second device or a second app of the same person cannot hold that identity yet ([`lib/README.md`, "The holder"](https://github.com/real-life-org/trust-protocol/blob/main/lib/README.md#the-holder)).
<!-- /now:holder -->

## Assumptions that are being retired

The published [Identity Layer](../identity-layer.md) rests on four
assumptions that the planned model gives up:

- the words (the mnemonic) are the root of every identity (its Section 4);
- an identifier is its key: an anchor is a `did:key` and cannot rotate as
  an identifier (its Section 8);
- every key is derived from the seed and a context label (its Sections 5
  and 6);
- recovery requires the words, together with a copy of the person's state
  (its Section 9).

Of these four, <!-- now:direction-assumptions -->the library follows the first three for the person's anchors.<!-- /now:direction-assumptions --> <!-- now:recovery:long -->The library implements neither the recovery derivation nor the recovery of a whole identity from the words and a copy of its state, nor the synchronization of that state; it does implement the recovery of a lost carrier entry. It opens a holder from its root seed and its saved state, and needs both.<!-- /now:recovery --> New work should not treat these
assumptions as lasting.

## Where it is heading

- **An identifier with a log.** An identifier keeps its name across a key
  change; its history is a log, not a chain of new identifiers. A key
  change is the remedy when a key may be in someone else's hands, not a
  part of every lost device.
- **A main device and linked devices.** This is the standard arrangement,
  with no setting to switch on. The main device, usually the phone, adds
  and removes devices and changes keys. Linked devices do everything else:
  read, write, answer, join groups. A relationship made on a linked device
  is bound by that device to a key it draws itself and handed to the main
  device at the next sync.
- **Generated keys.** Keys are generated, not derived from the words, and
  linked devices hold no seed. A random secret, not derived from the words,
  decides who may write the next state of each context. The words become
  one replaceable holder of that secret among several (the main device,
  the guardians together, later a passkey or a hardware key); ideally
  there are no words at all.
- **Keys per device in groups.** Each device of a person keeps its own key
  in each group.
- **Guardians.** A person may choose guardians who together hold shares of
  that secret, so that after losing every device and the words the same
  identity continues. Guardians confirm a recovery only when they meet the
  person; two of three is the default. Moving to a new identifier with the
  guardians' backing, the subject of the parked
  [Succession](../succession.md) draft, remains only as the last resort.

## Order

The planned order, without dates:

1. Several devices with today's seed.
2. Device keys in groups.
3. Generated instead of derived keys; no seed on linked devices; the secret
   that decides who writes next; a contract for the person's own state.
4. Identifiers with a log and key change, coordinated with other
   implementations.
5. Guardians holding shares.

The experimental login identity of the library
([`lib/DEVIATIONS.md`](https://github.com/real-life-org/trust-protocol/blob/main/lib/DEVIATIONS.md), D6) is replaced at
stage 3. Each stage appears in [`spec/status.json`](../status.json) when
it is built.
