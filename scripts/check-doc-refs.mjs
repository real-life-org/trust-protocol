#!/usr/bin/env node
// Checks the references from outside the specifications into them.
//
// The site pages, the READMEs and the term register link into sections of
// the specifications by anchor, and the READMEs name the casting of each
// layer. A new casting that renames or renumbers a section, or that moves a
// layer to a new version, breaks those references silently. This script
// finds them:
//
//   · anchors: every `spec/<file>.md#<anchor>` in any tracked file outside
//     the archives must name an existing specification and one of its
//     headings, slugged the way GitHub slugs them (or an explicit
//     `<a id>`) — an error otherwise;
//   · versions: a layer named with a version (`Trust Layer 0.31`) in
//     README.md must name the current casting — an error otherwise. In
//     lib/README.md, which states what the library implements, a version
//     behind the current casting is STALE (a warning, an error with
//     --strict); a version ahead of it is always an error.
//
// A mention counts as a version only when its major number is the layer's
// current major number; `Access 3.4` names a section, not a casting.
//
//   usage: node scripts/check-doc-refs.mjs [--strict]
//
// Exit 1 on any error, 2 on usage errors.
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { SPECS, PIN, parseHeader } from './check-companion-pins.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── slugs ───────────────────────────────────────────────────────────────

// The anchor GitHub gives a heading: the heading's rendered text, lower
// case, everything but letters, marks, digits, connector punctuation,
// hyphens and spaces removed, spaces turned into hyphens.
export function slugify(heading) {
  const text = heading.trim().split(/(`+[^`]*`+)/).map((part, i) => {
    if (i % 2) return part.replace(/^`+|`+$/g, '')
    return part
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/\\(.)/g, '$1')
      .replace(/(^|[^\p{L}\p{N}])(__?)(?=\S)(.*?\S)\2(?![\p{L}\p{N}])/gu, '$1$3')
  }).join('')
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '').replace(/ /g, '-')
}

// Every anchor a Markdown document offers: its ATX headings outside fenced
// code (repeats numbered -1, -2, … as GitHub does) and explicit <a id>/<a name>.
export function anchorsOf(markdown) {
  const anchors = new Set()
  const seen = new Map()
  let fence = null
  for (const line of markdown.split('\n')) {
    const f = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (f) {
      if (!fence) fence = f[1][0]
      else if (f[1][0] === fence) fence = null
      continue
    }
    if (fence) continue
    const h = line.match(/^ {0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/)
    if (h) {
      const base = slugify(h[1])
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      anchors.add(n ? `${base}-${n}` : base)
    }
    for (const a of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(a[1])
  }
  return anchors
}

// ── links ───────────────────────────────────────────────────────────────

// A path to spec/<file>.md#<anchor>, with what stands before `spec/`. A bare
// or relative path, a site path, and a URL into this repository count; a
// URL into another repository (wot-spec has a spec/ too) does not.
const LINK = /(?<![\w.:/~%-])([\w.:/~%-]*\/)?spec\/([a-z0-9-]+\.md)#([\p{L}\p{M}\p{N}_%-]+)/gu
const OURS = /^(?:(?:\.\.?\/)*|\/|https:\/\/github\.com\/real-life-org\/trust-protocol\/(?:blob|tree)\/[^/]+\/)$/
const lineAt = (text, index) => text.slice(0, index).split('\n').length

export function findAnchorLinks(text) {
  return [...text.matchAll(LINK)].filter((m) => OURS.test(m[1] ?? '')).map((m) => {
    let anchor = m[3]
    try { anchor = decodeURIComponent(anchor) } catch { /* keep it as written */ }
    return { spec: m[2], anchor, line: lineAt(text, m.index) }
  })
}

export function checkAnchors(root, files) {
  const errors = []
  const cache = new Map()
  const anchorsFor = (spec) => {
    if (!cache.has(spec)) {
      const path = join(root, 'spec', spec)
      cache.set(spec, existsSync(path) ? anchorsOf(readFileSync(path, 'utf8')) : null)
    }
    return cache.get(spec)
  }
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8')
    if (text.includes('\0')) continue
    for (const link of findAnchorLinks(text)) {
      const anchors = anchorsFor(link.spec)
      if (!anchors) errors.push({ file, line: link.line, msg: `spec/${link.spec} does not exist` })
      else if (!anchors.has(link.anchor)) errors.push({ file, line: link.line, msg: `spec/${link.spec} has no section #${link.anchor}` })
    }
  }
  return errors
}

// ── versions ────────────────────────────────────────────────────────────

const cmp = (a, b) => a[0] - b[0] || a[1] - b[1]
const fmt = (v) => v.join('.')

export function checkVersions(root) {
  const errors = []
  const stale = []
  const current = {}
  for (const [name, file] of Object.entries(SPECS)) {
    const path = join(root, 'spec', file)
    if (existsSync(path)) current[name] = parseHeader(readFileSync(path, 'utf8')).version
  }
  for (const [file, lagAllowed] of [['README.md', false], ['lib/README.md', true]]) {
    const path = join(root, file)
    if (!existsSync(path)) continue
    const text = readFileSync(path, 'utf8')
    for (const m of text.matchAll(PIN)) {
      const now = current[m[1]]
      const named = [Number(m[2]), Number(m[3])]
      if (!now || named[0] !== now[0]) continue
      const d = cmp(named, now)
      if (d === 0) continue
      const what = m[0].replace(/\s+/g, ' ')
      const where = { file, line: lineAt(text, m.index) }
      if (d > 0) errors.push({ ...where, msg: `names ${what}, but ${SPECS[m[1]]} is at ${fmt(now)}` })
      else (lagAllowed ? stale : errors).push({ ...where, msg: `names ${what}, ${SPECS[m[1]]} is at ${fmt(now)}` })
    }
  }
  return { errors, stale }
}

// ── command line ────────────────────────────────────────────────────────

const SKIP = /^(spec|simulator)\/archive\/|(^|\/)node_modules\//

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2)
  if (args.some((a) => a !== '--strict')) {
    console.error('usage: node scripts/check-doc-refs.mjs [--strict]')
    process.exit(2)
  }
  const strict = args.includes('--strict')
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0').filter((f) => f && !SKIP.test(f) && existsSync(join(ROOT, f)))
  const anchorErrors = checkAnchors(ROOT, files)
  const links = files.reduce((n, f) => n + findAnchorLinks(readFileSync(join(ROOT, f), 'utf8')).length, 0)
  const { errors, stale } = checkVersions(ROOT)
  const gh = process.env.GITHUB_ACTIONS === 'true'
  const show = (level, e) => {
    if (gh) console.log(`::${level} file=${e.file},line=${e.line}::${e.msg}`)
    console.error(`  ${level.toUpperCase()} ${e.file}:${e.line} ${e.msg}`)
  }
  for (const e of [...anchorErrors, ...errors]) show('error', e)
  for (const s of stale) show(strict ? 'error' : 'warning', s)
  const failed = anchorErrors.length + errors.length + (strict ? stale.length : 0)
  console.log(failed ? `doc refs: ${failed} error(s), ${strict ? 0 : stale.length} stale`
    : `doc refs: ok, ${links} section links${stale.length ? ` (${stale.length} stale)` : ''}`)
  process.exit(failed ? 1 : 0)
}
