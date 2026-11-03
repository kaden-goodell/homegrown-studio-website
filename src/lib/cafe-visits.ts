/**
 * Craft Café visits for the owners (/admin › Reports, the Calendar and Home):
 * read from the walk-in check-ins the crew make on /staff, one document per
 * day (open-studio-store), so a month is at most 31 bounded reads and a day
 * still to come is never read.
 */
import { dayTotals, entryCounts, getOpenStudioDay, type CafeTotals } from '@lib/open-studio-store'
import { addDays } from '@lib/kit-dates'
import { cafeOn } from '@lib/cafe-days'
import { getStudioDays } from '@lib/studio-settings'
import type { StudioDays } from '@config/studio-days'

export interface CafeVisitDay extends CafeTotals {
  date: string
}

export interface CafeMonth {
  month: string
  /** Days with at least one check-in, earliest first. */
  days: CafeVisitDay[]
  totals: CafeTotals
}

const zero = (): CafeTotals => ({ households: 0, people: 0, adults: 0, kids: 0 })

/**
 * One month ("2026-11") of Craft Café visits, days after `today` left out.
 * Only days Craft Café runs (the owners' hours, special days and closed
 * days), the same days the Calendar shows "N at Craft Café" on, so the two
 * always agree. /staff only checks walk-ins in on those days.
 */
export async function cafeMonth(month: string, today: string, studioDays?: StudioDays): Promise<CafeMonth> {
  const days0 = studioDays ?? (await getStudioDays())
  const dates: string[] = []
  for (let d = `${month}-01`; d.startsWith(month) && d <= today; d = addDays(d, 1)) if (cafeOn(d, days0)) dates.push(d)
  const read = await Promise.all(dates.map(async (date) => ({ date, ...dayTotals(await getOpenStudioDay(date)) })))
  const days = read.filter((d) => d.households > 0)
  const totals = days.reduce((t, d) => ({ households: t.households + d.households, people: t.people + d.people, adults: t.adults + d.adults, kids: t.kids + d.kids }), zero())
  return { month, days, totals }
}

/** One day's visits: each family (name, who came, when, who checked them in), newest first. */
export async function cafeDayVisits(date: string) {
  const day = await getOpenStudioDay(date)
  const entries = Object.values(day)
    .map((e) => {
      const { adults, kids } = entryCounts(e)
      return { name: e.name ?? 'A family', people: e.people ?? [], at: e.at, by: e.by?.name ?? '', adults, kids }
    })
    .sort((a, b) => b.at.localeCompare(a.at))
  return { date, totals: dayTotals(day), entries }
}
