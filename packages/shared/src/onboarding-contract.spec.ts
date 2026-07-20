import {
  ONBOARDING_ROUTE_METADATA,
  ONBOARDING_ROUTE_METHOD_PATH_PAIRS,
  ONBOARDING_STATUSES,
  e2A1OptionalFieldsRequirement,
  e2A1PersistFalseRequirement,
  e2A1TerminalTransitionsRequirement,
  type OnboardingStateDescriptor,
} from './onboarding-contract';
import { trivialOnboardingV1, type E2TrivialWorkflowFixture } from './trivial-onboarding-workflow';

describe('shared onboarding contract', () => {
  it('exports the exact onboarding status catalogue', () => {
    expect(ONBOARDING_STATUSES).toEqual([
      'created',
      'in_progress',
      'awaiting_user',
      'awaiting_provider_callback',
      'awaiting_account_provisioning',
      'awaiting_user_id',
      'awaiting_webhook_ack',
      'awaiting_manual_review',
      'retry_required',
      'approved',
      'rejected',
      'expired',
      'abandoned',
    ]);
  });

  it('uses the minimal serializable descriptor shape for active and terminal states', () => {
    const activeDescriptor: OnboardingStateDescriptor = {
      onboardingId: 'onb-1',
      workflowId: 'trivial-onboarding',
      workflowVersion: 1,
      status: 'awaiting_user',
      currentStep: { id: 'start', label: 'Start', userVisible: true },
    };

    const terminalDescriptor: OnboardingStateDescriptor = {
      onboardingId: 'onb-2',
      workflowId: 'trivial-onboarding',
      workflowVersion: 1,
      status: 'approved',
      currentStep: null,
    };

    expect(activeDescriptor).toEqual({
      onboardingId: 'onb-1',
      workflowId: 'trivial-onboarding',
      workflowVersion: 1,
      status: 'awaiting_user',
      currentStep: { id: 'start', label: 'Start', userVisible: true },
    });
    expect(terminalDescriptor.currentStep).toBeNull();
    expect(terminalDescriptor).toEqual({
      onboardingId: 'onb-2',
      workflowId: 'trivial-onboarding',
      workflowVersion: 1,
      status: 'approved',
      currentStep: null,
    });
  });

  it('exports the four opening-contract routes with request and response metadata', () => {
    expect(ONBOARDING_ROUTE_METHOD_PATH_PAIRS).toEqual([
      { method: 'POST', path: '/v1/onboardings' },
      { method: 'GET', path: '/v1/onboardings/:id' },
      { method: 'GET', path: '/v1/onboardings/:id/state' },
      { method: 'POST', path: '/v1/onboardings/:id/submit' },
    ]);

    expect(ONBOARDING_ROUTE_METADATA.create.request).toEqual({
      workflowId: 'string',
      workflowVersion: 'number',
    });
    expect(ONBOARDING_ROUTE_METADATA.submit.request).toEqual({});
    expect(ONBOARDING_ROUTE_METADATA.getState.response).toEqual({
      onboardingId: 'string',
      workflowId: 'string',
      workflowVersion: 'number',
      status: 'OnboardingStatus',
      currentStep: 'OnboardingStepDescriptor|null',
    });
  });

  it('exports the trivial workflow fixture with the expected start and approved shape', () => {
    const fixture = trivialOnboardingV1 as E2TrivialWorkflowFixture;

    expect(fixture.workflowId).toBe('trivial-onboarding');
    expect(fixture.workflowVersion).toBe('v1');
    expect(Object.keys(fixture.steps)).toEqual(['start', 'approved']);
    expect(fixture.steps.start.data.continue).toEqual({
      type: 'boolean',
      required: false,
      persist: false,
    });
    expect(fixture.steps.start.transitions).toEqual([{ target: 'approved', type: 'success' }]);
    expect(fixture.steps.approved.transitions).toEqual([]);
    expect(fixture.steps.start.status).toBe('awaiting_user');
    expect(fixture.steps.approved.status).toBe('approved');
  });

  it('documents the E2-A1 adapter requirements for optional fields, persist false, and terminality', () => {
    expect(e2A1OptionalFieldsRequirement).toContain('optional');
    expect(e2A1PersistFalseRequirement).toContain('persist:false');
    expect(e2A1TerminalTransitionsRequirement).toContain('transitions: []');
  });
});
