// Sample public-calendar weeks for the window schedule (tests and the PNG renders).
import type { CalendarEvent } from '@components/calendar/calendar-view-model'

const e = (date: string, kind: CalendarEvent['kind'], title: string, startTime?: string, endTime?: string, extra: Partial<CalendarEvent> = {}): CalendarEvent =>
  ({ id: `${kind}-${date}-${startTime ?? ''}-${title}`, kind, title, date, ...(startTime ? { startTime } : {}), ...(endTime ? { endTime } : {}), ...extra }) as CalendarEvent

/** Thanksgiving week, Nov 23–29 2026. */
export const THANKSGIVING_WEEK: CalendarEvent[] = [
  e('2026-11-23', 'open-studio', 'Craft Café', '09:00', '14:00'),
  e('2026-11-24', 'open-studio', 'Craft Café', '09:00', '14:00'),
  e('2026-11-25', 'open-studio', 'Craft Café', '09:00', '14:00'),
  e('2026-11-26', 'event', 'Closed for Thanksgiving', undefined, undefined, { detail: 'We reopen Saturday, November 28.' }),
  e('2026-11-27', 'event', 'Closed for Thanksgiving', undefined, undefined, { detail: 'We reopen Saturday, November 28.' }),
  e('2026-11-28', 'open-studio', 'Craft Café', '09:00', '13:00'),
  e('2026-11-28', 'party-booked', 'Booked · private party', '13:30', '15:30'),
  e('2026-11-28', 'open-studio', 'Craft Café', '16:00', '20:00'),
  e('2026-11-29', 'workshop', 'Christmas Embroidery Wreath Sash', '18:00', '20:00', { price: 4500, remainingSeats: 20 }),
  e('2026-11-29', 'party-available', 'Party', '13:00', '15:00', { openCount: 2 }),
]

/** A busy December week, Dec 7–13 2026. */
export const BUSY_WEEK: CalendarEvent[] = [
  e('2026-12-07', 'open-studio', 'Craft Café', '09:00', '14:00'),
  e('2026-12-07', 'workshop', 'Ornament Painting Night', '18:00', '20:00'),
  e('2026-12-08', 'open-studio', 'Craft Café', '09:00', '14:00'),
  e('2026-12-08', 'party-booked', 'Booked · private party', '18:00', '20:00'),
  e('2026-12-09', 'open-studio', 'Craft Café', '09:00', '14:00'),
  e('2026-12-09', 'workshop', 'Kids Gingerbread Felt Garland (drop-off)', '16:00', '18:00'),
  e('2026-12-10', 'workshop', 'Machine Embroidery: Monogram Stockings', '18:00', '20:00'),
  e('2026-12-10', 'workshop', 'Tallow Balm & Gift Tins', '18:30', '20:30'),
  e('2026-12-11', 'party-booked', 'Booked · private party', '16:30', '18:30'),
  e('2026-12-11', 'workshop', 'Wreath Making with Fresh Greenery', '19:00', '21:00'),
  e('2026-12-12', 'open-studio', 'Craft Café', '09:00', '13:00'),
  e('2026-12-12', 'event', 'Private Event', '10:00', '12:00'),
  e('2026-12-12', 'party-booked', 'Booked · private party', '14:00', '16:00'),
  e('2026-12-12', 'party-booked', 'Booked · private party', '16:30', '18:30'),
  e('2026-12-12', 'workshop', 'Holiday Movie Stitch-Along', '19:00', '21:00'),
  e('2026-12-13', 'party-booked', 'Booked · private party', '13:00', '15:00'),
  e('2026-12-13', 'party-booked', 'Booked · private party', '15:30', '17:30'),
  e('2026-12-13', 'workshop', 'Embroidery 101', '18:00', '20:00'),
  e('2026-12-13', 'party-available', 'Party', '11:00', '13:00'),
]
