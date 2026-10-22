// wire-demux.test.mjs — the wire binding of profile 0.24, offline. The
// real wire, the real RltpMediatorSession and the real adapter run over
// a mediator double: ATM HTTP, DID resolution and the socket are
// replaced (cfg.transport), the TSP and DIDComm crypto is the real
// 0.3.0 / 0.12.0 code. Covered: the receive demux (issue #95: a
// relationship frame must not reach the adapter, and must not block the
// queue; RLTP-VTI-7140), the routed sending form end to end
// (RLTP-VTI-3110, 3115), its addressing against
// vectors/vti-routed-addressing.json, the rebinding of C's key
// (RLTP-VTI-7110, 7120), the egress-session fallback (RLTP-VTI-3120) and
// queueEmpty (RLTP-VTI-3130).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { x25519 } from "@noble/curves/ed25519.js";
import { multibase, jwk, didKey, unpack as didcommUnpack } from "@openvtc/vti-didcomm-js";
import {
  pack as tspPack, unpack as tspUnpack, packInvite, packAccept, packWithHops, packRouted,
  decodeEnvelope, nextHop,
} from "@openvtc/vti-tsp-js";
import { MediatorCarrierAdapter, depositAddressing } from "../../lib/dist/adapters/vti-mediator.js";
import { createVtiWire, deriveWireIdentities, peerKeys } from "../vti-wire.mjs";

const MEDIATOR_DID = "did:example:mediator-double";
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const b64u = (u8) => Buffer.from(u8).toString("base64url");
const sha256hex = async (text) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).toString("hex");
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

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
  const med = { dropRouted: false, closeOnNextText: null };
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
    forwarded.push({ session, outer: { sender: got.sender, receiver: got.receiver, route: [...got.hops] }, inner: step.inner, outerBytes: qb2.length });
    toClient(step.next, step.inner);
  }

  class FakeWs {
    constructor(_url, protocols) {
      this.did = protocols[0].slice("bearer.tok:".length);
      this.readyState = 1;
      sockets.set(this.did, this);
      opened.push(this.did);
      all.push(this);
      setTimeout(() => { this.onopen?.(); setTimeout(() => void reoffer(this.did), 10); }, 0);
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
      direct.push({ session: this.did, sender: env.sender, receiver: env.receiver });
      toClient(env.receiver, qb2);
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      setTimeout(() => this.onclose?.({ code: 1006 }), 0);
    }
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

  /** The message ids a client has acked (decrypting its messages-received
   *  with the current or an earlier key of the mediator). */
  const ackedBy = async (did, clientXPublic, clientKid) => {
    const doc = didKey.resolve(did).didDocument;
    clientKid ??= doc.keyAgreement?.[0]?.id ?? doc.keyAgreement?.[0];
    clientXPublic ??= peerKeys(did).encPub;
    const ids = [];
    for (const f of sent.filter((s) => s.did === did)) {
      for (const sk of [xSecret, ...oldSecrets]) {
        try {
          const { message } = await didcommUnpack(f.data,
            { kid, privateJwk: jwk.privateJwk("X25519", sk, x25519.getPublicKey(sk)) },
            { kid: clientKid, publicJwk: jwk.publicJwk("X25519", clientXPublic) });
          if (message.type.endsWith("/messages-received")) ids.push(...message.body.message_id_list);
          break;
        } catch { /* sealed to another key */ }
      }
    }
    return ids;
  };

  const rotate = () => {
    oldSecrets.push(xSecret);
    xSecret = rand(32);
    xPublic = x25519.getPublicKey(xSecret);
  };

  return Object.assign(med, {
    transport: { fetch, resolve, WebSocketImpl: FakeWs },
    deliver, ackedBy, rotate, sockets, dropped, forwarded, direct, opened, sent,
    publicKey: () => xPublic,
    openSockets: (did) => all.filter((w) => w.did === did && w.readyState === 1).length,
  });
}

