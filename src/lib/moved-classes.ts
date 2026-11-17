/**
 * Square classes whose remaining seats moved to our own booking system
 * (event-meta `movedTo`, Kaden 17 Nov 2026: "make sure there are not
 * duplicates on the site/calendar"). The Square class keeps its people and
 * stays on every staff and owner screen; everything PUBLIC hides it, and its
 * booking routes point to the new class instead.
 *
 * A setting that can't be read keeps the class showing (a duplicate for a
 * moment is better than a class vanishing). Booking routes read event-meta
 * themselves and fail closed.
 *
 * Server only.
 */
import { getEventMeta } from '@lib/event-meta'
import { remember } from '@lib/short-memory'
import { siteConfig } from '@config/site.config'
import { createLogger } from '@lib/logger'

const logger = createLogger('moved-classes')

/** The new-system class id a Square class moved to, or null. Remembered briefly; never throws. */
export async function movedToFor(scheduleId: string): Promise<string | null> {
  if (!scheduleId) return null
  try {
    return await remember(`moved:${scheduleId}`, 30_000, async () => (await getEventMeta('workshop', scheduleId))?.movedTo ?? null)
  } catch (err) {
    logger.warn('Moved-to setting unreadable: the class stays listed', { scheduleId, error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

/** The list without moved Square classes. `scheduleOf` reads each item's Square class schedule id. */
export async function withoutMoved<T>(list: T[], scheduleOf: (item: T) => string): Promise<T[]> {
  const moved = await Promise.all(list.map((item) => movedToFor(scheduleOf(item))))
  return list.filter((_, i) => !moved[i])
}

/** Where the new class lives. */
export function movedClassUrl(classId: string): string {
  return `/classes/${classId}`
}

/** What a customer reads when they reach the old Square class. */
export function movedMessage(classId: string): string {
  return `This class moved to our new booking page. Book it here: ${siteConfig.url}${movedClassUrl(classId)}. Nothing was charged.`
}
