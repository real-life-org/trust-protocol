#!/usr/bin/env node
// live-shared-address-probe.mjs — what a shared connection DID can do when
// its two devices do not fight for the socket. Against a LOCAL test mediator.
//
// live-two-devices-probe.mjs showed two wires of one connection DID
// reconnecting against each other, and the one without the socket unable to
// deposit. Both are properties of this binding (it reconnects at once, and
// it deposits only on its socket), not necessarily of the mediator, which
// also offers HTTP routes (`/inbound`, `/fetch`, `/delete`) and lets the
// newest socket win. This probe measures the mediator itself:
//
//   1. beside a device that holds the socket, a second session of the same
//      DID without a socket: is it admitted, does the first keep its socket,
//      can the second fetch over HTTP what the first collected and has not
//      concluded, and can it deposit over HTTP?
//   2. a handover without a duel: the first device does not reconnect once it
//      loses the socket; the second opens one. How long until it holds the
//      document the first left unconcluded, and what does the mediator report?
//   3. how many documents may wait unconcluded for one recipient before the
//      mediator refuses the sender?
//
// A measurement: every step prints what happened. Only a broken setup exits
// non-zero. Identities are fresh and thrown away; no secrets are printed.
// Run it against the local test mediator (README, "A local test mediator"),
// not against a shared instance.
//
//   RLTP_LIVE_MEDIATOR=1 MEDIATOR_ALLOW_INSECURE=1 MEDIATOR_DID=... node live-shared-address-probe.mjs
//   QUEUE_N=...   how many documents step 3 deposits (default 120).
//   HTTP_MS=...   the deadline of each HTTP request of the probe, body included (default 8000).

import { WebSocket } from "ws";
import { MediatorCarrierAdapter } from "../lib/dist/adapters/vti-mediator.js";
import { createVtiWire } from "./vti-wire.mjs";
import { carrierScopedIdentity } from "../lib/dist/carrier-identity.js";
import { jcs } from "../lib/dist/core.js";

if (process.env.RLTP_LIVE_MEDIATOR !== "1") {
  console.log("live-shared-address-probe: skipped (set RLTP_LIVE_MEDIATOR=1 to run against a local test mediator)");
  process.exit(0);
}
const MEDIATOR_DID = process.env.MEDIATOR_DID;
if (!MEDIATOR_DID) {
  console.error("live-shared-address-probe: set MEDIATOR_DID to the local test mediator");
  process.exit(2);
}
const QUEUE_N = Number(process.env.QUEUE_N ?? 120);

const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const now = () => Date.now();
const say = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = (b) => Buffer.from(b).toString("base64url");
const stand = (n) => new TextEncoder().encode(jcs({ rkid: "z6LStLK2kxribiLHz6U4vpGfzMtmgc4q5WjR4mvhS6KG1W16", epk: b64u(rand(32)), nonce: b64u(rand(12)), ciphertext: b64u(rand(n)) }));
const same = (x, y) => Buffer.compare(Buffer.from(x), Buffer.from(y)) === 0;
const findings = [];
const note = (step, text) => { findings.push([step, text]); say(`  → ${text}`); };
const didOf = async (root, nonce) => (await carrierScopedIdentity(root, MEDIATOR_DID, nonce, "connection")).did;

/** An HTTP request with a deadline that also covers reading the body: a mediator that keeps a
 *  response open ends as an observation (status 0), not as a probe that hangs. */
const HTTP_MS = Number(process.env.HTTP_MS ?? 8000);
const post = (url, init) => fetch(url, { ...init, method: "POST", signal: AbortSignal.timeout(HTTP_MS) })
  .then(async (r) => ({ status: r.status, text: await r.text() }))
  .catch((e) => ({ status: 0, text: e?.name === "TimeoutError" || e?.name === "AbortError" ? `no complete answer within ${HTTP_MS} ms` : String(e) }));

/** A stand-in for the socket of a session that has none: it "opens" at once,
 *  never receives, and hands every TSP frame to the mediator's HTTP route
 *  `/inbound` under the session's bearer token. DIDComm text frames (live
 *  delivery, acknowledgements) have no socket to go to and are dropped. */
function httpOnlySocket (record) {
  return class HttpOnly {
    static OPEN = 1;
    constructor (url, protocols) {
      this.readyState = 1;
      record.base = url.replace(/^ws/, "http").replace(/\/ws$/, "");
      record.jwt = String(protocols?.[0] ?? "").replace(/^bearer\./, "");
      setTimeout(() => this.onopen?.({}), 0);
    }
    send (data) {
      if (typeof data === "string") { record.textDropped++; return; }
      record.posts.push(post(`${record.base}/inbound`, { headers: { authorization: `Bearer ${record.jwt}`, "content-type": "application/octet-stream" }, body: data })
        .then((r) => ({ status: r.status, body: r.text.slice(0, 160) })));
    }
    close () { this.readyState = 3; setTimeout(() => this.onclose?.({ code: 1000 }), 0); }
  };
}
/** The real socket once; after it closed, every further socket of this wire
 *  stays silent, so the wire does not take the socket back. */
