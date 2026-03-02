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

function formatShortDate(iso: string): { month: string; day: string } {
  const d = new Date(iso + 'T00:00:00')
  return {
    month: d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
    day: d.toLocaleDateString('en-US', { day: 'numeric' }),
  }
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
  const shortDate = formatShortDate(workshop.date)
  const timeRange = `${formatTime(workshop.startTime)} - ${formatTime(workshop.endTime)}`
  const price = formatPrice(workshop.price, workshop.currency)

  return (
    <div
      className="relative flex rounded-xl overflow-hidden transition hover:-translate-y-1 hover:shadow-lg"
      style={{ backgroundColor: '#f5f0ea', border: '1px solid rgba(196, 168, 130, 0.3)' }}
    >
      {/* Accent stripe */}
      <div className="w-1.5 flex-shrink-0 rounded-l-xl" style={{ backgroundColor: 'var(--color-primary)' }} />

      <div className="flex-1 p-6">
        {/* Date badge */}
        <div
          className="absolute top-4 right-4 flex flex-col items-center rounded-lg px-3 py-1.5 text-center"
          style={{ backgroundColor: 'var(--color-secondary)', color: 'var(--color-text)' }}
        >
          <span className="text-[10px] font-bold leading-none">{shortDate.month}</span>
          <span className="text-lg font-bold leading-tight">{shortDate.day}</span>
        </div>

        <h3 className="text-xl font-bold mb-2 pr-16" style={{ fontFamily: 'var(--font-heading)' }}>{workshop.name}</h3>
        <p className="mb-4" style={{ color: 'var(--color-muted)', fontSize: '0.875rem' }}>{workshop.description}</p>

        <div className="space-y-1 text-sm mb-4" style={{ color: 'var(--color-muted)' }}>
          <p>{dateStr}</p>
          <p>{timeRange}</p>
          <p>{workshop.duration} min</p>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-lg font-semibold">{price}</span>
          {workshop.remainingSeats !== null && (
            <span className="text-sm font-medium" style={{ color: 'var(--color-accent)' }}>
              {workshop.remainingSeats} seats remaining
            </span>
          )}
        </div>

        <a
          href={`/book?workshop=${workshop.id}`}
          className="mt-4 block w-full text-center rounded-lg px-6 py-3 text-white font-semibold transition hover:-translate-y-0.5 hover:shadow-lg"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          Book Seat
        </a>
      </div>
    </div>
  )
}
