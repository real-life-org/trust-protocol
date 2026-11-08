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
//   --plain-vrc       the own credential in the bare DTG form (no RLTP members, no EncounterCredential): a probe
//   --no-stated-digest  send the own issue without vrcDigestMultibase (for a counterpart that compares the stated digest as a string)
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
import { sharedConnect as sc, sharedConnectFlow as fl } from "../lib/dist/index.js";
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

// ── the inviter: messaging identity (a peer DID) and pair anchor (did:key) ──
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

say(`inviter ${METHOD === "peer4" ? "did:peer:4" : "did:peer:2"}  ${myDid}`);
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
// the flow machine holds the enactment (lib shared-connect-flow.ts); this CLI only carries frames
const flow = new fl.Inviter(party, { id: myChallenge, exp }, { newId, statedDigest: !flag("--no-stated-digest"), credentialProfile: flag("--plain-vrc") ? "dtg" : "rltp" });
const relationship = new Set();
let form = "bare";
const timers = [];
const finish = (why) => { say(why); for (const t of timers) clearTimeout(t); try { session.close(); } catch {} setTimeout(() => process.exit(flow.complete ? 0 : 1), 200); };

const sendTo = async (peer, bytes) => {
  const msg = await tspPack(bytes, myDid, peer.did, { senderSigningKey: edSecret, receiverEncryptionKey: peer.x });
  session.sendBinary(msg.bytes);
  return msg.bytes.length;
};
const sendDocument = async (peer, doc) => {
  const body = form === "envelope" ? { type: BINDING_ENVELOPE, document: doc } : doc;
  const n = await sendTo(peer, te.encode(JSON.stringify(body)));
  say(`sent ${doc.type.replace("https://trusttasks.org/spec/", "")} ${doc.ceremony?.step ?? ""} (${n} B on the wire)`);
};
const apply = async (peer, r) => {
  for (const e of r.events) {
    if (e.kind === "proposed") say(`propose from ${e.name ?? "(no name)"} (unverified): relationshipDid ${e.relationshipDid}`);
    else if (e.kind === "credential") { say("the responder's credential verified"); save("issue-responder.json", e.vrc); }
    else if (e.kind === "failed") say(`the other side ended the enactment: ${e.code} on ${e.step}${e.message ? ": " + e.message : ""}`);
    else if (e.kind === "refused") say(`${e.type.replace("https://trusttasks.org/spec/", "")} refused: ${e.reason} (the document is saved for a look)`);
    else say(`${e.kind}${"type" in e ? " " + e.type.replace("https://trusttasks.org/spec/", "") : ""}${"why" in e ? " (" + e.why + ")" : ""}`);
  }
  for (const d of r.send) { save(`out-${d.ceremony.step}-${d.type.endsWith("#response") ? "response" : "request"}.json`, d); await sendDocument(peer, d); }
  if (flow.complete) finish("enactment complete: both credentials and both receipts");
  else if (flow.failure) finish(`ended by the responder: ${flow.failure.code}`);
};

// frames are handled one after another: the session does not serialise them, and the flow
// machine assumes it (two copies of one propose arriving together would otherwise both pass)
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
  if (!sc.sameVid(got.receiver, myDid)) { say(`frame for ${got.receiver}: not for me; dropped`); return; }
  if (got.messageType === "control") {
    const kind = got.control?.controlType ?? "unknown";
    // first contact from a sender never seen only while the handle is live (the bound checkPropose applies)
    const live = Date.now() / 1000 < exp + sc.CLOCK_TOLERANCE_S;
    if (!live && !relationship.has(peer.did)) { say(`XRF${kind} from a new sender after the link expired; dropped`); return; }
    say(`control ${kind} from ${peer.did.slice(0, 40)}…`);
    if (String(kind).toLowerCase().includes("invite")) {
      relationship.add(peer.did);
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
  if (body && body.type === BINDING_ENVELOPE && body.document) { doc = body.document; form = "envelope"; }
  save(`in-${Date.now()}-${String(doc.type ?? "untyped").split("/").slice(-2).join("-").replace("#", "_")}.json`, doc);
  const r = await flow.receive(doc, peer.did, Date.now());
  await apply(peer, r);
  // the person confirms here: the app shows the (unverified) name and asks before anything is issued; dev run: accepting
  if (flow.pending) { say("dev run: accepting"); await apply(peer, await flow.accept(Date.now(), "displayed")); }
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
