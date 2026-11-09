#!/usr/bin/env node
// shared-connect loopback: both sides in one process, every document packed
// and unpacked as a TSP 1.0 direct frame between the two did:peer:2 identities,
// inside the registry's TSP binding envelope, exactly as the inviter CLI does
// it over the mediator. No network. Exit 0 when the enactment completes and
// every check passes.
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { pack as tspPack, packInvite, packAccept, unpack as tspUnpack, decodeEnvelope } from "@openvtc/vti-tsp-js";
import { sharedConnect as sc } from "../lib/dist/index.js";
import { hkdf, rand, b64uOf } from "../lib/dist/crypto.js";

const te = new TextEncoder(), td = new TextDecoder();
const ENVELOPE = "https://trusttasks.org/binding/tsp/0.1/envelope";
const ok = (cond, what) => { if (!cond) { console.error("FAIL " + what); process.exit(1); } console.log("ok   " + what); };

async function side (name, relays, method) {
  const msgSeed = rand(32), pairSeed = rand(32);
  const party = await sc.partyFromSeeds(msgSeed, pairSeed, relays, name, method);
  const edSecret = await hkdf(msgSeed, "shared-connect/messaging/ed25519");
  const xSecret = await hkdf(msgSeed, "shared-connect/messaging/x25519");
  ok(Buffer.compare(ed25519.getPublicKey(edSecret), party.peer.ed) === 0 && Buffer.compare(x25519.getPublicKey(xSecret), party.peer.x) === 0, `${name}: wire keys equal the library's`);
  return { party, edSecret, xSecret, did: party.messaging.did };
}
// one hop of the wire: pack at `from`, decode the envelope at `to`, resolve the sender, unpack
async function hop (from, to, body) {
  const packed = await tspPack(te.encode(JSON.stringify({ type: ENVELOPE, document: body })), from.did, to.did, { senderSigningKey: from.edSecret, receiverEncryptionKey: (await sc.parsePeer(to.did)).x });
  const senderVid = decodeEnvelope(packed.bytes).envelope.sender;
  const peer = await sc.parsePeer(senderVid);
  ok(peer && senderVid === from.did, `envelope names the sender ${senderVid.slice(0, 32)}…`);
  const got = await tspUnpack(packed.bytes, { receiverDecryptionKey: to.xSecret, senderSigningKey: peer.ed });
  ok(got.messageType === "direct" && got.receiver === to.did, `direct frame for ${to.party.name} (${packed.bytes.length} B)`);
  const env = JSON.parse(td.decode(got.payload));
  ok(env.type === ENVELOPE && env.document?.type, "binding envelope around a Trust Task document");
  return env.document;
}

