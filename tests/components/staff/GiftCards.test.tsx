import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import GiftCards from '@components/staff/GiftCards'
import type { StaffMember } from '@lib/staff-auth'

const staff: StaffMember = { id: 't', name: 'Test', role: 'crew' }

const row = (o: Record<string, any> = {}) => ({
  id: 'gc_1',
  giftCardId: 'sq_1',
  gan: '7783325239652851',
  amountCents: 2500,
  forWhom: 'Megan',
  note: '',
  by: { id: 't', name: 'Test' },
  at: '2026-10-08T15:00:00.000Z',
  balanceCents: 0,
  state: 'ACTIVE',
  ...o,
})

function mockApi(post: { status: number; body: any }, list: any[] = []) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, init?: any) => {
    if (init?.method === 'POST') {
      return { ok: post.status < 300, status: post.status, json: async () => post.body } as Response
    }
    return { ok: true, status: 200, json: async () => ({ data: { cards: list } }) } as Response
  })
}

function renderScreen() {
  return render(<GiftCards staff={staff} onSwitch={vi.fn()} onKits={vi.fn()} onLogout={vi.fn()} onBack={vi.fn()} />)
}

describe('GiftCards', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('renders the amount chips', async () => {
    mockApi({ status: 200, body: {} })
    renderScreen()
    for (const l of ['$10', '$25', '$50', '$100']) expect(screen.getByRole('button', { name: l })).toBeTruthy()
    await waitFor(() => expect(screen.getByText('No gift cards made yet.')).toBeTruthy())
  })

  it('mints a card and shows the number grouped in fours', async () => {
    const spy = mockApi({ status: 200, body: { data: { card: row(), balanceCents: 2500 } } })
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: '$25' }))
    fireEvent.change(screen.getByLabelText('For whom'), { target: { value: 'Megan' } })
    fireEvent.click(screen.getByRole('button', { name: 'Make card' }))
    await waitFor(() => expect(screen.getByTestId('gift-card-number').textContent).toBe('7783 3252 3965 2851'))
    const post = spy.mock.calls.find(([, i]) => (i as any)?.method === 'POST')!
    expect(JSON.parse((post[1] as any).body)).toEqual({ amountDollars: 25, forWhom: 'Megan', note: '' })
    expect(screen.getByText(/Hand this number to them/)).toBeTruthy()
  })

  it('lists cards with their balance, or "balance unavailable"', async () => {
    mockApi({ status: 200, body: {} }, [row(), row({ id: 'gc_2', forWhom: 'Sam', balanceCents: null })])
    renderScreen()
    await waitFor(() => expect(screen.getByText(/\$0\.00 left/)).toBeTruthy())
    expect(screen.getByText(/balance unavailable/)).toBeTruthy()
  })

  it("shows the server's error on a 400", async () => {
    mockApi({ status: 400, body: { error: 'Say who it is for.' } })
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: '$10' }))
    fireEvent.click(screen.getByRole('button', { name: 'Make card' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Say who it is for.'))
  })

  it('refuses an amount the server would refuse, without calling it', async () => {
    const spy = mockApi({ status: 200, body: {} })
    renderScreen()
    for (const value of ['12.5', '501', '0']) {
      fireEvent.change(screen.getByLabelText('Other amount'), { target: { value } })
      fireEvent.click(screen.getByRole('button', { name: 'Make card' }))
      expect(screen.getByRole('alert').textContent).toMatch(/whole-dollar amount from \$1 to \$500/)
    }
    expect(spy.mock.calls.some(([, i]) => (i as any)?.method === 'POST')).toBe(false)
  })

  it('says the number is selected when the clipboard is unavailable', async () => {
    mockApi({ status: 200, body: { data: { card: row(), balanceCents: 2500 } } })
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    try {
      renderScreen()
      fireEvent.click(screen.getByRole('button', { name: '$25' }))
      fireEvent.change(screen.getByLabelText('For whom'), { target: { value: 'Megan' } })
      fireEvent.click(screen.getByRole('button', { name: 'Make card' }))
      await waitFor(() => expect(screen.getByTestId('gift-card-number')).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
      await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Selected/))
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original)
      else delete (navigator as any).clipboard
    }
  })

  it('offers a text link and shows a listed card’s number again', async () => {
    mockApi({ status: 200, body: {} }, [row()])
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Show the number for Megan' }))
    expect(screen.getByTestId('gift-card-number').textContent).toBe('7783 3252 3965 2851')
    const link = screen.getByRole('link', { name: 'Text it' }) as HTMLAnchorElement
    expect(decodeURIComponent(link.getAttribute('href')!)).toContain('7783 3252 3965 2851')
  })
})
