#!/usr/bin/env node
// Type-checks the code samples on the site and in the library README
// against the library as it is built now.
//
// Every ```ts block in apps/site/src/content/docs/ and lib/README.md that
// imports from @real-life/trust-protocol is written into lib/ (so the
// package resolves to itself through its `exports`) and checked with the
// library's own TypeScript. A sample that imports an entry point or an
// export the library no longer has, or calls a method a holder no longer
// offers, fails. Two diagnostics are tolerated, TS2304 (cannot find name)
// and TS18004 (no value for a shorthand property), so a sample may use a
// placeholder such as `envelope` or `{ digest }` for what the app supplies.
// Node's own modules (`node:test`) are declared as untyped.
//
// Needs lib/dist: run after `cd lib && npm ci && npm run build`.
//
//   usage: node scripts/check-code-samples.mjs
//
// Exit 1 on any failing sample, 2 on usage errors or a missing build.
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PKG = '@real-life/trust-protocol'
const TOLERATED = new Set(['TS2304', 'TS18004'])

// The samples of a Markdown text: TypeScript blocks importing the library,
// each with the line its code starts on.
export function extractSamples(text) {
  const out = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^ {0,3}(`{3,})(ts|typescript)\s*$/)
    if (!open) continue
    const end = lines.findIndex((l, j) => j > i && l.trim() === open[1])
    if (end === -1) break
    const code = lines.slice(i + 1, end).join('\n')
    if (code.includes(`'${PKG}`) || code.includes(`"${PKG}`)) out.push({ line: i + 2, code })
    i = end
  }
  return out
}

// The diagnostics of `tsc --pretty false` that are not tolerated, by sample
// index (files are named s<index>.ts) and line within the sample.
export function failures(output) {
  const out = []
  for (const m of output.matchAll(/^s(\d+)\.ts\((\d+),\d+\): error (TS\d+): (.*)$/gm)) {
    if (!TOLERATED.has(m[3])) out.push({ sample: Number(m[1]), line: Number(m[2]), msg: `${m[3]}: ${m[4]}` })
  }
  return out
}

const sources = () => {
  const out = ['lib/README.md']
  const walk = (dir) => {
    for (const e of readdirSync(join(ROOT, dir)).sort()) {
      const p = join(dir, e)
      if (statSync(join(ROOT, p)).isDirectory()) walk(p)
      else if (/\.mdx?$/.test(e)) out.push(p)
    }
  }
  walk('apps/site/src/content/docs')
  return out
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.length > 2) {
    console.error('usage: node scripts/check-code-samples.mjs')
    process.exit(2)
  }
  const tsc = join(ROOT, 'lib/node_modules/typescript/bin/tsc')
  if (!existsSync(join(ROOT, 'lib/dist/index.d.ts')) || !existsSync(tsc)) {
    console.error('lib/dist or the library\'s TypeScript is missing: cd lib && npm ci && npm run build')
    process.exit(2)
  }
  const samples = sources().flatMap((file) => extractSamples(readFileSync(join(ROOT, file), 'utf8')).map((s) => ({ file, ...s })))
  const dir = mkdtempSync(join(ROOT, 'lib', '.samples-'))
  let result
  try {
    samples.forEach((s, i) => writeFileSync(join(dir, `s${i}.ts`), s.code + '\n'))
    writeFileSync(join(dir, 'node.d.ts'), "declare module 'node:*'\n")
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', target: 'es2022', lib: ['es2022', 'dom'], strict: true, noEmit: true, skipLibCheck: true, types: [] },
      include: ['*.ts'],
    }))
    result = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.json', '--pretty', 'false'], { cwd: dir, encoding: 'utf8' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  const failed = failures(result.stdout + result.stderr)
  const gh = process.env.GITHUB_ACTIONS === 'true'
  for (const f of failed) {
    const s = samples[f.sample]
    const line = s.line + f.line - 1
    if (gh) console.log(`::error file=${s.file},line=${line}::${f.msg}`)
    console.error(`  ERROR ${s.file}:${line} ${f.msg}`)
  }
  if (!failed.length && result.status !== 0 && !/error TS/.test(result.stdout + result.stderr)) {
    console.error(result.stdout + result.stderr)
    process.exit(1)
  }
  console.log(failed.length ? `code samples: ${failed.length} error(s) in ${samples.length} samples`
    : `code samples: ok, ${samples.length} samples against lib ${relative(ROOT, join(ROOT, 'lib/dist'))}`)
  process.exit(failed.length ? 1 : 0)
}
