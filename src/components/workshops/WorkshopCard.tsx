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
  const timeRange = `${formatTime(workshop.startTime)} - ${formatTime(workshop.endTime)}`
  const price = formatPrice(workshop.price, workshop.currency)

  return (
    <div className="rounded-xl shadow-md p-6 bg-white transition hover:-translate-y-1 hover:shadow-lg">
      <h3 className="text-xl font-bold mb-2">{workshop.name}</h3>
      <p className="text-gray-600 mb-4">{workshop.description}</p>

      <div className="space-y-1 text-sm text-gray-500 mb-4">
        <p>{dateStr}</p>
        <p>{timeRange}</p>
        <p>{workshop.duration} min</p>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-lg font-semibold">{price}</span>
        {workshop.remainingSeats !== null && (
          <span className="text-sm text-amber-600 font-medium">
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
  )
}
