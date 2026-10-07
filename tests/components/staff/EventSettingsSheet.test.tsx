// tests/components/staff/EventSettingsSheet.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

function open(event: any = CLASS) {
  render(<EventSettingsSheet event={event} onSaved={vi.fn()} onClose={vi.fn()} />)
}

describe('EventSettingsSheet — seat questions', () => {
  it('a party has no seat questions and no cutoff', () => {
    serve({ ...CLASS, kind: 'party' })
    open({ ...CLASS, kind: 'party' })
    expect(screen.queryByText('Questions for each seat')).toBeNull()
    expect(screen.queryByText('Sign-ups close')).toBeNull()
  })

  it('builds a question, and saves it only after a confirm', async () => {
    const spy = serve(CLASS)
    open()
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

  it('shows the server’s refusal when picks lock a choice', async () => {
    const msg = 'People have already picked for this class, so existing choices can’t be removed or renamed. You can add new ones.'
    serve({ ...CLASS, options: [PAILS] }, { status: 409, body: { error: msg } })
    open({ ...CLASS, options: [PAILS] })
    fireEvent.click(screen.getByRole('button', { name: 'Remove Black' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save questions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, save' }))
    expect(await screen.findByText(msg)).toBeInTheDocument()
  })
})

describe('EventSettingsSheet — sign-ups close', () => {
  it('shows the default greyed: 0 hours for a plain class', () => {
    serve(CLASS)
    open()
    expect(screen.getByLabelText('Sign-ups close')).toHaveAttribute('placeholder', '0 (default)')
    expect(screen.getByText('Using the default: 0 hours.')).toBeInTheDocument()
  })

  it('shows the default greyed: 24 hours once the class asks questions', () => {
    serve({ ...CLASS, options: [PAILS] })
    open({ ...CLASS, options: [PAILS] })
    expect(screen.getByLabelText('Sign-ups close')).toHaveAttribute('placeholder', '24 (default)')
  })

  it('saves whole hours after a confirm', async () => {
    const spy = serve(CLASS)
    open()
    fireEvent.change(screen.getByLabelText('Sign-ups close'), { target: { value: '48' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Close sign-ups 48 hours before this class?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, save' }))
    await waitFor(() => expect(posted(spy)).toEqual([{ kind: 'workshop', id: 'clssch_pails', signupCutoffHours: 48 }]))
  })

  it('will not offer to save part hours', () => {
    serve(CLASS)
    open()
    fireEvent.change(screen.getByLabelText('Sign-ups close'), { target: { value: '2.5' } })
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.getByText('Whole hours, 0 to 336.')).toBeInTheDocument()
  })
})
