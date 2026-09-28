import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSendMail = vi.fn()
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: (...a: any[]) => mockSendMail(...a) }) },
}))

let sendSignupConfirmationEmail: typeof import('@lib/email').sendSignupConfirmationEmail

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  process.env.GMAIL_USER = 'studio@example.com'
  process.env.GMAIL_APP_PASSWORD = 'app-password'
  mockSendMail.mockResolvedValue({})
  ;({ sendSignupConfirmationEmail } = await import('@lib/email'))
})

const bodies = () => {
  const { html, text } = mockSendMail.mock.calls[0][0]
  return [text as string, (html as string).replace(/&rsquo;/g, "'").replace(/<\/?strong>/g, '')]
}

describe('sendSignupConfirmationEmail', () => {
  it('says what they will hear about, and that it is the only email', async () => {
    const { sent } = await sendSignupConfirmationEmail({ to: 'ada@example.com', when: 'the day party booking opens', also: 'You were looking at Saturday, October 24.', opensOn: 'Friday, October 16' })
    expect(sent).toBe(true)
    const mail = mockSendMail.mock.calls[0][0]
    expect(mail.to).toBe('ada@example.com')
    expect(mail.subject).toBe("You're on the list at Hometown Studio")
    for (const body of bodies()) {
      expect(body).toContain("We'll email you the day party booking opens.")
      expect(body).toContain("That's the only email this sign-up will send you.")
      expect(body).toContain('You were looking at Saturday, October 24.')
      expect(body).toContain('Hometown Studio opens Friday, October 16 at 525 Hughes Rd, Suite F, Madison, AL 35758.')
      expect(body).toContain('Text us at (256) 464-1710')
      expect(body).toContain("Didn't sign up?")
    }
  })

  it('gives the address without an opening date once the studio is open', async () => {
    await sendSignupConfirmationEmail({ to: 'ada@example.com', when: 'when new workshops are posted' })
    for (const body of bodies()) {
      expect(body).toContain("You'll find us at 525 Hughes Rd, Suite F, Madison, AL 35758.")
      expect(body).not.toContain('opens')
    }
  })

  it('carries no links, offers or attachments', async () => {
    await sendSignupConfirmationEmail({ to: 'ada@example.com', when: 'the day booking opens' })
    const mail = mockSendMail.mock.calls[0][0]
    expect(mail.html).not.toMatch(/<a\s/)
    expect(mail.text).not.toMatch(/https?:/)
    expect(mail.attachments).toBeUndefined()
  })

  it('reports honestly when email is not set up', async () => {
    delete process.env.GMAIL_USER
    vi.resetModules()
    ;({ sendSignupConfirmationEmail } = await import('@lib/email'))
    expect(await sendSignupConfirmationEmail({ to: 'ada@example.com', when: 'the day booking opens' })).toEqual({ sent: false })
  })
})
