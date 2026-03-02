import { createContext, useContext, useReducer, type ReactNode } from 'react'
import type { ProgramConfig, ProgramSessionConfig } from '@config/site.config'
import type { Discount } from '@providers/interfaces/payment'

export interface ChildInfo {
  firstName: string
  lastName: string
  age: string
  allergies: string
  medicalNotes: string
  emergencyContactName: string
  emergencyContactPhone: string
  authorizedPickup: string
}

export interface EnrollmentState {
  currentStep: number
  program: ProgramConfig
  selectedSessions: ProgramSessionConfig[]
  headcount: number
  children: ChildInfo[]
  parentInfo: { firstName: string; lastName: string; email: string; phone: string } | null
  couponCode: string | null
  appliedDiscount: Discount | null
  orderId: string | null
  paymentStatus: 'idle' | 'processing' | 'completed' | 'failed'
  error: string | null
}

export type EnrollmentAction =
  | { type: 'SET_SESSIONS'; payload: ProgramSessionConfig[] }
  | { type: 'SET_HEADCOUNT'; payload: number }
  | { type: 'SET_CHILD_INFO'; payload: { index: number; info: ChildInfo } }
  | { type: 'SET_PARENT_INFO'; payload: { firstName: string; lastName: string; email: string; phone: string } }
  | { type: 'APPLY_COUPON'; payload: { code: string; discount: Discount } }
  | { type: 'SET_ORDER_ID'; payload: string }
  | { type: 'SET_PAYMENT_STATUS'; payload: 'idle' | 'processing' | 'completed' | 'failed' }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'GO_TO_STEP'; payload: number }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'RESET' }

export function createInitialState(program: ProgramConfig): EnrollmentState {
  return {
    currentStep: 0,
    program,
    selectedSessions: program.enrollmentType === 'full' ? [...program.sessions] : [],
    headcount: 1,
    children: [emptyChild()],
    parentInfo: null,
    couponCode: null,
    appliedDiscount: null,
    orderId: null,
    paymentStatus: 'idle',
    error: null,
  }
}

export function emptyChild(): ChildInfo {
  return {
    firstName: '',
    lastName: '',
    age: '',
    allergies: '',
    medicalNotes: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    authorizedPickup: '',
  }
}

export function enrollmentReducer(state: EnrollmentState, action: EnrollmentAction): EnrollmentState {
  switch (action.type) {
    case 'SET_SESSIONS':
      return { ...state, selectedSessions: action.payload }
    case 'SET_HEADCOUNT': {
      const count = action.payload
      const children = [...state.children]
      while (children.length < count) children.push(emptyChild())
      while (children.length > count) children.pop()
      return { ...state, headcount: count, children }
    }
    case 'SET_CHILD_INFO': {
      const children = [...state.children]
      children[action.payload.index] = action.payload.info
      return { ...state, children }
    }
    case 'SET_PARENT_INFO':
      return { ...state, parentInfo: action.payload }
    case 'APPLY_COUPON':
      return { ...state, couponCode: action.payload.code, appliedDiscount: action.payload.discount }
    case 'SET_ORDER_ID':
      return { ...state, orderId: action.payload }
    case 'SET_PAYMENT_STATUS':
      return { ...state, paymentStatus: action.payload }
    case 'SET_ERROR':
      return { ...state, error: action.payload }
    case 'GO_TO_STEP':
      return { ...state, currentStep: action.payload }
    case 'NEXT_STEP':
      return { ...state, currentStep: state.currentStep + 1 }
    case 'PREV_STEP':
      return { ...state, currentStep: Math.max(0, state.currentStep - 1) }
    case 'RESET':
      return createInitialState(state.program)
    default:
      return state
  }
}

interface EnrollmentContextValue {
  state: EnrollmentState
  dispatch: React.Dispatch<EnrollmentAction>
}

const EnrollmentContext = createContext<EnrollmentContextValue | null>(null)

export function EnrollmentProvider({ program, children }: { program: ProgramConfig; children: ReactNode }) {
  const [state, dispatch] = useReducer(enrollmentReducer, createInitialState(program))
  return <EnrollmentContext.Provider value={{ state, dispatch }}>{children}</EnrollmentContext.Provider>
}

export function useEnrollment(): EnrollmentContextValue {
  const ctx = useContext(EnrollmentContext)
  if (!ctx) throw new Error('useEnrollment must be used within an EnrollmentProvider')
  return ctx
}