const gate = () => ({ closed: false, handOver: async (_e, _w, start) => start() });
let docSeq = 0;
/** a document entry of the holder's custody view: the deposit's bytes are jcs(envelope) */
const docView = (bytes) => {
  const digest = "doc-" + (++docSeq);
  const envelope = { b: Buffer.from(bytes).toString("base64url"), digest };   // keys in JCS order
  return { view: { ok: true, entries: [{ digest, kind: "document", envelope, type: "t", threadId: "t", recipient: {}, attempt: 0, since: Date.now(), notAfter: Date.now() + 10 * 72 * 3_600_000 }] }, envelope };
};
const jcsBytes = (o) => new TextEncoder().encode(JSON.stringify(o));

async function pair(med, logs, { A, B, mediatorDid = MEDIATOR_DID, depositMode, restoredB } = {}) {
  A ??= { root: rand(32), nonce: rand(32) };
  B ??= { root: rand(32), nonce: rand(32) };
  A.ids = await deriveWireIdentities(A.root, mediatorDid, A.nonce);
  B.ids = await deriveWireIdentities(B.root, mediatorDid, B.nonce);
  const mk = (self, peer) => createVtiWire({
    rootIkm: self.root, mediatorDid, nonce: self.nonce,
    peerDid: peer.ids.conn.did, peerEgressDid: peer.ids.egress.did,
    transport: med.transport, log: (l) => logs.push(l), depositMode,
  });
  const wireA = await mk(A, B); const wireB = await mk(B, A);
  // the adapter's consumer, for tests that fill its buffer directly
  const onDeliverA = wireA.onDeliver;
  wireA.onDeliver = (cb) => { A.consumer = cb; onDeliverA.call(wireA, cb); };
  const alice = await MediatorCarrierAdapter.create(A.root, mediatorDid, A.nonce, wireA);
  const bob = restoredB
    ? await MediatorCarrierAdapter.create(B.root, mediatorDid, B.nonce, wireB, restoredB, Date.now())
    : await MediatorCarrierAdapter.create(B.root, mediatorDid, B.nonce, wireB);
  // one handshake at a time: the double keys tokens by the last challenge
  alice.register([], Date.now()); await alice.settle();
  bob.register([], Date.now()); await bob.settle();
  return { A, B, alice, bob, wireA, wireB };
}

test("XRFI, XRFA, nested, routed and empty direct frames never reach the adapter; the queue keeps moving (RLTP-VTI-7140)", async () => {
  const med = mediatorDouble();
  const logs = [];
  const { A, B, alice, bob } = await pair(med, logs);
  const bobKeys = { senderSigningKey: B.ids.egress.edSecret, receiverEncryptionKey: peerKeys(A.ids.conn.did).encPub };

  // relationship frames from the expected peer, correctly addressed and signed
  const invite = await packInvite(B.ids.egress.did, A.ids.conn.did, bobKeys);
  const accept = await packAccept(invite.threadDigest, B.ids.egress.did, A.ids.conn.did, bobKeys);
  // an application kind the binding does not speak, and an empty direct message
  const inner = await tspPack(rand(40), B.ids.egress.did, A.ids.conn.did, bobKeys);
  const nested = await packWithHops(inner.bytes, "nested", [], B.ids.egress.did, A.ids.conn.did, bobKeys);
  const empty = await tspPack(new Uint8Array(0), B.ids.egress.did, A.ids.conn.did, bobKeys);
  // a routed message reaching the client itself (the mediator should have opened it)
  const routed = await packRouted(inner.bytes, [B.ids.conn.did], B.ids.egress.did, A.ids.conn.did, bobKeys);

  const texts = [];
  for (const f of [invite, accept, nested, empty, routed]) { texts.push(med.deliver(A.ids.conn.did, f.bytes)); await tick(); }

  assert.equal(alice.collect(Date.now()).items.length, 0, "no TSP control/unsupported frame may reach the adapter");
  assert.match(logs[0], /control\/invite from did:key:/);
  assert.ok(logs[0].includes(B.ids.egress.did), "log names the sender VID");
  assert.match(logs[1], /control\/accept/);
  assert.match(logs[2], /unsupported message type "nested"/);
  assert.match(logs[3], /empty payload/);
  assert.match(logs[4], /unsupported message type "routed"/);

  // acked, so they leave the mediator queue
  const acked = await med.ackedBy(A.ids.conn.did, A.ids.conn.xPublic, A.ids.conn.kid);
  for (const t of texts) assert.ok(acked.includes(await sha256hex(t)), "refused frame acked");

  // the queue is not blocked: a real deposit behind them is delivered byte-identical
  const envelope = rand(64);
  bob.submit(envelope, Date.now()); await bob.settle(); await tick();
  const c = alice.collect(Date.now());
  assert.equal(c.items.length, 1);
  assert.deepEqual(new Uint8Array(c.items[0].bytes), envelope);

  // and its ack still waits for the adapter's conclude (delete-to-ack)
  const before = (await med.ackedBy(A.ids.conn.did, A.ids.conn.xPublic, A.ids.conn.kid)).length;
  assert.equal(before, texts.length, "no ack before conclude");
  alice.conclude(c, Date.now()); await alice.settle(); await tick();
  const after = (await med.ackedBy(A.ids.conn.did, A.ids.conn.xPublic, A.ids.conn.kid)).length;
  assert.equal(after, texts.length + 1, "conclude acks the delivered frame");
  alice.close(); bob.close();
});

