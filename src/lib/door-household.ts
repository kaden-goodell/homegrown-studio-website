/**
 * One household as the door search shows it (the staff `HouseholdMatch`):
 * GOOD TO GO / EXPIRED / sign again, kids with real allergies only, and
 * whether they're already at Craft Café today. Shared by the door search
 * (coverage.json) and the Craft Café sheet's "They've signed" rows.
 */
import { hasAllergy } from '@lib/allergy'
import type { HouseholdOnFile } from '@lib/waiver-store'
import type { OpenStudioDay } from '@lib/open-studio-store'
import { agreementState, isCurrent } from '@lib/waiver-coverage'

/** "••• 0142" (phone last-4) or the email if there's no phone — a
 *  disambiguator for the multi-match picker when a last-name search returns
 *  two different households that happen to share a full name. */
export function contactHint(h: Pick<HouseholdOnFile, 'phone' | 'email'>): string {
  const digits = h.phone.replace(/\D/g, '')
  if (digits.length >= 4) return `••• ${digits.slice(-4)}`
  return h.email || ''
}

export function householdMatchOf(h: HouseholdOnFile, cafeToday: OpenStudioDay, now: Date) {
  return {
    recordId: h.recordId,
    firstName: h.firstName,
    lastName: h.lastName,
    contactHint: contactHint(h),
    signedAt: h.signedAt,
    agreementVersion: h.agreementVersion,
    validUntil: h.validUntil,
    // An unexpired signature older than the current agreement is NOT covered:
    // they never agreed to the current terms (drop-off terms live in v3+).
    outdated: agreementState(h, now) === 'outdated',
    covered: isCurrent(h, now),
    // "None"/"n/a" are not allergies — the door flags only real ones.
    kids: h.minors.map((m) => ({ name: m.name, allergies: hasAllergy(m.allergies) ? m.allergies : '' })),
    adultAllergies: hasAllergy(h.adultAllergies) ? h.adultAllergies : '',
    photoConsent: h.photoConsent,
    openStudioToday: !!cafeToday[h.recordId],
    openStudioAt: cafeToday[h.recordId]?.at ?? null,
  }
}
