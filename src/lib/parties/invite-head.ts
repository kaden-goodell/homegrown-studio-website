/**
 * The top of the guest invite page (/invite) and its link preview. A
 * cancelled party leads with "This party was cancelled." (never "You're
 * invited", no date or time, no RSVP), so a parent skimming a text preview
 * isn't sent to a party that isn't happening. A party whose record can't be
 * read just now shows a neutral "couldn't load" line instead (no details).
 */
import { inviteContent as c } from '@config/invite-content'
import { PARTY_CANCELLED_NOTICE } from '@lib/waiver-event'

export interface InviteHead {
  eyebrow: string
  headline: string
  subline: string
  pageTitle: string
  description: string
  /** craft, when and where on the page */
  showDetails: boolean
}

/** The party's record couldn't be read just now (re-review Minor F): neither invited nor cancelled is known. */
export const INVITE_UNREADABLE = { headline: 'We couldn’t load this party right now.', subline: 'Try again in a minute.' }

export function inviteHead(i: { cancelled: boolean; hasDetails: boolean; title: string; craft: string; when: string; unreadable?: boolean }): InviteHead {
  // Never "You're invited" (nor a date from the link) for a party whose state is unknown: it may be cancelled or moved.
  if (i.unreadable) {
    return {
      eyebrow: 'Party invite', headline: INVITE_UNREADABLE.headline, subline: INVITE_UNREADABLE.subline,
      pageTitle: 'Party invite', description: 'A craft party at Hometown Studio.', showDetails: false,
    }
  }
  if (i.cancelled) {
    return {
      eyebrow: 'Party cancelled', headline: PARTY_CANCELLED_NOTICE, subline: 'Sorry for the change. Nothing to do here.',
      pageTitle: 'Party cancelled', description: PARTY_CANCELLED_NOTICE, showDetails: false,
    }
  }
  return {
    eyebrow: c.eyebrow,
    headline: i.hasDetails ? (i.title ? c.headlineWithTitle.replace('{title}', i.title) : c.headlineDefault) : c.fallback.headline,
    subline: c.subline,
    pageTitle: "You're Invited",
    description: i.hasDetails ? `${i.craft} · ${i.when} · at Hometown Studio. Tap to RSVP.` : "You're invited to a craft party at Hometown Studio.",
    showDetails: true,
  }
}
