// Probes for scripts/check-encounter-trace.mjs — every way the checker
// must fail, and the one way it passes.
//   usage: node --test scripts/check-encounter-trace.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
import { checkTrace, parseSpecRules, inventoryIds, manifestIds } from './check-encounter-trace.mjs'

const dir = mkdtempSync(join(tmpdir(), 'enc-trace-'))
let n = 0
const file = (content) => { const p = join(dir, `f${n++}.md`); writeFileSync(p, content); return p }
const spec = (rules) => file(`# Spec\n\n${rules}\n`)
const manifest = (ids) => file(ids.map((i) => `${i}\n`).join(''))
const inventory = (ids) => file(ids.map((i) => `| ${i} | § | MUST | x | y | z | § |\n`).join(''))
const GOOD = '**RLTP-ENC-2010** — An anchor MUST be a did:key.\n\n**RLTP-ENC-2020** — A signature MUST verify.'
const run = (s, m, inv) => checkTrace({ spec: spec(s), manifest: manifest(m), inventory: inv === undefined ? null : inventory(inv) })
const has = (r, part) => assert.ok(r.errors.some((e) => e.includes(part)), `expected an error containing "${part}", got: ${JSON.stringify(r.errors)}`)

test('complete trace passes, with and without inventory', () => {
  assert.deepEqual(run(GOOD, ['RLTP-ENC-2010', 'RLTP-ENC-2020']).errors, [])
  assert.deepEqual(run(GOOD, ['RLTP-ENC-2010', 'RLTP-ENC-2020'], ['RLTP-ENC-2010', 'RLTP-ENC-2020']).errors, [])
})

test('a listed ID that is not a rule fails; an unlisted rule fails', () => {
  has(run(GOOD, ['RLTP-ENC-2010', 'RLTP-ENC-2020', 'RLTP-ENC-2030']), 'RLTP-ENC-2030: in the manifest, not a rule')
  has(run(GOOD, ['RLTP-ENC-2010']), 'RLTP-ENC-2020: a rule in the specification, not in the manifest')
  has(run(GOOD, ['RLTP-ENC-2010', 'RLTP-ENC-2020'], ['RLTP-ENC-2010']), 'not in the inventory')
})

test('a duplicate rule fails, also when the copy is indented or fenced', () => {
  has(run(GOOD + '\n\n**RLTP-ENC-2010** — Again.', ['RLTP-ENC-2010', 'RLTP-ENC-2020']), 'appears 2 times')
  has(run(GOOD + '\n\n  **RLTP-ENC-2010** — Indented copy.', ['RLTP-ENC-2010', 'RLTP-ENC-2020']), 'is indented')
  has(run(GOOD + '\n\n```\n**RLTP-ENC-2010** — Fenced copy.\n```', ['RLTP-ENC-2010', 'RLTP-ENC-2020']), 'inside a code fence')
})

test('a rule only inside a code fence does not count', () => {
  const r = run('```\n**RLTP-ENC-2010** — Only here.\n```', ['RLTP-ENC-2010'])
  has(r, 'inside a code fence')
  has(r, 'RLTP-ENC-2010: in the manifest, not a rule')
})

test('a bare marker, a missing separator, an empty statement and a malformed ID fail', () => {
  has(run('**RLTP-ENC-2010**', ['RLTP-ENC-2010']), 'no "— <statement>"')
  has(run('**RLTP-ENC-2010** An anchor MUST be.', ['RLTP-ENC-2010']), 'no "— <statement>"')
  has(run('**RLTP-ENC-2010** — ', ['RLTP-ENC-2010']), 'no "— <statement>"')
  has(run('**RLTP-ENC-20** — Too short.', ['RLTP-ENC-20']), 'malformed rule identifier')
  has(run('**RLTP-ENC-2010a** — Suffix.', ['RLTP-ENC-2010']), 'malformed rule identifier')
})

test('empty manifest, empty inventory and empty specification fail', () => {
  has(run(GOOD, []), 'manifest lists no rule identifiers')
  has(run(GOOD, ['RLTP-ENC-2010', 'RLTP-ENC-2020'], []), 'inventory lists no rule identifiers')
  has(run('', []), 'manifest lists no rule identifiers')
  assert.ok(run('', []).errors.length > 0)
})

test('a missing manifest or an explicitly named missing inventory fails', () => {
  has(checkTrace({ spec: spec(GOOD), manifest: join(dir, 'nope.txt') }), 'manifest not found')
  has(checkTrace({ spec: spec(GOOD), manifest: manifest(['RLTP-ENC-2010', 'RLTP-ENC-2020']), inventory: join(dir, 'nope.md') }), 'inventory not found')
})

