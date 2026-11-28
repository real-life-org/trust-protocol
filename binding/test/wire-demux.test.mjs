// wire-demux.test.mjs — the wire binding of profile 0.29, offline. The
// real wire, the real RltpMediatorSession and the real adapter run over
// a mediator double: ATM HTTP, DID resolution and the socket are
// replaced (cfg.transport), the TSP and DIDComm crypto is the real
// vti-tsp-js 0.4.0 (TSP 1.0) / vti-didcomm-js 0.13.0 code. Covered: the receive demux (issue #95: a
// relationship frame must not reach the adapter, and must not block the
// queue; RLTP-VTI-7140), the routed sending form end to end
// (RLTP-VTI-3110, 3115), its addressing against
// vectors/vti-routed-addressing.json, the rebinding of C's key
// (RLTP-VTI-7110, 7120), the fallback mode direct on the connection
// DID's session (RLTP-VTI-3120), the payload the adapter hands over (the
// binding envelope of RLTP-VTI-3150) packed unchanged and handed back with
// its authenticated sender (RLTP-VTI-7140), and queueEmpty (RLTP-VTI-3130).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { x25519 } from "@noble/curves/ed25519.js";
import { multibase, jwk, didKey, unpack as didcommUnpack, pack as didcommPack, MediatorSession } from "@openvtc/vti-didcomm-js";
import {
  pack as tspPack, unpack as tspUnpack, packInvite, packAccept, packWithHops, packRouted,
  decodeEnvelope, nextHop, peekRevision, cesr, sign as tspSign,
} from "@openvtc/vti-tsp-js";
import * as tspHpke from "@openvtc/vti-tsp-js/hpke";
// deep imports, test only: a frame whose ESSR sender differs from its envelope's
// cannot be built through the public API (by design)
import { encodeFields, finalizeFrame } from "../node_modules/@openvtc/vti-tsp-js/dist/v1/envelope.js";
import { encodePayloadFrame } from "../node_modules/@openvtc/vti-tsp-js/dist/v1/payload.js";
import { MediatorCarrierAdapter, depositAddressing, deliveryHintOf, readDeliveryHint, wrapSealed, WireError } from "../../lib/dist/adapters/vti-mediator.js";
import { seedKeys } from "../../lib/dist/keys-seed.js";
import { createVtiWire, deriveWireIdentities, peerKeys } from "../vti-wire.mjs";

const MEDIATOR_DID = "did:example:mediator-double";
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const b64u = (u8) => Buffer.from(u8).toString("base64url");
const sha256hex = async (text) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).toString("hex");
// the real timer, taken before a test mocks the global one (t.mock.timers)
const realSetTimeout = globalThis.setTimeout;

/** What every client session does, observed in the session class the wire's
 *  session extends (test only, nothing is changed): `acks` records each
 *  ack the moment it STARTS (before it is packed and sent), `framesDone`
 *  each received frame once the session's handling of it, the wire's
 *  dispatch included, has ended; `isOpenReads` each read of isOpen.
 *  Entries name the session's client DID. */
const sessions = { acks: [], framesDone: [], isOpenReads: [] };
{
  const { _ackReceived, _onFrame } = MediatorSession.prototype;
  // isOpenReads: every read of a session's isOpen, with what it said
  const isOpen = Object.getOwnPropertyDescriptor(MediatorSession.prototype, "isOpen");
  Object.defineProperty(MediatorSession.prototype, "isOpen", {
    configurable: true,
    get() { const open = isOpen.get.call(this); sessions.isOpenReads.push({ did: this.client.did, open }); return open; },
  });
  MediatorSession.prototype._ackReceived = function (ids) {
    sessions.acks.push({ did: this.client.did, ids: [...ids] });
    return _ackReceived.call(this, ids);
  };
  MediatorSession.prototype._onFrame = async function (data) {
    try { return await _onFrame.call(this, data); } finally { sessions.framesDone.push({ did: this.client.did, data }); }
  };
}
/** The mediator queue ids whose ack a client's session has started. */
const acksStarted = (did) => sessions.acks.filter((a) => a.did === did).flatMap((a) => a.ids);

/** Waits until `cond()` (sync or async) holds, polling about every 5 ms,
 *  and returns its value. Tests wait for the event they assert, never for
 *  an interval: the deadline is only a safety net for an event that never
 *  comes, it never makes a test pass. */
async function until(cond, what, deadlineMs = 5000) {
  const end = performance.now() + deadlineMs;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (performance.now() > end) throw new Error("timed out waiting for " + what);
    await new Promise((r) => realSetTimeout(r, 5));
  }
}

/** Store-and-forward mediator double. A binary TSP frame is relayed only
 *  when its envelope sender is the socket's authenticated DID (measured
 *  fact 1 of the README). A frame addressed to the mediator itself is a
 *  routed message: opened with the mediator's current X25519 key (a
 *  frame sealed to a key it no longer holds is dropped silently), its
 *  next hop taken, and the inner message passed on unchanged to that
 *  hop's socket. Any other frame is routed on its envelope receiver.
 *  `rotate()` replaces the key; `resolve` names the new one from then on. */
