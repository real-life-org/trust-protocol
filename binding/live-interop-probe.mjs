#!/usr/bin/env node
// live-interop-probe.mjs — the adapter (profile 0.29) against a FOREIGN
// Trust Task consumer over the live mediator: one sealed envelope carried
// as a sealed-envelope/0.1 document in the registry's TSP binding envelope
// (§3b) to the consumer's TSP identifier, and the consumer's answer read
// back by the adapter (§5): a trust-task-error/0.5 `unsupportedType`
// fails the submission as rejected-by-receiver(unsupportedType)
// (RLTP-VTI-5040, 5010); a trust-task-next-step/0.1 makes it accepted and
// held (RLTP-VTI-5050). The consumer is the test double of
// trust-protocol-interop-double (trust-tasks-rs / trust-tasks-tsp 0.35.4,
// affinidi-tsp 0.3.0, TSP 1.0) on the same mediator; it is run by the
// tester, never started from here. Prints the measurements. No secrets.
//
// Network-gated: RLTP_LIVE_MEDIATOR=1; MEDIATOR_DID names a TSP 1.0
// mediator (>= 0.45) with local direct delivery allowed; FOREIGN_DID the
// consumer's did:key (its DOUBLE_READY line); EXPECT `unsupportedType`
// (default) or `next-step`; RLTP_WIRE_DEPOSIT `routed` (default) or `direct`;
// CROSS_OPENING=1 closes the adapter right after the deposit is accepted and
// opens a new one over the same relationship, which binds the answer to the
// document the holder offers for binding (RLTP-VTI-5045, Delivery RLTP-DEL-6150);
// with REGISTER_FIRST=1 the new opening registers (and receives the answer)
// before it reconciles: the adapter holds the answer until the reconcile.

import { MediatorCarrierAdapter } from "../lib/dist/adapters/vti-mediator.js";
import { jcs } from "../lib/dist/core.js";
import { createVtiWire } from "./vti-wire.mjs";

if (process.env.RLTP_LIVE_MEDIATOR !== "1") {
  console.log("live-interop-probe: skipped (set RLTP_LIVE_MEDIATOR=1)");
  process.exit(0);
}
const MEDIATOR_DID = process.env.MEDIATOR_DID;
const FOREIGN_DID = process.env.FOREIGN_DID;
const EXPECT = process.env.EXPECT ?? "unsupportedType";
if (!MEDIATOR_DID || !FOREIGN_DID || !["unsupportedType", "next-step"].includes(EXPECT)) {
  console.error("live-interop-probe: set MEDIATOR_DID (a TSP 1.0 mediator), FOREIGN_DID (the consumer's did:key) and EXPECT (unsupportedType | next-step)");
  process.exit(2);
}

const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const b64u = (b) => Buffer.from(b).toString("base64url");
const say = (...a) => console.log(...a);
const fail = (m) => { console.error(`✗ ${m}`); process.exit(1); };
const waitFor = async (pred, ms = 30000, step = 200) => {
  const t0 = Date.now();
  for (;;) { if (pred()) return true; if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); }
};

say("── live interop probe: RLTP adapter → foreign Trust Task consumer → answer ──");
say(`  mediator (C): ${MEDIATOR_DID}`);
say(`  consumer:     ${FOREIGN_DID}`);
say(`  deposit form: ${process.env.RLTP_WIRE_DEPOSIT ?? "routed"}; expected answer: ${EXPECT}`);

const root = rand(32); const nonce = rand(32);
const logged = [];
const wire = await createVtiWire({ rootIkm: root, mediatorDid: MEDIATOR_DID, nonce, peerDid: FOREIGN_DID, log: (l) => { logged.push(l); say(`  · ${l}`) } });
const a = await MediatorCarrierAdapter.create(root, MEDIATOR_DID, nonce, wire);
a.register([], Date.now());
await a.settle();
say(`  ✓ admitted under the connection DID ${a.connectionDid}`);

// a sealed envelope of the schema's form; the consumer never opens it
const seal = { rkid: "z6LStLK2kxribiLHz6U4vpGfzMtmgc4q5WjR4mvhS6KG1W16", epk: b64u(rand(32)), nonce: b64u(rand(12)), ciphertext: b64u(rand(48)) };
const t0 = Date.now();
const id = a.submit(new TextEncoder().encode(jcs(seal)), t0);
await a.settle();
const frame = wire.sentFrames().at(-1) ?? {};
if (a.status(id)?.state !== "accepted") fail(`deposit not accepted: ${JSON.stringify(a.status(id))}`);
say(`  ✓ carried document deposited and accepted (mode ${frame.mode}: payload ${frame.payload}B, inner ${frame.inner}B, outer ${frame.outer ?? "-"}B)`);

let a2 = a;
let wire2 = wire;
let ref = id;
if (process.env.CROSS_OPENING === "1") {
  // the opening ends before the answer is taken: the frame stays at the mediator
  a.close(); wire.close();
  say("  ✓ opening 1 closed after the acceptance");
  await new Promise((r) => setTimeout(r, 3000));
  wire2 = await createVtiWire({ rootIkm: root, mediatorDid: MEDIATOR_DID, nonce, peerDid: FOREIGN_DID, log: (l) => { logged.push(l); say(`  · ${l}`) } });
  a2 = await MediatorCarrierAdapter.create(root, MEDIATOR_DID, nonce, wire2);
  if (process.env.REGISTER_FIRST === "1") {
    a2.register([], Date.now());
    await a2.settle();
    await new Promise((r) => setTimeout(r, 3000));
    a2.advance(Date.now()); await a2.settle();
    say("  ✓ opening 2 registered first; the answer has arrived and waits in the adapter");
  }
  // the holder's offer of the accepted document, for binding only
  const [r] = a2.reconcile({ ok: true, entries: [], answerable: [{ digest: "probe", kind: "document", envelope: seal, recipient: {}, since: t0, held: false }] }, { handOver: async () => false }, Date.now());
  ref = r.submissionId;
  a2.register([], Date.now());
  await a2.settle();
  say("  ✓ opening 2: the accepted document filed for binding; the queued answer arrives now");
}
const want = EXPECT === "unsupportedType"
  ? (st) => st?.state === "failed" && st.reason === "rejected-by-receiver" && st.code === "unsupportedType"
  : (st) => st?.state === "accepted" && st.held === true;
const ok = await waitFor(() => { a2.advance(Date.now()); return want(a2.status(ref)) });
const st = a2.status(ref);
a2.advance(Date.now()); await a2.settle();
if (!ok) fail(`no ${EXPECT} within 30s; status ${JSON.stringify(st)}`);
say(`  ✓ answer read and bound by the carried document's id: ${JSON.stringify(st)} after ${Date.now() - t0}ms`);
if (a2.collect(Date.now()).items.length !== 0) fail("the answer reached the holder as an item");
say(`  ✓ the answer is no item for the holder; acknowledged at the adapter's next step`);

a2.close(); wire2.close();
console.log(`\nLIVE-INTEROP-PROBE PASS — ${EXPECT === "unsupportedType" ? "the foreign consumer refused the carried document (unsupportedType) and the submission failed as rejected-by-receiver" : "the foreign consumer answered with a next step and the submission is accepted and held"} (${frame.mode}${process.env.CROSS_OPENING === "1" ? ", across openings" : ""})`);
process.exit(0);
