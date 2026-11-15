// src/pages/api/staff/shop-photo.ts
import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { getPhoto } from '@lib/magnet-orders'

export const prerender = false

/** GET ?draft=&photo= → one shop order photo (magnet or silhouette). Anyone signed in at /staff. */
export const GET: APIRoute = async ({ request, url }) => {
  if (!staffAuthorized(request)) return new Response('Sign in first.', { status: 401 })
  const photo = await getPhoto(url.searchParams.get('draft') ?? '', url.searchParams.get('photo') ?? '')
  if (!photo) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(photo), { status: 200, headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } })
}
