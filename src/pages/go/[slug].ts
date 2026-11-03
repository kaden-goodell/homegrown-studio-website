import type { APIRoute } from 'astro'
import { shortLinkTarget } from '@config/short-links'

/** Partner short links. An unknown slug still lands on the home page, untagged. */
export const GET: APIRoute = ({ params }) =>
  new Response(null, {
    status: 302,
    headers: { Location: shortLinkTarget(params.slug ?? '') ?? '/', 'Cache-Control': 'no-store' },
  })
