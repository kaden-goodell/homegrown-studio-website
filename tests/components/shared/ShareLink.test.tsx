import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ShareLink from '@components/shared/ShareLink'

afterEach(() => {
  delete (window as any).posthog
  vi.unstubAllGlobals()
})

describe('ShareLink analytics', () => {
  it('reports a copied link with what was shared', async () => {
    const capture = vi.fn()
    ;(window as any).posthog = { capture }
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => {}) } })
    render(<ShareLink url="https://x.test/i" label="Share" shareTitle="Hi" contentType="party_invite" />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() => expect(capture).toHaveBeenCalledWith('share', { content_type: 'party_invite', method: 'copy_link' }))
  })

  it('reports the share sheet, and nothing when it is closed', async () => {
    const capture = vi.fn()
    ;(window as any).posthog = { capture }
    const share = vi.fn(async () => {})
    vi.stubGlobal('navigator', { share, clipboard: { writeText: vi.fn() } })
    render(<ShareLink url="https://x.test/w" label="Share" shareTitle="Hi" contentType="workshop" itemId="w1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() => expect(capture).toHaveBeenCalledWith('share', { content_type: 'workshop', method: 'share_sheet', item_id: 'w1' }))

    capture.mockClear()
    share.mockRejectedValueOnce(Object.assign(new Error('closed'), { name: 'AbortError' }))
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() => expect(share).toHaveBeenCalledTimes(2))
    expect(capture).not.toHaveBeenCalled()
  })
})
