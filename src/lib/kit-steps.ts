/**
 * Pure step-flow model for the take-home kit modal.
 *
 * The canonical order is craft → guests → theme → when → pay. A craft chosen
 * from the gallery (a ?craft= deeplink or a landing-card click) arrives already
 * settled and drops out of the flow, so the progress indicator counts only the
 * steps the user will actually see. This mirrors the party flow's craft-drop
 * behavior; unlike parties, kits never deeplink a slot, so only craft ever drops.
 */

export type KitStepId = 'craft' | 'guests' | 'theme' | 'when' | 'pay'

export interface FlowInput {
  /** Craft preselected from the gallery — drop the craft step. */
  craftSettled: boolean
}

const ORDER: KitStepId[] = ['craft', 'guests', 'theme', 'when', 'pay']

const LABELS: Record<KitStepId, string> = {
  craft: 'Crafts',
  guests: 'Guests',
  theme: 'Themed Table',
  when: 'Party Date',
  pay: 'Details & Payment',
}

export function visibleSteps(input: FlowInput): KitStepId[] {
  return ORDER.filter((id) => {
    if (id === 'craft' && input.craftSettled) return false
    return true
  })
}

export function stepLabel(id: KitStepId): string {
  return LABELS[id]
}

export function stepIndex(current: KitStepId, steps: KitStepId[]): number {
  return steps.indexOf(current)
}

export function nextStep(current: KitStepId, steps: KitStepId[]): KitStepId | null {
  const i = steps.indexOf(current)
  return i >= 0 && i < steps.length - 1 ? steps[i + 1] : null
}

export function prevStep(current: KitStepId, steps: KitStepId[]): KitStepId | null {
  const i = steps.indexOf(current)
  return i > 0 ? steps[i - 1] : null
}
