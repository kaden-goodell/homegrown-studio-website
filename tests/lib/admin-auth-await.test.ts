// adminAuthorized/adminActor are async (G4): a call without `await` is a Promise, always truthy,
// so `if (!adminAuthorized(request))` would let EVERY request in. This guard catches a missed await
// in any route, including ones merged in later.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f)
  return statSync(p).isDirectory() ? files(p) : /\.(tsx?|astro)$/.test(f) ? [p] : []
})

describe('admin auth is always awaited', () => {
  it('every adminAuthorized / adminConfigured / checkAdminPasscode / adminActor call outside admin-auth.ts is awaited', () => {
    const bad: string[] = []
    for (const f of [...files('src'), ...files('netlify')]) {
      if (f.endsWith('src/lib/admin-auth.ts')) continue
      const lines = readFileSync(f, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (/^\s*(\*|\/\/)/.test(line) || /^\s*import\b/.test(line)) return
        for (const m of line.matchAll(/\b(adminAuthorized|adminConfigured|checkAdminPasscode|adminActor)\(/g)) {
          const before = line.slice(0, m.index)
          if (!/await\s*\(?\s*$/.test(before) && !/ReturnType<typeof\s*$/.test(before)) bad.push(`${f}:${i + 1}: ${line.trim()}`)
        }
      })
    }
    expect(bad).toEqual([])
  })
})
