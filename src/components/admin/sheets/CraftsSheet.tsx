import { useEffect, useRef, useState } from 'react'
import type { AdminCraft, CraftMarkers, Where } from '@lib/crafts/craft-admin'
import { CRAFT_COPY_EXAMPLE, CRAFT_COPY_GUIDE, craftCopyNotes, craftNameNotes } from '@lib/crafts/craft-copy-hints'
import { formatMoney } from '@lib/money'
import { api, CRAFTS } from '../classes/api'
import { PhotoPicker } from '../classes/ClassDetails'
import { Failed, Seg, Skeleton } from '../shell/items'
import { SheetFrame, useSheetDirty } from '../shell/Sheet'
import { useToast } from '../shell/Toast'

interface Loaded { crafts: AdminCraft[]; markers: CraftMarkers; refusal: string | null; taxRefusal?: string | null }
type Filter = 'all' | 'parties' | 'cafe' | 'hidden'

export const WHERE_LABEL: Record<Where, string> = { both: 'Parties and Craft Café', parties: 'Parties only', cafe: 'Craft Café only' }

/** "18" or "18.50" → cents; null when it isn't a price. Pure. */
export function dollarsToCents(v: string): number | null {
  const t = v.trim().replace(/^\$/, '')
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return null
  const cents = Math.round(Number(t) * 100)
  return cents > 0 ? cents : null
}
const centsToDollars = (c: number) => (c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2))

function priceText(c: AdminCraft): string {
  const prices = c.sizes.map((s) => s.cents).filter((n) => n > 0)
  if (!prices.length) return 'No price'
  const lo = Math.min(...prices), hi = Math.max(...prices)
  return `${lo === hi ? formatMoney(lo) : `${formatMoney(lo)}–${formatMoney(hi)}`} a guest`
}

const newRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

function NoPhoto() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" width="28" height="28"><path d="M4 8h3l2-2h6l2 2h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
}

/** How the card looks to customers: photo (or none), name, price, the first paragraph. */
function CardPreview({ name, cents, description, imageUrl }: { name: string; cents: number | null; description: string; imageUrl: string | null }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const first = description.split(/\n\s*\n/)[0]?.trim() ?? ''
  return (
    <section aria-label="How the card looks" className="adm-preview-card">
      <p className="adm-lbl">How the card looks</p>
      <div className="adm-card" style={{ padding: 0, overflow: 'hidden', maxWidth: '20rem' }}>
        {imageUrl
          ? <img src={imageUrl} alt="" onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }} />
          : <div style={{ aspectRatio: '4 / 3', display: 'grid', placeItems: 'center', background: 'var(--adm-sand)' }}><span className="adm-small adm-muted">No photo yet. The card shows without one.</span></div>}
        <div style={{ padding: '0.75rem 1rem' }}>
          <b>{name || 'Craft name'}</b>
          <p className="adm-small adm-muted">{cents ? `${formatMoney(cents)} a guest` : 'Price per guest'}</p>
          {first && <p className="adm-small" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{first}</p>}
        </div>
      </div>
      {size && (size.w < 1200 || size.h < 900) && <p className="adm-warntext">{`This photo is small (${size.w} × ${size.h}). It may look blurry on a big screen. A bigger one is better if you have it.`}</p>}
    </section>
  )
}

const PHOTO_LATER = 'The craft is saved, but the photo didn’t go up. Open it and choose the photo again.'

/** What she typed, kept beside the latest version after "See the latest". */
interface Typed { name: string; price: string; sizes: Record<string, string>; description: string }

