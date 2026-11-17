import { useEffect, useState } from 'react'
import { formatMoney } from '@lib/money'
import type { MenuItem, QuoteSettings, SavedPackage } from '@lib/quotes/types'
import { Failed, Seg, Skeleton } from '../shell/items'
import { SheetFrame, useSheetDirty } from '../shell/Sheet'
import { ItemEditor } from './ItemEditor'
import { deletePackage, loadMenu, priceText, savePackage, saveSettings, settingsText, syncedText, syncSquare, type MenuData, type SettingNumbers } from './api'

type View = { view: 'list' } | { view: 'item'; item: MenuItem | null } | { view: 'settings' }

const byName = (a: MenuItem, b: MenuItem) => a.name.localeCompare(b.name)

function NoPhoto() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" width="28" height="28"><path d="M4 8h3l2-2h6l2 2h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
}

function BackButton({ dirty, onBack }: { dirty: boolean; onBack: () => void }) {
  const [leaving, setLeaving] = useState(false)
  return (
    <>
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
    </>
  )
}

const SETTING_FIELDS: [keyof SettingNumbers, string, string][] = [
  ['capPct', 'Most off the normal price (%)', 'A package can be at most this much under its normal price.'],
  ['yellowFromPct', 'Turns yellow from (%)', 'The meter turns yellow from here, as a heads-up before the most.'],
  ['depositPct', 'Deposit (%)', 'What they pay to book. The rest is due at the party.'],
  ['expiryDays', 'Days they have to reply', 'A new quote is good for this many days. You can change it on each quote.'],
]

const STALE = 'Someone else saved these a moment ago. These are their numbers now. Change them again if you need to, then save.'

