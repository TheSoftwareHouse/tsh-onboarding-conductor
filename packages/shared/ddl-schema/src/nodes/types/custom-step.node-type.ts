import { isPlainObject } from '../../value-guards';
import {
  WORKFLOW_STATUSES,
  type RawWorkflowConnectorDeclaration,
  type RawWorkflowScoringRule,
  type RawWorkflowStep,
  type RawWorkflowTransition,
  type WorkflowStatus,
} from '../../workflow-contract';
import { asConfigObject } from '../node-config.utils';
import { SINGLE_STEP_KEYS } from '../node-step.utils';
import type {
  FailWorkflow,
  JsonSchemaFragment,
  NodeFieldMap,
  WorkflowNodeCompilationContext,
  WorkflowNodePort,
  WorkflowNodeTypeDefinition,
} from '../node-type.port';

export type CustomStepNodeConfig = {
  readonly status: WorkflowStatus;
  readonly data: NodeFieldMap;
  readonly connectors?: readonly RawWorkflowConnectorDeclaration[];
  readonly scoring?: readonly RawWorkflowScoringRule[];
  readonly transitions: readonly RawWorkflowTransition[];
};

const readObjectList = <TEntry>(value: unknown, fail: FailWorkflow): readonly TEntry[] => {
  if (!Array.isArray(value)) {
    fail('INVALID_VALUE');
  }

  for (const entry of value as readonly unknown[]) {
    if (!isPlainObject(entry)) {
      fail('INVALID_VALUE');
    }
  }

  return value as readonly TEntry[];
};

/**
 * A hand-written step, verbatim, inside a node graph — the escape hatch that guarantees the node
 * form is never less expressive than the step form it compiles to. Anything a specialized type
 * cannot say is still sayable here, and a document can be migrated one node at a time.
 *
 * It has no ports, and its `transitions` name **step** names rather than node names. That is the
 * cost of the verbatim guarantee: a hand-written transition is not an edge a canvas can draw, so a
 * builder renders this node as opaque.
 */
export const customStepNodeTypeDefinition = {
  type: 'custom-step',
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
        connectors: { type: 'array', items: { type: 'object' } },
        scoring: { type: 'array', minItems: 1, items: { $ref: '#/definitions/scoringRule' } },
        transitions: { type: 'array', items: { type: 'object' } },
      },
    };
  },
  parseConfig(config, fail): CustomStepNodeConfig {
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
      data: (source.data as NodeFieldMap | undefined) ?? {},
      connectors:
        source.connectors === undefined
          ? undefined
          : readObjectList<RawWorkflowConnectorDeclaration>(source.connectors, fail),
      scoring:
        source.scoring === undefined
          ? undefined
          : readObjectList<RawWorkflowScoringRule>(source.scoring, fail),
      transitions: readObjectList<RawWorkflowTransition>(source.transitions, fail),
    };
  },
  listPorts(): readonly WorkflowNodePort[] {
    return [];
  },
  listSubStepKeys(): readonly (string | null)[] {
    return SINGLE_STEP_KEYS;
  },
  buildFields(config: CustomStepNodeConfig): NodeFieldMap {
    return { ...config.data };
  },
  compile(context: WorkflowNodeCompilationContext<CustomStepNodeConfig>): RawWorkflowStep[] {
    const { config } = context;

    return [
      {
        name: context.stepNames[0],
        status: config.status,
        data: context.fields,
        ...(config.connectors === undefined ? {} : { connectors: [...config.connectors] }),
        ...(config.scoring === undefined ? {} : { scoring: [...config.scoring] }),
        transitions: [...config.transitions],
      },
    ];
  },
} as const satisfies WorkflowNodeTypeDefinition<CustomStepNodeConfig>;
