import { describe, expect, it } from 'vitest';
import {
  onboardingWorkflowSearchParams,
  serializeOnboardingWorkflowSearch,
} from './onboarding-search-params';

describe('onboardingWorkflowSearchParams.workflowId', () => {
  it('has no default, so it reads as absent (null) rather than blank', () => {
    expect('defaultValue' in onboardingWorkflowSearchParams.workflowId).toBe(false);
  });

  it('carries an unvalidated free-text value through as-is, trimmed', () => {
    expect(onboardingWorkflowSearchParams.workflowId.parse('  kyc-basic  ')).toBe('kyc-basic');
  });
});

describe('serializeOnboardingWorkflowSearch', () => {
  it('returns a bare query for a null workflowId', () => {
    expect(serializeOnboardingWorkflowSearch({ workflowId: null })).toBe('');
  });

  it('carries workflowId as the sole query parameter', () => {
    expect(serializeOnboardingWorkflowSearch({ workflowId: 'kyc-basic' })).toBe(
      '?workflowId=kyc-basic',
    );
  });
});
