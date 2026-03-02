import { useState, useRef, useEffect } from 'react'

interface DateRangePickerProps {
  startDate: string
  endDate: string
  onStartChange: (date: string) => void
  onEndChange: (date: string) => void
  minDate?: string
  inline?: boolean
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay()
}

function formatDisplay(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

type Picking = 'start' | 'end'

export default function DateRangePicker({
  startDate,
  endDate,
  onStartChange,
  onEndChange,
  minDate,
  inline = false,
}: DateRangePickerProps) {
  const today = minDate ?? new Date().toISOString().split('T')[0]
  const todayDate = new Date(today + 'T00:00:00')

  const [open, setOpen] = useState(inline)
  const [picking, setPicking] = useState<Picking>('start')
  const [viewYear, setViewYear] = useState(todayDate.getFullYear())
  const [viewMonth, setViewMonth] = useState(todayDate.getMonth())
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (inline) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [inline])

  function openFor(field: Picking) {
    setPicking(field)
    if (field === 'start' && startDate) {
      const d = new Date(startDate + 'T00:00:00')
      setViewYear(d.getFullYear())
      setViewMonth(d.getMonth())
    } else if (field === 'end' && endDate) {
      const d = new Date(endDate + 'T00:00:00')
      setViewYear(d.getFullYear())
      setViewMonth(d.getMonth())
    } else {
      setViewYear(todayDate.getFullYear())
      setViewMonth(todayDate.getMonth())
    }
    setOpen(true)
  }

  function prevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11)
      setViewYear(viewYear - 1)
    } else {
      setViewMonth(viewMonth - 1)
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0)
      setViewYear(viewYear + 1)
    } else {
      setViewMonth(viewMonth + 1)
    }
  }

  function selectDay(day: number) {
    const dateStr = toDateStr(viewYear, viewMonth, day)
    if (picking === 'start') {
      onStartChange(dateStr)
      if (endDate && dateStr > endDate) onEndChange(dateStr)
      setPicking('end')
    } else {
      if (dateStr < startDate) {
        onStartChange(dateStr)
        setPicking('end')
      } else {
        onEndChange(dateStr)
        if (!inline) setOpen(false)
      }
    }
  }

  function isDisabled(day: number): boolean {
    const dateStr = toDateStr(viewYear, viewMonth, day)
    return dateStr < today
  }

  function isInRange(day: number): boolean {
    if (!startDate || !endDate) return false
    const dateStr = toDateStr(viewYear, viewMonth, day)
    return dateStr > startDate && dateStr < endDate
  }

  function isStart(day: number): boolean {
    return toDateStr(viewYear, viewMonth, day) === startDate
  }

  function isEnd(day: number): boolean {
    return toDateStr(viewYear, viewMonth, day) === endDate
  }

  function isToday(day: number): boolean {
    return toDateStr(viewYear, viewMonth, day) === today
  }

  const daysInMonth = getDaysInMonth(viewYear, viewMonth)
  const firstDay = getFirstDayOfMonth(viewYear, viewMonth)
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Date fields row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ flex: '1 1 12rem' }}>
          <label style={labelStyle}>Start Date</label>
          <button
            type="button"
            onClick={() => openFor('start')}
            style={{
              ...fieldStyle,
              borderColor: open && picking === 'start' ? 'var(--color-primary)' : 'rgba(150, 112, 91, 0.12)',
              boxShadow: open && picking === 'start' ? '0 0 0 3px rgba(150, 112, 91, 0.1)' : 'none',
            }}
          >
            <span style={{ color: startDate ? 'var(--color-dark)' : 'var(--color-muted)' }}>
              {startDate ? formatDisplay(startDate) : 'Select date'}
            </span>
            <CalendarIcon />
          </button>
        </div>

        <div style={{ flex: '1 1 12rem' }}>
          <label style={labelStyle}>End Date</label>
          <button
            type="button"
            onClick={() => openFor('end')}
            style={{
              ...fieldStyle,
              borderColor: open && picking === 'end' ? 'var(--color-primary)' : 'rgba(150, 112, 91, 0.12)',
              boxShadow: open && picking === 'end' ? '0 0 0 3px rgba(150, 112, 91, 0.1)' : 'none',
            }}
          >
            <span style={{ color: endDate ? 'var(--color-dark)' : 'var(--color-muted)' }}>
              {endDate ? formatDisplay(endDate) : 'Select date'}
            </span>
            <CalendarIcon />
          </button>
        </div>
      </div>

      {/* Calendar */}
      {open && (
        <div style={inline ? {
          background: 'rgba(255, 255, 255, 0.6)',
          border: '1px solid rgba(150, 112, 91, 0.08)',
          borderRadius: '1rem',
          padding: '1.25rem',
        } : {
          position: 'absolute',
          top: '100%',
          marginTop: '0.5rem',
          left: 0,
          right: 0,
          zIndex: 20,
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(150, 112, 91, 0.1)',
          borderRadius: '1rem',
          boxShadow: '0 12px 48px rgba(150, 112, 91, 0.12)',
          padding: '1.25rem',
          animation: 'calendarIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}>
          {/* Picking indicator */}
          <div style={{
            textAlign: 'center',
            fontSize: '0.6875rem',
            fontWeight: 500,
            letterSpacing: '0.08em',
            textTransform: 'uppercase' as const,
            color: 'var(--color-primary)',
            marginBottom: '0.75rem',
            transition: 'opacity 0.3s ease',
          }}>
            Select {picking === 'start' ? 'start' : 'end'} date
          </div>

          {/* Month nav */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '1rem',
          }}>
            <button type="button" onClick={prevMonth} style={navBtnStyle} aria-label="Previous month">
              &lsaquo;
            </button>
            <span style={{
              fontSize: '0.875rem',
              fontWeight: 600,
              fontFamily: 'var(--font-heading)',
              color: 'var(--color-dark)',
            }}>
              {MONTH_NAMES[viewMonth]} {viewYear}
            </span>
            <button type="button" onClick={nextMonth} style={navBtnStyle} aria-label="Next month">
              &rsaquo;
            </button>
          </div>

          {/* Day headers */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: '2px',
            marginBottom: '0.375rem',
          }}>
            {DAY_LABELS.map((d) => (
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
            gap: '2px',
          }}>
            {/* Empty cells for offset */}
            {Array.from({ length: firstDay }, (_, i) => (
              <div key={`empty-${i}`} />
            ))}

            {days.map((day) => {
              const disabled = isDisabled(day)
              const selected = isStart(day) || isEnd(day)
              const inRange = isInRange(day)
              const todayMark = isToday(day)

              return (
                <button
                  key={day}
                  type="button"
                  disabled={disabled}
                  onClick={() => selectDay(day)}
                  style={{
                    position: 'relative',
                    width: '100%',
                    aspectRatio: '1',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.8125rem',
                    fontWeight: selected ? 600 : 400,
                    color: disabled
                      ? 'rgba(150, 112, 91, 0.25)'
                      : selected
                        ? '#fff'
                        : inRange
                          ? 'var(--color-dark)'
                          : 'var(--color-text)',
                    background: selected
                      ? 'linear-gradient(135deg, var(--color-primary), var(--color-accent))'
                      : inRange
                        ? 'rgba(150, 112, 91, 0.08)'
                        : 'transparent',
                    border: 'none',
                    borderRadius: selected ? '0.5rem' : inRange ? '0.25rem' : '0.5rem',
                    cursor: disabled ? 'default' : 'pointer',
                    transition: 'background 0.2s ease, transform 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!disabled && !selected) {
                      e.currentTarget.style.background = 'rgba(150, 112, 91, 0.1)'
                      e.currentTarget.style.transform = 'scale(1.1)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!disabled && !selected) {
                      e.currentTarget.style.background = inRange ? 'rgba(150, 112, 91, 0.08)' : 'transparent'
                      e.currentTarget.style.transform = 'none'
                    }
                  }}
                >
                  {day}
                  {todayMark && !selected && (
                    <span style={{
                      position: 'absolute',
                      bottom: '3px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: '3px',
                      height: '3px',
                      borderRadius: '50%',
                      background: 'var(--color-primary)',
                    }} />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <style>{`
        @keyframes calendarIn {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ opacity: 0.4, flexShrink: 0 }}>
      <rect x="1.5" y="3" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 6.5h13" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 1.5v3M11 1.5v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.75rem',
  fontWeight: 500,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--color-muted)',
  marginBottom: '0.375rem',
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0.75rem 1rem',
  fontSize: '0.875rem',
  background: 'rgba(255, 255, 255, 0.85)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid rgba(150, 112, 91, 0.12)',
  borderRadius: '0.75rem',
  cursor: 'pointer',
  transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
}

const navBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '2rem',
  height: '2rem',
  fontSize: '1.25rem',
  color: 'var(--color-muted)',
  background: 'none',
  border: 'none',
  borderRadius: '0.5rem',
  cursor: 'pointer',
  transition: 'color 0.2s ease, background 0.2s ease',
}
