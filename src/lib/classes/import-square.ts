/**
 * Brings today's Square classes into our class library at switch-over
 * (spec: "All current Square classes are imported into the library").
 *
 * Read-only toward Square: it reads the classes the workshop provider already
 * lists, their event settings, and the catalog's item ids. It never writes to
 * Square and never schedules a class; the POS item is made later, when an
 * owner schedules the class from the library.
 *
 * One library class per Square class (several dates of the same class are one
 * entry). Its import key is the Square catalog item id, so running it again
 * adds nothing twice. The Square schedule ids are kept for reference only.
 */
import { providers } from '@config/providers'
import { getEventMeta, type EventMeta } from '@lib/event-meta'
import type { By } from '@lib/staff-auth'
import { ageLabel, isDropOff } from '@lib/workshop-copy'
import type { Workshop } from '@providers/interfaces/workshop'
import { fillImportedPhoto, importLibraryClass, listLibrary } from './library-store'
import { squareFetch } from './square-api'
import type { ClassContent, LibraryClass } from './types'
import { defaultRules, validateContent } from './validate'

export const IMPORT_NOTE = 'Imported from Square'
export const PHOTO_NOTE = 'Photo from Square'

/** Where the import reads from. Every member only reads. */
export interface SquareImportSource {
  /** Every Square class in the provider's window (a week back, a year ahead). */
  listAllWorkshops(): Promise<Workshop[]>
  /** Lowercased class name → Square catalog item id. */
  classItemIds(): Promise<Map<string, string>>
  /** Our event settings for a Square class schedule, if any. */
  eventMeta(scheduleId: string): Promise<EventMeta | null>
}

export interface PlannedImport {
  name: string
  priceCents: number
  imageUrl: string | null
  ages: string
  /** What the owner should check: no photo, prices differ across dates, tax-free. */
  issues: string[]
  importKey: string
  legacyScheduleIds: string[]
  content: ClassContent
}
export interface ImportSkip { name: string; reason: string }
export interface ImportPlan { create: PlannedImport[]; skip: ImportSkip[]; addPhoto: PhotoFill[] }

