/**
 * Transactional email via Gmail SMTP. Gated on GMAIL_USER + GMAIL_APP_PASSWORD
 * (Google account → Security → 2-Step Verification → App passwords). When
 * unset, sends are skipped and callers get { sent: false } — the UI must not
 * promise an email it can't verify was attempted.
 */
import { createLogger } from '@lib/logger'
import { siteConfig } from '@config/site.config'
import { partyInviteMailto, partyInviteIcsUrl } from '@lib/party-share'

const logger = createLogger('email')

function creds() {
  const env: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  const user = env.GMAIL_USER || process.env.GMAIL_USER || ''
  const pass = env.GMAIL_APP_PASSWORD || process.env.GMAIL_APP_PASSWORD || ''
  return user && pass ? { user, pass } : null
}

let _transport: any = null

export async function sendEmail(input: {
  to: string; subject: string; html: string; text: string
  attachments?: { filename: string; content: string; contentType: string }[]
}): Promise<{ sent: boolean }> {
  const c = creds()
  if (!c) {
    logger.warn('Email not configured — skipping send', { subject: input.subject })
    return { sent: false }
  }
  try {
    if (!_transport) {
      const nm = await import('nodemailer')
      _transport = (nm.default ?? nm).createTransport({
        host: 'smtp.gmail.com', port: 465, secure: true,
        auth: { user: c.user, pass: c.pass },
      })
    }
    await _transport.sendMail({
      from: `"${siteConfig.email.fromName}" <${c.user}>`,
      to: input.to, subject: input.subject, html: input.html, text: input.text,
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    })
    return { sent: true }
  } catch (err) {
    logger.error('Email send failed', { error: err instanceof Error ? err.message : String(err) })
    return { sent: false }
  }
}

