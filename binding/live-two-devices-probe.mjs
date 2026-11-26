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
// Measured on 24 November 2026 against the local test mediator (0.45.0),
// three runs, the same each time: the mediator keeps one live websocket per
// DID (`w.websocket.duplicate-channel-refused`,
// `w.websocket.duplicate-channel`). Both devices are handed a deposited
// document, the second up to 5 s later (1). Of their two conclusions one
// acknowledgement does not go out within 4 s (2). A document whose
// acknowledgement went out was not handed to the device that was offline
// within 8 s of its return (3); one left unconcluded is handed to the other
// after 250 ms (4). The peer gets the documents of both devices; the second
// deposit is accepted after about 5 s of retrying (5).
//
// What the probe can say about a concluded document (2, 3) is bounded two
// ways, and the output names both. A conclusion is local; the
// acknowledgement that deletes the document at the mediator goes out
// afterwards and may still be pending, so the probe prints which of the two
// it saw. And "the other device was not handed it" holds for the seconds the
// probe watched, not for good.
//
// Two things this probe shows are properties of this binding, not of the
// mediator: the two wires reconnect against each other for the whole run,
// because the wire reopens its socket as soon as it closes; and the device
// without the socket deposits late and acknowledges late or not at all,
// because the wire does both only on its socket.
// live-shared-address-probe.mjs measures the mediator without either: a
// session without a socket fetches and deposits over HTTP, and a socket
// changes hands in tens of milliseconds when the loser does not reconnect.
// Keep runs of this probe rare, short, and on the local mediator.
//
// Network-gated: set RLTP_LIVE_MEDIATOR=1 to run.
//   MEDIATOR_DID=...   the instance, required: a TSP 1.0 mediator (>= 0.45).
//   WAIT_MS=...        how long a device waits for a document (default 12000).
//   SHOW_LINES=n       print the last n log lines of each of the two devices' wires.

import { MediatorCarrierAdapter } from "../lib/dist/adapters/vti-mediator.js";
import { createVtiWire } from "./vti-wire.mjs";
import { seedKeys } from "../lib/dist/keys-seed.js";
import { jcs } from "../lib/dist/core.js";

if (process.env.RLTP_LIVE_MEDIATOR !== "1") {
  console.log("live-two-devices-probe: skipped (set RLTP_LIVE_MEDIATOR=1 to run against the live mediator)");
  process.exit(0);
}
const MEDIATOR_DID = process.env.MEDIATOR_DID;
/** the carrier context of one relationship at the mediator, as a host opens it (the wire over OpenVTC needs its key released) */
const ctxOf = (root, nonce) => seedKeys(root, { exportConnectionSeed: true }).carrierContext(nonce, MEDIATOR_DID);
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
const connectionOf = async (root, nonce) => (await ctxOf(root, nonce)).connection.did;
const aDid = await connectionOf(aRoot, aNonce), bDid = await connectionOf(bRoot, bNonce);

/** A device: its own wire and adapter over the given root and nonce. */
async function device (name, root, nonce, peerDid) {
  const lines = [];
  const wire = await createVtiWire({ connection: (await ctxOf(root, nonce)).connection, peerDid, log: (l) => lines.push(l) });
  const adapter = await MediatorCarrierAdapter.open(await ctxOf(root, nonce), wire);
  adapter.register([], now());
  await adapter.settle();
  return { name, wire, adapter, lines, open: true };
}
const close = (d) => { if (d.open) { d.adapter.close(); d.wire.close(); d.open = false; } };

/** Waits until the device holds `doc` uncollected, or the time is up. Returns the collection or null.
 *  A collection without the document goes back whole (`keep`), so that nothing a later wait looks
 *  for is taken out of the inbox here. One reader per inbox: two of these on one device would
 *  take each other's documents; `waitsForAll` reads for several. */
async function waitsFor (d, doc, ms = WAIT_MS) {
  const t0 = now();
  for (;;) {
    const c = d.adapter.collect(now());
    if (c.items.some((i) => same(i.bytes, doc))) return { c, ms: now() - t0 };
    if (c.items.length) d.adapter.conclude(c, now(), { keep: c.items.map((i) => i.queueId) });
    if (now() - t0 > ms) return null;
    await sleep(250);
  }
}
/** One reader for several documents on one inbox: counts each over all collections it takes and
 *  concludes every collection at once, without waiting for its acknowledgement, so that the
 *  reading goes on while acknowledgements are on their way. What became of them is read once,
 *  at the end, from the adapter's ack state as it then is. Returns, per document, the time it
 *  arrived or null, and the acknowledgements still pending. */
async function waitsForAll (d, docs, ms = WAIT_MS) {
  const t0 = now(), at = docs.map(() => null), ids = [];
  for (;;) {
    const c = d.adapter.collect(now());
    for (const i of c.items) { const k = docs.findIndex((doc, n) => at[n] === null && same(i.bytes, doc)); if (k >= 0) at[k] = now() - t0; }
    if (c.items.length) { ids.push(...c.items.map((i) => i.queueId)); d.adapter.conclude(c, now()); }
    if (at.every((x) => x !== null) || now() - t0 > ms) break;
    await sleep(250);
  }
  return { at, ack: await acknowledged(d, ids) };
}
/** Waits for the acknowledgements of the queue entries `ids` to go out, driving the adapter's
 *  retries for `ms`; says how many are still pending in the ack state at the end. */
