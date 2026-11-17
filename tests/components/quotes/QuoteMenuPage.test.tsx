import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { screen, fireEvent, within, waitFor, configure } from '@testing-library/react'
import { QuoteMenuPage } from '@components/admin/quotes/QuoteMenuPage'
import { centsFromDollars } from '@components/admin/quotes/api'
import { homeTabOf, isFormSheet, parseHash, parseSheet, sheetToken } from '@components/admin/shell/router'
import { ok, posts, refuse, renderSheet } from '../admin/sheets/harness'

vi.mock('@components/admin/classes/photo', async (orig) => ({
  ...(await orig<typeof import('@components/admin/classes/photo')>()),
  uploadPhoto: vi.fn(async () => ({ url: 'https://img.example/new.jpg' })),
}))

configure({ asyncUtilTimeout: 5000 })

const MENU = '/api/admin/quote-menu.json'
const NOW = new Date('2026-11-17T18:00:00Z')
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

const item = (over: Record<string, any> = {}) => ({
  id: 'sq-V1', source: 'square', squareItemId: 'I1', squareVariationId: 'V1', name: 'Clay Mugs', photoUrl: 'https://img.example/mug.jpg',
  cents: 3500, per: 'person', costCents: 400, tags: ['clay'], hidden: false, updatedAt: '2026-11-16T15:00:00Z', ...over,
})
const items = () => [
  item(),
  item({ id: 'sq-V2', squareVariationId: 'V2', name: 'Charcuterie Board', cents: 12000, per: 'event', costCents: null, tags: ['food'], photoUrl: null }),
  item({ id: 'sq-V3', squareVariationId: 'V3', name: 'Old Candles', cents: 2000, tags: [], hidden: true, gone: true }),
  item({ id: 'own_travel', source: 'own', squareItemId: undefined, squareVariationId: undefined, name: 'Travel', cents: 5000, per: 'event', costCents: null, tags: [], photoUrl: null }),
]
const pkg = (over: Record<string, any> = {}) => ({
  id: 'pkg_1', name: 'Girls night', photoUrl: null, savedAt: '2026-11-10T15:00:00Z', by: 'Catherine',
  lines: [{ itemId: 'sq-V1', label: 'Clay Mugs', photoUrl: null, cents: 3500, per: 'person', costCents: 400 }, { itemId: null, label: 'Cake', photoUrl: null, cents: 4000, per: 'event', costCents: null }],
  ...over,
})
const settings = (over: Record<string, any> = {}) => ({ capPct: 25, yellowFromPct: 20, depositPct: 50, expiryDays: 14, updatedAt: 's1', ...over })

function server(o: { post?: (b: any) => any; get?: () => any } = {}) {
  return vi.fn(async (url: string, init?: any) => {
    if (url.split('?')[0] !== MENU) throw new Error(`unexpected ${url}`)
    if (init?.method !== 'POST') return o.get ? o.get() : ok({ data: { items: items(), syncedAt: '2026-11-16T15:00:00Z', packages: [pkg()], settings: settings() } })
    const b = JSON.parse(init.body)
    if (o.post) { const r = o.post(b); if (r) return r }
    if (b.action === 'sync-square') return ok({ data: { items: [...items(), item({ id: 'sq-V9', squareVariationId: 'V9', name: 'Wreaths' })], syncedAt: '2026-11-17T18:00:00Z' } })
    if (b.action === 'save-item') return ok({ data: { item: { ...item(), ...b.item, id: b.item.id ?? 'own_new', source: b.item.id ? 'square' : 'own', updatedAt: 'now' } } })
    if (b.action === 'save-package') return ok({ data: { pkg: b.pkg, packages: [b.pkg] } })
    if (b.action === 'delete-package') return ok({ data: { packages: [] } })
    if (b.action === 'save-settings') return ok({ data: { settings: { ...settings(), ...b.settings, updatedAt: 's2' } } })
    return refuse(400, { error: 'Unknown action.' })
  })
}
const footer = () => document.querySelector('.adm-sheet-foot') as HTMLElement
const list = () => screen.getByRole('list', { name: 'Menu items' })
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement

