import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'

vi.mock('@components/admin/classes/photo', () => ({
  uploadPhoto: vi.fn(async () => ({ url: 'https://x.test/api/admin/classes/photo.json?id=abc' })),
}))

import ClassEditor from '@components/admin/classes/ClassEditor'
import { defaultRules } from '@lib/classes/validate'
import { localToUtcISO } from '@lib/party-slots'
import type { ClassContent, ScheduledClass } from '@lib/classes/types'

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
const refuse = (status: number, body: unknown) => ({ ok: false, status, json: async () => body })
const posts = (f: any) => f.mock.calls.filter((c: any) => c[1]?.method === 'POST' && typeof c[1].body === 'string').map((c: any) => ({ url: c[0], body: JSON.parse(c[1].body) }))
afterEach(() => vi.unstubAllGlobals())

const content = (over: Partial<ClassContent> = {}): ClassContent => ({
  name: 'Pottery', description: 'Make a mug.', imageUrl: null, instructor: null, rules: defaultRules(),
  ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'pas_full', label: 'Full class', covers: { kind: 'all' } }],
  prices: { pas_full: { person: 3000 } }, questions: [], addOns: [], defaultCapacity: 12, defaultMinutes: 90, ...over,
})
const cls = (over: Partial<ScheduledClass> = {}): ScheduledClass => ({
  id: 'cls_1', libraryId: null, libraryVersion: null, content: content(),
  sessions: [{ id: 'ses_1', startIso: localToUtcISO('2031-03-12', '10:00'), endIso: localToUtcISO('2031-03-12', '11:30'), capacity: 12 }],
  status: 'open', square: { itemId: null, variations: {} }, createdAt: '2031-01-01T00:00:00.000Z', updatedAt: '2031-01-02T00:00:00.000Z',
  by: { id: 'admin', name: 'Owner' }, history: [], ...over,
})

