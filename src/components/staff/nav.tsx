import { createContext, useContext } from 'react'
import { siteConfig } from '@config/site.config'

export type StaffTab = 'week' | 'today' | 'upcoming' | 'calendar' | 'shifts' | 'kits' | 'giftcards'

/**
 * A screen with unsaved work (My shifts › When I can work) registers one of
 * these; leaving it (a tab, a roster, Switch person, Log out) then asks in
 * the app first: Save / Leave without saving / Stay. Never a browser pop-up.
 */
export interface LeaveGuard {
  dirty: () => boolean
  /** true when saved (then the move goes ahead) */
  save: () => Promise<boolean>
  discard: () => void
}

export interface StaffNav {
  active: StaffTab
  go: (tab: StaffTab) => void
  switchStaff: () => void
  logout: () => void
  /** StaffConsole provides it; optional so a screen works without the console (tests, previews). */
  setLeaveGuard?: (guard: LeaveGuard | null) => void
}

/** Provided by StaffConsole; the header's tabs and account menu read it. */
export const StaffNavContext = createContext<StaffNav | null>(null)
export const useStaffNav = () => useContext(StaffNavContext)

export const TABS: { id: StaffTab; label: string }[] = [
  { id: 'week', label: 'This week' },
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'shifts', label: 'My shifts' },
  { id: 'kits', label: 'Kits' },
  { id: 'giftcards', label: 'Gift cards' },
]

/** The tabs to show: Kits only while take-home kits are on (site config), or when you're already on it. */
export function visibleTabs(active: StaffTab | undefined, kitsOn: boolean = siteConfig.features.kits.enabled): typeof TABS {
  return TABS.filter((t) => t.id !== 'kits' || kitsOn || active === 'kits')
}