describe('Quote menu: the address', () => {
  it('#more-quote-menu opens the page under More; #quote-<id> is a form sheet under Inbox', () => {
    expect(parseHash('#more-quote-menu')).toEqual({ sheet: { kind: 'more', page: 'quote-menu' } })
    expect(sheetToken({ kind: 'more', page: 'quote-menu' })).toBe('more-quote-menu')
    expect(parseSheet('more-quote-menu')).toEqual({ kind: 'more', page: 'quote-menu' })
    expect(parseHash('#quote-2026-11-17-abcdef12')).toEqual({ sheet: { kind: 'quote', id: '2026-11-17-abcdef12' } })
    expect(parseSheet(sheetToken({ kind: 'quote', id: 'req_1' })!)).toEqual({ kind: 'quote', id: 'req_1' })
    expect(homeTabOf({ kind: 'quote', id: 'req_1' })).toBe('inbox')
    expect(isFormSheet({ kind: 'quote', id: 'req_1' })).toBe(true)
    expect(homeTabOf({ kind: 'more', page: 'quote-menu' })).toBe('more')
  })
})

describe('Quote menu: money in dollars', () => {
  it('reads dollars as cents; empty and junk are null; zero is fine', () => {
    expect(centsFromDollars('35')).toBe(3500)
    expect(centsFromDollars('$12.50')).toBe(1250)
    expect(centsFromDollars(' 0 ')).toBe(0)
    expect(centsFromDollars('')).toBeNull()
    expect(centsFromDollars('ten')).toBeNull()
    expect(centsFromDollars('1.234')).toBeNull()
  })
})