function mediatorDouble(mediatorDid = MEDIATOR_DID) {
  let xSecret = rand(32);
  let xPublic = x25519.getPublicKey(xSecret);
  const oldSecrets = [];
  const kid = `${mediatorDid}#key-1`;
  const sockets = new Map();            // client DID → FakeWs
  const sent = [];                       // { did, data } DIDComm text frames
  const dropped = [];                    // { why, sender }
  const forwarded = [];                  // routed messages opened and passed on
  const direct = [];                     // direct frames relayed: { session, sender, receiver }
  const opened = [];                     // the DID of every socket opened, in order
  let lastChallengeDid = null;
  // dropRouted: a mediator that accepts routed frames and delivers none
  // refuseDirect: a mediator with local direct delivery off (0.45's code default):
  // a single-layer frame is refused with a problem report on the sender's socket
  // refuseNextDirect: the next single-layer frame only is refused with that code
  const med = { dropRouted: false, closeOnNextText: null, refuseDirect: false, refuseNextDirect: null, tokenGate: null, tokenRequests: 0, holdOpens: false };
  const heldOpens = [];
  const all = [];                        // every socket ever opened

  const resolve = async () => ({
    didDocument: {
      id: mediatorDid,
      verificationMethod: [{
        id: kid, type: "Multikey", controller: mediatorDid,
        publicKeyMultibase: multibase.encodeMultikey(multibase.MULTICODEC.X25519_PUB, xPublic),
      }],
      keyAgreement: [kid],
      service: [{
        id: `${mediatorDid}#service`, type: ["DIDCommMessaging"],
        serviceEndpoint: [{ uri: "https://mediator.example.com/v1" }, { uri: "wss://mediator.example.com/v1/ws" }],
      }],
    },
  });

  const fetch = async (url, init) => {
    const now = Math.floor(Date.now() / 1000);
    if (String(url).endsWith("/challenge")) {
      lastChallengeDid = JSON.parse(init.body).did;
      return new Response(JSON.stringify({ data: { challenge: "c", session_id: "s" } }), { status: 200 });
    }
    // med.tokenGate: a promise that holds the token response until the test releases it
    med.tokenRequests++;
    if (med.tokenGate) await med.tokenGate;
    return new Response(JSON.stringify({ data: {
      access_token: `tok:${lastChallengeDid}`, access_expires_at: now + 600,
      refresh_token: "r", refresh_expires_at: now + 86400,
    } }), { status: 200 });
  };

  async function route(session, qb2) {
    let got;
    try {
      got = await tspUnpack(qb2, { receiverDecryptionKey: xSecret, senderSigningKey: peerKeys(session).signPub });
    } catch {
      dropped.push({ why: "not openable with the current key", sender: session });
      return;
    }
    if (got.messageType !== "routed") { dropped.push({ why: `not routed: ${got.messageType}`, sender: session }); return; }
    if (med.dropRouted) { dropped.push({ why: "routed frames not carried", sender: session }); return; }
    const step = nextHop(got.hops, got.payload);
    if (step.kind !== "forward") { dropped.push({ why: "no next hop", sender: session }); return; }
    forwarded.push({ session, outer: { sender: got.sender, receiver: got.receiver, route: [...got.hops] }, inner: step.inner, outerBytes: qb2.length, outerFrame: qb2 });
    toClient(step.next, step.inner);
  }

  class FakeWs {
    constructor(_url, protocols) {
      this.did = protocols[0].slice("bearer.tok:".length);
      // as ws does: CONNECTING until the open event
      this.readyState = 0;
      sockets.set(this.did, this);
      opened.push(this.did);
      all.push(this);
      // offersTo(did) counts the offer passes made after each open
      // med.holdOpens: the open waits until med.releaseOpens()
      const open = () => {
        if (this.readyState === 0) this.readyState = 1;
        this.onopen?.();
        setTimeout(() => void reoffer(this.did).finally(() => offered.push(this.did)), 10);
      };
      setTimeout(() => (med.holdOpens ? heldOpens.push(open) : open()), 0);
    }
    send(data) {
      // as ws does: a send after close is dropped without an error
      if (this.readyState !== 1) { dropped.push({ why: "socket closed", sender: this.did }); return; }
      if (typeof data === "string") {
        // a socket that dies while a DIDComm frame (an ack) is on its way
        if (med.closeOnNextText === this.did) { med.closeOnNextText = null; this.close(); dropped.push({ why: "socket closed", sender: this.did }); return; }
        sent.push({ did: this.did, data }); return;
      }
      const qb2 = new Uint8Array(data);
      const env = decodeEnvelope(qb2).envelope;
      if (env.sender !== this.did) { dropped.push({ why: "sender is not the socket's DID", sender: env.sender }); return; }
      if (env.receiver === mediatorDid) { void route(this.did, qb2); return; }
      if (med.refuseDirect) { dropped.push({ why: "direct delivery denied", sender: env.sender }); void problemReport(this, "e.p.direct_delivery.denied"); return; }
      if (med.refuseNextDirect) { const code = med.refuseNextDirect; med.refuseNextDirect = null; dropped.push({ why: code, sender: env.sender }); void problemReport(this, code); return; }
      direct.push({ session: this.did, sender: env.sender, receiver: env.receiver });
      toClient(env.receiver, qb2);
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      // closeDispatched: the client has seen the close (its onclose ran)
      setTimeout(() => { this.onclose?.({ code: 1006 }); this.closeDispatched = true; }, 0);
    }
  }

  async function problemReport(ws, code) {
    const doc = didKey.resolve(ws.did).didDocument;
    const clientKid = doc.keyAgreement?.[0]?.id ?? doc.keyAgreement?.[0];
    const packed = await didcommPack({
      message: { id: crypto.randomUUID(), type: "https://didcomm.org/report-problem/2.0/problem-report", from: mediatorDid, to: [ws.did],
        body: { code, comment: "Mediator is not accepting direct delivery of TSP messages." } },
      sender: { kid, privateJwk: jwk.privateJwk("X25519", xSecret, xPublic) },
      recipient: { kid: clientKid, publicJwk: jwk.publicJwk("X25519", peerKeys(ws.did).encPub) },
    });
    if (ws.readyState === 1) ws.onmessage?.({ data: typeof packed === "string" ? packed : JSON.stringify(packed) });
  }

  // Store-and-forward: every frame for a client is held until the client
  // acks it (messages-received over sha256 of the qb64 text) and offered
  // again whenever that client's socket opens.
  const held = new Map();                // client DID → Map(id → text)
  function toClient(did, qb2) {
    const text = b64u(qb2);
    if (!held.has(did)) held.set(did, new Map());
    void sha256hex(text).then((id) => held.get(did).set(id, text));
    const ws = sockets.get(did);
    if (ws?.readyState === 1) ws.onmessage?.({ data: text });
    return text;
  }
  async function reoffer(did) {
    const ws = sockets.get(did);
    const mine = held.get(did);
    if (!mine || ws?.readyState !== 1) return;
    const acked = new Set(await ackedBy(did));
    for (const [id, text] of mine) {
      if (acked.has(id)) { mine.delete(id); continue; }
      ws.onmessage?.({ data: text });
    }
  }

  /** Inject a frame into a client's socket as the mediator would deliver it (and hold it). */
  const deliver = (did, qb2) => toClient(did, qb2);

  /** The DIDComm messages a client sent the mediator, in order (decrypted
   *  with the current or an earlier key of the mediator; each frame once). */
  const decoded = new Map();             // sent entry → its decrypted message
  const messagesFrom = async (did, clientXPublic, clientKid) => {
    const doc = didKey.resolve(did).didDocument;
    clientKid ??= doc.keyAgreement?.[0]?.id ?? doc.keyAgreement?.[0];
    clientXPublic ??= peerKeys(did).encPub;
    const out = [];
    for (const f of sent.filter((s) => s.did === did)) {
      if (!decoded.has(f)) {
        for (const sk of [xSecret, ...oldSecrets]) {
          try {
            const { message } = await didcommUnpack(f.data,
              { kid, privateJwk: jwk.privateJwk("X25519", sk, x25519.getPublicKey(sk)) },
              { kid: clientKid, publicJwk: jwk.publicJwk("X25519", clientXPublic) });
            decoded.set(f, message);
            break;
          } catch { /* sealed to another key */ }
        }
      }
      if (decoded.has(f)) out.push(decoded.get(f));
    }
    return out;
  };
  /** The message ids a client has acked (its messages-received). */
  const ackedBy = async (did, clientXPublic, clientKid) =>
    (await messagesFrom(did, clientXPublic, clientKid))
      .filter((m) => m.type.endsWith("/messages-received")).flatMap((m) => m.body.message_id_list);
  /** How many sessions a client has finished opening: each connect ends
   *  with the live-delivery change on the new socket. */
  const liveDeliveries = async (did) =>
    (await messagesFrom(did)).filter((m) => m.type.endsWith("/live-delivery-change")).length;
  const offered = [];                    // the DID of every offer pass completed after an open

  const rotate = () => {
    oldSecrets.push(xSecret);
    xSecret = rand(32);
    xPublic = x25519.getPublicKey(xSecret);
  };

  return Object.assign(med, {
    transport: { fetch, resolve, WebSocketImpl: FakeWs },
    deliver, ackedBy, liveDeliveries, rotate, sockets, dropped, forwarded, direct, opened, sent,
    offersTo: (did) => offered.filter((d) => d === did).length,
    releaseOpens: () => { med.holdOpens = false; for (const open of heldOpens.splice(0)) open(); },
    publicKey: () => xPublic,
    openSockets: (did) => all.filter((w) => w.did === did && w.readyState === 1).length,
  });
}

const gate = () => ({ closed: false, handOver: async (_e, _w, start) => start() });
const te = new TextEncoder();
const B64U = (n) => b64u(rand(n));
/** A sealed envelope of the schema's form (Delivery §5): what the holder hands over. */
const sealOf = () => ({ rkid: "z6LS" + "a".repeat(44), epk: b64u(new Uint8Array(32)), nonce: B64U(12), ciphertext: B64U(40) });
/** The JCS bytes of a seal: what submit() takes and what the holder receives. */
const jcsOf = (o) => te.encode(JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]))));
const sealBytes = (seal = sealOf()) => jcsOf(seal);
let docSeq = 0;
/** a document entry of the holder's custody view: its envelope is a seal */
const docView = (seal = sealOf()) => {
  const digest = "doc-" + (++docSeq);
  return { view: { ok: true, entries: [{ digest, kind: "document", envelope: seal, type: "t", threadId: "t", recipient: {}, attempt: 0, since: Date.now(), notAfter: Date.now() + 10 * 72 * 3_600_000 }] }, seal };
};
/** The payload a carried document makes of `seal` from `from` to `to` (RLTP-VTI-3150). */
const carried = async (seal, from, to) => (await wrapSealed(seal, { issuer: from, recipient: to, since: Date.now() })).bytes;

