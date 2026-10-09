import { createContext, useContext } from 'react'

export type StaffTab = 'today' | 'parties' | 'kits' | 'giftcards'

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
  { id: 'today', label: 'Today' },
  { id: 'parties', label: 'Parties' },
  { id: 'kits', label: 'Kits' },
  { id: 'giftcards', label: 'Gift cards' },
]
