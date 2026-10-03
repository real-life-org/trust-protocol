// The person camera and the device app show only what that device can prove
// from documents it holds (issue #6). Runs the workbench headless against the
// real library and checks Peter's view of the seeded world.
//
//   CHROME_BIN=/path/to/chrome node tests/local-perspective.mjs
//
// Needs playwright-core resolvable (PLAYWRIGHT_CORE=/path/to/playwright-core)
// and a Chrome >= 137 (Ed25519 in WebCrypto). Serves the repository root itself.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
const server = createServer(async (req, res) => {
  try {
    const body = await readFile(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)))
    res.writeHead(200, { 'content-type': types[extname(req.url.split('?')[0])] || 'application/octet-stream' }).end(body)
  } catch { res.writeHead(404).end() }
}).listen(0)
const port = server.address().port

const { chromium } = await import(process.env.PLAYWRIGHT_CORE ? join(process.env.PLAYWRIGHT_CORE, 'index.mjs') : 'playwright-core')
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
try {
  await page.goto(`http://localhost:${port}/apps/gesamtsimulator/Workbench.dc.html`)
  await page.waitForFunction(() => globalThis.__wb?.state?.ready, null, { timeout: 60000 })

  const seen = await page.evaluate(() => {
    const wb = globalThis.__wb
    const label = (gid) => [...wb.person('Peter').groups.values()].find((g) => g.genesisDigest === gid)?.label
    // what Peter's own device holds, per group
    const held = Object.fromEntries([...wb.person('Peter').groups.values()].map((g) => [g.label, g.roster.size]))
    // the person camera on Peter
    wb.state.view = 'Peter'
    const scene = wb.buildScene()
    const shown = {}
    for (const e of scene.edges) if (e.member) {
      const gl = label(e.a.slice(2)); if (gl) shown[gl] = (shown[gl] || 0) + 1
    }
    const named = scene.edges.filter((e) => e.member && e.b.startsWith('p:') && e.b !== 'p:Peter').map((e) => label(e.a.slice(2)) + '→' + e.b.slice(2))
    // the device app on Peter
    wb.state.open = [...new Set([...wb.state.open, 'Peter'])]
    const win = wb.renderVals().floatWins.find((w) => w.name === 'Peter')
    const meta = Object.fromEntries((win?.groups || []).map((g) => [g.label, g.meta]))
    return { held, shown, named, meta }
  })

  for (const g of ['Choir', 'Garden']) {
    assert.equal(seen.held[g], 2, `seed: Peter's device holds 2 roster entries for ${g}`)
    assert.equal(seen.shown[g], seen.held[g], `person camera: ${g} shows exactly the ${seen.held[g]} members Peter holds (got ${seen.shown[g]})`)
    assert.match(seen.meta[g] || '', /^2 members/, `device app: ${g} reads "2 members" (got "${seen.meta[g]}")`)
  }
  // a later join that Peter's device never hears about leaves his view alone;
  // the founder, who admitted the members over relationships, sees them named
  const later = await page.evaluate(async () => {
    const wb = globalThis.__wb
    const choir = [...wb.person('Anna').groups.values()].find((g) => g.label === 'Choir').genesisDigest
    await wb.joinGroup('Frida', choir, {})
    const peterChoir = () => [...wb.person('Peter').groups.values()].find((g) => g.label === 'Choir').roster.size
    const count = (who) => {
      wb.state.view = who
      return wb.buildScene().edges.filter((e) => e.member && e.a === 'g:' + choir).map((e) => e.b)
    }
    return { peterHolds: peterChoir(), peter: count('Peter'), anna: count('Anna'), annaHolds: [...wb.person('Anna').groups.values()].find((g) => g.label === 'Choir').roster.size }
  })
  assert.equal(later.peterHolds, 2, 'Peter received no new roster')
  assert.equal(later.peter.length, 2, `Peter still sees 2 Choir members after Frida joined (got ${later.peter.length})`)
  assert.equal(later.anna.length, later.annaHolds, 'Anna sees exactly the roster she holds')
  assert.ok(later.anna.filter((b) => b.startsWith('p:') && b !== 'p:Anna').length >= 1, `Anna names the members she admitted: ${later.anna}`)
  assert.deepEqual(errors, [], 'no script errors')
  console.log('ok  local perspective:', JSON.stringify({ seen, later }))
} finally {
  await browser.close(); server.close()
}
