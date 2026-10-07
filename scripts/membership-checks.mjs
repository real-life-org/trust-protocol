// The Membership checks of the validation script, and the rule coverage
// of Membership Tasks (RLTP-MT-10080, 10100).
//
// Two kinds of evidence prove a rule of Membership Tasks: a vector case
// or runner check (conformance/runner.mjs, `--coverage membership`), and
// a check of this module over the shipped schemas, the task registry
// (conformance/membership-task-types.json) and the identifier list.
// Every rule of the manifest is either proven by one of them or listed
// in the state-dependent and interactive set of the specification
// (Section 10.3), never both.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PREFIX = 'RLTP-MT-'
const ids = (text) => [...text.matchAll(/RLTP-MT-\d{4,5}/g)].map((m) => m[0])
const flat = (s) => s.replace(/[*`]/g, '').replace(/\s+/g, ' ')
// the paragraph of one numbered rule, markup stripped
export const ruleText = (spec, id) => {
  const m = new RegExp(`^\\*\\*${id}\\*\\* — `, 'm').exec(spec)
  if (!m) return null
  const rest = spec.slice(m.index + m[0].length)
  const end = rest.indexOf('\n\n')
  return flat(end < 0 ? rest : rest.slice(0, end)).trim()
}
/** The rule identifiers of a manifest file: one per line, blank lines and `#` comments skipped. */
export const manifestIds = (text) => text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))

