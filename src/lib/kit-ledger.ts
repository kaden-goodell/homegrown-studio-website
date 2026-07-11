/**
 * Weekly settings ledger — pure availability math for themed tableware.
 *
 * We never decrement a counter. Availability for a (ledger theme, week) is
 * recomputed on demand from two sources:
 *   1. the theme-week's **claims blob** — confirmed reservations plus pending
 *      ones younger than 15 minutes (a crash mid-order leaves a pending claim
 *      that simply ages out, so readers self-heal);
 *   2. **overdue kit orders** — pieces still checked out ('out') past their
 *      return-by keep blocking forward weeks until someone checks them in.
 *
 * Owned capacity (settings + hero sets) comes from kit-content. Kits and the
 * in-studio party add-on write to the SAME claims blobs, so the two products
 * share one physical pool by construction (LR-1/LR-3).
 *
 * Purity: no function here reads the clock. Callers pass `now` (epoch ms, for
 * the 15-minute pending window) and `today` (studio-local YYYY-MM-DD).
 */
import { kitConfig } from '@config/kit.config'
import { kitThemes } from '@config/kit-content'
import { weekKeyFor, addDays } from '@lib/kit-dates'

/** Pending claims older than this are ignored by readers (crash-safe TTL). */
export const CLAIM_TTL_MS = 15 * 60 * 1000

/**
 * One reservation on a theme-week's claims blob. `serves` is the tier size;
 * every claim also occupies one hero set (one styled table). Pending claims
 * are provisional (mid-checkout); confirmed claims are paid.
 */
export interface WeekClaim {
  ref: string
  kind: 'kit' | 'party'
  serves: number
  status: 'pending' | 'confirmed'
  at: string // ISO — when the claim was placed
}

/**
 * A committed order as the ledger sees it. `themeId` is the LEDGER theme
 * (styling variants already collapsed to their `ledgerThemeId`), so shared
 * tableware pools correctly.
 */
export interface LedgerRecord {
  id: string
  kind: 'kit' | 'party'
  themeId: string
  serves: number
  weekKey: string
  status: 'upcoming' | 'out' | 'returned' | 'cancelled' | 'forfeited'
  returnBy: string // kits only ('' for party add-ons)
}

export interface ThemeWeekAvailability {
  themeId: string
  weekKey: string
  settingsLeft: number
  heroSetsLeft: number
  offeredTiers: number[]
}

function ownedFor(themeId: string): { ownedSettings: number; heroSets: number } {
  const theme = kitThemes.find((t) => t.id === themeId)
  return { ownedSettings: theme?.ownedSettings ?? 0, heroSets: theme?.heroSets ?? 0 }
}

/** A claim consumes capacity if it's confirmed, or pending and still fresh. */
function claimActive(c: WeekClaim, now: number): boolean {
  return c.status === 'confirmed' || now - Date.parse(c.at) < CLAIM_TTL_MS
}

/**
 * Does an overdue kit order block the target `weekKey`? It must be a kit still
 * 'out' past its return-by, from a week strictly before the target, and the
 * target must be no later than one week past today's week (overdue pieces block
 * forward only through the near horizon — not indefinitely into the future).
 */
function overdueBlocks(o: LedgerRecord, weekKey: string, today: string): boolean {
  if (o.kind !== 'kit' || o.status !== 'out' || !(o.returnBy < today)) return false
  const horizon = addDays(weekKeyFor(today), 7) // weekKeyFor(today) + 1 week
  return o.weekKey < weekKey && weekKey <= horizon
}

/**
 * Remaining capacity and offerable tiers for one theme-week. `claims` are that
 * theme-week's claims blob; `overdueOrders` is the (usually small) set of kit
 * orders currently checked out. A tier is offered only when its settings fit
 * AND at least one hero set remains.
 */
export function availabilityFor(
  themeId: string,
  weekKey: string,
  claims: WeekClaim[],
  overdueOrders: LedgerRecord[],
  today: string,
  now: number,
): ThemeWeekAvailability {
  const { ownedSettings, heroSets } = ownedFor(themeId)

  const active = claims.filter((c) => claimActive(c, now))
  const blocking = overdueOrders.filter((o) => o.themeId === themeId && overdueBlocks(o, weekKey, today))

  const consumedSettings = sum(active.map((c) => c.serves)) + sum(blocking.map((o) => o.serves))
  const consumedHero = active.length + blocking.length

  const settingsLeft = ownedSettings - consumedSettings
  const heroSetsLeft = heroSets - consumedHero
  const offeredTiers = kitConfig.tiers
    .filter((t) => t.serves <= settingsLeft && heroSetsLeft >= 1)
    .map((t) => t.serves)

  return { themeId, weekKey, settingsLeft, heroSetsLeft, offeredTiers }
}

/**
 * Radar for staff: weeks (today or later) where active commitments on a ledger
 * theme sum past the settings we own. Cancelled/returned/forfeited records
 * don't count; kit and party commitments pool on the shared ledger theme.
 */
export function overCommittedWeeks(
  records: LedgerRecord[],
  today: string,
): { themeId: string; weekKey: string; committed: number; owned: number }[] {
  const floor = weekKeyFor(today)
  const active = records.filter((r) => (r.status === 'upcoming' || r.status === 'out') && r.weekKey >= floor)

  const committed = new Map<string, number>() // `${themeId}__${weekKey}` -> Σ serves
  for (const r of active) {
    const k = `${r.themeId}__${r.weekKey}`
    committed.set(k, (committed.get(k) ?? 0) + r.serves)
  }

  const out: { themeId: string; weekKey: string; committed: number; owned: number }[] = []
  for (const [k, total] of committed) {
    const [themeId, weekKey] = k.split('__')
    const owned = ownedFor(themeId).ownedSettings
    if (total > owned) out.push({ themeId, weekKey, committed: total, owned })
  }
  return out.sort((a, b) => a.weekKey.localeCompare(b.weekKey) || a.themeId.localeCompare(b.themeId))
}

function sum(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0)
}