async function pair(med, logs, { A, B, mediatorDid = MEDIATOR_DID, depositMode, restoredB } = {}) {
  A ??= { root: rand(32), nonce: rand(32) };
  B ??= { root: rand(32), nonce: rand(32) };
  A.ids = await deriveWireIdentities(A.root, mediatorDid, A.nonce);
  B.ids = await deriveWireIdentities(B.root, mediatorDid, B.nonce);
  const mk = (self, peer) => createVtiWire({
    connection: self.ids.context.connection,
    peerDid: peer.ids.conn.did,
    transport: med.transport, log: (l) => logs.push(l), depositMode,
  });
  const wireA = await mk(A, B); const wireB = await mk(B, A);
  // side.consumer: the adapter's consumer, for tests that fill its buffer
  // directly; side.handled: what it returned for every frame the wire
  // handed it, so a test can wait until a frame has reached the adapter
  for (const [side, wire] of [[A, wireA], [B, wireB]]) {
    const onDeliver = wire.onDeliver;
    side.handled = [];
    wire.onDeliver = (cb) => {
      side.consumer = cb;
      onDeliver.call(wire, async (payload, sender) => {
        try { const took = await cb(payload, sender); side.handled.push(took); return took; } catch (e) { side.handled.push(e); throw e; }
      });
    };
  }
  const alice = await MediatorCarrierAdapter.open(A.ids.context, wireA);
  const bob = restoredB
    ? await MediatorCarrierAdapter.open(B.ids.context, wireB, restoredB, Date.now())
    : await MediatorCarrierAdapter.open(B.ids.context, wireB);
  const offersA = med.offersTo(A.ids.conn.did); const offersB = med.offersTo(B.ids.conn.did);
  // one handshake at a time: the double keys tokens by the last challenge
  alice.register([], Date.now()); await alice.settle();
  bob.register([], Date.now()); await bob.settle();
  // the double's first offer of what it holds has passed on both sockets
  await until(() => med.offersTo(A.ids.conn.did) > offersA && med.offersTo(B.ids.conn.did) > offersB, "the offer at the open");
  return { A, B, alice, bob, wireA, wireB };
}
/** Drives setTimeout from here on (node:test mock timers): the double's
 *  open and close events and the wire's reconnect backoff fire only when
 *  the test ticks. Date, setImmediate and until()'s own timer stay real. */
const holdTimers = (ctx) => ctx.mock.timers.enable({ apis: ["setTimeout"] });
/** With the timers held: closes a client's socket at the double and
 *  dispatches the close at once; the reconnect it schedules stays held. */
function dropSocketHeld(ctx, med, did) {
  const ws = med.sockets.get(did);
  ws.close();
  ctx.mock.timers.tick(0);
  assert.ok(ws.closeDispatched, "the client saw the close");
}
/** Releases the held timers, `ms` of driven time per poll, until `cond` holds. */
const releaseUntil = (ctx, cond, what, ms = 0) => until(async () => { ctx.mock.timers.tick(ms); return cond(); }, what);
/** Waits until `n` frames in all have reached the side's adapter, and the
 *  wire is done with the last one: what the wire does after its consumer
 *  returns (queueEmpty's bookkeeping) runs in microtasks, which one turn
 *  of the event loop (setImmediate, no interval) completes. */
const reached = async (side, n) => {
  await until(() => side.handled.length >= n, `${n} frame(s) at the adapter`);
  await new Promise((r) => setImmediate(r));
};
/** Waits until the mediator double holds an ack of every one of `texts` from `did`. */
const ackedAll = (med, did, texts) => until(async () => {
  const acked = await med.ackedBy(did);
  for (const t of texts) if (!acked.includes(await sha256hex(t))) return false;
  return true;
}, "the acks at the mediator");
const adapterLines = (logs) => logs.filter((l) => !l.startsWith("[vti-adapter]"));

test("XRFI, XRFA, nested, routed and empty direct frames never reach the adapter; the queue keeps moving (RLTP-VTI-7140)", async () => {
  const med = mediatorDouble();
  const logs = [];
  const { A, B, alice, bob } = await pair(med, logs);
  const bobKeys = { senderSigningKey: B.ids.conn.edSecret, receiverEncryptionKey: peerKeys(A.ids.conn.did).encPub };

  // relationship frames from the expected peer, correctly addressed and signed
  const invite = await packInvite(B.ids.conn.did, A.ids.conn.did, bobKeys);
  const accept = await packAccept(invite.threadDigest, B.ids.conn.did, A.ids.conn.did, bobKeys);
  // an application kind the binding does not speak, and an empty direct message
  const inner = await tspPack(rand(40), B.ids.conn.did, A.ids.conn.did, bobKeys);
  const nested = await packWithHops(inner.bytes, "nested", [], B.ids.conn.did, A.ids.conn.did, bobKeys);
  const empty = await tspPack(new Uint8Array(0), B.ids.conn.did, A.ids.conn.did, bobKeys);
  // a routed message reaching the client itself (the mediator should have opened it)
  const routed = await packRouted(inner.bytes, [A.ids.conn.did], B.ids.conn.did, A.ids.conn.did, bobKeys);

  const texts = [];
  // one at a time: each frame's log line before the next, so the lines keep their order
  for (const f of [invite, accept, nested, empty, routed]) {
    texts.push(med.deliver(A.ids.conn.did, f.bytes));
    await until(() => logs.length >= texts.length, `the log line of frame ${texts.length}`);
  }
  // every frame's decision is final once the mediator holds its ack
  await ackedAll(med, A.ids.conn.did, texts);

  assert.equal(alice.collect(Date.now()).items.length, 0, "no TSP control/unsupported frame may reach the adapter");
  assert.equal(A.handled.length, 0, "nothing handed to the adapter's consumer");
  assert.match(logs[0], /control\/invite from did:key:/);
  assert.ok(logs[0].includes(B.ids.conn.did), "log names the sender VID");
  assert.match(logs[1], /control\/accept/);
  assert.match(logs[2], /unsupported message type "nested"/);
  assert.match(logs[3], /empty payload/);
  assert.match(logs[4], /unsupported message type "routed"/);

  // acked, so they leave the mediator queue
  const acked = await med.ackedBy(A.ids.conn.did, A.ids.conn.xPublic, A.ids.conn.kid);
  for (const t of texts) assert.ok(acked.includes(await sha256hex(t)), "refused frame acked");

  // the queue is not blocked: a real deposit behind them is delivered, its seal byte-identical
  const seal = sealOf();
  bob.submit(sealBytes(seal), Date.now()); await bob.settle(); await reached(A, 1);
  // the session's handling of the deposit's frame, the wire's dispatch included, has ended
  const done = await until(() => sessions.framesDone.find((f) => f.did === A.ids.conn.did && !texts.includes(f.data)), "the end of the deposit's dispatch");
  const depositId = await sha256hex(done.data);
  const c = alice.collect(Date.now());
  assert.equal(c.items.length, 1);
  assert.deepEqual(new Uint8Array(c.items[0].bytes), sealBytes(seal));

  // and its ack still waits for the adapter's conclude (delete-to-ack):
  // no ack of it was even started while the wire handled it
  assert.ok(!acksStarted(A.ids.conn.did).includes(depositId), "no ack started before conclude");
  const before = (await med.ackedBy(A.ids.conn.did, A.ids.conn.xPublic, A.ids.conn.kid)).length;
  assert.equal(before, texts.length, "no ack before conclude");
  alice.conclude(c, Date.now());
  await alice.settle();
  assert.ok(acksStarted(A.ids.conn.did).includes(depositId), "the ack conclude started is the deposit's");
  const after = await until(async () => {
    const n = (await med.ackedBy(A.ids.conn.did, A.ids.conn.xPublic, A.ids.conn.kid)).length;
    return n > texts.length && n;
  }, "the ack of the concluded frame");
  assert.equal(after, texts.length + 1, "conclude acks the delivered frame");
  alice.close(); bob.close();
});