async function acknowledged (d, ids, ms = 4000) {
  const t0 = now();
  for (;;) {
    await d.adapter.settle();
    const pending = d.adapter.ackState().pending.filter((id) => ids.includes(id)).length;
    if (pending === 0 || now() - t0 > ms) return { of: ids.length, pending, ms: now() - t0 };
    await sleep(500);
    d.adapter.advance(now());
  }
}
/** Concludes a collection and says what became of its acknowledgements. The conclusion is local;
 *  the acknowledgement to the mediator is sent afterwards and can fail without `conclude` or
 *  `settle` saying so: it then stays pending in the adapter's ack state. Tries again for `ms`. */
async function concludes (d, c, ms = 4000) {
  d.adapter.conclude(c, now());
  return acknowledged(d, c.items.map((i) => i.queueId), ms);
}
const acked = (a) => (a.pending === 0 ? "concluded, the acknowledgement went out" : `concluded locally, but ${a.pending} of ${a.of} acknowledgement(s) did not go out within ${a.ms} ms: the mediator may still hold the document`);
async function deposit (from, doc) {
  const id = from.adapter.submit(doc, now());
  await from.adapter.settle();
  const st = from.adapter.status(id);
  if (st?.state !== "accepted") throw new Error(`${from.name}: deposit not accepted: ${JSON.stringify(st)}`);
}
/** A deposit that may find the device's socket closed: tries for a while (`advance` drives the
 *  adapter's retries) and says what it saw. */
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
    from.adapter.advance(now());
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
    const a2 = await concludes(first, firstGot.c);
    note(2, `the device that got it: ${acked(a2)}`);
    if (otherGot) {
      // the other device holds it too: its own conclude names a queue entry the mediator may have deleted
      let err = null, b2 = null;
      try { b2 = await concludes(other, otherGot.c); } catch (e) { err = e; }
      note(2, `the other device held it as well; its own conclude ${err ? `failed: ${String(err.message ?? err).slice(0, 120)}` : `returned: ${acked(b2)}`}`);
    } else {
      const late = await waitsFor(other, d1, 6000);
      note(2, late ? `the other device got it ${late.ms} ms after the conclude` : "the other device was not handed it within 6 s after the conclude");
      close(other);
      const back = await device(other.name, aRoot, aNonce, bDid);
      const again = await waitsFor(back, d1, 6000);
      note(2, again ? "after reconnecting, the other device got it" : `after reconnecting, the other device was not handed it within 6 s${a2.pending ? " (the acknowledgement had not gone out, so this says nothing about deletion)" : ""}`);
      if (again) await concludes(back, again.c);
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
    const a3 = await concludes(A1, g3.c);
    note(3, `the online device: ${acked(a3)}`);
    A2 = await device("A2", aRoot, aNonce, bDid);
    const back = await waitsFor(A2, d3, 8000);
    note(3, back ? `the device that was offline got the document after coming back${a3.pending ? " (the acknowledgement had not gone out)" : ", although the acknowledgement had gone out"}` : `the device that was offline was not handed the document within 8 s of coming back${a3.pending ? "; the acknowledgement had not gone out, so this says nothing about deletion" : ", after an acknowledgement that went out"}`);
    if (back) await concludes(A2, back.c);
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
    const a4 = back ? await concludes(A2, back.c) : null;
    if (a4) note(4, `the other device: ${acked(a4)}`);
    A1 = await device("A1", aRoot, aNonce, bDid);
    const again = await waitsFor(A1, d4, 6000);
    note(4, again ? "the first device, back online, is handed the document again" : `the first device, back online, is not handed it again within 6 s${a4 && a4.pending === 0 ? " (the other concluded and its acknowledgement went out)" : ""}`);
    if (again) await concludes(A1, again.c);
  }

  // ── 5. both devices deposit
  say("\n5. both devices deposit one document each to the peer, under the same connection DID");
  if (!A2.open) A2 = await device("A2", aRoot, aNonce, bDid);
  const [x, y] = [stand(56), stand(60)];
  const [dx, dy] = [await depositTrying(A1, x), await depositTrying(A2, y)];
  note(5, `deposits: first device ${dx.seen.join(" → ")} after ${dx.ms} ms, second device ${dy.seen.join(" → ")} after ${dy.ms} ms`);
  // one reader on the peer's inbox counts both documents, over as many collections as they come in
  const { at: [gx, gy], ack } = await waitsForAll(B, [x, y]);
  note(5, `the peer got ${gx !== null && gy !== null ? `both documents (after ${gx} and ${gy} ms)` : gx !== null ? "only the first device's document" : gy !== null ? "only the second device's document" : "neither document"} within ${WAIT_MS} ms${ack.pending ? `; ${ack.pending} of its ${ack.of} acknowledgement(s) had not gone out ${ack.ms} ms later` : ""}`);
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
