import { describe, expect, it } from 'vitest';
import { isFailureAuditAction } from './audit-actions';

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
