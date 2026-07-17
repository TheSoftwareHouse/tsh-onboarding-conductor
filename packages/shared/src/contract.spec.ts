import type { RawWorkflowDefinition } from '@tsh/ddl-schema/workflow-contract';

import {
  ONBOARDING_ENDPOINTS,
  ONBOARDING_STATUSES,
  TRIVIAL_WORKFLOW_FIXTURE,
  sharedPackageName,
  type CreateOnboardingRequest,
  type CreateOnboardingResponse,
  type GetOnboardingResponse,
  type GetOnboardingStateResponse,
  type SubmitOnboardingRequest,
  type SubmitOnboardingResponse,
  type OnboardingStateDescriptor,
} from './index';

describe('shared opening contract', () => {
  it('re-exports the public barrel contract surface including sharedPackageName', () => {
    expect(sharedPackageName).toBe('@tsh/shared');
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
    expect(TRIVIAL_WORKFLOW_FIXTURE).toBeDefined();
  });

  it('exposes exactly four endpoint paths and methods', () => {
    expect(Object.keys(ONBOARDING_ENDPOINTS)).toEqual([
      'createOnboarding',
      'getOnboarding',
      'getOnboardingState',
      'submitOnboarding',
    ]);
    expect(Object.values(ONBOARDING_ENDPOINTS)).toEqual([
      'POST /v1/onboardings',
      'GET /v1/onboardings/:id',
      'GET /v1/onboardings/:id/state',
      'POST /v1/onboardings/:id/submit',
    ]);
  });

  it('contains the complete onboarding status catalogue', () => {
    expect(ONBOARDING_STATUSES).toContain('created');
    expect(ONBOARDING_STATUSES).toContain('awaiting_user');
    expect(ONBOARDING_STATUSES).toContain('awaiting_provider_callback');
    expect(ONBOARDING_STATUSES).toContain('awaiting_account_provisioning');
    expect(ONBOARDING_STATUSES).toContain('awaiting_user_id');
    expect(ONBOARDING_STATUSES).toContain('awaiting_webhook_ack');
    expect(ONBOARDING_STATUSES).toContain('awaiting_manual_review');
    expect(ONBOARDING_STATUSES).toContain('retry_required');
    expect(ONBOARDING_STATUSES).toContain('approved');
    expect(ONBOARDING_STATUSES).toContain('rejected');
    expect(ONBOARDING_STATUSES).toContain('expired');
    expect(ONBOARDING_STATUSES).toContain('abandoned');
    expect(ONBOARDING_STATUSES).toHaveLength(13);
  });

  it('uses the minimal state descriptor semantics for terminal and non-terminal values', () => {
    const nonTerminalState: OnboardingStateDescriptor = {
      onboardingId: 'onb-1',
      status: 'awaiting_user',
      currentStep: 'initial-user-action',
      terminal: false,
    };

    const terminalState: OnboardingStateDescriptor = {
      onboardingId: 'onb-1',
      status: 'approved',
      currentStep: 'approved',
      terminal: true,
      expiresAt: '2026-01-01T00:00:00.000Z',
    };

    expect(nonTerminalState.terminal).toBe(false);
    expect(terminalState.terminal).toBe(true);
    expect(nonTerminalState.expiresAt).toBeUndefined();
    expect(terminalState.expiresAt).toBeDefined();
  });

  it('matches the trivial workflow fixture shape, including the acknowledge success transition', () => {
    const fixture = TRIVIAL_WORKFLOW_FIXTURE;

    expect(fixture.id).toBe('trivial-workflow-fixture');
    expect(fixture.initial).toBe('initial-user-action');
    expect(fixture.steps).toHaveLength(2);
    expect(fixture.steps[0]?.name).toBe('initial-user-action');
    expect(fixture.steps[0]?.status).toBe('awaiting_user');
    expect(fixture.steps[0]?.data).toEqual({});
    expect(fixture.steps[0]?.transitions).toEqual([{ status: 'success', target: 'approved' }]);
    expect(fixture.steps[1]?.name).toBe('approved');
    expect(fixture.steps[1]?.status).toBe('approved');
    expect(fixture.steps[1]?.data).toEqual({});
    expect(fixture.steps[1]?.transitions).toEqual([]);
    expect('connectors' in fixture).toBe(false);
    expect('subscribe' in fixture).toBe(false);
    expect('persistence' in fixture).toBe(false);
    expect('webhooks' in fixture).toBe(false);
  });

  it('is compatible with RawWorkflowDefinition and uses representative typed request/response values', () => {
    const fixtureCompatibility: RawWorkflowDefinition = TRIVIAL_WORKFLOW_FIXTURE;
    expect(fixtureCompatibility).toEqual(TRIVIAL_WORKFLOW_FIXTURE);

    const createRequest: CreateOnboardingRequest = {
      workflowId: 'workflow-1',
      workflowVersion: 1,
      externalReference: 'ext-1',
      userId: 'user-1',
      subjectExternalIds: ['subject-1'],
      context: { source: 'contract-test' },
    };

    const createResponse: CreateOnboardingResponse = {
      onboardingId: 'onb-1',
      status: 'created',
      currentStep: 'initial-user-action',
      expiresAt: '2026-01-01T00:00:00.000Z',
    };

    const detailResponse: GetOnboardingResponse = createResponse;

    const stateResponse: GetOnboardingStateResponse = {
      onboardingId: 'onb-1',
      status: 'awaiting_user',
      currentStep: 'initial-user-action',
      terminal: false,
      expiresAt: '2026-01-01T00:00:00.000Z',
    };

    const submitBody: SubmitOnboardingRequest = {};
    const submitResponse: SubmitOnboardingResponse = {
      onboardingId: 'onb-1',
      status: 'approved',
      currentStep: 'approved',
    };

    expect(createRequest.workflowId).toBe('workflow-1');
    expect(detailResponse).toEqual(createResponse);
    expect(stateResponse.currentStep).toBe('initial-user-action');
    expect(submitBody).toEqual({});
    expect(submitResponse.currentStep).toBe('approved');
  });
});
