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
      totalChargedCents: typeof done.order?.total_money?.amount === 'number' ? done.order.total_money.amount : null,
    }
  }

  async getSeatBooking(bookingId: string): Promise<{ id: string; status: string; startAt: string; scheduleId: string } | null> {
    const res = await fetch(this.classesUrl(`/class_bookings/${encodeURIComponent(bookingId)}`), { headers: BUYER_HEADERS })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Square answered ${res.status} for booking ${bookingId}`)
    const b = (await res.json())?.class_booking
    if (!b?.id || typeof b.status !== 'string') throw new Error(`Square sent no booking for ${bookingId}`)
    return { id: b.id, status: b.status, startAt: b.start_at ?? '', scheduleId: b.class_schedule_id ?? '' }
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
   * One held seat's price, set on its draft order through the Orders API
   * before /complete charges the order's total (proven on a hold 18 Oct
   * 2026: base price changed, tax recomputed, catalog link and note kept).
   * Anything unexpected is a refusal, so the caller charges nothing.
   */
  async setSeatPrice(params: { reservation: SeatReservation; priceCents: number; note: string }): Promise<{ totalCents: number }> {
    const { reservation, priceCents, note } = params
    const refuse = (why: string, status?: number): never => {
      logger.error('Seat price not set on the order', { bookingId: reservation.bookingId, orderId: reservation.orderId, priceCents, why })
      throw new SeatBookingError('square', 'reserve', 'refused', `seat price: ${why}`, status)
    }
    if (!reservation.orderId) return refuse('the hold came back without an order')
    const base = this.config.environment === 'production' ? 'https://connect.squareup.com/v2' : 'https://connect.squareupsandbox.com/v2'
    const headers = {
      Authorization: `Bearer ${this.config.accessToken}`,
      'Content-Type': 'application/json',
      'Square-Version': '2025-01-23',
    }
    const call = async (init?: RequestInit): Promise<any> => {
      let res: Response
      try {
        res = await fetch(`${base}/orders/${reservation.orderId}`, { headers, ...init })
      } catch (err) {
        return refuse(err instanceof Error ? err.message : String(err))
      }
      const text = await res.text().catch(() => '')
      if (!res.ok) return refuse(text.slice(0, 300) || `status ${res.status}`, res.status)
      return JSON.parse(text).order
    }

    const order = await call()
    const lines = order?.line_items ?? []
    if (order?.state !== 'DRAFT' || lines.length !== 1 || lines[0].quantity !== '1') {
      return refuse(`unexpected order (state ${order?.state}, ${lines.length} lines, qty ${lines[0]?.quantity})`)
    }
    const updated = await call({
      method: 'PUT',
      body: JSON.stringify({
        order: {
          location_id: order.location_id,
          version: order.version,
          line_items: [{ uid: lines[0].uid, base_price_money: { amount: priceCents, currency: lines[0].base_price_money?.currency ?? 'USD' }, note }],
        },
        idempotency_key: `${reservation.bookingId}-price-${priceCents}`,
      }),
    })
    const line = updated?.line_items?.[0]
    if (updated?.state !== 'DRAFT' || line?.base_price_money?.amount !== priceCents || line?.quantity !== '1' || typeof updated?.total_money?.amount !== 'number') {
      return refuse('the order did not take the new price')
    }
    logger.info('Seat price set on the order', { bookingId: reservation.bookingId, priceCents, totalCents: updated.total_money.amount })
    return { totalCents: updated.total_money.amount }
  }

  /**
   * Every upcoming workshop, soonest first. A workshop with no seats left
   * stays in the list (pages show it as "Sold out") until its start time
   * passes; then it goes, like any other.
   */
  /**
   * The buyer classes API only answers for production locations (the sandbox
   * gets 422 "No matching location found"), and the sandbox has no legacy
   * Square classes, so there it is never called. Production still fails
   * closed on errors.
   */
  private noLegacyClasses(): boolean {
    return this.config.environment === 'sandbox'
  }

  async listWorkshops(): Promise<Workshop[]> {
    if (!this.config.locationId || this.noLegacyClasses()) {
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
    if (!this.config.locationId || this.noLegacyClasses()) return null
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
    if (!this.config.locationId || this.noLegacyClasses()) return []
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
      return new Map<string, { card?: string; flyer?: string; taxPercent?: number }>()
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
      if (typeof imgs.taxPercent === 'number') w.taxPercent = imgs.taxPercent
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
  private async fetchWorkshopImageMap(): Promise<Map<string, { card?: string; flyer?: string; taxPercent?: number }>> {
    const client = createSquareClient(this.config)
    const nameToImageIds = new Map<string, string[]>()
    const nameToTaxIds = new Map<string, string[]>()
    const imageIds = new Set<string>()

    for await (const obj of await client.catalog.list({ types: 'ITEM' })) {
      const item = obj as any
      const name: string | undefined = item.itemData?.name
      if (!name) continue
      if (item.itemData?.productType === 'CLASS_TICKET') nameToTaxIds.set(name.toLowerCase(), item.itemData?.taxIds ?? [])
      const ids: string[] = item.itemData?.imageIds ?? []
      if (ids.length === 0) continue
      nameToImageIds.set(name.toLowerCase(), ids)
      for (const id of ids) imageIds.add(id)
    }

    // The tax Square adds at checkout: the item's enabled, added-on-top taxes
    // that apply at this location. Read here so the site never shows one
    // price and charges another (11 Oct 2026: $25 shown, $27.25 charged).
    const addOnPercent = new Map<string, number>()
    for await (const obj of await client.catalog.list({ types: 'TAX' })) {
      const tax = obj as any
      const data = tax.taxData
      const here = tax.presentAtAllLocations || (tax.presentAtLocationIds ?? []).includes(this.config.locationId)
      if (!data?.enabled || tax.isDeleted || !here || data.inclusionType !== 'ADDITIVE') continue
      const pct = Number(data.percentage)
      if (Number.isFinite(pct) && pct > 0) addOnPercent.set(tax.id, pct)
    }

    const result = new Map<string, { card?: string; flyer?: string; taxPercent?: number }>()
    for (const [name, taxIds] of nameToTaxIds) {
      result.set(name, { taxPercent: taxIds.reduce((sum, id) => sum + (addOnPercent.get(id) ?? 0), 0) })
    }

    if (imageIds.size === 0) return result

    const batchResp: any = await client.catalog.batchGet({ objectIds: Array.from(imageIds) })
    const idToImage = new Map<string, { url: string; caption: string }>()
    for (const obj of batchResp?.objects ?? batchResp?.relatedObjects ?? []) {
      if (obj.type !== 'IMAGE' || !obj.imageData?.url) continue
      idToImage.set(obj.id, {
        url: obj.imageData.url,
        caption: (obj.imageData.caption ?? '').toLowerCase(),
      })
    }

    for (const [name, ids] of nameToImageIds) {
      const slot: { card?: string; flyer?: string; taxPercent?: number } = { ...result.get(name) }
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
      if (slot.card || slot.flyer || typeof slot.taxPercent === 'number') result.set(name, slot)
    }
    return result
  }
}
