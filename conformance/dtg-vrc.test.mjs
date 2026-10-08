// Probes for conformance/dtg-vrc.mjs (informative foreign-VRC check).
//   usage: node --test conformance/dtg-vrc.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { checkVrc, dateTime } from './dtg-vrc.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const F = JSON.parse(readFileSync(join(HERE, '../vectors/dtg-vrc-foreign.json'), 'utf8'))
const positive = (name) => structuredClone(F.positive.find((p) => p.name === name).credential)

test('dateTime: RFC 3339 date-times with offsets and any fraction', () => {
  for (const t of ['2026-10-08T12:00:00Z', '2026-10-08T12:00:00+00:00', '2026-10-08T23:59:59-05:30', '2028-02-29T00:00:00Z',
    '2000-02-29T00:00:00Z', '2026-10-08T12:00:00.123456789Z', '2026-12-31T23:59:60Z']) assert.ok(dateTime(t), t)
})

test('dateTime: calendar-impossible or out-of-range components are rejected', () => {
  for (const t of ['2026-02-30T12:00:00Z', '2026-02-30T12:00:00+00:00', '2026-02-29T00:00:00Z', '1900-02-29T00:00:00Z',
    '2026-04-31T00:00:00Z', '2026-13-01T00:00:00Z', '2026-00-10T00:00:00Z', '2026-10-00T00:00:00Z', '2026-10-08T24:00:00Z',
    '2026-10-08T12:60:00Z', '2026-10-08T12:00:61Z', '2026-10-08T12:00:00+24:00', '2026-10-08T12:00:00+01:60',
    '2026-10-08T12:00:00', '2026-10-08 12:00:00Z', 20261008, undefined]) assert.equal(dateTime(t), null, String(t))
})

test('dateTime: the instant honours the offset', () => {
  assert.ok(dateTime('2026-10-08T12:00:00+02:00').ms < dateTime('2026-10-08T11:00:00Z').ms)
  assert.ok(dateTime('2026-10-08T12:00:00.0001Z').ms > dateTime('2026-10-08T12:00:00Z').ms)
})

test('checkVrc: an impossible validFrom day fails at validFrom, with Z and with an offset', () => {
  for (const v of ['2026-02-30T12:00:00Z', '2026-02-30T12:00:00+00:00']) {
    const c = positive('did-key-issuer-directed'); c.validFrom = v
    const r = checkVrc(c)
    assert.ok(r.failures.some((f) => f.check === 'validFrom'), v)
    assert.ok(!r.passed.includes('validFrom'), v)
    assert.ok(!r.notes.some((n) => /not a DTG requirement/.test(n)), `${v}: no note claiming calendar validity is not a DTG requirement`)
  }
})

test('checkVrc: an impossible validUntil day fails at validFrom', () => {
  const c = positive('did-key-issuer-directed'); c.validUntil = '2027-02-29T00:00:00Z'
  assert.ok(checkVrc(c).failures.some((f) => f.check === 'validFrom'))
})

test('checkVrc: more than three fractional digits is a note (RLTP profile), not a failure', () => {
  const c = positive('did-key-issuer-directed'); c.validFrom = '2026-10-08T12:00:00.1234Z'
  const r = checkVrc(c)
  assert.ok(r.passed.includes('validFrom'))
  assert.ok(r.notes.some((n) => /three fractional digits/.test(n)))
})

test('checkVrc: a proof @context longer than the document @context is a structured failure, not a throw', () => {
  const c = positive('did-key-issuer-directed'); c.proof['@context'].push('https://example.test/extra')
  const r = checkVrc(c)
  assert.equal(r.ok, false)
  assert.deepEqual(r.failures.map((f) => f.check), ['proof-signature'])
  assert.match(r.failures[0].detail, /prefix/)
})

test('CLI: a failing credential does not abort the batch; the next one is still checked', () => {
  const bad = positive('did-key-issuer-directed'); bad.proof['@context'].push('https://example.test/extra')
  const file = join(mkdtempSync(join(tmpdir(), 'dtg-vrc-')), 'batch.json')
  writeFileSync(file, JSON.stringify([bad, positive('did-peer-2-issuer-pairwise')]))
  const r = spawnSync(process.execPath, [join(HERE, 'dtg-vrc.mjs'), file], { encoding: 'utf8' })
  assert.equal(r.status, 1)
  assert.doesNotMatch(r.stderr, /at .*\.mjs:\d+/, 'no stack trace')
  assert.match(r.stderr, /FAIL {2}.*\[0\].*proof-signature/)
  assert.match(r.stdout, /ok {4}.*\[1\]/)
  assert.match(r.stdout, /1 credential\(s\) failed/)
})
