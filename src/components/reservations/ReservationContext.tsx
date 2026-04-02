import { createContext, useContext, useReducer } from 'react'
import type { ReactNode } from 'react'

export interface ServiceInfoVariation {
  id: string
  name: string
  version: number
  priceCents: number
  durationMinutes: number
}

export interface ServiceInfoModifier {
  id: string
  name: string
  priceCents: number
}

export interface ServiceInfo {
  service: { id: string; name: string }
  variations: ServiceInfoVariation[]
  modifiers: ServiceInfoModifier[]
  teamMemberId: string
}

export interface ReservationState {
  step: number
  // Service info (from Square catalog)
  serviceInfo: ServiceInfo | null
  selectedVariation: ServiceInfoVariation | null
  // Date step
  date: string | null                  // 'YYYY-MM-DD'
  // Time step
  startTime: string | null             // ISO 8601 from availability endpoint
  durationMinutes: number              // from the selected slot
  tablesAvailable: number              // how many tables free at this slot
  partyTableAvailable: boolean
  dedicatedHostAvailable: boolean
  // Options step
  tableCount: number                   // 1–6
  wholeStudio: boolean
  partyTable: boolean
  dedicatedHost: boolean
  depositPerTableCents: number         // price from Square catalog
  partyTablePriceCents: number         // price from Square catalog
  dedicatedHostPriceCents: number      // price from Square catalog
  // Contact step
  customer: {
    firstName: string
    lastName: string
    email: string
    phone: string
  }
  // Result (after booking)
  bookingIds: string[]
  orderId: string | null
  receiptUrl: string | null
  giftCardId: string | null
  craftCreditCents: number
  totalCharged: number
}

export type ReservationAction =
  | { type: 'SET_SERVICE_INFO'; serviceInfo: ServiceInfo }
  | { type: 'SET_VARIATION'; variation: ServiceInfoVariation }
  | { type: 'SET_DATE'; date: string }
  | { type: 'SET_TIME_SLOT'; startTime: string; durationMinutes: number; tablesAvailable: number; partyTableAvailable: boolean; dedicatedHostAvailable: boolean }
  | { type: 'SET_PRICES'; depositPerTableCents: number; partyTablePriceCents: number; dedicatedHostPriceCents: number }
  | { type: 'SET_OPTIONS'; tableCount: number; wholeStudio: boolean; partyTable: boolean; dedicatedHost: boolean }
  | { type: 'SET_CUSTOMER'; customer: ReservationState['customer'] }
  | { type: 'SET_RESULT'; bookingIds: string[]; orderId: string; receiptUrl: string | null; giftCardId: string | null; craftCreditCents: number; totalCharged: number }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'RESET' }

export const initialState: ReservationState = {
  step: 0,
  serviceInfo: null,
  selectedVariation: null,
  date: null,
  startTime: null,
  durationMinutes: 0,
  tablesAvailable: 0,
  partyTableAvailable: false,
  dedicatedHostAvailable: false,
  tableCount: 1,
  wholeStudio: false,
  partyTable: false,
  dedicatedHost: false,
  depositPerTableCents: 0,
  partyTablePriceCents: 0,
  dedicatedHostPriceCents: 0,
  customer: {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
  },
  bookingIds: [],
  orderId: null,
  receiptUrl: null,
  giftCardId: null,
  craftCreditCents: 0,
  totalCharged: 0,
}

export function reservationReducer(state: ReservationState, action: ReservationAction): ReservationState {
  switch (action.type) {
    case 'SET_SERVICE_INFO':
      return { ...state, serviceInfo: action.serviceInfo }
    case 'SET_VARIATION':
      return {
        ...state,
        selectedVariation: action.variation,
        // Changing duration invalidates selected time slot
        startTime: null,
        durationMinutes: 0,
        tablesAvailable: 0,
        partyTableAvailable: false,
        dedicatedHostAvailable: false,
      }
    case 'SET_DATE':
      return {
        ...state,
        date: action.date,
        // Changing date invalidates the selected time slot
        startTime: null,
        durationMinutes: 0,
        tablesAvailable: 0,
        partyTableAvailable: false,
        dedicatedHostAvailable: false,
      }
    case 'SET_TIME_SLOT':
      return {
        ...state,
        startTime: action.startTime,
        durationMinutes: action.durationMinutes,
        tablesAvailable: action.tablesAvailable,
        partyTableAvailable: action.partyTableAvailable,
        dedicatedHostAvailable: action.dedicatedHostAvailable,
        // Changing time slot resets options
        tableCount: 1,
        wholeStudio: false,
        partyTable: false,
        dedicatedHost: false,
      }
    case 'SET_PRICES':
      return {
        ...state,
        depositPerTableCents: action.depositPerTableCents,
        partyTablePriceCents: action.partyTablePriceCents,
        dedicatedHostPriceCents: action.dedicatedHostPriceCents,
      }
    case 'SET_OPTIONS':
      return {
        ...state,
        tableCount: action.tableCount,
        wholeStudio: action.wholeStudio,
        partyTable: action.partyTable,
        dedicatedHost: action.dedicatedHost,
      }
    case 'SET_CUSTOMER':
      return { ...state, customer: action.customer }
    case 'SET_RESULT':
      return {
        ...state,
        bookingIds: action.bookingIds,
        orderId: action.orderId,
        receiptUrl: action.receiptUrl,
        giftCardId: action.giftCardId,
        craftCreditCents: action.craftCreditCents,
        totalCharged: action.totalCharged,
      }
    case 'NEXT_STEP':
      return { ...state, step: state.step + 1 }
    case 'PREV_STEP':
      return { ...state, step: Math.max(0, state.step - 1) }
    case 'RESET':
      return initialState
    default:
      return state
  }
}

interface ReservationContextValue {
  state: ReservationState
  dispatch: React.Dispatch<ReservationAction>
}

const ReservationContext = createContext<ReservationContextValue | null>(null)

export function ReservationProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reservationReducer, initialState)
  return <ReservationContext.Provider value={{ state, dispatch }}>{children}</ReservationContext.Provider>
}

export function useReservation(): ReservationContextValue {
  const ctx = useContext(ReservationContext)
  if (!ctx) throw new Error('useReservation must be used within a ReservationProvider')
  return ctx
}
