/**
 * Emails, texts and Square right now (G2): outbound-health's records plus
 * whether each one's key or password is set on this site. Server only.
 */
import { squareSettings } from '@lib/classes/square-api'
import { emailReady } from '@lib/email'
import { failingLine, healthStatus, SERVICES, type Service, type ServiceHealth } from '@lib/outbound-health'
import { quoConfigured } from '@lib/quo'

export function outboundConfigured(): Record<Service, boolean> {
  return { email: emailReady(), text: quoConfigured(), square: !!squareSettings().accessToken }
}

export async function outboundHealthNow(): Promise<Record<Service, ServiceHealth>> {
  return healthStatus(outboundConfigured())
}

/** One line per service that is failing now, for the morning email. Never throws. */
export async function failingLines(): Promise<string[]> {
  try {
    const now = await outboundHealthNow()
    return SERVICES.filter((s) => now[s].state === 'failing').map((s) => failingLine(s, now[s]))
  } catch {
    return []
  }
}
