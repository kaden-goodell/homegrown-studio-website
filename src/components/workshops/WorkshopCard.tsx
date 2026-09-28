import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { WorkshopData } from './WorkshopExplorer'
import NotifyMe from '@components/shared/NotifyMe'
import { formatMoney } from '@lib/money'
import { canBeBooked, isSoldOut, seatsLeftLabel } from '@lib/workshop-rules'
import { firstParagraph, notifyInterest, takeHomeLine } from '@lib/workshop-copy'
import { whenLabel } from './workshop-view-model'

export interface WorkshopCardProps {
  workshop: WorkshopData
  onBook?: (workshop: WorkshopData) => void
  /** Where "See details and book" leads when the card sits on another page (the home page). Without it the button calls `onBook`. */
  href?: string
}

/** Text held to a number of lines, ending in an ellipsis. */
function clamp(lines: number): CSSProperties {
  return {
    display: '-webkit-box',
    WebkitLineClamp: lines,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  }
}

// Every card is the same shape: a 4:3 photo, then blocks of fixed height, so
// cards line up across the grid whatever each description says.
const DESCRIPTION_LINES = 4
const TAKE_HOME_LINES = 2

export default function WorkshopCard({ workshop, onBook, href }: WorkshopCardProps) {
  const [asking, setAsking] = useState(false)

  // No price yet means it is not for sale: "Coming soon", and no way to book.
  // That wins over "Sold out": a class that is not on sale has not sold anything.
  const comingSoon = !canBeBooked(workshop.price)
  const soldOut = !comingSoon && isSoldOut(workshop.remainingSeats)
  const seats = comingSoon || soldOut ? '' : seatsLeftLabel(workshop.remainingSeats)
  const takeHome = takeHomeLine(workshop.description)

  return (
    <article
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        borderRadius: '1rem',
        overflow: 'hidden',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-line)',
        boxShadow: '0 4px 16px rgba(var(--color-primary-rgb), 0.08)',
      }}
    >
      <div
        data-testid="workshop-photo"
        style={{ position: 'relative', aspectRatio: '4 / 3', background: 'var(--tone-workshop-soft)' }}
      >
        {workshop.imageUrl && (
          <img
            src={workshop.imageUrl}
            alt={workshop.name}
            loading="lazy"
            decoding="async"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
              ...(soldOut ? { opacity: 0.55 } : {}),
            }}
          />
        )}
        <span className="chip tone-workshop" style={{ position: 'absolute', left: '0.75rem', bottom: '0.75rem' }}>
          {whenLabel(workshop)}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '1.25rem' }}>
        <h3
          className="font-heading"
          style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, lineHeight: 1.25, color: 'var(--color-dark)', ...clamp(2) }}
        >
          {workshop.name}
        </h3>
        <p
          style={{
            margin: '0.5rem 0 0',
            fontSize: '0.9375rem',
            lineHeight: 1.5,
            height: `${DESCRIPTION_LINES * 1.5}em`,
            color: 'var(--color-text)',
            ...clamp(DESCRIPTION_LINES),
          }}
        >
          {firstParagraph(workshop.description)}
        </p>
        {/* Kept at its height when there is no line, so cards stay the same size. */}
        <p
          title={takeHome || undefined}
          aria-hidden={takeHome ? undefined : true}
          style={{
            margin: '0.75rem 0 0',
            fontSize: '0.8125rem',
            fontWeight: 500,
            lineHeight: 1.4,
            height: `${TAKE_HOME_LINES * 1.4}em`,
            color: 'var(--color-muted)',
            ...clamp(TAKE_HOME_LINES),
          }}
        >
          {takeHome}
        </p>

        {/* Pinned to the bottom, so the buttons line up along a row of cards. */}
        <div style={{ marginTop: 'auto', paddingTop: '1rem' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.75rem',
              minHeight: '1.75rem',
              marginBottom: '0.875rem',
              color: 'var(--color-dark)',
            }}
          >
            {comingSoon ? (
              <span className="chip tone-event">Coming soon</span>
            ) : (
              <span style={{ fontSize: '1rem', fontWeight: 700 }}>
                {`${formatMoney(workshop.price, workshop.currency)} per seat`}
              </span>
            )}
            {soldOut && <span className="chip">Sold out</span>}
            {seats && <span style={{ fontSize: '0.875rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{seats}</span>}
          </div>

          {comingSoon && !asking && (
            <button type="button" className="btn btn-secondary" style={{ width: '100%' }} onClick={() => setAsking(true)}>
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

          {soldOut && !asking && (
            <button type="button" className="btn btn-secondary" style={{ width: '100%' }} onClick={() => setAsking(true)}>
              Tell me if a seat opens
            </button>
          )}
          {soldOut && asking && (
            <NotifyMe
              interest={notifyInterest('workshop-waitlist', workshop.name, workshop.date)}
              buttonLabel="Tell me if a seat opens"
              note="One email if a seat opens. Nothing else."
              successText="Got it. If a seat opens we’ll email you, and it goes to whoever books first."
            />
          )}

          {!comingSoon && !soldOut && href && (
            <a className="btn btn-primary" style={{ width: '100%' }} href={href}>
              See details and book
            </a>
          )}
          {!comingSoon && !soldOut && !href && (
            <button type="button" className="btn btn-primary" style={{ width: '100%' }} onClick={() => onBook?.(workshop)}>
              See details and book
            </button>
          )}
        </div>
      </div>
    </article>
  )
}