const MED = "did:webvh:QmUTUkdHgppiciLpqcxkTi6Pbc9VuZzWXvH4L2Dk2dY2WL:mediator.web-of-trust.de";
async function run (method) {
console.log(`\n── ${method} ──`);
const inviter = await side("Anton", [{ kind: "tsp-mediator", address: MED }], method);
const responder = await side("Keyring", [{ kind: "tsp-mediator", address: MED }], method);

// the link
const id = sc.challengeOf16(rand(16));
const exp = Math.floor(Date.now() / 1000) + 600;
const link = (await sc.sharedConnectLink({ from: inviter.did, id, exp, label: "Anton" }));
const me = { did: inviter.did, id, exp };
const read = (await sc.readSharedConnectLink(link));
ok(read.ok && read.link.from.relays[0].address === MED, `link reads (${link.length} chars), relay ${MED.slice(0, 24)}…`);

// relationship forming: XRFI from the responder, XRFA back
const xrfi = await packInvite(responder.did, inviter.did, { senderSigningKey: responder.edSecret, receiverEncryptionKey: (await sc.parsePeer(inviter.did)).x });
const gotInvite = await tspUnpack(xrfi.bytes, { receiverDecryptionKey: inviter.xSecret, senderSigningKey: (await sc.parsePeer(responder.did)).ed });
ok(gotInvite.messageType === "control" && gotInvite.control, `XRFI opened as control/${gotInvite.control?.controlType}`);
const xrfa = await packAccept(gotInvite.threadDigest, inviter.did, responder.did, { senderSigningKey: inviter.edSecret, receiverEncryptionKey: (await sc.parsePeer(responder.did)).x });
const gotAccept = await tspUnpack(xrfa.bytes, { receiverDecryptionKey: responder.xSecret, senderSigningKey: (await sc.parsePeer(inviter.did)).ed });
ok(gotAccept.messageType === "control", `XRFA opened as control/${gotAccept.control?.controlType}`);

// propose → inviter
const now = Date.now();
const respId = sc.challengeOf16(rand(16));
const propose = await sc.propose(responder.party, read.link.from.did, read.link.id, respId, now);
const propAt = await hop(responder, inviter, propose);
ok((await sc.checkPropose(propAt, me, now + 1000)) === null, "checkPropose passes at the inviter");

// accept + issue → responder
const accept = await sc.accept(inviter.party, propAt, now + 2000, b64uOf(rand(16)));
const vrcInv = await sc.credential(inviter.party, propAt.payload.relationshipDid, propAt, "displayed", now + 2000);
const issueInv = await sc.issue(inviter.party, propAt.issuer, propAt.id, id, "issue-inviter", vrcInv, now + 2000, b64uOf(rand(16)));
const accAt = await hop(inviter, responder, accept);
const issInvAt = await hop(inviter, responder, issueInv);
ok((await sc.checkAccept(accAt, propose, inviter.did, now + 3000)) === null, "checkAccept passes at the responder");
ok((await sc.checkIssue(issInvAt, { issuerDid: inviter.did, myDid: responder.did, threadId: respId, enactment: id, step: "issue-inviter", issuerPair: accAt.payload.relationshipDid, myPair: responder.party.pair.anchor, propose: propose })) === null, "checkIssue passes for the inviter's credential");

// receipt + issue → inviter
const rcpInv = await sc.receipt(responder.party, issInvAt, now + 3000, b64uOf(rand(16)));
const vrcResp = await sc.credential(responder.party, accAt.payload.relationshipDid, propose, "scan", now + 3000);
const issueResp = await sc.issue(responder.party, inviter.did, respId, id, "issue-responder", vrcResp, now + 3000, b64uOf(rand(16)));
const rcpAt = await hop(responder, inviter, rcpInv);
const issRespAt = await hop(responder, inviter, issueResp);
ok((await sc.checkReceipt(rcpAt, issueInv, { issuerDid: responder.did, myDid: inviter.did })) === null, "the responder's receipt names the credential the inviter sent");
ok((await sc.checkIssue(issRespAt, { issuerDid: responder.did, myDid: inviter.did, threadId: respId, enactment: id, step: "issue-responder", issuerPair: propAt.payload.relationshipDid, myPair: inviter.party.pair.anchor, propose: propAt })) === null, "checkIssue passes for the responder's credential");
const rcpResp = await sc.receipt(inviter.party, issRespAt, now + 4000, b64uOf(rand(16)));
const rcpRespAt = await hop(inviter, responder, rcpResp);
ok((await sc.checkReceipt(rcpRespAt, issueResp, { issuerDid: inviter.did, myDid: responder.did })) === null, "the inviter's receipt names the credential the responder sent");

// the offline path, for the same propose
const back = sc.backCodeOf(propose);
ok(JSON.stringify((await sc.proposeFromBackCode(back, me))) === JSON.stringify(propose), `back-code (${back.length} chars) rebuilds the propose`);
console.log(`\n${method}: enactment complete, every check passed`);
}
await run("peer2");
await run("peer4");
console.log("\nshared-connect loopback: enactment complete, every check passed");
