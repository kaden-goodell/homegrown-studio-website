import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSend = vi.fn()
vi.mock('@lib/email', () => ({ sendEmail: (...a: any[]) => mockSend(...a) }))

import { checkMessage, saveMessage, listMessages, setMessageStatus, ownerEmailText, ownerText, emailOwners, emailSender, type ContactMessage } from '@lib/contact-messages'

beforeEach(() => { vi.clearAllMocks(); mockSend.mockResolvedValue({ sent: true }) })

const good = (over: any = {}) => ({ name: 'Dana Planner', email: 'dana@example.com', phone: '(256) 555-0142', topic: 'party', message: 'Can we bring our own cake?', ...over })
const msg = (over: Partial<ContactMessage> = {}): ContactMessage => ({ ...good(), id: '2026-10-17-abcdef12', at: '2026-10-17T15:00:00Z', status: 'new', photos: 0, ...over } as ContactMessage)

describe('checkMessage', () => {
  it('accepts name, email, phone, topic and message', () => {
    const c = checkMessage(good())
    expect(c).toEqual({ ok: true, value: good() })
  })
  it('the topic is optional, and an unknown one is dropped', () => {
    const c = checkMessage(good({ topic: 'gossip' }))
    expect(c.ok && c.value.topic).toBe('')
  })
  for (const [why, body, field] of [
    ['no name', good({ name: ' ' }), 'name'],
    ['bad email', good({ email: 'dana@' }), 'email'],
    ['no phone', good({ phone: '' }), 'phone'],
    ['short phone', good({ phone: '555-0142' }), 'phone'],
    ['no message', good({ message: '  ' }), 'message'],
  ] as const) {
    it(`refuses ${why}, pointing at ${field}`, () => {
      const c = checkMessage(body)
      expect(c.ok).toBe(false)
      if (!c.ok) expect(c.field).toBe(field)
    })
  }
})

describe('storage', () => {
  it('saves as New, lists newest first, and marks one Replied', async () => {
    const c = checkMessage(good())
    if (!c.ok) throw new Error('refused')
    const first = await saveMessage(c.value, new Date('2026-10-17T10:00:00Z'))
    const second = await saveMessage(c.value, new Date('2026-10-17T11:00:00Z'))
    expect(first.status).toBe('new')
    const ids = (await listMessages()).map((m) => m.id)
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id))
    expect((await setMessageStatus(first.id, 'replied'))?.status).toBe('replied')
    expect(await setMessageStatus(first.id, 'archived' as any)).toBeNull()
  })
})

describe('words for the owners', () => {
  it('the text names them, the topic, and a short bit of the message', () => {
    expect(ownerText(msg(), 'https://ourhometownstudio.com/admin')).toBe(
      'New message from Dana Planner about a party: Can we bring our own cake? Details in your email and at ourhometownstudio.com/admin.',
    )
    expect(ownerText(msg({ topic: 'cafe' }), 'https://x.test/admin')).toContain('about Craft Café:')
    expect(ownerText(msg({ topic: 'other' }), 'https://x.test/admin')).toMatch(/^New message from Dana Planner: /)
    const long = ownerText(msg({ message: 'word '.repeat(60) }), 'https://x.test/admin')
    expect(long).toContain('…')
    expect(long.length).toBeLessThan(170)
  })

  it('the email has every answer, and Reply goes to the sender', async () => {
    const text = ownerEmailText(msg(), 'https://x.test/admin')
    for (const line of ['Dana Planner', 'dana@example.com', '(256) 555-0142', 'A party', 'Can we bring our own cake?', 'Hit Reply to answer them.', 'All messages: https://x.test/admin']) expect(text).toContain(line)
    expect(await emailOwners(msg(), 'https://x.test/admin')).toBe(true)
    const sent = mockSend.mock.calls[0][0]
    expect(sent.subject).toBe('Message from Dana Planner (A party)')
    expect(sent.replyTo).toBe('dana@example.com')
  })

  it('the sender gets a short "got it"', async () => {
    expect(await emailSender(msg())).toBe(true)
    const sent = mockSend.mock.calls[0][0]
    expect(sent.to).toBe('dana@example.com')
    expect(sent.text).toContain('Hi Dana,')
    expect(sent.text).toContain('We’ll be in touch.')
  })
})
