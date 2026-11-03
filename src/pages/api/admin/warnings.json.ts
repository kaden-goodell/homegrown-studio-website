import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { json } from '@lib/classes/admin-actions'
import { listWarnings, OWNER_ONLY_CODES, warningLine, WARNING_WINDOW_DAYS, type Warning, type WarningCode } from '@lib/warnings'
import { addDays } from '@lib/kit-dates'
import { studioDate } from '@lib/studio-time'
import { createLogger } from '@lib/logger'
import { systemWarnings } from '@lib/system-checks'

export const prerender = false

const logger = createLogger('api:admin:warnings')

/**
 * Codes Home leaves out of its Warnings list because Home already shows them
 * another way: the To decide items (counted in "Needs you", each settled in
 * Inbox › To decide) and the staffing lines (Home › Staffing).
 */
/** The owner-only background-job lines (./system-checks): owners read this list, so they DO show here. */
const SYSTEM_CODES: ReadonlySet<WarningCode> = new Set<WarningCode>(['archive-stale', 'webhook-url-mismatch'])

export const HOME_SKIP_CODES: ReadonlySet<WarningCode> = new Set<WarningCode>([
  'refund-flag', 'pos-unmatched', 'pos-needs-days', 'below-minimum', 'door-unpaid', 'counter-match-check', 'paid-not-seated',
  'waitlist-unknown', 'waitlist-declined', 'waitlist-refund', 'reader-waiting', 'cancel-request', 'cancel-unclear',
  ...[...OWNER_ONLY_CODES].filter((c) => !SYSTEM_CODES.has(c)),
])

/** What each line's button opens on /admin (the same shapes as the /admin router's sheets). */
export type WarningOpen =
  | { kind: 'class'; id: string }
  | { kind: 'party'; day: string; id: string }
  | { kind: 'day'; day: string }
  | { kind: 'more'; page: 'register' | 'promos' | 'closed' | 'records' }
  | { kind: 'promo'; id: string }
  | { kind: 'todo-list' }
  | { kind: 'retry' }

export interface HomeWarning { code: WarningCode; line: string; open: WarningOpen | null; button: string | null }

/** The button for one warning: its fix screen, or Open for the class or party it's about. */
export function openFor(w: Warning): { open: WarningOpen | null; button: string | null } {
  const day = w.when ? studioDate(w.when) : ''
  switch (w.code) {
    case 'register-setup-missing': return { open: { kind: 'more', page: 'register' }, button: 'Open Register setup' }
    case 'promo-free-unlimited': {
      const code = (w.itemId ?? '').replace(/^promo-free-/, '')
      return code ? { open: { kind: 'promo', id: code }, button: 'Open the code' } : { open: { kind: 'more', page: 'promos' }, button: 'Open Promotions' }
    }
    case 'classes-unreadable': case 'parties-unreadable': return { open: { kind: 'retry' }, button: 'Try again' }
    // Help: More › Records › Everything › Download records.
    case 'archive-stale': return { open: { kind: 'more', page: 'records' }, button: 'Open Records' }
    // A hosting setting only: the line says what to change (Help has the steps).
    case 'webhook-url-mismatch': return { open: null, button: null }
    default: break
  }
  if (w.eventKind === 'party') {
    if (w.eventId && day) return { open: { kind: 'party', day, id: w.eventId }, button: 'Open the party' }
    return { open: { kind: 'todo-list' }, button: 'Open To decide' }
  }
  if (w.eventId.startsWith('cls_')) return { open: { kind: 'class', id: w.eventId }, button: 'Open the class' }
  // A class that still runs in Square: its day on the Calendar.
  if (day) return { open: { kind: 'day', day }, button: 'Open the day' }
  return { open: null, button: null }
}

/**
 * Owners only: Home › Warnings. The same scan as /staff › Warnings and the
 * morning email (today and the next 59 days), less what Home shows another
 * way (HOME_SKIP_CODES), plus the owner-only system lines. Read-only. A scan that can't run is a 503, so Home
 * says it couldn't check instead of looking all clear.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!(await adminAuthorized(request))) return json(401, { error: 'Sign in first.' })
  const from = studioDate(new Date().toISOString())
  const to = addDays(from, WARNING_WINDOW_DAYS - 1)
  try {
    // The staffing scan stays off (Home › Staffing has it); the owner-only system lines (the weekly records
    // backup, Square's notice address) come along, as Help says they show here (merge of the final fixes).
    const [warnings, system] = await Promise.all([listWarnings({ from, to }, { staffing: false }), systemWarnings()])
    warnings.push(...system)
    const shown: HomeWarning[] = warnings
      .filter((w) => !HOME_SKIP_CODES.has(w.code))
      .map((w) => ({ code: w.code, line: warningLine(w), ...openFor(w) }))
    return json(200, { data: { warnings: shown } })
  } catch (err) {
    logger.error('Warnings scan failed', { error: err instanceof Error ? err.message : String(err) })
    return json(503, { error: 'Couldn’t check the schedule for warnings. Try again.' })
  }
}
