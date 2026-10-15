import { useState } from 'react'
import type { WorkshopData } from './WorkshopExplorer'
import NotifyMe from '@components/shared/NotifyMe'
import { formatMoney } from '@lib/money'
import { canBeBooked, isSoldOut, seatsLeftLabel } from '@lib/workshop-rules'
import { ageLabel, isDropOff, notifyInterest } from '@lib/workshop-copy'
import { studioClock } from './workshop-view-model'
import { trackWaitlistOpened } from '@lib/analytics'

export interface WorkshopRowProps {
  workshop: WorkshopData
  onBook?: (workshop: WorkshopData) => void
}

/** "Sat, Oct 17 · 4 PM" / "7:30 PM": the studio day and start time. */
export function rowWhen(w: Pick<WorkshopData, 'date' | 'startTime'>): string {
  const day = new Date(`${w.date}T12:00:00Z`)
  const dayLabel = Number.isNaN(day.getTime())
    ? ''
    : day.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
  const clock = studioClock(w.startTime)
  let time = ''
  if (clock) {
    const [h, m] = clock.split(':').map(Number)
    time = `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`
  }
  return [dayLabel, time].filter(Boolean).join(' · ')
}

/**
 * One workshop on /workshops as a compact row (Kaden picked "A · Photo list",
 * 15 Oct 2026): a small photo, then when, what, price, who it's for and
 * drop-off. About five fit on a phone screen. Tapping a bookable row opens the
 * booking panel; a sold-out or not-yet-on-sale row offers the email sign-up.
 */
export default function WorkshopRow({ workshop, onBook }: WorkshopRowProps) {
  const [asking, setAsking] = useState(false)

  const comingSoon = !canBeBooked(workshop.price)
  const soldOut = !comingSoon && isSoldOut(workshop.remainingSeats)
  const closed = !comingSoon && workshop.signupClosed === true
  const bookable = !comingSoon && !soldOut && !closed
  const seats = bookable ? seatsLeftLabel(workshop.remainingSeats) : ''
  const meta = [
    comingSoon ? '' : formatMoney(workshop.price, workshop.currency),
    ageLabel(workshop.description),
    isDropOff(workshop.description) ? 'Drop-off' : '',
  ].filter(Boolean).join(' · ')
  const status = comingSoon ? 'Coming soon' : soldOut ? 'Sold out' : closed ? 'Sign-ups closed' : seats

  const body = (
    <>
      <span
        aria-hidden="true"
        style={{
          width: '5.25rem',
          height: '5.25rem',
          borderRadius: '0.625rem',
          overflow: 'hidden',
          background: 'var(--tone-workshop-soft)',
          flexShrink: 0,
        }}
      >
        {workshop.imageUrl && (
          <img
            src={workshop.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', ...(soldOut ? { opacity: 0.55 } : {}) }}
          />
        )}
      </span>
      <span style={{ display: 'grid', gap: '0.15rem', minWidth: 0, flex: 1, textAlign: 'left' }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--tone-workshop-ink, var(--color-primary))' }}>{rowWhen(workshop)}</span>
        <span className="font-heading" style={{ fontSize: '1.05rem', fontWeight: 700, lineHeight: 1.25, color: 'var(--color-dark)' }}>
          {workshop.name}
        </span>
        {meta && <span style={{ fontSize: '0.82rem', color: 'var(--color-muted)' }}>{meta}</span>}
        {status && (
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: bookable ? 'var(--color-primary)' : 'var(--color-muted)' }}>{status}</span>
        )}
      </span>
      {bookable && (
        <span aria-hidden="true" style={{ color: 'var(--color-muted)', fontSize: '1.4rem', paddingRight: '0.25rem' }}>
          ›
        </span>
      )}
    </>
  )

  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.875rem',
    width: '100%',
    padding: '0.5rem',
    borderRadius: '0.875rem',
    background: 'var(--color-surface)',
    border: '1px solid var(--color-line)',
    font: 'inherit',
    color: 'inherit',
  } as const

  return (
    <article style={{ display: 'grid', gap: '0.5rem', width: '100%' }}>
      {bookable ? (
        <button
          type="button"
          onClick={() => onBook?.(workshop)}
          aria-label={`${workshop.name}, ${rowWhen(workshop)}. See details and book`}
          style={{ ...rowStyle, cursor: 'pointer' }}
        >
          {body}
        </button>
      ) : (
        <div style={rowStyle}>{body}</div>
      )}

      {comingSoon && !asking && (
        <button type="button" className="btn btn-secondary" style={{ width: '100%' }} onClick={() => { trackWaitlistOpened(workshop.id, workshop.name, 'coming_soon'); setAsking(true) }}>
          Tell me when booking opens
        </button>
      )}
      {comingSoon && asking && (
        <NotifyMe
          interest={notifyInterest('workshop-soon', workshop.name, workshop.date)}
          buttonLabel="Tell me when booking opens"
          note="One email when this workshop opens for booking. Nothing else."
          successText="Got it. We’ll email you when this one opens."
        />
      )}
      {soldOut && !closed && !asking && (
        <button type="button" className="btn btn-secondary" style={{ width: '100%' }} onClick={() => { trackWaitlistOpened(workshop.id, workshop.name, 'sold_out'); setAsking(true) }}>
          Tell me if a seat opens
        </button>
      )}
      {soldOut && !closed && asking && (
        <NotifyMe
          interest={notifyInterest('workshop-waitlist', workshop.name, workshop.date)}
          buttonLabel="Tell me if a seat opens"
          note="One email if a seat opens. Nothing else."
          successText="Got it. If a seat opens we’ll email you, and it goes to whoever books first."
        />
      )}
    </article>
  )
}
