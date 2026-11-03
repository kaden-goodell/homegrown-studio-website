/**
 * "Not ready to book? Email me this class." for one of our own classes: the
 * class as the email tells it (src/lib/class-link-email.ts), or undefined
 * when it can't be seen or booked any more (draft, cancelled, every date
 * started, or partway through a class that doesn't take people partway).
 * Link-only classes work: the visitor is on the class's own page, and the
 * email links back to that page.
 */
import type { ClassForEmail } from '@lib/class-link-email'
import { ownPriceLabel, sessionsLine } from './public-class'
import { viewableByLink } from './public-view'
import type { ScheduledClass } from './types'

export function ownClassForEmail(cls: ScheduledClass | null, now: Date): ClassForEmail | undefined {
  if (!cls || !viewableByLink(cls)) return undefined
  const sessions = [...cls.sessions].sort((a, b) => a.startIso.localeCompare(b.startIso))
  const upcoming = sessions.filter((x) => Date.parse(x.startIso) > now.getTime())
  if (!upcoming.length) return undefined
  if (upcoming.length < sessions.length && !cls.content.rules.joinPartway) return undefined
  const next = upcoming[0]
  const c = cls.content
  return {
    id: cls.id,
    name: c.name,
    description: c.description,
    startAt: next.startIso,
    durationMinutes: Math.max(1, Math.round((Date.parse(next.endIso) - Date.parse(next.startIso)) / 60_000)),
    priceCents: 0,
    ...(c.imageUrl ? { imageUrl: c.imageUrl } : {}),
    path: `/classes/${cls.id}`,
    priceLabel: ownPriceLabel(c),
    ...(upcoming.length > 1 ? { sessionsLabel: sessionsLine({ sessions: upcoming }) } : {}),
  }
}
