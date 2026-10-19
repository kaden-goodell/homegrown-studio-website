import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ScheduleDialog from '@components/admin/classes/ScheduleDialog'
import { localToUtcISO } from '@lib/party-slots'

const posts = (f: any) => f.mock.calls.filter((c: any) => c[1]?.method === 'POST').map((c: any) => JSON.parse(c[1].body))
afterEach(() => vi.unstubAllGlobals())

describe('ScheduleDialog', () => {
  it('schedules a library class on the dates picked, in studio time, using the usual length and seats', async () => {
    const onDone = vi.fn()
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { class: { id: 'cls_new' } } }) }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ScheduleDialog name="Pottery" libraryId="lib_1" defaultMinutes={90} defaultCapacity={8} onDone={onDone} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText('Date 1 day'), { target: { value: '2031-03-12' } })
    fireEvent.change(screen.getByLabelText('Date 1 start'), { target: { value: '10:00' } })
    expect(screen.getByLabelText('Date 1 end')).toHaveValue('11:30')
    expect(screen.getByLabelText('Date 1 seats')).toHaveValue('8')
    fireEvent.click(screen.getByRole('button', { name: 'Add to the calendar' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    const [body] = posts(fetchMock)
    expect(body).toMatchObject({ action: 'create', libraryId: 'lib_1', status: 'open' })
    expect(body.sessions).toEqual([{ startIso: localToUtcISO('2031-03-12', '10:00'), endIso: localToUtcISO('2031-03-12', '11:30'), capacity: 8 }])
  })

  it('shows the clash message and keeps the form', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: 'Clashes with Party for Sam, Wed Mar 12 10 AM.' }) })))
    render(<ScheduleDialog name="Pottery" libraryId="lib_1" defaultMinutes={90} defaultCapacity={8} onDone={() => {}} onCancel={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add to the calendar' }))
    expect(await screen.findByText('Clashes with Party for Sam, Wed Mar 12 10 AM.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to the calendar' })).toBeInTheDocument()
  })

  it('duplicates a class onto new dates, more than one at once', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { class: { id: 'cls_new' } } }) }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ScheduleDialog name="Pottery" duplicateId="cls_1" defaultMinutes={60} defaultCapacity={10} onDone={() => {}} onCancel={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add another date' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add to the calendar' }))
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1))
    expect(posts(fetchMock)[0]).toMatchObject({ action: 'duplicate', id: 'cls_1' })
    expect(posts(fetchMock)[0].sessions).toHaveLength(2)
  })
})
