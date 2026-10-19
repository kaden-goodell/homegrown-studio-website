import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import BlockTimeForm from '@components/admin/classes/BlockTimeForm'
import { localToUtcISO } from '@lib/party-slots'

const DAY = '2031-03-12'
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
const clash = 'Clashes with Pottery, Wed Mar 12 10 AM.'
function server({ clashFirst = false, existing = [] as any[] } = {}) {
  let refused = false
  return vi.fn(async (url: string, init?: any) => {
    if (url.startsWith('/api/admin/classes/blocked.json') && init?.method !== 'POST') return ok({ data: { blocked: existing } })
    const body = JSON.parse(init.body)
    if (body.action === 'remove') return ok({ data: { removed: body.id } })
    if (clashFirst && !body.confirm) {
      refused = true
      return { ok: false, status: 409, json: async () => ({ error: clash, clashes: [{ kind: 'class', id: 'cls_a', label: 'Pottery' }] }) }
    }
    return ok({ data: { blocked: { id: 'blk_new', ...body, reason: body.reason }, clashes: refused ? [{ kind: 'class', id: 'cls_a', label: 'Pottery' }] : [] } })
  })
}
const fill = () => {
  fireEvent.change(screen.getByLabelText('Day'), { target: { value: DAY } })
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '09:00' } })
  fireEvent.change(screen.getByLabelText('To'), { target: { value: '12:00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Setup' }))
  fireEvent.change(screen.getByLabelText(/Note/), { target: { value: 'Deep clean' } })
}
afterEach(() => vi.unstubAllGlobals())

describe('BlockTimeForm', () => {
  it('blocks the time in studio time', async () => {
    const fetchMock = server()
    vi.stubGlobal('fetch', fetchMock)
    render(<BlockTimeForm />)
    await screen.findByText('No blocked time coming up.')
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Block this time' }))
    expect(await screen.findByText('Blocked.')).toBeInTheDocument()
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ action: 'add', startIso: localToUtcISO(DAY, '09:00'), endIso: localToUtcISO(DAY, '12:00'), reason: 'Setup', note: 'Deep clean' })
  })

  it('all day blocks midnight to midnight', async () => {
    const fetchMock = server()
    vi.stubGlobal('fetch', fetchMock)
    render(<BlockTimeForm />)
    await screen.findByText('No blocked time coming up.')
    fill()
    fireEvent.click(screen.getByLabelText('All day'))
    fireEvent.click(screen.getByRole('button', { name: 'Block this time' }))
    await screen.findByText('Blocked.')
    const body = JSON.parse(fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')![1].body)
    expect(body.startIso).toBe(localToUtcISO(DAY, '00:00'))
    expect(body.endIso).toBe(localToUtcISO('2031-03-13', '00:00'))
  })

  it('over a class it shows the clash and Block anyway resends with confirm', async () => {
    const fetchMock = server({ clashFirst: true })
    vi.stubGlobal('fetch', fetchMock)
    render(<BlockTimeForm />)
    await screen.findByText('No blocked time coming up.')
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Block this time' }))
    expect(await screen.findByText(clash)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Block anyway' }))
    await screen.findByText(/Blocked\. It sits on Pottery/)
    const posts = fetchMock.mock.calls.filter((c) => c[1]?.method === 'POST').map((c) => JSON.parse(c[1].body))
    expect(posts[1]).toMatchObject({ action: 'add', confirm: true, reason: 'Setup', note: 'Deep clean' })
  })

  it('needs an end after the start before it asks the server', async () => {
    const fetchMock = server()
    vi.stubGlobal('fetch', fetchMock)
    render(<BlockTimeForm />)
    await screen.findByText('No blocked time coming up.')
    fill()
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '08:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Block this time' }))
    expect(await screen.findByText('Blocked time has to end after it starts.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false)
  })

  it('lists upcoming blocks and removes one after a confirm', async () => {
    const fetchMock = server({ existing: [{ id: 'blk_1', startIso: localToUtcISO(DAY, '09:00'), endIso: localToUtcISO(DAY, '10:00'), reason: 'Painting' }] })
    vi.stubGlobal('fetch', fetchMock)
    render(<BlockTimeForm />)
    const item = await screen.findByRole('listitem', { name: /Painting/ })
    fireEvent.click(within(item).getByRole('button', { name: 'Remove' }))
    fireEvent.click(within(item).getByRole('button', { name: 'Yes, remove it' }))
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(true))
    expect(JSON.parse(fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')![1].body)).toEqual({ action: 'remove', id: 'blk_1' })
  })
})

describe('Block time: Why and Note (mock-up D)', () => {
  it('Why is Closed · Private · Setup (Closed to start); the note is optional and says only you see it; old free-text reasons still list', async () => {
    const fetchMock = server({ existing: [{ id: 'blk_1', startIso: localToUtcISO(DAY, '09:00'), endIso: localToUtcISO(DAY, '10:00'), reason: 'Private event', note: 'Smith baby shower' }] })
    vi.stubGlobal('fetch', fetchMock)
    render(<BlockTimeForm />)
    const why = screen.getByRole('group', { name: 'Why' })
    expect(within(why).getAllByRole('button').map((b) => b.textContent)).toEqual(['Closed', 'Private', 'Setup'])
    expect(within(why).getByRole('button', { name: 'Closed' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText(/Note/)).toHaveAttribute('placeholder', 'Optional')
    expect(screen.getByText('(only you see it)')).toBeInTheDocument()
    const row = await screen.findByRole('listitem', { name: /Private event/ })
    expect(within(row).getByText('Note: Smith baby shower')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: DAY } })
    fireEvent.click(within(why).getByRole('button', { name: 'Private' }))
    fireEvent.click(screen.getByRole('button', { name: 'Block this time' }))
    await screen.findByText('Blocked.')
    const body = JSON.parse(fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')![1].body)
    expect(body).toMatchObject({ reason: 'Private event' })
    expect(body.note).toBeUndefined()
  })

  it('no inline styles left: the form and Print a day use admin.css', async () => {
    const { readFileSync } = await import('node:fs')
    for (const f of ['src/components/admin/classes/BlockTimeForm.tsx', 'src/components/admin/classes/PrintDay.tsx']) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/style=\{|<style>/)
    }
  })
})

describe('BlockTimeForm inside an /admin sheet', () => {
  it('starts on the day it was opened for, reports typing, and hands the block up instead of saying so itself', async () => {
    vi.stubGlobal('fetch', server())
    const onDirty = vi.fn(), onBlocked = vi.fn()
    render(<BlockTimeForm initialDay={DAY} onDirtyChange={onDirty} onBlocked={onBlocked} />)
    await screen.findByText('No blocked time coming up.')
    expect(screen.getByLabelText('Day')).toHaveValue(DAY)
    expect(onDirty).toHaveBeenLastCalledWith(false)
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: 'Deep clean' } })
    expect(onDirty).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: 'Block this time' }))
    await waitFor(() => expect(onBlocked).toHaveBeenCalled())
    expect(onBlocked.mock.calls[0][0]).toMatchObject({ id: 'blk_new', startIso: localToUtcISO(DAY, '09:00'), endIso: localToUtcISO(DAY, '12:00') })
    expect(onDirty).toHaveBeenLastCalledWith(false)
    expect(screen.queryByText('Blocked.')).toBeNull()
  })
})
