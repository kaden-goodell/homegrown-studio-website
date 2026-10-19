/**
 * Browser side of /api/cafe-hours.json: the prerendered /craft-cafe and home
 * pages ship the config's walk-in hours, then swap in the hours the owners
 * set on /admin. A failed request leaves the page as it was.
 * Client-safe: DOM only.
 */
export interface CafeHoursPayload {
  weekly: { days: string; time: string }[]
  special: { date: string; name: string; time: string }[]
}

/** "Saturday, Nov 7" for a studio YYYY-MM-DD. */
export function specialDayLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function hoursCell(top: string, bottom: string): HTMLElement {
  const cell = document.createElement('div')
  const a = document.createElement('span')
  a.className = 'block text-sm font-semibold'
  a.style.color = 'var(--color-dark)'
  a.textContent = top
  const b = document.createElement('span')
  b.className = 'block text-sm'
  b.style.color = 'var(--color-muted)'
  b.textContent = bottom
  cell.append(a, b)
  return cell
}

/** Puts the weekly hours (and, where the page has room for them, the coming special days) into the page. */
export function applyCafeHours(doc: Document, data: CafeHoursPayload): void {
  if (!Array.isArray(data?.weekly)) return
  const special = Array.isArray(data.special) ? data.special : []
  for (const box of doc.querySelectorAll<HTMLElement>('[data-cafe-hours]')) {
    // No weekly café: never leave the hours the page was built with.
    box.replaceChildren(...(data.weekly.length
      ? data.weekly.map((h) => hoursCell(h.days, h.time))
      : [hoursCell('Craft Café is by special day only', special.length
        ? special.map((d) => `${specialDayLabel(d.date)}, ${d.time}`).join(' · ')
        : 'See the calendar for the next café day')]))
  }
  for (const box of doc.querySelectorAll<HTMLElement>('[data-cafe-special]')) {
    const list = Array.isArray(data.special) ? data.special : []
    box.replaceChildren(...list.map((d) => hoursCell(`${specialDayLabel(d.date)} · ${d.name}`, d.time)))
    box.hidden = list.length === 0
  }
}

export async function loadCafeHours(doc: Document = document): Promise<void> {
  try {
    const res = await fetch('/api/cafe-hours.json')
    if (!res.ok) return
    const json = await res.json()
    if (json?.data) applyCafeHours(doc, json.data as CafeHoursPayload)
  } catch {
    // The page keeps the hours it was built with.
  }
}