/** Add or change one craft. */
function CraftForm({ craft: opened, markers, refusal, onSaved, onBack, onReload }: {
  craft: AdminCraft | null
  markers: CraftMarkers
  refusal: string | null
  onSaved: (c: AdminCraft, message: string, warning?: string) => void
  onBack: () => void
  /** Read the craft again from Square (the latest), or null when it can't be read. */
  onReload: (id: string) => Promise<AdminCraft | null>
}) {
  const toast = useToast()
  const [requestId] = useState(newRequestId)
  // The craft as Square has it now: updated after its photo goes up, or after "See the latest".
  const [craft, setCraft] = useState<AdminCraft | null>(opened)
  const [typed, setTyped] = useState<Typed | null>(null)
  // One key per save: the same save sent again (a lost answer) is recognised, a changed one is new.
  const lastSave = useRef<{ body: string; id: string } | null>(null)
  const single = !craft || craft.sizes.length <= 1
  const [name, setName] = useState(craft?.name ?? '')
  const [price, setPrice] = useState(craft && single ? centsToDollars(craft.sizes[0]?.cents ?? 0) : '')
  const [sizes, setSizes] = useState<Record<string, string>>(() => Object.fromEntries((craft?.sizes ?? []).map((s) => [s.id, centsToDollars(s.cents)])))
  const [description, setDescription] = useState(craft?.description ?? '')
  const [personalized, setPersonalized] = useState(craft?.personalized ?? false)
  const [popular, setPopular] = useState(craft?.popular ?? false)
  const [where, setWhere] = useState<Where>(craft?.where ?? 'both')
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; field?: string; stale?: boolean } | null>(null)
  const [showExample, setShowExample] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const cents = dollarsToCents(price)
  const priceChanged = !!craft && (single
    ? cents !== null && cents !== craft.sizes[0]?.cents
    : craft.sizes.some((s) => dollarsToCents(sizes[s.id] ?? '') !== s.cents))
  const dirty = !craft
    ? !!(name || price || description || photoUrl)
    : name !== craft.name || description.trim() !== craft.description.trim() || priceChanged || personalized !== craft.personalized || popular !== craft.popular || where !== craft.where || !!photoUrl
  useSheetDirty(dirty)
  const notes = craftCopyNotes(description, { personalized })
  const nameNotes = craftNameNotes(name)

  /** The photo as its own request (each request stays small and quick). The craft as it is now, or null. */
  async function sendPhoto(id: string): Promise<AdminCraft | null> {
    if (!photoUrl) return null
    const r = await api<{ craft: AdminCraft }>(CRAFTS, { action: 'photo', id, photoUrl })
    if (r.ok && r.data) { setPhotoUrl(null); setCraft(r.data.craft); return r.data.craft }
    return null
  }

  async function seeLatest() {
    if (!craft) return
    setTyped({ name, price, sizes, description })
    setBusy(true)
    const latest = await onReload(craft.id)
    setBusy(false)
    if (!latest) { setError({ text: 'The craft couldn’t be read just now. Try again in a minute.' }); return }
    setError(null)
    setCraft(latest)
    setName(latest.name)
    setPrice(latest.sizes.length <= 1 ? centsToDollars(latest.sizes[0]?.cents ?? 0) : '')
    setSizes(Object.fromEntries(latest.sizes.map((s) => [s.id, centsToDollars(s.cents)])))
    setDescription(latest.description)
    setPersonalized(latest.personalized)
    setPopular(latest.popular)
    setWhere(latest.where)
  }

  function applyTyped() {
    if (!typed) return
    setName(typed.name)
    setPrice(typed.price)
    setSizes(typed.sizes)
    setDescription(typed.description)
    setTyped(null)
  }

  async function save() {
    setError(null)
    if (!name.trim()) { setError({ text: 'Give it a name.', field: 'name' }); return }
    let body: Record<string, unknown>
    if (!craft) {
      if (cents === null) { setError({ text: 'Type the price per guest, like 18.', field: 'price' }); return }
      body = { action: 'create', requestId, name, description, cents, personalized, popular, where }
    } else {
      body = { action: 'update', id: craft.id, version: craft.version }
      if (name !== craft.name) body.name = name
      if (description.trim() !== craft.description.trim()) body.description = description
      if (single) {
        if (cents === null) { setError({ text: 'Type the price per guest, like 18.', field: 'price' }); return }
        if (cents !== craft.sizes[0]?.cents) body.cents = cents
      } else {
        const list = craft.sizes.map((s) => ({ id: s.id, cents: dollarsToCents(sizes[s.id] ?? '') }))
        if (list.some((s) => s.cents === null)) { setError({ text: 'Each size needs a price, like 18.', field: 'price' }); return }
        if (priceChanged) body.sizes = list
      }
      if (personalized !== craft.personalized) body.personalized = personalized
      if (popular !== craft.popular) body.popular = popular
      if (where !== craft.where) body.where = where
    }
    setBusy(true)
    if (!craft) {
      // Add first, then the photo as its own request.
      const r = await api<{ craft: AdminCraft; message: string }>(CRAFTS, body)
      if (!r.ok || !r.data) { setBusy(false); setError({ text: r.error ?? '', field: r.extra.field }); return }
      let made = r.data.craft
      let warning = r.warning
      if (photoUrl) {
        const withPhoto = await sendPhoto(made.id)
        if (withPhoto) made = withPhoto
        else warning = warning ?? PHOTO_LATER
      }
      setBusy(false)
      onSaved(made, r.data.message, warning)
      if (!warning) toast(r.data.message)
      return
    }
    // A change: the photo first, as its own request; then the rest, on the craft's new version.
    let base = craft
    if (photoUrl) {
      const withPhoto = await sendPhoto(craft.id)
      if (!withPhoto) { setBusy(false); setError({ text: 'The photo didn’t go up. Choose it again and save.', field: 'photo' }); return }
      base = withPhoto
      body.version = base.version
    }
    const changes = Object.keys(body).filter((k) => !['action', 'id', 'version'].includes(k))
    if (changes.length === 0) {
      setBusy(false)
      const message = 'Saved. The website shows it within a minute.'
      onSaved(base, message)
      toast(message)
      return
    }
    const sig = JSON.stringify({ ...body, version: undefined })
    if (!lastSave.current || lastSave.current.body !== sig) lastSave.current = { body: sig, id: newRequestId().replace(/[^A-Za-z0-9_-]/g, '') }
    const r = await api<{ craft: AdminCraft; message: string }>(CRAFTS, { ...body, saveId: lastSave.current.id })
    setBusy(false)
    if (r.ok && r.data) {
      onSaved(r.data.craft, r.data.message, r.warning)
      if (!r.warning) toast(r.data.message)
    } else setError({ text: r.error ?? '', field: r.extra.field, stale: !!r.extra.stale })
  }

  const fieldError = (f: string) => (error?.field === f ? <p role="alert" className="adm-error adm-fielderr">{error.text}</p> : null)
  return (
    <>
      <button type="button" className="adm-btn is-ghost is-sm adm-gap-bottom" onClick={() => (dirty ? setLeaving(true) : onBack())}>‹ All crafts</button>
      {leaving && (
        <div className="adm-panel" role="group" aria-label="Leave without saving?">
          <b>Leave without saving?</b>
          <div className="adm-two">
            <button type="button" className="adm-btn is-ghost" onClick={() => setLeaving(false)}>Keep editing</button>
            <button type="button" className="adm-btn is-danger" onClick={onBack}>Leave</button>
          </div>
        </div>
      )}
      {refusal && <p className="adm-warntext" role="note">{refusal}</p>}
      <PhotoPicker url={photoUrl ?? craft?.imageUrl ?? null} onChange={(u) => setPhotoUrl(u)} what="Craft photo" canRemove={false} />
      {fieldError('photo')}
      <label className="adm-fld" data-field="name">
        <span>Name</span>
        <input maxLength={80} value={name} placeholder="Like: Bubble Letter Keychains" aria-invalid={error?.field === 'name' || undefined} onChange={(e) => setName(e.target.value)} />
      </label>
      <small className="adm-hint">Short, like “Keychain Bar”. No “Party” or “Birthday” in the name.</small>
      {nameNotes.length > 0 && <ul className="adm-help-list" aria-label="Suggestions for the name">{nameNotes.map((n) => <li key={n} className="adm-small">{n}</li>)}</ul>}
      {fieldError('name')}
      {single ? (
        <label className="adm-fld adm-gap-top" data-field="price">
          <span>Price per guest ($)</span>
          <input inputMode="decimal" value={price} placeholder="18" aria-invalid={error?.field === 'price' || undefined} onChange={(e) => setPrice(e.target.value)} />
        </label>
      ) : (
        <div className="adm-gap-top" data-field="price">
          <p className="adm-lbl">Price per guest, by size ($)</p>
          {craft!.sizes.map((s) => (
            <label key={s.id} className="adm-fld">
              <span>{s.name || 'Size'}</span>
              <input inputMode="decimal" value={sizes[s.id] ?? ''} onChange={(e) => setSizes((cur) => ({ ...cur, [s.id]: e.target.value }))} />
            </label>
          ))}
        </div>
      )}
      {fieldError('price')}
      {priceChanged && <p className="adm-small adm-muted">New bookings and the register use the new price. Crafts are paid at the studio, so nothing already booked changes.</p>}
      <label className="adm-fld adm-gap-top" data-field="description">
        <span>What it is</span>
        <textarea rows={8} value={description} aria-describedby="craft-copy-guide" onChange={(e) => setDescription(e.target.value)} />
      </label>
      <small id="craft-copy-guide" className="adm-hint">{`${CRAFT_COPY_GUIDE} ${description.trim().length} characters so far.`}</small>
      <button type="button" className="adm-btn is-ghost is-sm" aria-expanded={showExample} onClick={() => setShowExample((v) => !v)}>{showExample ? 'Hide the example' : 'Show an example'}</button>
      {showExample && <p className="adm-note" style={{ whiteSpace: 'pre-line' }}>{CRAFT_COPY_EXAMPLE}</p>}
      {notes.length > 0 && (
        <ul className="adm-help-list" aria-label="Suggestions for the words">
          {notes.map((n) => <li key={n} className="adm-small">{n}</li>)}
        </ul>
      )}
      {fieldError('description')}
      {markers.where && (
        <div className="adm-gap-top">
          <p className="adm-lbl">Where it’s offered</p>
          <Seg<Where> label="Where it’s offered" value={where} options={[['both', 'Both'], ['parties', 'Parties only'], ['cafe', 'Craft Café only']]} onChange={setWhere} className="is-wrap" />
        </div>
      )}
      {markers.personalized && (
        <label className="adm-check adm-gap-top">
          <input type="checkbox" checked={personalized} onChange={(e) => setPersonalized(e.target.checked)} />
          <span>Made to order (made ahead, can’t be changed or refunded; people tick that they understand when they book)</span>
        </label>
      )}
      {markers.popular && (
        <label className="adm-check">
          <input type="checkbox" checked={popular} onChange={(e) => setPopular(e.target.checked)} />
          <span>Most popular badge (one craft at a time; this moves it here)</span>
        </label>
      )}
      <CardPreview name={name} cents={single ? cents : null} description={description} imageUrl={photoUrl ?? craft?.imageUrl ?? null} />
      {error && !error.field && <p className="adm-error" role="alert">{error.text}</p>}
      {error?.stale && <button type="button" className="adm-btn is-ghost is-sm" disabled={busy} onClick={seeLatest}>See the latest</button>}
      {typed && (
        <aside className="adm-panel" aria-label="What you typed">
          <b>What you typed</b>
          <p className="adm-small adm-muted">The form now shows the latest. Your words are kept here.</p>
          <p className="adm-small"><b>Name:</b> {typed.name}</p>
          {typed.price && <p className="adm-small"><b>Price per guest:</b> ${typed.price}</p>}
          {typed.description && <p className="adm-small" style={{ whiteSpace: 'pre-line', userSelect: 'text' }}>{typed.description}</p>}
          <div className="adm-two">
            <button type="button" className="adm-btn is-ghost is-sm" onClick={() => setTyped(null)}>Keep the latest</button>
            <button type="button" className="adm-btn is-sm" onClick={applyTyped}>Use what I typed</button>
          </div>
        </aside>
      )}
      <div className="adm-gap-top">
        <button type="button" className="adm-btn is-pri" disabled={busy || !!refusal || (!!craft && !dirty)} onClick={save}>{busy ? 'Saving…' : craft ? 'Save craft' : 'Add craft'}</button>
      </div>
    </>
  )
}

