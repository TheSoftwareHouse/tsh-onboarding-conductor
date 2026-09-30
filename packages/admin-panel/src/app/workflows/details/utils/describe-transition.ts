import type {
  WorkflowStepDefinition,
  WorkflowTransitionDefinition,
} from '@/api/workflows/workflow-definitions';
import { describeCondition } from './describe-condition';

function isGuarded(transition: WorkflowTransitionDefinition): boolean {
  return transition.when != null || (transition.reason?.length ?? 0) > 0;
}

/** An unguarded arm that follows a guarded or reason-bearing arm of the same status. */
export function isFallbackArm(
  step: Pick<WorkflowStepDefinition, 'transitions'>,
  transition: WorkflowTransitionDefinition,
): boolean {
  const position = step.transitions.indexOf(transition);

  return (
    !isGuarded(transition) &&
    step.transitions
      .slice(0, Math.max(position, 0))
      .some((other) => other.status === transition.status && isGuarded(other))
  );
}

/** The rule one transition fires under, e.g. `success when documentType = PASSPORT`. */
export function describeTransition(
  step: Pick<WorkflowStepDefinition, 'transitions'>,
  transition: WorkflowTransitionDefinition,
): string {
  let text = transition.status;
  if (transition.when != null) text += ` when ${describeCondition(transition.when)}`;
  if (transition.reason?.length) text += ` · reason ${transition.reason.join(', ')}`;

  return isFallbackArm(step, transition) ? `${text} · fallback arm` : text;
}
