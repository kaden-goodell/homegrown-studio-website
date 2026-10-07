// tests/components/staff/EventSettingsSheet.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import EventSettingsSheet from '@components/staff/EventSettingsSheet'

const PAILS = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Light Pink', 'Light Blue', 'Black', 'Lavender'] }
const CLASS = { kind: 'workshop', id: 'clssch_pails', title: 'Pumpkin Pails', startIso: '2026-10-18T18:00:00.000Z', days: ['2026-10-18'], dropOff: false, options: [], signupCutoffHours: null } as any

function serve(event: any, postAnswer?: { status: number; body: unknown }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, init?: any) => {
    if (init?.method === 'POST') {
      if (postAnswer) return { ok: postAnswer.status < 300, status: postAnswer.status, json: async () => postAnswer.body } as Response
      return { ok: true, status: 200, json: async () => ({ data: { ...event, ...JSON.parse(init.body) } }) } as Response
    }
    return { ok: true, status: 200, json: async () => ({ data: event }) } as Response
  })
}
const posted = (spy: ReturnType<typeof serve>) => spy.mock.calls.filter(([, init]: any) => init?.method === 'POST').map(([, init]: any) => JSON.parse(init.body))

afterEach(() => vi.restoreAllMocks())

async function open(event: any = CLASS) {
  await act(async () => {
    render(<EventSettingsSheet event={event} onSaved={vi.fn()} onClose={vi.fn()} />)
  })
}

describe('EventSettingsSheet — seat questions', async () => {
  it('a party has no seat questions and no cutoff', async () => {
    serve({ ...CLASS, kind: 'party' })
    await open({ ...CLASS, kind: 'party' })
    expect(screen.queryByText('Questions for each seat')).toBeNull()
    expect(screen.queryByText('Sign-ups close')).toBeNull()
  })

  it('builds a question, and saves it only after a confirm', async () => {
    const spy = serve(CLASS)
    await open()
    fireEvent.click(screen.getByRole('button', { name: '+ Add a question' }))
    fireEvent.change(screen.getByLabelText('Question 1'), { target: { value: 'Pumpkin color' } })
    for (const c of ['Lavender', 'Black']) {
      fireEvent.change(screen.getByLabelText('New choice for question 1'), { target: { value: c } })
      fireEvent.click(screen.getByRole('button', { name: 'Add choice' }))
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save questions' }))
    expect(screen.getByText('Save these questions? Everyone booking this class will pick one answer per seat.')).toBeInTheDocument()
    expect(posted(spy)).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Yes, save' }))
    await waitFor(() =>
      expect(posted(spy)).toEqual([{ kind: 'workshop', id: 'clssch_pails', options: [{ id: '', label: 'Pumpkin color', choices: ['Lavender', 'Black'] }] }]),
    )
  })

  it('counts a typed choice that was never added', async () => {
    const spy = serve({ ...CLASS, options: [PAILS] })
    await open({ ...CLASS, options: [PAILS] })
    fireEvent.change(screen.getByLabelText('New choice for question 1'), { target: { value: ' Mint ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save questions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, save' }))
    await waitFor(() =>
      expect(posted(spy)).toEqual([{ kind: 'workshop', id: 'clssch_pails', options: [{ ...PAILS, choices: [...PAILS.choices, 'Mint'] }] }]),
    )
  })

  it('shows the server’s refusal when picks lock a choice', async () => {
    const msg = 'People have already picked for this class, so existing choices can’t be removed or renamed. You can add new ones.'
    serve({ ...CLASS, options: [PAILS] }, { status: 409, body: { error: msg } })
    await open({ ...CLASS, options: [PAILS] })
    fireEvent.click(screen.getByRole('button', { name: 'Remove Black' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save questions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, save' }))
    expect(await screen.findByText(msg)).toBeInTheDocument()
  })
})

describe('EventSettingsSheet — sign-ups close', async () => {
  it('shows the default greyed: 0 hours for a plain class', async () => {
    serve(CLASS)
    await open()
    expect(screen.getByLabelText('Sign-ups close')).toHaveAttribute('placeholder', '0 (default)')
    expect(screen.getByText('Using the default: 0 hours.')).toBeInTheDocument()
  })

  it('shows the default greyed: 24 hours once the class asks questions', async () => {
    serve({ ...CLASS, options: [PAILS] })
    await open({ ...CLASS, options: [PAILS] })
    expect(screen.getByLabelText('Sign-ups close')).toHaveAttribute('placeholder', '24 (default)')
  })

  it('saves whole hours after a confirm', async () => {
    const spy = serve(CLASS)
    await open()
    fireEvent.change(screen.getByLabelText('Sign-ups close'), { target: { value: '48' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Close sign-ups 48 hours before this class?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, save' }))
    await waitFor(() => expect(posted(spy)).toEqual([{ kind: 'workshop', id: 'clssch_pails', signupCutoffHours: 48 }]))
  })

  it('will not offer to save part hours', async () => {
    serve(CLASS)
    await open()
    fireEvent.change(screen.getByLabelText('Sign-ups close'), { target: { value: '2.5' } })
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.getByText('Whole hours, 0 to 336.')).toBeInTheDocument()
  })
})

describe('EventSettingsSheet — capacity', () => {
  it('a party has no capacity field', async () => {
    serve({ ...CLASS, kind: 'party' })
    await open({ ...CLASS, kind: 'party' })
    expect(screen.queryByLabelText('Capacity')).toBeNull()
  })

  it('shows "from Square" when the capacity is unknown', async () => {
    serve(CLASS)
    await open()
    expect(screen.getByLabelText('Capacity')).toHaveAttribute('placeholder', 'from Square')
  })

  it('saves whole seats after a confirm', async () => {
    const spy = serve(CLASS)
    await open()
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Set this class to 12 seats?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, save' }))
    await waitFor(() => expect(posted(spy)).toEqual([{ kind: 'workshop', id: 'clssch_pails', capacity: 12 }]))
  })

  it('will not offer to save a capacity outside 1–999', async () => {
    serve(CLASS)
    await open()
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '0' } })
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.getByText('Whole seats, 1 to 999.')).toBeInTheDocument()
  })
})
