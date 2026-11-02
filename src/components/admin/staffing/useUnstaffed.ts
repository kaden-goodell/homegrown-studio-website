import { useEffect, useState } from 'react'
import { api } from '../classes/api'
import { useRefresh } from '../shell/data'
import { addDays, dayStartIso, today } from '../classes/dates'

export const STAFFING = '/api/admin/staffing.json'

/** OWNER-6: the window Home's "Need someone on" counts (today and the next 13 studio days). */
export const HOME_STAFF_DAYS = 14

interface BoardRow { event: { status: string; endIso: string }; state: string; needed: number }

/** How many classes and parties in the next two weeks still need someone on (null while loading). */
export function countUnstaffed(rows: BoardRow[], now = Date.now()): number {
  return rows.filter((r) => r.event.status === 'on' && Date.parse(r.event.endIso) > now && r.needed > 0 && r.state !== 'staffed').length
}

export function useUnstaffed(): { count: number | null; error: string } {
  const { version } = useRefresh()
  const [count, setCount] = useState<number | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setCount(null)
    setError('')
    const q = new URLSearchParams({ from: new Date().toISOString(), to: dayStartIso(addDays(today(), HOME_STAFF_DAYS)) })
    api<{ rows: BoardRow[] }>(`${STAFFING}?${q}`).then((r) => {
      if (!live) return
      if (r.ok && r.data) setCount(countUnstaffed(r.data.rows))
      else setError(r.error ?? 'Couldn’t check staffing.')
    })
    return () => { live = false }
  }, [version])
  return { count, error }
}
