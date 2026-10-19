import type { WorkshopData } from './WorkshopExplorer'
import { firstParagraph } from '@lib/workshop-copy'
import { workshopStatus, WorkshopWaitlist } from './workshop-status'
import { rowWhen } from './WorkshopRow'

export interface WorkshopTileProps {
  workshop: WorkshopData
  onBook?: (workshop: WorkshopData) => void
  /** Booking isn't open on this page yet: this line instead of the Book button. */
  closedNote?: string
}

/**
 * One workshop on /workshops at wide-screen sizes (Kaden picked option 2,
 * 15 Oct 2026): a 4:3 photo with the date on it, the name, a one-line hook,
 * "$25 · Ages 8+ · Drop-off", and the Book button. Phones get WorkshopRow.
 */
export default function WorkshopTile({ workshop, onBook, closedNote }: WorkshopTileProps) {
  const { soldOut, closed, bookable, meta, status } = workshopStatus(workshop)
  const hook = firstParagraph(workshop.description)

  return (
    <article
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        borderRadius: '1rem',
        overflow: 'hidden',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-line)',
        boxShadow: '0 4px 16px rgba(var(--color-primary-rgb), 0.08)',
      }}
    >
      <div style={{ position: 'relative', aspectRatio: '4 / 3', background: 'var(--tone-workshop-soft)' }}>
        {workshop.imageUrl && (
          <img
            src={workshop.imageUrl}
            alt={workshop.name}
            loading="lazy"
            decoding="async"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', ...(soldOut ? { opacity: 0.55 } : {}) }}
          />
        )}
        <span className="chip tone-workshop" style={{ position: 'absolute', left: '0.75rem', bottom: '0.75rem' }}>
          {rowWhen(workshop)}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '0.35rem', padding: '1rem 1.1rem 1.1rem' }}>
        <h3 className="font-heading" style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, lineHeight: 1.25, color: 'var(--color-dark)' }}>
          {workshop.name}
        </h3>
        {hook && (
          <p
            style={{
              margin: 0,
              fontSize: '0.9rem',
              lineHeight: 1.45,
              color: 'var(--color-text)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {hook}
          </p>
        )}
        {meta && <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--color-muted)' }}>{meta}</p>}
        {status && (
          <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 600, color: bookable ? 'var(--color-primary)' : 'var(--color-muted)' }}>{status}</p>
        )}
        {/* Pinned to the bottom, so buttons line up along a row. */}
        <div style={{ marginTop: 'auto', paddingTop: '0.75rem' }}>
          {bookable && closedNote && <p style={{ margin: 0, fontSize: '0.9375rem', color: 'var(--color-text)' }}>{closedNote}</p>}
          {bookable && !closedNote && (
            <button type="button" className="btn btn-primary" style={{ width: '100%' }} onClick={() => onBook?.(workshop)}>
              See details and book
            </button>
          )}
          {!bookable && <WorkshopWaitlist workshop={workshop} />}
        </div>
      </div>
    </article>
  )
}
