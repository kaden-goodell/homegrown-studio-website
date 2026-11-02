import { createContext, useContext, useEffect, useState } from 'react'
import { OWNERS, type Owner } from '@lib/admin-who'
import { api, SEED } from '../classes/api'
import { Seg, Skeleton } from '../shell/items'
import { SheetFrame, useSheet } from '../shell/Sheet'
import { useToast } from '../shell/Toast'

/** Who is using /admin, and how to change it (More › Using as). */
export const WhoContext = createContext<{ who: Owner | null; setWho: (o: Owner) => void }>({ who: null, setWho: () => {} })

export function ComingSheet({ title, stage, what }: { title: string; stage: number; what: string }) {
  return (
    <SheetFrame title={title} subtitle={<span className="adm-tag" style={{ margin: 0 }}>Coming in stage {stage}</span>}>
      <p className="adm-note">Coming soon: {what}</p>
    </SheetFrame>
  )
}

export { ReportsSheet } from './ReportsSheet'

/** Change who is using /admin on this device. */
export function WhoSheet() {
  const { who, setWho } = useContext(WhoContext)
  const toast = useToast()
  return (
    <SheetFrame title="Who’s using this?" subtitle="Changes you make are saved under this name.">
      <Seg
        label="Who’s using this?"
        value={who ?? ''}
        options={OWNERS.map((o) => [o, o] as [string, string])}
        onChange={(o) => { setWho(o as Owner); toast(`Now using as ${o}.`) }}
      />
    </SheetFrame>
  )
}

interface Seeded { classesCategoryId: string; classTaxId: string; commands: string[] }

/** The test site only: make the Classes category and the 9% sales tax in the Square sandbox. */
export function SandboxSheet() {
  const { close } = useSheet()
  /** Only the sandbox may run it: the sheet asks first, so an address typed on the live site shows nothing to press. */
  const [sandbox, setSandbox] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    api<{ sandbox: boolean }>(SEED).then((r) => { if (live) setSandbox(r.ok && r.data?.sandbox === true) })
    return () => { live = false }
  }, [])
  const [seed, setSeed] = useState<Seeded | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true)
    setError('')
    const r = await api<Seeded>(SEED, {})
    setBusy(false)
    if (r.ok && r.data) setSeed(r.data)
    else setError(r.error ?? '')
  }
  if (sandbox !== true) {
    return (
      <SheetFrame title="Set up sandbox" subtitle="For the test site only">
        {sandbox === null ? <Skeleton rows={1} /> : <p className="adm-note">Only on the test site. This site uses the live Square account, so there is nothing to set up here.</p>}
      </SheetFrame>
    )
  }
  return (
    <SheetFrame
      title="Set up sandbox"
      subtitle="For the test site only"
      footer={seed
        ? <button type="button" className="adm-btn is-ghost" onClick={close}>Done</button>
        : <button type="button" className="adm-btn is-pri" disabled={busy} onClick={run}>{busy ? 'Setting up…' : 'Set up sandbox'}</button>}
    >
      <p className="adm-note">Makes the Classes category and the 9% sales tax in the Square sandbox.</p>
      {error && <p className="adm-error" role="alert">{error}</p>}
      {seed && (
        <div className="adm-card">
          <p>{`Category ${seed.classesCategoryId} · Tax ${seed.classTaxId}`}</p>
          <p>Run these, then redeploy the branch.</p>
          {seed.commands.map((cmd) => <code key={cmd} style={{ display: 'block', overflowWrap: 'anywhere', userSelect: 'all', fontSize: '0.85rem' }}>{cmd}</code>)}
        </div>
      )}
    </SheetFrame>
  )
}