test("routed (RLTP-VTI-3110, 3115): outer connection DID → C with the route [peer's connection DID] on the connection session, inner egress → peer's connection DID; the payload arrives byte-identical", async () => {
  const med = mediatorDouble();
  const logs = [];
  const { A, B, alice, bob, wireB } = await pair(med, logs);
  const envelope = rand(64);
  const id = bob.submit(envelope, Date.now()); await bob.settle(); await tick();
  assert.equal(bob.status(id).state, "accepted");
  const c = alice.collect(Date.now());
  assert.equal(c.items.length, 1);
  assert.deepEqual(new Uint8Array(c.items[0].bytes), envelope, "M-2: byte-identical at the receiver");
  assert.equal(med.forwarded.length, 1);
  const f = med.forwarded[0];
  assert.equal(f.session, B.ids.conn.did, "deposited on the connection DID's session");
  assert.deepEqual(f.outer, { sender: B.ids.conn.did, receiver: MEDIATOR_DID, route: [A.ids.conn.did] });
  const inner = await tspUnpack(f.inner, { receiverDecryptionKey: A.ids.conn.xSecret, senderSigningKey: B.ids.egress.edPublic });
  assert.deepEqual([inner.messageType, inner.sender, inner.receiver], ["direct", B.ids.egress.did, A.ids.conn.did]);
  assert.equal(med.sockets.has(B.ids.egress.did), false, "routed: no egress session");
  assert.deepEqual(med.direct, [], "nothing deposited as a single layer");
  const [frame] = wireB.sentFrames();
  assert.equal(frame.mode, "routed");
  assert.ok(frame.outer > frame.inner && frame.inner > frame.payload, JSON.stringify(frame));
  assert.equal(frame.outer, f.outerBytes);
  assert.deepEqual(logs, []);
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
  assert.deepEqual({ A: { connection: A.ids.conn.did, egress: A.ids.egress.did }, B: { connection: B.ids.conn.did, egress: B.ids.egress.did } }, V.sides);
  alice.submit(rand(32), Date.now()); await alice.settle(); await tick();
  bob.submit(rand(32), Date.now()); await bob.settle(); await tick();
  const strip = ({ sealedTo, signedBy, ...rest }) => rest;
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
    assert.deepEqual(depositAddressing("routed", { connection: from.ids.conn.did, egress: from.ids.egress.did }, to.ids.conn.did, V.carrier),
      { inner: strip(want.inner), outer: strip(want.outer), session: want.session }, `${key}: the lib's addressing`);
  }
  alice.close(); bob.close();
});

