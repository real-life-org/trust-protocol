// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// access/envelope — the operation envelope of Access 3.3 (rltp-access/0.25):
// its signing input, its self-addressing id (RLTP-ACC-3100), the signature
// set over exactly that input (3105), the sort of the proof (3110/3115),
// and the group identity as the digest over the genesis's signing input
// (3030). Pure over the envelope; the keys come in as signers.
import { b64uOf, jcs } from '../core.js';
import { base58, digestBytes, edRawOfAnchor, fromBase58, platformSubtle, sha } from '../crypto.js';
import { membershipSchemaOk } from '../membership.js';
export const ENVELOPE_V = 'rltp-access/0.25';
export const ENVELOPE_SCHEMA = 'access-operation-envelope.schema.json';
const te = new TextEncoder();
/** the JCS serialization with `id` empty and `proof` omitted (3100) */
export const signingInput = (env) => {
    const { proof: _p, id: _i, ...rest } = env;
    return te.encode(jcs({ ...rest, id: '' }));
};
/** `oid:` + unpadded base64url SHA-256 over the signing input (3100) */
export const envelopeId = async (env, subtle) => 'oid:' + b64uOf(await sha(signingInput(env), subtle));
/** the group identity: the multibase multihash over the genesis's signing input (3030) */
export const genesisDigestOf = (genesis, subtle) => digestBytes(signingInput(genesis), subtle);
/** unsigned bytewise order of DID strings (3110) */
export const bySigner = (a, b) => (a.signer < b.signer ? -1 : a.signer > b.signer ? 1 : 0);
/** signs the envelope's input with every signer, sorted per 3110; the id recomputed */
export async function signEnvelope(unsigned, signers, subtle) {
    const id = await envelopeId(unsigned, subtle);
    const input = signingInput(unsigned);
    const signatures = await Promise.all(signers.map(async (s) => ({ signer: s.signer, sig: 'z' + base58(await s.sign(input)) })));
    return { ...unsigned, id, proof: { mechanism: 'signature-set', signatures: signatures.sort(bySigner) } };
}
/** The form checks every replica runs before anything else (Replication 7.1
 *  step 1): schema, the id recomputes, the proof is sorted (3115), every
 *  signature verifies over the signing input under its signer (3105).
 *  Eligibility of the signers is a judgement at the operation's position
 *  (3130, 3315), not a form check. */
export async function formProblem(env, subtle = platformSubtle()) {
    if (!membershipSchemaOk(ENVELOPE_SCHEMA, env))
        return 'schema';
    const e = env;
    if (e.id !== await envelopeId(e, subtle))
        return 'id';
    const sigs = e.proof.signatures ?? [];
    for (let i = 1; i < sigs.length; i++)
        if (bySigner(sigs[i - 1], sigs[i]) >= 0)
            return 'proof-unsorted';
    const input = signingInput(e);
    for (const s of sigs) {
        const raw = edRawOfAnchor(s.signer);
        if (!raw)
            return 'signature';
        let ok = false;
        try {
            const pub = await subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']);
            const sig = fromBase58(s.sig.slice(1));
            ok = sig !== null && sig.length === 64 && await subtle.verify({ name: 'Ed25519' }, pub, sig, input);
        }
        catch {
            ok = false;
        }
        if (!ok)
            return 'signature';
    }
    return null;
}
/** The merged proof (3120–3140): one entry per signer, the first seen kept. */
export function mergeProof(held, arriving) {
    const seen = new Set((held.proof.signatures ?? []).map((s) => s.signer));
    const more = (arriving.proof.signatures ?? []).filter((s) => !seen.has(s.signer));
    if (more.length === 0)
        return held;
    return { ...held, proof: { ...held.proof, signatures: [...(held.proof.signatures ?? []), ...more].sort(bySigner) } };
}
export const asJson = (env) => env;
