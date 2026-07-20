export class ConnectorAdapterNotRegisteredError extends Error {
  constructor(type: string) {
    super(`Connector adapter not registered for type=${type}`);
    this.name = 'ConnectorAdapterNotRegisteredError';
  }
}
