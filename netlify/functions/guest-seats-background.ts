import { createHmac } from 'node:crypto'

/**
 * Background (the `-background` filename; up to 15 minutes): add an online booking's guest seats in
 * Square, one call to the site per seat (src/pages/api/jobs/guest-seat.json.ts).
 * Started by the booking route right after the charge. Netlify functions
 * can't import `@lib/*`, so this only knocks on the site's door; the site
 * checks the signed ticket, does the work, and texts the owners if a person
 * is needed. Stops at the first seat the site couldn't add (it has already
 * texted which seats to add by hand).
 */
export async function run(
  site: string | undefined,
  secret: string | undefined,
  input: { ticket?: unknown; seats?: unknown },
  ask: typeof fetch = fetch,
): Promise<{ added: number; reason: string }> {
  if (!site || !secret) return { added: 0, reason: 'not configured' }
  const seats = Number(input.seats)
  if (typeof input.ticket !== 'string' || !Number.isInteger(seats) || seats < 2 || seats > 50) return { added: 0, reason: 'bad input' }
  const key = createHmac('sha256', secret).update('job:guest-seats').digest('hex')
  let added = 0
  for (let seat = 2; seat <= seats; seat++) {
    let ok = false
    // One more try on "no answer" (the seat call is safe to repeat).
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try {
        const res = await ask(`${site.replace(/\/$/, '')}/api/jobs/guest-seat.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-job-key': key },
          body: JSON.stringify({ ticket: input.ticket, seat }),
        })
        if (res.ok) ok = true
        else if (res.status < 500) return { added, reason: `seat ${seat}: site answered ${res.status}` }
      } catch {
        // retry once
      }
    }
    if (!ok) return { added, reason: `seat ${seat}: no answer` }
    added++
  }
  return { added, reason: 'done' }
}

export default async (req: Request) => {
  const input = await req.json().catch(() => ({}))
  const outcome = await run(process.env.URL, process.env.LOOKUP_SIGNING_SECRET, input)
  console.log('guest-seats', JSON.stringify(outcome))
}
