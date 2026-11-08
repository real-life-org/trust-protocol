#!/usr/bin/env node
// shared-connect inviter (dev only): shows a shared-connect 0.1 link, waits
// at the VTI mediator for a responder's propose over TSP 1.0, accepts and
// issues, receipts the responder's issue, and writes every document it saw
// or made to an output directory. The first live counterpart is Keyring
// (scanner side, Brendan Miller, tf#1034 / vti#86, November 2026).
//
// Network-gated like the other probes in this directory:
//   RLTP_LIVE_MEDIATOR=1 MEDIATOR_DID=did:webvh:… node binding/shared-connect-invite.mjs
//     [--name Anton] [--minutes 10] [--out ./sc-out] [--relay-address <string>] [--did peer2|peer4]
//     [--qr] [--wait-minutes 30]
//
//   MEDIATOR_DID      the mediator (C), TSP 1.0 (>= 0.45); also the default
//                     relay address the link's did:peer:2 names (Keyring and the
//                     VTA read `TSPTransport` with a mediator DID)
//   --relay-address   what to put into the TSPTransport service instead
//   --did             the inviter's messaging identity: did:peer:2 (default) or did:peer:4 (long form in the link)
//   --no-assertion    leave out the assertionMethod segment (.V.E instead of .V.A.E, 50 characters shorter)
//   --minutes         the link's validity (default 10, the in-person cap)
//   --wait-minutes    how long to keep the socket open after the link expired
//   --qr              also print the link as a QR code (needs the `qrcode`
//                     package somewhere on NODE_PATH; otherwise the link only)
//
// What it accepts from the wire: TSP 1.0 frames addressed to the inviter's
// did:peer:2; a relationship-forming XRFI from a sender it has never seen
// (answered with XRFA) while the link is live; then application messages of
// kind `direct` whose payload is a Trust Task document, bare or inside the
// registry's TSP binding envelope `{ type: …/binding/tsp/0.1/envelope, document }`.
// It replies in the same form the counterpart used.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { authenticateToMediator, MediatorSession } from "@openvtc/vti-didcomm-js";
import { pack as tspPack, packAccept, unpack as tspUnpack, decodeEnvelope } from "@openvtc/vti-tsp-js";
import { sharedConnect as sc } from "../lib/dist/index.js";
import { hkdf, edFromSeed, rand, b64uOf } from "../lib/dist/crypto.js";

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const flag = (name) => args.includes(name);

if (process.env.RLTP_LIVE_MEDIATOR !== "1") {
  console.log("shared-connect-invite: set RLTP_LIVE_MEDIATOR=1 to run against the live mediator");
  process.exit(0);
}
const MEDIATOR_DID = process.env.MEDIATOR_DID;
if (!MEDIATOR_DID) { console.error("shared-connect-invite: set MEDIATOR_DID"); process.exit(2); }
const NAME = opt("--name", undefined);
const MINUTES = Number(opt("--minutes", "10"));
const WAIT = Number(opt("--wait-minutes", "30"));
const OUT = opt("--out", "./sc-out");
const RELAY_ADDRESS = opt("--relay-address", MEDIATOR_DID);
const METHOD = opt("--did", "peer2");
if (!["peer2", "peer4"].includes(METHOD)) { console.error("--did: peer2 or peer4"); process.exit(2); }
const BINDING_ENVELOPE = "https://trusttasks.org/binding/tsp/0.1/envelope";
const netPolicy = process.env.MEDIATOR_ALLOW_INSECURE ? { allowInsecure: true, allowPrivate: true } : undefined;

mkdirSync(OUT, { recursive: true });
const te = new TextEncoder(), td = new TextDecoder();
const say = (s) => console.log(`[invite ${new Date().toISOString().slice(11, 19)}] ${s}`);
const save = (name, obj) => { writeFileSync(join(OUT, name), typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) + "\n"); say(`wrote ${join(OUT, name)}`); };
const newId = () => b64uOf(rand(16));

// ── the inviter: messaging identity (did:peer:2) and pair anchor (did:key) ──
const msgSeed = rand(32), pairSeed = rand(32);
const relays = [{ kind: "tsp-mediator", address: RELAY_ADDRESS }];
const party = await sc.partyFromSeeds(msgSeed, pairSeed, relays, NAME, METHOD, { assertion: !flag("--no-assertion") });
// raw secrets for the TSP wire, from the same derivation as partyFromSeeds
const edSecret = await hkdf(msgSeed, "shared-connect/messaging/ed25519");
const xSecret = await hkdf(msgSeed, "shared-connect/messaging/x25519");
const xPublic = x25519.getPublicKey(xSecret);
if (Buffer.compare(ed25519.getPublicKey(edSecret), party.peer.ed) !== 0 || Buffer.compare(xPublic, party.peer.x) !== 0) {
  throw new Error("key derivation mismatch between the library and the wire");
}
const myDid = party.messaging.did;
const xKid = party.peer.ref + party.peer.doc.keyAgreement[0]; // the X25519 method under the form key ids are written in (short form for did:peer:4)
const myChallenge = sc.challengeOf16(rand(16));
const exp = Math.floor(Date.now() / 1000) + MINUTES * 60;
const link = (await sc.sharedConnectLink({ from: myDid, id: myChallenge, exp, ...(NAME ? { label: NAME } : {}) }));

