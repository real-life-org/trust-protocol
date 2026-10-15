// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// membership/holder — groups on the holder (lib Stage 2, PR 7a; Membership
// Tasks 0.19 on Access 0.57, Delivery 0.81): founding, the prelude and
// the invite, the accept, admission and welcome, evidence and vouches, on
// HolderState and the engine. The pure forms and checks are the root
// module's (membership.ts).
//
// What it registers (membershipModule):
//   human acts  membership.found   a group founded under a fresh pair
//                                  label, its genesis signed (Access 3.4.1:
//                                  that context is the founder's member
//                                  anchor, its memberOp the genesis)
//               membership.invite  the prelude toward a contact (Membership
//                                  1.2); the invite follows its answer
//               membership.vouch   a vouch@2 for a held consent pair
//                                  (Access 5.3), relayed as evidence
//   decision    group-invite: accept signs and sends the accept (3.2),
//               decline closes
//   tasks       membership-invite/0.2 (proof absent), membership-accept/0.2
//               (proof required), membership-evidence/0.2 and /0.1 (proof
//               absent): channel bindings on member keys (receive.ts);
//               x-membership-prelude-request/0.1, x-membership-prelude-
//               reply/0.1 (tuple binding) and x-membership-welcome/0.1
//               (channel binding), this library's experimental forms; all
//               signature-class: signed acks
//   keepKeys    the member keys of held groups and of groups on the way in
//   retain      declined and expired invitations leave `joining`
//
// Choices this file makes where spec and note leave them open:
//   - the prelude is application-level (Membership 1.2): this library
//     carries it over the relationship tuple as two experimental, signed
//     documents; the invitee's holder answers on its own, registering its member label and key first (Identity 6.1),
//     with a displayed member card (2.6) whose key the invite is sealed
//     to. An answer is taken only on a thread whose request this holder
//     sent (the outbox holds it)
//   - the welcome: Membership 3.3 carries it in access-operation/0.1 with
//     a member.add envelope and a sealed rltp-welcome/0.1 (Section 4),
//     Access's materialization deciding; until the Access envelope is
//     built here, the admitting member sends x-membership-welcome/0.1,
//     signed under its member anchor: the group's name, DID, genesis, rules
//     and the roster it holds, the new member's entry naming its admission
//     by the accept's document digest (its memberOp). Replication of the
//     roster beyond that is the Access port's. Operation ids: the founder's
//     memberOp is the genesis's oid (the genesis digest's SHA-256, Access
//     3.3), a member's the oid of its accept document's digest (a member admitted later is
//     unknown to earlier members until their port materializes it)
//   - the admission without a human act at the admitting member: the
//     invitation is read as the anticipated admission act — the inviter
//     decided when it invited, so the accept (n = 1) or the evidence that
//     completes the vouches admits in the same commit. Membership 3280
//     (the accept grants nothing) and 3800 (evidence grants nothing) can be
//     read against this; an open spec reading for Membership 0.20, no
//     admission prompt yet
//   - founding: the genesis admits under the rule of one (vouchThreshold
//     "1"); a stricter rule needs policy.change, which is not built, so
//     found refuses another (threshold-unsupported). A member's own vouch
//     for its own invitee never counts beside its admission and is refused
//     (own-admission)
//   - the prelude is bound both ways: the request names the inviter's
//     member anchor and the answering holder files the prelude under
//     (genesis digest, inviter), so an invite surfaces as the contact that
//     asked as that inviter; the inviter files its request by thread
//     (group, contact, own rkid) and takes an answer only for exactly that
//     group on exactly that thread and tuple
//   - invitations are kept per thread: a new invite opens its own thread
//     beside earlier ones, so an accept signed in time on an earlier thread
//     still answers it; an accept answers exactly the invitation of its
//     thread, and an admission answers every invitation to its subject
//   - bounded state (tick): an issued invitation leaves past validUntil +
//     membership-skew + the longest give-up horizon (P90D, RLTP-MT-3090),
//     as does evidence (an accept signed in time may arrive that late), or
//     once its subject is on the roster; an outgoing prelude past an
//     invite's life and the horizon (its answer may travel that long); an
//     answered prelude no open or accepted invitation rests on past an
//     invite's life + skew + P90D; an accepted or joined invitation past
//     validUntil + skew + two horizons — the accept's delivery and the
//     welcome's — so the welcome finds the accepted state and the member
//     key (kept while an invitation is open or accepted); an explicit abort
//     is not built. A member key leaving keepKeys leaves `addresses`
//     without a tombstone (an identity context, engine.ts tick), so a later
//     invitation to the same group derives and uses the same key again
//   - the prelude request proves its claimed inviter: a binding signed
//     under the inviter's member key over (anchor, group, thread, and both
//     pair anchors of the channel it travels on, checked against the
//     document's issuer and recipient as stage 8 authenticated them), so
//     no other contact can replay it on its own channel; the
//     answering holder never overwrites a binding (group, inviter) held for
//     another contact. Residue: the binding links the inviter's member
//     anchor to its pair channel transferably (the invite names that
//     anchor before consent anyway)
//   - the admission policy: the group rule vouchThreshold n reads as the
//     `vouch` rule of member.add (Access 4.2) counting the admitting
//     member: n distinct members stand behind an admission, the admitting
//     member one of them, the others by vouch@2 credentials whose issuer
//     is on its roster. n = 1 admits on the accept. Only the inviter (the
//     holder that recorded the accept) admits; with n > 1 it relays the
//     consent pair as membership-evidence/0.2 to the other members on its
//     roster (candidacy false still permits this silent relay, 3250), and
//     a member's vouch travels back to it as evidence with its vouch
//   - membership-evidence: Delivery §4.4 still lists membership-evidence/
//     0.1; Membership 0.19 registers /0.2 and keeps /0.1 receivable
//     (3815): both are registered here, /0.2 is the one issued (a gap to
//     close in Delivery 0.82). A relayer this holder does not have on its
//     roster cannot be acknowledged (its key is unknown): validation-failed
//     where 3750 has the pending disposition incomplete(missing:
//     group-state), which this engine does not have
//   - the accept's candidacy is false (the decision carries only accept
//     or decline); surfacing a candidacy (3765) is not built
//   - the in-library Access (localAccess): where createHolder gets no
//     Access port, every preparation sees one over its own snapshot's
//     `groups`, so a group star opens between members whose rosters the
//     holder holds: isMember by the roster, resolve(oid) by the roster
//     entry whose op it is (its member anchor and card key)
//   - a member group is listed in the group star (5420: listed unless
//     switched off)
import { b64uOf, fromB64u, iso, sameDigest, toU } from '../core.js';
import { anchorOfEd, diSignWith, diVerify, digestBytes, digestDoc } from '../crypto.js';
import { seal } from '../delivery.js';
import { cardBody } from '../encounter.js';
import { ACCEPT_TYPE, EVIDENCE_TYPE, EVIDENCE_TYPE_01, INVITE_TYPE, MEMBERSHIP_SKEW, acceptProblem, enclosedCardOk, evidenceProblem, inviteCredentialBody, inviteProblem, memberLabelOf, membershipSchemaOk, oidOf, vouchCredentialBody, vouchProblem, withinBudget, } from '../membership.js';
import { withLabel, withPairNonce } from '../identity-state.js';
import { ED_PKCS8 } from '../keys-seed.js';
import { tupleByRkid } from '../receive.js';
import { entryOf, findContact, liveRel, activeTuple } from '../trust/state.js';
import { groupStarRematch, withGroupHits } from '../trust/group-star.js';
const TT = 'https://real-life.org/trust-tasks/';
/** This library's experimental forms (receive.ts SIGNATURE_CLASS). */
export const PRELUDE_REQUEST_TYPE = TT + 'x-membership-prelude-request/0.1';
export const PRELUDE_REPLY_TYPE = TT + 'x-membership-prelude-reply/0.1';
export const WELCOME_TYPE = TT + 'x-membership-welcome/0.1';
export { INVITE_TYPE, ACCEPT_TYPE, EVIDENCE_TYPE };
/** How long an invite is answerable (validUntil − validFrom), as the probe had it. */
export const INVITE_LIFE = 24 * 3_600_000;
/** The longest give-up horizon (Delivery [P1D, P90D]): what late answers may still need (RLTP-MT-3090). */
const HORIZON_MAX = 90 * 86_400_000;
export const MEMBERSHIP_COMMANDS = Object.freeze({
    found: 'membership.found',
    invite: 'membership.invite',
    vouch: 'membership.vouch',
});
const refuse = (reason, ref) => ({ ok: false, reason, ...(ref ? { ref } : {}) });
const no = (code, ref) => ({ ok: false, code, ...(ref ? { ref } : {}) });
const isRefusal = (x) => x?.ok === false;
const sealWith = (ctx, doc, keyAgreement) => seal(doc, keyAgreement, { ephSeed: ctx.entropy.bytes('seal.eph', 32), nonce: ctx.entropy.bytes('seal.nonce', 12) }, ctx.crypto.subtle);
const signer = (ctx, label) => (b) => ctx.keys.sign(label, b);
const signDoc = async (ctx, label, anchor, doc, at) => diSignWith(anchor, signer(ctx, label), doc, at, ctx.crypto.subtle);
const draft = (s) => ({ digest: s.digest, envelope: s.envelope, type: s.type, threadId: s.threadId, recipient: s.recipient });
async function sealed(ctx, doc, recipient) {
    return { digest: await digestDoc(doc, ctx.crypto.subtle), envelope: await sealWith(ctx, doc, recipient.keyAgreement), threadId: doc.threadId, type: doc.type, recipient };
}
/** The own key-agreement id a label derives under, from `addresses`. */
const rkidOf = (state, label) => Object.entries(state.addresses.keys).find(([, k]) => k.label === label)?.[0];
/** A displayed member card (Membership 2.6): no challenge, no sentTo/boundTo/hints. */
async function memberCard(ctx, label, name, at) {
    const me = await ctx.keys.anchorOf(label);
    const body = cardBody(me, name !== undefined ? { name } : {});
    return await signDoc(ctx, label, me.anchor, body, at);
}
const ownName = (state) => {
    const n = state.profile.body?.name;
    return typeof n === 'string' && n.length ? [...n].slice(0, 200).join('') : undefined;
};
const groupOfLabel = (state, label) => label === undefined ? undefined : Object.values(state.groups).find((g) => g.memberLabel === label);
/** The policy (see the header): admitted when vouchThreshold distinct
 *  members stand behind it, the admitting member one of them. */
