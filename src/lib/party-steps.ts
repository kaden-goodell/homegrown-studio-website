/**
 * Pure step-flow model for the party booking modal.
 *
 * The canonical order is craft → when → who → pay. An exact time that arrives
 * from a calendar link is already settled, so that step is removed and the
 * progress indicator counts only steps the customer will see.
 *
 * The craft step is ALWAYS shown, even when a craft was chosen on the page or
 * came in a shared link: it is where the full description can be read and the
 * choice changed. The craft arrives selected, so it costs one tap.
 */

export type PartyStepId = 'craft' | 'when' | 'who' | 'theme' | 'pay'

export interface FlowInput {
  /** A ?start deeplink matched a real available slot — drop the when step. */
  slotSettled: boolean
  /** Themed tables exist for this booking (feature live + stocked). Absent/false drops the step. */
  themesAvailable?: boolean
}

const ORDER: PartyStepId[] = ['craft', 'when', 'who', 'theme', 'pay']

const LABELS: Record<PartyStepId, string> = {
  craft: 'Craft',
  when: 'Date and time',
  who: 'Guests',
  theme: 'Themed table',
  pay: 'Your details and payment',
}

export function visibleSteps(input: FlowInput): PartyStepId[] {
  return ORDER.filter((id) => {
    if (id === 'when' && input.slotSettled) return false
    if (id === 'theme' && !input.themesAvailable) return false
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
