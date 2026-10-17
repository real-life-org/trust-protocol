#!/usr/bin/env node
// Keeps the site's pages in step with the specifications they explain.
//
// Every page under apps/site/src/content/docs/ names, in its frontmatter,
// the specifications it rests on:
//
//   specs: [access-layer, membership-tasks]
//
// (`specs: []` for a page that rests on none). A link check cannot tell
// whether a sentence on a page is still true after a new casting; this
// script makes sure somebody looked:
//
//   · without arguments: every page declares `specs`, and every name in it
//     is a specification in spec/ — an error otherwise (runs in
//     npm run validate);
//   · with --since <ref>: the specifications changed since <ref> (spec/*.md,
//     not the archive) make every page that names them PENDING, unless the
//     same change touches that page. Pending pages fail the check, unless
//     --checked says a person has read them and they still hold (CI passes
//     it when the pull request carries the label `docs-checked`).
//
//   usage: node scripts/check-doc-specs.mjs [--since <ref> [--checked]]
//
// Exit 1 on any error or unchecked pending page, 2 on usage errors.
import { readFileSync, readdirSync, existsSync, statSync, appendFileSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DOCS = 'apps/site/src/content/docs'
const SPEC = /^spec\/([a-z0-9-]+)\.md$/

// The `specs:` list of a page's frontmatter, or null when it has none.
export function parseSpecs(text) {
  const fm = text.match(/^---\n([\s\S]*?)\n---/)
  const line = fm?.[1].match(/^specs:\s*\[(.*)\]\s*$/m)
  if (!line) return null
  return line[1].split(',').map((s) => s.trim()).filter(Boolean)
}

const pages = (root) => {
  const out = []
  const walk = (dir) => {
    for (const e of readdirSync(dir).sort()) {
      const p = join(dir, e)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.mdx?$/.test(e)) out.push(relative(root, p))
    }
  }
  if (existsSync(join(root, DOCS))) walk(join(root, DOCS))
  return out.sort()
}

export function checkDeclarations(root) {
  const errors = []
  for (const file of pages(root)) {
    const specs = parseSpecs(readFileSync(join(root, file), 'utf8'))
    if (!specs) { errors.push({ file, msg: 'no specs: in the frontmatter (use [] for a page that rests on no specification)' }); continue }
    for (const s of specs) {
      if (!existsSync(join(root, 'spec', `${s}.md`))) errors.push({ file, msg: `specs names ${s}, which is no specification in spec/` })
    }
  }
  return errors
}

// The pages that rest on a changed specification and that the change does
// not touch, each with the changed specifications it names.
export function pendingPages(root, changedFiles) {
  const changed = new Set(changedFiles.map((f) => f.match(SPEC)?.[1]).filter(Boolean))
  if (!changed.size) return []
  const touched = new Set(changedFiles)
  const out = []
  for (const file of pages(root)) {
    if (touched.has(file)) continue
    const specs = (parseSpecs(readFileSync(join(root, file), 'utf8')) ?? []).filter((s) => changed.has(s))
    if (specs.length) out.push({ file, specs })
  }
  return out
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2)
  const si = args.indexOf('--since')
  const since = si === -1 ? null : args[si + 1]
  const checked = args.includes('--checked')
  const known = args.every((a, i) => a === '--since' || a === '--checked' || (si !== -1 && i === si + 1))
  if (!known || (si !== -1 && (!since || since.startsWith('--'))) || (checked && !since)) {
    console.error('usage: node scripts/check-doc-specs.mjs [--since <ref> [--checked]]')
    process.exit(2)
  }
  const gh = process.env.GITHUB_ACTIONS === 'true'
  const errors = checkDeclarations(ROOT)
  for (const e of errors) {
    if (gh) console.log(`::error file=${e.file},line=1::${e.msg}`)
    console.error(`  ERROR ${e.file} ${e.msg}`)
  }
  let pending = []
  if (since) {
    const diff = execFileSync('git', ['diff', '--name-only', `${since}...HEAD`], { cwd: ROOT, encoding: 'utf8' })
    pending = pendingPages(ROOT, diff.split('\n').filter(Boolean))
    const level = checked ? 'notice' : 'error'
    for (const p of pending) {
      const msg = `rests on ${p.specs.join(', ')}, which this change edits; update the page, or read it and label the pull request docs-checked`
      if (gh) console.log(`::${level} file=${p.file},line=1::${msg}`)
      console.error(`  ${checked ? 'CHECKED' : 'PENDING'} ${p.file} ${msg}`)
    }
    if (process.env.GITHUB_STEP_SUMMARY && pending.length) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
        `### Site pages resting on the changed specifications`, '',
        ...pending.map((p) => `- [${checked ? 'x' : ' '}] \`${p.file}\` (${p.specs.join(', ')})`), '',
        checked ? 'Labelled `docs-checked`: read and still true.' : 'Update these pages in this pull request, or read them and add the label `docs-checked`.', '',
      ].join('\n'))
    }
  }
  const failed = errors.length + (checked ? 0 : pending.length)
  console.log(failed ? `doc specs: ${errors.length} error(s), ${checked ? 0 : pending.length} pending page(s)`
    : `doc specs: ok${pending.length ? ` (${pending.length} page(s) labelled docs-checked)` : ''}`)
  process.exit(failed ? 1 : 0)
}
