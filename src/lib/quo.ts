/**
 * Quo (formerly OpenPhone) SMS — sends texts FROM the business number
 * (256) 464-1710 so customers see the number they already know, not a staff
 * member's personal cell.
 *
 * Env: QUO_API_KEY (workspace Owner/Admin creates it in Quo settings) and
 * QUO_FROM_NUMBER (E.164, e.g. +12564641710). Unconfigured → callers get a
 * clear "not configured" so the staff UI can say "text manually for now".
 * Messages bill ~$0.01/segment from Quo prepaid credits.
 */
import { createLogger } from '@lib/logger'

const logger = createLogger('quo')

const API_URL = 'https://api.quo.com/v1/messages'

function env(name: string): string {
  const meta: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  return meta[name] || (typeof process !== 'undefined' ? process.env[name] : '') || ''
}

export function quoConfigured(): boolean {
  return !!env('QUO_API_KEY') && !!env('QUO_FROM_NUMBER')
}

/** US-centric E.164 normalization: "(256) 555-0123" → "+12565550123". */
export function toE164(phone: string): string | null {
  if (phone.trim().startsWith('+')) return phone.replace(/[^+\d]/g, '')
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

/** Send one SMS. Throws on transport/API failure; callers decide severity. */
export async function sendQuoText(input: { to: string; content: string }): Promise<void> {
  const to = toE164(input.to)
  if (!to) throw new Error(`Unparseable phone number: ${input.to}`)

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: env('QUO_API_KEY') },
    body: JSON.stringify({ content: input.content, from: env('QUO_FROM_NUMBER'), to: [to] }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    logger.error('Quo send failed', { status: res.status, body: body.slice(0, 300) })
    throw new Error(`Quo API ${res.status}`)
  }
  logger.info('Quo text sent', { to })
}
