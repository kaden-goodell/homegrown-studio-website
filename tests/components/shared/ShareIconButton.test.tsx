import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ShareIconButton from '../../../src/components/shared/ShareIconButton'

vi.mock('@lib/analytics', () => ({ trackShare: vi.fn() }))

const props = { url: 'https://ourhometownstudio.com/workshops?w=abc', title: 'Christmas Tags at Hometown Studio', text: 'Christmas Tags, Sun, Nov 22', contentType: 'workshop', itemId: 'abc', label: 'Share this class' }

afterEach(() => {
  vi.unstubAllGlobals()
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
})

describe('ShareIconButton', () => {
  it('opens the phone share sheet with the class link', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    render(<ShareIconButton {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share this class' }))
    await waitFor(() => expect(share).toHaveBeenCalledWith({ title: props.title, text: props.text, url: props.url }))
    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  it('copies the link where there is no share sheet, and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<ShareIconButton {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share this class' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Link copied.'))
    expect(writeText).toHaveBeenCalledWith(props.url)
  })

  it('says nothing when the share sheet is closed', async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error('closed'), { name: 'AbortError' }))
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    render(<ShareIconButton {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share this class' }))
    await waitFor(() => expect(share).toHaveBeenCalled())
    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  it('shows the link to copy by hand when copying is refused', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('no')) }, configurable: true })
    render(<ShareIconButton {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share this class' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(`Copy this link: ${props.url}`))
  })
})
