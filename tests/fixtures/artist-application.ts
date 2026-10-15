// A complete /teach application, as the form sends it.
export const PHOTO = `data:image/jpeg;base64,${Buffer.from('fake-jpeg-bytes').toString('base64')}`
export const goodBody = (over: any = {}) => ({
  about: { name: 'Lou Maker', business: 'Lou Makes', email: 'lou@example.com', phone: '(256) 555-0100', city: 'Huntsville' },
  links: { instagram: '@loumakes', website: '', tiktok: '', etsy: '', video: 'https://youtube.com/x' },
  classIdea: { what: 'Linocut printing', takeHome: 'Three prints', audience: 'adults', dropOffOk: '', length: '2 hours', groupMin: '4', groupMax: '12', price: '$45', suppliesCost: '$10', needs: 'Tables' },
  experience: 'Five years at the library',
  when: { days: 'Weekday evenings', howOften: 'monthly' },
  photos: [PHOTO],
  ...over,
})

