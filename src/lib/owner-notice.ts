/**
 * Security notices to the owners, by email AND text, straight to the owners'
 * own addresses on the staff list (never through the Notifications picks,
 * which are one of the things these notices are about).
 *
 * Used when something about who can reach /admin or who gets the studio's
 * records changes: an owner added, removed or their email or mobile changed,
 * Notifications saved (M1), the admin passcode reset by the emailed link
 * (M3) or by the hosting setting (M4), a new email or text key pasted in.
 *
 * `owners` is a snapshot taken BEFORE the change, so a changed address is
 * told at the address it had (an attacker who swaps Catherine's email can't
 * hide it from her). `except` leaves out the owner who made the change, so
 * the OTHER owners hear. With nobody left to tell, or nobody with an email or
 * mobile, the site setup's owner emails and alert numbers are used, so the
 * notice always goes somewhere.
 *
 * Goes through sendEmail / sendQuoText, so a muted test site lists it under
 * More › Messages instead of sending. Never throws.
 *
 * Server only.
 */
import { siteConfig } from '@config/site.config'
import { createLogger } from '@lib/logger'

const logger = createLogger('owner-notice')

/** Long enough for one notice, short enough for one or two text segments. */
const TEXT_MAX = 300

export interface NoticeOwner { id: string | null; name: string; email: string | null; phone: string | null }

/** The active Owners on the staff list with their contacts now; null when there's no list yet (or it can't be read). Never throws. */
export async function ownersSnapshot(): Promise<NoticeOwner[] | null> {
  try {
    const { savedOwners } = await import('@lib/staff-directory')
    const people = await savedOwners()
    return people ? people.map((p) => ({ id: p.id, name: p.name, email: p.email, phone: p.phone })) : null
  } catch (err) {
    logger.warn('Owner list unreadable for a notice; the site setup gets it', { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

function setupPhones(): string[] {
  const meta: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  const raw = meta.OWNER_ALERT_NUMBERS || (typeof process !== 'undefined' ? process.env.OWNER_ALERT_NUMBERS : '') || ''
  return String(raw).split(',').map((n: string) => n.trim()).filter(Boolean)
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Where a notice goes: the owners given (minus `except`), else the site setup. Pure. */
export function noticeRecipients(owners: NoticeOwner[] | null, except?: string | null): { emails: string[]; phones: string[] } {
  const skip = (except ?? '').trim().toLowerCase()
  const others = (owners ?? []).filter((o) => !skip || o.name.trim().toLowerCase() !== skip)
  const emails = [...new Set(others.map((o) => o.email?.trim().toLowerCase()).filter((x): x is string => !!x))]
  const phones = [...new Set(others.map((o) => o.phone?.trim()).filter((x): x is string => !!x))]
  return {
    emails: emails.length ? emails : [...siteConfig.ownerEmails],
    phones: phones.length ? phones : setupPhones(),
  }
}

/**
 * Email and text the owners one notice. `line` is the whole message in plain
 * words; the text is "Hometown Studio: <line>" (cut to fit). Never throws.
 */
export async function tellOwners(input: {
  subject: string
  line: string
  /** Snapshot from before the change (ownersSnapshot()); read now when left out. */
  owners?: NoticeOwner[] | null
  /** The owner who made the change: everyone else hears. */
  except?: string | null
}): Promise<{ emails: number; texts: number }> {
  const owners = input.owners === undefined ? await ownersSnapshot() : input.owners
  const { emails, phones } = noticeRecipients(owners, input.except)
  let sentEmails = 0
  let sentTexts = 0
  try {
    if (emails.length) {
      const { sendEmail } = await import('@lib/email')
      const r = await sendEmail({ to: emails.join(', '), subject: input.subject, text: input.line, html: `<p>${esc(input.line)}</p>` })
      if (r.sent) sentEmails = emails.length
    }
  } catch (err) {
    logger.warn('Owner notice email failed', { error: err instanceof Error ? err.message : String(err) })
  }
  try {
    const { quoConfigured, sendQuoText } = await import('@lib/quo')
    if (phones.length && quoConfigured()) {
      const full = `Hometown Studio: ${input.line}`
      const text = full.length > TEXT_MAX ? `${full.slice(0, TEXT_MAX - 1)}…` : full
      const results = await Promise.allSettled(phones.map((to) => sendQuoText({ to, content: text })))
      sentTexts = results.filter((r) => r.status === 'fulfilled').length
    }
  } catch (err) {
    logger.warn('Owner notice text failed', { error: err instanceof Error ? err.message : String(err) })
  }
  logger.info('Owner notice sent', { subject: input.subject, emails: sentEmails, texts: sentTexts })
  return { emails: sentEmails, texts: sentTexts }
}

/** "Tue 3:10 PM" at the studio. */
export function studioWhen(d = new Date()): string {
  return d.toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', minute: '2-digit' })
}
