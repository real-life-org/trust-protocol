// vti-wire.mjs — the concrete MediatorWire over vti-didcomm-js 0.13.0
// and vti-tsp-js 0.4.0, TSP 1.0 (profile 0.28 §7: TSP framing, CESR demux, ack translation and
// the M-2 duty live HERE, below the adapter's byte boundary).
//
// Responsibilities:
//   · derive the wire identities' RAW seeds by re-running the lib's
//     own HKDF (same prefixes → byte-identical DIDs to the adapter's)
//   · ATM auth under the CONNECTION DID; one socket per principal
//   · deposit in the sending form of profile 0.28 §3a, in the mode the
//     adapter names (depositAddressing of the lib says who addresses
//     whom), packed anew for every attempt (RLTP-VTI-7110):
//       routed          inner TSP 1.0 `direct` egress identity →
//                       peer's connection DID (HPKE-Base to its key,
//                       signed by the egress identity), inside an outer
//                       routed message connection DID → C, route [peer's
//                       connection DID], sealed to the key C's DID
//                       document names first under keyAgreement as
//                       resolved at the last authentication or renewal
//                       (RLTP-VTI-7120); sent on the connection DID's
//                       session
//       egress-session  the inner message alone, on a send-only session
//                       the egress identity authenticates lazily at the
//                       first deposit in this mode (RLTP-VTI-3120)
//   · onDeliver hands the adapter the INNER payload bytes of a TSP 1.0
//     `direct` message (M-2: the raw received bytes, passed truthfully)
//     and keeps the payload-digest → mediator-queue-id translation for
//     acks; control (XRFI/XRFA/XRFD), padding and any other message
//     type is logged, acked and never delivered; so is a frame of
//     any other major version (Rev 3 included), which the library refuses
//     from its version marker before any key is touched
//   · delete-to-ack stays the ADAPTER's conclude: the stock 0.13.0
//     session acks right after the consumer returns — we override that
//     dispatch so the ack fires only when the adapter says so.

import { WebSocket } from "ws";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import {
  authenticateToMediator, MediatorSession, multibase, didKey, identityOfKid,
} from "@openvtc/vti-didcomm-js";
import { pack as tspPack, unpack as tspUnpack, packRouted, decodeEnvelope } from "@openvtc/vti-tsp-js";
import { depositAddressing, WireError } from "../lib/dist/adapters/vti-mediator.js";
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

/** The wire pair (connection, egress) of one relationship × carrier,
 *  including RAW secrets — for tests that act as the counterpart. */
