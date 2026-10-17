import { useId, useState, type FormEvent } from 'react'
import { Section, Pair, Side, TextField, TextArea, Choice, PhotoPicker, Honeypot, SentCard, sendForm, FieldError, type Photo } from '@components/forms/form-kit'

const MAX_PHOTOS = 6

const EMPTY = {
  name: '', business: '', email: '', phone: '', city: '',
  instagram: '', website: '', tiktok: '', etsy: '', video: '',
  what: '', takeHome: '', audience: '', dropOffOk: '', length: '', groupMin: '', groupMax: '', price: '', suppliesCost: '', needs: '',
  experience: '', days: '', howOften: '', company: '',
}
type Values = typeof EMPTY

/**
 * /teach: an outside artist tells us about themselves and the class they'd
 * teach (Kaden, 15 Oct 2026). Only name, email, phone, the class idea and one
 * photo are required.
 */
export default function TeachForm() {
  const id = useId()
  const [v, setV] = useState<Values>(EMPTY)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [problem, setProblem] = useState<{ field: string; error: string } | null>(null)
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)

  const errorFor = (field: string) => (problem?.field === field ? problem.error : '')
  const bind = (k: keyof Values) => ({ id: `${id}-${k}`, value: v[k], onChange: (val: string) => setV((x) => ({ ...x, [k]: val })), error: errorFor(k) })

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (sending) return
    setProblem(null)
    setSending(true)
    const result = await sendForm('/api/teach/apply.json', {
      about: { name: v.name, business: v.business, email: v.email, phone: v.phone, city: v.city },
      links: { instagram: v.instagram, website: v.website, tiktok: v.tiktok, etsy: v.etsy, video: v.video },
      classIdea: { what: v.what, takeHome: v.takeHome, audience: v.audience, dropOffOk: v.dropOffOk, length: v.length, groupMin: v.groupMin, groupMax: v.groupMax, price: v.price, suppliesCost: v.suppliesCost, needs: v.needs },
      experience: v.experience,
      when: { days: v.days, howOften: v.howOften },
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

  return (
    <form onSubmit={submit} noValidate style={{ display: 'grid', gap: '1.25rem' }}>
      <Section title="About you">
        <TextField {...bind('name')} label="Your name" required autoComplete="name" />
        <TextField {...bind('business')} label="Business name" autoComplete="organization" />
        <Pair>
          <TextField {...bind('email')} label="Email" required type="email" inputMode="email" autoComplete="email" />
          <TextField {...bind('phone')} label="Phone" required type="tel" inputMode="tel" autoComplete="tel" />
        </Pair>
        <TextField {...bind('city')} label="City" autoComplete="address-level2" />
        <Pair>
          <TextField {...bind('instagram')} label="Instagram" placeholder="@yourname" />
          <TextField {...bind('website')} label="Website" type="url" inputMode="url" />
        </Pair>
        <Pair>
          <TextField {...bind('tiktok')} label="TikTok" placeholder="@yourname" />
          <TextField {...bind('etsy')} label="Etsy" />
        </Pair>
      </Section>

      <Section title="Your class">
        <TextArea {...bind('what')} label="What would you teach?" required hint="A sentence or two about the class." />
        <TextField {...bind('takeHome')} label="What do people take home?" />
        <Choice {...bind('audience')} label="Who is it for?" options={[['kids', 'Kids & teens'], ['adults', 'Adults'], ['both', 'Both']]} />
        {(v.audience === 'kids' || v.audience === 'both') && <Choice {...bind('dropOffOk')} label="Could parents drop kids off?" options={[['yes', 'Yes'], ['no', 'No']]} />}
        <TextField {...bind('length')} label="How long" placeholder="e.g. 2 hours" />
        <Side>
          <TextField {...bind('groupMin')} label="Fewest people" inputMode="numeric" />
          <TextField {...bind('groupMax')} label="Most people" inputMode="numeric" />
        </Side>
        <Pair>
          <TextField {...bind('price')} label="Price you’d like per person" placeholder="e.g. $45" />
          <TextField {...bind('suppliesCost')} label="Supplies cost per person" placeholder="e.g. $12" />
        </Pair>
        <TextArea {...bind('needs')} label="What would you need from us?" hint="Tables, outlets, a sink, an oven, how messy it gets." />
      </Section>

      <Section title="Your work">
        <PhotoPicker
          id={`${id}-photos`}
          label="Photos of your work"
          hint={`Finished pieces or past classes. At least one, up to ${MAX_PHOTOS}.`}
          required
          photos={photos}
          onChange={setPhotos}
          max={MAX_PHOTOS}
          error={errorFor('photos')}
          onError={(error) => setProblem((p) => (error ? { field: 'photos', error } : p?.field === 'photos' ? null : p))}
        />
        <TextField {...bind('video')} label="Link to a video" type="url" inputMode="url" placeholder="Instagram reel, TikTok or YouTube" />
        <TextArea {...bind('experience')} label="Teaching experience" hint="Where you’ve taught, and for how long." />
      </Section>

      <Section title="When">
        <TextArea {...bind('days')} label="Which days and times work for you?" />
        <Choice {...bind('howOften')} label="How often?" options={[['one-time', 'One-time'], ['monthly', 'Monthly'], ['series', 'A series']]} />
      </Section>

      <Honeypot value={v.company} onChange={(company) => setV((x) => ({ ...x, company }))} />

      <FieldError error={errorFor('form')} />
      <button type="submit" className="btn btn-primary" disabled={sending} style={{ width: '100%' }}>
        {sending ? 'Sending…' : 'Send'}
      </button>
    </form>
  )
}
