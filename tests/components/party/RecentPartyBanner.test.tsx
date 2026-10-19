import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import RecentPartyBanner from '@components/party/RecentPartyBanner'
import { saveRecentParty } from '@lib/recent-party'

// Node's own (empty) localStorage shadows jsdom's here: a small stand-in.
beforeEach(() => {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('RecentPartyBanner', () => {
  it('links the host page with its key, and PostHog never records that click (S2-R9a)', async () => {
    saveRecentParty({
      bookingId: 'pty_1', hostToken: 'host-key', craftName: 'Tote Bags', slotLabel: 'Sat, Nov 8 · 1:30 PM CT',
      startIso: new Date(Date.now() + 7 * 86_400_000).toISOString(), savedAt: new Date().toISOString(),
    })
    render(<RecentPartyBanner />)
    const link = await screen.findByRole('link', { name: /View your party/ })
    expect(link.getAttribute('href')).toMatch(/\/party\/pty_1\?key=host-key$/)
    expect(link).toHaveClass('ph-no-capture')
  })
})
