// @vitest-environment node
/**
 * A party born from a private-event quote (`origin: 'quote'`) runs through
 * the same party system as a weekend party: its order lines, the payment
 * link, the pay page, the refund line, the crew's money panel, the register
 * note and the owner tools all read it as a private event (no studio fee, no
 * craft minimum, crafts included). A plain weekend party reads exactly as
 * before (the old strings are pinned here).
 *
 * Real email/text code with the transports faked (nodemailer, Quo's HTTP
 * API) and the owner alert faked: nothing leaves the machine.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const m = vi.hoisted(() => ({ sendMail: vi.fn(), alert: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: (...a: any[]) => m.sendMail(...a) }) } }))
vi.mock('@lib/owner-alert', async (orig) => ({
  ...(await orig<typeof import('@lib/owner-alert')>()),
  alertOwners: (...a: any[]) => { m.alert(...a); return Promise.resolve({ attempted: 1, sent: 1 }) },
}))

import { createPartyRecord, type PartyItem, type PartyRecord } from '@lib/party-store'
import { orderLineItems } from '@lib/parties/pricing'
import { extrasOnly, paymentLinkText, sendPaymentLink, whatIsDue } from '@lib/parties/payment-link'
import { crewPartyMoney } from '@lib/parties/staff-money'
import { partyEstimateCents, partyTermsForParty, partyTermsForStart } from '@lib/party-terms'
import { weeknightRegisterNote } from '@lib/party-register'
import { partyRefundBaseCents, quoteStillDueCents, quoteTotalCents, QUOTE_PARTY_LOCKED } from '@lib/parties/quote-party'
import { editPartyDetails, removePartyExtra, PartyActionError } from '@lib/parties/admin-actions'
import { tellLinkPaid } from '@lib/parties/pay-balance'
import { GET as balanceGET } from '../../../src/pages/api/party/balance.json'

const KADEN = { id: 'k', name: 'Kaden' }
const AT = '2026-11-01T00:00:00.000Z'
let n = 0
const nextId = () => `pty_q${String(++n).padStart(15, '0')}`

function item(over: Partial<PartyItem>): PartyItem {
  return { id: 'itm_x', kind: 'package', refId: 'pkg_whole', label: 'Whole studio', qty: 1, unitCents: 30000, cents: 30000, extraMinutes: 0, chargeId: null, addedAt: AT, by: KADEN, ...over }
}

/** Five days out: inside the full-refund window's "less than N days" branch, so the refund line names its base. */
const soonIso = () => new Date(Date.now() + 5 * 24 * 3600_000).toISOString()

function quoteParty(over: Partial<PartyRecord> = {}): PartyRecord {
  return {
    bookingId: nextId(), hostToken: 'host-key-qqqq', craftName: 'Holiday Glow Night',
    startIso: '2026-12-12T00:00:00.000Z', durationMinutes: 120, endIso: '2026-12-12T02:00:00.000Z',
    hostName: 'Jo Park', hostEmail: 'jo@example.com', hostPhone: '256-555-0000',
    guestCount: 30, title: 'Jo’s private event', dropOff: false, createdAt: AT,
    source: 'ours', origin: 'quote', status: 'booked', payToken: 'pay-key-qqqq',
    quote: { quoteId: 'qt_1', tierName: 'Holiday Glow Night', lines: ['Glass terrarium', 'Earring bar'], guests: 30, pricePerPersonCents: 7500 },
    place: 'studio',
    items: [
      item({ id: 'itm_dep', kind: 'quote', refId: 'qt_1', label: 'Deposit', unitCents: 112500, cents: 112500, chargeId: 'chg_1' }),
      item({ id: 'itm_bal', kind: 'quote', refId: 'qt_1', label: 'Balance', unitCents: 112500, cents: 112500, chargeId: null }),
    ],
    charges: [{ id: 'chg_1', via: 'link', orderId: 'ord_1', paymentId: 'pay_1', cents: 112500, quotedCents: 112500, itemIds: ['itm_dep'], receiptUrl: null, at: AT, by: null }],
    refunds: [],
    ...over,
  }
}

