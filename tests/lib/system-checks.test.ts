// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mem = vi.hoisted(() => new Map<string, Map<string, string>>())
vi.mock('@lib/blob-store', () => ({
  makeKvStore: (name: string) => {
    const m = mem.get(name) ?? new Map<string, string>()
    mem.set(name, m)
    return {
      async get(k: string) { return m.get(k) ?? null },
      async set(k: string, v: string) { m.set(k, v) },
      async list(prefix?: string) { return [...m.keys()].filter((k) => !prefix || k.startsWith(prefix)) },
    }
  },
}))

import { systemWarnings } from '@lib/system-checks'

const archive = () => mem.get('archive')!
const now = new Date('2026-11-20T15:00:00.000Z')

describe('archive-stale (I-9)', () => {
  beforeEach(() => { for (const m of mem.values()) m.clear() })

  it('nothing on a site where the archive never ran (a test site)', async () => {
    expect(await systemWarnings(now)).toEqual([])
  })
  it('a line when the newest snapshot is more than 8 days old, with the button that saves a copy now', async () => {
    archive().set('archive/2026-11-01.json', '{}')
    archive().set('archive/2026-11-08.json', '{}')
    const line = (await systemWarnings(now)).find((w) => w.code === 'archive-stale')
    expect(line).toMatchObject({ title: 'Records backup', detail: expect.stringContaining('since 2026-11-08'), action: expect.stringMatching(/More › Records › Everything › Download records/) })
  })
  it('none while the newest is recent; a line when the last run started and never finished', async () => {
    archive().set('archive/2026-11-15.json', '{}')
    expect(await systemWarnings(now)).toEqual([])
    archive().set('progress/last.json', JSON.stringify({ startedAt: '2026-11-15T08:00:00.000Z', finishedAt: null }))
    expect((await systemWarnings(now))[0]).toMatchObject({ code: 'archive-stale', detail: expect.stringContaining('stopped') })
  })
})
