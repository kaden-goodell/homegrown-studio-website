import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TeachForm from '@components/teach/TeachForm'

// The phone shrinks each photo through a canvas; stand that in.
beforeEach(() => {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 3000, height: 2000 })))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as any)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AAAA')
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

function fill(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}
async function addPhoto(n = 1) {
  const input = document.querySelector('input[type=file]') as HTMLInputElement
  const files = Array.from({ length: n }, (_, i) => new File(['x'], `p${i}.jpg`, { type: 'image/jpeg' }))
  fireEvent.change(input, { target: { files } })
  await screen.findAllByAltText(/^Photo \d/)
}

describe('TeachForm (/teach)', () => {
  it('sends the answers and photos, then says thanks with no timeline', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { ok: true } }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<TeachForm />)
    fill(/^Your name/, 'Lou Maker')
    fill(/^Email/, 'lou@example.com')
    fill(/^Phone/, '(256) 555-0100')
    fill(/^What would you teach/, 'Linocut printing')
    fireEvent.click(screen.getByRole('button', { name: 'Adults' }))
    await addPhoto()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Thanks, we got it.')).toBeInTheDocument()
    expect(screen.getByText('We’ll be in touch.')).toBeInTheDocument()
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.about).toMatchObject({ name: 'Lou Maker', email: 'lou@example.com', phone: '(256) 555-0100' })
    expect(body.classIdea).toMatchObject({ what: 'Linocut printing', audience: 'adults' })
    expect(body.photos).toEqual(['data:image/jpeg;base64,AAAA'])
    expect(body.company).toBe('')
  })

  it('asks about drop-off only for kids’ or all-ages classes', () => {
    render(<TeachForm />)
    expect(screen.queryByText(/Could parents drop kids off/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Kids & teens' }))
    expect(screen.getByText(/Could parents drop kids off/)).toBeInTheDocument()
  })

  it('shows the server’s message under the field it names', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Add at least one photo of your work.', field: 'photos' }) }))
    render(<TeachForm />)
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Add at least one photo of your work.')).toBeInTheDocument()
    expect(screen.queryByText('Thanks, we got it.')).toBeNull()
  })

  it('a dropped connection says so, and keeps what they typed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    render(<TeachForm />)
    fill(/^Your name/, 'Lou')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText(/Check your connection/)).toBeInTheDocument()
    expect((screen.getByLabelText(/^Your name/) as HTMLInputElement).value).toBe('Lou')
  })

  it('takes up to six photos, and each can be removed', async () => {
    render(<TeachForm />)
    await addPhoto(8)
    expect(screen.getAllByAltText(/^Photo \d/)).toHaveLength(6)
    expect(screen.queryByText(/Add more photos/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo 1' }))
    await waitFor(() => expect(screen.getAllByAltText(/^Photo \d/)).toHaveLength(5))
  })

  it('offers a fix for a mistyped email domain', () => {
    render(<TeachForm />)
    fill(/^Email/, 'lou@gmial.com')
    fireEvent.click(screen.getByRole('button', { name: 'lou@gmail.com' }))
    expect((screen.getByLabelText(/^Email/) as HTMLInputElement).value).toBe('lou@gmail.com')
  })
})
