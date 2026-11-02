import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import AvailabilityEditor, { openDays, clockLabel } from '@components/staff/AvailabilityEditor'
import type { Availability } from '@lib/staffing/types'

const empty = (over: Partial<Availability> = {}): Availability => ({
  staffId: 'TM2', name: 'Jessica',
  weekly: { '0': null, '1': null, '2': null, '3': null, '4': null, '5': null, '6': null },
  dates: {}, updatedAt: null, history: [], ...over,
})

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-02T15:00:00Z')) // Mon Nov 2
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

const body = (i = 0) => JSON.parse(fetchMock.mock.calls[i][1].body)

describe('AvailabilityEditor', () => {
  it('the usual week shows the studio’s open days, Thursday first', () => {
    expect(openDays().map((d) => d.name)).toEqual(['Thursday', 'Friday', 'Saturday', 'Sunday'])
    render(<AvailabilityEditor initial={empty()} />)
    expect(screen.getAllByRole('group').filter((g) => g.tagName === 'FIELDSET').map((g) => g.querySelector('legend')!.textContent))
      .toEqual(['Thursdays', 'Fridays', 'Saturdays', 'Sundays'])
    expect(clockLabel('24:00')).toBe('Midnight')
    expect(clockLabel('13:30')).toBe('1:30 PM')
  })

  it('marking a day sends the cookie person’s times with expectedUpdatedAt and says Saved', async () => {
    const saved = empty({ weekly: { ...empty().weekly, '6': { kind: 'can', range: { from: '09:00', to: '21:00' }, note: '' } }, updatedAt: '2026-11-02T15:00:01.000Z' })
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { availability: saved } }) })
    const onSaved = vi.fn()
    render(<AvailabilityEditor initial={empty({ updatedAt: '2026-11-01T00:00:00.000Z' })} onSaved={onSaved} />)
    const save = screen.getByRole('button', { name: 'Save my times' })
    expect(save).toBeDisabled()
    const sat = screen.getByRole('group', { name: 'Can you work Saturdays?' })
    fireEvent.click(within(sat).getByRole('button', { name: /^Can$/ }))
    expect(within(sat).getByRole('button', { name: /Can$/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('group', { name: 'Saturdays hours' }).querySelectorAll('button')[1]) // Only some hours → the studio's Saturday hours
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes.')
    expect(screen.getByTestId('unsaved-bar')).toHaveTextContent('Unsaved changes')
    fireEvent.click(save)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved.'))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/staff/shifts.json')
    expect(body()).toEqual({
      action: 'availability',
      weekly: { ...empty().weekly, '6': { kind: 'can', range: { from: '09:00', to: '21:00' }, note: '' } },
      dates: {},
      expectedUpdatedAt: '2026-11-01T00:00:00.000Z',
    })
    expect(body()).not.toHaveProperty('staffId')
    expect(onSaved).toHaveBeenCalledWith(saved)
  })

  it('a stale save shows the times saved on the other device and says so', async () => {
    const current = empty({ weekly: { ...empty().weekly, '5': { kind: 'cant', range: null, note: '' } }, updatedAt: '2026-11-02T14:00:00.000Z' })
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'Someone changed your times on another device. Here they are.', stale: true, current }) })
    render(<AvailabilityEditor initial={empty()} />)
    fireEvent.click(within(screen.getByRole('group', { name: 'Can you work Thursdays?' })).getByRole('button', { name: /^Can$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save my times' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Someone changed your times on another device. Here they are.'))
    expect(within(screen.getByRole('group', { name: 'Can you work Fridays?' })).getByRole('button', { name: /Can’t/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(screen.getByRole('group', { name: 'Can you work Thursdays?' })).getByRole('button', { name: 'Not said' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('a different date: add with a note and times, see it listed in words, remove it', async () => {
    render(<AvailabilityEditor initial={empty()} />)
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-14' } })
    fireEvent.click(screen.getByRole('group', { name: 'Hours on that date' }).querySelectorAll('button')[1])
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '13:00' } })
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'dentist' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add this date' }))
    const mark = screen.getByTestId('date-mark')
    expect(mark).toHaveTextContent('Sat Nov 14')
    expect(mark).toHaveTextContent('Can’t work · 9 AM to 1 PM')
    expect(mark).toHaveTextContent('dentist')
    fireEvent.click(within(mark).getByRole('button', { name: /Remove Sat Nov 14/ }))
    expect(screen.queryByTestId('date-mark')).toBeNull()
  })

  it('refuses a past date or an end before the start in plain words', () => {
    render(<AvailabilityEditor initial={empty()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Add this date' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Pick a date.')
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-01' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add this date' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Pick today or a later date.')
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-20' } })
    fireEvent.click(screen.getByRole('group', { name: 'Hours on that date' }).querySelectorAll('button')[1])
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '15:00' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '10:00' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add this date' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Pick an end time after the start.')
  })

  it('a server refusal is shown as its sentence', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'Up to 4 times on one day.' }) })
    render(<AvailabilityEditor initial={empty()} />)
    fireEvent.click(within(screen.getByRole('group', { name: 'Can you work Sundays?' })).getByRole('button', { name: /^Can$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save my times' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Up to 4 times on one day.'))
  })

  it('every button is at least 44 px tall and every input is 16 px (no iPhone zoom)', () => {
    render(<AvailabilityEditor initial={empty({ weekly: { ...empty().weekly, '4': { kind: 'can', range: { from: '18:00', to: '20:00' }, note: '' } } })} />)
    for (const b of screen.getAllByRole('button')) expect(['2.75rem', '3rem', '3.25rem']).toContain(b.style.minHeight)
    for (const el of [...screen.getAllByRole('combobox'), screen.getByLabelText('Date'), screen.getByLabelText('Note (optional)')]) expect(el.style.fontSize).toBe('1rem')
  })

  it('a date picked but not added yet is flagged, and Save adds it (I5)', async () => {
    const saved = empty({ dates: { '2026-11-14': [{ kind: 'cant', range: null, note: 'wedding' }] }, updatedAt: '2026-11-02T15:00:01.000Z' })
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { availability: saved } }) })
    render(<AvailabilityEditor initial={empty()} />)
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-14' } })
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'wedding' } })
    expect(screen.getByTestId('unsaved-bar')).toHaveTextContent('The date you picked below gets added when you save.')
    fireEvent.click(screen.getByRole('button', { name: 'Save my times' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved.'))
    expect(body().dates).toEqual({ '2026-11-14': [{ kind: 'cant', range: null, note: 'wedding' }] })
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe('')
    expect(screen.queryByTestId('unsaved-bar')).toBeNull()
  })

  it('a half-filled date that can’t be added stops Save and says why, inline (I5)', async () => {
    render(<AvailabilityEditor initial={empty()} />)
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save my times' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Pick today or a later date.')
    expect(screen.getByRole('status')).toHaveTextContent('Check the date below first.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Unsaved changes bar: Discard goes back to what is saved, and Undo brings the changes back (I5)', () => {
    render(<AvailabilityEditor initial={empty()} />)
    expect(screen.queryByTestId('unsaved-bar')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull()
    const thu = () => screen.getByRole('group', { name: 'Can you work Thursdays?' })
    fireEvent.click(within(thu()).getByRole('button', { name: /^Can$/ }))
    expect(screen.getByTestId('unsaved-bar')).toHaveTextContent('Unsaved changes')
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(within(thu()).getByRole('button', { name: 'Not said' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Changes discarded. Your saved times are back.')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(within(thu()).getByRole('button', { name: /Can$/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('unsaved-bar')).toBeInTheDocument()
  })

  it('a usual-week day with the end before the start says so on that day and isn’t sent (m5)', () => {
    render(<AvailabilityEditor initial={empty({ weekly: { ...empty().weekly, '4': { kind: 'can', range: { from: '18:00', to: '20:00' }, note: '' } } })} />)
    const thu = screen.getAllByRole('group').find((g) => g.tagName === 'FIELDSET' && g.querySelector('legend')!.textContent === 'Thursdays')!
    fireEvent.change(within(thu).getByLabelText('To'), { target: { value: '17:00' } })
    expect(within(thu).getByRole('alert')).toHaveTextContent('Pick an end time after the start.')
    fireEvent.click(screen.getByRole('button', { name: 'Save my times' }))
    expect(screen.getByRole('status')).toHaveTextContent('Check Thursdays: pick an end time after the start.')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
