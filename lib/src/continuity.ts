// continuity — continuity-probe@1 and continuity-mapping@1 (Trust Layer
// 0.31 §6a, tasks continuity-probe/0.1 and continuity-mapping/0.1): the
// pure wire constructions over raw X25519 shared secrets (lib Stage 2,
// PR 4c). The holder's trust module (trust/continuity.ts) builds and
// verifies through these with secrets from its KeyProvider. Byte-compatible
// with the continuity cases of vectors/visibility.json
// (test/trust-continuity.test.mjs).
//
//   k_p   = HKDF(X25519(newPairX_sender, newPairX_recipient),
//                "rltp/visibility/blind/probe/" || senderNewPair || "/" || recipientNewPair)       (6720)
//   entry = HMAC(k_p, ownPriorPairAnchor bytes)                                                     (6730)
//   chunk = { body: { type: "continuity-probe@1", probe, seq, last, blinded[256] },
//             proof: { mac: HMAC(k_p, JCS(body)) } }                                                (6670)
//   mac1  = HMAC(HKDF(X25519(priorPairX_sender, priorPairX_addressee), "rltp/visibility/mac/cont1"), JCS(body))
//   mac2  = HMAC(HKDF(X25519(newPairX_sender, newPairX_addressee), "rltp/visibility/mac/cont2"), JCS(body))   (6880)
//
// The entries are padded with random 32-byte values in the MAC encoding
// to the next multiple of 256 (an empty set to 256: one all-padding
// chunk), a padding value colliding with any other value resampled; the
// padded union is sorted once and sliced into 256-entry chunks, seq 1…n,
// exactly one last (6760–6780). Padding bytes come from the caller's
// `pad`, so vectors replay; this module draws none itself.
import { jcs, makeValidator, calOK } from './core.js'
import { SCHEMAS } from './schemas.js'
import { b64uOf, hkdf, platformSubtle } from './crypto.js'
import { macU } from './anchor.js'

const VAL = makeValidator(SCHEMAS)
const schemaOk = (file: string, data: unknown): boolean => VAL.validate(data, SCHEMAS[file]!, SCHEMAS[file]!).length === 0

/** Exactly this many entries per probe chunk (6670, 6760). */
export const PROBE_CHUNK = 256

export type ProbeChunk = { body: { type: 'continuity-probe@1', probe: string, seq: string, last: boolean, blinded: string[] }, proof: { mac: string } }
export type ContinuityMappingBody = { type: 'continuity-mapping@1', prior: string, next: string, to: string, revision: string, issuedAt: string }
export type ContinuityMapping = { body: ContinuityMappingBody, proof: { mac1: string, mac2: string } }

const nonZero = (shared: Uint8Array): void => {
  if (shared.every((b) => b === 0)) throw new Error('all-zero shared secret (Trust 6970)')
}

/** k_p of one direction from the new pair secret (6720). */
export async function probeKeyOf (shared: Uint8Array, sender: string, recipient: string, subtle: SubtleCrypto = platformSubtle()): Promise<Uint8Array> {
  nonZero(shared)
  return hkdf(shared, `rltp/visibility/blind/probe/${sender}/${recipient}`, 32, subtle)
}

/** One probe entry: HMAC(k_p, anchor) in its u form (6730, 6800). */
export const blindPrior = (k: Uint8Array, anchor: string, subtle?: SubtleCrypto): Promise<string> => macU(k, anchor, subtle)

/** A padding value: 32 random bytes in the MAC encoding (6760). */
export const padValue = (bytes: Uint8Array): string => {
  if (bytes.length !== 32) throw new RangeError('a probe padding value is 32 bytes')
  return 'u' + b64uOf(bytes)
}

/**
 * The chunks of one probe: the own prior pair anchors blinded under k_p,
 * padded to the next multiple of 256 by values from `pad` (each called
 * again where its value collides), sorted once, sliced by 256 (6730,
 * 6760–6780). `probe` is the probe sequence in its wire form (6680).
 */
