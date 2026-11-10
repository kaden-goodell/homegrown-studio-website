// src/components/shop/SilhouetteOrderModal.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import BookingPanel from '@components/shared/BookingPanel'
import BookingConfirmed from '@components/shared/BookingConfirmed'
import SilhouetteEditor, { type SilhouetteDesign } from '@components/shop/SilhouetteEditor'
import { cutOut, warmUpCutout, type Cutout } from '@components/shop/silhouette-cutout'
import { DeliveryFields, PayButton, PayStep, deliveryValid, useShopPay, type Contact } from '@components/shop/shop-checkout'
import { shopConfig, type Delivery } from '@config/shop.config'
import { shopContent } from '@config/shop-content'
import { quoteSilhouettes } from '@lib/magnet-pricing'
import { formatMoney } from '@lib/money'
import { newAttemptId } from '@lib/checkout-attempt'
import { trackBeginCheckout, type AnalyticsItem } from '@lib/analytics'

const C = shopContent.silhouetteModal
const M = shopContent.modal
type Step = 'portraits' | 'delivery' | 'pay'
const STEP_NAMES: Record<Step, string> = { portraits: C.stepPortraits, delivery: M.stepDelivery, pay: M.stepPay }

/** One silhouette: the finished card (uploaded once `photoId` is set) and what it was made from, for re-editing. */
export interface SilhouetteItem { key: string; photoId: string | null; preview: string; upload?: string; cut: Cutout; design: SilhouetteDesign }

const item = (): AnalyticsItem => ({ item_id: 'framed-silhouette', item_name: shopConfig.silhouettes.name, item_category: 'shop', price: shopConfig.silhouettes.priceCents / 100 })
export const canContinue = (items: SilhouetteItem[]) => items.length > 0 && items.every((i) => !!i.photoId)

