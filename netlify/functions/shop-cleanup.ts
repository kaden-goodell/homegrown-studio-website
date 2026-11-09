// netlify/functions/shop-cleanup.ts
import type { Config, Context } from '@netlify/functions'
import { createHmac } from 'node:crypto'

export const config: Config = { schedule: '0 9 * * *' }

export default async (_req: Request, context: Context) => {
  const site = (context?.site?.url ?? process.env.URL ?? '').replace(/\/$/, '')
  const secret = process.env.LOOKUP_SIGNING_SECRET
  if (!site || !secret) return new Response('not configured', { status: 500 })
  const key = createHmac('sha256', secret).update('job:shop-cleanup').digest('hex')
  const res = await fetch(`${site}/api/jobs/shop-cleanup.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-job-key': key }, body: '{}' })
  return new Response(await res.text(), { status: res.status })
}
