// tests/components/admin/HomeWarnings.test.tsx — Home › Warnings (final review C1): each line with its button.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { HomeWarnings, WARNINGS } from '@components/admin/HomeWarnings'

const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

afterEach(() => vi.unstubAllGlobals())

describe('Home › Warnings', () => {
  it('lists each warning with its button, and the button opens the right screen', async () => {
    const fetch = vi.fn((url: string) => (url === WARNINGS ? reply({ data: { warnings: [
      { code: 'register-setup-missing', line: 'No class tax is picked yet.', open: { kind: 'more', page: 'register' }, button: 'Open Register setup' },
      { code: 'two-parties', line: 'Sat Oct 24 · Two parties at once.', open: { kind: 'party', day: '2026-10-24', id: 'pty_1' }, button: 'Open the party' },
      { code: 'party-hold-no-party', line: 'A held party time.', open: { kind: 'todo-list' }, button: 'Open To decide' },
    ] } }) : reply({}, 404)))
    vi.stubGlobal('fetch', fetch)
    const onOpen = vi.fn(), onInbox = vi.fn()
    render(<HomeWarnings onOpen={onOpen} onInbox={onInbox} />)
    expect(await screen.findByText('Warnings (3)')).toBeInTheDocument()
    expect(screen.getByText('No class tax is picked yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Register setup' }))
    expect(onOpen).toHaveBeenCalledWith({ kind: 'more', page: 'register' })
    fireEvent.click(screen.getByRole('button', { name: 'Open the party' }))
    expect(onOpen).toHaveBeenLastCalledWith({ kind: 'party', day: '2026-10-24', id: 'pty_1' })
    fireEvent.click(screen.getByRole('button', { name: 'Open To decide' }))
    expect(onInbox).toHaveBeenCalledWith('todo')
  })

  it('says nothing when all is clear, and says it couldn’t check (with Try again) when the scan fails', async () => {
    let fail = true
    vi.stubGlobal('fetch', vi.fn(() => (fail ? reply({ error: 'Couldn’t check the schedule for warnings. Try again.' }, 503) : reply({ data: { warnings: [] } }))))
    const { container } = render(<HomeWarnings onOpen={vi.fn()} onInbox={vi.fn()} />)
    expect(await screen.findByText('Couldn’t check the schedule for warnings. Try again.')).toBeInTheDocument()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
