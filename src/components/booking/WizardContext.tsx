import { createContext, useContext, useReducer, type ReactNode } from 'react'
import type { EventTypeConfig } from '@config/site.config'
import type { TimeSlot } from '@providers/interfaces/booking'
import type { Discount } from '@providers/interfaces/payment'

export interface WizardState {
  currentStep: number
  eventType: EventTypeConfig | null
  selectedDates: { start: string; end: string } | null
  desiredDuration: number | null
  selectedSlot: TimeSlot | null
  guestCount: number
  selectedAddOns: string[]
  specialRequests: string
  customerInfo: { name: string; email: string; phone: string } | null
  couponCode: string | null
  appliedDiscount: Discount | null
  orderId: string | null
  bookingId: string | null
  paymentStatus: 'idle' | 'processing' | 'completed' | 'failed'
  error: string | null
}

export type WizardAction =
  | { type: 'SET_EVENT_TYPE'; payload: EventTypeConfig }
  | { type: 'SET_DATES'; payload: { start: string; end: string } }
  | { type: 'SET_SLOT'; payload: TimeSlot }
  | { type: 'SET_GUEST_COUNT'; payload: number }
  | { type: 'TOGGLE_ADDON'; payload: string }
  | { type: 'SET_DESIRED_DURATION'; payload: number }
  | { type: 'SET_SPECIAL_REQUESTS'; payload: string }
  | { type: 'SET_CUSTOMER_INFO'; payload: { name: string; email: string; phone: string } }
  | { type: 'APPLY_COUPON'; payload: { code: string; discount: Discount } }
  | { type: 'SET_ORDER_ID'; payload: string }
  | { type: 'SET_BOOKING_ID'; payload: string }
  | { type: 'SET_PAYMENT_STATUS'; payload: 'idle' | 'processing' | 'completed' | 'failed' }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'GO_TO_STEP'; payload: number }
  | { type: 'RESET' }

export const initialState: WizardState = {
  currentStep: 0,
  eventType: null,
  selectedDates: null,
  desiredDuration: null,
  selectedSlot: null,
  guestCount: 1,
  selectedAddOns: [],
  specialRequests: '',
  customerInfo: null,
  couponCode: null,
  appliedDiscount: null,
  orderId: null,
  bookingId: null,
  paymentStatus: 'idle',
  error: null,
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'SET_EVENT_TYPE':
      return { ...state, eventType: action.payload, currentStep: 1, guestCount: action.payload.baseCapacity ?? 1 }
    case 'SET_DATES':
      return { ...state, selectedDates: action.payload }
    case 'SET_SLOT':
      return { ...state, selectedSlot: action.payload }
    case 'SET_GUEST_COUNT':
      return { ...state, guestCount: action.payload }
    case 'TOGGLE_ADDON': {
      const id = action.payload
      const has = state.selectedAddOns.includes(id)
      return {
        ...state,
        selectedAddOns: has
          ? state.selectedAddOns.filter((a) => a !== id)
          : [...state.selectedAddOns, id],
      }
    }
    case 'SET_DESIRED_DURATION':
      return { ...state, desiredDuration: action.payload }
    case 'SET_SPECIAL_REQUESTS':
      return { ...state, specialRequests: action.payload }
    case 'SET_CUSTOMER_INFO':
      return { ...state, customerInfo: action.payload }
    case 'APPLY_COUPON':
      return { ...state, couponCode: action.payload.code, appliedDiscount: action.payload.discount }
    case 'SET_ORDER_ID':
      return { ...state, orderId: action.payload }
    case 'SET_BOOKING_ID':
      return { ...state, bookingId: action.payload }
    case 'SET_PAYMENT_STATUS':
      return { ...state, paymentStatus: action.payload }
    case 'SET_ERROR':
      return { ...state, error: action.payload }
    case 'GO_TO_STEP':
      return { ...state, currentStep: action.payload }
    case 'RESET':
      return initialState
    default:
      return state
  }
}

interface WizardContextValue {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>
}

const WizardContext = createContext<WizardContextValue | null>(null)

export function WizardProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(wizardReducer, initialState)
  return <WizardContext.Provider value={{ state, dispatch }}>{children}</WizardContext.Provider>
}

export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext)
  if (!ctx) throw new Error('useWizard must be used within a WizardProvider')
  return ctx
}
