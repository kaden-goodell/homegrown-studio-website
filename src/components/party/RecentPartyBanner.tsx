import { useState, useEffect } from 'react'
import { loadRecentParty, clearRecentParty, hostPartyUrl, type RecentParty } from '@lib/recent-party'

/**
 * Sticky top banner that lets a host return to their most recent booking's
 * invitation (same-device, from localStorage). Rendered at the very top of the
 * page — above the hero — so it's the first thing a returning host sees.
 */
export default function RecentPartyBanner() {
  const [recent, setRecent] = useState<RecentParty | null>(null)

  useEffect(() => {
    setRecent(loadRecentParty())
  }, [])

  if (!recent) return null

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 60,
        width: '100%',
        background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
        color: '#fff',
        boxShadow: '0 4px 16px rgba(150, 112, 91, 0.22)',
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
          🎉 Your {recent.craftName} party is booked for {recent.slotLabel}.
        </span>
        <a
          href={hostPartyUrl(recent, window.location.origin)}
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
          onClick={() => { clearRecentParty(); setRecent(null) }}
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
