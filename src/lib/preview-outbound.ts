/**
 * A namespaced preview (STORE_NAMESPACE set, Square sandbox) must never email
 * or text a real customer: every message goes to Kaden instead, marked with
 * who it was meant for (Kaden's rule: test texts only to (402) 980-2907).
 * Live deploys (no namespace) are untouched. Pure, so it is tested.
 */
export const PREVIEW_EMAIL_TO = 'kaden.goodell@gmail.com'
export const PREVIEW_SMS_TO = '+14029802907'

type Env = { STORE_NAMESPACE?: string }

function previewNamespace(env: Env): string {
  return (env.STORE_NAMESPACE ?? '').trim()
}

export function previewEmail<T extends { to: string; subject: string }>(msg: T, env: Env): T {
  const ns = previewNamespace(env)
  if (!ns) return msg
  return { ...msg, to: PREVIEW_EMAIL_TO, subject: `[${ns} → ${msg.to}] ${msg.subject}` }
}

export function previewText(msg: { to: string; content: string }, env: Env): { to: string; content: string } {
  const ns = previewNamespace(env)
  if (!ns) return msg
  return { to: PREVIEW_SMS_TO, content: `[${ns} → ${msg.to}] ${msg.content}` }
}
