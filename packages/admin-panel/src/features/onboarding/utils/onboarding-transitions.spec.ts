import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '@/features/audit';
import { buildOnboardingTransitions } from './onboarding-transitions';

function event(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: '018f1e2a-0000-7000-8000-000000000001',
    occurredAt: '2026-07-01T10:00:00.000Z',
    actorType: 'system',
    actorId: 'engine',
    action: 'onboarding.state_transition',
    resourceType: 'onboarding',
    resourceId: '018f1e2a-1111-7000-8000-000000000001',
    metadata: { toStatus: 'awaiting_user', toCurrentStep: 'collect-documents' },
    ...overrides,
  };
}

describe('buildOnboardingTransitions', () => {
  it('orders the chain oldest first, whatever order the endpoint answered in', () => {
    const transitions = buildOnboardingTransitions([
      event({ id: 'b', occurredAt: '2026-07-01T12:00:00.000Z' }),
      event({ id: 'a', occurredAt: '2026-07-01T10:00:00.000Z' }),
    ]);

    expect(transitions.map((transition) => transition.id)).toEqual(['a', 'b']);
  });

  it('orders two events sharing a timestamp by their monotonic ids', () => {
    const transitions = buildOnboardingTransitions([
      event({ id: '018f1e2a-0000-7000-8000-000000000002' }),
      event({ id: '018f1e2a-0000-7000-8000-000000000001' }),
    ]);

    expect(transitions.map((transition) => transition.id)).toEqual([
      '018f1e2a-0000-7000-8000-000000000001',
      '018f1e2a-0000-7000-8000-000000000002',
    ]);
  });

  it('keeps only the actions that record a state the onboarding entered', () => {
    const transitions = buildOnboardingTransitions([
      event({
        id: 'started',
        occurredAt: '2026-07-01T10:00:00.000Z',
        action: 'onboarding.started',
      }),
      event({
        id: 'transition',
        occurredAt: '2026-07-01T11:00:00.000Z',
        action: 'onboarding.state_transition',
      }),
      event({
        id: 'review',
        occurredAt: '2026-07-01T12:00:00.000Z',
        action: 'onboarding.manual_review_decision',
      }),
      event({
        id: 'attempt',
        occurredAt: '2026-07-01T13:00:00.000Z',
        action: 'onboarding.rejected_attempt',
      }),
      event({
        id: 'webhook',
        occurredAt: '2026-07-01T14:00:00.000Z',
        action: 'webhook.inbound_callback_applied',
      }),
    ]);

    expect(transitions.map((transition) => transition.id)).toEqual([
      'started',
      'transition',
      'review',
    ]);
  });

  it('names a node after the step entered, and after the status once no step remains', () => {
    const transitions = buildOnboardingTransitions([
      event({ id: 'a', metadata: { toStatus: 'awaiting_user', toCurrentStep: 'verify-identity' } }),
      event({
        id: 'b',
        occurredAt: '2026-07-01T11:00:00.000Z',
        metadata: { toStatus: 'approved', toCurrentStep: null },
      }),
    ]);

    expect(transitions.map((transition) => transition.label)).toEqual([
      'verify-identity',
      'Approved',
    ]);
  });

  it('marks only the last recorded state as current', () => {
    const transitions = buildOnboardingTransitions([
      event({ id: 'a', occurredAt: '2026-07-01T10:00:00.000Z' }),
      event({ id: 'b', occurredAt: '2026-07-01T11:00:00.000Z' }),
    ]);

    expect(transitions.map((transition) => transition.current)).toEqual([false, true]);
  });

  it('reports the manual trigger only for a transition an operator decided', () => {
    const transitions = buildOnboardingTransitions([
      event({
        id: 'a',
        action: 'onboarding.manual_review_decision',
        metadata: { toStatus: 'approved', toCurrentStep: null, manualTrigger: 'manual.approve' },
      }),
      event({ id: 'b', occurredAt: '2026-07-01T11:00:00.000Z' }),
    ]);

    expect(transitions.map((transition) => transition.trigger)).toEqual(['manual.approve', null]);
  });

  it('falls back to an empty status when the metadata carries none', () => {
    const [transition] = buildOnboardingTransitions([event({ metadata: {} })]);

    expect(transition.status).toBe('');
    expect(transition.label).toBe('');
  });

  it('returns nothing when the trail holds no lifecycle events', () => {
    expect(buildOnboardingTransitions([])).toEqual([]);
  });
});
