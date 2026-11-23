#!/usr/bin/env node
// live-two-devices-probe.mjs — one address, two devices, against the LIVE
// VTI mediator.
//
// A person's two devices hold the same relationship root and carrier nonce,
// so they derive the same connection DID and authenticate under it. The
// probe measures what the mediator does with that:
//
//   1. both devices online, the peer deposits: which device is handed the
//      document, one or both?
//   2. the device that got it concludes (delete-to-ack): does the other one
//      still get it, live or after it reconnects?
//   3. one device offline, the other collects and concludes: does the
//      offline one get the document when it comes back?
//   4. one device collects, does not conclude and goes offline: does the
//      other device get the document?
//   5. both devices deposit to the peer under the same connection DID: does
//      the peer get both?
//
// Measured on 23 November 2026 against a mediator 0.45.0: the mediator keeps
// one live websocket per DID (`w.websocket.duplicate-channel-refused`,
// `w.websocket.duplicate-channel`). The two devices take turns at it: in
// step 1 the first is handed the document at once and the second about five
// seconds later; a document one device concluded is gone for the other (3);
// one left unconcluded is handed to the other (4); the device without the
// socket cannot deposit (5). A run makes the two wires reconnect against
// each other for its whole length: keep runs rare and short.
//
// It is a measurement: every step prints what happened and none of them is
// a pass or a fail. Only a broken setup exits non-zero. No secrets are
// printed; the identities are fresh and thrown away.
//
// Network-gated: set RLTP_LIVE_MEDIATOR=1 to run.
//   MEDIATOR_DID=...   the instance, required: a TSP 1.0 mediator (>= 0.45).
//   WAIT_MS=...        how long a device waits for a document (default 12000).
//   SHOW_LINES=n       print the last n log lines of each of the two devices' wires.

import { MediatorCarrierAdapter } from "../lib/dist/adapters/vti-mediator.js";
import { createVtiWire } from "./vti-wire.mjs";
import { carrierScopedIdentity } from "../lib/dist/carrier-identity.js";
import { jcs } from "../lib/dist/core.js";

if (process.env.RLTP_LIVE_MEDIATOR !== "1") {
  console.log("live-two-devices-probe: skipped (set RLTP_LIVE_MEDIATOR=1 to run against the live mediator)");
  process.exit(0);
}
const MEDIATOR_DID = process.env.MEDIATOR_DID;
if (!MEDIATOR_DID) {
  console.error("live-two-devices-probe: set MEDIATOR_DID to a TSP 1.0 mediator (>= 0.45)");
  process.exit(2);
}
const WAIT_MS = Number(process.env.WAIT_MS ?? 12000);

const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const now = () => Date.now();
const say = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = (b) => Buffer.from(b).toString("base64url");
/** A stand-in sealed RLTP envelope of the schema's form; its ciphertext is random bytes. */
const stand = (n) => new TextEncoder().encode(jcs({ rkid: "z6LStLK2kxribiLHz6U4vpGfzMtmgc4q5WjR4mvhS6KG1W16", epk: b64u(rand(32)), nonce: b64u(rand(12)), ciphertext: b64u(rand(n)) }));
const same = (x, y) => Buffer.compare(Buffer.from(x), Buffer.from(y)) === 0;

const findings = [];
const note = (step, text) => { findings.push([step, text]); say(`  → ${text}`); };

say("── live probe: one address, two devices ──");
say(`  mediator (C): ${MEDIATOR_DID}`);

// A: one relationship root and nonce for both devices. B: its own.
const aRoot = rand(32), aNonce = rand(32), bRoot = rand(32), bNonce = rand(32);
const connectionOf = async (root, nonce) => (await carrierScopedIdentity(root, MEDIATOR_DID, nonce, "connection")).did;
const aDid = await connectionOf(aRoot, aNonce), bDid = await connectionOf(bRoot, bNonce);