/** `initialItems` is for tests only. */
export default function SilhouetteOrderModal({ onClose, initialItems }: { onClose: () => void; initialItems?: SilhouetteItem[] }) {
  const [draftId] = useState(newAttemptId)
  const [step, setStep] = useState<Step>('portraits')
  const [items, setItems] = useState<SilhouetteItem[]>(initialItems ?? [])
  const [editing, setEditing] = useState<{ key: string | null; cut: Cutout; design?: SilhouetteDesign } | null>(null)
  const [making, setMaking] = useState(false)
  const [delivery, setDelivery] = useState<Delivery>('pickup')
  const [address, setAddress] = useState('')
  const [contact, setContact] = useState<Contact>({ name: '', email: '', phone: '' })
  const [askToLeave, setAskToLeave] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { warmUpCutout() }, [])
  const count = Math.max(1, items.length)
  const quote = useMemo(() => quoteSilhouettes(count, delivery), [count, delivery])
  const shop = useShopPay({
    product: 'silhouettes', draftId, sets: items.length, items: items.map((i) => i.photoId), delivery, address, contact, quote, analyticsItem: item(),
    onMissing: (gone) => {
      setItems((cur) => cur.map((i) => (i.photoId && gone.has(i.photoId) ? { ...i, photoId: null, upload: undefined } : i)))
      setStep('portraits')
    },
  })
  const { processing, error, setError, unknownOutcome, done } = shop
  const go = (next: Step) => { setError(null); setStep(next) }
  const uploading = items.some((i) => i.upload && !i.photoId)
  const lost = items.some((i) => !i.upload && !i.photoId)

  function pick() { setError(null); fileRef.current?.click() }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const src = URL.createObjectURL(file)
    setMaking(true)
    try {
      const img = new Image()
      img.src = src
      try { await img.decode() } catch { setError(M.photoWontOpen); return }
      let cut: Awaited<ReturnType<typeof cutOut>>
      try { cut = await cutOut(img) } catch { setError(C.loadFailed); return }
      if (cut === 'nobody') { setError(C.nobody); return }
      if (cut === 'busy') { setError(C.busy); return }
      setEditing({ key: null, cut })
    } finally {
      URL.revokeObjectURL(src)
      setMaking(false)
    }
  }

  async function onEdited(jpeg: string, design: SilhouetteDesign) {
    const { key: existing, cut } = editing!
    const key = existing ?? newAttemptId()
    const upload = newAttemptId()
    setEditing(null)
    const next: SilhouetteItem = { key, photoId: null, preview: jpeg, upload, cut, design }
    setItems((cur) => (existing ? cur.map((i) => (i.key === key ? next : i)) : [...cur, next]))
    const mine = (i: SilhouetteItem) => i.upload === upload
    try {
      const res = await fetch('/api/shop/magnet-photo.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draftId, image: jpeg }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? M.uploadFailed)
      setItems((cur) => cur.map((i) => (mine(i) ? { ...i, photoId: body.data.photoId } : i)))
    } catch (err) {
      setError(err instanceof Error && err.message !== 'Failed to fetch' ? err.message : M.uploadFailed)
      setItems((cur) => cur.map((i) => (mine(i) ? { ...i, upload: undefined } : i))) // kept, marked unsaved: Edit → Done retries
    }
  }
  const remove = (key: string) => setItems((cur) => cur.filter((i) => i.key !== key))
  const full = items.length >= shopConfig.silhouettes.maxCount

  const footer = done ? (
    <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
  ) : step === 'portraits' ? (
    <button type="button" className="btn btn-primary" disabled={!canContinue(items)} onClick={() => go('delivery')}>{uploading ? M.uploading : 'Continue'}</button>
  ) : step === 'delivery' ? (
    <button type="button" className="btn btn-primary" disabled={!deliveryValid(delivery, address, contact)} onClick={() => { trackBeginCheckout('shop', quote.totalCents / 100, [item()], { sets: items.length }); go('pay') }}>Continue</button>
  ) : (
    <PayButton formId="silhouette-pay" quote={quote} shop={shop} />
  )
  const label = (n: number) => `${n} framed silhouette${n === 1 ? '' : 's'}`

  return (
    <BookingPanel
      title={C.title}
      onRequestClose={done ? onClose : () => { if (!processing) setAskToLeave(true) }}
      stepKey={done ? 'confirmed' : editing ? 'edit' : step}
      stepName={done ? undefined : STEP_NAMES[step]}
      stepNumber={done ? undefined : step === 'portraits' ? 1 : step === 'delivery' ? 2 : 3}
      stepCount={done ? undefined : 3}
      summary={done || !items.length ? undefined : <p style={{ margin: 0 }}>{label(items.length)} · {formatMoney(quote.subtotalCents)}</p>}
      onBack={!done && !editing && step !== 'portraits' && !processing && !unknownOutcome ? () => go(step === 'pay' ? 'delivery' : 'portraits') : undefined}
      footer={editing ? undefined : footer}
      leavePrompt={askToLeave && !done ? { title: M.leaveTitle, body: C.leaveBody, keepLabel: M.keep, leaveLabel: M.leave, onKeep: () => setAskToLeave(false), onLeave: onClose } : null}
    >
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
      {error && <p role="alert" style={{ color: '#9a3412', margin: '0 0 0.75rem' }}>{error}</p>}
      {done ? (
        <BookingConfirmed heading={C.confirmedHeading} what={<>{label(items.length)} · order {done.reference}</>} email={contact.email} emailSent={done.emailSent}>
          <p>{delivery === 'pickup' ? C.readyPickup : C.readyShip}</p>
        </BookingConfirmed>
      ) : editing ? (
        <SilhouetteEditor cut={editing.cut} initial={editing.design} onDone={onEdited} onCancel={() => setEditing(null)} />
      ) : step === 'portraits' ? (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <p style={{ margin: 0, fontSize: '0.9rem' }}>{C.photoTips}</p>
          {items.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.6rem' }}>
              {items.map((i, n) => (
                <div key={i.key}>
                  <img src={i.preview} alt={`Silhouette ${n + 1}`} style={{ width: '100%', aspectRatio: '2 / 3', objectFit: 'cover', borderRadius: 4, boxShadow: '0 0 0 1px rgba(0,0,0,0.12)', opacity: i.photoId ? 1 : 0.5 }} />
                  <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
                    <button type="button" className="btn btn-secondary" style={{ padding: '0.45rem 0.5rem', fontSize: 13 }} onClick={() => setEditing({ key: i.key, cut: i.cut, design: i.design })} disabled={!!i.upload && !i.photoId}>{C.edit}</button>
                    <button type="button" className="btn btn-secondary" style={{ padding: '0.45rem 0.5rem', fontSize: 13 }} onClick={() => remove(i.key)}>{C.remove}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {making ? (
            <p role="status" style={{ margin: 0 }}>{C.making} <small>{C.firstTime}</small></p>
          ) : !full && (
            <button type="button" className="btn btn-secondary" onClick={pick} style={{ justifySelf: 'start' }}>{items.length ? C.addAnother : C.add}</button>
          )}
          {lost && <p style={{ margin: 0, fontSize: '0.85rem', color: '#9a3412' }}>{M.uploadFailed}</p>}
        </div>
      ) : step === 'delivery' ? (
        <DeliveryFields delivery={delivery} setDelivery={setDelivery} address={address} setAddress={setAddress} contact={contact} setContact={setContact} pickupNote={C.pickupNote} />
      ) : (
        <PayStep formId="silhouette-pay" itemsLine={label(items.length)} quote={quote} shop={shop} walletLabel="Hometown Framed Silhouettes" />
      )}
    </BookingPanel>
  )
}
