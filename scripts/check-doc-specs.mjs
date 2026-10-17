#!/usr/bin/env node
// Keeps the site's pages in step with the specifications they explain.
//
// Every page under apps/site/src/content/docs/ names, in its frontmatter,
// the specifications it rests on:
//
//   specs: [access-layer, membership-tasks]
//
// (`specs: []` for a page that rests on none). A page that describes the
// library adds `library: true`; it then also follows every library release,
// a change of the version in lib/package.json. A link check cannot tell
// whether a sentence on a page is still true after a new casting; this
// script makes sure somebody looked:
//
//   · without arguments: every page declares `specs`, and every name in it
//     is a specification in spec/ — an error otherwise (runs in
//     npm run validate);
//   · with --since <ref>: the specifications changed since <ref> (spec/*.md,
//     not the archive) make every page that names them PENDING, and so
//     does a library release for every `library: true` page, unless the
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

const frontmatter = (text) => text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''

// Whether the page declares `library: true`; null for a value other than
// true or false.
export function parseLibrary(text) {
  const v = frontmatter(text).match(/^library:\s*(.*?)\s*$/m)?.[1]
  return v === undefined || v === 'false' ? false : v === 'true' ? true : null
}

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
    const text = readFileSync(join(root, file), 'utf8')
    if (parseLibrary(text) === null) errors.push({ file, msg: 'library: must be true or false' })
    const specs = parseSpecs(text)
    if (!specs) { errors.push({ file, msg: 'no specs: in the frontmatter (use [] for a page that rests on no specification)' }); continue }
    for (const s of specs) {
      if (!existsSync(join(root, 'spec', `${s}.md`))) errors.push({ file, msg: `specs names ${s}, which is no specification in spec/` })
    }
  }
  return errors
}

// The pages that rest on a changed specification, or describe the library
// when the change is a release, and that the change does not touch; each
// with the changed specifications it names and `library: true` for a page
// a release makes pending.
export function pendingPages(root, changedFiles, { release = false } = {}) {
  const changed = new Set(changedFiles.map((f) => f.match(SPEC)?.[1]).filter(Boolean))
  if (!changed.size && !release) return []
  const touched = new Set(changedFiles)
  const out = []
  for (const file of pages(root)) {
    if (touched.has(file)) continue
    const text = readFileSync(join(root, file), 'utf8')
    const specs = (parseSpecs(text) ?? []).filter((s) => changed.has(s))
    const library = release && parseLibrary(text) === true
    if (specs.length || library) out.push(library ? { file, specs, library } : { file, specs })
  }
  return out
}

// Whether lib/package.json names another version at HEAD than at <since>.
const released = (since) => {
  const version = (ref) => { try { return JSON.parse(execFileSync('git', ['show', `${ref}:lib/package.json`], { cwd: ROOT, encoding: 'utf8' })).version } catch { return null } }
  return version(since) !== version('HEAD')
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
    pending = pendingPages(ROOT, diff.split('\n').filter(Boolean), { release: released(since) })
    const level = checked ? 'notice' : 'error'
    for (const p of pending) {
      const what = [...p.specs, ...(p.library ? ['the library, which this change releases'] : [])].join(', ')
      const msg = `rests on ${what}${p.specs.length ? ' (edited by this change)' : ''}; update the page, or read it and label the pull request docs-checked`
      if (gh) console.log(`::${level} file=${p.file},line=1::${msg}`)
      console.error(`  ${checked ? 'CHECKED' : 'PENDING'} ${p.file} ${msg}`)
    }
    if (process.env.GITHUB_STEP_SUMMARY && pending.length) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
        `### Site pages resting on what this change edits`, '',
        ...pending.map((p) => `- [${checked ? 'x' : ' '}] \`${p.file}\` (${[...p.specs, ...(p.library ? ['library release'] : [])].join(', ')})`), '',
        checked ? 'Labelled `docs-checked`: read and still true.' : 'Update these pages in this pull request, or read them and add the label `docs-checked`.', '',
      ].join('\n'))
    }
  }
  const failed = errors.length + (checked ? 0 : pending.length)
  console.log(failed ? `doc specs: ${errors.length} error(s), ${checked ? 0 : pending.length} pending page(s)`
    : `doc specs: ok${pending.length ? ` (${pending.length} page(s) labelled docs-checked)` : ''}`)
  process.exit(failed ? 1 : 0)
}