test("rebinding (RLTP-VTI-7110, 7120): a deposit that failed waits; C's key rotates; the renewal resolves the new key and the waiting document arrives sealed to it; a frame sealed to the old key is dropped", async () => {
  const med = mediatorDouble();
  const logs = [];
  const { A, B, alice, bob } = await pair(med, logs);
  const oldKey = med.publicKey();
  med.sockets.get(B.ids.conn.did).close(); await tick();
  const envelope = rand(48);
  const id = bob.submit(envelope, Date.now()); await bob.settle();
  assert.equal(bob.status(id).state, "awaiting-transport");
  await tick();                                   // the socket is reopened in the background
  med.rotate();
  // a frame packed for the old key never reaches anyone
  const stale = await packRouted((await tspPack(rand(16), B.ids.egress.did, A.ids.conn.did,
    { senderSigningKey: B.ids.egress.edSecret, receiverEncryptionKey: A.ids.conn.xPublic })).bytes,
  [A.ids.conn.did], B.ids.conn.did, MEDIATOR_DID, { senderSigningKey: B.ids.conn.edSecret, receiverEncryptionKey: oldKey });
  med.sockets.get(B.ids.conn.did).send(stale.bytes); await tick();
  assert.deepEqual(med.dropped.map((d) => d.why).filter((w) => w !== "socket closed"), ["not openable with the current key"]);
  assert.equal(alice.collect(Date.now()).items.length, 0);
  // the next attempt after the access token's expiry: renewal, new key, packed anew
  bob.advance(Date.now() + 601_000); await bob.settle(); await tick();
  assert.equal(bob.status(id).state, "accepted");
  const c = alice.collect(Date.now());
  assert.equal(c.items.length, 1);
  assert.deepEqual(new Uint8Array(c.items[0].bytes), envelope);
  assert.equal(med.dropped.filter((d) => d.why === "not openable with the current key").length, 1, "sealed to the new key");
  alice.close(); bob.close();
});

test("fallback (RLTP-VTI-3120): an adapter in egress-session deposits the inner message alone on the egress identity's send-only session, opened at the first such deposit", async () => {
  const med = mediatorDouble();
  const logs = [];
  const send = { mode: "egress-session", open: [], sentAcks: [], seenResends: [] };
  const { A, B, alice, bob, wireB } = await pair(med, logs, { restoredB: { concluded: [], pending: [], send } });
  assert.equal(bob.sendMode, "egress-session");
  assert.equal(med.sockets.has(B.ids.egress.did), false, "lazy: not opened at authentication");
  const envelope = rand(40);
  bob.submit(envelope, Date.now()); await bob.settle(); await tick();
  const c = alice.collect(Date.now());
  assert.equal(c.items.length, 1);
  assert.deepEqual(new Uint8Array(c.items[0].bytes), envelope);
  assert.deepEqual(med.direct, [{ session: B.ids.egress.did, sender: B.ids.egress.did, receiver: A.ids.conn.did }]);
  assert.deepEqual(med.forwarded, []);
  assert.equal(wireB.sentFrames()[0].mode, "egress-session");
  assert.equal(wireB.sentFrames()[0].outer, null);
  // and the forced fallback of the measurement switch, under an adapter in routed
  const med2 = mediatorDouble();
  const p2 = await pair(med2, [], { depositMode: "egress-session" });
  assert.equal(p2.bob.sendMode, "routed");
  p2.bob.submit(envelope, Date.now()); await p2.bob.settle(); await tick();
  assert.equal(p2.alice.collect(Date.now()).items.length, 1);
  assert.equal(med2.direct[0].session, p2.B.ids.egress.did);
  alice.close(); bob.close(); p2.alice.close(); p2.bob.close();
});

