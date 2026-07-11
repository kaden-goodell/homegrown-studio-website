import { useState, useEffect, useRef } from 'react'

/**
 * Address input with type-ahead suggestions (Google Places Autocomplete, New
 * Places REST API — no Maps JS SDK). Degrades to a plain input when no API key
 * is configured, so the flow never depends on the key existing.
 *
 * Sessions: Google bills autocomplete per SESSION (one token from first
 * keystroke until a pick). We mint a token per typing session and rotate it
 * after each selection.
 */

interface AddressInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  style?: React.CSSProperties
  /** Google Places API key; defaults to PUBLIC_GOOGLE_PLACES_KEY. Tests inject one. */
  apiKey?: string
}

// Studio-centric bias: suggestions favor the Huntsville/Madison area first
// (kits are pickup-only, so parties cluster nearby). 50 km is Google's MAX
// circle radius — anything larger 400s the whole request.
const BIAS = { latitude: 34.6993, longitude: -86.7483, radius: 50_000 }

const MIN_CHARS = 4
const DEBOUNCE_MS = 250

export default function AddressInput({ value, onChange, placeholder, style, apiKey }: AddressInputProps) {
  const key = apiKey ?? (import.meta.env.PUBLIC_GOOGLE_PLACES_KEY as string | undefined)

  const [suggestions, setSuggestions] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const sessionRef = useRef<string>(crypto.randomUUID())
  const abortRef = useRef<AbortController | null>(null)
  const skipNextFetch = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Debounced suggestion fetch — aborts the in-flight request on every keystroke.
  useEffect(() => {
    if (!key) return
    if (skipNextFetch.current) {
      skipNextFetch.current = false
      return
    }
    if (value.trim().length < MIN_CHARS) {
      setSuggestions([])
      setOpen(false)
      return
    }
    const timer = setTimeout(async () => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
          body: JSON.stringify({
            input: value.trim(),
            sessionToken: sessionRef.current,
            includedRegionCodes: ['us'],
            locationBias: { circle: { center: { latitude: BIAS.latitude, longitude: BIAS.longitude }, radius: BIAS.radius } },
          }),
        })
        if (!res.ok) throw new Error()
        const json = await res.json()
        const texts: string[] = (json.suggestions ?? [])
          .map((s: any) => s.placePrediction?.text?.text)
          .filter((t: unknown): t is string => typeof t === 'string')
        setSuggestions(texts)
        setOpen(texts.length > 0)
        setHighlighted(-1)
      } catch {
        // Autocomplete is a nicety — typing by hand always works. Stay silent.
        setSuggestions([])
        setOpen(false)
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, key])

  // Click outside closes the list.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  function pick(text: string) {
    skipNextFetch.current = true // the pick itself must not refetch
    onChange(text)
    setOpen(false)
    setSuggestions([])
    sessionRef.current = crypto.randomUUID() // selection ends the billing session
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted((h) => (h + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted((h) => (h <= 0 ? suggestions.length - 1 : h - 1))
    } else if (e.key === 'Enter' && highlighted >= 0) {
      e.preventDefault()
      pick(suggestions[highlighted])
    } else if (e.key === 'Escape') {
      // Swallow it — Escape with an open list closes the list, not the modal.
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      {/* With the Places picker active, the browser's native address autofill
          must NOT fight our dropdown. Chrome ignores autocomplete="off" on
          address-shaped fields but gives up when the token and name are ones
          it can't pattern-match — so the field gets nonsense values while the
          picker runs, and proper autofill hints when it's a plain input. */}
      <input
        type="text"
        autoComplete={key ? 'kit-venue-xk7' : 'street-address'}
        name={key ? 'kit-venue-search' : 'address'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (suggestions.length > 0) setOpen(true) }}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        style={style}
      />
      {open && (
        <ul
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 0.25rem)',
            left: 0,
            right: 0,
            zIndex: 20,
            margin: 0,
            padding: '0.25rem',
            listStyle: 'none',
            borderRadius: '0.75rem',
            border: '1px solid rgba(150, 112, 91, 0.2)',
            background: '#fff',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.14)',
            maxHeight: '14rem',
            overflowY: 'auto',
          }}
        >
          {suggestions.map((text, i) => (
            <li
              key={text}
              role="option"
              aria-selected={i === highlighted}
              onMouseDown={(e) => { e.preventDefault(); pick(text) }}
              onMouseEnter={() => setHighlighted(i)}
              style={{
                padding: '0.55rem 0.75rem',
                borderRadius: '0.5rem',
                fontSize: '0.8125rem',
                color: 'var(--color-dark)',
                cursor: 'pointer',
                background: i === highlighted ? 'rgba(150, 112, 91, 0.1)' : 'transparent',
              }}
            >
              {text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
