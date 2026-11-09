// src/components/shop/MagnetOrderModal.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import BookingPanel from '@components/shared/BookingPanel'
import BookingConfirmed from '@components/shared/BookingConfirmed'
import AddressInput from '@components/shared/AddressInput'
import PaymentForm, { type PaymentFormRef } from '@components/checkout/PaymentForm'
import MagnetCropper from '@components/shop/MagnetCropper'
import { shopConfig, type Delivery } from '@config/shop.config'
import { shopContent } from '@config/shop-content'
import { quoteMagnets } from '@lib/magnet-pricing'
import { formatMoney } from '@lib/money'
import { newAttemptId } from '@lib/checkout-attempt'
import { readAttribution } from '@lib/attribution'
import { posthogId, trackBeginCheckout, trackPaymentCompleted, trackPaymentFailed, type AnalyticsItem } from '@lib/analytics'
import type { Crop, Size } from '@lib/magnet-crop'

/** `upload` ties an in-flight upload to its slot, so a removed or replaced slot is never refilled by a late answer. */
export interface Slot { photoId: string | null; preview: string; quality: 'good' | 'low'; upload?: string }
type Step = 'photos' | 'delivery' | 'pay'
const C = shopContent.modal
const STEP_NAMES: Record<Step, string> = { photos: C.stepPhotos, delivery: C.stepDelivery, pay: C.stepPay }

export function slotsFor(sets: number, current: (Slot | null)[]): (Slot | null)[] {
  const n = sets * shopConfig.magnets.setSize
  return Array.from({ length: n }, (_, i) => current[i] ?? null)
}
export function canContinueFromPhotos(slots: (Slot | null)[]): boolean {
  return slots.length > 0 && slots.every((s) => !!s?.photoId)
}

function uuid(): string { return newAttemptId() }

const magnetItem = (): AnalyticsItem => ({ item_id: 'photo-magnets', item_name: shopConfig.magnets.name, item_category: 'shop', price: shopConfig.magnets.setPriceCents / 100 })

