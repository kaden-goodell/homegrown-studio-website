import { useId, useState, type FormEvent } from 'react'
import { Section, Pair, Side, TextField, TextArea, Choice, PhotoPicker, Honeypot, SentCard, sendForm, FieldError, type Photo } from '@components/forms/form-kit'
import { KINDS, CRAFTERS, PLACES, SETTINGS, YES_NO, CRAFT_PICKS, EXTRAS, EXTRA_CHOICES, BUDGETS, CONTACT_BY, MAX_PHOTOS } from '@lib/event-request-options'

const opts = (list: readonly (readonly [string, string])[]) => list.map(([k, l]) => [k, l] as [string, string])

const EMPTY = {
  kind: '', kindOther: '', date: '', backupDate: '', startTime: '', length: '', guests: '', crafters: '', youngest: '',
  place: '', address: '', setting: '', tables: '', sink: '', setupFrom: '', access: '',
  pick: '', vision: '', theme: '', personalized: '', link: '',
  food: '', drinks: '', dessert: '', decor: '', tableware: '', favors: '', allergies: '',
  budget: '',
  name: '', org: '', email: '', phone: '', contactBy: '', heard: '', notes: '',
  company: '',
}
type Values = typeof EMPTY

/** Today on this phone's calendar, for the date picker's earliest day. */
function todayYmd(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * /private-events: someone tells us about the event they want on a day or time
 * we're not normally open, at the studio or at their place (Kaden, 17 Oct
 * 2026). Structured so they fill everything in; only the date, guest count,
 * where, and how to reach them are required.
 */
