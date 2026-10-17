// vti-wire.mjs — the concrete MediatorWire over vti-didcomm-js 0.12.0
// and vti-tsp-js 0.3.0, TSP Rev 3 (profile §7: TSP framing, CESR demux, ack translation and
// the M-2 duty live HERE, below the adapter's byte boundary).
//
// Responsibilities:
//   · derive the wire identities' RAW seeds by re-running the lib's
//     own HKDF (same prefixes → byte-identical DIDs to the adapter's)
//   · ATM auth under the CONNECTION DID; one socket per principal
//   · deposit = TSP Rev 3 direct-mode pack of the sealed RLTP envelope
//     (HPKE-Base to the peer's connection key, outer Ed25519 signature
//     by the sender), SENDER = the egress identity (§5a.10 ingress
//     identifier), addressed to the peer's connection DID
//   · onDeliver hands the adapter the INNER payload bytes (M-2: the
//     raw received bytes, passed truthfully) and keeps the
//     payload-digest → mediator-queue-id translation for acks
//   · delete-to-ack stays the ADAPTER's conclude: the stock 0.12.0
//     session acks right after the consumer returns — we override that
//     dispatch so the ack fires only when the adapter says so.

import { WebSocket } from "ws";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import {
  authenticateToMediator, MediatorSession, multibase, didKey,
} from "@openvtc/vti-didcomm-js";
import { pack as tspPack, unpack as tspUnpack } from "@openvtc/vti-tsp-js";
import { hkdf, sha } from "../lib/dist/crypto.js";
import {
  CONNECTION_INFO_PREFIX, EGRESS_INFO_PREFIX, CARRIER_INFO_PREFIX,
} from "../lib/dist/carrier-identity.js";

const te = new TextEncoder();
const hexOf = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
const mh = async (bytes) => {
  const d = await sha(bytes);
  const withPrefix = new Uint8Array(2 + d.length);
  withPrefix.set([0x12, 0x20]); withPrefix.set(d, 2);
  return "u" + Buffer.from(withPrefix).toString("base64url");
};

/** The same derivation the lib performs — prefix + Dc + Dn — but
 *  yielding the RAW Ed seed the TSP wire needs (the lib keeps its
 *  keys non-extractable; the binding re-derives from the same root). */
async function wireIdentity(rootIkm, carrier, nonce, prefix) {
  const info = prefix + (await mh(te.encode(carrier))) + (await mh(nonce));
  const edSecret = await hkdf(rootIkm, info);
  const edPublic = ed25519.getPublicKey(edSecret);
  const xSecret = ed25519.utils.toMontgomerySecret(edSecret);
  const xPublic = x25519.getPublicKey(xSecret);
  const did = `did:key:${multibase.encodeMultikey(multibase.MULTICODEC.ED25519_PUB, edPublic)}`;
  const doc = didKey.resolve(did).didDocument;
  const agreementId = doc.keyAgreement?.[0]?.id ?? doc.keyAgreement?.[0];
  return { did, kid: agreementId, edSecret, edPublic, xSecret, xPublic };
}

/** Public TSP keys of a peer did:key, resolved offline. */
export function peerKeys(did) {
  const doc = didKey.resolve(did).didDocument;
  const agreementId = doc.keyAgreement?.[0]?.id ?? doc.keyAgreement?.[0];
  const methods = doc.verificationMethod ?? [];
  const agreement = methods.find((vm) => vm.id === agreementId);
  const signing = methods.find((vm) => vm.id !== agreementId);
  return {
    signPub: multibase.decodeMultikey(signing.publicKeyMultibase).key,
    encPub: multibase.decodeMultikey(agreement.publicKeyMultibase).key,
  };
}

/** Delete-to-ack under the ADAPTER's control: the stock session acks
 *  a TSP frame the moment the consumer returns (0.12.0
 *  `_dispatchTspFrame`, with a session-level `_seen` dedup);
 *  here the frame is only handed off — `ackTsp` fires when the
 *  adapter concludes. The adapter's three registers own absorption,
 *  so the session-level dedup is dropped too. */
