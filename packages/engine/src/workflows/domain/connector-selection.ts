import type {
  NormalizedWorkflowConnectorDeclaration,
  NormalizedWorkflowDefinition,
  NormalizedWorkflowStep,
} from '@tsh/ddl-schema';
import type { ConnectorScope } from '../../connectors/connector-adapter-scope';
import type {
  ConnectorAdapterSummary,
  ConnectorExecutionPort,
} from '../../connectors/ports/connector-execution.port';

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

/** Why a stored version refuses the connector an operator asked a step to run. */
export const WORKFLOW_CONNECTOR_SELECTION_INVALID_REASONS = [
  'no_connector',
  'multiple_connectors',
  'in_fallback_chain',
  'adapter_not_registered',
  'fixture_not_allowed',
  'type_mismatch',
  'async_unsupported',
  'callback_fields_missing',
  'declaration_invalid',
] as const;

export type WorkflowConnectorSelectionInvalidReason =
  (typeof WORKFLOW_CONNECTOR_SELECTION_INVALID_REASONS)[number];

/** The first rule a candidate fails, with the adapter's own words when the rule has any. */
export type WorkflowConnectorSelectionRefusal = Readonly<{
  reason: WorkflowConnectorSelectionInvalidReason;
  detail?: string;
}>;

/**
 * The one statement of which adapter may serve a step's connector slot. The admin projection lists
 * what these rules accept and the selection write refuses what they refuse, so an id the panel
 * offers is an id a save takes — the two cannot drift because there is only one of them.
 *
 * Built from the execution port and the active scopes rather than the adapter collection, since
 * the port is the only way the workflow side reaches the adapters; without a port nothing is
 * registered, so nothing beyond the authored and effective ids is offered.
 */
export class ConnectorSelectionRules {
  constructor(
    private readonly connectorExecutionPort: ConnectorExecutionPort | undefined,
    private readonly activeScopes: readonly ConnectorScope[],
  ) {}

  /**
   * The registered adapters an operator may choose among in this environment: every adapter the
   * port lists, minus those whose scope is inactive — `fixtures` in production, like the fixture
   * workflows.
   */
  listSelectableAdapters(): readonly ConnectorAdapterSummary[] {
    return (this.connectorExecutionPort?.listAdapters?.() ?? []).filter((adapter) =>
      this.activeScopes.includes(adapter.scope),
    );
  }

  /** The first reason this step cannot run the adapter in its slot, or `undefined` when it can. */
  refuse(
    step: NormalizedWorkflowStep,
    connectorId: string,
  ): WorkflowConnectorSelectionRefusal | undefined {
    const slot = findSelectableConnector(step);

    if (slot === undefined) {
      return { reason: step.connectors.length === 0 ? 'no_connector' : 'multiple_connectors' };
    }

    if (slot.fallbacks.some((fallback) => fallback.id === connectorId)) {
      return { reason: 'in_fallback_chain' };
    }

    const adapter = this.connectorExecutionPort
      ?.listAdapters?.()
      .find((candidate) => candidate.id === connectorId);

    if (adapter === undefined) {
      return { reason: 'adapter_not_registered' };
    }

    if (!this.activeScopes.includes(adapter.scope)) {
      return { reason: 'fixture_not_allowed' };
    }

    if (adapter.type !== slot.type) {
      return { reason: 'type_mismatch' };
    }

    if (slot.async && !adapter.supportsAsyncCallback) {
      return { reason: 'async_unsupported' };
    }

    const missingField = adapter.callbackFields.find(
      (field) => !Object.prototype.hasOwnProperty.call(step.data, field),
    );

    if (missingField !== undefined) {
      return {
        reason: 'callback_fields_missing',
        detail: `the step does not declare "${missingField}"`,
      };
    }

    try {
      this.connectorExecutionPort.validateDeclarations?.([{ ...slot, id: connectorId }]);
    } catch (cause) {
      return {
        reason: 'declaration_invalid',
        detail: cause instanceof Error ? cause.message : String(cause),
      };
    }

    return undefined;
  }

  /**
   * The ids a save would accept for the step as authored, sorted and unique: the authored and
   * effective ids, which are listed even when nothing is registered, plus every selectable adapter
   * `refuse` lets through. Empty for a step a selection cannot address at all — no connector, or
   * more than one — because offering ids there would only promise a refusal.
   */
  listSelectableIds(
    step: NormalizedWorkflowStep,
    authoredId: string,
    effectiveId: string,
  ): string[] {
    if (findSelectableConnector(step) === undefined) {
      return [];
    }

    return [
      ...new Set([
        authoredId,
        effectiveId,
        ...this.listSelectableAdapters()
          .filter((adapter) => this.refuse(step, adapter.id) === undefined)
          .map((adapter) => adapter.id),
      ]),
    ].sort();
  }
}
