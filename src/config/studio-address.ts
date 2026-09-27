/**
 * Where the studio is. Client-safe (site.config is not), so booking panels and
 * confirmation screens can show the address and link to directions.
 *
 * Keep in step with `address` in site.config.ts.
 */
export const STUDIO_ADDRESS = {
  name: 'Hometown Studio',
  street: '525 Hughes Rd, Suite F',
  city: 'Madison',
  state: 'AL',
  zip: '35758',
} as const

/** "525 Hughes Rd, Suite F, Madison, AL 35758" */
export const STUDIO_ADDRESS_LINE = `${STUDIO_ADDRESS.street}, ${STUDIO_ADDRESS.city}, ${STUDIO_ADDRESS.state} ${STUDIO_ADDRESS.zip}`

export const STUDIO_DIRECTIONS_URL = `https://maps.google.com/?q=${encodeURIComponent(`${STUDIO_ADDRESS.name}, ${STUDIO_ADDRESS_LINE}`)}`
