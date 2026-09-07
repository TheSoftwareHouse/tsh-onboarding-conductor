import type { RawWorkflowStep, RawWorkflowTransition } from '../workflow-contract';
import { SUCCESS_PORT } from './node-config.utils';
import type { WorkflowNodeCompilationContext, WorkflowNodePort } from './node-type.port';

/** What a node with one outcome exposes and compiles to — the majority of the collection types. */
export const SINGLE_OUTCOME_PORTS: readonly WorkflowNodePort[] = [{ name: SUCCESS_PORT }];

/** One step, carrying the node's own name. */
export const SINGLE_STEP_KEYS: readonly (string | null)[] = [null];

export const buildSuccessTransition = (target: string | undefined): RawWorkflowTransition => ({
  status: 'success',
  target,
});

/**
 * The shape every single-step, single-outcome node compiles to: collect the node's fields, then
 * follow its one edge. Shared rather than repeated per type, so `success` means the same thing and
 * looks the same in the compiled document wherever it appears.
 */
export const compileSingleOutcomeStep = <TConfig>(
  context: WorkflowNodeCompilationContext<TConfig>,
): RawWorkflowStep[] => [
  {
    name: context.stepNames[0],
    status: 'awaiting_user',
    data: context.fields,
    transitions: [buildSuccessTransition(context.targets[SUCCESS_PORT])],
  },
];
