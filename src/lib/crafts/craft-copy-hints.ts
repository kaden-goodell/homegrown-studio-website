/**
 * The craft-copy voice (.claude/skills/craft-copy, approved 20 Sep 2026),
 * as gentle notes under the description box in /admin › More › Crafts.
 * They suggest; they never stop a save. Client-safe and pure.
 */

/** The shape, shown above the box. */
export const CRAFT_COPY_GUIDE = 'Three short paragraphs, about 350 characters in all. 1) One sentence that says plainly what you make (the card shows only this). 2) “Everyone…”: what each person picks and does. 3) “Each guest goes home with ___. Ages 8 and up.” Made to order? Add a fourth starting “Heads up:”.'

export const CRAFT_COPY_EXAMPLE = 'Spell any word in chunky bubble letters, then clip it to your water bottle, backpack, or keys.\n\nEveryone picks their own word, plus their cord color, beads, and fuzzy pom-poms.\n\nEach guest goes home with a finished keychain. Ages 8 and up.'

const paragraphs = (t: string) => t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)

/** Notes for what she's typed (empty when it reads right). */
export function craftCopyNotes(text: string, opts: { personalized?: boolean } = {}): string[] {
  const t = text.trim()
  if (!t) return []
  const notes: string[] = []
  const paras = paragraphs(t)
  const want = opts.personalized ? 4 : 3
  if (paras.length < want) notes.push(`Try ${want} short paragraphs, with an empty line between them.`)
  if (paras.length > want) notes.push(`That’s ${paras.length} paragraphs. ${want} reads best.`)
  if (t.length > 420) notes.push(`${t.length} characters. About 350 reads best on a phone.`)
  if ((paras[0] ?? '').length > 110) notes.push('The first sentence is all the card shows. Keep it under about 100 characters.')
  if (t.replace(/heads up:/gi, '').includes(':')) notes.push('Leave out colons. Use a period or a comma.')
  if (/\b(party|parties|birthday|birthdays)\b/i.test(t)) notes.push('Leave out “party” and “birthday”. Crafts are for everyone, any occasion.')
  if (/\b(girls|boys|kids)\b/i.test(t)) notes.push('Say “everyone” or “each guest” rather than girls, boys or kids.')
  if (/\blearn(s|ing)? (to|how)\b/i.test(t)) notes.push('People come to make it, not to take a lesson. Say what they make and do.')
  if (/one-of-a-kind|uniquely yours|unleash|perfect mix|store-bought|professional|like a real/i.test(t)) notes.push('Keep it plain. Skip “one-of-a-kind”, “uniquely yours”, and comparisons to store-bought things.')
  if ((t.match(/!/g) ?? []).length > 1) notes.push('One exclamation mark at most.')
  if ((t.match(/—|--/g) ?? []).length > 1) notes.push('Too many dashes. Use a period or a comma instead.')
  if (/^at hometown studio/i.test(t)) notes.push('Start with what you make, not “At Hometown Studio…”.')
  if (!/\bages? \d+/i.test(t)) notes.push('End with the ages, like “Ages 8 and up.”')
  if (opts.personalized && !/heads up/i.test(t)) notes.push('Made to order: add a last paragraph starting “Heads up:” that says it’s made ahead and can’t be changed or refunded.')
  return notes
}

/** Notes for the craft's name (empty when it reads right). The name shows on every card and receipt. */
export function craftNameNotes(name: string): string[] {
  const n = name.trim()
  if (!n) return []
  const notes: string[] = []
  if (/\b(party|parties|birthday|birthdays)\b/i.test(n)) notes.push('Leave “party” and “birthday” out of the name. Crafts are for everyone, any occasion.')
  if (/\b(girls|boys|kids)\b/i.test(n)) notes.push('Leave girls, boys and kids out of the name. Crafts are for everyone.')
  if (n.includes('!')) notes.push('Leave the exclamation mark out of the name.')
  return notes
}
