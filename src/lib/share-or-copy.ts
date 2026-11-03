import { trackShare } from '@lib/analytics'

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed'

/**
 * Pass a link on: the phone's share sheet where there is one (Messages,
 * Facebook…), otherwise copy it. Closing the share sheet is not a failure.
 * Used by every share button so they all behave the same.
 */
export async function shareOrCopy(
  link: { url: string; title: string; text?: string },
  analytics: { contentType: string; itemId?: string },
): Promise<ShareResult> {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator) : undefined
  if (nav?.share) {
    try {
      await nav.share({ title: link.title, text: link.text, url: link.url })
      trackShare(analytics.contentType, 'share_sheet', analytics.itemId)
      return 'shared'
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return 'cancelled'
      // Any other refusal: fall through and copy instead.
    }
  }
  try {
    await nav!.clipboard.writeText(link.url)
    trackShare(analytics.contentType, 'copy_link', analytics.itemId)
    return 'copied'
  } catch {
    return 'failed'
  }
}