function weekendParty(over: Partial<PartyRecord> = {}): PartyRecord {
  return {
    bookingId: nextId(), hostToken: 'host-key-aaaa', craftName: 'Tote Bags',
    startIso: '2026-11-08T19:30:00.000Z', durationMinutes: 90, hostName: 'Alice Smith', hostEmail: 'alice@example.com', hostPhone: '256-555-1234',
    guestCount: 10, title: null, dropOff: false, createdAt: AT,
    source: 'ours', status: 'booked', packageId: 'pkg_whole', payToken: 'pay-key-bbbb',
    items: [item({ id: 'itm_1' })], charges: [], refunds: [],
    ...over,
  }
}

const env = { ...process.env }
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  process.env.GMAIL_USER = 'studio@example.com'
  process.env.GMAIL_APP_PASSWORD = 'app-pass'
  process.env.QUO_API_KEY = 'quo-key'
  process.env.QUO_FROM_NUMBER = '+12564641710'
  delete process.env.STORE_NAMESPACE
  m.sendMail.mockReset().mockResolvedValue({})
  m.alert.mockReset()
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  process.env = { ...env }
  vi.unstubAllGlobals()
})

describe('quote money helpers', () => {
  it('total is guests × the tier price; still due is the total less what is paid; the refund base is the deposit', () => {
    const rec = quoteParty()
    expect(quoteTotalCents(rec)).toBe(225000)
    expect(quoteStillDueCents(rec)).toBe(112500)
    expect(partyRefundBaseCents(rec)).toBe(112500)
    // Before the balance line exists (just after the deposit), still due comes from the tier price.
    expect(quoteStillDueCents(quoteParty({ items: [quoteParty().items![0]] }))).toBe(112500)
  })
  it('a weekend party’s refund base is its package lines, as before', () => {
    expect(partyRefundBaseCents(weekendParty())).toBe(30000)
    expect(partyRefundBaseCents(weekendParty({ items: [] }))).toBeUndefined()
  })
})

describe('order lines', () => {
  it('names a quote item "Private event: <label>"', () => {
    const rec = quoteParty()
    const lines = orderLineItems(rec.items!.filter((it) => it.chargeId === null), '', '')
    expect(lines).toEqual([{ name: 'Private event: Balance', quantity: 1, pricePerUnit: 112500, note: 'qt_1' }])
  })
  it('weekend names are unchanged', () => {
    const items = [item({}), item({ kind: 'addon', refId: 'add_goodie', label: 'Goodie bags', qty: 10, unitCents: 500, cents: 5000 })]
    expect(orderLineItems(items, 'Whole studio', 'pkg_whole').map((l) => l.name)).toEqual(['Whole Studio Party — studio fee', 'Whole Studio Party — Goodie bags'])
    expect(orderLineItems(items, 'Small table', 'pkg_small').map((l) => l.name)).toEqual(['Party — Small table', 'Party — Goodie bags'])
  })
})

describe('payment link', () => {
  const url = 'https://ourhometownstudio.com/party/pay/x?k=y'
  it('the text says private event and what is still due, never crafts at the studio or "held for you"', () => {
    const t = paymentLinkText(quoteParty(), url)
    expect(t).toContain('private event')
    expect(t).toContain('$1,125 still due')
    expect(t).not.toContain('Crafts are paid at the studio')
    expect(t).not.toContain('held for you')
    expect(extrasOnly(quoteParty())).toBe(false)
    expect(whatIsDue(quoteParty())).toBe('your private event')
  })
  it('the email says the same', async () => {
    const rec = quoteParty()
    await createPartyRecord(rec)
    const out = await sendPaymentLink(rec, 'https://ourhometownstudio.com', KADEN)
    expect(out.email).toBe(true)
    const mail = m.sendMail.mock.calls[0][0]
    expect(mail.subject).toBe('Pay for your private event')
    expect(mail.text).toContain('private event')
    expect(mail.text).toContain('$1,125 still due')
    expect(mail.text).not.toContain('Crafts are paid at the studio')
    expect(mail.text).not.toContain('held for you')
  })
  it('weekend text is unchanged', () => {
    expect(paymentLinkText(weekendParty(), url)).toBe(`Hometown Studio here. Your party on Sun, Nov 8 at 1:30 PM is held for you. Pay $300 for the studio fee here to finish booking. Crafts are paid at the studio. ${url}`)
    const extras = weekendParty({ items: [item({ chargeId: 'c1' }), item({ id: 'itm_2', kind: 'addon', refId: 'a', label: 'Goodie bags', qty: 10, unitCents: 500, cents: 5000 })] })
    expect(paymentLinkText(extras, url)).toBe(`Hometown Studio here. Pay $50 for goodie bags, added to your party on Sun, Nov 8 at 1:30 PM. ${url}`)
  })
})

