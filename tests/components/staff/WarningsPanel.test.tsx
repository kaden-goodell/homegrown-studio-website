import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import WarningsPanel from '@components/staff/WarningsPanel'

const LINE = 'Sun Oct 18 · Pumpkin Pails 1–3 PM is within an hour of the Rivera party 1:00 PM. Move one in Square.'
const warning = { code: 'class-over-party', eventKind: 'workshop', eventId: 'clssch_pails', title: 'Pumpkin Pails', when: '2026-10-18T18:00:00.000Z', detail: '', action: '', line: LINE }

function serve(...answers: Array<{ status: number; body: unknown }>) {
  const spy = vi.spyOn(globalThis, 'fetch')
  for (const a of answers) spy.mockResolvedValueOnce({ ok: a.status < 300, status: a.status, json: async () => a.body } as Response)
  return spy
}

afterEach(() => vi.restoreAllMocks())

describe('WarningsPanel', () => {
  it('shows nothing when the schedule is clear', async () => {
    const spy = serve({ status: 200, body: { data: { warnings: [] } } })
    const { container } = render(<WarningsPanel onOpenEvent={vi.fn()} />)
    await waitFor(() => expect(spy).toHaveBeenCalledWith('/api/staff/warnings.json', { cache: 'no-store' }))
    await act(async () => {})
    expect(container).toBeEmptyDOMElement()
  })

  it('positive control: a non-empty list does render a box', async () => {
    serve({ status: 200, body: { data: { warnings: [warning] } } })
    const { container } = render(<WarningsPanel onOpenEvent={vi.fn()} />)
    await screen.findByText('⚠ Needs attention (1)')
    expect(container).not.toBeEmptyDOMElement()
  })

  it('shows the red box when the network fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'))
    render(<WarningsPanel onOpenEvent={vi.fn()} />)
    expect(await screen.findByText('⚠ Couldn’t check the schedule for conflicts.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('shows the red box on a 401', async () => {
    serve({ status: 401, body: { error: 'no' } })
    render(<WarningsPanel onOpenEvent={vi.fn()} />)
    expect(await screen.findByText('⚠ Couldn’t check the schedule for conflicts.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('keeps the red box up, disabled, while a retry is in flight', async () => {
    const spy = serve({ status: 503, body: { error: 'x' } })
    let release!: (r: Response) => void
    spy.mockImplementationOnce(() => new Promise<Response>((r) => { release = r }))
    render(<WarningsPanel onOpenEvent={vi.fn()} />)
    await screen.findByText('⚠ Couldn’t check the schedule for conflicts.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    const checking = await screen.findByRole('button', { name: 'Checking…' })
    expect(checking).toBeDisabled()
    expect(screen.getByText('⚠ Couldn’t check the schedule for conflicts.')).toBeInTheDocument()
    await act(async () => {
      release({ ok: true, status: 200, json: async () => ({ data: { warnings: [warning] } }) } as Response)
    })
    expect(await screen.findByText('⚠ Needs attention (1)')).toBeInTheDocument()
    expect(screen.queryByText('⚠ Couldn’t check the schedule for conflicts.')).toBeNull()
  })

  it('says how many things need attention and lists each line', async () => {
    serve({ status: 200, body: { data: { warnings: [warning, { ...warning, eventId: 'x', line: 'Second line.' }] } } })
    render(<WarningsPanel onOpenEvent={vi.fn()} />)
    expect(await screen.findByText('⚠ Needs attention (2)')).toBeInTheDocument()
    expect(screen.getByText(LINE)).toBeInTheDocument()
    expect(screen.getByText('Second line.')).toBeInTheDocument()
  })

  it('opens the event a line is about', async () => {
    serve({ status: 200, body: { data: { warnings: [warning] } } })
    const onOpenEvent = vi.fn()
    render(<WarningsPanel onOpenEvent={onOpenEvent} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }))
    expect(onOpenEvent).toHaveBeenCalledWith({ kind: 'workshop', id: 'clssch_pails', title: 'Pumpkin Pails' })
  })

  it('cannot be dismissed', async () => {
    serve({ status: 200, body: { data: { warnings: [warning] } } })
    render(<WarningsPanel onOpenEvent={vi.fn()} />)
    await screen.findByText('⚠ Needs attention (1)')
    expect(screen.queryByRole('button', { name: /dismiss|close|hide/i })).toBeNull()
  })

  it('says it could not check, in red, and tries again on request', async () => {
    serve({ status: 503, body: { error: 'x' } }, { status: 200, body: { data: { warnings: [warning] } } })
    render(<WarningsPanel onOpenEvent={vi.fn()} />)
    expect(await screen.findByText('⚠ Couldn’t check the schedule for conflicts.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('⚠ Needs attention (1)')).toBeInTheDocument()
  })
})
