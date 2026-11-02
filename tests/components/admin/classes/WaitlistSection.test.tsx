import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, fireEvent, within, waitFor, configure } from '@testing-library/react'
import WaitlistSection from '@components/admin/classes/WaitlistSection'
import { ok, posts, refuse, renderSheet } from '../sheets/harness'

configure({ asyncUtilTimeout: 5000 })
afterEach(() => vi.unstubAllGlobals())

const WL = '/api/admin/classes/waitlist.json'
const CLASSES = '/api/admin/classes/classes.json'

const row = (over: any) => ({
  id: 'wle_1', position: 1, name: 'Jane Doe', email: 'jane@example.com', phone: '(402) 980-2907', seats: 1, seatsLabel: '1 seat',
  sessionIds: ['ses_1'], joinedAt: '2026-11-02T21:05:00.000Z', state: 'waiting', stateWords: 'Waiting', card: 'Visa ending 4242',
  maxCents: 2180, bookingId: null, history: [{ at: '2026-11-02T21:05:00.000Z', by: null, change: 'Joined the waitlist' }], ...over,
})
const jane = row({})
const sam = row({ id: 'wle_2', position: 2, name: 'Sam Doe', email: 'sam@example.com', joinedAt: '2026-11-02T21:10:00.000Z', history: [] })
const gone = row({ id: 'wle_3', position: null, name: 'Ann Lee', state: 'declined', stateWords: 'Card didn’t go through · off the list' })

function show(views: any[], o: { post?: (url: string, body: any) => any } = {}) {
  let i = 0
  const f = vi.fn(async (url: string, init?: any) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(init.body)
      const answer = o.post?.(url, body)
      if (answer) return answer
      return ok({ data: views[Math.min(++i, views.length - 1)] })
    }
    return ok({ data: views[Math.min(i, views.length - 1)] })
  })
  vi.stubGlobal('fetch', f)
  const onChanged = vi.fn()
  renderSheet(<WaitlistSection classId="cls_1" onChanged={onChanged} />)
  return { f, onChanged }
}

