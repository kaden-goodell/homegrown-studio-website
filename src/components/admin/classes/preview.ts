/** A WorkshopData built in the browser from the form, so the editor can show the real public card. Display only. */
import type { WorkshopData } from '@components/workshops/WorkshopExplorer'
import { studioDate } from '@components/workshops/workshop-view-model'
import { classAvailability, lowestPrice, type OwnClassData, type PublicPass } from '@lib/classes/public-class'
import type { ClassContent, Session } from '@lib/classes/types'

export function previewData(content: ClassContent, sessions: Session[], now = new Date()): WorkshopData {
  const list = [...sessions].sort((a, b) => a.startIso.localeCompare(b.startIso))
  if (!list.length) {
    const start = new Date(now.getTime() + 7 * 86_400_000)
    list.push({ id: 'preview', startIso: start.toISOString(), endIso: new Date(start.getTime() + content.defaultMinutes * 60_000).toISOString(), capacity: content.defaultCapacity })
  }
  const pub = list.map((s) => ({ id: s.id, startIso: s.startIso, endIso: s.endIso, left: s.capacity, closed: false }))
  const passes: PublicPass[] = content.passes
    .filter((p) => Object.keys(content.prices[p.id] ?? {}).length > 0)
    .map((p) => ({
      ...p,
      sessionIds: p.covers.kind === 'choose' ? null : p.covers.kind === 'fixed' ? p.covers.sessionIds : pub.map((s) => s.id),
      state: 'open' as const,
      left: Math.min(...pub.map((s) => s.left)),
    }))
  const own: OwnClassData = {
    classId: 'preview', sessions: pub, passes, ticketTypes: content.ticketTypes, prices: content.prices,
    questions: content.questions, addOns: content.addOns, rules: content.rules, instructor: content.instructor, taxPercent: 0,
  }
  const first = list[0]
  return {
    id: 'preview',
    name: content.name || 'Class name',
    description: content.description,
    category: 'workshop',
    ...(content.imageUrl ? { imageUrl: content.imageUrl } : {}),
    date: studioDate(new Date(first.startIso)),
    startTime: first.startIso,
    endTime: first.endIso,
    duration: Math.round((Date.parse(first.endIso) - Date.parse(first.startIso)) / 60_000),
    price: lowestPrice(own),
    currency: 'USD',
    remainingSeats: classAvailability(own).remainingSeats,
    signupClosed: false,
    own,
  }
}
