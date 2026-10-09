import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AgreementSheet from '@components/staff/AgreementSheet'

const h: any = {
  recordId: 'wvr_1', signer: 'Jamie Rivera', phone: '2565550199', email: 'jamie@x.com',
  children: [{ name: 'Kiddo Rivera', allergies: 'peanuts', medications: 'inhaler' }], childCount: 1,
  adultAllergies: '', emergency: { name: 'Bob', phone: '2565559999', relationship: 'Spouse' },
  authorizedPickup: [{ name: 'Grandma Rivera', phone: '' }], notAuthorized: 'Rick Smith', responsibleAdult: '',
  photoConsent: false, signedAt: '2026-08-01T12:00:00.000Z', agreementVersion: 'v1', validUntil: '2099-08-01T00:00:00.000Z', checkin: {},
}

describe('AgreementSheet', () => {
  it('shows who signed, the kids with health notes, emergency contact and photo choice', () => {
    render(<AgreementSheet h={h} dropOff={false} onClose={() => {}} />)
    const text = screen.getByRole('dialog').textContent!
    expect(text).toContain('Jamie Rivera')
    expect(text).toContain('Kiddo Rivera · ⚠ peanuts · 💊 inhaler')
    expect(text).toContain('Bob (Spouse)')
    expect(text).toContain('🚫 No photos')
    expect(text).toContain('version v1')
    expect(text).not.toContain('May pick up') // pickup list is drop-off only
  })
  it('shows the pickup lists on a drop-off event', () => {
    render(<AgreementSheet h={h} dropOff onClose={() => {}} />)
    const text = screen.getByRole('dialog').textContent!
    expect(text).toContain('Grandma Rivera')
    expect(text).toContain('Rick Smith')
  })
})