function policyMet(g, ev) {
    const backers = new Set([g.memberAnchor ?? '']);
    for (const v of ev.vouches)
        if (Object.hasOwn(g.roster, v.issuer))
            backers.add(v.issuer);
    return BigInt(backers.size) >= BigInt(g.rules.vouchThreshold);
}
// ── the in-library Access over the holder's own groups ─────────────────
const groupAccess = (g) => Object.freeze({
    group: g.id,
    isMember: (a) => Object.hasOwn(g.roster, a),
    resolve: (oid) => {
        const e = Object.values(g.roster).find((x) => x.op === oid);
        return e ? { subject: e.anchor, keyAgreement: e.keyAgreement } : null;
    },
});
/** An Access over one snapshot's `groups` (note §3 Access; the header). */
export function localAccess(state) {
    return Object.freeze({
        memberships: async () => Object.values(state.groups).map(groupAccess),
        membership: async (id) => (Object.hasOwn(state.groups, id) ? groupAccess(state.groups[id]) : null),
    });
}
const foundDef = {
    human: true,
    async prepare(ctx, input) {
        if (typeof input?.name !== 'string' || !input.name.length)
            throw new TypeError('membership.found needs {name}');
        const S = ctx.crypto.subtle;
        const n = ctx.entropy.bytes('founding.nonce', 32);
        const label = 'pair/' + await digestBytes(n, S);
        const me = await ctx.keys.anchorOf(label);
        // the group address: a probe mint until Identity names the group key's origin
        const k = await S.importKey('pkcs8', Uint8Array.from([...ED_PKCS8, ...ctx.entropy.bytes('group.seed', 32)]), { name: 'Ed25519' }, true, ['sign']);
        const did = anchorOfEd(fromB64u((await S.exportKey('jwk', k)).x));
        const at = iso(ctx.when);
        const body = { type: 'group-genesis@probe', group: did, label: input.name, founder: me.anchor, issuedAt: at };
        const genesis = await signDoc(ctx, label, me.anchor, body, at);
        return { label, nonce: b64uOf(n), rkid: me.keyAgreement, anchor: me.anchor, did, genesis, genesisDigest: await digestDoc(body, S), keyAgreement: me.keyAgreement, name: ownName(ctx.snapshot) };
    },
    apply(state, prepared, input, when) {
        const p = prepared.value;
        if (state.register.labels.includes(p.label))
            throw new Error('membership.found: the founding label is not fresh');
        if (Object.hasOwn(state.groups, p.genesisDigest))
            throw new Error('membership.found: the genesis exists');
        const threshold = input.vouchThreshold ?? '1';
        if (!/^[1-9][0-9]?$/.test(threshold))
            throw new TypeError('membership.found: vouchThreshold is a positive decimal');
        if (threshold !== '1')
            return no('threshold-unsupported');
        const group = {
            id: p.genesisDigest, name: input.name, did: p.did, genesis: p.genesis, memberLabel: p.label, rules: { vouchThreshold: threshold },
            listed: input.listed ?? true, memberAnchor: p.anchor, memberOp: oidOf(p.genesisDigest),
            roster: { [p.anchor]: { anchor: p.anchor, op: oidOf(p.genesisDigest), keyAgreement: p.keyAgreement, ...(p.name !== undefined ? { name: p.name } : {}), addedAt: when } },
            invitations: {}, evidence: {}, preludes: {},
        };
        return {
            state: {
                ...state,
                register: withPairNonce(state.register, p.label, p.nonce),
                addresses: { ...state.addresses, keys: { ...state.addresses.keys, [p.rkid]: { label: p.label, lastShown: when } } },
                groups: { ...state.groups, [group.id]: group },
            },
            events: [{ type: 'group.founded', groupId: group.id }],
        };
    },
};
// ── the prelude (Membership 1.2) ───────────────────────────────────────
/** The live active tuple toward a contact, with its relationship. */
function channelTo(state, contactId) {
    const c = findContact(state, contactId);
    if (!c)
        return null;
    const ids = new Set([c.id, ...c.aliases]);
    for (const id of c.relIds) {
        const r = state.relationships[id];
        const t = r && liveRel(r) ? activeTuple(r) : undefined;
        if (t && !t.deactivated && ids.has(t.entryId))
            return { contact: c, rel: r, tuple: t };
    }
    return null;
}
const inviteDef = {
    human: true,
    async prepare(ctx, input) {
        const g = ctx.snapshot.groups[input?.groupId];
        if (!g || g.memberAnchor === undefined)
            return no('unknown-group');
        const ch = channelTo(ctx.snapshot, input.contactId);
        if (!ch)
            return no('no-own-channel');
        const own = await ctx.keys.anchorOf(ch.tuple.ownPairLabel);
        const at = iso(ctx.when);
        const body = {
            id: ctx.entropy.id('doc.id'), type: PRELUDE_REQUEST_TYPE, issuer: own.anchor, recipient: ch.tuple.counterpartAnchor,
            threadId: ctx.entropy.id('thread.id'), issuedAt: at, payload: { genesisDigest: g.id, group: g.did ?? '', name: g.name, inviter: g.memberAnchor, binding: {} },
        };
        // the inviter's member anchor proven: signed under it over (anchor, group, thread)
        body.payload.binding = await signDoc(ctx, g.memberLabel, g.memberAnchor, {
            type: 'x-membership-inviter@0.1', inviter: g.memberAnchor, genesisDigest: g.id, threadId: body.threadId, from: own.anchor, to: ch.tuple.counterpartAnchor,
        }, at);
        const doc = await signDoc(ctx, ch.tuple.ownPairLabel, own.anchor, body, at);
        return sealed(ctx, doc, { contactId: ch.contact.id, rkid: ch.tuple.rkid, keyAgreement: ch.tuple.counterpartKeyAgreement });
    },
    apply(state, prepared, input, when) {
        const p = prepared.value;
        if (isRefusal(p))
            return p;
        const g = state.groups[input.groupId];
        const preludes = { ...g.preludes, [p.threadId]: { contactId: p.recipient.contactId, rkid: p.recipient.rkid, at: when } };
        return { state: { ...state, groups: { ...state.groups, [g.id]: { ...g, preludes } } }, outbound: [draft(p)] };
    },
};
/** The arrival tuple's own label and the entry it feeds. */
function arrival(state, rkid) {
    const at = tupleByRkid(state, rkid);
    return at ? { label: at.tuple.ownPairLabel, contactId: entryOf(state, at.rel)?.id ?? at.rel.contactId, tuple: at.tuple } : null;
}
/** An answered prelude's key: the group and the inviter that asked. */
const preludeKey = (group, inviter) => `${group} ${inviter}`;
const preludeRequestTask = {
    proof: 'required',
    decode(p) {
        const x = p;
        if (x === null || typeof x !== 'object' || Object.keys(x).length !== 5 || typeof x.genesisDigest !== 'string' || typeof x.group !== 'string' ||
            typeof x.name !== 'string' || typeof x.inviter !== 'string' || !/^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/.test(x.inviter) ||
            x.binding === null || typeof x.binding !== 'object')
            return refuse('malformed');
        return memberLabelOf(x.genesisDigest) === null ? refuse('validation-failed') : x;
    },
    async prepare(ctx, doc, arr) {
        if (!(await diVerify(doc, doc.issuer)))
            return refuse('validation-failed', 'RLTP-MT-2130');
        // the claimed inviter proven by its own member key, for this group and thread
        const b = doc.payload.binding;
        if (b.type !== 'x-membership-inviter@0.1' || b.inviter !== doc.payload.inviter || b.genesisDigest !== doc.payload.genesisDigest ||
            b.threadId !== doc.threadId || b.from !== doc.issuer || b.to !== doc.recipient || !(await diVerify(b, doc.payload.inviter)))
            return refuse('validation-failed', 'RLTP-MT-3020');
        const a = arrival(ctx.snapshot, arr.rkid);
        const label = memberLabelOf(doc.payload.genesisDigest);
        const member = await ctx.keys.anchorOf(label);
        const at = iso(ctx.when);
        const card = await memberCard(ctx, label, ownName(ctx.snapshot), at);
        const own = await ctx.keys.anchorOf(a.label);
        const body = {
            id: ctx.entropy.id('doc.id'), type: PRELUDE_REPLY_TYPE, issuer: own.anchor, recipient: doc.issuer, threadId: doc.threadId, issuedAt: at,
            payload: { genesisDigest: doc.payload.genesisDigest, card },
        };
        const reply = await sealed(ctx, await signDoc(ctx, a.label, own.anchor, body, at), { contactId: a.contactId, rkid: arr.rkid, keyAgreement: a.tuple.counterpartKeyAgreement });
        return { reply, label, rkid: member.keyAgreement };
    },
    apply(state, prepared, doc, arr) {
        const p = prepared.value;
        const a = arrival(state, arr.rkid);
        // a binding (group, inviter) held for another contact is never overwritten
        const bound = state.joining.preludes[preludeKey(toU(doc.payload.genesisDigest), doc.payload.inviter)];
        if (bound && bound.contactId !== a.contactId)
            return refuse('validation-failed', 'RLTP-MT-3030');
        const keys = Object.hasOwn(state.addresses.keys, p.rkid) ? state.addresses.keys : { ...state.addresses.keys, [p.rkid]: { label: p.label, lastShown: arr.when } };
        return {
            state: {
                ...state,
                // the member label in the register before its anchor is shown (Identity 6.1)
                register: withLabel(state.register, p.label),
                addresses: { ...state.addresses, keys },
                joining: { ...state.joining, preludes: { ...state.joining.preludes, [preludeKey(toU(doc.payload.genesisDigest), doc.payload.inviter)]: { group: toU(doc.payload.genesisDigest), inviter: doc.payload.inviter, contactId: a.contactId, memberLabel: p.label, at: arr.when } } },
            },
            outbound: [draft(p.reply)],
        };
    },
};
const preludeReplyTask = {
    proof: 'required',
    decode(p) {
        const x = p;
        if (x === null || typeof x !== 'object' || Object.keys(x).length !== 2 || typeof x.genesisDigest !== 'string' || x.card === null || typeof x.card !== 'object')
            return refuse('malformed');
        return x;
    },
    async prepare(ctx, doc, arr) {
        const s = ctx.snapshot;
        if (!(await diVerify(doc, doc.issuer)))
            return refuse('validation-failed', 'RLTP-MT-2130');
        // the answer to exactly the prelude this holder sent: its group, thread and tuple
        const g = s.groups[toU(doc.payload.genesisDigest) ?? ''];
        const asked = g?.preludes[doc.threadId];
        if (!g || g.memberAnchor === undefined || !asked || asked.rkid !== arr.rkid)
            return refuse('validation-failed', 'RLTP-MT-3030');
        const card = doc.payload.card;
        if (!(await enclosedCardOk(card, card.anchor)))
            return refuse('validation-failed', 'RLTP-MT-2250');
        const a = arrival(s, arr.rkid);
        const S = ctx.crypto.subtle;
        const at = iso(ctx.when);
        const until = ctx.when + INVITE_LIFE;
        const threadId = ctx.entropy.id('thread.id');
        const inviterCard = await memberCard(ctx, g.memberLabel, ownName(s), at);
        const cred = inviteCredentialBody({
            issuer: g.memberAnchor, invitee: card.anchor, group: g.did ?? '', genesisDigest: g.id, card: inviterCard, name: g.name,
            validFrom: at, validUntil: iso(until), taskContext: threadId,
        });
        const invite = await signDoc(ctx, g.memberLabel, g.memberAnchor, cred, at);
        const inviteDoc = { id: ctx.entropy.id('doc.id'), type: INVITE_TYPE, issuer: g.memberAnchor, recipient: card.anchor, threadId, issuedAt: at, payload: { invite } };
        if (!membershipSchemaOk('payload-membership-invite.schema.json', inviteDoc.payload) || !withinBudget(inviteDoc))
            return refuse('validation-failed', 'RLTP-MT-2220');
        const out = await sealed(ctx, inviteDoc, { contactId: a.contactId, rkid: rkidOf(s, g.memberLabel) ?? '', keyAgreement: card.keyAgreement, anchor: card.anchor });
        return { ...out, invitee: card.anchor, credDigest: await digestDoc(invite, S), invite: inviteDoc, validUntil: until };
    },
    apply(state, prepared, doc, arr) {
        const p = prepared.value;
        const g = state.groups[toU(doc.payload.genesisDigest)];
        const preludes = { ...g.preludes };
        delete preludes[doc.threadId];
        // a member is not invited again; every invitation is its own thread,
        // kept beside earlier ones (an accept signed in time may still travel)
        if (Object.hasOwn(g.roster, p.invitee))
            return { state: { ...state, groups: { ...state.groups, [g.id]: { ...g, preludes } } } };
        if (!p.recipient.rkid)
            throw new Error(`membership: no address key for ${g.memberLabel}`);
        const inv = { invitee: p.invitee, keyAgreement: p.recipient.keyAgreement, contactId: p.recipient.contactId, threadId: p.threadId, credDigest: p.credDigest, invite: p.invite, validUntil: p.validUntil };
        return {
            state: { ...state, groups: { ...state.groups, [g.id]: { ...g, preludes, invitations: { ...g.invitations, [p.threadId]: inv } } } },
            outbound: [draft(p)],
        };
    },
};
// ── the invite at the invitee (Membership 3.1) ─────────────────────────
const invitePromptId = (credDigest) => 'invite:' + credDigest;
const inviteTask = {
    proof: 'absent',
    decode: (p) => (membershipSchemaOk('payload-membership-invite.schema.json', p) ? p : refuse('malformed')),
    // the prelude check (3030): the invite reaches the key of the own
    // derivation from its genesis digest, after a prelude this holder answered
    channel(state, doc, rkid) {
        const inv = doc.payload.invite;
        const label = memberLabelOf(inv.credentialSubject.genesisDigest);
        if (label === null || state.addresses.keys[rkid]?.label !== label)
            return refuse('validation-failed', 'RLTP-MT-3030');
        // the contact that asked as this inviter (the prelude's binding)
        const pre = state.joining.preludes[preludeKey(toU(inv.credentialSubject.genesisDigest) ?? '', inv.issuer)];
        if (!pre)
            return refuse('validation-failed', 'RLTP-MT-3030');
        return { keyAgreement: inv.credentialSubject.card.keyAgreement, contactId: pre.contactId };
    },
    async prepare(ctx, doc) {
        const bad = await inviteProblem(doc);
        if (bad)
            return refuse('validation-failed', bad);
        return { credDigest: await digestDoc(doc.payload.invite, ctx.crypto.subtle) };
    },
    // durable buffering and surfacing to the human (3095)
    apply(state, prepared, doc, arr) {
        const inv = doc.payload.invite;
        const gd = toU(inv.credentialSubject.genesisDigest);
        const { credDigest } = prepared.value;
        if (Object.hasOwn(state.groups, gd) || Object.hasOwn(state.joining.invites, credDigest))
            return { state: state };
        const pre = state.joining.preludes[preludeKey(gd, inv.issuer)];
        const validUntil = Date.parse(inv.validUntil);
        const r = {
            credDigest, group: gd, name: typeof inv.credentialSubject.name === 'string' ? inv.credentialSubject.name : '', contactId: pre.contactId,
            memberLabel: memberLabelOf(gd), invite: doc, promptId: invitePromptId(credDigest), validUntil, status: 'open', at: arr.when,
        };
        const prompt = { id: r.promptId, kind: 'group-invite', contactId: r.contactId, groupId: gd, openedAt: arr.when, expiresAt: validUntil + MEMBERSHIP_SKEW };
        return {
            state: { ...state, joining: { ...state.joining, invites: { ...state.joining.invites, [credDigest]: r } }, prompts: { ...state.prompts, [prompt.id]: prompt } },
            events: [{ type: 'prompt.opened', promptId: prompt.id, kind: 'group-invite' }],
        };
    },
};
// ── the accept (Membership 3.2): the group-invite decision ─────────────
const inviteOfPrompt = (state, promptId) => Object.values(state.joining.invites).find((i) => i.promptId === promptId);
const acceptDecision = {
    async prepare(ctx, prompt, choice) {
        if (choice !== 'accept')
            return null;
        const r = inviteOfPrompt(ctx.snapshot, prompt.id);
        if (!r || r.status !== 'open')
            return no('unknown-group');
        const inv = r.invite.payload.invite;
        const me = await ctx.keys.anchorOf(r.memberLabel);
        const at = iso(ctx.when);
        const card = await memberCard(ctx, r.memberLabel, ownName(ctx.snapshot), at);
        const body = {
            id: ctx.entropy.id('doc.id'), type: ACCEPT_TYPE, issuer: me.anchor, recipient: inv.issuer, threadId: r.invite.threadId, issuedAt: at,
            payload: { accept: { group: inv.credentialSubject.group, subject: me.anchor, ref: r.credDigest, card, candidacy: false } },
        };
        const doc = await signDoc(ctx, r.memberLabel, me.anchor, body, at);
        if (!withinBudget(doc))
            return no('unknown-group', 'RLTP-MT-2220');
        const out = await sealed(ctx, doc, { contactId: r.contactId, rkid: rkidOf(ctx.snapshot, r.memberLabel) ?? '', keyAgreement: inv.credentialSubject.card.keyAgreement, anchor: inv.issuer });
        return { ...out, acceptDigest: await digestDoc(doc, ctx.crypto.subtle) };
    },
    apply(state, prompt, choice, when, prepared) {
        const r = inviteOfPrompt(state, prompt.id);
        if (!r)
            return { state: state };
        if (choice === 'decline')
            return { state: { ...state, joining: { ...state.joining, invites: { ...state.joining.invites, [r.credDigest]: { ...r, status: 'declined' } } } } };
        const p = prepared.value;
        if (p === null || isRefusal(p))
            return p ?? no('unknown-group');
        if (when > r.validUntil + MEMBERSHIP_SKEW)
            return no('prompt-expired', 'RLTP-MT-3270');
        if (!p.recipient.rkid)
            throw new Error(`membership: no address key for ${r.memberLabel}`);
        return {
            state: { ...state, joining: { ...state.joining, invites: { ...state.joining.invites, [r.credDigest]: { ...r, status: 'accepted', acceptDigest: p.acceptDigest } } } },
            outbound: [draft(p)],
        };
    },
};
/** The welcome (this library's form, see the header) and, for n > 1, the
 *  evidence relays to the other members. */
