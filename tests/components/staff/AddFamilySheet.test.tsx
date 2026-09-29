import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AddFamilySheet from '@components/staff/AddFamilySheet'
import type { HouseholdMatch } from '@components/staff/DoorSearch'

const sam: HouseholdMatch = {
  recordId: 'wvr_9', firstName: 'Sam', lastName: 'Lee', contactHint: '', signedAt: '2026-08-01T00:00:00.000Z',
  agreementVersion: 'v3', validUntil: '2027-08-01T00:00:00.000Z', covered: true, kids: [{ name: 'Mia Lee', allergies: '' }],
  adultAllergies: '', photoConsent: true, openStudioToday: false,
}
const ev = { kind: 'workshop' as const, id: 'ws1', title: 'Parents Night Out', day: '2026-09-29' }

function post(data: any) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ data }) } as Response)
}
afterEach(() => vi.restoreAllMocks())

describe('AddFamilySheet', () => {
  it('closes itself and refreshes the roster once a family is added (nothing more to read out)', async () => {
    post({})
    const onAdded = vi.fn(); const onClose = vi.fn()
    render(<AddFamilySheet event={ev} initialHousehold={sam} onAdded={onAdded} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '✓ Add & mark here' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onAdded).toHaveBeenCalled()
  })

  it('a drop-off add keeps the sheet up with the pickup code until Done', async () => {
    post({ oneTimeCode: '4821' })
    const onAdded = vi.fn(); const onClose = vi.fn()
    render(<AddFamilySheet event={ev} initialHousehold={sam} onAdded={onAdded} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '✓ Add & mark here' }))
    expect(await screen.findByText('4821')).toBeInTheDocument()
    expect(screen.getByText('Texted to the parent.')).toBeInTheDocument()
    expect(onAdded).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('says so when the code text did not send', async () => {
    post({ oneTimeCode: '4821', smsFailed: true })
    render(<AddFamilySheet event={ev} initialHousehold={sam} onAdded={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '✓ Add & mark here' }))
    expect(await screen.findByText(/text did not send/)).toBeInTheDocument()
  })
})
