// Probes for scripts/check-companion-pins.mjs.
//   usage: node --test scripts/check-companion-pins.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { checkPins, parseHeader, SPECS } from './check-companion-pins.mjs'

const head = (version, fields = '') => `# Spec\n\n- **Status:** Editor's Draft\n- **Version:** ${version}.0-draft\n${fields}\n## Abstract\n\nAccess Layer 0.1 in the body is no pin.\n`

// A spec directory where every specification is at 1.0 unless overridden.
const specDir = (over = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'pins-'))
  for (const [name, file] of Object.entries(SPECS)) writeFileSync(join(dir, file), over[name] ?? head('1.0'))
  return dir
}

test('current pins pass', () => {
  const r = checkPins(specDir({ Replication: head('1.0', '- **Companion pins:** Access Layer 1.0 (wire 0.24) · Identity Layer 1.0\n') }))
  assert.deepEqual(r, { errors: [], stale: [] })
})

test('a pin behind the companion is stale, with its line', () => {
  const r = checkPins(specDir({ Access: head('1.2'), Replication: head('1.0', '- **Companions:** RLTP Identity 1.0;\n  RLTP **Access Layer 1.1** (normative).\n') }))
  assert.equal(r.errors.length, 0)
  assert.equal(r.stale.length, 1)
  assert.match(r.stale[0].msg, /pins Access Layer 1\.1, access-layer\.md is at 1\.2/)
  assert.equal(r.stale[0].line, 6)
})

test('a pin broken across lines is read', () => {
  const r = checkPins(specDir({ Delivery: head('2.0'), Access: head('1.0', '- **Companions:** RLTP Delivery Contract\n  1.9 (normative reference).\n') }))
  assert.equal(r.stale.length, 1)
})

test('a pin ahead of the companion is an error', () => {
  const r = checkPins(specDir({ Membership: head('1.0', '- **Position:** on top of the RLTP Access Layer 1.3.\n') }))
  assert.equal(r.errors.length, 1)
  assert.match(r.errors[0].msg, /does not|is at 1\.0/)
})

test('only companion and position fields count; wire versions and the body do not', () => {
  const h = parseHeader(head('1.0', '- **Supersedes:** Access Layer 0.9\n- **Companions:** Access Layer 1.0 (wire 0.24)\n'))
  assert.deepEqual(h.pins.map((p) => p.text), ['Access Layer 1.0'])
  assert.deepEqual(h.version, [1, 0])
})

test('a missing version field is an error', () => {
  const r = checkPins(specDir({ Succession: '# Spec\n\n- **Status:** Draft\n\n## Abstract\n' }))
  assert.ok(r.errors.some((e) => String(e).includes('no **Version:**')))
})