say(`inviter did:peer:2  ${myDid}`);
say(`relationshipDid     ${party.pair.anchor}`);
say(`challenge (_id)     ${myChallenge}`);
say(`link (${link.length} chars, valid ${MINUTES} min)`);
console.log(link);
save("inviter.json", { did: myDid, document: party.peer.doc, relationshipDid: party.pair.anchor, challenge: myChallenge, exp, link }); // note: the handle (_id) is on disk for the dev run
if (flag("--qr")) {
  try {
    const { createRequire } = await import("node:module");
    const QR = createRequire(import.meta.url)("qrcode");
    console.log(await QR.toString(link, { type: "terminal", small: true, errorCorrectionLevel: "M" }));
  } catch (e) { say(`no QR rendering (${e?.message ?? e}); use the link`); }
}

// ── the mediator session under the did:peer:2 ──────────────────────────
const auth = await authenticateToMediator({
  mediatorDid: MEDIATOR_DID, clientDid: myDid, clientKid: xKid,
  clientX25519Private: xSecret, clientX25519Public: xPublic, netPolicy,
});
say(`authenticated at ${MEDIATOR_DID} (ws ${auth.mediator.wsEndpoint})`);

const knownVids = new Set();
const state = { receiptMine: null, propose: null, accept: null, binding: null, issueMine: null, issueTheirs: null, receiptTheirs: null, done: false, relationship: new Set(), form: "bare" };
// the link's _exp bounds the handle (checkPropose refuses after it); the CLI keeps one enactment
const me = { did: myDid, id: myChallenge, exp };
const timers = [];
const finish = (why) => { say(why); for (const t of timers) clearTimeout(t); try { session.close(); } catch {} setTimeout(() => process.exit(state.done ? 0 : 1), 200); };

const sendTo = async (peer, bytes) => {
  const msg = await tspPack(bytes, myDid, peer.did, { senderSigningKey: edSecret, receiverEncryptionKey: peer.x });
  session.sendBinary(msg.bytes);
  return msg.bytes.length;
};
const sendDocument = async (peer, doc) => {
  const body = state.form === "envelope" ? { type: BINDING_ENVELOPE, document: doc } : doc;
  const n = await sendTo(peer, te.encode(JSON.stringify(body)));
  say(`sent ${doc.type.replace("https://trusttasks.org/spec/", "")} (${n} B on the wire)`);
};

