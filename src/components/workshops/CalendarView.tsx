import { useState, useMemo } from 'react'
import WorkshopCard from './WorkshopCard'
import type { WorkshopData } from './WorkshopExplorer'

interface CalendarViewProps {
  workshops: WorkshopData[]
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function getMonthData(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  return { firstDay, daysInMonth }
}

function formatMonthYear(year: number, month: number) {
  return new Date(year, month, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

export default function CalendarView({ workshops }: CalendarViewProps) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [selectedDay, setSelectedDay] = useState<number | null>(null)

  const workshopsByDay = useMemo(() => {
    const map = new Map<number, WorkshopData[]>()
    for (const w of workshops) {
      const d = new Date(w.date + 'T00:00:00')
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate()
        if (!map.has(day)) map.set(day, [])
        map.get(day)!.push(w)
      }
    }
    return map
  }, [workshops, year, month])

  const { firstDay, daysInMonth } = getMonthData(year, month)

  function prevMonth() {
    setSelectedDay(null)
    if (month === 0) {
      setMonth(11)
      setYear(year - 1)
    } else {
      setMonth(month - 1)
    }
  }

  function nextMonth() {
    setSelectedDay(null)
    if (month === 11) {
      setMonth(0)
      setYear(year + 1)
    } else {
      setMonth(month + 1)
    }
  }

  function handleDayClick(day: number) {
    if (workshopsByDay.has(day)) {
      setSelectedDay(selectedDay === day ? null : day)
    }
  }

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const selectedWorkshops = selectedDay ? workshopsByDay.get(selectedDay) ?? [] : []

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={prevMonth}
          aria-label="Previous month"
          className="p-2 rounded-lg hover:bg-gray-100 transition"
        >
          &larr;
        </button>
        <h2 className="text-lg font-semibold">{formatMonthYear(year, month)}</h2>
        <button
          onClick={nextMonth}
          aria-label="Next month"
          className="p-2 rounded-lg hover:bg-gray-100 transition"
        >
          &rarr;
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-sm mb-1">
        {DAY_NAMES.map((d) => (
          <div key={d} className="font-medium text-gray-500 py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day === null) return <div key={`empty-${i}`} />
          const hasWorkshops = workshopsByDay.has(day)
          const isSelected = selectedDay === day
          return (
            <button
              key={day}
              onClick={() => handleDayClick(day)}
              className={`relative p-2 rounded-lg text-sm transition ${
                isSelected
                  ? 'bg-gray-900 text-white'
                  : hasWorkshops
                    ? 'hover:bg-gray-100 cursor-pointer'
                    : 'text-gray-400 cursor-default'
              }`}
            >
              {day}
              {hasWorkshops && (
                <span
                  className={`block mx-auto mt-0.5 w-1.5 h-1.5 rounded-full ${
                    isSelected ? 'bg-white' : 'bg-amber-500'
                  }`}
                />
              )}
            </button>
          )
        })}
      </div>

      {selectedDay !== null && selectedWorkshops.length > 0 && (
        <div className="mt-6">
          <h3 className="text-md font-semibold mb-3">
            Workshops on {formatMonthYear(year, month).split(' ')[0]} {selectedDay}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {selectedWorkshops.map((w) => (
              <WorkshopCard key={w.id} workshop={w} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