/** A device: its own wire and adapter over the given root and nonce. */
async function device (name, root, nonce, peerDid) {
  const lines = [];
  const wire = await createVtiWire({ rootIkm: root, mediatorDid: MEDIATOR_DID, nonce, peerDid, log: (l) => lines.push(l) });
  const adapter = await MediatorCarrierAdapter.create(root, MEDIATOR_DID, nonce, wire);
  adapter.register([], now());
  await adapter.settle();
  return { name, wire, adapter, lines, open: true };
}
const close = (d) => { if (d.open) { d.adapter.close(); d.wire.close(); d.open = false; } };

/** Waits until the device holds `doc` uncollected, or the time is up. Returns the collection or null. */
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
  if (st?.state !== "accepted") throw new Error(`${from.name}: deposit not accepted: ${JSON.stringify(st)}`);
}
/** A deposit that may find the device's socket closed: tries for a while and says what it saw. */
async function depositTrying (from, doc, ms = 8000) {
  const t0 = now();
  const id = from.adapter.submit(doc, now());
  const seen = [];
  for (;;) {
    await from.adapter.settle();
    const st = from.adapter.status(id);
    const tag = `${st?.state}${st?.reason ? ` (${st.reason})` : ""}`;
    if (seen.at(-1) !== tag) seen.push(tag);
    if (st?.state === "accepted" || now() - t0 > ms) return { ok: st?.state === "accepted", seen, ms: now() - t0 };
    await sleep(500);
    from.adapter.resume?.(now());
  }
}

const who = (a, b) => (a && b ? "both devices" : a ? "the first device only" : b ? "the second device only" : "neither device");

