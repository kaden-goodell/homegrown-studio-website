import { describe, it, expect, vi, beforeEach } from 'vitest'

const updateEmail = vi.fn()
vi.mock('@config/providers', () => ({ providers: { customer: { updateEmail: (...a: unknown[]) => updateEmail(...a) } } }))
const sendEmail = vi.fn()
vi.mock('@lib/email', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }))
const alertOwners = vi.fn()
vi.mock('@lib/owner-alert', () => ({ alertOwners: (...a: unknown[]) => alertOwners(...a) }))
const updateSeatChoiceEmail = vi.fn()
vi.mock('@lib/seat-choices', () => ({ updateSeatChoiceEmail: (...a: unknown[]) => updateSeatChoiceEmail(...a) }))
const getPartyRecord = vi.fn()
const savePartyRecord = vi.fn()
vi.mock('@lib/party-store', () => ({ getPartyRecord: (...a: unknown[]) => getPartyRecord(...a), savePartyRecord: (...a: unknown[]) => savePartyRecord(...a) }))
const getConfirmationCopy = vi.fn()
vi.mock('@lib/confirmation-copies', () => ({ getConfirmationCopy: (...a: unknown[]) => getConfirmationCopy(...a), noteResent: vi.fn(async () => {}) }))

import { POST } from '../../src/pages/api/booking/fix-email.json'
import { issueEmailFixTicket, readEmailFixTicket, type EmailFixTicket } from '@lib/email-fix'

const TYPO = 'meredithblackphptography@gmail.com'
const RIGHT = 'meredithblackphotography@gmail.com'
const ticket = (over: Partial<EmailFixTicket> = {}): EmailFixTicket => ({ kind: 'workshop', bookingId: 'clsbk_1', customerId: 'C1', typed: TYPO, onFile: null, matchedBy: 'new', eventId: 'clssch_1', ...over })
let ip = 0
const call = (body: unknown) =>
  (POST as any)({ clientAddress: `10.0.0.${++ip}`, request: new Request('http://localhost/api/booking/fix-email.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })

beforeEach(() => {
  vi.clearAllMocks()
  sendEmail.mockResolvedValue({ sent: true })
  alertOwners.mockResolvedValue({ attempted: 1, sent: 1 })
  getConfirmationCopy.mockResolvedValue({ kind: 'workshop', bookingId: 'clsbk_1', subject: 'You’re booked', html: '<p>hi</p>', text: 'hi', sentTo: [TYPO], at: '' })
})

describe('POST /api/booking/fix-email.json', () => {
  it('resends the same confirmation to the fixed address, fixes the booking record and the new Square record', async () => {
    const res = await call({ token: issueEmailFixTicket(ticket()), email: RIGHT })
    expect(res.status).toBe(200)
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: RIGHT, subject: 'You’re booked', html: '<p>hi</p>' }))
    expect(updateSeatChoiceEmail).toHaveBeenCalledWith('clssch_1', 'clsbk_1', RIGHT)
    expect(updateEmail).toHaveBeenCalledWith('C1', RIGHT)
    expect(alertOwners).not.toHaveBeenCalled()
    const { data } = await res.json()
    expect(data.resent).toBe(true)
    expect(readEmailFixTicket(data.token)?.typed).toBe(RIGHT)
  })

  it('choosing the on-file email only settles the record — both already have the confirmation', async () => {
    const res = await call({ token: issueEmailFixTicket(ticket({ matchedBy: 'phone', onFile: RIGHT })), email: RIGHT })
    expect(res.status).toBe(200)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(updateEmail).not.toHaveBeenCalled()
    expect(alertOwners).not.toHaveBeenCalled()
  })

  it('choosing the typed one over the on-file one changes Square', async () => {
    await call({ token: issueEmailFixTicket(ticket({ matchedBy: 'phone', onFile: RIGHT, typed: TYPO })), email: TYPO })
    expect(updateEmail).toHaveBeenCalledWith('C1', TYPO)
  })

  it('never hands someone else’s Square profile a wholly different email; tells the owners instead', async () => {
    const res = await call({ token: issueEmailFixTicket(ticket({ matchedBy: 'phone', typed: 'someone@gmail.com' })), email: 'attacker@example.com' })
    expect(res.status).toBe(200)
    expect(updateEmail).not.toHaveBeenCalled()
    expect(alertOwners).toHaveBeenCalledWith(expect.stringContaining('attacker@example.com'))
  })

  it('updates a party’s host email', async () => {
    getPartyRecord.mockResolvedValue({ bookingId: 'pb_1', hostEmail: TYPO })
    await call({ token: issueEmailFixTicket(ticket({ kind: 'party', bookingId: 'pb_1', eventId: undefined })), email: RIGHT })
    expect(savePartyRecord).toHaveBeenCalledWith(expect.objectContaining({ hostEmail: RIGHT }))
  })

  it('refuses a forged or missing ticket, and a bad email', async () => {
    expect((await call({ token: 'nope', email: RIGHT })).status).toBe(403)
    expect((await call({ token: issueEmailFixTicket(ticket()), email: 'not-an-email' })).status).toBe(400)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(updateEmail).not.toHaveBeenCalled()
  })

  it('says to text us when there is no copy to resend', async () => {
    getConfirmationCopy.mockResolvedValue(null)
    const res = await call({ token: issueEmailFixTicket(ticket()), email: RIGHT })
    expect(res.status).toBe(409)
    expect(updateEmail).not.toHaveBeenCalled()
  })
})
