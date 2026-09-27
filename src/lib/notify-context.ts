/**
 * What a visitor was looking at when they hit a "not yet" panel.
 *
 * Calendar rows and shared links carry the choice in the address
 * (?date=, ?start=, ?craft=, ?w=). While booking is closed we can't act on it,
 * but we can say it back ("You were looking at Saturday, October 24") and pass
 * it along with their email so the follow-up is specific.
 *
 * `interest` is what gets stored and sent to the owners (max 80 characters,
 * enforced by the endpoint). `lookingAt` is the phrase shown on the page;
 * empty when there is nothing worth saying back.
 */
export interface NotifyContext {
  lookingAt: string
  interest: string
}

const DAY: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' }
const SHORT_DAY: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }

/** "Friday, October 16" for a studio-local YYYY-MM-DD. */
export function longDate(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { ...DAY, timeZone: 'UTC' })
}

export function partyNotifyContext(params: URLSearchParams, timeZone: string): NotifyContext {
  const date = params.get('date') ?? ''
  const start = params.get('start') ?? ''
  const craft = params.get('craft') ?? ''

  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T12:00:00Z`))) {
    return { lookingAt: longDate(date), interest: `party-date:${date}` }
  }

  if (start && !Number.isNaN(Date.parse(start))) {
    const at = new Date(start)
    const day = at.toLocaleDateString('en-US', { ...DAY, timeZone })
    const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone })
    return { lookingAt: `${day} at ${time}`, interest: `party-time:${at.toISOString().slice(0, 16)}Z` }
  }

  // A craft id is an opaque catalog id: worth passing on, nothing to say back.
  if (/^[A-Za-z0-9_-]{6,40}$/.test(craft)) {
    return { lookingAt: '', interest: `party-craft:${craft}` }
  }

  return { lookingAt: '', interest: 'party:booking-opens' }
}

export function workshopNotifyContext(
  workshop: { name: string; startAt: string } | null | undefined,
  timeZone: string,
): NotifyContext {
  if (!workshop?.name || Number.isNaN(Date.parse(workshop.startAt))) {
    return { lookingAt: '', interest: 'workshops:booking-opens' }
  }
  const at = new Date(workshop.startAt)
  const day = at.toLocaleDateString('en-US', { ...SHORT_DAY, timeZone })
  const ymd = at.toLocaleDateString('en-CA', { timeZone })
  return {
    lookingAt: `${workshop.name}, ${day}`,
    // Name first, cut to fit: the date is what makes the follow-up specific.
    interest: `workshop:${workshop.name.slice(0, 58)} ${ymd}`,
  }
}
