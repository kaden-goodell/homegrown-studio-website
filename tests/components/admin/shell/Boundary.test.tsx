import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Boundary, SafeRow } from '@components/admin/shell/Boundary'

function Bomb({ when }: { when: { boom: boolean } }) {
  if (when.boom) throw new Error('bad record')
  return <p>Fine now</p>
}

describe('admin error boundaries', () => {
  it('Try again asks for the data again, then draws once more', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const when = { boom: true }
    const onRetry = vi.fn(() => { when.boom = false })
    render(<Boundary name="tab" onRetry={onRetry}><Bomb when={when} /></Boundary>)
    expect(screen.getByText('Something went wrong showing this.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Fine now')).toBeInTheDocument()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('a bad row is skipped with a note; its neighbours still draw', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<><SafeRow><Bomb when={{ boom: true }} /></SafeRow><SafeRow><Bomb when={{ boom: false }} /></SafeRow></>)
    expect(screen.getByText('One item couldn’t be shown.')).toBeInTheDocument()
    expect(screen.getByText('Fine now')).toBeInTheDocument()
    err.mockRestore()
  })
})
