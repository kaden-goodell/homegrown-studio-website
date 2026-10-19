import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { SettingsView } from '@lib/studio-settings'
import { CONFIG_STUDIO_DAYS, type StudioDays } from '@config/studio-days'
import { api, SETTINGS } from '../classes/api'
import { useRefresh } from './data'

/**
 * The studio's closed days and Craft Café hours as the owners saved them
 * (More › Hours & Craft Café, Closed days), for every /admin screen that
 * draws a closed day or the café: Home, the calendar, the day and café
 * sheets, New class's first open day. Until they load (or if they can't),
 * the config is used, which is what the site used before anything was saved.
 */
export interface StudioState {
  /** What's saved (or the config as settings); null while loading. */
  view: SettingsView | null
  days: StudioDays
  error: string
  retry: () => void
  /** A save came back: use it everywhere at once. */
  replace: (view: SettingsView) => void
}

const StudioContext = createContext<StudioState>({ view: null, days: CONFIG_STUDIO_DAYS, error: '', retry: () => {}, replace: () => {} })
export const useStudio = () => useContext(StudioContext)

export function daysOfView(v: SettingsView): StudioDays {
  return { closures: v.closures, cafe: { weekly: v.cafeWeekly, special: v.cafeSpecialDays } }
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const { version } = useRefresh()
  const [view, setView] = useState<SettingsView | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let live = true
    setError('')
    api<{ settings: SettingsView }>(SETTINGS).then((r) => {
      if (!live) return
      if (r.ok && r.data?.settings) setView(r.data.settings)
      else setError(r.error ?? 'The studio settings didn’t load.')
    })
    return () => { live = false }
  }, [version, tries])
  const replace = useCallback((v: SettingsView) => setView(v), [])
  const value = useMemo<StudioState>(() => ({
    view, error, replace,
    days: view ? daysOfView(view) : CONFIG_STUDIO_DAYS,
    retry: () => setTries((n) => n + 1),
  }), [view, error, replace])
  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>
}
