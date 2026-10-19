// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { cafeWindows, fitWindows, rewriteCafeWindows, SQUARE_WINDOW_LIMIT, writeCafeWindows, type CafeCatalogClient } from '@lib/cafe-windows'
import { CONFIG_STUDIO_DAYS, type StudioDays } from '@config/studio-days'

const days = (over: Partial<StudioDays> = {}): StudioDays => ({ ...CONFIG_STUDIO_DAYS, ...over })

describe('the windows', () => {
  it('from the config: Saturdays 9–12, the Nov 7 grand opening all day, closed days skipped, never before the café starts', () => {
    const w = cafeWindows(CONFIG_STUDIO_DAYS, '2026-10-01', '2027-01-09')
    expect(w[0]).toBe('2026-11-07T09:00-21:00')
    expect(w).toContain('2026-11-14T09:00-12:00')
    expect(w).toContain('2026-11-28T09:00-12:00')
    // Sat 26 Dec is in the Christmas closure.
    expect(w.some((x) => x.startsWith('2026-12-26'))).toBe(false)
    expect(w).toContain('2027-01-02T09:00-12:00')
  })

  it('from saved settings: a new weekday, a special day and a closure all count', () => {
    const w = cafeWindows(days({
      cafe: { weekly: [{ weekday: 'Saturday', opens: '09:00', closes: '12:00' }, { weekday: 'Sunday', opens: '13:00', closes: '15:00' }], special: [{ date: '2026-11-14', opens: '10:00', closes: '18:00', name: 'Market' }] },
      closures: [{ from: '2026-11-21', to: '2026-11-22', name: 'a break' }],
    }), '2026-11-07', '2026-11-22')
    expect(w).toEqual(['2026-11-07T09:00-12:00', '2026-11-08T13:00-15:00', '2026-11-14T10:00-18:00', '2026-11-15T13:00-15:00'])
  })

  it('keeps as many as fit Square’s 255 characters', () => {
    const all = cafeWindows(CONFIG_STUDIO_DAYS, '2026-11-07', '2027-06-01')
    const kept = fitWindows(all)
    expect(kept.join(',').length).toBeLessThanOrEqual(SQUARE_WINDOW_LIMIT)
    expect(kept.length).toBeLessThan(all.length)
    expect(all.slice(0, kept.length)).toEqual(kept)
  })
})

function client(over: { item?: any; get?: () => Promise<any>; upsert?: (r: any) => Promise<any> } = {}) {
  const item = over.item === undefined
    ? { id: 'ITEM', version: 7, itemData: { name: 'Open Studio', variations: [] }, customAttributeValues: { flow: { key: 'flow', stringValue: 'display' }, programDates: { key: 'programDates', stringValue: 'old' } } }
    : over.item
  const get = vi.fn(over.get ?? (async () => ({ object: item })))
  const upsert = vi.fn(over.upsert ?? (async (r: any) => ({ catalogObject: { ...r.object, version: 8 } })))
  return { c: { catalog: { object: { get, upsert } } } as unknown as CafeCatalogClient, get, upsert, item }
}

describe('writing to Square (the script’s calls, unchanged)', () => {
  it('reads the item, then upserts it whole with the name, the display flow and the new windows', async () => {
    const { c, get, upsert, item } = client()
    const saved = await writeCafeWindows(c, item, ['2026-11-07T09:00-21:00', '2026-11-14T09:00-12:00'])
    expect(get).not.toHaveBeenCalled()
    const req = upsert.mock.calls[0][0]
    expect(req.idempotencyKey).toMatch(/^cafe-windows-\d+$/)
    expect(req.object).toEqual({
      ...item,
      itemData: { ...item.itemData, name: 'Craft Café' },
      customAttributeValues: {
        flow: { key: 'flow', stringValue: 'display' },
        programDates: { key: 'programDates', stringValue: '2026-11-07T09:00-21:00,2026-11-14T09:00-12:00' },
      },
    })
    expect(saved).toEqual({ name: 'Craft Café', count: 2, version: 8 })
  })

  it('rewrite: the next 90 days from the settings, when the item exists', async () => {
    const { c, get, upsert } = client()
    const r = await rewriteCafeWindows(CONFIG_STUDIO_DAYS, '2026-11-01', { client: c, itemId: 'ITEM', sandbox: false })
    expect(get).toHaveBeenCalledWith({ objectId: 'ITEM', includeRelatedObjects: false })
    const written: string = upsert.mock.calls[0][0].object.customAttributeValues.programDates.stringValue
    expect(written.split(',')[0]).toBe('2026-11-07T09:00-21:00')
    expect(written.split(',').every((w) => w.slice(0, 10) <= '2027-01-30')).toBe(true)
    expect(r).toMatchObject({ status: 'updated', message: 'Square has the new café hours.' })
    expect(r.coveredThrough).toBe(written.split(',').pop()!.slice(0, 10))
  })

  it('the test site has no café item: skipped, and it says so; nothing is written', async () => {
    const notFound = Object.assign(new Error('Not found'), { statusCode: 404 })
    const { c, upsert } = client({ get: async () => { throw notFound } })
    const r = await rewriteCafeWindows(CONFIG_STUDIO_DAYS, '2026-11-01', { client: c, itemId: 'ITEM', sandbox: true })
    expect(r).toEqual({ status: 'skipped', message: 'Square isn’t updated from the test site.' })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('no item on the live account is a failure the owner sees', async () => {
    const { c, upsert } = client({ item: null })
    const r = await rewriteCafeWindows(CONFIG_STUDIO_DAYS, '2026-11-01', { client: c, itemId: 'ITEM', sandbox: false })
    expect(r.status).toBe('failed')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('Square refusing either call is a failure, never a throw', async () => {
    const down = client({ get: async () => { throw new Error('503') } })
    expect((await rewriteCafeWindows(CONFIG_STUDIO_DAYS, '2026-11-01', { client: down.c, itemId: 'ITEM', sandbox: false })).status).toBe('failed')
    const refused = client({ upsert: async () => { throw new Error('VERSION_MISMATCH') } })
    const log = vi.fn()
    const r = await rewriteCafeWindows(CONFIG_STUDIO_DAYS, '2026-11-01', { client: refused.c, itemId: 'ITEM', sandbox: false, log })
    expect(r).toEqual({ status: 'failed', message: 'Craft Café’s hours in Square didn’t update.' })
    expect(log).toHaveBeenCalledWith('Café windows not rewritten', { error: 'VERSION_MISMATCH' })
  })
})
