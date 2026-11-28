#!/usr/bin/env node
// Writes what spec/status.json says about each specification into the
// generated regions of the repository. A region stands between a begin and
// an end marker of one form, an HTML comment (in MDX a JSX comment):
//
//   <!-- spec-status --> … <!-- /spec-status -->   the status block at the top
//       of every spec/*.md, the status section of README.md, the document
//       table of apps/site/src/content/docs/reference/specifications.md;
//   <!-- spec-box --> … <!-- /spec-box -->         the box "Design and status"
//       on every page under understand/ and reference/ with a non-empty
//       `specs:` (the document table excepted);
//   <!-- now:<id>[:long] --> … <!-- /now:<id> -->  a statement about what the
//       library builds today, from `statements` in status.json.
//
// Only the text between the markers is written; everything else stays byte
// for byte. The register is first validated against spec/status.schema.json
// (its form), then against the repository (checkRegister below).
//
//   usage: node scripts/build-spec-status.mjs [--check]
//
// --check writes nothing and fails for every file whose content differs from
// what the generator produces. Exit 1 on any error, 2 on usage errors.
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { parseSpecs, pages } from './check-doc-specs.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = 'https://github.com/real-life-org/trust-protocol/blob/main'
const README = 'README.md'
const SITE = 'apps/site/src/content/docs/reference/specifications.md'
const DOCS = 'apps/site/src/content/docs'
const PRECEDENCE = 'Where a specification text and the library disagree, the library with its vectors and flows holds until the text is brought up to date.'
const BUILT = '*Built* means the library implements the part'
const DIFFERENCES_AT = 'Differences are documented where a note points, in `lib/DEVIATIONS.md`, in the header of the source file or in the named test.'

// ── regions ─────────────────────────────────────────────────────────────

const MARKER = {
  md: /<!-- (\/?)(spec-status|spec-box|now)(?::([a-z0-9-]+))?(?::([a-z]+))? -->/g,
  mdx: /\{\/\* (\/?)(spec-status|spec-box|now)(?::([a-z0-9-]+))?(?::([a-z]+))? \*\/\}/g,
}

// The regions of a file, in order, each with its kind, id, form and the
// offsets of its markers (at … from: the begin marker, to … end: the end
// marker), and the errors: an end without its begin, a begin inside an open
// region, a begin without its end.
export function regions(text, file) {
  const list = [], errors = []
  let open = null
  for (const m of text.matchAll(MARKER[file.endsWith('.mdx') ? 'mdx' : 'md'])) {
    const [marker, close, kind, id, form] = m
    if (!close && open) errors.push(`${file}: ${marker} opens inside ${open.marker}`)
    else if (!close) open = { kind, id, form, marker, at: m.index, from: m.index + marker.length }
    else if (!open || open.kind !== kind || open.id !== id || form) errors.push(`${file}: ${marker} closes no open region`)
    else { list.push({ ...open, to: m.index, end: m.index + marker.length }); open = null }
  }
  if (open) errors.push(`${file}: ${open.marker} has no end marker`)
  return { list, errors }
}

// Fill every region of a file with body(region), which returns the text or
// { error }. A region whose content starts with a line break is a block on
// lines of its own; any other region is filled inline.
export function fill(text, file, body) {
  const { list, errors } = regions(text, file)
  let out = '', at = 0
  for (const r of list) {
    const b = body(r)
    if (typeof b !== 'string') { errors.push(`${file}: ${r.marker}: ${b.error}`); continue }
    out += text.slice(at, r.from) + (text[r.from] === '\n' ? `\n${b}\n` : b)
    at = r.to
  }
  return { text: out + text.slice(at), errors }
}

// What a person wrote: the file without its regions, markers included, and
// with runs of blank lines read as one, so that setting a region is no edit.
export function handwritten(text, file) {
  const { list } = regions(text, file)
  let out = '', at = 0
  for (const r of list) { out += text.slice(at, r.at); at = r.end }
  return (out + text.slice(at)).replace(/\n{3,}/g, '\n\n')
}

// The content of a file's regions, one after another.
export const generated = (text, file) => regions(text, file).list.map((r) => text.slice(r.from, r.to)).join('\n')

// The frozen text of a specification: everything below the status block at
// its top (the whole file when it has none).
export function frozenText(text) {
  const first = regions(text, 'spec.md').list[0]
  return first?.kind === 'spec-status' && first.at === 0 ? text.slice(first.end).replace(/^\n\n?/, '') : text
}

