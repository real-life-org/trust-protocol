#!/usr/bin/env node
// Generates vectors/vti-delivery-hints.json — the delivery hint of the VTI
// mediator adapter profile 0.25 (§1b): for two sides A and B of one
// relationship at one carrier C, the wire identities each side derives
// from (root, C, N), the hint each places in its card (the JCS form of a
// TSPTransport service entry), its length against RLTP-ENC-6090, a
// displayed card of B and A's sent card answering it, each carrying its
// side's hint under its proof, a card whose hint exceeds 512 characters,
// the hints a receiver ignores and the hint lists of a card a receiver
// reads, each with the rule it applies. The hints are built and read by
// the library's adapter module (deliveryHint, readDeliveryHints).
// Deterministic: sides A and B are those of vectors/vti-routed-addressing.json
// (side A the adapterScopedIdentities case of vectors/identity-derivation.json).
//
//   usage: node scripts/gen-vti-delivery-hints-vector.mjs [--check]   (from repo root;
//          requires lib/dist — build the library first)
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')
const OUT = join(ROOT, 'vectors/vti-delivery-hints.json')
const { carrierScopedIdentity } = await import(join(ROOT, 'lib/dist/carrier-identity.js'))
const { jcs, iso } = await import(join(ROOT, 'lib/dist/core.js'))
const { labeledContext } = await import(join(ROOT, 'lib/dist/identity.js'))
const { diSign, digestBytes } = await import(join(ROOT, 'lib/dist/crypto.js'))
const { cardBody, cardOk } = await import(join(ROOT, 'lib/dist/encounter.js'))
const { deliveryHint, readDeliveryHint, readDeliveryHints } = await import(join(ROOT, 'lib/dist/adapters/vti-mediator.js'))

const ID = JSON.parse(readFileSync(join(ROOT, 'vectors/identity-derivation.json'), 'utf8'))
const ROUTED = JSON.parse(readFileSync(join(ROOT, 'vectors/vti-routed-addressing.json'), 'utf8'))
const hexToBytes = (h) => Uint8Array.from(h.match(/../g).map((b) => parseInt(b, 16)))
const label = (s) => new Uint8Array(createHash('sha256').update(s, 'ascii').digest())
const C = ID.adapterScopedIdentities.carrier

async function side (rootIkm, nonce) {
  const connection = (await carrierScopedIdentity(rootIkm, C, nonce, 'connection')).did
  const egress = (await carrierScopedIdentity(rootIkm, C, nonce, 'egress')).did
  return { connection, egress }
}

const rootA = hexToBytes(ID.rootIkm)
const nonceA = hexToBytes(ID.carrierRelationship.relationshipNonce)
const rootB = label('rltp/vector/vti-routed/root-B')
const nonceB = label('rltp/vector/vti-routed/nonce-B')
const A = await side(rootA, nonceA)
const B = await side(rootB, nonceB)
if (jcs(A) !== jcs(ROUTED.sides.A) || jcs(B) !== jcs(ROUTED.sides.B)) throw new Error('the sides do not reproduce vectors/vti-routed-addressing.json')

/** The service entry of RLTP-VTI-1210, for the negative cases. */
const entry = (s, carrier = C) => ({ id: s.connection + '#tsp', type: 'TSPTransport', serviceEndpoint: carrier, rltpEgress: s.egress })
const hints = { A: await deliveryHint(rootA, C, nonceA), B: await deliveryHint(rootB, C, nonceB) }
if (hints.A !== jcs(entry(A)) || hints.B !== jcs(entry(B))) throw new Error('deliveryHint is not the JCS form of the service entry')
for (const h of Object.values(hints)) if ([...h].length > 512) throw new Error('a hint longer than 512 characters (RLTP-ENC-6090)')

