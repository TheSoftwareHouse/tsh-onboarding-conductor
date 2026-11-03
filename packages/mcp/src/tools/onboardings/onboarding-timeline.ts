import type { components } from '@tsh/openapi';
import type { MaskedAuditEntry, MaskedRecord, MaskedValue } from '../../masking/masking.types';

type TransitionRow = components['schemas']['OnboardingTransitionResponseDto'];

/** What an event in an onboarding's history is, in the terms an investigation asks about. */
export const TimelineEventKind = {
  STARTED: 'started',
  TRANSITION: 'transition',
  REVIEW_DECISION: 'review_decision',
  CONNECTOR_OUTCOME: 'connector_outcome',
  CONNECTOR_FAILURE: 'connector_failure',
  REJECTED_ATTEMPT: 'rejected_attempt',
  CALLBACK_APPLIED: 'callback_applied',
  CALLBACK_REJECTED: 'callback_rejected',
  RECONCILE: 'reconcile',
  OTHER: 'other',
} as const;

export type TimelineEventKind = (typeof TimelineEventKind)[keyof typeof TimelineEventKind];

const KIND_BY_ACTION: ReadonlyMap<string, TimelineEventKind> = new Map([
  ['onboarding.started', TimelineEventKind.STARTED],
  ['onboarding.state_transition', TimelineEventKind.TRANSITION],
  ['onboarding.manual_review_decision', TimelineEventKind.REVIEW_DECISION],
  ['onboarding.rejected_attempt', TimelineEventKind.REJECTED_ATTEMPT],
  ['onboarding.pending_connector_reconciled', TimelineEventKind.RECONCILE],
  ['onboarding.pending_connector_reconcile_noop', TimelineEventKind.RECONCILE],
  ['webhook.inbound_callback_applied', TimelineEventKind.CALLBACK_APPLIED],
  ['webhook.inbound_callback_rejected', TimelineEventKind.CALLBACK_REJECTED],
  ['webhook.inbound_callback_mapping_failed', TimelineEventKind.CALLBACK_REJECTED],
  ['connector.result_rejected', TimelineEventKind.CONNECTOR_OUTCOME],
  ['connector.result_invalid_data', TimelineEventKind.CONNECTOR_OUTCOME],
  ['connector.execution_unavailable', TimelineEventKind.CONNECTOR_OUTCOME],
]);
const CONNECTOR_FAILURE_PREFIX = 'connector.failure_';

/** The moves that change where an onboarding stands; the others describe what happened to it. */
const LIFECYCLE_KINDS: readonly TimelineEventKind[] = [
  TimelineEventKind.STARTED,
  TimelineEventKind.TRANSITION,
  TimelineEventKind.REVIEW_DECISION,
];

export interface TimelineMove {
  fromStatus: MaskedValue;
  toStatus: MaskedValue;
  fromStep: MaskedValue;
  toStep: MaskedValue;
  /** The step whose transition was applied; for a terminal move, the step left behind. */
  appliedStep: MaskedValue;
  fromScores: MaskedValue;
  toScores: MaskedValue;
  /** `manual.approve` and the like, when a reviewer's decision drove the move. */
  trigger: string | null;
}

export interface TimelineEvent {
  id: string;
  occurredAt: string;
  kind: TimelineEventKind;
  /** The audit action; absent on a move known only from the transitions endpoint. */
  action?: string;
  actor?: { type: string; id: string };
  /** Present on the moves that change status or step. */
  move?: TimelineMove;
  /** True on the last recorded move, which is where the onboarding stands now. */
  current?: true;
  /** The audit entry's masked metadata; moves carry theirs in `move` instead. */
  detail?: MaskedRecord;
}

export function classifyAction(action: string): TimelineEventKind {
  if (action.startsWith(CONNECTOR_FAILURE_PREFIX)) {
    return TimelineEventKind.CONNECTOR_FAILURE;
  }

  return KIND_BY_ACTION.get(action) ?? TimelineEventKind.OTHER;
}

function toEvent(entry: MaskedAuditEntry, transition: TransitionRow | undefined): TimelineEvent {
  const kind = classifyAction(entry.action);
  const event: TimelineEvent = {
    id: entry.id,
    occurredAt: entry.occurredAt,
    kind,
    action: entry.action,
    actor: { type: entry.actorType, id: entry.actorId },
  };

  if (!LIFECYCLE_KINDS.includes(kind)) {
    return { ...event, detail: entry.metadata };
  }

  const { metadata } = entry;

  return {
    ...event,
    move: {
      fromStatus: metadata.fromStatus ?? null,
      toStatus: metadata.toStatus ?? null,
      fromStep: metadata.fromCurrentStep ?? null,
      toStep: metadata.toCurrentStep ?? null,
      appliedStep: metadata.appliedStep ?? null,
      fromScores: metadata.fromScores ?? null,
      toScores: metadata.toScores ?? null,
      trigger: transition?.trigger ?? null,
    },
    ...(transition?.current ? { current: true as const } : {}),
  };
}

/** A move the audit listing did not return, reported from what the transitions endpoint holds. */
function toEventFromTransition(transition: TransitionRow): TimelineEvent {
  const kind =
    transition.trigger !== null
      ? TimelineEventKind.REVIEW_DECISION
      : transition.fromStep === null
        ? TimelineEventKind.STARTED
        : TimelineEventKind.TRANSITION;

  return {
    id: transition.id,
    occurredAt: transition.occurredAt,
    kind,
    move: {
      fromStatus: null,
      toStatus: transition.status,
      fromStep: transition.fromStep,
      toStep: transition.enteredStep,
      appliedStep: transition.appliedStep,
      fromScores: null,
      toScores: null,
      trigger: transition.trigger,
    },
    ...(transition.current ? { current: true as const } : {}),
  };
}

/**
 * One chronological list from the masked audit entries of an onboarding and the transitions the
 * engine reports. A move is recorded in both, under the same id, and becomes one event that takes
 * its scores from the audit row and its trigger from the transition; a transition with no audit
 * row in the listing still appears. Events at the same instant order by id, which is time-ordered.
 */
export function buildTimeline(
  entries: readonly MaskedAuditEntry[],
  transitions: readonly TransitionRow[],
): TimelineEvent[] {
  const transitionsById = new Map(transitions.map((transition) => [transition.id, transition]));
  const auditIds = new Set(entries.map((entry) => entry.id));

  return [
    ...entries.map((entry) => toEvent(entry, transitionsById.get(entry.id))),
    ...transitions.filter((transition) => !auditIds.has(transition.id)).map(toEventFromTransition),
  ].sort(
    (left, right) =>
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt) || (left.id < right.id ? -1 : 1),
  );
}
