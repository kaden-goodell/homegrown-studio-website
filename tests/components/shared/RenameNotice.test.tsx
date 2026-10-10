import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('@lib/analytics', () => ({ trackRenameNotice: vi.fn() }))
import RenameNotice, { RENAME_NOTICE_KEY } from '@components/shared/RenameNotice'

const wait = () => act(async () => { await vi.advanceTimersByTimeAsync(1500) })

describe('RenameNotice', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    const m = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, String(v)),
      removeItem: (k: string) => void m.delete(k),
      clear: () => m.clear(),
    })
    window.history.replaceState(null, '', '/')
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('shows on a first visit, after a beat', async () => {
    render(<RenameNotice />)
    expect(screen.queryByText('Same studio, new name')).toBeNull()
    await wait()
    expect(screen.getByText('Same studio, new name')).toBeTruthy()
  })

  it('"Got it" closes it and it stays gone next time', async () => {
    const { unmount } = render(<RenameNotice />)
    await wait()
    fireEvent.click(screen.getByText('Got it'))
    expect(screen.queryByText('Same studio, new name')).toBeNull()
    expect(window.localStorage.getItem(RENAME_NOTICE_KEY)).toBe('1')
    unmount()
    render(<RenameNotice />)
    await wait()
    expect(screen.queryByText('Same studio, new name')).toBeNull()
  })

  it('the close button remembers too', async () => {
    render(<RenameNotice />)
    await wait()
    fireEvent.click(screen.getByLabelText('Close'))
    expect(window.localStorage.getItem(RENAME_NOTICE_KEY)).toBe('1')
  })

  it('never shows on the waiver', async () => {
    window.history.replaceState(null, '', '/waiver')
    render(<RenameNotice />)
    await wait()
    expect(screen.queryByText('Same studio, new name')).toBeNull()
  })
})
