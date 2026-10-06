#!/usr/bin/env node
// Companion-pin check across the specifications in spec/.
//
// Every specification names, in its header, the versions of the other
// RLTP specifications it was written against (`Companions`, `Companion
// pins`, `Position`). Those pins are written by hand and go stale
// silently whenever a companion is cast again. This script reads the
// current version of every specification and compares each pin with it:
//   · a pin behind the companion's current version is STALE — reported
//     as a warning (a GitHub annotation in CI), and as an error with
//     --strict;
//   · a pin ahead of the companion's current version names a version
//     that does not exist — always an error.
//
//   usage: node scripts/check-companion-pins.mjs [--strict] [--dir <spec dir>]
//
// Exit 1 on any error, 2 on usage errors.
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// The name a pin uses for a specification, and the file that holds it.
export const SPECS = {
  Identity: 'identity-layer.md',
  Encounter: 'encounter-layer.md',
  Access: 'access-layer.md',
  Delivery: 'delivery-contract.md',
  Membership: 'membership-tasks.md',
  Replication: 'replication-contract.md',
  Visibility: 'network-visibility.md',
  Predicates: 'personhood-predicates.md',
  Succession: 'succession.md',
}
const PIN = new RegExp(`\\b(${Object.keys(SPECS).join('|')})(?:\\s+(?:Layer|Contract|Tasks))?\\s+(\\d+)\\.(\\d+)\\b`, 'g')
const PIN_FIELD = /^(companion|position)/i

// The header is everything before the first `## ` heading. A field is a
// `- **Name:** value` bullet with its continuation lines.
export function parseHeader(text) {
  const lines = text.split('\n')
  const end = lines.findIndex((l) => l.startsWith('## '))
  const header = end === -1 ? lines : lines.slice(0, end)
  const fields = []
  header.forEach((line, i) => {
    const m = line.match(/^- \*\*([^*:]+):?\*\*:?\s*(.*)$/)
    if (m) fields.push({ name: m[1].trim(), parts: [{ line: i + 1, text: m[2] }] })
    else if (fields.length && /^\s+\S/.test(line)) fields.at(-1).parts.push({ line: i + 1, text: line.trim() })
    else if (fields.length && line.trim() === '') fields.push({ name: '', parts: [] })
  })
  const version = fields.find((f) => f.name === 'Version')?.parts[0]?.text.match(/^(\d+)\.(\d+)/)
  const pins = []
  for (const f of fields.filter((f) => PIN_FIELD.test(f.name))) {
    // Join continuation lines so a pin broken across lines still matches;
    // remember where each line starts to report the right line number.
    let joined = ''
    const starts = []
    for (const p of f.parts) { starts.push({ at: joined.length, line: p.line }); joined += p.text.replace(/\*\*/g, '') + ' ' }
    for (const m of joined.matchAll(PIN)) {
      const line = starts.filter((s) => s.at <= m.index).at(-1).line
      pins.push({ name: m[1], minor: [Number(m[2]), Number(m[3])], text: m[0], line })
    }
  }
  return { version: version ? [Number(version[1]), Number(version[2])] : null, pins }
}

const cmp = (a, b) => a[0] - b[0] || a[1] - b[1]
const fmt = (v) => v.join('.')

export function checkPins(dir) {
  const errors = []
  const stale = []
  const docs = {}
  for (const [name, file] of Object.entries(SPECS)) {
    try { docs[name] = { file: join(dir, file), ...parseHeader(readFileSync(join(dir, file), 'utf8')) } }
    catch { errors.push(`${file}: missing`); continue }
    if (!docs[name].version) errors.push(`${file}: no **Version:** field in the header`)
  }
  for (const [name, doc] of Object.entries(docs)) {
    for (const pin of doc.pins) {
      if (pin.name === name) continue
      const target = docs[pin.name]
      if (!target?.version) continue
      const where = { file: doc.file, line: pin.line }
      const d = cmp(pin.minor, target.version)
      if (d > 0) errors.push({ ...where, msg: `pins ${pin.text}, but ${SPECS[pin.name]} is at ${fmt(target.version)}` })
      else if (d < 0) stale.push({ ...where, msg: `pins ${pin.text}, ${SPECS[pin.name]} is at ${fmt(target.version)}` })
    }
  }
  return { errors, stale }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const strict = args.includes('--strict')
  const di = args.indexOf('--dir')
  if (args.some((a, i) => !['--strict', '--dir'].includes(a) && args[i - 1] !== '--dir') || (di !== -1 && !args[di + 1])) {
    console.error('usage: node scripts/check-companion-pins.mjs [--strict] [--dir <spec dir>]')
    process.exit(2)
  }
  const dir = di === -1 ? join(ROOT, 'spec') : args[di + 1]
  const { errors, stale } = checkPins(dir)
  const gh = process.env.GITHUB_ACTIONS === 'true'
  const show = (level, e) => {
    if (typeof e === 'string') return console.error(`  ${level.toUpperCase()} ${e}`)
    const file = relative(ROOT, e.file)
    if (gh) console.log(`::${level} file=${file},line=${e.line}::${e.msg}`)
    console.error(`  ${level.toUpperCase()} ${file}:${e.line} ${e.msg}`)
  }
  for (const e of errors) show('error', e)
  for (const s of stale) show(strict ? 'error' : 'warning', s)
  const failed = errors.length + (strict ? stale.length : 0)
  console.log(failed ? `companion pins: ${failed} error(s), ${strict ? 0 : stale.length} stale`
    : `companion pins: ok${stale.length ? ` (${stale.length} stale)` : ''}`)
  process.exit(failed ? 1 : 0)
}