/** The catalog's class items, read with a GET (paged). */
async function readClassItemIds(): Promise<Map<string, string>> {
  const byName = new Map<string, { id: string; classTicket: boolean }>()
  let cursor: string | undefined
  do {
    const page: any = await squareFetch(`/catalog/list?types=ITEM${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    for (const o of page?.objects ?? []) {
      const name = typeof o?.item_data?.name === 'string' ? o.item_data.name.trim().toLowerCase() : ''
      if (!name || !o.id || o.is_deleted) continue
      const classTicket = o.item_data.product_type === 'CLASS_TICKET'
      const seen = byName.get(name)
      // The class's own item wins over a POS item that happens to share its name.
      if (!seen || (classTicket && !seen.classTicket)) byName.set(name, { id: o.id, classTicket })
    }
    cursor = page?.cursor || undefined
  } while (cursor)
  return new Map([...byName].map(([name, v]) => [name, v.id]))
}

export function squareImportSource(): SquareImportSource {
  return {
    listAllWorkshops: () => providers.workshop.listAllWorkshops?.() ?? providers.workshop.listWorkshops(),
    classItemIds: readClassItemIds,
    eventMeta: (scheduleId) => getEventMeta('workshop', scheduleId),
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)))

/** Lowercased, trimmed, spaces collapsed: how two class names are compared. */
export const normalName = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

const dollars = (c: number) => `$${c % 100 ? (c / 100).toFixed(2) : c / 100}`

/** Square adds no tax to it: its catalog item carries no tax (0%). Unknown counts as taxed. */
const taxFree = (w: Workshop) => w.taxPercent === 0

/** One Square class (its soonest date stands for all) as library content. */
export function contentFromSquare(w: Workshop, meta: EventMeta | null): ClassContent {
  const capacity = meta?.capacity ?? w.totalCapacity ?? 12
  const raw: ClassContent = {
    name: w.name.trim().slice(0, 80),
    description: w.description ?? '',
    imageUrl: w.imageUrl ?? null,
    instructor: null,
    rules: {
      ...defaultRules(),
      ages: ageLabel(w.description),
      // Either one saying drop-off is enough: never lose a drop-off rule.
      dropOff: !!meta?.dropOff || isDropOff(w.description),
      madeToOrder: meta?.madeToOrder ?? false,
      taxable: !taxFree(w),
      signupCutoffHours: meta?.signupCutoffHours ?? null,
    },
    ticketTypes: [{ id: 'person', label: 'Person' }],
    passes: [{ id: 'all', label: 'Full class', covers: { kind: 'all' } }],
    prices: { all: { person: w.priceCents } },
    questions: (meta?.options ?? []).map((o) => ({ id: o.id, label: o.label, choices: [...o.choices] })),
    addOns: [],
    defaultCapacity: clamp(capacity, 1, 999),
    defaultMinutes: clamp(w.durationMinutes || 90, 5, 1440),
  }
  return raw
}

/** What the owner should look at before adding a class. */
function issuesOf(dates: Workshop[], first: Workshop): string[] {
  const issues: string[] = []
  if (!first.imageUrl) issues.push('No photo found')
  const prices = dates.map((d) => d.priceCents).filter((c) => c > 0)
  const lo = Math.min(...prices), hi = Math.max(...prices)
  if (prices.length && lo !== hi) issues.push(`Prices differ across dates (${dollars(lo)}–${dollars(hi)})`)
  if (taxFree(first)) issues.push('Tax-free in Square')
  if (first.name.trim().length > 80) issues.push('Name shortened to 80 characters')
  return issues
}

/** A class this tool added that still has no photo, and the photo Square now has. */
export interface PhotoFill { id: string; name: string; imageUrl: string }

/** What an import would add and what it would leave, without writing anything. */
export async function planSquareImport(src: SquareImportSource = squareImportSource()): Promise<ImportPlan> {
  const workshops = (await src.listAllWorkshops()).slice().sort((a, b) => a.startAt.localeCompare(b.startAt))
  const plan: ImportPlan = { create: [], skip: [], addPhoto: [] }
  if (workshops.length === 0) return plan

  const itemIds = await src.classItemIds()
  const library: LibraryClass[] = await listLibrary({ includeArchived: true })
  const byKey = new Map(library.filter((l) => l.importKey).map((l) => [l.importKey!, l]))
  const namesInLibrary = new Set(library.map((l) => normalName(l.versions[l.versions.length - 1]?.content.name ?? '')).filter(Boolean))

  // Several dates of one class → one group, keyed by its catalog item.
  const groups = new Map<string, Workshop[]>()
  for (const w of workshops) {
    const k = itemIds.get(w.name.trim().toLowerCase()) ?? `name:${normalName(w.name)}`
    groups.set(k, [...(groups.get(k) ?? []), w])
  }

  for (const [importKey, dates] of groups) {
    const first = dates.find((d) => d.imageUrl) ? { ...dates[0], imageUrl: dates.find((d) => d.imageUrl)!.imageUrl } : dates[0]
    const name = first.name.trim()
    const existing = byKey.get(importKey)
    if (existing) {
      const latest = existing.versions[existing.versions.length - 1]
      // A photo missing at import (Square's photo lookup can fail quietly) is filled on a later run.
      if (latest?.note === IMPORT_NOTE && !latest.content.imageUrl && first.imageUrl) {
        plan.addPhoto.push({ id: existing.id, name: latest.content.name, imageUrl: first.imageUrl })
      } else plan.skip.push({ name, reason: 'Already in the library.' })
      continue
    }
    if (namesInLibrary.has(normalName(name))) { plan.skip.push({ name, reason: 'A class with this name is already in the library.' }); continue }
    if (!(first.priceCents > 0)) { plan.skip.push({ name, reason: 'It has no price in Square.' }); continue }
    const legacyScheduleIds = [...new Set(dates.map((d) => d.scheduleId).filter(Boolean))]
    // The settings of the soonest date that has any.
    let meta: EventMeta | null = null
    for (const id of legacyScheduleIds) { meta = await src.eventMeta(id); if (meta) break }
    const checked = validateContent(contentFromSquare(first, meta))
    if (!checked.ok) { plan.skip.push({ name, reason: checked.error }); continue }
    const content = checked.value
    plan.create.push({
      name: content.name, priceCents: first.priceCents, imageUrl: content.imageUrl, ages: content.rules.ages,
      issues: issuesOf(dates, first), importKey, legacyScheduleIds, content,
    })
  }
  return plan
}

export interface ImportResult {
  create: { name: string; priceCents: number; imageUrl: string | null; ages: string; issues: string[]; id?: string }[]
  skip: ImportSkip[]
  /** Classes added earlier without a photo that get Square's photo now. */
  addPhoto: { name: string; imageUrl: string; id: string }[]
}

/** dryRun: the list only. Otherwise adds each class as library version 1. */
export async function importSquareClasses(opts: { dryRun: boolean; by: By }, src: SquareImportSource = squareImportSource()): Promise<ImportResult> {
  const plan = await planSquareImport(src)
  const summary = (p: PlannedImport) => ({ name: p.name, priceCents: p.priceCents, imageUrl: p.imageUrl, ages: p.ages, issues: p.issues })
  const photo = (f: PhotoFill) => ({ name: f.name, imageUrl: f.imageUrl, id: f.id })
  if (opts.dryRun) return { create: plan.create.map(summary), skip: plan.skip, addPhoto: plan.addPhoto.map(photo) }
  const out: ImportResult = { create: [], skip: [...plan.skip], addPhoto: [] }
  for (const p of plan.create) {
    const lib = await importLibraryClass({ importKey: p.importKey, legacyScheduleIds: p.legacyScheduleIds, content: p.content, by: opts.by, note: IMPORT_NOTE })
    if (lib) out.create.push({ ...summary(p), id: lib.id })
    else out.skip.push({ name: p.name, reason: 'Already in the library.' })
  }
  for (const f of plan.addPhoto) {
    if (await fillImportedPhoto({ id: f.id, imageUrl: f.imageUrl, by: opts.by, importNote: IMPORT_NOTE, note: PHOTO_NOTE })) out.addPhoto.push(photo(f))
    else out.skip.push({ name: f.name, reason: 'Already in the library.' })
  }
  return out
}
