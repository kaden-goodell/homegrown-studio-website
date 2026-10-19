import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ToastHost, TOAST_MS, useToast } from '@components/admin/shell/Toast'

function Buttons({ undo }: { undo?: () => void }) {
  const toast = useToast()
  return (
    <>
      <button type="button" onClick={() => toast('Saved.')}>one</button>
      <button type="button" onClick={() => toast('Block removed.', { undo })}>two</button>
    </>
  )
}
afterEach(() => vi.useRealTimers())

describe('admin toast', () => {
  it('one toast in a status region near the bottom; it goes after 4 seconds; a newer one replaces it', () => {
    vi.useFakeTimers()
    render(<ToastHost><Buttons /></ToastHost>)
    const region = screen.getByRole('status')
    fireEvent.click(screen.getByText('one'))
    expect(region).toHaveTextContent('Saved.')
    fireEvent.click(screen.getByText('two'))
    expect(region).toHaveTextContent('Block removed.')
    expect(region).not.toHaveTextContent('Saved.')
    act(() => { vi.advanceTimersByTime(TOAST_MS - 1) })
    expect(region).toHaveTextContent('Block removed.')
    act(() => { vi.advanceTimersByTime(1) })
    expect(region).toBeEmptyDOMElement()
    expect(TOAST_MS).toBe(4000)
  })

  it('Undo runs once and the toast goes', () => {
    const undo = vi.fn()
    render(<ToastHost><Buttons undo={undo} /></ToastHost>)
    fireEvent.click(screen.getByText('two'))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(undo).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })
})
