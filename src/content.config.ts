import { defineCollection, z } from 'astro:content'
import { glob } from 'astro/loaders'

const about = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/about' }),
  schema: z.object({
    title: z.string(),
    order: z.number().optional(),
  }),
})

const gallery = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/gallery' }),
  schema: z.object({
    title: z.string(),
    caption: z.string(),
    image: z.string(),
    order: z.number().optional(),
    tags: z.array(z.string()).optional(),
  }),
})

export const collections = { about, gallery }
