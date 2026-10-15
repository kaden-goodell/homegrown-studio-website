import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import AdminApp from '@components/admin/AdminApp'

const app = (over: any = {}) => ({
  id: '2026-10-15-abcdef12', at: '2026-10-15T15:00:00Z', status: 'new', photos: 2,
  about: { name: 'Lou Maker', business: 'Lou Makes', email: 'lou@example.com', phone: '(256) 555-0100', city: 'Huntsville' },
  links: { instagram: '@loumakes', website: '', tiktok: '', etsy: '', video: '' },
  classIdea: { what: 'Linocut printing', takeHome: 'Three prints', audience: 'adults', dropOffOk: '', length: '2 hours', groupMin: '4', groupMax: '12', price: '$45', suppliesCost: '$10', needs: '' },
  experience: '', when: { days: 'Weekday evenings', howOften: 'monthly' }, ...over,
})
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
afterEach(() => vi.unstubAllGlobals())

describe('AdminApp (/admin)', () => {
  it('asks for the passcode when signed out, then shows the applications', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
      .mockResolvedValueOnce(ok({ data: { ok: true } }))
      .mockResolvedValueOnce(ok({ data: { applications: [app()] } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<AdminApp />)
    fireEvent.change(await screen.findByLabelText('Passcode'), { target: { value: 'owner-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Lou Maker · Lou Makes')).toBeInTheDocument()
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ passcode: 'owner-secret' })
    expect(screen.getByText('Linocut printing')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Instagram' })).toHaveAttribute('href', 'https://instagram.com/loumakes')
    expect(screen.getAllByAltText(/Lou Maker, photo/)).toHaveLength(2)
  })

  it('a wrong passcode says so', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: 'That passcode isn’t right.' }) }))
    render(<AdminApp />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('That passcode isn’t right.')).toBeInTheDocument()
  })

  it('moves an application along and filters by status', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ data: { applications: [app(), app({ id: '2026-10-14-00000000', about: { ...app().about, name: 'Bea' }, status: 'booked' })] } }))
      .mockResolvedValueOnce(ok({ data: { application: app({ status: 'talking' }) } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<AdminApp />)
    const group = await screen.findByRole('group', { name: 'Status for Lou Maker' })
    fireEvent.click(within(group).getByRole('button', { name: 'Talking' }))
    expect(await within(group).findByRole('button', { name: 'Talking', pressed: true })).toBeInTheDocument()
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ id: '2026-10-15-abcdef12', status: 'talking' })
    fireEvent.click(screen.getByRole('button', { name: 'Booked (1)' }))
    expect(screen.queryByText(/Lou Maker/)).toBeNull()
    expect(screen.getByText('Bea · Lou Makes')).toBeInTheDocument()
  })

  it('no applications yet says where they come from', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ data: { applications: [] } })))
    render(<AdminApp />)
    expect(await screen.findByText(/ourhometownstudio.com\/teach/)).toBeInTheDocument()
  })
})
