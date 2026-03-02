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
      <div style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0.5) 100%)',
        backdropFilter: 'blur(20px) saturate(1.3)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.3)',
        border: '1px solid rgba(255, 255, 255, 0.5)',
        borderRadius: '1rem',
        padding: '1.5rem',
        boxShadow: '0 4px 16px rgba(150, 112, 91, 0.08), 0 10px 40px rgba(150, 112, 91, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.7), inset 0 -1px 0 rgba(150, 112, 91, 0.04)',
      }}>
      {/* Month nav */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '1.25rem',
      }}>
        <button
          onClick={prevMonth}
          aria-label="Previous month"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '2.25rem',
            height: '2.25rem',
            fontSize: '1.25rem',
            color: 'var(--color-muted)',
            background: 'none',
            border: 'none',
            borderRadius: '0.5rem',
            cursor: 'pointer',
            transition: 'color 0.2s ease',
          }}
        >
          &lsaquo;
        </button>
        <span style={{
          fontSize: '1rem',
          fontWeight: 600,
          fontFamily: 'var(--font-heading)',
          color: 'var(--color-dark)',
        }}>
          {formatMonthYear(year, month)}
        </span>
        <button
          onClick={nextMonth}
          aria-label="Next month"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '2.25rem',
            height: '2.25rem',
            fontSize: '1.25rem',
            color: 'var(--color-muted)',
            background: 'none',
            border: 'none',
            borderRadius: '0.5rem',
            cursor: 'pointer',
            transition: 'color 0.2s ease',
          }}
        >
          &rsaquo;
        </button>
      </div>

      {/* Day headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: '2px',
        marginBottom: '0.5rem',
      }}>
        {DAY_NAMES.map((d) => (
          <div key={d} style={{
            textAlign: 'center',
            fontSize: '0.6875rem',
            fontWeight: 500,
            letterSpacing: '0.05em',
            color: 'var(--color-muted)',
            padding: '0.25rem 0',
          }}>
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: '4px',
      }}>
        {cells.map((day, i) => {
          if (day === null) return <div key={`empty-${i}`} />
          const dayWorkshops = workshopsByDay.get(day) ?? []
          const hasWorkshops = dayWorkshops.length > 0
          const isSelected = selectedDay === day
          return (
            <button
              key={day}
              onClick={() => handleDayClick(day)}
              style={{
                width: '100%',
                minHeight: '5.5rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                padding: '0.25rem 0.3rem',
                fontSize: '0.8125rem',
                fontWeight: isSelected ? 600 : 400,
                color: isSelected
                  ? '#fff'
                  : hasWorkshops
                    ? 'var(--color-dark)'
                    : 'rgba(150, 112, 91, 0.3)',
                background: isSelected
                  ? 'linear-gradient(135deg, var(--color-primary), var(--color-accent))'
                  : 'transparent',
                border: 'none',
                borderRadius: '0.5rem',
                cursor: hasWorkshops ? 'pointer' : 'default',
                transition: 'background 0.2s ease',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => {
                if (hasWorkshops && !isSelected) {
                  e.currentTarget.style.background = 'rgba(150, 112, 91, 0.08)'
                }
              }}
              onMouseLeave={(e) => {
                if (hasWorkshops && !isSelected) {
                  e.currentTarget.style.background = 'transparent'
                }
              }}
            >
              <span style={{
                fontSize: '0.6875rem',
                fontWeight: 500,
                marginBottom: '0.125rem',
              }}>
                {day}
              </span>
              {dayWorkshops.slice(0, 2).map((w) => (
                <span
                  key={w.id}
                  style={{
                    display: 'block',
                    fontSize: '0.625rem',
                    lineHeight: 1.3,
                    fontWeight: 500,
                    color: isSelected ? 'rgba(255,255,255,0.85)' : 'var(--color-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    marginBottom: '2px',
                  }}
                >
                  {w.name}
                </span>
              ))}
              {dayWorkshops.length > 2 && (
                <span style={{
                  fontSize: '0.5625rem',
                  color: isSelected ? 'rgba(255,255,255,0.6)' : 'var(--color-muted)',
                }}>
                  +{dayWorkshops.length - 2} more
                </span>
              )}
            </button>
          )
        })}
      </div>
      </div>

      {/* Selected day workshops */}
      {selectedDay !== null && selectedWorkshops.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          <p style={{
            fontSize: '0.75rem',
            fontWeight: 500,
            letterSpacing: '0.06em',
            textTransform: 'uppercase' as const,
            color: 'var(--color-muted)',
            marginBottom: '1rem',
          }}>
            {formatMonthYear(year, month).split(' ')[0]} {selectedDay}
          </p>
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