export default function PrivateEventForm() {
  const id = useId()
  const [v, setV] = useState<Values>(EMPTY)
  const [flexible, setFlexible] = useState(false)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [problem, setProblem] = useState<{ field: string; error: string } | null>(null)
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)

  const errorFor = (field: string) => (problem?.field === field ? problem.error : '')
  const bind = (k: keyof Values) => ({ id: `${id}-${k}`, value: v[k], onChange: (val: string) => setV((x) => ({ ...x, [k]: val })), error: errorFor(k) })
  const atTheirPlace = v.place === 'yours'
  const kids = v.crafters === 'kids' || v.crafters === 'both'

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (sending) return
    setProblem(null)
    setSending(true)
    const result = await sendForm('/api/private-events/request.json', {
      event: { kind: v.kind, kindOther: v.kindOther, date: v.date, backupDate: v.backupDate, flexible, startTime: v.startTime, length: v.length, guests: v.guests, crafters: v.crafters, youngest: v.youngest },
      where: { place: v.place, address: v.address, setting: v.setting, tables: v.tables, sink: v.sink, setupFrom: v.setupFrom, access: v.access },
      craft: { pick: v.pick, vision: v.vision, theme: v.theme, personalized: v.personalized, link: v.link },
      extras: Object.fromEntries(EXTRAS.map(([k]) => [k, v[k]])),
      allergies: v.allergies,
      budget: v.budget,
      about: { name: v.name, email: v.email, phone: v.phone, org: v.org, contactBy: v.contactBy, heard: v.heard },
      notes: v.notes,
      photos: photos.map((p) => p.dataUrl),
      company: v.company,
    })
    setSending(false)
    if (!result.ok) {
      setProblem({ field: result.field, error: result.error })
      document.getElementById(`${id}-${result.field}`)?.scrollIntoView?.({ block: 'center' })
      return
    }
    setDone(true)
    window.scrollTo?.({ top: 0 })
  }

  if (done) return <SentCard />

  const today = todayYmd()
  return (
    <form onSubmit={submit} noValidate style={{ display: 'grid', gap: '1.25rem' }}>
      <Section title="Your event">
        <Choice {...bind('kind')} label="What kind of event?" options={opts(KINDS)} />
        {v.kind === 'other' && <TextField {...bind('kindOther')} label="Tell us the kind of event" />}
        <Pair>
          <TextField {...bind('date')} label="Date" required type="date" min={today} />
          <TextField {...bind('backupDate')} label="Backup date" type="date" min={today} />
        </Pair>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minHeight: '2.75rem', fontSize: '0.95rem', color: 'var(--color-dark)', cursor: 'pointer' }}>
          <input type="checkbox" checked={flexible} onChange={(e) => setFlexible(e.target.checked)} style={{ width: '1.25rem', height: '1.25rem', accentColor: 'var(--color-primary)' }} />
          We’re flexible on the date
        </label>
        <Side>
          <TextField {...bind('startTime')} label="Start time" type="time" />
          <TextField {...bind('length')} label="How long" placeholder="e.g. 2 hours" />
        </Side>
        <TextField {...bind('guests')} label="How many guests?" required inputMode="numeric" hint="A rough number is fine." />
        <Choice {...bind('crafters')} label="Who’s crafting?" options={opts(CRAFTERS)} />
        {kids && <TextField {...bind('youngest')} label="Youngest age" inputMode="numeric" />}
      </Section>

      <Section title="Where">
        <Choice {...bind('place')} label="Where is it?" required options={opts(PLACES)} />
        {atTheirPlace && (
          <>
            <TextField {...bind('address')} label="Address" required autoComplete="street-address" />
            <Choice {...bind('setting')} label="Indoors or outdoors?" options={opts(SETTINGS)} />
            <Side>
              <Choice {...bind('tables')} label="Tables and chairs there?" options={opts(YES_NO)} compact />
              <Choice {...bind('sink')} label="A sink nearby?" options={opts(YES_NO)} compact />
            </Side>
            <TextField {...bind('setupFrom')} label="How early can we get in to set up?" placeholder="e.g. 1 PM" />
            <TextArea {...bind('access')} label="Anything about getting in?" hint="Stairs, a long walk from parking, a gate code." rows={2} />
          </>
        )}
      </Section>

      <Section title="The craft">
        <Choice {...bind('pick')} label="What would you like to make?" options={opts(CRAFT_PICKS)} />
        <TextArea {...bind('vision')} label="Tell us what you have in mind" hint="The look, the feel, anything you’ve pictured." rows={4} />
        <TextField {...bind('theme')} label="Theme or colors" />
        <TextField {...bind('personalized')} label="Anything personalized?" placeholder="Names or a date" />
        <TextField {...bind('link')} label="Pinterest or inspiration link" type="url" inputMode="url" />
        <PhotoPicker
          id={`${id}-photos`}
          label="Inspiration photos"
          hint={`Up to ${MAX_PHOTOS}.`}
          photos={photos}
          onChange={setPhotos}
          max={MAX_PHOTOS}
          error={errorFor('photos')}
          onError={(error) => setProblem((p) => (error ? { field: 'photos', error } : p?.field === 'photos' ? null : p))}
        />
      </Section>

      <Section title="Extras" hint="For each one, tell us if you’d like us to take care of it.">
        {EXTRAS.map(([k, l]) => <Choice key={k} {...bind(k)} label={l} options={opts(EXTRA_CHOICES)} compact />)}
        <TextArea {...bind('allergies')} label="Any food allergies?" rows={2} />
      </Section>

      <Section title="Budget" hint="A rough range helps us put together the right price.">
        <Choice {...bind('budget')} label="Your budget" options={opts(BUDGETS)} />
      </Section>

      <Section title="About you">
        <TextField {...bind('name')} label="Your name" required autoComplete="name" />
        <TextField {...bind('org')} label="Business, school or church" autoComplete="organization" />
        <Pair>
          <TextField {...bind('email')} label="Email" required type="email" inputMode="email" autoComplete="email" />
          <TextField {...bind('phone')} label="Phone" required type="tel" inputMode="tel" autoComplete="tel" />
        </Pair>
        <Choice {...bind('contactBy')} label="Best way to reach you" options={opts(CONTACT_BY)} />
        <TextField {...bind('heard')} label="How did you hear about us?" />
        <TextArea {...bind('notes')} label="Anything else?" />
      </Section>

      <Honeypot value={v.company} onChange={(company) => setV((x) => ({ ...x, company }))} />

      <FieldError error={errorFor('form')} />
      <button type="submit" className="btn btn-primary" disabled={sending} style={{ width: '100%' }}>
        {sending ? 'Sending…' : 'Send'}
      </button>
    </form>
  )
}