test("TSP 1.0 (§7): both layers of a deposit declare YTSP-BAA and carry the sender's VID; a frame marked YTSP-AAC (Rev 3) is logged with its version, acked and never delivered, and the queue keeps moving", async () => {
  const med = mediatorDouble();
  const logs = [];
  const { A, B, alice, bob } = await pair(med, logs);
  bob.submit(sealBytes(), Date.now()); await bob.settle(); await reached(A, 1);
  const c1 = alice.collect(Date.now());
  assert.equal(c1.items.length, 1);
  const [f] = med.forwarded;
  assert.deepEqual(peekRevision(f.outerFrame), { major: 1, minor: 0, recognised: true }, "outer layer");
  assert.deepEqual(peekRevision(f.inner), { major: 1, minor: 0, recognised: true }, "inner layer");
  const inner = await tspUnpack(f.inner, { receiverDecryptionKey: A.ids.conn.xSecret, senderSigningKey: B.ids.conn.edPublic });
  assert.equal(inner.sender, B.ids.conn.did, "the sender VID, bound in the confidential payload (ESSR)");
  alice.conclude(c1, Date.now()); await alice.settle();
  await until(async () => (await med.ackedBy(A.ids.conn.did)).length === 1, "the ack of the first deposit");

  // the same frame, marked Rev 3 (YTSP-AAC): refused before any key is touched
  const bobKeys = { senderSigningKey: B.ids.conn.edSecret, receiverEncryptionKey: peerKeys(A.ids.conn.did).encPub };
  const v1 = await tspPack(await carried(sealOf(), B.ids.conn.did, A.ids.conn.did), B.ids.conn.did, A.ids.conn.did, bobKeys);
  const text = b64u(v1.bytes);
  const rev3 = new Uint8Array(Buffer.from(text.replace("YTSP-BAA", "YTSP-AAC"), "base64url"));
  const rev3Text = med.deliver(A.ids.conn.did, rev3);
  // the refusal is final once the mediator holds its ack
  await ackedAll(med, A.ids.conn.did, [rev3Text]);
  assert.equal(alice.collect(Date.now()).items.length, 0, "a Rev 3 frame never reaches the adapter");
  assert.equal(A.handled.length, 1, "only the first deposit was handed to the adapter");
  assert.equal(logs.length, 1);
  assert.match(logs[0], /Rev 3 \(YTSP-AAC\)/, logs[0]);
  assert.match(logs[0], /acked and dropped/);
  const acked = await med.ackedBy(A.ids.conn.did, A.ids.conn.xPublic, A.ids.conn.kid);
  assert.ok(acked.includes(await sha256hex(rev3Text)), "the Rev 3 frame is acked, so it leaves the queue");

  // a 1.0 deposit behind it arrives
  const next = sealOf();
  bob.submit(sealBytes(next), Date.now()); await bob.settle(); await reached(A, 2);
  const c2 = alice.collect(Date.now());
  assert.equal(c2.items.length, 1);
  assert.deepEqual(new Uint8Array(c2.items[0].bytes), sealBytes(next));
  alice.close(); bob.close();
});

/** A direct frame of the given MINOR of major version 1 (test only: the
 *  library's version constant is set for the one pack and restored). */
async function packMinor(minor, body, from, to, keys) {
  const saved = cesr.TSP_VERSION.minor;
  cesr.TSP_VERSION.minor = minor;
  try { return (await tspPack(body, from, to, keys)).bytes; } finally { cesr.TSP_VERSION.minor = saved; }
}

/** A direct frame whose ESSR sender (in the confidential payload) differs from
 *  its envelope sender, sealed and signed like any other (test only). */
async function packEssrMismatch(body, envelopeSender, essrSender, receiver, keys) {
  const fields = encodeFields(envelopeSender, receiver);
  const { frame } = encodePayloadFrame(body, "direct", [], essrSender);
  const sealed = await tspHpke.sealBase(frame, fields, keys.receiverEncryptionKey, cesr.TSP_INFO);
  const ct = new Uint8Array(sealed.enc.length + sealed.ciphertext.length);
  ct.set(sealed.enc, 0); ct.set(sealed.ciphertext, sealed.enc.length);
  const field = [];
  cesr.encodeVariableData(cesr.TSP_HPKE_BASE_CIPHERTEXT, ct, field);
  const wireBytes = finalizeFrame(fields, new Uint8Array(field));
  const out = Array.from(wireBytes);
  cesr.encodeCount(cesr.TSP_ATTACH_GRP, 23, out);
  cesr.encodeCount(cesr.TSP_INDEX_SIG_GRP, 22, out);
  cesr.encodeIndexedEd25519Signature(0, tspSign.sign(wireBytes, keys.senderSigningKey), out);
  return new Uint8Array(out);
}

test("RLTP-VTI-7140, major version 1: a 1.1 direct frame is delivered; a frame of major version 2 is logged with its version, acked and never delivered", async () => {
  const med = mediatorDouble();
  const logs = [];
  const { A, B, alice, bob } = await pair(med, logs);
  const bobKeys = { senderSigningKey: B.ids.conn.edSecret, receiverEncryptionKey: peerKeys(A.ids.conn.did).encPub };
  const seal = sealOf();
  const v11 = await packMinor(1, await carried(seal, B.ids.conn.did, A.ids.conn.did), B.ids.conn.did, A.ids.conn.did, bobKeys);
  assert.deepEqual(peekRevision(v11), { major: 1, minor: 1, recognised: false });
  med.deliver(A.ids.conn.did, v11); await reached(A, 1);
  const c = alice.collect(Date.now());
  assert.equal(c.items.length, 1, "a later MINOR of major version 1 is delivered");
  assert.deepEqual(new Uint8Array(c.items[0].bytes), sealBytes(seal));
  const v1 = await tspPack(await carried(sealOf(), B.ids.conn.did, A.ids.conn.did), B.ids.conn.did, A.ids.conn.did, bobKeys);
  const v2Text = med.deliver(A.ids.conn.did, new Uint8Array(Buffer.from(b64u(v1.bytes).replace("YTSP-BAA", "YTSP-CAA"), "base64url")));
  // the refusal is final once the mediator holds its ack
  await ackedAll(med, A.ids.conn.did, [v2Text]);
  assert.equal(alice.collect(Date.now()).items.length, 0, "major version 2 never reaches the adapter");
  assert.equal(A.handled.length, 1, "only the 1.1 frame was handed to the adapter");
  assert.equal(logs.length, 1);
  assert.match(logs[0], /MAJOR 2/, logs[0]);
  const acked = await med.ackedBy(A.ids.conn.did, A.ids.conn.xPublic, A.ids.conn.kid);
  assert.ok(acked.includes(await sha256hex(v2Text)));
  alice.close(); bob.close();
});

test("RLTP-VTI-7140: a frame whose sender VID in the confidential payload differs from its envelope's is logged with its envelope sender, acked and never delivered; the queue keeps moving", async () => {
  const med = mediatorDouble();
  const logs = [];
  const { A, B, alice, bob } = await pair(med, logs);
  const X = await deriveWireIdentities(rand(32), MEDIATOR_DID, rand(32));
  const bobKeys = { senderSigningKey: B.ids.conn.edSecret, receiverEncryptionKey: peerKeys(A.ids.conn.did).encPub };
  const bad = await packEssrMismatch(await carried(sealOf(), B.ids.conn.did, A.ids.conn.did), B.ids.conn.did, X.conn.did, A.ids.conn.did, bobKeys);
  const badText = med.deliver(A.ids.conn.did, bad);
  // the refusal is final once the mediator holds its ack
  await ackedAll(med, A.ids.conn.did, [badText]);
  assert.equal(alice.collect(Date.now()).items.length, 0);
  assert.equal(A.handled.length, 0);
  assert.equal(logs.length, 1);
  assert.ok(logs[0].includes(B.ids.conn.did) && /refused/.test(logs[0]), logs[0]);
  const acked = await med.ackedBy(A.ids.conn.did, A.ids.conn.xPublic, A.ids.conn.kid);
  assert.ok(acked.includes(await sha256hex(badText)));
  const next = sealOf();
  bob.submit(sealBytes(next), Date.now()); await bob.settle(); await reached(A, 1);
  const c = alice.collect(Date.now());
  assert.equal(c.items.length, 1);
  assert.deepEqual(new Uint8Array(c.items[0].bytes), sealBytes(next));
  alice.close(); bob.close();
});

test("RLTP-VTI-7140: the consumer receives the payload unchanged with its authenticated sender", async () => {
  const med = mediatorDouble();
  const logs = [];
  const A = { root: rand(32), nonce: rand(32) };
  const B = { root: rand(32), nonce: rand(32) };
  A.ids = await deriveWireIdentities(A.root, MEDIATOR_DID, A.nonce);
  B.ids = await deriveWireIdentities(B.root, MEDIATOR_DID, B.nonce);
  const wire = await createVtiWire({ connection: A.ids.context.connection, peerDid: B.ids.conn.did, transport: med.transport, log: (l) => logs.push(l) });
  const seen = [];
  wire.onDeliver(async (payload, sender) => { seen.push({ payload: new Uint8Array(payload), sender }); return true; });
  await wire.authenticate();
  // the double's offer at the open has passed: the frame below reaches the wire once
  await until(() => med.offersTo(A.ids.conn.did) >= 1, "the offer at the open");
  const payload = rand(77);                       // whatever the payload, the wire passes it on unread
  const bobKeys = { senderSigningKey: B.ids.conn.edSecret, receiverEncryptionKey: peerKeys(A.ids.conn.did).encPub };
  med.deliver(A.ids.conn.did, (await tspPack(payload, B.ids.conn.did, A.ids.conn.did, bobKeys)).bytes);
  await until(() => seen.length >= 1, "the delivery to the consumer");
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].payload, payload, "M-2: the payload byte for byte");
  assert.equal(seen[0].sender, B.ids.conn.did, "the sender TSP authenticated");
  assert.deepEqual(logs, []);
  wire.close();
});

