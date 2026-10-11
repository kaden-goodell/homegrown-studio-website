/**
 * "Someone just booked" — a text to every owner phone (OWNER_ALERT_NUMBERS)
 * and an email to every owner address (siteConfig.ownerEmails), for each paid
 * class seat and party. Kaden, 11 Oct 2026: bookings must reach Catherine too,
 * not only whoever Square happens to notify.
 *
 * Never throws: a booking is never failed by its announcement.
 */
import { siteConfig } from '@config/site.config'
import { alertOwners } from '@lib/owner-alert'
import { sendEmail } from '@lib/email'
import { formatMoney } from '@lib/money'
import { createLogger } from '@lib/logger'

const logger = createLogger('booking-alert')

export interface BookingNews {
  kind: 'class' | 'party'
  /** "Meredith Black" */
  who: string
  /** "1 seat, Bedazzled Pumpkin Pails" / "Patch & Personalize party, about 12 guests" */
  what: string
  /** "Sun, Oct 18 · 1:00 PM" */
  when: string
  paidCents: number
  email: string
  phone?: string
  /** Seat picks, a theme… one short line. */
  extra?: string
}

export function bookingNewsText(b: BookingNews): string {
  return `New ${b.kind} booking: ${b.who}, ${b.what}, ${b.when}. ${formatMoney(b.paidCents)} paid.${b.extra ? ` ${b.extra}.` : ''}`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export async function announceBooking(b: BookingNews): Promise<void> {
  try {
    await announce(b)
  } catch (err) {
    logger.error('Booking announcement failed', { error: err instanceof Error ? err.message : String(err) })
  }
}

async function announce(b: BookingNews): Promise<void> {
  const line = bookingNewsText(b)
  const contact = [b.email, b.phone].filter(Boolean).join(' · ')
  await Promise.allSettled([
    (async () => alertOwners(line))(),
    (async () => sendEmail({
      to: siteConfig.ownerEmails.join(', '),
      subject: `New ${b.kind} booking — ${b.who}, ${b.when}`,
      text: `${line}\n\n${contact}`,
      html: `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;color:#2b2420;line-height:1.5;">
  <p style="margin:0 0 8px;"><strong>${esc(b.who)}</strong> booked ${esc(b.what)}.</p>
  <p style="margin:0 0 4px;">${esc(b.when)} · ${esc(formatMoney(b.paidCents))} paid</p>
  ${b.extra ? `<p style="margin:0 0 4px;">${esc(b.extra)}</p>` : ''}
  <p style="margin:8px 0 0;color:#6f635b;">${esc(contact)}</p>
</div>`,
    }))(),
  ]).then((results) => {
    for (const r of results) if (r.status === 'rejected') logger.error('Booking announcement failed', { error: String(r.reason) })
  })
}
