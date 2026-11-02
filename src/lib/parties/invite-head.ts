/**
 * The top of the guest invite page (/invite) and its link preview. A
 * cancelled party leads with "This party was cancelled." (never "You're
 * invited", no date or time, no RSVP), so a parent skimming a text preview
 * isn't sent to a party that isn't happening.
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

export function inviteHead(i: { cancelled: boolean; hasDetails: boolean; title: string; craft: string; when: string }): InviteHead {
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
