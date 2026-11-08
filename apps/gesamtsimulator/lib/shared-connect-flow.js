// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// shared-connect 0.1: the flow of one enactment, for either role, as a step
// machine without a transport (design/interop/shared-connect-app-modell, B1).
//
// The machine takes the documents a carrier delivered (already opened; the
// caller passes the TSP sender it verified, and every branch checks the
// document's issuer against it before anything else) and answers with the
// documents to send and the events the person's app shows. It holds
// documents that arrive out of order, answers a redelivery with the same
// documents it sent the first time, keeps the handle single-use, and refuses
// what the checks of shared-connect.ts refuse. The inviter waits for the
// person between the propose and the acceptance (`accept()` / `decline()`);
// the responder confirmed when it read the link, so it proposes on `start()`
// and issues as soon as the acceptance is in. A decline is the registry's
// trust-task-error with `vrc/relationships/propose:declined` (propose 0.1 §4).
// Ids come from the caller (`newId`), never from here.
//
// Persistence: `snapshot()` is the whole state as plain JSON for the holder's
// store (it carries the other side's documents, name included: holder state,
// never a log). The caller persists the snapshot BEFORE it sends what a call
// returned, and `outbox()` names the own documents to send again after a
// restart; so a crash between state and wire resends, never re-decides. Every
// call changes state only after everything it builds exists (a throw leaves
// the state as it was). Calls on one machine are serialised internally;
// `snapshot()` is not, so take it between calls, as the persistence rule says.
import * as sc from './shared-connect.js';
/** held documents: one per id, at most this many (a peer the handle admitted, before the decision) */
const HELD_MAX = 8;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const result = (send = [], events = [], finished = false) => ({ send, events, finished });
const empty = () => ({ propose: null, accept: null, decline: null, failed: null, binding: null, issueMine: null, issueTheirs: null, receiptMine: null, receiptTheirs: null, held: [] });
const typeOf = (doc) => (typeof doc?.type === 'string' ? doc.type : 'untyped');
const hold = (s, doc) => {
    if (s.held.some((h) => h.id === doc.id))
        return { kind: 'ignored', type: typeOf(doc), why: 'duplicate' };
    if (s.held.length >= HELD_MAX)
        return { kind: 'ignored', type: typeOf(doc), why: 'held-full' };
    s.held.push(doc);
    return { kind: 'held', type: typeOf(doc) };
};
class Machine {
    party;
    o;
    s;
    chain = Promise.resolve();
    constructor(party, s, o) {
        this.party = party;
        this.o = o;
        this.s = s;
    }
    /** one call at a time: two documents arriving together are handled one after another */
    serial(f) { const p = this.chain.then(f, f); this.chain = p.catch(() => { }); return p; }
    snapshot() { return JSON.parse(JSON.stringify(this.s)); }
    /** both credentials and both receipts are in */
    get complete() { return !!(this.s.issueTheirs && this.s.receiptTheirs); }
    /** complete, declined, or ended by the other side's error: nothing more to send or take */
    get finished() { return this.complete || !!this.s.decline || !!this.s.failed; }
    /** the other side's error that ended the enactment, if any */
    get failure() { return this.s.failed ?? null; }
    get declined() { return !!this.s.decline; }
    /** the own documents of the enactment so far, in the order they were made: what to send again after a restart */
    /** the own documents the other side may still be waiting for: everything so far while the enactment runs;
     *  after `complete` only our receipt (the other side's receipt may have arrived before ours left, #182);
     *  after our decline the decline; after the other side's `failed` nothing */
    outbox() {
        if (this.s.failed)
            return [];
        if (this.complete)
            return [this.s.receiptMine].filter((d) => d);
        return [this.ownDocs(), this.s.issueMine, this.s.receiptMine].flat().filter((d) => d);
    }
    /** a trust-task-error of the other side in our thread ends the enactment (`failed`), unless the flow
     *  read it as a decline before; anything else is not a step */
    async takeError(doc, expect, nowMs) {
        const type = typeOf(doc);
        const r = await sc.checkError(doc, { ...expect, myDid: this.party.messaging.did }, nowMs);
        if (r === 'not-an-error')
            return result([], [{ kind: 'ignored', type, why: 'not-a-step' }]);
        if (typeof r === 'string')
            return result([], [{ kind: 'refused', type, reason: r }]);
        if (this.s.failed)
            return result([], [{ kind: 'ignored', type, why: 'duplicate' }], true);
        if (this.complete || this.s.decline)
            return result([], [{ kind: 'ignored', type, why: 'after-decision' }], true);
        this.s.failed = r;
        this.s.held = [];
        return result([], [{ kind: 'failed', ...r }], true);
    }
}
/** The inviter: showed the link `{id, exp}`; its messaging identity is the link's `_from`. */
export class Inviter extends Machine {
    constructor(party, link, o, restore) {
        if (restore && restore.role !== 'inviter')
            throw new Error('not an inviter snapshot');
        super(party, restore ?? { role: 'inviter', id: link.id, exp: link.exp, ...empty() }, o);
    }
    ownDocs() { return [this.s.accept, this.s.decline]; }
    /** the propose the person has to answer, or null */
    get pending() {
        const s = this.s;
        if (!s.propose || s.accept || s.decline || s.failed)
            return null;
        return { propose: s.propose, name: s.propose.payload.reason ?? null, relationshipDid: s.propose.payload.relationshipDid };
    }
    get theirPair() { return this.s.propose?.payload.relationshipDid ?? null; }
    get theirDid() { return this.s.propose?.issuer ?? null; }
    /** a document the carrier delivered; `peerDid` is the TSP sender the caller verified */
    receive(doc, peerDid, nowMs) { return this.serial(() => this.take(doc, peerDid, nowMs)); }
    async take(doc, peerDid, nowMs) {
        const s = this.s, type = typeOf(doc), me = this.party.messaging.did;
        if (!sc.sameVid(doc?.issuer, peerDid) || (s.propose && !sc.sameVid(doc.issuer, s.propose.issuer)))
            return result([], [{ kind: 'refused', type, reason: 'issuer' }]);
        if (type === sc.TASK_PROPOSE) {
            if (s.propose) {
                if (doc.id === s.propose.id && same(doc, s.propose)) {
                    // a redelivery: what we answered goes out again (nothing while the person has not decided)
                    return result(s.accept ? [s.accept, s.issueMine] : s.decline ? [s.decline] : [], [{ kind: 'ignored', type, why: 'duplicate' }], this.finished);
                }
                return result([], [{ kind: 'refused', type, reason: 'second-propose' }]);
            }
            const r = await sc.checkPropose(doc, { did: me, id: s.id, exp: s.exp }, nowMs);
            if (r)
                return result([], [{ kind: 'refused', type, reason: r }]);
            s.propose = doc;
            return result([], [{ kind: 'proposed', name: doc.payload.reason ?? null, relationshipDid: doc.payload.relationshipDid, proposeId: doc.id }]);
        }
        if (type === sc.TASK_ISSUE) {
            if (!s.propose)
                return result([], [{ kind: 'refused', type, reason: 'before-propose' }]);
            if (s.issueTheirs)
                return result(same(doc, s.issueTheirs) ? [s.receiptMine] : [], [{ kind: 'ignored', type, why: 'duplicate' }], this.finished);
            if (!s.accept) {
                // only after a lost acceptance can the responder's issue come first; held until the person decided
                if (s.decline || s.failed)
                    return result([], [{ kind: 'ignored', type, why: 'after-decision' }], true);
                return result([], [hold(s, doc)]);
            }
            if (s.failed)
                return result([], [{ kind: 'ignored', type, why: 'after-decision' }], true);
            const r = await sc.checkIssue(doc, {
                issuerDid: s.propose.issuer, myDid: me, threadId: s.propose.id, enactment: s.id, step: 'issue-responder',
                issuerPair: s.propose.payload.relationshipDid, myPair: this.party.pair.anchor, myChallenge: s.id, binding: s.binding,
            }, nowMs);
            if (r)
                return result([], [{ kind: 'refused', type, reason: r }]);
            const receipt = await sc.receipt(this.party, doc, nowMs, this.o.newId(), { digestBase: this.o.digestBase });
            s.issueTheirs = doc;
            s.receiptMine = receipt;
            s.held = s.held.filter((h) => h.id !== doc.id); // a held copy taken now is no longer held
            const events = [{ kind: 'credential', vrc: doc.payload.vrc, step: 'issue-responder' }];
            if (this.complete)
                events.push({ kind: 'complete' });
            return result([receipt], events, this.finished);
        }
        if (type === sc.TASK_ISSUE + '#response') {
            if (!s.propose)
                return result([], [{ kind: 'refused', type, reason: 'before-propose' }]);
            if (!s.issueMine)
                return result([], [{ kind: 'refused', type, reason: 'before-issue' }]);
            if (s.receiptTheirs)
                return result([], [{ kind: 'ignored', type, why: 'duplicate' }], this.finished);
            if (s.failed)
                return result([], [{ kind: 'ignored', type, why: 'after-decision' }], true);
            const r = await sc.checkReceipt(doc, s.issueMine, { issuerDid: s.propose.issuer, myDid: me }, nowMs);
            if (r)
                return result([], [{ kind: 'refused', type, reason: r }]);
            s.receiptTheirs = doc;
            const events = [{ kind: 'receipted', step: 'issue-inviter' }];
            if (this.complete)
                events.push({ kind: 'complete' });
            return result([], events, this.finished);
        }
        // the responder's error in our thread (a refused credential): the enactment ends
        if (!s.propose)
            return result([], [{ kind: 'ignored', type, why: 'not-a-step' }]);
        return this.takeError(doc, { threadId: s.propose.id, enactment: s.id, issuerDid: s.propose.issuer }, nowMs);
    }
    /** the person accepts: the acceptance and our credential go out; held documents are taken afterwards.
     *  `channel` is this side's own observation: `displayed` for a code shown in person, `sent` for a link sent. */
    accept(nowMs, channel) { return this.serial(() => this.doAccept(nowMs, channel)); }
    async doAccept(nowMs, channel) {
        const s = this.s;
        if (!s.propose || s.accept || s.decline || s.failed)
            throw new Error('nothing to accept');
        const p = s.propose;
        // everything built first, the state set once all of it exists
        const accept = await sc.accept(this.party, p, nowMs, this.o.newId());
        const binding = await sc.binding(s.id, p.id);
        const vrc = await sc.credential(this.party, p.payload.relationshipDid, p.id, binding, channel, nowMs, { profile: this.o.credentialProfile });
        const issueMine = await sc.issue(this.party, p.issuer, p.id, s.id, 'issue-inviter', vrc, nowMs, this.o.newId(), { statedDigest: this.o.statedDigest, digestBase: this.o.digestBase });
        Object.assign(s, { accept, binding, issueMine });
        const out = result([accept, issueMine], [{ kind: 'accepted', relationshipDid: p.payload.relationshipDid }]);
        // held documents one by one; one that throws stays held (it leaves on a successful later take or a decision)
        for (const h of [...s.held]) {
            try {
                const r = await this.take(h, p.issuer, nowMs);
                out.send.push(...r.send);
                out.events.push(...r.events);
            }
            catch {
                continue;
            }
            s.held = s.held.filter((x) => x !== h);
        }
        out.finished = this.finished;
        return out;
    }
    /** the person declines: the registry's error document goes out; the handle stays spent */
    decline(nowMs, message) { return this.serial(() => this.doDecline(nowMs, message)); }
    async doDecline(nowMs, message) {
        const s = this.s;
        if (!s.propose || s.accept || s.decline || s.failed)
            throw new Error('nothing to decline');
        const doc = await sc.decline(this.party, s.propose, nowMs, this.o.newId(), message);
        s.decline = doc;
        s.held = [];
        return result([doc], [{ kind: 'declined', message: message ?? null }], true);
    }
}
/** The responder: read the link, the person confirmed; `challenge` is its fresh 16-byte value (also the
 *  nonce of its encounter seeds). */
