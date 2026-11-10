// tests/components/shop/SilhouetteOrderModal.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
vi.mock('@components/checkout/PaymentForm', async () => {
  const React = await import('react')
  const PaymentForm = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({ tokenize: async () => ({ token: 'tok', kind: 'card' }) }))
    React.useEffect(() => { props.onReadyChange?.(true) }, [])
    return <div>card form</div>
  })
  return { default: PaymentForm }
})
const { cutOut } = vi.hoisted(() => ({ cutOut: vi.fn() }))
vi.mock('@components/shop/silhouette-cutout', () => ({ cutOut, warmUpCutout: vi.fn() }))
beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }))
  cutOut.mockReset()
})
import SilhouetteOrderModal, { canContinue, type SilhouetteItem } from '@components/shop/SilhouetteOrderModal'

const cut = { canvas: {} as HTMLCanvasElement, w: 10, h: 10, person: { x: 0, y: 0, w: 10, h: 10 }, cutY: 9 }
const it1 = (key: string, photoId: string | null = `1700000000000-0000000${key}`): SilhouetteItem =>
  ({ key, photoId, preview: 'x', cut, design: { placement: { x: 0, y: 0, scale: 1 }, text: { name: '', date: '' }, bottom: 'wave-right' as const } })
const btn = (name: RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement
const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }))

describe('SilhouetteOrderModal', () => {
  it('needs at least one saved silhouette', () => {
    expect(canContinue([])).toBe(false)
    expect(canContinue([it1('a'), it1('b', null)])).toBe(false)
    expect(canContinue([it1('a')])).toBe(true)
    render(<SilhouetteOrderModal onClose={vi.fn()} />)
    expect(btn(/^continue/i).disabled).toBe(true)
    expect(btn(/add a silhouette/i)).toBeTruthy()
  })

  it('sends a silhouette order for each child at $25 each', async () => {
    const f = vi.fn(() => json(200, { data: { reference: 'M-ABC234', emailSent: true } }))
    vi.stubGlobal('fetch', f)
    render(<SilhouetteOrderModal onClose={vi.fn()} initialItems={[it1('a'), it1('b')]} />)
    fireEvent.click(btn(/^continue/i))
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Test Person' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'kaden+s@ourhometownstudio.com' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '4029802907' } })
    fireEvent.click(btn(/^continue/i))
    expect(screen.getByText('$54.50')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^pay /i }))
    await waitFor(() => expect(screen.getByText(/your silhouette is ordered/i)).toBeTruthy())
    const body = JSON.parse((f.mock.calls[0] as any)[1].body)
    expect(body).toMatchObject({ product: 'silhouettes', sets: 2, magnets: ['1700000000000-0000000a', '1700000000000-0000000b'] })
  })

  it('explains when nobody is found in the photo', async () => {
    cutOut.mockResolvedValue('nobody')
    const OrigImage = globalThis.Image
    globalThis.Image = class { src = ''; naturalWidth = 10; naturalHeight = 10; decode() { return Promise.resolve() } } as any
    URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn()
    const { container } = render(<SilhouetteOrderModal onClose={vi.fn()} />)
    const input = container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] } })
    expect(await screen.findByText(/could not find anyone/i)).toBeTruthy()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x')
    globalThis.Image = OrigImage
  })

  it('says so when the silhouette maker will not load', async () => {
    cutOut.mockRejectedValue(new Error('offline'))
    const OrigImage = globalThis.Image
    globalThis.Image = class { src = ''; naturalWidth = 10; naturalHeight = 10; decode() { return Promise.resolve() } } as any
    URL.createObjectURL = vi.fn(() => 'blob:y'); URL.revokeObjectURL = vi.fn()
    const { container } = render(<SilhouetteOrderModal onClose={vi.fn()} />)
    fireEvent.change(container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] } })
    expect(await screen.findByText(/did not load/i)).toBeTruthy()
    globalThis.Image = OrigImage
  })
})