async function admissionDocs(ctx, g, ev, acceptDigest, admit) {
    const acc = ev.accept.payload.accept;
    const at = iso(ctx.when);
    const entry = rosterEntryOf(acc, acceptDigest, ctx.when, '');
    if (admit) {
        const roster = [...Object.values(g.roster), entry].map((m) => ({ anchor: m.anchor, op: m.op, keyAgreement: m.keyAgreement, ...(m.name !== undefined ? { name: m.name } : {}) }));
        const body = {
            id: ctx.entropy.id('doc.id'), type: WELCOME_TYPE, issuer: g.memberAnchor, recipient: acc.subject, threadId: ev.accept.threadId, issuedAt: at,
            payload: { genesisDigest: g.id, group: g.did ?? '', name: g.name, genesis: g.genesis ?? {}, vouchThreshold: g.rules.vouchThreshold, accept: acceptDigest, roster },
        };
        const doc = await signDoc(ctx, g.memberLabel, g.memberAnchor, body, at);
        return { welcome: await sealed(ctx, doc, { contactId: contactOfInvitation(g, acc.subject), rkid: rkidOf(ctx.snapshot, g.memberLabel) ?? '', keyAgreement: acc.card.keyAgreement, anchor: acc.subject }), relays: [] };
    }
    const relays = [];
    for (const m of Object.values(g.roster)) {
        if (m.anchor === g.memberAnchor || m.anchor === acc.subject)
            continue;
        const body = {
            id: ctx.entropy.id('doc.id'), type: EVIDENCE_TYPE, issuer: g.memberAnchor, recipient: m.anchor, threadId: ev.accept.threadId, issuedAt: at,
            payload: { evidence: { invite: ev.invite, accept: ev.accept } },
        };
        relays.push(await sealed(ctx, body, { contactId: m.contactId ?? 'member:' + m.anchor, rkid: rkidOf(ctx.snapshot, g.memberLabel) ?? '', keyAgreement: m.keyAgreement, anchor: m.anchor }));
    }
    return { welcome: null, relays };
}
/** The invitation of a thread to a subject (Membership 3.2: the accept answers the invite of its thread). */
const invitationOf = (g, threadId, subject) => {
    const i = Object.hasOwn(g.invitations, threadId) ? g.invitations[threadId] : undefined;
    return i && i.invitee === subject ? i : undefined;
};
const contactOfInvitation = (g, subject) => Object.values(g.invitations).find((i) => i.invitee === subject)?.contactId ?? 'member:' + subject;
const rosterEntryOf = (acc, acceptDigest, when, contactId) => ({
    anchor: acc.subject, op: oidOf(acceptDigest), keyAgreement: acc.card.keyAgreement,
    ...(typeof acc.card.name === 'string' ? { name: acc.card.name } : {}), addedAt: when, ...(contactId ? { contactId } : {}),
});
/** The admission's state: the roster grows, the evidence and the invitation go. */
function admitted(state, g, acceptDigest, ev, when) {
    const acc = ev.accept.payload.accept;
    const contactId = Object.values(g.invitations).find((i) => i.invitee === acc.subject)?.contactId ?? '';
    // every invitation to the now member is answered
    const invitations = Object.fromEntries(Object.entries(g.invitations).filter(([, i]) => i.invitee !== acc.subject));
    const evidence = { ...g.evidence };
    delete evidence[acceptDigest];
    const next = { ...g, roster: { ...g.roster, [acc.subject]: rosterEntryOf(acc, acceptDigest, when, contactId) }, invitations, evidence };
    return { state: { ...state, groups: { ...state.groups, [g.id]: next } }, events: [{ type: 'group.admitted', groupId: g.id, member: acc.subject }] };
}
const acceptTask = {
    proof: 'required',
    decode: (p) => (membershipSchemaOk('payload-membership-accept.schema.json', p) ? p : refuse('malformed')),
    // to the member key that issued the invitation this accept answers
    channel(state, doc, rkid) {
        const g = groupOfLabel(state, state.addresses.keys[rkid]?.label);
        const inv = g && invitationOf(g, doc.threadId, doc.issuer);
        if (!g || !inv)
            return refuse('validation-failed', 'RLTP-MT-3270');
        return { keyAgreement: doc.payload.accept.card.keyAgreement, contactId: inv.contactId };
    },
    async prepare(ctx, doc, arr) {
        const g = groupOfLabel(ctx.snapshot, ctx.snapshot.addresses.keys[arr.rkid].label);
        const inv = invitationOf(g, doc.threadId, doc.issuer);
        const bad = await acceptProblem(doc, inv.invite, inv.credDigest);
        if (bad)
            return refuse('validation-failed', bad);
        const acceptDigest = await digestDoc(doc, ctx.crypto.subtle);
        const ev = { invite: inv.invite, accept: doc, vouches: [], at: arr.when };
        const docs = await admissionDocs(ctx, g, ev, acceptDigest, policyMet(g, ev));
        return { group: g.id, acceptDigest, ...docs };
    },
    // the defined effect: the consent recorded (3280); the admission where
    // the policy holds, else the pair relayed for vouches (the header)
    apply(state, prepared, doc, arr) {
        const p = prepared.value;
        const g = state.groups[p.group];
        const ev = { invite: invitationOf(g, doc.threadId, doc.issuer).invite, accept: doc, vouches: [], at: arr.when };
        if (p.welcome) {
            const a = admitted(state, g, p.acceptDigest, ev, arr.when);
            return { state: a.state, events: a.events, outbound: [draft(p.welcome)] };
        }
        // the consent waits as evidence; the invitation stays until the
        // admission (its contact goes onto the roster then)
        return {
            state: { ...state, groups: { ...state.groups, [g.id]: { ...g, evidence: { ...g.evidence, [p.acceptDigest]: ev } } } },
            outbound: p.relays.map(draft),
        };
    },
};
const evidenceTask = (schema) => ({
    proof: 'absent',
    decode: (p) => (membershipSchemaOk(schema, p) ? p : refuse('malformed')),
    // 3745: this holder is a member of the pair's group; the relayer is on its roster
    channel(state, doc, rkid) {
        const inv = doc.payload.evidence.invite.payload.invite;
        const g = groupOfLabel(state, state.addresses.keys[rkid]?.label);
        if (!g || !sameDigest(g.id, inv.credentialSubject.genesisDigest))
            return refuse('validation-failed', 'RLTP-MT-3755');
        const m = g.roster[doc.issuer];
        if (!m)
            return refuse('validation-failed', 'RLTP-MT-3750');
        return { keyAgreement: m.keyAgreement, contactId: m.contactId ?? 'member:' + m.anchor };
    },
    async prepare(ctx, doc, arr) {
        const { invite, accept, vouches = [] } = doc.payload.evidence;
        const S = ctx.crypto.subtle;
        const credDigest = await digestDoc(invite.payload.invite, S);
        const bad = await evidenceProblem(invite, accept, credDigest);
        if (bad)
            return refuse('validation-failed', bad);
        const acceptDigest = await digestDoc(accept, S);
        for (const v of vouches) {
            const vb = await vouchProblem(v, accept.payload.accept.subject, acceptDigest, invite.payload.invite.credentialSubject.genesisDigest);
            if (vb)
                return refuse('validation-failed', vb);
        }
        const g = groupOfLabel(ctx.snapshot, ctx.snapshot.addresses.keys[arr.rkid].label);
        const held = g.evidence[acceptDigest];
        const merged = mergeVouches(held?.vouches ?? [], vouches);
        const ev = { invite, accept, vouches: merged, at: arr.when };
        // the inviter admits once the policy holds (the header)
        const admit = invite.payload.invite.issuer === g.memberAnchor && !Object.hasOwn(g.roster, accept.payload.accept.subject) && policyMet(g, ev);
        const welcome = admit ? (await admissionDocs(ctx, g, ev, acceptDigest, true)).welcome : null;
        return { group: g.id, acceptDigest, vouches, welcome };
    },
    apply(state, prepared, doc, arr) {
        const p = prepared.value;
        const g = state.groups[p.group];
        const { invite, accept } = doc.payload.evidence;
        if (Object.hasOwn(g.roster, accept.payload.accept.subject))
            return { state: state };
        const held = g.evidence[p.acceptDigest];
        const ev = { invite, accept, vouches: mergeVouches(held?.vouches ?? [], p.vouches), at: held?.at ?? arr.when };
        if (p.welcome) {
            const a = admitted(state, g, p.acceptDigest, ev, arr.when);
            return { state: a.state, events: a.events, outbound: [draft(p.welcome)] };
        }
        // keyed by the accept: one decision per consent, vouches added up to 16 (3795)
        return { state: { ...state, groups: { ...state.groups, [g.id]: { ...g, evidence: { ...g.evidence, [p.acceptDigest]: ev } } } } };
    },
});
/** Vouches by distinct issuers, the held ones first, at most 16 (3805, 3795). */
function mergeVouches(held, more) {
    const out = [...held];
    for (const v of more)
        if (out.length < 16 && !out.some((x) => x.issuer === v.issuer))
            out.push(v);
    return out;
}
const vouchDef = {
    human: true,
    async prepare(ctx, input) {
        const g = ctx.snapshot.groups[input?.groupId];
        if (!g || g.memberAnchor === undefined)
            return no('unknown-group');
        const held = Object.entries(g.evidence).find(([, e]) => e.accept.payload.accept.subject === input.member);
        if (!held)
            return no('no-evidence');
        const [acceptDigest, ev] = held;
        // the admitting member stands behind its admission already (the header)
        if (ev.invite.payload.invite.issuer === g.memberAnchor)
            return no('own-admission');
        if (ev.vouches.some((v) => v.issuer === g.memberAnchor))
            return no('already-given');
        const at = iso(ctx.when);
        const body = vouchCredentialBody({ issuer: g.memberAnchor, subject: input.member, genesisDigest: g.id, accept: acceptDigest, provenance: input.provenance ?? 'met', validFrom: at });
        const vouch = await signDoc(ctx, g.memberLabel, g.memberAnchor, body, at);
        const inv = ev.invite.payload.invite;
        const to = g.roster[inv.issuer];
        if (!to)
            return no('no-evidence');
        const doc = {
            id: ctx.entropy.id('doc.id'), type: EVIDENCE_TYPE, issuer: g.memberAnchor, recipient: inv.issuer, threadId: ev.accept.threadId, issuedAt: at,
            payload: { evidence: { invite: ev.invite, accept: ev.accept, vouches: [vouch] } },
        };
        const relay = await sealed(ctx, doc, { contactId: to.contactId ?? 'member:' + to.anchor, rkid: rkidOf(ctx.snapshot, g.memberLabel) ?? '', keyAgreement: to.keyAgreement, anchor: to.anchor });
        return { group: g.id, acceptDigest, vouch, relay, welcome: null };
    },
    apply(state, prepared, input, when) {
        const p = prepared.value;
        if (isRefusal(p))
            return p;
        const g = state.groups[p.group];
        const ev = g.evidence[p.acceptDigest];
        const next = { ...ev, vouches: mergeVouches(ev.vouches, [p.vouch]) };
        const events = [{ type: 'group.vouched', groupId: g.id, member: input.member }];
        if (p.welcome) {
            const a = admitted(state, g, p.acceptDigest, next, when);
            return { state: a.state, events: [...events, ...a.events], outbound: [draft(p.welcome)] };
        }
        return {
            state: { ...state, groups: { ...state.groups, [g.id]: { ...g, evidence: { ...g.evidence, [p.acceptDigest]: next } } } },
            events,
            outbound: p.relay ? [draft(p.relay)] : [],
        };
    },
};
const isStr = (x) => typeof x === 'string';
const welcomeShape = (p) => {
    const x = p;
    if (x === null || typeof x !== 'object')
        return false;
    if (![x.genesisDigest, x.group, x.name, x.vouchThreshold, x.accept].every(isStr) || x.genesis === null || typeof x.genesis !== 'object' || !Array.isArray(x.roster))
        return false;
    if (!/^[1-9][0-9]?$/.test(x.vouchThreshold) || toU(x.genesisDigest) !== x.genesisDigest)
        return false;
    return x.roster.every((m) => {
        const e = m;
        return e !== null && typeof e === 'object' && isStr(e.anchor) && isStr(e.op) && isStr(e.keyAgreement) && (e.name === undefined || isStr(e.name));
    });
};
/** The invite this holder accepted whose welcome `doc` would be. */
const acceptedInvite = (state, doc) => Object.values(state.joining.invites).find((i) => i.status !== 'open' && i.status !== 'declined' &&
    i.invite.payload.invite.issuer === doc.issuer && i.invite.threadId === doc.threadId && i.group === doc.payload.genesisDigest);
