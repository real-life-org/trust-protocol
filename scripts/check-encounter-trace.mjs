#!/usr/bin/env node
// Traceability check for the numbered rules of a layer specification —
// the Encounter Layer (`RLTP-ENC`, the default), the Access Layer
// (`RLTP-ACC`, `--layer access`) and Membership Tasks (`RLTP-MT`,
// `--layer membership`).
//
// Two sources of truth for the rule set:
//   · the public manifest (conformance/encounter-rule-ids-0.30.txt,
//     conformance/access-rule-ids-0.55.txt,
//     conformance/membership-rule-ids-0.17.txt), one identifier per line,
//     committed with the specification — this is what CI checks against;
//   · the rule inventory (the trace table from the previous version, kept
//     outside this repository) — checked additionally when present, and
//     REQUIRED when ENCOUNTER_INVENTORY / ACCESS_INVENTORY /
//     MEMBERSHIP_INVENTORY names it. The Encounter and Access inventories
//     carry the ID in a row's first cell; the Membership inventory in its
//     `Ziel-ID` column.
//
// A rule in the specification is a paragraph that starts, unindented and
// outside any code fence, with `**<PREFIX>-nnnn** — <statement>`. The
// checker reports: an ID listed but not a rule; an ID that is a rule but
// not listed; an ID that is a rule more than once (indented copies and
// copies inside code fences are reported too); a bold rule marker that
// is malformed (no separator, empty statement, ID not 4–5 digits); an
// empty manifest or inventory.
//
//   usage: node scripts/check-encounter-trace.mjs [--layer encounter|access|membership] [--inventory <file>] [--spec <file>] [--manifest <file>]
//          node scripts/check-encounter-trace.mjs [--layer encounter|access|membership] --write-manifest <inventory.md>
//          node scripts/check-encounter-trace.mjs [--layer encounter|access|membership] --write-manifest-from-spec <spec.md>
//
// Exit 1 on any violation, 2 on usage errors.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// One entry per traced layer: identifier prefix, specification, committed
// manifest, sibling inventory, and the environment variable that makes the
// inventory mandatory.
export const LAYERS = {
  encounter: {
    prefix: 'RLTP-ENC',
    title: 'Encounter Layer 0.30',
    spec: join(ROOT, 'spec/encounter-layer.md'),
    manifest: join(ROOT, 'conformance/encounter-rule-ids-0.30.txt'),
    inventory: join(ROOT, '..', 'rltp', 'design', 'encounter-0.30-regelinventar.md'),
    env: 'ENCOUNTER_INVENTORY'
  },
  access: {
    prefix: 'RLTP-ACC',
    title: 'Access Layer 0.55',
    spec: join(ROOT, 'spec/access-layer.md'),
    manifest: join(ROOT, 'conformance/access-rule-ids-0.55.txt'),
    inventory: join(ROOT, '..', 'rltp', 'design', 'access-0.55-regelinventar.md'),
    env: 'ACCESS_INVENTORY',
    inventorySection: 'B'
  },
  membership: {
    prefix: 'RLTP-MT',
    title: 'Membership Tasks 0.17',
    spec: join(ROOT, 'spec/membership-tasks.md'),
    manifest: join(ROOT, 'conformance/membership-rule-ids-0.17.txt'),
    inventory: join(ROOT, '..', 'rltp', 'design', 'membership-0.17-regelinventar.md'),
    env: 'MEMBERSHIP_INVENTORY',
    inventorySection: 'B',
    inventoryColumn: 'Ziel-ID'
  }
}
export const DEFAULT_SPEC = LAYERS.encounter.spec
export const DEFAULT_MANIFEST = LAYERS.encounter.manifest
export const DEFAULT_INVENTORY = LAYERS.encounter.inventory

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const idRe = (prefix) => new RegExp(`^${esc(prefix)}-\\d{4,5}$`)