export async function deriveWireIdentities(rootIkm, mediatorDid, nonce) {
  return {
    conn: await wireIdentity(rootIkm, mediatorDid, nonce, CONNECTION_INFO_PREFIX),
    egress: await wireIdentity(rootIkm, mediatorDid, nonce, EGRESS_INFO_PREFIX),
  };
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
 *  a TSP frame the moment the consumer returns (0.13.0
 *  `_dispatchTspFrame`, with a session-level `_seen` dedup);
 *  here the frame is only handed off — `ackTsp` fires when the
 *  adapter concludes. The adapter's three registers own absorption,
 *  so the session-level dedup is dropped too. */
const PROBLEM_REPORT = "https://didcomm.org/report-problem/2.0/problem-report";
/** Mediator 0.45 with local direct delivery off (RLTP-VTI-3120). */
const DIRECT_DELIVERY_DENIED = "e.p.direct_delivery.denied";

/** The egress identity's send-only session (RLTP-VTI-3120): the socket
 *  opens without the live-delivery-change the stock `connect()` sends (no
 *  Live Mode); it collects nothing and acknowledges nothing. The one frame
 *  it reads is the mediator's own problem report — how a mediator refuses
 *  a deposit on this session (0.45 with local direct delivery off:
 *  `e.p.direct_delivery.denied`); it goes to `onRefusal`. */
class SendOnlySession extends MediatorSession {
  async connect() { await this._openSocket(); }
  async _dispatchTspFrame() { /* send-only: collects nothing */ }
  async _dispatchFrame(result) {
    const m = result.message;
    if (result.senderDid === identityOfKid(this.mediator.did) && m?.type === PROBLEM_REPORT) this.onRefusal?.(m.body ?? {});
  }
  _ackReceived() { return Promise.resolve(); /* send-only: acknowledges nothing */ }
}

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
 * @param {string}     cfg.peerDid       counterpart's CONNECTION did:key (addressing): the
 *        `id` without `#tsp` of its delivery hint (profile 0.28 §1b, RLTP-VTI-1240)
 * @param {string}     cfg.peerEgressDid counterpart's EGRESS did:key (sender verification):
 *        the `rltpEgress` of that hint; required in every form that reads from
 *        the egress identity (the profile forms and the control form `egress`);
 *        only the control form `connection` does without it
 * @param {(line: string) => void} [cfg.log]  sink for frames that are not
 *        delivered (default: stderr)
 * @param {string}     [cfg.depositMode] overrides RLTP_WIRE_DEPOSIT (default
 *        `routed`: follow the adapter's mode)
 * @param {Object}     [cfg.transport]   test seam: `{ fetch, resolve,
 *        WebSocketImpl }` replace the network (ATM HTTP, DID resolution,
 *        socket); omitted, the real ones are used
 */
export async function createVtiWire(cfg) {
  const conn = await wireIdentity(cfg.rootIkm, cfg.mediatorDid, cfg.nonce, CONNECTION_INFO_PREFIX);
  const egress = await wireIdentity(cfg.rootIkm, cfg.mediatorDid, cfg.nonce, EGRESS_INFO_PREFIX);

  let session = null;
  let consumer = null;
  const log = cfg.log ?? ((line) => console.error(line));
  const transport = cfg.transport ?? {};
  const WebSocketImpl = transport.WebSocketImpl ?? WebSocket;
  const atmSeams = {
    ...(transport.fetch ? { fetch: transport.fetch } : {}),
    ...(transport.resolve ? { resolve: transport.resolve } : {}),
  };
  const ackMap = new Map();       // adapter payload-digest → mediator queue-id (sha256 of qb64 text)
  // the counterpart's identities are never this side's own (RLTP-VTI-1227)
  const own = new Set([conn.did, egress.did]);
  if (own.has(cfg.peerDid) || (cfg.peerEgressDid && own.has(cfg.peerEgressDid))) {
    throw new Error("createVtiWire: a counterpart identity names one of this side's own wire identities (RLTP-VTI-1227)");
  }
  const sentPeers = cfg.peerEgressDid ? peerKeys(cfg.peerEgressDid) : null;
  const peerConn = peerKeys(cfg.peerDid);
  // net policy for the advertised mediator endpoints (vti-didcomm-js
  // netPolicy; replaces the deprecated `allowInsecure`); the same policy guards the socket
  const netPolicy = process.env.MEDIATOR_ALLOW_INSECURE
    ? { allowInsecure: true, allowPrivate: true } : undefined;
  // Deposit form (RLTP_WIRE_DEPOSIT, or cfg.depositMode):
  //   routed          (default) follow the mode the adapter names on each
  //                   deposit — `routed`, or `egress-session` after the
  //                   switch of RLTP-VTI-3130 (profile 0.28 §3a)
  //   egress-session  force the fallback for every deposit (measurement)
  //   egress          control, NOT profile-conformant: the inner message
  //                   alone on the connection DID's socket — dropped by
  //                   the mediator, which relays only frames whose
  //                   sender is the socket's DID
  //   connection      control, NOT profile-conformant (RLTP-VTI-1130):
  //                   sender = connection DID, single layer, own socket
  // Both sides of a probe in a control form must run the same form.
  const depositMode = cfg.depositMode ?? process.env.RLTP_WIRE_DEPOSIT ?? "routed";
  if (!["routed", "egress-session", "egress", "connection"].includes(depositMode)) {
    throw new Error(`RLTP_WIRE_DEPOSIT: unknown mode ${depositMode}`);
  }
  // in every form but `connection` the counterpart's documents come from its egress
  // identity: without it the counterpart has no wire identities at C, and
  // no instance exists (RLTP-VTI-1235) — refused here, never a wire that
  // refuses and acknowledges every frame it receives
  if (depositMode !== "connection" && !cfg.peerEgressDid) {
    throw new Error("createVtiWire: no peerEgressDid — the counterpart has no wire identities at C (RLTP-VTI-1235)");
  }
  const expectedPeerSender = depositMode === "connection" ? cfg.peerDid : cfg.peerEgressDid;
  const expectedPeerKeys = depositMode === "connection" ? peerConn : sentPeers;
  let egressSession = null;
  let egressAuthing = null;
  // a refusal of direct delivery the mediator sent on the egress session
  // (problem report e.p.direct_delivery.denied): the carrier does not carry
  // the fallback form, and the switch is one-way (RLTP-VTI-3130), so every
  // later deposit in mode egress-session fails as WireError('direct-refused')
  // for the life of this wire, and directRefused() says so from the moment
  // the report arrived; the adapter records it in the relationship's send
  // state, which carries it across openings (RLTP-VTI-3120, Open Issue 4).
  // Any other problem report is logged and consumed (§5)
  let egressRefusal = null;
  // queueEmpty(): frames the session has received but not yet handed to
  // the adapter, and when the last TSP frame arrived
  let dispatching = 0;
  let lastFrameAt = 0;
  // a frame the adapter did not take since the socket last opened: it waits
  // at the mediator, which offers it again only at the next open; until
  // then queueEmpty() is false, so on a stable socket the switch is held
  // back (fail-safe). One wire serves exactly one adapter instance.
  let leftBehind = false;
  const QUIET_MS = 1000;

  async function ensureSession(accessToken, mediator) {
    if (session) return session;
    session = new RltpMediatorSession({
      mediator,
      mediatorJwt: accessToken,
      client: { did: conn.did, kid: conn.kid, privateKey: conn.xSecret, publicKey: conn.xPublic },
      WebSocketImpl,
      netPolicy,
      onTspFrame: async (qb2, text) => {
        lastFrameAt = Date.now();
        dispatching++;
        try {
          await dispatchFrame(qb2, text);
        } catch (e) {
          if (e?.consumer) {
            leftBehind = true;
            if (process.env.RLTP_WIRE_DEBUG) console.error("[wire] adapter refused a frame:", e.cause?.message ?? e.cause);
            return;
          }
          // a frame that cannot be opened (another major version included),
          // or one from another sender or for another relationship, is
          // refused for good: logged (type and sender VID from the cleartext
          // envelope where it reads, no secrets) and acked, so it does not
          // stay in the queue (RLTP-VTI-7140)
          let sender = "unknown";
          try { sender = decodeEnvelope(qb2).envelope.sender || "unknown"; } catch { /* undecodable */ }
          log(`[wire] TSP frame from ${sender} refused: ${e?.message ?? "unreadable"} (acked and dropped)`);
          try { await session.ackTsp([hexOf(await sha(te.encode(text)))]); } catch { /* the next delivery re-covers */ }
        } finally { dispatching--; lastFrameAt = Date.now(); }
      },
      onError: () => {},
      onClose: () => scheduleReconnect(),
    });
    await session.connect();
    // live delivery pushes what the mediator holds from now on: the quiet
    // period of queueEmpty() starts at the open, not at the epoch
    opened();
    return session;
  }

  // A socket that closed under the session is opened again in the
  // background (single-flight); the call that found it closed fails as
  // unreachable, so the adapter keeps the deposit or the ack intent and
  // retries — never a silent success on a dead socket (ws drops a send
  // after close without an error).
  // A drop of the socket (onClose) schedules a reconnect with backoff,
  // so a side that only receives comes back without a send of its own;
  // after close() no timer runs. Every path shares one reconnect.
  let reconnecting = null;
  let reconnectTimer = null;
  let backoff = 0;
  let wireClosed = false;
  function opened() { lastFrameAt = Date.now(); leftBehind = false; backoff = 0; }
  function reconnect() {
    if (session?.isOpen) return Promise.resolve();
    if (!session || wireClosed) return Promise.reject(new WireError("unreachable", "no session"));
    reconnecting ??= session.connect().then(opened).finally(() => { reconnecting = null; });
    return reconnecting;
  }
  function scheduleReconnect() {
    if (wireClosed || reconnectTimer) return;
    const delay = Math.min(50 * 2 ** backoff, 30_000);
    backoff++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnect().catch(() => scheduleReconnect());
    }, delay);
    reconnectTimer.unref?.();
  }
  function openSession() {
    if (session?.isOpen) return session;
    if (session) reconnect().catch(() => scheduleReconnect());
    throw new WireError("unreachable", "the connection DID's socket is closed");
  }

  async function dispatchFrame(qb2, text) {
    if (!consumer) return;
    const mediatorQid = hexOf(await sha(te.encode(text)));
    // strip the TSP frame: the adapter's byte boundary is the
    // sealed RLTP envelope, passed truthfully (M-2). TSP 1.0: HPKE-Base
    // to our connection key; the sender is proven by the outer
    // signature under the peer's egress key and the sender VID the
    // confidential payload carries (ESSR; no sender key in the KEM).
    // The library opens major version 1 only: any other major version,
    // Rev 3 included, a sender VID in the payload other than the
    // envelope's, and a NULL sender VID are refused here, before the consumer
    const got = await tspUnpack(qb2, {
      receiverDecryptionKey: conn.xSecret,
      senderSigningKey: expectedPeerKeys.signPub,
    });
    if (got.sender !== expectedPeerSender || got.receiver !== conn.did) {
      throw new Error("TSP frame for another relationship");
    }
    // The library opens every message kind; only an application message
    // of kind `direct` carrying bytes is a sealed RLTP envelope.
    // Anything else is authenticated but never delivered: it is
    // logged and acked so it leaves the queue (the stock session's
    // rule for frames refused for good). Relationship frames
    // (XRFI/XRFA/XRFD, referral inside an invite) and padding are
    // not acted on — the binding runs no TSP relationship state.
    const refuse = async (what) => {
      log(`[wire] TSP ${what} from ${got.sender} not delivered (acked and dropped)`);
      await session.ackTsp([mediatorQid]);
    };
    if (got.messageType === "control") {
      const ref = got.control?.referral ? "+referral" : "";
      return refuse(`control/${got.control?.controlType ?? "unknown"}${ref}`);
    }
    if (got.messageType === "padding") return refuse("padding");
    if (got.messageType !== "direct") return refuse(`refused: unsupported message type ${JSON.stringify(got.messageType)}`);
    if (got.payload.length === 0) return refuse("refused: direct message with empty payload");
    const payload = new Uint8Array(got.payload);
    const payloadQid = hexOf(await sha(payload));
    ackMap.set(payloadQid, mediatorQid);
    // the adapter's own failure is not a refusal of the frame: unacked, redelivered
    let took;
    try { took = await consumer(payload); } catch (e) { throw Object.assign(new Error("consumer failed"), { consumer: true, cause: e }); }
    // not taken (the adapter's queue is full, or it is retired): the frame
    // stays with the mediator, which offers it again at the next open
    if (took === false) leftBehind = true;
  }

  // C's key as resolved at the last authentication or token renewal of the
  // connection DID's session (RLTP-VTI-7120): every outer layer packed
  // after that is sealed to it
  let mediatorInfo = null;

  /** The egress identity's send-only session (RLTP-VTI-3120), opened at
   *  the first deposit in mode egress-session and checked before every
   *  deposit: a closed socket or an access token at its end is
   *  authenticated and opened anew. It collects nothing, acknowledges
   *  nothing, holds no keylist and no Live Mode (SendOnlySession). */
  let egressExpiresAt = 0;
  function ensureEgressSession() {
    if (egressSession?.isOpen && Date.now() < egressExpiresAt) return Promise.resolve(egressSession);
    egressAuthing ??= (async () => {
      try { egressSession?.close(); } catch { /* replaced below */ }
      egressSession = null;
      const eAuth = await authenticateToMediator({
        mediatorDid: cfg.mediatorDid,
        clientDid: egress.did,
        clientX25519Private: egress.xSecret,
        clientX25519Public: egress.xPublic,
        netPolicy,
        ...atmSeams,
      });
      egressExpiresAt = (eAuth.accessExpiresAt ?? 0) * 1000 || Date.now() + 600_000;
      const s = new SendOnlySession({
        mediator: eAuth.mediator,
        mediatorJwt: eAuth.accessToken,
        client: { did: egress.did, kid: egress.kid, privateKey: egress.xSecret, publicKey: egress.xPublic },
        WebSocketImpl,
        netPolicy,
        onError: (e) => log(`[wire] egress session: ${e?.message ?? e}`),
      });
      s.onRefusal = (body) => {
        const code = body.code ?? "unknown";
        if (code === DIRECT_DELIVERY_DENIED) egressRefusal = code;
        log(`[wire] egress session: the mediator refused a deposit (${code}): ${body.comment ?? ""}${egressRefusal ? "; egress-session deposits refused from now on" : " (consumed)"}`);
      };
      await s.connect();
      egressSession = s;
      return s;
    })().finally(() => { egressAuthing = null; });
    return egressAuthing;
  }

  /** The last frames' sizes and modes, for the probes' measurements. */
  const sent = [];

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
        ...atmSeams,
      });
      mediatorInfo = auth.mediator;
      if (session) {
        // a renewal: the session's own DIDComm traffic (acks, live
        // delivery) and its next reconnect use what was just resolved
        session.mediator = auth.mediator;
        session.mediatorJwt = auth.accessToken;
        // reconnect with the renewed token, joining a reconnect already
        // running (never a second socket); the quiet period starts anew
        if (!session.isOpen) await reconnect();
      }
      await ensureSession(auth.accessToken, auth.mediator);
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

    async deposit(_token, bytes, egressDid, adapterMode = "routed") {
      if (egressDid !== egress.did) throw new Error("deposit under a foreign egress identity");
      const mode = depositMode === "routed" ? adapterMode : depositMode;
      if (mode === "connection") {
        // control form, not profile-conformant (RLTP-VTI-1130)
        openSession();
        const packed = await tspPack(bytes, conn.did, cfg.peerDid, {
          senderSigningKey: conn.edSecret, receiverEncryptionKey: peerConn.encPub,
        });
        sent.push({ mode, payload: bytes.length, inner: packed.bytes.length, outer: null });
        openSession().sendBinary(packed.bytes);
        return;
      }
      const addr = depositAddressing(mode === "egress" ? "egress-session" : mode,
        { connection: conn.did, egress: egress.did }, cfg.peerDid, cfg.mediatorDid);
      // inner: TSP 1.0 direct, egress identity → peer's connection DID,
      // HPKE-Base to its key, signed by the egress identity (RLTP-VTI-1110)
      const inner = await tspPack(bytes, addr.inner.sender, addr.inner.receiver, {
        senderSigningKey: egress.edSecret,
        receiverEncryptionKey: peerConn.encPub,
      });
      if (mode === "routed") {
        if (!mediatorInfo) throw new WireError("unreachable", "not authenticated");
        openSession();
        // outer: routed, connection DID → C, route [peer's connection DID],
        // sealed to C's key as last resolved (RLTP-VTI-1120, 3110, 3115, 7120)
        const outer = await packRouted(inner.bytes, [...addr.outer.route], addr.outer.sender, addr.outer.receiver, {
          senderSigningKey: conn.edSecret,
          receiverEncryptionKey: mediatorInfo.x25519Pub,
        });
        sent.push({ mode, payload: bytes.length, inner: inner.bytes.length, outer: outer.bytes.length });
        if (process.env.RLTP_WIRE_DEBUG) console.error(`[wire] deposit routed ${bytes.length}B → inner ${inner.bytes.length}B → outer ${outer.bytes.length}B`);
        openSession().sendBinary(outer.bytes);
        return;
      }
      // egress-session: the inner message alone on the egress identity's
      // send-only session; `egress` (control) on the connection DID's socket.
      // The adapter authenticates the connection DID before every deposit,
      // in this mode too (its token is the deposit's first argument); the
      // egress identity's own authentication happens here
      if (mode === "egress-session" && egressRefusal) {
        throw new WireError("direct-refused", `the mediator refuses direct delivery on the egress session (${egressRefusal})`);
      }
      const s = mode === "egress-session" ? await ensureEgressSession() : openSession();
      if (!s.isOpen) throw new WireError("unreachable", "the egress identity's socket is closed");
      sent.push({ mode, payload: bytes.length, inner: inner.bytes.length, outer: null });
      if (process.env.RLTP_WIRE_DEBUG) console.error(`[wire] deposit ${mode} ${bytes.length}B → ${inner.bytes.length}B`);
      s.sendBinary(inner.bytes);
    },

    /** The statement of RLTP-VTI-7150 (RLTP-VTI-3130's "no frame pending at the mediator"), as far as the
     *  wire can tell: the connection DID's session is open, no received
     *  frame is still on its way to the adapter, no frame the adapter did
     *  not take has been left with the mediator since the socket last
     *  opened, and no TSP frame arrived (nor did the socket open) for
     *  QUIET_MS (1 s) — live delivery pushes what the mediator holds
     *  right after the socket opens, so a quiet open socket is taken as a
     *  drained queue. */
    queueEmpty() {
      return Boolean(session?.isOpen) && dispatching === 0 && !leftBehind && Date.now() - lastFrameAt >= QUIET_MS;
    },

    /** RLTP-VTI-3120: true from the moment the mediator's refusal of
     *  direct delivery arrived on the egress session (the adapter reads it
     *  and records it in the relationship's send state). */
    directRefused() { return egressRefusal !== null; },

    /** Sizes of the frames deposited so far (payload, inner, outer bytes). */
    sentFrames() { return sent.map((f) => ({ ...f })); },

    async ackReceived(_token, queueIds) {
      const mediatorIds = queueIds.map((q) => ackMap.get(q)).filter(Boolean);
      if (mediatorIds.length === 0) return;
      // on a closed socket the ack would vanish: fail, so the intent stays
      const s = openSession();
      await s.ackTsp(mediatorIds);
      // the socket may have died while the ack was packed and sent: ws
      // drops it silently, so fail and keep the intent
      if (!s.isOpen) { openSession(); }
      for (const q of queueIds) ackMap.delete(q);
    },

    onDeliver(cb) { consumer = cb; },

    close() {
      wireClosed = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      try { session?.close(); } catch { /* teardown */ }
      try { egressSession?.close(); } catch { /* teardown */ }
    },
  };
}