// B's displayed card carrying its hint: a pair context of B's root under a fixed pair nonce
const pairB = await labeledContext(rootB, 'pair/' + await digestBytes(label('rltp/vector/vti-delivery-hints/pair-B')))
const at = iso(Date.parse('2026-10-23T10:00:00Z'))
const challenge = { value: 'vtiDeliveryHintsB00000', issuedAt: at }
const card = await diSign(pairB, cardBody(pairB, { name: 'Bea', challenge, deliveryHints: [hints.B] }), at)
// A's sent card answering it (Encounter 5.8): sentTo B's anchor, boundTo B's challenge
const pairA = await labeledContext(rootA, 'pair/' + await digestBytes(label('rltp/vector/vti-delivery-hints/pair-A')))
const atA = iso(Date.parse('2026-10-23T10:00:01Z'))
const sentCard = await diSign(pairA, cardBody(pairA, { name: 'Al', challenge: { value: 'vtiDeliveryHintsA00000', issuedAt: atA }, deliveryHints: [hints.A], sentTo: card.anchor, boundTo: challenge.value }), atA)
for (const [n, c] of [['card', card], ['sentCard', sentCard]]) {
  const why = await cardOk(c)
  if (why !== null) throw new Error(`the vector ${n} does not verify: ${why}`)
}
// a card whose one hint has 513 characters: it fails the card schema (RLTP-ENC-6090)
const longCard = await diSign(pairB, cardBody(pairB, { challenge: { value: 'vtiDeliveryHintsBlong0', issuedAt: at }, deliveryHints: ['h'.repeat(513)] }), at)
if (!/schema/.test(await cardOk(longCard) ?? '')) throw new Error('the long card passes the card schema')

// what a receiver ignores (RLTP-VTI-1210, 1220, 1225), seen from A at C
const e = entry(B)
const ignored = [
  { case: 'not JSON', hint: 'tsp:' + B.connection, rules: ['RLTP-VTI-1220'] },
  { case: 'not the JCS form: members out of order', hint: JSON.stringify({ type: e.type, id: e.id, serviceEndpoint: e.serviceEndpoint, rltpEgress: e.rltpEgress }), rules: ['RLTP-VTI-1220'] },
  { case: 'not the JCS form: whitespace', hint: JSON.stringify(JSON.parse(hints.B), null, 1), rules: ['RLTP-VTI-1220'] },
  { case: 'an extra member', hint: jcs({ ...e, routingKeys: [] }), rules: ['RLTP-VTI-1210'] },
  { case: 'no egress identity', hint: jcs({ id: e.id, type: e.type, serviceEndpoint: e.serviceEndpoint }), rules: ['RLTP-VTI-1210'] },
  { case: 'another type', hint: jcs({ ...e, type: 'DIDCommMessaging' }), rules: ['RLTP-VTI-1210'] },
  { case: 'id without the #tsp fragment', hint: jcs({ ...e, id: B.connection }), rules: ['RLTP-VTI-1210'] },
  { case: 'connection DID that is no Ed25519 did:key', hint: jcs({ ...e, id: 'did:web:example.org#tsp' }), rules: ['RLTP-VTI-1210'] },
  // the pattern did:key:z6Mk + 44 base58 characters is necessary, not sufficient: these decode to another multicodec
  { case: 'connection DID of the did:key pattern that does not decode to 0xed01 and 32 bytes', hint: jcs({ ...e, id: 'did:key:z6Mk' + '1'.repeat(44) + '#tsp' }), rules: ['RLTP-VTI-1210'] },
  { case: 'egress identity of the did:key pattern that does not decode to 0xed01 and 32 bytes', hint: jcs({ ...e, rltpEgress: 'did:key:z6Mk' + 'z'.repeat(44) }), rules: ['RLTP-VTI-1210'] },
  { case: 'egress identity equal to the connection DID', hint: jcs({ ...e, rltpEgress: B.connection }), rules: ['RLTP-VTI-1210'] },
  { case: 'another carrier: serviceEndpoint is not C', hint: jcs(entry(B, 'did:web:mediator.example.org')), rules: ['RLTP-VTI-1225'] },
]
for (const c of ignored) if (readDeliveryHint(c.hint, C) !== null) throw new Error(`${c.case}: the library reads it`)

