import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PickStaff from '@components/staff/PickStaff'

const staff = [{ id: 'c', name: 'Ava', role: 'crew' }, { id: 'o', name: 'Catherine', role: 'owner' }] as any

describe('PickStaff (N1)', () => {
  it('crew pick their name with one tap', () => {
    const onPick = vi.fn()
    render(<PickStaff staff={staff} busy={false} error={null} showBack={false} onPick={onPick} onBack={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ava' }))
    expect(onPick).toHaveBeenCalledWith('c')
  })
  it('an owner’s name asks for the admin passcode first, then sends it', () => {
    const onPick = vi.fn()
    render(<PickStaff staff={staff} busy={false} error={null} showBack={false} onPick={onPick} onBack={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Catherine' }))
    expect(onPick).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('To sign in as Catherine, enter the admin passcode.'), { target: { value: 'owner-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in as Catherine' }))
    expect(onPick).toHaveBeenCalledWith('o', 'owner-secret')
    fireEvent.click(screen.getByRole('button', { name: 'Back to the team' }))
    expect(screen.getByRole('button', { name: 'Ava' })).toBeInTheDocument()
  })
})
