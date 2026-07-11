import { useState, useEffect } from 'react'
import KitModal from './KitModal'

interface Craft {
  id: string
  name: string
  perHeadCents: number
  perHeadMaxCents?: number
  description?: string
  imageUrl?: string | null
  personalized?: boolean
  popular?: boolean
}

interface Tier {
  serves: number
  packagePriceCents: number
  depositCents: number
}

interface Theme {
  id: string
  displayName: string
  tagline: string
  scheme: string
  photo: string
  stocked: boolean
  tiers: Tier[]
}

interface KitServiceInfo {
  crafts: Craft[]
  themes: Theme[]
  assemblyFeeCents: number
  minGuests: number
  maxGuests: number
  leadTimeDays: number
  returnWindow: string
}

function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}
function priceCompact(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : formatPrice(cents)
}
function perPersonLabel(minCents: number, maxCents?: number): string {
  return maxCents && maxCents > minCents ? `${priceCompact(minCents)}–${priceCompact(maxCents)}` : formatPrice(minCents)
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

/** Cheapest package price across a theme's tiers — the "from $X" teaser. */
function fromPrice(tiers: Tier[]): number | null {
  if (!tiers.length) return null
  return Math.min(...tiers.map((t) => t.packagePriceCents))
}

/** Photo-less theme tiles get a gradient in the theme's own palette, so the
 *  cards read as designed placeholders instead of three identical stock shots. */
const SCHEME_GRADIENTS: Record<string, string> = {
  gold: 'linear-gradient(135deg, rgba(212,175,55,0.30), rgba(245,222,179,0.45))',
  silver: 'linear-gradient(135deg, rgba(160,168,180,0.30), rgba(220,225,232,0.5))',
  blue: 'linear-gradient(135deg, rgba(90,140,200,0.28), rgba(170,200,235,0.45))',
  rainbow: 'linear-gradient(120deg, rgba(240,120,120,0.30), rgba(245,205,120,0.32), rgba(140,205,150,0.32), rgba(130,165,230,0.32), rgba(190,140,220,0.32))',
  neutral: 'linear-gradient(135deg, rgba(200,185,165,0.35), rgba(235,228,215,0.5))',
  'sweet-sixteen': 'linear-gradient(135deg, rgba(235,140,180,0.30), rgba(250,210,225,0.5))',
}
function schemeGradient(scheme: string): string {
  return SCHEME_GRADIENTS[scheme] ?? 'linear-gradient(135deg, rgba(150,112,91,0.10), rgba(198,167,142,0.20))'
}

/** One waitlist card's email capture — shares the party notify-me endpoint.
 *  Sends the theme id as `interest` so the longest waitlist tells us which
 *  table to stock next. */
function WaitlistCard({ theme }: { theme: Theme }) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')

  async function join() {
    if (!isValidEmail(email.trim()) || state === 'sending') return
    setState('sending')
    try {
      const res = await fetch('/api/party/notify-me.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), interest: `kit-theme:${theme.id}` }),
      })
      if (!res.ok) throw new Error()
      setState('done')
    } catch {
      setState('error')
    }
  }

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '1rem',
        overflow: 'hidden',
        border: '1px solid rgba(150, 112, 91, 0.15)',
        background: 'rgba(255, 255, 255, 0.7)',
        opacity: 0.72,
      }}
    >
      <div style={{ position: 'relative', width: '100%', aspectRatio: '4 / 3', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: schemeGradient(theme.scheme), filter: 'grayscale(0.4)' }}>
        {theme.photo ? (
          <img src={theme.photo} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <span style={{ fontFamily: 'var(--font-heading)', fontSize: '1.25rem', fontWeight: 600, color: 'rgba(90,70,55,0.65)', textAlign: 'center', padding: '0 1rem' }}>{theme.displayName}</span>
        )}
        <span style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', background: 'rgba(70,70,70,0.85)', color: '#fff', borderRadius: '2rem', padding: '0.28rem 0.7rem', fontSize: '0.72rem', fontWeight: 700 }}>
          Coming soon
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '1rem 1.125rem 1.25rem' }}>
        <span style={{ fontSize: '1.0625rem', fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)' }}>{theme.displayName}</span>
        <p style={{ margin: '0.35rem 0 0.85rem', fontSize: '0.8125rem', lineHeight: 1.5, color: 'var(--color-muted)' }}>{theme.tagline}</p>
        {state === 'done' ? (
          <span style={{ marginTop: 'auto', fontSize: '0.8125rem', fontWeight: 600, color: 'rgb(34, 197, 94)' }}>
            ✓ You&rsquo;re on the list
          </span>
        ) : (
          <div style={{ marginTop: 'auto', display: 'flex', gap: '0.4rem' }}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{ flex: 1, minWidth: 0, padding: '0.5rem 0.7rem', borderRadius: '0.6rem', border: '1px solid rgba(150, 112, 91, 0.2)', background: 'rgba(255,255,255,0.9)', fontSize: '0.8125rem', color: 'var(--color-dark)', outline: 'none', boxSizing: 'border-box' }}
            />
            <button
              type="button"
              onClick={join}
              disabled={!isValidEmail(email.trim()) || state === 'sending'}
              style={{
                padding: '0.5rem 0.85rem',
                borderRadius: '0.6rem',
                border: 'none',
                background: isValidEmail(email.trim()) && state !== 'sending' ? 'linear-gradient(135deg, var(--color-primary), var(--color-accent))' : 'rgba(150, 112, 91, 0.3)',
                color: '#fff',
                fontSize: '0.8125rem',
                fontWeight: 600,
                cursor: isValidEmail(email.trim()) && state !== 'sending' ? 'pointer' : 'default',
                whiteSpace: 'nowrap',
              }}
            >
              {state === 'sending' ? '…' : 'Notify me'}
            </button>
          </div>
        )}
        {state === 'error' && (
          <p style={{ fontSize: '0.72rem', color: '#dc2626', marginTop: '0.4rem' }}>That didn&rsquo;t go through — try again.</p>
        )}
      </div>
    </div>
  )
}

