/** A pretend /admin party server for the party sheets: routes by address, records every POST. */
import { vi } from 'vitest'
import { at } from '../sheets/harness'
import type { PartySettings } from '@lib/parties/types'

export const settings = (over: Partial<PartySettings> = {}): PartySettings => ({
  times: {
    weekly: { '0': ['13:00', '15:30'], '1': [], '2': [], '3': [], '4': [], '5': ['16:30'], '6': ['14:00', '16:30'] },
    dates: {}, bookingWindowDays: 90, minLeadDays: 7, opensDate: '2026-09-01',
  },
  packages: [{ id: 'pkg_whole', name: 'Whole studio', priceCents: 30000, minutes: 90, minGuests: 10, maxGuests: 30, defaultGuests: 10, quickPicks: [], who: 'everyone', archived: false }],
  addOns: [{ id: 'add_half', label: 'Extra half hour', priceCents: 5000, per: 'party', extraMinutes: 30, maxQty: 1, online: true, archived: false }],
  readSquareBookings: true, updatedAt: '2031-01-01T00:00:00Z', by: null, history: [], ...over,
})

export const CRAFTS = [{ id: 'craft_neck', name: 'Beaded Necklace', perHeadCents: 1800, perHeadMaxCents: 1800 }]

/** Sat Mar 15 2031 at 2 PM and 4:30 PM; the later one taken. */
export const DAY = '2031-03-15'
export const T1 = at(DAY, '14:00')
export const T2 = at(DAY, '16:30')

export const party = (over: any = {}) => ({
  bookingId: 'pty_0123456789abcdef', hostName: 'Stefanie Justice', hostEmail: 'stef@example.com', hostPhone: '(256) 555-0199', guestCount: 14,
  craftName: 'Beaded Necklace', title: null, startIso: T1, durationMinutes: 90, themeName: null, createdAt: '2031-03-01T00:00:00Z',
  status: 'booked', legacy: false, endIso: at(DAY, '15:30'), packageId: 'pkg_whole', craftId: 'craft_neck',
  items: [{ id: 'itm_pkg', kind: 'package', refId: 'pkg_whole', label: 'Whole studio', qty: 1, count: 1, unitCents: 30000, cents: 30000, extraMinutes: 0, chargeId: null, addedAt: '2031-03-01T00:00:00Z', by: null }],
  charges: [], refunds: [], dueCents: 30000, paymentState: 'waiting', linkSent: [], overlap: false, paymentGoingThrough: false, paymentInFlight: null,
  cancelled: null, sendDetails: { action: 'send-details', label: 'Email Stefanie the details' }, refundRequests: [], ...over,
})

export const paid = (over: any = {}) => party({
  items: [{ ...party().items[0], chargeId: 'chg_1' }],
  charges: [{ id: 'chg_1', via: 'admin-card', orderId: 'o1', paymentId: 'p1', cents: 30000, quotedCents: 30000, itemIds: ['itm_pkg'], receiptUrl: 'https://squareup.com/receipt/1', at: '2031-03-02T15:00:00Z', by: null }],
  dueCents: 0, paymentState: 'paid', ...over,
})

type Answer = { status?: number; body: unknown }
const reply = (a: Answer) => ({ ok: (a.status ?? 200) < 300, status: a.status ?? 200, json: async () => a.body })

/**
 * `answers[path]` = one answer, or a list used up in order (the last one sticks).
 * Unknown paths answer 404.
 */
export function partyServer(answers: Record<string, Answer | Answer[] | ((body: any, url: string) => Answer)>) {
  const queue: Record<string, Answer[]> = {}
  const f = vi.fn(async (url: string, init?: any) => {
    const path = String(url).split('?')[0]
    const body = init?.method === 'POST' ? JSON.parse(init.body) : null
    const a = answers[path]
    if (!a) return reply({ status: 404, body: { error: `no ${path}` } })
    if (typeof a === 'function') return reply(a(body, String(url)))
    if (!Array.isArray(a)) return reply(a)
    queue[path] ??= [...a]
    return reply(queue[path].length > 1 ? queue[path].shift()! : queue[path][0])
  })
  vi.stubGlobal('fetch', f)
  return f
}

