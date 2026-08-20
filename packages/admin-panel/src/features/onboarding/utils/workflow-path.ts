import type { OnboardingTransition } from './onboarding-transitions';

/** What an onboarding's recorded moves say about the workflow it was run against. */
export interface WorkflowPath {
  /** Every step entered, against the instant it was entered. */
  enteredAt: ReadonlyMap<string, string>;
  /** Step it stands on now, or null when nothing has been recorded. */
  currentStep: string | null;
}

/**
 * Walks the recorded transitions over the declared workflow, reporting which steps were entered
 * and where the onboarding stands now.
 *
 * The engine names the step each move entered, including the terminal one a record cannot name on
 * its own, so this only has to accumulate them.
 */
export function buildWorkflowPath(transitions: readonly OnboardingTransition[]): WorkflowPath {
  const enteredAt = new Map<string, string>();
  let currentStep: string | null = null;

  for (const transition of transitions) {
    if (transition.enteredStep === null) {
      continue;
    }

    // First entry wins, so a step reached again after a loop still reports when it was reached.
    if (!enteredAt.has(transition.enteredStep)) {
      enteredAt.set(transition.enteredStep, transition.occurredAt);
    }

    currentStep = transition.enteredStep;
  }

  return { enteredAt, currentStep };
}
