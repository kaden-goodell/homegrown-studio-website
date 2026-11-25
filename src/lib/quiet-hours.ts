/**
 * Night at the studio: 11 PM to 6 AM, America/Chicago. Nobody books then, so
 * the alarms keep quiet unless something is really broken (Kaden, Nov 2026).
 * Pure, so it is tested.
 */
export function studioNight(now: Date): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(now))
  return hour >= 23 || hour < 6
}
