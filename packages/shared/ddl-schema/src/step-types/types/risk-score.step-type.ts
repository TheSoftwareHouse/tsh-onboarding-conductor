import { isInteger, isPlainObject } from '../../value-guards';
import type { RawWorkflowCondition } from '../../workflow-condition';
import {
  WORKFLOW_SCORE_COMPARATORS,
  type RawWorkflowScoringRule,
  type CompiledWorkflowStep,
  type RawWorkflowTransition,
  type WorkflowScoreComparator,
} from '../../workflow-contract';
import {
  asConfigObject,
  DEFAULT_PORT,
  portNameSchema,
  readCondition,
  readOptionalBoolean,
  readString,
} from '../step-config.utils';
import { buildSuccessTransition, SINGLE_STEP_KEYS } from '../step-compile.utils';
import type {
  FailWorkflow,
  JsonSchemaFragment,
  StepFieldMap,
  WorkflowStepCompilationContext,
  WorkflowStepPort,
  WorkflowStepTypeDefinition,
} from '../step-type.port';

export type RiskScoreBand = {
  readonly port: string;
  readonly score: string;
  readonly comparator: WorkflowScoreComparator;
  readonly threshold: number;
};

export type RiskScoreStepConfig = {
  readonly rules: readonly RawWorkflowScoringRule[];
  readonly bands: readonly RiskScoreBand[];
  readonly fallback: boolean;
};

const parseRule = (value: unknown, fail: FailWorkflow): RawWorkflowScoringRule => {
  if (!isPlainObject(value)) {
    fail('INVALID_VALUE');
  }

  const source = value as Record<string, unknown>;

  if (!isInteger(source.add)) {
    fail('INVALID_VALUE');
  }

  return {
    score: readString(source.score, fail),
    ...(source.when === undefined ? {} : { when: readCondition(source.when, fail) }),
    add: source.add as number,
  };
};

const parseBand = (value: unknown, fail: FailWorkflow): RiskScoreBand => {
  if (!isPlainObject(value)) {
    fail('INVALID_VALUE');
  }

  const source = value as Record<string, unknown>;
  const port = readString(source.port, fail);

  if (port === DEFAULT_PORT) {
    fail('INVALID_VALUE');
  }

  const comparators = WORKFLOW_SCORE_COMPARATORS.filter((candidate) => candidate in source);

  // Exactly one: two comparators on one band would be an interval written as if it were a bound.
  if (comparators.length !== 1) {
    fail('INVALID_VALUE');
  }

  const comparator = comparators[0];

  if (!isInteger(source[comparator])) {
    fail('INVALID_VALUE');
  }

  return {
    port,
    score: readString(source.score, fail),
    comparator,
    threshold: source[comparator] as number,
  };
};

/**
 * Accumulating a named score and routing on the band it lands in. The rules are the DDL's own
 * `scoring` mechanism — every matching rule's `add` is summed and clamped once per step — and the
 * bands become the score conditions a transition may carry.
 *
 * Bands rather than raw comparators because that is what the ports have to be: `low`, `medium` and
 * `high` are drawable, `{"score":"risk","gte":40}` is not. Order matters and is the author's — the
 * first band whose bound holds wins, so a document declares its narrowest band first.
 *
 * Like `decision`, this collects nothing and so costs a round trip: the engine only recomputes
 * scores and re-evaluates transitions on a submit.
 */
export const riskScoreStepTypeDefinition = {
  type: 'risk-score',
  category: 'decide',
  buildConfigSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['rules', 'bands'],
      properties: {
        rules: {
          type: 'array',
          minItems: 1,
          items: { $ref: '#/definitions/scoringRule' },
        },
        bands: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['port', 'score'],
            properties: {
              port: portNameSchema(),
              score: { type: 'string', minLength: 1 },
              ...Object.fromEntries(
                WORKFLOW_SCORE_COMPARATORS.map((comparator) => [comparator, { type: 'integer' }]),
              ),
            },
          },
        },
        fallback: { type: 'boolean' },
      },
    };
  },
  parseConfig(config, fail): RiskScoreStepConfig {
    const source = asConfigObject(config, fail);

    if (!Array.isArray(source.rules) || source.rules.length === 0) {
      fail('INVALID_VALUE');
    }

    if (!Array.isArray(source.bands) || source.bands.length === 0) {
      fail('INVALID_VALUE');
    }

    const bands = (source.bands as readonly unknown[]).map((entry) => parseBand(entry, fail));

    if (new Set(bands.map((band) => band.port)).size !== bands.length) {
      fail('DUPLICATE_TRANSITION');
    }

    return {
      rules: (source.rules as readonly unknown[]).map((entry) => parseRule(entry, fail)),
      bands,
      fallback: readOptionalBoolean(source.fallback, fail) ?? false,
    };
  },
  listPorts(config: RiskScoreStepConfig): readonly WorkflowStepPort[] {
    return [
      ...config.bands.map((band) => ({ name: band.port })),
      ...(config.fallback ? [{ name: DEFAULT_PORT }] : []),
    ];
  },
  listSubStepKeys(): readonly (string | null)[] {
    return SINGLE_STEP_KEYS;
  },
  buildFields(): StepFieldMap {
    return {};
  },
  resolveScoringStepKey(): undefined {
    // The rules are this step's config; a second list beside them would be two ways to say one thing.
    return undefined;
  },
  compile(context: WorkflowStepCompilationContext<RiskScoreStepConfig>): CompiledWorkflowStep[] {
    const transitions: RawWorkflowTransition[] = context.config.bands.map((band) => ({
      status: 'success',
      when: { score: band.score, [band.comparator]: band.threshold } as RawWorkflowCondition,
      target: context.targets[band.port],
    }));

    if (context.config.fallback) {
      transitions.push(buildSuccessTransition(context.targets[DEFAULT_PORT]));
    }

    return [
      {
        name: context.stepNames[0],
        status: 'awaiting_user',
        data: context.fields,
        scoring: [...context.config.rules],
        transitions,
      },
    ];
  },
} as const satisfies WorkflowStepTypeDefinition<RiskScoreStepConfig>;