test("queueEmpty (RLTP-VTI-3130): false before the session opens and right after a frame, true on an open, quiet session", async () => {
  const med = mediatorDouble();
  const logs = [];
  const A = { root: rand(32), nonce: rand(32) };
  const B = { root: rand(32), nonce: rand(32) };
  A.ids = await deriveWireIdentities(A.root, MEDIATOR_DID, A.nonce);
  B.ids = await deriveWireIdentities(B.root, MEDIATOR_DID, B.nonce);
  const cold = await createVtiWire({ rootIkm: A.root, mediatorDid: MEDIATOR_DID, nonce: A.nonce, peerDid: B.ids.conn.did, peerEgressDid: B.ids.egress.did, transport: med.transport });
  assert.equal(cold.queueEmpty(), false, "no session");
  const p = await pair(med, logs, { A, B });
  await tick(1100);
  assert.equal(p.wireA.queueEmpty(), true);
  p.bob.submit(rand(32), Date.now()); await p.bob.settle(); await tick();
  assert.equal(p.wireA.queueEmpty(), false, "a frame just arrived");
  await tick(1100);
  assert.equal(p.wireA.queueEmpty(), true);
  p.alice.close(); p.bob.close();
});

test("queueEmpty right after the session opens is false; a successor restored past the deadline does not switch at once (B1)", async () => {
  const med = mediatorDouble();
  const send = { mode: "routed", open: [{ digest: "d0", acceptedAt: 0, kind: "document" }], sentAcks: [], seenResends: [] };
  const { alice, bob, wireB } = await pair(med, [], { restoredB: { concluded: [], pending: [], send } });
  assert.equal(wireB.queueEmpty(), false, "just opened: what the mediator holds may still be on its way");
  bob.conclude(bob.collect(Date.now()), Date.now());
  bob.advance(Date.now());
  assert.equal(bob.sendMode, "routed");
  alice.close(); bob.close();
});

test("the egress session is send-only and kept usable: no live delivery, nothing acked, reopened when closed (M3, RLTP-VTI-3120)", async () => {
  const med = mediatorDouble();
  const p = await pair(med, [], { depositMode: "egress-session" });
  const egressDid = p.B.ids.egress.did;
  p.bob.submit(rand(24), Date.now()); await p.bob.settle(); await tick();
  assert.equal(p.alice.collect(Date.now()).items.length, 1);
  assert.deepEqual(med.sent.filter((f) => f.did === egressDid), [], "no live-delivery-change, no ack from the egress identity");
  med.sockets.get(egressDid).close();
  p.bob.submit(rand(24), Date.now()); await p.bob.settle(); await tick();
  assert.equal(p.alice.collect(Date.now()).items.length, 1, "delivered over a reopened session");
  assert.equal(med.opened.filter((d) => d === egressDid).length, 2);
  p.alice.close(); p.bob.close();
});

test("a closed connection socket fails the deposit as unreachable — never accepted on a dead socket — and the retry after the reconnect lands (B1)", async () => {
  const med = mediatorDouble();
  const { A, B, alice, bob } = await pair(med, []);
  med.sockets.get(B.ids.conn.did).close(); await tick();
  const { view, envelope: env } = docView(rand(32));
  const envelope = jcsBytes(env);
  const [{ submissionId: id }] = bob.reconcile(view, gate(), Date.now()); await bob.settle();
  assert.deepEqual(bob.status(id), { state: "awaiting-transport", reason: "transport-unreachable" });
  assert.deepEqual(bob.ackState().send.open, [], "nothing open before an acceptance");
  assert.equal(med.forwarded.length, 0);
  await tick();
  assert.equal(med.opened.filter((d) => d === B.ids.conn.did).length, 2, "reopened");
  bob.advance(Date.now()); await bob.settle(); await tick();
  assert.equal(bob.status(id).state, "accepted");
  assert.equal(bob.ackState().send.open.length, 1, "accepted in routed: an open deposit");
  const c = alice.collect(Date.now());
  assert.deepEqual(new Uint8Array(c.items[0].bytes), envelope);
  void A;
  alice.close(); bob.close();
});

