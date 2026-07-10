/** Timecard → hours → gift-card credit math. Pure; no SDK imports. */

type BreakLike = { startAt: string; endAt?: string }
type TimecardLike = { startAt: string; endAt?: string; breaks?: BreakLike[] }

export function timecardHours(tc: TimecardLike): number {
  if (!tc.endAt) return 0
  let ms = Date.parse(tc.endAt) - Date.parse(tc.startAt)
  for (const b of tc.breaks ?? []) {
    if (b.endAt) ms -= Date.parse(b.endAt) - Date.parse(b.startAt)
  }
  return ms / 3_600_000
}

export function computeCreditCents(hours: number, rateDollarsPerHour: number): bigint {
  return BigInt(Math.round(hours * rateDollarsPerHour * 100))
}

export function ledgerKey(teamMemberId: string, from: string, to: string): string {
  return `${teamMemberId}|${from}|${to}`
}
