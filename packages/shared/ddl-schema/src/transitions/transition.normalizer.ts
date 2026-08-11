import {
  normalizeCondition,
  type ConditionNormalizationContext,
} from '../conditions/condition.normalizer';
import { normalizeTransitionWebhook } from '../webhooks/webhook.normalizer';
import type {
  NormalizedWorkflowStep,
  NormalizedWorkflowTransition,
  RawWorkflowTransition,
} from '../workflow-contract';
import { failWorkflow } from '../workflow-invalid.error';

const OUTCOME_STATUSES = ['success', 'rejected'];
const MANUAL_STATUSES = ['manual.approve', 'manual.reject', 'manual.invalid'];

export const normalizeTransition = (
  transition: RawWorkflowTransition,
  context: ConditionNormalizationContext,
): NormalizedWorkflowTransition => {
  const normalizedWhen =
    transition.when === undefined ? undefined : normalizeCondition(transition.when, context);

  return {
    status: transition.status,
    target: transition.target,
    ...(normalizedWhen === undefined ? {} : { when: normalizedWhen }),
    webhook:
      transition.webhook === undefined ? undefined : normalizeTransitionWebhook(transition.webhook),
  };
};

/** Connector rejection must land on a terminal rejected step; otherwise it may only self-loop. */
const validateRejectionTargets = (
  step: NormalizedWorkflowStep,
  stepsByName: Readonly<Record<string, NormalizedWorkflowStep>>,
): void => {
  const connectorCanReject = step.connectors.some((connector) => connector.canReject);
  const rejectedTransitions = step.transitions.filter(
    (transition) => transition.status === 'rejected',
  );

  if (!connectorCanReject) {
    for (const transition of rejectedTransitions) {
      if (transition.target !== undefined && transition.target !== step.name) {
        failWorkflow('INVALID_TRANSITIONS');
      }
    }
    return;
  }

  if (rejectedTransitions.length === 0) {
    failWorkflow('INVALID_TRANSITIONS');
  }

  for (const transition of rejectedTransitions) {
    if (transition.target === undefined) {
      failWorkflow('INVALID_TRANSITIONS');
    }

    const targetStep = stepsByName[transition.target as string];
    if (targetStep === undefined || targetStep.status !== 'rejected') {
      failWorkflow('INVALID_TRANSITIONS');
    }
  }
};

/**
 * Within one status group, conditional transitions must be followed by exactly one unconditional
 * fallback (outcome statuses) or at most one (manual statuses), and a status may not be declared
 * twice unconditionally.
 */
const validateStatusGroup = (transitions: readonly NormalizedWorkflowTransition[]): void => {
  const status = transitions[0].status;
  const isOutcomeStatus = OUTCOME_STATUSES.includes(status);
  const conditionalTransitions = transitions.filter((transition) => transition.when !== undefined);
  const unconditionalTransitions = transitions.filter(
    (transition) => transition.when === undefined,
  );
  const lastTransition = transitions[transitions.length - 1];

  if (transitions.length > 1) {
    if (isOutcomeStatus && conditionalTransitions.length > 0) {
      if (unconditionalTransitions.length !== 1 || unconditionalTransitions[0] !== lastTransition) {
        failWorkflow('INVALID_TRANSITIONS');
      }
    } else if (MANUAL_STATUSES.includes(status)) {
      if (unconditionalTransitions.length > 1) {
        failWorkflow('INVALID_TRANSITIONS');
      }
      if (unconditionalTransitions.length === 1 && unconditionalTransitions[0] !== lastTransition) {
        failWorkflow('INVALID_TRANSITIONS');
      }
    } else if (unconditionalTransitions.length > 1) {
      failWorkflow('DUPLICATE_TRANSITION');
    }
  }

  if (!isOutcomeStatus) {
    return;
  }

  if (conditionalTransitions.length > 0) {
    if (unconditionalTransitions.length !== 1) {
      failWorkflow('INVALID_TRANSITIONS');
    }

    if (lastTransition.when !== undefined) {
      failWorkflow('INVALID_TRANSITIONS');
    }

    return;
  }

  if (transitions.length > 1) {
    failWorkflow('DUPLICATE_TRANSITION');
  }
};

export const validateTransitionGroups = (
  steps: readonly NormalizedWorkflowStep[],
  stepsByName: Readonly<Record<string, NormalizedWorkflowStep>>,
): void => {
  for (const step of steps) {
    validateRejectionTargets(step, stepsByName);

    const transitionsByStatus = new Map<string, NormalizedWorkflowTransition[]>();
    for (const transition of step.transitions) {
      const group = transitionsByStatus.get(transition.status) ?? [];
      group.push(transition);
      transitionsByStatus.set(transition.status, group);
    }

    for (const transitions of transitionsByStatus.values()) {
      validateStatusGroup(transitions);
    }
  }
};