describe('WaitlistSection (class sheet › Bookings)', () => {
  it('waiting rows in order with seats, "up to", card and joined time; past people below; the history toggles', async () => {
    show([{ rows: [jane, sam, gone], canRun: false, stopped: null }])
    expect(await screen.findByText('Waitlist · 2 waiting')).toBeInTheDocument()
    const waiting = screen.getByRole('list', { name: 'Waiting, in order' })
    const items = within(waiting).getAllByRole('listitem').filter((li) => li.parentElement === waiting)
    expect(items.map((li) => within(li).getAllByText(/^\d\. /)[0].textContent)).toEqual(['1. Jane Doe', '2. Sam Doe'])
    expect(within(items[0]).getByText(/1 seat · up to \$21\.80 · Visa ending 4242 · joined /)).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Off the waitlist' })).getByText(/Card didn’t go through · off the list/)).toBeInTheDocument()
    // No free seat: no run panel.
    expect(screen.queryByRole('group', { name: 'Run the waitlist' })).toBeNull()
    fireEvent.click(within(items[0]).getByRole('button', { name: 'What happened' }))
    expect(within(items[0]).getByRole('list', { name: 'What happened with Jane Doe' })).toHaveTextContent('Joined the waitlist')
    fireEvent.click(within(items[0]).getByRole('button', { name: 'Hide what happened' }))
    expect(within(items[0]).queryByRole('list', { name: 'What happened with Jane Doe' })).toBeNull()
  })

  it('Remove asks in the sheet first; Keep them sends nothing; Take them off removes and tells the owner what happened', async () => {
    const { f, onChanged } = show([{ rows: [jane], canRun: false }, { rows: [row({ position: null, state: 'removed', stateWords: 'Taken off' })], canRun: false }])
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    const ask = screen.getByRole('group', { name: 'Take Jane Doe off the waitlist?' })
    expect(ask).toHaveTextContent('Their saved card comes off and they get an email saying so. Nothing is charged.')
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep them' }))
    expect(posts(f)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Take Jane Doe off the waitlist?' })).getByRole('button', { name: 'Take them off' }))
    await waitFor(() => expect(posts(f, WL)[0].body).toEqual({ action: 'remove', classId: 'cls_1', entryId: 'wle_1' }))
    expect(await screen.findByText('Jane Doe is off the waitlist. Their card came off and they got an email.')).toBeInTheDocument()
    expect(onChanged).toHaveBeenCalled()
  })

  it('the run panel only shows when the server says a run would do something; the result line says what happened', async () => {
    const { f } = show([
      { rows: [jane], canRun: true, stopped: null },
      { rows: [row({ position: null, state: 'added', stateWords: 'Added · $21.80 charged' })], canRun: false, stopped: null },
    ], { post: (_u, b) => (b.action === 'run' ? ok({ data: { rows: [row({ position: null, state: 'added', stateWords: 'Added · $21.80 charged' })], canRun: false, stopped: null, run: { added: 1, declined: 0, unknown: 0, skipped: 0, stopped: null, note: 'Added 1 person and charged their saved card.' } } }) : null) })
    const panel = await screen.findByRole('group', { name: 'Run the waitlist' })
    expect(panel).toHaveTextContent('A seat is free and people are waiting.')
    expect(panel).toHaveTextContent('Square never takes the same charge twice.')
    fireEvent.click(within(panel).getByRole('button', { name: 'Run the waitlist now' }))
    expect(await screen.findByText('Added 1 person and charged their saved card.')).toHaveAttribute('role', 'status')
    expect(posts(f, WL)[0].body).toEqual({ action: 'run', classId: 'cls_1' })
    expect(screen.queryByRole('group', { name: 'Run the waitlist' })).toBeNull()
  })

  it('I3: when the waitlist stopped on the register, the line says why and "Update the register" fixes it, then runs again', async () => {
    const stopped = { why: 'register', action: 'update-register', button: 'Update the register', words: 'The waitlist has stopped because the register’s price for this class doesn’t match the website. Nobody was charged, and people can book the free seat normally until it runs again.' }
    const { f } = show([{ rows: [row({ stateWords: 'Waiting · the register’s price didn’t match, nobody was charged' })], canRun: true, stopped }], {
      post: (url, b) => {
        if (url === CLASSES) return ok({ data: { class: {}, result: 'updated' } })
        if (b.action === 'run') return ok({ data: { rows: [row({ position: null, state: 'added', stateWords: 'Added · $21.80 charged' })], canRun: false, stopped: null, run: { added: 1, declined: 0, unknown: 0, skipped: 0, stopped: null, note: 'Added 1 person and charged their saved card.' } } })
        return null
      },
    })
    const line = await screen.findByRole('group', { name: 'The waitlist has stopped' })
    expect(line).toHaveTextContent(stopped.words)
    // The plain run panel doesn't show alongside the stop line.
    expect(screen.queryByRole('group', { name: 'Run the waitlist' })).toBeNull()
    fireEvent.click(within(line).getByRole('button', { name: 'Update the register' }))
    await waitFor(() => expect(posts(f).map((p: any) => [p.url, p.body.action])).toEqual([[CLASSES, 'update-register'], [WL, 'run']]))
    expect(posts(f, CLASSES)[0].body).toEqual({ action: 'update-register', id: 'cls_1' })
    expect(await screen.findByText('Added 1 person and charged their saved card.')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'The waitlist has stopped' })).toBeNull()
  })

  it('I3: a register fix that fails shows its error and doesn\'t run', async () => {
    const stopped = { why: 'register', action: 'update-register', button: 'Update the register', words: 'The waitlist has stopped because …' }
    const { f } = show([{ rows: [jane], canRun: true, stopped }], { post: (url) => (url === CLASSES ? refuse(409, { error: 'Set up the class tax first.' }) : null) })
    fireEvent.click(within(await screen.findByRole('group', { name: 'The waitlist has stopped' })).getByRole('button', { name: 'Update the register' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Set up the class tax first.')
    expect(posts(f, WL)).toHaveLength(0)
  })
})
