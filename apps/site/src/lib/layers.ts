import { icons, type IconName } from '../components/icons'

/**
 * The protocol as a picture: applications on top, then the three layers RLTP
 * specifies, then the two services behind ports. Each band leads to its
 * section below, so the picture is also the map of the page.
 */
interface Band { key: string; label: string; href?: string; kind: 'apps' | 'layer' | 'ports'; chips: [IconName, string][] }

const bands: Band[] = [
  { key: 'apps', label: 'Applications', kind: 'apps', chips: [['globe', 'Your app'], ['rocket', 'Web of Trust']] },
  { key: 'access', label: 'Access', kind: 'layer', href: '#access', chips: [['users', 'Groups as places'], ['shield', 'Policy as data'], ['lock', 'Epochs']] },
  { key: 'encounter', label: 'Encounter', kind: 'layer', href: '#encounter', chips: [['wot', 'Ceremony'], ['shield-check', 'Credentials'], ['message-square', 'Contact cards']] },
  { key: 'identity', label: 'Identity', kind: 'layer', href: '#identity', chips: [['fingerprint', 'One seed'], ['waypoints', 'Anchor per context'], ['hard-drive', 'Recovery']] },
  { key: 'ports', label: 'Services behind ports', kind: 'ports', href: '#services', chips: [['plug', 'Delivery'], ['database', 'Replication']] },
]

const svg = (name: IconName) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`

export function layerDiagramHtml(): string {
  const html = bands
    .map((b) => {
      const tag = b.href ? 'a' : 'div'
      const href = b.href ? ` href="${b.href}"` : ''
      return (
        `<${tag} class="tp-band ${b.kind}" data-band="${b.key}"${href}>` +
        `<span class="tp-band-label">${b.label}</span>` +
        `<ul>${b.chips.map(([icon, text]) => `<li>${svg(icon)}<span>${text}</span></li>`).join('')}</ul>` +
        `</${tag}>`
      )
    })
    .join('')
  return `<nav class="tp-bands" aria-label="How RLTP is built">${html}</nav>`
}
