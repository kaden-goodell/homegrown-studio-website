// tests/lib/magnet-emails.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const { send } = vi.hoisted(() => ({ send: vi.fn().mockResolvedValue({ sent: true }) }))
vi.mock('@lib/email', () => ({ sendEmail: send }))
import { sendMagnetConfirmation, sendMagnetOwnerNotice, sendMagnetStatusEmail } from '@lib/magnet-emails'
import type { MagnetOrder } from '@lib/magnet-status'

const o: MagnetOrder = {
  id: 'M-ABC234', createdAt: '2026-11-09T12:00:00.000Z', status: 'new', draftId: 'x', sets: 2, magnets: [],
  delivery: 'pickup', address: null, contact: { name: 'Test Person', email: 'kaden+m@ourhometownstudio.com', phone: '4029802907' },
  amounts: { subtotalCents: 3600, taxCents: 324, shippingCents: 0, totalCents: 3924 },
  squareOrderId: 's', paymentId: 'p', receiptUrl: null, doneAt: null, photosDeletedAt: null, emailed: {},
}

beforeEach(() => send.mockClear())

describe('magnet emails', () => {
  it('confirms to the customer with count, total and turnaround', async () => {
    await sendMagnetConfirmation(o)
    const msg = send.mock.calls[0][0]
    expect(msg.to).toBe('kaden+m@ourhometownstudio.com')
    expect(msg.subject).toContain('M-ABC234')
    expect(msg.text).toContain('12 photo magnets')
    expect(msg.text).toContain('$39.24')
    expect(msg.text).toContain('7 days')
  })
  it('tells the owners with an admin link', async () => {
    await sendMagnetOwnerNotice(o, 'https://ourhometownstudio.com/admin')
    expect(send.mock.calls.length).toBeGreaterThan(0)
    expect(send.mock.calls[0][0].text).toContain('https://ourhometownstudio.com/admin')
  })
  it('sends ready for pickup and shipped notices only', async () => {
    expect((await sendMagnetStatusEmail(o, 'ready')).sent).toBe(true)
    expect(send.mock.calls[0][0].subject).toContain('ready')
    expect((await sendMagnetStatusEmail(o, 'made')).sent).toBe(false)
  })
})

describe('silhouette emails', () => {
  const one: MagnetOrder = { ...o, product: 'silhouettes', sets: 1, magnets: ['1700000000000-deadbeef'], amounts: { subtotalCents: 2500, taxCents: 225, shippingCents: 0, totalCents: 2725 } }
  const two: MagnetOrder = { ...one, sets: 2, magnets: ['1700000000000-deadbeef', '1700000000001-deadbeef'], delivery: 'ship', address: '1 Main St, Madison AL' }
  it('confirms one framed silhouette, offers decorating, says it not them', async () => {
    await sendMagnetConfirmation(one)
    const msg = send.mock.calls[0][0]
    expect(msg.subject).toBe('Your framed silhouette is ordered (M-ABC234)')
    expect(msg.text).toContain('1 framed silhouette from Hometown Studio')
    expect(msg.text).toContain('pick it up')
    expect(msg.text).toMatch(/decorate the frame/i)
    expect(msg.text).not.toMatch(/magnet/i)
  })
  it('uses the plural and the address for a shipped pair', async () => {
    await sendMagnetConfirmation(two)
    expect(send.mock.calls[0][0].text).toContain('ship them within 7 days to 1 Main St, Madison AL')
    await sendMagnetStatusEmail(two, 'shipped')
    expect(send.mock.calls[1][0].subject).toBe('Your framed silhouettes shipped (M-ABC234)')
    expect(send.mock.calls[1][0].text).toContain('are on their way')
  })
  it('ready email for one says it is ready', async () => {
    await sendMagnetStatusEmail(one, 'ready')
    expect(send.mock.calls[0][0].subject).toBe('Your framed silhouette is ready (M-ABC234)')
    expect(send.mock.calls[0][0].text).toMatch(/decorate the frame/i)
  })
  it('tells the owners it is a silhouette order', async () => {
    await sendMagnetOwnerNotice(two, 'https://x/admin')
    expect(send.mock.calls[0][0].subject).toBe('New silhouette order M-ABC234')
    expect(send.mock.calls[0][0].text).toContain('2 silhouettes')
  })
})
