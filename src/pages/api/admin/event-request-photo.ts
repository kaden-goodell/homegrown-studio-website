import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { getRequestPhoto } from '@lib/event-requests'

export const prerender = false

/** GET ?id=&n= one inspiration photo from a private event request. Owners only. */
export const GET: APIRoute = async ({ request, url }) => {
  if (!adminAuthorized(request)) return new Response('Sign in first.', { status: 401 })
  const photo = await getRequestPhoto(url.searchParams.get('id') ?? '', Number(url.searchParams.get('n')))
  if (!photo) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(photo), { status: 200, headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } })
}