test('a manifest listing an ID twice or a malformed ID fails', () => {
  has(run(GOOD, ['RLTP-ENC-2010', 'RLTP-ENC-2010', 'RLTP-ENC-2020']), 'lists RLTP-ENC-2010 more than once')
  has(run(GOOD, ['RLTP-ENC-2010', 'RLTP-ENC-2020', 'ENC-9']), 'malformed identifier')
})

test('tilde fences, long fences and HTML comments hide rules', () => {
  const ids = ['RLTP-ENC-2010', 'RLTP-ENC-2020']
  has(run('~~~markdown\n' + GOOD + '\n~~~', ids), 'RLTP-ENC-2010: in the manifest, not a rule')
  has(run('~~~markdown\n' + GOOD + '\n~~~', ids), 'inside a code fence')
  has(run('<!--\n' + GOOD + '\n-->', ids), 'inside an HTML comment')
  has(run('<!--\n' + GOOD + '\n-->', ids), 'RLTP-ENC-2020: in the manifest, not a rule')
  has(run('<!-- **RLTP-ENC-2010** — Hidden. -->\n\n**RLTP-ENC-2020** — Visible.', ids), 'RLTP-ENC-2010: in the manifest, not a rule')
  // a ``` fence is not closed by ~~~ nor by a shorter fence
  has(run('````\n~~~\n```\n' + GOOD + '\n````', ids), 'inside a code fence')
  // a closing fence is bare: fence characters followed by text do not close
  has(run('~~~\n~~~ not-a-closing-fence\n' + GOOD + '\n~~~', ids), 'inside a code fence')
  has(run('```\n``` not-a-closing-fence\n' + GOOD + '\n```', ids), 'inside a code fence')
  assert.deepEqual(run('~~~\n~~~   \n' + GOOD, ids).errors, [])
  // a fence inside a comment does not open; a closed fence frees the rules
  assert.deepEqual(run('<!-- ``` -->\n' + GOOD, ids).errors, [])
  assert.deepEqual(run('~~~\nx\n~~~~\n' + GOOD, ids).errors, [])
})

test('CLI: missing option value, unknown option and extra argument exit 2 with usage', () => {
  const { spawnSync } = require('node:child_process')
  const cli = (...a) => spawnSync(process.execPath, [new URL('./check-encounter-trace.mjs', import.meta.url).pathname, ...a], { encoding: 'utf8' })
  for (const a of [['--inventory'], ['--spec'], ['--manifest'], ['--inventory', '--spec', 'x'], ['--bogus', 'x'], ['a.md', 'b.md']]) {
    const r = cli(...a)
    assert.equal(r.status, 2, `args ${JSON.stringify(a)} → status ${r.status}`)
    assert.match(r.stderr, /usage:/)
  }
  const inv = inventory(['RLTP-ENC-2010', 'RLTP-ENC-2020'])
  const ok = cli('--spec', spec(GOOD), '--manifest', manifest(['RLTP-ENC-2010', 'RLTP-ENC-2020']), '--inventory', inv)
  assert.equal(ok.status, 0, ok.stderr)
  const bad = cli('--spec', spec(GOOD), '--manifest', manifest(['RLTP-ENC-2010']), '--inventory', inv)
  assert.equal(bad.status, 1)
})

test('parsers: inventory rows and manifest lines', () => {
  assert.deepEqual(inventoryIds('| RLTP-ENC-2010 | a |\n| = RLTP-ENC-2010 | b |\n| RLTP-ENC-2020 | c |'), ['RLTP-ENC-2010', 'RLTP-ENC-2020'])
  assert.deepEqual(manifestIds('# c\n\nRLTP-ENC-2010\n RLTP-ENC-2020 \n'), ['RLTP-ENC-2010', 'RLTP-ENC-2020'])
  const p = parseSpecRules(GOOD)
  assert.deepEqual(p.rules.map((r) => r.id), ['RLTP-ENC-2010', 'RLTP-ENC-2020'])
  assert.deepEqual(p.problems, [])
})

// ── Access layer (`--layer access`, prefix RLTP-ACC) ─────────────────────
const AGOOD = '**RLTP-ACC-3005** — A group MUST have one log.\n\n**RLTP-ACC-14010** — A schema MUST validate.'
const ainventory = (ids) => file('## B. Haupttabelle\n' + ids.map((i) => `| ${i} | § | MUST | x |\n`).join(''))
const arun = (s, m, inv) => checkTrace({ layer: 'access', spec: spec(s), manifest: manifest(m), inventory: inv === undefined ? null : ainventory(inv) })

