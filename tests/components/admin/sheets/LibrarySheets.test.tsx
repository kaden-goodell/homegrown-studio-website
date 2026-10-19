import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, fireEvent, within, waitFor } from '@testing-library/react'
import { LibraryEditSheet, LibraryItemSheet } from '@components/admin/sheets/LibrarySheets'
import { at, content, lib, ok, posts, renderSheet } from './harness'

const LIBRARY = '/api/admin/classes/library.json'
afterEach(() => vi.unstubAllGlobals())

const pottery = lib('lib_1', content({ imageUrl: 'https://x.test/p.jpg', defaultCapacity: 8 }), {
  versions: [
    { version: 1, at: '2031-01-01T15:00:00Z', by: { id: 'owner-kaden', name: 'Kaden' }, content: content({ prices: { pas_full: { person: 2500 } } }), note: 'Added with the class on Wed Jan 1', changed: [] },
    { version: 2, at: '2031-01-05T15:00:00Z', by: { id: 'owner-catherine', name: 'Catherine' }, content: content({ imageUrl: 'https://x.test/p.jpg', defaultCapacity: 8 }), note: '', changed: ['Photo', 'Price'] },
  ],
})
const runs = { lib_1: { lastIso: at('2031-02-20', '18:00'), nextIso: null, startIso: at('2031-02-20', '18:00'), endIso: at('2031-02-20', '20:00') } }
function server(list = [pottery]) {
  return vi.fn(async (url: string, init?: any) => {
    if (url.split('?')[0] !== LIBRARY) throw new Error(`unexpected ${url}`)
    if (init?.method !== 'POST') return ok({ data: { library: list, runs } })
    const b = JSON.parse(init.body)
    return ok({ data: { library: { ...list[0], archived: b.archived === true } } })
  })
}
const footer = () => document.querySelector('.adm-sheet-foot') as HTMLElement

describe('a library class’s sheet', () => {
  it('photo, price and seats, usual time, when it last ran; Schedule it and Edit details open their sheets', async () => {
    vi.stubGlobal('fetch', server())
    const { sheet } = renderSheet(<LibraryItemSheet id="lib_1" />)
    expect(await screen.findByRole('heading', { name: 'Pottery' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Pottery' })).toHaveAttribute('src', 'https://x.test/p.jpg')
    expect(screen.getByText('$30 a seat · 8 seats')).toBeInTheDocument()
    expect(screen.getByText('6–8 PM usually')).toBeInTheDocument()
    expect(screen.getByText('Last ran Feb 20')).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Schedule it' }))
    expect(sheet.open).toHaveBeenCalledWith({ kind: 'libsched', id: 'lib_1' })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Edit details' }))
    expect(sheet.open).toHaveBeenLastCalledWith({ kind: 'libedit', id: 'lib_1' }, expect.objectContaining({ id: 'lib_1' }))
  })

  it('Archive asks in the sheet; Keep it does nothing; Archive closes it with a toast whose Undo brings it back', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    const { sheet, bump } = renderSheet(<LibraryItemSheet id="lib_1" />)
    fireEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Archive' }))
    const ask = within(footer()).getByRole('group', { name: 'Archive Pottery?' })
    expect(within(ask).getByText(/Classes already on the calendar stay as they are/)).toBeInTheDocument()
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep it' }))
    expect(posts(f, LIBRARY)).toHaveLength(0)
    fireEvent.click(within(footer()).getByRole('button', { name: 'Archive' }))
    fireEvent.click(within(within(footer()).getByRole('group', { name: 'Archive Pottery?' })).getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(sheet.close).toHaveBeenCalled())
    expect(posts(f, LIBRARY)[0].body).toEqual({ action: 'archive', id: 'lib_1', archived: true })
    expect(bump).toHaveBeenCalled()
    expect(screen.getByText('Archived Pottery.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(posts(f, LIBRARY)).toHaveLength(2))
    expect(posts(f, LIBRARY)[1].body).toEqual({ action: 'archive', id: 'lib_1', archived: false })
  })

  it('Earlier versions: who made each and what changed; Restore puts one back', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    renderSheet(<LibraryItemSheet id="lib_1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Earlier versions (2)' }))
    const list = screen.getByRole('list', { name: 'Versions' })
    const [v2, v1] = within(list).getAllByRole('listitem')
    expect(v2).toHaveTextContent('Version 2 · now')
    expect(v2).toHaveTextContent('Catherine · Photo, Price')
    expect(within(v2).queryByRole('button')).toBeNull()
    expect(v1).toHaveTextContent('Kaden · First version')
    fireEvent.click(within(v1).getByRole('button', { name: 'Restore version 1' }))
    await waitFor(() => expect(posts(f, LIBRARY)).toHaveLength(1))
    expect(posts(f, LIBRARY)[0].body).toEqual({ action: 'restore', id: 'lib_1', version: 1 })
    expect(await screen.findByText('Version 1 is the current one again.')).toBeInTheDocument()
  })

  it('an archived one offers Bring it back', async () => {
    const f = server([{ ...pottery, archived: true }])
    vi.stubGlobal('fetch', f)
    renderSheet(<LibraryItemSheet id="lib_1" />)
    fireEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Bring it back' }))
    await waitFor(() => expect(posts(f, LIBRARY)[0]?.body).toEqual({ action: 'archive', id: 'lib_1', archived: false }))
  })
})

describe('Edit details (library)', () => {
  it('Save is off until a change; it saves a new version with the usual length and seats, then goes back to the class without asking to leave', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    const { sheet, dirty } = renderSheet(<LibraryEditSheet id="lib_1" />)
    const save = await screen.findByRole('button', { name: 'Save to the library' })
    expect(save).toBeDisabled()
    expect(screen.getByLabelText('Seats it usually has')).toHaveValue('8')
    fireEvent.change(screen.getByLabelText('How long it usually runs (minutes)'), { target: { value: '120' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Make two mugs.' } })
    expect(dirty()).toBe(true)
    fireEvent.click(save)
    await waitFor(() => expect(sheet.open).toHaveBeenCalledWith({ kind: 'lib', id: 'lib_1' }))
    expect(posts(f, LIBRARY)[0].body).toMatchObject({ action: 'save', id: 'lib_1', content: { description: 'Make two mugs.', defaultMinutes: 120, defaultCapacity: 8 } })
    expect(sheet.setDirty).toHaveBeenLastCalledWith(false)
  })

  it('a usual length out of range is fixed before sending', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    renderSheet(<LibraryEditSheet id="lib_1" />)
    fireEvent.change(await screen.findByLabelText('How long it usually runs (minutes)'), { target: { value: '2' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Save to the library' }))
    expect(screen.getByText('How long it usually runs is 5 to 1440 minutes.')).toBeInTheDocument()
    expect(within(footer()).getByText('Fix the usual length or seats above.')).toBeInTheDocument()
    expect(posts(f)).toHaveLength(0)
  })
})
