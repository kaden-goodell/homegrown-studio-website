/**
 * Shared utility functions.
 */

/** Format a price in cents to a dollar string (e.g., 4500 → "$45.00") */
export function formatCents(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(cents / 100)
}

/** Format an ISO date string to a human-readable date (e.g., "Mar 15, 2026") */
export function formatDate(isoDate: string): string {
  const date = new Date(isoDate + (isoDate.includes('T') ? '' : 'T00:00:00'))
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Format an ISO datetime string to a time string (e.g., "10:00 AM") */
export function formatTime(isoDatetime: string): string {
  return new Date(isoDatetime).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/** Format minutes to human-readable duration (e.g., 90 → "1h 30m") */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}
