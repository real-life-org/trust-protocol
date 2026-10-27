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
// document the holder offers for binding (RLTP-VTI-5065, Delivery RLTP-DEL-6150);
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

// a sealed envelope of the schema's form; the consumer never opens it. It is
// filed as a holder's custody entry would be (reconcile), so it has a digest
// and its answer travels in the collection (RLTP-VTI-5080)
const seal = { rkid: "z6LStLK2kxribiLHz6U4vpGfzMtmgc4q5WjR4mvhS6KG1W16", epk: b64u(rand(32)), nonce: b64u(rand(12)), ciphertext: b64u(rand(48)) };
const t0 = Date.now();
const DIGEST = "probe";
const entry = { digest: DIGEST, kind: "document", envelope: seal, type: "probe", threadId: "probe", recipient: {}, attempt: 0, since: t0, notAfter: t0 + 86_400_000 };
const gate = { handOver: async (_e, _w, start) => start() };
const [first] = a.reconcile({ ok: true, entries: [entry], answerable: [] }, gate, t0);
await a.settle();
const frame = wire.sentFrames().at(-1) ?? {};
if (a.status(first.submissionId)?.state !== "accepted") fail(`deposit not accepted: ${JSON.stringify(a.status(first.submissionId))}`);
say(`  ✓ carried document deposited and accepted (mode ${frame.mode}: payload ${frame.payload}B, inner ${frame.inner}B, outer ${frame.outer ?? "-"}B)`);

const log = (l) => { logged.push(l); say(`  · ${l}`) };
/** a new opening over the same relationship, the document offered for binding (RLTP-VTI-5065) */
async function opening (registerFirst) {
  const w = await createVtiWire({ rootIkm: root, mediatorDid: MEDIATOR_DID, nonce, peerDid: FOREIGN_DID, log });
  const x = await MediatorCarrierAdapter.create(root, MEDIATOR_DID, nonce, w);
  if (registerFirst) {
    x.register([], Date.now()); await x.settle();
    await new Promise((r) => setTimeout(r, 3000));
    x.advance(Date.now()); await x.settle();
  }
  const g = { handOver: async () => false };
  const [r] = x.reconcile({ ok: true, entries: [], answerable: [{ digest: DIGEST, kind: "document", envelope: seal, recipient: {}, since: t0, held: false }] }, g, Date.now());
  x.register([], Date.now()); await x.settle();
  return { a: x, wire: w, ref: r.submissionId };
}
const want = EXPECT === "unsupportedType"
  ? (st) => st?.state === "failed" && st.reason === "rejected-by-receiver" && st.code === "unsupportedType"
  : (st) => st?.state === "accepted" && st.held === true;
/** wait for the bound answer; its collection, not concluded */
async function bound (o, what) {
  const ok = await waitFor(() => { o.a.advance(Date.now()); return want(o.a.status(o.ref)) });
  await o.a.settle();
  if (!ok) fail(`${what}: no ${EXPECT} within 30s; status ${JSON.stringify(o.a.status(o.ref))}`);
  const col = o.a.collect(Date.now());
  if (col.items.length !== 0) fail(`${what}: the answer reached the holder as an item`);
  if (col.answers.length !== 1 || JSON.stringify(col.answers[0].report) !== JSON.stringify(o.a.report(o.ref))) fail(`${what}: the bound answer is not in the collection: ${JSON.stringify(col.answers)}`);
  return col;
}

let cur = { a, wire, ref: first.submissionId };
if (process.env.CROSS_OPENING === "1") {
  // the opening ends before the answer is taken: the frame stays at the mediator
  a.close(); wire.close();
  say("  ✓ opening 1 closed after the acceptance");
  await new Promise((r) => setTimeout(r, 3000));
  cur = await opening(process.env.REGISTER_FIRST === "1");
  say(`  ✓ opening 2${process.env.REGISTER_FIRST === "1" ? " (registered before the reconcile)" : ""}: the accepted document filed for binding`);
}
await bound(cur, "first binding");
const st = cur.a.status(cur.ref);
say(`  ✓ answer bound by the carried document's id: ${JSON.stringify(st)}; in the collection with its report (${Date.now() - t0}ms)`);

// RLTP-VTI-5080 at the mediator: before the conclusion the answer is still there
cur.a.close(); cur.wire.close();
await new Promise((r) => setTimeout(r, 2000));
cur = await opening(false);
const col2 = await bound(cur, "redelivery before the conclusion");
say("  ✓ not concluded, the opening closed: the mediator delivered the answer again and it bound again");
// the host records col.answers[i].report at its holder here (this probe has none), then concludes
const ackState = () => cur.a.ackState();
cur.a.conclude(col2, Date.now());
await cur.a.settle();
cur.a.advance(Date.now()); await cur.a.settle();
if (ackState().pending.length !== 0) fail(`the acknowledgement did not land: ${JSON.stringify(ackState().pending)}`);
say("  ✓ concluded: the acknowledgement landed");
cur.a.close(); cur.wire.close();
await new Promise((r) => setTimeout(r, 2000));
// after the conclusion the mediator holds nothing more: a new opening binds nothing within 5 s
const after = await opening(false);
await new Promise((r) => setTimeout(r, 5000));
after.a.advance(Date.now()); await after.a.settle();
if (JSON.stringify(after.a.status(after.ref)) !== JSON.stringify({ state: "accepted" })) fail(`an answer came again after the conclusion: ${JSON.stringify(after.a.status(after.ref))}`);
say("  ✓ after the conclusion the mediator delivered nothing more");
after.a.close(); after.wire.close();
console.log(`\nLIVE-INTEROP-PROBE PASS — ${EXPECT === "unsupportedType" ? "the foreign consumer refused the carried document (unsupportedType) and the submission failed as rejected-by-receiver" : "the foreign consumer answered with a next step and the submission is accepted and held"} (${frame.mode}${process.env.CROSS_OPENING === "1" ? ", across openings" : ""}${process.env.REGISTER_FIRST === "1" ? ", registered first" : ""}); the answer stayed at the mediator until the conclusion and was gone after it`);
process.exit(0);
