import type { APIRoute } from 'astro'
import { kitConfig } from '@config/kit.config'
import { kitThemes } from '@config/kit-content'
import { createLogger } from '@lib/logger'
import { fetchPartyCrafts } from '@lib/craft-catalog'

const logger = createLogger('api:kits:service-info')

export const GET: APIRoute = async () => {
  const startTime = Date.now()

  // Unseeded → no package catalog yet. Distinct 503 so the UI can show an
  // internal-preview notice rather than the generic error state.
  if (!kitConfig.square.packageItemId) {
    return new Response(JSON.stringify({ error: 'kits not seeded' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  }

  try {
    const crafts = await fetchPartyCrafts()

    // Every theme is surfaced; the UI renders waitlist (non-stocked) ones as
    // notify-me cards. Only stocked themes carry buyable tiers.
    const themes = kitThemes.map((t) => ({
      id: t.id,
      displayName: t.displayName,
      tagline: t.tagline,
      scheme: t.scheme,
      photo: t.photo,
      stocked: t.stocked,
      tiers: t.stocked
        ? kitConfig.tiers.map((tier) => ({
            serves: tier.serves,
            packagePriceCents: tier.packagePriceCents,
            depositCents: tier.depositCents,
          }))
        : [],
    }))

    const data = {
      crafts,
      themes,
      assemblyFeeCents: kitConfig.assemblyFeeCents,
      minGuests: kitConfig.minGuests,
      maxGuests: kitConfig.maxGuests,
      /** Offered package sizes, ascending — the client's tier math derives from
       *  this instead of hardcoding serves-5 arithmetic. */
      tierSizes: kitConfig.tiers.map((t) => t.serves),
      leadTimeDays: kitConfig.leadTimeDays,
      returnWindow: kitConfig.returnWindow,
    }

    logger.info('Kit service info fetched', {
      duration_ms: Date.now() - startTime,
      craftCount: crafts.length,
    })

    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    logger.error('Failed to fetch kit service info', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })
    return new Response(JSON.stringify({ error: 'Failed to fetch kit information' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