// the hint list of a card, read at C (RLTP-VTI-1225): exactly one hint of this profile for C
const lists = [
  { case: 'one hint for C', hints: [hints.B], expect: 'B', rules: ['RLTP-VTI-1225', 'RLTP-VTI-1240'] },
  { case: 'a hint for another carrier beside the hint for C', hints: [jcs(entry(B, 'did:web:mediator.example.org')), hints.B], expect: 'B', rules: ['RLTP-VTI-1225'] },
  { case: 'an unreadable hint beside the hint for C', hints: ['tsp:' + B.connection, hints.B], expect: 'B', rules: ['RLTP-VTI-1220', 'RLTP-VTI-1225'] },
  { case: 'two hints for C', hints: [hints.B, await deliveryHint(rootB, C, label('rltp/vector/vti-delivery-hints/nonce-B2'))], expect: null, rules: ['RLTP-VTI-1225'] },
  { case: 'no hint for C', hints: [jcs(entry(B, 'did:web:mediator.example.org'))], expect: null, rules: ['RLTP-VTI-1225', 'RLTP-VTI-1235'] },
  { case: 'no hints', hints: [], expect: null, rules: ['RLTP-VTI-1235'] },
]
for (const c of lists) {
  const got = readDeliveryHints(c.hints, C)
  const want = c.expect === null ? null : { connectionDid: ({ A, B })[c.expect].connection, egressDid: ({ A, B })[c.expect].egress, carrier: C }
  if (jcs(got) !== jcs(want)) throw new Error(`${c.case}: the library reads ${jcs(got)}`)
}

const vector = {
  description: 'VTI mediator adapter profile 0.25 (§1b): the delivery hint each side of one relationship places in its card for carrier C — the JCS form (RFC 8785) of a TSPTransport service entry naming its connection DID (id, with #tsp), C (serviceEndpoint) and its egress identity (rltpEgress) — its length in characters (RLTP-ENC-6090: at most 512), a displayed card of B and A\'s sent card answering it, each carrying its side\'s hint under the card\'s proof, a card whose hint exceeds 512 characters (fails the card schema), the hints a receiver at C ignores, and the hint lists of a card with what a receiver at C reads from them (exactly one hint for C, RLTP-VTI-1225). Identities are did:key from the lib derivation (carrierScopedIdentity over root, C and the carrier nonce N).',
  source: 'sides A and B as in vectors/vti-routed-addressing.json: side A = adapterScopedIdentities of vectors/identity-derivation.json (rootIkm, carrierRelationship.relationshipNonce as N); side B: rootIkm = sha2-256("rltp/vector/vti-routed/root-B"), N = sha2-256("rltp/vector/vti-routed/nonce-B"); the cards: B\'s and A\'s pair contexts under the pair nonces sha2-256("rltp/vector/vti-delivery-hints/pair-B") and sha2-256("rltp/vector/vti-delivery-hints/pair-A"); B2 (two hints for C): B\'s root under N = sha2-256("rltp/vector/vti-delivery-hints/nonce-B2"); ASCII labels. Generated by scripts/gen-vti-delivery-hints-vector.mjs.',
  carrier: C,
  sides: { A, B },
  hints,
  hintLength: { A: [...hints.A].length, B: [...hints.B].length },
  card,
  sentCard,
  tooLong: { card: longCard, rules: ['RLTP-ENC-6090'] },
  ignored,
  lists,
}

// every rule a case names is a rule of the profile
const manifest = new Set(readFileSync(join(ROOT, 'conformance/adapter-vti-rule-ids-0.25.txt'), 'utf8').split('\n').filter((l) => /^RLTP-VTI-/.test(l)))
for (const c of [...ignored, ...lists]) for (const id of c.rules) if (!manifest.has(id)) throw new Error(`${c.case}: ${id} is not in the rule manifest`)

const text = JSON.stringify(vector, null, 1) + '\n'
if (CHECK) {
  const have = readFileSync(OUT, 'utf8')
  if (have !== text) { console.error('vectors/vti-delivery-hints.json differs from its generator'); process.exit(1) }
  console.log('vti-delivery-hints: reproduced byte for byte')
} else {
  writeFileSync(OUT, text)
  console.log(`wrote ${OUT}`)
}
