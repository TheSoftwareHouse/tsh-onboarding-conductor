/**
 * The callback was correlated and decided against a park the onboarding has since left — a
 * client submit opened a newer attempt, or the step moved on — between the adapter's unlocked
 * read and the submit path's lock. Dropped, never applied: the newer attempt's own callback will
 * decide the onboarding.
 */
export class ConnectorCallbackSupersededError extends Error {
  constructor(onboardingId: string, connectorId: string) {
    super(
      `Callback for connector id=${connectorId} on onboarding id=${onboardingId} names a park ` +
        'the onboarding no longer holds',
    );
    this.name = 'ConnectorCallbackSupersededError';
  }
}
