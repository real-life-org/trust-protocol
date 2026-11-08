// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// shared-connect 0.1: the flow of one enactment, for either role, as a step
// machine without a transport (design/interop/shared-connect-app-modell, B1).
//
// The machine takes the documents a carrier delivered (already opened, their
// TSP sender checked against the issuer by the caller) and answers with the
// documents to send and the events the person's app shows. It holds documents
// that arrive out of order, answers a redelivery with the same documents, keeps
// the handle single-use, and refuses what the checks of shared-connect.ts
// refuse. The inviter waits for the person between the propose and the
// acceptance (`accept()` / `decline()`); the responder confirmed when it read
// the link, so it proposes on `start()` and issues as soon as the acceptance
// is in. Ids come from the caller (`newId`), never from here.
//
// `snapshot()` is the whole state as plain JSON, `restore` continues from it:
// a process that died between two documents resumes with the same identities
// (the app derives them again from the root and the encounter nonce) and the
// same documents, and answers a redelivery as if it had never been away.
import * as sc from './shared-connect.js';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const result = (send = [], events = [], done = false) => ({ send, events, done });
/** The inviter: showed the link `{id, exp}`; its messaging identity is the link's `_from`. */
export class Inviter {
    party;
    o;
    s;
    constructor(party, link, o, restore) {
        this.party = party;
        this.o = o;
        this.s = restore ?? { role: 'inviter', id: link.id, exp: link.exp, propose: null, accept: null, binding: null, issueMine: null, issueTheirs: null, receiptMine: null, receiptTheirs: null, declined: false, held: [] };
    }
    snapshot() { return JSON.parse(JSON.stringify(this.s)); }
    get done() { return !!(this.s.issueTheirs && this.s.receiptTheirs); }
    /** the propose the person has to answer, or null */
    get pending() {
        if (!this.s.propose || this.s.accept || this.s.declined)
            return null;
        return { propose: this.s.propose, name: this.s.propose.payload.reason ?? null, relationshipDid: this.s.propose.payload.relationshipDid };
    }
    /** the relationship identifier of the other side, once proposed */
    get theirPair() { return this.s.propose?.payload.relationshipDid ?? null; }
    get theirDid() { return this.s.propose?.issuer ?? null; }
    /** a document the carrier delivered; `peerDid` is the TSP sender the caller verified */
    async receive(doc, peerDid, nowMs) {
        const s = this.s;
        const type = typeof doc?.type === 'string' ? doc.type : 'untyped';
        if (type === sc.TASK_PROPOSE) {
            if (s.propose) {
                if (doc.id === s.propose.id && same(doc, s.propose)) {
                    // a redelivery: the answer goes out again, if the person has given one
                    if (s.accept)
                        return result([s.accept, s.issueMine], [{ kind: 'ignored', type, why: 'duplicate' }]);
                    return result([], [{ kind: 'ignored', type, why: 'duplicate' }]);
                }
                return result([], [{ kind: 'refused', type, reason: 'second-propose' }]);
            }
            if (!sc.sameVid(doc.issuer, peerDid))
                return result([], [{ kind: 'refused', type, reason: 'issuer' }]);
            const r = await sc.checkPropose(doc, { did: this.party.messaging.did, id: s.id, exp: s.exp }, nowMs);
            if (r)
                return result([], [{ kind: 'refused', type, reason: r }]);
            s.propose = doc;
            return result([], [{ kind: 'proposed', name: doc.payload.reason ?? null, relationshipDid: doc.payload.relationshipDid, proposeId: doc.id }]);
        }
        if (type === sc.TASK_ISSUE) {
            if (!s.propose)
                return result([], [{ kind: 'refused', type, reason: 'before-propose' }]);
            if (!sc.sameVid(doc.issuer, peerDid) || !sc.sameVid(doc.issuer, s.propose.issuer))
                return result([], [{ kind: 'refused', type, reason: 'issuer' }]);
            if (s.issueTheirs) {
                if (doc.id === s.issueTheirs.id)
                    return result([s.receiptMine], [{ kind: 'ignored', type, why: 'duplicate' }]);
                return result([], [{ kind: 'ignored', type, why: 'duplicate' }]);
            }
            if (!s.accept) {
                // the responder may issue before our acceptance reached it: held until the person decided
                if (s.declined)
                    return result([], [{ kind: 'ignored', type, why: 'after-decision' }]);
                s.held.push(doc);
                return result([], [{ kind: 'held', type }]);
            }
            const r = await sc.checkIssue(doc, {
                issuerDid: s.propose.issuer, myDid: this.party.messaging.did, threadId: s.propose.id, enactment: s.id, step: 'issue-responder',
                issuerPair: s.propose.payload.relationshipDid, myPair: this.party.pair.anchor, myChallenge: s.id, binding: s.binding,
            }, nowMs);
            if (r)
                return result([], [{ kind: 'refused', type, reason: r }]);
            s.issueTheirs = doc;
            s.receiptMine = await sc.receipt(this.party, doc, nowMs, this.o.newId());
            const events = [{ kind: 'credential', vrc: doc.payload.vrc, step: 'issue-responder' }];
            if (this.done)
                events.push({ kind: 'complete' });
            return result([s.receiptMine], events, this.done);
        }
        if (type === sc.TASK_ISSUE + '#response') {
            if (!s.issueMine)
                return result([], [{ kind: 'refused', type, reason: 'before-propose' }]);
            if (!sc.sameVid(doc.issuer, peerDid))
                return result([], [{ kind: 'refused', type, reason: 'issuer' }]);
            if (s.receiptTheirs)
                return result([], [{ kind: 'ignored', type, why: 'duplicate' }]);
            const r = await sc.checkReceipt(doc, s.issueMine, { issuerDid: s.propose.issuer, myDid: this.party.messaging.did }, nowMs);
            if (r)
                return result([], [{ kind: 'refused', type, reason: r }]);
            s.receiptTheirs = doc;
            const events = [{ kind: 'receipted', step: 'issue-inviter' }];
            if (this.done)
                events.push({ kind: 'complete' });
            return result([], events, this.done);
        }
        return result([], [{ kind: 'ignored', type, why: 'not-a-step' }]);
    }
    /** the person accepts: the acceptance and our credential go out, held documents are taken */
    async accept(nowMs, channel = 'displayed') {
        const s = this.s;
        if (!s.propose || s.accept || s.declined)
            throw new Error('nothing to accept');
        const p = s.propose;
        const accept = await sc.accept(this.party, p, nowMs, this.o.newId());
        const binding = await sc.binding(s.id, p.id);
        const vrc = await sc.credential(this.party, p.payload.relationshipDid, p.id, binding, channel, nowMs);
        const issueMine = await sc.issue(this.party, p.issuer, p.id, s.id, 'issue-inviter', vrc, nowMs, this.o.newId());
        Object.assign(s, { accept, binding, issueMine });
        const out = result([accept, issueMine], [{ kind: 'accepted', relationshipDid: p.payload.relationshipDid }]);
        for (const h of s.held.splice(0)) {
            const r = await this.receive(h, p.issuer, nowMs);
            out.send.push(...r.send);
            out.events.push(...r.events);
        }
        out.done = this.done;
        return out;
    }
    /** the person declines: a response with accept false; nothing else is sent, the handle stays spent */
    async decline(nowMs) {
        const s = this.s;
        if (!s.propose || s.accept || s.declined)
            throw new Error('nothing to decline');
        s.declined = true;
        s.held = [];
        const doc = await sc.accept(this.party, s.propose, nowMs, this.o.newId(), false);
        return result([doc], [{ kind: 'declined' }], true);
    }
}
/** The responder: read the link, the person confirmed; `challenge` is its fresh 16-byte value. */
export class Responder {
    party;
    o;
    s;
    constructor(party, link, challenge, channel, o, restore) {
        this.party = party;
        this.o = o;
        const l = 'from' in link && typeof link.from === 'object' ? { from: link.from.did, id: link.id, exp: link.exp, label: link.label ?? null } : link;
        this.s = restore ?? { role: 'responder', link: l, challenge, channel, propose: null, accept: null, binding: null, issueMine: null, issueTheirs: null, receiptMine: null, receiptTheirs: null, declined: false, held: [] };
    }
    snapshot() { return JSON.parse(JSON.stringify(this.s)); }
    get done() { return !!(this.s.issueTheirs && this.s.receiptTheirs); }
    get declined() { return this.s.declined; }
    get theirPair() { return this.s.accept?.payload.relationshipDid ?? null; }
    get theirDid() { return this.s.link.from; }
    /** the proposal (once; a restart sends the same one again) */
    async start(nowMs) {
        const s = this.s;
        if (!s.propose)
            s.propose = await sc.propose(this.party, s.link.from, s.link.id, s.challenge, nowMs);
        return result([s.propose], []);
    }
    async receive(doc, peerDid, nowMs) {
        const s = this.s;
        const type = typeof doc?.type === 'string' ? doc.type : 'untyped';
        if (!sc.sameVid(peerDid, s.link.from))
            return result([], [{ kind: 'refused', type, reason: 'issuer' }]);
        if (type === sc.TASK_PROPOSE + '#response') {
            if (!s.propose)
                return result([], [{ kind: 'refused', type, reason: 'before-propose' }]);
            if (s.accept || s.declined)
                return result([], [{ kind: 'ignored', type, why: 'duplicate' }]);
            if (doc?.payload?.accept === false && doc.threadId === s.propose.id && sc.sameVid(doc.issuer, s.link.from)) {
                if (!(await sc.verifyStep(doc, [s.link.from])))
                    return result([], [{ kind: 'refused', type, reason: 'proof' }]);
                s.declined = true;
                s.held = [];
                return result([], [{ kind: 'declined' }], true);
            }
            const r = await sc.checkAccept(doc, s.propose, s.link.from, nowMs);
            if (r)
                return result([], [{ kind: 'refused', type, reason: r }]);
            s.accept = doc;
            s.binding = await sc.binding(s.link.id, s.challenge);
            const vrc = await sc.credential(this.party, doc.payload.relationshipDid, s.link.id, s.binding, s.channel, nowMs);
            s.issueMine = await sc.issue(this.party, s.link.from, s.propose.id, s.link.id, 'issue-responder', vrc, nowMs, this.o.newId());
            const out = result([s.issueMine], [{ kind: 'accepted', relationshipDid: doc.payload.relationshipDid }]);
            for (const h of s.held.splice(0)) {
                const r2 = await this.receive(h, peerDid, nowMs);
                out.send.push(...r2.send);
                out.events.push(...r2.events);
            }
            out.done = this.done;
            return out;
        }
        if (type === sc.TASK_ISSUE) {
            if (!s.accept) {
                if (s.declined)
                    return result([], [{ kind: 'ignored', type, why: 'after-decision' }]);
                s.held.push(doc);
                return result([], [{ kind: 'held', type }]);
            }
            if (s.issueTheirs) {
                if (doc.id === s.issueTheirs.id)
                    return result([s.receiptMine], [{ kind: 'ignored', type, why: 'duplicate' }]);
                return result([], [{ kind: 'ignored', type, why: 'duplicate' }]);
            }
            const r = await sc.checkIssue(doc, {
                issuerDid: s.link.from, myDid: this.party.messaging.did, threadId: s.propose.id, enactment: s.link.id, step: 'issue-inviter',
                issuerPair: s.accept.payload.relationshipDid, myPair: this.party.pair.anchor, myChallenge: s.challenge, binding: s.binding,
            }, nowMs);
            if (r)
                return result([], [{ kind: 'refused', type, reason: r }]);
            s.issueTheirs = doc;
            s.receiptMine = await sc.receipt(this.party, doc, nowMs, this.o.newId());
            const events = [{ kind: 'credential', vrc: doc.payload.vrc, step: 'issue-inviter' }];
            if (this.done)
                events.push({ kind: 'complete' });
            return result([s.receiptMine], events, this.done);
        }
        if (type === sc.TASK_ISSUE + '#response') {
            if (!s.issueMine) {
                if (s.declined)
                    return result([], [{ kind: 'ignored', type, why: 'after-decision' }]);
                s.held.push(doc);
                return result([], [{ kind: 'held', type }]);
            }
            if (s.receiptTheirs)
                return result([], [{ kind: 'ignored', type, why: 'duplicate' }]);
            const r = await sc.checkReceipt(doc, s.issueMine, { issuerDid: s.link.from, myDid: this.party.messaging.did }, nowMs);
            if (r)
                return result([], [{ kind: 'refused', type, reason: r }]);
            s.receiptTheirs = doc;
            const events = [{ kind: 'receipted', step: 'issue-responder' }];
            if (this.done)
                events.push({ kind: 'complete' });
            return result([], events, this.done);
        }
        return result([], [{ kind: 'ignored', type, why: 'not-a-step' }]);
    }
}
