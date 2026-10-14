#!/usr/bin/env node
// jcs parity (review 4 B-1/B-3, review 7 B-4): the simulator's form layer
// (rltp-core.mjs, a shim over the frozen simulator/lib/core.js) refuses
// what RFC 8785 refuses and renders exactly like the library build it
// was frozen from. Moved here from lib/test (lib Stage 2, PR 1): the
// library's tests do not reach into the simulator. Needs lib/dist built
// (the CI library job builds it before running this).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as sim from '../rltp-core.mjs'
import { jcs } from '../../lib/dist/index.js'

test('jcs parity — both sides refuse lone surrogates and sparse arrays', () => {
  for (const [name, fn] of [['lib', jcs], ['sim', sim.jcs]]) {
    assert.throws(() => fn({ x: '\uD800' }), undefined, `${name}: lone surrogate value`)
    assert.throws(() => fn({ ['\uD800']: 1 }), undefined, `${name}: lone surrogate key`)
    assert.throws(() => fn({ a: Array(1) }), undefined, `${name}: sparse array`)
  }
})

test('jcs parity — non-JSON objects and non-values throw on both sides, none collides', () => {
  for (const [name, bad] of [['Date', new Date(0)], ['Map', new Map([['x', 1]])], ['Symbol', Symbol()], ['function', () => {}]]) {
    assert.throws(() => jcs({ v: bad }), undefined, `lib: ${name}`)
    assert.throws(() => sim.jcs({ v: bad }), undefined, `sim: ${name}`)
  }
  const withSym = { a: 1 }; withSym[Symbol('s')] = 2
  const arrX = [1]; arrX.x = 1
  for (const [name, fn] of [['lib', jcs], ['sim', sim.jcs]]) {
    assert.throws(() => fn(withSym), undefined, `${name}: symbol key`)
    assert.throws(() => fn({ a: arrX }), undefined, `${name}: array with own property`)
  }
})

test('jcs parity — hidden own properties never collide with the bare twin (review 7, B-4)', () => {
  const o = { a: 1 }; Object.defineProperty(o, 'hidden', { value: 1 })
  const arr = [1]; Object.defineProperty(arr, 'hidden', { value: 1 })
  for (const [name, fn] of [['lib', jcs], ['sim', sim.jcs]]) {
    assert.throws(() => fn(o), undefined, `${name}: non-enumerable object property`)
    assert.throws(() => fn({ a: arr }), undefined, `${name}: non-enumerable array property`)
  }
})

test('jcs parity — both sides render identically', () => {
  for (const v of [{ a: [1, '😀'] }, { b: { z: null, a: true }, n: -0.5 }, ['x', { 'é': 1 }]]) {
    assert.equal(sim.jcs(v), jcs(v))
  }
})
