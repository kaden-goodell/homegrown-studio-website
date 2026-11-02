/**
 * What a Records download holds (/admin › More › Records), in plain words.
 * Client-safe: the sheet lists these, and the zip's README.txt repeats them
 * (src/lib/records-download.ts).
 */
export const RECORD_SECTIONS: { store: string; file: string; what: string }[] = [
  { store: 'waivers', file: 'waivers.json', what: 'Every signed waiver: who signed, the children on it, allergies, emergency contact, who may and may not pick up, photo consent, the waiver version and the signature.' },
  { store: 'rsvps', file: 'rsvps.json', what: 'Who said they were coming to each class or party, and who was coming with them.' },
  { store: 'checkins', file: 'checkins.json', what: 'Check-ins at the door: who was here, when they arrived and left, and who picked each child up.' },
  { store: 'checkins', file: 'custody.csv', what: 'The same check-ins and pickups as a spreadsheet, one line each (the file to hand a lawyer).' },
  { store: 'incidents', file: 'incidents.json', what: 'Incident reports: what happened, to whom, when, and who wrote it up.' },
  { store: 'event-meta', file: 'event-meta.json', what: 'Each class and party’s door settings (drop-off or not, capacity).' },
  { store: 'audit', file: 'audit.json', what: 'Who did what on /admin and /staff: refunds, comps, check-ins, changes, with the time and the person.' },
  { store: 'audit', file: 'audit.csv', what: 'The same list of who did what, as a spreadsheet.' },
]

