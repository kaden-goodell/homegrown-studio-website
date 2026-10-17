import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSend = vi.fn()
vi.mock('@lib/email', () => ({ sendEmail: (...a: any[]) => mockSend(...a) }))

import { ownerEmailHtmlOf, ownerEmailTextOf, emailOwnersCopy, type OwnerEmail } from '@lib/submissions'

beforeEach(() => { vi.clearAllMocks(); mockSend.mockResolvedValue({ sent: true }) })

const email = (over: Partial<OwnerEmail> = {}): OwnerEmail => ({
  kicker: 'Private event request',
  title: 'Dana Planner · Rocket Co',
  summary: 'Team building · Sat Nov 21 · 18 guests',
  person: { name: 'Dana Planner', email: 'dana@example.com', phone: '(256) 555-0142' },
  sections: [
    { title: 'Where', rows: [['Address', '100 Main St\nSuite 2'], ['Sink nearby', '']] },
    { title: 'Extras', rows: [['Food', '']] },
  ],
  photosNote: '2 inspiration photos attached.',
  adminUrl: 'https://x.test/admin',
  adminLabel: 'All requests',
  ...over,
})

describe('the owners’ email', () => {
  it('leads with who it is and one-tap Reply, Text and Call', () => {
    const html = ownerEmailHtmlOf(email())
    expect(html).toContain('Private event request')
    expect(html).toContain('Dana Planner · Rocket Co')
    expect(html).toContain('href="mailto:dana@example.com"')
    expect(html).toContain('Reply to Dana')
    expect(html).toContain('href="sms:2565550142"')
    expect(html).toContain('href="tel:2565550142"')
    expect(html).toContain('href="https://x.test/admin"')
  })

  it('shows each answered section, keeps line breaks, and drops blanks and empty sections', () => {
    const html = ownerEmailHtmlOf(email())
    expect(html).toContain('100 Main St<br />Suite 2')
    expect(html).not.toContain('Sink nearby')
    expect(html).not.toContain('>Extras<')
    const text = ownerEmailTextOf(email())
    expect(text).toContain('WHERE\nAddress\n  100 Main St\n  Suite 2')
    expect(text).not.toContain('EXTRAS')
    expect(text).toContain('All requests: https://x.test/admin')
  })

  it('never lets what someone typed become markup', () => {
    const html = ownerEmailHtmlOf(email({ title: '<script>x</script>', sections: [{ title: 'Craft', rows: [['Vision', '<img src=x onerror=alert(1)>']] }] }))
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('leaves Text and Call out when there is no phone', () => {
    const html = ownerEmailHtmlOf(email({ person: { name: 'Dana', email: 'd@x.co', phone: '' } }))
    expect(html).not.toContain('sms:')
    expect(html).not.toContain('tel:')
  })

  it('goes to every owner as text and HTML, with Reply going to the sender', async () => {
    expect(await emailOwnersCopy({ subject: 'S', email: email(), photos: [Buffer.from('a')] })).toBe(true)
    expect(mockSend).toHaveBeenCalledTimes(2)
    const sent = mockSend.mock.calls[0][0]
    expect(sent.replyTo).toBe('dana@example.com')
    expect(sent.html).toContain('Reply to Dana')
    expect(sent.text).toContain('PRIVATE EVENT REQUEST')
    expect(sent.attachments).toHaveLength(1)
  })
})

import { prettyPhone } from '@lib/submissions'
describe('prettyPhone', () => {
  it.each([['4029802907', '(402) 980-2907'], ['+1 (256) 555-0142', '(256) 555-0142'], ['12565550142', '(256) 555-0142'], ['555-0142', '555-0142']])('%s → %s', (a, b) => {
    expect(prettyPhone(a)).toBe(b)
  })
})
