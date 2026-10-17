// Probes for scripts/check-code-samples.mjs.
//   usage: node --test scripts/check-code-samples.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractSamples, failures } from './check-code-samples.mjs'

const PKG = '@real-life/' + 'trust-protocol'

test('TypeScript blocks that import the library are samples, with their first line', () => {
  const md = [
    'text',
    '```ts',
    `import { createHolder } from '${PKG}'`,
    'await createHolder(x)',
    '```',
    '```sh',
    `npm i ${PKG}`,
    '```',
    '```ts',
    'const unrelated = 1',
    '```',
    '```typescript',
    `import { InMemoryStore } from '${PKG}/testing'`,
    '```',
  ].join('\n')
  assert.deepEqual(extractSamples(md).map((s) => [s.line, s.code.split('\n')[0]]), [
    [3, `import { createHolder } from '${PKG}'`],
    [13, `import { InMemoryStore } from '${PKG}/testing'`],
  ])
})

test('a free placeholder is tolerated; a missing export, entry point or member is not', () => {
  const out = [
    's0.ts(9,22): error TS2304: Cannot find name \'envelope\'.',
    's0.ts(10,18): error TS18004: No value exists in scope for the shorthand property \'digest\'.',
    's0.ts(3,27): error TS2307: Cannot find module \'x/probe\' or its corresponding type declarations.',
    's1.ts(10,8): error TS2339: Property \'nosuch\' does not exist on type \'Holder\'.',
    '  continuation of the previous message',
  ].join('\n')
  assert.deepEqual(failures(out), [
    { sample: 0, line: 3, msg: 'TS2307: Cannot find module \'x/probe\' or its corresponding type declarations.' },
    { sample: 1, line: 10, msg: 'TS2339: Property \'nosuch\' does not exist on type \'Holder\'.' },
  ])
})
