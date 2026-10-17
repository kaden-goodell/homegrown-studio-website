// A complete /private-events request, as the form sends it.
export const PHOTO = `data:image/jpeg;base64,${Buffer.from('fake-jpeg-bytes').toString('base64')}`
/** Noon Central on Sat 17 Oct 2026. */
export const NOW = new Date('2026-10-17T17:00:00Z')
export const goodBody = (over: any = {}) => ({
  event: { kind: 'team', kindOther: '', date: '2026-11-21', backupDate: '2026-11-22', flexible: true, startTime: '14:00', length: '2 hours', guests: '18', crafters: 'adults', youngest: '' },
  where: { place: 'yours', address: '100 Main St, Huntsville, AL', setting: 'indoors', tables: 'yes', sink: 'no', setupFrom: '1 PM', access: 'Second floor, there is an elevator' },
  craft: { pick: 'custom', vision: 'Something we can put on our desks', theme: 'Blue and gold', personalized: 'Names', link: 'pinterest.com/pin/1' },
  extras: { food: 'studio', drinks: 'guest', dessert: 'none', decor: '', tableware: 'studio', favors: '' },
  allergies: 'One peanut allergy',
  budget: '500-1000',
  about: { name: 'Dana Planner', email: 'dana@example.com', phone: '(256) 555-0142', org: 'Rocket Co', contactBy: 'text', heard: 'Facebook' },
  notes: 'Thanks!',
  photos: [PHOTO],
  ...over,
})
