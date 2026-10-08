import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import tailwind from '@astrojs/tailwind'
import netlify from '@astrojs/netlify'

export default defineConfig({
  // The public address. Keep in step with SITE_URL in src/config/site-url.ts
  // (tests/lib/seo.test.ts checks they match).
  site: 'https://ourhometownstudio.com',
  output: 'server',
  adapter: netlify(),
  // Open Studio became Craft Café (Oct 2026); the old address keeps working
  // in dev and on Netlify (the adapter writes it to _redirects).
  redirects: { '/open-studio': { status: 301, destination: '/craft-cafe' } },
  integrations: [
    react(),
    tailwind(),
  ],
})
