import { useEffect, useRef, useState } from 'react'
import { shareOrCopy } from '@lib/share-or-copy'

/**
 * The share icon at the top of a pop-up, next to the ×. On a phone it opens
 * the share sheet; on a computer it copies the link and says so for a moment.
 * (Kaden, 3 Nov 2026: people had no way to send one workshop to a friend.)
 */
interface ShareIconButtonProps {
  url: string
  /** What the share sheet shows above the link. */
  title: string
  text?: string
  /** For analytics: "workshop", "party_craft"… */
  contentType: string
  itemId?: string
  /** Read out by screen readers. */
  label?: string
}

export default function ShareIconButton({ url, title, text, contentType, itemId, label = 'Share this' }: ShareIconButtonProps) {
  const [said, setSaid] = useState<'' | 'copied' | 'failed'>('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  async function handle() {
    clearTimeout(timer.current)
    setSaid('')
    const result = await shareOrCopy({ url, title, text }, { contentType, itemId })
    if (result === 'copied') {
      setSaid('copied')
      timer.current = setTimeout(() => setSaid(''), 2500)
    } else if (result === 'failed') {
      setSaid('failed')
    }
  }

  return (
    <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      <button
        type="button"
        onClick={handle}
        aria-label={label}
        title={label}
        style={{
          minWidth: '2.75rem',
          minHeight: '2.75rem',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'none',
          border: 'none',
          borderRadius: '0.5rem',
          color: 'var(--color-primary)',
          cursor: 'pointer',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12" />
          <path d="M7.5 7.5 12 3l4.5 4.5" />
          <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
        </svg>
      </button>
      <span
        role="status"
        style={{
          position: 'absolute',
          top: 'calc(100% + 0.25rem)',
          right: 0,
          zIndex: 2,
          whiteSpace: said === 'failed' ? 'normal' : 'nowrap',
          width: said === 'failed' ? '16rem' : undefined,
          padding: said ? '0.375rem 0.625rem' : 0,
          borderRadius: '0.5rem',
          background: 'var(--color-dark)',
          color: 'var(--color-background)',
          fontSize: '0.8125rem',
          lineHeight: 1.35,
          wordBreak: 'break-all',
          pointerEvents: said === 'failed' ? 'auto' : 'none',
        }}
      >
        {said === 'copied' && 'Link copied.'}
        {said === 'failed' && <>Copy this link: {url}</>}
      </span>
    </span>
  )
}
