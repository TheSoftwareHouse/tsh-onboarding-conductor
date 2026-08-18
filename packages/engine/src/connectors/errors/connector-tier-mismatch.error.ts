export class ConnectorTierMismatchError extends Error {
  constructor(connectorType: string, registeredTier: string, declaredTier: string) {
    super(
      `Connector type=${connectorType} is registered as ${registeredTier} but declares tier=${declaredTier}`,
    );
    this.name = 'ConnectorTierMismatchError';
  }
}
