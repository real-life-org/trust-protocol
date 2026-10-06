import { readdirSync } from 'node:fs'
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

/**
 * trust-protocol.real-life.org: landing and docs in one site, built like
 * real-life-stack.de (Astro + Starlight). English only. The normative files
 * (spec/, schemas/, vectors/, …) are copied next to the build unchanged by the
 * Pages workflow, so their URLs keep working.
 */
const REPO = 'https://github.com/real-life-org/trust-protocol'

// The old Pages build (Jekyll) served HTML renderings of the Markdown files
// as well. Extension-less addresses are redirects here; the `.html` ones are
// written as files by scripts/assemble.mjs, where the raw files are copied.
function legacyRedirects() {
  const out = {}
  const specs = readdirSync(new URL('../../spec/', import.meta.url)).filter((f) => f.endsWith('.md'))
  for (const f of specs) out[`/spec/${f.replace(/\.md$/, '')}`] = `${REPO}/blob/main/spec/${f}`
  return out
}

export default defineConfig({
  site: 'https://trust-protocol.real-life.org',
  trailingSlash: 'ignore',
  redirects: legacyRedirects(),
  integrations: [
    starlight({
      title: 'Real Life Trust Protocol',
      description: 'A trust protocol rooted in encounters between people: specifications, library, simulators.',
      customCss: ['./src/styles/tokens.css', './src/styles/site.css'],
      components: { Footer: './src/components/Footer.astro' },
      favicon: '/favicon.svg',
      head: [{ tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' } }],
      social: [{ icon: 'github', label: 'GitHub', href: REPO }],
      editLink: { baseUrl: `${REPO}/edit/main/apps/site/` },
      sidebar: [
        { label: 'Get started', items: [
          { label: 'Try it', link: '/get-started/try-it/' },
          { label: 'Read the spec', link: '/get-started/read-the-spec/' },
          { label: 'Implement', link: '/get-started/implement/' },
        ] },
        { label: 'Understand', items: [
          { label: 'Why', items: [
            { label: 'Invitation, not checkpoint', link: '/understand/why/' },
          ] },
          { label: 'Foundations', link: '/understand/foundations/' },
          { label: 'Encounter', link: '/understand/encounter/' },
        ] },
        { label: 'Reference', items: [
          { label: 'Specifications', link: '/reference/specifications/' },
          { label: 'Schemas', link: `${REPO}/tree/main/schemas` },
          { label: 'Test vectors', link: `${REPO}/tree/main/vectors` },
          { label: 'Term register', link: '/terms/rltp.skos.jsonld' },
        ] },
        { label: 'Library on npm', link: 'https://www.npmjs.com/package/@real-life/trust-protocol' },
      ],
    }),
  ],
})
