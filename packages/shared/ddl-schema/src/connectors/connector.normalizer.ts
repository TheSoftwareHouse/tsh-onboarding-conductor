import { isJsonCompatibleValue, isPlainObject } from '../value-guards';
import {
  CONNECTOR_TYPES,
  type ConnectorType,
  type NormalizedWorkflowConnectorDeclaration,
  type NormalizedWorkflowConnectorFallback,
  type RawWorkflowConnectorFallbackDeclaration,
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
 * A fallback inherits `order`, `async` and `canReject` from the primary it belongs to — they
 * describe the step's slot, not the provider filling it — and its `fieldMapping` when it declares
 * none, since same-`type` adapters often share a payload contract. `config` is never inherited: it
 * is adapter-specific, and handing a fallback the primary's config would be a bug no author wrote.
 */
const normalizeConnectorFallback = (
  step: RawWorkflowStep,
  primary: NormalizedWorkflowConnectorDeclaration,
  fallback: RawWorkflowConnectorFallbackDeclaration,
  workflowFieldNames: ReadonlySet<string>,
  context: ConnectorMappingContext,
): NormalizedWorkflowConnectorFallback => {
  if (typeof fallback.name !== 'string' || fallback.name.trim().length === 0) {
    failWorkflow('INVALID_VALUE');
  }
  if (typeof fallback.id !== 'string' || fallback.id.trim().length === 0) {
    failWorkflow('INVALID_VALUE');
  }
  if (fallback.id === primary.id) {
    failWorkflow('INVALID_VALUE');
  }
  if (!CONNECTOR_TYPES.includes(fallback.type as ConnectorType) || fallback.type !== primary.type) {
    failWorkflow('INVALID_VALUE');
  }

  let fieldMapping: Record<string, string> = primary.fieldMapping as Record<string, string>;
  if (fallback.fieldMapping !== undefined) {
    if (!isPlainObject(fallback.fieldMapping)) {
      failWorkflow('INVALID_VALUE');
    }
    validateFieldMapping(step, fallback.fieldMapping, workflowFieldNames, context);
    fieldMapping = fallback.fieldMapping;
  }

  return {
    name: fallback.name,
    id: fallback.id,
    type: fallback.type,
    canReject: primary.canReject,
    async: primary.async,
    order: primary.order,
    fieldMapping: Object.fromEntries(Object.entries(fieldMapping)),
    config: normalizeConnectorConfig(fallback.config),
  };
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

    // Whether `errorHandler` names a registered handler is the engine's check, not the DDL's —
    // the same split that already applies to connector `id`.
    if (connector.errorHandler !== undefined) {
      if (
        typeof connector.errorHandler !== 'string' ||
        connector.errorHandler.trim().length === 0
      ) {
        failWorkflow('INVALID_VALUE');
      }
    }

    const normalizedConnector: NormalizedWorkflowConnectorDeclaration = {
      name: connector.name,
      id: connector.id,
      type: connector.type,
      canReject,
      async,
      order: connector.order,
      fieldMapping: Object.fromEntries(Object.entries(connector.fieldMapping)),
      config,
    };

    if (connector.errorHandler !== undefined) {
      normalizedConnector.errorHandler = connector.errorHandler;
    }

    if (connector.fallback !== undefined) {
      normalizedConnector.fallback = normalizeConnectorFallback(
        step,
        normalizedConnector,
        connector.fallback,
        workflowFieldNames,
        context,
      );
    }

    normalized.push(normalizedConnector);
  }

  normalized.sort((left, right) => left.order - right.order);

  return normalized;
};
