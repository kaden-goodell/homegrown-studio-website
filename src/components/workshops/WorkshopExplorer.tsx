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
              ? 'bg-gray-900 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Search
        </button>
        <button
          onClick={() => setView('calendar')}
          className={`px-4 py-2 rounded-lg font-medium transition ${
            view === 'calendar'
              ? 'bg-gray-900 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
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
