#!/usr/bin/env node
// shared-connect responder (dev only): reads a shared-connect 0.1 link, logs in
// at the inviter's relay under a fresh did:peer:2, forms the TSP relationship
// (XRFI), proposes, waits for the acceptance and the inviter's credential,
// receipts it, issues its own, waits for the receipt. The mirror of
// shared-connect-invite.mjs, for a pre-flight through the mediator and as our
// scanner side against another implementation's inviter.
//
//   RLTP_LIVE_MEDIATOR=1 node binding/shared-connect-respond.mjs "<link>" [--name Day] [--out ./sc-out-r]
//     [--channel scan|link] [--bare] [--wait-minutes 10]
//
// The relay is taken from the link's did:peer:2 (first tsp-mediator service);
// MEDIATOR_DID overrides it. Documents go inside the registry's TSP binding
// envelope unless --bare is given.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { authenticateToMediator, MediatorSession } from "@openvtc/vti-didcomm-js";
import { pack as tspPack, packInvite, unpack as tspUnpack, decodeEnvelope } from "@openvtc/vti-tsp-js";
import { sharedConnect as sc } from "../lib/dist/index.js";
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
const WAIT = Number(opt("--wait-minutes", "10"));
const ENVELOPE = "https://trusttasks.org/binding/tsp/0.1/envelope";
const netPolicy = process.env.MEDIATOR_ALLOW_INSECURE ? { allowInsecure: true, allowPrivate: true } : undefined;

mkdirSync(OUT, { recursive: true });
const te = new TextEncoder(), td = new TextDecoder();
const say = (s) => console.log(`[respond ${new Date().toISOString().slice(11, 19)}] ${s}`);
const save = (name, obj) => { writeFileSync(join(OUT, name), JSON.stringify(obj, null, 2) + "\n"); say(`wrote ${join(OUT, name)}`); };
const newId = () => b64uOf(rand(16));

const read = sc.readSharedConnectLink(link);
if (!read.ok) { console.error(`link refused: ${read.reason}`); process.exit(1); }
const inviter = read.link.from;
const relay = process.env.MEDIATOR_DID ?? inviter.relays.find((r) => r.kind === "tsp-mediator")?.address;
if (!relay) { console.error("the link names no tsp-mediator relay"); process.exit(1); }
say(`inviter ${inviter.did.slice(0, 48)}… label ${read.link.label ?? "(none)"}; relay ${relay}`);
say(`the person confirms here: connect with ${read.link.label ?? "the person showing this code"}? (yes, dev run)`);

const msgSeed = rand(32), pairSeed = rand(32);
const me = await sc.partyFromSeeds(msgSeed, pairSeed, [{ kind: "tsp-mediator", address: relay }], NAME);
const edSecret = await hkdf(msgSeed, "shared-connect/messaging/ed25519");
const xSecret = await hkdf(msgSeed, "shared-connect/messaging/x25519");
const xPublic = x25519.getPublicKey(xSecret);
if (Buffer.compare(ed25519.getPublicKey(edSecret), me.peer.ed) !== 0) throw new Error("key derivation mismatch");
const myDid = me.messaging.did;
const myChallenge = sc.challengeOf16(rand(16));

const auth = await authenticateToMediator({ mediatorDid: relay, clientDid: myDid, clientKid: myDid + "#key-2", clientX25519Private: xSecret, clientX25519Public: xPublic, netPolicy });
say(`authenticated at ${relay} as a did:peer:2 it has never seen`);

const state = { propose: null, accept: null, issueTheirs: null, issueMine: null, receiptTheirs: null, done: false };
const finish = (why) => { say(why); try { session.close(); } catch {} setTimeout(() => process.exit(state.done ? 0 : 1), 200); };
const sendBytes = async (bytes) => { const m = await tspPack(bytes, myDid, inviter.did, { senderSigningKey: edSecret, receiverEncryptionKey: inviter.x }); session.sendBinary(m.bytes); return m.bytes.length; };
const sendDocument = async (doc) => { const n = await sendBytes(te.encode(JSON.stringify(flag("--bare") ? doc : { type: ENVELOPE, document: doc }))); say(`sent ${doc.type.replace("https://trusttasks.org/spec/", "")} (${n} B)`); };