let A1, A2, B;
try {
  A1 = await device("A1", aRoot, aNonce, bDid);
  A2 = await device("A2", aRoot, aNonce, bDid);
  B = await device("B", bRoot, bNonce, aDid);
  if (A1.wire.connectionDid !== A2.wire.connectionDid) throw new Error("the two devices derived different connection DIDs");
  say(`  ✓ three sessions open: two under one connection DID (${A1.wire.connectionDid.slice(0, 24)}…), one for the peer`);

  // ── 1. both online
  say("\n1. both devices online, the peer deposits one document");
  const d1 = stand(64);
  await deposit(B, d1);
  const [g1, g2] = await Promise.all([waitsFor(A1, d1), waitsFor(A2, d1)]);
  note(1, `handed to ${who(g1, g2)}${g1 ? ` (first after ${g1.ms} ms)` : ""}${g2 ? ` (second after ${g2.ms} ms)` : ""}`);

  // ── 2. the one that got it concludes
  say("\n2. the device that got it concludes (delete-to-ack)");
  const first = g1 ? A1 : g2 ? A2 : null, other = first === A1 ? A2 : A1;
  const firstGot = g1 ?? g2, otherGot = first === A1 ? g2 : g1;
  if (!first) note(2, "skipped: no device got the document");
  else {
    first.adapter.conclude(firstGot.c, now());
    await first.adapter.settle();
    if (otherGot) {
      // the other device holds it too: its own conclude names a queue entry the mediator may have deleted
      let err = null;
      try { other.adapter.conclude(otherGot.c, now()); await other.adapter.settle(); } catch (e) { err = e; }
      note(2, `the other device held it as well; its own conclude ${err ? `failed: ${String(err.message ?? err).slice(0, 120)}` : "went through"}`);
    } else {
      const late = await waitsFor(other, d1, 6000);
      note(2, late ? `the other device got it ${late.ms} ms after the conclude` : "the other device did not get it within 6 s after the conclude");
      close(other);
      const back = await device(other.name, aRoot, aNonce, bDid);
      const again = await waitsFor(back, d1, 6000);
      note(2, again ? "after reconnecting, the other device got it" : "after reconnecting, the other device still did not get it: the document is gone for it");
      if (again) { back.adapter.conclude(again.c, now()); await back.adapter.settle(); }
      if (other === A1) A1 = back; else A2 = back;
    }
  }

  // ── 3. one offline, the other collects and concludes
  say("\n3. the second device is offline; the peer deposits; the first collects and concludes; the second comes back");
  close(A2);
  const d3 = stand(72);
  await deposit(B, d3);
  const g3 = await waitsFor(A1, d3);
  if (!g3) note(3, "the online device did not get the document");
  else {
    A1.adapter.conclude(g3.c, now());
    await A1.adapter.settle();
    A2 = await device("A2", aRoot, aNonce, bDid);
    const back = await waitsFor(A2, d3, 8000);
    note(3, back ? "the device that was offline got the document after coming back" : "the device that was offline did not get the document: after the conclude it is gone for it");
    if (back) { A2.adapter.conclude(back.c, now()); await A2.adapter.settle(); }
  }

  // ── 4. collected, not concluded, then offline
  say("\n4. the second device is offline; the first collects, does not conclude and goes offline; the second comes back");
  close(A2);
  const d4 = stand(80);
  await deposit(B, d4);
  const g4 = await waitsFor(A1, d4);
  if (!g4) note(4, "the online device did not get the document");
  else {
    close(A1);                                             // no conclude: the mediator keeps the document
    A2 = await device("A2", aRoot, aNonce, bDid);
    const back = await waitsFor(A2, d4, 8000);
    note(4, back ? `the other device got the unconcluded document after ${back.ms} ms` : "the other device did not get the unconcluded document within 8 s");
    if (back) { A2.adapter.conclude(back.c, now()); await A2.adapter.settle(); }
    A1 = await device("A1", aRoot, aNonce, bDid);
    const again = await waitsFor(A1, d4, 6000);
    note(4, again ? "the first device, back online, is handed the document again" : back ? "the first device, back online, is not handed it again (the other concluded)" : "the first device, back online, is not handed it again");
    if (again) { A1.adapter.conclude(again.c, now()); await A1.adapter.settle(); }
  }

  // ── 5. both devices deposit
  say("\n5. both devices deposit one document each to the peer, under the same connection DID");
  if (!A2.open) A2 = await device("A2", aRoot, aNonce, bDid);
  const [x, y] = [stand(56), stand(60)];
  const [dx, dy] = [await depositTrying(A1, x), await depositTrying(A2, y)];
  note(5, `deposits: first device ${dx.seen.join(" → ")} after ${dx.ms} ms, second device ${dy.seen.join(" → ")} after ${dy.ms} ms`);
  const [gx, gy] = await Promise.all([waitsFor(B, x), waitsFor(B, y)]);
  note(5, `the peer got ${gx && gy ? "both documents" : gx ? "only the first device's document" : gy ? "only the second device's document" : "neither document"}`);
  const last = B.adapter.collect(now());
  if (last.items.length) { B.adapter.conclude(last, now()); await B.adapter.settle(); }
} catch (e) {
  console.error(`✗ setup broke: ${String(e?.stack ?? e).split("\n").slice(0, 4).join(" | ")}`);
  for (const d of [A1, A2, B]) if (d) close(d);
  process.exit(1);
}

// what the mediator itself said about two sockets under one DID (problem reports on the sessions)
const reports = (d, code) => d.lines.filter((l) => String(l).includes(code)).length;
const all = [A1, A2].filter(Boolean);
const refused = all.reduce((n, d) => n + reports(d, "w.websocket.duplicate-channel-refused"), 0);
const terminated = all.reduce((n, d) => n + reports(d, "(w.websocket.duplicate-channel)"), 0);
if (refused || terminated) note("socket", `the mediator keeps one live websocket per DID: it reported ${refused} refused duplicate connection(s) and ${terminated} terminated socket(s) on the two devices' last sessions`);
else note("socket", "the mediator reported no duplicate websocket on the two devices' last sessions");
if (process.env.SHOW_LINES) for (const d of [A1, A2]) { say(`  ${d.name}:`); for (const l of d.lines.slice(-Number(process.env.SHOW_LINES))) say(`    ${String(l).slice(0, 160)}`); }
for (const d of [A1, A2, B]) close(d);
say("\n── findings ──");
for (const [step, text] of findings) say(`  ${step}. ${text}`);
say("\nLIVE-TWO-DEVICES-PROBE DONE — a measurement, not a verdict");
process.exit(0);
