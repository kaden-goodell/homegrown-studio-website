/**
 * Pure step-flow model for the party booking modal.
 *
 * The canonical order is craft → when → who → pay. Steps that arrive already
 * settled (a craft chosen from the gallery, an exact slot from a calendar
 * deeplink) are removed from the flow entirely, so the progress indicator
 * counts only steps the user will actually see.
 *
 * A preselected PERSONALIZED craft is NOT settled — its non-refundable
 * acknowledgment lives on the craft step, so the caller keeps that step by
 * passing craftSettled: false.
 */

export type PartyStepId = 'craft' | 'when' | 'who' | 'theme' | 'pay'

export interface FlowInput {
  /** Craft preselected AND requires no acknowledgment — drop the craft step. */
  craftSettled: boolean
  /** A ?start deeplink matched a real available slot — drop the when step. */
  slotSettled: boolean
  /** Themed tables exist for this booking (feature live + stocked). Absent/false drops the step. */
  themesAvailable?: boolean
}

const ORDER: PartyStepId[] = ['craft', 'when', 'who', 'theme', 'pay']

const LABELS: Record<PartyStepId, string> = {
  craft: 'Craft',
  when: 'Date & Time',
  who: 'Guests',
  theme: 'Themed Table',
  pay: 'Details & Payment',
}

export function visibleSteps(input: FlowInput): PartyStepId[] {
  return ORDER.filter((id) => {
    if (id === 'craft' && input.craftSettled) return false
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
