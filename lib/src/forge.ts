// forge — test tools for the deniability of the designated-verifier forms
// (Trust 6.1): what the addressee itself can build. Exported from
// ./testing only.
import { ecdh, xRawOfMk } from './crypto.js'
import type { Context } from './identity.js'
import { assembleAnchorMapping } from './anchor.js'

export interface ForgeMappingInput {
  /** the addressee's own pair context of the relationship */
  own: Context
  /** the counterparty's pair anchor and key agreement on that relationship */
  pair: string
  pairKeyAgreement: string
  /** a self card the addressee holds (another contact disclosed it) */
  card: { body: { anchor: string, keyAgreement: string } }
  revision?: string
  issuedAt: string
  lineage?: unknown[]
}

/**
 * An anchor-mapping@4 that maps the counterparty's pair anchor to the self
 * anchor of `card`, built by the addressee alone: both MACs are keyed by
 * secrets the addressee shares (X25519 with the pair key and with the
 * card's key), so it verifies exactly like one the counterparty issued —
 * a leaked mapping proves nothing to a third party.
 */
export async function forgeMapping (i: ForgeMappingInput, subtle?: SubtleCrypto) {
  const theirs = xRawOfMk(i.pairKeyAgreement), cards = xRawOfMk(i.card.body.keyAgreement)
  if (!theirs || !cards) throw new Error('forgeMapping: key agreement is not a multikey')
  const body = { type: 'anchor-mapping@4', pair: i.pair, self: i.card.body.anchor, to: i.own.anchor, card: i.card, lineage: i.lineage ?? [], revision: i.revision ?? '1', issuedAt: i.issuedAt }
  return assembleAnchorMapping(body, await ecdh(i.own.x.priv, theirs, subtle), await ecdh(i.own.x.priv, cards, subtle), subtle)
}
