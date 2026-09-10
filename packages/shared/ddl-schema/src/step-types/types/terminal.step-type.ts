import {
  TERMINAL_WORKFLOW_STATUSES,
  type CompiledWorkflowStep,
  type TerminalWorkflowStatus,
} from '../../workflow-contract';
import { asConfigObject } from '../step-config.utils';
import { SINGLE_STEP_KEYS } from '../step-compile.utils';
import type {
  JsonSchemaFragment,
  StepFieldMap,
  WorkflowStepCompilationContext,
  WorkflowStepPort,
  WorkflowStepTypeDefinition,
} from '../step-type.port';

export type TerminalStepConfig = {
  readonly outcome: TerminalWorkflowStatus;
};

/**
 * Where an onboarding stops. One step type for all three outcomes rather than three, because the
 * outcome is the only thing that differs — a terminal step carries no data, no connectors and no
 * transitions, and the engine refuses one that carries any of them.
 */
export const terminalStepTypeDefinition = {
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
  parseConfig(config, fail): TerminalStepConfig {
    const source = asConfigObject(config, fail);

    if (!TERMINAL_WORKFLOW_STATUSES.includes(source.outcome as TerminalWorkflowStatus)) {
      fail('INVALID_VALUE');
    }

    return { outcome: source.outcome as TerminalWorkflowStatus };
  },
  listPorts(): readonly WorkflowStepPort[] {
    return [];
  },
  listSubStepKeys(): readonly (string | null)[] {
    return SINGLE_STEP_KEYS;
  },
  buildFields(): StepFieldMap {
    return {};
  },
  resolveScoringStepKey(): undefined {
    // Nothing is ever submitted on a terminal step, so a rule here would never be evaluated.
    return undefined;
  },
  compile(context: WorkflowStepCompilationContext<TerminalStepConfig>): CompiledWorkflowStep[] {
    // An `include` on a terminal step would produce a step the engine refuses to load, so the
    // mistake is named here instead of surfacing as an opaque INVALID_TERMINAL_STEP.
    if (Object.keys(context.fields).length > 0) {
      context.fail('INVALID_TERMINAL_STEP');
    }

    return [
      { name: context.stepNames[0], status: context.config.outcome, data: {}, transitions: [] },
    ];
  },
} as const satisfies WorkflowStepTypeDefinition<TerminalStepConfig>;
