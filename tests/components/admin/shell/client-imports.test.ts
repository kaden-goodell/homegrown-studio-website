import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * /admin runs in the browser. A value import from a server module (one that
 * reaches node:crypto or the blob stores) breaks hydration with a blank page,
 * which jsdom tests don't notice. Types are fine.
 */
const SERVER = ['artist-applications', 'submissions', 'event-requests', 'contact-messages', 'party-store', 'rsvp-store', 'waiver-store', 'admin-auth', 'staff-auth', 'audit', 'blob-store', 'classes/admin-actions', 'classes/class-store', 'classes/seat-ledger', 'classes/library-store', 'studio-settings', 'settings-effects', 'cafe-windows', 'classes/to-decide', 'to-decide-store']
/** Config modules written client-safe (no env, no server imports). */
const CLIENT_CONFIG = ['closures', 'hours', 'party.config', 'opening', 'studio-days']
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f)
  return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : []
})

describe('/admin browser code', () => {
  it('imports only types from server modules and routes; config only where it is client-safe', () => {
    const bad: string[] = []
    for (const f of files('src/components/admin')) {
      for (const m of readFileSync(f, 'utf8').matchAll(/^import\s+(?!type\b)([^\n]*?)\s+from\s+'@lib\/([^']+)'/gm)) {
        if (SERVER.includes(m[2]) && !/^\{\s*(type\s+\w+\s*,?\s*)+\}$/.test(m[1].trim())) bad.push(`${f}: ${m[0]}`)
      }
      // Routes are server code; config is fine only where it is written client-safe.
      for (const m of readFileSync(f, 'utf8').matchAll(/^import\s+(?!type\b)([^\n]*?)\s+from\s+'@(pages|config)\/([^']+)'/gm)) {
        const typesOnly = /^\{\s*(type\s+\w+\s*,?\s*)+\}$/.test(m[1].trim())
        if (typesOnly) continue
        if (m[2] === 'pages' || !CLIENT_CONFIG.includes(m[3])) bad.push(`${f}: ${m[0]}`)
      }
    }
    expect(bad).toEqual([])
  })
})