async function onTspFrame (qb2) {
  let senderVid = "unknown"; try { senderVid = decodeEnvelope(qb2).envelope.sender ?? "unknown"; } catch {}
  if (senderVid !== inviter.did) { say(`frame from ${senderVid.slice(0, 40)}…: not the inviter; dropped`); return; }
  const got = await tspUnpack(qb2, { receiverDecryptionKey: xSecret, senderSigningKey: inviter.ed });
  if (got.messageType === "control") { say(`control ${got.control?.controlType ?? "unknown"} from the inviter`); return; }
  if (got.messageType !== "direct") { say(`${got.messageType}; not handled`); return; }
  let body; try { body = JSON.parse(td.decode(got.payload)); } catch { say("payload not JSON"); return; }
  const doc = body?.type === ENVELOPE && body.document ? body.document : body;
  save(`in-${Date.now()}-${String(doc.type ?? "untyped").split("/").slice(-2).join("-").replace("#", "_")}.json`, doc);
  if (doc.type === sc.TASK_PROPOSE + "#response") {
    const r = await sc.checkAccept(doc, state.propose, inviter.did); if (r) { say(`accept refused: ${r}`); return; }
    state.accept = doc; say(`accepted by ${doc.payload.reason ?? "(no name)"}: relationshipDid ${doc.payload.relationshipDid}`);
    return;
  }
  if (doc.type === sc.TASK_ISSUE) {
    if (!state.accept) { say("issue before the acceptance; holding is not implemented, refused"); return; }
    const binding = await sc.binding(read.link.id, myChallenge);
    const r = await sc.checkIssue(doc, { issuerDid: inviter.did, myDid, threadId: state.propose.id, enactment: read.link.id, step: "issue-inviter", issuerPair: state.accept.payload.relationshipDid, myPair: me.pair.anchor, myChallenge, binding });
    if (r) { say(`issue refused: ${r}`); return; }
    state.issueTheirs = doc; say("the inviter's credential verified");
    const now = Date.now();
    await sendDocument(await sc.receipt(me, doc, now, newId()));
    const vrc = await sc.credential(me, state.accept.payload.relationshipDid, read.link.id, binding, CHANNEL, now);
    state.issueMine = await sc.issue(me, inviter.did, state.propose.id, read.link.id, "issue-responder", vrc, now, newId());
    save("issue-responder.json", state.issueMine);
    await sendDocument(state.issueMine);
    return;
  }
  if (doc.type === sc.TASK_ISSUE + "#response") {
    const ok = state.issueMine && (await sc.verifyStep(doc)) && doc.payload?.vrcDigestMultibase === state.issueMine.payload.vrcDigestMultibase;
    say(ok ? "receipt for my credential verified" : "receipt does not verify or names another digest");
    if (ok) { state.done = true; finish("enactment complete on the responder's side"); }
    return;
  }
  say(`document ${doc.type}: not a step; saved only`);
}

const session = new MediatorSession({ mediator: auth.mediator, mediatorJwt: auth.accessToken, client: { did: myDid, kid: myDid + "#key-2", privateKey: xSecret, publicKey: xPublic }, netPolicy, onTspFrame, onClose: () => say("socket closed"), onError: (e) => say(`socket error: ${e?.message ?? e}`) });
await session.connect();

// relationship forming, then the proposal
const xrfi = await packInvite(myDid, inviter.did, { senderSigningKey: edSecret, receiverEncryptionKey: inviter.x });
session.sendBinary(xrfi.bytes); say(`sent XRFI (${xrfi.bytes.length} B)`);
state.propose = await sc.propose(me, inviter.did, read.link.id, myChallenge, Date.now());
save("propose.json", state.propose);
await sendDocument(state.propose);
setTimeout(() => finish(`no completion after ${WAIT} min; giving up`), WAIT * 60_000).unref?.();
process.on("SIGINT", () => finish("interrupted"));
