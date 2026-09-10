import type { CompiledWorkflowStep } from '../../workflow-contract';
import { asConfigObject } from '../step-config.utils';
import { SINGLE_STEP_KEYS } from '../step-compile.utils';
import type {
  JsonSchemaFragment,
  StepFieldMap,
  WorkflowStepCompilationContext,
  WorkflowStepPort,
  WorkflowStepTypeDefinition,
} from '../step-type.port';

/**
 * The three decisions an operator can reach. Fixed by the transition vocabulary rather than chosen
 * here: `manual.approve`, `manual.reject` and `manual.invalid` are the only manual outcomes the
 * engine produces, so a "request more information" port would be a promise nothing could keep.
 *
 * `invalid` is optional: a review has to be able to decide the case either way, but whether it
 * also offers "this case is broken" is the document's call, and an operator invoking it on a
 * review that does not is refused with `MANUAL_TRANSITION_NOT_AVAILABLE` rather than routed.
 */
export const MANUAL_REVIEW_PORTS = [
  { name: 'approve' },
  { name: 'reject' },
  { name: 'invalid', optional: true },
] as const satisfies readonly WorkflowStepPort[];

const MANUAL_STATUS_BY_PORT = {
  approve: 'manual.approve',
  reject: 'manual.reject',
  invalid: 'manual.invalid',
} as const;

export type ManualReviewStepConfig = Record<string, never>;

/**
 * Parking an onboarding for a human decision. Carries no config: a queue, an SLA or a reviewer
 * note would all be config nothing in the engine reads, and the review API drives the outcome
 * through `POST /v1/onboardings/:id/review/:action` regardless.
 *
 * The `success` arm it emits with no target is the load-bearing detail. A stray customer submit on
 * a step awaiting review must resolve to *something*, and an arm that names no target leaves the
 * onboarding exactly where it was. Without it the submit matches nothing and the engine ends the
 * onboarding `invalid` — destroying a case a human was still working on.
 */
export const manualReviewStepTypeDefinition = {
  type: 'manual-review',
  category: 'decide',
  buildConfigSchema(): JsonSchemaFragment {
    return { type: 'object', additionalProperties: false, properties: {} };
  },
  parseConfig(config, fail): ManualReviewStepConfig {
    asConfigObject(config, fail);

    return {};
  },
  listPorts(): readonly WorkflowStepPort[] {
    return MANUAL_REVIEW_PORTS;
  },
  listSubStepKeys(): readonly (string | null)[] {
    return SINGLE_STEP_KEYS;
  },
  buildFields(): StepFieldMap {
    return {};
  },
  compile(context: WorkflowStepCompilationContext<ManualReviewStepConfig>): CompiledWorkflowStep[] {
    return [
      {
        name: context.stepNames[0],
        status: 'awaiting_manual_review',
        data: context.fields,
        transitions: [
          { status: 'success' },
          ...MANUAL_REVIEW_PORTS.filter((port) => context.targets[port.name] !== undefined).map(
            (port) => ({
              status: MANUAL_STATUS_BY_PORT[port.name],
              target: context.targets[port.name],
            }),
          ),
        ],
      },
    ];
  },
} as const satisfies WorkflowStepTypeDefinition<ManualReviewStepConfig>;
