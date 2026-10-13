import type { SeatBooking, SeatReservation, Workshop, WorkshopProvider } from '../interfaces/workshop'
import { SeatBookingError } from '../../lib/errors'

const NOW = Date.now()
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const FIXTURES: Workshop[] = [
  {
    id: 'mock-ws-1',
    scheduleId: 'mock-sched-1',
    name: 'Mock Glass Fusing 101',
    description: 'Beginner glass fusing class.',
    descriptionHtml: '<p>Beginner glass fusing class.</p>',
    startAt: new Date(NOW + 3 * DAY).toISOString(),
    durationMinutes: 120,
    priceCents: 6500,
    priceCurrency: 'USD',
    availableCapacity: 6,
    staffName: 'Mock Instructor',
    teamMemberId: 'TM-mock',
  },
  {
    id: 'mock-ws-2',
    scheduleId: 'mock-sched-2',
    name: 'Mock Candle Pouring',
    description: 'Make your own soy candle.',
    descriptionHtml: '<p>Make your own soy candle.</p>',
    startAt: new Date(NOW + 7 * DAY).toISOString(),
    durationMinutes: 90,
    priceCents: 4500,
    priceCurrency: 'USD',
    availableCapacity: 4,
    staffName: 'Mock Instructor',
    teamMemberId: 'TM-mock',
  },
  {
    id: 'mock-sold-out-1',
    scheduleId: 'mock-sched-3',
    name: 'Mock Sold-Out Workshop',
    description: 'This one is full.',
    descriptionHtml: '<p>This one is full.</p>',
    startAt: new Date(NOW + 10 * DAY).toISOString(),
    durationMinutes: 60,
    priceCents: 3500,
    priceCurrency: 'USD',
    availableCapacity: 0,
    staffName: 'Mock Instructor',
    teamMemberId: 'TM-mock',
  },
]

export class MockWorkshopProvider implements WorkshopProvider {
  async listWorkshops(): Promise<Workshop[]> {
    const now = Date.now()
    return FIXTURES
      .filter((w) => new Date(w.startAt).getTime() > now)
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
  }

  /** By scheduleId or instance id, over the UNFILTERED fixtures — mirrors the
   *  Square provider so a sold-out class still resolves (C2). */
  async getWorkshop(id: string): Promise<Workshop | null> {
    const instance = FIXTURES.find((w) => w.id === id)
    if (instance) return instance
    return (
      FIXTURES
        .filter((w) => w.scheduleId === id)
        .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())[0] ?? null
    )
  }

  private nextId = 1

  async reserveSeats(params: { scheduleId: string; seats: number }): Promise<SeatReservation> {
    const workshop = FIXTURES.find((w) => w.scheduleId === params.scheduleId)
    if (workshop && workshop.availableCapacity < params.seats) {
      throw new SeatBookingError('mock', 'reserve', 'refused', 'Not enough seats available', 409)
    }
    const n = this.nextId++
    return { bookingId: `mock-seat-${n}`, contactToken: `mock-contact-${n}`, orderId: `mock-order-${n}` }
  }

  /** Payment token 'FAIL' is refused, like the mock payment provider. */
  async payForSeats(params: { reservation: SeatReservation; paymentToken: string }): Promise<SeatBooking> {
    if (params.paymentToken === 'FAIL') {
      throw new SeatBookingError('mock', 'pay', 'refused', 'Card declined', 402)
    }
    return {
      bookingId: params.reservation.bookingId,
      orderId: params.reservation.orderId,
      status: 'accepted',
      receiptUrl: null,
    }
  }

  async releaseSeats(_bookingId: string): Promise<void> {}
}
