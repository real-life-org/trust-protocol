import { icons, type IconName } from '../components/icons'

/**
 * The protocol as a picture: applications on top, the three layers RLTP
 * specifies below them, and beside the layers the two services behind ports,
 * which the layers use rather than stand on. Each band leads to its section
 * below, so the picture is also the map of the page.
 */
interface Band { key: string; label: string; href?: string; kind: 'apps' | 'layer'; chips: [IconName, string][] }
interface Service { key: string; label: string; text: string; icon: IconName }

const bands: Band[] = [
  { key: 'apps', label: 'Applications', kind: 'apps', chips: [['globe', 'Your app'], ['rocket', 'Web of Trust']] },
  { key: 'access', label: 'Access', kind: 'layer', href: '#access', chips: [['users', 'Groups as places'], ['shield', 'Policy as data'], ['lock', 'Epochs']] },
  { key: 'encounter', label: 'Encounter', kind: 'layer', href: '#encounter', chips: [['wot', 'Ceremony'], ['shield-check', 'Credentials'], ['message-square', 'Contact cards']] },
  { key: 'identity', label: 'Identity', kind: 'layer', href: '#identity', chips: [['fingerprint', 'One seed'], ['waypoints', 'Anchor per context'], ['hard-drive', 'Recovery']] },
]
const services: Service[] = [
  { key: 'delivery', label: 'Delivery', text: 'E2EE messaging', icon: 'plug' },
  { key: 'replication', label: 'Replication', text: 'E2EE state sync', icon: 'database' },
]

const svg = (name: IconName) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`

export function layerDiagramHtml(): string {
  const stack = bands
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
  const rail = `<div class="tp-rail" aria-hidden="true"><span>ports</span></div>`
  const svc = services
    .map((s) => `<a class="tp-band svc" data-svc="${s.key}" href="#services"><span class="tp-band-label">${s.label}</span><ul><li>${svg(s.icon)}<span>${s.text}</span></li></ul></a>`)
    .join('')
  return `<nav class="tp-bands" aria-label="How RLTP is built">${stack}${rail}<div class="tp-svcs">${svc}</div></nav>`
}