test("an ack on a closed socket fails, so the intent stays and the next advance sends it (N6)", async () => {
  const med = mediatorDouble();
  const { A, alice, bob } = await pair(med, []);
  bob.submit(rand(32), Date.now()); await bob.settle(); await tick();
  const c = alice.collect(Date.now());
  assert.equal(c.items.length, 1);
  med.sockets.get(A.ids.conn.did).close(); await tick();
  alice.conclude(c, Date.now()); await alice.settle();
  assert.equal(alice.ackState().pending.length, 1, "the intent stays");
  await tick(100);                                 // reopened; the mediator offered the frame again (absorbed)
  alice.advance(Date.now()); await alice.settle(); await tick();
  assert.equal(alice.ackState().pending.length, 0);
  const acked = await med.ackedBy(A.ids.conn.did, A.ids.conn.xPublic, A.ids.conn.kid);
  assert.equal(acked.length, 1);
  alice.close(); bob.close();
});

test("a frame from a foreign sender or one that cannot be read is logged and acked, never delivered (N5, RLTP-VTI-7140)", async () => {
  const med = mediatorDouble();
  const logs = [];
  const { A, B: bobSide, alice, bob } = await pair(med, logs);
  const bobIds = bobSide.ids;
  const X = await deriveWireIdentities(rand(32), MEDIATOR_DID, rand(32));
  const foreign = await tspPack(rand(40), X.egress.did, A.ids.conn.did,
    { senderSigningKey: X.egress.edSecret, receiverEncryptionKey: A.ids.conn.xPublic });
  const t1 = med.deliver(A.ids.conn.did, foreign.bytes); await tick();
  // the expected sender's frame, tampered: its signature no longer holds
  const good = await tspPack(rand(40), bobIds.egress.did, A.ids.conn.did,
    { senderSigningKey: bobIds.egress.edSecret, receiverEncryptionKey: A.ids.conn.xPublic });
  const tampered = new Uint8Array(good.bytes); tampered[tampered.length - 5] ^= 0xff;
  const t2 = med.deliver(A.ids.conn.did, tampered); await tick();
  assert.equal(alice.collect(Date.now()).items.length, 0);
  assert.equal(logs.length, 2);
  assert.ok(logs[0].includes(X.egress.did) && /refused/.test(logs[0]), logs[0]);
  assert.ok(logs[1].includes(bobIds.egress.did) && /refused/.test(logs[1]), logs[1]);
  const acked = await med.ackedBy(A.ids.conn.did, A.ids.conn.xPublic, A.ids.conn.kid);
  assert.ok(acked.includes(await sha256hex(t1)) && acked.includes(await sha256hex(t2)));
  alice.close(); bob.close();
});

test("the switch end to end (RLTP-VTI-3130): a mediator that carries no routed frames, a quiet queue, the deadline — then the egress session carries the next document; a frame delivered to the egress socket is dropped unacked", async () => {
  const med = mediatorDouble();
  med.dropRouted = true;
  const logs = [];
  const { B, alice, bob } = await pair(med, logs);
  const bobGate = gate();
  bob.reconcile(docView(rand(32)).view, bobGate, Date.now()); await bob.settle(); await tick();
  assert.equal(alice.collect(Date.now()).items.length, 0, "routed frames are not carried");
  await tick(1100);                               // the real queueEmpty: a quiet open socket
  let t = Date.now();
  bob.conclude(bob.collect(t), t);
  bob.advance(t + 72 * 3_600_000);
  assert.equal(bob.sendMode, "egress-session");
  t += 72 * 3_600_000 + 1;
  const second = rand(32);
  bob.submit(second, t); await bob.settle(); await tick();
  const c = alice.collect(Date.now());
  assert.equal(c.items.length, 1);
  assert.deepEqual(new Uint8Array(c.items[0].bytes), second);
  assert.equal(med.direct.at(-1).session, B.ids.egress.did);
  const before = med.sent.length;
  med.deliver(B.ids.egress.did, (await tspPack(rand(16), B.ids.egress.did, B.ids.egress.did,
    { senderSigningKey: B.ids.egress.edSecret, receiverEncryptionKey: B.ids.egress.xPublic })).bytes);
  await tick();
  assert.equal(med.sent.length, before, "nothing acked from the egress socket");
  assert.equal(bob.collect(Date.now()).items.length, 0);
  assert.deepEqual(logs, []);
  alice.close(); bob.close();
});

