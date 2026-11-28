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
//   · with --since <ref>: a page is PENDING when, against the merge base,
//     the frozen text of a specification it names changed (spec/*.md below
//     its generated status block, not the archive), a library release
//     changed lib/package.json and the page has `library: true`, or the
//     content of a region on the page that scripts/build-spec-status.mjs
//     generates changed; unless the same change edits what a person wrote
//     on the page (the page with its regions emptied). Pending pages fail
//     the check, unless
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
import { frozenText, handwritten, generated } from './build-spec-status.mjs'

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

export const pages = (root) => {
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

// The pages that rest on a changed specification, describe the library
// when the change is a release, or carry a changed generated region, and
// whose handwritten text the change leaves as it was; each with the changed
// specifications it names, `library: true` for a page a release makes
// pending and `generated: true` for one whose regions changed. `base` maps
// changed specifications and pages to their text at the merge base (null
// for a new file); without it, a changed specification counts as changed
// in its frozen text and a changed page as edited by a person.
export function pendingPages(root, changedFiles, { release = false, base = new Map() } = {}) {
  const read = (f) => (existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : '')
  const frozenChanged = (f) => !base.has(f) || frozenText(base.get(f) ?? '') !== frozenText(read(f))
  const changed = new Set(changedFiles.filter((f) => SPEC.test(f) && frozenChanged(f)).map((f) => f.match(SPEC)[1]))
  const edited = new Set(changedFiles)
  const out = []
  for (const file of pages(root)) {
    const text = read(file)
    const before = !edited.has(file) ? text : base.has(file) ? base.get(file) : null
    if (before === null || handwritten(before, file) !== handwritten(text, file)) continue
    const specs = (parseSpecs(text) ?? []).filter((s) => changed.has(s))
    const library = release && parseLibrary(text) === true
    const regions = generated(before, file) !== generated(text, file)
    if (specs.length || library || regions) out.push({ file, specs, ...(library ? { library } : {}), ...(regions ? { generated: true } : {}) })
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
    const merge = execFileSync('git', ['merge-base', since, 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
    const show = (f) => { try { return execFileSync('git', ['show', `${merge}:${f}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return null } }
    const changed = diff.split('\n').filter(Boolean)
    const base = new Map(changed.filter((f) => SPEC.test(f) || f.startsWith(`${DOCS}/`)).map((f) => [f, show(f)]))
    pending = pendingPages(ROOT, changed, { release: released(since), base })
    const level = checked ? 'notice' : 'error'
    for (const p of pending) {
      const what = [...p.specs, ...(p.library ? ['the library, which this change releases'] : []), ...(p.generated ? ['spec/status.json, whose generated text on it changed'] : [])].join(', ')
      const msg = `rests on ${what}${p.specs.length ? ' (edited by this change)' : ''}; update the page, or read it and label the pull request docs-checked`
      if (gh) console.log(`::${level} file=${p.file},line=1::${msg}`)
      console.error(`  ${checked ? 'CHECKED' : 'PENDING'} ${p.file} ${msg}`)
    }
    if (process.env.GITHUB_STEP_SUMMARY && pending.length) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
        `### Site pages resting on what this change edits`, '',
        ...pending.map((p) => `- [${checked ? 'x' : ' '}] \`${p.file}\` (${[...p.specs, ...(p.library ? ['library release'] : []), ...(p.generated ? ['generated text'] : [])].join(', ')})`), '',
        checked ? 'Labelled `docs-checked`: read and still true.' : 'Update these pages in this pull request, or read them and add the label `docs-checked`.', '',
      ].join('\n'))
    }
  }
  const failed = errors.length + (checked ? 0 : pending.length)
  console.log(failed ? `doc specs: ${errors.length} error(s), ${checked ? 0 : pending.length} pending page(s)`
    : `doc specs: ok${pending.length ? ` (${pending.length} page(s) labelled docs-checked)` : ''}`)
  process.exit(failed ? 1 : 0)
}
