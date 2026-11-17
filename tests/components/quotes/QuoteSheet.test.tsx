import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { screen, fireEvent, within, waitFor, configure } from '@testing-library/react'
import { InboxProvider } from '@components/admin/inbox/InboxData'
import { QuoteSheet } from '@components/admin/quotes/QuoteSheet'
import { chipText } from '@components/admin/quotes/api'
import { describeItem } from '@components/admin/inbox/describe'
import { at, ok, posts, refuse, renderSheet } from '../admin/sheets/harness'

configure({ asyncUtilTimeout: 5000 })

const NOW = new Date('2026-11-17T18:00:00Z')
const MENU = '/api/admin/quote-menu.json'
const BY = '/api/admin/quotes/by-request.json'
const DRAFT = '/api/admin/quotes/draft.json'
const SAVE = '/api/admin/quotes/save.json'
const SEND = '/api/admin/quotes/send.json'
const ACTION = '/api/admin/quotes/action.json'

let confirmSpy: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  confirmSpy = vi.fn(() => true)
  vi.stubGlobal('confirm', confirmSpy)
})
afterEach(() => {
  // Never a browser dialog, anywhere in the quote sheet.
  expect(confirmSpy).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const request = (over: any = {}) => ({
  id: 'req_1', at: '2026-11-15T15:00:00Z', status: 'new', photos: 0,
  event: { kind: 'team', kindOther: '', date: '2026-12-05', backupDate: '', flexible: false, startTime: '14:00', length: '2', guests: 20, crafters: 'adults', youngest: '' },
  where: { place: 'studio', address: '', setting: '', tables: '', sink: '', setupFrom: '', access: '' },
  craft: { pick: 'ours', vision: '', theme: 'winter', personalized: '', link: '' },
  extras: { food: '', drinks: '', dessert: '', decor: '', tableware: '', favors: '' },
  allergies: '', budget: '1000-2500',
  about: { name: 'Dana Planner', email: 'dana@example.com', phone: '(256) 555-0142', org: '', contactBy: 'text', heard: '' },
  notes: '', ...over,
})
const mug = { itemId: 'sq-V1', label: 'Clay Mugs', photoUrl: 'https://img.example/mug.jpg', cents: 7500, per: 'person', costCents: 1500 }
const cake = { itemId: 'sq-V2', label: 'Cake', photoUrl: null, cents: 50000, per: 'event', costCents: 10000 }
const wreath = { itemId: 'sq-V3', label: 'Wreath', photoUrl: null, cents: 4000, per: 'person', costCents: null }
const tiers = () => [
  // $75 normal, $65: 13% off, green.
  { id: 't1', key: 'simple', name: 'Simple', photoUrl: null, hidden: false, lines: [mug], priceCents: 6500 },
  // $75 + $500 ÷ 20 = $100 normal, $75: 25% off, yellow; costs known → you keep (75 − 20) × 20 = $1,100.
  { id: 't2', key: 'pick', name: 'Our pick', photoUrl: null, hidden: false, lines: [mug, cake], priceCents: 7500 },
  // $140 normal, $98: 30% off, red; a cost unknown → nothing kept shown.
  { id: 't3', key: 'all', name: 'All out', photoUrl: null, hidden: false, lines: [mug, cake, wreath], priceCents: 9800 },
]
const quote = (over: any = {}) => ({
  id: 'q_1', requestId: 'req_1', partyId: 'pty_q1', token: 'tok123', version: 3, priceKey: 'pk', status: 'draft',
  place: 'studio', address: '', startIso: at('2026-12-05', '14:00'), endIso: at('2026-12-05', '16:00'), guests: 20, crafters: 'adults',
  targetCents: 7500, note: '', depositPct: 50, expiresAt: '2026-12-01T18:00:00.000Z', tiers: tiers(), held: false, views: 0, history: [],
  ...over,
})
const menuItems = [
  { id: 'sq-V1', source: 'square', name: 'Clay Mugs', photoUrl: null, cents: 7500, per: 'person', costCents: 1500, tags: ['adults'], hidden: false, updatedAt: '' },
  { id: 'sq-V4', source: 'square', name: 'Hot Cocoa Bar', photoUrl: null, cents: 800, per: 'person', costCents: 200, tags: [], hidden: false, updatedAt: '' },
  { id: 'sq-V5', source: 'square', name: 'Hidden Thing', photoUrl: null, cents: 800, per: 'person', costCents: 200, tags: [], hidden: true, updatedAt: '' },
]
const pkg = { id: 'pkg_1', name: 'Girls night', photoUrl: null, savedAt: '', by: 'Catherine', lines: [{ itemId: null, label: 'Mimosas', photoUrl: null, cents: 1000, per: 'person', costCents: 300 }] }
const settings = { capPct: 25, yellowFromPct: 20, depositPct: 50, expiryDays: 14, updatedAt: 's1' }

function server(o: { quote?: any; req?: any; post?: (path: string, b: any) => any } = {}) {
  return vi.fn(async (url: string, init?: any) => {
    const path = url.split('?')[0]
    const b = init?.method === 'POST' ? JSON.parse(init.body) : null
    if (b && o.post) { const r = o.post(path, b); if (r) return r }
    switch (path) {
      case '/api/admin/event-requests.json': return ok({ data: { requests: [o.req ?? request()] } })
      case '/api/admin/messages.json': return ok({ data: { messages: [] } })
      case '/api/admin/applications.json': return ok({ data: { applications: [] } })
      case '/api/admin/to-decide.json': return ok({ data: { items: [] } })
      case MENU:
        if (b?.action === 'save-package') return ok({ data: { pkg: { ...b.pkg, id: 'pkg_new' }, packages: [pkg, { ...b.pkg, id: 'pkg_new' }] } })
        return ok({ data: { items: menuItems, syncedAt: null, packages: [pkg], settings } })
      case BY: return ok({ data: { quote: o.quote === undefined ? quote() : o.quote, view: null } })
      case DRAFT: return ok({ data: { quote: quote() } })
      case SAVE: return ok({ data: { quote: { ...b.quote, version: b.version + 1 } } })
      case SEND: return ok({ data: { quote: quote({ ...(o.quote ?? {}), status: 'sent', sentAt: NOW.toISOString(), held: !b.noHold }), texted: true, emailed: true } })
      case ACTION: {
        const status = b.action === 'withdraw' ? 'withdrawn' : b.action === 'reopen' ? 'sent' : (o.quote?.status ?? 'sent')
        return ok({ data: { quote: quote({ ...(o.quote ?? {}), status, sentAt: '2026-11-16T15:00:00Z', expiresAt: '2026-12-01T18:00:00.000Z' }) } })
      }
    }
    throw new Error(`unexpected ${url}`)
  })
}

async function open(f = server()) {
  vi.stubGlobal('fetch', f)
  const r = renderSheet(<InboxProvider><QuoteSheet id="req_1" /></InboxProvider>)
  await waitFor(() => expect(screen.queryByText(/Loading the quote/)).toBeNull())
  return { f, ...r }
}
const card = (n: number) => screen.getByRole('region', { name: `Package ${n}` })
const footer = () => document.querySelector('.adm-sheet-foot') as HTMLElement
const box = (label: string, within_: HTMLElement = document.body) => within(within_).getByLabelText(label) as HTMLInputElement
const lastSave = (f: any) => posts(f, SAVE).at(-1)!.body

describe('Quote sheet: the packages', () => {
  it('shows three package cards with normal → price, the total, the meter colour and what you keep', async () => {
    await open()
    expect(await screen.findByRole('heading', { name: 'Quote for Dana' })).toBeInTheDocument()
    expect(screen.getByText(/Dana Planner · \(256\) 555-0142 · dana@example.com/)).toBeInTheDocument()
    expect(screen.getAllByRole('region', { name: /^Package/ })).toHaveLength(3)
    const pick = card(2)
    expect(within(pick).getByText('$100 → $75')).toBeInTheDocument()
    expect(within(pick).getByText('$1,500')).toBeInTheDocument()
    expect(pick.querySelector('.adm-qmeter')).toHaveClass('is-yellow')
    expect(within(pick).getByText('You keep about $1,100 after materials.')).toBeInTheDocument()
    expect(card(1).querySelector('.adm-qmeter')).toHaveClass('is-green')
    expect(card(3).querySelector('.adm-qmeter')).toHaveClass('is-red')
    expect(within(card(3)).getByText('More than 25% off')).toBeInTheDocument()
    expect(within(card(3)).queryByText(/You keep/)).toBeNull()
    expect(screen.getByText('Draft')).toBeInTheDocument()
  })

  it('remove, add from the menu, one-off line, saved package, rename, price and hide all change the draft and mark it unsaved', async () => {
    const { f, dirty } = await open()
    await screen.findByRole('heading', { name: 'Quote for Dana' })
    expect(dirty()).toBe(false)
    // Remove the cake from Our pick.
    fireEvent.click(within(card(2)).getByRole('button', { name: 'Remove Cake' }))
    expect(dirty()).toBe(true)
    expect(within(card(2)).getByText('$75 → $75')).toBeInTheDocument()
    // Add from the menu: search finds it; hidden items aren't offered.
    fireEvent.click(within(card(2)).getByRole('button', { name: '+ Add item' }))
    fireEvent.change(within(card(2)).getByLabelText('Search the menu'), { target: { value: 'cocoa' } })
    expect(within(card(2)).queryByRole('button', { name: 'Add Clay Mugs' })).toBeNull()
    fireEvent.change(within(card(2)).getByLabelText('Search the menu'), { target: { value: '' } })
    expect(within(card(2)).queryByRole('button', { name: 'Add Hidden Thing' })).toBeNull()
    fireEvent.change(within(card(2)).getByLabelText('Search the menu'), { target: { value: 'cocoa' } })
    fireEvent.click(within(card(2)).getByRole('button', { name: 'Add Hot Cocoa Bar' }))
    // A one-off line.
    fireEvent.click(within(card(2)).getByRole('button', { name: '+ One-off line' }))
    fireEvent.change(box('Line name', card(2)), { target: { value: 'Travel' } })
    fireEvent.change(box('Price ($)', card(2)), { target: { value: '50' } })
    fireEvent.click(within(card(2)).getByRole('button', { name: 'For the event' }))
    fireEvent.click(within(card(2)).getByRole('button', { name: 'Add line' }))
    // A saved package's lines.
    fireEvent.click(within(card(1)).getByRole('button', { name: '+ Saved package' }))
    fireEvent.click(within(card(1)).getByRole('button', { name: 'Add Girls night' }))
    // Rename, price, hide.
    fireEvent.change(box('Package name', card(1)), { target: { value: 'Cozy' } })
    fireEvent.change(box('Their price per person ($)', card(2)), { target: { value: '80' } })
    fireEvent.click(within(card(3)).getByRole('button', { name: 'Hide from the customer' }))
    expect(within(card(3)).getByRole('button', { name: 'Show to the customer' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(within(footer()).getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved.')
    const b = lastSave(f)
    expect(posts(f, SAVE)[0].body.version).toBe(3)
    expect(b.quote.tiers[0]).toMatchObject({ name: 'Cozy', lines: [mug, pkg.lines[0]] })
    expect(b.quote.tiers[1].priceCents).toBe(8000)
    expect(b.quote.tiers[1].lines.map((l: any) => l.label)).toEqual(['Clay Mugs', 'Hot Cocoa Bar', 'Travel'])
    expect(b.quote.tiers[1].lines[2]).toEqual({ itemId: null, label: 'Travel', photoUrl: null, cents: 5000, per: 'event', costCents: null })
    expect(b.quote.tiers[2].hidden).toBe(true)
    expect(dirty()).toBe(false)
  })

  it('note, deposit %, reply-by and the facts save with the quote', async () => {
    const { f, dirty } = await open()
    await screen.findByRole('heading', { name: 'Quote for Dana' })
    fireEvent.change(box('Note to the customer'), { target: { value: 'Can’t wait!' } })
    fireEvent.change(box('Deposit (%)'), { target: { value: '30' } })
    fireEvent.change(box('Reply by'), { target: { value: '2026-11-28' } })
    fireEvent.change(box('Start time'), { target: { value: '15:00' } })
    fireEvent.change(box('How long (hours)'), { target: { value: '3' } })
    fireEvent.change(box('Guests'), { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: 'At their place' }))
    fireEvent.change(box('Their address'), { target: { value: '9 Oak Ln' } })
    expect(dirty()).toBe(true)
    fireEvent.click(within(footer()).getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved.')
    const b = lastSave(f).quote
    expect(b).toMatchObject({ note: 'Can’t wait!', depositPct: 30, guests: 25, place: 'away', address: '9 Oak Ln' })
    expect(b.startIso).toBe(at('2026-12-05', '15:00'))
    expect(Date.parse(b.endIso) - Date.parse(b.startIso)).toBe(3 * 3_600_000)
    expect(b.expiresAt).toBe(at('2026-11-28', '23:59'))
  })

  it('a new target price rebuilds the packages only after "This replaces the packages"', async () => {
    const { dirty } = await open()
    await screen.findByRole('heading', { name: 'Quote for Dana' })
    fireEvent.change(box('Target price per person ($)'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Build packages around $10' }))
    const ask = screen.getByRole('group', { name: 'Replace the packages?' })
    expect(within(ask).getByText('This replaces the packages.')).toBeInTheDocument()
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep them' }))
    expect(screen.getAllByRole('region', { name: /^Package/ })).toHaveLength(3)
    expect(dirty()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Build packages around $10' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Replace the packages?' })).getByRole('button', { name: 'Replace' }))
    // $10 a head only fits the cocoa bar ($8, within $10 ÷ 0.75).
    const cards = screen.getAllByRole('region', { name: /^Package/ })
    expect(within(cards[0]).getByText('Hot Cocoa Bar')).toBeInTheDocument()
    expect(dirty()).toBe(true)
  })

  it('Save as package posts the package to the quote menu', async () => {
    const { f } = await open()
    await screen.findByRole('heading', { name: 'Quote for Dana' })
    fireEvent.click(within(card(2)).getByRole('button', { name: 'Save as package' }))
    expect(await within(card(2)).findByText('Saved “Our pick” to your packages.')).toBeInTheDocument()
    expect(posts(f, MENU)[0].body).toEqual({ action: 'save-package', pkg: { name: 'Our pick', photoUrl: null, lines: [mug, cake] } })
  })
})

describe('Quote sheet: sending', () => {
  it('a red package asks in the sheet first, then sends with overCapOk and the text/email choice', async () => {
    const { f } = await open()
    await screen.findByRole('heading', { name: 'Quote for Dana' })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Send to Dana' }))
    const panel = screen.getByRole('group', { name: 'Send the quote' })
    fireEvent.click(within(panel).getByLabelText(/Email dana@example.com/))
    fireEvent.click(within(panel).getByRole('button', { name: 'Send now' }))
    const ask = screen.getByRole('group', { name: 'More than the limit off' })
    expect(within(ask).getByText('A package is more than 25% off its normal price.')).toBeInTheDocument()
    expect(posts(f, SEND)).toHaveLength(0)
    fireEvent.click(within(ask).getByRole('button', { name: 'Send anyway' }))
    expect(await screen.findByText('Sent to Dana by text.')).toBeInTheDocument()
    expect(posts(f, SEND).map((p: any) => p.body)).toEqual([{ id: 'q_1', text: true, email: false, overCapOk: true }])
    expect(screen.getByText('Sent')).toBeInTheDocument()
  })

  it('unsaved edits are saved before sending', async () => {
    const t = tiers().slice(0, 2)
    const { f } = await open(server({ quote: quote({ tiers: t }) }))
    await screen.findByRole('heading', { name: 'Quote for Dana' })
    fireEvent.change(box('Note to the customer'), { target: { value: 'Hi!' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Send to Dana' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Send the quote' })).getByRole('button', { name: 'Send now' }))
    await screen.findByText(/^Sent to Dana/)
    expect(lastSave(f).quote.note).toBe('Hi!')
    expect(posts(f, SEND)[0].body).toEqual({ id: 'q_1', text: true, email: true })
    const order = f.mock.calls.map((c: any) => c[0]).filter((u: string) => u === SAVE || u === SEND)
    expect(order).toEqual([SAVE, SEND])
  })

  it('a taken time names the clash; at the studio it offers Send without holding', async () => {
    const t = tiers().slice(0, 2)
    const f = server({
      quote: quote({ tiers: t }),
      post: (path, b) => (path === SEND && !b.noHold ? refuse(409, { error: 'That time is taken.', why: 'time_taken', clash: { label: 'Pottery', startIso: at('2026-12-05', '14:00') } }) : null),
    })
    await open(f)
    await screen.findByRole('heading', { name: 'Quote for Dana' })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Send to Dana' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Send the quote' })).getByRole('button', { name: 'Send now' }))
    const clash = await screen.findByRole('group', { name: 'That time is taken' })
    expect(within(clash).getByText('Pottery · Sat Dec 5 · 2 PM')).toBeInTheDocument()
    expect(within(clash).getByRole('button', { name: 'Pick another time' })).toBeInTheDocument()
    fireEvent.click(within(clash).getByRole('button', { name: 'Send without holding' }))
    expect(await screen.findByText(/The time isn’t held\./)).toBeInTheDocument()
    expect(posts(f, SEND).at(-1)!.body).toEqual({ id: 'q_1', text: true, email: true, noHold: true })
  })

  it('away from the studio, a clash has only Pick another time, which goes back to the date', async () => {
    const f = server({
      quote: quote({ tiers: tiers().slice(0, 2), place: 'away', address: '9 Oak Ln' }),
      post: (path) => (path === SEND ? refuse(409, { error: 'That time is taken.', why: 'time_taken', clash: { label: 'Pottery', startIso: at('2026-12-05', '14:00') } }) : null),
    })
    await open(f)
    await screen.findByRole('heading', { name: 'Quote for Dana' })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Send to Dana' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Send the quote' })).getByRole('button', { name: 'Send now' }))
    const clash = await screen.findByRole('group', { name: 'That time is taken' })
    expect(within(clash).queryByRole('button', { name: 'Send without holding' })).toBeNull()
    fireEvent.click(within(clash).getByRole('button', { name: 'Pick another time' }))
    expect(document.activeElement).toBe(box('Date'))
  })
})

