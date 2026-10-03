// Build stamp for the footer: library version and commit, written before
// every build so the page states which state of the repository it shows.
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const lib = JSON.parse(readFileSync(new URL('../../../lib/package.json', import.meta.url), 'utf8'))
const git = (cmd) => { try { return execSync(cmd, { encoding: 'utf8' }).trim() } catch { return '' } }
const info = {
  lib: lib.version,
  commit: process.env.GITHUB_SHA || git('git rev-parse HEAD'),
  dirty: !process.env.GITHUB_SHA && git('git status --porcelain') !== '',
}
writeFileSync(new URL('../public/build-info.json', import.meta.url), JSON.stringify(info, null, 2) + '\n')
