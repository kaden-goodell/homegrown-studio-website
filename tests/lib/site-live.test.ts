// The prerendered pages' footer walk-in hours and Google business details follow the hours saved on /admin.
import { describe, it, expect } from 'vitest'
import { applyBusinessHours, applyWalkInHours } from '@lib/site-live'

const page = (jsonLd: object, from = '2026-11-07T00:00:00-06:00') => {
  document.body.innerHTML = `
    <dl class="footer-hours" data-walkin-hours><div class="footer-hours-row"><dt>Thursday</dt><dd>6 – 8 PM</dd></div></dl>
    <script type="application/ld+json" data-business-jsonld data-hours-from="${from}">${JSON.stringify(jsonLd)}</script>`
}
const ld = () => JSON.parse(document.querySelector('script[data-business-jsonld]')!.textContent!)

describe('site-live', () => {
  it('the footer lists the saved Craft Café walk-in hours', () => {
    page({})
    applyWalkInHours(document, [{ days: 'Wednesday & Friday', time: '4 – 9 PM' }, { days: 'Sunday', time: '10 AM – 8 PM' }])
    expect([...document.querySelectorAll('.footer-hours-row')].map((r) => r.textContent)).toEqual(['Wednesday & Friday4 – 9 PM', 'Sunday10 AM – 8 PM'])
  })

  it('nothing sent: the footer keeps what it was built with', () => {
    page({})
    applyWalkInHours(document, [])
    expect(document.querySelector('.footer-hours-row')!.textContent).toBe('Thursday6 – 8 PM')
  })

  it('Google’s business details get the saved hours once walk-ins have started, not before', () => {
    const hours = [{ days: ['Sunday' as const], opens: '10:00', closes: '20:00' }]
    page({ '@type': 'LocalBusiness', name: 'Hometown Studio' })
    applyBusinessHours(document, hours, Date.parse('2026-11-02T12:00:00Z'))
    expect(ld()).not.toHaveProperty('openingHoursSpecification')
    applyBusinessHours(document, hours, Date.parse('2026-11-08T12:00:00Z'))
    expect(ld().openingHoursSpecification).toEqual([{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Sunday'], opens: '10:00', closes: '20:00' }])
    expect(ld().name).toBe('Hometown Studio')
  })

  it('a page already publishing hours gets the saved ones replaced in', () => {
    page({ openingHoursSpecification: [{ dayOfWeek: ['Thursday'], opens: '18:00', closes: '20:00' }] }, 'not a date')
    applyBusinessHours(document, [{ days: ['Wednesday'], opens: '16:00', closes: '21:00' }])
    expect(ld().openingHoursSpecification[0]).toMatchObject({ dayOfWeek: ['Wednesday'], opens: '16:00' })
  })
})