// Inventory rows with an ID of their own start `| RLTP-ENC-nnnn |`;
// rows starting `| = RLTP-ENC-…` are references to another row. With a
// `section` letter only the part under `## <letter>.` counts (the Access
// inventory repeats new rows in its statistics part C).
export const inventorySection = (text, section) => {
  if (!section) return text
  const lines = text.split('\n')
  const start = lines.findIndex((l) => new RegExp(`^## ${esc(section)}\\.`).test(l))
  if (start < 0) return ''
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l))
  return lines.slice(start, end < 0 ? undefined : end).join('\n')
}
// With a `column` name the ID is read from that column of each table,
// found by its header row; a cell counts only when it is exactly one ID
// (`= RLTP-MT-…`, `inf. (= …)`, `Plan`, `—` and the like are no IDs of
// their own). Escaped pipes (`\|`) inside a cell do not split it.
const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim())
/** The identifiers an inventory assigns, read from part B's `Ziel-ID` column (or from the first column where no column is named). */
export const inventoryIds = (text, prefix = 'RLTP-ENC', section = null, column = null) => {
  const part = inventorySection(text, section)
  if (!column) return [...part.matchAll(new RegExp(`^\\|\\s*(${esc(prefix)}-\\d+)\\s*\\|`, 'gm'))].map((m) => m[1])
  const own = new RegExp(`^${esc(prefix)}-\\d+$`)
  const ids = []
  let col = -1
  for (const line of part.split('\n')) {
    if (!line.trim().startsWith('|')) { col = -1; continue }
    const row = cells(line)
    if (row.includes(column)) { col = row.indexOf(column); continue }
    if (col < 0 || row.every((c) => /^:?-+:?$/.test(c))) continue
    if (own.test(row[col] ?? '')) ids.push(row[col])
  }
  return ids
}

// Manifest: one ID per line; blank lines and `#` comments ignored.
export const manifestIds = (text) =>
  text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))

// Rule paragraphs of the specification, with everything the checker
// needs to complain about.
export function parseSpecRules (text, prefix = 'RLTP-ENC') {
  const ID = idRe(prefix)
  const marker = new RegExp(`^(\\s*)\\*\\*(${esc(prefix)}-[^*]*)\\*\\*(.*)$`)
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
    const m = line.match(marker)
    if (!m) continue
    const [, indent, id, rest] = m
    if (fence) { problems.push(`${id} at line ${n}: rule marker inside a code fence`); continue }
    if (hidden || commentBefore || (opens >= 0 && opens < line.indexOf('**'))) { problems.push(`${id} at line ${n}: rule marker inside an HTML comment`); continue }
    if (indent) { problems.push(`${id} at line ${n}: rule marker is indented`); continue }
    if (!ID.test(id)) { problems.push(`"${id}" at line ${n}: malformed rule identifier`); continue }
    const body = rest.match(/^\s+—\s+(\S.*)$/)
    if (!body) { problems.push(`${id} at line ${n}: rule has no "— <statement>" after the identifier`); continue }
    rules.push({ id, line: n })
  }
  return { rules, problems }
}