describe('ClassEditor, a new class', () => {
  it('starts with Basics and Sessions open and one price; the rest collapsed', () => {
    render(<ClassEditor mode={{ kind: 'new' }} onSaved={() => {}} onCancel={() => {}} />)
    for (const open of ['Basics', 'Sessions']) expect(screen.getByRole('button', { name: open })).toHaveAttribute('aria-expanded', 'true')
    for (const shut of ['Passes & prices', 'Ticket types', 'Questions', 'Add-ons', 'Rules']) {
      expect(screen.getByRole('button', { name: shut })).toHaveAttribute('aria-expanded', 'false')
    }
    expect(screen.getByLabelText('Price per person ($)')).toHaveValue('')
  })

  it('checks the form before sending, then shows a server refusal in its section', async () => {
    const fetchMock = vi.fn(async () => refuse(400, { error: 'Two sessions of the same class overlap.', field: 'sessions' }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClassEditor mode={{ kind: 'new' }} onSaved={() => {}} onCancel={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add class' }))
    const basics = screen.getByRole('region', { name: 'Basics' })
    expect(within(basics).getByText('Give the class a name.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Pottery' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add class' }))
    expect(within(basics).getByText('Add at least one price.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Price per person ($)'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add class' }))
    const sessions = screen.getByRole('region', { name: 'Sessions' })
    expect(await within(sessions).findByText('Two sessions of the same class overlap.')).toBeInTheDocument()
    const [p] = posts(fetchMock)
    expect(p.url).toBe('/api/admin/classes/classes.json')
    expect(p.body).toMatchObject({ action: 'create', status: 'open', content: { name: 'Pottery', ticketTypes: [{ id: 'person', label: 'Person' }] } })
    expect(Object.values(p.body.content.prices)).toEqual([{ person: 3000 }])
    expect(p.body.content.passes[0]).toMatchObject({ label: 'Full class', covers: { kind: 'all' } })
    expect(p.body.sessions).toHaveLength(1)
  })

  it('a session has to end after it starts', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<ClassEditor mode={{ kind: 'new' }} onSaved={() => {}} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Pottery' } })
    fireEvent.change(screen.getByLabelText('Price per person ($)'), { target: { value: '30' } })
    fireEvent.change(screen.getByLabelText('Session 1 end'), { target: { value: '09:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add class' }))
    expect(within(screen.getByRole('region', { name: 'Sessions' })).getByText('A session has to end after it starts.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the price grid gets a column per ticket type and an empty cell is not sold', async () => {
    const onSaved = vi.fn()
    const fetchMock = vi.fn(async (_u: string, init: any) => ok({ data: { class: cls({ content: JSON.parse(init.body).content }) } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClassEditor mode={{ kind: 'new' }} onSaved={onSaved} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Family Pottery' } })
    fireEvent.change(screen.getByLabelText('Price per person ($)'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ticket types' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add a ticket type' }))
    fireEvent.change(screen.getByLabelText('Ticket type 2'), { target: { value: 'Kid' } })
    fireEvent.click(screen.getByRole('button', { name: 'Passes & prices' }))
    fireEvent.change(screen.getByLabelText('Full class Kid price ($)'), { target: { value: '15.50' } })
    fireEvent.change(screen.getByLabelText('Full class Person price ($)'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add a pass' }))
    fireEvent.change(screen.getByLabelText('Pass 2 name'), { target: { value: 'Drop in' } })
    fireEvent.change(screen.getByLabelText('Drop in Person price ($)'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add class' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const { content: sent } = posts(fetchMock)[0].body
    const [full, drop] = sent.passes
    expect(sent.ticketTypes.map((t: any) => t.label)).toEqual(['Person', 'Kid'])
    const kid = sent.ticketTypes[1].id
    expect(sent.prices).toEqual({ [full.id]: { [kid]: 1550 }, [drop.id]: { person: 1200 } })
  })

  it('removing a pass or ticket type removes its cells', async () => {
    const fetchMock = vi.fn(async (_u: string, init: any) => ok({ data: { class: cls({ content: JSON.parse(init.body).content }) } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClassEditor mode={{ kind: 'new' }} onSaved={() => {}} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Pottery' } })
    fireEvent.change(screen.getByLabelText('Price per person ($)'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Passes & prices' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add a pass' }))
    fireEvent.change(screen.getByLabelText('Pass 2 Person price ($)'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove Pass 2' }))
    expect(screen.queryByLabelText('Pass 2 Person price ($)')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add class' }))
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1))
    expect(Object.values(posts(fetchMock)[0].body.content.prices)).toEqual([{ person: 3000 }])
  })

  it('a photo is cropped, uploaded, and shows on the live card preview', async () => {
    render(<ClassEditor mode={{ kind: 'new' }} onSaved={() => {}} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Pottery' } })
    const file = new File(['x'], 'mug.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Photo'), { target: { files: [file] } })
    const preview = screen.getByRole('region', { name: 'How the card looks' })
    await waitFor(() => expect(within(preview).getByRole('img', { name: 'Pottery' })).toHaveAttribute('src', 'https://x.test/api/admin/classes/photo.json?id=abc'))
    expect(within(preview).getByRole('heading', { name: 'Pottery' })).toBeInTheDocument()
  })
})

describe('ClassEditor, fix round 1', () => {
  const okCreate = () => vi.fn(async (_u: string, init: any) => {
    const b = JSON.parse(init.body)
    if (b.action === 'create') return ok({ data: { class: cls({ id: 'cls_new', updatedAt: 'u-created', content: b.content }) } })
    return ok({ data: { class: cls({ id: 'cls_new', updatedAt: 'u-linked', libraryId: 'lib_new', libraryVersion: 1 }) } })
  })

  it('number boxes can be cleared and retyped, and are checked on save', async () => {
    const fetchMock = okCreate()
    vi.stubGlobal('fetch', fetchMock)
    render(<ClassEditor mode={{ kind: 'new' }} onSaved={() => {}} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Pottery' } })
    fireEvent.change(screen.getByLabelText('Price per person ($)'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rules' }))
    const most = screen.getByLabelText('Most people per booking')
    fireEvent.change(most, { target: { value: '' } })
    expect(most).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'Add class' }))
    expect(within(screen.getByRole('region', { name: 'Rules' })).getByText('The most people per booking is 1 to 40.')).toBeInTheDocument()
    fireEvent.change(most, { target: { value: '5' } })
    expect(most).toHaveValue('5')

    fireEvent.click(screen.getByRole('button', { name: 'Passes & prices' }))
    fireEvent.change(screen.getByLabelText('Full class covers'), { target: { value: 'choose' } })
    const pick = screen.getByLabelText('Full class how many they pick')
    fireEvent.change(pick, { target: { value: '' } })
    expect(pick).toHaveValue('')
    fireEvent.change(pick, { target: { value: '3' } })
    expect(pick).toHaveValue('3')
    fireEvent.click(screen.getByRole('button', { name: 'Add class' }))
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1))
    const sent = posts(fetchMock)[0].body.content
    expect(sent.rules.maxPerBooking).toBe(5)
    expect(sent.passes[0].covers).toEqual({ kind: 'choose', count: 3 })
  })

  it('in the one-price layout a price error sits on the price box, next to a name error', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<ClassEditor mode={{ kind: 'new' }} onSaved={() => {}} onCancel={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add class' }))
    const basics = screen.getByRole('region', { name: 'Basics' })
    expect(within(basics).getByText('Give the class a name.')).toBeInTheDocument()
    const priceBox = screen.getByLabelText('Price per person ($)').closest('[data-field]') as HTMLElement
    expect(within(priceBox).getByText('Add at least one price.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Passes & prices' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('a cancelled library class cannot be saved either way', () => {
    render(<ClassEditor mode={{ kind: 'edit', cls: cls({ status: 'cancelled', libraryId: 'lib_1', libraryVersion: 1 }) }} onSaved={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole('button', { name: 'Just this date' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Also update the library' })).toBeDisabled()
  })

  it('Add and keep in the library links the new class to its library entry', async () => {
    const fetchMock = okCreate()
    const onSaved = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<ClassEditor mode={{ kind: 'new' }} onSaved={onSaved} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Pottery' } })
    fireEvent.change(screen.getByLabelText('Price per person ($)'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add and keep in the library' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const [create, link] = posts(fetchMock)
    expect(create.body.action).toBe('create')
    expect(link).toMatchObject({ url: '/api/admin/classes/classes.json', body: { action: 'update', id: 'cls_new', expectedUpdatedAt: 'u-created', alsoUpdateLibrary: true } })
    expect(link.body.content).toBeUndefined()
    expect(onSaved.mock.calls[0][0].cls.libraryId).toBe('lib_new')
  })

  it('from the library, Also update the library points the class at the new version', async () => {
    const fetchMock = okCreate()
    vi.stubGlobal('fetch', fetchMock)
    const lib = { id: 'lib_1', archived: false, versions: [{ version: 1, at: '', by: { id: 'admin', name: 'Owner' }, content: content(), note: '' }] }
    render(<ClassEditor mode={{ kind: 'from-library', lib }} onSaved={() => {}} onCancel={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Also update the library' }))
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(2))
    expect(posts(fetchMock)[0].body).toMatchObject({ action: 'create', libraryId: 'lib_1' })
    expect(posts(fetchMock)[1].body).toMatchObject({ action: 'update', alsoUpdateLibrary: true, expectedUpdatedAt: 'u-created' })
  })
})

describe('ClassEditor, editing a scheduled class', () => {
  it('sends the copy it loaded, and takes the new updatedAt from the reply', async () => {
    const saved = cls({ updatedAt: '2031-01-03T00:00:00.000Z' })
    const fetchMock = vi.fn(async () => ok({ data: { class: saved } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClassEditor mode={{ kind: 'edit', cls: cls() }} onSaved={() => {}} onCancel={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1))
    expect(posts(fetchMock)[0].body).toMatchObject({ action: 'update', id: 'cls_1', expectedUpdatedAt: '2031-01-02T00:00:00.000Z' })
    expect(posts(fetchMock)[0].body.sessions[0].id).toBe('ses_1')
    await screen.findByText('Saved.')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(2))
    expect(posts(fetchMock)[1].body.expectedUpdatedAt).toBe('2031-01-03T00:00:00.000Z')
  })

  it('someone else changed it: the sentence and a Reload button that fetches the class again', async () => {
    const fresh = cls({ updatedAt: '2031-01-09T00:00:00.000Z', content: content({ name: 'Pottery (new name)' }) })
    const fetchMock = vi.fn(async (url: string) => (url.startsWith('/api/admin/classes/bookings.json')
      ? ok({ data: { class: fresh, bookings: [] } })
      : refuse(409, { error: 'Someone else changed this class. Reload to see their changes.', stale: true })))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClassEditor mode={{ kind: 'edit', cls: cls() }} onSaved={() => {}} onCancel={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Someone else changed this class. Reload to see their changes.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Pottery (new name)'))
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/admin/classes/bookings.json?id=cls_1')).toBe(true)
  })

  it('moving booked sessions lists who to tell, then resends with confirmMove', async () => {
    let n = 0
    const fetchMock = vi.fn(async () => (++n === 1
      ? refuse(409, {
        error: 'People are booked on the sessions you moved. Confirm the move, then let them know.',
        peopleToTell: [{ name: 'Ada Lovelace', email: 'ada@example.com', phone: '(256) 555-0100', sessions: ['Wed Mar 12 10 AM'] }],
      })
      : ok({ data: { class: cls(), peopleToTell: [] } })))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClassEditor mode={{ kind: 'edit', cls: cls() }} onSaved={() => {}} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText('Session 1 start'), { target: { value: '11:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const people = await screen.findByRole('list', { name: 'People to tell' })
    expect(within(people).getByText(/Ada Lovelace/)).toBeInTheDocument()
    expect(within(people).getByText(/ada@example.com/)).toBeInTheDocument()
    expect(within(people).getByText(/\(256\) 555-0100/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Move and I’ll tell them' }))
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(2))
    expect(posts(fetchMock)[1].body).toMatchObject({ action: 'update', confirmMove: true })
    expect(posts(fetchMock)[1].body.sessions[0].startIso).toBe(localToUtcISO('2031-03-12', '11:00'))
  })

  it('a class from the library offers Just this date or Also update the library', async () => {
    const fetchMock = vi.fn(async () => ok({ data: { class: cls({ libraryId: 'lib_1', libraryVersion: 2 }) } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClassEditor mode={{ kind: 'edit', cls: cls({ libraryId: 'lib_1', libraryVersion: 1 }) }} onSaved={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole('button', { name: 'Just this date' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Also update the library' }))
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1))
    expect(posts(fetchMock)[0].body.alsoUpdateLibrary).toBe(true)
  })

  it('a POS warning shows after a save', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ data: { class: cls() }, warning: "Saved. The POS item didn't update. Try Save again." })))
    render(<ClassEditor mode={{ kind: 'edit', cls: cls() }} onSaved={() => {}} onCancel={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText("Saved. The POS item didn't update. Try Save again.")).toBeInTheDocument()
  })
})

describe('ClassEditor, a library class', () => {
  it('saves a version with no sessions', async () => {
    const fetchMock = vi.fn(async () => ok({ data: { library: { id: 'lib_9', archived: false, versions: [] } } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClassEditor mode={{ kind: 'library' }} onSaved={() => {}} onCancel={() => {}} />)
    expect(screen.queryByRole('region', { name: 'Sessions' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Candles' } })
    fireEvent.change(screen.getByLabelText('Price per person ($)'), { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save to library' }))
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1))
    expect(posts(fetchMock)[0]).toMatchObject({ url: '/api/admin/classes/library.json', body: { action: 'save', content: { name: 'Candles' } } })
  })
})
