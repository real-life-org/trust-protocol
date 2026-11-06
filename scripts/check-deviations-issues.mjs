#!/usr/bin/env node
// lib/DEVIATIONS.md names, per deviation, the issue that asks the next
// casting to settle it. Once that issue is closed, the specification has
// moved and the deviation must go: this check fails until the row is
// removed and the code follows. Runs in CI (network); locally it needs
// GITHUB_TOKEN only against the API rate limit.
import { readFileSync } from 'node:fs'

const md = readFileSync(new URL('../lib/DEVIATIONS.md', import.meta.url), 'utf8')
const rows = md.split('\n').filter((l) => /^\| D\d+ \|/.test(l)).map((l) => {
  const [, id, issue] = l.split('|').map((c) => c.trim())
  return { id, issue }
})
const headers = { accept: 'application/vnd.github+json', 'user-agent': 'trust-protocol-deviations' }
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
let failed = false
for (const r of rows) {
  const m = /github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)$/.exec(r.issue)
  const res = await fetch(`https://api.github.com/repos/${m[1]}/${m[2]}/issues/${m[3]}`, { headers })
  if (!res.ok) { console.error(`${r.id}: cannot read ${r.issue} (${res.status})`); failed = true; continue }
  const { state } = await res.json()
  if (state !== 'open') { console.error(`${r.id}: ${r.issue} is ${state}; the specification moved, remove the deviation`); failed = true }
  else console.log(`${r.id}: open`)
}
process.exit(failed ? 1 : 0)