export const digestOf = (text) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`

// ── rendering ───────────────────────────────────────────────────────────

const label = (status) => status.replace(/-/g, ' ')
const cell = (s) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
const lowerFirst = (t) => t.charAt(0).toLowerCase() + t.slice(1)

// A link to a repository path, written from a spec ('spec'), the root
// ('root') or the site ('site'). From a spec, a path outside spec/ is a
// repository link: the site publishes spec/ beside the pages, not lib/.
function link(path, text, from) {
  const href = from === 'root' ? path : from === 'spec' && path.startsWith('spec/') ? path.slice(5) : `${REPO}/${path}`
  return `[${text}](${href})`
}

function differences(part, from) {
  if (!part.differences) return ''
  const items = part.differences.map((d) => {
    if (/^D\d+$/.test(d)) return link('lib/DEVIATIONS.md', d, from)
    const [path, name] = d.split('#')
    return name ? `test \`${name}\` in ${link(path, `\`${path.split('/').pop()}\``, from)}` : `the header of ${link(path, `\`${path}\``, from)}`
  })
  return `Differences: ${items.join(', ')}.`
}

function partRow(p) {
  const what = [(p.sections ?? []).map((s) => `§${s}`).join(', '), p.title].filter(Boolean).join(' ')
  const ref = p.direction ? link(`spec/${p.direction}`, p.direction, 'spec') : p.target ? `by ${link(p.target, p.target.split('/').pop(), 'spec')}` : ''
  const note = [p.note, differences(p, 'spec')].filter(Boolean).join(' ')
  return `> | ${cell(what)} | ${cell([label(p.status), ref].filter(Boolean).join(': '))} | ${cell(note)} |`
}

export function renderSpecBlock(doc) {
  const reconciled = doc.lastReconciled === 'not reconciled'
    ? `**Not reconciled** with the library rule by rule, so in the table below *built* means the library implements the part and single rules may differ; ${lowerFirst(DIFFERENCES_AT)}`
    : `**Last reconciled against the library:** ${cell(doc.lastReconciled)}. ${BUILT}. ${DIFFERENCES_AT}`
  const direction = doc.direction ? ` **Direction:** ${link(`spec/${doc.direction}`, doc.direction, 'spec')} (not built, not normative).` : ''
  return [
    `> **Status, generated from [\`status.json\`](status.json).** This text is frozen at version ${doc.version} (${doc.date}) and is not edited. ${PRECEDENCE} The library is [\`lib/\`](${REPO}/lib/README.md). Earlier versions under [\`archive/\`](archive/) are history, not the current state.`,
    '>',
    `> **State:** ${doc.state}. ${reconciled}${direction}`,
    '>',
    '> | Part | Status | Note |',
    '> |---|---|---|',
    ...doc.parts.map(partRow),
    ...(doc.note ? ['>', `> ${doc.note}`] : []),
  ].join('\n')
}

const directionLink = (d, from) => d.direction ? ` (${link(`spec/${d.direction}`, 'direction', from)})` : ''

export function renderReadme(status) {
  return [
    `The texts under [\`spec/\`](spec/) are frozen at the version named below and are not edited, apart from a generated status block at their top. They are brought up to date one flow at a time. What holds, part by part, is in [\`spec/status.json\`](spec/status.json). ${BUILT}; where a text has not been reconciled with the library rule by rule (the last column), single rules may differ. ${DIFFERENCES_AT.replace('`lib/DEVIATIONS.md`', '[`lib/DEVIATIONS.md`](lib/DEVIATIONS.md)')} ${PRECEDENCE}`,
    '',
    '| Document | Version | State | Last reconciled |',
    '|---|---|---|---|',
    ...status.documents.map((d) => `| ${link(`spec/${d.file}`, cell(d.title), 'root')} | ${d.version} | ${cell(d.state)}${directionLink(d, 'root')} | ${cell(d.lastReconciled)} |`),
  ].join('\n')
}

export function renderSite(status) {
  return [
    `What holds, part by part, is in [\`spec/status.json\`](${REPO}/spec/status.json) and at the top of each document. ${PRECEDENCE}`,
    '',
    '| Document | Role | Version | State |',
    '|---|---|---|---|',
    ...status.documents.map((d) => `| ${link(`spec/${d.file}`, cell(d.title), 'site')} | ${cell(d.role)} | ${d.version} | ${cell(d.state)}${directionLink(d, 'site')} |`),
  ].join('\n')
}