export async function sendPartyConfirmationEmail(input: {
  to: string; hostName: string; craftName: string; craftDescription?: string; craftImageUrl?: string; slotLabel: string
  /** Per-person craft price in cents; max set when the craft has a price range. */
  perHeadCents?: number; perHeadMaxCents?: number
  hostPageUrl: string; inviteUrl: string; totalChargedCents: number; receiptUrl: string | null
  /** Add-to-calendar: a Google Calendar link for the body + ICS content attached for Apple/Outlook. */
  googleCalendarUrl?: string; icsContent?: string
  /** Booking id — shown as a footer reference (also keeps repeated test emails from Gmail-trimming). */
  bookingRef?: string
}): Promise<{ sent: boolean }> {
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`
  const fee = dollars(input.totalChargedCents)
  // "$25" or "$30–$40" per person, matching the booking modal's label.
  const perPerson = input.perHeadCents
    ? input.perHeadMaxCents && input.perHeadMaxCents > input.perHeadCents
      ? `${dollars(input.perHeadCents)}–${dollars(input.perHeadMaxCents)}`
      : dollars(input.perHeadCents)
    : ''
  // Craft description: keep the guest's paragraph breaks, drop stray CRs.
  const description = (input.craftDescription ?? '').replace(/\r/g, '').trim()
  const costLine = perPerson
    ? `Studio fee paid today: ${fee}. ${input.craftName} is ${perPerson} per person, paid at the studio for whoever crafts.`
    : `Studio fee paid today: ${fee}. Crafts are paid at the studio based on who comes.`
  const text = [
    `You're booked! ${input.craftName} · ${input.slotLabel}`,
    ``,
    ...(description ? [`About your craft:`, ...description.split('\n'), ``] : []),
    costLine,
    ``,
    `Your party page (manage details + see who's RSVP'd — keep this link):`,
    input.hostPageUrl,
    ``,
    `Invitation link to share with your guests:`,
    input.inviteUrl,
    ...(input.googleCalendarUrl ? [``, `Add to Google Calendar: ${input.googleCalendarUrl}`, `Apple/Outlook: open the attached invite (.ics)`] : []),
    ...(input.receiptUrl ? [``, `Receipt: ${input.receiptUrl}`] : []),
    ``,
    `Homegrown Studio · 525 Hughes Rd Ste F, Madison, AL`,
  ].join('\n')
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  // Structured HTML with explicit inline margins — email clients give bare <p>
  // tags fat default margins, so a line-by-line conversion reads double-spaced.
  // Brand primary ≈ #96705B; email-safe (no CSS vars, no external styles).
  const P = 'margin:0 0 6px;font-size:14px;color:#3d3630;line-height:1.5'
  const MUTED = 'margin:0 0 6px;font-size:13px;color:#8a7f75;line-height:1.5'
  const descriptionHtml = description
    ? description
        .split(/\n{2,}/)
        .map((para) => `<p style="${P}">${esc(para.replace(/\n/g, ' '))}</p>`)
        .join('')
    : ''
  const html = `
<div style="max-width:560px;margin:0 auto;padding:8px 4px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <p style="margin:0 0 2px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#96705B;font-weight:700;">Homegrown Studio</p>
  <h1 style="margin:0 0 2px;font-size:22px;color:#3d3630;">You&rsquo;re booked!</h1>
  <p style="margin:0 0 16px;font-size:15px;font-weight:600;color:#3d3630;">${esc(input.craftName)} &middot; ${esc(input.slotLabel)}</p>
  ${input.craftImageUrl ? `<img src="${esc(input.craftImageUrl)}" alt="${esc(input.craftName)}" width="552" style="display:block;width:100%;max-width:552px;border-radius:12px;margin:0 0 14px;" />` : ''}
  ${descriptionHtml ? `<p style="margin:0 0 4px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#96705B;font-weight:700;">About your craft</p>${descriptionHtml}<div style="height:10px;"></div>` : ''}
  <p style="${P}"><strong>Studio fee paid today: ${esc(fee)}.</strong>${perPerson ? ` ${esc(input.craftName)} is <strong>${esc(perPerson)} per person</strong>, paid at the studio for whoever crafts.` : ' Crafts are paid at the studio based on who comes.'}</p>
  <div style="margin:18px 0 6px;">
    <a href="${esc(input.hostPageUrl)}" style="display:inline-block;padding:11px 22px;background:#96705B;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Your party page &rarr;</a>
  </div>
  <p style="${MUTED}">Manage details and see who&rsquo;s RSVP&rsquo;d &mdash; keep this link.</p>
  <p style="margin:14px 0 2px;font-size:14px;color:#3d3630;">Invitation link to share with your guests:</p>
  <p style="margin:0 0 6px;"><a href="${esc(input.inviteUrl)}" style="color:#96705B;font-size:13px;word-break:break-all;">${esc(input.inviteUrl)}</a></p>
  <p style="margin:6px 0 2px;"><a href="${esc(partyInviteMailto({ craftName: input.craftName, slotLabel: input.slotLabel, inviteUrl: input.inviteUrl, icsUrl: input.bookingRef ? partyInviteIcsUrl(input.bookingRef, new URL(input.inviteUrl).origin) : undefined }))}" style="color:#96705B;font-size:14px;font-weight:600;">&#9993;&#65039; Email your guests</a></p>
  <p style="${MUTED}">Opens a ready-to-send invitation &mdash; just add addresses.</p>
  ${input.googleCalendarUrl ? `<p style="margin:14px 0 2px;"><a href="${esc(input.googleCalendarUrl)}" style="color:#96705B;font-size:14px;font-weight:600;">&#128197; Add to Google Calendar</a></p><p style="${MUTED}">Apple or Outlook? Open the attached invite (.ics).</p>` : ''}
  ${input.receiptUrl ? `<p style="margin:10px 0 0;"><a href="${esc(input.receiptUrl)}" style="color:#96705B;font-size:13px;">View your receipt</a></p>` : ''}
  <hr style="border:none;border-top:1px solid #e8e0d8;margin:20px 0 10px;" />
  <p style="margin:0;font-size:12px;color:#8a7f75;">Homegrown Studio &middot; 525 Hughes Rd Ste F, Madison, AL${input.bookingRef ? ` &middot; Booking ref ${esc(input.bookingRef)}` : ''}</p>
</div>`
  const safeCraftName = input.craftName.replace(/[\r\n]+/g, ' ')
  // Slot in the subject: more useful at a glance, and unique subjects keep
  // Gmail from threading multiple bookings and trimming "repeated" content.
  return sendEmail({
    to: input.to,
    subject: `You're booked — ${safeCraftName}, ${input.slotLabel}`,
    html,
    text,
    attachments: input.icsContent
      ? [{ filename: 'homegrown-party.ics', content: input.icsContent, contentType: 'text/calendar; method=PUBLISH' }]
      : [],
  })
}

