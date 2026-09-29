/**
 * The "posted" drop-off terms — agreement §4b refers to the grace period and
 * late fee "posted for that program at registration"; this is where they're
 * posted. Shown wherever a drop-off registration is confirmed.
 */
export const dropOffConfig = {
  graceMinutes: 15,
  lateFeePerMinuteCents: 100,
  capacity: 12,
} as const

export function lateFeeLine(): string {
  const cents = dropOffConfig.lateFeePerMinuteCents
  const dollars = cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`
  return `Late pickup: ${dollars} per minute after a ${dropOffConfig.graceMinutes}-minute grace.`
}
