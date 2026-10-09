/**
 * Campaign tags on links we send people (emails, texts, shared invites), so a
 * visit from one is credited to it instead of showing up as "direct"
 * (read back by attribution.ts and by PostHog/GA).
 */
export interface Utm {
  source: string
  medium: 'email' | 'sms' | 'referral'
  campaign: string
  content?: string
}

export function withUtm(url: string, utm: Utm): string {
  const [base, hash] = url.split('#', 2)
  const sep = base.includes('?') ? '&' : '?'
  const q = new URLSearchParams({ utm_source: utm.source, utm_medium: utm.medium, utm_campaign: utm.campaign, ...(utm.content ? { utm_content: utm.content } : {}) })
  return `${base}${sep}${q.toString()}${hash !== undefined ? `#${hash}` : ''}`
}
