#!/usr/bin/env node
// live-device-addresses-probe.mjs — one address per device, against a LIVE
// VTI mediator.
//
// The counterpart to live-two-devices-probe.mjs. There the two devices of a
// person shared one connection DID and the mediator kept one live websocket
// for it. Here each device has its own carrier nonce, so its own connection
// DID, and the peer holds one leg per device (its own connection DID each,
// as it does per relationship). The probe measures:
//
//   1. the peer deposits the same document on both legs: does each device
//      get it?
//   2. one device offline while the peer deposits on both legs: does it get
//      its copy when it comes back, although the other concluded its own?
//   3. both devices deposit to the peer at the same time: does the peer get
//      both?
//   4. the two devices as peers of each other (a leg between them, as the
//      sync of a personal log would use): does a document travel each way?
//   5. did the mediator report a duplicate websocket on any session?
//
// A measurement: every step prints what happened. Only a broken setup exits
// non-zero. The identities are fresh and thrown away; no secrets are printed.
//
// Network-gated: set RLTP_LIVE_MEDIATOR=1 to run.
//   MEDIATOR_DID=...            the instance, required (TSP 1.0, >= 0.45).
//   MEDIATOR_ALLOW_INSECURE=1   for a local test mediator over plain HTTP.
//   WAIT_MS=...                 how long a device waits for a document (default 12000).

import { MediatorCarrierAdapter } from "../lib/dist/adapters/vti-mediator.js";
import { createVtiWire } from "./vti-wire.mjs";
import { carrierScopedIdentity } from "../lib/dist/carrier-identity.js";
import { jcs } from "../lib/dist/core.js";

if (process.env.RLTP_LIVE_MEDIATOR !== "1") {
  console.log("live-device-addresses-probe: skipped (set RLTP_LIVE_MEDIATOR=1 to run against a live mediator)");
  process.exit(0);
}
const MEDIATOR_DID = process.env.MEDIATOR_DID;
if (!MEDIATOR_DID) {
  console.error("live-device-addresses-probe: set MEDIATOR_DID to a TSP 1.0 mediator (>= 0.45)");
  process.exit(2);
}
const WAIT_MS = Number(process.env.WAIT_MS ?? 12000);

const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const now = () => Date.now();
const say = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = (b) => Buffer.from(b).toString("base64url");
const stand = (n) => new TextEncoder().encode(jcs({ rkid: "z6LStLK2kxribiLHz6U4vpGfzMtmgc4q5WjR4mvhS6KG1W16", epk: b64u(rand(32)), nonce: b64u(rand(12)), ciphertext: b64u(rand(n)) }));
const same = (x, y) => Buffer.compare(Buffer.from(x), Buffer.from(y)) === 0;
const findings = [];
const note = (step, text) => { findings.push([step, text]); say(`  → ${text}`); };

say("── live probe: one address per device ──");
say(`  mediator (C): ${MEDIATOR_DID.slice(0, 60)}${MEDIATOR_DID.length > 60 ? "…" : ""}`);

const didOf = async (root, nonce) => (await carrierScopedIdentity(root, MEDIATOR_DID, nonce, "connection")).did;
/** One end of a leg: its own wire and adapter. */
async function end (name, root, nonce, peerDid) {
  const lines = [];
  const wire = await createVtiWire({ rootIkm: root, mediatorDid: MEDIATOR_DID, nonce, peerDid, log: (l) => lines.push(String(l)) });
  const adapter = await MediatorCarrierAdapter.create(root, MEDIATOR_DID, nonce, wire);
  adapter.register([], now());
  await adapter.settle();
  return { name, wire, adapter, lines, open: true };
}
const close = (d) => { if (d?.open) { d.adapter.close(); d.wire.close(); d.open = false; } };
async function waitsFor (d, doc, ms = WAIT_MS) {
  const t0 = now();
  for (;;) {
    const c = d.adapter.collect(now());
    if (c.items.some((i) => same(i.bytes, doc))) return { c, ms: now() - t0 };
    if (now() - t0 > ms) return null;
    await sleep(250);
  }
}
async function deposit (from, doc) {
  const id = from.adapter.submit(doc, now());
  await from.adapter.settle();
  const st = from.adapter.status(id);
  return st?.state === "accepted" ? null : `${st?.state}${st?.reason ? ` (${st.reason})` : ""}`;
}
const conclude = async (d, got) => { d.adapter.conclude(got.c, now()); await d.adapter.settle(); };