/** `initialSlots` is for tests only: it lets them start with photos already saved. */
export default function MagnetOrderModal({ onClose, initialSlots }: { onClose: () => void; initialSlots?: (Slot | null)[] }) {
  const [draftId] = useState(uuid)
  const [step, setStep] = useState<Step>('photos')
  const [sets, setSets] = useState(1)
  const [slots, setSlots] = useState<(Slot | null)[]>(() => slotsFor(1, initialSlots ?? []))
  const [editing, setEditing] = useState<{ index: number; src: string; size: Size } | null>(null)
  const [delivery, setDelivery] = useState<Delivery>('pickup')
  const [address, setAddress] = useState('')
  const [contact, setContact] = useState({ name: '', email: '', phone: '' })
  const [attemptId, setAttemptId] = useState(uuid)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ reference: string; emailSent: boolean } | null>(null)
  const [askToLeave, setAskToLeave] = useState(false)
  const [paymentReady, setPaymentReady] = useState(false)
  const payRef = useRef<PaymentFormRef>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const pickFor = useRef<number>(0)

  const [unknownOutcome, setUnknownOutcome] = useState(false)
  const quote = useMemo(() => quoteMagnets(sets, delivery), [sets, delivery])
  // A changed order is a new attempt — unless an earlier charge's outcome is still unknown.
  useEffect(() => { if (!unknownOutcome) setAttemptId(uuid()) }, [sets, delivery, address]) // eslint-disable-line react-hooks/exhaustive-deps
  const go = (next: Step) => { setError(null); setStep(next) }
  const uploading = slots.some((s) => s && !s.photoId)
  const changeSets = (n: number) => { const s = Math.min(shopConfig.magnets.maxSets, Math.max(1, n)); setSets(s); setSlots((cur) => slotsFor(s, cur)) }

  function pickPhoto(index: number) { setError(null); pickFor.current = index; fileRef.current?.click() }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const src = URL.createObjectURL(file)
    try {
      // Size from the same <img> the cropper draws, so EXIF rotation always agrees.
      const img = new Image()
      img.src = src
      await img.decode()
      setEditing({ index: pickFor.current, src, size: { w: img.naturalWidth, h: img.naturalHeight } })
    } catch {
      URL.revokeObjectURL(src)
      setError(C.photoWontOpen)
    }
  }
  function closeCropper() {
    if (editing) URL.revokeObjectURL(editing.src)
    setEditing(null)
  }
  async function onCropped(jpeg: string, _crop: Crop, quality: 'good' | 'low') {
    const index = editing!.index
    const upload = uuid()
    closeCropper()
    const mine = (s: Slot | null) => s?.upload === upload
    setSlots((cur) => cur.map((s, i) => (i === index ? { photoId: null, preview: jpeg, quality, upload } : s)))
    try {
      const res = await fetch('/api/shop/magnet-photo.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draftId, image: jpeg }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? C.uploadFailed)
      setSlots((cur) => cur.map((s) => (mine(s) ? { ...s!, photoId: body.data.photoId } : s)))
    } catch (err) {
      setError(err instanceof Error && err.message !== 'Failed to fetch' ? err.message : C.uploadFailed)
      setSlots((cur) => cur.map((s) => (mine(s) ? null : s)))
    }
  }
  function useAgain(index: number) {
    const empty = slots.findIndex((s) => !s)
    if (empty >= 0) setSlots((cur) => cur.map((s, i) => (i === empty ? cur[index] : s)))
  }
  const remove = (index: number) => setSlots((cur) => cur.map((s, i) => (i === index ? null : s)))

  const deliveryValid = contact.name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim()) &&
    /^1?\d{10}$/.test(contact.phone.replace(/\D/g, '')) && (delivery === 'pickup' || address.trim().length >= 8)

  async function pay(e?: React.FormEvent, walletToken?: string) {
    e?.preventDefault()
    if (processing) return
    setProcessing(true); setError(null)
    let token: string
    try {
      token = walletToken ?? (await payRef.current!.tokenize()).token
    } catch {
      setError('Check your card details and try again.')
      setProcessing(false)
      return
    }
    try {
      const res = await fetch('/api/shop/magnet-order.json', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId, attemptId, sets, magnets: slots.map((s) => s!.photoId), delivery, address, contact, paymentToken: token, attribution: readAttribution(), posthogId: posthogId() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body?.detail ?? 'Something went wrong. Try again.')
        trackPaymentFailed(body?.code ?? `http_${res.status}`)
        if (body?.code === 'unknown_outcome') { setUnknownOutcome(true); return } // keep the attempt id: a retry must find the same charge
        if (Array.isArray(body?.missingPhotos)) {
          const gone = new Set<string>(body.missingPhotos)
          setSlots((cur) => cur.map((sl) => (sl?.photoId && gone.has(sl.photoId) ? null : sl)))
          setStep('photos') // keep the error showing on the photos step
        }
        setUnknownOutcome(false)
        setAttemptId(uuid()) // we know nothing was charged
        return
      }
      setUnknownOutcome(false)
      trackPaymentCompleted(quote.totalCents / 100, { kind: 'shop', transactionId: body.data.reference, items: [magnetItem()], extra: { sets } })
      setDone({ reference: body.data.reference, emailSent: !!body.data.emailSent })
    } catch {
      // The card was read; the order request never came back. It may or may not have charged.
      setUnknownOutcome(true)
      setError(C.connectionLost)
    } finally { setProcessing(false) }
  }

  const footer = done ? (
    <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
  ) : step === 'photos' ? (
    <button type="button" className="btn btn-primary" disabled={!canContinueFromPhotos(slots)} onClick={() => go('delivery')}>{uploading ? C.uploading : 'Continue'}</button>
  ) : step === 'delivery' ? (
    <button type="button" className="btn btn-primary" disabled={!deliveryValid} onClick={() => { trackBeginCheckout('shop', quote.totalCents / 100, [magnetItem()], { sets }); go('pay') }}>Continue</button>
  ) : (
    <button type="submit" form="magnet-pay" className="btn btn-primary" disabled={processing || !paymentReady}>{processing ? 'Processing…' : `Pay ${formatMoney(quote.totalCents)}`}</button>
  )

  const input = { width: '100%', padding: '0.7rem 0.8rem', borderRadius: 10, border: '1px solid rgba(122,74,46,0.25)', fontSize: '1rem' } as const

  return (
    <BookingPanel
      title={C.title}
      onRequestClose={done ? onClose : () => { if (!processing) setAskToLeave(true) }}
      stepKey={done ? 'confirmed' : editing ? 'crop' : step}
      stepName={done ? undefined : STEP_NAMES[step]}
      stepNumber={done ? undefined : step === 'photos' ? 1 : step === 'delivery' ? 2 : 3}
      stepCount={done ? undefined : 3}
      summary={done ? undefined : <p style={{ margin: 0 }}>{quote.magnets} magnets · {formatMoney(quote.subtotalCents)}</p>}
      onBack={!done && !editing && step !== 'photos' && !processing && !unknownOutcome ? () => go(step === 'pay' ? 'delivery' : 'photos') : undefined}
      footer={editing ? undefined : footer}
      leavePrompt={askToLeave && !done ? { title: C.leaveTitle, body: C.leaveBody, keepLabel: C.keep, leaveLabel: C.leave, onKeep: () => setAskToLeave(false), onLeave: onClose } : null}
    >
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
      {error && <p role="alert" style={{ color: '#9a3412', margin: '0 0 0.75rem' }}>{error}</p>}
      {done ? (
        <BookingConfirmed heading={C.confirmedHeading} what={<>{quote.magnets} photo magnets · order {done.reference}</>} email={contact.email} emailSent={done.emailSent}>
          <p>{delivery === 'pickup' ? C.readyPickup : C.readyShip}</p>
        </BookingConfirmed>
      ) : editing ? (
        <MagnetCropper src={editing.src} size={editing.size} onDone={onCropped} onCancel={closeCropper} />
      ) : step === 'photos' ? (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span>{C.setsLabel}</span>
            <button type="button" className="btn btn-secondary" aria-label="Fewer magnets" onClick={() => changeSets(sets - 1)} disabled={sets <= 1}>−</button>
            <strong>{quote.magnets}</strong>
            <button type="button" className="btn btn-secondary" aria-label="More magnets" onClick={() => changeSets(sets + 1)} disabled={sets >= shopConfig.magnets.maxSets}>+</button>
          </div>
          <p style={{ margin: 0, fontSize: '0.9rem' }}>{C.photosHint}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.6rem' }}>
            {slots.map((s, i) => s ? (
              <div key={i} style={{ position: 'relative' }}>
                <img src={s.preview} alt={`Magnet ${i + 1}`} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 6, opacity: s.photoId ? 1 : 0.5 }} />
                {s.quality === 'low' && <span title={C.blurryWarning} style={{ position: 'absolute', top: 4, left: 4, background: '#fff7ed', color: '#9a3412', borderRadius: 999, padding: '0 6px', fontSize: 12 }}>!</span>}
                <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
                  <button type="button" className="btn btn-secondary" style={{ padding: '0.45rem 0.5rem', fontSize: 13 }} onClick={() => useAgain(i)} disabled={!s.photoId || slots.every(Boolean)}>{C.usePhotoAgain}</button>
                  <button type="button" className="btn btn-secondary" style={{ padding: '0.45rem 0.5rem', fontSize: 13 }} onClick={() => remove(i)}>{C.remove}</button>
                </div>
              </div>
            ) : (
              <button key={i} type="button" aria-label="Add photo" onClick={() => pickPhoto(i)} style={{ aspectRatio: '1', borderRadius: 6, border: '2px dashed rgba(122,74,46,0.35)', background: 'transparent', fontSize: 28, color: 'var(--color-primary)' }}>+</button>
            ))}
          </div>
        </div>
      ) : step === 'delivery' ? (
        <div style={{ display: 'grid', gap: '0.8rem' }}>
          {(['pickup', 'ship'] as const).map((d) => (
            <label key={d} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
              <input type="radio" name="delivery" checked={delivery === d} onChange={() => setDelivery(d)} />
              <span><strong>{d === 'pickup' ? C.pickupLabel : C.shipLabel}</strong><br /><small>{d === 'pickup' ? C.pickupNote : C.shipNote}</small></span>
            </label>
          ))}
          {delivery === 'ship' && <label>{C.addressLabel}<AddressInput value={address} onChange={setAddress} style={input} /></label>}
          <label>{C.nameLabel}<input style={input} value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} autoComplete="name" /></label>
          <label>{C.emailLabel}<input style={input} type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} autoComplete="email" /></label>
          <label>{C.phoneLabel}<input style={input} type="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} autoComplete="tel" /></label>
        </div>
      ) : (
        <form id="magnet-pay" onSubmit={pay} style={{ display: 'grid', gap: '0.75rem' }}>
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.25rem 1rem', margin: 0 }}>
            <dt>{quote.magnets} magnets</dt><dd style={{ margin: 0 }}>{formatMoney(quote.subtotalCents)}</dd>
            <dt>Tax</dt><dd style={{ margin: 0 }}>{formatMoney(quote.taxCents)}</dd>
            {quote.shippingCents > 0 && (<><dt>Shipping</dt><dd style={{ margin: 0 }}>{formatMoney(quote.shippingCents)}</dd></>)}
            <dt><strong>Total</strong></dt><dd style={{ margin: 0 }}><strong>{formatMoney(quote.totalCents)}</strong></dd>
          </dl>
          <PaymentForm ref={payRef} bookingKind="shop" environmentOverride="production" onReadyChange={setPaymentReady}
            wallet={{ amount: (quote.totalCents / 100).toFixed(2), label: 'Hometown Photo Magnets' }}
            onWalletToken={(t) => pay(undefined, t)} canPayWithWallet={() => (processing ? 'Paying…' : null)} />
        </form>
      )}
    </BookingPanel>
  )
}
