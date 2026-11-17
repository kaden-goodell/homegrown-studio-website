import { useState } from 'react'
import { shareOrCopy } from '@lib/share-or-copy'

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
    const result = await shareOrCopy({ url, title: shareTitle, text: shareText }, { contentType, itemId })
    if (result === 'copied' || result === 'failed') setDone(result)
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
