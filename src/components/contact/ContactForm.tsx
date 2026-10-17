import { useId, useState, type FormEvent } from 'react'
import { Section, Pair, TextField, TextArea, Choice, Honeypot, SentCard, sendForm, FieldError } from '@components/forms/form-kit'
import { TOPICS } from '@lib/contact-options'

const EMPTY = { name: '', email: '', phone: '', topic: '', message: '', company: '' }
type Values = typeof EMPTY

/** /contact: a question or a note for the owners (Kaden, 17 Oct 2026). */
export default function ContactForm() {
  const id = useId()
  const [v, setV] = useState<Values>(EMPTY)
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
    const result = await sendForm('/api/contact/send.json', v)
    setSending(false)
    if (!result.ok) {
      setProblem({ field: result.field, error: result.error })
      document.getElementById(`${id}-${result.field}`)?.scrollIntoView?.({ block: 'center' })
      return
    }
    setDone(true)
  }

  if (done) return <SentCard />

  return (
    <form onSubmit={submit} noValidate style={{ display: 'grid', gap: '1.25rem' }}>
      <Section title="Send us a note">
        <TextField {...bind('name')} label="Your name" required autoComplete="name" />
        <Pair>
          <TextField {...bind('email')} label="Email" required type="email" inputMode="email" autoComplete="email" />
          <TextField {...bind('phone')} label="Phone" required type="tel" inputMode="tel" autoComplete="tel" />
        </Pair>
        <Choice {...bind('topic')} label="What’s it about?" options={TOPICS.map(([k, l]) => [k, l])} />
        <TextArea {...bind('message')} label="Your message" required rows={5} />
      </Section>
      <Honeypot value={v.company} onChange={(company) => setV((x) => ({ ...x, company }))} />
      <FieldError error={errorFor('form')} />
      <button type="submit" className="btn btn-primary" disabled={sending} style={{ width: '100%' }}>
        {sending ? 'Sending…' : 'Send'}
      </button>
    </form>
  )
}
