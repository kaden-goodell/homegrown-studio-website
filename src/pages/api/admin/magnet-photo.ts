// src/pages/api/admin/magnet-photo.ts
import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { getPhoto } from '@lib/magnet-orders'

export const prerender = false

/** GET ?draft=&photo= → one magnet photo. Owners only. */
export const GET: APIRoute = async ({ request, url }) => {
  if (!adminAuthorized(request)) return new Response('Sign in first.', { status: 401 })
  const photo = await getPhoto(url.searchParams.get('draft') ?? '', url.searchParams.get('photo') ?? '')
  if (!photo) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(photo), { status: 200, headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } })
}
