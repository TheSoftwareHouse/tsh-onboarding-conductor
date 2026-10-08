import { Logger } from '@nestjs/common';
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

  it('returns undefined and warns when the step declares the connector but the onboarding is not parked', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const onboarding = buildOnboarding();
    const workflow = buildWorkflow([fakeConnector('sumsub_kyc', 1)]);
    const { resolver } = buildResolver(onboarding, workflow);

    await expect(
      resolver.findConnector({ onboardingId: 'onboarding-1', connectorId: 'sumsub_kyc' }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      'AWAITING_CALLBACK_PARK_NOT_RECORDED onboardingId=onboarding-1 connectorId=sumsub_kyc ' +
        'step=collect_identity',
    );

    warn.mockRestore();
  });

  it('never matches the step chain on its own: a fallback id without a park resolves to nothing', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const onboarding = buildOnboarding();
    const primaryDeclaration = fakeConnector('sendgrid_email', 1, [fakeConnector('smtp', 1)]);
    const { resolver } = buildResolver(onboarding, buildWorkflow([primaryDeclaration]));

    await expect(
      resolver.findConnector({ onboardingId: 'onboarding-1', connectorId: 'smtp' }),
    ).resolves.toBeUndefined();

    jest.restoreAllMocks();
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
