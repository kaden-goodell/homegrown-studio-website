import { useState } from 'react'
import type { WorkshopData } from './WorkshopExplorer'
import NotifyMe from '@components/shared/NotifyMe'
import RequestSpot from './RequestSpot'
import { formatMoney } from '@lib/money'
import { canBeBooked, isSoldOut, seatsLeftLabel } from '@lib/workshop-rules'
import { ageLabel, agesLabel, isDropOff, notifyInterest } from '@lib/workshop-copy'
import { trackWaitlistOpened } from '@lib/analytics'
import { ownPriceLabel } from '@lib/classes/public-class'

/**
 * "$25", or "$20 adult · $15 kid" on a class with ticket types. One of our own
 * classes reads its price cells: "From $15" when there are several prices.
 */
export function priceLabel(w: Pick<WorkshopData, 'price' | 'currency' | 'tickets' | 'own'>): string {
  if (w.own) return ownPriceLabel(w.own, w.currency)
  return w.tickets?.length
    ? w.tickets.map((t) => `${formatMoney(t.priceCents, w.currency)} ${t.label.toLowerCase()}`).join(' · ')
    : formatMoney(w.price, w.currency)
}

/**
 * Where one workshop stands, worked out once for both layouts on /workshops
 * (the phone row and the wide-screen card), so they can never disagree.
 */
export function workshopStatus(w: WorkshopData) {
  // No price yet: "Coming soon", and that wins over "Sold out".
  const comingSoon = !canBeBooked(w.price)
  const soldOut = !comingSoon && isSoldOut(w.remainingSeats)
  const closed = !comingSoon && w.signupClosed === true
  const bookable = !comingSoon && !soldOut && !closed
  const seats = bookable ? seatsLeftLabel(w.remainingSeats) : ''
  /** "$25 · Ages 8+ · Drop-off" */
  const ages = w.own ? agesLabel(w.own.rules.ages) : ageLabel(w.description)
  const dropOff = w.own ? w.own.rules.dropOff : isDropOff(w.description)
  const meta = [comingSoon ? '' : priceLabel(w), ages, dropOff ? 'Drop-off' : '']
    .filter(Boolean)
    .join(' · ')
  const status = comingSoon ? 'Coming soon' : soldOut ? 'Sold out' : closed ? 'Sign-ups closed' : seats
  return { comingSoon, soldOut, closed, bookable, seats, meta, status }
}

/** What a workshop offers instead of booking: the email sign-up when not yet on sale or sold out, a call when sign-ups closed early. */
export function WorkshopWaitlist({ workshop }: { workshop: WorkshopData }) {
  const [asking, setAsking] = useState(false)
  const { comingSoon, soldOut, closed } = workshopStatus(workshop)
  if (comingSoon) {
    return asking ? (
      <NotifyMe
        interest={notifyInterest('workshop-soon', workshop.name, workshop.date)}
        buttonLabel="Tell me when booking opens"
        note="One email when this workshop opens for booking. Nothing else."
        successText="Got it. We’ll email you when this one opens."
      />
    ) : (
      <button type="button" className="btn btn-secondary" style={{ width: '100%' }} onClick={() => { trackWaitlistOpened(workshop.id, workshop.name, 'coming_soon'); setAsking(true) }}>
        Tell me when booking opens
      </button>
    )
  }
  if (closed && !soldOut) return <RequestSpot />
  if (soldOut && !closed) {
    return asking ? (
      <NotifyMe
        interest={notifyInterest('workshop-waitlist', workshop.name, workshop.date)}
        buttonLabel="Tell me if a seat opens"
        note="One email if a seat opens. Nothing else."
        successText="Got it. If a seat opens we’ll email you, and it goes to whoever books first."
      />
    ) : (
      <button type="button" className="btn btn-secondary" style={{ width: '100%' }} onClick={() => { trackWaitlistOpened(workshop.id, workshop.name, 'sold_out'); setAsking(true) }}>
        Tell me if a seat opens
      </button>
    )
  }
  return null
}
