import { AwaitingCallbackConnectorResolver } from './awaiting-callback-connector.resolver';

type FakeConnector = { id: string; order: number };

const buildOnboarding = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'onboarding-1',
  workflowId: 'workflow-1',
  workflowVersion: 1,
  currentStep: 'collect_identity',
  isApproved: () => false,
  isCompleted: () => false,
  ...overrides,
});

const buildWorkflow = (
  connectors: readonly FakeConnector[],
  stepName: string | undefined = 'collect_identity',
) => ({
  findStep: jest.fn((name: string) => (name === stepName ? { connectors } : undefined)),
});

const buildResolver = (
  onboarding: unknown,
  workflow: unknown,
): {
  resolver: AwaitingCallbackConnectorResolver;
  onboardingsRepository: { findOne: jest.Mock };
} => {
  const onboardingsRepository = { findOne: jest.fn().mockResolvedValue(onboarding) };
  const workflowRegistryService = { getById: jest.fn().mockResolvedValue(workflow) };
  const resolver = new AwaitingCallbackConnectorResolver(
    onboardingsRepository as never,
    workflowRegistryService as never,
  );

  return { resolver, onboardingsRepository };
};

describe('AwaitingCallbackConnectorResolver', () => {
  it('returns the order, onboarding and declaration of the current step connector matching the given id', async () => {
    const onboarding = buildOnboarding();
    const sumsubDeclaration = { id: 'sumsub_kyc', order: 2 };
    const workflow = buildWorkflow([sumsubDeclaration, { id: 'other_connector', order: 1 }]);
    const { resolver } = buildResolver(onboarding, workflow);

    await expect(
      resolver.findConnector({ onboardingId: 'onboarding-1', connectorId: 'sumsub_kyc' }),
    ).resolves.toEqual({ connectorOrder: 2, onboarding, connector: sumsubDeclaration });
  });

  it('returns the correct order when the step declares two connectors', async () => {
    const onboarding = buildOnboarding();
    const sumsubDeclaration = { id: 'sumsub_kyc', order: 1 };
    const workflow = buildWorkflow([{ id: 'first_connector', order: 0 }, sumsubDeclaration]);
    const { resolver } = buildResolver(onboarding, workflow);

    await expect(
      resolver.findConnector({ onboardingId: 'onboarding-1', connectorId: 'sumsub_kyc' }),
    ).resolves.toEqual({ connectorOrder: 1, onboarding, connector: sumsubDeclaration });
  });

  it('returns undefined for an unknown onboarding', async () => {
    const { resolver } = buildResolver(undefined, buildWorkflow([]));

    await expect(
      resolver.findConnector({ onboardingId: 'missing', connectorId: 'sumsub_kyc' }),
    ).resolves.toBeUndefined();
  });

  it('returns undefined for an approved onboarding', async () => {
    const onboarding = buildOnboarding({ isApproved: () => true });
    const { resolver } = buildResolver(onboarding, buildWorkflow([]));

    await expect(
      resolver.findConnector({ onboardingId: 'onboarding-1', connectorId: 'sumsub_kyc' }),
    ).resolves.toBeUndefined();
  });

  it('returns undefined for a completed onboarding', async () => {
    const onboarding = buildOnboarding({ isCompleted: () => true });
    const { resolver } = buildResolver(onboarding, buildWorkflow([]));

    await expect(
      resolver.findConnector({ onboardingId: 'onboarding-1', connectorId: 'sumsub_kyc' }),
    ).resolves.toBeUndefined();
  });

  it('returns undefined when the onboarding has no current step', async () => {
    const onboarding = buildOnboarding({ currentStep: null });
    const { resolver } = buildResolver(onboarding, buildWorkflow([]));

    await expect(
      resolver.findConnector({ onboardingId: 'onboarding-1', connectorId: 'sumsub_kyc' }),
    ).resolves.toBeUndefined();
  });

  it('returns undefined when the current step declares a different connector id', async () => {
    const onboarding = buildOnboarding();
    const workflow = buildWorkflow([{ id: 'other_connector', order: 0 }]);
    const { resolver } = buildResolver(onboarding, workflow);

    await expect(
      resolver.findConnector({ onboardingId: 'onboarding-1', connectorId: 'sumsub_kyc' }),
    ).resolves.toBeUndefined();
  });
});
