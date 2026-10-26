// .sender-hypothesis.mjs — seam measurement: which TSP envelope sender
// does the mediator relay? TSP 1.0 direct frames (vti-tsp-js 0.4.0) over
// the ATM-authenticated WS socket. MEDIATOR_DID names the instance (required).
import { WebSocket } from "ws";
import { authenticateToMediator, MediatorSession, multibase, didKey } from "@openvtc/vti-didcomm-js";
import { pack, unpack } from "@openvtc/vti-tsp-js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
// a TSP 1.0 mediator (>= 0.45), required; cases 2 and 3 are direct deliveries
// and need local direct delivery allowed (profile RLTP-VTI-3120)
const MEDIATOR_DID = process.env.MEDIATOR_DID;
if (!MEDIATOR_DID) {
  console.error(".sender-hypothesis: set MEDIATOR_DID to a TSP 1.0 mediator (>= 0.45)");
  process.exit(2);
}
const netPolicy = process.env.MEDIATOR_ALLOW_INSECURE ? { allowInsecure: true, allowPrivate: true } : undefined;
const mint = () => {
  const edSecret = ed25519.utils.randomSecretKey ? ed25519.utils.randomSecretKey() : ed25519.utils.randomPrivateKey();
  const edPublic = ed25519.getPublicKey(edSecret);
  const xSecret = ed25519.utils.toMontgomerySecret(edSecret);
  const xPublic = x25519.getPublicKey(xSecret);
  const did = `did:key:${multibase.encodeMultikey(multibase.MULTICODEC.ED25519_PUB, edPublic)}`;
  const doc = didKey.resolve(did).didDocument;
  const kid = doc.keyAgreement?.[0]?.id ?? doc.keyAgreement?.[0];
  return { did, kid, edSecret, xSecret, xPublic };
};
const keysOf = (did) => {
  const doc = didKey.resolve(did).didDocument;
  const agreementId = doc.keyAgreement?.[0]?.id ?? doc.keyAgreement?.[0];
  const ms = doc.verificationMethod ?? [];
  const ag = ms.find((v) => v.id === agreementId); const sg = ms.find((v) => v.id !== agreementId);
  return { signPub: multibase.decodeMultikey(sg.publicKeyMultibase).key, encPub: multibase.decodeMultikey(ag.publicKeyMultibase).key };
};
async function attach(id) {
  const auth = await authenticateToMediator({ mediatorDid: MEDIATOR_DID, clientDid: id.did, clientX25519Private: id.xSecret, clientX25519Public: id.xPublic, netPolicy });
  const inbox = [];
  const s = new MediatorSession({ mediator: auth.mediator, mediatorJwt: auth.accessToken,
    client: { did: id.did, kid: id.kid, privateKey: id.xSecret, publicKey: id.xPublic },
    WebSocketImpl: WebSocket, netPolicy, onTspFrame: (b) => inbox.push(b), onError: () => {} });
  await s.connect();
  return { s, inbox };
}
const A = mint(), B = mint(), E = mint();   // E = separate egress identity, NOT authenticated
const a = await attach(A), b = await attach(B);
const wait = async (arr, ms) => { const t0 = Date.now(); while (arr.length === 0 && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 200)); return arr.length > 0; };

// case 1: sender = socket DID (ref-04 style)
const p1 = await pack(new TextEncoder().encode("case1"), A.did, B.did, { senderSigningKey: A.edSecret, receiverEncryptionKey: keysOf(B.did).encPub });
a.s.sendBinary(p1.bytes);
console.log("case1 sender=socketDID delivered:", await wait(b.inbox, 10000));

// case 2: sender = foreign egress DID on A's socket
b.inbox.length = 0;
const p2 = await pack(new TextEncoder().encode("case2"), E.did, B.did, { senderSigningKey: E.edSecret, receiverEncryptionKey: keysOf(B.did).encPub });
a.s.sendBinary(p2.bytes);
console.log("case2 sender=egressDID  delivered:", await wait(b.inbox, 10000));

// case 3: sender = egress DID on its OWN authenticated socket
b.inbox.length = 0;
const e = await attach(E);
const p3 = await pack(new TextEncoder().encode("case3"), E.did, B.did, { senderSigningKey: E.edSecret, receiverEncryptionKey: keysOf(B.did).encPub });
e.s.sendBinary(p3.bytes);
console.log("case3 sender=egressDID on egress socket delivered:", await wait(b.inbox, 10000));
a.s.close(); b.s.close(); e.s.close();
process.exit(0);