function yieldingSocket (record) {
  return class Yielding {
    static OPEN = 1;
    constructor (url, protocols) {
      if (record.opened++ === 0) return new WebSocket(url, protocols);
      this.readyState = 0;
    }
    send () {}
    close () {}
  };
}

async function end (name, root, nonce, peerDid, WebSocketImpl) {
  const lines = [];
  const wire = await createVtiWire({ rootIkm: root, mediatorDid: MEDIATOR_DID, nonce, peerDid, log: (l) => lines.push(String(l)), ...(WebSocketImpl ? { transport: { WebSocketImpl } } : {}) });
  const adapter = await MediatorCarrierAdapter.create(root, MEDIATOR_DID, nonce, wire);
  adapter.register([], now());
  await adapter.settle();
  return { name, wire, adapter, lines, open: true };
}
const close = (d) => { if (d?.open) { d.adapter.close(); d.wire.close(); d.open = false; } };
async function waitsFor (d, doc, ms = 8000) {
  const t0 = now();
  for (;;) {
    const c = d.adapter.collect(now());
    if (c.items.some((i) => same(i.bytes, doc))) return { c, ms: now() - t0 };
    if (now() - t0 > ms) return null;
    await sleep(100);
  }
}
async function deposit (from, doc) {
  const id = from.adapter.submit(doc, now());
  await from.adapter.settle();
  const st = from.adapter.status(id);
  return st?.state === "accepted" ? null : `${st?.state}${st?.reason ? ` (${st.reason})` : ""}`;
}
const duplicates = (d) => d.lines.filter((l) => l.includes("w.websocket.duplicate-channel")).length;
const problems = (d) => [...new Set(d.lines.flatMap((l) => (l.match(/reported a problem \(([^)]+)\)/) ?? []).slice(1)))];