describe('Quote sheet: by status', () => {
  it('sent: Send again, Withdraw (asked in the sheet), Preview and Flyer links; saving warns about Updated', async () => {
    const { f } = await open(server({ quote: quote({ status: 'sent', sentAt: '2026-11-16T15:00:00Z', views: 2, tiers: tiers().slice(0, 2) }) }))
    await screen.findByRole('heading', { name: 'Quote for Dana' })
    expect(screen.getByText('Viewed 2×')).toBeInTheDocument()
    expect(within(footer()).getByRole('button', { name: 'Send again to Dana' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Preview their page' })).toHaveAttribute('href', '/quote/tok123')
    expect(screen.getByRole('link', { name: 'Preview their page' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'Flyer' })).toHaveAttribute('href', '/admin/quote/q_1/flyer')
    fireEvent.change(box('Note to the customer'), { target: { value: 'x' } })
    expect(screen.getByText(/The customer will see “Updated”/)).toBeInTheDocument()
    expect(within(footer()).getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
    fireEvent.change(box('Note to the customer'), { target: { value: '' } })

    fireEvent.click(within(footer()).getByRole('button', { name: 'Send again to Dana' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Send it again' })).getByRole('button', { name: 'Send now' }))
    await screen.findByText(/^Sent again to Dana/)
    expect(posts(f, ACTION)[0].body).toEqual({ id: 'q_1', action: 'resend', text: true, email: true })

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
    const ask = screen.getByRole('group', { name: 'Withdraw this quote?' })
    expect(posts(f, ACTION)).toHaveLength(1)
    fireEvent.click(within(ask).getByRole('button', { name: 'Withdraw' }))
    expect(await screen.findByText('Quote withdrawn.')).toBeInTheDocument()
    expect(posts(f, ACTION)[1].body).toEqual({ id: 'q_1', action: 'withdraw' })
    expect(within(footer()).getByRole('button', { name: 'Reopen' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Note to the customer')).toBeNull()
  })

  it('a sent quote saved past the cap asks first, then saves with overCapOk', async () => {
    const { f } = await open(server({ quote: quote({ status: 'sent', sentAt: '2026-11-16T15:00:00Z' }) }))
    await screen.findByRole('heading', { name: 'Quote for Dana' })
    fireEvent.change(box('Note to the customer'), { target: { value: 'x' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Save changes' }))
    const ask = screen.getByRole('group', { name: 'More than the limit off' })
    expect(posts(f, SAVE)).toHaveLength(0)
    fireEvent.click(within(ask).getByRole('button', { name: 'Save anyway' }))
    await screen.findByText(/^Saved\. The customer will see/)
    expect(posts(f, SAVE)[0].body.overCapOk).toBe(true)
  })

  it('withdrawn and expired quotes offer Reopen', async () => {
    const { f } = await open(server({ quote: quote({ status: 'withdrawn', sentAt: '2026-11-16T15:00:00Z' }) }))
    await screen.findByRole('heading', { name: 'Quote for Dana' })
    expect(screen.getByText('Withdrawn', { selector: '.adm-tag' })).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Reopen' }))
    expect(await screen.findByText(/^Reopened/)).toBeInTheDocument()
    expect(posts(f, ACTION)[0].body).toEqual({ id: 'q_1', action: 'reopen' })
  })

  it('expired: still editable, chip says Expired, Reopen in the footer', async () => {
    await open(server({ quote: quote({ status: 'sent', sentAt: '2026-11-01T15:00:00Z', expiresAt: '2026-11-15T15:00:00.000Z' }) }))
    await screen.findByRole('heading', { name: 'Quote for Dana' })
    expect(screen.getByText('Expired', { selector: '.adm-tag' })).toBeInTheDocument()
    expect(within(footer()).getByRole('button', { name: 'Reopen' })).toBeInTheDocument()
    expect(box('Note to the customer')).toBeInTheDocument()
  })

  it('paid: read-only, with a link to the party', async () => {
    const { sheet } = await open(server({ quote: quote({ status: 'paid', paidAt: '2026-11-17T15:00:00Z', sentAt: '2026-11-16T15:00:00Z' }) }))
    await screen.findByRole('heading', { name: 'Quote for Dana' })
    expect(screen.getByText('Paid', { selector: '.adm-tag' })).toBeInTheDocument()
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Open the party' }))
    expect(sheet.open).toHaveBeenCalledWith({ kind: 'party', day: '2026-12-05', id: 'pty_q1' })
  })

  it('no quote yet: Make a quote drafts one', async () => {
    const { f } = await open(server({ quote: null }))
    fireEvent.click(await within(footer()).findByRole('button', { name: 'Make a quote' }))
    expect(await screen.findByRole('region', { name: 'Package 1' })).toBeInTheDocument()
    expect(posts(f, DRAFT)[0].body).toEqual({ requestId: 'req_1' })
  })

  it('no quote on a Booked request: asks in the sheet, then drafts with force', async () => {
    const { f } = await open(server({ quote: null, req: request({ status: 'booked' }) }))
    await waitFor(() => expect(f.mock.calls.some((c: any) => c[0] === '/api/admin/event-requests.json')).toBe(true))
    await new Promise((r) => setTimeout(r, 0))
    fireEvent.click(await within(footer()).findByRole('button', { name: 'Make a quote' }))
    const ask = screen.getByRole('group', { name: 'Make a quote anyway?' })
    expect(within(ask).getByText('This request is already Booked. Make a quote anyway?')).toBeInTheDocument()
    fireEvent.click(within(ask).getByRole('button', { name: 'Make a quote' }))
    await screen.findByRole('region', { name: 'Package 1' })
    expect(posts(f, DRAFT)[0].body).toEqual({ requestId: 'req_1', force: true })
  })
})

describe('Quote words', () => {
  it('chip text per status', () => {
    expect(['draft', 'sent', 'picked', 'paying', 'paid', 'expired', 'withdrawn'].map((s) => chipText(s as any))).toEqual(
      ['Draft', 'Sent', 'Picked', 'Paying', 'Paid', 'Expired', 'Withdrawn'])
    expect(chipText('sent', 2)).toBe('Viewed 2×')
  })
  it('Next: Make a quote, then waiting on them since it was sent', () => {
    const r = request() as any
    expect(describeItem('request', r).next).toBe('Make a quote')
    expect(describeItem('request', { ...r, status: 'quoted' }, { status: 'sent', sentAt: '2026-11-16T15:00:00Z' }).next).toBe('Waiting on them: quote sent Mon Nov 16')
    expect(describeItem('request', r, { status: 'draft', sentAt: null }).next).toBe('Finish the quote and send it')
    expect(describeItem('request', { ...r, status: 'booked' }, { status: 'paid', sentAt: '2026-11-16T15:00:00Z' }).next).toBe('')
  })
})
