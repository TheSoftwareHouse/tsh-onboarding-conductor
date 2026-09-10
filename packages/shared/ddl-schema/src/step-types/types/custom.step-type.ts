import { isPlainObject } from '../../value-guards';
import {
  WORKFLOW_STATUSES,
  type RawWorkflowConnectorDeclaration,
  type RawWorkflowScoringRule,
  type RawWorkflowStepAgreementDeclaration,
  type CompiledWorkflowStep,
  type RawWorkflowTransition,
  type WorkflowStatus,
} from '../../workflow-contract';
import { asConfigObject, readObjectList } from '../step-config.utils';
import { SINGLE_STEP_KEYS } from '../step-compile.utils';
import type {
  JsonSchemaFragment,
  StepFieldMap,
  WorkflowStepCompilationContext,
  WorkflowStepPort,
  WorkflowStepTypeDefinition,
} from '../step-type.port';

export type CustomStepConfig = {
  readonly status: WorkflowStatus;
  readonly data: StepFieldMap;
  readonly connectors?: readonly RawWorkflowConnectorDeclaration[];
  readonly scoring?: readonly RawWorkflowScoringRule[];
  readonly agreements?: readonly RawWorkflowStepAgreementDeclaration[];
  readonly transitions: readonly RawWorkflowTransition[];
};

/**
 * A hand-written step, verbatim — the guarantee that typed steps, the only form a document can be
 * authored in, are never less expressive than the compiled form they compile to. Anything a
 * specialized type cannot say is still sayable here, and a document written as untyped steps
 * migrates mechanically: one of these per step, the step's members as its config
 * (`convertUntypedSteps` does exactly that).
 *
 * It has no ports, and its `transitions` name **compiled step** names rather than ports. That is
 * the cost of the verbatim guarantee: a hand-written transition is not an edge a canvas can draw, so
 * a builder renders this step as opaque. Its config is validated against the compiled schema's own
 * definitions, so a mistake is reported at `steps[i].config.…` before anything compiles.
 */
export const customStepTypeDefinition = {
  type: 'custom',
  category: 'integrate',
  buildConfigSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['transitions'],
      properties: {
        status: { enum: [...WORKFLOW_STATUSES] },
        data: {
          type: 'object',
          propertyNames: { $ref: '#/definitions/safeName' },
          additionalProperties: { $ref: '#/definitions/rootFieldDescriptor' },
        },
        connectors: { type: 'array', items: { $ref: '#/definitions/connectorDeclaration' } },
        scoring: { type: 'array', minItems: 1, items: { $ref: '#/definitions/scoringRule' } },
        agreements: {
          type: 'array',
          minItems: 1,
          items: { $ref: '#/definitions/stepAgreementDeclaration' },
        },
        transitions: { type: 'array', items: { $ref: '#/definitions/transition' } },
      },
    };
  },
  parseConfig(config, fail): CustomStepConfig {
    const source = asConfigObject(config, fail);
    const status = source.status ?? 'awaiting_user';

    if (!WORKFLOW_STATUSES.includes(status as WorkflowStatus)) {
      fail('INVALID_VALUE');
    }

    if (source.data !== undefined && !isPlainObject(source.data)) {
      fail('INVALID_VALUE');
    }

    return {
      status: status as WorkflowStatus,
      data: (source.data as StepFieldMap | undefined) ?? {},
      connectors:
        source.connectors === undefined
          ? undefined
          : readObjectList<RawWorkflowConnectorDeclaration>(source.connectors, fail),
      scoring:
        source.scoring === undefined
          ? undefined
          : readObjectList<RawWorkflowScoringRule>(source.scoring, fail),
      agreements:
        source.agreements === undefined
          ? undefined
          : readObjectList<RawWorkflowStepAgreementDeclaration>(source.agreements, fail),
      transitions: readObjectList<RawWorkflowTransition>(source.transitions, fail),
    };
  },
  listPorts(): readonly WorkflowStepPort[] {
    return [];
  },
  listSubStepKeys(): readonly (string | null)[] {
    return SINGLE_STEP_KEYS;
  },
  buildFields(config: CustomStepConfig): StepFieldMap {
    return { ...config.data };
  },
  compile(context: WorkflowStepCompilationContext<CustomStepConfig>): CompiledWorkflowStep[] {
    const { config } = context;

    return [
      {
        name: context.stepNames[0],
        status: config.status,
        data: context.fields,
        ...(config.connectors === undefined ? {} : { connectors: [...config.connectors] }),
        ...(config.scoring === undefined ? {} : { scoring: [...config.scoring] }),
        ...(config.agreements === undefined ? {} : { agreements: [...config.agreements] }),
        transitions: [...config.transitions],
      },
    ];
  },
} as const satisfies WorkflowStepTypeDefinition<CustomStepConfig>;