// frames are handled one after another: the session does not serialise them, and the state
// machine below assumes it (two copies of one propose arriving together would otherwise both pass)
let queue = Promise.resolve();
const onTspFrame = (qb2) => (queue = queue.then(() => handleFrame(qb2), () => handleFrame(qb2)));
async function handleFrame (qb2) {
  let senderVid = "unknown";
  try { senderVid = decodeEnvelope(qb2).envelope.sender ?? "unknown"; } catch {}
  // the sender's long form is known from its first frame or propose; a short form resolves against it
  const peer = await sc.parsePeer(senderVid, knownVids);
  if (peer && senderVid !== sc.peer4Short(senderVid)) knownVids.add(senderVid);
  if (!peer) { say(`frame from ${senderVid}: not a peer DID this ceremony reads; dropped`); return; }
  let got;
  try { got = await tspUnpack(qb2, { receiverDecryptionKey: xSecret, senderSigningKey: peer.ed }); } catch (e) { say(`frame from ${senderVid.slice(0, 40)}… does not open (${e?.message ?? e}); dropped`); return; }
  if (got.receiver !== myDid) { say(`frame for ${got.receiver}: not for me; dropped`); return; }
  if (got.messageType === "control") {
    const kind = got.control?.controlType ?? "unknown";
    const live = Date.now() / 1000 < exp + sc.CLOCK_TOLERANCE_S; // the same bound checkPropose applies
    if (!live && !state.relationship.has(peer.did)) { say(`XRF${kind} from a new sender after the link expired; dropped`); return; }
    say(`control ${kind} from ${peer.did.slice(0, 40)}…`);
    if (String(kind).toLowerCase().includes("invite")) {
      state.relationship.add(peer.did);
      try {
        const acc = await packAccept(got.threadDigest, myDid, peer.did, { senderSigningKey: edSecret, receiverEncryptionKey: peer.x });
        session.sendBinary(acc.bytes);
        say("answered the invite with XRFA");
      } catch (e) { say(`could not answer the invite: ${e?.message ?? e}`); }
    }
    return;
  }
  if (got.messageType !== "direct") { say(`${got.messageType} message; not handled`); return; }
  let body;
  try { body = JSON.parse(td.decode(got.payload)); } catch { say("direct payload is not JSON; dropped"); return; }
  let doc = body;
  if (body && body.type === BINDING_ENVELOPE && body.document) { doc = body.document; state.form = "envelope"; }
  save(`in-${Date.now()}-${String(doc.type ?? "untyped").split("/").slice(-2).join("-").replace("#", "_")}.json`, doc);

  if (doc.type === sc.TASK_PROPOSE) {
    if (!sc.sameVid(doc.issuer, peer.did)) { say("propose issuer differs from the TSP sender; refused"); return; }
    if (state.propose) {
      // the same propose again (a redelivery): the answer goes out again; another one is ignored, the handle is single-use
      if (doc.id === state.propose.id && JSON.stringify(doc) === JSON.stringify(state.propose)) { say("the propose again; resending accept and issue"); await sendDocument(peer, state.accept); await sendDocument(peer, state.issueMine); }
      else say("a second propose; ignored (the handle is single-use)");
      return;
    }
    const refusal = await sc.checkPropose(doc, me, Date.now());
    if (refusal) { say(`propose refused: ${refusal}`); return; }
    // the person confirms here: the app shows the (unverified) name and asks before anything is issued
    say(`propose from ${doc.payload.reason ?? "(no name)"} (unverified): relationshipDid ${doc.payload.relationshipDid}; dev run, accepting`);
    const now = Date.now();
    const accept = await sc.accept(party, doc, now, newId());
    const binding = await sc.binding(myChallenge, doc.id);
    const vrc = await sc.credential(party, doc.payload.relationshipDid, doc.id, binding, "displayed", now);
    const issueMine = await sc.issue(party, doc.issuer, doc.id, myChallenge, "issue-inviter", vrc, now, newId());
    // state is set only once both documents exist; a throw above leaves the frame unacked for a retry
    Object.assign(state, { propose: doc, accept, binding, issueMine });
    save("accept.json", accept); save("issue-inviter.json", issueMine);
    await sendDocument(peer, accept);
    await sendDocument(peer, issueMine);
    return;
  }
  if (doc.type === sc.TASK_ISSUE) {
    if (!state.propose) { say("issue before any propose; refused"); return; }
    if (!sc.sameVid(doc.issuer, peer.did)) { say("issue issuer differs from the TSP sender; refused"); return; }
    if (state.issueTheirs) { if (doc.id === state.issueTheirs.id) { say("the responder's issue again; receipt resent"); await sendDocument(peer, state.receiptMine); } return; }
    const refusal = await sc.checkIssue(doc, {
      issuerDid: state.propose.issuer, myDid, threadId: state.propose.id, enactment: myChallenge, step: "issue-responder",
      issuerPair: state.propose.payload.relationshipDid, myPair: party.pair.anchor, myChallenge, binding: state.binding,
    });
    if (refusal) { say(`issue refused: ${refusal} (the document is saved for a look)`); return; }
    state.issueTheirs = doc;
    const rcp = await sc.receipt(party, doc, Date.now(), newId());
    state.receiptMine = rcp;
    save("receipt-of-issue-responder.json", rcp);
    await sendDocument(peer, rcp);
    say("the responder's credential verified and receipted");
    if (state.receiptTheirs) { state.done = true; finish("enactment complete: both credentials and both receipts"); }
    return;
  }
  if (doc.type === sc.TASK_ISSUE + "#response") {
    if (!state.issueMine) { say("a receipt before any issue; ignored"); return; }
    if (!sc.sameVid(doc.issuer, peer.did)) { say("receipt issuer differs from the TSP sender; refused"); return; }
    const refusal = await sc.checkReceipt(doc, state.issueMine, { issuerDid: state.propose.issuer, myDid });
    say(refusal ? `receipt for my issue refused: ${refusal}` : "receipt for my issue verified (digest matches the credential I sent)");
    if (!refusal) state.receiptTheirs = doc;
    if (!refusal && state.issueTheirs) { state.done = true; finish("enactment complete: both credentials and both receipts"); }
    return;
  }
  say(`document of type ${doc.type}: not a step of this ceremony; saved only`);
}

const session = new MediatorSession({
  mediator: auth.mediator, mediatorJwt: auth.accessToken,
  client: { did: myDid, kid: xKid, privateKey: xSecret, publicKey: xPublic },
  netPolicy, onTspFrame,
  onClose: () => say("socket closed by the mediator"),
  onError: (e) => say(`socket error: ${e?.message ?? e}`),
});
await session.connect();
say("listening; scan the link now");
timers.push(setTimeout(() => finish(`link expired ${WAIT} min ago; giving up`), (MINUTES + WAIT) * 60_000));
process.on("SIGINT", () => finish("interrupted"));
