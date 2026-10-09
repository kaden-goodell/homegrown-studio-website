import { useCallback, useEffect, useRef, useState } from 'react'
import StaffHeader from '@components/staff/StaffHeader'
import { card, btn, field } from '@components/staff/ui'
import { formatCents } from '@lib/utils'
import type { StaffMember } from '@lib/staff-auth'
import { trackGiftCardCreated } from '@lib/analytics'
import { posthogOperationalLogger } from '@lib/posthog-logger'

interface CardRow {
  id: string
  gan: string
  amountCents: number
  forWhom: string
  note?: string
  by: { id: string; name: string }
  at: string
  simulated?: boolean
  balanceCents: number | null
  state: string | null
}

const PRESETS = [10, 25, 50, 100]

/** 7783325239652851 → "7783 3252 3965 2851" */
const group = (gan: string) => gan.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ')

/** Staff screen: mint a gift card (e.g. for a giveaway winner), copy its
 *  number, and see what's left on every card made so far. */
export default function GiftCards({ staff }: { staff: StaffMember }) {
  const [cards, setCards] = useState<CardRow[]>([])
  const [amount, setAmount] = useState('')
  const [forWhom, setForWhom] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [made, setMade] = useState<{ gan: string; recorded: boolean } | null>(null)
  const [copied, setCopied] = useState<'no' | 'copied' | 'selected'>('no')
  const numberRef = useRef<HTMLElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/staff/gift-cards.json', { cache: 'no-store' })
      const body = await res.json()
      if (res.ok) setCards(body.data?.cards ?? [])
    } catch {
      /* list stays as it was */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function make() {
    setError('')
    setMade(null)
    setCopied('no')
    const amountDollars = Number(amount)
    // Mirrors the server's rule: whole dollars, $1 to $500.
    if (!Number.isInteger(amountDollars) || amountDollars < 1 || amountDollars > 500) {
      setError('Pick or type a whole-dollar amount from $1 to $500.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/staff/gift-cards.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountDollars, forWhom: forWhom.trim(), note: note.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) {
        trackGiftCardCreated(amountDollars)
        posthogOperationalLogger.info('gift card created', {
          operation: 'gift_card_create',
          amount_dollars: amountDollars,
        })
        setMade({ gan: body.data.card.gan, recorded: true })
        setForWhom('')
        setNote('')
        setAmount('')
        await load()
      } else {
        setError(body.error ?? 'Could not make the card.')
        // 502: the card exists at Square but wasn't written down — show the number.
        if (body.gan) setMade({ gan: body.gan, recorded: false })
      }
    } catch {
      setError('Network problem — try again.')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!made) return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(made.gan)
        setCopied('copied')
        return
      }
    } catch {
      /* fall through to selection */
    }
    const el = numberRef.current
    if (el) {
      const range = document.createRange()
      range.selectNodeContents(el)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      setCopied('selected')
    }
  }

  return (
    <div>
      <StaffHeader title="Gift cards" staff={staff} />

      <div style={card}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.7rem' }}>
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={Number(amount) === p}
              onClick={() => setAmount(String(p))}
              style={{ ...btn(Number(amount) === p) }}
            >
              ${p}
            </button>
          ))}
          <input
            type="number"
            inputMode="decimal"
            min="1"
            step="1"
            placeholder="Other"
            aria-label="Other amount"
            value={PRESETS.includes(Number(amount)) ? '' : amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{ ...field, width: '6rem' }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.8rem' }}>
          <input placeholder="For whom" aria-label="For whom" value={forWhom} onChange={(e) => setForWhom(e.target.value)} style={field} />
          <input placeholder="Note" aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} style={field} />
        </div>
        <button type="button" disabled={busy} onClick={make} style={{ ...btn(true), opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Making…' : 'Make card'}
        </button>
        {error && <p role="alert" style={{ color: '#b91c1c', fontSize: '0.875rem', fontWeight: 600, margin: '0.7rem 0 0' }}>{error}</p>}
      </div>

      {made && (
        <div style={card}>
          <code
            ref={numberRef}
            data-testid="gift-card-number"
            style={{ display: 'block', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '1.6rem', fontWeight: 700, letterSpacing: '0.05em', marginBottom: '0.6rem' }}
          >
            {group(made.gan)}
          </code>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" onClick={copy} style={btn()}>{copied === 'copied' ? 'Copied' : 'Copy'}</button>
            <a href={`sms:?&body=${encodeURIComponent(`Your Hometown Studio gift card: ${group(made.gan)}`)}`} style={btn()}>Text it</a>
            {copied === 'selected' && <span role="status" style={{ fontSize: '0.875rem' }}>Selected — press Copy on your keyboard or menu.</span>}
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', margin: '0.7rem 0 0' }}>
            Hand this number to them — it works online for parties and kits, and at the register.
          </p>
          {!made.recorded && (
            <p style={{ fontSize: '0.875rem', color: '#b91c1c', margin: '0.5rem 0 0' }}>
              This card was made but not saved to the list below. Keep this number.
            </p>
          )}
        </div>
      )}

      <div style={card}>
        {cards.length === 0 ? (
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-muted)' }}>No gift cards made yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {cards.map((c) => (
              <li key={c.id} style={{ fontSize: '0.875rem', color: 'var(--color-dark)' }}>
                {c.forWhom} · {formatCents(c.amountCents)} ·{' '}
                {c.balanceCents === null ? 'balance unavailable' : `${formatCents(c.balanceCents)} left`} ·{' '}
                {new Date(c.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' })} · {c.by.name}{' '}
                <button type="button" onClick={() => { setCopied('no'); setMade({ gan: c.gan, recorded: true }) }} style={{ ...btn(), padding: '0.1rem 0.5rem', fontSize: '0.875rem' }} aria-label={`Show the number for ${c.forWhom}`}>Number</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
