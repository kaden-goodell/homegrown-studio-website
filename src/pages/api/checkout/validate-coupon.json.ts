import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { validateCoupon } from '@lib/coupons'

export const POST: APIRoute = async ({ request }) => {
  const logger = createLogger('api:checkout:validate-coupon')
  const startTime = Date.now()
  try {
    const body = await request.json()
    const result = validateCoupon(body.code)
    logger.info('Coupon validation', {
      code: body.code,
      valid: result.valid,
      duration_ms: Date.now() - startTime,
    })
    return new Response(JSON.stringify({ data: result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    logger.error('Coupon validation failed', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })
    return new Response(
      JSON.stringify({ error: 'Unable to validate coupon' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