/** Quote settings: cap, yellow, deposit, reply-by days. */
function SettingsForm({ settings, onSaved, onStale, onBack }: {
  settings: QuoteSettings
  onSaved: (s: QuoteSettings) => void
  /** Read the latest settings again; null when they can't be read. */
  onStale: () => Promise<QuoteSettings | null>
  onBack: () => void
}) {
  const [base, setBase] = useState(settings)
  const asText = (s: QuoteSettings) => Object.fromEntries(SETTING_FIELDS.map(([k]) => [k, String(s[k])])) as Record<keyof SettingNumbers, string>
  const [vals, setVals] = useState(() => asText(settings))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dirty = SETTING_FIELDS.some(([k]) => vals[k] !== String(base[k]))
  useSheetDirty(dirty)

  async function save() {
    setError('')
    const nums = {} as SettingNumbers
    for (const [k] of SETTING_FIELDS) {
      const n = Number(vals[k].trim().replace(/%$/, ''))
      if (vals[k].trim() === '' || !Number.isFinite(n)) { setError('Each box needs a number.'); return }
      nums[k] = n
    }
    setBusy(true)
    const r = await saveSettings(nums, base.updatedAt)
    if (r.ok && r.data) { setBusy(false); onSaved(r.data.settings); return }
    if (r.status === 409) {
      const latest = await onStale()
      setBusy(false)
      if (latest) { setBase(latest); setVals(asText(latest)) }
      setError(STALE)
      return
    }
    setBusy(false)
    setError(r.error ?? 'That didn’t save. Try again.')
  }

  return (
    <SheetFrame
      title="Quote settings"
      subtitle="Used for every new quote"
      tall
      footer={<button type="button" className="adm-btn is-pri" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save settings'}</button>}
    >
      <BackButton dirty={dirty} onBack={onBack} />
      {SETTING_FIELDS.map(([k, label, hint]) => (
        <div key={k} className="adm-gap-top">
          <label className="adm-fld">
            <span>{label}</span>
            <input inputMode="numeric" value={vals[k]} onChange={(e) => setVals((cur) => ({ ...cur, [k]: e.target.value }))} />
          </label>
          <small className="adm-hint">{hint}</small>
        </div>
      ))}
      {error && <p className={error === STALE ? 'adm-warntext' : 'adm-error'} role="alert">{error}</p>}
    </SheetFrame>
  )
}

/** One saved package: its name and item count, Rename, Delete (asked in the sheet first). */
function PackageRow({ pkg, onChanged }: { pkg: SavedPackage; onChanged: (packages: SavedPackage[]) => void }) {
  const [mode, setMode] = useState<'show' | 'rename' | 'delete'>('show')
  const [name, setName] = useState(pkg.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const count = `${pkg.lines.length} item${pkg.lines.length === 1 ? '' : 's'}`

  async function rename() {
    if (!name.trim()) { setError('Give the package a name.'); return }
    setBusy(true)
    const r = await savePackage({ ...pkg, name: name.trim() })
    setBusy(false)
    if (r.ok && r.data) { setMode('show'); setError(''); onChanged(r.data.packages) }
    else setError(r.error ?? 'That didn’t save. Try again.')
  }
  async function remove() {
    setBusy(true)
    const r = await deletePackage(pkg.id)
    setBusy(false)
    if (r.ok && r.data) onChanged(r.data.packages)
    else setError(r.error ?? 'That didn’t work. Try again.')
  }

  return (
    <li>
      <div className="adm-mrow" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        {mode === 'rename' ? (
          <label className="adm-fld" style={{ flex: 1, margin: 0 }}>
            <span>Package name</span>
            <input maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        ) : (
          <span className="adm-rm" style={{ flex: 1 }}><b>{pkg.name}</b><small>{count}</small></span>
        )}
        {mode === 'rename' ? (
          <>
            <button type="button" className="adm-btn is-ghost is-sm" disabled={busy} onClick={() => { setMode('show'); setName(pkg.name); setError('') }}>Cancel</button>
            <button type="button" className="adm-btn is-sm" disabled={busy} onClick={rename}>{busy ? 'Saving…' : 'Save name'}</button>
          </>
        ) : (
          <>
            <button type="button" className="adm-btn is-ghost is-sm" aria-label={`Rename ${pkg.name}`} onClick={() => setMode('rename')}>Rename</button>
            <button type="button" className="adm-btn is-ghost is-sm" aria-label={`Delete ${pkg.name}`} onClick={() => setMode('delete')}>Delete</button>
          </>
        )}
      </div>
      {mode === 'delete' && (
        <div className="adm-panel" role="group" aria-label={`Delete ${pkg.name}?`}>
          <b>{`Delete “${pkg.name}”?`}</b>
          <p className="adm-small adm-muted">Quotes already made with it don’t change.</p>
          <div className="adm-two">
            <button type="button" className="adm-btn is-ghost" disabled={busy} onClick={() => setMode('show')}>Keep it</button>
            <button type="button" className="adm-btn is-danger" disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'Delete'}</button>
          </div>
        </div>
      )}
      {error && <p className="adm-error" role="alert">{error}</p>}
    </li>
  )
}

/** More › Quote menu: what private-event quotes are built from — items, saved packages, settings. */
export function QuoteMenuPage() {
  const [data, setData] = useState<MenuData | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  const [view, setView] = useState<View>({ view: 'list' })
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [notice, setNotice] = useState<{ text: string; warn?: boolean } | null>(null)

  useEffect(() => {
    let live = true
    setError('')
    loadMenu().then((r) => {
      if (!live) return
      if (r.ok && r.data) setData(r.data)
      else setError(r.error ?? '')
    })
    return () => { live = false }
  }, [tries])

  const patch = (p: Partial<MenuData>) => setData((cur) => (cur ? { ...cur, ...p } : cur))

  async function load() {
    setNotice(null)
    setSyncing(true)
    const r = await syncSquare()
    setSyncing(false)
    if (r.ok && r.data) {
      patch({ items: r.data.items, syncedAt: r.data.syncedAt })
      setNotice({ text: `Loaded ${r.data.items.filter((i) => i.source === 'square' && !i.gone).length} items from Square.` })
    } else setNotice({ text: r.error ?? 'Square didn’t answer. Try again in a minute.', warn: true })
  }

  async function latestSettings(): Promise<QuoteSettings | null> {
    const r = await loadMenu()
    if (!r.ok || !r.data) return null
    setData(r.data)
    return r.data.settings
  }

  if (data && view.view === 'item') {
    return (
      <ItemEditor
        item={view.item}
        onBack={() => setView({ view: 'list' })}
        onSaved={(saved) => {
          patch({ items: [...data.items.filter((i) => i.id !== saved.id), saved] })
          setNotice({ text: `Saved ${saved.name}.` })
          setView({ view: 'list' })
        }}
      />
    )
  }
  if (data && view.view === 'settings') {
    return (
      <SettingsForm
        settings={data.settings}
        onBack={() => setView({ view: 'list' })}
        onStale={latestSettings}
        onSaved={(settings) => { patch({ settings }); setNotice({ text: 'Settings saved. New quotes use them.' }); setView({ view: 'list' }) }}
      />
    )
  }

  const tags = data ? [...new Set(data.items.flatMap((i) => i.tags))].sort() : []
  const q = search.trim().toLowerCase()
  const shown = (data?.items ?? [])
    .filter((i) => (!q || i.name.toLowerCase().includes(q)) && (!tagFilter || i.tags.includes(tagFilter)))
    .sort(byName)

  return (
    <SheetFrame
      title="Quote menu"
      subtitle="What private-event quotes are built from"
      tall
      footer={data ? <button type="button" className="adm-btn is-pri" onClick={() => { setNotice(null); setView({ view: 'item', item: null }) }}>+ Add your own item</button> : undefined}
    >
      {error && <Failed message={error} onRetry={() => setTries((n) => n + 1)} />}
      {!error && !data && <Skeleton rows={4} label="Loading the quote menu" />}
      {data && (
        <>
          <p className="adm-note">Everything you sell in Square shows here. Add a cost and tags to help build quotes. Customers never see the cost.</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span className="adm-small adm-muted">{syncedText(data.syncedAt)}</span>
            <button type="button" className="adm-btn is-ghost is-sm" disabled={syncing} onClick={load}>{syncing ? 'Loading…' : 'Load from Square'}</button>
          </div>
          {notice && <p className={notice.warn ? 'adm-warntext' : 'adm-done'} role="status">{notice.text}</p>}
          <button type="button" className="adm-mrow adm-gap-top" onClick={() => { setNotice(null); setView({ view: 'settings' }) }}>
            <span className="adm-rm"><b>Quote settings</b><small>{settingsText(data.settings)}</small></span>
            <span className="adm-chev" aria-hidden="true">›</span>
          </button>

          <h3 className="adm-lbl adm-gap-top">Items</h3>
          <label className="adm-fld">
            <input type="search" aria-label="Search the menu" placeholder="Search by name" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          {tags.length > 0 && (
            <Seg<string> label="Show tag" value={tagFilter} options={[['', 'All'], ...tags.map((t): [string, string] => [t, t])]} onChange={setTagFilter} className="is-scroll" />
          )}
          {shown.length === 0 && <p className="adm-empty">{data.items.length ? 'Nothing matches. Try another word or tag.' : 'Nothing here yet. Tap Load from Square.'}</p>}
          <ul className="adm-mlist" aria-label="Menu items">
            {shown.map((i) => (
              <li key={i.id}>
                <button type="button" className="adm-mrow" style={{ alignItems: 'center', textAlign: 'left' }} onClick={() => { setNotice(null); setView({ view: 'item', item: i }) }}>
                  <span className="adm-thumb" style={{ width: '3.5rem', height: '2.6rem', flex: 'none', borderRadius: '0.4rem', overflow: 'hidden', display: 'grid', placeItems: 'center', background: 'var(--adm-sand)' }}>
                    {i.photoUrl ? <img src={i.photoUrl} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <NoPhoto />}
                  </span>
                  <span className="adm-rm" style={{ flex: 1 }}>
                    <b>{i.name}</b>
                    <small>{[priceText(i.cents, i.per), i.costCents != null ? `Cost ${formatMoney(i.costCents)}` : null].filter(Boolean).join(' · ')}</small>
                    {(i.hidden || i.gone) && (
                      <span>
                        {i.hidden && <span className="adm-tag is-grey" style={{ margin: 0 }}>Hidden</span>}
                        {i.gone && <span className="adm-tag is-red" style={{ marginLeft: i.hidden ? 4 : 0 }}>Gone from Square</span>}
                      </span>
                    )}
                  </span>
                  <span className="adm-chev" aria-hidden="true">›</span>
                </button>
              </li>
            ))}
          </ul>

          <h3 className="adm-lbl adm-gap-top">Saved packages</h3>
          {data.packages.length === 0 && <p className="adm-empty">No saved packages yet. Save one from a quote.</p>}
          <ul className="adm-mlist" aria-label="Saved packages">
            {data.packages.map((p) => <PackageRow key={p.id} pkg={p} onChanged={(packages) => patch({ packages })} />)}
          </ul>
        </>
      )}
    </SheetFrame>
  )
}
