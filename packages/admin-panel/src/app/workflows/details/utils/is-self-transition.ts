import type { WorkflowStepDefinition } from '@/api/workflows/workflow-definitions';

/** A transition onto the step it is declared on: no target, or its own name. */
export function isSelfTransition(
  step: Pick<WorkflowStepDefinition, 'name'>,
  target: string | null,
): boolean {
  return target === null || target === step.name;
}
