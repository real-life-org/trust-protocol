import { icons, type IconName } from '../components/icons'

/**
 * The hero picture: one encounter, drawn. Two devices, each under a fresh
 * identifier, and the credential each issues to the other. Nothing in it is
 * data: the names and the truncated keys are illustration.
 */
const svg = (name: IconName) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`

const device = (who: string, key: string) =>
  `<div class="tp-device"><div class="tp-device-head"><span class="tp-icon tile">${svg('fingerprint')}</span><div><strong>${who}'s device</strong><span>fresh anchor</span></div></div><code>${key}</code></div>`

const credential = (from: string, to: string) =>
  `<div class="tp-cred">${svg('shield-check')}<span><strong>${from} → ${to}</strong> encounter credential, signed</span><code>ed25519</code></div>`

export function encounterHtml(): string {
  return (
    `<figure class="tp-encounter" aria-label="One encounter: two devices under fresh identifiers issue each other a credential">` +
    `<div class="tp-encounter-head"><span class="tp-kicker">One encounter</span><span class="tp-offline">fully offline</span></div>` +
    `<div class="tp-devices">${device('Ana', 'did:key:z6MkhaXg…9vQ2')}${device('Ben', 'did:key:z6MkrJVn…3kLp')}</div>` +
    `<div class="tp-creds">${credential('Ana', 'Ben')}${credential('Ben', 'Ana')}</div>` +
    `<figcaption>Key control, freshness and deliberate recognition. Nothing more, and never revoked.</figcaption>` +
    `</figure>`
  )
}
