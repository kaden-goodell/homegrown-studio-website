/**
 * The site's public address. Link previews, canonical links, the sitemap and
 * the details given to Google all need complete addresses, including on
 * preview deploys and localhost, so they are built from this and never from
 * the address the page happened to be requested on.
 *
 * Must match `site` in astro.config.mjs (a test checks that).
 * Client-safe: no imports, no env.
 */
export const SITE_URL = 'https://ourhometownstudio.com'

/** Link-preview image used when a page has nothing more specific. 1200 × 630. */
export const DEFAULT_SHARE_IMAGE = '/images/share-default.png'
export const SHARE_IMAGE_WIDTH = 1200
export const SHARE_IMAGE_HEIGHT = 630
