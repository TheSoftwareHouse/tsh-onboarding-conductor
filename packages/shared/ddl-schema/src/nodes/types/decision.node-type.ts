import { isPlainObject } from '../../value-guards';
import type { RawWorkflowCondition } from '../../workflow-condition';
import type { RawWorkflowStep, RawWorkflowTransition } from '../../workflow-contract';
import {
  asConfigObject,
  DEFAULT_PORT,
  portNameSchema,
  readCondition,
  readOptionalBoolean,
  readString,
} from '../node-config.utils';
import { buildSuccessTransition, SINGLE_STEP_KEYS } from '../node-step.utils';
import type {
  FailWorkflow,
  JsonSchemaFragment,
  NodeFieldMap,
  WorkflowNodeCompilationContext,
  WorkflowNodePort,
  WorkflowNodeTypeDefinition,
} from '../node-type.port';

export type DecisionBranch = {
  readonly port: string;
  readonly when: RawWorkflowCondition;
};

export type DecisionNodeConfig = {
  readonly branches: readonly DecisionBranch[];
  /**
   * Whether to expose a catch-all port. Off by default: with exhaustive branches, a value nobody
   * anticipated should surface as an `invalid` onboarding rather than be absorbed by an
   * "everything else" arm that routes it somewhere plausible and wrong.
   */
  readonly fallback: boolean;
};

const parseBranch = (value: unknown, fail: FailWorkflow): DecisionBranch => {
  if (!isPlainObject(value)) {
    fail('INVALID_VALUE');
  }

  const source = value as Record<string, unknown>;
  const port = readString(source.port, fail);

  if (port === DEFAULT_PORT) {
    fail('INVALID_VALUE');
  }

  return { port, when: readCondition(source.when, fail) };
};

/**
 * A branch point with nothing to collect: it reads what earlier steps already wrote and routes on
 * it. The diamond on a canvas, where the condition would otherwise be buried on an edge.
 *
 * It costs a round trip. The engine advances an onboarding only on a submit, so a step with no
 * data and no connector still needs an empty `POST /submit` to move past it. Prefer a specialized
 * node's own ports — `document-choice` routes on the same submit that collects the choice — and
 * reach for this when the condition genuinely has no step of its own to hang off.
 */
export const decisionNodeTypeDefinition = {
  type: 'decision',
  category: 'decide',
  buildConfigSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['branches'],
      properties: {
        branches: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['port', 'when'],
            properties: {
              port: portNameSchema(),
              when: { $ref: '#/definitions/transitionCondition' },
            },
          },
        },
        fallback: { type: 'boolean' },
      },
    };
  },
  parseConfig(config, fail): DecisionNodeConfig {
    const source = asConfigObject(config, fail);

    if (!Array.isArray(source.branches) || source.branches.length === 0) {
      fail('INVALID_VALUE');
    }

    const branches = (source.branches as readonly unknown[]).map((entry) =>
      parseBranch(entry, fail),
    );

    if (new Set(branches.map((branch) => branch.port)).size !== branches.length) {
      fail('DUPLICATE_TRANSITION');
    }

    return { branches, fallback: readOptionalBoolean(source.fallback, fail) ?? false };
  },
  listPorts(config: DecisionNodeConfig): readonly WorkflowNodePort[] {
    return [
      ...config.branches.map((branch) => ({ name: branch.port })),
      ...(config.fallback ? [{ name: DEFAULT_PORT }] : []),
    ];
  },
  listSubStepKeys(): readonly (string | null)[] {
    return SINGLE_STEP_KEYS;
  },
  buildFields(): NodeFieldMap {
    return {};
  },
  compile(context: WorkflowNodeCompilationContext<DecisionNodeConfig>): RawWorkflowStep[] {
    const transitions: RawWorkflowTransition[] = context.config.branches.map((branch) => ({
      status: 'success',
      when: branch.when,
      target: context.targets[branch.port],
    }));

    if (context.config.fallback) {
      // Last, and unconditional: the status group's only unqualified arm.
      transitions.push(buildSuccessTransition(context.targets[DEFAULT_PORT]));
    }

    return [
      {
        name: context.stepNames[0],
        status: 'awaiting_user',
        data: context.fields,
        transitions,
      },
    ];
  },
} as const satisfies WorkflowNodeTypeDefinition<DecisionNodeConfig>;
