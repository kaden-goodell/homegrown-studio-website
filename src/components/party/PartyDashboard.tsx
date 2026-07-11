import { useEffect, useRef, useState } from 'react'
import { partyConfig } from '@config/party.config'
import { partyContent } from '@config/party-content'
import {
  partyInviteUrl,
  googleCalendarUrl,
  buildIcs,
  icsDataUrl,
  addMinutesIso,
} from '@lib/party-share'
import { inviteContent } from '@config/invite-content'
import { formatWhen } from '@lib/studio-time'

interface Props {
  bookingId: string
  hostKey: string
}

interface Household {
  signer: string
  children: { name: string; allergies: string; duplicateOf?: string }[]
  childCount: number
  adultAllergies: string
  /** Person ids (`adult`, `child:{i}`) the group said are coming. */
  attending: string[]
  attendingCount: number
}

interface Roster {
  party: {
    craftName: string
    startIso: string
    durationMinutes: number | null
    hostName: string
    guestCount: number
    title: string | null
  }
  summary: { households: number; people: number }
  households: Household[]
}

const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.72)',
  backdropFilter: 'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  border: '1px solid rgba(150,112,91,0.16)',
  borderRadius: '1.25rem',
  padding: '1.5rem',
  boxShadow: '0 18px 44px rgba(150,112,91,0.12)',
  marginBottom: '1.25rem',
}

const chip: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.5rem 0.9rem',
  borderRadius: '999px',
  background: 'rgba(150,112,91,0.08)',
  border: '1px solid rgba(150,112,91,0.16)',
  color: 'var(--color-dark)',
  fontSize: '0.8125rem',
  fontWeight: 600,
  textDecoration: 'none',
  cursor: 'pointer',
}

