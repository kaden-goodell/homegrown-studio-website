import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { providers } from '@config/providers'

export const POST: APIRoute = async ({ request }) => {
  const logger = createLogger('api:programs:enroll')
  const startTime = Date.now()

  try {
    const body = await request.json()
    const { programId, programName, sessions, children, parentPhone, orderId } = body

    // Store enrollment data — the order note already contains the enrollment JSON
    // from the checkout flow. This endpoint is for any additional processing.
    logger.info('Program enrollment recorded', {
      duration_ms: Date.now() - startTime,
      programId,
      programName,
      sessionCount: sessions?.length,
      childCount: children?.length,
      orderId,
    })

    // Send Slack notification
    await providers.notification.send({
      type: 'webhook',
      title: `New program enrollment: ${programName}`,
      details: {
        program: programName,
        sessions: sessions?.map((s: { name: string }) => s.name).join(', '),
        children: children?.length,
        orderId,
      },
      severity: 'info',
      timestamp: new Date().toISOString(),
    })

    return new Response(JSON.stringify({ data: { success: true } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    logger.error('Program enrollment failed', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })
    return new Response(
      JSON.stringify({ error: 'Enrollment recording failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
