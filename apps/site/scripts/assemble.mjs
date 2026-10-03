// After `astro build`: put the normative files and the simulators next to the
// site, unchanged, so every address the old Pages build served keeps working
// (/spec/*.md, /schemas/*.json, /simulator/*.html, /terms/…). The `.html`
// renderings the old Jekyll build produced become redirects to GitHub, which
// renders the Markdown with headings and anchors.
import { cpSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'

const root = new URL('../../../', import.meta.url)
const dist = new URL('../dist/', import.meta.url)
const REPO = 'https://github.com/real-life-org/trust-protocol'

const RAW = ['spec', 'schemas', 'contexts', 'vectors', 'fixtures', 'conformance', 'interop', 'terms', 'simulator', 'apps/gesamtsimulator']
for (const dir of RAW) {
  const from = new URL(dir + '/', root)
  if (!existsSync(from)) throw new Error(`missing ${dir}/`)
  cpSync(from, new URL(dir + '/', dist), { recursive: true, filter: (p) => !p.includes('node_modules') })
}
cpSync(new URL('CNAME', root), new URL('CNAME', dist))

const redirect = (to) => `<!doctype html><meta charset="utf-8"><title>Moved</title><link rel="canonical" href="${to}"><meta http-equiv="refresh" content="0; url=${to}"><a href="${to}">${to}</a>\n`
const write = (path, to) => { const u = new URL(path, dist); mkdirSync(new URL('./', u), { recursive: true }); writeFileSync(u, redirect(to)) }

for (const f of readdirSync(new URL('spec/', root)).filter((f) => f.endsWith('.md'))) {
  write(`spec/${f.replace(/\.md$/, '.html')}`, `${REPO}/blob/main/spec/${f}`)
}
for (const dir of ['schemas', 'contexts', 'vectors', 'conformance']) {
  write(`${dir}/index.html`, `${REPO}/blob/main/${dir}/index.md`)
}
write('lib/index.html', `${REPO}/tree/main/lib`)
console.log('assembled: raw files, CNAME, legacy redirects')