class RltpMediatorSession extends MediatorSession {
  async _dispatchTspFrame(qb2, text) {
    if (!this.onTspFrame) return;
    try { await this.onTspFrame(qb2, text); } catch (e) {
      if (process.env.RLTP_WIRE_DEBUG) console.error("[wire] tsp dispatch failed:", e?.message ?? e);
    }
  }
  ackTsp(ids) { return this._ackReceived(ids); }
}

/**
 * Build the MediatorWire the adapter's factory expects.
 * One wire = one principal's mediation relationship (§5a.10).
 *
 * @param {Object} cfg
 * @param {Uint8Array} cfg.rootIkm       the relationship root
 * @param {string}     cfg.mediatorDid   C, exactly as configured
 * @param {Uint8Array} cfg.nonce         the 32-byte carrier nonce N
 * @param {string}     cfg.peerDid       counterpart's CONNECTION did:key (addressing)
 * @param {string}     cfg.peerEgressDid counterpart's EGRESS did:key (sender verification)
 */
export async function createVtiWire(cfg) {
  const conn = await wireIdentity(cfg.rootIkm, cfg.mediatorDid, cfg.nonce, CONNECTION_INFO_PREFIX);
  const egress = await wireIdentity(cfg.rootIkm, cfg.mediatorDid, cfg.nonce, EGRESS_INFO_PREFIX);

  let session = null;
  let consumer = null;
  const ackMap = new Map();       // adapter payload-digest → mediator queue-id (sha256 of qb64 text)
  const sentPeers = cfg.peerEgressDid ? peerKeys(cfg.peerEgressDid) : null;
  const peerConn = peerKeys(cfg.peerDid);
  // net policy for the advertised mediator endpoints (0.12.0: replaces
  // the deprecated `allowInsecure`); the same policy guards the socket
  const netPolicy = process.env.MEDIATOR_ALLOW_INSECURE
    ? { allowInsecure: true, allowPrivate: true } : undefined;
  // Deposit mode — MEASUREMENT switch, not a profile option:
  //   egress          (default, profile §1/§5a.10) sender = egress
  //                   identity, sent on the connection DID's socket
  //   egress-session  sender = egress identity, sent on a second ATM
  //                   session authenticated AS the egress identity
  //   connection      sender = connection DID on its own socket
  // The live mediator (instance of 2026-09-27) relays a TSP frame only
  // when its envelope sender is the socket's authenticated DID; the
  // two variants measure what that costs. Both sides of a probe must
  // run the same mode.
  const depositMode = process.env.RLTP_WIRE_DEPOSIT ?? "egress";
  if (!["egress", "egress-session", "connection"].includes(depositMode)) {
    throw new Error(`RLTP_WIRE_DEPOSIT: unknown mode ${depositMode}`);
  }
  const sender = depositMode === "connection" ? conn : egress;
  const expectedPeerSender = depositMode === "connection" ? cfg.peerDid : cfg.peerEgressDid;
  const expectedPeerKeys = depositMode === "connection" ? peerConn : sentPeers;
  let egressSession = null;

  async function ensureSession(accessToken, mediator) {
    if (session) return session;
    session = new RltpMediatorSession({
      mediator,
      mediatorJwt: accessToken,
      client: { did: conn.did, kid: conn.kid, privateKey: conn.xSecret, publicKey: conn.xPublic },
      WebSocketImpl: WebSocket,
      netPolicy,
      onTspFrame: async (qb2, text) => {
        if (!consumer) return;
        const mediatorQid = hexOf(await sha(te.encode(text)));
        // strip the TSP frame: the adapter's byte boundary is the
        // sealed RLTP envelope, passed truthfully (M-2). Rev 3: HPKE-Base
        // to our connection key; the sender is proven by the outer
        // signature under the peer's egress key (no sender key in the KEM)
        const got = await tspUnpack(qb2, {
          receiverDecryptionKey: conn.xSecret,
          senderSigningKey: expectedPeerKeys.signPub,
        });
        if (got.revision !== "rev3") throw new Error(`TSP ${got.revision} frame refused: the binding speaks Rev 3`);
        if (got.sender !== expectedPeerSender || got.receiver !== conn.did) {
          throw new Error("TSP frame for another relationship");
        }
        const payload = new Uint8Array(got.payload);
        const payloadQid = hexOf(await sha(payload));
        ackMap.set(payloadQid, mediatorQid);
        await consumer(payload);
      },
      onError: () => {},
    });
    await session.connect();
    return session;
  }

  let mediatorInfo = null;

  return {
    connectionDid: conn.did,
    egressDid: egress.did,

    async authChallenge() {
      // the ATM handshake is one call in the vti lib; the adapter's
      // two-step shape is satisfied with a staged marker
      return { challenge: "vti-staged", sessionId: "vti-staged" };
    },

    async authenticate() {
      const auth = await authenticateToMediator({
        mediatorDid: cfg.mediatorDid,
        clientDid: conn.did,
        clientX25519Private: conn.xSecret,
        clientX25519Public: conn.xPublic,
        netPolicy,
      });
      mediatorInfo = auth.mediator;
      await ensureSession(auth.accessToken, auth.mediator);
      if (depositMode === "egress-session" && !egressSession) {
        const eAuth = await authenticateToMediator({
          mediatorDid: cfg.mediatorDid,
          clientDid: egress.did,
          clientX25519Private: egress.xSecret,
          clientX25519Public: egress.xPublic,
          netPolicy,
        });
        // send-only: no TSP consumer, so nothing queued for the egress
        // identity is taken or acked here
        egressSession = new MediatorSession({
          mediator: eAuth.mediator,
          mediatorJwt: eAuth.accessToken,
          client: { did: egress.did, kid: egress.kid, privateKey: egress.xSecret, publicKey: egress.xPublic },
          WebSocketImpl: WebSocket,
          netPolicy,
          onError: () => {},
        });
        await egressSession.connect();
      }
      return {
        accessToken: auth.accessToken,
        accessExpiresAt: (auth.accessExpiresAt ?? 0) * 1000 || Date.now() + 600_000,
        refreshToken: auth.refreshToken ?? "",
        refreshExpiresAt: (auth.refreshExpiresAt ?? 0) * 1000 || Date.now() + 86_400_000,
      };
    },

    async refresh() {
      // silent renewal = re-run the handshake (decision 4: no port event)
      return this.authenticate();
    },

    async keylistUpdate() {
      // the dev mediator routes on the authenticated connection DID
      // (measured in ref-04); a coordinate-mediation keylist is not
      // required for did:key clients. Recorded as a no-op with note.
    },

    async deposit(_token, bytes, egressDid) {
      if (egressDid !== egress.did) throw new Error("deposit under a foreign egress identity");
      const s = depositMode === "egress-session" ? egressSession : session;
      if (!s) throw new Error("no session");
      // TSP Rev 3 direct: sender = egress identity (outer signature),
      // receiver = the peer's connection DID (HPKE-Base to its X25519
      // key); the mediator routes on the cleartext envelope
      const packed = await tspPack(bytes, sender.did, cfg.peerDid, {
        senderSigningKey: sender.edSecret,
        receiverEncryptionKey: peerConn.encPub,
      });
      if (process.env.RLTP_WIRE_DEBUG) console.error(`[wire] deposit ${bytes.length}B payload → ${packed.bytes.length}B TSP Rev 3 frame (sender ${sender === conn ? "connection" : "egress"} DID)`);
      s.sendBinary(packed.bytes);
    },

    async ackReceived(_token, queueIds) {
      const s = session; if (!s) return;
      const mediatorIds = queueIds.map((q) => ackMap.get(q)).filter(Boolean);
      if (mediatorIds.length === 0) return;
      await s.ackTsp(mediatorIds);
      for (const q of queueIds) ackMap.delete(q);
    },

    onDeliver(cb) { consumer = cb; },

    close() {
      try { session?.close(); } catch { /* teardown */ }
      try { egressSession?.close(); } catch { /* teardown */ }
    },
  };
}