describe('balance.json', () => {
  const get = async (rec: PartyRecord) => {
    const res = await balanceGET({ request: new Request(`http://localhost/api/party/balance.json?id=${rec.bookingId}&k=${rec.payToken}`), clientAddress: `10.0.0.${n}` } as any)
    return { status: res.status, body: await res.json() }
  }
  it('lists the balance line by its label; never "extras only"; the refund line names the deposit', async () => {
    const rec = quoteParty({ startIso: soonIso() })
    await createPartyRecord(rec)
    const { status, body } = await get(rec)
    expect(status).toBe(200)
    expect(body.data.items).toEqual([{ id: 'itm_bal', label: 'Balance', qty: 1, cents: 112500 }])
    expect(body.data.extrasOnly).toBe(false)
    expect(body.data.dueCents).toBe(112500)
    expect(body.data.packageName).toBe('Holiday Glow Night')
    expect(body.data.privateEvent).toBe(true)
    expect(body.data.refundLine).toContain('$1,125')
    expect(body.data.refundLine).not.toContain('$300')
  })
  it('weekend: studio fee label, refund line on the fee', async () => {
    const rec = weekendParty({ startIso: soonIso() })
    await createPartyRecord(rec)
    const { body } = await get(rec)
    expect(body.data.items).toEqual([{ id: 'itm_1', label: 'Studio fee', qty: 1, cents: 30000 }])
    expect(body.data.extrasOnly).toBe(false)
    expect(body.data.refundLine).toContain('$300')
    expect(body.data.privateEvent).toBeUndefined()
  })
})

describe('crew money', () => {
  it('crafts included, nothing to ring up per head', async () => {
    const money = await crewPartyMoney(quoteParty())
    expect(money!.craftsIncluded).toBe(true)
    expect(money!.ringUp.perHeadCents).toBeNull()
  })
  it('weekend: no craftsIncluded key', async () => {
    const money = await crewPartyMoney(weekendParty())
    expect(money).not.toHaveProperty('craftsIncluded')
    expect(money!.ringUp).toEqual({ craftName: 'Tote Bags', perHeadCents: null, guests: 10 })
  })
})

describe('terms and the register', () => {
  it('a quote party has no studio fee and no craft minimum', () => {
    const t = partyTermsForParty(quoteParty())
    expect(t.studioFeeCents).toBe(0)
    expect(t.minimumCents).toBe(0)
    expect(t.chargeNowCents).toBe(0)
    expect(t.durationMinutes).toBe(120)
    expect(partyEstimateCents(t, 0)).toBe(0)
  })
  it('the register note says crafts are included, with no minimum and nothing to collect for crafts', () => {
    const note = weeknightRegisterNote({ kind: 'weekend', paidOnlineCents: 0, origin: 'quote' }, 30)
    expect(note!.headline).toMatch(/private event/i)
    expect(note!.headline).toMatch(/crafts included/i)
    expect(`${note!.headline} ${note!.how}`).not.toMatch(/minimum|discount/i)
    expect(note!.estimate).toBeUndefined()
  })
  it('weekend and weeknight are unchanged', () => {
    const w = weekendParty()
    expect(partyTermsForParty(w)).toEqual(partyTermsForStart(w.startIso))
    expect(weeknightRegisterNote({ kind: 'weekend', paidOnlineCents: 30000 }, 10)).toBeNull()
    expect(weeknightRegisterNote({ kind: 'weeknight', paidOnlineCents: 30000, perHeadCents: 2000 }, 12)).toEqual({
      headline: 'Weeknight party · $300 already paid toward crafts',
      how: 'Ring up the crafts, then tap the Weeknight craft credit discount. Collect what’s left. If the crafts come to $300 or less, there’s nothing more to collect.',
      estimate: '12 crafting at $20 makes $240 in crafts. Collect $0.',
    })
  })
})

