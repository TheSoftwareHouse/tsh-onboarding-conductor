import { describe, expect, it } from 'vitest';
import {
  AUDIT_RESOURCE_TYPES,
  describeAuditActorTone,
  hasAuditActorIdentity,
  describeAuditResourceType,
  isAuditResourceType,
  isFailureAuditAction,
} from './audit-event';

describe('describeAuditResourceType', () => {
  it('labels every known resource type', () => {
    expect(AUDIT_RESOURCE_TYPES.map(describeAuditResourceType)).toEqual([
      'Onboardings',
      'Webhook outbox',
      'Callbacks',
      'Connector settings',
      'Admin API',
    ]);
  });

  it('falls back to the raw value for an unrecognized resource type', () => {
    expect(describeAuditResourceType('future_resource')).toBe('future_resource');
    expect(isAuditResourceType('future_resource')).toBe(false);
  });
});

describe('describeAuditActorTone', () => {
  it('tones an operator apart from system and anonymous', () => {
    expect(describeAuditActorTone('operator')).toBe('operator');
    expect(describeAuditActorTone('system')).toBe('other');
    expect(describeAuditActorTone('anonymous')).toBe('other');
  });
});

describe('hasAuditActorIdentity', () => {
  it('rejects the actor types whose id is a placeholder', () => {
    expect(hasAuditActorIdentity('system')).toBe(false);
    expect(hasAuditActorIdentity('anonymous')).toBe(false);
  });

  it('accepts an operator and any actor type it does not recognize', () => {
    expect(hasAuditActorIdentity('operator')).toBe(true);
    expect(hasAuditActorIdentity('scheduler')).toBe(true);
  });
});

describe('isFailureAuditAction', () => {
  it.each([
    'webhook.outbound_delivery_failed',
    'webhook.inbound_callback_rejected',
    'webhook.outbound_resend_not_found',
    'auth.role_missing',
    'auth.verification_unavailable',
    'onboarding.rejected_attempt',
  ])('is true for %s', (action) => {
    expect(isFailureAuditAction(action)).toBe(true);
  });

  it.each([
    'onboarding.started',
    'onboarding.state_transition',
    'connector.failure_retried',
    'connector.failure_fell_back',
    'connector.failure_propagated',
    'connector_settings.updated',
    'auth.access_unauthenticated',
  ])('is false for %s', (action) => {
    expect(isFailureAuditAction(action)).toBe(false);
  });
});