test("RLTP-VTI-3120: a mediator that refuses direct delivery answers the connection DID's session with a problem report; the wire signals it, and every later deposit in mode direct fails as a retriable carrier refusal while routed still goes out", async () => {
  const med = mediatorDouble();
  med.refuseDirect = true;
  const logs = [];
  const send = { mode: "direct", open: [] };
  const { A, alice, bob, wireB } = await pair(med, logs, { restoredB: { concluded: [], pending: [], send } });
  const first = bob.submit(sealBytes(), Date.now()); await bob.settle();
  // the problem report follows the double's refusal of the frame
  await until(() => logs.some((l) => /direct_delivery\.denied/.test(l)), "the problem report");
  assert.equal(bob.status(first).state, "accepted", "the refused deposit had already left");
  assert.equal(alice.collect(Date.now()).items.length, 0);
  assert.ok(logs.some((l) => /direct_delivery\.denied/.test(l)), JSON.stringify(logs));
  assert.equal(wireB.directRefused(), true);
  const { view } = docView();
  const [{ submissionId: id }] = bob.reconcile(view, gate(), Date.now()); await bob.settle();
  assert.deepEqual(bob.status(id), { state: "awaiting-transport", reason: "carrier-refused-retriable" });
  assert.equal(med.dropped.filter((d) => d.why === "direct delivery denied").length, 1, "nothing deposited after the refusal");
  await assert.rejects(wireB.deposit("t", sealBytes(), "direct"), (e) => e instanceof WireError && e.kind === "direct-refused");
  // routed is not refused by it
  await wireB.deposit("t", await carried(sealOf(), wireB.connectionDid, wireB.counterpart()), "routed"); await reached(A, 1);
  assert.equal(alice.collect(Date.now()).items.length, 1, "routed still carried");
  alice.close(); bob.close();
});

test("RLTP-VTI-3120: one deposit, then the refusal of direct delivery arrives: the wire signals it (directRefused) and the adapter's send state records it without a further deposit; the next opening deposits nothing", async () => {
  const med = mediatorDouble();
  med.refuseDirect = true;
  const logs = [];
  const send = { mode: "direct", open: [] };
  const first = await pair(med, logs, { restoredB: { concluded: [], pending: [], send } });
  const id0 = first.bob.submit(sealBytes(), Date.now()); await first.bob.settle();
  await until(() => first.wireB.directRefused(), "the refusal of direct delivery");
  assert.equal(first.bob.status(id0).state, "accepted");
  assert.equal(first.wireB.directRefused(), true);
  // the host's final persist after the close: the signal outlives it
  first.alice.close(); first.bob.close();
  assert.equal(first.wireB.directRefused(), true, "still set after the close");
  const snap = first.bob.ackState();
  assert.equal(typeof snap.send.directRefusedAt, "number", JSON.stringify(snap.send));
  med.refuseDirect = false;
  const next = await pair(med, [], { A: first.A, B: first.B, restoredB: snap });
  const { view } = docView();
  // settle() ends the attempt: a deposit would have reached the double synchronously within it
  const [{ submissionId: id }] = next.bob.reconcile(view, gate(), Date.now()); await next.bob.settle();
  assert.deepEqual(next.bob.status(id), { state: "awaiting-transport", reason: "carrier-refused-retriable" });
  assert.deepEqual(med.direct, []);
  next.alice.close(); next.bob.close();
});

test("RLTP-VTI-3120, §5: any other problem report (e.p.delivery.refused) is logged and consumed; the next deposit in mode direct goes out on the connection DID's session", async () => {
  const med = mediatorDouble();
  med.refuseNextDirect = "e.p.delivery.refused";
  const logs = [];
  const send = { mode: "direct", open: [] };
  const { A, B, alice, bob, wireB } = await pair(med, logs, { restoredB: { concluded: [], pending: [], send } });
  bob.submit(sealBytes(), Date.now()); await bob.settle();
  // the problem report follows the double's refusal of the frame
  await until(() => logs.some((l) => /e\.p\.delivery\.refused/.test(l)), "the problem report");
  assert.equal(alice.collect(Date.now()).items.length, 0);
  assert.ok(logs.some((l) => /e\.p\.delivery\.refused/.test(l)), JSON.stringify(logs));
  assert.equal(wireB.directRefused(), false);
  const next = sealOf();
  const id = bob.submit(sealBytes(next), Date.now()); await bob.settle(); await reached(A, 1);
  assert.equal(bob.status(id).state, "accepted");
  const c = alice.collect(Date.now());
  assert.equal(c.items.length, 1, "no lock: the next deposit is delivered");
  assert.deepEqual(new Uint8Array(c.items[0].bytes), sealBytes(next));
  assert.deepEqual(med.direct.at(-1), { session: B.ids.conn.did, sender: B.ids.conn.did, receiver: A.ids.conn.did });
  alice.close(); bob.close();
});

test("routed (RLTP-VTI-1120, 3110, 3115): outer connection DID → C with the route [peer's connection DID], inner connection DID → peer's connection DID, on the connection session; the payload is the adapter's binding envelope, packed unchanged", async () => {
  const med = mediatorDouble();
  const logs = [];
  const { A, B, alice, bob, wireB } = await pair(med, logs);
  const seal = sealOf();
  const id = bob.submit(sealBytes(seal), Date.now()); await bob.settle(); await reached(A, 1);
  assert.equal(bob.status(id).state, "accepted");
  const c = alice.collect(Date.now());
  assert.equal(c.items.length, 1);
  assert.deepEqual(new Uint8Array(c.items[0].bytes), sealBytes(seal), "M-2: the seal byte-identical at the receiver");
  assert.equal(med.forwarded.length, 1);
  const f = med.forwarded[0];
  assert.equal(f.session, B.ids.conn.did, "deposited on the connection DID's session");
  assert.deepEqual(f.outer, { sender: B.ids.conn.did, receiver: MEDIATOR_DID, route: [A.ids.conn.did] });
  const inner = await tspUnpack(f.inner, { receiverDecryptionKey: A.ids.conn.xSecret, senderSigningKey: B.ids.conn.edPublic });
  assert.deepEqual([inner.messageType, inner.sender, inner.receiver], ["direct", B.ids.conn.did, A.ids.conn.did]);
  const doc = JSON.parse(new TextDecoder().decode(inner.payload));
  assert.equal(doc.type, "https://trusttasks.org/binding/tsp/0.1/envelope");
  assert.deepEqual([doc.document.issuer, doc.document.recipient], [B.ids.conn.did, A.ids.conn.did]);
  assert.deepEqual(doc.document.payload, seal);
  assert.deepEqual(med.direct, [], "nothing deposited as a single layer");
  assert.deepEqual(new Set(med.opened), new Set([A.ids.conn.did, B.ids.conn.did]), "one session per side");
  const [frame] = wireB.sentFrames();
  assert.equal(frame.mode, "routed");
  assert.ok(frame.outer > frame.inner && frame.inner > frame.payload, JSON.stringify(frame));
  assert.equal(frame.outer, f.outerBytes);
  assert.deepEqual(adapterLines(logs), []);
  assert.equal(wireB.counterpart(), A.ids.conn.did);
  alice.close(); bob.close();
});

