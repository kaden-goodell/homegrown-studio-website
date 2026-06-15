/**
 * Open Studio is a non-bookable Square catalog item (flow='display') whose
 * dated windows live in the `programDates` custom attribute as a
 * comma-separated list of `YYYY-MM-DDTHH:MM-HH:MM`, e.g.:
 *   2026-07-31T16:00-18:00,2026-08-01T09:00-18:00
 *
 * IMPORTANT: these are LOCAL wall-clock times. We deliberately do NOT parse
 * them through `new Date(...)` — that would interpret/serialize against the
 * runtime timezone and can shift the date by one day. Everything here is plain
 * string splitting.
 */

export interface OpenStudioWindow {
  /** YYYY-MM-DD */
  date: string
  /** HH:MM (24h, local wall-clock) */
  startTime: string
  /** HH:MM (24h, local wall-clock) */
  endTime: string
}

const TIME_RE = /^\d{1,2}:\d{2}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Parse the `programDates` custom-attribute string into discrete windows.
 * Malformed or empty entries are skipped defensively.
 */
export function parseOpenStudioWindows(programDates: string): OpenStudioWindow[] {
  if (!programDates || typeof programDates !== 'string') return []

  const windows: OpenStudioWindow[] = []

  for (const raw of programDates.split(',')) {
    const entry = raw.trim()
    if (!entry) continue

    // Split date from time-range on the first 'T'.
    const tIndex = entry.indexOf('T')
    if (tIndex === -1) continue

    const date = entry.slice(0, tIndex).trim()
    const timeRange = entry.slice(tIndex + 1).trim()
    if (!DATE_RE.test(date)) continue

    // Time range is "HH:MM-HH:MM". The '-' separates start/end.
    const dashIndex = timeRange.indexOf('-')
    if (dashIndex === -1) continue

    const startTime = timeRange.slice(0, dashIndex).trim()
    const endTime = timeRange.slice(dashIndex + 1).trim()
    if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) continue

    windows.push({ date, startTime, endTime })
  }

  return windows
}
