/**
 * Pure step-flow model for the take-home kit modal.
 *
 * The canonical order is craft → build → when → pay, where "build" is one
 * combined step: guest count and the optional themed table, chosen together
 * (the guest count picks the package tier, the tier prices the tables — they
 * belong on one screen). A craft chosen from the gallery (a ?craft= deeplink
 * or a landing-card click) arrives already settled and drops out of the flow,
 * so the progress indicator counts only the steps the user will actually see.
 * A theme picked from a landing card does NOT drop the build step (the guest
 * count still needs choosing) — it arrives preselected instead.
 */

export type KitStepId = 'craft' | 'build' | 'when' | 'pay'

export interface FlowInput {
  /** Craft preselected from the gallery — drop the craft step. */
  craftSettled: boolean
}

const ORDER: KitStepId[] = ['craft', 'build', 'when', 'pay']

const LABELS: Record<KitStepId, string> = {
  craft: 'Crafts',
  build: 'Guests & Table',
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
