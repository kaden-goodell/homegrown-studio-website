/**
 * M1: when the owners, an owner's email or mobile, or the Notifications picks
 * change, the OTHER owners hear by email and text at the addresses they had
 * BEFORE the change (owner-notice.ts). A stolen /admin session can then no
 * longer quietly add someone as an owner, or swap an owner's email, to get a
 * weekly copy of every waiver and incident: the real owners are told at once
 * (and the archive waits a day for a new address, notify-recipients.ts).
 *
 * Server only.
 */
import { createLogger } from '@lib/logger'
import { studioWhen, tellOwners, type NoticeOwner } from '@lib/owner-notice'

const logger = createLogger('owner-change-notice')

const CHECK = 'If that wasn’t expected, check /admin › More › Staff › People and Notifications, and change the admin passcode.'

/** What changed between two owner lists, as short phrases ("made Dana an owner"). Matched by staff id. Pure. */
export function ownerChanges(before: NoticeOwner[] | null, after: NoticeOwner[] | null): { phrases: string[]; added: NoticeOwner[] } {
  const b = new Map((before ?? []).filter((o) => o.id).map((o) => [o.id!, o]))
  const a = new Map((after ?? []).filter((o) => o.id).map((o) => [o.id!, o]))
  const phrases: string[] = []
  const added: NoticeOwner[] = []
  for (const [id, o] of a) {
    const was = b.get(id)
    if (!was) {
      phrases.push(`made ${o.name} an owner`)
      added.push(o)
      continue
    }
    if ((was.email ?? '') !== (o.email ?? '')) phrases.push(o.email ? `changed ${o.name}’s email` : `removed ${o.name}’s email`)
    if ((was.phone ?? '') !== (o.phone ?? '')) phrases.push(o.phone ? `changed ${o.name}’s mobile` : `removed ${o.name}’s mobile`)
  }
  for (const [id, o] of b) if (!a.has(id)) phrases.push(`took ${o.name} off as an owner`)
  return { phrases, added }
}

const joinAnd = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** The Notifications rows an owner is picked for now (labels), when the screen has been saved; [] otherwise. Never throws. */
async function rowsFor(ownerId: string, name: string): Promise<string[]> {
  try {
    const { notifyView } = await import('@lib/notify-settings')
    const view = await notifyView()
    if (!view.saved) return []
    return view.rows.filter((r) => r.picked.includes(ownerId)).map((r) => (r.held.some((h) => h.name === name) ? `${r.label} (from tomorrow)` : r.label))
  } catch {
    return []
  }
}

/**
 * After a Staff › People change: tell the other owners when the owners or
 * their contacts changed. `before` is the owner snapshot from before the
 * change. Never throws.
 */
export async function noticeOwnerChange(by: { name: string }, before: NoticeOwner[] | null, after: NoticeOwner[] | null): Promise<void> {
  try {
    // No list before (the first import): nothing to compare, nobody to tell yet.
    if (!before) return
    const { phrases, added } = ownerChanges(before, after)
    if (!phrases.length) return
    const gets: string[] = []
    for (const o of added) {
      const rows = await rowsFor(o.id!, o.name)
      if (rows.length) gets.push(`${o.name} now gets: ${rows.join(', ')}.`)
    }
    const line = [`${by.name} ${joinAnd(phrases)} in /admin (${studioWhen()}).`, ...gets, CHECK].join(' ')
    await tellOwners({ owners: before, except: by.name === 'Owner' ? null : by.name, subject: 'The studio’s owners changed in /admin', line })
  } catch (err) {
    logger.warn('Owner change notice failed', { error: err instanceof Error ? err.message : String(err) })
  }
}

/** After Notifications is saved: tell the other owners which rows now go to whom. Never throws. */
export async function noticeNotifyChange(by: { name: string }, owners: NoticeOwner[] | null, changed: { label: string; to: string[] }[]): Promise<void> {
  try {
    if (!changed.length) return
    const parts = changed.map((c) => `${c.label} now goes to ${joinAnd(c.to)}`)
    const line = `${by.name} changed who gets alerts and reports in /admin (${studioWhen()}): ${parts.join('; ')}. If that wasn’t expected, check /admin › More › Notifications and change the admin passcode.`
    await tellOwners({ owners, except: by.name === 'Owner' ? null : by.name, subject: 'Who gets the studio’s alerts changed in /admin', line })
  } catch (err) {
    logger.warn('Notifications change notice failed', { error: err instanceof Error ? err.message : String(err) })
  }
}
