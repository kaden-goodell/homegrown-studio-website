import { useEffect, useRef, useState } from 'react'
import { hasAllergy } from '@lib/allergy'
import { partyConfig } from '@config/party.config'
import { partyContent } from '@config/party-content'
import {
  partyInviteUrl,
  partyInviteMailto,
  partyInviteIcsUrl,
  partyWaiverUrl,
  googleCalendarUrl,
  buildIcs,
  icsDataUrl,
  addMinutesIso,
  partyCalendarIds,
} from '@lib/party-share'
import { formatMoney } from '@lib/money'
import { inviteContent } from '@config/invite-content'
import { waiverContent } from '@config/waiver-content'
import { formatDayAndSpan, formatWhen } from '@lib/studio-time'
import { rememberedPageKey } from '@lib/page-key'
import { trackAddToCalendar, trackShare, trackWaiverLinkClick } from '@lib/analytics'

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
    /** extra time included (older servers sent none) */
    endIso?: string
    cancelled?: boolean
    calendarSeq?: number
    /** the studio fee or extras still to pay online, with the payment link (D1: never crafts) */
    pay?: { cents: number; what: string; url: string } | null
  }
  summary: { households: number; people: number }
  households: Household[]
}

const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.72)',
  backdropFilter: 'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  border: '1px solid rgba(var(--color-primary-rgb),0.16)',
  borderRadius: '1.25rem',
  padding: '1.5rem',
  boxShadow: '0 18px 44px rgba(var(--color-primary-rgb),0.12)',
  marginBottom: '1.25rem',
}

