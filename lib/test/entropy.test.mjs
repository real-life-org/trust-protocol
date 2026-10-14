#!/usr/bin/env node
// The Entropy port (lib Stage 2, PR 1): randomness by closed purpose,
// random by default, scripted per purpose for vectors and tests.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomEntropy, EntropyError, ENTROPY_PURPOSES } from '../dist/index.js'
import { scriptedEntropy } from '../dist/testing.js'

const u8 = (n, x) => new Uint8Array(n).fill(x)
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test('entropy: the purpose union is closed and has no star salt', () => {
  assert.deepEqual([...ENTROPY_PURPOSES].sort(), ['ack.id', 'challenge', 'doc.id', 'drop.nonce', 'env.nonce', 'founding.nonce', 'group.seed', 'pad', 'seal.eph', 'seal.nonce', 'thread.id'])
  assert.ok(!ENTROPY_PURPOSES.includes('star.salt'))
})

test('entropy: scripted values come back in order, per purpose', () => {
  const e = scriptedEntropy({ 'doc.id': ['a', 'b'], 'seal.nonce': [u8(12, 1), u8(12, 2)], 'thread.id': 't' })
  assert.equal(e.id('doc.id'), 'a')
  assert.deepEqual(e.bytes('seal.nonce', 12), u8(12, 1))
  assert.equal(e.id('thread.id'), 't')
  assert.equal(e.id('doc.id'), 'b')
  assert.deepEqual(e.bytes('seal.nonce', 12), u8(12, 2))
})

test('entropy: a purpose that runs dry throws a typed error naming it', () => {
  const e = scriptedEntropy({ 'doc.id': 'only' })
  e.id('doc.id')
  for (const fn of [() => e.id('doc.id'), () => e.bytes('seal.eph', 32)]) {
    try { fn(); assert.fail('did not throw') } catch (err) {
      assert.ok(err instanceof EntropyError)
      assert.equal(err.code, 'exhausted')
    }
  }
  try { e.id('doc.id') } catch (err) { assert.equal(err.purpose, 'doc.id') }
})

test('entropy: a scripted value of the wrong kind or length is refused', () => {
  const e = scriptedEntropy({ 'seal.nonce': [u8(11, 0)], 'doc.id': [u8(16, 0)], challenge: ['abc'] })
  for (const fn of [() => e.bytes('seal.nonce', 12), () => e.id('doc.id'), () => e.bytes('challenge', 17)]) {
    try { fn(); assert.fail('did not throw') } catch (err) { assert.ok(err instanceof EntropyError); assert.equal(err.code, 'mismatch') }
  }
})

test('entropy: scripted bytes are copies, both of the script and of the result', () => {
  const src = u8(4, 7)
  const e = scriptedEntropy({ pad: [src, src] })
  src[0] = 0
  const a = e.bytes('pad', 4)
  assert.deepEqual(a, u8(4, 7))
  a[1] = 0
  assert.deepEqual(e.bytes('pad', 4), u8(4, 7))
})

test('entropy: an unknown purpose is a programming error', () => {
  assert.throws(() => scriptedEntropy({ 'star.salt': ['x'] }), EntropyError)
  assert.throws(() => randomEntropy().bytes('star.salt', 4), EntropyError)
  assert.throws(() => randomEntropy().id('nope'), EntropyError)
})

test('entropy: random returns fresh buffers of the asked length', () => {
  const e = randomEntropy()
  for (const n of [0, 12, 32, 70000]) {
    const a = e.bytes('pad', n), b = e.bytes('pad', n)
    assert.ok(a instanceof Uint8Array)
    assert.equal(a.length, n)
    assert.notEqual(a.buffer, b.buffer)
    if (n >= 12) assert.notDeepEqual(a, b)
  }
  assert.throws(() => e.bytes('pad', -1), EntropyError)
  assert.throws(() => e.bytes('pad', 1.5), EntropyError)
})

test('entropy: random ids are lowercase UUIDv4 and fresh', () => {
  const e = randomEntropy()
  const a = e.id('doc.id'), b = e.id('thread.id')
  assert.match(a, UUID4)
  assert.match(b, UUID4)
  assert.notEqual(a, b)
})