test("a frame refused above the cap keeps queueEmpty false; once the buffer is concluded the mediator offers it again at the next open, the adapter takes it, queueEmpty turns true (review 3 N1, review 4 N4)", async () => {
  const med = mediatorDouble();
  const { A, alice, bob, wireA } = await pair(med, []);
  assert.equal(await A.consumer(new Uint8Array(16 * 1024 * 1024)), true, "the buffer is filled to the cap");
  const envelope = rand(32);
  bob.submit(envelope, Date.now()); await bob.settle(); await tick();
  await tick(1100);
  assert.equal(wireA.queueEmpty(), false, "a frame was left with the mediator");
  const c = alice.collect(Date.now());
  assert.equal(c.items.length, 1, "only the big one");
  alice.conclude(c, Date.now()); await alice.settle();
  med.sockets.get(A.ids.conn.did).close();         // the next open offers it again
  await tick(300);
  const again = alice.collect(Date.now());
  assert.equal(again.items.length, 1);
  assert.deepEqual(new Uint8Array(again.items[0].bytes), envelope);
  await tick(1100);
  assert.equal(wireA.queueEmpty(), true);
  alice.close(); bob.close();
});

test("authenticate during a background reconnect waits for it: one socket, never two (review 3 N2)", async () => {
  const med = mediatorDouble();
  const { B, alice, bob, wireB } = await pair(med, []);
  med.sockets.get(B.ids.conn.did).close(); await tick(0);
  await wireB.authenticate();
  await tick(300);
  assert.equal(med.openSockets(B.ids.conn.did), 1);
  assert.equal(med.opened.filter((d) => d === B.ids.conn.did).length, 2);
  alice.close(); bob.close();
});

test("an ack whose socket dies while it is sent fails, so the intent stays (review 3 N3)", async () => {
  const med = mediatorDouble();
  const { A, alice, bob } = await pair(med, []);
  bob.submit(rand(32), Date.now()); await bob.settle(); await tick();
  const c = alice.collect(Date.now());
  med.closeOnNextText = A.ids.conn.did;
  alice.conclude(c, Date.now()); await alice.settle();
  assert.equal(alice.ackState().pending.length, 1);
  await tick(300);
  alice.advance(Date.now()); await alice.settle(); await tick();
  assert.equal(alice.ackState().pending.length, 0);
  alice.close(); bob.close();
});

test("a receive-only side reconnects by itself after its socket drops, and receives again; a closed wire reconnects nothing (review 3 N4)", async () => {
  const med = mediatorDouble();
  const { A, alice, bob, wireA } = await pair(med, []);
  med.sockets.get(A.ids.conn.did).close();
  await tick(300);
  assert.equal(med.openSockets(A.ids.conn.did), 1, "reopened without a send of its own");
  const envelope = rand(32);
  bob.submit(envelope, Date.now()); await bob.settle(); await tick();
  const c = alice.collect(Date.now());
  assert.deepEqual(new Uint8Array(c.items[0].bytes), envelope);
  const before = med.opened.length;
  wireA.close();
  await tick(300);
  assert.equal(med.opened.length, before, "no reconnect after close()");
  alice.close(); bob.close();
});