const welcomeTask = {
    proof: 'required',
    decode: (p) => (welcomeShape(p) ? p : refuse('malformed')),
    // the welcome answers an invitation this holder accepted: in its thread,
    // from its inviter, to the member key of its group
    channel(state, doc, rkid) {
        const i = acceptedInvite(state, doc);
        if (!i || state.addresses.keys[rkid]?.label !== i.memberLabel)
            return refuse('validation-failed');
        return { keyAgreement: i.invite.payload.invite.credentialSubject.card.keyAgreement, contactId: i.contactId };
    },
    // the group stars already accepted are matched against the joined group (5520)
    async prepare(ctx, doc) {
        if (!(await diVerify(doc, doc.issuer)))
            return refuse('validation-failed', 'RLTP-MT-2130');
        return { hits: await groupStarRematch(ctx, doc.payload.genesisDigest) };
    },
    apply(state, p, doc, arr) {
        const i = acceptedInvite(state, doc);
        const w = doc.payload;
        if (Object.hasOwn(state.groups, w.genesisDigest))
            return { state: state };
        const own = w.roster.find((m) => m.anchor === doc.recipient);
        if (!own || !w.roster.some((m) => m.anchor === doc.issuer) || i.acceptDigest === undefined || own.op !== oidOf(i.acceptDigest) || !sameDigest(w.accept, i.acceptDigest)) {
            return refuse('validation-failed');
        }
        const roster = {};
        for (const m of w.roster) {
            roster[m.anchor] = { anchor: m.anchor, op: m.op, keyAgreement: m.keyAgreement, ...(m.name !== undefined ? { name: m.name } : {}), addedAt: arr.when, ...(m.anchor === doc.issuer ? { contactId: i.contactId } : {}) };
        }
        const g = {
            id: w.genesisDigest, name: w.name, did: w.group, genesis: w.genesis, memberLabel: i.memberLabel, rules: { vouchThreshold: w.vouchThreshold },
            listed: true, memberAnchor: doc.recipient, memberOp: own.op, roster, invitations: {}, evidence: {}, preludes: {}, acceptDigest: i.acceptDigest,
        };
        return {
            state: withGroupHits({
                ...state, groups: { ...state.groups, [g.id]: g },
                joining: { ...state.joining, invites: { ...state.joining.invites, [i.credDigest]: { ...i, status: 'joined' } } },
            }, p.value.hits, g.id),
            events: [{ type: 'group.joined', groupId: g.id }],
        };
    },
};
// ── keys and retention ─────────────────────────────────────────────────
/** The member keys still needed: held groups' and those on the way in
 *  (an answered prelude, an invitation open or accepted). */
