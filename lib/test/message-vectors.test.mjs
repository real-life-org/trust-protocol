#!/usr/bin/env node
// message-vectors (lib 0.5.0): the pure forms of message@1 (Message Tasks
// 0.1 §3, message.ts) against vectors/message.json — the directional key
// k_msg and its info string (3110), the MAC over JCS(body) (Trust 2.1),
// the negatives for direction, relationship and a tampered body (3110), the
// closed body and its bounds (3010, 3020, 3030), the calendar check
// (3030) and the all-zero shared secret (3120).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { labeledContext, ecdh, b64uOf, fromB64u } from '../dist/index.js'
import { MESSAGE_TYPE, MESSAGE_LIFETIME_MS, messageInfo, messageKeyOf, messageMac, messageProblem } from '../dist/message.js'

const J = (p) => JSON.parse(readFileSync(new URL('../../vectors/' + p, import.meta.url), 'utf8'))
const V = J('message.json')
const VIS = J('visibility.json')
const IKM = Buffer.from(J('identity-derivation.json').rootIkm, 'hex')
const ctx = (p) => labeledContext(IKM, p.label)
const u = (b) => 'u' + b64uOf(b)

test('message vector: the parties, the shared secret, the info string, k_msg, the preimage and the MAC (RLTP-MSG-3110)', async () => {
  const A = await ctx(V.inputs.sender), B = await ctx(V.inputs.recipient)
  assert.equal(A.anchor, V.inputs.sender.anchor); assert.equal(B.keyAgreement, V.inputs.recipient.keyAgreement)
  const shared = await ecdh(A.x.priv, B.x.pubRaw)
  assert.equal(u(shared), V.intermediate.sharedSecret)
  assert.equal(messageInfo(A.anchor, B.anchor), V.intermediate.info)
  const k = await messageKeyOf(shared, A.anchor, B.anchor)
  assert.equal(u(k), V.intermediate.kmsg)
  assert.equal(await messageMac(k, V.inputs.body), V.output.message.proof.mac)
  assert.equal(await messageProblem(V.output.message, k), null)
  assert.equal(MESSAGE_TYPE, 'https://real-life.org/trust-tasks/message/0.1')
  assert.equal(MESSAGE_LIFETIME_MS, 180 * 86_400_000, 'H = P180D')
})

test('message vector: every negative fails where it says — mac, schema, calendar, all-zero (RLTP-MSG-3010, 3020, 3030, 3110, 3120)', async () => {
  const A = await ctx(V.inputs.sender), B = await ctx(V.inputs.recipient)
  const k = await messageKeyOf(await ecdh(A.x.priv, B.x.pubRaw), A.anchor, B.anchor)
  for (const n of V.negatives) {
    if (n.name === 'wrong-direction' || n.name === 'wrong-relationship') {
      // the key of the other direction or relationship: its MAC is not the message's
      const [S, R] = n.sender ? [await ctx(VIS.parties[n.sender]), await ctx(VIS.parties[n.recipient])] : [B, A]
      const ks = await messageKeyOf(await ecdh(S.x.priv, R.x.pubRaw), S.anchor, R.anchor)
      assert.equal(messageInfo(S.anchor, R.anchor), n.info, n.name)
      assert.equal(await messageMac(ks, V.inputs.body), n.wrongMac, n.name)
      assert.equal(await messageProblem({ body: V.inputs.body, proof: { mac: n.wrongMac } }, k), 'mac', n.name)
      continue
    }
    if (n.name === 'low-order-recipient-key') {
      await assert.rejects(messageKeyOf(new Uint8Array(32), A.anchor, B.anchor), /all-zero/, n.name)
      assert.equal(n.expect, 'reject: all-zero')
      assert.equal(fromB64u(n.recipientKeyAgreementRaw.slice(1)).every((b) => b === 0), true)
      continue
    }
    assert.equal(await messageProblem(n.artifact, k), n.expect.slice('reject: '.length), n.name)
  }
})