export async function sendKitConfirmationEmail(input: {
  to: string; hostName: string; reference: string
  crafts: { name: string; qty: number }[]
  themeName?: string
  /** What the customer keeps vs. rental pieces that come home to us. */
  keeps?: string[]; returns?: string[]
  /** The three dates, pre-formatted for display (party day, pickup Thursday, return-by Wednesday). */
  partyDate: string; pickupDate: string; returnBy: string; returnWindow: string
  earlyDropLine: string
  /** Refundable rental deposit, if a themed package was ordered. */
  depositCents?: number; totalChargedCents: number
  /** Due on the POS at pickup (deposit-only booking model). */
  balanceDueCents?: number; receiptUrl: string | null
}): Promise<{ sent: boolean }> {
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`
  const total = dollars(input.totalChargedCents)
  const balanceLine = input.balanceDueCents
    ? `The remaining ${dollars(input.balanceDueCents)} is due when you pick up Thursday — card or cash at the studio.`
    : ''
  const craftLines = input.crafts.map((c) => `${c.name} × ${c.qty}`)
  const keeps = input.keeps ?? []
  const returns = input.returns ?? []
  const depositLine = input.depositCents
    ? `Your ${dollars(input.depositCents)} deposit is fully refunded when the rental pieces come home clean by Wednesday.`
    : ''

  const text = [
    `Your kit is booked, ${input.hostName}!`,
    `${craftLines.join(', ')}${input.themeName ? ` · ${input.themeName}` : ''}`,
    ``,
    `The three dates to remember:`,
    `Party: ${input.partyDate}`,
    `Pick up: Thursday ${input.pickupDate}`,
    `Return by: Wednesday ${input.returnBy}, ${input.returnWindow}`,
    ``,
    ...(keeps.length ? [`Yours to keep:`, ...keeps.map((k) => `  • ${k}`), ``] : []),
    ...(returns.length ? [`Comes home to us (rental pieces):`, ...returns.map((r) => `  • ${r}`), ``] : []),
    ...(depositLine ? [depositLine, ``] : []),
    `Drop the rental pieces back Wednesday, ${input.returnWindow}.`,
    input.earlyDropLine,
    ``,
    `Paid today: ${total}.`,
    ...(balanceLine ? [balanceLine] : []),
    ...(input.receiptUrl ? [``, `Receipt: ${input.receiptUrl}`] : []),
    ``,
    `Homegrown Studio · 525 Hughes Rd Ste F, Madison, AL · Booking ref ${input.reference}`,
  ].join('\n')

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // Brand primary ≈ #96705B; email-safe inline styles matching the party email.
  const P = 'margin:0 0 6px;font-size:14px;color:#3d3630;line-height:1.5'
  const MUTED = 'margin:0 0 6px;font-size:13px;color:#8a7f75;line-height:1.5'
  const listHtml = (items: string[]) =>
    `<ul style="margin:0 0 10px;padding:0 0 0 18px;font-size:14px;color:#3d3630;line-height:1.6;">${items
      .map((i) => `<li>${esc(i)}</li>`)
      .join('')}</ul>`
  // The three dates as a bold, scannable block — the thing hosts forget.
  const dateRow = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;font-size:13px;color:#8a7f75;white-space:nowrap;">${esc(label)}</td><td style="padding:4px 0;font-size:15px;font-weight:700;color:#3d3630;">${esc(value)}</td></tr>`
  const html = `
<div style="max-width:560px;margin:0 auto;padding:8px 4px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <p style="margin:0 0 2px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#96705B;font-weight:700;">Homegrown Studio</p>
  <h1 style="margin:0 0 2px;font-size:22px;color:#3d3630;">Your kit is booked!</h1>
  <p style="margin:0 0 16px;font-size:15px;font-weight:600;color:#3d3630;">${esc(craftLines.join(', '))}${input.themeName ? ` &middot; ${esc(input.themeName)}` : ''}</p>
  <p style="margin:0 0 4px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#96705B;font-weight:700;">The three dates</p>
  <table style="border-collapse:collapse;margin:0 0 16px;">${dateRow('Party', input.partyDate)}${dateRow('Pick up', `Thursday ${input.pickupDate}`)}${dateRow('Return by', `Wednesday ${input.returnBy}, ${input.returnWindow}`)}</table>
  ${keeps.length ? `<p style="margin:0 0 4px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#96705B;font-weight:700;">Yours to keep</p>${listHtml(keeps)}` : ''}
  ${returns.length ? `<p style="margin:0 0 4px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#96705B;font-weight:700;">Comes home to us</p>${listHtml(returns)}` : ''}
  ${depositLine ? `<p style="${P}"><strong>${esc(depositLine)}</strong></p>` : ''}
  <p style="${P}">Drop the rental pieces back Wednesday, ${esc(input.returnWindow)}.</p>
  <p style="${MUTED}">${esc(input.earlyDropLine)}</p>
  <p style="${P}"><strong>Paid today: ${esc(total)}.</strong></p>
  ${balanceLine ? `<p style="${P}">${esc(balanceLine)}</p>` : ''}
  ${input.receiptUrl ? `<p style="margin:10px 0 0;"><a href="${esc(input.receiptUrl)}" style="color:#96705B;font-size:13px;">View your receipt</a></p>` : ''}
  <hr style="border:none;border-top:1px solid #e8e0d8;margin:20px 0 10px;" />
  <p style="margin:0;font-size:12px;color:#8a7f75;">Homegrown Studio &middot; 525 Hughes Rd Ste F, Madison, AL &middot; Booking ref ${esc(input.reference)}</p>
</div>`

  // Unique subject with the pickup date + reference (house rule): keeps Gmail
  // from threading repeat bookings and trimming "duplicate" content.
  return sendEmail({
    to: input.to,
    subject: `Your kit is booked — pickup Thursday ${input.pickupDate} (${input.reference})`,
    html,
    text,
  })
}
