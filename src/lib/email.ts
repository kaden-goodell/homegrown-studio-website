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
      // From = the public contact address. Gmail honors it only if it's a verified
      // "Send mail as" alias of GMAIL_USER; otherwise Gmail rewrites From to GMAIL_USER.
      from: `"${siteConfig.email.fromName}" <${siteConfig.email.fromAddress}>`,
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
  /**
   * The host's private party page. Null when it could not be set up: the email
   * then says so and gives the number to text. It never links somewhere else
   * in its place.
   */
  hostPageUrl: string | null
  inviteUrl: string; totalChargedCents: number; receiptUrl: string | null
  /** Add-to-calendar: a Google Calendar link for the body + ICS content attached for Apple/Outlook. */
  googleCalendarUrl?: string; icsContent?: string
  /** Booking id — shown as a footer reference (also keeps repeated test emails from Gmail-trimming). */
  bookingRef?: string
  /** What a host needs to turn up. All from config, none typed here. */
  arriveEarlyMinutes?: number
  minGuests?: number
  /** One sentence on refunds for THIS date (see refund-lines.ts). */
  refundLine?: string
  directionsUrl?: string
}): Promise<{ sent: boolean }> {
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`
  const fee = dollars(input.totalChargedCents)
  const address = '525 Hughes Rd, Suite F, Madison, AL 35758'
  const phone = siteConfig.contactPhone
  // "$25" or "$30–$40" per person, matching the booking panel's label.
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
  const arriveLine = input.arriveEarlyMinutes ? `Arrive up to ${input.arriveEarlyMinutes} minutes early to set up.` : ''
  const headcountLine = `About a week before, we'll text you to check your headcount. It's for our prep only: you pay for who comes${input.minGuests ? `, minimum ${input.minGuests}` : ''}.`
  const noPageLine = `Your party page is being set up. ${phone ? `Text us at ${phone} and we'll send you the link.` : "We'll send you the link."}`

  const text = [
    `You're booked! ${input.craftName} · ${input.slotLabel}`,
    ``,
    `Where: Hometown Studio, ${address}`,
    ...(input.directionsUrl ? [`Directions: ${input.directionsUrl}`] : []),
    ...(arriveLine ? [arriveLine] : []),
    ``,
    ...(description ? [`About your craft:`, ...description.split('\n'), ``] : []),
    costLine,
    ``,
    ...(input.hostPageUrl
      ? [`Your party page (see who's coming and manage the details; keep this link):`, input.hostPageUrl]
      : [noPageLine]),
    ``,
    `Invitation link to share with your guests:`,
    input.inviteUrl,
    ``,
    headcountLine,
    ...(input.refundLine ? [``, `Changing plans: ${input.refundLine}`] : []),
    ...(input.googleCalendarUrl ? [``, `Add to Google Calendar: ${input.googleCalendarUrl}`, `Apple or Outlook: open the attached invite (.ics)`] : []),
    ...(input.receiptUrl ? [``, `Receipt: ${input.receiptUrl}`] : []),
    ...(phone ? [``, `Questions? Text us at ${phone}.`] : []),
    ``,
    `Hometown Studio · ${address}`,
  ].join('\n')
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  // Structured HTML with explicit inline margins — email clients give bare <p>
  // tags fat default margins, so a line-by-line conversion reads double-spaced.
  // Brand primary #7a4a2e; email-safe (no CSS vars, no external styles).
  const P = 'margin:0 0 6px;font-size:14px;color:#3d3630;line-height:1.5'
  const MUTED = 'margin:0 0 6px;font-size:13px;color:#6f635b;line-height:1.5'
  const LABEL = 'margin:0 0 4px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#7a4a2e;font-weight:700;'
  const LINK = 'color:#7a4a2e;font-weight:600;'
  const descriptionHtml = description
    ? description
        .split(/\n{2,}/)
        .map((para) => `<p style="${P}">${esc(para.replace(/\n/g, ' '))}</p>`)
        .join('')
    : ''
  const html = `
<div style="max-width:560px;margin:0 auto;padding:8px 4px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <p style="margin:0 0 2px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#7a4a2e;font-weight:700;">Hometown Studio</p>
  <h1 style="margin:0 0 2px;font-size:22px;color:#3d3630;">You&rsquo;re booked!</h1>
  <p style="margin:0 0 16px;font-size:15px;font-weight:600;color:#3d3630;">${esc(input.craftName)} &middot; ${esc(input.slotLabel)}</p>
  ${input.craftImageUrl ? `<img src="${esc(input.craftImageUrl)}" alt="${esc(input.craftName)}" width="552" style="display:block;width:100%;max-width:552px;border-radius:12px;margin:0 0 14px;" />` : ''}
  <p style="${LABEL}">Where</p>
  <p style="${P}">Hometown Studio, ${esc(address)}${input.directionsUrl ? `<br /><a href="${esc(input.directionsUrl)}" style="${LINK}font-size:13px;">Get directions</a>` : ''}</p>
  ${arriveLine ? `<p style="${P}">${esc(arriveLine)}</p>` : ''}
  <div style="height:10px;"></div>
  ${descriptionHtml ? `<p style="${LABEL}">About your craft</p>${descriptionHtml}<div style="height:10px;"></div>` : ''}
  <p style="${P}"><strong>Studio fee paid today: ${esc(fee)}.</strong>${perPerson ? ` ${esc(input.craftName)} is <strong>${esc(perPerson)} per person</strong>, paid at the studio for whoever crafts.` : ' Crafts are paid at the studio based on who comes.'}</p>
  ${
    input.hostPageUrl
      ? `<div style="margin:18px 0 6px;">
    <a href="${esc(input.hostPageUrl)}" style="display:inline-block;padding:11px 22px;background:#7a4a2e;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Your party page &rarr;</a>
  </div>
  <p style="${MUTED}">See who&rsquo;s coming and manage the details. Keep this link.</p>`
      : `<p style="${P}margin-top:14px;">${esc(noPageLine)}</p>`
  }
  <p style="margin:14px 0 2px;font-size:14px;color:#3d3630;">Invitation link to share with your guests:</p>
  <p style="margin:0 0 6px;"><a href="${esc(input.inviteUrl)}" style="color:#7a4a2e;font-size:13px;word-break:break-all;">${esc(input.inviteUrl)}</a></p>
  <p style="margin:6px 0 2px;"><a href="${esc(partyInviteMailto({ craftName: input.craftName, slotLabel: input.slotLabel, inviteUrl: input.inviteUrl, icsUrl: input.bookingRef ? partyInviteIcsUrl(input.bookingRef, new URL(input.inviteUrl).origin) : undefined }))}" style="${LINK}font-size:14px;">Email your guests</a></p>
  <p style="${MUTED}">Opens a ready-to-send invitation. Just add addresses.</p>
  <p style="${LABEL}margin-top:14px;">Before the party</p>
  <p style="${P}">${esc(headcountLine)}</p>
  ${input.refundLine ? `<p style="${LABEL}margin-top:10px;">Changing plans</p><p style="${P}">${esc(input.refundLine)}</p>` : ''}
  ${input.googleCalendarUrl ? `<p style="margin:14px 0 2px;"><a href="${esc(input.googleCalendarUrl)}" style="${LINK}font-size:14px;">Add to Google Calendar</a></p><p style="${MUTED}">Apple or Outlook: open the attached invite.</p>` : ''}
  ${input.receiptUrl ? `<p style="margin:10px 0 0;"><a href="${esc(input.receiptUrl)}" style="color:#7a4a2e;font-size:13px;">View your receipt</a></p>` : ''}
  ${phone ? `<p style="${P}margin-top:14px;">Questions? Text us at <strong>${esc(phone)}</strong>.</p>` : ''}
  <hr style="border:none;border-top:1px solid #e8e0d8;margin:20px 0 10px;" />
  <p style="margin:0;font-size:12px;color:#6f635b;">Hometown Studio &middot; ${esc(address)}${input.bookingRef ? ` &middot; Booking ref ${esc(input.bookingRef)}` : ''}</p>
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
      ? [{ filename: 'hometown-party.ics', content: input.icsContent, contentType: 'text/calendar; method=PUBLISH' }]
      : [],
  })
}

/**
 * Workshop seat confirmation. Ours, not Square's: it carries what the customer
 * needs to turn up (when, where, the agreement to sign) in the studio's voice.
 */
export async function sendWorkshopConfirmationEmail(input: {
  to: string
  firstName: string
  workshopName: string
  /** First paragraph of the workshop's description, already plain text. */
  summary?: string
  imageUrl?: string
  /** "Fri, Oct 16 · 7:00 PM CT" */
  whenLabel: string
  /** "7:00 – 9:00 PM" */
  timeRange: string
  seats: number
  totalChargedCents: number
  receiptUrl: string | null
  /** Participation agreement, carrying the booking id. Forwardable to companions. */
  waiverUrl: string
  /** Link back to this workshop, for bringing a friend. */
  workshopUrl: string
  directionsUrl: string
  /** One-line refund terms, from policy-content. */
  policyLine: string
  policyUrl: string
  googleCalendarUrl?: string
  icsContent?: string
  bookingRef?: string
}): Promise<{ sent: boolean }> {
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`
  const paid = dollars(input.totalChargedCents)
  const seatWord = input.seats === 1 ? '1 seat' : `${input.seats} seats`
  const address = '525 Hughes Rd, Suite F, Madison, AL 35758'
  const phone = siteConfig.contactPhone
  const summary = (input.summary ?? '').replace(/\r/g, '').trim()

  const text = [
    `You're booked, ${input.firstName}! ${input.workshopName}`,
    ``,
    `When: ${input.whenLabel} (${input.timeRange})`,
    `Where: Hometown Studio, ${address}`,
    `Directions: ${input.directionsUrl}`,
    `Seats: ${seatWord}, ${paid} paid`,
    ``,
    ...(summary ? [summary, ``] : []),
    `Before you come: sign the participation agreement. It takes a minute.`,
    input.waiverUrl,
    ...(input.seats > 1 ? [`Coming with friends? Forward them that link so they can sign before they arrive.`] : []),
    ``,
    `Everything you need is here when you arrive. Just bring yourself.`,
    ...(input.googleCalendarUrl ? [``, `Add to Google Calendar: ${input.googleCalendarUrl}`, `Apple/Outlook: open the attached invite (.ics)`] : []),
    ``,
    `Know someone who'd love this? ${input.workshopUrl}`,
    ``,
    `Changing plans: ${input.policyLine}. Details: ${input.policyUrl}`,
    ...(input.receiptUrl ? [``, `Receipt: ${input.receiptUrl}`] : []),
    ``,
    `Questions? Text us at ${phone}.`,
    `Hometown Studio · ${address}`,
  ].join('\n')

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const P = 'margin:0 0 6px;font-size:14px;color:#3d3630;line-height:1.5'
  const MUTED = 'margin:0 0 6px;font-size:13px;color:#6f635b;line-height:1.5'
  const LABEL = 'margin:0 0 2px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#7a4a2e;font-weight:700;'
  const LINK = 'color:#7a4a2e;font-size:14px;font-weight:600;'
  const html = `
<div style="max-width:560px;margin:0 auto;padding:8px 4px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <p style="margin:0 0 2px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#7a4a2e;font-weight:700;">Hometown Studio</p>
  <h1 style="margin:0 0 2px;font-size:22px;color:#3d3630;">You&rsquo;re booked, ${esc(input.firstName)}!</h1>
  <p style="margin:0 0 16px;font-size:15px;font-weight:600;color:#3d3630;">${esc(input.workshopName)}</p>
  ${input.imageUrl ? `<img src="${esc(input.imageUrl)}" alt="${esc(input.workshopName)}" width="552" style="display:block;width:100%;max-width:552px;border-radius:12px;margin:0 0 14px;" />` : ''}
  <p style="${LABEL}">When</p>
  <p style="${P}"><strong>${esc(input.whenLabel)}</strong> &middot; ${esc(input.timeRange)}</p>
  <p style="${LABEL}margin-top:10px;">Where</p>
  <p style="${P}">Hometown Studio, ${esc(address)}<br /><a href="${esc(input.directionsUrl)}" style="${LINK}font-size:13px;">Get directions</a></p>
  <p style="${LABEL}margin-top:10px;">Your booking</p>
  <p style="${P}">${esc(seatWord)} &middot; <strong>${esc(paid)} paid</strong></p>
  ${summary ? `<p style="${MUTED}margin-top:10px;">${esc(summary)}</p>` : ''}
  <div style="margin:18px 0 6px;">
    <a href="${esc(input.waiverUrl)}" style="display:inline-block;padding:11px 22px;background:#7a4a2e;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Sign the participation agreement &rarr;</a>
  </div>
  <p style="${MUTED}">It takes a minute, and saves you doing it at the door.${input.seats > 1 ? ' Coming with friends? Forward them this email so they can sign too.' : ''}</p>
  <p style="${P}margin-top:12px;">Everything you need is here when you arrive. Just bring yourself.</p>
  ${input.googleCalendarUrl ? `<p style="margin:14px 0 2px;"><a href="${esc(input.googleCalendarUrl)}" style="${LINK}">Add to Google Calendar</a></p><p style="${MUTED}">Apple or Outlook: open the attached invite.</p>` : ''}
  <p style="margin:14px 0 2px;font-size:14px;color:#3d3630;">Know someone who&rsquo;d love this?</p>
  <p style="margin:0 0 6px;"><a href="${esc(input.workshopUrl)}" style="color:#7a4a2e;font-size:13px;word-break:break-all;">${esc(input.workshopUrl)}</a></p>
  <p style="${MUTED}margin-top:14px;"><strong>Changing plans:</strong> ${esc(input.policyLine)}. <a href="${esc(input.policyUrl)}" style="color:#7a4a2e;">Full policy</a></p>
  ${input.receiptUrl ? `<p style="margin:10px 0 0;"><a href="${esc(input.receiptUrl)}" style="color:#7a4a2e;font-size:13px;">View your receipt</a></p>` : ''}
  <p style="${P}margin-top:14px;">Questions? Text us at <strong>${esc(phone)}</strong>.</p>
  <hr style="border:none;border-top:1px solid #e8e0d8;margin:20px 0 10px;" />
  <p style="margin:0;font-size:12px;color:#6f635b;">Hometown Studio &middot; ${esc(address)}${input.bookingRef ? ` &middot; Booking ref ${esc(input.bookingRef)}` : ''}</p>
</div>`
  const safeName = input.workshopName.replace(/[\r\n]+/g, ' ')
  return sendEmail({
    to: input.to,
    subject: `You're booked — ${safeName}, ${input.whenLabel}`,
    html,
    text,
    attachments: input.icsContent
      ? [{ filename: 'hometown-workshop.ics', content: input.icsContent, contentType: 'text/calendar; method=PUBLISH' }]
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
    `Hometown Studio · 525 Hughes Rd Ste F, Madison, AL · Booking ref ${input.reference}`,
  ].join('\n')

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // Brand primary ≈ #7a4a2e; email-safe inline styles matching the party email.
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
  <p style="margin:0 0 2px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#7a4a2e;font-weight:700;">Hometown Studio</p>
  <h1 style="margin:0 0 2px;font-size:22px;color:#3d3630;">Your kit is booked!</h1>
  <p style="margin:0 0 16px;font-size:15px;font-weight:600;color:#3d3630;">${esc(craftLines.join(', '))}${input.themeName ? ` &middot; ${esc(input.themeName)}` : ''}</p>
  <p style="margin:0 0 4px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#7a4a2e;font-weight:700;">The three dates</p>
  <table style="border-collapse:collapse;margin:0 0 16px;">${dateRow('Party', input.partyDate)}${dateRow('Pick up', `Thursday ${input.pickupDate}`)}${dateRow('Return by', `Wednesday ${input.returnBy}, ${input.returnWindow}`)}</table>
  ${keeps.length ? `<p style="margin:0 0 4px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#7a4a2e;font-weight:700;">Yours to keep</p>${listHtml(keeps)}` : ''}
  ${returns.length ? `<p style="margin:0 0 4px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#7a4a2e;font-weight:700;">Comes home to us</p>${listHtml(returns)}` : ''}
  ${depositLine ? `<p style="${P}"><strong>${esc(depositLine)}</strong></p>` : ''}
  <p style="${P}">Drop the rental pieces back Wednesday, ${esc(input.returnWindow)}.</p>
  <p style="${MUTED}">${esc(input.earlyDropLine)}</p>
  <p style="${P}"><strong>Paid today: ${esc(total)}.</strong></p>
  ${balanceLine ? `<p style="${P}">${esc(balanceLine)}</p>` : ''}
  ${input.receiptUrl ? `<p style="margin:10px 0 0;"><a href="${esc(input.receiptUrl)}" style="color:#7a4a2e;font-size:13px;">View your receipt</a></p>` : ''}
  <hr style="border:none;border-top:1px solid #e8e0d8;margin:20px 0 10px;" />
  <p style="margin:0;font-size:12px;color:#8a7f75;">Hometown Studio &middot; 525 Hughes Rd Ste F, Madison, AL &middot; Booking ref ${esc(input.reference)}</p>
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
