import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import BookingErrorBoundary from '@components/shared/BookingErrorBoundary'
import { _resetBookingTrouble, isForeignFailure, reportBookingTrouble } from '@lib/booking-trouble'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); _resetBookingTrouble() })

function Boom(): never { throw new Error('step broke') }

describe('booking pop-up alarm', () => {
  it('a crashed step shows a way out and reports it once', () => {
    const beacon = vi.fn().mockReturnValue(true)
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<BookingErrorBoundary kind="class"><Boom /></BookingErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent('Something broke on our end.')
    expect(screen.getByRole('link', { name: '(256) 464-1710' })).toHaveAttribute('href', 'sms:+12564641710')
    expect(beacon).toHaveBeenCalledTimes(1)
    expect(beacon.mock.calls[0][0]).toBe('/api/alerts/client.json')
    reportBookingTrouble('class', 'crash', 'again')
    expect(beacon).toHaveBeenCalledTimes(1)
  })

  it('only failures our code did not write count as foreign', () => {
    expect(isForeignFailure(502, null)).toBe(true)
    expect(isForeignFailure(502, { code: 'unavailable' })).toBe(false)
    expect(isForeignFailure(402, null)).toBe(false)
  })
})
