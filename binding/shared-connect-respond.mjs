#!/usr/bin/env node
// shared-connect responder (dev only): reads a shared-connect 0.1 link, logs in
// at the inviter's relay under a fresh peer DID, forms the TSP relationship
// (XRFI), proposes, waits for the acceptance and the inviter's credential,
// receipts it, issues its own, waits for the receipt. The mirror of
// shared-connect-invite.mjs, for a pre-flight through the mediator and as our
// scanner side against another implementation's inviter.
//
//   RLTP_LIVE_MEDIATOR=1 node binding/shared-connect-respond.mjs "<link>" [--name Day] [--out ./sc-out-r]
//     [--channel scan|link] [--bare] [--wait-minutes 10] [--did peer2|peer4] [--no-assertion]
//
// The relay is taken from the link's did:peer:2 (first tsp-mediator service);
// MEDIATOR_DID overrides it. Documents go inside the registry's TSP binding
// envelope unless --bare is given.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { authenticateToMediator, MediatorSession } from "@openvtc/vti-didcomm-js";
import { pack as tspPack, packInvite, unpack as tspUnpack, decodeEnvelope } from "@openvtc/vti-tsp-js";
import { sharedConnect as sc, sharedConnectFlow as fl } from "../lib/dist/index.js";
import { hkdf, rand, b64uOf } from "../lib/dist/crypto.js";

const args = process.argv.slice(2);
const link = args.find((a) => a.startsWith("https://"));
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const flag = (name) => args.includes(name);
if (process.env.RLTP_LIVE_MEDIATOR !== "1") { console.log("shared-connect-respond: set RLTP_LIVE_MEDIATOR=1 to run against the live mediator"); process.exit(0); }
if (!link) { console.error("shared-connect-respond: give the link"); process.exit(2); }
const NAME = opt("--name", undefined);
const OUT = opt("--out", "./sc-out-r");
const CHANNEL = opt("--channel", "scan");
if (!["scan", "link"].includes(CHANNEL)) { console.error("--channel: scan or link (the responder's own observation)"); process.exit(2); }
const WAIT = Number(opt("--wait-minutes", "10"));
const ENVELOPE = "https://trusttasks.org/binding/tsp/0.1/envelope";
const netPolicy = process.env.MEDIATOR_ALLOW_INSECURE ? { allowInsecure: true, allowPrivate: true } : undefined;

mkdirSync(OUT, { recursive: true });
const te = new TextEncoder(), td = new TextDecoder();
const say = (s) => console.log(`[respond ${new Date().toISOString().slice(11, 19)}] ${s}`);
const save = (name, obj) => { writeFileSync(join(OUT, name), JSON.stringify(obj, null, 2) + "\n"); say(`wrote ${join(OUT, name)}`); };
const newId = () => b64uOf(rand(16));

const read = (await sc.readSharedConnectLink(link));
if (!read.ok) { console.error(`link refused: ${read.reason}`); process.exit(1); }
const inviter = read.link.from;
const relay = process.env.MEDIATOR_DID ?? inviter.relays.find((r) => r.kind === "tsp-mediator")?.address;
if (!relay) { console.error("the link names no tsp-mediator relay"); process.exit(1); }
say(`inviter ${inviter.did.slice(0, 48)}… label ${read.link.label ?? "(none)"}; relay ${relay}`);
say(`the person confirms here: connect with ${read.link.label ?? "the person showing this code"}? (yes, dev run)`);

const msgSeed = rand(32), pairSeed = rand(32);
const METHOD = opt("--did", "peer2");
if (!["peer2", "peer4"].includes(METHOD)) { console.error("--did: peer2 or peer4"); process.exit(2); }
const me = await sc.partyFromSeeds(msgSeed, pairSeed, [{ kind: "tsp-mediator", address: relay }], NAME, METHOD, { assertion: !flag("--no-assertion") });
const edSecret = await hkdf(msgSeed, "shared-connect/messaging/ed25519");
const xSecret = await hkdf(msgSeed, "shared-connect/messaging/x25519");
const xPublic = x25519.getPublicKey(xSecret);
if (Buffer.compare(ed25519.getPublicKey(edSecret), me.peer.ed) !== 0 || Buffer.compare(xPublic, me.peer.x) !== 0) throw new Error("key derivation mismatch between the library and the wire");
const myDid = me.messaging.did;
const xKid = me.peer.ref + me.peer.doc.keyAgreement[0]; // the X25519 method under the form key ids are written in (short form for did:peer:4)
const myChallenge = sc.challengeOf16(rand(16));

const auth = await authenticateToMediator({ mediatorDid: relay, clientDid: myDid, clientKid: xKid, clientX25519Private: xSecret, clientX25519Public: xPublic, netPolicy });
say(`authenticated at ${relay} as a peer DID it has never seen`);

