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
import { messagesMuted, outboundEnv, previewText, recordMuted } from '@lib/preview-outbound'
import { noteFailure, noteOk, statusKind } from '@lib/outbound-health'
import { storedKey, storedKeyKnown } from '@lib/outbound-keys'

const logger = createLogger('quo')

const API_URL = 'https://api.quo.com/v1/messages'

function env(name: string): string {
  const meta: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  return meta[name] || (typeof process !== 'undefined' ? process.env[name] : '') || ''
}

/** Whether texts are set up (sync): the site setup's key, or one pasted in /admin that this server has already read. quoReadyNow() always reads the store. */
export function quoConfigured(): boolean {
  return (!!env('QUO_API_KEY') || storedKeyKnown('quo')) && !!env('QUO_FROM_NUMBER')
}

/** The Quo key in use: the one pasted in /admin (outbound-keys.ts), else the site setup's. */
export async function quoKey(): Promise<string> {
  return (await storedKey('quo')) ?? env('QUO_API_KEY')
}

/** Whether texts can be sent at all, counting a key pasted in /admin. */
export async function quoReadyNow(): Promise<boolean> {
  return !!env('QUO_FROM_NUMBER') && !!(await quoKey())
}

/** The studio number texts go out from (QUO_FROM_NUMBER, fixed in the site setup). */
export const quoFromNumber = () => env('QUO_FROM_NUMBER')

export const QUO_PHONE_NUMBERS_URL = 'https://api.quo.com/v1/phone-numbers'
export const QUO_MESSAGES_URL = API_URL

/** US-centric E.164 normalization: "(256) 555-0123" → "+12565550123". */
export function toE164(phone: string): string | null {
  if (phone.trim().startsWith('+')) return phone.replace(/[^+\d]/g, '')
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

/** The one-time family pickup code, texted to the signer at first child
 *  check-in and on every `reissue-code` (HOM-214). Never logged — this is
 *  the only place the plaintext code appears outside the response body. */
export const pickupCodeText = (title: string, code: string, kids: string[]): string =>
  `Hometown Studio pickup code for ${title}: ${code}. Whoever collects ${kids.join(' & ')} needs this code. Reply STOP to opt out.`

/** Pickup confirmation texted to the signer after a child is released
 *  (HOM-214) — so the parent always learns who walked out with their kid. */
export const pickedUpText = (kids: string[], by: string, when: string): string =>
  `${kids.join(' & ')} picked up by ${by} at ${when} — Hometown Studio.`

/** Send one SMS. Throws on transport/API failure; callers decide severity. */
export async function sendQuoText(input: { to: string; content: string }): Promise<void> {
  // The sandbox preview sends no texts at all: listed and logged, and the caller carries
  // on as if it went (preview-outbound.ts). Production is unchanged.
  const outEnv = outboundEnv()
  if (messagesMuted(outEnv)) {
    await recordMuted({ kind: 'text', to: input.to, body: input.content })
    return
  }
  // A preview with PREVIEW_MESSAGES=on texts Kaden only.
  input = previewText(input, outEnv)
  const to = toE164(input.to)
  if (!to) throw new Error(`Unparseable phone number: ${input.to}`)

  let res: Response
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: await quoKey() },
      body: JSON.stringify({ content: input.content, from: env('QUO_FROM_NUMBER'), to: [to] }),
    })
  } catch (err) {
    await noteFailure('text', 'other') // Home warns when texts stop (G2)
    throw err
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    logger.error('Quo send failed', { status: res.status, body: body.slice(0, 300) })
    // A 400 about one number (opted out, landline) isn't the service failing.
    if (res.status === 401 || res.status === 403 || res.status === 402 || res.status >= 500) await noteFailure('text', statusKind(res.status === 402 ? 401 : res.status))
    throw new Error(`Quo API ${res.status}`)
  }
  await noteOk('text')
  logger.info('Quo text sent', { to })
}
