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
      <div className="flex gap-2 mb-8">
          {(['search', 'calendar'] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className="px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-300"
              style={
                view === v
                  ? {
                      background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
                      color: 'white',
                      boxShadow: '0 4px 15px rgba(150, 112, 91, 0.2)',
                    }
                  : {
                      background: 'rgba(255, 255, 255, 0.75)',
                      backdropFilter: 'blur(12px)',
                      border: '1px solid rgba(150, 112, 91, 0.06)',
                      color: 'var(--color-text)',
                    }
              }
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
      </div>

      {view === 'search' ? (
        <SearchView workshops={workshops} />
      ) : (
        <CalendarView workshops={workshops} />
      )}
    </div>
  )
}