test('access: complete trace passes; ENC markers are not access rules', () => {
  assert.deepEqual(arun(AGOOD, ['RLTP-ACC-3005', 'RLTP-ACC-14010']).errors, [])
  assert.deepEqual(arun(AGOOD + '\n\n**RLTP-ENC-2010** — Other layer.', ['RLTP-ACC-3005', 'RLTP-ACC-14010'], ['RLTP-ACC-3005', 'RLTP-ACC-14010']).errors, [])
  has(arun(AGOOD, ['RLTP-ACC-3005', 'RLTP-ACC-14010', 'RLTP-ENC-2010']), 'malformed identifier "RLTP-ENC-2010"')
})

test('access: missing, unlisted, duplicate and malformed rules fail', () => {
  has(arun(AGOOD, ['RLTP-ACC-3005']), 'RLTP-ACC-14010: a rule in the specification, not in the manifest')
  has(arun(AGOOD, ['RLTP-ACC-3005', 'RLTP-ACC-14010', 'RLTP-ACC-5125']), 'RLTP-ACC-5125: in the manifest, not a rule')
  has(arun(AGOOD + '\n\n**RLTP-ACC-3005** — Again.', ['RLTP-ACC-3005', 'RLTP-ACC-14010']), 'appears 2 times')
  has(arun('**RLTP-ACC-30** — Short.', ['RLTP-ACC-3005']), 'malformed rule identifier')
  has(arun(AGOOD, ['RLTP-ACC-3005', 'RLTP-ACC-14010'], ['RLTP-ACC-3005']), 'not in the inventory')
  assert.equal(parseSpecRules(AGOOD).rules.length, 0, 'the default prefix stays RLTP-ENC')
  assert.equal(parseSpecRules(AGOOD, 'RLTP-ACC').rules.length, 2)
})

test('access: only part B of the inventory counts', () => {
  const text = '## A. Zweck\n| RLTP-ACC-9999 | x |\n## B. Haupttabelle\n| RLTP-ACC-3005 | a |\n| = RLTP-ACC-3005 | b |\n| RLTP-ACC-14010 | c |\n## C. Statistik\n| RLTP-ACC-3005 | again |\n'
  assert.deepEqual(inventoryIds(text, 'RLTP-ACC', 'B'), ['RLTP-ACC-3005', 'RLTP-ACC-14010'])
  assert.deepEqual(inventoryIds(text, 'RLTP-ACC'), ['RLTP-ACC-9999', 'RLTP-ACC-3005', 'RLTP-ACC-14010', 'RLTP-ACC-3005'])
  const p = file(text)
  assert.deepEqual(checkTrace({ layer: 'access', spec: spec(AGOOD), manifest: manifest(['RLTP-ACC-3005', 'RLTP-ACC-14010']), inventory: p }).errors, [])
})