say("── live probe: a shared connection DID without a duel ──");
const ends = [];
try {
  // ── 1. HTTP beside a socket
  say("\n1. a second session of the same DID, without a socket, beside the device that holds it");
  {
    const aRoot = rand(32), aNonce = rand(32), bRoot = rand(32), bNonce = rand(32);
    const [aDid, bDid] = [await didOf(aRoot, aNonce), await didOf(bRoot, bNonce)];
    const A1 = await end("A1", aRoot, aNonce, bDid);
    const B = await end("B", bRoot, bNonce, aDid);
    const http = { posts: [], textDropped: 0, base: "", jwt: "" };
    const A2 = await end("A2 (HTTP only)", aRoot, aNonce, bDid, httpOnlySocket(http));
    ends.push(A1, B, A2);
    await sleep(500);
    note(1, `the second session was admitted (it holds a token: ${http.jwt ? "yes" : "no"}); the first device was told of a duplicate socket ${duplicates(A1)} time(s)`);

    const d1 = stand(64);
    await deposit(B, d1);
    const g1 = await waitsFor(A1, d1);
    note(1, g1 ? `the device with the socket collected the peer's document after ${g1.ms} ms and does not conclude it` : "the device with the socket did not get the peer's document");

    // the second session asks for the inbox over HTTP
    let fetched = null;
    for (const body of [{ limit: 10, delete_policy: "DoNotDelete" }, { limit: 10, start_id: null, delete_policy: "do_not_delete" }, { limit: 10 }]) {
      const r = await post(`${http.base}/fetch`, { headers: { authorization: `Bearer ${http.jwt}`, "content-type": "application/json" }, body: JSON.stringify(body) });
      fetched = { status: r.status, text: r.text, body };
      if (r.status === 200) break;
    }
    let count = null;
    try { const j = JSON.parse(fetched.text); const list = j?.data?.success ?? j?.data?.messages ?? j?.data; count = Array.isArray(list) ? list.length : null; } catch { /* not JSON */ }
    note(1, `HTTP /fetch by the second session: status ${fetched.status}${count !== null ? `, ${count} message(s)` : `, answer: ${fetched.text.slice(0, 140)}`}`);

    // the second session deposits over HTTP
    const x = stand(56);
    const refused = await deposit(A2, x);
    const posted = await Promise.all(http.posts);
    const gx = await waitsFor(B, x);
    note(1, `HTTP /inbound by the second session: ${posted.length ? posted.map((p) => `status ${p.status}${p.status === 200 ? "" : ` (${p.body})`}`).join(", ") : "nothing posted"}${refused ? `; the adapter says ${refused}` : ""}; the peer ${gx ? `got the document after ${gx.ms} ms` : "did not get the document"}`);

    // the first device still holds its socket
    const d2 = stand(60);
    await deposit(B, d2);
    const g2 = await waitsFor(A1, d2);
    note(1, `afterwards the first device ${g2 ? `is still handed documents live (${g2.ms} ms)` : "is no longer handed documents"}; duplicate reports on it: ${duplicates(A1)}`);
    for (const d of [A1, A2, B]) close(d);
  }

  // ── 2. handover without a duel
  say("\n2. a handover: the first device does not reconnect once it lost the socket");
  {
    const aRoot = rand(32), aNonce = rand(32), bRoot = rand(32), bNonce = rand(32);
    const [aDid, bDid] = [await didOf(aRoot, aNonce), await didOf(bRoot, bNonce)];
    const rec = { opened: 0 };
    const A1 = await end("A1 (yields)", aRoot, aNonce, bDid, yieldingSocket(rec));
    const B = await end("B", bRoot, bNonce, aDid);
    ends.push(A1, B);
    const d1 = stand(64);
    await deposit(B, d1);
    const g1 = await waitsFor(A1, d1);
    const t0 = now();
    const A2 = await end("A2", aRoot, aNonce, bDid);
    ends.push(A2);
    const g2 = await waitsFor(A2, d1);
    note(2, `the first device ${g1 ? "collected the document and left it unconcluded" : "did not get the document"}; the second opened its socket and ${g2 ? `held the document ${now() - t0} ms after starting` : "did not get the document within 8 s"}`);
    await sleep(1500);
    note(2, `the mediator's reports: on the device that took over ${duplicates(A2)} duplicate report(s) [${problems(A2).join(", ") || "none"}], on the one that yielded ${duplicates(A1)} [${problems(A1).join(", ") || "none"}]; sockets the yielding wire asked for: ${rec.opened}`);
    if (g2) { A2.adapter.conclude(g2.c, now()); await A2.adapter.settle(); }
    const [x, d2] = [stand(56), stand(60)];
    const refused = await deposit(A2, x);
    await deposit(B, d2);
    const [gx, gd] = [await waitsFor(B, x), await waitsFor(A2, d2)];
    note(2, `after the handover the second device ${refused ? `cannot deposit (${refused})` : gx ? "deposits and the peer gets it" : "deposits, the peer does not get it"} and ${gd ? "is handed the peer's next document" : "is not handed the peer's next document"}`);
    for (const d of [A1, A2, B]) close(d);
  }

  // ── 3. how much may wait
  say(`\n3. the peer deposits ${QUEUE_N} documents for a recipient that is offline`);
  {
    const aRoot = rand(32), aNonce = rand(32), bRoot = rand(32), bNonce = rand(32);
    const [aDid, bDid] = [await didOf(aRoot, aNonce), await didOf(bRoot, bNonce)];
    const A = await end("A", aRoot, aNonce, bDid);
    close(A);                                              // admitted once, then offline
    const B = await end("B", bRoot, bNonce, aDid);
    ends.push(B);
    let accepted = 0, firstRefusal = null;
    for (let i = 0; i < QUEUE_N; i++) {
      const r = await deposit(B, stand(64));
      if (r === null) accepted++; else { firstRefusal ??= `document ${i + 1}: ${r}`; break; }
    }
    await sleep(1500);
    note(3, `${accepted} of ${QUEUE_N} deposits were handed to the mediator${firstRefusal ? `; first refusal at ${firstRefusal}` : ""}; problems the mediator reported to the sender: ${problems(B).join(", ") || "none"}`);
    const back = await end("A", aRoot, aNonce, bDid);
    ends.push(back);
    // collect and conclude until nothing more comes for three seconds
    let handed = 0, quiet = 0;
    while (quiet < 30) {
      const c = back.adapter.collect(now());
      if (c.items.length) { handed += c.items.length; back.adapter.conclude(c, now()); await back.adapter.settle(); quiet = 0; } else quiet++;
      await sleep(100);
    }
    note(3, `the recipient, back online, is handed ${handed} document(s) in all`);
    for (const d of [back, B]) close(d);
  }
} catch (e) {
  console.error(`✗ setup broke: ${String(e?.stack ?? e).split("\n").slice(0, 5).join(" | ")}`);
  for (const d of ends) close(d);
  process.exit(1);
}
say("\n── findings ──");
for (const [step, text] of findings) say(`  ${step}. ${text}`);
say("\nLIVE-SHARED-ADDRESS-PROBE DONE — a measurement, not a verdict");
process.exit(0);