test("routed addressing on the wire reproduces vectors/vti-routed-addressing.json, both directions", async () => {
  const V = JSON.parse(readFileSync(new URL("../../vectors/vti-routed-addressing.json", import.meta.url), "utf8"));
  const VEC = JSON.parse(readFileSync(new URL("../../vectors/identity-derivation.json", import.meta.url), "utf8"));
  const sha2 = async (t) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));
  const A = { root: Uint8Array.from(Buffer.from(VEC.rootIkm, "hex")), nonce: await sha2("rltp/vector/carrier-relationship/nonce-1") };
  const B = { root: await sha2("rltp/vector/vti-routed/root-B"), nonce: await sha2("rltp/vector/vti-routed/nonce-B") };
  const med = mediatorDouble(V.carrier);
  const logs = [];
  const { alice, bob } = await pair(med, logs, { A, B, mediatorDid: V.carrier });
  assert.deepEqual({ A: { connection: A.ids.conn.did }, B: { connection: B.ids.conn.did } }, V.sides);
  // one after the other, so med.forwarded holds A→B, then B→A
  alice.submit(sealBytes(), Date.now()); await alice.settle(); await reached(B, 1);
  bob.submit(sealBytes(), Date.now()); await bob.settle(); await reached(A, 1);
  const strip = ({ sealedTo, signedBy, payload, ...rest }) => rest;
  const keys = { A, B };
  for (const [i, key] of ["A→B", "B→A"].entries()) {
    const want = V.routed[key];
    const f = med.forwarded[i];
    const to = keys[key.at(-1)];
    const inner = await tspUnpack(f.inner, { receiverDecryptionKey: to.ids.conn.xSecret, senderSigningKey: peerKeys(want.inner.sender).signPub });
    assert.deepEqual({
      inner: { messageType: inner.messageType, sender: inner.sender, receiver: inner.receiver },
      outer: { messageType: "routed", ...f.outer },
      session: f.session,
    }, { inner: strip(want.inner), outer: strip(want.outer), session: want.session }, key);
    const from = keys[key[0]];
    // the hint this side shows names the sender the wire actually used (RLTP-VTI-1215, 1120)
    assert.equal(readDeliveryHint(deliveryHintOf(from.ids.context.connection), V.carrier).connectionDid, inner.sender, `${key}: hint = wire sender`);
    assert.deepEqual(depositAddressing("routed", from.ids.conn.did, to.ids.conn.did, V.carrier),
      { inner: strip(want.inner), outer: strip(want.outer), session: want.session }, `${key}: the lib's addressing`);
    const d = V.direct[key];
    assert.deepEqual(depositAddressing("direct", from.ids.conn.did, to.ids.conn.did, V.carrier),
      { inner: strip(d.message), outer: null, session: d.session }, `${key}: the lib's addressing in mode direct`);
  }
  alice.close(); bob.close();
});

test("rebinding (RLTP-VTI-7110, 7120): a deposit that failed waits; C's key rotates; the renewal resolves the new key and the waiting document arrives sealed to it; a frame sealed to the old key is dropped", async (ctx) => {
  const med = mediatorDouble();
  const logs = [];
  const { A, B, alice, bob } = await pair(med, logs);
  const oldKey = med.publicKey();
  // the reconnect is held until the failed attempt is over, then released
  holdTimers(ctx);
  dropSocketHeld(ctx, med, B.ids.conn.did);
  const seal = sealOf();
  const id = bob.submit(sealBytes(seal), Date.now()); await bob.settle();
  assert.equal(bob.status(id).state, "awaiting-transport");
  // the socket is reopened in the background
  await releaseUntil(ctx, async () => (await med.liveDeliveries(B.ids.conn.did)) >= 2, "B's session reopened");
  med.rotate();
  // a frame packed for the old key never reaches anyone
  const stale = await packRouted((await tspPack(rand(16), B.ids.conn.did, A.ids.conn.did,
    { senderSigningKey: B.ids.conn.edSecret, receiverEncryptionKey: A.ids.conn.xPublic })).bytes,
  [A.ids.conn.did], B.ids.conn.did, MEDIATOR_DID, { senderSigningKey: B.ids.conn.edSecret, receiverEncryptionKey: oldKey });
  med.sockets.get(B.ids.conn.did).send(stale.bytes);
  // the double's decision on the stale frame
  await until(() => med.dropped.some((d) => d.why === "not openable with the current key"), "the drop of the stale frame");
  assert.deepEqual(med.dropped.map((d) => d.why).filter((w) => w !== "socket closed"), ["not openable with the current key"]);
  assert.equal(alice.collect(Date.now()).items.length, 0);
  assert.equal(A.handled.length, 0);
  // the next attempt after the access token's expiry: renewal, new key, packed anew
  bob.advance(Date.now() + 601_000); await bob.settle(); await reached(A, 1);
  assert.equal(bob.status(id).state, "accepted");
  const c = alice.collect(Date.now());
  assert.equal(c.items.length, 1);
  assert.deepEqual(new Uint8Array(c.items[0].bytes), sealBytes(seal));
  assert.equal(med.dropped.filter((d) => d.why === "not openable with the current key").length, 1, "sealed to the new key");
  alice.close(); bob.close();
});

test("fallback (RLTP-VTI-3120): an adapter in mode direct deposits the inner message alone on the connection DID's own session; no other session is opened", async () => {
  const med = mediatorDouble();
  const logs = [];
  const send = { mode: "direct", open: [] };
  const { A, B, alice, bob, wireB } = await pair(med, logs, { restoredB: { concluded: [], pending: [], send } });
  assert.equal(bob.sendMode, "direct");
  const seal = sealOf();
  bob.submit(sealBytes(seal), Date.now()); await bob.settle(); await reached(A, 1);
  const c = alice.collect(Date.now());
  assert.equal(c.items.length, 1);
  assert.deepEqual(new Uint8Array(c.items[0].bytes), sealBytes(seal));
  assert.deepEqual(med.direct, [{ session: B.ids.conn.did, sender: B.ids.conn.did, receiver: A.ids.conn.did }]);
  assert.deepEqual(med.forwarded, []);
  assert.equal(wireB.sentFrames()[0].mode, "direct");
  assert.equal(wireB.sentFrames()[0].outer, null);
  assert.deepEqual(new Set(med.opened), new Set([A.ids.conn.did, B.ids.conn.did]), "one session per side");
  // and the forced fallback of the measurement switch, under an adapter in routed
  const med2 = mediatorDouble();
  const p2 = await pair(med2, [], { depositMode: "direct" });
  assert.equal(p2.bob.sendMode, "routed");
  p2.bob.submit(sealBytes(seal), Date.now()); await p2.bob.settle(); await reached(p2.A, 1);
  assert.equal(p2.alice.collect(Date.now()).items.length, 1);
  assert.equal(med2.direct[0].session, p2.B.ids.conn.did);
  alice.close(); bob.close(); p2.alice.close(); p2.bob.close();
});

test("queueEmpty (RLTP-VTI-3130): false before the session opens and right after a frame, true on an open, quiet session", async (ctx) => {
  const med = mediatorDouble();
  const logs = [];
  const A = { root: rand(32), nonce: rand(32) };
  const B = { root: rand(32), nonce: rand(32) };
  A.ids = await deriveWireIdentities(A.root, MEDIATOR_DID, A.nonce);
  B.ids = await deriveWireIdentities(B.root, MEDIATOR_DID, B.nonce);
  const cold = await createVtiWire({ connection: A.ids.context.connection, peerDid: B.ids.conn.did, transport: med.transport });
  assert.equal(cold.queueEmpty(), false, "no session");
  const p = await pair(med, logs, { A, B });
  // the quiet period (QUIET_MS, 1 s) passes on a driven clock: Date only, the timers stay real
  ctx.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  ctx.mock.timers.tick(1100);
  assert.equal(p.wireA.queueEmpty(), true);
  p.bob.submit(sealBytes(), Date.now()); await p.bob.settle(); await reached(A, 1);
  assert.equal(p.wireA.queueEmpty(), false, "a frame just arrived");
  ctx.mock.timers.tick(1100);
  assert.equal(p.wireA.queueEmpty(), true);
  p.alice.close(); p.bob.close();
});

test("queueEmpty right after the session opens is false; a successor restored past the deadline does not switch at once (B1)", async (ctx) => {
  // the clock stands still from before the opening: "right after" holds however long the opening takes
  ctx.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const med = mediatorDouble();
  const send = { mode: "routed", open: [{ digest: "d0", acceptedAt: 0 }] };
  const { alice, bob, wireB } = await pair(med, [], { restoredB: { concluded: [], pending: [], send } });
  assert.equal(wireB.queueEmpty(), false, "just opened: what the mediator holds may still be on its way");
  bob.conclude(bob.collect(Date.now()), Date.now());
  bob.advance(Date.now());
  assert.equal(bob.sendMode, "routed");
  alice.close(); bob.close();
});