export default function PartyDashboard({ bookingId, hostKey }: Props) {
  const [roster, setRoster] = useState<Roster | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'denied' | 'error'>('loading')
  const [copied, setCopied] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function load(isRefresh = false) {
    try {
      const res = await fetch(
        `/api/party/roster.json?party=${encodeURIComponent(bookingId)}&key=${encodeURIComponent(hostKey)}`,
        { cache: 'no-store' },
      )
      if (res.status === 404) {
        // A 404 on refresh keeps the current view; only the initial load surfaces denied.
        if (!isRefresh) setState('denied')
        return
      }
      if (!res.ok) {
        if (!isRefresh) setState('error')
        return
      }
      const json = await res.json()
      setRoster(json.data)
      setState('ok')
    } catch {
      if (!isRefresh) setState('error')
    }
  }

  useEffect(() => {
    load()
    intervalRef.current = setInterval(() => load(true), 30_000)
    return () => {
      if (intervalRef.current !== null) clearInterval(intervalRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (state === 'loading') {
    return <p style={{ textAlign: 'center', color: 'var(--color-muted)' }}>Loading your party…</p>
  }
  if (state === 'denied') {
    return (
      <div style={{ ...card, textAlign: 'center' }}>
        <p style={{ color: 'var(--color-dark)', fontWeight: 600 }}>This party link isn't valid.</p>
        <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem', marginTop: '0.5rem' }}>
          Use the link from your booking confirmation email. Lost it?{' '}
          {partyContent.textNumber
            ? <>Text us at {partyContent.textNumber} and we'll re-send it.</>
            : <>Contact us and we'll re-send it.</>}
        </p>
      </div>
    )
  }
  if (state === 'error' || !roster) {
    return (
      <div style={{ ...card, textAlign: 'center' }}>
        <p style={{ color: 'var(--color-dark)', fontWeight: 600 }}>Couldn't load your party.</p>
        <button type="button" onClick={() => { setState('loading'); load() }} style={{ ...chip, marginTop: '0.75rem', border: 'none', background: 'var(--color-primary)', color: '#fff' }}>
          Try again
        </button>
      </div>
    )
  }

  const { party, summary, households } = roster
  const heading = party.title || `${party.craftName} Party`
  const slotLabel = formatWhen(party.startIso) + ' CT'
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const inviteUrl = partyInviteUrl(
    { bookingId, craftName: party.craftName, slotLabel, startIso: party.startIso, title: party.title || undefined },
    origin,
  )
  const calEvent = {
    title: heading + ' — Homegrown Studio',
    startIso: party.startIso,
    endIso: addMinutesIso(party.startIso, party.durationMinutes ?? partyConfig.durationMinutes),
    details: `Your private party at Homegrown Studio.\n\nInvitation link for guests: ${inviteUrl}`,
    location: inviteContent.where,
  }

  async function shareInvite() {
    if (navigator.share) {
      try {
        await navigator.share({ title: heading, url: inviteUrl })
        return
      } catch {
        /* fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      /* ignore */
    }
  }

  return (
    <div>
      {/* Party header */}
      <div style={{ ...card, textAlign: 'center' }}>
        <p className="uppercase" style={{ letterSpacing: '0.2em', fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-accent)', marginBottom: '0.5rem' }}>
          Your Party
        </p>
        <h1 style={{ fontSize: '1.75rem', fontFamily: 'var(--font-heading)', fontWeight: 700, color: 'var(--color-dark)', margin: 0 }}>
          {heading}
        </h1>
        <p style={{ color: 'var(--color-dark)', fontWeight: 600, marginTop: '0.5rem' }}>{slotLabel}</p>
        <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem' }}>{inviteContent.where}</p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center', marginTop: '1.1rem' }}>
          <button type="button" onClick={shareInvite} style={chip}>
            {copied ? '✓ Link copied!' : '💌 Invite your guests'}
          </button>
          <a href={googleCalendarUrl(calEvent)} target="_blank" rel="noopener noreferrer" style={chip}>📅 Google Calendar</a>
          <a href={icsDataUrl(buildIcs(calEvent))} download="homegrown-party.ics" style={chip}>📅 Apple / Outlook</a>
        </div>
      </div>

      {/* RSVP summary */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '1.0625rem', fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)', margin: 0 }}>
              Who’s crafting
            </h2>
            <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
              Booked for {party.guestCount} · {summary.people} crafting so far
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}>
              <strong style={{ color: 'var(--color-dark)' }}>{summary.households}</strong>{' '}
              {summary.households === 1 ? 'group' : 'groups'} ·{' '}
              <strong style={{ color: 'var(--color-dark)' }}>{summary.people}</strong> crafting
            </span>
            <button
              type="button"
              onClick={() => load(true)}
              style={{ ...chip, fontSize: '0.75rem', padding: '0.3rem 0.65rem' }}
              aria-label="Refresh roster"
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {households.length === 0 ? (
          <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem', marginTop: '0.9rem' }}>
            No RSVPs yet — share your invitation above and guests will appear here as they sign.
          </p>
        ) : (
          <div style={{ marginTop: '1rem', display: 'grid', gap: '0.6rem' }}>
            {households.map((h, i) => {
              const adultComing = h.attending.includes('adult')
              const comingKids = h.children.filter((_, ci) => h.attending.includes(`child:${ci}`))
              // Kids on the waiver who aren't crafting. The signing adult is
              // deliberately excluded — "not crafting" doesn't mean absent (they
              // may be there watching), and the host doesn't need that detail.
              const notComing = h.children
                .filter((_, ci) => !h.attending.includes(`child:${ci}`))
                .map((c) => c.name.split(' ')[0])
              const allergyLines = [
                ...(adultComing && h.adultAllergies ? [`${h.signer.split(' ')[0]}: ${h.adultAllergies}`] : []),
                ...comingKids.filter((c) => c.allergies).map((c) => `${c.name.split(' ')[0]}: ${c.allergies}`),
              ]
              const first = h.signer.split(' ')[0]
              const rowSummary = comingKids.length > 0
                ? `${adultComing ? `${first} + ` : ''}${comingKids.length} ${comingKids.length === 1 ? 'kid' : 'kids'}`
                : adultComing
                  ? `just ${first}`
                  : '—'
              return (
                <div key={i} style={{ padding: '0.85rem 1rem', borderRadius: '0.875rem', background: 'rgba(150,112,91,0.05)', border: '1px solid rgba(150,112,91,0.12)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.35rem' }}>
                    <span style={{ fontWeight: 600, color: 'var(--color-dark)', fontSize: '0.9375rem' }}>{h.signer}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                      {rowSummary}
                    </span>
                  </div>
                  {comingKids.length > 0 && (
                    <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', margin: '0.25rem 0 0' }}>
                      {comingKids.map((c) => c.name).join(', ')}
                    </p>
                  )}
                  {notComing.length > 0 && (
                    <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', margin: '0.25rem 0 0', fontStyle: 'italic' }}>
                      Not crafting: {notComing.join(', ')}
                    </p>
                  )}
                  {allergyLines.map((line) => (
                    <p key={line} style={{ fontSize: '0.75rem', color: '#b91c1c', margin: '0.35rem 0 0', fontWeight: 600 }}>
                      ⚠ {line}
                    </p>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
