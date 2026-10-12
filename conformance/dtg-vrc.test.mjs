// Probes for conformance/dtg-vrc.mjs (informative foreign-VRC check).
//   usage: node --test conformance/dtg-vrc.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { checkVrc, dateTime, cmpInstant, resolveVm } from './dtg-vrc.mjs'
import { b58, privEd, privX, pubRaw, didOf } from './lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const F = JSON.parse(readFileSync(join(HERE, '../vectors/dtg-vrc-foreign.json'), 'utf8'))
const positive = (name) => structuredClone(F.positive.find((p) => p.name === name).credential)

test('dateTime: RFC 3339 date-times with offsets and any fraction', () => {
  for (const t of ['2026-10-08T12:00:00Z', '2026-10-08T12:00:00+00:00', '2026-10-08T23:59:59-05:30', '2028-02-29T00:00:00Z',
    '2000-02-29T00:00:00Z', '2026-10-08T12:00:00.123456789Z', '2016-12-31T23:59:60Z', '2016-12-31T15:59:60-08:00',
    '2017-01-01T05:29:60+05:30']) assert.ok(dateTime(t), t)
})

test('dateTime: calendar-impossible or out-of-range components are rejected', () => {
  for (const t of ['2026-02-30T12:00:00Z', '2026-02-30T12:00:00+00:00', '2026-02-29T00:00:00Z', '1900-02-29T00:00:00Z',
    '2026-04-31T00:00:00Z', '2026-13-01T00:00:00Z', '2026-00-10T00:00:00Z', '2026-10-00T00:00:00Z', '2026-10-08T24:00:00Z',
    '2026-10-08T12:60:00Z', '2026-10-08T12:00:61Z', '2026-10-08T12:00:00+24:00', '2026-10-08T12:00:00+01:60',
    '2026-10-08T12:00:00', '2026-10-08 12:00:00Z', 20261008, undefined]) assert.equal(dateTime(t), null, String(t))
})

test('dateTime: second 60 only where it is 23:59:60 in UTC after the offset (RFC 3339 §5.7)', () => {
  for (const t of ['2026-10-08T12:00:60Z', '2016-12-31T23:58:60Z', '2016-12-31T22:59:60Z', '2016-12-31T23:59:60+01:00',
    '2016-12-31T15:59:60-07:00']) assert.equal(dateTime(t), null, t)
})