test("a closed connection socket fails the deposit as unreachable — never accepted on a dead socket — and the retry after the reconnect lands (B1)", async (ctx) => {
  const med = mediatorDouble();
  const { A, B, alice, bob } = await pair(med, []);
  // the reconnect is held until the failed attempt is over, then released
  holdTimers(ctx);
  dropSocketHeld(ctx, med, B.ids.conn.did);
  const { view, seal } = docView();
  const [{ submissionId: id }] = bob.reconcile(view, gate(), Date.now()); await bob.settle();
  assert.deepEqual(bob.status(id), { state: "awaiting-transport", reason: "transport-unreachable" });
  assert.deepEqual(bob.ackState().send.open, [], "nothing open before an acceptance");
  assert.equal(med.forwarded.length, 0);
  await releaseUntil(ctx, async () => (await med.liveDeliveries(B.ids.conn.did)) >= 2, "B's session reopened");
  assert.equal(med.opened.filter((d) => d === B.ids.conn.did).length, 2, "reopened");
  bob.advance(Date.now()); await bob.settle(); await reached(A, 1);
  assert.equal(bob.status(id).state, "accepted");
  assert.equal(bob.ackState().send.open.length, 1, "accepted in routed: an open deposit");
  const c = alice.collect(Date.now());
  assert.deepEqual(new Uint8Array(c.items[0].bytes), sealBytes(seal));
  alice.close(); bob.close();
});

test("an ack on a closed socket fails, so the intent stays and the next advance sends it (N6)", async (ctx) => {
  const med = mediatorDouble();
  const { A, alice, bob } = await pair(med, []);
  bob.submit(sealBytes(), Date.now()); await bob.settle(); await reached(A, 1);
  const c = alice.collect(Date.now());
  assert.equal(c.items.length, 1);
  // the reconnect is held until the failed ack is over, then released
  holdTimers(ctx);
  dropSocketHeld(ctx, med, A.ids.conn.did);
  alice.conclude(c, Date.now()); await alice.settle();
  assert.equal(alice.ackState().pending.length, 1, "the intent stays");
  // reopened; the mediator offered the unacked frame again, and the adapter absorbed it
  await releaseUntil(ctx, () => A.handled.length >= 2, "the offer at the reopening", 10);
  await reached(A, 2);
  alice.advance(Date.now()); await alice.settle();
  assert.equal(alice.ackState().pending.length, 0);
  const acked = await until(async () => {
    const ids = await med.ackedBy(A.ids.conn.did, A.ids.conn.xPublic, A.ids.conn.kid);
    return ids.length > 0 && ids;
  }, "the ack at the mediator");
  assert.equal(acked.length, 1);
  alice.close(); bob.close();
});

test("a frame from a foreign sender or one that cannot be read is logged and acked, never delivered (N5, RLTP-VTI-7140)", async () => {
  const med = mediatorDouble();
  const logs = [];
  const { A, B: bobSide, alice, bob } = await pair(med, logs);
  const bobIds = bobSide.ids;
  const X = await deriveWireIdentities(rand(32), MEDIATOR_DID, rand(32));
  const foreign = await tspPack(await carried(sealOf(), X.conn.did, A.ids.conn.did), X.conn.did, A.ids.conn.did,
    { senderSigningKey: X.conn.edSecret, receiverEncryptionKey: A.ids.conn.xPublic });
  const t1 = med.deliver(A.ids.conn.did, foreign.bytes);
  await until(() => logs.length >= 1, "the log line of frame 1");
  // the expected sender's frame, tampered: its signature no longer holds
  const good = await tspPack(rand(40), bobIds.conn.did, A.ids.conn.did,
    { senderSigningKey: bobIds.conn.edSecret, receiverEncryptionKey: A.ids.conn.xPublic });
  const tampered = new Uint8Array(good.bytes); tampered[tampered.length - 5] ^= 0xff;
  const t2 = med.deliver(A.ids.conn.did, tampered);
  await until(() => logs.length >= 2, "the log line of frame 2");
  // a frame of the expected sender for another receiver (this side's connection DID of another relationship)
  const Y = await deriveWireIdentities(A.root, MEDIATOR_DID, rand(32));
  const other = await tspPack(rand(40), bobIds.conn.did, Y.conn.did,
    { senderSigningKey: bobIds.conn.edSecret, receiverEncryptionKey: A.ids.conn.xPublic });
  const t3 = med.deliver(A.ids.conn.did, other.bytes);
  // every refusal is final once the mediator holds its ack
  await ackedAll(med, A.ids.conn.did, [t1, t2, t3]);
  assert.equal(alice.collect(Date.now()).items.length, 0);
  assert.equal(A.handled.length, 0);
  assert.equal(logs.length, 3);
  assert.ok(logs[0].includes(X.conn.did) && /refused/.test(logs[0]), logs[0]);
  assert.ok(logs[1].includes(bobIds.conn.did) && /refused/.test(logs[1]), logs[1]);
  assert.ok(/refused/.test(logs[2]), logs[2]);
  const acked = await med.ackedBy(A.ids.conn.did, A.ids.conn.xPublic, A.ids.conn.kid);
  for (const t of [t1, t2, t3]) assert.ok(acked.includes(await sha256hex(t)));
  alice.close(); bob.close();
});

test("the switch end to end (RLTP-VTI-3130): a mediator that carries no routed frames, a quiet queue, the deadline — then mode direct carries the next document on the same session", async (ctx) => {
  const med = mediatorDouble();
  med.dropRouted = true;
  const logs = [];
  const { A, B, alice, bob } = await pair(med, logs);
  const bobGate = gate();
  bob.reconcile(docView().view, bobGate, Date.now()); await bob.settle();
  await until(() => med.dropped.some((d) => d.why === "routed frames not carried"), "the double's drop of the routed frame");
  assert.equal(alice.collect(Date.now()).items.length, 0, "routed frames are not carried");
  // the real queueEmpty, a quiet open socket: the quiet period passes on a
  // driven clock (Date only, the timers stay real)
  ctx.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  ctx.mock.timers.tick(1100);
  let t = Date.now();
  bob.conclude(bob.collect(t), t);
  bob.advance(t + 72 * 3_600_000);
  assert.equal(bob.sendMode, "direct");
  t += 72 * 3_600_000 + 1;
  const second = sealOf();
  bob.submit(sealBytes(second), t); await bob.settle(); await reached(A, 1);
  const c = alice.collect(Date.now());
  assert.equal(c.items.length, 1);
  assert.deepEqual(new Uint8Array(c.items[0].bytes), sealBytes(second));
  assert.equal(med.direct.at(-1).session, B.ids.conn.did);
  assert.equal(med.opened.filter((d) => d === B.ids.conn.did).length, 1, "no second session");
  assert.deepEqual(adapterLines(logs), []);
  alice.close(); bob.close();
});

test("a frame refused above the cap keeps queueEmpty false; once the buffer is concluded the mediator offers it again at the next open, the adapter takes it, queueEmpty turns true (review 3 N1, review 4 N4)", async (ctx) => {
  const med = mediatorDouble();
  const { A, B, alice, bob, wireA } = await pair(med, []);
  // fill the buffer to the cap through the adapter's consumer: maximal carried
  // seals until one is not taken, then small ones until none fits any more
  const big = { ...sealOf(), ciphertext: b64u(new Uint8Array(65536 + 16).fill(7)) };
  const feed = async (s) => A.consumer(await carried(s, B.ids.conn.did, A.ids.conn.did), B.ids.conn.did);
  while (await feed({ ...big, nonce: B64U(12) })) { /* fill */ }
  while (await feed(sealOf())) { /* top up */ }
  const seal = sealOf();
  bob.submit(sealBytes(seal), Date.now()); await bob.settle(); await reached(A, 1);
  assert.equal(A.handled[0], false, "the frame through the wire was not taken");
  // past the quiet period on a driven clock (Date only, the timers stay real)
  ctx.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  ctx.mock.timers.tick(1100);
  assert.equal(wireA.queueEmpty(), false, "a frame was left with the mediator");
  const c = alice.collect(Date.now());
  assert.ok(!c.items.some((it) => Buffer.from(it.bytes).equals(Buffer.from(sealBytes(seal)))), "only the big ones");
  alice.conclude(c, Date.now()); await alice.settle();
  med.sockets.get(A.ids.conn.did).close();         // the next open offers it again
  await reached(A, 2);
  const again = alice.collect(Date.now());
  assert.equal(again.items.length, 1);
  assert.deepEqual(new Uint8Array(again.items[0].bytes), sealBytes(seal));
  ctx.mock.timers.tick(1100);
  assert.equal(wireA.queueEmpty(), true);
  alice.close(); bob.close();
});

