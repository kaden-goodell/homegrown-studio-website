import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSendMail = vi.fn()
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: (...a: any[]) => mockSendMail(...a) }) },
}))

const input = {
  to: 'ada@example.com',
  hostName: 'Ada',
  craftName: 'Bubble Letter Keychains',
  craftDescription: 'Spell any word in chunky bubble letters.\n\nEveryone picks their own word.',
  craftImageUrl: 'https://example.com/keychains.jpg',
  slotLabel: 'Sat, Oct 17 · 2:00 PM CT',
  perHeadCents: 2000,
  hostPageUrl: 'https://ourhometownstudio.com/party/bk-1?key=host-key' as string | null,
  inviteUrl: 'https://ourhometownstudio.com/invite?b=bk-1',
  totalChargedCents: 30000,
  receiptUrl: 'https://squareup.com/receipt/9',
  googleCalendarUrl: 'https://calendar.google.com/calendar/render?action=TEMPLATE',
  icsContent: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR',
  bookingRef: 'bk-1',
  arriveEarlyMinutes: 30,
  minGuests: 10,
  refundLine: 'Full refund until Oct 3. After that, studio credit.',
  directionsUrl: 'https://maps.google.com/?q=Hometown%20Studio',
}

let sendPartyConfirmationEmail: typeof import('@lib/email').sendPartyConfirmationEmail

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  process.env.GMAIL_USER = 'studio@example.com'
  process.env.GMAIL_APP_PASSWORD = 'app-password'
  mockSendMail.mockResolvedValue({})
  ;({ sendPartyConfirmationEmail } = await import('@lib/email'))
})

const bodies = () => {
  const { html, text } = mockSendMail.mock.calls[0][0]
  // Read the HTML as a person would: typographic quotes and bold are not part of the words.
  return [text as string, (html as string).replace(/&rsquo;/g, "'").replace(/<\/?strong>/g, '')]
}

describe('sendPartyConfirmationEmail', () => {
  it('tells the host what they need to turn up', async () => {
    const { sent } = await sendPartyConfirmationEmail(input)
    expect(sent).toBe(true)
    expect(mockSendMail.mock.calls[0][0].subject).toBe("You're booked — Bubble Letter Keychains, Sat, Oct 17 · 2:00 PM CT")
    for (const body of bodies()) {
      expect(body).toContain('525 Hughes Rd, Suite F, Madison, AL 35758')
      expect(body).toContain('Arrive up to 30 minutes early to set up.')
      expect(body).toContain("we'll text you to check your headcount")
      expect(body).toContain('you pay for who comes, minimum 10')
      expect(body).toContain('Full refund until Oct 3. After that, studio credit.')
      expect(body).toContain('Text us at (256) 464-1710')
      expect(body).toContain('$300')
      expect(body).toContain('$20')
    }
  })

  it('links the party page, the invitation, directions, the receipt and the calendar', async () => {
    await sendPartyConfirmationEmail(input)
    for (const body of bodies()) {
      expect(body).toContain('https://ourhometownstudio.com/party/bk-1?key=host-key')
      expect(body).toContain('https://ourhometownstudio.com/invite?b=bk-1')
      expect(body).toContain('https://maps.google.com/?q=Hometown%20Studio')
      expect(body).toContain('https://squareup.com/receipt/9')
      expect(body).toContain('https://calendar.google.com/calendar/render?action=TEMPLATE')
    }
    expect(mockSendMail.mock.calls[0][0].attachments).toEqual([
      { filename: 'hometown-party.ics', content: input.icsContent, contentType: 'text/calendar; method=PUBLISH' },
    ])
  })

  it('says the party page is being set up when there is none, and never links to /book', async () => {
    await sendPartyConfirmationEmail({ ...input, hostPageUrl: null })
    for (const body of bodies()) {
      expect(body).toContain('Your party page is being set up.')
      expect(body).toContain("Text us at (256) 464-1710 and we'll send you the link.")
      expect(body).not.toContain('Your party page &rarr;')
      expect(body).not.toMatch(/ourhometownstudio\.com\/book/)
    }
  })

  it('puts no emoji in its labels', async () => {
    await sendPartyConfirmationEmail(input)
    const { html, text } = mockSendMail.mock.calls[0][0]
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u)
    expect(html).not.toMatch(/&#(128197|9993|65039);/)
  })

  it('never puts what the customer typed into the page as markup', async () => {
    await sendPartyConfirmationEmail({ ...input, craftName: '<script>alert(1)</script>' })
    expect(mockSendMail.mock.calls[0][0].html).not.toContain('<script>')
  })

  it('reports honestly when email is not set up', async () => {
    delete process.env.GMAIL_USER
    vi.resetModules()
    ;({ sendPartyConfirmationEmail } = await import('@lib/email'))
    expect(await sendPartyConfirmationEmail(input)).toEqual({ sent: false })
    expect(mockSendMail).not.toHaveBeenCalled()
  })
})
