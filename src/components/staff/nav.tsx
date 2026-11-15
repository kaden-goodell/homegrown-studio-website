import { createContext, useContext } from 'react'

export type StaffTab = 'week' | 'today' | 'upcoming' | 'kits' | 'giftcards' | 'orders'

export interface StaffNav {
  active: StaffTab
  go: (tab: StaffTab) => void
  switchStaff: () => void
  logout: () => void
  /** "(2 new)" after a tab's label, when there is something new there. */
  newCounts?: Partial<Record<StaffTab, number>>
}

/** Provided by StaffConsole; the header's tabs and account menu read it. */
export const StaffNavContext = createContext<StaffNav | null>(null)
export const useStaffNav = () => useContext(StaffNavContext)

export const TABS: { id: StaffTab; label: string }[] = [
  { id: 'week', label: 'This week' },
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'kits', label: 'Kits' },
  { id: 'giftcards', label: 'Gift cards' },
  { id: 'orders', label: 'Orders' },
]

/** "Orders (2 new)", or just "Orders". */
export function tabLabel(label: string, newCount = 0): string {
  return newCount > 0 ? `${label} (${newCount} new)` : label
}
