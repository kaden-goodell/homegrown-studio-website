/**
 * Is a signed agreement good for today? One rule, used by the door check
 * (/api/staff/coverage.json) and the class-day waiver reminder, so the two
 * can never disagree: not expired, and signed on the current terms (an older
 * version never agreed to the drop-off terms that came later).
 */
import { substantiveSince, compareVersions } from '@config/waiver-content'

export interface SignedAgreement {
  validUntil: string
  agreementVersion: string
}

export type AgreementState = 'current' | 'expired' | 'outdated'

export function agreementState(a: SignedAgreement, now: Date): AgreementState {
  if (compareVersions(a.agreementVersion, substantiveSince) < 0) return 'outdated'
  if (!(new Date(a.validUntil).getTime() > now.getTime())) return 'expired'
  return 'current'
}

export const isCurrent = (a: SignedAgreement, now: Date) => agreementState(a, now) === 'current'
