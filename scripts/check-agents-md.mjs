#!/usr/bin/env node
// Keeps AGENTS.md and CLAUDE.md true to the repository's structure.
//
// The agent guide goes stale when the repository grows: a new directory,
// a renamed script, a moved workflow. This script checks three things:
//
//   · every top-level directory (and every directory under apps/) has a
//     line in the "Repository Layout" block of AGENTS.md;
//   · every path the two files name that starts with a top-level entry
//     (`scripts/validate.mjs`, `.github/workflows/validate.yml`) exists,
//     tracked or ignored by git (build output such as lib/dist counts);
//     relative paths such as `understand/` are left alone;
//   · every `npm run <name>` and `npm test` names a script of the package
//     it runs in: the root, or the package directory named before it on
//     the same line, as `cd <dir>` or as `<dir>/` in inline code.
//
//   usage: node scripts/check-agents-md.mjs
//
// Exit 1 on any error, 2 on usage errors.
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONTAINERS = ['apps']
const FILES = ['AGENTS.md', 'CLAUDE.md']

// files: { 'AGENTS.md': text, 'CLAUDE.md': text }; tracked: git ls-files;
// packages: { '<dir or empty>': package.json }; ignored: paths or a predicate.
export function checkAgents({ files, tracked, packages, ignored }) {
  const errors = []
  const isIgnored = typeof ignored === 'function' ? ignored : (p) => ignored.includes(p)
  const trackedSet = new Set(tracked)
  const top = new Set(tracked.map((f) => f.split('/')[0]))
  const exists = (p) => {
    const path = p.replace(/\/$/, '')
    return trackedSet.has(path) || tracked.some((f) => f.startsWith(path + '/')) || isIgnored(path)
  }

  // directories and the layout block
  const agents = files['AGENTS.md'] ?? ''
  const block = agents.match(/## Repository Layout[\s\S]*?```[^\n]*\n([\s\S]*?)```/)?.[1] ?? ''
  const listed = new Set(block.split('\n').map((l) => l.match(/^(\S+\/)/)?.[1]).filter(Boolean))
  const dirs = []
  for (const f of tracked) {
    const parts = f.split('/')
    if (parts.length < 2 || parts[0].startsWith('.')) continue
    const dir = CONTAINERS.includes(parts[0]) && parts.length > 2 ? `${parts[0]}/${parts[1]}/` : `${parts[0]}/`
    if (!dirs.includes(dir)) dirs.push(dir)
  }
  for (const dir of dirs) if (!listed.has(dir)) errors.push({ file: 'AGENTS.md', line: 1, msg: `${dir} is not in the Repository Layout` })

  // paths and npm scripts, line by line
  for (const file of FILES) {
    const lines = (files[file] ?? '').split('\n')
    lines.forEach((line, i) => {
      // brackets and parentheses split too, so a Markdown link destination
      // stands alone; a fragment or query is not part of the path
      for (const raw of line.split(/[\s`()[\]]+/)) {
        const token = raw.replace(/[#?].*$/, '').replace(/^["'<]+/, '').replace(/[.,;:"'>]+$/, '')
        if (!token.includes('/') || /[$*<>{}]/.test(token)) continue
        if (!top.has(token.split('/')[0])) continue
        if (!exists(token)) errors.push({ file, line: i + 1, msg: `${token} does not exist` })
      }
      for (const m of line.matchAll(/npm (?:run (?:--silent )?([\w:.-]+)|(test)\b)/g)) {
        // the package: the last `cd <dir>` or `<dir>/` naming a package before it
        const before = line.slice(0, m.index)
        const hints = [...before.matchAll(/\bcd (\S+)|`([^`\s]+)\/`/g)].map((h) => (h[1] ?? h[2]).replace(/\/$/, ''))
          .filter((h) => h === '..' || h in packages)
        const dir = !hints.length || hints.at(-1) === '..' ? '' : hints.at(-1)
        const name = m[1] ?? m[2]
        const pkg = packages[dir]
        const where = `${dir ? dir + '/' : ''}package.json`
        if (!pkg) errors.push({ file, line: i + 1, msg: `npm ${m[1] ? 'run ' : ''}${name}: no ${where}` })
        else if (!pkg.scripts?.[name]) errors.push({ file, line: i + 1, msg: `npm ${m[1] ? 'run ' : ''}${name}: no such script in ${where}` })
      }
    })
  }
  return errors
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.length > 2) {
    console.error('usage: node scripts/check-agents-md.mjs')
    process.exit(2)
  }
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
  const files = Object.fromEntries(FILES.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]))
  const packages = {}
  for (const f of tracked.filter((f) => /^(?:[^/]+\/)?package\.json$/.test(f) || /^apps\/[^/]+\/package\.json$/.test(f))) {
    if (existsSync(join(ROOT, f))) packages[dirname(f) === '.' ? '' : dirname(f)] = JSON.parse(readFileSync(join(ROOT, f), 'utf8'))
  }
  // a directory pattern (`dist/`) matches only a path asked as a directory
  const ignored = (p) => [p, `${p}/`].some((q) => { try { execFileSync('git', ['check-ignore', '-q', q], { cwd: ROOT }); return true } catch { return false } })
  const errors = checkAgents({ files, tracked, packages, ignored })
  const gh = process.env.GITHUB_ACTIONS === 'true'
  for (const e of errors) {
    if (gh) console.log(`::error file=${e.file},line=${e.line}::${e.msg}`)
    console.error(`  ERROR ${e.file}:${e.line} ${e.msg}`)
  }
  console.log(errors.length ? `agent files: ${errors.length} error(s)` : 'agent files: ok')
  process.exit(errors.length ? 1 : 0)
}
