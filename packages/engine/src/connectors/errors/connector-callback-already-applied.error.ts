export class ConnectorCallbackAlreadyAppliedError extends Error {
  constructor(onboardingId: string, connectorId: string) {
    super(
      `Callback for connector id=${connectorId} on onboarding id=${onboardingId} resolves to no ` +
        `awaiting connector; the onboarding has already advanced past this step`,
    );
    this.name = 'ConnectorCallbackAlreadyAppliedError';
  }
}
