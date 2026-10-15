// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// log-memory — an in-memory Log port (lib Stage 2, note §3 Log; ./testing):
// one replica of a personal community's lineage of `anchor.rotate`
// entries (Access §5.6), for tests and simulators. Not a log of Access
// operations: an entry is the anchor.rotate body `{rotation}` alone; the
// operation envelope, its author (the founder's pair anchor) and the
// materialization's walk are the Access port's, which graduates later.
//
// What it does:
//   head()                 {genesis, empty} or the last entry: its id (the
//                          document digest of the entry), the generation it
//                          introduced (entries + 1: the first entry leaves
//                          generation 1, RLTP-ACC-5980), its next and commit
//   append(entry, over)    idempotent over the rotation body: a
//                          JCS-identical body already held is `exists`
//                          (RLTP-ACC-5965: one entry); `over` must name the
//                          current head (null: empty), else head-conflict;
//                          the rotation must verify under both signatures
//                          (5956) and continue the head: prev = head.next,
//                          next meets head.commit (5958, 5960), else failure
//   entries(), syncFrom()  for tests: a copy of the entries, and catching up
//                          from another replica (the device's encrypted state
//                          synchronized, Identity §5.4) up to `upTo` entries
import { jcs } from './core.js';
import { digestDoc } from './crypto.js';
import { meetsBinding, verifyAnchorRotation } from './anchor.js';
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
        async append(entry, overHead) {
            const body = bodyOf(entry);
            if (body === null || Object.keys(entry).length !== 1)
                return { status: 'failure', reason: 'not an anchor.rotate body {rotation} (RLTP-ACC-5955)' };
            if (held.some((h) => jcs(h.entry.rotation.body) === jcs(body)))
                return { status: 'exists', head: headOf() };
            const cur = held.length ? held[held.length - 1] : null;
            if (overHead !== (cur?.id ?? null))
                return { status: 'head-conflict', head: headOf() };
            if (!(await verifyAnchorRotation(entry.rotation)))
                return { status: 'failure', reason: 'the rotation does not verify (RLTP-ACC-5956)' };
            if (cur && (body.prev !== cur.entry.rotation.body.next || !(await meetsBinding(body.next, cur.entry.rotation.body.commit)))) {
                return { status: 'failure', reason: 'the rotation does not continue the lineage head (RLTP-ACC-5958, 5960)' };
            }
            held.push({ id: await digestDoc(entry), entry: structuredClone(entry) });
            return { status: 'appended', head: headOf() };
        },
        entries: () => held.map((h) => structuredClone(h.entry)),
        async syncFrom(other, upTo) {
            if (other.genesis !== genesis)
                throw new Error('memoryLog: another personal community');
            const theirs = other.entries().slice(0, upTo);
            for (let i = 0; i < theirs.length; i++) {
                const id = await digestDoc(theirs[i]);
                if (i < held.length) {
                    if (held[i].id !== id)
                        throw new Error('memoryLog: the replicas diverge');
                    continue;
                }
                held.push({ id, entry: structuredClone(theirs[i]) });
            }
        },
    };
    return Object.freeze(log);
}
