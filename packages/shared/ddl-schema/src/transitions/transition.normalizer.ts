import {
  normalizeCondition,
  type ConditionNormalizationContext,
} from '../conditions/condition.normalizer';
import { normalizeTransitionWebhook } from '../webhooks/webhook.normalizer';
import {
  CONNECTOR_REJECTION_REASONS,
  DEFAULT_TRANSITION_POINTS,
  WORKFLOW_SCORING_BOUNDS,
  type ConnectorRejectionReason,
  type NormalizedWorkflowStep,
  type NormalizedWorkflowTransition,
  type RawWorkflowTransition,
} from '../workflow-contract';
import { failWorkflow } from '../workflow-invalid.error';

/** A refusal reason is meaningful only on a refusal, and only as a known, non-empty, unique set. */
const normalizeRejectionReasons = (
  transition: RawWorkflowTransition,
): readonly ConnectorRejectionReason[] | undefined => {
  if (transition.reason === undefined) {
    return undefined;
  }

  if (transition.status !== 'rejected') {
    failWorkflow('INVALID_TRANSITIONS');
  }

  const reasons = transition.reason;
  if (!Array.isArray(reasons) || reasons.length === 0) {
    failWorkflow('INVALID_SHAPE');
  }

  if (new Set(reasons).size !== reasons.length) {
    failWorkflow('INVALID_VALUE');
  }

  for (const reason of reasons) {
    if (!CONNECTOR_REJECTION_REASONS.includes(reason)) {
      failWorkflow('INVALID_VALUE');
    }
  }

  return [...reasons];
};

/**
 * What this arm contributes before the step's weight multiplies it in. Defaulted here rather than
 * left optional so the normalized shape is the post-defaults one and no consumer downstream has
 * to re-apply the default. The bounds repeat the JSON Schema's on purpose: the normalizer is
 * exported and can be reached without going through Ajv first.
 */
const normalizePoints = (transition: RawWorkflowTransition): number => {
  if (transition.points === undefined) {
    return DEFAULT_TRANSITION_POINTS;
  }

  if (
    !Number.isInteger(transition.points) ||
    transition.points < WORKFLOW_SCORING_BOUNDS.minPoints ||
    transition.points > WORKFLOW_SCORING_BOUNDS.maxPoints
  ) {
    failWorkflow('INVALID_VALUE');
  }

  return transition.points;
};

export const normalizeTransition = (
  transition: RawWorkflowTransition,
  context: ConditionNormalizationContext,
): NormalizedWorkflowTransition => {
  const normalizedWhen =
    transition.when === undefined ? undefined : normalizeCondition(transition.when, context);
  const normalizedReasons = normalizeRejectionReasons(transition);

  return {
    status: transition.status,
    target: transition.target,
    points: normalizePoints(transition),
    ...(normalizedWhen === undefined ? {} : { when: normalizedWhen }),
    ...(normalizedReasons === undefined ? {} : { reason: normalizedReasons }),
    webhook:
      transition.webhook === undefined ? undefined : normalizeTransitionWebhook(transition.webhook),
  };
};

/**
 * An unqualified connector rejection must land on a terminal rejected step; otherwise it may only
 * self-loop. An arm that names the reasons it claims is exempt from that and may route anywhere,
 * which is what lets a workflow recover from a stale challenge instead of refusing the customer.
 * The unqualified arm is still mandatory, so no refusal can go unhandled.
 */
const validateRejectionTargets = (
  step: NormalizedWorkflowStep,
  stepsByName: Readonly<Record<string, NormalizedWorkflowStep>>,
): void => {
  const connectorCanReject = step.connectors.some((connector) => connector.canReject);
  const rejectedTransitions = step.transitions.filter(
    (transition) => transition.status === 'rejected',
  );
  const reasonQualified = rejectedTransitions.filter(
    (transition) => transition.reason !== undefined,
  );
  const unqualified = rejectedTransitions.filter((transition) => transition.reason === undefined);

  for (const transition of reasonQualified) {
    if (transition.target === undefined) {
      continue;
    }

    if (stepsByName[transition.target] === undefined) {
      failWorkflow('UNKNOWN_TARGET');
    }
  }

  if (!connectorCanReject) {
    if (reasonQualified.length > 0) {
      // Nothing on this step can produce a reason to route on.
      failWorkflow('INVALID_TRANSITIONS');
    }

    for (const transition of unqualified) {
      if (transition.target !== undefined && transition.target !== step.name) {
        failWorkflow('INVALID_TRANSITIONS');
      }
    }
    return;
  }

  if (unqualified.length === 0) {
    failWorkflow('INVALID_TRANSITIONS');
  }

  for (const transition of unqualified) {
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
 * Within one status group a conditional arm may be followed by at most one unconditional arm, which
 * must come last, and a status may not be declared twice unconditionally.
 *
 * The fallback is optional rather than mandatory, so a group whose conditions are exhaustive can say
 * so: `documentType` is either `PASSPORT` or `ID_CARD`, and spelling both out reads better than one
 * arm plus an "everything else" that silently absorbs a third value added later. The cost is that a
 * submit matching no arm resolves to no transition and the onboarding ends `invalid` — declaring the
 * fallback is how a document opts out of that. `rejected` keeps a stricter rule of its own in
 * `validateRejectionTargets`: an unqualified arm is always required there.
 */
const validateStatusGroup = (transitions: readonly NormalizedWorkflowTransition[]): void => {
  const isConditional = (transition: NormalizedWorkflowTransition): boolean =>
    transition.when !== undefined || transition.reason !== undefined;
  const unconditionalTransitions = transitions.filter((transition) => !isConditional(transition));
  const lastTransition = transitions[transitions.length - 1];

  if (unconditionalTransitions.length > 1) {
    failWorkflow('DUPLICATE_TRANSITION');
  }

  if (unconditionalTransitions.length === 1 && unconditionalTransitions[0] !== lastTransition) {
    failWorkflow('INVALID_TRANSITIONS');
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
