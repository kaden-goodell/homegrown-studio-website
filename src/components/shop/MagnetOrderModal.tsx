// src/components/shop/MagnetOrderModal.tsx
import { useMemo, useRef, useState } from 'react'
import BookingPanel from '@components/shared/BookingPanel'
import BookingConfirmed from '@components/shared/BookingConfirmed'
import MagnetCropper from '@components/shop/MagnetCropper'
import { DeliveryFields, PayButton, PayStep, deliveryValid, useShopPay, type Contact } from '@components/shop/shop-checkout'
import { shopConfig, type Delivery } from '@config/shop.config'
import { shopContent } from '@config/shop-content'
import { quoteMagnets } from '@lib/magnet-pricing'
import { formatMoney } from '@lib/money'
import { newAttemptId } from '@lib/checkout-attempt'
import { trackBeginCheckout, type AnalyticsItem } from '@lib/analytics'
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
  const [contact, setContact] = useState<Contact>({ name: '', email: '', phone: '' })
  const [askToLeave, setAskToLeave] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const pickFor = useRef<number>(0)

  const quote = useMemo(() => quoteMagnets(sets, delivery), [sets, delivery])
  const shop = useShopPay({
    product: 'magnets', draftId, sets, items: slots.map((s) => s?.photoId ?? null), delivery, address, contact, quote, analyticsItem: magnetItem(),
    onMissing: (gone) => {
      setSlots((cur) => cur.map((sl) => (sl?.photoId && gone.has(sl.photoId) ? null : sl)))
      setStep('photos') // keep the error showing on the photos step
    },
  })
  const { processing, error, setError, unknownOutcome, done } = shop
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

  const footer = done ? (
    <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
  ) : step === 'photos' ? (
    <button type="button" className="btn btn-primary" disabled={!canContinueFromPhotos(slots)} onClick={() => go('delivery')}>{uploading ? C.uploading : 'Continue'}</button>
  ) : step === 'delivery' ? (
    <button type="button" className="btn btn-primary" disabled={!deliveryValid(delivery, address, contact)} onClick={() => { trackBeginCheckout('shop', quote.totalCents / 100, [magnetItem()], { sets }); go('pay') }}>Continue</button>
  ) : (
    <PayButton formId="magnet-pay" quote={quote} shop={shop} />
  )

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
        <DeliveryFields delivery={delivery} setDelivery={setDelivery} address={address} setAddress={setAddress} contact={contact} setContact={setContact} />
      ) : (
        <PayStep formId="magnet-pay" itemsLine={`${quote.magnets} magnets`} quote={quote} shop={shop} walletLabel="Hometown Photo Magnets" />
      )}
    </BookingPanel>
  )
}
