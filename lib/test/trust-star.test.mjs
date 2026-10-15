#!/usr/bin/env node
// trust-star (lib Stage 2, PR 4b; Trust 5.1–5.2a, 5.4): star@2 on the
// holder — the root builders against the vectors, the reconciliation
// sweep on resume (view, baseline automaton, salt scope, chunking,
// completion by verified acks) and the reception of star/0.2 (assembly
// per (tuple, salt), repeats, lower salts, the resource limit, the
// accepted snapshot tested against every held anchor).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as C from '../dist/index.js'
import { starKeyOf, buildStarChunks } from '../dist/star.js'

const vec = (f) => JSON.parse(readFileSync(new URL('../../vectors/' + f, import.meta.url), 'utf8'))
const hex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)))

test('star: the root builder reproduces the star of vectors/visibility.json byte for byte', async () => {
  const V = vec('visibility.json')
  const IKM = hex(vec('identity-derivation.json').rootIkm)
  const A = await C.pairContext(IKM, hex(V.parties.A.relationshipNonce))
  const shared = await C.ecdh(A.x.priv, C.xRawOfMk(V.parties.B.keyAgreement))
  const k = await starKeyOf(shared, V.parties.A.anchor, V.parties.B.anchor, '1')
  const chunks = await buildStarChunks(k, '1', [V.starContact.anchor])
  assert.equal(chunks.length, 1)
  assert.equal(C.jcs(chunks[0]), C.jcs(V.artifacts.star))
})
