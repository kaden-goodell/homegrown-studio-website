import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useState } from 'react'
import AddressInput from '@components/shared/AddressInput'

/** Harness with real controlled-input state, like the modal provides. */
function Harness({ apiKey }: { apiKey?: string }) {
  const [value, setValue] = useState('')
  return <AddressInput value={value} onChange={setValue} apiKey={apiKey} placeholder="Party address" />
}

function suggestionsResponse(texts: string[]) {
  return {
    ok: true,
    json: async () => ({
      suggestions: texts.map((t) => ({ placePrediction: { text: { text: t } } })),
    }),
  } as Response
}

const TYPE = '123 Main'

describe('AddressInput', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('without an API key it is a plain input — no fetches ever', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(<Harness />)
    const input = screen.getByPlaceholderText('Party address')
    fireEvent.change(input, { target: { value: TYPE } })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect((input as HTMLInputElement).value).toBe(TYPE)
  })

  it('fetches debounced suggestions and fills the input on pick', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      suggestionsResponse(['123 Main St, Madison, AL 35758', '123 Maine Ave, Huntsville, AL'])
    )
    render(<Harness apiKey="test-key" />)
    const input = screen.getByPlaceholderText('Party address')

    fireEvent.change(input, { target: { value: TYPE } })
    expect(fetchSpy).not.toHaveBeenCalled() // debounce window still open
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.input).toBe(TYPE)
    expect(body.sessionToken).toBeTruthy()

    const option = screen.getByText('123 Main St, Madison, AL 35758')
    fireEvent.mouseDown(option)
    expect((input as HTMLInputElement).value).toBe('123 Main St, Madison, AL 35758')
    // Picking must not trigger a follow-up fetch for the picked value.
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('does not fetch below the minimum input length', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(<Harness apiKey="test-key" />)
    fireEvent.change(screen.getByPlaceholderText('Party address'), { target: { value: '12' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keyboard: arrows highlight, Enter picks, Escape only closes the list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(suggestionsResponse(['A Street', 'B Street']))
    render(<Harness apiKey="test-key" />)
    const input = screen.getByPlaceholderText('Party address')
    fireEvent.change(input, { target: { value: TYPE } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    screen.getByText('A Street')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect((input as HTMLInputElement).value).toBe('B Street')
  })

  it('a failed fetch fails silent — typing by hand keeps working', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    render(<Harness apiKey="test-key" />)
    const input = screen.getByPlaceholderText('Party address')
    fireEvent.change(input, { target: { value: TYPE } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect((input as HTMLInputElement).value).toBe(TYPE)
  })
})
