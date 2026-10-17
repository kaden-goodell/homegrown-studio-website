/**
 * Messages from the contact form (/contact, Kaden 17 Oct 2026). Stored, then
 * emailed to the owners (Reply goes to the sender) with a short text, and
 * listed on the owner-only /admin page as New or Replied.
 */
import { submissionStore, ownerEmailTextOf, emailOwnersCopy, emailGotIt, type OwnerEmail } from '@lib/submissions'
import { TOPICS, STATUSES, STATUS_LABEL, topicLabel, type ContactMessage, type MessageStatus } from '@lib/contact-options'

export { TOPICS, STATUSES, STATUS_LABEL, topicLabel }
export type { ContactMessage, MessageStatus }

type NewMessage = Omit<ContactMessage, 'id' | 'at' | 'status' | 'photos'>

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export type Checked = { ok: true; value: NewMessage } | { ok: false; field: string; error: string }

/** Name, email, phone and the message are required; the topic is optional. */
export function checkMessage(body: any): Checked {
  const value: NewMessage = {
    name: str(body?.name, 80),
    email: str(body?.email, 160),
    phone: str(body?.phone, 30),
    topic: TOPICS.some(([k]) => k === body?.topic) ? body.topic : '',
    message: str(body?.message, 3000),
  }
  if (!value.name) return { ok: false, field: 'name', error: 'Add your name.' }
  if (!EMAIL_RE.test(value.email)) return { ok: false, field: 'email', error: 'That email doesn’t look right. Check for typos.' }
  const digits = value.phone.replace(/\D/g, '')
  if (!(digits.length === 10 || (digits.length === 11 && digits.startsWith('1')))) {
    return { ok: false, field: 'phone', error: 'Add a 10-digit phone number.' }
  }
  if (!value.message) return { ok: false, field: 'message', error: 'Write your message.' }
  return { ok: true, value }
}

const store = submissionStore<MessageStatus, ContactMessage>({ store: 'contact-messages', prefix: 'msg', maxPhotos: 0, statuses: STATUSES })

export const saveMessage = (value: NewMessage, now = new Date()) => store.save(value, [], now)
export const listMessages = () => store.list()
export const setMessageStatus = (id: string, status: MessageStatus, now = new Date()) => store.setStatus(id, status, now)

export function ownerEmail(m: ContactMessage, adminUrl: string): OwnerEmail {
  return {
    kicker: 'Message from the website',
    title: m.name,
    summary: topicLabel(m.topic) && m.topic !== 'other' ? `About ${topicLabel(m.topic).replace(/^A /, 'a ')}` : undefined,
    person: { name: m.name, email: m.email, phone: m.phone },
    sections: [{ title: 'Message', rows: [['About', topicLabel(m.topic)], ['Message', m.message]] }],
    adminUrl,
    adminLabel: 'All messages',
  }
}

export const ownerEmailText = (m: ContactMessage, adminUrl: string) => ownerEmailTextOf(ownerEmail(m, adminUrl))

/** "New message from Dana Planner about a party: Can we bring our own cake? Details in your email and at …/admin." */
export function ownerText(m: ContactMessage, adminUrl: string): string {
  const said = m.message.replace(/\s+/g, ' ').trim()
  const short = said.length > 80 ? `${said.slice(0, 77).trimEnd()}…` : said
  const about = m.topic && m.topic !== 'other' ? ` about ${topicLabel(m.topic).replace(/^A /, 'a ')}` : ''
  return `New message from ${m.name}${about}: ${short} Details in your email and at ${adminUrl.replace(/^https?:\/\//, '')}.`
}

export function emailOwners(m: ContactMessage, adminUrl: string): Promise<boolean> {
  const about = topicLabel(m.topic)
  return emailOwnersCopy({ subject: `Message from ${m.name}${about && m.topic !== 'other' ? ` (${about})` : ''}`, email: ownerEmail(m, adminUrl) })
}

export function emailSender(m: ContactMessage): Promise<boolean> {
  return emailGotIt({ to: m.email, name: m.name, subject: 'We got your message' })
}
