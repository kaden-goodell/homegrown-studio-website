import type { ReactNode } from 'react'
import { SafeRow } from '../shell/Boundary'
import type { ArtistApplication } from '@lib/artist-applications'
import type { ContactMessage } from '@lib/contact-options'
import {
  PLACES, SETTINGS, YES_NO, CRAFT_PICKS, BUDGETS, CONTACT_BY,
  label, kindLabel, crafterLabel, extrasLines, type EventRequest,
} from '@lib/event-request-options'
import { dayLabel } from '../classes/dates'
import { dayAndClock, dayAndStart } from '../shell/time'

type Row = [string, ReactNode]
const external = (href: string) => (/^https?:\/\//.test(href) ? href : `https://${href}`)
const link = (text: string, href: string) => <a href={href} target="_blank" rel="noreferrer noopener">{text}</a>

/**
 * A titled group of answers; groups with nothing in them are left out. Rows
 * can be a function, read while drawing inside the group's own boundary, so
 * one half-broken part of a record (no "where" on a request) loses only its
 * group and the person's name, phone and email still show.
 */
function Group({ title, rows }: { title: string; rows: Row[] | (() => Row[]) }) {
  return <SafeRow><GroupInner title={title} rows={rows} /></SafeRow>
}
function GroupInner({ title, rows: given }: { title: string; rows: Row[] | (() => Row[]) }) {
  const rows = typeof given === 'function' ? given() : given
  const shown = rows.filter(([, v]) => v !== '' && v !== null && v !== undefined && v !== false)
  if (!shown.length) return null
  return (
    <section aria-label={title}>
      <h3 className="adm-group-h">{title}</h3>
      <dl className="adm-ans">
        {shown.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function Photos({ count, src, alt }: { count: number; src: (n: number) => string; alt: (n: number) => string }) {
  if (!count) return null
  return (
    <div className="adm-photos">
      {Array.from({ length: count }, (_, n) => (
        <a key={n} href={src(n)} target="_blank" rel="noreferrer"><img src={src(n)} alt={alt(n)} loading="lazy" /></a>
      ))}
    </div>
  )
}

/** Every answer on a private event request, grouped like the form. */
export function RequestAnswers({ r }: { r: EventRequest }) {
  const e = () => r.event, w = () => r.where, c = () => r.craft
  return (
    <>
      <Group title="The event" rows={() => [
        ['What', kindLabel(r)],
        ['When', dayAndStart(r.event.date, r.event.startTime)],
        ['Guests', `${e().guests}`],
        ['Where', label(PLACES, w().place)],
        ['Backup date', e().backupDate ? dayLabel(e().backupDate) : ''],
        ['Flexible on the date', e().flexible ? 'Yes' : ''],
        ['How long', e().length],
        ['Who’s crafting', crafterLabel(r)],
        ['Prefers', r.about.contactBy ? label(CONTACT_BY, r.about.contactBy) : ''],
      ]} />
      <Group title="Where" rows={() => [
        ['Address', w().address],
        ['Indoors or outdoors', label(SETTINGS, w().setting)],
        ['Tables and chairs there', label(YES_NO, w().tables)],
        ['Sink nearby', label(YES_NO, w().sink)],
        ['Can set up from', w().setupFrom],
        ['Getting in', w().access],
      ]} />
      <Group title="The craft" rows={() => [
        ['Wants', label(CRAFT_PICKS, c().pick)],
        ['Their vision', c().vision],
        ['Theme or colors', c().theme],
        ['Personalized', c().personalized],
        ['Inspiration', c().link ? link(c().link, external(c().link)) : ''],
      ]} />
      <Photos count={r.photos ?? 0} src={(n) => `/api/admin/event-request-photo?id=${encodeURIComponent(r.id)}&n=${n}`} alt={(n) => `${r.about.name}, inspiration photo ${n + 1}`} />
      <Group title="Extras" rows={() => [...extrasLines(r), ['Food allergies', r.allergies] as Row]} />
      <Group title="More" rows={() => [
        ['Budget', label(BUDGETS, r.budget)],
        ['Heard about us', r.about.heard],
        ['Anything else', r.notes],
      ]} />
    </>
  )
}

export function MessageAnswers({ m }: { m: ContactMessage }) {
  return (
    <Group title="Their message" rows={[
      ['Message', m.message],
      ['Sent', dayAndClock(m.at)],
    ]} />
  )
}

const AUDIENCE: Record<string, string> = { kids: 'Kids & teens', adults: 'Adults', both: 'Both' }
const OFTEN: Record<string, string> = { 'one-time': 'One-time', monthly: 'Monthly', series: 'A series' }

function social(label: string, href: string) {
  if (!href) return ''
  const url = /^https?:\/\//.test(href) ? href
    : href.startsWith('@') && label === 'Instagram' ? `https://instagram.com/${href.slice(1)}`
    : href.startsWith('@') && label === 'TikTok' ? `https://www.tiktok.com/${href}`
    : `https://${href}`
  return link(label, url)
}

/** Every answer on a teacher application. */
export function TeacherAnswers({ a }: { a: ArtistApplication }) {
  const c = a.classIdea
  const links = (['Instagram', 'Website', 'TikTok', 'Etsy', 'Video'] as const)
    .map((l) => [l, a.links[l.toLowerCase() as keyof ArtistApplication['links']]] as const)
    .filter(([, v]) => v)
  return (
    <>
      <Group title="Their class" rows={[
        ['Class', c.what],
        ['Takes home', c.takeHome],
        ['For', [AUDIENCE[c.audience], c.dropOffOk === 'yes' ? 'drop-off OK' : c.dropOffOk === 'no' ? 'no drop-off' : ''].filter(Boolean).join(', ')],
        ['Length', c.length],
        ['Group', [c.groupMin, c.groupMax].filter(Boolean).join(' to ')],
        ['Price per person', c.price],
        ['Supplies per person', c.suppliesCost],
        ['Needs from us', c.needs],
      ]} />
      <Photos count={a.photos} src={(n) => `/api/admin/application-photo?id=${encodeURIComponent(a.id)}&n=${n}`} alt={(n) => `${a.about.name}, photo ${n + 1}`} />
      <Group title="About them" rows={[
        ['Experience', a.experience],
        ['When', [a.when.days, OFTEN[a.when.howOften]].filter(Boolean).join(' · ')],
        ['City', a.about.city],
        ['Links', links.length ? <span style={{ display: 'flex', gap: '0.9rem', flexWrap: 'wrap' }}>{links.map(([l, v]) => <span key={l}>{social(l, v)}</span>)}</span> : ''],
      ]} />
    </>
  )
}
