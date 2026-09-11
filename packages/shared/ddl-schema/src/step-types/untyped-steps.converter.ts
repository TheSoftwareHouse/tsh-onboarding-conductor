import { isPlainObject } from '../value-guards';
import type {
  CompiledWorkflowDefinition,
  CompiledWorkflowStep,
  RawWorkflowDefinition,
  RawWorkflowStep,
} from '../workflow-contract';
import { customStepTypeDefinition } from './types/custom.step-type';

/**
 * Rewrites a document written as untyped steps — the compiled shape, which every workflow was once
 * authored in directly — into typed steps, one `custom` step per step, verbatim. Untyped steps are
 * no longer accepted as authored input, so this is the migration path for a document written before
 * that: the result compiles back to exactly the steps it was given, in the same order, under the
 * same names, with every field, connector, scoring rule and transition as it was. Key order is
 * preserved throughout — a step's field order is the order a client renders — and nothing is
 * normalized, so a defect in the old document stays where it was and is reported at
 * `steps[i].config.…` when the result is loaded.
 */
export const convertUntypedSteps = (
  document: CompiledWorkflowDefinition,
): RawWorkflowDefinition => {
  const { steps, ...root } = document;

  return {
    ...root,
    steps: steps.map((step): RawWorkflowStep => {
      // An entry that is not an object is carried as it is, so the workflow schema refuses it at
      // `steps[i]` rather than this function throwing at a document it was meant to report on.
      if (!isPlainObject(step)) {
        return step as unknown as RawWorkflowStep;
      }

      const { name, ...config }: CompiledWorkflowStep = step;

      return { name, type: customStepTypeDefinition.type, config };
    }),
  };
};
