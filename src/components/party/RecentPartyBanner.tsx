import { useState, useEffect } from 'react'
import { trackRecentPartyBanner } from '@lib/analytics'
import { loadRecentParty, clearRecentParty, hostPartyUrl, RECENT_PARTY_EVENT, type RecentParty } from '@lib/recent-party'

/**
 * Floating banner that lets a host return to their most recent booking's
 * invitation (same-device, from localStorage). Sticks just below the site
 * header (which is itself sticky at 4.5rem tall — see Header.astro) so the
 * two ride together as the page scrolls.
 */
export default function RecentPartyBanner() {
  const [recent, setRecent] = useState<RecentParty | null>(null)

  useEffect(() => {
    // On load, and again whenever a booking is made or cleared on this page.
    const read = () => setRecent(loadRecentParty())
    read()
    window.addEventListener(RECENT_PARTY_EVENT, read)
    return () => window.removeEventListener(RECENT_PARTY_EVENT, read)
  }, [])

  if (!recent) return null

  return (
    <div
      style={{
        position: 'sticky',
        // Pin at the sticky header's bottom edge (header height = 4.5rem),
        // below its z-index (50) so the header always wins any overlap.
        top: '4.5rem',
        zIndex: 40,
        width: '100%',
        background: 'var(--color-dark)',
        color: '#fff',
        boxShadow: '0 4px 16px rgba(var(--color-primary-rgb), 0.22)',
      }}
    >
      <div
        style={{
          maxWidth: '72rem',
          margin: '0 auto',
          padding: '0.6rem 1rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.75rem',
        }}
      >
        <span style={{ fontSize: '0.9375rem', fontWeight: 500 }}>
          Your {recent.craftName} party is booked for {recent.slotLabel}.
        </span>
        <a
          href={hostPartyUrl(recent, window.location.origin)}
          onClick={() => trackRecentPartyBanner('open')}
          style={{
            fontSize: '0.8125rem',
            fontWeight: 700,
            color: 'var(--color-primary)',
            background: '#fff',
            padding: '0.4rem 0.9rem',
            borderRadius: '999px',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          View your party →
        </a>
        <button
          type="button"
          onClick={() => { trackRecentPartyBanner('dismiss'); clearRecentParty(); setRecent(null) }}
          aria-label="Dismiss"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '1rem',
            lineHeight: 1,
            opacity: 0.85,
            padding: '0.25rem',
          }}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