function memberKeys(state) {
    const labels = new Set(Object.values(state.groups).map((g) => g.memberLabel));
    for (const p of Object.values(state.joining.preludes))
        labels.add(p.memberLabel);
    for (const i of Object.values(state.joining.invites))
        if (i.status === 'open' || i.status === 'accepted')
            labels.add(i.memberLabel);
    return Object.entries(state.addresses.keys).filter(([, k]) => labels.has(k.label)).map(([rkid]) => rkid);
}
const untilOf = (invite) => Date.parse(invite.payload.invite.validUntil);
/** Bounded membership state (the header): what tick lets go. */
function retainMembership(state, when) {
    let changed = false;
    const groups = {};
    for (const [id, g] of Object.entries(state.groups)) {
        const invitations = Object.fromEntries(Object.entries(g.invitations).filter(([, i]) => i.validUntil + MEMBERSHIP_SKEW + HORIZON_MAX >= when));
        const evidence = Object.fromEntries(Object.entries(g.evidence).filter(([, e]) => untilOf(e.invite) + MEMBERSHIP_SKEW + HORIZON_MAX >= when && !Object.hasOwn(g.roster, e.accept.payload.accept.subject)));
        const preludes = Object.fromEntries(Object.entries(g.preludes).filter(([, p]) => p.at + INVITE_LIFE + MEMBERSHIP_SKEW + HORIZON_MAX >= when));
        const same = Object.keys(invitations).length === Object.keys(g.invitations).length && Object.keys(evidence).length === Object.keys(g.evidence).length &&
            Object.keys(preludes).length === Object.keys(g.preludes).length;
        groups[id] = same ? g : { ...g, invitations, evidence, preludes };
        if (!same)
            changed = true;
    }
    // the accept → admission → welcome chain: two deliveries, each within a give-up horizon
    const late = (i) => i.validUntil + MEMBERSHIP_SKEW + 2 * HORIZON_MAX < when;
    const invites = Object.fromEntries(Object.entries(state.joining.invites).filter(([, i]) => !(i.status === 'declined' || (i.status === 'open' && i.validUntil + MEMBERSHIP_SKEW < when) || ((i.status === 'accepted' || i.status === 'joined') && late(i)))));
    // an answered prelude no open or accepted invitation still rests on, past an invite's life and the horizon
    const rests = (p) => Object.values(invites).some((i) => i.group === p.group && i.contactId === p.contactId && (i.status === 'open' || i.status === 'accepted'));
    const preludes = Object.fromEntries(Object.entries(state.joining.preludes).filter(([, p]) => rests(p) || p.at + INVITE_LIFE + MEMBERSHIP_SKEW + HORIZON_MAX >= when));
    if (Object.keys(invites).length !== Object.keys(state.joining.invites).length || Object.keys(preludes).length !== Object.keys(state.joining.preludes).length)
        changed = true;
    return changed ? { ...state, groups, joining: { preludes, invites } } : state;
}
/** The membership module createHolder registers. */
export function membershipModule() {
    return Object.freeze({
        name: 'membership',
        commands: Object.freeze({
            [MEMBERSHIP_COMMANDS.found]: foundDef,
            [MEMBERSHIP_COMMANDS.invite]: inviteDef,
            [MEMBERSHIP_COMMANDS.vouch]: vouchDef,
        }),
        tasks: Object.freeze({
            [PRELUDE_REQUEST_TYPE]: preludeRequestTask,
            [PRELUDE_REPLY_TYPE]: preludeReplyTask,
            [INVITE_TYPE]: inviteTask,
            [ACCEPT_TYPE]: acceptTask,
            [EVIDENCE_TYPE]: evidenceTask('payload-membership-evidence.schema.json'),
            [EVIDENCE_TYPE_01]: evidenceTask('payload-membership-evidence-0.1.schema.json'),
            [WELCOME_TYPE]: welcomeTask,
        }),
        decisions: Object.freeze({ 'group-invite': acceptDecision }),
        keepKeys: memberKeys,
        retain: retainMembership,
    });
}
