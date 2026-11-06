// access/genesis — the founding operation (Access 3.4.1) under linear/0.1:
// the body as the envelope schema closes it, the two signatures (group DID
// key and founder, 3225), and the complete validation procedure a genesis
// runs on its own (3215–3275). Stage 1 of the group log (rltp design,
// 2026-11): the content key the founding mints is committed (9710) and
// kept by the founder; it is distributed only with the key port.
import { jcs } from '../core.js'
import type { Json } from '../core.js'
import { digestBytes, platformSubtle } from '../crypto.js'
import { enclosedCardOk } from '../membership.js'
import { envelopeId, formProblem, genesisDigestOf, signEnvelope, type Envelope, type EnvelopeSigner, type Unsigned, ENVELOPE_V } from './envelope.js'

export const GENESIS_OP = 'group.genesis'
export const ADAPTER_LINEAR = 'linear/0.1'
/** the keyOpDigest of a linear/0.1 genesis: the multihash over JCS `[]` (9860) */
export const genesisKeyOpDigest = (subtle?: SubtleCrypto): Promise<string> => digestBytes(new TextEncoder().encode(jcs([])), subtle)
/** the commitment on the raw 32 content-key bytes (9710) */
export const contentKeyCommitment = (contentKey: Uint8Array, subtle?: SubtleCrypto): Promise<string> => {
  if (contentKey.length !== 32) throw new TypeError('linear/0.1: the content key is 32 bytes')
  return digestBytes(contentKey, subtle)
}

export interface GenesisInput {
  /** the group DID: a fresh Ed25519 key, retired after the signing (3060) */
  group: string
  /** the founder's anchor: a fresh context anchor for the founding act (3275) */
  founder: string
  /** the founder's displayed contact card at that anchor (3240) */
  card: Json
  /** the founder's derived service identity (3265; stage 1: DEVIATION D3) */
  serviceIdentity: string
  /** the epoch-0 content key, 32 bytes (9710) */
  contentKey: Uint8Array
  visibility?: 'private' | 'open'
}

/** The unsigned genesis: `epoch` 0, `policyVersion` 1, `prev` [] (3220); the
 *  policy without an explicit rule, so `member.add` falls to the default
 *  `any-member` (4.1), satisfiable by the founder alone (3245). */
export async function genesisUnsigned (input: GenesisInput, subtle?: SubtleCrypto): Promise<Unsigned> {
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
  }
}

/** The signed genesis: exactly the group key and the founder (3225). */
export async function signGenesis (unsigned: Unsigned, groupKey: EnvelopeSigner, founder: EnvelopeSigner, subtle?: SubtleCrypto): Promise<Envelope> {
  if (groupKey.signer !== unsigned.group || founder.signer !== unsigned.author) throw new TypeError('signGenesis: the signers are the group DID and the founder')
  return signEnvelope(unsigned, [groupKey, founder], subtle)
}

export type GenesisProblem = 'form' | 'op' | 'position' | 'signers' | 'group-is-founder' | 'members' | 'card' | 'policy' | 'author' | 'adapter' | 'commitment' | 'key-op-digest'

/** Genesis validation (3.4.1), complete and on its own. */
export async function genesisProblem (env: unknown, subtle: SubtleCrypto = platformSubtle()): Promise<GenesisProblem | null> {
  if (await formProblem(env, subtle) !== null) return 'form'
  const g = env as Envelope
  if (g.op !== GENESIS_OP) return 'op'
  if (g.prev.length !== 0 || g.epoch !== 0 || g.policyVersion !== 1) return 'position'
  const signers = (g.proof.signatures ?? []).map((s) => s.signer)
  if (g.proof.mechanism !== 'signature-set' || signers.length !== 2 || !signers.includes(g.group) || !signers.includes(g.author)) return 'signers'
  if (g.group === g.author) return 'group-is-founder'
  const b = g.body as { members: string[], card: Json, policy: { policyVersion: number, rules: Record<string, Json> }, adapter: string, keyOpDigest: string, contentKeyCommitment?: string }
  if (b.members.length !== 1 || b.members[0] !== g.author) return 'members'
  if (!(await enclosedCardOk(b.card, g.author, subtle))) return 'card'
  if (b.policy.policyVersion !== 1 || Object.keys(b.policy.rules).length !== 0) return 'policy'
  if (b.adapter !== ADAPTER_LINEAR) return 'adapter'
  if (b.keyOpDigest !== await genesisKeyOpDigest(subtle)) return 'key-op-digest'
  if (typeof b.contentKeyCommitment !== 'string') return 'commitment'
  return null
}

export { envelopeId, genesisDigestOf }
