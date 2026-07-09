import 'dotenv/config'
import { SquareClient, SquareEnvironment } from 'square'

/**
 * Register the site's domain with Square for Apple Pay (one-time). Until this
 * runs against production, the Apple Pay button simply never renders — the
 * booking flow falls back to Google Pay / card with no error.
 *
 * Usage:
 *   npx tsx scripts/register-apple-pay-domain.ts [domain]
 *
 * Defaults to homegrowncraftstudio.com. Requires the PRODUCTION
 * SQUARE_ACCESS_TOKEN in .env. Square hosts the Apple domain-verification
 * file automatically for Netlify-served domains after registration.
 */

const domain = process.argv[2] ?? 'homegrowncraftstudio.com'

const client = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN!,
  environment: SquareEnvironment.Production,
})

async function main() {
  const res = await client.applePay.registerDomain({ domainName: domain })
  // SDK v44 responses expose fields directly on the response object.
  const status = (res as any).status ?? (res as any).result?.status
  console.log(`Registered ${domain} for Apple Pay — status: ${status}`)
  if (status !== 'VERIFIED') {
    console.log('Status is not VERIFIED yet — re-run this script to re-check.')
  }
}

main().catch((err) => {
  console.error('Apple Pay domain registration failed:', err?.body ?? err)
  process.exit(1)
})
