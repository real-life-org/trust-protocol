#!/usr/bin/env node
// Traceability check for the Encounter Layer's numbered rules.
//
// Two sources of truth for the rule set:
//   · the public manifest conformance/encounter-rule-ids-0.30.txt, one
//     `RLTP-ENC-nnnn` per line, committed with the specification — this
//     is what CI checks against;
//   · the rule inventory (the 0.29 → 0.30 trace table, kept outside this
//     repository) — checked additionally when present, and REQUIRED when
//     ENCOUNTER_INVENTORY names it explicitly.
//
// A rule in the specification is a paragraph that starts, unindented and
// outside any code fence, with `**RLTP-ENC-nnnn** — <statement>`. The
// checker reports: an ID listed but not a rule; an ID that is a rule but
// not listed; an ID that is a rule more than once (indented copies and
// copies inside code fences are reported too); a bold rule marker that
// is malformed (no separator, empty statement, ID not 4–5 digits); an
// empty manifest or inventory.
//
//   usage: node scripts/check-encounter-trace.mjs [--inventory <file>] [--spec <file>] [--manifest <file>]
//          node scripts/check-encounter-trace.mjs --write-manifest <inventory.md>
//
// Exit 1 on any violation, 2 on usage errors.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const DEFAULT_SPEC = join(ROOT, 'spec/encounter-layer.md')
export const DEFAULT_MANIFEST = join(ROOT, 'conformance/encounter-rule-ids-0.30.txt')
export const DEFAULT_INVENTORY = join(ROOT, '..', 'rltp', 'design', 'encounter-0.30-regelinventar.md')

const ID = /RLTP-ENC-\d{4,5}/

// Inventory rows with an ID of their own start `| RLTP-ENC-nnnn |`;
// rows starting `| = RLTP-ENC-…` are references to another row.
export const inventoryIds = (text) =>
  [...text.matchAll(/^\|\s*(RLTP-ENC-\d+)\s*\|/gm)].map((m) => m[1])

// Manifest: one ID per line; blank lines and `#` comments ignored.
export const manifestIds = (text) =>
  text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))

