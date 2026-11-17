import { useState } from 'react'
import type { MenuItem, Per } from '@lib/quotes/types'
import { PhotoPicker } from '../classes/ClassDetails'
import { Seg } from '../shell/items'
import { SheetFrame, useSheetDirty } from '../shell/Sheet'
import { centsFromDollars, dollarsFromCents, priceText, saveItem, type ItemFields } from './api'

const PER: [Per, string][] = [['person', 'Per person'], ['event', 'Per event']]

/**
 * One menu item, changed or added. A Square item's name, price and photo
 * follow Square (the next Load from Square puts them back), so only what is
 * hers shows as boxes: per person or event, cost, tags, hidden. Her own items
 * (Travel) have every box.
 */
export function ItemEditor({ item, onSaved, onBack }: {
  item: MenuItem | null
  onSaved: (item: MenuItem) => void
  onBack: () => void
}) {
  const fromSquare = item?.source === 'square'
  const [name, setName] = useState(item?.name ?? '')
  const [price, setPrice] = useState(item ? dollarsFromCents(item.cents) : '')
  const [per, setPer] = useState<Per>(item?.per ?? 'person')
  const [cost, setCost] = useState(item?.costCents == null ? '' : dollarsFromCents(item.costCents))
  const [tags, setTags] = useState<string[]>(item?.tags ?? [])
  const [tag, setTag] = useState('')
  const [hidden, setHidden] = useState(item?.hidden ?? false)
  const [photoUrl, setPhotoUrl] = useState<string | null>(item?.photoUrl ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [leaving, setLeaving] = useState(false)

  const dirty = !item
    ? !!(name || price || cost || tags.length || hidden || photoUrl)
    : name !== item.name || price !== dollarsFromCents(item.cents) || per !== item.per
      || cost !== (item.costCents == null ? '' : dollarsFromCents(item.costCents))
      || tags.join('|') !== item.tags.join('|') || hidden !== item.hidden || photoUrl !== item.photoUrl
  useSheetDirty(dirty)

  function addTag() {
    const t = tag.trim().toLowerCase()
    if (t && !tags.includes(t)) setTags((cur) => [...cur, t])
    setTag('')
  }

  async function save() {
    setError('')
    if (!name.trim()) { setError('Give the item a name.'); return }
    const cents = centsFromDollars(price)
    if (cents === null) { setError('Type the price in dollars, like 35.'); return }
    const costCents = cost.trim() === '' ? null : centsFromDollars(cost)
    if (cost.trim() !== '' && costCents === null) { setError('Type what it costs in dollars, like 4.50, or leave it empty.'); return }
    const pending = tag.trim().toLowerCase()
    const fields: ItemFields = {
      ...(item ? { id: item.id } : {}),
      name: name.trim(), cents, per, costCents,
      tags: pending && !tags.includes(pending) ? [...tags, pending] : tags,
      hidden, photoUrl,
    }
    setBusy(true)
    const r = await saveItem(fields)
    setBusy(false)
    if (r.ok && r.data) onSaved(r.data.item)
    else setError(r.error ?? 'That didn’t save. Try again.')
  }

  return (
    <SheetFrame
      title={item ? item.name : 'Add your own item'}
      subtitle={item ? priceText(item.cents, item.per) : 'Like Travel or a setup fee'}
      tall
      footer={<button type="button" className="adm-btn is-pri" disabled={busy || (!!item && !dirty)} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>}
    >
      <button type="button" className="adm-btn is-ghost is-sm adm-gap-bottom" onClick={() => (dirty ? setLeaving(true) : onBack())}>‹ Quote menu</button>
      {leaving && (
        <div className="adm-panel" role="group" aria-label="Leave without saving?">
          <b>Leave without saving?</b>
          <div className="adm-two">
            <button type="button" className="adm-btn is-ghost" onClick={() => setLeaving(false)}>Keep editing</button>
            <button type="button" className="adm-btn is-danger" onClick={onBack}>Leave</button>
          </div>
        </div>
      )}
      {fromSquare ? (
        <div className="adm-photo">
          <div className="adm-photo-thumb" aria-hidden="true">
            {item.photoUrl ? <img src={item.photoUrl} alt="" /> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 8h3l2-2h6l2 2h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>}
          </div>
          <div className="adm-photo-side">
            <b>{item.name}</b>
            <span className="adm-small adm-muted">The name, price and photo come from Square. Change them there, then tap Load from Square.</span>
          </div>
        </div>
      ) : (
        <>
          <PhotoPicker url={photoUrl} onChange={setPhotoUrl} what="Item photo" />
          <label className="adm-fld adm-gap-top">
            <span>Name</span>
            <input maxLength={120} value={name} placeholder="Like: Travel" onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="adm-fld adm-gap-top">
            <span>Price ($)</span>
            <input inputMode="decimal" value={price} placeholder="35" onChange={(e) => setPrice(e.target.value)} />
          </label>
        </>
      )}
      <div className="adm-gap-top">
        <p className="adm-lbl">The price is</p>
        <Seg<Per> label="Price is" value={per} options={PER} onChange={setPer} />
      </div>
      <label className="adm-fld adm-gap-top">
        <span>What it costs us ($)</span>
        <input inputMode="decimal" value={cost} placeholder="Leave empty if you don’t know" onChange={(e) => setCost(e.target.value)} />
      </label>
      <small className="adm-hint">Only owners see this. It never shows on a quote.</small>
      <div className="adm-gap-top">
        <p className="adm-lbl">Tags</p>
        {tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
            {tags.map((t) => (
              <button key={t} type="button" className="adm-btn is-ghost is-sm" aria-label={`Remove tag ${t}`} onClick={() => setTags((cur) => cur.filter((x) => x !== t))}>{t} ×</button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
          <label className="adm-fld" style={{ flex: 1, margin: 0 }}>
            <span>New tag</span>
            <input
              maxLength={40}
              value={tag}
              placeholder="Like: food"
              onChange={(e) => setTag(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
            />
          </label>
          <button type="button" className="adm-btn is-ghost is-sm" disabled={!tag.trim()} onClick={addTag}>Add tag</button>
        </div>
        <small className="adm-hint">Tags help you find things when you build a quote.</small>
      </div>
      <label className="adm-check adm-gap-top">
        <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
        <span>Hide from new quotes (quotes already made keep it)</span>
      </label>
      {error && <p className="adm-error" role="alert">{error}</p>}
    </SheetFrame>
  )
}
