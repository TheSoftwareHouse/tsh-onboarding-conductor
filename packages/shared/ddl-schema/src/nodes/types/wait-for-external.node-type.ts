import type { RawWorkflowStep } from '../../workflow-contract';
import { asConfigObject, fieldMapSchema, readFieldMap } from '../node-config.utils';
import { buildSuccessTransition, SINGLE_STEP_KEYS } from '../node-step.utils';
import type {
  JsonSchemaFragment,
  NodeFieldMap,
  WorkflowNodeCompilationContext,
  WorkflowNodePort,
  WorkflowNodeTypeDefinition,
} from '../node-type.port';

export const WAIT_RECEIVED_PORT = 'received';

export type WaitForExternalNodeConfig = {
  readonly fields: NodeFieldMap;
};

/**
 * Waiting for a value only another system can supply — the account number a core banking platform
 * mints, a reference a back office assigns. Structurally a collection step; what differs is who
 * fills it in, which is the whole reason it is worth its own node type on a canvas: an operator
 * reading the graph can see that nothing here is asked of the customer.
 *
 * There is no timeout port. Nothing in the engine schedules work against a parked onboarding —
 * BullMQ carries outbound webhooks only — so a deadline declared here could never fire, and
 * declaring one anyway would be a promise the runtime does not keep.
 */
export const waitForExternalNodeTypeDefinition = {
  type: 'wait-for-external',
  category: 'integrate',
  buildConfigSchema(): JsonSchemaFragment {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['fields'],
      properties: { fields: fieldMapSchema() },
    };
  },
  parseConfig(config, fail): WaitForExternalNodeConfig {
    const source = asConfigObject(config, fail);

    return { fields: readFieldMap(source.fields, fail) as NodeFieldMap };
  },
  listPorts(): readonly WorkflowNodePort[] {
    return [{ name: WAIT_RECEIVED_PORT }];
  },
  listSubStepKeys(): readonly (string | null)[] {
    return SINGLE_STEP_KEYS;
  },
  buildFields(config: WaitForExternalNodeConfig): NodeFieldMap {
    return { ...config.fields };
  },
  compile(context: WorkflowNodeCompilationContext<WaitForExternalNodeConfig>): RawWorkflowStep[] {
    return [
      {
        name: context.stepNames[0],
        status: 'awaiting_user',
        data: context.fields,
        // The port is `received` rather than `success`, but the arm a single outcome compiles to
        // is the same one — the name is authoring vocabulary, not a different transition.
        transitions: [buildSuccessTransition(context.targets[WAIT_RECEIVED_PORT])],
      },
    ];
  },
} as const satisfies WorkflowNodeTypeDefinition<WaitForExternalNodeConfig>;
