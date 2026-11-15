import { useState } from 'react'
import { closureOn } from '@config/closures'
import { CLOSED_HATCH, HOLIDAY_STRIPES, monthNavStyle } from '@components/calendar/calendar-styles'

/**
 * One month of party dates, Monday first (weeknights sit together on the
 * left). Only `openDates` can be tapped; `bookedDates` show struck through;
 * closed days wear the What's On calendar's closed look; every other day is
 * faded. Paging runs from this month to the last month of the booking window.
 *
 * Mount it with a `key` of the party kind: a new kind opens on its own first
 * open month.
 */
interface Props {
  /** Open dates of the chosen kind, studio-local YYYY-MM-DD. */
  openDates: string[]
  /** Fully booked dates of the chosen kind. */
  bookedDates: string[]
  selected: string
  onSelect: (ymd: string) => void
  /** Studio-local today and the last bookable date (YYYY-MM-DD). */
  today: string
  lastDate: string
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

const monthOf = (ymd: string) => ymd.slice(0, 7)
const pad = (n: number) => String(n).padStart(2, '0')

function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** "Wednesday, December 9, 2026" */
export function fullDateLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export default function PartyDateCalendar({ openDates, bookedDates, selected, onSelect, today, lastDate }: Props) {
  const firstMonth = monthOf(today)
  const lastMonth = monthOf(lastDate)
  const startMonth = selected ? monthOf(selected) : openDates.length ? monthOf([...openDates].sort()[0]) : firstMonth
  const [month, setMonth] = useState(startMonth < firstMonth ? firstMonth : startMonth > lastMonth ? lastMonth : startMonth)

  const atFirst = month <= firstMonth
  const atLast = month >= lastMonth
  const [y, m] = month.split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  // Monday = 0 … Sunday = 6.
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7
  const open = new Set(openDates)
  const booked = new Set(bookedDates)

  const cells: (string | null)[] = [...Array(lead).fill(null)]
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${month}-${pad(d)}`)
  while (cells.length % 7 !== 0) cells.push(null)

  const cellBase = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    minHeight: '2.75rem',
    padding: 0,
    borderRadius: '0.625rem',
    fontFamily: 'inherit',
    fontSize: '0.9375rem',
    fontVariantNumeric: 'tabular-nums',
  } as const

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <button type="button" aria-label="Previous month" disabled={atFirst} onClick={() => setMonth(shiftMonth(month, -1))} style={monthNavStyle(atFirst)}>
          <span aria-hidden="true">&lsaquo;</span>
        </button>
        <p aria-live="polite" style={{ margin: 0, fontSize: '1.0625rem', fontWeight: 600, fontFamily: 'var(--font-heading)', color: 'var(--color-dark)' }}>
          {monthLabel(month)}
        </p>
        <button type="button" aria-label="Next month" disabled={atLast} onClick={() => setMonth(shiftMonth(month, 1))} style={monthNavStyle(atLast)}>
          <span aria-hidden="true">&rsaquo;</span>
        </button>
      </div>

      <div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '0.25rem', marginBottom: '0.25rem' }}>
        {WEEKDAYS.map((d) => (
          <span key={d} style={{ textAlign: 'center', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--color-text)' }}>
            {d}
          </span>
        ))}
      </div>

      <div role="group" aria-label={`Dates in ${monthLabel(month)}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '0.25rem' }}>
        {cells.map((ymd, i) => {
          if (!ymd) return <span key={`pad-${i}`} />
          const day = Number(ymd.slice(8))
          const label = fullDateLabel(ymd)
          if (open.has(ymd)) {
            const active = selected === ymd
            return (
              <button
                key={ymd}
                type="button"
                aria-pressed={active}
                aria-label={label}
                onClick={() => onSelect(ymd)}
                style={{
                  ...cellBase,
                  border: active ? '2px solid var(--color-primary)' : '1.5px solid var(--color-field-border)',
                  background: active ? 'var(--color-primary)' : 'var(--color-surface)',
                  fontWeight: 700,
                  color: active ? '#fff' : 'var(--color-dark)',
                  cursor: 'pointer',
                }}
              >
                {day}
              </button>
            )
          }
          const closure = closureOn(ymd)
          if (closure) {
            return (
              <span
                key={ymd}
                role="img"
                aria-label={`${label}, closed for ${closure.name}`}
                style={{
                  ...cellBase,
                  backgroundImage: closure.holiday ? HOLIDAY_STRIPES[closure.holiday] : CLOSED_HATCH,
                  color: 'var(--color-text)',
                  opacity: 0.75,
                }}
              >
                {day}
              </span>
            )
          }
          if (booked.has(ymd)) {
            return (
              <button
                key={ymd}
                type="button"
                disabled
                aria-label={`${label}, booked`}
                style={{
                  ...cellBase,
                  border: '1.5px solid var(--color-line)',
                  background: 'var(--color-sand)',
                  color: 'var(--color-text)',
                  textDecoration: 'line-through',
                  opacity: 0.6,
                  cursor: 'default',
                }}
              >
                {day}
              </button>
            )
          }
          return (
            <span key={ymd} aria-hidden="true" style={{ ...cellBase, color: 'var(--color-text)', opacity: 0.35 }}>
              {day}
            </span>
          )
        })}
      </div>
    </div>
  )
}
