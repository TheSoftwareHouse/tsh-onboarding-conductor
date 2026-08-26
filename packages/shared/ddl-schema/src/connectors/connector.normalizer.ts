import { isJsonCompatibleValue, isPlainObject } from '../value-guards';
import {
  CONNECTOR_TYPES,
  type ConnectorType,
  type NormalizedWorkflowConnectorDeclaration,
  type RawWorkflowStep,
} from '../workflow-contract';
import { failWorkflow } from '../workflow-invalid.error';

export type WorkflowFieldDeclaration = {
  stepName: string;
  persist: boolean;
};

export type ConnectorMappingContext = {
  fieldDeclarationsByName: Readonly<Record<string, WorkflowFieldDeclaration>>;
  guaranteedPredecessorsByStepName: Readonly<Record<string, ReadonlySet<string>>>;
};

const normalizeConnectorConfig = (config: unknown): Record<string, unknown> => {
  if (config !== undefined && !isPlainObject(config)) {
    failWorkflow('INVALID_VALUE');
  }

  const configObject = (config as Record<string, unknown> | undefined) ?? {};

  if (!isJsonCompatibleValue(configObject)) {
    failWorkflow('INVALID_VALUE');
  }

  return { ...configObject };
};

/**
 * A connector may only read a field that is written in its own step, or in a step that always runs
 * before it and persists the value.
 */
const validateFieldMapping = (
  step: RawWorkflowStep,
  fieldMapping: Record<string, string>,
  workflowFieldNames: ReadonlySet<string>,
  context: ConnectorMappingContext,
): void => {
  for (const [payloadKey, sourceField] of Object.entries(fieldMapping)) {
    if (typeof payloadKey !== 'string' || payloadKey.trim().length === 0) {
      failWorkflow('INVALID_VALUE');
    }
    if (typeof sourceField !== 'string' || sourceField.trim().length === 0) {
      failWorkflow('INVALID_VALUE');
    }
    if (!workflowFieldNames.has(sourceField)) {
      failWorkflow('INVALID_VALUE');
    }

    const sourceDeclaration = context.fieldDeclarationsByName[sourceField];
    if (sourceDeclaration === undefined) {
      failWorkflow('INVALID_VALUE');
    }

    if (sourceDeclaration.stepName === step.name) {
      continue;
    }

    const guaranteedPredecessors = context.guaranteedPredecessorsByStepName[step.name];
    if (guaranteedPredecessors === undefined) {
      failWorkflow('INVALID_VALUE');
    }

    if (!guaranteedPredecessors.has(sourceDeclaration.stepName)) {
      failWorkflow('INVALID_VALUE');
    }

    if (!sourceDeclaration.persist) {
      failWorkflow('INVALID_VALUE');
    }
  }
};

/**
 * Rejection routing is not checked here: `validateRejectionTargets` in the transition normalizer
 * owns that rule, so it applies uniformly to every step whether or not it declares connectors.
 */
export const normalizeConnectors = (
  step: RawWorkflowStep,
  workflowFieldNames: ReadonlySet<string>,
  context: ConnectorMappingContext,
): NormalizedWorkflowConnectorDeclaration[] => {
  const connectors = step.connectors ?? [];
  if (connectors.length === 0) {
    return [];
  }

  const orders = new Set<number>();
  const normalized: NormalizedWorkflowConnectorDeclaration[] = [];

  for (const connector of connectors) {
    if (typeof connector.name !== 'string' || connector.name.trim().length === 0) {
      failWorkflow('INVALID_VALUE');
    }
    if (typeof connector.id !== 'string' || connector.id.trim().length === 0) {
      failWorkflow('INVALID_VALUE');
    }
    if (!CONNECTOR_TYPES.includes(connector.type as ConnectorType)) {
      failWorkflow('INVALID_VALUE');
    }
    if (!Number.isInteger(connector.order) || connector.order <= 0) {
      failWorkflow('INVALID_VALUE');
    }
    if (orders.has(connector.order)) {
      failWorkflow('INVALID_VALUE');
    }
    orders.add(connector.order);

    const canReject = connector.canReject ?? false;
    if (typeof canReject !== 'boolean') {
      failWorkflow('INVALID_VALUE');
    }
    const async = connector.async ?? false;
    if (typeof async !== 'boolean') {
      failWorkflow('INVALID_VALUE');
    }
    const config = normalizeConnectorConfig(connector.config);

    if (!isPlainObject(connector.fieldMapping)) {
      failWorkflow('INVALID_VALUE');
    }

    validateFieldMapping(step, connector.fieldMapping, workflowFieldNames, context);

    normalized.push({
      name: connector.name,
      id: connector.id,
      type: connector.type,
      canReject,
      async,
      order: connector.order,
      fieldMapping: Object.fromEntries(Object.entries(connector.fieldMapping)),
      config,
    });
  }

  normalized.sort((left, right) => left.order - right.order);

  return normalized;
};
