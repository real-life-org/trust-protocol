// wire-demux.test.mjs — TSP Rev 3 message-type dispatch in vti-wire.mjs,
// offline. The real wire, the real RltpMediatorSession and the real
// adapter run over a mediator double: ATM HTTP, DID resolution and the
// socket are replaced (cfg.transport), the TSP and DIDComm crypto is
// the real 0.3.0 / 0.12.0 code. Issue #95: a relationship frame must
// not reach the adapter, and must not block the queue.

import { test } from "node:test";
import assert from "node:assert/strict";
import { x25519 } from "@noble/curves/ed25519.js";
import { multibase, jwk, unpack as didcommUnpack } from "@openvtc/vti-didcomm-js";
import {
  pack as tspPack, packInvite, packAccept, packWithHops, decodeEnvelope,
} from "@openvtc/vti-tsp-js";
import { MediatorCarrierAdapter } from "../../lib/dist/adapters/vti-mediator.js";
import { createVtiWire, deriveWireIdentities, peerKeys } from "../vti-wire.mjs";

const MEDIATOR_DID = "did:example:mediator-double";
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const b64u = (u8) => Buffer.from(u8).toString("base64url");
const sha256hex = async (text) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).toString("hex");
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

/** Store-and-forward mediator double: routes binary TSP frames on the
 *  envelope receiver to that DID's socket (as qb64 text), records the
 *  DIDComm frames each client sends (acks, live-delivery changes). */
function mediatorDouble() {
  const xSecret = rand(32);
  const xPublic = x25519.getPublicKey(xSecret);
  const kid = `${MEDIATOR_DID}#key-1`;
  const sockets = new Map();            // client DID → FakeWs
  const sent = [];                       // { did, data } DIDComm text frames
  let lastChallengeDid = null;

  const resolve = async () => ({
    didDocument: {
      id: MEDIATOR_DID,
      verificationMethod: [{
        id: kid, type: "Multikey", controller: MEDIATOR_DID,
        publicKeyMultibase: multibase.encodeMultikey(multibase.MULTICODEC.X25519_PUB, xPublic),
      }],
      keyAgreement: [kid],
      service: [{
        id: `${MEDIATOR_DID}#service`, type: ["DIDCommMessaging"],
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

  class FakeWs {
    constructor(_url, protocols) {
      this.did = protocols[0].slice("bearer.tok:".length);
      this.readyState = 1;
      sockets.set(this.did, this);
      setTimeout(() => this.onopen?.(), 0);
    }
    send(data) {
      if (typeof data === "string") { sent.push({ did: this.did, data }); return; }
      const qb2 = new Uint8Array(data);
      const to = decodeEnvelope(qb2).envelope.receiver;
      sockets.get(to)?.onmessage?.({ data: b64u(qb2) });
    }
    close() { this.readyState = 3; }
  }

  /** Inject a frame into a client's socket as the mediator would deliver it. */
  const deliver = (did, qb2) => {
    const text = b64u(qb2);
    sockets.get(did).onmessage({ data: text });
    return text;
  };

  /** The message ids a client has acked (decrypting its messages-received). */
  const ackedBy = async (did, clientXPublic, clientKid) => {
    const ids = [];
    for (const f of sent.filter((s) => s.did === did)) {
      const { message } = await didcommUnpack(f.data,
        { kid, privateJwk: jwk.privateJwk("X25519", xSecret, xPublic) },
        { kid: clientKid, publicJwk: jwk.publicJwk("X25519", clientXPublic) });
      if (message.type.endsWith("/messages-received")) ids.push(...message.body.message_id_list);
    }
    return ids;
  };

  return { transport: { fetch, resolve, WebSocketImpl: FakeWs }, deliver, ackedBy };
}

async function pair(med, logs) {
  const A = { root: rand(32), nonce: rand(32) };
  const B = { root: rand(32), nonce: rand(32) };
  A.ids = await deriveWireIdentities(A.root, MEDIATOR_DID, A.nonce);
  B.ids = await deriveWireIdentities(B.root, MEDIATOR_DID, B.nonce);
  const mk = (self, peer) => createVtiWire({
    rootIkm: self.root, mediatorDid: MEDIATOR_DID, nonce: self.nonce,
    peerDid: peer.ids.conn.did, peerEgressDid: peer.ids.egress.did,
    transport: med.transport, log: (l) => logs.push(l),
  });
  const wireA = await mk(A, B); const wireB = await mk(B, A);
  const alice = await MediatorCarrierAdapter.create(A.root, MEDIATOR_DID, A.nonce, wireA);
  const bob = await MediatorCarrierAdapter.create(B.root, MEDIATOR_DID, B.nonce, wireB);
  // one handshake at a time: the double keys tokens by the last challenge
  alice.register([], Date.now()); await alice.settle();
  bob.register([], Date.now()); await bob.settle();
  return { A, B, alice, bob, wireA, wireB };
}

test("XRFI, XRFA, nested and empty direct frames never reach the adapter; the queue keeps moving", async () => {
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

  const texts = [];
  for (const f of [invite, accept, nested, empty]) { texts.push(med.deliver(A.ids.conn.did, f.bytes)); await tick(); }

  assert.equal(alice.collect(Date.now()).items.length, 0, "no TSP control/unsupported frame may reach the adapter");
  assert.match(logs[0], /control\/invite from did:key:/);
  assert.ok(logs[0].includes(B.ids.egress.did), "log names the sender VID");
  assert.match(logs[1], /control\/accept/);
  assert.match(logs[2], /unsupported message type "nested"/);
  assert.match(logs[3], /empty payload/);

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