export default function KitLanding() {
  const [info, setInfo] = useState<KitServiceInfo | null>(null)
  // 'seeding' is the distinct 503 state (catalog not seeded) — an internal
  // preview notice, NOT the generic retryable error.
  const [status, setStatus] = useState<'loading' | 'ready' | 'seeding' | 'error'>('loading')
  const [modalOpen, setModalOpen] = useState(false)
  const [initialCraftId, setInitialCraftId] = useState<string | undefined>(undefined)
  const [initialThemeId, setInitialThemeId] = useState<string | undefined>(undefined)
  const [showAllCrafts, setShowAllCrafts] = useState(false)
  const CRAFT_PREVIEW_COUNT = 6

  async function loadInfo() {
    setStatus('loading')
    try {
      const res = await fetch('/api/kits/service-info.json', { cache: 'no-store' })
      if (res.status === 503) {
        setStatus('seeding')
        return
      }
      if (!res.ok) throw new Error()
      const json = await res.json()
      setInfo((json.data ?? json) as KitServiceInfo)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }

  useEffect(() => {
    loadInfo()
  }, [])

  // ?craft=<id> / ?theme=<id> deeplinks — preselect and open the modal
  // (parity with /book). A theme deeplink lands on the build step with the
  // table already chosen; the visitor never re-picks what they clicked.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const craft = params.get('craft')
    const theme = params.get('theme')
    if (craft) setInitialCraftId(craft)
    if (theme) setInitialThemeId(theme)
    if (craft || theme) setModalOpen(true)
  }, [])

  function openModal(opts?: { craftId?: string; themeId?: string }) {
    setInitialCraftId(opts?.craftId)
    setInitialThemeId(opts?.themeId)
    setModalOpen(true)
  }
  function closeModal() {
    setModalOpen(false)
    setInitialCraftId(undefined)
    setInitialThemeId(undefined)
  }

  if (status === 'loading') {
    return <p style={{ textAlign: 'center', fontSize: '0.875rem', color: 'var(--color-muted)' }}>Loading kits…</p>
  }

  // Distinct internal-preview notice — the flag is on but the catalog isn't seeded.
  if (status === 'seeding') {
    return (
      <div style={{ maxWidth: '32rem', margin: '0 auto', textAlign: 'center', padding: '2rem', borderRadius: '1rem', background: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(180, 83, 9, 0.25)' }}>
        <p style={{ fontSize: '1rem', fontWeight: 600, color: '#92400e', margin: '0 0 0.5rem' }}>
          Kits aren&rsquo;t live yet — catalog not seeded
        </p>
        <p style={{ fontSize: '0.875rem', color: '#92400e', lineHeight: 1.6, margin: 0 }}>
          This is an internal preview. Run the seed script and paste the catalog ids into
          {' '}<code>kit.config.ts</code> to bring the kit product online.
        </p>
      </div>
    )
  }

  if (status === 'error' || !info) {
    return (
      <div style={{ maxWidth: '28rem', margin: '0 auto', textAlign: 'center' }}>
        <p style={{ fontSize: '0.875rem', color: '#dc2626', marginBottom: '1rem' }}>
          We couldn&rsquo;t load kits. This is usually a brief connection hiccup.
        </p>
        <button
          type="button"
          onClick={loadInfo}
          style={{ padding: '0.75rem 1.5rem', borderRadius: '0.75rem', border: 'none', background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))', color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer' }}
        >
          Try again
        </button>
      </div>
    )
  }

  const stockedThemes = info.themes.filter((t) => t.stocked)
  const waitlistThemes = info.themes.filter((t) => !t.stocked)
  const crafts = info.crafts

  return (
    <div>
      {/* Above-the-fold CTA — don't make the ready-to-buy scroll to the bottom. */}
      <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <button
          onClick={() => openModal()}
          style={{
            padding: '0.9rem 2.25rem',
            background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
            color: '#fff',
            border: 'none',
            borderRadius: '0.75rem',
            fontSize: '1rem',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 4px 15px rgba(150, 112, 91, 0.25)',
          }}
        >
          Build your kit
        </button>
        <p style={{ margin: '0.6rem 0 0', fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
          Or browse the tables and crafts below — tapping one starts your kit with it.
        </p>
      </div>

      {/* Theme gallery — the styled tables. Stocked ones are the pitch; the rest
          take a waitlist email. */}
      {info.themes.length > 0 && (
        <div style={{ marginBottom: '3.5rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)', textAlign: 'center', marginBottom: '0.5rem' }}>
            Pick Your Table
          </h2>
          <p style={{ textAlign: 'center', fontSize: '0.875rem', color: 'var(--color-muted)', margin: '0 0 1.75rem' }}>
            A styled, photograph-worthy table — or skip it and just take the crafts home.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(17rem, 1fr))', gap: '1.5rem' }}>
            {stockedThemes.map((theme) => {
              const from = fromPrice(theme.tiers)
              return (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => openModal({ themeId: theme.id })}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    textAlign: 'left',
                    padding: 0,
                    borderRadius: '1rem',
                    overflow: 'hidden',
                    border: '1px solid rgba(150, 112, 91, 0.15)',
                    background: 'rgba(255, 255, 255, 0.9)',
                    cursor: 'pointer',
                    transition: 'box-shadow 0.25s ease, transform 0.25s ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 14px 32px rgba(150,112,91,0.18)'; e.currentTarget.style.transform = 'translateY(-3px)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none' }}
                >
                  <div style={{ position: 'relative', width: '100%', aspectRatio: '4 / 3', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: schemeGradient(theme.scheme) }}>
                    {theme.photo ? (
                      <img src={theme.photo} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    ) : (
                      <span style={{ fontFamily: 'var(--font-heading)', fontSize: '1.25rem', fontWeight: 600, color: 'rgba(90,70,55,0.65)', textAlign: 'center', padding: '0 1rem' }}>{theme.displayName}</span>
                    )}
                    {from != null && (
                      <span style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', background: 'rgba(255,255,255,0.94)', borderRadius: '2rem', padding: '0.28rem 0.7rem', fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-dark)', boxShadow: '0 1px 5px rgba(0,0,0,0.12)' }}>
                        From {priceCompact(from)}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '1rem 1.125rem 1.25rem' }}>
                    <span style={{ fontSize: '1.0625rem', fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)' }}>{theme.displayName}</span>
                    <p style={{ margin: '0.4rem 0 0', fontSize: '0.8125rem', lineHeight: 1.5, color: 'var(--color-muted)' }}>{theme.tagline}</p>
                    <span style={{ marginTop: 'auto', paddingTop: '0.85rem', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-primary)' }}>
                      Build this kit →
                    </span>
                  </div>
                </button>
              )
            })}
            {waitlistThemes.map((theme) => (
              <WaitlistCard key={theme.id} theme={theme} />
            ))}
          </div>
        </div>
      )}

      {/* Craft gallery — every guest makes one. */}
      {crafts.length > 0 && (
        <div style={{ marginBottom: '3rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)', textAlign: 'center', marginBottom: '0.5rem' }}>
            Pick Your Craft
          </h2>
          <p style={{ textAlign: 'center', fontSize: '0.875rem', color: 'var(--color-muted)', margin: '0 0 1.75rem' }}>
            Every guest makes one — you choose which. We box exactly enough for your headcount.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(17rem, 1fr))', gap: '1.5rem' }}>
            {(showAllCrafts ? crafts : crafts.slice(0, CRAFT_PREVIEW_COUNT)).map((craft) => (
              <button
                key={craft.id}
                type="button"
                onClick={() => openModal({ craftId: craft.id })}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  textAlign: 'left',
                  padding: 0,
                  borderRadius: '1rem',
                  overflow: 'hidden',
                  border: '1px solid rgba(150, 112, 91, 0.15)',
                  background: 'rgba(255, 255, 255, 0.9)',
                  cursor: 'pointer',
                  transition: 'box-shadow 0.25s ease, transform 0.25s ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 14px 32px rgba(150,112,91,0.18)'; e.currentTarget.style.transform = 'translateY(-3px)' }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none' }}
              >
                <div style={{ position: 'relative', width: '100%', aspectRatio: '4 / 3', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, rgba(150,112,91,0.10), rgba(198,167,142,0.20))' }}>
                  {craft.imageUrl ? (
                    <img src={craft.imageUrl} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <span style={{ fontFamily: 'var(--font-heading)', fontSize: '1.25rem', fontWeight: 600, color: 'rgba(150,112,91,0.55)', textAlign: 'center', padding: '0 1rem' }}>{craft.name}</span>
                  )}
                  <span style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', background: 'rgba(255,255,255,0.94)', borderRadius: '2rem', padding: '0.28rem 0.7rem', fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-dark)', boxShadow: '0 1px 5px rgba(0,0,0,0.12)' }}>
                    {perPersonLabel(craft.perHeadCents, craft.perHeadMaxCents)}/person
                  </span>
                  {craft.popular && (
                    <span style={{ position: 'absolute', bottom: '0.75rem', left: '0.75rem', background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))', color: '#fff', borderRadius: '2rem', padding: '0.3rem 0.75rem', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.02em', boxShadow: '0 2px 8px rgba(0,0,0,0.18)' }}>
                      ♥ Most popular
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '1rem 1.125rem 1.25rem' }}>
                  <span style={{ fontSize: '1.0625rem', fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)' }}>{craft.name}</span>
                  {craft.description && (
                    <p style={{ margin: '0.4rem 0 0', fontSize: '0.8125rem', lineHeight: 1.5, color: 'var(--color-muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {craft.description}
                    </p>
                  )}
                  <span style={{ marginTop: 'auto', paddingTop: '0.85rem', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-primary)' }}>
                    Build a kit with this →
                  </span>
                </div>
              </button>
            ))}
          </div>
          {!showAllCrafts && crafts.length > CRAFT_PREVIEW_COUNT && (
            <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
              <button
                type="button"
                onClick={() => setShowAllCrafts(true)}
                style={{ padding: '0.65rem 1.5rem', borderRadius: '999px', border: '1px solid rgba(150, 112, 91, 0.3)', background: 'rgba(255, 255, 255, 0.9)', color: 'var(--color-dark)', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer' }}
              >
                Show all {crafts.length} crafts ↓
              </button>
            </div>
          )}
        </div>
      )}

      {/* Primary CTA */}
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <button
          onClick={() => openModal()}
          style={{
            padding: '0.9rem 2.25rem',
            background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
            color: '#fff',
            border: 'none',
            borderRadius: '0.75rem',
            fontSize: '1rem',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 4px 15px rgba(150, 112, 91, 0.25)',
          }}
        >
          Build your kit
        </button>
      </div>

      {modalOpen && <KitModal onClose={closeModal} initialCraftId={initialCraftId} initialThemeId={initialThemeId} />}
    </div>
  )
}
