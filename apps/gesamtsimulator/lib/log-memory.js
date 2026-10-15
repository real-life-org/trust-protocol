// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// log-memory — an in-memory Log port (lib Stage 2, note §3 Log; ./testing):
// one replica of a personal community's lineage of `anchor.rotate`
// entries (Access §5.6), for tests and simulators. Not a log of Access
// operations: an entry is the anchor.rotate body `{rotation}` alone; the
// operation envelope, its author (the founder's pair anchor), the sole-
// member check, the ancestor closure and the canonical walk of forks are
// the Access port's, which graduates later. One instance shared by two
// holders is one log two devices write to.
//
// What it does:
//   head()                 {genesis, empty} or the last entry: its id (the
//                          document digest of the entry), the generation it
//                          introduced (entries + 1: the first entry leaves
//                          generation 1, RLTP-ACC-5980), its next and commit
//   at(gen)                the entry that introduced generation gen, or null
//   append(entry, over)    idempotent over exactly (entry, over): the same
//                          closure again is `exists`; the same entry over
//                          another head is head-conflict (RLTP-ACC-5965: one
//                          entry); `over` must name the current head (null:
//                          empty), else head-conflict; the rotation must
//                          verify under both signatures (5956) and continue
//                          the head: prev = head.next, next meets head.commit
//                          (5958, 5960), else failure. Atomic: every await
//                          (digest, signatures, binding) runs first, then
//                          idempotence, head and continuation are checked
//                          and the entry inserted in one synchronous step
//   entries(), syncFrom()  for tests: a copy of the entries, and catching up
//                          from another replica (the device's encrypted state
//                          synchronized, Identity §5.4) up to `upTo` entries
import { jcs } from './core.js';
import { digestDoc } from './crypto.js';
import { bindingOf, verifyAnchorRotation } from './anchor.js';
const bodyOf = (entry) => {
    const r = entry?.rotation;
    const b = r?.body;
    return b && typeof b.prev === 'string' && typeof b.next === 'string' && typeof b.commit === 'string' ? b : null;
};
/** An in-memory replica of the personal community `genesis`'s lineage log. */
export function memoryLog(genesis) {
    const held = [];
    const headOf = () => {
        if (!held.length)
            return { genesis, empty: true };
        const last = held[held.length - 1];
        return { genesis, entryId: last.id, gen: held.length + 1, next: last.entry.rotation.body.next, commit: last.entry.rotation.body.commit };
    };
    const log = {
        genesis,
        async head() { return headOf(); },
        async at(gen) {
            const h = Number.isSafeInteger(gen) && gen >= 2 ? held[gen - 2] : undefined;
            return h ? { entryId: h.id, next: h.entry.rotation.body.next, commit: h.entry.rotation.body.commit } : null;
        },
        async append(entry, overHead) {
            const body = bodyOf(entry);
            if (body === null || Object.keys(entry).length !== 1)
                return { status: 'failure', reason: 'not an anchor.rotate body {rotation} (RLTP-ACC-5955)' };
            // every await first
            const id = await digestDoc(entry);
            const verified = await verifyAnchorRotation(entry.rotation);
            let nextBinding = null;
            try {
                nextBinding = await bindingOf(body.next);
            }
            catch {
                nextBinding = null;
            }
            // then one synchronous step: idempotence, head, continuation, insert
            const same = held.find((h) => jcs(h.entry.rotation.body) === jcs(body));
            if (same)
                return same.id === id && same.over === overHead ? { status: 'exists', head: headOf() } : { status: 'head-conflict', head: headOf() };
            const cur = held.length ? held[held.length - 1] : null;
            if (overHead !== (cur?.id ?? null))
                return { status: 'head-conflict', head: headOf() };
            if (!verified)
                return { status: 'failure', reason: 'the rotation does not verify (RLTP-ACC-5956)' };
            if (cur && (body.prev !== cur.entry.rotation.body.next || nextBinding !== cur.entry.rotation.body.commit)) {
                return { status: 'failure', reason: 'the rotation does not continue the lineage head (RLTP-ACC-5958, 5960)' };
            }
            held.push({ id, entry: structuredClone(entry), over: overHead });
            return { status: 'appended', head: headOf() };
        },
        entries: () => held.map((h) => structuredClone(h.entry)),
        async syncFrom(other, upTo) {
            if (other.genesis !== genesis)
                throw new Error('memoryLog: another personal community');
            const theirs = other.entries().slice(0, upTo);
            const ids = await Promise.all(theirs.map((e) => digestDoc(e)));
            for (let i = 0; i < theirs.length; i++) {
                if (i < held.length) {
                    if (held[i].id !== ids[i])
                        throw new Error('memoryLog: the replicas diverge');
                    continue;
                }
                held.push({ id: ids[i], entry: structuredClone(theirs[i]), over: i ? ids[i - 1] : null });
            }
        },
    };
    return Object.freeze(log);
}
