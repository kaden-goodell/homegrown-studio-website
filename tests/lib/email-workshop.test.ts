import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSendMail = vi.fn()
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: (...a: any[]) => mockSendMail(...a) }) },
}))

const input = {
  to: 'ada@example.com',
  firstName: 'Ada',
  workshopName: 'Kinusaiga',
  summary: 'Kinusaiga is Japanese fabric art with no sewing.',
  imageUrl: 'https://example.com/kinusaiga.jpg',
  whenLabel: 'Fri, Oct 16 · 7:00 PM CT',
  timeRange: '7 – 9 PM',
  seats: 2,
  totalChargedCents: 8000,
  receiptUrl: 'https://squareup.com/receipt/1',
  waiverUrl: 'https://ourhometownstudio.com/waiver?workshop=clssch_1&booking=clsbk_1',
  workshopUrl: 'https://ourhometownstudio.com/workshops?w=clsschi_kinusaiga',
  directionsUrl: 'https://maps.google.com/?q=Hometown%20Studio',
  policyLine: 'Full refund 48+ hours out · studio credit or free seat transfer inside 48 hours',
  policyUrl: 'https://ourhometownstudio.com/policies#workshops',
  googleCalendarUrl: 'https://calendar.google.com/calendar/render?action=TEMPLATE',
  icsContent: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR',
  bookingRef: 'clsbk_1',
}

let sendWorkshopConfirmationEmail: typeof import('@lib/email').sendWorkshopConfirmationEmail

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  process.env.GMAIL_USER = 'studio@example.com'
  process.env.GMAIL_APP_PASSWORD = 'app-password'
  mockSendMail.mockResolvedValue({})
  ;({ sendWorkshopConfirmationEmail } = await import('@lib/email'))
})

describe('sendWorkshopConfirmationEmail', () => {
  it('says what, when and where, in the subject and both bodies', async () => {
    const { sent } = await sendWorkshopConfirmationEmail(input)
    expect(sent).toBe(true)
    const mail = mockSendMail.mock.calls[0][0]
    expect(mail.to).toBe('ada@example.com')
    expect(mail.subject).toBe("You're booked — Kinusaiga, Fri, Oct 16 · 7:00 PM CT")
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain('Kinusaiga')
      expect(body).toContain('Fri, Oct 16 · 7:00 PM CT')
      expect(body).toContain('525 Hughes Rd, Suite F, Madison, AL 35758')
      expect(body).toContain('$80')
      expect(body).toContain('2 seats')
      expect(body).toContain('(256) 464-1710')
      expect(body).toContain('48+ hours')
    }
  })

  it('links the agreement, directions, receipt, calendar and the workshop itself', async () => {
    await sendWorkshopConfirmationEmail(input)
    const { html, text } = mockSendMail.mock.calls[0][0]
    for (const url of [input.waiverUrl, input.workshopUrl, input.directionsUrl, input.receiptUrl, input.policyUrl]) {
      expect(text).toContain(url)
    }
    expect(html).toContain('href="https://ourhometownstudio.com/waiver?workshop=clssch_1&amp;booking=clsbk_1"')
    expect(html).toContain('Add to Google Calendar')
  })

  it('attaches the calendar file', async () => {
    await sendWorkshopConfirmationEmail(input)
    const [file] = mockSendMail.mock.calls[0][0].attachments
    expect(file.filename).toBe('hometown-workshop.ics')
    expect(file.contentType).toContain('text/calendar')
    expect(file.content).toContain('BEGIN:VCALENDAR')
  })

  it('asks companions to sign too, only when there are companions', async () => {
    await sendWorkshopConfirmationEmail(input)
    expect(mockSendMail.mock.calls[0][0].text).toMatch(/Coming with friends\?/)

    await sendWorkshopConfirmationEmail({ ...input, seats: 1, totalChargedCents: 4000 })
    const solo = mockSendMail.mock.calls[1][0]
    expect(solo.text).not.toMatch(/Coming with friends\?/)
    expect(solo.text).toContain('1 seat,')
    expect(solo.text).toContain('$40')
  })

  it('escapes what it puts in the page', async () => {
    await sendWorkshopConfirmationEmail({ ...input, workshopName: 'Glitter <b>&</b> Glue', firstName: '<script>' })
    const { html } = mockSendMail.mock.calls[0][0]
    expect(html).not.toContain('<script>')
    expect(html).toContain('Glitter &lt;b&gt;&amp;&lt;/b&gt; Glue')
  })

  it('leaves out what it was not given', async () => {
    await sendWorkshopConfirmationEmail({ ...input, receiptUrl: null, imageUrl: undefined, googleCalendarUrl: undefined, icsContent: undefined, summary: '' })
    const mail = mockSendMail.mock.calls[0][0]
    expect(mail.html).not.toContain('<img')
    expect(mail.html).not.toContain('View your receipt')
    expect(mail.html).not.toContain('Add to Google Calendar')
    expect(mail.attachments ?? []).toHaveLength(0)
  })

  it('lists each seat’s pick and says picks are final', async () => {
    await sendWorkshopConfirmationEmail({
      ...input,
      pickLines: ['Seat 1 · Pumpkin color: Lavender', 'Seat 2 · Pumpkin color: Black'],
      picksFinalLine: 'Picks are made ahead for you, so they can’t be changed after you book.',
    })
    const mail = mockSendMail.mock.calls[0][0]
    expect(mail.text).toContain(
      'Your picks:\n  Seat 1 · Pumpkin color: Lavender\n  Seat 2 · Pumpkin color: Black\nPicks are made ahead for you, so they can’t be changed after you book.',
    )
    expect(mail.html).toContain('Your picks')
    expect(mail.html).toContain('Seat 2 · Pumpkin color: Black')
    expect(mail.html).toContain('can’t be changed after you book.')
  })

  it('escapes the picks in the page', async () => {
    await sendWorkshopConfirmationEmail({ ...input, pickLines: ['Seat 1 · Color: <i>Red</i>'] })
    expect(mockSendMail.mock.calls[0][0].html).toContain('Color: &lt;i&gt;Red&lt;/i&gt;')
  })

  it('says nothing about picks for a class with no questions', async () => {
    await sendWorkshopConfirmationEmail(input)
    const mail = mockSendMail.mock.calls[0][0]
    expect(mail.text).not.toContain('Your picks')
    expect(mail.html).not.toContain('Your picks')
  })

  it('uses the brand brown, not the old one', async () => {
    await sendWorkshopConfirmationEmail(input)
    const { html } = mockSendMail.mock.calls[0][0]
    expect(html).toContain('#7a4a2e')
    expect(html.toLowerCase()).not.toContain('#96705b')
  })

  it('says comped, not $0 paid, for a giveaway seat', async () => {
    await sendWorkshopConfirmationEmail({ ...input, seats: 1, totalChargedCents: 0, comped: true })
    const { text, html } = mockSendMail.mock.calls[0][0]
    expect(text).toContain('Seats: 1 seat, comped')
    expect(html).toContain('<strong>comped</strong>')
    for (const body of [text, html]) expect(body).not.toMatch(/\$0(\.00)? paid/)
  })

  it('reports not sent, without throwing, when mail is not set up', async () => {
    delete process.env.GMAIL_USER
    vi.resetModules()
    const mod = await import('@lib/email')
    expect(await mod.sendWorkshopConfirmationEmail(input)).toEqual({ sent: false })
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  it('reports not sent, without throwing, when sending fails', async () => {
    mockSendMail.mockRejectedValue(new Error('SMTP down'))
    expect(await sendWorkshopConfirmationEmail(input)).toEqual({ sent: false })
  })
})
