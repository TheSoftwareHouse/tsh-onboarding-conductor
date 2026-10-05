import { AwaitingCallbackConnectorResolver } from './awaiting-callback-connector.resolver';

type FakeConnector = { id: string; order: number; fallbacks: readonly FakeConnector[] };

/** A step connector as the resolver sees it: an id, an order, and the chain behind it. */
const fakeConnector = (
  id: string,
  order: number,
  fallbacks: readonly FakeConnector[] = [],
): FakeConnector => ({ id, order, fallbacks });

const buildOnboarding = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'onboarding-1',
  workflowVersionId: 'workflow-version-1',
  currentStep: 'collect_identity',
  isApproved: () => false,
  isCompleted: () => false,
  pendingConnector: null,
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
  const workflowRegistryService = { getByVersionId: jest.fn().mockResolvedValue(workflow) };
  const resolver = new AwaitingCallbackConnectorResolver(
    onboardingsRepository as never,
    workflowRegistryService as never,
  );

  return { resolver, onboardingsRepository };
};

describe('AwaitingCallbackConnectorResolver', () => {
  it('returns the order, onboarding and declaration of the current step connector matching the given id', async () => {
    const onboarding = buildOnboarding();
    const sumsubDeclaration = fakeConnector('sumsub_kyc', 2);
    const workflow = buildWorkflow([sumsubDeclaration, fakeConnector('other_connector', 1)]);
    const { resolver } = buildResolver(onboarding, workflow);

    await expect(
      resolver.findConnector({ onboardingId: 'onboarding-1', connectorId: 'sumsub_kyc' }),
    ).resolves.toEqual({
      connectorOrder: 2,
      onboarding,
      connector: sumsubDeclaration,
      pendingConnector: null,
    });
  });

  it('returns the correct order when the step declares two connectors', async () => {
    const onboarding = buildOnboarding();
    const sumsubDeclaration = fakeConnector('sumsub_kyc', 1);
    const workflow = buildWorkflow([fakeConnector('first_connector', 0), sumsubDeclaration]);
    const { resolver } = buildResolver(onboarding, workflow);

    await expect(
      resolver.findConnector({ onboardingId: 'onboarding-1', connectorId: 'sumsub_kyc' }),
    ).resolves.toEqual({
      connectorOrder: 1,
      onboarding,
      connector: sumsubDeclaration,
      pendingConnector: null,
    });
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
    const workflow = buildWorkflow([fakeConnector('other_connector', 0)]);
    const { resolver } = buildResolver(onboarding, workflow);

    await expect(
      resolver.findConnector({ onboardingId: 'onboarding-1', connectorId: 'sumsub_kyc' }),
    ).resolves.toBeUndefined();
  });

  it('resolves a callback naming a fallback id to the primary order and the fallback declaration', async () => {
    const onboarding = buildOnboarding();
    const fallbackDeclaration = fakeConnector('smtp', 1);
    const primaryDeclaration = fakeConnector('sendgrid_email', 1, [fallbackDeclaration]);
    const workflow = buildWorkflow([primaryDeclaration]);
    const { resolver } = buildResolver(onboarding, workflow);

    await expect(
      resolver.findConnector({ onboardingId: 'onboarding-1', connectorId: 'smtp' }),
    ).resolves.toEqual({
      connectorOrder: 1,
      onboarding,
      connector: fallbackDeclaration,
      pendingConnector: null,
    });
  });

  it('resolves a callback naming the second link of a chain, which shares the primary order', async () => {
    const onboarding = buildOnboarding();
    const lastLink = fakeConnector('ses_email', 1);
    const primaryDeclaration = fakeConnector('sendgrid_email', 1, [
      fakeConnector('smtp', 1),
      lastLink,
    ]);
    const workflow = buildWorkflow([primaryDeclaration]);
    const { resolver } = buildResolver(onboarding, workflow);

    await expect(
      resolver.findConnector({ onboardingId: 'onboarding-1', connectorId: 'ses_email' }),
    ).resolves.toEqual({
      connectorOrder: 1,
      onboarding,
      connector: lastLink,
      pendingConnector: null,
    });
  });

  it('returns undefined for an id present on neither a primary nor any link of its chain', async () => {
    const onboarding = buildOnboarding();
    const fallbackDeclaration = fakeConnector('smtp', 1);
    const primaryDeclaration = fakeConnector('sendgrid_email', 1, [fallbackDeclaration]);
    const workflow = buildWorkflow([primaryDeclaration]);
    const { resolver } = buildResolver(onboarding, workflow);

    await expect(
      resolver.findConnector({ onboardingId: 'onboarding-1', connectorId: 'unknown' }),
    ).resolves.toBeUndefined();
  });

  describe('with a persisted pending connector', () => {
    const pending = (connectorId: string, connectorOrder: number, providerReference?: string) => ({
      connectorName: 'Parked',
      connectorId,
      connectorOrder,
      ...(providerReference === undefined ? {} : { providerReference }),
    });

    it('prefers the persisted record and returns it with the declaration it names', async () => {
      const record = pending('kyc_a', 1, 'session-1');
      const onboarding = buildOnboarding({ pendingConnector: record });
      const declaration = fakeConnector('kyc_a', 1);
      const { resolver } = buildResolver(
        onboarding,
        buildWorkflow([fakeConnector('first', 0), declaration]),
      );

      await expect(
        resolver.findConnector({ onboardingId: 'onboarding-1', connectorId: 'kyc_a' }),
      ).resolves.toEqual({
        connectorOrder: 1,
        onboarding,
        connector: declaration,
        pendingConnector: record,
      });
    });

    it('returns undefined when the callback names another connector than the parked one', async () => {
      const onboarding = buildOnboarding({ pendingConnector: pending('kyc_a', 1) });
      const { resolver } = buildResolver(onboarding, buildWorkflow([fakeConnector('kyc_b', 1)]));

      await expect(
        resolver.findConnector({ onboardingId: 'onboarding-1', connectorId: 'kyc_b' }),
      ).resolves.toBeUndefined();
    });

    it('returns undefined when the step has no slot at the parked order', async () => {
      const onboarding = buildOnboarding({ pendingConnector: pending('kyc_a', 3) });
      const { resolver } = buildResolver(onboarding, buildWorkflow([fakeConnector('kyc_a', 1)]));

      await expect(
        resolver.findConnector({ onboardingId: 'onboarding-1', connectorId: 'kyc_a' }),
      ).resolves.toBeUndefined();
    });

    it('finds the parked link inside the slot chain', async () => {
      const record = pending('smtp', 1);
      const onboarding = buildOnboarding({ pendingConnector: record });
      const fallback = fakeConnector('smtp', 1);
      const { resolver } = buildResolver(
        onboarding,
        buildWorkflow([fakeConnector('sendgrid_email', 1, [fallback])]),
      );

      await expect(
        resolver.findConnector({ onboardingId: 'onboarding-1', connectorId: 'smtp' }),
      ).resolves.toEqual({
        connectorOrder: 1,
        onboarding,
        connector: fallback,
        pendingConnector: record,
      });
    });

    it('substitutes the parked id into the primary when the slot was switched while parked', async () => {
      const record = pending('kyc_a', 1, 'session-1');
      const onboarding = buildOnboarding({ pendingConnector: record });
      const switchedPrimary = { ...fakeConnector('kyc_b', 1), config: { sourceKey: 'source' } };
      const { resolver } = buildResolver(onboarding, buildWorkflow([switchedPrimary]));

      await expect(
        resolver.findConnector({ onboardingId: 'onboarding-1', connectorId: 'kyc_a' }),
      ).resolves.toEqual({
        connectorOrder: 1,
        onboarding,
        connector: { ...switchedPrimary, id: 'kyc_a' },
        pendingConnector: record,
      });
    });

    it('rejects the switched-to provider while the park still names the previous one', async () => {
      const onboarding = buildOnboarding({ pendingConnector: pending('kyc_a', 1) });
      const { resolver } = buildResolver(onboarding, buildWorkflow([fakeConnector('kyc_b', 1)]));

      await expect(
        resolver.findConnector({ onboardingId: 'onboarding-1', connectorId: 'kyc_b' }),
      ).resolves.toBeUndefined();
    });
  });
});
