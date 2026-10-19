/** How each inbox item reads in a list row and at the top of its sheet. */
import type { ApplicationStatus, ArtistApplication } from '@lib/artist-applications'
import { STATUSES as MSG_STATUSES, STATUS_LABEL as MSG_LABEL, topicLabel, type ContactMessage } from '@lib/contact-options'
import { STATUSES as REQ_STATUSES, STATUS_LABEL as REQ_LABEL, kindLabel, type EventRequest } from '@lib/event-request-options'
import { localDate } from '@lib/party-slots'
import { dayLabel } from '../classes/dates'
import { dayAndStart } from '../shell/time'
import type { InboxKind } from '../shell/router'

export interface Described {
  /** The row's headline: name, and the organisation or business. */
  name: string
  /** The sheet's title: the person only (the organisation goes in the subtitle). */
  title: string
  /** "Private event", "Message", "Teacher" */
  kind: string
  /** The sheet's subtitle: "Private event request · Sent Oct 17" */
  sheetLabel: string
  /** One line: what and when. */
  head: string
  /** What to do next, while it still needs something; '' once it's settled. */
  next: string
  statuses: [string, string][]
  statusLabel: string
  phone: string
  email: string
}

// Kept here, not imported: @lib/artist-applications is server code (it stores photos), so only its types may reach the browser.
const APP_STATUSES: ApplicationStatus[] = ['new', 'talking', 'booked', 'not-now']
const APP_LABEL: Record<ApplicationStatus, string> = { new: 'New', talking: 'Talking', booked: 'Booked', 'not-now': 'Not now' }

const sent = (iso: string) => dayLabel(localDate(iso))
const quote = (s: string, n = 60) => `“${s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s}”`

export function describeItem(kind: InboxKind, item: EventRequest | ContactMessage | ArtistApplication): Described {
  if (kind === 'request') {
    const r = item as EventRequest
    const next = r.status === 'new' ? 'Reply with dates and a quote' : r.status === 'quoted' ? 'Mark Booked or Not this time when they answer' : ''
    return {
      name: `${r.about.name}${r.about.org ? ` · ${r.about.org}` : ''}`,
      title: r.about.name,
      kind: 'Private event',
      sheetLabel: `${r.about.org ? `${r.about.org} · ` : ''}Private event request · Sent ${sent(r.at)}`,
      head: [kindLabel(r), dayAndStart(r.event.date, r.event.startTime), `${r.event.guests} guest${r.event.guests === 1 ? '' : 's'}`].filter(Boolean).join(' · '),
      next,
      statuses: REQ_STATUSES.map((s) => [s, REQ_LABEL[s]]),
      statusLabel: REQ_LABEL[r.status] ?? r.status,
      phone: r.about.phone,
      email: r.about.email,
    }
  }
  if (kind === 'message') {
    const m = item as ContactMessage
    const about = topicLabel(m.topic)
    return {
      name: m.name,
      title: m.name,
      kind: 'Message',
      sheetLabel: `Message${about ? ` about ${about.replace(/^A /, 'a ')}` : ''} · Sent ${sent(m.at)}`,
      head: [about, quote(m.message.replace(/\s+/g, ' ').trim())].filter(Boolean).join(' · '),
      next: m.status === 'new' ? (m.email ? 'Reply by email' : 'Call or text them back') : '',
      statuses: MSG_STATUSES.map((s) => [s, MSG_LABEL[s]]),
      statusLabel: MSG_LABEL[m.status] ?? m.status,
      phone: m.phone,
      email: m.email,
    }
  }
  const a = item as ArtistApplication
  const next = a.status === 'new'
    ? (a.photos > 0 ? 'Look at their photos, then reply' : 'Reply to talk it over')
    : a.status === 'talking' ? 'Mark Booked or Not now when you decide' : ''
  return {
    name: `${a.about.name}${a.about.business ? ` · ${a.about.business}` : ''}`,
    title: a.about.name,
    kind: 'Teacher',
    sheetLabel: `${a.about.business ? `${a.about.business} · ` : ''}Teacher application · Sent ${sent(a.at)}`,
    head: [a.classIdea.what, a.when.days].filter(Boolean).join(' · '),
    next,
    statuses: APP_STATUSES.map((s) => [s, APP_LABEL[s]]),
    statusLabel: APP_LABEL[a.status] ?? a.status,
    phone: a.about.phone,
    email: a.about.email,
  }
}

/** tel: wants digits only. */
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`
export const smsHref = (phone: string) => `sms:${phone.replace(/[^\d+]/g, '')}`
