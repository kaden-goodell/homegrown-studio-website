/**
 * Staffing errors: an HTTP status and a sentence a person can act on.
 * Client-safe: no imports.
 */
export class StaffingError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'StaffingError'
  }
}

/** Someone else saved first: 409 with what is saved now, so the screen can show it. */
export class StaleError<T> extends StaffingError {
  constructor(message: string, public current: T) {
    super(409, message)
    this.name = 'StaleError'
  }
}

export const STALE_AVAILABILITY = 'Someone changed your times on another device. Here they are.'
export const STALE_ENTRY = "Someone else just changed who's on this. Here's the latest."
export const BUSY_SAVING = 'Someone else is saving at the same moment. Try again.'
export const NOT_A_PERSON = "That person isn't on the team list."
