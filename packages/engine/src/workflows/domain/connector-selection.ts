import type {
  NormalizedWorkflowConnectorDeclaration,
  NormalizedWorkflowDefinition,
  NormalizedWorkflowStep,
} from '@tsh/ddl-schema';

/** An operator's runtime choice of the connector a step's single connector slot runs. */
export type WorkflowConnectorSelection = Readonly<{
  stepName: string;
  connectorId: string;
}>;

/**
 * The slot a selection can name: the step's only connector declaration. A step with none has
 * nothing to bind, and one with several (only a `custom` step can) cannot be addressed by a step
 * name alone, so neither is selectable.
 */
export const findSelectableConnector = (
  step: NormalizedWorkflowStep,
): NormalizedWorkflowConnectorDeclaration | undefined =>
  step.connectors.length === 1 ? step.connectors[0] : undefined;

/**
 * The definition a workflow actually runs: each selected step's primary connector takes the
 * selected `id` and keeps everything else the document authored — config, field mapping, retry,
 * fallbacks. Returns the very same object when there is nothing to apply, and ignores a selection
 * naming a step the definition lacks or one that is not selectable.
 */
export const applyConnectorSelections = (
  definition: NormalizedWorkflowDefinition,
  selections: readonly WorkflowConnectorSelection[],
): NormalizedWorkflowDefinition => {
  if (selections.length === 0) {
    return definition;
  }

  const connectorIdByStep = new Map(
    selections.map((selection) => [selection.stepName, selection.connectorId]),
  );
  const steps = definition.steps.map((step): NormalizedWorkflowStep => {
    const connectorId = connectorIdByStep.get(step.name);
    const primary = findSelectableConnector(step);

    return connectorId === undefined || primary === undefined
      ? step
      : { ...step, connectors: [{ ...primary, id: connectorId }] };
  });

  return {
    ...definition,
    steps,
    stepsByName: Object.fromEntries(steps.map((step) => [step.name, step])),
  };
};