describe('Quote menu: the list', () => {
  it('shows each item with its price, cost and badges, and when Square was last loaded', async () => {
    vi.stubGlobal('fetch', server())
    renderSheet(<QuoteMenuPage />)
    const mugs = await screen.findByRole('button', { name: /Clay Mugs/ })
    expect(within(mugs).getByText('$35 / person · Cost $4')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /Charcuterie Board/ })).getByText('$120 / event')).toBeInTheDocument()
    const old = screen.getByRole('button', { name: /Old Candles/ })
    expect(within(old).getByText('Hidden')).toBeInTheDocument()
    expect(within(old).getByText('Gone from Square')).toBeInTheDocument()
    expect(screen.getByText(/Last loaded from Square Mon Nov 16/)).toBeInTheDocument()
  })
  it('search narrows by name; a tag chip narrows by tag', async () => {
    vi.stubGlobal('fetch', server())
    renderSheet(<QuoteMenuPage />)
    await screen.findByRole('button', { name: /Clay Mugs/ })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the menu' }), { target: { value: 'board' } })
    expect(within(list()).getAllByRole('button')).toHaveLength(1)
    expect(within(list()).getByRole('button', { name: /Charcuterie/ })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the menu' }), { target: { value: '' } })
    fireEvent.click(within(screen.getByRole('group', { name: 'Show tag' })).getByRole('button', { name: 'clay' }))
    expect(within(list()).getAllByRole('button')).toHaveLength(1)
    expect(within(list()).getByRole('button', { name: /Clay Mugs/ })).toBeInTheDocument()
  })
  it('Load from Square posts sync-square and shows the new items', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    renderSheet(<QuoteMenuPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Load from Square' }))
    expect(await screen.findByRole('button', { name: /Wreaths/ })).toBeInTheDocument()
    expect(posts(f, MENU).map((p: any) => p.body.action)).toEqual(['sync-square'])
    expect(screen.getByText(/Last loaded from Square Tue Nov 17/)).toBeInTheDocument()
  })
  it('a failed load says so in plain words and keeps the list', async () => {
    vi.stubGlobal('fetch', server({ post: (b) => (b.action === 'sync-square' ? refuse(502, { error: 'Square didn’t answer. Try again in a minute.', why: 'sync_failed' }) : null) }))
    renderSheet(<QuoteMenuPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Load from Square' }))
    expect(await screen.findByText('Square didn’t answer. Try again in a minute.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Clay Mugs/ })).toBeInTheDocument()
  })
})

describe('Quote menu: the item editor', () => {
  it('a Square item: name and price come from Square; per, cost, tags and hidden are hers; Save posts save-item', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    const { dirty } = renderSheet(<QuoteMenuPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Charcuterie Board/ }))
    expect(screen.getByText(/come from Square/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Name')).toBeNull()
    expect(screen.queryByRole('button', { name: /Choose photo|Change/ })).toBeNull()
    fireEvent.click(within(screen.getByRole('group', { name: 'Price is' })).getByRole('button', { name: 'Per person' }))
    fireEvent.change(field('What it costs us ($)'), { target: { value: '22.50' } })
    fireEvent.change(field('New tag'), { target: { value: 'Grown-ups' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag food' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Hide from new quotes/ }))
    expect(dirty()).toBe(true)
    fireEvent.click(within(footer()).getByRole('button', { name: 'Save' }))
    await screen.findByRole('list', { name: 'Menu items' })
    const [save] = posts(f, MENU)
    expect(save.body).toEqual({
      action: 'save-item',
      item: { id: 'sq-V2', name: 'Charcuterie Board', cents: 12000, per: 'person', costCents: 2250, tags: ['grown-ups'], hidden: true, photoUrl: null },
    })
    expect(await screen.findByText('Saved Charcuterie Board.')).toBeInTheDocument()
  })
  it('+ Add your own item: name, price in dollars, per event, a photo', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    renderSheet(<QuoteMenuPage />)
    await screen.findByRole('button', { name: /Clay Mugs/ })
    fireEvent.click(within(footer()).getByRole('button', { name: '+ Add your own item' }))
    fireEvent.click(within(footer()).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Give the item a name.')).toBeInTheDocument()
    fireEvent.change(field('Name'), { target: { value: 'Travel' } })
    fireEvent.change(field('Price ($)'), { target: { value: '75' } })
    fireEvent.click(within(screen.getByRole('group', { name: 'Price is' })).getByRole('button', { name: 'Per event' }))
    fireEvent.change(screen.getByLabelText('Photo'), { target: { files: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] } })
    await screen.findByRole('button', { name: 'Change' })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Save' }))
    await screen.findByRole('list', { name: 'Menu items' })
    expect(posts(f, MENU)[0].body.item).toEqual({ name: 'Travel', cents: 7500, per: 'event', costCents: null, tags: [], hidden: false, photoUrl: 'https://img.example/new.jpg' })
  })
  it('a price that isn’t a number is caught before saving', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    renderSheet(<QuoteMenuPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Travel/ }))
    fireEvent.change(field('Price ($)'), { target: { value: 'fifty' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Type the price in dollars, like 35.')).toBeInTheDocument()
    expect(posts(f, MENU)).toHaveLength(0)
  })
  it('going back with changes asks in the sheet, never a browser dialog', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    vi.stubGlobal('fetch', server())
    renderSheet(<QuoteMenuPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Travel/ }))
    fireEvent.change(field('Price ($)'), { target: { value: '80' } })
    fireEvent.click(screen.getByRole('button', { name: '‹ Quote menu' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Leave without saving?' })).getByRole('button', { name: 'Leave' }))
    expect(await screen.findByRole('list', { name: 'Menu items' })).toBeInTheDocument()
    expect(confirm).not.toHaveBeenCalled()
  })
})

describe('Quote menu: saved packages', () => {
  it('lists each package with its item count; rename posts save-package', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    renderSheet(<QuoteMenuPage />)
    const box = await screen.findByRole('list', { name: 'Saved packages' })
    expect(within(box).getByText('Girls night')).toBeInTheDocument()
    expect(within(box).getByText('2 items')).toBeInTheDocument()
    fireEvent.click(within(box).getByRole('button', { name: 'Rename Girls night' }))
    fireEvent.change(field('Package name'), { target: { value: 'Ladies night' } })
    fireEvent.click(within(box).getByRole('button', { name: 'Save name' }))
    expect(await within(box).findByText('Ladies night')).toBeInTheDocument()
    expect(posts(f, MENU)[0].body).toEqual({ action: 'save-package', pkg: { ...pkg(), name: 'Ladies night' } })
  })
  it('delete asks in the sheet first, then posts delete-package', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const f = server()
    vi.stubGlobal('fetch', f)
    renderSheet(<QuoteMenuPage />)
    const box = await screen.findByRole('list', { name: 'Saved packages' })
    fireEvent.click(within(box).getByRole('button', { name: 'Delete Girls night' }))
    expect(posts(f, MENU)).toHaveLength(0)
    const ask = screen.getByRole('group', { name: 'Delete Girls night?' })
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep it' }))
    expect(screen.queryByRole('group', { name: 'Delete Girls night?' })).toBeNull()
    fireEvent.click(within(box).getByRole('button', { name: 'Delete Girls night' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Delete Girls night?' })).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('No saved packages yet. Save one from a quote.')).toBeInTheDocument()
    expect(posts(f, MENU)[0].body).toEqual({ action: 'delete-package', id: 'pkg_1' })
    expect(confirm).not.toHaveBeenCalled()
  })
})

describe('Quote menu: settings', () => {
  it('saves cap, yellow, deposit and reply-by days with the version it read', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    renderSheet(<QuoteMenuPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Quote settings/ }))
    fireEvent.change(field('Most off the normal price (%)'), { target: { value: '30' } })
    fireEvent.change(field('Turns yellow from (%)'), { target: { value: '22' } })
    fireEvent.change(field('Deposit (%)'), { target: { value: '40' } })
    fireEvent.change(field('Days they have to reply'), { target: { value: '10' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Save settings' }))
    await screen.findByRole('list', { name: 'Menu items' })
    expect(posts(f, MENU)[0].body).toEqual({ action: 'save-settings', settings: { capPct: 30, yellowFromPct: 22, depositPct: 40, expiryDays: 10 }, expectedUpdatedAt: 's1' })
    expect(screen.getByRole('button', { name: /Quote settings/ })).toHaveTextContent('Up to 30% off · deposit 40% · reply within 10 days')
  })
  it('someone else saved first: a plain message and the latest numbers', async () => {
    let reads = 0
    const f = server({
      get: () => ok({ data: { items: items(), syncedAt: null, packages: [], settings: reads++ ? settings({ capPct: 35, updatedAt: 's9' }) : settings() } }),
      post: (b) => (b.action === 'save-settings' ? refuse(409, { error: 'Someone saved these settings a moment ago. Reopen them and try again.', why: 'stale' }) : null),
    })
    vi.stubGlobal('fetch', f)
    renderSheet(<QuoteMenuPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Quote settings/ }))
    fireEvent.change(field('Deposit (%)'), { target: { value: '40' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Save settings' }))
    expect(await screen.findByText('Someone else saved these a moment ago. These are their numbers now. Change them again if you need to, then save.')).toBeInTheDocument()
    await waitFor(() => expect(field('Most off the normal price (%)').value).toBe('35'))
  })
  it('a number out of range is refused with the server’s words', async () => {
    vi.stubGlobal('fetch', server({ post: (b) => (b.action === 'save-settings' ? refuse(400, { error: 'Yellow has to start at or below the cap.', why: 'invalid' }) : null) }))
    renderSheet(<QuoteMenuPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Quote settings/ }))
    fireEvent.change(field('Turns yellow from (%)'), { target: { value: '40' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Save settings' }))
    expect(await screen.findByText('Yellow has to start at or below the cap.')).toBeInTheDocument()
  })
})
