export interface WorkshopCardProps {
  workshop: {
    id: string
    name: string
    description: string
    date: string
    startTime: string
    endTime: string
    duration: number
    price: number
    currency: string
    remainingSeats: number | null
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
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

export default function WorkshopCard({ workshop }: WorkshopCardProps) {
  if (workshop.remainingSeats === 0) return null

  const dateStr = formatDate(workshop.date)
  const shortDateStr = formatShortDate(workshop.date)
  const timeRange = `${formatTime(workshop.startTime)} - ${formatTime(workshop.endTime)}`
  const price = formatPrice(workshop.price, workshop.currency)

  return (
    <div
      className="group relative rounded-2xl overflow-hidden transition-all duration-400"
      style={{
        background: 'rgba(255, 255, 255, 0.75)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(150, 112, 91, 0.06)',
        boxShadow: '0 2px 8px rgba(150, 112, 91, 0.08), 0 10px 40px rgba(150, 112, 91, 0.07)',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement
        el.style.transform = 'translateY(-4px) scale(1.02)'
        el.style.boxShadow = '0 20px 40px rgba(150, 112, 91, 0.12), 0 0 0 1px rgba(212, 165, 116, 0.15)'
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement
        el.style.transform = ''
        el.style.boxShadow = '0 2px 8px rgba(150, 112, 91, 0.08), 0 10px 40px rgba(150, 112, 91, 0.07)'
      }}
    >
      <div className="p-7">
        {/* Top row: date + price */}
        <div className="flex items-start justify-between mb-4">
          <span
            className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full"
            style={{ background: 'rgba(150, 112, 91, 0.08)', color: 'var(--color-primary)' }}
          >
            {shortDateStr}
          </span>
          <span className="text-xl font-bold" style={{ color: 'var(--color-dark, #3d3229)' }}>{price}</span>
        </div>

        <h3 className="text-xl font-bold mb-2" style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-dark, #3d3229)' }}>
          {workshop.name}
        </h3>
        <p className="text-sm leading-relaxed mb-5" style={{ color: 'var(--color-muted)' }}>
          {workshop.description}
        </p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs mb-6" style={{ color: 'var(--color-muted)' }}>
          <span>{dateStr}</span>
          <span className="flex items-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            {timeRange}
          </span>
          <span>{workshop.duration} min</span>
          {workshop.remainingSeats !== null && (
            <span className="ml-auto font-medium" style={{ color: 'var(--color-accent)' }}>
              {workshop.remainingSeats} seats remaining
            </span>
          )}
        </div>

        <a
          href={`/book?workshop=${workshop.id}`}
          className="block w-full text-center rounded-xl px-6 py-3.5 text-white font-semibold text-sm transition-all duration-300 no-underline"
          style={{
            background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
            boxShadow: '0 4px 15px rgba(150, 112, 91, 0.2)',
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLElement
            el.style.boxShadow = '0 8px 25px rgba(150, 112, 91, 0.35)'
            el.style.transform = 'translateY(-1px)'
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLElement
            el.style.boxShadow = '0 4px 15px rgba(150, 112, 91, 0.2)'
            el.style.transform = ''
          }}
        >
          Book Seat
        </a>
      </div>
    </div>
  )
}