test('access CLI: --layer access checks, writes manifests; an unknown layer exits 2', () => {
  const { spawnSync } = require('node:child_process')
  const cli = (...a) => spawnSync(process.execPath, [new URL('./check-encounter-trace.mjs', import.meta.url).pathname, ...a], { encoding: 'utf8' })
  const s = spec(AGOOD)
  const m = manifest(['RLTP-ACC-3005', 'RLTP-ACC-14010'])
  // without a part B heading the access inventory lists nothing
  const inv = inventory(['RLTP-ACC-3005', 'RLTP-ACC-14010'])
  const invB = ainventory(['RLTP-ACC-3005', 'RLTP-ACC-14010'])
  const ok = cli('--layer', 'access', '--spec', s, '--manifest', m, '--inventory', invB)
  assert.equal(ok.status, 0, ok.stderr)
  assert.equal(cli('--layer', 'access', '--spec', s, '--manifest', m, '--inventory', inv).status, 1)
  assert.equal(cli('--layer', 'bogus', '--spec', s).status, 2)
  const out = join(dir, 'written.txt')
  const w = cli('--layer', 'access', '--write-manifest-from-spec', s, '--manifest', out)
  assert.equal(w.status, 0, w.stderr)
  assert.deepEqual(manifestIds(require('node:fs').readFileSync(out, 'utf8')), ['RLTP-ACC-3005', 'RLTP-ACC-14010'])
  const w2 = cli('--layer', 'access', '--write-manifest', invB, '--manifest', out)
  assert.equal(w2.status, 0, w2.stderr)
  assert.match(require('node:fs').readFileSync(out, 'utf8'), /^# Access Layer 0\.54/)
})

// ── Membership Tasks (`--layer membership`, prefix RLTP-MT) ──────────────
// The membership inventory carries the target ID in its own column
// (`Ziel-ID`), not in the first; `= RLTP-MT-…` references, `inf. (= …)`,
// `Plan`, `Def.`, `Rat.` and `—` are no IDs of their own.
const MGOOD = '**RLTP-MT-2010** — The Access layer MUST own authority.\n\n**RLTP-MT-10020** — This profile MUST pin the wire.'
const MHEAD = '| # | 0.16 Stelle | 0.16 Text | Ziel-ID | Änderung | Notiz |\n|---|---|---|---|---|---|\n'
const minventory = (cells) => file('## A. Zählung\n| x | RLTP-MT-9990 |\n## B. Rückverfolgung\n\n### §0\n\n' + MHEAD +
  cells.map((c, i) => `| ${i + 1} | Kopf | „Text mit \`a\\|b\`“ | ${c} | = | |\n`).join('') + '\n## C. Abhängigkeiten\n\n' + MHEAD + '| 1 | x | y | RLTP-MT-9999 | A54 | |\n')
const mrun = (s, m, cells) => checkTrace({ layer: 'membership', spec: spec(s), manifest: manifest(m), inventory: cells === undefined ? null : minventory(cells) })

test('membership: complete trace passes; only own Ziel-IDs of part B count', () => {
  assert.deepEqual(mrun(MGOOD, ['RLTP-MT-2010', 'RLTP-MT-10020']).errors, [])
  assert.deepEqual(mrun(MGOOD, ['RLTP-MT-2010', 'RLTP-MT-10020'],
    ['RLTP-MT-2010', '= RLTP-MT-2010', 'inf. (= RLTP-MT-10020)', '= RLTP-MT-10020, 3505', 'Plan', 'Def.', 'Rat.', 'inf.', '—', 'RLTP-MT-10020']).errors, [])
  has(mrun(MGOOD, ['RLTP-MT-2010', 'RLTP-MT-10020'], ['RLTP-MT-2010', '= RLTP-MT-10020']), 'RLTP-MT-10020: a rule in the specification, not in the inventory')
  has(mrun(MGOOD, ['RLTP-MT-2010', 'RLTP-MT-10020'], ['RLTP-MT-2010', 'RLTP-MT-10020', 'RLTP-MT-3005']), 'RLTP-MT-3005: in the inventory, not a rule')
  has(mrun(MGOOD, ['RLTP-MT-2010', 'RLTP-MT-10020'], ['RLTP-MT-2010', 'RLTP-MT-10020', 'RLTP-MT-2010']), 'inventory lists RLTP-MT-2010 more than once')
  has(mrun(MGOOD, ['RLTP-MT-2010']), 'RLTP-MT-10020: a rule in the specification, not in the manifest')
  has(mrun(MGOOD + '\n\n**RLTP-ACC-3005** — Other layer.', ['RLTP-MT-2010', 'RLTP-MT-10020', 'RLTP-ACC-3005']), 'malformed identifier "RLTP-ACC-3005"')
})

test('membership: the Ziel-ID column is found by its header, escaped pipes do not shift it', () => {
  const text = '## B. Rückverfolgung\n' + MHEAD + '| 1 | a \\| b | RLTP-MT-1111 | RLTP-MT-2010 | = | RLTP-MT-3333 |\n' +
    '| # | Ziel-ID | Notiz |\n|---|---|---|\n| 2 | RLTP-MT-10020 | RLTP-MT-4444 |\n'
  assert.deepEqual(inventoryIds(text, 'RLTP-MT', 'B', 'Ziel-ID'), ['RLTP-MT-2010', 'RLTP-MT-10020'])
  assert.deepEqual(inventoryIds('## B. x\n| # | Notiz |\n|---|---|\n| 1 | RLTP-MT-2010 |\n', 'RLTP-MT', 'B', 'Ziel-ID'), [])
})

test('membership CLI: --layer membership checks and writes the manifest from the spec', () => {
  const { spawnSync } = require('node:child_process')
  const cli = (...a) => spawnSync(process.execPath, [new URL('./check-encounter-trace.mjs', import.meta.url).pathname, ...a], { encoding: 'utf8' })
  const s = spec(MGOOD)
  const out = join(dir, 'membership-written.txt')
  const w = cli('--layer', 'membership', '--write-manifest-from-spec', s, '--manifest', out)
  assert.equal(w.status, 0, w.stderr)
  const text = require('node:fs').readFileSync(out, 'utf8')
  assert.match(text, /^# Membership Tasks 0\.17/)
  assert.match(text, /--layer membership --write-manifest-from-spec/)
  assert.deepEqual(manifestIds(text), ['RLTP-MT-2010', 'RLTP-MT-10020'])
  const ok = cli('--layer', 'membership', '--spec', s, '--manifest', out, '--inventory', minventory(['RLTP-MT-2010', 'RLTP-MT-10020']))
  assert.equal(ok.status, 0, ok.stderr)
  assert.equal(cli('--layer', 'membership', '--spec', s, '--manifest', out, '--inventory', minventory(['RLTP-MT-2010'])).status, 1)
})
