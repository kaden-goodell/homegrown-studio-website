import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSendMail = vi.fn()
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: (...a: any[]) => mockSendMail(...a) }) },
}))

let email: typeof import('@lib/email')

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  process.env.GMAIL_USER = 'studio@example.com'
  process.env.GMAIL_APP_PASSWORD = 'app-password'
  mockSendMail.mockResolvedValue({})
  email = await import('@lib/email')
})

const PARTY = {
  headline: 'Saturday, October 24 is open for a party',
  lines: ['A date is held for whoever books it first.'],
  path: '/book?date=2026-10-24',
  linkLabel: 'Book October 24',
}
const WORKSHOP = {
  headline: 'A seat has opened in Kinusaiga',
  lines: ['Friday, October 16 at 7:00 PM. $40 per seat.', '1 seat is open right now. A seat goes to whoever books it first.'],
  path: '/workshops?w=clsschi_kinusaiga',
  linkLabel: 'See details and book',
}
const SITE = 'https://ourhometownstudio.com'

describe('sendSignupNewsEmail', () => {
  it('says what opened and links straight to it, tagged as the sign-up email', async () => {
    const { sent } = await email.sendSignupNewsEmail({ to: 'ada@example.com', items: [PARTY], siteUrl: SITE })
    expect(sent).toBe(true)
    const mail = mockSendMail.mock.calls[0][0]
    expect(mail.to).toBe('ada@example.com')
    expect(mail.subject).toBe('Saturday, October 24 is open for a party at Hometown Studio')
    expect(mail.text).toContain('Book October 24: https://ourhometownstudio.com/book?date=2026-10-24')
    expect(mail.html).toContain('href="https://ourhometownstudio.com/book?date=2026-10-24&amp;utm_source=email&amp;utm_medium=email&amp;utm_campaign=signup_news"')
    expect(mail.html).toContain('>Book October 24</a>')
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain('Saturday, October 24 is open for a party')
      expect(body).toContain('A date is held for whoever books it first.')
      expect(body).toContain('You asked us to tell you when this happened. It has.')
      expect(body).toContain('We will not email you about this again.')
      expect(body).toContain('525 Hughes Rd, Suite F, Madison, AL 35758')
    }
  })

  it('gives each item its own button when several came due together', async () => {
    await email.sendSignupNewsEmail({ to: 'ada@example.com', items: [PARTY, WORKSHOP], siteUrl: `${SITE}/` })
    const mail = mockSendMail.mock.calls[0][0]
    expect(mail.subject).toBe('What you asked about is open at Hometown Studio')
    expect(mail.html).toContain('href="https://ourhometownstudio.com/book?date=2026-10-24&amp;utm_source=email&amp;utm_medium=email&amp;utm_campaign=signup_news"')
    expect(mail.html).toContain('href="https://ourhometownstudio.com/workshops?w=clsschi_kinusaiga&amp;utm_source=email&amp;utm_medium=email&amp;utm_campaign=signup_news"')
    expect(mail.text).toContain('You asked us to tell you about these. Here they are.')
  })

  it('has no emoji and no exclamation marks', async () => {
    await email.sendSignupNewsEmail({ to: 'ada@example.com', items: [PARTY, WORKSHOP], siteUrl: SITE })
    const { text, html, subject } = mockSendMail.mock.calls[0][0]
    for (const part of [text, html, subject]) {
      expect(part).not.toMatch(/\p{Extended_Pictographic}/u)
      expect(part).not.toContain('!')
    }
  })

  it('escapes what it is given', async () => {
    await email.sendSignupNewsEmail({
      to: 'ada@example.com',
      items: [{ ...PARTY, headline: 'Booking is open for <b>Fish & Chips</b>' }],
      siteUrl: SITE,
    })
    expect(mockSendMail.mock.calls[0][0].html).toContain('Booking is open for &lt;b&gt;Fish &amp; Chips&lt;/b&gt;')
  })

  it('sends nothing when there is nothing to say', async () => {
    expect(await email.sendSignupNewsEmail({ to: 'ada@example.com', items: [], siteUrl: SITE })).toEqual({ sent: false })
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  it('reports that email is not ready when the account is not set', async () => {
    expect(email.emailReady()).toBe(true)
    delete process.env.GMAIL_APP_PASSWORD
    expect(email.emailReady()).toBe(false)
    process.env.GMAIL_APP_PASSWORD = 'app-password'
  })
})
