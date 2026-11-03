import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, fireEvent, waitFor, configure, render } from '@testing-library/react'
import { HomeBookingPaused, OnlineBookingSheet } from '@components/admin/sheets/OnlineBookingSheet'
import { ok, posts, refuse, renderSheet } from './harness'

configure({ asyncUtilTimeout: 5000 })

const URL_ = '/api/admin/online-booking.json'
const DEFAULT = 'Online booking is paused for now. Call or text us at (256) 464-1710 and we’ll get you set up.'
const base = (over: any = {}) => ({
  open: { parties: true, workshops: true, kits: false }, pauseNote: DEFAULT, pauseNoteWritten: '', previewToken: '',
  source: 'setup', updatedAt: null, by: null, history: [], defaultNote: DEFAULT, noteMax: 140, kitsExist: false, readOnly: false, ...over,
})

function server(start: any = base(), o: { stale?: boolean } = {}) {
  let cur = start
  let n = 0
  return vi.fn(async (url: string, init?: any) => {
    if (url.split('?')[0] !== URL_) throw new Error(`unexpected ${url}`)
    if (init?.method !== 'POST') return ok({ data: cur })
    const b = JSON.parse(init.body)
    if (o.stale || b.expectedUpdatedAt !== cur.updatedAt) {
      o.stale = false
      cur = { ...cur, updatedAt: `other-${++n}`, open: { ...cur.open, workshops: false } }
      return refuse(409, { error: 'Someone else changed online booking. Check it and save again.', stale: true, current: cur })
    }
    const at = `2026-11-02T2${++n}:10:00.000Z`
    const changed = (['parties', 'workshops', 'kits'] as const).filter((k) => b.open[k] !== cur.open[k]).map((k) => `${b.open[k] ? 'Opened' : 'Paused'} ${k}`)
    cur = {
      ...cur, open: b.open, pauseNoteWritten: b.pauseNote, pauseNote: b.pauseNote || DEFAULT, source: 'saved', updatedAt: at,
      previewToken: b.newTestLink || !cur.previewToken ? `tok${n}` : cur.previewToken,
      by: { id: 'owner-catherine', name: 'Catherine' }, history: [{ at, by: { id: 'owner-catherine', name: 'Catherine' }, changed }, ...cur.history],
    }
    return ok({ data: { ...cur, changed } })
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('More › Online booking', () => {
  it('shows each kind open or paused, where it comes from, and hides kits while kits don’t exist', async () => {
    vi.stubGlobal('fetch', server())
    renderSheet(<OnlineBookingSheet />)
    expect(await screen.findByText('From the site setup. The first change you make here takes over.')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Parties online' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Classes & workshops online' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Take-home kits online' })).toBeNull()
    expect(screen.getAllByText('People can book on the website.')).toHaveLength(2)
  })

  it('pausing asks first, says nothing booked changes, then saves just that kind', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    renderSheet(<OnlineBookingSheet />)
    const parties = await screen.findByRole('group', { name: 'Parties online' })
    fireEvent.click(parties.querySelector('button:nth-child(2)')!) // Paused
    const ask = screen.getByRole('group', { name: 'Pause parties?' })
    expect(ask).toHaveTextContent('People already booked keep their booking. Payment links already sent still work.')
    expect(posts(f)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Pause parties' }))
    await screen.findByText(/Parties are paused online/)
    expect(posts(f, URL_)[0].body).toEqual({ open: { parties: false, workshops: true, kits: false }, pauseNote: '', newTestLink: false, reopenOn: { parties: null }, expectedUpdatedAt: null })
    expect(screen.getByText(/The website says booking is paused and shows your note\./)).toBeInTheDocument()
  })

  it('M2: a pause can open again by itself on a day; Don’t open it by itself takes that off', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    renderSheet(<OnlineBookingSheet />)
    const parties = await screen.findByRole('group', { name: 'Parties online' })
    fireEvent.click(parties.querySelector('button:nth-child(2)')!)
    expect(screen.getByText(/Left blank, it stays paused until you open it\. To close the studio for a day, use Closed days instead\./)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Open again by itself on/), { target: { value: '2099-01-02' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pause parties' }))
    await waitFor(() => expect(posts(f, URL_)).toHaveLength(1))
    expect(posts(f, URL_)[0].body.reopenOn).toEqual({ parties: '2099-01-02' })
  })

  it('Keep it open changes nothing', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    renderSheet(<OnlineBookingSheet />)
    const parties = await screen.findByRole('group', { name: 'Parties online' })
    fireEvent.click(parties.querySelector('button:nth-child(2)')!)
    fireEvent.click(screen.getByRole('button', { name: 'Keep it open' }))
    expect(screen.queryByRole('group', { name: 'Pause parties?' })).toBeNull()
    expect(posts(f)).toHaveLength(0)
  })

  it('the note: counter, the default shown, saved on its own', async () => {
    const f = server(base({ source: 'saved', updatedAt: 'u1' }))
    vi.stubGlobal('fetch', f)
    const { dirty } = renderSheet(<OnlineBookingSheet />)
    const box = await screen.findByLabelText(/What customers read/)
    expect(screen.getByText(`0 of 140. Left blank, it says: “${DEFAULT}”`)).toBeInTheDocument()
    fireEvent.change(box, { target: { value: 'Back Monday!' } })
    expect(dirty()).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
    await screen.findByText('Note saved. Customers see it while booking is paused.')
    expect(posts(f, URL_)[0].body).toMatchObject({ pauseNote: 'Back Monday!', expectedUpdatedAt: 'u1' })
  })

  it('a test link is made on first use and shown, so it can be copied by hand on an iPad', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    renderSheet(<OnlineBookingSheet />)
    fireEvent.click(await screen.findByRole('button', { name: 'Copy party test link' }))
    await screen.findByText(/\/book\?preview=tok1$/)
    expect(posts(f, URL_)[0].body.newTestLink).toBe(true)
  })

  it('someone else’s save: says so and shows theirs', async () => {
    vi.stubGlobal('fetch', server(base(), { stale: true }))
    renderSheet(<OnlineBookingSheet />)
    const parties = await screen.findByRole('group', { name: 'Parties online' })
    fireEvent.click(parties.querySelector('button:nth-child(2)')!)
    fireEvent.click(screen.getByRole('button', { name: 'Pause parties' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else changed online booking. Check it and save again.')
  })

  it('a test site can’t change the live switch', async () => {
    vi.stubGlobal('fetch', server(base({ readOnly: true })))
    renderSheet(<OnlineBookingSheet />)
    expect(await screen.findByText(/This is a test site/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy party test link' })).toBeDisabled()
  })
})

describe('Online booking › a switch that couldn’t be read', () => {
  it('says the website treats everything as paused and how to set it again', async () => {
    vi.stubGlobal('fetch', server(base({ open: { parties: false, workshops: false, kits: false }, source: 'unreadable', updatedAt: null, previewToken: '' })))
    renderSheet(<OnlineBookingSheet />)
    expect(await screen.findByText(/couldn’t be read, so the website is treating everything as paused/)).toBeInTheDocument()
  })
})

describe('Home › paused online', () => {
  it('says what is paused, since when and by whom, with the button', async () => {
    const onOpen = vi.fn()
    vi.stubGlobal('fetch', server(base({
      open: { parties: false, workshops: true, kits: false }, source: 'saved', updatedAt: 'u',
      history: [{ at: '2026-11-03T21:10:00.000Z', by: { id: 'owner-catherine', name: 'Catherine' }, changed: ['Paused parties'] }],
    })))
    render(<HomeBookingPaused onOpen={onOpen} />)
    expect(await screen.findByText('Parties are paused online since Tue Nov 3, 3:10 PM (Catherine).')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Go to Online booking' }))
    expect(onOpen).toHaveBeenCalledWith({ kind: 'more', page: 'booking' })
  })

  it('says nothing while everything is open (kits don’t count while hidden)', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    const { container } = render(<HomeBookingPaused onOpen={vi.fn()} />)
    await waitFor(() => expect(f).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