// A: one relationship root, one carrier nonce per device. B: one root, one nonce per leg.
// The two devices of A also hold a leg between them, under a root of their own.
const aRoot = rand(32), a1Nonce = rand(32), a2Nonce = rand(32);
const bRoot = rand(32), b1Nonce = rand(32), b2Nonce = rand(32);
const selfRoot = rand(32), s1Nonce = rand(32), s2Nonce = rand(32);
const ends = [];
try {
  const [a1, a2, b1, b2, s1, s2] = await Promise.all([didOf(aRoot, a1Nonce), didOf(aRoot, a2Nonce), didOf(bRoot, b1Nonce), didOf(bRoot, b2Nonce), didOf(selfRoot, s1Nonce), didOf(selfRoot, s2Nonce)]);
  if (new Set([a1, a2, b1, b2, s1, s2]).size !== 6) throw new Error("two ends derived the same connection DID");
  let A1 = await end("A1", aRoot, a1Nonce, b1);
  let A2 = await end("A2", aRoot, a2Nonce, b2);
  const B1 = await end("B→A1", bRoot, b1Nonce, a1);
  const B2 = await end("B→A2", bRoot, b2Nonce, a2);
  const S1 = await end("A1→A2", selfRoot, s1Nonce, s2);
  const S2 = await end("A2→A1", selfRoot, s2Nonce, s1);
  ends.push(A1, A2, B1, B2, S1, S2);
  say("  ✓ six sessions open, six connection DIDs: a leg per device at the peer, and a leg between the two devices");

  say("\n1. the peer deposits the same document on both legs");
  const d1 = stand(64);
  const refused1 = [await deposit(B1, d1), await deposit(B2, d1)].filter(Boolean);
  if (refused1.length) note(1, `a deposit was not accepted: ${refused1.join(", ")}`);
  const [g1, g2] = await Promise.all([waitsFor(A1, d1), waitsFor(A2, d1)]);
  note(1, `handed to ${g1 && g2 ? `both devices (after ${g1.ms} ms and ${g2.ms} ms)` : g1 ? "the first device only" : g2 ? "the second device only" : "neither device"}`);
  // each device concludes its own copy; whether one conclude touches the other's copy is what step 2 measures
  if (g1) await conclude(A1, g1);
  if (g2) await conclude(A2, g2);

  say("\n2. the second device is offline; the peer deposits on both legs; the first concludes; the second comes back");
  close(A2);
  const d2 = stand(72);
  const refused2 = [await deposit(B1, d2), await deposit(B2, d2)].filter(Boolean);
  if (refused2.length) note(2, `a deposit was not accepted: ${refused2.join(", ")}`);
  const h1 = await waitsFor(A1, d2);
  if (h1) await conclude(A1, h1);
  A2 = await end("A2", aRoot, a2Nonce, b2); ends.push(A2);
  const h2 = await waitsFor(A2, d2);
  note(2, `first device: ${h1 ? "got it and concluded" : "did not get it"}; the device that was offline: ${h2 ? `got its copy ${h2.ms} ms after coming back` : "did not get a copy"}`);
  if (h2) await conclude(A2, h2);

  say("\n3. both devices deposit one document each to the peer at the same time");
  const [x, y] = [stand(56), stand(60)];
  const refused3 = (await Promise.all([deposit(A1, x), deposit(A2, y)])).filter(Boolean);
  if (refused3.length) note(3, `a deposit was not accepted: ${refused3.join(", ")}`);
  const [gx, gy] = await Promise.all([waitsFor(B1, x), waitsFor(B2, y)]);
  note(3, `the peer got ${gx && gy ? "both documents, each on its leg" : gx ? "only the first device's" : gy ? "only the second device's" : "neither"}`);
  if (gx) await conclude(B1, gx);
  if (gy) await conclude(B2, gy);

  say("\n4. the two devices as peers of each other");
  const [p, q] = [stand(96), stand(88)];
  const refused4 = [await deposit(S1, p), await deposit(S2, q)].filter(Boolean);
  if (refused4.length) note(4, `a deposit was not accepted: ${refused4.join(", ")}`);
  const [gp, gq] = await Promise.all([waitsFor(S2, p), waitsFor(S1, q)]);
  note(4, `first → second: ${gp ? `delivered after ${gp.ms} ms` : "not delivered"}; second → first: ${gq ? `delivered after ${gq.ms} ms` : "not delivered"}`);
  if (gp) await conclude(S2, gp);
  if (gq) await conclude(S1, gq);

  say("\n5. what the mediator said about its sockets");
  const dup = ends.reduce((n, d) => n + d.lines.filter((l) => l.includes("w.websocket.duplicate-channel")).length, 0);
  note(5, dup ? `${dup} report(s) of a duplicate websocket` : "no report of a duplicate websocket on any of the sessions");
} catch (e) {
  console.error(`✗ setup broke: ${String(e?.stack ?? e).split("\n").slice(0, 4).join(" | ")}`);
  for (const d of ends) close(d);
  process.exit(1);
}
for (const d of ends) close(d);
say("\n── findings ──");
for (const [step, text] of findings) say(`  ${step}. ${text}`);
say("\nLIVE-DEVICE-ADDRESSES-PROBE DONE — a measurement, not a verdict");
process.exit(0);
