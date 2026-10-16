/**
 * The callback is well-formed but names a provider resource that resolves to no onboarding of this
 * engine (a customer the provider answers 404 for: another project's event on the same
 * subscription, or a deleted one). Acknowledged with 204 and recorded, so the provider stops
 * redelivering an event that can never apply.
 */
export class ConnectorCallbackUnresolvedError extends Error {
  constructor(connectorId: string, reason: string) {
    super(`Callback for connector id=${connectorId} resolves to no onboarding: ${reason}`);
    this.name = 'ConnectorCallbackUnresolvedError';
  }
}
