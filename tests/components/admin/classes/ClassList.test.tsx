import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import ClassList from '@components/admin/classes/ClassList'
import { localToUtcISO } from '@lib/party-slots'

const cls = (id: string, name: string, status: string) => ({
  id, content: { name }, status, updatedAt: 'x',
  sessions: [{ id: `ses_${id}`, startIso: localToUtcISO('2031-03-12', '10:00'), endIso: localToUtcISO('2031-03-12', '11:00'), capacity: 10 }],
})
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
function server(seed: 'ok' | 'refuse' = 'ok') {
  return vi.fn(async (url: string, init?: any) => {
    if (url.startsWith('/api/admin/classes/classes.json')) return ok({ data: { classes: [cls('cls_a', 'Pottery', 'open'), cls('cls_b', 'Candles', 'draft')], seatsTaken: { ses_cls_a: 4 } } })
    if (url === '/api/admin/classes/seed-sandbox.json' && init?.method === 'POST') {
      return seed === 'ok'
        ? ok({ data: { classesCategoryId: 'CAT1', classTaxId: 'TAX1', commands: ['npx netlify env:set A CAT1', 'npx netlify env:set B TAX1'] } })
        : { ok: false, status: 409, json: async () => ({ error: 'This only runs against the Square sandbox.' }) }
    }
    throw new Error(`unexpected ${url}`)
  })
}
afterEach(() => vi.unstubAllGlobals())

describe('ClassList', () => {
  it('lists upcoming classes with seats and drafts marked; tapping opens one', async () => {
    vi.stubGlobal('fetch', server())
    const onOpen = vi.fn(), onNew = vi.fn()
    render(<ClassList onOpen={onOpen} onNew={onNew} />)
    const pottery = await screen.findByRole('button', { name: /Pottery/ })
    expect(pottery).toHaveTextContent('4 of 10 seats')
    expect(screen.getByRole('button', { name: /Candles/ })).toHaveTextContent('Draft')
    fireEvent.click(pottery)
    expect(onOpen).toHaveBeenCalledWith('cls_a')
    fireEvent.click(screen.getByRole('button', { name: 'New class' }))
    expect(onNew).toHaveBeenCalled()
  })

  it('set up sandbox shows the ids and the two commands', async () => {
    vi.stubGlobal('fetch', server('ok'))
    render(<ClassList onOpen={() => {}} onNew={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Set up sandbox' }))
    const out = await screen.findByRole('region', { name: 'Sandbox' })
    expect(within(out).getByText(/CAT1/, { selector: 'p' })).toBeInTheDocument()
    expect(within(out).getByText('npx netlify env:set A CAT1')).toBeInTheDocument()
    expect(within(out).getByText('npx netlify env:set B TAX1')).toBeInTheDocument()
  })

  it('set up sandbox disappears when the server says it does not apply', async () => {
    vi.stubGlobal('fetch', server('refuse'))
    render(<ClassList onOpen={() => {}} onNew={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Set up sandbox' }))
    await screen.findByText('This only runs against the Square sandbox.')
    expect(screen.queryByRole('button', { name: 'Set up sandbox' })).toBeNull()
  })
})
