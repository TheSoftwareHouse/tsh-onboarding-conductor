import { isJsonCompatibleValue, isPlainObject } from '../value-guards';
import {
  CONNECTOR_RETRY_BOUNDS,
  CONNECTOR_TYPES,
  DEFAULT_CONNECTOR_RETRY,
  MAX_CONNECTOR_FALLBACK_CHAIN_LENGTH,
  type ConnectorType,
  type NormalizedWorkflowConnectorDeclaration,
  type NormalizedWorkflowConnectorFallback,
  type NormalizedWorkflowConnectorRetry,
  type RawWorkflowConnectorFallbackDeclaration,
  type RawWorkflowConnectorRetryDeclaration,
  type CompiledWorkflowStep,
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
 *
 * An optional mapping is exempt from the "always runs before it" half, because that is precisely
 * what it declares: a source written on only one branch is absent on the others, which is the case
 * `optionalFieldMapping` exists to describe. The value must still be persisted — an unpersisted
 * cross-step source is absent on *every* path, which is an authoring error rather than optionality.
 */
const validateFieldMapping = (
  step: CompiledWorkflowStep,
  fieldMapping: Record<string, string>,
  workflowFieldNames: ReadonlySet<string>,
  context: ConnectorMappingContext,
  optional = false,
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

    if (!optional) {
      const guaranteedPredecessors = context.guaranteedPredecessorsByStepName[step.name];
      if (guaranteedPredecessors === undefined) {
        failWorkflow('INVALID_VALUE');
      }

      if (!guaranteedPredecessors.has(sourceDeclaration.stepName)) {
        failWorkflow('INVALID_VALUE');
      }
    }

    if (!sourceDeclaration.persist) {
      failWorkflow('INVALID_VALUE');
    }
  }
};

const isBoundedInteger = (value: unknown, minimum: number, maximum: number): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;

/**
 * Resolves a declared `retry` over the policy it inherits — `DEFAULT_CONNECTOR_RETRY` for a
 * primary, the primary's resolved policy for a chain entry. The merge is field-wise on purpose: an
 * entry naming only `maxAttempts` keeps the interval the slot already declared, so a slot with one
 * policy on the primary applies it to the whole chain without repeating it.
 *
 * The bounds are re-checked here rather than left to the JSON Schema: the schema only sees
 * documents loaded from disk, while a definition built in code reaches normalization directly.
 */
const normalizeConnectorRetry = (
  retry: unknown,
  inherited: NormalizedWorkflowConnectorRetry,
): NormalizedWorkflowConnectorRetry => {
  if (retry === undefined) {
    return { ...inherited };
  }

  if (!isPlainObject(retry)) {
    failWorkflow('INVALID_VALUE');
  }

  const declared = retry as RawWorkflowConnectorRetryDeclaration;
  const maxAttempts = declared.maxAttempts ?? inherited.maxAttempts;
  const delayMs = declared.delayMs ?? inherited.delayMs;

  if (
    !isBoundedInteger(
      maxAttempts,
      CONNECTOR_RETRY_BOUNDS.minAttempts,
      CONNECTOR_RETRY_BOUNDS.maxAttempts,
    )
  ) {
    failWorkflow('INVALID_VALUE');
  }

  if (
    !isBoundedInteger(delayMs, CONNECTOR_RETRY_BOUNDS.minDelayMs, CONNECTOR_RETRY_BOUNDS.maxDelayMs)
  ) {
    failWorkflow('INVALID_VALUE');
  }

  return { maxAttempts, delayMs };
};

/**
 * A fallback inherits `order`, `async` and `canReject` from the primary it belongs to — they
 * describe the step's slot, not the provider filling it — its `fieldMapping` when it declares
 * none, since same-`type` adapters often share a payload contract, and its `retry` field-wise.
 * `config` is never inherited: it is adapter-specific, and handing a fallback the primary's config
 * would be a bug no author wrote.
 *
 * `id` is checked against the whole chain rather than the primary alone. An entry repeating an
 * adapter already in the chain would re-ask a provider that has just run out of attempts, which is
 * what `retry` is for — and an operator reading an audit row could not tell the two hops apart.
 */
