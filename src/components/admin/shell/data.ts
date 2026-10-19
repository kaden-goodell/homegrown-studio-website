import { createContext, useContext, useEffect, useState } from 'react'
import type { CalendarItem } from '@pages/api/admin/classes/calendar.json'
import { api, CALENDAR } from '../classes/api'
import { dayStartIso } from '../classes/dates'

/**
 * A number that goes up whenever something on /admin changed (a class added,
 * a block removed), so every list on screen loads again.
 */
export const RefreshContext = createContext<{ version: number; bump: () => void }>({ version: 0, bump: () => {} })
export const useRefresh = () => useContext(RefreshContext)

/** Everything holding the room from `from` up to (not including) `to`, both studio days. Loads on its own. */
export function useCalendar(from: string, to: string) {
  const { version } = useRefresh()
  const [items, setItems] = useState<CalendarItem[] | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let live = true
    setError('')
    setItems(null)
    const q = new URLSearchParams({ from: dayStartIso(from), to: dayStartIso(to) })
    api<{ items: CalendarItem[] }>(`${CALENDAR}?${q}`).then((r) => {
      if (!live) return
      if (r.ok && r.data) setItems(r.data.items)
      else setError(r.error ?? '')
    })
    return () => { live = false }
  }, [from, to, version, tries])
  return { items, error, retry: () => setTries((n) => n + 1) }
}

/** What the shell knows that a tab may need: a side panel is open beside it, and which sheet (its address token). */
export const ShellContext = createContext<{ paneled: boolean; activeToken: string | null }>({ paneled: false, activeToken: null })
export const useShell = () => useContext(ShellContext)
