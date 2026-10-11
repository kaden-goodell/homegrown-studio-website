import type { Contact } from '@lib/contact-rules'

/**
 * The name, email and phone from this visit's last booking, so a second class
 * opens with them filled in instead of typed again (Kaden, 11 Oct 2026: both
 * first families booked two classes each).
 *
 * Kept in memory only — gone on reload, never written to the browser's
 * storage, so nothing personal lingers on a shared phone.
 */
let remembered: Contact | null = null

export function rememberContact(contact: Contact): void {
  remembered = { ...contact }
}

export function rememberedContact(): Contact | null {
  return remembered ? { ...remembered } : null
}

/** Tests only. */
export function _forgetContact(): void {
  remembered = null
}
