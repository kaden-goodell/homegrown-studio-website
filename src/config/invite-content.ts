/**
 * Copy for the shareable party invitation page (/invite).
 *
 * The host shares an invite link after booking; guests land here, see the
 * party details, and RSVP by signing their household's participation
 * agreement. All customer-facing text lives here so it's reusable + tweakable
 * in one place.
 */
export const inviteContent = {
  eyebrow: 'You’re Invited',
  /** {title} is the party name the host sets (e.g. "Ari’s 7th Birthday"). */
  headlineWithTitle: 'You’re invited to {title}!',
  headlineDefault: 'You’re invited to a craft party!',
  subline: 'A private party at Homegrown Studio — good people, good music, and something handmade to take home.',

  /** Labels for the detail chips. Values come from the invite link. */
  labels: {
    craft: 'We’re making',
    when: 'When',
    where: 'Where',
  },

  where: 'Homegrown Studio · 525 Hughes Rd Ste F, Madison, AL',

  rsvp: {
    heading: 'One quick thing before you come',
    body: 'Everyone coming signs our short participation agreement — about a minute, and it covers you and your own kids for a full year of visits. Every adult in your group signs their own, so forward this to anyone coming with you.',
    cta: '✍️ RSVP & sign your agreement',
    footnote: 'Each adult signs for themselves and their own kids — please don’t sign for someone else’s children.',
  },

  calendar: {
    heading: 'Add it to your calendar',
    google: '📅 Google Calendar',
    apple: '📅 Apple / Outlook',
  },

  /** Shown if the link is missing its details. */
  fallback: {
    headline: 'You’re invited to Homegrown Studio!',
    cta: '✍️ Sign your participation agreement',
  },
}
