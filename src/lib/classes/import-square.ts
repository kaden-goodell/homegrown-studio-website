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
import { importLibraryClass, listLibrary } from './library-store'
import { squareFetch } from './square-api'
import type { ClassContent, LibraryClass } from './types'
import { defaultRules, validateContent } from './validate'

export const IMPORT_NOTE = 'Imported from Square'

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
  importKey: string
  legacyScheduleIds: string[]
  content: ClassContent
}
export interface ImportSkip { name: string; reason: string }
export interface ImportPlan { create: PlannedImport[]; skip: ImportSkip[] }

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
      dropOff: meta ? meta.dropOff : isDropOff(w.description),
      madeToOrder: meta?.madeToOrder ?? false,
      taxable: true,
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

/** What an import would add and what it would leave, without writing anything. */
export async function planSquareImport(src: SquareImportSource = squareImportSource()): Promise<ImportPlan> {
  const workshops = (await src.listAllWorkshops()).slice().sort((a, b) => a.startAt.localeCompare(b.startAt))
  const plan: ImportPlan = { create: [], skip: [] }
  if (workshops.length === 0) return plan

  const itemIds = await src.classItemIds()
  const library: LibraryClass[] = await listLibrary({ includeArchived: true })
  const keysInLibrary = new Set(library.map((l) => l.importKey).filter(Boolean) as string[])
  const namesInLibrary = new Set(library.map((l) => l.versions[l.versions.length - 1]?.content.name.trim().toLowerCase()).filter(Boolean))

  // Several dates of one class → one group, keyed by its catalog item.
  const groups = new Map<string, Workshop[]>()
  for (const w of workshops) {
    const lower = w.name.trim().toLowerCase()
    const k = itemIds.get(lower) ?? `name:${lower}`
    groups.set(k, [...(groups.get(k) ?? []), w])
  }

  for (const [importKey, dates] of groups) {
    const first = dates[0]
    const name = first.name.trim()
    if (keysInLibrary.has(importKey)) { plan.skip.push({ name, reason: 'Already in the library.' }); continue }
    if (namesInLibrary.has(name.toLowerCase())) { plan.skip.push({ name, reason: 'A class with this name is already in the library.' }); continue }
    if (!(first.priceCents > 0)) { plan.skip.push({ name, reason: 'It has no price in Square.' }); continue }
    const legacyScheduleIds = [...new Set(dates.map((d) => d.scheduleId).filter(Boolean))]
    // The settings of the soonest date that has any.
    let meta: EventMeta | null = null
    for (const id of legacyScheduleIds) { meta = await src.eventMeta(id); if (meta) break }
    const checked = validateContent(contentFromSquare(first, meta))
    if (!checked.ok) { plan.skip.push({ name, reason: checked.error }); continue }
    const content = checked.value
    plan.create.push({ name: content.name, priceCents: first.priceCents, imageUrl: content.imageUrl, ages: content.rules.ages, importKey, legacyScheduleIds, content })
  }
  return plan
}

export interface ImportResult {
  create: { name: string; priceCents: number; imageUrl: string | null; ages: string; id?: string }[]
  skip: ImportSkip[]
}

/** dryRun: the list only. Otherwise adds each class as library version 1. */
export async function importSquareClasses(opts: { dryRun: boolean; by: By }, src: SquareImportSource = squareImportSource()): Promise<ImportResult> {
  const plan = await planSquareImport(src)
  const summary = (p: PlannedImport) => ({ name: p.name, priceCents: p.priceCents, imageUrl: p.imageUrl, ages: p.ages })
  if (opts.dryRun) return { create: plan.create.map(summary), skip: plan.skip }
  const out: ImportResult = { create: [], skip: [...plan.skip] }
  for (const p of plan.create) {
    const lib = await importLibraryClass({ importKey: p.importKey, legacyScheduleIds: p.legacyScheduleIds, content: p.content, by: opts.by, note: IMPORT_NOTE })
    if (lib) out.create.push({ ...summary(p), id: lib.id })
    else out.skip.push({ name: p.name, reason: 'Already in the library.' })
  }
  return out
}
