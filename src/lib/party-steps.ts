/**
 * Pure step-flow model for the party booking modal.
 *
 * The canonical order is craft → package → when → who → extras → pay. The
 * package step is there only when there is a choice to make (more than one
 * package offered, or a link that names its own package); the extras step only
 * when there are extras to add (online add-ons, or themed tables). An exact
 * time that arrives
 * from a calendar link is already settled, so that step is removed and the
 * progress indicator counts only steps the customer will see.
 *
 * The craft step is ALWAYS shown, even when a craft was chosen on the page or
 * came in a shared link: it is where the full description can be read and the
 * choice changed. The craft arrives selected, so it costs one tap.
 */

export type PartyStepId = 'craft' | 'package' | 'when' | 'who' | 'extras' | 'pay'

export interface FlowInput {
  /** A ?start deeplink matched a real available slot — drop the when step. */
  slotSettled: boolean
  /** Themed tables exist for this booking (feature live + stocked). */
  themesAvailable?: boolean
  /** How many add-ons /book offers. With none and no themed tables, there is no extras step. */
  addOnCount?: number
  /** How many packages /book offers. */
  packageCount?: number
  /** A `?package=` link named a package that is only booked by link (the test package). */
  linkPackage?: boolean
}

const ORDER: PartyStepId[] = ['craft', 'package', 'when', 'who', 'extras', 'pay']

const LABELS: Record<PartyStepId, string> = {
  craft: 'Craft',
  package: 'Package',
  when: 'Date and time',
  who: 'Guests',
  extras: 'Extras',
  pay: 'Your details and payment',
}

export function visibleSteps(input: FlowInput): PartyStepId[] {
  return ORDER.filter((id) => {
    if (id === 'when' && input.slotSettled) return false
    if (id === 'package' && !((input.packageCount ?? 1) > 1 || input.linkPackage)) return false
    if (id === 'extras' && !((input.addOnCount ?? 0) > 0 || input.themesAvailable)) return false
    return true
  })
}

export function stepLabel(id: PartyStepId): string {
  return LABELS[id]
}

export function stepIndex(current: PartyStepId, steps: PartyStepId[]): number {
  return steps.indexOf(current)
}

export function nextStep(current: PartyStepId, steps: PartyStepId[]): PartyStepId | null {
  const i = steps.indexOf(current)
  return i >= 0 && i < steps.length - 1 ? steps[i + 1] : null
}

export function prevStep(current: PartyStepId, steps: PartyStepId[]): PartyStepId | null {
  const i = steps.indexOf(current)
  return i > 0 ? steps[i - 1] : null
}
