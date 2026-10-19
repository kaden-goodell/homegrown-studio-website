import { createContext, useContext } from 'react'

export type StaffTab = 'week' | 'today' | 'upcoming' | 'calendar' | 'kits' | 'giftcards'

export interface StaffNav {
  active: StaffTab
  go: (tab: StaffTab) => void
  switchStaff: () => void
  logout: () => void
}

/** Provided by StaffConsole; the header's tabs and account menu read it. */
export const StaffNavContext = createContext<StaffNav | null>(null)
export const useStaffNav = () => useContext(StaffNavContext)

export const TABS: { id: StaffTab; label: string }[] = [
  { id: 'week', label: 'This week' },
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'kits', label: 'Kits' },
  { id: 'giftcards', label: 'Gift cards' },
]
