import { useState } from 'react'
import type { WorkshopData } from './WorkshopExplorer'
import NotifyMe from '@components/shared/NotifyMe'
import { canBeBooked } from '@lib/workshop-rules'

export interface WorkshopCardProps {
  workshop: WorkshopData
  onBook?: (workshop: WorkshopData) => void
}

// Card date: "Saturday, October 17" — no year (it's on the badge and obvious),
// so it fits on one line next to the time.
function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function formatShortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(cents / 100)
}

export default function WorkshopCard({ workshop, onBook }: WorkshopCardProps) {
  if (workshop.remainingSeats === 0) return null

  const dateStr = formatDate(workshop.date)
  const shortDateStr = formatShortDate(workshop.date)
  const timeRange = `${formatTime(workshop.startTime)} - ${formatTime(workshop.endTime)}`
  // No price yet means it is not for sale: "Coming soon", and no way to book.
  const comingSoon = !canBeBooked(workshop.price)
  const price = comingSoon ? '' : formatPrice(workshop.price, workshop.currency)
  const [asking, setAsking] = useState(false)

  return (
    <div
      className="group relative rounded-2xl overflow-hidden transition-all duration-400"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-line)',
        boxShadow: '0 4px 16px rgba(var(--color-primary-rgb), 0.08), 0 10px 40px rgba(var(--color-primary-rgb), 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.6), inset 0 -1px 0 rgba(var(--color-primary-rgb), 0.06)',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement
        el.style.transform = 'translateY(-4px) scale(1.02)'
        el.style.boxShadow = '0 20px 40px rgba(var(--color-primary-rgb), 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.8)'
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement
        el.style.transform = ''
        el.style.boxShadow = '0 4px 16px rgba(var(--color-primary-rgb), 0.08), 0 10px 40px rgba(var(--color-primary-rgb), 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.7), inset 0 -1px 0 rgba(var(--color-primary-rgb), 0.04)'
      }}
    >
      <div className="p-7">
        {/* Top row: date + price */}
        <div className="flex items-start justify-between mb-4">
          <span
            className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full"
            style={{ background: 'var(--tone-workshop-soft)', color: 'var(--tone-workshop-ink)' }}
          >
            {shortDateStr}
          </span>
          {comingSoon ? (
            <span className="chip tone-event">Coming soon</span>
          ) : (
            <span className="text-xl font-bold" style={{ color: 'var(--color-dark, #3d3229)' }}>{price}</span>
          )}
        </div>

        <h3 className="text-xl font-bold mb-2" style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-dark, #3d3229)' }}>
          {workshop.name}
        </h3>
        {workshop.imageUrl ? (
          <div
            className="mb-5 rounded-xl overflow-hidden"
            style={{
              aspectRatio: '16 / 9',
              backgroundColor: 'rgba(var(--color-primary-rgb), 0.06)',
            }}
          >
            <img
              src={workshop.imageUrl}
              alt={workshop.name}
              loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </div>
        ) : (
          <p className="text-sm leading-relaxed mb-5" style={{
            color: 'var(--color-muted)',
            minHeight: '5.75rem',
            display: '-webkit-box',
            WebkitLineClamp: 4,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {workshop.description}
          </p>
        )}

        {/* Fixed two-line meta block so every card is the same height and the
            Book button always lines up across the grid (long weekday names
            used to wrap the time onto a second row). */}
        <div className="grid text-xs mb-6" style={{ gridTemplateColumns: '1fr auto', rowGap: '0.25rem', columnGap: '1rem', color: 'var(--color-muted)' }}>
          <span className="truncate">{dateStr}</span>
          <span className="flex items-center gap-1 whitespace-nowrap">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            {timeRange}
          </span>
          <span>{workshop.duration} min</span>
          <span className="font-medium whitespace-nowrap text-right" style={{ color: 'var(--tone-workshop-ink)', minHeight: '1em' }}>
            {!comingSoon && workshop.remainingSeats !== null ? `${workshop.remainingSeats} seats remaining` : ''}
          </span>
        </div>

        {comingSoon && !asking && (
          <button type="button" className="btn btn-secondary" style={{ width: '100%' }} onClick={() => setAsking(true)}>
            Tell me when booking opens
          </button>
        )}
        {comingSoon && asking && (
          <NotifyMe
            interest={`workshop-soon:${workshop.name.slice(0, 50)} ${workshop.date}`}
            buttonLabel="Tell me when booking opens"
            note="One email when this workshop opens for booking. Nothing else."
            successText="Got it. We’ll email you when this one opens."
          />
        )}
        {!comingSoon && <button
          type="button"
          onClick={() => onBook?.(workshop)}
          className="block w-full text-center rounded-xl px-6 py-3.5 text-white font-semibold text-sm transition-all duration-300"
          style={{
            background: 'var(--color-button)',
            boxShadow: '0 4px 15px rgba(var(--color-primary-rgb), 0.2)',
            border: 'none',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLElement
            el.style.boxShadow = '0 8px 25px rgba(var(--color-primary-rgb), 0.35)'
            el.style.transform = 'translateY(-1px)'
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLElement
            el.style.boxShadow = '0 4px 15px rgba(var(--color-primary-rgb), 0.2)'
            el.style.transform = ''
          }}
        >
          Book Seat
        </button>}
      </div>
    </div>
  )
}
