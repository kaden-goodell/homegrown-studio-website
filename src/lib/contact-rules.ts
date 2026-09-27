/**
 * What counts as a usable name, email and phone number at checkout, and what
 * to say when one isn't. Both booking flows and their servers read this, so
 * the two can't drift.
 *
 * Client-safe: no imports, no env.
 */

export type ContactField = 'firstName' | 'lastName' | 'email' | 'phone'

export interface Contact {
  firstName: string
  lastName: string
  email: string
  phone: string
}

export const EMPTY_CONTACT: Contact = { firstName: '', lastName: '', email: '', phone: '' }

/** The order the fields appear in, which is the order problems are reported in. */
export const CONTACT_FIELDS: ContactField[] = ['firstName', 'lastName', 'email', 'phone']

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim())
}

/** Ten digits, or eleven starting with 1. Punctuation and spaces are ignored. */
export function isPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'))
}

export const CONTACT_MESSAGES = {
  firstName: 'Add your first name.',
  lastName: 'Add your last name.',
  email: 'That email doesn’t look right. Check for typos.',
  emailMissing: 'Add your email so we can send your confirmation.',
  phone: 'Add a 10-digit phone number so we can reach you on the day.',
} as const

/** What is wrong with one field, or '' when it is fine. */
export function problemWith(field: ContactField, contact: Contact, options: { phoneRequired: boolean }): string {
  const value = contact[field].trim()
  switch (field) {
    case 'firstName':
      return value ? '' : CONTACT_MESSAGES.firstName
    case 'lastName':
      return value ? '' : CONTACT_MESSAGES.lastName
    case 'email':
      if (!value) return CONTACT_MESSAGES.emailMissing
      return isEmail(value) ? '' : CONTACT_MESSAGES.email
    case 'phone':
      // Optional means optional to give. A number that is given must be usable.
      if (!value) return options.phoneRequired ? CONTACT_MESSAGES.phone : ''
      return isPhone(value) ? '' : CONTACT_MESSAGES.phone
  }
}

/** Every problem, by field. Empty when the contact is usable. */
export function contactProblems(
  contact: Contact,
  options: { phoneRequired: boolean },
): Partial<Record<ContactField, string>> {
  const found: Partial<Record<ContactField, string>> = {}
  for (const field of CONTACT_FIELDS) {
    const problem = problemWith(field, contact, options)
    if (problem) found[field] = problem
  }
  return found
}

export function contactIsUsable(contact: Contact, options: { phoneRequired: boolean }): boolean {
  return Object.keys(contactProblems(contact, options)).length === 0
}

/** Has the customer typed anything? Used to decide whether closing should ask first. */
export function contactStarted(contact: Contact): boolean {
  return CONTACT_FIELDS.some((f) => contact[f].trim() !== '')
}