export function renderBox(docs) {
  const list = docs.map((d) => `- [${d.title}](${REPO}/spec/${d.file}): ${lowerFirst(d.state)}`)
  return [
    ':::note[Design and status]',
    'This page describes the frozen specification texts. What the library builds of them:',
    '',
    ...(docs.length > 4 ? ['<details>', `<summary>The ${docs.length} specifications this page rests on</summary>`, '', ...list, '', '</details>'] : list),
    '',
    'Details, part by part: [Specifications](/reference/specifications/) and the status block at the top of each document.',
    ':::',
  ].join('\n')
}

// ── checks the schema cannot make ───────────────────────────────────────

const read = (root, path) => readFileSync(join(root, path), 'utf8')
const isFile = (root, path) => existsSync(join(root, path)) && statSync(join(root, path)).isFile()
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Ajv is loaded on first use: scripts/check-doc-specs.mjs imports this
// module in a workflow that installs no dependencies.
let validate
export function validateForm(status) {
  const Ajv2020 = createRequire(import.meta.url)('ajv/dist/2020.js').default
  validate ??= new Ajv2020({ allErrors: true }).compile(JSON.parse(readFileSync(join(ROOT, 'spec/status.schema.json'), 'utf8')))
  return validate(status) ? [] : validate.errors.map((e) => `spec/status.json${e.instancePath || ' (root)'}: ${e.message}`)
}

export function checkRegister(root, status) {
  const errors = []
  const files = readdirSync(join(root, 'spec')).filter((f) => f.endsWith('.md')).sort()
  const entries = status.documents.map((d) => d.file)
  for (const f of files) if (entries.filter((e) => e === f).length !== 1) errors.push(`spec/${f}: not exactly one entry in spec/status.json`)
  for (const f of entries) if (!files.includes(f)) errors.push(`spec/status.json names ${f}, which is not in spec/`)
  const rows = [...read(root, 'lib/DEVIATIONS.md').matchAll(/^\| (D\d+) \|/gm)].map((m) => m[1])
  const named = new Set()
  const path = (where, p) => { if (!isFile(root, p)) errors.push(`${where}: ${p} is no file`) }
  for (const [id, st] of Object.entries(status.statements)) for (const e of st.evidence) if (!e.startsWith('https://')) path(`statement ${id}`, e)
  for (const d of status.documents.filter((x) => files.includes(x.file))) {
    const text = frozenText(read(root, `spec/${d.file}`))
    const where = `spec/status.json ${d.file}`
    if (digestOf(text) !== d.textDigest) errors.push(`${where}: the frozen text has changed (textDigest ${d.textDigest}, the text below its status block is ${digestOf(text)})`)
    const version = text.match(/^- \*\*Version:\*\*\s*(\S+)/m)?.[1]
    const date = text.match(/^- \*\*Date:\*\*\s*(\S+)/m)?.[1]
    if (version !== d.version) errors.push(`${where}: version ${d.version}, the header says ${version}`)
    if (date && date !== d.date) errors.push(`${where}: date ${d.date}, the header says ${date}`)
    for (const [re, s] of [[/\b(one|two|three|four|five|six) parts? built differently\b/, 'built-differently'], [/\b(one|two|three|four|five|six) in part\b/, 'partly-built']]) {
      const m = d.state.match(re), n = d.parts.filter((p) => p.status === s).length
      if (m && ['one', 'two', 'three', 'four', 'five', 'six'].indexOf(m[1]) + 1 !== n) errors.push(`${where}: the state says ${m[0]}, the parts have ${n}`)
    }
    if (d.direction) path(where, `spec/${d.direction}`)
    for (const p of d.parts) {
      const pw = `${where} "${p.title}"`
      for (const s of p.sections ?? []) if (!new RegExp(`^#{2,6} ${esc(s)}\\.?(\\s|$)`, 'm').test(text)) errors.push(`${pw}: spec/${d.file} has no section ${s}`)
      for (const e of p.evidence ?? []) path(pw, e)
      if (p.target) path(pw, p.target)
      if (p.direction) path(pw, `spec/${p.direction}`)
      for (const x of p.differences ?? []) {
        if (/^D\d+$/.test(x)) { named.add(x); if (!rows.includes(x)) errors.push(`${pw}: ${x} is no row of lib/DEVIATIONS.md`); continue }
        const [file, name] = x.split('#')
        if (!isFile(root, file)) errors.push(`${pw}: ${file} is no file`)
        else if (name && !new RegExp(`\\b(test|it)\\(\\s*['"\`]${esc(name)}`).test(read(root, file))) errors.push(`${pw}: ${file} has no test whose name starts "${name}"`)
      }
    }
  }
  for (const r of rows) if (!named.has(r)) errors.push(`lib/DEVIATIONS.md ${r} is named by no part in spec/status.json`)
  return errors
}