/** Checks one layer's rule identifiers three ways: specification ↔ manifest ↔ inventory (where present); returns counts and errors. */
export function checkTrace ({ layer = 'encounter', spec, manifest, inventory = null } = {}) {
  const L = LAYERS[layer]
  if (!L) throw new Error(`unknown layer: ${layer}`)
  spec ??= L.spec
  manifest ??= L.manifest
  const ID = idRe(L.prefix)
  const errors = []
  const specText = readFileSync(spec, 'utf8')
  const { rules, problems } = parseSpecRules(specText, L.prefix)
  errors.push(...problems)

  // ID uniqueness in the specification — always.
  const count = new Map()
  for (const r of rules) count.set(r.id, (count.get(r.id) ?? 0) + 1)
  for (const [id, n] of count) if (n > 1) errors.push(`${id}: appears ${n} times as a rule in the specification`)

  const compare = (label, ids) => {
    if (!ids.length) { errors.push(`${label} lists no rule identifiers`); return }
    const seen = new Set()
    for (const id of ids) {
      if (!ID.test(id)) errors.push(`${label}: malformed identifier "${id}"`)
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
    else inventoryCount = compare('inventory', inventoryIds(readFileSync(inventory, 'utf8'), L.prefix, L.inventorySection, L.inventoryColumn))
  }
  return { rules: count.size, manifest: manifestCount, inventory: inventoryCount, errors }
}

// Which inventory to use: an explicit ENCOUNTER_INVENTORY / ACCESS_INVENTORY /
// MEMBERSHIP_INVENTORY
// (or --inventory) is mandatory; otherwise the sibling workshop checkout
// when present.
export const resolveInventory = (explicit, layer = 'encounter') => {
  if (explicit) return { path: explicit, required: true }
  const d = LAYERS[layer].inventory
  if (existsSync(d)) return { path: d, required: false }
  return { path: null, required: false }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  const LAYER = `[--layer ${Object.keys(LAYERS).join('|')}]`
  const USAGE = `usage: check-encounter-trace.mjs ${LAYER} [<inventory.md>] [--inventory <file>] [--spec <file>] [--manifest <file>]\n       check-encounter-trace.mjs ${LAYER} --write-manifest <inventory.md> [--manifest <file>]\n       check-encounter-trace.mjs ${LAYER} --write-manifest-from-spec <spec.md> [--manifest <file>]\n       check-encounter-trace.mjs --layer membership --coverage [--state-dependent <file>] [--spec <file>] [--manifest <file>]`
  const usage = (msg) => { console.error(`${msg}\n${USAGE}`); process.exit(2) }
  const KNOWN = ['--layer', '--inventory', '--spec', '--manifest', '--write-manifest', '--write-manifest-from-spec', '--state-dependent']
  const FLAGS = ['--coverage']
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (!a.startsWith('--')) continue
    if (FLAGS.includes(a)) continue
    if (!KNOWN.includes(a)) usage(`unknown option: ${a}`)
    const v = args[i + 1]
    if (v === undefined || v.startsWith('--')) usage(`option ${a} needs a value`)
    i++
  }
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
  const layer = opt('--layer') ?? 'encounter'
  const L = LAYERS[layer]
  if (!L) usage(`unknown layer: ${layer}`)
  const layerFlag = layer === 'encounter' ? '' : ` --layer ${layer}`
  // --coverage (membership): manifest = vector-checked ∪ state-dependent, disjoint
  // (RLTP-MT-10080, 10100). The state-dependent set is read from Section 10.3
  // of the specification, or from --state-dependent / MEMBERSHIP_STATE_DEPENDENT.
  if (args.includes('--coverage')) {
    if (layer !== 'membership') usage('--coverage is defined for --layer membership only')
    const { membershipCoverage } = await import('./membership-checks.mjs')
    const r = membershipCoverage({ spec: opt('--spec') ?? L.spec, manifestPath: opt('--manifest') ?? L.manifest, stateFile: opt('--state-dependent') ?? process.env.MEMBERSHIP_STATE_DEPENDENT ?? null })
    for (const c of r.checks) console.log(`  ${c.ok ? 'ok   ' : 'ERROR'} ${c.msg} [${c.rules.join(', ')}]`)
    for (const e of r.errors) console.error(`  ERROR ${e}`)
    console.log(`${r.counts.manifest} rules: ${r.counts.full} checked completely (${r.counts.runner} by the conformance runner, ${r.counts.validate} by the validation script), ${r.counts.partial} in part, ${r.counts.stateDependent} state-dependent (${r.stateSource})${r.errors.length ? `, ${r.errors.length} error(s).` : ' — coverage closed.'}`)
    process.exit(r.errors.length ? 1 : 0)
  }
  const write = (ids, source, how) => {
    if (!ids.length) { console.error(`${source} lists no rule identifiers`); process.exit(1) }
    const out = opt('--manifest') ?? L.manifest
    writeFileSync(out, `# ${L.title} — rule identifiers, one per line, generated from the ${source}.\n# Regenerate: node scripts/check-encounter-trace.mjs${layerFlag} ${how}\n${ids.join('\n')}\n`)
    console.log(`${ids.length} identifiers written to ${out}`)
    process.exit(0)
  }
  if (args.includes('--write-manifest')) {
    write(inventoryIds(readFileSync(opt('--write-manifest'), 'utf8'), L.prefix, L.inventorySection, L.inventoryColumn), 'rule inventory', '--write-manifest <inventory.md>')
  }
  if (args.includes('--write-manifest-from-spec')) {
    const { rules, problems } = parseSpecRules(readFileSync(opt('--write-manifest-from-spec'), 'utf8'), L.prefix)
    if (problems.length) { for (const p of problems) console.error(`  ERROR ${p}`); process.exit(1) }
    write([...new Set(rules.map((r) => r.id))], 'specification', '--write-manifest-from-spec <spec.md>')
  }
  const positional = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').startsWith('--'))
  if (positional.length > 1) usage(`unexpected argument: ${positional[1]}`)
  const { path: inventory } = resolveInventory(opt('--inventory') ?? positional[0] ?? process.env[L.env], layer)
  const r = checkTrace({ layer, spec: opt('--spec'), manifest: opt('--manifest'), inventory })
  for (const e of r.errors) console.error(`  ERROR ${e}`)
  console.log(`${r.rules} rule identifiers in the specification, ${r.manifest} in the manifest${r.inventory === null ? ', inventory not checked' : `, ${r.inventory} in the inventory`}${r.errors.length ? `, ${r.errors.length} error(s).` : ' — trace complete.'}`)
  process.exit(r.errors.length ? 1 : 0)
}