export async function buildProbeChunks (k: Uint8Array, probe: string, priors: Iterable<string>, pad: () => Uint8Array, subtle: SubtleCrypto = platformSubtle()): Promise<ProbeChunk[]> {
  const entries: string[] = []
  for (const anchor of new Set(priors)) entries.push(await blindPrior(k, anchor, subtle))
  const used = new Set(entries)
  const total = Math.max(PROBE_CHUNK, Math.ceil(entries.length / PROBE_CHUNK) * PROBE_CHUNK)
  while (entries.length < total) {
    let v = padValue(pad())
    while (used.has(v)) v = padValue(pad())
    used.add(v)
    entries.push(v)
  }
  entries.sort()
  const chunks: ProbeChunk[] = []
  for (let i = 0; i * PROBE_CHUNK < entries.length; i++) {
    const body = { type: 'continuity-probe@1' as const, probe, seq: String(i + 1), last: (i + 1) * PROBE_CHUNK >= entries.length, blinded: entries.slice(i * PROBE_CHUNK, (i + 1) * PROBE_CHUNK) }
    chunks.push({ body, proof: { mac: await macU(k, jcs(body), subtle) } })
  }
  return chunks
}

/** Is this a schema-valid continuity-probe@1 chunk (exactly 256 unique entries)? */
export const probeChunkOk = (chunk: unknown): boolean => schemaOk('visibility-continuity-probe.schema.json', chunk)

/** Does the chunk's MAC verify under k_p? */
export async function probeChunkMacOk (k: Uint8Array, chunk: ProbeChunk, subtle?: SubtleCrypto): Promise<boolean> {
  return (await macU(k, jcs(chunk.body), subtle)) === chunk.proof.mac
}

/** The two MAC keys of a continuity mapping (6880): mac1 under the prior
 *  relationship secret, mac2 under the new one. */
export async function continuityMacKeys (sharedPrior: Uint8Array, sharedNew: Uint8Array, subtle?: SubtleCrypto): Promise<{ k1: Uint8Array, k2: Uint8Array }> {
  nonZero(sharedPrior); nonZero(sharedNew)
  return { k1: await hkdf(sharedPrior, 'rltp/visibility/mac/cont1', 32, subtle), k2: await hkdf(sharedNew, 'rltp/visibility/mac/cont2', 32, subtle) }
}

/** continuity-mapping@1 over its body (6880): the sender's prior and new
 *  pair secrets toward the addressee. */
export async function assembleContinuityMapping (body: ContinuityMappingBody, sharedPrior: Uint8Array, sharedNew: Uint8Array, subtle?: SubtleCrypto): Promise<ContinuityMapping> {
  const { k1, k2 } = await continuityMacKeys(sharedPrior, sharedNew, subtle)
  const msg = jcs(body)
  return { body, proof: { mac1: await macU(k1, msg, subtle), mac2: await macU(k2, msg, subtle) } }
}

/** Do both MACs verify (6970 step 5), under the receiver's prior and new
 *  pair secrets toward the sender? */
export async function continuityMacsOk (m: ContinuityMapping, sharedPrior: Uint8Array, sharedNew: Uint8Array, subtle?: SubtleCrypto): Promise<boolean> {
  const { k1, k2 } = await continuityMacKeys(sharedPrior, sharedNew, subtle)
  const msg = jcs(m.body)
  return (await macU(k1, msg, subtle)) === m.proof.mac1 && (await macU(k2, msg, subtle)) === m.proof.mac2
}

/** Step 1 of 6940: the schema and a calendar-valid issuedAt. */
export const continuityMappingOk = (m: unknown): boolean =>
  schemaOk('visibility-continuity-mapping.schema.json', m) && calOK((m as ContinuityMapping).body.issuedAt)

/** 2290: the record side of a fresh tuple is the party whose new pair
 *  anchor is the smaller by byte order (did:key strings are ASCII). */
export const isRecordSide = (ownNew: string, counterpartNew: string): boolean => ownNew < counterpartNew
