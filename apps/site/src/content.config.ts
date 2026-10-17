import { defineCollection } from 'astro:content'
import { z } from 'astro/zod'
import { docsLoader } from '@astrojs/starlight/loaders'
import { docsSchema } from '@astrojs/starlight/schema'

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    // `specs`: the specifications a page rests on, by file name in spec/
    // (scripts/check-doc-specs.mjs keeps the page in step with them);
    // `library`: the page describes the library and follows its releases
    schema: docsSchema({ extend: z.object({ specs: z.array(z.string()).default([]), library: z.boolean().default(false) }) }),
  }),
}
