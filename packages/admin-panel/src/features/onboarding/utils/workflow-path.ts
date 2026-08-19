import type { OnboardingTransition } from './onboarding-transitions';
import type { WorkflowDefinition } from '../types/workflow-definition';

/** What an onboarding's audit trail says about the workflow it was run against. */
export interface WorkflowPath {
  /** Every step entered, against the instant it was entered. */
  enteredAt: ReadonlyMap<string, string>;
  /** Step it stands on now, or null when nothing has been recorded. */
  currentStep: string | null;
}

/**
 * Names the step a recorded move ended on.
 *
 * A terminal move clears `currentStep`, so the trail alone cannot say which terminal step was
 * entered when a workflow declares more than one. The step left behind names its own declared
 * targets, so the answer is the target of that step whose status matches the one recorded;
 * failing that, any terminal step carrying that status.
 */
function resolveEnteredStep(
  definition: WorkflowDefinition,
  transition: OnboardingTransition,
): string | null {
  if (transition.toStep !== null) {
    return transition.toStep;
  }

  const stepsByName = new Map(definition.steps.map((step) => [step.name, step]));
  const leftBehind = transition.appliedStep ?? transition.fromStep;
  const declared = leftBehind === null ? [] : (stepsByName.get(leftBehind)?.transitions ?? []);

  for (const candidate of declared) {
    const target = candidate.target === null ? undefined : stepsByName.get(candidate.target);

    if (target?.status === transition.status) {
      return target.name;
    }
  }

  const terminal = definition.steps.find(
    (step) => step.terminal && step.status === transition.status,
  );

  return terminal?.name ?? null;
}

/**
 * Walks the recorded transitions over the declared workflow, reporting which steps were entered
 * and where the onboarding stands now.
 */
export function buildWorkflowPath(
  definition: WorkflowDefinition,
  transitions: readonly OnboardingTransition[],
): WorkflowPath {
  const enteredAt = new Map<string, string>();
  let currentStep: string | null = null;

  for (const transition of transitions) {
    const entered = resolveEnteredStep(definition, transition);

    if (entered === null) {
      continue;
    }

    // First entry wins, so a step reached again after a loop still reports when it was reached.
    if (!enteredAt.has(entered)) {
      enteredAt.set(entered, transition.occurredAt);
    }

    currentStep = entered;
  }

  return { enteredAt, currentStep };
}
