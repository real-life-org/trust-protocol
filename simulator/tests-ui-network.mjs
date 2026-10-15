// UI run of the network simulator (the app on the library's holder API):
// home inbox → introduce (the mediator offline: the act waits for him) →
// groups over the introduced channel → the trust act → continuity → the
// WoT app flow (FAB, scan flight, full-screen prompt, offline two-way scan)
// → delivery stages and faults → the sim clock.
//
//   CHROME_BIN=/path/to/chrome PLAYWRIGHT_CORE=/path/to/playwright-core node simulator/tests-ui-network.mjs
//
// Needs playwright-core (PLAYWRIGHT_CORE, else resolvable as 'playwright-core')
// and a Chrome >= 137 (Ed25519 and X25519 in WebCrypto). Serves the
// repository root itself. SHOTS_DIR=<dir> saves three screenshots.
//
// Ported from the probe-world run; dropped, with the reason:
//   - "the drop never saw an access by Anton": there is no rendezvous drop
//     any more (Trust §8 relays the act through the mediator); instead:
//     nothing reaches Emil while Anton is offline, and the request flows
//     when he is back
//   - "Emil holds Jonathan's card ◇ before his decision": the target gets
//     the request only through the mediator's forward, and the contact only
//     by consenting; the waiting state is the open prompt
//   - the candidacy checkbox and the candidacy badge, the vouch on a
//     candidacy: the library admits under the rule of one at the accept
//     (foundGroup refuses a stricter rule: threshold-unsupported), so a
//     group founded in the app never holds a consent pair to vouch for;
//     the vouch section stays in the page for GroupView.pending
//   - the star's "1 contact blinded": the star's content is the library's
//     (asserted: no match is shown that the holder cannot compute)
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
const server = createServer(async (req, res) => {
  try {
    const body = await readFile(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)))
    res.writeHead(200, { 'content-type': types[extname(req.url.split('?')[0])] || 'application/octet-stream' }).end(body)
  } catch { res.writeHead(404).end() }
}).listen(0)
const port = server.address().port

const { chromium } = await import(process.env.PLAYWRIGHT_CORE ? join(process.env.PLAYWRIGHT_CORE, 'index.mjs') : 'playwright-core')
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } })
const errors = []
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', (e.stack ?? e.message).slice(0, 600)) })

let fails = 0
const check = (c, m) => { console.log((c ? '✓ ' : '✗ FAIL ') + m); if (!c) fails++ }
const tab = (id, label) => page.locator(`#dev-${id} .pbtn`, { hasText: label }).click()
const ev = (fn, arg) => page.evaluate(fn, arg)
const until = (fn, arg, timeout = 10000) => page.waitForFunction(fn, arg, { timeout })
const shot = async (name) => {
  if (!process.env.SHOTS_DIR) return
  await mkdir(process.env.SHOTS_DIR, { recursive: true })
  await page.screenshot({ path: join(process.env.SHOTS_DIR, name), fullPage: true })
}
const closeDialogs = async () => {
  for (const id of ['J', 'A', 'E']) {
    for (const sel of [`#dev-${id} .cdlg button`, `#dev-${id} .phdlg-btns button`]) {
      const b = page.locator(sel).first()
      if (await b.count()) await b.click()
    }
  }
}

