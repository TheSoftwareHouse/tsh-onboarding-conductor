import type { NormalizedWorkflowStep } from '../workflow-contract';
import { failWorkflow } from '../workflow-invalid.error';

/**
 * Skips form their own edge set, laid over the transition graph: entering a step whose `skip`
 * condition holds means entering that step's target instead, and the target may skip in turn.
 *
 * A cycle among those edges would leave the engine resolving one forever, so it is refused when
 * the document is loaded rather than guarded against with a hop counter at runtime. The graph is
 * fixed once a revision is validated, which makes the static check the complete answer and the
 * runtime counter dead weight.
 */
export const validateSkipGraph = (
  steps: readonly NormalizedWorkflowStep[],
  stepsByName: Readonly<Record<string, NormalizedWorkflowStep>>,
): void => {
  for (const step of steps) {
    if (step.skip === undefined) {
      continue;
    }

    // A step skipping to itself is the one cycle worth naming separately: it reads like a
    // self-loop transition, but a transition self-loop makes progress and this cannot.
    if (step.skip.target === step.name) {
      failWorkflow('INVALID_TRANSITIONS');
    }

    if (stepsByName[step.skip.target] === undefined) {
      failWorkflow('UNKNOWN_TARGET');
    }
  }

  const state = new Map<string, 'visiting' | 'visited'>();

  const visit = (stepName: string): void => {
    const stepState = state.get(stepName);
    if (stepState === 'visiting') {
      failWorkflow('INVALID_TRANSITIONS');
    }
    if (stepState === 'visited') {
      return;
    }

    state.set(stepName, 'visiting');

    const skip = stepsByName[stepName]?.skip;
    if (skip !== undefined) {
      visit(skip.target);
    }

    state.set(stepName, 'visited');
  };

  for (const step of steps) {
    visit(step.name);
  }
};
