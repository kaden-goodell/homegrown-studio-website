import { useState } from 'react'
import type { WorkshopData } from './WorkshopExplorer'
import NotifyMe from '@components/shared/NotifyMe'
import { formatMoney } from '@lib/money'
import { canBeBooked, isSoldOut, seatsLeftLabel } from '@lib/workshop-rules'
import { ageLabel, isDropOff, notifyInterest } from '@lib/workshop-copy'
import { trackWaitlistOpened } from '@lib/analytics'

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
  const meta = [comingSoon ? '' : formatMoney(w.price, w.currency), ageLabel(w.description), isDropOff(w.description) ? 'Drop-off' : '']
    .filter(Boolean)
    .join(' · ')
  const status = comingSoon ? 'Coming soon' : soldOut ? 'Sold out' : closed ? 'Sign-ups closed' : seats
  return { comingSoon, soldOut, closed, bookable, seats, meta, status }
}

/** The email sign-up a not-yet-on-sale or sold-out workshop offers instead of booking. */
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