test('dateTime: the instant honours the offset, the leap second and any fraction exactly', () => {
  const lt = (a, b) => assert.ok(cmpInstant(dateTime(a), dateTime(b)) < 0, `${a} < ${b}`)
  const eq = (a, b) => assert.equal(cmpInstant(dateTime(a), dateTime(b)), 0, `${a} = ${b}`)
  lt('2026-10-08T12:00:00+02:00', '2026-10-08T11:00:00Z')
  lt('2026-10-08T12:00:00Z', '2026-10-08T12:00:00.0001Z')
  lt('2026-10-08T12:00:00.000000001Z', '2026-10-08T12:00:00.000000002Z')
  lt('2016-12-31T23:59:59.999999999Z', '2016-12-31T23:59:60Z')
  lt('2016-12-31T23:59:60.999999999Z', '2017-01-01T00:00:00Z')
  lt('2016-12-31T15:59:60-08:00', '2017-01-01T00:00:00Z')
  eq('2016-12-31T23:59:60Z', '2016-12-31T15:59:60-08:00')
  eq('2026-10-08T12:00:00.5Z', '2026-10-08T12:00:00.500Z')
  eq('2026-10-08T12:00:00Z', '2026-10-08T14:00:00.000+02:00')
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

test('checkVrc: impossible leap seconds and reversed windows fail at validFrom (#64)', () => {
  for (const [from, until] of [['2026-10-08T12:00:60Z'], ['2017-01-01T00:00:00Z', '2016-12-31T23:59:60Z'],
    ['2026-10-08T12:00:00.000000002Z', '2026-10-08T12:00:00.000000001Z']]) {
    const c = positive('did-key-issuer-directed'); c.validFrom = from
    if (until) c.validUntil = until
    const r = checkVrc(c)
    assert.ok(r.failures.some((f) => f.check === 'validFrom') && !r.passed.includes('validFrom'), `${from} / ${until}`)
    if (!from.includes('.')) assert.ok(!r.notes.some((n) => /fractional digits/.test(n)), `${from}: no fractional-digit note`)
  }
})

test('checkVrc: the signed #64 negatives fail at validFrom alone', () => {
  for (const n of ['validFrom-leap-second-not-end-of-utc-day', 'validUntil-in-leap-second-before-validFrom', 'validUntil-before-validFrom-by-a-nanosecond']) {
    const v = F.negative.find((x) => x.name === n)
    assert.ok(v, n)
    assert.deepEqual(checkVrc(v.credential).failures.map((f) => f.check), ['validFrom'], n)
  }
})

test('checkVrc: a real leap second and a window ending in it pass', () => {
  const c = positive('did-key-issuer-directed'); c.validFrom = '2016-12-31T23:59:59Z'; c.validUntil = '2016-12-31T23:59:60Z'
  const r = checkVrc(c)
  assert.ok(r.passed.includes('validFrom'))
  assert.ok(!r.notes.some((n) => /fractional digits/.test(n)))
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

// did:peer:2 key purposes (did:peer method spec, numalgo 2): A → assertionMethod,
// E → keyAgreement, V → authentication, I → capabilityInvocation,
// D → capabilityDelegation; #key-N counts key segments in order, S skipped
const edMk = (n) => 'z' + b58(Buffer.concat([Buffer.from([0xed, 0x01]), pubRaw(privEd(Buffer.alloc(32, n)))]))
const xMk = (n) => 'z' + b58(Buffer.concat([Buffer.from([0xec, 0x01]), pubRaw(privX(Buffer.alloc(32, n)))]))
const AVE = `did:peer:2.A${edMk(1)}.V${edMk(1)}.E${xMk(2)}`
const SVC = 'S' + Buffer.from(JSON.stringify({ t: 'dm', s: 'https://example.test' })).toString('base64url')

test('resolveVm: did:peer:2 #key-N must carry the purpose of the proof', () => {
  assert.ok(resolveVm(AVE + '#key-1').raw, 'A key for assertionMethod (default)')
  assert.ok(resolveVm(AVE + '#key-1', [], 'assertionMethod').raw)
  const v = resolveVm(AVE + '#key-2', [], 'assertionMethod')
  assert.equal(v.raw, undefined)
  assert.equal(v.error, '#key-2 is an authentication key, not assertionMethod')
  assert.equal(resolveVm(AVE + '#key-2').error, '#key-2 is an authentication key, not assertionMethod', 'default purpose is assertionMethod')
  assert.ok(resolveVm(AVE + '#key-2', [], 'authentication').raw, 'V key for an authentication proof')
  assert.equal(resolveVm(AVE + '#key-1', [], 'authentication').error, '#key-1 is an assertionMethod key, not authentication')
  assert.match(resolveVm(AVE + '#key-3').error, /#key-3 is a keyAgreement key, not assertionMethod/)
})

test('resolveVm: a did:peer:2 with only a V signing key cannot sign for assertionMethod', () => {
  const vOnly = `did:peer:2.V${edMk(3)}`
  assert.equal(resolveVm(vOnly + '#key-1').error, '#key-1 is an authentication key, not assertionMethod')
  const ev = `did:peer:2.E${xMk(4)}.V${edMk(3)}`
  assert.equal(resolveVm(ev + '#key-2').error, '#key-2 is an authentication key, not assertionMethod')
})

test('resolveVm: did:peer:2 S segments are not counted as keys; I and D map to capabilities', () => {
  const did = `did:peer:2.${SVC}.I${edMk(5)}.D${edMk(6)}.A${edMk(7)}`
  assert.ok(resolveVm(did + '#key-1', [], 'capabilityInvocation').raw)
  assert.ok(resolveVm(did + '#key-2', [], 'capabilityDelegation').raw)
  assert.ok(resolveVm(did + '#key-3', [], 'assertionMethod').raw)
  assert.equal(resolveVm(did + '#key-1').error, '#key-1 is a capabilityInvocation key, not assertionMethod')
  assert.match(resolveVm(did + '#key-4').error, /no key #key-4/)
})

test('resolveVm: a multibase-value fragment resolves only to an entry of the proof purpose', () => {
  const k = edMk(1)
  const notes = []
  assert.ok(resolveVm(AVE + '#' + k, notes).raw, 'the same key is also listed under A')
  assert.ok(notes.some((n) => /multibase value/.test(n)))
  const vOnly = `did:peer:2.V${edMk(3)}`
  assert.match(resolveVm(vOnly + '#' + edMk(3)).error, /authentication key, not assertionMethod/)
})

test('resolveVm: did:key serves the signing relationships, never keyAgreement', () => {
  const did = didOf(Buffer.alloc(32, 9)), vm = `${did}#${did.slice(8)}`
  for (const p of ['assertionMethod', 'authentication', 'capabilityInvocation', 'capabilityDelegation']) assert.ok(resolveVm(vm, [], p).raw, p)
  assert.ok(resolveVm(vm).raw, 'default assertionMethod')
  assert.match(resolveVm(vm, [], 'keyAgreement').error, /not .*keyAgreement/)
  assert.match(resolveVm(`${did}#key-1`).error, /fragment is not the method-specific identifier/)
})

test('resolveVm: an unknown proof purpose is refused', () => {
  assert.match(resolveVm(AVE + '#key-1', [], 'somethingElse').error, /proofPurpose "somethingElse"/)
})

test('checkVrc: the did:peer:2 positive signs with its A key and carries no key-purpose note', () => {
  const c = positive('did-peer-2-issuer-pairwise')
  assert.match(c.issuer, /^did:peer:2\.Az6Mk[^.]+\.Vz6Mk[^.]+\.Ez6LS[^.]+$/)
  assert.equal(c.proof.verificationMethod, c.issuer + '#key-1')
  const r = checkVrc(c)
  assert.ok(r.ok, JSON.stringify(r.failures))
  assert.deepEqual(r.notes, [])
})

test('checkVrc: key-purpose negatives fail at proof-key with the purpose as reason', () => {
  for (const [n, re] of [['verification-method-is-authentication-only-did', /#key-1 is an authentication key, not assertionMethod/],
    ['verification-method-is-authentication-key', /#key-2 is an authentication key, not assertionMethod/],
    ['verification-method-is-key-agreement', /#key-3 is a keyAgreement key, not assertionMethod/]]) {
    const v = F.negative.find((x) => x.name === n)
    assert.ok(v, n)
    const r = checkVrc(v.credential)
    assert.deepEqual(r.failures.map((f) => f.check), ['proof-key'], n)
    assert.match(r.failures[0].detail, re, n)
  }
})

test('checkVrc: proofPurpose defaults to assertionMethod only when the member is absent', () => {
  const c = positive('did-peer-2-issuer-pairwise'); delete c.proof.proofPurpose
  const r = checkVrc(c)
  assert.ok(r.passed.includes('proof-key'), 'absent member: the assertionMethod key resolves')
  assert.deepEqual(r.failures.map((f) => f.check), ['proof-signature'], 'only the signature, which covered the member, breaks')
})

test('checkVrc: a present proofPurpose that is null, not a string or unknown is refused at proof-key', () => {
  for (const [v, re] of [[null, /proofPurpose null is not a verification relationship/],
    [5, /proofPurpose 5 is not a verification relationship/],
    [['assertionMethod'], /proofPurpose \["assertionMethod"\] is not a verification relationship/],
    ['', /proofPurpose "" is not a verification relationship/],
    ['somethingElse', /proofPurpose "somethingElse" is not a verification relationship/]]) {
    const c = positive('did-peer-2-issuer-pairwise'); c.proof.proofPurpose = v
    const r = checkVrc(c)
    assert.deepEqual(r.failures.map((f) => f.check), ['proof-key'], JSON.stringify(v))
    assert.match(r.failures[0].detail, re, JSON.stringify(v))
  }
})

test('checkVrc: the signed proofPurpose negatives fail at proof-key alone', () => {
  for (const [n, re] of [['proofPurpose-null', /proofPurpose null/], ['proofPurpose-not-a-string', /proofPurpose \["assertionMethod"\]/]]) {
    const v = F.negative.find((x) => x.name === n)
    assert.ok(v, n)
    const r = checkVrc(v.credential)
    assert.deepEqual(r.failures.map((f) => f.check), ['proof-key'], n)
    assert.match(r.failures[0].detail, re, n)
  }
})