test("authenticate during a background reconnect waits for it: one socket, never two (review 3 N2)", async (ctx) => {
  const med = mediatorDouble();
  const { B, alice, bob, wireB } = await pair(med, []);
  const opens = () => med.opened.filter((d) => d === B.ids.conn.did).length;
  // driven timers: the close, the wire's reconnect backoff and the double's
  // open of a socket fire only when the test ticks
  holdTimers(ctx);
  dropSocketHeld(ctx, med, B.ids.conn.did);
  // authenticate runs up to the mediator's token answer, which the double holds
  let releaseToken;
  med.tokenGate = new Promise((r) => { releaseToken = r; });
  const tokens = med.tokenRequests;
  let authenticated = false, openWhenAuthenticated = null;
  const auth = wireB.authenticate().then(() => { authenticated = true; openWhenAuthenticated = med.openSockets(B.ids.conn.did); });
  await until(() => med.tokenRequests > tokens, "authenticate at the token request");
  // the background reconnect starts: its backoff fires, its socket is opening
  med.holdOpens = true;
  ctx.mock.timers.tick(50);
  assert.equal(opens(), 2, "the background reconnect constructed its socket");
  assert.equal(med.openSockets(B.ids.conn.did), 0, "its open is still pending");
  // authenticate continues while that reconnect runs: its socket cannot
  // open before the test releases it, so authenticate finds the session
  // closed; the open is released once authenticate has checked it
  const reads = sessions.isOpenReads.length;
  med.tokenGate = null; releaseToken();
  // authenticate's renewal checks the session (closed) and, in the same
  // synchronous step, joins the running reconnect or would start one
  await until(() => sessions.isOpenReads.slice(reads).some((r) => r.did === B.ids.conn.did && !r.open), "authenticate's check of the session");
  med.releaseOpens();
  await releaseUntil(ctx, () => authenticated, "authenticate");
  await auth;
  assert.equal(openWhenAuthenticated, 1, "authenticate returned only once the reconnect's socket was open");
  // every timer still pending, then count
  ctx.mock.timers.runAll();
  assert.equal(med.openSockets(B.ids.conn.did), 1);
  assert.equal(opens(), 2);
  alice.close(); bob.close();
});

test("an ack whose socket dies while it is sent fails, so the intent stays (review 3 N3)", async () => {
  const med = mediatorDouble();
  const { A, alice, bob } = await pair(med, []);
  bob.submit(sealBytes(), Date.now()); await bob.settle(); await reached(A, 1);
  const c = alice.collect(Date.now());
  med.closeOnNextText = A.ids.conn.did;
  alice.conclude(c, Date.now()); await alice.settle();
  assert.equal(alice.ackState().pending.length, 1);
  // reopened; the mediator offered the unacked frame again, and the adapter absorbed it
  await reached(A, 2);
  alice.advance(Date.now()); await alice.settle();
  assert.equal(alice.ackState().pending.length, 0);
  alice.close(); bob.close();
});

test("a receive-only side reconnects by itself after its socket drops, and receives again; a closed wire reconnects nothing (review 3 N4)", async (ctx) => {
  const med = mediatorDouble();
  const { A, alice, bob, wireA } = await pair(med, []);
  med.sockets.get(A.ids.conn.did).close();
  await until(async () => (await med.liveDeliveries(A.ids.conn.did)) >= 2, "A's session reopened");
  assert.equal(med.openSockets(A.ids.conn.did), 1, "reopened without a send of its own");
  const seal = sealOf();
  bob.submit(sealBytes(seal), Date.now()); await bob.settle(); await reached(A, 1);
  const c = alice.collect(Date.now());
  assert.deepEqual(new Uint8Array(c.items[0].bytes), sealBytes(seal));
  const before = med.opened.length;
  const ws = med.sockets.get(A.ids.conn.did);
  // driven timers: whatever close() or the close event schedules is run out below
  holdTimers(ctx);
  wireA.close();
  ctx.mock.timers.runAll();
  assert.ok(ws.closeDispatched, "the client saw the close");
  // a reconnect started from a promise chain gets its turn, then the timers once more
  await new Promise((r) => setImmediate(r));
  ctx.mock.timers.runAll();
  assert.equal(med.opened.length, before, "no reconnect after close()");
  alice.close(); bob.close();
});

test("RLTP-VTI-1235, 1227, 1240: a wire without the counterpart's connection DID, or naming this side's own, is refused at construction; counterpart() names it; deposit modes are routed and direct only", async () => {
  const A = { root: rand(32), nonce: rand(32) };
  const B = { root: rand(32), nonce: rand(32) };
  A.ids = await deriveWireIdentities(A.root, MEDIATOR_DID, A.nonce);
  B.ids = await deriveWireIdentities(B.root, MEDIATOR_DID, B.nonce);
  assert.equal(A.ids.conn.did, A.ids.context.connection.did, "one wire identity: the context's connection DID");
  const base = { connection: A.ids.context.connection, transport: mediatorDouble().transport };
  await assert.rejects(createVtiWire(base), /RLTP-VTI-1235/);
  await assert.rejects(createVtiWire({ ...base, peerDid: A.ids.conn.did }), /RLTP-VTI-1227/);
  for (const depositMode of ["egress-session", "egress", "connection"]) {
    await assert.rejects(createVtiWire({ ...base, peerDid: B.ids.conn.did, depositMode }), /unknown mode/, depositMode);
  }
  const fine = await createVtiWire({ ...base, peerDid: B.ids.conn.did });
  assert.equal(fine.connectionDid, A.ids.conn.did);
  assert.equal(fine.counterpart(), B.ids.conn.did);
  assert.equal("egressDid" in fine, false);
});

test("the wire opens from the context's connection alone: never from the root; a provider that keeps its keys fails it at the opening; an adapter refuses a wire of another context (profile §1, RLTP-VTI-1120)", async () => {
  const A = { root: rand(32), nonce: rand(32) };
  const B = { root: rand(32), nonce: rand(32) };
  A.ids = await deriveWireIdentities(A.root, MEDIATOR_DID, A.nonce);
  B.ids = await deriveWireIdentities(B.root, MEDIATOR_DID, B.nonce);
  const transport = mediatorDouble().transport;
  await assert.rejects(createVtiWire({ rootIkm: A.root, connection: A.ids.context.connection, peerDid: B.ids.conn.did, transport }), /never the root/);
  // the default provider releases nothing: the wire over OpenVTC cannot open
  const kept = await seedKeys(A.root).carrierContext(A.nonce, MEDIATOR_DID);
  assert.equal(kept.connection.did, A.ids.conn.did, "the same connection DID");
  await assert.rejects(createVtiWire({ connection: kept.connection, peerDid: B.ids.conn.did, transport }), /did not release/);
  // a copy of the connection object is not the capability
  await assert.rejects(createVtiWire({ connection: { ...A.ids.context.connection }, peerDid: B.ids.conn.did, transport }), /did not release/);
  // a wire of another relationship (same root, another nonce) under this context's adapter
  const other = await deriveWireIdentities(A.root, MEDIATOR_DID, rand(32));
  const wrong = await createVtiWire({ connection: other.context.connection, peerDid: B.ids.conn.did, transport });
  await assert.rejects(MediatorCarrierAdapter.open(A.ids.context, wrong), /RLTP-VTI-1120/);
  assert.throws(() => { "use strict"; wrong.connectionDid = A.ids.conn.did; }, TypeError, "the wire's connection DID cannot be rewritten");
  const right = await createVtiWire({ connection: A.ids.context.connection, peerDid: B.ids.conn.did, transport });
  const a = await MediatorCarrierAdapter.open(A.ids.context, right);
  assert.equal(a.connectionDid, A.ids.conn.did);
  assert.equal(a.principal, A.ids.context.principal.principal);
  a.close();
});
