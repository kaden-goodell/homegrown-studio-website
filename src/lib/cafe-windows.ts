/**
 * Craft Café's dated windows on its Square display item (the calendar reads
 * them: `partyConfig.square.openStudioItemId`, custom attribute
 * `programDates`, "YYYY-MM-DDTHH:MM-HH:MM,…"). One window per day the café
 * runs (its weekly hours, or a special day's), skipping closed days.
 *
 * Two callers, the same Square calls:
 *   - scripts/set-cafe-windows.ts (by hand, from the config)
 *   - saving Hours & Craft Café or Closed days on /admin (rewriteCafeWindows),
 *     for the next 90 days from the owners' settings
 *
 * The write is exactly the one the script has always made (proven live):
 * catalog.object.get the item, then catalog.object.upsert it whole with the
 * name "Craft Café", flow "display" and the new programDates.
 */
import { OPEN_STUDIO_START_DATE } from '@config/opening'
import { studioOpenOn } from '@config/closures'
import { cafeHoursOn } from '@config/hours'
import type { StudioDays } from '@config/studio-days'

/** Square caps a string custom attribute at 255 characters: about eleven windows. */
export const SQUARE_WINDOW_LIMIT = 255
/** How far ahead a save on /admin writes. */
export const REWRITE_DAYS = 90

/** YYYY-MM-DD arithmetic on calendar days, no timezones involved. */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** Every window from `from` to `through` (both included), never before the café's first day. Pure. */
export function cafeWindows(days: StudioDays, from: string, through: string): string[] {
  const start = from < OPEN_STUDIO_START_DATE ? OPEN_STUDIO_START_DATE : from
  const out: string[] = []
  for (let day = start; day <= through; day = addDays(day, 1)) {
    if (!studioOpenOn(day, days.closures)) continue
    // A special day (the Nov 7 grand opening) wins over the weekly hours.
    const h = cafeHoursOn(day, days.cafe)
    if (h) out.push(`${day}T${h.opens}-${h.closes}`)
  }
  return out
}

/** As many windows as fit Square's limit, soonest first. */
export function fitWindows(windows: string[]): string[] {
  const kept: string[] = []
  for (const w of windows) {
    if ([...kept, w].join(',').length > SQUARE_WINDOW_LIMIT) break
    kept.push(w)
  }
  return kept
}

/** The part of the Square SDK client these calls use. */
export interface CafeCatalogClient {
  catalog: {
    object: {
      get(req: { objectId: string; includeRelatedObjects?: boolean }): Promise<any>
      upsert(req: { idempotencyKey: string; object: any }): Promise<any>
    }
  }
}

/** The café item as Square has it, or null when there is none (the sandbox). Throws on any other failure. */
export async function readCafeItem(client: CafeCatalogClient, itemId: string): Promise<any | null> {
  try {
    const res: any = await client.catalog.object.get({ objectId: itemId, includeRelatedObjects: false })
    return res?.object ?? res?.result?.object ?? null
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

export function isNotFound(err: unknown): boolean {
  const e = err as any
  if (e?.statusCode === 404 || e?.status === 404) return true
  return /not[ _]?found|404/i.test(err instanceof Error ? err.message : String(err))
}

/** Stores `windows` on the item (the script's write, unchanged). Returns what Square saved. */
export async function writeCafeWindows(
  client: CafeCatalogClient,
  item: any,
  windows: string[],
): Promise<{ name: string; count: number; version: unknown }> {
  const upsert: any = await client.catalog.object.upsert({
    idempotencyKey: `cafe-windows-${Date.now()}`,
    object: {
      ...item,
      itemData: { ...item.itemData, name: 'Craft Café' },
      customAttributeValues: {
        ...(item.customAttributeValues ?? {}),
        flow: { ...(item.customAttributeValues?.flow ?? {}), stringValue: 'display' },
        programDates: { ...(item.customAttributeValues?.programDates ?? {}), stringValue: windows.join(',') },
      },
    },
  })
  const saved = upsert?.catalogObject ?? upsert?.result?.catalogObject
  const after = saved?.customAttributeValues?.programDates?.stringValue ?? ''
  return { name: saved?.itemData?.name ?? '', count: after.split(',').filter(Boolean).length, version: saved?.version }
}

export type CafeSquareStatus = 'updated' | 'skipped' | 'failed'
export interface CafeSquareResult {
  status: CafeSquareStatus
  /** One line for the owner. */
  message: string
  /** updated: the last day written (Square's limit can stop short of 90 days). */
  coveredThrough?: string
}

/**
 * Writes the next 90 days of café windows from the owners' settings onto the
 * Square item. Only when the item exists: on the test site (no café item) it
 * is skipped and says so. Never throws: a failure comes back as 'failed' so
 * the settings stay saved and the owner can try again.
 */
export async function rewriteCafeWindows(
  days: StudioDays,
  today: string,
  deps: { client: CafeCatalogClient; itemId: string; sandbox: boolean; log?: (msg: string, meta: Record<string, unknown>) => void },
): Promise<CafeSquareResult> {
  try {
    const item = await readCafeItem(deps.client, deps.itemId)
    if (!item) {
      return deps.sandbox
        ? { status: 'skipped', message: 'Square café hours not updated on the test site.' }
        : { status: 'failed', message: 'Square has no Craft Café item to update.' }
    }
    const windows = fitWindows(cafeWindows(days, today, addDays(today, REWRITE_DAYS)))
    const saved = await writeCafeWindows(deps.client, item, windows)
    deps.log?.('Café windows rewritten', { windows: saved.count, version: String(saved.version ?? '') })
    return {
      status: 'updated',
      message: 'Square has the new café hours.',
      ...(windows.length ? { coveredThrough: windows[windows.length - 1].slice(0, 10) } : {}),
    }
  } catch (err) {
    deps.log?.('Café windows not rewritten', { error: err instanceof Error ? err.message : String(err) })
    return { status: 'failed', message: 'Square didn’t take the new café hours.' }
  }
}
