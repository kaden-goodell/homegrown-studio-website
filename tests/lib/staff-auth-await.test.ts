// Money review note: /api/staff/reader.json called `if (!staffAuthorized(request))` without await — a Promise is
// always truthy, so GET never answered 401. Every async auth call (staff and admin) must be awaited, in any route.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f)
  return statSync(p).isDirectory() ? files(p) : /\.(tsx?|astro)$/.test(f) ? [p] : []
})

const AUTH = ['staffAuthorized', 'passcodeConfigured', 'checkPasscode', 'staffCookie', 'adminAuthorized', 'adminConfigured', 'checkAdminPasscode', 'adminActor']

describe('every staff and admin auth call is awaited', () => {
  it('no async auth call outside its own module is used without await', () => {
    const bad: string[] = []
    for (const f of [...files('src'), ...files('netlify')]) {
      if (f.endsWith('src/lib/staff-auth.ts') || f.endsWith('src/lib/admin-auth.ts')) continue
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(\*|\/\/)/.test(line) || /^\s*import\b/.test(line)) return
        for (const m of line.matchAll(new RegExp(`\\b(${AUTH.join('|')})\\(`, 'g'))) {
          const before = line.slice(0, m.index)
          if (/\bfunction\s*$|\.\s*$/.test(before)) continue // a definition or a method of something else
          if (!/await\s*\(?\s*$/.test(before) && !/ReturnType<typeof\s*$/.test(before) && !/return\s*$/.test(before)) bad.push(`${f}:${i + 1}: ${line.trim()}`)
        }
      })
    }
    expect(bad).toEqual([])
  })
})