const chip: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.5rem 0.9rem',
  borderRadius: '999px',
  background: 'rgba(var(--color-primary-rgb),0.08)',
  border: '1px solid rgba(var(--color-primary-rgb),0.16)',
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
        // The key left the address bar on load (src/lib/page-key.ts); a refresh finds it in this tab.
        `/api/party/roster.json?party=${encodeURIComponent(bookingId)}&key=${encodeURIComponent(hostKey || rememberedPageKey())}`,
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
  const endIso = party.endIso ?? addMinutesIso(party.startIso, party.durationMinutes ?? partyConfig.durationMinutes)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const inviteUrl = partyInviteUrl(
    { bookingId, craftName: party.craftName, slotLabel, startIso: party.startIso, title: party.title || undefined },
    origin,
  )
  const calEvent = {
    title: heading + ' — Hometown Studio',
    startIso: party.startIso,
    endIso,
    details: `Your private party at Hometown Studio.\n\nInvitation link for guests: ${inviteUrl}`,
    location: inviteContent.where,
  }

  async function shareInvite() {
    if (navigator.share) {
      try {
        await navigator.share({ title: heading, url: inviteUrl })
        trackShare('party_invite', 'share_sheet')
        return
      } catch {
        /* fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(inviteUrl)
      trackShare('party_invite', 'copy_link')
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      /* ignore */
    }
  }

  if (party.cancelled) {
    return (
      <div>
        <div style={{ ...card, textAlign: 'center' }} data-testid="party-cancelled">
          <p className="eyebrow tone-party" style={{ marginBottom: '0.5rem' }}>Your party</p>
          <h1 style={{ fontSize: '1.75rem', fontFamily: 'var(--font-heading)', fontWeight: 700, color: 'var(--color-dark)', margin: 0 }}>{heading}</h1>
          {/* Which party (a host may have two), then the news, then where to ask about money. */}
          <p style={{ color: 'var(--color-muted)', marginTop: '0.5rem' }} data-testid="party-when">{`${formatDayAndSpan(party.startIso, endIso)} CT`}</p>
          <p style={{ color: 'var(--color-dark)', fontWeight: 600, marginTop: '0.75rem' }}>This party was cancelled.</p>
          <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem', marginTop: '0.5rem' }}>
            {partyContent.textNumber
              ? <>Questions, or about a payment? Text us at {partyContent.textNumber}.</>
              : <>Questions, or about a payment? Contact us.</>}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Party header */}
      <div style={{ ...card, textAlign: 'center' }}>
        <p className="eyebrow tone-party" style={{ marginBottom: '0.5rem' }}>
          Your party
        </p>
        <h1 style={{ fontSize: '1.75rem', fontFamily: 'var(--font-heading)', fontWeight: 700, color: 'var(--color-dark)', margin: 0 }}>
          {heading}
        </h1>
        <p style={{ color: 'var(--color-dark)', fontWeight: 600, marginTop: '0.5rem' }} data-testid="party-when">{`${formatDayAndSpan(party.startIso, endIso)} CT`}</p>
        <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem' }}>{inviteContent.where}</p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center', marginTop: '1.1rem' }}>
          <button type="button" onClick={shareInvite} style={chip}>
            {copied ? 'Link copied' : 'Invite your guests'}
          </button>
          <a href={googleCalendarUrl(calEvent)} target="_blank" rel="noopener noreferrer" style={chip} onClick={() => trackAddToCalendar('host_dashboard', 'google', 'party')}>Google Calendar</a>
          <a href={icsDataUrl(buildIcs(calEvent, partyCalendarIds(bookingId, party.calendarSeq)))} download="hometown-party.ics" style={chip} onClick={() => trackAddToCalendar('host_dashboard', 'ics', 'party')}>Apple / Outlook</a>
          <a
            href={partyInviteMailto({
              craftName: party.craftName,
              slotLabel,
              inviteUrl,
              title: party.title || undefined,
              icsUrl: partyInviteIcsUrl(bookingId, origin),
            })}
            style={chip}
            // The host writing to their own guests — a share, not a lead.
            data-track-ignore
            onClick={() => trackShare('party_invite', 'email')}
          >
            Email your guests
          </a>
          <a href={partyWaiverUrl(bookingId, origin)} target="_blank" rel="noopener noreferrer" style={chip} onClick={() => trackWaiverLinkClick('host_dashboard')}>
            {waiverContent.handoff.hostCta}
          </a>
        </div>
      </div>

      {/* Still to pay online: the studio fee or extras (D1: crafts are paid at the studio) */}
      {party.pay && (
        <div style={{ ...card, textAlign: 'center' }} data-testid="party-pay">
          <p style={{ color: 'var(--color-dark)', fontWeight: 600, margin: 0 }}>
            {`There’s ${formatMoney(party.pay.cents)} still to pay for ${party.pay.what}.`}
          </p>
          <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem', margin: '0.35rem 0 0' }}>Crafts are paid at the studio for whoever comes.</p>
          <a
            href={party.pay.url}
            className="ph-no-capture"
            style={{ ...chip, marginTop: '0.9rem', background: 'var(--color-button)', color: '#fff', border: 'none', fontSize: '0.9375rem', padding: '0.7rem 1.3rem', minHeight: '2.75rem' }}
          >
            {`Pay ${formatMoney(party.pay.cents)}`}
          </a>
        </div>
      )}

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
              Refresh
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
              const comingGuests = h.children.filter((_, ci) => h.attending.includes(`child:${ci}`))
              // Guests on the waiver who aren't crafting. The signing adult is
              // deliberately excluded — "not crafting" doesn't mean absent (they
              // may be there watching), and the host doesn't need that detail.
              const notComing = h.children
                .filter((_, ci) => !h.attending.includes(`child:${ci}`))
                .map((c) => c.name.split(' ')[0])
              const allergyLines = [
                ...(adultComing && hasAllergy(h.adultAllergies) ? [`${h.signer.split(' ')[0]}: ${h.adultAllergies}`] : []),
                ...comingGuests.filter((c) => hasAllergy(c.allergies)).map((c) => `${c.name.split(' ')[0]}: ${c.allergies}`),
              ]
              const first = h.signer.split(' ')[0]
              const rowSummary = comingGuests.length > 0
                ? `${adultComing ? `${first} + ` : ''}${comingGuests.length} ${comingGuests.length === 1 ? 'guest' : 'guests'}`
                : adultComing
                  ? `just ${first}`
                  : '—'
              return (
                <div key={i} style={{ padding: '0.85rem 1rem', borderRadius: '0.875rem', background: 'rgba(var(--color-primary-rgb),0.05)', border: '1px solid rgba(var(--color-primary-rgb),0.12)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.35rem' }}>
                    <span style={{ fontWeight: 600, color: 'var(--color-dark)', fontSize: '0.9375rem' }}>{h.signer}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                      {rowSummary}
                    </span>
                  </div>
                  {comingGuests.length > 0 && (
                    <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', margin: '0.25rem 0 0' }}>
                      {comingGuests.map((c) => c.name).join(', ')}
                    </p>
                  )}
                  {notComing.length > 0 && (
                    <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', margin: '0.25rem 0 0', fontStyle: 'italic' }}>
                      Not crafting: {notComing.join(', ')}
                    </p>
                  )}
                  {allergyLines.map((line) => (
                    <p key={line} style={{ fontSize: '0.75rem', color: 'var(--color-error)', margin: '0.35rem 0 0', fontWeight: 600 }}>
                      Allergy: {line}
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