/** More › Crafts: the party and Craft Café crafts, added and changed here. */
export function CraftsSheet() {
  const toast = useToast()
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  const [editing, setEditing] = useState<AdminCraft | 'new' | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [notice, setNotice] = useState<{ text: string; warn?: boolean } | null>(null)
  const [hiding, setHiding] = useState('')
  const [taxing, setTaxing] = useState('')
  useEffect(() => {
    let live = true
    setError('')
    api<Loaded>(CRAFTS).then((r) => {
      if (!live) return
      if (r.ok && r.data) setData(r.data)
      else setError(r.error ?? '')
    })
    return () => { live = false }
  }, [tries])

  function saved(c: AdminCraft, message: string, warning?: string) {
    setData((cur) => {
      if (!cur) return cur
      const others = cur.crafts.filter((x) => x.id !== c.id).map((x) => (c.popular && x.popular ? { ...x, popular: false } : x))
      return { ...cur, crafts: [...others, c].sort((a, b) => a.name.localeCompare(b.name)) }
    })
    setEditing(null)
    setNotice(warning ? { text: warning, warn: true } : { text: message })
    if (c.popular) setTries((n) => n + 1) // another craft lost the badge: read the list again
  }

  async function hide(c: AdminCraft, hidden: boolean) {
    setHiding(c.id)
    const r = await api<{ craft: AdminCraft; message: string }>(CRAFTS, { action: hidden ? 'hide' : 'show', id: c.id })
    setHiding('')
    if (r.ok && r.data) {
      setData((cur) => (cur ? { ...cur, crafts: cur.crafts.map((x) => (x.id === c.id ? { ...x, hidden } : x)) } : cur))
      setNotice({ text: r.data.message })
      toast(r.data.message)
    } else setNotice({ text: r.error ?? '', warn: true })
  }

  async function addTax(c: AdminCraft) {
    setTaxing(c.id)
    const r = await api<{ craft: AdminCraft; message: string }>(CRAFTS, { action: 'add-tax', id: c.id, version: c.version })
    setTaxing('')
    if (r.ok && r.data) {
      const fresh = r.data.craft
      setData((cur) => (cur ? { ...cur, crafts: cur.crafts.map((x) => (x.id === c.id ? { ...fresh, hidden: x.hidden } : x)) } : cur))
      setNotice({ text: r.data.message })
      toast(r.data.message)
    } else {
      setNotice({ text: r.error ?? '', warn: true })
      if (r.extra.stale) setTries((n) => n + 1)
    }
  }

  async function reload(id: string): Promise<AdminCraft | null> {
    const r = await api<Loaded>(CRAFTS)
    if (!r.ok || !r.data) return null
    setData(r.data)
    return r.data.crafts.find((x) => x.id === id) ?? null
  }

  if (editing && data) {
    const craft = editing === 'new' ? null : editing
    return (
      <SheetFrame title={craft ? craft.name : 'Add a craft'} subtitle={craft ? priceText(craft) : 'Party and Craft Café crafts'} tall>
        <CraftForm
          craft={craft}
          markers={data.markers}
          refusal={data.refusal}
          onSaved={saved}
          onBack={() => { setEditing(null); setTries((n) => n + 1) }}
          onReload={reload}
        />
      </SheetFrame>
    )
  }

  const shown = (data?.crafts ?? []).filter((c) => (filter === 'hidden' ? c.hidden : filter === 'parties' ? c.where !== 'cafe' : filter === 'cafe' ? c.where !== 'parties' : true))
  return (
    <SheetFrame
      title="Crafts"
      subtitle="What people can make at parties and Craft Café"
      tall
      footer={data && !data.refusal ? <button type="button" className="adm-btn is-pri" onClick={() => { setNotice(null); setEditing('new') }}>+ Add a craft</button> : undefined}
    >
      {error && <Failed message={error} onRetry={() => setTries((n) => n + 1)} />}
      {!error && !data && <Skeleton rows={3} label="Loading the crafts" />}
      {data && (
        <>
          {data.refusal && <p className="adm-warntext" role="note">{data.refusal}</p>}
          <p className="adm-note">Each craft’s photo, name, price per guest and words show on the party booking page and the Craft Café menu within a minute of saving. Crafts are always paid at the studio, on the register.</p>
          {!data.refusal && data.taxRefusal && <p className="adm-warntext" role="note">{data.taxRefusal}</p>}
          {notice && <p className={notice.warn ? 'adm-warntext' : 'adm-done'} role="status">{notice.text}</p>}
          <Seg<Filter> label="Show" value={filter} options={[['all', 'All'], ['parties', 'Parties'], ['cafe', 'Craft Café'], ['hidden', 'Hidden']]} onChange={setFilter} className="is-wrap" />
          {shown.length === 0 && <p className="adm-empty">{filter === 'hidden' ? 'Nothing is hidden.' : data.refusal ? 'No crafts here yet.' : 'No crafts here yet. Tap + Add a craft.'}</p>}
          <ul className="adm-mlist" aria-label="Crafts">
            {shown.map((c) => (
              <li key={c.id}>
                <div className="adm-mrow" style={{ alignItems: 'center' }}>
                  <span className="adm-thumb" style={{ width: '3.5rem', height: '2.6rem', flex: 'none', borderRadius: '0.4rem', overflow: 'hidden', display: 'grid', placeItems: 'center', background: 'var(--adm-sand)' }}>
                    {c.imageUrl ? <img src={c.imageUrl} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <NoPhoto />}
                  </span>
                  <button type="button" className="adm-bare adm-rm" style={{ textAlign: 'left', flex: 1 }} onClick={() => { setNotice(null); setEditing(c) }} aria-label={`Change ${c.name}`}>
                    <b>{c.name}</b>
                    <small>
                      {[priceText(c), data.markers.where ? WHERE_LABEL[c.where] : null, c.personalized ? 'Made to order' : null, c.popular ? 'Most popular' : null, !c.imageUrl ? 'No photo' : null].filter(Boolean).join(' · ')}
                    </small>
                    {(c.hidden || c.test) && <span className="adm-tag" style={{ margin: 0 }}>{c.test ? 'Test item, never on the website' : 'Hidden on the website'}</span>}
                    {!c.taxed && !c.test && <span className="adm-tag is-warn" style={{ margin: 0 }}>No tax on the register</span>}
                  </button>
                  {!c.taxed && !c.test && !data.refusal && (
                    <button type="button" className="adm-btn is-sm" disabled={taxing === c.id} onClick={() => addTax(c)}>
                      {taxing === c.id ? 'Adding…' : 'Add the tax'}
                    </button>
                  )}
                  {!c.test && (
                    <button type="button" className="adm-btn is-ghost is-sm" disabled={hiding === c.id} onClick={() => hide(c, !c.hidden)}>
                      {c.hidden ? 'Show on website' : 'Hide on website'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="adm-small adm-muted">Hide on website takes a craft off the party booking page and the Craft Café menu. It stays on the register, and parties that already picked it keep it.</p>
        </>
      )}
    </SheetFrame>
  )
}