const normalizeConnectorFallbacks = (
  step: CompiledWorkflowStep,
  primary: NormalizedWorkflowConnectorDeclaration,
  fallbacks: readonly RawWorkflowConnectorFallbackDeclaration[] | undefined,
  workflowFieldNames: ReadonlySet<string>,
  context: ConnectorMappingContext,
): NormalizedWorkflowConnectorFallback[] => {
  if (fallbacks === undefined) {
    return [];
  }

  // An empty array is an authoring mistake rather than "no fallback": omit the key instead.
  if (
    !Array.isArray(fallbacks) ||
    fallbacks.length === 0 ||
    fallbacks.length > MAX_CONNECTOR_FALLBACK_CHAIN_LENGTH
  ) {
    failWorkflow('INVALID_VALUE');
  }

  const chainIds = new Set<string>([primary.id]);
  const normalized: NormalizedWorkflowConnectorFallback[] = [];

  for (const fallback of fallbacks) {
    if (!isPlainObject(fallback)) {
      failWorkflow('INVALID_VALUE');
    }
    if (typeof fallback.name !== 'string' || fallback.name.trim().length === 0) {
      failWorkflow('INVALID_VALUE');
    }
    if (typeof fallback.id !== 'string' || fallback.id.trim().length === 0) {
      failWorkflow('INVALID_VALUE');
    }
    if (chainIds.has(fallback.id)) {
      failWorkflow('INVALID_VALUE');
    }
    if (
      !CONNECTOR_TYPES.includes(fallback.type as ConnectorType) ||
      fallback.type !== primary.type
    ) {
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

    // `optionalFieldMapping` inherits exactly as `fieldMapping` does: the executor builds each
    // chain link's payload from that link alone, so a fallback that dropped the primary's optional
    // sources would silently send a narrower payload than the connector it stands in for.
    let optionalFieldMapping: Record<string, string> = primary.optionalFieldMapping as Record<
      string,
      string
    >;
    if (fallback.optionalFieldMapping !== undefined) {
      if (!isPlainObject(fallback.optionalFieldMapping)) {
        failWorkflow('INVALID_VALUE');
      }
      validateFieldMapping(step, fallback.optionalFieldMapping, workflowFieldNames, context, true);
      optionalFieldMapping = fallback.optionalFieldMapping;
    }

    // Checked against the resolved pair, not the declared one: either side may have been
    // inherited, and a payload key cannot be required and optional at once.
    for (const payloadKey of Object.keys(optionalFieldMapping)) {
      if (payloadKey in fieldMapping) {
        failWorkflow('INVALID_VALUE');
      }
    }

    chainIds.add(fallback.id);
    normalized.push({
      name: fallback.name,
      id: fallback.id,
      type: fallback.type,
      canReject: primary.canReject,
      async: primary.async,
      order: primary.order,
      fieldMapping: Object.fromEntries(Object.entries(fieldMapping)),
      optionalFieldMapping: Object.fromEntries(Object.entries(optionalFieldMapping)),
      config: normalizeConnectorConfig(fallback.config),
      retry: normalizeConnectorRetry(fallback.retry, primary.retry),
    });
  }

  return normalized;
};

/**
 * Rejection routing is not checked here: `validateRejectionTargets` in the transition normalizer
 * owns that rule, so it applies uniformly to every step whether or not it declares connectors.
 */
export const normalizeConnectors = (
  step: CompiledWorkflowStep,
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

    const optionalFieldMapping = connector.optionalFieldMapping ?? {};
    if (!isPlainObject(optionalFieldMapping)) {
      failWorkflow('INVALID_VALUE');
    }

    for (const payloadKey of Object.keys(optionalFieldMapping)) {
      if (payloadKey in connector.fieldMapping) {
        failWorkflow('INVALID_VALUE');
      }
    }

    validateFieldMapping(step, connector.fieldMapping, workflowFieldNames, context);
    validateFieldMapping(step, optionalFieldMapping, workflowFieldNames, context, true);

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
      optionalFieldMapping: Object.fromEntries(Object.entries(optionalFieldMapping)),
      config,
      retry: normalizeConnectorRetry(connector.retry, DEFAULT_CONNECTOR_RETRY),
      fallbacks: [],
    };

    if (connector.errorHandler !== undefined) {
      normalizedConnector.errorHandler = connector.errorHandler;
    }

    // Assigned after the primary is built, because every entry resolves against it.
    normalizedConnector.fallbacks = normalizeConnectorFallbacks(
      step,
      normalizedConnector,
      connector.fallback,
      workflowFieldNames,
      context,
    );

    normalized.push(normalizedConnector);
  }

  normalized.sort((left, right) => left.order - right.order);

  return normalized;
};
