/**
 * Slot templates and timezone math for crew open shifts.
 * Hours are Chicago-local 24h floats; Square wants UTC RFC-3339.
 */

export const SLOT_TEMPLATE: Record<number, Array<[number, number]>> = {
  4: [[16, 21]], // Thu 4–9p
  5: [[16, 21]], // Fri 4–9p
  6: [[9, 13], [13, 17], [17, 21]], // Sat 9a–9p in three blocks
  0: [[14, 17], [17, 20]], // Sun 2–8p in two blocks
}

const TZ = 'America/Chicago'

function chicagoOffsetMinutes(utcInstant: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
  const p = Object.fromEntries(dtf.formatToParts(utcInstant).map((x) => [x.type, x.value]))
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute)
  return (asUtc - utcInstant.getTime()) / 60000 // CDT: -300, CST: -360
}

export function chicagoToUtc(date: string, hour: number): Date {
  const [y, m, d] = date.split('-').map(Number)
  const naive = Date.UTC(y, m - 1, d, Math.floor(hour), Math.round((hour % 1) * 60))
  const offset = chicagoOffsetMinutes(new Date(naive))
  return new Date(naive - offset * 60000)
}

export function chicagoToday(): string {
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
  return dtf.format(new Date()) // en-CA gives YYYY-MM-DD
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return t.toISOString().slice(0, 10)
}

function dayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export function nextMonday(todayChicago: string): string {
  const dow = dayOfWeek(todayChicago)
  const delta = dow === 0 ? 1 : 8 - dow // always the NEXT Monday, never today
  return addDays(todayChicago, delta)
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function fmtHour(h: number): string {
  const whole = Math.floor(h), min = Math.round((h % 1) * 60)
  const ampm = whole >= 12 ? 'p' : 'a'
  const h12 = whole % 12 === 0 ? 12 : whole % 12
  return `${h12}:${String(min).padStart(2, '0')}${ampm}`
}

export function cutSlots(weekStartMonday: string): Array<{ startAt: string; endAt: string; label: string }> {
  const out: Array<{ startAt: string; endAt: string; label: string }> = []
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStartMonday, i)
    const dow = dayOfWeek(date)
    for (const [startH, endH] of SLOT_TEMPLATE[dow] ?? []) {
      out.push({
        startAt: chicagoToUtc(date, startH).toISOString(),
        endAt: chicagoToUtc(date, endH).toISOString(),
        label: `${DAY_NAMES[dow]} ${fmtHour(startH)}–${fmtHour(endH)}`,
      })
    }
  }
  return out
}
