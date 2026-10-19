import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, fireEvent, within, waitFor } from '@testing-library/react'
import { ImportSquareSheet } from '@components/admin/sheets/ImportSquareSheet'
import { ok, posts, refuse, renderSheet } from './harness'

const IMPORT = '/api/admin/classes/import-square.json'
afterEach(() => vi.unstubAllGlobals())

const plan = {
  create: [
    { name: 'Bedazzled Pumpkin Pails', priceCents: 3500, imageUrl: 'https://x.test/p.jpg', ages: 'Ages 8+', issues: [] },
    { name: 'Kinusaiga', priceCents: 3800, imageUrl: null, ages: '', issues: ['No photo found'] },
  ],
  skip: [{ name: 'Needlepoint 101', reason: 'Already in the library.' }],
  addPhoto: [],
}
function server(o: { fail?: boolean; addFails?: boolean } = {}) {
  return vi.fn(async (url: string, init?: any) => {
    if (url !== IMPORT) throw new Error(`unexpected ${url}`)
    const b = JSON.parse(init.body)
    if (b.dryRun) return o.fail ? refuse(503, { error: 'Square couldn’t be read. Try again.' }) : ok({ data: plan })
    if (o.addFails) return refuse(503, { error: 'Didn’t save. Try again.' })
    return ok({ data: { ...plan, create: plan.create.map((c, i) => ({ ...c, id: `lib_sq${i}` })) } })
  })
}
const footer = () => document.querySelector('.adm-sheet-foot') as HTMLElement

describe('More › Bring in Square classes', () => {
  it('shows what a dry run would add (name, price, photo, notes) and what is left out; Add N adds them, toasts, and each opens its library sheet', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    const { sheet, bump } = renderSheet(<ImportSquareSheet />)
    expect(await screen.findByText('Will be added (2)')).toBeInTheDocument()
    expect(posts(f, IMPORT)[0].body).toEqual({ dryRun: true })
    expect(screen.getByText('Bedazzled Pumpkin Pails')).toBeInTheDocument()
    expect(screen.getByText('$35 · Ages 8+')).toBeInTheDocument()
    expect(screen.getByText('No photo found')).toBeInTheDocument()
    expect(screen.getByText('Left out (1)')).toBeInTheDocument()
    expect(screen.getByText('Already in the library.')).toBeInTheDocument()
    expect(screen.getByText(/Nothing is scheduled, and nothing changes in Square/)).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Add 2 to the library' }))
    expect(await screen.findByText('Added (2)')).toBeInTheDocument()
    expect(posts(f, IMPORT)[1].body).toEqual({ dryRun: false })
    expect(screen.getByText('Added 2 classes to your library.')).toBeInTheDocument()
    expect(bump).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Kinusaiga/ }))
    expect(sheet.open).toHaveBeenCalledWith({ kind: 'lib', id: 'lib_sq1' })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Done' }))
    expect(sheet.close).toHaveBeenCalled()
  })

  it('Square unreadable: Try again; a failed add keeps the list and says so', async () => {
    vi.stubGlobal('fetch', server({ fail: true }))
    const one = renderSheet(<ImportSquareSheet />)
    expect(await screen.findByText('Square couldn’t be read. Try again.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    one.unmount()
    vi.stubGlobal('fetch', server({ addFails: true }))
    renderSheet(<ImportSquareSheet />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add 2 to the library' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Didn’t save. Try again.')
    expect(screen.getByText('Will be added (2)')).toBeInTheDocument()
  })

  it('nothing new: says so and there is nothing to press', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ data: { create: [], skip: [{ name: 'Pails', reason: 'Already in the library.' }], addPhoto: [] } })))
    renderSheet(<ImportSquareSheet />)
    expect(await screen.findByText('Everything Square has is already in your library.')).toBeInTheDocument()
    await waitFor(() => expect(within(footer()).getByRole('button', { name: 'Nothing to add' })).toBeDisabled())
  })
})
