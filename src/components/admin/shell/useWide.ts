import { useEffect, useState } from 'react'

/** iPad and desktop: the sidebar, side panels and the 7-column week. Phones are narrower. */
export const WIDE_QUERY = '(min-width: 900px)'

export function useWide(): boolean {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(WIDE_QUERY).matches
  const [wide, setWide] = useState(get)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(WIDE_QUERY)
    const on = () => setWide(mq.matches)
    on()
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return wide
}
