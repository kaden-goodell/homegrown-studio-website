import { useState } from 'react'
import SearchView from './SearchView'
import CalendarView from './CalendarView'

export interface WorkshopData {
  id: string
  name: string
  description: string
  category: string
  date: string
  startTime: string
  endTime: string
  duration: number
  price: number
  currency: string
  remainingSeats: number | null
}

export interface WorkshopExplorerProps {
  workshops: WorkshopData[]
}

type View = 'search' | 'calendar'

export default function WorkshopExplorer({ workshops }: WorkshopExplorerProps) {
  const [view, setView] = useState<View>('search')

  return (
    <div>
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setView('search')}
          className={`px-4 py-2 rounded-lg font-medium transition ${
            view === 'search'
              ? 'text-white'
              : 'hover:opacity-80'
          }`}
          style={
            view === 'search'
              ? { backgroundColor: 'var(--color-primary)' }
              : { backgroundColor: '#f5f0ea', color: 'var(--color-text)' }
          }
        >
          Search
        </button>
        <button
          onClick={() => setView('calendar')}
          className={`px-4 py-2 rounded-lg font-medium transition ${
            view === 'calendar'
              ? 'text-white'
              : 'hover:opacity-80'
          }`}
          style={
            view === 'calendar'
              ? { backgroundColor: 'var(--color-primary)' }
              : { backgroundColor: '#f5f0ea', color: 'var(--color-text)' }
          }
        >
          Calendar
        </button>
      </div>

      {view === 'search' ? (
        <SearchView workshops={workshops} />
      ) : (
        <CalendarView workshops={workshops} />
      )}
    </div>
  )
}
