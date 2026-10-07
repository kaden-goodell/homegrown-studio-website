import type { SeatBooking, SeatReservation, Workshop, WorkshopProvider } from '../interfaces/workshop'
import type { SquareConfig } from '../../config/site.config'
import { createSquareClient } from './client'
import { createLogger } from '../../lib/logger'
import { SeatBookingError } from '../../lib/errors'

const logger = createLogger('square-workshop')
const CLASSES_API_BASE = 'https://app.squareup.com/appointments/api/buyer/classes'

// How far back `fetchAll()` looks for class schedule instances. Must cover
// both "the class started earlier today" (so staff can still check kids OUT
// of an in-progress Parents' Night Out — HOM checkin) and a multi-day camp
// we're on day 2-5 of. Square returns at most 50 instances per page and the
// studio runs a handful of classes a week, so a 7-day lookback is cheap.
const LOOKBACK_HOURS = 24 * 7
const HOUR_MS = 60 * 60 * 1000

function formatDateWithOffset(date: Date): string {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')
  const minutes = String(Math.abs(offset) % 60).padStart(2, '0')
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}${sign}${hours}:${minutes}`
}

/** Square's customer-facing classes service only answers requests that look like its own booking page. */
const BUYER_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'Origin': 'https://book.squareup.com',
  'Referer': 'https://book.squareup.com/',
}

export class SquareWorkshopProvider implements WorkshopProvider {
  constructor(private config: SquareConfig) {}

  private classesUrl(path: string): string {
    return `${CLASSES_API_BASE}${path}?unit_token=${this.config.locationId}`
  }

  async reserveSeats(params: {
    scheduleId: string
    startAt: string
    seats: number
    customer: { givenName: string; familyName: string; email: string }
    note?: string
  }): Promise<SeatReservation> {
    try {
      return await this.holdSeats(params, params.note)
    } catch (err) {
      // A refused hold holds nothing, so asking again is safe. If the note was
      // what Square refused, the picks are still stored on our side and in the
      // confirmation email. No answer and 5xx are never retried: seats may be held.
      if (
        params.note &&
        err instanceof SeatBookingError &&
        err.kind === 'refused' &&
        err.status !== undefined &&
        err.status >= 400 &&
        err.status < 500
      ) {
        logger.warn('Seat hold refused with a booking note — asking once more without it', { status: err.status })
        return this.holdSeats(params, undefined)
      }
      throw err
    }
  }

  private async holdSeats(
    params: { scheduleId: string; startAt: string; seats: number; customer: { givenName: string; familyName: string; email: string } },
    note: string | undefined,
  ): Promise<SeatReservation> {
    let res: Response
    try {
      res = await fetch(this.classesUrl('/class_bookings'), {
        method: 'POST',
        headers: BUYER_HEADERS,
        body: JSON.stringify({
          class_schedule_id: params.scheduleId,
          start_at: params.startAt,
          customer: {
            given_name: params.customer.givenName,
            family_name: params.customer.familyName,
            email_address: params.customer.email,
          },
          quantity: params.seats,
          ...(note ? { customer_note: note } : {}),
        }),
      })
    } catch (err) {
      throw new SeatBookingError('square', 'reserve', 'no_answer', err instanceof Error ? err.message : String(err))
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      logger.error('Seat reservation refused', { status: res.status, error: text, withNote: !!note })
      throw new SeatBookingError('square', 'reserve', 'refused', text, res.status)
    }
    const booking = (await res.json()).class_booking
    logger.info('Seats reserved', { bookingId: booking.id, orderId: booking.order_id, withNote: !!note })
    return {
      bookingId: booking.id,
      // /complete expects this contact token as its customer_id, NOT the
      // Customers API id (see the square-class-bookings notes).
      contactToken: booking.customer?.contact_token ?? booking.contact_token ?? null,
      orderId: booking.order_id ?? null,
    }
  }

  async payForSeats(params: {
    reservation: SeatReservation
    scheduleId: string
    paymentToken: string
    verificationToken?: string
    idempotencyKey: string
    fallbackCustomerId?: string
  }): Promise<SeatBooking> {
    const { reservation } = params
    let res: Response
    try {
      res = await fetch(this.classesUrl(`/class_bookings/${reservation.bookingId}/complete`), {
        method: 'POST',
        headers: BUYER_HEADERS,
        body: JSON.stringify({
          class_booking: {
            id: reservation.bookingId,
            class_schedule_id: params.scheduleId,
            customer_id: reservation.contactToken || params.fallbackCustomerId,
          },
          payment_source_id: params.paymentToken,
          idempotency_key: params.idempotencyKey,
          ...(params.verificationToken ? { verification_token: params.verificationToken } : {}),
        }),
      })
    } catch (err) {
      // The request left and nothing came back: the charge may have happened.
      throw new SeatBookingError('square', 'pay', 'no_answer', err instanceof Error ? err.message : String(err))
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      logger.error('Seat payment not completed', { bookingId: reservation.bookingId, status: res.status, error: text })
      // A 4xx is Square saying no. A 5xx is Square failing, mid-charge for all we know.
      // One 4xx is not a plain "no": a reused idempotency key means an earlier
      // request used it, and says nothing about whether that one charged.
      const keySeenBefore = /idempoten/i.test(text)
      const kind =
        !keySeenBefore && res.status >= 400 && res.status < 500 && res.status !== 408 ? 'refused' : 'no_answer'
      throw new SeatBookingError('square', 'pay', kind, text, res.status)
    }
    const done = (await res.json()).class_booking
    logger.info('Seats paid and confirmed', { bookingId: done.id, status: done.status, orderId: done.order_id })
    return {
      bookingId: done.id,
      orderId: done.order_id ?? null,
      status: done.status,
      receiptUrl: done.order?.receipt_url ?? null,
    }
  }

  async releaseSeats(bookingId: string): Promise<void> {
    const res = await fetch(this.classesUrl(`/class_bookings/${bookingId}/cancel`), {
      method: 'POST',
      headers: BUYER_HEADERS,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Seat release refused: ${res.status} ${text.slice(0, 200)}`)
    }
    logger.info('Seats released', { bookingId })
  }

  /**
   * Every upcoming workshop, soonest first. A workshop with no seats left
   * stays in the list (pages show it as "Sold out") until its start time
   * passes; then it goes, like any other.
   */
  async listWorkshops(): Promise<Workshop[]> {
    if (!this.config.locationId) {
      return []
    }
    const all = await this.listAllWorkshops()
    const now = Date.now()
    // Public listing stays future-only: `listAllWorkshops` also returns
    // classes that already started (so staff can resolve/list them — see
    // LOOKBACK_HOURS below), which must not leak onto the public /workshops
    // page. Sold out is NOT a reason to drop one — the card says so instead.
    return all
      .filter((w) => new Date(w.startAt).getTime() > now)
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
  }

  /**
   * By classScheduleId OR classScheduleInstanceId, over the UNFILTERED list —
   * a sold-out class still has a roster to run (HOM staff surfaces pass the
   * schedule id). An exact instance id wins; a schedule id that covers several
   * dated occurrences resolves to the earliest one, which is the same
   * occurrence `listWorkshops` would surface.
   */
  async getWorkshop(id: string): Promise<Workshop | null> {
    if (!this.config.locationId) return null
    const all = await this.listAllWorkshops()
    const instance = all.find((w) => w.id === id)
    if (instance) return instance
    return (
      all
        .filter((w) => w.scheduleId === id)
        .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())[0] ?? null
    )
  }

  /** Every active class in the lookback/forward window — no capacity or
   *  future-only filter. Backs `getWorkshop`, `listWorkshops`, and staff
   *  surfaces (`@lib/events`) that need to list, not just resolve, an
   *  in-progress or multi-day class. */
  async listAllWorkshops(): Promise<Workshop[]> {
    if (!this.config.locationId) return []
    return this.fetchAll()
  }

  private async fetchAll(): Promise<Workshop[]> {
    const locationId = this.config.locationId
    const now = new Date()
    const startDate = new Date(now.getTime() - LOOKBACK_HOURS * HOUR_MS)
    const endDate = new Date()
    endDate.setFullYear(endDate.getFullYear() + 1)

    const requestBody = {
      cursor: null,
      sort: { field: 'START_AT' },
      query: {
        filter: {
          location_id: locationId,
          starting_at: {
            start_at: formatDateWithOffset(startDate),
            end_at: formatDateWithOffset(endDate),
          },
          status: 'CLASS_SCHEDULE_ACTIVE',
        },
      },
      includes: ['CLASS_SCHEDULE'],
      limit: 50,
    }

    // The photos come from the catalog, a separate lookup. Start it now so it
    // runs alongside the class search instead of after it.
    const imagesLookup = this.fetchWorkshopImageMap().catch((err) => {
      logger.error('Failed to join workshop images from catalog', {
        error: err instanceof Error ? err.message : String(err),
      })
      // Workshops still render without images.
      return new Map<string, { card?: string; flyer?: string }>()
    })

    const response = await fetch(
      `${CLASSES_API_BASE}/class_schedule_instances/search?unit_token=${locationId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Origin': 'https://book.squareup.com',
          'Referer': 'https://book.squareup.com/',
        },
        body: JSON.stringify(requestBody),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Classes API error', { status: response.status, error: errorText })
      throw new Error(`Square Classes API error: ${response.status}`)
    }

    const data: any = await response.json()
    const scheduleMap = new Map<string, any>()
    for (const schedule of data.included_resources?.class_schedules ?? []) {
      scheduleMap.set(schedule.id, schedule)
    }

    const workshops: Workshop[] = (data.class_schedule_instances ?? []).map((instance: any): Workshop => {
      const details = scheduleMap.get(instance.class_schedule_id) ?? {}
      return {
        id: instance.id,
        scheduleId: instance.class_schedule_id,
        name: details.name ?? 'Unnamed Workshop',
        description: details.description ?? '',
        descriptionHtml: details.description_html ?? '',
        startAt: instance.start_at,
        durationMinutes: details.duration_minutes ?? 60,
        priceCents: details.price_amount ?? 0,
        priceCurrency: details.price_currency ?? 'USD',
        availableCapacity: instance.available_capacity ?? 0,
        ...(typeof instance.capacity === 'number' ? { totalCapacity: instance.capacity } : {}),
        staffName: details.staff_name ?? '',
        teamMemberId: details.team_member_id ?? '',
      }
    })

    // Join images from paired CLASS_TICKET catalog items by name match.
    // Square auto-creates a catalog item for every class added via the
    // Appointments UI; that catalog item is where workshop images live.
    const nameToImages = await imagesLookup
    for (const w of workshops) {
      const imgs = nameToImages.get(w.name.toLowerCase())
      if (!imgs) continue
      if (imgs.card) w.imageUrl = imgs.card
      if (imgs.flyer) w.flyerUrl = imgs.flyer
    }

    return workshops
  }

  /**
   * Maps lowercased workshop name → { card, flyer } image URLs.
   * Images are distinguished by their `caption` field on the catalog IMAGE
   * object: "card" → 16:9 card image, "flyer" → taller flyer image.
   * If no captioned card exists but images are present, the first image is
   * used as the card fallback (preserves current behavior for items that
   * were uploaded before captions were a convention).
   */
  private async fetchWorkshopImageMap(): Promise<Map<string, { card?: string; flyer?: string }>> {
    const client = createSquareClient(this.config)
    const nameToImageIds = new Map<string, string[]>()
    const imageIds = new Set<string>()

    for await (const obj of await client.catalog.list({ types: 'ITEM' })) {
      const item = obj as any
      const name: string | undefined = item.itemData?.name
      const ids: string[] = item.itemData?.imageIds ?? []
      if (!name || ids.length === 0) continue
      nameToImageIds.set(name.toLowerCase(), ids)
      for (const id of ids) imageIds.add(id)
    }

    if (imageIds.size === 0) return new Map()

    const batchResp: any = await client.catalog.batchGet({ objectIds: Array.from(imageIds) })
    const idToImage = new Map<string, { url: string; caption: string }>()
    for (const obj of batchResp?.objects ?? batchResp?.relatedObjects ?? []) {
      if (obj.type !== 'IMAGE' || !obj.imageData?.url) continue
      idToImage.set(obj.id, {
        url: obj.imageData.url,
        caption: (obj.imageData.caption ?? '').toLowerCase(),
      })
    }

    const result = new Map<string, { card?: string; flyer?: string }>()
    for (const [name, ids] of nameToImageIds) {
      const slot: { card?: string; flyer?: string } = {}
      for (const id of ids) {
        const img = idToImage.get(id)
        if (!img) continue
        if (img.caption === 'card' && !slot.card) slot.card = img.url
        else if (img.caption === 'flyer' && !slot.flyer) slot.flyer = img.url
      }
      // Fallback: if no captioned card, use the first image as the card.
      if (!slot.card && ids.length > 0) {
        const first = idToImage.get(ids[0])
        if (first) slot.card = first.url
      }
      if (slot.card || slot.flyer) result.set(name, slot)
    }
    return result
  }
}
