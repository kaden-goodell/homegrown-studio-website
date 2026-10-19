import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import LibraryList from '@components/admin/classes/LibraryList'
import { defaultRules } from '@lib/classes/validate'

const content = (name: string, cents = 3000) => ({
  name, description: '', imageUrl: null, instructor: null, rules: defaultRules(),
  ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'p', label: 'Full class', covers: { kind: 'all' } }],
  prices: { p: { person: cents } }, questions: [], addOns: [], defaultCapacity: 8, defaultMinutes: 120,
})
const lib = (id: string, name: string, archived = false) => ({
  id, archived,
  versions: [
    { version: 1, at: '2031-01-01T00:00:00Z', by: { id: 'admin', name: 'Owner' }, content: content(name, 2500), note: 'First' },
    { version: 2, at: '2031-01-05T00:00:00Z', by: { id: 'admin', name: 'Owner' }, content: content(name), note: '' },
  ],
})
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
function server() {
  return vi.fn(async (url: string, init?: any) => {
    if (url.startsWith('/api/admin/classes/library.json') && init?.method !== 'POST') {
      return ok({ data: { library: url.includes('archived=1') ? [lib('lib_1', 'Pottery'), lib('lib_2', 'Old Candles', true)] : [lib('lib_1', 'Pottery')] } })
    }
    if (url === '/api/admin/classes/library.json') { const b = JSON.parse(init.body); return ok({ data: { library: { ...lib(b.id, 'Pottery'), archived: b.archived !== false } } }) }
    throw new Error(`unexpected ${url}`)
  })
}
afterEach(() => vi.unstubAllGlobals())

describe('LibraryList', () => {
  it('lists library classes with their price and opens the schedule dialog', async () => {
    vi.stubGlobal('fetch', server())
    render(<LibraryList onEdit={() => {}} onNew={() => {}} onScheduleWithEdits={() => {}} onScheduled={() => {}} />)
    const card = await screen.findByRole('article', { name: 'Pottery' })
    expect(within(card).getByText(/\$30/)).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: 'Schedule' }))
    expect(screen.getByRole('dialog', { name: 'Schedule Pottery' })).toBeInTheDocument()
    expect(screen.getByLabelText('Date 1 seats')).toHaveValue('8')
  })

  it('edit, edit-then-schedule and new hand up to the editor', async () => {
    vi.stubGlobal('fetch', server())
    const onEdit = vi.fn(), onNew = vi.fn(), onScheduleWithEdits = vi.fn()
    render(<LibraryList onEdit={onEdit} onNew={onNew} onScheduleWithEdits={onScheduleWithEdits} onScheduled={() => {}} />)
    const card = await screen.findByRole('article', { name: 'Pottery' })
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    expect(onEdit.mock.calls[0][0].id).toBe('lib_1')
    fireEvent.click(within(card).getByRole('button', { name: 'Change details, then schedule' }))
    expect(onScheduleWithEdits.mock.calls[0][0].id).toBe('lib_1')
    fireEvent.click(screen.getByRole('button', { name: 'Add a class to the library' }))
    expect(onNew).toHaveBeenCalled()
  })

  it('archives, and shows archived classes on request', async () => {
    const fetchMock = server()
    vi.stubGlobal('fetch', fetchMock)
    render(<LibraryList onEdit={() => {}} onNew={() => {}} onScheduleWithEdits={() => {}} onScheduled={() => {}} />)
    const card = await screen.findByRole('article', { name: 'Pottery' })
    fireEvent.click(within(card).getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(true))
    expect(JSON.parse(fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')![1].body)).toEqual({ action: 'archive', id: 'lib_1', archived: true })
    fireEvent.click(screen.getByRole('button', { name: 'Show archived' }))
    expect(await screen.findByRole('article', { name: 'Old Candles' })).toBeInTheDocument()
  })

  it('lists versions and restores one', async () => {
    const fetchMock = server()
    vi.stubGlobal('fetch', fetchMock)
    render(<LibraryList onEdit={() => {}} onNew={() => {}} onScheduleWithEdits={() => {}} onScheduled={() => {}} />)
    const card = await screen.findByRole('article', { name: 'Pottery' })
    fireEvent.click(within(card).getByRole('button', { name: 'Versions' }))
    fireEvent.click(within(card).getByRole('button', { name: 'Restore version 1' }))
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(true))
    expect(JSON.parse(fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')![1].body)).toEqual({ action: 'restore', id: 'lib_1', version: 1 })
  })
})
