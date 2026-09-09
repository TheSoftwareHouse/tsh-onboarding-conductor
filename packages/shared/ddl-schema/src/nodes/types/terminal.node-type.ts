import {
  TERMINAL_WORKFLOW_STATUSES,
  type RawWorkflowStep,
  type TerminalWorkflowStatus,
} from '../../workflow-contract';
import { asConfigObject } from '../node-config.utils';
import { SINGLE_STEP_KEYS } from '../node-step.utils';
import type {
  JsonSchemaFragment,
  NodeFieldMap,
  WorkflowNodeCompilationContext,
  WorkflowNodePort,
  WorkflowNodeTypeDefinition,
} from '../node-type.port';

export type TerminalNodeConfig = {
  readonly outcome: TerminalWorkflowStatus;
};

/**
 * Where an onboarding stops. One node type for all three outcomes rather than three, because the
 * outcome is the only thing that differs — a terminal step carries no data, no connectors and no
 * transitions, and the engine refuses one that carries any of them.
 */
export const terminalNodeTypeDefinition = {
  type: 'terminal',
  category: 'terminal',
  buildConfigSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['outcome'],
      properties: { outcome: { enum: [...TERMINAL_WORKFLOW_STATUSES] } },
    };
  },
  parseConfig(config, fail): TerminalNodeConfig {
    const source = asConfigObject(config, fail);

    if (!TERMINAL_WORKFLOW_STATUSES.includes(source.outcome as TerminalWorkflowStatus)) {
      fail('INVALID_VALUE');
    }

    return { outcome: source.outcome as TerminalWorkflowStatus };
  },
  listPorts(): readonly WorkflowNodePort[] {
    return [];
  },
  listSubStepKeys(): readonly (string | null)[] {
    return SINGLE_STEP_KEYS;
  },
  buildFields(): NodeFieldMap {
    return {};
  },
  compile(context: WorkflowNodeCompilationContext<TerminalNodeConfig>): RawWorkflowStep[] {
    // An `include` on a terminal node would produce a step the engine refuses to load, so the
    // mistake is named here instead of surfacing as an opaque INVALID_TERMINAL_STEP.
    if (Object.keys(context.fields).length > 0) {
      context.fail('INVALID_TERMINAL_STEP');
    }

    return [
      { name: context.stepNames[0], status: context.config.outcome, data: {}, transitions: [] },
    ];
  },
} as const satisfies WorkflowNodeTypeDefinition<TerminalNodeConfig>;