try {
  await page.goto(`http://localhost:${port}/simulator/network.html`, { waitUntil: 'domcontentloaded' })
  await until(() => window.__net?.state?.ready, null, 60000)
  // page-side readers over the device views (the cache each refresh fills)
  await ev(() => {
    const P = (id) => window.__net.people[id]
    window.__t = {
      P,
      named: (id, name) => P(id).view.contacts.filter((c) => c.displayName === name),
      intros: (id) => Object.values(P(id).view.state.encounter.introductions),
      counterparts: (id) => Object.values(P(id).view.state.relationships).flatMap((r) => r.tuples).map((t) => t.counterpartAnchor),
      wire: () => window.__net.net.wire,
    }
  })

  // ── setup ──────────────────────────────────────────────────────────────
  check(await ev(() => {
    const { P } = window.__t
    return P('A').view.contacts.length === 2 && P('J').view.contacts.length === 1 && P('E').view.contacts.length === 1 &&
      [...P('A').view.contacts, ...P('J').view.contacts, ...P('E').view.contacts].every((c) => c.provenance === 'ceremony' && c.verification === 'mutual')
  }), 'Setup: Anton holds Jonathan and Emil, each of them holds Anton (real ceremonies, ⇄ mutual)')
  check((await page.locator('#dev-A .kpi .k').count()) === 3, 'Home tab is the default: KPI row (Contacts · Groups · Open)')
  check((await page.locator('#dev-A .sect', { hasText: 'Waiting for you' }).count()) === 0, 'Home: an empty inbox is hidden')
  await shot('1-setup.png')

  // ── introduce: Anton's phone → Contacts → Emil → Introduce… → Jonathan ─
  await tab('A', 'Contacts')
  await page.locator('#dev-A .prow', { hasText: 'Emil' }).click()
  await page.locator('#dev-A .profact button', { hasText: 'Introduce…' }).waitFor()
  check((await page.locator('#dev-A .sect', { hasText: 'Shared groups' }).count()) === 0, 'contact detail: empty sections are hidden')
  await page.locator('#dev-A .profact button', { hasText: 'Introduce…' }).click()
  await page.locator('#dev-A .phdlg .prow', { hasText: 'Jonathan' }).click()
  await page.locator('#dev-A .phdlg-card', { hasText: 'to each other?' }).waitFor()
  check((await page.locator('#dev-A .phdlg-card', { hasText: 'while you are offline, it waits for you' }).count()) === 1, 'one-way door: the confirm sheet IN the phone says the act is relayed by the introducer')
  await page.locator('#dev-A .phdlg-btns button', { hasText: /^Introduce$/ }).click()
  await until(() => window.__t.wire().some((w) => w.kind === 'x-introduction-offer/0.1' && w.from === 'Anton' && w.to === 'Jonathan' && w.disp === 'unique'))
  check(true, 'Anton\'s ONE act: the offer, sealed to Jonathan (with his ack-delay declaration)')

  // airplane mode via the network toggle
  await page.locator('#dev-A .devctls .devbtn').first().click()
  await until(() => window.__t.P('A').online === false)
  check((await page.locator('#dev-A .phone-screen.off').count()) === 1 && (await page.locator('#dev-A .phone-status .st-owner').textContent()).includes('offline'),
    'Anton in airplane mode: the screen and the status bar say ✈ offline (it replaces the owner name)')

  // Jonathan: the offer in the HOME inbox → Connect
  await page.locator('#dev-J .incoming .iq', { hasText: 'wants to connect you with Emil' }).waitFor()
  check(true, 'Jonathan sees the offer in the Home inbox ("Waiting for you")')
  await page.locator('#dev-J .incoming .yes').click()
  await page.locator('#dev-J .sentrow', { hasText: 'waiting for Anton to relay' }).waitFor()
  check((await page.locator('#dev-J .sect', { hasText: 'Waiting for them' }).count()) === 1 &&
    (await page.locator('#dev-J .sect', { hasText: 'Waiting for you' }).count()) === 0, 'direction honesty: the waiting state stands under "Waiting for them", not "for you"')
  check(await ev(() => window.__net.net.channel.transit.get('Anton')?.length === 1), 'Anton is offline: Jonathan\'s request waits in transit at the relay')
  check(await ev(() => window.__t.intros('J')[0]?.role === 'requester' && window.__t.intros('J')[0].status === 'sent'), 'Jonathan\'s act stands as sent')
  await page.waitForTimeout(2000)   // a few sync rounds pass
  check(await ev(() => window.__t.P('E').view.prompts.length === 0 && !window.__t.wire().some((w) => w.kind === 'introduction-forward/0.1')),
    'nothing reaches Emil while Anton is away — the act is relayed by the mediator, not by a drop')

  // Anton back online: his device takes the request and forwards it
  await page.locator('#dev-A .devctls .devbtn').first().click()
  await until(() => window.__t.P('A').online === true)
  await until(() => window.__t.wire().some((w) => w.kind === 'introduction-forward/0.1' && w.from === 'Anton' && w.to === 'Emil' && w.disp === 'unique'))
  check(true, 'Anton back online: the request flows from transit, his device forwards it to Emil')
  await page.locator('#dev-E .incoming .iq', { hasText: 'relays a request: Jonathan wants to connect with you' }).waitFor()
  check(await ev(() => window.__t.P('E').view.prompts[0]?.kind === 'introduction'), 'Emil: a consent prompt — receiving is not consenting')
  await page.locator('#dev-E .incoming .yes').click()
  await until(() => window.__t.named('J', 'Emil').some((c) => c.provenance === 'introduced') && window.__t.named('E', 'Jonathan').some((c) => c.provenance === 'introduced'))
  check(true, 'Emil consents: the reply goes back via Anton — both hold each other, introduced')
  check(await ev(() => {
    const { P, named } = window.__t
    const jc = named('J', 'Emil')[0], ec = named('E', 'Jonathan')[0]
    return P('J').view.contacts.find((c) => c.id === jc.via)?.displayName === 'Anton' && P('E').view.contacts.find((c) => c.id === ec.via)?.displayName === 'Anton'
  }), 'both introduced via their own Anton contact')
  check(await ev(() => {
    const { P, counterparts } = window.__t
    const jE = counterparts('J').filter((a) => P('E').owns(a)), eJ = counterparts('E').filter((a) => P('J').owns(a))
    const anton = counterparts('A')
    return jE.length > 0 && eJ.length > 0 && ![...jE, ...eJ].some((a) => anton.includes(a))
  }), 'the crossed anchors are fresh — Anton holds neither (nothing was transferred)')
  check(await ev(() => window.__t.intros('J')[0].vouched && window.__t.intros('E')[0].vouched), 'vouchers verified on both sides (act-bound, from the mediator)')
  await tab('J', 'Contacts'); await tab('E', 'Contacts')
  await shot('2-introduced.png')

  // 🗂 the wallet below the device
  await page.locator('#dev-J .wcat button', { hasText: 'Introductions' }).click()
  await page.locator('#dev-J .witem .wtitle', { hasText: 'voucher · about Emil' }).waitFor()
  check(true, 'wallet: Introductions opens — the voucher about Emil with its JSON')
  check((await page.locator('#dev-J .witem .wtitle', { hasText: 'request · for Emil' }).count()) === 1, 'wallet: the own request (with the fresh card) is there')
  await page.locator('#dev-J .wchip', { hasText: 'Sent' }).click()
  check((await page.locator('#dev-J .witem .wtitle', { hasText: 'voucher' }).count()) === 0 &&
    (await page.locator('#dev-J .witem .wtitle', { hasText: 'request · for Emil' }).count()) === 1, 'wallet filter Sent: received artefacts hidden')
  await page.locator('#dev-J .wchip', { hasText: 'All' }).click()
  await page.locator('#dev-J .wcat button', { hasText: 'Introductions' }).click()

  // the introduced contact's detail
  await page.locator('#dev-J .prow', { hasText: 'Emil' }).click()
  await page.locator('#dev-J .pmeta', { hasText: 'introduced via Anton' }).waitFor()
  check((await page.locator('#dev-J .pmeta', { hasText: 'not yet verified' }).count()) >= 1, 'meta line: the state explained, with the continuity path')
  check((await page.locator('#dev-J .profmeta', { hasText: 'introduction-voucher' }).count()) === 1, 'contact detail: the act voucher')
  check((await page.locator('#dev-J .profact button', { hasText: 'Invite to group' }).count()) === 1, 'contact detail: "Invite to group…"')
  await page.locator('#dev-J .profact button.trust', { hasText: 'Trust…' }).click()
  await page.locator('#dev-J .phdlg-card', { hasText: 'Not yet verified' }).waitFor()
  check((await page.locator('#dev-J .phdlg-card', { hasText: 'introduced via Anton' }).count()) === 1, 'introduced: the trust act is allowed, the sheet names the reliance on the introducer')
  await page.locator('#dev-J .phdlg-btns button', { hasText: 'Cancel' }).click()

  // badge grammar
  await page.locator('#dev-J .backbtn').click()
  await tab('A', 'Contacts')
  check((await page.locator('#dev-A .pbadge.mutual', { hasText: '⇄ verified' }).count()) === 2, 'Anton\'s ceremony contacts carry the blue ⇄ verified badge')
  check((await page.locator('#dev-J .pbadge.byme', { hasText: '⇄ introduced' }).count()) === 1, 'Jonathan\'s Emil carries the amber ⇄ introduced badge')
  check((await page.locator('#dev-J .pmeta', { hasText: 'first real meeting' }).count()) >= 1, 'the meta line names the continuity path to ✓')

  // tabs and status bar
  check((await page.locator('#dev-J .phone-status .st-owner').textContent()) === 'Jonathan', 'status bar top right: the owner name')
  await tab('J', 'Profile')
  await page.locator('#dev-J .profhead .pname', { hasText: 'Jonathan' }).waitFor()
  check((await page.locator('#dev-J .sentrow', { hasText: 'root seed' }).count()) === 1, 'profile tab: the own identity from the device data (anchors + backup line)')
  await tab('J', 'Groups')
  check((await page.locator('#dev-J .pempty', { hasText: 'no groups yet' }).count()) === 1, 'groups tab: honestly empty')

  // ── Jonathan founds the subgroup and invites Emil (introduced channel) ─
  await page.locator('#dev-J .profact button', { hasText: 'Found a group' }).click()
  await page.locator('#gname-J').fill('Orga-Untergruppe')
  await page.locator('#dev-J .phdlg-btns button', { hasText: /^Found$/ }).click()
  await page.locator('#dev-J .prow .pname2', { hasText: 'Orga-Untergruppe' }).waitFor()
  check(await ev(() => window.__t.P('J').view.groups.length === 1 && window.__t.P('J').view.groups[0].members.length === 1), 'founding: genesis + the founder\'s member anchor, the group in the tab')
  await page.locator('#dev-J .prow', { hasText: 'Orga-Untergruppe' }).click()
  await page.locator('#dev-J .profact button', { hasText: 'Invite a member' }).click()
  await page.locator('#dev-J .phdlg .prow', { hasText: 'Emil' }).click()
  await tab('E', 'Home')
  await page.locator('#dev-E .incoming .iq', { hasText: 'invites you to "Orga-Untergruppe"' }).waitFor()
  check(await ev(() => ['x-membership-prelude-request/0.1', 'x-membership-prelude-reply/0.1', 'membership-invite/0.2'].every((k) => window.__t.wire().some((w) => w.kind === k && w.disp === 'unique'))),
    'Emil sees the checked invitation in his Home inbox (prelude → reply → invite ran by themselves)')
  await page.locator('#dev-E .incoming .yes', { hasText: 'Join…' }).click()
  await page.locator('#dev-E .phdlg-card', { hasText: 'Join "Orga-Untergruppe"?' }).waitFor()
  check((await page.locator('#dev-E .phdlg-card', { hasText: 'permanently' }).count()) === 1 && (await page.locator('#cand-E').count()) === 0,
    'join sheet: the one-way door named ("permanently"), no candidacy toggle')
  await page.locator('#dev-E .phdlg-btns button', { hasText: /^Join$/ }).click()
  await until(() => window.__t.P('E').view.groups.length === 1 && window.__t.P('J').view.groups[0].members.length === 2)
  check(await ev(() => ['membership-accept/0.2', 'x-membership-welcome/0.1'].every((k) => window.__t.wire().some((w) => w.kind === k && w.disp === 'unique'))),
    'accept → admission → welcome: both hold the group, roster = 2')
  await tab('E', 'Groups')
  await page.locator('#dev-E .prow', { hasText: 'Orga-Untergruppe' }).click()
  await page.locator('#dev-E .prow .pname2', { hasText: 'Jonathan' }).waitFor()
  check((await page.locator('#dev-E .pbadge.trustb', { hasText: 'founder' }).count()) >= 1, 'Emil\'s group detail: the roster with the founder badge')
  check(await ev(() => {
    const { P, counterparts } = window.__t
    const g = P('E').view.groups[0]
    const self = g.members.find((m) => m.self).anchor
    return P('E').view.state.groups[g.id].memberLabel === 'group/' + g.id && !counterparts('J').includes(self)
  }), 'member anchor ≠ relationship anchor (context separation visible in the data)')
  // shared groups come from the contact's last group star (5520): Emil's,
  // sent when he joined, hits at Jonathan; Jonathan's reached Emil before
  // Emil was a member and is matched again when Emil joins
  await tab('J', 'Contacts')
  await page.locator('#dev-J .prow', { hasText: 'Emil' }).click()
  await page.locator('#dev-J .sect', { hasText: 'Shared groups' }).waitFor()
  check((await page.locator('#dev-J .prow', { hasText: 'Orga-Untergruppe' }).count()) === 1, 'contact detail (Jonathan→Emil): the shared group, from Emil\'s group star')
  check(await ev(() => window.__t.named('J', 'Emil')[0].sharedGroups?.length === 1), 'Jonathan\'s Emil carries the shared group (the contact\'s claim, 5.2)')
  check(await ev(() => window.__t.named('E', 'Jonathan')[0].sharedGroups?.length === 1), 'Emil\'s Jonathan carries it too: the group star Emil held from before his join, matched again on joining')
  await page.locator('#dev-J .backbtn').click()
  await page.locator('#dev-J .wcat button', { hasText: 'Membership' }).click()
  await page.locator('#dev-J .witem .wtitle', { hasText: 'genesis · Orga-Untergruppe' }).waitFor()
  check(true, 'wallet (Jonathan): the genesis under Membership')
  check(await ev(() => window.__t.P('A').view.groups.length === 0), 'Anton (the mediator) holds NOTHING of the group')
  await shot('3-group.png')
  await page.locator('#dev-J .wcat button', { hasText: 'Membership' }).click()

  // ── the trust act (one-way door, designated verifier) ─────────────────
  await tab('A', 'Contacts')
  await page.locator('#dev-A .prow', { hasText: 'Jonathan' }).click()
  await page.locator('#dev-A .profact button.trust', { hasText: 'Trust…' }).click()
  await page.locator('#dev-A .phdlg-card', { hasText: 'Trust Jonathan permanently?' }).waitFor()
  check((await page.locator('#dev-A .phdlg-card', { hasText: 'one way' }).count()) === 1, 'trust sheet: one-way door + deniability named')
  await page.locator('#dev-A .phdlg-btns button', { hasText: /^Trust$/ }).click()
  await page.locator('#dev-J .toast', { hasText: 'trusts you now' }).waitFor({ timeout: 6000 })
  check(true, 'toast: a passive event ("Anton trusts you now"), no decision needed')
  check(await ev(() => {
    const j = window.__t.named('J', 'Anton')[0]
    const t = Object.values(window.__t.P('J').view.state.relationships).flatMap((r) => r.tuples).find((x) => x.entryId === j.id && x.mappingIn.self)
    return j.trust.received && t?.mappingIn.self === window.__t.P('A').community
  }), 'Jonathan holds Anton\'s stable (community) anchor — the mapping VERIFIED')
  check((await page.locator('#dev-A .pbadge.trustb', { hasText: '→ you trust' }).count()) === 1, 'Anton\'s badge: → you trust (direction, one-sided)')
  await tab('J', 'Contacts')
  check((await page.locator('#dev-J .pbadge.trustb', { hasText: '← trusts you' }).count()) === 1, 'Jonathan\'s badge: ← trusts you (received ≠ returned)')
  await page.locator('#dev-J .prow', { hasText: '⇄ verified' }).click()   // Anton's row
  await page.locator('#dev-J .profact button.trust').click()
  await page.locator('#dev-J .phdlg-btns button', { hasText: /^Trust$/ }).click()
  await until(() => { const a = window.__t.named('A', 'Jonathan')[0]; return a.trust.given && a.trust.received })
  await page.locator('#dev-A .pbadge.trustb', { hasText: '⇆ trust' }).waitFor()
  check(true, 'both ways: ⇆ trust — two one-sided acts, nothing automatic')
  check((await page.locator('#dev-A .sect', { hasText: 'Mutual contacts' }).count()) === 0 &&
    await ev(() => { const P = window.__t.P; const c = window.__t.named('A', 'Jonathan')[0]; return Object.values(P('A').view.state.relationships).flatMap((r) => r.tuples).filter((t) => t.entryId === c.id).every((t) => !(t.starIn.accepted?.matches.length)) }),
    'no mutual contact checkable → the section stays hidden, nothing faked')
  await page.locator('#dev-A .sect', { hasText: 'Settings' }).waitFor()
  await page.locator('#dev-A .plist .toggle').click()
  await page.locator('#dev-A .pmeta', { hasText: 'paused — what was delivered stays' }).waitFor()
  check(await ev(() => window.__t.named('A', 'Jonathan')[0].trust.paused === true), 'contact updates paused — the door stays open, only the subscription stops')

  // ── continuity (§6a): the introduction duplicate is CHAINED ───────────
  await tab('J', 'Contacts')
  await page.locator('#dev-J .prow', { hasText: '⇄ introduced' }).click()   // Emil's row
  await page.locator('#dev-J .profact button', { hasText: 'Introduce…' }).click()
  await page.locator('#dev-J .phdlg .prow', { hasText: 'Anton' }).click()
  await page.locator('#dev-J .phdlg-btns button', { hasText: /^Introduce$/ }).click()
  await tab('A', 'Home')
  await page.locator('#dev-A .incoming .iq', { hasText: 'wants to connect you with Emil' }).waitFor()
  await page.locator('#dev-A .incoming .yes').click()
  await tab('E', 'Home')
  await page.locator('#dev-E .incoming .iq', { hasText: 'Anton wants to connect with you' }).waitFor()
  check(true, 'a chain introduction: Jonathan, who knows Emil only by introduction, introduces Anton to him')
  await page.locator('#dev-E .incoming .yes').click()
  await until(() => {
    const { named, P } = window.__t
    const aE = named('A', 'Emil'), eA = named('E', 'Anton')
    return aE.length === 1 && eA.length === 1 && P('A').view.contacts.length === 2 && P('E').view.contacts.length === 2 &&
      aE[0].relationships[0].chainedFrom.length === 1 && aE[0].verification === 'mutual' && eA[0].relationships[0].chainedFrom.length === 1
  }, null, 15000)
  check(true, 'probe + continuity mapping: the duplicate is chained — each holds EXACTLY ONE contact for the other')
  await tab('A', 'Contacts')
  check((await page.locator('#dev-A .prow .pname2', { hasText: 'Emil' }).count()) === 1, 'Anton\'s list: one Emil, still ⇄ verified')
  await page.locator('#dev-A .prow', { hasText: 'Emil' }).click()
  await page.locator('#dev-A .profmeta', { hasText: 'continuity: 2 enactments' }).waitFor()
  check(true, 'contact detail: the chain is relationship history')
  check(await ev(() => window.__t.wire().some((w) => w.kind === 'continuity-probe/0.1') && window.__t.wire().some((w) => w.kind === 'continuity-mapping/0.1')),
    'on the wire: the blinded probe and the double-MAC continuity mapping, sealed')
  await page.locator('#dev-A .backbtn').click()

  // ── the WoT app flow: FAB → connect screen → scan flight → prompt ─────
  await page.locator('#dev-J .fab').click()
  await page.locator('#dev-J .phone-screen', { hasText: 'Show your code or scan' }).waitFor()
  check(true, 'the FAB opens the connect screen: own code + scan')
  await page.locator('#dev-J .phone-screen button', { hasText: 'Scan code' }).click()
  await page.locator('#dev-J .phdlg-card', { hasText: 'No code in view' }).waitFor()
  check(true, 'scanning while nobody shows a code: an honest no-op')
  await page.locator('#dev-J .phdlg-btns button', { hasText: 'Ok' }).click()
  await page.locator('#dev-E .fab').click()
  await page.locator('#dev-E .phone-screen', { hasText: 'Show your code or scan' }).waitFor()
  await page.locator('#dev-J .phone-screen button', { hasText: 'Scan code' }).click()
  await page.locator('#dev-J .phone-screen', { hasText: 'camera — carries no traffic' }).waitFor()
  check(true, 'scanner running: see-through viewfinder, the camera recognizes by itself')
  await page.locator('#dev-J .phone-screen', { hasText: 'Are you standing in front of this person?' }).waitFor()
  check((await page.locator('#dev-J .phone-screen', { hasText: 'Emil' }).count()) >= 1, 'after the return flight: the scanned person is shown')
  await page.locator('#dev-J .phone-screen button', { hasText: /^Confirm$/ }).click()
  await page.locator('#dev-J .phone-screen', { hasText: 'device acknowledged' }).waitFor()
  check(await ev(() => window.__t.named('J', 'Emil').some((c) => c.verification === 'outgoing')), 'Jonathan\'s confirmation: delivered only by the ack — the edge honestly → (one-sided)')
  await page.locator('#dev-E .phone-screen', { hasText: 'Verify Jonathan back?' }).waitFor()
  check((await page.locator('#dev-E .phone-screen', { hasText: 'Arrival is not acceptance' }).count()) === 1, 'full-screen prompt at the receiver (encounter-confirm): arrival ≠ acceptance')
  await page.locator('#dev-E .phone-screen button', { hasText: /^Confirm$/ }).click()
  await page.locator('#dev-J .cdlg', { hasText: 'You and Emil have now verified each other' }).waitFor()
  check((await page.locator('#dev-J .cdlg .avpair .av').count()) === 2, 'the celebration dialog CENTRED: both avatars + "verified each other"')
  await until(() => {
    const { named, P } = window.__t
    const em = named('J', 'Emil'), jo = named('E', 'Jonathan')
    return em.length === 1 && jo.length === 1 && em[0].verification === 'mutual' && jo[0].verification === 'mutual' &&
      em[0].relationships[0].chainedFrom.length === 1 && P('J').view.contacts.length === 2
  }, null, 15000)
  check(await ev(() => window.__t.named('J', 'Emil')[0].provenance === 'introduced'), 'chapter 2 live: introduced → verified by the chain, ONE Emil; how the person came stays')
  await page.locator('#dev-J .cdlg button', { hasText: 'Trust…' }).click()
  await page.locator('#dev-J .phdlg-card', { hasText: 'Trust Emil permanently?' }).waitFor()
  check((await page.locator('#dev-J .phdlg-card', { hasText: 'Not yet verified' }).count()) === 0, 'the trust sheet without the introducer note — verified now')
  await page.locator('#dev-J .phdlg-btns button', { hasText: /^Trust$/ }).click()
  await until(() => window.__t.named('E', 'Jonathan')[0]?.trust.received)
  const later = page.locator('#dev-E .cdlg button', { hasText: 'Later' })
  if (await later.count()) await later.click()
  await tab('E', 'Contacts')
  check((await page.locator('#dev-E .pbadge.trustb', { hasText: '← trusts you' }).count()) === 1, 'and Emil sees it: ← trusts you')

  // ── offline: the two-way scan (re-verification Jonathan ⇠⇢ Anton) ─────
  await closeDialogs()
  await page.locator('#dev-A .devctls .devbtn').first().click()
  await until(() => window.__t.P('A').online === false)
  await page.locator('#dev-A .fab').click()
  await page.locator('#dev-A .phone-screen', { hasText: 'Show your code or scan' }).waitFor()
  await page.locator('#dev-J .fab').click()
  await page.locator('#dev-J .phone-screen button', { hasText: 'Scan code' }).click()
  await page.locator('#dev-J .phone-screen', { hasText: 'Are you standing in front of this person?' }).waitFor()
  await page.locator('#dev-J .phone-screen button', { hasText: /^Confirm$/ }).click()
  await page.locator('#dev-J .phone-screen', { hasText: 'Sent to Anton' }).waitFor()
  check(await ev(() => window.__net.net.channel.transit.get('Anton')?.length >= 1), 'the other side offline: the bundle waits in transit — delivery time unbounded')
  await page.locator('#dev-J .phone-screen', { hasText: 'Show this code to Anton' }).waitFor({ timeout: 12000 })
  check(true, 'ack-wait elapsed: automatic switch to the two-way scan (the sent card as QR)')
  await page.locator('#dev-A .phone-screen button', { hasText: 'Scan code' }).click()
  await page.locator('#dev-A .phone-screen', { hasText: 'Verify Jonathan back?' }).waitFor()
  check((await page.locator('#dev-A .phone-screen', { hasText: 'two-way scan' }).count()) >= 1, 'Anton captures the sent card: full-screen prompt, the same encounter taken over optically')
  await page.locator('#dev-A .phone-screen button', { hasText: /^Confirm$/ }).click()
  await until(() => window.__t.named('A', 'Jonathan').some((c) => c.verification === 'outgoing'))
  check(true, 'confirmed offline: honestly one-sided, the counter-credential issued — its delivery waits for the bundle\'s thread (4.3 step counter)')
  await page.locator('#dev-A .devctls .devbtn').first().click()
  await until(() => {
    const { named, P } = window.__t
    const jo = named('A', 'Jonathan'), an = named('J', 'Anton')
    return jo.length === 1 && an.length === 1 && jo[0].verification === 'mutual' && an[0].verification === 'mutual' &&
      P('A').view.contacts.length === 2 && P('J').view.contacts.length === 2 && jo[0].relationships[0].tuples === 2
  }, null, 20000)
  check(true, 'network back: the bundle and the counter-credential flow, the probe chains the re-verification — both ⇄, no duplicate')

  // ── delivery stages + fault injection ──────────────────────────────────
  check(await ev(() => window.__t.wire().some((w) => (w.stages?.length ?? 0) === 9 && w.disp === 'unique')), 'wire panel: every delivery carries the receiver\'s stages 1–9 (Delivery §6.2)')
  check((await page.locator('.fbtn').count()) === 4, 'fault panel: hold · dup · tamper · lose')
  await closeDialogs()
  await page.locator('.fbtn', { hasText: 'Deliver everything twice' }).click()
  await tab('A', 'Contacts')
  await page.locator('#dev-A .prow', { hasText: 'Emil' }).click()
  await page.locator('#dev-A .profact button.trust').click()
  await page.locator('#dev-A .phdlg-btns button', { hasText: /^Trust$/ }).click()
  await until(() => window.__t.wire().some((w) => w.kind.includes('DUPLICATE (fault)') && w.disp === 'duplicate-known'))
  check(true, 'dup fault: the second delivery → duplicate-known, the prior outcome applies — no second effect')
  await until(() => window.__t.named('E', 'Anton')[0]?.trust.received)
  check(await ev(() => window.__t.P('E').events.filter((e) => e.type === 'trust.received').length === 2), 'the effect arrived exactly once: Emil holds Anton\'s disclosure (one trust.received from Anton, one from Jonathan before)')
  await page.locator('.fbtn', { hasText: 'Deliver everything twice' }).click()
  await page.locator('.fbtn', { hasText: 'Flip one ciphertext bit' }).click()
  await tab('E', 'Contacts')
  await page.locator('#dev-E .prow', { hasText: 'Anton' }).click()
  await page.locator('#dev-E .profact button.trust').click()
  await page.locator('#dev-E .phdlg-btns button', { hasText: /^Trust$/ }).click()
  await until(() => window.__t.wire().some((w) => w.disp === 'failed(decryption-failed)'))
  check(true, 'tamper fault: one flipped bit — stage 3 (the AES-GCM tag) refuses, failed(decryption-failed)')
  await page.locator('.fbtn', { hasText: 'Flip one ciphertext bit' }).click()

  // ── the sim clock: run, age, drift ─────────────────────────────────────
  check((await page.locator('.clockbar .rbtn').count()) === 4 && (await page.locator('.devctls .devbtn').count()) === 6, 'time controls: world time + rate in the header, a drift button on EVERY device')
  check((await page.locator('.stored').count()) === 3, 'artefact layer: one panel below each device (outside the app)')
  const clockOf = (id) => page.locator(`#dev-${id} .phone-status span`).first().textContent()
  const beforeSkew = await clockOf('A')
  await page.locator('#dev-A .devctls .devbtn:last-child').click()
  check((await clockOf('A')) !== beforeSkew && (await clockOf('A')) !== (await clockOf('J')), 'skew: Anton\'s device reads another clock than Jonathan\'s — drift is the normal case')
  await page.locator('#dev-A .devctls .devbtn:last-child').click()
  await page.locator('#dev-A .devctls .devbtn:last-child').click()   // back to ±0 (cyclic)
  // a lost delivery: the sender's resume re-offers it after its backoff
  await closeDialogs()
  await page.locator('.fbtn', { hasText: 'Lose deliveries' }).click()
  await tab('A', 'Contacts')
  await page.locator('#dev-A .prow', { hasText: 'Jonathan' }).click()
  await page.locator('#dev-A .plist .toggle').click()   // unpause: the star flows again (5.4)
  await until(() => window.__t.wire().some((w) => /^lost/.test(w.disp ?? '')))
  await page.locator('.fbtn', { hasText: 'Lose deliveries' }).click()
  await page.locator('.rbtn', { hasText: /^60×$/ }).click()
  await until(() => window.__t.wire().some((w) => w.attempt === 2 && w.disp === 'unique'), null, 20000)
  await page.locator('.rbtn', { hasText: 'paused' }).click()
  check(true, 'lose fault: no sign on the channel; with the clock running the sender\'s resume re-offers it (attempt 2) and it lands')
  // ageing becomes real: the displayed code rotates at PT5M by itself
  await closeDialogs()
  await page.locator('#dev-J .fab').waitFor()
  await page.locator('#dev-J .fab').click()
  await page.locator('#dev-J .phone-screen', { hasText: 'Show your code or scan' }).waitFor()
  const shown = await ev(() => window.__net.shows.J.card.anchor)
  const heldBefore = await ev(() => Object.keys(window.__t.P('J').view.state.encounter.challenges).length)
  await page.locator('.rbtn', { hasText: '60×' }).click()
  await until((a) => window.__net.shows.J?.card.anchor !== a, shown, 20000)
  await page.locator('.rbtn', { hasText: 'paused' }).click()
  check(await ev(() => window.__t.P('J').log.some((l) => l.includes('rotated by itself'))), 'running time: the displayed code reaches PT5M and is shown afresh — a fresh pair anchor')
  check(await ev((n) => Object.keys(window.__t.P('J').view.state.encounter.challenges).length > n, heldBefore),
    'rotation changes what is displayed, never what is retained: the holder keeps the aged challenge beside the fresh one (5.3)')
  check(errors.length === 0, `no page errors (${errors.length})`)
} catch (e) {
  fails++
  console.log('✗ FAIL', e.message.split('\n')[0])
  await shot('fail.png').catch(() => {})
} finally {
  await browser.close()
  server.close()
}
console.log(fails ? `\n${fails} FAILED` : '\nNETWORK UI RUN (APP FLOW + DELIVERY + SIM CLOCK) PASSED')
process.exit(fails ? 1 : 0)
