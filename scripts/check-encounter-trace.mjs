#!/usr/bin/env node
// Traceability check for the Encounter Layer: every rule of the rule
// inventory (the 0.29 → 0.30 trace table, kept outside this repository)
// appears exactly once in spec/encounter-layer.md as `**RLTP-ENC-nnnn**`,
// and the specification carries no rule identifier the inventory does
// not list.
//
//   usage: node scripts/check-encounter-trace.mjs <inventory.md> [spec.md]
//
// Exit 1 on any violation. scripts/validate.mjs calls checkTrace() and
// skips when the inventory is not present (CI has no copy of it).
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const DEFAULT_SPEC = join(ROOT, 'spec/encounter-layer.md')

// Inventory rows with an ID of their own start `| RLTP-ENC-nnnn |`;
// rows starting `| = RLTP-ENC-…` are references to another row.
export const inventoryIds = (text) =>
  [...text.matchAll(/^\|\s*(RLTP-ENC-\d+)\s*\|/gm)].map((m) => m[1])

// A rule in the specification is `**RLTP-ENC-nnnn**` at a line start.
export const specRuleIds = (text) =>
  [...text.matchAll(/^\*\*(RLTP-ENC-\d+)\*\*/gm)].map((m) => m[1])

export function checkTrace (inventoryPath, specPath = DEFAULT_SPEC) {
  const inv = inventoryIds(readFileSync(inventoryPath, 'utf8'))
  const spec = specRuleIds(readFileSync(specPath, 'utf8'))
  const errors = []
  const invSet = new Set(inv)
  const dupInv = inv.filter((id, i) => inv.indexOf(id) !== i)
  for (const id of new Set(dupInv)) errors.push(`inventory lists ${id} more than once`)
  const count = new Map()
  for (const id of spec) count.set(id, (count.get(id) ?? 0) + 1)
  for (const id of inv) {
    const n = count.get(id) ?? 0
    if (n === 0) errors.push(`${id}: in the inventory, not a rule in the specification`)
    else if (n > 1) errors.push(`${id}: appears ${n} times as a rule in the specification`)
  }
  for (const id of count.keys()) if (!invSet.has(id)) errors.push(`${id}: a rule in the specification, not in the inventory`)
  return { inventory: inv.length, rules: count.size, errors }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [inventoryPath, specPath] = process.argv.slice(2)
  if (!inventoryPath) { console.error('usage: check-encounter-trace.mjs <inventory.md> [spec.md]'); process.exit(2) }
  const r = checkTrace(inventoryPath, specPath)
  for (const e of r.errors) console.error(`  ERROR ${e}`)
  console.log(`${r.inventory} inventory rules, ${r.rules} rule identifiers in the specification${r.errors.length ? `, ${r.errors.length} error(s).` : ' — trace complete.'}`)
  process.exit(r.errors.length ? 1 : 0)
}