export class Responder extends Machine {
    constructor(party, link, challenge, channel, o, restore) {
        if (restore && restore.role !== 'responder')
            throw new Error('not a responder snapshot');
        const l = typeof link.from === 'object' ? { from: link.from.did, id: link.id, exp: link.exp, label: link.label ?? null } : link;
        super(party, restore ?? { role: 'responder', link: l, challenge, channel, ...empty() }, o);
    }
    ownDocs() { return [this.s.propose]; }
    get theirPair() { return this.s.accept?.payload.relationshipDid ?? null; }
    get theirDid() { return this.s.link.from; }
    /** the proposal (once; a restart sends the same one again) */
    start(nowMs) {
        return this.serial(async () => {
            const s = this.s;
            if (!s.propose)
                s.propose = await sc.propose(this.party, s.link.from, s.link.id, s.challenge, nowMs);
            return result([s.propose], []);
        });
    }
    receive(doc, peerDid, nowMs) { return this.serial(() => this.take(doc, peerDid, nowMs)); }
    async take(doc, peerDid, nowMs) {
        const s = this.s, type = typeOf(doc), me = this.party.messaging.did;
        if (!sc.sameVid(peerDid, s.link.from) || !sc.sameVid(doc?.issuer, s.link.from))
            return result([], [{ kind: 'refused', type, reason: 'issuer' }]);
        if (!s.propose)
            return result([], [{ kind: 'refused', type, reason: 'before-propose' }]);
        if (type === sc.TASK_PROPOSE + '#response') {
            if (s.accept)
                return result(same(doc, s.accept) ? [s.issueMine] : [], [{ kind: 'ignored', type, why: 'duplicate' }], this.finished);
            if (s.decline || s.failed)
                return result([], [{ kind: 'ignored', type, why: 'after-decision' }], true);
            const r = await sc.checkAccept(doc, s.propose, s.link.from, nowMs);
            if (r)
                return result([], [{ kind: 'refused', type, reason: r }]);
            const binding = await sc.binding(s.link.id, s.challenge);
            const vrc = await sc.credential(this.party, doc.payload.relationshipDid, s.link.id, binding, s.channel, nowMs, { profile: this.o.credentialProfile });
            const issueMine = await sc.issue(this.party, s.link.from, s.propose.id, s.link.id, 'issue-responder', vrc, nowMs, this.o.newId(), { statedDigest: this.o.statedDigest, digestBase: this.o.digestBase });
            Object.assign(s, { accept: doc, binding, issueMine });
            const out = result([issueMine], [{ kind: 'accepted', relationshipDid: doc.payload.relationshipDid }]);
            for (const h of [...s.held]) {
                try {
                    const r2 = await this.take(h, peerDid, nowMs);
                    out.send.push(...r2.send);
                    out.events.push(...r2.events);
                }
                catch {
                    continue;
                }
                s.held = s.held.filter((x) => x !== h);
            }
            out.finished = this.finished;
            return out;
        }
        if (type === sc.TASK_ISSUE) {
            if (s.issueTheirs)
                return result(same(doc, s.issueTheirs) ? [s.receiptMine] : [], [{ kind: 'ignored', type, why: 'duplicate' }], this.finished);
            if (!s.accept)
                return result([], [s.decline || s.failed ? { kind: 'ignored', type, why: 'after-decision' } : hold(s, doc)], this.finished);
            if (s.failed)
                return result([], [{ kind: 'ignored', type, why: 'after-decision' }], true);
            const r = await sc.checkIssue(doc, {
                issuerDid: s.link.from, myDid: me, threadId: s.propose.id, enactment: s.link.id, step: 'issue-inviter',
                issuerPair: s.accept.payload.relationshipDid, myPair: this.party.pair.anchor, myChallenge: s.challenge, binding: s.binding,
            }, nowMs);
            if (r)
                return result([], [{ kind: 'refused', type, reason: r }]);
            const receipt = await sc.receipt(this.party, doc, nowMs, this.o.newId(), { digestBase: this.o.digestBase });
            s.issueTheirs = doc;
            s.receiptMine = receipt;
            s.held = s.held.filter((h) => h.id !== doc.id);
            const events = [{ kind: 'credential', vrc: doc.payload.vrc, step: 'issue-inviter' }];
            if (this.complete)
                events.push({ kind: 'complete' });
            return result([receipt], events, this.finished);
        }
        if (type === sc.TASK_ISSUE + '#response') {
            if (s.receiptTheirs)
                return result([], [{ kind: 'ignored', type, why: 'duplicate' }], this.finished);
            if (!s.issueMine)
                return result([], [s.decline || s.failed ? { kind: 'ignored', type, why: 'after-decision' } : hold(s, doc)], this.finished);
            if (s.failed)
                return result([], [{ kind: 'ignored', type, why: 'after-decision' }], true);
            const r = await sc.checkReceipt(doc, s.issueMine, { issuerDid: s.link.from, myDid: me }, nowMs);
            if (r)
                return result([], [{ kind: 'refused', type, reason: r }]);
            s.receiptTheirs = doc;
            s.held = s.held.filter((h) => h.id !== doc.id);
            const events = [{ kind: 'receipted', step: 'issue-responder' }];
            if (this.complete)
                events.push({ kind: 'complete' });
            return result([], events, this.finished);
        }
        // a trust-task-error of the inviter in our thread: on step propose with the decline code it is the
        // decline; any other code ends the enactment as failed; anything else is not a step
        const d = await sc.checkDecline(doc, s.propose, s.link.from, nowMs);
        if (d === null) {
            if (s.accept || s.failed)
                return result([], [{ kind: 'ignored', type, why: 'after-decision' }], this.finished);
            if (s.decline)
                return result([], [{ kind: 'ignored', type, why: 'duplicate' }], true);
            s.decline = doc;
            s.held = [];
            return result([], [{ kind: 'declined', message: doc.payload.message ?? null }], true);
        }
        if (d !== 'not-a-decline')
            return result([], [{ kind: 'refused', type, reason: d }]);
        return this.takeError(doc, { threadId: s.propose.id, enactment: s.link.id, issuerDid: s.link.from }, nowMs);
    }
}
