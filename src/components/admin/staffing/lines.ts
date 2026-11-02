/**
 * A staffing line as /admin shows it: the day, what's wrong, and what to do,
 * without "in /admin › More › Staff" (the button is right there). Client-safe.
 */
import { localDate } from '@lib/party-slots'
import { dayLabel } from '../classes/dates'
import type { StaffLine } from './api'

export function warningLineText(w: Pick<StaffLine, 'code' | 'when' | 'detail' | 'action'>): string {
  const day = w.when ? `${dayLabel(localDate(w.when))} · ` : ''
  const action = w.code === 'unstaffed' ? '' : ` ${w.action.replace(/ in \/admin(?: › More › Staff)?\./, '.')}`
  return `${day}${w.detail}${action}`
}