// the flow machine holds the enactment (lib shared-connect-flow.ts); this CLI only carries frames
const flow = new fl.Responder(me, read.link, myChallenge, CHANNEL, { newId });
const finish = (why) => { say(why); try { session.close(); } catch {} setTimeout(() => process.exit(flow.complete ? 0 : 1), 200); };
const sendBytes = async (bytes) => { const m = await tspPack(bytes, myDid, inviter.did, { senderSigningKey: edSecret, receiverEncryptionKey: inviter.x }); session.sendBinary(m.bytes); return m.bytes.length; };
const sendDocument = async (doc) => { const n = await sendBytes(te.encode(JSON.stringify(flag("--bare") ? doc : { type: ENVELOPE, document: doc }))); say(`sent ${doc.type.replace("https://trusttasks.org/spec/", "")} ${doc.ceremony?.step ?? ""} (${n} B)`); };
const apply = async (r) => {
  for (const e of r.events) {
    if (e.kind === "accepted") say(`accepted by ${read.link.label ?? "(no label)"}: relationshipDid ${e.relationshipDid}`);
    else if (e.kind === "credential") { say("the inviter's credential verified"); save("issue-inviter.json", e.vrc); }
    else if (e.kind === "declined") say(`the inviter declined${e.message ? ": " + e.message : ""}`);
    else if (e.kind === "failed") say(`the other side ended the enactment: ${e.code} on ${e.step}${e.message ? ": " + e.message : ""}`);
    else if (e.kind === "refused") say(`${e.type.replace("https://trusttasks.org/spec/", "")} refused: ${e.reason}`);
    else say(`${e.kind}${"type" in e ? " " + e.type.replace("https://trusttasks.org/spec/", "") : ""}${"why" in e ? " (" + e.why + ")" : ""}`);
  }
  for (const d of r.send) { save(`out-${d.ceremony.step}-${d.type.endsWith("#response") ? "response" : "request"}.json`, d); await sendDocument(d); }
  if (flow.complete) finish("enactment complete on the responder's side");
  else if (flow.declined) finish("declined by the inviter");
  else if (flow.failure) finish(`ended by the inviter: ${flow.failure.code}`);
};

// frames are handled one after another: the session does not serialise them, and the flow
// machine assumes it
let queue = Promise.resolve();
const onTspFrame = (qb2) => (queue = queue.then(() => handleFrame(qb2), () => handleFrame(qb2)));
async function handleFrame (qb2) {
  let senderVid = "unknown"; try { senderVid = decodeEnvelope(qb2).envelope.sender ?? "unknown"; } catch {}
  if (!sc.sameVid(senderVid, inviter.did)) { say(`frame from ${senderVid.slice(0, 40)}…: not the inviter; dropped`); return; }
  let got;
  try { got = await tspUnpack(qb2, { receiverDecryptionKey: xSecret, senderSigningKey: inviter.ed }); } catch (e) { say(`frame does not open (${e?.message ?? e}); dropped`); return; }
  if (!sc.sameVid(got.receiver, myDid)) { say(`frame for ${got.receiver}: not for me; dropped`); return; }
  if (got.messageType === "control") { say(`control ${got.control?.controlType ?? "unknown"} from the inviter`); return; }
  if (got.messageType !== "direct") { say(`${got.messageType}; not handled`); return; }
  let body; try { body = JSON.parse(td.decode(got.payload)); } catch { say("payload not JSON"); return; }
  const doc = body?.type === ENVELOPE && body.document ? body.document : body;
  save(`in-${Date.now()}-${String(doc.type ?? "untyped").split("/").slice(-2).join("-").replace("#", "_")}.json`, doc);
  await apply(await flow.receive(doc, inviter.did, Date.now()));
}

const session = new MediatorSession({ mediator: auth.mediator, mediatorJwt: auth.accessToken, client: { did: myDid, kid: xKid, privateKey: xSecret, publicKey: xPublic }, netPolicy, onTspFrame, onClose: () => say("socket closed"), onError: (e) => say(`socket error: ${e?.message ?? e}`) });
await session.connect();

// relationship forming, then the proposal
const xrfi = await packInvite(myDid, inviter.did, { senderSigningKey: edSecret, receiverEncryptionKey: inviter.x });
session.sendBinary(xrfi.bytes); say(`sent XRFI (${xrfi.bytes.length} B)`);
await apply(await flow.start(Date.now()));
setTimeout(() => finish(`no completion after ${WAIT} min; giving up`), WAIT * 60_000).unref?.();
process.on("SIGINT", () => finish("interrupted"));
