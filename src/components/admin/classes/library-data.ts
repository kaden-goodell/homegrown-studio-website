import { useEffect, useState } from 'react'
import type { LibraryRun } from '@lib/classes/admin-actions'
import type { LibraryClass } from '@lib/classes/types'
import { useRefresh } from '../shell/data'
import { api, LIBRARY } from './api'

/** The class library (archived ones too, when asked) and when each last ran. Loads on its own; reloads after any change. */
export function useLibraryList(includeArchived = false) {
  const { version } = useRefresh()
  const [list, setList] = useState<LibraryClass[] | null>(null)
  const [runs, setRuns] = useState<Record<string, LibraryRun>>({})
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let live = true
    setError('')
    api<{ library: LibraryClass[]; runs?: Record<string, LibraryRun> }>(`${LIBRARY}${includeArchived ? '?archived=1' : ''}`).then((r) => {
      if (!live) return
      if (r.ok && r.data) { setList(r.data.library); setRuns(r.data.runs ?? {}) } else setError(r.error ?? '')
    })
    return () => { live = false }
  }, [includeArchived, version, tries])
  return { list, runs, error, retry: () => setTries((n) => n + 1) }
}