describe('owner tools refuse to change a quote', () => {
  const req = () => new Request('http://localhost/api/admin/parties/action.json', { method: 'POST' })
  it('remove-item on a quote line', async () => {
    const rec = quoteParty()
    await createPartyRecord(rec)
    const err = await removePartyExtra({ id: rec.bookingId, itemId: 'itm_bal' }, KADEN, req()).catch((e) => e)
    expect(err).toBeInstanceOf(PartyActionError)
    expect(err.message).toBe('This is a private event quote. Change it with the owners.')
    expect(QUOTE_PARTY_LOCKED).toBe('This is a private event quote. Change it with the owners.')
  })
  it('a guest-count edit', async () => {
    const rec = quoteParty()
    await createPartyRecord(rec)
    const err = await editPartyDetails({ id: rec.bookingId, guests: 32 }, KADEN, req()).catch((e) => e)
    expect(err).toBeInstanceOf(PartyActionError)
    expect(err.message).toBe(QUOTE_PARTY_LOCKED)
  })
})

describe('tellLinkPaid', () => {
  it('first payment (the deposit): private-event confirmation from guests × tier price, no "Party paid" owner text', async () => {
    // The deposit just paid; the balance line isn't on the party yet.
    const rec = quoteParty({ items: [quoteParty().items![0]] })
    await createPartyRecord(rec)
    const out = await tellLinkPaid(rec, rec.charges![0], 'https://ourhometownstudio.com')
    expect(out).toEqual({ kind: 'confirmation', sent: true })
    const mail = m.sendMail.mock.calls[0][0]
    expect(mail.text).toContain('private event')
    expect(mail.text).toContain('30 guests')
    expect(mail.text).toContain('$2,250')
    expect(mail.text).toContain('$1,125 is still due')
    expect(mail.text).toContain('Glass terrarium')
    expect(mail.text).not.toContain('Crafts are paid at the studio')
    expect(mail.text).not.toContain('studio fee')
    expect(m.alert).not.toHaveBeenCalled()
  })
  it('a later payment: a receipt with no crafts line, and the owners hear "Private event paid"', async () => {
    const rec = quoteParty({
      confirmation: { at: AT, sent: true },
      items: [quoteParty().items![0], { ...quoteParty().items![1], chargeId: 'chg_2' }],
      charges: [quoteParty().charges![0], { id: 'chg_2', via: 'link', orderId: 'ord_2', paymentId: 'pay_2', cents: 112500, quotedCents: 112500, itemIds: ['itm_bal'], receiptUrl: null, at: AT, by: null }],
    })
    await createPartyRecord(rec)
    const out = await tellLinkPaid(rec, rec.charges![1], 'https://ourhometownstudio.com')
    expect(out).toEqual({ kind: 'receipt', sent: true })
    const mail = m.sendMail.mock.calls[0][0]
    expect(mail.text).toContain('private event')
    expect(mail.text).not.toContain('Crafts are paid at the studio')
    expect(m.alert).toHaveBeenCalledTimes(1)
    expect(m.alert.mock.calls[0][0]).toMatch(/^Private event paid: Jo Park paid \$1125\.00/)
    expect(m.alert.mock.calls[0][0]).not.toMatch(/Party paid/)
  })
  it('weekend: the owners still get "Party paid"', async () => {
    const rec = weekendParty({
      confirmation: { at: AT, sent: true },
      items: [item({ id: 'itm_1', chargeId: 'chg_w' })],
      charges: [{ id: 'chg_w', via: 'link', orderId: 'o', paymentId: 'p', cents: 30000, quotedCents: 30000, itemIds: ['itm_1'], receiptUrl: null, at: AT, by: null }],
    })
    await createPartyRecord(rec)
    await tellLinkPaid(rec, rec.charges![0], 'https://ourhometownstudio.com')
    expect(m.alert.mock.calls[0][0]).toBe('Party paid: Alice Smith paid $300.00 for the studio fee by payment link, party on Sun, Nov 8 at 1:30 PM.')
    expect(m.sendMail.mock.calls[0][0].text).toContain('Crafts are paid at the studio for whoever comes.')
  })
})
