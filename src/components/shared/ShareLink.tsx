import { useState } from 'react'
import { trackShare } from '@lib/analytics'

/**
 * A link to pass on: opens the phone's share sheet where there is one, and
 * copies the link everywhere else. Says what it did.
 */
interface ShareLinkProps {
  url: string
  /** Button text, e.g. "Send the link" */
  label: string
  /** What the share sheet shows above the link. */
  shareTitle: string
  shareText?: string
  /** What is being passed on, for analytics: "party_invite", "workshop_waiver"… */
  contentType?: string
  itemId?: string
}

export default function ShareLink({ url, label, shareTitle, shareText, contentType = 'link', itemId }: ShareLinkProps) {
  const [done, setDone] = useState<'' | 'copied' | 'failed'>('')

  async function handle() {
    setDone('')
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator) : undefined
    if (nav?.share) {
      try {
        await nav.share({ title: shareTitle, text: shareText, url })
        trackShare(contentType, 'share_sheet', itemId)
        return
      } catch (err) {
        // Closing the share sheet is not a failure, and needs no message.
        if ((err as { name?: string })?.name === 'AbortError') return
      }
    }
    try {
      await nav!.clipboard.writeText(url)
      setDone('copied')
      trackShare(contentType, 'copy_link', itemId)
    } catch {
      setDone('failed')
    }
  }

  return (
    <div>
      <button type="button" className="btn btn-secondary" onClick={handle}>
        {label}
      </button>
      <p role="status" style={{ margin: '0.375rem 0 0', minHeight: '1.25rem', fontSize: '0.875rem', color: 'var(--color-text)' }}>
        {done === 'copied' && 'Link copied.'}
        {done === 'failed' && (
          <>
            Copy this link: <span style={{ wordBreak: 'break-all', color: 'var(--color-dark)' }}>{url}</span>
          </>
        )}
      </p>
    </div>
  )
}