// ── generation ──────────────────────────────────────────────────────────

// The files that may carry regions.
export function regionFiles(root) {
  const md = (dir) => existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter((f) => f.endsWith('.md')).map((f) => `${dir}/${f}`) : []
  return [README, ...md('spec'), ...md('spec/direction'), ...pages(root)].filter((f) => isFile(root, f))
}

// The pages that carry a box, each with the specifications it rests on.
export function boxPages(root) {
  return pages(root).filter((f) => /\/(understand|reference)\//.test(f) && f !== SITE)
    .map((file) => ({ file, specs: parseSpecs(read(root, file)) ?? [] })).filter((p) => p.specs.length)
}

// Every file that carries regions, with the content the register gives it,
// and the errors. Writes nothing.
export function generate(root, status) {
  const formErrors = validateForm(status)
  if (formErrors.length) return { errors: formErrors, outputs: new Map() }
  const errors = checkRegister(root, status)
  const boxes = new Map(boxPages(root).map((p) => [p.file, p.specs]))
  const doc = (file) => status.documents.find((d) => `spec/${d.file}` === file)
  // the one region of a kind each file must carry
  const required = (file) => doc(file) || file === README || file === SITE ? 'spec-status' : boxes.has(file) ? 'spec-box' : null
  const body = (file) => (r) => {
    if (r.kind === 'now') {
      const form = r.form ?? 'short'
      const text = ['short', 'long'].includes(form) ? status.statements[r.id]?.[form] : undefined
      return text ?? { error: `no statement ${r.id} with a ${form} form in spec/status.json` }
    }
    if (r.id || r.form || r.kind !== required(file)) return { error: `no such region in ${file}` }
    if (r.kind === 'spec-box') {
      const docs = boxes.get(file).map((s) => doc(`spec/${s}.md`))
      return docs.every(Boolean) ? renderBox(docs) : { error: 'specs names a specification without an entry in spec/status.json' }
    }
    return file === README ? renderReadme(status) : file === SITE ? renderSite(status) : renderSpecBlock(doc(file))
  }
  const outputs = new Map()
  for (const file of regionFiles(root)) {
    const text = read(root, file)
    const kind = required(file)
    const { list } = regions(text, file)
    if (kind && list.filter((r) => r.kind === kind).length !== 1) errors.push(`${file}: not exactly one ${kind} region`)
    if (doc(file) && (list[0]?.kind !== 'spec-status' || list[0].at !== 0)) errors.push(`${file}: the spec-status region does not open the file`)
    const r = fill(text, file, body(file))
    errors.push(...r.errors)
    if (list.length) outputs.set(file, r.text)
  }
  return { errors, outputs }
}

// ── command line ────────────────────────────────────────────────────────

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2)
  if (args.some((a) => a !== '--check')) {
    console.error('usage: node scripts/build-spec-status.mjs [--check]')
    process.exit(2)
  }
  const status = JSON.parse(read(ROOT, 'spec/status.json'))
  const { errors, outputs } = generate(ROOT, status)
  const stale = []
  for (const [file, text] of errors.length ? [] : outputs) {
    if (read(ROOT, file) === text) continue
    if (args.includes('--check')) stale.push(file)
    else writeFileSync(join(ROOT, file), text)
  }
  for (const e of errors) console.error(`  ERROR ${e}`)
  for (const f of stale) console.error(`  STALE ${f}: run node scripts/build-spec-status.mjs`)
  const failed = errors.length + stale.length
  console.log(failed ? `spec status: ${errors.length} error(s), ${stale.length} stale` : `spec status: ok, ${status.documents.length} documents, ${outputs.size} files`)
  process.exit(failed ? 1 : 0)
}
