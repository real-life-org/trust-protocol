// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// access/genesis — the founding operation (Access 3.4.1) under linear/0.1:
// the body as the envelope schema closes it, the two signatures (group DID
// key and founder, 3225), and the complete validation procedure a genesis
// runs on its own (3215–3275). Stage 1 of the group log (rltp design,
// 2026-11): the content key the founding mints is committed (9710) and
// kept by the founder; it is distributed only with the key port.
import { jcs } from '../core.js';
import { digestBytes, platformSubtle } from '../crypto.js';
import { enclosedCardOk } from '../membership.js';
import { envelopeId, formProblem, genesisDigestOf, signEnvelope, ENVELOPE_V } from './envelope.js';
export const GENESIS_OP = 'group.genesis';
export const ADAPTER_LINEAR = 'linear/0.1';
/** the keyOpDigest of a linear/0.1 genesis: the multihash over JCS `[]` (9860) */
export const genesisKeyOpDigest = (subtle) => digestBytes(new TextEncoder().encode(jcs([])), subtle);
/** the commitment on the raw 32 content-key bytes (9710) */
export const contentKeyCommitment = (contentKey, subtle) => {
    if (contentKey.length !== 32)
        throw new TypeError('linear/0.1: the content key is 32 bytes');
    return digestBytes(contentKey, subtle);
};
/** The unsigned genesis: `epoch` 0, `policyVersion` 1, `prev` [] (3220); the
 *  policy without an explicit rule, so `member.add` falls to the default
 *  `any-member` (4.1), satisfiable by the founder alone (3245). */
export async function genesisUnsigned(input, subtle) {
    return {
        v: ENVELOPE_V, op: GENESIS_OP, group: input.group, epoch: 0, policyVersion: 1, prev: [],
        body: {
            members: [input.founder],
            card: input.card,
            policy: { policyVersion: 1, rules: {} },
            visibility: input.visibility ?? 'private',
            adapter: ADAPTER_LINEAR,
            serviceIdentity: input.serviceIdentity,
            keyOpDigest: await genesisKeyOpDigest(subtle),
            contentKeyCommitment: await contentKeyCommitment(input.contentKey, subtle),
        },
        author: input.founder,
    };
}
/** The signed genesis: exactly the group key and the founder (3225). */
export async function signGenesis(unsigned, groupKey, founder, subtle) {
    if (groupKey.signer !== unsigned.group || founder.signer !== unsigned.author)
        throw new TypeError('signGenesis: the signers are the group DID and the founder');
    return signEnvelope(unsigned, [groupKey, founder], subtle);
}
/** Genesis validation (3.4.1), complete and on its own. */
export async function genesisProblem(env, subtle = platformSubtle()) {
    if (await formProblem(env, subtle) !== null)
        return 'form';
    const g = env;
    if (g.op !== GENESIS_OP)
        return 'op';
    if (g.prev.length !== 0 || g.epoch !== 0 || g.policyVersion !== 1)
        return 'position';
    const signers = (g.proof.signatures ?? []).map((s) => s.signer);
    if (g.proof.mechanism !== 'signature-set' || signers.length !== 2 || !signers.includes(g.group) || !signers.includes(g.author))
        return 'signers';
    if (g.group === g.author)
        return 'group-is-founder';
    const b = g.body;
    if (b.members.length !== 1 || b.members[0] !== g.author)
        return 'members';
    if (!(await enclosedCardOk(b.card, g.author, subtle)))
        return 'card';
    if (b.policy.policyVersion !== 1 || Object.keys(b.policy.rules).length !== 0)
        return 'policy';
    if (b.adapter !== ADAPTER_LINEAR)
        return 'adapter';
    if (b.keyOpDigest !== await genesisKeyOpDigest(subtle))
        return 'key-op-digest';
    if (typeof b.contentKeyCommitment !== 'string')
        return 'commitment';
    return null;
}
export { envelopeId, genesisDigestOf };
