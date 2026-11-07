// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
import { diSignWith, digestDoc } from '../crypto.js';
import { seal } from '../delivery.js';
import { tupleByRkid } from '../receive.js';
import { entryOf, findContact, liveRel, activeTuple } from '../trust/state.js';
export const refuse = (reason, ref) => ({ ok: false, reason, ...(ref ? { ref } : {}) });
export const no = (code, ref) => ({ ok: false, code, ...(ref ? { ref } : {}) });
export const isRefusal = (x) => x?.ok === false;
const sealWith = (ctx, doc, keyAgreement) => seal(doc, keyAgreement, { ephSeed: ctx.entropy.bytes('seal.eph', 32), nonce: ctx.entropy.bytes('seal.nonce', 12) }, ctx.crypto.subtle);
export const signer = (ctx, label) => (b) => ctx.keys.sign(label, b);
export const signDoc = async (ctx, label, anchor, doc, at) => diSignWith(anchor, signer(ctx, label), doc, at, ctx.crypto.subtle);
export const draft = (s) => ({ digest: s.digest, envelope: s.envelope, type: s.type, threadId: s.threadId, recipient: s.recipient });
export async function sealed(ctx, doc, recipient) {
    return { digest: await digestDoc(doc, ctx.crypto.subtle), envelope: await sealWith(ctx, doc, recipient.keyAgreement), threadId: doc.threadId, type: doc.type, recipient };
}
/** The own key-agreement id a label derives under, from `addresses`. */
export const rkidOf = (state, label) => Object.entries(state.addresses.keys).find(([, k]) => k.label === label)?.[0];
/** The live active tuple toward a contact, with its relationship. */
export function channelTo(state, contactId) {
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
/** The arrival tuple's own label and the entry it feeds. */
export function arrival(state, rkid) {
    const at = tupleByRkid(state, rkid);
    return at ? { label: at.tuple.ownPairLabel, contactId: entryOf(state, at.rel)?.id ?? findContact(state, at.rel.contactId)?.id ?? at.rel.contactId, tuple: at.tuple, rel: at.rel } : null;
}
