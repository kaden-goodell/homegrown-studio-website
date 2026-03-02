import { defineCollection, z } from 'astro:content'
import { glob } from 'astro/loaders'

const about = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/about' }),
  schema: z.object({
    title: z.string(),
    order: z.number().optional(),
  }),
})

export const collections = { about }
