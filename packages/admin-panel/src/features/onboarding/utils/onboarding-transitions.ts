import type { AuditEvent } from '@/features/audit';
import { describeAdminOnboardingStatus } from '../types/admin-onboarding';

/** Resource type the engine files every onboarding lifecycle event under. */
export const ONBOARDING_AUDIT_RESOURCE_TYPE = 'onboarding';

/**
 * The lifecycle actions that carry a from/to state pair in their metadata. Other events recorded
 * against an onboarding - a rejected attempt, a webhook delivery - describe something that
 * happened to it rather than a state it entered, so they are left out of the graph.
 */
const TRANSITION_ACTIONS: readonly string[] = [
  'onboarding.started',
  'onboarding.state_transition',
  'onboarding.manual_review_decision',
];

/** One state the onboarding entered, as recorded by the audit trail. */
export interface OnboardingTransition {
  /** Audit event id, which is also the React key for the node. */
  id: string;
  occurredAt: string;
  /** The state reached: the step moved into, or the status once no step remains. */
  label: string;
  status: string;
  /** Step the onboarding was on beforehand; null for the transition that started it. */
  fromStep: string | null;
  /** Step whose transition was applied, which for a terminal move names the step left behind. */
  appliedStep: string | null;
  /** Step entered, or null when the move was into a terminal state that clears the step. */
  toStep: string | null;
  /** Manual review trigger, such as `manual.approve`, when an operator decision drove the move. */
  trigger: string | null;
  /** True for the last recorded state, which is where the onboarding stands now. */
  current: boolean;
}

function readMetadataText(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Oldest first. Ids are UUIDv7, so they order two events that share a timestamp as written. */
function compareChronologically(left: AuditEvent, right: AuditEvent): number {
  return left.occurredAt === right.occurredAt
    ? left.id.localeCompare(right.id)
    : left.occurredAt.localeCompare(right.occurredAt);
}

function toTransition(event: AuditEvent, current: boolean): OnboardingTransition {
  const status = readMetadataText(event.metadata, 'toStatus') ?? '';
  const step = readMetadataText(event.metadata, 'toCurrentStep');

  return {
    id: event.id,
    occurredAt: event.occurredAt,
    // A terminal transition clears the current step, so there the status is what names the state.
    label: step ?? describeAdminOnboardingStatus(status),
    status,
    fromStep: readMetadataText(event.metadata, 'fromCurrentStep'),
    appliedStep: readMetadataText(event.metadata, 'appliedStep'),
    toStep: step,
    trigger: readMetadataText(event.metadata, 'manualTrigger'),
    current,
  };
}

/**
 * Turns one onboarding's audit events into the chain of states it moved through, oldest first.
 *
 * The endpoint answers newest first and mixes in non-lifecycle events, so the chain is filtered
 * and re-ordered here rather than being taken as it arrives.
 */
export function buildOnboardingTransitions(events: readonly AuditEvent[]): OnboardingTransition[] {
  const lifecycleEvents = events
    .filter((event) => TRANSITION_ACTIONS.includes(event.action))
    .sort(compareChronologically);

  return lifecycleEvents.map((event, index) =>
    toTransition(event, index === lifecycleEvents.length - 1),
  );
}