// ── the coverage sets of Section 10.3 ────────────────────────────────────
// The specification partitions its rules: the state-dependent and
// interactive set, and the vector-checked set, of which the rules under
// "Partially proved" are checked only in part. Each set runs from its
// bold heading to the next one (or the next section heading); a rule in
// parentheses right after a heading defines the set and is not a member.
const SECTION = { state: '**State-dependent and interactive set**', vector: '**Vector-checked set**', partial: '**Partially proved' }
/** Reads the three coverage sets of Section 10.3 from the specification text; returns `{ state, vector, partial }` as arrays of identifiers, or `{ error }`. */
export function coverageSets ({ specText }) {
  const at = Object.fromEntries(Object.entries(SECTION).map(([k, h]) => [k, specText.indexOf(h)]))
  if (at.state < 0 || at.vector < 0) return { error: 'the specification names no state-dependent and vector-checked sets (Section 10.3)' }
  const starts = Object.values(at).filter((x) => x >= 0)
  const body = (k) => {
    if (at[k] < 0) return []
    // skip the heading and a parenthesised defining rule right after it
    const h = specText.slice(at[k] + SECTION[k].length).match(/^[^*\n]*?\*{0,2}\s*(\(RLTP-MT-\d+\))?/)
    const from = at[k] + SECTION[k].length + (h ? h[0].length : 0)
    const ends = [...starts.filter((x) => x > at[k]), ...[...specText.matchAll(/^#{2,3} /gm)].map((m) => m.index).filter((x) => x > at[k])]
    return ids(specText.slice(from, ends.length ? Math.min(...ends) : undefined))
  }
  const partial = body('partial')
  const vector = body('vector')
  return { state: body('state'), partial, full: vector.filter((x) => !partial.includes(x)), vector, error: null }
}
// the state-dependent set from a file (one ID per line) — until the
// specification carries Section 10.3
export const stateDependentFile = (file) => manifestIds(readFileSync(file, 'utf8'))
// kept for callers that want the state set alone
export function stateDependentIds ({ specText, file = null }) {
  if (file) return { source: file, ids: stateDependentFile(file), error: null }
  const c = coverageSets({ specText })
  if (c.error) return { source: 'spec', ids: [], error: 'the specification names no state-dependent and interactive set (Section 10.3)' }
  return { source: 'spec §10.3', ids: c.state, error: null }
}

// ── the rules the conformance runner proves, completely and in part ──────
export function runnerCoverage (root = ROOT) {
  const r = spawnSync(process.execPath, [join(root, 'conformance/runner.mjs'), '--coverage', 'membership'], { encoding: 'utf8', maxBuffer: 1 << 24 })
  if (r.status !== 0) return { ids: [], partial: [], error: `conformance runner failed (exit ${r.status}): ${(r.stderr || '').trim().split('\n').slice(-3).join(' | ')}` }
  const lines = manifestIds(r.stdout)
  return { ids: lines.filter((l) => !l.startsWith('partial ')), partial: lines.filter((l) => l.startsWith('partial ')).map((l) => l.slice(8)), error: null }
}

// ── the checks of the validation script ──────────────────────────────────
// Each: { rules, ok, msg }. A passing check proves its rules.
export function membershipProfileChecks ({ root = ROOT, specText, manifest }) {
  const out = []
  const add = (rules, ok, msg) => out.push({ rules, ok: Boolean(ok), msg })
  const S = {}
  for (const f of readdirSync(join(root, 'schemas')).filter((f) => f.endsWith('.json'))) S[f] = JSON.parse(readFileSync(join(root, 'schemas', f), 'utf8'))
  const byId = new Map(Object.entries(S).map(([f, s]) => [s.$id ?? `https://real-life.org/rltp/v1/schemas/${f}`, f]))
  const OWN = ['payload-membership-invite.schema.json', 'payload-membership-accept.schema.json', 'payload-membership-evidence.schema.json', 'payload-membership-evidence-0.1.schema.json', 'payload-access-operation.schema.json', 'welcome.schema.json']
  const ACCESS = ['access-operation-envelope.schema.json', 'access-material.schema.json', 'access-vouch.schema.json']
  const refs = (node, acc = []) => { if (Array.isArray(node)) node.forEach((n) => refs(n, acc)); else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) { if (k === '$ref' && typeof v === 'string') acc.push(v); else refs(v, acc) } return acc }

  // RLTP-MT-10010: one profile string in the header, the profile rule and every profile-bearing schema title
  const profile = (specText.match(/\*\*Conformance profile:\*\* `(rltp-membership@[0-9.]+)`/) ?? [])[1]
  const t10010 = ruleText(specText, 'RLTP-MT-10010') ?? ''
  const titles = OWN.filter((f) => !S[f] || !S[f].title.includes(profile ?? '\u0000'))
  add(['RLTP-MT-10010'], profile === 'rltp-membership@0.18' && t10010.includes(profile) && titles.length === 0,
    `profile ${profile}: header, RLTP-MT-10010 and the titles of ${OWN.length} Membership schemas agree${titles.length ? ' — differs: ' + titles.join(', ') : ''}`)

  // RLTP-MT-10030: Access transcriptions keep unversioned $ids; Membership schemas $ref them by those
  const versioned = ACCESS.filter((f) => !S[f]?.$id || /-\d+\.\d+\.schema\.json$/.test(S[f].$id))
  const ownRefs = OWN.flatMap((f) => refs(S[f] ?? {}).filter((r) => r.includes('/rltp/v1/schemas/')).map((r) => [f, r.split('#')[0]]))
  const badRefs = ownRefs.filter(([, r]) => !byId.has(r) || /-\d+\.\d+\.schema\.json$/.test(r))
  add(['RLTP-MT-10030'], versioned.length === 0 && badRefs.length === 0 && ownRefs.some(([, r]) => r.endsWith('/access-operation-envelope.schema.json')) && ownRefs.some(([, r]) => r.endsWith('/access-material.schema.json')),
    `Access transcriptions carry unversioned $ids; ${ownRefs.length} references of the Membership schemas name those resources${versioned.length + badRefs.length ? ' — ' + [...versioned, ...badRefs.map(([f, r]) => f + '→' + r)].join(', ') : ''}`)

  // RLTP-MT-10070: every schema the rule names ships, and the closure of its references resolves offline
  const named = [...(ruleText(specText, 'RLTP-MT-10070') ?? '').matchAll(/schemas\/([a-z0-9.-]+\.schema\.json)/g)].map((m) => m[1])
  const missing = named.filter((f) => !S[f])
  const seen = new Set(); const open = []
  const walk = (f) => { if (seen.has(f)) return; seen.add(f); for (const r of refs(S[f])) { const base = r.split('#')[0]; if (!base) continue; const t = byId.get(base) ?? (S[base] ? base : null); if (!t) open.push(`${f}→${base}`); else walk(t) } }
  for (const f of named.filter((f) => S[f])) walk(f)
  add(['RLTP-MT-10070'], named.length >= 12 && missing.length === 0 && open.length === 0, `the ${named.length} schemas RLTP-MT-10070 names ship, closure of ${seen.size} schemas resolves offline${missing.length + open.length ? ' — ' + [...missing, ...open].join(', ') : ''}`)

  // RLTP-MT-3085, 3375, 3760: registry declarations = the declaration rules; registry schemas carry the type URI as $id
  const reg = JSON.parse(readFileSync(join(root, 'conformance/membership-task-types.json'), 'utf8'))
  for (const t of reg.types) {
    const s = S[t.schema]
    if (!s || s.$id !== t.type) { add([], false, `registry ${t.type}: schema ${t.schema} missing or its $id differs`); continue }
    if (!t.rule) continue
    const txt = ruleText(specText, t.rule) ?? ''
    add([t.rule], txt.includes(`side effects ${t.sideEffects}`) && txt.includes(`exposure ${t.exposure}`), `registry ${t.type.split('/').slice(-2).join('/')}: declared side effects "${t.sideEffects}", exposure "${t.exposure}" as ${t.rule} states; schema $id = type URI`)
  }

  // RLTP-MT-10090: every rule a vector names is an identifier of the list
  const named2 = []
  const collect = (node) => { if (Array.isArray(node)) node.forEach(collect); else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) { if (k === 'rules' && Array.isArray(v)) named2.push(...v.filter((x) => typeof x === 'string' && x.startsWith(PREFIX))); else if (k === 'rulesPartial' && v && typeof v === 'object') named2.push(...Object.keys(v)); else collect(v) } }
  for (const f of ['vectors/membership-tasks.json', 'vectors/dtg-credentials.json', 'fixtures/invalid-examples.json']) collect(JSON.parse(readFileSync(join(root, f), 'utf8')))
  const unknown = named2.filter((x) => !manifest.has(x))
  add(['RLTP-MT-10090'], named2.length > 0 && unknown.length === 0, `${named2.length} rule references in the vectors and fixtures, all identifiers of the list${unknown.length ? ' — unknown: ' + [...new Set(unknown)].join(', ') : ''}`)
  return out
}

// ── coverage ─────────────────────────────────────────────────────────────
// manifest = complete ∪ partial ∪ state-dependent, pairwise disjoint; a
// rule listed as completely checked is proven completely, a rule listed
// as partial is named in part (and not proven completely — then the list
// is out of date), a state-dependent rule is named by no check.
export function checkCoverage ({ manifest, proven, partialNamed = [], full = null, partial = [], stateDependent }) {
  const errors = []
  const P = new Set(proven); const PN = new Set(partialNamed.filter((x) => !P.has(x)))
  const D = new Set(stateDependent); const Mf = new Set(manifest)
  // without the sets of Section 10.3 the complete set is what is proven
  const F = new Set(full ?? [...P]); const Q = new Set(full ? partial : [...PN])
  for (const id of Mf) if (!F.has(id) && !Q.has(id) && !D.has(id)) errors.push(`${id}: neither vector-checked nor in the state-dependent set`)
  for (const id of F) { if (D.has(id)) errors.push(`${id}: vector-checked and in the state-dependent set`); if (Q.has(id)) errors.push(`${id}: listed as completely and as partially checked`) }
  for (const id of Q) if (D.has(id)) errors.push(`${id}: partially checked and in the state-dependent set`)
  for (const id of new Set([...F, ...Q, ...D, ...P, ...PN])) if (!Mf.has(id)) errors.push(`${id}: named as covered, not an identifier of the list`)
  if (full) {
    for (const id of P) if (D.has(id)) errors.push(`${id}: proven by a check and listed as state-dependent`)
    for (const id of PN) if (D.has(id)) errors.push(`${id}: checked in part and listed as state-dependent`)
    for (const id of F) if (!P.has(id)) errors.push(`${id}: listed as completely checked, ${PN.has(id) ? 'checked only in part' : 'named by no check'}`)
    for (const id of Q) { if (P.has(id)) errors.push(`${id}: listed as partially checked, proven completely`); else if (!PN.has(id)) errors.push(`${id}: listed as partially checked, named by no check`) }
  }
  return { errors, manifest: Mf.size, full: [...F].filter((x) => Mf.has(x)).length, partial: [...Q].filter((x) => Mf.has(x)).length, stateDependent: [...D].filter((x) => Mf.has(x)).length }
}

// The whole Membership coverage run: profile checks, runner, Section 10.3
// (or a state-dependent file in its place). RLTP-MT-10080 and
// RLTP-MT-10100 are the rules of this very equality check.
export function membershipCoverage ({ root = ROOT, spec, manifestPath, stateFile = null }) {
  const specText = readFileSync(spec, 'utf8')
  const manifest = new Set(manifestIds(readFileSync(manifestPath, 'utf8')))
  const checks = membershipProfileChecks({ root, specText, manifest })
  const runner = runnerCoverage(root)
  const validated = checks.filter((c) => c.ok).flatMap((c) => c.rules)
  const proven = [...runner.ids, ...validated, 'RLTP-MT-10080', 'RLTP-MT-10100']
  let sets; let source
  if (stateFile) { sets = { state: stateDependentFile(stateFile), full: null, partial: [], error: null }; source = stateFile }
  else { sets = coverageSets({ specText }); source = 'spec §10.3' }
  const cov = sets.error ? { errors: [], manifest: manifest.size, full: 0, partial: 0, stateDependent: 0 } : checkCoverage({ manifest: [...manifest], proven, partialNamed: runner.partial, full: sets.full, partial: sets.partial, stateDependent: sets.state })
  const errors = [...checks.filter((c) => !c.ok).map((c) => c.msg), ...(runner.error ? [runner.error] : []), ...(sets.error ? [sets.error] : []), ...cov.errors]
  return { checks, errors, counts: { manifest: cov.manifest, full: cov.full, partial: cov.partial, runner: new Set(runner.ids).size, runnerPartial: new Set(runner.partial).size, validate: new Set([...validated, 'RLTP-MT-10080', 'RLTP-MT-10100']).size, stateDependent: cov.stateDependent }, stateSource: source }
}
