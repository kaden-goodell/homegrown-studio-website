import { studioDate } from '@lib/studio-time'

/**
 * Drop-off can't be switched off by the crew while the event is on (crew
 * review M10): from its first day through its last, kids leave only with a
 * pickup code. Owners can still change it. Shared by the settings sheet and
 * the server so they never disagree.
 */
export const DROP_OFF_LOCKED_MSG = 'Drop-off can’t be turned off during the event. Kids leave only with their pickup code. Ask Catherine or Kaden.'

export function dropOffLocked(event: { dropOff?: boolean; days: string[] }, now: Date = new Date()): boolean {
  if (!event.dropOff || event.days.length === 0) return false
  const today = studioDate(now.toISOString())
  const days = [...event.days].sort()
  return today >= days[0] && today <= days[days.length - 1]
}
