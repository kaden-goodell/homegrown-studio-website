/**
 * Shared TypeScript types used across the application.
 * Provider-specific types live in src/providers/interfaces/.
 */

/** Standard API route success response */
export interface ApiResponse<T> {
  data: T
}

/** Standard API route error response */
export interface ApiError {
  error: string
}

/** Workshop data assembled for the frontend (catalog + availability + capacity) */
export interface WorkshopData {
  id: string
  name: string
  description: string
  date: string
  startTime: string
  endTime: string
  duration: number
  price: number
  currency: string
  remainingSeats: number | null
  slotId: string
}

/** Customer info collected in the booking wizard */
export interface CustomerInfo {
  name: string
  email: string
  phone: string
}