// Rule paragraphs of the specification, with everything the checker
// needs to complain about.
export function parseSpecRules (text) {
  const rules = []      // { id, line }
  const problems = []   // strings
  // Code fences: ``` or ~~~, three or more; the closing fence uses the
  // same character and at least the same length (CommonMark). HTML
  // comments may span lines. Both hide everything inside them.
  let fence = null      // { ch, len } while inside a fence
  let comment = false
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const n = i + 1
    const f = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (!comment && f) {
      const ch = f[1][0]; const len = f[1].length
      if (!fence) { fence = { ch, len }; continue }
      // a closing fence carries nothing but whitespace after its characters
      const bare = /^\s{0,3}(`{3,}|~{3,})\s*$/.test(line)
      if (fence.ch === ch && len >= fence.len && bare) { fence = null; continue }
    }
    const hidden = Boolean(fence) || comment
    // Comment state for the NEXT lines: open without close → inside;
    // close on this line → outside after it.
    const opens = line.lastIndexOf('<!--'); const closes = line.lastIndexOf('-->')
    const commentBefore = comment
    if (!fence) {
      if (opens >= 0 && opens > closes) comment = true
      else if (closes >= 0) comment = false
    }
    const m = line.match(/^(\s*)\*\*(RLTP-ENC-[^*]*)\*\*(.*)$/)
    if (!m) continue
    const [, indent, id, rest] = m
    if (fence) { problems.push(`${id} at line ${n}: rule marker inside a code fence`); continue }
    if (hidden || commentBefore || (opens >= 0 && opens < line.indexOf('**'))) { problems.push(`${id} at line ${n}: rule marker inside an HTML comment`); continue }
    if (indent) { problems.push(`${id} at line ${n}: rule marker is indented`); continue }
    if (!ID.test(id) || !/^RLTP-ENC-\d{4,5}$/.test(id)) { problems.push(`"${id}" at line ${n}: malformed rule identifier`); continue }
    const body = rest.match(/^\s+—\s+(\S.*)$/)
    if (!body) { problems.push(`${id} at line ${n}: rule has no "— <statement>" after the identifier`); continue }
    rules.push({ id, line: n })
  }
  return { rules, problems }
}

export function checkTrace ({ spec = DEFAULT_SPEC, manifest = DEFAULT_MANIFEST, inventory = null } = {}) {
  const errors = []
  const specText = readFileSync(spec, 'utf8')
  const { rules, problems } = parseSpecRules(specText)
  errors.push(...problems)

  // ID uniqueness in the specification — always.
  const count = new Map()
  for (const r of rules) count.set(r.id, (count.get(r.id) ?? 0) + 1)
  for (const [id, n] of count) if (n > 1) errors.push(`${id}: appears ${n} times as a rule in the specification`)

  const compare = (label, ids) => {
    if (!ids.length) { errors.push(`${label} lists no rule identifiers`); return }
    const seen = new Set()
    for (const id of ids) {
      if (!/^RLTP-ENC-\d{4,5}$/.test(id)) errors.push(`${label}: malformed identifier "${id}"`)
      if (seen.has(id)) errors.push(`${label} lists ${id} more than once`)
      seen.add(id)
    }
    for (const id of seen) if (!count.has(id)) errors.push(`${id}: in the ${label}, not a rule in the specification`)
    for (const id of count.keys()) if (!seen.has(id)) errors.push(`${id}: a rule in the specification, not in the ${label}`)
    return seen.size
  }

  if (!existsSync(manifest)) errors.push(`manifest not found: ${manifest}`)
  const manifestCount = existsSync(manifest) ? compare('manifest', manifestIds(readFileSync(manifest, 'utf8'))) : 0
  let inventoryCount = null
  if (inventory) {
    if (!existsSync(inventory)) errors.push(`inventory not found: ${inventory}`)
    else inventoryCount = compare('inventory', inventoryIds(readFileSync(inventory, 'utf8')))
  }
  return { rules: count.size, manifest: manifestCount, inventory: inventoryCount, errors }
}

// Which inventory to use: an explicit ENCOUNTER_INVENTORY (or --inventory)
// is mandatory; otherwise the sibling workshop checkout when present.
export const resolveInventory = (explicit) => {
  if (explicit) return { path: explicit, required: true }
  if (existsSync(DEFAULT_INVENTORY)) return { path: DEFAULT_INVENTORY, required: false }
  return { path: null, required: false }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  const USAGE = 'usage: check-encounter-trace.mjs [<inventory.md>] [--inventory <file>] [--spec <file>] [--manifest <file>]\n       check-encounter-trace.mjs --write-manifest <inventory.md> [--manifest <file>]'
  const usage = (msg) => { console.error(`${msg}\n${USAGE}`); process.exit(2) }
  const KNOWN = ['--inventory', '--spec', '--manifest', '--write-manifest']
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (!a.startsWith('--')) continue
    if (!KNOWN.includes(a)) usage(`unknown option: ${a}`)
    const v = args[i + 1]
    if (v === undefined || v.startsWith('--')) usage(`option ${a} needs a value`)
    i++
  }
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
  if (args.includes('--write-manifest')) {
    const inv = opt('--write-manifest')
    const ids = inventoryIds(readFileSync(inv, 'utf8'))
    if (!ids.length) { console.error('inventory lists no rule identifiers'); process.exit(1) }
    const out = opt('--manifest') ?? DEFAULT_MANIFEST
    writeFileSync(out, `# Encounter Layer 0.30 — rule identifiers, one per line, generated from the rule inventory.\n# Regenerate: node scripts/check-encounter-trace.mjs --write-manifest <inventory.md>\n${ids.join('\n')}\n`)
    console.log(`${ids.length} identifiers written to ${out}`)
    process.exit(0)
  }
  const positional = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').startsWith('--'))
  if (positional.length > 1) usage(`unexpected argument: ${positional[1]}`)
  const { path: inventory } = resolveInventory(opt('--inventory') ?? positional[0] ?? process.env.ENCOUNTER_INVENTORY)
  const r = checkTrace({ spec: opt('--spec'), manifest: opt('--manifest'), inventory })
  for (const e of r.errors) console.error(`  ERROR ${e}`)
  console.log(`${r.rules} rule identifiers in the specification, ${r.manifest} in the manifest${r.inventory === null ? ', inventory not checked' : `, ${r.inventory} in the inventory`}${r.errors.length ? `, ${r.errors.length} error(s).` : ' — trace complete.'}`)
  process.exit(r.errors.length ? 1 : 0)
}
